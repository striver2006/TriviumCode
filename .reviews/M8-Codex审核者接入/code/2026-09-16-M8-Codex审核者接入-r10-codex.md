---
schema: trivium.review.v1
topic: M8-Codex审核者接入
stage: code
role: codex
vendor: openai
agent_cli: codex/0.154.0
model_requested: deepseek-flash
model_effective: deepseek-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260916T040240Z
rerun_index: 10
snapshot_hash: sha256:22830bef9dc071bf8c7cea45152d22abba871a9f979677a751b81d41b9a1e680
blind: true
started_at: 2026-09-16T04:02:41.469Z
finished_at: 2026-09-16T04:23:04.050Z
duration_s: 293
tool_calls:
  run_command: 82
  project_reads: 40
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 4
  nit: 2
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0a861-9182-7e10-b535-4c0fcf5459db
---

# 代码审查：M8-Codex审核者接入

> Critic-C · OpenAI Codex ｜ 模型 `deepseek-flash`
> ｜ 运行 `20260916T040240Z` ｜ 第 10 轮
> ｜ 本轮审核者 glm、codex

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

本步把 AC-20 从「二元组」收紧到逐分量、把模型目录改成按本次 profile 校验、给沙箱负对照补上正对照，方向与落点都成立，代码与文档回填大体自洽。但有一条我要拦：逐 profile 采集把「探针子进程失败」与「该 profile 确实渲染不出目录」压成同一个 `[]`，消费方据此走 `unverifiable` 第三态——**不拦且不报**，等于给 codex 侧刚接上的 slug 预检留了一个静默失效的口子，且给出的原因（「该机可能未配置 model_catalog_json」）是数据支撑不了的（CODEX-01）。其余六条为次要项：r6 计划承诺的 BACKLOG 登记没落（CODEX-02）、失败出口把已知的 `profile_requested` 写成 null 而同类事实 `model_requested` 照常入档（CODEX-03）、预检侧接线一条测试锁都没有（CODEX-04）、沙箱对照脚本自造探针输入（CODEX-05）、`base_url` 整串入库而判据只需 host（CODEX-06）、证据脚本 `process.exit` 可能截断输出（CODEX-07）。AC-20 真机验收未跑这一点，变更集里已由 PRD 与设计 §16.1 如实标注，我核对无夸大——但也意味着本步的验收证据不在本次被审对象内，我只能审「判据与实现」，不能替它判达成。

**结论**：`request-changes`

## 审查意见（共 7 条：重要 1 ｜ 次要 4 ｜ 吹毛求疵 2）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/codex.ts:254-281（probeCodexModels 的三个 empty 出口）与 :672-676（逐 profile 赋值）；src/trivium/adapters/codex.ts:390-416；src/trivium/preflight.ts:391-396 与 :315-330` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：`probeCodexModels` 对**三种情形**返回同一个 `empty`：子进程非零退出、stdout 不是可解析 JSON、以及目录确实一条模型都没有。探针把这个 `visible: []` 原样存进 `models_by_profile[name]`，而 `catalogModelsFor` 只对「整张表为空」（旧留痕）回落基底，表在而本 profile 为空时返回 `{models: [], why: '…渲染不出模型目录（该机可能未配置 model_catalog_json）'}`；预检见 `models.length === 0` 即记 `unverifiable`，而 `unverifiable` 只进 detail、`ok` 仍为 true。后果有二：①**fail-open**——本步之前 codex 的 slug 至少会拿 `probe.models` 判一次，现在一次 `debug models` 子进程失败（超时、CLI 升级、该 profile 的 `model_catalog_json` 指向的文件被删改——P-27 已证这个文件是活的）就把这道拦截静默降级成放行；②**错误归因**——文案把「说不出来的原因」写成了一个具体原因，用户会去查一个可能并不存在的问题。同样的静默在 doctor 侧也存在：`notes` 只在**全部** profile 都取不到时提示，单个 profile 采集失败一条话都没有。这与本步自己立的口径（「说不出来要说出来，不假装通过」）方向相反：现在是「说不出来就放行，还替它编了个理由」。

**依据**：读 src/trivium/probes/codex.ts:254-281：`const empty = { models: [], visible: [], efforts: {} }`、`if (r.code !== 0) return empty;`、`catch { return empty; }` 三处出口无区分；:672-676 循环 `probe.models_by_profile[name] = c.visible`；:955-969 `readCatalogPath` 只回答「路径」，不回答「取到没有」。读 src/trivium/adapters/codex.ts:390-416：只有 `Object.keys(byProfile).length === 0` 才回落，`?? []` 把「无此条目」与「目录真为空」并成一格。读 src/trivium/preflight.ts:391-396（`scoped.models.length === 0` → unverifiable）与 :315-330（unverifiable 仅并入 detail，返回 ok:true）。对照 test/unit/codex-adapter.test.ts:537-546：这一格被断言为「表在而本 profile 渲染不出目录 → 空清单（无法校验）」，即把「失败」当成了「确认没有」。

**建议**：让探针按 profile 记**状态**而不是只记清单：区分「取到（含空）」「采集失败（为什么）」，失败时消费方回落到本步之前的 `probe.models` 行为并在预检输出里说明这是回落，而不是把未知当「没有目录」；`unverifiable` 只留给「目录确被渲染且确实为空/不可用」这一格。同时让 doctor 的 notes 对单个 profile 采集失败点名。另建议顺手把这一现象登记进坑清单（它是「同一个观测两种成因」的又一实例）。

### CODEX-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/08_project/BACKLOG.md（EV 表末条为 EV-24）｜.reviews/M8-Codex审核者接入/plan/2026-09-16-M8-Codex审核者接入-r6-revised-claude.md §0 的 CODEX-01 行｜src/trivium/probes/codex.ts:780-796` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：r6 计划对阻断项 CODEX-01 的落点写明「另在 BACKLOG 登记**现有探针结论带同一未排除混淆**（不改探针，本步不扩范围）」，但这条登记没有落地：BACKLOG 的 EV 表逐条看下来没有这个议题（末条为 EV-24），「待双审」段只有 RV-B1；设计 v1.3.11 的变更记录（§24）虽然把「现有探针的负对照就是一行 `exists(breachPath)`」写进了正文，但没有给出任何登记落点。于是这桩缺陷只活在计划件与设计正文里，而探针代码仍是 `const breached = await exists(breathPath)` 的单断言——`probe.cli.codex.readonly_flags` 的可信度、以及 `availability()` 里「只读旗标为空 ⇒ 该侧不可用」这条现行判据，仍然只有阴性证据。下一个按 BACKLOG 查未收口项的人查不到它。

**依据**：读 r6-revised 计划 §0 表 CODEX-01 行（落点列含「另在 BACKLOG 登记…」）；`grep -rn "负对照|breachPath|空洞|未排除" doc/08_project/BACKLOG.md doc/02_design/*.md` 只命中设计 v1.3.11 的正文陈述与措辞无关的同名条目；`grep -n 'EV-1[0-9]|EV-2[0-9]' doc/08_project/BACKLOG.md` 显示 EV 表止于 EV-24，无对应条目；读 src/trivium/probes/codex.ts:780-796 确认探针仍只有 `exists(breachPath)` 一条断言（无「那条命令确实执行过」的证据）。

**建议**：补登一条 EV（写明它影响 `probe.cli.codex.readonly_flags` 与 `availability()` 的空数组判据，并说明本步不改探针的范围边界）；或按本项目「指不出断言就不许那样写」的口径，明确撤销该落点并说明理由。二者取一，不要让它悬在计划件里。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:172-177｜src/trivium/adapters/codex.ts:421-500｜src/trivium/review.ts:1059 与 :1070` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：所有失败/超时出口都把 `profile_requested` 写成 null（base.ts 的注释理由是「两者都没走到，如实记 null」），但**同类事实 `model_requested` 在同一份 run.json 里对失败侧照常有值**（review.ts:1059 从 `requests[c].model` 取，与结果对象无关）。于是「该族没有厂商 profile 这个概念」（agy/zcode）与「这次 codex 超时没采到」在留痕里又长得一样——恰是 `CriticResult.profile_requested` 文档块声明要避免的那一格；AC-20 的 J6「请求值如实入档」在失败运行上也无从核对。而 codex 适配器的每个失败出口手边就有 `cfg.profile`（:432 之后已取出），它是配置级事实，与「有没有走到调用」无关。

**依据**：读 src/trivium/adapters/base.ts:158-186（failedResult 里 `model_provider: null, profile_requested: null`，注释称「两者都没走到」）；读 src/trivium/adapters/codex.ts:415-500（探测缺失/入口缺失/隔离准备失败/拉起失败/超时/未产出最终回复六个出口全部调 `failedResult`，无一处传 `cfg.profile`）；读 src/trivium/review.ts:1050-1072（同一对象里 `model_requested` 走请求、`profile_requested` 走结果）；读 src/trivium/runner.ts:175-195（适配器抛异常的兜底分支同样写 null）。

**建议**：失败出口把已知的请求值如实写入（给它一个可选入参即可），或至少在 run.v2 的字段说明与设计 6.7.1 里承认 null 的多义并给出区分手段——二者必居其一，不能既声称「必填是为了区分两种空」又在最常见的一类留痕里制造新的歧义。

### CODEX-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/preflight.ts:391-396｜test/unit/preflight.test.ts（全篇无 codex 用例）｜test/integration/codex-wiring.test.ts:80-115 的 seedProbes` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：本步最实的一处修复是「预检按**本次 profile** 的目录校验」，但只有适配器钩子这一半有单测：`catalogModelsFor` 的三种返回在 test/unit/codex-adapter.test.ts 里各有一条。预检侧**怎么消费它**没有任何断言——`preflight.test.ts` 只给 gemini/glm 配目录，集成夹具 `seedProbes` 的 codex 段（models/providers/readonly_flags 等）压根没有 `models_by_profile`，于是整条链在这些用例里走的都是「整张表为空 ⇒ 回落基底」那一支。把 preflight.ts:391-395 两行删掉或改回只读 `probe.models`，现有全部用例（含 M3 变异报红的那 2 条）都不会响：那 2 条红在适配器侧。也就是说，这条修复目前只有「钩子对」的锁，没有「钩子被用上」的锁。

**依据**：`grep -rn 'catalogModelsFor|models_by_profile|checkModelAgainstCatalog' src test skills`：命中集中在 src/trivium/preflight.ts、src/trivium/adapters/{base,codex}.ts、src/trivium/probes/codex.ts、src/trivium/types.ts 与 test/unit/codex-adapter.test.ts，**test/unit/preflight.test.ts 与 test/integration/codex-wiring.test.ts 零命中**；读 test/unit/preflight.test.ts:80-125、:375-410（模型目录三态用例都只配 gemini/glm）；读 test/integration/codex-wiring.test.ts:80-115（codex 探针夹具无 `models_by_profile`）；读 design v1.3.11 §24 第七条记载 M3 变异「目录拦截改读基底目录（红 2 条）」，那 2 条即适配器侧用例。

**建议**：在预检层加两条：①codex profile 的目录与基底不同时，只在基底目录里的 slug 判 `bad` 并点名；②`models_by_profile[profile]` 为空的格走「未实际校验」且文案指名道姓。集成夹具 `seedProbes` 补一个 `models_by_profile` 覆盖参数即可，成本很低。

### CODEX-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/codex-sandbox-control.mjs:121、130-141（尤其 :137）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：脚本头自称「直接调生产函数（`prepareCodexHome` + `invokeCodex`），不另写一份参数构造」，但只读旗标是**写死**的 `readonlyArgsFromProbe(['-s','read-only'])`，而生产路径取的是探针结论 `probe.readonly_flags`（适配器里同一个函数，入参不同源）。于是这次对照实验证明的是「脚本挑的那组旗标下写入被拒」，不是「生产实际会跑的调用形态下写入被拒」；更实的一层：`readonly_flags` 为空数组在设计上的含义是「探针判定本机沙箱不可信、该侧必须判不可用」，此时脚本照样会跑出一个 ✅ 并写进报告的 `正对照/负对照`，与生产口径相反。codex 入口也写死 `/opt/homebrew/bin/codex`（可由环境变量覆盖，但默认值不来自探针 `entrypoint`）。它作为「AC-20 J5 的复现实验」被报告引用，口径必须与生产同源。

**依据**：读 scripts/codex-sandbox-control.mjs:56-73（自称直接调生产函数的理由）、:99（`profile` 取环境变量默认 `qwen`）、:121（bin 写死）、:130-141（invokeCodex 入参，:137 旗标写死）、:56-66 与 :46（用法：需 `node scripts/build.mjs --with-tests` 的前置）。对照 src/trivium/adapters/codex.ts:425-461（生产同一个调用用 `readonlyArgsFromProbe(probe.readonly_flags)`，:459）与 :76-83、:322-330（空数组 ⇒ 该侧判不可用）。

**建议**：只读旗标与 bin 从探针结论（`probe.cli.codex.readonly_flags` / `entrypoint`）读；`readonly_flags` 为空时脚本应显式拒绝运行并说明「按设计该侧不可用」，而不是产出一个 ✅。若确实要用固定旗标，就在脚本头与报告里把「这是实验输入、不是生产输入」写死，别让读者以为是生产形态。

### CODEX-06 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/codex.ts:160-175（providerBaseUrl）｜src/trivium/types.ts:245-257（CodexProviderProbe.base_url）` |
| 类别 | security ｜ 层次 code |
| 置信度 | low |

**问题**：整串 `base_url` 被采进探针结论（落 `config.local.yaml`、进 doctor 输出），而 AC-20 的第四分量只要「至少 host」。URL 的 userinfo（`https://user:token@gateway/v1`）与 query 部分是可以承载凭据的常见形态，此时「只取 base_url 一个键就不碰凭据」这条理由不成立——而本步刚因为一次凭据外泄在 `CLAUDE.md` 里立了硬规矩。这不是已成事实的泄漏，是采集范围比判据需要的宽。

**依据**：读 src/trivium/probes/codex.ts:160-175（只做 `base_url` 键值提取，原样返回字符串）、:218-224（写进 `out.push({... base_url: baseUrl })`）；读 src/trivium/types.ts:245-257（注释「不含凭据，只记 endpoint」）；对照 design §15.3 AC-20 第四分量「两侧 provider 的 `base_url`（至少 host）互不相同」——判据只需要 host。

**建议**：落盘前归一化到 host（或至少剥掉 userinfo/query）——判据只需要 host，多留的部分既无消费方又扩大了凭据面；若故意要留全串，就在文档块里说明「凭据可能出现在 URL 里」并给出理由。

### CODEX-07 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/codex-sandbox-control.mjs:173-203` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：报告用 `console.log` 打印后立刻 `process.exit(...)`。stdout 接管道（`| tee`、被另一进程读取）时 Node 不保证已排队的写入在退出前落盘，报告与 verdict 可能被截断——而这个脚本的产物就是 AC-20 J5 的证据文本（报告里含每条命令及其 300 字符输出，体积随命令数增长）。同一形态在 M0 报告里那份探针脚本副本上也存在，照着抄会把这个坑带下去。

**依据**：读 scripts/codex-sandbox-control.mjs:146-203：:173 `console.log(JSON.stringify(report, null, 2))`、:196 verdict、:203 `process.exit(attempted && denied && … ? 0 : 1)`，之间没有任何 flush；脚本用法注明输出是给人贴进报告的（:46）。

**建议**：退出码改用 `process.exitCode = …` 让 stdout 自然收尾（或显式 flush 后再退）；`--keep` 分支同理。改动一行量级，但证据脚本的输出完整比退出码早到更重要。

## 认为正确的部分

- 逐分量判据（① `model_provider` 互异 ② `model_effective` 互异 ③ 各自与本次请求一致 ④ 两侧 provider 的 `base_url` 至少 host 互异）把「两次跑的是两个模型家族」这件事拆到了可核对的四个维度，比原先的「二元组任一分量不同即可」强，而且 `base_url` 那一层是真实的漏洞（两个 provider id 可指向同一 endpoint）。
- 请求值与回读值成对产出在 `buildCodexResult` 这个纯函数里，并有用例咬住「不得互相顶替」，夹具用的还是本步真机实测的原始回读值（`-p qwen -m deepseek-v4-pro` 成功退 0）——用真实形态当夹具比构造值可信，这一点做得对。
- `catalogModelsFor` 的三种返回（null / 非空 / 空）语义分开写清，且「整张表为空（旧留痕）⇒ 回落基底而不是返回空清单」这一条明确防住了 fail-open，方向正确（我在 CODEX-01 里拦的是**另一格**：表在而本 profile 的那格把失败与确认为空合流）。
- `providerSectionBody` 从 `providerCredentialed` 里抽出来给 `providerBaseUrl` 复用，避免同一件事两份实现漂移；`providerBaseUrl` 只取 `base_url` 一个键、绝不等价于整段外泄，与 `providerCredentialed` 的「只判有无，绝不返回值」是同一条口径。
- 改名 `profile_requested` 对旧留痕无读侧影响：我核对了 `skills/dual-critic/schema/run.v1.json` 全篇没有 `profile` 键，因此不存在读侧映射缺口；`config.v2.json` 的 `probe.cli.<cliName>` 是 `additionalProperties: true` 的 `commonProbe`，新增 `models_by_profile` / `base_url` 不会被 ajv 拒，也没有「按身份枚举」的违规（纪律 12 未被破坏）。
- 文档侧的失实现状断言（文档头「M8 其余各步尚未开工」、§16.1 的 M8 行、PRD 的 ⚠️ 段）三处一起改，并把「文档头」在回填清单里单列为独立项——这是对「连续两版漏填同一处」的正确处置，不是补一句话。
- `P-24～P-27` 的补录位置选对了（`doc/05_testing/README.md` 明确写着 M0 报告 §7 是唯一落点），编号连续无重复，且索引行与该表一致；`debug models` 不接受 `--json` 这一条也就地更正了文档块——注释里的命令要能逐字跑通，这条口径我认同。
- `node node_modules/typescript/bin/tsc --noEmit` 退 0：新增的必填字段在所有构造点都已补齐，没有靠 `as` 断言绕过。

## 未覆盖范围（本侧盲区）

- AC-20 的真机验收（两个模型家族各真实审查一次、T1～T5、提取召回率）不在本变更集内，我无法复核；本审查只覆盖「判据与实现」这一半，达成与否仍须按设计 §15.3 与 §16.1 的标注看待。
- 没有执行任何真实 codex 调用（沙箱只读、且会烧配额），因此 `codex debug models` 在「没有任何 `model_catalog_json`」的机器上到底渲染出什么（内置目录还是空）、以及 `-c model_catalog_json=<不存在的文件>` 的退出码，我没有实测——CODEX-01 的**触发频率**因此只能按代码推断，其严重度我标了 medium 置信。
- 没有跑 `npm test` / `npm run check`：`dist/` 是既有产物而沙箱禁写，重建会被拒。我只跑了 `tsc --noEmit`（退 0）与静态阅读，测试全绿的说法未经我复现。
- 未审本步之外的代码：`adapters/codex-home.ts`、`adapters/codex-trace.ts`、`adapters/index.ts` 不在本 diff 里，我只在需要判断调用链时读了它们的接口与少数片段。
- 未核对「54 份历史 run.json 里 `"profile"` 零命中」这一说法——那些留痕在禁读的运行目录下，我不去读。
- 未做跨平台验证：项目声明仅 macOS，我只核了 shell/路径/临时目录相关写法（`os.tmpdir()`、`path.join`、无 `timeout` 命令假设），没有第二平台可测。
- 未评估 `models_by_profile` 写进 `config.local.yaml` 后的体积与留存影响（每个 profile 一份清单、随 `retention` 策略走），也未核对 `doctor` 报告渲染是否会把它原样打印。

## 实际查阅的项目文件

- `.reviews/M8-Codex审核者接入/code/_meta/changes-20260916T040240Z.diff`
- `.reviews/M8-Codex审核者接入/plan/2026-09-16-M8-Codex审核者接入-r6-revised-claude.md`
- `AGENTS.md`
- `README.md`
- `package.json`
- `src/trivium/types.ts`
- `src/trivium/config.ts`
- `src/trivium/runner.ts`
- `src/trivium/review.ts`
- `src/trivium/preflight.ts`
- `src/trivium/meta.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/probes/codex.ts`
- `src/trivium/util/exec.ts`
- `scripts/codex-sandbox-control.mjs`
- `scripts/build.mjs`
- `skills/dual-critic/schema/run.v2.json`
- `skills/dual-critic/schema/run.v1.json`
- `skills/dual-critic/schema/config.v2.json`
- `test/unit/codex-adapter.test.ts`
- `test/unit/preflight.test.ts`
- `test/integration/codex-wiring.test.ts`
- `doc/01_requirements/PRD_driver_dual_critic.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-09-11_m0_probe.md`
- `doc/05_testing/REPORT_2026-09-14_m6_codex_probe.md`
- `doc/08_project/BACKLOG.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":82,"project_reads":40}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
