---
schema: trivium.review.v1
topic: worker启动时刻规范化
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.12
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260928T120630Z
rerun_index: 1
snapshot_hash: sha256:bdfa668b28e2d7dd9cae2da741ab9fa7d0250eb82e13782ab7a14e0b4092e8b0
blind: true
started_at: 2026-09-28T12:06:32.720Z
finished_at: 2026-09-28T12:15:52.915Z
duration_s: 295
tool_calls:
  read: 27
  grep: 7
  glob: 1
  run_command: 0
  project_reads: 17
evidence_ok: true
verdict: approve
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 62c4fd17-68ff-4cdc-8f85-73b94d6d60c1
---

# 代码审查：worker启动时刻规范化

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260928T120630Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

本次代码变更完整落实了 EV-158 及其已批准实施计划（r2 定稿），未发现偏离或契约漂移。
通过引入 status.json 与锁文件的规范化启动时刻可选字段，并将跨进程身份比对统一收敛至 processMatchesRecord，彻底解决了写者与读者因 TZ/区域设置不同导致活 worker 被误判为不同进程的缺陷。
锁改写经由 workerLockContent 显式覆盖四个键，有效阻断了持锁者规范化时间污染 worker 的隐患。
八个消费方适配清晰，严格退出判据基准保持一致，旧记录退回与回滚路径论证严密，测试与 23 项变异咬合完备。

**结论**：`approve`

## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。

## 认为正确的部分

- 字段扩展与防污染设计：status.json 与锁文件增加可选规范化字段且保留缺省字段，通过 workerLockContent 纯函数显式覆盖 run_id/pid 与两种启动时刻，防止解构复制时将 --start 自身规范化时间带入 worker 导致锁被当成遗留锁回收。
- 读法收敛与平滑降级：在 exec.ts 中收敛 processMatchesRecord 作为跨进程身份校验的唯一读法，有规范化记录即只比规范化，缺失时原样退回 processAlive，保证升级窗口期在跑运行与旧锁行为不变。
- 消费方边界与告警精确：八个消费方全面适配，classifyLostCancel 守卫合理放宽为两种形态有其一；mismatch 告警按比对依据分写，规范化记录不符时不归咎于环境且依然保持不发信号、不结束 CLI 的防御性原则；严格退出判据基准与判格取值同一 basis。
- 测试设计与变异保障：通过 start-env.ts 构造了错开的 W/R 环境对并增加 P0 断言避免 libc 回退导致的测试静默变真；23 条变异测试与 10 格新旧构建零配额验收覆盖了新写新读、旧写新读、新写旧读及读改写保留全路径。

## 未覆盖范围（本侧盲区）

- 真实厂商 CLI（Antigravity、ZCode、Codex）消耗真实配额的端到端调用（按用户决策保持零配额，依赖真实 bundle + 桩夹具验证）。
- Node.js 18 / 20 运行时兼容性（当前本机验证环境为 Node v25.2.1）。
- 同一秒内 PID 迅速复用（因系统 ps lstart 精度为秒级，属已知且如实保留的系统级边界）。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `.reviews/worker启动时刻规范化/code/_meta/changes-20260928T120630Z.diff`
- `.reviews/worker启动时刻规范化/plan/2026-09-28-worker启动时刻规范化-r2-claude.md`
- `src/trivium/lock.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/status.ts`
- `src/trivium/retention.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/hooks.ts`
- `test/helpers/start-env.ts`
- `test/unit/start-canonical.test.ts`
- `doc/05_testing/REPORT_2026-09-28_worker_start_canonical.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":27,"grep":7,"glob":1,"run_command":0,"project_reads":17}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
