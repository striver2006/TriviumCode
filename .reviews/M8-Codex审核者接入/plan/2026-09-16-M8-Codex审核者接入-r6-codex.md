---
schema: trivium.review.v1
topic: M8-Codex审核者接入
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.154.0
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260916T004756Z
rerun_index: 6
snapshot_hash: sha256:6cc223c9fa9437be66d673795e61837aaf44d7ab9b9a97295dd3bab4509d87ae
blind: true
started_at: 2026-09-16T00:47:57.364Z
finished_at: 2026-09-16T00:54:56.801Z
duration_s: 419
tool_calls:
  run_command: 25
  project_reads: 26
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 1
  major: 6
  minor: 4
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0a7af-4820-74c3-9bfb-e875444d4e58
---

# 计划审查：M8-Codex审核者接入

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260916T004756Z` ｜ 第 6 轮
> ｜ 本轮审核者 codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

最危险的一条：§3.4 的沙箱负对照可以「空洞通过」——三条断言里没有一条能证明模型真的试过写入，而 P-C2 又决定被拒命令不进事件流，所以「哨兵文件不存在」与「模型压根没动手」不可区分；这条证据正是 J5 的全部 contents。次危险：§3.5 的回标口径测的是错的量（折减系数建模的是提取漏检率，计划却拿 project_reads 与下限比大小），于是 T9 无论怎么跑都得不到结论，这才是「给自己留后门」的实情——而后门其实不必要，人工标注两份真实轨迹零配额就能测对。再次：AC-20 改成 (model_provider, model_effective) 二元组之后仍有第四种「通过而无意义」的形态（两个 profile 解析到同一个 provider/base_url），而 `probe.providers` 里已有现成的免费判据。D4-1=C 的实现口径与 E-4 的表自相矛盾（C 只治误放、不治误杀），且它把已在探针里算过一遍又被丢弃的事实搬到 preflight 重算一遍。成本面上 §7 把轮数写死为 2，与本主题 code 留痕 r1～r9 的现实不符。计划的实测精神、编号纪律、E-1/E-4 的发现质量我都认可，上述问题全部是「现在改比做完改便宜」这一类。

**结论**：`request-changes`

## 审查意见（共 11 条：阻断 1 ｜ 重要 6 ｜ 次要 4）

### CODEX-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.4（J5 / T6）` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：负对照的三条断言缺少「写尝试确实发生」的证据，因此可以在模型根本没动手的情况下全部通过（空洞通过），而 §3.4 把第 1 条称作「唯一强证据」。第 1 条（哨兵不存在）、第 2 条（write_events 为空）、第 3 条（tree_hash 不变）三者对「被沙箱拒绝」和「模型只是回了一句文本没执行命令」给出完全相同的输出。更麻烦的是这条路径不是新造的：现有探针的 `readonly_flags` 结论本身就是同形判据产出的，计划说「不复用探针那次」，但复用了它的推理缺口。

**依据**：`src/trivium/probes/codex.ts:699-714`：负对照只判 `exists(breachPath)`，false 即记 `readonly_flags = ['-s','read-only']` 并写「写入被拒」——代码里没有任何一条断言证明命令被执行过。`src/trivium/adapters/codex.ts:73-83` 的注释自己写着「被拒的命令不进事件流」，与 §3.4 第 2 条「弱证据」的分级同源，说明无法从轨迹反推尝试。被审计划 §3.4 的做法（同一条 prompt + 三条断言）继承了同一缺口。

**建议**：加第四条断言，方向是「正对照」而不是更强的负对照：在同一次调用里要求两个动作（在项目内建哨兵 A，在允许写的临时/scratch 路径建 B），断言 A 不存在且 **B 存在**。B 成立才使 A 的缺席成为「沙箱拒绝」的证据；两个动作同一次调用，额外配额为零。同时把这条写清为 §3.4 的第 1 强证据的前提，并如实登记现有探针结论同样带这个未排除的混淆（BACKLOG 或 P-xx 台账）。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.5 + §1.2 T9` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：回标的度量对象不对。`COMMAND_TRACE_READS_DIVISOR` 建模的是**提取口径的漏检比例**（真实读取次数 → 提出来的 project_reads 的折损），而 §3.5 的三个判据全部拿「提取出来的 project_reads 与下限 2 比大小」——这个数的高低由任务难度与模型勤奋度决定，与漏检率没有因果关系。「两次都 ≥ 6 说明折减过度」不成立（可能真实是 30 次、漏了四分之三）。按现在的口径，无论跑出什么数都得不出结论，这才是 T9「样本不足、保留现值」真正的成因；而它本来是可以廉价测对的。

**依据**：`src/trivium/adapters/base.ts:256-272`（系数注释：「变量拼接、管道组合、`find -exec` 提不出来，读数系统性偏低」「它是可调参数而非推导结论」）；`src/trivium/adapters/base.ts:228-252`（project_reads = 提取命中数，不是真实读取数）；计划 §3.5 全文只比 `project_reads` 与 2/3/6 的关系，没有任何一处涉及真实读取次数。

**建议**：把 T9 的口径改成「提取召回率」：两次真机运行各自留一份人工标注——从会话文件/`command_texts` 里人读数出真实读过的不同项目文件数，与机器提出的 `project_reads` 相比，得两个比值；折减系数与这两个比值对齐（或如实记比值太小/太大以及样本只有 2 个）。这不需要额外配额，只需要在 §5.3 的报告里加一节「提取召回率实测」。并相应把 §3.5 现在那三个「≥6 / 2~3 / <2」的判据删掉或改写，否则报告里会出现一个测不到却宣称测了的东西。n=2 的局限保留原话即可，那时候它是诚实而不是后门。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.1 判据改写 + §1.2 T2/T3` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | medium |

**问题**：改成二元组后仍有第四种「AC-20 通过而无意义」的形态，且计划 §9.1 猜的方向不对：`model_provider` 不是独立事实，它就是 `-p` 的标签（计划自己写的「provider 家族——随 `-p` 走」）。两个 profile 的分层文件里 `model_provider` 完全可以指向**同一个** `[model_providers.X]` 段（同一个 base_url、同一套凭据），此时两个 `model_provider` 字符串互不相同、与各自请求的 profile 一致、`model_effective_source=trace` 全绿，但两次请求打的是同一个 endpoint——AC-20 验收的「多模型家族接入」依然一点没被证明。这不是构造出来的形态：本机 profile 目录文件是手工维护的，且 §4 的记录显示它在本步内已经改过一次。

**依据**：`src/trivium/probes/codex.ts:160-195`：`probeCodexProviders` 逐 profile 读 `topLevelKey(text,'model_provider')`，回落基底配置，产出 `{profile, provider, model, credentialed}`——注意 profile 名与 provider 名是两个不同的东西，前者是文件名、后者才是 endpoint 归属；profile 与 provider 是多对一，代码里没有任何一处断言两者不同。`src/trivium/adapters/codex-trace.ts` 的 `parseCodexSessionMeta` 注释同样写着 model_provider 随 `-p` 走。计划 §3.1 的判据只用到 profile 名与 model 名。

**建议**：T2 加一条零配额的断言：两次运行所解析到的 **provider id 与其 `base_url`（至少 host）互不相同**，数据源就用已有的 `probe.providers`（必要时扩一个 base_url 字段），把它的值逐字进 §5.3 ⑧ 的报告。这样二元组升级为「profile 标签 + provider 归属」两层事实，前者防错配、后者防同 endpoint 换皮。§9.1 提的那个「分层文件被改过」的形态也随之被覆盖。

### CODEX-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.1 末段（D4-1=C 的落点）与 §3.1 末段` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：C 的实现口径「解析 profile 分层文件的 model_catalog_json、**读目录**、比对配置模型」如果按字面做（直接读那份 JSON 文件），会和 codex 自己的可见性判定分叉：E-4 的表两次提到目录里有「隐藏项」（基底 10 条含两个隐藏、deepseek 4 条含两个隐藏），说明文件内容 ≠ codex 认的「合法名单」。按 §2 的实测，端点拒绝时报的名单是**可见项**，与 `models-deepseek.json` 的可见项逐字一致——可见性是 codex 渲染时做的，不是文件本身做的。照文件读，新拦截会放行隐藏项，正好复制 E-4 的「误放」。此外这条判据落在 `availability()` 里读**实时文件系统**，而该函数其余五条判据全部读 `ctx.cfg.probe.cli.codex` 的探针结论，同一件事（本 profile 有哪些可用模型）出现两份判据、两个时点。

**依据**：`src/trivium/adapters/codex.ts:297-357`（`availability()` 现貌：逐条读 `p = ctx.cfg.probe.cli.codex`，无一处实时读盘）；`src/trivium/probes/codex.ts:197-226`（`probeCodexModels` 用 `codex debug models --json` + `-c model_catalog_json=<路径>` **渲染**目录，注释明写「零配额——只渲染本地目录文件」）；`src/trivium/probes/codex.ts:874-886`（`readCatalogPath` 只回路径，不读内容）；计划 E-4 表与 §5.1 的措辞。

**建议**：两选一，但必须写明：① 复用 `probeCodexModels(bin, <该 profile 的目录路径>)` 而不是自己读文件（零配额，且与端点口径同源）；② 若坚持读文件，就在计划里写清「隐藏项这一维未覆盖」并进 BACKLOG。同时说明为什么这一条判据可以实时读盘而其它五条不行——否则它将成为后来者往 `availability()` 塞第二份判据的先例。

### CODEX-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan D4-1 末段「codex 侧被前面那道拦截兜住」` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：C 兜住的只是 E-4 表的第三行（误放），兜不住第一行（误杀），而计划把两者一起宣布解决了。预检里 `checkModelSlugs` 在 `checkReadonlyCapability` **之后**跑，用的是 `cfg.probe.cli.codex.models`（基底那 10 条）。`profile: deepseek` + `deepseek-flash`（该 profile 自己的默认模型）：新加的 `availability()` 拦截会放行（它确实在 deepseek 目录里），随后通用那条照样判它「不在模型目录中」→ 预检失败。也就是说 C 落地之后，「配置成第二个家族的默认模型」这一最自然的 AC-20 形态仍然起不来，能跑的只有两份目录的交集，本机恰好只有 `deepseek-v4-pro` 一个。AC-20 的可复现性因此建立在一个未经维护的巧合上。

**依据**：`src/trivium/preflight.ts:556-562`（检查顺序：只读能力 → 模型 slug，后者短路于前者之后）；`src/trivium/preflight.ts:362-399`（`checkModelAgainstCatalog` 读 `cfg.probe.cli[cliName].models` 单一列表）；`src/trivium/probes/codex.ts:598-599`（`probe.models = probeCodexModels(bin, null)` → 基底目录）；计划 E-4 表第一行自记「误杀：本可成功却被拒」。

**建议**：在 D4-1 与 §5.2/§5.3 里把 C 的覆盖面收窄为「只治误放」，并明写残留：误杀仍在、AC-20 家族二的可选 slug 被限制为两份目录的交集、这是本机巧合不是机制。若愿意多花一点点改动，真正对症的最小修法是让通用那条拿到**本 profile 的**目录（不需要 A 的完整 map，只需 `checkModelAgainstCatalog` 在 codex 侧改读该 profile 那份），值得在计划里比较一次后再裁定。

### CODEX-07 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §7 成本与时长 + D4-3` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | medium |

**问题**：成本表把「真实审查」写成「三侧 × 2 轮」，这个 2 是从「两个家族各一次」推出来的，但 D4-3 同时又把 AC-20 的证据绑在**本步自己的代码双审**上——而代码双审的轮数不由计划决定。同一主题的 `code/` 留痕已经走到 r9，plan 走到 r5。按 D4-3 的耦合方式，轮数就是配额乘数，AC-20 的证据还会散落在多轮里。相关且更麻烦的一处：§7 写「加 codex 后墙钟不变」，同一节又写「codex 侧耗时无先例」——两句互相打脸，而 `review.timeout_s.code=7200` 意味着一个卡住的 codex 侧能把 30 分钟的一轮拉到 2 小时。

**依据**：计划 §7 表、D4-3 表与 §8 U-1；`.reviews/M8-Codex审核者接入/code/` 下 `2026-09-15-…-r2…r9-glm.md` 等文件名（据禁读清单编号可见本主题代码审已 9 轮，我未读其内容）；`src/trivium/review.ts:759-768`（每侧独立 transient 重试，重试会再烧一次该侧配额）。

**建议**：§7 改成三段：每轮三侧的边际成本、按本主题历史轮数的最坏情形、以及**一条明确裁定**——「AC-20 证据取第一次同时满足 T1～T5 的那一轮，后续轮不重跑；但若后续轮改了 §3.1/§3.2 的代码，该证据作废并需重采」。这句话决定要不要为每一轮都留 codex 配额，属于不可逆的排期决定，现在写比事后补便宜。另把「墙钟不变」改为「未知，最坏受 timeout 上界 7200s 支配」。

### CODEX-08 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §8「U-1 没法前移——它就是本步要验的东西」` |
| 类别 | performance ｜ 层次 plan |
| 置信度 | medium |

**问题**：这句不成立，而它决定了失败时的烧钱量。U-1（codex 侧能不能跑完一次完整代码审）是本步最大不确定性，但它**不需要**三侧一起跑才能验：入选集合可由 `--critics` 指定为单侧，用一份真实 BRIEF（哪怕是本步计划稿或上一轮已收口的代码 diff）单独跑 codex 一次，就能同时拿到耗时、`project_reads`、是否超时、`write_events` 是否空。不做这一步的话，U-1 失败的代价是一整轮三侧配额 + 已备好的隔离工件，而它本来只需要一次 codex 侧调用。

**依据**：`src/trivium/cli.ts:130`（`--critics <id,…>` 允许 1～`review.max_critics` 个）、`src/trivium/cli.ts:151`（preflight 同样按入选集合只查这几侧，故单侧运行的预检成本也只有一侧）；计划 §7「codex 侧单次审查耗时：**未知**，本项目从未真跑过」。

**建议**：在 §3.4 的负对照之后、真实双审之前插一步「codex 单侧冒烟」：明确它花一次 codex 配额、产物只作 U-1 消解与耗时标定用、**不计入** AC-20 证据（避免与 §3.5 的回标、J3 的两次运行混淆）。同时给一个失败止损口径：冒烟超时/报 error 时本步怎么继续（是记 AC-20 未达还是回退到 A/B 方案），现在计划里没有这一分支。

### CODEX-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.1 末段 vs D4-1=C` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：同一份文档里两处口径互斥：§3.1 的结论是「模型与家族一致性**判不了**，能做的只有事后如实记录」，D4-1=C 落地之后预检恰恰就能拦一类（配置模型不在本 profile 目录里）。§3.1 的理由只在「目录被合并、slug 无家族归属」这一维成立。这句话会随 §5.3 ⑥/⑩ 回填进 BACKLOG 和设计文档，成为后续步骤的既定前提——一条半失实的前提比一条缺失的判据更难清理。

**依据**：计划 §3.1 末段与 D4-1「提议 C」；`skills/dual-critic/schema/config.v2.json:416-421` 的 profile 描述已经明写「它同时是『模型属于哪个 provider 家族』的唯一判定依据」——即项目早已承认 profile 是家族归属的事实来源，§3.1 说「没有结构化事实」与这句登记相抵。

**建议**：把 §3.1 那句改成有范围的结论：「按 profile 的分层目录可拦『模型不属于本 profile』；拦不住『profile 与模型跨家族错配且两家族目录有交集』——E-1 那次实测正是后者」。同时让 D4-1 与 §3.1 互相引用一句，避免两处各自表述。

### CODEX-09 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.3（①～⑩）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：回填清单还漏第三类落点，而且是项目自己规定「唯一落点」的那一类：本机坑台账。E-1（`-p` 与 `-m` 可各说各话、codex 不校验模型/provider 对应）、E-4（模型目录逐 profile 分层、`codex debug models` 渲染掉隐藏项）都是新的 `P-xx` 级本机事实，本步不进台账，下一步就只能重新花配额再发现一次。另外 ⑧ 新增一份 `doc/05_testing/REPORT_…` 却不在该目录 README 的索引里登记。

**依据**：`doc/05_testing/README.md:29`（明写 M0 报告「§7 是 `P-xx` 本机坑清单的**唯一落点**，跨里程碑持续追加」，并列举 M4/M5、M6 的补录先例）；`AGENTS.md`「改动同步清单」表：改探针项必须同步 `doc/05_testing/REPORT_2026-09-11_m0_probe.md`；`src/trivium/probes/codex.ts` 注释里对 `P-C1`/`P-C2`/`P-14` 的引用方式；计划 §5.3 ①～⑩ 无台账、无目录索引。

**建议**：§5.3 加两行：⑪ `doc/05_testing/REPORT_2026-09-11_m0_probe.md` §7 追加 E-1/E-4 为新 `P-xx`（并同时登记 EV-13「活台账寄生在历史快照里」因此次追加而加重）；⑫ `doc/05_testing/README.md` 索引加 ⑧ 的新报告条目。E-5 说「清单本身会漏」，对症的机制不是更小心，而是让清单有机器对账——建议这条顺带进 BACKLOG，与纪律 6a 一起看。

### CODEX-10 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan D4-2 理由 3 与改名提议本身` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：D4-2 的三条理由里第 3 条与本文自己的第 369～388 行相矛盾：那段已论证「`run.v2` 的档位词汇是 `tier`（`tier_source`、AC-23 的 `--tier-<id>`）」，那么「不占 `profile` 好让 M11 收口档位时能用」就是伪需求——M11 按现有词汇会用 `tier*`，不会用 `profile`。留空这个名字的代价（多一个永久例外说明）因此失去支撑。另一方面，改名本身的动机「让请求/回读成一对看得出来」有现成惯例可走：同一 def 里已经有 `model_requested` / `model_effective` 这一对，`vendor_profile` 反而**打破**了这个惯例（它是请求值，却没有任何 `requested` 字样），而 `vendor_profile` 与 `model_provider` 也谈不上「一眼看出是一对」。

**依据**：`skills/dual-critic/schema/run.v2.json:150-175`（同一 `critic` 形状内并列着 `model_requested`、`model_effective`、`model_effective_source`，以及四个【待实施 · M11】字段 `effort_requested`/`effort_effective`/`tier_source`/`profile`）；计划 D4-2 的「一个为本条辩护的事实」段与理由 3。

**建议**：把命名裁定重新表述为「随已有 `*_requested` 惯例」还是「为厂商概念单开门」二选一并写进 §6.7.1，别把矛盾的两条理由都留着。若选前者，`profile_requested` 与 `model_requested`/`effort_requested` 同构、`profile` 也不再被占用，改名窗口同样免费。这是难回收的留痕契约，建议按 §4 的原话「理由被打穿即重新提请拍板」重拍一次。

### CODEX-11 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §6.1（目录拦截 fixture）与 §6.3` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：两处环境前提没落到纸面：① 「fixture 用本次实测的两份真目录（4 条 / 10 条）」未定形态——是拷进 `test/fixtures/` 还是运行时读 `~/.codex`？后者会让单测依赖本机未入库文件，换机器/CI 直接红或（更糟）静默跳过；若拷进去，则要写明它是**快照**，且不得含本机绝对路径与隐藏项之外的真实凭据信息。② 未定义目录文件不存在/不可读时的行为。本机五个 profile 恰好都有目录，但一台只装官方 `auth.json`、没有任何 `model_catalog_json` 的普通 codex 安装是常态，C 新加的拦截在这台机器上要么误杀（该侧永久不可用）要么静默放行（判据形同不存在），计划里没写取哪个。

**依据**：计划 §6.1 表末行与 §5.1 C 行；`src/trivium/probes/codex.ts:874-886`（`readCatalogPath` 读不到即返回 null）；`src/trivium/preflight.ts:371-376`（既有通用判据对「无目录可比」的处置是**第三态 `unverifiable` 且必须说出来**，不是失败也不是静默通过）；计划 §2 E-4 表把「本机有五份目录文件」当既有事实使用。

**建议**：§5.1/§6.1 各补一句：无目录时沿用 `unverifiable` 第三态并写进预检输出（与既有通用判据同口径，别新造一个方向），并为其补一条单测；fixture 明确为 `test/fixtures/` 下的入库快照，且在 §5.3 ⑧ 的报告里记下本次两份目录的 sha256 与 `probe` 指纹，否则 E-4 的证据在目录文件已被更新过一次（本计划自己记录了这次更新）之后就不可复核。

## 认为正确的部分

- E-1 的发现方式与结论我认可：AC-20 若只比 `model_effective` 确实会通过而无意义，「采了、丢了」这条定性经核实成立（`codex-trace.ts` 解析 `modelProvider`、`buildCodexResult` 未取用）。
- 「限定必须跟着结论一起搬家」的处置正确：§3.1 要求二元组同时落到 §15.3 与验收报告，两处都写才是同一条判据。
- §3.2 不动 `model_effective_source` 三态语义、绝不让请求值渗回生效值——与 `codex.ts` 的 `buildCodexResult` 注释和该函数为变异验证而被抽出来的历史一致，这条纪律应保留。
- §6.2 的 M3（把目录拦截改回「读基底目录」必须当场变红）是本步最有价值的一条测试设计，它正是 E-4 缺陷本身；M1/M2 也各咬住一个真实的冒充路径。
- §6.1 用实测原始回读值而不是构造 fixture，与 §3.4「直接调生产函数不另写一份参数构造」是同一条正确取舍。
- E-3/D4-3 不加半截旗标、E-5 把「文档头」列为独立回填项、以及编号不沿用 `F-n`/`D-n` 的理由，都成立。
- §8 对 U-4 的改写（区分「本机描述符」与「端点受理」两层、并声明端点侧未实测、失败时按此定位）是本次计划里口径最干净的一段。

## 未覆盖范围（本侧盲区）

- `.trivium/config.yaml` 与 `.trivium/` 整棵子树在禁读清单内（任务书的必读清单与禁读清单在这一项上冲突，我按禁读优先），故 §3.3 关于用 `config.local.yaml` 覆盖的具体键名、以及本机档位表里 codex 的模型 slug 现值，我未能核对；「切家族要同时改两处（厂商 profile + 档位表里的 codex 模型）」这一疑点因此没写成意见。
- 另一位审查员的产出、本主题 r1～r9 各轮意见正文全部未读（禁读清单）；我对轮数的引用只依据文件名，不依据内容。
- `~/.codex/` 下的 `config.toml` / `models-*.json` 实际内容未读（沙箱只允许读工作区）：E-4 的十条/四条、隐藏项、`context_window=1048576` 均按文档与代码注释采信，未独立复核，CODEX-03/04/05 的前提若与本机和事实不符请以此为准回退。
- 措施 b 的读取提取实现细节、`report` 的三对 Jaccard、`gate --check` 的编号前缀差集（U-5）本次未审。
- 镜头文案与 `lenses.yaml`、prompts 层未审；需求追溯（PRD 第 20 条原文与 FR-27/FR-29 全文）未逐条比对，AC-22「顺带达成」的边界我只核对了计划自己的措辞。
- 未执行 `npm run check`、未跑任何单测，故 §5.1 改动清单的测试影响面（尤其 `test/unit/registry-parity.test.ts` 的 schema 兜底扫描是否会因改名报错）只做了静态判断。

## 实际查阅的项目文件

- `.reviews/M8-Codex审核者接入/plan/2026-09-16-M8-Codex审核者接入-r5-claude.md`
- `AGENTS.md`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/codex-trace.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/preflight.ts`
- `src/trivium/probes/codex.ts`
- `src/trivium/cli.ts`
- `src/trivium/config.ts`
- `src/trivium/review.ts`
- `src/trivium/meta.ts`
- `src/trivium/report.ts`
- `src/trivium/archive.ts`
- `skills/dual-critic/schema/run.v2.json`
- `skills/dual-critic/schema/config.v2.json`
- `skills/dual-critic/schema/review.v1.json`
- `test/unit/registry-parity.test.ts`
- `doc/05_testing/README.md`
- `doc/README.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `skills/dual-critic/SKILL.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":25,"project_reads":26}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
