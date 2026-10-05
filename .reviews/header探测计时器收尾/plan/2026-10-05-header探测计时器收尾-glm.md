---
schema: trivium.review.v1
topic: header探测计时器收尾
stage: plan
role: glm
vendor: zcode
agent_cli: zcode/0.16.9
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
model_route: config_copy
run_id: 20261005T113659Z
rerun_index: 1
snapshot_hash: sha256:46b13edf2a026bacc8cd9fbfc813efd5ad39bd0cc1222816459542eec380af0b
blind: true
started_at: 2026-10-05T11:37:02.030Z
finished_at: 2026-10-05T11:48:17.367Z
duration_s: 675
tool_calls:
  read: 11
  grep: 11
  glob: 1
  run_command: 0
  project_reads: 18
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 2
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
heterogeneous: true
session_id: sess_5c280f5e-783d-496b-aab9-b0aa0f472a91
---

# 计划审查：header探测计时器收尾

> Critic-B · 智谱 ZCode ｜ 模型 `bigmodel-coding-plan/GLM-5.3`
> ｜ 运行 `20261005T113659Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

计划阶段审查（侧 glm，镜头：边界与失败路径、并发与幂等、验收可测性）。我对 §1 全部现状陈述做了逐项源码核对，全部命中：probeCodexHeader 行号与 stopEarly 轮询形态（codex.ts:411-477、453-462，兜底 461 行 unref 而轮询未 unref）、run 的兑现链路与不会 reject（exec.ts:168-349，finish 只清自家三计时器、stopEarly 在执行器 328 行同步调用、spawn 失败走 error 到 finish(null,null) 且 stderr 带 [spawn error]）、stopEarly 全仓唯一调用方（src 内仅 exec.ts 定义与 codex.ts:453，test 内零命中）、run-protocol 心跳确在 1095 行清理、probeCodex 五处调用行号（981、992、1002、1034、1055）、cli.ts 收尾只设 exitCode（2016-2028）、EV-199 假 codex 注释与写出（241-242 行）。D1-D6 逐条落实且不越界：BACKLOG EV-205 原文的两条修法方向与计划复述一致、不取理由经 grep 证实（这一族确实只有一个成员）；对象持有计时器句柄与 exec.ts terminateProcessGroup 里 st 对象是同一已知坑的既有对策；H1-H5 的结果断言与 CodexHeader 字段来源（exitCode=r.code、gotHeader=seen.size大于0、stderr=r.stderr、分隔线判据 seen.size 大于 0）逐一对得上，M1-M4 变异预期与代码路径推演一致，10s 阈值两侧余量论证成立；设计当前版本确为 v1.3.92（计划加 v1.3.93 正确），设计正文确无 header 计时细节，count-new.mjs、mutation-check.mjs、build.mjs 的 with-tests、scratchDir 前缀规则（trivium-hdrdrain- 合规）均存在且用法一致；§4.2 改前对照还兼作导入图无其它 keep-alive 句柄的对照实验（H4/H5 旧构建预期绿能自暴露这类干扰）。三条意见均不触及修法方向：一条 minor 在测试装置收尾的盲杀（pid 复用风险，与本仓既有纪律同形冲突），两条 nit 在 stopEarly 文档补文的例外缺失与 selftest 命令形态写错。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：次要 1 ｜ 吹毛求疵 2）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `被审计划 §4.1 装置收尾（拟新文件 test/unit/codex-header-drain.test.ts 的 finally）` |
| 类别 | concurrency ｜ 层次 plan |
| 置信度 | medium |

**问题**：收尾无条件读 fake.pid 并 process.kill(pid) 与 process.kill(-pid) 发组信号：测试父进程是假 codex 的祖父，不是它的父进程，未回收不可复用这条保护不成立，而方案不校验进程身份。绿路径与 M1/M2 的 H1-H3 里假 codex 早已退出，父侧是在等到 RETURNED 后又最多等 10 秒才收尾，此时按一个已死最长约 10 秒的裸 pid 发 SIGKILL（还按组杀）；变异预跑阶段构建进程高频派生，macOS PID 在窗口内绕圈复用并非杞人忧田，命中即误杀无关进程。这正是本仓架构纪律 6 与 EV-158 整套 lstart 比对要防的形态。

**依据**：src/trivium/util/exec.ts:700-716（killProcessTree 的安全前提是调用方为子进程之父、pid 未回收不可复用）；src/trivium/util/exec.ts:541-549 与 AGENTS.md 架构纪律 6（macOS 复用 PID，认身份必须比对启动时刻）；被审计划 §4.1 原文「读 fake.pid，在则 process.kill(pid, 'SIGKILL')（……一并 process.kill(-pid, 'SIGKILL')，吞掉 ESRCH）」未设任何前置条件。

**建议**：把按 pid 补杀限定在确实需要它的一支：drain 子进程是被父侧 SIGKILL 收掉或等待超时（假 codex 可能仍被孤儿化）时才按 pid 文件补杀，绿路径不杀；或把补杀放进 drain.mjs 自己做（它是假 codex 的真实父进程，子进程未回收则 pid 与组号不可能被复用），父进程只兜底 SIGKILL drain 子进程。

### GLM-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `被审计划 §3.2 拟补的 RunOptions.stopEarly 文档块文案（src/trivium/util/exec.ts:31-42）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：拟补文案断言「run 必然兑现（超时链路兜底），且不会 reject」，但 treeShutdown 置位后 run 返回永不兑现的 Promise、finish 也不 resolve——计划 §3.4 自己把这条列为边界却不带入文档补文。该文档块与冻结语义的文档块（exec.ts:147-154）同文件相距一百多行，未来 worker 侧调用方按这句写 try/finally 会以为 finally 恒跑。

**依据**：src/trivium/util/exec.ts:170（终止中返回永不 settle 的 Promise）；exec.ts:287-288（finish 在 treeShutdown 下不 resolve）；exec.ts:147-154（冻结语义只在 shutdownTrackedTrees 文档块里）；被审计划 §3.2 拟补文案与 §3.4 边界第一条。

**建议**：那句话补一个例外指向，例如「终止中（shutdownTrackedTrees 置位）时 run 永不兑现，见该函数文档块」，让契约文案与同文件已知边界不互相矛盾。

### GLM-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `被审计划 §4.4「本机 doctor 自检（trivium selftest，零配额）」` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：CLI 没有独立的 selftest 子命令，实际形态是 trivium doctor --selftest；照计划原文执行会退「未知子命令」。任务目标原文写的是「doctor 自检」，计划转写时把旗标升成了子命令。

**依据**：src/trivium/cli.ts:200（USAGE：trivium doctor --selftest [--keep-fixture] [--asset-root 路径]）；cli.ts:1983-2012（子命令 switch 无 selftest 分支，selftest 只是 doctor 的旗标）；被审计划 §4.4。

**建议**：§4.4 改写为 trivium doctor --selftest（按本仓已知坑，跑前先重装或直接指仓库构建产物）。

## 认为正确的部分

- D1 修在调用方（try/finally 清轮询、删 31 秒兜底、计时器句柄用对象持有）与仓库事实一致：经我 grep 核实 stopEarly 全仓唯一调用方就是 probeCodexHeader（src 内仅 exec.ts 定义与 codex.ts:453），run 的兑现链路（30 秒超时到 SIGTERM 到 5 秒宽限到 SIGKILL 到 close 或 exit 后 2 秒兜底）、不会 reject、spawn 失败走 error 到 finish(null,null) 且 stderr 带 [spawn error]，逐条与 exec.ts 相符；对象持有句柄与 exec.ts terminateProcessGroup 的 st 对象（799 行注释自认同一 TS 收窄坑）是仓内既有对策。
- 不取 BACKLOG 两条修法方向的理由成立：BACKLOG EV-205 原文（doc/08_project/BACKLOG.md:303）的两条方向与计划复述逐字对应，「这一族全仓只有一个成员」经 setInterval 全仓 grep（仅 codex.ts:454 与 run-protocol.ts:994）与 stopEarly grep 证实；run-protocol 心跳确已在 1095 行清理，不在本题。
- H1-H5 的结果断言与 CodexHeader 组装逐一对得上（exitCode 取 r.code、gotHeader 为 seen.size 大于 0、stderr 取 r.stderr、分隔线只在 seen 非空时置 sawDivider、被信号结束时 code 为 null），M1-M4 变异的预期红绿与代码路径推演一致，H3 在旧代码上也确实挂轮询（spawn 的 ENOENT 是异步 error，stopEarly 在执行器 328 行已同步调用），§4.2 对改前红绿分布的预期成立。
- 10 秒阈值的两侧余量论证合理；边界两条（终止冻结、30 秒探测期内轮询照转）如实写明且不扩大范围，与 exec.ts 的 treeShutdown 语义相符。
- 文档步骤与仓库现状一致：设计当前版本确为 v1.3.92（计划加 v1.3.93 顺延正确）、设计正文确无 probeCodexHeader 计时细节（仅 v1.3.83 版本记录提及）、count-new.mjs 与 evidence 目录存在、mutation-check.mjs 的七道闸与 find 唯一命中要求存在、build.mjs 支持 with-tests 且 src 转译到 dist/test（drain.mjs 的导入路径成立）、scratchDir 前缀规则接受 trivium-hdrdrain-。
- §4.2 改前对照兼作对照实验：H4/H5 在旧构建预期绿，若 codex.js 导入图本身持有 keep-alive 句柄，H4/H5 会在旧构建上就红，装置能自暴露这类与 EV-205 无关的干扰。

## 未覆盖范围（本侧盲区）

- 本侧只读，未执行任何构建、测试或计时：修好后 drain 为毫秒级、漏清时约 29 至 31 秒等耗时判断均为基于源码的推演，未实测。
- 未核实 trivium doctor --selftest 的 14 步桩路径里是否会实际走到 probeCodexHeader，§4.4 自检对该修复本身的覆盖有效性未判定（仅视为回归确认）。
- drain.mjs 与假 codex 脚本尚无代码，stdio 管道形态、RETURNED 行的读取实现、FAKE_MODE 传参等细节留待代码阶段审。
- doc/05_testing/README.md 登记条目的具体格式未逐字核对（由 doc-archive-index 契约测试把关）。
- npm test 全量在本机当前的通过状态未验证；工作树与快照一致这一前提取自任务书自述。

## 实际查阅的项目文件

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/probes/codex.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/cli.ts`
- `src/trivium/run-protocol.ts`
- `test/unit/probe-fixture-cleanup.test.ts`
- `test/helpers/fixture.ts`
- `test/helpers/scratch.ts`
- `scripts/build.mjs`
- `scripts/mutation-check.mjs`
- `.reviews/header探测计时器收尾/plan/2026-10-05-header探测计时器收尾-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":11,"grep":11,"glob":1,"run_command":0,"project_reads":18}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
