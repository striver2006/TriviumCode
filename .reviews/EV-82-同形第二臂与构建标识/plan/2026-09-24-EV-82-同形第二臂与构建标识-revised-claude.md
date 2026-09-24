---
schema: trivium.disposition.v1
topic: EV-82-同形第二臂与构建标识
stage: plan
role: claude
kind: revised
run_id: 20260924T034019Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - CODEX-07
  - CODEX-08
  - CODEX-09
  - CODEX-10
  - CODEX-11
  - CODEX-12
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
  - AGY-05
  - AGY-06
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
  - GLM-07
---

# 裁决：EV-82 小主题第一段 · 计划双审第 1 轮

> 被审对象：`2026-09-24-EV-82-同形第二臂与构建标识-claude.md`
> ｜ 运行：`20260924T034019Z`（12m16s）
> ｜ 三侧均为结构化产出，结论均为 `request-changes`
> ｜ 共 25 条：重要 10 ｜ 次要 15 ｜ 零阻断
> ｜ **全部接受**

## 0. 本轮的形状

**三侧一致肯定的**：直接调 `prepareZcodeHome`、不另写准备逻辑；清理只认 `makeTempDir` 的返回值；两臂共用判据；
只告警、不阻断；不修路由、不做 T2、不结案。§1 的八条现状三侧都逐条核过，属实。

**问题集中在四处**：

1. **构建标识比错了对象（CODEX-01）**。已核：`snapshot.git_head` 取自 `freeze.ts` 的 `headSha(projectRoot)`，是**被审项目**的 HEAD；
   TriviumCode 是装到用户级、在任意项目里跑的工具。只有被审项目恰好是本仓时，两者才可比；在别的项目里这条告警会**每次都亮**。
   上位 r5 §3.3.2 与 §11 把「安装副本构建标识 = `snapshot.git_head`」写进了 T2 判据，**源头在 r5**。
   同族的还有两处：dirty 的作用面比安装面小（CODEX-07 ≡ AGY-01 ≡ GLM-03），且只在构建时算一次（CODEX-08）。
2. **凭据替换规则两头都不稳**：
   - 替换得太宽，会把导入要用的非凭据值也换掉，同形臂可能自造 `global`，被第 2 行误读成 H2（CODEX-04 ≡ GLM-01）；
   - 替换得不够深：嵌套值与 `options` 之外的值不在面上（CODEX-05 ≡ AGY-03 ≡ GLM-05）；
   - 还有「先落盘真实凭据、再覆写」的时间窗（AGY-03）。

   两个方向要同时收：**按键名判凭据、递归遍历全副本、在落盘之前替换**。同时把「替换造成的伪影」列为第 2 行的并列成因，并预登记区分手段。
3. **`prepareZcodeHome` 的 `homeDir: null` 分支会用真实 HOME 拉起（CODEX-02 ≡ AGY-03 后半）**。已核：`invokeZcode` 在 `homeDir` 为 null 时不改 `HOME`。
   这一支会让 CLI 读、甚至写用户真实的 `~/.zcode/v2/provider_config.json`，与本段「不碰真实 `~/.zcode/**`」直接冲突。必须写成**不拉起**的未判定早退。
4. **判读表的轴选错了，第 1 行的标签也太窄（CODEX-03、AGY-02、GLM-06、CODEX-10、GLM-02）**：
   - 「白名单 `global` ∧ 同形 `config_copy`」是 H2 的**直接**证据，r1 把它吞进了「环境漂移」；
   - 第 1 行「H3 按排除法成立」，排除掉的只是「配置读取层」，配置层之后至少还有可选性过滤、服务端映射两种候选；
   - 它还依赖两条没写死的前提：(D) 格的隔离腿成立（诊断 r3 §6 第 2 条交办、本段漏接），以及臂请求值等于实跑请求值。

**另有两处数据面的核对**（不对应意见编号）：
- 本机**没有**任何 `ZCODE_` 前缀的环境变量（2026-09-24 只列变量名核）。GLM-04 说的宿主预置凭据键在本机不发生，但措辞「与审查臂同形」确实不准，照改。
- `src/trivium/util/git.ts` 已有 `workTreeHash`，CODEX-08 要的「收尾时重算」可以直接复用，不必新写。

**闸门期不改业务文件，也不改原稿。** 落点在 `/dual-approve` 之后写进 **r2 稿**。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 核对属实：`snapshot.git_head` = `headSha(projectRoot)`，projectRoot 是被审项目的 git 根；编排器是跨项目工具，外部项目里恒不等，告警常亮会把 r5 §3.3.2 排查次序的第一站废掉。源头在 r5 §3.3.2 / §11 的 T2 判据文本 | r2 §2 改为「**自述指纹 + 仅本仓比对**」：<br>①构建标识记 `git_head`、`dirty`、`built_at`，外加**构建来源仓的根提交哈希**（`git rev-list --max-parents=0 HEAD`，作仓库身份）与 `inputs_sha256`（见 CODEX-08）；<br>②运行时，只有当被审项目的根提交哈希 = 构建来源仓的根提交哈希（被审项目就是编排器本仓）时，才比 `git_head` 与工作树，其余项目只把 `snapshot.build` 当自述指纹记录、**不比、不告警**。<br>r2 §8 写明：r5 §3.3.2 与 §11 那条 T2 断言要改成「本仓模式下」的措辞，按 r5 §14「事实断言被推翻」的口径，在 EV-82 小主题收口报告里追加更正，不回改 r5 |
| CODEX-02 | codex | major | 接受 | 核对属实：`prepareZcodeHome` 在副本源缺失或 `model` 为空时返回 `homeDir: null`；`invokeZcode` 在 `homeDir` 为 null 时不改 `HOME`。同形臂照写会以真实 HOME 拉起，读到甚至写入用户真实的 `v2/provider_config.json` | r2 §3 步骤 3 增：`prep.homeDir === null` 或 `prep.route !== 'config_copy'` ⇒ **不拉起**，返回 `override: null` 与 why（照兄弟臂 `q.qualified === null` 的早退形态）；本臂与白名单臂同一门控（副本源在场才介入）。<br>§5 增用例：副本源缺失、模型为空、限定失败三种输入都不 spawn（用可断言的假入口计数为 0），真实 HOME 下零副作用 |
| CODEX-03 | codex | major | 接受 | 成立：「白名单 `global` ∧ 同形 `config_copy`」是 H2 的直接证据，r1 第 3 行「同形：任意」把它吞了；第 2、3 行的分界也不在同一根轴上 | r2 §4 判读表改为**两臂三态的全组合**，逐格写读法（见 AGY-02 落点的判定次序）：<br>(cc, cc)：配置层两臂都成立 ⇒ 配置层之后（见 GLM-06）；<br>(cc, global)：H2 候选或替换伪影（见 GLM-01）；<br>(global, cc)：**H2 直接证据**（同形能读出、白名单读不出）⇒ 第二段；<br>(global, global)：配置层两臂都不成立 ⇒ 环境漂移候选（09-22 入口替换），不猜归因；<br>任一 null ⇒ 未判定 |
| CODEX-04 | codex | major | 接受 | 成立：白名单臂只证明「这些键**缺席**不影响导入」，不证明「带上非法值也不影响」；按类型判据替换会把非凭据值一并换掉，同形臂可能自造 `global` | r2 §3 步骤 4 的替换规则从「类型判据」改为「**键名判据**」：键名匹配凭据形态（`apiKey` / `token` / `secret` / `password` / `authorization` / `cookie` 等，大小写不敏感），或位于任一 `headers` 对象之下的字符串值，才换成哨兵；其它值**原样保留**。<br>替换后在 why 与报告里登记「本轮替换了哪些键路径」（只列路径，不列值）。<br>§5 增对照用例：只换凭据键时，同形臂在合成配置上的判定与未替换前相同 |
| CODEX-05 | codex | minor | 接受 | 成立：r1 只覆盖 `provider.*.options` 的顶层标量与 `headers`，嵌套对象、数组、provider 层其它键、顶层其它键里的凭据会原样进副本；§5 没有一条断言「源文件里的凭据值不出现在副本里」 | r2 §3 步骤 4：键名判据对**整份副本递归遍历**（含嵌套对象与数组），不限于 `options`；另加一道**形态兜底**：任何字符串值若命中仓库既有的凭据形态检测（`redactSecrets` 同一套判据），不论键名一律换掉。<br>§5 增对拍用例：「副本里所有字符串值 ∩ 源文件中被判为凭据的值 = 空集」，与 CODEX-04 的「非凭据值原样」用例一起，让漏换、误换两个方向都会变红 |
| CODEX-06 | codex | minor | 接受 | 核对属实：兄弟臂 `if (mo.override !== null) probe.model_override = mo.override`，判不出即保留旧值；`probed_at` 是 CLI 粒度，分不出单字段新鲜度，两臂不一致告警可能拿新旧值相比 | r2 §3「机读落盘」写明：同形臂沿用「`null` 不覆盖」；doctor 的两臂不一致告警**只在两臂都是本轮产出且都非 null 时**触发，本轮是否产出记在 notes。§5 增用例：新臂判不出时旧值保留且不出告警 |
| CODEX-07 | codex | minor | 接受 | 核对属实：`install()` 把 `skills/` 下每个目录整树同步进安装目标，`skills/dual-critic/schema/*.json` 还经 import 内联进 bundle；r1 的作用面 `src scripts package.json` 漏了它们 | 与 AGY-01、GLM-03 同一落点：r2 §2 把 dirty 与 `inputs_sha256` 的作用面定义为「**影响安装产物内容的路径集**」：`src/`、`scripts/`、`skills/`、`package.json`、`package-lock.json`、`tsconfig.json`；写明 `test/`、`doc/` 不进产物、故排除。生成物 `skills/dual-critic/scripts/trivium.cjs` 已被 `.gitignore` 覆盖，不会引入噪声 |
| CODEX-08 | codex | minor | 接受 | 成立：dirty 只在构建时算一次，构建后、运行前工作树又改了，就会静默通过，这正是本仓最常见的形态（改完没重装） | r2 §2：构建时对上述作用面算 `inputs_sha256`（复用 `util/git.ts` 的 `workTreeHash` 同口径）；本仓模式下，收尾时用同一作用面**重算**一次，不等即告警。告警分成两条独立文案：「安装副本不是当前工作树构建的」（`inputs_sha256` 不等）、「安装副本与仓库 HEAD 不同版」（`git_head` 不等） |
| CODEX-09 | codex | minor | 接受 | 成立：上位 r5 §3.3.3 ② 的具名证据 `doc/05_testing/REPORT_<日期>_ev82_review_arm.md` 在 r1 全文没有出现，也没有列为产出 | r2 新增 §4.1「产出：具名报告」：路径 `doc/05_testing/REPORT_<日期>_ev82_review_arm.md`；必含要素为两臂读数（三态 + requested + observed）、两臂请求值与诊断实跑请求值并排、替换了哪些键路径、层级边界那句、环境前提加注（09-22 入口替换）、(D) 隔离腿前提的取证结果（GLM-02）。§8 量级里写报告与跑实验分开记 |
| CODEX-10 | codex | minor | 接受 | 成立：臂的请求由 `pickNonFirstModel` 自选，诊断实跑请求的是 `GLM-5.3-Flash`；今天恰好重合（副本源只有一个 provider，成员 `GLM-5.3`、`GLM-5.3-Flash`），但 r1 没写成前提 | r2 §3 步骤 2：同形臂的请求模型**参数化**，缺省仍取 `pickNonFirstModel`。§4 写明判读前提：「两臂请求值 = 诊断实跑请求值」，报告并排登记三个值；不相等时各行结论降级为「在臂请求的那个模型上成立」 |
| CODEX-11 | codex | minor | 接受 | 核对属实：`probeModelOverride` 文档块写着「本地免密端点下哨兵挡不住真实请求」，所以才带只读参数；新增一臂等于 doctor 每次多一次真实 headless 拉起 | r2 §4 标题与正文把「零配额」改成有前提的表述：「前提是副本里的凭据全被换成哨兵、provider 不是免密端点；本机副本源唯一 provider 为 `bigmodel-coding-plan`（需要密钥）」。§8 记最坏成本：每次 doctor 多一次拉起，超时上限与兄弟臂同为 30s，超时记 null 不重试 |
| CODEX-12 | codex | minor | 接受 | 核对属实：诊断说明 r3 §6 逐条交办四件事给小主题计划，r1 一条都没接 | r2 §7 增「r3 §6 四条的去向」：<br>①T2 判据补 rollout 逐条旁证：**第二段**（T2 在修复之后）；<br>②(D) 隔离腿的机制支撑：**本段**，见 GLM-02 落点；<br>③(A) 行 reason 的载体是 `trace.json` 的 `modelSelection.reason`：本段报告的判读说明里写明，不改 r5 原文；<br>④`ExitPlanMode` 截断回合的解析回退形态：**本段收口时**登记进 BACKLOG（并入 r5 规划的「两侧解析回退条目新立」） |
| AGY-01 | gemini | major | 接受 | 核对属实：`skills/dual-critic/schema/` 下的 JSON 经 `import … with { type: 'json' }` 内联进 bundle，`tsconfig.json` 也影响构建 | 与 CODEX-07 同一落点（作用面含 `skills/` 与 `tsconfig.json`） |
| AGY-02 | gemini | major | 接受 | 成立：r1 判读表没有判定次序，「白名单 global ∧ 同形 null」同时落进两行；第 1 行把配置层之后的回落唯一归因为注册表，也窄了 | r2 §4 判读表写明**判定次序**：先判任一为 null（未判定），再按两臂三态组合查表（CODEX-03 落点）。(cc, cc) 一格的读出改为「问题在配置读取层之后」，候选并列列出，见 GLM-06 落点 |
| AGY-03 | gemini | major | 接受 | 成立三处：嵌套凭据漏换（同 CODEX-05）；`prepareZcodeHome` 先把真实凭据写盘、再由本臂覆写，中间有残留窗口；`homeDir: null` 分支未处理（同 CODEX-02） | ①嵌套：同 CODEX-05 落点。<br>②时间窗：r2 §3 步骤 3 改为给 `prepareZcodeHome` 加一个**可选**参数 `transformCopy(cfg)`，在它 `writeFile` **之前**对副本对象做凭据替换；不传时行为与今天逐字相同（审查臂不传）。这是对它签名的一处扩展，§7「不改 `prepareZcodeHome` 的行为」改写为「不改它在不传该参数时的行为」，并加一条用例锁住「不传即与今天同一份输出」。<br>③`homeDir: null`：同 CODEX-02 落点 |
| AGY-04 | gemini | minor | 接受 | 核对属实：`ZcodeProbe.model_override` 只持久化三态枚举，requested / observed / why 进 notes；r1 设计的对象字段破坏了对称 | r2 §3「机读落盘」改为：`model_override_full_copy` 只存三态枚举，与 `model_override` 同构；requested / observed / why / 替换键路径一律进 notes |
| AGY-05 | gemini | minor | 接受 | 核对属实：告警必须在 `writeRunMeta` 之前写进 `meta.gate.warnings` 才能落进 run.json；r1 §2 与 §5 对 `build === null` 的文案口径不一 | r2 §2 写明告警注入点在 `review.ts` 收尾段 `writeRunMeta` 之前，与「本轮原稿不在保护集」那条同位。文案分四条：「构建标识缺失」（null）、「构建时工作树有未提交改动」（`build.dirty`）、「安装副本不是当前工作树构建的」（`inputs_sha256` 不等）、「安装副本与仓库 HEAD 不同版」（`git_head` 不等）；后三条仅本仓模式 |
| AGY-06 | gemini | minor | 接受 | 成立：r1 没有 `build.dirty` 分支的用例，同形臂也缺拉起与回读的流程级用例 | r2 §5 增：①四条告警文案各一条用例 + 变异（去掉比对 ⇒ 红）；②同形臂流程用例：用可控的假入口脚本（在临时目录里按参数写出或不写 `v2/provider_config.json`）覆盖 `config_copy` / `global` / 超时 / 未识别四种停止形态，仿 `zcode-model-selection.test.ts` 的既有写法 |
| GLM-01 | glm | major | 接受 | 成立：(cc, global) 一格有两种成因：真 H2，或凭据替换本身破坏了导入；r1 只写了前者，第二段可能去二分一个不存在的差异键 | r2 §4 (cc, global) 一格的读出并列两种成因，并**预登记区分手段**作为第二段的第一刀：把替换面收窄到白名单臂已证明无害的那一个键（`options.apiKey`），其余值原样，在同一臂上复跑一次。复跑后变成 `config_copy` ⇒ 伪影；仍是 `global` ⇒ H2。<br>收窄后副本里会留有真实的非 apiKey 凭据，这与审查臂整份拷贝的现状同一姿态（0600、一次拉起、finally 删除），报告里如实写明 |
| GLM-02 | glm | major | 接受 | 核对属实：诊断 r3 §3 注与 §6 第 2 条把「个人配置的 provider 键 ≠ 副本源 legacy 键」的机制支撑交办给本计划，r1 没接；而 (cc, cc) 一格的推论正站在这条前提上。EV-87 记个人配置 09-21 被桌面端重写过，「UUID 形态」只是一次旧快照 | r2 §4.2 新增「(D) 隔离腿的取证」：**只读**个人 `~/.zcode/v2/provider_config.json` 里 provider 的**键名**（provider id），不读任何值，比对其形态与副本源的 legacy 键 `bigmodel-coding-plan`；做法与 `provider_config.personal_file` 只判有无的既有纪律同型，用仓库里的只读函数实现、进报告。<br>降级路径写明：若个人配置里也有 `bigmodel-coding-plan` 这个键，(D) 格的「隔离成立」就不再有旁证，(cc, cc) 的结论降级为「隔离存疑，重按 (B) 排查」 |
| GLM-03 | glm | major | 接受 | 核对属实：同 CODEX-07 / AGY-01 | 与 CODEX-07 同一落点；另写明作用面的语义是「影响安装产物内容的路径集」，并列出 `test/`、`doc/` 被排除的理由 |
| GLM-04 | glm | minor | 接受 | 核对属实：审查臂（`invokeZcode`）不清 `ZCODE_CREDENTIAL_ENV_KEYS`，只有探针族清；r1 写的「与审查臂同形」其实是白名单探针臂的形态。本机无任何 `ZCODE_` 前缀环境变量（§0），这处偏差在本机不会造成分歧，但措辞不准 | r2 §3 步骤 5 措辞改为「环境与**白名单探针臂**同形（清两个凭据 env 键以保零配额）；与审查臂的已知偏差是审查臂不清这两个键」。照 `probes/zcode.ts` 里宿主预置 `PROVIDER_CONFIG` 变量的检测先例，对这两个凭据键加同型检测：宿主预置时在 notes 里登记，判读表各格加列为备择成因 |
| GLM-05 | glm | minor | 接受 | 成立：同 CODEX-05；另外 r1「凭据面更小」一句会被读成「无凭据」 | 与 CODEX-05 同一落点；r2 §3「凭据面」一段改写为：「键名判据加形态兜底后仍是**黑名单**性质，漏判的凭据会原样进副本。缓解：`makeTempDir`（0700）、副本 0600、一次拉起、`finally` 整删；残余面是 SIGKILL 先于 `finally`。这与审查臂整份拷贝的残余面同形，**不是消除**」 |
| GLM-06 | glm | minor | 接受 | 成立：排除法只排除了配置读取层，配置层之后至少还有注册表精确匹配、可选性 / 套餐过滤、服务端映射回落几种机制；rollout 里 providerId 恰是套餐名，支持「注册表之外」的解释 | r2 §4 (cc, cc) 一格的读出与给用户的报告措辞改为「问题在配置读取层之后。候选：运行期注册表匹配、可选性或套餐过滤、服务端映射回落」，不再写「H3 成立」；H3 标签只作为候选之一。§4「可选佐证」的检索面同步放宽，不只盯 `isSelectable` |
| GLM-07 | glm | minor | 接受 | 核对属实：`probeModelOverride` 的 `global` 分支 why 文案写的是「请先核对 `buildProbeCliConfig` 的白名单」，是白名单臂专属；共用函数若连文案一起带走，同形臂会给出错误指引 | r2 §3 步骤 6 写明：抽出的纯函数只返回**三态判据与观测值**，成因文案由各臂自带。同形臂 `global` 的文案并列「键形态差异（H2）」与「凭据替换破坏导入」两种成因（与 GLM-01 同格） |

## 1. 本轮不做的事

- 不改上位 r5 的原文（CODEX-01 的源头在 r5 §3.3.2 / §11）：按 r5 §14 的口径，在 EV-82 小主题收口报告里追加更正。
- 不在闸门期读个人 `v2/provider_config.json`（GLM-02 的取证在实施期做，只读键名）。
- 不在本段实现 GLM-01 的收窄复跑：它是第二段的第一刀，本段只预登记。
