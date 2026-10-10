---
schema: trivium.review.v1
topic: Agent双模式接入真实准入收口
stage: code
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
run_id: 20261010T130139Z
rerun_index: 1
snapshot_hash: sha256:774ddd80b44171e84664e0bde3e56c11c4be45ee423d0c5fea28a9a0ca3f2592
blind: true
started_at: 2026-10-10T13:01:44.750Z
finished_at: 2026-10-10T13:11:39.405Z
duration_s: 595
tool_calls:
  read: 38
  grep: 5
  glob: 4
  run_command: 0
  project_reads: 31
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 2
  minor: 1
  nit: 1
degraded: true
parse_fallback: false
peer_deny: false
drift: true
peer_leak:
  hit: true
  via: path
  category: sensitive
  paths:
    - doc/05_testing/evidence/agent-access-20261010-closeout-r2/routes/static-qwen-version-1/result.json
    - doc/05_testing/evidence/agent-access-20261010-closeout-r2/routes/static-qwen-version-2/result.json
    - doc/05_testing/evidence/agent-access-20261010-closeout-r2/routes/claude-qwen-read-2/requested.json
    - doc/05_testing/evidence/agent-access-20261010-closeout-r2/routes/claude-qwen-deny-grep-2/result.json
joint_check:
  state: skipped-insufficient-sides
  effective_sides: 1
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
override_reason: 左侧模型信息缺失
session_id: 2018f90f-1cfc-485a-952f-1e5a48e5db53
---

# 代码审查：Agent双模式接入真实准入收口

> Critic-A · Google Antigravity ｜ 回读模型 `gemini-3.8-flash-high` ｜ 请求模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261010T130139Z`
> ｜ 本轮审核者 claude、gemini、glm

> ⚠️ **本次为降级轮次**：有入选审核者未能完成，本结论不构成本轮预期的完整多审。实际完成情况见抬头的审核者清单与 run 元数据的 `degraded_reason`。
>
> ⚠️ **审查期间工作树发生漂移**：本结论对应送审时刻的快照，与当前工作树可能已不一致。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **读到了禁读清单内的文件，但不影响本侧结论**：命中的是编排器状态文件或凭据文件，不含任何审查意见，因此不损害背靠背独立性。记此一笔供审计，无需处置。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

本轮取证装置整改在证据判定精准度、悬空软链接状态检测及敏感禁读枚举覆盖上均有实质改进，且如实报告了未测模型边界，未冒进放行 M11 前置；但新交付的 canonical 工具链存在硬编码断裂：
1. scripts/agent-access-closeout-summary.mjs 写死 -1 编号，忽略 Batch E 重跑的 -2 结果并误判指纹不兼容，迫使证据生成依赖证据目录内的派生脚本 summarize-latest.mjs，使 canonical 工具与实际报告分叉；
2. scripts/agent-access-closeout.mjs 写死 static-version 编号（Codex 为 1、Claude 为 2），在从零初始运行或后续版本刷新时会抛出 ENOENT 或读入过期版本；
3. Codex 实际读取臂仅根据输出包含首词判定，未校验命令目标是否指向 README.md，校验强度与 Claude 侧不对称。
建议修复 canonical 脚本的动态版本与轮次匹配逻辑后重新收口。

**结论**：`request-changes`

## 审查意见（共 4 条：重要 2 ｜ 次要 1 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/agent-access-closeout-summary.mjs:19` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：canonical汇总脚本写死 variant -1 路径，导致重跑产出的 -2 臂被静默忽略并误判指纹漂移失效，与计划声明的唯一汇总事实源分叉

**依据**：scripts/agent-access-closeout-summary.mjs 第 19 行硬编码 const dir = path.join(root, 'routes', `${agent}-${model}-${arm}-1`)。在 closeout-r2 中，Batch E 针对 Batch C 刷新了 Claude 路线生成了大量 -2 目录（如 claude-qwen-read-2 等），且 .codex/config.toml 哈希在 C 与 D 间漂移。运行 canonical 脚本时只读 -1 目录，导致第 26-32 行的指纹比对使用过期 -1 请求快照而判定 compatible: false，产生全部 Claude 路线未通过的假象。Driver 在 evidence 目录下另建 summarize-latest.mjs（第 19-20 行动态查找 candidates 降序取首项）以生成最终报告的 summary JSON，且在 code-source-freeze.json 登记已知局限「canonical consumer只读variant1，派生consumer读取最新显式编号」。这使作为交付代码的 canonical 汇总脚本无法独立复现验收报告，分叉了汇总逻辑。

**建议**：将 summarize-latest.mjs 中动态解析匹配前缀的最大数字 variant（或支持 CLI 参数指定 variant 编号）的逻辑合入 scripts/agent-access-closeout-summary.mjs，使 canonical 工具本身具备汇总结算重跑结果的能力，消除证据目录内的派生私有脚本。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/agent-access-closeout.mjs:48` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：canonical取证脚本写死 static-version 编号（Codex 为 1、Claude profile 为 2），使从零初始运行或后续版本重跑均发生断裂

**依据**：scripts/agent-access-closeout.mjs 第 48 行硬编码 const versionFile = path.join(root, 'routes', `static-${agent === 'codex' ? 'codex' : profile}-version-${agent === 'codex' ? '1' : '2'}/result.json`)。若在全新环境下首次运行（未曾跑过 variant 2），执行 static-version-1 之后直接跑 claude 路线的 read/write 臂，会因查找 static-*-version-2 失败而抛出 ENOENT；反之，若在 Batch E 中已跑出 static-*-version-3，该处依然读取 version-2 的旧结果。此硬编码系针对当次测试分批历史的手工缝合，不具备 canonical 脚本的通用性。

**建议**：修改 versionFile 解析逻辑，改为动态读取当前 routes 目录下对应 static 前缀的最大有效版本序号文件，或通过运行上下文显式传入版本文件路径，避免硬编码三元表达式 '1' : '2'。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/agent-access-closeout.mjs:233` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：Codex读取臂判定仅按输出包含首词判定，未校验命令目标是否指向 README.md，与 Claude 侧精确路径核验存在口径不对称

**依据**：scripts/agent-access-closeout.mjs 第 233 行判定 actual_read: trace.commands.some(c => c.exitCode === 0 && c.output.includes(firstWord))。而对比第 204-205 行 Claude 侧严密校验了工具名为 Read 且参数 file_path 归一化路径完全等于 fx.openFile。Codex 侧任何退出码为 0 且输出恰好含有 firstWord 文本的命令（如 echo 等）均会误判为 actual_read 通过。Driver 在 code-source-freeze.json 承认「canonical Codex实际读取判定只看成功command marker，本轮独立审计另验证README parsed_cmd精确目标」，说明取证主配方自身存在校验漏洞，依赖外部审计脚本事后补漏。

**建议**：在 Codex trace.commands 中解析命令文本，增加命令必须包含 README.md 或 fx.openFile 相对路径的断言，收紧实际读取校验，使其与 Claude 侧的严格目标文件核验口径保持同等防护强度。

### AGY-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/agent-access-closeout.mjs:167` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：受控传输臂硬编码生产对比路径 routes/claude-kimi-pro-read-1/result.json

**依据**：scripts/agent-access-closeout.mjs 第 167 行硬编码 const productionFile=path.join(root,'routes/claude-kimi-pro-read-1/result.json')。当生产臂进行过重跑（如产生 -2 编号）或初始批次未按固定 -1 命名时，production 将为 null，导致第 172 行 permission_mode_same_as_live 比对失效。

**建议**：将生产基准文件的查找改为动态匹配最新的生产 read 结果文件，或通过参数化传入比对基准。

## 认为正确的部分

- scripts/agent-access-evidence.mjs 强化了写负对照判定逻辑，引入真实 cwd 相对路径解析、/private/var 归一化、唯一隔离目标前后状态（captureFileState 严密区分悬空软链接与不存在）以及对工具注册层报错的配对剥离与正则校验，Codex 侧亦严格要求命令 ID、特定钉死命令、沙箱拒绝输出与 TRIVIUM_WRITE_DENIED 标记。
- 禁读负对照不再使用内联简陋列表，而是复用生产 enumerateDenyPaths 动态枚举，完备覆盖注册表同行审查件与 .env，并在结果中逐文件记录调用 ID 与配对权限拒绝。
- 严格坚守准入事实边界：对当前版本（Claude 2.1.296、Codex 0.162.1）实测中未产生真实写尝试的模型（Kimi coding/k3、DeepSeek flash、Codex Luna 以及 Batch E 中的 V4 pro）如实记录为未测，拒绝通过降低标准、权限诊断或受控传输模拟来虚报准入；明确指出 M11 第 12 步前置任务尚未完成，文档与 ADR_003 均如实记录了事实与限制。

## 未覆盖范围（本侧盲区）

- 本审查员无命令执行权限，未在真实 macOS 终端实际跑动 node scripts/agent-access-closeout.mjs、doctor 或真实外部厂商 CLI；所有执行逻辑与输出均为基于代码与留痕文件的静态推理。
- dist/test/src/trivium/ 下预编译 bundle 的二进制执行期环境一致性（由 Driver 本地构建产物及测试用例维持）。
- 真实各厂商模型服务端的真实推理行为与网络连通性。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `.reviews/Agent双模式接入真实准入收口/plan/2026-10-10-Agent双模式接入真实准入收口-r2-codex.md`
- `scripts/agent-access-evidence.mjs`
- `scripts/agent-access-closeout.mjs`
- `scripts/agent-access-closeout-summary.mjs`
- `test/unit/agent-access-budget.test.ts`
- `scripts/agent-access-launch.mjs`
- `doc/05_testing/REPORT_2026-10-10_agent_access_closeout.md`
- `doc/05_testing/README.md`
- `doc/02_design/ADR_003_agent_access.md`
- `doc/05_testing/evidence/agent-access-20261010-closeout-r2/launch.mjs`
- `doc/05_testing/evidence/agent-access-20261010-closeout-r2/probe.mjs`
- `doc/05_testing/evidence/agent-access-20261010-closeout-r2/summarize-latest.mjs`
- `doc/05_testing/evidence/agent-access-20261010-closeout-r2/audit-snapshots/code-source-freeze.json`
- `doc/05_testing/evidence/agent-access-20261010-closeout-r2/audit-snapshots/sensitive-effects.json`
- `doc/05_testing/evidence/agent-access-20261010-closeout-r2/routes/static-qwen-version-1/result.json`
- `doc/05_testing/evidence/agent-access-20261010-closeout-r2/routes/static-qwen-version-2/result.json`
- `doc/05_testing/evidence/agent-access-20261010-closeout-r2/routes/claude-qwen-read-2/requested.json`
- `doc/05_testing/evidence/agent-access-20261010-closeout-r2/routes/claude-qwen-deny-grep-2/result.json`
- `src/trivium/probes/fixture.ts`
- `src/trivium/util/fsx.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/probes/codex.ts`
- `src/trivium/adapters/claude-trace.ts`
- `test/unit/registry-parity.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":38,"grep":5,"glob":4,"run_command":0,"project_reads":31}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
