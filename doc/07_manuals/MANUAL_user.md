# MANUAL：TriviumCode 使用手册

> - **作者 / 负责人**：Driver（Claude）
> - **创建日期**：2026-09-13
> - **当前版本**：v1.0.19
> - **状态**：草稿(Draft)
>
> **⚠️ 本手册描述的是当前可用的系统**：缺省由 Claude Code 主攻，缺省三侧（Antigravity / ZCode / Codex）背靠背审查。
>
> 三审加严已随 M8 第 3 步可用（默认即三侧，D4-4）；第四家 Claude Code 作审核者已随 M9 接入，入选前提是由另一家当 Driver。
> **换一家 Agent 在自己的会话里主攻已可用（M10b，2026-09-26）**：各载体的入口、调用写法与护栏等级（L1 / L2）见
> [QUICKSTART §5.2](./QUICKSTART.md)，本手册 §八开头给出 L2 时哪几道护栏还在。逐审核者选思考等级三档（M11）**尚未实现**。
> 本手册正文的示例以 Claude Code 主攻为主；Codex 侧的 provider 配置由 `doctor` 探测并给样例（v1.0.3 起不再写「随 M10b 补写」）。
>
> `--critics <id,…>` **已可用**，能从已启用的几家里指定本轮跑哪几侧
> （选一侧不算降级）。参数规则见 §4.2。
> （规范见[设计 v1.3.43](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md) 16.1 与 §24 台账。
> 术语上，N 方化后「双审」的正确称谓是「**多审**」；命令名 `/dual-*` 与归档目录一律不改名。）

---

## 本手册与 QUICKSTART 的分工

| | [QUICKSTART.md](./QUICKSTART.md) | 本手册 |
| :--- | :--- | :--- |
| 目标 | 照着敲，15 分钟跑通 | 理解每一步在干什么，能应对没照着剧本走的情况 |
| 命令 | 一览表 | 逐条完整契约、全部参数 |
| 配置 | 只讲必须配的那一项 | 全部字段逐条：默认值、什么时候改、改错的后果 |
| 出问题 | 六行速查 | 按症状分类的处置 + 已知限制 |

**第一次用请先读 QUICKSTART**，跑通之后再回来读本手册。本手册不假定你读过代码。

---

## 一、这是什么

一条让 **Claude Code 主攻写代码、另外两个 AI 背靠背复审**的流水线。

三个角色：

| 角色 | 是谁 | 能做什么 |
| :--- | :--- | :--- |
| **Driver**（执笔者） | 缺省 Claude Code；M10b 起四家都可当 | 当轮唯一能改业务代码的人。写方案、写代码、读审查意见、逐条裁决 |
| **Critic-A** | Google Antigravity（`agy`） | **只读**。独立审查，意见编号前缀 `AGY-` |
| **Critic-B** | 智谱 ZCode（`zcode.cjs`） | **只读**。独立审查，意见编号前缀 `GLM-` |
| **Critic-C** | OpenAI Codex CLI（多模型，经你配好的 provider 接入） | **只读**。独立审查，意见编号前缀 `CODEX-` |
| **Critic-D** | Claude Code（作审核者，须由另一家当 Driver） | **只读**。独立审查，意见编号前缀 `CLAUDE-` |

加一个本地编排器 `trivium`——它负责全部确定性逻辑：并行调度、超时、解析、落盘、防覆盖命名、闸门、留痕核验。

### 为什么要两个审查员，而且要背靠背

**背靠背**指两侧互相看不到对方的结论。这不是形式——它由三道机械屏蔽保证：审查期间对方的产出不在工作树里、原始输出落在项目外、送审任务书里逐条列出禁读路径并在事后与工具轨迹对账。

理由很朴素：一个模型看到另一个模型的结论后，倾向于附和而不是独立判断。两份独立结论的交集才是可信的，分歧则是需要人拍板的地方。

### 什么场景值得用

**值得**：

- 改动涉及并发、事务、权限、回滚路径这类「错了很贵」的地方
- 你自己也拿不准方案对不对
- 改的是别人要长期维护的代码
- 护栏、安全边界、判定逻辑本身——这类代码最容易「看起来合理地」开出洞

**不值得**：

- 纯文档改动（有 `skip_doc_only_review` 配置项专门跳过）
- 探索性试验、随手验证
- 一次双审墙钟 10~40 分钟、真实消耗两家厂商配额。改个错别字不值这个价

---

## 二、心智模型

### 2.1 一次运行的生命周期

```mermaid
flowchart TD
    A[你发一条 /dual-review-* 命令] --> B[预检：环境、探针、模型、认证]
    B --> C[冻结送审包<br/>记下工作树哈希与被审对象哈希]
    C --> D[渲染两份任务书<br/>各自带不同的禁读清单]
    D --> E{两侧并行审查}
    E --> F[Antigravity 独立审]
    E --> G[ZCode 独立审]
    F --> H[两侧齐备后**同时**落盘]
    G --> H
    H --> I[复算哈希判漂移]
    I --> J[Driver 读两份全文<br/>逐条裁决：接受/驳回/暂缓]
    J --> K{gate --check<br/>裁决完整性硬校验}
    K -->|不通过| J
    K -->|通过| L[停在人工审批闸门]
    L --> M[你 /dual-approve]
```

关键点：

- **两侧齐备后同时落盘**——不会出现「一侧先落盘，另一侧还能看到」的窗口
- **逐条裁决是强制的**，少一条、理由空洞、编号不存在，闸门都会退回让你补
- **停点是 B/C/D 三条命令的定义**，不靠 Driver 自觉

### 2.2 四个阶段

| 阶段 | 被审对象 | 命令 |
| :--- | :--- | :--- |
| `plan` | 计划文档 `plan/<日期>-<主题>-claude.md` | `/dual-review-plan` |
| `code` | `git diff <base>` 算出的补丁 | `/dual-review-code` |
| `bug` | 根因分析文档 `bug/<日期>-<主题>-claude.md` | `/dual-review-bug` |
| `verify` | 无（执行你配置的编译测试命令） | `trivium verify` |

### 2.3 「闸门」是什么

一个按 `<主题>/<阶段>` 记录的状态位，存在 `.trivium/state.json`。七个状态，你会打交道的是这三个：

| 状态 | 含义 | 此时会挡什么 |
| :--- | :--- | :--- |
| `running` | 双审进行中 | 改业务文件（审查员在读真实工作树，你改了就是漂移） |
| `review_done_awaiting_disposition` | 审查落盘、裁决未齐 | `git commit`、结束对话 |
| `awaiting_approval` | 裁决已通过、等你审批 | 改业务文件 |

其余四个（`idle` / `approved` / `rejected` / `abandoned`）都不挡任何东西。

---

## 三、安装与启用

**最容易搞混的一点：安装是一次性的，启用是每个项目都要做的。**

| | 安装 | 启用 |
| :--- | :--- | :--- |
| 做什么 | 把编排器装到 `~/.claude/skills/dual-critic/`，把各家的入口 skill 装进各自的 skill 根（本机装了哪几家就装哪几家，`--targets` 可指定） | 在项目里生成 `.trivium/`、注册 Hook（`.claude/settings.json` 与 `.zcode/config.json`） |
| 频率 | 每台机器一次（升级时重做） | 每个项目一次 |
| 命令 | `npm run build && node dist/install.cjs` | `trivium init` |

### 3.1 前置条件

| 项 | 要求 | 怎么确认 |
| :--- | :--- | :--- |
| 操作系统 | **macOS**。Linux / Windows **未验证** | — |
| Node.js | ≥ 18 | `node --version` |
| git | 项目必须是 git 仓库 | `git --version` |
| Antigravity | `agy` 可调用且**已登录** | `agy --version` |
| ZCode | 桌面端已装，CLI 凭据已配 | `ls ~/.zcode/cli/config.json` |
| Codex CLI | `codex` 可调用，provider 由你自己配好（缺省三侧之一） | `codex --version` |

**凭据由你自己配**。编排器只读取已有登录态，从不代你写凭据，也不会把凭据写进任何工件——落盘前有密钥扫描（10 条规则 + 熵判定），命中即拒绝落盘。

### 3.2 安装

```bash
git clone <仓库> TriviumCode && cd TriviumCode
npm install
npm run build
node dist/install.cjs
```

装完先自检，**零配额消耗**：

```bash
node ~/.claude/skills/dual-critic/scripts/trivium.cjs doctor --selftest
```

它在临时夹具里真跑一遍 14 步全流水线。两侧走桩适配器，所以它**证明不了两家 CLI 可用**——那是 `doctor` 的事。

### 3.3 为什么 `trivium` 不在 PATH 上

这是有意的。项目内一律用 `.trivium/bin/trivium`，它是一个 sh wrapper，**内含 node 的绝对路径**——VS Code 这类 GUI 进程不读你的 `~/.zshrc`，依赖 PATH 会在插件里失效。

还没 `init` 的项目里用全路径：`node ~/.claude/skills/dual-critic/scripts/trivium.cjs <子命令>`。

### 3.4 在项目里启用

```bash
cd <你的项目>
node ~/.claude/skills/dual-critic/scripts/trivium.cjs init
node ~/.claude/skills/dual-critic/scripts/trivium.cjs doctor   # 约 2~4 分钟，消耗少量配额
```

`init` 动四处，全部幂等：

```
.trivium/bin/trivium      新建，wrapper
.trivium/config.yaml      新建（已存在则**跳过，绝不覆盖**）
.claude/settings.json     合并 5 个 Hook（按事件名替换同名条目），原文备份到 .trivium-backup
.gitignore                整体忽略 .claude/ 改成白名单写法；追加 .trivium/ 规则
CLAUDE.md / AGENTS.md     追加带标记的协议片段
```

**`doctor` 必须在终端里跑，不要在 Claude Code 里跑。** 它需要 2~4 分钟，会击穿 Bash 工具的 600s 超时——届时配额已烧而结论未落盘。

### 3.5 必须补一步：配置编译测试命令

编排器**只执行你显式声明的命令，绝不猜测执行**——`scripts.test` 完全可能耗时极长、依赖外部服务或有副作用。

```bash
.trivium/bin/trivium doctor --suggest-verify   # 只展示候选，不写入
```

然后手工写进 `.trivium/config.yaml`：

```yaml
verify:
  build: ['npm run typecheck', 'npm run build']
  test:  ['npm test']
```

两组皆空时 `/dual-run` 会拒绝启动。

**monorepo 注意**：每条命令是独立的 `/bin/sh -c` 进程，cwd 固定为项目根，**前一条的 `cd` 不会累积到下一条**，每条都要自带 `cd`：

```yaml
verify:
  build:
    - cd client && pnpm build
    - cd server && go build ./...
```

### 3.6 升级

```bash
cd TriviumCode && npm run build && node dist/install.cjs
cd <你的项目> && node ~/.claude/skills/dual-critic/scripts/trivium.cjs init
```

升级会刷新 wrapper 和 Hook（旧条目被**替换**，不叠加）。但有两样**不会**自动更新：

> **⚠️ 坑一：`config.yaml` 不会刷新。**
> `init` 对已存在的 `config.yaml` 无条件跳过。想拿到新版默认值只能手工编辑。
> 实例：`wait_timeout_s` 的默认值从 540 改成了 180（把进度反馈从 9 分钟收到 3 分钟），但老项目的 config.yaml 里仍是 540，体感上与没有反馈没区别。

> **⚠️ 坑二：手工改过的协议片段不会刷新。**
> M10b 第 2 步之前，追加逻辑是「见 `<!-- BEGIN TriviumCode -->` 标记就跳过」，片段永远停在初始化那天的版本
> （实测某项目的片段落后 18 行，缺的正是**已知误拦的出口指引**）。
> 现在 `init` 按标记内正文的指纹判断：**没动过的旧版**原位升级为两段式（审查员身份 / Driver 协议），
> 并按注册表写进 `CLAUDE.md`、`AGENTS.md`、`GEMINI.md`；**标记内被手工改过的**不替换，`init` 输出里会提示。
> 手工同步：把标记内内容换成 `~/.claude/skills/dual-critic/protocol/` 下 `critic.snippet` 与 `driver.snippet` 的组合
> （`CLAUDE.md` 只要 Driver 段；`AGENTS.md`、`GEMINI.md` 审查员段在前、Driver 段在后）。

卸载：`node dist/install.cjs --uninstall`（只删本产品的入口 skill、运行时根与 Agent 定义，项目内的 `.trivium/` 与 Hook 不动；运行时根与仓库重叠或不是本产品的，只提示不删）。
设了指向工作树的 `TRIVIUM_ASSET_ROOT` 时，安装与卸载前请先取消它。

---

## 四、七条命令

四条主命令（A/B/C/D）+ 三条辅助命令。全部标了 `disable-model-invocation: true`——**只能由你发起，Driver 不会自己调用**。

### 4.1 `/dual-run` —— 全流程（命令 A）

```
/dual-run <任务目标> [--topic <主题>] [--focus <提示语>] [--context <路径,…>]
          [--profile <名称>] [--model-<审核者 id> <模型>]
          [--critics <id,…>] [--only <一侧>] [--allow-single]
```

出方案 → 双审 → 修订 → 编码 → 双审 → 应答 → 改码 → 真实执行编译测试。

`--critics` / `--only` / `--allow-single` 的含义见 4.7；在 `/dual-run` 里**计划审与代码审两轮共用同一组**。
写了 `--critics` 时，开跑前的预检查的就是这几家（三个阶段的模型与登录都在开跑前查）。

**A 是唯一不设人工闸门的命令**——它跑完整条链，中途不停。正文是**任务目标**（这次要达成什么），`--focus` 是可选补充。

前提：`verify.build` / `verify.test` 至少一组非空，否则拒绝启动。

### 4.2 `/dual-review-plan` —— 只审计划（命令 B）

```
/dual-review-plan <审查焦点提示语> [--goal <任务目标>] [--topic <主题>]
                  [--context <路径,…>] [--profile <名称>]
                  [--model-<审核者 id> <模型>]
                  [--plan-file <路径>] [--critics <id,…>] [--only <一侧>] [--allow-single]
```

**对「已有」计划做双审**——所以先得有一份草稿落在 `.reviews/<主题>/plan/<日期>-<主题>-claude.md`。让 Claude Code 写好再发这条命令。

### 4.3 `/dual-review-code` —— 只审代码变更（命令 C）

```
/dual-review-code <审查焦点提示语> [--base <ref>] [其余同上]
```

被审对象是 `git diff <base>`（默认 `HEAD`）+ 未跟踪文件。补丁**只算一次**后透传给两侧——逐侧各自 diff 会让两侧审的不是同一段变更。

补丁**无条件剔除** `.reviews/`、`.trivium/`、`.git/`，与你的 `.gitignore` 写了什么无关。这是安全边界不是优化：`.reviews/` 是刻意进版本管理的，对方产出刚落盘时处于未跟踪状态，若被收进补丁就会经**被审对象本身**泄漏给审查员。

### 4.4 `/dual-review-bug` —— 只审根因分析（命令 D）

```
/dual-review-bug <审查焦点提示语> [--rca-file <路径>] [其余同上]
```

**不得由 B 或 C 代替**。根因分析的审查镜头与计划、代码都不同。

### 4.5 `--focus` 与 `--goal` 的区别（最容易用错）

| | 问的是 | 进 BRIEF 第几段 | 必填？ |
| :--- | :--- | :--- | :--- |
| `--focus`（正文） | **这次重点看什么** | 第 2 段，**逐字嵌入** | B/C/D 必填，缺则退 64 |
| `--goal` | **这次要达成什么** | 第 4 段 | 不必填 |

`--goal` 省略时会自动回退：显式值 → `task.json` 已记录的目标 → 同主题 plan 原稿的首个标题/首段。**刻意不兜底到主题名**。

换了 `--focus` 必定触发重审——它是审查焦点，不是描述。

### 4.6 自由文本里含 `--` 时不必加引号

提示语正文里出现以 `--` 开头的词，**不需要你加引号**：Driver 构造命令时会把正文整段放进一个
单引号参数、旗标放在引号之外，正文里的 `--plan-file`、引号、`$`、`*` 都逐字进入焦点（EV-18 之后
`topic resolve` 按 argv 逐个 token 解析，不再自行分词）。真正要传的旗标写在正文之后即可：

```
/dual-review-plan 重点核实 --plan-file 透传说明是否准确 --topic 文档修正
```

若 `--topic` 被包进了正文而主题没显式给出，`topic resolve` 会退 64 并指出来（回落推断就是审在
错误的目录下）；其余旗标字样被包进正文只会在 `notes` 里提醒，Driver 会转述。若解析器提示
「主题异常短」，多半是正文没被包成一个参数、被裸露的旗标截断了。

### 4.7 `--critics`（选审核者）与 `--allow-single`（降级）

**这是两件不同的事**，本手册曾把它们混为一谈：前者是「本轮想让谁审」，后者是「有人没审成时怎么办」。
四条命令都收这组旗标；`/dual-run`（命令 A）的计划审与代码审两轮用同一组（EV-125 起，此前命令 A 拒收）。

| | 作用 | 后果 |
| :--- | :--- | :--- |
| `--critics <id,…>` | 指定本轮跑哪几侧，逗号分隔 | **不标降级**——选几侧是配置意图。留痕如实记入选集合 |
| `--only gemini\|glm` | `--critics` 的单元素**旧写法**，长期保留 | 同上。**不要与 `--critics` 同时给**，会退 64 |
| `--allow-single` | 入选侧有失败时不中止，用幸存侧的结果继续 | **这才是降级**：留痕记 `degraded_reason` 与 `degradations[]` |

`--critics` 的校验规则（任一条不过即**退 64 且不产生任何工件**）：

- 每项必须是当前**已启用为审核者**的 Agent，且在配置的 `agents` 段里有条目；
- 不得含当轮 Driver——自己审自己不构成二次审查；
- 不得重复（`--critics x,x` 多半是笔误，静默去重会悄悄减少侧数）；
- 个数在 1 到 `review.max_critics` 之间；
- 不给时取 `review.default_critics`，并**减去当轮 Driver**（缺省集合里的某家当了 Driver，就不审自己）。

**当前可选四家**：`codex`、`gemini`、`glm` 为缺省集合（默认即三侧）；`claude` 已启用为审核者，
但它是本会话的 Driver，只有 `--driver` 取另一家时才能入选——否则退 64 并告知原因。

`--allow-single` 受配置 `review.allow_partial_flag`（旧名 `allow_single_flag`）约束，二者是**与**关系：配置里关掉，命令行也开不回来。这是刻意的——否则「默认 strict」就只是纸面规定。

**降级绝不冒充双审**：幸存侧的文件照常落盘并标 `degraded`，失败侧在 `_meta/` 写一份 `.failed.json`，**不产出审查文档**。

### 4.8 三条辅助命令

```
/dual-approve --topic <主题> --stage plan|code|bug [--reason <附言>] [--reject --reason <理由>]
/dual-abandon --topic <主题> [--stage <阶段>] [--reason <理由>]
/dual-status  [--topic <主题>]
```

- `approve` 必须显式写 `--stage`
- `abandon` 可省略 `--stage`，批量放弃该主题全部非 running 的闸门
- **三种结论都解除写锁，工件一律保留**
- `reject` 必须带 `--reason`

### 4.9 直接调 CLI 的命令

这些没有 skill 包装，在终端里跑：

```bash
.trivium/bin/trivium doctor [--selftest|--suggest-verify|--no-model-calls|--only <cli>|env]
.trivium/bin/trivium preflight --stage plan|code|bug|all
.trivium/bin/trivium verify --topic <主题> [--only build|test]
.trivium/bin/trivium report --topic <主题> [--out <路径>]
.trivium/bin/trivium review --status <run_id>
.trivium/bin/trivium review --cancel <run_id>
.trivium/bin/trivium scrub [--dry-run]
```

`scrub` 对**整个运行根**做一次凭据清扫：遍历全部项目桶、**只抹凭据、一个目录都不删**。
会话启动的自动清扫只管本项目那个桶，别的仓库遗留的副本要等它自己再开一次会话——
到期整删也一样，只在那个仓库自己的会话启动时跑（那一轮记录里的审查员 CLI 仍在、判不了或读不懂时，到期也不删，见场景 4 与 BACKLOG EV-164；配 `run_dir_days: 0` 时连这一支也没有）。
所以**不再回到那个仓库，它的桶就不会有任何自动清理**，凭据副本与运行目录都一直留在盘上（v1.0.19 起改准，EV-166）；
回去了也要那个仓库装了入口、会话启动 Hook 真的跑了才会清，没装入口的仓库同样没有自动清理。
这条命令补抹凭据那一格，目录不删——要清掉目录，人工确认后自己删。
`--dry-run` 只预测**侧层**（运行目录那一层没有哨兵、每轮都复查）。退出码恒 `0`：
它是随手可跑的运维命令，判成败读输出而不是退出码。分档含义见 RUNBOOK「跨仓清扫」一节。

---

## 五、配置项逐条说明

文件是 `.trivium/config.yaml`（进 Git，团队共享）。本机结论在 `config.local.yaml`（不进 Git）。

优先级：**内置默认 → `config.yaml` → `config.local.yaml` → 命令行**。

配置不合法会退 69 并逐条列出问题（未知字段、枚举值拼错、区间越界），**不会静默 fail-open**。

### 5.1 主题与运行时

| 字段 | 默认 | 说明 |
| :--- | :--- | :--- |
| `topic.max_len` | 64 | 主题名长度上限 |
| `topic.forbid_chars` | `/ \ .. 空格` | 主题名要做文件名，禁路径分隔符 |
| `runtime.node` | `null` | 派生 worker 用的 node；null 取当前进程 |
| `runtime.run_root` | `~/.trivium/runs` | **原始输出落在项目外**，这是背靠背隔离的第二道 |
| `retention.run_dir_days` | 30 | 运行目录保留期，会话开始时清理。**凭据副本不等这 30 天**：codex / zcode 为模型覆盖与隔离拷进运行目录的配置副本在该侧跑完即抹除，会话开始时对未到期的终态目录再兜底一次；此项设 0 只关整删、不关抹除 |

主题名不能以 `-r<数字>` / `-revised` / `-response` / `-verify` 结尾——否则无法区分「主题 X 的第 2 轮」与「主题 X-r2 的首轮」。

### 5.2 隔离

| 字段 | 默认 | 说明 |
| :--- | :--- | :--- |
| `isolation.peer_artifact_globs` | `**/*-gemini.md`, `**/*-glm.md` | 对方产出的识别模式，用于生成禁读清单。**只是追加项**：禁读清单取「注册表派生的全部已登记角色 ∪ 这里配的模式」，四家（含 codex / claude）不写也会进清单；缺省值只列两家是历史遗留，不影响判定（v1.0.3 注明） |
| `isolation.deny_via_cli` | `auto` | 是否用 CLI 的路径级 deny。**两侧实测均不支持，实际恒为降级** |
| `isolation.context_max_docs` | 12 | 必读清单的文件数上限 |

### 5.3 审查

| 字段 | 默认 | 什么时候改 |
| :--- | :--- | :--- |
| `review.timeout_s` | plan 900 / code 1200 / bug 1200 | 仓库大、补丁大时调大。**改大会连带改变 `max_waits`** |
| `review.wait_timeout_s` | **180** | 每次等待窗口，**同时是你能收到进度的最小间隔**。调小反馈更密，代价是往返变多 |
| `review.heartbeat_stale_s` | 120 | 超过这个时间没心跳判 worker 失联。工作进程每 30 秒写一次心跳，配成不大于 30 秒时，健康的工作进程也会被判失联——预检与 `review --start` 会出一条只警告项「失联阈值」（v1.0.15 起，设计 v1.3.57，EV-160），不拦截；有意为之（如构造失联的测试）可忽略 |
| `review.failure_policy` | `strict` | 一侧失败即中止。改 `degrade` 则继续出单审 |
| `review.allow_partial_flag` | `true` | 是否允许命令行 `--allow-single`。设 `false` 则命令行也开不回来。**旧名 `allow_single_flag` 仍可用**（加载时自动迁移） |
| `review.default_critics` | `[gemini, glm]` | 不给 `--critics` 时的默认审核者集合。**已接线**：它就是缺省跑哪几侧的来源 |
| `review.max_critics` | `3` | 单次运行可选审核者的基数上限 |
| `review.parallel` | `true` | 两侧并行。改 `false` 只会更慢，无收益 |
| `review.retry.transient_max` | 1 | 瞬时失败重试次数（429、连接重置、解析失败等）。超时**不重试**——大概率再超时 |
| `review.min_tool_calls` | 每阶段 5 | 证据下限：该侧至少要有这么多次读/搜工具调用 |
| `review.min_project_reads` | 每阶段 3 | 至少读到这么多个**项目文件**（排除被审对象、任务书、归档内文件、项目外文件） |
| `review.cache` | `false` | — |

**证据下限不是可选项**：Antigravity 的软拒绝会产生「exit 0 但零工具调用」的空审查，这两个下限是唯一能识别它的机制。达不到下限的一侧会被标「证据不足：本侧不得计为合格双审的一半」。

#### 漂移

| 字段 | 默认 | 管什么 |
| :--- | :--- | :--- |
| `review.on_drift_related` | `fail` | 审查期间被改的文件**落在 `--context` 或 diff 涉及范围内** |
| `review.on_drift` | `warn` | 审查期间**别处**文件被改 |
| （不可配） | 恒 `fail` | 被审对象本身的哈希变了 → 整次运行作废 |

默认组合的语义：动了被审范围内的东西 → 这次结论作废；动了不相干的东西 → 只告警。

#### 敏感文件与跳过

| 字段 | 默认 | 说明 |
| :--- | :--- | :--- |
| `review.sensitive_globs` | `.env*`, `**/.env*`, `**/*.pem`, `**/*.key`, `**/id_rsa*` | 三处生效：进禁读清单、**从补丁里剔除**、主题参数解析时剔除 |
| `review.skip_doc_only_review` | `false` | 改 `true` 则纯文档变更跳过 code 审 |
| `review.skip_globs` | `**/*.md`, `docs/**`, `**/*.txt` | 算「纯文档」的模式 |
| `review.never_skip_globs` | `package.json`, `Dockerfile`, `.github/**`, `.claude/**`, `.trivium/**` 等 | 这些即便是配置文件也绝不跳过 |

> `.env*` 的 glob 不跨 `/`，所以只匹配根目录——子目录里的 `config/.env.production` 要靠 `**/.env*` 那条。两条都要留。

### 5.4 审查员与档位

| 字段 | 默认 | 说明 |
| :--- | :--- | :--- |
| `agents.gemini.agent` | `trivium-critic` | 只读 Agent 定义名。**工具白名单不含任何写工具** |
| `agents.gemini.effort` | plan high / code high / bug high | 思考档位。**模型 slug 自带档位时不传**，否则 agy 会直接拒绝 |
| `agents.gemini.readonly_commands` | `git log`, `ls`, `cat`, `grep` 等 | 允许的只读命令 |
| `agents.glm.max_turns` | 40 | ZCode 的最大轮数 |
| `agents.glm.unsupported_override` | `reject` | 模型覆盖落到全局档时拒绝还是标注 |
| `active_profile` | `default` | 当前档位 |

> **字段名自 `config.v2` 起由 `critics.*` 改为 `agents.*`**（旧名仍能跑：加载时自动在内存里迁移，
> 磁盘文件不动）。`agents` 的键是 Agent id；只有**已定义配置形状**的 Agent 能配，
> 四家现在都有（codex 随 M8、claude 随 M9；v1.0.3 起改准，此前写「当前是 gemini 与 glm」）。

两个内置档位。两档的 Gemini 侧相同，差异只在 GLM 侧用不用 Flash：

| 档位 | 三个阶段的 Gemini 侧 | 三个阶段的 GLM 侧 | 用途 |
| :--- | :--- | :--- | :--- |
| `default` | `gemini-3.8-flash-high` | `GLM-5.3` | 日常 |
| `flash` | `gemini-3.8-flash-high` | `GLM-5.3-Flash` | 省时省配额 |

单次切换用 `--profile <名称>`；只换某一侧的模型用 `--model-<审核者 id>`（优先级更高），
旗标名随注册表派生，四家皆可，但只对本轮入选的审核者有效（见 §4.7）。

**旗标名按 Agent 注册表派生**，启用第三家时 `--model-<新 id>` 自动可用，不需要改解析器。
给**本轮没有入选**的 Agent 指定模型会**退 64**——不是静默忽略。分两种：当不了审核者的
（如 Driver 自身）报错列出当前可用值；能当、但这一轮没选它的（`--critics gemini --model-glm X`，
或非 claude 当 Driver 时、没写 `--critics` 的命令 A 里的 `--model-claude`——那时只跑缺省集合，已减去当轮 Driver）报错列出本轮入选，
并提示用 `--critics` 把它加进来。这条报错是刻意的：此前那类写法会被当成正文吞进审查焦点，
模型覆盖无声丢失，而留痕里看不出你曾经指定过。

### 5.5 闸门

| 字段 | 默认 | 说明 |
| :--- | :--- | :--- |
| `gate.require_adjudication` | `true` | 是否强制逐条裁决 |
| `gate.allow_defer` | `true` | 是否允许「暂缓」这第三态 |
| `gate.block_business_write_when_awaiting_approval` | `true` | 闸门期锁业务写入。**关掉它只关业务文件锁，留痕的锚仍然任何时候都护着** |
| `gate.approval_lock_scope` | `session` | 写锁作用域。`session` 时只有**明确记录了别的会话**才不加锁 |
| `gate.approval_lock_ttl_h` | 24 | 写锁过期时间；也是死 running 闸门的回收阈值 |
| `gate.block_commit` | `true` | 裁决未齐时拦 `git commit` |
| `gate.stop_hook_max_blocks` | 2 | 拦几次收工后放行（防死循环）。配 0 会被 schema 拒绝 |
| `gate.max_check_retries` | 3 | — |
| `gate.reason_policy` | `warn` | 理由空洞时告警还是硬失败 |
| `gate.joint_blocker_policy` | `warn` | 双方共同 blocker 被驳回时告警还是硬失败 |

### 5.6 其他

| 字段 | 默认 | 说明 |
| :--- | :--- | :--- |
| `preflight.auth_cache_ttl_h` | 1 | 认证探活缓存 |
| `probe_ttl_days` | **7** | 探针保质期。**过期即预检硬失败，不是降级** |
| `verify.build` / `verify.test` | `[]` | 必须手工配 |

---

## 六、读懂产出

```
.reviews/<主题>/
├── task.json                                主题级元数据：各轮指针、闸门、审批、争议
├── plan/  code/  bug/  verify/
│   ├── <日期>-<主题>-claude.md               ← 你/Driver 写的原稿（后缀 = 当轮 Driver）
│   ├── <日期>-<主题>-gemini.md               ← Antigravity 的审查
│   ├── <日期>-<主题>-glm.md                  ← ZCode 的审查
│   ├── <日期>-<主题>-codex.md                ← Codex 的审查
│   ├── <日期>-<主题>-revised-claude.md       ← 修订件（plan/bug，含逐条裁决）
│   ├── <日期>-<主题>-response-claude.md      ← 应答件（code）
│   └── _meta/                                 审计材料
```

重跑会自动抬 `-r<N>`：`<日期>-<主题>-r2-gemini.md`。**既有工件一律不覆盖**，用的是 `O_CREAT|O_EXCL` 原子创建。

### 6.1 `_meta/` 里有什么

| 文件 | 是什么 |
| :--- | :--- |
| `brief-<侧>-<run_id>.md` | 送给该侧的任务书（含禁读清单），两侧不同 |
| `changes-<run_id>.diff` | code 阶段冻结的被审补丁 |
| `changes.diff` | 上者的人读便利副本 |
| `review-<侧>-<run_id>.json` | **结构化结论。`gate --check` 的唯一事实来源** |
| `review-<侧>-<run_id>.failed.json` | 该侧失败/超时的记录（绝不改名冒充对方） |
| `review-<侧>-<run_id>.fallback-items.md` | 解析降级时的编号化待裁决单元 |
| `run-<run_id>.json` | 运行元数据：快照、漂移、生效模型、工具轨迹、留痕保护集 |

**`_meta/` 和 `task.json` 是编排器独占的，任何时候都不许你改**——它们是留痕的锚，改了就能整枝绕过核验。

### 6.2 怎么读一份审查结论

先看文档头部的旗标：

| 旗标 | 含义 |
| :--- | :--- |
| `degraded: true` | 这不是双审，只有一侧 |
| `parse_fallback: true` | 该侧输出不合 schema，**不参与阻断判定**，但仍须逐条裁决 |
| `evidence_ok: false` | **证据不足：本侧不得计为合格双审的一半** |
| `drift: true` | 审查期间工作树变动过 |

然后看 `verdict`：`approve` / `approve-with-nits` / `request-changes` / `block`。

每条意见有九个字段，其中 `evidence`（证据）和 `confidence`（置信度）最值得看——`confidence: low` 的意见不必当真，但也不该静默忽略。

### 6.3 怎么写好裁决

裁决表是一张 Markdown 表，六列：`id / source / severity / disposal / reason / action`。

三种裁决，**每种都必须有非空理由**：

| 裁决 | 还必须写 | 校验 |
| :--- | :--- | :--- |
| **接受** | `action` 落点（改哪个文件、怎么改） | 空了报 `missing_action` |
| **驳回** | 理由 | 空洞理由（「无需修改」「不适用」「已知悉」）报 `weak_reason` |
| **暂缓** | 理由 + 触发条件 | `allow_defer: false` 时直接不允许 |

解析器对写法很宽容：全角半角、`**AGY-01**` 的加粗、`` `AGY-01` `` 的反引号、列名同义词都能认。但对语义很严格：少一条、编号不存在、理由为空，一律退 2 并**点名缺口**。

**不要静默忽略任何一条**。闸门会逐条比对期望编号与表中编号的双向差集。

### 6.4 看复盘

```bash
.trivium/bin/trivium report --topic <主题>
```

给出时间线、每轮意见数与严重度分布、采纳率、被驳回项与理由、生效模型核对、降级与告警清单、双审退化指标、耗时汇总。

时间线按审查文档数轮次。没产出审查文档的运行——被取消、worker 异常或失联、入选侧全部失败、纯文档跳过、没走到收尾的旧留痕——
不占轮次号，列在时间线下方的「未进时间线的运行」表里，头部「轮次总数」后会注明「另有 K 次」（v1.0.6 起，EV-144）。
所以「轮次总数：0」不等于这个阶段没跑过；同一轮次号也可能在上下两张表里各出现一次（失败那次与随后的重跑）。

> **⚠️ 已知缺口**：报告里的「争议项」只会显示一个布尔标记，**永远打印不出具体编号**——`disputes[]` 数组在代码里没有任何写入点。

---

## 七、日常场景

### 场景 1 · 只审一份计划

```
（1）让 Claude Code 写方案，存到 .reviews/<主题>/plan/<日期>-<主题>-claude.md
（2）/dual-review-plan 重点看并发安全与回滚路径 --topic 登录重构
（3）等 10~40 分钟，期间每 3 分钟收到一行进度
（4）读两份审查文档全文
（5）Driver 写 -revised-claude.md 逐条裁决
（6）闸门校验通过 → 停在人工审批
（7）/dual-approve --topic 登录重构 --stage plan
```

### 场景 2 · 审一段代码改动

同上，命令换成 `/dual-review-code`，被审对象自动取 `git diff HEAD`。想比较别的基线用 `--base <ref>`。

**改动必须已经在工作树里**——没有变更时退 65。

### 场景 3 · 走完整流程

```
/dual-run 实现登录重试与退避 --topic 登录重构
```

跑完整条链，中途不停，最后真实执行 `verify.build` / `verify.test`。前提是这两组至少一组非空。

### 场景 4 · 审查跑到一半想停

```bash
.trivium/bin/trivium review --cancel <run_id>
```

按进程组终止 worker（SIGTERM，5 秒后仍在则 SIGKILL），回收锁与闸门。worker 收到 SIGTERM 时会先结束它拉起的审查员 CLI
（agy / zcode / codex / claude 各在独立的进程组里，按 worker 的组发信号够不到它们）：先发 SIGTERM，2 秒后仍在则 SIGKILL，
确认之后 worker 自己再退出（v1.0.10 起，设计 v1.3.52，EV-152）。真实 CLI 对 SIGTERM 的反应没有实测过，不响应时靠那次 SIGKILL 结束。

> **worker 自己结束不了 CLI 的两种情形**（v1.0.11 起，设计 v1.3.53，EV-154）：worker 5 秒内没退出被强杀（stderr「未响应 SIGTERM，发送 SIGKILL」），
> 或 worker 在本次取消之前已被强杀、崩溃。这两种情形下 `--cancel` 会按 worker 当时记在 `status.json` 里的 CLI 进程组，逐组结束它们，
> stderr 每组一行「按记录结束审查员 CLI：〈侧〉侧进程组 N（信号序列）」。**`--wait` 报「工作进程失联」之后也可以再跑一次 `--cancel`**：
> 失联原因是工作进程已不在（`pid_gone`）时，它会说「已处于终态，无需取消」，但仍会按记录结束遗留的 CLI（不改运行的状态与归档）；
> 失联原因是心跳过期而工作进程还活着（`heartbeat_stale`）时，见下文「`--wait` 报「工作进程失联」或 worker 异常时」那一段。
> 记录对得上（组长还活着、启动时刻相符）才发信号；v1.0.18 起（设计 v1.3.60，EV-165）组长已经退出、但组号下还有非僵尸成员时**同样发信号**——
> 组号仍然有效，组员是原组的后代（不是新进程凑巧撞上同一个号）。下面几种 stderr 提示意味着仍要你手工核对——用 `ps` 找 ppid 为 1 的
> `agy` / `zcode-cli` / `codex` / `claude` 进程：「启动时刻没记下，判不了」「CLI 记录读不懂」「组长已退出，组里还有 N 个成员」「组长已退出，
> 组里的非僵尸成员数取不到，判不了是否还有遗留」（v1.0.18 起，EV-165）「未能确认退出」「没有在跑的审查员 CLI 记录」
> （CLI 已先结束，或 worker 派生后没来得及记下）。另有两种较窄的形态**不会打提示**：
> CLI 进程本身先于 worker 退出、它名下遗留的子进程；CLI 自己脱离进程组的后代。所以取消之后想确信没有残留，最稳的办法仍是用 `ps` 查一遍。
> 会话启动清扫与 `trivium scrub` 在记录里的 CLI 还活着时不会抹那一轮的凭据副本，单列一行「因审查员 CLI 进程组记录未动」并带出成因，等 CLI 结束后的下一次清扫再抹。
> 「CLI 记录读不懂」（手改坏了，或新旧版本混跑写出了旧版读不懂的形状）**不会自愈**：告警里带着 status.json 的路径与读到的原始值，
> 核对进程确已不在后，把该侧的 `cli` 改回 `null` 即可放行；不处理的话，它会一直不抹，v1.0.16 起（设计 v1.3.58，EV-157）`run_dir_days` 到期也不删那个运行目录——
> 出口只有改回 `null`。v1.0.17 起（设计 v1.3.59，EV-164）`trivium scrub` 的提示与帮助也这么写：第四格之后那一行是「需把该侧 cli 改回 null（到期整删也会保留它）」，
> 帮助里「副本会一直躺到 retention.run_dir_days 整删」带上了同样的限定（v1.0.19 起那句主句改写为「到期整删也只在它的会话启动时跑…不再回到那个仓库就没有任何自动清理」，EV-166）；v1.0.16 那一版提示里的「或等 run_dir_days 整删」是走不通的出口。
> **`--cancel` 与 `--wait` 报失联时抹凭据副本，也先看这份记录**（v1.0.16 起，设计 v1.3.58，EV-157；v1.0.18 起「组长已退出、组员仍在」
> 同样挡住，EV-165）：工作进程已不在、而记录里的 CLI 还活着、组长已退出但组员仍在、判不了或读不懂时，这两处都不抹副本，多一行
> 「凭据副本未抹：工作进程 N 已不存在，但审查员 CLI 未确认结束——〈逐侧：哪一侧、哪个进程组、为什么〉——留给会话启动清扫」
> （`--wait` 写在报错正文里，句末带失联原因）。`--cancel` 判的是它按记录结束 CLI **之后**的事实，所以记录对得上的 CLI、以及组长已退出
> 但组员仍在的组（按组信号结束）被它结束之后都照常抹；留下的只有判不了、读不懂与未能确认退出的那几组。`--wait` 不结束任何进程，CLI 活着
> 或组员仍在就不抹。这几组的记录会原样留在 `status.json` 里，CLI 结束之后的下一次会话启动清扫（或 `trivium scrub`）再抹；`run_dir_days`
> 到期整删同样先看它，CLI 还在就保留那个运行目录。
> `--wait` 在记录里有「仍在」或「组长已退出、组员仍在」的 CLI 时还会多给一行出口：「其中仍在的审查员 CLI 可用 trivium review --cancel 〈run_id〉 按记录结束……」——
> `--wait` 自己不结束任何进程，而那些 CLI 手上的凭据副本没抹，**不结束它们就会一直用着凭据、烧着配额**；跑一次 `--cancel` 会按记录结束它们（不改运行的状态与归档），
> 之后的会话启动清扫再抹副本。判不了、读不懂的那几组 `--cancel` 也不发信号，仍要你用 `ps` 核对。
> v1.0.10 那一版这里写的是「这两种情形 CLI 够不到、只打提示」；v1.0.9 那一版写的是「一律够不到」。

> 被取消的运行，其 `run-<id>.json` 会标为 `cancelled`（v1.0.5 起，设计 v1.3.47，EV-128；此前停在 `running`）。
> 两种情形不写，输出会说明原因：工作进程没能确认已退出（可能还有写者），或 run.json 已是终态（不追溯改写）。
> 没确认退出的那一份会一直停在 `running`；本版以前被取消的历史留痕也不回填。
> 若输出里有「这一步不会再有第二次机会」的告警（写 run.json 或 task.json 时出错），再跑 `--cancel` 也补不回来，
> 请对照告警自己核对归档里的 `run-<id>.json` 与 `task.json` 的运行登记。
>
> **`--wait` 报「工作进程失联」或 worker 异常时**（v1.0.6 起，设计 v1.3.48，EV-142）：归档里的 `run-<id>.json` 会标为 `failed`，
> 并在 `termination` 里记下是哪一种（worker 异常记退出码、失联记原因）；失联时只在工作进程确认已退出才写——
> 进程还活着、只是心跳过期（`heartbeat_stale`）时不写，报错里会写「工作进程未确认退出」。
> **心跳过期而工作进程还活着**（v1.0.12 起，设计 v1.3.54，EV-146）：`--wait` 的报错先列判定依据——工作进程的 pid、status.json 多久没更新、
> 失联阈值 `heartbeat_stale_s` 与工作进程的心跳间隔（30 秒）；阈值不大于 30 秒时会点明「健康的工作进程也会被判失联」（把阈值调回 120 以上即可避免）。这样配时，预检与 `review --start` 事前就会给一条「失联阈值」警告（v1.0.15 起，设计 v1.3.57，EV-160），与这一句用的是同一个判据。
> 确认它卡死、要结束这一轮，就照报错里的出口再跑 `trivium review --cancel <run_id>`：它会结束那个工作进程与它拉起的审查员 CLI、
> 把归档里的 `run-<id>.json` 与 task.json 的运行登记补收为 `failed`（`termination` 仍记 `worker_lost` / `heartbeat_stale`）、回收主题锁；
> status.json 保持失联判定时的样子，闸门不动，凭据副本留给下次会话启动的清扫。输出按事实分几种：
> 「未响应 SIGTERM……发送 SIGKILL」——它的事件循环被堵住了；「在宽限内响应 SIGTERM 退出……失联判定可能只是心跳慢」——它其实还在推进，这一轮已被你结束；
> 「未能确认退出」——归档与锁都没动，可以再跑一次 `--cancel`；若改为在终端手工结束它，之后再跑一次 `trivium review --cancel <run_id>`
> 会判它已不在，按前提补收归档 `run-<id>.json` 与运行登记（v1.0.14 起，设计 v1.3.56，EV-159）；
> 「启动时刻与 status.json 的规范化记录不符」——PID 已被复用，或这一次取不到它的启动时刻，请用 `ps` 核对；
> 「启动时刻与 status.json 的记录不符……（这份记录没有规范化启动时刻……）」——这一轮是升级到本版之前起跑的，可能是 PID 已被复用，也可能是你这次的终端与跑 `--start` 的终端时区或区域设置不同，
> 后者请回到跑 `--start` 的那个终端环境再跑一次（这两种情形连它名下的审查员 CLI 也不结束）。本版起跑的运行不再受终端时区或区域设置影响（BACKLOG EV-158）；「pid 或启动时刻缺失 / 形状不对」——判不了是不是同一个进程，不对它发信号，请用 `ps` 核对。
> 后两种情形 stdout 会说「未对工作进程……发信号；归档 run.json 与主题锁未动」。另有「未及发信号，工作进程已不在」——它在这次取消动手之前自己退出了，归档照常补收。
> 这条命令在这种情形下可能要等十几秒（宽限 5 秒、强杀后确认、再结束审查员 CLI）。
> 升级到本版之前已被旧版 `--wait` 判为失联、进程还挂着的运行，status.json 里没有新版记下的失联标记，`--cancel` 仍会说「已处于终态」，只能在终端手工结束（BACKLOG EV-159 第二形态，暂缓）。
>
> **`review --start` 或同步 `review` 自己报错时**（v1.0.8 起，设计 v1.3.50，EV-145）：若已写下 `run-<id>.json`，它会标为 `failed`，
> 并在 `termination` 里注明是哪一种——`prepare_exception`（准备阶段失败，审查员一个都没拉起、没花配额）或 `sync_exception`（同步路径异常）；
> 报错下方会多两行说明收尾结果。
>
> **`review --start` 在拉起工作进程之后才报错时**（v1.0.9 起，设计 v1.3.51，EV-150；少见，多半是磁盘或权限问题）：
> 它会先终止那个工作进程、确认它已退出，再同样把 `run-<id>.json` 标为 `failed`（`post_spawn_exception`），
> 锁与闸门一并收好——报错之后没有东西在后台跑，直接排查原因、重跑即可。
> 报错里若写「未能确认退出」，说明那个进程没能被终止：按提示先 `trivium review --cancel <run_id>`（或在终端结束它），再重跑。
> 若写「工作进程在被终止之前已跑完」，审查其实已经完成：按提示用 `--wait` 取结果、照常裁决。

### 场景 5 · 裁决写了但闸门不过

```bash
.trivium/bin/trivium gate --stage plan --topic <主题> --check
```

退出码 2 **不是崩溃，是有话要说**——stdout 里就是待修补的清单，逐条点名了缺口。补完再跑一次。

### 场景 6 · 这个主题不想要了

```
/dual-abandon --topic <主题> --reason 需求取消
```

解除写锁，**全部工件保留**。

### 场景 7 · 重跑一轮

直接再发一次同样的命令。工件不会被覆盖，自动抬 `-r2`。

但**上一轮的裁决必须先补齐**——闸门是 `review_done_awaiting_disposition` 时重跑会被拒绝并提示「上一轮尚未裁决」。
被拒绝的那次不会留下任何文件（v1.0.7 起），补齐裁决后直接跑 `gate --check` 即可，不用 `--run-id`。

---

## 八、五道护栏

前四道由 Claude Code Hook 强制，**不靠模型自觉**——这是 Claude Code 主攻（护栏等级 L1）时的情形。
**别家主攻时**：ZCode 的 Hook 只在五个前提下尽力拦截（桌面端、先信任再开会话、主代理、写工具在覆盖内、不超时），Codex 与 Antigravity 没有 Hook，
下表前四道都要靠你和 Driver 自觉；事后机制只能发现审查进行中的越界，**闸门期改业务文件不拦、也不会让审批失败**；v1.0.4（设计 v1.3.46）起，停点与 `approve` 会打印自审查收尾以来的工作树改动摘要，只告知（BACKLOG EV-132 候选 ② 折中版）——审批前看一眼这段摘要，摘要取不到时自己看 `git status`。
细节见 [QUICKSTART §5.2](./QUICKSTART.md) 与 [RUNBOOK 第十节](../06_deployment/RUNBOOK_pipeline_ops.md)。

| 什么时候 | 挡什么 | 怎么过 |
| :--- | :--- | :--- |
| 审查进行中 | 改业务文件 | 等它跑完。审查员在读真实工作树，你改了会造成漂移，可能让整次运行作废 |
| 裁决未齐备 | `git commit`、结束对话 | 补齐裁决，跑 `gate --check` 通过 |
| **任何时候** | 在归档内写审核者后缀的文件（全部已登记角色减当轮 Driver；Claude Code 主攻时即 codex / gemini / glm 三家） | 审查文档只能由编排器渲染落盘。你的产出后缀是当轮 Driver 自己的（本手册的 Claude Code 主攻即 `-claude`） |
| **任何时候** | 用 Bash 碰 `_meta/`、`task.json`、`state.json`、`.trivium/bin`，或任一角色后缀的文件（含你自己的 `-claude.md`） | 这些是留痕的锚，改锚即可整枝绕过核验；Bash 侧拿不到当轮 Driver，角色后缀只能全集字面拦，原稿与裁决件请用 Write / Edit |
| 闸门期 | 用 Bash 旁路改业务文件（`cat >`、`sed -i`、`tee`、`git checkout -- f`） | 同第一、二道 |

被挡住时 Hook 会打印具体主题、阶段和解法。**不要靠改配置绕开**——那会让整条流水线退化成「两个模型随口说了点什么」。

### 8.1 第四道有一种已知误拦

判定在**未剥离 heredoc 的原文**上做，且是纯字面扫描，所以**区分不了「写它」与「说它」**。

一条 Bash 命令只要正文里出现任一角色后缀（`-gemini.md`，也包括你自己的 `-claude.md`）、`_meta`、`task.json`、`state.json`、`.trivium` 这些字样，就会被拦——哪怕它实际要写的是别的文件，**包括 commit message**。

**出口：改用 Write / Edit 工具落文件**（精确判定，不看字面）。提交说明写进文件再 `git commit -F <文件>`，不要用 `-m` 内联。

**确实要恢复一个被误改的受保护文件**（`git checkout --` / `git restore`）时，请在终端里手动执行：恢复命令的参数正是那个受保护路径，在会话里会被同一条判据再拦一次。这条判据是按命令形态的**启发式、并不完备**——换一种写法让它认不出来属于绕过判定，不是出口。

这个代价是刻意接受的。正文里写保护路径恰恰是要防的攻击形态（`python3 - <<'PY' … PY` 里藏一条改 `_meta/` 的写入），正则无法区分「讨论它」与「攻击它」。误拦的后果是你换个工具，漏拦的后果是裁决期归档被篡改且无事后兜底——代价不对称，所以选了误拦。

**没有例外，包括 `git commit`。** 2026-09-12 给它开过一次豁免，双审打穿后撤回：三个前置条件仍漏掉至少五条夹带路径，其中换行、附着重定向、文本提及三条实测能放行。五类形态现在都锁成了测试负例。

### 8.2 第五道不是机械保证的

**人工审批这道关靠的是约定，不是护栏。**

`trivium approve` 是普通 CLI 子命令，**不校验调用来源**，而 review 命令的 `allowed-tools` 预批准了 `Bash(.trivium/bin/trivium:*)`。也就是说 **Driver 自己敲一条命令就能关掉等你审批的闸门**，不需要你确认。

曾经加过一次性确认码，后来移除了——码的明文经 stdout 由 Driver 转述给你，它读得到，构不成边界，只会让人误以为这道关是铁的。**虚假的安全感比没有护栏更糟。**

你的实际保障是**留痕**（那部分有机械边界）与**事后对账**：每次审批的时间、阶段、`run_id` 与会话来源都写在 `task.json` 的 `approvals[]` 里。

**批准前的那道复核保什么、不保什么**（M10a 第 3 步起）：`approve` 在批准前会对该阶段本轮无条件复核——裁决是否齐备、本轮登记的审查工件是否被删改（sha256）；不通过退 2，不给批。它**只保这两件事**：只核本轮（更早的轮次由提交时的留痕核对管）；不查有没有人往阶段目录塞进一份没登记过的伪审查件（那要 `gate --check-artifacts` 才查得到）；**更不保审批来自你**。所以上面那句「Driver 自己敲一条命令就能关掉闸门」在复核之后**依然成立**：复核挡住的是「裁决不齐或工件被改时批准」，挡不住「裁决齐了、由 Driver 自己批准」。

真正的机械边界需要宿主提供不经过模型的带外通道（TTY / 审批 UI），本项目没有。

---

## 九、出问题时

### 9.1 退出码

| 码 | 含义 | 是不是故障 |
| :--- | :--- | :--- |
| `0` | 成功 | 否 |
| `1` | 一般失败 | 是，看 stderr |
| `2` | 闸门阻断 | **否**，护栏按预期工作。stdout 里是待修补清单 |
| `64` | 参数错误 | 是，改命令。**不会产生任何工件** |
| `65` | 前置产物缺失 | 是，先补工件 |
| `69` | 环境或预检失败 | 是，跑 `doctor` / `preflight` |
| `70` | 主题被锁 | 是，同主题已有运行 |
| `73` | 运行仍在进行 | **否**，不是超时，是还没跑完 |
| `75` | 严格模式中止 | 是，一侧失败且 `failure_policy: strict` |

`2` 和 `73` 最容易被误处理：**`2` 不是崩溃而是有话要说，`73` 不是超时而是还没跑完。**

### 9.2 常见症状

| 症状 | 先看这个 |
| :--- | :--- |
| 命令没反应 / 提示未初始化 | `.trivium/config.yaml` 在不在？Hook 检测不到它一律放行 |
| 预检报探针过期 | 探针 7 天 TTL 且**过期即硬失败**。在终端里跑 `trivium doctor` 重新校准 |
| 某侧报不可用 | `trivium preflight --stage plan`，它会指出是探针过期、CLI 不可调用还是未认证 |
| 某侧被判「证据不足」 | 该侧读的项目文件数或工具调用数没达下限。看 `_meta/run-*.json` 的 `tool_calls` |
| 一侧超时 | 默认 strict 会中止。调大 `review.timeout_s`，或临时 `--allow-single` 降级 |
| 主题被锁但没有运行在跑 | 遗留锁会自动回收（四条判据取任一）。真卡住用 `review --cancel <run_id>` |
| 每次工具调用都报 hook 错误 | wrapper 里写死的 node 路径失效了（`brew upgrade node` 之后）。重跑 `init` |
| Bash 命令莫名被拦 | 命令正文里有 `.trivium` / `_meta` / `task.json` 之类的字样？见 §8.1 |

深度故障（锁、闸门、跑挂、留痕）按退出码查 [RUNBOOK_pipeline_ops.md](../06_deployment/RUNBOOK_pipeline_ops.md)。

---

## 十、已知限制与取舍

如实列出，**这些不是 bug，是知道且接受的边界**。

| 限制 | 具体是什么 | 现状 |
| :--- | :--- | :--- |
| **平台** | 只验证过 macOS。Linux / Windows 未验证 | 本期不作为目标平台 |
| **探针 7 天 TTL** | 过期即预检**硬失败**，且无临近预警。每个项目各存一份、各自计时——N 个项目就是 N 条要单独重烧配额的时间线 | 探针本是**本机级**结论，按项目存是实现现状。改成全局缓存属设计变更 |
| **路径级 deny 不可用** | 两侧实测均不支持。ZCode 的 `--disallowed-tools "Read(<路径>)"` 语法被接受，但模型改用 `Bash(head -1)` 读到了目标文件 | 隔离是**降级运行**——只靠禁读清单 + 事后轨迹核验（风险 R13） |
| **人工审批无机械边界** | 见 §8.2 | 需宿主提供带外通道 |
| **Bash 拦截有已知误拦** | 见 §8.1 | 刻意接受的取舍 |
| **配置与协议片段不会自动升级** | 见 §3.6 | 需手工同步 |
| ~~**`block_severities` 是死配置**~~ | 已于 2026-09-16 删除 | 该键不再存在；若你的配置文件里还留着它，删掉那三行（保留会被 schema 判为未知键） |
| **报告的「争议项」无法显示编号** | `disputes[]` 无写入点 | 只有布尔标记生效 |
| **`doctor` 必须在终端跑** | 2~4 分钟，会击穿 Bash 工具 600s 超时 | 预检刻意不自动拉起它 |

---

## 十一、往下读

- [QUICKSTART.md](./QUICKSTART.md)：15 分钟速通
- [RUNBOOK_pipeline_ops.md](../06_deployment/RUNBOOK_pipeline_ops.md)：按退出码倒查故障
- [.reviews/README.md](../../.reviews/README.md)：留痕目录与命名规范
- [PROTOCOL_dual_critic_relay.md](../03_api/PROTOCOL_dual_critic_relay.md)：Schema 与协议契约
- [LLD_orchestrator.md](../02_design/LLD_orchestrator.md)：编排器实现说明（想改代码时读）
- [REPORT_2026-09-11_m0_probe.md](../05_testing/REPORT_2026-09-11_m0_probe.md)：两家 CLI 的实测坑清单
