# sum 输入校验实施计划

- 主题：Win四家B2
- 阶段：plan
- 执笔（Driver）：claude
- 日期：2026-10-29
- 依据：requirements.md、README.md、src/sum.cjs、test/sum.test.cjs

## 1. 目标

按 requirements.md 为 `src/sum.cjs` 的 `sum(a, b)` 增加有限数值输入校验：

- 只接收有限 number——两个入参都必须是 `number` 类型且 `Number.isFinite` 为真；
- 拒绝字符串、`NaN`、`Infinity`、`-Infinity`，抛出带说明的 `TypeError`；
- 允许负数与小数；
- 校验失败不得返回数值结果（以抛错方式失败，不返回任何值）。

当前实现（`a + b` 裸加法）不满足以上任一条：字符串会拼接、`NaN`/`Infinity` 会静默返回数值结果。

## 2. 实施步骤

### 步骤 1：修改 `src/sum.cjs`

在 `sum` 函数体内、加法之前对两个入参逐一校验，任一不合规即抛 `TypeError`：

```js
'use strict';
function assertFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(
      `sum: 参数 ${name} 必须是有限 number，实际收到 ${formatValue(value)}`
    );
  }
}

function formatValue(value) {
  if (typeof value === 'number') return String(value);
  return `${typeof value}: ${String(value)}`;
}

function sum(a, b) {
  assertFiniteNumber(a, 'a');
  assertFiniteNumber(b, 'b');
  return a + b;
}

module.exports = { sum };
```

要点说明：

- `typeof value !== 'number'` 拦下字符串、`undefined`、`null`、`boolean`、对象等非 number 类型（`Number.isFinite` 对非 number 一律返回 false，但先查类型可让错误信息区分「类型不对」与「数值不有限」，且语义与需求逐条对应）；
- `Number.isFinite(value)` 拦下 `NaN`、`Infinity`、`-Infinity`；
- 错误信息带参数名与实际收到的值，满足「带说明的 TypeError」；
- 校验在加法之前、逐参数执行，失败即抛出，函数不返回任何数值结果；
- `formatValue` 仅作错误信息辅助，避免 `String(Symbol)` 之外的形态问题——`sum` 收到 Symbol 时 `typeof` 为 `'symbol'`，走 `String(value)` 会抛 TypeError，需在 `formatValue` 中特殊处理（见步骤 3 的风险项）。

### 步骤 2：扩充 `test/sum.test.cjs`

保留现有正常相加测试，新增覆盖：

| 用例 | 输入 | 期望 |
|---|---|---|
| 正常负数与小数 | `sum(-1.5, 2.5)` | 返回 `1` |
| 拒绝字符串（左） | `sum('1', 2)` | 抛 `TypeError` |
| 拒绝字符串（右） | `sum(1, '2')` | 抛 `TypeError` |
| 拒绝 NaN | `sum(NaN, 1)`、`sum(1, NaN)` | 抛 `TypeError` |
| 拒绝 Infinity | `sum(Infinity, 1)` | 抛 `TypeError` |
| 拒绝 -Infinity | `sum(1, -Infinity)` | 抛 `TypeError` |
| 拒绝 undefined / null | `sum(undefined, 1)`、`sum(1, null)` | 抛 `TypeError` |
| 失败不返回数值 | 对每个非法输入用 `assert.throws` 验证抛出，且无返回值 | 抛 `TypeError` |

断言形态：

```js
assert.throws(() => sum('1', 2), { name: 'TypeError', message: /有限 number/ });
```

- 每条非法用例同时覆盖左、右两个参数位（校验是逐参数的，两位置都要走到）；
- 用 `assert.throws` 而非 try/catch，天然满足「校验失败不得返回数值结果」的验证——不抛出即测试失败。

### 步骤 3：边界与风险

- **Symbol 入参**：`String(symbol)` 抛 TypeError，`typeof value` 分支里 `String(value)` 会先炸。处理方式：`formatValue` 中对 `symbol` / `bigint` 用 `typeof` 前缀加保护性转换（如 `` `${typeof value}` ``，不打印值本身），保证外层抛出的是带说明的 `TypeError` 而非语义不明的转换错误。测试补一条 `sum(Symbol('x'), 1)` 期望 `TypeError`。
- **错误信息可辨识度**：非法值格式化输出需可区分 `'1'`（字符串）与 `1`（数字），故非 number 类型带 `typeof` 前缀。
- **不加自动转换**：需求只要求校验与拒绝，不改变合法输入的加法语义。

## 3. 验证方式

- `node --test test/sum.test.cjs` 全绿；
- 手工冒烟：`node -e "require('./src/sum.cjs').sum('1',2)"` 应抛 TypeError。

## 4. 变更范围

- `src/sum.cjs`：加入校验；
- `test/sum.test.cjs`：新增上述用例；
- 不改 `requirements.md`、`README.md`，不动其他文件。
