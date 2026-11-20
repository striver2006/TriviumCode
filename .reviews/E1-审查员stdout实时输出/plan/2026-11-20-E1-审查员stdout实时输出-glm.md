---
schema: trivium.review.v2
topic: E1-审查员stdout实时输出
stage: plan
role: glm
vendor: zcode
agent_cli: zcode/0.17.3
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
effort_requested: null
effort_effective: null
effort_effective_source: null
tier: null
tier_source: legacy
model_route: config_copy
run_id: 20261120T025550Z
rerun_index: 1
snapshot_hash: sha256:a088b439ae58f09317a7474872e5885e757ab80abcdf0137ea61b55099b9fb8b
blind: true
started_at: 2026-11-20T02:56:00.606Z
finished_at: 2026-11-20T03:13:56.306Z
duration_s: 1029
tool_calls:
  read: 19
  grep: 10
  glob: 4
  run_command: 0
  project_reads: 22
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 1
  minor: 2
  nit: 0
degraded: true
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: unknown
access:
  requested_mode: standard
  profile: null
  launcher_requested: /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
  launcher_effective: /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: glm
    status: unknown
    left_model: null
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: null
    right_source: trace
    reason: 左侧模型信息缺失
  - left: glm
    right: gemini
    status: unknown
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: null
    left_source: trace
    right_source: null
    reason: 右侧模型未回读
  - left: glm
    right: claude
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: qwen4-max
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / qwen
override_reason: 左侧模型信息缺失
session_id: sess_429bd42f-1736-4a0d-b3f0-b7e2d7304ed1
---

# 计划审查：E1-审查员stdout实时输出

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261120T025550Z`
> ｜ 本轮审核者 glm、gemini、claude

> ⚠️ **本次为降级轮次**：有入选审核者未能完成，本结论不构成本轮预期的完整多审。实际完成情况见抬头的审核者清单与 run 元数据的 `degraded_reason`。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

被审计划对现状的陈述与代码逐点相符（runOneSide/scrubSideDir/stashVoidedOutput、exec.ts 的 setEncoding/ptyOutputNormalizer/appendOut/32MiB 字符上限、claude 返回前 scrubGatewayEnv→redactSecrets、codex/zcode/agy 原文落盘后靠事后 scrub 兜底、statusWatch 末尾字节窗口、cockpit onLog→pushRuns、Phase 4 五万行注入仅对照均核实无误），验收与性能判定方法可复算，硬闩锁用例正面对应任务目标三.1 的真流式通过条件。主要问题是 E1 的 attempt 改名/搬迁文件落在事后脱敏兜底的固定名清单之外，这一防御纵深缺口在计划中未做决定；另有两处次要遗漏（E1 状态记录的契约同步归属、Windows 立场）。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 3 条：重要 1 ｜ 次要 2）

### GLM-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划「核心 3」（写入沿用 stdout.json/jsonl、重试前按 attempt 改名、处理 stashVoidedOutput 搬迁；scrub 审计计数回归核对）` |
| 类别 | security ｜ 层次 plan |
| 置信度 | high |

**问题**：事后脱敏兜底的扫描面只认固定文件名：scrub.ts:77 的 ORCHESTRATOR_LOG_FILES 仅含 stdout.jsonl/stdout.json/trace.json/rollout.jsonl，scrubSideDir（scrub.ts:393-397）按「侧目录层 + out/ 层」的固定名扫描，redactVoidedAttempts（scrub.ts:505-528）在 voided/<侧>/attempt-n/ 内也只扫这四个固定名。E1 引入「每次尝试专属文件身份」与「重试前把上次文件按 attempt 改名保留」后，改名文件（以及搬迁进 voided 后带 attempt 后缀的文件）不匹配任何一层清单，事后 scrub 兜底对这类文件静默失效。当前体系里这层兜底正是「流式脱敏漏了一条形态」时的最后防线（review.ts:2525 注明作废搬迁发生在强制抹除之后，redactVoidedAttempts 的注释写明它补的就是「那次抹除失败」的情形）；计划只用「scrub 审计计数回归核对」带过，没有决定改名文件是否进扫描集，也没有把「流式脱敏等价性是唯一防线」这一取舍写明并让验收的终态哈希核对覆盖各 attempt 文件（而不只当前 canonical 文件）。按现计划实施后，流式脱敏器一旦有 batch scrub 能拦住的漏网形态，历史 attempt 文件将无人再扫。

**依据**：src/trivium/scrub.ts:77（ORCHESTRATOR_LOG_FILES 固定四名）、src/trivium/scrub.ts:393-397（sideDir+out 两层固定名扫描）、src/trivium/scrub.ts:505-528（voided 目录内仍按固定名）、src/trivium/review.ts:2519-2531（stashVoidedOutput 整目录搬迁与「固定文件名」注释）、被审计划「核心 3」的改名与搬迁条款。

**建议**：在计划「核心 3」明确该取舍：要么让 E1 的 attempt 改名文件（含 voided 内的）继续进入由写入点同源派生的事后扫描集（与 run-files/scrub 现有「清单与写入点同源」的纪律一致），要么明示流式脱敏等价性（分割点穷举性质测试）为唯一防线、固定名兜底不再覆盖历史 attempt 文件，并让「终态以预期脱敏数据的完整字节、顺序和哈希核对」显式覆盖各次 attempt 的文件。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划「核心 3」能力/状态记录 与「交付」段` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：每次尝试派发前发布的能力/状态记录（格式版本、尝试号、受支持文件名、状态）是核心写、插件读的跨进程机器可读契约，但计划未决定它的形状治理归属：是否需要进 skills/dual-critic/schema/（并联动 parse/gate/meta 校验与 registry-parity 的 schema 目录扫描）、是否回补 doc/03_api/PROTOCOL_dual_critic_relay.md 与 skills/dual-critic/SKILL.md。「交付」段只列了中文手册、设计文档、验收报告与 doc/05_testing/README.md 的同步，AGENTS.md 改动同步清单里「JSON Schema（含新增一份）」一行的义务未被点名。跨进程契约不登记同步义务，后续任一侧改格式都容易单边改。

**依据**：被审计划「核心 3」「交付」段；AGENTS.md「改动同步清单」JSON Schema 行；doc/02_design/README.md 对 PROTOCOL_dual_critic_relay.md 对外契约定位的描述。

**建议**：在计划交付段为 E1 状态记录补一句契约归属：要么声明它属核心内部面、格式仅记入设计文档（并说明为何不进 schema 目录），要么登记进机读契约与对应同步清单。

### GLM-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划「核心 4」与「性能目标与判定」` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：E1 引入的文件监听、attempt 改名轮转、0600 权限、短写处理都有平台差异（Windows 的目录变更通知/rename 语义、0600 近似无效等），本仓明确支持 Windows 原生且 src/trivium/util/platform.ts 是既定平台差异落点，npm run check 也会在 Windows 上执行。计划通篇未写 E1 在 Windows 的支持或暂缓立场，也没把平台差异归入改动位置；若实现默认按 macOS 语义写，Windows 侧测试与用户将踩未声明的行为。

**依据**：README.md（macOS 与 Windows 同套代码、Windows 硬前置 Git for Windows）；src/trivium/util/platform.ts 存在且承载平台差异；被审计划全文无 Windows 字样。

**建议**：在计划中写明 E1 的 Windows 立场（本阶段仅 macOS 验收则声明暂缓并列进 Bug 清单，或实现时把差异落点收敛到 platform.ts），避免实现期隐式平台假设。

## 认为正确的部分

- 现状陈述与代码一致：runner.ts:135-268 的 runOneSide（attempt/证据检查/作废搬迁/重试/每次尝试后 scrubSideDir）、exec.ts:596-611 appendOut 按 JS 字符串长度 32MiB 截断（exec.ts:103）、onStdoutLine 丢弃空行与换行符（exec.ts:609）、close 或退出两秒宽限收尾（exec.ts:660-668）、claude.ts:575-595 invokeClaude 返回前 scrubGatewayEnv→redactSecrets 后 claude.ts:1145 落盘、zcode.ts:1342 stdout.json、codex.ts:745 与 agy.ts:402/426 原文落盘后靠事后 scrub 兜底——「先写后抹窗口」的判断成立，E1 写前脱敏方向正确。
- 插件侧现状陈述属实：statusWatch.ts:214-231 tailLog 按 logTailBytes 末尾字节窗口重读 worker.log（且现实现确实不处理窗口起点跨 UTF-8 字符，计划要求 E1 处理是对的）、cockpit.ts:1386/1433-1435 attachRun 与 onLog→pushRuns、cockpitHtml.ts:310 renderRuns、Phase 4 报告确认五万行为直接注入仅滚动对照。
- 能力/状态记录 gating（旧核心降级为「此运行未提供实时 stdout」并保留日志与归档）正面回答了任务目标「旧核心搭配新插件时怎样展示」。
- 背压与有界性设计（32KiB/100ms 攒批、256KiB/64KiB 水位、有界队列、隐藏停监控、终态保留尾窗并给完整文件入口）对应任务目标二.4 的每一条。
- 性能基线方法论可复算且公平：两份临时测量构建共用输出生成器、保留补丁与指纹、不以基线空载作分母、交替运行加预热、五轮取中位数、最近秩 P95、交付 bundle 终核，且明确真实 CLI 不用于性能对照。
- 硬闩锁功能用例（标记磁盘可见→安装态 Webview 可见→才释放退出闩锁，独立断言 PID 存活与时序）正面对应任务目标三.1 的真流式通过条件。
- 「禁止以 E1 I/O 故障改票」「写失败停用该次展示、排空管道让原审查继续」保护了判定与归档语义。
- 交付命令可行：extension/package.json:194 package 为 vsce package 支持 --out 透传，runE2E.mjs:13 经 TRIVIUM_TEST_VSIX 指定安装包，e2e/check 脚本齐备。

## 未覆盖范围（本侧盲区）

- 只读审查：未运行任何构建、测试或性能实测，性能阈值的可达性为静态评估，「实测」类结论均未验证。
- 四家真实厂商 CLI 的 stdout 缓冲行为（是否缓冲到退出）需实测，本轮未验证，计划自身也列为待登记项。
- 终端中继 M1/M3 切换（terminalRelay）与 E1 交互的代码细节未深读，采信计划陈述与 Phase 4 报告。
- secrets.ts 脱敏规则本身的启发式强度不在本侧镜头内，仅审了流式切分结构与兜底覆盖面。
- stub 适配器（stub-stdout.json，stub.ts:363）在 E1 下的文件身份细节未展开核对，采信能力记录按侧声明文件名的设计。
- 11 月 5 日插件计划仅核对 G3 行与 §6.4 相关行，未读全文。

## 实际查阅的项目文件

- `.reviews/E1-审查员stdout实时输出/plan/2026-11-20-E1-审查员stdout实时输出-codex.md`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/2026-11-05-VSCode插件需求分析与开发计划-v2.md`
- `doc/05_testing/REPORT_2026-11-19_VSCode插件Phase4验收.md`
- `src/trivium/runner.ts`
- `src/trivium/review.ts`
- `src/trivium/scrub.ts`
- `src/trivium/run-files.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/adapters/claude.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/adapters/agy.ts`
- `extension/src/monitor/statusWatch.ts`
- `extension/package.json`
- `extension/scripts/runE2E.mjs`

> 编排器从工具轨迹中记录到的读取次数：{"read":19,"grep":10,"glob":4,"run_command":0,"project_reads":22}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
