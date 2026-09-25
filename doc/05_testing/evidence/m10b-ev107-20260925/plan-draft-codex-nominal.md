# EV-107 前置臂 · 夹具计划：给 math.js 加 multiply

> 夹具仓库里的被审对象，只为让 M10b r5 §4.7 的 EV-107 前置臂有一份可审的计划原稿。
> 名义 Driver 为 codex（`topic claim --driver codex`），实际由 Claude 代笔，与 M9 第 6 步的名义 Driver 口径相同。

## 1. 目标

在 `src/math.js` 新增 `multiply(a, b)`，返回两数之积，并补最小测试。

## 2. 改动

1. `src/math.js`：新增并导出 `export function multiply(a, b) { return a * b; }`，与现有 `add` 同文件、同风格。
2. 新建 `test/math.test.js`：用 Node 内置 `node:test` 与 `node:assert/strict`，覆盖三条：
   - `multiply(2, 3) === 6`
   - `multiply(-2, 3) === -6`
   - `multiply(0, 5) === 0`
3. `package.json` 不存在，本步不新建；测试用 `node --test test/` 直接跑。

## 3. 不做

- 不处理非数字入参（与 `add` 一致，不做类型校验）。
- 不改 `add`。

## 4. 验证

`node --test test/` 退出 0，三条用例全过。

## 5. 风险

- 仓库没有 `package.json`，`import` 语法在 Node 下需要 ESM 语境；若报 `Cannot use import statement outside a module`，改用 `.mjs` 扩展名或新建最小 `package.json`（`{"type":"module"}`）。本计划倾向后者，但留给审查意见定。
