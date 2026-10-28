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
run_id: 20261028T002149Z
rerun_index: 3
snapshot_hash: sha256:7810c1a4aa6a0c2c2b02d516ea17d02ce7ae57b159244127a7f0359433710e0b
blind: true
started_at: 2026-10-28T00:21:58.738Z
finished_at: 2026-10-28T00:34:16.368Z
duration_s: 577
tool_calls:
  read: 13
  grep: 12
  glob: 1
  run_command: 0
  project_reads: 20
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 0
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
session_id: sess_8d1564b1-b838-417d-a6ae-aa2a343001f7
---

# 代码审查：QoderCN官方模型路由与回退阻断

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261028T002149Z` ｜ 第 3 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

第 3 轮复查：上一轮本侧四条意见全部落地且形态正确——坏档位经 cli/profile/agent 三路断言 model 为 null 且 tierSource 非 probe_default（test/unit/qoder-cn-model.test.ts:44-51）；stop_observation 三个形态都有内容锚（流式早停 after_result=false 且 channel 随通道、result 先于告警 after_result=true 且 fail_reason 仍为回退、收尾兜底 channel=final，integration 60-79 与 unit 59-68）；resultError 分支补了 !monitor.failure 守卫并有专门用例钉住回退首因不被原生结果错误遮蔽；qoderFailureMessage 递归展开 AggregateError 明细并有单测。焦点七项复验与计划 r2 一致：目录取自隔离认证副本的 --list-models，MODEL 单列严格解析、大小写重复与未知形态拒绝、语义 hash 与原始 hash 分列；config 来源由目录内原生配置经隔离真机显式 --model 验证产出，Custom 仅作 observed_user_model 观察不继承，validateQoderFacts 强制 config 时声明与用户观察一致；默认证据取省略 --model 的首个 init 标签与目录互证、后续具体身份披露不固化默认、TTL 与入口/版本/平台/探针时间绑定；请求/声明/回读三面分离落在 nativeRequest(facts/requested/override/origin)、facts.model/source 与 labels/usage_labels/envelope，worker 侧 sameRequestedRoute 深比对且篡改在模型派生前拒绝（run-protocol.ts:322-328 加隔离复制树集成锚）；双通道流式首现即停、末尾无换行由收尾重放兜底且 monitor 全字段去重使重放幂等；退出 0 伴回退判 failed、review_json 为空、结论不计票，提前杀的 signal 不覆盖回退首因；wiredAdapter 接入真实适配器、registry 双开关保持关闭且集成测试反向断言生产注册表未回写。清理侧按 lstart+sameProcess 区分短命退出与 PID 复用、先删认证再收辅助进程再删根。本轮剩一条 minor：未核实失败（exit 0 且无任何模型回读标签）这条计划第 5 节明文承诺的分类，其从 completeQoderModelRun 到适配器 fail_reason 链尾的整段接线没有任何测试锚，仅 helper 层有 /未核实/ 断言；该链上的 verificationFailure 是 ok 门控里唯一阻止此类运行被判成功的项，回归删除它不会红任何测试。无 blocker/major，补锚后即可实施。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 1 条：次要 1）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn.ts:56-63（消费链 :108）；test/unit/qoder-cn-model.test.ts:99 与 test/integration/qoder-cn-routing.test.ts 全文` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：「具体请求无任何可验证回读标签时失败且原因是未核实」是计划 r2 第 5 节的明文承诺。monitor.finish 在 labels 为空时抛「未核实模型」，completeQoderModelRun 捕获后写入 verificationFailure，它同时进入 ok 门控（第 63 行的 !verificationFailure）与 fail_reason 链尾（第 108 行 execution_failure??failure??verification_failure）。但现有测试只在 helper 层断言过该语义（qoder-cn-model.test.ts:99 经 assertQoderModelDidNotFallback 直接调 finish），没有任何用例穿过 completeQoderModelRun 或适配器 run 走这条路：夹具与合成 outcome 用例全部带 init 标签或告警。若将来回归把 !verificationFailure 从 ok 条件删除、或从 evidence 与 reason 链中漏掉该字段，一次 exit 0、result success、零模型回读的运行会被静默判 ok 且 model_effective 为 null/unverified，全部测试保持绿色——恰好伪称了计划禁止的「已核实」。

**依据**：src/trivium/adapters/qoder-cn.ts:56-57（finish 抛错仅当 !monitor.failure 时进 verificationFailure）、:63（ok 含 !verificationFailure 项）、:108（reason 链尾取 verification_failure）；src/trivium/adapters/qoder-cn-model.ts:124-128（labels 为空时 finish 抛未核实）；test/unit/qoder-cn-model.test.ts:99（仅 helper 层 /未核实/ 断言）；test/integration/qoder-cn-routing.test.ts:45-109（现有真实边界用例均含 init 标签或告警，无零标签形态）。

**建议**：补一条用例：夹具只输出 subtype=success 的 result 事件、不含任何 init/assistant 模型标签（或直接以 completeQoderModelRun 组装该 outcome），断言 ok=false、evidence.verification_failure 匹配「未核实」且 failure 为 null；适配器层再断言 status=failed、fail_reason 落在 verification_failure 上。

## 认为正确的部分

- 上一轮四条意见全部正确落地：坏档位三路（cli/profile/agent default_tier）断言 model 为 null 且 tierSource 非 probe_default，空格子断言既有 model===null 保持
- stop_observation 三形态全部有内容锚：分块告警流式首现（channel 随 stdout/stderr、after_result=false）、result 先于告警（after_result=true 且 fail_reason 仍为回退）、缺流回调的收尾兜底（channel=final）
- resultError 分支加 !monitor.failure 守卫，模型回退在场时 execution_failure 保持 null，回退首因不再被原生结果错误遮蔽，且有专门集成用例
- qoderFailureMessage 递归展开 AggregateError 的 errors 数组并以分号拼接，清理失败细节进入 execution_failure 供排障，单测钉住
- 官方目录来源：隔离认证副本下 --list-models 取目录，MODEL 单列严格解析、字符集/空值/大小写重复拒绝、排序不改变语义 hash，原始输出 hash 与语义 hash 分列
- config 来源有真实生产者：用户原生配置值先在官方目录内同名匹配、经隔离真机显式 --model 验证、init 回读互证后写 source=config；Custom 声明单列 observed_user_model 不继承；validateQoderFacts 强制 config 时声明与用户观察一致，伪造枚举被堵
- 默认值证据：省略 --model 的首个 init 标签与目录互证，后续具体身份披露不固化默认（initLabel 首见即定），nativeDefaultIsFresh 绑定入口/版本/探针时间/平台并做 TTL
- 请求/声明/回读分离：nativeRequest 的 facts/requested/override/origin、facts.model/source/observed_user_model、labels/usage_labels 与 envelope/unverified 三面独立；schemas.ts 交叉校验 requested_routes 的 native_model.requested 与 model 一致，且 requested_routes 必须是启用侧
- worker 对账：requestRouteSnapshot 键序无关，sameRequestedRoute 深比对交接与冻结快照，篡改在模型派生前拒绝并有隔离复制树两进程集成测试实证；review.ts 在请求构造前对无模型侧防御性拒绝，nativeModelFor 不会被以 null 调用
- 双通道回退告警：stdout/stderr 流式回调首现即 stopEarly，收尾重放覆盖未换行尾部且 monitor 对 labels/usageLabels/initLabel/failure 全部首因粘滞或去重、重放幂等；完整真机告警尾句（含 Use /model 变体）纳入识别并以真机失败样本作回归锚；不扫描 assistant/user/tool 正文
- 退出 0 伴回退判 failed、review_json 为空、结论不计票（集成断言 exit_code=0 与 status=failed 并存且 fail_reason 匹配回退）；提前杀的 signal 不覆盖回退首因；缺精确回读如实记未核实并失败
- Auto/Fast 按路由标签处理、底层 null/unverified；Auto 请求中途披露具体身份不判回退；modelUsage 未知计费键单列不推别名、仅目录已知键参与互证；VENDOR_MODEL_FAMILY 对 qoder-cn 恒不匹配，路由标签不能冒充模型族
- 真实适配器接线：wiredAdapter 表接入，registry 的 criticEnabled/driverEnabled 均为 false，集成测试在隔离复制树启用候选验证全链路后反向断言生产注册表未回写
- 临时认证副本目录 0700、文件 0600、源为符号链接即拒、Windows 未测 ACL 即拒绝复制而非降级；env 清洗与一次性 HOME 隔离完整；清理先删认证、再按 lstart+sameProcess 终止临时 HOME 辅助进程（自然退出跳过、PID 复用不误杀）、复删根目录，清理失败保留执行事实并展开明细

## 未覆盖范围（本侧盲区）

- 只读审查：npm run typecheck、定向 46/46、集成 4/4、全量 4130 项（4121 通过/9 跳过/0 失败）的通过声明取自测试报告自述，未独立复跑
- 1.1.80 输出形态（MODEL 单列目录、init 标签、qfmodel 计费键、真机回退告警文本）按既有证据与单测回归锚采信，未做真机验证
- evidence/qoder-cn-model-20261028 各 JSON 仅经单测引用的失败样本间接核对，未逐份审读内容与 hash；kimi-macos 证据与 scripts/acceptance/kimi-qoder-cn 取证脚本属 Kimi 主题，未逐一审读
- doctor.ts、report.ts、render.ts、scrub.ts、parse.ts 的 diff 段本轮未逐行重读（registry-parity 与 parse-degrade 的改动按报告 46/46 与 139/139 声明采信）
- CLAUDE.md、README.md、doc 各 README 为通用导读，本轮未逐字读
- 超时/截断与模型回退并存时 fail_reason 取执行侧文案（timedOut/truncated 分支无 !monitor.failure 前置）： judged 为可辩护设计——执行类首因真实存在且 evidence.failure 与 stop_observation 完整保留，未作意见提出；其可达性（流式未见告警且进程挂起）属代码推理未实测
- stopQoderHomeHelpers 对 zombie（已退出未收割、lstart 取空但在位）仍抛身份不可核实并经 execution_failure 判失败：fail-closed 方向，理论窗口未构造验证
- Driver 对 r2 意见的书面裁决件（r2-response-codex.md）未读，全部处置以当前代码与测试现状直接核实

## 实际查阅的项目文件

- `.reviews/QoderCN官方模型路由与回退阻断/code/2026-10-28-QoderCN官方模型路由与回退阻断-glm.md`
- `.reviews/QoderCN官方模型路由与回退阻断/code/2026-10-28-QoderCN官方模型路由与回退阻断-r2-glm.md`
- `.reviews/QoderCN官方模型路由与回退阻断/plan/2026-10-28-QoderCN官方模型路由与回退阻断-r2-codex.md`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/index.ts`
- `src/trivium/config.ts`
- `src/trivium/types.ts`
- `src/trivium/schemas.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/review.ts`
- `src/trivium/agents/registry.ts`
- `test/unit/qoder-cn-model.test.ts`
- `test/integration/qoder-cn-routing.test.ts`
- `skills/dual-critic/schema/run.v3.json`
- `doc/05_testing/REPORT_2026-10-28_QoderCN官方模型路由与回退阻断.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":13,"grep":12,"glob":1,"run_command":0,"project_reads":20}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
