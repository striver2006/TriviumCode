# sh / dash 补测与 pty 模式修复 · 实施报告（EV-101、EV-156）

> - **日期**：2026-10-06
> - **主题**：`sh/dash 补测与 pty 模式修复`（M11 前待办批次第 6 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`e79e61d`（`main`；工作树另有用户自己的改动 `.trivium/config.yaml`、`doc/01_requirements/原始需求.txt`，不随本题提交）
> - **证据目录**：`doc/05_testing/evidence/sh-dash-and-pty-20261006/`
> - **配额**：零配额（外壳探针只跑 `echo`；pty 探针只包装 `/bin/echo`、`/usr/bin/tty`、`/bin/sh -c`；不拉起任何审查员 CLI）

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. **EV-101**：主设计 §11.1（:3353）写「判据外壳无关，取各外壳拼写的并集（实测范围 = zsh 5.9 / bash 3.2.57；`SUBSHELL_RE` 还接受 `sh` / `dash`，那两种未测）」；`src/trivium/adapters/base.ts` :477 `SUBSHELL_RE` 接受 `zsh|bash|sh|dash`。EV-79 证据 `ev79-shell-redirect-20260922/probe-redirect-operators.out.txt` 只有 zsh 全表与 bash 4 行对照。本机 `/bin/sh` 经 `/private/var/select/sh` 指向 `/bin/bash`（3.2.57，posix 模式），`/bin/dash` 存在。
2. **EV-101 补测已做**（动手前、零配额，`probe-redirect-sh-dash.sh` / `.out.txt`）：判据判「fd 操作、不取目标」的那一族（`>&2`、`>& 2`、`2>&1`、`1>&2`、`>&-`、`2>&-`、`>& -`、`2>& 1`、`2>& -`）在 sh 与 dash 下**一格都不建文件**（rc 0 或 1）——「并集」对这一族成立，EV-101 担心的漏检形态不存在。**但撞出了另一个缺口**：带 `!` 后缀的拼写（`>! X`、`>>! X`、`>&! X`、`&>! X`、`>&!2`）在 zsh 下写 `X`，在 bash / sh / dash 下写的是名为 `!` 的文件（`>&!2` 建出 `!2`），多数 rc=0；判据（`redirect-operator-matrix.mjs`：`>! f` → `F:/tmp/o.txt`）只取 `X`。`X` 在项目外而实际写到项目内的 `!` 时，文本判据会按「项目外写入不算失守」放过（§11.1 :3357）——指纹比对那一层仍兜得住。这一支 bash 也有，EV-79 的 bash 对照没测到。
3. **EV-156**：`src/trivium/util/exec.ts` `run()` 的 pty 分支在 macOS 上拼 `script -q /dev/null <bin> <args…>`，stdio 恒为 `['pipe','pipe','pipe']`。零配额实测（`probe-pty-stdin.mjs` / `.out.txt`）：stdin 为管道时 BSD `script` 立即退 1（`script: tcgetattr/ioctl: Operation not supported on socket`），被包装的命令根本没跑；stdin 为 `ignore`（/dev/null）或继承时退 0，被包装的 `/usr/bin/tty` 打出 `/dev/ttys…`——拿到了伪终端。但输出首部多出 `^D\b\b`（script 读到 stdin 的 EOF 后往伪终端送 EOF，被回显），且伪终端把 `\n` 改成 `\r\n`（`probe-pty-eof-echo.mjs`：四种内层命令各 20 次，`^D\b\b` 80 次全在首部；有换行的三种 60 次全是 `\r\n`）。调用方只有 agy 适配器（`adapters/agy.ts` :114 `pty: opts.pty`，取 `probe.agy.pty_required`），它按流解析 stdout，首部那 4 个字符会弄坏第一行。本机 `pty_required: false`。

### 修法

1. **EV-101**：补测落证据（已做）；设计 §11.1 那句改写实测范围（加 macOS `/bin/sh` 与 dash）、写明 fd 族成立，并写明 `!` 后缀拼写这一支并集不成立、指向新登记的 EV-219。**判据不改**——那是改写判据，另登 EV-219 等拍板或等触发（与 EV-96 / 99 / 100 / 102 同族：「下次集中改 codex 写判据」）。
2. **EV-156**：只改 BSD `script` 分支（`process.platform !== 'linux'`）：stdin 改 `ignore`；stdout 经新导出的纯函数 `ptyOutputNormalizer()` 还原——去掉首部恰为 `^D\b\b` 的 4 个字符、`\r\n` 还原为 `\n`，两者都处理跨块边界（`\r` 落在块尾、`^D\b\b` 被拆在两块里）。`RunOptions.pty` 文档块写明：BSD 下 stdin 恒为 /dev/null（`stdin` 选项不生效）、被包装命令的 stderr 经伪终端并进 stdout。
3. 用例：`ptyOutputNormalizer` 的分块单测；macOS 上真跑 `run(…, { pty: true })`（`/bin/echo`、`/usr/bin/tty`、`onStdoutLine` 逐行不带 `\r`），非 macOS 跳过。

### 不改的边界

- 判据（`base.ts`）不改；Linux 的 util-linux `script -c` 分支不改（未在 Linux 上测）。
- 不删 pty 路径、不改 `pty_required` 探针与字段（删路径属改契约）。
- **未在真实 agy 上验证**（花配额，且本机 agy 不需要 pty）：pty 下 stderr 并进 stdout，agy 适配器按 stderr 判 `printTimeoutWarned` 那一格在 pty 模式下会看不到——如实记进 BACKLOG 结案记要，不在本题改适配器。

## 1. 改了什么

1. `src/trivium/util/exec.ts`：
   - 新增导出 `PTY_EOF_ECHO`（`^D\b\b`）与纯函数 `ptyOutputNormalizer()`（`push` / `flush`，见 §0 修法 2）；
   - `run()` 新增 `bsdPty = pty && process.platform !== 'linux'`：这一支 stdin 给 `'ignore'`，stdout 数据先过还原器再进 `appendOut`，收尾（`finish`，逐行回调冲刷之前）吐出还原器扣住的余量；Linux 分支与非 pty 路径不变；
   - `RunOptions.pty` 文档块补三条事实（stdin 不生效、首部回显与 `\r\n`、stderr 并进 stdout）。
2. `test/unit/pty-run.test.ts`（新）：N1～N3 直测还原器（首部回显、跨块的回显与 `\r`、正文中间同样字符与孤立 `\r` 原样保留、只有半截回显时原样吐回）；R1～R4 在 macOS 上真跑 `run(…, { pty: true })`：`/bin/echo` 输出与非 pty 相同、`/usr/bin/tty` 打出 `/dev/ttys…`、逐行回调不带 `\r` 且 stderr 并进 stdout、以孤立 `\r` 收尾时不丢字符；非 macOS 跳过。
3. 证据：`probe-redirect-sh-dash.sh` / `.out.txt`（EV-101）、`probe-pty-stdin.mjs` / `.out.txt`、`probe-pty-eof-echo.mjs` / `.out.txt`（EV-156）。
4. 文档：主设计 §11.1 并集句、v1.3.100；BACKLOG EV-101、EV-156 结案，另登 EV-219；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| sh / dash 补测 | fd 族 9 格 × 2 外壳：全部不建文件（rc 0 或 1）；`!` 后缀族：sh 下 `>! p2.txt`、`>>! p4.txt`、`>&! t2.txt`、`&>! t4.txt` 建出 `!`、`>&!2` 建出 `!2`，均 rc=0；dash 下 `>!`、`>>!` 建出 `!`（rc=0），`&>!` 建出 `!` 但 rc=127，`>&!` 一族语法错 | `probe-redirect-sh-dash.out.txt` |
| BSD script × stdin | pipe：rc=1、`tcgetattr/ioctl: Operation not supported on socket`、命令没跑；ignore / 继承：rc=0、`tty` 打出 `/dev/ttys015` | `probe-pty-stdin.out.txt` |
| EOF 回显位置 | 4 种内层命令各 20 次：`^D\b\b` 80 次全在首部、无多次；有换行的 3 种 60 次全是 `\r\n` | `probe-pty-eof-echo.out.txt` |
| 类型检查 | 退 0 | 全量内含 |
| `pty-run` 单跑（先 `build.mjs --with-tests`） | 7/7（全为新增） | `suite-1.txt` |
| 变异逐条预跑 | M1（stdin 退回管道）红 4：R1～R4；M2（stdout 不还原）红 4：R1～R4；M3（不去首部回显）红 6：N1、N2、R1～R4；M4（收尾不吐余量）红 1：R4 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 4/4 咬住 | `mutation-output.txt`、`mutation-spec.json` |
| 全量第 1 次 `npm run check` | 2853 / 2851 / 0 / 2，退 0（较起点 2846 多新增的 7 格） | `check-1.txt` |
| 全量第 2 次（串行） | 2853 / 2851 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 全量 1、全量 2 期间各 1（均为 `trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

## 3. 提交前自审

- 注释与文档：`ptyOutputNormalizer` 文档块写的是「实测 80 次全在首部」，没有说成「保证在首部」；只认首部、正文中间同样字符不动，有 N3 钉住。设计、BACKLOG 都写明未在真实 agy 上验证，以及 pty 下 stderr 并进 stdout 对 agy `printTimeoutWarned` 的影响。
- 断言范围：既有用例一条未改；非 pty 路径的行为没有变化（R1 顺带比对了非 pty 输出）。
- `stdin` 选项在 BSD pty 下静默不生效：全仓 `pty: true` 的调用方只有 agy 适配器，它不传 `stdin`；文档块已写明。
- 护栏：新用例不建临时目录；拉起的只有 `script` 包装的系统命令，随命令结束退出。
