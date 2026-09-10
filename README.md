# TriviumCode (三方智鉴)

<div align="center">

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20VS%20Code-brightgreen.svg)](#)
[![Workflow](https://img.shields.io/badge/Architecture-Driver--DualCritic-orange.svg)](#)
[![Agents](https://img.shields.io/badge/Agents-Claude%20Code%20%7C%20Antigravity%20%7C%20ZCode-purple.svg)](#)

**面向 macOS + VS Code 原生开发流的“主攻 + 双审”（Driver-DualCritic）全自动多智能体协同流水线**

[快速开始](#快速开始) • [核心架构](#核心架构与设计思想) • [全流程留痕](#全流程审计与留痕机制) • [文档中心](./doc/README.md) • [贡献指南](./CONTRIBUTING.md)

</div>

---

## 📖 项目概况

随着 AI 编程工具由单次代码生成迈入**自主智能体（Agent）**时代，单一模型在处理大型代码库、复杂系统重构与长调用链路排错时，不可避免地会遇到**单模型视野盲区、上下文退化、隐蔽逻辑幻觉以及安全死角**。

**TriviumCode**（源自拉丁语 *Trivium*，意为文法、逻辑与修辞三艺交汇的智慧三岔口）专为 **macOS + VS Code** 原生开发环境打造，首创 **“主攻 + 双审”（Driver-DualCritic）** 的全自动多智能体协作范式：
- 以 **Claude Code** 为主控研发核心（Driver），负责端到端的需求理解、方案拟定、代码编写与缺陷修复；
- 引入 **Google Antigravity** 与 **智谱 ZCode** 组成异构专家评审团（Dual-Critic），以独立的视角交叉审查需求规格、技术设计方案、代码变更补丁及 Bug 根因定位；
- 形成**“主脑起草 -> 专家并发交叉盲审 -> 主脑吸收修正 -> 最终收敛确认”**的闭环自愈开发流水线，将 AI 编程任务的首次交付成功率与架构稳健性提升至工业级水准。

---

## 🌟 核心特性与创新

### 1. 深度整合厂商原生编程 Agent 能力（Agentic, Not Just LLM）
TriviumCode **绝非**简单的调用 LLM 补全接口，而是深度编排各主流 AI 厂商顶级的**系统级编程 Agent 原生能力**：
- **Claude Code (Driver)**：依托强大的长上下文理解与深度工具调用（Terminal/Filesystem），在 VS Code 插件与终端中自主推进复杂功能实现。
- **Google Antigravity Agent (Critic A)**：利用 DeepMind 代码知识图谱、语义索引、静态分析推演与全局依赖扫描能力，重点审查架构拓扑合理性、类型契约、跨文件影响范围与潜在逻辑暗坑。
- **智谱 ZCode Agent (Critic B)**：依托智谱编程 Agent 体系的代码规范审查、业务边界校验、异常防御推演能力，重点对边界条件、防空指针、并发安全与中国本土开源技术栈进行深度把脉。

### 2. 全流程双阶段“闭环留痕”与回溯审计 (Audit Trail)
协作过程绝不依赖不可追溯的临时交互，全部中间过程工件严格落盘留痕，既可作为架构决策历史（ADR），也作为版本质量把控依据：
- **阶段一：需求与计划审核留痕**
  1. `PLAN_RAW.md`：Claude Code 生成的原始方案与计划文档；
  2. `PLAN_REVIEW_AGY.md`：Antigravity 输出的方案推演与架构审查文档；
  3. `PLAN_REVIEW_ZCODE.md`：ZCode 输出的业务边界与异常防御审查文档；
  4. `PLAN_REVISED.md`：Claude Code 吸收双专家意见后输出的最终修订版实施计划。
- **阶段二：代码与缺陷修复审核留痕**
  1. `DIFF.patch`：Claude Code 编码完成后生成的标准 Git 差异补丁；
  2. `CODE_REVIEW_AGY.md`：Antigravity 针对补丁的代码质量、性能与隐患审查报告；
  3. `CODE_REVIEW_ZCODE.md`：ZCode 针对补丁的代码规范、业务逻辑与防御审查报告；
  4. `REVIEW_RESPONSE.md`：Claude Code 对双专家意见的逐条应答文档（包括明确记录：**接受/不接受、理由、对应重构代码修改点**）。

### 3. 按需动态调度大模型 (Task-Specific Dynamic LLM Routing)
支持针对任务场景的复杂度与响应要求，自由配置 Antigravity 和 ZCode 所调用的底层大语言模型：
- **日常快速迭代 / 小修小补**：指定轻量级高速模型（如 `Gemini 2.5 Flash` + `GLM-4-Air/Flash`），极速响应；
- **核心底层重构 / 复杂高危排错**：指定旗舰超强推理模型（如 `Gemini 2.5 Pro` + `GLM-4-Plus`），展开深度推演。

### 4. macOS + VS Code 原生无侵入流转
- 依托**文件工件中继协议（File Artifact Relay Protocol）**，无需常驻重型后台 Daemon 或复杂远程 RPC 隧道；
- 审查意见与补丁统一落于 `.reviews/` 目录，在 VS Code 中通过快捷键（如 `Cmd + K V`）即可秒级分栏对比，完全融入开发者日常操作流。

---

## 🏗️ 核心架构与流转时序

```text
                             【TriviumCode 协同架构全景】

           ┌────────────────────────────────────────────────────────┐
           │                   macOS + VS Code 工作区               │
           └───────────────────────────┬────────────────────────────┘
                                       │ 用户指令输入
                                       ▼
                     ┌───────────────────────────────────┐
                     │     Claude Code (Driver 主脑)     │
                     └───────────────┬───────────────────┘
                                     │ 产生初始方案工件
                                     ▼
                      【阶段一：方案审查工件落盘】
                      📁 .reviews/PLAN_RAW.md
                                     │
                 ┌───────────────────┴───────────────────┐
                 │ (并发唤起 Agent 独立审查)              │
                 ▼                                       ▼
    ┌───────────────────────────┐           ┌───────────────────────────┐
    │  Google Antigravity Agent │           │      智谱 ZCode Agent      │
    │   (工程调用链与依赖推演)   │           │   (业务边界与防御性推演)   │
    └─────────────┬─────────────┘           └─────────────┬─────────────┘
                  ▼ 审查产出                              ▼ 审查产出
    📁 .reviews/PLAN_REVIEW_AGY.md          📁 .reviews/PLAN_REVIEW_ZCODE.md
                  │                                       │
                  └───────────────────┬───────────────────┘
                                      ▼
                     ┌───────────────────────────────────┐
                     │ Claude Code 读取双审报告优化方案  │
                     └────────────────┬──────────────────┘
                                      ▼ 确认定稿
                      📁 .reviews/PLAN_REVISED.md
                                      │
                                      ▼ 用户确认 -> 开始编写代码
                     ┌───────────────────────────────────┐
                     │       Claude Code 实际落地编码     │
                     └────────────────┬──────────────────┘
                                      ▼ 产生代码变更补丁
                      📁 .reviews/DIFF.patch
                                      │
                 ┌────────────────────┴───────────────────┐
                 │ (并发唤起 Agent 审查代码补丁)          │
                 ▼                                        ▼
    ┌───────────────────────────┐            ┌───────────────────────────┐
    │  Google Antigravity Agent │            │      智谱 ZCode Agent      │
    │    (静态分析与漏洞深度扫描) │            │    (代码规范与异常分支覆盖) │
    └─────────────┬─────────────┘            └─────────────┬─────────────┘
                  ▼ 审查产出                               ▼ 审查产出
    📁 .reviews/CODE_REVIEW_AGY.md           📁 .reviews/CODE_REVIEW_ZCODE.md
                  │                                        │
                  └────────────────────┬───────────────────┘
                                       ▼
                     ┌───────────────────────────────────┐
                     │ Claude Code 逐条评估意见并修改    │
                     └─────────────────┬─────────────────┘
                                       ▼ 记录接受/拒绝决策与修改点
                      📁 .reviews/REVIEW_RESPONSE.md
                                       │
                                       ▼ 测试通过 & 人工最终验收
                                   🎉 合并入库
```

---

## 📂 工程与文档目录结构

项目严格遵循现代软件工程全生命周期（SDLC）规范，并推行**单层扁平化文档架构**，所有文档通过规范前缀区分类型：

```text
TriviumCode/
├── .reviews/                      # 多智能体协同审计与留痕专用工件目录 (Git 跟踪关键记录)
│   ├── PLAN_RAW.md                # Claude 初始方案
│   ├── PLAN_REVIEW_AGY.md         # Antigravity 方案审查报告
│   ├── PLAN_REVIEW_ZCODE.md       # ZCode 方案审查报告
│   ├── PLAN_REVISED.md            # Claude 优化后终版方案
│   ├── DIFF.patch                 # 代码变更补丁
│   ├── CODE_REVIEW_AGY.md         # Antigravity 代码审查报告
│   ├── CODE_REVIEW_ZCODE.md       # ZCode 代码审查报告
│   └── REVIEW_RESPONSE.md         # Claude 审查应答与决策留痕
├── doc/                           # 项目工程文档中心 (单层扁平结构，无嵌套子目录)
│   ├── README.md                  # 文档中心总索引与前缀规范
│   ├── 01_requirements/           # 需求工程 (PRD_*, SRS_*, STORY_*)
│   ├── 02_design/                 # 系统设计 (ARCH_*, LLD_*, ADR_*, 现存方案提案)
│   ├── 03_api/                    # 接口契约与协议规范 (API_*, PROTOCOL_*)
│   ├── 04_development/            # 开发指引与 Git 协作 (GUIDE_*, WORKFLOW_*)
│   ├── 05_testing/                # 测试验证与质量报告 (PLAN_*, CASE_*, REPORT_*)
│   ├── 06_deployment/             # 部署运维与应急预案 (DEPLOY_*, RUNBOOK_*)
│   ├── 07_manuals/                # 用户手册与快速上手 (QUICKSTART.md, MANUAL_*)
│   └── 08_project/                # 项目排期与评审纪要 (ROADMAP.md, MEETING_*)
├── .env.example                   # 环境变量安全配置模板
├── .gitignore                     # Git 忽略配置（严格隔离 API 密钥与系统缓存）
├── CONTRIBUTING.md                # 社区贡献指南
├── CODE_OF_CONDUCT.md             # 开源行为准则 (Contributor Covenant)
├── SECURITY.md                    # 安全策略与漏洞通报机制
├── LICENSE                        # Apache-2.0 开源许可证
└── README.md                      # 本项目主文档
```

---

## 🚀 快速开始

### 1. 前置环境要求
- **操作系统**：macOS（推荐 Sonoma 14+）或 Linux / Windows。
- **IDE**：Visual Studio Code（建议安装官方 Claude Code 插件及 Markdown Preview Enhanced）。
- **智能体工具链**：
  - [Claude Code CLI / VS Code 插件](https://claude.ai/code)
  - Google Antigravity CLI (`agy`)
  - 智谱 ZCode 开发者环境

### 2. 克隆项目与配置密钥
```bash
# 克隆仓库
git clone https://gitcode.com/czb99/TriviumCode.git
cd TriviumCode

# 从模板创建 .env 配置文件
cp .env.example .env
```

编辑 `.env` 文件，按需填入 API Key 与指定模型版本：
```ini
# 智谱 ZCode 凭据与指定模型
ZCODE_API_KEY=your_zcode_api_key_id.your_zcode_secret
ZCODE_MODEL=glm-4-plus

# Google Antigravity 配置 (支持指定模型)
# ANTIGRAVITY_API_KEY=your_google_key
ANTIGRAVITY_MODEL=gemini-2.5-pro

# Claude Code 配置
# ANTHROPIC_API_KEY=your_anthropic_key
CLAUDE_MODEL=claude-3-7-sonnet-latest
```

---

## 🤝 贡献与社区

我们热忱欢迎所有对多智能体协同开发、自动化代码审查与软件工程现代化感兴趣的开发者参与贡献！

- 在提交代码前，请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)；
- 请务必遵守我们的 [行为准则](./CODE_OF_CONDUCT.md)；
- 如发现安全漏洞，请直接依照 [SECURITY.md](./SECURITY.md) 中的指引安全报告。

---

## 📄 许可证

本项目采用 [Apache License 2.0](./LICENSE) 协议开源。
