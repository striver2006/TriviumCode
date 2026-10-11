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
run_id: 20261010T175354Z
rerun_index: 3
snapshot_hash: sha256:8fe8e97b53ffbc8618ecdc99bfd8b1674b6d3b12ea5a5f3b245285d473199528
blind: true
started_at: 2026-10-10T17:53:58.865Z
finished_at: 2026-10-10T18:11:47.379Z
duration_s: 544
tool_calls:
  read: 39
  grep: 18
  glob: 3
  run_command: 0
  project_reads: 25
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 4
  nit: 0
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
session_id: f331d5b7-e7e1-4e17-992d-741e4cf5326f
---

# 计划审查：Agent双模式接入真实准入收口

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261010T175354Z` ｜ 第 3 轮
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **审查期间工作树发生漂移**：本结论对应送审时刻的快照，与当前工作树可能已不一致。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本计划整体严密扎实，彻底修复了 r2 阶段将构建重装推迟至代码审之后的依赖倒置阻断缺陷，完整覆盖了七项遗留整改、共享七入口可逆迁移、真实准入矩阵与安装收口。整改实施细节中仅存若干次要完善点：CLAUDE-01 项目 hash 需同步覆盖 test/integration/claude-directory-adapter.test.ts 及 doctor.ts 清理逻辑，CLAUDE-02 回放 fixture 需明确检入 test/fixtures/，预算扩容须面向 admission/review 双池分别发布。总体方案可行，予以通过并附带次要意见。

**结论**：`approve-with-nits`

## 审查意见（共 4 条：次要 4）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r6-codex.md:17` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：CLAUDE-01 计划在 directoryGuard 中校验项目 hash 事实，未将已有集成测试 test/integration/claude-directory-adapter.test.ts 纳入同步适配范围，实施后极易在 npm run check 时被直接打红。

**依据**：test/integration/claude-directory-adapter.test.ts:29-34 在集成测试中显式构造了 probe.directory_deny_verified、probed_at 与 fingerprint，但未设置新增的 directory_deny_project_hash；而计划 §二 CLAUDE-01 规定「缺值或不符一律 consumed={}，逐文件回退」，若集成测试未同步设置项目 hash，该测试第 50 行断言 compressedTools 将由 ['Read', 'Grep', 'Glob'] 回退为空数组，导致自动化检查断裂。

**建议**：在 CLAUDE-01 的回归与适配范围中显式补充 test/integration/claude-directory-adapter.test.ts，在 mock probe 时同步注入与 cfg.review.sensitive_globs 计算一致的 projectHash 事实。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r6-codex.md:17` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：CLAUDE-01 计划向 ClaudeProbe 扩展可选项目 hash 字段，但遗漏了 src/trivium/doctor.ts 中重置路线探针快照时的同步清理逻辑。

**依据**：src/trivium/doctor.ts:808-810 在路线不稳定时清理 snapshot.directory_deny_verified = {}、fingerprint = null、probed_at = null，并在 819-820 行对 existing.probe 做相同三项置空。若 types.ts 新增项目 hash 字段后 doctor.ts 未同步清理该字段，当 doctor 探测期间路线漂移重置时，会残留陈旧的项目 hash 孤儿字段，破坏探针快照的一致性约束。

**建议**：在 doctor.ts:808 与 819-820 的重置逻辑中同步将新增的项目 hash 事实清空为 null，保持四项目录事实字段的生命周期严格对称。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r6-codex.md:18` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：CLAUDE-02 提取历史实际 deny_paths 回放 fixture 并随 check 运行，但未明确该 fixture 在仓库中的落盘路径及消费测试文件，缺乏离线可复现性规范。

**依据**：计划 §二 CLAUDE-02 提出从 run-20261010T170416Z.json 提取非敏感路径集合并在 check 中回归，但未界定该 fixture 应落盘在静态夹具目录（如 test/fixtures/claude-deny-paths-replay.json）还是由特定测试（如 test/unit/claude-directory.test.ts）读取。因运行归档目录位于用户目录或敏感目录且受隔离保护，测试不能在运行时动态依赖本地历史 run 文件，必须以静态检入测试夹具的形式保证任何干净工作树均可离线运行。

**建议**：明确回放 fixture 作为静态脱敏 JSON 文件保存在 test/fixtures/ 目录下，并在 test/unit/claude-directory.test.ts 中添加离线读取并验证目录投影规则压缩的测试用例。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r6-codex.md:29` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §三 提及「本轮总CLI池按需要具名扩容到足以覆盖本批」，但底层预算包装器仅支持两独立池（admission 与 review），不存在统一的总池接口。

**依据**：scripts/agent-access-budget.cjs:6-25 严格限定 pool 参数只能为 'admission' 或 'review'，两池各自独立维护 limits 与 extension 序列。当前 review 池已达 38/40，仅余 2 次无法覆盖第 5 轮三家审核；admission 池已达 342/343，仅余 1 次无法覆盖真机补测。若按「总CLI池」合并扩容，将触发 openBudget 校验异常或单一池提前撞顶拒绝 spawn。

**建议**：在计划 §三 中明确预算发布必须针对 admission 与 review 两独立池分别生成幂等扩容记录（extension-*.json），分别设置各自充足的新上限并核对独立台账。

## 认为正确的部分

- 依赖倒置彻底修复：明确要求在业务整改与测试完成后，必须先执行构建、本地重装（dist/install.cjs）与 bundle hash 对账，再发起第 6 轮正式代码双审，避免了旧版未压缩 bundle 引发 spawn E2BIG 的崩溃隐患。
- 准入真实性与前置阻塞定性诚实：对 4 个未注册 Write 工具的模型组合坚持不搞降级替代、不把权限诊断或受控响应偷换为原标准通过；若无法取样如实报告目标未完成，体现了严谨的安全工程操守。
- 共享七入口迁移方案可逆闭环：坚持只读核验前置，采用整目录备份、逐文件哈希比对、可恢复移动以及明确的回滚与冲突恢复机制，未绕过安装器装前冲突检查。
- 七条整改方案定位精准：CLAUDE-01 项目 hash 防漂移、CLAUDE-04 避免大二进制重复哈希、GLM-01 独立解耦错误与权限拒绝断言、GLM-02 限制 ASCII 目录段以及 GLM-03 规范预期异常捕获通道均切中代码现状要害。
- 授权与轮数纪律严守：严格冻结用户追加两轮的 context 事实，台账保留历史 4 轮记录，第 5 轮严格限制为 B/plan，第 6 轮限制为 C/code，坚守闸门审批前置条件。

## 未覆盖范围（本侧盲区）

- 审查员处于只读环境，无法执行 Node/Bash 命令，未能实测 scripts/agent-access-launch.mjs 在扩容后的真实并发 spawn 计数与文件锁稳定性。
- 未能在真实终端中验证 ~/.agents/skills 目录迁移后对本机其他未扫描外部仓库的全局影响。
- 未能在线调用各模型 CLI 验证单命令 cat README.md 在不同模型 prompt 下的实际解析形态（parsed_cmd）。

## 实际查阅的项目文件

- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-11-Agent双模式接入真实准入收口-r6-codex.md`
- `doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md`
- `doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization.json`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-gemini.md`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-r2-gemini.md`
- `src/trivium/probes/claude-directory.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/adapters/claude.ts`
- `test/unit/claude-directory.test.ts`
- `src/install.ts`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-evidence.mjs`
- `src/trivium/types.ts`
- `.trivium/config.yaml`
- `src/trivium/doctor.ts`
- `test/integration/claude-directory-adapter.test.ts`
- `skills/dual-critic/schema/run.v3.json`
- `src/trivium/schemas.ts`
- `src/trivium/gate.ts`
- `scripts/agent-access-budget.cjs`
- `scripts/agent-access-launch.mjs`
- `src/trivium/probes/fixture.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":39,"grep":18,"glob":3,"run_command":0,"project_reads":25}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
