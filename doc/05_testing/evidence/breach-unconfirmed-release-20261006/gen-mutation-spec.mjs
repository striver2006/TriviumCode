// 生成「只读失守未确证改动放行」的源码变异规格（计划 r2 §6.3 M1～M6，编码时补 M7）：
// find 串从现行源码截取，逐条核对恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。
// 照搬 evidence/breach-gate-wording-20261002/gen-mutation-spec.mjs 的形态；每条只指定一个期望套件（装置每条只收一个套件），
// 判据的两个分支（M1 changed、M2 unknown_reason）各出两条：单测一条、集成三格一条。
// find 锚点按函数体片段取、不按函数名（计划双审 GLM-03：probes/claude.ts 有同名不同义的 judgeReadonlyBreach）。
// 用法（在仓库根）：node doc/05_testing/evidence/breach-unconfirmed-release-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const HOOKS = 'src/trivium/hooks.ts';
const GATE = 'src/trivium/gate.ts';
const STUB = 'src/trivium/adapters/stub.ts';
const S = {
  hooks: 'dist/test/test/unit/hooks.test.js',
  gate: 'dist/test/test/unit/gate.test.js',
  loop: 'dist/test/test/integration/gate-loop.test.js',
  fault: 'dist/test/test/integration/fault-injection.test.js',
};

/** 从源码截锚点：含 needle 的那一行起连取 n 行（含换行），要求整段在文件里唯一 */
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

const G_CHANGED = blockOf(GATE, "return drift.changed ? 'confirmed' : 'unconfirmed_unchanged';");
const G_UNKNOWN = blockOf(GATE, "if (drift.unknown_reason !== undefined) return 'unconfirmed_unknown';");
const G_BRANCH = blockOf(GATE, "    if (cls === 'confirmed') {");
const G_WORDING = blockOf(GATE, "const unknown = cls === 'unconfirmed_unknown' ? drift.unknown_reason : undefined;");
const G_WIRE = blockOf(GATE, '? { hit: true, files: breachFiles, drift: runMeta.snapshot.drift }');
const H_ROUND = blockOf(HOOKS, "return classifyReadonlyBreach(meta.snapshot.drift) === 'confirmed' ? { g, meta } : null;");
const S_APPLY = blockOf(STUB, "await fsp.appendFile(target, `// written during review by stub ${critic}\\n`, 'utf8');");

const cases = [
  {
    id: 'M1a', desc: '判据不看 changed：失守一律算确证（复算无变化也拦）', file: GATE,
    find: G_CHANGED, replace: sub(G_CHANGED, "drift.changed ? 'confirmed' : 'unconfirmed_unchanged'", "'confirmed'"), expect: S.gate,
  },
  {
    id: 'M1b', desc: '同 M1a，期望集成三格（A 格：只产写事件不落盘应放行）咬住', file: GATE,
    find: G_CHANGED, replace: sub(G_CHANGED, "drift.changed ? 'confirmed' : 'unconfirmed_unchanged'", "'confirmed'"), expect: S.loop,
  },
  {
    id: 'M2a', desc: '判据不看 unknown_reason：比不了（changed 为 true）按确证拦', file: GATE,
    find: G_UNKNOWN, replace: '', expect: S.gate,
  },
  {
    id: 'M2b', desc: '同 M2a，期望集成三格（C 格：比不了加写事件应放行）咬住', file: GATE,
    find: G_UNKNOWN, replace: '', expect: S.loop,
  },
  {
    id: 'M3', desc: 'Hook 的 roundBreach 不调判定函数（只看失守布尔）', file: HOOKS,
    find: H_ROUND, replace: sub(H_ROUND, "classifyReadonlyBreach(meta.snapshot.drift) === 'confirmed' ? { g, meta } : null", '{ g, meta }'),
    expect: S.hooks,
  },
  {
    id: 'M4', desc: 'checkAdjudication 未确证格也推 failure（回到无条件拦）', file: GATE,
    find: G_BRANCH, replace: sub(G_BRANCH, "cls === 'confirmed'", 'true'), expect: S.gate,
  },
  {
    id: 'M5', desc: '放行告警两种说法串位：比不了说成复算无变化', file: GATE,
    find: G_WORDING, replace: sub(G_WORDING, "cls === 'unconfirmed_unknown'", "cls === 'unconfirmed_unchanged'"), expect: S.gate,
  },
  {
    id: 'M6', desc: '桩 write_breach_applied 不落盘（只剩写事件）', file: STUB,
    find: S_APPLY, replace: '', expect: S.fault,
  },
  {
    id: 'M7', desc: 'loadRoundReviews 带出的 drift 被改写为未改动（接线断）', file: GATE,
    find: G_WIRE, replace: sub(G_WIRE, 'drift: runMeta.snapshot.drift', 'drift: { ...runMeta.snapshot.drift, changed: false }'), expect: S.gate,
  },
];

// 替换串不得含 String.replace 的特殊替换模式（坑清单：变异替换串不能含 $' 一类）
for (const c of cases) {
  if (/\$[$&`'0-9<]/.test(c.replace)) throw new Error(`${c.id} 的替换串含特殊替换模式`);
  if (c.find === c.replace) throw new Error(`${c.id} 替换前后相同`);
}

const spec = {
  targets: [GATE, HOOKS, STUB],
  suites: [S.gate, S.hooks, S.loop, S.fault],
  cases,
};
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n', 'utf8');
console.log(`写出 ${cases.length} 条变异到 ${OUT}`);
