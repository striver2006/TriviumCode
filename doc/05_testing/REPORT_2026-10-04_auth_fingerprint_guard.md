# 探活指纹读盘兜底 · 实施报告（EV-202）

> - **日期**：2026-10-04
> - **主题**：`探活指纹读盘兜底`（命令 A `/dual-run`，Driver claude）
> - **起点**：`d6404d6`（`main`，工作树干净）
> - **计划**：`.reviews/探活指纹读盘兜底/plan/` r2（计划双审第 1 轮 run `20261003T163816Z`：codex `approve-with-nits`（次要 2，另 1 条因多余字段逐条降级）、gemini `approve-with-nits`（次要 2）、glm `approve-with-nits`（次要 1、吹毛求疵 1），7 条全接受；另登 EV-203）
> - **证据目录**：`doc/05_testing/evidence/auth-fingerprint-guard-20261004/`
> - **代码双审**：见 §5
> - **配额**：全程零配额（用户决策六）：G 系列用假适配器；R 系列用真实 codex / agy 适配器，codex 入口指到不存在的路径、agy 入口置空，两家都在到达真实调用之前落成失败

## 1. 问题

预检的 ⑧ 认证探活（`preflight.ts` 的 `probeAuth`）对适配器的三个调用点——`authProbe()` 构造、`fingerprint()`、`probe()`——都没有兜底，`runPreflight` 用 `Promise.all` 收各侧：任一侧抛出，整个预检崩成「内部错误」、退 1，别侧已花配额探出的结论一并丢掉。

实际会抛的是两家的指纹：codex（`adapters/codex.ts`）对 `<profile>.config.toml`、`auth.json` 先 `exists` 再 `sha256File`，对基底 `config.toml` 先 `exists` 再 `fs.readFile`；agy（`adapters/agy.ts`）对只读审查 Agent 的 `agent.md` 同形（EV-202 登记时只写了 codex）。`exists` 只判在不在，文件在而读不了（权限 000、成了目录、两步之间被删）就抛。zcode 的指纹自己 `catch` 后返回 null；claude 恒返回 null、无读盘。

不能照 zcode 先例「读不了返回 null」：null 是 `AuthProbe.fingerprint` 契约里的「无从计算」，缓存判据 `authCacheValid` 做全等比较，上次指纹为 null（claude 恒为 null；codex 三份都不在、agy 的 `agent.md` 不在时也是）时 null 等于 null 会命中缓存、跳过探活。

## 2. 改了什么

只改 `src/trivium/preflight.ts`（另在 `adapters/zcode.ts` 指纹的注释里补两句，代码不动）：

1. **`probeAuth` 兜住三个调用点**（用户决策一、二）：
   - 构造或 `probe()` 抛出 ⇒ 该侧 `ok: false`、退 69、详情「探活内部失败：原因」（家目录归一 `~`），不再崩整个预检；
   - `fingerprint()` 抛出 ⇒ 原因记进单独的 `fpError`、**不折成 null**：不查缓存、照常探活、通过也不写缓存，详情末尾接「；⚠️ 指纹读不了：原因，本次未用缓存、也不写缓存」。两段同时出现时「探活内部失败」在前、指纹注明恒在最后；
   - 指纹不抛、`probe()` 不抛时详情与缓存条目逐字节同原（G1）。
2. **`thrownText`**：取异常消息并归一家目录；`TRIVIUM_DEBUG` 置位时另把原始异常打到 stderr——兜住之后 `cli.ts` 出口的打印走不到这里，排障口径由这里接上（计划双审 CODEX-01 ≡ GLM-01）。
3. **`probeAuthAll`**：⑧ 的 `Promise.all` 原样抽成导出函数，`runPreflight` 恒传 `realAdapters()`；用例传假适配器表零配额（决策三取「导出」，不给 `runPreflight` 开探活注入口）。`probeAuth` 与 `AuthOutcome` 一并导出。

不改：各家指纹的取值口径、`authCacheValid` 判据（含 null 等于 null 命中）、缓存条目格式与 TTL、`commitAuthCache`、各家拉起参数与判据、`runPreflight` 的 `adapters` 选项语义、`cli.ts` 出口（决策四）。zcode 指纹的 try/catch 不动、输出逐字不变。

**口径变化**：适配器抛出这条路径的退出码由 1 变 69（决策二的代价）。仓内 `runPreflight` 的调用方只有 `cli.ts` 的 `cmdPreflight`，没有按 1 判别预检崩溃的消费方（grep 核过）。

## 3. 用例

新文件 `test/unit/preflight-auth-guard.test.ts`，12 格。缓存条目一律摆成「若进了缓存判据就会命中」（版本一致、刚写入、指纹 null），读不了时不查缓存才有对照。

| 格 | 摆法 | 断言要点 |
| :--- | :--- | :--- |
| G1 | 指纹 `fp-a`、无缓存、probe 通过 | 详情逐字等于 probe 详情，缓存记下 `fp-a` |
| G2 | 指纹抛 EACCES（消息含家目录）、缓存本可命中 | probe 调用 1 次、`ok`、不写缓存、详情逐字为 probe 详情 + 注明、家目录归一 |
| G3 | 指纹抛 EISDIR、probe 返回失败 | 退 69、详情 = probe 详情 + 注明 |
| G4 | probe 抛错（消息含家目录） | 不抛、退 69、详情「探活内部失败：boom ~/y」 |
| G5 | `authProbe` 构造抛错 | 同 G4 形状、probe 未调用、检查项名照常 |
| G6 | `probeAuthAll` 两家，一家 probe 抛 | 两条都回来，另一家通过且带缓存 |
| G7 | 指纹 null、缓存指纹 null（现状一格） | 照契约命中缓存、probe 0 次——钉住本题没改这条语义 |
| G8 | `refreshAuth` + 指纹抛错 | 照常探活、注明照接、不写缓存 |
| G9 | 指纹抛 + probe 也抛 | 详情逐字为「探活内部失败：…；⚠️ 指纹读不了：…，本次未用缓存、也不写缓存」 |
| R1 | 真实 codex 适配器，基底 `config.toml` 是目录（root 下也成立） | 不抛、退 69、以「准备 codex 隔离副本失败」起头、末尾「指纹读不了：EISDIR…」 |
| R2 | 真实 codex 适配器，`auth.json` 权限 000（root 跳过） | 同上，含 `~/.codex/auth.json`、不含家目录绝对路径 |
| R3 | 真实 agy 适配器，`agent.md` 权限 000（root 跳过），入口置空 | 详情「agy 路径未记录；⚠️ 指纹读不了：EACCES…~/.gemini/config/agents/trivium-critic/agent.md…」 |

R 系列钉住 `HOME` / `CODEX_HOME` / `TMPDIR` 到本格 mkdtemp，收尾在 finally 里按目录重新列、恢复权限再整删；用例一律清掉 `TRIVIUM_DEBUG`。`TRIVIUM_DEBUG` 打栈一支不设用例（见 §6）。

## 4. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 新用例 | 12/12 | — |
| 相关回归（zcode 认证探活 A 系列、codex 认证探活 C 系列、预检） | 83/83；系统临时目录无 `trivium-fpg-*` / `trivium-codex-auth-*` 残留 | — |
| 变异预跑（逐条带超时） | 13 条中 11 条咬住；M9（⑧ 改回内联 `Promise.all`）、M11（去掉 `TRIVIUM_DEBUG` 打印）如计划存活；源码逐字节恢复 | `mutation-spec.json` / `mutation-names-log.txt` / `mutation-names-output.json` |
| 变异装置（`scripts/mutation-check.mjs`） | 11/13 咬住，存活的同为 M9、M11（装置因此退 1）；基线全绿（1 个套件） | `mutation-output.txt` |
| 全量 `npm run check`（双审前） | 两次均 2656/2654/0/2，退 0 | `check-1.txt`、`check-2.txt` |
| 全量 `npm run check`（双审后） | 两次均 2656/2654/0/2，退 0 | `check-3.txt`、`check-4.txt` |
| `trivium doctor --selftest`（仓库 bundle `skills/dual-critic/scripts/trivium.cjs`） | 双审前后各一次，均 14/14、退 0 | `doctor-selftest.r1.txt`、`doctor-selftest.txt` |
| 代码双审后相关用例单跑（新用例、zcode / codex 认证探活、预检） | 95/95 | — |

## 5. 代码双审

run `20261003T170731Z`（约 8 分 11 秒）：codex `approve-with-nits`（次要 1、吹毛求疵 1）、gemini `approve`（零意见）、glm `approve`（零意见），接受 1、驳回 1（应答件 `.reviews/探活指纹读盘兜底/code/` 的 `response` 件），按接受项改码：

- CODEX-01（接受）：`AuthProbe.fingerprint` 的契约注释（`adapters/base.ts`）补一段——文件在而读不了就直接抛、由 `probeAuth` 统一兜，不要折成 null；zcode 现写法见 EV-203，别照抄。只改注释。
- CODEX-02（驳回）：指纹注明只进 detail、不标 `warn`、不进 `warnings`。这是 EV-197 / EV-200 起「探活一侧附加提示接在 detail 末尾」的一致口径，文本与 `--json` 都看得到；三条一起改进 `warnings` 是转述口径的统一决策，不在本题。

改码后的读数见 §4。

## 6. 残余

1. **zcode 指纹读不了折成 null 的窄格**（另登 EV-203，计划双审 AGY-01）：档位无模型时 `prepareZcodeHome` 不读副本源、走真实 HOME 退路，读不了的探活可以通过并写入 null 缓存，之后 TTL 内读不了仍命中、跳过探活且无提示（另有竞态一支）。按决策一 zcode 既有写法不动。
2. **残留提示随异常丢失**（EV-197 / EV-200 残余一）：适配器 `attempt` 抛错且临时目录删不掉时，删除提示在适配器的 finally 里、抛出路径不带它。本题之后不再崩预检（该侧落成「探活内部失败」），但提示仍丢。
3. **两条接线无用例咬**：M9（`runPreflight` 的 ⑧ 是否调 `probeAuthAll`）与 M11（`TRIVIUM_DEBUG` 打印）存活，如计划。
4. **读不了期间重复探活**（计划双审 CODEX-02）：见下节。

## 7. 成本

指纹读不了时不写缓存，**修好文件之前每次预检该侧都会重探一次**。codex 多数读不了的形态（`auth.json` 不可读、`config.toml` 成了目录）在准备隔离副本那一步就因同一个文件读不了而失败，到不了真实调用、不花配额（R1 / R2 即此形态）；agy 的 `agent.md` 读不了时会真拉起 agy、花一次配额。这是决策一的有意取舍（不可知的指纹不入缓存），RUNBOOK 已写明止烧方法（修好那个文件）。改前的行为是整个预检崩掉、一次都不探。
