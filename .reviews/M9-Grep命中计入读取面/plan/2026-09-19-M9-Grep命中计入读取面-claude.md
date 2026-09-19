# 计划：Grep 命中文件计入读取面（EV-76 出路 ①）

- **主题**：`M9-Grep命中计入读取面`
- **起点**：`470ee84`（M9 第 6 步第 1 轮已合入），`main` 干净
- **触发**：BACKLOG **EV-76**，用户于 2026-09-19 裁定取出路 ①「解析 Grep 的 `tool_result`，把命中文件计入读取面」；
  连带 **CODEX-07** 登记的前置（consulted 匹配器无 realpath 归一化）
- **产出**：本文件，随后由用户发起 `/dual-review-plan`

> 本文 §二的事实全部来自本机实测（第 2 跑原始轨迹 + 2026-09-19 一次 haiku 调用 $0.031），
> 复核时按 §二给的样本看，不要信本文的概括。

---

## 一、目标与范围

### 目标

让 J5（`consulted` 交叉核对）看得见审查员经 **目录级 Grep** 读到的文件，使 M9 完成判据对 claude 这种工作方式可判。
同时修掉 consulted 匹配器的路径归一化缺口（CODEX-07）。

### 做

1. `claude-trace.ts`：捕获**成功**的 `tool_result`（按 `tool_use_id` 配对），新增 `grepHitPaths(trace)` 解析 Grep 三种输出模式；
2. `CriticResult` 新增 `search_hit_paths: string[] | null`（三态：`null` = 该族无此通道）；claude 侧填数组，另三家填 `null`；
3. `guard.ts`：consulted 匹配集 = `effectiveReadPaths ∪ search_hit_paths`；**措施 a**（禁读核对）同样吃 `search_hit_paths`；
4. consulted 匹配改用 `base.ts` 里措施 a 已在用的归一化（绝对化 + realpath 感知），不再是前缀切片 + 精确相等；
5. `trace.json` 记 `grepHits` 供复核；`run.json` / 审查文档 **不加字段**（无 schema 变更）；
6. 用例：真实样本夹具 + 第 2 跑回放（15/15）+ 归一化 + 措施 a 分档 + `project_reads` 不受影响；
7. 文档：设计 §11.4 / §10.1 措施 a / §3.7 事实表；EV-76 关闭；CODEX-07 前置随之结案。

### 不做（逐条附理由）

| 不做 | 理由 |
| :--- | :--- |
| agy / zcode 侧同构 | 两家的流只有工具**入参**（`AgyToolCall.parameters`、zcode 轨迹无 output 字段），没有工具输出——出路 ① 在那两侧**不可达**，不是没做。它们的 consulted 历来能过（Read 为主），如实登记为边界 |
| codex 侧 | command-trace 族：读取只在命令文本里，`rg` 的输出不进轨迹；措施 b 已覆盖路径字面，与本步不同源 |
| `project_reads` 计入 search hits | 证据档阈值（`min_project_reads`）的语义是「打开了几个项目文件」；一次目录级 Grep 命中 41 个文件不等于读了 41 个文件。计数口径不动，只改**匹配集**与**禁读核对** |
| BRIEF「实际读过」措辞 | 出路 ① 让机制去够措辞，措辞不改（EV-76 出路 ② 的方向已被裁掉） |
| 探针新增「Grep 输出格式」事实格 | 格式随 CLI 版本漂移是真风险，但本步的解析器只认三种严格形态（§3.1），漂移时的症状是「命中数掉回零」而非误计；登记为新 BACKLOG 条目，与 EV-74（探针改喂真实文件）一起做 |
| J5 结果进 `gate --check` 告警档（EV-75③ / GLM-02） | 另一条接线，独立一轮 |

---

## 二、事实

### 2.1 Grep 三种输出模式的真实格式（claude 2.1.277）

`path` 为**目录**时，命中路径**相对项目根**（cwd），不是相对 `path`：

| `output_mode` | 样本（2026-09-19 实测，`path: ./src`） |
| :--- | :--- |
| `files_with_matches` | `Found 5 files` ⏎ `src/trivium/review.ts` ⏎ `src/trivium/cli.ts` ⏎ … |
| `count` | `src/trivium/cli.ts:5` ⏎ `src/trivium/critics.ts:1` ⏎ … ⏎ 空行 ⏎ `Found 15 total occurrences across 5 files.` |
| `content` | `src/trivium/cli.ts:38:import { resolveCriticSelection } …` ⏎ …（`-n` 缺省也带行号）⏎ 尾随 `[Showing results with pagination = limit: 3]` |

`path` 为**文件**时，`content` 模式只有 `行号:文本`，没有路径——命中归到入参路径（`readPaths` 已计）。

### 2.2 第 2 跑复算（run `20260919T120643Z`，原始 `stdout.jsonl`）

| 项 | 值 |
| :--- | :--- |
| Read + 文件级 Grep 的路径 | 10 |
| 目录级 Grep 命中的文件 | **41** |
| consulted 匹配（现状） | 10 / 15 = 67% → `consulted_unverified: true` |
| consulted 匹配（按 §三解析后） | **15 / 15 = 100%** |
| 命中里落在归档位置的 | 3 条，全是 `.reviews/…/_meta/changes*.diff`（被审对象本身，不在 deny 集） |

### 2.3 既有代码里的两个相关事实

- 措施 a 的 `checkPeerLeak`（[base.ts:1010](src/trivium/adapters/base.ts#L1010)）**已经**把两边归一成绝对路径并处理 `/private/var` 与 `/var`；
  CODEX-07 指出的缺口只在 consulted 匹配（[guard.ts:346-360](src/trivium/guard.ts#L346-L360)：前缀切片 + 精确相等 + `./` 变体）。
- `parseClaudeEvents` 今天只保留 `is_error === true` 的 `tool_result`（[claude-trace.ts:137](src/trivium/adapters/claude-trace.ts#L137)），成功结果的内容被丢弃；
  `tool_use` 已带 `id`，配对通道现成。

---

## 三、方案（每步可单独验证）

### 3.1 `claude-trace.ts`：捕获成功结果，解析 Grep 命中

- `ClaudeTrace` 新增 `toolResults: Map<toolUseId, string>`（只存**成功**结果的文本；`content` 为数组时取各 `text` 拼接）。
- `grepHitPaths(trace, projectRoot): string[]`：对每个成功的 `Grep` `tool_use`——
  - 入参 `path` 是文件（以 `readPaths` 已计为准，不再 stat）→ 跳过；
  - 否则按 `output_mode`（缺省 `files_with_matches`）解析：
    - `files_with_matches`：跳过 `^Found \d+ files?$` 行，其余非空行即路径；
    - `count`：匹配 `^(.+?):\d+$`；跳过 `^Found \d+ total occurrences` 与空行；
    - `content`：匹配 `^(.+?):\d+:`；跳过 `^\[Showing results` 行；
  - 相对路径按 `projectRoot` 绝对化（cwd = 项目根，设计 §9.3）；去重、保序。
- **只认这三种严格形态**：不匹配的行一律丢弃、不猜。格式漂移的症状是命中数归零，与「没跑 Grep」在数字上同形——`trace.json` 记 `grepHits` 与 `grepResultLines`（原始行数），复核时能分辨。
- `Glob` 不计：它返回的是文件**存在**，不是内容。

### 3.2 `CriticResult.search_hit_paths: string[] | null`

- 三态与 `model_provider` / `read_paths` 同构：**必填**，`null` 表示「该族没有这种事实」（agy / zcode / codex 三家显式写 `null`），claude 填数组（可为空）。
- 不进 `run.json`（逐侧段无 `read_paths` 同款），不进审查文档 front-matter；`trace.json` 留痕。
- `runner.ts:237` 的失败结果构造与 `stub.ts` 同步补字段。

### 3.3 `guard.ts`：两处消费

| 消费点 | 改动 | 为什么 |
| :--- | :--- | :--- |
| consulted 匹配（`judgeSide`） | 匹配集 = `effectiveReadPaths(result, cap, root)` ∪ `(result.search_hit_paths ?? [])` | J5 的口径本来就是「实际读过」，Grep 取到内容就是读过 |
| 措施 a `checkPeerLeak` | 入参 = `read_paths` ∪ `(search_hit_paths ?? [])` | 探针早记着「同一批规则下 Grep 仍能从被拒目录取到内容」（§3.7）；事后轨迹核验是那道缺口的兜底，不吃 Grep 命中等于兜底也漏。分类（作废 / 告警）沿用 `categorizeDenyHit`，不另立口径 |

**措施 a 变严的后果如实写**：claude 侧若目录级 Grep 扫到对端审查件，将按第①类判**作废**——这是 §10.1 的既有承诺第一次对 Grep 通道生效，不是新规则。第 2 跑的 41 个命中对 deny 集零命中（§2.2），本步不会追溯改判它。

### 3.4 consulted 匹配的归一化（CODEX-07）

- 抽 `normalizeForMatch(p, projectRoot, projectRootReal)`：`expandHome` → 绝对化 → 若以 `projectRoot` 或其 realpath 为前缀则取相对路径 → 去 `./`；
- `judgeRun` 一次 `fs.realpath(projectRoot)`，经 `opts` 传给 `judgeSide`（保持 `judgeSide` 同步、纯函数）；
- consulted 两边都过同一函数再比。**不动阈值 80%**。

### 3.5 文档

- 设计 §11.4「`consulted` 与轨迹交叉核对」行：轨迹读取集合 = 读工具入参路径 ∪ 目录级 Grep 命中文件（claude 侧；另三家不可达）；
- §10.1 措施 a：入参补 Grep 命中；
- §3.7 事实表新增「Grep 输出格式」行（三种模式，2.1.277 实测），来源本文件 §2.1；
- BACKLOG：EV-76 关闭（出路 ①，CODEX-07 前置一并）；新增「探针记录 Grep 输出格式」条目；EV-75③ 保留。

---

## 四、用例

| # | 用例 | 变异（改哪里必红） |
| :--- | :--- | :--- |
| T1 | 三种模式真实样本（§2.1 截取为夹具 `test/fixtures/claude-events/grep-*.jsonl`，根改写为 `/proj`）→ 期望路径集逐条相等 | 删解析分支 / 改正则 |
| T2 | `content` 模式 header / trailer 行、`count` 模式尾行不当路径；文件级 Grep 不重复计 | 放宽正则 |
| T3 | `is_error` 的 Grep 结果不计；`tool_result` 无配对 id 不计 | 去掉配对 |
| T4 | consulted：`search_hit_paths` 覆盖的文件计入匹配；为 `null` 的族行为与现状逐字相同（agy / codex 既有用例回归） | 去掉并集 |
| T5 | 措施 a：Grep 命中 deny 集里的对端审查件 → `peer_leak_via_path` 命中、类别为作废类；命中 `.env` → 告警类不作废 | 去掉并集 / 分类改口径 |
| T6 | 归一化：`/tmp/x` 与 `/private/tmp/x`、`./x`、绝对写法互相匹配；项目外路径不匹配 | 去 realpath / 去前缀处理 |
| T7 | **回放**：第 2 跑截取的 24 条 `tool_use` + Grep `tool_result` + 15 项 consulted 作夹具，断言匹配 15/15、`consultedUnverified === false` | 任一环节退化 |
| T8 | `project_reads` 不因 `search_hit_paths` 增加；`pathCoverage` 不变 | 把 hits 并进 `read_paths` |
| T9 | `stub.ts` / `runner.ts` 失败结果的 `search_hit_paths` 字段在场（三态不塌缩） | 漏字段 |

变异验证不是可选项：T1 / T4 / T6 / T8 各做一次实跑变异并记录。

---

## 五、成本与验证

- 零模型调用：夹具来自已有轨迹与本文 §2.1 的一次实测；
- 验证顺序：`npm run check` → `npm run build` → `npm run install:local`；
- 之后 M9 第 6 步第 2 轮（第 3 次尝试）**由用户另行发起**，预计 9 分钟 / $1.6；本步不包含它。

## 六、风险

| # | 风险 | 处置 |
| :--- | :--- | :--- |
| R-1 | Grep 输出格式随 CLI 版本漂移 | 严格形态 + `grepResultLines` 留痕；登记探针条目 |
| R-2 | 措施 a 变严，claude 侧首跑作废 | 如实登记，不放宽；这是承诺生效不是新规 |
| R-3 | `search_hit_paths` 被误当 `read_paths` 用 | 三态 + T8 变异守卫 |
| R-4 | 相对路径基准假设（cwd = 项目根） | 设计 §9.3 既定；`init.cwd` 在 trace 里可核，解析时以它为准、缺失才回落 `projectRoot` |

## 七、请双审裁定的三处

1. 措施 a 是否吃 `search_hit_paths`（§3.3 表第 2 行）——我的取向是吃；
2. `search_hit_paths` 的三态形状（`null` vs `[]`）是否与 `model_provider` 先例同构；
3. Grep 输出格式要不要立探针事实格——我的取向是本步不立、登记。
