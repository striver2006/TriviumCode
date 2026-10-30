---
topic: WinW5-A
stage: plan
role: claude
date: 2026-10-30
round: 2
---

# 计划（r2）：sum 输入校验（WinW5-A）

## 相对上一轮的改动

- **AGY-01**（接受，同 **GLM-01**）：§2.1 `describeValue` 的消息构造路径改为不可抛——`JSON.stringify` 包 try/catch，失败回退 `Object.prototype.toString.call(v)`；§5 相应条目改写。
- **AGY-02**（接受）：§2.2 断言形式由 `assert.throws(fn, TypeError)` 改为 `assert.throws(fn, { name: 'TypeError', message: /^sum: 参数/ })`，覆盖「带说明」验收。
- **GLM-02**（接受）：新增输出侧决策——两有限数相加自然溢出为 Infinity **视为允许**，校验只约束入参；落点 §2.1 要点与 §5。
- **GLM-03**（接受）：§2.2 用例表「拒绝非 number 类型」行补第二位置用例 `sum(1, null)`、`sum(1, {})`，并新增 `sum(10n, 1)` bigint 拒绝用例（GLM-01 建议的可选项，一并采纳）。

## 1. 背景与目标

`src/sum.cjs` 目前只做 `a + b`，无任何输入校验（见 `requirements.md`）。需求要求：

1. 两个入参都必须是**有限 number**（`Number.isFinite`）。
2. 拒绝字符串、`NaN`、`Infinity`、`-Infinity`：抛出**带说明的 `TypeError`**。
3. **允许**负数与小数。
4. 校验失败**不得返回数值结果**（只能抛错，不得静默返回或做数值强转）。

## 2. 改动方案

### 2.1 `src/sum.cjs`（唯一业务改动文件）

在 `sum` 函数开头对两个入参逐一校验，任一不满足即抛 `TypeError`，校验全部通过才执行加法：

```js
'use strict';
function describeValue(v) {
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  try {
    const s = JSON.stringify(v);
    return `${typeof v}: ${s ?? String(v)}`;
  } catch {
    // 循环引用等无法序列化的值：回退到不可抛的形态描述
    return `${typeof v}: ${Object.prototype.toString.call(v)}`;
  }
}
function sum(a, b) {
  if (!Number.isFinite(a)) {
    throw new TypeError(`sum: 参数 a 必须是有限 number，实际为 ${describeValue(a)}`);
  }
  if (!Number.isFinite(b)) {
    throw new TypeError(`sum: 参数 b 必须是有限 number，实际为 ${describeValue(b)}`);
  }
  return a + b;
}
module.exports = { sum };
```

要点：

- 用 `Number.isFinite`（**不做类型强转**）：字符串 `'1'` 即便能转数字也会被拒，满足需求第 1、2 条；
- `NaN`、`Infinity`、`-Infinity` 是 number 但非有限值，同样被 `Number.isFinite` 拒绝；
- 负数与小数是有限 number，天然放行，无需额外分支（需求第 3 条）；
- 校验失败路径**只有 throw**，不存在返回数值的可能（需求第 4 条）；
- 错误信息含参数名、期望类型与实际值的可读描述，满足「带说明」；
- **消息构造路径不可抛**（AGY-01 / GLM-01）：bigint 直接 `String(v)`；`JSON.stringify` 置于 try/catch 中，遇循环引用等序列化异常回退 `Object.prototype.toString.call(v)`——保证调用方永远拿到 `sum: 参数 …` 前缀的说明性 TypeError，而不是引擎序列化报错；
- **输出侧语义**（GLM-02）：两个有限数相加自然溢出为 Infinity（如 `1.7976931348623157e308` 与自身相加）**视为允许**——requirements 只约束入参有限性，函数按 IEEE-754 双精度语义返回，不额外做输出校验（超出需求范围）；
- 保留 `module.exports = { sum }` 导出形态与 `'use strict'`，不改变公共 API。

### 2.2 `test/sum.test.cjs`（补充测试）

在现有「两个正常数相加」之外新增用例：

| 用例 | 输入 | 期望 |
|---|---|---|
| 拒绝字符串 | `sum('1', 2)`、`sum(1, '2')` | 抛 `TypeError` |
| 拒绝 NaN | `sum(NaN, 1)`、`sum(1, NaN)` | 抛 `TypeError` |
| 拒绝 ±Infinity | `sum(Infinity, 1)`、`sum(1, -Infinity)` | 抛 `TypeError` |
| 拒绝非 number 类型 | `sum(null, 1)`、`sum(1, undefined)`、`sum({}, 1)`、`sum(1, null)`、`sum(1, {})`（GLM-03：两位置对称覆盖） | 抛 `TypeError` |
| 拒绝 bigint | `sum(10n, 1)`（GLM-01 附议） | 抛 `TypeError`，且 message 为 `sum: 参数 …` 说明（不得是引擎序列化报错） |
| 允许负数 | `sum(-1, -2)` | 等于 `-3` |
| 允许小数 | `sum(0.1, 0.2)` | 约等于 `0.3`（用 `assert.ok(Math.abs(... - 0.3) < 1e-12)` 或等价方式，避免浮点误差假失败） |

断言统一采用（AGY-02）：

```js
assert.throws(() => sum(...), { name: 'TypeError', message: /^sum: 参数/ });
```

同时校验异常**类型**与 message 前缀，覆盖需求「带说明的 TypeError」。

## 3. 不改动的部分

- `README.md`、`requirements.md`：需求与用法说明不变，用法示例 `sum(1, 2)` 仍然成立。
- 导出的函数签名 `sum(a, b)` 不变，不新增参数、不改变模块结构。

## 4. 验证方式

- 编译检查：`node --check src/sum.cjs`
- 测试：`node --test test/sum.test.cjs`（全部用例通过为准）

## 5. 风险与取舍

- **小数相加的浮点误差**：`sum(0.1, 0.2)` 不精确等于 `0.3`。需求只要求「允许小数」不抛错，不要求十进制精确；测试用容差断言，实现不引入 Decimal 类处理（超出需求范围）。
- **错误文案语言**：采用中文文案（与本仓库需求文档语言一致）；两侧审查者均未对此提出异议。
- **消息构造路径的边界**（AGY-01 / GLM-01 修订后）：`describeValue` 对 `undefined`（`JSON.stringify` 返回 `undefined`）走 `?? String(v)` 兜底；对 BigInt 走 `String(v)` 分支；对循环引用对象走 try/catch 回退。三类此前可抛或输出怪异的路径全部封闭。
- **输出溢出不校验**（GLM-02 决策）：自然溢出返回 Infinity 属允许行为，与「入参必须有限」的需求文字范围一致；如验收方后续要求输出也有限，属需求变更另立任务。
