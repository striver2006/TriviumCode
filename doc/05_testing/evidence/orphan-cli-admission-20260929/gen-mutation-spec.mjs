// 生成「组长已退组员仍在的准入」（EV-165）的源码变异规格：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/cancel-wait-cli-admission-20260929/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const STATUS = 'src/trivium/status.ts';
const PROTO = 'src/trivium/run-protocol.ts';
const S = {
  unit: 'dist/test/test/unit/scrub-admission.test.js',
};
const NEVER = "process.env['TRIVIUM_MUT_NEVER'] === '1'";

const cases = [
  { id: 'M1', desc: 'leaderGone 不再把成员数带出 out（U0/U1′ 的 out.membersLeft 与 why 里的精确数字咬不住）', file: STATUS,
    find: '    if (o.out) o.out.membersLeft = n;\n', replace: '', expect: S.unit },
  { id: 'M2', desc: '成员计数取不到时不再判 orphan_unverifiable（回落到 gone，判不了被静默放行）⇒ U0/U1′ 的 Hu', file: STATUS,
    find: "    if (n === null) return 'orphan_unverifiable';\n",
    replace: `    if (${NEVER}) return 'orphan_unverifiable';\n`, expect: S.unit },
  { id: 'M3', desc: '成员数 > 0 时不再判 orphaned（永远视同已结束）⇒ U0/U1′/U3′/U4′/U5″/U6′ 的 H 格', file: STATUS,
    find: "    return n > 0 ? 'orphaned' : 'gone';\n", replace: "    return 'gone';\n", expect: S.unit },
  { id: 'M4', desc: '组长不在时不再数成员，直接判 gone（回到 EV-165 之前）⇒ U0/U1′/U3′/U4′/U5″/U6′ 的 H 格', file: STATUS,
    find: '  if (!alive) return leaderGone();\n', replace: "  if (!alive) return 'gone';\n", expect: S.unit },
  { id: 'M5', desc: 'cliGroupsConfirmedGone 的 orphaned 分支不再产生阻挡 ⇒ U1′/U3′/U4′/U5″/U6′', file: STATUS,
    find: "    } else if (v === 'orphaned') {\n",
    replace: `    } else if (v === 'orphaned' && ${NEVER}) {\n`, expect: S.unit },
  { id: 'M6', desc: 'cliGroupsConfirmedGone 的 orphan_unverifiable 分支不再产生阻挡 ⇒ U1′ 的 Hu（memberCountOf 注入）', file: STATUS,
    find: "    } else if (v === 'orphan_unverifiable') {\n",
    replace: `    } else if (v === 'orphan_unverifiable' && ${NEVER}) {\n`, expect: S.unit },
  { id: 'M7', desc: 'terminateRecordedCliGroups 回到只对 alive 发信号，orphaned 组不再按组结束 ⇒ U5″（--cancel 结束 H 格组员后照抹）', file: PROTO,
    find: "      if (verdict !== 'alive' && verdict !== 'orphaned') {\n",
    replace: "      if (verdict !== 'alive') {\n", expect: S.unit },
  { id: 'M8', desc: 'settledCliSides 不再为 orphaned 来源清记录 ⇒ U5″（--cancel 结束组员之后记录应清 null）', file: PROTO,
    find: "    if (g.verdict === 'gone' || ((g.verdict === 'alive' || g.verdict === 'orphaned') && g.gone && g.membersLeft === 0)) {\n",
    replace: "    if (g.verdict === 'gone' || (g.verdict === 'alive' && g.gone && g.membersLeft === 0)) {\n", expect: S.unit },
  { id: 'M9', desc: '--wait 的 --cancel 出口只认 alive，orphaned 不再给出口 ⇒ U6′', file: PROTO,
    find: "        if (adm.cli?.blockers.some((b) => b.kind === 'alive' || b.kind === 'orphaned')) {\n",
    replace: "        if (adm.cli?.blockers.some((b) => b.kind === 'alive')) {\n", expect: S.unit },
];

for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [STATUS, PROTO], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
