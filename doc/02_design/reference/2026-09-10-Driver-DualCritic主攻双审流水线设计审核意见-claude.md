# Driver-DualCritic 主攻双审流水线设计 · 审核意见

> - **作者 / 负责人**：Chen Zhenbo（由 Claude Code 起草）
> - **文件命名**：`2026-09-10-Driver-DualCritic主攻双审流水线设计审核意见-claude.md`，遵循 PRD FR-08 的 `日期-主题-角色` 规范
> - **创建日期**：2026-09-10
> - **当前版本**：v1.0.0
> - **状态**：评审中(In-Review)
> - **被审对象**：[`2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md`](./2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md) v1.0.0（下称「被审稿」）
> - **参照方案**：[`…-gemini.md`](./2026-09-10-Claude-Code主攻双智能体审核流水线-gemini.md)（下称「gemini 版」）、[`…-glm.md`](./2026-09-10-Claude-Code主攻双智能体审核流水线-glm.md)（下称「glm 版」）
> - **需求准绳**：[PRD_driver_dual_critic.md](../01_requirements/PRD_driver_dual_critic.md) v1.3.0

---

## 0. 审核范围、依据与方法

| 项 | 说明 |
| :--- | :--- |
| 审核范围 | 被审稿全文 21 章（含 12 条架构决策 AD-01～AD-12、探针清单、工件契约、命令与 Hook 设计、异常矩阵、追溯矩阵、路线图） |
| 判定准绳 | PRD v1.3.0 的 FR/NFR/AC 与第 4.4、6、7、8、10、11 章规则；仓库既有文件（`.gitignore`、`.env.example`、`.reviews/README.md`、根 `README.md`） |
| 参照方式 | gemini 版与 glm 版不作为准绳，只用于：① 发现被审稿遗漏的议题；② 对同一议题给出不同取舍时比较论证强度；③ 识别值得吸收或明确否决的做法 |
| 外部核实 | 被审稿第 3.1 节关于 Claude Code Hooks / 命令的 14 条断言，逐条对照官方文档（`code.claude.com/docs/en/hooks`、`skills`、`tools-reference`、`vscode`）核实，结果见 RV-08 |
| 严重度定义 | `blocker`：不改则实现阶段必然受阻或违反 PRD P0；`major`：与 PRD 有实质冲突、内部自相矛盾或存在明确失效场景；`minor`：不影响架构但需在下一版修正；`nit`：措辞、编号、一致性 |
| 未做的事 | 未在本机实际运行 `agy` / `zcode.cjs` 做探针实测；被审稿第 3.2、3.3 节的 CLI 事实仅做逻辑一致性审查，不对其置信度做二次判定 |

---

## 1. 总体结论

**裁决：有条件通过（Approve with required revisions）。**

被审稿是三份设计中覆盖最完整、机制最落地的一份，建议作为后续实施基线。相对于两份参照，其明显优势在于：

1. **探针先行**（第 3.5 节、P7、M0）：把三家 CLI 的不确定性全部收敛到 `trivium doctor` 的实测结论，实现代码不硬编码命令行。glm 版有同类思想但探针项更少；gemini 版则把大量未经证实的 flag 直接写进调用模板。
2. **裁决闭环可机读、可强校验**（第 6.6、8.6 节）：`disposition.v1` schema + 七条硬规则 + 缺口清单回喂 Driver，是三份中唯一把 AC-12 做成算法的设计。
3. **隔离靠机制**（第 10.1 节四道机制）：镜像树物理剔除对方产出 + 延迟落盘 + 事后轨迹核验，比 gemini 版「仅靠提示词与 stdout 管道」和 glm 版「提示词禁令 + 事后检出」都强。
4. **追溯矩阵三向齐全**（第 15 章）：FR → 设计、NFR → 设计、AC → 验证方式，且验证方式可操作。
5. **参考方案取舍有据**（第 20.1 节）：对五份答卷逐一说明采纳与否及理由，避免了「综合」变「拼贴」。

但被审稿存在 **7 条 major** 问题必须在 v1.1.0 修订后才能把状态改为「已批准」，其中 RV-01（Bash 工具超时）与 RV-03（独立 HOME 与凭据矛盾）是实现阶段一定会撞上的；RV-02（`mirror` 与 FR-07 字面冲突）需要 PRD 侧拍板回填。其余为 minor / nit，可随 v1.1.0 一并修订或列入实施纪律。

---

## 2. 三份方案横向对比

| 维度 | 被审稿（claude） | gemini 版 | glm 版 | 审核意见 |
| :--- | :--- | :--- | :--- | :--- |
| 编排形态 | 一次性 CLI `trivium`，斜杠命令调用，Hook 只做护栏（AD-01/AD-04） | 编排器 CLI + Skill 体系挂载 | 一次性 CLI `dc`，Hook 为可选加固且默认关闭（D1/D12） | 三者一致选 CLI；被审稿与 glm 版对 Hook 定位相反（护栏必装 vs 默认关闭），见 RV-05 |
| 审查工作目录 | 冻结镜像树 `mirror`（默认），`in-place` 受限备选（AD-05） | 项目根 | 项目根，工件级冻结（D11），明确否决整树快照 | **分歧最大的一点**，见 RV-02 |
| 只读机制 | 工具白名单/黑名单 + 镜像树 `chmod a-w` + 前后指纹三重（AD-06） | 工具参数 + Git 指纹，失守后**自动 `git checkout` 回滚** | 工具层禁写 + Git 指纹，失守停下等人工（D10） | 被审稿与 glm 版一致否决自动回滚，正确 |
| Antigravity 权限 | 自定义只读 Agent + `permissions.deny`，禁用 `--dangerously-skip-permissions`（AD-07） | 不传 skip 标志，依赖 soft-deny | 专用 Agent + 预授权只读工具 + 不传 skip 标志 | 一致；被审稿额外识别 issue #548 与「空审查」风险并给出轨迹下限校验，最完整 |
| ZCode 模型指定 | `ZCODE_MODEL` 环境变量 → 独立配置副本 → 全局默认，生效值回读 | 临时 `HOME` 配置沙箱 | `--model` → 配置目录隔离 → `UNSUPPORTED` 拒绝开工（D6） | 被审稿首选环境变量有仓库 `.env.example` 佐证，合理；glm 版「档 3 拒绝开工」比被审稿「全局默认 + 标注」更严格，建议吸收为可配置策略（见 4.1） |
| 意见结构化 | `review.v1` schema，`agy --json-schema` + zcode 提示词约定，解析失败降级留原文（AD-08） | `--json-schema` + 后置正则 | 同被审稿，但解析失败**按该侧失败**处理（D7） | 被审稿「降级不参与阻断判定」与 glm 版「视为失败」各有道理；被审稿需说明 `parse_fallback` 侧的意见是否仍要逐条裁决（见 RV-17 附注） |
| 裁决校验 | `gate --check` 七条硬规则，缺口回喂，无重试上限 | 无机器校验，靠 CLAUDE.md 约束 | `dc verify` 四类检查，Driver 重试上限 3 次 | 被审稿最强，但缺上限（RV-13）与两条过硬的机器判定（RV-10/11） |
| 命名文法 | `<日期>-<主题>[-r<N>][-revised\|-response]-<角色>.md` | `<主题>.v2` | `<日期>-<主题>[-revised\|-response][-v2]-<角色>.md` | 三种版本后缀写法，需统一并回填 PRD（RV-12） |
| 失败策略默认 | `strict`（AD-09） | `strict` | `strict`（D5） | 一致 |
| 实现语言 | Python 3.11+ 标准库（AD-12） | TypeScript + commander/execa/zod | Python 3.9+ 标准库（D9） | 被审稿与 glm 版一致；3.11 下限偏高（macOS 自带 python3 版本随系统），建议放宽到 3.9 并由 doctor 探测 |
| 运行时目录 | `.reviews/`（归档，进 Git）+ `.trivium/`（运行时，不进 Git） | `.reviews/` 单目录 | `.reviews/` 单目录（`local.yaml` 排除） | 双目录分离归档与运行时是合理取舍，但增加一个点目录与一组 `.gitignore` 规则，需在 18.2 同步项中体现（RV-06） |
| 人工闸门实现 | 状态层 + 提示层 + Hook 强制层，`/dual-approve` 显式审批 | 对话式 | 对话式，审批记录 P2 | 被审稿最严，但写锁范围过宽（RV-05） |
| 编译测试命令来源 | `auto` 探测四级 → 命中即执行 | 配置文件固定 | 配置显式声明优先，未配置**不猜测执行** | 建议吸收 glm 做法（RV-14） |
| 与 Claude Code 事实 | 14 条断言 11 条准确，3 条需修正 | 已指出 `.claude/commands/` 为 legacy、skills 为推荐 | 引用 hooks 官方能力，准确 | 见 RV-08 |
| 文档质量 | 1495 行，术语固定、阅读指引、待确认项与风险登记齐全 | 883 行，大量 ASCII 图，追溯矩阵自评「100% 满足」缺 FR-23、NFR-02/03/05/06/07 | 978 行，结构清晰，对参考方案裁决明确 | 被审稿最完整；gemini 版自评矩阵有遗漏，不宜作为「实施基线」（其自称状态「已批准」与 02_design README 索引中的「评审中」口径不一致，建议一并修正） |

---

## 3. 逐条审核意见

每条意见格式：**编号（严重度）· 位置** → 问题 / 依据 / 建议。编号前缀 `RV-` 供被审稿修订时逐条应答。

### 3.1 Major

**RV-01（major）· AD-03、7.4、13.2 —— 同步阻塞调用未考虑 Claude Code Bash 工具的超时上限**

- 问题：被审稿 AD-03 决定「双审调用为同步阻塞，不用 async Hook」，7.4 命令模板第 3 步让 Driver 通过 Bash 工具同步执行 `trivium review`，并以 `statusMessage` 与「每 30s 心跳」解决等待可见性。但 12.2 的单侧上限为 900～1200s，加上 12.3 的重试一次，一次 `review` 的墙钟时间可达 30～40 分钟。Claude Code 的 Bash 工具本身有默认超时与可配置上限（默认 2 分钟量级，上限 10 分钟量级），同步调用必然被工具层杀掉，心跳输出无法延长工具超时。
- 依据：13.2「运行中每 30s 打印一次心跳」只解决人的焦虑，不解决工具超时；gemini 版与 glm 版同样未处理此问题，属三份方案共同盲区。
- 建议：① 把 `trivium review` 拆为 `review --start`（冻结 + 派生子进程 + 立即返回 `run_id`）与 `review --wait <run_id> --timeout <s>`（分段等待，未完成返回特定退出码，命令模板循环调用）；派生的子进程在两侧回收完成后即退出，不属于 PRD Non-Goal 所指的常驻 Daemon；② 命令模板写明循环等待的上限次数；③ 在 3.1 节补一条「Bash 工具超时」事实，并在 AD-03 的取舍理由中加入此约束；④ 若选择依赖用户配置 `BASH_MAX_TIMEOUT_MS`，须写进 `install.sh` 与 `doctor` 检查项，但不建议作为主路径。

**RV-02（major）· AD-05、10.2、18.1 第 1 项 —— `mirror` 默认与 PRD FR-07 字面冲突，且未论证镜像树的功能代价**

- 问题：PRD FR-07 规定「审查 Agent 执行时的根目录为所在项目根目录」；被审稿把工作根切换为冻结镜像树，并自述「在内容语义上成立」。glm 版第 1.4 节以同一理由**明确否决**整树快照方案。被审稿已在 18.1 列为待拍板项，态度是诚实的，但论证只算了收益（AC-04 可机械保证）没有算全代价：
  1. 镜像树不含 `.git`（9.2 要点 2），审查员失去 `git log` / `git blame` / `git diff` 等编程 Agent 常用能力，与 FR-02「读仓库、工具循环」的初衷相悖；
  2. 9.2 用临时索引 `add -A` → `write-tree` → `git archive` 构树，结果**尊重 `.gitignore`**，因此 `node_modules/`、`.venv/`、构建产物等全部缺席；审查员无法解析依赖类型、无法跑测试，`bug` 阶段「复现是否充分」的镜头（9.3）在镜像树里无法成立；
  3. 每次运行两份全量拷贝，大仓库的时间与磁盘成本（保留 30 天）未估算；
  4. `in-place` 备选被设为「仅当 doctor 证明两侧都支持路径级 deny 且实测生效时才允许启用」，而 3.2/3.3 均未列出两家 CLI 有路径级 deny 能力，实际上把备选关死了。
- 建议：① 保留 `mirror` 为默认，但把该决策升格为独立 `ADR_001_isolation_mode.md`，状态 Proposed，等 PRD FR-07 回填「项目根或其等价冻结快照」后再 Accepted；② `in-place` 改为**完整规格化的备选**：工作目录为项目根，隔离靠 10.1 的第 ①③④ 道机制 + strict 停机（即 glm 版 7.2 的「诚实边界」声明：第 4 层是检出而非阻断），不再要求路径级 deny；③ 为 `mirror` 增加 `isolation.link_globs`（如 `node_modules/**`）以符号链接或 APFS clonefile 方式带入被忽略的依赖目录，并在 9.2 写明 `.git` 缺席的能力损失；④ 在 M0 探路里加入「两种模式下审查质量与耗时对比」的实测项，用数据支撑最终默认值。

**RV-03（major）· 11.2 第 5 点、11.3、10.1 第 ① 道、3.5 —— 独立 `HOME` 与「凭据仍走用户已有登录态」自相矛盾**

- 问题：10.1 与 11.1 规定两侧各用独立 `HOME`（`.trivium/run/<run_id>/<critic>/home`）；11.2 第 5 点又说「独立 HOME 只放该次运行的配置副本，凭据仍走用户已有登录态」。但 3.2 表明 Antigravity 的凭据、`settings.json`、全局自定义 Agent 定义都在 `~/.gemini/` 下；3.3 表明 ZCode 配置在 `~/.zcode/` 下，且 3.3 的工具轨迹要从 `~/.zcode/**/rollout/*.jsonl` 提取。换 `HOME` 后这些路径全部落空：`--agent trivium-critic` 找不到定义、登录态失效、轨迹路径改变。被审稿用「若独立 HOME 导致认证失效，doctor 会探测到并改为共享 HOME + 独立 settings 路径」兜底，但「独立 settings 路径」是否存在（agy 是否有 `--settings` 之类参数）在 3.2 中没有事实条目，也没有置信度标注，3.5 探针清单里也没有对应项。
- 建议：① 在 3.5 增加 `agy.home_isolation` 与 `zcode.home_isolation` 探针：分别实测「独立 HOME + 拷入凭据文件/Agent 定义」「共享 HOME + 独立配置路径」「共享 HOME + 仅环境变量覆盖」三种方式哪种可用；② 11.2/11.3 改为「隔离方式以探针结论为准」，并明确凭据文件拷贝到独立 HOME 时的清理与权限（`0600`、跑完即删）；③ 10.1 第 ① 道机制改为「独立会话与独立配置」，不把「独立 HOME」写成必然；④ 若 Antigravity 侧最终只能共享 HOME，自定义 Agent 定义改放工作区路径 `.agents/agents/trivium-critic/agent.md`，由 `freeze` 写入镜像树。

**RV-04（major）· 12.3 —— 结果缓存键未包含提示语与送审包，会违反 AC-09**

- 问题：12.3「同一 `(snapshot_hash, critic, model)` 命中缓存时直接复用既有结果」。但同一快照、同一模型下，命令 B/C/D 的提示语（FR-20）、镜头（9.3）、`effort` 都可能不同；按该键复用会把旧提示语下的结论当作新提示语的审查结果，AC-09「提示语出现在两边材料中」在形式上满足、实质上失效。同时与 FR-25「重跑产生新文件」的语义冲突：重跑却不重审。
- 建议：缓存键改为 `(snapshot_hash, brief_hash, critic, model, effort)`，其中 `brief_hash` 为渲染后 `BRIEF.md` 全文哈希；或一期不做缓存，把它移到 NFR-06 的二期优化。若保留，命中缓存必须在命令输出与 `run.json` 记 `cache_hit: true` 与来源 `run_id`。

**RV-05（major）· 8.4、8.5、12.1、13.1 —— `awaiting_approval` 写锁的作用域过宽，且拒绝审批后锁不释放**

- 问题：
  1. 8.4 强制层：只要某主题处于 `awaiting_approval`，`hook-pre-write` 就拒绝写入归档根以外的**任何**路径。状态存在 `.trivium/state.json`，跨会话持久。开发者跑完 `/dual-review-plan` 后去改一个无关文件、或第二天开新会话做别的事，都会被拒，直到执行 `/dual-approve`。
  2. 12.1「人工在闸门拒绝 → 写锁保持」：拒绝后开发者通常希望 Claude 按其意见再改计划（写 `.reviews/` 允许）或干脆放弃该主题，但业务写锁仍在。
  3. PRD 4.4 第 3 条与第 8 章要求的是「**命令**在停点后不得自动继续编码/改码/合入」，约束对象是流水线自动行为，不是开发者在同一仓库的其它编辑。被审稿的实现比 PRD 更严，且没有列入 18.1 待拍板项。glm 版把 hooks 设为默认关闭（D12），正是担心误拦。
- 建议：① 写锁绑定触发闸门的 `session_id`（Hook 输入含该字段），新会话默认不加锁，只通过 `hook-session-start` 的 `additionalContext` 提醒；② 增加 `gate.approval_lock_ttl_h`（默认如 24h）与 `/dual-abandon --topic`（记录放弃并释放锁）；③ 拒绝审批时释放业务写锁、记录 `rejected` 与理由，把「拒绝后禁止自动继续」的责任交给命令模板与 `hook-stop`；④ 把「闸门期是否锁业务写」列入 18.1 待拍板项，并在 13.1 提供关闭开关（已有 `block_business_write_when_awaiting_approval`，但默认值与作用域需重新论证）。

**RV-06（major）· 3.1 作用域、5.3、18.2 —— 仓库 `.gitignore` 整体忽略 `.claude/`，与「项目级注入可随仓库分发」冲突**

- 问题：被审稿 3.1 说 `.claude/settings.json` 为「项目，可共享」，5.3 把 `.claude/commands/dual-*.md` 与 `.claude/settings.json` 列为目标项目内的运行时布局，16.2 第 3 条要求 Hook 随项目分发。但本仓库 `.gitignore` 第「AI 辅助编程与编辑器会话工件」段有一行 `.claude/`，会把整个目录忽略；若目标项目沿用本仓库模板（`install.sh` 极可能拷贝该 `.gitignore`），命令与 Hook 永远进不了版本库。18.2 的同步项表未列 `.gitignore`。此外 `.gitignore` 的 `*.local` 规则不会误伤 `config.local.yaml`，但 `logs/` 规则会同时命中 `.trivium/logs/`（这是期望的），需在 5.3 的 `.gitignore` 追加清单中说明依赖关系。
- 建议：① 18.2 增加 `.gitignore` 一行：把 `.claude/` 改为 `.claude/*` + `!.claude/commands/` + `!.claude/settings.json`（`settings.local.json` 继续忽略）；② `trivium init` 负责幂等地写入上述规则并检测冲突；③ 5.3 追加清单补 `.trivium/run/`、`.trivium/logs/`、`.trivium/state.json`、`.trivium/config.local.yaml`、`.trivium/bin/` 与现有 `logs/`、`*.log` 规则的关系说明。

**RV-07（major）· 7.4 与 10.5 —— 命令模板使用裸 `trivium`，与「GUI 进程不读 `.zshrc`，一律绝对路径」自相矛盾**

- 问题：10.5「macOS 细节」明确：VS Code GUI 进程不读 `~/.zshrc`，配置中一律使用绝对路径；8.5 的 Hook 也正确地用了 `${CLAUDE_PROJECT_DIR}/.trivium/bin/trivium`。但 7.4 的命令模板正文与 `allowed-tools: Bash(trivium:*)` 都用裸 `trivium`，依赖 PATH。Claude Code 扩展的 Bash 工具环境是否继承登录 shell 的 PATH 因启动方式而异，`~/.trivium/bin` 更不会默认在 PATH 里。
- 建议：命令模板统一调用 `.trivium/bin/trivium`（项目相对路径，cwd 为项目根），`allowed-tools` 改为 `Bash(.trivium/bin/trivium:*)`；`install.sh` 不再要求修改用户 PATH。

### 3.2 Minor

**RV-08（minor）· 3.1、8.5、8.5 Hook 行为表 —— Claude Code 事实需修正三处，另有一处取舍需说明**

对照官方文档核实第 3.1 节 14 条断言，11 条准确（事件清单、matcher 语义、`if` 字段、exit 2 语义、handler 字段、async/asyncRewake、路径占位符、作用域、公共输入字段与 `stop_hook_active`、VS Code 与 CLI 共享配置、Stop 阻断硬上限存在）。需修正：

| 位置 | 被审稿写法 | 核实结果 | 修正 |
| :--- | :--- | :--- | :--- |
| 3.1 matcher 行、8.4、8.5 | `Edit\|Write\|MultiEdit\|NotebookEdit` | 当前内置工具清单中**没有 `MultiEdit`**，文件编辑工具为 `Edit` 与 `NotebookEdit` | 删除 `MultiEdit`（保留无害，但属过时事实） |
| 3.1 JSON 输出行、8.5 `hook-stop` | `hookSpecificOutput` 含 `stopReason`；Stop 阻断「exit 2，`stopReason` 指明…」 | `stopReason` 不属于 `hookSpecificOutput`，它是顶层字段、与 `continue: false` 配对；Stop 事件阻断收工应输出 `{"decision":"block","reason":"…"}` 或 exit 2 + stderr | 改写 `hook-stop` 的输出契约 |
| 8.5 说明「Claude Code 自身也有连续阻断硬上限」 | 未给数值 | 官方：Stop hook 连续阻断 **8 次**后被覆盖，可用 `CLAUDE_CODE_STOP_HOOK_BLOCK_CAP` 调整 | 补数值与环境变量名；被审稿自设「每阶段最多 2 次」仍是必要的 |
| 3.1 自定义命令行、7.4 | `.claude/commands/<name>.md` 为四条命令载体 | 官方已将 `.claude/commands/` 标为 legacy，当前标准为 `.claude/skills/<name>/SKILL.md`；gemini 版 4.1.1 已指出此点。`argument-hint` 是否仍受支持本次未能从 skills 页面确认 | 在 AD 列表补一条「命令载体选 commands 还是 skills」的决策；建议以 skills 为主、commands 作别名，或说明为何暂用 commands |

**RV-09（minor）· 6.6 规则 2、8.6 步骤 5c —— 裁决词与 PRD FR-14 不一致，且 gate 做精确匹配**

- 问题：被审稿裁决集合为 `{接受, 不接受, 暂缓}`；PRD FR-14 写「接受 / 驳回 / 暂缓」，AC-12 写「接受或不接受」；glm 版用「驳回」。`gate` 以精确字符串匹配，Driver 按 PRD 措辞写「驳回」会直接 `bad_verdict`。
- 建议：规范值定为「接受 / 驳回 / 暂缓」（与 FR-14 一致），`gate` 接受「不接受」为「驳回」别名并归一化；PRD AC-12 的「不接受」措辞由 PRD 小版本同步。

**RV-10（minor）· 6.6 规则 7、8.6 步骤 5g —— 「双方共同 blocker 不得驳回」用文本相似度机器判定，误判会卡死闸门**

- 问题：`location` 指向同一处或「文本相似度超阈值」即判为共同 blocker，直接 FAIL。相似度阈值是启发式，误判时 Driver 无法通过 `gate`，只能改口「接受」一条它有证据反驳的意见，反而制造橡皮图章。这是被审稿在 PRD 之外的加强项，PRD 未要求。glm 版 3.1.3 第 5 条把同一规则写成软约束（「驳回需要两份独立审查都错了级别的证据」）。
- 建议：降为 warning：`gate` 输出 `joint_blocker_rejected` 警告并要求 `task.json` 记 `disputed: true` 与理由，不阻断；仅在 `location` 精确相等且用户配置 `gate.joint_blocker_policy: hard` 时才 FAIL。

**RV-11（minor）· 6.6 规则 5、8.6 步骤 5e —— 空洞词表判定同理**

- 建议：默认词表判定为 warning，可配置为 hard；避免 Driver 为绕过词表而堆砌无意义文字。

**RV-12（minor）· 6.1、6.2 —— 保留后缀未在主题合法性规则中排除，且三份方案版本后缀写法不同**

- 问题：主题合法字符包含 `-` 与数字，主题「release-r2」会渲染为 `2026-09-10-release-r2-glm.md`，解析器无法区分「主题 release 的第 2 轮」与「主题 release-r2 的首轮」；`-revised`、`-response` 同理。三份方案分别用 `-r2`（被审稿，位于阶段后缀之前）、`-v2`（glm，位于阶段后缀之后）、`.v2`（gemini）。
- 建议：① 6.1 增加规则：主题不得以 `-r<数字>`、`-revised`、`-response` 结尾，`topic --propose` 拒绝并给修正建议；② 保留被审稿 `-r<N>` 写法与位置，作为对 PRD 11.2「修订计划/根因与原稿区分」行的补充回填，让 PRD 下一版锁定版本后缀文法，结束三种写法并存。

**RV-13（minor）· 7.4 步骤 6 —— 「补齐后重跑直至通过」无上限**

- 建议：与 13.1 `stop_hook_max_blocks` 同理设 `gate.max_check_retries`（默认 3），超限停下向用户求助（glm 版 3.2.2 退出码 5 的做法）。

**RV-14（minor）· 14.1 —— `verify.source: auto` 探测到命令即真实执行**

- 问题：`auto` 顺序第 3 级会直接执行 `package.json` 的 `scripts.test`、`Makefile` 的 `test` 目标等。这些命令可能耗时极长、依赖外部服务或有副作用（清库、发布）。PRD FR-21 要求「以项目既有约定为准」，但没有要求自动猜测。glm 版 3.7 的立场是「未配置则提示补配置，不猜测执行」。
- 建议：`doctor` 只做探测并写入 `verify.suggestion[]`；`trivium init` 把建议展示给用户确认后写入 `verify.build/test`；命令 A 只执行配置中显式存在的命令，否则拒绝启动（被审稿 14.1 第 4 级已有此逻辑，把它扩展到第 2、3 级即可）。

**RV-15（minor）· 8.1 —— 每条命令都对两侧做 headless 探活，成本与时延偏高**

- 问题：预检表要求 Antigravity 与 ZCode 各跑一次最小 headless 任务确认认证。每条命令启动即消耗两次模型调用与数十秒；命令 A 内部多次 review 时更甚。
- 建议：认证结论带短 TTL 缓存（如 1 小时，写 `config.local.yaml` 的 `probe.auth_checked_at`），TTL 内跳过探活；或优先使用不消耗模型的检查（若 CLI 提供）。探针 TTL 7 天保持不变。

**RV-16（nit）· 第 2 章、8.2、15.1、11.5 —— 编号与术语不一致**

- FR-11 映射行写「状态机 S1～S9」，8.2 状态图与 15.1 写「S0～S10」。
- 第 2 章 FR-06 行写「模型路由三级」，11.5 与 15.1 写「四级路由」；实际是两个概念：ZCode **覆盖机制**三级降级（3.3、11.3）与**路由优先级**四级（11.5）。建议分别命名为「ZCode 覆盖三档」与「路由优先级四级」。

**RV-17（minor）· 10.3、6.5 front-matter、9.3 —— 是否允许审查员执行命令未说清**

- 问题：10.3 工具层写「白名单只含只读工具，不含写文件与危险命令」，但 6.5 示例 front-matter 有 `tool_calls: {run_command: 2}`，9.3 `bug` 镜头要求判断「复现是否充分」。glm 版 3.3.2 明确允许只读命令白名单（如 `npm run test|lint|build`）。若允许命令执行，镜像树无依赖（RV-02）使其大多失败；若不允许，front-matter 与镜头需相应收敛。
- 附注：AD-08 规定 `parse_fallback` 侧「不参与阻断判定」，但 8.6 步骤 1 只区分「双审 / 单审降级」两种情形，未说明 `parse_fallback` 侧的原文意见是否需要在裁决表中出现。需补规则（建议：需要，Driver 自行编号并标 `source: fallback`）。

**RV-18（nit）· 11.2 第 1 点 —— `--add-dir <tree>` 作为读权限兜底的原理未说明**

- 问题：cwd 已是镜像树，再 `--add-dir` 同一路径为何能改变 headless 权限判定，被审稿没有解释；3.2 只记录了「`--add-dir` 在 headless 下可用」。
- 建议：改写为探针项的实验假设（「疑似 1.1.20 的工作区只读授权与 `--add-dir` 相关，待 M0 验证」），或删除。

**RV-19（minor）· 7.1 —— `/dual-run` 的任务目标与可选提示语同走 `$ARGUMENTS`，解析有歧义**

- 建议：命令 A 的提示语改用显式 `--focus "<文本>"`（glm 版做法），`topic resolve` 只把 `--focus` 之外的正文当作任务目标。

**RV-20（minor）· 缺失 —— 无同主题并发运行锁**

- 问题：两个会话同时对同一主题跑 review，`state.json`、`task.json` 与 `-r<N>` 计算会竞争。`archive` 的 `O_EXCL` 只保护文件不被覆盖，不保护 `N` 的一致性。仓库 `.gitignore` 已预留 `.reviews/*.lock`。
- 建议：`trivium review` 以 `.reviews/<主题>/.lock`（或 `.trivium/lock/<主题>`）做互斥，持锁者崩溃后按 PID 与时间戳回收。

**RV-21（minor）· 6.4 —— 「diff 中无非注释代码行变化」需语言感知**

- 建议：一期只按路径 glob 判定（`skip_globs` 命中且不命中 `never_skip_globs`），注释/格式判定列为二期；FR-23 本身是 P2，被审稿 16.1 也建议延后，规则可同步简化。

**RV-22（nit）· AD-01、20.1 —— 「VS Code 扩展侧 stdio MCP 有被静默关闭的历史」无来源**

- 问题：该论据转引自 grok4.6 答卷（glm 版 1.4 同样转引），20.2 外部资料清单中没有对应链接。它是否决 MCP Server 形态的主要理由之一。
- 建议：补来源或改为「社区反馈，置信度中」；MCP 形态仍可作为二期演进（glm 版 O3）。

**RV-23（nit）· 3.3、11.5、13.1 —— 模型 ID 大小写不一致**

- 被审稿写 `GLM-5.3`、`GLM-5.3-Flash`；gemini 版与 glm 版写 `glm-5.3`、`glm-5.3-flash`。ZCode 规范 ID 大小写应由 `zcode.model_override` 探针一并钉死，文档示例统一为探针返回的写法。

### 3.3 Nit / 流程

**RV-24（nit）· 文档定位与命名**

- 被审稿沿用 PRD FR-08 的 `日期-主题-角色` 命名，02_design README 把这类命名归为「方案调研与提案」；正式设计的规范是 `ARCH_` / `LLD_` / `ADR_` 前缀。被审稿的 AD-01～AD-12 已是 ADR 雏形。建议：评审通过后，把被审稿拆为 `ARCH_driver_dual_critic.md`（第 1、2、4、5、15 章）、`LLD_trivium_orchestrator.md`（第 6～14 章）与若干 `ADR_00x_*.md`（至少 AD-03、AD-05、AD-09 需要独立记录），或修订 README 允许日期命名作为正式设计并说明例外。

**RV-25（nit）· 18.2 同步项不全**

- 补：`.gitignore`（RV-06）；PRD FR-07 表述（RV-02）；PRD 11.2 「待设计对齐项」回填（归档根、命令拼写、strict 默认、阶段目录含 `verify/`、版本后缀文法、编译测试命令来源），glm 版第 13 章第 3 条已提出同样建议；`doc/02_design/README.md` 已在最近一次提交补录了三份综合设计，18.2 该行描述已过时，需更新。

**RV-26（nit）· AD-12 —— Python 3.11+ 下限偏高**

- macOS 自带 `python3` 版本随系统而异；glm 版取 3.9。建议下限 3.9，由 `doctor` 探测版本并在 `config.local.yaml` 记录解释器绝对路径。

---

## 4. 建议吸收自参照方案的做法

### 4.1 来自 glm 版

| 做法 | glm 版位置 | 吸收方式 |
| :--- | :--- | :--- |
| `dc verify` 失败后 Driver 重试上限 3 次 | 3.2.2 退出码 5 | 见 RV-13 |
| 隔离第 4 层是「检出而非阻断」的诚实边界声明 | 7.2 | 在被审稿 10.1 与 `in-place` 模式说明中加入同样声明（RV-02） |
| ZCode 模型覆盖全部探不通时 `UNSUPPORTED` → 模型不一致即拒绝开工 | 3.3.3 档 3、D6 | 作为 `model_route: global` 的可配置策略 `zcode.unsupported_override: reject \| annotate`，默认 `reject` 更贴合 FR-06 P0 |
| 编译测试命令「不猜测执行」 | 3.7 | 见 RV-14 |
| `checked_and_clear` 字段名 | 5.2 | 与被审稿 `agreed` 语义相同，任选其一；`checked_and_clear` 更直白 |
| 命令 A 的提示语用 `--focus` | 3.1.1 | 见 RV-19 |
| `model_effective: unverified` 明确「不撒谎」 | 3.3.1 | 被审稿 11.2 第 4 点已有 `model_effective_source: requested`，建议同时允许 `unverified` 值 |

### 4.2 来自 gemini 版

| 做法 | gemini 版位置 | 吸收方式 |
| :--- | :--- | :--- |
| 以 `.claude/skills/` 为主、commands 为别名 | 4.1.1 | 见 RV-08 第 4 行 |
| 独立审查报告 Markdown 的人读结构（总体评价 → 明细） | 5.1 | 被审稿 `render` 模块可参考其章节骨架 |

### 4.3 明确不采纳并建议被审稿在正文背书

| 参照做法 | 出处 | 不采纳理由 |
| :--- | :--- | :--- |
| 只读失守后自动 `git checkout / clean` 回滚 | gemini 版 4.4.2、第 7 章 | 命令 A 期间工作区含 Driver 未提交改动，自动回滚会误删；PRD AC-08 只要求检出与告警。被审稿 10.3 与 glm 版 D10 立场一致，正确 |
| 预检直接驳回 Claude 系审查模型 | gemini 版 4.3.1 第 2 点 | PRD FR-17 / AC-18 允许显式覆盖且要求可见；被审稿 11.5「不阻止但必须可见」正确 |
| 使用 `--dangerously-skip-permissions` | reference/gemini 早期答卷 | 与 FR-15 正面冲突；三份综合设计已一致否决 |
| 编排器用 TypeScript + 第三方库 | gemini 版 8.1 | 会给目标项目强加 Node 工具链；被审稿 AD-12 与 glm 版 D9 的标准库路线更合适 |
| 追溯矩阵自评「100% 覆盖」 | gemini 版第 9 章 | 实际缺 FR-23、NFR-02/03/05/06/07 行；gemini 版自称「已批准 · 实施基线」与索引口径不符，建议其元信息改为「评审中」或「参考」 |

---

## 5. 需回填 PRD 与同步仓库文档的事项

| # | 对象 | 事项 | 来源 |
| :--- | :--- | :--- | :--- |
| 1 | PRD FR-07 | 表述改为「项目根或其等价冻结快照」，或维持字面并要求设计默认 `in-place` | RV-02 |
| 2 | PRD FR-14 / AC-12 | 裁决词统一为「接受 / 驳回 / 暂缓」 | RV-09 |
| 3 | PRD 11.2 | 回填已裁决项：归档根 `.reviews/`；命令拼写 `/dual-*`；默认 `strict`；阶段目录 `plan/ code/ bug/ verify/`；版本后缀 `-r<N>` 文法；编译测试命令来源为配置显式声明 | RV-12、RV-14、RV-25 |
| 4 | PRD 4.4 第 3 条 | 明确「不得自动继续」的约束对象是流水线，不含开发者手工编辑 | RV-05 |
| 5 | 仓库 `.gitignore` | `.claude/` 改为白名单方式 | RV-06 |
| 6 | 根 `README.md`、`.reviews/README.md`、`.env.example` | 按被审稿 18.2 既有条目同步 | 被审稿 18.2 |
| 7 | `doc/02_design/README.md` | 补录本审核意见；被审稿 18.2 对该文件的描述更新 | RV-25 |
| 8 | gemini 版元信息 | 「已批准 · 实施基线」改为「评审中」或「参考方案」 | 第 2 章 |

---

## 6. 裁决建议与修订清单

### 6.1 v1.1.0 必改项（改完再改状态为 Approved）

| 编号 | 一句话 |
| :--- | :--- |
| RV-01 | `review` 拆 `--start` / `--wait`，写明 Bash 工具超时约束 |
| RV-02 | `mirror` 立 ADR 待批；`in-place` 规格化为完整备选；写明镜像树能力损失与依赖带入方案 |
| RV-03 | 独立 HOME 与凭据的矛盾改由探针决定；补两项探针 |
| RV-04 | 缓存键加 `brief_hash`，或一期不做缓存 |
| RV-05 | 写锁限同会话或 TTL；拒绝审批释放业务写锁；补放弃路径 |
| RV-06 | 18.2 补 `.gitignore`，`init` 幂等写规则 |
| RV-07 | 命令模板改用 `.trivium/bin/trivium` |
| RV-08 | 删 `MultiEdit`；改 Stop 阻断输出契约；补 8 次硬上限；补 commands vs skills 决策 |
| RV-09 | 裁决词对齐 FR-14，gate 收别名 |

### 6.2 建议随 v1.1.0 一并修订（不阻塞批准）

RV-10、RV-11、RV-12、RV-13、RV-14、RV-15、RV-16、RV-17、RV-19、RV-20、RV-21、RV-26。

### 6.3 待拍板项（在被审稿 18.1 基础上新增）

| # | 议题 | 审核建议 |
| :--- | :--- | :--- |
| 8 | 闸门期是否锁业务写、锁的作用域 | 同会话 + TTL，默认开 |
| 9 | 命令载体 commands 还是 skills | skills 为主，commands 别名 |
| 10 | `parse_fallback` 侧意见是否进入裁决表 | 进入，标 `source: fallback` |
| 11 | ZCode 模型覆盖不可用时 `reject` 还是 `annotate` | 默认 `reject` |
| 12 | 审查员是否允许只读命令执行 | 允许白名单命令，但需与隔离模式（RV-02）一起决定 |

### 6.4 可延后（二期）

RV-18（`--add-dir` 原理待 M0 验证）、RV-22（MCP 形态来源）、RV-23（模型 ID 大小写由探针钉死）、RV-24（文档拆分为 ARCH/LLD/ADR）。

---

## 7. 变更记录

| 版本 | 日期 | 变更 |
| :--- | :--- | :--- |
| v1.0.0 | 2026-09-10 | 首版。对被审稿 v1.0.0 做设计评审，参照 gemini 版与 glm 版，核实 Claude Code Hooks 断言与仓库既有文件，形成 26 条意见与裁决建议 |
