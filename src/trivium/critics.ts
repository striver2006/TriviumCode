/**
 * 「本轮跑哪几个审核者」的**唯一判定处**（设计 13.1.1 / FR-29，M7b 第 5 步）。
 *
 * 为什么单独成文件：这个判定有三个入口会用到——`topic resolve`（要当场指出拼错）、
 * `review --start`（真正据此冻结送审包）、以及 worker 的交接重建。把它实现两遍，
 * 就会重演 `--only` 那次的形态：两处校验不一致，启用第三家时一处先于另一处
 * 拒掉合法取值，而错误信息还振振有词地只列两家。
 *
 * 判定只依赖配置与注册表，不碰文件系统，可直接单测。
 */
import { CRITICS, type Config, type CriticId } from './types.js';
import { AGENTS, DEFAULT_DRIVER, agentById, type AgentDescriptor, type AgentId } from './agents/registry.js';
import { EXIT, TriviumError, swallowedTextHint } from './exit-codes.js';

export interface CriticSelectionInput {
  /** `--critics a,b` 的原始值（逗号分隔）。null / 空表示没给 */
  critics?: string | null;
  /** `--only x` 的原始值。**旧旗标，等价于只选一个** */
  only?: string | null;
  /** 当轮 Driver。默认取注册表缺省值（M7b 恒为 claude） */
  driver?: AgentId;
  /**
   * **测试注入口**：换一份 Agent 登记表来判定（M9 第 4 步）。生产恒不传。
   *
   * ## 为什么要开这个口
   *
   * 「已登记但尚未启用为审核者」那条分支的负例，此前靠
   * `ALL_AGENT_IDS.find(id => !criticEnabled)` 从**真实注册表**里现取一家未启用的。
   * M9 把第四家也启用之后取不到值，用例自己预告过这一天
   * （「四家全部启用时本用例失去意义，届时改用别的夹具」）——但它只写了 assert 消息，
   * 于是那天到来时是**静默失效**：注册表里恰好还有没启用的家，覆盖才存在。
   * **一条规则的负例覆盖，不该取决于生产数据碰巧长什么样。**
   *
   * ## 这不是「只为测试存在的注入口」
   *
   * `deriveDefaultCritics(agents, maxCritics)`（`agents/registry.ts`）是同一形态的
   * 既有先例，`registry-parity` 的四条用例正是靠换一份 agents 数组去测它的不变量。
   * 本参数与它同构：判定逻辑本就只依赖「登记表 + 配置」，把登记表参数化
   * 是把隐式的模块级依赖显式化，生产路径一个字不变。
   */
  descriptors?: readonly AgentDescriptor[];
}

/**
 * 合法取值的人读清单，进错误提示。
 *
 * **排除当轮 Driver**（审查意见 AGY-02）：M9 / M10 之后，担任 Driver 的 Agent
 * 完全可能同时具备审核者能力，那时「你不能选 Driver」的报错末尾又把它列进
 * 「当前可用」，就成了第一个错误把用户引向第二个错误——上一轮 GLM-04 的同形。
 *
 * **当轮 Driver 同时是可用审核者时，这层过滤才真正改变输出——M9 第 4 步翻开关后
 * 即为此形态**：实测 `--critics claude` 的报错里「当前可用」是 `codex | gemini | glm`，
 * 不含 claude。（上一版这里写的是「当前 claude 未进 `CRITICS`，这层过滤不改变任何
 * 现有输出」——那句话被翻开关这一步当场证伪，而它就在本函数的文档块里，
 * 是同一次改动的上下文行；代码双审 CODEX-05。）
 */
function legalList(cfg: Config, driver: AgentId, descriptors?: readonly AgentDescriptor[]): string {
  const usable = selectableCritics(cfg, driver, descriptors);
  return usable.length > 0 ? usable.join(' | ') : '（配置里没有任何可用审核者）';
}

/**
 * 本轮**实际能入选**的审核者 —— 启用集合 ∩ 有配置条目 − 当轮 Driver。
 *
 * ## 为什么要有这个导出（M9 第 5 步，EV-53）
 *
 * 这份论域此前有**两套实现**：本文件的 `legalList` 减 Driver，而 `topic-args.ts`
 * 的 `--model-<id>` 白名单读模块级 `CRITICS` **全集、不减**。M9 第 4 步把 claude
 * 启用为审核者之后，`--model-claude X` 在那边合法通过，却被这边的「当轮 Driver
 * 不得入选」恒拒——用户显式指定的模型一路走到被丢弃，**留痕里看不出他指定过**。
 *
 * 第 5 步把 driver 接进选侧之后，两套论域会在**同一条命令**里给出互相矛盾的
 * 「当前可用」。所以这里不是「顺手抽个函数」：把两处合到一个派生上，
 * 才是让「谁能入选」只有一个答案。**抄一份 filter 过去只会把今天的缺口
 * 原样复制到明天**——那正是本文件开头那段文档在讲的事。
 *
 * **论域跟着注入表走**（计划双审 GLM-05）：判定读注入表而报错读真实注册表时，
 * 「当前可用」会与本次判定实际采信的论域对不上——第一个错误把用户引向第二个错误。
 */
export function selectableCritics(
  cfg: Config,
  driver: AgentId = DEFAULT_DRIVER,
  descriptors?: readonly AgentDescriptor[],
): CriticId[] {
  const enabled = descriptors
    ? descriptors.filter((a) => a.criticEnabled).map((a) => a.id)
    : CRITICS;
  return enabled.filter(
    (c) => cfg.agents[c as CriticId] !== undefined && c !== driver,
  ) as CriticId[];
}

/**
 * `--model-<id>` 的键必须是**本轮实际能入选的审核者**（EV-53）。
 *
 * ## 为什么判定在这里，而不是在两个入口各写一遍
 *
 * EV-53 第一次收口时只改了 `topic resolve`（`topic-args.ts`），`review --start`
 * 那条路原样留着——而后者才是**真正烧配额**的入口：`collectModelOverrides` 的论域是
 * `CRITICS`（启用全集，M9 第 4 步之后四家都在内），下游 `checkModelSlugs` 只遍历
 * **入选侧**，于是「为本轮当不了审核者的一家指定模型」在那条路上仍是
 * **解析成功后被悄悄丢弃**，run.json 与告警里都不留痕——正是 EV-53 原文的症状。
 * 技能侧因为先走 `topic resolve` 被挡住了，暴露面是手工 CLI，但台账上那句
 * 「EV-53 已收口」当时并不成立（第 2 轮代码双审 CODEX-05）。
 *
 * 这与 `--only` 那次、以及 `resolveCriticSelection` 本身是同一条教训：
 * **同一个判定有两个入口时，判定必须只有一份。** 所以它和 `legalList`、
 * `resolveCriticSelection` 一起放在本文件，共用 `selectableCritics` 这一份派生。
 *
 * 错误文案一律走 `legalList`，因此与「不能选 Driver」那几条报错逐字同词
 * （都是「当前可用」）——此前 `topic-args.ts` 那处自己拼了一句「本轮可用」，
 * 同一论域两层措辞分叉，而集成用例正拿「当前可用」当锚点截字符串
 * （第 2 轮 GLM-03）。
 *
 * ## 判据是「本轮**实际**入选了谁」，不只是「能入选谁」（M10b 第 2 步代码双审 CODEX-02，收 EV-67）
 *
 * EV-53 收口时判据只到 `selectableCritics`（能力面），而消费点只遍历**入选侧**——
 * 「能入选、这一轮没入选」的那一家，覆盖照样解析成功后被丢弃（`--critics gemini --model-glm X`）。
 * 当时刻意推迟（收紧是行为变化）；M10b 第 2 步把缺省集合改成「减去当轮 Driver」之后，
 * 这一格在非 claude Driver 的**缺省路径**上成了常规形态：三家入口资产的参数写法行
 * 列着 `--model-claude`，照写就被静默吞掉。于是收紧到 `picked`：三个调用点在此之前
 * 都已解析好入选集合，判定点手边就有。
 *
 * 两种拒绝分开措辞：当不了审核者（Driver / 未启用）列「当前可用」；能当、但本轮没选它，
 * 列「本轮入选」并指出怎么把它加进来——两者的出口不同，混成一句会把用户引错方向。
 *
 * @param ids 用户实际写出来的 `--model-<id>` 里的 `<id>`，不含没写的
 * @param picked 本轮入选的审核者（`resolveCriticSelection` 的结果）
 */
export function assertModelOverrideKeys(
  cfg: Config,
  driver: AgentId,
  ids: readonly string[],
  picked: readonly string[],
  descriptors?: readonly AgentDescriptor[],
): void {
  assertCriticFlagKeys(cfg, driver, ids, picked, 'model', descriptors);
}

/**
 * 逐审核者旗标（`--〈前缀〉-〈id〉`）的键判定，**`--model-〈id〉` 与 M11 第 5 步的 `--tier-〈id〉` /
 * `--effort-〈id〉` / `--profile-〈id〉` 共用这一份**（同一判定只有一处，EV-53 的教训）。
 * 判据与两种措辞见 `assertModelOverrideKeys` 的文档块；`model` 前缀的文案逐字不变（集成用例截「当前可用」）。
 */
export type CriticFlagPrefix = 'model' | 'tier' | 'effort' | 'profile' | 'native';
const FLAG_NOUN: Record<CriticFlagPrefix, string> = { model: '模型', tier: '档位', effort: '思考等级', profile: '厂商 profile', native: '官方模式' };

export function assertCriticFlagKeys(
  cfg: Config,
  driver: AgentId,
  ids: readonly string[],
  picked: readonly string[],
  prefix: CriticFlagPrefix,
  descriptors?: readonly AgentDescriptor[],
): void {
  const noun = FLAG_NOUN[prefix];
  const selectable = selectableCritics(cfg, driver, descriptors) as readonly string[];
  for (const id of ids) {
    if (picked.includes(id)) continue;
    if (selectable.includes(id)) {
      throw new TriviumError(
        EXIT.USAGE,
        `--${prefix}-${id}：${id} 本轮没有入选，为它指定的${noun}不会生效。\n` +
          `  本轮入选：${picked.join(' | ')}\n` +
          `  要让它参审，请用 --critics 把它列进来；否则去掉这个旗标。`,
      );
    }
    const why =
      id === driver
        ? '它是本轮的 Driver（执笔者），不能同时充当审核者'
        : `${id} 本轮不是可用审核者`;
    throw new TriviumError(
      EXIT.USAGE,
      `--${prefix}-${id}：${why}，不能为它指定${noun}。\n` +
        `  当前可用：${legalList(cfg, driver, descriptors)}`,
    );
  }
}

/** `resolveDriver` 的结果：当轮 Driver，以及它是否已被启用为 Driver */
export interface DriverResolution {
  driver: AgentId;
  /**
   * 该 Agent 的 `driverEnabled`。**经本函数返回的值恒为 true**——未启用即退 64（见下）。
   *
   * 字段保留是为留痕契约：`run.json` 与 `topic resolve` JSON 的 `driver_enabled`
   * 都由它取值，而 M9 第 5 步到 M10a 第 2 步之间的归档里有 `driver_enabled: false`
   * 的合法留痕（那时的口径是「放行 + 如实标注」）。字段一删，读写两侧的契约就断了。
   */
  enabledAsDriver: boolean;
}

/**
 * 解析 `--driver` 的取值（M9 第 5 步；M10a 第 3 步收紧）。
 *
 * **判定只此一处**。经它的入口：`review --start`（显式旗标，以及继承判定之后按最终
 * driver 的再解析）、`preflight`、`topic resolve`（同两格）、`topic claim`。
 * 同一条校验实现两遍就是改一漏二——`--only` 那次已经演过一回。
 *
 * ## 未启用为 Driver ⇒ 退 64（M10a 第 3 步，M10 计划 r7 §4.2 / §9 A4）
 *
 * M9 这里是「放行 + 如实标注」：校验 `driverEnabled` 会让 M9 第 6 步验收跑不成
 * （那时只有 claude 启用）。四家翻开之后该分支**对现注册表不可达**，保留它是为
 * **第五家登记而未启用**的那一格；覆盖靠 `descriptors` 注入的桩，不靠生产数据碰巧长什么样。
 * 方向是收紧不是放开。缺省分支（没传旗标）走**同一个判定**，不写死 true。
 *
 * **这条收紧只作用于经本函数的入口，不是全称保证。** 不经它、也不校验
 * `driverEnabled` 的面：`prepareRun` 内查表（只用于留痕）、Hook 的当轮 Driver 解析
 * （读 run.json 与 claim 声明）、历史 run.json、手工改写的 claim 声明。
 * 它们依赖的是「入口已经拦过」，自身不做判定。
 *
 * ## 报错清单的口径：「可用作 Driver」，两个分支一致（计划 r3 §2.2）
 *
 * 未登记与未启用两个分支，尾部都列 `driverEnabled` 为真的那几家——报错列出的
 * 可用值必须与实际接受的取值一致，否则第一个错误把用户引向第二个错误
 * （M9 时这里列的是「全部已登记」，因为那时判据就是「已登记」）。
 * **不复用 `legalList`**：那是审核者口径（criticEnabled ∩ 有配置段 − 当轮 Driver），
 * 今天四家两口径同集，第五家只当 Driver 或没有配置段时就会分叉（计划双审 r1 CODEX-03）。
 *
 * `descriptors` 是与 {@link CriticSelectionInput.descriptors} 同构的测试注入口。
 */
export function resolveDriver(
  raw: string | null | undefined,
  descriptors?: readonly AgentDescriptor[],
): DriverResolution {
  const table = descriptors ?? AGENTS;
  const lookup = (x: string): AgentDescriptor | null =>
    descriptors ? (descriptors.find((a) => a.id === x) ?? null) : agentById(x);
  const usable = (): string => {
    const ids = table.filter((a) => a.driverEnabled).map((a) => a.id);
    return ids.length > 0 ? ids.join(' | ') : '（没有任何已启用为 Driver 的 Agent）';
  };

  const given = raw?.trim() ?? '';
  const id = given || DEFAULT_DRIVER;
  const agent = lookup(id);
  if (!agent) {
    throw new TriviumError(
      EXIT.USAGE,
      `${given ? '--driver 的取值' : '缺省 Driver'}「${id}」不是已登记的 Agent。\n` +
        `  可用作 Driver：${usable()}` +
        swallowedTextHint(id),
    );
  }
  if (!agent.driverEnabled) {
    /*
     * 措辞中性，不说「--driver 的取值」：继承来的 driver（运行留痕或 claim 声明）
     * 同样经过这里，用户可能根本没传旗标；缺省分支同理。
     */
    throw new TriviumError(
      EXIT.USAGE,
      `Driver「${agent.id}」已登记但尚未启用为 Driver${given ? '' : '（未传 --driver，取的是缺省 Driver）'}。\n` +
        `  可用作 Driver：${usable()}`,
    );
  }
  return { driver: agent.id, enabledAsDriver: agent.driverEnabled };
}

/**
 * 解析并校验本轮入选的审核者集合。
 *
 * 优先级：`--critics` > `--only`（旧别名）> `review.default_critics`。
 * 任何一条校验不过都抛 `EXIT.USAGE`（退 64）——**在产生任何工件之前**失败，
 * 这是设计 §12 对参数错误的一贯要求。
 */
export function resolveCriticSelection(cfg: Config, input: CriticSelectionInput = {}): CriticId[] {
  const driver = input.driver ?? DEFAULT_DRIVER;
  const lookup = (id: string): AgentDescriptor | null =>
    input.descriptors ? (input.descriptors.find((a) => a.id === id) ?? null) : agentById(id);
  const criticsRaw = input.critics?.trim() ?? '';
  const onlyRaw = input.only?.trim() ?? '';

  /*
   * 两个旗标同时给：**报错，不做优先级静默取舍**。
   *
   * `--only` 是 `--critics` 的单元素特例，同时出现要么是复制粘贴残留、
   * 要么是用户以为它们能叠加。任选其一执行都会让另一个意图无声消失——
   * 而「静默忽略用户显式写下的参数」正是这一族缺口最常见的形态。
   */
  if (criticsRaw && onlyRaw) {
    throw new TriviumError(
      EXIT.USAGE,
      `--critics 与 --only 不能同时给：前者是后者的推广形式。\n` +
        `  只想跑一侧就写 --critics ${onlyRaw}；收到 --critics ${criticsRaw} 与 --only ${onlyRaw}`,
    );
  }

  let picked: string[];
  let source: string;
  if (criticsRaw) {
    picked = criticsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    source = '--critics';
  } else if (onlyRaw) {
    picked = [onlyRaw];
    source = '--only';
  } else {
    /*
     * **缺省集合先减去当轮 Driver**（M10b 第 2 步，用户 2026-09-25 拍板；计划 r11）。
     *
     * 缺省集合是「不指定时跑谁」，写它的人写的是「平时的审核者」，不是「这一轮除了执笔者之外的」——
     * 而 codex / gemini / glm 三家既在缺省集合里、又都能当 Driver。此前这一格一律退 64：
     * B / C / D 还能显式传 `--critics` 绕开，**命令 A 当时不收 `--critics`，根本没有出口**
     * （EV-125 起命令 A 也收 `--critics`，本条的缺省减 Driver 照旧保留：不写 `--critics` 时仍走这里）。
     * 这条路径改前恒退 64，改后放行不会改变任何今天能跑通的流程；claude 当 Driver 时缺省集合里本就没有它。
     *
     * 只减缺省、不减显式：用户**亲手写下**的 `--critics` / `--only` 含 Driver 仍退 64（下面那条检查）——
     * 那是明确的自审意图，静默去掉就是「错的消失」。减完为空，落到下面「空集合」那条报错。
     */
    picked = cfg.review.default_critics.filter((id) => id !== driver);
    source = 'review.default_critics';
  }

  if (picked.length === 0) {
    throw new TriviumError(
      EXIT.USAGE,
      `${source} 解析后是空集合：一次审查至少要有一个审核者。\n  可用：${legalList(cfg, driver, input.descriptors)}`,
    );
  }

  /*
   * 重复项**报错而不是去重**。
   *
   * `--critics gemini,gemini` 几乎必然是笔误（想写另一家却手滑）。静默去重会把它
   * 变成一次单侧审查，而用户以为自己要了两侧——留痕上还看不出异常。
   * 宁可让他重打一次。
   */
  const seen = new Set<string>();
  for (const id of picked) {
    if (seen.has(id)) {
      throw new TriviumError(
        EXIT.USAGE,
        `${source} 里「${id}」出现了多次。一侧只会跑一次，重复多半是笔误——` +
          '静默去重会把它悄悄变成更少的侧数，所以这里直接报错。\n' +
          `  当前可用：${legalList(cfg, driver, input.descriptors)}`,
      );
    }
    seen.add(id);
  }

  for (const id of picked) {
    const agent = lookup(id);
    if (!agent) {
      throw new TriviumError(
        EXIT.USAGE,
        `${source} 含未登记的 Agent「${id}」。可用：${legalList(cfg, driver, input.descriptors)}` + swallowedTextHint(id),
      );
    }
    /*
     * 当轮 Driver 不能同时当审核者（设计 §12 异常矩阵首行）。
     *
     * M7b 下 claude 的 `criticEnabled` 为 false，下面那条检查已经顺带挡住它；
     * 但 M9 启用 claude 为审核者之后就挡不住了，那时**自己审自己**会悄悄通过——
     * 而那恰恰是这整套流水线要防的第一件事（P1：独立二次审查）。
     * 所以这条要独立存在，不能依赖 `criticEnabled` 顺带生效。
     */
    if (id === driver) {
      throw new TriviumError(
        EXIT.USAGE,
        `${source} 含当轮 Driver「${id}」：它是本次运行的执笔者，不能同时充当独立审查员。\n` +
          '  自己审自己不构成二次审查——这条流水线存在的理由就是避免它。\n' +
          `  当前可用：${legalList(cfg, driver, input.descriptors)}`,
      );
    }
    if (!agent.criticEnabled) {
      throw new TriviumError(
        EXIT.USAGE,
        `${source} 的「${id}」已登记但尚未启用为审核者（适配器随后续里程碑接入）。\n` +
          `  当前可用：${legalList(cfg, driver, input.descriptors)}`,
      );
    }
    /*
     * 入选审核者必须在 `agents` 段里有条目——这是**统一的前置条件**，
     * 不是「要从那里取调用参数」（审查意见 GLM-06）。
     *
     * 原文案写的是「无法取到它的调用参数」。对 antigravity 形状那是实话
     * （`agent` 与 `effort` 确实只在那里），但 M7b 第 6 步的桩实测撞出来的形态恰恰是
     * **段里只有 vendor 判别式、没有任何调用参数**——照原文案去排障，
     * 人会去找一个根本不存在的东西。「第一个错误不得把用户引向第二个错误」。
     *
     * 这条校验真正的价值是把「配置缺段」从运行中段提前到参数解析时刻（零工件、退 64），
     * 并让 `legalList` 的「可用」有单一判据。
     */
    if (cfg.agents[id as CriticId] === undefined) {
      throw new TriviumError(
        EXIT.USAGE,
        `${source} 的「${id}」在配置的 agents 段里没有条目。\n` +
          '  入选审核者必须在 agents 段有条目（统一前置条件；antigravity 形状另需从这里取 agent 与 effort）。\n' +
          `  当前可用：${legalList(cfg, driver, input.descriptors)}`,
      );
    }
  }

  const max = cfg.review.max_critics;
  if (picked.length > max) {
    throw new TriviumError(
      EXIT.USAGE,
      `${source} 选了 ${picked.length} 个审核者，超过 review.max_critics=${max}。`,
    );
  }

  return picked as CriticId[];
}
