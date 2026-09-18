---
schema: trivium.review.v1
topic: M9-ClaudeCode审核者接入
stage: code
role: glm
vendor: zcode
agent_cli: zcode/0.16.5
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
model_route: config_copy
run_id: 20260918T020530Z
rerun_index: 4
snapshot_hash: sha256:3e1102a287b2855385273c916a1fe953df3d16bf300515823a3794b16c330344
blind: true
started_at: 2026-09-18T02:05:31.575Z
finished_at: 2026-09-18T04:04:24.350Z
duration_s: 1194
tool_calls:
  read: 15
  grep: 7
  glob: 0
  run_command: 0
  project_reads: 12
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 2
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: sess_b5a964de-d65e-4155-94ec-1d99b8465f87
---

# 代码审查：M9-ClaudeCode审核者接入

> Critic-B · 智谱 ZCode ｜ 模型 `bigmodel-coding-plan/GLM-5.3`
> ｜ 运行 `20260918T020530Z` ｜ 第 4 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最重的一条在 EV-43：其「闭集」清单只分类了 §3.7 表 13 行中的 9 行（另含不在表内的 version），readonly_flags / readonly_breach / headless_read_ok / model_flag / strict_mcp_config_applied 五行两桶皆不入，其中 readonly_breach 与 headless_read_ok 和已归「形态相关」的 denied_tool_in_trace 同属模型行为依赖——闭集不闭，第 3 步执行者面对未分类格仍要临场裁量，正是 CODEX-08 要消的形态。其余：EV-44 翻转条件挂在一个尚不存在且无人负责落地的探针格上（死条件风险）；契约扫描正则在两处各存一份；扫描器自身的不覆盖形态未具名登记。四个焦点逐项核实：必填改造未漏运行期构造路径（loadCtx 经 deepMerge 从默认回填缺键，schema 的 path_deny 是宽松 type:object 不拦新键，全部现存消费点用 === false/=== true 严格比较、undefined 与 null 同义且字段文档明示「null/缺省」同档）；重写后的契约不再空转（三种写形对 agy.ts:337 / zcode.ts:411 赋值形与 codex/claude return 形实测命中，scanned>0 防空转腿与反面夹具俱在，config.ts 注释宣称的键集对账已真实落地）；verboseNegativeControlArgs 生产侧仅 probeStreamVerboseBinding 一处调用、测试共用同一份，调用面唯一；EV-42 两条结案腿与安全默认可执行。r3 的 15 条修复（含我 r3 全部 5 条）逐项核实按裁决落实，零阻断，2 minor + 2 nit。

**结论**：`approve-with-nits`

## 审查意见（共 4 条：次要 2 ｜ 吹毛求疵 2）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/08_project/BACKLOG.md:140（EV-43）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：EV-43 自称「复验面是闭集，不是开放集合」，但闭集只列了形态相关 5 格（stream_json_requires_verbose、json_schema_ok、path_deny、denied_tool_in_trace、trace_path_structured）与形态无关 4 格（version、scratch_paths、trust_prompt_required、session_id_source），共 9 格——而设计 §3.7 事实表共 13 行（doc/02_design/…设计.md:362-375），readonly_flags、readonly_breach、headless_read_ok、model_flag、strict_mcp_config_applied 五行两桶皆不入。其中 readonly_breach（负对照：模型是否真发起写）与 headless_read_ok（模型是否真发起 Read）和已归「形态相关」的 denied_tool_in_trace 同属模型行为依赖，按 EV-43 自己的判据「结论都可能随 prompt 载入形态变」没有理由豁免；且 EV-43 首句自称「本节每一格都是 argv 形态下的结论」、设计 §3.7 stdin 行也写「本表其余各格都是在探针的 argv 形态下测的」，与只复验 9 格的清单自相矛盾。另「形态无关格」里的 version 根本不是 §3.7 表行，可见清单不是从表行集推导的。后果：接手第 3 步的会话按闭集执行，5 个未分类格要么被漏复验（readonly_breach/headless_read_ok 恰是只读保障的两道主判据）、要么临场裁量——后者正是 r3 CODEX-08 消灭的「凭手感挑格」。

**依据**：实读 doc/08_project/BACKLOG.md:140（EV-43 全文，两桶清单与「闭集」宣称）；grep 设计 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md §3.7 表（:362-375 共 13 行：readonly_flags、readonly_breach、headless_read_ok、trace_path_structured、denied_tool_in_trace、model_flag、json_schema_ok、session_id_source、trust_prompt_required、path_deny、stream_json_requires_verbose、strict_mcp_config_applied、scratch_paths）；§3.7.1 stdin 行（见 changes-20260918T020530Z.diff :102）「本表其余各格……都是在探针的 argv 形态下测的」。

**建议**：把 §3.7 的 13 行全部落进两桶之一：readonly_breach 与 headless_read_ok 按同判据入形态相关（或写明为何模型行为类只有 denied_tool_in_trace 一格要复验）；readonly_flags / model_flag / strict_mcp_config_applied 显式入形态无关并各给一句理由。判据改成可机械推导（从表行集 ∪ 两桶 = 全集的对账），而不是枚举后留缝。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/08_project/BACKLOG.md:141（EV-44）` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | medium |

**问题**：EV-44 的翻转条件已改挂因变量（方向正确，readonly_flags 的三个无关清空点分析成立），但新挂的那个因变量——「给探针新增一格三态判据『--restricted 下项目记忆是否仍被阻断』」——目前不存在（src/trivium/types.ts 的 ClaudeProbe 无此字段），且没有任何步骤或触发条件负责把它落地：EV-44 的触发条件只写「M9 第 3 步接入时裁定」，§16.1 M9 行的前置清单也只写「EV-44（……含已改挂因变量的翻转条件）」，均未把「落该探针格」列为裁定的交付物。若第 3 步裁定为「显式不做」而无人补该格，翻转条件永远是死条件：厂商日后改掉 --restricted 的记忆阻断语义时无格可落、EV-44 的结论无从作废——这正是本仓反复记过的「守卫没人守」形态，也是 r3 自己写下的教训（翻转判据必须挂在可观测的因变量上，而它现在挂在不可观测的东西上）。

**依据**：实读 doc/08_project/BACKLOG.md:141（EV-44 全文：翻转条件依赖「给探针新增一格三态判据」，触发条件仅覆盖裁定动作）；实读 src/trivium/types.ts:535-678（ClaudeProbe 现有字段集，无记忆阻断相关格）；§16.1 M9 行前置清单（见 changes-20260918T020530Z.diff :190）只引「含已改挂因变量的翻转条件」、未提探针格落地。

**建议**：在 EV-44 或 §16.1 前置清单里把「落地该三态探针格」钉为第 3 步裁定的配套交付物（无论裁定做不做第 ⑤ 件，该格都要落，翻转条件才有观测面）；或把该格单独立一条 EV 并给触发时点。避免翻转条件停留在对一个不存在字段的引用上。

### GLM-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/claude-events.test.ts:604 与 :638` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：契约扫描正则 SHAPES 在同文件两处各存一份字面量：主契约用例（:604）与「契约自检：对漏键确实会红」的反面夹具（:638）。将来有人改主正则（比如补一种写形、或修 supported 子串误命中）而漏改夹具那份，反面夹具就在验一条已过时的正则——守卫被守着、守的是旧版本。这正是本 diff 自己在 eventCount 上消掉的形态（「而不是在它自己那边再写一份……两处各存一份判据，日后会分叉」），同一判据双份在同一次改动里一边消一边造。

**依据**：grep test/unit/claude-events.test.ts 确认 `const SHAPES = /(?:path_deny\s*[:=]\s*|return\s+)\{([^{}]*supported[^{}]*)\}/gs` 在 :604 与 :638 各出现一次；对照同文件 parseClaudeEvents 复用口径的注释（见 changes-20260918T020530Z.diff :546-556）。

**建议**：把 SHAPES 提为该测试文件的模块级常量（或从主用例导出供夹具复用），两处引用同一份；改判据时只有一处可改，分叉在结构上不可能。

### GLM-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/claude-events.test.ts:578-604（契约用例）` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：重写后的契约用例注释只描述了覆盖的三种写形（属性 / 赋值 / return），没有像 registry-parity 先例那样具名登记自己的不覆盖形态。实际存在的盲区至少三类：①正文含嵌套花括号的字面量（[^{}] 直接失配，整个逃逸）；②无 path_deny/return 前缀的中间变量构造（const pd: PathDenyProbe = {…} 再 probe.path_deny = pd，扫描器够不到——tsc 对带类型标注的写法仍兜得住，但这条用例自我定位是「第二道闸门」，读者需要知道它的边界）；③形状过滤用 supported 子串匹配，正文出现 unsupportedX 一类标识符会被误当产出点（误报方向）。v1.3.18 立过的规矩是「不覆盖的形态具名登记」，同族守卫这里缺了这一半。

**依据**：实读契约用例全文与 SHAPES 正则（changes-20260918T020530Z.diff :1390-1461，即 test/unit/claude-events.test.ts 现行 :578-660 区域；grep 确认 :604/:638 两处正则）；对照 registry-parity「六类不覆盖形态具名登记」的先例（v1.3.18 台账行，设计 doc/02_design/…:3169 区域）。

**建议**：在契约用例注释里列明三类不覆盖形态（嵌花括号正文 / 中间变量构造 / supported 子串误命中），并各注明由谁兜底（tsc 必填 / 无兜底需人工）；与 GLM-03 的单源化一并做时可把这份边界说明放在 SHAPES 常量处，让守卫与它的边界声明同处一地。

## 认为正确的部分

- 焦点一核实通过：coverage_complete 改必填后 tsc 覆盖全部编译期产出点（实读 agy.ts:337 / zcode.ts:411 赋值形、codex probeCodexPathDeny 三处 return 形、preflight.test.ts 两处夹具，与「7 处」声明一致）；运行期路径无遗漏——loadCtx 经 deepMerge 从 defaultProbe() 回填旧盘缺键（config.ts:339-349、553-618），runDoctor 的 cli 逐键合并兜住新登记 CLI（doctor.ts:358-374），patchProbe 的浅合并虽不回填嵌套子对象，但现存全部消费点（claudeSeverity ②'、doctor 结论文案）都用 === false / === true 严格比较，undefined 与 null 同义且 types.ts 字段文档明示「null / 缺省」同档，无行为差异；config.v2.json 的 path_deny 是宽松 type:object（:703-705），新键不会被 ajv 拒。
- 焦点二核实通过：重写后的契约不再空转——SHAPES 对 agy/zcode 的赋值形与 codex/claude 的 return 形实测命中（本轮逐一比对源文件确认），scanned>0 的防空转腿、wantKeys 含 coverage_complete 的前置断言、期望必须红的反面夹具三件俱在；config.ts:44-45 注释宣称的「真实产出的键集 ⊇ 空壳键集」对账在 r3 之后真实存在（此前是空承诺，r3 已兑现）。
- 焦点三核实通过：verboseNegativeControlArgs 生产侧仅 probeStreamVerboseBinding 一处调用（probes/claude.ts:648 区域），测试侧以同一函数断言「负对照实际发出的 argv 不含 --verbose」（守「拨了旋钮」而非仅「旋钮有效」），omitVerbose 无第二个生产构造点；probeStreamVerboseBinding 在正对照不成立时短路不 spawn。
- 焦点四的 EV-42 核实可执行：结案判据两条腿（注入 Read(<具体文件>) 后哨兵未泄漏 + 该次记入 permission_denials）具体可测，未结案期间 peer_deny_applied 不得记 true 的安全默认写死在条目里，且已随 §16.1 范围栏进入第 3 步开工必读路径（GLM-r2-02 的落点）。
- judgeVerboseBinding 五格三态与四道门（超时 / 拿不到退出码 / 正对照不成立 / 两头皆空）用例逐格锁住，退出码 null 与超时的区分（初版 null !== 0 落 true 的洞）有专门用例；judgeStrictMcpConfig 与 claudeSeverity ②' 两层独立，【纵深】用例用 pinned() 注入上游坏值把修好后走不到的第二层在自己的论域验到；claudeSeverity 仅在本轮真探过 claude 时被调用（doctor.ts:541-558 分支内），skipModelCalls 与 !bin 早退保留 stale 值的语义已在 types.ts 如实声明为「不得当本轮读数」。
- 我 r3 的 5 条意见全部按裁决落实且取了最重档（GLM-01 → 改必填 + 契约重写；GLM-02 → §16.1 范围栏钉前置；GLM-03 → EV-44 时点两处归一；GLM-04 → 断言消息改指被删旧句；GLM-05 → EV-43 补回写落点），实读工作树逐项对上，无一走样。
- BACKLOG EV-40/41 转 done 时把被实测否证的原拟判据原样保留并写明否证经过，留痕可信；报告 §10 的三轮自我更正（r1 判据 / r2 守卫 / r3 空集）如实记叙，没有粉饰。

## 未覆盖范围（本侧盲区）

- 只读审查：未运行 typecheck/build/test（写操作约束）；报告 §9.3/§10.5 所称各次变异验证与全量 doctor 复验按用例文本静态核对，未复跑。
- 实测数字（31,913 字节、$0.044/次、24 倍、2.1.273、denied_tool_in_trace 三次观测）与 .trivium/config.local.yaml 落盘值无法独立复现，按报告与 BACKLOG 采信（.trivium/ 属任务书 §8.2 告警区，未读）。
- M9 计划稿（.reviews/M9-ClaudeCode审核者接入/plan/ 目录）未对照——该目录含禁读文件，整目录未进；对「第 ⑤ 件」的理解全部来自 §16.1、EV-44 与报告 §2.3 的公开转述。
- gemini/codex 两侧本轮产出未读（背靠背约束）；本轮意见与其重合属独立收敛。
- EV-39（registry-parity 黑名单按厂商归属）未核——本 diff 未触碰 registry-parity.test.ts，其触发在创建 adapters/claude.ts 那一步。
- dist/ 与 skills/dual-critic/scripts/trivium.cjs 生成物未与源码对账；doctor --selftest 桩路径下新字段与 ②' 的行为未验证。

## 实际查阅的项目文件

- `.reviews/M9-ClaudeCode审核者接入/code/_meta/changes-20260918T020530Z.diff`
- `src/trivium/types.ts`
- `src/trivium/config.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/probes/agy.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/doctor.ts`
- `skills/dual-critic/schema/config.v2.json`
- `test/unit/claude-events.test.ts`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/08_project/BACKLOG.md`
- `.reviews/M9-ClaudeCode审核者接入/code/2026-09-18-M9-ClaudeCode审核者接入-r3-glm.md`
- `.reviews/M9-ClaudeCode审核者接入/code/2026-09-18-M9-ClaudeCode审核者接入-r3-response-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":15,"grep":7,"glob":0,"run_command":0,"project_reads":12}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
