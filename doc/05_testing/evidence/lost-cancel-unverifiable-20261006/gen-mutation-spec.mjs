// 生成「失联取消判不了不升级」（EV-177 ①）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/sh-dash-and-pty-20261006/gen-mutation-spec.mjs 的形态。期望套件只有 cancel-grace-unverifiable。
// 用法（在仓库根）：node doc/05_testing/evidence/lost-cancel-unverifiable-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const RP = 'src/trivium/run-protocol.ts';
const SUITE = 'dist/test/test/integration/cancel-grace-unverifiable.test.js';

const cases = [
  {
    id: 'M1', desc: '失联格的 isGone 退回布尔的 lostWorkerGone（改前形态）', file: RP,
    find: '      isGone: () => lostWorkerGoneJudgment(p, r),\n',
    replace: '      isGone: () => lostWorkerGone(p, r),\n', expect: SUITE,
  },
  {
    id: 'M2', desc: 'lostWorkerGoneJudgment 不报判不了', file: RP,
    find: "  if (m.identity === 'unverifiable') return 'unverifiable';\n  if (m.expected === null) return !m.alive;\n  return lostWorkerGoneFrom(m, m.expected);\n}\n\n/** `cancelRun`",
    replace: "  if (m.expected === null) return !m.alive;\n  return lostWorkerGoneFrom(m, m.expected);\n}\n\n/** `cancelRun`", expect: SUITE,
  },
  {
    id: 'M3', desc: '零信号判不了不单独播报（退回「发送 （无）」）', file: RP,
    find: '    const head = t?.unverifiable && noSignalSent\n',
    replace: '    const head = false && noSignalSent\n', expect: SUITE,
  },
  {
    id: 'M4', desc: '宽限期满判不了不说明为何没升级', file: RP,
    find: '      : t?.unverifiable && !t.escalated\n',
    replace: '      : false && !t?.escalated\n', expect: SUITE,
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
