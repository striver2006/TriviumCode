# M10b 第 2 步 · 入口资产单源渲染、认领步骤、多目标安装、协议片段两段式 实施报告

> **状态**：代码与测试完成，**未提交**；等待代码双审（用户发起 `/dual-review-code`）。glm 薄冒烟待用户在 ZCode 桌面端操作（§8）。
> **上位**：计划定稿 r10（`.reviews/M10b-入口资产与真载体验收/plan/` 的 r10 稿，按稿首引用规则顺着 r9 → r8 → r7 → r5 读）；第 2 步原文在 r5 §5，r9 §2 与 r10 §2、§3.1.3 替换了其中若干条。
> **日期**：2026-09-25　**起点**：`c4d9af6`（`main`，r10 定稿，未推送）
> **证据**：`doc/05_testing/evidence/m10b-step2-20260925/`

本步开工前的三件前置（M9 基线产物、agy 用户级读取面实测、`registry.ts` 的 glm `guardLevel` → L2）已在上一会话完成，随本步一起走代码双审，这里不重复。

## 0. 读数总览

| 项 | 读数 |
| :--- | :--- |
| 全量测试 | `npm run check`：1943 / 1941 pass / 0 fail / 2 skipped（§7，含 D-4 之后） |
| 第一阶段逐字节还原 | 7 份 claude 产物全部 IDENTICAL（§1.1） |
| 变异 | 19 / 19 咬住（主规格 17 + D-4 两条），基线全绿（§6） |
| codex 零配额枚举 | PASS：7 个入口全部 `r0/<名字>/SKILL.md`，零嵌套（§5） |
| 真实 HOME | **未写**：没有跑 `install:local`，也没有对真实 `~/.codex`、`~/.zcode`、`~/.gemini` 做任何写入 |

## 1. 单源渲染（r5 §5.1，r9 §2.1 / §2.4，r10 §2.4 / §3.1.3）

### 1.1 两阶段做法与 J3 的机器证据

r2 §3.1 的原话是「抽出过程用 diff 证明『渲染回 claude 载体 = 现文件』」。第 2 步同时要往 claude 产物里加认领步骤、`--driver`、护栏段，所以分两阶段做：

1. **第一阶段只抽单源、不改语义**：`skills-src/` 写好 7 份契约与 claude 载体后，渲染回 claude 与现文件逐字节比对，7 份全部 IDENTICAL（sha256 前 16 位两侧逐一相同）。
   读数 `stage1-byte-identity.txt`；比对脚本 `stage1-check.mjs`；当时的源快照 `stage1-sources/` 与渲染器快照 `stage1-entry-render.ts.txt`（第二阶段改了源，不留快照就无法复现）。
2. **第二阶段再加语义**：认领步骤、`--driver` 注入、护栏段、另三家的转抄规约、`argument-hint` 的注册表插值。claude 产物此后的差异都来自这几条，逐条在 §1.3。

此后「源 → 产物」不漂由契约测试 `entry-render-parity` 守（§1.4）。

### 1.2 结构

| 位置 | 内容 |
| :--- | :--- |
| `skills-src/commands/*.contract.md` | 7 份命令契约：头部是产物 front-matter 与 `@` 模板变量，正文是模板。B / C / D 共用 `partials/review/body.md` |
| `skills-src/carriers/<agent>.yaml` | 四家载体适配层：`layout`（top / entry）、输出哪些 front-matter 键、参数写法（substitute / transcribe）、调用写法 |
| `skills-src/partials/` | 片段：参数转抄规约、护栏注入段、认领步骤、B/C/D 正文 |
| `src/entry-render.ts` | 渲染器。未知变量、缺失片段一律抛错（静默留空会让产物少一段而测试照绿） |
| 产物 | claude：`skills/<命令名>/SKILL.md`；另三家：`skills/dual-critic/entry/<agent>/<命令名>/SKILL.md`（**进 Git**） |

`scripts/build.mjs` 增渲染步（`--render` / `--render-only`，`npm run render`）。**缺省构建不重写产物**：否则 `npm test` 的 pretest 先构建，「源 → 产物」那条测试会恒绿。

载体派生量全部来自注册表：`DRIVER`、护栏档 `GUARD`（`guardProfileOf`：由 `guardLevel` 与新登记项 `hookConfigTarget` 派生）、`MODEL_HINT` / `MODEL_FLAGS` / `ONLY_CHOICES`（已启用审核者减本载体自己，EV-61）。

计划 r5 §5.1 列的「`TV` 调用前缀」没有做成载体字段：四家的 wrapper 路径相同（项目相对的 `.trivium/bin/trivium`），留在共用正文里。`--session-id` 按 r9 §2.3 四家一律不注入。

### 1.3 各家产物的差异

| 项 | claude | codex / gemini / glm |
| :--- | :--- | :--- |
| front-matter | 原样五键 | 只输出 `name`、`description`（第 1 步各臂哨兵实测的形态）；`argument-hint` 写进正文「参数写法：」一行 |
| 参数 | `$ARGUMENTS`（载体替换） | 不含 `$ARGUMENTS` 字面；正文首段是转抄规约：来源、空参数不编造、拼串（沿用 claude 现行规则）、两条样例（r10 §2.4.1） |
| 调用写法 `{{cmd:…}}` | `/dual-xxx` | codex `$dual-xxx`；gemini `/dual-xxx`；glm `/dual-xxx`（桌面端，薄冒烟实测；初版按命令行写成 `/skill dual-xxx`，冒烟后改，附录 B） |
| 护栏段（四条主命令） | L1：误拦提示 | glm：L2 明示 + 五个生效前提 + 误拦提示；codex、gemini：L2 明示（r10 §3.1.3 表） |
| 其它 | — | 加一句「只在用户显式调用本命令时执行」：这三家没有 `disable-model-invocation` 的等价开关（第 1 步报告 §1.3 g2：关斜杠展开也挡不住模型自己读 skill） |

claude 产物相对原文件的差异只有：B / D 的第 0 步认领、命令 A 的 S0.8 与 S4.5 认领、`--driver claude` 注入（B/D 6 处、C 5 处、A 6 处）、四条主命令的 L1 误拦提示段、命令 A 的「两者都由 Hook 强制」一句改为按护栏档渲染（claude 渲染结果与原文相同）、`argument-hint` 与 `--start` 模板里的模型 / 选侧清单改由注册表插值（多出 codex，`<slug>` / `<id>` 统一为 `<模型>`）、`models` 透传那一句改为「逐个传给对应的 `--model-<审核者 id>`」。辅助命令（approve / abandon / status）的 claude 产物与原文件逐字节相同。

### 1.4 契约测试

- 新增 `test/contract/entry-render-parity.test.ts`（10 条）：源 → 产物零 diff、无残留产物；`$ARGUMENTS` 在另三家出现 0 次，两段规约完整在场；`--driver <自家 id>` 次数等于应注入的调用数（显式表：A 6、B 6、C 5、D 6、辅助命令 0）且不含别家 id，`topic resolve` 那几行的 `--driver` 必须在 `--` 之后（resolve 只解析 `--` 之后的 argv，放前面会被静默忽略）；认领位于写原稿之前；护栏段与 r10 §3.1.3 的表一致（表本身先钉住）；调用写法；模型与选侧取值不含当轮 Driver；渲染器自测。
- `skill-flag-parity` 扩为四家：旗标槽位、`critics` / `models` 透传、`--entry`、命令 A 的委托说明逐家断言；新增「声明的旗标 CLI 都认」（对 `topic resolve` 的具名旗标白名单，新导出 `resolveNamedFlags()`）。
- 新增 `test/integration/args-transcription-roundtrip.test.ts`（r10 §2.4.2）：两组特殊字符按转抄规约拼成真实 shell 命令行，经 `/bin/sh` 解析后，`topic resolve` 的焦点、`run.json` 的主题、两侧 BRIEF 第 2 段焦点都与输入逐字一致（桩审核者，零配额）。

### 1.5 r10 §2.4.2 的一处事实更正

r10 §2.4.2 写「含角色后缀字样（如 `-glm.md`）的那一组，在装有 Bash Hook 的载体上会被已知误拦拦下」。实测的触发条件不同，往返用例照实钉了三条：

| 焦点内容 | Hook 判定 |
| :--- | :--- |
| 写动词字面 + 角色后缀字样 | 拦（退 2） |
| 只有写动词字面 | **同样拦**：`TV` 本身含 `.trivium`（编排器独占路径的字面），满足了「提到保护对象」那一半 |
| 只有角色后缀字样 | **不拦**：缺 `writeLike` 前置门 |

所以真正的触发条件是「焦点里有写动词字面」，与角色后缀字样无关。入口资产的误拦提示照这个写（「用户给的焦点或任务目标里若有写动词字面……先问用户改措辞」）。r10 是已审批件，按 r5 §14 第三条留痕更正、不回改；用户 2026-09-25 定落在 **r11 §2**（增量稿，不送审）。

## 2. 认领步骤、`--driver` 进 skill、命令 A 放开（r5 §5.2 / §5.3）

- **认领**：B / D 增第 0 步「认领本阶段（写原稿之前）」：先 `topic claim`，原稿还没写就用 Write 落盘，再进第 1 步；已写好也补跑一次（同一声明幂等）。命令 A 在 S1 之前认领 plan（S0.8）、在 S5 之前认领 code（S4.5）。命令 C 不认领。退 64 原样转述并停止，资产里写死「不要删那些文件来换回认领」；认领是自声明、窗口内次数不设上限，照实写进资产。
- **命令 A 放开**：`topic-args.ts` 删除 `scope === 'all' && --driver` 的拒绝；交叉校验由「all 整段跳过」改为对 plan、code 两阶段逐一比对，任一冲突在入口退 64（不等到 S6 的 `--start`）。省略 `--driver` 而两阶段权威值不同 ⇒ 退 64，不挑一个继承；只有一个阶段有权威值 ⇒ 继承它。最终值收在一行 `const driver = explicitDriver ?? inheritedDriver ?? DEFAULT_DRIVER`，`driver-wiring` 判据随之改锚。
- 用例：单元 1 条改写，集成 4 条替换原先的「命令 A 不接受 --driver」。

## 3. 多目标安装（r5 §5.4 / §5.5，r9 §2.1，r10 §2.1 / §2.2）

- **skill 根由注册表派生**：新登记项 `entrySkillRoot`（`homeEnv` / `homeRel` / `skillsRel`）与 `entrySkillExtraReadRoots`，求值函数 `entrySkillRootOf(agent, home, env)`。codex 走 `CODEX_HOME`，未设回落 `~/.codex`；测试断言它与 `codexHomeOf()` 同口径（设与不设两种）。哪家的产物在仓库哪个布局，读 `skills-src/carriers/`，与渲染同一份源。
- **拍平**：另三家把 `entry/<agent>/<命令名>/` 逐个装到各自 skill 根顶层；运行时根（`skills/dual-critic/` → `TRIVIUM_ASSET_ROOT ?? ~/.claude/skills/dual-critic`）排除 `entry/`。
- **运行时根必装、与编排器同源取值**：`resolveAssetRoot` 抽到 `src/trivium/asset-root.ts`（可注入 home / env），`config.ts` 原样再导出；安装器与 `main()` 打印的 `cliPath` 都从它取。
- **家根不存在即跳过**，报告写明原因；运行时根照装，且在 claude 家根不存在时打印跨产品副作用提示（r2 §3.2.1）。
- **先查后写，只报错不删除**：①另三家目标根顶层有 `dual-critic/` 或 `entry/` ⇒ 残留；②完整读取面（安装根 + `~/.agents/skills` 等）里有同名：第三方的 ⇒ 不覆盖，本产品别家入口 ⇒ 冲突；③安装根里的同名只在「是本产品的」时按升级覆盖。任一条不过，整次安装一个文件都不写。
- **新增 `--targets <id,…>`**：只装点名的几家（运行时根照装）；点名的家根不存在 ⇒ 整次失败。
- **本步测试撞出的交互并已修**：只读审查 Agent 定义（`~/.gemini/config/agents/trivium-critic/agent.md`）原先无条件写，会在没装 agy 的机器上凭空建出 `~/.gemini`，下一次安装就按「家根在场」把 agy 的入口也装进去。现改为 agy 家根在场才装，不在场记一条提示。
- **卸载**：按归属删各家 skill 根里「本产品的」同名入口（别人的同名留着并提示）、运行时根（按它自己的归属，不绑 claude 目标）、Agent 定义。
- 用例 `install.test.ts` 重写为 11 条，**全部注入临时 home 与临时 `CODEX_HOME`**，仓库副本取真实渲染产物；含 r10 §2.1 的性质判据（四个目标根与运行时根下无深度 ≥ 2 的 `SKILL.md`；另三家恰 7 个入口，claude 7 个 + 运行时）与残留用例（预置 `<目标根>/entry/x/dual-zzz/SKILL.md` ⇒ 退非零、列出路径、预置文件原样还在）。

## 4. 协议片段两段式（r5 §5.5，r2 §3.3）

- `protocol/CLAUDE.md.snippet`、`AGENTS.md.snippet` 两份单段片段**删除**，换成 `critic.snippet`（审查员身份，正文与旧 AGENTS 片段相同）与 `driver.snippet`（Driver 协议，按 L1 / L2 泛化：唯一写权、入口与各载体调用写法、后缀规则与写原稿前认领、逐条裁决、审批发起权、判据式误拦表述、RV-B1）。
- `init.ts` 按注册表 `instructionFiles` 分发（`protocolPlan`）：每个文件带哪几段由读它的几家派生，新登记项 `criticReadsInstructionFiles`（claude 为 false，EV-44）。结果：`CLAUDE.md` 只带 Driver 段；`AGENTS.md`、`GEMINI.md` 审查员段在前、Driver 段在后；**新增 `GEMINI.md`**。
- **升级**（先读了旧 `appendSnippet` 再改，r2 §3.3 的未覆盖项）：旧逻辑见标记就跳过，片段永远停在 init 那天。新逻辑按标记内正文的 sha256 判断：命中历代旧版（git 历史里旧 CLAUDE 片段 11 版、旧 AGENTS 片段 1 版，逐版算出）⇒ 原位替换成新两段、不追加第二块；与当前正文相同 ⇒ 跳过；**别的一律不动**、提示手工合并；标记不完整 ⇒ 不动、提示。
- **本仓根目录**用同一段逻辑更新（未跑整个 `init`，不碰 wrapper 与 Hook）：`AGENTS.md` 由旧单段原位升级为两段；新建 `GEMINI.md`；`CLAUDE.md` 的标记内是手工维护的扩充版，判为「与任何已知版本都不同」、按设计**未动**。
- 随改：`MANUAL_user.md`「坑二」（原文指向已删除的片段文件、描述的行为已变）；`disposition-role-assets` 的一处注释；接入套件 `STUB.md`（它原写「`instructionFiles` 没有任何消费方」，现已不成立）；BACKLOG **EV-06** 置 done（「接上」分支；「Hook 按它判 Driver 协议落点」一支没做）。
- 用例 `init.test.ts` 新增 5 条：派生规则（含翻转一项登记后结果跟着变）、三文件写入与 GEMINI.md 新建、已知旧版原位升级与幂等、手工改过不替换、标记不完整不动。

## 5. EV-61 代码侧残余（r5 §5.6）与 codex 零配额枚举核对

先登记进 BACKLOG EV-61（追加段「M10b r3～r5 核出」），再实施：

| 项 | 改动 | 验证 |
| :--- | :--- | :--- |
| ① `hooks.ts` `resolveRoundDriver` 上方「三种结局」 | 第二条末句后追加「M10a 第 1 步（EV-72）的变化」，原句保留 | 只动注释 |
| ② `hookPreWrite` 上方文档块 | 指针由 `criticRoleSuffixes(DEFAULT_DRIVER)` 改为 `hasProtectedRoleSuffix(target, driver)`，括注矛盾改准 | 只动注释 |
| ④ `archive.ts` `writeMeta` 报错文案 | 由 `naming.ts` 新增的 `roleArtifactSuffixLabel()` 插值，与判据同源 | 断言 + 变异 E4 |
| ⑤ `registry.ts` `CRITIC_AGENT_IDS` 注释 | 追加「M9 起四家均已启用」 | 只动注释 |
| ⑥ `hookPreBash` 拒绝文案 | 按机制改准：删掉或去掉执行位 ⇒ 守卫保守拦截；内容被替换 ⇒ 永真放行；配置段或 `.trivium/` 整体被移除 ⇒ 不再有任何拦截。**同一因果在 `isOrchestratorOwnedPath` 的文档块里也写成了事实，一并追加更正**（原句保留） | 断言 + 变异 E6 |
| ⑦ `config.ts` 缺省 `peer_artifact_globs` | 先核消费面：唯一消费方 `freeze.ts`（`enumerateDenyPaths` 一带），取「注册表派生的全部 `**/*-<id>.md`」∪ 本配置项。**缺省值不改**，只补注释 | 只动注释 |
| EV-61 原条目 | `cli.ts` USAGE 的 `--model-*` 与 `--only` 取值改由注册表插值；三处 `argument-hint` 随渲染插值（§1.2） | 新用例 `usage-registry-parity` + 变异 U1 |

**codex 零配额枚举核对**（r10 §2.1）：脚本 `codex-enum-check.mjs`。用同一个 mkdtemp 目录下的临时 `HOME` 与临时 `CODEX_HOME`，经真实安装器 `--targets codex` 装入，跑一次 `codex debug prompt-input '$dual-review-plan 甲 乙'`（codex-cli 0.156.1，退 0，stderr 空，不发请求、没有拷贝任何凭据）。
读数 `codex-enum/codex-enum-summary.json`：本产品 7 个入口全部是 `r0/<名字>/SKILL.md`，嵌套路径 0 条，判 **PASS**。原始渲染 `codex-enum-prompt-input.json` 做过脱敏（临时目录前缀 → `<tmp>`，主目录 → `~`；脱敏没盖住 macOS 的 `/private` realpath 前缀，所以 r0 那一行显示为 `/private<tmp>/…`），凭据形态扫描 0 命中。
临时目录删除前断言它在 `os.tmpdir()` 下且前缀对得上，只删 mkdtemp 的返回值。

## 6. 变异

规格 `mutation-spec.json`，装置 `scripts/mutation-check.mjs`（七道闸），输出 `mutation-output.txt`：基线全绿（8 个套件），**17 / 17 咬住**。
D-4（§8 第 1 条）另一份规格 `mutation-spec-2.json`，输出 `mutation-output-2.txt`：C1 缺省集合不减 Driver、C2 显式集合也静默减，**2 / 2 咬住**。
**两份均于代码双审 r2 修复后在当前代码上重跑并覆盖读数**（仍为 17 / 17、2 / 2）：r1 修复把 `LEGACY_PROTOCOL_SHA256` 改名分档后，P1 的查找串已找不到注入点（装置闸 7 会拒跑、不会误判通过），规格随之改为 `isKnownProtocolBody(target, interior)`（r2 GLM-01）。
代码双审两轮修复新增的判据另有第三份规格 `mutation-spec-3.json` / `mutation-output-3.txt`，见 §10。

| 组 | 变异 |
| :--- | :--- |
| 安装器 I1～I6 | 拍平改回整树搬运（r10 §2.1 变异 1）；去掉运行时根对 `entry/` 的排除（变异 2）；残留检测失效；查重名只看安装根；家根不存在也照装；Agent 定义无条件安装 |
| 渲染器 R1～R4 | 另三家也用 `$ARGUMENTS`；护栏档一律 L1；模型清单不减当轮 Driver；独立行空片段不去行 |
| 命令 A T1～T2 | 只比对 plan 阶段；两阶段权威值不同时挑一个继承 |
| 协议片段 P1～P2 | 不看旧版指纹见块就换；审查员段不看「作审核者时读不读项目记忆」 |
| EV-61 E4、E6、U1 | 文案退回写死三家；拒绝文案退回旧因果；USAGE 的 `--only` 退回写死两家 |

## 7. 全量测试

`npm run check`（typecheck + build + test）：1940 / 1938 pass / 0 fail / 2 skipped；D-4 落地后 1943 / 1941 / 0 / 2（新增 `critics.test.ts` 三条）。
跑全量时核出并已跟上的既有判据：`driver-wiring`（最终 driver 那一行改了形态）、接入套件 overlay（注册表末项锚点变了；桩 Agent 补上四项新登记——它是第五家的接入模板，新增一家 Agent 时这四项同样要填）。

## 8. 待用户定与待做

1. **非 claude Driver 在缺省配置下走不通命令 A**（本步核出，计划与 BACKLOG 都没定过）：缺省审核者集合里就有它自己（codex、gemini、glm 都在缺省集合里），`resolveCriticSelection` 退 64；而命令 A 不接受 `--critics`（GLM-02 的既有边界）。B / C / D 可以显式传 `--critics` 绕开，命令 A 没有出口。
   可选：(a) 选侧来自**缺省集合**时自动减去当轮 Driver（显式 `--critics` 含 Driver 仍退 64），行为变化、需一轮验证；(b) 命令 A 接受 `--critics`（撤销 GLM-02 那条拒绝）；(c) 不改，登记为已知边界，QUICKSTART 写明「非 claude Driver 走命令 A 要先改 `default_critics`」。第 4 步剧本的 glm 轮走命令 B，不受影响。
   **已定（2026-09-25）：(a)，并入本步**。`critics.ts` 缺省分支减去当轮 Driver；用例三条、变异两条；记入计划 **r11 §1**（D-4，不送审）。
2. **r10 §2.4.2 的事实更正**（§1.5）落在哪份文件。**已定：r11 §2。**
3. **真实 HOME 安装**：本步没有跑。薄冒烟需要把 glm 入口装进 `~/.zcode/skills`，同时会刷新运行时根 `~/.claude/skills/dual-critic`（即 wrapper 指向的全局副本）。建议命令 `node dist/install.cjs --targets claude,glm`（不碰 `~/.codex`、`~/.gemini`），**跑之前请你确认**。
   **已执行（2026-09-25，用户确认后）**：先对真实 HOME 跑只读预检（只调 `planInstall` / `checkInstall`）：claude 7/7 同名为自家上次安装、glm 0/7、读取面无冲突。
   随后 `npm run build`（构建标识 `c4d9af6`，作用面有未提交改动，inputs `9817040cf68e`）→ `node dist/install.cjs --targets claude,glm` 退 0：运行时根 22 个文件、claude 7 个入口、glm 7 个入口，
   裁掉运行时根里的两份旧单段片段，Agent 定义照常覆盖；codex、gemini 跳过（本次未选）。抽查三个入口与仓库产物逐字节一致，两个根下无嵌套 `SKILL.md`。
   同时核出本机 agy 已自动升到 1.2.11（探针记 1.2.10），预检退 69；经用户同意在本仓跑 `doctor --only agy`（真实调用，读取、schema、零污染三格全过），之后本仓与冒烟夹具的 plan 阶段预检（claude / glm 两个 Driver，跳过探活）全部通过。
4. **glm 薄冒烟**（r10 §2.5）：需要你在 ZCode 桌面端操作，逐步清单见本报告附录 A；结果回填本报告。
5. **文档回溯**仍归第 5 步（r5 §8.4 + r10 §6）：README / QUICKSTART / MANUAL 的安装目标与目录示例、设计文档两处的片段文件名、各载体调用写法与 L1 / L2 节等。本步只改了会当场失实、且指向已删除文件的 MANUAL「坑二」。
6. **已知边界**（不在本步修）：共用正文里的工具词汇按 Claude Code 写（「Bash 工具默认超时 120s」「把工具级超时设为 `bash_timeout_ms`」），别家的 shell 工具未必有同样的超时参数，薄冒烟与第 4 步照实记录；「L1 / L2」等级文案在 `preflight` 里的打印属第 3 步 B1。

## 9. 代码双审第 1 轮的修复（run `20260925T060626Z`，用户拒绝并要求「修改后再次审核」）

裁决件 `…/code/2026-09-25-M10b-入口资产与真载体验收-response-<Driver>.md`：10 条全部接受（codex 解析降级，按 `CODEX-F01` / `F02` 两个单元裁决，F02 内含 5 条逐条裁决）。落点如下。

| 意见 | 改了什么 | 用例 / 核对 |
| :--- | :--- | :--- |
| CODEX-01 ≡ GLM-01 | `install.ts` 新增 `checkRuntimeRoot`：运行时根与仓库重叠（任一方向，realpath 后比）→ 拒绝；已存在、非空、`SKILL.md` 身份行不是本产品运行时 → 拒绝；不存在或空目录放行。装前检查与卸载共用，卸载判不过只提示不删 | `install.test.ts` +4：指向运行时源本身、指向其父目录、指向带内容的外来目录、三种放行格（不存在 / 空 / 被打断的上一次安装）；变异见 `mutation-output-3.txt` 的 I7 / I8 / I9（r1 时写在这里的「3 条红」是会话内临时注入的读数、未归档，r2 CODEX-01 ≡ GLM-01 指出后按装置重跑归档） |
| GLM-02 | `syncDir` 源与目标 realpath 相同即短路（防御，主判据在上一行）。本机实测 Node v25.2.1 / darwin 下 `fs.copyFileSync(f, f)` 不抛错、内容不变——**截断不成立**，危险在裁剪 | 同上 |
| CODEX-02（收 EV-67） | `assertModelOverrideKeys` 增加入参「本轮入选集合」，三个入口传入已解析的 `critics`；能入选但本轮没入选 → 退 64，列本轮入选并指向 `--critics`。命令 A 契约改用 `MODEL_HINT_DEFAULT` / `MODEL_FLAGS_DEFAULT`（缺省集合减本载体） | `topic-args.test.ts` +2、`driver-flag.test.ts` 补 `review --start` 与 `preflight`；变异见 `mutation-output-3.txt` 的 M1（同上，r2 起归档）；重渲染后**只有** codex / gemini / glm 的 `dual-run` 三份产物变化（去掉 `--model-claude`），claude 7 份逐字节未动 |
| CODEX-03 | `parseInstallArgs`：只认 `--targets` 与 `--uninstall`，未知参数、重复 `--targets`、卸载带 `--targets` 一律报错 | `install.test.ts` +1（十个 argv 形态） |
| CODEX-04 | `registry-parity` 两条扫描追加 `EXTRA_SCANNED = [src/entry-render.ts, src/install.ts]`。裁决件原写「install.ts 纳入要开豁免、故不纳入」，**实测两者都零命中**（`install.ts` 唯一的家根字面量 `.gemini/…` 带路径分隔符，属性扫描本就排除），故都纳入 | 37 / 37 |
| CODEX-05 | AGENTS.md 概览 / 常用命令 / 已知坑 / 同步清单、README 目录树补源与产物关系；契约测试失败提示分「改了源」「手改了产物」两种出口。AGENTS.md 追加进 r5 §8.4 文档落点表（本节即登记） | — |
| GLM-03 | 指纹表改名 `KNOWN_PROTOCOL_SHA256`，**只追加、含当前版**（追加两段式的两个指纹）；`init.test.ts` 断言当前 `protocolPlan()` 拼出的每份正文指纹都在表里 | 手改 `driver.snippet` 一行即红、提示给出要追加的行，还原后绿（会话内手工核对；装置只认 `src/*.ts`，归档的等价变异是 `mutation-output-3.txt` 的 P4：把当前版指纹从表里拿掉）。r2 起表按文件分档，见 §10 |
| GLM-04 | `isOurEntry` 文档块改为写明它同时决定卸载删除面及判据边界；README 卸载描述同步 | — |
| GLM-05 | 两阶段权威值互异时的报错不再叫人「显式传 --driver」，改为说明无相容值，并按阶段给出 `topic claim` 改写命令（仅对声明、不对留痕）或另开主题 | `driver-flag.test.ts` 对应用例加四条断言 |

**与裁决件文字的四处偏差**（r1 时这里只数了前两处，r2 CODEX-06 ≡ GLM-02 指出后补齐）：

- CODEX-01 的「本产品标记」：裁决件写「`scripts/trivium.cjs` 与 `schema/` 在场」，实施取 `SKILL.md` 身份行。理由：同步按目录序拷贝，`SKILL.md` 先落、`scripts/` 在后，被打断的安装会留下前者缺后者，按裁决件的判据重跑会把自家目录拒之门外。
- GLM-03：裁决件写「CURRENT 常量 + 改片段时把旧 CURRENT 挪进 LEGACY」，实施取「只追加、含当前版」的单表。前者的「挪」仍靠记性，测试查不出挪没挪；后者旧值在它还是当前版时就已入表。
- CODEX-04：裁决件写「`install.ts` 纳入要开豁免、故不纳入」，实施两个模块都纳入。理由：实测两者都零命中，不需要豁免。
- CODEX-02 的用例落点：裁决件写在 `critics.test.ts` 与 `topic-args.test.ts` 各补一格，实施两格都放在 `topic-args.test.ts`，另在 `driver-flag.test.ts` 补 `review --start` 与 `preflight` 两个入口，`critics.test.ts` 未改。理由：要防的是「入口没把入选集合传进来」，判定函数自身的单测测不到入口接线，放在入口层才咬得住。

全量 `npm run check`：**1951 / 1949 pass / 0 fail / 2 skipped**（较 §7 的 1943 多 8 条）。

**真实 HOME 重装**（2026-09-25，用户要求）：先只读预检（`planInstall` / `checkInstall`，claude、glm 各 7 个入口，0 冲突；本机未设 `TRIVIUM_ASSET_ROOT`，运行时根身份行对得上）。
随后 `npm run build` → `node dist/install.cjs --targets claude,glm` 退 0：运行时根 22 个文件、claude 7 个入口、glm 7 个入口，无裁剪；codex、gemini 跳过（本次未选，与 §8 第 3 条同范围）。
抽查 `trivium.cjs`、claude 与 glm 的 `dual-run`、`driver.snippet` 四处与仓库逐字节一致。

用户对命令 A 支持 `--critics` 的定见：做，但放在本轮复审之后单独做，登记为 BACKLOG **EV-125**。

## 10. 代码双审第 2 轮的修复（run `20260925T064650Z`，用户通过并要求「修改后提交」）

裁决件 `…/code/2026-09-25-M10b-入口资产与真载体验收-r2-response-<Driver>.md`：9 条全部接受（codex 再次解析降级，整段 JSON 为一个单元 `CODEX-F01`，内含 6 条逐条裁决）。gemini `approve`，glm `approve-with-nits`。

| 意见 | 改了什么 | 用例 / 核对 |
| :--- | :--- | :--- |
| CODEX-02 | 协议指纹表按**指令文件分档**（`CLAUDE.md`：11 个旧单段 + 当前 Driver 段；`AGENTS.md`：旧 AGENTS 片段 + 当前两段拼合；`GEMINI.md`：当前两段拼合）；`isKnownProtocolBody` 按目标文件名只查本档。此前不分文件，删掉一段后剩下的正文恰等于**别的文件**的已知正文，会被原位复原 | `init.test.ts` +4：AGENTS.md 只剩 Driver 段、GEMINI.md 只剩 Driver 段 / 只剩审查员段、CLAUDE.md 放两段拼合，均「不替换、原样保留」；守卫改为按文件断言；变异 P3（退回总表）4 条红 |
| CODEX-01 ≡ GLM-01 | 新增 `mutation-spec-3.json` 覆盖两轮修复的全部新判据，按装置跑出 `mutation-output-3.txt`：**10 / 10 咬住**（I7～I11、A1、A2、M1、P3、P4）；§6 两份规格在当前代码上重跑（17 / 17、2 / 2），P1 查找串随改名更新 | 三份输出均为「工作树干净、基线全绿」起跑 |
| CODEX-05 | 残留检测豁免 claude 根处写明前提；运行时根被变量指到别处、缺省位置仍有本产品运行时时，安装报告提示「那一份不再更新」（不删、不阻断） | `install.test.ts` +1；变异 I11 |
| CODEX-03、GLM-03 | `MODEL_HINT` / `MODEL_HINT_DEFAULT` 注释对照写全：B / C / D 保留全集（能用 `--critics` 加进来，单写会退 64 并指路）；命令 A 取注册表缺省集合，项目扩充 `default_critics` 时少列无害、缩减时多列、照写退 64 | 重渲染 0 份变化 |
| CODEX-04 | `GUIDE_env_setup.md` 重装一节补「重装前取消指向工作树的 `TRIVIUM_ASSET_ROOT`」及旧副本、渲染产物两句 | — |
| CODEX-06、GLM-02 | §9 偏差小节补齐为四处 | — |

为了让 I9、I10 两条变异有用例可咬，另补两格：变量指向仓库的上级目录（判重叠而非外来目录，只调安装、不调卸载）；`syncDir` 同路径直测（为此导出 `syncDir`，注释写明只为测试）。

**与 r2 裁决件文字的一处偏差**：裁决件列了「AGENTS.md 只剩审查员段」也应不替换，实施时发现它**与旧版 init 给 AGENTS.md 写的正文逐字相同**——「用户删了 Driver 段」与「这是旧版项目」在盘上是同一个状态，分档也区分不了。按旧版升级（后者远为常见），这一格从用例里去掉，作为固有边界写进 `KNOWN_PROTOCOL_SHA256` 的注释与用例注释。另两格之一换成 GEMINI.md 只剩审查员段（GEMINI.md 没有单段时代，应当不替换）。

全量 `npm run check`：**1958 / 1956 pass / 0 fail / 2 skipped**（较 §9 的 1951 多 7 条）。

## 附录 A · glm 薄冒烟逐步清单（用户在 ZCode 桌面端操作）

**目的**（r10 §2.5，不设收口判据、不进 J4）：加载入口 skill → 参数原文到达 → `topic claim` → 写一份原稿；核一次参数保真；核桌面端调用写法。**不运行 `review --start`**。

准备（我来做，需你先确认第 8 节第 3 条的安装）：

1. 真实 HOME 安装 `--targets claude,glm`，把输出贴进本报告；
2. 在会话临时目录建一个夹具 git 仓库（一个 `src/` 文件），用刚装好的运行时跑 `init`，把夹具绝对路径告诉你。

你来做：

3. ZCode 桌面端打开夹具目录，新建会话；如有工作区信任提示，照常确认。
4. 发这一条（先试斜杠直调写法）：
   `/dual-review-plan 看 it's 这一处的 $HOME 与 "双引号" --topic 冒烟主题`
   若 ZCode 不认，改发：`/skill dual-review-plan 看 it's 这一处的 $HOME 与 "双引号" --topic 冒烟主题`。记下哪种写法生效。
5. 看着它执行：预期顺序是第 0 步 `topic claim` →（原稿不存在）用 Write 写 `.reviews/冒烟主题/plan/<日期>-冒烟主题-glm.md` → 第 1 步 `preflight` → 第 2 步 `topic resolve`。
   **它要运行 `review --start` 时拦下**：有审批提示就拒绝；没有就点停止。
6. 告诉我：用的哪种调用写法、写原稿用的哪个工具、有没有被拦、拦截文案（如有）、它停在哪一步。
7. **会话一结束先别开别的 ZCode 会话、也别跑任何 zcode 命令**（rollout 只留最近 3 个会话）；告诉我之后，我当场把该会话的 `model-io-sess_<id>.jsonl` 摘录拷进本步 evidence，用其中的用户消息原文逐字比对 `task.json` 的主题与原稿里记下的焦点。

## 附录 B · glm 薄冒烟结果（2026-09-25，ZCode 桌面端，用户操作）

**载体**：ZCode 桌面端，夹具为会话临时目录下新建的 git 仓库（`init` 于本步安装的运行时根；本机探针结论拷自本仓，已核只有探活缓存、无凭据）。
会话 `sess_ff61fd15-…`，28 次模型请求，**全部 `GLM-5.3`**。rollout 在用户告知后当场拷走（原件留会话临时目录，入仓只收摘录 `smoke-glm/rollout-excerpt.json`：用户消息、工具调用、工具结果开头、每条请求的 model；**不收系统提示与 headers**——响应头里有 `set-cookie`）。

**与清单的偏差（如实）**：会话没有在 `review --start` 前停下，而是走完一整轮到闸门停点。期间用户中途插话切模型：第一轮 run `20260925T053103Z` 被 Driver 自己 `--cancel`；Driver 按用户要求用 Edit 改夹具的 `.trivium/config.local.yaml` 把 codex 的 profile 换到 deepseek，再起 run `20260925T053433Z`（codex / gemini 两侧 `success`），读两份审查、用 Write 写裁决件、`gate --check`、`--await-approval` 停下。两轮都是真实审查调用，耗了配额。本节只记到 r10 §2.5 要求的范围，外加这一轮暴露的问题；**不作 J4 证据**。

| r10 §2.5 要核的 | 读数 |
| :--- | :--- |
| 桌面端调用写法 | **`/dual-review-plan …` 生效**（第一种写法）。ZCode 把它转成一次 `Skill` 工具调用，`args` 为参数原文逐字：`看 it's 这一处的 $HOME 与 "双引号" --topic 冒烟主题` |
| 加载入口 skill → 参数原文到达 | 成立（同上） |
| `topic claim` → 写原稿的次序 | 第 0 步 `topic claim --topic 冒烟主题 --stage plan --driver glm --json`（请求 2）→ **Write** 原稿（请求 4）→ `preflight --driver glm`（请求 5）→ `topic resolve`（请求 6），与第 0 步的次序逐字一致 |
| 转抄规约 | `topic resolve --stage plan --json -- '看 it'\''s 这一处的 $HOME 与 "双引号"' --topic 冒烟主题 --driver glm`：整段单引号、内部单引号 `'\''`、其余不转义、`--driver` 在 `--` 之后，与规约逐字相符；`--start` 同样带 `--driver glm` 与 resolve 给出的 `--critics codex,gemini` |
| 写原稿、裁决件用的工具 | 原稿、裁决件都是 **Write**；Bash 只跑 `TV` 命令与只读探查 |
| 有没有被拦 | 没有（本步尚未渲染 ZCode Hook 配置，夹具里没有 Hook；焦点不含写动词，Bash 侧误拦判据本也不会命中） |
| `--wait` 的工具超时 | 两次 `--wait` 都带 `timeout: 240000`（= 返回的 `bash_timeout_ms`）：共用正文里按 Claude Code 写的那条要求，ZCode 的 Bash 工具同样接得住 |

**参数保真**（`smoke-glm/fidelity-check.md`；用 rollout 里的用户消息原文逐字比对）：

| 项 | 一致 |
| :--- | :--- |
| `task.json` 主题 = `冒烟主题`；`drivers.plan.driver = glm` | ✓ |
| 两轮 `run.json`：`driver: glm`、`driver_enabled: true`、`topic: 冒烟主题` | ✓ |
| 第二轮 codex、gemini 两侧 BRIEF 第 2 段焦点 = `看 it's 这一处的 $HOME 与 "双引号"` | ✓ |
| 「原稿里记下的焦点」 | **不适用**：原稿是计划正文，模型没把焦点抄进去；焦点的唯一落点是 BRIEF 第 2 段（上一行已核） |

**冒烟驱动的改动（已做）**：glm 载体 `invocation` 由 `/skill {name}` 改为 `/{name}`（J4 与 Hook 生效的载体都是桌面端；命令行模式的写法写进注释）；`driver.snippet` 与本仓根 `AGENTS.md` / `GEMINI.md` 的调用写法一句同步（那一版从未提交，不进旧版指纹表）。重渲染 glm 4 份产物，全量 1943 / 1941 / 0 / 2。
**已装到 `~/.zcode/skills` 的那 4 份与运行时根里的 `driver.snippet` 因此落后一版**，重跑同一条安装命令即可刷新。
**已刷新（送审前，用户指示）**：`npm run build`（构建标识 `c4d9af6`，作用面有未提交改动，inputs `063b552113dd`）→ `node dist/install.cjs --targets claude,glm` 退 0；
glm 与 claude 共 14 份入口与工作树产物逐字节一致，运行时根与 `skills/dual-critic/` 除 `entry/` 外无差异；本仓 code 阶段预检（跳过探活）通过。

**冒烟核出、不属本步的问题（待用户定是否登记）**：

1. **闸门停点话术不按当轮 Driver 措辞**：`gate --await-approval` 给 glm 的话术是「通过：`/dual-approve` …」「在此期间不得修改业务文件（**Hook 会拦下**）」。glm 是 L2、夹具里也没有 Hook，后半句对它不成立；`/dual-approve` 在 ZCode 桌面端碰巧能用，对 codex 应是 `$dual-approve`。停点话术由 CLI 生成，不经入口资产渲染。建议并入第 3 步（`preflight` 护栏等级文案与 r10 §3.1.3 同源那件事），一起按护栏档与载体派生。
2. **`review --cancel` 不回写归档里的 `run.json`**：被取消的那一轮 `_meta/run-20260925T053103Z.json` 停在 `status: running`；`status.json` 是 `cancelled`、锁与闸门都回收了（`run-protocol.ts` 的 cancel 路径只 `patchStatus`）。既有行为，与 M10b 无关；影响是按 `run.json` 读状态的消费方（report、跨阶段判定的留痕读取）会看到一份永远 running 的留痕。建议新立 BACKLOG 条目，另议。
3. Driver 按用户要求用 Edit 改了 `.trivium/config.local.yaml`（换 codex profile）。该文件不在编排器独占集内，属正常可写；只作观察记录。

证据：`smoke-glm/`（`rollout-excerpt.json`、`fidelity-check.md`、夹具的 `task.json`、两轮 `run.json` 与 BRIEF、原稿与裁决件——文件名已去掉角色后缀）。
