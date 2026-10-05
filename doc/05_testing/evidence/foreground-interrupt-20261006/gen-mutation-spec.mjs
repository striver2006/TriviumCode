// 生成「前台中断结束审查员 CLI」（EV-155）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/lost-cancel-unverifiable-20261006/gen-mutation-spec.mjs 的形态；find 带上下文以取唯一
// （`installForegroundInterruptForwarding();` 在 cli.ts 出现三处，`shutdownTrackedTrees(...)` 那一行 worker 处理器里也有）。
// 用法（在仓库根）：node doc/05_testing/evidence/foreground-interrupt-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CLI = 'src/trivium/cli.ts';
const RP = 'src/trivium/run-protocol.ts';
const SUITE = 'dist/test/test/integration/foreground-interrupt.test.js';

const cases = [
  {
    id: 'M1', desc: 'review 前台不装中断转发', file: CLI,
    find: '  // worker 有自己的 SIGTERM 处理器，故放在 worker 分支之后\n  installForegroundInterruptForwarding();\n',
    replace: '  // worker 有自己的 SIGTERM 处理器，故放在 worker 分支之后\n', expect: SUITE,
  },
  {
    id: 'M2', desc: 'doctor 不装中断转发', file: CLI,
    find: '  // 前台探针以 killTree 拉起子进程，Ctrl-C 够不到它们：装中断转发（EV-155）\n  installForegroundInterruptForwarding();\n',
    replace: '  // 前台探针以 killTree 拉起子进程，Ctrl-C 够不到它们：装中断转发（EV-155）\n', expect: SUITE,
  },
  {
    id: 'M3', desc: '处理器不看登记树、一律立即退出（等于没装）', file: RP,
    find: '    if (trackedTrees().length === 0) {\n',
    replace: '    if (trackedTrees().length >= 0) {\n', expect: SUITE,
  },
  {
    id: 'M4', desc: '处理器不调 shutdownTrackedTrees', file: RP,
    find: '    void (async () => {\n      try {\n        const r = await shutdownTrackedTrees({ graceMs: WORKER_TREE_GRACE_MS, killWaitMs: WORKER_TREE_KILL_WAIT_MS });\n        if (r.remaining.length > 0) process.stderr.write(`未能确认退出的进程组',
    replace: '    void (async () => {\n      try {\n        const r = { remaining: [] as number[] };\n        if (r.remaining.length > 0) process.stderr.write(`未能确认退出的进程组', expect: SUITE,
  },
];

for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里命中 ${n} 处`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
  if ([...c.replace].some((ch, i) => ch.charCodeAt(0) === 36 && /[$&`'0-9<]/.test(c.replace[i + 1] ?? ''))) {
    throw new Error(`${c.id} 的 replace 含特殊替换模式`);
  }
}
const spec = {
  targets: [...new Set(cases.map((c) => c.file))],
  suites: [...new Set(cases.map((c) => c.expect))],
  cases,
};
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.error(`规格 ${cases.length} 条 → ${OUT}`);
