---
schema: trivium.review.v2
topic: claude首跑路线误判
stage: plan
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
run_id: 20261024T065502Z
rerun_index: 1
snapshot_hash: sha256:1a6275046cb3bc98a6e6ab0a5770c42ffd36b48f9846b42d6aee269d0af2ec5f
blind: true
started_at: 2026-10-24T06:55:11.048Z
finished_at: 2026-10-24T07:10:31.362Z
duration_s: 920
tool_calls:
  read: 12
  grep: 9
  glob: 1
  run_command: 0
  project_reads: 16
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 0
  minor: 3
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
  launcher_requested: /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
  launcher_effective: /Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: claude
    right: glm
    status: unknown
    left_model: null
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: null
    right_source: trace
    reason: 左侧模型信息缺失
  - left: codex
    right: glm
    status: different-family
    left_model: gpt-6.1-sol
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: trace
    right_source: trace
    reason: 模型族不同：gpt / glm
  - left: gemini
    right: glm
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: bigmodel-coding-plan/GLM-5.3
    left_source: envelope
    right_source: trace
    reason: 模型族不同：gemini / glm
override_reason: 左侧模型信息缺失
session_id: sess_563d1549-ac43-4aed-a521-24fd82924f67
---

# 计划审查：claude首跑路线误判

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261024T065502Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

核对了计划引用的全部源码锚点（doctor.ts 1186-1260、probes/claude.ts 1181-1234 与 1742-1786、adapters/claude-route.ts 全文、adapters/claude.ts 454-465）、既有用例 claude-structured-probe.test.ts 255-305、BACKLOG EV-254 与 Bug 清单第 15 条、主设计文档头版本、EV-251 校准路径与 probeClaude 的调用面。机制陈述与源码逐行相符：写回发生在 claude.ts:1751，比对两侧同用 opts.config（doctor.ts:1194 与 :1217），指纹七项里 nativeBin 兜底 probe.entrypoint、version 退根结论（claude-route.ts:107、:140-141）。候选 A 否决 B 的理由成立：未配 agents.claude.bin 时 nativeBin 也随写回从 null 变成实测入口，钉住 version 修不全。doctor 对 probe 段 structuredClone（doctor.ts:709）与 probeClaude 对 existing 深拷贝（claude.ts:1199-1200）让「调用方配置不被改」在 claude 段内可直接断言。R1～R4 与修复后仍可变的四项（settingsEnvSha256、configurationSha256、wrapperSha256、profile 路线经 wrapperPath 现找的 bin）一一对应，M1 与 M2 一正一反能区分「探测自身产出」与「探测期间真实变化」，N1 对登记指纹与目录桩路线指纹相等、claudeProbeForRoute 可消费两条断言按 doctor.ts:1229-1232 与 claude-route.ts:150-156 推导可成立。只有三条 minor：缺省 native 配置下修复后比对七项无一可变、恒判稳定这条语义边界没有写进第一节与文档交付；第六节真实 CLI 验收没写明入口，会撞上「改完必须重装」的已知坑；Windows 侧零回归锚且文档交付未登记盲区。无 blocker 与 major，按意见补齐后可直接实施、不需再审。本侧没有执行能力，所有「可成立」「会红」均为按源码推理。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 3 条：次要 3）

### GLM-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划第一节「如实登记的边界」清单；第五节主设计 §12 新段与 Bug 清单第 15 条闭合文；第三节 R 格矩阵的 native 一侧` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：按计划自己的分类表推到底：候选 A 之后比对两侧的 probe.cli.claude 同为调用方对象上的盘上旧结论，于是 nativeBin、native 的 bin、version 三项两侧恒同；wrapperSha256 与 configurationSha256 只在 profile 路线非 null；settingsEnvSha256 只在 settings_env_source 为 user_settings 时非 null。缺省 native 配置（未配 agents.claude.bin、未开 settings_env_source）下七项无一可变，这条 blocker 对该配置形态在修复后恒不触发，native 路线探测期间变化的检测只剩目录臂窗口内的 claudeDirectoryFingerprint。计划的边界清单只写了「探测中途自升级看不见」与「config.yaml 不重读」两条，没写这条直接推论；R 格里 native 唯一的一格 R1 也必须先开 user_settings 才构造得出来。写 §12 新段和 Bug 清单闭合文的人若按现稿落笔，读者会以为 native 路线仍保有「探测期间变化」保护，日后排查「这条 blocker 为何再没出现过」时找不到出处。

**依据**：src/trivium/adapters/claude-route.ts:107-108（nativeBin = c?.bin ?? probe?.entrypoint ?? null，native 的 bin 即 nativeBin）、:112-118（两个 sha 仅 profile !== null 时计算）、:123-138（settingsEnvSha256 仅 c?.settings_env_source === 'user_settings' 时非 null）、:139-143（指纹七项）；src/trivium/doctor.ts:1194 与 :1217 两侧均以 opts.config 解析；计划第一节边界清单两条与第三节 R1 的前置条件。

**建议**：第一节边界清单补一条「缺省 native 配置下修复后比对无可变项、恒判稳定；native 路线探测期间变化的检测只剩目录臂窗口内的目录指纹」，并把同一句落进 D3 的 doctor 注释、§12 新段与 Bug 清单第 15 条闭合文。可选：加一格对照（native 缺省配置、目录桩在窗口内改任意环境项）断言无该 blocker、仅目录事实作废，把这条边界钉成回归锚；不建议为此改指纹组成（在本主题范围外）。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划第六节第 4 步「真实 CLI 验收」` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：该步只写「在 scratchpad 建夹具项目……跑一次真实 doctor --only claude」，没写经哪个入口。项目内 .trivium/bin/trivium wrapper 与 ~/.claude/skills/dual-critic/scripts/trivium.cjs 都指向已安装副本，不是本次工作树刚构建的产物；第六节第 1～3 步都走 dist/test 直跑，唯独这一步会碰到安装副本。两种假结论都可能出现：安装副本还是旧代码时 2.1.309→2.1.310 场景照旧退 69，误判修复无效；安装副本恰好是别的构建时，验的不是本次改动。真实验收要花配额，验错对象的代价最高。

**依据**：AGENTS.md「已知坑」第一条：.trivium/bin/trivium 指向已安装副本，要 npm run build && node dist/install.cjs 两步都做，调试可直接 node skills/dual-critic/scripts/trivium.cjs <子命令>，改 skills/ 资产可用 TRIVIUM_ASSET_ROOT 指向工作树；README.md:36-37 init 后经 ./.trivium/bin/trivium 跑 doctor；计划第六节第 4 步原文。

**建议**：第 4 步写明入口二选一：直调仓库构建产物 node skills/dual-critic/scripts/trivium.cjs doctor --only claude（并把 TRIVIUM_ASSET_ROOT 指到工作树资产根），或先 npm run build && node dist/install.cjs 再走 wrapper；报告里记下实际入口与所跑产物的构建来源，让真实验收结论能对应到本次工作树。

### GLM-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `计划第三节首段「与兄弟文件同样 win32 跳过」与第五节文档交付清单` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：首跑引导是 Windows 线 0e44120a（1.1.1）引入、1.3.0 合并后两平台共用，修复改在同一段跨平台代码上；但新套件与兄弟套件一样在 win32 跳过（shebang 假 CLI），Windows 上这条行为从此没有任何回归锚，只能等用户下次 CLI 升级后手工跑 doctor 才知道。EV-253 的 Windows 实测本身也还没做。计划第五节的报告与 Bug 清单交付没有把这个盲区写进去，后续做 Windows 实测的人清单里不会有这一项。

**依据**：doc/08_project/现存Bug与未完成工作清单.md:132 第 15 条：「1.1.1 起 Windows 线引入、1.3.0 合并后两平台都有……Windows 侧当晚 claude 版本没变，所以没撞到」；近期提交 c6dd0f3c 写明 EV-253 的 Windows 实测改由用户后续在 Windows 机器上做；test/integration/claude-structured-probe.test.ts 的兄弟套件形态；计划第三节与第五节原文。

**建议**：不要求建 Windows 夹具。在新报告「已知边界」与 Bug 清单 Windows 残余处各登记一句「EV-254 回归锚仅在非 win32 运行，Windows 侧待 EV-253 实测时顺带复核：CLI 升级后首跑 doctor --only claude 应退 0 且 routes 按新版本登记」。

## 认为正确的部分

- 根因与机制陈述与源码逐行相符：写回在 probes/claude.ts:1751，比对两侧同用 opts.config（doctor.ts:1194 与 :1217），指纹七项在 claude-route.ts:139-143，nativeBin 兜底 probe.entrypoint（:107），version 先取路线登记再退根结论（:140-141）。
- 0.2「全新安装时变的不只 version」成立：未配 agents.claude.bin 时 nativeBin 随写回从 null 变成实测入口；既有用例在 265 行设了 agent.bin 恰好盖住这一面。据此否决候选 B 的理由充分。
- 候选 A 从根上消除副作用且 doctor.ts 一行逻辑不改。doctor.ts:709 对 opts.config.probe 做 structuredClone、1240 写的是副本，probes/claude.ts:1199-1200 对 existing 深拷贝，所以副本方案下调用方配置在 claude 段全程不被碰，N 格的 deepEqual 断言可行；风险节的收窄预案也写在了正确的位置。
- 「修复不丢任何检测能力」论证成立：version 与 entrypoint 在 probeClaudeBin（claude.ts:1232-1234）开头一次测得，现状比对的「后」值同样看不见探测中途的升级；目录臂窗口内 claudeDirectoryFingerprint（adapters/claude.ts:454-465）确实对 route.bin 与 route.nativeBin 文件内容取哈希，边界陈述属实。
- R1～R4 与修复后仍可变的四项一一对应：settingsEnvSha256 现读 settings.json、configurationSha256 现读 profile 文件、wrapperSha256 现读包装器、profile 路线未配 profile_bin 时 bin 经 wrapperPath 现找且 ~/.local/bin 优先于 PATH（claude-route.ts:85-97），R4 的构造成立。M1 与 M2 一正一反、M3 守首跑引导、M4 作为取舍实证，回归锚能区分两类变化。
- N1 的两条强断言按源码推导可成立：登记指纹 resolveClaudeRoute(cfg 含 snapshot, profile, snapshot.version)（doctor.ts:1230-1232）与目录桩拿到的 resolveClaudeRoute(cfg 含新探针, profile, probe.version)（claude.ts:1752）取值完全同源；claudeProbeForRoute（claude-route.ts:150-156）用 entry.probe.version 重算后与登记指纹相等，可消费。
- D4 成立：probeClaude( 在 src/ 下只有 doctor.ts:1201 一处调用；EV-251 的自动校准是 skill 照抄 recalibration.invocations 去跑带 --deadline-s 的 doctor（preflight.ts:10-11、106-107），没有第二套比对逻辑。
- 第五节版本号 v1.3.176 → v1.3.177 与主设计文档头当前版本一致；BACKLOG EV-254（第 352 行）与 Bug 清单第 15 条（第 132 行）现状与计划所述一致，原文确实只写了升级触发面，补全新安装与 nativeBin 这一面有必要。
- 既有用例改为每轮独立 defaultConfig() 不改变其断言面（p.version、json_schema_ok、directory_deny_*）；补「无该 blocker」后在 M1 下第 1 轮确会红（bin 已配、盘上无结论、version 从 null 变 9.9.9）。真实 CLI 验收先问用户、不动 package.json、不改指纹组成与登记格式，与任务目标的约束一致。

## 未覆盖范围（本侧盲区）

- 本侧没有执行能力：所有「可成立」「会红」均为按源码推理，没有跑任何测试、脚本或 doctor；计划 0.2 的零配额核验表未复算。
- 未逐行审 probeClaudeDirectories 内部是否对入参 cfg 做拷贝或写入，只核了既有用例 273 行的引用相等断言与浅拷贝保留 review 引用这一点。
- doctor.ts:1218 的 catch 路径（profile 文件被删、名称形状不合法）没有 R 格；它是既有行为、不在本次改动面，仅在此记录。
- 未审 Windows 平台差异（platform.ts、cld.cmd 形态）对副本方案的影响，推理上与平台无关。
- 未审 runDoctor 在 claude 段之外（resolveTier、overridesFor、checkpoint）是否写 opts.config 的其它部分，计划风险节已有收窄预案。
- 未核 registry-parity 与 doc-archive-index 两条契约测试对 D3 新常量名与新报告登记的实际论域；doctor.ts 既有大量 'claude' 字面，推测抽常量不新增风险。
- 未读 .trivium/ 下任何文件与 ~/.trivium/runs 下其它侧目录。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/08_project/BACKLOG.md`
- `doc/08_project/现存Bug与未完成工作清单.md`
- `src/trivium/adapters/claude-route.ts`
- `src/trivium/adapters/claude.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/doctor.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/preflight.ts`
- `test/integration/claude-structured-probe.test.ts`
- `.reviews/claude首跑路线误判/plan/2026-10-24-claude首跑路线误判-claude.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":12,"grep":9,"glob":1,"run_command":0,"project_reads":16}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
