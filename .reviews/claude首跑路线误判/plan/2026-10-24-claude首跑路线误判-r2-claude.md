# claude首跑路线误判 · 实施计划（r2，定稿候选）

- 主题：claude首跑路线误判（BACKLOG EV-254，Bug 清单 §3.1 第 15 条）
- 执笔：claude（Driver）
- 日期：2026-10-24
- 基线：`db876910`（行号均取自该提交的源码，不取 `dist/test`）
- 上一轮：r1 原稿，计划三审第 1 轮 run `20261024T065502Z`（2 通过 / 1 修改后通过），裁决件 `plan/2026-10-24-claude首跑路线误判-revised-claude.md`

## 相对上一轮的改动

1. **AGY-01**：D1「改法」改为块内除进入条件那一行外全部用副本 `cfg`，`claudeSensitiveGlobsHash` 三处也改；注释写明 `cfg.review` 就是调用方的 `review`。
2. **GLM-01**：第一节边界清单补第三条「缺省 native 配置下修复后比对恒判稳定」，写明剩下的保护是什么；同句进 D3 注释、第五节 §12 新段与 Bug 清单闭合文；第三节新增边界锚 N4。gemini 总判断里「预检版本核验兜底」一句核实成立（`preflight.ts:481-488`），一并写进第一条边界。
3. **GLM-02**：第六节第 4 步写明真实验收的入口（直调仓库构建产物、记构建来源），不走 wrapper。
4. **GLM-03**：第五节在新报告「已知边界」与 Bug 清单两处登记 Windows 侧无回归锚、下次在 Windows 机器上 claude 升级后或新项目首跑时复核。（**更正 2026-10-25**：初稿写的是「待 EV-253 实测时顺带复核」，不准确——EV-253 的 Windows 实测 2026-10-24 已收口，见 BACKLOG EV-253 行与 Bug 清单 §3.1 第 12、13 条；同一更正见计划裁决件 GLM-03 行与代码阶段应答件。）

其余各节与 r1 相同。

## 〇、要解决的问题

### 0.1 机制（已读代码核实）

doctor 的 claude 段（`src/trivium/doctor.ts:1186-1260`）在探测前后各算一次路线指纹，不等就判「Claude 路线在探测期间发生变化」：

1. 探测前：`routeBefore = resolveClaudeRoute(opts.config, selected.vendorProfile)`（`doctor.ts:1194-1195`）。
2. 探测：`probeClaude(…, { config: opts.config, … })`（`doctor.ts:1201-1207`）。
3. 探测后：`stable = routeBefore?.fingerprint === resolveClaudeRoute(opts.config, selected.vendorProfile).fingerprint`（`doctor.ts:1217`）；不稳定就删该路线的 `routes` 登记、清空 `readonly_flags`、`tool_surface_checked` 与目录 deny 各字段，推 blocker（`doctor.ts:1219-1228`）。

`probeClaude` 的目录臂之前有一段首跑引导（windows 线 `0e44120a`，`src/trivium/probes/claude.ts:1744-1752`）：进入条件是 `opts.config && directorySchemaPath && selectedRoute?.model && probe.readonly_flags.length > 0`，进去后第一句就是 `opts.config.probe.cli.claude = probe`——把本次新探针**写回调用方的配置对象**，再按它重建路线交给目录臂。第 3 步用的正是这个被改过的对象。

`resolveClaudeRoute`（`src/trivium/adapters/claude-route.ts:103-147`）的指纹由七项组成（`claude-route.ts:139-143`）：`profile`、`nativeBin`、`bin`、`version`、`wrapperSha256`、`configurationSha256`、`settingsEnvSha256`。其中两项来自 `cfg.probe.cli.claude`：

- `nativeBin = c?.bin ?? probe?.entrypoint ?? null`（`claude-route.ts:107`；native 路线的 `bin` 就等于它，`claude-route.ts:108`）；
- 未显式给 `version` 时，`version = probe?.routes?.[路线键]?.probe.version ?? probe?.version ?? null`（`claude-route.ts:140-141`）。

写回之后这两项都从「盘上上一次的结论」变成「本次探针的产出」。

### 0.2 比登记时多核出的一面：全新安装时变的不只 version

BACKLOG 与 Bug 清单只写了 version。实际上全新安装且没配 `agents.claude.bin`（缺省配置就是这样，`config.ts:347` 只有 `{ vendor: 'anthropic' }`）时，`nativeBin` 也从 `null` 变成本次实测的入口。零配额核验（纯函数，用 `dist/test` 的 `resolveClaudeRoute` 与 `defaultConfig` 在写回前后各算一次 native 指纹，脚本在 scratchpad，实施时收进证据目录）：

| 情形 | 现状（写回） | 候选 B：比对时钉住探测前的版本 | 候选 A：引导改用副本 |
| :--- | :--- | :--- | :--- |
| 全新安装，`agents.claude.bin` 未配 | 判变化 | **仍判变化**（`nativeBin` null → 实测入口） | 稳定 |
| 全新安装，`agents.claude.bin` 已配 | 判变化 | 稳定 | 稳定 |
| 升级，盘上记 2.1.309、实测 2.1.310 | 判变化 | 稳定 | 稳定 |

`test/integration/claude-structured-probe.test.ts:265` 那条 doctor 用例给 `agent.bin` 设了值，恰好把 `nativeBin` 这一面盖住了。

### 0.3 触发条件与后果

只有探测走进目录臂（解析出模型、只读旗标非空）才会写回——也就是**探测成功、配额已经花掉**的那一类运行。触发面两个：CLI 自上次探测以来升过级；盘上没有 claude 结论（全新安装，或 `.trivium/` 新建的项目）。两种都是首跑必退 69、再跑一次即过（失败落盘时版本与入口已更新）。EV-251 的自动校准跑的就是 `doctor --only claude`，同样撞上。

### 0.4 本主题不改

路线指纹的组成与登记格式（`resolveClaudeRoute` 的七项、`claudeRouteKey`、`routes` 结构、`doctor.ts:1229-1232` 的登记写法）、预检判据、doctor 时限、`package.json` 版本号。

## 一、语义边界：哪些算「探测期间路线变了」（焦点）

按指纹各项的**取值来源**分两类：

| 指纹项 | 取值来源 | 探测期间能不能真的变 | 归类 |
| :--- | :--- | :--- | :--- |
| `profile` | 本轮档位选择 | 不能 | 常量 |
| `nativeBin`（native 的 `bin` 同值） | `agents.claude.bin`（内存里的配置）或盘上结论的 `entrypoint` | 内存里的配置在进程内不重读；`entrypoint` 的新值是本次探针在开头测出来的（`claude.ts:1232-1233`） | **探测自身的产出** |
| `version` | 盘上结论（路线登记里的版本，退到根结论） | 新值同样是本次探针开头测的（`probeClaudeBin`，`claude.ts:653-689`） | **探测自身的产出** |
| `bin`（profile 路线） | `agents.claude.profile_bin`，未配则 `wrapperPath()` 每次现找（`~/.local/bin` 再 `PATH`，`claude-route.ts:85-97`） | 能：包装器被挪走、`~/.local/bin` 新放了一个 | 环境 |
| `wrapperSha256` | 现读包装器文件内容（只在 profile 路线） | 能 | 环境 |
| `configurationSha256` | 现读 `~/.claude/profiles/〈名〉.env`（只在 profile 路线） | 能（删掉则 `resolveClaudeRoute` 抛出，`doctor.ts:1218` 的 catch 判失效） | 环境 |
| `settingsEnvSha256` | `settings_env_source: user_settings` 时现读 `~/.claude/settings.json` 的 env 段，否则恒为 null | 能（只在开了该项时） | 环境 |

**定义**：「探测期间路线变了」= 环境类各项在探测开始前与结束后取值不同。探测产出类两项的「前」是上一次的结论、「后」是本次的测量，两者不同说明的是「本次探测发现路线和上次记录的不一样」——这正是探测要更新的东西，`doctor.ts:1229-1232` 的登记本来就按本次快照（新入口、新版本）重算指纹，不是探测期间发生的变化。

**修复不丢任何检测能力**：现状下探测产出类两项的「后」值是 `probeClaude` **开头**测的，所以即使探测中途 CLI 自升级、入口文件被替换，现状的比对也看不见——它判出的「变化」从来不是探测期间的变化。`0e44120a` 之前 doctor 的比对就是两次都读同一份内存结论（等同候选 A 的语义）。

**如实登记的边界（本主题不改，修复前后相同）**：

1. **探测中途 CLI 自升级**（版本变、二进制被替换）：路线比对看不见。目录臂窗口内 `claudeDirectoryFingerprint`（`adapters/claude.ts:454-465`）对入口与 native 二进制取哈希，能让**目录事实**作废（目录臂失败，不是 blocker）。落盘的版本是探测开头测的旧版本，下一次预检的 `checkCliVersions`（`preflight.ts:481-488`）按所选路线比对现场版本与探针记录，不一致即判失败并给出校准目标——所以不会带着错版本的结论进审查。
2. **native 路线的入口来自内存配置**，进程内不会变；`config.yaml` 在探测期间被改，本轮 doctor 也不重读。
3. **缺省 native 配置下比对恒判稳定**（GLM-01）：未配 `agents.claude.bin`、未开 `settings_env_source` 时，修复后七项指纹两侧都取自同一份盘上结论或恒为 null（`wrapperSha256`、`configurationSha256` 只在 profile 路线计算），这条 blocker 对该形态不会触发。该形态在探测期间剩下的保护是：目录臂窗口内的目录指纹（入口与 native 二进制内容），以及下一次预检对版本与入口在位的核对（`preflight.ts:463-489`）。修复前这一形态也只会被写回误触发，从未检测过真实的环境变化，所以不是本主题新开的口子。

第 1 条不另立 BACKLOG 条目（三侧中 gemini 明确赞同，codex 认为是既存边界、无需为此加调用；没有观测到实际发生），只在报告与 Bug 清单里登记为边界。

## 二、设计决定

### D1 · 取候选 A：首跑引导改用配置副本，不动调用方的 `opts.config`

| | A · 引导改用副本 | B · 比对时前后取同一版本来源 |
| :--- | :--- | :--- |
| 全新安装（未配 bin） | 修好 | **修不好**：`nativeBin` 也变（0.2 表） |
| 要修全还得做什么 | 无 | 再给 `resolveClaudeRoute` 加一个入口覆盖参数，把 `nativeBin` 也钉住——动的是指纹计算的入参面 |
| 调用方配置对象 | 不被改动 | 仍被改成一个缺 `route_profile`、可能带着旧 `routes` 的对象；同一进程里复用它的人（既有用例第 2～5 轮）悄悄换了场景 |
| 与 `0e44120a` 之前的比对语义 | 一致 | 不一致（比对两侧的来源被手工对齐） |
| 改动面 | `probes/claude.ts` 一个块 | `doctor.ts` 比对 + 可能的 `claude-route.ts` 签名 |

取 A。理由依次是：B 修不全（这一条就够否决）；A 从根上消掉副作用，`probeClaude` 获得一条可断言的契约「不改调用方传入的配置」；A 的改动最局部。

**改法**（`claude.ts:1744-1786` 块内）：

- 块首构造 `cfg = { ...opts.config, probe: { ...opts.config.probe, cli: { ...opts.config.probe.cli, claude: probe } } }`——浅拷贝，`review`、`agents` 与调用方共享引用（既有用例 `claude-structured-probe.test.ts:273` 断言目录臂拿到的 `sensitive_globs` 与调用方是同一个引用，注释「在夹具复制并替换 sensitive_globs 之前绑定真实项目配置」依旧成立）；`probe` 是本次新探针本身的引用，之后对 `directory_deny_*` 的赋值不影响块内两次路线解析。
- 块内除进入条件那一行（`claude.ts:1744`）外，`opts.config` 全部换成 `cfg`（AGY-01）：`resolveClaudeRoute`（`claude.ts:1752`）、`claudeSensitiveGlobsHash` 三处（`claude.ts:1754`、`1760`、`1765`）、目录臂入参 `cfg`（`claude.ts:1756`）、目录臂之后的重解析（`claude.ts:1758`）。注释写明 `cfg.review` 就是调用方的 `review`（浅拷贝共享），哈希绑定的仍是真实项目配置。
- 删掉 `opts.config.probe.cli.claude = probe`，注释改写为：为什么要副本、为什么不能写回（doctor 前后比对读的是调用方对象）、契约「`probeClaude` 不改 `opts.config`」。

### D2 · native 与 profile 两种情形逐项核清

| | native | profile 〈名〉 |
| :--- | :--- | :--- |
| 探测前版本 | `routes.native.probe.version`，无登记退根结论版本 | `routes['profile:〈名〉'].probe.version`，无登记退根结论版本（根结论可能是别的路线最后一次的快照） |
| 现状探测后版本 | 新探针版本（新探针由 `claudeProbeForRoute` 取到的旧结论深拷贝而来，`claude.ts:1199-1200`；取到的是根结论时会带着根上的 `routes`，但其中没有 native 键，照样落到新探针版本） | 新探针版本——经包装器加 `--profile 〈名〉` 测得（`claude.ts:685-686`） |
| 现状探测后 `nativeBin` | `agents.claude.bin` ?? 新探针入口 | 同左（profile 指纹也含 `nativeBin`） |
| 修复后探测后 | 与探测前同源：两项都回到调用方对象上的值 | 同左 |
| 仍会判失效的真实变化 | 网关 env 摘要（开了 `settings_env_source` 时）；缺省配置下没有（第一节边界 3） | 包装器路径（未配 `profile_bin` 时现找）、包装器内容、profile 文件内容或被删、网关 env 摘要 |
| 修复后的登记 | `doctor.ts:1229-1232` 不变：按本次快照的入口与版本重算指纹 | 同左，键 `profile:〈名〉` |

### D3 · doctor 侧只加注释与常量，不改逻辑

- `doctor.ts:1216-1218` 前加一段注释写明第一节的语义边界（含边界 3：缺省 native 配置下恒判稳定、剩下的保护是什么），并指向 `probeClaude` 的「不改 `opts.config`」契约——这条比对成立的前提在另一个文件里，不写明的话下一次在 `probeClaude` 里写回又会悄悄打穿。
- blocker 文案抽成导出常量（仿 `ZCODE_HEADLESS_NOT_OK_HINT`），用例按常量断言，不抄字面。文案本身不改。

### D4 · EV-251 不另改

自动校准调用的是同一条 `doctor --only claude`，修好 doctor 即修好校准；回归锚覆盖 doctor 本体即可。

## 三、回归锚

新文件 `test/integration/claude-route-stability.test.ts`（与兄弟文件同样 win32 跳过：shebang 假 CLI）。假 CLI 照 `claude-structured-probe.test.ts` 的通用成功响应，`--version` 改读 `FAKE_CLAUDE_VERSION`（缺省 `9.9.9`）。每格独立：`scratchDir` 建项目根与家目录、`process.env.HOME` 钉到本格家目录（finally 复原）、独立的 `defaultConfig()`、`probeBins.claude` 注入假 CLI、`modelOverrides.claude` 给桩模型、`TRIVIUM_ASSET_ROOT` 钉仓库资产根、`claudeDirectoryProbe` 注入桩（记下入参，返回一份「Read 已证实」的最小证据）。

**盘上旧结论的构造**：不经 `runDoctor`（否则旧结论本身也受被测代码影响）——直接调 `probeClaude(假CLI)`（不传 config，不进目录臂）拿一份旧版本的探针，再照 `doctor.ts:1230-1232` 的写法登记 `routes[路线键]`。

| 格 | 场景 | 断言 |
| :--- | :--- | :--- |
| N1 | native 全新安装：无 claude 结论、`agents.claude.bin` 未配 | 无该 blocker；目录桩恰好被调一次，入参路线的 `bin` 与 `nativeBin` 都是假 CLI（首跑引导可用）；`routes.native` 存在、版本 9.9.9、指纹等于目录桩拿到的路线指纹；`claudeProbeForRoute(以报告探针为盘上结论的配置, null)` 取得到且版本 9.9.9（登记可消费）；根结论 `readonly_flags` 非空、`directory_deny_fingerprint` 非空；调用方配置与探测前的深拷贝 `deepEqual` |
| N2 | native 版本变化：盘上入口为假 CLI、根结论与 `routes.native` 均记 9.9.8，实测 9.9.9 | 无该 blocker；`routes.native` 版本 9.9.9，指纹与旧登记不同、可被 `claudeProbeForRoute` 取到；`readonly_flags` 非空；调用方配置未改 |
| N3 | native 版本一致（对照）：盘上记 9.9.9 | 无该 blocker；登记照常 |
| N4 | **边界锚**（GLM-01）：native 缺省配置（未配 bin、未开 `settings_env_source`），入口用本格独有的假 CLI 副本，盘上版本一致；目录桩在窗口内给入口副本追加一行注释、写 `settings.json` 的 env 段、在家目录 `.local/bin` 新放一个 `cld` | 无该 blocker；`routes.native` 照常登记；目录事实作废（`directory_deny_verified` 为空、`directory_deny_fingerprint` 为空、目录证据带失败说明）。用例注释写明它钉的是第一节边界 3，日后加强检测时要连文档一起改 |
| P1 | profile 全新安装：家目录放 `profiles/fx.env`，`profile_bin` 指向转发到假 CLI 的包装器，档位旗标选 `fx` | 同 N1，键 `profile:fx`；目录桩入参路线的 `nativeBin` 为假 CLI |
| P2 | profile 版本变化：`routes['profile:fx']` 记 9.9.8 | 同 N2 |
| P3 | profile 版本一致（对照） | 同 N3 |
| R1 | native 网关 env 摘要在探测中变化：开 `settings_env_source: user_settings`，目录桩把 `settings.json` env 段的一个值改掉 | 有该 blocker；`routes.native` 不存在；根结论 `readonly_flags` 为空、目录 deny 各字段为空 |
| R2 | profile 文件在探测中被改：目录桩给 `fx.env` 追加一行 | 同 R1，键 `profile:fx` |
| R3 | 包装器内容在探测中被改：目录桩给包装器追加一行注释 | 同 R1 |
| R4 | 包装器入口在探测中变了：不配 `profile_bin`，`PATH` 前置一个放了 `cld` 的目录；目录桩在家目录 `.local/bin` 新放一个 `cld` | 同 R1 |

R 格盘上状态取「版本一致」，让真实变化成为唯一变量。所有格只断言**这一条** blocker 的有无，其余 blocker（假 CLI 不模拟的形态，见兄弟文件头注释）不断言。

**既有用例**（`claude-structured-probe.test.ts:255-305`）：五轮与末尾那一轮各用独立的 `defaultConfig()`（仍设 `agent.bin`，保持原场景），每轮补断言「无该 blocker」。

## 四、变异

用 `scripts/mutation-check.mjs`（`--with-tests`，每条只收一个套件）；正式跑之前先用带 `--test-timeout` 的逐条预跑脚本过一遍（已知坑）。

| 编号 | 变异 | 期望 |
| :--- | :--- | :--- |
| M1 | 撤销修复：恢复写回 `opts.config.probe.cli.claude = probe`，块内改回用 `opts.config` | 新套件 N1、N2、P1、P2 红；另对 `claude-structured-probe` 套件跑一次，doctor 用例红 |
| M2 | 比对恒判稳定（`stable` 只看 `routeBefore` 是否取到） | R1～R4 红 |
| M3 | 去掉首跑引导：副本里不放本次探针（等于块内用调用方配置原样解析） | N1、P1 红（目录臂拿不到入口或目录事实落不了盘） |
| M4 | 候选 B：保留写回，比对时显式钉住探测前的版本 | N1、P1 红（`nativeBin` 从空到有）与各格「调用方配置未改」断言红；N2、P2 绿——作为 D1 取舍的实证，不要求全红 |

M1 与 M2 一正一反，证明回归锚能区分「探测自身带来的变化」与「探测期间真实的变化」；M3 守首跑引导。N4 是边界锚，不设专门变异（M2 下它照绿，M1 下它照红——版本一致但写回仍改了调用方配置，「调用方配置未改」若写进 N4 即红；实施时 N4 一并断言调用方配置未改）。

## 五、文档与交付

- `doc/08_project/BACKLOG.md` EV-254 改 done（主题名、修法、回归锚、变异读数）。
- `doc/08_project/现存Bug与未完成工作清单.md` §3.1 第 15 条闭合；补全新安装这一触发面（含 `nativeBin` 一项，原文只写了升级与 version），并留「本条原稿只写了升级触发面，已补」的痕迹；第一节三条边界写进去（GLM-01）；登记「EV-254 回归锚只在非 win32 运行，Windows 侧待下次在 Windows 机器上 claude 升级后或新项目首跑 `doctor --only claude` 时复核：应退 0、无该 blocker、`routes` 按新版本登记」（GLM-03）。（**更正 2026-10-25**：初稿这里写的是「Windows 侧待 EV-253 实测时顺带复核」，并要求「Windows 实测待办那一条同步加一句指向第 15 条」。两处都不准确：EV-253 的 Windows 实测 2026-10-24 已收口，Bug 清单里没有可挂靠的 Windows 待办条目；实施时只在第 15 条闭合文与测试报告第 6 节单列 Windows 残余。）
- 主设计 v1.3.176 → v1.3.177：版本头、变更记录一行；正文在 §12 开头那段 v1.3.142 路线裁决补充之后加一段「路线稳定性比对的语义边界」（第一节的表压成文字，含三条边界，加 `probeClaude` 不改调用方配置的契约）。
- 新报告 `doc/05_testing/REPORT_2026-10-24_claude_first_run_route.md`，登记进 `doc/05_testing/README.md`「当前已归档文件」（按日期与文件名排序，`doc-archive-index` 对账）；报告「已知边界」写第一节三条与 Windows 侧无回归锚（GLM-03）；报告草稿在全量跑完之前不放进 `doc/05_testing/`（已知坑）。
- 证据目录 `doc/05_testing/evidence/claude-first-run-route-20261024/`：零配额核验脚本与输出、变异规格与读数、全量读数。
- `package.json` 不动。

## 六、验证

1. `npm run typecheck`；`node scripts/build.mjs --with-tests` 后单跑新套件与 `claude-structured-probe`、`claude-profile`，核用例数含新增各格。
2. 变异 M1～M4（第四节）。
3. 全量 `npm run check` 前台、串行跑两次（开跑前确认没有残留 `node --test`）；改完文档再跑一次。
4. 真实 CLI 验收（**要花配额，到这一步先问用户**）：本机盘上已是 2.1.310，真实探针走不到这条路径。做法是在 scratchpad 建夹具项目，照搬本仓本机层的 `probe.cli`（不拷 `probe.auth`），把 claude 结论的版本改成 2.1.309 后跑一次真实 doctor，期望退 0、无该 blocker、`routes.native` 按 2.1.310 登记；另一格删掉 claude 结论模拟全新安装。**入口**（GLM-02）：在夹具项目里直调本次工作树的构建产物 `node 〈仓库〉/skills/dual-critic/scripts/trivium.cjs doctor --only claude --json`，`TRIVIUM_ASSET_ROOT` 指向仓库资产根；不走 `.trivium/bin/trivium` 与终端短名（两者指向全局安装副本）。跑前记下该产物的 sha256 与构建标识（HEAD、dirty），报告里写明实际入口与构建来源。各约 200 秒与少量配额。用户不做则报告如实写「真实 CLI 未验」。
5. S10 `trivium verify`。

## 七、风险

- **还有没有别的消费方依赖这次写回**：`probeClaude` 带 `config` 的调用点只有 `doctor.ts:1201`；doctor 在探测之后读 `opts.config` 的只有比对（`doctor.ts:1217`）与两处显式换掉 `probe` 的构造（`doctor.ts:1230`、`1241`）；`cli.ts:891` 之后不再拿 `ctx.config` 做 claude 相关的事。依赖写回的只有既有用例第 2～5 轮（偶然的）。
- **钉 `HOME`**：同文件用例串行执行；每格 finally 复原 `HOME` 与 `PATH`。`isolateEntryScanHome()` 照兄弟文件调用。
- **调用方配置 `deepEqual`**：若 `runDoctor` 在 claude 段之外合法地改了配置对象的别的部分，断言收窄到 `cfg.probe`，并在报告里写明为什么收窄。
- 已知偶发红见流水线坑清单；单跑复核后如实记录。
