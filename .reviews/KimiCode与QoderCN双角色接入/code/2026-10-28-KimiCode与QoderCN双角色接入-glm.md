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
run_id: 20261027T155518Z
rerun_index: 1
snapshot_hash: sha256:c2d8989352b8d98150b674dd5dec536f1332db6895121ec688e9b73321a3e19a
blind: true
started_at: 2026-10-27T15:55:25.347Z
finished_at: 2026-10-27T16:19:32.778Z
duration_s: 1447
tool_calls:
  read: 18
  grep: 18
  glob: 2
  run_command: 0
  project_reads: 21
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 5
  minor: 7
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
session_id: sess_25ffe1b5-642b-4720-ba7c-7176f428b74d
---

# 代码审查：KimiCode与QoderCN双角色接入

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261027T155518Z`
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

注册表派生这条主线做对了：审核者集合、Driver 集合、适配器接线、doctor、lenses 对账、安装目标、发布打包全部按注册表派生，两家 criticEnabled/defaultSelected 均为 false，不动默认集合与上限，未装 Kimi/Qoder 的用户安装与 doctor 都不受影响；证据 JSON 与报告文字一致保持 admission:false、未测/失败三态，没有把口头拒绝或退出码 0 写成通过；qoder-cn-model 的 fail-closed 核心（Auto 不算回读、无回读即抛、显式 auto 拒绝、默认值必须在目录内）方向正确且与真实 stderr 文案匹配。需要改的集中在四处：① 护栏注入段对账测试被改成与 guardProfileOf 同规则现算，永远为真，钉子没了；② 注册表把 instructionFiles=AGENTS.md、安装根、.agents/skills 共享读取根这些须实测的客户端事实直接登记为真，违反已批准计划 r2 §7.1/§7.4 与 AGENTS.md 纪律 1——这是 L2 载体唯一护栏（协议文本）能否送达的问题；③ schema/types 接受计划明令不接受的 readonly_enforcement: prompt-only 与 Kimi 侧 effort；④ qoder-cn-model 的「回读与请求不符」分支与嵌套 message.model 路径零测试，真实证据文件没有被当夹具。另有 vendor 与 AgentId 同形、label 偏离计划、设计 §7.4.1 与 README/QUICKSTART 措辞滞后几条次要项。以上修法都明确且机械，不需要重审一轮。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 13 条：重要 5 ｜ 次要 7 ｜ 吹毛求疵 1）

### GLM-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/contract/entry-render-parity.test.ts:269-277（补丁 hunk @@ -262,7 +262,11 @@）` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：这条测试原本用字面表 `{ claude: 'l1-hook', codex: 'l2-none', gemini: 'l2-none', glm: 'l2-hook' }` 钉住派生结果，注释明说「表本身先钉住：派生规则或登记值一改，这里先红」。补丁把期望值改成对同一份 AGENTS 现算 `a.guardLevel === 'L1' ? 'l1-hook' : a.hookConfigTarget ? 'l2-hook' : 'l2-none'`，而这正是 `guardProfileOf` 的实现本体（registry.ts:569-578）。两边同源同规则，`assert.deepEqual(table, expected)` 不可能失败：把 kimi 误登记成 L1 加 hookConfigTarget、或改掉派生规则，这一格都不会红。回答「这条测试要怎样才会失败」——现在的答案是「不会」。

**依据**：test/contract/entry-render-parity.test.ts 补丁第 573-577 行新表达式与被删的第 572 行字面表；src/trivium/agents/registry.ts:569-578 guardProfileOf 的 if/三目与测试内联规则逐字等价

**建议**：恢复字面期望表并显式追加 `kimi: 'l2-none'`、`'qoder-cn': 'l2-none'`——表随登记变化就该手改，这正是钉子的意义；若坚持派生写法，至少为两家新项另加字面断言。

### GLM-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/agents/registry.ts:410,432（instructionFiles: ['AGENTS.md']）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：两家新项把 `instructionFiles` 登记为 AGENTS.md，但补丁内三份新增证据（tools 两份、failure 一份）只观测读工具与模型回退，没有任何探针证明 Kimi Code CLI/桌面端/VS Code 插件与 Qoder CN CLI/桌面端会加载该文件；已批准计划 r2 §7.1 逐字要求「instructionFiles 与 criticReadsInstructionFiles 须由客户端/审核者独立探针确认后登记，不能猜 AGENTS.md 兼容即有效」，§2 引用的 Qoder 官方 config-scope 文档甚至写项目根是 `.qoder`。`trivium init` 按此字段落 Driver 协议片段，而两家都是 L2、hookConfigTarget 为 null——协议文本是它们唯一的护栏来源。文件若不被客户端加载，Driver 模型收不到「审查期禁写、裁决逐条、审批权在用户」任何一条，而注册表、QUICKSTART、MANUAL 已把两家写成可作 Driver。

**依据**：src/trivium/agents/registry.ts:410,432；.reviews/KimiCode与QoderCN双角色接入/plan/2026-10-27-KimiCode与QoderCN双角色接入-r2-codex.md §7.1、§2（docs.qoder.cn/cli/config-scope：项目根 .qoder）；doc/05_testing/evidence/kimi-qoder-cn-20261027-tools/kimi-tools-2026-10-27T15-53-39-513Z-4c128b5e.json 与 qoder-cn-tools-2026-10-27T15-54-06-952Z-bd026537.json 的 argv 与 trace_observation 均无规则文件加载相关观测

**建议**：二选一：补「规则文件加载」探针臂（隔离夹具里放一条可观测的 AGENTS.md 指令，逐客户端核对是否遵循），通过后再登记并在注册表注释引用证据，与既有四家同字段的出处写法对齐；或在证据到位前把两家 `driverEnabled` 保持 false——`checkCarrierCoverage` 只要求 driverEnabled 者有载体，入口渲染不受影响。

### GLM-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/agents/registry.ts:412-415,434-436（entrySkillRoot / entrySkillExtraReadRoots）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：`entrySkillRoot`（`KIMI_CODE_HOME` 回落 `.kimi-code/skills`、`.qoder-cn/skills`）与 `entrySkillExtraReadRoots: ['.agents/skills']` 直接按官方文档登记，没有实测：既有四家同字段都带「第 1 步报告 §x 实测」出处（346-349、390-394 行），计划 r2 §7.4 写明这些宣称「均须在 CLI、桌面、Extension Host 各自核对，不能直接推广」，AGENTS.md 纪律 1 要求实测取值不硬编码。证据里只有 Kimi 的 `cli_path: ~/.kimi-code/bin/kimi` 旁证家根；Qoder 探针全程用 `--config-dir` 临时目录，`.qoder-cn` 作缺省家根零观测。后果两面：安装根错了，家根碰巧存在时 `install` 会把 7 份入口写进客户端不扫描的目录并报「已安装」（静默无效，planInstall 不校验客户端是否真读该目录）；`.agents/skills` 若两家并不读，`entry-collisions` 会把共享根里的同名第三方 skill 多归两家、让原本能过的安装被拒——补丁里 install.test 已按这个未验证的登记值把期望改成派生，测试会随登记一起错。

**依据**：src/trivium/agents/registry.ts:412-415,434-436 对比 346-349、390-394 的实测出处注释；src/install.ts:183-208 planInstall、355-361 家根判定；doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json 的 argv（--config-dir 临时根）；test/unit/install.test.ts 补丁 +675-679、+709、+741-752；plan r2 §7.4

**建议**：补技能发现探针（候选根放一份 dual-status，分别用 `kimi -p` / `qoderclicn -p` 让模型列出可见 skill）与共享根读取探针，结论写回注册表注释；未测前在注释与 QUICKSTART 标「候选值，未验收」。

### GLM-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `skills/dual-critic/schema/config.v2.json（补丁 +306-313、+348-355 readonly_enforcement）；src/trivium/types.ts:1109,1118` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：两家 schema 分支与 TS 类型都接受 `readonly_enforcement: 'required' | 'prompt-only'`。已批准计划 r2 §7.2 逐字裁定新侧配置形状「不接受 profile、readonly_enforcement:prompt-only、任意 permission 参数」，§2.2 重申「保持 fail-closed，不采用提示词只读降级」。现在 `prompt-only` 是一个 schema 合法、全仓无人消费的旋钮（grep 不到任何读取点）：用户今天写进配置不会报错，将来接适配器的人看到字段自然会实现它——这正是计划要堵的降级口；description 里写「不能作为准入证据」不改变它是合法值这件事。

**依据**：skills/dual-critic/schema/config.v2.json 补丁两段 enum ['required','prompt-only']；src/trivium/types.ts:1109,1118；plan r2 §7.2、§2.2

**建议**：删掉该字段，或 enum 只留 `required`（让校验器连带拒绝 `prompt-only`）；「执行层拒绝已验证」属于探针结论，应落在 probe 段而不是用户配置里。

### GLM-05 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/qoder-cn-model.test.ts:41-55` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：`assertQoderModelDidNotFallback` 四个判定分支里，「回读非 Auto 但与请求不符」（qoder-cn-model.ts:160-164）没有任何用例——把这段 if 删掉，全部测试仍绿。`readQoderEffectiveModel` 的 `message.model` 嵌套路径（Qoder stream-json 里 assistant 事件的真实位置，见证据文件 stdout）只在实现里有，测试只喂顶层 `{"model":...}`。此外本轮刚新增的 qoder-cn-failure 证据带一对真实 stdout/stderr（stderr 原文 `Model "trivium-invalid-model" is not available right now; using "auto" instead.`），测试却用手写的 `'using "auto" instead'`，正则是否匹配官方文案没有被真实样本钉住，而本仓的惯例正是用探针原件做夹具。

**依据**：test/unit/qoder-cn-model.test.ts 全文；src/trivium/adapters/qoder-cn-model.ts:128-139,154-164；doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json 的 stderr 字段与 stdout 中 message.model 的位置

**建议**：补三类用例：请求 cn-default 而 stdout 为 `{"message":{"model":"cn-flash"}}` 必抛且消息同时含两个模型名；读取证据文件的 stdout/stderr 作夹具断言抛 QoderModelFallbackError；嵌套 `message.model` 等于请求值的正例通过。

### GLM-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-model.ts:74-84,94-97` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：`validateQoderNativeModelCatalog` 对 `available` 做了 Array.isArray 防御，却直接 `catalog.defaults[tier]`——这个函数的职责就是校验「外部解析出的原始目录」，`defaults` 缺失或不是对象时抛的是 TypeError 而非 `QoderModelConfigurationError`，按错误类型给用户出「配置缺失 + 修法」提示的调用方会漏接。同理 `resolveQoderModelRequest` 对运行期传入的非法 `tier`（CLI 输入不受 TS 类型约束）报「默认模型配置缺失」，把输入错误说成配置错误。

**依据**：src/trivium/adapters/qoder-cn-model.ts:70-84（available 有防御、defaults 无）、94-97

**建议**：入口先校验 `defaults` 为普通对象、`tier` 属 default/flash/pro 三值，否则抛配置错误并写明实际收到的值。

### GLM-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/qoder-cn-model.ts:151-153` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：stderr 回退正则的后两个分支 `fallback` 与 `not available` 是裸词：任何无关 stderr（MCP server not available、某 hook 的 fallback 提示）都会被判成「模型回退」中止运行，而 `QoderModelFallbackError` 消息只写请求模型、不带命中的 stderr 片段，排障时会把问题归到模型路线上。fail-closed 方向对，但归因错且不可定位。

**依据**：src/trivium/adapters/qoder-cn-model.ts:151-153；qoder-cn-failure 证据 stderr 的真实文案同时含 Model、not available、using auto instead 三要素

**建议**：以官方文案形状锚定（要求同时出现 Model 与 using ... instead 两个要素），并把命中的那行写进错误消息；若要保留宽匹配，区分「确认回退」与「疑似回退」两种错误。

### GLM-08 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/agents/registry.ts:49,421；test/unit/registry-parity.test.ts:1047` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：新 vendor `'qoder-cn'` 与 AgentId `'qoder-cn'` 同字面。注册表自己对 AgentVendor 的注释是「与 AgentId 分开：未来同一厂商可能有多个 Agent」——Qoder 国际版与 CN 版正是「一家厂商两个 Agent」的实例，按此口径 vendor 应是 `qoder`。同字面带来两笔实际代价：schema 身份扫描不得不新增对 `vendor` 键的豁免（1047 行）；`vendor: 'qoder-cn'` 落进 types.ts 只因该文件整体在 LITERAL_ALLOWLIST 里，而其登记理由（299 行）只写了 ProbeByCli 具名键，守卫被动放宽且理由失实。这一取值来自计划 r2 §7.1 的裁定，所以这条是在问计划而不是实现。

**依据**：src/trivium/agents/registry.ts:48-49,421；test/unit/registry-parity.test.ts:962,1047（补丁新增豁免）、299（types.ts 白名单理由）；plan r2 §7.1

**建议**：请 Driver 裁决：改 vendor 为 `qoder`（id 不变，schema const 随改，1047 行豁免可撤、299 行理由保持准确），或在计划里补写接受 vendor 与 id 同形的理由及其对守卫的影响。

### GLM-09 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/agents/registry.ts:399,420（label）` |
| 类别 | scope-drift ｜ 层次 code |
| 置信度 | high |

**问题**：计划 r2 §7.1 明定 label 为 `Critic-E · Moonshot Kimi Code`、`Critic-F · Qoder CN`（这是 AGY-01/GLM-06 的裁定项），实现写成 `Driver · Kimi Code`、`Driver · Qoder CN`，补丁、报告与计划表都没有说明这是有意偏离。label 字段注释写明它是审查文档抬头的钉死称谓、字母不按位置漂移；现在用「Driver ·」占位，日后启用审核者时必须再改一次，E/F 的字母分配也没有落档。

**依据**：src/trivium/agents/registry.ts:141-155 label 字段注释、399、420；plan r2 §7.1

**建议**：要么按计划写 Critic-E/F（字段语义是称谓不是状态，criticEnabled 为 false 不妨碍），要么在裁决件里显式记录偏离与理由。

### GLM-10 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `skills/dual-critic/schema/config.v2.json（补丁 +314-316 Kimi 分支 tiers: $ref tiersCommon）` |
| 类别 | scope-drift ｜ 层次 code |
| 置信度 | high |

**问题**：Kimi 分支引用 `tiersCommon`，其 `tierEntry`（config.v2.json:910-924）允许 `effort`；计划 r2 §7.2 写明「首版没有已验收 effort 覆盖时不接受新侧 effort，不能静默忽略」，本轮证据里没有任何 Kimi 思考等级透传的观测。Qoder 分支用的 `tiersModelOnly`（+356-358）才是计划口径，两家不一致说明不是有意放开。

**依据**：config.v2.json 补丁 +314-316 vs +356-358；$defs tierEntry 910-924、tiersModelOnly 1000-1016；plan r2 §7.2

**建议**：Kimi 也改引用 `tiersModelOnly`，待 effort 探针通过再放开。

### GLM-11 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:152（§7.4 安装目标清单）` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：设计文档是「唯一实现依据」，AGENTS.md 改动同步表要求与设计不一致的行为先回补设计。补丁只改了设计的现状断言段与术语表一行，§7.4 的安装目标清单仍只列 claude/codex/gemini/glm 四个落点，Kimi（`$KIMI_CODE_HOME/skills`，缺省 `~/.kimi-code/skills`）与 Qoder CN（`~/.qoder-cn/skills`）两处新安装目标在设计里没有记载，而 install.ts 已按注册表写入。

**依据**：设计文档 152 行；src/install.ts:183-208；src/trivium/agents/registry.ts:412,434

**建议**：在 §7.4 补两行落点并标「候选值，客户端未验收」，与 GLM-03 的探针结论一起回填；§8.5 护栏等级表若有逐家行也一并补。

### GLM-13 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/07_manuals/QUICKSTART.md（补丁 §5.2 首句）、doc/07_manuals/MANUAL_user.md（补丁角色表 Driver 行）` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：QUICKSTART §5.2 新句说两家「都可按注册表作为 Driver」，MANUAL 角色表写「注册表另含 … L2 Driver-only 入口」，但同节「各家的入口与等级」表没有加两家的行，`/skill:dual-run`、`.kimi-code/skills` 等调用写法与安装位置都未在真实客户端验证（REPORT §1 自己写「本次安装和五客户端 Driver 验收仍未完成」）。计划 r2 §7.1 要求「尚未取得对应证据时不宣称 Driver 可交付」；读者按 §5.2 去 Kimi 里敲命令，大概率什么也发生不了，且没有地方告诉他该敲什么。

**依据**：QUICKSTART.md 补丁 +8、+342；MANUAL_user.md 补丁 +47；REPORT 补丁 §1 末句；plan r2 §7.1

**建议**：措辞改为「已登记、入口已生成、客户端未验收」，并把两家的候选调用写法与安装根列进 §5.2 表、逐项标注未验收。

### GLM-12 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `README.md:3,65` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：README 仍写「支持 Claude Code、Codex、Antigravity、ZCode 四家 Agent」「分发包包含运行时、四家入口」，而 `scripts/package-release.mjs` 按目录整树打包，现在实际入包 6 份载体、42 份入口（release-package.test 也已改成 AGENTS.length * 7），部署手册已改口、README 没有。

**依据**：README.md:3,65；scripts/package-release.mjs:51；test/integration/release-package.test.ts 补丁 +636

**建议**：同步 README 的 Agent 数与入口数措辞，注明两家为 L2 Driver-only 且客户端未验收。

## 认为正确的部分

- 注册表派生纪律得到遵守：CRITIC_AGENT_IDS / DRIVER_AGENT_IDS、adapters/index.ts 的 realAdapters()（只遍历 criticEnabled）、doctor、lenses 对账（只要求审核者有镜头）、planInstall、entry-collisions、package-release（整树拷贝 skills 与 skills-src/carriers）全部按注册表或目录派生，核心没有新增按 kimi/qoder-cn 分叉的字面量；config.ts/types.ts 的默认段与类型按既有 LITERAL_ALLOWLIST 口径处理。
- 两家 criticEnabled:false、defaultSelected:false，deriveDefaultCritics 的两条不变量与 DEFAULT_MAX_CRITICS=3 不受影响；realAdapters() 不会因未接线抛错；doctor 不会去探未安装的 CLI——计划 r2 §7.2「不破坏旧项目全量 doctor」成立。
- 安装器对家根不存在是「跳过并写明」（install.ts:355-361），未装 Kimi/Qoder 的用户安装行为不变；checkCarrierCoverage 要求每个 driverEnabled 者有载体 yaml，两份新 yaml 补齐。
- VENDOR_MODEL_FAMILY['qoder-cn'] = /(?!)/ 只影响已标 @deprecated 的 isHeterogeneous，生产三态比较走 MODEL_FAMILY_RULES / compareRunModels，与计划 r2 §7.1「Qoder 名义族使用永不匹配规则并注明仅历史兼容」一致。
- qoder-cn-model 的 fail-closed 核心正确：Auto 标签恒不作生效回读、无回读即抛、显式 override 'auto' 拒绝、默认值必须在目录内、stderr 回退优先；真实证据 stderr 文案确实命中现有正则。请求/声明/回读三者在类型上分开（requested/declared 与 QoderEffectiveModel.effective/source）。
- 三份新增证据与报告文字一致保持 status 失败/未测、admission:false、effective_model_verified:false、forbidden_dispatch_verified:false；tools 臂中模型只是口头说工具不可用的情形按计划 §7.6 判「未测」而非通过；6 种 Kimi 规则形态的反例被如实写成「排除一种解释、不能断言根因」。没有把未测客户端安全能力写成通过。
- registry-parity 对 schema 的 vendor const 豁免处于纪律 12 明示的唯一例外之内，VENDOR_DISCRIMINANT_KEYS 为既有定义；config.v2 的 798 行结构测试与 892 行行为测试对新 id 仍成立。
- 渲染产物 qoder-cn/dual-run 里 `--driver qoder-cn`、L2 无 Hook 护栏段与 guardProfileOf 的 l2-none 一致，`--model-<id>` / `--only` 旗标清单仍只列四家审核者，没有把 Driver-only 的两家混进审核者旗标。

## 未覆盖范围（本侧盲区）

- 本侧无执行能力：未跑 npm run check / typecheck / 契约测试 / doctor --selftest / npm run render；Driver 的 REPORT 与实施计划表也明确本轮变更后未重跑 check，补丁中多处测试改写（entry-render-parity、skill-recalibrate、release-package、install、registry-parity）的实际通过状态未知。
- 只读了 qoder-cn/dual-run 一份渲染产物的前 120 行，其余 23 份 SKILL.md 与两份 carriers yaml 的零漂移靠 entry-render-parity 契约测试保证，本侧未能运行。
- 未核实 hooks.ts criticRoleSuffixes() 构造的 Bash 字面正则对含连字符后缀 `qoder-cn` 的匹配，以及 naming / parse / locateSubject 对 `<主题>-qoder-cn.md`、`-r<N>-qoder-cn.md` 的解析（计划 §4 自动化清单列了「含连字符 argv 与归档名字解析」，补丁里没有看到对应新测试）。
- 未验证 Kimi Code / Qoder CN 真实客户端行为（KIMI_CODE_HOME 是否被 CLI 承认、`.qoder-cn` 缺省家根、AGENTS.md 加载、`.agents/skills` 读取、`/skill:<name>` 语法）——离线、无官方文档访问；GLM-02/03 的结论是「无证据」而非「已证伪」。
- 未读 install.ts 卸载与所有权判定部分对新根的影响；未读 entry-collisions.ts 全文。
- 未读设计文档 §8.5 护栏等级表与 §7.4 其余段落是否另有逐家表需要补行；只核了 152 行安装目标清单。
- 未追 compareRunModels 在 Kimi 作 Driver 且 --driver-model 声明为 kimi 系列时的三态比较路径。
- Windows 侧证据不在补丁内，未涉及。

## 实际查阅的项目文件

- `.reviews/KimiCode与QoderCN双角色接入/code/_meta/changes-20261027T155518Z.diff`
- `.reviews/KimiCode与QoderCN双角色接入/plan/2026-10-27-KimiCode与QoderCN双角色接入-r2-codex.md`
- `AGENTS.md`
- `CLAUDE.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `src/trivium/adapters/qoder-cn-model.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/index.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/schemas.ts`
- `src/trivium/doctor.ts`
- `src/install.ts`
- `src/entry-render.ts`
- `skills/dual-critic/schema/config.v2.json`
- `skills/dual-critic/entry/qoder-cn/dual-run/SKILL.md`
- `scripts/package-release.mjs`
- `test/unit/registry-parity.test.ts`
- `test/unit/qoder-cn-model.test.ts`
- `test/contract/entry-render-parity.test.ts`
- `test/unit/install.test.ts`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-tools/kimi-tools-2026-10-27T15-53-39-513Z-4c128b5e.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-tools/qoder-cn-tools-2026-10-27T15-54-06-952Z-bd026537.json`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-controls/kimi-deny-2026-10-27T15-36-56-546Z-4ec2d7e1.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":18,"grep":18,"glob":2,"run_command":0,"project_reads":21}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
