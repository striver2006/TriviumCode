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
run_id: 20260919T064055Z
rerun_index: 1
snapshot_hash: sha256:b26582a8ba71fb53d7c55212e1d50b878e9676ca2597995e5409eb8d9991de4f
blind: true
started_at: 2026-09-19T06:40:56.412Z
finished_at: 2026-09-19T07:12:28.113Z
duration_s: 330
tool_calls:
  run_command: 58
  project_reads: 44
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 3
degraded: false
parse_fallback: false
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0b865-8731-7540-96a5-6edfa5911661
---

# 代码审查：M9-Hook当轮Driver保护集

> Critic-C · OpenAI Codex ｜ 模型 `deepseek-flash`
> ｜ 运行 `20260919T064055Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

补丁本身站得住：签名拆分、短路顺序、留痕损坏硬失败我都逐行核过，`tsc --noEmit` 干净（exit 0），三处关键事实——review.ts 四处 setGateChecked 均不传 driver、cli.ts 只在 awaiting_approval 写它、writeAtomic 临时名不会污染 scanned——我独立复核成立，故无 blocker/major。最该处理的一条是留痕**部分**损坏那一格：最新那份读不出、更旧一份可读时，Hook 会静默沿用**上一轮**的 driver 判当轮身份，EV-68 的两个错向会一并重现（CODEX-01）。其次是一条设计面欠账：当轮 Driver 的来源已在 §8.4 定为 `run.json.driver`，但 §8.5「待实施 · M10」、§24 台账行与演进设计 §9.3 仍写着 `--agent` 那套机制，M10 照施工会造出第二个事实源或一个死旗标（CODEX-02）。其余三条是注释与用例层面的 nit（CODEX-03～05）。

**结论**：`approve-with-nits`

## 审查意见（共 5 条：次要 2 ｜ 吹毛求疵 3）

### CODEX-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts 的 resolveRoundDriver（约 366-372）配合 src/trivium/meta.ts:396-416 的 latestRunMeta` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：硬失败只覆盖「该阶段一份留痕都读不出来」。`latestRunMeta` 是从新到旧逐个下试、**取第一份可读者**，所以「最新那份坏了、上一份还能读」会正常返回 `{kind:'ok'}`，Hook 于是拿**上一轮**的 driver 判当轮身份：非缺省 Driver 写自己的 `-<id>.md` 被判伪造（交不了卷），而真正属于审核者的那一侧后缀反而不受保护。这两条方向正是本步否掉 `state.json` 闸门项时的理由（「upsert 会沿用前一条的值，被当成权威值」），只是换成留痕版的同形后果。gate 能接受这种降级是因为它另有提交锚兜底（`checkRunManifests`），Hook 没有跑后兜底；且 `latestRunMeta` 的告警走 `warn()`→stderr，而 exit 0 的 stderr 不进模型上下文，Driver 完全看不见自己正被判成上一轮的人。

**依据**：读 src/trivium/meta.ts:396-416（`for (const id of ids) { const m = await readRunMeta(...); if (m) return { meta: m, ... } }` 取最新可读者）、meta.ts:372-380 的既有注释（自己承认「最新那条坏掉时闸门会据此把轮次与 run_id 一并变旧」）、hooks.ts 的 resolveRoundDriver（只有 `r.scanned > 0 && !r.meta` 才判 corrupt）、hookPreWrite 的 corrupt 拦截文案、src/trivium/util/log.ts 的 warn（写 stderr，非 stdout，不进会话上下文）。

**建议**：在 Hook 侧收紧「当轮」语义而不是动公共函数（gate 依赖逐个下试这层兜底）：例如按该阶段最新 run_id 精确读一次，最新那份读不出即判 corrupt；或退一步，在返回 ok 的同时把 `unreadable` 非空这一事实带出来，并把「本轮 Driver 取自上一轮留痕」写进拦截文案与放行侧的输出，让 Driver 看得见。

### CODEX-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:1453（本步新增的 §8.4 表述）、:1465（§8.5「待实施 · M10」）、:3305（§24 台账行）；doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md:172、183、514-515（§4 表第 7/18 行、§9.3）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：本步把「当轮 Driver 从哪里来」定成 `run.json.driver`（§8.4 新表述还专门写明闸门项不作为来源），并在 EV-68 关闭记录里判定 hooks.json 四条命令**不必**带 driver 参数。但设计集里还有另一套机制同时挂着同一件事：§8.5 的待实施说明写「M10：`trivium hooks --agent <id>` 按当轮 Driver 渲染」，§24 台账那行仍是「8.4 / 8.5 Hook `--agent` 与多目标 · M10 · ⏳ 未并入」，演进设计 §9.3 更直接写着「`isForgedRoleFile` / `bashTargetsProtected` 的字面集按 `--agent` 动态生成」——这半句在本步之后已失实（Write 侧从留痕取，CLI 里也没有 `--agent`）。冲突裁定规则救不了：冲突双方现在都在主设计内部（§8.4 vs §8.5/§24），不在「演进设计服从主设计」的射程内。M10 照 §8.5/§9.3 施工，就会给同一个安全判据造出第二个事实源（或落下一个永不生效的旗标），而这正是 §8.4 刚在闸门项上明令禁止的形态。另一处小差距：§8.4 新表述列了「三种结局」，实现还有第四种——路径解析不出 `<主题>/<阶段>`（`locateArchiveTarget` 返回 null，如归档根两段式路径、`verify/` 下的同形态文件）时按缺省 Driver 判且**一次留痕都不读**；这一格只写在 hooks.ts 注释里，设计没提。

**依据**：读设计 §8.4 新增段落（含三种结局）、§8.5 引言块 1465、§24 台账行 3305、演进设计 §4 表第 7 行（172）与第 18 行（183）、§9.3（514-515）、BACKLOG EV-68 关闭记录（「hooks.json 四条拦截命令与 init.ts 的 writeWrapper 都不必带 driver 参数」）、hooks.ts 的 locateArchiveTarget 与 hookPreWrite 的 `loc === null` 回落分支；`grep -rn -- "--agent" src skills doc/02_design` 仅命中各厂商适配器与设计文档，CLI 的 hook 子命令无此旗标。

**建议**：把「当轮 Driver 的唯一来源是 `run.json.driver`；`--agent` 若仍要落地只用于安装目标/会话身份声明，不得成为第二条判据源」写进 §8.4/§8.5 并同步演进设计 §9.3 与 §24 台账行的状态；同时把「解析不出阶段」补成 §8.4 的第四种结局。M10 开工前必须先有这条裁定，否则接手会话会照 §9.3 的字面施工。

### CODEX-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:146、151（`hasCriticRoleSuffix` / `ROLE_SUFFIX_ANYWHERE`）、:112；doc/08_project/BACKLOG.md:152 的落点列` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：本步重写了 `criticRoleSuffixes` 文档块的下半段，却把上半段留在拆分前的结构描述上：「`hasCriticRoleSuffix`（本函数）再分两个消费者」「`ROLE_SUFFIX_ANYWHERE` → `bashTargetsProtected`」——这两个符号在本步之后全仓不存在，而紧接着的「## 两种语义已在签名上分家」讲的是另一套结构，同一段注释里并存两个互斥的现状描述（还被写成「本函数」）。BACKLOG EV-55 的落点列同样仍列着这两个旧名（正文已改准）。另外 :112 那句「这层不等式由 hooks.test.ts 的专门用例锁住——它今天恒成立，改错了当场红」，正是该用例注释（hooks.test.ts:84-95）自己判定为「那两句自相矛盾、后半句是假的」的说法；本步改写了它的邻接内容却留它原样。按 grep 找符号的人会一无所获。

**依据**：读 hooks.ts:105-190 全文与 test/unit/hooks.test.ts:75-120；`grep -rn "hasCriticRoleSuffix\|ROLE_SUFFIX_ANYWHERE" src/ doc/ skills/ test/` 只回：hooks.ts:146/151（旧名，指向已不存在的符号）、BACKLOG.md:152 落点列，其余两处（主设计 v1.3.29 版本台账、EV-68 的「关闭前形态」叙述）属历史记载，可以留。

**建议**：146/151 改成 `hasProtectedRoleSuffix` / `hasRoleSuffixCrossTime()` 与 `roleSuffixAnywhere()`，或直接删掉上半段（下半段已完整覆盖）；:112 按用例的口径改写为「恒成立但证伪力有限」；EV-55 落点列同步改名。

### CODEX-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts 的 locateArchiveTarget（约 376-382）与 isInsideArchiveResolved（约 210-235）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | low |

**问题**：「在不在归档内」取词法 ∪ realpath 的并集，而「属于哪个主题/阶段」是**先词法、命中即止**。当归档内 `<主题>` 或 `<阶段>` 这一级本身是软链（指向另一主题/阶段）时，写入实际落在 realpath 那一侧，driver 却按词法那一侧解析——用错了阶段的留痕判当轮身份，两个方向都可能错（错拦真正的执笔方、或放过伪造件）。同一份判定内部，两个子判据对「这份写入落在哪」给出了两个答案。危害有限（落点真实存在，且错拦方向 fail-closed），故只作 nit。

**依据**：读 hooks.ts 的 isInsideArchiveResolved（两个方向取并集）、locateArchiveTarget（`const direct = stageSegmentsUnder(archiveRoot, lexical); if (direct) return direct;` 之后才试 realpath）、stageSegmentsUnder；本步新增的软链用例（hooks.test.ts『归档外软链指向归档内』）只覆盖了「词法在归档外」这一支，故这一格无用例。

**建议**：两条路径都算出来，不一致时取 realpath 分支（或直接以 realpath 分支为准、词法仅作兜底），并补一条该形态的用例；若判定「不值得管」，就在注释里写明这是有意取舍，免得后人以为是漏算。

### CODEX-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/hooks.test.ts 的『普通业务文件不触发当轮 Driver 解析，退出码不变』；src/trivium/hooks.ts:479「该承诺已锁成断言」` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | medium |

**问题**：用例注释声明的是「解析若真的跑起来必然要读盘」，可断言只看 exitCode。把实现改成「每次写入都先解析 driver」，`src/a.ts` 依然会走 locateArchiveTarget→null→缺省 Driver→`hasProtectedRoleSuffix` false→ALLOW，退出码一字不变——这条用例区分不了两种实现。真正兜住该承诺的是外层 `looksLikeRoleArtifact(...) && isInsideArchiveResolved(...)` 那个短路条件，而不是这个断言；代码注释「该承诺已锁成断言」因此强于事实。本仓对「没有鉴别力的用例」有专门纪律（EV-68 关闭记录自己写着『第一版没有鉴别力…改取 `-claude.md` 才咬住』）。

**依据**：读该用例全文与 hooks.ts 的 hookPreWrite 短路块（driver 解析是那个 `if` 的唯一入口），并逐支推演「解析前置」的退化实现下退出码仍为 EXIT.OK；另读 hooks.ts:479 的原话。

**建议**：要么把注释与 479 改成「该性质由短路条件结构性保证，本用例只锁退出码不受影响」，要么加一条真有鉴别力的装置（例如夹具里放一份读不出的 run 留痕并断读取次数，或在 fs 层注入计数），别让后人以为这一格已有机器判据。

## 认为正确的部分

- 「当轮面」与「跨时间面」拆成两个具名函数、且 driver 必填无默认值，方向正确：我实跑 `./node_modules/.bin/tsc --noEmit`（exit 0）确认漏传确实是编译期错误，与本仓 EV-69 记的「可选参数默认值让漏传静默成功」同源。
- 不采用 `state.json` 闸门项的 `driver` 作来源是对的：我独立核实 review.ts 四处 `setGateChecked` 均不传 driver、cli.ts 只有 awaiting_approval 两处写它、state.ts 的 setGate upsert 会沿用前一条的值——采信它会直接让方向①反向。
- 短路顺序（`looksLikeRoleArtifact` + `isInsideArchiveResolved` 先挡）保住了「归档外/非角色后缀的写入不新增读盘、退出码不变」这一性质，且 `warn()` 只写 stderr，不会污染 Hook 的 stdout JSON 协议。
- 「留痕存在却一份都读不出来 → 硬失败」与 `cmdGate` 同口径；对应用例把目标从 `-codex.md` 换成 `-claude.md` 确实挣得了鉴别力（我按正确实现与退化实现各自推演过，只有 `-claude.md` 能区分）。
- `writeAtomic` 的临时名是 `run-<id>.json.tmp-<pid>-<ts>`，落不进 `^run-(.+)\.json$`，所以新的 `scanned` 判据不会被残留临时文件触发——这一格按代码核过，不会造成误判「留痕损坏」。
- 跨时间两支（提交锚 `immutableChangeReason`、Bash 侧 `roleSuffixAnywhere()`）取值口径与拆分前逐字相同、只把模块级 const 改成惰性求值：行为无变化这一承诺我按代码与既有断言核过，成立。

## 未覆盖范围（本侧盲区）

- 未跑测试套件与构建（只读审查；`npm test` / `npm run build` 会重建 dist/ 与 skills 下的产物）。因此 Driver 报告的用例数与 M9 第 6 步验收实跑本身我未复核——我只在源码树跑了 `tsc --noEmit`（不写盘）。
- 未读禁读清单中的任何一位审查员产出与运行目录的其它侧子树，未读 `.trivium/` 与 `.env.example`。
- 未审 `hook-pre-bash` 跨时间面的重构方向（EV-55 明列 M10）：只核了改名后取值口径与行为未变，未评「历史后缀在文本层面是否一律保护」这条待决问题。
- 未验证 M10 的 `--agent`/多目标 Hook 合并可行性、四家入口资产、ZCode Hook 探针结论；CODEX-02 只指出设计表述之间的冲突，不代表我判定 `--agent` 方案本身不可行。
- 未在真实 Claude Code 会话里触发一次 Hook（无写权限，也无法起会话）：关于拦截文案是否真被 Driver 看到，结论来自代码路径与 claude 会话的既有记载，未实测。
- 未审 `parse.ts` / `gate.ts` / 适配层等本补丁外的模块；主设计 §21 版本台账行、§24 演进台账与 PRD 侧 AC 状态未随本步更新，是 BACKLOG EV-57 已登记的延后项，我未把它单独计为发现。仓库根 `CLAUDE.md`「你的产出后缀是 `-claude`」等 Driver 面向表述仍是 M10 批 B 的同步项，同样未计为本次发现。

## 实际查阅的项目文件

- `.reviews/M9-Hook当轮Driver保护集/code/_meta/changes-20260919T064055Z.diff`
- `src/trivium/hooks.ts`
- `src/trivium/meta.ts`
- `src/trivium/naming.ts`
- `src/trivium/state.ts`
- `src/trivium/schemas.ts`
- `src/trivium/review.ts`
- `src/trivium/types.ts`
- `src/trivium/archive.ts`
- `src/trivium/cli.ts`
- `src/trivium/init.ts`
- `src/trivium/util/log.ts`
- `src/trivium/util/fsx.ts`
- `test/unit/hooks.test.ts`
- `test/integration/gate-loop.test.ts`
- `test/helpers/fixture.ts`
- `test/unit/registry-parity.test.ts`
- `skills/dual-critic/hooks/hooks.json`
- `.reviews/README.md`
- `CLAUDE.md`
- `doc/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md`
- `doc/08_project/BACKLOG.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":58,"project_reads":44}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
