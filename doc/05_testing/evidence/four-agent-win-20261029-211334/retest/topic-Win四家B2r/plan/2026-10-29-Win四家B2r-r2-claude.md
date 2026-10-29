# 实施计划（r2）：sum 有限数值输入校验

## 相对上一轮的改动

**本轮无改动。** 原因：第 1 轮唯一入选审核者 gemini 结论为「通过（pass）」，未提出任何
意见条目（blocker/major/minor/nit 均为 0），裁决结果为无接受项，计划内容与上一轮完全一致。
以下为合入后的完整计划（照抄上一轮）。

---

## 1. 目标与背景

按 requirements.md，为 `src/sum.cjs` 的 `sum(a, b)` 增加输入校验：

- 两个入参都必须是 number 且为有限值（`Number.isFinite`）。
- 拒绝字符串、NaN、Infinity、-Infinity，抛出带说明的 `TypeError`。
- 允许负数与小数。
- 校验失败不得返回数值结果（以抛错方式中断，不返回任何数值）。

当前实现只做 `a + b`，无任何校验；现有测试只覆盖两个正常数相加。

## 2. 实施方案

### 2.1 修改 `src/sum.cjs`

在 `sum` 函数体最前面加入校验，利用短路求值一次检查两个入参：

```js
'use strict';
function sum(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new TypeError('sum: 两个入参都必须是有限的 number');
  }
  return a + b;
}
module.exports = { sum };
```

要点：

- `Number.isFinite` 本身就要求类型为 number（不做隐式转换），
  因此字符串 `'1'`、`null`、`undefined`、`NaN`、`Infinity`、`-Infinity` 全部被拒。
- 校验在加法之前，失败即抛出，不会返回数值结果。
- 保持最小改动，不引入参数个数检查等需求外内容（requirements 只约定两个入参）。

### 2.2 扩展 `test/sum.test.cjs`

新增测试用例（使用 `node:test` + `assert/strict`，与现有风格一致）：

1. **正常路径**
   - 两个正数：`sum(1, 2) === 3`（保留现有用例）。
   - 负数：`sum(-1, -2) === -3`。
   - 小数：`sum(0.1, 0.2)` 约等于 `0.3`（用 `assert.equal` 直接比 `0.1 + 0.2` 的结果，
     避免浮点容差问题；或比较 `sum(1.5, 2.25) === 3.75`）。
   - 混合：`sum(-3, 2.5) === -0.5`。
   - 零：`sum(0, -0) === 0`。
2. **拒绝路径**（断言抛出 TypeError）
   - 字符串：`sum('1', 2)`、`sum(1, '2')`、`sum('a', 'b')`。
   - `NaN`：`sum(NaN, 1)`、`sum(1, NaN)`。
   - `Infinity` / `-Infinity`：`sum(Infinity, 1)`、`sum(1, -Infinity)`。
   - 非 number 其它类型：`sum(null, 1)`、`sum(undefined, 1)`、`sum({}, 1)`、`sum(1, true)`。
   - 缺参：`sum(1)`（b 为 undefined）。
   - 断言方式：`assert.throws(() => sum(...), TypeError)`，至少一条同时校验
     错误消息含说明文字（如 `/必须是有限的 number/`）。
3. **校验失败不返回数值**
   - 由 `assert.throws` 隐含覆盖（抛错即无返回值），不单列用例。

### 2.3 验证步骤

- 运行 `node --test test/sum.test.cjs`，全部通过。
- 运行 README 用法示例 `node -e "console.log(require('./src/sum.cjs').sum(1, 2))"` 输出 `3`。
- 确认对 `sum('1', 2)` 抛出 TypeError（快速冒烟）。

## 3. 不做的事

- 不改动模块导出结构（仍导出 `{ sum }`）。
- 不增加可变参数、数组入参等需求外功能。
- 不引入 TypeScript 或 lint 规则变更。

## 4. 风险

- 浮点小数断言若直接写十进制字面量结果（如 `0.3`）会因 `0.1 + 0.2 !== 0.3` 失败，
  测试内已规避（比较表达式两侧同式或选用可精确表示的小数）。
- 错误消息断言用正则宽松匹配，避免措辞微调导致测试脆弱。
