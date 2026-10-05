/**
 * `--driver` 的**调用链**判据（M9 第 5 步，T-4）。
 *
 * ## 为什么这一族用例扫的是源码，而不是调用函数
 *
 * 本步要防的缺口形态是「**函数签名支持了 driver，真实调用点没传**」。
 * 这类缺口在本仓已经发生过至少三次（`enumerateDenyPaths` → `freeze`、
 * `freeze` 的 `topic`、`locateSubjectReadOnly` 的第 5 形参），每一次的共同点是：
 * 被调函数的单测全绿，因为那些用例**自己构造入参**去调它。
 * 任何「自己传 driver 进去看它对不对」的用例，在这个缺口上**必然是绿的**。
 *
 * 所以判据只能是扫真实调用点的源码。`deny-matrix.test.ts` 的同类用例
 * （「freeze() 的真实调用点必须传 topic」）是先例，本文件沿用它的三件套骨架：
 * **唯一调用计数 → 实参块定位断言 → 值表达式在场**。
 *
 * ## 上一轮的教训：判据本身会是假证明
 *
 * 计划第 1 轮我写的判据在当时的 HEAD 上**就已经全绿**——`review.ts` 的 freeze
 * 实参块里有一行注释含 `driver` 字样，裸子串判据当场为真。
 * 第 2 轮我改成「剥注释后按属性位匹配」，审查员**按我的字面规则实现了一个剥离器
 * 实测**：`/* driver, *​/` 这种**单行块注释**既不以 `*` 开头、也不含 `//`，
 * 剥不掉，判据照样命中。
 *
 * 于是本文件把三条约束写成可执行的代码，并且**给每条约束配一条自测**
 * （见文件末尾「判据自身的自测」一节）——判据是本步的被审对象之一，
 * 它自己也要有人看着。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { REPO_ROOT } from '../helpers/fixture.js';
import { stripNonCode } from '../helpers/strip-non-code.js';
import { scratchDir } from '../helpers/scratch.js';

/**
 * 剥掉**一切不是代码的东西**：注释 + 字符串 / 模板 / 正则字面量的正文。
 *
 * 约束 1。这一条被打穿过四次，每一次都是审查员实测出来的：
 *
 * | 版本 | 判据 | 被什么打穿 |
 * | :-- | :-- | :-- |
 * | 1 | 裸子串 | 实参块里的注释含 `driver` 字样，当时的 HEAD 上就全绿 |
 * | 2 | 去掉「`*` 开头的行」与「`//` 之后」 | 单行块注释 `/* driver, *​/` 两条都不满足 |
 * | 3 | 两条正则整块剥注释 | **不剥字符串**：块里一句 `warn('driver 未传')` 即满足判据 |
 * | 4 | 手写词法状态机（看前一个有效字符判「正则还是除号」） | **两个方向同时坏**，见下 |
 *
 * ## 第 4 版为什么被放弃
 *
 * 它先在一个真实语料上红了一次（`review.ts` 的 `/^\s*(```|~~~)/`——正则里的
 * 反引号被当成模板起点，扫描跑偏一千多字符）。补上正则识别之后，第 3 轮三侧
 * **各自**又找出七种形态，我逐条复现，全部成立：
 *
 * | 方向 | 形态 | 后果 |
 * | :-- | :-- | :-- |
 * | 少剥 | 正则跟在 `)` / `}` 之后（`REGEX_PREV` 只含开括号） | 正则正文留下 → **假绿** |
 * | 少剥 | 正则跟在 `throw` 之后（`REGEX_KEYWORD` 漏了它） | 同上 |
 * | 多剥 | `n++ / total / 2`（`prevSig` 落在 `+` 上） | 吞掉真代码 → 假红 |
 * | 多剥 | TS 非空断言 `obj.val! / driver / scale` | 同上 |
 * | 多剥 | `o.in / total / 2`（`[^\w$]` 匹配到成员访问的 `.`） | 同上 |
 * | 多剥 | 模板插值含花括号 `` `${fn("}")}` `` | 插值提前闭合，连花括号都漏出来 |
 *
 * 少剥那一族是**致命的**：判成除号时正则正文原样留在被扫文本里，`hasProperty`
 * 就能从「不是代码的东西」里命中 `driver`。第 4 版的文档块里我写的是
 * 「宁可少剥，不可跑偏」，而本文件开头追的性质是「判据写错时倒向红」——
 * **这两句在 `/` 的歧义上直接矛盾**，而这个守卫是 12 处接线判据唯一的看守。
 *
 * ## 第 5 版：不自己写词法器
 *
 * 判「正则还是除号」需要完整的语法上下文，这不是启发式能做对的事——我在上面
 * 栽了两次。而 `typescript` 本来就在 `node_modules` 里（第 3 轮 codex 正是拿
 * 它当 oracle 逐字符比对了 `src/` 全量，证明第 4 版今天恰好零差异）。
 * 所以直接用它的解析器：**由 parser 去分辨，我们只负责按区间置空。**
 *
 * 三侧点名的「`]` 之后不剥」**其实不是 bug**：`arr[0]` 之后操作数已完整，
 * 按 JS 文法那个 `/` 就是除号，TypeScript 也这么判——旧扫描器在这一格碰巧是对的。
 * 记下来是因为：照着意见清单去写「`]` 之后必须剥」的断言会**写出一条错的判据**。
 * 同理 `obj.val! / driver / scale` 里的 `driver` 是真标识符，保留它才对。
 *
 * **实现搬去了 `test/helpers/strip-non-code.ts`**（M10a 第 1 步）：
 * 第二个需要它的判据出现时（声明接线盯防点），照抄一份就会长出第二份真相——
 * 而它恰恰是被实测打穿过四次的那类代码，两份各修各的必然分叉。
 * **本文件末尾那一整节自测仍然守着它**，实现搬家不搬责任。
 */

/**
 * 键/实参是否**以完整标识符的形态**出现在这段代码里。
 *
 * 约束 3。判据是**词边界**，不是「属性位后面跟逗号冒号」：
 * 后者套不住位置实参（形如 `locateSubject(ref, null, root, opts.driver ?? X)`
 * 的写法里 `opts.driver` 后面跟的是 `??`），把两种形态各写一套匹配器又会多一个能写错的地方。
 *
 * 词边界足以守住本步真正要防的那一格：`driverEnabled,` **不**满足 `driver`
 * （`driver` 之后是 `E`，是词字符，边界不成立），而「只加了 driverEnabled、
 * 漏了 driver」正是 `newRunMeta` 那个实参块的失败形态——两者要写在同一个块里。
 * 同理 `gateDriver` 也不会被误当成 `driver`。
 */
function hasProperty(block: string, key: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(block);
}

/**
 * 从 `from` 起取配对括号内的文本（先剥注释与字符串，故不受二者里的括号干扰）。
 *
 * **括号没配平就返回 `null`，不回落成 `src.slice(from)`**（第 2 轮 CODEX-02）。
 *
 * 上一版回落了，而调用处的守卫写的是 `block.length > 0 && block.length < src.length`，
 * 断言文案是「定位不到实参块——扫描写错了会让本条永绿」。那条守卫**自己就是永绿的**：
 * 回落返回的正是 `src.slice(from)`，长度恰为 `src.length - from`，而锚点匹配位置
 * `from > 0` 恒真，所以 `block.length < src.length` 永远成立——
 * **它想抓的失效形态，恰好是它唯一抓不到的那一种。**
 *
 * 而那个形态是有后果的：块一路吃到文件尾，`hasProperty` 随即在文件后半段命中同名
 * 标识符，判据安静变绿。fail-closed 之后，配不平就是红。
 */
function argBlockAt(src: string, from: number): string | null {
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(' || ch === '{') depth++;
    else if (ch === ')' || ch === '}') {
      depth--;
      if (depth === 0) return src.slice(from, i + 1);
    }
  }
  return null;
}

/** 取实参块，取不到就当场判红（把 fail-closed 的 null 变成一条可读的失败） */
function requireArgBlock(src: string, from: number, what: string): string {
  const block = argBlockAt(src, from);
  assert.ok(
    block !== null && /[)}]$/.test(block),
    `定位不到 ${what} 的实参块（括号没配平，扫到文件尾）——扫描写错了会让本条永绿`,
  );
  return block;
}

const cache = new Map<string, string>();
/** 读源码并剥注释；同一文件只读一次 */
async function stripped(rel: string): Promise<string> {
  const hit = cache.get(rel);
  if (hit !== undefined) return hit;
  // 用 REPO_ROOT 而不是 import.meta.url 的 pathname：后者是百分号编码的 URL 片段
  const v = stripNonCode(await fs.readFile(path.join(REPO_ROOT, rel), 'utf8'));
  cache.set(rel, v);
  return v;
}

/**
 * 逐目标的锚点。
 *
 * 约束 2。**不再「一律 `await <fn>(`」**——那条在七个目标里只对两个成立：
 * `newRunMeta` 与 `resolveCriticSelection` 都是同步函数，调用点写作 `= <fn>(`，
 * 用 await 去数必然 0 命中；而退回裸 `<fn>(` 又会命中函数声明本身
 * （`critics.ts` 与 `meta.ts` 里各有一处），那正是要防的假绿。
 *
 * 所以锚点逐个钉，且**期望条数按文件写明**：数错了就红。
 */
const TARGETS: {
  what: string;
  file: string;
  anchor: RegExp;
  count: number;
  key: string;
  why: string;
  /**
   * 被调函数名，供全局调用计数对账用（见文件末尾 RECONCILE）。
   * 目标是对象字面量而非调用点时留空。
   */
  fn?: string;
  /**
   * 该点**允许**实参块里出现 `DEFAULT_DRIVER`，附理由。
   *
   * 缺省是不允许（见下面「值来源」那条断言）。开这个口子要写清为什么，
   * 否则「形对值错」那一格会重新变绿——而这正是第 2 轮 CODEX-01 / GLM-02③ 的意见。
   */
  defaultOk?: string;
}[] = [
  {
    what: 'review.ts → newRunMeta',
    file: 'src/trivium/review.ts',
    anchor: /=\s*newRunMeta\(\{/g,
    fn: 'newRunMeta',
    count: 1,
    key: 'driver',
    why: '留痕里的发起方会恒记缺省 Driver，事后对不出这一轮实际由谁执笔',
  },
  {
    what: 'review.ts → locateSubject（被审对象）',
    file: 'src/trivium/review.ts',
    anchor: /await\s+locateSubject\(ref,/g,
    fn: 'locateSubject',
    count: 1,
    key: 'driver',
    why: '非缺省 Driver 下按缺省后缀找原稿，第一步就退 65',
  },
  /*
   * 原先这里还有「locateSubject（resolveTaskGoal 内）」一条（锚点 planRef、键 opts.driver）。
   * EV-212 起任务目标第三级改为复用 resolvePlanFinal 的取件（必填参数传入），那次调用随之删去：
   * 它按**本轮** Driver 找计划文档，计划与代码 / bug 阶段分属两家时取空或取到别家后缀的文件。
   */
  {
    what: 'review.ts → locateSubject（resolvePlanFinal 内）',
    file: 'src/trivium/review.ts',
    anchor: /await\s+locateSubject\(planStageRef,/g,
    fn: 'locateSubject',
    count: 1,
    key: 'resolution.driver',
    why: '代码阶段必读的计划定稿要按**计划阶段**的执笔方取（EV-210）；漏传或传成本轮 Driver，两阶段分属两家时取不到或取错别家后缀的文件',
  },
  {
    /*
     * 计划 §3.1 花了整整一节论证「步骤表漏掉了这一处」，而上一版的扫描清单
     * 偏偏没把它纳进来——**本步花最多笔墨论证的高频漏传点，自己没进护栏**
     * （代码双审 AGY-03）。
     */
    what: 'review.ts → resolveRerunIndex（轮次）',
    file: 'src/trivium/review.ts',
    anchor: /await\s+resolveRerunIndex\(/g,
    fn: 'resolveRerunIndex',
    count: 1,
    key: 'driver',
    why: '非缺省 Driver 下本轮审查件会被当成 Driver 自己的产出跳过，轮次偏小',
  },
  {
    what: 'cli.ts → resolveRerunIndex（闸门区回落）',
    file: 'src/trivium/cli.ts',
    anchor: /await\s+resolveRerunIndex\(/g,
    fn: 'resolveRerunIndex',
    count: 1,
    key: 'gateDriver',
    why: '扫到 0 份留痕时的旧口径回落，漏传会按缺省 Driver 算轮次',
  },
  {
    what: 'review.ts → resolveCriticSelection（回落分支）',
    file: 'src/trivium/review.ts',
    anchor: /resolveCriticSelection\(cfg,\s*\{/g,
    fn: 'resolveCriticSelection',
    count: 1,
    key: 'driver',
    why: '没给 critics 的那条路上 Driver 排除按缺省判，非缺省 Driver 会被漏放进入选集合',
  },
  {
    what: 'cli.ts → resolveCriticSelection（两个入口）',
    file: 'src/trivium/cli.ts',
    anchor: /resolveCriticSelection\(ctx\.config,\s*\{/g,
    fn: 'resolveCriticSelection',
    count: 2,
    key: 'driver',
    why: 'cmdReview 与 cmdPreflight 各一处，漏哪个都会让选侧按缺省 Driver 判',
  },
  {
    what: 'topic-args.ts → resolveCriticSelection',
    file: 'src/trivium/topic-args.ts',
    anchor: /resolveCriticSelection\(ctx\.config,\s*\{/g,
    fn: 'resolveCriticSelection',
    count: 1,
    key: 'driver',
    why: '第三个选侧入口。漏传时 topic resolve 的选侧不减 Driver，而现有用例不红',
  },
  {
    what: 'topic-args.ts → locateSubjectReadOnly',
    file: 'src/trivium/topic-args.ts',
    anchor: /await\s+locateSubjectReadOnly\(/g,
    fn: 'locateSubjectReadOnly',
    count: 1,
    key: 'driver',
    why: '这一处曾经漏改过一次，还被 registry-parity 的白名单无理由豁免掉了',
  },
  {
    what: 'run-protocol.ts → writeHandoff 的 options 字面量',
    file: 'src/trivium/run-protocol.ts',
    anchor: /const h: Handoff = \{/g,
    count: 1,
    key: 'driver',
    why: 'worker 是另一个进程，读不到 --start 的 argv；类型必填拦不住「忘了写值」以外的形态',
  },
  {
    what: 'run-protocol.ts → rebuildContext 的 opts 重建',
    file: 'src/trivium/run-protocol.ts',
    anchor: /opts: \{/g,
    count: 1,
    key: 'driver',
    why: '写进去了但读不回来，等于没传',
  },
];

for (const t of TARGETS) {
  test(`调用链：${t.what} 必须传 driver（扫真实调用点，不是调函数）`, async () => {
    const src = await stripped(t.file);
    const hits = [...src.matchAll(t.anchor)];
    assert.equal(
      hits.length, t.count,
      `${t.file} 里 ${t.what} 的调用点应当有 ${t.count} 处，实得 ${hits.length} 处。\n` +
        '  条数对不上说明代码结构变了，本条的锚点要跟着改——不要直接把期望值调成实测值，' +
        '那会把一处新增的漏传调用悄悄纳入豁免。',
    );
    for (const h of hits) {
      const block = requireArgBlock(src, h.index!, t.what);
      assert.ok(
        hasProperty(block, t.key),
        `${t.what} 的实参块里没有属性位上的 \`${t.key}\`：${t.why}。\n` +
          `  实参块：${block.slice(0, 300)}`,
      );
      /*
       * ── 值来源：不只看「词在场」（第 2 轮 CODEX-01 ≡ GLM-02③）──
       *
       * `hasProperty` 判的是词边界，于是 `driver: DEFAULT_DRIVER`——**形对值错，
       * 正是本步要防的那一格**——照样绿：键名本身就叫 driver。
       *
       * 上一轮 CODEX-05 提的是同一件事，我当时只把闸门区的两处
       * `checkAdjudication` 升级成「取值必须是 gateDriver」，其余 11 处原样留着；
       * 计划 §10 的变异表也只写了「删实参」，所以这一格从头到尾没被变异验证过。
       *
       * 现在按点收紧：缺省禁止实参块里出现 DEFAULT_DRIVER，
       * 确有正当理由的点在 TARGETS 里写 `defaultOk` 说明——把边界写成数据，
       * 而不是写在注释里让下一个人自己判断。
       */
      if (!t.defaultOk) {
        assert.ok(
          !/\bDEFAULT_DRIVER\b/.test(block),
          `${t.what} 的实参块里出现了 DEFAULT_DRIVER：本点的取值必须来自当轮解析出的 ` +
            `\`${t.key}\`，写成缺省值就是「形对值错」——属性在、值错，而旧判据看不出来。\n` +
            '  若这一处的缺省回落确有理由，在 TARGETS 的该条目上写 defaultOk 说明，不要删断言。\n' +
            `  实参块：${block.slice(0, 300)}`,
        );
      }
    }
  });
}

/*
 * ── 继承来的 driver 必须再过一次 `resolveDriver`（M10a 第 3 步，代码双审 r4 CODEX-01）──
 *
 * 显式 `--driver` 在旗标解析时就经过了 `resolveDriver`；而**继承来的**（运行留痕或 claim 声明）
 * 只在「显式值优先、缺席即继承」定下最终值之后的那一次再解析里经过它——未启用为 Driver 的
 * 靠这一次退 64。删掉它，函数级用例（critics.test.ts 的桩）照样全绿，
 * 症状却正是本步要消灭的「未启用的 Agent 当上 Driver」：本仓点名过的「函数级全绿、真实调用点没接」。
 *
 * 判据：在定下最终值的那一行之后、选侧（`resolveCriticSelection(`）之前，
 * 必须出现一次以**最终变量** `driver` 为实参的 `resolveDriver(`。两处入口各钉一次。
 */
for (const [rel, assign] of [
  ['src/trivium/cli.ts', /const\s+driver\s*=\s*explicitDriver\s*\?\?\s*resolution\.driver\s*;/],
  // M10b 第 2 步：命令 A 要比对 plan 与 code 两个阶段，继承值改由两阶段合出，最终值收在这一行
  ['src/trivium/topic-args.ts', /\bdriver\s*:\s*AgentId\s*=\s*explicitDriver\s*\?\?\s*inheritedDriver\s*\?\?\s*DEFAULT_DRIVER\s*;/],
] as const) {
  test(`继承判定之后按最终 driver 再过 resolveDriver：${rel}`, async () => {
    const src = await stripped(rel);
    const m = assign.exec(src);
    assert.ok(m, `${rel} 里找不到「显式值优先、缺席即继承」那一行——判据定位失效会让本条永绿`);
    const after = src.slice(m.index + m[0].length);
    const sel = after.search(/\bresolveCriticSelection\s*\(/);
    assert.ok(sel >= 0, `${rel} 在定下最终 driver 之后找不到选侧调用，无法划定判据的区间`);
    assert.match(
      after.slice(0, sel), /\bresolveDriver\s*\(\s*driver\s*\)/,
      `${rel}：定下最终 driver 之后、选侧之前没有 resolveDriver(driver)——继承来的未启用 Agent 会静默当上 Driver`,
    );
  });
}

test('闸门区：driver 与轮次一律直读留痕，不从工件后缀反推', async () => {
  /*
   * 计划第 2 轮的**阻断**：`inferLatestRunId`（该函数已于 M10a 第 4 步按 EV-64 删除，
   * 防复活见下方「EV-64」用例）要先知道 driver 才能跳过 Driver 自己的
   * 产出，而 driver 只记在留痕里——循环依赖。非缺省 Driver 且 `--critics claude` 时，
   * 本轮审查件全是 `-claude.md`，按缺省 Driver 推会把它们整批跳过并返回 null，
   * `gate --check` 以「请先跑一次双审」硬失败，而双审明明跑完了。
   *
   * 修法是根本不反推。所以本条钉两件事：**闸门区不再调那个反推函数**，
   * 且两处 `checkAdjudication` 都把 driver 传下去（此前空着，非缺省 Driver 下
   * 必报 missing_disposition——那正是阻断的表现面）。
   */
  const src = await stripped('src/trivium/cli.ts');
  assert.equal(
    /\binferLatestRunId\s*\(/.test(src), false,
    'cli.ts 又在调 inferLatestRunId 了：它按工件后缀反推 run_id，' +
      '而「跳过当轮 Driver 的产出」需要先知道 driver——循环依赖会让闸门在' +
      '「裁决件尚未写出」这一格硬失败。需要 run_id / driver / 轮次一律走 latestRunMeta',
  );
  assert.ok(
    /\blatestRunMeta\s*\(/.test(src),
    'cli.ts 没有直读留痕：driver 与 rerun_index 的权威来源是运行元数据，不是后缀',
  );

  /*
   * M10a 第 3 步：`--await-approval` 那一处 `checkAdjudication` 随抽取搬进
   * `gate.verifyRoundForApproval`（与 approve 共用），cli.ts 只剩 `--check` 一处。
   * 判据不变——driver 一律直读留痕——落点变了，所以下面两处分开钉：
   * cli.ts 的取 `gateDriver`，复核函数里的取本轮留痕 `runMeta.driver`。
   */
  const calls = [...src.matchAll(/await\s+checkAdjudication\(\{/g)];
  assert.equal(calls.length, 1, `cmdGate 里应当只剩 1 处 checkAdjudication（--check），实得 ${calls.length} 处`);
  const verifyCalls = [...src.matchAll(/await\s+verifyRoundForApproval\(\{/g)];
  assert.equal(
    verifyCalls.length, 2,
    `cli.ts 应当有 2 处 verifyRoundForApproval（--await-approval 与 approve），实得 ${verifyCalls.length} 处`,
  );
  const gateSrc = await stripped('src/trivium/gate.ts');
  const inVerify = gateSrc.slice(gateSrc.indexOf('export async function verifyRoundForApproval'));
  const vcall = inVerify.search(/await\s+checkAdjudication\(\{/);
  assert.ok(vcall >= 0, 'verifyRoundForApproval 里没有 checkAdjudication：审批前复核丢了裁决齐备这一半');
  assert.ok(
    /driver:\s*runMeta\.driver\b/.test(requireArgBlock(inVerify, vcall, 'checkAdjudication')),
    'verifyRoundForApproval 的 checkAdjudication 没有取本轮留痕的 driver：按缺省找裁决件，非缺省 Driver 下必报 missing_disposition',
  );
  for (const c of calls) {
    const block = requireArgBlock(src, c.index!, "checkAdjudication");
    /*
     * **判据是「取值来自 gateDriver」，不是「出现了 driver 这个词」**
     * （代码双审 CODEX-05）。上一版判的是 `hasProperty(block, 'driver')`，
     * 于是 `driver: DEFAULT_DRIVER`——形对值错、正是要防的那一格——**照样绿**。
     * 而计划 §10 变异表写的恰恰是「把 checkAdjudication 的 driver 改回缺省 → 必须红」，
     * 我当时是靠**删掉**属性验的，那条变异从没真正验到。
     */
    assert.ok(
      /driver:\s*gateDriver\b/.test(block),
      'checkAdjudication 的 driver 取值不是 gateDriver：裁决件是 `-revised-<当轮 Driver>.md`，' +
        '按缺省找会在非缺省 Driver 下必报 missing_disposition（计划双审 r2 判阻断）。\n' +
        `  实参块：${block.slice(0, 240)}`,
    );
  }

  const artifacts = [...src.matchAll(/await\s+checkStageArtifacts\(/g)];
  assert.equal(artifacts.length, 1, `cmdGate 里应当有 1 处 checkStageArtifacts，实得 ${artifacts.length} 处`);
  const ablock = requireArgBlock(src, artifacts[0]!.index!, "checkStageArtifacts");
  assert.ok(
    /gateDriver/.test(ablock),
    'checkStageArtifacts 的 driver 位仍空着（此前是 undefined）：' +
      '它决定去找谁的原稿与谁的裁决件，空着就会在非缺省 Driver 下必判缺件',
  );
});

test('EV-64：inferLatestRunId 已删除，src/trivium 下不得以原名复活', async () => {
  /*
   * 上一条只扫 cli.ts 的调用。M10a 第 3 步把 `--await-approval` 的复核抽进了
   * gate.ts 的 `verifyRoundForApproval`，闸门区从此跨两个文件——gate.ts 里重新出现的
   * 定义或调用，上一条看不见。
   *
   * **边界：这是名字判据，只防原名复活。** 改个名字的同形实现（按工件后缀反推 run_id）
   * 它抓不到；那种实现要接进 run_id / driver 才有害，而这两个值在 cli.ts（`gateDriver`
   * 与 `latestRunMeta`）与 gate.ts（`runMeta.driver`）各有取值判据。
   * 不另加「gate.ts 不得解析 front-matter」：gate.ts 本来就要解析裁决件 front-matter
   * （比对 run_id 与 role），那不是不变量（M10a 第 4 步计划双审 r1 AGY-03 驳回）。
   */
  const root = path.join(REPO_ROOT, 'src', 'trivium');
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  await walk(root);
  const rels = files.map((f) => path.relative(root, f));
  assert.ok(
    rels.includes('cli.ts') && rels.includes('gate.ts'),
    `扫描面没有覆盖 cli.ts 与 gate.ts（实得 ${files.length} 个文件）：遍历写错了，本条会空转`,
  );
  const offenders: string[] = [];
  for (const f of files) {
    // 剥注释：cli.ts / meta.ts 的历史叙事里仍提到这个名字，那是留痕不是复活
    if (/\binferLatestRunId\b/.test(stripNonCode(await fs.readFile(f, 'utf8')))) {
      offenders.push(path.relative(REPO_ROOT, f));
    }
  }
  assert.deepEqual(
    offenders, [],
    'inferLatestRunId 以原名复活了（定义或调用）：它按工件后缀反推 run_id，而「跳过当轮 Driver 的产出」' +
      '需要先知道 driver——循环依赖（EV-58 / EV-64）。需要 run_id / driver / 轮次一律走 latestRunMeta',
  );
});

/*
 * ── EV-54 / EV-62：异构判定的取值来源 ──
 *
 * 三个锚点**各写成一个具名常量**，变异规格按整行定位（M10a 第 4 步计划 r3 §6）。
 * 都允许尾随逗号与空白：写点的 `overrideReasonFor(` 是多行调用、末参后带逗号，
 * 计划 r1 写的「以 `meta.driver)` 收尾」在正确代码上会假红（计划双审 r1 CODEX-03 ≡ GLM-03）。
 */
const VENDOR_ARG_FROM_META = /,\s*agentById\(meta\.driver\)!\.vendor\s*,?\s*\)$/;
const DRIVER_ARG_FROM_META = /,\s*meta\.driver\s*,?\s*\)$/;
const VENDOR_ARG_IN_BODY = /,\s*desc\.vendor\s*,?\s*\)$/;

/**
 * 异构判定的接线判据，返回违规清单（空 = 合格）。
 *
 * **抽成纯函数，是为了让判据自测走同一个函数**（先例：`disposition-role-assets.test.ts`
 * 的「变异自测走真实管线」）。判据退回「只看参数在不在」时，真实源码上照样全绿——
 * 只有喂形对值错的合成源码才看得出来。
 *
 * 判的是**取值来源**，不是参数在不在：`agentById(DEFAULT_DRIVER)!.vendor`、`'anthropic'`
 * 这类形对值错的写法会让非缺省 Driver 下的判定回到 EV-62 的旧 bug。
 * **边界**：① 钉的是一种字面写法，语义等价的写法（如 `opts.driver ?? DEFAULT_DRIVER`）
 * 也会红，这是刻意的，与上面 `gateDriver` 那条同构；② 只证「取的是 `meta.driver`」，
 * 它是否就是当轮 Driver 由 TARGETS 的 `newRunMeta` 锚点承接；③ 函数体内 `desc` 与
 * `driver` 形参的对应只按名字认。
 */
function heterogeneousWiringViolations(src: string): string[] {
  const out: string[] = [];
  const hits = [...src.matchAll(/heterogeneous: isHeterogeneous\(/g)];
  if (hits.length !== 2) out.push(`heterogeneous 的写点应当有 2 处，实得 ${hits.length} 处`);

  for (const h of hits) {
    const block = argBlockAt(src, h.index!);
    if (block === null || !VENDOR_ARG_FROM_META.test(block)) {
      out.push(
        'isHeterogeneous 的厂商实参不是 agentById(meta.driver)!.vendor：' +
          '非缺省 Driver 下会把跨厂商的 claude 系模型继续误判成同源（EV-62）\n' +
          `  实参块：${(block ?? '（括号没配平）').slice(0, 240)}`,
      );
    }
    /*
     * 两个写点分别在渲染入参与运行元数据里，键名一个是 camelCase 一个是 snake_case，
     * 取值必须来自同一个派生函数（EV-54）。窗口 400 字符：剥注释后长度不变，
     * 写点 B 的两行注释也算在窗口里。
     */
    const after = src.slice(h.index!, h.index! + 400);
    if (!/overrideReason|override_reason/.test(after)) {
      out.push(
        'heterogeneous 旁边没有 override_reason：run.v2 的契约要求 false 时必须有它，' +
          '不补写入方，那份留痕会自相矛盾地进台账',
      );
    }
    const k = src.indexOf('overrideReasonFor(', h.index!);
    if (k < 0 || k - h.index! > 400) {
      out.push('两个写点必须共用 overrideReasonFor 派生：各写一份文案会踩破「两处同值」这条判据自身');
      continue;
    }
    const orBlock = argBlockAt(src, k);
    if (orBlock === null || !DRIVER_ARG_FROM_META.test(orBlock)) {
      out.push(
        'overrideReasonFor 的末参不是 meta.driver：文案会点名错的 Driver，' +
          '函数体内的同族判定也会按错的厂商算\n' +
          `  实参块：${(orBlock ?? '（括号没配平）').slice(0, 240)}`,
      );
    }
  }

  /*
   * 函数体内那次判定（计划双审 r2 CODEX-01）：它的厂商实参若写死，编译与 typecheck 都过
   * （`driver` 仍被 `desc.display` 读取），缺省 Driver 下行为也一致，而非缺省 Driver 下
   * 会写出「heterogeneous: true 配一条非空 override_reason」的自相矛盾件。
   * 函数是模块私有的，单测进不去，所以判据落在源码上。
   */
  const fnAt = src.indexOf('function overrideReasonFor(');
  const params = fnAt < 0 ? null : argBlockAt(src, fnAt);
  if (params === null) {
    out.push('找不到 overrideReasonFor 的定义（或参数表括号没配平）');
    return out;
  }
  if (!/\bdriver\s*:\s*AgentId\b/.test(params)) {
    out.push('overrideReasonFor 没有 driver: AgentId 形参：同族判定拿不到当轮 Driver');
  }
  const bodyAt = src.indexOf('{', fnAt + params.length);
  const body = bodyAt < 0 ? null : argBlockAt(src, bodyAt);
  if (body === null) {
    out.push('overrideReasonFor 的函数体括号没配平');
    return out;
  }
  if (!/\bconst\s+desc\s*=\s*agentById\(\s*driver\s*\)!\s*;/.test(body)) {
    out.push('overrideReasonFor 体内的 desc 不是取自 agentById(driver)!：文案与同族判定会用错的 Driver');
  }
  const hAt = body.indexOf('isHeterogeneous(');
  const inner = hAt < 0 ? null : argBlockAt(body, hAt);
  if (inner === null || !VENDOR_ARG_IN_BODY.test(inner)) {
    out.push(
      'overrideReasonFor 体内 isHeterogeneous 的厂商实参不是 desc.vendor：' +
        '非缺省 Driver 下会写出「heterogeneous: true 配一条非空 override_reason」的自相矛盾件\n' +
        `  实参块：${(inner ?? '（没找到调用）').slice(0, 240)}`,
    );
  }
  return out;
}

test('调用链：isHeterogeneous 与 overrideReasonFor 的厂商与 Driver 取值来自当轮留痕（EV-54 / EV-62）', async () => {
  const src = await stripped('src/trivium/review.ts');
  const violations = heterogeneousWiringViolations(src);
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('判据自测：取值来源判据对形对值错的写法必须报出', () => {
  /*
   * 合成源码喂**同一个函数**。判据若退回「只看参数在不在」，(b)(c)(d)(f)(g) 会判空，
   * 本条变红；(a) 两份防判据恒报，也防排版差异（单行 / 多行加尾逗号）造成假红。
   */
  const fixture = (o: {
    vendorA?: string; vendorB?: string; driverA?: string; driverB?: string;
    bodyVendor?: string; bodyDesc?: string; multiline?: boolean; singleArg?: boolean;
  }): string => {
    const v = (x: string | undefined): string => x ?? 'agentById(meta.driver)!.vendor';
    const d = (x: string | undefined): string => x ?? 'meta.driver';
    const het = (x: string | undefined): string =>
      o.singleArg ? 'isHeterogeneous(m)' : `isHeterogeneous(m, ${v(x)})`;
    const orCall = (key: string, x: string | undefined): string =>
      o.multiline
        ? `${key}: overrideReasonFor(\n        c, m, opts.modelOverrides, r.profile_requested, ${d(x)},\n      ),`
        : `${key}: overrideReasonFor(c, m, opts.modelOverrides, r.profile_requested, ${d(x)}),`;
    return [
      'function overrideReasonFor(c: CriticId, model: string | null, mo: X, p: string | null, driver: AgentId): string | null {',
      `  const desc = ${o.bodyDesc ?? 'agentById(driver)!'};`,
      `  if (isHeterogeneous(model, ${o.bodyVendor ?? 'desc.vendor'})) return null;`,
      '  return desc.display;',
      '}',
      'const a = {',
      `      heterogeneous: ${het(o.vendorA)},`,
      `      ${orCall('overrideReason', o.driverA)}`,
      '};',
      'const b = {',
      `      heterogeneous: ${het(o.vendorB)},`,
      `      ${orCall('override_reason', o.driverB)}`,
      '};',
    ].join('\n');
  };

  // (a) 正确写法，单行与多行加尾逗号两种排版
  assert.deepEqual(heterogeneousWiringViolations(fixture({})), [], '(a) 单行正确写法被误报');
  assert.deepEqual(heterogeneousWiringViolations(fixture({ multiline: true })), [], '(a) 多行加尾逗号的正确写法被误报');

  const mustReport: [string, Parameters<typeof fixture>[0]][] = [
    ['(b) 写点厂商实参取缺省 Driver', { vendorA: 'agentById(DEFAULT_DRIVER)!.vendor' }],
    ['(c) 写点厂商实参写死 anthropic', { vendorB: "'anthropic'" }],
    ['(d) overrideReasonFor 末参取缺省 Driver', { driverA: 'DEFAULT_DRIVER', multiline: true }],
    ['(e) 只有一个实参（改前形态）', { singleArg: true }],
    ['(f) 函数体内厂商实参写死 anthropic', { bodyVendor: "'anthropic'" }],
    ['(g) 函数体内 desc 取自缺省 Driver', { bodyDesc: 'agentById(DEFAULT_DRIVER)!' }],
  ];
  for (const [what, o] of mustReport) {
    assert.ok(heterogeneousWiringViolations(fixture(o)).length > 0, `${what}：判据没有报出`);
  }
});

test('对账：两个「谁算原稿」的入口对同一夹具给出同一答案（EV-65）', async () => {
  /*
   * `topic.ts` 的 `locateSubject`（`review --start` 走它）与 `topic-args.ts` 的
   * `locateSubjectReadOnly`（`topic resolve` 走它）各有一套候选过滤、排序、
   * 审查件剔除与显式硬拒——**四份复制品**。代码审三侧逐行核过今天确实一致，
   * 但改一处另一处不会红，而且它们的用例分处两个文件。
   *
   * 本仓对「同一事实两份实现」的既有对策是 grep 级对账（`registry-parity`、
   * `deny-matrix`）。这一条是同族：同一夹具分别过两个入口，断同一结果。
   * **抽成共用函数是更好的修法**（登记 EV-65），在那之前由本条看着。
   */
  const { locateSubject, resolveTopicReadOnly } = await import('../../src/trivium/topic.js');
  const { resolveTopicArgs } = await import('../../src/trivium/topic-args.js');
  const { defaultConfig } = await import('../../src/trivium/config.js');

  const root = await scratchDir('trivium-parity-');
  const ctx = {
    config: defaultConfig(), projectRoot: root,
    archiveRoot: path.join(root, '.reviews'),
    triviumDir: path.join(root, '.trivium'), sources: ['<test>'],
  };
  const dir = path.join(ctx.archiveRoot, 'T', 'plan');
  await fs.mkdir(dir, { recursive: true });
  // 真原稿在前、顶着同一后缀的审查件在后（日期更晚，排序上会排在前面）
  await fs.writeFile(path.join(dir, '2026-09-10-T-claude.md'), '# 我才是原稿\n');
  await fs.writeFile(
    path.join(dir, '2026-09-12-T-claude.md'),
    '---\nschema: trivium.review.v1\n---\n\n# 计划审查\n',
  );

  const viaTopic = await locateSubject(
    await resolveTopicReadOnly(ctx, 'T', 'plan'), null, ctx.projectRoot,
  );
  const viaArgs = await resolveTopicArgs({ ctx, scope: 'plan', rawArgs: ['看边界', '--topic', 'T'] });

  assert.equal(
    path.basename(viaTopic), path.basename(viaArgs.subject_path!),
    '两个入口对同一夹具选出了不同的原稿——「谁算原稿」有两个答案了',
  );
  assert.equal(path.basename(viaTopic), '2026-09-10-T-claude.md');
});

// ───────────────────── 判据自身的自测 ─────────────────────
/*
 * 上一轮的教训是「判据看起来对、实际永绿」，而那次正是**没有**把判据写成
 * 可执行的东西再验一遍。下面三条验的是本文件的三条约束本身。
 *
 * > **约束 1 的被测对象在 `test/helpers/strip-non-code.ts`**，不在本文件里
 * > （M10a 第 1 步搬的家，因为第二个判据也要用它）。**自测没跟着搬**：
 * > 下面这些跑在 `review.ts` 等真实语料上，搬去 helper 旁边就只剩合成用例了。
 * > 改那个 helper 的人请回来跑这一节。
 */

test('判据自测：约束 1 剥得掉单行块注释（上一轮就是在这里漏的）', () => {
  /*
   * 四种形态都**不该**命中。前两种是上一轮判据的实际失效点：单行块注释
   * 既不以 `*` 开头、也不含 `//`，按「去掉 `*` 开头与 `//` 之后」的规则剥不掉。
   *
   * 第四个用的是**完整**块注释，不是裸的 ` * driver,` 片段——真实代码里
   * 那种续行只存在于 `/* … *​/` 之内，整块会被一起剥掉；拿裸片段当夹具
   * 是在测一个现实中不存在的输入。
   */
  const cases = [
    '/* driver, */',
    '/* driver: 当轮 */',
    '// driver,',
    '/*\n   * 下面 driver 字段的注释记的就是第一次\n   */',
  ];
  for (const s of cases) {
    assert.equal(
      hasProperty(stripNonCode(s), 'driver'), false,
      `注释里的 driver 被当成了真实传值：${JSON.stringify(s)}——这正是上一轮判据失效的形态`,
    );
  }
});

test('判据自测：剥注释之后，review.ts 的 freeze 实参块里那行注释不再命中', async () => {
  /*
   * 这条钉的是**真实语料**，不是构造的字符串：`review.ts` 的 freeze 实参块里
   * 确有一行注释含 `driver` 字样（「下面 `driver` 字段的注释记的就是第一次」），
   * 计划第 1 轮的裸子串判据就是被它当场变绿的。
   *
   * 做法：把真实实参块里的**属性位** `driver,` 抠掉，只留注释，再断言判据为假。
   * 这样验的是「剥注释真的起作用」，而不是「属性位在不在」。
   */
  const src = await stripped('src/trivium/review.ts');
  const raw = await fs.readFile(path.join(REPO_ROOT, 'src/trivium/review.ts'), 'utf8');
  const at = raw.indexOf('await freeze({');
  assert.ok(at > 0, '定位不到 freeze 调用——本条的语料没了');
  const rawBlock = requireArgBlock(raw, at, 'freeze（未剥注释的原文）');
  assert.ok(/driver/.test(rawBlock), '真实实参块里连 driver 字样都没有，本条失去语料');

  // 未剥注释时：注释里的 driver 让裸判据为真（上一轮的失效形态）
  const withoutProperty = rawBlock.replace(/^\s*driver,\s*$/m, '');
  assert.ok(
    /\bdriver\b/.test(withoutProperty),
    '把属性位抠掉之后，原文里应当仍有注释中的 driver 字样——否则本条证不出剥注释的价值',
  );
  // 剥注释后：应当为假
  assert.equal(
    hasProperty(stripNonCode(withoutProperty), 'driver'), false,
    '剥注释没起作用：freeze 实参块的注释里那个 driver 仍被当成真实传值，' +
      '本文件全部调用链判据都会退化成永绿',
  );
  // 完整实参块（含属性位）则必须为真
  assert.equal(hasProperty(src.slice(src.indexOf('await freeze({')), 'driver'), true);
});

test('判据自测：约束 1 不得误伤「属性位与逗号之间夹注释」这种合法写法', () => {
  assert.equal(
    hasProperty(stripNonCode('driver /* 当轮 */,'), 'driver'), true,
    '一个正确的实现被判红了。误红比漏判更危险：实现者会有动机把判据放松回裸词，' +
      '那就退回上一轮的假证明',
  );
});

test('判据自测：约束 3 区分得开 driver 与 driverEnabled / gateDriver', () => {
  for (const ok of ['driver,', 'driver: driver,', 'driver }', 'opts.driver ?? X', 'driver)']) {
    assert.equal(hasProperty(ok, 'driver'), true, `合法形态被判漏：${ok}`);
  }
  assert.equal(
    hasProperty('driverEnabled,', 'driver'), false,
    '`driverEnabled` 满足了 `driver` 的判据——而「只加了 driverEnabled、漏了 driver」' +
      '正是 newRunMeta 那个实参块的失败形态（两者要写在同一个块里）',
  );
  assert.equal(
    hasProperty('gateDriver,', 'driver'), false,
    '`gateDriver` 满足了 `driver` 的判据——词边界没起作用',
  );
});

test('判据自测：约束 1 还要剥掉字符串字面量（第 2 轮三侧同时指出）', () => {
  /*
   * 上一版只剥注释。三侧在第 2 轮同时打中这一格：实参块里出现一句
   * `warn('driver 未传')`、或一条含 driver 字样的错误文案，判据即满足——
   * **无需真实传值**。这不是「扩大扫描面时才要管」的事，今天就能触发，
   * 只是当前的实参块里恰好没有这种字符串。
   */
  const cases = [
    `warn('driver 未传')`,
    `throw new Error("缺少 driver")`,
    'log(`driver=<未知>`)',
  ];
  for (const s of cases) {
    assert.equal(
      hasProperty(stripNonCode(s), 'driver'), false,
      `字符串里的 driver 被当成了真实传值：${s}`,
    );
  }
  // 但模板里的 `${…}` 是**代码**，不能一起抹掉
  assert.equal(
    hasProperty(stripNonCode('log(`driver=${driver}`)'), 'driver'), true,
    '模板插值里的取值表达式被当成字面量抹掉了：那里面本来就可以是真实的值',
  );
});

test('判据自测：约束 1 要认得正则字面量（真实语料打穿过一次）', () => {
  /*
   * 这条钉的是**真实语料**：`review.ts` 里有 `/^\s*(```|~~~)/.test(line)`。
   * 第 4 版剥离器写完第一次跑就红在这里——正则里那三个反引号被当成模板起点，
   * 扫描跑偏一千多个字符，把后面一处真实的 locateSubject 调用一起吞掉。
   *
   * 它当时是**红**的，不是绿的：剥离器跑偏会让锚点数不够、实参块定位不到，
   * 配上 fail-closed 的 argBlockAt，这类错误只能往红的方向跑。本条把那次
   * 失败固化下来。
   */
  const real = 'if (/^\\s*(```|~~~)/.test(line)) { inFence = !inFence; }\nfoo(driver)';
  const s = stripNonCode(real);
  assert.ok(
    /foo\(driver\)/.test(s),
    '正则后面的真实代码被吞掉了：剥离器把正则里的反引号当成了模板起点',
  );

  // 除号不能被当成正则：`a / b` 之后的代码同样不能丢
  assert.ok(
    /bar\(driver\)/.test(stripNonCode('const r = a / b;\nbar(driver)')),
    '除号被当成了正则起点，后面的代码被吞掉',
  );

  // 正则**内部**的 driver 字样不得满足判据（与字符串同理）
  assert.equal(
    hasProperty(stripNonCode('x.replace(/driver/g, "")'), 'driver'), false,
    '正则里的 driver 被当成了真实传值',
  );
});

test('对账：两个入口的 --model-<id> 收集面都必须是 ALL_AGENT_IDS（第 3 轮 CODEX-03）', async () => {
  /*
   * 判定收口成一份（`assertModelOverrideKeys`）**不等于**这一族关掉了：
   * 上一版 `cli.ts` 的收集面是 `CRITICS`（已启用为审核者的那几家），
   * 而 `topic-args.ts` 是 `ALL_AGENT_IDS`（全部已登记）。于是「已登记但未启用为
   * 审核者」的 `--model-<id>` 在前者**根本进不了键集**，判定函数看不见它
   * → 不退 64、不留痕、不告警——正是 EV-53 原文的症状。
   *
   * **今天不可达**：四家全部启用，两个集合元素相同，所以把论域改回 `CRITICS`
   * 跑全量测试也是全绿的（我验过）。可达条件是「登记第五家而暂不启用它为审核者」，
   * 那时症状无声。所以这一格只能用扫描判据守——运行期用例构造不出来，
   * 除非把注册表也注入进 CLI，而 CLI 读的是模块级常量。
   *
   * 口径：**收集＝全部已登记，判定＝本轮实际能入选谁。**
   */
  for (const [file, anchor] of [
    ['src/trivium/cli.ts', /function collectModelOverrides\(/],
    ['src/trivium/topic-args.ts', /const written = /],
  ] as const) {
    const src = await stripped(file);
    const at = src.search(anchor);
    assert.ok(at >= 0, `${file} 里定位不到 --model-<id> 的收集处——锚点该跟着改了`);
    // 取到该语句/函数体结束为止，够覆盖循环本体
    const body = src.slice(at, at + 400);
    assert.match(
      body, /\bALL_AGENT_IDS\b/,
      `${file} 的 --model-<id> 收集面不是 ALL_AGENT_IDS。\n` +
        '  收集面窄于判定面时，「已登记但未启用为审核者」的那几个旗标会连判定都进不去——\n' +
        '  不退 64、不留痕、不告警，而这正是 EV-53 原文的症状。\n' +
        `  实际：${body.slice(0, 200)}`,
    );
    assert.doesNotMatch(
      body, /\bCRITICS\b/,
      `${file} 的收集面又读回 CRITICS 了：那是「已启用为审核者」的子集，不是「已登记」`,
    );
  }
});

test('判据自测：第 4 版手写词法器被打穿的七种形态，第 5 版逐条钉死', () => {
  /*
   * 第 3 轮三侧**各自**找出这些形态，我逐条复现后全部成立。把它们写成受测事实——
   * 「已知边界写在注释里不算护栏」这句是我上一轮自己写的，这次照办。
   *
   * 两组的判据方向不同，不要合并看：
   *   · 少剥组：那几处的 `/…/` 按文法**是正则**，正文必须被剥掉（留下即假绿）；
   *   · 多剥组：那几处的 `/` 按文法**是除号**，两侧的真代码必须原样留下（吞掉即假红）。
   */
  const cases: { what: string; src: string; driverStays: boolean; why: string }[] = [
    // ── 少剥组：旧版判成除号，正则正文原样留下 → 假绿 ──
    {
      what: ') 之后的正则', src: 'if (ok) /driver/.test(s);', driverStays: false,
      why: 'if 头的右括号之后是语句位置，那里的 /…/ 是正则；留下正文就能让 hasProperty 假命中',
    },
    {
      what: '} 之后的正则', src: 'if (x) { y(); }\n/driver/.test(s);', driverStays: false,
      why: '块结束之后新语句开始，同样是正则位置（旧版 REGEX_PREV 只含开括号）',
    },
    {
      what: 'throw 之后的正则', src: 'throw /driver/;', driverStays: false,
      why: 'throw 后面接表达式，是正则位置（旧版 REGEX_KEYWORD 漏了 throw）',
    },
    // ── 多剥组：旧版判成正则，把同行两个 / 之间的真代码整段吞掉 → 假红 ──
    {
      what: '后缀 ++ 之后的除号', src: 'const r = n++ / driver / 2;', driverStays: true,
      why: '旧版 prevSig 落在 + 上判成正则起点；这里的 driver 是真标识符，吞掉它是假红',
    },
    {
      what: 'TS 非空断言之后的除号', src: 'const r = obj.val! / driver / scale;', driverStays: true,
      why: '旧版 REGEX_PREV 含 !，把非空断言当成了逻辑非',
    },
    {
      what: '属性名撞关键字', src: 'const r = o.in / driver / 2;', driverStays: true,
      why: '旧版 REGEX_KEYWORD 的 [^\\w$] 会匹配成员访问的点号，把 o.in 当成 in 表达式',
    },
    // ── 模板插值：旧版只数裸花括号，字符串里的 } 会让插值提前闭合 ──
    {
      what: '模板插值里含花括号的字符串', src: 'log(`${fn("}")} driver`)', driverStays: false,
      why: '这里的 driver 在模板字面量正文里，不是传值；旧版插值提前闭合还会漏出花括号',
    },
  ];

  for (const c of cases) {
    const s = stripNonCode(c.src);
    assert.equal(
      hasProperty(s, 'driver'), c.driverStays,
      `${c.what}：${c.why}\n  原文：${c.src}\n  剥后：${JSON.stringify(s)}`,
    );
  }

  /*
   * 模板那条还要单独钉括号配平——旧版实测输出是 `log("<str>" {fn("<str>" )`，
   * **凭空多出一个左花括号**，而 argBlockAt 正是按花括号计深度的。
   */
  const tpl = stripNonCode('log(`${fn("}")} driver`)');
  assert.equal(
    (tpl.match(/\{/g) ?? []).length, (tpl.match(/\}/g) ?? []).length,
    `模板剥离后花括号不配平，argBlockAt 会被带偏：${JSON.stringify(tpl)}`,
  );

  /*
   * 反向锁一格：`arr[0]` 之后按文法就是除号，那里的 `driver` 是**真标识符**，
   * 必须留下。三侧的意见清单把它和 `)` / `}` 列在一起，照着写断言会写出一条错判据。
   */
  assert.equal(
    hasProperty(stripNonCode('const a = arr[0]\n/driver/.test(s);'), 'driver'), true,
    '] 之后是除号不是正则（操作数已完整），这里的 driver 是真标识符，剥掉它就是误判',
  );
});

test('判据自测：偏移量不变——剥离后的位置能直接拿去定位实参块', () => {
  /*
   * 第 5 版改成「逐字符置空」而不是「换成占位符」。这不只是实现细节：
   * 长度不变意味着锚点在剥离后文本里的下标与原文一致，`argBlockAt` 拿到的
   * 区间也就对得上原文——而且置空不会像占位符那样凭空造出括号或引号。
   */
  const src = 'const x = 1; /* driver */ foo({ a: 1, driver });\n';
  const s = stripNonCode(src);
  assert.equal(s.length, src.length, '剥离改变了长度，锚点下标不再能对回原文');
  assert.equal(s.split('\n').length, src.split('\n').length, '换行被吃掉了，行号对不回去');

  const at = s.indexOf('foo(');
  assert.equal(at, src.indexOf('foo('), '同一个调用点在剥离前后的下标不一致');
  const block = requireArgBlock(s, at + 'foo'.length, 'foo');
  assert.equal(block, '({ a: 1, driver })', `实参块取错：${JSON.stringify(block)}`);
});

test('判据自测：约束 2 的定位函数——括号配不平必须 fail-closed', () => {
  /*
   * 三条约束里，定位函数是**唯一一个从来没被自测碰过**的（第 2 轮 CODEX-02）。
   * 而它上一版的失效形态有后果：块一路吃到文件尾，`hasProperty` 随即在文件
   * 后半段命中同名标识符，判据安静变绿。
   */
  const balanced = 'f({ a: 1, driver })\nconst x = 1;';
  assert.equal(argBlockAt(balanced, 1), '({ a: 1, driver })', '正常闭合的块取错了');

  const unbalanced = 'f({ a: 1\nlet driver = 2;';
  assert.equal(
    argBlockAt(unbalanced, 1), null,
    '括号没配平时仍返回了内容——那正是「吃到文件尾再命中同名标识符」的假绿形态',
  );

  /*
   * 并且顺带钉死上一版守卫为什么是永绿的：回落返回 `src.slice(from)`，
   * 长度恒为 `src.length - from`，而 from > 0 恒真，所以
   * `block.length < src.length` 永远成立。把它写成断言，免得有人「优化」回去。
   */
  const from = 1;
  assert.ok(
    unbalanced.slice(from).length < unbalanced.length,
    '旧守卫 block.length < src.length 在回落分支上恒成立——这就是它抓不到自己的原因',
  );
});

/**
 * 全局调用计数对账：**新增的调用点必须当场显形**（第 2 轮 GLM-02②）。
 *
 * TARGETS 是一张**封闭世界**的表：锚点 + 期望条数只守「形状与今天一致」的调用点。
 * 新增一个调用点——新文件里的、或同文件里传预构造对象的（`resolveCriticSelection(cfg, opts)`
 * 不满足 `,\s*\{` 这个锚点）——**不改变任何计数，全绿放行**。
 * 而那恰恰是「实参经中间变量转手」会在新增侧发生的形态。
 *
 * 所以再加一层：全 `src/` 里该函数的真实调用点总数，必须等于 TARGETS 里为它写明的
 * 条数之和。论域升到全 `src`，与 `deny-matrix` 的「唯一调用计数」骨架同族。
 */
const RECONCILE: { fn: string; expect: number; note: string }[] = [
  { fn: 'newRunMeta', expect: 1, note: '留痕的发起方只该有一个写入点' },
  { fn: 'locateSubject', expect: 2, note: 'prepareRun 一处、resolvePlanFinal 一处（EV-210）；resolveTaskGoal 自 EV-212 起复用后者' },
  { fn: 'locateSubjectReadOnly', expect: 1, note: 'topic resolve 的只读定位' },
  { fn: 'resolveRerunIndex', expect: 2, note: 'review.ts 一处、cli.ts 闸门回落一处' },
  { fn: 'resolveCriticSelection', expect: 4, note: 'cmdReview / cmdPreflight / topic-args / review.ts 回落' },
];

test('调用链：全 src 的调用点总数必须与 TARGETS 对得上（新增调用点当场显形）', async () => {
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith('.ts')) files.push(p);
    }
  };
  await walk(path.join(REPO_ROOT, 'src'));
  assert.ok(files.length > 10, `src 下只扫到 ${files.length} 个 .ts，遍历写错了`);

  const bodies = await Promise.all(
    files.map(async (f) => stripNonCode(await fs.readFile(f, 'utf8'))),
  );

  for (const r of RECONCILE) {
    let calls = 0;
    for (const body of bodies) {
      // 调用点 = `名字(`，减去声明本身（`function 名字(`）。import 不带括号，天然不计
      calls += [...body.matchAll(new RegExp(`\\b${r.fn}\\s*\\(`, 'g'))].length;
      calls -= [...body.matchAll(new RegExp(`function\\s+${r.fn}\\s*\\(`, 'g'))].length;
    }
    /*
     * 用 `fn` 字段精确对账，**不是**拿 `anchor.source.includes(fn)` 去嗅——
     * 后者会把 `locateSubjectReadOnly` 的那条也算进 `locateSubject`
     * （前者的名字包含后者），两张表当场分叉。名字互为前缀这件事在本仓
     * 不是个例，判据不能靠子串。
     */
    const inTable = TARGETS.filter((t) => t.fn === r.fn).reduce((s, t) => s + t.count, 0);
    assert.equal(
      inTable, r.expect,
      `TARGETS 里为 ${r.fn} 写明的条数是 ${inTable}，与本表声明的 ${r.expect} 对不上——两张表分叉了`,
    );
    assert.equal(
      calls, r.expect,
      `全 src 里 ${r.fn} 的调用点有 ${calls} 处，而护栏只覆盖 ${r.expect} 处（${r.note}）。\n` +
        '  多出来的那处没有任何判据看着它传没传 driver——这正是「封闭世界」的盲区。\n' +
        '  请把新调用点补进 TARGETS（连同锚点与 why），不要直接改这里的期望值。',
    );
  }
});
