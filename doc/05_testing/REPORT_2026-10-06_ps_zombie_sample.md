# 僵尸排除的录制样本单测 · 实施报告（EV-169）

> - **日期**：2026-10-06
> - **主题**：`僵尸排除的录制样本单测`（M11 前待办批次第 3 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`865a666`（`main`；工作树另有用户自己的改动 `.trivium/config.yaml`、`doc/01_requirements/原始需求.txt`，不随本题提交）
> - **证据目录**：`doc/05_testing/evidence/ps-zombie-sample-20261006/`
> - **配额**：零配额

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. `src/trivium/util/exec.ts` :678 `processGroupMemberCount(pgid)`：跑 `/bin/ps -axo pgid=,stat=`，逐行按 `^\s*(\d+)\s+(\S+)` 取组号与状态，组号相等且状态**不以 `Z` 开头**才计数；`ps` 退非零返回 null。解析与取数写在一个函数里，没有可单独喂样本的入口。
2. 两个调用点：`status.ts` `judgeCliGroup` :312（缺省的 `memberCountOf`，组长确认不在后按非僵尸成员数判 `gone` / `orphaned`）、`run-protocol.ts` :849（`--cancel` 按记录结束 CLI 后报「组员还在」）。
3. 现有用例只覆盖「有非僵尸成员」与「组已空」（`scrub-admission.test.ts` :114 起），EV-165 的 `Hz` 格经 `memberCountOf` 注入绕开了本函数——僵尸排除这一行没有任何用例咬住（BACKLOG EV-169）。

### 修法

1. 把解析抽成纯函数 `countLiveGroupMembers(psOutput, pgid)`（导出），`processGroupMemberCount` 只负责跑 `ps` 与「取不到为 null」，计数交给它；判据逐字不变。
2. **录制真实样本**（本机 macOS，零配额），收进 `test/fixtures/ps-samples/`：
   - 样本一「组内有僵尸」：detached 起 `sh -c 'sleep 0 & exec sleep 30'`——`sleep 0` 退出后 exec 出来的 `sleep 30` 不回收它，组里一个 `Ss` 组长加一个 `Z`；
   - 样本二「组里只剩僵尸」：detached 起 perl 父进程，fork 出的子进程 `setsid` 自成一组后立即退出，父进程循环 sleep、从不 wait——子进程那一组里只剩一个 `Z`，父进程在另一组。
   两份都存整份 `ps -axo pgid=,stat=` 原始输出与说明（组号、`pid/ppid/pgid/stat/comm` 明细、录制时刻）。录制脚本放证据目录。
3. 单测喂样本：样本一该组计 1、样本二该组计 0（父进程组计 1）、组号前缀不误匹配；另加一格 macOS 实机格：用样本二的同一造法起一个只剩僵尸的组，直接调 `processGroupMemberCount` 断言为 0（无 perl 或非 macOS 跳过）。

### 不改的边界

- 判据（`stat` 以 `Z` 开头即僵尸）、两个调用点、`ps` 参数与超时不改；`test/helpers/proc.ts` 的 `groupMemberCount` 不动。
- 不研究其它平台的 `ps` 输出差异（样本只代表本机 macOS 的 `ps`）。

## 1. 改了什么

1. `src/trivium/util/exec.ts`：新增导出纯函数 `countLiveGroupMembers(psOutput, pgid)`（原循环原样搬入）；`processGroupMemberCount` 跑完 `ps` 后改调它。判据、`ps` 参数、10 s 超时、退非零返回 null 都不变。
2. `test/fixtures/ps-samples/`（新）：`group-with-zombie.txt`（862 行）、`only-zombie.txt`（858 行）为整份 `ps -axo pgid=,stat=` 原始输出，各配一份 `.meta.json`（录制时刻、目标组号、该组原始行与 `pid/ppid/pgid/stat/comm` 明细）。样本只含组号与状态两列，不含命令行。
3. `test/unit/ps-group-members.test.ts`（新）：S1 组长 + 僵尸计 1；S2 只剩僵尸计 0、父进程组计 1；S3 组号前缀与不存在的组计 0；L1（macOS 实机）只剩僵尸的组经 `processGroupMemberCount` 计 0、父进程组计 1。S1、S2 先自证样本形态（该组的原始行），免得样本被换而用例照绿。L1 的夹具进程 argv 带 `trivium-ev169-test` 标记，收尾按组 SIGKILL 并等退出。
4. 证据目录：两份录制脚本 `record-ps-zombie.mjs`、`record-ps-only-zombie.mjs`（只读系统状态，删除动作只对本脚本刚拉起的子进程组）。
5. 文档：主设计 v1.3.97；BACKLOG EV-169 结案；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 录制 | 样本一：组 18532 两行 `Ss`、`Z`（`sleep` 与 `<defunct>`）；样本二：组 17431 只有一行 `Z`，父进程 perl 在组 17200（`Ss`）。录完核过三组均已不在 | `test/fixtures/ps-samples/*.meta.json` |
| 类型检查 | 退 0 | 全量内含 |
| 新用例与 `scrub-admission` 单跑（先 `build.mjs --with-tests`） | 19/19（新增 4） | `suite-1.txt` |
| 变异逐条预跑（带 `--test-timeout`） | M1 红 3（S1、S2、L1）；M2 红 2（S3、L1）；M3 红 1（L1） | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 3/3 咬住（M1 fail 3、M2 fail 1、M3 fail 1）；M2 在装置里 fail 1：装置只记 fail 数，按判据推得是 S3（S3 在 M2 下必红；L1 在 M2 下红不红取决于当时有没有组号前缀相同的进程） | `mutation-output.txt`、`mutation-spec.json` |
| 全量第 1 次 `npm run check` | 2845 / 2843 / 0 / 2，退 0（较起点 2841 多新增的 4 格） | `check-1.txt` |
| 全量第 2 次（串行） | 2845 / 2843 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 全量 1 期间 1（`trivium-index-`）、全量 2 期间 0、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

变异表：

| 编号 | 变异 | 结果 |
| :--- | :--- | :--- |
| M1 | 不排除僵尸 | 红 3：S1、S2、L1 |
| M2 | 组号按字符串前缀匹配 | 预跑红 2：S3、L1；装置 fail 1（推得为 S3） |
| M3 | `processGroupMemberCount` 不经计数函数、数全部行 | 红 1：L1（样本格只测纯函数，取数侧由实机格管） |

## 3. 提交前自审

- 注释与文档：`countLiveGroupMembers` 文档块说抽出的理由是喂录制样本；BACKLOG 结案记要订正原登记「真实僵尸态难可靠构造」——那指的是靠组长退出后等回收的形态，「父进程在组外且不 wait」的造法是稳定的，并据此加了实机格。
- 断言范围：两个调用点与既有用例不动；新格只断言计数结果。
- 原先拟的一条「僵尸判据只认完全等于 `Z`」变异，录制样本里的僵尸恰是裸 `Z`、预计存活，不放进装置；`Z+` 一类带后缀的状态本题没有录到，不另造合成样本。
- 护栏：新用例不建临时目录；实机格起的进程按组收尾。
- 过程：变异装置跑完后、全量第 1 次刚开始时改过本报告两句措辞（把「装置里只红 S3」改为「装置只记 fail 数，按判据推得是 S3」），属于全量运行中改文档；只动新报告的文字，两次全量均全绿。
