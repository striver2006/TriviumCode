---
schema: trivium.disposition.v1
topic: 并发写闸门偶发红
stage: plan
role: claude
kind: revised
run_id: 20260930T082840Z
addresses:
  - 2026-09-30-并发写闸门偶发红-codex.md
  - 2026-09-30-并发写闸门偶发红-gemini.md
  - 2026-09-30-并发写闸门偶发红-glm.md
---

# 裁决：并发写闸门偶发红 · 计划双审第 1 轮

> 被审对象：`plan/2026-09-30-并发写闸门偶发红-claude.md`（r1，起点 `7c6959e`）
> ｜ 运行：`20260930T082840Z`（约 18 分 16 秒）
> ｜ 结论：codex `approve-with-nits`（重要 3、次要 3、吹毛求疵 1）｜ gemini `approve-with-nits`（重要 1、次要 1、吹毛求疵 1）｜ glm `request-changes`（重要 1、次要 2）
> ｜ 共 13 条：接受 13、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-09-30-并发写闸门偶发红-r2-claude.md`；命令 A 不设人工闸门

## 0. 核实记录

- **AGY-01 ≡ GLM-01**：成立。`status.ts` :539–541（`interpretStatus` 情形 C：`!live.alive || !live.sameProcess` ⇒ `worker_lost / pid_gone`）、:211–213（`workerConfirmedGone`：不是「活且同一进程」一律 `gone: true`，其文档块自称不可逆动作的唯一准入）、`retention.ts` :99–104（`workerStillAlive`）、`run-protocol.ts` :1775–1805（`cancelRun` 主路径：不是「活且同一进程」就走「已不存在，仅做状态与锁的清理」）——`ps` 取不到时都按「不在」处置。r1 §3 D1「只有锁这一处……是 fail-open」与 §4 R1「它们不删锁、不写闸门」失实。两侧建议一致：本主题不改（范围），改表述并登记。
- **CODEX-01 ≡ GLM-02**：成立。`processMatchesRecord` 在记录没有规范化字段时退回 `processAlive(pid, legacy)`（`exec.ts` :609–613），后者取缺省形态（:518，不带 `TZ`）；只拦 `TZ=UTC0` 的桩对旧版记录格不起作用。
- **CODEX-02**：成立。桩若在某个 Node 版本上不透传到具名导入，U1 / U2 自进程取值成功、`null` 恒绿，M1 也绿；变异装置是昂贵的兜底。
- **CODEX-03**：成立。`processStartTime` `timeoutMs: 10_000`（`exec.ts` :543）；年龄判据 120 s 远在 40 × 100 ms 之外，本次调用等不到。另核：超时形态下每次尝试的两次取值（:340、:174）今天就要付，D1 不新增这笔耗时，只让「判不了」那几轮也走它。
- **CODEX-04**：成立。全部读数 `node: v25.2.1`；`engines` `>=18`；上一主题已有 `npx -p node@18` 的先例。
- **CODEX-05**：成立。r1 以跨进程为拒绝同进程捷径的理由，却没有跨进程的用例或验收。
- **CODEX-06**：成立。原型树在 scratchpad、diff 未入证据目录；A / B 组已跑过不必重跑。
- **CODEX-07**：成立。`heartbeat_dead`（年龄）在休眠唤醒等情形下是合法回收。
- **AGY-02 ≡ GLM-03**：成立。还原时不再调 `syncBuiltinESMExports()`，ESM 具名绑定仍指向桩；U2 的放慢机制 r1 未写（探针靠 `fs.promises.readFile` 桩）。
- **AGY-03**：成立。`lock.ts` :179 注释与 JSDoc 未列入同步。

**codex 侧附注**（编排器）：consulted 无法与工具轨迹交叉核对、只读核验不可用、路径核验无结构化输入——属该侧 CLI 能力口径，指纹比对仍有效；意见内容均已按源码逐条核实，不影响裁决。

## 1. 逐条裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 核实成立：旧版记录走缺省形态 `ps`，只拦规范化的桩测不到该格，照写会恒真或恒红 | r2 §3 D3 用例表逐格写明拦哪一种形态：U1b（旧版记录）拦 `legacy`、其余拦 `canonical`；锁记录的启动时刻一律取真实值 |
| CODEX-02 | codex | major | 接受 | 核实成立：桩失效时 U1 / U2 恒绿，不该靠变异装置兜底 | r2 §3 D3「桩自证」：装桩后先取一次对应形态启动时刻、断言为 null，取到值即以明确文案判红；末尾断言被拦次数 > 0 |
| CODEX-03 | codex | major | 接受 | 核实成立：r1 只写「多等一会儿」、未给量级，也未说明本次调用等不到年龄兜底 | r2 §3 D1「代价与耗时上界」：快速失败约 4 s、10 s 超时形态约 14 分钟（今天已有的上界），等待者耗满预算抛 70；决策不加「连续判不了提前抛 70」并写明理由；设计与 LLD 同步写入 |
| CODEX-04 | codex | minor | 接受 | 核实成立：读数只在 Node 25 上取得，而桩最依赖版本 | r2 §5.6：编码阶段早期 `npx -p node@18` / `node@22` 跑 `lock.test.js`、`state.test.js`，落盘 `node18.txt` / `node22.txt`；取不到如实记录 |
| CODEX-05 | codex | minor | 接受 | 核实成立：跨进程是 D1 的主要动机之一，却无用例无验收 | r2 §3 D3 新增 U3（子进程持 `run` 锁、canonical 桩下 `acquireLock(retries: 0)` 抛 70 且锁原样）；r2 §5.3 跨进程验收 `acceptance-xproc-psfail.mjs`（新旧与改后各 50 轮） |
| CODEX-06 | codex | minor | 接受 | 核实成立：原型不可复现、A / B 组重跑是浪费 | r2 §5.1 搭树步骤、`proto-f2.diff` 与 `trees.md` 入证据目录；r2 §5.2 只补跑改后三组，旧与改前复用 §2.1 读数 |
| CODEX-07 | codex | nit | 接受 | 核实成立：年龄回收是合法行为，不该报成判定出错 | r2 §3 D2 第三条断言只管 `pid_reused` / `unparsable` / `pid_gone`；`heartbeat_dead` 在失败文案单列计数与原文 |
| AGY-01 | gemini | major | 接受 | 核实成立（与 GLM-01 同一事实）：`interpretStatus` 情形 C 与 `cancelRun` 主路径在 `ps` 取不到时同样 fail-open | r2 §3 D1 改写「为什么落在 judgeStale」一段、如实列出其余消费方；r2 §4 R1 新登 EV-175（暂缓，含三态化候选）；r2 §6 设计 :1485 与 LLD 已知缺口表同步登记 |
| AGY-02 | gemini | minor | 接受 | 核实成立：还原不重新同步会泄漏；U2 放慢机制未写 | r2 §3 D3 `stubPsFailure` 助手，还原函数复原后再调 `syncBuiltinESMExports()`；U2 用 `fs.promises.readFile` 桩放慢，两套桩同一 `finally` 按「先 fs、后 spawn」还原 |
| AGY-03 | gemini | nit | 接受 | 核实成立：`lock.ts` :179 注释与 JSDoc 会与 D1 矛盾 | r2 §3 D1 末句与 r2 §6 列入 `lock.ts` :179–180 行内注释与 `judgeStale` JSDoc |
| GLM-01 | glm | major | 接受 | 核实成立：`workerConfirmedGone` / `workerStillAlive` / `interpretStatus` 情形 C 同根 fail-open，下游是不可逆动作；r1 漏登 | 同 AGY-01：r2 §3 D1 与 §4 R1 改为如实表述并登记 EV-175；r2 §6 设计 :1485 补例外并点明与 :1483 `lostWorkerGone` 的不一致；BACKLOG 新登 EV-175 |
| GLM-02 | glm | minor | 接受 | 核实成立（与 CODEX-01 同一事实） | 同 CODEX-01：r2 §3 D3 U1b 拦 `legacy` 形态，锁记录的 `pid_started_at` 取真实值，使 `null` 确由 `ps` 失败得出 |
| GLM-03 | glm | minor | 接受 | 核实成立（与 AGY-02 第二点同一事实）：无放慢时持有者临界区快过等待者首个 `link`，M1 下不保证红 | 同 AGY-02：r2 §3 D3 U2 写明 `fs.promises.readFile` 桩对本格 `state.json` 读后等 30 ms、`finally` 还原；r2 §5.5 期望 M1 下 U2 红 |

## 2. 汇总

- 修法面不变：D1 仍是 `judgeStale` 一个条件；其余身份消费方的同根问题如实登记 EV-175 暂缓（AGY-01 ≡ GLM-01），不改其行为。
- 代价面：写明耗时上界与「耗满预算抛 70」的决策（CODEX-03）。
- 用例面：D2 第三条按原因分档（CODEX-07）；D3 逐格形态、桩自证、对称还原、放慢机制、跨进程 U3（CODEX-01 ≡ GLM-02、CODEX-02、AGY-02 ≡ GLM-03、CODEX-05）。
- 验证面：搭树与原型 diff 入证据、只补跑改后、跨进程验收、Node 18 / 22（CODEX-04 / 05 / 06）。
- 文档面：`lock.ts` 注释与 JSDoc（AGY-03）；设计 :1485、LLD 已知缺口表登记 EV-175。
- 三侧对定性的独立结论一致：315 ms 排除①成立、②未见、③新构建已不复现、④按②类定修法、D1 落点与条件正确、不改 `writeAtomic` 临时名的取舍正确。
