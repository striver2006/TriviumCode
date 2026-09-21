---
schema: trivium.review.v1
topic: zcode-模型覆盖落点
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.7
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260921T124003Z
rerun_index: 1
snapshot_hash: sha256:1591e9bec0682e56512d803f062f36c422eb18cd1cbaaaa25bb28630e864c570
blind: true
started_at: 2026-09-21T12:40:04.026Z
finished_at: 2026-09-21T12:54:07.465Z
duration_s: 339
tool_calls:
  read: 31
  grep: 12
  glob: 0
  run_command: 0
  project_reads: 18
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 2
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
joint_check:
  state: skipped-insufficient-sides
  effective_sides: 1
heterogeneous: true
session_id: 25f381b5-5790-43c4-ae9f-c6d91dceed1f
---

# 代码审查：zcode-模型覆盖落点

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260921T124003Z`
> ｜ 本轮审核者 codex、gemini

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最危险问题在于 probeReadonlyFlags 手工解构环境对象时丢弃了三个 ZCODE_* 目录键，导致宿主预置 ZCODE_DATA_BASE_DIR 时无法被 run() 清除，FZi 会推导个人配置使空 HOME 隔离失效并烧配额（AGY-01）。
探针臂 replaceApiKeys 仅替换名为 apiKey 的键，对 token、headers 等其他凭据形态存在遗漏，且在非本地鉴权 provider 下可能打破零配额假设（AGY-02）。
测试用例中存在 M1 式假阳性测试盲区，未覆盖 run() 在未尝试覆盖时 model_override_applied 字段缺席的契约（AGY-03）。
RUNBOOK 与设计文档 11.3 存在残留的 provider_config_copy 与 personalOverride 描述（AGY-04）。
路线 L 核心逻辑与限定机制成立，修复上述问题后方可放行。

**结论**：`request-changes`

## 审查意见（共 4 条：重要 1 ｜ 次要 2 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts:155-159` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：probeReadonlyFlags 在构造子进程环境时手工解构丢弃了 zcodeProviderEnv 返回的三个 ZCODE_* 目录键，导致宿主预置 ZCODE_DATA_BASE_DIR 时子进程不会被清除该变量，破坏空 HOME 隔离并导致旗标探测烧配额。

**依据**：查阅 src/trivium/probes/zcode.ts:155-159，代码写作 `const { [ZCODE_BUILTIN_PROVIDER_ENV]: builtinFile } = await zcodeProviderEnv(entry); const providerEnv = { [ZCODE_BUILTIN_PROVIDER_ENV]: builtinFile, [ZCODE_PERSONAL_PROVIDER_ENV]: undefined };`，没有继承 zcodeProviderEnv 返回的 ZCODE_DIR_ENV_KEYS（ZCODE_DATA_BASE_DIR, ZCODE_HOME, ZCODE_STORAGE_DIR）。查阅 src/trivium/util/exec.ts:110-114，run() 仅在 opts.env 显式提供且值为 undefined 时才会执行 delete childEnv[k]，缺席则原样透传 process.env。结合 M0 报告 P-28 机理，宿主若预置 ZCODE_DATA_BASE_DIR，0.16.9 CLI 的 FZi 会按其解析个人配置根，空 HOME 隔离失效，7 次探测将全部触发真实模型调用。

**建议**：改用 `const providerEnv = await zcodeProviderEnv(entry, undefined, { omitPersonal: true });` 直接获取包含内置路径、个人键 undefined 以及三个目录键 undefined 的完整环境对象。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts:308-318` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：replaceApiKeys 仅按 k === 'apiKey' 字符串替换哨兵，无法清洗其他凭据字段（如 token、headers 等）；且探针拉起命令未加只读/受限约束，部分 provider（如 openai-compatible 或本地免密端点）不会停在本地鉴权层，打破 --no-model-calls 零调用假设。

**依据**：查阅 src/trivium/probes/zcode.ts:308-318，replaceApiKeys 仅匹配 k === 'apiKey' && typeof v === 'string'，若 custom provider 在 headers（如 Authorization: Bearer ...）或以 token/secret 存储凭据，真实凭据将被原样写入探针副本。查阅 src/trivium/probes/zcode.ts:393，执行命令为 [entry, '--prompt', 'ok', '--cwd', cwd, '--json', '--no-color']，对于不要求本地 apiKey 格式校验的 provider，CLI 会直接向 baseURL 发出真实 HTTP 网络请求，在离线/无网络时将 hang 住直至超时，若为本地端点甚至会成功执行并退 0，打破零网络请求假设。

**建议**：扩展凭据清洗字段（包括 token, secret, headers 等常见字段），并在探针执行时考虑传入 --mode plan 及工具禁用参数以限制网络与命令执行风险。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/zcode-model-selection.test.ts:308-363` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：用例缺少对 zcodeAdapter.run 在未尝试覆盖（overrideAttempted === false）时 model_override_applied 字段缺席（undefined）契约的端到端咬住验证，也缺少返回 true/false 的端到端断言。

**依据**：查阅 test/unit/zcode-model-selection.test.ts:308-363，全文件仅有一处 run() 端到端测试，且仅测试了 model: 'GLM-5.3-Flash'（尝试覆盖）且未生成 rollout（回读为 null）这一种情况。没有任何用例测试当 req.model 为 null 或限定失败（route: 'global'）时 zcodeAdapter.run() 返回的 model_override_applied 是否确为 undefined（缺席）。若将 zcode.ts:607 的条件展开改为无条件恒写 { model_override_applied: override.applied ?? null }，现有所有测试依然全部通过，存在 M1 式假阳性盲区。

**建议**：在 zcode-model-selection.test.ts 中补充 run() 端到端测试：断言未指定模型或限定失败时，返回结果中 model_override_applied 属性缺席（'model_override_applied' in result === false），以及模拟日志成功回读时正确产出 true / false。

### AGY-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/06_deployment/RUNBOOK_pipeline_ops.md:266` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：RUNBOOK 排障手册中残留了 v1.3.32 已废弃的 provider_config_copy 状态指引，设计文档中也残留了 personalOverride 引用。

**依据**：查阅 doc/06_deployment/RUNBOOK_pipeline_ops.md:266，排障说明写道「为 provider_config_copy 说明副本写了但 CLI 没按它走」，但路线 L 代码中 home.route 只有 config_copy 与 global，该值在运行时永不可能出现；查阅 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:2418，末句仍残留「模型覆盖走个人那份的每运行副本（v1.3.32，personalOverride）」，与前面第 2405 行要点 1 的路线 L 改判冲突。

**建议**：将 RUNBOOK_pipeline_ops.md:266 中的 provider_config_copy 改为 config_copy；将设计文档第 2418 行的过期表述修正为路线 L 的说明。

## 认为正确的部分

- 路线 L 根因改判准确：查清 EV-81 注入个人变量导致 CLI 跳过 legacy 导入，改由副本 HOME 省略个人键、利用 CLI 自身的 importLegacy 机制读取副本 model.main，设计轻量且凭据面缩减至一份
- 限定改由 qualifyAgainstCliConfig 按副本源 cli/config.json 自身 provider 键派生，彻底切断了与探针回读 UUID 形态的异源耦合，成功修复当前活缺陷
- probeModelOverride 臂改用哨兵密钥替代拉起后主动终止，消除了竞态条件；且临时目录清理严格依赖 makeTempDir 返回值，落实了事故教训
- decideModelOverride 抽成纯函数并仅比对 modelId 段，有效防范 providerId 形态不同导致的假阴性误报，guard 仅告警不阻断的设计边界合理

## 未覆盖范围（本侧盲区）

- 真实 ZCode 0.16.9 CLI 二进制文件及桌面端运行时行为（本审查在无厂商 CLI 执行权限的环境下进行静态代码与逻辑审查）
- 真实网络环境下各外部 LLM Provider API 端点在接收哨兵密钥时的实际响应状态码与延迟表现

## 实际查阅的项目文件

- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/REPORT_2026-09-11_m0_probe.md`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/08_project/BACKLOG.md`
- `skills/dual-critic/schema/run.v2.json`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/guard.ts`
- `src/trivium/review.ts`
- `src/trivium/types.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/secrets.ts`
- `test/unit/zcode-model-selection.test.ts`
- `test/unit/zcode-provider-env.test.ts`
- `CLAUDE.md`
- `AGENTS.md`
- `.reviews/zcode-模型覆盖落点/plan/2026-09-21-zcode-模型覆盖落点-r2-claude.md`
- `.reviews/zcode-模型覆盖落点/plan/2026-09-21-zcode-模型覆盖落点-r3-revised-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":31,"grep":12,"glob":0,"run_command":0,"project_reads":18}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
