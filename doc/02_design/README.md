# 02_系统设计 (System Design)

本目录存放所有系统设计、架构、决策与调研文档，通过文件名前缀区分文档类型。

> **扁平结构的唯一例外**：[`reference/`](./reference/) 子目录。文档中心 [`doc/README.md`](../README.md) 规定各一级目录下不建二级子目录，但本目录同时容纳「**唯一实现依据**」与「多模型答卷等设计输入」两类性质完全不同的文档，且答卷数量会随调研持续增加。若全部平铺，实现者难以一眼分辨哪份是准绳。因此把**非实现依据**的调研材料统一收进 `reference/`，本目录根下只保留正式设计、ADR 与模板。该例外仅限本目录。

---

## 文件命名规范

| 前缀 / 格式 | 文档类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `ARCH_<名称>.md` | 总体架构设计 (HLD) | 系统全局上下文、分层架构、核心数据总线、拓扑设计。 | `ARCH_system_overview.md` |
| `LLD_<名称>.md` | 详细设计说明书 (LLD) | 模块级内部设计、状态机、时序图、类与函数签名。 | `LLD_diff_patch_parser.md` |
| `ADR_<编号>_<名称>.md` | 架构决策记录 (ADR) | 关键技术选型与论证记录（背景、评估、决策与影响）。 | [`ADR_TEMPLATE.md`](./ADR_TEMPLATE.md) |
| `PROPOSAL_<名称>.md`<br>或 `YYYY-MM-DD-<主题>.md` | 方案调研与提案 | 针对特定技术挑战的早期提案、竞品调研或多模型答卷。 | `2026-09-10-Claude_Antigravity_ZCode_MultiAgent_Workflow-gemini.md` |

---

## 当前已归档文件

### 唯一实现依据

- [`2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md`](./2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md)：**Driver-DualCritic 主攻双审流水线总体架构与详细设计**（v1.2.1，状态：评审中）。依据 PRD v1.3.0 与 5 份参考答卷起草；v1.1.0 按设计审核意见 RV-01～RV-26 修订，v1.2.0 按项目负责人意见 UR-01～UR-06 修订（就地审查、结合全项目评审、Node.js + TypeScript、用户级 skills 载体），均附逐条应答；v1.2.1 按 M0 本机实测回补第 3、10、11、12 章（坑清单 C-01～C-12）并吸收 M3 双审意见。
  覆盖架构、组件划分、接口契约、目录与命名规范、操作流程、异常矩阵、实施路线（M0～M5）与验收映射。**实现与本文冲突时，先回溯修订本文与 PRD，禁止两套规范并行。**

### 详细设计说明书 (LLD)

- [`LLD_orchestrator.md`](./LLD_orchestrator.md)：**编排器详细设计说明书**（v1.0.0，状态：草稿）。面向要维护或修改编排器的工程师，补设计文档与 PROTOCOL 不讲的那一层——50 个模块 / 16437 行代码的分层地图、六条执行流的调用链、三个核心状态机、五条贯穿全局的实现约束（附「栽过的实例」），以及第七章如实记录的七条现状缺口。
  与既有文档的分工：设计文档讲**为什么这么设计**、[`PROTOCOL_dual_critic_relay.md`](../03_api/PROTOCOL_dual_critic_relay.md) 讲**对外契约是什么**、本文讲**代码实际怎么走**。冲突时以设计文档为准。

### 架构决策记录 (ADR)

- [`ADR_001_isolation_mode.md`](./ADR_001_isolation_mode.md)：审查员隔离模式采用**就地审查（in-place）**，不构造冻结镜像树；配三层屏蔽与漂移检测。**状态：Accepted（2026-09-11）**，决策者 Chen Zhenbo（评审意见 UR-03 / UR-06）。
  推翻 v1.0.0～v1.1.0 的 `mirror` 镜像树方案，并因此新增 `agy.path_deny` / `zcode.path_deny` / `agy.scratch_paths` / `zcode.scratch_paths` 四项 M0 探针。关联：设计 AD-05 与第 10 章、PRD FR-07 / FR-10 / FR-15 / FR-16。

### 实施记录

- [`../05_testing/REPORT_2026-09-11_m0_probe.md`](../05_testing/REPORT_2026-09-11_m0_probe.md)：M0 探针本机实测报告（本机坑清单）。设计原则 P7 规定实现代码只读探针结论、不得硬编码 CLI 命令行，本报告是该结论的人读副本（机读副本在 `.trivium/config.local.yaml` 的 `probe:` 段，不进 Git）。

### 演进提案（待审，不作为实现依据）

- [`2026-09-13-通用Agent编排与动态多审设计-glm.md`](./2026-09-13-通用Agent编排与动态多审设计-glm.md)：**通用 Agent 编排与动态多审（Driver-MultiCritic）演进计划**（v0.1.5，状态：提案——待双审与项目负责人评审）。依据 2026-09-13 六条演进需求（QWen/DeepSeek 等多模型经 Codex 接入、含 profile 透传与四模型真实思考模式枚举，任意 Agent 可为 Driver，每次审核选 1～3 个审核者，逐审核者模型+思考等级三档，通用扩展架构）起草；提出 Agent 注册表、Driver 运行属性化、N 方隔离与闸门泛化、配置/schema v2、M6～M11 实施路线。**实施前须按纪律 1 回溯修订主设计与 PRD**。计划期登记既有隔离缺口（`_meta/review-<peer>-*.json` 不在禁读清单、git 对象库与 `~/.trivium` 运行目录为检测盲区）并裁定对策：只做检测收口，硬隔离路线（Seatbelt/影子工作区）留档备选。

### 模板

- [`ADR_TEMPLATE.md`](./ADR_TEMPLATE.md)：架构决策记录编写模板

---

## 设计输入（`reference/`，**不作为实现依据**）

以下文档保留其历史价值，但**结论可能已被 v1.2.0 推翻**，实现时一律以上方「唯一实现依据」为准。

**设计审核意见**
- [`2026-09-10-Driver-DualCritic主攻双审流水线设计审核意见-claude.md`](./reference/2026-09-10-Driver-DualCritic主攻双审流水线设计审核意见-claude.md)：对 claude 版综合设计 **v1.0.0** 的评审意见（26 条，裁决「有条件通过」）。其横向对比表中的「实现语言 Python」「冻结镜像树 mirror」「命令载体 `.claude/commands/`」三项结论已分别被 AD-12 / ADR-001 / AD-13 推翻。

**其它 Agent 的综合设计答卷**
- [`2026-09-10-Claude-Code主攻双智能体审核流水线-gemini.md`](./reference/2026-09-10-Claude-Code主攻双智能体审核流水线-gemini.md)：Gemini 架构师方案（文内元信息自称「已批准 · 实施基线」，**该口径无效**，本项目的实施基线是上方 claude 版设计）
- [`2026-09-10-Claude-Code主攻双智能体审核流水线-glm.md`](./reference/2026-09-10-Claude-Code主攻双智能体审核流水线-glm.md)：GLM 裁决方案（HLD+LLD，v1.0.0）
- [`2026-09-10-Driver-DualCritic主攻双审流水线设计-zcode.md`](./reference/2026-09-10-Driver-DualCritic主攻双审流水线设计-zcode.md)

**早期多模型答卷**
- [`2026-09-10-Claude-Code主攻双智能体审核流水线-dsv4flash.md`](./reference/2026-09-10-Claude-Code主攻双智能体审核流水线-dsv4flash.md)
- [`2026-09-10-Claude-Code主攻双智能体审核流水线-grok4.6.md`](./reference/2026-09-10-Claude-Code主攻双智能体审核流水线-grok4.6.md)
- [`2026-09-10-Claude-Code主攻双智能体审核流水线-qwen3.8-flash.md`](./reference/2026-09-10-Claude-Code主攻双智能体审核流水线-qwen3.8-flash.md)
- [`2026-09-10-Claude_Antigravity_ZCode_MultiAgent_Workflow-gemini.md`](./reference/2026-09-10-Claude_Antigravity_ZCode_MultiAgent_Workflow-gemini.md)
