---
schema: trivium.disposition.v1
topic: M9-Grep命中计入读取面
stage: plan
role: claude
kind: revised
run_id: 20260919T142238Z
addresses:
  - 2026-09-19-M9-Grep命中计入读取面-codex.md
  - 2026-09-19-M9-Grep命中计入读取面-gemini.md
  - 2026-09-19-M9-Grep命中计入读取面-glm.md
---

# 裁决与修订计划：M9-Grep命中计入读取面（EV-76 出路 ①）

三侧均 `request-changes`，共 17 条（重要 8 ｜ 次要 7 ｜ 吹毛求疵 2）：**接受 17 ｜ 驳回 0 ｜ 暂缓 0**。
一条接受项里有局部不取（CODEX-01 的第 ③ 条出路），理由写在表里。

三个焦点的答案：

1. **措施 a 吃不吃 Grep 命中**——三侧都认「吃」，但 codex 与 glm 独立打穿了「一刀切」：`files_with_matches` / `count` 只披露存在性，
   与原稿排除 Glob 的理由自相矛盾。裁定：**只有 `content` 模式的命中进措施 a 与 J5**，另两种模式只留痕。这是**新规则**，不是「既有承诺生效」，
   §10.1 按新规则写，并如实登记与 EV-16 的不对称。
2. **三态形状**——三侧认同与 `model_provider` 同构；glm 指出我把 `read_paths` 也列为先例是错的（它必填 `string[]`、无 null 态）。改。
3. **T7 能否锁 15/15**——三侧独立给出同一结论：不能。`SideVerdict` 只暴露布尔，阈值 80% 下漏 3 项照样绿。改为断言匹配集本身。

另一条三侧都碰到的事实缺口：原稿 §2.1 / §2.2 的样本与复算数字在仓库里**无法复核**（原始 `stdout.jsonl` 只在本机运行目录，证据 trace 不含成功 `tool_result`），
且实测只有相对 `path` 形态、生产 9/9 次全是绝对 `path`。修订：把原始 Grep 对截取入库，两种形态都进夹具。

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | ①属实：设计 §3.7 的承诺原文是「覆盖 Grep 的 `path` 参数」，该参数已在 `read_paths`，把命中并进措施 a 是**新规则**，原稿「既有承诺第一次生效」说错了。②属实：EV-16 把 codex 的根递归 grep 记为「不收窄、无缓解」的接受项，claude 的 Grep 通道若一律作废，同一行为两条通道相反结论——但那是**检测能力**的不对称（codex 侧检测不到、只能接受；claude 侧检测得到），不是规则矛盾；§10.1 要把这层写透。③「命中只进 J5 不进措施 a」**不取**：`content` 模式的文本真实进入模型上下文，与 Read 同一通道，探针记录的「Grep 仍能从被拒目录取到内容」正是威胁本体，不兜底等于承认那条通道永远开着。取它的出路 ①：按 `output_mode` 分档 | §2.1：分档规则、§10.1 新规则措辞、EV-16 不对称注记、最坏代价与 BRIEF 缓解 |
| GLM-01 | glm | major | 接受 | 与 CODEX-01 独立收敛到分档；并补了两个我漏写的事实：第 2 跑有一条 `path = 项目根` 的 content Grep 扫进 `.reviews`，零命中是 pattern 运气；§12.1「作废并重跑一次」标注待实施，现状下一次作废 = 整轮报废。R-2「如实登记」没回答这两点 | §2.1；§2.5 BRIEF 缓解句；R-2 改写 |
| CODEX-02 | codex | major | 接受 | 属实：`consultedUnverified = matched / n < 0.8`，15 项对上 12 项即 0.8、不小于，布尔不翻；T7 只能锁 ≥12/15。原稿变异表「任一环节退化必红」不成立。另：夹具用合成 `projectRoot` 时 `fs.realpath` 会抛，原稿没写处置 | §2.2：抽 `matchConsulted()` 导出，T7 断言 `missing` 为空；realpath 失败回落 |
| AGY-01 | gemini | major | 接受 | 与 CODEX-02 同一事实，算术一致（10 + 2 = 12 即过） | 同 CODEX-02 |
| GLM-02 | glm | major | 接受 | 同一事实；取它给的代价更小的选项：不动判定面，用导出的归一化 + 命中函数在 T7 里独立断言「归一后 ⊇ consulted 全部 15 项」 | 同 CODEX-02 |
| CODEX-03 | codex | major | 接受 | 属实：证据 trace 只有 24 条 `tool_use`，成功 `tool_result` 一个字节都没有；原稿 §2.1 唯一实测是相对 `path`，生产 9/9 是绝对 `path`，「命中相对 cwd」在生产形态上没有样本入库。夹具目录 README 的「真跑输出」约定与「根改写」的张力要登记 | §2.3：截取原始 Grep 对入库为证据与夹具；README 注明来源与改写范围 |
| GLM-04 | glm | minor | 接受 | 与 CODEX-03 同一缺口的另一半：T1 夹具来自相对形态、T7 来自绝对形态，T1 绿证不了 T7 绿。§2.1 补绝对形态样本，T1 两种形态都锁 | §2.3 |
| CODEX-04 | codex | major | 接受 | 属实：`ClaudeTrace.init` 只投影 model / tools / permissionMode，`system/init` 事件确带 `cwd`（夹具 `path-denied.jsonl` 首行可核）；R-4 引用了一个解析器不保留的字段，是写了不会触发的缓解 | §2.4：解析器采集 `init.cwd`，`grepHitPaths` 以它为基准、缺失回落 `projectRoot`；trace.json 落 `init.cwd` |
| GLM-03 | glm | minor | 接受 | 同一缺口，且指出两处引用错误：「设计 §9.3」应为 §11.2（cwd 模板所在），claude 侧 cwd 是构造性的（`claude.ts:737` `cwd: projectRoot`）——所以基准假设成立，但要写准来源 | §2.4；引用改准 |
| AGY-02 | gemini | major | 接受 | 属实：`readPaths` 里混有目录级 Grep 的目录入参，靠它判「入参是文件」不可行，又与「不再 stat」自相矛盾。改由输出形态自适应：文件级 Grep 的 `content` 输出是 `行号:文本`，严格正则天然提不出路径；再加两条守卫（提取出的路径不得以数字开头、不得含空白）防「`7: a ? 1:2:3`」这类文本误配 | §2.1 解析规则重写 |
| AGY-03 | gemini | minor | 接受 | 属实：`failedResult`（`base.ts:215`）是共享失败出口、约 20 处调用；`buildClaudeResult` 今天不收 `projectRoot`，`grepHitPaths` 需要基准；`claude-adapter.test.ts` 14 处直调要跟着改 | §2.6 构造点清单补全；`buildClaudeResult` 增 `cwd` 入参 |
| GLM-05 | glm | minor | 接受 | 三处属实：`read_paths` 不是 null 态先例、构造点漏 `failedResult` 与三家适配器、`categorizeDenyHit` 是我编的名字（实为 `classifyDenyPath` / `isVoidingCategory`）。stub 侧填 `null`（它扮任意侧、不产出真实工具输出） | §2.6 |
| AGY-04 | gemini | minor | 接受 | 属实：`startsWith(root)` 无分隔符边界会把 `/repo` 与 `/repository` 混判；`base.ts` 的 `isUnder` 已带边界 | §2.2：复用 `isUnder` + `path.relative` |
| CODEX-06 | codex | minor | 接受 | 属实：`normalizeAbs` 已抹 `/private` 前缀，`guard.ts` 已 import `base.js`；再写一份 `normalizeForMatch` 是两份归一化并存。改为**扩展** `base.ts`：新增 `toProjectRelative(p, roots)`，内部用 `normalizeAbs` + `isUnder`，realpath 只是多给一个 root 别名；realpath 失败（ENOENT）回落只用 `projectRoot` | §2.2 |
| CODEX-05 | codex | minor | 接受 | 属实：trace.json 只在成功出口写、全仓无消费方，「留痕可分辨」是宣称了不存在的消费方（EV-06 同形）；漂移在措施 a 上是安全控制静默变盲。取它的低成本动作 ①：夹具目录兜底扫描加「输出腿」——凡含 Grep 结果的样本必须解析出非零 `content` 命中，构建期打红。不走 `verification_degraded` 扩展（schema 同步成本，另立） | §2.7 T10 |
| CODEX-07 | codex | nit | 接受 | 属实：trace.json 的组装点在 `claude.ts` 的 `run()`，不在解析器清单里；两格键名与口径未定义 | §2.4 定义三格并列进改动清单 |
| AGY-05 | gemini | nit | 接受 | `files_with_matches` 「其余非空行即路径」过宽。该模式本轮已改为只留痕不消费，但留痕也不该灌脏数据：只收「像路径」的行（含 `/` 或 `.`、不含空白、不以数字开头），已知提示行（`No files found` 等）显式丢弃 | §2.1 |

**统计**：接受 17 ｜ 驳回 0 ｜ 暂缓 0。

---

## 二、修订内容

原稿保留在同目录 `2026-09-19-M9-Grep命中计入读取面-claude.md`，本件只写改了什么。

### 2.1 解析与消费按 `output_mode` 分档（CODEX-01 / GLM-01 / AGY-02 / AGY-05）

| `output_mode` | 解析 | 进 J5 匹配集 | 进措施 a | 留痕 |
| :--- | :--- | :--- | :--- | :--- |
| `content` | `^([^\s:][^:]*?):(\d+):`，提取组 1；丢弃 `^\[Showing results` 行 | **是** | **是** | `grepHits` |
| `count` | `^([^\s:][^:]*?):(\d+)$`；丢弃 `^Found \d+ total occurrences`、空行 | 否 | 否 | `grepListed` |
| `files_with_matches`（缺省） | 丢弃 `^Found \d+ files?$`、`^No files found`；其余行须「像路径」 | 否 | 否 | `grepListed` |

**通用守卫**（三档共用）：提取出的路径不得以数字开头、不得含空白、须含 `/` 或 `.`；不满足即丢弃、不猜。
代价如实写：根目录下无扩展名的文件（`Dockerfile`、`LICENSE`）会被丢，属可接受的假阴性，T2 锁这条边界。

**不再靠入参判「文件级 Grep」**：文件级 Grep 的 `content` 输出是 `行号:文本`，正则提不出路径；`7:  a ? 1:2:3` 这类文本被「不以数字开头」守卫挡掉。

**分档理由写进设计 §10.1（新规则，不是既有承诺）**：
- `content`：文本真实进入模型上下文，与 Read 同一通道；探针实测 CLI 路径级 deny 对 Grep 不生效（§3.7），事后核验是该通道唯一兜底；
- `files_with_matches` / `count`：只披露存在性与频次，与 Glob 同档——Glob 不计，它们也不计；
- **与 EV-16 的不对称如实登记**：codex 的根递归 grep 是「检测不到、只能接受」（B-2），claude 的 Grep 命中是「检测得到」——同一行为两条通道结论不同，源于检测能力而非规则；EV-16 条目加一句交叉引用。

**最坏代价与缓解**（GLM-01）：§12.1「作废并重跑一次」待实施，现状下 claude 侧一次 `content` Grep 命中对端审查件 = 该侧作废、整轮报废（约 9 分钟 / $1.6），且重跑会重复同一条搜索。缓解两条：
- BRIEF 禁读段补一句（四侧共用）：「用搜索工具时把 `path` 限定在被审对象涉及的目录，不要从项目根递归——归档目录里有对方的历史产出」；
- 第 6 步第 2 轮开跑前把这条风险写进验收计划的刹车段，不改判据。

### 2.2 T7 改断言匹配集；归一化复用 `base.ts`（CODEX-02 / AGY-01 / GLM-02 / AGY-04 / CODEX-06）

- `base.ts` 新增 `toProjectRelative(p: string, roots: readonly string[]): string | null`：`expandHome` → `normalizeAbs` → 对 `roots` 逐个 `isUnder`（带分隔符边界）→ `path.relative` → 去 `./`；不在任一 root 下返回 `null`。**不另写第二份归一化**。
- `guard.ts` 新增导出 `matchConsulted(consulted, tracePaths, roots): { matched: string[]; missing: string[] }`，`judgeSide` 用它算布尔；判定面不变。
- `judgeRun` 一次 `fs.promises.realpath(projectRoot)`，成功则 `roots = [projectRoot, real]`，**ENOENT 等失败回落 `[projectRoot]`**（夹具用合成根时走这条）；经 `opts.projectRoots` 传 `judgeSide`，缺省 `[projectRoot]`。
- **T7**：夹具 = 第 2 跑截取的 24 条 `tool_use` + 9 条 Grep `tool_result` + 15 项 consulted；断言 `grepHitPaths(trace, root)` 恰好覆盖那 5 项（`deepEqual` 集合）、`readPaths(trace)` 不含它们、`matchConsulted(...).missing` 为 `[]`、且 `consultedUnverified === false`。任一项退化当场红。

### 2.3 原始样本入库（CODEX-03 / GLM-04）

- 从第 2 跑 `stdout.jsonl` 截取 9 对 Grep `tool_use` + `tool_result`（含 `path = 项目根` 那一条），根前缀改写为 `<ROOT>`、其余逐字，落 `doc/05_testing/evidence/m9-acceptance-20260919/grep-tool-results-20260919T120643Z.jsonl`；
- 夹具 `test/fixtures/claude-events/grep-content-absolute-path.jsonl`（上述截取，绝对 `path` 形态）与 `grep-three-modes-relative-path.jsonl`（2026-09-19 实测，相对 `path` 形态，三种模式）；README 补一段「来源 / 截取范围 / 根改写」，明确这是真跑输出的**截取**而非手编；
- 原稿 §2.1 补绝对形态样本行；T1 两种形态都锁。

### 2.4 采集 `init.cwd`；trace.json 三格入清单（CODEX-04 / GLM-03 / CODEX-07）

- `parseClaudeEvents`：`init` 增 `cwd: string | null`；`grepHitPaths(trace, fallbackRoot)` 的基准 = `trace.init?.cwd ?? fallbackRoot`；
- claude 侧 cwd 是构造性的（`claude.ts:737` `cwd: projectRoot`），基准假设成立；原稿「设计 §9.3」改为 §11.2；
- `claude.ts` `run()` 的 trace.json payload 增三格：`grepHits`（`content` 命中，去重后）、`grepListed`（另两档，去重后）、`grepResultLines`（成功 Grep 结果的非空行总数，去重前）；`init.cwd` 一并落。

### 2.5 BRIEF 缓解句（GLM-01）

`skills/dual-critic/protocol/` 的禁读段追加 §2.1 那一句；四侧共用，不改「实际读过」的定义。

### 2.6 构造点与先例表述（AGY-03 / GLM-05）

- `search_hit_paths: string[] | null` 的先例只提 `model_provider`；tsc 必填是主闸门，T9 的论域列全：`failedResult`（`base.ts:215`）、`runner.ts:237`、`stub.ts`（填 `null`）、agy / zcode / codex 三家适配器（`null`）、测试字面量；
- `buildClaudeResult` 增 `cwd` 入参（取 `trace.init?.cwd ?? projectRoot` 的调用方负责），`claude-adapter.test.ts` 14 处直调同步；
- 分类沿用 `freeze.ts` 的 `classifyDenyPath` + `isVoidingCategory`。

### 2.7 用例表增补（CODEX-05）

| # | 用例 |
| :--- | :--- |
| T1 | 两种形态（绝对 / 相对 `path`）× 三种模式：`content` 进 `grepHits`，另两档进 `grepListed`，路径集逐条相等 |
| T2 | 守卫：数字开头、含空白、无 `/` 无 `.` 的行不当路径；`Dockerfile` 假阴性作为已知边界断言 |
| T7 | 改为 §2.2 的集合断言 |
| **T10（新）** | 夹具目录兜底扫描加输出腿：凡文件名以 `grep-` 开头的样本，`grepHitPaths` 必须非空——格式漂移在构建期打红 |
| T11（新） | `toProjectRelative`：`/tmp/x` 与 `/private/tmp/x`、`./x`、`/repo` vs `/repository` 边界、项目外返回 `null` |

变异验证：T1 / T7 / T10 / T11 各做一次实跑变异并记录。

### 2.8 不改的部分

- `project_reads` / `pathCoverage` 口径不动（三侧均认可）；
- 探针不新立 Grep 格式事实格，登记 BACKLOG（codex 接受、gemini 赞同）；
- 阈值 80% 不动；BRIEF「实际读过」定义不动。

---

## 三、修订后的步骤

| 步 | 内容 | 相对原稿的变化 |
| :--- | :--- | :--- |
| 0 | 截取原始 Grep 对入库（证据 + 两份夹具 + README） | 新增（CODEX-03 / GLM-04） |
| 1 | `claude-trace.ts`：捕获成功 `tool_result`、`init.cwd`、`grepHitPaths` 三档分解析 | 分档 + 守卫 + cwd（CODEX-01 / GLM-01 / AGY-02 / AGY-05 / CODEX-04） |
| 2 | `CriticResult.search_hit_paths`（只装 `content` 命中）；构造点补全 | 构造点列全（AGY-03 / GLM-05） |
| 3 | `base.ts` `toProjectRelative`；`guard.ts` `matchConsulted` + 措施 a 并集 | 复用归一化、导出匹配函数（CODEX-06 / AGY-04 / CODEX-02） |
| 4 | trace.json 三格 + `init.cwd` | 入清单（CODEX-07） |
| 5 | 用例 T1～T11 + 变异 | T7 改集合断言、新增 T10 / T11 |
| 6 | 文档：§10.1 新规则与 EV-16 不对称、§11.4、§3.7 格式行、§11.2 引用；BRIEF 缓解句；EV-76 关闭；新登记探针格式条目 | 措辞由「既有承诺」改「新规则」 |
