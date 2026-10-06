// 生成「claude探针两臂同源」（EV-46、EV-47）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/reclaimed-lock-settle-20261006/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node doc/05_testing/evidence/claude-probe-arm-parity-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PC = 'src/trivium/probes/claude.ts';
const U = 'dist/test/test/unit/claude-events.test.js';
const P = 'dist/test/test/integration/claude-probe-arm-parity.test.js';

const cases = [
  { id: 'M1', desc: 'probeArgs 忽略 readonlyFlags（对照臂退化成受限臂）', file: PC,
    find: '    ...(opts.readonlyFlags ?? READONLY_INVARIANTS),\n', replace: '    ...READONLY_INVARIANTS,\n', expect: U, also: [P] },
  { id: 'M2', desc: '对照臂调用点拿错 argv（用了受限臂那条）', file: PC,
    find: '      const ct = await execArgv(bin, memFx, arms.control);\n',
    replace: '      const ct = await execArgv(bin, memFx, arms.restricted);\n', expect: P },
  { id: 'M3', desc: '对照臂退回调用点手拼 argv（改前形态：只读旗标在前、机制旗标手抄）', file: PC,
    find: '      const ct = await execArgv(bin, memFx, arms.control);\n',
    replace: "      const ct = await execArgv(bin, memFx, [...projectMemoryControlArgs(READONLY_INVARIANTS), '-p', '--output-format', 'stream-json', '--verbose', '--max-budget-usd', PROBE_BUDGET_USD, '--model', PROBE_MODEL, askMemory]);\n",
    expect: P },
  { id: 'M4', desc: '第三臂规则退回 exact-only（改前形态）', file: PC,
    find: "  return buildDenySettings([peerRelPath], READONLY_TOOLS.split(','), denyRuleShapeOf(readRule)).json;\n",
    replace: "  void readRule; return JSON.stringify({ permissions: { deny: READONLY_TOOLS.split(',').map((tool) => tool + '(./' + peerRelPath + ')') } });\n",
    expect: U, also: [P] },
  { id: 'M5', desc: '第三臂调用点不用 fileShapeDenySettings（自建 exact-only）', file: PC,
    find: '  const fileSettings = fileShapeDenySettings(fx.peerRelPath, readRule);\n',
    replace: "  const fileSettings: string | null = JSON.stringify({ permissions: { deny: READONLY_TOOLS.split(',').map((tool) => tool + '(./' + fx.peerRelPath + ')') } });\n",
    expect: P },
  { id: 'M6', desc: '配对判据不排除 id 为 null 的调用（把「无从配对」记成 false）', file: PC,
    find: '  const pairable = i.toolUses.filter((u) => !i.allowedTools.includes(u.name) && u.id !== null);\n',
    replace: '  const pairable = i.toolUses.filter((u) => !i.allowedTools.includes(u.name));\n', expect: U },
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
