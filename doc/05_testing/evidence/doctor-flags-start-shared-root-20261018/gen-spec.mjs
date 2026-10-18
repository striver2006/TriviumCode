// 生成「doctor旗标提示与start共享根检查」的变异规格：逐条核 find 在目标文件中恰好命中一处、replace 不含特殊替换模式。
// 形态照搬 evidence/m12-shared-residue-20261018/gen-spec.mjs。目标全是 .ts，逐条预跑与正式装置共用一份规格。
// 用法（仓库根）：node gen-spec.mjs <规格 JSON>
import fs from 'node:fs';
const D = 'src/trivium/doctor.ts', C = 'src/trivium/cli.ts', R = 'src/trivium/run-protocol.ts';
const EC = 'src/trivium/entry-collisions.ts', P = 'src/trivium/preflight.ts';
const U = (n) => `dist/test/test/unit/${n}.test.js`;
const I = (n) => `dist/test/test/integration/${n}.test.js`;
const KEYS = '  assertModelOverrideKeys(ctx.config, driver, Object.keys(modelRaw), CRITIC_AGENT_IDS);';
const SCAN = "checkSharedReadRoots([rc.meta.driver, ...rc.sides], undefined, '本次运行')";
const PRUNED = '      // 准备阶段从各侧任务书第 4 段剔除的自动条目（EV-02），追加在后、既有两项顺序不变\n      ...rc.mustReadPruned,';
const cases = [
  ['M1', 'Codex 段绕过 overridesFor、改回内联合并', D,
    "    const selected = resolveTier(opts.config, 'codex', 'code', overridesFor('codex'));",
    "    const selected = resolveTier(opts.config, 'codex', 'code', { ...opts.tierFlags?.codex, ...(opts.modelOverrides?.codex ? { model: opts.modelOverrides.codex } : {}) });",
    U('doctor-unused-overrides')],
  ['M2', 'overridesFor 不记消费', D, '    consumedOverrides.add(id);', '    void consumedOverrides;', U('doctor-unused-overrides')],
  ['M3', '提示推进 blockers', D,
    '  if (unusedOverrides !== null) warnings.push(unusedOverrides);',
    '  if (unusedOverrides !== null) blockers.push(unusedOverrides);',
    U('doctor-unused-overrides')],
  ['M4', '--only 滤掉的不归原因②', D,
    '      input.only !== null && input.only !== a.cliName ? groups.filtered',
    '      false ? groups.filtered',
    U('doctor-unused-overrides')],
  ['M5', '没有段的家归到原因①', D, '        : input.ran.has(a.cliName) ? groups.fixed', '        : true ? groups.fixed', U('doctor-unused-overrides')],
  ['M6', 'cmdDoctor 不判模型键', C, KEYS, '  void modelRaw;', U('doctor-unused-overrides')],
  ['M7', 'cmdDoctor 判模型键的 picked 写成空集', C, KEYS,
    '  assertModelOverrideKeys(ctx.config, driver, Object.keys(modelRaw), []);',
    I('tier-flags-cli')],
  ['M8', 'startRun 不追加共享根项', R, '        ...(sharedRoots ? [sharedRoots] : []),', '        ...(sharedRoots ? [] : []),', I('shared-root-start')],
  ['M9', 'relevant 只传入选审核者', R, SCAN, "checkSharedReadRoots([...rc.sides], undefined, '本次运行')", I('shared-root-start')],
  ['M10', '共享根项挪到必读剔除之后', R,
    `        ...(sharedRoots ? [sharedRoots] : []),\n      ]),\n${PRUNED}`,
    `      ]),\n${PRUNED}\n      ...collectWarnings(sharedRoots ? [sharedRoots] : []),`,
    I('shared-root-start')],
  ['M11', '--start 不传场合词', R, SCAN, 'checkSharedReadRoots([rc.meta.driver, ...rc.sides])', I('shared-root-start')],
  ['M12', 'summarize 的缺省场合词漂成「本次运行」', EC,
    "  occasion = '本次预检',\n): string | null {",
    "  occasion = '本次运行',\n): string | null {",
    U('entry-collisions')],
  ['M13', 'checkSharedReadRoots 的缺省场合词漂成「本次运行」', P,
    "  occasion = '本次预检',\n): Promise<CheckResult | null> {",
    "  occasion = '本次运行',\n): Promise<CheckResult | null> {",
    U('preflight')],
  // 代码双审 GLM-01 后补：catch 分支的场合词写死成「本次预检」
  ['M14', '扫描出错分支的场合词写死', P,
    '    return { name, ok: true, warn: true, detail: `⚠️ 共享读取面检查没做成（不影响${occasion}）：${thrownText(e)}` };',
    '    return { name, ok: true, warn: true, detail: `⚠️ 共享读取面检查没做成（不影响本次预检）：${thrownText(e)}` };',
    U('preflight')],
];
for (const [id, , file, find] of cases) {
  const n = fs.readFileSync(file, 'utf8').split(find).length - 1;
  if (n !== 1) throw new Error(`${id} find 命中 ${n} 处`);
}
for (const c of cases) if (/\$[$&`'0-9<]/.test(c[4])) throw new Error(`${c[0]} replace 含特殊替换模式`);
const spec = {
  targets: [...new Set(cases.map((c) => c[2]))],
  suites: [...new Set(cases.map((c) => c[5]))],
  cases: cases.map(([id, desc, file, find, replace, expect]) => ({ id, desc, file, find, replace, expect })),
};
fs.writeFileSync(process.argv[2], JSON.stringify(spec, null, 2) + '\n');
console.log(`ok ${cases.length} 条`);
