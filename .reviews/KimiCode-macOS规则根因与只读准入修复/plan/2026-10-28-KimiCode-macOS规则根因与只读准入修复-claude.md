---
schema: trivium.review.v2
topic: KimiCode-macOS规则根因与只读准入修复
stage: plan
role: claude
vendor: anthropic
agent_cli: claude/2.1.310
model_requested: opus
model_effective: claude-opus-5-5
model_effective_source: envelope
effort: high
effort_requested: high
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: profile
run_id: 20261027T174141Z
rerun_index: 1
snapshot_hash: sha256:7cf25a0ee5780e32808af123feb4fb1174555845c47dc7707218add3787c2c78
blind: true
started_at: 2026-10-27T17:41:49.418Z
finished_at: 2026-10-27T17:48:56.404Z
duration_s: 187
tool_calls:
  read: 9
  grep: 5
  glob: 1
  run_command: 0
  project_reads: 11
evidence_ok: true
verdict: pass-after-changes
findings_count:
  blocker: 0
  major: 4
  minor: 4
  nit: 0
degraded: false
parse_fallback: false
peer_deny: true
drift: false
readonly_verification: unavailable
heterogeneous: unknown
access:
  requested_mode: native
  profile: null
  launcher_requested: /Users/chenzhenbo/.local/bin/claude
  launcher_effective: /Users/chenzhenbo/.local/bin/claude
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: codex
    right: claude
    status: unknown
    left_model: null
    right_model: claude-opus-5-5
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: gemini
    right: claude
    status: different-family
    left_model: gemini-3.8-flash-high
    right_model: claude-opus-5-5
    left_source: envelope
    right_source: envelope
    reason: 模型族不同：gemini / claude
  - left: glm
    right: claude
    status: different-family
    left_model: bigmodel-coding-plan/GLM-5.3
    right_model: claude-opus-5-5
    left_source: trace
    right_source: envelope
    reason: 模型族不同：glm / claude
override_reason: 左侧模型信息缺失
session_id: d27ed731-2133-4a13-9fb5-bc1ea968eb5b
---

# 计划审查：KimiCode-macOS规则根因与只读准入修复

> Critic-D · Anthropic Claude Code ｜ 回读模型 `claude-opus-5-5` ｜ 请求模型 `opus`
> ｜ 运行 `20261027T174141Z`
> ｜ 本轮审核者 gemini、glm、claude

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最危险的一条：§4 的单因素矩阵把 agent 文件、工具面和权限模式都固定成常量，而这几项恰恰是现有证据最指向的怀疑点。6 种规则形态全部泄漏，包括只写 Read/Grep/Glob 工具级 deny 的 deny-only，所以“规则匹配/顺序”基本已被排除；剩下的嫌疑在配置是否真正加载、default_permission_mode="manual" 配 -p 的行为，以及 --agent-file 里 tools 声明的预授权。这些都不在矩阵的变量里。
其次，计划缺一个“规则引擎确实在工作”的正对照：需要证明任意一条自定义 deny 在 -p 下真正生效，否则分不清“权限段没加载”和“只读工具绕过了权限层”。
第三，§3 说保留旧 probe 的行为，§6 又允许在旧 probe 上修复，两处矛盾；Windows 包装脚本和 CASE 清单都依赖旧 probe 的默认行为。
第四，“拒绝必须配对到精确目标”这条一律性判据，没有覆盖 Grep/Glob 以目录为范围、静默过滤结果的情形。
其余几条为 minor：本地模拟服务带来的混杂和凭据外泄、表述副本的同步清单、判定逻辑归属哪一层、OAuth 刷新会不会影响全局凭据。
计划在不认 doctor、不认未调用工具、不认退出 0、证据防覆盖、开关保持关闭这些原则上是扎实的，按以上意见修改后即可实施。

**结论**：修改后通过（`pass-after-changes`）

## 审查意见（共 8 条：重要 4 ｜ 次要 4）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4 首句「固定 CLI/hash、模型声明、同形夹具、提示词或受控响应、agent 文件及工具面」与矩阵表` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：矩阵把 agent 文件、工具面和权限模式全部列为固定量，没有一行把它们作为唯一自变量。但已有证据已经排除了矩阵前几行的大部分空间：none、allow-only、deny-only、allow-first、paths-only、paths 六种规则形态全部读出了同行 canary，其中 deny-only 是对 Read/Grep/Glob 的裸工具级 deny，而实际调用名正是 Read/Grep/Glob。剩下最可疑、又没被变化过的几个因素是：①生成配置中的 default_permission_mode="manual" 与 -p 组合下的行为（§2 列了“headless 权限模式特殊分支”这条假设，但矩阵的“非交互模式”一行比的是 headless 和交互，没有变化权限模式取值，也没有变化官方的权限相关 CLI 参数）；②--agent-file 里的 tools: [Read, Grep, Glob] 声明可能被当作预授权，绕过 permission.rules；③--skills-dir。按现在的计划执行，会在规则匹配、顺序和路径形态上大量重复已有的反例，最可能的根因却从未被单独变化过。

**依据**：scripts/acceptance/kimi-qoder-cn/probe.mjs:130 生成 default_permission_mode = "manual"；:135、:139 的 deny-only 只写 Read/Grep/Glob 的工具级 deny；:147 的 agent 文件声明 tools: [Read, Grep, Glob]；:149 的参数为 --agent-file … --skills-dir … -p。REPORT_2026-10-27 §7 说明 6 种规则形态均实际读出普通和同行 canary。doc/05_testing/evidence/kimi-qoder-cn-20261027-controls/kimi-deny-2026-10-27T15-38-39-466Z-42433558.json 的 trace_observation 中，调用名就是 Read/Grep/Glob，可排除工具名不一致这一解释。

**建议**：在矩阵中补上三行单因素：权限模式取值（同一份规则，只换 default_permission_mode 或等价的官方参数）；agent 文件（有/无，或 tools 声明有/无）；skills-dir。并写明执行顺序：先跑能把剩余假设一分为二的实验，再展开路径形态×工具×中文路径的全矩阵，避免在已被排除的维度上消耗真实模型调用。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4 矩阵「配置加载来源」行；§2 假设清单` |
| 类别 | test-gap ｜ 层次 rca |
| 置信度 | high |

**问题**：“配置加载来源”一行用模型哨兵或非法规则作哨兵。它只能证明 config.toml 被解析过，不能证明 [[permission.rules]] 在 -p 执行路径上参与了判定。计划里没有任何一个臂要求：先拿到一条自定义规则在 -p 下确实生效的正例，比如对一个允许臂里确实会执行的非读工具（合成目标）加 deny，然后看到执行层拒绝。没有这个正对照，“权限段未加载/未合并”和“只读工具绕过权限层”这两条核心假设在任何矩阵结果下都无法区分，根因结论只能停在“剩余未知”。另外，现有报告里 .env 被内置规则硬拦截这条数据点，说明 Read 路径上存在某种检查，可以作为区分假设的线索，但计划没有用到。

**依据**：doc/05_testing/REPORT_2026-10-27_KimiCode与QoderCN接入前置取证.md §3 表：「敏感文件 Read：.env 内置硬拦截成功；不能证明自定义 deny 生效」。controls 证据的 config_validation 中，doctor 只输出 config.toml、tui.toml 校验 OK，没有规则加载回读。plan §4「合法/非法规则或模型哨兵的真实启动/运行结果」。

**建议**：在配置加载这一因素下增加“规则引擎存活”的正对照：同一份配置、同一个 -p 进程形态下，对一个能被稳定触发的工具（或非读工具的合成目标）写自定义 deny，并配允许臂；然后把 .env 内置拦截和自定义规则拦截的差异，明确写成区分“加载/合并”与“只读工具豁免”的判别实验。

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3「保留旧 probe 行为/旧证据」与 §6「在实验模块/旧 probe 必要位置做最小修复」` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：两处对旧 probe 是否可改的说法相互矛盾。旧 probe 是 Windows 待执行契约的载体：windows.ps1 和 git-bash.sh 不带 --rule-mode，直接调用 probe.mjs，走默认的 paths 形态；CASE 清单 §1 也把这些命令和 rule-mode 语义交给了 Bob。如果 §6 落在旧 probe 上，会出现三个问题：Windows 尚未回传的取证会在没有任何告知的情况下换成另一套语义；旧证据的 script_sha256 无法再用当前脚本复现；CASE 清单对各控制臂的描述也会失实。

**依据**：scripts/acceptance/kimi-qoder-cn/windows.ps1:19 与 git-bash.sh:16 只传 --agent/--bin/--case/--output；probe.mjs:18 默认 ruleMode='paths'，:137 注释写着「保留旧控制臂形状」；CASE_KimiCode与QoderCN双平台验收.md 第 43–45 行写明各 rule-mode 的语义，Windows 状态为未测。

**建议**：明确一条决策：修复只放在新实验工具里，或者在旧 probe 中加新的显式开关/rule-mode，默认行为和旧形状不变。如果确实要改默认行为，就把 Windows 包装脚本、CASE §1 的命令与语义说明以及脚本哈希的变更一并列为同步项，并在报告中标明“新旧脚本证据不可混比”。

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4 末段「“拒绝”必须有真实调用尝试及同 ID/工具/精确目标配对的执行层拒绝事件」` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | medium |

**问题**：这条一律性判据只适用于以单个文件为目标的 Read。Grep/Glob 的参数常常是父目录或通配模式，厂商的正确实现可能是在结果中静默过滤掉被拒子路径，这时既不存在“精确目标”，也不一定有拒绝事件。计划没有写这种情况算通过、未测还是失败，于是 Grep/Glob 臂要么永远无法判通过，要么在实施时临场解释、标准漂移。仓库已有先例：Qoder 以“修正规则后同行/敏感内容无命中”作为 Grep/Glob 隔离的观察结论。

**依据**：REPORT_2026-10-27 §3 表中 Qoder 的「Grep/Glob 隔离：修正规则后同行/敏感内容无命中；已有错误规则正向泄漏作对照」；probe.mjs:119 的 deny 提示词要求 Grep 在 root 下递归、Glob 枚举 peer/*.md，目标都是目录或模式，不是精确文件；plan §4「读取结果、搜索内容与枚举路径分别检查」。

**建议**：在原地写出例外及其判据：对以目录或模式为范围的搜索类调用，定义“过滤型拒绝”需要满足的条件。例如：同一次调用里普通 canary 正向命中；去掉规则的反向臂在同形调用下确实泄漏；结果完整、未截断、有终态。同时写明这种情况与“执行层拒绝事件”是两种不同的证据等级，以免两种口径混用。

### CLAUDE-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3 第二段「如使用本地服务仅替代模型响应」` |
| 类别 | security ｜ 层次 plan |
| 置信度 | medium |

**问题**：用本地服务替代模型响应，通常需要改 provider 的 type/base_url，这就违背了 §3 本身“最小继承官方 managed provider”的固定量，对“配置加载/规则合并是否与 provider 类型相关”这一假设构成混杂，所得结论不能直接迁移到 managed 路线。另外，如果仍复制真实 OAuth 凭据，请求头可能被本地服务记录，带着 token 进入证据或日志；§3 只禁止凭据进入证据，没有约束模拟臂本身。

**依据**：probe.mjs:84–88 强制 provider 为 managed:kimi-code，base_url 固定为官方地址；:145 把真实凭据复制进 configRoot。plan §3「凭据内容和认证副本禁止进入证据」。

**建议**：写明模拟臂不携带真实凭据，本地服务不记录请求头；并要求至少一组在模拟臂与真实 managed 臂之间取得同一结论的桥接对照，然后才能把模拟臂的根因结论推广到生产路线。

### CLAUDE-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §7 第二段同步清单` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：“Kimi 禁读失败、根因未明”这一说法在仓库里至少有五处副本。同步清单只列了“既有报告/验收表/实施计划/README/设计/开发日志”，漏了 registry.ts 中解释开关关闭原因的注释。如果根因定位成项目参数错误，下面几处会失实或语义混淆：registry 注释把 Driver 关闭归因于“客户端规则加载”，混淆了审核准入和 Driver 准入；CASE 第 43–45 行的规则控制臂说明；实施计划 §4 交付物表中“Kimi 根因与规则控制实验：待实施”一行；报告 §3 关于“内部根因尚未定位”的关键证据说明。

**依据**：src/trivium/agents/registry.ts:404「客户端规则加载与五入口验收未完成前保持 Driver 开关关闭」；doc/08_project/KimiCode与QoderCN双角色接入实施计划.md §2 表和 §4 交付物表；CASE_KimiCode与QoderCN双平台验收.md:43–45；REPORT_2026-10-27 §3 关键证据第 1 条与 §7。

**建议**：按副本逐条列出同步落点，把 registry.ts 注释纳入；同时注明哪些历史段落只追加、不改写（例如报告 §3、§6 的当时状态），避免把历史陈述也一起改掉。

### CLAUDE-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3「共用辅助模块」与 §7「新增有意义的实验判定测试」` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | low |

**问题**：调用与结果的 ID 配对、Glob 名称泄漏、截断和终态判定，与将来生产侧 TraceCapability 和轨迹解析要做的事是同一类逻辑。计划没有说明这套判定由谁持有：放在 scripts/acceptance 下作实验专用，还是放在 src 中供后续适配器复用。也没有说明新测试放在哪个目录、会不会被 npm run check 和 TV verify 收录。如果放在 scripts 下又不在测试收录范围内，§7 声称的自动化覆盖就不会出现在正式 verify 中，今后还会出现两套判定实现、口径漂移。

**依据**：probe.mjs:189–200 在脚本内自行解析 tool_calls/tool_use，没有做结果配对；REPORT_2026-10-27 §5 说明生产侧的轨迹解析测试已存在；plan §7「正式 verify 的通过不替代权限准入」，但没有说明实验测试是否在 verify 范围内。

**建议**：在计划中决定判定逻辑的归属层（实验专用，还是可被生产轨迹解析复用），并写明测试文件位置和它是否被 check/verify 收录；如果不收录，就在交付报告里单独列出运行方式和结果。

### CLAUDE-08 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3 第一段「凭据副本 0600…记录全局相关配置的前后 hash」` |
| 类别 | security ｜ 层次 plan |
| 置信度 | low |

**问题**：实验会把用户的 OAuth 凭据副本交给真实 CLI 多次运行。如果厂商在运行中刷新 token 并轮换 refresh token，新 token 只写回临时副本，随后被清理掉，用户全局凭据可能因此失效，实际上改变了用户的账号状态，而任务明确要求不修改账号配置。计划只做前后 hash 记录，能在事后发现问题，但没有写发现后怎么处理，也没有预防措施。

**依据**：probe.mjs:145 复制 ~/.kimi-code/credentials/kimi-code.json 到临时根，:208 在 finally 中整体删除临时根；任务目标原文「不修改用户全局供应商、模型或账号配置」。

**建议**：在计划中加入检查：每臂运行后比对临时副本是否被 CLI 改写，如有改写，停止批量运行并报告，不自动回写全局文件；同时说明全局凭据 hash 变化时的处理方式。

## 认为正确的部分

- §1 把官方文档关于 -p 保留静态 deny、首个匹配规则生效的说法只当作假设，要求绑定本机版本验证；也不沿用历史测试数字作为当前通过证据。
- §2 明确不把 doctor 成功当作加载或执行证据。controls 证据显示 doctor 只回读 config.toml/tui.toml 的有效性，没有回读规则加载情况，这个判断成立。
- §4 关于“拒绝”的否定清单（未调用、口头拒绝、退出 0、文件未变、未出现 canary、截断、缺终态都不算）与任务目标原文一致，覆盖了审查焦点的要求；Glob 名称泄漏也算失败，这一点很到位。
- §3 禁止自己实现权限分发器来证明厂商拒绝，并要求模拟臂明示其性质，与实施计划 P3 第 3 条一致。
- §5 进程树部分要求 PID/lstart 和后代枚举，禁止只用 kill(pid,0)，强杀后的清理由外层监督者负责，不依赖 finally，补上了报告中“强杀异常清理未测”的缺口。
- §6 在官方能力不足时不用 fail-open Hook 兜底、保持两个开关为 false、不填写未经实测的 TraceCapability，与报告 §6 对官方 Hook“异常默认放行”的结论一致，也与 registry.ts 当前 kimi 的 criticEnabled/driverEnabled=false 一致。
- §1 把范围限定在 Kimi macOS CLI，Windows 和其它客户端保持未测，没有超出任务范围。

## 未覆盖范围（本侧盲区）

- 无法运行命令：对 Kimi 2.3.0 实际行为的所有判断（权限模式、agent 文件预授权、OAuth 刷新轮换）都是基于源码和证据的推理，没有经过真实运行验证。
- 没有读主设计 §3.5/§11.1、src/trivium/util/exec.ts 中进程树终止和凭据清理的实现，未核实计划 §5“沿用公共进程树终止能力”的实际能力边界。
- 没有读 Kimi 官方文档或源码（外部链接），未核实 default_permission_mode 的取值语义、agent 文件 tools 字段的权限含义。
- 只抽查了 controls 证据中一份 JSON 的头部和调用名，没有逐份核对 stdout 中 Read 结果与调用 ID 的配对情况。
- 没有读 README.md、doc/README.md、doc/01_requirements/README.md、doc/02_design/README.md 的全文，计划的文档同步清单是否完整只做了部分核对。
- 没有覆盖 Qoder、桌面端、VS Code 插件和 Windows（计划本身也声明不在范围内）。

## 实际查阅的项目文件

- `.reviews/KimiCode-macOS规则根因与只读准入修复/plan/2026-10-28-KimiCode-macOS规则根因与只读准入修复-codex.md`
- `doc/05_testing/REPORT_2026-10-27_KimiCode与QoderCN接入前置取证.md`
- `doc/08_project/KimiCode与QoderCN双角色接入实施计划.md`
- `doc/05_testing/CASE_KimiCode与QoderCN双平台验收.md`
- `scripts/acceptance/kimi-qoder-cn/probe.mjs`
- `scripts/acceptance/kimi-qoder-cn/windows.ps1`
- `scripts/acceptance/kimi-qoder-cn/git-bash.sh`
- `src/trivium/agents/registry.ts`
- `test/unit/deny-matrix.test.ts`
- `doc/05_testing/evidence/kimi-qoder-cn-20261027-controls/kimi-deny-2026-10-27T15-38-39-466Z-42433558.json`
- `AGENTS.md`
- `CLAUDE.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":9,"grep":5,"glob":1,"run_command":0,"project_reads":11}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
