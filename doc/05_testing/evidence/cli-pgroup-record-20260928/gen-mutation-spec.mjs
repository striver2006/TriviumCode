// 生成「CLI进程组记录」的源码变异规格（计划 r2 §5.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/cancel-cli-reach-20260928/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PROTO = 'src/trivium/run-protocol.ts';
const EXEC = 'src/trivium/util/exec.ts';
const STATUS = 'src/trivium/status.ts';
const RUNNER = 'src/trivium/runner.ts';
const RETENTION = 'src/trivium/retention.ts';
const S = {
  gateLoop: 'dist/test/test/integration/gate-loop.test.js',
  unit: 'dist/test/test/unit/cli-group-record.test.js',
  retention: 'dist/test/test/unit/retention.test.js',
};
const NEVER = "process.env['TRIVIUM_MUT_NEVER'] === '1'";

const cases = [
  { id: 'M1', desc: 'runOneSide 不包 withTreeTag ⇒ I3（记录缺席）', file: RUNNER,
    find: '      attemptResult = await withTreeTag(critic, () => adapter.run(input.ctx, req));\n',
    replace: '      attemptResult = await adapter.run(input.ctx, req);\n', expect: S.gateLoop },
  { id: 'M2', desc: '取到启动时刻之后不通知 ⇒ U10（通知次数不足、记录停在 started_at: null）', file: EXEC,
    find: '            if (liveTrees.get(pid) === entry) notifyTrees();\n',
    replace: `            if (liveTrees.get(pid) === entry && ${NEVER}) notifyTrees();\n`, expect: S.unit },
  { id: 'M3', desc: '删除条目之后不通知 ⇒ I7（CLI 自然结束后记录不清）', file: EXEC,
    find: '          liveTrees.delete(pid);\n          notifyTrees();\n',
    replace: '          liveTrees.delete(pid);\n', expect: S.gateLoop },
  { id: 'M4', desc: 'syncCliRecords 不按 tag 匹配（首条给每一侧）⇒ U11', file: STATUS,
    find: '    const t = trees.filter((x) => x.tag === critic).at(-1);\n',
    replace: '    const t = trees.at(0);\n', expect: S.unit },
  { id: 'M5', desc: 'cancelRun「已不存在」分支不按记录结束 ⇒ I3', file: PROTO,
    find: '      // c 格（EV-154）：worker 在本次取消之前已退出（被强杀、崩溃）\n      cliOutcome = await terminateRecordedCliGroups(await readStatus(runDir));\n',
    replace: `      // c 格（EV-154）：worker 在本次取消之前已退出（被强杀、崩溃）\n      cliOutcome = ${NEVER} ? await terminateRecordedCliGroups(await readStatus(runDir)) : { groups: [], malformed: [] };\n`,
    expect: S.gateLoop },
  { id: 'M6', desc: 'cancelRun 升级 SIGKILL 之后不按记录结束 ⇒ I4', file: PROTO,
    find: '      if (t.escalated) {\n', replace: `      if (t.escalated && ${NEVER}) {\n`, expect: S.gateLoop },
  { id: 'M7', desc: 'judgeCliGroup 不比启动时刻（不符也判 alive）⇒ U13', file: STATUS,
    find: "  return now === r.started_at ? 'alive' : 'reused';\n", replace: "  return 'alive';\n", expect: S.unit },
  { id: 'M8', desc: 'admitScrub 不问 CLI 组 ⇒ U14', file: RETENTION,
    find: '    const cli = await cliGroupsConfirmedGone(status);\n    if (!cli.gone) {\n',
    replace: `    const cli = await cliGroupsConfirmedGone(status);\n    if (!cli.gone && ${NEVER}) {\n`, expect: S.retention },
  { id: 'M9', desc: 'terminateRecordedCliGroups 不升级 SIGKILL ⇒ U15', file: PROTO,
    find: '        ...(o.signal ? { signal: o.signal } : {}),\n',
    replace: "        signal: (p: number, sg: NodeJS.Signals) => { if (sg === 'SIGKILL') return false; try { process.kill(-p, sg); return true; } catch { return false; } },\n",
    expect: S.unit },
  { id: 'M10', desc: 'unverifiable 在取消侧当 alive（照发信号）⇒ U15（不发信号的格）。r1 时是等价变异（isGone 第二道门挡住）；代码双审 r1 GLM-01 收紧 isGone 之后应咬住', file: PROTO,
    find: "      if (verdict !== 'alive') {\n", replace: "      if (verdict !== 'alive' && verdict !== 'unverifiable') {\n", expect: S.unit },
  { id: 'M11', desc: 'unverifiable 在准入侧当已不在 ⇒ U14', file: STATUS,
    find: "    if (v === 'unverifiable') {\n", replace: `    if (v === 'unverifiable' && ${NEVER}) {\n`, expect: S.retention },
  { id: 'M12', desc: 'workerMain 不装观察者 ⇒ I3（记录缺席）', file: PROTO,
    find: '  const unwatchTrees = watchTrackedTrees(() => {\n',
    replace: `  const unwatchTrees = (${NEVER} ? watchTrackedTrees : (_l: () => void) => () => undefined)(() => {\n`, expect: S.gateLoop },
  { id: 'M13', desc: '终态早退分支不按记录结束（D3）⇒ I5', file: PROTO,
    find: '    if (recs.records.length + recs.malformed.length > 0 && (await workerConfirmedGone(s, pidFromFile)).gone) {\n',
    replace: `    if (recs.records.length + recs.malformed.length > 0 && ${NEVER} && (await workerConfirmedGone(s, pidFromFile)).gone) {\n`,
    expect: S.gateLoop },
  { id: 'M14', desc: '没有观察者时也取启动时刻 ⇒ U10', file: EXEC,
    find: '      if (treeListener) {\n        notifyTrees();\n', replace: '      {\n        notifyTrees();\n', expect: S.unit },
  { id: 'M15', desc: 'processStartTime 的 canonical 不钉环境（计划双审 r1 CODEX-01）⇒ U16', file: EXEC,
    find: "    ...(o.canonical ? { env: { LC_ALL: 'C', TZ: 'UTC0' } } : {}),\n",
    replace: `    ...(o.canonical && ${NEVER} ? { env: { LC_ALL: 'C', TZ: 'UTC0' } } : {}),\n`, expect: S.unit },
  { id: 'M16', desc: '收尾后不数组成员（计划双审 r1 GLM-01）⇒ U15 变体', file: PROTO,
    find: '      const membersLeft = t.gone ? await processGroupMemberCount(r.pgid) : null;\n',
    replace: '      const membersLeft = t.gone ? 0 : null;\n', expect: S.unit },
  { id: 'M17', desc: '准入侧把形状坏的记录当没有（计划双审 r1 GLM-02）⇒ U14', file: STATUS,
    find: '  if (malformed.length > 0) {\n    const raw',
    replace: `  if (malformed.length > 0 && ${NEVER}) {\n    const raw`, expect: S.retention },
  { id: 'M18', desc: '--cancel 主路径不清已确认结束的记录（计划双审 r1 AGY-02）⇒ I3', file: PROTO,
    find: '      if (cur?.cli && cur.cli.pgid === pgid) cur.cli = null;\n',
    replace: `      if (cur?.cli && cur.cli.pgid === pgid && ${NEVER}) cur.cli = null;\n`, expect: S.gateLoop },
  { id: 'M19', desc: 'isGone 改回 !== alive（轮询中判不了即收手，代码双审 r1 GLM-01）⇒ U17', file: PROTO,
    find: "          return v === 'gone' || v === 'reused';\n", replace: "          return v !== 'alive';\n", expect: S.unit },
];

for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [PROTO, EXEC, STATUS, RUNNER, RETENTION], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
