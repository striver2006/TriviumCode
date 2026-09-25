# M10b 第 3 步 · Hook 多目标（ZCode 渲染）与 B1 护栏等级接线 实施报告

> **状态**：代码双审 1 轮（本主题 code 阶段第 3 轮，run `20260925T134359Z`）12 条全接受，用户审批通过（无附言），修复完成（§8），随实施一并提交。
> **上位**：计划定稿 r10 §3（替换 r9 §3.2 / §3.4，r9 又替换 r5 §6 的若干条）；D-2 = (b)、D-3 = 撤回自动探针均已由用户于 2026-09-25 拍板，本步不另出子计划。
> **日期**：2026-09-25　**起点**：`6521c87`（`main`，EV-125 结案，已推送）
> **证据**：`doc/05_testing/evidence/m10b-step3-20260925/`

glm `guardLevel` → L2 这一项按 r10 §3.1.4 已提前到第 2 步做完，本步不重复。

## 0. 读数总览

| 项 | 读数 |
| :--- | :--- |
| 全量测试 | `npm run check`：**2019 / 2017 pass / 0 fail / 2 skipped**（代码双审 r3 修复后，§8；修复前 2011，§6） |
| 变异 | **30 / 30 咬住**（主规格 23 + 停点话术 7，代码双审 r3 修复后在当前代码上重跑，§8；修复前 15 + 5，§5），基线全绿起跑 |
| 真实 HOME | **未写**：本步只改仓库；装置与用例全部在 mkdtemp 夹具里跑 |
| ZCode 真载体 | **未跑**：渲染出的 `.zcode/config.json` 在桌面端的信任、`Stop` / `SessionStart` 两个事件的行为，都要用户在 ZCode 桌面端薄冒烟（§7 第 2 条） |

## 1. Hook 多目标：同一份 `hooks.json` 按形态渲染（r5 §6.1「通过时」，r10 §3.1.2、§3.2，r9 §3.4）

### 1.1 注册表：路径与形态登记在同一个字段里

`hookConfigTarget` 由路径字符串改为 `{ path, format }`（`format` 取 `claude-settings` / `zcode-config`）。
理由：两家的配置文件形态不同，渲染器必须知道按哪种形态写；把形态另登记一个字段，或者在渲染器里按路径猜，都会多出一个与注册表并列的事实源。
消费方只有 `guardProfileOf`（判空）、两处测试夹具（取值为 null）与本步新增的 `hook-config.ts`，改形不牵连别处。

### 1.2 `hook-config.ts`：渲染、合并、在场判定

| 部分 | 做法 |
| :--- | :--- |
| 单一来源 | 两家都从运行时根的 `hooks/hooks.json`（Claude Code 形态）派生，不另写一份 ZCode 版 |
| ZCode 渲染 | matcher 只留 ZCode 工具注册表里有的名字（`Write` / `Edit` / `Bash`，去掉 `NotebookEdit`），且只写精确名单形态（r10 §3.2.2：不锚定正则会让 `Write` 误配 `TodoWrite`）；一条 matcher 过滤后一个名字都不剩就当场抛；`timeout`（秒）换成 `timeoutMs`（毫秒）；护栏失效提示里的「`.claude/settings.json` 中的 TriviumCode Hook」换成本家配置文件名 |
| ZCode 外壳 | 条目放在 `hooks.events.<事件>[]` 下；`hooks.enabled` **只在缺席时置 true**——用户显式写了 false 是 r10 §3.2.3 的「停用」态，重跑不翻回，只记一条说明 |
| 合并 | 两家共用：按事件追加、按 `gate hook-<name>` 原位替换旧版（升级不叠加）、不动用户已有的 Hook 与其它键；不是合法 JSON 对象时跳过并原样保留；写盘前备份为 `<文件>.trivium-backup` |
| 写后提示 | ZCode 形态写入后提示「在桌面端重新信任该工作区，信任前 Hook 不跑」，并点出命令行模式整体关闭、子代理不过 Hook 两条边界 |
| 在场判定 | `hookConfigPresent`：文件在、是合法 JSON 对象、**L1 承诺覆盖的四道**都在（`PreToolUse` 下 `pre-write` / `pre-bash` / `pre-commit`，`Stop` 下 `stop`；代码双审 r3 CODEX-01 之前只查前两道）；ZCode 形态另要求 `hooks.enabled === true`；Claude 形态另看 `disableAllHooks`（项目文件与同目录 `settings.local.json`，local 优先，r3 GLM-01）。**边界**：只看存在性不看内容（r5 §6.2 边界 R-r）；只读注册表登记的那一个项目内文件，落在 user 级或其它设置层的 Hook 看不见、会误判为不在场（偏保守，r3 CODEX-02） |

事件映射与 r10 §3.2.1 的表一致：`PreToolUse`（`Write|Edit` → `hook-pre-write`；`Bash` → `hook-pre-bash`、`hook-pre-commit`）、`Stop` → `hook-stop`、`SessionStart` → `hook-session-start`。五个事件名都在 ZCode 的事件枚举里（第 1 步报告 §3.1）。

### 1.3 入口：`trivium init` 两家一起合并，新增 `trivium hooks --agent <id>`

- `init` 改调 `mergeAllHooks`：每一家登记了 `hookConfigTarget` 的都合并（今天是 claude 与 glm）。`mergeHooks` 保留原签名，只合并 Claude 形态那一家，既有用例不动。
- `trivium hooks --agent <id> [--dry-run] [--asset-root <路径>] [--json]`：只合并指定的一家，**只做渲染与安装，不参与任何判定**。没有 Hook 机制的家（codex、gemini）、未登记的 id、缺 `--agent` 一律退 64 且零写入；项目还没 init 时加一条说明（守卫在没有 `config.yaml` 时一律放行，init 之后才生效）。USAGE 同步。

### 1.4 路径形态用例（r9 §3.4「实现时加一条用例钉住」）

第 1 步实测里 ZCode 负载的 `CLAUDE_PROJECT_DIR` 是 `/tmp/…` 形态、`file_path` 是 `/private/tmp/…` 形态。`hooks.test.ts` 新增一格：项目根取词法路径、写入目标取 realpath 形态，判定照样拦。本机 `os.tmpdir()` 本身就在 `/var` → `/private/var` 这条软链下，夹具天然带着两种形态。

## 2. B1：护栏等级接线（r5 §6.2，r10 §3.3 收窄后的口径）

| 落点 | 做法 |
| :--- | :--- |
| `effectiveGuardLevel` | 只对**登记为 L1** 的载体判 Hook 配置是否在场，不在场即降 L2；登记为 L2 的直接返回 L2，不读任何探针字段（D-3） |
| 文案 | `describeGuard` 按护栏形态三档出文案，与入口资产注入段同源（r10 §3.1.3）：glm 打印「L2（有尽力拦截的 Hook……不兜底——只在桌面端、已信任、主代理、matcher 覆盖、不超时时生效）」，不再有「L2 = 无事前写拦截」这种与 glm 实况相反的说法 |
| `preflight` | 「当轮 Driver」那一行带上护栏等级。**缺省 Driver 仍不打**（原设计：每次都打等于没打），**例外是它登记 L1 而 Hook 配置不在场**：那时打一行 ⚠️、标 `warn`、进 `warnings`，由 skill 念给用户，并给出修复出口 |
| `run.v2` | 新增可选字段 `driver_guard_level`（`L1` / `L2`），`review` 在写运行元数据时按**本次运行时**的事实取值（不信预检那一次）；不传就不写——缺失即「无从得知」，不替没检查过的运行补一个 L1。schema 同步 |
| `report` | 时间线新增「Driver（护栏）」列；旧留痕没有这个字段时写「—」 |
| 死分支 | `preflight` 里「本次声明的 Driver 尚未启用为 Driver，该值仅用于选侧判定」一支删除，`driverEnabled` 入参随之去掉（`resolveDriver` 对未启用者退 64，生产路径走不到它，r5 §6.2 末段） |

与计划字面的一处偏差：r5 §6.2 写「`preflight.ts` 在当轮 Driver 处打印护栏等级」，没说缺省 Driver 打不打。这里保留原设计「缺省不打」，只在降级时打。理由：降级是唯一需要人看见的形态；缺省路径上每次多一行，会把真正的告警淹掉。

## 2.1 闸门停点话术按当轮 Driver 措辞（第 2 步薄冒烟核出；用户 2026-09-25 定并入本步）

第 2 步附录 B 核出：`gate --await-approval` 对 glm 写「在此期间不得修改业务文件（**Hook 会拦下**）」——glm 是 L2、夹具里也没有 Hook，后半句不成立；
调用写法写死 `/dual-approve`，对 codex 应是 `$dual-approve`。停点话术由 CLI 生成，不经入口资产渲染，第 2 步的单源渲染管不到它。

| 落点 | 做法 |
| :--- | :--- |
| 调用写法的来源 | 由载体 yaml 的 `invocation` **迁入注册表** `entryInvocation`，成为唯一来源：CLI 装到运行时根后读不到 `skills-src/`，而两处各登记一份正是这次错位的成因。渲染器改从注册表取，载体 yaml 里再写 `invocation` 即当场报错。**重渲染 0 份变化**（28 份产物逐字节未动），证明迁移不改行为 |
| `entryCommandOf(driver, name)` | 按当轮 Driver 取写法；取不到或未登记时回落缺省 Driver（旧闸门记录没有 `driver` 字段，那时执笔者就是缺省 Driver） |
| 后半句 | `gateHoldNotice` 按**本次运行时的有效等级**四档措辞：只有有效 L1 才说「（Hook 会拦下）」；L1 降级、L2 尽力拦截、L2 无 Hook 三档各说清「靠你自觉」与「越界在审批前复核与跑后漂移复算时暴露」 |
| CLI 两处 | `gate --await-approval` 的停点话术、`gate --check` 裁决齐备后自动置等待审批的那一句 |
| Hook 三处 | 写入拦截、Bash 拦截、会话开场待办里的 `/dual-approve` / `/dual-abandon` 改按该闸门记下的 `driver` 派生。另两处拿不到当轮 Driver（状态文件禁写那一支、提交 Hook），保留斜杠写法并在代码里注明：会跑到 Hook 的只有带 Hook 的载体，它们今天都是 `/` 写法 |

## 3. 查证：Claude Code 侧的 Hook 超时与子代理（r9 §3.3「第 3 步开工时查官方文档照实登记」）

来源 `https://code.claude.com/docs/en/hooks.md`（2026-09-25 抓取）：

1. **超时**：原文「A timed-out `command`, `http`, or `mcp_tool` hook doesn't block the tool call. The call continues through the normal permission flow, so don't count on a stalled hook to act as a gate.」
   ⇒ **Claude Code 也是超时即放行**，与 ZCode 同形。r9 §3.3 威胁表「Hook 超时」行的「Claude Code：未核」改为「超时不拦（官方文档）」。
   默认超时原文「Defaults: 600 for `command`…」；本仓每条 Hook 都显式挂了 `timeout`（15 / 30 秒），且都是毫秒级脚本，正常情况下碰不到。
2. **其它退出码**：原文「Any other exit code doesn't block on its own for most hook events.」与本仓 `hooks.ts` 的三档语义（0 放行、2 拦截、1 程序缺陷不阻断）一致。
3. **子代理**：原文「Hooks from settings files, managed policy settings, and plugins also run inside subagents. When a subagent calls a tool, tool events such as `PreToolUse` and `PostToolUse` fire the same configured hooks as in the main conversation, and the input carries the `agent_id` and `agent_type` common input fields that identify the subagent.」
   ⇒ r10 §3.1.2 登记的「claude 侧子代理是否过 Hook 也未核」有了答案：**会过**。这正是 claude 与 glm 分级不同的结构性理由之一（ZCode 的子代理不过工作区 Hook，第 1 步报告 §3.1.2）。

这三条是文档陈述，不是本机实测。第 5 步回溯时写进 L1 / L2 文档的「已知边界」与 8.5 引言块（§7 第 3 条）。

## 4. 测试

| 用例 | 覆盖 |
| :--- | :--- |
| `unit/hook-config.test.ts`（新，§1～§2 共 12 条） | 两种形态的渲染（用仓库真实的 `hooks.json`）；matcher 过滤后为空即抛；ZCode 合并：新建、幂等、保留用户 Hook 与其它键、旧版原位替换、`enabled: false` 不翻回、非法 JSON 原样保留；没有 Hook 机制的家零写入；在场判定（缺 `pre-bash`、`enabled` 不为 true）；有效等级（L1 在场 / 不在场、L2 不看在场） |
| `integration/hooks-command.test.ts`（新，4 条） | `hooks --agent` 只写指定的家、不碰 Claude 的；三种 64（没有 Hook 机制、缺 `--agent`、未登记）且零写入；`--dry-run` 零落盘；`init` 两家一起合并 |
| `unit/preflight.test.ts` | 「当轮 Driver」四格：l2-none 与 l2-hook 各一格文案；缺省 Driver + Hook 在场不打；缺省 Driver + Hook 不在场打 ⚠️ 并进 `warnings`。「探针过期」一格改为剔掉信息行再数 |
| `unit/run-meta.test.ts` | `driver_guard_level` 传了才写、两档合法、不传不补、`L3` 被 schema 拒 |
| `unit/report.test.ts` | 时间线「Driver（护栏）」列：有等级写等级、旧留痕写「—」 |
| `integration/fault-injection.test.ts` | 真实运行路径上 `run.json` 记了 `driver_guard_level`（夹具无 Hook 配置 ⇒ `L2`） |
| `unit/hooks.test.ts` | §1.4 的路径形态一格 |
| `unit/hook-config.test.ts`（§2.1 追加 2 条） | 停点后半句四档措辞；`entryCommandOf` 逐家取写法、取不到回落缺省 Driver |
| `contract/entry-render-parity.test.ts`（§2.1 追加 1 条） | 产物用的调用写法等于注册表；载体 yaml 里加回 `invocation` 即加载失败 |
| `integration/fault-injection.test.ts`（§2.1） | 既有的缺省 Driver 停点用例补断言：夹具无 Hook 配置 ⇒ 降级措辞、不说「Hook 会拦下」；新增一条：非缺省、无 Hook、非斜杠写法的 Driver（由注册表派生，今天是 codex）走一整轮到停点，调用写法与后半句都换成它的 |

## 5. 变异

装置 `scripts/mutation-check.mjs`，规格 `mutation-spec.json`，包装 `run.mjs`，原始输出 `mutation-output.txt`。
装置报「✓ 工作树干净、基线全绿（7 个套件）」：「干净」指装置的哨兵判据（上次运行已善终），不是 `git status` 为空——本步改动未提交。**15 / 15 咬住**：

| # | 变异 | 应红的套件 | 结果 |
| :-- | :--- | :--- | :--- |
| H1 | ZCode 工具名单混进 `NotebookEdit` | hook-config | ✓ fail=2 |
| H2 | 超时不换算成 `timeoutMs` | hook-config | ✓ fail=1 |
| H3 | 护栏失效提示仍点名 Claude 的配置文件 | hook-config | ✓ fail=1 |
| H4 | 显式 `enabled: false` 被重跑翻回 true | hook-config | ✓ fail=1 |
| H5 | ZCode 在场判定不看 `enabled` | hook-config | ✓ fail=1 |
| H6 | 在场判定只要求 `pre-write` 一道 | hook-config | ✓ fail=1 |
| H7 | 有效等级永不降级 | preflight | ✓ fail=1 |
| H8 | 缺省 Driver 恒打护栏行 | preflight | ✓ fail=1 |
| H9 | 缺省 Driver 降级时不打 | preflight | ✓ fail=1 |
| H10 | `init` 只合并 Claude 形态那一家 | hooks-command（集成） | ✓ fail=1 |
| H11 | `hooks --agent` 忽略指定的家 | hooks-command（集成） | ✓ fail=2 |
| H12 | `review` 不把有效等级写进 `run.json` | fault-injection（集成） | ✓ fail=1 |
| H13 | `newRunMeta` 缺省补 L1 | run-meta | ✓ fail=1 |
| H14 | report 不读 `driver_guard_level` | report | ✓ fail=1 |
| H15 | 合并按全文识别同一条（重跑叠加、升级不替换） | init | ✓ fail=1 |

收尾恢复成功，`src/` 的改动与变异前一致。

上表是停点话术（§2.1）改完之后、在当前代码上的重跑（`mutation-output.txt`）；第一次跑在 §2.1 之前（`mutation-output-run1.txt`）。两次逐条相同，只有 H12 由 fail=1 变为 fail=2——新加的 codex 停点用例同样断言了 `driver_guard_level`，符合预期。

**停点话术另一份规格**（`mutation-spec-2.json` → `mutation-output-2.txt`，`node run.mjs mutation-spec-2.json`），**5 / 5 咬住**：

| # | 变异 | 应红的套件 | 结果 |
| :-- | :--- | :--- | :--- |
| S1 | 停点调用写法取缺省 Driver 而非当轮 Driver | fault-injection（集成） | ✓ fail=1 |
| S2 | 停点后半句取缺省 Driver 的护栏等级 | fault-injection（集成） | ✓ fail=1 |
| S3 | 后半句恒说「Hook 会拦下」（改动前的形态） | hook-config | ✓ fail=1 |
| S4 | `entryCommandOf` 恒用斜杠写法（改动前的形态） | hook-config | ✓ fail=1 |
| S5 | 渲染器不再拒绝载体 yaml 里的 `invocation` | entry-render-parity | ✓ fail=1 |

Hook 侧三处改为按闸门的 `driver` 派生写法，**没有变异**：会触发 Hook 的只有带 Hook 的载体，它们今天都是 `/` 写法，把派生改回写死在行为上区分不开。它守的是第三家带 Hook 的载体用别的写法时不漏改。

## 6. 全量测试

`npm run check`（typecheck → build → 全部测试）：**2011 / 2009 pass / 0 fail / 2 skipped**。较第 3 步开工前（EV-125 提交时的 1987）多 24 条：
- §1～§2 的 Hook 多目标与 B1 共 20 条：hook-config 12、hooks-command 4、run-meta 1、report 1、hooks 1、preflight 净增 1（原「当轮 Driver」三格——含随死分支删除的「尚未启用为 Driver」那格——改写为四格）；
- §2.1 的停点话术共 4 条：hook-config 2、entry-render-parity 1、fault-injection 1。

另有 fault-injection 两条既有用例补了断言（`driver_guard_level`、缺省 Driver 的停点措辞），不增条数。

## 7. 待用户定与待做

1. **闸门停点话术**：用户 2026-09-25 定并入本步，已做（§2.1）。
2. **glm 薄冒烟（第二轮）**——**已做（2026-09-25，附录 A），全部按设计生效**。原待做描述：渲染出的 `.zcode/config.json` 要在 ZCode 桌面端验：①信任提示出现、信任后 `Write` 一个受保护后缀的文件被拒；②`Stop`（收工拦截）与 `SessionStart`（待办注入）两个事件的实际行为（静态读到 `Stop` 上退 2 走 `decision: block`，未实测）。这一步需要你在桌面端操作，逐步清单可以照第 2 步附录 A 的形式另写一份。
3. **第 5 步回溯清单追加**（r5 §8.4、r10 §6 之外）：§3 的三条文档陈述写进 L1 / L2 文档与 8.5 引言块；r9 §3.3 威胁表「Hook 超时」行改为两家都「超时即放行」；四态文档（r10 §3.2.3）写进 QUICKSTART 与 RUNBOOK；PROTOCOL 补 `hooks` 命令一行、`run.v2` 的 `driver_guard_level`；RUNBOOK 补「写盘前备份只在真正写入时发生」（见下条）。
4. **行为变化一处**：旧 `mergeHooks` 在配置已存在时**每次**都先写备份（哪怕随后判定「已就位」不写）；现在只在真正写入时备份。重跑 init 不再反复覆写 `.trivium-backup`，旧备份得以保留。
5. **`review --cancel` 不回写 `run.json`**：第 2 步冒烟核出，建议新立 BACKLOG，仍待你定。
6. **已 init 的项目不会自动补 gitignore 两行**（r3 GLM-05）：片段新增了两份 `.trivium-backup` 的忽略规则，但 `fixGitignore` 只在片段从未追加过时才追加，已初始化的项目要手工补这两行。第 5 步文档写明。

## 8. 代码双审第 3 轮的修复（run `20260925T134359Z`，用户审批通过、无附言）

应答件 `…/code/2026-09-25-M10b-入口资产与真载体验收-r3-response-<Driver>.md`：12 条全部接受。gemini `approve`（零意见），codex / glm `approve-with-nits`。
审批无附言：`.zcode/config.json` 按应答件的取舍处理——**不自动开白名单**，只在被忽略时如实说明。

| 意见 | 改了什么 | 用例 / 变异 |
| :--- | :--- | :--- |
| CODEX-01 | 在场判定的必需集由两道扩为 L1 承诺覆盖的四道（加 `pre-commit`、`stop`），按事件查 | 「单独摘掉 Stop 或 pre-commit 也 ⇒ false」；H6 改写、H16、H17 |
| GLM-01 | Claude 形态认 `disableAllHooks`：项目文件与同目录 `settings.local.json`，local 优先（已按官方文档核实原文，见应答件 §2） | 「disableAllHooks……」三格；H18、H19 |
| CODEX-02 | 「只读注册表登记的那一个项目内文件」写进 `run.v2.json`、`types.ts`、`hookConfigPresent` 注释与本报告 §1.2 | — |
| CODEX-03、GLM-05 | ZCode 配置写入后 `git check-ignore`，被忽略时追加「只对本机生效、不随仓库分发」；「请重新信任」加「不用 ZCode 可忽略」；USAGE 一句；gitignore 片段补两份 `.trivium-backup` 的规则 | 「配置被 .gitignore 忽略时如实说……」两格；H23 |
| CODEX-04 | `--dry-run` 不再建目录，notes 用「将……」措辞 | 单元 dry-run 一条、集成 `hooks --dry-run` 补两条断言；H22 |
| CODEX-05 | `hooks.ts` 三处写明「闸门项的 `driver` 只选写法、不作身份来源」 | — |
| CODEX-06 | `entry-render.ts`、`init.ts` 头注释改准 | — |
| GLM-02 | 合并前校验 `hooks`（ZCode 另含 `hooks.events`）为对象或缺席，否则跳过、原样保留、记说明 | 「嵌套键形态不对……」四格；H20 |
| GLM-03 | approve 复核失败两个出口、`gate.ts` 两处（缺结论文件、工件篡改）、`topic-args.ts` 缺焦点报错改走 `entryCommandOf` | 两格单元；S6、S7 |
| GLM-04 | ZCode 渲染加事件名守卫（第 1 步报告 §3.1 的七个事件） | 「事件名不在 ZCode 的事件枚举里」；H21 |
| GLM-06 | L1 档停点措辞登记超时例外 | 断言同步；S3 的 find 同步 |

全量 `npm run check`：**2019 / 2017 pass / 0 fail / 2 skipped**（较 §6 的 2011 多 8 条）。

**变异**（修复后在当前代码上重跑，两份都「工作树干净、基线全绿」起跑）：

- 主规格 `mutation-spec.json` → `mutation-output.txt`：**23 / 23 咬住**。H5、H6 的 `find` 随代码更新（H6 改为「必需集去掉 pre-bash」）；新增 H16～H23 八条（见上表）。H1～H15 的 fail 数与修复前那次（`mutation-output-run2.txt`）逐条相同。
- 停点话术 `mutation-spec-2.json` → `mutation-output-2.txt`：**7 / 7 咬住**。S3 的 `find` 随 L1 档措辞更新；新增 S6、S7。S4 由 fail=1 变为 fail=2（新加的 GLM-03 两格也依赖 `entryCommandOf`），符合预期。修复前的 5 条读数留在 `mutation-output-2-run1.txt`。

## 附录 A · glm 第二轮薄冒烟（2026-09-25，ZCode 桌面端，用户操作；结案提交 `da6476c` 之后、安装副本即该构建）

§7 第 2 条的待做。夹具 `…/T/m10b-smoke2-FSFhzT`（mkdtemp，仓库外）；待裁决闸门由**桩审核者**造出（`TRIVIUM_STUB_CRITIC`，与 selftest 同一机制），**零审查配额**。
证据 `doc/05_testing/evidence/m10b-step3-smoke2-20260925/`：搭建脚本与读数 `setup.mjs` / `01-setup-readout.json`，清单 `00-checklist.md`，两段读数 `02-readout-part1.md` / `03-readout-part2.md`，会话留痕摘录 `extract.mjs` / `04-rollout-excerpt.json`。

| 项 | 结果 |
| :--- | :--- |
| 信任提示 | 出现，用户点信任 ✓ |
| `SessionStart` 待办注入 | 第一段**未注入**：该会话第一轮（14:53:33）早于信任授予（14:53:40～44），信任前 Hook 不跑；第二段（已信任后新会话）**注入** ✓，原文「TriviumCode 待办：· 冒烟二轮/plan 审查已落盘但裁决未齐备」——ZCode 接受 Claude 形态的 `hookSpecificOutput.additionalContext` |
| `Stop` 收工拦截 | 待裁决时每次收工拦一次、无死循环 ✓（ZCode 以「Stop hook additional context」交给模型）；裁决齐备后放行 ✓ |
| 写入拦截（审查员后缀） | Write `…-codex.md` 被拒 ✓，当轮 Driver 按运行留痕判为 glm |
| 闸门写锁（业务文件） | Edit `src/app.ts` 被拒 ✓，出口写法 `/dual-approve …`（按闸门的 Driver 派生） |
| 停点话术（§2.1） | `--check` 自动置等待审批与 `--await-approval` 两处都写 `/dual-approve`、末句为「本载体的 Hook 只作尽力拦截、不兜底（L2）……」✓——第 2 步冒烟核出的错位已修正 |

**结论**：五个 Hook 在 ZCode 桌面端全部按设计生效，不需要改代码。新登记一条**时序边界**：工作区信任要在会话开始之前完成（ZCode 的信任提示可能在首个会话开始后才弹出，该会话的 `SessionStart` 不跑）——写进第 5 步文档，并写进第 4 步 glm 轮操作卡（先开夹具、点信任，再新建会话）。
夹具由用户在终端处理去留（会话不删临时目录）。
