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
import { DEFAULT_DRIVER, agentById, type AgentId } from './agents/registry.js';
import { EXIT, TriviumError, swallowedTextHint } from './exit-codes.js';

export interface CriticSelectionInput {
  /** `--critics a,b` 的原始值（逗号分隔）。null / 空表示没给 */
  critics?: string | null;
  /** `--only x` 的原始值。**旧旗标，等价于只选一个** */
  only?: string | null;
  /** 当轮 Driver。默认取注册表缺省值（M7b 恒为 claude） */
  driver?: AgentId;
}

/**
 * 合法取值的人读清单，进错误提示。
 *
 * **排除当轮 Driver**（审查意见 AGY-02）：M9 / M10 之后，担任 Driver 的 Agent
 * 完全可能同时具备审核者能力，那时「你不能选 Driver」的报错末尾又把它列进
 * 「当前可用」，就成了第一个错误把用户引向第二个错误——上一轮 GLM-04 的同形。
 * 当前 claude 未进 `CRITICS`，这层过滤不改变任何现有输出。
 */
function legalList(cfg: Config, driver?: AgentId): string {
  const usable = CRITICS.filter((c) => cfg.agents[c] !== undefined && c !== driver);
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
      `${source} 解析后是空集合：一次审查至少要有一个审核者。\n  可用：${legalList(cfg, driver)}`,
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
          `  当前可用：${legalList(cfg, driver)}`,
      );
    }
    seen.add(id);
  }

  for (const id of picked) {
    const agent = agentById(id);
    if (!agent) {
      throw new TriviumError(
        EXIT.USAGE,
        `${source} 含未登记的 Agent「${id}」。可用：${legalList(cfg, driver)}` + swallowedTextHint(id),
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
          `  当前可用：${legalList(cfg, driver)}`,
      );
    }
    if (!agent.criticEnabled) {
      throw new TriviumError(
        EXIT.USAGE,
        `${source} 的「${id}」已登记但尚未启用为审核者（适配器随后续里程碑接入）。\n` +
          `  当前可用：${legalList(cfg, driver)}`,
      );
    }
    if (cfg.agents[id as CriticId] === undefined) {
      throw new TriviumError(
        EXIT.USAGE,
        `${source} 的「${id}」在配置的 agents 段里没有条目，无法取到它的调用参数。\n` +
          `  当前可用：${legalList(cfg, driver)}`,
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
