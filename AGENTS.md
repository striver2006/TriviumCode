
<!-- BEGIN TriviumCode -->
## 审查员身份说明（TriviumCode）

若你是通过 TriviumCode 编排器以**审查员**身份被启动的（提示词首段会明确声明角色），
则以**提示词首段的角色与禁令为准**，忽略本文件中面向执笔者的任务指令——
那些是给主攻方（Driver）的，不是给你的。

作为审查员你只读不写：不得修改任何文件、不得执行写命令、不得读取任务书中
禁读清单列出的文件。你的结论由编排器落盘，不要自行写文件到仓库。

## TriviumCode 双审流水线协议（Driver）

本项目启用了 TriviumCode「主攻 + 多审」流水线。作为 Driver（执笔者）你需要知道：

- **当轮 Driver 是唯一有权改业务代码的角色。** 其余入选的审核者只做只读审查，
  它们的结论由编排器落盘，不经你转述。
- 四条入口命令是唯一入口：`dual-run`（全流程）、`dual-review-plan`、`dual-review-code`、`dual-review-bug`。
  调用写法因载体而异（Claude Code、Antigravity 与 ZCode 桌面端用 `/名字`，Codex 用 `$名字`；ZCode 命令行模式下是 `/skill 名字`）。
  **不要自行调用任何一家审核者的 CLI**——并行、超时、指纹核验、防覆盖命名都在编排器内，绕过它会失去全部保障。
- **禁止在归档根内产出带审查员角色后缀的文件。** 受保护的后缀是
  **除当轮 Driver 之外的全部已登记角色**——权威判据是 `hooks.ts` 的
  `criticRoleSuffixes()`，**不要在这里枚举**（枚举过一次，M8 接入 codex 后就漏了）。
  **你的产出后缀是当轮 Driver 自己的 Agent id**，不是固定的某一家：
  原稿、裁决件都按它命名，裁决件的 front-matter `role` 也填同一个值。
  plan / bug 阶段的原稿写在双审之前：**写原稿之前先认领本阶段**（入口命令里有这一步）。
- 审查意见必须**逐条**裁决（接受 / 驳回 / 暂缓 + 理由，接受要写落点）。禁止静默忽略。
- 闸门期（等待人工审批）不得修改业务文件。想继续请让用户走 `dual-approve`。
- **审批的发起权在用户手里，不在你手里。** 只在用户明确要求时才跑 `trivium approve`。
  技术上你自己跑得通——`approve` 不校验调用来源，正因如此这条才写在这里：
  它靠的是你守规矩，而审批记录会留下时间与会话来源供事后对账。
- 审查进行中也不要改业务文件：审查员正在读真实工作树，你的改动会造成快照漂移，
  可能让整次审查作废。
- **护栏因载体而异**（入口命令的「护栏」段写着你所在载体的等级）：
  L1 载体装有 TriviumCode Hook，越界写入、裁决未齐备就收工都会被事前拦下；
  L2 载体**不宣称** Hook 兜得住——没有 Hook，或只有尽力拦截的 Hook——这些都**靠你自觉**：
  审查进行中的越界由跑后漂移复算发现（被 .gitignore 忽略的文件除外），闸门期改业务文件不会让审批失败（命令 B / C / D 审批时只打印工作树改动摘要），
  审批之后删改审查工件只有带 Hook 的载体在提交时核对（详见 QUICKSTART §5.2）。
- 装有 Hook 时，它对结构化写工具（Write / Edit）精确拦截；对 Bash 只按写命令形态做**启发式**拦截，
  不是完备的——别去绕它，绕过去的改动同样会被跑后复算判成漂移。
  Bash 侧有**已知误拦**，判据是：命令**像**写命令（写动词字面、重定向等，词边界字面匹配、不看上下文），
  且命令文本提到任一角色后缀（含你自己的）、`_meta`、`task.json`、`state.json`、`.trivium`，
  两条同时成立即拦——**不区分「写它」与「说它」**，包括 commit message 与审查焦点。
  **出口是改用结构化写工具落文件，提交说明写进文件再 `git commit -F <文件>`**（精确判定，不看字面）；
  焦点里有写动词字面时先问用户改措辞；恢复被误改的受保护文件请用户在终端执行。
  换一种写法让判据认不出来属于绕过，不是出口；这个误拦是刻意接受的取舍，不要当成 bug 去「修」。
- **不要再试图给 `git commit` 开豁免。** 2026-09-12 开过一次（RV-B1），双审打穿后撤回：
  豁免把 fail-closed 的判定变成需要穷举危险形态的 fail-open，而 shell 的攻击面穷举不完。

留痕全部在 `.reviews/<主题>/{plan,code,bug,verify}/`，命名为
`<日期>-<主题>[-r<N>][-revised|-response]-<角色>.md`。
<!-- END TriviumCode -->

## 项目概览

TriviumCode 是「主攻 + 多审」（Driver-MultiCritic，沿用旧名 Driver-DualCritic）多智能体流水线编排器：
缺省由 Claude Code 主攻执笔，Antigravity（`agy`）、ZCode、Codex 三家背靠背只读审查（Claude Code 也可作审核者，须 `--driver` 取另一家）；编排器侧可按运行 / 按阶段指定别家为 Driver；M10b（2026-09-26）起别家也可在自己的 CLI 里执笔，各载体的护栏等级见 `doc/07_manuals/QUICKSTART.md` §5.2。
TypeScript 编写，esbuild 打成**单文件零依赖 CJS**；支持 macOS 与 Windows 原生
（Windows 硬前置 Git for Windows，平台差异落点 `src/trivium/util/platform.ts`，设计 §7.1），
Node ≥ 18（开发建议 ≥ 22）。

- `src/trivium/` — 编排器全部实现（`cli.ts` 入口，`adapters/` 收敛四家 CLI 差异，
  `agents/registry.ts` 是 Agent 差异的唯一登记处）
- `src/install.ts` — 安装器（→ `dist/install.cjs`），多目标：运行时根 + 四家各自的 skill 根
- `src/entry-render.ts` — 入口资产渲染器：`skills-src/` → 四家载体的入口 SKILL.md
- `skills-src/` — 入口资产的**源**（`commands/*.contract.md` 命令契约、`partials/` 片段、
  `carriers/*.yaml` 四家载体差异）。**改入口命令的措辞改这里，再跑 `npm run render`**
- `skills/` — 8 个 Claude 用户级 skill，核心资产在 `skills/dual-critic/`
  （`scripts/trivium.cjs` 为打包产物**不进 Git**；`schema/` 机读契约，含当前形状与只读保留的历史形状、
  `prompts/` `lenses.yaml/`、`hooks/`）。其中 7 份 `skills/dual-*/SKILL.md` 与
  `skills/dual-critic/entry/**` 是 `skills-src/` 的**渲染产物**（进 Git、不手改，漂移由契约测试拦）
- `test/{unit,contract,integration}/` — 分层测试，共享夹具在 `test/helpers/fixture.ts`
- `doc/` — 工程文档（八个一级子目录，**单层扁平**，文件名带前缀；稳定版交付文档按用户要求采用中文名）
- `.reviews/` — 流水线审计留痕（进 Git）

## 本仓开发会话（Codex）

- 本仓日常开发由 Codex 主攻；这是仓库工作约定，**不改变产品的内置缺省 Driver**。
  Codex 的正式入口是 `$dual-run`、`$dual-review-plan`、`$dual-review-code`、`$dual-review-bug`。
  仅在用户显式调用相应入口时启动审查，不因阅读技能而自行启动。
- 新任务通过正式入口使用小写 `--driver codex`；plan / bug 写原稿前先按阶段认领。
  原稿与裁决件后缀、front-matter `role` 均为 `codex`。旧主题按既有运行留痕与声明继续，
  不改写历史作者，不删除旧工件来更换 Driver。
- 本仓 `.trivium/config.yaml` 的缺省审核者为 `claude,gemini,glm`；显式选侧仍用 `--critics`。
  本机覆盖取 `.trivium/config.local.yaml`；外部账号不可用时须如实说明实际入选集合。
  Codex 不审自己的变更，审核者只读，审查进行中与人工审批停点均不得改业务文件。
- 排查含凭据的文件时只提取所需非敏感键或判断有无，禁止整份打印用户 Codex 配置、
  `auth.json`、厂商 profile 与运行目录中的凭据副本；日志和命令输出会进入对话。
- Codex 在当前 TriviumCode 集成中仍按 **L2** 执行；本机 `.codex/hooks.json` 的存在
  不证明写入拦截有效。入口资产以 `skills-src/` 渲染结果为准，不手工替换 Agent 名字或参数占位符。
- 开发环境、迁移与检查方法见 [Codex 开发指南](doc/04_development/GUIDE_codex_development.md)。

## 常用命令

```bash
npm run typecheck                 # tsc --noEmit（strict + noUncheckedIndexedAccess + noUnused*）
npm run build                     # esbuild 出两个 bundle（会重建 skills/ 下产物）
npm run render                    # skills-src/ → 入口 SKILL.md（缺省构建故意不重写它们）
npm test                          # pretest 自动全量构建（含测试），再 node --test dist/test
npm run check                     # typecheck + build + test，提交前的完整闸门
node --test "dist/test/test/unit/<name>.test.js"   # 构建后跑单个测试文件
```

不引 eslint / prettier，`tsc --strict` 就是静态检查。提交遵循 Conventional Commits
（feat/fix/docs/refactor/test/chore），注释与文档全中文。

## 架构纪律（改代码前必读）

这些不是风格建议，每条背后有踩过的坑，详单见 `doc/04_development/GUIDE_env_setup.md` §四：

1. **凡取值必须靠实测才知道的旗标，一律读探针结论、不硬编码**——两家 CLI 行为与官方
   文档不符是常态。实测与设计冲突时改适配层并回补设计文档，不改外部产品、不改验收口径。
   **这不等于「适配层不得出现任何旗标字面量」**：机制类旗标（输出格式、cwd、颜色、
   prompt 载入方式）由编排器自己的需求决定、不是厂商能力事实，按设计 §11.1
   「旗标归属判据」就该写在适配层——三家现况本就如此。判据分四类，逐类归属见该节。
   **每个适配器还要声明 `capability: TraceCapability`**（轨迹形态 + 被拒操作是否留痕）：
   判定层按**能力**分档，不按 Agent id 分叉（纪律 7）。这一项**必须按实测填**——
   填错不报错，只是证据核验按错误的形状进行（读经 shell 的一族若误声明为 `tool-trace`，
   `project_reads` 恒 0、每轮误报证据不足）。详见设计 §11.1「轨迹能力与判定分档」。
2. **`archive.ts` 是 `.reviews/` 的唯一写出口**：命名生成、`O_CREAT|O_EXCL` 防覆盖、
   `-r<N>` 抬升只在那一处实现。
3. **Hook wrapper 两支语义**：检测不到 `.trivium/config.yaml` → exit 0（全局安装不误伤
   其它仓库）；有 config 但 wrapper 缺失/不可执行 → exit 2（护栏被破坏必须拦）。
   `test/contract/hook-guard.test.ts` 守着这条。
4. **git 快照只用临时索引**（`GIT_INDEX_FILE` + read-tree/write-tree），所有 git 调用
   前缀 `-c core.quotePath=false`（否则中文路径变八进制转义）。
5. **超时一律 Node 侧 `AbortSignal`**（SIGTERM→宽限→SIGKILL）；macOS 没有 `timeout`。
6. **进程存活比对 `ps -o lstart=`**，不能用 `kill(pid,0)`（macOS 复用 PID）。
7. **`state.json` 全局，写入必须持全局锁 + 读改原子替换**；按主题加锁会互相丢更新。
8. **计数禁止读-改-写**：每次增量写唯一文件、计数取 `readdir().length`。
9. **不动用户全局配置**；需要独立配置走临时副本（`0600`，用完即删）。
10. **`agents/registry.ts` 是所有 Agent 差异的唯一来源**（设计 16.2 纪律 7）。归档后缀、
    意见编号前缀、配置键、探针段、镜头键、禁读矩阵、Hook 字面集全部由它派生。
    **除它本身与各厂商适配器内部外，任何模块不得出现具体 Agent id / 后缀 / 前缀的字面量**——
    `test/unit/registry-parity.test.ts` 以 grep 级对账守着，加硬编码直接打红。
11. **禁读矩阵禁止手工枚举。** 人工清单维持不住完整性：计划稿自称补全 4 处硬编码、
    双审又查出 8 处，其中按 `['gemini','glm']` 字面循环的一处会让第三家审核者的意见
    **对闸门整体不可见**（静默漏裁）。一律注册表派生 + 机器对账。
12. **机读 Schema 只校「形状」，禁止枚举 Agent 身份与意见编号前缀。**
    「有哪几家、各叫什么、前缀归谁」的唯一来源是 `agents/registry.ts`（纪律 7）。
    schema 里抄第二份，新增一家时改一漏二不会报错，症状要到运行期才现形。
    身份一律走**两段式**：ajv 校形状 → 注册表校身份
    （`schemas.ts` 的 `checkAgentIdentities` / `checkConfigAgents` / `checkDispositionRole`、
    `parse.ts` 的 `checkReviewIntegrity`）。
    唯一的例外是**形状判别式** `vendor: {const: …}`——可辨识联合靠它工作，必须留着。

    > **`disposition.v1` 的 `role` 是这条纪律的第五次现形（EV-66，M9 第 6 步前置）。**
    > 它原本写作 `{"const":"claude"}`，即在 schema 里抄了一份 Agent id。
    > 症状不是「新增一家时漏改」那么温和：M9 第 5 步放开 `--driver` 之后，
    > **非缺省 Driver 写不出诚实的裁决件**——谎报 `role: claude` 会被闸门的 role↔driver
    > 比对判红，诚实写自己的 id 过不了 schema，于是闸门闭环一次都跑不完。
    > 现已放宽为 `type: string` + `checkDispositionRole` 按注册表校验。
    > **两段式在这里取「追加」而非「短路」形态**（同 `validateConfig`）：
    > 一份形状与身份同时错的件，短路形态下只报得出形状那一半。
    >
    > **两段式不负责「当轮」语义。** `checkDispositionRole` 只判「声明的作者是不是
    > 已登记 Agent」；「声明的作者是不是**当轮** Driver」由 `gate.ts` 按 run 元数据比对——
    > 只有那里才有「当轮」这个概念。放宽 `role` 之后，那条比对是作者身份**唯一**的判据，
    > 独立单测见 `gate.test.ts` 的 N-2 三格。
    >
    > ──────────
    >
    > 这条纪律**换过写法**。原文是「schema 的枚举与前缀集必须与注册表 parity，
    > 新增机读契约时对账要跟着建」——那是要求人记得同步两份事实源，而它守不住：
    > 同一形状已经漏过四次（白名单过期条目 → `run.v2` → `config.v2` → `review.v1`），
    > 前三次的对策都是「记得加进清单」，每次都失效。
    > 现在对账是 **`schema/` 全目录兜底扫描**（新文件自动进论域，`run.v1` 作为历史契约
    > 具名豁免），纪律也从「保持两份一致」改成「只留一份」。
    > **靠记性的纪律要换成不依赖记性的机制。**

## 测试要点

- 当前审查新写 `trivium.run.v3`，保留 v1/v2 原 schema 的只读校验；verify 契约不变。
- v3 在执行前保存 `requested_routes` 请求快照；worker 必须与交接逐项比对。取消或启动失败不得丢失请求路线，历史件不补写该字段。
  接入能力从注册表派生；请求、配置声明与运行回读分开记录。Driver 模型仅来自本轮声明，
  模型族逐对三态比较；同族与未知告警继续，不作为闸门条件。真实路线准入之前不得恢复三审或宣称完成。

- **契约层守跨文件对账**：改了 `hooks.json` / SKILL.md 的 `argument-hint` / CLI 旗标，
  必须同步另一侧，否则 `test/contract/` 红。
- **集成测试走真实子进程**调打包产物、动真实 git 夹具仓库。凡是「A 进程算的东西
  B 进程要用」，测试必须真起两个进程；故障注入用环境变量 `TRIVIUM_STUB_CRITIC`
  （跨进程生效），且必须断言桩指纹 `cli_version: 'stub/0.0.0'`。
- 不烧配额跑通整条流水线：`trivium doctor --selftest`（桩适配器，14 步）。

## 已知坑

- **改完代码必须重装才生效**：`.trivium/bin/trivium` 指向已安装副本
  `~/.claude/skills/.../trivium.cjs`，不是仓库刚构建的产物。要 `npm run build &&
  node dist/install.cjs` 两步都做；调试可直接 `node skills/dual-critic/scripts/trivium.cjs <子命令>`，
  改 `skills/` 资产可用 `TRIVIUM_ASSET_ROOT=<repo>/skills/dual-critic` 指向工作树。
  **但安装与卸载前要取消这个变量**：运行时根与仓库重叠时安装器拒绝写、卸载只提示不删
  （否则同步会裁掉仓库里的 `entry/` 渲染产物，卸载会删掉整棵运行时源）。
- `trivium` 有意不在 PATH 上。
- esbuild 必须 `charset: 'utf8'`（默认 ascii 会把中文全部 `\u` 转义）；测试构建需把
  `skills/dual-critic/schema/` 按原相对路径拷进 `dist/test/`。
- 集成产物 `dist/` 与 `skills/dual-critic/scripts/trivium.cjs` 均为生成物，不手改。
- 入口 SKILL.md（`skills/dual-*/`、`skills/dual-critic/entry/**`）同样是生成物：手改的内容会在下一次
  `npm run render` 时被源整份覆盖。改 `skills-src/`，别改产物。

## 改动同步清单

| 改了什么 | 必须同步 |
| :--- | :--- |
| 与设计文档不一致的行为 | 先回补修订 `doc/02_design/` 设计文档（唯一实现依据），升补丁版本 |
| JSON Schema（含新增一份） | `parse` / `gate` / `meta` 校验、`doc/03_api/PROTOCOL_dual_critic_relay.md`、`skills/dual-critic/SKILL.md`、**本文件的契约面描述**、`registry-parity` 的 schema 扫描盯防点 |
| CLI 参数或退出码 | `USAGE` 字符串、PROTOCOL 文档、相关命令契约（`skills-src/commands/`，改后 `npm run render`） |
| 入口命令的措辞、护栏、参数写法 | 改 `skills-src/`（契约 / 片段 / 载体），`npm run render` 重出四家产物并一起提交；`entry-render-parity` 契约测试校验零漂移 |
| 探针项 | 设计 §3.5 清单与 `doc/04_development/GUIDE_local_pitfalls.md`（本机坑清单 `P-xx`；M0 当时的实测快照在 `doc/05_testing/REPORT_2026-09-11_m0_probe.md`） |
| 新增测试报告（或其它带「当前已归档文件」一节的 `doc/` 目录下的文档） | 同批进该目录 README 的「当前已归档文件」一节；条目形态与顺序口径见 `doc/05_testing/README.md` 的规范句，判定以 `test/helpers/doc-archive-index.ts` 为准，`doc-archive-index` 契约测试对账 |
| BRIEF 段落 | 八段结构是契约，只并入现有段，不得增删段号；v1.3.88 起第 8 段之后可带一个不编号附录（目前只有计划阶段的任务目标原文），见设计 §9.4 |

改敏感区域（适配层、guard/gate、hooks、schema）前，先读对应设计章节与
`doc/04_development/GUIDE_env_setup.md`。

## 稳定版发布文档

当前产品发布基线见 [稳定版需求说明书](doc/01_requirements/稳定版需求说明书.md)与[稳定版系统设计说明书](doc/02_design/稳定版系统设计说明书.md)。旧需求、主设计、协议和审查工件保留；新文档是实现导读，不另设与既有规范冲突的规则。预构建包用 `npm run release` 生成，正式包须干净工作树；Mac 支持边界和 Windows 待办见中文部署手册及 Bug 清单。
