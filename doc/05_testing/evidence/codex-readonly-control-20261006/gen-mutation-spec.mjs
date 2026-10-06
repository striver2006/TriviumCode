// 生成「codex只读负对照正对照」（EV-25，含用户定的 B1）的变异规格。本批未走双审，规格由执笔方自定。
// 照搬 evidence/topic-arg-quoting-20261006/gen-mutation-spec.mjs 的形态。
// 用法（在仓库根）：node doc/05_testing/evidence/codex-readonly-control-20261006/gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs 〈输出路径〉');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PROBE = 'src/trivium/probes/codex.ts';
const DOCTOR = 'src/trivium/doctor.ts';
const UNIT = 'dist/test/test/unit/codex-readonly-control.test.js';
const CLEANUP = 'dist/test/test/unit/probe-fixture-cleanup.test.js';
const DOCTOR_SUITE = 'dist/test/test/unit/fixture-repo-init.test.js';

const cases = [
  {
    id: 'M1', desc: '轨迹里没有写命令也判「挡住了」（改前「没动手即可信」）', file: PROBE,
    find: "  if (writes.length === 0) {\n    return {\n      kind: 'indeterminate',",
    replace: "  if (writes.length === 0) {\n    return { kind: 'held' };\n    return {\n      kind: 'indeterminate',",
    expect: UNIT,
  },
  {
    id: 'M2', desc: '不看失败标记：命令执行了就判「挡住了」', file: PROBE,
    find: "  if (writes.some((c) => (c.output ?? '').includes(READONLY_CONTROL_MARK_DENIED))) return { kind: 'held' };\n",
    replace: "  return { kind: 'held' };\n",
    expect: UNIT,
  },
  {
    id: 'M3', desc: '未判定时把 readonly_flags 写成可信（冲掉旧结论）', file: PROBE,
    find: "    case 'indeterminate':\n      return {",
    replace: "    case 'indeterminate':\n      probe.readonly_flags = [...CODEX_READONLY_INVARIANTS];\n      return {",
    expect: UNIT,
  },
  {
    id: 'M4', desc: 'codexSeverity 不认未判定（空集照报失守）', file: DOCTOR,
    find: '!ctx.skipModelCalls && !ctx.readonlyIndeterminate && probe.readonly_flags.length === 0',
    replace: '!ctx.skipModelCalls && probe.readonly_flags.length === 0',
    expect: UNIT,
  },
  {
    id: 'M5', desc: 'runDoctor 不把未判定传进 codexSeverity', file: DOCTOR,
    find: '        readonlyIndeterminate: r.readonlyIndeterminate !== null,\n',
    replace: '        readonlyIndeterminate: false,\n',
    expect: DOCTOR_SUITE,
  },
  {
    id: 'M6', desc: 'runDoctor 不出未判定 warning', file: DOCTOR,
    find: '        warnings.push(codexReadonlyIndeterminateWarning(r.readonlyIndeterminate, r.probe.readonly_flags));\n',
    replace: '        void codexReadonlyIndeterminateWarning;\n',
    expect: DOCTOR_SUITE,
  },
  {
    id: 'M7', desc: 'probeCodex 不把未判定成因带出', file: PROBE,
    find: '    readonlyIndeterminate = applied.indeterminate;\n',
    replace: '',
    expect: CLEANUP,
  },
  {
    id: 'M8', desc: 'B1 回退：rejected_command_in_trace 又从负对照那次调用刷新', file: PROBE,
    find: '    if (probe.rejected_command_in_trace === false) {\n',
    replace: '    probe.rejected_command_in_trace = control.write.completed ? control.write.commands.length > 0 : null;\n    if (probe.rejected_command_in_trace === false) {\n',
    expect: DOCTOR_SUITE,
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
