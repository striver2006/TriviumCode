// 生成「演进并入台账结构对账」（M11 第 9 步，EV-14 结构层；B 档，未走双审）的变异规格，规格由执笔方自定。
// 被测对象是两份设计文档（`.md`），`scripts/mutation-check.mjs` 的闸 4 只认 `dist/test` 下的被测产物，`.md` 进不了装置，
// 照 EV-126 先例只用逐条预跑脚本（同目录 mutation-names.mjs：备份 → 变异 → 重建 → 跑套件 → 恢复并逐字节核对）；
// 契约测试在测试时现读 doc/，变异直接生效。M5 改的是测试文件本身（去掉 ③ 的跳过），重建后生效。
// find 锚点一律从源码按唯一子串截整行，再核对整串在目标文件里恰一处；replace 不得含 `$'` 一类特殊替换模式。
// 用法（在仓库根）：node doc/05_testing/evidence/evolution-ledger-parity-20261008/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const MAIN = 'doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md';
const EVO = 'doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md';
const TEST = 'test/contract/evolution-ledger-parity.test.ts';
const SUITE = 'dist/test/test/contract/evolution-ledger-parity.test.js';

/** 含 `needle` 的那一行（带行尾换行）；恰一行，否则抛出。 */
function lineWith(file, needle) {
  const hits = read(file).split('\n').filter((l) => l.includes(needle));
  if (hits.length !== 1) throw new Error(`${file} 里含「${needle}」的行有 ${hits.length} 行`);
  return hits[0] + '\n';
}

// 18.2.1 同步清单也有一行以同一链接开头，要带上批与里程碑两列才唯一
const guideRow = lineWith(MAIN, '| [`GUIDE_env_setup.md`](../04_development/GUIDE_env_setup.md) | A | 第零步 |');
const row111 = lineWith(MAIN, '| 11.1 适配层契约泛化 |');
const apiRow = lineWith(MAIN, '| [`doc/03_api/README.md`](../03_api/README.md) | A | 第零步 |');
const skipLine = lineWith(TEST, 'const NO_PENDING_SKIP: string | false =');
const head242 = lineWith(MAIN, '| 目标文档 | 批 | 目标里程碑 | 状态 |');
const anchor242 = lineWith(MAIN, '### 24.2 本文之外的目标文档');
const evoRow18 = lineWith(EVO, '| 18 | ★ `skills/` 资产（12 份） |');

const cases = [
  {
    id: 'M1', desc: '删 24.2 的 GUIDE_env_setup.md 行（§17.2 #6 失去对应）', file: MAIN,
    find: guideRow, replace: '', expect: SUITE,
  },
  {
    id: 'M2', desc: '24.2 GUIDE_env_setup.md 行状态首字形 ✅ 改成 ✔（越出封闭字形集）', file: MAIN,
    find: guideRow, replace: guideRow.replace('| ✅ 已并入 |', '| ✔ 已并入 |'), expect: SUITE,
  },
  {
    id: 'M3', desc: '24.1「11.1 适配层契约泛化」行状态去掉 ◐，以文字「部分并入」开头', file: MAIN,
    find: row111, replace: row111.replace('| ◐ 部分并入（', '| 部分并入（'), expect: SUITE,
  },
  {
    id: 'M4', desc: '24.2 doc/03_api/README.md 行的链接改指同名的 doc/02_design/README.md（§17.2 #19 失去对应）', file: MAIN,
    find: apiRow, replace: apiRow.replace('](../03_api/README.md)', '](./README.md)'), expect: SUITE,
  },
  {
    id: 'M5', desc: '去掉 ③ 的跳过（今天应红并点名五行未绿）', file: TEST,
    find: skipLine, replace: 'const NO_PENDING_SKIP: string | false = false;\n', expect: SUITE,
  },
  {
    id: 'M6', desc: '24.2 表头「状态」改名「进度」（按表头名取列，应报列缺失而不是按序号误读）', file: MAIN,
    find: head242, replace: head242.replace('| 状态 |', '| 进度 |'), expect: SUITE,
  },
  {
    id: 'M7', desc: '24.2 锚点标题改号（解析失败应点名哪张表、哪个锚点）', file: MAIN,
    find: anchor242, replace: anchor242.replace('### 24.2 ', '### 24.9 '), expect: SUITE,
  },
  {
    id: 'M8', desc: '删 §17.2 第 18 行（防空转：§17.2 行数不再是 19）', file: EVO,
    find: evoRow18, replace: '', expect: SUITE,
  },
];

for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里命中 ${n} 处`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同（子串替换没生效）`);
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
