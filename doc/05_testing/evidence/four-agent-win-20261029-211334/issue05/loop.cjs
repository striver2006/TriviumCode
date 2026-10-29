// ISSUE-05 复现循环：integration 全目录并发 ×N 轮，统计失败分布
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const ROUNDS = Number(process.argv[2] ?? 3);
const outDir = 'D:/Work/TriviumCode-evidence/four-agent-win-20261029-211334/issue05';
fs.mkdirSync(outDir, { recursive: true });
for (let i = 1; i <= ROUNDS; i++) {
  const log = `${outDir}/round${i}.log`;
  const t0 = Date.now();
  try {
    execFileSync('node', ['--test', ...require('node:fs').readdirSync('dist/test/test/integration').filter(f=>f.endsWith('.test.js')).map(f=>'dist/test/test/integration/'+f)], {
      cwd: 'D:/Work/TriviumCode',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 15 * 60 * 1000,
      env: { ...process.env },
    });
  } catch (e) {
    // node --test 失败退非零：输出仍在 pipe 里
    fs.writeFileSync(log, e.stdout?.toString() + '\n---stderr---\n' + e.stderr?.toString());
    const summary = (e.stdout?.toString() ?? '').match(/[ℹ✖] (tests|pass|fail|skipped) \d+/g)?.join(' | ') ?? 'parse-fail';
    console.log(`round${i}: FAIL ${((Date.now()-t0)/1000)|0}s ${summary}`);
    continue;
  }
  console.log(`round${i}: PASS ${((Date.now()-t0)/1000)|0}s`);
}
