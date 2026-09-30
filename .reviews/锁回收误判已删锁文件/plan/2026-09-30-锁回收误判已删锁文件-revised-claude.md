---
schema: trivium.disposition.v1
topic: 锁回收误判已删锁文件
stage: plan
role: claude
kind: revised
run_id: 20260930T021449Z
addresses:
  - 2026-09-30-锁回收误判已删锁文件-codex.md
  - 2026-09-30-锁回收误判已删锁文件-gemini.md
  - 2026-09-30-锁回收误判已删锁文件-glm.md
---

# 裁决：锁回收误判已删锁文件 · 计划双审第 1 轮

> 被审对象：`plan/2026-09-30-锁回收误判已删锁文件-claude.md`（r1，起点 `3e38d29`）
> ｜ 运行：`20260930T021449Z`（约 15 分 35 秒）
> ｜ 结论：codex `request-changes`（重要 2、次要 2）｜ gemini `request-changes`（重要 2、次要 1、吹毛求疵 1）｜ glm `approve-with-nits`（次要 2）
> ｜ 共 10 条：接受 10、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-09-30-锁回收误判已删锁文件-r2-claude.md`；命令 A 不设人工闸门

## 0. 核实记录

- **CODEX-01**：成立。`run-protocol.ts` :1874-1878：`inspectLock` 只核 `run_id`、不核 pid；:1876 `await reclaimStaleLock(…)` 之后 :1877 无条件 `say('已回收主题「…」的锁')`。D3 让 false 结局变多，这条面向用户的出口会失实报成功。
  :745 的 `soft('回收已改记到工作进程名下的主题锁', …)` 标签只在抛错时出现（它是失败播报的前缀），不因返回值失实，只需 F8 措辞改准。
  **另记**：glm 在「认为正确的部分」写「run-protocol.ts:1558-1559/1876-1877 的播报本就以 reclaimStaleLock 返回 true 为条件」，对 :1876-1877 不成立（不是意见条目，不入表，在此更正）。
- **CODEX-02**：成立。`git archive 3e38d29` 的树里没有 X3；漏移植时读数是静默的「0 红」。
- **CODEX-03**：成立。0.5% 级事件 240 次的检出力约 1 − 0.995^240 ≈ 70%；`probe-xproc` 200 轮 42-46 s，加到 600 轮成本约 2 分钟。
- **CODEX-04**：成立。本机 `which -a node` 只有 Node 25（`/opt/homebrew/bin/node`），`package.json` `engines` 是 `>=18`。`FileHandle#stat({ bigint: true })` 与 `FileHandle#readFile` 自 Node 10 起就有，但「API 存在」与「在 18 上跑过」是两回事。
- **AGY-01**：成立。旧复验里「`expected` 非空而 `got === null` 也算相符」是 rename **之后**的容忍；放到预检（rename 之前）会让外部调用方把一份此刻读不出来的锁（例如 worker 正在用非原子 `writeFile` 改写自己的锁，`lock.ts` :48-49 已登记这一形态）当成「就是我复核过的那份」挪走。推到复验同理：rename 之后读 tmp 得 `null`，说明有人正往这个 inode 里写——删它等于删一把正在改写的活锁，放回更保守。
- **AGY-02**：成立。`rename` 放回会顺带移走 tmp，`link` 不会；r1 只写了 EEXIST 与其他错误两格删 tmp。
- **AGY-03**：成立，与 GLM-02 同源（`readLockFile` 各失败格的归属与描述符关闭）。
- **AGY-04**：成立。F11 是两条 `pid_gone`、一条 `unparsable`，r1 §2.2 写「逐项同构」「只有一个进程判了 pid_gone」只对 idx 125 成立。codex 在「认为正确」一节给了同一更正。
- **GLM-01**：成立。D4 的新告警以「回收主题」开头；§5.2 断言④「恰一条」在 R1 命中时会红，r1 没有预定处置分支。
- **GLM-02**：成立。`open` 成功后 `fh.stat` / `fh.readFile` 失败的归属 r1 没写。

**漂移标记**：三份审查都带「审查期间工作树发生漂移」。审查期间我没有写任何文件；工作树里唯一的非本主题改动是用户自己的 `doc/01_requirements/原始需求.txt`（会话开始时就已是 `M`）。三份意见都不依赖该文件，不影响裁决。

## 1. 逐条裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 核实成立：:1877 无条件播报「已回收」，D3 扩大 false 集合后会失实；F8「（与 pid）」掩盖了 :1875 只核 run_id | r2 §3 新增 D7：`run-protocol.ts` :1876-1877 改为按返回值分支播报（沿用 :1558-1562 的两句）；r2 §5.1 加 U11（同进程桩让预检不符，断言播报「未回收」而非「已回收」）；r2 §1 F8 改为分列三处各自的复核条件 |
| CODEX-02 | codex | major | 接受 | 核实成立：旧树无 X3，漏移植的结局是静默「0 红」 | r2 §6.2 装配步骤写明：新测试文件（`lock-cross-process.test.ts`、`lock.test.ts`）拷进旧树再 `--tests-only` 编译，记拷入前后 sha256；旧构建运行输出里断言 X3 用例名出现且计入执行数（正面断言），否则验收判失败 |
| CODEX-03 | codex | minor | 接受 | 核实成立：主判据应放在廉价可扩的探针上，并写明期望与通过判据 | r2 §6.2 主判据改为 `probe-xproc` 两场景各 600 轮（新旧构建各跑），逐项写期望与通过判据；§6.3 的文件级 240 次降为辅助信号，并写明 0 红只把残余率上界压到约 1.2%（95%） |
| CODEX-04 | codex | minor | 接受 | 核实成立：只在 Node 25 上跑过 | r2 §6.6：用 `npx -y -p node@18` 取 Node 18 二进制，在其上跑 `lock.test.js` 与 `probe-inproc.mjs`（新构建）；取不到则如实记录、登记 BACKLOG；r2 §7 LLD §4.3 写明身份三元组的适用范围是本地文件系统（APFS / ext4），网络卷不在支持面内、其上的退化结局是「预检不符 ⇒ 不回收 ⇒ 70」而不是双持有 |
| AGY-01 | gemini | major | 接受 | 核实成立：预检沿用 rename 之后的容忍会让外部调用方挪走正在改写的活锁；推到复验同理 | r2 §3 D3：不传身份时，`expected` 非空 ⇒ 预检与复验都要求内容可解析且 pid 与 `acquired_at` 相符；`expected === null` 保持「内容为 null」；U4b 覆盖「预检时内容读不出」不回收 |
| AGY-02 | gemini | major | 接受 | 核实成立：`link` 放回不移走 tmp | r2 §3 D4：放回无论成功、EEXIST、其他错误，最后都在 `finally` 里删 tmp；U6 加断言「锁目录无 `.stale-` 残留」 |
| AGY-03 | gemini | minor | 接受 | 核实成立 | r2 §3 D1：`readLockFile` 在 `finally` 里关闭描述符；解析失败时 `identity` 与 `mtimeMs` 照给、仅 `content` 为 null |
| AGY-04 | gemini | nit | 接受 | 核实成立：F11 两条 `pid_gone`，「逐项同构」只对 idx 125 成立 | r2 §2.2 改写：idx 125 只有一条 `pid_gone`，入口 A 必在场；F11 有两条 `pid_gone` 一条 `unparsable`，入口 A 在场、入口 B 不能排除——两条入口都修，修法不受影响 |
| GLM-01 | glm | minor | 接受 | 核实成立：残余命中需要预定处置，否则编码时临场放松断言 | r2 §6.3 预定分支：修后 `probe-xproc` 600 轮与文件级 240 次都零命中 ⇒ 断言④维持「恰一条 `pid_gone`」；出现命中 ⇒ 断言④放宽为「恰一条 `pid_gone`，另允许至多一条 D4 残余告警」，频率写进 BACKLOG 的 R1 条目；X1 / X3 场景里没有遗留锁、不会进回收，零告警断言不放宽 |
| GLM-02 | glm | minor | 接受 | 核实成立 | r2 §3 D1：`open` 成功后 `stat` / `readFile` 失败一律并入 `present` 且 `content: null`（`stat` 已成功则 `identity` / `mtimeMs` 照给），保持「读不了 ⇒ 不可解析」；§5.1 加 U10（桩 `open` 返回的句柄 `readFile` 抛 EIO，断言走 `unparsable` 判定、不抛异常） |

## 2. 汇总

- 修法面：D3 预检与复验谓词在 `expected` 非空时收严（AGY-01）；D4 放回后无条件删 tmp（AGY-02）；D1 各失败格与描述符关闭写死（AGY-03、GLM-02）；新增 D7 修 `--cancel` 的失实播报（CODEX-01）。
- 验证面：旧构建移植测试并正面断言 X3 执行（CODEX-02）；主判据换成各 600 轮探针并写明期望（CODEX-03）；Node 18 实跑（CODEX-04）；残余命中的断言处置分支预定（GLM-01）。
- 文档面：F8 与 §2.2 的措辞改准（CODEX-01、AGY-04）；LLD 写明身份三元组的文件系统边界（CODEX-04）。
- 三侧对 §8 五问的独立结论一致：入口 A 的推演成立、`dev:ino:mtimeNs` 在支持面上够用、`missing ⇒ continue` 与今天回收分支同形不构成新活锁、D5 无依赖方、R1 暂缓理由成立。
