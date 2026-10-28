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
run_id: 20261028T050945Z
rerun_index: 2
snapshot_hash: sha256:546cdf29a24cfd152b6ebaf1b918c9e548009601a1c593319bede17fcbbeed3d
blind: true
started_at: 2026-10-28T05:09:54.599Z
finished_at: 2026-10-28T05:20:52.554Z
duration_s: 494
tool_calls:
  read: 11
  grep: 5
  glob: 0
  run_command: 0
  project_reads: 13
evidence_ok: true
verdict: pass
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 2
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
session_id: sess_97f164f8-bfda-4cba-a395-be88319bebc2
---

# 计划审查：QoderCN只读审核准入与Custom模型接入

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261028T050945Z` ｜ 第 2 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

r3 对本侧上轮六条意见中的五条给出了明确落点（绑定粒度按路线收敛且整份 settings hash 降为审计、探针按 native_routes 分键并独立 prepared_at/TTL、Custom 声明走独立解析不放宽官方目录正则、配方指纹排除密钥值与临时路径/时间、矩阵每格 180 秒最多 2 次），两项提交三审裁决的契约（RunOptions 显式环境模式 merge/replace；Custom 路线执行核验与底层 provider/model 身份严格区分、底层未知保持 null/unverified 不算失败）方向正确：前者正是 qoder-cn-native.ts 现有注释与准入报告承认的「替换式 env 入口需后续独立设计」缺口，后者与既有 v3 语义（模型族三态比较、未知告警不作闸门条件）一致。计划对任务目标原文三大工作包逐条映射无漏项、无范围扩张，现状陈述与两份测试报告及代码一致（Custom 三臂 0/0/1、Read 规则拒绝、Write 仍为 mode 审批、Grep/Glob 空结果不计拒绝、生产开关与 Windows 拒绝维持），验收口径可测且 fail-closed（正控制/回退控制/错误凭据控制、exit 0 不覆盖失败、未测即阻塞不降级）。剩余四条均为小项：准入台账的并发与原子写读纪律、台账「有效期」字段语义、registry 候选登记值按实测回填的漏步（上轮同类意见 r3 未见对应落点，重申）、facts v1/v2 共存迁移边界的回归钉住。可直接按计划实施。

**结论**：通过（`pass`）

## 审查意见（共 4 条：次要 2 ｜ 吹毛求疵 2）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `r3 计划 §5「完整验收生成本机.trivium/admission.local.json……生产消费核证据存在/hash、绑定/TTL和全部必需项」` |
| 类别 | concurrency ｜ 层次 plan |
| 置信度 | medium |

**问题**：准入台账是新引入的跨进程共享本机状态：验收脚本写、每次运行的预检/生产消费读。计划未写明写读纪律——写入是否走临时文件加 rename 的原子替换、同一组合重复验收时是覆盖同键还是追加版本、两个验收并发跑如何互斥、读者读到半写或解析失败的文件时按什么处置。仓库对同类状态已有先例纪律（state.json 全局锁加读改原子替换、probe 段由 doctor 单写回填 config.local.yaml），台账若在实施时落成普通读-改-写，会出现丢更新或半写读取，事后补纪律要动写读两侧。

**依据**：被审 r3 计划 §5 全段；src/trivium/config.ts 第 4-5 行（probe 段落 config.local.yaml 的本机状态单写先例）；src/trivium/run-protocol.ts 第 20-21 行（既有锁机制覆盖 state 与主题锁，不含新台账）。

**建议**：在 §5 补一句台账读写纪律：写入走临时文件加 rename 原子替换、同组合重验覆盖同键（或显式版本追加）、读者解析失败或半写一律按「无合格准入」拒绝并提示重验。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `r3 计划 §4「技能、user/project/local设置、项目Hook、插件、MCP做合成哨兵正负对照」与 §6 同步清单；src/trivium/agents/registry.ts 第 434-440 行` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：registry 的 qoder-cn 登记值仍是候选/未实测状态：criticReadsInstructionFiles 为 false，entrySkillRoot 注释标注「候选落点、CLI 与桌面端发现行为尚未分别实测」，entrySkillExtraReadRoots 标注「待 CN 客户端实测确认」。§4 的哨兵对照正是取得这些实测结论的场合，但 §6 同步清单只列了 registry-parity 对账，未点名「哨兵实测结论回填登记值」这一步。criticReadsInstructionFiles 决定审查员身份段是否向 Qoder 注入 instructionFiles，entrySkill 系列决定禁读 deny 集合要覆盖的技能根；带着候选值接线、事后再翻正登记，会连带复核身份段注入面与 deny 集合推导，属于同批实施内的漏步。本侧上轮同类意见在 r3 中未见对应落点，现重申。

**依据**：src/trivium/agents/registry.ts 第 434-440 行（qoder-cn 登记的三个候选/未实测值及注释）；r3 计划 §4 哨兵对照与 §6 同步清单均未含登记值回填。

**建议**：在 §4 或 §6 补一句：哨兵对照的实测结论必须回填 registry 的 qoder-cn 登记值（至少 criticReadsInstructionFiles、entrySkillRoot、entrySkillExtraReadRoots），并据此复核审查员身份段的 instructionFiles 注入面。

### GLM-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `r3 计划 §5「记录平台、入口/版本/hash、路线/模型/源/配方、必需项状态、相对证据路径/hash及有效期」` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：台账字段「有效期」的语义未决策：是独立的墙钟到期时间，还是派生自 native_routes facts 的 TTL 与证据 hash 一致性的再验证；若为独立墙钟字段，已通过组合到期后的处置（拒绝并提示重验，而非静默翻转为不可用）也未写。admission.v1 是会被机器校验的契约，字段语义留白会在实施时各拍各的。

**依据**：被审 r3 计划 §5；src/trivium/config.ts 第 171-176 行（nativeDefaultIsFresh 按 prepared_at 与 probe_ttl_days 的派生判定是现成先例）。

**建议**：明确「有效期」二选一：消费时派生重算（facts TTL 加证据 hash 复核）或独立字段；若独立，写明到期处置为拒绝并提示重验。

### GLM-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `r3 计划 §2「旧无version按既有P2全settings hash规则处理，不回写历史」与 §6 自动化清单` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：NativeModelFacts v1/v2 共存的迁移边界只有规则、没有对应的回归钉住项：§6 自动化清单的「官方兼容/Custom选择与冲突」未明确包含「旧无 version 的官方事实仍按整份 settings hash 规则通过校验且不发生回写」这一格。checkQoderBinding 对整份 hash 失配即抛「请重探」，实施时若顺手把旧事实判废或回写新字段，已探机器升级后会立即要求重探，且违反「不回写历史」的自定边界而无测试拦截。

**依据**：src/trivium/adapters/qoder-cn-native.ts 第 112-118 行（整份 hash 对账、失配即请重探）；src/trivium/probes/qoder-cn.ts 第 36-40 行（现产 v1 形状 facts）；r3 计划 §2 与 §6。

**建议**：在 §6 自动化清单点名一条 v1/v2 共存回归：旧形状事实按旧规则通过、盘上不被改写、v2 事实按路线级绑定校验，三格分别断言。

## 认为正确的部分

- 两项提交三审裁决的契约均同意按计划实施：其一，RunOptions/run 显式环境模式（缺省 merge 保持全部现有调用语义、replace 从空环境构建且不在 spawn 时重合并 process.env）正确对应 src/trivium/adapters/qoder-cn-native.ts 第 52-55 行注释与准入报告承认的「替换式 env 入口需后续独立设计」缺口，白名单保留 PATH/locale/证书/无认证代理的取舍与现状一致，新增「构造 env 之后新增父键」真实子进程反测是对的方向；其二，Custom 路线执行核验与底层 provider/model 身份严格区分、底层未知为 null/unverified 本身不算失败、必要路线证据缺失或回退或不一致必须失败，与既有 v3 语义（模型族逐对三态比较、同族与未知仅告警）一致，§3 的必要回读规则（唯一受绑定声明可见、原生选择与声明一致、计费标签单列、成功终态无回退/认证/执行错误，配同版本正控制、缺声明回退控制、错误凭据控制）可测且与 QoderModelMonitor 现有回读立场兼容
- 上轮两条 major 在 r3 的落点成立：官方与 Custom 绑定粒度按路线收敛（binding_version=2 只绑定影响该路线的确定性语义，整份 settings hash 降为不变性审计，旧无 version 按既有 P2 规则处理不回写）；多路线事实按 native_routes 分键独立存 facts 与 prepared_at/TTL，准入台账 admission.v1 采用形状校验加注册表校身份的两段式，符合「schema 只校形状、身份走注册表」的仓库纪律
- 选择器契约的格式边界成立：official:/custom: 前缀与官方目录正则（不含冒号斜杠）天然无冲突，非法段、重复、仅大小写差异、官方与 Custom 原生 key 冲突派生前拒绝，裸 provider/modelID 仅在唯一已验证声明匹配时接受，provider_id 只作命名空间、可信供应商仍由 access.provider_* 承载
- 只读验收口径可测且不降级：先做 Write 精确路径单变量对照（同版本、同目标、同 permission mode），区分路径许可未命中/mode 审批/显式 deny，正控制真实执行配对拒绝证据，每格 180 秒最多 2 次防无限换提示，搜索空结果、未写文件、模型口头拒绝不算执行拒绝，工具不可见的必需格保持阻塞
- 失败与生命周期语义正确：流式 monitor 双通道早停加首因粘滞加尾部兜底扫描，原始 code/signal 与编排原因并留、exit 0 不覆盖失败结论，清理异常单列不抹原始原因，复用 AbortSignal/TERM 宽限 KILL/ps lstart 身份校验，不杀身份不明进程、不遗留真实凭据
- 生产接线边界正确：全局开关保持关闭直至至少一个真实组合全部通过，无合格组合时仍交付台账校验与拒绝接线的代码测试，真实三审仅作为链路验证不替换固定三家审查，Windows 无证据即拒绝，registry 仍为唯一差异来源、准入钩子放厂商适配器不在通用模块写身份分支
- 交付边界与同步面完整：契约先入设计再改码，新字段全为可选且不回填历史、须有真实消费方，先 typecheck 与定向测试再重装实际运行副本，最终按五类分别交付，不提交不推送不改版本，Kimi 无关改动与历史失败证据保留

## 未覆盖范围（本侧盲区）

- 本侧只读，未运行任何命令、测试或真实 CLI；对两份测试报告的引用是文档阅读，报告所引 evidence 原件 JSON 未逐一复核，凡需实测确认的判断均为推理
- r2 计划全文与历史审查留痕未读（背靠背约束）；CLAUDE.md、README.md、doc 各级 README、设计文档 §11.1 原文未逐字重读，以会话注入的 AGENTS.md 为背景参照
- src/trivium/preflight.ts、review.ts、run-protocol.ts、registry.ts、config.ts 只读了路由冻结/登记/探针相关片段，未做全文审查；src/trivium/types.ts 的 NativeModelFacts 完整形状未逐字段核对
- Custom 原生编解码器字节、customs 存储实际形态、Qoder CN 客户端真实工具面与配置级联行为无法在本侧验证，以计划与报告的自述为准
- 另一位审查员的镜头（如 Schema 逐字段形状、契约文案措辞）未覆盖

## 实际查阅的项目文件

- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r3-codex.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-glm.md`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/review.ts`
- `src/trivium/config.ts`
- `doc/05_testing/REPORT_2026-10-28_QoderCN官方模型路由与回退阻断.md`
- `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":11,"grep":5,"glob":0,"run_command":0,"project_reads":13}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
