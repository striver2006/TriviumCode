<div align="center">

# TriviumCode (三方智鉴)

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20VS%20Code-brightgreen.svg)](#-快速开始)
[![Workflow](https://img.shields.io/badge/Architecture-Driver--DualCritic-orange.svg)](#-核心架构与流转时序)
[![Agents](https://img.shields.io/badge/Agents-Claude%20Code%20%7C%20Antigravity%20%7C%20ZCode%20%7C%20Codex-purple.svg)](#-核心特性与创新)
[![Status](https://img.shields.io/badge/Status-M0～M10b%20已实现-brightgreen.svg)](./doc/02_design/README.md)
[![Roadmap](https://img.shields.io/badge/Roadmap-M11%20档位与文档收口中-blue.svg)](./doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md)

**面向 macOS + VS Code 原生开发流的「主攻 + 双审」（Driver-DualCritic）全自动多智能体协同流水线**

[快速开始](#-快速开始) • [15 分钟上手](./doc/07_manuals/QUICKSTART.md) • [四条命令](#-四条命令) • [核心架构](#-核心架构与流转时序) • [全流程留痕](#-全流程审计与留痕机制) • [文档中心](./doc/README.md) • [贡献指南](./CONTRIBUTING.md)

</div>

---

## 📖 项目概况

随着 AI 编程工具由单次代码生成迈入**自主智能体（Agent）**时代，单一模型在处理大型代码库、复杂系统重构与长调用链路排错时，不可避免地会遇到**单模型视野盲区、上下文退化、隐蔽逻辑幻觉以及安全死角**。

**TriviumCode**（源自拉丁语 *Trivium*，意为文法、逻辑与修辞三艺交汇的智慧三岔口）专为 **macOS + VS Code** 原生开发环境打造，首创 **「主攻 + 双审」（Driver-DualCritic）** 的全自动多智能体协作范式：

- 以 **Claude Code** 为主控研发核心（**Driver**），负责端到端的需求理解、方案拟定、代码编写与缺陷修复，且是**唯一有权改动业务代码**的智能体；
- 引入 **Google Antigravity** 与 **智谱 ZCode** 组成异构专家评审团（**Dual-Critic**），以**背靠背互不可见**的独立视角交叉审查技术方案、代码变更与 Bug 根因定位，全程**只读**；
- 形成「主脑起草 → 专家并发盲审 → 主脑逐条裁决 → 收敛确认」的闭环自愈开发流水线。

> **演进方向（进行中）**：项目正在把这套流水线从「固定 Driver + 固定双审」泛化为
> 「**任意注册 Agent 可为 Driver + 每次审核动态选 1～3 个审核者 + 逐审核者指定模型与思考等级**」
> （多审 / MultiCritic）。**已合入 M7a（Agent 注册表重构）、M7b 六步、M8（Codex 接入）与 M9（Claude Code 审核者）**：
> `--critics` 已可用，四家 Agent 均已启用为审核者；Antigravity、ZCode、Codex 三家
> 同为**缺省入选集合**（不写 `--critics` 时默认跑这几侧，2026-09-16 决策 D4-4）；
> **第四家（Claude Code 作审核者）已随 M9 接入**（2026-09-20 真实审查一次通过 `consulted` 交叉核对），
> 入选须由另一家当 Driver。**M10a（Driver 护栏与契约面）与 M10b（入口资产与真载体验收，2026-09-26）已合入**：四家都能在自己的会话里当 Driver——
> ZCode（护栏 L2，有尽力拦截的 Hook）与 Codex（L2，没有 Hook）已在各自载体里真实验收，Antigravity 只以名义 Driver 验收过；
> 护栏强度因载体而异，换谁主攻之前先读 [QUICKSTART §5.2](./doc/07_manuals/QUICKSTART.md)。
> **M11（档位全链路与文档收口）进行中**：逐审核者选「低 / 中 / 高」档（`--tier-<审核者>`）、精确指定思考等级与 Codex 厂商 profile 已可用，
> 档位名与来源、思考等级的请求值与回读到的生效值都记入运行留痕，复盘按 Driver 与审核者两个维度分开统计；
> 用法见 [QUICKSTART §4「按档位选模型与思考深度」](./doc/07_manuals/QUICKSTART.md#按档位选模型与思考深度)。档位的真实验收与全量手工剧本随 M11 收口。
> 规范与进度见[设计文档](./doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md) 16.1 与 §24 台账。
> **本 README 其余部分描述的都是当前可用的系统。**

### 角色

| 角色 | 产品 | 定位 | 产出后缀 |
| :--- | :--- | :--- | :--- |
| **Driver** | 缺省 Claude Code（VS Code 插件）；M10b 起四家都可当 | 主攻与裁决。当轮唯一执笔者，唯一有权改业务代码 | 当轮 Driver 的后缀（缺省 `-claude.md`） |
| **Critic-A** | Google Antigravity（CLI `agy`） | 独立审查员 A。工程调用链与依赖推演 | `-gemini.md` |
| **Critic-B** | 智谱 ZCode（`zcode.cjs`） | 独立审查员 B。业务边界与防御性推演 | `-glm.md` |
| **Critic-C** | OpenAI Codex CLI（多模型，经 provider 配置接入） | 独立审查员 C | `-codex.md` |
| **Critic-D** | Claude Code（作审核者，须由另一家当 Driver） | 独立审查员 D | `-claude.md` |

缺省审核者是 Critic-A / B / C 三家（当轮 Driver 不入选）。缺省由 Claude Code 主攻时，开发者只与 Claude Code 对话，全程不需要打开别家的窗口；
换别家主攻时，就在那一家自己的会话里发命令（QUICKSTART §5.2）。

---

## 🌟 核心特性与创新

### 1. 深度整合厂商原生编程 Agent 能力（Agentic, Not Just LLM）

TriviumCode **绝非**调用 LLM 补全接口，而是直接拉起各厂商**系统级编程 Agent 的 headless 运行时**——审查员会真的读你的仓库、跑 `git log`、多步推理，并留下**可核对的工具调用轨迹**作为执行证据。

明确否决的路径：用 `ANTHROPIC_BASE_URL` 指向兼容网关让 Claude Code「扮演」ZCode；把计划全文塞进 `chat/completions` 生成「评审文」；开三个窗口靠人转发。这些都不是编程 Agent，直接违反 FR-02。

- **Claude Code (Driver)**：长上下文理解与深度工具调用，在 VS Code 中自主推进复杂功能实现。
- **Antigravity (Critic A)**：代码知识图谱、语义索引、静态分析推演与全局依赖扫描，重点审查架构拓扑、类型契约、跨文件影响范围。
- **ZCode (Critic B)**：代码规范审查、业务边界校验、异常防御推演，重点审查边界条件、并发安全、注入与鉴权。

### 2. 确定性归程序，认知性归模型

预检、冻结快照、并行调度、超时、重试、解析、落盘、命名、防覆盖、闸门判定、只读校验、元数据——全部由本地编排器 `trivium`（Node.js + TypeScript，打包为单文件零依赖 CJS）承担；LLM 只做**起草、审查、裁决**三件事。

**绝不依赖模型「记得」流程走到哪一步。**

### 3. 背靠背隔离，隔离靠机制而非祈使句

两位审查员**互不可见**对方产出，由四道机制保障：

| 机制 | 说明 |
| :--- | :--- |
| ① 进程与会话独立 | 各自独立子进程、独立会话，不共享任何上下文 |
| ② 本次产出延迟落盘 | 两侧原始输出写到项目根**之外**的 `~/.trivium/runs/`，两侧**都完成后**才同时落盘。审查进行中，对方结论在项目树内**物理不存在** |
| ③ 历史产出三层屏蔽 | 同主题重跑时：BRIEF 逐个列出禁读路径 → 探针证明支持时注入 CLI 路径级 deny → 事后扫描工具轨迹，命中即该侧作废重跑 |
| ④ 只读指纹 | 跑前跑后比对 `tree_hash` + `git status` 指纹，叠加轨迹中的写事件扫描 |

### 4. 逐条裁决，留痕不可伪装

每条审查意见都是可单独处置的最小单元（编号、严重度、层次、类别、位置、问题、依据、建议、置信度九字段必填；个别意见不合格时只把那几条降级、按原编号照样逐条裁决）。Driver 必须**逐条**给出「接受 / 驳回 / 暂缓 + 理由」，接受项必须写明落点。`trivium gate` 机读校验：**删掉一条裁决就会被拦住**。

单审、空审、解析失败、只读失守、无 Agent 证据——一律显式标记，不得改名或删除掩盖。

### 5. 按需动态调度大模型

支持按任务分别指定两侧模型，两边可不同，且**默认与主脑异构**（各侧生效模型不落在当轮 Driver 厂商的名义模型族，Claude Code 执笔时即非 Claude 系；按模型名判定，属启发式）：

- **日常快速迭代**：两侧都用轻量高速模型，极速响应；
- **核心重构 / 高危排错**：两侧都用旗舰推理模型，展开深度推演。

模型的**实际生效值由编排器回读**（从运行产物与会话日志），不采信配置意图。

---

## ⚡ 四条命令

四条 `/` 命令是唯一入口，由 Claude Code 的用户级 Skills 承载（`disable-model-invocation: true`，只允许人触发，Claude 不得自行发起双审）。

| 命令 | 语义 | 必选输入 | 自动执行到 | 停点 |
| :--- | :--- | :--- | :--- | :--- |
| `/dual-run` | **A · 全流程** | 任务目标 | 计划双审 → 修订 → 编码 → 代码双审 → 应答 → 改码 → **真实执行编译测试** | 编译测试结束（成败均留痕） |
| `/dual-review-plan` | **B · 计划审** | **审查焦点提示语** | 双审 → 逐条裁决 → 修订计划 | **等待人工审批** |
| `/dual-review-code` | **C · 代码审** | **审查焦点提示语** | 双审 → 逐条应答（确认修改方案） | **等待人工审批** |
| `/dual-review-bug` | **D · 根因审** | **审查焦点提示语** | 双审 → 修订根因结论 | **等待人工审批** |

辅助命令：`/dual-approve`（人工审批 / 拒绝）、`/dual-abandon`（放弃闸门）、`/dual-status`（状态查询）。

**关于停点**：B/C/D 停在人工审批不是一句提示，而是三层机制——状态层写入 `awaiting_approval`，提示层输出统一停点话术，**强制层由 Claude Code Hook 在 `PreToolUse` 拒绝写入业务文件**（这是 Claude Code 主攻、护栏 L1 时的情形；ZCode 主攻时 Hook 只作尽力拦截，Codex / Antigravity 主攻时没有 Hook，见 QUICKSTART §5.2）。同时 Hook 会拒绝 Driver 在归档内写出审核者后缀的文件（全部已登记角色减当轮 Driver，Claude Code 执笔时即另三家），防止主脑自己编一份审查；Bash 侧另按命令文本字面拦全部角色后缀（启发式）。

**命令 D 不得由 A 或 C 代替**：命令 A 的链路不含独立根因审阶段，遇到待审根因材料一律引导至 D。

---

## 🏗️ 核心架构与流转时序

```text
                      【TriviumCode 协同架构全景】

        ┌──────────────────────────────────────────────────────┐
        │                 macOS + VS Code 工作区               │
        └─────────────────────────┬────────────────────────────┘
                                  │ /dual-review-plan "重点看并发与回滚"
                                  ▼
                  ┌───────────────────────────────────┐
                  │     Claude Code (Driver 主脑)     │
                  └───────────────┬───────────────────┘
                                  │ 起草并落盘原始计划
                                  ▼
              📁 .reviews/<主题>/plan/2026-09-10-<主题>-claude.md
                                  │
                                  ▼
                  ┌───────────────────────────────────┐
                  │  trivium 编排器（确定性执行体）    │
                  │  预检 → 冻结快照 → 生成两份送审包  │
                  └───────────────┬───────────────────┘
                                  │ 背靠背并行拉起，cwd 均为项目根
              ┌───────────────────┴───────────────────┐
              ▼                                       ▼
  ┌───────────────────────────┐         ┌───────────────────────────┐
  │  Antigravity Agent (agy)  │         │    ZCode Agent (zcode)    │
  │  只读 · 工程调用链与依赖   │         │  只读 · 业务边界与防御     │
  └─────────────┬─────────────┘         └─────────────┬─────────────┘
                │ 结论 + 工具轨迹                     │ 结论 + 工具轨迹
                ▼                                     ▼
     ~/.trivium/runs/<run_id>/gemini/       ~/.trivium/runs/<run_id>/glm/
       （项目根之外 · 审查中互相看不到）
                └───────────────────┬───────────────────┘
                                    ▼
                  ┌───────────────────────────────────┐
                  │ guard：只读指纹 · 漂移检测         │
                  │        轨迹核验 · Agent 证据下限   │
                  └───────────────┬───────────────────┘
                                  ▼ archive 两侧齐备后同时落盘
     📁 2026-09-10-<主题>-gemini.md    📁 2026-09-10-<主题>-glm.md
     📁 _meta/{brief-*, review-*.json, run-<run_id>.json}
                                  │
                                  ▼
                  ┌───────────────────────────────────┐
                  │ Driver 读两份全文，逐条裁决        │
                  └───────────────┬───────────────────┘
                                  ▼
          📁 2026-09-10-<主题>-revised-claude.md（含逐条裁决表）
                                  │
                                  ▼ trivium gate --check
                  ┌───────────────────────────────────┐
                  │ 裁决完整性硬校验：每个意见编号     │
                  │ 必须出现且仅出现一次，理由非空     │
                  └───────────────┬───────────────────┘
                    ┌─────────────┴─────────────┐
                    ▼ 命令 B/C/D                ▼ 命令 A
            ⏸ 停在人工审批                继续下一阶段
            （Hook 锁住业务写入）        （直到编译测试出口）
```

**分层职责**：

| 层 | 内容 |
| :--- | :--- |
| 交互层 | Claude Code + 四条 `/` 命令 + Hook 护栏 |
| 编排层 | `trivium` CLI：`init` `doctor` `preflight` `topic resolve` `review`（`--start`/`--wait`/`--status`/`--cancel`）`gate`（含五个 `hook-*` 入口）`approve` `abandon` `verify` `report` `status`。**无常驻进程**，每条命令按需拉起、跑完即退 |
| 适配层 | 四家适配器（`adapters/agy.ts` / `zcode.ts` / `codex.ts` / `claude.ts`）：把各家 CLI 的参数、输出字段、模型指定方式、只读方式、轨迹来源差异收敛到统一契约 |
| 执行层 | `agy` / `zcode.cjs` / `codex` / `claude` 的 headless Agent 运行时 |
| 归档层 | `.reviews/`（进 Git，是本流水线对外的「事实」）+ `.trivium/`（本机运行时状态） |

> 四家 CLI 的参数与行为随版本漂移，因此**能力靠探针，不靠记忆**：`trivium doctor` 在本机逐项实测后把结论回填配置，实现代码只读探针结论，不硬编码设计文档列出的命令行。

---

## 📜 全流程审计与留痕机制

所有中间过程工件严格落盘并**纳入 Git 版本管理**，既是架构决策历史，也是质量把控依据。

### 命名规范

```text
.reviews/<主题>/<阶段>/<YYYY-MM-DD>-<主题>[-r<N>][-revised|-response]-<角色>.md

阶段 = plan | code | bug | verify
角色 = claude | codex | gemini | glm（由 Agent 注册表派生）
```

- `-r<N>`：同一主题同一阶段**重跑**时追加（N 从 2 起）。**既有工件无论是否已审批一律不覆盖**，`archive` 以 `O_CREAT|O_EXCL` 原子创建保证。
- `-revised`：计划 / 根因修订件；`-response`：代码应答件。
- 角色后缀是硬约束：审查员不得产出当轮 Driver 的后缀，Driver 不得产出审核者的后缀（受保护集 = 全部已登记角色减当轮 Driver，Claude Code 执笔时即 `codex` / `gemini` / `glm`）。

### 各阶段工件集

| 阶段 | 必备工件 |
| :--- | :--- |
| **`plan/`** 计划审 | 原始计划 `-<Driver>.md` · 每个入选审核者一份审查（缺省 `-codex.md` / `-gemini.md` / `-glm.md`） · 修订计划 `-revised-<Driver>.md`（含逐条裁决表） · 有接受项时的新一轮计划 `-r<N>-<Driver>.md`（开头逐条引用接受编号，即代码阶段送审的计划定稿；闸门核它存在且编号齐全，设计 §6.6 规则 9） |
| **`code/`** 代码审 | 每个入选审核者一份审查 · 应答件 `-response-<Driver>.md`（每条接受/驳回/暂缓 + 理由 + 修改计划） |
| **`bug/`** 根因审 | 根因原稿 `-<Driver>.md` · 每个入选审核者一份审查 · 修订根因 `-revised-<Driver>.md` |
| **`verify/`** 编译测试出口 | `-verify.md` + `_meta/verify-<run_id>.json`（含实际执行的命令与退出码） |

`_meta/` 由编排器产出，存放送审包 `brief-*`、结构化结论 `review-*.json`、code 阶段的 `changes.diff`，以及运行元数据 `run-<run_id>.json`（快照哈希、各侧生效模型、当轮 Driver 与其护栏等级、起止时间、工具轨迹计数、降级原因、只读与隔离核验结论）。

完整规范见 [`.reviews/README.md`](./.reviews/README.md)。

---

## 📂 工程与文档目录结构

```text
TriviumCode/
├── src/
│   ├── trivium/                   # 编排器实现（TypeScript）
│   │   ├── cli.ts config.ts doctor.ts preflight.ts
│   │   ├── topic.ts freeze.ts brief.ts runner.ts
│   │   ├── parse.ts render.ts guard.ts gate.ts
│   │   ├── archive.ts meta.ts verify.ts report.ts
│   │   └── adapters/{base,agy,zcode}.ts
│   ├── entry-render.ts            # 入口资产渲染器：skills-src/ → 四家入口 SKILL.md
│   └── install.ts                 # 安装器：运行时根 + 四家入口 + Agent 定义 → 用户目录
├── skills-src/                    # 入口资产的源：命令契约、片段、四家载体差异（改这里，再 npm run render）
├── skills/                        # → 安装到各家用户级 skill 根（一次安装多项目复用）
│   ├── dual-critic/               # 核心 skill：编排器脚本与全部资产
│   │   ├── entry/<agent>/         #   另三家的入口 SKILL.md（渲染产物，进 Git，安装时拍平）
│   │   ├── scripts/trivium.cjs    #   esbuild 打包产物（不进 Git）
│   │   ├── schema/                #   review / disposition / run / config 四份 JSON Schema
│   │   ├── prompts/ lenses.yaml   #   审查提示词模板与两侧差异化审查镜头
│   │   ├── agents/ templates/     #   Antigravity 只读审查 Agent 定义、文档模板
│   │   └── hooks/ protocol/       #   Hook 配置与协议片段
│   └── dual-{run,review-plan,review-code,review-bug,approve,abandon,status}/   # claude 的入口（渲染产物）
├── test/                          # node:test 单元 / 契约 / 集成测试
├── .reviews/                      # 多智能体协同审计与留痕（进 Git）
├── doc/                           # 工程文档中心（单层扁平结构）
│   ├── 01_requirements/           #   需求工程 (PRD_*, SRS_*)
│   ├── 02_design/                 #   系统设计 (ARCH_*, LLD_*, ADR_*)
│   ├── 03_api/                    #   接口契约 (API_*, PROTOCOL_*)
│   ├── 04_development/            #   开发指引 (GUIDE_*, WORKFLOW_*)
│   ├── 05_testing/                #   测试验证 (PLAN_*, CASE_*, REPORT_*)
│   ├── 06_deployment/             #   部署运维 (DEPLOY_*, RUNBOOK_*)
│   ├── 07_manuals/                #   用户手册 (QUICKSTART.md, MANUAL_*)
│   └── 08_project/                #   项目管理 (ROADMAP.md, MEETING_*)
├── .env.example  .gitignore  CONTRIBUTING.md  CODE_OF_CONDUCT.md  SECURITY.md  LICENSE
└── README.md
```

### 目标项目内的运行时布局

在**被审查的项目**中执行 `trivium init` 后：

```text
<your-project>/
├── .reviews/                      # 归档根（进 Git）
├── .trivium/
│   ├── bin/trivium                # wrapper，内含 doctor 探测到的 node 绝对路径
│   ├── config.yaml                # 团队共享策略（进 Git）
│   ├── config.local.yaml          # 本机绝对路径与探针结论（不进 Git）
│   └── state.json  lock/  logs/   # 运行时状态（不进 Git）
├── .claude/settings.json          # Hook 配置（随仓库分发）
├── AGENTS.md                      # 供 ZCode 读取的项目公约
└── CLAUDE.md                      # 含 TriviumCode 协议片段

~/.trivium/runs/<repo_id>/<run_id>/   # 运行目录（项目外，隔离机制的一部分）
```

---

## 🚀 快速开始

### 1. 前置环境要求

| 项 | 要求 |
| :--- | :--- |
| **操作系统** | **macOS**（一级支持平台，推荐 Sonoma 14+）。Linux / Windows **未验证**，本期不作为目标平台 |
| **IDE** | Visual Studio Code + Claude Code 插件（唯一主交互入口） |
| **Node.js** | **≥ 18**（官方建议 22+）。ZCode 本身也要求 Node ≥ 18 |
| **Git** | 项目必须是 git 仓库（快照、漂移检测与工件版本管理的前置） |
| **Critic-A** | [Google Antigravity CLI](https://antigravity.google/) —— 命令 `agy`，需已登录 |
| **Critic-B** | 智谱 ZCode 桌面端 —— 入口 `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，需已登录 |

### 2. 安装编排器（一次安装，全项目复用）

```bash
git clone https://gitcode.com/czb99/TriviumCode.git
cd TriviumCode

npm install          # 安装 typescript / esbuild（仅构建期）
npm run build        # esbuild 打包为单文件零依赖 skills/dual-critic/scripts/trivium.cjs
node dist/install.cjs
```

安装器会：把运行时资产 `skills/dual-critic/` 装到 `~/.claude/skills/dual-critic`（**必装**，设了 `TRIVIUM_ASSET_ROOT` 就装到那里）；按本机装了哪几家 CLI，把各家的入口 skill 装进各自的 skill 根——Claude Code `~/.claude/skills/`、Codex `$CODEX_HOME/skills/`（未设时 `~/.codex/skills/`）、ZCode `~/.zcode/skills/`、Antigravity `~/.gemini/config/skills/`，家根不存在的那一家跳过；Antigravity 在场时再把只读审查 Agent 定义拷到 `~/.gemini/config/agents/trivium-critic/agent.md`。装之前先查历史残留与重名，有问题**只报错、一个文件都不写、不删你的东西**；升级时只裁剪本产品自己那几个 skill 目录里的旧文件。只想装其中几家用 `--targets claude,glm`。装完它会**提示**你接下来该做什么——不会替你跑 `doctor`，因为那会消耗厂商配额。卸载用 `node dist/install.cjs --uninstall`：只删本产品的东西——各家 skill 根里判定为本产品的入口（`SKILL.md` 名字对得上、且调用 `.trivium/bin/trivium`；保留原名、仍调用 wrapper 的 fork 也会被当成本产品）、运行时根、Agent 定义；项目内的 `.trivium/` 与 Hook 不动。运行时根同样先过身份判定：它与本仓库重叠（`TRIVIUM_ASSET_ROOT` 指向了工作树），或非空却不是本产品的运行时，安装会拒绝、卸载只提示不删——**安装与卸载前请取消指向工作树的 `TRIVIUM_ASSET_ROOT`**。安装器只认 `--targets` 与 `--uninstall` 两个旗标，拼错或卸载时带 `--targets` 都会直接报错。

> **`trivium` 不在 PATH 上**，这是有意的。下文为可读性写作 `trivium <子命令>`，实际调用是：
> - 项目内（`init` 之后）：`.trivium/bin/trivium <子命令>` ——wrapper 内含 node 绝对路径，GUI 启动的进程不读 `~/.zshrc`；
> - 还没 `init` 的项目里：`node ~/.claude/skills/dual-critic/scripts/trivium.cjs <子命令>`。

装完先自检一次，**不消耗任何厂商配额**：

```bash
node ~/.claude/skills/dual-critic/scripts/trivium.cjs doctor --selftest
```

它在临时夹具仓库里真跑一遍整条流水线（双审 → 闸门拦截 → 补裁决 → 闸门放行 → 编译测试 → 复盘 → 重跑不覆盖），14 步逐一核对退出码。各入选侧走桩适配器，所以它**证明不了**那几家 CLI 可用——那是下一步 `doctor` 的事，输出里会写明这条边界（家数随缺省集合派生，不写死）。

### 3. 本机能力探测

```bash
trivium doctor
```

`doctor` 会**在本机实测**两家 CLI 的真实能力——headless 是否能读文件、结构化输出是否可用、只读参数哪个组合真正生效、模型覆盖走哪一档、工具轨迹从哪里提取、路径级 deny 是否支持、Agent 会在项目根留下哪些临时文件——并把结论回填 `.trivium/config.local.yaml` 的 `probe:` 段。

**这一步不是可选的**：只读保障那一族旗标（缺一即失守的安全不变量）由适配层从探针结论取，
不靠文档上写着应该管用的默认值。机制类旗标的归属见设计 §11.1「旗标归属判据」。

### 4. 在你的项目里初始化

```bash
cd /path/to/your-project
trivium init
```

`init` 会创建 `.trivium/`（配置、wrapper）、合并 Hook 进 `.claude/settings.json`、幂等追加 `.gitignore` 规则与 `CLAUDE.md` / `AGENTS.md` 协议片段。

**必须补一步**：把编译测试命令写进 `.trivium/config.yaml`。编排器**只执行**你显式声明的命令，绝不猜测执行——`scripts.test` 完全可能耗时极长、依赖外部服务或有副作用。

```bash
trivium doctor --suggest-verify   # 只展示候选与可粘贴的 YAML，不写入
```

```yaml
verify:
  build: ['npm run typecheck', 'npm run build']
  test:  ['npm test']
```

两者皆空时 `/dual-run`（命令 A）会拒绝启动：跑完全流程却无法收口没有意义。

### 5. 跑第一条任务

在 VS Code 的 Claude Code 里（别家主攻时的调用写法——例如 Codex 写 `$dual-review-plan`——见 QUICKSTART §5.2）：

```text
/dual-review-plan 重点看并发安全与回滚路径 --topic 登录重构
```

流程会自动跑完双审与逐条裁决，然后**停在人工审批**。检查三份文档后：

```text
/dual-approve --topic 登录重构 --stage plan
```

跑完想看复盘：

```bash
trivium report --topic 登录重构    # 时间线、意见数与严重度分布、采纳率、被驳回项与理由、
                                  # 生效模型核对、降级与告警、双审退化指标、耗时汇总
trivium verify --topic 登录重构    # 真实执行配置里的编译测试命令并落盘记录
```

### 6. 配置

模型、超时、失败策略、闸门行为等在 `.trivium/config.yaml` 中调整（团队共享，进 Git）；本机绝对路径与探针结论在 `.trivium/config.local.yaml`（不进 Git）。

`.env.example` 提供的环境变量仅作**覆盖**用途，模型配置的主路径是 `.trivium/config.yaml` 的 `profiles`。

---

## 📚 文档

| 文档 | 内容 |
| :--- | :--- |
| [产品需求文档 (PRD)](./doc/01_requirements/PRD_driver_dual_critic.md) | 角色定义、S1～S5 场景、FR-01～FR-25 功能需求、NFR、AC-01～AC-18 验收标准 |
| [总体架构与详细设计](./doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md) | **唯一实现依据**。架构、组件、接口契约、命名规范、异常矩阵、实施路线与验收映射 |
| [ADR-001 隔离模式](./doc/02_design/ADR_001_isolation_mode.md) | 为何采用就地审查而非冻结镜像树 |
| [留痕目录规范](./.reviews/README.md) | 归档结构、命名规则、各阶段工件集 |
| [**快速上手**](./doc/07_manuals/QUICKSTART.md) | 15 分钟装好并跑通一条真实任务：前置条件、安装自检、探针实测、项目启用、第一条任务、三道护栏、排障 |
| [协议与接口契约](./doc/03_api/PROTOCOL_dual_critic_relay.md) | 四份 JSON Schema、BRIEF 八段结构、快照与漂移算法、退出码、`--start`/`--wait` 分段协议、Hook 契约 |
| [开发与调试指南](./doc/04_development/GUIDE_env_setup.md) | 面向修改本项目的人：工具链、产物布局、分层测试、九条实现纪律 |
| [本机坑清单（`P-xx` 唯一落点）](./doc/04_development/GUIDE_local_pitfalls.md) | 各家 CLI 与本机环境的实测坑，跨里程碑持续追加（M11 第 10 步从 M0 探针报告 §7 搬来）；M0 当时与厂商文档记载不符的 12 条（C-xx）留在 [M0 探针报告](./doc/05_testing/REPORT_2026-09-11_m0_probe.md) §8 |
| [文档中心索引](./doc/README.md) | 全部工程文档的分类与命名规范 |

---

## 🤝 贡献与社区

我们热忱欢迎所有对多智能体协同开发、自动化代码审查与软件工程现代化感兴趣的开发者参与贡献！

- 提交代码前请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)；
- 请务必遵守 [行为准则](./CODE_OF_CONDUCT.md)；
- 如发现安全漏洞，请依照 [SECURITY.md](./SECURITY.md) 的指引安全报告。

---

## 📄 许可证

本项目采用 [Apache License 2.0](./LICENSE) 协议开源。
