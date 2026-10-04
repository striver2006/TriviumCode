---
schema: trivium.disposition.v1
topic: 建仓步骤失败显式化
stage: plan
role: claude
kind: revised
run_id: 20261004T160118Z
addresses:
  - 2026-10-05-建仓步骤失败显式化-codex.md
  - 2026-10-05-建仓步骤失败显式化-gemini.md
  - 2026-10-05-建仓步骤失败显式化-glm.md
---

# 裁决：建仓步骤失败显式化 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-04-建仓步骤失败显式化-claude.md`（r1，起点 `3b2626c`）
> ｜ 运行：`20261004T160118Z`（三侧到齐）
> ｜ 结论：codex `approve-with-nits`（次要 2、吹毛求疵 1）｜ gemini `request-changes`（重要 2、次要 2）｜ glm `approve-with-nits`（次要 1、吹毛求疵 1）
> ｜ 共 9 条：接受 9
> ｜ 修订后的计划：`plan/2026-10-05-建仓步骤失败显式化-r2-claude.md`；命令 A 不设人工闸门

三侧都独立复核了 r1 §1 的代码事实与 §1.2 的甄别结论（`fakeCtx` 先写 `.trivium/config.yaml`、唯一的空目录建仓是 `hook-config.test.ts` 的 `ignored=false` 一轮），也都认可 §2.4「doctor 层统一接住、失败侧整段不落盘」的取舍与 §2.2 取 `--allow-empty`。

两处是多侧同指：

- **`--no-model-calls` 下 zcode 仍建夹具**（AGY-02 ≡ GLM-01）。回到源码核过：`probes/zcode.ts:1407` 建夹具、:1409 跑只读旗标探针，`skipModelCalls` 的早退在 :1562、位于夹具 try 之内；agy（:304）、codex（:824）、claude（:1063）才是在建夹具之前早退。r1 §2.4 那句是我把三家的形态推到了第四家。设计不变（zcode 落 blocker 符合「环境坏了」的口径），只改陈述并补 D9。
- **U11 不该真等 30 秒**（CODEX-03 ≡ AGY-04）。定为对成文函数喂合成 `RunResult` 直测，判定顺序（AGY-03）也在同一格里咬住；不导出可写的超时常量，`initFixtureRepo` 签名不变（决策一）。代价是「六步真的带了 30 s」没有行为级用例，r2 §7 如实登记。

AGY-01 与 glm 的意见相反：glm 在「认为正确的部分」里主张记忆格维持 blocker（同一根因两种档位）。取 gemini 的理由见下表与 r2 §2.5——`project_memory_blocked` 不进 `availability()` 与 preflight（`adapters/claude.ts`、`preflight.ts` 里 grep 为空，已核），记 blocker 会让 doctor 退非零而 preflight 照样放行；主夹具失败是该侧全部能力结论没刷新，记忆格失败只有一格没刷新且不影响能不能用，两档后果不同，档位不同是对的。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：去掉 `--allow-empty` 后 `hook-config.test.ts` 的 `ignored=false` 一轮在空目录建仓，逐步查结果后会抛、该格变红；r1 §1.2 自己的甄别读数就指向它，§4 却只列了 U2。补进 M3 的预期红；装置只收一个套件，这一格在预跑里记 | r2 §4 M3 行与表前说明 |
| CODEX-02 | codex | minor | 接受 | 属实：两个工厂在 `initFixtureRepo` 之后紧接着调 `workTreeHash(root)` 不传预算（`fixture.ts:109`、:157），git 卡在那三步同样让工厂永远等下去，r1 只堵了一半。按建议显式传 `{ timeoutMs: 30_000 }`：`workTreeHash` 的契约已把「不传」冻结为原行为，只这两处多传、别的调用方零影响，超时抛的 `GitTimeoutError` 落进新 catch 包成 `ProbeFixtureError`。探针建好夹具之后的 scratch_paths 比对不在本题，列入「不做」 | r2 §2.3 第四条；§0「不做」第四条；§1.1 第四条 |
| CODEX-03 | codex | nit | 接受 | 属实：U11 留二选一是未决项，真等 30 s 是每次全量的重复税。定为对成文函数 `fixtureRepoStepError` 喂合成 `RunResult` 直测；不导出可写常量，签名不变 | r2 §3 U11；§2.1 末两条；§7 第二条 |
| AGY-01 | gemini | major | 接受 | 属实：`project_memory_blocked` 不进 `availability()`、preflight 与 `claudeSeverity` 的 blocker（已 grep 核），记 blocker 会让 doctor 与 preflight 口径分叉；单格本轮未刷新出 warning 是 EV-196 的既定口径（`doctor.ts:408`）。glm 主张维持 blocker，不采纳的理由见正文与 r2 §2.5：两档后果不同；决策四说的是「侧失败」，记忆格失败时该侧没有失败。导出函数改名 `memoryFixtureWarning`，进 warnings | r2 §2.5 全节；§3 D6；§4 M15；§0 第 4 条 |
| AGY-02 | gemini | major | 接受 | 属实（同 GLM-01）：zcode 的只读旗标探针在夹具里跑、`skipModelCalls` 早退在夹具 try 之内（`zcode.ts:1407`、:1409、:1562），r1 §2.4「各探针在建夹具之前就返回」对 zcode 不成立。改准陈述；设计不变；补 D9 断言 `--no-model-calls` 下 zcode 建夹具失败照样落一条 blocker、doctor 不抛 | r2 §1.1 新增「--no-model-calls 下」一条；§2.4 末条；§3 D9；§4 M1 / M7 / M10 / M11 的预期红补 D9 |
| AGY-03 | gemini | minor | 接受 | 属实：`run` 超时时先置 `timedOut` 再发 SIGTERM（`exec.ts:335`），返回的 `signal` 通常也非空，先判信号会把超时说成「被信号终止」。判定顺序写死为 超时 → 启动失败 → 信号 → 非零退出，U11 ① 咬住，补变异 M17 | r2 §2.1 判据一条；§3 U11；§4 M17 |
| AGY-04 | gemini | minor | 接受 | 与 CODEX-03 同一处，同样定为合成直测；建议里的「50～100 ms 短超时注入」要给 `initFixtureRepo` 加参数或可写常量，与决策一「签名不变」冲突，故取不跑真实超时的直测 | r2 §3 U11；§7 第二条 |
| GLM-01 | glm | minor | 接受 | 与 AGY-02 同一处；按建议注明「行为符合预期、无需改设计」，D9 即「测试侧覆盖 --no-model-calls 时预期包含 zcode 这一支」 | r2 §2.4 末条；§3 D9 |
| GLM-02 | glm | nit | 接受 | 属实：r1 的「保持上一次不变」在首次探测（D7 的构造）时失实。两句都改为对「从未探过」也成立：主夹具一句「原样保留（从未探过则仍为空）」，记忆格一句「沿用的是上一次的结论（从未探过则仍为空）」 | r2 §2.4 措辞；§2.5 措辞 |

## 2. 修改小结

- §2.5：记忆格由 blocker 改为 warning，函数改名 `memoryFixtureWarning`。
- §2.4 / §1.1：订正 `--no-model-calls` 的陈述，补 D9。
- §2.3：工厂里的 `workTreeHash` 显式带 30 s。
- §2.1：判定顺序写死；成文函数入参定为步骤序与 `RunResult`。
- §3：U11 改合成直测；D6 断言 warning；D8 定为 `guardFixture` 直测；新增 D9。
- §4：M3 补 `hook-config` 一格；M15 改为不推 warning；新增 M17；M1 / M7 / M10 / M11 补 D9。
- §6：报告与证据目录按实施日期改为 2026-10-05。
- §7：去掉 U11 计时风险，改记「超时只测了成文、没测接线」。
