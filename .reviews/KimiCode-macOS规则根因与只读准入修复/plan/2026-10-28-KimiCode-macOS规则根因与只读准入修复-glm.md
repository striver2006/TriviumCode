---
schema: trivium.review.v2
topic: KimiCode-macOS规则根因与只读准入修复
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
run_id: 20261027T174141Z
rerun_index: 1
snapshot_hash: sha256:7cf25a0ee5780e32808af123feb4fb1174555845c47dc7707218add3787c2c78
blind: true
started_at: 2026-10-27T17:41:49.418Z
finished_at: 2026-10-27T17:48:56.404Z
duration_s: 373
tool_calls:
  read: 9
  grep: 1
  glob: 1
  run_command: 0
  project_reads: 8
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 1
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
  - left: glm
    right: claude
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: claude-opus-5-5
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / claude
override_reason: 左侧模型信息缺失
session_id: sess_3d708e21-9bb0-4010-b9dd-b0845de233c4
---

# 计划审查：KimiCode-macOS规则根因与只读准入修复

> Critic-B · 智谱 ZCode ｜ 回读模型 `bigmodel-coding-plan/GLM-5.3` ｜ 请求模型 `GLM-5.3`
> ｜ 运行 `20261027T174141Z`
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最危险的一条：§4 单因素矩阵没有 permission_mode 这个自变量，而旧探针的全部规则控制臂都把它写死为 manual——若根因在权限模式语义，headless 对比交互会把 -p 与 manual 两个变量纠缠，误走 §6 的厂商阻塞分支而非项目修复分支（GLM-01）。其次是受控输入路线的可行性未前置核对（GLM-02）与矩阵执行顺序、两套完成口径未定（GLM-03）。基线陈述、拒绝证据定义、凭据与进程树边界、修复/阻塞二分与双开关保持关闭均经核实无误；补齐上述矩阵行与顺序条款后即可实施。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 3 条：重要 1 ｜ 次要 2）

### GLM-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4（单因素矩阵表「非交互模式」行）/ §2 假设清单` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：§2 假设清单列出了「headless 权限模式特殊分支」，但 §4 的六行矩阵没有任何一行以 permission_mode 为唯一自变量。旧探针在全部 6 个规则控制臂的生成配置里都写死 default_permission_mode = "manual"（probe.mjs:130），该值从未被单独翻转，前置报告 §7 的六臂泄漏全部发生在这同一取值下。若根因是 manual 模式在 -p 下对未命中规则的调用默认放行，§4 的「非交互模式」行（headless 对比交互）会把 -p 本身与 manual 语义纠缠：交互臂可能因人工确认而表现正常，结论会误归因为厂商 headless 缺陷并走 §6 的阻塞分支，而真实修法可能只是换掉项目生成配置里的 permission_mode（项目修复分支）。矩阵缺行直接威胁根因归因与修复分支选择的正确性。

**依据**：读被审计划 §2/§4/§6；scripts/acceptance/kimi-qoder-cn/probe.mjs 第 130 行（default_permission_mode = "manual" 进全部控制臂生成配置）；doc/05_testing/REPORT_2026-10-27_KimiCode与QoderCN接入前置取证.md §7（六种 rule-mode 在该配置下全部泄漏，permission_mode 从未被排除）。

**建议**：在 §4 矩阵增加「权限模式」行：同样 headless、同样规则与工具面，仅翻转 permission_mode（manual 对官方 schema 支持的其它取值或删除该键的缺省行为）；§2 核对配置 schema 时先确认合法取值，若 manual 是唯一取值则像其它行一样显式记录不适用依据，不静默跳过。

### GLM-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3 第 2 段 / §5 第 1 段` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：§5 的裁剪与分发拒绝判据（「在允许控制臂确认真实执行后用裁剪臂触发同调用」）整体押在 §3 的受控输入路线上，而受控输入需要把模型响应换成本地服务，这必须改写生成配置中的 provider——现有探针的 selectedKimiConfig 硬性只接受 managed:kimi-code 且 base_url 锁定 api.kimi.com（probe.mjs:84-88）。计划没有把「本机 Kimi CLI 是否接受自定义 provider/base_url、或存在任何官方强制工具调用的受控入口」列为 §2 的具名前置核对项；若该路线不可行，§5 大部分面要等到工具链搭完才塌缩成未测/阻塞。§3 中「最小继承官方 managed provider」与「本地服务仅替代模型响应」对同一份生成配置的取舍边界也没有写明。

**依据**：读 plan §3/§5；scripts/acceptance/kimi-qoder-cn/probe.mjs 第 84-88 行（provider 与 base_url 的硬校验，非 managed 即抛错）与第 23 行的方法论表述。

**建议**：把受控入口可行性（自定义 provider/base_url 或等价官方机制）提升为 §2 的具名核对项，先做最小 spike 再搭受控工具链；在 §3 写明受控臂配置相对 managed 模板允许偏离的字段清单，与真实模型对照臂分开留痕。

### GLM-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4 / §7` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：§4 六行因素 × Read/Grep/Glob × 五类路径形态的全组合没有写执行顺序与规模上限，也没有区分「根因定位所需的最小闭环」与「准入证据所需的完整矩阵」两个完成口径。doc/08_project 实施计划 P0 第 4 条已有纪律（先最小失败对照定位、再扩展矩阵、设时限），本计划未继承为显式条款。按矩阵直接铺开是上百次真实 CLI 调用（每次上限 180 秒），既烧配额又推迟根因定位；反过来，若最小复现已锁定根因，剩余哪些臂仍必须跑满（供修复前后对照与准入证据）也没有判据，可能到闸门阶段才发现证据不完整而返工。

**依据**：读 plan §4 矩阵与 §7；doc/08_project/KimiCode与QoderCN双角色接入实施计划.md §3 P0 第 4 条（既有执行纪律）；doc/05_testing/REPORT_2026-10-27_KimiCode与QoderCN接入前置取证.md §7（每臂一次真实调用的成本参照）。

**建议**：在 §4 前补一段执行顺序：先用最小失败对照（如 deny-only 单臂）复现泄漏，锁定方向后按行扩展；每臂固定时限与重试上限；写明「定位完成」与「证据完成」两个停止条件，以及修复落地后必须重跑的臂集合。

## 认为正确的部分

- §1 基线陈述经核实属实：HEAD 355eb46e、业务工作树仅本主题归档未跟踪，registry.ts 中 kimi/qoder-cn 的 criticEnabled 与 driverEnabled 均 false，主题归档确只有已认领的 task.json 与本次运行件；不沿用历史测试数字作当前通过证据的处理正确。
- §4 对「拒绝」的证据定义（真实调用尝试 + 同 ID/工具/精确目标配对的执行层拒绝事件 + 允许臂正对照；排除模型未调用、口头拒绝、退出 0、文件未变化、canary 未出现）忠实于任务目标且可操作，Glob 名字泄漏也算失败这点比旧探针判据更严。
- §3 凭据边界（0700 临时根、0600 副本、wx 防覆盖、仅复制所需键、全局配置前后 hash、凭据不进证据）与 CLAUDE.md、AGENTS.md 的凭据纪律一致。
- §5 进程树判据（PID/lstart 比对、禁用 kill(pid,0)、外层监督者负责强杀后清理、不依赖被 SIGKILL 的 finally）对齐仓库已知坑第 6 条。
- §6 修复/阻塞二分、「保持两个开关 false」、不写未经实测的 TraceCapability、不自行发起审批，均忠实于任务目标原文；§7 的 verify 用法与 cli.ts:323 的 trivium verify --topic（执行 config 声明的 build/test）一致。

## 未覆盖范围（本侧盲区）

- 本侧为只读审查，未运行任何命令或实验；对 probe 行为的判断来自源码与既有报告文本，未实测本机 Kimi CLI 2.3.0 的任何行为，包括 stream-json 事件是否携带可配对的调用 ID、permission_mode 的合法取值、自定义 provider 可行性——GLM-01/02 的因果推断均待实验证实。
- doc/README.md、doc/01_requirements/README.md、doc/02_design/README.md、README.md 未逐字读完，主设计 §3.5/§11.1 原文未读。
- scripts/acceptance/kimi-qoder-cn/windows.ps1 与 git-bash.sh 未逐行核对（Windows 不在本次取证范围）。
- Windows、Qoder、桌面端、VS Code 插件按计划边界不在本次范围，未审查。
- 另一位审查员的结论按背靠背约定未读、未推测。

## 实际查阅的项目文件

- `.reviews/KimiCode-macOS规则根因与只读准入修复/plan/2026-10-28-KimiCode-macOS规则根因与只读准入修复-codex.md`
- `doc/05_testing/REPORT_2026-10-27_KimiCode与QoderCN接入前置取证.md`
- `doc/05_testing/CASE_KimiCode与QoderCN双平台验收.md`
- `doc/08_project/KimiCode与QoderCN双角色接入实施计划.md`
- `scripts/acceptance/kimi-qoder-cn/probe.mjs`
- `src/trivium/agents/registry.ts`
- `test/unit/deny-matrix.test.ts`
- `CLAUDE.md`
- `src/trivium/cli.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":9,"grep":1,"glob":1,"run_command":0,"project_reads":8}

---

*本文档由 TriviumCode 编排器从 `glm` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
