---
schema: trivium.review.v1
topic: M2-skills与闸门
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.0
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260910T221346Z
rerun_index: 2
snapshot_hash: sha256:3aa0e86588a701c3cd9d0928317eecd4308df7873a3da3c7f8fde466be67a546
blind: true
started_at: 2026-09-10T22:13:46.611Z
finished_at: 2026-09-10T22:25:08.370Z
duration_s: 130
tool_calls:
  read: 15
  grep: 5
  glob: 5
  run_command: 0
  project_reads: 15
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 0
degraded: false
parse_fallback: true
peer_deny: false
drift: true
heterogeneous: true
session_id: b5cf72af-19b5-43fc-978c-916a75bb57bb
---

# 计划审查：M2-skills与闸门

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260910T221346Z` ｜ 第 2 轮

> ⚠️ **解析降级**：本侧输出未能解析为结构化结论，下方为原文。该侧不参与阻断判定。
>
> ⚠️ **审查期间工作树发生漂移**：本结论对应送审时刻的快照，与当前工作树可能已不一致。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 原始输出（未能结构化解析）

```
{"agreed":["将双审长时调用拆分为 review --start 与 --wait 分段轮询协议，精准化解了 Claude Code Bash 工具 120s~600s 工具级超时与双审长时间运行的硬冲突。","Hook 闸门写锁采用「同会话 + 24h TTL」作用域（approval_lock_scope: session），准确契合 PRD 4.4 不得阻断开发者在同一仓库其它编辑的原则。","入口 skill 坚持薄壳架构并强制配置 disable-model-invocation: true，严格防范大模型自发循环触发昂贵审查。","主题锁采用 O_EXCL 原子文件创建并配以遗留锁检测回收，保障状态机并发一致性。","针对 Markdown 裁决表解析脆性提出全半角归一化与定位行号报错策略。"],"consulted":["skills/dual-critic/schema/review.v1.json",".reviews/M2-skills与闸门/plan/2026-09-11-M2-skills与闸门-claude.md","README.md","doc/README.md","doc/01_requirements/README.md","doc/02_design/README.md","doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md","doc/05_testing/REPORT_2026-09-11_m0_probe.md","src/install.ts","src/trivium/cli.ts","src/trivium/config.ts"],"findings":[{"confidence":"high","evidence":"在被审文档 .reviews/M2-skills与闸门/plan/2026-09-11-M2-skills与闸门-claude.md §2.1 与 §4(R-A) 中，作者提出「以 setsid/双 fork 派生工作进程」并以「detached: true + unref()」作为对策。但查验 Node.js 与 macOS 平台机制：1. Node.js child_process.spawn 底层仅执行单次 fork + setsid，原生并不支持 C 语言传统的「双 fork」；2. 若 spawn 时未显式将 stdio 重定向到独立文件描述符（如 worker.log）或 'ignore'，子进程将继承父进程管道。在 macOS 及 Claude Code Bash 子 shell 环境中，review --start 父进程立即退出会导致管道关闭，工作进程后续一旦输出心跳或日志，写入破裂管道将立即触发操作系统的 SIGPIPE 信号导致工作进程崩溃；3. 控制终端关闭时缺乏 SIGHUP 信号忽略（process.on('SIGHUP', () =\u003e {})）保护；4. 派生目标命令若未用 process.execPath 锁定 Node 绝对路径，在子环境中存在 PATH 漂移风险。","id":"AGY-01","kind":"concurrency","layer":"plan","location":".reviews/M2-skills与闸门/plan/2026-09-11-M2-skills与闸门-claude.md:§2.1,§4(R-A)","problem":"review --start 工作进程在 macOS 下的派生机制混淆了双 fork 概念，且缺失 stdio 彻底脱离与 SIGHUP 处理，父进程退出时管道破裂必然导致工作进程死于 SIGPIPE。","severity":"blocker","suggestion":"废弃模糊的「双 fork」措辞，规范化 Node.js 派生规约：使用 spawn(process.execPath, [triviumPath, 'review', '--worker', runId, ...], { detached: true, stdio: ['ignore', logFd, logFd] })，在派生后执行 child.unref()，并在工作进程内部注册 SIGHUP 忽略处理，确保彻底脱离控制终端与父进程管道。"},{"confidence":"high","evidence":"查阅被审文档 .reviews/M2-skills与闸门/plan/2026-09-11-M2-skills与闸门-claude.md §2.3、doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md §8.5 与 src/trivium/config.ts：1. 设计 §8.5 中注入的 Hook 命令为 ${CLAUDE_PROJECT_DIR}/.trivium/bin/trivium gate hook-pre-write。在未初始化的项目中，该 wrapper 文件物理上根本不存在。当 Claude Code 触发 PreToolUse 时，系统 shell 直接返回退出码 127（command not found），wrapper 脚本根本无法被执行，其内部的检测逻辑完全无法生效，导致 Claude Code 每次写入均向用户抛出红字 Hook 报错；2. 即使在有 .trivium 目录但未初始化的项目中，src/trivium/config.ts 的 loadCtx 在检测到缺配置时默认抛出 envError（退出码 69，见 src/trivium/cli.ts:204），而非静默返回退出码 0；3. 全局安装或 settings 污染未初始化项目时，缺乏在 shell 触发层的短路保护机制。","id":"AGY-02","kind":"contract","layer":"plan","location":".reviews/M2-skills与闸门/plan/2026-09-11-M2-skills与闸门-claude.md:§2.3","problem":"Hook 对未初始化项目 no-op 的边界未覆盖可执行文件缺失与入口抛错路径，会导致 Shell ENOENT (退出码 127) 或 envError (退出码 69) 破坏全局与外部项目。","severity":"blocker","suggestion":"在 Hook 命令定义层增加 shell 前置短路检查（例如 sh -c 'test -f \"${CLAUDE_PROJECT_DIR}/.trivium/bin/trivium\" || exit 0; exec \"${CLAUDE_PROJECT_DIR}/.trivium/bin/trivium\" ...'），并确保 gate hook-* 各子命令在初始化检查与 loadCtx 之前执行轻量级短路：只要检测不到有效的 .trivium/config.yaml 或 .trivium/state.json，立即静默 exit 0。"},{"confidence":"high","evidence":"在被审文档 .reviews/M2-skills与闸门/plan/2026-09-11-M2-skills与闸门-claude.md §2.3 中，仅对 hook-pre-write 明确了「同会话 + 24h TTL」作用域（approval_lock_scope: session），而对 hook-pre-commit（PreToolUse 匹配 git commit）完全没有界定作用域。结合 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md §8.5：「存在审查文档已落盘但裁决件缺失/不完整的阶段时 exit 2 阻断」。若直接全局扫描 .reviews/，只要仓库内存在任何历史遗留或未完成裁决的旧阶段，开发者的日常代码提交（如修复 unrelated typo 或工具脚本）将被无差别拦截（exit 2），严重违背 PRD 4.4「流水线不得自动继续，不是限制开发者在同一仓库的其它编辑」的原则。","id":"AGY-03","kind":"scope-drift","layer":"plan","location":".reviews/M2-skills与闸门/plan/2026-09-11-M2-skills与闸门-claude.md:§2.3","problem":"hook-pre-commit 拦截边界缺乏会话与主题隔离范围定义，极易误伤非流水线日常提交与历史分支操作。","severity":"major","suggestion":"在实施计划中明确 hook-pre-commit 的判定范围：仅当 state.json 记录了本会话（或显式激活主题）存在处于 review_done_awaiting_disposition 状态的未裁决阶段时才进行拦截；若当前无活跃流水线主题，必须直接放行（exit 0）。"},{"confidence":"high","evidence":"在被审文档 .reviews/M2-skills与闸门/plan/2026-09-11-M2-skills与闸门-claude.md §2.2 中，列出「硬失败：缺 id、多余 id...」，并提到「parse_fallback 侧按 \u003c前缀\u003e-F\u003cn\u003e 编号，只校验有裁决与理由，不参与阻断判定」。对照 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md §6.6 规则 8 与 §8.6 算法：当一侧触发 fallback 时，送审结果中没有结构化 findings，审查文档中只有 Driver 手工提取的 \u003c前缀\u003e-F\u003cn\u003e 编号。若直接执行 DEC.keys - IDS ≠ ∅（多余 id）校验，这些 fallback 编号必然不在审查文档的 IDS 中，从而直接触发「多余 id」硬失败！此外，当审查文档合法为空审（findings: []，见 skills/dual-critic/schema/review.v1.json）时，算法也须兼容空集合。","id":"AGY-04","kind":"correctness","layer":"plan","location":".reviews/M2-skills与闸门/plan/2026-09-11-M2-skills与闸门-claude.md:§2.2","problem":"裁决完整性校验硬规则未处理 parse_fallback 虚拟 ID 集合排除与空审 (findings: []) 边界，会导致误判硬失败。","severity":"major","suggestion":"补充 gate --check 的校验集合拆分逻辑：在计算多余 ID 差集前，先行滤除匹配 \u003c前缀\u003e-F\u003c序号\u003e 的 fallback 编号；单独对 fallback 编号校验「有裁决与非空理由」；并显式支持单侧或双侧 findings: [] 的空集通过。"},{"confidence":"high","evidence":"核对被审文档 .reviews/M2-skills与闸门/plan/2026-09-11-M2-skills与闸门-claude.md 全文：第 1 节列出完成判据，第 2 节列出交付物，第 3 节列出实施顺序，但全文没有一处规划测试套件或夹具。查阅当前测试树（test/unit/），现有测试仅覆盖了 M1 的部分工具函数。M2 涉及复杂的多进程派生（review --start/--wait）、心跳超时、进程失联模拟、Markdown 裁决表畸形解析、Hook 退出码与输出格式模拟等。若不事先规划模拟夹具与 node:test 测试用例，开发过程中极易遗漏关键边界。","id":"AGY-05","kind":"test-gap","layer":"plan","location":".reviews/M2-skills与闸门/plan/2026-09-11-M2-skills与闸门-claude.md:§3","problem":"实施计划完全缺失针对长时调用、状态机与 Hook 边界的自动化测试用例规划与夹具设计。","severity":"minor","suggestion":"在实施计划中增加测试规划章节，列明各交付物对应的测试文件与关键测试场景，特别是针对 mock worker 进程、心跳停顿（worker lost）、未初始化目录 hook 执行、以及各种畸形 Markdown 裁决表的回归用例。"},{"confidence":"medium","evidence":"在被审文档 .reviews/M2-skills与闸门/plan/2026-09-11-M2-skills与闸门-claude.md §2.5 中规定：「锁文件存在但 PID 不存在且时间戳早于 heartbeat_stale_s 时，视为遗留锁自动回收」。若工作进程因异常在启动初期（如第 5 秒）猝死，PID 已不存在，但时间戳尚未超过 120 秒，此时如果用户尝试重新发起 --start，将被系统误判为冲突（退出码 70），产生长达 120 秒的死锁窗口；且若 --wait 已识别到 worker_lost 并将状态落盘为 failed，主题锁却未能同步释放。","id":"AGY-06","kind":"maintainability","layer":"plan","location":".reviews/M2-skills与闸门/plan/2026-09-11-M2-skills与闸门-claude.md:§2.5,§4(R-A)","problem":"主题锁在工作进程异常崩溃时存在最长 120 秒的死锁重启窗口，且锁清理职责划分不完备。","severity":"minor","suggestion":"优化遗留锁判定逻辑：当发现 PID 物理不存在时（通过 process.kill(pid, 0) 返回 ESRCH 确认），若对应的 run_id 在运行目录下已被 --wait 判定为退出/失败，或者心跳文件不存在，无需强制等待 120 秒即可安全回收遗留锁。"}],"not_covered":["本次未在真实物理 macOS 环境中实际启动长时间后台 detached 进程并关闭父终端进行长时间存活性压测。","未对 Claude Code VS Code 插件在不同版本下对 PreToolUse 返回 JSON (permissionDecision) 的实际交互做外部网络抓包和断点核验。","未针对 Monorepo 或多工作区根目录混合配置场景进行全量 Hook 路径矩阵测试。"],"schema":"trivium.review.v1","summary":"最危险问题在于 review --start 工作进程派生混淆双 fork 且未重定向 stdio，父进程退出必因 SIGPIPE 猝死；且 Hook 在未初始化项目因 wrapper 文件缺失会导致 shell 报 exit 127 击穿 no-op 铁律。\n此外，hook-pre-commit 缺乏会话隔离易误伤日常提交，gate --check 硬失败未排除 parse_fallback 虚拟编号，计划通篇缺乏自动化测试规划。\n建议修订实施计划，补齐进程脱离规范、shell 短路防御、commit 隔离范围与测试套件设计后再开工。","toolAction":"Submit review report","toolSummary":"Submit review findings and verdict","verdict":"request-changes"}
```
