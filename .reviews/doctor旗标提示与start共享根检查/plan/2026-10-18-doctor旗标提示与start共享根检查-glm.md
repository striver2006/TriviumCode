---
schema: trivium.review.v1
topic: doctor旗标提示与start共享根检查
stage: plan
role: glm
vendor: zcode
agent_cli: zcode/0.16.9
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
effort_requested: null
effort_effective: null
effort_effective_source: null
tier: null
tier_source: legacy
model_route: config_copy
run_id: 20261018T072932Z
rerun_index: 1
snapshot_hash: sha256:37cd78b7c8a8ab07c0bf8a162de0b7c57a9112f71bc9bfa8e94c28b8103df464
blind: true
started_at: 2026-10-18T07:29:57.215Z
finished_at: 2026-10-18T07:44:02.917Z
duration_s: 451
tool_calls:
  read: 16
  grep: 10
  glob: 4
  run_command: 0
  project_reads: 23
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: unknown
access:
  requested_mode: standard
  profile: null
  launcher_requested: /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
  launcher_effective: /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: claude
    right: glm
    status: unknown
    left_model: null
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: null
    right_source: trace
    reason: 左侧模型信息缺失
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
override_reason: 左侧模型信息缺失
session_id: sess_dc856e6a-fb2b-4ac3-9444-2fbb9a9d3007
---

# 计划审查：doctor旗标提示与start共享根检查

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261018T072932Z`
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

按四条审查焦点逐项核对了计划与仓库实际，现状陈述全部对得上，方案与任务目标口径一致，未发现会变成返工的方向性问题。焦点 1：核实 doctor.ts 里 opts.tierFlags / opts.modelOverrides 今天只有 ：762 与 ：804 两处读点（Codex、Claude 两段，且 resolveTier 都在 guard 之外先求值，段跑即消费、与夹具成败无关），「只出现在 overridesFor 体内」的 U3 护栏可实现；已登记无段的第五家会落进既有「尚无探针实现」循环的同一论域（doctor.ts:885-895），三分法原因成立。焦点 2：退出码在 cli.ts:842、JSON 出口在 cli.ts:829-837，提示只进 report.warnings（定义见 doctor.ts:97-105，自述不影响退出码），M3 变异守住。焦点 3：checkSharedReadRoots 与预检同一函数（preflight.ts:842-855），relevant 口径 [rc.meta.driver, ...rc.sides] 与预检 [driver, ...selected] 等价（run-protocol.ts:260、:412 注释）；scanEntryCollisions 经 sharedReadRootTargets 同时覆盖同名入口与 shared-residue 两类（entry-collisions.ts:269-270、:301-308），任务目标点的两个检查面被同一实现覆盖；既有「warnings 为空」断言确在（heartbeat-threshold-warning.test.ts:79、:123）且经 cli() 跑、扫描家目录钉空夹具（fixture.ts:193、entry-collisions.ts:229-233 的单一来源），D-8/U8′ 论据成立。焦点 4：无问题返回 null、relevant 全无额外读取根时 preflight.ts:848 早退不扫描，插桩点在 run-protocol.ts:595-603 的 collectWarnings 数组内、null 时不追加，逐字节论证成立。文档锚点：BACKLOG EV-245/EV-246 口径一致、主设计当前 v1.3.168（计划升 v1.3.169 正确）、MANUAL_user.md 覆盖旗标节在位、review.ts:756-760 注释原话在位、scripts/mutation-check.mjs 存在、doctor --selftest 走 selftestCommand 不进 runDoctor（cli.ts:793-794）不受影响。仅一条 nit：计划说「--json 的五个字段不变」，实际 doctor --json 还有条件出现的第六键 directoryEvidence。

**结论**：`approve-with-nits`

## 审查意见（共 1 条：吹毛求疵 1）

### GLM-01 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/doctor旗标提示与start共享根检查/plan/2026-10-18-doctor旗标提示与start共享根检查-claude.md §2.1.3（另见 §1.1 末句）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：计划断言「--json 的五个字段不变」，但 doctor --json 的顶层键在跑 Claude 目录探针时还有第六个条件键 directoryEvidence：emitJson 共写六个键，report.directoryEvidence 为 undefined 时被 JSON 序列化省略，跑过目录探针则出现。在 U4/A-1 的 --only env 格里该键缺席、键集合比对不受影响，但这句现状陈述在全量 doctor 下不成立，照「五个字段」写全量键集合断言会误判新代码多加了一个字段。

**依据**：src/trivium/cli.ts:829-837（emitJson 输出 ok/probe/notes/blockers/warnings/directoryEvidence 六键）；src/trivium/doctor.ts:90-92（directoryEvidence 随 Claude 探针返回、可缺席）。

**建议**：把该句改成「--json 既有字段不变（含条件出现的 directoryMessaging 键 directoryEvidence）」或直接采用 U4 的写法「顶层键集合与不带旗标时相同」；不需要改动设计本身。

## 认为正确的部分

- D-2 运行期消费记录是焦点 1 的正解：静态清单会随第五家接入腐化，overridesFor 助手 + U3 源码护栏（opts.tierFlags / opts.modelOverrides 只准出现在助手体内）今天可实现——我核实全 doctor.ts 只有 Codex/Claude 两段各一处读点，且都在段内 guard 之前求值，段跑即消费、与夹具成败无关，不会把消费误报成因①。
- D-3 三分法原因优于只出①：--only agy 时 codex 的覆盖静默同样误导；「尚无这一家的探针」与既有循环（doctor.ts:885-895）同一论域，第五家故事自洽。
- D-4 措辞修正是有据的偏离：zcodeProbeModel 确按配置 plan 档取模型、不读命令行一级（adapters/zcode.ts:963-966），照抄用户原话「固定探测模型」对 zcode 不准。
- D-5 判键接线的现状核实全部对上：cli.ts:815-818 注释原话在位、assertModelOverrideKeys 复用 assertCriticFlagKeys（critics.ts:130-178）、CRITIC_AGENT_IDS 四家全启用（registry.ts:420-422），「对现注册表全部放行、可见行为变化只有提示一条」成立；先键后值的次序与 review/preflight 一致。
- D-6/D-7 的插桩点与场合参数方案成立：startRun 告警汇总确为三项后接 mustReadPruned（run-protocol.ts:592-603），checkSharedReadRoots 与 summarizeSharedRootProblems 的结尾句分别硬编码「不影响本次预检」（preflight.ts:854、entry-collisions.ts:347），不传场合参数会出「不影响本次预检」的错话；checkSharedReadRoots 内部已吞异常（:853-854），不会把 --start 变失败。
- D-8 测试隔离论据成立：扫描家目录唯一来源 entryScanEnv（注入口→TRIVIUM_ENTRY_SCAN_HOME→homedir，entry-collisions.ts:229-233），cli() 缺省钉空夹具（fixture.ts:193），heartbeat-threshold-warning.test.ts:79/:123 的 deepEqual(warnings, []) 断言经 cli() 跑故不受影响；U8′ 对账文件的 IMPORTS_ENTRY 与 spawn 判据结构与计划描述一致（entry-scan-isolation.test.ts:51-66）。
- 验收设计可信：A-1/A-2 的旧构建对照覆盖焦点 2/4，变异 M1-M12 与 U 格一一对应（含 M7 的行为格、M10 的位置格、M11/M12 的场合词格）；scripts/mutation-check.mjs 存在。
- 文档同步清单核对无误：BACKLOG EV-245/EV-246 与任务目标口径一致，主设计当前 v1.3.168（升 v1.3.169 正确），MANUAL_user.md 覆盖旗标节（512-522 行附近）在位，review.ts:756-760 注释原话在位；doctor --selftest 走 selftestCommand 不进 runDoctor（cli.ts:793-794），不受本题影响。

## 未覆盖范围（本侧盲区）

- 本侧只读、未运行任何命令：所有结论来自静态读码，「扫描毫秒级耗时」「逐字节相同」等运行期性质只能核其论据（无问题返回 null、相关家全无额外读取根时 preflight.ts:848 早退、扫描只读），实测留给 A-1/A-2 与 U4/U6。
- 未逐行核对主设计 8.1 预检表、7.1 档位旗标节、1471 与 1729 行附近的原文（只确认版本号 v1.3.168 与文档在位），§5 各条同步措辞是否精确未核。
- mutation-check「规格用生成脚本从源码截锚点」的机制细节未读脚本本体，只确认文件存在。
- D-3 原因②与③对「第五家无段且本次 --only 其它值」这一格的判据归属（算被滤掉还是算无段）计划未写死；两种读法给出的都是真话，我判为不构成返工，仅备案。
- U5 引用的既有 assertCriticFlagKeys 桩描述符用例名未逐一翻出核对（计划自己承诺「核一眼并在报告里列出用例名」）。

## 实际查阅的项目文件

- `src/trivium/doctor.ts`
- `src/trivium/cli.ts`
- `src/trivium/entry-collisions.ts`
- `src/trivium/preflight.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/critics.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/review.ts`
- `test/helpers/fixture.ts`
- `test/unit/entry-collisions.test.ts`
- `test/unit/entry-scan-isolation.test.ts`
- `test/unit/zcode-provider-env.test.ts`
- `test/integration/heartbeat-threshold-warning.test.ts`
- `doc/08_project/BACKLOG.md`
- `doc/07_manuals/MANUAL_user.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":16,"grep":10,"glob":4,"run_command":0,"project_reads":23}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
