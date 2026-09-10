# 执笔双审：macOS + VS Code 下的全自动三方 Agent 流水线

**文件**：`2026-09-10-Claude-Code主攻双智能体审核流水线-grok4.6.md`  
**性质**：技术方案（可实施）  
**环境**：macOS，VS Code，Claude Code 扩展作为唯一交互入口  
**外审运行时**：Google Antigravity CLI（`agy`）、智谱 ZCode CLI（`zcode`）

---

## 1. 要解决的问题

日常开发里，人已经在 VS Code 里和 Claude Code 对话：提需求、改计划、写代码、查 Bug。再开两个窗口，把同一段计划或 diff 分别贴给 Antigravity 和 ZCode，再手工把意见拷回来——这条路走不通，原因有三：

1. **做不到全自动。** 人会在赶工时跳过外审。
2. **用不成两家的编程 Agent。** 复制粘贴等于把它们降成聊天框；它们真正强的地方是自己读仓库、搜引用、跑检查。
3. **没有可追溯的工作记忆。** 意见留在三个产品的会话里，一周后无法回答「当时为什么改计划 / 为什么拒了某条意见」。

因此要做的不是「再包一层 LLM 路由」，而是：在 **VS Code 原生开发流**里，给仓库加一条**审单协议**。Claude Code 仍然是唯一执笔的人（主脑）；Antigravity 与 ZCode 以**各自的编码 Agent 运行时**被拉起，独立看同一份冻结树，把票写回仓库；Claude Code 必须对票逐条作答后才能继续往下干。全过程以普通文件的形式留在项目里。

成功时，使用者的体感应当是：

> 我只跟 Claude Code 说话。计划一写完，两边会自己去审；代码一成形，两边会自己去审。我随时能在仓库里翻到原稿、两份外审、改过的计划和「接受/不接受」的答复。

---

## 2. 三个产品分别能被「编程」到什么程度

方案必须贴着真实控制面设计。做不到的能力不要写进主路径。

### 2.1 Claude Code（执笔，VS Code 扩展）

它已经是 Agent，不是补全框。对本方案有用的控制点：

| 控制点 | 用途 |
|---|---|
| 扩展内对话 | 人只在这里交互 |
| 项目 `CLAUDE.md` | 告诉它审单往哪写、禁止自己去调 `agy`/`zcode` |
| Skills / 自定义斜杠命令 | `/review-plan`、`/review-code`、`/reply-reviews` 变成固定动作 |
| Hooks（`PostToolUse` / `Stop` / `PreToolUse`） | **确定性门禁**：写完计划自动交单、没答复完不准收工、未外审的提交可拦截 |
| `Bash` / 文件工具 | 可以调本仓库的小型 CLI；但不把编排逻辑放进对话 |
| 项目 `.mcp.json` | 可选。VS Code 扩展历史上出现过本地 stdio MCP 被静默关掉的情况，因此 MCP 不能当唯一触发器 |

结论：Claude Code 适合当**执笔 + 交单 + 答复**；不适合当进程调度器（超时、并行、伪终端、配置隔离会把主会话撑爆，且模型可能「忘了」交单）。

### 2.2 Antigravity（`agy`，Google 的编码 Agent）

它是带工具循环的 Agent CLI，不是 Gemini HTTP API。对本方案有用的控制点：

- 无界面跑一轮：`agy -p`（`--print` / `--prompt`）
- 指定本轮模型：`--model <slug>`（`agy models` 列出；写错会直接失败，不会偷换成默认模型）
- 推理强度：`--effort low|medium|high`
- 可选专用 agent：`--agent`（`agy agents`）
- 机器可读：`--output-format json` 或 `stream-json`
- 约束最终回答形状：`--json-schema`
- 安全：`--sandbox`；权限写在 `~/.gemini/antigravity-cli/settings.json` 的 `permissions.allow/deny`
- 无界面时，需要人点头的工具会被 **soft-deny**：进程仍可能返回 0，但工具没执行，审查是空的

结论：外审必须预授权「读文件 + 少量只读命令」，同时禁止写业务文件。审查结果以 schema 化 stdout 为准，由调度器落盘，不让 `agy` 去改仓库。

### 2.3 ZCode（智谱的编码 Agent）

它同样是编码 Agent（桌面应用内带 CLI），不是 BigModel 的 `chat/completions`。对本方案有用的控制点：

- 无界面：`zcode --prompt "..." --json`
- 工作区：`--cwd`
- 把审单当附件：`--attach`
- 长任务目标：`--target`（走 Goal，而不是单轮问答）
- 权限档：`--mode plan|edit|yolo` 等
- 部分版本支持从工具集拿掉写操作（如 `--disallowed-tools`）
- **没有可靠的 `--model` 命令行。** 模型来自 `~/.zcode/cli/config.json` 的 `model.main`（必须是 `"供应商/模型"` 字符串），以及工作区里的 `zcode.json` / `.zcode/config.json`
- 项目公约读 `AGENTS.md`，不会持续把 `CLAUDE.md` 当运行时指令

结论：ZCode 的模型切换必须用**这份外审运行目录里的配置**，绝不能去改用户正在用的全局配置（否则和桌面端抢配置，也无法并行）。CLI 二进制在 App Bundle 内，VS Code 作为 GUI 进程看不到用户 `~/.zshrc` 的 PATH，必须在配置里写绝对路径。

### 2.4 明确拒绝的做法

- 用 `ANTHROPIC_BASE_URL` 指到智谱 Anthropic 兼容网关，让 Claude Code「假装自己是 ZCode」。那只是换了一个模型端点，没有 ZCode 的工具、模式、Goal、工作区公约。
- 用 Gemini / GLM 的 HTTP 补全接口，把计划全文塞进 prompt 生成一篇「代码评审」。那不是编程 Agent。
- 让三个产品开三个 VS Code 聊天面板，靠人转发。那不是流水线。

---

## 3. 方案比较

### 方案 A：执笔自己用 Bash 串两家 CLI

Claude Code 写完计划后自己执行 `agy -p` 和 `zcode --prompt`。

- 优点：组件最少，没有守护进程。
- 缺点：同一会话里两个外审只能串行；超时/重试/PTY/配置隔离全挤进对话；模型可能跳过；VS Code 停等十几分钟体验差；留痕格式会每次都不一样。

**不采用。**

### 方案 B：审单入队 + 仓库内监视器（本方案）

Claude Code 只负责把「请审这个」写成一张**审单文件**。VS Code 打开仓库时自动拉起一个本地监视器，发现审单就并行拉起两个编码 Agent，把票写回约定路径，再发信号让 Claude Code 去答复。

- 优点：执笔会话干净；两家真并行；格式和门禁由普通程序保证；VS Code 原生（Task 随工作区起停）；人只面对一个聊天窗口。
- 缺点：多一个小进程。对「打开 VS Code 开发」这一前提完全可接受。

**采用。**

### 方案 C：自研 VS Code 扩展做编排 UI

侧栏里点「送审」，Webview 看进度。

- 优点：进度可视化最好。
- 缺点：要跟三个 CLI 的升级赛跑，还要维护一套 UI；和「VS Code 原生开发流」相比，多了一个要安装、要审核权限的扩展。一期用 Task + 输出通道 + Markdown 预览就够。

**一期不做，进度用 Task 终端输出。**

---

## 4. 选定架构：审单，而不是瀑布状态机

开发任务不是一条必须走完的 S0→S8 传送带。一次功能开发里，计划可能改两轮，代码可能审三次，中途还可能插一次根因分析。把这些硬编码成一个大状态机，后续每次「再审一次」都要发明回退边。

本方案的原子单位是 **审单（ticket）**。

一张审单只做一件事：对**已经冻结的对象**，请两家编码 Agent 独立出具审查票，再请执笔出具答复。

审单类型只有三种：

| 类型 | 冻结对象 | 典型触发 |
|---|---|---|
| `plan` | 需求说明 + 计划文稿 + 当时的代码树 | 执笔写出计划文稿 |
| `diff` | 基线 SHA 与当前 SHA 之间的补丁 + 当时的代码树 | 执笔完成一截实现，或即将提交 |
| `rca` | 事故说明 + 执笔的根因草稿 + 当时的代码树 | 执笔写出根因判断 |

一个业务任务（例如「OIDC 登录」）对应一个**任务夹**，里面按时间堆叠多张审单的产物。任务夹没有「当前阶段」这个易过期字段；有没有资格继续编码 / 提交，只看：**是否存在未关闭的审单**。

```
人 ──对话──► Claude Code 扩展
                 │ 写计划 / 写代码 / 写答复（仅此进程改业务文件）
                 │ 交审单（写 queue 文件，或由 Hook 代写）
                 ▼
        VS Code Task：triad-watch（监视器）
                 │ 读 queue，冻结树，并行 spawn
        ┌────────┴────────┐
        ▼                 ▼
   agy 编码 Agent     zcode 编码 Agent
   （独立冻结目录）    （独立冻结目录）
        │                 │
        └────────┬────────┘
                 ▼
        任务夹里落下两张票 + 轨迹
                 │
                 ▼
        Hook 唤醒 Claude Code 写答复
                 │
                 ▼
        审单关闭；任务夹成为日后翻阅的档案
```

监视器是普通程序，负责：排队、超时、并行、隔离、校验、落盘。两家外部产品只被当成「会用工具的审查员进程」。

---

## 5. 仓库里的两套目录（给人看 / 给机器跑）

用户要求「保存在项目特定文件夹，以备后续参考」。给人翻的东西必须进 Git；给 Agent 跑的沙箱不能进 Git。

```
<repo>/
  CLAUDE.md                      # 执笔短指令（指向协议）
  AGENTS.md                      # 给 ZCode 的项目公约（它不拿 CLAUDE.md 当运行时指令）
  docs/agent-reviews/            # ★ 人要归档的全部文稿（提交进 Git）
    _protocol.md                 # 本协议的人读版
    2026-09-10-oidc/             # 一个业务任务一夹
      task.md                    # 任务元数据：标题、范围、模型默认值覆盖
      01-requirement.md
      02-plan-claude.md          # 执笔原始计划
      tickets/
        20260910T143012Z-plan/
          ticket.yaml            # 审单（含两家本次使用的模型）
          03-ballot-antigravity.md
          04-ballot-zcode.md
          05-plan-revised.md     # 执笔修改后的计划（plan 类审单必有）
          06-reply-claude.md     # 逐条接受 / 不接受 / 部分接受
        20260910T151500Z-diff/
          ticket.yaml
          03-ballot-antigravity.md
          04-ballot-zcode.md
          06-reply-claude.md     # 代码审：答复里写清改哪些、拒哪些
      ...
  .triad/                        # 机器运行时（大部分 gitignore）
    config.yaml                  # 本机绝对路径、超时；可提交一份不含密钥的模板
    models.yaml                  # 按审单类型给两家的默认模型
    lenses.yaml                  # 两家各自盯什么（避免问同一道题）
    queue/                       # 待跑审单的指针（gitignore）
    run/<ticket-id>/             # 一次运行：两份冻结树、原始日志（gitignore）
    last-reviewed.json           # 每个任务最近一次已关闭 diff 审单的 head SHA
  tools/triad/                   # 监视器与两个 runner（提交进 Git）
  .claude/skills/                # 交单 / 答复技能
  .claude/settings.json          # Hooks
  .vscode/tasks.json             # 打开仓库即启动监视器
```

**计划类审单落盘的四件套（对应需求原文）：**

1. `02-plan-claude.md`（或该轮的计划原稿，ticket 里用路径指过来）  
2. `03-ballot-antigravity.md`  
3. `04-ballot-zcode.md`  
4. `05-plan-revised.md`  

另存 `06-reply-claude.md`，否则「改了计划」无法回答「哪些意见被拒」。

**代码类审单落盘的三件套：**

1. `03-ballot-antigravity.md`  
2. `04-ballot-zcode.md`  
3. `06-reply-claude.md`  

`ticket.yaml` 记录冻结 SHA、模型、时间、轨迹文件哈希，是机器索引，也一并提交。

---

## 6. 审单格式

`ticket.yaml` 是监视器唯一识别的工作令。由执笔技能或 Hook 生成，人也可以手写一张来补跑。

```yaml
id: 20260910T143012Z-plan
task: 2026-09-10-oidc
kind: plan                 # plan | diff | rca
created_by: claude-code
created_at: 2026-09-10T14:30:12Z

subject:
  requirement: docs/agent-reviews/2026-09-10-oidc/01-requirement.md
  plan: docs/agent-reviews/2026-09-10-oidc/02-plan-claude.md
  # kind=diff 时改用：
  # base: 4aa1c0
  # head: 9f31e2
  # patch: tickets/.../REVIEW.diff   # 监视器生成，执笔不用手写

reviewers:
  antigravity:
    model: gemini-3.1-pro-high     # 可被 models.yaml 默认填充
    effort: high
  zcode:
    model: GLM-5.3
    thought: max

status: queued             # queued|running|ballots_ready|replied|closed|failed
```

关闭条件（普通程序判定，不由模型自称）：

- 两张 ballot 通过结构校验；
- `06-reply-claude.md` 覆盖两张票里每一条 `id`；
- `kind=plan` 时 `05-plan-revised.md` 存在（即使「无修改」也要写明「无修改及原因」）；
- 被标为 `must` 的条目，答复不得是空拒绝（见第 11 节）。

---

## 7. VS Code 里如何「全自动」

人仍然只开一个 Claude Code 面板。自动来自三处，按强度递增。

### 7.1 打开仓库即有监视器

`.vscode/tasks.json`：

- 任务名 `triad: watch`
- `runOptions.runOn: folderOpen`
- `isBackground: true`
- 命令：`python3 tools/triad/watch.py`

监视器轮询（或用 FSEvents）`.triad/queue/`。有新审单就跑。VS Code 关掉则监视器停——这符合「在 VS Code 里开发」而不是做后台 CI 机器人。需要夜间无人值守时，再用 `claude -p` 调同一套 `tools/triad`，那是同一程序的第二条入口，不是另一套逻辑。

监视器把两家进程的心跳打到该 Task 终端，避免「黑盒等 15 分钟」。

### 7.2 写到约定路径就交单（不必每次记斜杠命令）

`.claude/settings.json` 里 `PostToolUse`，匹配 `Write|Edit`：

- 写入 `docs/agent-reviews/<task>/02-plan-claude.md` 或 `02-plan-claude.vN.md` → `submit.py --kind plan`。`vN` 用于「新开一轮计划」（例如代码审发现计划层错误后重写），**不是**答复用的修订稿。
- 写入 `05-plan-revised.md` **不**交新单：它属于当前 plan 审单的四件套，用来关闭这张单。
- 写入任务夹内 `*rca*` 草稿 → `--kind rca`
- `submit.py` 只写 `ticket.yaml` 和 `.triad/queue/` 指针，**自己不跑 Agent**（Hook 不能阻塞编辑器）

斜杠技能仍保留，用于：计划还在对话里、尚未落盘时的显式交单；或强制用另一组模型重审。

### 7.3 没审完 / 没答完就不能收工

`Stop` Hook 跑 `python3 tools/triad/gate.py stop`：

| 仓库状态 | Hook 行为 |
|---|---|
| 无未关闭审单，且相对 `last-reviewed.json` 无未审 diff | 放行 |
| 有 `queued/running` 审单 | exit 2，告诉执笔「外审还在跑，去看 Task 终端」 |
| 有 `ballots_ready` 但无答复 | exit 2，并注入：去读两张 ballot，写 `06-reply-claude.md` |
| 工作区相对上次已审 `head` 有实质 diff，却没有对应 `diff` 审单 | exit 2，令其交 `diff` 审单 |

`PreToolUse` 匹配 `Bash`，若命令像 `git commit` / `git push`，同样走 `gate.py commit`：未关闭审单或未审 diff 则拦截。这比「写在 CLAUDE.md 里请你不要提交」可靠。

GUI 进程 PATH 不含 Homebrew。`config.yaml` 必须是绝对路径：

```yaml
bin:
  agy: /opt/homebrew/bin/agy
  zcode: /Users/you/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs
  node: /opt/homebrew/bin/node
  git: /usr/bin/git
timeouts:
  plan_sec: 900
  diff_sec: 1200
  rca_sec: 1200
```

`python3 tools/triad/doctor.py` 在第一次使用时检查：三个二进制能跑、`agy models` 可列、ZCode 配置里 `model.main` 是字符串、隔离运行目录能拉起（见第 9 节）、Claude Code 的 `/mcp` 若不可见也不算失败（MCP 非必须）。

---

## 8. 冻结：两家看到同一棵树，但彼此看不见对方的票

独立性如果只靠提示词「请不要参考另一位评审」，等于没有独立性。

监视器对每张审单做一次**内容寻址冻结**：

1. 要求任务相关文件已在 Git 里（未提交的执笔草稿：先由执笔提交，或 `submit.py` 把工作区快照 `git stash create` 记进 ticket 的 `wip_stash`，冻结时一并检出）。不允许「磁盘上是 A、审的是 B」。
2. `git rev-parse HEAD` 与 `git diff --stat` 写入 `ticket.yaml` 的 `freeze.git_rev` / `freeze.dirty`。脏工作区且用户未声明 wip，则拒绝交单。
3. `git archive <rev>` 解压到两个目录：  
   `.triad/run/<ticket-id>/agy/tree/`  
   `.triad/run/<ticket-id>/zcode/tree/`  
   **不**复用主仓库的 `.git`。外审进程即使执行 `git commit` 也进不了主仓库。
4. 把审查对象放进树内固定位置，让 Agent 用读文件工具自己打开，而不是把全文糊进 prompt：
   - `plan`：`_review/requirement.md`、`_review/plan.md`
   - `diff`：`_review/REVIEW.diff`、`_review/RANGE.txt`（base/head）
   - `rca`：`_review/incident.md`、`_review/rca-draft.md`
5. 写入该审查员专用的短指令：
   - agy 侧：`_review/GOAL.md`
   - zcode 侧：覆盖一份仅在冻结树内的 `AGENTS.md`（只审不改、输出 schema、本侧 lens）
6. 目录只读：`chmod -R a-w tree/`（`_review` 在解压后、chmod 前写完）。
7. 两棵树互不挂载对方的 `docs/agent-reviews/**/tickets/*/03-ballot-*`。运行目录里根本没有另一家的票。

`diff` 类额外生成 `REVIEW.diff = git diff --find-renames base...head`。编码 Agent 的价值是：**对着补丁去树上核实**，而不是在聊天里看一段粘贴的 diff。

---

## 9. 如何真正驱动两家「编程 Agent」

### 9.1 共同约定

- Prompt / Goal 只说明角色、镜头（lens）、输出形状、禁止修改文件。**不**粘贴计划或 diff 正文。
- 最终回答必须能被解析成 ballot。`agy` 优先 `--json-schema`；ZCode 在 Goal 里要求同一 JSON，markdown 票由监视器渲染，保证人读的 `03-`/`04-` 文件结构稳定。
- 落盘者是监视器，不是 Agent。Agent 的写工具应当不可用。
- 跑完后 `diff -qr` 对比冻结树与 `git archive` 的原始结果，有差异则整次外审作废。

Ballot 对人显示为 Markdown，机器认 YAML 头 + 列表。字段从简，但每条意见必须能被答复引用：

```markdown
---
ticket: 20260910T143012Z-plan
reviewer: antigravity
model_effective: gemini-3.1-pro-high
outcome: changes-requested     # agree | changes-requested | block
---

## 总判断
（不超过 8 行）

## 意见
### AGY-1
- level: must          # must | should | consider
- where: src/auth/oidc.ts:88 或 plan.md#风险
- what: ...
- why: ...
- evidence: 读了哪些文件、或哪条测试想法
- hint: 修复方向（禁止给出大段可粘贴补丁）

## 同意的部分
## 这次没看的部分
```

Antigravity 编号 `AGY-n`，ZCode 编号 `Z-n`，全任务夹内单调递增，避免两轮审单撞号。

### 9.2 镜头：两家不要被问同一道题

`.triad/lenses.yaml`：

```yaml
plan:
  antigravity:
    - 需求有没有被计划漏掉
    - 架构和不可逆决策（数据模型、对外契约、迁移）是否写明
    - 放弃的方案理由是否站得住
  zcode:
    - 边界、失败路径、并发与幂等
    - 数据一致性
    - 计划里的验收是否真能测
diff:
  antigravity:
    - 实现是否偏离已通过的计划
    - 对外契约漂移
    - 无必要的复杂度
  zcode:
    - 安全（注入、鉴权、密钥、路径）
    - 并发与错误处理
    - 测试缺口（这条测试怎样才会失败）
rca:
  antigravity:
    - 证据链是否闭合
    - 是否可能有第二根因
  zcode:
    - 复现是否充分
    - 修复面是否过大
    - 同模式是否在别处
```

监视器把对应镜头写进该侧 `GOAL.md`。这是分工，不是把一家当「主审」。两家仍独立看全对象，只是注意力先验不同。

### 9.3 Antigravity runner

在冻结树作为 cwd、独立配置目录下启动（避免改用户日常 `settings.json`）：

```text
HOME=<repo>/.triad/run/<id>/agy/home
cwd=<repo>/.triad/run/<id>/agy/tree
agy -p "$(cat _review/GOAL.md)"
    --sandbox
    --model <ticket.reviewers.antigravity.model>
    --effort <effort>
    --print-timeout <timeout>
    --output-format stream-json
    --json-schema <repo>/tools/triad/schema/ballot.json
```

独立 `HOME` 里放一份 Critic 专用 `settings.json`：

- 允许：读冻结树、`git diff`/`git log` 用不上（树里无 .git），因此允许的命令是测试与类型检查的白名单；
- 拒绝：`write_file(*)`、`execute_url(*)`、`sudo`、任何 `git commit/push/reset`。

无界面下若读文件还要审批，会出现「exit 0 但没读任何文件」。所以要预授权读。同时又必须禁止写。禁止使用 `--dangerously-skip-permissions` 图省事。

`stream-json` 里 `step_type=tool` 的事件写入 `run/.../agy/trace.json`。监视器要求：至少有若干次读文件（默认 5；`diff` 且补丁为空时可豁免）。否则视为「没用 Agent，只是在空转生成评论」，审单失败重试一次，再失败则 `status=failed`，Stop Hook 升级给人。

macOS 上若发现管道下 stdout 为空但仍 exit 0，用 BSD `script -q /dev/null agy ...` 套一层伪终端后重试一次。

认证：用户需先在本机交互登录过 `agy`。若独立 HOME 导致 Keychain 对不上，runner 只把配置文件指到副本，凭据仍走用户已有登录；具体以 `agy --help` 是否支持独立 settings 路径为准，由 `doctor.py` 写进 `config.yaml`。密钥不进仓库。

### 9.4 ZCode runner

```text
HOME=<repo>/.triad/run/<id>/zcode/home
cwd=<repo>/.triad/run/<id>/zcode/tree
zcode --cwd <tree>
      --prompt "$(cat _review/GOAL.md)"
      --attach _review/GOAL.md
      --attach _review/plan.md          # 或 REVIEW.diff
      --json
      --target "按 GOAL 完成审查，把 JSON 作为最终回复；不要修改任何文件"
```

模型：在**该冻结树**写入 `.zcode/config.json`（以及如需要的、从用户配置复制来的 provider 段），`model.main` 设为本次 ticket 指定的字符串。用户全局 `~/.zcode/cli/config.json` 只读复制进独立 HOME，不写回。这样：

- 桌面里正在用的 ZCode 不受影响；
- 两张不同模型的审单可以并行；
- 不依赖一个并不存在的 `--model` 参数。

写隔离：优先工具集禁用 Write/Edit/ApplyPatch。若本机版本没有该开关，则 `--mode plan` + 只读目录 + 跑后比对。Bash 若无法禁用，在独立 HOME 的 `PATH` 最前放置 `tools/triad/bin/cmd-proxy`，只放行测试与只读 git 风格命令（冻结树无 `.git` 时 git 本身无意义，主要放行 `npm test` / `pytest` 等）。

ZCode `--json` 往往只有整段 `response`，没有逐步 tool 事件。轨迹用下列顺序补：独立 HOME 下 session 库、或对冻结树的只读打开记录。`doctor.py` 必须在本机钉死一种，否则「用了编程 Agent」无法证明。

二进制探测顺序：`config.yaml` 绝对路径 → `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`。必要时 `ELECTRON_RUN_AS_NODE=1` 加上 App 可执行文件调用 cjs。

不要让 ZCode 去读主仓库 `CLAUDE.md` 里「请实现 OIDC」的执笔指令。冻结树里的 `AGENTS.md` 只保留审查员身份。

### 9.5 并行、超时、重试

监视器对每个 ticket `Popen` 两个 runner。超时：先 SIGTERM，再 SIGKILL。只对空输出、429、伪终端丢失重试一次。schema 不合格时，把校验错误追加进 Goal，对 `agy` 用 `--conversation`、对 `zcode` 用 `--resume` 再要一次结构化结果，仍失败则 `failed`。

同一 `(ticket 内容哈希, reviewer, model)` 命中则直接复用票，避免人反复交单烧配额。

---

## 10. 按任务指定不同模型

`.triad/models.yaml` 提供默认；每张 `ticket.yaml` 可覆盖。斜杠技能允许：

```text
/review-plan --agy-model gemini-3.1-pro-high --zcode-model GLM-5.3
/review-code --agy-model gemini-3.8-flash-high --zcode-model GLM-5.3-Flash
```

`submit.py` 把参数写入该 ticket 的 `reviewers`。监视器启动 CLI 前再读一遍实际生效值，写进 ballot 头的 `model_effective`。只信「进程侧被设定成什么」，不信「yaml 里想用什么」——ZCode 在启动后把独立配置里的 `model.main` 回读一遍。

建议默认（安装后用 `agy models` 和 ZCode 模型目录替换成真实 slug）：

| 审单 | Antigravity | ZCode |
|---|---|---|
| plan / rca | 更强、更慢的 reasoning 档 | GLM 旗舰 + 最高思考 |
| diff（普通） | 较快的 high-effort 档 | 旗舰或 Flash，看仓库规模 |
| 安全相关 diff | 与 plan 同档 | 旗舰 + 最高思考 |

两家默认就应该不同。相同模型、相同镜头的双审只是把费用乘二。

---

## 11. 执笔如何消化两张票

Claude Code 在 `ballots_ready` 时被 Stop Hook 拉回来，只做四件事：

1. 读两张 ballot 全文（技能里写明：禁止只读总判断）。
2. 写 `06-reply-claude.md`：每个 `AGY-*` / `Z-*` 一行，`adopt` / `adopt-partial` / `decline`。
3. `kind=plan`：写出 `05-plan-revised.md`。采纳导致的计划变化必须出现在修订稿，而不是只存在对话里。
4. `kind=diff`：按采纳项改代码；`decline` 必须给出仓库内证据（文件+行，或「计划第 x 节已排除」）。

`gate.py` 对答复的硬规则：

- 漏 id → 未关闭。
- 两家都提出的同一 `must`（文本相似或指向同一 `where`）→ 禁止 `decline`。
- 单家 `must` 且 `evidence` 为空 → 降为 `should`，允许 decline，但仍要理由。
- 单家 `must` 且有可执行证据 → 视同有效，必须处置。
- 连续两张 diff 审单里执笔对同一条意见 `decline` → 审单保持 open，并在 `task.md` 记争议，等人拍板。自动流水线到此让路，避免两家模型互相消耗。

若后续又要改计划（新一轮，而不是关闭当前审单时那份 `05-plan-revised.md`），执笔应写成新的 `02-plan-claude.vN.md` 再交单。旧 ticket 整包保留。档案只追加，不需要「退回第几步」。

---

## 12. 失败、降级、与「太慢就被绕过」

| 事件 | 行为 |
|---|---|
| 一家 runner 崩溃 | 另一家票仍落盘；ticket `failed`；Stop Hook 要求人决定：重跑这一家，或书面接受单审（写入 `task.md` 的 `single_review_reason`）。禁止把单审文件改名伪装成双审 |
| 两家都超时 | 入 `failed`，不生成空票 |
| 冻结树被写入 | 作废该侧票 |
| 无读文件轨迹 | 作废 |
| 人赶工想跳过 | `submit.py --skip` 必须 `--reason`，在任务夹写 `SKIPPED.md` 并进 Git。默认可在 `config.yaml` 关掉 skip |

为避免「每次改一个空格都双审 20 分钟」，`gate.py` 对 `diff` 审单做范围判断：若 `git diff` 只有文档/注释/格式且配置允许 `diff_skip_paths`，可以不建票。判断规则是程序，不是模型。业务代码、锁文件以外的依赖清单、CI 与权限相关文件一律要审。

---

## 13. 安全

- 外审进程 cwd 只有冻结树；主仓库 `.git` 不在其命名空间。
- 出网：sandbox 默认不允许随便访问 URL；模型调用走 `agy`/`zcode` 自己的运行时，不给通用 `curl`。
- 密钥：不写入 `docs/agent-reviews/`，不写入 ticket。独立 HOME 里的配置若含 key，整个 `run/` gitignore。
- 被审文本当数据。Goal 用明确分隔符。冻结树只读，降低「计划里藏一句请改 src」的注入。
- `docs/agent-reviews/**` 提交前可用现成密钥扫描；发现 token 则 `gate.py close` 失败。

---

## 14. 组件清单（一期）

全部放在 `tools/triad/`，Python 3.12 标准库为主（`subprocess`、`json`、`hashlib`、`pathlib`）。不给业务仓库强加 Node 工具链——业务仓库可能是 Go/Rust/Python 任一语言。

| 模块 | 职责 |
|---|---|
| `watch.py` | VS Code 后台任务；消费 queue |
| `submit.py` | 生成 ticket + queue 指针；填充默认模型 |
| `freeze.py` | git archive、两份树、chmod、写入 GOAL/AGENTS |
| `run_agy.py` | 独立 HOME、schema、stream-json、轨迹 |
| `run_zcode.py` | 独立 HOME + 树内 `.zcode/config.json`、json 响应 |
| `render.py` | JSON ballot → 人读 Markdown |
| `gate.py` | Stop / 提交 / 答复完整性 |
| `doctor.py` | 本机能力探测，写回 `config.yaml` 的 probe 段 |
| `schema/ballot.json` | 给 `agy --json-schema`，ZCode 的 Goal 复述同一形状 |
| `bin/cmd-proxy` | 命令白名单 |

Claude Code 侧只提交：

- `.claude/skills/review-plan/SKILL.md` 等三个技能；
- `.claude/settings.json` 的 Hook 命令行；
- `CLAUDE.md` 里五到十行指针。

不在对话里实现调度。

---

## 15. 一条任务的实际时间线

1. 人在 Claude Code 说：要做 OIDC 登录。  
2. 执笔建 `docs/agent-reviews/2026-09-10-oidc/`，写 `01-requirement.md`、`02-plan-claude.md`。  
3. `PostToolUse` 交一张 `plan` 审单。人在编辑器里可以继续看代码，Task 终端显示两家 Agent 在读仓库。  
4. 两张票出现在 `tickets/<id>/`。`Stop` 拦住「我去写代码了」，要求先写 `06-reply-claude.md` 和 `05-plan-revised.md`。  
5. 执笔按答复改计划（如需）并开始编码。  
6. 人说「提交吧」或执笔准备 commit：`gate.py` 发现相对上次已审 SHA 有代码 diff，强制交 `diff` 审单。  
7. 再一轮双票 + 答复（接受则改代码，不接受则写证据）。  
8. 审单 `closed`，`last-reviewed.json` 更新。现在才允许 commit。  
9. 日后翻任务夹，四件套 / 三件套和每条意见的命运都在。

中途若外审认为「计划本身错了」而不是「这行代码错了」，执笔更新计划文件 → 自动再开一张 `plan` 审单。旧档案不动。

---

## 16. 怎样算做完（验收）

用一个故意留洞的玩具仓库跑一次，下列全部要发生，而不是靠演示对话「看起来像」。

1. 只打开 VS Code + Claude Code，从不打开 Antigravity / ZCode 窗口，能完成第 15 节时间线。  
2. 进程列表里出现 `agy` 与 `zcode`（或 `zcode.cjs`），且 cwd 是 `.triad/run/.../tree`，不是主工作区。  
3. 两份轨迹里有多次读文件；人为把写工具塞回 runner 时，主仓库 Git 仍无外审提交。  
4. 计划四件套、代码三件套出现在 `docs/agent-reviews/...` 并可 `git log` 到。  
5. 同一任务第二次 `plan` 审单改用另一组模型，两张 ticket 的 `model_effective` 不同，用户自己的 ZCode 桌面默认模型不变。  
6. 删掉一张 ballot 后，`gate.py` 不允许 commit。  
7. 答复漏掉一个 `must` id，执笔无法 Stop。  

`doctor.py` 加 `--selftest` 覆盖 3、6、7 中能用夹具模拟的部分。1 和 5 是手工验收。

---

## 17. 实施顺序

不要先写监视器框架。先在本机用最小命令证明两家 Agent **能在冻结树上只读审查并吐出 JSON**。

1. **探测日**：绝对路径、`agy -p` + schema + 读一个 README、`zcode --prompt --json --cwd` 读同一 README、确认 ZCode 树内配置能换模型且不改用户 HOME。把结论写进 `config.yaml`。  
2. **freeze + 两个 runner**：人工放一张 ticket，命令行跑 `watch.py --once`，得到两张票。  
3. **submit + 目录约定 + 渲染 Markdown。**  
4. **Hooks + gate**：只拦 Stop 与 commit。  
5. **models.yaml 与 ticket 覆盖。**  
6. **VS Code folderOpen Task、doctor、gitignore、CLAUDE.md。**  

到第 4 步，流水线已经「全自动」；后面是能换模型、能给别人装。

---

## 18. 设计上刻意不做的事

- 不把 Antigravity / ZCode 嵌进 Claude Code 的同一条聊天时间线。它们的价值是独立工具循环，不是第三个气泡。  
- 不在一期做反驳辩论赛（把 A 的票给 B 再吵一轮）。冲突规则见第 11 节，升级给人。  
- 不把监视器做成常驻系统服务。它属于这个工作区。  
- 不让外审直接改业务代码。否则「双审」变成「三个作者」。  

---

以上是按三家产品真实控制面和「全自动、可归档、必须用编程 Agent」这三个约束推出来的实施方案：以**审单**为原子、以**任务夹**为档案、以 **VS Code 后台监视器**调度、以 **Hook** 保证执笔不能跳步。CLI 参数以探测日为准；探测结果和本文命令不一致时，改 runner，不改外审产品。
