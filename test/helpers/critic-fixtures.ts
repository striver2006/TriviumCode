/**
 * 「审核者集合」类用例的共享夹具（M9 第 4 步，计划双审 GLM-04 + AGY-03）。
 *
 * ## 为什么需要它
 *
 * 多条用例要取「随便一个合法审核者」。此前的写法是 `CRITICS[0]`——
 * 那个下标里藏着一个**没写出来的前提**：「注册表第一家恰好不是 Driver」。
 * M9 翻开 claude 的 `criticEnabled` 之后前提失效（注册表顺序是 claude 打头），
 * 九条用例同时红，而红的理由与用例本身要测的东西毫无关系。
 *
 * **修法不是把 `CRITICS[0]` 换成 `CRITICS[1]`**——那只是把同一个隐式前提
 * 挪到下一个下标上，注册表一重排又红，且红法一模一样。修法是**把前提写成代码**。
 *
 * ## 一处定义，两个文件导入
 *
 * `critics.test.ts` 与 `topic-args.test.ts` 都要它。各写一份会让两份同义派生
 * 各自漂移（M10 按「当轮 Driver」重定义时改一处漏一处），而那正是本项目
 * 反复反对的「同一事实两处手写」。
 *
 * ## 一条自觉的取舍
 *
 * 本夹具把「Driver 不得入选」这条**生产规则**编进了测试侧。代价是：
 * 若该规则的实现错了（比如漏掉排除），夹具会跟着一起错、用例照样绿。
 *
 * 这个代价是**有意接受**的，因为该规则另有**两条**独立的负例看着，都不经本夹具：
 *   · `critics.test.ts`「含当轮 Driver → 退 64」（走缺省 Driver 路径）；
 *   · 同文件「Driver 检查不依赖 `criticEnabled` 顺带生效」（显式传 `driver` 参数）。
 * 两条都直接断言 `resolveCriticSelection` 会拒，删掉生产侧的排除检查即当场红。
 *
 * **下面的 `assertSelectableUsable()` 不算第三条**（代码双审 GLM-02）：
 * 它的断言体只有 `SELECTABLE.length >= min`，**既不看那条生产规则**
 * （Driver 排除被删掉它照样绿），**也不在本夹具之外**（就定义在同一个文件里）。
 * 它守的是夹具自身的前提，不是被编进夹具的那条规则。
 * 上一版把它算作第三重锚——锚数虚报会让下一个人低估真实的安全余量，
 * 而这段注释的全部意义就是论证「代价可接受」。
 *
 * 备选方案（硬写 `['codex','gemini','glm']` 再配一条对账断言）反而是
 * `registry-parity` 明确反对的**第二事实源**形态。
 */
import assert from 'node:assert/strict';
import { CRITICS, type CriticId } from '../../src/trivium/types.js';
import { DEFAULT_DRIVER } from '../../src/trivium/agents/registry.js';

/**
 * 本轮**可真正入选**的审核者 —— 启用集合减缺省 Driver。
 *
 * 用例里凡是需要「一个合法审核者」的地方一律取这里，**不要再用 `CRITICS[0]`**。
 *
 * M10 放开 `--driver` 之后，这里的 `DEFAULT_DRIVER` 要改成「当轮 Driver」，
 * 届时**只改这一处**。
 */
export const SELECTABLE: readonly CriticId[] = CRITICS.filter((c) => c !== DEFAULT_DRIVER);

/**
 * 断言夹具前提仍然成立。**在用到 `SELECTABLE` 的用例开头调用。**
 *
 * `min` 默认 1；需要多选的用例传 2。
 *
 * 前提破裂时（比如某天只剩一家非 Driver 审核者）要红在这里、并说清
 * **该改夹具而不是改用例**——否则下一个人会看到一堆「断言值对不上」的失败，
 * 顺手把断言改宽，把覆盖面一起改没了。上一版夹具（`ALL_AGENT_IDS.find(未启用)`）
 * 自己预告过这一天却没有断言，于是 M9 翻开关时它是**静默**失效的。
 */
export function assertSelectableUsable(min = 1): void {
  assert.ok(
    SELECTABLE.length >= min,
    `夹具前提失效：可入选审核者只剩 ${SELECTABLE.length} 家（需要 ${min}），` +
      `启用集合=${CRITICS.join('、')}、缺省 Driver=${DEFAULT_DRIVER}。\n` +
      '  请改夹具（换一个当轮 Driver，或补一家审核者），不要改用例的断言。',
  );
}
