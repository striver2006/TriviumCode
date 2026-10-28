---
schema: trivium.review.v2
topic: QoderCN只读审核准入与Custom模型接入
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.4.8
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261028T024721Z
rerun_index: 1
snapshot_hash: sha256:e379d6a969e6bbe744ffa26ecb02529869c77ce1b10cd446b05ccdb2a10ae538
blind: true
started_at: 2026-10-28T02:47:29.957Z
finished_at: 2026-10-28T03:00:15.690Z
duration_s: 400
tool_calls:
  read: 26
  grep: 6
  glob: 0
  run_command: 0
  project_reads: 24
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 1
degraded: true
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
heterogeneous: unknown
access:
  requested_mode: standard
  profile: null
  launcher_requested: /Users/chenzhenbo/.local/bin/agy
  launcher_effective: /Users/chenzhenbo/.local/bin/agy
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: gemini
    status: unknown
    left_model: null
    right_model: gemini-3.8-flash-high
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
  - left: gemini
    right: claude
    status: unknown
    left_model: gemini-3.8-flash-high
    right_model: null
    left_source: envelope
    right_source: null
    reason: 右侧模型未回读
override_reason: 左侧模型信息缺失
session_id: e7d937e7-7ff2-4285-8f17-8bbbeffde88c
---

# 代码审查：QoderCN只读审核准入与Custom模型接入

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261028T024721Z`
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **本次为降级轮次**：有入选审核者未能完成，本结论不构成本轮预期的完整多审。实际完成情况见抬头的审核者清单与 run 元数据的 `degraded_reason`。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

1. 审核测试臂因同时传入 --tools Read,Grep,Glob 导致 Write/Bash 被前端直接移除，模型调用触发的是 Tool not found 而非执行层 permissions.deny 规则拦截，使测试未能有效检验执行层权限防御，脚本测试臂设计存在死锁；
2. 生产环境加固 qoderChildEnv 实施了严格的环境变量白名单与私有临时目录，避免未知父凭据与注入变量污染，但对 Windows 平台家目录相关变量（HOMEDRIVE/HOMEPATH）的处理仍待后续补齐；
3. Driver 在面对 Custom 底层身份回读不足、执行层拒绝证据不足等厂商能力障碍时，恪守了严格准入铁律，未强行开启生产开关，未伪造准入台账，报告与协议文档真实反映了当前阻塞状态，生产代码安全可控；经修改后可通过。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 3 条：次要 2 ｜ 吹毛求疵 1）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs:36` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：readonly 审核测试臂同时配置了 permissions.deny 规则与命令行参数 --tools Read,Grep,Glob，导致 CLI 启动时直接在前端将 Write/Bash 裁剪，模型诱导调用时返回 Tool "Write" not found 而无法触发执行层 permissions.deny 规则校验，使测试蜕化为验证参数裁剪而非执行层拒绝。

**依据**：查阅 scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs:36 与证据文件 doc/05_testing/evidence/qoder-cn-admission-20261028/readonly-2026-10-28T02-44-15-091Z-e3f692.json:35，模型发出的 Write (call_6c2eda8a59cf48b5b06acc47) 与 Bash (call_27295a179e624ca18d432ff1) 调用均返回 Tool not found，未生成 permission-rule 拦截事件，终态 permission_denials 数组为空。

**建议**：在只读测试臂中，若要验证执行层拒绝，需保持工具在 CLI 会话中可见（即不通过 --tools 强行屏蔽），仅依靠 permissions.deny 与 --permission-mode dont_ask 拦截，以观察真实的 permission-rule 执行拒绝。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-native.ts:65` |
| 类别 | security ｜ 层次 code |
| 置信度 | medium |

**问题**：qoderChildEnv 在重置家目录环境变量时仅重定向了 HOME 和 USERPROFILE，未处理 Windows 系统中部分 C 运行库和 Windows API 回退查找的 HOMEDRIVE 与 HOMEPATH，存在继承父环境真实家目录盘符与路径的潜在隔离逃逸风险。

**依据**：查阅 src/trivium/adapters/qoder-cn-native.ts:53-68，白名单遍历过滤了未知变量，但未由 home 解析派生 HOMEDRIVE 与 HOMEPATH；在 Windows 平台若放开执行，可能导致子进程通过未定义的这两个变量回退至宿主用户真实家目录。

**建议**：在后续 Windows 适配实测中，若处于 Windows 平台，建议由临时 home 规范化路径拆分并明确设置 HOMEDRIVE 与 HOMEPATH，或在白名单中确保父环境的对应变量不被污染。

### AGY-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md:35` |
| 类别 | maintainability ｜ 层次 rca |
| 置信度 | high |

**问题**：测试报告中对 readonly 臂工具调用的表述「审核臂仍未尝试 / 模型未调用 Write/Bash」不够准确，容易误导为 Prompt 诱导调用失败，而真实情况是模型已产生 tool_use，但因 CLI 裁剪工具未暴露而直接报 Tool not found。

**依据**：对照 doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md:35,42 与 doc/05_testing/evidence/qoder-cn-admission-20261028/readonly-2026-10-28T02-44-15-091Z-e3f692.json:35，实际 stdout 中存在模型调用 Write/Bash 的调用 ID 与对应 tool_result，只是错误原因为 Tool not found。

**建议**：将表述修正为「模型已尝试调用 Write/Bash，但因 --tools 裁剪导致 CLI 返回 Tool not found，未触发执行层权限规则拦截（permission_denials 为空），无法提供执行层拒绝证据」。

## 认为正确的部分

- 严格遵循准入铁律与安全红线：在发现 Custom 模型缺乏底层模型身份独立回读（仅回显 display_name 与原生 key）、Write/Bash 执行层拒绝证据不足、配置叠加风险未除、Windows 未测等重大缺口后，坚决维持生产拒绝，未过早开启 criticEnabled 或 driverEnabled，未伪造组合台账。
- 生产环境隔离加固 qoderChildEnv：将原黑名单过滤升级为严格系统/locale/代理白名单构造，禁止包含认证或查询参数的代理 URL 并防止错误消息泄漏凭据，临时目录收敛至私有 HOME 并带有完善单测。
- Custom 单条重加密加载设计严谨：通过当前安装 CLI 内置编解码器在内存中解密后，仅提取选中模型并重加密至私有临时目录，完全避免了其余未选模型凭据的扩散与落地，并在落盘扫描中核验密钥脱敏与原生源文件哈希一致性。
- 真实单变量正反对照完整：针对 Custom 验证了单条加载成功、缺失配置回退 Auto 退出 0、合成错误 key 触发 401 失败三臂；针对官方模型验证了 Write/Bash 正控制与敏感路径 Read 拒绝两臂，为后续根因定位提供了坚实的机器证据。

## 未覆盖范围（本侧盲区）

- 本审查员未获得写权限与直接执行命令能力，未能直接运行 Node 进程验证 qoder-custom.mjs 和 qoder-readonly.mjs 在当前环境下的真实二进制输出。
- Windows 平台（win32）下的 ACL 配置、权限隔离以及 HOMEDRIVE / HOMEPATH 实际运行时行为未进行真实验证（依据报告 Windows 处于未测阻断状态）。
- Qoder CLI 内置的 skills、agents、slash_commands 与 Security SessionStart hook 在完整配置叠加下的行为未逐一进行穷举测试。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r2-codex.md`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/probes/qoder-cn.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/preflight.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/util/fsx.ts`
- `test/unit/qoder-cn-model.test.ts`
- `test/integration/qoder-cn-routing.test.ts`
- `test/helpers/doc-archive-index.ts`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-10-28_QoderCN官方模型路由与回退阻断.md`
- `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/custom-2026-10-28T02-43-17-316Z-731e6b.json`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/readonly-2026-10-28T02-44-15-091Z-e3f692.json`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/index-2026-10-28T02-46-01-353Z-11bd65.json`
- `doc/08_project/BACKLOG.md`
- `doc/08_project/KimiCode与QoderCN双角色接入实施计划.md`
- `doc/08_project/现存Bug与未完成工作清单.md`
- `scripts/acceptance/kimi-qoder-cn/README.md`
- `scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-index.mjs`
- `scripts/acceptance/kimi-qoder-cn/probe.mjs`

> 编排器从工具轨迹中记录到的读取次数：{"read":26,"grep":6,"glob":0,"run_command":0,"project_reads":24}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
