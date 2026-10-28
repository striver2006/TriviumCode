---
schema: trivium.review.v2
topic: QoderCN只读审核准入与Custom模型接入
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
run_id: 20261028T063910Z
rerun_index: 4
snapshot_hash: sha256:8963a8ea81e49a2aacb42a01fca62341b1f5cbfb62bc301a92d996e40e45872f
blind: true
started_at: 2026-10-28T06:39:20.983Z
finished_at: 2026-10-28T06:56:23.085Z
duration_s: 1022
tool_calls:
  read: 19
  grep: 17
  glob: 0
  run_command: 0
  project_reads: 29
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 1
  minor: 2
  nit: 2
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
session_id: sess_ade524e5-a0d7-43a9-962b-da2a5c67bbde
---

# 代码审查：QoderCN只读审核准入与Custom模型接入

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261028T063910Z` ｜ 第 4 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本轮新增的生产执行边界、组合准入台账、凭据租约与轨迹解析总体结构严谨：环境白名单以 qoderRun 强制 replace 收口了我 r3 提出的叠加基线时点缺口并有真实子进程 canary 回归；admission.v1 遵守两段式纪律（形状 schema 加注册表身份，无身份枚举），requireAdmission 的冻结、唯一性、TTL、证据 hash 与路径安全（拒绝对路径、.. 与符号链接）均有穿越反例单测；CODEC_CHILD 只回传选中条目且全部解密参数值入护栏；退出 0 但缺回读仍判失败有集成测试；registry 三开关保持 false，worker 冻结交接经隔离复制树真实两进程测试验证且确认测试构建不回写生产注册表。发现一个 major：doctor/探针路径注册的凭据租约 side_dir 为 null，而唯一的回收入口 scrubRunDir 只以运行侧目录字符串调用，reapCredentialLeases 对 side_dir 不匹配的租约静默 continue，探针被强杀后含认证副本的私有根与租约文件永久无人回收，违背租约先落盘、失联按身份核验回收的自身承诺。另有准入绑定未覆盖生产 deny 路径集、custom 路线每次审核双重 codec 提取的性能成本、admissionHash 的 locale 依赖排序与探针硬编码 route_labels 四条非阻断意见。按意见修复上述 major 与相应 minor 后即可实施，无需再审一轮。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 5 条：重要 1 ｜ 次要 2 ｜ 吹毛求疵 2）

### GLM-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/util/credential-lease.ts:31,71；src/trivium/probes/qoder-cn.ts:22,59；src/trivium/scrub.ts:380` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | high |

**问题**：doctor/探针路径产生的凭据租约没有回收方。probeQoderCn 与 probeQoderCustom 的 withQoderHome 不在 withCredentialLeaseScope 内调用，registerCredentialLease 写入的租约 side_dir 记为 null；而 reapCredentialLeases 的唯一调用点是 qoderCnAdapter.scrubRunDir，其 sideDir 参数由 scrubSideDir 以运行侧目录字符串传入（恒非 null），过滤条件 l.side_dir!==sideDir 使 side_dir 为 null 的租约永远被 continue 静默跳过，且不产生任何告警。本主题生命周期取证已把强杀列为真实场景：doctor 探针被 SIGKILL 后，withQoderHome 的 finally 不执行，含真实认证副本（.qoder-cn/.auth/user 与 machine_id，0600）的私有临时根与租约文件将永久残留并随每次异常终止积累，违背复制凭据前登记持久租约、失联监督方按身份核验回收的设计承诺。

**依据**：src/trivium/util/credential-lease.ts 第 31 行 side_dir 取 scope.getStore()?.sideDir??null，第 71 行 if(l.agent!==agent||l.side_dir!==sideDir)continue；src/trivium/probes/qoder-cn.ts 第 22、59 行两处 withQoderHome 均无 scope 包裹；grep 证实 src 内 reapCredentialLeases 仅 qoder-cn.ts:101 一处调用且 scrub.ts:380 的 sideDir 恒为运行侧目录字符串，不存在以 null 调用的入口；withCredentialLeaseScope 仅在 qoderCnAdapter.run 内使用。

**建议**：为探针路径提供回收出口：或在 doctor 段（以及任何 withQoderHome 的非运行调用方）结束时以 sideDir=null 调用一次 reapCredentialLeases，或给 registerCredentialLease 增加显式的调用来源标识并在 scrubRunDir 之外提供全量失联回收入口；同时建议 reap 对同 agent 但 side_dir 不匹配的租约至少聚合一条告警，避免静默积压。修复后补一条 doctor 强杀后 null 租约可被回收的回归测试。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/admission.ts:19-24；src/trivium/adapters/qoder-cn.ts:138-139；src/trivium/adapters/qoder-cn-custom.ts:13` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：准入绑定不包含生产运行的 deny 路径集。admissionRouteBinding 只绑定 agent、model、platform、arch 与 native facts；invokeQoderModel 每次运行的 readonlyDenyPaths 由编排器禁读矩阵派生（deny_paths 加台账文件），可随角色与文件增减变化；隔离配方指纹 qoderIsolationHash 对 deny 只含静态版本串 project-read-deny-native-roots-v1。结果是同一台账在不同禁读矩阵下复用：矩阵变化不触发重验，路径级拒绝保证完全依赖采集时三类目标路径上验证过的规则机制外推，台账无法表达本次准入覆盖哪些禁读路径。

**依据**：src/trivium/admission.ts 第 19-24 行 binding 字段清单无 deny 相关项；src/trivium/adapters/qoder-cn.ts 第 138-139 行 readonlyDenyPaths 逐运行由 req.deny_paths 派生；src/trivium/adapters/qoder-cn-custom.ts 第 13 行配方串仅含 readonly.version 与 allowed/denied 工具名，不含路径集。

**建议**：把生产 deny 集（或其确定性 hash）纳入 admissionRouteBinding，或写入台账记录并在消费时与本次 req.deny_paths 复核：集超集变化即拒绝并要求重新准入，使路径级保证不再依赖隐式外推。

### GLM-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn.ts:51,134；src/trivium/adapters/qoder-cn-custom.ts:73-86,118-124` |
| 类别 | performance ｜ 层次 code |
| 置信度 | high |

**问题**：custom 路线每次审核派生做两次完整 codec 提取与解密子进程：run() 先经 verifyQoderBinding 用真实入口调 loadQoderCustom（含 codec 提取与短命子进程重加密），紧接着 invokeQoderModel 在隔离 home 内用私有副本再调一次。每次 extractQoderCodec 都在 110MB 偏移后的全文上做 toString、正则 matchAll 与逐候选 WebAssembly.Module 编译试探，内存峰值与时延在单次审核内双重发生；第二次调用的 expected 比对已由第一次的 descriptor 深比与 cli_sha256 钉死，语义上接近重复劳动。不改变判定结果，但生产开启后每轮三审乘以每个审查调用的成本可观。

**依据**：src/trivium/adapters/qoder-cn.ts 第 134 行 verifyQoderBinding 与第 51 行 loadQoderCustom(executable,...) 在同一 run() 内先后执行；qoder-cn-custom.ts 第 75-84 行每次调用都做 marker 搜索、subarray(110000000).toString() 的 matchAll 与逐候选 wasm 编译，第 118-124 行每次都起 CODEC 子进程。

**建议**：在单次 run() 内复用 verifyQoderBinding 已取得的 selection（例如以 facts 加缓存键在同一执行边界内传递），或将 codec 提取物按 cli_sha256 短期缓存，使每次审核至多一次提取与一次子进程；保持两处独立绑定的验证语义不变。

### GLM-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/admission.ts:11-16` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：admissionHash 的 canonical 排序使用 localeCompare，排序结果依赖运行环境的 locale 与 ICU 数据。record_sha256 由父进程冻结、worker 复核，当前同机同 ICU 下一致；但 Node 升级或 ICU 变化后同一记录可能得到不同 hash，冻结比对出现假阴性（误报记录已变化）。用码点序即可获得与环境无关的确定性。

**依据**：src/trivium/admission.ts 第 13 行 Object.entries(value).sort(([a],[b])=>a.localeCompare(b))。

**建议**：改为按码点比较（如 a<b?-1:a>b?1:0）或显式 locale 参数，使 canonical 序在跨版本环境间稳定。

### GLM-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/qoder-cn.ts:66,78` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：probeQoderCustom 把 route_labels 硬编码为 Auto 与 Fast，而官方路线的 routeLabels 来自实测目录 parseQoderCatalog。若某 CLI 版本对 custom 目录不含这两个路由标签，写入 facts 的 route_labels 是未经回读的断言（monitor 的 custom 分支不消费它、validateQoderFacts 也不校验），与同对象内记录真实目录输出的 catalog_raw_sha256 口径不一致，落进 run.v3 后成为无证据字段。

**依据**：src/trivium/probes/qoder-cn.ts 第 66 行 new QoderModelMonitor(descriptor.selector,['Auto','Fast'],[],descriptor)，第 78 行 routeLabels=['Auto','Fast']；对照第 37-39 行官方路线从 parsed.routeLabels 取值。

**建议**：从 custom 隔离目录的实测输出解析路由标签（与官方同源），解析不出则如实记空数组或拒绝，不硬编码。

## 认为正确的部分

- qoderRun 强制 envMode replace 并要求显式 HOME 与 QODERCN_CONFIG_DIR，配合 qoderChildEnv 的全量 undefined 补丁，正确收口了我 r3 GLM-01 的叠加基线时点缺口；集成测试以构造后新增父键的 canary 证明 replace 阻断、公共 merge 行为不变、undefined 删除兼容，三层语义各有断言。
- admission.v1 采用形状 schema 加注册表身份的两段式（schemas.ts validateAdmission 以 isAgentId 追加校验，schema 内无 Agent 枚举），符合纪律 12；requireAdmission 对冻结引用先比对再验证、同组合记录必须唯一，storeAdmission 持全局锁原子替换并覆盖同键旧记录。
- 准入证据边界闭环：拒绝绝对路径与 .. 段、realpath 一致、必须在项目根内、逐件 sha256 复核，单测覆盖路径穿越与符号链接替换反例；tested_at 不得晚于原件最早时间、expires_at 受 tested_at 加 TTL 约束、未来时间拒绝。
- CODEC_CHILD 桥接协议 fail-closed：只回传唯一选中条目、字段白名单校验、parameters 仅允许 api_key、全部解密参数值并入秘密集，AES-256-GCM 传输密封且 transport 用后擦除；声明回传后再次 scrub 自检防止凭据随声明落盘。
- 凭据租约协议设计正确：复制认证前先落盘租约与目录独占标记，回收方按所有者身份（PID 加 lstart）、进程组全部退出、父目录边界与标记内容四重核验后才清理，集成测试用真实两进程加 SIGKILL 验证强杀后租约仍在、活组阻止删除、标记篡改拒绝回收。
- 退出 0 失败判定链完整：monitor 首因粘滞、回退文本与标签变化分列、stop_observation 记录通道与是否已见 result；退出 0 且 result 成功但无模型回读仍判失败、custom 缺 init 或计费命名空间回读仍判失败，均有集成测试锚定。
- parseQoderTrace 按调用 ID 严格配对、区分 permission-rule、permission-mode、tool-unavailable 与 unknown，权限事件必须对应失败结果；qoderTraceEvidence 对白名单外尝试一律计入 write_events 不因被拒绝而豁免。
- 准入生成器默认仅输出候选评估，全部必需项通过且显式 --write 才写项目台账，未测项记 untested 并阻塞；registry 的 criticEnabled、defaultSelected、driverEnabled 保持 false，集成测试确认隔离复制树中的开关修改不回写生产注册表。
- Custom 身份消歧严格：custom:provider/model 选择器必须唯一精确匹配、路径段拒绝点号、裸 provider/model 不回落官方同名、官方裸名兼容保留；Custom 底层 model 与 provider 保持 null 与 unverified，可调用事实与组合准入分离的口径贯穿文档与代码。

## 未覆盖范围（本侧盲区）

- 只读审查，未运行 typecheck、build 或 npm test；报告宣称的 4132 通过、9 跳过、0 失败未独立复跑，相关结论均基于静态读码。
- changes.diff 全文约 31k 行未逐行读完：文档与 schema 段经 diff 头部核对，证据 JSON 原件仅经测试回放（qoder-cn-trace.test.ts 引用的 06:20 与 05:55 两件）间接核对，admission-evaluation、manifest、lifecycle 及其余批次原件未逐件打开。
- 必读清单中 CLAUDE.md、README.md、doc/README.md、doc/01_requirements/README.md、doc/02_design/README.md、REPORT_2026-10-28_QoderCN官方模型路由与回退阻断.md、KimiCode与QoderCN双角色接入实施计划.md 全文、plan r4 原稿未读或仅经任务书与 diff 描述触及；review.ts、run-protocol.ts、preflight.ts、doctor.ts 只 grep 了 admission 与探针相关段落。
- 采集器脚本 qoder-custom.mjs、qoder-readonly.mjs、qoder-lifecycle.mjs、qoder-index.mjs、qoder-evidence.mjs 本体本轮未整读（r3 读过旧版，本轮经 README、qoder-secrets.test.mjs 与 diff 描述间接核对），GLM-02 涉及的 deny 集与采集时目标路径的对应关系据此保守评级。
- Windows 行为（env 大小写、tmpdir 语义、盘符路径）、真实 Qoder CLI 的 codec 布局匹配、ajv 对 run.v3 与 admission.v1 的实际编译、secrets.ts redactSecrets 的模式集内容均未执行验证，相关判断是静态推理。
- reapCredentialLeases 与 stopQoderHomeHelpers 在真实失联监督路径（lost-worker 处置）下的端到端行为未实测；GLM-01 的回收缺口结论基于调用图穷举（src 内 grep 证实唯一调用点），未构造强杀 doctor 的复现实验。

## 实际查阅的项目文件

- `.reviews/QoderCN只读审核准入与Custom模型接入/code/_meta/changes-20261028T063910Z.diff`
- `src/trivium/adapters/qoder-cn-custom.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/adapters/qoder-cn-admission.ts`
- `src/trivium/adapters/qoder-cn-trace.ts`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/admission.ts`
- `src/trivium/util/credential-lease.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/util/fsx.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/preflight.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/schemas.ts`
- `src/trivium/scrub.ts`
- `src/trivium/types.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/doctor.ts`
- `skills/dual-critic/schema/admission.v1.json`
- `skills/dual-critic/schema/run.v3.json`
- `scripts/acceptance/kimi-qoder-cn/qoder-admission.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-secrets.test.mjs`
- `test/unit/admission.test.ts`
- `test/unit/qoder-cn-custom.test.ts`
- `test/unit/qoder-cn-trace.test.ts`
- `test/unit/qoder-secret-values.test.ts`
- `test/integration/credential-lease.test.ts`
- `test/integration/qoder-cn-routing.test.ts`
- `AGENTS.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":19,"grep":17,"glob":0,"run_command":0,"project_reads":29}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
