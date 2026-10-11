---
schema: trivium.review.v1
topic: Agent双模式接入真实准入收口
stage: code
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
run_id: 20261011T005041Z
rerun_index: 3
snapshot_hash: sha256:efc302238e66230a5af4f0626730f529904fd33b7379e1fb39dc8394c5e62816
blind: true
started_at: 2026-10-11T00:50:47.324Z
finished_at: 2026-10-11T01:05:33.339Z
duration_s: 886
tool_calls:
  read: 24
  grep: 14
  glob: 0
  run_command: 0
  project_reads: 25
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 4
  nit: 1
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
session_id: e188ace9-6b1c-4fb7-b3e0-89f8262ab16d
---

# 代码审查：Agent双模式接入真实准入收口

> Critic-D · Anthropic Claude Code ｜ 回读模型 `qwen3.8-flash` ｜ 请求模型 `qwen3.8-flash`
> ｜ 运行 `20261011T005041Z` ｜ 第 3 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

焦点项（敏感扫描父深度 6→7）的实现站得住：单一常量、边界/软链/排除都有按常量推导的回归，且目录事实（项目 globs hash + shape）从探针到 doctor、适配器、trace、启动前检查是真接线而非孤立字段；夹具内部断言「生产禁读枚举漏目录夹具」正是被这次 6→7 解开的耦合，保留断言而不是缩夹具是正确取向。
最需要在意的不是代码而是口径面：敏感面的父深度上限只在设计文里说了，真正交到审查员手里的任务书第 8 段没有任何边界声明，而事后核验只比对枚举清单——深度≥8 的凭据读存在「清单不列、规则不拦、核验不报」三重静默。
其次：同一段「当前 r12 契约」被逐字抄进至少 14 处（仅设计文内就占 5 节），补丁内部已出现分叉副本；设计 §10.1 的「归属判据 P===D || startsWith(D+'/')」与 adapters/claude.ts 现在的 covered() 谓词不再同句；设计/ADR 的状态句「实施及真机采样未完成」与本补丁自带证据（三条路线 doctor 完成、事实已消费、settings 24188 字节）互相矛盾。
版本台账新增行按 146/148/147 顺序插入，破坏了该表原本严格降序的可读性。
本轮无 blocker：判定面与结构保护（fail-closed 短路、预期失败清空、未知异常继续抛、权威绑定与轮数核验）我在源码与回归里逐条对上。M11 第 12 步前置仍未完成是文档自己声明的状态，不构成对这份补丁的异议。

**结论**：`approve-with-nits`

## 审查意见（共 5 条：次要 4 ｜ 吹毛求疵 1）

### CLAUDE-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/brief.ts:443-475（第 8 段模板，本补丁未触碰）` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：敏感面的父目录深度上限只在设计文与 freeze.ts 注释里说出来，编排器真正发给审查员的任务书第 8 段不带这句话：§8.1/§8.2 只列路径、§8 结尾只承诺「逐个列出以便逐条对账」。后果是「清单/规则/事后核验」三面对深度≥8 的凭据文件同时静默：walkSensitive 不枚举它（freeze.ts:368），CLI 规则里没有它，checkPeerLeak 的比对输入也正是这份清单（guard.ts:336-340），审查员读了既不被拦也不被报，任务书还把它当成一份完整的敏感清单来叙述。

**依据**：读 src/trivium/freeze.ts:34-39 与 367-386（上限 7、.git/node_modules 排除、软链不跟随），读 src/trivium/guard.ts:283-340（措施 a 的输入是 read_paths+search_hit_paths，比对对象是 req.deny_paths，分类只作用于已命中项），读 src/trivium/brief.ts:418-475（第 8 段模板全文，无深度字样；467 行只说目录条目按整棵子树生效），读 .reviews/Agent双模式接入真实准入收口/code/_meta/changes-20261011T005041Z.diff:174（设计 §9.4 第 8 段新增「匹配且经 SENSITIVE_SCAN_MAX_PARENT_DEPTH 父目录深度上限枚举」句）与 diff 中 brief.ts 未出现在改动文件清单；本次运行自身收到的任务书第 8 段也无此声明。

**建议**：在第 8 段模板里补一句边界声明（敏感面按父深度上限枚举、归档同行面无此上限，未列出的深层匹配文件不构成豁免），落点与机器判据同源；或者由 Driver 明确判定该披露只属设计侧，并把 v1.3.148 台账与 r12 计划里「BRIEF 第 8 段明确该不对称」的措辞改成「设计 §9.4 原型明确」，不要让两处口径各自表述。

### CLAUDE-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:279,2018,2168,2510,3055 与 3932` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：同一段「当前 plan-r5/…获批 r12 契约」约 600 字被逐字复制进设计文的 5 个章节，外加 ADR_003、doc/02_design/README、PROTOCOL、GUIDE_local_pitfalls、CASE_manual_acceptance、RUNBOOK、QUICKSTART、skills/dual-critic/SKILL.md，共至少 14 份副本；本补丁内部副本之间已经分叉。任何状态推进都要改 14 处，漏改即漂移——而漂移方向是让读者以为工作未做或已做。

**依据**：Grep 设计文得到 SENSITIVE_SCAN_MAX_PARENT_DEPTH 命中 279/2018/2168/2510/3055/3932 六处、「实施及真机采样未完成」命中 279/2018/2168/2510/3055 五处；读 .reviews/…/code/_meta/changes-20261011T005041Z.diff 的 151/164/182/204/217/253/274/289/306/321/343/360/472-474 行确认各文档逐字同文，且分叉可见：§3.5/10.1/11.1/11.6 带 v1.3.146/147 历史段而 §9.2（设计 2018）只带 148，§9.4（2158）带深度边界句而不带状态段，doc/02_design/README.md 只带 r12 段。项目自己的反复制论述就在 src/trivium/adapters/claude.ts:174-175 与 freeze.ts:69-80（「复述一遍就多一份会漂移的副本」「规则写两份必然漂移」）。

**建议**：指定唯一规范落点（建议设计 §3.5 或恢复报告的状态表），其余各节改为链接＋一句范围说明；若坚持就地留档，则补一条对账用例把这段文本钉成单一来源（§24 台账已有按链接取键的先例），并在每次状态推进时只改一处。

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:2174（§10.1 正文句）对照 src/trivium/adapters/claude.ts:373-390` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：§10.1 正文仍写「归属判据为 P===D || P.startsWith(D+'/')」，而实现里的归属谓词已收窄：根必须 ≤5 段且逐段 ^[A-Za-z0-9_-]+$ 且可表示，后代必须 ≤2 级 ASCII 目录段。按这句正文读代码的人（或反过来按正文改代码的人）会以为任何 under 路径都被并进目录规则，实际超出形态的路径仍逐文件注入；这与本补丁同时保留的「目录段/根段数/后代级」契约段互为张力。

**依据**：读 src/trivium/adapters/claude.ts:365（CLAUDE_DIRECTORY_SHAPE='ascii-root1-5-depth0-2-v2'）、373-390（covered() 要求相对段数 ≤3 且中间段全 ASCII；根候选过滤新增 ≤5 段与逐段 ASCII）；读 changes diff 507-524 行确认本次正是把 under() 换成 covered() 并给根过滤加段数/字符集；Grep 设计文确认 2174 行仍含「归属判据」「P===D」原句，且该段在本次补丁中未被改写（diff 188 行处为上下文行而非 + 行）。

**建议**：把该句改成两层表述：候选目录本身要满足的形态条件（指向常量与 covered 谓词）与 under 归属之外附加的段数/字符集限制；或直接引用 CLAUDE_DIRECTORY_SHAPE 与 adapters/claude.ts 的 covered 谓词，避免在文档里再写一份谓词表达式。

### CLAUDE-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:279 起 5 处段落标题；doc/02_design/ADR_003_agent_access.md 末段` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：状态句自相矛盾：设计各节与 ADR_003 都说「实施及真机采样未完成」「形态 ascii-root1-5-depth0-2-v2 仍需三路线真实 doctor 采样后消费」，而同一份补丁已经交付了实施（常量与回归）并附带三条路线 doctor 完成、目录事实被真实消费的取证。后来者按文档判断会得出「本轮什么都没做」，按证据判断则是「已采样、启动前检查已过」，二者无法调和——这恰是本仓反复修的「文档照旧、实现已走」那一族。

**依据**：读 src/trivium/freeze.ts:39（=7 已实施）；读 doc/05_testing/evidence/agent-access-20261011-closeout-r3/code-start-measurement-rootfix-r12.json（directory_shape=v2、directory_fact_consumed=true、三工具 compressed、settings_bytes=24188≤131072、install_matches_source/inputs_match=true、precheck_pass=true）与同目录 admission-directory-r12-batch.json（qwen/kimi/deepseek 三路线，预计 54 启动，键 r12-directory-doctors-20261011）；对照设计文 279/2018/2168/2510/3055 与 3932 行的「未完成/待审」表述，以及 changes diff 151/164/255/274 行各处副本同样写着「仍需…采样后消费」。

**建议**：把 v1.3.148 段落标题与正文改成带时点的表述（「计划获批时点：尚未实施；本补丁时点：实施与三路线采样已完成，见 <证据文件>」），或删掉状态从句、只留指针到恢复报告的状态表；不要让规范文本与取证记录在同一补丁里各执一词。

### CLAUDE-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:3928-3934（§版本台账新增三行）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：版本台账新增行按 v1.3.146、v1.3.148、v1.3.147 的顺序插入，接在 v1.3.141 之上。该表其余部分是严格降序的时间线，乱序插入让它既不能按版本单调扫读，也不能靠顺序判断新旧，只能逐行看版本号。

**依据**：读 changes diff 229-234 行：三行依次以 146、148、147 的顺序 + 进来，其后上下文行是 v1.3.141 / v1.3.140 / v1.3.139；Grep 设计文确认该表按降序惯例排列。

**建议**：把三行按 148、147、146 降序排；若刻意保留「批准先后＝插入顺序」的语义，就在表头写明该约定，否则一律按版本号排。

## 认为正确的部分

- 扫描深度整改的做法是对的：用导出的具名常量取代裸 `depth > 6`，注释直接写清「五段根加两级后代需要 7」「父深度 8 仍未覆盖」「归档同行面无此上限」，并且不随 Claude 目录形态自动扩域；回归同时钉批准值 7 与 6/7/8 的相邻边界，夹具路径由常量推导而非硬编码，这正是防止下一次悄悄把上限抬高的形状。
- 软链与排除语义守得住：walkSensitive 用 Dirent.isDirectory() 因而不会下钻目录软链的后代，同时匹配软链项自身仍按原 glob 入列；回归另建「深目标 + 自环」两种软链并断言不出现 `linked.key/…` 子项，`.git`/`node_modules` 排除也在同一条用例里被钉住。
- 目录事实是真接线而不是登记字段：探针在夹具替换 sensitive_globs 之前先绑定真实项目 globs hash（probes/claude.ts:1723-1724），doctor 在三条失效路径上都把 5 个字段整体清空（doctor.ts:811-815、824-826），适配器侧 directoryDeclarationUsable 同时要求 shape 相等、hash 相等、至少一个工具为 true、TTL 有效，并且无候选声明时短路掉二进制读取（adapters/claude.ts:432-456），回归还数了 0/1/2 次读取以证无跨运行缓存。
- 失败语义分得开：已定义的外部失败降级为「清空可持久化事实但保留 false、保留已取得臂、finally 清理」，未知内部错误继续抛；doctor 集成用例走真实假 CLI 并跨进程读回持久化结论，覆盖了 create/populate/append/budget/caller 五种失败，不是只测 helper。
- 夹具内部断言「生产禁读枚举漏目录夹具」被保留而不是缩小 30 目标或手填禁读路径——这条断言正是暴露 6/7 缺口的那个装置，修实现而非修判据的取向正确。
- peer_deny_applied 改成「原逐文件实测 true ∧ 实际压缩工具全部 true」的合取，并在注释里明说后项是防御不变式、不构成模型能力证明、也不逐条证明本次规则；未压缩时条件退化为原状，report.ts 的降级旗标另按 deny_skipped 推，跳过的路径不再只躺在 trace.json 里无人消费。
- 取证脚本的两处收紧站得住：assertProductionArm 抽成独立模块并在预算 reserve 之前抛出（closeout.mjs 调用点早于任何 spawn/预占），四个未测写组合与文档一致；台账根与动态证据根分离后 native 身份只从 ledgerRoot 取实际配对，回归显式断言错用证据根会 ENENT/拒绝。
- 轮数守卫的形态是对的：纯核验函数显式接收当前权威、拒绝已被替代的授权，权威指针用文件名正则 + 完整 sha256 双重约束并拒绝越界载体，旧授权/旧 launcher/旧 guard 逐字节保留，产品计数与失败状态没有被顺手改动。

## 未覆盖范围（本侧盲区）

- 本侧无执行能力：未跑 npm run check、定向回归、trivium doctor、构建与安装，也未复算任何 sha256（含报告里声称的 globs hash e769d9…、bundle 与原件 hash）。所有关于「测试是否真绿」「hash 是否相等」的判断都是从读到的源码、断言文本与证据 JSON 推断，不构成验证。
- 读 .trivium/config.yaml 被权限拒绝，config.local.yaml 未读，因此真实项目的 sensitive_globs 名单、cap6/cap7 的 4170/4282 路径集合与 settings 规模对账、目录事实是否真落盘，均未独立核对。
- 约 110 个新增 evidence 文件未逐份读完：summarize-r12.mjs、static-audit.mjs、final-static-audit-r12.mjs、select-evidence.mjs、run-capability-rest.mjs、cutover-budget.mjs、migrate-install.mjs、refresh-install.mjs、launch.mjs/launch-v2/v3、local-validation.mjs 以及各 *-batch.json 只读了 matrix-r12-pre-code.json（前 1585/3497 行）、code-start-measurement-rootfix-r12.json、directory-fact-reuse-scope-rootfix.json、admission-directory-r12-batch.json、formal-round-authorization-v3.json、round-guard.mjs、formal-start-precheck.mjs、launch-v4.mjs。matrix 后半（各臂明细与 Codex 侧行）未读完。
- types.ts 只读到 1277/2170 行（RunMeta/trace.json 侧的新增字段未逐格核对）；report.ts、guard.ts、brief.ts、doctor.ts、probes/claude.ts 都只按相关段落读，未做全文一致性扫；test/unit/agent-access-recovery.test.ts 与两个 integration 测试只读补丁给出的段落，未读文件全文。
- test/fixtures/claude-deny-paths-replay.json 的 3924 条路径内容未逐条核对（只读测试里的断言、数量与统计），因此「8 根覆盖 3908、余 16、投影 24 坐标」只能按断言文本采信。
- 厂商真实行为不在本侧可验证面：Claude 目录规则是否真的拦截、深层级是否触发 E2BIG、profile/供应商服务端身份、以及 doc/05_testing 报告里各模型回读的真实性，全部只能按证据文件叙述采信。
- 背靠背约束下未读任何对侧审查件；本轮焦点要求的「第 8 次完整代码重审」我只覆盖了敏感扫描深度整改及其直接连线（freeze/guard/brief/adapters/claude、probes/claude*、doctor、report 相关段落、三个 scripts 改动），未对全部 128 个文件做等深审阅。
- M11 第 12 步前置是否满足、七路线完整准入与四个生产写缺口状态、共享入口迁移与四目标安装是否达成，未独立判定，只复述被审文档与证据自陈的状态。

## 实际查阅的项目文件

- `src/trivium/freeze.ts`
- `src/trivium/types.ts`
- `src/trivium/adapters/claude.ts`
- `src/trivium/adapters/claude-route.ts`
- `src/trivium/probes/claude-directory.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/doctor.ts`
- `src/trivium/guard.ts`
- `src/trivium/brief.ts`
- `src/trivium/report.ts`
- `src/trivium/util/fsx.ts`
- `scripts/agent-access-recipes.mjs`
- `scripts/agent-access-budget.cjs`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-selection.mjs`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/ADR_003_agent_access.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v4.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v3.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/code-start-measurement-rootfix-r12.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/directory-fact-reuse-scope-rootfix.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/admission-directory-r12-batch.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/matrix-r12-pre-code.json`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `.reviews/Agent双模式接入真实准入收口/code/_meta/changes-20261011T005041Z.diff`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r12-codex.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":24,"grep":14,"glob":0,"run_command":0,"project_reads":25}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
