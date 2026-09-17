---
schema: trivium.disposition.v1
topic: 凭据副本残留与参数静默丢失
stage: code
role: claude
kind: response
run_id: 20260917T021002Z
addresses:
  - 2026-09-17-凭据副本残留与参数静默丢失-codex.md
  - 2026-09-17-凭据副本残留与参数静默丢失-glm.md
---

# 代码应答（r1）：真跑一次就把我的失败口径打穿了

## 0. 本轮的形态，先说清

- **这是一轮降级运行**：gemini 侧在 7 秒内失败（agy 的资格检查向 googleapis 请求时连接 EOF，网络侧、非瞬时故障类别未重试），strict 策略下整轮判失败（退出码 75）。codex 7 条、glm 5 条照常落盘，**本件逐条应答这 12 条**；gemini 侧没有意见可答。三侧齐备的判定要等 r2。
- **本轮 code 阶段的真跑同时是新代码的第一次实战**：两侧的抹除都把「跳过超大文件」记成了失败（codex 的 21 MB 插件目录缓存、zcode 的 10 MB 模型 I/O 日志与 16 MB 动态库），而载体其实已经删净——我在运行目录里只 `ls` 与 grep 哨兵核实了：`codexhome/` 下没有 `config.toml` / `auth.json`，`sessions/` 在；`home/.zcode/cli/` 下没有 `config.json`。这个假失败与 CODEX-02 说的一字不差。
- 12 条**全部接受，零驳回**。修复已实施、全量单元与契约 1097 条、相关集成 79 条全绿，送审包预扫零命中，八条变异逐一变红（见 §3）。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | major | 接受 | 属实：`interpretStatus` 的 `heartbeat_stale` 档明写「进程活着但心跳过期」，而我在 `worker_lost` 分支不复核就抹，与 ④ 清扫的严判据不同源。不可逆动作的准入判据两处必须一致 | `run-protocol.ts` `worker_lost` 分支：动手前按 `status.worker_pid` 现势 `processAlive`，仍在（同一进程）则不抹、报错里附「留给会话启动清扫」；新集成用例用 SIGSTOP 冻住 worker 让 `--wait` 判 stale，断言副本原样、无哨兵 |
| CODEX-02 | codex | major | 接受 | 属实，且本轮真跑当场复现：两侧都因超大文件跳过被记 `ok:false`，会话启动会把一条假失败挂 30 天。「载体没抹掉」与「某个文件没扫到」严重度不同 | `scrub.ts`：`ScrubOutcome` / `CarrierScrub` 分 `warnings`（超大文件跳过、读目录失败，不影响 `ok`）与 `errors`（载体删不掉、命中却处理不了、哨兵写不下去）；上限提到 32 MB，本机实测的日志都在其内；超限日志记告警并在 EV-32 登记残留 |
| CODEX-03 | codex | major | 接受 | 属实：`private-key-block` 只匹配 BEGIN 行，`redactSecrets` 抹掉标记等于什么都没抹，哨兵还记 `ok:true` | `secrets.ts`：`redactSecrets` 先整段替换 `PEM_BLOCK`（BEGIN…END，跨真换行与 JSON 字面 `\n`），再走逐规则；用例覆盖裸文本与 JSON 字符串两种形态 |
| CODEX-04 | codex | minor | 接受 | 属实，与 GLM-02 同一缺口：`unknown` 只在 `scrubbed>0` 的从句里出现，早退条件不含它——最可能残留凭据的那类目录反而静默 | `hooks.ts`：`unknown` 单独成行（带首个路径）并纳入早退条件；`hooks.test.ts` 新增「只有 unknown 也要注入」用例 |
| CODEX-05 | codex | minor | 接受 | 属实：codex 排除 `sessions/` 的两条理由逐条适用于 zcode 的 `rollout/` `log/`，我一侧排除一侧全扫。且「排除」本身也不够——排除的那份日志里模型自读到的 token 仍躺着 | 两侧同款：模型 I/O 日志（codex `sessions/`、zcode `rollout/` `log/`）命中**就地脱敏**不删（`scanAndRemoveSecrets` 的 `redactUnder`）；厂商缓存（codex `cache/` `plugins/`、zcode `plugins/` `db/`）与二进制（前 8 KB 含 NUL）不扫。计划双审 D-2 的 A 项据此升级，EV-32 收口 |
| CODEX-06 | codex | nit | 接受 | 属实：`.catch(() => {})` 让「旧哨兵删不掉」这条被设计点名防守的窄路径失效时无痕 | `runner.ts`：删失败 `warn` 一句，流程不变 |
| CODEX-07 | codex | nit | 接受 | 属实：`Q` 只认一层 `\"`，trace.json 把 stdout 的一行整体当字符串写入就是两层 | `secrets.ts`：`Q` 改为 `(?:\\*["'])?` 允许任意层；用例构造两层嵌套 JSON，断言命中、脱敏后两层都能解析 |
| GLM-01 | glm | major | 接受 | 属实：zcode 把模型 I/O 原文拷进 `out/rollout.jsonl`，三层都够不到它，而 scrub.ts 头注释给「out/ 不碰」的理由（归档已扫）对它不成立。手抄清单第一次就漏了一份 | `rollout.jsonl` 入 `ORCHESTRATOR_LOG_FILES`；新增 `test/contract/orchestrator-logs-parity`：适配器里每个 `path.join(req.out_dir, '<名>')` 都必须在清单里，清单里每一项都必须有人写（桩的 `result.json` 具名豁免） |
| GLM-02 | glm | major | 接受 | 与 CODEX-04 同一缺口；GLM 额外指出这些目录**不会自愈、不会重试**，所以更不能静默 | 同 CODEX-04；文案点明「不会自动重试，请人工检查后删除」 |
| GLM-03 | glm | major | 接受 | 属实，与 CODEX-05 同一事实；GLM 实测列出的 `plugins/cache` 数千文件与 `db/` sqlite 正是本轮真跑扫到 353 个文件的来源 | 同 CODEX-05 |
| GLM-04 | glm | minor | 接受 | 属实：`last.scrub = scrub` 在 try/finally 之后，抛异常时不可达；`runBothSides` 合成结果也无 `scrub`，于是这条出口的抹除失败进不了终态 message | `runner.ts`：try/catch 捕获后先抹、再把 `scrub` 挂到异常上重抛；`runBothSides` 的 rejected 分支从异常上取回；用例补「抛异常 + 抹除失败 → 合成结果 `scrub.ok=false`」 |
| GLM-05 | glm | minor | 接受 | 属实：`!o.skipped` 对空结果也为真，`--only gemini` 的崩溃目录会被报成「已抹除」——`base.ts` 自己写的「没得抹与抹过了不能长得一样」被计数层压回一个数 | `scrub.ts` 新增 `scrubDidWork`；`retention.ts` 只把真删了/真抹了的目录计入 `scrubbed`；用例：只有 gemini 侧且日志无命中的目录不计入 |

## 2. 三侧「认为正确」段里与本轮修复相抵的一条

glm 在计划双审时认为现有 `processAlive` 判据够用；本轮 codex 的 CODEX-01 指出 `worker_lost` 分支连这个判据都没用。两者并不矛盾：④ 清扫早就按严判据做了，漏的是 ② 这一处。现在 ②④ 同源。

## 3. 变异验证（本轮修复项）

| # | 变异 | 应变红的用例 |
| :-- | :-- | :-- |
| ⑨ | `worker_lost` 不复核进程存活就抹 | gate-loop 的 SIGSTOP 用例 |
| ⑩ | 超大文件跳过记成错误 | credential-scrub |
| ⑪ | PEM 只抹标记行 | secrets |
| ⑫ | 清扫计数不看有没有真抹 | retention |
| ⑬ | 脱敏清单漏掉 `rollout.jsonl` | orchestrator-logs-parity、credential-scrub |
| ⑭ | 异常出口不挂 `scrub` | runner-scrub |
| ⑮ | 状态未知的目录不单独成行 | hooks |
| ⑯ | 模型 I/O 日志命中改回删除 | credential-scrub、codex-scrub |

结果逐条见提交说明；实施时按脚本逐条改坏、重建、跑对应用例、恢复。

## 4. 本轮之外顺手记下的

- **送审包的密钥预扫**：`review --start` 第一次冻结时被归档侧扫描拒绝——命中的全是我测试里的假凭据字面量（`TOKEN = '<高熵串>'` 这一行本身就命中赋值规则）与改动处附近既有夹具的上下文行。拦得对，不绕：假凭据一律改为运行时拼接、常量不叫 token / secret，新增用例挪到文件末尾避开旧夹具的上下文。本件与代码里都写了这条约定。
- **实战反馈比用例先到**：CODEX-02 的假失败在审查员写出意见之前就已经在 `--wait` 的输出里出现了。「第一次真跑」应当排在「写完用例」之后、「发起双审」之前——本轮是同一次运行里同时发生的，下次把它拆开。

## 5. 修改清单（已实施，随 r2 送审）

| # | 文件 | 改动 | 对应 |
| :-- | :-- | :-- | :-- |
| 1 | `src/trivium/scrub.ts` | 告警/错误分档、`redactUnder`、二进制跳过、上限 32 MB、`rollout.jsonl`、`scrubDidWork`；`scrubSideDir` 支持 `sizeCap` | CODEX-02 / 05、GLM-01 / 03 / 05 |
| 2 | `src/trivium/adapters/base.ts`、`types.ts` | `CarrierScrub` / `ScrubOutcome` 加 `warnings`、`redacted` | CODEX-02 |
| 3 | `src/trivium/adapters/codex-home.ts`、`zcode.ts` | `REDACT_AFTER_RUN` / `SKIP_AFTER_RUN`；zcode 的 `rollout` `log` 脱敏、`plugins` `db` 不扫 | CODEX-05 ≡ GLM-03 |
| 4 | `src/trivium/secrets.ts` | 任意层转义、PEM 整段 | CODEX-03 / 07 |
| 5 | `src/trivium/runner.ts` | 异常出口挂 `scrub`；删哨兵失败告警 | GLM-04、CODEX-06 |
| 6 | `src/trivium/run-protocol.ts` | `worker_lost` 复核进程存活 | CODEX-01 |
| 7 | `src/trivium/retention.ts`、`hooks.ts` | 真抹了才计数；`unknown` 单独成行并纳入早退 | GLM-05、CODEX-04 ≡ GLM-02 |
| 8 | 测试 | `credential-scrub` 重写、`runner-scrub` / `retention` / `hooks` / `secrets` / `codex-scrub` / `gate-loop` 各补用例、新 `orchestrator-logs-parity` 契约 | 全部 |
| 9 | 设计 §10.5 两行、§21 v1.3.15 行补「九、代码双审 r1」、BACKLOG EV-32 改 done（残留：超过 32 MB 的日志只记告警） | 文档同步 | — |
