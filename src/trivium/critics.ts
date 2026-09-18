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
import { DEFAULT_DRIVER, agentById, type AgentDescriptor, type AgentId } from './agents/registry.js';
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
function legalList(cfg: Config, driver?: AgentId, descriptors?: readonly AgentDescriptor[]): string {
  /*
   * **论域跟着注入表走**（计划双审 GLM-05）。
   *
   * 这里此前读的是模块级 `CRITICS`，而判定读的是注入表。两者不一致时，
   * 报错会按真实注册表列出「当前可用」，与本次判定实际采信的论域对不上——
   * 「第一个错误把用户引向第二个错误」，正是本文件自己立规矩要防的形态。
   * 夹具语境下它同样有害：排障的人会照着一个错误的清单找问题。
   */
  const enabled = descriptors
    ? descriptors.filter((a) => a.criticEnabled).map((a) => a.id)
    : CRITICS;
  const usable = enabled.filter(
    (c) => cfg.agents[c as CriticId] !== undefined && c !== driver,
  );
  return usable.length > 0 ? usable.join(' | ') : '（配置里没有任何可用审核者）';
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
    picked = [...cfg.review.default_critics];
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
