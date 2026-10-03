---
schema: trivium.review.v1
topic: doctor探针走副本HOME
stage: plan
role: glm
vendor: zcode
agent_cli: zcode/0.16.9
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
model_route: config_copy
run_id: 20261003T042353Z
rerun_index: 1
snapshot_hash: sha256:ba0474d11da298e0858bc2a71413008ef0c1219f4b542c16602b08155f8ffe8b
blind: true
started_at: 2026-10-03T04:23:55.593Z
finished_at: 2026-10-03T04:31:36.369Z
duration_s: 452
tool_calls:
  read: 9
  grep: 9
  glob: 4
  run_command: 0
  project_reads: 14
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: sess_79f66903-dce0-4552-b1e5-82a68c585e9a
---

# 计划审查：doctor探针走副本HOME

> Critic-B · 智谱 ZCode ｜ 模型 `bigmodel-coding-plan/GLM-5.3`
> ｜ 运行 `20261003T042353Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

逐条对照源码核实了计划的现状引用与方案机制，绝大多数成立：§1 六组引用全部与 292fa79 代码相符（invokeZcode 缺省注入个人配置、headless 失败即返回、readTrace/readRollout 已有目录参、cliConfigured 门控、model_id_form 唯一消费方、设计与 PROTOCOL 的记载）；§2 的关键机制也核对无误——prepareZcodeHome 仅在读/解析失败时抛错（srcConfig 缺失走 source_missing 返回，与「副本源缺失在 doctor 侧被门控先拦」的推理互洽）、回读拼法与 zcodeStorageRedirectEnv 的 ZCODE_LOG_DIR 布局逐字同形（run() 的 cliDir 同一式子）、副本支 storageRedirectRoot===homeDir 的不变式成立、退路两支与 authProbe/run() 同构；配额账对得上（doctor --only zcode 只跑 probeZcode、不含认证探活，每次恰 headless 与 path_deny 两次真实调用，两侧对照共四次；runDoctor 逐段重探、无缓存跳过，改前判据可测）；既有测试未锁三条将改措辞的 note，zcode-auth-probe.test.ts 恰 10 条，probeZcode 生产调用方只有 doctor.ts 一处。两条 minor：§5 漏了测试报告的 README 归档索引登记（契约测试会把 npm run check 打红一次）；验证 3 写死判据的「文件数前后不变」未限定只核改后侧，若按两侧判、修对了也会判不达标且配额已烧完。

**结论**：`approve-with-nits`

## 审查意见（共 2 条：次要 2）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/doctor探针走副本HOME/plan/2026-10-03-doctor探针走副本HOME-claude.md §5（测试报告条目）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：§5 只列了新测试报告 doc/05_testing/REPORT_2026-10-03_doctor_probe_home_copy.md 与证据目录，没有把报告登记进 doc/05_testing/README.md 的「当前已归档文件」一节。AGENTS.md 改动同步清单明文要求新增测试报告同批进该节并由 doc-archive-index 契约测试对账，漏掉会让验证 4 的 npm run check 在报告落盘那一次变红，多出一轮返工提交。

**依据**：AGENTS.md「改动同步清单」表「新增测试报告（或其它带『当前已归档文件』一节的 doc/ 目录下的文档）｜同批进该目录 README 的『当前已归档文件』一节……doc-archive-index 契约测试对账」一行；test/contract/doc-archive-index.test.ts 与 test/helpers/doc-archive-index.ts 均存在（Glob 核实）；计划 §5 四个条目（主设计 / PROTOCOL / BACKLOG / 测试报告）均未提及该 README。

**建议**：§5 的测试报告条目补一句：报告同批登记进 doc/05_testing/README.md「当前已归档文件」一节（doc-archive-index 契约测试对账）。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/doctor探针走副本HOME/plan/2026-10-03-doctor探针走副本HOME-claude.md §6 验证 3（写死判据末格）` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：判据「真实 ~/.zcode/cli 下 log 与 rollout 的文件数前后不变」未写明只核改后那次跑。改前那次跑的是旧代码，按 EV-115 的记载本就会在真实 ~/.zcode/cli 留 log 与 rollout（日志按日合并成一个文件，当天首次跑即新增一个日志文件）；若这一格被读成对两侧都判，实现正确也会判不达标，而配额写死四次、判据写死不许调措辞重跑，只能记下不达标停下并烧完预算。

**依据**：计划 §6：「每次跑之前与之后各对真实 ~/.zcode/cli/log、~/.zcode/cli/rollout 列一次（文件名、大小、mtime）」「判据（写死）：改前 headless 报 Model creation failed；改后 headless 通过、……、真实 ~/.zcode/cli 下 log 与 rollout 的文件数前后不变」「不达标不调措辞重跑，如实记下停下」；doc/08_project/BACKLOG.md:213（EV-115）记载 doctor 的 headless 探针与 path_deny 否定对照现状「每次都在 ~/.zcode/cli/{log,rollout,db} 等处留下日志、rollout 与会话记录」。

**建议**：在判据里写明「文件数不变」只核改后那次跑；改前侧对真实 HOME 的写入属旧行为，前后清单作为证据如实记下、不进达标判据。

## 认为正确的部分

- §1 现状引用逐条属实：headless（probes/zcode.ts:1412-1421）与 probePathDeny（:1081-1088）确不给 homeDir/omitPersonalProviderConfig/storageRedirectRoot，invokeZcode（adapters/zcode.ts:487-502）缺省注入个人配置且不设落点键；headless 失败即 return（:1423-1426）；readTrace（:1035-1050）/readRollout（:307-317）已有目录参数；storageRedirectRoot 注释（:424-428）原文与计划引述一致
- §2.4「副本源缺失在 doctor 侧不可达」的推理正确：门控（probes/zcode.ts:1202-1203）判的就是 opts.cliConfigPath ?? ZCODE_CLI_CONFIG，而 prepareZcodeHome 对 srcConfig 缺失走 source_missing 返回不抛（adapters/zcode.ts:929-938），只有读/解析失败才抛——D6 的可达性与 §2.3.2 的 note+return 分支与实际语义吻合，authProbe 已有同一 try/catch 形态（:1073-1080）
- §2.3 回读拼法正确：zcodeStorageRedirectEnv（adapters/zcode.ts:378-388）的 ZCODE_LOG_DIR 即 zcodeHomeUnder(runDir)/.zcode/cli/log，run() 的 cliDir（:1300）同一式子；D1 的「storageRedirectRoot 等于 homeDir」在副本支成立（prepareZcodeHome 的 homeDir 就是 zcodeHomeUnder(runDir)，:942），退路支落点根照设与 authProbe（:1087-1089）及 run() 无副本支（:1237/1252）一致
- 配额账成立：doctor --only zcode 只调 probeZcode（doctor.ts:550-556），不含认证探活；每次恰 headless 与 path_deny 两次真实调用，两侧对照共四次；runDoctor 逐段重探、无 TTL 跳过，改前「报 Model creation failed」可测（EV-194 记载个人配置两次尝试后已按备份逐字节恢复，失败形态应可复现）
- §1.6/§5 的文档判断属实：设计 §11.3 第 7 条末尾确记 EV-136 而未提 doctor 探针（设计 :2819）；PROTOCOL grep 无 zcode 探针段，不改有据；主设计当前版本 v1.3.77，升 v1.3.78 正确；BACKLOG EV-194（todo，修法方向与计划一致）、EV-115（不修，理由与本题冲突待改写）、EV-93（不修，只补事实）三条的处置与台账现状吻合
- 测试面判断属实：既有测试未锁三条将改措辞的 note（test/ 全目录 grep 无命中）；zcode-auth-probe.test.ts 恰 10 条；zcode-provider-env.test.ts 存在可复用其假入口思路；probeZcode 的生产调用方只有 doctor.ts:552，launchModel 缺省退路不会被其它调用方踩到；model_id_form 的唯一消费方确为 normalizeModelForCatalog（adapters/zcode.ts:1001-1003，全 src grep 复核）

## 未覆盖范围（本侧盲区）

- 只读审查、未运行任何命令：判据里对 CLI 0.16.9 行为的断言（个人配置存在即用且不导入、日志按日合并、rollout 每会话一文件、置首回落形态）均引自计划 / BACKLOG / 代码注释，本次未经实测复核
- 未读 scripts/build.mjs 与 scripts/mutation-check.mjs，§4 变异流程的机制细节（锚点生成、--test-timeout 预跑）未核
- 未逐行核 zcode-provider-env.test.ts 的假入口实现能否直接支撑 §3 所述复用（只确认了文件存在与其测试对象同类）
- 设计 §3.5 探针清单是否也需随探针环境改动补一句未核：我按「§3.5 记探针项清单、本题不改项集」判断无需同步，未逐条读 §3.5 原文验证
- 任务目标文件原文（决策一～五的完整表述）不在本次阅读面内，按任务书引述采信；adapters/zcode.ts 第 1400 行之后的守卫段未读，与本题无涉

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/probes/zcode.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/doctor.ts`
- `test/unit/zcode-auth-probe.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":9,"grep":9,"glob":4,"run_command":0,"project_reads":14}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
