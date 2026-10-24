# 双平台统一测试报告（macos 与 windows 合并为同一套代码，1.3.0）

日期：2026-10-24。环境：macOS（darwin）+ Node（Homebrew）。主设计 v1.3.175，BACKLOG EV-253。
本次按用户拍板不走双审流水线：提交前自审补丁，macOS 全量串行跑两次；Windows 全量由用户在 Windows 机器上跑。

## 1. 范围与做法

两分支自 `faae0483` 分叉：macos 16 个提交，windows 20 个提交。直接合并两分支头有 54 个冲突文件，
其中大半来自两边各自实现的多轮评审。windows 的多轮评审全部在它最后一个提交 `3c37ccd1` 里，平台工作都在它之前，
所以先把 macos 与 `24ccc999`（windows 倒数第二个提交）合并解决冲突，只剩 10 个冲突文件；
最终的合并提交仍以 windows 与 macos 两个分支头为父提交，`3c37ccd1` 里与多轮评审无关的只有版本号一项，手工补齐。

| 方面 | 取舍 |
| :--- | :--- |
| 多轮评审 | 采用 macos 的 EV-247（含 EV-248、EV-250），windows 1.3.0 那套不进树，择优理由见主设计 v1.3.175 |
| 轮次上限配置项 | 从 windows 吸收 `review.plan_rounds / code_rounds`，新起链时「旗标 → 配置 → 缺省 3」，记来源 |
| Windows 平台层 | 整体采用 windows |
| EV-251 doctor 时限 | macos 实现保留，补 win32 实现（父链认组、按派生时刻认孤儿、同号判复用） |
| 共享配置 | 取 macos 值；Windows 网关项挪到本机 `config.local.yaml`（部署手册 §1a） |
| 版本与产物 | 版本 1.3.0（三处一致）；`releases/` 二进制移出仓库 |

## 2. 全量读数（macOS，前台串行，每次开跑前确认无残留 `node --test` 进程）

| 时点 | 用例 | 通过 | 失败 | 跳过 |
| :--- | ---: | ---: | ---: | ---: |
| 合并前 macos 基线 | 3924 | 3922 | 0 | 2 |
| 合并后第一次 | 3955 | 3937 | 8 | 10 |
| 按根因修完 5 格后 | 3955 | 3945 | 0 | 10 |
| 四批改动完成后 | 3971 | 3960 | 1 | 10 |

跳过的 10 例里 8 例是只在 Windows 上跑的用例，另 2 例是基线就有的跳过。
最后一行的 1 例失败是第 2 批漏改的一处断言（`plan-final-gate` I8 按两个字段深比较轮次链），补上来源字段后单跑 8/8 通过。
写完本报告后的两次收口全量读数记在提交说明里。

## 3. 合并后在 macOS 上红的格与根因

windows 线是在 Windows 上开发的，从未在 macOS 上跑过全量；下面几格都是 windows 线的改动在 POSIX 上的问题。

| 用例 | 根因 | 处置 |
| :--- | :--- | :--- |
| `effort-wiring` P2、P3、P4 | 1.2.7 起夹具的 `CODEX_HOME` 隔离家只有 qwen 一份 profile；这组在 Windows 上整文件跳过、没撞上，macOS 上原先靠开发机真实 `~/.codex` 恰有 deepseek 才绿 | 夹具辅助新增 `fixtureCodexHomeWith(名单)`，P 组显式给含 deepseek 的家；夹具家改同步写入，消掉「异步写未完成就被子进程读」的竞态 |
| `canonical-crossform`「进程已不在时维持 pid_gone」 | 用 pid -1 当「不存在的进程」，而 POSIX 上 `kill(-1, 0)` 指本用户能发信号的全部进程，探活恒为真 | 改用一个同步跑完的子进程的 pid |
| `retention`「项目桶读不了要记账」 | windows 线把「读不了的桶」从 chmod 0 目录改成普通文件占位，又在 win32 上跳过这格；被测函数先按 `isDirectory` 跳过非目录，文件占位在 POSIX 上走不到被测分支 | 复原 chmod 0 目录构造，win32 上照旧跳过 |
| `scratch-guard` G1 | windows 线新增的两个测试文件有三处裸 `mkdtemp` | 改经 `scratchDir` |
| `doc-archive-index` | 两边新增的报告条目合并后不按日期排序 | 调整次序 |

## 4. 合并中发现的产品缺陷：归档登记路径

提交时 pre-commit Hook 报 Windows 移植主题的 7 份审查工件「已丢失」，而文件都在。原因是 Windows 上写的
`run.json.artifacts[].path` 用了原生分隔符（`主题\code\_meta\…`），macOS 上 `path.join` 把反斜杠当成文件名的一部分。
同一份归档换平台读就会误报，会拦下两个平台之间任何一次提交。

修法：写入端经 `writeRunMeta` 一律落 `/` 形态；读取端（`readRunMetaDetailed`、`listRecordedRuns`）把反斜杠读成 `/`，
盘上原件不改。主题名禁止 `/` 与 `\`，阶段目录与文件名都由编排器生成，归一不会误伤合法路径。
自审时又查出同源的一处：`checkStageArtifacts` 用 `path.relative` 现算路径去查登记集合，登记统一成 `/` 后，在 Windows 上现算的反斜杠会让每份审查件都被报「未登记」，同样改为先归一再比；
`archive.test.ts` 里造登记集合的那一格也改成与真实调用方同形的 `/`。
新增 `artifact-path-posix.test.ts` 5 例：辅助函数、写入端落盘形态、旧登记读成 `/` 且原件不改并能过提交锚核对、旧登记的审查件不被报未登记、工件真删了照样报丢失。

**未验证**：会话里的 pre-commit Hook 调用的是本机全局安装副本，修复要重装后才对 Hook 生效。

## 5. 新增与改写的用例

| 文件 | 内容 |
| :--- | :--- |
| `round-verdict.test.ts` | R21～R25：上限取值顺序、续链不读配置并沿用来源、配置键 1～10 校验、run.json 来源字段校验、命令 A 播报生效值；R10、R11、R19 按新的来源字段改写 |
| `review-loop.test.ts` | L12：本机层配置定上限并记 `config` 来源，旗标优先；L1、L4、L6、L9 断言补来源 |
| `doctor-deadline.test.ts` | I13：台账 pid 活着而身份核对为不同进程即补删，同一进程、判不了、旧台账不碰；I14：本进程台账带规范化启动时刻 |
| `win-section-snapshot.test.ts` | W1～W4：Windows 快照纯函数，两平台都跑 |
| `artifact-path-posix.test.ts` | 见第 4 节 |
| `probe-section`、`doctor-deadline`、`doctor-deadline-cli`、`meta-task-write` | 依赖 POSIX 进程组、shebang 假 CLI、跨进程 SIGTERM 或 chmod 000 的格在 win32 上带理由跳过 |

## 6. 没有验证的部分

- **Windows 上的一切行为**。第 3 批的 win32 分支（树杀组长或孤儿、SIGBREAK、`.cmd` 重跑命令、台账身份核对）在 macOS 上只有类型检查与纯函数用例覆盖。
  待办：在 Windows 机器上 `npm ci && npm run check`，并跑一次 `doctor --deadline-s 60`，核对到点退 76、无残留进程、临时目录已删。
- **真实 CLI 与配额**。本次不花配额。合并后 claude 路线指纹多了 `settingsEnvSha256` 键，两平台各需重跑一次 `doctor --only claude`。
- **后台安全审查的两条**（均在合并进来的 Windows 线代码里）：`.cmd` 垫片参数经 cmd.exe 重新解析可拼出额外命令，已改为含 cmd 元字符即拒绝拉起，判定函数有两平台用例 `cmd-shim-args.test.ts`，拒绝路径本身只在 win32 上走、未实测；claude 网关凭据经 `--settings` 内联进子进程命令行，改法要用真实 claude 验证受限模式，本次只登记（Bug 清单 §3.1 第 14 条）。
- **`doctor-unused-overrides` U2** 用 shebang 假 CLI，分叉前即如此、windows 线未加跳过，本次未改，在 Windows 上的结果以那边的全量为准。
