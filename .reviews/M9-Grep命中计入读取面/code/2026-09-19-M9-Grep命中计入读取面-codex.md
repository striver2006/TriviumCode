---
schema: trivium.review.v1
topic: M9-Grep命中计入读取面
stage: code
role: codex
vendor: openai
agent_cli: codex/0.155.1
model_requested: deepseek-flash
model_effective: deepseek-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260919T150901Z
rerun_index: 1
snapshot_hash: sha256:05c38932f0f2caa859247991915e2db8ed8c848cf342d6b71e40d3fe3deae8fa
blind: true
started_at: 2026-09-19T15:09:02.854Z
finished_at: 2026-09-19T15:19:22.534Z
duration_s: 321
tool_calls:
  run_command: 70
  project_reads: 55
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 3
  minor: 1
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
peer_leak:
  hit: true
  via: command
  category: orchestrator-state
  paths: []
  commands:
    - |-
      /bin/zsh -lc "cd /Users/chenzhenbo/Work/TriviumCode && node -e '
      const fs=require(\"fs\");
      const {parseClaudeEvents, parseGrepResults}=require(\"./dist/test/src/trivium/adapters/claude-trace.js\");
      const raw=fs.readFileSync(\"test/fixtures/claude-events/grep-content-absolute-path.jsonl\",\"utf8\").split(\"<ROOT>\").join(\"/proj/m9-acceptance\");
      const t=parseClaudeEvents(raw);
      const g=parseGrepResults(t,\"/proj/m9-acceptance\");
      console.log(\"hits\",g.hits.length,\"listed\",g.listed.length,\"resultLines\",g.resultLines);
      const outside=g.hits.filter(h=>"'!h.startsWith("/proj/m9-acceptance/"));
      console.log("hits outside fake root:",outside);
      console.log("hits under .reviews:"); for(const h of g.hits) if(h.includes("/.reviews/")) console.log("  ",h.replace("/proj/m9-acceptance/",""));
      console.log("hits under .trivium:"); for(const h of g.hits) if(h.includes("/.trivium")) console.log("  ",h);
      console.log("sample of hits:"); for(const h of g.hits.slice(0,12)) console.log("  ",h.replace("/proj/m9-acceptance/",""));
      '"' 2>&1 | head -60"
heterogeneous: true
session_id: 01a0ba36-b740-7cd0-ad29-62fcc484f962
---

# 代码审查：M9-Grep命中计入读取面

> Critic-C · OpenAI Codex ｜ 模型 `deepseek-flash`
> ｜ 运行 `20260919T150901Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **命令文本里提到了禁读清单内的文件，但不影响本侧结论**：命中的是编排器状态文件或凭据文件，不含任何审查意见，因此不损害背靠背独立性。记此一笔供审计，无需处置。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

三处焦点的结论：①`content` 与另两档在解析器与消费面**没有**漏线——`search_hit_paths` 只装 `content` 命中，`files_with_matches`/`count` 只进 trace.json 的 `grep.listed`，全仓无第二消费方；②措施 a 的接线在功能上确实成立（我实测命中对端件 → `peerArtifactRead:true`），但**没有任何用例锁它**，删掉并集全仓仍绿；③T7 的集合断言与两次变异记录与代码事实相符（我逐条核对，未运行变异）。最危险的是新登记的理由本身不成立：三处都说「codex 的命令输出不进轨迹」，而 `trace.json` 的 `commands[].output` 里逐字存着命令 stdout，`null` 的真实理由是「未采集」而非「无此事实」。另有一处同补丁内的归一化不一致：consulted 吃了 realpath 别名，措施 a 没吃，符号链接根下这条新通道整族静默失效。

**结论**：`request-changes`

## 审查意见（共 4 条：重要 3 ｜ 次要 1）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/codex.ts:224（`search_hit_paths: null` 的注释）；doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:1763-1764；doc/08_project/BACKLOG.md 的 EV-76 行` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：三处都把 codex 侧 `search_hit_paths: null` 的理由写成「codex 的命令输出不进轨迹 / 该族无此事实」。事实上命令输出**就在轨迹里**：解析器把 `item.completed` 的 `aggregated_output` 收进 `CodexCommand.output`，而 `run()` 把 `commands: trace.commands` 原样写进 `trace.json`。于是 codex 侧的正确标签是「**未采集**（事实在 trace.json 里，适配器没解析）」，不是「没有这种事实」——按本仓三态纪律，这两者必须落成不同观测（types.ts 给 `search_hit_paths` 写的就是这条）。设计 §10.1 又据此写成「codex 的根递归 grep **检测不到**」并拿它当 EV-16 不对称的论据，而那是**没解析**、不是检测能力边界：下一个人重估 EV-16、或按『codex 侧无此能力』设计 M10 四家入口时，出发点是一个不存在的事实。

**依据**：test/fixtures/codex-events/read-sentinel.jsonl 第 5 行：`{"type":"item.completed","item":{"type":"command_execution","command":"/bin/zsh -lc 'head -n 1 /tmp/codex-probe-SMIkHS/sentinel.txt'","aggregated_output":"SENTINEL-OPEN-7f3a2b91\n","exit_code":0,"status":"completed"}}`——命令 stdout 逐字在事件流里；src/trivium/adapters/codex-trace.ts:20-24 与 86-92（`output: String(item['aggregated_output'] ?? '')`）；src/trivium/adapters/codex.ts:186（`command_texts` 只取 `c.command`）与 616-621（trace.json 落 `commands: trace.commands`，含 output）；doc/02_design/2026-09-10-…设计.md:1763-1764；doc/08_project/BACKLOG.md EV-76 收尾句「agy / zcode / codex 无工具输出」。

**建议**：把三处理由改准：codex 记 `null` 的原因是「适配器未采集——输出在 trace.json 的 `commands[].output`，未做命中解析」，并把「检测不到」改成「未解析」。保留「先不解析命令输出」这个取舍可以（解析任意 shell 输出另是一档代价，属 EV-19 那族），但取舍与能力事实要分开写；EV-16 那一段要么同步改口径，要么显式登记「本条不对称的一侧实为未采集」。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/guard.ts:283-286（措施 a 的 `checkPeerLeak`）与 src/trivium/guard.ts:206、399、605-608（`projectRoots`）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：同一份补丁给 consulted 交叉核对加了 realpath 别名（`judgeRun` 算 `projectRoots=[projectRoot, realpath(projectRoot)]`，经 `opts.projectRoots` 喂 `matchConsulted`），但**没有**把同一份 roots 喂给措施 a：`checkPeerLeak` 仍只用 `opts.projectRoot`，它内部的归一化只有 `normalizeAbs`（只抹 `/private` 前缀，不做 realpath）。而新并入的那份事实——Grep 命中的绝对路径——恰恰是用 `init.cwd` 拼出来的，claude-trace.ts 的注释自称 `init.cwd` 是「realpath 形态」（`process.cwd()`/getcwd 返回物理路径）。于是在 `projectRoot` 是符号链接的机器上，`search_hit_paths` 整族落在物理路径下、deny 条目落在链接路径下，措施 a 恒不命中：**同一个对端文件，Read 读到会作废、Grep 命中不会**——新通道在该环境下静默失效，而它正是本次改动要买的东西。这是同补丁内两个消费方归一化口径不一致，不是外部能力问题；`opts.projectRoots` 在 guard.ts 里目前只被第 399 行（consulted）用到。

**依据**：src/trivium/guard.ts:283-286、398-400、605-608、631；src/trivium/adapters/base.ts:1645-1674（`normalizeAbs` 只抹 `/private`，多 roots 归一在 `toProjectRelative`）；src/trivium/adapters/claude-trace.ts:45-52 与 src/trivium/adapters/claude.ts:583。用 dist 产物实测（node 单行脚本，不写文件）：`checkPeerLeak(['/Volumes/Data/repo/.reviews/T/plan/x-glm.md'], ['.reviews/T/plan/x-glm.md'], '/Users/chen/link/repo')` → `{"leaked":false}`，同路径改链接形态 → `{"leaked":true}`；`toProjectRelative` 对 realpath 形态正常返回 `.reviews/T/plan/x-glm.md`；且**即便按 judgeRun 传 `projectRoots:[LINK,REAL]`**，`judgeSide` 对 realpath 形态命中仍判 `peerArtifactRead=false`。

**建议**：让措施 a 与 consulted 共用同一份归一化：给 `checkPeerLeak` 传 roots（内部逐 root `isUnder`/`normalizeAbs`），或先把 `search_hit_paths` 经 `toProjectRelative(hit, roots)` 归一成相对路径再并进匹配集——注释里已经写着「两边经同一份归一化」，实现没做到。补一格用例：`projectRoot` 为链接别名、命中在 realpath 形态时仍须命中 deny 条目。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/guard.ts:283-286 与 test/unit/grep-hits.test.ts 的 `judge()`/REQ` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：本次改动的核心行为——「Grep 命中进措施 a，命中对端件即该侧作废」——**没有任何用例锁定**。grep-hits.test.ts 里所有走 `judgeSide` 的断言都用 `deny_paths: []`（REQ 是唯一请求夹具），T7 只锁 consulted 匹配集、T8 只锁「不进 project_reads」；guard-capability.test.ts 的「两条通道同等处置」喂的是 `read_paths` 与 `command_texts`；integration 侧走 stub/codex 轨迹（`search_hit_paths` 恒 `null`）。因此把 `...(result.search_hit_paths ?? [])` 从 guard.ts 的 `checkPeerLeak` 调用里删掉——即把新规则整个撤销——全仓用例仍然全绿。功能上我实测是通的，缺的纯粹是守卫：这条新规则是安全判定面上的一处 fail-open 面，撤销它不会有任何机器声音。

**依据**：test/unit/grep-hits.test.ts（REQ 的 `deny_paths: []`；`function judge()`；T7/T8 均经它断言）、test/unit/guard-capability.test.ts:60-70 与 300-315、test/unit/runner.test.ts、test/unit/render.test.ts；全仓 `grep -rn "search_hit_paths" src test` 只命中 grep-hits.test.ts 的三处（`deny_paths` 全为空）与三个恒 `null` 的构造夹具。

**建议**：在 grep-hits.test.ts 补一格：请求带非空 `deny_paths`（一条对端审查件路径 + 一条 `.trivium/state.json`），`search_hit_paths` 分别命中两者，断言前者 `peerArtifactRead === true` 且出现在 `peerHits`、后者只进 `notedPaths` 不作废——一条用例同时锁住「接线」与「10.1.1 分档不误伤」。

### CODEX-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/M9-Grep命中计入读取面/plan/2026-09-19-M9-Grep命中计入读取面-revised-claude.md §2.4 / §2.6 / §2.7，对 src/trivium/adapters/claude.ts:489-496、583、943-951` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：实现有三处与已批准的修订计划形状不同，且计划未回补：(1) 计划 §2.4 要求 trace.json 落**三格扁平键** `grepHits` / `grepListed` / `grepResultLines`，实现落成嵌套 `grep: {hits, listed, resultLines}`；(2) 计划 §2.6 要求 `buildClaudeResult` 增 `cwd` 入参，实现改成可选 `opts.fallbackRoot`、基准在 `parseGrepResults` 内部再择 `init.cwd`；(3) 计划 §2.7 要求「T1 / T7 / T10 / T11 各做一次实跑变异并记录」，实现只记两条（同一机制合并覆盖七个用例）且未说明合并。设计 §3.7 已随实现写成 `trace.json.grep.hits`，所以文档不冲突；冲突的是计划与实现——照计划找 `grepHits` 键的人找不到，`变异记录是否齐全` 也无法逐条对账。

**依据**：.reviews/M9-Grep命中计入读取面/plan/2026-09-19-M9-Grep命中计入读取面-revised-claude.md §2.4（「trace.json payload 增三格：`grepHits`…」）、§2.6（「`buildClaudeResult` 增 `cwd` 入参」）、§2.7（「T1 / T7 / T10 / T11 各做一次实跑变异并记录」）；src/trivium/adapters/claude.ts:489-496、583、943-951、973-975；test/unit/grep-hits.test.ts:8-12（两条变异记录）。

**建议**：在裁决件或计划里回补这三处（改计划，或写明偏离与理由）——尤其是键名，它已经进了设计 §3.7 的漂移诊断口径。

## 认为正确的部分

- 焦点一（分档与漏线）成立：`search_hit_paths` 只装 `content` 命中（claude.ts:583 直接取 `parseGrepResults(...).hits`），`files_with_matches`/`count` 只进 trace.json 的 `grep.listed`；全仓 grep `listed` 除解析器外只有两处注释与一句「不进判定面」。我没有找到任何让 `listed` 漏进判定面的路：措施 a、consulted 匹配、证据档三条消费面都只读 `hits`/`read_paths`。另：`listed` 走「非噪声行即当路径」的宽收也无风险——它无消费方，最坏是留痕里多几条假路径。
- 焦点二的功能面成立（缺的只是守卫，见 CODEX-03）：用 dist 产物实测，`search_hit_paths` 里放一条命中 `deny_paths` 的对端审查件路径时，`judgeSide` 返回 `peerArtifactRead: true` 且 `peerHits` 列出该路径；同一份输入换成 `.trivium/...` 则只进 noted 档、不作废——10.1.1 的四类分档在命中层（而非条目层）照旧生效。
- 证据档与计数口径确实没被动：`project_reads`/`PathCoverage`/`checkEvidence` 仍只吃 `read_paths`（T8 以变异守卫锁住），types.ts 对「不进 run.json、只落 trace.json」的说法与代码一致。
- 三态与构造点补齐：`failedResult`、`runner.ts`、`stub`、agy/zcode/codex 三家适配器全部显式 `null`，claude 成功出口写数组（T9 正反两格）；`search_hit_paths` 为必填字段，我用 `tsc --noEmit -p tsconfig.json` 验过全仓 0 错——「可选字段会让没采集与没事实同形」这条纪律落到了类型上。
- 焦点三的记录与代码事实相符：我独立数了夹具（24 条 `tool_use`、9 条 Grep `tool_result`、41 条 `content` 命中、`listed` 为空），与 T7/T1b 断言一致；T7 的断言是**集合级**（`missing` 为空 + `matched.length === 15` + 修前口径 `10/15` 对照），不是只锁 80% 布尔位——计划双审那三条意见确实落到了用例里。我单跑 `node --test dist/test/test/unit/grep-hits.test.js`：9/9 通过。
- 解析器的守卫比计划写得更稳：除两份夹具外，我核到生产夹具里有两条 `output_mode: content` 却**不带 `-n`** 的 Grep，结果行仍带行号——所以「content 行必带行号」不依赖 `-n: true`，这个组合是有样本的（不是漂移风险）。文件级 Grep 的 `行号:文本` 形态、噪声行、数字开头/含空白守卫都有用例。
- 新增的证据/夹具文件没有凭据（我用常见密钥正则扫过 `doc/05_testing/evidence/m9-acceptance-20260919/grep-tool-results-20260919T120643Z.jsonl`，零命中）；夹具与证据件今天字节相同，README 也已把来源、截取范围、根改写写明。
- BRIEF 第 8 段的缓解句并入既有段号、未新增段落，且未改「实际读过」的定义——与 GLM-01 的最坏代价（一次 content 命中对端件 = 整轮报废）是对症的。

## 未覆盖范围（本侧盲区）

- 未跑全量测试与契约层：只单跑了 `dist/test/test/unit/grep-hits.test.js`（9/9 绿）。`npm test` 的 pretest 会重建 dist、contract/integration 会真起子进程与临时 git 夹具——那都是写操作，本次审查禁止，所以我没有验证全量回归，也没有重建任何产物。
- 未真跑两次变异：改文件才能做，只按每个用例的依赖静态核对（`GREP_CONTENT_LINE` 恒不匹配 → T1a/T1b/T2/T3/T7/T8/T10 七条确实依赖它；`isUnder` 退化成裸 `startsWith` → T11 的 `/repository` 一格确实会返回 `../repository/src/a.ts`）。结论是「记录与代码事实相符」，但这是读出来的、不是我跑出来的。
- 未验证 `init.cwd` 在真机上是否确为 realpath 形态：夹具与证据件都被改写成 `<ROOT>`，无从核。CODEX-02 因此只给 medium——符号链接根那一格是代码事实（两处归一化口径不同），环境是否常见我没测。
- 未复核 codex 之外两家的「无工具输出」前提：zcode 的解析器类型只看了解析面（`ZcodeTraceEvent` 只有 path/status，无输出字段，与注释一致）；agy 只看了事件解析文件的注释与字段名。若这两家的事件流里其实有工具输出（像 codex 那样），同一条谬误还有第二、三处。
- 未评估闸门档的联动：`consulted_unverified`/`evidence_ok` 是否进 `gate --check` 告警档属 EV-75③，本次未读 gate.ts 的告警面；也未评估 EV-75（StructuredOutput 写事件）与本改动的交互。
- 未做资源/性能实测：`ClaudeTrace.toolResults` 现在保留**全部**成功 `tool_result` 文本（含整份 Read 内容），生命周期到判定结束；我没测峰值内存，也没有量化一次长审查行的实际占用。
- 未读另一位审查员的任何产出，也未读 `.reviews/M9-Grep命中计入读取面/plan/` 下 gemini/glm 两件与 `_meta/review-*.json`。

## 实际查阅的项目文件

- `.reviews/M9-Grep命中计入读取面/code/_meta/changes-20260919T150901Z.diff`
- `.reviews/M9-Grep命中计入读取面/plan/2026-09-19-M9-Grep命中计入读取面-revised-claude.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/08_project/BACKLOG.md`
- `doc/05_testing/evidence/m9-acceptance-20260919/grep-tool-results-20260919T120643Z.jsonl`
- `src/trivium/guard.ts`
- `src/trivium/freeze.ts`
- `src/trivium/types.ts`
- `src/trivium/brief.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/claude.ts`
- `src/trivium/adapters/claude-trace.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/codex-trace.ts`
- `src/trivium/adapters/zcode-trace.ts`
- `src/trivium/adapters/agy-events.ts`
- `test/unit/grep-hits.test.ts`
- `test/unit/claude-trace.test.ts`
- `test/unit/guard-capability.test.ts`
- `test/unit/runner.test.ts`
- `test/unit/render.test.ts`
- `test/helpers/fixture.ts`
- `test/fixtures/claude-events/README.md`
- `test/fixtures/claude-events/grep-content-absolute-path.jsonl`
- `test/fixtures/claude-events/grep-three-modes-relative-path.jsonl`
- `test/fixtures/codex-events/read-sentinel.jsonl`
- `scripts/build.mjs`
- `tsconfig.json`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":70,"project_reads":55}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
