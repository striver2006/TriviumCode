---
schema: trivium.review.v1
topic: M10-任意Driver
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.7
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260921T145353Z
rerun_index: 1
snapshot_hash: sha256:acd663fca1622bb2395b93e320eba7047a468bbe674cf22e607771be853da418
blind: true
started_at: 2026-09-21T14:53:54.204Z
finished_at: 2026-09-21T15:08:16.192Z
duration_s: 496
tool_calls:
  read: 28
  grep: 13
  glob: 0
  run_command: 0
  project_reads: 19
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 1
  major: 2
  minor: 4
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
joint_check:
  state: skipped-insufficient-sides
  effective_sides: 1
heterogeneous: true
session_id: b3446e2d-e9aa-4a7e-b2f3-c22d67cb17a8
---

# 计划审查：M10-任意Driver

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260921T145353Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

总判断：【request-changes】。
最危险的问题在于第 3 步 D3 将 Bash 侧角色后缀改为全集字面保护后，现行 /dual-review-plan 传入 `--plan-file .reviews/...-claude.md` 时会被 Hook DENY 拦截而彻底走不通（Blocker）；
其次，D1 的 topic claim 冲突退 64 且不允许覆盖，锁死了主设计 §647 行明确允许的跨阶段换 Driver 场景，且自身与 §3.3 测试用例矛盾（Major）；
再次，D2 提交锚将全集后缀无差别拦截，导致已被提交的裁决件在后续修订时被提交锚锁死（Major）。
事实核查扎实，但核心安全与状态决策存在误杀与过度收紧，必须修订后方可开工。

**结论**：`request-changes`

## 审查意见（共 7 条：阻断 1 ｜ 重要 2 ｜ 次要 4）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.2 / §10 (D3)` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：D3 将 Bash 侧 roleSuffixAnywhere() 改为全集字面保护（含 claude 等全部已登记 Driver），将直接导致现行 /dual-review-plan 在第 3 步启动审查时被自身 Hook DENY 拦截，导致整个流程瘫痪。

**依据**：skills/dual-review-plan/SKILL.md:86 明确要求将 topic resolve 产出的 subject_path 原样传给 --plan-file，生成的 Bash 命令形如 `TV review --start ... --plan-file .reviews/<主题>/plan/<日期>-<主题>-claude.md`。而在 src/trivium/hooks.ts:854 中，bashTargetsProtected 的首行拦截为 `if (roleSuffixAnywhere().test(cmd)) return true;`。若 D3 将 roleSuffixAnywhere 扩展为全集（包含 claude），则任何通过命令行参数显式传递原稿路径的正常 Bash 调用都会因命令文本中包含 `-claude.md` 而被 Hook DENY 拦截，且无法走 Write/Edit 绕过（因为调用编排器必须走 Bash）。这将直接打断今天完全走得通的缺省 Driver 流程。

**建议**：Bash 侧对角色后缀的字面拦截不能简单扩为全集后缀；原稿路径应避免直接作为命令行字面文本在 Bash 中传递（例如仅传相对阶段目录的相对路径，或由编排器内部根据主题与阶段自动定位），或者 bashTargetsProtected 须对合法的编排器子命令调用参数做精准放行。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.2 / §10 (D1)` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：第 2 步 topic claim 规定「已存在且 driver 不同则退 64 且不允许覆盖，换 Driver 必须新开主题」，直接违背了主设计 §647 行允许同主题跨运行切换 Driver 的承诺，锁死了合理的跨阶段换 Driver 场景，且计划内部自相矛盾。

**依据**：doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md 第 647 行明确规定：「同主题跨运行切换 Driver（如 claude→zcode 续跑） 允许；每轮 run.json.driver 如实记录；禁读矩阵按当轮 Driver 重算」。而在实施计划 §3.2 中，规定「已存在且不同 ⇒ 退 64 并指明『同一主题换 Driver 请新开主题』」，且「review --start 都要交叉校验：给出的 --driver 与 task.json.driver 不一致 ⇒ 退 64」。这直接锁死了在 plan 阶段由 claude 制定计划、code 阶段切换为 codex 编写代码的正常跨阶段换 Driver 场景。同时，§3.2 规定 review --start 强制校验退 64，与 §3.3 中设计的测试「task.json 有 driver、run.json 更新为别的 driver（同主题跨阶段）」产生内部逻辑自相矛盾。

**建议**：重新设计 task.json 的 Driver 记录粒度（例如支持按阶段记录 driver 或允许显式切换/重置声明），允许合法的跨阶段换 Driver 续跑，并消除 §3.2 与 §3.3 之间关于「review --start 硬校验一致性」与「run.json 更新为别的 driver」的逻辑矛盾。

### AGY-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.1 / §10 (D2)` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：D2 判据 2「basename 带全集任一后缀且位于归档根内 ⇒ 拦」会导致所有带角色后缀的裁决件（-revised-*.md / -response-*.md）一旦被提交进 Git，其后续合法修订将被提交锚无差别永久锁死。

**依据**：src/trivium/hooks.ts:1213-1216 明确规定提交锚的不变量：「仍然放过两类本就该可变的文件：编排器每次运行都要更新的 task.json，以及 Driver 本就该修订的裁决件（『修订』正是它的用途）」。裁决件的文件名由 src/trivium/archive.ts:216 生成，如 `...-revised-claude.md` 或 `...-response-claude.md`，其结尾天然包含 `-claude.md`（或相应 Driver 后缀）。若 D2 判据 2 按「basename 带全集任一后缀且在归档内」一律拦截，则只要裁决件曾被 git commit 提交过，后续 Driver 在多轮审查或人工介入调整裁决内容时，其修改将在提交时被提交锚无差别永久拦死。

**建议**：提交锚判据 2 必须明确排除裁决件（包含 `-revised-` 与 `-response-` 的工件），严格维持裁决件在归档中的可变修订契约，避免将原稿与审查件的不可变性误伤到裁决件上。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §0.3 (F-6) / §5.3` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：对 F-6（EV-07）的现状分析存在事实性误读，误以为 LITERAL_ALLOWLIST 第 270 行仍残留针对 Disposition.role 的豁免并计划删除，实况是该白名单条目属于探针字段且仍被需要。

**依据**：test/unit/registry-parity.test.ts:268-275 中，第 270 行是一段注释，说明第二版基于 Disposition.role 的豁免已在 EV-66 失效；第 275 行真实生效的白名单项是 `{ file: 'types.ts', why: "ClaudeProbe 等探针结果..." }`。而在 src/trivium/types.ts:1107 中，Disposition.role 早已是 `AgentId`，全仓无 'claude' 字面量。计划 §5.3 误将此项视作待删除的豁免，若按计划在第 4 步删除该白名单项，将直接导致 registry-parity 测试关于 types.ts 的探针白名单守卫失败。

**建议**：更正 §0.3 F-6 与 §5.3 的分析，确认 EV-07 在 schema 与 types.ts 层面均已放宽完毕，本里程碑只需在 BACKLOG 中将 EV-07 翻为结案，不得删除 `test/unit/registry-parity.test.ts` 中针对 `types.ts` 探针字段的合法白名单条目。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.1 / §10 (D4)` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：D4 的 effectiveGuardLevel 运行时动态降级逻辑属于过度设计，控制流无实质消费，有演化为「又一个 EV-06」的风险。

**依据**：计划 §5.1 表明 effectiveGuardLevel 仅有两处消费：preflight 打印一行文案与 run.json 记录 driver_guard_level。编排器的 approve 前置复核是无条件执行的，写拦截则由各 Agent 的 Hook 独立触发，guardLevel 并未参与任何核心控制流分派。若第 1 步已对 zcode Hook 进行了准入实测（通过为 L1，不通过为 L2），完全可以直接静态更新 registry.ts 中的 guardLevel。专门设计一套「登记上限 + 探针 hooks_deny_ok 降级」的两段逻辑仅仅是为了承载 `null`（未测到）状态，存在沦为「为消费而消费」的死逻辑的风险。

**建议**：将第 1 步的实测作为第 4 步的前置条件，依据确切的实测结果直接静态确定 registry.ts 的 guardLevel 取值（通过维持 L1，不通过翻 L2）；若无法测出则如实登记为 L2，避免在运行时构建仅用于打印文案的动态降级空转状态机。

### AGY-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §6.1 / §6.2 / §10 (D5)` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：D5 将另三家产物置于 skills/entry 会破坏现有 install.ts 的目录扫描假设，且未解决 init.ts 中 assetRootDefault 对 Claude 路径的写死依赖。

**依据**：src/install.ts:88-93 及 :108-112 中，skillNames 会扫描 skills/ 下所有直接子目录作为 skill 同步到目标目录。若另三家入口产物直接存放在 skills/entry/<agent>/...，skills/ 根目录下将新增 entry 目录，导致 install.ts 将 entry 整体当做 skill 同步到 ~/.claude/skills/entry，污染用户 Claude skills 目录。同时，src/trivium/init.ts:45-47 的 assetRootDefault() 写死了 `~/.claude/skills/dual-critic`，若协作者机器未安装 Claude（仅装了 Codex 或 Gemini），init 生成的 wrapper 将指向不存在的 Claude 目录而失效。

**建议**：入口渲染产物的存放路径应避免与现行 skills/ 根目录的单层 skill 扫描逻辑冲突（或同步修改 install.ts 过滤规则）；在第 5 步中将 init.ts 的 assetRootDefault 改造为按已安装的 Agent 动态定位，而不是假设 wrapper 可以完全不动。

### AGY-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §1.3 / §11 (R-a)` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：步骤切分与并行关系存在依赖倒置：第 4 步分支依赖第 1 步实测事实，第 3 步安全收紧先于第 5 步资产就位会引发过渡态破坏。

**依据**：计划 §11 R-a 声称「第 2～4 步不依赖第 1 步，可并行推进」，但 §5.1 的 D4 明确以「若第 1 步 zcode 结论为 false」作为分支条件，且第 3 步若在第 5 步（入口资产与参数处理）之前独立收紧 Bash 保护集，会使现有命令流处于更容易被误杀的脆弱过渡态。

**建议**：明确将第 1 步准入实测作为绝对先行的阶段一；待实测事实确定后，再依次推进阶段二（EV-72 + approve 复核）、阶段三（单源渲染与 install 多目标），最后推进阶段四（EV-55 护栏收紧与 driverEnabled 翻转），避免中途状态引发破坏。

## 认为正确的部分

- §0.3 中关于现状事实的排查非常扎实深入，准确挖出了 F-1（guardLevel 在生产代码中零消费方）、F-2（glm L1 登记未经实测）、F-4（zcode 不在 PATH）以及 F-8（ZCode 0.16.9 provider 配置注入根因）等关键事实，为后续演进提供了真实依据。
- 第 2 步将 topic claim 独立为新子命令，严格捍卫了「topic resolve 纯只读（不创建任何目录）」的设计承诺，避免了查询类命令附带磁盘副作用。
- 第 4 步补齐 approve 前置复核（J2 / AC-21），在审批前无条件复核裁决完整性，切实填补了 L2 Driver 缺少事前拦截时的安全补偿缺口。

## 未覆盖范围（本侧盲区）

- 未在真实安装了 ZCode、Codex、Gemini 的完整宿主机环境中执行各家 CLI 的交互式会话写操作实测（此为计划第 1 步的待办内容）。
- 未深入推演接入第五家厂商 Agent 时的禁读矩阵和 PROSE_EXCEPTIONS 颗粒度（EV-45，属于后续里程碑范畴）。
- 未对非 macOS 操作系统（Linux / Windows）下 ZCode 的内置 provider 配置路径与应用布局进行跨平台覆盖核验。

## 实际查阅的项目文件

- `src/trivium/agents/registry.ts`
- `src/trivium/hooks.ts`
- `src/trivium/meta.ts`
- `src/trivium/archive.ts`
- `src/trivium/cli.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/types.ts`
- `src/trivium/init.ts`
- `src/install.ts`
- `scripts/build.mjs`
- `skills/dual-review-plan/SKILL.md`
- `skills/dual-critic/schema/disposition.v1.json`
- `test/unit/registry-parity.test.ts`
- `test/unit/hooks.test.ts`
- `doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md`
- `doc/08_project/BACKLOG.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":28,"grep":13,"glob":0,"run_command":0,"project_reads":19}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
