// 生成「心跳阈值事前告警」（EV-160）的源码变异规格（计划 r2 §6.3）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/cli-pgroup-record-20260928/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const STATUS = 'src/trivium/status.ts';
const PREFLIGHT = 'src/trivium/preflight.ts';
const PROTO = 'src/trivium/run-protocol.ts';
const CONFIG = 'src/trivium/config.ts';
const S = {
  unitStatus: 'dist/test/test/unit/status.test.js',
  unitPreflight: 'dist/test/test/unit/preflight.test.js',
  intProto: 'dist/test/test/integration/run-protocol.test.js',
  intWarn: 'dist/test/test/integration/heartbeat-threshold-warning.test.js',
};
const NEVER = "process.env['TRIVIUM_MUT_NEVER'] === '1'";
const ALWAYS = "process.env['TRIVIUM_MUT_NEVER'] !== '1'";
const PRED = '  return heartbeatStaleS * 1000 <= WORKER_HEARTBEAT_MS;\n';

const cases = [
  { id: 'N1', desc: '判定函数 <= 改成 <（等于间隔不再算）⇒ U1（30）', file: STATUS,
    find: PRED, replace: '  return heartbeatStaleS * 1000 < WORKER_HEARTBEAT_MS;\n', expect: S.unitStatus },
  { id: 'N2', desc: '判定函数恒 false ⇒ U1', file: STATUS,
    find: PRED, replace: `  return ${NEVER} && heartbeatStaleS * 1000 <= WORKER_HEARTBEAT_MS;\n`, expect: S.unitStatus },
  { id: 'N3', desc: '判定函数恒 true ⇒ U1', file: STATUS,
    find: PRED, replace: `  return ${ALWAYS} || heartbeatStaleS * 1000 <= WORKER_HEARTBEAT_MS;\n`, expect: S.unitStatus },
  { id: 'N4', desc: '预检不收 ④‴ 的项 ⇒ P1', file: PREFLIGHT,
    find: '    if (h) checks.push(h);\n', replace: `    if (h && ${NEVER}) checks.push(h);\n`, expect: S.unitPreflight },
  { id: 'N5', desc: 'startRun 汇总时丢掉阈值项 ⇒ I1', file: PROTO,
    find: '      ...(heartbeatWarn ? [heartbeatWarn] : []),\n',
    replace: `      ...(heartbeatWarn && ${NEVER} ? [heartbeatWarn] : []),\n`, expect: S.intWarn },
  { id: 'N6', desc: '--wait 那一句改回行内比较且口径不同（< 而非 <=）⇒ R1（30）', file: PROTO,
    find: "          (staleThresholdWithinHeartbeat(staleS) ? '——阈值不大于心跳间隔",
    replace: "          (staleS * 1000 < WORKER_HEARTBEAT_MS ? '——阈值不大于心跳间隔", expect: S.intProto },
  { id: 'N7', desc: '告警项去掉 warn: true ⇒ P1（不进 warnings / assertWarnInvariant）', file: PREFLIGHT,
    find: "    name: '失联阈值',\n    ok: true,\n    warn: true,\n",
    replace: "    name: '失联阈值',\n    ok: true,\n", expect: S.unitPreflight },
  { id: 'N8', desc: '正文里的阈值写死 120（不打印生效值）⇒ U2（29.5）', file: PREFLIGHT,
    find: '`⚠️ review.heartbeat_stale_s = ${staleS} s，',
    replace: '`⚠️ review.heartbeat_stale_s = 120 s，', expect: S.unitPreflight },
  { id: 'N9', desc: '正文去掉出口句 ⇒ U2', file: PREFLIGHT,
    find: '      `把阈值调回 ${DEFAULT_HEARTBEAT_STALE_S} 以上（缺省值）即可避免；若是有意为之（比如构造失联的测试），可忽略这条。`,\n',
    replace: "      '',\n", expect: S.unitPreflight },
  { id: 'N10', desc: '④‴ 挪到短路之外（前面失败也出）⇒ P4', file: PREFLIGHT,
    find: '  if (checks.every((c) => c.ok)) {\n    const h = checkHeartbeatThreshold(cfg);\n',
    replace: '  {\n    const h = checkHeartbeatThreshold(cfg);\n', expect: S.unitPreflight },
  { id: 'N11', desc: 'finished_inline 分支也带阈值项 ⇒ I6', file: PROTO,
    find: '        warnings: [],\n',
    replace: '        warnings: collectWarnings(checkHeartbeatThreshold(cfg) ? [checkHeartbeatThreshold(cfg)!] : []),\n',
    expect: S.intWarn },
  { id: 'N12', desc: '缺省配置的阈值与缺省值常量脱钩 ⇒ U2', file: CONFIG,
    find: '      heartbeat_stale_s: DEFAULT_HEARTBEAT_STALE_S,\n', replace: '      heartbeat_stale_s: 180,\n', expect: S.unitPreflight },
];

// 三条改同一处（N1～N3）：装置逐条恢复，锚点允许在不同 case 间重复，但在文件里必须恰好一处
for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [STATUS, PREFLIGHT, PROTO, CONFIG], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
