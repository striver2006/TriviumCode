---
schema: trivium.review.v2
topic: QoderCN官方模型路由与回退阻断
stage: code
role: glm
vendor: zcode
agent_cli: zcode/0.17.0
model_requested: GLM-5.3
model_effective: bigmodel-coding-plan/GLM-5.3
model_effective_source: trace
effort_requested: null
effort_effective: null
effort_effective_source: null
tier: null
tier_source: legacy
model_route: config_copy
run_id: 20261027T235110Z
rerun_index: 2
snapshot_hash: sha256:d780bd232f999b20cba54a9938564b9ee2844e3c095d379b61650e2ee207b113
blind: true
started_at: 2026-10-27T23:51:19.919Z
finished_at: 2026-10-28T00:01:22.769Z
duration_s: 603
tool_calls:
  read: 14
  grep: 13
  glob: 1
  run_command: 0
  project_reads: 17
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 0
  minor: 3
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
  - left: codex
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
  - left: glm
    right: claude
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: claude-opus-5-5
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / claude
override_reason: 左侧模型信息缺失
session_id: sess_e3f401fb-4ede-433f-b4fb-876e625c9075
---

# 代码审查：QoderCN官方模型路由与回退阻断

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261027T235110Z` ｜ 第 2 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

修订版把上一轮六条意见全部落地且形态正确：stopQoderHomeHelpers 以 ps -p 区分「已自行退出跳过」与「在位不可核实」，alive 用 sameProcess 防 PID 复用误杀（GLM-01）；绑定漂移四路负例加 settings/入口文件/configuredBin 实体变更全覆盖且断言未派生（GLM-02）；探针默认声明改用首个 init 标签与目录互证、后续具体身份披露不固化默认（GLM-03）；run() 改为 isDeepStrictEqual 全字段重推导比对（GLM-04）；source=config 有了真实生产者且 validateQoderFacts 要求 config 时 observed_user_model 与声明一致（GLM-05）；JSON 语法错误已包裹为带上下文的类型化错误（GLM-06）。焦点七项与计划 r2 逐条对齐：目录单列格式+语义 hash 拒未知形态；config 来源由目录内原生配置的隔离真机显式验证产出；请求（facts/requested/override/origin）、声明（model/source/observed_user_model）、回读（labels/usage_labels/envelope）三面独立；stdout/stderr 双通道流式回调首现即 stopEarly、末尾无换行由复盘兜底且有真机失败样本回归锚；退出 0 伴回退判 failed 且 review_json 为空、结论不计票；Auto 披露具体身份不判回退、计费键仅目录已知者互证、未知键单列不推别名；wiredAdapter 接入真实适配器且 registry 双开关关闭、集成测试反向断言生产注册表未回写。本轮剩四条小问题：无效档位不回落 probe_default 缺断言锚、新增契约字段 stop_observation 无内容断言、回退与原生结果错误并存时 fail_reason 被次要原因抢占、清理失败细节在证据中退化为泛化文案。无 blocker/major，按意见修改后即可实施。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 4 条：次要 3 ｜ 吹毛求疵 1）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/qoder-cn-model.test.ts:41（配合 src/trivium/adapters/base.ts:2046-2058）` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：「无效档位不得回落原生默认」是计划 r2 第4节的明文约束（显式空值/无效档位不落默认），其实现完全依赖 resolveTier 的 if-else 链：cli.tier / profile {tier} / agent.default_tier 分支被取走后 fromTier 返回 null，probe_default 分支在同一链尾不再可达。但回归锚只断言了 missingTier?.name==='high'，没有断言 model 为 null 或 tierSource 不是 probe_default——若将来把该链改成「fromTier 为 null 就继续向下穿透」，missingTier 照样被置位，这条断言仍然通过，无效档位会静默落到原生默认并带着 probe_default 来源进入请求快照。空格子的不回落有 model===null 断言钉住（同用例第39-40行），坏档位这一半没有。

**依据**：src/trivium/adapters/base.ts:2046-2058（if-else 链：base = fromTier(cli.tier,'cli') 赋 null 后不再走 cell === undefined && nativeDefault 分支）；test/unit/qoder-cn-model.test.ts:39-41（空串断言 model 为 null，坏档位仅断言 missingTier 名称）；.reviews/QoderCN官方模型路由与回退阻断/plan/2026-10-28-QoderCN官方模型路由与回退阻断-r2-codex.md 第4节「显式空格子/坏 tier 不落默认」。

**建议**：在该用例补一行断言：resolveTier(cfg,'qoder-cn','plan',{tier:'high'},{kind:'resolved',model:'Auto'}) 的 model 为 null 且 tierSource 非 probe_default；顺手为 profile 格子坏档位与 agent.default_tier 坏名各补同形态断言。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/integration/qoder-cn-routing.test.ts:60-69（契约定义在 src/trivium/adapters/qoder-cn.ts:28,41 与 skills/dual-critic/schema/run.v3.json:1619-1650）` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：本轮新增的运行证据字段 stop_observation（channel/after_result/elapsed_ms）是 PROTOCOL「停止时是否已见 result 必须如实记录」承诺的唯一载体，schema 已将其列为 nativeResult 必填，但全部单测与集成测试没有任何一处断言其内容：分块告警用例只断言 ok=false 与 earlyStopped=true，退出0回退用例只断言 fail_reason 与 override。after_result 若被写反（例如误取 !monitor.sawResult）、channel 若恒为 final、复盘兜底分支（qoder-cn.ts:41 的 channel:'final'）若永远不触发，现有测试全部保持绿色。首因粘滞、双通道、计费键互证都有正反锚，唯独这个新字段是裸契约。

**依据**：test/integration/qoder-cn-routing.test.ts:60-69（仅断言 r.ok/r.outcome.earlyStopped/marker）与 45-58（仅断言 status/exit_code/fail_reason）；test/unit/qoder-cn-model.test.ts 全文无 stop_observation；skills/dual-critic/schema/run.v3.json:1619-1650（stop_observation anyOf 三键 required）；src/trivium/adapters/qoder-cn.ts:28（流式首现写入 channel/after_result）、:41（复盘兜底 channel:'final'）。

**建议**：补两三个真实执行边界用例：告警先于 result 事件（after_result=false、channel 为对应流）、result 事件先于告警（after_result=true）、告警仅在末尾无换行处由复盘发现（channel='final'），各自断言 stop_observation 三字段。

### GLM-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn.ts:42-43 与 :85` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：executionFailure 三元链的末段 monitor.resultError?'Qoder CN 原生结果失败':null 没有加 !monitor.failure 守卫（前几段都有），而适配器侧 fail_reason 取值顺序是 execution_failure??failure??verification_failure。于是在同一次运行里既有模型回退（failure 非空，例如先收到 is_error 的 result 事件、随后 stderr 才吐出回退告警——这正是 stop_observation.after_result=true 所刻画的时序）又有原生结果错误时，侧级失败摘要显示「Qoder CN 原生结果失败」，本主题的立题事实（模型回退）从 run.json 的 fail_reason 里消失，只能去 trace.json 的 native_model.failure 翻找。判定本身不受影响（status 仍 failed、退出0仍失败、结论不计票），证据也完整保留，但回退首因在人工对账的第一入口被次要原因遮蔽。

**依据**：src/trivium/adapters/qoder-cn.ts:42-43（resultError 分支无 !monitor.failure 前置，其余分支均有）；src/trivium/adapters/qoder-cn.ts:85（reason: execution_failure??failure??verification_failure）；src/trivium/adapters/qoder-cn-model.ts:106-108（resultError 在 result 事件 is_error===true 或 subtype!=='success' 时置位，与 failure 可同时为真）。

**建议**：fail_reason 的取值链改为 failure 优先（failure??execution_failure??verification_failure），或给 resultError 分支补 !monitor.failure 守卫使回退在场时 execution_failure 保持 null；两者取其一即可，无需双改。

### GLM-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn.ts:33（源头 src/trivium/adapters/qoder-cn-native.ts:73-79）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：withQoderHome 的 finally 用 AggregateError 聚合清理失败，message 是固定的「Qoder CN 临时环境清理失败」，具体是删认证失败、辅助进程身份不可核实还是临时目录清理失败只存在于 errors 数组里；invokeQoderModel 捕获后仅取 (e as Error).message 存入 cleanupFailure，随 execution_failure 落进 trace.json。排障时从证据侧只能看到泛化文案，三个来源不可区分（该 AggregateError 被正常捕获，细节也不会出现在任何日志里）。

**依据**：src/trivium/adapters/qoder-cn-native.ts:73-79（三处 errors.push 后 throw new AggregateError(...,'Qoder CN 临时环境清理失败')）；src/trivium/adapters/qoder-cn.ts:33（catch 中 cleanupFailure=(e as Error).message，errors 数组被丢弃）。

**建议**：捕获处对 AggregateError 展开 errors 数组、以「; 」拼接各条 message 后再存 cleanupFailure（原生 Error 维持现状），让证据里的 execution_failure 直接指明清理环节。

## 认为正确的部分

- 上轮 GLM-01 清理竞态修复正确：start 返回 null 时先以 ps -p 核对在位，不在位即视为已自行退出跳过；存活者经 sameProcess（lstart 比对）确认同一进程才发信号，PID 复用不误杀；注入接缝回归用例三态（已退出跳过/复用不杀/确认同进程 SIGTERM）钉住行为。
- 上轮 GLM-02 修复到位：入口 hash、平台、cli_version（经 --version 实调）、configuration_sha256 四路指纹漂移与 settings.json/入口文件实体变更、configuredBin 不一致均参数化负例覆盖，且断言 process_started=false 与 marker 未出现。
- 上轮 GLM-03 修复到位：探针默认声明改用首个 init 标签与官方目录互证（probeQoderCn 以 monitor.initLabel 查目录），后续具体身份披露不固化默认，单测以 Auto/Fast 两形态钉住。
- 上轮 GLM-04 修复到位：run() 以 qoderModelRequest 重推导后 isDeepStrictEqual 全字段比对冻结快照，override/origin 篡改在派生前拒绝。
- 上轮 GLM-05 修复到位：source=config 有了真实生产者——用户原生配置值先在官方目录内找到同名项、再经隔离真机显式 --model 验证，init 标签回读互证后才写 config；validateQoderFacts 并要求 config 来源时 observed_user_model 与声明一致，堵住伪造枚举的路。
- 上轮 GLM-06 修复到位：JSON.parse 语法错误包裹为带「支持注释，不支持尾逗号」上下文的 QoderModelConfigurationError，单测有类型断言。
- 退出 0 伴回退判 failed、review_json 为空、结论不计票：集成测试用本地合成夹具断言 exit_code=0 与 status=failed 并存，单测以 2026-10-27 真机失败样本作回归锚；早停只由 failure 首现触发、末尾无换行由复盘兜底、提前杀的 signal 不覆盖回退首因。
- Auto 请求中途披露具体身份不判回退、effective 取末个非路由标签且来源 envelope、纯路由标签保持 null/unverified；具体请求回读 Auto 或异名即失败、无任何回读时按「未核实」失败——与计划第5节逐条一致。
- modelUsage 未知计费键单列 usage_labels、不推别名，仅目录已知键参与一致性互证且有正（透明键不改判）反（已知异名判失败）单测。
- 请求/声明/回读三面分离落在 nativeRequest（facts/requested/override/origin）与 facts.model/source/observed_user_model、labels/usage_labels 上，requested_routes 快照由 requestRouteSnapshot 统一构造、worker 用 sameRequestedRoute 深比对，键序无关；schemas.ts 交叉校验 native_model.requested 与 model 一致。
- 临时认证副本目录 0700、文件 0600、源为符号链接即拒、Windows 未建 ACL 拒绝复制、子进程 env 清洗与一次性 HOME 隔离保持完整；落盘 stdout/stderr 经 redactSecrets，evidence 只含非敏感字段。
- registry 的 criticEnabled/driverEnabled 保持关闭，集成测试在隔离复制树重打包验证全链路后反向断言生产注册表未回写。

## 未覆盖范围（本侧盲区）

- 只读审查：未运行任何命令，npm run check 与定向/集成测试的通过声明取自测试报告自述，未独立复跑；1.1.80 输出形态（MODEL 单列目录、init 标签、qfmodel 计费键）按既有证据采信。
- stopQoderHomeHelpers 残余理论窗口未构造验证：进程已退出但仍列于 ps 且 lstart 取空（如尚未收割的 zombie）时会抛「身份不可核实」并经 execution_failure 判整侧失败——判定方向 fail-closed，触发概率属代码推理，未实测。
- 陈旧探针（超 TTL）与 availability 拦截的先后只沿 review.ts 注释与 preflight diff 采信（入选侧先过可用性检查再路由），未沿 preflight 全链逐行核验 defaultModelFor 不查 TTL 是否存在绕过 availability 的调用路径。
- run.v3.json 中 voided 数组的大段格式重排未逐行比对，仅确认 nativeRequest/nativeResult/nativeFacts 定义与 route.source 的 probe_default 枚举为语义增改、不含 Agent 身份字面量。
- scripts/acceptance/kimi-qoder-cn 各取证脚本与 kimi-macos 证据文件未逐一审读（属 Kimi 主题，仅经报告与集成测试交叉印证）；CLAUDE.md、README、doc 各 README 通用导读未逐字读。
- execution_failure 与 failure 并存时 stop_observation.after_result=true 的具体时序（result 先到、告警后到）在真实 1.1.80 上是否会发生未验证，GLM-03 的可达性基于流式回调顺序的代码推理。

## 实际查阅的项目文件

- `.reviews/QoderCN官方模型路由与回退阻断/code/_meta/changes-20261027T235110Z.diff`
- `.reviews/QoderCN官方模型路由与回退阻断/code/2026-10-28-QoderCN官方模型路由与回退阻断-glm.md`
- `.reviews/QoderCN官方模型路由与回退阻断/plan/2026-10-28-QoderCN官方模型路由与回退阻断-r2-codex.md`
- `AGENTS.md`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/index.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/config.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/schemas.ts`
- `src/trivium/types.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/agents/registry.ts`
- `skills/dual-critic/schema/run.v3.json`
- `test/unit/qoder-cn-model.test.ts`
- `test/integration/qoder-cn-routing.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":14,"grep":13,"glob":1,"run_command":0,"project_reads":17}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
