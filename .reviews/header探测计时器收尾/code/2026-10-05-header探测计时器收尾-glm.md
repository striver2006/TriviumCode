---
schema: trivium.review.v1
topic: header探测计时器收尾
stage: code
role: glm
vendor: zcode
agent_cli: zcode/0.16.9
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
model_route: config_copy
run_id: 20261005T120550Z
rerun_index: 1
snapshot_hash: sha256:0eb090b82336bbefdc174ade38470f685c3ed69f1acc3ed73e448a2a780ebf19
blind: true
started_at: 2026-10-05T12:05:53.830Z
finished_at: 2026-10-05T12:17:34.737Z
duration_s: 483
tool_calls:
  read: 20
  grep: 5
  glob: 0
  run_command: 0
  project_reads: 23
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: sess_c933afa8-8073-411f-b56d-c0cb8c165133
---

# 代码审查：header探测计时器收尾

> Critic-B · 智谱 ZCode ｜ 模型 `bigmodel-coding-plan/GLM-5.3`
> ｜ 运行 `20261005T120550Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

EV-205 的修法核过是对的：probeCodexHeader 把 await run 包进 try/finally、轮询句柄用对象持有（避开闭包赋值 let 在 finally 里被 TS 收窄的坑），31 s 兜底删去后清理由 run 兑现兜底。我对照 src/trivium/util/exec.ts 逐条核实了新补契约的三个事实：run 的 Promise executor 只 resolve 从不 reject（spawn 失败走 error 事件进 finish）；stopEarly 在 executor 内同步调用，任何兑现路径发生前轮询必已挂上，finally 不会漏；treeShutdown 确是唯一不兑现分支且 shutdownTrackedTrees 文档块与所指一致。问题陈述的「CLI 收尾只设 process.exitCode、靠事件循环排空退出」属实（cli.ts 全文件无 process.exit 调用，main().then 只赋 exitCode）；「stopEarly 全仓唯一调用方」经检索确认（src 下仅 exec.ts 定义与 codex.ts:463 一处使用）。新测试有真实咬合力：drain 子进程打出 RETURNED 后不强退、靠事件循环自然排空，漏清时排空约 30 s 会撞 10 s 上限——改前对照证据（H1～H3 红、H4/H5 绿）、变异 4/4（M1/M2 咬 H1～H3、M3 咬 H4/H5、M4 咬 H5，变异锚点与源码逐一相符）、全量 2831/2829/0/2、临时目录仅 1 个已知的 trivium-index-、排空实测旧 30 647 ms 新 2 ms，全部与报告读数一致；before-fix.sh 确系 git archive b5f52ca 叠加新测试就地构建。文档同步齐：设计 v1.3.93、doc/05_testing/README 新条目均已在盘上核实，BACKLOG EV-205 结案带残余说明。实现与计划 r2 逐条一致，报告 §3 声明的两处出入（自检命令按 r2 已修正口径、计划外补了一份不设上限的排空实测）如实且无害。唯一意见是 stopEarly 文档块「必然兑现」一句漏了 timeoutMs 前提（GLM-01，minor）。

**结论**：`approve-with-nits`

## 审查意见（共 1 条：次要 1）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/util/exec.ts:44` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：新补的 stopEarly 文档块写「除终止中外 run 必然兑现（超时链路兜底），且不会 reject」，但没写明这条保证的前提是调用方给了 timeoutMs。按实现：只有 timeoutMs>0 才挂软/硬超时计时器（exec.ts:341），finish 只由 close、exit 后 2 s 兜底与 error 事件触发（exec.ts:287-323）；而 RunOptions.timeoutMs 的注释明写「0 或省略表示不限时」。于是 timeoutMs 省略或为 0、子进程又永不退出时，run 永不兑现、调用方的 finally 不跑——回调里挂的计时器就此漏清，恰是 EV-205 要收的那一类问题。今天唯一调用方 probeCodexHeader 恒传 30_000，行为无恙；但这块文档正是将来 stopEarly 调用方要读的契约面，无条件措辞可能把这一族问题原样引回来。

**依据**：src/trivium/util/exec.ts:16（timeoutMs「0 或省略表示不限时」）、exec.ts:42-46（新补文档块原句）、exec.ts:287-323（finish 仅由 close/exit/error 触发）、exec.ts:341-347（仅 timeoutMs>0 挂超时链路）；src/trivium/probes/codex.ts:449（现调用方恒传 30_000）

**建议**：在该句补一个前提限定，例如「在给了 timeoutMs 的前提下，除终止中外 run 必然兑现（超时链路兜底）」，或在 timeoutMs 字段注释里互引这一前提；纯文档改动，不动实现。

## 认为正确的部分

- 修法与计划 r2 §3.1 逐字一致：try/finally + 对象持有句柄、删 31 s 兜底、回调内 clearInterval 保留为优化且报告如实声明删掉它是等价变异
- exec.ts 新文档块的三条契约声明与实现相符：只 resolve 不 reject；stopEarly 在 Promise executor 内同步调用（兑现前轮询必已挂上，finally 不漏）；终止中永不兑现的例外与 shutdownTrackedTrees 文档块互指一致
- 「CLI 收尾只设 process.exitCode、靠事件循环排空」属实：cli.ts:2016-2029 main().then 只赋 exitCode，全文件无 process.exit 调用——漏清轮询确实会拖住 doctor 收尾，问题陈述成立
- stopEarly 全仓唯一调用方属实：检索 src 仅命中 exec.ts 定义与 codex.ts:463 使用，「给单个调用点造契约层抽象」的否决理由（D2）成立
- 新测试非空转：drain 子进程打出 RETURNED 后无任何强退与清理逻辑、靠事件循环自然排空（test/unit/codex-header-drain.test.ts:59-64），漏清时排空约 30 s 撞 10 s 上限；假 codex 收尾分工（ppid 自查 + 40 s 自毙，父侧只兜底直接子进程）安全且不留遗孤
- 证据链自洽：before-fix-output（H1～H3 红 10.1～10.4 s、H4/H5 绿且排空 2 ms）、drain-time（旧 30647 ms/新 2 ms）、mutation-output 与 mutation-spec（4/4，锚点与源码相符，find 唯一性与特殊替换模式有生成脚本守着）、check-1-pre-s6（2831/2829/0/2）、count-new（仅 1 个 trivium-index-，与 EV-204 残余五口径一致）均与报告读数一致
- 文档同步齐备：设计 v1.3.93 与变更行、doc/05_testing/README 新条目（磁盘核实，顺序口径由全量里通过的 doc-archive-index 契约测试守着）、BACKLOG EV-205 结案带两条残余、报告与证据目录同批送审，符合改动同步清单
- 边界声明诚实：30 s 超时期间轮询照转（探测未结束，非漏清）与 worker 终止冻结两格无用例覆盖，报告 §5 与代码注释均如实写明

## 未覆盖范围（本侧盲区）

- 本侧无执行能力，全部结论基于读码与证据文件核对，未复跑任何构建/测试/变异/自检；「必然兑现」「排空 2 ms」等运行期断言采信证据文件与代码结构推理，未独立实测
- 计划双审轮 run 20261005T113659Z 的审查件与裁决按禁读清单未读，设计变更行与报告中引用的双审结论（三家 verdict、6 条全接受）未独立核实
- 真实 codex CLI 行为（本机 0.160 对未知 profile 与伪造档位不拒、报告称眼下碰不到漏清路径）未实测，采信计划与报告记载
- 被审 diff 文件本体超出单次读取上限，我按其头部 20 文件清单逐一读了工作树对应文件与关键证据代替；mutation-names-log.txt、mutation-names.mjs 两份证据未逐行读（其汇总件 mutation-names-output.json 与 mutation-output.txt 已核）
- BACKLOG.md 的 EV-205 结案条目只经任务书内嵌的 diff 节选核过，未从盘上另读全文；dist/ 构建产物与 skills/ 渲染产物未逐字节核对（以全量 check 绿为佐证）
- worker 终止冻结（treeShutdown）路径的实际行为是读码推理，无用例亦未实测

## 实际查阅的项目文件

- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/README.md`
- `doc/05_testing/evidence/codex-header-poll-20261005/before-fix-output.txt`
- `doc/05_testing/evidence/codex-header-poll-20261005/before-fix.sh`
- `doc/05_testing/evidence/codex-header-poll-20261005/check-1-pre-s6.txt`
- `doc/05_testing/evidence/codex-header-poll-20261005/count-new-check-1-pre-s6.txt`
- `doc/05_testing/evidence/codex-header-poll-20261005/drain-time-output.txt`
- `doc/05_testing/evidence/codex-header-poll-20261005/drain-time.mjs`
- `doc/05_testing/evidence/codex-header-poll-20261005/gen-mutation-spec.mjs`
- `doc/05_testing/evidence/codex-header-poll-20261005/mutation-names-output.json`
- `doc/05_testing/evidence/codex-header-poll-20261005/mutation-output.txt`
- `doc/05_testing/evidence/codex-header-poll-20261005/mutation-spec.json`
- `src/trivium/cli.ts`
- `src/trivium/probes/codex.ts`
- `src/trivium/util/exec.ts`
- `test/unit/codex-header-drain.test.ts`
- `test/unit/probe-fixture-cleanup.test.ts`
- `.reviews/header探测计时器收尾/plan/2026-10-05-header探测计时器收尾-r2-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":20,"grep":5,"glob":0,"run_command":0,"project_reads":23}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
