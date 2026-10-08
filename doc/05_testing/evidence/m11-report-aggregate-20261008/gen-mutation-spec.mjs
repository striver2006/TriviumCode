// 生成「复盘报告双维度聚合」（M11 第 7 步，计划 r2 §4.2）的变异规格：find 串从现行源码截取并核唯一，替换串扫一遍特殊替换模式。
// 照搬 evidence/m11-effort-continuation-20261008/gen-mutation-spec.mjs 的形态；目标 report.ts，期望套件 report-aggregate 单测。
// 计划列的 M1～M7 之外补 M3b / M4b / M8～M10：同一条纪律在数据层与渲染层各有一处落点，只变一处会漏掉另一处。
// 用法（在仓库根）：node doc/05_testing/evidence/m11-report-aggregate-20261008/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const REPORT = 'src/trivium/report.ts';
const UNIT = 'dist/test/test/unit/report-aggregate.test.js';

/** 从含 needle 的那一行起取 n 行，核在文件里恰好一处 */
function blockOf(file, needle, n = 1) {
  const src = read(file);
  const lines = src.split('\n');
  const idx = lines.findIndex((l) => l.includes(needle));
  if (idx < 0) throw new Error(`${file} 里没有「${needle}」`);
  const block = lines.slice(idx, idx + n).join('\n') + '\n';
  const hits = src.split(block).length - 1;
  if (hits !== 1) throw new Error(`${file} 里从「${needle}」起 ${n} 行的锚点命中 ${hits} 处（应为 1）`);
  return block;
}
const sub = (s, a, b) => {
  if (!s.includes(a)) throw new Error(`锚点里没有「${a}」`);
  return s.replace(a, b);
};
const one = (id, desc, find, replace) => ({ id, desc, file: REPORT, find, replace, expect: UNIT });

const DISP = blockOf(REPORT, 'const disp = await loadDisposition(layout, stage, rerunIndex, notes, meta.driver);');
const BASE_DRIVER = blockOf(REPORT, 'driver: null,', 2);
const EFF_RENDER = blockOf(REPORT, 'if (x.effortEffective !== null) return x.effortEffective;');
const EFF_AGG = blockOf(REPORT, 'else if (s.effortEffectiveSource === null) eff.noConcept++;');
const REQ_RENDER = blockOf(REPORT, 'return x.effortRequested === null ? EFFORT_UNREQUESTED : x.effortRequested;');
const EFF_KEY = blockOf(REPORT, "...('effort_effective' in m ? { effortEffective: m.effort_effective ?? null } : {}),");
const ENUM_KNOWN = blockOf(REPORT, '? !drivers.has(i.parsed.role as AgentId)');
const OWNER = blockOf(REPORT, "const agent = row.source === 'fallback' ? agentByFindingId(row.id) : null;");
const CONTENT = blockOf(REPORT, ': (await isReviewArtifact(path.join(stageDir(layout, stage), i.fileName))) ||');
const SEEN = blockOf(REPORT, '!seenDrivers.has(i.parsed.role as AgentId);');
const V1 = blockOf(REPORT, "base.driverSource = read.sourceSchema === 'trivium.run.v1' ? 'run.v1' : 'run.v2';");
const UNKNOWN_GROUP = blockOf(REPORT, 'if (r.driver === null) {');
// 代码三审修复（run 20261008T070253Z）的四处落点
const DS_ADD = blockOf(REPORT, 'ds.add(meta.driver);');
const UNREADABLE_REASON = blockOf(REPORT, 'unreadableMetaInStage > 0');
const DISP_UNREADABLE = blockOf(REPORT, 'base.dispositionUnreadable = true;');
const UNLISTED_ROW = blockOf(REPORT, 'const x = row(c); // 只在未进时间线运行里出现过');

const cases = [
  one('M1', '裁决件回到按缺省 Driver 定位（第 7 步之前的行为）', DISP, sub(DISP, 'meta.driver);', 'DEFAULT_DRIVER);')),
  one('M2', '读不到元数据的轮次 driver 记成缺省 Driver（归给 claude 而不是单独成组）', BASE_DRIVER, sub(BASE_DRIVER, 'driver: null,', 'driver: DEFAULT_DRIVER,')),
  one('M3', '第四节生效列在 null 时回落请求值', EFF_RENDER,
    EFF_RENDER + '  if ((x as { effortRequested?: string | null }).effortRequested) return (x as { effortRequested?: string | null }).effortRequested as string;\n'),
  one('M3b', '审核者聚合的生效计次把请求值记进去', EFF_AGG,
    sub(EFF_AGG, 'else if (s.effortEffectiveSource === null)', 'else if (s.effortRequested) bump(eff.values, s.effortRequested);\n      else if (s.effortEffectiveSource === null)')),
  one('M4', '请求列 null 与缺席同写「—」', REQ_RENDER, sub(REQ_RENDER, '? EFFORT_UNREQUESTED :', '? EFFORT_ABSENT :')),
  one('M4b', '旧留痕也写出 effortEffective 键（缺席合流成 null）', EFF_KEY, sub(EFF_KEY, "...('effort_effective' in m ? { effortEffective: m.effort_effective ?? null } : {}),", 'effortEffective: m.effort_effective ?? null,')),
  one('M5', '有 run.json 的轮次仍按缺省 Driver 排除原稿', ENUM_KNOWN, sub(ENUM_KNOWN, '!drivers.has(i.parsed.role as AgentId)', 'i.parsed.role !== DEFAULT_DRIVER')),
  one('M6', '整份回退编号不按前缀归属（落进来源不明）', OWNER, sub(OWNER, "row.source === 'fallback' ? agentByFindingId(row.id) : null", 'null')),
  one('M7', '无 run.json 的轮次去掉内容谓词（计划三审 AGY-01 之前的规则）', CONTENT, sub(CONTENT, '(await isReviewArtifact(path.join(stageDir(layout, stage), i.fileName)))', 'false')),
  one('M8', '无 run.json 的轮次后缀兜底退回「≠ 缺省 Driver」（不排除本阶段当过 Driver 的家）', SEEN, sub(SEEN, '!seenDrivers.has(i.parsed.role as AgentId);', 'i.parsed.role !== DEFAULT_DRIVER;')),
  one('M9', 'run.v1 迁移不标来源', V1, sub(V1, "read.sourceSchema === 'trivium.run.v1' ? 'run.v1' : 'run.v2'", "'run.v2'")),
  one('M10', '按 Driver 聚合不再把读不到 Driver 的轮次单独成组', UNKNOWN_GROUP, sub(UNKNOWN_GROUP, 'if (r.driver === null) {', 'if (r.driver === null && r.stage === STAGES[2]) {')),
  one('M11', '同号多份 run.json 只看最后一份的 driver（代码三审 CODEX-02 之前）', DS_ADD, sub(DS_ADD, 'ds.add(meta.driver);', 'ds.clear();\n    ds.add(meta.driver);')),
  one('M12', '本阶段有读不出的 run.json 仍说「找不到」（代码三审 CODEX-01 之前）', UNREADABLE_REASON, sub(UNREADABLE_REASON, 'unreadableMetaInStage > 0', 'unreadableMetaInStage < 0')),
  one('M13', '裁决件读不出不单记（代码三审 GLM-02 之前）', DISP_UNREADABLE, sub(DISP_UNREADABLE, 'base.dispositionUnreadable = true;', 'base.dispositionUnreadable = false;')),
  one('M14', '只在未进时间线运行里出现、未失败的审核者不成行（代码三审 GLM-04 之前）', UNLISTED_ROW,
    sub(UNLISTED_ROW, 'const x = row(c);', "if (st !== 'failed' && st !== 'timeout') continue;\n      const x = row(c);")),
];

for (const c of cases) {
  if (/\$[$&`'0-9<]/.test(c.replace)) throw new Error(`${c.id} 的替换串含特殊替换模式`);
  const src = read(c.file);
  if (src.split(c.find).length - 1 !== 1) throw new Error(`${c.id} 的 find 不唯一`);
  if (c.find === c.replace) throw new Error(`${c.id} 替换前后相同`);
}
fs.writeFileSync(OUT, JSON.stringify({ targets: [REPORT], suites: [UNIT], cases }, null, 2) + '\n');
console.log(`${cases.length} 条`);
