---
schema: trivium.review.v2
topic: QoderCN只读审核准入与Custom模型接入
stage: plan
role: glm
vendor: zcode
agent_cli: zcode/0.17.0
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
effort_requested: null
effort_effective: null
effort_effective_source: null
tier: null
tier_source: legacy
model_route: config_copy
run_id: 20261028T090050Z
rerun_index: 3
snapshot_hash: sha256:2305a6fa60c077dd3ade2747ea934e5ec8e072f8737e3d0f632ff5f7327133af
blind: true
started_at: 2026-10-28T09:00:58.435Z
finished_at: 2026-10-28T09:13:08.369Z
duration_s: 479
tool_calls:
  read: 8
  grep: 4
  glob: 5
  run_command: 0
  project_reads: 6
evidence_ok: true
verdict: pass
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 0
degraded: false
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
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
  - left: glm
    right: claude
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: claude-opus-5-5
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / claude
override_reason: 左侧模型信息缺失
session_id: sess_95f1cad6-810d-4235-91d5-6602ed7a3950
---

# 计划审查：QoderCN只读审核准入与Custom模型接入

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261028T090050Z` ｜ 第 3 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

r5 是 r4 完整计划的续执行增量，按我的镜头（失败路径、并发与一致性、验收可测性、运维约束）核验通过。现状陈述与仓库逐项对账成立：task 正本 gate.state=idle、9 次历史运行与 1 次降级全部保留；注册表 qoder-cn 的 admissionChecks 恰为 30 项，与 §1「四项模型控制通过、其余 26 项无合格实验」的 4+26 精确对应；criticEnabled/defaultSelected/driverEnabled 三个生产开关均为 false。实验证据口径与已实现的准入验证器逐条吻合：两臂同绑定对照、工具调用同 ID 配对、候选臂 init.tools 必须恰为最小审核工具面、只有 permission-rule/tool-unavailable 才算执行层拒绝（mode 审批与空结果不算）、deny_paths 以 hash 绑定台账、运行期回退只认合法 init 之后、配置叠加未取得原生观测格式时维持显式阻塞分支不编造事件名。验收机器可判：必需项注册表派生、台账持项目全局锁原子替换、同组合覆盖同键、expires_at 受 tested_at 与 probe TTL 双重约束、证据相对项目根且 realpath/hash 复核。r4 对本侧上一轮四条意见的落点（台账并发纪律、registry 登记值回填、独立有效期、v1/v2 共存回归）在 r5 中均未丢失。剩余两条小项：§5 文件白名单漏列 agents/registry.ts 而自身 §6 与 r4 义务都要求改它；第二阶段与 §4 矩阵缺首阶段那样的总调用量/总时长上限。均为补充性意见，可直接按计划实施。

**结论**：通过（`pass`）

## 审查意见（共 2 条：次要 2）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §5「必要代码与文件责任」与 §6「准入、审查、验证与交付」；src/trivium/agents/registry.ts:431-443` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：§5 的修改白名单只列 src/trivium/adapters/qoder-cn*.ts、probes/qoder-cn.ts、admission.ts、util/credential-lease.ts 及「有明确消费需求的 types/schema/调用点」，未包含 src/trivium/agents/registry.ts。但 §6 的「按既有契约持久开启对应 critic 能力」落点正是 registry 的 criticEnabled 布尔；r4 已承接且 r5 §4 配置叠加实验所依赖的「哨兵实测回填 registry 登记值」（criticReadsInstructionFiles、entrySkillRoot、entrySkillExtraReadRoots 当前均为候选或待实测值，且它们参与禁读集合与身份段注入面的推导）也必须改该文件。按 §5 字面执行，执笔者要么漏做登记回填与开关翻转、要么越过自设白名单，两个方向都违背计划自身的约束。

**依据**：src/trivium/agents/registry.ts 第 431-443 行：criticEnabled:false、entrySkillRoot 注释「候选落点；CLI 与桌面端发现行为尚未分别实测」、entrySkillExtraReadRoots 注释「待 CN 客户端实测确认」；被审计划 §5 全段与 §6「持久开启对应 critic 能力」；r4 计划「权威补充决策」末条「同步：哨兵实测回填registry对应CLI载体事实……复核instructionFiles注入」。

**建议**：在 §5 白名单点名 src/trivium/agents/registry.ts 并限定改动范围（准入开关翻转与实测登记值回填），或注明该文件经 r4 同步义务并入本轮授权。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §3 末段（Agent/Task、MCP、网络及其它执行入口）与 §4 路径矩阵、配置矩阵、生命周期矩阵` |
| 类别 | performance ｜ 层次 plan |
| 置信度 | medium |

**问题**：首阶段 Write/Edit/Bash 有「最多 12 次模型调用、36 分钟上限」的总预算，第二阶段与 §4 各矩阵只有每入口/每变体「两臂各 2 次/180 秒」的格子限次，没有总调用量或总时长上限。other-execution-denied 的验证器要求 init.tools 清单里全部剩余执行工具都有实际拒绝覆盖才可通过，而该清单大小不受计划控制，最坏情况下第二阶段加路径/配置矩阵的真实模型调用总数与耗时无上界，与首阶段刚建立的配额收敛原则不对称；总预算耗尽时是继续、还是停并记阻塞，计划也未写处置。

**依据**：被审计划 §3「Write/Edit/Bash 首阶段最多 12 次模型调用、36 分钟上限（不含生产探针的既有限额）」与同节末段、§4 各段均仅格子级限次；src/trivium/adapters/qoder-cn-admission.ts 第 27-31 行：other-execution-denied 要求 remaining 清单中每个工具都有实际拒绝覆盖，任一缺失即失败。

**建议**：给第二阶段与 §4 两类矩阵各补一行总调用次数/总时长上限及超限处置：停止并记录阻塞，不因超限伪造覆盖或降格验收。

## 认为正确的部分

- 现状陈述与仓库对账一致：.reviews/QoderCN只读审核准入与Custom模型接入/task.json 中 gate.state=idle、9 次历史运行与 1 次降级全保留；src/trivium/agents/registry.ts 的 qoder-cn admissionChecks 恰为 30 项，§1 的 4+26 对账成立；criticEnabled/defaultSelected/driverEnabled 三开关均 false。
- §3/§4 的证据口径与已实现验证器逐条吻合且可测：两臂同绑定对照、同 ID 工具调用配对、候选臂工具面必须恰为最小审核集、permission-rule/tool-unavailable 才算执行层拒绝而 mode/空结果不算、空搜索与文件未变化不计、deny_paths hash 冻结、运行期回退只认合法 init 之后、生命周期要求监督方回读进程退出与凭据清理并以 timedOut/SIGKILL/取消终态分判（src/trivium/adapters/qoder-cn-admission.ts）。
- 准入与生产接线边界正确：必需项由注册表派生，台账 .trivium/admission.local.json 持项目全局锁临时文件加 rename 原子替换、同组合覆盖同键、0600、expires_at 不晚于 tested_at 加 probe TTL、证据相对项目根且 realpath 与 sha256 复核、冻结引用防 worker 重选（src/trivium/admission.ts）；「全部通过才生成台账并持久开启对应 critic 能力、driver/default 仍关闭、其它组合及 Windows 继续拒绝、verify 不当准入」与任务目标三一致。
- 失败路径收敛正确：全部候选臂无真实拒绝即停止扩展执行入口并转阻塞报告；秘密命中、CLI/源/认证变化、清理失败立即停止后续派生并保留租约；每场景一次主试验加一次装置错误修正、清理监督 30 秒上限；旧证据只在完全相同绑定/覆盖/有效期下复用且不改原件。
- 文件与安全边界沿用 r4 已裁决契约：采集器复用生产函数、不自建第二套加载与权限策略；候选臂原样使用 facts.review_invocation_args 与 prepareQoderReadonly；凭据最小复制 0700/0600、不整份复制、不输出明文 key hash、持久输出先过秘密护栏；O_EXCL 归档与 codex 后缀纪律；TraceCapability 未观察拒绝不升级 rejectionRecorded。r5 未丢失 r4 对本侧上一轮四条意见的落点。

## 未覆盖范围（本侧盲区）

- 本侧只读，未运行任何命令、测试或真实 CLI；Qoder CN 客户端实际工具面、权限语法、官方文档内容、Custom 编解码器行为均以计划与代码自述为准，相关判断为推理。
- 08:23 verify 的 4150 通过/9 跳过与 08:05 评估的 4+26 结论未复核证据原件（doc/05_testing/evidence 下的原始 JSON 未读）；scripts/acceptance/kimi-qoder-cn/ 下各脚本只确认存在与 trivium.native-acceptance.v1 引用，未逐个审阅实现。
- src/trivium/adapters/qoder-cn-custom.ts、qoder-cn-trace.ts、qoder-cn-native.ts、probes/qoder-cn.ts、types.ts 仅经检索定位符号，未全文审查；README.md 与 doc 各级 README、设计文档 §11.1 原文未逐字重读，以会话注入的 AGENTS.md 为背景参照。
- Windows 侧行为无法在本侧验证；另一位审查员的镜头（如 Schema 逐字段形状、契约文案措辞）未覆盖。

## 实际查阅的项目文件

- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r5-codex.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r4-codex.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-glm.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r2-glm.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/task.json`
- `CLAUDE.md`
- `src/trivium/admission.ts`
- `src/trivium/adapters/qoder-cn-admission.ts`
- `src/trivium/agents/registry.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":8,"grep":4,"glob":5,"run_command":0,"project_reads":6}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
