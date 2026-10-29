# `sum` 有限数值输入校验实施计划（r2）

## 相对上一轮的改动

- **GLM-01**（接受）：在 §2.1 明确入参校验与结果溢出的边界语义——仅对入参 `a`、`b` 执行 `Number.isFinite` 校验，合法有限入参相加遵循 IEEE-754 浮点算术语义（如 `sum(Number.MAX_VALUE, Number.MAX_VALUE)` 溢出返回 `Infinity`，不视为入参校验失败）；在 §3.1 新增第 5 项安全边界有限数测试（含 `sum(Number.MAX_VALUE, 0) === Number.MAX_VALUE` 与 `sum(Number.MAX_VALUE, Number.MAX_VALUE) === Infinity`）。
- **GLM-02**（接受）：在 §1 与 §2.3 纳入 `README.md` 第 7 行的同步更新，将“输入校验尚未实现，等待计划审查驱动”更新为输入校验已实现、非有限数值入参抛出 `TypeError` 的说明。

---

## 1. 背景与目标

根据 [requirements.md](../../../requirements.md) 与 [README.md](../../../README.md)，当前 [src/sum.cjs](../../../src/sum.cjs) 中的 `sum(a, b)` 仅执行 `a + b`，尚未对输入参数进行有限数值校验。本计划旨在为 `sum(a, b)` 增加严格的有限数值校验，补齐 [test/sum.test.cjs](../../../test/sum.test.cjs) 的单元测试覆盖，并同步更新 [README.md](../../../README.md) 中的状态说明。

### 需求清单
1. **只接收有限 `number`**：两个入参 `a` 与 `b` 都必须是 `number` 类型且为有限值（通过 `Number.isFinite` 判定）。
2. **拒绝非法输入**：拒绝字符串、`NaN`、`Infinity`、`-Infinity`（以及其他非有限数值类型如 `undefined`、`null`、布尔值、对象、`BigInt`、包装对象 `new Number(1)` 等），抛出带清晰说明的 `TypeError`。
3. **允许负数与小数**：负整数、负小数、正小数、`0`、`-0`、安全边界有限数（如 `Number.MAX_VALUE`）均正常相加并返回数值结果。
4. **校验失败不返回数值结果**：任一入参校验失败时立即抛出 `TypeError`，不得返回任何数值或拼接结果。

---

## 2. 实施方案（`src/sum.cjs` 与 `README.md`）

### 2.1 校验逻辑与结果语义设计
使用 `Number.isFinite(value)` 对入参 `a` 和 `b` 分别校验：
- `Number.isFinite` 不会进行类型强制转换（区别于全局 `isFinite`），仅当参数类型为原始 `number` 且值不为 `NaN`、`Infinity`、`-Infinity` 时返回 `true`。
- 依次检查 `a` 与 `b`（或同时检查），当 `!Number.isFinite(a) || !Number.isFinite(b)` 时抛出 `new TypeError(...)`。
- **结果溢出语义（对应 GLM-01）**：`requirements.md` 仅约束入参必须为有限 `number`，不约束算术结果必须有限。当两个合法有限数值相加超出 IEEE-754 双精度浮点数表示上限时（如 `sum(Number.MAX_VALUE, Number.MAX_VALUE)`），按语言规范正常返回 `Infinity`，不视为入参校验失败。

### 2.2 拟改动代码（`src/sum.cjs`）

```js
'use strict';

function sum(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new TypeError('sum expects two finite numbers as arguments');
  }
  return a + b;
}

module.exports = { sum };
```

- **错误类型**：`TypeError`（严格符合需求“抛出带说明的 TypeError”）。
- **错误消息**：`'sum expects two finite numbers as arguments'`（包含明确英文说明，便于断言匹配 `/finite number/i` 或非空说明检查）。
- **导出契约**：保持 `module.exports = { sum }` CommonJS 导出不变，兼容 `README.md` 中的调用方式。

### 2.3 文档同步更新（`README.md`，对应 GLM-02）

将 `README.md` 第 7 行：
```markdown
- 需求见 requirements.md；输入校验尚未实现，等待计划审查驱动。
```
更新为：
```markdown
- 需求见 requirements.md；仅接收有限 number 入参，非法入参抛出带说明的 TypeError。
```

---

## 3. 测试覆盖方案（`test/sum.test.cjs`）

在保留现有正常正整数相加测试的基础上，使用 Node.js 内置测试运行器（`node:test` 与 `node:assert/strict`）新增以下测试分组：

### 3.1 合法有限数值测试
1. **正整数相加**：保持已有 `sum(1, 2) === 3`、`sum(10, 32) === 42`。
2. **负数相加**：
   - 两个负整数：`sum(-1, -2) === -3`
   - 正负数混合：`sum(-5, 8) === 3`、`sum(5, -8) === -3`
3. **小数（浮点数）相加**：
   - 正小数：`sum(1.5, 2.25) === 3.75`
   - 负小数与正小数：`sum(-1.5, 0.5) === -1`
4. **零值边界**：
   - `sum(0, 0) === 0`、`sum(-0, 5) === 5`
5. **安全边界有限数与 IEEE-754 溢出语义（对应 GLM-01）**：
   - 有限极值不溢出：`sum(Number.MAX_VALUE, 0) === Number.MAX_VALUE`、`sum(-Number.MAX_VALUE, 0) === -Number.MAX_VALUE`
   - 两个合法有限极值相加溢出：`sum(Number.MAX_VALUE, Number.MAX_VALUE) === Infinity`（验证入参合法时不抛 `TypeError`，按 IEEE-754 返回 `Infinity`）

### 3.2 非法输入拒绝测试（验证抛出带说明的 `TypeError`）
使用 `assert.throws(() => sum(...), { name: 'TypeError', message: /finite/i })`（或验证 `err instanceof TypeError && err.message.length > 0`）验证以下场景：
1. **字符串输入**：
   - 数字字符串：`sum('1', 2)`、`sum(1, '2')`、`sum('1', '2')`（防止字符串拼接返回 `'12'`）
   - 空字符串与非数字字符串：`sum('', 1)`、`sum('abc', 1)`
2. **`NaN` 输入**：
   - `sum(NaN, 1)`、`sum(1, NaN)`、`sum(NaN, NaN)`
3. **无穷大输入（`Infinity` / `-Infinity`）**：
   - `sum(Infinity, 1)`、`sum(1, Infinity)`
   - `sum(-Infinity, 1)`、`sum(1, -Infinity)`
   - `sum(Infinity, -Infinity)`
4. **缺省参数与其它非数值类型**：
   - `sum()`、`sum(1)`、`sum(undefined, 1)`、`sum(null, 1)`、`sum(true, 1)`、`sum({}, 1)`、`sum([], 1)`、`sum(1n, 1)`、`sum(new Number(1), 2)`

---

## 4. 验证步骤与风险评估

1. **验证命令**：在代码实施阶段运行 `node --test test/sum.test.cjs` 及 `node -e "console.log(require('./src/sum.cjs').sum(1, 2))"`，确保全部测试通过且 CLI 用法正常。
2. **兼容性与风险**：
   - `Number.isFinite` 自 ES6（Node.js 0.12+）起内置支持，无外部依赖。
   - 原有合法有限数调用行为完全保持不变；仅对原先未受检的非法入参抛出 `TypeError`，符合需求预期。
