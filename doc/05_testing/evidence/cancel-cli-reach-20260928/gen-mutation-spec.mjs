// 生成「取消够不到审查员CLI」的源码变异规格（计划 r2 §5.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/orphan-worker-20260927/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PROTO = 'src/trivium/run-protocol.ts';
const EXEC = 'src/trivium/util/exec.ts';
const S = {
  gateLoop: 'dist/test/test/integration/gate-loop.test.js',
  proto: 'dist/test/test/integration/run-protocol.test.js',
  detach: 'dist/test/test/integration/worker-detach.test.js',
};
const NEVER = "process.env['TRIVIUM_MUT_NEVER'] === '1'";
const REGISTER = '    if (killTree && child.pid !== undefined) {\n';

const cases = [
  { id: 'M1', desc: 'workerMain 不装 SIGTERM 处理器 ⇒ I1（CLI 两组留下）', file: PROTO,
    find: '  const uninstallSigterm = installWorkerSigtermForwarding();\n',
    replace: `  const uninstallSigterm = ${NEVER} ? installWorkerSigtermForwarding() : () => undefined;\n`, expect: S.gateLoop },
  { id: 'M2', desc: 'shutdownTrackedTrees 不升级 SIGKILL ⇒ U7②', file: EXEC,
    find: '        ...(o.signal ? { signal: o.signal } : {}),\n',
    replace: "        signal: (p: number, s: NodeJS.Signals) => (s === 'SIGKILL' ? false : (o.signal ?? killProcessTree)(p, s)),\n", expect: S.detach },
  { id: 'M3', desc: 'finish() 冻结时照常 resolve ⇒ U7①', file: EXEC,
    find: '      if (treeShutdown) return;\n', replace: `      if (treeShutdown && ${NEVER}) return;\n`, expect: S.detach },
  { id: 'M4', desc: 'run() 冻结后照常派生 ⇒ U7③', file: EXEC,
    find: '  if (treeShutdown) return new Promise<RunResult>(() => {});\n',
    replace: `  if (treeShutdown && ${NEVER}) return new Promise<RunResult>(() => {});\n`, expect: S.detach },
  { id: 'M5', desc: '处理器末尾不重新自杀、也不兜底退出（worker 留着）⇒ I1（--cancel 升级 SIGKILL，stderr 出现「未响应 SIGTERM」）', file: PROTO,
    find: '    if (exiting) return;\n    exiting = true;\n', replace: `    if (exiting || !(${NEVER})) return;\n    exiting = true;\n`, expect: S.gateLoop },
  { id: 'M6', desc: 'run() 不登记 killTree 子进程 ⇒ U7①', file: EXEC,
    find: REGISTER, replace: `    if (killTree && child.pid !== undefined && ${NEVER}) {\n`, expect: S.detach },
  { id: 'M7', desc: 'WORKER_TREE_GRACE_MS 改成 5000 ⇒ U8', file: PROTO,
    find: 'export const WORKER_TREE_GRACE_MS = 2000;', replace: 'export const WORKER_TREE_GRACE_MS = 5000;', expect: S.proto },
  { id: 'M8', desc: '登记也收不带 killTree 的子进程 ⇒ U7⑤', file: EXEC,
    find: REGISTER, replace: '    if (child.pid !== undefined) {\n', expect: S.detach },
  { id: 'M9', desc: '重新自杀改成同步 process.exit(143)（计划双审 r1 AGY-02 ≡ CODEX-06）⇒ U9①', file: PROTO,
    find: "    process.kill(process.pid, 'SIGTERM');\n", replace: '    process.exit(143);\n', expect: S.proto },
  { id: 'M10', desc: '并行终止改成（等效的）逐个进行：第 k 组推迟 k ×（宽限 + SIGKILL 后等待）才开始（计划双审 r1 AGY-05）⇒ U7⑥', file: EXEC,
    find: '    pending.map(async ([pid, child]) => {\n',
    replace: '    pending.map(async ([pid, child], idx) => {\n      await new Promise((r) => setTimeout(r, idx * (o.graceMs + o.killWaitMs)));\n', expect: S.detach },
];

for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [PROTO, EXEC], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
