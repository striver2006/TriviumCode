---
schema: trivium.disposition.v1
topic: M10b-入口资产与真载体验收
stage: code
role: claude
kind: response
run_id: 20260925T134359Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
---

# 应答：M10b 第 3 步（Hook 多目标、B1、停点话术）· 代码双审第 3 轮

> 被审对象：相对 `6521c87` 的未提交改动（33 个文件，138.8 KB）；报告 `doc/05_testing/REPORT_2026-09-25_m10b_step3.md`
> ｜ 运行：`20260925T134359Z`（8m43s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve`（零意见）｜ glm `approve-with-nits`
> ｜ 共 12 条：次要 7 ｜ 吹毛求疵 5 ｜ 零阻断、零重要
> ｜ **12 条全部接受**。同指两组：CODEX-03 ≡ GLM-05（`.zcode/config.json` 的 Git 处置无人交代）；CODEX-02 ≈ GLM-01 ②（在场判定只读一个文件，其它设置层看不见）

## 0. 用户的六个焦点

- **① ZCode 形态派生**：三侧一致认定四件事（matcher、`timeoutMs`、提示文件名、`enabled` 停用态）与第 1 步实测对得上，codex 用真实 `hooks.json` 复算过。glm 补一条不对称：工具名设了守卫，**事件名**没设（GLM-04），接受。
- **② 在场判定**：gemini 认为两道够；codex 与 glm 各指出一个方向。**漏降级**：单独摘掉 `Stop`（或 `pre-commit`）仍判 L1，而 L1 入口资产同一段承诺「裁决未完成不得收工……由 Hook 强制」（CODEX-01）；同一文件里的 `disableAllHooks: true` 让 Hook 全不跑、判定照过（GLM-01 ①，已按官方文档核实，原文见 §2）。**误降级**：Hook 挪到 user 级或 `settings.local.json` 时实际在拦却记 L2（CODEX-02 ≈ GLM-01 ②）。前两条修判定，第三条写进边界。
- **③ 缺省 Driver 只在降级时打一行**：三侧一致认为站得住，不改。
- **④ `driver_guard_level`**：三侧一致认为 schema / meta / report / review 四处一致，不改（边界措辞随 ② 补）。
- **⑤ 停点话术**：三侧认可四档与注册表迁移；codex 与 glm 另外核出：注册表里的写法已是唯一来源，但 CLI 还有五处恢复路径文案写死斜杠（GLM-03）；Hook 三处采信的 `gate.driver` 在同文件被声明为「不作身份来源」，注释要补全（CODEX-05）；L1 档「会拦下」没有登记超时例外（GLM-06）。全部接受。
- **⑥ 不用 ZCode 的项目多一份 `.zcode/config.json`**：gemini 认为无副作用；codex 与 glm 核出分发语义不对称——本仓与很多项目整目录忽略 `.zcode/`，写进去的 Hook 不随 Git 走，而 init 只报 created（CODEX-03 ≡ GLM-05）；另有 `--dry-run` 真的建目录、notes 说「已写入」（CODEX-04）。接受。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实。`effectiveGuardLevel` 的 L1 不只支撑「写入拦得住」：L1 入口资产（`run-enforce.l1-hook`）同一段写「裁决未完成不得收工……由 Hook 强制」。单独摘掉 `Stop`（hooks.json 自己的兜底文案就在教「移除 … 中的 TriviumCode Hook」）仍判 L1，执笔者被告知收工有 Hook 兜着而实际没有；`pre-commit` 同理。我当初的取舍理由「Stop 不影响写入」只看了一半 | 必需集改为 L1 承诺覆盖的四道：`pre-write`、`pre-bash`、`pre-commit`（`PreToolUse`）与 `stop`（`Stop`），跨事件查；`session-start` 只注入待办、不拦，不进必需集。注释与报告 §1.2 写明理由。用例：单独摘掉 `Stop` 条目 ⇒ 降 L2；变异 H6 同步改为「必需集只剩 PreToolUse 两道」 |
| CODEX-02 | codex | nit | 接受 | 属实：判定的论域是注册表登记的那一个文件，Claude Code 会把 user / 项目 / local 各层的 Hook 合并（官方文档原文见 §2），落在别层的同一份看不见，结果是保守侧的误降级。不扩读 user 级（项目外、因人而异）；`settings.local.json` 的 `disableAllHooks` 一并读（见 GLM-01） | 边界写清：`run.v2.json` 的 `driver_guard_level` 描述、`types.ts` 同名字段注释、`hookConfigPresent` 注释三处补「只读注册表登记的那一个项目内文件，其它设置层（user 级、`settings.local.json`）里的 Hook 看不见——落在那里会误判为不在场，偏保守」；报告 §1.2 边界表同步 |
| CODEX-03 | codex | minor | 接受 | 属实，与 GLM-05 同指。`fixGitignore` 只处理 `.claude/`，snippet 没有 `.zcode` 规则，本仓 `.gitignore` 第 52 行整目录忽略 `.zcode/`：claude 那份随仓库走，glm 那份静默不进 Git，init 只报 created。**不自动给 `.zcode/` 开白名单**：ZCode 的项目配置里还可能有个人设置（它的个人 / 共享分层本仓没核过），替用户决定「进 Git」风险更大 | 写入 ZCode 配置后检测该路径是否被 `.gitignore` 覆盖（`git check-ignore`）：被忽略时追加一条说明「这份 Hook 只对本机生效、不随仓库分发；要分发请自行放行 `.zcode/config.json`」。「请重新信任」那条 note 加一句「不用 ZCode 可忽略」。USAGE 同步一句。用例：夹具 `.gitignore` 忽略 `.zcode/` ⇒ notes 含「不随仓库分发」 |
| CODEX-04 | codex | nit | 接受 | 属实：`ensureDir` 与「已备份」「已写入……请重新信任」两条 notes 都在 `!dryRun` 之外，`--dry-run` 会真建出 `.zcode/` 并汇报两件没发生的事；`--json` 的 notes 会被念给用户 | `ensureDir` 与写盘一起挪进 `!dryRun`；dry-run 时两条 note 改成「将备份」「将写入」措辞。集成用例 `hooks --dry-run` 补断言：目录不存在、notes 不含「已写入」 |
| CODEX-05 | codex | nit | 接受 | 属实：同文件 EV-68 文档写明闸门项的 `driver` 不作当轮身份来源（同槽位重跑换 Driver 时留着上一轮的值）。这三处只拿它**选写法**、不参与判定，且锁分支可能同时开着多道闸门，拿不到单一「当轮」 | 三处旁补注释：「只用闸门项的 `driver` 选调用写法、不参与身份判定；最坏情况是给出上一轮 Driver 的写法，今天带 Hook 的两家写法相同，看不出差别」。不加变异（报告 §5 已登记行为上区分不开） |
| CODEX-06 | codex | nit | 接受 | 属实：`entry-render.ts` 头注释仍把「调用写法」列为载体 yaml 的键；`init.ts` 头注释的产出清单只写 `.claude/settings.json` | 两处头注释改准：前者标注「调用写法已迁注册表 `entryInvocation`」；后者改为「按注册表把 Hook 合并进每一家登记了目标的项目配置」 |
| GLM-01 | glm | minor | 接受 | ①属实，已按官方文档核实：「To temporarily disable all hooks without removing them, set `"disableAllHooks": true` in your settings file」，且 local 设置优先于项目设置。它写在判定已经读进来的同一类文件里，存在性检查照过，停点会说「Hook 会拦下」——正是本步要消除的形态。②与 CODEX-02 同：跨层合并写进边界，不扩读 user 级 | ①Claude 形态在场判定：项目 `.claude/settings.json` 或同目录 `settings.local.json` 里 `disableAllHooks === true` ⇒ 不在场（local 优先于项目，与文档的优先级一致）；用例两格。②同 CODEX-02 的边界措辞 |
| GLM-02 | glm | minor | 接受 | 属实：只校验了顶层是对象。`"hooks": [...]` 时合并结果写在数组的非下标属性上、序列化即丢，却报 created / updated；`"hooks": "x"` 时严格模式下抛 TypeError，init 半途中断。claude 分支是旧实现就有的洞，本步把 zcode 分支也建在上面 | 两分支入口校验 `hooks`（zcode 另含 `hooks.events`）为对象或缺席，否则按「解析失败」同口径跳过、原样保留、记 note。用例：`hooks` 为数组、为字符串各一格，文件内容不变 |
| GLM-03 | glm | minor | 接受 | 属实：`approve` 复核失败的两个出口（`cli.ts` :1570、:1585）、`gate.ts` 缺结论文件与工件篡改两处文案、`topic-args.ts` 缺焦点的用法报错，仍写死斜杠写法；codex 当 Driver 时拿到的命令跑不了，与停点同一缺陷类 | 五处改走 `entryCommandOf`：`approve` 分支用闸门项的 `driver`（注释同 CODEX-05）；`gate.ts` 两处给渲染函数加可选的 Driver 入参，调用方传当轮 Driver（`gate --check` 用 `gateDriver`）；`topic-args.ts` 用已解析的显式 `--driver`，缺席取缺省 Driver。用例：`renderTamperedArtifacts` 按 Driver 出写法一格 |
| GLM-04 | glm | minor | 接受 | 属实：工具名的守卫理由（「静默丢掉就是装上了却不拦」）同样适用于事件名，而事件名原样透传；今天 hooks.json 只用三个在枚举内的事件，所以无害 | 新增 `ZCODE_HOOK_EVENTS`（第 1 步报告 §3.1 的七个事件枚举），`renderHookEvents` 遇到枚举外事件当场抛，文案指向本模块与报告两处对账。用例一格；变异一条 |
| GLM-05 | glm | minor | 接受 | 与 CODEX-03 同指。另点出两份 `.trivium-backup` 在 gitignore 片段里没有规则（`.claude` 侧是既有的洞） | 同 CODEX-03；`protocol/gitignore.snippet` 补 `.claude/settings.json.trivium-backup` 与 `.zcode/config.json.trivium-backup` 两行，`fixGitignore` 已有的「片段未追加过才追加」机制不追已初始化项目——报告里如实登记：已 init 的项目要手工补这两行（或第 5 步文档写明） |
| GLM-06 | glm | nit | 接受 | 属实：本步报告 §3 自己引了官方文档「A timed-out … hook doesn't block the tool call」，L1 档「（Hook 会拦下）」对超时这一格不成立，与另三档的限定精度不一致。本仓 Hook 是毫秒级、超时 15 / 30 秒，风险极低，但措辞代价为零 | L1 档改为「在此期间不得修改业务文件（Hook 会拦下；Hook 超时即放行，本仓 Hook 是毫秒级、正常碰不到）」；对应单元断言与集成断言同步 |

## 2. 核实记录

GLM-01 自标「未按官方文档核实」。我抓取 `https://code.claude.com/docs/en/hooks.md`（2026-09-25）核对：

- 「To temporarily disable all hooks without removing them, set `"disableAllHooks": true` in your settings file.」
- 「Claude Code reads the value left after settings precedence applies, so a `"disableAllHooks": false` in a project's `.claude/settings.json` overrides a `true` in your user settings.」
- 「Hook entries merge across settings levels rather than replacing each other: user, project, and local settings add their own hooks without removing managed ones…」

据此：`disableAllHooks` 在项目层或 local 层为 true 时判「不在场」（local 优先于项目）；user 层的 true 会被项目层的 false 覆盖、且在项目外，不读，写进边界。

## 3. 修改方案（审批后执行）

1. `hook-config.ts`：必需集四道跨事件查（CODEX-01）；`disableAllHooks`（项目 + local）（GLM-01）；嵌套形态校验（GLM-02）；`ZCODE_HOOK_EVENTS` 守卫（GLM-04）；dry-run 保真（CODEX-04）；被忽略检测与 notes（CODEX-03 ≡ GLM-05）；L1 档措辞（GLM-06）；边界注释（CODEX-02）。
2. `hooks.ts` 三处注释（CODEX-05）；`cli.ts` approve 两处、`gate.ts` 两处、`topic-args.ts` 一处改走 `entryCommandOf`（GLM-03）。
3. `run.v2.json`、`types.ts` 的边界措辞（CODEX-02）；`entry-render.ts`、`init.ts` 头注释（CODEX-06）；`gitignore.snippet` 两行（GLM-05）；USAGE 一句（CODEX-03）。
4. 用例按上表逐格补；变异：H6 改写、补 GLM-04 事件守卫、CODEX-01「摘 Stop」、GLM-01 `disableAllHooks`、GLM-02 嵌套形态、CODEX-04 dry-run 各一条，并在当前代码上重跑两份规格。
5. 报告 §1.2 边界表、§2.1、§7 同步；`npm run check` 全绿。
6. 修完是否再审一轮由用户定。
