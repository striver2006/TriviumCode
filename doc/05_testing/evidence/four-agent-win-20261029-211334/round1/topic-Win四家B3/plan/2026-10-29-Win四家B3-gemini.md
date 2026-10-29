# `sum` 有限数值输入校验实施计划

## 1. 背景与目标

根据 [requirements.md](../../requirements.md) 与 [README.md](../../README.md)，当前 `src/sum.cjs` 中的 `sum(a, b)` 仅执行 `a + b`，尚未对输入参数做类型与有限性校验。本计划旨在为 `sum(a, b)` 实现严格的有限 `number` 输入校验，并在 `test/sum.test.cjs` 中补充完整的正向与异常测试覆盖。

### 需求约束拆解
1. **只接收有限 `number`**：两个入参 `a`、`b` 都必须是原始 `number` 类型且为有限值（使用 `Number.isFinite(x)` 判定；`Number.isFinite` 仅对 `typeof x === 'number'` 且非 `NaN`、`Infinity`、`-Infinity` 的值返回 `true`，不会对字符串、布尔值、`null`、包装对象 `new Number(1)` 等做隐式类型转换）。
2. **拒绝非法输入并抛出 `TypeError`**：当 `a` 或 `b` 不满足 `Number.isFinite`（包括字符串如 `'1'`、`NaN`、`Infinity`、`-Infinity`、`undefined`、`null`、对象、`BigInt` 等）时，抛出带清晰说明信息的 `TypeError`。
3. **允许负数与小数**：如 `-1`、`-0`、`0.1`、`-2.5`、`Number.MAX_SAFE_INTEGER`、`Number.MIN_VALUE` 等合法有限 `number` 均正常计算并返回相加结果。
4. **校验失败不得返回数值结果**：校验前置在加法运算之前执行，一旦任一参数不合法立即抛出 `TypeError`，不会返回任何数值或拼接字符串。

---

## 2. 涉及文件清单

| 文件路径 | 变更类型 | 说明 |
| --- | --- | --- |
| `src/sum.cjs` | 修改 | 在 `sum(a, b)` 开头增加基于 `Number.isFinite` 的入参校验，失败时抛出带参数名说明的 `TypeError` |
| `test/sum.test.cjs` | 修改 | 保留现有正整数测试，新增零、负数、小数、边界有限数正向测试，以及字符串、`NaN`、`±Infinity`、缺省参数与其它非有限数值类型的 `TypeError` 断言测试 |

---

## 3. 具体实施步骤

### 步骤 1：修改 `src/sum.cjs` 实现输入校验

在 `src/sum.cjs` 的 `sum(a, b)` 函数体内，执行 `return a + b;` 之前加入校验逻辑：

```js
'use strict';

function sum(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new TypeError('sum() expects two finite numbers as arguments');
  }
  return a + b;
}

module.exports = { sum };
```

**设计要点**：
- `Number.isFinite(val)` 是 ES6 标准内建方法，等价于 `typeof val === 'number' && isFinite(val)`，天然满足「必须是 `number` 且为有限值」的要求。
- 当 `a` 或 `b` 为字符串（如 `'1'`、`''`）、`NaN`、`Infinity`、`-Infinity`、`undefined`、`null`、`boolean`、`symbol`、`bigint`、`object`（含 `new Number(1)`、`[]`、`{}`）时，`Number.isFinite` 均返回 `false`，直接抛出 `TypeError` 实例，且包含明确的英文/可读说明信息 `'sum() expects two finite numbers as arguments'`。
- 不改变模块导出签名 `module.exports = { sum }` 与 CommonJS 规范。

### 步骤 2：扩充 `test/sum.test.cjs` 测试用例

使用 Node.js 内置测试运行器（`node:test` + `node:assert/strict`），覆盖以下测试场景：

1. **正常有限数值相加（正向覆盖）**
   - 正整数相加：`sum(1, 2) === 3`、`sum(10, 32) === 42`
   - 零与正负零：`sum(0, 0) === 0`、`sum(-0, 5) === 5`
   - 负数相加：`sum(-1, -2) === -3`、`sum(-10, 4) === -6`
   - 小数（浮点数）相加：`sum(1.5, 2.25) === 3.75`、`sum(-0.5, 0.25) === -0.25`
   - 极值有限数：`sum(Number.MAX_SAFE_INTEGER, 0) === Number.MAX_SAFE_INTEGER`

2. **拒绝非有限数值与非 `number` 类型（异常覆盖，验证抛出带说明的 `TypeError`）**
   - 字符串入参（左参、右参、双参）：`sum('1', 2)`、`sum(1, '2')`、`sum('1', '2')`、`sum('', 0)`
   - `NaN` 入参：`sum(NaN, 1)`、`sum(1, NaN)`、`sum(NaN, NaN)`
   - 无穷大入参：`sum(Infinity, 1)`、`sum(1, Infinity)`、`sum(-Infinity, 1)`、`sum(1, -Infinity)`、`sum(Infinity, -Infinity)`
   - 其它非 `number` 或缺失入参：`sum(undefined, 1)`、`sum(1, undefined)`、`sum()`、`sum(null, 1)`、`sum(true, 1)`、`sum({}, 1)`、`sum([], 1)`、`sum(new Number(1), 2)`
   - 断言方式：使用 `assert.throws(() => sum(...), { name: 'TypeError', message: /finite number/i })`，确保不仅抛出 `TypeError`，且错误对象带有非空可读说明，绝不返回数值结果。

---

## 4. 验证方式与验收标准

1. 在项目根目录执行 `node --test test/sum.test.cjs`，所有测试用例全部通过（exit code 为 0）。
2. 执行 `node -e "console.log(require('./src/sum.cjs').sum(1, 2))"` 输出 `3`。
3. 核对 `requirements.md` 四项要求均已被实现与测试逐一覆盖。
