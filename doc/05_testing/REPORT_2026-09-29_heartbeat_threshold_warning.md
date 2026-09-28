# 心跳阈值事前告警 · 实施报告（EV-160）

- **日期**：2026-09-29
- **主题**：`心跳阈值事前告警`；计划 `.reviews/心跳阈值事前告警/plan/`（用户决策送审前已定 → 计划双审 run `20260928T162126Z`：codex / gemini / glm 三侧 `approve-with-nits`，9 条（去重后 7 条）全接受 → r2 定稿）。命令 A 一口气跑，不设人工闸门
- **起点**：`4097aaa`（`main`，clean）；计划与本报告的行号取自该提交的源码
- **状态**：实施与验证完成；代码双审 r1（run `20260928T170313Z`）已应答并按接受项修订（§6）；未提交
- **evidence**：`doc/05_testing/evidence/heartbeat-threshold-warning-20260929/`

---

## 1. 逐条落地（按 r2 章节）

| r2 | 落点 | 验证 |
| :--- | :--- | :--- |
| §3.1 共享来源 | `status.ts`：导出 `WORKER_HEARTBEAT_MS = 30_000` 与 `staleThresholdWithinHeartbeat(s)`（`s * 1000 <= WORKER_HEARTBEAT_MS`）；`run-protocol.ts` 删掉本地 `HEARTBEAT_MS`，worker 心跳定时器与 `--wait` 那一句都改为引用 | U1、U4、R1、N1～N3、N6 |
| §3.1 缺省值（CODEX-02） | `config.ts`：导出 `DEFAULT_HEARTBEAT_STALE_S = 120`，缺省配置引用它 | U2、N12 |
| §3.2 告警产出 | `preflight.ts`：`checkHeartbeatThreshold(cfg): CheckResult \| null`，`name` 为 `失联阈值`、`ok: true`、`warn: true`；正文含生效阈值（原值打印）、心跳间隔、后果（每一轮越过阈值 ⇒ `--wait` 轮询到就判 heartbeat_stale；失联报错推荐 `--cancel`，照做会结束一个健康的轮次）、出口（调回缺省值以上；有意为之可忽略） | U2、N7～N9 |
| §3.3 预检 | ④‴：④″ 之后、探活之前，同一 `checks.every(ok)` 短路 | P1～P4、I3、N4、N10、A1、A6 |
| §3.3 `startRun` | 主 `try` 之内、FR-23 跳过分支之后，与 `checkModelOverrideSource` 同一次 `collectWarnings`（副本源在前、阈值在后）；`finished_inline` 分支仍返回 `[]` | I1、I2、I5、I6、N5、N11、A3、A4 |
| §3.3 `waitRun` | 行内比较改为 `staleThresholdWithinHeartbeat(staleS)`，间隔改用 `WORKER_HEARTBEAT_MS`；文字不动 | R1、既有 K2、A5 |
| §3.4 同步 `review --stage` | 不调（没有 worker 与 `--wait`） | I4、A7 |
| §3.5 不改 | schema、缺省数值、`interpretStatus`、`--wait` 文字、skill、`cli.ts`、`lock.ts` | `git diff --stat`：只改 `status.ts` / `config.ts` / `preflight.ts` / `run-protocol.ts` 四个源文件 |

## 2. 读数

| 项 | 读数 |
| :--- | :--- |
| `npm run check` | 第 1 次（文档同步之前）**2241 / 2239 / 0 / 2**，一次全绿（起点 2227 → 新增 14 条：U1、U4、U2、P1～P4、R1、I1～I6），255 s（`check-1.txt`）；文档同步之后见 §5 |
| 新增用例耗时 | I3 约 2.8 s（两次真实 bundle 预检）；I1 / I2 / I5 约 0.7 s；I4 / I6 约 0.3 s；R1 64 ms（四个阈值各跑一次 `waitRun`）；单测每条 < 0.2 s |
| 源码变异（`mutation-spec.json`，12 条，锚点由 `gen-mutation-spec.mjs` 从源码截取并核对唯一） | **12 / 12**（`mutation-output.r1.txt`，规格 `mutation-spec.r1.json`；基线四个套件全绿）：N7 fail=3，N4 / N5 fail=2，其余 fail=1 |
| 失败用例名与文案（`mutation-names.mjs`，12 条全跑，只跑 `EV-160` 用例） | 全部红在目标用例的目标断言上（`mutation-names-output.r1.json`）：N1「阈值 30 s 没盖住一个心跳周期」、N2「阈值 0.001 s …」、N3「阈值 30.001 s 盖住了…」（U1）；N4 P1 / P3；N5 I1 / I5（`warnings` 为 `[]`）；N6 R1「--wait 那一句（阈值 30）」；N7 U2 / P1 / P3；N8 / N9 U2（正文不符）；N10 P4「失败之后不再出只警告项」；N11 I6「finished_inline 支不带阈值项」；N12 U2「缺省配置与出口句的缺省值同源」。**没有「用例前提」一类的前置失败** |
| 零配额验收（`acceptance.mjs`，新旧两份构建，旧 = `4097aaa`、不叠加任何文件） | 第 1 次 **7 / 10**（`acceptance-readout.r0.json`）：A3 / A4 / A5 三格假红，原因是归一化漏了两处——运行根下按仓库分的子目录名（`目录名-路径哈希`，新旧夹具目录名不同）与「向工作进程组 N」里的组号；三格其余正文逐字相同。补齐这两条归一化后第 2 次 **10 / 10**（`acceptance-readout.r1.json`、`acceptance-output.r1.txt`），残留进程组为空 |
| `doctor --selftest`（新构建，验收 A8） | **14 / 14** |
| 残留进程 | 集成用例、变异、验收跑完后，进程表里没有 `review --worker` 或桩 CLI 标记的进程 |
| 环境 | Node v25.2.1，macOS |

验收各格读数：

| 格 | 读数 |
| :--- | :--- |
| 构建 | 新 bundle sha256 `1e43895f3daa…`，旧 `64184e848be4…`，两者不同；`stub.ts` 相对 `4097aaa` 无 diff |
| A0 | 新构建、120 s，预检连跑两次，stdout 逐字相同（比对基线确定，CODEX-01） |
| A1 | 2 s 预检：退 0 / 0；新多出「失联阈值」（`checks` 与 `warnings` 各一项），删掉之后新旧 JSON 逐字相同 |
| A2 | 120 s 预检：新旧 stdout 逐字相同、退出码同为 0 |
| A3 | 2 s `--start --json`：退 0 / 0；新 `warnings` 恰一项「失联阈值」、旧 `[]`；其余键、`--start` 的 stderr、`--cancel` 的输出归一化后相同 |
| A4 | 120 s：新旧 `warnings` 都是 `[]`，其余同 A3 |
| A5 | 2 s `--start` 后 3 s `--wait`：退 1 / 1；报错含「判定依据」行与「阈值不大于心跳间隔：健康的工作进程也会被判失联」，归一化（含 `已 N s 未更新`，GLM-02）后新旧逐字相同——共享判据没改 `--wait` 的输出 |
| A6 | 30 s：新出、旧不出；30.5 s：新旧都不出且 stdout 逐字相同 |
| A7 | 2 s 同步 `review --stage`：退 0 / 0，stdout / stderr 归一化后相同，新构建输出不含「失联阈值」 |
| A8 | `doctor --selftest` 14 / 14 |

## 3. 偏离与如实登记

### 3.1 与 r2 文字的出入

- **U4 的断言形态**：r2 写「不再有 `* 1000 <=` 这种行内比较」；实现用正则 `\*\s*1000\s*<=?\s*(?:WORKER_)?HEARTBEAT_MS`，把 `<` 也算进去（N6 的形态正是 `<`），并加两条正向断言（`--wait` 那一句经共享判据、心跳定时器用共享常量）。
- **I4 的夹具**：r2 §6.2 说「所有格副本源都在」。实现改为桩不声明 `modelOverrideSource`（`cli()` 缺省 HOME，glm 桩没有副本源这一能力），效果相同：不会冒出 EV-123 的副本源项。I1～I6 同此。
- **变异的主咬套件**：装置每条只收一个套件。N6 选 `run-protocol.test.js`（R1，行为面），U4（源码面）另外也会红，但不进装置读数。

### 3.2 PRD

核过 PRD FR-18（「启动预检」）：只描述预检的功能，不逐条列举检查项，因此不改（计划双审 GLM 也核过同一结论）。

### 3.3 锁的持有超时（r2 §5）

只论证、不改行为，登记为 BACKLOG EV-161；`(30 s, 60 s)` 不告警登记为 EV-162（只登记、不建议做）。

## 4. 文档同步

| 文档 | 改动 |
| :--- | :--- |
| 主设计 | v1.3.57：§7.5 约束 ① 补共享判据；EV-146 段的如实保留句改为「v1.3.57 起事前告警」；§8.1 预检表加「失联阈值」一行，表下「上表四行」改「上表五行」并补口径（AGY-03）；版本记录 |
| LLD | v1.1.15：`startRun` 第 4 条补派生前的只警告项复查；4.2 引述块改指 `WORKER_HEARTBEAT_MS` 与共享判据；已知缺口表 EV-160 一行划掉、新增锁持有超时一行 |
| MANUAL | v1.0.15：配置表 `heartbeat_stale_s` 一行、`--wait` 失联报错段各补一句 |
| PROTOCOL | `--start` 的 `warnings` 说明补这一种；失联判定段补一句 |
| BACKLOG | EV-160 → done；新登 EV-161、EV-162 |
| PRD | 不改（§3.2） |

## 5. 文档同步之后的全量

文档改完后重跑 `npm run check`：**2241 / 2239 / 0 / 2**，一次全绿，254 s（`check-2.txt`）。

## 6. 代码双审

run `20260928T170313Z`（约 9 分 18 秒）：codex `approve-with-nits`（次要 1、吹毛求疵 1）、gemini `approve`、glm `approve`（两侧零意见）。
应答件在 `.reviews/心跳阈值事前告警/code/`（`…-response-` 加 Driver 后缀）：2 条全接受，`gate --check` 通过。
`gate --check` 附带一条 `run_warning`「安装副本不是当前工作树构建的」——改动未提交、未重装，属预期，不是本主题的缺陷。

### 6.1 按接受项的修订

| 意见 | 修订 |
| :--- | :--- |
| CODEX-01（等于 30 s 那一格，正文说得比机制能保证的更绝对） | 判据（D1，`≤`）不改。`checkHeartbeatThreshold` 正文在「反复越过这个阈值」之后补「（阈值越接近 30 s，越过的时段越短、被轮询碰上的机会越小）」；`staleThresholdWithinHeartbeat` 文档块写明「30 s 这一格属保守多告警的一侧」；U2 加一条断言钉住补句；主设计 v1.3.57 版本记录同步 |
| CODEX-02（探针夹具复制） | `test/helpers/fixture.ts` 新增 `seedFakeProbes(root, over)` 与 `FAKE_CLI_VERSION`（内容逐字取自 `codex-wiring.test.ts` 原私有夹具）；`codex-wiring.test.ts` 的 `seedProbes` 改为绑定本文件夹具根的一行，调用点不变，删掉随之不用的 `path` / `fs` / `YAML` 导入；新集成测试与验收脚本（经 `dist/test/test/helpers/fixture.js`）改用它 |

### 6.2 修订后重跑的读数

| 项 | 读数 |
| :--- | :--- |
| typecheck | 干净（第一次重建时 `codex-wiring.test.ts` 报 `path` / `fs` 未使用，删掉后通过） |
| `npm run check` | **2241 / 2239 / 0 / 2**，一次全绿，254 s（`check-3.txt`） |
| 源码变异 | 规格由生成脚本从修订后的源码重截，与 r1 逐字相同；**12 / 12**，逐条 fail 数与 r1 相同（`mutation-output.txt`） |
| 失败用例名 | 12 条红在的用例与 r1 逐条相同（`mutation-names-output.json`） |
| 零配额验收 | **10 / 10**（`acceptance-readout.json`、`acceptance-output.txt`）；新 bundle sha256 `3b82fc72be20…`（修订改了正文），旧 `64184e848be4…` 不变；残留进程组为空 |
| `doctor --selftest` | **14 / 14**（验收 A8） |
