# 四个零消费方配置项删除：EV-30 ④～⑦ · 实施报告（M11 第 8 步）

> - **日期**：2026-10-08
> - **主题**：M11 第 8 步（上位计划 `.reviews/M11-档位全链路与文档收口/plan/` r3 §4.8，拍板 D-7）；**B 档，未走双审**，提交前由执笔方自审补丁；按 §4.8 直接实施，不另写计划文件
> - **起点**：`265b5f3f`（`main`；工作树里另有一处与本步无关的改动：归档 `M11-复盘报告双维度聚合/` 下的任务文件，本步未碰）
> - **证据目录**：`doc/05_testing/evidence/m11-config-dead-keys-20261008/`
> - **配额**：零配额（只用夹具与纯函数）
> - **方案**：§4.8 定「四条全删，照 ①②③ 做法」（先例 `0c764887`，报告 `REPORT_2026-10-06_config_dead_keys_2.md`）

## 0. 动手前：现状、修法与边界

### 现状（`265b5f3f` 已核）

1. 四个键的类型在 `src/trivium/types.ts`（:1037 `max_turns`、:1039 `unsupported_override`、:1107 `require_adjudication`、:1135 `topic.forbid_chars`），默认值在 `src/trivium/config.ts`（:259、:324、:408）；`config.v2.json` 四个属性都在、都在各自段（topic、gate、zcode 分支）的 `required` 里。
2. `src/` 下没有任何代码读它们——`test/unit/config-consumers.test.ts` 的 `KNOWN_DEAD` 正好就是这四条：
   - `topic.forbid_chars`：主题名校验是 `naming.ts` 的 `validateTopic`（`topic.ts` :25 调用，只传 `max_len`），规则写死；
   - `gate.require_adjudication`：`gate.ts` 的 `checkAdjudication` 恒按逐条裁决判 `missing_findings`，不看这个键；
   - `agents.glm.max_turns`：zcode 适配器不读 `agents.glm` 的任何字段（`zcode.ts` 里没有 `.agents` 访问），`buildZcodeArgs` 的入参里也没有配置；zcode 0.16.5 本身拒绝 `--max-turns`（M0 坑清单 C-01）；
   - `agents.glm.unsupported_override`：没做覆盖而实际模型不同时由 `decideModelUnenforced` 产出 `model_unenforced`、`guard` 播报、不阻断（EV-122）；这个函数只吃覆盖是否尝试、请求值、回读值与成因，不吃配置。
3. 其余出现处：用户手册配置表 :414、:481、:482、:523；本仓 `.trivium/config.yaml` :10、:136、:168、:169；主设计 13.1 示例、11.3 第 1 条（`unsupported_override`「尚未接线」）、R14、FR-06 追溯行（「`global` 档默认拒绝开工」，从未实现）；`test/unit/config-migrate.test.ts` 有八处拿 `agents.glm.max_turns` 当样例（v1 样例、迁移片段、两段并存、合并顺序、本机覆盖、两条未登记 id 夹具、`init` 改写）；`registry-parity.test.ts` :243 说明文字、`types.ts` :1074 与 `config.ts` :678 / :760 注释提到 `max_turns`。PRD、LLD 没有关于这四个键的断言（已 grep 核），不改。

### 修法（照先例）

1. 类型与默认值删除（`init` 按默认值写配置，随之不再写它们）；`DEPRECATED_CONFIG_KEYS` 补四条，**一律精确路径**——`['topic','forbid_chars']`、`['gate','require_adjudication']`、`['agents','glm','max_turns']`、`['agents','glm','unsupported_override']`，不用 `'*'`（与 `agents.codex.effort` 同理：两个 agents 键只属于 zcode 分支，通配会把别家日后接上线的同名键误报成废弃）。doctor / preflight 的已废弃键提示随表覆盖，正文不改。
2. `config.v2.json`：四属性保留、标 `deprecated` 并写说明、移出 topic / gate 段与 zcode 分支的 `required`、类型约束不变。
3. 删除理由按 §4.8 逐条写进代码注释、schema 说明、主设计 13.1.1、手册与 BACKLOG：`forbid_chars` 若接线会允许把 `/`、`..` 移出禁止集；`require_adjudication` 若接线等于给闸门核心判据加一个关闭开关；`max_turns` 在 zcode 0.16.5 无处可接；`unsupported_override` 的 annotate 语义已由 `model_unenforced` 播报承担，AC-23 要的是回读可核对而非强制生效。

### 不改的边界

- `naming.ts` 主题名校验、`gate.ts` 闸门判据、zcode 适配器调用参数、`model_unenforced` 判定与播报一律不动。
- `config.v1.json`（历史契约）与演进设计（冻结）不改；`deprecatedConfigNotice` 正文不改；PRD、LLD 不改。

## 1. 改了什么

1. `src/trivium/types.ts`：`GlmCriticConfig.max_turns` / `unsupported_override`、`GateConfig.require_adjudication`、`Config.topic.forbid_chars` 删除，原位留注释写明删除理由并指向 `DEPRECATED_CONFIG_KEYS`；`AgentConfig` 文档块里「zcode 要 `entry` 与 `max_turns`」改为「zcode 只要 `entry`」。
2. `src/trivium/config.ts`：四个默认值删除；`DEPRECATED_CONFIG_KEYS` 补四条（精确路径，逐条注明理由）；文档块出处补到 2026-10-08；`migrateConfigV1` 与 `loadCtx` 两处注释里的 `max_turns` 样例改成 `entry`。
3. `skills/dual-critic/schema/config.v2.json`：四属性加 `deprecated: true` 与说明，移出 `required`；类型约束（数组、布尔、`integer ≥ 1`、二值枚举）不变。
4. 本仓 `.trivium/config.yaml` 删四处（`forbid_chars` 连同其列表、`require_adjudication`、glm 段两行）；本机 `config.local.yaml` 本来就没有这四个键（已核）。
5. 用例：
   - `config-consumers.test.ts`：`KNOWN_DEAD` **清空**（注释改为七条已全部收口的记录），头注释里「余下四条」的叙述改准；`DELETED_KEYS` 并入四键（默认配置 / schema required 回归锁与流程文档不回潮锁 U8 一并覆盖），两条用例名同步；新增 **U13**（`KNOWN_DEAD` 为空；默认值不带四键；各自单独出现时按精确路径报；放在 codex / gemini 段里的同名键不报；与既有废弃键同在时按表序列出、正文逐个点名）。
   - `config-schema.test.ts`：新增 **V5～V8**（带四键的旧配置与另一组合法取值都通过、默认值不带且不带也通过；六种原本就非法的值照旧被拒并点名；schema 标 deprecated、不在 required，同段 `max_len` 与 zcode 分支 `entry` 仍必填；磁盘 `config.yaml` 带四键时 `loadCtx` 照常加载、键原样留在合并结果）。
   - `config-migrate.test.ts`：原拿 `agents.glm.max_turns` 当样例的几处换成同段仍有消费方的 `agents.glm.entry`（doctor 传给 zcode 探针；内置默认 `null`），见第 3 节。
   - 行为不变三格：`gate.test.ts`、`topic.test.ts`、`zcode-model-selection.test.ts` 各一格，见第 4 节。
   - `registry-parity.test.ts` :243 说明文字去掉 `max_turns`。
6. 文档：主设计 v1.3.136（11.3 第 1 条、13.1 示例、13.1.1「已废弃键」、R14、FR-06 追溯行、16.1 M11 行、§24「13.1 → config.v2」行、变更记录）；用户手册 v1.0.44（§5.1 / §5.4 / §5.5 四行改为已删除，§5.6「已废弃的键」段首改写、表补四行）；BACKLOG EV-30 整体结案；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 类型检查 | 退 0 | 全量内含 |
| 构建（`build.mjs --with-tests`） | 退 0 | `build.txt` |
| 单跑相关九个套件（config-consumers、config-schema、config-migrate、gate、topic、zcode-model-selection、naming、adapter-argv、preflight） | 278 / 276 / 0 / 2，退 0（含新增 8 格） | `suite-unit.txt` |
| 源码变异逐条预跑 | 12 条全红：M1～M5（废弃表漏登四键各一条、`max_turns` 改 `'*'` 通配）各红 U13；M6～M8（默认值加回）各红 6 格（主对账、回归锁、U4、U10、U11、U13）；W1～W4（假想接线）各红对应的行为不变格 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 源码变异装置 | 12/12 咬住 | `mutation-output.txt`、`mutation-spec.json` |
| schema 变异逐条预跑（`.json` 进不了装置） | 5 条全红：S1～S3（required 加回）各红 15 格（含 T4 本仓配置、V5、V7）；S4（去掉 `unsupported_override` 的 deprecated）红 V7；S5（去掉 `max_turns` 的 `minimum`）红 V6 | `mutation-names-schema-log.txt`、`mutation-names-schema-output.json`、`mutation-spec-schema.json` |
| 全量第 1 次 `npm run check` | 3075 / 3073 / 0 / 2，退 0（比起点 3067 多 8 格：U13、V5～V8、行为不变三格） | `check-1.txt` |
| 全量第 2 次（串行） | 3075 / 3073 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 第 1 次全量与自检期间 0、第 2 次全量期间 2（均为 `trivium-index-`，EV-204 残余五）；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

另：用仓库构建产物只读加载本仓配置，`deprecatedConfigKeysIn` 为空、提示正文为 null（本仓配置已不带这四个键；未跑会写回本机探针段的 doctor）。全量两次跑完后只往本报告与主设计变更记录里填了读数，没有改别的文档。

变异规格由 `gen-mutation-spec.mjs` 生成（find 锚点逐条核唯一、replace 扫过特殊替换模式）；逐条预跑沿用先例的 `mutation-names.mjs`（原文照抄、只加一行出处）。

## 3. config-migrate 样例替换：保住了什么

这批用例原本要证四件事：v1 → v2 迁移把 `critics.*` 搬成 `agents.*`；**先迁移后合并**（顺序错了用户值静默失效）；本机层 v1 片段同样迁移；`init` 改写后用户自定义值原样保留。它们只是借 `max_turns` 当一个「用户改过、与内置默认不同的值」。`max_turns` 删掉后仍是 schema 接受的值，用例照旧能绿，但它已经不是一个「生效的配置」，拿它证「用户配的值真的生效了」就名不副实；类型删除后 `glm.max_turns` 也过不了类型检查。

换成同一段（`agents.glm`）里**仍有消费方**的 `entry`：

| 原样例 | 新样例 | 断言强度 |
| :--- | :--- | :--- |
| v1 主配置 `max_turns: 99`（内置默认 40） | `entry: /custom/zcode.cjs`（内置默认 `null`） | 顺序错了停在 `null`，与原先停在 40 同构 |
| 本机片段 `max_turns: 123` | `entry: /local/zcode.cjs` | 片段没被迁移就停在 `/custom/zcode.cjs`，同构 |
| 迁移片段 / 两段并存 `max_turns: 7` | `entry: '/x/zcode.cjs'` | `deepEqual` 整段比对，不变 |
| `init` 改写后 `max_turns === 99` | `entry === '/custom/zcode.cjs'` | 不变 |
| 「未登记 id」夹具 `{vendor, entry, max_turns, unsupported_override}` | `{vendor, entry}` | 仍是 zcode 分支的完整形状（现 required 只剩这两项），问题只在 id 上 |

断言一条没删、没放宽；连带注释（「bin / max_turns 一个都不生效」）同步改成 `entry`，并注明换样例的原因。

## 4. 行为不变的证明

| 行为 | 现成用例 | 本步补的格 | 假想接线变异 |
| :--- | :--- | :--- | :--- |
| 主题名校验 | `naming.test.ts`「拒绝路径分隔符、.. 与前导点」（纯函数）；`topic.test.ts`「非法名退 64 并带建议」（经 ctx） | `topic.test.ts`「EV-30 ④」：配置里写 `forbid_chars: []`，`a/b`、`a\b`、`../etc`、`x..y`、`.hidden` 照样退 64，空格仍转 `-` | W1（空数组就跳过校验）红这一格 |
| 闸门逐条裁决 | `gate.test.ts`「删掉一条裁决 → missing_findings（AC-12）」等 | `gate.test.ts`「EV-30 ⑤」：配置里写 `require_adjudication: false`，漏裁照样 `missing_findings` 并点名 | W2（写 false 就不报漏裁）红这一格 |
| zcode 调用参数 | `adapter-argv.test.ts`「zcode：入口在首位…」（`buildZcodeArgs` 全量逐字） | `zcode-model-selection.test.ts`「EV-30 ⑥⑦」：经 `run()` 与假入口读回真实 argv，带两个 glm 旧键与不带时逐字相同、没有 `--max-turns` | W3（带 `max_turns` 就加 `--max-turns`）红这一格 |
| `model_unenforced` 播报 | `zcode-model-selection.test.ts`「decideModelUnenforced」两格、「run() 限定失败…」；「守卫：model_unenforced 在 ⇒ 播报一句…」「守卫：model_unenforced 缺席 ⇒ 不出声…」两格 | 同上一格：旧配置写 `reject` 时仍 `status: ok`、route `global`、`model_unenforced` 与不带时相同 | W4（`reject` 且未受控就拒跑）红这一格 |

另：四个键的类型已删，`src/` 下任何新写的读取都过不了类型检查；`config-consumers` 的主对账与 U12 也会把重新出现在默认值或 schema 非废弃属性里的键判红。

## 5. 提交前自审

- **断言范围**：既有用例只改了名字、`DELETED_KEYS` 成员与 config-migrate 的样例值（第 3 节），没有放宽任何断言。U8 现在也按裸词扫 `forbid_chars`、`require_adjudication`、`max_turns`、`unsupported_override`——今天 `skills-src/` 与渲染产物里零命中；将来流程文档里若出现与配置无关的同名词（例如 claude 事件流的 `error_max_turns`）会误红，届时把 U8 改成按点分路径扫（与先例对 `parallel` 的说明同一处境）。
- **注释与文档**：§11.3 原写「`unsupported_override` 尚未接线、`reject` 拒绝启动」，FR-06 追溯行写「`global` 档默认拒绝开工」，R14 写「按 `unsupported_override` 处理」——都按实改为「放行、`model_unenforced` 播报，原键从未接线、已删除」。13.1.1「`additionalProperties: false` 的段」补上 topic 段与 zcode 分支（已核 schema 两处确为 false）。
- **范围**：判据与运行期行为一律未动；`config.v1.json`、演进设计没动；本步无新增需要登记进护栏表的调用点。
- **顺带发现、未在本步改**：用户手册 §5.4 `agents.<id>.tiers` 一行仍写「思考等级与厂商 profile 还没下传给各家……预检直接退 64」，与 M11 第 6 步拆除过渡闸后的现状（同节下文 v1.0.43 起「一并生效」）不符。属文档对账，留给第 10 步，不在本步顺手改。
