# EV-193 进程组采样竞态实验（2026-10-16）

零配额，只在本进程名下派生 `sh`，收尾按组结束，不写任何文件（输出由调用方重定向）。

## 做法

`pgid-race.mjs` 起两个进程：

- **派生方**每 5 ms 以 `detached: true` 派生一个 `sh -c 'sleep 1; : "$0"' <标记>:<序号>`——与桩 `hang_cli` 经 `run()` killTree 拉起审查员 CLI 的形态相同。
- **采样方**不停跑 `/bin/ps -axo pid=,pgid=,command=`，统计命令行含标记的行：pid===pgid 记为组长行，否则记为错配行，并核对错配行的 pgid 是否等于派生方的 pid 或派生方所在的组。标记经环境变量交给采样方，不进它自己的 argv（初版把标记放在 argv 里，错配全是采样方自己，已改）。

## 读数

| 文件 | 时长 | 派生次数 | 采样次数 | 错配行 | 错配行 pgid 等于派生方所在的组 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `run-1.txt` | 30 s | 5174 | 737 | 1 | 当时未记派生方组号（脚本后补此项） |
| `run-2.txt` | 30 s | 5253 | 721 | 0 | — |
| `run-3.txt` | 90 s | 15967 | 2195 | 1 | 1（pgid 26493 = 派生方组号） |

macOS 27.0.1，Node v25.2.1。

## 结论

`ps` 的组号与命令行不是同一时刻取的。detached 子进程在 `setsid` 之前沿用父进程的组号；采样落在这个窗口、读命令行时它已 exec 成带标记的 `sh`，就出现一行「带标记、组号却是派生方的组」。I6 里派生方是 detached 的 worker（组号 = worker pid），所以误采到的是 worker 的组——与 10-16 失败读数里那个早于两个 sh 的 13815 吻合。status.json 由 worker 在派生当时按 `child.pid` 记下，不经 `ps`，记录无误。

修法见 `test/helpers/proc.ts` 的 `leaderGroupsWithMark` 与报告 [`REPORT_2026-10-16_m12_batch0.md`](../../REPORT_2026-10-16_m12_batch0.md)。
