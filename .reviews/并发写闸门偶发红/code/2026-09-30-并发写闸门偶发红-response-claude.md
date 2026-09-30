---
schema: trivium.disposition.v1
topic: 并发写闸门偶发红
stage: code
role: claude
kind: response
run_id: 20260930T092340Z
addresses:
  - 2026-09-30-并发写闸门偶发红-codex.md
  - 2026-09-30-并发写闸门偶发红-gemini.md
  - 2026-09-30-并发写闸门偶发红-glm.md
---

# 应答：并发写闸门偶发红 · 代码双审第 1 轮

> 被审对象：相对 `7c6959e` 的未提交改动（55 个文件，补丁约 5.9 MB，大头是证据 JSON）
> ｜ 运行：`20260930T092340Z`（约 11 分 31 秒）
> ｜ 结论：codex `approve-with-nits`（次要 2、吹毛求疵 1）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（吹毛求疵 1）
> ｜ 共 4 条：接受 4、驳回 0、暂缓 0

## 0. 核实记录

- **CODEX-01 ≡ GLM-01**：成立。`run()`（`util/exec.ts` :194–198）以 `{ ...process.env }` 合并后把整份 env 交给 `spawn`，桩看到的是生效环境；缺省形态继承宿主的 `TZ`。宿主设了 `TZ=UTC0` 时缺省调用也带 `TZ=UTC0`，`stubPsFailure('legacy')` 拦不到它，U1b 的桩自证以「Node 未同步具名导入」这条失实诊断判红；`'canonical'` 一侧则会顺带拦掉缺省调用。本机读数都在未设 `TZ` 的环境下取得，这一格没覆盖到。
- **CODEX-02**：成立。70 的正文「若确认该运行已卡死，可用 `trivium review --cancel <run_id>` 取消」；同一 `ps` 故障条件下 `cancelRun` 主路径（`run-protocol.ts` :1775–1805）以 `live.alive && live.sameProcess` 准入，取不到 ⇒ 走「工作进程已不存在，仅做状态与锁的清理」——不发信号、清掉运行锁，活 worker 脱锁继续跑，同主题下一次 `--start` 可拿到锁。EV-175 写了「`--cancel` 只清不杀」，没写这一格正是 70 出口指向的路径、以及随之而来的同主题双跑。
- **CODEX-03**：成立。`within` 超时只让等待方 reject，8 个 `setGate` 仍在跑；`withStderr` 随即复原 stderr、`finally` 复原两套桩，后台写者之后打的告警会写进真 stderr，同文件后续用例（U3 以 `withStderr` 断言无回收告警）可能被串扰。只在 U2 已失败时可达。

**编排器附注**：「安装副本不是当前工作树构建的」「安装副本与仓库 HEAD 不同版（构建于 67db999）」——安装副本是上一主题提交后重装的，本主题未提交、按用户要求不重装；codex 侧能力口径三条同计划审。均不影响裁决。

## 1. 逐条裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 核实成立：桩按合并后的 `TZ` 判形态，宿主设 `TZ=UTC0` 时误判，且自证文案会把人引向错误成因 | `test/helpers/ps-stub.ts`：规范化形态改为同时要求 `LC_ALL === 'C'` 与 `TZ === 'UTC0'`；宿主自己同时设了这两个值时两种形态不可区分，`psStubWorks` 先返回「环境前提不满足」的明确文案（不再报「未同步具名导入」）；文档块写明前提。补跑：在 `TZ=UTC0` 下跑 `lock.test.js`（期望全绿），在 `TZ=UTC0 LC_ALL=C` 下跑（期望 EV-153 各格以环境前提文案红），读数进证据目录 |
| CODEX-02 | codex | minor | 接受 | 核实成立：70 的出口在同一 `ps` 故障下落进「只清不杀」格，连锁到同主题双跑，登记面没写 | 采用建议①（只改文档，70 文案与退出码不动——用户决策「退出码 70 不改」，文案改动属 EV-175 的处置面）：BACKLOG EV-175、LLD 已知缺口表 EV-175 行、主设计 :1485 的残余句补「满载 `ps` 坏时它正是 70 出口指向的路径，命中即活 worker 脱锁、同主题可再 `--start` 双跑」 |
| CODEX-03 | codex | nit | 接受 | 核实成立：超时后后台写者可能串扰后续用例的告警收集 | `test/unit/lock.test.ts` U2：`withStderr` 的回调里先等 8 个写者 `allSettled` 落定（带 120 s 上界，`setGate` 受重试预算约束必然结束）再返回，stderr 与两套桩都在写者落定之后才复原 |
| GLM-01 | glm | nit | 接受 | 核实成立（与 CODEX-01 同一事实） | 同 CODEX-01 |

## 2. 修订计划

1. `test/helpers/ps-stub.ts`：判别收紧为 `LC_ALL === 'C' && TZ === 'UTC0'`；新增环境前提检查（宿主同时设了两者 ⇒ 不可区分），`psStubWorks` 与装桩时的诊断文案区分「环境前提不满足」与「桩未透传」。
2. `test/unit/lock.test.ts` U2：写者落定后再复原。
3. 文档：BACKLOG EV-175、LLD 已知缺口表、主设计 :1485 补 70 出口的连锁。
4. 读数：`lock.test.js` 在缺省环境、`TZ=UTC0`、`TZ=UTC0 LC_ALL=C` 三种环境下各跑一次；变异 M1～M3 重跑；全量检查；报告补 §6 修订后读数。
