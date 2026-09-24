# EV-112 E2 真实配额验收读数（2026-09-25）

- **被验代码**：`1d80e23`，安装副本同版（`trivium doctor --only env --no-model-calls`：构建标识 1d80e23，本仓模式一致）
- **运行**：run `20260924T172304Z`，主题 `EV-112-E2验收`（plan 阶段，**单侧 glm**），耗时 16m42s；被审对象是一份短载体稿
- **进入无副本一支的方式**：用户授权由 Claude 执行——审查运行期间把 `~/.zcode/cli/config.json` 改名为 `config.json.ev112-e2`
  （2026-09-24T17:22:37Z 挪开，17:39:51Z 挪回；只改名、不读不改内容）
- **核对脚本与输出**：`e2-check.mjs` / `e2-output.json`（同目录；只读，只输出字段值、文件名与计数）
- **依据**：计划 `.reviews/EV-112-无副本审查运行载体落点/plan/` r3 §6.3 E2；载体稿审查意见 GLM-01～08 的补核格

## 一个先于读数的更正：「未指定模型」这一成因在流水线里走不到

`review.ts` 在派发前对 `routeModel` 返回 null 直接抛错（「glm 侧没有可用模型……」），预检 `preflight.ts` 同样先拦。
所以无副本一支在流水线里**唯一可达的成因是副本源缺失**；计划 r3 C1、§1.4 与设计 / RUNBOOK / BACKLOG 写的「未指定模型 / 副本源缺失」两种成因，前一种不成立。
适配器里那条分支保留无害。本轮也据此只用「挪开副本源」一种方式进入。

## 判据与读数

| # | 判据 | 读数 | 结果 |
| :-- | :-- | :-- | :-- |
| 1 | 确实走的无副本一支（GLM-03） | trace `modelSelection.reason` =「未找到 /Users/…/.zcode/cli/config.json，无法做模型覆盖；将沿用 ZCode CLI 的全局默认」；`model_route: global`；`model_override_applied` 字段缺席 | ✓ |
| 2 | 生效模型读得回 | `model_effective` = `84044858-…/qwen3.8-max`，来源 `trace` | ✓（首次读数，无基线可比；见下「附带观测」） |
| 3 | 落点自检 | `carriers_landed` = `{ log: true, rollout: true, leaked_to_home: { log: false, rollout: false } }`；收尾 `message` 为空（守卫无播报），`gate.warnings` 为空 | ✓ |
| 4 | 走到了工具调用（GLM-08） | 工具调用 27 次（read 15、grep 11、glob 1），`project_reads` 13，`evidence_ok: true` | ✓ |
| 5 | 运行目录正查 | `glm/home/.zcode/cli/` 下 log 1、rollout 1、db 1、memories 1（`projects/triviumcode-2217d5056b753581`）、plugins；**会话库里本次 sessionId 出现 576 次**（GLM-04，内容级） | ✓ |
| 6 | artifacts | 运行目录与真实 HOME 下都没有 `artifacts/` | **未观测到**（见下） |
| 7 | 没有 beta 改写 | 运行目录下无 `.zcode-beta/` | ✓ |
| 8 | 真实 HOME 未被写入 | `~/.zcode/cli/log` 里窗口内改过的 1 个文件不含本次会话；rollout / artifacts / sessions 下无本次会话；`db.sqlite` 及 `-wal` / `-shm` 里本次 sessionId 0 次；`memories/projects` 下窗口内无改动（GLM-01） | ✓ |
| 9 | 清扫（GLM-07） | `glm/scrub.json`：`ok: true`、`complete: true`、`errors: []`；`logs_redacted` 为空——log / rollout 里没有凭据形态可脱敏，不是没扫 | ✓（按字面「记了脱敏」不成立：本轮无命中可记） |
| 10 | 前置：个人 provider 配置在（GLM-05） | `~/.zcode/v2/provider_config.json` 存在（只核存在性）；无副本支靠它选模型、消耗真实配额 | ✓ |
| 11 | 副本源已复原（GLM-02） | `config.json` 在位，大小 1140 字节、修改时间 2026-09-20T11:12:00Z 与挪开前一致；无 `.ev112-e2` 残留 | ✓（挪开前**没有记哈希**，复原依据是「只改名」加大小与时间不变） |

### 关于第 6 格

glm 这一轮做了 27 次工具调用，但运行目录与真实 HOME 下都没有出现 `artifacts/`。推测 artifacts 只收超长的工具结果（本轮都是短读取），**未核**。
所以 artifacts 与 workflow（`sessions/`）两格仍只有静态读数与假入口用例支撑；memories 这一格由本轮升为实测（落在运行目录、真实 HOME 窗口内无改动）。

### 关于第 8 格里「窗口内改过的 1 个日志文件」（GLM-06）

挪开副本源之后我才跑预检，副本源指纹变化使 zcode 探活缓存失效、触发了一次真实探活；探活按设计在真实 HOME 下跑、不设落点（EV-115），
所以真实 `~/.zcode/cli/log` 在窗口内有改动。判定以本次 sessionId 的内容命中为准，这个文件里没有本次会话。以后同类操作应先预检、再挪开。

## 附带观测：无副本一支的「glm 审查员」实际跑的是 qwen

无副本一支不做模型覆盖，CLI 用个人 provider 配置的默认模型，本机是 `qwen3.8-max`。守卫只对「做了覆盖却没生效」出声，这一支没有覆盖尝试，所以静默。
后果是：副本源缺失时，glm 侧实际不是 GLM，FR-06 的模型路由与 NFR-06 的异构默认在这一侧都不成立，而留痕里只有 `model_requested: GLM-5.3` 与 `model_effective: …/qwen3.8-max` 两个字段可供对照。
这是 EV-82 以来「全局默认」的既有语义，不是 EV-112 引入的；登记为 BACKLOG EV-122，处置由用户定。

## 结论

EV-112 的核心判据在真实配额下成立：无副本一支的 CLI 日志、rollout、会话库与项目记忆落进运行目录，落点自检如实报全真、无泄漏，真实 HOME 按内容核零写入。
未覆盖：artifacts 与 workflow 两格（本轮未产生）。
