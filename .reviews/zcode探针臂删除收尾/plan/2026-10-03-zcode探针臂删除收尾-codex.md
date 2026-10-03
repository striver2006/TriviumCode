---
schema: trivium.review.v1
topic: zcode探针臂删除收尾
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.160.0
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20261003T115927Z
rerun_index: 1
snapshot_hash: sha256:dfdc0a392e82d27392393c4b5ea4d038aa8b50fddc8da8636ef8665575d01923
blind: true
started_at: 2026-10-03T11:59:30.613Z
finished_at: 2026-10-03T12:07:00.341Z
duration_s: 375
tool_calls:
  run_command: 19
  project_reads: 19
evidence_ok: true
verdict: approve-with-nits
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
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a101a2-386e-7c51-82c1-3969c5fbe1c7
---

# 计划审查：zcode探针臂删除收尾

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20261003T115927Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **逐条降级**：本侧有 4 条意见不合 schema，单列在「不合格意见」一节，保留原编号、须逐条裁决，但不参与阻断与共同阻断判定。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

我按「环境与可得性 / 成本配额 / 回滚成本」这只镜头核对了计划的全部关键事实并读了实现源码：三处裸删（probes/zcode.ts:253、:621、:1002）、removeZcodeTempDir 现状（adapters/zcode.ts:924-939，stat 写死 prepareZcodeHome 布局）、§1.2 两支「说过头」判断（同形臂残余扫描在写盘后判定、apiKeyOnly 档注释原文）、BACKLOG EV-198 条目原文、RUNBOOK 删除失败行、设计 §11.3 第 7 条（当前 v1.3.79，v1.3.80 未被占用）、EV-197 既有夹具与测试形态（FAKE_LOCK、probeLocked、skip:ROOT）。计划的方案、档位判定（现场 stat 优先于调用方 kind）、三臂 copy 路径与 kind 的取法、D18/D19 接线的可行性我都逐步推演过，方向正确、零配额口径成立（三条臂与 doctor 层全走假入口/桩，实测调用为零）；签名变更只涉本仓内调用方（grep 核过 src/test/scripts，无外部消费者），回滚成本低。提 4 条小意见：R 系列用例未明写 root 环境跳过门（计划自称「沿用 EV-197 的教训」但该教训在仓库里含 skip:ROOT 与摆锁失败退非 0 两半）；变异 5 按现描述在 null 短路与「查得 ENOENT 同取 null 档」的机制下可能咬不住；§2.5 漏了 doc/05_testing/README「当前已归档文件」登记（AGENTS.md 同步清单明列、契约测试 doc-archive-index 会红）；§4.2 夹具裸删我建议明确另登 BACKLOG 条目而非只留在计划正文。均为廉价修正，不动摇方向。

**结论**：`approve-with-nits`

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
| 严重度 | minor |
| 位置 | 计划 §3.1 R1～R6 的摆锁方式（「摆『删不掉』的方式沿用 EV-197 的教训」） |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | （缺失） |

**问题**：R 系列依赖 chmod 0o500 使递归删除失败，这在 root 下不成立（root 越过 DAC，rm 照样成功），届时断言「提示以 ⚠️ 开头」会红而非静默通过。仓库既有先例对此有明确处置：EV-197 的 A1/A2 用例带 skip: ROOT 门（process.getuid?.() === 0），driver-claim 测试注释还写明「chmod 造 EACCES 在 root 下不成立」。计划只说「沿用 EV-197 的教训」，未明写这两格新用例要继承 ROOT 跳过门与「摆锁不成功必须让用例红」的守卫，编码时可能漏掉，导致 root 态机器（容器/CI）上整套 R 系列成为红噪声或假绿。

**依据**：我读了 test/unit/zcode-auth-probe.test.ts:33-47（FAKE_LOCK 摆不出即 process.exit(3)）与 :271-276（const ROOT = process.getuid?.() === 0；A1/A2 带 { skip: ROOT }）；test/unit/driver-claim.test.ts:359 注释「比 chmod 造 EACCES 稳（后者在 root 下不成立）」。本轮我未实际以 root 复跑（无 root 环境，此为读码+推理）。

**建议**：在 §3.1 明写：R1～R6 照 A1/A2 形态加 ROOT 跳过门，且假入口侧摆锁不成功必须退非 0 让用例红（FAKE_LOCK 已有此形态，新 FAKE_LOCK 变体要照搬）。

### CODEX-02 · 不合格

**不合格之处**：
- `confidence`：缺失（(根对象) must have required property 'confidence' {"missingProperty":"confidence"}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | minor |
| 位置 | 计划 §3.2 变异清单第 5 条「旗标探针传非 null 的 copy ⇒ R1 红（档位错）」 |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | （缺失） |

**问题**：按 §2.2 自身的机制，copy 非 null 但 stat 得 ENOENT 时同样落「没有副本」档——与传 null 的输出逐字相同。旗标探针的临时 HOME 里按计划只有 FAKE_LOCK 建的只读子目录；若变异把 copy.path 指向 prepareZcodeHome 布局之类的必然不存在位置，R1 断言（取「没有副本」档）照绿，这条变异装置会白跑一轮还给出「已被守住」的假信心。要让 R1 真咬住档位错，变异的 copy.path 必须指向删除时刻实际存在的路径（如 FAKE_LOCK 子目录里那个文件），计划没有把这一步写死。

**依据**：我读了 src/trivium/adapters/zcode.ts:924-939（现有失败后现场 stat、ENOENT 才算没有、查不了按有说的语义）与计划 §2.2「copy 为 null ⇒ 不查直接 null 档；非 null ⇒ stat，ENOENT ⇒ null 档」——两条并立即推出上述等价形态（推理，未实跑变异装置）。R1 的锁形态（$HOME 下只读子目录+文件）来自计划 §3.1 自身描述。

**建议**：把变异 5 的替换串定稿为「copy = { path: <删除时刻必然存在的路径>, kind: 'sentinel' }」（FAKE_LOCK 子目录内的文件即可），或承认这条形态不可咬、从计划里删去并在 §2.2 注释里写明 null 短路只为省一次必然 ENOENT 的 stat。

### CODEX-03 · 不合格

**不合格之处**：
- `confidence`：缺失（(根对象) must have required property 'confidence' {"missingProperty":"confidence"}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | nit |
| 位置 | 计划 §2.5 文档清单（决策三、四） |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | （缺失） |

**问题**：§2.5 列了 BACKLOG、设计 §11.3、RUNBOOK、测试报告与证据目录，但漏了 AGENTS.md「改动同步清单」点名的强制同步项：新增 doc/05_testing 下的测试报告必须同批登进 doc/05_testing/README.md 的「当前已归档文件」一节，由 doc-archive-index 契约测试逐条对账（文件没进节、条目指向不存在文件都会红）。虽然 §3.3 的全量检查会把这条拦下、属机械补登，但计划把它当「要同步的文档」列全正是这条清单的意义。

**依据**：我读了 AGENTS.md 改动同步清单该行；doc/05_testing/README.md:16 的规范句（「新文档与文档本身同批进下方『当前已归档文件』一节……由 test/contract/doc-archive-index.test.ts 对账（EV-172）」）；test/contract/doc-archive-index.test.ts 存在（ls 核过）。

**建议**：§2.5 增一行：测试报告同批进 doc/05_testing/README.md「当前已归档文件」一节，条目顺序按该节规范句排。

### CODEX-04 · 不合格

**不合格之处**：
- `confidence`：缺失（(根对象) must have required property 'confidence' {"missingProperty":"confidence"}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | minor |
| 位置 | 计划 §0「不做」第三条与 §4.2（探针夹具 createFixture().cleanup 裸删，请审查员判断是否构成新缺口） |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | （缺失） |

**问题**：§4.2 的形态与 EV-198 修的完全同族：fixture.ts:84/:134 的 cleanup 是裸 fs.rm({recursive,force})，force 只吞 ENOENT；它在 probeZcode:1646 的外层 finally 与 agy/claude/codex 三侧探针各一处被调，删除失败同样抛穿 runDoctor、本轮已探结论在 checkpoint 前丢失，残留目录（含哨兵 .env 假凭据，风险低）留在系统临时目录无人知晓。本题以「四侧共用、越出 zcode 三臂」为由不动，范围判断我同意；但按决策四「双审核出新缺口才登」，这正是该登记的时刻——只写在计划正文 §4 里，落库后无人追踪，形态与 EV-197 当时「另登 EV-198」的先例（设计 v1.3.79 版本记录明文：「同族裸删按范围不改、另登 EV-198」）完全对应。

**依据**：我读了 src/trivium/probes/fixture.ts:84 与 :134（cleanup: () => fs.rm(root, { recursive: true, force: true })，无 maxRetries）；src/trivium/probes/zcode.ts:1645-1647（finally await fx.cleanup()）；doc/02_design 设计 §11.3 v1.3.79 记录行（:3659）里「另登 EV-198」的先例；doc/08_project/BACKLOG.md:296 EV-198 条目原文。

**建议**：本计划收尾时（决策四批准新登的唯一入口就在这轮裁决）把夹具裸删登记为一条新 BACKLOG 条目：三载体探针 + zcode 探针共四处调用的 finally 裸删同族收口，触发条件写「下一次动任一 createFixture/cleanup 或实遇一次 doctor 因此崩成内部错误」。

## 认为正确的部分

- 方案方向正确：三臂改调统一删除函数、失败不抛、提示经返回值带出、probeZcode 逐臂推 notes，与 EV-197 已落地的形态同构，判据与三分判定一字不动的范围切割干净。
- §2.1/§2.2 的三档措辞与「副本位置由调用方传入、现场 stat 优先于调用方档位、copy.path 只 stat 不删」的取向，与既有 EV-197 代码双审结论（GLM-01 ≡ CODEX-03 的现场查规矩、2026-09-20 事故后只删 mkdtemp 返回值）逐条相容；既有两处调用输出逐字不变的主张我按 adapters/zcode.ts:932 与 prepareZcodeHome 写盘路径（:1017-1035）比对成立。
- §2.3 同形臂 kind 取法把「扫出残余」与 apiKeyOnly 档都归「含真实凭据」、transformCopy 未跑到时靠 stat ENOENT 兜 null 档的推演我逐步复算过，与 §1.2 两支「说过头」的事实核对一致（adapters/zcode.ts:1033 先写盘、transformCopy 内算 residue、判定在返回之后，计划读得准）。
- tempDirResidue 在 ModelOverrideProbe 上用可选字段的理由是实的：接口先例 runtimeSelected?: 就以「桩与本字段之前的调用方不给它」同一理由放开（probes/zcode.ts:436-439），既有 ARM_STUBS 只给部分字段的现状（zcode-doctor-probe-home.test.ts:224-230）与计划 §1.4 描述相符。
- 全程零配额成立：三条臂与 doctor 层全走假入口/桩（zcode-doctor-probe-home.test.ts 已有 FAKE_ENTRY、ARM_STUBS、stubInvoke、runDoctor 直调的先例 :435/:628/:697），变异与全量检查耗时为主、无厂商调用成本；签名变更无仓外消费者（grep src/test/scripts 核过），回滚只需还原两个函数签名。
- BACKLOG EV-198 原文确实写着「三处目录里都没有真实凭据」且「两档措辞都不贴切」，计划 §1.2 的补核与 §2.5 的改准结案与条目文字对得上；设计版本 v1.3.80 未被占用（当前至 v1.3.79）。

## 未覆盖范围（本侧盲区）

- 未复审 EV-196/EV-197 已合入代码本身的正确性（本轮只审计划对它们的引用是否属实）。
- agy/claude/codex 三侧探针的裸删面我只在 fixture.ts 调用点层面确认存在，未逐侧推演其删除语义与残留内容（除 CODEX-04 的登记建议外不构成意见）。
- sentinelizeCredentials / findCredentialResidue / forceProviderApiKeySentinel 的内部实现细节未逐行审读，R5「apiKeyOnly 且无残余可达」的可行性判断基于既有测试夹具形态的推理，confidence 相应打折。
- 变异装置的工程（gen-mutation-spec.mjs 的规格生成与逐条预跑）未核验其脚本现状，只审了计划列的 10 组变异的逻辑咬合性。
- 入口 SKILL.md / skills-src 渲染资产与本计划无交集，未查。
- 未实跑任何测试或探针验证 R 系列断言（只读环境），文中所有「会红/会绿」判断均为读码推理。

## 实际查阅的项目文件

- `CLAUDE.md 无（以 AGENTS.md 为准）、AGENTS.md`
- `README.md`
- `doc/README.md 未单独细读`
- `src/trivium/probes/zcode.ts（:130-260、:360-440、:540-640、:840-1010、:1330-1490、:1600-1649）`
- `src/trivium/adapters/zcode.ts（:373-606 抽点、:890-960、:1000-1060、:1100-1180）`
- `src/trivium/probes/fixture.ts（:70-140）`
- `test/unit/zcode-auth-probe.test.ts（:30-60、:240-310）`
- `test/unit/zcode-doctor-probe-home.test.ts（:33、:180-250、:435、:628、:697 抽点）`
- `doc/08_project/BACKLOG.md（EV-198 条目 :296）`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md（§11.3 第 7 条 :2819、版本记录 :3659）`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md（删除失败行 :270-295 段）`
- `doc/05_testing/README.md（:16 规范句）`
- `test/unit/driver-claim.test.ts（:343-359 抽点）`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":19,"project_reads":19}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
