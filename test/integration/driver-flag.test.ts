/**
 * `--driver` 的端到端契约（M9 第 5 步，T-1 / T-2）。
 *
 * ## 为什么必须走真实子进程
 *
 * 本步要证的是「**CLI 把 driver 传下去了**」，而不是「判定函数本身对不对」。
 * 后者在 `critics.test.ts` 已有正例与负例，而且它们在接线缺失时**照样是绿的**——
 * 那两条用例自己构造入参调 `resolveCriticSelection`，根本走不到 CLI 那一跳。
 *
 * 步骤表 §2.14 把 J4 / J8 的「经完整编排链路」限定为**手工 CLI 路径**
 * （`--driver` 本轮不进 skill），所以这里就是那条链路的落点。
 *
 * ## 配额
 *
 * T-1 在**选侧阶段**就退 64，一次适配器都不拉起，零成本、也没有工件可做指纹断言。
 * T-2 要走到产出，**必须注入桩，且桩配置必须点名本轮入选的每一侧**：
 * `resolveAdapters` 只替换 `Object.keys(stub)` 里点到的侧，没点到的照旧落到真适配器。
 * 既有集成夹具的桩写死 `{gemini, glm}`，而本文件选的是 claude——
 * 不点名就会在每次 `npm run check` 里真拉一次 Claude CLI，而且只有**调用之后**
 * 才由指纹断言暴露：钱已经花了。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import { DEFAULT_DRIVER } from '../../src/trivium/agents/registry.js';
import { SELECTABLE, assertSelectableUsable } from '../helpers/critic-fixtures.js';

const TOPIC = 'Driver旗标端到端';

test(
  'J8：--driver 与 --critics 指向同一家 → 退 64（自己不能审自己）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC });
    /*
     * 缺省 Driver 那一格：不给 `--driver` 也应当拒——这是 M9 第 4 步就成立的不变量，
     * 本步接线不得把它弄丢。
     */
    const a = await cli(root, [
      'review', '--start', '--entry', 'B', '--stage', 'plan',
      '--topic', TOPIC, '--focus', '看边界', '--critics', DEFAULT_DRIVER,
    ]);
    assert.equal(a.code, EXIT.USAGE, `${a.stdout}${a.stderr}`);

    // 显式写出同一家：接线之后这条走的是「用户给的 driver」，不是缺省值
    const b = await cli(root, [
      'review', '--start', '--entry', 'B', '--stage', 'plan',
      '--topic', TOPIC, '--focus', '看边界',
      '--driver', DEFAULT_DRIVER, '--critics', DEFAULT_DRIVER,
    ]);
    assert.equal(b.code, EXIT.USAGE, `${b.stdout}${b.stderr}`);
    const out = b.stdout + b.stderr;
    assert.match(out, /Driver/);
    assert.match(out, /二次审查/, '报错要说清拒的理由，不是泛泛的参数错误');
    /*
     * **锚点命中必须先断言**（第 2 轮 GLM-03）。
     *
     * 上一版直接写 `out.slice(out.indexOf('当前可用'))`：锚点词一旦漂移，
     * `indexOf` 返回 −1，`slice(-1)` 只剩最后一个字符，`doesNotMatch` 静默恒过——
     * 「第一个错误不得把用户引向第二个错误」这条护栏无声消失。
     *
     * 而这不是假想：`critics.ts` 四处写「当前可用」，本步一度在 `topic-args.ts`
     * 新写了一句「本轮可用」，同一论域两层措辞当场分叉。那处已经改回共用
     * `legalList`（判定与文案都收进 `critics.ts` 的 assertModelOverrideKeys），
     * 全仓只剩一种措辞——本条负责在它再次分叉时当场变红。
     */
    const anchor = out.indexOf('当前可用');
    assert.ok(
      anchor >= 0,
      `报错里找不到「当前可用」这个锚点——下面那条负例会因此静默恒过。\n  实际输出：${out}`,
    );
    assert.doesNotMatch(
      out.slice(anchor), new RegExp(DEFAULT_DRIVER),
      '「当前可用」里不得再列出刚被拒的那一家——第一个错误不该把用户引向第二个',
    );
  },
);

test(
  'J8 的反面：把 Driver 换成别家之后，原 Driver 那一家可以入选（选侧走得通）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    assertSelectableUsable();
    const other = SELECTABLE[0]!;
    const { root } = await makeFixture({ topic: TOPIC });
    /*
     * 夹具只带缺省 Driver 后缀的原稿，所以换了 Driver 就要补一份它的。
     *
     * **这件事本身就是接线生效的证据**：driver 不只决定谁能入选，
     * 还决定「原稿是谁的后缀」。第一版没补这份文件时，本条红在
     * 「找不到 <日期>-<主题>-codex.md」——那说明 driver 确实一路传到了
     * 被审对象定位，而不是在中途被静默换回缺省值。
     */
    const draft = path.join(root, '.reviews', TOPIC, 'plan', `2026-01-01-${TOPIC}-${other}.md`);
    await fs.writeFile(draft, `# ${other} 执笔的原稿\n`, 'utf8');

    /*
     * 走 `topic resolve`：它是**纯只读**的选侧入口，一次适配器都不拉起，
     * 却经过与 `review --start` 完全相同的判定处。用它证「选侧走得通」
     * 既到位又零配额——真正要烧配额的产出路径由带桩的用例覆盖。
     */
    const r = await cli(root, [
      'topic', 'resolve', '--stage', 'plan', '--json', '--',
      '看边界', '--topic', TOPIC, '--driver', other, '--critics', DEFAULT_DRIVER,
    ]);
    assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
    const json = JSON.parse(extractJsonCandidate(r.stdout)!.json) as {
      critics: string[]; driver: string; driver_enabled: boolean;
      notes: string[]; subject_path: string;
    };
    assert.deepEqual(json.critics, [DEFAULT_DRIVER], `换掉 Driver 之后 ${DEFAULT_DRIVER} 就是普通审核者`);
    assert.equal(json.driver, other, '解析结果要回显本轮采信的 Driver');
    // driver 不只影响选侧，也决定原稿是谁的后缀——这一条钉的是后半段
    assert.equal(
      path.basename(json.subject_path), `2026-01-01-${TOPIC}-${other}.md`,
      '被审对象应当是当轮 Driver 的原稿，而不是缺省 Driver 的那一份',
    );
    /*
     * M9 时这里是「放行 + 标注」：`driver_enabled: false` 加一条「尚未启用为 Driver」的 note。
     * M10a 第 3 步翻开关、未启用收紧为退 64 之后，走到这里的恒为 true，那条 note 随分支删除
     * （退 64 那一臂对真实注册表不可达，由 critics.test.ts 的桩用例覆盖）。
     */
    assert.equal(json.driver_enabled, true);
    assert.ok(
      !json.notes.some((n) => n.includes('尚未启用为 Driver')),
      `notes 里还有「尚未启用为 Driver」的标注，那条分支应当已删除：${JSON.stringify(json.notes)}`,
    );
  },
);

test(
  '--driver 取值未登记 → 退 64，并列出「可用作 Driver」的那几家（M10a 第 3 步起与未启用分支同口径）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC });
    const r = await cli(root, [
      'topic', 'resolve', '--stage', 'plan', '--json', '--',
      '看边界', '--topic', TOPIC, '--driver', 'nobody',
    ]);
    assert.equal(r.code, EXIT.USAGE, `${r.stdout}${r.stderr}`);
    const out = r.stdout + r.stderr;
    assert.match(out, /nobody/);
    /*
     * M9 时论域是「已登记」，所以尚未启用为 Driver 的也列出来——那时它们是合法取值。
     * M10a 第 3 步起合法取值是「可用作 Driver」，报错清单跟着改（计划双审 r2 GLM-02）：
     * 列出的可用值要与实际接受的一致。「未启用的那一家不进清单」这一格在 CLI 上构造不出来
     * （真实注册表四家全启用），由 critics.test.ts 的注入表用例覆盖。
     */
    assert.match(out, /可用作 Driver/);
    assertSelectableUsable();
    assert.match(out, new RegExp(SELECTABLE[0]!));
  },
);

test(
  'EV-53：review --start 也要拒绝「给本轮当不了审核者的一家指定模型」',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    /*
     * EV-53 第一次收口只落在 `topic resolve`，`review --start` 那条路原样留着——
     * 而后者才是真正烧配额的入口（第 2 轮 CODEX-05）。
     *
     * 失败形态是**静默丢弃**：`collectModelOverrides` 的论域是启用全集，
     * 下游 `checkModelSlugs` 只遍历入选侧，于是这个覆盖解析成功之后一路走到被丢弃，
     * 留痕与告警里都看不出用户指定过模型。所以判据必须是「退 64」，
     * 不能是「跑完之后去翻留痕」——后者在缺口存在时同样看不出问题。
     *
     * 本条**在选侧阶段就退**，一次适配器都不拉起，零配额。
     */
    assertSelectableUsable();
    const { root } = await makeFixture({ topic: TOPIC });
    const other = SELECTABLE[0]!;

    // 缺省 Driver（claude）本轮当不了审核者，却给它指定模型
    const a = await cli(root, [
      'review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', TOPIC,
      '--focus', '看边界', '--critics', other, `--model-${DEFAULT_DRIVER}`, 'm-9',
    ]);
    assert.equal(a.code, EXIT.USAGE, `应当当场退 64 而不是静默丢弃：${a.stdout}${a.stderr}`);
    const outA = a.stdout + a.stderr;
    assert.match(outA, new RegExp(`model-${DEFAULT_DRIVER}`), '报错要点名是哪个旗标');

    const at = outA.indexOf('当前可用');
    assert.ok(at >= 0, `报错里没有「当前可用」这个锚点：${outA}`);
    assert.doesNotMatch(
      outA.slice(at), new RegExp(DEFAULT_DRIVER),
      '「当前可用」里不得再列出刚被拒的那一家',
    );

    /*
     * ## 论域边界：本条守的是「本轮**能**入选谁」，不是「**实际**入选了谁」
     *
     * CODEX-05 举的复现里有一个 `--critics gemini --model-glm X`——glm 能入选、
     * 但这一轮没被选中，它的覆盖同样会被静默丢弃。那是**更宽的一档**，本步不收。
     *
     * **上一版这里写的理由是错的，第 3 轮被三侧同时证伪**（CODEX-02 ≡ AGY-03 ≡ GLM-01）。
     * 当时写的是「收紧会与 `topic-args.test.ts` 那条既有正例直接冲突」，而实测
     * `SELECTABLE[0] = codex` 本来就在缺省入选集 `DEFAULT_CRITICS` 里——收紧之后
     * 那条正例**照样绿**。我把「无显式 `--critics` 即全拒」这种稻草人变体
     * 当成了唯一实现方式。三个入口也都在本判定**之前**就解析好了入选集，
     * 所以推迟不是接线约束。
     *
     * 真实理由只有一条：**收紧是行为变化**——一批今天静默生效的写法
     * （显式 `--critics` 排除某家、却仍为它指定模型）会当场退 64，
     * 那需要单独一轮验证，不该搭在本轮的修复里。残余缺口登记为 EV-67。
     *
     * **M10b 第 2 步已收紧**（代码双审 CODEX-02，收 EV-67）：缺省集合减去 Driver 之后，
     * 这一格在非 claude Driver 的缺省路径上成了常规形态，判据改为本轮实际入选集合。
     * 两格用例见 `test/unit/topic-args.test.ts`「能入选、但本轮没入选」一组；
     * 下面补的是另两个入口（`review --start` 与 `preflight`）也接上了入选集合——
     * 只在一个入口收紧，正是 EV-53 第一次收口的形状。同样在选侧阶段就退，零配额。
     *
     * 本条要证的是另一件事：两个入口现在同口径了（EV-53 上一次只收了一个）。
     */
    assertSelectableUsable(2);
    const dropped = SELECTABLE[1]!;
    for (const argv of [
      ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', TOPIC, '--focus', '看边界'],
      ['preflight', '--stage', 'plan'],
    ]) {
      const b = await cli(root, [...argv, '--critics', other, `--model-${dropped}`, 'm-8']);
      assert.equal(b.code, EXIT.USAGE, `${argv[0]}：没入选的一侧的模型覆盖应当退 64：${b.stdout}${b.stderr}`);
      assert.match(b.stdout + b.stderr, /本轮没有入选/, `${argv[0]} 的判据没有接上本轮入选集合`);
    }
  },
);

/*
 * 命令 A 的 `--driver`：M10b 第 2 步由「拒绝」改为「接受 + plan / code 两阶段逐一交叉校验」（计划 r5 §5.3）。
 * 原先这里钉的是拒绝（接受即静默丢弃）；放开的前提是入口资产在六处交接里都渲染进了 `--driver`。
 * 声明用真实的 `topic claim` 落盘，不手写元数据——手写的形状与 CLI 写出的漂了，用例就测了个假前提。
 */
async function claimStage(root: string, stage: string, driver: string): Promise<void> {
  const r = await cli(root, ['topic', 'claim', '--topic', TOPIC, '--stage', stage, '--driver', driver, '--json']);
  assert.equal(r.code, EXIT.OK, `认领前提没立起来：${r.stdout}${r.stderr}`);
}

async function resolveAll(
  root: string,
  extra: string[],
): Promise<{ code: number | null; out: string; json: Record<string, unknown> | null }> {
  const r = await cli(root, ['topic', 'resolve', '--stage', 'all', '--json', '--', '做个功能', '--topic', TOPIC, ...extra]);
  const c = extractJsonCandidate(r.stdout);
  return { code: r.code, out: r.stdout + r.stderr, json: c ? (JSON.parse(c.json) as Record<string, unknown>) : null };
}

test(
  '命令 A 接受 --driver：与两个阶段都相容时通过并回显',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    assertSelectableUsable();
    const other = SELECTABLE[0]!;
    // 不预置原稿：夹具的缺省原稿带缺省 Driver 的后缀，认领别家会被分支 3′ 正确地拒掉
    const { root } = await makeFixture({ topic: TOPIC, draft: false });
    await claimStage(root, 'plan', other);
    const r = await resolveAll(root, ['--driver', other]);
    assert.equal(r.code, EXIT.OK, r.out);
    assert.equal(r.json?.['driver'], other);
  },
);

test(
  '命令 A：--driver 与 code 阶段的声明冲突 ⇒ 入口处退 64（不等到 S6 的 --start）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    assertSelectableUsable(2);
    const [a, b] = [SELECTABLE[0]!, SELECTABLE[1]!];
    // 不预置原稿：夹具的缺省原稿带缺省 Driver 的后缀，认领别家会被分支 3′ 正确地拒掉
    const { root } = await makeFixture({ topic: TOPIC, draft: false });
    await claimStage(root, 'code', b);
    const r = await resolveAll(root, ['--driver', a]);
    assert.equal(r.code, EXIT.USAGE, r.out);
    // 必须点名是 code 阶段：只查 plan 的实现在这里会放行（改动前的形状）
    assert.match(r.out, /code 阶段/);
  },
);

test(
  '命令 A：省略 --driver 而两个阶段的权威值不同 ⇒ 退 64，不挑一个继承',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    assertSelectableUsable(2);
    const [a, b] = [SELECTABLE[0]!, SELECTABLE[1]!];
    // 不预置原稿：夹具的缺省原稿带缺省 Driver 的后缀，认领别家会被分支 3′ 正确地拒掉
    const { root } = await makeFixture({ topic: TOPIC, draft: false });
    await claimStage(root, 'plan', a);
    await claimStage(root, 'code', b);
    const r = await resolveAll(root, []);
    assert.equal(r.code, EXIT.USAGE, r.out);
    assert.match(r.out, /plan 与 code 阶段当轮 Driver 不一致/);
    /*
     * 出口要是真出口（代码双审 GLM-05）：此前文案叫用户「显式传 --driver」，而两阶段互异时
     * 传哪个都会撞上另一阶段，照做再退一次 64。两个阶段都只是声明，两条改写命令都要给出。
     */
    assert.doesNotMatch(r.out, /请显式传 --driver/);
    assert.match(r.out, new RegExp(`topic claim --topic ${TOPIC} --stage plan --driver ${b}`));
    assert.match(r.out, new RegExp(`topic claim --topic ${TOPIC} --stage code --driver ${a}`));
    assert.match(r.out, /另开一个主题/);
  },
);

test(
  '命令 A：省略 --driver 时继承唯一的权威值（只声明了 plan）',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    assertSelectableUsable();
    const other = SELECTABLE[0]!;
    // 不预置原稿：夹具的缺省原稿带缺省 Driver 的后缀，认领别家会被分支 3′ 正确地拒掉
    const { root } = await makeFixture({ topic: TOPIC, draft: false });
    await claimStage(root, 'plan', other);
    const r = await resolveAll(root, []);
    assert.equal(r.code, EXIT.OK, r.out);
    assert.equal(r.json?.['driver'], other);
  },
);
