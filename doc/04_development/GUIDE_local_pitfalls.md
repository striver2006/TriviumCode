# 本机坑清单（`P-xx`）

> - **作者 / 负责人**：Chen Zhenbo（由 Claude Code 整理）
> - **创建日期**：2026-10-08
> - **当前版本**：v1.0.0
> - **状态**：现行(Active) —— `P-xx` 本机坑清单的唯一落点，跨里程碑持续追加
> - **来源**：M11 第 10 步（BACKLOG **EV-13**；上位计划 `.reviews/M11-档位全链路与文档收口/plan/` r3 §4.10，拍板 D-12）把 [M0 探针报告](../05_testing/REPORT_2026-09-11_m0_probe.md) 的 §7 整节搬到这里。P-01～P-31 逐字搬移、编号不改；M0 报告自 v1.3.0 起恢复为里程碑快照，§7 只留指针
> - **变更说明**：v1.0.0（2026-10-08）初版，条目表即搬家前 M0 报告 §7 的条目表（该报告文档头当时为 v1.2.0，P-24 起的追加没有再升版）

## 0. 本文管什么

`P-xx` 记**本机环境与厂商 CLI 的实测坑**：某家 CLI 的实际行为与它的文档、与常识或与我们原先的假设不符，而且会让编排器或验收判据出错的那一类。每条四栏：坑、影响、对策（含已落地的代码位置或登记的 BACKLOG 编号）。

### 0.1 追加规则

- 新坑追加在 §1 表尾，编号接着现有最大号往下排，不复用、不重排。各主题报告引用时写编号并链到本文，不在报告里另起一套编号——同一事实两个落点就会分叉。
- 坑的证据（原始输出、负对照）留在发现它的那份报告或 `doc/05_testing/evidence/` 下，条目里给出处。
- 改判不删原文：照 P-31 的做法，原结论划线保留，在同一格写改判日期、依据与新结论。

### 0.2 不属本命名空间的编号

- M6 第 2/3 步报告里的 `P-C1` / `P-C2` 与 `D-1`～`D-3`：那些是「该家族与另两家的能力差异」，不是「本机环境的坑」，两者消费方不同。
- M0 报告 §8 的 `C-01`～`C-12`：M0 当时的实测与设计文档记载的冲突项，已于设计 v1.2.1 回补，属 M0 快照，留在原处。

### 0.3 读条目时的出处约定

条目逐字搬移，其中的相对引用没有改写：

- 裸写的 `§3.1`（P-03）、`§6.2`（P-28）、`§6.3`（P-11）指 [M0 报告](../05_testing/REPORT_2026-09-11_m0_probe.md) 的同号节；`C-xx` 指该报告 §8。
- 「设计 §8.1」（P-02）、`§10.5`（P-09）与「设计 3.6」（P-19）指[主设计](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md)的同号节。
- `evidence/…`（P-28）相对 `doc/05_testing/`。

### 0.4 补录来历

P-01～P-15 是 M0 探针实测；P-16～P-18 是 M4/M5 真实运行期补录；P-19～P-23 是 M6 第 4 步补录（证据与负对照见 [`REPORT_2026-09-15_m6_driver_entry_probe.md`](../05_testing/REPORT_2026-09-15_m6_driver_entry_probe.md)）；P-24～P-27 是 M8 第 4 步补录（AC-20 真机验收期间）；P-28～P-31 是 EV-81 收口时补录（ZCode 0.16.9 provider 配置注入，2026-09-21），P-28、P-31 格内另记了后续补记与改判。

## 1. 条目

2026-10-09 接入准入注意：`cld -p` 与 Claude 的打印旗标存在歧义，统一经 `cld --profile <name> --print`；Claude 的 profile 模型映射只是声明，不能当运行时供应商回读。每路线能力结论需匹配包装器/profile/CLI版本指纹。实测证据与未完成项将归入本次接入验收报告，未验路线不得套用官方模式结论。此段为实施约束，未新增实测 P 编号。

2026-10-10补测执行约束：原48次脚本保持不变，使用新的统一调用器和独立台账。Node侧车需在原生CLI边界卸下，避免模型自己的Node读取命令继承证据写入；Node包装器及编排worker仍核对装载证明。Claude负对照只看到Glob或无工具时不能判写入拦截通过。Qwen的未知工具拒绝属于注册层；Kimi/DeepSeek注册Write后确有配对权限拒绝，但工具面不同，不替代生产同形未测项，错误文案也不独自证明deny规则命中。没有新增实测结论时不得新增P编号。

原生Claude也清理ANTHROPIC_*及冲突模型路由环境，仅使用官方登录凭据或CLAUDE_CODE_OAUTH_TOKEN；兼容网关须显式profile。重探时必须带所需的 --native-claude 或 --profile-claude <名>，缺省doctor只探配置路线。Codex原生发现基底第三方provider、非官方入口或API凭据时明确拒绝，不自动切换认证。

| # | 坑 | 影响 | 对策 |
| :--- | :--- | :--- | :--- |
| **P-01** | 本机**无** `timeout` / `gtimeout`（macOS 不带 GNU coreutils） | 任何 shell 层超时方案都会失败 | 超时一律在 Node 内实现：定时器 → `SIGTERM` → 宽限期 → `SIGKILL`。已落地于 `src/trivium/util/exec.ts`，**禁止** shell out 到 `timeout` |
| **P-02** | `agy` 在探针执行过程中**自升级 1.1.27 → 1.2.0** | 设计 R11 的活体样本：探针结论可能在两次运行之间失效 | `preflight` 每次校验 CLI 版本；版本变化即强制重跑 `doctor`（设计 §8.1 已有此逻辑，实测证明必要） |
| **P-03** | agy headless 默认会软拒绝 `run_command`，产生空审查 | AC-05 直接失败 | 见 §3.1 配方。**`denied_actions[]` 非空即判 `evidence_ok=false`** |
| **P-04** | agy 的文件工具**只接受绝对路径**，且模型不知道自己的 cwd | 不给绝对路径就会跑出项目范围乱翻，浪费配额与时间 | BRIEF 中所有路径一律绝对化；`--print-timeout` 设足够值 |
| **P-05** | ZCode 的 `--help` 列出了 `--max-turns`，实际**不接受** | 照文档写命令行会直接失败 | `readonly_flags` 探针必须逐个 flag 实测「实际被接受」的组合，不信 `--help` |
| **P-06** | `ZCODE_MODEL` 传裸模型名（`GLM-5.3-Flash`）会落到错误 provider 并报缺 `ANTHROPIC_API_KEY` | 模型路由静默走错，AC-13 失败 | 必须传 `<providerId>/<modelName>` 全限定 id；`doctor` 需回读并记录本机的规范写法 |
| **P-07** | agy 1.1.28 起 **`--print-timeout` 到期不再非零退出**，而是返回部分输出并 exit 0 + stderr 警告 | 编排器若靠退出码判超时会把超时当成功 | 超时判定必须靠编排器自己的墙钟计时 + stderr 警告匹配，**不能**只看退出码 |
| **P-08** | ZCode CLI 凭据/模型配置与桌面端**完全隔离** | 桌面端能用不代表 CLI 能用 | `preflight` 的「ZCode 已认证」检查必须真跑一次最小 headless，不能只检查桌面端配置 |
| **P-13** | ZCode `--json` 的 stdout **不是纯 JSON**：前面可能有 `AI SDK Warning System: …` 等告警行 | `JSON.parse(stdout.trim())` 必然失败，会被误判为「输出不可解析」而触发无谓的 `parse_fallback` | 必须做括号配平扫描把 envelope 抠出来（已实现为 `extractJsonEnvelope`，含字符串内花括号与转义引号的用例） |
| **P-14** | rollout 文件名是 `model-io-<sessionId>.jsonl`，而 `sessionId` **本身已带 `sess_` 前缀** | 拼成 `model-io-sess_${sessionId}` 会得到 `model-io-sess_sess_…` 而永远找不到文件（本次实现真的踩了一次） | 路径模板固定为 `model-io-{sessionId}.jsonl` |
| **P-15** | ZCode envelope 里**没有 `model` 字段** | 无法从返回值直接回读生效模型，AC-13 会缺证据 | 生效模型从日志 `context.model` 或 rollout `model.{providerId,modelId}` 回读；两者皆不可得时记 `unverified`，不采信请求值 |
| **P-11** | `zcode.cjs` **无法单独拉起 TUI**：报 `Cannot find package '@zcode/tui'`。TUI 只存在于桌面应用的 `app.asar` 内，磁盘上既无 `zcode-tui-runtime/`，也无 SEA 单文件可执行版 | 「开一次 TUI 生成配置」这条路走不通 | CLI 侧配置必须**手工创建**。已实测验证的最小结构见 §6.3 |
| **P-12** | ZCode 的配置根**只认 `HOME`**。`ZCODE_HOME` 等专用变量看似存在（二进制中有该字符串）但对配置解析无效 | 按变量名推断隔离方案会失败 | 隔离一律走独立 `HOME`（`home_copy`），并把凭据写入该 HOME 下的 `config.json` 副本 |
| **P-10** | ZCode「已登录」不等于「可用」：凭据与桌面端共享，但模型 provider 配置 CLI 侧独立且可能缺失 | 预检若只查凭据会漏判，跑到一半才失败 | 预检必须真跑一次最小 headless（P-08 的加强版）；错误分类要区分 `provider_not_configured` 与鉴权失败 |
| **P-16** | agy 1.2.0 拒绝「自带档位的模型 slug + `--effort`」组合：`--model gemini-3.8-flash-high --effort medium` 直接非零退出，报 `conflicts with --effort=medium` | 一次真实代码审在 5.6s 内失败、白烧一次调用。**plan 阶段恰好 slug 与 effort 都是 `high`，一致所以从未暴露**；code 阶段配的是 `medium`，一跑就中 | slug 自带 `-high\|-medium\|-low` 后缀时**不传** `--effort`（slug 是权威，它来自探针回读的模型目录；`critics.gemini.effort` 只是配置意图）。见 `adapters/agy.ts` 的 `modelEncodesEffort` |
| **P-17** | agy headless 的 `-p` 进程**只存活约 10 秒**，随后工作转交给一个常驻 **hub 进程**（`agy --hub --hub-port=<n> --app_data_dir=antigravity --add-dir=<项目根>`）。该 hub 在本次运行之前**就已存在**（实测启动时间早于本次运行 8.5 小时） | 「运行期间 `ps` 能看到 agy 进程」这条验收判据按字面理解会失败；更重要的是：hub 跨运行复用，**独立 `HOME` 之类的隔离手段对它不生效** | 验收改看 hub 的 `--add-dir` 与 cwd；隔离结论以 `probe.agy.isolation` 为准，不要假设每次运行都有独立的 agy 进程空间 |
| **P-18** | ZCode 的 headless 进程把进程名改成 **`zcode-cli`**（另有 `zcode-node-repl-mcp` 辅助进程），`ps`/`pgrep` 里**看不到 `zcode.cjs`** | `pgrep -f 'zcode\.cjs'` 恒为空，按它做存活检查或验收会误判「没跑起来」 | 认 `zcode-cli` 这个进程名；cwd 实测确为项目根（`lsof -a -d cwd`）|
| **P-09** | `~/.zcode/v2/config.json` 内的 provider **apiKey 为明文**，且其中一个正是 `<id>.<secret>` 形态 | 该形态若混入归档就是安全事故 | 已作为 `archive` 密钥扫描器（§10.5）的真实用例；扫描器只存正则不存值。**另：已建议用户轮换该批 key** |
| **P-19** | codex 的 `CODEX_HOME` 副本**隔离不住 skills 指令面**：隔离后 `debug prompt-input` 的 skill 根表里仍有 `$HOME/.agents/skills`（本机 14 份第三方 skill，全文描述已进模型可见的 developer 消息）。**三条臂**：①仅隔离 `CODEX_HOME` → 该根解析到真实 `$HOME`；②再叠加隔离 `HOME`（空目录）→ 该根消失；③`HOME` 隔离但 fakehome 下放哨兵 skill → **根移动到新 `HOME` 并挂载、哨兵命中**。第 ③ 条排除了「`HOME` 变了导致配置缺失从而关掉全局根」——**指令根随 `HOME` 派生**。与 ZCode 的 C-12 / C-08「配置根只认 `HOME`」是同一个坑的两半；措辞强度不同（C-12 做过候选变量穷举，本条没有，故不用「只认」） | M8 的隔离若只做 `CODEX_HOME`，宿主机任意第三方 skill 会进入审查会话。**边界**：沙箱只读仍挡得住**写**，挡不住**指令注入**，两件事不是一回事 | 隔离**同时**覆盖 `CODEX_HOME` 与 `HOME`。`probe.cli.codex.isolation` 的取值 `home_copy` 字面仍成立，错的是「它覆盖了什么」的理解，已写进设计 3.6 末段。登记 BACKLOG **EV-08** |
| **P-20** | ZCode 的 **user 级 custom command 盖过 project 级**（实测：`<fakehome>/.zcode/commands/dup.md` 胜出，项目根与子目录两份均被忽略），方向与「项目配置覆盖全局配置」的常识**相反**。被盖的只产出一条 `diagnostics` 的 `custom_command_duplicate_name` warning | 入口命令装在项目里会被宿主机同名命令**静默顶替**，留痕上看不出来——warning 没人读 | 入口资产一律装 user 级；安装器先查重名，撞名**报错**而不是覆盖 |
| **P-21** | ZCode 的 **skills 重名完全不去重、不告警**：本机 10 个 skill 同时存在于 `~/.zcode/skills` 与 `~/.agents/skills`，`skills list` 两份都列、`diagnostics` 为空数组。去重键是**文件路径**而非名字（commands 侧恰好相反，见 P-20） | 同名两份都在，模型实际加载哪一份**枚举面给不出答案** | 安装前查重；名字加 `dual-` 前缀降低碰撞面。**注意**：`skills list` 是枚举面不是加载面，加载优先级要真实调用才知道，M6 第 4 步**未测** |
| **P-22** | `~/.agents/skills` 是 **codex 与 ZCode 共享的用户级技能根**（codex 的根表 `r1`、ZCode 的 `source: "agents"` 指的是同一个目录） | 一家装的 skill 会进另一家的上下文，跨厂商串味 | 知道即可；trivium 自己的入口资产**不要**落在这个根 |
| **P-23** | codex 的模型可见承载面是 **skills 而非 `~/.codex/prompts/`**：同一次运行里造双哨兵，`skills/` 的进了 `debug prompt-input`，`prompts/` 的没进 | 演进设计 §3.1／§7.1 按 prompts 形态估的 M10 迁移成本失真 | 按 SKILL.md 形态渲染——与 Claude Code 几乎同形（含 `disable-model-invocation`），frontmatter 适配即可。**边界**：本条**没有**证伪 prompts，只证明它不是常驻面；它是否仍作 TUI 内 `/name` 触发面**未测** |
| **P-24** | **codex 不校验 `-m` 与 `-p` 的对应关系**：`codex exec -p qwen -m deepseek-v4-pro` **成功退 0**，会话文件回读到 `model_provider=qwen` 而 `base_instructions.provenance.model=deepseek-v4-pro`——同一个模型名可以挂在两个 provider 下，两者矛盾时不报错 | 「两次生效模型不同 ⇒ 跑了两个模型家族」这个推断**不成立**，AC-20 按它验收会**通过而无意义** | 互可区分改为**逐分量**断言：provider、模型、与请求值一致、provider 的 `base_url` 互异。**只能事后记录、无法预检拦截**——模型目录没有家族归属字段，按 slug 前缀猜家族会随目录命名漂移 |
| **P-25** | **模型目录逐 profile 分层**：`<profile>.config.toml` 可自带 `model_catalog_json`，取不到才回落基底。而 `codex debug models` 的输出**含 `visibility: "hide"` 项**（本机基底 7 条里 2 条是 hide），**端点的合法名单只认可见项**——实测 `-p deepseek -m qwen3.8-max` 被端点拒绝并逐字列出「deepseek-flash, deepseek-v4-pro」，恰是该目录的可见项 | 拿单一列表校验任何非基底 profile **两个方向都错**：误杀该 profile 自己的默认模型、误放只在基底目录里的 slug（后者到 `turn.failed` 才失败，而预检存在的理由就是挡在花钱之前） | 探针改存 `models_by_profile`（逐 profile 的**可见**清单），预检经适配器钩子按本次 profile 校验。**「端点名单 ＝ 可见项」这条等式来自 n=1 实测，不是厂商承诺**，只用于收紧不用于放行 |
| **P-26** | `codex debug models` **不接受 `--json`**（0.154.0 报 `unexpected argument '--json' found`），该子命令本就输出 JSON。探针代码一直没传，只有文档块那样写着 | 照文档块手工复现会当场失败，误以为探针坏了 | 文档块已更正。教训同 P-xx 一贯口径：**注释里的命令要能逐字跑通**，不能是「大概这么调」 |
| **P-27** | **本机模型目录文件是活的**：`models-qwen.json` 在 M8 第 4 步期间被改小（10 条 → 7 条，`deepseek-v4-pro` / `deepseek-v4-flash-0731` / `glm-5.2` 被移除），而探针结论仍是旧的 10 条 | 任何「两份目录恰好有交集」的方案都靠不住——AC-20 家族二原本依赖 `deepseek-v4-pro` 同时在两份目录里，这次改动后该交集**只剩两个隐藏项**，按原方案会当场无 slug 可用 | 不依赖交集：按本次 profile 的目录校验（P-25）。探针 TTL（7 天）拦不住这种改动，`checkProbeFreshness` 判的是时间不是内容 |
| **P-28** | **ZCode 0.16.9 独立拉起要靠两个环境变量定位 provider 配置**（2026-09-20 补录，EV-81）：CLI 按**入口文件目录**推算 `zcode-builtin.json`（候选 `<入口目录>/provider/…` 与 `<入口目录>/../../../../../config/provider/…`，后者是源码树布局），应用包内两条都不存在，真实文件在 `Resources/config/provider/zcode-builtin.json`；桌面端起 CLI 时用 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` + `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`（后者指 `~/.zcode/v2/provider_config.json`，0600 含凭据）传路径。`version` 子命令不受影响 | 我方只透传 `HOME`，报「无法定位 CLI ZCode Built-in Provider Config：<候选1>, <候选2>」退 1（stdout 空、stderr 一行），`preflight` 在「ZCode 已认证」一格退 69，含 glm 的双审全部起不来。0.16.5 无此问题（最近一次 glm 成功留痕 `run-20260919T154710Z` 记 `cli_version 0.16.5`） | 适配层 `zcodeProviderEnv` 按入口派生内置路径、按**真实**用户目录取个人路径，存在性门控后注入；两条都是绝对路径，`config_copy` 的副本 `HOME` 不影响。`failureKind` 新增 `provider_config_unresolved`（**退出码非 0 的前提下**按 stderr 英文名词片段判——裸正则会把 stderr 带同名诊断行的成功调用误判成布局失败，r2 AGY-01）。入口先 `resolve` 再 `realpath` 再取兄弟目录（软链与相对入口都要落到真实安装布局，r2 CODEX-04）；文件不在时该键显式置 `undefined`，把宿主环境里预置的同名变量删掉（r2 CODEX-01）。**观察项（r4 CODEX-04）**：该判据依赖「这个英文名词只在定位失败时出现」这一 **n 很小**的实测前提——本机只见过失败形态一种。若哪次升版让它也出现在别的非零退出形态里（例如一行成功诊断），四处同源文案会齐指安装布局而真因在凭据或模型面。**不据此预先收紧正则**：英文措辞是猜的，退出码门控之后再收紧「收益为零、误杀风险为正」（r2 AGY-01 已裁），等实测原文出现再改。原始输出见 `evidence/zcode-provider-config-20260920/`<br>**机理补记（2026-09-21，EV-82 r3 计划双审 codex）**：包内 `FZi(prepareCliProviderRuntimeEnv)` 在 `--prompt` 形态下**先于**成对检查 `cfr` 运行，为缺失的变量按 `dataBaseDir ?? ZCODE_DATA_BASE_DIR ?? homedir()` **合成派生路径并写回 `process.env`**——这就是「只给内置那份」在 headless 路径上从不撞「必须同时提供」抛错、而停在模型层的原因（P-30 的机理，EV-88 据此关闭）。同一机理的另一面：宿主预置 `ZCODE_DATA_BASE_DIR` 会改变合成出的个人路径，故适配层把它连同 `ZCODE_HOME` / `ZCODE_STORAGE_DIR` 一律清掉——**全部探针路径与审查运行路径**（代码双审 r1 补上了旗标探针与 version 探针两条）。另：`ZCODE_API_KEY` 在 0.16.9 包内**零命中**，CLI 不读它（§6.2 那条是 0.16.5 快照）；探针路径仍连同 `ZCODE_BASE_URL` 一并清，取 fail-closed |
| **P-29** | **provider 配置定位先于参数解析**：定位失败时带着那一行报错退出，`Unknown option '<flag>'` 根本报不出来；注入内置变量后，`--bogus-flag` 才报 `Unknown option` | `probeReadonlyFlags` 按「没报 Unknown 就是接受」判，七个候选**全部**记成接受——2026-09-19 22:54 那次 doctor 把 0.16.5 已证实被拒的 `--allowed-tools` / `--max-turns` / `--permission-mode` / `--settings` 全写进了 `readonly_flags`（适配层 `readonlyArgsFromProbe` 只取 `--mode plan` 与 `--disallowed-tools`，argv 未受污染，但结论文件失真，`doctor` 输出会误导人） | 探针增第三态 `indeterminate`：命中该报错的候选不算接受也不算拒绝、不写入结论并打 ⚠️。修后重跑 `doctor --only zcode` 刷新结论 |
| **P-30** | **个人 provider 配置自带默认模型，空 `HOME` 挡不住模型调用**：两个变量都给、`HOME` 指向空目录（无 `cli/config.json`）时，0.16.9 照样起了一个 turn（stderr `AI SDK Warning (anthropic.messages / qwen3.8-max)…`，stdout 有 97 字节 envelope，进程 3 分钟未自行退出、手工结束后报 `Turn was cancelled`）；**只给内置那份**则停在 `Error: Model creation failed` 退 1（无凭据），且参数解析已完成（`--bogus` 仍报 `Unknown option`） | 旗标探针「空 HOME 停在配置解析、零配额」的前提在两份都注入时失效——七个候选就是七次真实调用，每次还可能拖到 30s 超时被杀 | `probeReadonlyFlags` **只注入内置那份**；需要真实模型的探针与审查运行（`invokeZcode` 路径）才两份都给。用例以假入口锁定「七次调用个人变量一次都不给」 |
| **P-31** | ~~**0.16.9 的模型选择已迁到个人 provider 配置，`config_copy` 副本的 `model.main` 不再生效**~~ **改判（2026-09-21，EV-82 r2/r3 计划双审两侧包内逐字复核）**：`model.main` **有**读取点——CLI 的模型选择链是「个人 provider 配置文件存在 ⇒ 直接用、不导入；不存在 ⇒ 从 `<HOME>/.zcode/cli/config.json` legacy 导入、把 `model.main` 转成 `defaultModelSelection`、并把迁移结果写成 `<HOME>/.zcode/v2/provider_config.json`」（包内 `fpe.#m` / `#f` / `importLegacy=skt` / `Oqa` / `Mqa` / `qEn`，`~` 经 `os.homedir()` 展开、随 `$HOME` 走）。2026-09-20 的实测 E0（副本 HOME + 两个变量、个人指真实文件）回读到个人配置默认 `<providerUUID>/qwen3.8-max`，是因为**EV-81 注入的个人变量让 CLI 跳过了导入**，不是 `model.main` 没有读取点。原文「CLI 包内字面：`model.main` 已无配置读取点」是只 grep 字面、没找到经 `qEn` 归一化后的读取点 `Mqa` 得出的推断。**E1 记录（只给内置 → 回读 `GLM-5.3`）作废**：事故当天凭记忆补的，其 stderr 引文 `ZCode Built-in missing` 在包内不存在；2026-09-21 用 `probeModelOverride` 臂在真实 0.16.9 上零配额实测，CLI 写出的 `defaultModelSelection` = 请求的非首位模型 `bigmodel-coding-plan/GLM-5.3-Flash`。**注册表形态**（r3 CODEX-03）：legacy 导入后 providerId 是 `cli/config.json` 的 provider **键**，与内置注册表的 `account:bigmodel-individual-coding-plan` / 小写 `glm-5.3` 和探针回读的 UUID 形态都不同，`isSelectable` 精确匹配——副本的限定必须按副本源自己的键做。**导入器的三条成员规则**（代码双审 r3 CODEX-01～03 在包内核出）：`okt` 切 `model.main` 用**第一个** `/`（provider 段不含 `/`）；`Nqa` 跳 `deleted === true` 的成员、modelId 取 `id ?? 键名`；`Oqa` 跳 `builtin:` / `account:` 前缀与 `source` 非 custom 的 provider，且 provider 显式声明 `options.apiKeyRequired: false` 时抛 `UnsupportedLegacyCliProviderConfigError`、`skt` 捕获后**整份**导入返回 null（免密 provider 会让整份配置导入失败）。适配层的限定、探针的挑选与副本白名单都按这三条取齐。 | 修前 glm 侧静默跑在个人配置的默认模型上（本机 `qwen3.8-max`，与 codex 侧同家族）：AC-13 的回读如实记差异，但 FR-06 模型路由与 NFR-06 异构默认在该侧失效，双审独立性名存实亡 | 修法见 EV-82：审查运行的副本 HOME 下不注入个人变量、限定按副本源键；`probe.model_override` 改为实测。**glm 的审核者禁用解除。** 原始记录 `.reviews/zcode-provider配置注入/code/2026-09-20-zcode-provider配置注入-r2-response-claude.md` §三 保留备查（其 E1 行已作废） |

2026-10-10项目配置修正：pro/high原先显式profile:null覆盖agents.claude.profile:qwen而走官方订阅。现改为qwen3.8-max/profile:qwen；default/flash保持qwen3.8-flash，不添加effort默认值。Kimi/DeepSeek显式参数需同时指定对应模型。Qwen完整准入后移除本机review.default_critics两审覆盖；其它probe/bin配置保留。官方模式实现和离线测试保留。

2026-10-10独立取证装置补记：原写负对照 helper 对相对路径 breach.txt 漏判，需以 init.cwd 解析并精确核对隔离目标；旧判定不覆盖。夹具两同行工件曾只列一份 deny，后续复用生产 enumerateDenyPaths 后完整覆盖，不能把该测试清单遗漏说成生产枚举缺陷。Kimi coding/k3 与 DeepSeek flash 不调用未注册写工具，继续未测；DeepSeek V4 pro 的实际 Write 已被拒绝。细节及超时见 [三供应商报告](../05_testing/REPORT_2026-10-10_claude_three_providers.md)。

2026-10-10 Codex 默认官方配置：接入profile须为native，default/flash/pro各自模型分别为gpt-6.1-sol、gpt-6-luna、gpt-6-astra，仅清空profile却保留Kimi模型会错配。更新前的本机旧探针标0.160.1且基底目录为旧Qwen快照；本次由doctor刷新为真实0.162.0与官方目录，未手工填探针事实。

2026-10-10收口装置整改：`scripts/agent-access-closeout.mjs`及其summary为新的canonical入口；旧admission/summary冻结，不用它们固定0.162.0的断言验证新版。helper不兼容缺实际cwd/唯一目标/原始配对错误/前后状态的旧调用。旧Qwen与V4 pro录制样本进入边界回归，不改原件；tool_use_error包装需按实测剥离后精确识别注册层错误。`npm run build`缺省不重编测试，单项回归前须`node scripts/build.mjs --tests-only`，避免运行陈旧测试产物。敏感规则数组整体覆盖，追加必须保留凭据及旧目录规则；冻结的非敏感前后清单与效果断言应保持审查可读。最新版本和结论见[收口报告](../05_testing/REPORT_2026-10-10_agent_access_closeout.md)。

本轮code整改的取证契约（原标准不变）：探针和汇总须共同使用显式批次selection manifest，固定variant及requested/result/fingerprints-after的hash；缺结果、未完成或指纹不符不得回退旧成功。版本证据亦显式引用并核对入口/包装器/配置/模块指纹。Codex实际读取须有CommandExecution.cwd、parsed_cmd精确README目标及唯一命令/完整输出/exit/status配对，不认单独echo；两种ID分列。CLI effort带来源记录，服务端null，不添加默认值。受控对照从同一manifest取当期真实臂并核对实际权限模式与工具面，缺值不判同形。独立清理与落盘失败仍执行其余清理；历史入口缺新版上下文明确报错，不重解释原件。

P-32 目录参数规模（2026-10-10）：完整逐文件settings可随归档增长至MB，spawn E2BIG表示进程未启动。修复采用配置声明的字面目录投影，必须先当前路线逐工具doctor取证；单工具true不替代另两工具，真实settings大小以混合规则为准。不能删台账、历史件或禁读项来缩小argv。修改代码后先build/install，再运行新doctor；`--no-model-calls`会清除所选路线目录事实，不能刷新其它格后继续继承目录true。探针七个逻辑臂不等于七次总启动，既有doctor的version/help/模型臂及native子边界另计预算。

P-33 版本上下文（2026-10-11）：canonical的完整版本指纹包含profile配置摘要，native记录不可直接用于第三方profile，否则应在启动模型前拒绝。每profile单独取版本记录并显式选manifest，保留严格比较及真实native子边界，不删除配置摘要“修通”。版本输出相同只表示CLI版本，供应商/模型运行身份仍须各能力臂回读。
