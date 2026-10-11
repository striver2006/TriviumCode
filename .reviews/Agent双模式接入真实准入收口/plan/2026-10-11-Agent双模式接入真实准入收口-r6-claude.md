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
run_id: 20261011T020308Z
rerun_index: 6
snapshot_hash: sha256:11cea8c361d4a9132e97d0e8344618359ae8c6820a71c113e82108dfe6ca6044
blind: true
started_at: 2026-10-11T02:03:12.803Z
finished_at: 2026-10-11T02:13:01.781Z
duration_s: 589
tool_calls:
  read: 11
  grep: 6
  glob: 4
  run_command: 0
  project_reads: 15
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 2
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
session_id: df30ece8-4433-4b27-8813-aea16c13b6fc
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen3.8-flash` ｜ 请求模型 `qwen3.8-flash`
> ｜ 运行 `20261011T020308Z` ｜ 第 6 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

焦点（授权总10轮、先正式计划审查再代码重审）在机制与证据面上基本落实：v4授权、current-authority指针、v3逐字另存、launch-v5仅切v4、round-guard对超限/孤儿/不可读/重复/旧权威/allow-single全部fail-closed，且与r4的13项零CLI核验、批次账、矩阵副本逐条互洽。但计划未写最后轮数的失效路径：第9次无效时guard只按启动计数、不校验前轮有效性与审批，第10次仍可机械启动，本轮预算将不可逆耗尽——须补显式停止规则。另两处副本面缺口：新增未登记的quiet-launch-v5包装器与§6播报承诺相抵；报告行尾最新状态句仍停留在总8未授权时点，批准落定后会成为失实锚。方向正确，上述三条落点并入r14后可批准实施。

**结论**：`request-changes`

## 审查意见（共 3 条：重要 1 ｜ 次要 2）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §6/§7 与 doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard.mjs:22-43、launch-v5.mjs:33-46` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：用户焦点「先正式计划审查再代码重审」只被顺序强制（ordinal由已启动计数推导），未被有效性强制：若第9次三家结论无效、作废或gate失败，round-guard仍会在task.runs.length=9时机械放行第10次C/code启动——因为核验函数只比对已启动计数、run集合、参数旗标与当前权威，不看前轮是否有效或已审批。此时实施前提（r14获批）不成立，10次启动将把唯一剩余正式轮数烧在一个未被批准的工作树上，且授权恰为总10、没有第11次，形成不可逆的预算死锁。正文§6只写到「失效不得approve」，§7「若均不批准…完成第10完整重审」预设9B已批，均未明说「9B无效则停止、不得启动10C」。

**依据**：静态读round-guard.mjs:22-43：assertFormalRoundCore校验授权等同当前权威、run集合、历史ID子集、--topic/--driver/--critics/--entry/--stage与new_rounds映射及超限，无任何前轮有效性或审批字段；launch-v5.mjs:33-46仅在review --start调用该核验；doc/05_testing/evidence/agent-access-20261011-closeout-r4/formal-round9-authorization-verification.json的13项用例全部是计数/参数负例，无「9B无效后禁10C」项；r13正文§6、§7全文未见该停止规则。本人无执行命令能力，结论为逐行静态阅读所得。

**建议**：在§6或§7补一条显式规则：第9次若三家有效结论不齐备、作废、gate未过或未获本轮审批，立即停止，不实施、不启动第10次，原样上报阻塞与剩余资格，由用户决定后续，不得借任何机制复活。同时在零CLI核验用例清单中补该场景的说明（guard机制本身不校验审批链，须如实标注这属操作纪律而非机械强制，避免把散文约束宣称为接口能力）。

### CLAUDE-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §6「旧授权/launcher不改，新launch-v5仅切v4」与 doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v5.mjs` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：本轮工作树新增quiet-launch-v5.mjs（git status未跟踪、已实际存在），但r13正文通篇未提及该文件（对被审计划原文grep「quiet」零命中）。§6把本轮launcher沿革收敛为「仅新增launch-v5且只切v4」，与证据面实际新增两个入口文件不符；且quiet-launch-v5第10行以stdio ignore丢弃子进程stdout、第19-23行按claude doctor形态解析输出摘要，与§6「所有warning/progress原样播报」的表述相抵——若它被用于正式启动/补测，播报承诺不再成立；若仅限doctor/admission，计划又未限定。第10次C/code范围虽写「所有launcher」，批准文本却描述不出这块新增面。

**依据**：读doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v5.mjs:9-23（白名单仅v5、spawn launch-v5、stdio ['ignore','ignore','pipe']、恰一completed记录检查、probe.cli.claude.routes摘要解析）；对被审r13计划文件全文Grep「quiet」无匹配；工作树git status列launch-v5.mjs与quiet-launch-v5.mjs同为未跟踪新文件；同目录既有旧quiet-launch.mjs，说明quiet包装器族历史上用于非正式输出场景。

**建议**：在§6逐项列名quiet-launch-v5.mjs并声明其唯一用途（如仅限零CLI/doctor类取证摘要，不得作为review --start入口），或将其从本轮新增面中移除；使launcher沿革与§6「原样播报」承诺在批准文本内自洽，第10次审查不必靠diff反推。

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §7 与 doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md:223-225、176` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：轮数条款的状态锚副本未闭环：报告第225行是全篇最新状态句「已请求独立总10轮（9B/10C）授权，当前总8上限未改变；该请求不包括判据采用授权」，而v4授权已落定（总10、9B/10C）；第176行裁决确立「规范不复制进展，状态唯一指向本报告」。§7虽有「先并入主设计、ADR003、协议、手册/剧本、测试报告及索引」的泛化条款，却未点名「报告追加带日期的当前状态段，使轮数上限的最新句与v4一致」。照此实施，若后续任一环节未触发改句，M11前置判断者读到的最新报告行仍是总8上限——正是本仓历轮反复纠正的失实副本模式。

**依据**：Grep doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md：第225行最新状态句停留在总8、第176行状态唯一指向条款；doc/02_design/ADR_003_agent_access.md:29与主设计§285/2176/2518/3063的同段落四份副本均已显式标注「历史v1.3.147/当时总7轮」，属合规历史保留，但报告尾句无历史标记、按追加惯例即为当前锚；对照v4 formal-round-authorization-v4.json new_limit=10。本轮无执行能力，属文本核对结论。

**建议**：§7同步清单补半句：批准v4后在恢复报告追加注明采样时点的当前状态段（总10轮、9B/10C、两判据未采用、准入账），使「总8上限未改变」降格为历史行；并沿用现行「全仓逐句核对现行/历史归属」口径核报告与手册的轮数句。

## 认为正确的部分

- v4授权链自洽：v4.supersedes_file/supersedes_sha256与formal-round-authority-v3-preserved.json记录的v3指针逐字一致，指针authorization字段与basis文字均如实反映总10轮及「8次含失败不改、无原生例外接口」
- readCurrentAuthorization对缺失/未知载体/hash漂移/主题不符均fail-closed；launch-v5仅切v4，且code阶段仍接formal-start-precheck；旧launch-v4硬编码v3，在v4指针下被授权等同校验拒绝，沿革声明与代码相符
- round-guard的拒绝点与§6所列一一对应：超限/已启动集合/孤儿/不可读/重复/错主题/错Driver/错critics集合/错entry-stage/allow-single，13项零CLI核验用例齐备且vendor_cli_starts=0
- §2矩阵声明（38臂、6通过/6未测、Kimi coding完整deny=false、旧Grep超时单列、服务端身份null分列）与current-matrix-scope.json十二行逐项相符
- §5两判据与本轮10轮授权及一般自动审批的隔离，在v4 criteria_change_authorized=false与write-criterion-alternative-not-adopted.md保留上得到证据面支撑
- §3如实声明权威切换导致历史总8动态用例失效、本次未改测试、不称当前check通过；r4静态报告同样声明本次全check未跑，未把旧3137/3/0快照冒充当前状态

## 未覆盖范围（本侧盲区）

- 本侧无执行命令能力：未计算任何SHA256。指针sha256 041219c4…是否等于v4文件实际字节、supersedes 821a6aac…与v3文件一致性、r4 verification中preserved_pointer_sha256等均依赖launch-v5运行期hash漂移检查兜底，未能预先独立验证
- ~/.trivium/runs按禁读清单未读：本次9B实际经launch-v5还是quiet-launch-v5启动、guard是否实际执行，未从启动证据核验
- 项目外预算池（~/.trivium/evidence/.../budget）超出本侧工具范围：review 103/123、admission 547/563、976预算原件hash连续仅与r4批次记录对账，未独立核账
- §3补测机制配方分析、§4组件复用与§5受限工具面两判据的实质可行性评估未展开（两者均未采用，仅核其授权隔离）；build-stamp 48db71df编译字节等同声明未证
- 本轮未重读src/trivium/adapters与probes、freeze/brief/canonical、doctor.ts及安装面/共享七入口细节：七整改已在第8次C/code覆盖，正文仅核其保留要求表述与既有证据文件的一致性
- §6预算扩容authorized_by引用的2026-10-10用户扩容指令原文未核（编排器指令件不在可读范围）
- 另一位审查员的产出未读，符合背靠背要求

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r13-codex.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v4.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority-v3-preserved.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v5.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v5.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v4.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r4/formal-round9-authorization-verification.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r4/review-round9-plan-batch.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r4/round9-static-report.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r4/current-matrix-scope.json`
- `test/unit/agent-access-recovery.test.ts`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `doc/02_design/ADR_003_agent_access.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":11,"grep":6,"glob":4,"run_command":0,"project_reads":15}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
