# Phase3验收链 · 实施计划（r2）

## 相对上一轮的改动

接受 AGY-01、AGY-02、AGY-03、AGY-04、CODEX-01、CODEX-02、CODEX-03、CODEX-04、CODEX-05，方案与验收整体重写：

1. **撤销插件直写 state.json 心跳**（AGY-01 / CODEX-01 / AGY-04）：state.json 是编排器独占维护的全局闸门状态（写入必须持全局锁 + 读改原子替换），插件仅作只读消费者；感知优化改在插件层做防抖/触发路径。
2. **删除临时关闭 gate.block_commit 的步骤**（AGY-02 / CODEX-03）：不触碰 `.trivium/config.yaml` 的 gate 配置；提交放行以裁决齐备、`gate --check` 通过与用户审批为前提。
3. **补齐生命周期契约**（AGY-03 / CODEX-05）：本计划获批后编码，编码后走 `/dual-review-code` 双审与逐条裁决；提交前过 `npm run check`（主仓）与 extension 独立检查链；提交消息遵循中文 Conventional Commits，按文件名逐个 `git add`，不推 `update` 消息。
4. **验收改为量化与回归导向**（CODEX-02 / CODEX-04）：先测延迟基线再优化，验收覆盖延迟阈值、外部闸门迁移感知、并发窗口、不可读状态与 Phase 3 闭环回归（裁决 / 审批 / 状态灯 / 保存防护），自动化复用现有零配额桩。

## 目标

改善插件的状态感知体验（降低刷新延迟、减少 watcher 抖动），同时保持既有集成边界与提交流程合规。

## 方案

1. **延迟定位先行**：先量化现状——记录 UI 刷新从状态变更到展示的延迟分布，确认延迟发生在 watcher 事件送达、rescan 解析还是渲染环节，再决定优化点。
2. **插件层只读优化**：state.json 保持只读消费。若延迟在 watcher 事件链，在插件层优化 `extension/src/monitor/stateWatch.ts` 的防抖/节流与触发路径（如缩短 debounce、去重事件、失败重试）；若需新增状态触发通道，只在不侵入编排器状态契约的前提下评估（例如复用运行目录 status.json 的只读解析），任何改动先单独评审。
3. **配置不动**：不修改 `.trivium/config.yaml` 的任何 gate 配置；发现提交被拦时处理实际阻断原因（裁决补齐 / 审批），不用开关绕过。
4. **合规提交**：编码后运行主仓 `npm run check`（typecheck + build + test）与 extension 独立检查链（typecheck、打包、单测、extension host 集成测试，自动化复用零配额桩）；走 `/dual-review-code` 双审并逐条裁决；提交消息按 Conventional Commits 中文规范拟写（如 `fix(extension): 缩短状态刷新防抖延迟`），按文件名逐个 `git add`；推送前先经用户确认，推送后核对各 remote ref 一致。

## 验收

1. **延迟量化**：给出优化前后同一夹具下的刷新延迟对比，达到预设阈值（阈值在编码前随基线数据一并记录）。
2. **功能回归**：外部闸门迁移（idle→审查中→闸门期等）在插件侧被正确感知与展示。
3. **闭环回归**：Phase 3 的裁决台、审批流、状态灯、保存防护相关集成测试（monitor / gateApproval / saveGuard / dispositionDesk）全部通过。
4. **检查链**：主仓 `npm run check` 与 extension 独立检查全绿；plan 与 code 双审裁决件齐备。
5. **提交流程**：提交消息符合 Conventional Commits，无 `git add -A`，无 update 类空消息。
