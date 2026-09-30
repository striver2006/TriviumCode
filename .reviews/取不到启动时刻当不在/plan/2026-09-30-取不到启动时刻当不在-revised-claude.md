---
schema: trivium.disposition.v1
topic: 取不到启动时刻当不在
stage: plan
role: claude
kind: revised
run_id: 20260930T102656Z
addresses:
  - 2026-09-30-取不到启动时刻当不在-codex.md
  - 2026-09-30-取不到启动时刻当不在-gemini.md
  - 2026-09-30-取不到启动时刻当不在-glm.md
---

# 裁决：取不到启动时刻当不在 · 计划双审第 1 轮

> 被审对象：`plan/2026-09-30-取不到启动时刻当不在-claude.md`（r1，起点 `c4d082e`）
> ｜ 运行：`20260930T102656Z`（约 15 分 46 秒）
> ｜ 结论：codex `approve-with-nits`（次要 2、吹毛求疵 2）｜ gemini `approve-with-nits`（吹毛求疵 1）｜ glm `approve-with-nits`（次要 1、吹毛求疵 2）
> ｜ 共 8 条：接受 8、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-09-30-取不到启动时刻当不在-r2-claude.md`；命令 A 不设人工闸门

## 0. 核实记录

- **CODEX-01 ≡ GLM-03**：成立。r1 D6 只给了「稍后重试 / 终端核对」，没给 `ps` 持续取不到时的确定性出路；而那条出路确实存在：工作进程被人在终端结束后，`kill(0)` 即失败、`identity` 为 `different`，`--cancel` 走既有「已不存在，仅做状态与锁的清理」路径（`run-protocol.ts` :1801～:1806 → 挂载点 ③ → 收尾），锁、闸门、CLI 记录都能收。工作进程的命令行是 `〈node〉 〈trivium.cjs〉 review --worker 〈run_id〉`（`run-protocol.ts` :425～:427），终端里认得出。两侧建议一致：补进 69 文案、MANUAL 场景 4、PROTOCOL 69 行，不改退出码、不改 70。
- **CODEX-02**：成立。`processStartTime` 的超时是 10 s（`exec.ts` :543），`run()` 超时与派生失败同样以非零收场、得 null——结局同形，但每次取值要停满 10 s，而一次 `--cancel` 串行调多次 `ps`。r1 没写明「只注入派生失败」这一取舍，也没有超时形态的读数。
- **CODEX-03**：成立。§2 表与证据 JSON 都是 14 格（A-prod、A-test、C 五格、G 三格、S 三格、K-main），自证 14 / 14；「13 格」是笔误。GLM 在「认为正确的部分」里也写成 13，同源于这句。
- **CODEX-04**：成立。MANUAL :661～:665 是无条件句（「它会结束那个工作进程……补收……回收主题锁」）；改后「`--wait` 判 heartbeat_stale、随后 `ps` 仍取不到」时 `classifyLostCancel` 落 `mismatch`，这些动作一个都不发生。r1 拿 `run-protocol.ts` 里 mismatch 结论句当 MANUAL 不改的理由，论据张冠李戴。补：MANUAL :669 那一条「启动时刻与 status.json 的规范化记录不符——PID 已被复用，或这一次取不到它的启动时刻」已在同一段的结局列表里，所以只需在 :663 的无条件句后补一个限定，把读者引到那一条。
- **AGY-01**：成立。`identity` 是可选字段，`!== 'different'` 对 `undefined` 判真；生产路径上 `processMatchesRecord` 总会填，但单测桩与将来的手工构造不保证。改为显式正向判定，缺失即按今天的口径（`alive && sameProcess`）收敛。
- **GLM-01**：成立。`scripts/build.mjs` 的测试构建逐文件转译（`bundle: false`、`format: 'esm'`），静态导入改前树不存在的 `recordIdentityOf` 会让整文件加载失败，r1「回归格必须绿」在改前树不可满足。取 GLM 建议①：新用例文件**不静态导入**任何新导出，U1 的纯函数真值表经动态 `import()` 取 `recordIdentityOf`（改前树取到 `undefined` ⇒ 该格红），其余各格只经既有导出观察行为。
- **GLM-02**：成立。`processMatchesRecord` 有三个 `return`（:613 legacy、:623 规范化且不在、:627 规范化且活着）；「两个出口」会把 :623 漏掉，而 :623 恰是「进程已不在」——漏填后 r1 D5 的写法会把它当仍在。与 AGY-01 叠加即「运行目录永不清」。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | 次要 | 接受 | 69 + 重试在 `ps` 持续故障下与 70 同形成环；确定性手工出路存在（终端结束工作进程后再 `--cancel` 走「已不存在」收尾），不写出来用户会卡在 69 | r2 §3 D6 文案补手工出路（先核命令行含 `review --worker 〈run_id〉`，再在终端按组结束它，之后重跑 `--cancel`）；§6 MANUAL 场景 4、PROTOCOL :228 69 行同句；§4 新增 R4 记「持续故障下只能手工」 |
| CODEX-02 | codex | 次要 | 接受 | 超时通道结局同形但耗时不同，r1 未写取舍、无读数 | r2 §2 末补「只注入派生失败、超时通道结局同形」的取舍句；§5.2 改后探针加一格 `K-main-timeout`（桩把被拦的 `ps` 换成睡过 10 s 的进程），两份构建都跑、读数记 `--cancel` 总耗时与结局 |
| CODEX-03 | codex | 吹毛求疵 | 接受 | 14 格写成 13 格 | r2 §2 改为「14 格自证 14 / 14」；§5.2 改后重跑写成硬断言：格数 = 14（加 `K-main-timeout` 为 15）、每格自证必过、对照组逐格与改前对照组相同 |
| CODEX-04 | codex | 吹毛求疵 | 接受 | MANUAL :663 是无条件承诺，改后有已知反例；r1 不改的论据指错了文件 | r2 §6 MANUAL 行：:663「它会结束那个工作进程……」后补半句限定——这一次取不到它的启动时刻时只告警、什么都不动（见下文「规范化记录不符」那一条），与 :669 呼应 |
| AGY-01 | gemini | 吹毛求疵 | 接受 | 可选字段 + 弱反向判定，缺失时把死进程当仍在 | r2 §3 D5 改为显式正向判定：`identity` 为 `'same'` 或 `'unverifiable'` 才算仍在；`identity` 缺失时退回 `a.alive && a.sameProcess`（今天的口径）。D2 / D3 / D4 / D6 同理只在 `=== 'unverifiable'` 时走新分支，缺失即今天的行为 |
| GLM-01 | glm | 次要 | 接受 | 逐文件 ESM 转译下静态导入新导出会使改前树整文件加载失败，「回归格必须绿」不可满足 | r2 §5.1 写明：新用例文件不静态导入新导出；U1 真值表以动态 `import()` 取 `recordIdentityOf`；§5.2 移植验收期望改为逐格红 / 绿 |
| GLM-03 | glm | 吹毛求疵 | 接受 | 与 CODEX-01 同一缺口（≡）：69 文案与 MANUAL 场景 4 只给「稍后重试 / 核对」，没给终端手工结束后再 `--cancel` 这条确定性出路 | 同 CODEX-01：r2 §3 D6 文案、§6 MANUAL 场景 4 与 PROTOCOL :228 69 行补同一句手工出路 |
| GLM-02 | glm | 吹毛求疵 | 接受 | `processMatchesRecord` 有三个 `return`，「两个出口」会漏 :623 | r2 §3 D1 改为「三个 `return` 都经 `withIdentity(m)` 包装后返回」，U1 保留「不存在的 pid ⇒ different」两种 basis 各一格 |

## 2. 修订范围小结

- 行为面：不变（D1～D6 的判据与处置同 r1）；只改 D5 的写法与 D1 的包装方式、D6 的文案。
- 验证面：探针加 `K-main-timeout` 一格；移植验收期望改为逐格；U1 真值表改动态导入。
- 文档面：MANUAL 场景 4 与 :663 两处、PROTOCOL 69 行补手工出路。
- 暂缓：无新增；R1（EV-176）不变。
