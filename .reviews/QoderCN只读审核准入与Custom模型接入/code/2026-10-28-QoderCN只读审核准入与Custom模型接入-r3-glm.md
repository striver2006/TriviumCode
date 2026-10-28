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
run_id: 20261028T043435Z
rerun_index: 3
snapshot_hash: sha256:68596d43252d34f88e6b28a78d2745f91fa202de70b1441a092f410a22d0cb95
blind: true
started_at: 2026-10-28T04:34:43.165Z
finished_at: 2026-10-28T04:43:52.473Z
duration_s: 549
tool_calls:
  read: 11
  grep: 3
  glob: 0
  run_command: 0
  project_reads: 11
evidence_ok: true
verdict: pass
findings_count:
  blocker: 0
  major: 0
  minor: 1
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
session_id: sess_d3e2109e-c357-4b73-85b9-3322afc01f91
---

# 代码审查：QoderCN只读审核准入与Custom模型接入

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261028T043435Z` ｜ 第 3 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

上一轮（run 20261028T041304Z）我判 blocker 的环境白名单失效问题在本 diff 已正确修复并经三层验证：qoderChildEnv 现对全部非白名单父键显式置 undefined（qoder-cn-native.ts:53-68），与 run() 的叠加删除语义（exec.ts:527-531）匹配；新增纯函数单测、真实 run 子进程 canary 回归（qoder-cn-routing.test.ts:45-53，默认执行、仅 win32 跳过，且经 home/tmp 一致性断言传递覆盖 HOME）、真机 Bash env-canary 臂（04:31 原件 call_829fbb4d tool_result 为 ENV_CANARY__、exitCode 0）逐层成立。我 r2 的五条意见全部落实：证据落盘改走逐文件容错的 compareSnapshots/checkAbsence（基线读取移入 try）、护栏经 test/unit/qoder-secret-values.test.ts 进默认 npm test、命中留不含原值的 matchIndices 并计 scan_boundary、索引补录 credentials_unchanged 且单件损坏不再拖垮整份。产品面改动仅环境白名单与私有 tmp，registry 三开关保持 false，admission 恒 false，旧批次环境结论作废而不改写原件，报告与 PROTOCOL/设计新增节表述与实现一致；Custom 最小重加密只落选中条目、全部解密 parameters 值入护栏、厂商源码/WASM 只留 hash。剩余三条意见均为非阻断加固，不影响本轮交付可接受性。

**结论**：通过（`pass`）

## 审查意见（共 3 条：次要 1 ｜ 吹毛求疵 2）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-native.ts:53-54；src/trivium/util/exec.ts:527-531；test/integration/qoder-cn-routing.test.ts:45-53` |
| 类别 | security ｜ 层次 code |
| 置信度 | medium |

**问题**：删除补丁的父环境快照时点与 run() 的叠加基线时点不一致。qoderChildEnv 在构造时刻枚举 parent（缺省 process.env）生成 undefined 补丁，而 run() 在 spawn 时刻以当时的 process.env 为基线叠加；两次之间新增的 process.env 键不在补丁中，会被厂商子进程静默继承，白名单「未知父环境不继承」的保证依赖「构造后父环境不变」这一未声明的假设。当前所有调用链中两次时点几乎相邻且无已知写入者（采集脚本的 canary 均在 withQoderHome 之前注入、集成测试亦然），属残余结构缺口而非现行为缺陷；但未来任何在 fn 执行期间改 process.env 的代码（依赖库、探针扩展）都会绕过白名单，且现有三层测试都测不住这个窗口——纯函数单测只看构造输出，canary 回归在快照之后无新增键。

**依据**：src/trivium/adapters/qoder-cn-native.ts 第 53-54 行以 parent 参数快照生成补丁；src/trivium/util/exec.ts 第 527-531 行 spawn 时用当时 process.env 作叠加基线、仅显式 undefined 才删除；test/integration/qoder-cn-routing.test.ts 第 45-53 行 canary 均在 withQoderHome 之前写入 process.env；test/unit/qoder-cn-model.test.ts 新用例仅断言 qoderChildEnv 返回形状。

**建议**：在 qoderChildEnv 注释中显式声明「补丁仅覆盖构造时已存在的父键」假设；为 run() 增加替换式 env 入口（或由 withQoderHome 侧在每次派生前重新生成补丁），使隔离不再依赖叠加基线的时点；集成测试可补一条「构造 env 后、run 之前向 process.env 新增键」的反例锚定期望行为（当前应红或显式记录为已知边界）。

### GLM-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-index.mjs:13-27、33-34` |
| 类别 | security ｜ 层次 code |
| 置信度 | medium |

**问题**：索引把各原件 stdout 中的 tool_use input 与 error_text 搬运进一份新工件时不对自身输出做逐值护栏兜底扫描。新批次原件的 stdout 已经过采集器脱敏，但索引同样摄取无 secret_guard_sha256 绑定的旧批次（02:38-04:12 件，环境结论已作废但 stdout 观测仍被收录）；虽然报告基线节声明整轮均有落盘前逐值替换扫描，索引侧缺少一道与采集器对称的自检，泄漏防线在汇总层断开。索引已逐文件记录 secret_guard_sha256（缺失为 null），可见性尚存，故仅列 nit。

**依据**：scripts/acceptance/kimi-qoder-cn/qoder-index.mjs 第 18-20 行自 stdout 提取 calls[].input 与 error_text，第 30 行逐文件记录 secret_guard_sha256??null，第 33-34 行 JSON.stringify(index) 直接落盘、未调用 qoder-secrets.mjs 的 secretGuard；同目录 02:4x 批次原件无该绑定字段。

**建议**：索引落盘前对 JSON.stringify(index) 跑一次 secretGuard 兜底（值集可仅含合成哨兵或留空以复用退出码语义），或在 per-file 条目上把「guard 绑定缺失」聚合为索引级告警字段，供消费方机器可读地识别未绑定件。

### GLM-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs:89-105；scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs:77-94` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：两个采集器的 finally 收尾骨架（不变量复算、临时根清理回读、rm 容错、script_root_removed、证据以 0600/wx 落盘、homedir 替换为 ~、guard.exitCode 收口）近乎逐行重复，仅 credentials 检查等少数差异。历史上这对孪生结构已发生过单侧不一致（上轮 readonly 基线读取在 try 外而 custom 在内），本轮修复后再次双双并列；下一次改动（如再加一项不变量）需记得改两处，漏一处不会报错只会少一份留痕。

**依据**：qoder-custom.mjs 第 89-105 行与 qoder-readonly.mjs 第 77-94 行的 finally 块结构对照；两者均已共享 qoder-evidence.mjs 的 compareSnapshots/checkAbsence，说明下沉通道现成。

**建议**：把「复算-清理-落盘-退出码收口」骨架抽为 qoder-evidence.mjs 的参数化收尾函数（差异以回调或选项表达：readonly 额外核对认证、custom 额外核对 customs 快照），两脚本只声明各自的快照集与输出前缀。

## 认为正确的部分

- 环境修复的三层验证结构成立：qoderChildEnv 纯函数单测钉死键集与代理拒绝语义（错误不回显值）、集成测试经真实 run 子进程断言五键 canary 不可见且 home/tmp 一致（HOME 隔离被传递覆盖）、真机 env-canary 臂以真实 Bash tool_result=ENV_CANARY__ 证明合成父变量未继承；三层各测一层，无一层冒充另一层。
- qoderChildEnv 的代理继承判据 fail-closed 且不回显：协议白名单外的 scheme、userinfo、query、hash、非根 pathname 一律拒绝，无效 URL 报错不含原值（单测断言消息不含 fixture 值）；SSL_CERT_FILE/SSL_CERT_DIR/NODE_EXTRA_CA_CERTS 列入白名单回应了证书路径需求；HOMEDRIVE/HOMEPATH 不继承与 Windows 在复制认证前显式拒绝保持一致。
- 采集器取证纪律良好：Custom 只把选中条目重加密进私有根、其余五个模型凭据不落盘但全部 parameters 值入护栏；厂商源码/WASM 只记 sha256 不入工件；prepare/source 阶段错误消息整体替换避免凭据回显；invalid-key 臂用显式合成占位；来源/认证前后 hash 与临时根删除三态回读（仅 ENOENT 记删除）齐备。
- 诚实性口径贯穿：admission 恒 false，旧批次环境结论作废而不改写原件，索引附 environment_correction 说明，open 臂 dont_ask 下 CLI 自动批准模型追加 ls/cat 与 Write 被审批拦截均如实记录并声明不得移作审核配方，Grep/Glob 空结果不充作拒绝，报告不宣称未实施项。
- registry 中 qoder-cn 的 criticEnabled/defaultSelected/driverEnabled 均保持 false，与本轮「不据此开放审核者」的承诺一致；rejectionChannel 把 permission-rule、tool-unavailable、execution-error、unknown 分开，配对关系由索引以 paired_permission_rules/missing_results 机器可读化。
- 上轮五条意见（r2 GLM-01..05）在本 diff 中逐条可见落实，修复位置与建议方向一致。

## 未覆盖范围（本侧盲区）

- 只读审查，未运行 typecheck/build/npm test/采集器：报告宣称的 typecheck 退出 0、定向 60/60（含 6 条经 unit 入口导入的源测试）未独立复跑验证。
- 证据 JSON 仅定向抽查（04:31 readonly 的臂结构、env-canary 完整 transcript、不变量字段；04:30 custom 的臂与不变量字段），其余批次 stdout 未整读，索引的调用/拒绝配对逻辑未逐件复算。
- 必读清单中 CLAUDE.md、README.md、doc/README.md、doc/01_requirements/README.md、doc/02_design/README.md、src/trivium/review.ts、run-protocol.ts、preflight.ts、qoder-cn-model.ts 全文、官方路由报告未读或仅经 diff 触及；本轮补丁未改这些文件，契约核对以被审 diff 与调用链为限。
- doc/05_testing/README.md 新条目的归档顺序未跑 doc-archive-index 契约测试核验（按文件名排序目测一致）。
- 旧批次（02:38-04:12）stdout 落盘前扫描的实际强度未逐一核实，GLM-02 的风险评据此保守列 nit。
- Windows 行为（含 process.env 大小写语义）、取消/强杀/失联回收生命周期矩阵、skills/Hook/MCP 叠加执行能力未覆盖；全部真机样本为 macOS 本机采样，不可外推。
- 代理 URL 校验的边缘形态（编码 userinfo、scheme 大小写、非常规 host 形态）按 WHATWG URL 语义推理，未实测。

## 实际查阅的项目文件

- `.reviews/QoderCN只读审核准入与Custom模型接入/code/_meta/changes-20261028T043435Z.diff`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/agents/registry.ts`
- `scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-evidence.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-index.mjs`
- `test/integration/qoder-cn-routing.test.ts`
- `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/readonly-2026-10-28T04-31-58-012Z-0a893e.json`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/custom-2026-10-28T04-30-46-046Z-cbceeb.json`
- `.reviews/QoderCN只读审核准入与Custom模型接入/code/2026-10-28-QoderCN只读审核准入与Custom模型接入-r2-glm.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":11,"grep":3,"glob":0,"run_command":0,"project_reads":11}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
