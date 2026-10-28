---
schema: trivium.review.v2
topic: KimiCode-macOS规则根因与只读准入修复
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
run_id: 20261027T180347Z
rerun_index: 1
snapshot_hash: sha256:20ec8a5c5be271215e88e8753b42e184704672fced8475834dc42075e88ac208
blind: true
started_at: 2026-10-27T18:03:54.844Z
finished_at: 2026-10-27T18:19:37.667Z
duration_s: 943
tool_calls:
  read: 45
  grep: 8
  glob: 1
  run_command: 0
  project_reads: 25
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
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
session_id: 9116b9c3-dbaf-4989-b7d1-9f8c9a7990b3
---

# 代码审查：KimiCode-macOS规则根因与只读准入修复

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261027T180347Z`
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

被审变更对 Kimi Code macOS 非交互模式下的只读规则失效进行了严谨的单因素对照实验与官方 2.3.3 源码审计。
确凿查明配置文件虽被加载，但 permission.rules 从未被会话生命周期接入运行集合；同时揭示了符号链接完全绕过敏感文件检测以及 Grep/Glob 规则仅匹配 pattern 而无法实现目录隔离的关键上游缺陷。
实现严格遵循计划约束：旧工件与生产适配器保持只读，双开关冻结为 false，全程无伪造准入。
仅在实验结果判定脚本 kimi-evidence.mjs 中存在 Grep 多级子目录路径漏匹配的解析边界缺陷，以及 kimi-rootcause.mjs managed 分支解析参数时未捕获 JSON 语法异常的小缺陷，修复后即可实施。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 2 条：次要 2）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/kimi-evidence.mjs:36` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：pathListed 判定逻辑对带有多级子目录的 Grep 结果存在漏匹配。content.split(/\r?\n/).some(l => l === p || l.startsWith(p + ':') || l.endsWith('/' + p)) 假定前缀要么不存在要么仅为 Glob 输出的尾段；当 Grep 搜索子目录中的文件输出形如 peer/history.md:1:content，且 p 来自 calls() 中的 path.basename(p)（即 history.md）时，l 既不以 history.md: 开头（前面有 peer/），也不以 /history.md 结尾（后面有 :1:... 行内容），导致 path_listed 被漏判为 false。

**依据**：查阅 scripts/acceptance/kimi-qoder-cn/kimi-evidence.mjs:36 与 scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs:110，并在 doc/05_testing/evidence/kimi-macos-20261028/kimi-final-1793124157502-6b3356.json:240-244 与 608-613 记录中观察到：grep-peer 返回 peer/history.md:1:PEER_028c4f5338087af89877373c 时，其 path_listed 确被记录为 false。虽然本轮被 leaked 命中标记为失败，但若在不含 token 匹配的路径枚举或搜索场景下，该漏判会导致未触发 token 泄漏的路径暴露逃逸 classifyDenial 的失败判定。

**建议**：单行解析时先提取首个冒号前的路径部分（如 const file = l.split(':')[0]），再比对 file === p || file.endsWith('/' + p)；并在 scripts/acceptance/kimi-qoder-cn/kimi-evidence.test.mjs 中补充 basename 与多级路径匹配的测试用例。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs:138` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：在 suite === 'managed' 真实模型桥接分支中，对模型返回的 c.function.arguments 执行 JSON.parse 缺乏异常保护。若真实模型返回格式残缺或含有未转义字符的非法 JSON，JSON.parse 将抛出未捕获的 SyntaxError，导致整脚本顶层崩溃，无法由 inspectTrace 结构化收集 bad-arguments 错误，且影响清理与留痕。

**依据**：查阅 scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs:138：expected = selected.map(x => { const c = actual.find(c => c.function?.name === x.name && c.function?.arguments && JSON.stringify(JSON.parse(c.function.arguments)) === JSON.stringify(x.args)); return { ...x, id: c?.id ?? x.id }; });。对比 scripts/acceptance/kimi-qoder-cn/kimi-evidence.mjs:14 中的安全 try-catch 保护，此处无任何容错。

**建议**：在 find 回调内部对 JSON.parse(c.function.arguments) 进行 try-catch 容错包装，解析失败时返回 false，避免非预期抛错阻断证据归档。

## 认为正确的部分

- 严格坚守安全边界：无论单因素实验和官方源码分析结果如何，均把生产注册表的 criticEnabled 与 driverEnabled 冻结为 false，未试图以提示词约束、未调用工具或 CLI 退出 0 假冒准入。
- 根因定位扎实深入：通过 60 次 native CLI 启动在单因素矩阵上彻底排除了配置根、规则顺序、权限模式（manual/auto/yolo）、agent、skills、CWD 等假设，并精确定位了官方 2.3.3 源码中 agentLifecycleService.ts 未调用 PermissionRulesAdd 种入配置规则的接线缺口。
- 独立揭露两项严重执行层隔离绕过：实测证明 Read 和 Grep 通过符号链接别名 alias.txt -> .env 可完全绕过内置敏感文件过滤并泄露 SECRET canary；同时从源码证实 Grep/Glob 的 matchesRule 仅匹配 args.pattern 而非 args.path，说明现有规则体系根本不支持按目录隔离 Grep/Glob。
- 实验载体设计严谨：独立工具与旧 probe 严格解耦，采用私有临时目录（0700/0600）、wx 标志防覆盖、全过程追踪进程组与全局凭据 hash，退避清理均外置于独立监督者，未改动全局用户配置。

## 未覆盖范围（本侧盲区）

- Windows 平台（PowerShell 与 Git Bash 包装脚本）实测与真实执行结果（保持未测，依赖后续实机验收）。
- 真实官方 Kimi 线上模型推理调用（因本机缺少有效 access_token 在启动前被拦截中断，未执行真实官方网络请求）。
- Kimi 桌面端、交互式 TUI 与 VS Code Extension Host 插件环境下的规则加载与工具行为（当前仅针对 macOS arm64 终端 native CLI 非交互模式取证）。
- 外部恶意插件、复杂 MCP 真实服务注入隔离（未建立正向成功激活对照，保持未测/阻塞）。
- 真实有效凭据在强杀异常下的服务端会话与网络凭据生命周期审计。

## 实际查阅的项目文件

- `.reviews/KimiCode-macOS规则根因与只读准入修复/plan/2026-10-28-KimiCode-macOS规则根因与只读准入修复-r2-codex.md`
- `doc/05_testing/CASE_KimiCode与QoderCN双平台验收.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-10-27_KimiCode与QoderCN接入前置取证.md`
- `doc/05_testing/REPORT_2026-10-28_KimiCode_macOS规则根因与只读准入.md`
- `doc/05_testing/evidence/kimi-macos-20261028/index-1793124190597.json`
- `doc/05_testing/evidence/kimi-macos-20261028/kimi-final-1793124157502-6b3356.json`
- `doc/05_testing/evidence/kimi-macos-20261028/kimi-managed-1793123729239-a63d5d.json`
- `doc/05_testing/evidence/kimi-macos-20261028/kimi-rules-1793123572082-399108.json`
- `doc/05_testing/evidence/kimi-macos-20261028/official-source-1793123673.json`
- `doc/08_project/KimiCode与QoderCN双角色接入实施计划.md`
- `scripts/acceptance/kimi-qoder-cn/README.md`
- `scripts/acceptance/kimi-qoder-cn/kimi-evidence.mjs`
- `scripts/acceptance/kimi-qoder-cn/kimi-evidence.test.mjs`
- `scripts/acceptance/kimi-qoder-cn/kimi-lifecycle.mjs`
- `scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs`
- `scripts/acceptance/kimi-qoder-cn/probe.mjs`
- `src/trivium/adapters/agy-events.ts`
- `src/trivium/adapters/agy.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/util/exec.ts`
- `test/contract/doc-archive-index.test.ts`
- `test/helpers/doc-archive-index.ts`
- `test/unit/deny-matrix.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":45,"grep":8,"glob":1,"run_command":0,"project_reads":25}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
