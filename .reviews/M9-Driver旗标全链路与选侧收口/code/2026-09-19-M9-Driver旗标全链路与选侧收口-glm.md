---
schema: trivium.review.v1
topic: M9-Driver旗标全链路与选侧收口
stage: code
role: glm
vendor: zcode
agent_cli: zcode/0.16.5
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
model_route: config_copy
run_id: 20260918T165302Z
rerun_index: 1
snapshot_hash: sha256:c972dd3b48f0656dc39272b34840ec2d76a49b4454b3bde17cdc5a19caadb79b
blind: true
started_at: 2026-09-18T16:53:03.054Z
finished_at: 2026-09-18T17:06:19.146Z
duration_s: 796
tool_calls:
  read: 15
  grep: 9
  glob: 0
  run_command: 0
  project_reads: 14
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
heterogeneous: true
session_id: sess_cff1990f-35c7-48b6-a5f4-060f43c15e8b
---

# 代码审查：M9-Driver旗标全链路与选侧收口

> Critic-B · 智谱 ZCode ｜ 模型 `bigmodel-coding-plan/GLM-5.3`
> ｜ 运行 `20260918T165302Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最危险的一条：T-11 未落地使 r2 阻断（非缺省 Driver 下闸门硬失败）的复发面只靠源码扫描看守，扫描抓得住「接线被删」、抓不住语义回归（latest 选错、pinned/latest 优先级颠倒、gateDriver 与轮次组合错位），本步完成判据 C4/V9 未满足，判 major 且必须补。代码本体未见阻断级缺陷：cmdGate 两条路径的回落均已定义（--run-id 读不出→硬拒并说明三种成因；无旗标且无留痕→--check/--await-approval 硬失败），唯 --check-artifacts 在「留痕存在但全部读不出」时静默按缺省 Driver 继续，与 meta.ts 文档块的承诺不符（GLM-02 minor）；另有一处无旗标时「本轮」语义的收窄未覆盖（GLM-03 minor）。焦点二核实为一致：两个同形函数在显式硬拒、自动过滤、剔空点名、退出码与文案上逐项相同。typecheck 通过。

**结论**：`request-changes`

## 审查意见（共 3 条：重要 1 ｜ 次要 2）

### GLM-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/integration/gate-loop.test.ts（全文件）；对照计划 §4.4 T-11 / §2.3 C4 / §10 V9` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：T-11 未实现：非缺省 Driver 的闸门闭环没有任何端到端覆盖。现存 gate-loop.test.ts 的全部用例都走缺省 Driver——writeDisposition 写死 -revised-claude.md（gate-loop.test.ts:76），桩配置只有 {gemini, glm}（:27），全文件无一处 --driver。driver-wiring.test.ts 对闸门区只做源码扫描（断言 cli.ts 无 inferLatestRunId、checkAdjudication 实参块含 driver、checkStageArtifacts 含 gateDriver），它能抓住「接线被字面删除」，抓不住语义级回归：latestRunMeta 选错来源、pinned 与 latest 的优先级颠倒、gateDriver 与 rerun_index 的组合错位、--check-artifacts 回落路径的行为，扫描全绿时这些照样可以坏。本步的存在理由正是 r2 的阻断 AGY-01（非缺省 Driver 且 --critics claude 时闸门以「请先跑一次双审」硬失败），这一格的自动回归锁现在不存在。回答开发者的问句：缺口必须补——C4 是本步自己立的完成判据（V9 对应 T-11），且补的成本极小：在 gate-loop 现成骨架上加一条带桩用例（桩配置按 R-8 点名 claude 侧），覆盖两格即可：裁决件未写出时 gate --check 精确报 missing_disposition 且文案指名 -revised-<真Driver>.md（不是「找不到运行元数据」），补写裁决件后同命令通过。

**依据**：读 test/integration/gate-loop.test.ts 全文核实：27 行 STUB 无 claude、76/97/148 行等全部裁决件均为 -revised-claude.md、runPlan 不带 --driver；被审 diff 的 20 个文件里没有 gate-loop.test.ts；test/integration/driver-flag.test.ts（diff 内）只覆盖 topic resolve 选侧与退 64，无 gate 子命令；test/unit/driver-wiring.test.ts（diff 内）「闸门区」一条为纯源码断言；计划 r3 §4.4 将 T-11 落在 gate-loop.test.ts、§2.3 C4 与 §10 V9 均指向它、§11 提醒 1 承认 latestRunMeta 未实跑验证。

**建议**：按计划原样补 T-11：在 gate-loop.test.ts 加一条非缺省 Driver 用例（makeFixture 后先落一份 <日期>-<主题>-<SELECTABLE[0]>.md 原稿，runPlan 经 --driver 与 --critics claude，桩配置显式含 claude），断言两格：裁决件未写出时 --check 退 GATE_BLOCK 且失败文案含 -revised-<driver>；补齐裁决件（front-matter run_id 对上）后 --check 退 0。若本步内确实排不下，至少在 BACKLOG 具名登记并降级 C4 的表述，不要让 V9 静默消失。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/cli.ts:770-818（cmdGate 的 --check-artifacts 分支）；对照 src/trivium/meta.ts:363-367` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：latestRunMeta 返回 null 时，--check-artifacts 路径静默按缺省 Driver 与旧口径轮次继续：gateDriver = latest?.driver ?? DEFAULT_DRIVER、roundCritics = undefined（checkStageArtifacts 回落 DEFAULT_CRITICS）。而 meta.ts 的文档块明写「全都读不出来才返回 null——调用方据此硬失败并点名，不回落缺省 Driver」。该承诺只在 --check 与 --await-approval 成立（runId 为 null 时 throw）；--check-artifacts 既不硬失败也不打告警。cli.ts 里那条注释把回落条件写成「一条留痕都没有时才退回旧口径」，但 latestRunMeta 返回 null 的实际条件还包括「留痕存在但全部读不出」（损坏/被清）——那一格正是回落会把「留痕坏了」悄悄变成「按 claude 判」的形态。触发面窄（该阶段 run-*.json 全损而工件还在），但这是本函数要消灭的静默取缺省在自己身上留的一个角。

**依据**：读 src/trivium/cli.ts:770-818：latest 为 null 时 gateDriver 取 DEFAULT_DRIVER，--check-artifacts 分支无任何 warn 或 throw；读 src/trivium/meta.ts:369-387：latestRunMeta 在 readdir 失败与全部 readRunMeta 为 null 两种情况下都返回 null，文档块（:365-367）承诺调用方硬失败不回落；读 src/trivium/archive.ts:318-338：critics/driver 两参数分别回落 DEFAULT_CRITICS / DEFAULT_DRIVER。

**建议**：二选一并保持口径一致：要么在 --check-artifacts 分支检测「metaDir 存在但 latest 为 null」时打一条 warn 点名「运行元数据全部不可读，按缺省 Driver 与旧口径校验」，要么对齐文档把该格也硬失败。同时把 cli.ts 那条「一条留痕都没有时」的注释改为与 latestRunMeta 的真实返回条件一致。

### GLM-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/cli.ts:770-778（latest 与 rerunIndex 的取值）；src/trivium/meta.ts:236（骨架先写）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：无 --run-id 时「本轮」的定义发生了未声明的语义收窄：旧口径是「已产出审查工件的最新一轮」（resolveRerunIndex-1，只数工件），新口径是「最新一次运行」（latestRunMeta，含 prepareRun 先落的 running 骨架）。可构造场景：第 N 轮已完整结束（审查+裁决齐备、闸门回 idle），用户再起一轮、worker 在产出任何工件前崩溃（worker_lost 是实测存在的路径，gate-loop.test.ts:699 有专测）——此后 gate --check / --check-artifacts / --await-approval 无旗标调用全部指向那件工件都没有的 N+1 轮骨架并报缺件，而旧代码会校验完整的第 N 轮。代码注释声称 rerun_index「才是『工件实际落在第几轮』的记录」对骨架不成立——骨架记的是意图轮次。该形态无任何测试覆盖，且 --check-artifacts 的失败文案不提示存在更早完整轮次或 --run-id 出口。

**依据**：对比被审 diff 中被替换的旧实现（resolveRerunIndex-1 只数工件，archive.ts:65-83 证实只看带角色后缀且非 Driver 的工件）与新实现（cli.ts:770-778 直取 latest.rerun_index）；meta.ts:236 注释「运行开始时先写一份 status: running 的骨架」证实崩溃运行会以骨架形式成为 latest；gate-loop.test.ts:699-753 证实 worker 中途被杀是受支持的真实路径，且全文件无非缺省 Driver 或崩溃骨架后 gate --check 的用例。

**建议**：不改行为也可接受（指向最新一次运行说得通），但要把事实写对：cli.ts 那条「工件实际落在第几轮」的注释改为「最新一次运行声明的轮次（崩溃骨架记的是意图轮次）」；并让 --check-artifacts 的失败输出在缺件时给出 --run-id 出口（--check 已有先例）。是否进一步让 latestRunMeta 跳过无工件的崩溃骨架由 Driver 裁决——那会重新引入按工件反推的味道，不建议。

## 认为正确的部分

- 闸门区弃后缀反推、直读运行元数据的方向正确：inferLatestRunId 的循环依赖论证属实（gate.ts:736-751 的跳过逻辑确实要先知道 driver），@deprecated 登记 + EV-64 的处理克制且留了审计线索；run.v2 必填性核实无误（schema required 数组同时含 driver 与 rerun_index），v1 记录经 migrateRunMetaV1 补 DEFAULT_DRIVER 的映射与史实一致。
- 焦点二核实为一致：topic.ts locateSubject 与 topic-args.ts locateSubjectReadOnly 在显式路径的解析规则、exists→isReviewArtifact 的次序、硬拒文案（逐字相同）与退出码（missingArtifact 与 TriviumError(EXIT.MISSING_ARTIFACT) 均为 65，exit-codes.ts:18/45 证实）、自动候选的过滤条件（topic 匹配 + role===driver + kind===null）、排序、审查件剔除循环、剔空点名文案上逐项相同；两处差异（目录缺失时的报错形态）系改动前既有且已在文档块说明。
- isReviewArtifact 的取舍论证扎实：实测 render.ts:394-403 的 parseFrontMatter 对不以 --- 开头 / 无闭合 / YAML 坏三类均返回 null 且不抛，四类损坏形态坍缩为放行的边界描述与实现吻合；不复用三值 fail-closed 的 classifyArtifact 的理由（分层、逃生门、模块私有）成立；残余风险 EV-63 如实登记而非掩盖。
- EV-53 收口正确：selectableCritics 单点派生 + legalList 与 --model-<id> 白名单共用，「报错里不得列出刚被拒的那家」的负例（topic-args.test.ts）与「换 Driver 后原 Driver 可指定模型」的正例互为镜像，两条都钉住了「论域跟着当轮 Driver 变」而不是又一份写死清单。
- driver_enabled 走可选字段、不进 required、不加 if/then，并配「历史留痕删字段后仍须读得回」的回归锁（run-meta.test.ts），与本仓「schema 只校形状」的纪律一致，是本步唯一不可逆选择的正确处理。
- 交接文件的防线分层清楚：Handoff.options.driver 类型必填（编译期）+ handoffDriver 运行期回落取 meta.driver 并打可见告警（而非猜 DEFAULT_DRIVER），旧版交接文件的恢复路径有真实兜底。
- driver-wiring.test.ts 把判据自身写成可执行并配自测（单行块注释剥离、词边界区分 driverEnabled/gateDriver、freeze 实参块真实语料回验），针对「上一轮判据永绿」的失效形态有实质防御，质量高于一般扫描用例。
- typecheck 实跑通过（tsc --noEmit），本 diff 无编译层问题。

## 未覆盖范围（本侧盲区）

- 未实跑单元/集成测试（只读审查：未 npm run build、未 node --test；仅跑了 tsc --noEmit），对断言实际绿红的判断基于对源码与用例文本的核对。
- preflight.ts 只读了 diff 与新增用例涉及的提示段，runPreflight 全函数中该提示与既有检查项（短路顺序、exitCode 汇总）的相互作用未逐行复核。
- freeze.ts / deny-matrix 的 driver 参数语义、hooks.ts / state.ts / approval.ts / verify.ts / report.ts 等未在本次改动面内的模块未逐行重读。
- M9 第 6 步验收（真实 CLI 端到端实跑）不在本次审查范围；本仓 .reviews/ 归档中 84 份留痕的 run_id 形态未逐一抽样验证「字典序即时序」（采信了 newRunId 的构造保证与计划的实测声明）。
- 按禁读清单未读另一位审查员的任何产出与 /Users/chenzhenbo/.trivium/runs 下他人子树。

## 实际查阅的项目文件

- `.reviews/M9-Driver旗标全链路与选侧收口/code/_meta/changes-20260918T165302Z.diff`
- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-r3-claude.md`
- `src/trivium/cli.ts`
- `src/trivium/meta.ts`
- `src/trivium/critics.ts`
- `src/trivium/topic.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/archive.ts`
- `src/trivium/gate.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/render.ts`
- `src/trivium/exit-codes.ts`
- `skills/dual-critic/schema/run.v2.json`
- `test/integration/gate-loop.test.ts`
- `test/helpers/fixture.ts`
- `test/unit/critics.test.ts`
- `test/unit/driver-wiring.test.ts`
- `test/unit/topic.test.ts`
- `test/unit/topic-args.test.ts`
- `test/unit/run-meta.test.ts`
- `test/unit/preflight.test.ts`
- `test/unit/deny-matrix.test.ts`
- `test/integration/driver-flag.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":15,"grep":9,"glob":0,"run_command":0,"project_reads":14}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
