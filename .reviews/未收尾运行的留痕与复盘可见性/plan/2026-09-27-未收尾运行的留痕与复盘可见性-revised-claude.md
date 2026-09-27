---
schema: trivium.disposition.v1
topic: 未收尾运行的留痕与复盘可见性
stage: plan
role: claude
kind: revised
run_id: 20260926T235951Z
addresses:
  - 2026-09-27-未收尾运行的留痕与复盘可见性-codex.md
  - 2026-09-27-未收尾运行的留痕与复盘可见性-gemini.md
  - 2026-09-27-未收尾运行的留痕与复盘可见性-glm.md
---

# 裁决：未收尾运行的留痕与复盘可见性 · 计划双审第 1 轮

> 被审对象：`2026-09-27-未收尾运行的留痕与复盘可见性-claude.md`（r1）
> ｜ 运行：`20260926T235951Z`（14m43s）
> ｜ 结论：codex `request-changes` ｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`
> ｜ 共 8 条：重要 1 ｜ 次要 2 ｜ 吹毛求疵 5 ｜ 零阻断
> ｜ **8 条全部接受**。同指一组：
>   - CODEX-01 ≡ GLM-01 ≡ AGY-02：status.json 读不到、worker.pid 指向的进程已死（`interpretStatus` 判 `pid_gone`）时，§3.3 的改写前判定因 `workerConfirmedGone(null)` 首行短路而放弃收尾，计划还把这一格错归为 `no_status_file`。

## 0. 本轮的形状

焦点五项三侧都核过，结论一致的部分：
- **① worker 异常那条路**：`workerGone: true` 的替代论证、「仍为 running 才写」（W2 的 :1627 / :1628 时序）、排在 `patchStatus` 之前，三侧都认为成立。
- **② 交错与锁**：glm 独立枚举了四类写者的两两组合，确认会双写的只剩「`--cancel` 对 `--wait`」一格；`taskLockName` 是独立锁名，不会与 worker 长持的运行锁自锁；EV-128 用例里没有「不是 cancelled」字样的断言，行为不变的论证成立；提交锚与 EV-133 相容。
- **③ `termination`**：只存结构化字段的取舍三侧都认同（P2 的绝对路径、密钥扫描拦截会把整次收尾拖回 running）。
- **④ ②′**：集合定义与 `enumerateRounds`「同轮次号最晚者胜出」相符；P1「入选侧全部失败今天看不见」经 `runner.ts` :363-364 → `review.ts` :1250-1257 证实。
- **⑤ 验证与行号**：M1～M16 逐条可区分，M2 / M6 / M7 三个难点三侧都认为咬得住；glm 独立复跑归档普查，恰为 4 份历史 running（外加本轮自己的骨架）；§1 与 §5 锚点抽查全部命中。

问题集中在一处：**我把「status.json 读不到」整格当成了「没有证据」**。`interpretStatus` 情形 A 在 status.json 读不到时会拿 `worker.pid` 判进程，判得出「已死」就报 `pid_gone`——证据是有的，只是 `workerConfirmedGone` 不看它。worker 在第一次写 status.json 之前就死掉（派生 → `rebuildContext` → 首次 `patchStatus` 之间），正是这一格；而 `--wait` 随即把 status.json 写成终态，之后再没有写者，run.json 永远停在 running——恰是本主题要消灭的症状。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 属实（已核 `status.ts` :159 首行短路、:208-220 情形 A、`run-protocol.ts` :616-621 `fallbackPid` 取自 worker.pid）。取 codex 与 glm 共同倾向的 (a)：证据已在手，不写没有道理。`processAlive(pid, null)` 在不给启动时刻时，进程活着一律判「同一进程」、只有真的不存在才判死（`util/exec.ts` :326-347 已核），所以只会在「worker.pid 指向的进程确实不在」时写，PID 被复用成别的活进程时照样不写，方向保守 | r2 §3.3：改写前判定拆成两格——`pre` 非空时照旧 `workerConfirmedGone(pre, fallbackPid)`；`pre` 为空而 `fallbackPid` 已知时，用与情形 A 同源的 `processAlive(fallbackPid, null)`，确认不存在才写，身份取交接文件（`readHandoffIdentity`）。`workerConfirmedGone` 本体与 :680 的 EV-20 抹除判定都不动。§3.3「确认不了」清单改为按真实形态列：`heartbeat_stale` 且进程在、status.json 读不到且连 pid 都没有（`no_status_file`）、非终态却拿不到 pid。§3.4 第一行不再有例外。§4.2 补 L5（无 status.json、worker.pid 指向已死进程、有交接文件与 v2 骨架 ⇒ run.json `failed`、`reason: pid_gone`）；§4.3 补 M17（去掉这一格 ⇒ L5 红） |
| CODEX-02 | codex | minor | 接受 | 属实：`--cancel` 撞进 worker `catch` 的两次写之间时，run.json 已是 `failed`，`--cancel` 第二步按「目标终态 cancelled」跳过，task.json 登记停在 running，此后没有写者。窗口极小、后果轻（`report` 与提交锚以 run.json 为准），与 W2 同类，不修，但要点名 | r2 §3.4 第三行注明「不会两边都写」只说 run.json，并写出 task.json 的后果；§6.2 在 W2 那条旁补这一例 |
| CODEX-03 | codex | nit | 接受 | 属实：计划没写回滚成本。结论是好的——纯追加（可选字段 + 读侧新表），旧代码下带 `termination` 的 run.json 照样过校验（顶层 `additionalProperties: true`），回滚即 revert、无迁移 | r2 §6.1 加一行回滚核算 |
| CODEX-04 | codex | nit | 接受 | 属实：`reason` 三值是 `StatusReading` 联合的第二份拷贝，将来 `interpretStatus` 加第四种原因时 schema 不会报错，写出的 run.json 反而不合契约、被 `readRunMeta` 读成 null——与「两份事实源改一漏二」同形。只写注释防不住，改成用例守 | r2 §3.5：`status.ts` 导出 `WORKER_LOST_REASONS` 常量数组，`StatusReading` 的 `reason` 由它派生；§4.1 补 S2（run.v2 schema 里 `termination.reason` 的枚举与该常量逐项相等）；schema description 与 `types.ts` 注释写明同步关系 |
| AGY-01 | gemini | nit | 接受 | 属实：§3.3 同时写了「报错正文追加两步结果」与「`reportFinalizeStep` 传后缀参数」，两条通道都开会在 stderr 重复一遍。`--wait` 失联本来就以抛错收场，报错正文是唯一会被转述的出口 | r2 §3.3：`worker_lost` 分支**只**把两步结果拼进抛出的报错正文（异常转成的跳过带「这一步没有第二次机会、请人工核对」），不调 `reportFinalizeStep`；`reportFinalizeStep` 维持只服务 `--cancel`，删掉「传后缀参数」那一句 |
| AGY-02 | gemini | nit | 接受 | 属实，与 CODEX-01 同指：r1 把 status.json 读不到整格等同于 `no_status_file`，而带 `fallbackPid` 且进程已死时实际 reason 是 `pid_gone`。gemini 建议维持保守只改措辞；按 CODEX-01 取 (a) 后这一格改为可写，措辞随之按真实形态重列 | 同 CODEX-01 的 r2 §3.3 落点 |
| GLM-01 | glm | minor | 接受 | 同 CODEX-01。glm 另指出一处后果：r1 下报错正文会同时出现「失联（pid_gone）」与「未确认退出、未回写」两句互相矛盾的话；取 (a) 后这一格不再出现该组合，其余「未确认」的情形 reason 都不是 `pid_gone` | 同 CODEX-01 的 r2 §3.3 落点；L5 断言报错正文不含「未确认退出」 |
| GLM-02 | glm | nit | 接受 | 属实：A6 把「合计 4 条」写成定数，而本主题自己在验收前后还会产生运行（本轮计划双审的骨架就是第 5 个 running 命中），会假红或被「如实改写」顺手放过真回归 | r2 §4.4 A6：先跑一次只读普查，断言 `unlistedRuns` = §2.1 的 4 份历史留痕 + 本主题自身在验收时点尚无审查文档的运行（逐条核对 label）；「新旧构建 `rounds` 逐主题深相等」保持为主判据；§4.4 开头「预期先按代码核实」的范围扩到 A6 |

## 2. 不改的部分

- D1～D8 的取向三侧都认同，不变；CODEX-01 只把 D2 (a) 的「确认退出」判定补全一格，没有改变「改写前判定、确认不了就不写、:680 不动」这三条。
- 第一步进主题任务锁、`termination` 只存结构化字段、第二步只同步同一终态、②′ 的集合定义与说明，都不变。
- 无驳回、无暂缓。

## 3. 下一步

用户审批通过后，按本件落点把原稿修订为 r2 定稿（`…-r2-claude.md`），先提交计划，再实施。
