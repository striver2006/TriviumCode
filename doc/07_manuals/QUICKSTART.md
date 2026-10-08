# 快速上手：Driver-DualCritic 双审流水线

> 目标：**15 分钟内**装好并跑通一条真实任务。
> 依据 [设计](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md) 与 [PRD](../01_requirements/PRD_driver_dual_critic.md)（两者的当前版本见其文档头）。
>
> **本文描述的是当前可用的系统**：缺省由 Claude Code 主攻 + 缺省三侧审查（Antigravity / ZCode / Codex，2026-09-16 起默认即三侧）。
> 第四家（Claude Code 作审核者）已随 M9 接入，入选须由另一家当 Driver。
> **换一家 Agent 在自己的会话里主攻已可用（M10b，2026-09-26）**：ZCode、Codex 也能当 Driver，但**护栏强度不同**——先读 [§5.2](#52-换一家-agent-主攻护栏等级-l1--l2)。思考等级三档（M11）还不能用。
> **`--critics <id,…>` 已可用**——从已启用的几家里选跑哪几侧（选一侧不算降级）。
> 本文正文以 Claude Code 主攻为例；Codex 侧的 provider 配置由 `doctor` 探测并给可粘贴样例（设计 16.2 纪律 5），不代写你的全局配置。

这条流水线让 Claude Code 主攻写代码，**Google Antigravity** 与**智谱 ZCode** 两个
独立审查员背靠背复审，结论逐条落盘留痕。你的角色是 Driver 的使用者——按 `/dual-*`
命令走，编排器负责并行、超时、隔离、防覆盖与闸门。

---

## 0. 前置条件

| 项 | 要求 | 怎么确认 |
| :--- | :--- | :--- |
| 操作系统 | **macOS**（一级平台）。Linux / Windows 未验证 | — |
| Node.js | ≥ 18 | `node --version` |
| git | 任意近期版本 | `git --version` |
| Claude Code | 已安装并能用 | — |
| Antigravity CLI | `agy` 可调用且**已登录** | `agy --version` |
| 智谱 ZCode | 桌面应用已安装，CLI 凭据已配置（0.16.9 起编排器还要按路径注入桌面端的 provider 配置，只判文件有无、不读内容） | `ls ~/.zcode/cli/config.json ~/.zcode/v2/provider_config.json` |
| Codex CLI（缺省三侧之一） | `codex` 可调用，provider 已由你自己配好 | `codex --version`；配置怎么写看 `doctor` 给的样例 |

**关于凭据**：两侧的登录由你自己完成（`agy` 的交互登录、ZCode 的 `zcode login` 或
provider 配置）。编排器只读取已有登录态，从不代你写凭据，也不会把凭据写进任何工件——
落盘前有密钥扫描，命中即拒绝落盘（NFR-04）。

---

## 1. 安装（约 2 分钟）

```bash
git clone <本仓库> TriviumCode && cd TriviumCode
npm install
npm run build          # esbuild 打出单文件零依赖产物
node dist/install.cjs  # 装到用户级目录；只装部分家：--targets claude,glm
```

安装器做这些事，全部幂等：

| 装到哪 | 内容 |
| :--- | :--- |
| `~/.claude/skills/dual-critic/` | 核心 skill + 编排器 `scripts/trivium.cjs` + schema / 镜头 / 阶段要点 / 模板 / 协议片段（**每次必装**，不随任何一家） |
| `~/.claude/skills/dual-*/` | Claude Code 的 7 个入口 skill（`/dual-run`、`/dual-review-plan` …） |
| `~/.zcode/skills/dual-*/`、`~/.codex/skills/dual-*/`、`~/.gemini/config/skills/dual-*/` | 另三家当 Driver 时用的入口 skill（本机没装那一家就跳过；用法见 §5.2） |
| `~/.gemini/config/agents/trivium-critic/` | Antigravity 的只读审查 Agent 定义（本机没有 `~/.gemini` 就不装） |

> **跨产品副作用**：本机没装 Claude Code 时，核心 skill 仍会新建在 `~/.claude/skills/dual-critic/`（编排器本体在那里）。
> 日后装上 Claude Code，它会把这个目录当成一个已安装的 skill（其 `SKILL.md` 标了不可调用），安装器会打印这条提示。
>
> **别往 `~/.agents/skills` 里装同名 skill**：Codex 与 ZCode 都会读那里，同名时 Codex 的 `$dual-…` 调用会直接失效且不报错。安装器装前会查重名，撞上就拒装。

> `trivium` **不在 PATH 上**，这是有意的。项目内一律用 `.trivium/bin/trivium`
> （下一步由 `init` 生成，内含 node 绝对路径——GUI 启动的进程不读你的 `~/.zshrc`）。

### 先自检一次

```bash
node ~/.claude/skills/dual-critic/scripts/trivium.cjs doctor --selftest
```

它在临时夹具仓库里**真跑**一遍整条流水线（双审 → 闸门拦截 → 补裁决 → 闸门放行 →
编译测试 → 复盘 → 重跑不覆盖），14 步逐一核对退出码。两侧走桩适配器，**不消耗厂商配额**。

它**证明不了**两家 CLI 可用——那是下一步 `doctor` 的事。输出里会写明这条边界。

---

## 2. 探针实测（约 3 分钟，会消耗少量厂商配额）

```bash
cd <你的项目>
node ~/.claude/skills/dual-critic/scripts/trivium.cjs doctor
```

两家 CLI 的参数与行为随版本漂移，所以实现代码**只读探针结论，不硬编码设计文档列出的
命令行**（设计原则 P7）。`doctor` 逐项实测设计 §3.5 的探针清单，把结论写进 `.trivium/config.local.yaml`
的 `probe:` 段（不进 Git，因为它随机器而异）。

想先不烧配额，可以 `doctor --no-model-calls` 只做静态探测；但模型调用相关的结论
会留空，`preflight` 随后会报环境不可用。

---

## 3. 在项目里启用（约 1 分钟）

```bash
node ~/.claude/skills/dual-critic/scripts/trivium.cjs init
```

生成 / 合并（全部幂等，不覆盖你已有的内容）：

```
.trivium/
├── bin/trivium          # wrapper，项目内统一入口（内含 node 稳定路径）
├── config.yaml          # 团队共享策略，进 Git
└── config.local.yaml    # 探针结论，由上一步 doctor 写入，不进 Git
.claude/settings.json    # 五个 Hook 的注册（随仓库分发）
.zcode/config.json       # 同一组 Hook 的 ZCode 形态（只在 ZCode 主攻时起作用，见 §5.2）
.gitignore               # 追加 .trivium 的本机状态项
CLAUDE.md / AGENTS.md    # 追加协议片段，标记括起，可重复运行
```

### 必须补一步：配置编译测试命令

`init` 会提示 `verify.build` / `verify.test` 留空。编排器**只执行**你显式写进
`.trivium/config.yaml` 的命令，**绝不猜测执行**——`scripts.test` 完全可能耗时极长、
依赖外部服务或有副作用（§14.1）。

```yaml
verify:
  build: ['npm run typecheck', 'npm run build']
  test:  ['npm test']
```

两者皆空时 `/dual-run`（命令 A）会拒绝启动：跑完全流程却无法收口没有意义。

### 确认 Hook 能随仓库走

```bash
git check-ignore -v .claude/settings.json   # 应命中 !.claude/settings.json 这条否定规则
```

### 升级与卸载

```bash
# 升级：重新构建并安装。安装器会裁剪 ~/.claude/skills/dual-*/ 里源码已不存在的旧文件，
# 各项目内重跑 init 刷新 wrapper（旧版 Hook 条目会被替换，不会叠加）
npm run build && node dist/install.cjs
node ~/.claude/skills/dual-critic/scripts/trivium.cjs init

# 卸载：只删用户级的 skill 目录与只读 Agent 定义；项目内的 .trivium/ 与 Hook
# （.claude/settings.json、.zcode/config.json）不动
node dist/install.cjs --uninstall
```

> **早就 `init` 过的项目要手工补两行 `.gitignore`**：新版给两份 Hook 配置的备份加了忽略规则，
> 但 `init` 只在忽略片段从未追加过时才追加，已追加过的项目不会自动补。在 `.gitignore` 的 TriviumCode 段里加上：
>
> ```text
> .claude/settings.json.trivium-backup
> .zcode/config.json.trivium-backup
> ```

> **`init` 不会改写已有 `config.yaml` 的内容**——唯一的例外是**版本迁移**：
> 那份配置若仍是旧的 `trivium.config.v1` 形态，`init` 会把它一次性改写为 `config.v2`
> 并把原文备份到 `config.yaml.trivium-backup`（备份已存在就放弃改写，绝不覆盖）。
> 这一步是**可选优化**：不跑 `init` 也能照常工作，加载时会在内存里自动迁移、磁盘不动。
> 注意 YAML 往返会丢掉原文件里的注释，**原注释完整保留在备份中**。
> `config.local.yaml` 不在改写范围内（它不进 Git，属本机私有）。
> 想拿到新版默认值（例如把等待窗口从 540s 调到 180s 以加密进度反馈），
> 只能手工编辑项目里的 `.trivium/config.yaml`。

### 双审跑起来之后，你会看到什么

启动时先收到一条开场：主题、阶段、两侧模型、本阶段预算、汇报节奏与 `run_id`。
此后每隔一个等待窗口（`review.wait_timeout_s`，默认 180s）收到一行进度，形如

```
plan 审查中 ｜ 已用 5m0s / 预算 15m0s（33%）｜ gemini 已完成 · glm 审查中
```

（数字按**出厂默认**配置：plan 单侧预算 900s、窗口 180s。项目若覆盖了
`review.timeout_s`，分母随之变化。）

两侧状态有变化时会多一句说明。想自己查用 `/dual-status`，想中止用
`.trivium/bin/trivium review --cancel <run_id>`。

反馈间隔就等于那个窗口，调小它就更密——代价是等待往返变多。原因见设计 7.5.1：
主脑只有在工具调用返回的那一刻才能说话。

`brew upgrade node` 之后 wrapper 若失效，`trivium doctor` 会点名「wrapper 写死的 node 已不存在」，重跑 `init` 即可。

---

## 4. 跑通第一条任务（约 5 分钟）

在 Claude Code 里，先做最小的一条——**只审计划**：

```
/dual-review-plan 重点看并发与回滚路径
```

会发生什么：

1. Driver 把方案写成 `.reviews/<主题>/plan/<日期>-<主题>-claude.md`；
2. 编排器冻结送审包（记 `subject_sha256` 与工作树 `tree_hash`），渲染两份 BRIEF；
3. **两侧并行**独立审查，各自只读、背靠背——看不到对方的结论；
4. 各侧结论齐备后**同时**落盘为各自的审查文档（缺省三侧：`…-codex.md`、`…-gemini.md`、`…-glm.md`）；
5. Driver 读两份全文，写 `…-revised-claude.md` **逐条裁决**（接受 / 驳回 / 暂缓 + 理由）；有接受项时同时写新一轮计划 `…-r2-claude.md`，开头逐条引用接受的编号——它是代码阶段送审的计划定稿；
6. `gate --check` 硬校验裁决完整性：少一条、理由空洞、编号不存在、有接受项却没有新一轮计划或它漏引编号，都退 2 并点名缺口。

一次审查的墙钟通常 10～40 分钟（取决于模型与仓库大小；本仓库实测 GLM 侧审一份大补丁要 15～20 分钟）。命令内部用
`--start` / `--wait` 分段协议，所以不会撞上 Claude Code Bash 工具的超时上限。

### 七条命令

| 命令 | 做什么 |
| :--- | :--- |
| `/dual-run <任务目标>` | 全流程：出方案 → 双审 → 修订 → 编码 → 双审 → 应答 → 改码 → 编译测试 |
| `/dual-review-plan <提示语>` | 只审计划 |
| `/dual-review-code <提示语>` | 只审代码变更（被审对象是 `git diff`） |
| `/dual-review-bug <提示语>` | 只审根因分析（**不得**由前两者代替） |
| `/dual-approve` | 通过人工闸门 |
| `/dual-abandon` | 放弃闸门（工件保留） |
| `/dual-status` | 看闸门、运行、降级与争议 |

`<提示语>` 是必填的（FR-20）：它会**逐字**嵌进两侧 BRIEF 的第 2 段。换提示语必定重审。
（这是 Claude Code 主攻时的说法；别家主攻时调用写法与「逐字」的边界见 §5.2。）

**想只跑一侧**（省时间或省配额）：给 B/C/D 或 `/dual-run` 加 `--critics glm`（或 `gemini`）。
`/dual-run` 的计划审与代码审两轮用的是同一组。
留痕里会如实记下本轮只选了这一侧，**不标降级**——那是配置意图，不是出了事。
拼错、选了当轮 Driver、或与旧写法 `--only` 同时给，都会当场退 64 并列出可用值。

---

## 5. 会挡你的四道护栏

它们由 Claude Code Hook 强制，**不靠模型自觉**。这是 Claude Code 主攻（护栏等级 L1）时的情形；换别家主攻时哪几道还在，见 §5.2。

| 什么时候 | 挡什么 | 怎么过 |
| :--- | :--- | :--- |
| 审查进行中 | 改业务文件 | 等审查跑完。审查员正在读真实工作树，你的改动会造成快照漂移，可能让整次运行作废 |
| 审查完成、裁决未齐备 | `git commit`、结束对话 | 补齐裁决件，跑 `gate --stage <阶段> --check` 通过 |
| 任何时候 | 主脑在归档内写审核者后缀的文件（全部已登记角色减当轮 Driver；Claude Code 主攻时即 codex / gemini / glm 三家） | 审查文档只能由编排器渲染落盘（AC-07），你的产出后缀是当轮 Driver 自己的（本文的 Claude Code 主攻即 `-claude`） |
| 闸门期 / 任何时候 | 用 **Bash** 绕过前三道：`cat > f`、`sed -i`、`tee`、`git checkout -- f` | Edit / Write 只是写文件的一条路，这些是旁路。命中编排器独占对象（角色后缀文件、`.trivium/` 的状态与锁、归档内 `_meta/` 与 `task.json`）**任何时候**都挡；其余写命令只在闸门期挡 |

第四道是**启发式**的，不求完备——它挡住顺手的旁路，但不要指望绕过去就没事：
绕过去的改动同样会被跑后复算判成漂移，整次审查可能作废。

被挡住时 Hook 会打印具体主题、阶段与解法。**不要靠改配置绕开**——那会让整条流水线
退化成「两个模型随口说了点什么」。

### 第四道有一种已知的误拦

判定在**未剥离 heredoc 的原文**上做，所以一条 Bash 命令只要正文里出现
`-gemini.md`、`_meta`、`task.json`、`state.json`、`.trivium` 这些字样，就会被当成
指向独占对象——哪怕它实际要写的是别的文件。

**任何把这些名字写进 Bash 命令文本的场合都会撞上**，不限于写文件。

**出口：改用 Write / Edit 工具落文件**，它们是精确判定的，不看字面。
提交说明也一样 —— 写进文件再 `git commit -F <文件>`，不要用 `-m` 内联。

**没有例外，包括 `git commit`。** 2026-09-12 给它开过一次豁免（BACKLOG 的 RV-B1），
双审打穿后撤回了。当时设了三个前置条件，仍有至少五条路能夹带进来，其中三条实测放行：

| 夹带形态 | 会发生什么 |
| :--- | :--- |
| `git commit -m x` 换行 `rm 某文件` | 分段判定不认换行，但 shell 把第二行当独立命令执行 |
| `git commit -m x > 审查文档` | 重定向符不是分段字符，目标文件被截断 |
| `echo 记得 git commit > _meta/某文件` | 根本不是提交命令，只因文本里有「git commit」就获豁免 |

根因是方向错了：原判定是 fail-closed（看见字面就拦，代价是误拦），豁免把它变成
需要穷举危险形态的 fail-open —— 而 shell 的攻击面穷举不完。误拦换个工具就绕开了，
漏拦却会让审查文档在闸门外被悄悄改掉，而且没有任何事后兜底。

这五类形态现在都锁成了测试负例。

这个代价是刻意接受的：正文里写保护路径恰恰是要防的攻击形态
（`python3 - <<'PY' … PY` 里藏一条改 `_meta/` 的写入），正则无法区分「讨论它」与「攻击它」。
漏拦的后果是裁决期归档被篡改且无跑后兜底，误拦的后果是你换个工具——代价不对称，所以选了误拦。

---

## 5.1 有一道关不是机械保证的

上面四道由 Hook 强制。**人工审批这道关不是。**

`trivium approve` 是普通 CLI 子命令，不校验调用来源，而 review 命令的 `allowed-tools`
预批准了 `Bash(.trivium/bin/trivium:*)`。也就是说 **Driver 自己敲一条命令就能关掉等你审批的闸门**，
不需要你确认。CLAUDE.md 里「审批的发起权在用户手里」是提示词约束，不是机械保证。

曾经加过一次性确认码，后来移除了——码的明文经 stdout 由 Driver 转述给你，它读得到，
构不成边界，只会让人误以为这道关是铁的。**虚假的安全感比没有护栏更糟。**

所以你的实际保障是**留痕**（那部分有机械边界）和**事后对账**：每次审批的时间、阶段、
`run_id` 与会话来源都写在 `task.json` 的 `approvals[]` 里，可查。
详见 [RUNBOOK 的信任边界段](../06_deployment/RUNBOOK_pipeline_ops.md)。

---

## 5.2 换一家 Agent 主攻：护栏等级 L1 / L2

四家都能当 Driver（执笔与裁决的那一方）。换谁主攻，就在**那一家自己的会话里**、在项目根目录下发命令；
编排器、归档、闸门都不变，**变的是护栏的强度**。

### 各家的入口与等级

`node dist/install.cjs` 按本机装了哪几家自动装入口；只装部分家用 `--targets`（见 §1）。

| Driver | 入口装在 | 在它的会话里这样调用 | 护栏等级 |
| :--- | :--- | :--- | :--- |
| Claude Code（`claude`） | `~/.claude/skills/dual-*/` | `/dual-review-plan <提示语>` | **L1** |
| ZCode 桌面端（`glm`） | `~/.zcode/skills/dual-*/` | `/dual-review-plan <提示语>` | **L2**，有尽力拦截的 Hook |
| Codex CLI（`codex`） | `~/.codex/skills/dual-*/`（设了 `CODEX_HOME` 则在它下面） | `$dual-review-plan <提示语>` | **L2**，没有 Hook |
| Antigravity（`gemini`） | `~/.gemini/config/skills/dual-*/` | `/dual-review-plan <提示语>` | **L2**，没有 Hook |

其余几条命令同理（`/dual-approve` 在 Codex 里写 `$dual-approve`，闸门停点的提示会按当轮 Driver 给出正确写法）。
Antigravity 目前只以「名义 Driver」验收过（在 Claude Code 会话里用 `--driver gemini` 声明），在它自己的会话里执笔还没真跑过。

预检 `trivium preflight --stage plan --driver <id>` 的「当轮 Driver」一行会打出护栏等级；每次运行的 `run.json` 也记了 `driver_guard_level`。

### L1 与 L2 是什么意思

- **L1**（Claude Code）：Hook **兜得住**写入，§5 的四道护栏全部生效。项目里的 Hook 配置若被删掉，本次按 L2 计，预检会打 ⚠️，重跑 `init` 即可恢复。
- **L2**（ZCode / Codex / Antigravity）：**不保证**事前拦得住。三条规矩要靠你和 Driver 自己守：审查进行中不改业务文件、闸门期不改业务文件、只写 Driver 自己后缀的原稿与裁决件。

守不住时，事后机制**只覆盖一部分**：

| 越界发生在 | 事后能不能发现 |
| :--- | :--- |
| 审查进行中改了业务文件 | **能**。跑后复算比对工作树（新建的文件也算，被 `.gitignore` 忽略的文件看不见）：改到被审内容，整次作废；改到 `--context` 或 diff 涉及的文件，缺省也作废；改了别的文件，缺省记一条告警 |
| 闸门期（等你审批时）改了业务文件 | **不拦，也不会让审批失败**。审批前复核只核裁决和审查工件、不看工作树；但停点和 `approve` 会列出自审查收尾以来改过的文件（只告知），看到不该有的改动由你决定。被 `.gitignore` 忽略的看不见；基线可能被 git 清理（git 缺省只清两周前的，平常提交与 `git gc --auto` 不会清掉当天的；你自己跑 `git gc --prune=now` 会），取不到时会如实报「取不到」，不会假称无改动；每轮要扫两到三次工作树（`--check` 立停点、`--await-approval`、`approve` 各一次），每次最多约 20 秒，特别大的仓库上可能次次报超时 |
| 审批之前删改了本轮的审查工件 | **能**。审批前复核按 sha256 核对本轮登记的工件，不符即拒 |
| 审批之后删改了审查工件（含更早轮次） | **要看是谁来提交**：只有带 Hook 的载体（Claude Code；满足下面五个前提的 ZCode）在会话里 `git commit` 时，提交锚才全量核对并拦下。Codex / Antigravity 没有 Hook，它们主攻的轮次审批之后再删改审查工件，**没有任何机制会发现**（与上一行同属 BACKLOG EV-132 的范围） |
| 命令 A（`/dual-run`）裁决未齐就收工 | Codex / Antigravity **没有机制拦**：命令 A 没有审批这一步，只会在 `trivium status` 里留下一道未关闭的闸门；ZCode 有尽力的 Stop 拦截、不兜底 |

所以 **L2 主攻时，审批前看一眼停点打印的工作树改动摘要**（摘要取不到时自己看 `git status`）；Codex / Antigravity 主攻的轮次，审批之后也要自己核一次，或者改在 Claude Code 会话里提交，让提交锚补上这一道。闸门停点那句提示与上表一致：闸门期改了也不会让审批失败、审批时会列出改动，审批之后看由谁提交。
另外，审批本身在任何等级下都不是机械保证（§5.1）——L2 的 Driver 同样能自写裁决件、自己跑 `approve`。

### ZCode 的 Hook 只在五个前提下生效

`init` 会把同一组 Hook 以 ZCode 的形态写进 `.zcode/config.json`。它要**同时**满足下面五条才会拦：

1. 用**桌面端**会话——命令行模式下工作区 Hook 整体关闭；
2. 工作区**已信任**，而且要**先点信任、再开会话**：信任提示可能在第一个会话开始之后才弹出，那个会话里的开场提示不会跑；改过配置要重新信任；
3. 写入发生在**主代理**里——子代理的工具调用不过工作区 Hook。开场第一句可以直接告诉它「本轮不要使用子代理」；
4. 用的是 Hook 覆盖到的写工具（精确名单；外挂的写工具拦不住）；
5. Hook 没有超时——超时即放行，而且看不见。

任一条不满足，它就退回「没有 Hook」的 L2。四种状态怎么操作：

| 状态 | 做法 | 要知道的 |
| :--- | :--- | :--- |
| 安装 | `init`，或单独 `.trivium/bin/trivium hooks --agent glm` | 装完在 ZCode 桌面端重新信任该工作区；信任前 Hook 不跑 |
| 更新 | 重跑同一条命令 | 配置一变就退回待信任，要重新信任 |
| 停用 | 删掉 `.zcode/config.json` 里 TriviumCode 那一段，或把 `hooks.enabled` 设成 `false` | 信任记录留在 ZCode 自己那里，不影响别的项目 |
| 清理 | 卸载不会动项目里的 `.zcode/config.json`，要手工删（见 RUNBOOK） | 残留的那段在重新信任后会继续生效 |

`.zcode/config.json` 若被 `.gitignore` 忽略，`init` 会提示「只对本机生效、不随仓库分发」。

### Codex 主攻的两点

- **起会话时放开沙箱**：`codex -s danger-full-access -C <项目根>`。`review --start` 要在会话里拉起审核者的 CLI、写 `~/.trivium/runs/`、联网，
  Codex 的缺省沙箱会挡住这些；不放开的话，就要逐次批准它的提权请求。M10b 的验收用的是前一种。
- **一提到就注入**：Codex 会话里一条消息只要**提到** `$dual-review-code` 这类名字，那份 skill 就会整段注入上下文，哪怕你只是在交代别的事。
  想先交代再调用，就分两条消息发，交代的那条里不要写 `$名字`。

### 提示语是模型转抄的

Claude Code 主攻时，`/dual-review-plan` 后面的提示语由 Claude Code 原样替换进命令；另三家不替换，靠 Driver 模型**转抄**，被改写了会静默接受。所以：

- 提示语写平实些，少用引号、`$`、反引号这类特殊字符；
- 开场播报会报主题和焦点，看一眼是不是你写的那句；
- 什么都不写时它应当报错退出，而不是自己编一个。

### 别家主攻时，缺省是两审

缺省审核者集合会**先去掉当轮 Driver**：Codex 主攻时缺省就是 Antigravity + ZCode 两审，ZCode 主攻时是 Codex + Antigravity，以此类推。
想要别的组合，四条命令都可以加 `--critics <id,…>`（不能含当轮 Driver），或者改 `.trivium/config.yaml` 的 `review.default_critics`。

---

## 6. 产出在哪

```
.reviews/<主题>/
├── task.json                      # 主题级元数据：各轮指针、闸门、审批、争议
├── plan/  code/  bug/  verify/
│   ├── <日期>-<主题>-claude.md          # 原稿（plan / bug；后缀 = 当轮 Driver）
│   ├── <日期>-<主题>-gemini.md          # Antigravity 审查
│   ├── <日期>-<主题>-glm.md             # ZCode 审查
│   ├── <日期>-<主题>-codex.md           # Codex 审查
│   ├── <日期>-<主题>-revised-claude.md  # 修订件（含逐条裁决；code 阶段是 -response-<Driver>.md）
│   └── _meta/                            # 送审包、结构化结论、运行元数据、code 阶段的补丁
```

**只追加不覆盖**：既有工件一律不覆盖，重跑自动抬升 `-r<N>`（FR-25）。
详见 [`.reviews/README.md`](../../.reviews/README.md)。

看复盘：

```bash
.trivium/bin/trivium report --topic <主题>
```

给出时间线、每轮意见数与严重度分布、采纳率、被驳回项与理由、生效模型核对、
降级与告警清单、双审退化指标、耗时汇总。

---

## 7. 出问题时

| 现象 | 先看这个 |
| :--- | :--- |
| 命令没反应 / 提示未初始化 | `.trivium/config.yaml` 在不在？Hook wrapper 检测不到它一律放行（不会误伤其它仓库） |
| 某侧报不可用 | `trivium preflight --stage plan`，它会指出是探针过期、CLI 不可调用还是未认证 |
| 某侧审查被判「证据不足」 | 该侧读的项目文件数或工具调用数没达下限。看 `_meta/run-*.json` 的 `tool_calls` |
| 一侧超时 | 默认 strict 策略会中止整次运行。可调 `.trivium/config.yaml` 的 `review.timeout_s`，或临时用 `--allow-single` 降级（会被标记为降级，不是双审） |
| 跑起来之后卡住（锁、闸门、跑挂、留痕） | [`RUNBOOK_pipeline_ops.md`](../06_deployment/RUNBOOK_pipeline_ops.md) 按出口码查 |
| 装完想确认一切正常 | `doctor --selftest`；加 `--keep-fixture` 保留夹具，去掉 `TRIVIUM_STUB_CRITIC` 在其中重跑可检验两侧真实审查 |

退出码约定：`0` 成功 ｜ `1` 一般失败 ｜ `2` 闸门阻断 ｜ `64` 参数错误 ｜
`65` 前置产物缺失 ｜ `69` 环境或预检失败 ｜ `70` 主题被锁 ｜ `73` 运行仍在进行（**不是失败**）｜
`75` 严格模式中止。

---

## 8. 往下读

- [`.reviews/README.md`](../../.reviews/README.md)：留痕目录与命名规范
- [`doc/03_api/PROTOCOL_dual_critic_relay.md`](../03_api/PROTOCOL_dual_critic_relay.md)：工件中继与协议契约
- [`doc/04_development/GUIDE_env_setup.md`](../04_development/GUIDE_env_setup.md)：本地开发与调试
- [`doc/06_deployment/RUNBOOK_pipeline_ops.md`](../06_deployment/RUNBOOK_pipeline_ops.md)：运行期故障处置（锁、闸门、跑挂、留痕）
- [设计文档](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md)：唯一实现依据
- [本机坑清单](../04_development/GUIDE_local_pitfalls.md)：各家 CLI 与本机环境的实测坑（`P-xx`）
- [M0 探针报告](../05_testing/REPORT_2026-09-11_m0_probe.md)：M0 当时的实测快照，含 12 条与文档记载不符之处
