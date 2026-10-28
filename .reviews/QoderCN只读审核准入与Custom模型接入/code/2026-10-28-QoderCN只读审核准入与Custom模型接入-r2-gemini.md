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
run_id: 20261028T041304Z
rerun_index: 2
snapshot_hash: sha256:4d1bd92e14db876d86c6b6ac001286e57744a56e9695f7c7091874ccdb60f526
blind: true
started_at: 2026-10-28T04:13:12.999Z
finished_at: 2026-10-28T04:25:23.997Z
duration_s: 276
tool_calls:
  read: 28
  grep: 1
  glob: 0
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
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: claude-opus-5-5
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：gemini / claude
override_reason: 左侧模型信息缺失
session_id: 073966fd-058d-447e-9d41-b067e9ad0aac
---

# 代码审查：QoderCN只读审核准入与Custom模型接入

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261028T041304Z` ｜ 第 2 轮
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

1. 生产代码已完成严格的环境变量白名单加固（qoderChildEnv），未知父环境/注入变量及含认证代理均安全拒绝，临时目录收敛至私有 HOME；
2. 针对 Custom 模型的实测表明其仅在内存做最小重加密加载，未泄漏其他模型凭据；但在缺配置时存在回退 Auto 且退出 0 的静默失败反例，且缺乏底层独立身份回读；
3. 官方模型工具对照测试中，原生 deny 策略仍会提前裁剪工具导致 Tool not found，未能证明 permissions 规则拦截能力；搜索禁读区域未触发拒绝；
4. Driver 严格遵守准入红线，未强行开放生产 criticEnabled/driverEnabled 开关，在所有文档与证据中均实事求是地将状态标记为阻塞并保留原始反例；
5. 本次代码修订充分采纳了上一轮审查意见，生产代码安全受控，微小路径拼接优化后即可实施。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 1 条：次要 1）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs:45` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：permissions.deny 规则拼接时使用 /${p} 与 /${home}/**，因变量已为绝对路径，生成了包含双斜杠的非标准路径（如 Read(//var/...)），在特定严格 glob 匹配器或跨平台环境下存在路径规范化失效风险。

**依据**：查阅 scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs:45-46（diff 行 5873-5874），home 与 p 均为绝对路径，前缀再显式拼接 / 产生多余前导斜杠；查阅 doc/05_testing/evidence/qoder-cn-admission-20261028/readonly-2026-10-28T04-11-23-932Z-18cab9.json:86 中实际 Qoder 报错回显的拒绝规则为单斜杠路径。

**建议**：移除模板字符串中多余的前导斜杠，直接写为 ${t}(${p}) 与 ${t}(${home}/**)，保持路径格式标准。

## 认为正确的部分

- 严格坚守准入底线：在面临 Custom 底层模型身份无法独立回读、Write/Bash 执行层拒绝证据不足等厂商能力阻碍时，保持 registry 中的 criticEnabled 与 driverEnabled 开关关闭，未为了过审而降低安全标准或虚构准入台账。
- 生产环境隔离加固彻底：qoderChildEnv 采用严格显式白名单构造，禁止包含认证或查询参数的代理继承并不在错误中泄漏 URL，临时目录严格收敛于私有临时根并完成单测覆盖。
- 真实单变量正负对照完备且诚实留痕：对 Custom 记录了单条加载成功、缺失配置回退 Auto 退出 0、合成错误 key 触发 401 失败三臂；对官方模型记录了 Write/Bash 正控制与两条 Read 路径拒绝，如实报告原生裁剪现象及搜索区域未测状态，不将退出 0 或空结果冒充通过。
- 内存凭据护栏与脱敏机制健全：新增 qoder-secrets.mjs 实现已知明文参数与复制认证原文的脱敏替换，命中时强制退出 1 并使终态标记粘滞，同时在输出落地前对用户家目录路径进行了规范化替换。

## 未覆盖范围（本侧盲区）

- 本审查员无代码修改与命令执行权限，无法直接在宿主终端运行 Node 进程验证 qoder-custom.mjs 与 qoder-readonly.mjs 对真实二进制的调用。
- Windows 平台（win32）下的 ACL 配置、权限隔离以及真实运行环境（当前在生产环境与实验脚本中均处于未测阻断状态）。
- Qoder CLI 进程树完整生命周期（包括 SIGTERM/SIGKILL 强杀、超时、用户取消及失联回收等场景）下的辅助进程与临时凭据清理。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-10-28_QoderCN官方模型路由与回退阻断.md`
- `doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/readonly-2026-10-28T04-11-23-932Z-18cab9.json`
- `doc/05_testing/evidence/qoder-cn-admission-20261028/readonly-2026-10-28T04-12-18-095Z-595da8.json`
- `doc/08_project/BACKLOG.md`
- `doc/08_project/KimiCode与QoderCN双角色接入实施计划.md`
- `doc/08_project/现存Bug与未完成工作清单.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/plan/2026-10-28-QoderCN只读审核准入与Custom模型接入-r2-codex.md`
- `.reviews/QoderCN只读审核准入与Custom模型接入/code/_meta/changes-20261028T041304Z.diff`
- `.reviews/QoderCN只读审核准入与Custom模型接入/code/2026-10-28-QoderCN只读审核准入与Custom模型接入-gemini.md`
- `scripts/acceptance/kimi-qoder-cn/README.md`
- `scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-secrets.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-secrets.test.mjs`
- `scripts/acceptance/kimi-qoder-cn/qoder-index.mjs`
- `src/trivium/adapters/qoder-cn.ts`
- `src/trivium/adapters/qoder-cn-native.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/model-routing.ts`
- `src/trivium/preflight.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/probes/qoder-cn.ts`
- `test/unit/qoder-cn-model.test.ts`
- `test/integration/qoder-cn-routing.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":28,"grep":1,"glob":0,"run_command":0,"project_reads":20}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
