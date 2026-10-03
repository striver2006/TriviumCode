---
schema: trivium.review.v1
topic: zcode探针静默失败收口
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.160.0
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20261003T063541Z
rerun_index: 1
snapshot_hash: sha256:faaa365cdaa631c3d11fbbf127a48c1a444520971a55a79afb5234814a29274a
blind: true
started_at: 2026-10-03T06:35:43.470Z
finished_at: 2026-10-03T06:44:40.041Z
duration_s: 250
tool_calls:
  run_command: 11
  project_reads: 10
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 4
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a10079-c924-78b0-8bfd-743bf805d3b9
---

# 计划审查：zcode探针静默失败收口

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20261003T063541Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

我逐处实读了计划引用的五个代码面并核对行号与行为：probeZcode 的三支早退/续跑形态（probes/zcode.ts:1462-1471 副本源失败、:1492-1504 headless 失败、:1558-1560 无 envelope 不 return）与 §1.1 的 carried 划分一致；doctor zcode 段的旗标 warning 先例（doctor.ts:592-603）与 headless blocker 判据（response_field === null && !skipModelCalls）如 §1.2 所记；认证探活 finally 裸 fs.rm、force 只吞 ENOENT、结果在 finally 之后拼装（adapters/zcode.ts:1100-1154）与 §1.3 所记一致；probeAuth 只缓存正结论且缓存条目不含 detail（preflight.ts:699-740）如决策三所述；D10 现用例确实是 chmod 0o500 只读子目录摆 EACCES 并 skip root（zcode-doctor-probe-home.test.ts:433-449），A1/A2「与 D10 同法」成立；doctor 注入链 opts.zcodeProbe → probeZcode 的 invoke/cliConfigPath 存在，决策五的零配额摆法可达；设计现版 v1.3.78，计划升 v1.3.79 正确；无落盘变更、无迁移面，回滚即 revert。整体方向与用户五项决策吻合，变异表设计扎实。提四条小问题：§1.2 有一处与分析主体相反的关键句、缓存正结论会抑制残留提示的可见性、D10/A1/A2 改为与生成函数逐字比对会自我循环削弱逐字锁、A1/A2 的摆法隐含「副本支落点根存在」前提未写明。

**结论**：`approve-with-nits`

## 审查意见（共 4 条：次要 4）

### CODEX-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §1.2 末段（「headless blocker（:604）只看 response_field === null」一句）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：该句写「existing 里是 'response' 时 A / B / C 三支都不可达」，与 §1.1 和全文设计自相矛盾：三支（副本源失败、headless 失败、无 envelope）的可达性与 existing 的 response_field 取值无关，代码里没有任何一支以该字段为入口条件；真正不可达的是「A / B / C 触发 headless blocker」——保留的旧值 'response' 让 :604 判据不成立，这正是 EV-196 要收口的静默失败本身。D15/D16 更是明确把 existing 摆成 response_field='response' 来让三支可达并出 warning。写在「现状（已核）」一节里的这句反话，会误导实施者以为有代码级不可达性、也可能让后续读者对 blocker 判据的失效方向再判错一次。

**依据**：实读 src/trivium/probes/zcode.ts:1462-1471、:1492-1504、:1558-1560（三支均不读 response_field 作分支条件）与 src/trivium/doctor.ts:604（blocker 只看 r.probe.response_field === null）；对照计划 §1.1「跳过或早退的探测保留旧值」与 §2.2、§4.1 D15 的摆法。

**建议**：把该句改成「existing 里是 'response' 时，A / B / C 三支发生时 blocker 不触发（旧值顶替本轮结论），这正是 EV-196 的静默形态」，或删去「三支都不可达」的表述。不涉及设计改动，逐字修正即可。

### CODEX-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §3.2（认证探活的残留提示）` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：§3.2 让删除失败时把残留提示接进 detail 且「结论（ok）不因删除失败改变」，但没注意调用方语义：probeAuth 对 ok:true 一律写探活缓存（条目不含 detail），此后 TTL 期内的每次预检走缓存命中路径、返回的是缓存 reason 文案，残留提示（含「请手工删除」与凭据告警）只在失败发生的那一次预检可见。若用户当时没留意，含真实凭据的 cli/config.json 副本会在系统临时目录里静默留到 TTL 过期或机器重启——「不抛」达成了，「被看见」只达成了一次。这与 §2.3 诚实写明的 EV-86 同族残余是同一形态，但认证探活侧计划未登记。

**依据**：实读 src/trivium/preflight.ts:699-740：probeAuth 返回 `cache: r.ok ? { checked_at, cli_version, fingerprint, ok: true } : null`，缓存命中时 detail 用 authCacheValid 的 reason、不含 probe() 的 detail；实读 src/trivium/adapters/zcode.ts:1092-1155 的 probe() 返回形状。计划 §3.2 只写了「结论不因删除失败改变」，未提缓存对该提示的抑制。

**建议**：二选一并写进计划：①删除失败（residue 非 null）时不让调用方缓存正结论——但这要 probe() 之外可观测的通道或改 probeAuth 判据，可能与决策三「不改 probeAuth 结构」冲突，需先确认边界；②不改结构，在 BACKLOG 结案说明与 §2.3 式「残余登记」里写明「残留提示仅当次预检可见、缓存期抑制」同 EV-86 形态。倾向 ②，成本零、且不碰决策三划的线。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §4.1（D10 改法）与 §4.1 认证探活表 A1 / A2 的断言` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：计划把 D10 改成与 zcodeTempDirResidueText('探针', runDir, 'EACCES') 逐字比对，A1/A2 也以同一函数的输出比对详情尾部。测试用「生成该文案的同一个函数」来断言文案，就失去了逐字锁：将来谁改了函数里的人读措辞（比如把「请手工删除」改掉），D10/A1/A2 照绿——而 EV-194 双审专门立的正是「note 逐字节不变」的锁（现有 D10 用 startsWith 字面 + /（EACCES）/ + /含真实凭据，请手工删除/ 三段字面断言）。变异表 M11/M12/M14 锁的都是行为（抛不抛、接不接、ok 变不变），没有任何一条锁这段文案的字面形态。

**依据**：实读 test/unit/zcode-doctor-probe-home.test.ts:433-449（现行 D10 的字面断言三处）；对照计划 §4.1「D10 改为与 zcodeTempDirResidueText('探针', runDir, 'EACCES') 逐字比对」及 §4.2 变异表中无文案字面变异。计划自己在 §3.1 也强调「note 与 EV-194 时逐字节相同（D10 照绿）」——但改后的 D10 已不再能证明「相同」，只能证明「等于函数当前输出」。

**建议**：保留至少一条逐字面断言（现 D10 的三段 match 不删，另加与函数输出相等的新断言即可），或在变异表补一条「改写 zcodeTempDirResidueText 文案」的变异并指明由哪条字面断言咬住。改动很小，但不做的话逐字锁名存实亡。

### CODEX-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划 §4.1 认证探活用例的前提（「假入口加一个开关，在 ZCODE_STORAGE_DIR 下建只读子目录」）` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：「在 ZCODE_STORAGE_DIR 下建只读子目录」这一摆法隐含前提：本次探活走的是设了落点根的副本支。代码里 homeDir === null 的退路支（档位未给模型 / 副本源中途不见）不设 storageRedirectRoot，假入口在那种环境下写不进落点根、只读子目录造不出来，rm(runDir) 会成功——A1/A2 的「删不掉」就摆不出来，而计划没有把「launchModel 有值、副本源有效」写成这两条用例的摆法前提。D10 在探针侧没这个问题是因为探针测试本就固定副本支，认证探活的既有 10 条是否全部固定副本支我未逐条核实，计划应显式声明。

**依据**：实读 src/trivium/adapters/zcode.ts:1112（prepareZcodeHome 退路 cause 分支）与 probes/zcode.ts:1477-1480（launch.storageRedirectRoot 仅在副本路径设值）；D10 的 lockRunDir 桩是在 o.storageRedirectRoot 存在时才建 locked 子目录（test/unit/zcode-doctor-probe-home.test.ts:163-168 实测读到）。计划 §4.1 探活表只说「与 D10 同法」。

**建议**：在 §4.1 的用例前提里补一句：A1/A2 必须摆「档位有模型 + 副本源可读」的副本支（否则落点根不存在、删不掉摆不出），必要时仿照 D10 让假入口开关在 storage 环境变量不存在时直接报错失败而非静默通过。

## 认为正确的部分

- §1.1 对 probeZcode 五处 return 与三支 carried 划分（A/B 四项、C 两项且 path_deny 照跑）的核实与代码逐一致，我实读 :1431-1437、:1462-1471、:1492-1504、:1558-1560 确认
- 决策五全程零配额可达成：探针三支走 opts.invoke 桩、doctor 层走 opts.zcodeProbe 注入（doctor.ts:557 的展开实读确认）、认证探活走既有假入口装置（zcode-auth-probe.test.ts 的 OBSERVE_ENTRY 与假 entrypoint 机制实读确认）
- §1.3 对认证探活 finally 抛出顶替原结果的描述准确：adapters/zcode.ts:1135-1136 的 finally 确为裸 fs.rm（无 maxRetries、无 catch），且 out/prep 在 finally 之后使用
- 决策三「不改 probeAuth 结构、让 probe() 自己不抛」与 probeAuth 无兜底的现状（preflight.ts:730 直接 await auth.probe()）相符，是本题最小干预的正确取法
- §3.1 共用函数只认传进来的 runDir、不拼路径，符合 2026-09-20 事故规矩；D10 的 EACCES/root-skip 形态与现用例一致
- 不落盘任何新字段、不动 schema 与退出码，回滚就是单 revert，无迁移成本；设计版本号 v1.3.79 接续正确（现值 v1.3.78 实读确认）
- §2.1 让三支 note 的定位字面引同一份 noteKey 表、§4.2 用 M10 盯防，方向与「措辞单源」纪律一致

## 未覆盖范围（本侧盲区）

- 未实际运行任何测试或变异（沙箱只读），全部结论来自代码实读与推理
- zcode-auth-probe.test.ts 现有 10 条用例是否逐条走副本支未全部核完（CODEX-04 因此标 medium）
- 未细读 RUNBOOK §五 现文与 BACKLOG EV-86 条目全文，§2.3「残余同 EV-86」的对应关系未逐字验证
- renderDoctorReport 的 --json 输出与 doc-archive-index 契约测试细节未逐条核对，仅按计划的 §5 文档面认可
- §4.2 变异锚点的可截性/唯一性（scripts/mutation-check.mjs 的机械面）未预演

## 实际查阅的项目文件

- `AGENTS.md`
- `src/trivium/probes/zcode.ts`
- `src/trivium/doctor.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/preflight.ts`
- `test/unit/zcode-doctor-probe-home.test.ts`
- `test/unit/zcode-auth-probe.test.ts`
- `doc/08_project/BACKLOG.md（EV-194 / EV-196 / EV-197 条目）`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md（§11.3 第 7 条与版本记录）`
- `doc/05_testing/README.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":11,"project_reads":10}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
