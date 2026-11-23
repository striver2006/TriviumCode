# 1.3.7 Windows 发版现场读数与取证（2026-11-23）

执行机：Windows 开发机 `D:\Work\TriviumCode`，OS 10.0.26300、16 逻辑核、Node v22.23.2、Git 2.54.0.windows.1。
源码基线：`feat/vscode-extension` 收口提交 `237230af`（快进合入 main），发版登记提交在其上。

## 一、全量两轮

| 轮次 | 命令 | 读数 | 红格 |
| --- | --- | --- | --- |
| 1 | `npm run check`（输出经 `tail -30` 管道，退出码被管道掩盖） | 3176 项：3127 过、5 红、44 跳过（531.6 s） | 明细被截断未留档（教训：发版全量不要接管道） |
| 2 | `node scripts/run-tests.mjs "dist/test/**/*.test.js"`（不截断） | 3176 项：3129 过、3 红、44 跳过（549.5 s，退出码 1） | EV-160 I1、EV-160 I5（heartbeat-threshold-warning）、ISSUE-08 实验组（win-job-escape） |

轮 2 红格原文：

```text
not ok 363 - EV-160 I1：阈值 2 s ⇒ --start 退 0、warnings 恰一项「失联阈值」，worker 照常拉起
not ok 367 - EV-160 I5：人读模式 --start 逐条打印警告行
not ok 607 - ISSUE-08 修复：WMI 中继派生的 worker 不进 Job，通道收杀后存活并持续心跳
```

## 二、单跑复核（每文件两轮）

| 文件 | 两轮读数 | 形态 |
| --- | --- | --- |
| heartbeat-threshold-warning.test.js | 均 6 项 3 过 3 红（31.9 s / 29.7 s） | I1/I2/I5 红，`--cancel` 退 69：`取不到工作进程 <pid> 的启动时刻（进程枚举未返回），判不了它是不是 status.json 记录的那个工作进程：本次不取消……69 !== 0` |
| win-job-escape.test.js | 均 2 项 1 过 1 红 | 实验组红：`worker 应不在任何 Job（WmiPrvSE 承载的中继派生），实际 before=ALIVE_IN_JOB + 'ALIVE_IN_JOB' - 'ALIVE_NO_JOB'`；对照组（直拉必死）绿 |

不走红格路径的 I3（预检）/I4（同步 review）/I6（finished_inline）恒绿——问题锁定在 `--start` 后立即 `--cancel` 的时序与 Job 断言。

## 三、EV-263 根因取证（cancel 保守竞态被中继时延放大）

真实 bundle + 桩起一轮 `review --start`（heartbeat_stale_s: 2），在 worker 存活窗内做 kill(0) 与完整 WMI 枚举（与 `platform.ts` 的 ENUM_COMMAND 同文），再跑 `--cancel`：

```text
START_CODE=0 RUN=20261123T044752Z PID=15404
t0 kill0=alive
t0 enum code=0 ms=869 rows=512 pidRow=["15404,7584,2026-11-23T04:47:54.645235Z\r"]
t1 kill0=alive
t1 enum code=0 ms=870 rows=507 pidRow=[]
t2 kill0=ESRCH
CANCEL_CODE=0
运行 20261123T044752Z 已处于终态（success），无需取消。
```

判读：

- t0：worker 活、枚举列得出（含规范化启动时刻）——身份比对机制本身工作正常。
- t1：kill(0) 判活在前、~0.9 s 的枚举快照在后，worker 恰在两者之间退出 ⇒ 枚举缺 pid ⇒ `winProcessCreation` 返回 null ⇒ `recordIdentityOf` 判 `unverifiable` ⇒ `--cancel` 退 69。这正是 `exec.ts` `recordIdentityOf` 注释登记的既设竞态（「进程恰在 kill(0) 与 ps 之间退出时因此判 unverifiable（保守一侧），下一次判定即得 different」）。
- 链路成因：ISSUE-08 中继（powershell 冷启 + node 中继 + spawn）让 `--start` 晚 ~2.5 s 返回；桩 worker 寿命 ~2 s，cancel 到达时几乎总在死亡窗口。1.3.2 期直拉派生、`--start` 早退，同一文件单跑绿（发布检查报告 1.3.2 Windows 侧现场②）。
- 产品侧安全：第二次 `--cancel` 即退 0（上例 CANCEL_CODE=0，终态无需取消）；真实 worker 活分钟级，窗口命中率可忽略。

改法方向（登记不随本版改）：`startAndCancel` 对 69 做一次有界重试，或改断言终态收尾。

## 四、EV-264 根因取证（OS 构建差异：「不在任何 Job」断言过严）

手工复刻 `win-job-escape` 实验组（同一 harness.ps1、同一 winRelay 通道）：

```text
harness code= 0
OUTCOME: assigned=True pid=52080 before=ALIVE_IN_JOB after=ALIVE_IN_JOB
channel: wmi-escape
beat lines: 24 last: tick 7120
```

判读：

- `assigned=True`：父进程真的被 assign 进收杀 Job，夹具成立（对照组两轮绿互证）。
- `channel=wmi-escape`：中继成功、未静默回退直拉。
- `after=ALIVE_IN_JOB` 且心跳持续 7 s+：**夹具的收杀 Job 关闭后 worker 仍存活并持续心跳——ISSUE-08 的修复语义（逃出收杀 Job）成立**。
- 红格只红在 `before`：本机 OS 构建 26300 上 WMI 服务宿主自身把中继后代圈进服务侧 Job，`IsProcessInJob(∞)` 层面「在任何 Job」为真，但那不是收杀 Job。1.3.5 收口时（2026-10-30，同机）该格绿，推测其间系统更新改变了 WmiPrvSE 侧的 Job 归属（未回溯实测）。

改法方向（登记不随本版改）：断言改为「不在夹具的收杀 Job / 关闭后仍存活并持续心跳」。

## 五、发布物

正式包 `npm run release` 从干净工作树打出（`TriviumCode-1.3.7-windows-x64.zip` + `.sha256`），解压目录跑 `doctor --selftest` 14/14。来源提交、构建指纹与 sha256 以 `releases/1.3.7/` 入库副本与包内 `发布信息.json`、`文件校验.json` 为准。
