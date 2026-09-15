/**
 * `bashStillDenied`：zcode 侧 `command_texts` 恒记空数组的**前提**。
 *
 * ## 为什么单列一个文件
 *
 * r1 双审 GLM-05 指出，原来那里写的是纯注释约定：
 *
 * > 若哪天 `readonly_flags` 放开了 `Bash`，这一行要跟着改成真提取
 *
 * 我把它换成了运行期断言。**然后变异验证发现那个断言本身没有测试守着**
 * ——把判据改成恒真，1013 条全绿。
 *
 * 这是同一步里第二次撞上同一个形状（第一次是 `judgeSide` 的接线）：
 * **加了守卫不等于守卫被守着**。判据函数要有自己的用例，
 * 否则它和它替换掉的那条注释一样，只是看起来更像机制。
 *
 * ## 第三次同形状：守卫被守着，也不等于守对了东西
 *
 * r5 GLM-05：这里原先**全部用字面量镜像串**，而适配器把 `probe.readonly_flags`
 * 喂了进去——那是探针候选串的「被接受」记录，与实际递给 CLI 的 argv 是两个源。
 * 于是从 `ZCODE_READONLY_DENYLIST` 里删掉 `Bash`，探针记录不变、这一整个文件全绿、
 * 断言照旧通过，而措施 b 在该侧已经死了——正是这守卫号称要拦的那个场景。
 *
 * 所以除了判据本身的用例，还必须有一条**咬住真实常量**的断言（见文件末尾）：
 * 镜像串守的是判据，真常量守的是前提。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bashStillDenied,
  readonlyArgsFromProbe,
  ZCODE_READONLY_DENYLIST,
} from '../../src/trivium/adapters/zcode.js';

test('本机实测的只读组合里 Bash 被禁 —— 前提成立', () => {
  // M0 的 C-10：`--mode plan` 单独不够，denylist 必须含 Bash
  assert.equal(
    bashStillDenied(['--mode plan', '--mode yolo', '--disallowed-tools Write,Edit,MultiEdit,ApplyPatch,Bash']),
    true,
  );
});

test('denylist 里没有 Bash 时，前提不成立', () => {
  assert.equal(bashStillDenied(['--mode plan', '--disallowed-tools Write,Edit']), false);
  assert.equal(bashStillDenied([]), false, '空组合谈不上「禁了 Bash」');
});

test('按词判定，不被兄弟工具名蒙混', () => {
  /*
   * `includes('Bash')` 会被 `BashOutput` 这类名字骗过去——那是**另一个工具**，
   * 禁了它不等于禁了 `Bash`。判据一旦被蒙混，`command_texts` 恒空的前提就是假的，
   * 而措施 b 会在该侧静默失效：命令照跑、扫描面却是空的。
   */
  assert.equal(bashStillDenied(['--disallowed-tools BashOutput']), false);
  assert.equal(bashStillDenied(['--disallowed-tools NotBash']), false);
  assert.equal(bashStillDenied(['--disallowed-tools Bash']), true);
});

test('各种分隔写法都认得出', () => {
  assert.equal(bashStillDenied(['--disallowed-tools "Write Bash Edit"']), true, '空格分隔');
  assert.equal(bashStillDenied(['--disallowed-tools Write,Bash,Edit']), true, '逗号分隔');
  assert.equal(bashStillDenied(["--disallowed-tools 'Bash'"]), true, '单引号包裹');
});

test('等号形式的长参数也认得出', () => {
  /*
   * r2 双审 AGY-04：`=` 原先不在前置边界集里，`--disallowed-tools=Bash` **认不出**
   * → `command_texts` 的恒空前提被判为不成立 → 抛错中断正常审查流程。
   *
   * **而 `=Write,Bash` 因逗号边界侥幸认得出**——这种侥幸比全错更危险：
   * 它让缺陷只在一半样本上现形，凭「试了一个没问题」很容易放过去。
   */
  assert.equal(bashStillDenied(['--disallowed-tools=Bash']), true, '等号紧邻');
  assert.equal(bashStillDenied(['--disallowed-tools=Write,Bash']), true, '等号 + 逗号');
  assert.equal(bashStillDenied(['--disallowed-tools=BashOutput']), false, '等号也不该被兄弟名蒙混');
});

test('咬住真实常量：denylist 本身含 Bash —— 前提的落点，不是镜像串', () => {
  /*
   * 上面所有用例传的都是**手写的镜像串**：它们守住的是「判据认不认得出 Bash」，
   * 守不住「实际递出去的那串里到底有没有 Bash」。
   * 这一条直接咬 `ZCODE_READONLY_DENYLIST`——有人把 Bash 从常量里删掉，
   * 这里当场红，而不是等措施 b 在生产里静默失效（r5 GLM-05）。
   */
  assert.equal(bashStillDenied([ZCODE_READONLY_DENYLIST]), true);
});

test('咬住真实构造：适配器实际喂给断言的那串 argv 里，Bash 被禁', () => {
  /*
   * 更进一步：适配器喂的不是常量本身，是 `readonlyArgsFromProbe` 的返回值。
   * 这一条把「探针接受了 --disallowed-tools」→「argv 里真带上完整 denylist」
   * 这段接线也纳入断言面。
   */
  const args = readonlyArgsFromProbe(['--mode plan', '--disallowed-tools Write,Edit,MultiEdit,ApplyPatch,Bash']);
  assert.equal(bashStillDenied(args), true);

  /*
   * 反向：探针没实测到 `--disallowed-tools` 被接受时，argv 里压根没有 denylist，
   * 此时「该侧跑不了命令」的前提**不成立**，断言必须判否。
   * （上游 `checkReady` 已经硬拦了这种探针结论，这里守的是万一那道拦截被放宽。）
   */
  assert.equal(bashStillDenied(readonlyArgsFromProbe(['--mode plan'])), false);
});
