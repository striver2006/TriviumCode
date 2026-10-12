---
schema: trivium.review.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: claude
vendor: anthropic
agent_cli: claude/2.1.296
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: envelope
effort_requested: null
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: legacy
run_id: 20261011T171203Z
rerun_index: 12
snapshot_hash: sha256:664dd2998cf12840ef096525d15747ee7f7ca136be37d7090130808b43f41040
blind: true
started_at: 2026-10-11T17:12:08.219Z
finished_at: 2026-10-11T17:25:34.121Z
duration_s: 805
tool_calls:
  read: 13
  grep: 15
  glob: 2
  run_command: 0
  project_reads: 20
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 2
  minor: 3
  nit: 0
degraded: false
parse_fallback: false
peer_deny: true
drift: false
heterogeneous: unknown
access:
  requested_mode: profile
  profile: qwen
  launcher_requested: /Users/chenzhenbo/.local/bin/cld
  launcher_effective: /Users/chenzhenbo/.local/bin/cld
  wrapper_sha256: e4e159df668f64694d550fb058cf5788e9ef0edf7da1e90e16719f68ebd627f5
  configuration_sha256: 9a3bfaa3acc006b11a8c5c6422da69841ccc121de244ee7eff9574e4146cb8e5
  provider_declared: qwen
  provider_declared_source: profile
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: claude
    status: unknown
    left_model: null
    right_model: qwen3.8-flash
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: claude
    right: gemini
    status: different-family
    left_model: qwen3.8-flash
    right_model: gemini-3.8-flash-high
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：qwen / gemini
  - left: claude
    right: glm
    status: different-family
    left_model: qwen3.8-flash
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：qwen / glm
override_reason: 左侧模型信息缺失
session_id: 8cfc419c-57bf-45d6-9325-b0fa6bfa549d
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen3.8-flash` ｜ 请求模型 `qwen3.8-flash`
> ｜ 运行 `20261011T171203Z` ｜ 第 12 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

计划整体结构扎实、姿态诚实，直接回应焦点；但最危险的两条都落在判据采用的边界合同上。(1) B层对Write/Bash「配对拒绝」的期望形态未钉死——正文两条臂的谓词形态本就不同（注册禁用错误文本 vs permission_denials 配对），计划未声明写类工具在受控下接受哪种形态、出现未录制形态怎么办；(2) 层D「判据批准」只有内容清单，没有载体、机读形式与消费校验闸——「未批准永远不消费」目前无机械核对对象。次级问题：新候选v2与两次被明确驳回的v1未声明谱系与差异；§5.4对v13直接读取与「v12及更早固定为历史fixture」的描述超出仓库实际测试覆盖（v9–v12在test/零引用，当前权威测试为指针驱动不锁定）；§5.3同步清单相对r24漏掉恢复报告、坑指南、Runbook、核心SKILL，落地后这些副本会失实。建议修订后再进入实施。

**结论**：`request-changes`

## 审查意见（共 5 条：重要 2 ｜ 次要 3）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `r25 提案 §2 层B 行、§3「Write/Bash必须各有实际受控工具输入及配对拒绝」段` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：B层受控协议同时送入Write/Bash与禁读Read/Grep，但正文对「配对拒绝」只有一句泛称，未声明写类工具期望配对的错误形态白名单。生产中两条臂形态并不相同：claudeWritePass 只接受已录制的 'No such tool available: Write|Bash … disabled for this session' 文本，claudeDenyEvidence 只接受 terminal.permission_denials 同ID同工具同精确路径配对。计划也未规定受控下出现未录制形态时的行为——附录r24 §3对生产臂已有先例「未录制的其它错误形态不自动追加白名单、不换提示碰运气」，B层机制恰恰没有这条规则，实施时要么因形态误判把桥接pilot错杀，要么悄悄把新观测文本当作v2白名单。

**依据**：读被审对象 r25 §2表格层B与§3取证协议段；scripts/agent-access-evidence.mjs:104-119（claudeWritePass 的形态正则与配对逻辑）、121-227（claudeDenyEvidence 的 permission_denials 逐目标配对）；scripts/agent-access-closeout.mjs:235-252（canonical 两臂接线方式不同）。doc/05_testing/evidence/agent-access-20261011-closeout-r15/claude-qwen-deny-read 等 result 与 status-after-all-positive.json 的 write_layer='tool-registration' 佐证生产写证据形态。

**建议**：在§3显式声明：Write/Bash 在受控下预期配对的是哪种已录制形态（引用 claudeWritePass 白名单或明示「受控原件属v2首次录制」），并把未录制形态的行为定死为显式失败加原件留痕、任何白名单扩充须另经24B裁决或独立批准；Read/Grep 沿用 claudeDenyEvidence 配对合同并注明适用。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `r25 提案 §2 层D、§5.5、§5.6 最终矩阵` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：层D规定了判据批准记录应含范围、版本、理由、撤销条件与A/B消费证据hash，§5.6要求矩阵并列approved_criteria版本，但计划没有定义这条批准记录的载体与校验者：它落在哪个文件、什么机读形状、由谁核验、消费脚本在什么条件下才允许产出restricted_status=true。「未批准永远不消费」目前只靠实施顺序（批准后-enable）兜底，没有可事后对账的机制。对照组例外有三重载体：formal-round-authorization-v13 绑定 supersedes hash、formal-round-authority 指针绑定 v13 sha256、launch-v17 同时核对两者；判据批准若沿用「散在报告文字与审批reason里」，将来v14重录或矩阵改版时该概念会无家可归，撤销条件也无法被任何消费者核对。

**依据**：读 r25 §2表格D行与§5.5/§5.6；对照 doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v13.json:53-60（criteria_change_authorized=false、supersedes_sha256）、formal-round-authority.json（指针+hash）、launch-v17.mjs:37,63（双引用）；grep 全仓（排除审查归档）restricted-tool-surface-and-path 与 auth-cache-timestamp-applicability 仅命中计划与task/report文字，无批准载体、schema或校验代码。

**建议**：在§5.5批准前先把批准工件定死：路径+schema（criteria版本串、范围、撤销条件、A/B消费证据hash清单、批准记录引用），并在§5.6写明消费校验闸——评估脚本仅当存在与工件一致且未撤销的批准记录时才产出restricted_status=true，否则只输出诊断与原列；同时声明包/资产变更边界。

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `r25 提案 §2 首段（restricted-tool-surface-and-path-v2 引入处）` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：新候选以改名后的v2出现，正文未说明它与已被明确驳回的 restricted-tool-surface-v1 / component-scoped-evidence-v1 的继承关系，也未列出实质差异。22B与23C的审批理由都白纸黑字记录「v1不采用、判据替代授权仍false」，ADR_003 同样保留未采用表述。如果Bob依据现文批准v2而不了解谱系，就会出现「restricted未采用」历史句子与已采用v2并存、只有靠读者自行联想才能调和的副本分叉，也正与焦点「只有我另行明确批准判据变化后才能采用」的可审计前提冲突。

**依据**：r25 §2 与附录r24 §2；.reviews/Agent双模式接入真实准入收口/task.json approvals 2026-10-11T14:55（22B：不采用component-scoped-evidence-v1或restricted-tool-surface-v1）与 15:45（23C：不采用component/restricted替代）；doc/02_design/ADR_003_agent_access.md:61（component/restricted判据替代未采用）。差异实际散落在§1/§3（保留profile wrapper、default权限门、live绑定、独立适用性列），但正文从未点名为v1的整改。

**建议**：§2加一句显式谱系声明并列v1→v2的实质差异清单，§5.3同步清单补「候选版本串同名写入ADR/报告/批准工件」，保证批准或拒绝历史与现行候选在同一词面上可对账。

### CLAUDE-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `r25 提案 §5.4「现行授权对账也纳入本轮获批后的测试范围」段` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：该段把「v12及更早授权和正反结果继续固定为历史fixture」表述为现状，但仓库里测试对v9–v12零引用：恢复测试固定历史块只到v8，当前权威测试是读formal-round-authority指针的非锁定式循环，不声明v13、也不断言criteria_change_authorized=false或24B/25C具名枚举。且工作树指针已被改为指向v13（未提交），「实施前尚未切换」的说法与现状态不一致——若按现文照做，测试会随指针下次换版静默漂移，焦点所在「轮次委托不授权判据变化」这一关键不变量在现行权威上仍无固定断言。

**依据**：test/unit/agent-access-recovery.test.ts:183-201（v8固定块）、203-232（当前权威测试：readCurrentAuthorization指针驱动、逐轮枚举、不锁版本、无criteria字段断言）；grep 'authorization-v(9|10|11|12|13)' 在test/目录零命中；formal-round-authorization-v13.json:53（criteria_change_authorized=false）；formal-round-authority.json（指针现指v13、recorded_at 16:57晚于status-after-all-positive.json 16:47）与git状态快照显示该指针为未提交修改；launch-v17.mjs:37,63。

**建议**：把§5.4改为显式待办清单：新增v13锁定块（criteria_change_authorized=false、24B/25C具名、26拒绝、指针hash对账各一断言）；v9–v12要么补固定夹具块，要么如实写明「仅证据域原件保留、无测试固定」，不得沿用「继续固定为历史fixture」的现状措辞。

### CLAUDE-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `r25 提案 §5.3 同步清单` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：r25的实施同步清单只剩「设计、ADR、协议、手册、验收剧本、测试报告及索引」，相对同一文档附录里已获批r24 §4的清单，漏掉了恢复报告、开发坑指南、Runbook、核心SKILL。ADR_003多处把「当前执行口径」指向恢复报告，恢复报告正是判据候选状态、桥接与权限模式差异的落点副本；B层机制引入的本地事实（loopback、临时HOME、default模式门）也是坑指南体裁。按现清单执行，这些副本将在25C后落后于事实并失实。

**依据**：对比被审对象 r25 §5.3（第66行清单）与附录 r24 §4（第124行清单：设计补丁、ADR003、协议、开发坑指南、手册/Quickstart、Runbook、验收剧本、恢复报告、核心SKILL及文档索引）；doc/02_design/ADR_003_agent_access.md:33,61 以恢复报告为当前口径指针。

**建议**：把恢复报告、开发坑指南、Runbook、核心SKILL加回同步清单，或在§5.3逐项明示「本批无需改」并给理由，让副本完整性可被24B逐条核对。

## 认为正确的部分

- §3桥接设计的关键事实与证据域吻合：wrapper-static-control-transport-observation.json 核得 cld hash e4e159df、PROFILES_DIR与CLAUDE_BIN均由${HOME}解析，旧受控臂三缺陷（绕包装器、auto权限模式、缺live绑定）在pilot门里被逐一纠正，且明示不能声称真实provider推理。
- 「生产六模型init.permissionMode实测均default」有r15多臂raw/result的init事件支持（qwen-read/write-6、kimi-pro/qwen-pro/deepseek read与deny-3），据此设default门并要求「仅argv相等不构成桥接证明」是正确的收紧。
- A/B/C/D四层与「不能证明」清单直接回应了焦点对「证明什么、仍不能证明什么」的要求；C绝不由B补成true、原列与单臂false/未测并列（status-after-all-positive.json的7通过/5未测及两条single_arm_failures与正文一致）。
- §4适用性候选以0600副本语义diff、仅允许具名checked_at变化的白名单与not-applicable fail-closed设计，与preflight.ts缓存写入字段形状一致（版本/指纹相等时仅checked_at刷新）。
- §5.3把普通plan批准限定为「夹具与只读诊断、不授权替代采用」，与v13 authorized_scope和criteria_change_authorized=false互相印证；预算池（6+8对742-731）不足处以「先扩容留痕才继续」收口，未留撞线缺口。

## 未覆盖范围（本侧盲区）

- 无命令执行能力：两次串行check 3207/3/0、桩14/14、28入口、bundle 1737c946与local 496eed89等计数与哈希均无法复算，仅核对到status-after-all-positive.json的记录一致。
- formal-round-authority.json指针内sha256与v13文件实际字节是否相等未复算（需计算）；v13是否已由正式机制核验齐备未验证。
- auth缓存TTL=1h与三审缓存已过期为配置事实，未读.trivium配置对账；preflight.ts仅证明字段形状与TTL机制。
- §5.1所列静态资料、依赖审计、最小启动清单未逐项核对；task.json runs计23条历史+1条running，与「23/23、26拒绝」口径推断一致但未逐轮深核。
- k3历史Read2与新Read3的readonlyArgs/Schema/settings逐字相同仅在证据域文件名层面确认，未逐字比对全部字节。
- 临时HOME桥接是否被native实际消费、不受真实全局设置影响，只能由pilot证明，本次仅为文本推断；安装作用面不含证据域JSON的判断同样未由安装清单逐项确认。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r25-codex.md`
- `.reviews/Agent双模式接入真实准入收口/task.json`
- `CLAUDE.md`
- `AGENTS.md`
- `doc/02_design/ADR_003_agent_access.md`
- `scripts/agent-access-evidence.mjs`
- `scripts/agent-access-closeout.mjs`
- `test/unit/agent-access-recovery.test.ts`
- `test/unit/agent-access-task-launch.test.ts`
- `src/trivium/preflight.ts`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r15/status-after-all-positive.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r15/post-round23-admission-criteria-plan-proposal.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r15/claude-final-positive-after23/wrapper-static-control-transport-observation.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r15/claude-final-positive-after23/selection-after23-all-positive.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v13.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v17.mjs`

> 编排器从工具轨迹中记录到的读取次数：{"read":13,"grep":15,"glob":2,"run_command":0,"project_reads":20}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
