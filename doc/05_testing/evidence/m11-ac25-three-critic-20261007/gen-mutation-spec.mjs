// 生成「AC-25 三审形态检测收口」（M11 第 3 步，计划 r2 §3）的源码变异规格：find 串从现行源码截取并核唯一，替换串扫一遍特殊替换模式。
// 照搬 evidence/breach-flag-split-20261007/gen-mutation-spec.mjs 的形态；每条只指定一个期望套件（同一变异要两个套件咬住时拆 a / b 两条）。
// 用法（在仓库根）：node doc/05_testing/evidence/m11-ac25-three-critic-20261007/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const FREEZE = 'src/trivium/freeze.ts';
const GUARD = 'src/trivium/guard.ts';
const GATE = 'src/trivium/gate.ts';
const TYPES = 'src/trivium/types.ts';
const S = {
  matrix: 'dist/test/test/unit/deny-matrix.test.js',
  fi: 'dist/test/test/integration/fault-injection.test.js',
};

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

// ── 锚点 ──
const F_META = blockOf(FREEZE, 'if (owner !== critic && isAgentId(owner)) out.add(rel);');
const F_PEER = blockOf(FREEZE, "if (verdict === 'peer-review' || verdict === 'indeterminate') out.add(rel);");
const F_RUNROOT = blockOf(FREEZE, 'out.add(expandHome(cfg.runtime.run_root));');
const F_OWN = blockOf(FREEZE, 'if (parsed.role === critic) continue;');
const F_SEG = blockOf(FREEZE, "if (seg[2] === ctx.critic) return 'own-run-material';");
// 两格空格起头只命中函数末尾那一行（:239 那行是 `if (kind !== null) return …`，return 前只有一个空格）
const F_NOSCHEMA = blockOf(FREEZE, "  return role === driver ? 'own-or-driver' : 'indeterminate';");
const G_SIDE = blockOf(GUARD, 'peerArtifactRead: peerHits.length > 0 || cmdVoiding.hits.length > 0,');
const GT_PUSH = blockOf(GATE, 'if (pathVoiding || viaCmd?.hit === true) voidedSides.push(c);');
// `for (const c of criticsOf(runMeta))` 在 gate.ts 里不止一处：从 voidedSides 的声明行起取两行，才落在派生循环上
const GT_LOOP = blockOf(GATE, 'const voidedSides: CriticId[] = [];', 2);
const T_VOID = blockOf(TYPES, "export const VOIDING_DENY_CATEGORIES: readonly DenyCategory[] = ['peer-artifact', 'peer-run-output'];");
if (!GT_LOOP.includes('for (const c of criticsOf(runMeta)) {')) throw new Error('B3 的锚点没落在 voidedSides 的派生循环上');

const both = (id, desc, file, find, replace) => [
  { id: `${id}a`, desc: `${desc}（矩阵）`, file, find, replace, expect: S.matrix },
  { id: `${id}b`, desc: `${desc}（集成）`, file, find, replace, expect: S.fi },
];

const cases = [
  // ── A：去掉对应禁读条目 ──
  ...both('A1', '_meta 结构化意见与回退件不再入禁读集', FREEZE, F_META, sub(F_META, 'out.add(rel);', 'void rel;')),
  ...both('A2', '对端 .md 审查件（review schema）不再入禁读集', FREEZE, F_PEER, sub(F_PEER, "verdict === 'peer-review' || ", '')),
  ...both('A3', '运行根不再入禁读集', FREEZE, F_RUNROOT, ''),
  // ── A4：只漏第三方（只有三审用例能逮住；既有两侧用例应全绿）──
  ...both('A4a', '跳过 codex 的 .md 审查件（第三方漏禁）', FREEZE, F_OWN, sub(F_OWN, 'parsed.role === critic', "parsed.role === critic || parsed.role === 'codex'")),
  ...both('A4b', '_meta 判据放过 codex（第三方漏禁）', FREEZE, F_META, sub(F_META, 'isAgentId(owner)', "isAgentId(owner) && owner !== 'codex'")),
  {
    id: 'A4c', desc: '运行根下第三段为 codex 也判己方材料（第三方漏判）', file: FREEZE,
    find: F_SEG, replace: sub(F_SEG, 'seg[2] === ctx.critic', "seg[2] === ctx.critic || seg[2] === 'codex'"), expect: S.fi,
  },
  // ── N：不误伤失效 ──
  { id: 'N1', desc: '己方历史产出不再跳过', file: FREEZE, find: F_OWN, replace: '', expect: S.matrix },
  ...both('N2', '无 schema 一律判不出（当轮 Driver 原稿也禁）', FREEZE, F_NOSCHEMA, sub(F_NOSCHEMA, "role === driver ? 'own-or-driver' : 'indeterminate'", "'indeterminate'")),
  // ── B：作废判定失效 ──
  { id: 'B1', desc: '逐侧 peerArtifactRead 恒为 false', file: GUARD, find: G_SIDE, replace: sub(G_SIDE, 'peerHits.length > 0 || cmdVoiding.hits.length > 0', 'false'), expect: S.fi },
  { id: 'B2', desc: '闸门不再收集作废侧', file: GATE, find: GT_PUSH, replace: sub(GT_PUSH, 'voidedSides.push(c);', 'void c;'), expect: S.fi },
  {
    id: 'B3', desc: '闸门只看入选集合的前两侧（第三侧作废不被排除）', file: GATE,
    find: GT_LOOP, replace: sub(GT_LOOP, 'criticsOf(runMeta)) {', 'criticsOf(runMeta).slice(0, 2)) {'), expect: S.fi,
  },
  { id: 'B4', desc: '作废类只剩第①类（运行根下对端输出不再作废）', file: TYPES, find: T_VOID, replace: sub(T_VOID, ", 'peer-run-output'", ''), expect: S.fi },
  {
    id: 'B5', desc: '牵连：全局 peer_artifact_read 为真即每侧都作废', file: GATE,
    find: GT_PUSH, replace: sub(GT_PUSH, 'pathVoiding || viaCmd?.hit === true', 'runMeta?.guard?.peer_artifact_read === true'), expect: S.fi,
  },
];

for (const c of cases) {
  if (/\$[$&`'0-9<]/.test(c.replace)) throw new Error(`${c.id} 的替换串含特殊替换模式`);
  if (c.find === c.replace) throw new Error(`${c.id} 替换前后相同`);
}
fs.writeFileSync(
  OUT,
  JSON.stringify({ targets: [FREEZE, GUARD, GATE, TYPES], suites: [S.matrix, S.fi], cases }, null, 2) + '\n',
  'utf8',
);
console.log(`写出 ${cases.length} 条变异到 ${OUT}`);
