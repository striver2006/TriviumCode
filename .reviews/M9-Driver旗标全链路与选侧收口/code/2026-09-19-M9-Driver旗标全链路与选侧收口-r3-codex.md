---
schema: trivium.review.v1
topic: M9-Driver旗标全链路与选侧收口
stage: code
role: codex
vendor: openai
agent_cli: codex/0.155.0
model_requested: deepseek-flash
model_effective: deepseek-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260918T231928Z
rerun_index: 3
snapshot_hash: sha256:88ad249158178ed8ed502eace1f0ce5a2e8d5fcc341265a8c3b661e84a4e61c8
blind: true
started_at: 2026-09-18T23:19:29.542Z
finished_at: 2026-09-18T23:32:15.247Z
duration_s: 674
tool_calls:
  run_command: 88
  project_reads: 90
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 3
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0b6d1-5e6d-7992-8371-2251d0442417
---

# 代码审查：M9-Driver旗标全链路与选侧收口

> Critic-C · OpenAI Codex ｜ 模型 `deepseek-flash`
> ｜ 运行 `20260918T231928Z` ｜ 第 3 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

三处焦点逐条核过，未发现会让线上出错的缺陷：①gate 新的 role↔driver 比对**按构造不会误拒**——缺省 Driver 下 role 由 schema 钉成 claude 而 driver 也是 claude（恒等），driver≠claude 时它只在 schema 已经放行的「谎报件」那一格生效；归档 68 份裁决件 role 全为 claude、49 份 v2 留痕 driver 全 claude、33 份 v1 经 v1→v2 映射为 claude，存量零影响。②driver-wiring 的手写扫描器今天在 src 全量 63 个文件上与 TypeScript AST oracle 逐字符一致（少剥 0、多剥 0），但它明文选择的「宁可少剥」回落方向恰恰是**假绿**：我实测把真 `driver,` 从 newRunMeta 实参块删掉后，只要同块内出现一行 `if (ok) /driver/.test(name)` 之类（`)`/`]`/模板/串之后或除号链之后的正则），判据就重新全绿；反向多剥同样存在（`n++ / total / 2`、`obj.in / total / 2` 会删掉真代码）。③模型旗标白名单的取舍本身可接受，**但 EV-67 记的阻断理由不成立**：被点名的那条正例取样是 codex，而 `--critics` 缺省回落就是含 codex 的 DEFAULT_CRITICS，收紧到「已解析出的入选集合」它照样绿。另有两条 minor/nit：两个入口的 `--model-*` 收集面仍不同（CRITICS vs ALL_AGENT_IDS）、preflight 的 driverEnabled 缺省方向取了乐观侧。

**结论**：`approve-with-nits`

## 审查意见（共 4 条：次要 3 ｜ 吹毛求疵 1）

### CODEX-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/driver-wiring.test.ts:66-152（stripNonCode 的 `/` 判定与「宁可少剥」那段文档块）、同文件 TARGETS 的 12 个受护实参块` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：文档块 66-68 行写的是「万一判错，扫到换行就当除号退回去——宁可少剥，不可跑偏」，而文件开头追的性质是「判据写错时倒向红」。这两条在 `/` 的歧义上互相矛盾：判成除号时，**正则字面量的正文会原样留在被扫描文本里**，于是 `hasProperty(block, key)` 可以从「不是代码的东西」里命中 `driver`／`gateDriver`／`overrideReasonFor`。也就是说这个守卫在最要紧的方向上不是 fail-closed 而是 fail-green——而它是这一步 12 处接线判据唯一的看守。除已知的「`)` 之后」外，同族形态至少还有：`)` 之后的除号链（`hasOptions(x) / /driver/.test(s)`）、`]`/模板/字符串之后的除号链（`list[i] / /driver/.source.length`、`` `x` / /driver/.test(y) ``）、以及 ASI 风格下「上一语句没有 `;`」时跟在 `]`/`}`/字面量之后的正则。反向也多剥：`REGEX_PREV` 含 `+`/`-`，于是 `n++ / total / 2`、`obj.in / total / 2`（`in`/`of`/`do`/`case`/`else` 作为属性名）被判成正则起点，把同一行两个 `/` 之间的真代码整段删掉——那会让判据变红（方向安全，但会给出误导性的「接线没传」）。

**依据**：我按 70-152 行逐字复制了 stripping 状态机（只加事件记录），对 src 下 63 个 .ts 与 `ts.createSourceFile` + 节点区间造的 oracle 逐字符比对：**少剥 0 处、多剥 0 处**（`\.in /`、`++ /` 这类形态今天不存在，所以问题是潜伏的，不是活的）。随后在内存里改 src/trivium/review.ts：删掉 `newRunMeta({...})` 里的真 `driver,` → 断言 `hasProperty(block,'driver') && !/\bDEFAULT_DRIVER\b/` 与锚点条数=1 判【红】；再在同一块里补一行 `driverTag: (() => { if (ok) /driver/.test(name); return null; })(),` → **判据重新判【绿】**（剥离结果里保留了 `driverTag: (() => { if (ok) /driver/.test(name); ...`）。同形替换为 `list[i] / /driver/.source.length`、`` `x` / /driver/.test(y) ? 1 : 2 ``、`hasOptions(x) / /driver/.test(String(x)) ? 1 : 2` 结果相同。多剥侧实测：`const r = obj.in / total / 2;` → 剥成 `const r = obj.in  <re>  2;`，`n++ / total / 2`、`n-- / total / 2` 同形。另核：`const r = a / b;`（真除号）与 `a.replace(/x/g,'y')`（真正则）都判对，`if (ok) /driver/.test(s);`（已知边界）如文档所述不剥。

**建议**：方向二选一：①把扫描器换成真词法器——测试进程本来就跑在 node_modules 下，直接 `ts.createSourceFile` 取 AST，按注释/字符串/模板（保留 `${…}`）/正则四类区间抠掉，语义精确、这一族误判整体消失（我这次就是用同一个 oracle 做对照的）；②若坚持手写，就把「不确定」做成 fail-closed：除号判定与「正则未闭合」两条分支不要保留原文字符，并补一条判据自测——喂「`)` 之后跟正则」的合成语料，断言含 key 字样的正则正文不得出现在剥离结果里（现在的自测只覆盖注释/字符串/块定位三条，覆盖不到这一格）。

### CODEX-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/08_project/BACKLOG.md 的 EV-67 行；test/integration/driver-flag.test.ts 末条用例的「论域边界」注释；对照 test/unit/topic-args.test.ts:753-762` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：第 3 条焦点问的是这个取舍成不成立。我的判断：**取舍（本步不收紧）可以接受，但它登记的理由不成立**。EV-67 与集成用例注释都把推迟归因于「会与『`--model-<side>` 不带 `--critics` 必须放行』那条既有正例直接冲突」。我核了那条正例的取值：`side = SELECTABLE[0]`，而 `SELECTABLE = CRITICS − DEFAULT_DRIVER`、`CRITICS = [claude,codex,gemini,glm]` → 取到的是 **codex**；`--critics` 缺省回落的 `review.default_critics = DEFAULT_CRITICS = [codex,gemini,glm]` **含 codex**。所以把白名单判据从 `selectableCritics` 换成「`resolveCriticSelection` 已解析出的入选集合」，那条正例照样通过——真正会改成退 64 的只有「用户显式写了 `--critics` 把那一家排除掉」的写法，那正是本条要治的静默丢弃。于是一句不实的事实进了唯一实现依据与集成用例注释，下一个人会据此认为收紧被一条测试挡住而继续推迟；同时「不带 `--critics` 时该按谁判」这个问题在两个入口其实已有答案（按已解析出的那份，缺省即 default_critics），并不需要等第 6 步的选侧语义。

**依据**：读 test/unit/topic-args.test.ts:753-762（正例本体）、test/helpers/critic-fixtures.ts:52（SELECTABLE 定义）、src/trivium/agents/registry.ts:129-232（四家 defaultSelected/driverEnabled）、src/trivium/config.ts:254（default_critics 取 DEFAULT_CRITICS）；用 node 加载 dist 里的模块实测：`CRITICS=[claude,codex,gemini,glm]`、`DEFAULT_CRITICS=[codex,gemini,glm]`、`resolveCriticSelection(cfg,{}) = [codex,gemini,glm]`、`selectableCritics(cfg) = [codex,gemini,glm]`，故 `SELECTABLE[0]=codex ∈ 解析后的集合`。另读 src/trivium/cli.ts:479/492/505 与 src/trivium/topic-args.ts:370/508：两处的 `critics` 都在白名单判定**之前**就已解析好，收紧不需要新的判定次序。

**建议**：要么据实改写理由（「收紧是行为变化——一批今天静默生效的写法会当场退 64，需要单独一轮验证」），要么按 BACKLOG 自己给的第一条路先落**告警**：`sides` 解析完成后点名「这几个模型覆盖本轮没用上」，把静默丢弃变成可见，拒绝留到第 6 步。重要的是别把「与那条正例冲突」留在台账与用例注释里当事实。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/cli.ts:311-318（collectModelOverrides）对照 src/trivium/topic-args.ts:508（ALL_AGENT_IDS.filter）` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：本步收口的是「判定只有一份」，但两个入口的**收集面**仍不同：`topic resolve` 遍历 `ALL_AGENT_IDS`（全部已登记），`review --start`/`preflight` 遍历 `CRITICS`（已启用审核者）。于是「已登记但未启用为审核者」的 `--model-<id>` 在 `review --start` 上**根本不会进 `Object.keys(modelOverrides)`**，`assertModelOverrideKeys` 看不到它 → 不退 64、不进留痕、不给告警，正是 EV-53 原文的症状；同一条命令走 `topic resolve` 却会退 64。而 cli.ts 新增的注释（「判定共用 critics.ts 的那一份」）与集成用例都宣称两个入口已同口径，读的人会以为这一族已经关掉。今天不可达（四家全启用 ⇒ CRITICS 与 ALL_AGENT_IDS 元素相同，EV-53 注①也记了这条死分支），但登记第五家而未启用它时立刻可达，且症状无声——与「改一漏二」同族。

**依据**：读 src/trivium/cli.ts:305-318（注释写「`<id>` 取自注册表派生的可用审核者集合」即 CRITICS）与 492-505、src/trivium/topic-args.ts:508-509；读 src/trivium/agents/registry.ts:264-266（CRITICS 由 `criticEnabled` 派生）；用 node 加载 dist 实测两者今天元素相同（都含 claude/codex/gemini/glm），故本条为潜伏缺口而非现网缺口。

**建议**：把收集面统一到 `ALL_AGENT_IDS`（收集＝全部已登记，判据＝本步已收口的 selectableCritics），或在 `assertModelOverrideKeys` 里同时收「已登记但没进键集」的那几个旗标名。这与 EV-67（能入选但本轮没入选）不同源，可以独立于第 6 步先落。

### CODEX-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/preflight.ts:620-628（当轮 Driver 提示）与 77-84（PreflightOptions.driverEnabled 注释）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：提示只说 `opts.driverEnabled === false` 时才补「该值仅用于选侧判定」，`undefined` 与 `true` 一律按「已启用」呈现。这个字段的存在理由就是「放行但如实标注」，缺省却选了乐观的一侧：将来任何新调用方传了 `driver` 而忘了 `driverEnabled`（或某个手工构造 ReviewOptions/PreflightOptions 的路径），那半句提示会静默消失，而「M9 只校验已登记」的口径恰恰是必须由留痕与提示兜住的。今天生产只有 cmdPreflight 一处调用并传全了两个字段，所以只是潜在口子。

**依据**：读 src/trivium/preflight.ts:77-84 与 620-628；`grep -rn 'runPreflight(' src/ test/` 确认生产侧唯一调用点是 src/trivium/cli.ts:674（`driver` 与 `driverEnabled` 都传），其余为用例。

**建议**：把缺省翻到保守侧（除非显式 `true` 否则带上保留话术），或把 `driver` 与 `driverEnabled` 绑成一个必填对象传入，让漏传在类型与用例上显形而不是静默少说一句。

## 认为正确的部分

- 焦点①：新的 role↔driver 比对我判**不会误拒**，且理由是结构性的而非经验性的——disposition.v1.json 把 role 钉成 `const: claude`，所以 driver 为缺省值时两者恒等、判据永不生效；driver≠claude 时它只在 schema 已放行的那一格（文件名 `-revised-<driver>.md` + `role: claude`）判红。三条路径里「照资产写」失败在定位（missing_disposition）、「诚实写 role」失败在 schema const，加上这一格正好各自失败在说得清的地方。
- 焦点①：我另核了归档（跳过本主题）：68 份裁决件 front-matter 的 role 全为 claude、文件名后缀与 role 逐份一致；82 份 run-*.json 中 49 份 v2 的 driver 全为 claude，33 份 v1 由 migrateRunMetaV1 映射为 claude——与注释里「对今天的全部留痕零影响」一致。降级轮次不受影响（该判据只读被定位文件自身的 front-matter，与 degraded/voidedSides 无关）；跨轮次复用仍由 `fm.run_id !== input.runId` 挡住；`--run-id` 那条路 driver 与 rerun_index 同取自被钉住的那份留痕，不会错位。
- 焦点①：T-11 第 2 格的断言 `/role=/` 是**可分辨**的——schema 那条走 formatErrors，形如「role must be equal to constant」，不含 `=`；只有新判据的 `role=${…}（当轮 Driver 是 …)` 能满足。删掉新判据该格当场红，不是假证明。
- 「新运行骨架已落、裁决件未写」那一格由旧口径（按工件反推上一轮）改为「指向最新一次运行」，我判为**显式接受的行为变化**而不是误拒：注释与文案都写明，且失败消息给了 `--run-id` 出口（T-12 还专门锁了这条出口必须走得通）。
- 打包面（我的镜头）无问题：`isReviewArtifact` 的 `await import('./render.js')` 在单文件 CJS 产物里被 esbuild 内联成 `Promise.resolve().then(() => (init_render(), render_exports))`（我在 skills/dual-critic/scripts/trivium.cjs:23754 核过），不会在安装位置找 `render.js`；测试构建逐文件 ESM 到 dist/test，该 import 解析到 dist/test/src/trivium/render.js（存在）。meta.ts 里 `await import('./archive.js')` 同理。逐候选文件调用 `readFile`+parse 不持有句柄，无泄漏面。
- 「一份都没有」与「有但全读不出」分档、三条子命令同口径、以及「真实语料回归（.reviews 的历史 run-*.json 必须读得回）」这条把纪律换成机制，方向我都同意；`driver`/`driver_enabled` 一律可选、不进 required、不加 if/then，与我核到的历史形状相容。
- src 下 63 个 .ts 全为 LF、UTF-8 无 BOM、无 U+2028/2029（专为扫描器的行终止符假设核过一遍）：CRLF 下 `//` 注释仍会被整行剥掉，所以这一族今天不成问题。

## 未覆盖范围（本侧盲区）

- 未跑任何构建或测试（只读沙箱，且 `npm test` 会写 dist/ 与临时夹具）。所有结论来自读源码 + 在内存里复现判定函数（我按 test/unit/driver-wiring.test.ts 逐字复制了扫描器，并用 node_modules 里的 typescript 造 oracle 做逐字符对照），没有真实执行 `npm run check`。
- 焦点①我没有构造出「误拒」的实例，但这基于「`role` 仍是 `const: claude`」这个前提；EV-66 把 role 放宽为 `type: string` 之后，该判据会变成唯一的作者身份锁，届时若不变量不变（role 与 driver 同源）结论应当照旧，但我没有对那个未来形状做验证。
- 未审 adapters/、hooks/、freeze/guard 的 M9 相关面（不在本 diff 内）：我只按调用链核了 `enumerateDenyPaths`/`roleIsAllowedForWriter` 的签名与语义，没有验证非缺省 Driver 下禁读矩阵的实际剪枝结果，也没有验证 `--driver <非 claude>` 的端到端验收（那要真跑，且会撞上游记的 disposition role const）。
- 未展开：单值旗标取空值时一律等同未给（splitArguments 存 `''`，`--driver`/`--critics`/`--model-*` 同形，cli.ts 与 topic-args 一致）——我判为既有约定，未列为意见；也未审 `gate --check` 之外会用 run_id/driver 的其它命令（report/status/retention）在新口径下的落差。
- 扫描器一族的「多剥」我只验证了会变红的方向（删真代码 → 断言红）与它会删除同一行真代码这一事实，没有穷举「多剥恰好删掉一个 `(`/`)` 使 argBlockAt 把实参块拉长到真块之外再命中无关 `driver`」这一格的完整触发条件。

## 实际查阅的项目文件

- `.reviews/M9-Driver旗标全链路与选侧收口/code/_meta/changes-20260918T231928Z.diff`
- `src/trivium/critics.ts`
- `src/trivium/cli.ts`
- `src/trivium/gate.ts`
- `src/trivium/meta.ts`
- `src/trivium/preflight.ts`
- `src/trivium/review.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/topic.ts`
- `src/trivium/archive.ts`
- `src/trivium/naming.ts`
- `src/trivium/schemas.ts`
- `src/trivium/types.ts`
- `src/trivium/config.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/hooks.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/state.ts`
- `src/trivium/adapters/agy.ts`
- `src/trivium/adapters/claude.ts`
- `test/unit/driver-wiring.test.ts`
- `test/unit/topic-args.test.ts`
- `test/unit/topic.test.ts`
- `test/unit/run-meta.test.ts`
- `test/unit/preflight.test.ts`
- `test/integration/driver-flag.test.ts`
- `test/integration/gate-loop.test.ts`
- `test/helpers/critic-fixtures.ts`
- `skills/dual-critic/schema/disposition.v1.json`
- `skills/dual-critic/schema/run.v2.json`
- `skills/dual-critic/templates/disposition.md.template`
- `skills/dual-critic/hooks/hooks.json`
- `skills/dual-critic/scripts/trivium.cjs`
- `skills/dual-review-plan/SKILL.md`
- `skills/dual-review-code/SKILL.md`
- `skills/dual-review-bug/SKILL.md`
- `skills/dual-run/SKILL.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md`
- `doc/08_project/BACKLOG.md`
- `scripts/build.mjs`
- `package.json`
- `dist/test/src/trivium/archive.js`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":88,"project_reads":90}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
