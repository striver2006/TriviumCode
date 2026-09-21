---
schema: trivium.review.v1
topic: zcode-模型覆盖落点
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.7
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260921T095827Z
rerun_index: 1
snapshot_hash: sha256:208cbfb63300d0c6dae4413f2259fea5f437bd799dfc164b92e2efd0627b4207
blind: true
started_at: 2026-09-21T09:58:28.691Z
finished_at: 2026-09-21T10:13:23.832Z
duration_s: 452
tool_calls:
  read: 47
  grep: 30
  glob: 5
  run_command: 0
  project_reads: 29
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 1
  major: 2
  minor: 2
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: ce98a87c-1f4d-45c5-b607-9b56241924b1
---

# 计划审查：zcode-模型覆盖落点

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260921T095827Z`
> ｜ 本轮审核者 codex、gemini

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

【最危险】D-3 成对门控将破坏 probeReadonlyFlags 的零配额前提或致使旗标探针全报 indeterminate。
方案 §三 E 的比对公式在未指定模型（req.model === null）时误判为 false，将导致常规运行误报模型失效告警。
新增必填字段 model_override_applied 的 null 语义发生双重塌缩，且将特定厂商落点的实现细节强行跨族必填。
splitZcodeModel 对无 / 输入缺乏防空边界，未校验切分结果可能导致定点改写产生被 .strict() 拒绝的非法配置。
scrubZcodeHome 按名整删载体遗漏了 CLI 可能写入的 <HOME>/.zcode/v2/credentials.json。
总体方案采用独立 HOME 下个人配置副本定点改写 defaultModelSelection 的大方向完全成立，清扫论域闭环。
建议完善旗标探针的双变量配合逻辑、修正无请求模型时的比对分支、收窄新字段为可选三态，修复后准予实施。

**结论**：`request-changes`

## 审查意见（共 6 条：阻断 1 ｜ 重要 2 ｜ 次要 2 ｜ 吹毛求疵 1）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 D-3` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：D-3 的成对门控与 B-3 约束产生严重逻辑冲突，未覆盖 `probeReadonlyFlags`，将导致旗标探针全报 `indeterminate` 或破坏零配额前提。

**依据**：读 `src/trivium/probes/zcode.ts:151-155`、`doc/05_testing/REPORT_2026-09-11_m0_probe.md`（P-30）与被审计划 §二 B-3、§三 D-3。`probeReadonlyFlags` 为保证零配额前提（P-30），刻意只注入内置变量并将个人变量显式置 `undefined`。若 B-3 所述「只给一个变量抛错」属实，CLI 会在参数解析前报错退出并命中 `ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE`，使全部候选旗标判为 `indeterminate`；若 D-3 改为成对门控，在个人配置缺失的环境下内置变量被置 `undefined`，CLI 同样因 P-28 报错。计划改动清单（§四）完全未将 `src/trivium/probes/zcode.ts` 列入考量。

**建议**：在 `probeReadonlyFlags` 中采用「注入内置真实路径 + 在临时空 HOME 下放置一份空的合成个人配置（无 defaultModelSelection 与 key）」方案，既满足 B-3 的双变量必需契约，又使 CLI 在参数解析后停在无凭据停点（零配额）；并同步修改 `src/trivium/probes/zcode.ts` 的调用逻辑与测试夹具。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 E` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：模型比对公式在未指定模型（`req.model === null`）时恒判为 `false`，将导致所有未覆盖模型的常规运行产生模型失效的误报告警。

**依据**：读 `src/trivium/adapters/zcode.ts:541`、`src/trivium/types.ts:1467-1478`、`src/trivium/guard.ts:737-840` 与被审计划 §三 E。当用户未指定 `--model-glm` 时，`req.model` 为 `null`，`qualified` 为 `null`。若适配器按计划所述执行 `modelEffective === qualified`，在正常回读出生效模型（非 null）时必定为 `false`。`guard.ts` 的 `renderGuardWarnings` 见 `false` 即播报「请求模型 null 未生效，实际跑的是 ...」，导致默认模型运行每轮误报警报。

**建议**：比对逻辑必须增加 `req.model === null` 守卫：当未请求模型覆盖或未走覆盖路由时，不执行比对，该字段应为 `null`（代表无需/未做覆盖比对），仅在明确请求了覆盖且回读到生效值时判定 `true` 或 `false`。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 E` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：`CriticResult.model_override_applied` 作为跨族必填字段设计不当，`null` 语义发生塌缩，且将特定厂商落点细节推向全局契约。

**依据**：读 `src/trivium/types.ts:1467-1495`、`src/trivium/adapters/agy.ts:358-387` 与被审计划 §三 E。计划令其余四家适配器一律硬编码 `null`（理由为「本族未实现」），而 zcode 侧 `null` 的含义则是「本族已实现但本轮回读不到」。这使 `null` 混淆了能力缺失与运行时观测失败。此外，Codex/Agy/Claude 均原生支持命令行参数指定模型，并不存在「通过配置文件副本进行 override」的机制。

**建议**：参考 `CriticResult.model_route` 的做法，将该字段设计为可选字段 `model_override_applied?: boolean | null`（仅在发生模型覆盖尝试的场景下产出），或重定义为通用语义 `model_matches_requested: boolean | null` 并在各家适配器中如实实现与请求模型的比对，使 `null` 的语义严格限定为「运行时生效模型未核验（unverified）」单一含义。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 A.3` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：`splitZcodeModel` 未明确无 `/` 时的防空兜底，缺少与 schema `min 1` 约束的闭环。

**依据**：读 `src/trivium/adapters/zcode.ts:49-55` 与被审计划 §二 B-2、§三 A.3、§六 6.1(2)。B-2 说明 `defaultModelSelection` 的 `providerId` 与 `modelId` 均为 `string(min 1)` 且 `.strict()`。若输入未包含 `/`（例如 `modelIdForm` 缺失或短名未补全成功），单纯使用 `lastIndexOf('/')` 会导致 `providerId` 切割出空字符串或异常字符，写入副本后将被 ZCode 的 schema 校验拒掉崩溃。

**建议**：明确 `splitZcodeModel` 签名接收 `(model: string | null, modelIdForm: string | null): { providerId: string; modelId: string } | null`。若无法切分出有效的两个非空字段则返回 `null`；`prepareZcodePersonalConfig` 遇到 `null` 时直接回退到 `route: 'global'`，避免向副本写入非法 JSON。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §三 C` |
| 类别 | security ｜ 层次 plan |
| 置信度 | high |

**问题**：`scrubZcodeHome` 按名整删清单遗漏了 CLI 运行时可能派生的 `<run_home>/.zcode/v2/credentials.json`。

**依据**：读 `src/trivium/adapters/zcode.ts:316-335`、`src/trivium/adapters/codex-home.ts:92-95` 与被审计划 §二 B-6、§三 C。B-6 表明 CLI 的凭据存储路径为 `~/.zcode/v2/credentials.json`，B-7 指出 CLI 具有回写与迁移机制。计划自身在 §三 C 中强调「已知含凭据的载体按名整删，形态未知的过扫描器」。若 CLI 运行期在副本 HOME 下写入了 `v2/credentials.json`，仅靠正则后验扫描存在漏网风险。

**建议**：在 `scrubZcodeHome` 中将 `path.join(homeDir, '.zcode/v2/credentials.json')` 与 `provider_config.json` 一同加入 `carrier` 按名整删清单，利用 `fs.rm(..., { force: true })` 的幂等性，存在即删并计入 `deleted`，不存在则静默无害。

### AGY-06 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §四` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：`skills/dual-critic/schema/run.v2.json` 中的 `model_route` 枚举必须显式列入改动同步清单。

**依据**：读 `skills/dual-critic/schema/run.v2.json:496-500` 与 `test/unit/known-forms-parity.test.ts:263-308`。当前 schema 中 `model_route` 具有严格的 `enum: [\"env\", \"config_copy\", \"global\"]` 约束。新增 `provider_config_copy` 取值若不同步修改 schema，会导致 ajv 校验失败及契约对账单测报警。

**建议**：在计划 §四 中明确点名修改 `skills/dual-critic/schema/run.v2.json` 与 `dist/test/skills/dual-critic/schema/run.v2.json` 中的 `model_route` 枚举，不要作为「实施时按实际 schema 核」的不确定项。

## 认为正确的部分

- 将个人 provider 配置在独立运行目录下建立临时副本（0600 权限），仅针对 config.defaultModelSelection 做定点改写，既满足了 ZCode 0.16.9 的新落点要求，又严格遵守了「不修改用户全局配置（纪律 5）」以及「防止 CLI 回写污染用户真实文件（B-7）」的隔离纪律。
- 副本路径置于 zcodeHomeUnder(sideDir) 之下，天然纳入既有 scrubZcodeHome 的清扫论域，不增加新的外部路径或扩大权限暴露面。
- 放弃合成最小 provider 配置，采用保留其余键原样搬运的方案，正确避开了 Zod .strict() 必填校验与用户自定义 provider/规则丢失的风险。
- 坚持「响亮但不阻断」的处理方针，未生效时给出清晰警告而非直接打断整个流水线，符合演进阶段的设计取向。

## 未覆盖范围（本侧盲区）

- 未在真实机上执行带配额的 ZCode CLI 模型调用，未实测特定非智谱模型（如基于自定义 provider 的第三方模型）在 `defaultModelSelection` 下的端点兼容性。
- 未测试 macOS 极端沙箱环境或多用户目录环境下的真实文件权限继承情况。
- 未深入审计 ZCode 桌面端内部 `app.asar` 与 CLI 的完整通信与鉴权细节。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/REPORT_2026-09-11_m0_probe.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/codex-home.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/adapters/agy.ts`
- `src/trivium/config.ts`
- `src/trivium/guard.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/review.ts`
- `src/trivium/scrub.ts`
- `src/trivium/secrets.ts`
- `src/trivium/types.ts`
- `src/trivium/util/exec.ts`
- `skills/dual-critic/schema/run.v2.json`
- `test/unit/credential-scrub.test.ts`
- `test/unit/known-forms-parity.test.ts`
- `test/unit/zcode-provider-env.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":47,"grep":30,"glob":5,"run_command":0,"project_reads":29}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
