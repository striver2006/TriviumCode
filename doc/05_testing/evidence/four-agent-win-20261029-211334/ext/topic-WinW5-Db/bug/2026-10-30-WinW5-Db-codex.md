---
schema: trivium.bug_rca.v1
topic: WinW5-Db
stage: bug
role: codex
kind: rca
---

# 根因定位：sum 参数校验 b 位漏检

## 缺陷现象

- 复现用例：`sum(1, "b")` 不抛 TypeError，而是返回字符串 `"1b"`。
- 失败测试：`test/sum.test.cjs` 中「b 位字符串拒绝（复现用例）」。

## 需求依据（requirements.md）

- 只接收有限 number：**两个入参都必须是 number 且为有限值**（Number.isFinite）。
- 拒绝字符串、NaN、Infinity、-Infinity：抛出带说明的 TypeError。

## 根因分析

`src/sum.cjs` 中 `sum(a, b)` 的校验逻辑只覆盖参数 a：

```js
if (typeof a !== 'number' || !Number.isFinite(a)) {
  throw new TypeError(`sum: 参数 a 必须是有限 number，得到 ${typeof a}`);
}
return a + b;
```

函数体内**不存在对参数 b 的任何类型或有限性检查**。当 a 为合法有限 number、b 为字符串时：

1. a 的校验通过（`typeof 1 === 'number'` 且 `Number.isFinite(1)` 为 true）；
2. 执行 `return a + b`，JS 的 `+` 运算符在 number 与 string 混合时执行字符串拼接；
3. 返回 `"1b"`，未抛 TypeError。

## 根因结论

- **直接根因**：`src/sum.cjs` 第 4–6 行的校验分支只对 `a` 生效，缺少对称的 b 位校验分支。
- **失效机理**：缺失的 b 校验使非法输入越过防线，落入 `a + b` 的正常路径，被 JS 隐式类型转换（number + string → string 拼接）静默吸收，缺陷表现为「不抛错、返回非数值结果」。
- **影响范围**：b 位为 string / NaN / Infinity / -Infinity 的全部输入均漏检，违反需求中「两个入参都必须是有限 number」的约束。
- **修复方向**（本阶段只审根因，不改实现）：在 return 之前补充与 a 对称的 b 位校验，抛带说明的 TypeError。

## 复现确认

- `sum(1, "b")` → 实际返回 `"1b"`，期望抛 TypeError。
- `sum(1, NaN)` / `sum(1, Infinity)` 同理漏检（同一根因）。
