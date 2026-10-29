# sum 输入校验实施计划（原稿 · 第 1 轮）

## 1. 目标与范围

为 `src/sum.cjs` 的 `sum(a, b)` 实现输入校验，满足 requirements.md 全部需求分支：

- 两个入参都必须是 number 类型且为有限值（`Number.isFinite`）；
- 拒绝字符串、NaN、Infinity、-Infinity：抛出带说明的 `TypeError`；
- 允许负数与小数；
- 校验失败不得返回数值结果（即必须先校验后相加，校验失败立即抛异常）。

范围仅限 `src/sum.cjs`（实现）与 `test/sum.test.cjs`（测试），不改其他文件。

## 2. 现状分析

- `src/sum.cjs` 目前只做 `return a + b;`，无校验；
- `test/sum.test.cjs` 仅覆盖两个正常用例（1+2=3、10+32=42），无校验相关用例；
- 运行方式：`node --test test/sum.test.cjs`。

## 3. 实施步骤

1. 修改 `src/sum.cjs`：
   - 在函数入口对每个参数做类型 + 有限性校验：`typeof a !== 'number' || !Number.isFinite(a)`（b 同理）；
   - 校验失败抛出 `TypeError`，消息带参数名与说明，如 `` `sum: 第 1 个参数必须是有限 number，收到 ${String(a)}` ``；
   - 校验全部通过后返回 `a + b`；
   - 保持 CommonJS 导出 `{ sum }` 与 `'use strict'` 不变。
2. 扩充 `test/sum.test.cjs` 测试矩阵：
   - 正常值：正整数（沿用现有 2 例）、负数、小数（如 `sum(-1, -2) === -3`、`sum(0.1, 0.2)` 用 `assert.ok(Math.abs(r - 0.3) < 1e-12)` 或 `assert.equal(r.toFixed(10), (0.3).toFixed(10))` 处理浮点误差）；零与负数零；
   - 非法类型：字符串（`'1'`、`'a'`）、`undefined`、`null`、对象、布尔值 → 断言抛出 `TypeError`；
   - 非有限值：`NaN`、`Infinity`、`-Infinity` → 断言抛出 `TypeError`；
   - 对每个非法用例同时断言抛出的错误 `instanceof TypeError` 且消息非空。
3. 验证：
   - `node --test test/sum.test.cjs` 全部通过；
   - 手动冒烟：`node -e "console.log(require('./src/sum.cjs').sum(1, 2))"` 输出 3；
   - 手动冒烟：`node -e "require('./src/sum.cjs').sum('1', 2)"` 抛 TypeError。

## 4. 测试策略

- 框架：`node:test` + `node:assert/strict`（与现状一致，不引入依赖）；
- 非法输入用 `assert.throws(fn, TypeError)` 断言异常类型；
- 浮点断言避免直接 `assert.equal(0.1 + 0.2, 0.3)`，改用容差比较；
- 验收标准对齐 task.md：正常值／负数／小数／字符串／NaN／Infinity 六个分支全部有对应测试。

## 5. 风险与回退

- 风险：浮点用例写法不当导致假失败——用容差比较规避；
- 风险：错误消息格式变更影响断言——测试只断类型与「消息非空」，不断具体文案；
- 回退：`git checkout -- src/sum.cjs test/sum.test.cjs` 即可回到初始实现。

## 6. 涉及文件

- `src/sum.cjs`
- `test/sum.test.cjs`
- 参考：`requirements.md`、`README.md`、`task.md`
