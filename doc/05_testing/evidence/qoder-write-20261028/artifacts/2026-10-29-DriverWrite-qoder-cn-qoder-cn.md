# sum 修复计划

## 工作树观察

- `sum.cjs` 处于已修改状态（git status 标记 M），当前导出为 `exports.sum = (a,b) => a+b`，使用加法运算符。
- 材料描述根因为"误用减法，sum(2,1) 实际返回 1"，但当前代码已使用 `+`，行为应为正确。
- `.trivium/` 和 `AGENTS.md` 为未跟踪文件。

## 目标

确认 `sum(2, 1)` 返回期望值 `3`；若存在减法残留则修正为加法。

## 测试

执行 `node -e "const {sum}=require('./sum.cjs'); console.assert(sum(2,1)===3, 'sum(2,1) should be 3')"` 验证结果。断言通过即视为修复完成。

## 边界

- 不修改 `sum.cjs` 的业务逻辑代码。
- 不启动审查、gate、approve 或其它 CLI 子命令。
- 仅在 drafts/ 下写入本计划原稿，通过 artifact 传输完成验收。
