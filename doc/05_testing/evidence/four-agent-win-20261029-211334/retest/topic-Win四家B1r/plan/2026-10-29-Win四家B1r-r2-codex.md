# sum 输入校验实施计划（r2 · 第 2 轮定稿）

## 相对上一轮的改动

本轮接受审查者 claude 的全部 4 条意见（详见 `2026-10-29-Win四家B1r-revised-codex.md`）：

- **CLAUDE-01**（接受）：测试矩阵维度从「按值类型列举」改为「非法值 × 参数位」二维覆盖，每类非法值各有 `sum(非法, 合法)` 与 `sum(合法, 非法)` 断言（§3.2）；冒烟补充 b 位非法用例（§3.3）。
- **CLAUDE-02**（接受）：带符号零用例写死断言形式，禁用裸 `assert.equal` 比较 ±0（§3.2、§4）。
- **CLAUDE-03**（接受）：校验失败消息模板不再插值原始入参，只报参数位与 `typeof`；矩阵「对象」用例限定普通字面量对象（§3.1、§3.2）。
- **CLAUDE-04**（接受）：README.md 第 7 行状态句更新纳入本次修改范围（§1、§6）。

其余内容（需求复述、核心判据、现状分析、回退策略）经审查确认正确，维持不变。

## 1. 目标与范围

为 `src/sum.cjs` 的 `sum(a, b)` 实现输入校验，满足 requirements.md 全部需求分支：

- 两个入参都必须是 number 类型且为有限值（`Number.isFinite`）；
- 拒绝字符串、NaN、Infinity、-Infinity：抛出带说明的 `TypeError`；
- 允许负数与小数；
- 校验失败不得返回数值结果（即必须先校验后相加，校验失败立即抛异常）。

修改范围：

- `src/sum.cjs`（实现）；
- `test/sum.test.cjs`（测试）；
- `README.md` 第 7 行状态句更新为一行（随本次落地同步，避免「校验尚未实现」的失实副本残留）。

不改其他文件；参考：`requirements.md`、`task.md`。

## 2. 现状分析

- `src/sum.cjs` 目前只做 `return a + b;`，无校验（现状 `sum('1', 2)` 返回字符串 `'12'`，更说明必须先校验后相加）；
- `test/sum.test.cjs` 仅覆盖两个正常用例（1+2=3、10+32=42），无校验相关用例；套件使用 `node:assert/strict`（`assert.equal` 即 strictEqual，Object.is 语义）；
- `README.md` 第 7 行「输入校验尚未实现，等待计划审查驱动」与 src/sum.cjs 第 2 行注释是同义状态副本，注释随实现更新、README 需一并更新；
- 运行方式：`node --test test/sum.test.cjs`。

## 3. 实施步骤

1. 修改 `src/sum.cjs`：
   - 在函数入口对每个参数做类型 + 有限性校验：`typeof a !== 'number' || !Number.isFinite(a)`（b 同理，两个分支都写、不许省略式复制）；
   - 校验失败抛出 `TypeError`。**消息模板不插值原始入参**（对 `Object.create(null)` 或自定义抛错 toString 的对象，插值会先抛类型转换异常、掩盖校验错误），只报参数位与类型，如 `` `sum: 第 1 个参数必须是有限 number，收到类型 ${typeof a}` ``；
   - 校验全部通过后返回 `a + b`；
   - 保持 CommonJS 导出 `{ sum }` 与 `'use strict'` 不变；随实现更新第 2 行注释为「已按 requirements.md 实施输入校验」类表述。
2. 扩充 `test/sum.test.cjs`，测试矩阵按「**非法值 × 参数位**」二维覆盖：
   - 非法值集合：字符串（`'1'`、`'a'`）、`undefined`、`null`、普通字面量对象（`{}`）、布尔值、`NaN`、`Infinity`、`-Infinity`；
   - **每类非法值各有两条断言**：`sum(非法, 合法)` 与 `sum(合法, 非法)`，全部断言抛出 `TypeError` 且消息非空；
   - 正常值分支：正整数（沿用现有 2 例）、负数（`sum(-1, -2) === -3`）、小数（`sum(0.1, 0.2)` 用容差或 toFixed 比较）、零与负数零（见 §4 的断言形式约束）；
   - 对每个非法用例断言 `err instanceof TypeError` 且 `err.message` 非空。
3. 更新 `README.md` 第 7 行：状态句改为「输入校验已按 requirements.md 实施」类一行表述。
4. 验证：
   - `node --test test/sum.test.cjs` 全部通过；
   - 手动冒烟：`node -e "console.log(require('./src/sum.cjs').sum(1, 2))"` 输出 3；
   - 手动冒烟：`node -e "require('./src/sum.cjs').sum('1', 2)"` 抛 TypeError（a 位）；
   - 手动冒烟：`node -e "require('./src/sum.cjs').sum(1, '2')"` 抛 TypeError（b 位）。

## 4. 测试策略

- 框架：`node:test` + `node:assert/strict`（与现状一致，不引入依赖）；
- 非法输入用 `assert.throws(fn, TypeError)` 断异常类型；
- 浮点断言避免直接 `assert.equal(0.1 + 0.2, 0.3)`，改用容差比较（`Math.abs(r - 0.3) < 1e-12`）或 toFixed 比较；
- **带符号零断言形式写死**：`sum(0, -0)` / `sum(-0, -0)` 这类用例只断「不抛异常且 `typeof` 结果为 number」；若要断结果符号，必须显式用 `Object.is(sum(0, -0), 0)`（明确 +0 期望）；禁止对 ±0 裸用 `assert.equal`（strictEqual 按 Object.is 语义，`Object.is(-0, 0)` 为 false，会假失败）；
- 错误消息断言只断「非空」，不断具体文案（规避消息格式调整导致测试脆弱）；
- 验收标准对齐 task.md：正常值／负数／小数／字符串／NaN／Infinity 六个分支全部有对应测试，且非法分支在两个参数位都有落点。

## 5. 风险与回退

- 风险：浮点用例写法不当导致假失败——用容差/toFixed 比较规避；
- 风险：±0 用例在 assert/strict 下假失败——按 §4 写死断言形式规避；
- 风险：错误消息格式变更影响断言——测试只断类型与「消息非空」；
- 风险：README 与代码注释两份状态副本失实——本轮已把 README 一行更新纳入范围（CLAUDE-04）；
- 回退：`git checkout -- src/sum.cjs test/sum.test.cjs README.md` 即可回到初始状态。

## 6. 涉及文件

- `src/sum.cjs`
- `test/sum.test.cjs`
- `README.md`（仅第 7 行状态句一行更新）
- 参考：`requirements.md`、`task.md`
