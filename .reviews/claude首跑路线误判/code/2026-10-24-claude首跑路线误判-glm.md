---
schema: trivium.review.v2
topic: claude首跑路线误判
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
run_id: 20261024T074604Z
rerun_index: 1
snapshot_hash: sha256:cc57e24c527c5bb3c3091259281eb54f55cf824b2347c6a1e92eccc09dedae2e
blind: true
started_at: 2026-10-24T07:46:11.595Z
finished_at: 2026-10-24T07:52:59.295Z
duration_s: 408
tool_calls:
  read: 8
  grep: 4
  glob: 0
  run_command: 0
  project_reads: 7
evidence_ok: true
verdict: pass
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
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
session_id: sess_70fce4b7-2b3b-4cef-b33d-02fc8a6eb9e4
---

# 代码审查：claude首跑路线误判

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261024T074604Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

围绕焦点（稳定性比对的语义边界）逐项核实：①比对两侧的输入在修复后确为同一份未改动的调用方配置——probeClaude 中 opts.config 仅剩进入条件与浅拷贝两处引用（claude.ts:1744/1755，grep 全文确认无其它写点），existing 经 structuredClone 起步（claude.ts:1199-1200），doctor 聚合 probe 亦为深拷贝（doctor.ts:712）；②『不改调用方配置』契约在目录臂路径成立——probeClaudeDirectories 内部 structuredClone(input.cfg) 后才替换 sensitive_globs 与 run_root（claude-directory.ts:141-143），浅拷贝共享的 cfg.review 只被读取；③指纹七项按取值来源两类的划分与 claude-route.ts:139-143 实现一致，探测产出类（nativeBin/version）由登记按快照重算（doctor.ts:1242-1245），环境类（R1-R4 四格 + M2 变异）仍拦下；④首跑引导未失效——N1/P1 断言目录臂入参路线的 bin/nativeBin 为本次实测入口，M3 变异（去引导）2 格红；⑤回归锚确能区分两类变化：M1（恢复写回）新套件 7 格红 + 既有 doctor 用例 1 红，与 M2 一正一反；N/P 格还含调用方配置与 structuredClone 冻结值的 deepEqual，直接咬住新契约；⑥候选 B 的否决有零配额实证（zero-quota-candidates-output.txt 三格读数与计划 0.2 表一致）。实现与计划定稿 r2 一致，未见偏离。未发现 blocker/major 问题；一条 nit 级测试缺口（探测后解析抛出走 catch 判失效的相邻路径无专格）。

**结论**：通过（`pass`）

## 审查意见（共 1 条：吹毛求疵 1）

### GLM-01 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/integration/claude-route-stability.test.ts:320-329（R2 格）；src/trivium/doctor.ts:1230-1231` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | medium |

**问题**：『探测期间真实变化仍须拦下』的四个格子（R1-R4）覆盖的都是指纹不等这一路径；同一 if (!stable) 分支的相邻路径——探测后 resolveClaudeRoute 抛出（如 profile 文件在探测期间被删，readFileSync ENOENT）经 doctor.ts:1231 的 catch 判 stable=false——没有专门格子。该 catch 是既有代码、修复前后行为相同，但本次把『探测期间真实变化』的语义边界正式化并补了 R1-R4，恰好是补齐这条相邻路径的时机。

**依据**：src/trivium/doctor.ts:1230-1231（try/catch：解析抛出同样判失效）；src/trivium/adapters/claude-route.ts:114（profile 路线 readFileSync，文件被删即抛出）；test/integration/claude-route-stability.test.ts:320-329（R2 只覆盖文件内容变化，未覆盖删除）；.reviews/claude首跑路线误判/plan/2026-10-24-claude首跑路线误判-r2-claude.md 第一节 D2 表（『删掉则 resolveClaudeRoute 抛出、catch 判失效』，与 R2 同列但未分别落格）

**建议**：后续在 R 组补一格：目录桩在窗口内删除 profile 文件，断言与 R2 相同的失效形态。不阻塞本次合并。

## 认为正确的部分

- 取候选 A（首跑引导改配置副本）并零配额实证候选 B 修不了全新安装（nativeBin 从 null 到实测入口）——否决 B 的关键一格（zero-quota-candidates-output.txt 第 1 行）核实成立，取舍有据
- 语义边界按指纹七项取值来源分为『探测自身的产出』与『环境』两类，doctor.ts:1219-1228 注释、设计 §12 新段（v1.3.177）、计划第一节、Bug 清单第 15 条四处口径一致
- 浅拷贝共享 review 的设计安全：目录臂内部 structuredClone 后才替换 sensitive_globs，projectHash 三处绑定的真实项目配置语义保持；N/P 格对调用方配置的全量 deepEqual 断言把『probeClaude 不改调用方配置』契约变成可机读的守卫
- 回归锚 11 格正反两面分工清楚（N/P 格钉『探测自身带来的变化不得判失效』，R 格钉『探测期间真实变化仍须失效』，N4 钉缺省 native 配置下恒判稳定的边界），变异 M1/M2 一正一反证明锚能区分两类变化，M3 守首跑引导
- 既有 doctor 用例改为每轮独立配置并补『无该 blocker』断言，消掉了原先五轮共用配置时首轮撞 blocker 无人断言、第 2-5 轮悄悄变成盘上同版本场景的盲区
- blocker 文案抽成导出常量 CLAUDE_ROUTE_CHANGED_BLOCKER 供用例按常量断言，避免抄字面
- Windows 侧无回归锚（shebang 假 CLI、win32 跳过）在测试头注释、报告与 Bug 清单如实登记，并给了复核口径

## 未覆盖范围（本侧盲区）

- 只读审查：未运行任何构建、测试或变异，全量绿与否采信报告与证据文件；check-1.txt / check-2.txt 未逐行核对，只核了 mutation-output.txt 与 zero-quota-candidates-output.txt 两份读数
- 被审 diff 全文 962KB 超读限，代码部分经任务书节选 + 工作树实际文件双重核对；diff 中证据 JSON（mutation-spec*.json、mutation-names*.json 等）未逐份读取
- Windows 平台行为：回归锚与兄弟套件一样只在非 win32 运行，该平台上本行为无自动回归（已由 Driver 两处文档登记，非本次新增缺口）
- EV-251 自动校准与预检 checkCliVersions（preflight.ts:463-489）对旧版本结论的拦截只采信计划引述，未亲读 preflight.ts 核对
- 真实 CLI 验收（计划第六节第 4 步）是否执行及读数，未核对（涉及配额，报告如有登记亦未逐字读）

## 实际查阅的项目文件

- `src/trivium/adapters/claude-route.ts`
- `src/trivium/doctor.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/probes/claude-directory.ts`
- `test/integration/claude-route-stability.test.ts`
- `.reviews/claude首跑路线误判/plan/2026-10-24-claude首跑路线误判-r2-claude.md`
- `doc/05_testing/evidence/claude-first-run-route-20261024/mutation-output.txt`
- `doc/05_testing/evidence/claude-first-run-route-20261024/zero-quota-candidates-output.txt`

> 编排器从工具轨迹中记录到的读取次数：{"read":8,"grep":4,"glob":0,"run_command":0,"project_reads":7}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
