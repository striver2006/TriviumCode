# M11 第 11 步 · AC-23 真实验收报告

> - **日期**：2026-10-08
> - **依据**：M11 计划 r3（`.reviews/M11-档位全链路与文档收口/plan/`）§4.11、拍板 D-13；PRD AC-23（含 v1.4.19 达成边界）；主设计 11.5「`tier` / `tier_source` 的取值」「原生枚举与校验」、6.7.1 run.v2 档位字段；判据借用 [CASE 剧本 11](./CASE_manual_acceptance.md) 的 11.1～11.9
> - **起点**：本仓 HEAD `27cee526`；运行中的编排器是安装副本，构建标识 `df9abf4d`（`dirty: false`，四份 run.json 的 `snapshot.build.git_head` 同值）
> - **性质**：验收，不走双审，报告自审；零代码改动。证据与可重跑脚本在 [`evidence/m11-ac23-acceptance-20261008/`](./evidence/m11-ac23-acceptance-20261008/)
> - **配额**：上限 4 次真实审查，实际 4 次，每次只选被测的一侧（`--critics codex` 或 `--critics gemini`），无重跑。另有零配额的 doctor 与负对照
> - **结论**：判据 11.1～11.6、11.8、11.9 全部成立；11.7（可选的档位表格子 `{tier}` 形态）本步不做。**AC-23 在达成边界内验收通过**，达成状态随第 12 步收口再翻

---

## 0. 结论速览

| 次 | 发起方式 | run_id | tier / tier_source | 思考等级请求 → 生效（来源） | 结果 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | codex 选档 `--tier-codex high` | `20261008T121531Z` | `high` / `cli` | high → null（`unverified`） | 成立 |
| 2 | codex 精确 `--model-codex kimi-for-coding --effort-codex low` | `20261008T121745Z` | null / `override` | low → null（`unverified`） | 成立 |
| 3 | gemini 选档 `--tier-gemini low` | `20261008T122046Z` | `low` / `cli` | null → low（`envelope`） | 成立 |
| 4 | gemini 精确 `--model-gemini gemini-3.8-flash-medium --effort-gemini high` | `20261008T122226Z` | null / `override` | high → medium（`envelope`），预检与 `--start` 均告警「不生效」 | 成立 |

四次审查均 `status: success`、`review_mode: full`、单侧 `critics_selected`，结论都是 `approve-with-nits`（被审对象是夹具里的小计划，结论内容不在本步判据内）。

---

## 1. 准备

### 1.1 安装副本

| 项 | 读数 |
| :--- | :--- |
| 仓库构建 `skills/dual-critic/scripts/trivium.cjs` | sha256 `d6528d4f…`，嵌入 `git_head: 91c4d794…`，`dirty: false`，`inputs_sha256: 088d9590…` |
| 安装副本 `~/.claude/skills/dual-critic/scripts/trivium.cjs` | sha256 `b873bda3…`，嵌入 `git_head: df9abf4d…`，`dirty: false`，`inputs_sha256: 088d9590…` |
| 逐行 diff | 只差第 50 行构建标识（`git_head` 与 `built_at`），其余逐字节相同 |
| `git diff df9abf4d HEAD` 作用面（`src scripts skills-src package.json package-lock.json tsconfig.json`） | 空 |

判定：sha256 不同只因构建标识；作用面指纹一致、df9abf4d 之后作用面无改动，安装副本与 HEAD 代码等价，**不重装**。

### 1.2 夹具

按 D-b 在会话 scratchpad 建临时项目（[`build-fixture.sh`](./evidence/m11-ac23-acceptance-20261008/build-fixture.sh)）：四个文件的小 calc 模块，`trivium init` 后改 `.trivium/config.yaml`（D-d，夹具自己的共享配置；改后全文见 [`fixture-config.yaml`](./evidence/m11-ac23-acceptance-20261008/fixture-config.yaml)）：

| 键 | 值 | 说明 |
| :--- | :--- | :--- |
| `agents.codex.profile` | `kimi` | 与本仓一致（init 缺省是 qwen）；档位里的 profile 也写 kimi，规避 EV-229（探活只按 `agents.codex.profile` 探） |
| `agents.codex.tiers` | `low: {kimi-for-coding, low, kimi}`，`high: {kimi-for-coding, high, kimi}` | 思考等级取 `probe.cli.codex.reasoning_levels.by_profile.kimi` 里该模型列出的值（low / high / max） |
| `agents.gemini.tiers` | `low: {model: gemini-3.8-flash-low}`，`medium: {model: gemini-3.8-flash-medium}` | gemini 的档写带后缀的模型名、不写 effort |
| `profiles.default.codex.*` | `kimi-for-coding`（裸模型名） | 档位表格子保持 init 缺省形态 |
| `profiles.default.gemini.*` | `gemini-3.8-flash-high`（裸模型名，init 缺省） | 同上 |

四次审查各用一个主题（`ac23-codex-tier` / `ac23-codex-exact` / `ac23-gemini-tier` / `ac23-gemini-exact`），被审对象是同一份计划原稿（[`plan-subject.md`](./evidence/m11-ac23-acceptance-20261008/plan-subject.md)），阶段 plan、命令 B、Driver claude。

### 1.3 探针：照搬本仓（偏离，用户 2026-10-08 拍板）

夹具跑 `doctor --no-model-calls` 无阻断（[`doctor-no-model-calls.txt`](./evidence/m11-ac23-acceptance-20261008/doctor-no-model-calls.txt)），但首轮负对照四条**全部**在「只读能力可用」退 69（[`negative-controls-before-probe-merge.txt`](./evidence/m11-ac23-acceptance-20261008/negative-controls-before-probe-merge.txt)）：新项目里需要真实调用才得出的结论（codex 的 `readonly_flags`、agy 的 `headless_read_ok`、zcode 的 headless 结论）在 `--no-model-calls` 下没有，预检在档位两格之前就停了。

用户在「夹具跑带模型调用的 doctor（少量配额、不计入 4 次）」与「照搬本仓探针（零配额）」之间选了后者。[`merge-probe.cjs`](./evidence/m11-ac23-acceptance-20261008/merge-probe.cjs) 先比对、后落盘：两边 CLI 版本（claude 2.1.291、codex 0.160.1、agy 1.3.1、zcode 0.16.9）、codex profile 名单、kimi 逐模型思考等级表、agy 模型目录、host 段全部一致；然后把本仓本机层的 `probe.cli` 与 `probe.host` 原样拷进夹具本机层（本仓 codex / agy / zcode 段探于 2026-10-08T02:02Z，在 7 天 TTL 内）。**`probe.auth` 不拷**，由各次预检自己探活。

### 1.4 负对照（判据 11.1）

[`negative-controls.txt`](./evidence/m11-ac23-acceptance-20261008/negative-controls.txt)（脚本 [`neg.sh`](./evidence/m11-ac23-acceptance-20261008/neg.sh)，零配额）：

| # | 命令（`preflight --stage plan`） | 期望 | 实际 | 停在哪一格 / 原文要点 | 结果 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| N1 | `--critics codex,gemini --tier-codex medium` | 64 | 64 | 「模型 slug 合法」：档位「medium」（经命令行指定）未在 agents.codex.tiers 定义。可用：low, high | 成立 |
| N2 | `--critics codex,gemini --effort-codex medium` | 64 | 64 | 「档位组合合法」：思考等级「medium」不在模型「kimi-for-coding」的原生枚举中。可用值：low, high, max | 成立 |
| N3 | `--critics codex,glm --effort-glm high` | 64 | 64 | 「档位组合合法」：ZCode 不支持思考等级，档位 / 档位表却给了「high」。去掉该 effort | 成立 |
| N4 | `--critics codex,gemini --profile-codex nosuchprofile` | 69 | 69 | 「只读能力可用」：本轮的 codex 厂商 profile「nosuchprofile」在本机不存在。已探测到的：deepseek、glm、gpt、kimi、qwen（EV-232 形态） | 成立 |

前后对照：归档根只有 `.reviews/README.md`、运行根条目数 13 → 13、`git status` 前后皆空——**零工件**。11.1 成立。

---

## 2. 逐次核对

读数出处：`〈名称〉-run.json`（归档阶段目录 `_meta/` 下的运行记录原样）、`〈名称〉-review-front-matter.md`（审查文档只收 front-matter）、`〈名称〉-report.txt`（`trivium report --topic` 全文）、`〈名称〉-ps.txt`（审查进行中每 3 秒采样）、`〈名称〉-preflight.json` / `-start.json`（告警）。front-matter 按设计 §6.5 不含 `profile_requested` / `model_provider` 与顶层 `profile`，这三项只在 run.json 核。

### 2.1 第 1 次 · codex 选档（`--tier-codex high`，run `20261008T121531Z`）

| 字段 | run.json | front-matter | 期望（出处） | 结果 |
| :--- | :--- | :--- | :--- | :--- |
| `model_requested` | kimi-for-coding | kimi-for-coding | 档位 high 的 model（11.2） | 成立 |
| `model_effective` / `_source` | kimi-for-coding / `trace` | 同 | 回读值（AC-13） | 成立 |
| `effort_requested` | high | high | 档位 high 的 effort（11.2） | 成立 |
| `effort_effective` / `_source` | null / `unverified` | 同 | codex 恒 null + unverified，不拿请求值充数（11.6、6.7.1） | 成立 |
| `tier` / `tier_source` | `high` / `cli` | 同 | 选档 ⇒ 所选档、`cli`（11.2、11.5） | 成立 |
| `profile_requested` | kimi | — | 档位 high 的 profile（11.2） | 成立 |
| `model_provider` | kimi | — | 回读的 provider 家族 | 成立 |
| 顶层 `profile` | default | — | 本轮档位表名（11.8） | 成立 |
| 旧名 `effort` | high | high | 与 `effort_requested` 同值并写（6.7.1） | 成立 |

- **11.3 子进程参数**：`codex exec -p kimi -m kimi-for-coding -c model_reasoning_effort=high -s read-only --json …`（[`codex-tier-ps.txt`](./evidence/m11-ac23-acceptance-20261008/codex-tier-ps.txt)）——含该档的 effort 与 profile。成立。
- **11.9 report 第四节**：`plan r1 ｜ codex ｜ kimi-for-coding ｜ kimi-for-coding ｜ high ｜ **未回读到** ｜ ok`——请求列与 `effort_requested` 一致，生效列是 null 的「明确记空」写法（加粗「未回读到」），没有用请求值顶替。成立。
- 告警：预检与 `--start` 均为空。

### 2.2 第 2 次 · codex 精确指定（`--model-codex kimi-for-coding --effort-codex low`，run `20261008T121745Z`）

| 字段 | run.json | front-matter | 期望（出处） | 结果 |
| :--- | :--- | :--- | :--- | :--- |
| `model_requested` | kimi-for-coding | kimi-for-coding | 命令行值 | 成立 |
| `model_effective` / `_source` | kimi-for-coding / `trace` | 同 | 回读值 | 成立 |
| `effort_requested` | low | low | 命令行值（11.4） | 成立 |
| `effort_effective` / `_source` | null / `unverified` | 同 | 11.6 | 成立 |
| `tier` / `tier_source` | null / `override` | 同 | 基础组合是裸模型名格子、只提供模型，被精确值全部盖掉（11.4、11.5） | 成立 |
| `profile_requested` | kimi | — | 无档位、无 `--profile-codex` ⇒ `agents.codex.profile`（11.5 三层解析） | 成立 |
| `model_provider` | kimi | — | 回读 | 成立 |
| 顶层 `profile` | default | — | 11.8 | 成立 |

- **子进程参数**：`codex exec -p kimi -m kimi-for-coding -c model_reasoning_effort=low -s read-only …`（[`codex-exact-ps.txt`](./evidence/m11-ac23-acceptance-20261008/codex-exact-ps.txt)）——命令行的思考等级照下传。
- **11.9**：`low ｜ **未回读到**`，与 run.json 一致。成立。
- 告警：均为空（格子是裸模型名，不来自档位，覆盖不触发「覆盖了档位」告警——与 `resolveTier` 只在被覆盖字段来自档位时告警一致）。

### 2.3 第 3 次 · gemini 选档（`--tier-gemini low`，run `20261008T122046Z`）

| 字段 | run.json | front-matter | 期望（出处） | 结果 |
| :--- | :--- | :--- | :--- | :--- |
| `model_requested` | gemini-3.8-flash-low | 同 | 档位 low 的 model（11.2） | 成立 |
| `model_effective` / `_source` | gemini-3.8-flash-low / `envelope` | 同 | 回执回读 | 成立 |
| `effort_requested` | null | null | 档位里没写 effort ⇒ 无请求值；档位不回落 `agents.gemini.effort`（那只对裸 slug 格子生效，11.5） | 成立 |
| `effort_effective` / `_source` | low / `envelope` | 同 | 回执 slug 的档位后缀（11.5、6.7.1） | 成立 |
| `tier` / `tier_source` | `low` / `cli` | 同 | 11.2 | 成立 |
| `profile_requested` / `model_provider` | null / null | — | gemini 无厂商 profile 概念 | 成立 |
| 顶层 `profile` | default | — | 11.8 | 成立 |
| 旧名 `effort` | 缺席 | 缺席 | 只在有值时出现（6.7.1） | 成立 |

- **agy 参数**：`… --model gemini-3.8-flash-low --agent trivium-critic …`，无 `--effort`（[`gemini-tier-ps.txt`](./evidence/m11-ac23-acceptance-20261008/gemini-tier-ps.txt)）。
- **11.9**：`（未请求） ｜ low`——请求列是 null 的明确记空写法，生效列取回读值。成立。
- 告警：均为空。

### 2.4 第 4 次 · gemini 精确指定 + 与后缀不同的思考等级（`--model-gemini gemini-3.8-flash-medium --effort-gemini high`，run `20261008T122226Z`）

| 字段 | run.json | front-matter | 期望（出处） | 结果 |
| :--- | :--- | :--- | :--- | :--- |
| `model_requested` | gemini-3.8-flash-medium | 同 | 命令行值 | 成立 |
| `model_effective` / `_source` | gemini-3.8-flash-medium / `envelope` | 同 | 回执回读 | 成立 |
| `effort_requested` | high | high | 命令行值照记（11.4、11.5） | 成立 |
| `effort_effective` / `_source` | medium / `envelope` | 同 | 取实际模型名的档位后缀，**不取请求值**（11.5；PRD AC-23「请求值另记、两者不得混淆」） | 成立 |
| `tier` / `tier_source` | null / `override` | 同 | 裸模型名格子被精确值全部盖掉（11.4） | 成立 |
| `profile_requested` / `model_provider` | null / null | — | 无此概念 | 成立 |
| 顶层 `profile` | default | — | 11.8 | 成立 |
| 旧名 `effort` | high | high | 与 `effort_requested` 同值 | 成立 |

- **11.5 告警**：预检与 `--start` 的 `warnings` 都有一条「档位组合合法」：`⚠️ gemini/plan: 模型「gemini-3.8-flash-medium」的 slug 已编码档位，思考等级「high」不生效`（[`gemini-exact-preflight.json`](./evidence/m11-ac23-acceptance-20261008/gemini-exact-preflight.json)、[`gemini-exact-start.json`](./evidence/m11-ac23-acceptance-20261008/gemini-exact-start.json)）；不阻断。
- **agy 参数**：`… --model gemini-3.8-flash-medium --agent trivium-critic …`，**无 `--effort`**（[`gemini-exact-ps.txt`](./evidence/m11-ac23-acceptance-20261008/gemini-exact-ps.txt)）——「只告警、不下传」与 RUNBOOK §五一致。
- **11.9**：`high ｜ medium ⚠️`——两列分别等于 `effort_requested` 与 `effort_effective`，两者不等时的 ⚠️ 对比标记按 13.2.1 出现。成立。

---

## 3. 判据汇总

| # | 判据（CASE 剧本 11） | 结果 | 出处 |
| :--- | :--- | :--- | :--- |
| 11.1 | 负对照三条 64、一条 69，点名原因并列可用值，零工件 | 成立 | §1.4 |
| 11.2 | 选档：`tier` = 所选档、`tier_source` = `cli`；请求值等于档里写的值；codex `profile_requested` 等于档的 profile | 成立 | §2.1、§2.3 |
| 11.3 | codex 选档的子进程含 `-c model_reasoning_effort=high` 与 `-p kimi` | 成立 | §2.1 |
| 11.4 | 精确指定：`tier: null`、`tier_source: override`；`effort_requested` 等于命令行值 | 成立 | §2.2、§2.4 |
| 11.5 | gemini `effort_effective` 等于实际模型名的后缀、来源 `envelope`；另给的 `--effort-gemini` 只告警，请求值照记 | 成立 | §2.3、§2.4 |
| 11.6 | codex `effort_effective: null`、来源 `unverified` | 成立 | §2.1、§2.2 |
| 11.7 | （可选）档位表格子 `{tier}` 形态 | 未做 | 不在本步范围（D-a 定 4 次） |
| 11.8 | front-matter 档位与思考等级一组与 run.json 同值；顶层 `profile` 是档位表名 | 成立 | §2 各表 front-matter 列 |
| 11.9 | report 第四节请求 / 生效两列与 run.json 一致，null 与缺席分写 | 成立 | §2 各节 |

对照 PRD AC-23 的两个 Given：①「选档」与「精确指定」两种方式在 gemini、codex 各发起一次，生效模型、档位来源、请求思考等级都入档且三处（run.json、front-matter、report）一致；生效思考等级在 gemini 侧回读入档（两次分别为 low、medium，均取自回执），codex 侧按达成边界记 null + `unverified`。②「归并后生效值入档、请求值另记」：本次没有观察到厂商归并；第 4 次是同形的对照——请求 high、实际按 slug 跑 medium，两值分记、生效值取回读，没有混淆。codex 侧的服务端归并客户端看不到（达成边界），本步不判。

---

## 4. 与剧本 11 的偏离

| 项 | 剧本写法 | 本步做法 | 理由 |
| :--- | :--- | :--- | :--- |
| 每轮侧数 | `--critics codex,gemini` 两侧同轮 | 每次只选被测的一侧 | 用户定：一次运行只花一侧配额 |
| 主题 | 同主题多轮 | 每次一个主题 | 互不影响、免去闸门期与下一轮计划的牵连 |
| 停点 | 走到停点 | 跑到 `--wait` 退 0（审查文档与元数据落盘）后取 report，不写裁决件 | 夹具里的闸门状态与本判据无关；夹具不进仓库 |
| 探针 | 夹具自己 `doctor` | 照搬本仓探针（§1.3） | 用户定，零配额 |
| 11.7 | 可选 | 不做 | D-a |

---

## 5. 附带观察（不是判据）

- **agy 的 `-p` 把整份任务书放进 argv**：`ps` 采样一次输出约 190 KB、被拆成数百行；收证据时只留启动行与 `--model` 所在行。另：本机常驻的 agy hub 进程（与本次运行无关）的 argv 带本机 `csrf_token`，首版采样脚本按 `agy` 字样把它们也抓了进去，收证据时已剔除；后来者写 ps 采样别按 `agy` 宽匹配。
- **gemini 回执的思考 token**：第 3 次（slug -low）`thinking_tokens: 0`，第 4 次（slug -medium）`thinking_tokens: 7108`（run.json `usage`）。与「后缀决定思考档位」方向一致，但只有一对样本、被审内容相同而结论长度不同，不作结论。
- **N1 停在「模型 slug 合法」一格**（未定义的档在解析模型时就暴露），N2、N3 停在「档位组合合法」——与 RUNBOOK §五「预检（『模型 slug 合法』『档位组合合法』两格）」的写法一致，无需改文档。

---

## 6. 全量检查

文档与证据落定后串行两次 `npm run check`（一次只发一条，跑时不改 `doc/`）：两次均 tests 3078 / pass 3075 / fail 0 / skipped 3，退 0（[`check-1.txt`](./evidence/m11-ac23-acceptance-20261008/check-1.txt)、[`check-2.txt`](./evidence/m11-ac23-acceptance-20261008/check-2.txt)）。这两份读数是在收进本目录之前跑的；收入后（含本节）按同一纪律再串行两次，读数见提交说明。

## 7. 临时目录

夹具与本步脚本（会话 scratchpad 下的 `ac23/`，含 `fx/` 临时项目）与夹具的运行目录 `~/.trivium/runs/fx-22276d42/`（本次四个 run：`20261008T121531Z`、`20261008T121745Z`、`20261008T122046Z`、`20261008T122226Z`）在留痕收齐后按用户 2026-10-08 指示删除；可重跑的脚本与夹具配置已收进证据目录。
