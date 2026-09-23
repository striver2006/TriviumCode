/**
 * 生成 M10a 第 4 步的变异规格（计划 `.reviews/M10a-第4步/plan/…-r3-claude.md` §6）。
 *
 * find / replace 逐字取自计划；唯一性由装置闸 7 在开跑前机械保证，不唯一即拒跑。
 * 用 `String.raw` 写含反斜杠的串，免得手写 JSON 时转义出错。
 *
 * 用法（仓库根执行）：
 *   node doc/05_testing/evidence/m10a-step4-mutation-20260923/gen-spec.mjs
 *   node scripts/mutation-check.mjs doc/05_testing/evidence/m10a-step4-mutation-20260923/mutation-spec.json
 *
 * find 串钉的是本步提交时的源码；之后源码改动使某条不再恰好命中一处时，闸 7 会拒跑并点名，
 * 那时按当前源码更新本脚本，别绕过闸 7。结果见 `REPORT_2026-09-23_m10a_step4.md` §1。
 */
import { writeFileSync } from 'node:fs';

const AB = 'dist/test/test/unit/adapter-base.test.js';
const DW = 'dist/test/test/unit/driver-wiring.test.js';
const RD = 'dist/test/test/unit/render.test.js';

const inferDef = String.raw`export async function inferLatestRunId(
  layout: ArchiveLayout,
  stage: Stage,
  rerunIndex: number,
  driver: AgentId = DEFAULT_DRIVER,
): Promise<string | null> {
  const items = await listStageArtifacts(layout, stage);
  for (const i of items) {
    if (i.parsed.rerunIndex !== rerunIndex) continue;
    if (i.parsed.role === driver) continue;
    const fm = parseFrontMatter(await fs.readFile(path.join(layout.archiveRoot, layout.topic, stage, i.fileName), 'utf8'));
    if (typeof fm?.['run_id'] === 'string') return fm['run_id'];
  }
  return null;
}

export type { Disposal };`;

const spec = {
  targets: [
    'src/trivium/adapters/base.ts',
    'src/trivium/review.ts',
    'src/trivium/render.ts',
    'src/trivium/cli.ts',
    'src/trivium/gate.ts',
    'test/unit/driver-wiring.test.ts',
  ],
  suites: [AB, DW, RD],
  cases: [
    {
      id: 'M62a', desc: 'isHeterogeneous 退回不感知 Driver', file: 'src/trivium/adapters/base.ts',
      find: 'return !VENDOR_MODEL_FAMILY[driverVendor].test(model);',
      replace: 'return !/claude/i.test(model);', expect: AB,
    },
    {
      id: 'M62b', desc: '写点 A 厂商实参取缺省 Driver', file: 'src/trivium/review.ts',
      find: 'agentById(meta.driver)!.vendor),\n      overrideReason: overrideReasonFor(',
      replace: 'agentById(DEFAULT_DRIVER)!.vendor),\n      overrideReason: overrideReasonFor(', expect: DW,
    },
    {
      id: "M62b'", desc: '写点 B 厂商实参写死 anthropic', file: 'src/trivium/review.ts',
      find: 'agentById(meta.driver)!.vendor),\n      // 与上面渲染侧',
      replace: "'anthropic'),\n      // 与上面渲染侧", expect: DW,
    },
    {
      id: 'M62c', desc: '写点 A 的 overrideReasonFor 末参取缺省 Driver', file: 'src/trivium/review.ts',
      find: 'overrideReason: overrideReasonFor(\n        c, r.model_effective ?? requests[c]!.model, opts.modelOverrides, r.profile_requested, meta.driver,',
      replace: 'overrideReason: overrideReasonFor(\n        c, r.model_effective ?? requests[c]!.model, opts.modelOverrides, r.profile_requested, DEFAULT_DRIVER,',
      expect: DW,
    },
    {
      id: 'M62f', desc: 'overrideReasonFor 体内厂商实参写死 anthropic', file: 'src/trivium/review.ts',
      find: 'if (isHeterogeneous(model, desc.vendor)) return null;',
      replace: "if (isHeterogeneous(model, 'anthropic')) return null;", expect: DW,
    },
    {
      id: 'M62d', desc: '厂商锚点退回只看有无第二实参', file: 'test/unit/driver-wiring.test.ts',
      find: String.raw`const VENDOR_ARG_FROM_META = /,\s*agentById\(meta\.driver\)!\.vendor\s*,?\s*\)$/;`,
      replace: String.raw`const VENDOR_ARG_FROM_META = /,\s*\S[\s\S]*\)$/;`, expect: DW,
    },
    {
      id: "M62d'", desc: '末参锚点退回只看有无第五实参', file: 'test/unit/driver-wiring.test.ts',
      find: String.raw`const DRIVER_ARG_FROM_META = /,\s*meta\.driver\s*,?\s*\)$/;`,
      replace: String.raw`const DRIVER_ARG_FROM_META = /,\s*\S[\s\S]*\)$/;`, expect: DW,
    },
    {
      id: 'M62e', desc: '同源旗标文案退回 Claude 系', file: 'src/trivium/render.ts',
      find: '本侧生效模型落在当轮 Driver 厂商的名义模型族里',
      replace: '本侧使用了 Claude 系模型', expect: RD,
    },
    {
      id: 'M64a', desc: 'cli.ts 闸门区加回裸调用', file: 'src/trivium/cli.ts',
      find: 'const pinned = pinnedId ? await readRunMeta(ref.layout, stage, pinnedId) : null;',
      replace: 'const pinned = pinnedId ? await readRunMeta(ref.layout, stage, pinnedId) : null;\n  await inferLatestRunId(ref.layout, stage, 1);',
      expect: DW,
    },
    {
      id: 'M64b', desc: 'gate.ts 加回裸调用（证明 U9 覆盖 gate.ts）', file: 'src/trivium/gate.ts',
      find: 'const tampered = await checkRecordedArtifacts(layout, [',
      replace: 'await inferLatestRunId(layout, stage, 1);\n  const tampered = await checkRecordedArtifacts(layout, [',
      expect: DW,
    },
    {
      id: 'M64c', desc: 'gate.ts 加回函数定义（不接调用）', file: 'src/trivium/gate.ts',
      find: 'export type { Disposal };',
      replace: inferDef, expect: DW,
    },
  ],
};

writeFileSync(new URL('./mutation-spec.json', import.meta.url), `${JSON.stringify(spec, null, 2)}\n`);
console.log(`cases=${spec.cases.length}`);
