---
schema: trivium.disposition.v1
topic: 探针扩展与事实回填
stage: code
role: claude
kind: response
run_id: 20260914T134654Z
addresses:
  - 2026-09-14-探针扩展与事实回填-gemini.md
  - 2026-09-14-探针扩展与事实回填-glm.md
---

# 代码应答：探针扩展与事实回填（M6 第 1 步）

## 0. 裁决总览

**12 条全部接受，零驳回。** 两侧均判 `request-changes`
（AGY 2 major + 2 minor、GLM 1 major + 3 minor + 4 nit）。

### 0.1 本轮贯穿性的一条：注释宣称了实现没兑现的事

**三条独立的意见指向同一个形状**，这比任何单条都值得先写出来：

| 编号 | 注释宣称 | 实现实际 |
| :--- | :--- | :--- |
| AGY-01 | 「先判整段再取字段：『没探过』与『探过但没找到入口』是两回事」 | `!p` 恒不可达，两态**永远答同一句** |
| GLM-05 | 「M6 第 2/3 步接上之后，这条测试该自动去找下一个未实现的」 | filter 写死 `!== 'agy' && !== 'zcode'`，没有任何「自动」 |
| GLM-01 | 「假 CLI：checkCliVersions 会真的执行它们并比对版本号」 | 迁移后无 `version_probe` → 走第三态 → **假 CLI 从不被执行** |

三条都是我在**同一轮**里写下的。而上一轮计划审查的教训是「标注了不确定性，然后基于确定版本往下写」——
同一家族，这已经是连续第二轮、累计第六次。

形状比上一轮更明确：**我把「我想让它做到的事」写进了注释，然后没有回头验证实现是否做到。**
注释是断言，断言要有依据。三条里有两条（AGY-01、GLM-01）只要真跑一次对应路径就会暴露，
而我做了真机验证——却只验了 happy path（本机两侧都有真结论），没验注释所声称的那条分支。

处置写进本轮修复：**每修一条，都要跑出注释所宣称的那个分支**，而不是只确认整体没红。

### 0.2 最重的三条

**AGY-02（major）· 迁移让「未探过」看起来像「探过」。** 需要精确表述，
因为审查员描述的后果我核对后要修正一处：

- 审查员说「升级后 preflight 误把未探过的 CLI 判为已探但入口丢失而**硬阻断**」；
- 核实：改**前** `checkCliVersions` 无条件检查两家，`bin` 为 null 时同样报失败硬阻断。
  所以这不是**新引入**的阻断。
- 真正的缺陷是：我本轮新写的宽容路径 `if (!probe?.probed_at) continue`
  （未探过就跳过）**在迁移来的段上失效**——迁移给未探过的旧段无条件回填了 `generated_at`，
  于是它看起来「探过」。新逻辑的意图被我自己写的迁移破坏了。

严重度仍判 major：`checkProbeFreshness` 会把一个从未探到入口的段报成「新鲜」，
那是**事实层面的错**，不只是提示措辞问题。

**AGY-01（major）· `if (!p)` 恒不可达。** `defaultProbe()` 为全部 `ALL_CLI_NAMES`
预填空壳，`patchProbe` 又 `{...defaultProbe().cli, ...probe.cli}` 补齐，
于是 `cfg.probe.cli.agy` 恒非空。我写那两行时的心智模型是「Partial 化之后取不到就是 undefined」，
但**同一次改动里我自己加的预填**让这个前提不成立——两处改动互相拆台，而我没有回头对账。

**GLM-01（major）· 我造成了一处覆盖损失，且测试照样绿。**
`stub-agent-kit.test.ts` 的夹具写旧形状 `bin:` / `entry:`，迁移后没有 `version_probe`，
`readCliVersion` 返回 `undefined` 走第三态——那条测试原本是**全仓唯一**端到端执行
「取版本 + 比对」的地方，现在假 CLI 从不被执行。今后 `readCliVersion` 的分派写错、
`extract` 捕获组错、漂移误判成 ok，这条测试都不会红。

这与我在 M7b 第 6 步裁决里亲手写下的那句话是同一形状：
**「注释宣称了不存在的覆盖，比单纯漏做更糟——它会让下一个人以为守住了。」**
当时是我发现别处有这个问题，这次是我自己造的。

---

## 0.3 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-02 | gemini | 重要 | 接受 | 迁移无条件回填 `probed_at`，使未探过的旧段冒充已探；新写的跳过逻辑因此在迁移路径上失效 | `migrateProbeSection`：仅在旧段确有入口时回填；判据排除 null；不覆写已有 `cli[name]` |
| AGY-01 | gemini | 重要 | 接受 | `defaultProbe` 预填 + `patchProbe` 补齐使 `!p` 恒不可达，两态答复契约失效 | 两个适配器的判据改 `!p?.probed_at` |
| GLM-01 | glm | 重要 | 接受 | 全仓唯一端到端版本比对的集成测试被我的改动静默降级为第三态，且仍绿 | stub 夹具改新形状带 `version_probe`，另加一条显式第三态用例 |
| GLM-02 | glm | 次要 | 接受 | EV-05① 已整项收口、② 已收口一项，台账仍是 todo + 旧成本描述；两处 stub 注释过时 | BACKLOG 按 EV-03 先例更新；改 `overlay.ts` 与 `stub-probe.ts.txt` 注释 |
| GLM-03 | glm | 次要 | 接受 | `runner` 三层语义不一致，非 node 非 null 值被静默按「直接执行」处理 | `readCliVersion` 判无从查并点名；schema description 写明只识别两值 |
| GLM-08 | glm | 次要 | 接受 | 两段式只做了 ajv 形状那一段，注册表身份校验缺位；guard 与 preflight 遍历口径不一致 | `checkConfigAgents` 补 `probe.cli` 键集校验；`guard` 改按 `ALL_CLI_NAMES` |
| AGY-03 | gemini | 次要 | 接受 | `migrateProbeSection` 零单测，我只做了真机验证而真机只覆盖 happy path | `config-migrate.test.ts` 补一组迁移用例 |
| AGY-04 | gemini | 次要 | 接受 | `checkReadonlyCapability` 仍绑 zcode，单侧环境过不了预检——我的边界描述确实不准 | EV-05② 剩余项描述补「单侧环境跑不通预检」 |
| GLM-04 | glm | 吹毛求疵 | 接受 | `typeof null === 'object'` 让 YAML 空值段被当旧段迁移 | 并入 AGY-02 的修复 |
| GLM-05 | glm | 吹毛求疵 | 接受 | 注释宣称「自动去找下一个」，实现写死 filter，靠的是注册表排序与接入顺序的巧合 | 提为具名常量 + 注释如实写 + 全接入后自动提醒删除 |
| GLM-06 | glm | 吹毛求疵 | 接受 | 插入 `VersionProbe` 时把 `CommonProbe` 的 JSDoc 挤成悬空注释 | JSDoc 移回 `CommonProbe` 正上方 |
| GLM-07 | glm | 吹毛求疵 | 接受 | `new RegExp(vp.extract)` 无 try/catch，盘上被改坏会抛 JS 原始栈而非指引性错误 | 包 try/catch，归并为「无从查」并点名 |

---

## 1. 逐条裁决

### AGY-02 · 重要 —— 接受

**裁决**：接受，含 GLM-04 指出的 `null` 判据问题（同一处修复）。

**一处对审查员描述的修正**（见 §0.2）：这不是**新引入**的硬阻断——改前 `checkCliVersions`
无条件检查两家，`bin` 为 null 时同样失败。缺陷是我新写的宽容路径在迁移段上失效。
写清楚这一点不是为了减轻，而是因为**修法取决于它**：若真是新引入的阻断，
修法可能是改 `checkCliVersions`；既然是迁移伪造了事实，修法就必须在迁移侧。

**落点**（`config.ts` 的 `migrateProbeSection`）：

1. `legacyKeys` 判据加 `p[n] !== null`——`typeof null === 'object'` 让 YAML 空值段
   （`probe.agy:` 后面什么都没有）被当成旧段迁移成一个完整空壳（GLM-04）。
2. **仅在旧段确有探测结果时回填 `probed_at`**：取到的 `entrypoint`（即旧 `bin` / `entry`）
   非空才回填，否则保持 `null`。理由：`probed_at` 的语义是「这一键**探到过**东西」，
   一个 `bin: null` 的段从来没探到过任何东西，给它盖时间戳就是伪造事实。
3. 已存在 `cli[name]` 时**不整体覆写**，改为新形状字段优先、旧值只补缺失键。

**验证方式**（按 §0.1 的处置）：单测要真的构造「旧盘只探过一侧」的输入，
断言未探那侧迁移后 `probed_at` 仍为 null、且 `checkProbeFreshness` 不把它报成新鲜。

### AGY-01 · 重要 —— 接受

**裁决**：接受。

`defaultProbe()` 为全部 `ALL_CLI_NAMES` 预填空壳（`config.ts`），`patchProbe` 又
`probe.cli = { ...defaultProbe().cli, ...probe.cli }` 补齐（`config.ts:644`），
`loadCtx` 走 `deepMerge` 同样带上默认键——三条路径都保证 `cfg.probe.cli.agy` 存在。
于是 `adapters/agy.ts:177` 的 `if (!p)` 恒不可达，`adapters/zcode.ts:164` 同理；
`run()` 里的三元 `probe ? 'X 入口未探测到' : 'X 尚未探测'` 也恒取前者。

**两处改动互相拆台**：预填是为了让「读侧总有个落点」，两态判据是为了区分「没探过」——
我在同一次改动里加了前者，却没回头检查它让后者失效。

**落点**：两个适配器的 `availability()` 与 `run()` 判据一律改为以 `probed_at` 为准：

```ts
if (!p?.probed_at) return { ok: false, reason: '<cli> 尚未探测，请先运行 trivium doctor --only <cli>' };
if (!p.entrypoint) return { ok: false, reason: '探针未找到 <cli> 可执行文件，请先运行 trivium doctor' };
```

口径与 `doctor.ts` 的「未实现 CLI 答复」和 `preflight.ts:183` 的 `if (!probe?.probed_at) continue`
对齐——三处用同一条判据，不再各写各的。

**验证**：补一条用例，构造「`probed_at` 为 null 但 `entrypoint` 也为 null」的配置，
断言 reason 是「尚未探测」而不是「未找到可执行文件」。这条正是注释宣称却没兑现的分支。

### GLM-01 · 重要 —— 接受

**裁决**：接受，取其建议的**两条一起做**（改夹具 + 另加第三态用例）。

只改夹具会丢掉「旧盘迁移后走第三态」这条真实路径的覆盖；只加第三态用例则版本比对仍然没人执行。
两条各守一边：

**落点**：

1. `stub-agent-kit.test.ts` 的夹具改写新形状（`cli:` 段 + 两家各带 `version_probe`：
   agy 为 `{runner: null, args: ['--version'], extract: null}`，
   zcode 为 `{runner: 'node', args: ['version'], extract: '(\\d+\\.\\d+\\.\\d+)'}`），
   使假 CLI 重新被真实执行、版本比对重新被覆盖；
2. 同步修订第 327-331 行的注释——它现在宣称的事情不再发生；
3. **另加一条用例**显式覆盖旧盘路径：写旧形状夹具，断言预检输出里出现
   「版本未校验」且点名了是哪几侧。这条把「第三态」从一个**意外的退化**
   变成一个**被断言的行为**。

**这条要单独记一句**：它是我这次改动造成的**覆盖损失**，而症状是「测试全绿」。
我在 M7b 第 6 步的裁决里亲手写过「注释宣称了不存在的覆盖，比单纯漏做更糟」——
当时那是别处的问题，这次是我自己造的。写进记忆的教训没能在下一轮拦住同形错误，
说明记住形状不够，**要有动作**：改动一条被多处消费的数据形状时，
先列出「谁在消费它、消费不到会怎样」，而不是只让类型检查过。

### GLM-02 · 次要 —— 接受

**裁决**：接受。台账不更新，本身就是我反复批评的那种「描述过期的欠账」（EV-04 形态）。

**落点**：

1. `BACKLOG.md` 的 EV-05 按 **EV-03 的先例**（done + 收口日期 + 剩余部分）改写：
   - **①（`ProbeSection` 固定两键）标已收口**：键集从 `ALL_CLI_NAMES` 派生，
     新家默认落 `CommonProbe`，**不必再改 `types.ts`**；
   - **② 标部分收口**：`checkCliVersions` 已随本步泛化（连同它的理由：
     取版本方式已随探针结论落盘，不依赖 M8 适配器）；
     **剩余 `checkReadonlyCapability` 与探活编排两项**，各自写明为什么要等真实第三家。
2. `test/fixtures/stub-agent-kit/pieces/stub-probe.ts.txt` 的「探针结论无处落盘，
   除非改 `types.ts`」——该缺口已消失，改写为「M6 第 1 步已收口，本桩改落 `probe.cli.<cliName>`」。
3. `test/fixtures/stub-agent-kit/overlay.ts` 的「探活与 CLI 版本校验……仍是按厂商写死的编排」——
   版本校验已泛化，桩侧不被检查的原因**变了**（从「写死两家」变成「没探过就跳过」），
   按新原因改写。原因变了而文字没变，正是「改语义漏改文案」。

### GLM-03 · 次要 —— 接受

**裁决**：接受**最低成本方案**（显式契约），彻底方案（运行时映射登记化）不在本步做。

这条正面回答了我焦点问二的后半段「`runner` 只有两态会不会第三家一来就不够用」——
**会，而且失败方式是最坏的那种：静默回落。** schema 放行任意字符串、TS 只认两值、
读侧把一切非 `'node'` 当作「直接执行 entrypoint」。盘上被写入 `'python'` 时，
它会去直接执行一个 `.py` 文件并报一个看不懂的错。

**落点**：

1. `readCliVersion` 对「非 `node` 非 `null`」的 runner 返回 `undefined`（并入「无从查」第三态），
   并让点名文案说清是「不认识的运行时 `<值>`」而不是笼统的「未记录取版本方式」；
2. `config.v2.json` 的 `runner` description 写明：**当前只识别 `'node'` 与 `null`，
   其它值视为未支持**——把「将来可扩展」变成显式契约，而不是留一个静默分支。

**不做彻底方案的理由**：把 `Config.runtime` 从单个 `node` 扩成运行时映射，
是为一个**尚不存在的需求**设计接口。M6 第 2/3 步要接的 codex 与 claude 都是直接可执行的二进制
（本机实测：`/opt/homebrew/bin/codex`、`~/.local/bin/claude`），`runner` 均为 `null`。
真需要第三种运行时时再做，届时有真实形状可依——这与 EV-05② 留给 M8 是同一条理由。
**但这次要把边界写成契约**，而不是像 `runner` 现在这样留个静默口子。

### GLM-08 · 次要 —— 接受

**裁决**：接受两处。

**第一处（身份校验缺位）确实是我漏了半段。** 纪律 12 写的是两段式：
ajv 校形状 → 注册表校身份。我给 `probe.cli` 加了 `commonProbe` 的形状校验（AGY-06 的落点），
**只做了第一段**。`agents` 段有 `checkConfigAgents`、`run` 的键有 `checkAgentIdentities`，
唯独 `probe.cli` 的键没人校——形状完整的未注册键（比如从 zcode 段复制改名）会被放行且静默不生效。

**第二处（遍历口径不一致）**核实为真：`guard.ts:133` 按盘上实有键
（`Object.values(cfg.probe.cli)`），`preflight.ts:183` 按注册表全集（`ALL_CLI_NAMES`）。
未注册键在 preflight 被忽略、在 guard 却会被消费其 `scratch_paths`——
**一个未登记的键能影响只读失守判定**，这比不一致本身更值得修。

**落点**：

1. `schemas.ts` 的 `checkConfigAgents` 旁补一条：`probe.cli` 的键 ⊆ `ALL_CLI_NAMES`，
   未注册键报「探针段出现未登记的 CLI 名」；
2. `guard.ts` 改按 `ALL_CLI_NAMES` 取键，与 preflight 同口径。
   两条都做而不是二选一：前者是把关，后者是即使把关被绕过（比如直接改盘）也不放大影响。

### AGY-03 · 次要 —— 接受

**裁决**：接受。

我对迁移只做了**真机验证**——而真机恰恰只覆盖 happy path（本机 agy / zcode 两段都有真结论）。
AGY-02 与 GLM-04 指出的两个缺陷，真机一个都撞不上。这说明「跑一遍真的」不能替代单测：
真实环境只有一种形态，而缺陷藏在其它形态里。

**落点**：`test/unit/config-migrate.test.ts` 补一组 `migrateProbeSection` 用例，
至少覆盖——①旧平铺 → 新形状且 `bin`/`entry` → `entrypoint`；
②**只探过一侧**时未探那侧 `probed_at` 保持 null（AGY-02 的回归）；
③`probe.agy:` 为 YAML 空值时不被当旧段（GLM-04 的回归）；
④对新形状幂等；⑤已有 `cli[name]` 时不被旧数据覆写；
⑥迁移产物不含 `version_probe`（保守选择的回归，防止日后有人「顺手补上」）。

### AGY-04 · 次要 —— 接受

**裁决**：接受。这条直接回答了我焦点问四「剩下两项的边界描述准不准」——**不准**。

我在计划里把 EV-05② 的剩余项描述成「第三家的只读能力与凭据不被检查」，
那是从**第三家**视角写的。审查员指出的是**现有两家**视角下的后果：
若本机只探过 agy，`checkProbeFreshness` 与 `checkCliVersions` 都放行了（本步的放开），
却必然卡在 `checkReadonlyCapability` 的 `cfg.probe.cli.zcode?.readonly_flags.length === 0`。
**「单侧新鲜度放开」这件事在纯单侧环境下并不成立**，而我的描述读起来像是成立的。

**落点**：EV-05② 的剩余项描述补一句——
「后果不止于第三家：`checkReadonlyCapability` 硬绑 zcode，
因此**只探过一侧的环境仍然过不了预检**，本步放开的单侧新鲜度只对『两家都探过、某侧过期』生效。」

**不在本步改实现**的理由与 GLM-03 同构：把只读检查按入选审核者收窄，
需要先有「按入选集合决定检查哪几侧」的通用机制，那是 preflight 的结构性重构。
但**边界必须写准**——这正是本条的价值。

### GLM-04 · 吹毛求疵 —— 接受

**裁决**：接受，并入 AGY-02 的修复（同一处判据）。

`typeof null === 'object'` 是 JS 的经典坑。审查员判 nit 的理由（旧行为经 deepMerge
归并为空壳也不崩）成立，但它与 AGY-02 的回填问题**叠加**后有实际后果：
空值段被迁移成完整段 + 盖上新鲜时间戳 → 新鲜度说「新鲜」而版本检查说「入口不可用」，
两行输出互相打架。修 AGY-02 时一并修掉。

### GLM-05 · 吹毛求疵 —— 接受

**裁决**：接受，取其**第一条建议**（改注释如实说明 + 全接入后提醒删除）。

我写的注释是「M6 第 2/3 步接上之后，这条测试该自动去找下一个未实现的，而不是失效」，
而实现是 `filter((n) => n !== 'agy' && n !== 'zcode')`——**没有任何「自动」**。
审查员说得准确：「靠的是注册表排序与接入顺序的巧合，不是机制。」
更糟的是若第 2 步先接 claude（与我注释里的假设相反），`runDoctor(only:'claude')`
会真去探一侧已实现的，断言当场红。

**不取第二条建议（从可派生信号取「已实现集」）的理由**：可派生的信号只有
「doctor 跑完有没有产生『尚无探针实现』的 note」——而那正是本用例要测的东西，
用它来挑选测试对象就成了循环论证。

**落点**：把 filter 提为具名常量并写实话：

```ts
/**
 * 已接线探针实现的 CLI。**接入下一家时必须同步这里**——
 * 它没有可派生的来源：唯一的信号是 doctor 会不会报「尚无探针实现」，
 * 而那正是本用例要断言的东西，拿它挑选被测对象就成了循环论证。
 * 全部接入后 `unimplemented` 为空集，下面的断言会红，提醒删除本用例。
 */
const PROBE_IMPLEMENTED = ['agy', 'zcode'];
```

原有的 `assert.ok(unimplemented.length > 0)` 保留——它就是那个「全接入后提醒删除」的机器守卫，
现在注释把它的作用说明白了。

### GLM-06 · 吹毛求疵 —— 接受

**裁决**：接受。

插入 `VersionProbe` 时把 `CommonProbe` 的 JSDoc 挤成了悬空注释块：
IDE 悬停 `CommonProbe` 看不到说明，而读 `VersionProbe` 的人会先撞上一段讲别家的文档。
那段 JSDoc 恰恰是解释「抽取判据」与「为什么改名 entrypoint」的核心文档——
放错位置等于没写。

**落点**：把「各家探针结论的共有事实」整段 JSDoc 移回 `interface CommonProbe` 正上方，
`VersionProbe` 保留自己的注释块。

### GLM-07 · 吹毛求疵 —— 接受

**裁决**：接受。

`new RegExp(vp.extract)` 无保护：盘上 `version_probe.extract` 被手工改坏时抛 `SyntaxError`，
穿到 `cli.ts` 的全局 catch，用户看到的是 JS 正则错误加原始栈，
而不是「探针结论被改坏，请重跑 doctor」。ajv 只校 `string | null`，拦不住非法正则。

这与 `critics.ts` 那条「无法取到调用参数」的报错是同族问题：
**错误信息把人引向错误的方向**——看到正则语法错误，人会去查自己的输入，
而实际该做的是重跑 doctor。

**落点**：`readCliVersion` 的 `RegExp` 构造包 try/catch，异常并入「无从查」第三态，
点名文案写明是「`extract` 不是合法正则」并给出「重跑 doctor 可修复」的出路。

---

## 2. 修复清单（按落点归并）

| 文件 | 改动 | 来源 |
| :--- | :--- | :--- |
| `config.ts` | 迁移判据排除 null；仅在旧段确有入口时回填 `probed_at`；不覆写已有 `cli[name]` | AGY-02 / GLM-04 |
| `adapters/agy.ts`、`adapters/zcode.ts` | 两态判据改以 `probed_at` 为准 | AGY-01 |
| `preflight.ts` | 非 node 非 null 的 runner 判无从查并点名；`RegExp` 包 try/catch | GLM-03 / GLM-07 |
| `guard.ts` | 改按 `ALL_CLI_NAMES` 取键 | GLM-08 |
| `schemas.ts` | 补 `probe.cli` 键集 ⊆ `ALL_CLI_NAMES` 的身份校验 | GLM-08 |
| `types.ts` | `CommonProbe` 的 JSDoc 移回正上方 | GLM-06 |
| `config.v2.json` | `runner` description 写明只识别两值 | GLM-03 |
| `stub-agent-kit.test.ts` | 夹具改新形状带 `version_probe`；注释同步；另加第三态用例 | GLM-01 |
| `config-migrate.test.ts` | 补 6 条 `migrateProbeSection` 用例 | AGY-03 |
| `preflight.test.ts` | 补「未探过 vs 探过没找到」用例；`PROBE_IMPLEMENTED` 具名化 | AGY-01 / GLM-05 |
| `BACKLOG.md` | EV-05 按 EV-03 先例更新；② 剩余项补单侧环境边界 | GLM-02 / AGY-04 |
| `overlay.ts`、`stub-probe.ts.txt` | 两处过期注释改写 | GLM-02 |

**变异验证**：AGY-01、AGY-02、GLM-01、GLM-08 四条修复逐条做——
把实现改回本轮被指出的坏版本，确认对应用例当场红。
AGY-01 与 GLM-01 是本轮教训的重点（注释宣称 ≠ 实现兑现），
它们的变异必须**跑出注释所声称的那条分支**，而不只是确认整体没红。

---

## 3. 两侧共同确认、本次不动的部分

- **`probe.cli` 按 cliName 索引的格式变更值得**（焦点问一）：两侧独立给出同一结论。
  GLM 侧的论证更完整——消费点改动量主要由 `entrypoint` 统一命名与键可选化驱动，
  那是消除「按家分叉知识」的必要成本，嵌套 `cli` 段本身的增量成本几乎只有迁移一处。
- **`VersionProbe` 不是 `probeKey` 式过度登记**（焦点问二前半）：它承载的是原先写死在
  `checkCliVersions` 两个分支里的**新事实**，是 P7 的正统应用。（后半段的隐患见 GLM-03。）
- **迁移不造 `version_probe` 的保守选择正确**（焦点问三后半）：两侧都确认，
  且 GLM 指出 schema 的 `commonProbe.required` 刻意不含它、与迁移产物自洽。
- **TTL 按键判定、`checkpoint(null)`、`--only` 第三种答复**三处修复的测试
  「是真会失败的」（GLM 语）——含起草时漏判据直测、被变异验证打脸后补上的那条。
- **EV-05② 拆走 `checkCliVersions` 的理由成立**（焦点问四前半）：泛化确实不依赖 M8 适配器。
  台账与边界描述的问题见 GLM-02 / AGY-04。
