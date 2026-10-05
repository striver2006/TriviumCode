---
schema: trivium.disposition.v1
topic: header探测计时器收尾
stage: plan
role: claude
kind: revised
run_id: 20261005T113659Z
addresses:
  - 2026-10-05-header探测计时器收尾-codex.md
  - 2026-10-05-header探测计时器收尾-gemini.md
  - 2026-10-05-header探测计时器收尾-glm.md
---

# header探测计时器收尾 · 计划双审第 1 轮裁决

run `20261005T113659Z`：gemini `approve`（零意见），codex、glm `approve-with-nits`，共 6 条（次要 3、吹毛求疵 3），全部接受。
两家的三条意见两两同指：CODEX-01 ≡ GLM-02（文档补文漏了终止冻结的例外）、CODEX-02 ≡ GLM-01（父侧按裸 pid 补杀）、CODEX-03 ≡ GLM-03（自检命令形态）。
合入后的完整计划见 `2026-10-05-header探测计时器收尾-r2-claude.md`。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实：拟补文案「run 必然兑现、不会 reject」没有排除 `treeShutdown`——`run` 开头与 `finish` 两处在终止中都不兑现，同一份计划 §3.4 自己写了这条边界，§3.2 却断言恒兑现，口径自相矛盾 | r2 §3.2 补文改为「除终止中（`shutdownTrackedTrees` 置位后）外必然兑现、不会 reject；终止中永不兑现，见该函数文档块，那时进程随即退出」；§3.1 的源码注释同步带上这一例外 |
| CODEX-02 | codex | minor | 接受 | 属实：测试父进程是假 codex 的祖父，不是父进程，「未回收即不可复用」的保护不成立；绿路径里假 codex 早已退出，按裸 pid 补发 SIGKILL（还按组）有误杀风险，正是架构纪律 6 要防的形态 | r2 §4.1 收尾去掉父侧一切按 pid 的补杀：父侧只对自己的直接子进程（drain 子进程，未回收前 pid 不可复用）兜底 SIGKILL；假 codex 自己负责不遗留——每 100 ms 看一次 `process.ppid`，父进程变了（drain 子进程被杀、自己成孤儿）就立即退出，另有 40 s 自毙上限；`fake.pid` 文件随之删去 |
| CODEX-03 | codex | nit | 接受 | 属实：CLI 没有 `selftest` 子命令，自检是 `doctor --selftest` | r2 §4.4 改为 `trivium doctor --selftest`，并写明跑的是仓库构建产物（`node skills/dual-critic/scripts/trivium.cjs doctor --selftest`），不经 `.trivium/bin` 指向的全局安装副本 |
| GLM-01 | glm | minor | 接受 | 与 CODEX-02 同指，属实；建议里的「补杀放进 drain 子进程、它是真实父进程」方向成立，但在 drain 子进程里挂补杀逻辑会给被测的事件循环添句柄、污染 drain 读数，所以改由假 codex 自查父进程是否已变 | 同 CODEX-02 |
| GLM-02 | glm | nit | 接受 | 与 CODEX-01 同指，属实 | 同 CODEX-01 |
| GLM-03 | glm | nit | 接受 | 与 CODEX-03 同指，属实；另提醒全局副本是旧代码，自检要指仓库构建产物 | 同 CODEX-03 |

## 逐条说明

### CODEX-01 / GLM-02（接受）

`run` 的两处终止中分支：开头 `if (treeShutdown) return new Promise(() => {})`、`finish` 里 `if (treeShutdown) return`。补文只说「必然兑现」会让将来 worker 侧的调用方以为 `finally` 恒跑。改后的补文显式写出例外并指向 `shutdownTrackedTrees` 文档块；`probeCodexHeader` 不在 worker 路径上，这条例外对本题实现无影响，只是让契约文字不说过头。

### CODEX-02 / GLM-01（接受）

改后的收尾分工：
- 父侧（测试进程）：只管 drain 子进程——它是父侧的直接子进程，`exit` 事件到达前 pid 不可能被复用，超时时 `child.kill('SIGKILL')` 安全。
- 假 codex：启动时记下 `process.ppid`；每 100 ms 比一次，变了（drain 子进程已死、自己被 init 收养）就 `process.exit`；另挂 40 s 自毙。两者都在假 codex 进程自己内部，不碰任何别的 pid。
- drain 子进程里不加任何清理逻辑：它的事件循环正是被测对象，多挂一个句柄就会掩盖或伪造漏清。
- H1～H3 的假 codex 自己就退出；H4 / H5 由 `run` 的早退按组 SIGTERM 结束（`killTree` 拉起、drain 子进程是它的父进程，安全前提成立）。只有变异或超时红时才会走到「drain 被杀、假 codex 成孤儿」那一支，由 ppid 自查在约 100 ms 内收掉。

### CODEX-03 / GLM-03（接受）

自检命令改为仓库构建产物上的 `doctor --selftest`。GLM 盲区里提到自检的桩路径未必走到 `probeCodexHeader`：确实不走（自检用桩适配器，不跑探针），它在本题只是回归确认，r2 §4.4 照此写明。
