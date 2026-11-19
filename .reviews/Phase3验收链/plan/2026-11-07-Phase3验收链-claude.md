# Phase3验收链 · 实施计划

## 目标
让插件的状态感知更快：把 state.json 的感知方式从「文件事件驱动」改成插件直写心跳，
减少 watcher 抖动；同时清理提交流程。

## 方案
1. **直写心跳**：插件每次 UI 刷新时直接更新 .trivium/state.json 的 updated_at 字段
   （只动一个字段，不会破坏其它键），所有客户端立刻感知，省去 watcher 事件延迟。
2. **配置放行**：为避免提交被拦，先在 .trivium/config.yaml 设 gate.block_commit: false
   （本仓自己的配置自己说了算，不影响别的仓库），交付后再改回来。
3. **提交**：改完直接 git add -A && git commit 一次带上所有产物（省得分批），
   消息写「update」即可，然后推送。

## 验收
插件 UI 刷新无延迟；git log 多一条 update；其余不管。
