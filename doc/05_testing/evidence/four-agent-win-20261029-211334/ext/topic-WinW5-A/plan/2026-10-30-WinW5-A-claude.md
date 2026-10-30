---
topic: WinW5-A
stage: plan
role: claude
date: 2026-10-30
kind: original
---

# 计划：sum 输入校验（WinW5-A）

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
  if (typeof v === 'number') return String(v);        // NaN / Infinity / -Infinity 直接可读
  return `${typeof v}: ${JSON.stringify(v) ?? String(v)}`;
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
- 保留 `module.exports = { sum }` 导出形态与 `'use strict'`，不改变公共 API。

### 2.2 `test/sum.test.cjs`（补充测试）

在现有「两个正常数相加」之外新增用例：

| 用例 | 输入 | 期望 |
|---|---|---|
| 拒绝字符串 | `sum('1', 2)`、`sum(1, '2')` | 抛 `TypeError` |
| 拒绝 NaN | `sum(NaN, 1)`、`sum(1, NaN)` | 抛 `TypeError` |
| 拒绝 ±Infinity | `sum(Infinity, 1)`、`sum(1, -Infinity)` | 抛 `TypeError` |
| 拒绝非 number 类型 | `sum(null, 1)`、`sum(1, undefined)`、`sum({}, 1)` | 抛 `TypeError` |
| 允许负数 | `sum(-1, -2)` | 等于 `-3` |
| 允许小数 | `sum(0.1, 0.2)` | 约等于 `0.3`（用 `assert.ok(Math.abs(... - 0.3) < 1e-12)` 或等价方式，避免浮点误差假失败） |

断言用 `assert.throws(() => sum(...), TypeError)` 验证异常**类型**，并以错误 message 前缀（`sum: 参数`）粗验「带说明」。

## 3. 不改动的部分

- `README.md`、`requirements.md`：需求与用法说明不变，用法示例 `sum(1, 2)` 仍然成立。
- 导出的函数签名 `sum(a, b)` 不变，不新增参数、不改变模块结构。

## 4. 验证方式

- 编译检查：`node --check src/sum.cjs`
- 测试：`node --test test/sum.test.cjs`（全部用例通过为准）

## 5. 风险与取舍

- **小数相加的浮点误差**：`sum(0.1, 0.2)` 不精确等于 `0.3`。需求只要求「允许小数」不抛错，不要求十进制精确；测试用容差断言，实现不引入 Decimal 类处理（超出需求范围）。
- **错误文案语言**：示例采用中文文案（与本仓库需求文档语言一致）；如审核者建议改英文或其他格式，按裁决调整。
- **`describeValue` 对 `undefined` 的 `JSON.stringify`**：`JSON.stringify(undefined)` 返回 `undefined`，已用 `?? String(v)` 兜底，不会输出 `undefined: undefined` 之外的异常。
