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
run_id: 20261011T113848Z
rerun_index: 10
snapshot_hash: sha256:da61128f3b8aea16d116be4f5947294879943c2ba2939c330923a67e0515a495
blind: true
started_at: 2026-10-11T11:38:52.960Z
finished_at: 2026-10-11T11:55:34.696Z
duration_s: 1001
tool_calls:
  read: 38
  grep: 13
  glob: 2
  run_command: 0
  project_reads: 43
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 2
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
session_id: ad1750f5-b85a-4280-8c20-a5fd375a6687
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen3.8-flash` ｜ 请求模型 `qwen3.8-flash`
> ｜ 运行 `20261011T113848Z` ｜ 第 10 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

计划方向正确（合同化写指令、诊断不参与判据），但两处若照做会返工：其一，§3 要求把合同参数并入 buildAdmissionPrompt 生产调用点，而现有测试 test/unit/agent-access-read-evidence.test.ts:95-96 用源码文本锚定该调用恰为五参形态，计划 §4 承诺的两次全量 check 会当场红，且计划未列该锚点如何演进；其二，§5"不重复已取得臂"与"旧05矩阵不追认新bundle"并存时，除 Qwen/Luna 外四个 Codex 型号在新指纹/新机制下的写臂地位未定义，按本仓自己的 applicability 教义（historical-mechanism-only、current_admission_accepted=false），旧提示词的写通过不能撑起前置完成报告。另有两处副本面/措辞问题：§4 同步清单漏掉 skills/dual-critic/SKILL.md（r20 取证契约条款七份逐字副本之一，且不在 skills-src render 覆盖内）；§3"固定命令只来自三个已导出常量"有未写明的例外——'BREACH' 载荷字面量并未导出。§1 事实与 r10/r7/r3 留痕逐项对得上；cat 合同不会污染 judgeReadonlyControl 与 codexWriteAttemptDenied 的判据，这点我核过代码。

**结论**：`request-changes`

## 审查意见（共 4 条：重要 2 ｜ 次要 2）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3（'buildAdmissionPrompt可选参数'段）与 §4 验证清单` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：§3 规定生产 Codex/write 必须由 closeout 把合同文件名与 nonce 传入 buildAdmissionPrompt 的可选参数，但 scripts/agent-access-closeout.mjs:135 现有唯一调用点是恰五参文本，且 test/unit/agent-access-read-evidence.test.ts:95-96 用源码正则逐字锚定该行（fx.root 后必须紧跟右括号）。加第六个实参或改写该句都会让这条既有断言失败；计划 §4 的'锚定保持'只提 evidence 函数体 SHA 与 READONLY 字面，未枚举这条源码锚，也未说明实现后 prompt 构建点是一处带条件实参还是两处调用。按现计划实施，§4 承诺的定向测试后两遍全量 check（当前 3160 通过）会红，或在 20C 被迫做未经计划声明的测试改动。

**依据**：读过 scripts/agent-access-closeout.mjs:120-141（line 135 调用文本）、scripts/agent-access-recipes.mjs:18-33（builder 现签名五参、codex write 分支返回 READONLY_CONTROL_PROMPT）、test/unit/agent-access-read-evidence.test.ts:80-101（line 87 五参回放、line 96 源码锚正则、line 99-100 函数体 SHA 锚）、被审计划 §3/§4 全文。推断依据是文本比对：正则要求 fx.root 后为 ')'，加参后不再匹配。

**建议**：在 §4 把该源码锚列入作用面：明确实现形态（单一调用点加条件实参，并同步更新断言为锚定带合同实参的 canonical 调用、保留默认五参回放）或双调用点方案及其对'单一流水线'含义的影响，二选一写进计划，勿留给实施现场即兴。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5 第二、三段（首批与'成熟六组合…不重复已取得臂'）` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | medium |

**问题**：§5 一方面说'旧05矩阵不追认新bundle'，另一方面说整包刷新'不重复已取得臂'。r21 实施后新指纹生效，而当前 bundle（c912bce7/05e370bb）下 sol/astra/kimi/deepseek 的写通过全部是旧提示词机制取得的；本仓自己的判定教义（r4 applicability 装置与其单测）把旧机制成功标为 historical-mechanism-only、current_admission_accepted=false。计划只给 Qwen/Luna 写了新机制首臂，四个其余 Codex 写臂在新机制/新指纹下既没列重跑预算也没声明其'未测'归属：照'不重复已取得臂'执行则前置完成判据依赖不可追认的证据，照完成判据执行则后续要追加未发布的批次。

**依据**：读过 doc/05_testing/evidence/agent-access-20261011-closeout-r10/final-after18-audit.json（r22 刷新含 codex-native-sol/astra/kimi/deepseek-write variant4 completed）、matrix-after18.md（5通过含上述四写臂，均为现行05指纹、旧prompt）、test/unit/agent-access-applicability.test.ts:18-35（旧机制引用不得变当前准入）、doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md:434、被审计划 §5 全文。

**建议**：§5 明确这两个集合的边界：哪些'已取得臂'在新指纹下仍算数、哪些须以新机制另发首臂（含预计/硬上限口径），或显式声明四写臂保持未测并写入完成判据缺口，避免 20C 之后用旧机制通过顶替新机制矩阵。

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4 规范同步清单` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：§4 列出同步面为设计/ADR003/协议/坑指南与手册/剧本/runbook/恢复报告与索引，并称'本机制预计不用改入口'。但上一批获批的取证契约条款逐字存在于七份规范面，第七份是 skills/dual-critic/SKILL.md:55（其 :46 自称'核心容器源'，条款不在 skills-src 中，不受'只skills-src/render'路线覆盖）；r20 先例（REPORT:392'七规范件…追加'）也把它当同步面对待。照 §4 枚举执行，SKILL.md 将成为唯一不带 r21 追加、仍只描述旧写机制保障（14份回放保证 write 逐字）的容器副本，误导后续执行者与审核者的当前态认知。

**依据**：Grep '取证契约|read_content_diagnostic' 命中七份逐字副本：doc/03_api/PROTOCOL_dual_critic_relay.md:477、skills/dual-critic/SKILL.md:55、doc/07_manuals/QUICKSTART.md:501、doc/04_development/GUIDE_local_pitfalls.md:111、doc/02_design/ADR_003_agent_access.md:44、doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:283、doc/05_testing/CASE_manual_acceptance.md:570；skills-src/ 下 grep 同关键词零命中；doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md:392 的先例措辞。

**建议**：把 SKILL.md 的 r21 条款追加（或明确登记'本批刻意不动、理由'）列入 §4 同步清单，与其余六份规范面同批落，勿留给 20C 代码三审当场发现。

### CLAUDE-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3 第一段（'固定命令只来自…生产常量'）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：§3 断言合同的固定命令只来自 src/trivium/probes/codex.ts 已导出的 READONLY_CONTROL_FILE/MARK_WRITTEN/MARK_DENIED。但固定命令里的写载荷 'BREACH' 并不是导出常量：它在 probes/codex.ts:603 的模板里以字面量嵌入，并在 scripts/agent-access-evidence.mjs:122 的判据中作为整行硬编码出现。'只来自常量'在字面上不成立——实现要么在 write-contract.mjs 里再抄一份 'BREACH' 字面（出现第三副本），要么回过去解析 READONLY_CONTROL_PROMPT 文本。

**依据**：读过 src/trivium/probes/codex.ts:587-606（三个导出常量 + PROMPT 内 printf 'BREACH' 字面）、scripts/agent-access-evidence.mjs:119-132（codexWriteAttemptDenied 硬编码整条 fixed 命令，含 BREACH）。

**建议**：在 §3 就地写明 BREACH 字面量的来源策略与不变量：以合同组合结果逐字等于判据行（evidence.mjs:122 的 fixed）为单测独立锚点即可，但别再声称'只来自常量'，以免实施者误加共享常量造成两处一起错。

## 认为正确的部分

- §1 的本批事实与留痕逐项对得上：write-4 的 request_delivery/unique_pair=false/错误目标前后 null、矩阵5通过/1未通过/6未测、v10 声明18历史run与19B/20C/拒21、22项零CLI核验、首件显示名与counting勘误的 v2 修订，均见 r10/codex-qwen-write4-diagnostic.json、r10/formal-round19-authorization-verification-v2.json、r10/review-round19-plan-batch-v2.json、r3/formal-round-authorization-v10.json 与 authority 指针。
- 机制隔离判断正确且我核过代码：session 里新增的 cat WRITE_CONTROL.json 不会污染写判据——judgeReadonlyControl 按命令文本含 breach.txt 过滤（probes/codex.ts:628），codexCommandEvidence 的写配对取 pairs.some 且 codexWriteAttemptDenied 要求整条 fixed 命令精确匹配（evidence.mjs:122-131），合同 stdout 里的标记字符串不参与命令过滤。
- 把原 codexCommandEvidence 函数体逐字保留的主张有机器锚（read-evidence.test.ts:99-100 锚定 slice hash），不是空口承诺。
- §3 诚实把14份回放中的 codex/write 样本降格为具名历史行为、不再宣称全部生产臂零漂移；与 fixture 实际构成（4 Claude + 5 codex/deny + 5 codex/write）相符。
- 不引入 output-schema/tool-choice/effort 与 EV-124 实测记载（adapters/codex.ts:65-68）一致；guard/precheck 不新增语义的说法与 round-guard-v2 的实际校验面（形状/hash/枚举/计数）一致。

## 未覆盖范围（本侧盲区）

- 本侧无执行能力：CLAUDE-01 的'check 会红'是源码文本正则与调用点文本的静态比对推断，未实际跑 npm run check 验证。
- ~/.trivium 原始证据未读（任务书列为告警面）：read-4 的104字节全文 hash 相等、976件台账与29件静态原件的逐字节不变，仅以 r10 汇总 JSON 为据，未逐件核对。
- matrix-after18.json 未打开（读了其 .md 版与两处审计引用）。
- 诊断函数放新文件 vs 放 scripts/agent-access-evidence.mjs 的层次取舍只作观察未形成意见；sha 锚按函数名切片，函数加在锚区间外不破坏锚，故不判其为错。
- Claude 受控 transport/static 臂与本机制的交叠只确认了 buildAdmissionPrompt 调用点唯一性，未展开评审。
- 本轮 CLI 预算数字（review 228/248 为写稿时快照、预检后238/248）按时效差异处理，未追责。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r21-codex.md`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-recipes.mjs`
- `scripts/agent-access-evidence.mjs`
- `src/trivium/probes/codex.ts`
- `src/trivium/probes/fixture.ts`
- `src/trivium/adapters/codex.ts`
- `test/unit/agent-access-read-evidence.test.ts`
- `test/unit/agent-access-recovery.test.ts`
- `test/unit/agent-access-applicability.test.ts`
- `test/fixtures/agent-access-prompt-replay.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r10/plan-r21-body.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r10/codex-qwen-write4-diagnostic.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r10/final-after18-audit.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r10/matrix-after18.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r10/static-audit-before19.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r10/static-audit-after19-preflight.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r10/config-after19-preflight-observation.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r10/authority19-unit-result.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r10/formal-round19-authorization-verification-v2.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r10/review-round19-plan-batch-v2.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v14.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v10.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/matrix-admission15.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/codex-qwen-read3-diagnostic.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/final-admission15-audit.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r7/post-round15-read-evidence-plan-proposal.md`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `doc/05_testing/README.md`
- `doc/02_design/ADR_003_agent_access.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/04_development/GUIDE_local_pitfalls.md`
- `doc/07_manuals/QUICKSTART.md`
- `doc/05_testing/CASE_manual_acceptance.md`
- `skills/dual-critic/SKILL.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `README.md`
- `CLAUDE.md`
- `AGENTS.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":38,"grep":13,"glob":2,"run_command":0,"project_reads":43}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
