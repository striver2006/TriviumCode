---
schema: trivium.review.v1
topic: codex探活删除收尾
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.160.0
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20261003T142424Z
rerun_index: 1
snapshot_hash: sha256:e0bfc73a9d9d0f7571fecfff89568fef93afe08a29655fd039ba6f7218e64f2b
blind: true
started_at: 2026-10-03T14:24:26.704Z
finished_at: 2026-10-03T14:33:11.987Z
duration_s: 439
tool_calls:
  run_command: 13
  project_reads: 14
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 0
findings_degraded:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
degraded: false
parse_fallback: false
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a10226-e96e-73c2-9f05-3a77668cd5fe
---

# 计划审查：codex探活删除收尾

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20261003T142424Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **逐条降级**：本侧有 4 条意见不合 schema，单列在「不合格意见」一节，保留原编号、须逐条裁决，但不参与阻断与共同阻断判定。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

计划整体与 EV-197/198 先例同形，我逐项对账了现状：codex probe() 的 finally 裸删形态（codex.ts:331-363）、probeAuth 无 try 的穿透路径（preflight.ts:699-740）、prepareCodexHome 的三类凭据载体写入面（codex-home.ts:274-335）、removeZcodeTempDir 的现场查语义（zcode.ts:954-972）——§1 现状核对与 §2 设计的等价性表述都属实；零配额路径成立、回滚面干净。主要问题在 §3.1 的测试摆法：C3b「留一份凭据副本 + 锁兄弟目录」与计划书自己的摆锁守则段（以及 EV-197 的教训）直接矛盾——副本所在目录全程可写，删除是否先吃掉残留副本取决于未保证的递归删除顺序，该格的期望档位和 M4/M5 两条变异的期望都吊在这个不确定性上。另有三件次要项：摆「只读子目录」须含子文件才拦得住递归删除（zcode 假入口已有先例，计划未写）；§3.3 两次全量对同期登记的 EV-201 偶发红没有预案；§5.4 主动留给审查员的问题（fingerprint 无兜底要不要登记）计划自己的落点清单里没有接住。修一处摆法、补三处说明即可放行，方向性骨架不需要动。

**结论**：`request-changes`

## 审查意见

合格意见 0 条；本侧另有 4 条意见逐条降级，见下方「不合格意见」。

## 不合格意见（逐条降级，共 4 条）

> 下列意见不合 `trivium.review.v1`：保留原编号、**仍须逐条裁决**（接受要写落点），
> 但**不参与阻断与共同阻断判定**——其中声称 blocker 的，被驳回也不会触发共同阻断告警。

### CODEX-01 · 不合格

**不合格之处**：
- `confidence`：缺失（(根对象) must have required property 'confidence' {"missingProperty":"confidence"}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | major |
| 位置 | §3.1 表格 C3b 行与「摆锁守则」段 |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | （缺失） |

**问题**：C3b 的摆法自相矛盾：守则段明确写着「锁兄弟目录时递归删除会先删掉副本，顺序不定（EV-197 踩过）」，因此只允许在「副本已不在」的前提下锁兄弟目录，并把必须留在场内的副本改锁 codexhome 本身（C1/C2/C4）；但 C3b 偏偏在锁兄弟目录的同时留一份凭据副本在场内。机制上：兄弟目录 0o500 拦住的只是它自己，codexhome 仍是可写目录，Node 递归删 tmp 时若先遍历 codexhome，残留的那份副本（及 codexhome、fakehome）会被删净，之后撞 locked 才抛——现场查得 ENOENT，措辞落「没有凭据副本」档，期望的「含真实凭据」红；反之先撞 locked 则绿。结论取决于 readdir 顺序，三格子用例各钉一份副本、M4 与 M5 两条变异的期望也全建在这三格上，实现时要么常红要么偶发红，属于返工点。

**依据**：被审计划 §3.1（C3b 行与守则段原文）；zcode 同族用例明确回避了这个形态——test/unit/zcode-doctor-probe-home.test.ts:147 注释：copyGone「同 sibling，另先把副本删掉……不依赖递归删除的先后顺序」，即 zcode 只在全删副本时才用兄弟锁（:191-196）；test/unit/zcode-auth-probe.test.ts:246-250（钉 HOME/TMPDIR/FAKE_LOCK 的同法）。本机制判断为对 POSIX 递归删除语义的推理（我这边只读、未实做复现），但与计划书自己记载的 EV-197 教训同源同形。

**建议**：把 C3b 的锁改到 codexhome 本身（与 C1/C2/C4 同款 0o500 锁）：删除会直接失败在持副本的目录上，副本必然在场，r-x 位仍允许三个位置逐个 stat——每格「留 auth.json / 留 config.toml / 留 profile toml」各钉住 codexCredentialCopies 的一个条目，M4/M5 咬住它才是确定的。兄弟锁只保留给「副本全删」的 C3。

### CODEX-02 · 不合格

**不合格之处**：
- `confidence`：缺失（(根对象) must have required property 'confidence' {"missingProperty":"confidence"}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | minor |
| 位置 | §3.1 C3（以及沿用兄弟锁的其它格）「在临时根下另摆一个只读子目录」 |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | （缺失） |

**问题**：按字面摆一个空的 0o500 子目录并不能造出「删不掉的目录」：删除一个空目录只需要其父目录的写权限，目录自身 0o500 的 r-x 反而让递归遍历得进去——rm 会成功、没有残留，C3 整格按字面实现会直接红。摆锁必须在该子目录里放一个子文件（对文件 unlink 才需要 locked 自身的写权限）。

**依据**：test/unit/zcode-auth-probe.test.ts:42-45：既有假入口正是先 mkdirSync(locked)、writeFileSync(locked/f)、再 chmodSync(locked, 0o500) 三步摆的锁；zcode-doctor-probe-home.test.ts:52 同款。计划的摆法一句没提这个子文件。

**建议**：在 C3/C3b 的摆锁描述里补一句「锁目录内放一个子文件（参 zcode 假入口）」，或直接在假入口的 FAKE_LOCK 说明里写死三步摆法；「摆不出就退非 0」的自检也应把「locked 里有子文件」纳入判定，否则这道防线对空目录形态是瞎的。

### CODEX-03 · 不合格

**不合格之处**：
- `confidence`：缺失（(根对象) must have required property 'confidence' {"missingProperty":"confidence"}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | minor |
| 位置 | §3.3 全量与自检 |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | （缺失） |

**问题**：§3.3 要求 npm run check 两次串行并取真实退出码，但没有给同期刚登记的已知偶发红留任何预案：EV-201 记录 2026-10-03 EV-198 代码双审后连跑三次全量，两次各红在 cancel-grace-unverifiable 的 K-K3 / K-K4（负载相关时序，单跑该文件三次 16/16 全绿）。本题改动与该套件无交集，但按计划的验证口径，两次全量里任何一次撞上它，Driver 只能临场决定重烧还是将 just 判红——验证成本与读数的可解释性都缺一条现成规则。

**依据**：doc/08_project/BACKLOG.md 的 EV-201 行（登记于 2026-10-03，含两次红的断言位置与单跑全绿读数）；被审计划 §3.3 全文未提及该形态。

**建议**：在 §3.3 加一句分诊规则：全量若红且红格恰为 K-K3 / K-K4、与 EV-201 签名相符，单跑该文件确认绿后继续，并在测试报告里注明——不扩大范围，只把既有登记变成计划内的处置。

### CODEX-04 · 不合格

**不合格之处**：
- `confidence`：缺失（(根对象) must have required property 'confidence' {"missingProperty":"confidence"}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | minor |
| 位置 | §0 范围与不做 / §5.4 风险 |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | （缺失） |

**问题**：§5.4 主动把问题交给审查员：「请审查员判断是否需要登记」fingerprint() 无兜底这一核出项。但计划的 §4 文档清单只列了 EV-200 结案与既有四处同步，没有「若裁定登记则新登一条 BACKLOG」的落点——审查意见被接受后计划里没有承接它的位置，容易停在「判了要登、没人去登」。zcode 侧同形问题（读凭据文件抛错穿过 probeAuth）在 EV-136 代码双审 r1 CODEX-01 当时就是改掉了，codex 侧现状仍在。

**依据**：src/trivium/adapters/codex.ts:307-330（fingerprint 对 auth.json / profile toml / 基底 toml 直接 sha256File、readFile，无 try）；对照 src/trivium/adapters/zcode.ts:1156-1164（注释即 CODEX-01：读不了返回 null，免得异常穿过无兜底的 probeAuth 崩预检）；src/trivium/preflight.ts:726（probeAuth 直接 await auth.fingerprint()，无兜底）。被审计划 §4/§5.4 原文。

**建议**：把裁决写成决策而不是留给审查员：或按 EV-201 的先例在 §4 加一行「同批新登 BACKLOG：codex fingerprint 无兜底，触发条件与修法方向照 zcode CODEX-01」，或在 §0 不做清单里明写「经审后裁定不登记（理由）」。登记与修改本来就是两件事，决策三限制的是后者。

## 认为正确的部分

- 三段拆法与 zcode EV-197 完全同形：结果在 attempt 拼完、外层 finally 删除失败不抛、残留接在详情末尾且 ok 不变——对照 codex.ts:331-363 现状与 zcode.ts:1165-1189 先例逐句核实，表述属实，方向正确。
- removeTempDir 抽到 util/fsx.ts、zcode 改薄包装且输出逐字不变的等价性成立：我核对了现有 removeZcodeTempDir（zcode.ts:954-972）的四个语义点——copies 为空不 stat、查不了按在说、ENOENT 判不在、code 回落 message——§2.1/§2.2 的写法逐一保得住，含 copy 为 null 直说「没有」的退路支。
- tildeHome 挪 fsx 再导出，避免 adapters/codex.ts 引 adapters/zcode.ts 的载体互依赖，且 probes/zcode.ts 与测试引用点不动——必要且代价近零。
- codexCredentialCopies 作凭据位置单一定义、放 isCredentialCarrier 旁、由 C7 钉「写入面=查询面」，与 scrubCodexHome 的三类载体口径一致（codex-home.ts:274-335 的写入面确实恰是这三类），残留两档不设哨兵档的取舍与事实相符。
- 零配额路径成立：假入口（shebang 用 process.execPath，与 zcode-auth-probe.test.ts:27 先例同法）+ 钉 HOME/CODEX_HOME/TMPDIR 到本格私有根 + doctor --selftest 桩；「摆不出就退非 0、不静默通过」的守则延续既有纪律；root 下权限格跳过（C5a 的 EISDIR 例外成立）判断正确。
- 决策边界与先例一致、回滚成本为零：probeAuth、拉起参数、判据、指纹、缓存不动，EV-199 与 mkdtemp 本身失败不在本题，均是 EV-197/198 已定形态；改动全部是代码内重构+加固，真退回去就是一次 git revert，无数据迁移面。
- §5.3 对「步骤属性挂原错误对象、被再包一层会丢、C5a 会红」的残余披露诚实，M10/M11 对该路径有咬合。
- 文档同步清单齐备：§10.5（设计 :2367）与 §11.3 第 7 条（:2819，现文即「认证探活与 doctor 探针的临时目录删除共用 removeZcodeTempDir」）定位属实，RUNBOOK 临时目录行（doc/06_deployment/RUNBOOK_pipeline_ops.md 附近表格行存在），版本号 v1.3.81 接当前 v1.3.80 正确，报告登记 doc/05_testing/README.md 符合 AGENTS.md 同步清单。

## 未覆盖范围（本侧盲区）

- 变异装置的逐条预跑与「装置每轮只收一个套件」的机制细节未逐行核对（不在本侧镜头内），只核对了 M1–M14 期望的语义指向是否自洽（M4/M5 的可用性以 CODEX-01 修好后为准）。
- 未实跑 npm run check / node --test（只读镜头），验证成本仅按计划文本与 EV-201 登记判断。
- claude 侧裁决口径、其余审核者的镜头范围不涉及；设计文档回补句的具体措辞未代拟。
- zcode 回归套件 A1–A4、R7、D10–D10d、R1、R2–R6 只确认存在与命名，未逐用例读断言。
- codex CLI 真实版本行为（本次被假入口完全替身）不构成本题风险，故未做厂商侧核对。

## 实际查阅的项目文件

- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/adapters/codex-home.ts`
- `src/trivium/util/fsx.ts`
- `src/trivium/preflight.ts`
- `src/trivium/util/exec.ts`
- `test/unit/zcode-auth-probe.test.ts`
- `test/unit/zcode-doctor-probe-home.test.ts`
- `doc/08_project/BACKLOG.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":13,"project_reads":14}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
