# claude 首跑路线误判修复 · 测试报告（EV-254）

- **主题**：`claude首跑路线误判`（`/dual-run` 命令 A 全流程，Driver claude，审核者 codex、gemini、glm）
- **日期**：2026-10-24
- **基线**：`db876910`（下文行号取自该提交的源码）
- **留痕**：计划 `.reviews/claude首跑路线误判/plan/`（定稿 r2）；代码审 `.reviews/claude首跑路线误判/code/`；证据 [`evidence/claude-first-run-route-20261024/`](./evidence/claude-first-run-route-20261024/)
- **登记**：BACKLOG EV-254；Bug 清单 §3.1 第 15 条；主设计 v1.3.177（§12「路线稳定性比对的语义边界」）
- **产品版本号**：不动（`package.json` 仍为 1.3.1）

## 1. 问题与根因

doctor 的 claude 段（`src/trivium/doctor.ts:1186-1260`）在探测前后各按调用方配置 `opts.config` 解析一次路线指纹，不等即判「Claude 路线在探测期间发生变化」：删该路线的 `routes` 登记、清空只读旗标与目录 deny 各字段、推 blocker、退 69。claude 探针目录臂之前的首跑引导（windows 线 `0e44120a`，1.1.1，`src/trivium/probes/claude.ts:1744-1752`）为了让全新安装时目录臂拿得到入口，把本次新探针**写回**了 `opts.config.probe.cli.claude`。路线指纹（`adapters/claude-route.ts:139-143`）有两项取自这份探针结论：

- 入口 `nativeBin = agents.claude.bin ?? 结论里的 entrypoint`（`claude-route.ts:107`，native 路线的 `bin` 同值）；
- `version`：路线登记里的版本，退到根结论版本（`claude-route.ts:140-141`）。

写回之后，比对的「后」一次读到的是本次测量值。于是两个触发面首跑必退 69、再跑一次才过：

| 触发面 | 变的指纹项 | 登记时是否写到 |
| :--- | :--- | :--- |
| CLI 自上次探测以来升过级 | `version` | 是（2026-10-24 macOS 实测 2.1.309 → 2.1.310） |
| 盘上没有 claude 结论（全新安装、新建 `.trivium/` 的项目） | `version`（null → 实测）；缺省配置未配 `agents.claude.bin` 时还有 `nativeBin`（null → 实测入口） | 否，本次补登 |

只有探测走进了目录臂（解析出模型、只读旗标非空）才会写回——也就是探测成功、配额已经花掉的那一类运行。EV-251 自动校准跑的就是 `doctor --only claude`，同样撞上。

**零配额核验**（纯函数，`dist/test` 的 `resolveClaudeRoute` 与 `defaultConfig`，脚本 `zero-quota-candidates.mjs`，读数 `zero-quota-candidates-output.txt`）：

| 情形 | 现状（写回） | 候选 B：比对时钉住探测前版本 | 候选 A：首跑引导改用副本 |
| :--- | :--- | :--- | :--- |
| 全新安装，未配 bin | 判变化 | **仍判变化**（`nativeBin` null → 实测入口） | 稳定 |
| 全新安装，已配 bin | 判变化 | 稳定 | 稳定 |
| 升级，盘上 2.1.309、实测 2.1.310 | 判变化 | 稳定 | 稳定 |

既有用例 `claude-structured-probe.test.ts` 那条 doctor 用例给 `agent.bin` 设了值，恰好盖住了 `nativeBin` 这一面；它五轮共用一个配置对象，首轮其实撞上了这条 blocker、只是没断言，第 2～5 轮因写回悄悄变成「盘上已有同版本结论」的场景。

## 2. 修法

- **`probes/claude.ts` 首跑引导改用副本**：块首构造 `cfg = { ...opts.config, probe: { ...opts.config.probe, cli: { ...opts.config.probe.cli, claude: probe } } }`，块内（进入条件那一行除外）全部用 `cfg`——路线解析两处、目录臂入参、`claudeSensitiveGlobsHash` 三处。浅拷贝：`cfg.review` 就是调用方的 `review`，哈希绑定的仍是真实项目配置，既有用例「目录臂拿到的 `sensitive_globs` 与调用方是同一个引用」照样成立。删除写回语句，契约写进注释：`probeClaude` 不改调用方传入的配置。
- **`doctor.ts` 不改逻辑**：比对处加注释写明语义边界（见第 6 节）与上面那条契约；blocker 文案抽成导出常量 `CLAUDE_ROUTE_CHANGED_BLOCKER`，用例按常量断言，文案本身不变。
- 不改：路线指纹的组成与登记格式、预检判据、doctor 时限、`package.json` 版本号。

取 A 不取 B 的理由：B 修不了全新安装（上表第一行）；要修全还得给 `resolveClaudeRoute` 加入口覆盖参数，并且调用方配置仍被改动。A 的语义与 `0e44120a` 之前一致（比对两次都读同一份内存结论）。

## 3. 回归锚

新文件 `test/integration/claude-route-stability.test.ts`，12 格（win32 跳过，理由同兄弟文件：shebang 假 CLI）。每格独立的家目录（`HOME` 钉住、finally 复原）、项目根与 `defaultConfig()`；`probeBins.claude` 注入假 CLI（`--version` 读 `FAKE_CLAUDE_VERSION`）；目录臂注入桩，记下入参路线并返回「Read 已证实」的最小证据，R / N4 格在桩里改环境制造「探测期间」的变化。盘上旧结论不经 `runDoctor` 构造：直接 `probeClaude`（不传 config、不进目录臂）测一份，再照 `doctor.ts` 的登记写法记进 `routes`。

| 格 | 场景 | 断言要点 |
| :--- | :--- | :--- |
| N1 | native 全新安装：无结论、未配 bin | 无该 blocker；目录桩入参路线的 `bin` 与 `nativeBin` 都是实测入口（首跑引导可用）；`routes.native` 按 9.9.9 登记、指纹等于目录臂实测的那条、可被 `claudeProbeForRoute` 消费；只读旗标非空；目录事实落盘；调用方配置与探测前深拷贝相等 |
| N2 | native 版本变化：盘上 9.9.8、实测 9.9.9 | 同 N1 的登记与契约断言；新登记指纹与旧登记不同 |
| N3 | native 版本一致（对照） | 同上 |
| N4 | 边界锚：缺省 native 配置，探测期间改入口二进制、写 `settings.json`、新放 `~/.local/bin/cld` | 无该 blocker、路线照常登记、调用方配置未改；目录事实作废（目录证据带「绑定未取得或发生变化」） |
| P1～P3 | profile `fx` 的全新安装 / 版本变化 / 版本一致 | 同 N1～N3，键 `profile:fx`；P1 目录桩入参路线的 `nativeBin` 为实测入口 |
| R1 | native 开 `settings_env_source`，探测期间改网关 env | 有该 blocker；该路线登记删除、只读旗标清空、目录 deny 字段为空 |
| R2 | profile 文件在探测期间被改 | 同 R1 |
| R3 | 包装器内容在探测期间被改 | 同 R1 |
| R4 | 未配 `profile_bin`，探测期间 `~/.local/bin` 新放一个 `cld`（现找的包装器换了） | 同 R1 |
| R5 | profile 文件在探测期间被删：探测后解析抛出，走比对处的 catch（代码审 GLM-01 补） | 同 R1 |

既有用例改为每轮独立 `defaultConfig()`（仍设 `agent.bin`，保持原场景），每轮补断言无该 blocker。

单跑读数（`node scripts/build.mjs --with-tests` 后，`claude-route-stability`、`claude-structured-probe`、`claude-profile` 三个套件）：代码审前 20 例全过（新 11 + 结构化 6 + profile 3）；补 R5 后新套件单跑 12 例全过。

假 CLI 从不真去读哨兵文件，`headless_read_ok` 恒为否，所以这些格里另有一条「claude headless 读不到文件」的 blocker（`doctor.ts` 的 `claudeSeverity` 第 ④ 条），与本主题无关；用例只断言路线变化这一条的有无。

## 4. 变异

**逐条预跑**（`mutation-names.mjs`，带 `--test-timeout`，支持一条变异改多个文件；规格 `mutation-spec-prerun.json`、`mutation-spec-prerun-msgs.json`，读数 `mutation-names-output.json`、`mutation-names-msgs-output.json`——第一份的失败文案没取到：spec 报告器把断言详情放在「failing tests」段之后，脚本起初只扫了之前那段，修正后对 M1、M3、M4 重跑一次取文案）：

| 编号 | 变异 | 红的格与首条失败断言 |
| :--- | :--- | :--- |
| M1 | 撤销修复：恢复写回、块内改回调用方配置 | 7 红：N1、N2、P1、P2 红在「本次探测自身带来的变化不得判路线变化」；N3、N4、P3 红在「调用方配置不得被改动」 |
| M1b | 同 M1，对 `claude-structured-probe` 套件 | 1 红：那条 doctor 用例（首轮即判路线变化） |
| M2 | 比对恒判稳定 | 代码审前 4 红：R1～R4；补 R5 后 5 红（R5 见下） |
| M2b | 比对处 catch 改判稳定（代码审 GLM-01 补） | 1 红：R5 |
| M3 | 去掉首跑引导（副本里不放本次探针） | 2 红：N1、P1，红在「目录臂拿到的路线入口是本次实测的入口」 |
| M4 | 候选 B：保留写回、比对时钉住探测前版本 | 7 红：**N1、P1 仍红在「不得判路线变化」**（候选 B 修不了全新安装的实证）；N2、P2、N3、N4、P3 过了 blocker 断言、红在「调用方配置不得被改动」 |

M1 与 M2 一正一反，说明回归锚能区分「本次探测自身带来的变化」与「探测期间真实的变化」；M3 守首跑引导。计划 r2 第四节写 M4「N2、P2 绿」不准确：这两格的 blocker 断言确实过了，但同格还断言调用方配置未改，写回让它红在契约上——判别意义不变（候选 B 下仍判变化的只有全新安装两格），按实测更正。

R5 在 M2、M2b 下红的形态与其它 R 格不同：不是断言文案，而是 `runDoctor` 抛出 ENOENT——变异让比对判稳定后走进登记分支，登记时再解析一次路线、读不到被删的 profile 文件。用例照样红，但红在崩溃而非「未判失效」的断言上，如实记下。

补 R5 之后全部重跑：预跑读数 `mutation-names-r2-output.json`（规格 `mutation-spec-prerun.json` 已加 M2b），M1、M1b、M3、M4 的红格与文案与上一轮相同。

**正式装置**（`scripts/mutation-check.mjs`，规格 `mutation-spec.json`）：代码审前 M1、M1b、M2、M3 四条 4/4 咬住（fail 7、1、4、2，读数 `mutation-output.txt`）；补 R5 与 M2b 后重跑 5/5 咬住（M1 7、M1b 1、M2 5、M2b 1、M3 2，读数 `mutation-output-r2.txt`）。M4 要同时改两个文件，正式装置一条只认一个文件，只在预跑里做。每条跑完源码逐字节复原，收尾 `git status` 只剩本次两处改动。

## 5. 全量读数

代码审之前，`npm run check` 前台串行两次（开跑前确认无残留 `node --test`），读数 `check-1.txt`、`check-2.txt`：

| 次 | 用例 | 过 | 红 | 跳过 | 退出码 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 3986 | 3975 | 1 | 10 | 1 |
| 2 | 3986 | 3976 | 0 | 10 | 0 |
| 3（代码审补 R5、文档更新之后，`check-3.txt`） | 3987 | 3977 | 0 | 10 | 0 |
| 4（真实验收读数与文档写入之后，2026-10-25，`check-4.txt`） | 3987 | 3977 | 0 | 10 | 0 |

用例数对合并后基线 3975（`fa09ce3c` 复跑读数）恰多新增 11 例，第 3 次再多 R5 一例。S10 `trivium verify`（`.reviews/claude首跑路线误判/verify/`）：`npm run typecheck`、`npm run build`、`npm test` 三条命令均退 0，测试 3987 / 3977 / 0 / 10，330 秒。第 1 次的 1 红是 `doctor-deadline` 的 I4「兜底：段卡在不经 run() 的 await 上……（stuck）」，红在 `deadline.stuck` 断言：该格 `only: 'agy'`、claude 段不运行，本次改动在这条路径上只多一个模块级常量；300 ms 时限对 300 ms 兜底的竞速对负载敏感。复核：当前工作树单跑 8 次 7 过（红的那次紧跟全量之后），基线 `db876910` 的独立工作树单跑 8 次全过。判为既存的时序偶发红、非本主题引入，未登记 BACKLOG（是否登记由用户定）。

## 6. 已知边界

修复后比对的定义：判的是**探测期间现读环境的几项**变没变——profile 包装器路径（未配 `profile_bin` 时现找）与内容、profile 文件、开了 `settings_env_source` 时的网关 env 摘要。入口与版本是本次探针开头自己测的，由登记按快照重算。以下三条修复前后相同，不是本次新开的口子：

1. **探测中途 CLI 自升级**：路线比对看不见（修复前「后」值同样是探测开头测的）。目录臂窗口内的目录指纹（入口与 native 二进制内容，`adapters/claude.ts:454-465`）能让目录事实作废；落盘的是探测开头测的版本，下一次预检的 `checkCliVersions`（`preflight.ts:481-488`）比对现场版本与探针记录，不一致即判失败并给出校准目标。不另立 BACKLOG 条目（计划审 codex、gemini 明确赞同只登记为边界，glm 未就此提意见）。
2. **native 入口来自内存配置**：探测期间改 `config.yaml`，本轮 doctor 不重读。
3. **缺省 native 配置下比对恒判稳定**（计划审 GLM-01）：未配 `agents.claude.bin`、未开网关 env 时七项都不会在探测期间变，这条 blocker 对该形态不触发；剩下的保护是目录指纹与下一次预检的版本 / 入口核对。回归锚 N4 钉住这条边界，日后加强检测要连同设计 §12 与 Bug 清单一起改。

**Windows 侧没有回归锚**（计划审 GLM-03）：新套件与兄弟套件一样在 win32 跳过。首跑引导本是 Windows 线引入、两平台共用，修复改的是同一段跨平台代码。待下次在 Windows 机器上 claude 升级后或新项目首跑 `doctor --only claude` 时复核：应退 0、无该 blocker、`routes` 按新版本登记。

## 7. 真实 CLI 验收

用户 2026-10-25 批准两格都做（要花配额，按任务要求到这一步先问）。本机盘上已是 2.1.310，真实探针走不到这条路径，所以在 scratchpad 建两个夹具项目、各跑一次真实 `doctor --only claude`。

- **夹具**（`accept-setup.mjs`，零配额，摘要 `accept-setup-output.json`）：两格的共享层都是本仓 `.trivium/config.yaml` 原样复制，都 `git init`。**升级格**的本机层照搬本仓本机层的 `agents.claude`（`bin` 与 `profile_bin`）、`probe.host` 与 `probe.cli.claude`，把根结论与 native 登记的版本改记 2.1.309，并按夹具合并后的配置与 2.1.309 重算 native 登记指纹（照 doctor 的登记写法）——跑前核对 native 登记可被消费、版本 2.1.309。**全新格**的本机层只有注释头：没有 `agents.claude`、没有任何 claude 结论，`nativeBin` 解析为空——正是缺省配置下的全新安装，`version` 与入口两面都会走到。不拷 `probe.auth` / `probe.auth_routes`。
- **入口**（计划审 GLM-02）：夹具目录里直调本次工作树构建的产物 `node 〈仓库〉/skills/dual-critic/scripts/trivium.cjs doctor --only claude --json`，`TRIVIUM_ASSET_ROOT` 指仓库资产根；不经 `.trivium/bin/trivium` 与终端短名（两者指向全局安装副本）。产物 sha256 `8d71188d8d7f22ab33520a39540129979f0d1156c827d06c964b192c87b1afdc`（`accept-bundle-sha256.txt`），内嵌构建标识 `git_head db876910`、`dirty: true`、`inputs_sha256 f5e16bb6…`、构建于 2026-10-24T08:04:52Z（S10 verify 那次构建；之后只改过文档与证据，作用面内的源码未动）。验收时 `claude --version` 仍为 2.1.310。
- **读数**（`accept-readout.mjs` 只读取数，原始输出 `accept-*-doctor.json`，摘要 `accept-*-readout.json`；证据目录用仓库自己的 `scanSecrets` 扫过，零命中）：

| 格 | 时间（UTC） | 退出码 | blockers | 路线变化 blocker | 落盘的 native 登记 | 只读旗标 | 目录 deny |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 升级（盘上 2.1.309） | 2026-10-25 04:46:16～04:50:06（约 230 s） | 0 | 0 条 | 无 | 2.1.310，指纹自洽、可被消费；三条 profile 登记原样保留 | 四项保留 | Read / Grep / Glob 均实测可用，目录指纹落盘 |
| 全新安装（无结论、未配 bin） | 2026-10-25 04:50:37～04:54:04（约 207 s） | 0 | 0 条 | 无 | 2.1.310，入口为现找到的 `~/.local/bin/claude`，指纹自洽、可被消费 | 四项 | 同上——首跑引导让目录臂拿到了实测入口 |

两格各有一条 warning「Claude native 被拒操作留痕未证实……」：这次模型没去调写工具、留痕能力记为未测，与 2026-10-24 修复前那次重跑相同，不拦。

修复前的对照形态（同样情形首跑退 69）有 2026-10-24 的真实首跑留痕（`evidence/macos-unify-20261024/doctor-only-claude-run1.json`）与变异 M1；本次没有拿旧构建在夹具里再跑一遍，免得为已知结论再花一次配额。两个夹具留在会话 scratchpad，不入仓。

## 8. 留痕更正

计划裁决件（`plan/2026-10-24-claude首跑路线误判-revised-claude.md`）GLM-03 一行的理由写了「EV-253 的 Windows 实测还没做」，r2 计划第五节据此要「Windows 实测待办那一条同步加一句指向第 15 条」。这两处不准确：EV-253 的 Windows 实测 2026-10-24 已收口（BACKLOG EV-253、Bug 清单 §3.1 第 12、13 条），没有可挂靠的 Windows 待办条目。实施时改为只在 Bug 清单第 15 条闭合文与本报告第 6 节单列 Windows 残余；计划阶段的裁决件已过闸，原文未改，更正记在这里与代码阶段应答件里。
