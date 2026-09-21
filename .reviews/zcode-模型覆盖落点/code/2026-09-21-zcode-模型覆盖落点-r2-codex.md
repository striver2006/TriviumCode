---
schema: trivium.review.v1
topic: zcode-模型覆盖落点
stage: code
role: codex
vendor: openai
agent_cli: codex/0.155.1
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260921T132440Z
rerun_index: 2
snapshot_hash: sha256:21f2452802fa99741572984162421694cf22d4329b9b6b73c3cfda4b9856e4e1
blind: true
started_at: 2026-09-21T13:24:41.579Z
finished_at: 2026-09-21T13:42:37.393Z
duration_s: 1076
tool_calls:
  run_command: 42
  project_reads: 26
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 3
  nit: 2
degraded: false
parse_fallback: false
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0c423-e4a7-7ac3-b4ee-b42a7d2737a1
---

# 代码审查：zcode-模型覆盖落点

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260921T132440Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

r1 十一条落点逐条对得上代码：三键+两凭据键在旗标探针/version 探针/探针臂三条路径确实同形整包接收、探针臂三分判定与白名单重建均落地，run() 正/负/null 三格与 code-stage 桩侧缺席断言都在且能咬。但留下四个缺口：①探针臂在装了 ZCode.app 的机器上会被 preflight.test 的 probeZcode 回归用例真实拉起，且 `model_override==='config_copy'` 的断言由写死值翻为依赖本机 CLI 现势——假绿与因环境翻红同时成立；②探针臂「无 v2 + 停在模型层 ⇒ 有定论 global」一支把本轮白名单重建自己的输入形态问题归因给 CLI，与应答件「缺键只是可见的导入不成」的裁决依据相抵；③探针臂比对用整串等式，与本轮刚裁决的「判据只看 modelId 段」两份口径并存；④probeZcode 那一行接线（只读参数透传 + null 保旧值）无任何用例咬住。核心路线 L 的实现本身我未发现运行期缺陷。

**结论**：`request-changes`

## 审查意见（共 6 条：重要 1 ｜ 次要 3 ｜ 吹毛求疵 2）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts:709-721 与 test/unit/preflight.test.ts:405-423` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | medium |

**问题**：探针臂实测化后，`probeZcode` 的「--no-model-calls 保留上一次 zcode 结论」回归用例在装有 ZCode.app 的机器上不再走 entry 缺席的早退：`ENTRY_CANDIDATES` 第一个候选是绝对路径 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`（不随测试进程的 HOME 偏移），本机真实存在（已核实），且 `~/.zcode/cli/config.json` 存在使 `cliConfigured` 为真——于是这条单元测试会真实拉起版本探针 + 七次旗标候选 + 本次新增的 `probeModelOverride` 臂，并读真实用户配置。更关键的是断言 `probe.model_override === 'config_copy'` 的成立方式变了：改动前 `probe.model_override` 被写死为 `config_copy`（HEAD probes/zcode.ts:617），断言恒绿；改动后它由本机 CLI 现势决定，恰与 existing 里的 'config_copy' 巧合同值——preservation 语义在探针判得出的机器上根本没被测到，而一旦桌面端把 CLI 状态弄坏（EV-87 记的正是当天 17:56 重写那类事故）或探针合法判出 `global`，单元测试无代码改动即翻红。

**依据**：读了 src/trivium/probes/zcode.ts（:47 ENTRY_CANDIDATES 含绝对 /Applications 路径、:547-721 probeZcode 全流程与 `if (mo.override !== null) probe.model_override = mo.override`）、test/unit/preflight.test.ts:405-423（existing 带 model_override:'config_copy' 并断言该值）、`git show HEAD:src/trivium/probes/zcode.ts`（旧版 :617 写死 'config_copy'）；本机 `ls /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs` 实际存在。未执行测试核实（沙箱只读），但触发链全部是静态可读的。

**建议**：给 `probeZcode` 的 opts 增一个测试注入口（跳过/替换 `probeModelOverride` 与旗标臂，或允许注入 `cliConfigured` 判定），让该回归用例只测「本轮未判定 ⇒ 保留旧值」的语义本身；并让 existing 的 model_override 取一个与真实臂结果必然不同的哨兵值，假绿即现形。旗标臂七次真实拉起是既病，可顺带一并处理。

### CODEX-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts:458-462（无 v2 + 命中 ZCODE_ARGV_PARSED_RE ⇒ `global`）与 :334-353 buildProbeCliConfig` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：探针臂的输入与审查运行的输入**不同形**：审查运行把 `cli/config.json` 整份抄进副本（`prepareZcodeHome`），探针臂换成白名单重建（只留 name/kind/source/enabled/models + options.baseURL + 哨兵）。若某台机器的配置里存在 legacy 导入实际需要、但不在白名单的键，导入不发生，CLI 照旧停在模型/鉴权层——探针臂会把**本轮探针自己的输入裁剪**记成有定论的 `global`，probeZcode 随即出「本机 CLI 版本下 config_copy 档未生效……请核对 ZCode 版本与 P-31」的 ⚠️，而审查运行可能实际仍生效。这与 r1 应答件子项 03 的裁决依据「漏掉一个该留的键只会让导入不成（可见）」相抵：它可见，但以对本轮装置失败下断言的形式可见；且与本轮刚修的「未判定 ≠ 判成了没生效」双义同型。「真实 CLI 复跑仍判 config_copy」只对本机配置形态（n=1）证明了白名单够用。

**依据**：读了 src/trivium/probes/zcode.ts 的 buildProbeCliConfig / probeModelOverride 全函数与三分判定、src/trivium/adapters/zcode.ts 的 prepareZcodeHome（整份拷贝对照）、.reviews/zcode-模型覆盖落点/code/2026-09-21-zcode-模型覆盖落点-response-claude.md §二子项 02/03 的裁决文本。

**建议**：至少把该支的 `why` 与 ⚠️ 文案改成不承诺 CLI 行为的措辞（「白名单重建的副本未触发 legacy 导入——可能是 CLI 改了流程，也可能是探针裁剪掉了导入需要的键」）；更实的方向：该支出现时补跑一臂「保键骨架、字符串值换哨兵」的同形副本做区分，两臂同败才下 `global`。不指定实现。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts:452-456（`observed === q.qualified` 整串等式）` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：探针臂判「CLI 写出的 defaultModelSelection 是不是请求模型」用**整串**等式，而本轮在 run() 侧刚裁决并写进文档/RUNBOOK 的口径是「providerId 有两种形态并存，判据只看 modelId 段（`zcodeModelTail`），整串等式会把已生效的覆盖误报成未生效」。同一事实两份判据：若某次 CLI 迁移把 providerId 写成别名/UUID 形态而 modelId 仍是请求值，探针臂记有定论的 `global` 并覆盖结论文件，run() 侧却判 `true`——doctor 结论与留痕互相矛盾，且探针臂正是 EV-82 结案判据引用的证据来源。

**依据**：读了 src/trivium/probes/zcode.ts（probeModelOverride 的比对行与注释）、src/trivium/adapters/zcode.ts 的 zcodeModelTail / decideModelOverride 及其「整串等式会误报」的裁决理由、doc/06_deployment/RUNBOOK_pipeline_ops.md 新增行（「判据只看 modelId 段——两种 providerId 形态并存，前缀不同不算问题」）。

**建议**：探针臂比对改用同一个 `zcodeModelTail`（modelId 段相等 ⇒ config_copy，providerId 形态差异落 `why` 当 note），与 run 侧单一口径；或明确论证「写出的 v2 文件里 providerId 必与副本源同形、整串等式在配置层合法」并把这个区分写进注释，别让两份判据并存在没有说明的状态。

### CODEX-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts:713` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：焦点四的直接回答：`probeZcode` 里给探针臂接线的这一行——传 `readonlyArgs: readonlyArgsFromProbe(probe.readonly_flags)`、`mo.override === null` 时不覆盖结论、`global` 时出 ⚠️——本身没有任何用例咬住。探针臂的用例全部直接 import `probeModelOverride` 并显式传参；删掉接线里的 `readonlyArgs`（零配额护栏从 doctor 路径静默消失）、或把 `if (mo.override !== null)` 改成无条件覆盖（「未判定保旧值」语义被抹），现有 1557 条在没装 ZCode 的机器上全绿；装了 ZCode 的机器上则退化为 CODEX-01 说的环境耦合执行，不是钉住。

**依据**：grep 了 test/ 全部 `probeModelOverride` 引用（只在 test/unit/zcode-model-selection.test.ts:525-612 被直接调用）与 `probeZcode` 引用（test/unit/preflight.test.ts:406-423 是唯一一处，且其断言与 note/global 支均不核对）；读了 src/trivium/probes/zcode.ts:660-721。

**建议**：与 CODEX-01 同一注入口解决：探针臂臂函数做成可注入后，加一条「probeZcode 把本轮 readonly_flags 经 readonlyArgsFromProbe 递给臂、臂判 null 时结论不动」的桩用例。

### CODEX-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/zcode-provider-env.test.ts:495-519（version 探针清键用例）` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：用例标题声明「两个 provider 键、三个目录键、两个凭据键一律进不了子进程」，实际预置并断言的只有 builtin/personal/dataBase/apiKey 四项——`ZCODE_HOME`、`ZCODE_STORAGE_DIR`、`ZCODE_BASE_URL` 三个键在这两条探针调用点上没被预置也没被断言，调用点漏清其中任何一个（正属本轮 r1 抓的「整包 spread 被改回手拼」变异形态）不会让这条用例翻红。旗标探针那条用例标题与预置一致，无此问题。

**依据**：读了 test/unit/zcode-provider-env.test.ts 的 FAKE_ENTRY_SOURCE（日志字段只有 builtin/personal/home/dataBase/apiKeyEnv）与 version 探针用例全文、src/trivium/probes/zcode.ts:84-95。

**建议**：假入口日志补 `zhome`/`storage`/`baseUrl` 三字段，两条探针用例的预置表按 `ZCODE_DIR_ENV_KEYS + ZCODE_CREDENTIAL_ENV_KEYS` 全量派生，让标题与覆盖面重新同形。

### CODEX-06 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/08_project/BACKLOG.md（EV-91 与 EV-93 之间）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | low |

**问题**：本轮新登记直接跳号到 EV-93，EV-92 在全仓（含设计与应答件）无任何记录。台账号跳而不注，后来的人无法分辨「登记过又撤销」还是「漏了」——这恰是 BACKLOG 作为唯一编号面要避免的读感。

**依据**：grep 'EV-92' doc/ src/ test/ 零命中；读了 doc/08_project/BACKLOG.md 的 EV-87～EV-93 各条与设计 §21 v1.3.33 行（其中只提「新登记 EV-93」）。

**建议**：在 v1.3.33 台账或 EV-93 条内加一句 EV-92 的去向（被并/被撤的编号也值得留痕）。若编号是刻意预留，同样写一句即可。

## 认为正确的部分

- r1 应答件 §三的十一条落点逐条核到代码：①旗标探针整包 spread `zcodeProviderEnv(entry, undefined, {omitPersonal:true})` + `ZCODE_CREDENTIAL_ENV_KEYS` 清除，目录键与凭据键确实「在场且 undefined」，与探针臂 env 同形（exec.ts:110-112 确认删除语义按「值为 undefined 的键」执行，键缺席即透传——用例链依赖的这条前提成立）；②version 探针按同口径清七键；③三分判定四形态归位正确：崩溃（退 137 无输出）→ 未识别支 null、超时 → null、内置定位失败 → null（排在 code-null/超时之后、ARGV_PARSED 之前，顺序无洞）、模型层停且无 v2 → global、写出 v2 → 比对定论；④白名单重建 + 假入口「非哨兵即退 99」+「副本里不出现夹具源非白名单字符串值」双断言到位；⑤run() 负格（字段缺席）、正格 true/false、null 格与 code-stage 桩侧缺席断言齐备，且去掉产出条件展开即翻红，确实咬得住；⑥三处 `provider_config_copy`/`personalOverride`/`hasEffective` 残留 grep 清零（仅 §21 台账行留有历史叙述，属应留）；⑦三份凭据载体清单与 scrub 幂等用例、`zcodeHomeUnder` 注释合并均落地。
- `qualifyAgainstCliConfig` 的七格（裸名唯一/零个/多个命中、全限定、UUID 前缀负格、空段）与 r3 CODEX-03 的活缺陷对得上；`decideModelOverride` 四态语义与 types/review/guard 三处注释一致，条件展开在 review.ts 与 guard.ts 两端同形。
- 留痕一致性：设计 §21 v1.3.33 第八段、BACKLOG EV-82 改判与结案文本、M0 P-28 机理补记/P-31 改判、RUNBOOK 四行新表目，与代码行为逐段对得上；EV-87～EV-93 的登记与 §3.3「仍在的边界」自洽。

## 未覆盖范围（本侧盲区）

- 未执行 `npm run check` / 变异验证（沙箱只读）；1557/1555/2 的计数与「六条变异全部咬住」按留痕采信。
- 未进 ZCode.app 包内源码复核 `FZi`/`importLegacy`/`Mqa`/`isSelectable` 等字面（CODEX-02/03 是从本仓两份判据的互相矛盾推出的，不是包内结论）；「白名单是否真的覆盖 legacy 导入全部所需键」在包内无独立核实。
- 真实 CLI 上探针臂复跑仍判 config_copy 的说法未复验（无写权限、不动用户环境）。
- gemini 侧任何意见按禁读清单未触碰；另一位审查员本轮可能覆盖同一角落，属背靠背设计内。
- 未逐字段核 `gate.ts`/`meta.ts` 对 run.v2 新可选字段的消费与校验面（仅确认 schema 声明与 review.ts 写侧）；其余三家适配器的 model_override_applied 落点按 EV-91 明示未接线，未审。

## 实际查阅的项目文件

- `src/trivium/adapters/zcode.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/guard.ts`
- `src/trivium/review.ts`
- `src/trivium/types.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/adapters/stub.ts`
- `src/trivium/selftest.ts`
- `test/unit/zcode-model-selection.test.ts`
- `test/unit/zcode-provider-env.test.ts`
- `test/unit/preflight.test.ts`
- `test/integration/code-stage.test.ts`
- `skills/dual-critic/schema/review.v1.json`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/08_project/BACKLOG.md`
- `.reviews/zcode-模型覆盖落点/code/_meta/changes-20260921T132440Z.diff`
- `.reviews/zcode-模型覆盖落点/code/2026-09-21-zcode-模型覆盖落点-response-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":42,"project_reads":26}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
