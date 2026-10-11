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
run_id: 20261011T031230Z
rerun_index: 7
snapshot_hash: sha256:21c1be74104095ee1e6142e990f56e4661ea1fae211f6451617e7b88b930b60a
blind: true
started_at: 2026-10-11T03:12:35.212Z
finished_at: 2026-10-11T03:23:21.903Z
duration_s: 646
tool_calls:
  read: 15
  grep: 11
  glob: 3
  run_command: 0
  project_reads: 24
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
session_id: d15930aa-bcba-435e-bf42-801fed1bfd7a
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen3.8-flash` ｜ 请求模型 `qwen3.8-flash`
> ｜ 运行 `20261011T031230Z` ｜ 第 7 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

焦点核对：总12轮、第11次计划审查、第12次相对39ed2053完整代码重审的结构与用户逐字授权一致，v5授权、指针、v4逐字另存均已落盘且形状正确；三项守卫的事实性描述与源码逐条相符。最危险的一条：权威已实际切到v5（new_limit=12、历史ID十条），而 test/unit/agent-access-recovery.test.ts 的"当前权威读取壳"用例仍静态硬断言v4事实（new_limit=10、八条ID、序号9/10）——按只读推断当前check即红；r15正文却把已获10C裁决的提案条款"实时读取测试切新v5，总10边界固定为不可变v4历史fixture"压缩掉了，照字面实施要么丢9B/10C边界历史，要么把实时壳钉死在旧权威。另有两处次级失实：launch-v7首行把自己的入口路径误写成launch-v6，且恢复报告与05_testing目录索引仍以"总10轮"作现行口径。建议逐条补齐这三处后再走本轮普通plan审批，不需要扩大改动面。

**结论**：`request-changes`

## 审查意见（共 3 条：重要 1 ｜ 次要 2）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/agent-access-recovery.test.ts:62-93 与 r15 §三项之2、§实施` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：工作树指针已切到formal-round-authorization-v5.json（new_limit=12、historical_run_ids十条），但'当前权威读取壳'测试仍通过readCurrentAuthorization()实时读取并断言new_limit===10、历史八ID、序号9/10放行与拒11。静态推断该用例在当前工作树必然失败，npm run check已红；而r15正文删去了post-round10-guard-plan-proposal.md第19行'实时读取测试切新v5，同时把总10边界另固定为不可变v4历史fixture'这一关键裁决落点。只按r15字面实施，会把断言从10改成12继续读实时指针（丢掉9B/10C总10边界的历史覆盖），或错误地把实时壳钉死在v4旧权威（恰是CLAUDE-02要修的自认权威反模式）。r14附录AGY-01的先例（当前壳验现权威、历史用例固定读不可变fixture）正是为打断'每次切权威历史用例漂移'这一复发缺陷，本轮需要同一模式的v5迭代。

**依据**：只读核对：formal-round-authority.json绑定formal-round-authorization-v5.json（new_limit=12、十条历史ID、11B/12C）；test/unit/agent-access-recovery.test.ts:62-93仍断言current.new_limit===10、eighth.length===8并期望返回9/10，读的是实时readCurrentAuthorization；round-guard.mjs:6-15确认读取壳按指针解析并核hash，返回v5全文；post-round10-guard-plan-proposal.md:19与doc/05_testing/evidence/agent-access-20261011-closeout-r5/round11-static-report.md:3佐证切权威在先、守卫整改在后。未执行任何命令，红为静态推断。

**建议**：在r15的CLAUDE-02或§实施中逐条补回提案原文：实时读取壳切v5（十条历史ID、11B放行、11后只12C、超12拒），原总10的9B/10C边界用例改为固定读取不可变formal-round-authorization-v4.json并显式传第5参，保留旧guard hash与总6/7/8历史用例不变。

### CLAUDE-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v7.mjs:1` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：launch-v7.mjs首行自称'第11次计划审查任务入口'，但用法路径仍写node .../launch-v6.mjs，且尾注仍写'v5原件保留'（应为v6原件保留）。它是prepare-round11.mjs由v6仅替换授权文件名和一处短语生成的本会话实际入口（v6/v5仍钉v4授权，指针切v5后按守卫必拒，故11B只可能经由v7启动）。r15只约束新文件的沿革首行（CLAUDE-02/03），并宣称'保留全部历史launcher字节'，等于把这处误述冻结进12C送审面：按字面执行会自相矛盾——改v7字节违反历史launcher不改，不改则第11次入口的真实沿革（v6委托v4、v7委托v5、11B实走v7）以失实首行的形态进入完整重审，12C大概率再开一条守卫沿革意见。

**依据**：只读核对：launch-v7.mjs:1与launch-v6.mjs:1首行对比（r5/prepare-round11.mjs:63-65显示v7由v6文本替换生成，只换了授权文件名与短语，未修路径）；launch-v5/v6/v7的authFile行（grep命中各自31行）证实v5/v6钉v4、v7钉v5，round-guard.mjs的比较逻辑决定切权威后旧launcher全部fail-closed；r15正文CLAUDE-02/03未提及v7首行。

**建议**：在本轮裁决中二选一并写清：把v7首行修正（仅注释行）纳入获批实施范围并逐字另存修正前原件；或维持v7字节不动，在恢复报告追加沿革勘误段，注明11B实际入口是launch-v7.mjs、其首行为误述，同时为接round-guard-v2的新launcher预先定名，使quiet-launch-v6首行可写实。

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/README.md:139 与 REPORT_2026-10-11_agent_access_recovery.md:233-265` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：r15的文档同步条款回退成泛写'先同步必要设计、协议、手册、验收剧本、测试报告与目录索引'。当前实际副本面已失实：05_testing目录索引把恢复报告描述为'总10轮独立例外……新增守卫事项待独立计划'（现行口径），REPORT最后一段停在03:02的总10/v4/launch-v6叙述且没有总12/v5/11B具采样时间的当前段。仓库自己的纪律（doc/README.md第5条'指向现在还是记当时'、plan-r4 CLAUDE-04逐文件枚举加'全仓逐句核现行/历史归属'、r14 CLAUDE-03追加当前段模式）表明这类轮数句子的机器盯防只覆盖已列举指针形态，泛写条款会让实施只补REPORT一处而漏目录索引，12C再现口径分叉。

**依据**：只读核对：grep命中doc/05_testing/README.md:139'总10轮独立例外'、REPORT_2026-10-11:233'用户现已独立明确授权总10轮'与:243'不增加formal总10资格'（无总12段）；doc/README.md:36-39说明现行/记当时的判别由facade-version-pointers契约测试只对已列举形态兜底；AGENTS.md改动同步清单要求新报告同批进目录README。

**建议**：按r14 CLAUDE-03先例把落点具体化：REPORT追加带采样时间的总12/v5/11B当前段并逐句把旧总10句改标历史归属；同步修订doc/05_testing/README.md:139条目与r3目录README现行句；列明skills-src入口措辞是否触及。

## 认为正确的部分

- 焦点结构成立：v5授权authorization字段逐字为'授权总12轮，先计划审查再完整代码重审（建议）'，new_rounds为11=B/plan、12=C/code，与任务焦点和用户原话一致；v4授权文件与v4指针均有逐字另存件，计数未重置、10条历史run含失败与10C拒绝全部保留。
- CLAUDE-01事实核验通过：scripts/agent-access-recipes.mjs:3的Claude/write拒绝集合确为qwen-pro、kimi、kimi-pro、deepseek四项缺deepseek-pro；集合单一来源，scripts/agent-access-closeout.mjs:26导入同一函数、:46在任何reserve/spawn之前调用（budget.cjs的reserve()才写O_EXCL预占文件，openBudget().limit()只读approval.json），'预算预占与CLI spawn前拒绝'的表述与代码顺序相符；recipes在scripts安装输入面内，重评bundle的承诺必要且已写明。
- CLAUDE-02方向正确：round-guard.mjs:22默认current=authorization确为隐式自认权威缺陷，生产壳本已读指针+hash，新增v2把默认去掉、历史用例显式钉fixture的分层与提案一致；不借一般审批改变准入判据的声明贯穿全篇。
- CLAUDE-03事实成立：quiet-launch-v5.mjs:9-10仅限定version=v5、其后任意参数直通launch-v5，claim/resolve/preflight之外的review误用无机械过滤，v6白名单三命令形态与src/trivium/cli.ts的preflight等实际子命令形状相符。
- 同行BRIEF边界判断：与round10-grep-persisted-audit-v2.json、round10-grep-read-exact-verify.json对账一致（252行、剥前缀47345字节、九路径、与4290项deny交集为零），计划'相容但不外推全部_meta隔离、扩禁另审'的定位恰当；本计划未静默吸收该生产guard语义变化，编号与审批边界清晰。
- 预算内部自洽：历史128/138、扩容15至153、预计15硬20、累计批止148与round11-static-report.md一致；'正式审查期间新增准入启动0'、admission547/563延续REPORT记录。

## 未覆盖范围（本侧盲区）

- 未执行任何命令：check当前红、13项正反核验、bundle cb6f4d17/885输入hash、settings尺寸等均为读文件后的静态推断或转述既有收据，未复算。
- 未逐条重放round11-static-report宣称的13项核验与prepare-round11.mjs的完整实现，只核到其对launch-v7/v5授权与指针的派生关系。
- 共享七入口'现在七目录缺席'与四目标安装副本一致性未独立复核（涉及仓库外~/.agents、~/.trivium路径，读侧未触及）。
- PROTOCOL、QUICKSTART、RUNBOOK、GUIDE_local_pitfalls、CASE_manual_acceptance、dual-critic说明与ADR_003中是否另有'总10/v4/launch-v6'现行句未逐文件枚举，本轮只核到doc/05_testing README与REPORT两处。
- doc-archive-index与facade-version-pointers两个契约测试的完整扫描面未读，无法断言r5新报告文件会自动被机器盯住还是仍靠自觉。
- deepseek-v4-pro路线在用户本机配置的存在性与完整指纹影响未验证（配置属禁读/告警区），仅采信计划内矩阵表述。
- 他侧审查员意见与本轮其他侧原始输出未读，背靠背独立性保持中；对10C三家其余发现的实际内容不作推断。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r15-codex.md`
- `CLAUDE.md`
- `AGENTS.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `scripts/agent-access-recipes.mjs`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-budget.cjs`
- `src/trivium/cli.ts`
- `src/trivium/build-stamp.ts`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v7.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v6.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/quiet-launch-v5.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v5.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/README.md`
- `test/unit/agent-access-recovery.test.ts`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r4/post-round10-guard-plan-proposal.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r4/round10-grep-persisted-audit-v2.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r4/round10-grep-read-exact-verify.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r5/round11-static-report.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r5/prepare-round11.mjs`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `doc/05_testing/README.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":15,"grep":11,"glob":3,"run_command":0,"project_reads":24}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
