---
schema: trivium.review.v2
topic: QoderCN官方模型路由与回退阻断
stage: code
role: claude
vendor: anthropic
agent_cli: claude/2.1.310
model_requested: opus
model_effective: claude-opus-5-5
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: profile
run_id: 20261027T233105Z
rerun_index: 1
snapshot_hash: sha256:8f5c5579ea42fe6e5533b65b2db2de53c10cdb46d42d6e3647901b691ec9c237
blind: true
started_at: 2026-10-27T23:31:13.628Z
finished_at: 2026-10-27T23:42:57.105Z
duration_s: 218
tool_calls:
  read: 13
  grep: 12
  glob: 0
  run_command: 0
  project_reads: 17
evidence_ok: true
verdict: reject
findings_count:
  blocker: 0
  major: 4
  minor: 2
  nit: 1
degraded: false
parse_fallback: false
peer_deny: true
drift: false
readonly_verification: unavailable
heterogeneous: unknown
access:
  requested_mode: native
  profile: null
  launcher_requested: /Users/chenzhenbo/.local/bin/claude
  launcher_effective: /Users/chenzhenbo/.local/bin/claude
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: claude
    status: unknown
    left_model: null
    right_model: claude-opus-5-5
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: gemini
    right: claude
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: claude-opus-5-5
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：gemini / claude
  - left: glm
    right: claude
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: claude-opus-5-5
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / claude
override_reason: 左侧模型信息缺失
session_id: fe00e629-349d-44aa-9a0e-c5dad518eef5
---

# 代码审查：QoderCN官方模型路由与回退阻断

> Critic-D · Anthropic Claude Code ｜ 回读模型 `claude-opus-5-5` ｜ 请求模型 `opus`
> ｜ 运行 `20261027T233105Z`
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最危险的一条：文本回退检测正则与 1.1.80 真机 stderr 告警原文不匹配。真机原文在 instead. 之后还有一句 Use /model to choose another model.，正则以 \s*$ 锚定行尾，所以按 stdout/stderr 文本告警检测这一通道在真机上从未生效。证据里回退失败的首因来自 init 标签不一致，而单元和集成测试用的是去掉尾句的合成文本，把这个问题掩盖了。
同一份真机证据还显示，earlyStopped=true 时 stdout 里已经有完整的 result success，说明 stdout 很可能被块缓冲，这次“早停”发生在模型调用完成之后。报告说的“早停”需要限定。
第二：探针用最后一个标签（labels.at(-1)）而不是 init 标签来确定默认值，并且把请求写死为 Auto。如果 Auto 路由在 assistant 事件里披露具体模型，原生默认就会被固化成具体模型。
第三：计划里的 source=config（已验证的原生官方配置覆盖内置默认）只在类型里声明，探针从不产出，属于未显式说明的计划偏离。
其余是失败原因被“未核实”掩盖、availability 不校验哈希等小问题。worker 用深比较对账交接快照、退出 0 判失败、不计票、未派生无效请求、隔离 HOME 等主干是成立的。

**结论**：不通过（`reject`）

## 审查意见（共 7 条：重要 4 ｜ 次要 2 ｜ 吹毛求疵 1）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-model.ts:87` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：非 JSON 行的回退告警正则锚定为 ...instead\.?\s*$，只匹配在 instead. 处结束的整行。1.1.80 真机 stderr 实际输出是 `Model "trivium-invalid-model" is not available right now; using "auto" instead. Use /model to choose another model.`，尾部多一句，正则不命中。结果是设计/协议里承诺的“双通道原生回退告警立即中止”在真机上只剩信封标签这一路；一旦信封没给出标签或标签恰好等于请求值，回退会漏检。测试用的是截掉尾句的合成文本，这个缺陷被掩盖了。

**依据**：doc/05_testing/evidence/qoder-cn-model-20261028/adapter-2026-10-27T23-27-51-812Z-b0b109.json:256 的 stderr 原文带尾句 Use /model to choose another model.；同文件 :290 和 :356 的 failure 首因是“生效标签与精确请求不符…回读 Auto”，不是“原生模型回退：…”，说明这条告警没有被识别。test/integration/qoder-cn-routing.test.ts（diff 内）的 warning 常量是 'Model "Exact" is not available right now; using "auto" instead.'，不带尾句。adapter-…-53c7c2.json:251 和 bfc302.json:256 是同样的原文。

**建议**：把句式匹配改为匹配已取证前缀（Model "…" is not available …; using "…" instead.），允许后面跟随文本。单测和可执行夹具改用真机原文（含尾句），并加一个“只有告警、信封标签等于请求”的反例，确认文本这一路能独立判失败。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/REPORT_2026-10-28_QoderCN官方模型路由与回退阻断.md:19` |
| 类别 | contract ｜ 层次 rca |
| 置信度 | medium |

**问题**：报告写“回读 Auto 后 earlyStopped=true、编排失败、原始退出143”，读起来像回退在执行中途被拦下。但同一证据的 stdout 已包含两条 assistant 事件和 result subtype=success（含计费 credits），说明 CLI 完成整轮调用后才收到 SIGTERM。stdout 很可能被块缓冲，init 行没能先到达。在 P2 无工具路线下这不影响判失败；但到 P3 有工具时，回退后的工具调用可能在 stopEarly 生效前执行完。而本来可能更早到达的 stderr 告警又因 CLAUDE-01 没被识别。

**依据**：adapter-2026-10-27T23-27-51-812Z-b0b109.json:255 的 stdout 末尾是 result success、total_credits 0.1604284；:259 earlyStopped=true；:253 code=143。src/trivium/adapters/qoder-cn.ts:21-24 的早停只依赖逐行回调。“stdout 被块缓冲”是我从证据内容推断的，没有实际运行验证。

**建议**：在报告里如实写明：本次早停发生在 result 之后，没有阻止模型调用本身。把“告警或标签先于结果到达时能否中止”列为未测或阻塞，尤其是进入 P3 工具面之前。修好 CLAUDE-01 后，再取一次真机证据，观察 stderr 告警的到达时序。

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/qoder-cn.ts:23-28` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：默认探针用 monitor.finish().label，也就是 labels.at(-1)（最后观察到的标签）来确定默认值，而计划要求的是“省略 --model 的隔离真机 init 回读”。计划 §5 明确预期 Auto 请求可能在 assistant.message.model 里披露具体模型；一旦出现，native_default.model 会变成那个具体模型，生产请求随之改为 --model <具体模型>，把路由默认静默固化成固定模型，和“默认为 Auto 路由标签”的契约相反。另外探针把监视器的请求写死为 'Auto'：如果官方默认是 Fast，探针会报“路由标签发生变化”而失败，与注释“不从目录顺序猜默认”的意图不一致。

**依据**：src/trivium/adapters/qoder-cn-model.ts:106-110 中 readback().label 取 labels.at(-1)，:91-92 同时收 init 和 assistant 的标签。src/trivium/probes/qoder-cn.ts:23 是 new QoderModelMonitor('Auto',…)，:27 用 observed.label。计划 r2 §3（第 27 行）写的是 init 回读一致，§5（第 54 行）写的是 Auto 后回读具体模型属正常。当前真机证据 directory-…-c54e0b.json:36 中 init 和 assistant 都是 Auto，所以目前没有触发。

**建议**：探针单独记录 system/init 的 model 作为默认依据，后续事件只用来核对是否出现路由变化。探针监视器不预设请求标签，或者以 init 标签作为基准。补一个“init=Auto、assistant=具体模型”的单测，断言 native_default.model 仍为 Auto。

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/qoder-cn.ts:30` |
| 类别 | scope-drift ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §3 的路线表把“显式已验证原生配置 → source=config”列为一条独立路线：配置值在同一官方目录内时，可以覆盖目录内置默认。实现中探针恒写 source:'catalog-default'，configuration.model 只存进 observed_user_model，从不与目录核对，也不会成为默认。类型里声明了 'config'，却没有任何产出方。这条偏离没有在设计、协议或报告里说明；brief 焦点“原生配置来源”实际只做了哈希绑定。

**依据**：src/trivium/types.ts:1012 声明 source 为 'catalog-default' | 'config'。src/trivium/probes/qoder-cn.ts:15 读取 configuration，:30 恒写 catalog-default。计划 r2-codex.md 第 27 行和第 32 行定义了 config 路线。doc/02_design 和 PROTOCOL 增补段只写了 catalog/Auto 路线。

**建议**：二选一并写明：要么实现“配置值属于官方目录且非 Custom 时 source=config”（运行仍走隔离配置加显式 --model），并补正反单测；要么在设计、协议和报告中显式记录本期不支持 config 路线及原因，同时从类型里移除这个无产出的枚举值，交给 Driver 裁决是计划还是实现需要调整。

### CLAUDE-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn.ts:28-30,66` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：invokeQoderModel 把 monitor.finish() 抛出的“未核实模型”写回 monitor.failure，并原样进入 evidence.failure 和 fail_reason。结果是超时、启动失败（ENOENT）、断流等情况的失败原因都显示为“未核实模型：请求 X，没有原生回读”，真实原因被遮住。而 NativeModelResult.failure 在设计里是“回退首因”，混入非回退原因会误导读留痕的人。

**依据**：qoder-cn.ts:29 是 try{effective=monitor.finish();}catch(e){monitor.failure ??= …}，:66 是 reason: invoked.evidence.failure ?? '…执行未完成'。集成测试中“启动失败”一例只断言 spawned=false、code=null，没有检查原因文本。计划 r2 §5（第 58 行）要求截断、取消、超时沿用原有失败语义，回退首因单列。

**建议**：把“未核实”与“回退或不一致”分成两个字段，或者给 failure 加上类别。spawned=false、timedOut、truncated 时，fail_reason 优先用执行层原因，不要用“未核实”覆盖。

### CLAUDE-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn.ts:44-50; src/trivium/config.ts:171-175` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：计划 §4 要求 availability 检查“受测入口/版本/hash、配置指纹”。nativeDefaultIsFresh 只比对 entrypoint、version、probed_at、platform 和 TTL，入口哈希与 settings.json 指纹要到 worker 内的 verifyQoderBinding 才校验。用户改动 settings.json 后，预检和 --start 显示可用，要到后台 worker 才失败。另外 catalogModelsFor 同步调用 validateQoderFacts，事实损坏时直接抛异常，可能把预检变成“内部错误”，而不是给出“请重探”的提示。

**依据**：config.ts:171-175 的检查项；qoder-cn-native.ts:64-70 的哈希校验只在 run 路径调用；qoder-cn.ts:43 的 catalogModelsFor 没有捕获异常；cli.ts:2357 的未捕获异常统一报“内部错误”。

**建议**：在可接受异步的预检阶段（--start 前）调用一次 verifyQoderBinding，或在 availability 文案里注明哈希留到运行时才核实。catalogModelsFor 捕获校验异常，返回不可核实或空目录，并附上“请 doctor --only qoderclicn”的修复提示。

### CLAUDE-07 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/model-routing.ts:8; src/trivium/adapters/base.ts:2055` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：defaultModelFor 返回 {kind:'missing', reason} 时，resolveTier 只在 resolved 分支使用它，reason 被丢弃。用户最终看到的是 review.ts 的通用提示“profile 未定义 … 阶段的模型”，而不是“请显式运行 doctor --only qoderclicn 取得官方默认”。这与计划“缺失时明确报配置缺失”的可读性要求有差距。

**依据**：base.ts:2017 接收 missing，但 :2053-2057 只处理 resolved。review.ts:1216-1220 的 envError 文案是通用的。qoder-cn.ts:39-40 的 missing reason 写有 doctor 指引。

**建议**：让 TierResolution 带上 nativeDefaultMissing 的原因，在 review/preflight 报“无可用模型”时附上这条原因。

## 认为正确的部分

- worker 对账：src/trivium/model-routing.ts 的 sameRequestedRoute 用 isDeepStrictEqual 比较整份请求快照（含 native_model），run-protocol.ts:325 在调用适配器前拒绝不一致，对插入顺序不敏感，符合计划“确定性逐字段比对”。集成测试篡改 configuration_sha256 后模型没有派生，形成了闭环。
- 退出码为 0 仍判失败：invokeQoderModel 的 ok 同时要求 code=0、未超时、未截断、未早停、无 failure、看到 result 且 is_error=false。adapter.run 先给出 failed 结果，只在 ok 时改成 ok，review.ts:1651 只解析 status=ok 的结论，因此回退的结论不进入计票。
- 无效显式模型在派生进程前被拒：qoderModelRequest 按大小写不敏感比对目录、取规范名，生产无跳过旗标。adapter.run 也重新校验，不只依赖主进程。
- modelUsage 计费键只有在目录已认识时才参与一致性比较，qfmodel 原样记入 usage_labels、不推断别名，与设计说明同口径。真机 Qwen3.8-Flash 正对照因此通过。
- resolveTier 的顺序：cli.tier → profile 格子 → default_tier → probe_default，只有 cell===undefined 时才落到原生默认。显式空串和坏档位不回落，tier_source=probe_default 同步进入 run.v3 schema 枚举。
- 隔离执行：临时 HOME 0700、认证文件 0600 并用 wx 标志，清除 QODER*/TRIVIUM* 等环境变量，用 --setting-sources user 加最小 settings。finally 先删认证再清理残留辅助进程；Windows 下明确拒绝复制认证。
- Auto 与具体模型的回读分离：readback 只把非路由标签视为 effective，全是路由标签时 source=unverified、effective=null，不伪称识别出底层模型。

## 未覆盖范围（本侧盲区）

- 没有运行任何测试或构建；“stdout 块缓冲导致早停滞后”是从证据内容推断的，未经实际运行确认
- skills/dual-critic/schema/run.v3.json 中 nativeRequest/nativeResult 的 $defs 细节，以及它们与 types.ts 的逐字段一致性，未逐项核对
- scripts/acceptance/kimi-qoder-cn/ 下的取证脚本、Kimi 相关的全部证据与报告（本主题以外）
- render.ts、report.ts 中 native_model 的渲染细节，以及 doctor.ts 中探针结果的写回、合并路径
- util/exec.ts 中 stopEarly、killTree 在 Windows 上的语义
- 计划第 68 行要求的 cwd 下 .qoder/settings.json 反向对照是否已取证，未核查
- adapter-2026-10-27T23-22-27-876Z-7f98fd.json 未阅读

## 实际查阅的项目文件

- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/review.ts`
- `src/trivium/types.ts`
- `src/trivium/config.ts`
- `src/trivium/doctor.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/schemas.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/cli.ts`
- `test/unit/qoder-cn-model.test.ts`
- `.reviews/QoderCN官方模型路由与回退阻断/plan/2026-10-28-QoderCN官方模型路由与回退阻断-r2-codex.md`
- `doc/05_testing/evidence/qoder-cn-model-20261028/directory-2026-10-27T23-15-59-345Z-c54e0b.json`
- `doc/05_testing/evidence/qoder-cn-model-20261028/adapter-2026-10-27T23-27-51-812Z-b0b109.json`
- `doc/05_testing/evidence/qoder-cn-model-20261028/adapter-2026-10-27T23-23-09-057Z-53c7c2.json`
- `doc/05_testing/evidence/qoder-cn-model-20261028/adapter-2026-10-27T23-26-03-721Z-bfc302.json`
- `doc/05_testing/REPORT_2026-10-28_QoderCN官方模型路由与回退阻断.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":13,"grep":12,"glob":0,"run_command":0,"project_reads":17}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
