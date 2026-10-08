# 计划：为 calc 模块增加 divide

## 目标

在 `src/calc.js` 增加 `divide(a, b)`，并在 `test/calc.test.js` 补测试。

## 改动

1. `src/calc.js` 新增导出函数 `divide(a, b)`：
   - `b === 0` 时抛 `RangeError('division by zero')`，不返回 `Infinity`；
   - 其余情况返回 `a / b`，不做取整。
2. `test/calc.test.js` 新增两条用例：
   - `divide(6, 3)` 等于 `2`；
   - `divide(1, 0)` 抛出 `RangeError`（用 `assert.throws` 校验错误类型）。
3. `README.md` 的函数清单补上 `divide`。

## 不做的事

- 不处理非数字参数（与现有 `add` / `sub` 一致，不做类型校验）。
- 不改 `package.json`。

## 验证

`npm test` 全绿，新增两条用例在列。
