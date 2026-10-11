---
schema: trivium.review.v1
topic: Agent双模式接入真实准入收口
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.3.3
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: high
effort_effective_source: envelope
tier: null
tier_source: legacy
run_id: 20261010T232715Z
rerun_index: 5
snapshot_hash: sha256:f1cd8d250fb35aff75b015f8bc41e0fd179dc4938726b74279b04ddcb0474bd5
blind: true
started_at: 2026-10-10T23:27:19.711Z
finished_at: 2026-10-10T23:42:01.399Z
duration_s: 274
tool_calls:
  read: 28
  grep: 7
  glob: 0
  run_command: 0
  project_reads: 23
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: true
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
  - left: claude
    right: gemini
    status: different-family
    left_model: qwen3.8-flash
    right_model: gemini-3.8-flash-high
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：qwen / gemini
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
override_reason: 左侧模型信息缺失
session_id: 33429a1f-4cf3-4e61-94e3-ceb239642fc2
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261010T232715Z` ｜ 第 5 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **审查期间工作树发生漂移**：本结论对应送审时刻的快照，与当前工作树可能已不一致。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

扫描深度 6→7 整改方案定位准确、边界克制，成功关闭了 5 段 ASCII 根加 2 级后代场景下 walkSensitive 漏枚举深度 7 敏感文件导致 probeClaudeDirectories 抛错的内部缺陷。
方案严格遵守父目录深度 8 为未覆盖边界的不变式，未改动 sensitive_globs 及其稳定哈希，保持了现行排除逻辑与软链不遍历原则。
授权机制严格落地用户「授权总 8 轮，先审扫描深度整改，再完整代码重审」要求，通过 formal-round-authorization-v3.json、formal-round-authority.json 与 round-guard.mjs 锁死第 7 轮 B/plan 与第 8 轮 C/code 边界。
启动前检查通过 formal-start-precheck.mjs 强制检验 settings 字节数（<=131072）与真实目录事实消费，杜绝未取样或超软线启动。
对 4 组生产写缺口维持原标准不妥协，四目标共享入口迁移机制具备完整备份与可逆回滚路径。
提出的建议聚焦于 freeze-drift.test.ts 补充目录软链不遍历的显式回归用例，以及正文遗留版本代号的小幅修缮。整体计划严密，予以通过。

**结论**：`approve-with-nits`

## 审查意见（共 2 条：次要 1 ｜ 吹毛求疵 1）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/freeze-drift.test.ts:47` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：walkSensitive 在提升父目录深度至 7 时，虽然设计上不跟随目录软链后代、仅判定软链项自身 glob，但现有 test/unit/freeze-drift.test.ts 仅有一条浅层 .env.production 存在性断言，缺乏目录软链指向深层目录时的回归锚点；需防止未来重构时使用跟随软链的读取方式导致环形递归或目录跨越。

**依据**：src/trivium/freeze.ts:360-380 中使用 readdir({ withFileTypes: true }) 与 e.isDirectory()，在 Node.js 中软链项 e.isDirectory() 恒为 false；test/unit/freeze-drift.test.ts:42-50 仅测试了单一 config/.env.production，未对目录软链目标后代不遍历、软链自身 glob 判定形成用例守护。

**建议**：在 test/unit/freeze-drift.test.ts 中补充深度 6/7 敏感文件夹具的同时，显式构造一个指向深层目录的软链接项，断言软链目标下的后代不被遍历，防止未来文件扫描器重构破坏不跟随软链的不变式。

### AGY-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r11-codex.md:23` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：被审计划正文第一节首句保留了「本r10送审原稿」字样，与顶部「送审路径校正（r11原稿）」说明产生了版本称谓残留歧义。

**依据**：.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r11-codex.md:1-3 明确指出本件为 r11 修正稿（校正了 test/unit/freeze.test.ts），但在第 23 行沿用了 r10 原句「本r10送审原稿在已获批r9七条整改及11条追加约束上...」。

**建议**：在后续裁决件或修订计划中统一版本称谓为 r11，消除历史草稿继承引入的局部文案脱节。

## 认为正确的部分

- 准确识别并隔离了 walkSensitive 中 depth > 6 截断导致深度 7 敏感文件漏枚举的内部断言失败成因，坚持最小化将父目录上限微调为 7，坚守深度 8 为明确未覆盖边界。
- 轮数例外控制严格闭环：以 formal-round-authorization-v3.json 和 formal-round-authority.json 的 sha256 强绑定当前权威，第 7 轮仅限 B/plan，第 8 轮仅限 C/code，坚守不重置历史计数与不修改历史 run 失败状态的纪律。
- 第 8 轮代码启动前守卫 formal-start-precheck.mjs 严密有效：不仅比对源码与已安装 bundle 的 hash，且在 settings 超过 131072 软上限、存在 skipped 规则或缺少真实可消费目录事实时直接拒绝 spawn，防止带病进入代码审。
- 坚持高标准准入要求，对 4 个未注册写工具的模型组合拒绝用权限诊断替代真实生产写负对照，如实登记前置未完成状态。
- 共享七入口迁移方案详尽定义了整目录备份至 ~/.trivium/backups/、逐文件哈希核对及原子回滚机制，操作步骤安全可逆。

## 未覆盖范围（本侧盲区）

- 审查员处于只读环境，无法执行 Node/Bash 命令，未能实测 launch-v3.mjs 在终端中的并发锁表现与真实启动拦截。
- 未能在真实终端中运行 doctor 验证三路线 Claude 在 5 段根及 30 文件夹具下的真实耗时与配额消耗。
- 未能在线调用真实模型 CLI 验证深度 7 敏感文件入列后，实际 settings 注入与模型读取拦截的表现。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r11-codex.md`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r4-gemini.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/ADR_003_agent_access.md`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v3.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v3.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/review-sensitive-depth-plan-batch.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard.mjs`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/sensitive-depth-diagnostic.json`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/sensitive-depth-plan-amendment-proposal.md`
- `src/trivium/adapters/claude.ts`
- `src/trivium/freeze.ts`
- `src/trivium/probes/claude-directory.ts`
- `test/integration/claude-directory-adapter.test.ts`
- `test/integration/claude-structured-probe.test.ts`
- `test/unit/agent-access-recovery.test.ts`
- `test/unit/claude-directory.test.ts`
- `test/unit/deny-matrix.test.ts`
- `test/unit/freeze-drift.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":28,"grep":7,"glob":0,"run_command":0,"project_reads":23}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
