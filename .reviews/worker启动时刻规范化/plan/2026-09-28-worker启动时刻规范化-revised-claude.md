---
schema: trivium.disposition.v1
topic: worker启动时刻规范化
stage: plan
role: claude
kind: revised
run_id: 20260928T110842Z
addresses:
  - 2026-09-28-worker启动时刻规范化-codex.md
  - 2026-09-28-worker启动时刻规范化-gemini.md
  - 2026-09-28-worker启动时刻规范化-glm.md
---

# 裁决：worker启动时刻规范化 · 计划双审第 1 轮

> 被审对象：`plan/2026-09-28-worker启动时刻规范化-claude.md`（r1）
> ｜ 运行：`20260928T110842Z`（约 12 分钟）
> ｜ 结论：codex `approve-with-nits`（次要 3）｜ gemini `approve-with-nits`（次要 2、吹毛求疵 1）｜ glm `approve-with-nits`（次要 2、吹毛求疵 1）
> ｜ 共 9 条：**接受 8、驳回 1**（AGY-03）；定稿为 `2026-09-28-worker启动时刻规范化-r2-claude.md`
> ｜ 命令 A 不设人工闸门

## 0. 核实记录

- **CODEX-01**：成立。自本主题起规范化形态是 status.json 与锁文件里的比对基准，且新读者「有就只比它」；若日后就地改了取法（旗标、环境、渲染），旧版规范化写下、新版读的记录会**同环境也全判不是同一进程**，方向是最坏的一侧。计划没有把这条写成契约。
- **CODEX-02**：成立。b 格断言的强度依赖「W、R 两个环境的缺省形态确实不同」；`fr_FR` / `de_DE` 区域未安装时 libc 会回退，两者可能同形，断言静默变真。U16 用「缺省的随之变化」那条断言把前提做成了可执行事实，本主题各格应照做。
- **CODEX-03**：成立。「活进程 + 规范化值不符」只在 C7 有一格；C4（回收锁）、C2（放行抹除）、C3（算不算活着）三处后果更重，却没有各自的直接格。
- **AGY-01**：成立（手改形态）。`processStartTime` 输出经 `trim()`（`util/exec.ts` :537），而 r1 的 `canonicalStartOf` 判非空后返回原值；手改带首尾空白时会误判「不是同一进程」，方向是放行抹除 / 回收。返回 `trim()` 之后的值无副作用。
- **AGY-02**：成立。`processStartTime` 经 `run()`，派生失败走 `'error'` → 以 null 兑现，今天实际上不 reject；但 `processStartTimes` 用 `Promise.all` 时契约没写明，日后任一路改成会抛就整体 reject。r1 §5.1 U10 引了第三参而 §4.3 签名没列，属实。
- **AGY-03**：**不成立**。`processAlive` 在进程活着时先取启动时刻、再判期望值是否为假（`util/exec.ts` :514-515），传 null 并不省掉那次 `ps`。要省只能在 `sweepDeadRunningGates` 里改用裸 `kill(pid, 0)`——那是性能改动、与 EV-158 无关，本主题不做；也不值得登记（会话启动每个 running 闸门一次 `ps`，量级可忽略）。
- **GLM-01**：成立。第一次新 `--start` 回收遗留锁之后写下自己的活锁，第二次必退 70，A4 照字面写一格必落空。
- **GLM-02**：成立。PROTOCOL 没有 status.json 字段表，`cli` / `lost` 都是在 :360 以「对外 JSON 形状的加法」一句带出。
- **GLM-03**：成立。「未观察到 `'exit'` ⇒ pid 不会被复用」只在单一 JS 时刻成立，`Promise.all` 的两次 `ps` 之间事件循环可以推进；实际风险可忽略，但「一定」会被当成绝对不变量引用。
- **附（codex 盲区段提到、未列为意见）**：`startRun` 改写锁是直接 `fs.writeFile`、非原子，撕裂读会让并发者 `readLock` 得 null ⇒ `unparsable`。核实：`acquireLock` 对 `unparsable` 且文件修改不足 2 s 的锁不回收（`lock.ts` :212），改写刚发生、mtime 是新的，兜住了。与 EV-158 无关，不登记；r2 §7.5 记一句。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核实成立：规范化形态成为盘上比对基准后，就地改取法会让新旧记录同环境也全判错配，方向最坏；写成契约、成本几乎为零 | r2 §4.1 末条「契约线」；§4.3 与 `processStartTime` / `processMatchesRecord` 文档块写死：该组旗标与环境的确切产物是盘上契约，任何变更必须换新字段名，禁止就地改；§6 主设计 7.5 新段同写 |
| CODEX-02 | codex | minor | 接受 | 核实成立：环境对名义不同而实际同形时，b 格断言静默变真 | r2 §5.1 新增共享前置 P0：每格造记录前断言「W 下缺省形态 ≠ R 下缺省形态、两者都 ≠ 规范化形态」，不满足即该格失败并打印三个形态；§5.2 集成对 worker pid 同样先断言；§5.4 验收脚本环境准备段一次性自检并把三个形态写进读数 |
| CODEX-03 | codex | minor | 接受 | 核实成立：C2 / C3 / C4 的「活进程 + 规范化值不符」没有直接格，而它们的后果是抹除、整删候选与回收锁 | r2 §5.1 U5 补 ⑤（锁的规范化字段改成另一个合法形态 ⇒ `judgeStale` 判 `pid_reused`）、U6 补 ④（status 的规范化字段改成另一个合法形态 ⇒ `workerConfirmedGone` 可抹、`workerStillAlive` 不算活）；§5.3 新增 M20（`judgeStale` 忽略 `sameProcess`）、M21（`workerConfirmedGone` 只看 `alive`） |
| AGY-01 | gemini | minor | 接受 | 核实成立：写者产出总是 trim 过的，手改带空白时 r1 会误判且方向不安全；返回 trim 值无副作用 | r2 §4.1 D3：`canonicalStartOf` 返回 `v.trim()`；§5.1 U3 补「首尾带空白 ⇒ 按 trim 后的值比、判同一进程」；§5.3 M7 扩为两条（M7a 接受空串、M7b 不 trim） |
| AGY-02 | gemini | minor | 接受 | 核实成立：`Promise.all` 的容错契约没写明；U10 引了签名里没有的第三参 | r2 §4.2 第 1 条：`processStartTimes` 两路各自 `.catch(() => null)`，契约「永不 reject」；§4.3 签名显式列出第三参 `o.canonicalStartTimeOf`（取 pid、返回规范化启动时刻或 null；只作用于规范化那一支，只为单测开）；U10 改用这个名字 |
| AGY-03 | gemini | nit | 驳回 | 核实不成立：`processAlive` 对活进程在判期望值之前就取 `ps`（`util/exec.ts` :514-515），改传 null 省不掉派生；要省得改用裸 `kill(pid, 0)`，那是与 EV-158 无关的性能改动，量级（会话启动时每个 running 闸门一次 `ps`）可忽略，不做也不登记 | 无修改（`sweepDeadRunningGates` 仍只改注释；r2 §4.5 注明「传 null 也照样取一次 ps」） |
| GLM-01 | glm | minor | 接受 | 核实成立：一把遗留锁喂不了两次「回收并起跑」，第二次必退 70 | r2 §5.4 A4 改为两轮独立序列：各自「旧构建造一把 pid 已不在的锁 → 新 `--start`（W / R）→ 判据 → 整轮收尾」 |
| GLM-02 | glm | minor | 接受 | 核实成立：PROTOCOL 没有 status.json 字段表，既有加法都在 :360 一句带出 | r2 §6 PROTOCOL 落点改为两处既有锚点：:270 约束句补规范化形态与两个新字段；:360 按 `cli` / `lost` 的既有句式补一句 `worker_started_at_canonical` 是对外 JSON 的加法；不新增表 |
| GLM-03 | glm | nit | 接受 | 核实成立：「一定是同一进程」跨不过 await 边界；风险可忽略但措辞不能当绝对不变量 | r2 §4.2 第 1 条改写：常态是父进程刚派生、子进程未退出；跨 await 后依赖的是「pid 空间绕一圈」的概率边界；两次取值因进程恰好退出而一成一败时，规范化那一路为 null ⇒ 按 g 格退回，已覆盖；实现注释照此写 |

## 2. 修订方案（命令 A：裁决后直接定稿 r2）

1. 计划 r2 按上表各落点改写，文末附录列逐条对应；其余不动。
2. r2 之后认领 code 阶段、按 r2 实施，§5 的读数在编码阶段做全。
3. 不改：`sweepDeadRunningGates` 的判据（AGY-03 驳回）；取不到启动时刻时的处置口径（用户决策）。
