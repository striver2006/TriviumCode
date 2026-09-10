# 多智能体协同审计与留痕目录 (.reviews)

本目录用于持久化记录 **“主攻 + 双审”（Driver-DualCritic）** 协同流水线在各阶段的过程资产与审计工件，实现全流程决策追溯与过程留痕。

---

## 一、开发计划审核留痕 (Plan Review Trail)

在功能开发前，围绕需求与计划展开多智能体推演与审查：

| 工件名称 | 产出主体 | 内容与职责 |
| :--- | :--- | :--- |
| `PLAN_RAW.md` | Claude Code (Driver) | 针对用户需求输出的原始实施方案与开发计划。 |
| `PLAN_REVIEW_AGY.md` | Antigravity (Critic A) | 针对原始方案的系统架构、依赖影响、全工程上下文推演报告。 |
| `PLAN_REVIEW_ZCODE.md` | ZCode (Critic B) | 针对原始方案的业务边界条件、异常防御、本土栈兼容性审查报告。 |
| `PLAN_REVISED.md` | Claude Code (Driver) | 吸收双专家意见后输出的最终修订版实施计划，作为最终编码基准。 |

---

## 二、代码与补丁审核留痕 (Code Review Trail)

在代码编写完成后，围绕代码变更展开双审校验与修改应答：

| 工件名称 | 产出主体 | 内容与职责 |
| :--- | :--- | :--- |
| `DIFF.patch` | Claude Code (Driver) | 实际编码完成后的标准 Git 补丁文件。 |
| `CODE_REVIEW_AGY.md` | Antigravity (Critic A) | 针对代码补丁的代码质量、性能指标、并发隐患等深度审查报告。 |
| `CODE_REVIEW_ZCODE.md` | ZCode (Critic B) | 针对代码补丁的规范性、业务防御、空指针与异常分支审查报告。 |
| `REVIEW_RESPONSE.md` | Claude Code (Driver) | 对双审意见的逐项应答记录（**明确接受/拒绝原因**及后续修改方案）。 |

---

## 三、归档说明
当单次迭代任务交付验收完成后，可将当期 `.reviews/` 内的工件打包归档至 `doc/08_project/` 或附带迭代版本后缀，以便长期追溯与复盘。
