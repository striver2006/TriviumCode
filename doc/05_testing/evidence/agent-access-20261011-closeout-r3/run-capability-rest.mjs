/** 执行已公布剩余33臂；最多3个独立夹具并行，不重试已完成的重点臂或失败样本。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const batch = JSON.parse(fs.readFileSync(path.join(root, 'admission-capabilities-r12-batch.json')));
const external = path.join(os.homedir(), '.trivium/evidence/agent-access-20261011-closeout-r3');
const digest = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const jobs = batch.rows.flatMap(row => row.arms.map(arm => ({ agent: row.agent, combination: row.combination, arm,
  key: `${row.agent}-${row.combination}-${arm}`, model_requested: row.requested_model })));
const skipped = jobs.filter(job => batch.priority.includes(job.key));
for (const job of skipped) if (!fs.existsSync(path.join(external, 'routes', `${job.key}-1`, 'result.json')))
  throw Error('明确的重点臂原件未完成，不自动重跑或退回旧成功');
const pending = jobs.filter(job => !batch.priority.includes(job.key));
if (pending.length !== 33) throw Error('剩余33臂清单不符');
const results = [], started = new Date().toISOString();
let cursor = 0;
const count = () => fs.readdirSync(path.join(batch.budget_root, 'ledger/admission')).filter(n => /^reserved-\d+\.json$/.test(n)).length;
async function worker() {
  for (;;) {
    const job = pending[cursor++]; if (!job) return;
    const predicted = job.agent === 'codex' ? 2 : 1;
    if (count() + predicted > batch.before + batch.hard_max_starts) throw Error('已公布能力批硬上限不足，停止队列');
    const selectionName = job.agent !== 'codex' || job.combination.startsWith('native-') ? 'native' : job.combination;
    const selection = path.join(root, `selection-r12-${selectionName}.json`);
    const label = `r12-cap-${job.key}`;
    const child = spawn(process.execPath, [path.join(root, 'quiet-launch.mjs'), 'v4', 'admission', label,
      'probe', job.agent, job.combination, job.arm, '1'], { env: { ...process.env, TRIVIUM_ACCESS_SELECTION: selection }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.once('error', e => { stderr += `dispatcher:${e.code ?? 'unknown'}\n`; });
    const [code, signal] = await new Promise(resolve => child.once('close', (...v) => resolve(v)));
    const record = { ...job, label, code, signal, stdout, stderr, selection_sha256: digest(selection), at: new Date().toISOString() };
    results.push(record);
    saveEvidence(path.join(external, `${label}-dispatch.json`), record);
    console.log(JSON.stringify({ completed: results.length, total: 33, key: job.key, process_code: code,
      admission_starts: count(), capability_verdict: '须读取result断言，退出0不等于能力通过' }));
  }
}
const workers = await Promise.allSettled([worker(), worker(), worker()]);
const errors = workers.filter(r => r.status === 'rejected').map(r => String(r.reason.message));
saveEvidence(path.join(external, 'capability-rest-r12-dispatch.json'), { started_at: started, finished_at: new Date().toISOString(),
  script_sha256: digest(fileURLToPath(import.meta.url)), batch_sha256: digest(path.join(root, 'admission-capabilities-r12-batch.json')),
  skipped_explicit_priority: skipped, results, errors, admission_starts: count(), queue_complete: results.length === pending.length,
  original_standard_unchanged: true, automatic_retry: false });
if (errors.length || results.length !== pending.length) process.exitCode = 1;
