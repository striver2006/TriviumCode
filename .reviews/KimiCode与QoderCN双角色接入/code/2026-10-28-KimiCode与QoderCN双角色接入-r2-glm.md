---
schema: trivium.review.v2
topic: KimiCode与QoderCN双角色接入
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
run_id: 20261027T163726Z
rerun_index: 2
snapshot_hash: sha256:ab2be5077be857b3c74b0ed012480bbc2e8ffcd9d927bfaaa1dbad669e8d6c22
blind: true
started_at: 2026-10-27T16:37:34.610Z
finished_at: 2026-10-27T16:54:37.392Z
duration_s: 1022
tool_calls:
  read: 15
  grep: 12
  glob: 2
  run_command: 0
  project_reads: 19
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 0
  minor: 2
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
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
override_reason: 左侧模型信息缺失
session_id: sess_a8a0daf3-7b1a-4eff-90cc-5e2cc82814b8
---

# 代码审查：KimiCode与QoderCN双角色接入

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261027T163726Z` ｜ 第 2 轮
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

第 1 轮意见的修法已逐项在当前树落位：护栏注入段恢复字面期望表并补 kimi、qoder-cn 两行；schema 新分支无 readonly_enforcement 与 effort、kimi 改引 tiersModelOnly；label 按计划写 Critic-E/F；qoder-cn-model 补齐嵌套 message.model 正反例、回读与请求不符分支及真实证据文件夹具，defaults 非对象与非法档位均抛配置错误；设计 §7.4 落点与 README、QUICKSTART、MANUAL 措辞回填为候选未验收。本轮新查出的只剩三处小项：DRIVER_AGENT_IDS 的注释声称包含 Kimi 与 Qoder CN、与它自己的过滤结果相反；qoder 回退正则保留了一支不要求 model 语境的 using-instead 独立判定、扫描面含 stdout 全文，接线后会误杀含普通英文措辞的合法审查；freeze 的 _meta 角色段正则仍是手写字符类而非注册表派生。主线判断不变：注册表派生与开关闸门、Schema 两段式身份校验、入口渲染与安装查重、证据边界都成立——六份 Kimi 规则控制臂与 tools、failure 证据全部如实保持失败或未测、admission 一律 false，各手册均写明候选与 Driver 开关关闭，没有把未测客户端安全能力写成通过。三条意见均为机械修法，不需要再审一轮。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 3 条：次要 2 ｜ 吹毛求疵 1）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/agents/registry.ts:543（DRIVER_AGENT_IDS 的文档注释）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：注释写「当前可作为 Driver 的 Agent（既有四家 + Kimi Code + Qoder CN）」，而该常量按 driverEnabled 过滤、两家均为 false，实际派生集只有既有四家——critics.test.ts 已把 claude、codex、gemini、glm 四值钉死。同一「登记＝可当 Driver」的措辞族还出现在 config.ts 新增默认段的注释（「先登记为 L2 Driver」）与设计文档术语表（「均可登记为 Driver，后两家当前仅 L2 Driver-only」）。注册表是全仓唯一事实源，本项目对现状断言与代码不一致一贯按缺陷处理；后续翻开关或排障的人会先读这段注释而被误导。

**依据**：src/trivium/agents/registry.ts 第 543-546 行（注释与按 driverEnabled 的过滤）及第 397-441 行（kimi、qoder-cn 的 driverEnabled 均为 false）；test/unit/critics.test.ts 中「真实注册表明确区分 Driver 开关与登记全集」断言 DRIVER_AGENT_IDS 恰为四家；src/trivium/config.ts 新增默认段的注释；doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md 术语表 Driver 行

**建议**：注释改为区分登记与启用，例如「登记全集见 ALL_AGENT_IDS；当前 driverEnabled 仅既有四家，Kimi/Qoder CN 已登记未启用」；config.ts 与设计术语表两处措辞同步改为「已登记、Driver 开关关闭」，不再用「可作为 Driver」描述未启用侧。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-model.ts:160-166（assertQoderModelDidNotFallback 的回退文案判定）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：回退行判定的第二个析取支匹配任何「using X instead」形态的行、不要求 model 语境，且扫描面是 stderr 与 stdout 全文：stdout 含整份审查回答与 tool_result 内容，普通英文评审语句（如 consider using path.join instead of concatenation 一类）会命中该支并把合法运行判成 QoderModelFallbackError。真实证据里的回退文案同时含 Model 与 using…instead 两要素，第一支已可命中，独立第二支只增加误报面；一旦后续接入真实审核适配器并传入完整 stdout，正常审查可能被整次误判为模型回退而失败。测试也没有「stdout 出现与模型无关的 using…instead 措辞、其余正常时仍通过」的负对照。

**依据**：src/trivium/adapters/qoder-cn-model.ts 第 160-166 行（两支析取，第二支无 model 语境要求、作用面含 stdout 全文）；doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json 的 stderr（Model 与 using auto instead 同行出现，第一支即命中）；test/unit/qoder-cn-model.test.ts 全部用例均无该负对照

**建议**：去掉独立的第二支（或限定只扫 stderr、或再要求 model 语境同现），使判定锚定官方文案的两要素；补一条负对照用例：stdout 某行含 using X instead 的普通语句、stderr 干净、回读与请求一致时 doesNotThrow。

### GLM-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/freeze.ts:383（enumerateDenyPaths 的 _meta 角色段识别）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：该正则用手工字符类捕获角色段，而同一函数上方的 artifactGlobs 已是注册表派生（按 ALL_AGENT_IDS 生成）。本轮为容纳带连字符的 qoder-cn 手工放宽字符类，正是这类手写判据的续修成本；且贪婪回溯在「角色段之后还有两个及以上小写连字段落」的文件名上会捕错 owner（例如 review-qoder-cn-a-b.json 会把 owner 捕成 qoder-cn-a，isAgentId 判否后该文件静默失去禁读保护）。当前 canonical 命名（review-角色-运行号.json 及 .fallback-items.md 等，运行号以数字开头、数字会截断该字符类）不受影响，风险只在未来命名演化时显形。

**依据**：src/trivium/freeze.ts 第 358-361 行（注册表派生的 globs）与第 383 行（手写字符类 metaHit）；src/trivium/gate.ts 第 1377、1402、1417、1424 行与 src/trivium/review.ts 第 1850-1958 行（_meta 文件当前全部 canonical 命名形态）

**建议**：改为注册表派生：用 review- 前缀加 suffixAlternation() 构造 owner 捕获，owner 恒为已登记 id，isAgentId 兜底判定可去；顺带补一条多段文件名单测钉住行为。

## 认为正确的部分

- 注册表登记正确且闸门方向对：kimi、qoder-cn 的 criticEnabled、defaultSelected、driverEnabled 全为 false，CRITIC_AGENT_IDS 与 DRIVER_AGENT_IDS 派生集不变，critics.test 钉住四家可用与两家未启用；resolveDriver 对未启用侧退 64 且报错列出真实可用集，入口资产里的 --driver kimi、--driver qoder-cn 当前全部被 fail-closed 拦住，与「入口已生成、开关关闭」的声明一致。
- entry-render-parity 恢复了字面期望表并追加 kimi、qoder-cn 两行（第 1 轮 GLM-01 的修法落位）；skill-recalibrate 论域、release-package 入口计数、install 卸载计数全部改为按注册表派生，第七家登记时这些断言不会再静默失真。
- schema 两个新 vendor 分支形状与 types 一致：未引入 readonly_enforcement 与 effort（第 1 轮 GLM-04、GLM-10 修法落位），kimi 引用 tiersModelOnly；身份仍走两段式——ajv 只校形状，checkConfigAgents 按注册表比对键与 vendor，registry-parity 对 vendor 判别式的豁免仍限于纪律 12 明示的唯一例外且属既有定义。
- qoder-cn-model 的 fail-closed 核心成立：Auto 标签恒不算生效回读、无回读即抛、回读与请求不符即抛、显式 auto 与目录外请求拒绝、档位默认值必须在官方目录内且不得为 Auto；第 1 轮指出的测试缺口（嵌套 message.model、请求不符分支、真实证据作夹具）与 defaults 非对象、非法档位的错误类型问题均已修复。
- 证据边界诚实：六条 Kimi 规则控制臂（allow-only、deny-only、allow-first、paths-only、none、paths）全部记为失败、admission false，且报告如实说明敏感 canary 未泄漏是观测事实而规则匹配根因未定位；tools 两份按「未测」处理（模型口头说工具不可用不作数）；Qoder 无效模型证据记录警告后回退 Auto 且退出 0 仍判失败；报告 §7、§8 明说模型 fail-closed 只到纯逻辑、真实适配器接线与官方目录采集未完成——没有把未测客户端安全能力写成通过。
- freeze.ts 的 _meta 角色段正则修正是必要的：canonical 命名 review-角色-运行号 下，旧正则对 qoder-cn 会把 owner 捕成 qoder 而漏禁读，新字符类对既有四家行为不变（运行号以数字开头截断贪婪匹配）；hooks 拦截文案与 D3 测试同步放宽到含连字符后缀，后缀清单由注册表派生。
- init 的 protocolPlan 按 criticEnabled 且 criticReadsInstructionFiles、driverEnabled 门控片段注入，kimi、qoder-cn 两项全 false，新增登记不改变 AGENTS.md 等项目记忆文件的注入内容；doctor 对无探针段的登记 CLI 有「尚无探针实现」注记，U3″ 放宽为常量属于注册表子集时有 doctor-deadline 的新断言补偿。
- 配置默认与兼容：defaultConfig 新增 kimi、qoder-cn 段均为 vendor 加 bin null，旧项目不补新段照常运行；未装两家的机器上安装按家根缺席跳过、doctor 不额外探测，计划 r2 的兼容约束未被破坏。

## 未覆盖范围（本侧盲区）

- 本侧无执行能力：未运行 npm run check、typecheck、契约与集成测试、npm run render；报告 §8 声称的定向复测 83/83、typecheck 通过、selftest 14/14 与已安装 bundle 哈希一致均未独立验证。
- 14 份新入口 SKILL.md 未逐行通读：完整读了 kimi 的 dual-abandon、dual-approve、dual-review-bug 与 dual-review-code 前段，其余靠 diff 结构与 entry-render-parity 的零漂移设计保证，该契约测试本轮未运行。
- Kimi 与 Qoder 真实客户端行为（KIMI_CODE_HOME 是否被各端承认、.qoder-cn 缺省家根、/skill:名字 与 /名字 调用语法、.agents/skills 与 AGENTS.md 实际加载）离线无法验证；注册表相应字段登记为候选值，本侧结论是无证据，不是已证伪。
- src/install.ts 与 entry-collisions.ts 本轮未重读全文（按第 1 轮阅读与本轮 diff 的测试期望核对）；doctor「尚无探针实现」注记的实际文案与输出位置未运行核对，只核了测试期望的构造方式。
- Driver 对第 1 轮意见的逐条裁决文件按背靠背约束刻意未读；本轮「已修、未修」的判断全部来自对当前工作树的直接比对，未引用裁决原文。
- Windows 侧证据不在本补丁内，未涉及。

## 实际查阅的项目文件

- `.reviews/KimiCode与QoderCN双角色接入/code/_meta/changes-20261027T163726Z.diff`
- `.reviews/KimiCode与QoderCN双角色接入/code/2026-10-28-KimiCode与QoderCN双角色接入-glm.md`
- `.reviews/KimiCode与QoderCN双角色接入/plan/2026-10-27-KimiCode与QoderCN双角色接入-r2-codex.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/05_testing/REPORT_2026-10-27_KimiCode与QoderCN接入前置取证.md`
- `doc/05_testing/CASE_KimiCode与QoderCN双平台验收.md`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-controls/kimi-deny-2026-10-27T15-36-56-546Z-4ec2d7e1.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-controls/kimi-deny-2026-10-27T15-37-19-914Z-36a4f815.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-controls/kimi-deny-2026-10-27T15-37-48-789Z-6bfccb52.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-controls/kimi-deny-2026-10-27T15-38-09-575Z-4578e9a0.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-controls/kimi-deny-2026-10-27T15-38-39-466Z-42433558.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-controls/kimi-deny-2026-10-27T15-38-55-274Z-0a97fda9.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-tools/kimi-tools-2026-10-27T15-53-39-513Z-4c128b5e.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-tools/qoder-cn-tools-2026-10-27T15-54-06-952Z-bd026537.json`
- `doc/07_manuals/QUICKSTART.md`
- `doc/07_manuals/MANUAL_user.md`
- `doc/08_project/KimiCode与QoderCN双角色接入实施计划.md`
- `skills-src/carriers/kimi.yaml`
- `skills-src/carriers/qoder-cn.yaml`
- `skills/dual-critic/schema/config.v2.json`
- `skills/dual-critic/entry/kimi/dual-abandon/SKILL.md`
- `skills/dual-critic/entry/kimi/dual-approve/SKILL.md`
- `skills/dual-critic/entry/kimi/dual-review-bug/SKILL.md`
- `skills/dual-critic/entry/kimi/dual-review-code/SKILL.md`
- `skills/dual-critic/entry/glm/dual-review-bug/SKILL.md`
- `src/trivium/agents/registry.ts`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/archive.ts`
- `src/trivium/config.ts`
- `src/trivium/critics.ts`
- `src/trivium/doctor.ts`
- `src/trivium/freeze.ts`
- `src/trivium/gate.ts`
- `src/trivium/hooks.ts`
- `src/trivium/init.ts`
- `src/trivium/naming.ts`
- `src/trivium/review.ts`
- `src/trivium/schemas.ts`
- `src/trivium/types.ts`
- `test/unit/registry-parity.test.ts`
- `test/unit/qoder-cn-model.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":15,"grep":12,"glob":2,"run_command":0,"project_reads":19}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
