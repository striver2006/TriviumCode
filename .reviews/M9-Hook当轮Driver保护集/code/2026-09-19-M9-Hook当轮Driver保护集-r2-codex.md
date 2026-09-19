---
schema: trivium.review.v1
topic: M9-Hook当轮Driver保护集
stage: code
role: codex
vendor: openai
agent_cli: codex/0.155.0
model_requested: deepseek-flash
model_effective: deepseek-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260919T085742Z
rerun_index: 2
snapshot_hash: sha256:65ad39c237a326ff84448824dfeeffc5f76664bdc3c9c65036a9fbd870f59c41
blind: true
started_at: 2026-09-19T08:57:42.868Z
finished_at: 2026-09-19T09:09:46.465Z
duration_s: 340
tool_calls:
  run_command: 54
  project_reads: 36
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 0
degraded: false
parse_fallback: true
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0b8e2-bfef-7511-8d1a-3c3c283ea969
---

# 代码审查：M9-Hook当轮Driver保护集

> Critic-C · OpenAI Codex ｜ 模型 `deepseek-flash`
> ｜ 运行 `20260919T085742Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **解析降级**：本侧输出未能解析为结构化结论，下方为原文。该侧不参与阻断判定。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 原始输出（未能结构化解析）

```
```json
{
  "schema": "trivium.review.v1",
  "verdict": "request-changes",
  "summary": "三个焦点的结论：①「较新留痕读不出即判红」在正常流程里我没找到误拦——当轮 Driver 只取自 run.json.driver，v1 留痕走迁移、v2 留痕过 schema+注册表身份两段校验，本仓归档里每阶段最新一份都通过；该分支只因「该阶段某份 run-*.json 读不出」进入，而受保护与否本身依赖 driver，硬失败是唯一 fail-closed 选择。但它带出的处置指引是错的：让用户去修复/清理 _meta/ 下的运行清单，而 cli.ts 早已把这条路裁定为不可行、真正出口是重跑该阶段，Driver 侧还被本 Hook 自己拦死（CODEX-01）。②与 gate 的分叉站得住，我核到了实处：cli.ts 只在「扫到>0 且一份都读不出」时硬失败，较新损坏＋较旧可读确实静默采信较旧；而该损坏本身会被提交锚报成 manifest_unreadable，这就是「gate 有跑后兜底」的实指。③软链那条结论方向对（realpath 优先），但「两种顺序行为等价」只在主题/阶段目录那一级是软链时成立，终端组件软链是反例；且所引用例的夹具名 mirror 不是合法 Stage，压根没跑到注释声称的机制（CODEX-02）。另一条 nit：源头函数 criticRoleSuffixes 仍留着默认参数。",
  "findings": [
    {
      "id": "CODEX-01",
      "severity": "major",
      "layer": "code",
      "kind": "correctness",
      "location": "src/trivium/hooks.ts:536-545（corrupt 分支的拦截文案，出路那句在 543 行）；对照 src/trivium/cli.ts:823-850",
      "problem": "留痕损坏时的硬失败取向正确（受保护与否依赖 driver，判不出就只能拦），但文案给出的**唯一出路**在「已登记的 run 清单被改坏」这一格上既做不到、又会把人引向本仓明确记载过的陷阱：(a) 模型侧结构上做不到——Write/Edit 走 `isOrchestratorOwned` 对 `_meta/**` 一律 deny，Bash 走 `MENTIONS_OWNED` 命中 `_meta` 字面也一律 deny，也就是本 Hook 自己在拦；(b) 即便由人绕过，`run-*.json` 一经 `registerRun` 即不可删/不可改，`checkRunManifests` 会分别报 `manifest_missing` / `manifest_unreadable`，cli.ts 的原文结论是「照做会把提交永久拦下」，并写明真正可用的出口是「重跑该阶段」（review --start 会先落一份 status: running 骨架，最新可读项立即被采信）。同一个状态在 gate 侧有正确文案（列出「文件缺失 / 内容损坏 / schema 不识」三种成因 + 只给走得通的出口），Hook 侧却自拼一套——正是本仓最忌的「两条规范并行」。文案的错判还带一层：`readRunMeta` 对「schema 不识」与「文件损坏」同样返回 null，两者处置相反（前者要升级/重装工具使 Hook 与留痕版本一致，后者要恢复文件），只写「读不出来」会把排障带偏；而 AGENTS.md 把「装好的 Hook 落后于工作树」列为已知坑，这一格并非空想。另注：对**未登记**的散落 run-*.json（如测试夹具那份 run-RBAD.json），「清理」确实是正确处置，所以缺陷只在已登记那一格。",
      "evidence": "读 src/trivium/hooks.ts:517-556（corrupt 分支文案 + `isOrchestratorOwned`/`MENTIONS_OWNED` 两条 deny 路径）、src/trivium/cli.ts:823-850（「修复或移除」不可行的论证与「重跑该阶段」这个出口）、src/trivium/archive.ts:606-640（checkRunManifests 以 task.json.runs[] 为外部锚，缺失/不可读分别报 manifest_missing / manifest_unreadable）、src/trivium/meta.ts:334-342 与 271-305（readRunMeta 对不识 schema 返回 null；run 骨架为 status: running 且写前校验）、test/unit/hooks.test.ts:728-755（新用例只断言 /读不出来/ 与 /R2/，没有任何判据约束文案的出路是否可走）。",
      "suggestion": "把这段文案与 cmdGate 对齐：列出三种成因，点明唯一可走通的出口是「重跑该阶段」（并说明会先落骨架、最新可读项即被采信），明说删除/改写已登记 run 清单会撞提交锚——照 cli.ts 那段已写好的口径抄语义，不要另起一套。若认定文案不属于本步范围，至少登记一条 BACKLOG（与 EV-73 同源），别让它以第二套口径留在拦截路径上。",
      "confidence": "high"
    },
    {
      "id": "CODEX-02",
      "severity": "minor",
      "layer": "code",
      "kind": "test-gap",
      "location": "src/trivium/hooks.ts:384-395（`locateArchiveTarget` 的「没有可观测的行为差异」一节）；test/unit/hooks.test.ts:815-841（「阶段目录是软链」用例）",
      "problem": "结论方向（realpath 优先、且与 `isInsideArchiveResolved` 的并集口径有意不同源）我核过是对的，但两处支撑都过宽。①等价性只在**主题/阶段目录那一级**是软链时成立：此时词法侧拼出的 `<主题>/<阶段>/_meta` 会沿同一条软链落到 realpath 侧，读的是同一份留痕。**终端组件（文件级）软链**是反例：`<归档>/t/plan/x-claude.md -> <归档>/t/code/y-claude.md` 时，realpath 优先读 `t/code/_meta`、词法优先读 `t/plan/_meta`，两个阶段都合法但拿到的是**不同**留痕（可能是不同 Driver；今天也已可观测——一边留痕损坏、另一边一条都没有时，一个判红一个放行）。注释里「没有可观测的行为差异…别把它当成修了个洞」加上「调换顺序用例全绿」的表述，会让后来者以为回退到词法优先是惰性改动。而本仓自己的用例就把文件级软链当威胁模型（悬空软链用例、doc/ 下软链用例），所以这不是臆造的场景。②所引用例没有跑到注释声称的机制：夹具建的是 `t/mirror -> t/code`，而 `mirror` 不是合法 Stage 名，`stageSegmentsUnder` 直接返回 null，于是词法分支本来就落空、必然回退到 realpath 分支——「调换顺序仍绿」在这里是靠「词法分支压根不命中」成立的，不是靠「readdir 沿软链」。真正能撑住注释那句实测的是 `t/plan -> t/code` 这种阶段名合法的软链（注释里举的也正是它），却没有落成用例；现用例真正锁住的是「realpath 分支不可省」（把该分支整体去掉会红，这点它做对了）。",
      "evidence": "读 src/trivium/hooks.ts:376-425（分支顺序；`resolveExisting` 先 lstat+readlink 处理终端软链；`stageSegmentsUnder` 的 `STAGES.includes` 守卫）、src/trivium/types.ts:97（STAGES = ['plan','code','bug']）、src/trivium/archive.ts:39-43（metaDir = <root>/<topic>/<stage>/_meta，故阶段目录那级的软链会让词法侧 readdir 落到同一目录；文件级软链不会）、test/unit/hooks.test.ts:585-608 与 685-701（既有用例确实把文件级软链当威胁模型）、test/unit/hooks.test.ts:815-841。",
      "suggestion": "把等价性结论限定到「主题/阶段目录那一级是软链」，并直接在注释里给出终端软链这个反例（免得后人把它当惰性改动回退）；用例侧把夹具换成阶段名合法的软链（`t/plan -> t/code`）以真正跑到注释声称的机制，可选再补一条「文件级软链指向另一阶段」的用例，把两种顺序的分歧钉成显式行为而不是沉默的巧合。",
      "confidence": "high"
    },
    {
      "id": "CODEX-03",
      "severity": "nit",
      "layer": "code",
      "kind": "maintainability",
      "location": "src/trivium/hooks.ts:133（`criticRoleSuffixes(driver: AgentId = DEFAULT_DRIVER)`）",
      "problem": "本步的核心手法是「同一条判据拆成两个具名函数，当轮面 driver 必填、漏传是编译期错误」，但**源头函数**仍留着默认参数，且它的文档块开头描述的仍是**当轮**保护集语义（「哪些角色后缀属于只能由编排器落盘的审查件」）。于是新增调用点只要漏传 driver，就会静默退回「缺省 Driver 的补集」——正是 EV-68/EV-69 要消灭的形态（「可选参数的默认值让漏传静默成功」）。今天三处跨时间消费点都要这个缺省值，所以不是缺陷，而是同一个坑的下一次入场券；本步已经为顶层判据付过一次改造代价，源头这一层留在原地会不对称。",
      "evidence": "读 src/trivium/hooks.ts:116-131（文档块以当轮口径叙述，却服务于带默认值的函数）、133（默认参数）、175-178 与 188-190（具名函数中只有当轮面必填）、761-763 与 869（`roleSuffixAnywhere()` 与 Bash 文案均无参调用，依赖该默认值）、src/trivium/state.ts:72-81（同族教训的写法）；test/unit/hooks.test.ts:98 与 162-168（既有断言亦依赖默认值）。",
      "suggestion": "二选一：①去掉默认值，跨时间面三处调用点显式写 `criticRoleSuffixes(DEFAULT_DRIVER)`（改动面是 3 处生产调用 + 2 处测试）；②保留默认值，但把函数名与文档块首行改成显式的跨时间口径（如 `criticRoleSuffixesExcept(driver)`，并写明「跨时间面专用，当轮面一律走 `hasProtectedRoleSuffix`」）。①与本步「漏传是编译期错误」的口径一致，更推荐。",
      "confidence": "medium"
    }
  ],
  "agreed": [
    "当轮 Driver 取 run.json.driver 而非 state.json 闸门项：我独立核过——src/trivium/review.ts:938 / 996 / 1512 / 1601 四处 setGateChecked 全不传 driver，src/trivium/state.ts:242-243 的 upsert 又沿用 prev.driver，采信闸门项会在换 Driver 的重跑上反向；cmdGate 同源取 latestRunMeta 的 driver。",
    "与 gate 有意分叉站得住，理由我核到了实处：src/trivium/cli.ts:823 只在「scanned>0 且一份都读不出」时硬失败，故「较新损坏＋较旧可读」在 gate 侧确实静默采信较旧；而该损坏本身会被提交锚 src/trivium/archive.ts:606-640 报成 manifest_unreadable，这就是「gate 有跑后兜底」的实指。Hook 是拦截型、判错当场生效且不能回写，取更严的取向是对的；把它单独登记 EV-73 而不是顺手拉齐，也是正确处置。",
    "跨时间面行为一字未改：hasRoleSuffixCrossTime 与 roleSuffixAnywhere() 的取值口径与拆分前逐字相同，提交锚仍走 basename（那段「不能换成组合判定，否则静默失效」的注释仍然必要且准确）。",
    "短路顺序（先纯词法的 looksLikeRoleArtifact + isInsideArchiveResolved，再读留痕）保住了「非角色后缀 / 归档外写入不新增 I/O」这条性质；补一层我这一侧查过的环境/并发面：writeAtomic 的临时名是 `<target>.tmp-<pid>-<ts>`（src/trivium/util/fsx.ts:28），不匹配 `^run-(.+)\.json$`，且 rename 原子，故 `_meta/` 下不会出现「写一半的假留痕」被算成损坏，并发重跑不会误判。",
    "软链一格的**结论**（取 realpath 优先）正确，且「与 isInsideArchiveResolved 有意不同源」这条说明必要、准确——我不认为这里存在安全缺口；分歧只在注释对等价范围的表述（见 CODEX-02）。",
    "locateArchiveTarget 的守卫是必要的：落空即回落缺省 Driver 而不是放行，且 verify/ 与两段式路径确实会落空——这与设计 §8.4 的「四种结局」对得上。",
    "新增用例里主动标注「本用例证伪不了什么」（hooks.test.ts:73-96、815-826）是难得的好习惯，请保留：它让下一个人知道哪一格还没有机器判据看着。"
  ],
  "not_covered": [
    "沙箱只读，未执行 npm run check / 任何测试或变异验证：全部结论来自源码与构建产物阅读。软链顺序一格是源码追踪 + 产物比对，未实跑（我按未实跑的口径写的表述）。",
    "未覆盖多 Driver（M10）面：EV-71（非缺省 Driver 以何会话载体跑、Hook 是否真的被触发）与 EV-72（plan/bug 原稿在 review --start 之前写不出）这一侧无法验证其是否仍是阻碍。",
    "未逐份核 .reviews 下全部 92 份 run 清单的 schema 兼容性；只做了一次只读扫描，比对每阶段最新一份的 driver/vendor 与注册表（全部一致，v1 由 migrateRunMetaV1 承接），因此「正常流程不误拦」这个结论是在**本仓现状**上得出的，不含「未来 run.v3 与旧 Hook 并存」的实证。",
    "未审 skills/ 下各 SKILL.md / 模板与本次文案的一致性（仅确认 skills/dual-critic/hooks/hooks.json 未被本补丁改动、matcher 与四条命令原样）；EV-66 的资产面由 disposition-role-assets.test.ts 看着，未复核其覆盖。",
    "未审 Bash 侧 bashTargetsProtected 的其它通道（目录级搬运、用 glob/变量绕开 `_meta` 字面量的写法），只作背景阅读，未做取证。",
    "未核 dist/ 与工作树的全量一致性：只确认已构建的 skills/dual-critic/scripts/trivium.cjs 含本步的 resolveRoundDriver，且动态 import 在 CJS 产物里被内联为惰性 init（不会退化成运行时 require 缺失文件）。",
    "未核提交锚与 gate 的端到端行为（未跑 CLI），checkRunManifests / immutableChangeReason 的结论均来自源码阅读。"
  ],
  "consulted": [
    "src/trivium/hooks.ts",
    "src/trivium/meta.ts",
    "src/trivium/cli.ts",
    "src/trivium/state.ts",
    "src/trivium/archive.ts",
    "src/trivium/naming.ts",
    "src/trivium/types.ts",
    "src/trivium/schemas.ts",
    "src/trivium/review.ts",
    "src/trivium/agents/registry.ts",
    "src/trivium/util/fsx.ts",
    "test/unit/hooks.test.ts",
    "test/integration/gate-loop.test.ts",
    "skills/dual-critic/hooks/hooks.json",
    "skills/dual-critic/scripts/trivium.cjs",
    "doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md",
    "doc/08_project/BACKLOG.md",
    "doc/03_api/PROTOCOL_dual_critic_relay.md",
    ".reviews/M9-Hook当轮Driver保护集/code/_meta/changes-20260919T085742Z.diff",
    ".reviews/M9-Hook当轮Driver保护集/code/_meta/run-20260919T085742Z.json"
  ]
}
```
```
