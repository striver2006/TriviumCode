/** 停止在途调用后复制连续预算；保留全部原件，不重编号或双计历史。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
const require = createRequire(import.meta.url);
const { openBudget } = require('../../../../scripts/agent-access-budget.cjs');
const staticRoot = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(staticRoot, '../../../..');
const source = path.join(repo, 'doc/05_testing/evidence/agent-access-20261010-closeout-r2');
const destination = path.join(os.homedir(), '.trivium/evidence/agent-access-20261011-closeout-r3/budget');
const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const calls = path.dirname(destination) + '/calls';
for (const label of ['r12-directory-doctor-qwen', 'r12-directory-doctor-kimi', 'r12-directory-doctor-deepseek']) {
  const finished = fs.readdirSync(calls).filter(n => n.startsWith(`${label}-`) && n.endsWith('-completed.json'));
  if (finished.length !== 1) throw Error('三条doctor尚未全部完成，拒绝切换');
  const record = JSON.parse(fs.readFileSync(path.join(calls, finished[0])));
  if (record.primary_loaded !== true || record.code === null) throw Error('doctor预算装载/退出状态未知');
}
if (fs.existsSync(path.join(source, '.extension-lock'))) throw Error('扩容进行中，拒绝切换');
function snapshot(root) {
  return Object.fromEntries(['admission', 'review'].map(pool => {
    const b = openBudget(root, pool), files = fs.readdirSync(b.dir);
    const reserved = files.filter(n => /^reserved-\d+\.json$/.test(n)).sort();
    const completed = files.filter(n => /^launch-\d+\.json$/.test(n)).sort();
    if (reserved.length !== completed.length || reserved.some((n, i) => n.replace('reserved-', 'launch-') !== completed[i]))
      throw Error(`${pool}有在途/不配对记录，拒绝切换`);
    if (reserved.some((n, i) => JSON.parse(fs.readFileSync(path.join(b.dir, n))).index !== i + 1)) throw Error('计数编号不连续');
    return [pool, { reserved: reserved.length, completed: completed.length, limit: b.limit() }];
  }));
}
const before = snapshot(source), files = [];
function collect(relative) {
  const current = path.join(source, relative), stat = fs.lstatSync(current);
  if (stat.isSymbolicLink()) throw Error('预算源出现软链，拒绝复制');
  if (stat.isDirectory()) { for (const name of fs.readdirSync(current).sort()) collect(path.join(relative, name)); }
  else files.push({ path: relative, sha256: sha(current), mode: stat.mode & 0o7777 });
}
for (const name of ['approval.json', 'probe.mjs', 'ledger', 'extensions-by-key',
  ...fs.readdirSync(source).filter(n => /^extension-\d+\.json$/.test(n)).sort()]) collect(name);
fs.mkdirSync(destination); // 已存在即拒绝，不覆盖或隐式恢复。
for (const file of files) {
  if (scanSecrets(fs.readFileSync(path.join(source, file.path), 'utf8')).length) throw Error(`预算原件扫描失败：${file.path}`);
  const target = path.join(destination, file.path); fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(source, file.path), target, fs.constants.COPYFILE_EXCL); fs.chmodSync(target, file.mode);
  if (sha(target) !== file.sha256) throw Error(`复制hash不符：${file.path}`);
}
const after = snapshot(destination);
if (JSON.stringify(before) !== JSON.stringify(after) || JSON.stringify(before) !== JSON.stringify(snapshot(source)) ||
  files.some(f => sha(path.join(source, f.path)) !== f.sha256)) throw Error('复制期间源/计数变化，拒绝切换');
const record = { at: new Date().toISOString(), source, destination, before, after, files,
  authority: '本轮取证使用新的独立证据目录；正式code期间只允许编排器运行元数据，保留旧台账及原计数规则',
  counts_are_continuous: true, copied_history_is_not_new_starts: true, old_root_remains_unchanged: true,
  new_dynamic_root_only: true, guard_criteria_unchanged: true, formal_limit: 8,
  actual_probe_entry: path.join(source, 'probe.mjs'), probe_copy_usage: '仅保持canonical脚本薄入口hash来源；执行仍使用原冻结入口',
  script_sha256: sha(fileURLToPath(import.meta.url)) };
saveEvidence(path.join(destination, 'continuity.json'), record);
saveEvidence(path.join(staticRoot, 'budget-continuity-r12.json'), record);
console.log(JSON.stringify({ source, destination, budgets: after, copied_files: files.length }));
