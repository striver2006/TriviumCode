---
schema: trivium.review.v1
topic: M8-Codex审核者接入
stage: code
role: codex
vendor: openai
agent_cli: codex/0.154.0
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260916T054957Z
rerun_index: 11
snapshot_hash: sha256:96d76257be937255e8d8c88635da5764d766e5b5393acc8de8626ec85c366888
blind: true
started_at: 2026-09-16T05:49:57.557Z
finished_at: 2026-09-16T06:07:15.689Z
duration_s: 1038
tool_calls:
  run_command: 48
  project_reads: 31
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 5
  nit: 3
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0a8c3-c662-70f1-ac63-04204bd17389
---

# 代码审查：M8-Codex审核者接入

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260916T054957Z` ｜ 第 11 轮
> ｜ 本轮审核者 codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

16 条修复的落点逐条核过：#1/#2/#3/#4/#5/#6/#7/#8/#10/#12/#13/#14/#15/#16 均已落地且实现与注释互证成立；目录钩子四态（null/catalog/fallback/unverifiable）在 preflight.ts 的消费分支处置正确，四条预检锁例经逐一变异推演确认能咬住「钩子被用上」而不只是「钩子本身对」。发现问题集中在残留与边角：CODEX-01 是本轮所修缺陷（CODEX-03≡GLM-02）在 runner.ts 异常兜底出口的残漏；CODEX-02 是 J5 取证脚本的生命周期缺口——凭据副本先于守卫创建、多条失败出口不清理临时目录，与 CLAUDE.md 本轮刚写的凭据教训直接相悖；CODEX-03 指出 base_url 缺失时 AC-20 分量④存在「通过而无意义」的真空判定，恰是本版反复消灭的那个形状；另有两处 CODEX-01 改造后未跟上的文档块断言（CODEX-04/05）、§21 变更记录插错位（CODEX-06）、修复清单第 11 条（凭据抹除）被降为 BACKLOG 登记但应答件与台账均未言明（CODEX-07）、bad 出口的回落不点名（CODEX-08）。均为 minor/nit，不动摇本步主体，但 CODEX-02/03 建议在与 AC-20 真机取证同批处理。

**结论**：`approve-with-nits`

## 审查意见（共 8 条：次要 5 ｜ 吹毛求疵 3）

### CODEX-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/runner.ts:188-189（runBothSides 的 settled rejection 兜底出口）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：本轮修复清单第 8 条（CODEX-03 ≡ GLM-02）把 codex 六个失败出口的 profile_requested 从恒 null 改为如实写请求值，理由白纸黑字：「profile 来自静态配置、-p 早已进 argv，不需要运行成功才走到」。但同一缺陷形状还活在 runner.ts 的适配器异常兜底出口：这里恒写 profile_requested: null，而该处 ctx.cfg / requests[critic] 就在手边，配置事实照样可取。于是「adapter.run 抛异常」这一格又把「该族没有 profile 概念」与「这次没采到」压成同一个观测——恰是字段声明「必填而非可空」时声称要避免的那一格，也是本主题第四次处理同一形状时的又一残留位点。

**依据**：src/trivium/runner.ts:189 硬编码 null；对照 src/trivium/adapters/base.ts 的 failedResult（profileRequested?: string | null 及「失败出口同样要如实写」文档块）与 codex.ts 六个出口的传参；应答件 r10 修复清单第 8 条的裁决理由。

**建议**：在该兜底出口按 critic 从 ctx.cfg 派生请求值（经注册表/vendor 派生取 profile 键，不得引入 Agent 字面量——纪律 7/10），或让 CriticRequest 携带 profile_requested 由 review.ts 组装处填入，兜底直接取 input.requests[critic] 上的镜像值。补一条锁例：适配器抛异常时 codex 侧的 profile_requested 仍等于配置值。

### CODEX-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/codex-sandbox-control.mjs（main() 内 prepareCodexHome 调用与后续两个早退 return、文件尾的 cleanup 与 main().catch）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：取证脚本的顺序与出口把凭据副本裸露在系统临时目录：① prepareCodexHome(runDir,…) 在 bin / readonly_flags 两道守卫**之前**执行——守卫不通过时脚本直接 return 1，但此刻 ~/.codex 的含明文 token 副本已拷进 mkdtemp 出的工作目录且**无人清理**；②main().catch 出口同样不清理；③「机制直证不通过」（副本里出现 sandbox 键）只打 ⚠️ 行，不参与 process.exitCode——一次副本放宽了沙箱语义的取证运行仍会退 0，被证据管道读成 J5 成立。这恰是本版 CLAUDE.md 新增「含凭据文件禁止整份打印」教训的同一风险面：脚本自己造了一份副本又在失败路径上把它留在 /tmp。

**依据**：scripts/codex-sandbox-control.mjs:100-157（mkdtemp→prepareCodexHome 先于 loadProbe/bin/readonlyArgs 检查；两个早退 return 无 rm）；文件尾 `if (!KEEP) { await fs.rm(work,…) }` 只在正常路径执行；exitCode 表达式只含 attempted/denied/aExists/aliveEchoed，不含 report.机制直证_裁剪白名单无sandbox键。

**建议**：把探针守卫（bin、readonly_flags 非空）提到 prepareCodexHome 之前；整个工作目录生命周期包进 try/finally（finally 里 KEEP 之外一律 rm -rf，异常路径同样清理）；exitCode 纳入机制直证项。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/types.ts:255-262（CodexProviderProbe.base_url 注释「缺失不构成失败」）× PRD AC-20 分量④、设计 §15.3 同句` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：base_url 归一为 host 后，types.ts 给它的判定语义是「只在场时参与判定，缺失不构成失败」。但 AC-20 分量④是「两侧 provider 的 base_url（至少 host）互不相同」——任一侧为 null 时该分量**不可评估**，而现行口径把它读成「不参与」，于是「两次都采不到 host」与「两 host 确证互异」在验收侧长成同一个通过。这正是本版在 J5 正对照、slug 目录三态上反复消灭的「通过而无意义」形状，新引入的第四分量却按旧形状落档；PRD/§15.3 两处规定性文本都没写 null 怎么处置。

**依据**：src/trivium/types.ts:260-262；PRD_driver_dual_critic.md AC-20（第 20 条分量④）；设计 §15.3 AC-20 行（:2333）均无 null 条款；probes/codex.ts 的 baseUrlHost 对非法 URL 整串返回 null（code 双审 CODEX-06 修复的既定行为）。

**建议**：把④的判据改成三态：两侧 host 均在场且互异＝通过；任一侧 null＝该分量记「无法校验」，验收不得据此宣布 AC-20 达成（同 checkModelAgainstCatalog 的口径）。落 PRD AC-20 与设计 §15.3 两处规定性文本，types.ts 注释同步。

### CODEX-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/types.ts:412-415（models_by_profile 的「旧留痕」说明）× src/trivium/adapters/codex.ts catalogModelsFor 空表分支` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：types.ts 承诺：旧留痕（无 models_by_profile）时「消费方据此回落 models 并把该侧记为 unverifiable，**不静默通过**」。实现相反：空表 ⇒ 返回 null ⇒ checkModelAgainstCatalog 静默用 probe.models（含隐藏项的基底全集）校验，既无 unverifiable、也无回落 note——预检输出与修复前逐字相同。这条承诺-实现分叉有两半问题：① 注释/契约说谎（其自身的用例「旧留痕…绝不降级成放行」断言的是另一个行为）；② 配了 profile + 旧探针这一格，正是本步花整轮修掉的「拿基底目录顶替」的静默复刻——用户不重跑 doctor 就一直待在这格里，而输出零提示。两半要分开处置（改实现补 note，或改承诺并说清为什么接受静默），由 Driver 裁。

**依据**：src/trivium/types.ts:412-415 vs src/trivium/adapters/codex.ts:405-412 空表返回 null 的注释（「不更准，但也不更松」——注意它对「更松」的比较基线是本步之前，不是对无 profile 那支刚收紧过的可见性口径）；preflight.ts:404-431 对 null 不产生 note；test/unit/codex-adapter.test.ts:540-552。

**建议**：推荐实现侧：空表回落时同样给 kind:'fallback'（why 写「探针结论早于逐 profile 目录，本次按基底目录校验，请重跑 doctor --only codex」），让消费侧的「回落要说出来」纪律覆盖这一格；或退一步修正 types.ts 的表述并在设计 v1.3.11 台账的「过期边界」段写明该格是静默回落。

### CODEX-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:2778-2792（v1.3.11 详情段落位置）；同主题：r10 应答件修复清单 #11/#15` |
| 类别 | scope-drift ｜ 层次 code |
| 置信度 | high |

**问题**：两处「改语义只改半截落点」的复发：① §21 变更记录里，v1.3.11 的八段详情被插在 **v1.3.9 行与 v1.3.10 行之间**——GLM-07（#15「v1.3.11 行移到表尾」）只把摘要行挪到了表尾，详情块落在了会读成「v1.3.9 的续篇」的位置，唯一实现依据的最新变更记录因此错挂到别的版本号下；② #11（GLM-08：「运行成功后抹除副本凭据…EV-20 状态更新」）实际交付的是**登记 EV-20 且明言「不自行实施」**——BACKLOG 里理由充分（留存策略属新范围），但审批过的修复清单与 v1.3.11 台账都没说「#11 降级为登记项、凭据副本照旧留 30 天」，拿应答件对账的人会以为抹除已落地。

**依据**：设计文档 :2776（v1.3.9 行）→ :2778-2792（**一、…八、**段落）→ :2793（v1.3.10 行）→ :2794（v1.3.11 行）；r10 应答件修复清单第 11 条原文；BACKLOG.md EV-20（「没做的是运行结束后清理…不自行实施」）；`git diff HEAD --stat -- src/trivium/adapters/codex-home.ts` 为空（本轮无凭据抹除实现）。

**建议**：①详情段移到 v1.3.11 行之后（或并入该行单元格能承载的位置），与 #15 的本意对齐；②在 v1.3.11 台账行与应答件补一句「#11 实施降级为 EV-20 登记，凭据清理另行裁决」，让修复清单与落地状态逐条对得上——这条正是 GLM-01 教训（落点清单不能靠记性）对「完成声明」维度的应用。

### CODEX-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/codex.ts:385-390（catalogModelsFor 的函数级文档块）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：函数文档块说「三种返回对应三件不同的事」，并断言「配了但探针没有该 profile 的条目 ⇒ 空清单 ⇒ 无法校验」——两条都被本函数的实现和它自己的新锁例推翻：实际返回是四种（null/catalog/fallback/unverifiable），且「探针没有本 profile 条目」一支走的是 **fallback**（用例「目录：探针没有本 profile 的任何结论 → fallback，不假装目录为空」明言不是无法校验）。这是 v1.3.10 立的纪律「注释里任何形如 X 会/不会 Y 的断言，落笔时必须指出断言它的那一行用例」的字面违例：断言与既有用例直接矛盾。

**依据**：src/trivium/adapters/codex.ts:385-390 vs 同函数 :414-421 的 fallback 分支；base.ts:110-124 的四态契约表；test/unit/codex-adapter.test.ts 的 fallback/nosuch 锁例。

**建议**：文档块改写为四态并与 base.ts 契约表逐词一致（或直接只指向契约表、函数内不复述——复述两处正是「同一个问题两个答案」）。

### CODEX-06 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/codex.ts:746 × readCatalogPath（:1034-1049）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | low |

**问题**：逐 profile 采集把 readCatalogPath 读到的目录路径**原样**塞进 `-c model_catalog_json=<路径>`；而 M8 第 3 步已实测本机 config.toml 里这类键存在 `~/...` 形态（「配置里的 ~ 路径跟 HOME 走」）。`~` 的展开是在**配置文件解析层**证明的；`-c` 命令行覆盖值会不会同样展开，没有任何实测记录。两种失败方向不对称：若 codex 不展开且报非零退出，得到 fallback（响亮，安全）；若它不展开却**静默回落默认渲染**，则存进 models_by_profile 的是基底目录却被标成该 profile 的 catalog——本步修掉的「误放」以另一种形态复活，且全链路无人知道。

**依据**：src/trivium/probes/codex.ts:1034-1049（readCatalogPath 无 ~ 处理）；:746（直接传原值）；:331-345（probeCodexModels 把 exit 0 + 可解析 JSON 一律记 ok:true）；设计 v1.3.10 台账对 `~`+HOME 的实测记载。

**建议**：最便宜且无假设的修法：readCatalogPath 返回前把前导 `~/` 用 os.homedir() 展开成绝对路径；或补一条 -c 值为 `~` 形态时的对照实测并记进 M6 探针报告。

### CODEX-08 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/preflight.ts:426-433（checkModelAgainstCatalog 的 bad 出口）` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：「回落要说出来」只覆盖了 ok 出口（note）与空目录出口（why）；**fallback + 命中基底目录缺失 → bad** 这一路，detail 写「模型不在 ${label} 模型目录中，可用值：…」并列出基底目录名单，只字不提「本该用该 profile 的目录而采集失败」。用户照报错去查基底目录、往基底名单里挑模型，而端点实际执行的是 profile 目录——误杀方向的新误导。四条新预检锁例都只走 ok/unverifiable 出口，bad+fallback 组合无用例（CODEX-04 锁例修的是「消费」，这格是消费的第三个分支）。

**依据**：preflight.ts:404-433（bad 分支不读 scoped.why/note）；test/unit/preflight.test.ts 新增四条（无 fallback×bad 组合）。

**建议**：scoped.kind==='fallback' 时在 bad detail 前置回落原因一句（复用 scoped.why）；补一条锁例钉住该形态。

## 认为正确的部分

- 目录钩子四态的**消费侧**处置逐格正确（preflight.ts:404-421）：unverifiable 先返回、fallback 与「无目录」分文案、null 保持既有两家逐字不变、catalog 用 scoped.models/source——与 base.ts:110-138 契约表一致，「没测到 ≠ 测出来没有」这一格真拆开了。
- 预检消费侧锁例（r10 修复 #7 的实质）经逐条变异推演确实咬得住：删 catalogModelsFor 调用四条全红；交换 catalog/fallback 分支由「误放」条打红；把 fallback 并进 unverifiable 由「回落必须出现在输出里」条打红。回应了应答件 §3 自认的上一版缺口。
- visibility 过滤抽成纯函数 parseCodexModelCatalog 并被三条用例锁住（含字段缺失分支与「非 JSON ≠ 空目录」）——GLM-04「守卫没被守着」的缺口真补上，且「缺失按可见」的宽松方向选择有写明理由。
- CODEX-01 的探针侧落点完整：CodexCatalogProbe.ok/why 分离、基底失败保留旧结论并点名、逐 profile 失败入 models_by_profile_errors 且 doctor notes 逐个点名；profile 选择段复用快照、失败格自然跳过，无重复子进程。
- base_url 归一只在采集处做一次、解析失败整串丢弃不「尽力截段」、providerBaseUrl 与 providerCredentialed 共用 providerSectionBody 单一实现——凭据面收窄的方向正确（其判定语义残留见 CODEX-03）。
- profile_requested/model_provider 恒写不走条件展开（review.ts:1062-1071）与 buildCodexResult 的成对纯函数产出，加上「回读不到记 null 绝不用请求值顶替」锁例，把 J6 的两个维度钉成了不可互渗。
- GLM-01 的「规定性落点」修复核实到位：PRD AC-20 与设计 §15.3 的正对照措辞已改为实测形态并写明 B 路径被证伪；P-24～P-27、EV-25、EV-20、doc/02_design/README 版本对账、PRD v1.4.5 头部同步逐条在树。
- 脚本的守卫语义（readonly_flags 空即拒跑、旗标/入口取自探针、exitCode 代替 process.exit）符合修复清单第 9 条的方向（残留生命周期问题见 CODEX-02）。

## 未覆盖范围（本侧盲区）

- 本沙箱文件系统只读、mkdtemp 被 EPERM 拒，`node --test dist/test/...` 无法整体跑通（preflight/codex-adapter 大面积红在夹具临时目录上，属环境而非代码）——「全量 1130/1130」类声明本轮**未独立复验**，锁例「咬得住」的结论基于逐条静态变异推演。
- 未重跑 `codex debug models` / `doctor --only codex` / J5 对照脚本，P-25～P-27 与 §四 更正里的全部实测数字按文档采信。
- AC-22 的 gate 三前缀可见性、gate --check 差集逻辑本轮未审（不在 16 条清单内，也不在我的镜头内），PRD 头部对 AC-22 达成面扩大的表述未逐词核。
- 契约/集成层测试（hook-guard、registry-parity、codex-wiring 承诺文件中缺位的 wiring 面）未审；test/unit/codex-adapter.test.ts 中段（diff 截断区）以文件现状读，未与基线逐字 diff。
- EV-20 所指 `scanSecrets` 覆盖面缺口、`~/.trivium/runs` 留存策略（禁读/越界区域）未评估。
- agy/zcode 两适配器新增 null 字段的**逐字行为不变**声明只核对了字段形状，未跑既有双侧等价性用例。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `.reviews/M8-Codex审核者接入/code/_meta/changes-20260916T054957Z.diff`
- `.reviews/M8-Codex审核者接入/code/2026-09-16-M8-Codex审核者接入-r10-response-claude.md`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/codex-home.ts`
- `src/trivium/preflight.ts`
- `src/trivium/probes/codex.ts`
- `src/trivium/review.ts`
- `src/trivium/runner.ts`
- `src/trivium/types.ts`
- `src/trivium/config.ts`
- `src/trivium/schemas.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/archive.ts`
- `skills/dual-critic/schema/run.v2.json`
- `skills/dual-critic/schema/config.v2.json`
- `skills/dual-critic/schema/review.v1.json`
- `scripts/codex-sandbox-control.mjs`
- `test/unit/codex-adapter.test.ts`
- `test/unit/preflight.test.ts`
- `doc/01_requirements/PRD_driver_dual_critic.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/README.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-09-11_m0_probe.md`
- `doc/08_project/BACKLOG.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":48,"project_reads":31}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
