// ISSUE-05 受控复现：并发 start→wait（stub 审查、真实 worker 派生），统计 pid_gone/failed 率。
// 不经 node:test —— 分辨「测试 runner 环境」与「任意并发环境」。
'use strict';
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO = 'D:/Work/TriviumCode';
const TRIVIUM = path.join(REPO, 'skills/dual-critic/scripts/trivium.cjs');
const BASE = path.join(os.tmpdir(), 'issue05-stress');
const PARALLEL = Number(process.argv[2] ?? 8);
const ROUNDS = Number(process.argv[3] ?? 3);
const STUB = JSON.stringify({ gemini: { mode: 'ok', findings: 1 } });
const today = new Date().toISOString().slice(0, 10);

const run = (args, opts = {}) => new Promise((resolve) => {
  execFile(process.execPath, [TRIVIUM, ...args], {
    timeout: 120_000,
    env: { ...process.env, TRIVIUM_STUB_CRITIC: STUB },
    ...opts,
  }, (err, stdout, stderr) => resolve({ code: err?.code ?? 0, err: err ? String(err.message).slice(0, 200) : null, stdout: String(stdout), stderr: String(stderr).slice(0, 300) }));
});

async function prepFixture() {
  fs.rmSync(BASE, { recursive: true, force: true });
  fs.mkdirSync(path.join(BASE, 'src'), { recursive: true });
  fs.mkdirSync(path.join(BASE, 'test'), { recursive: true });
  fs.writeFileSync(path.join(BASE, 'src/sum.cjs'), "function sum(a,b){return a+b}\nmodule.exports={sum}\n");
  fs.writeFileSync(path.join(BASE, 'test/sum.test.cjs'), "const {test}=require('node:test');const assert=require('node:assert/strict');const {sum}=require('../src/sum.cjs');\ntest('add',(p)=>{assert.equal(sum(1,2),3)})\n");
  fs.writeFileSync(path.join(BASE, 'requirements.md'), '# 需求\n- 只接收有限 number\n');
  const { execFileSync } = require('node:child_process');
  const git = (a) => execFileSync('D:/Program Files/Git/cmd/git.exe', ['-C', BASE, ...a], { stdio: 'pipe' });
  git(['init', '-b', 'main']); git(['add', '.']);
  git(['-c', 'user.name=S', '-c', 'user.email=s@x', 'commit', '-m', 'fx']);
  const init = await run(['init'], { cwd: BASE });
  if (init.code !== 0) throw new Error('init failed: ' + init.stderr);
  // 假探针（stub/0.0.0）+ 独立 run root
  const probeYaml = [
    'probe:', `  generated_at: '${new Date().toISOString()}'`,
    '  agy:', `    bin: ${JSON.stringify(process.execPath)}`, "    version: 'stub/0.0.0'",
    '    models:', "      - 'gemini-3.8-flash-high'", '    headless_read_ok: true', "    readonly_flags: ['-p']", '',
    'runtime:', `  run_root: '${BASE.replace(/\\/g, '/')}/runs'`, '',
  ].join('\n');
  fs.writeFileSync(path.join(BASE, '.trivium/config.local.yaml'), probeYaml);
  // 每路主题的原稿（start 自动取 plan/ 下最新一份）
  const total = PARALLEL * ROUNDS;
  for (let i = 0; i < total; i++) {
    const topic = `s${i}`;
    const dir = path.join(BASE, '.reviews', topic, 'plan');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${today}-${topic}-glm.md`), `---\nschema: trivium.plan.v1\ntopic: ${topic}\nstage: plan\nrole: glm\nkind: draft\n---\n\n# 冲击夹具计划 ${topic}\n\n最小计划正文。\n`);
  }
}

async function oneLane(lane, round) {
  const i = lane * ROUNDS + round;
  const topic = `s${i}`;
  const st = await run(['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', topic,
    '--driver', 'glm', '--focus', '冲击测试', '--max-rounds', '1', '--critics', 'gemini',
    '--context', 'requirements.md,src/sum.cjs', '--json'], { cwd: BASE });
  if (st.code !== 0) return { topic, kind: 'start_fail', detail: st.err ?? st.stderr.slice(0, 150) };
  const m = /"run_id"\s*:\s*"([^"]+)"/.exec(st.stdout);
  if (!m) return { topic, kind: 'start_parse', detail: st.stdout.slice(0, 120) };
  const runId = m[1];
  for (let w = 0; w < 20; w++) {
    const r = await run(['review', '--wait', runId, '--timeout', '20', '--json'], { cwd: BASE });
    if (r.code === 0) return { topic, runId, kind: 'ok' };
    if (r.code === 73) continue;
    return { topic, runId, kind: 'wait_fail', exit: r.code, detail: (r.stderr || r.stdout).slice(0, 200) };
  }
  return { topic, runId, kind: 'wait_budget' };
}

(async () => {
  console.log(`prep fixture at ${BASE}`);
  await prepFixture();
  const results = [];
  for (let round = 0; round < ROUNDS; round++) {
    const t0 = Date.now();
    const batch = await Promise.all(Array.from({ length: PARALLEL }, (_, lane) => oneLane(lane, round)));
    results.push(...batch);
    const kinds = batch.reduce((a, r) => (a[r.kind] = (a[r.kind] ?? 0) + 1, a), {});
    console.log(`round${round + 1}/${ROUNDS} ${((Date.now() - t0) / 1000) | 0}s`, JSON.stringify(kinds));
    // 失败现场保留提示
    for (const r of batch.filter((x) => x.kind !== 'ok')) {
      console.log(`  FAIL ${r.topic} ${r.kind} exit=${r.exit ?? '-'} ${r.detail ?? ''}`);
    }
  }
  const total = results.length;
  const ok = results.filter((r) => r.kind === 'ok').length;
  console.log(`SUMMARY: ${ok}/${total} ok`);
  fs.writeFileSync(path.join('D:/Work/TriviumCode-evidence/four-agent-win-20261029-211334/issue05/stress-result.json'), JSON.stringify(results, null, 1));
})();
