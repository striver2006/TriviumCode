# 预算与授权记录（budget.md）

## 授权声明

- **授权人**：Bob（用户，经本会话于 2026-10-29 21:15 左右明确指示）
- **授权原文**：「所有涉及LLM调用预算的，都按需要多少就授权多少来决策」
- **授权范围**：本计划（PLAN_Windows四家Agent真机与客户端验收任务.md）中全部真实 LLM 调用，
  含 W2 四家真实 doctor / 认证预检 / 四个单侧 B 审查、W3 原生客户端入口、W4 多审与取消、
  W5 A/C/D 扩展，以及失败后按计划允许的复跑与安全控制实验（W4-S 系列）。
- **金额上限**：未设固定金额上限，按实际需要执行。
- **Driver 会话费用**：包含（ZCode 桌面会话即 Driver 之一，其余三家 Driver 会话费用亦属授权范围）。
- **时间窗口**：2026-10-29 起，至本批验收任务关闭。

## 边界（与计划一致，不因预算放开而改变）

- 单侧 B 一律 `--max-rounds 1`；禁止自动加轮、切换备用 profile、换模型求通过。
- doctor 总时限 600 秒（30～900 允许范围之内取计划建议值）。
- 人工审批停点（approve / reject / abandon）**不**因本预算授权而自动执行，仍等待 Bob 逐停点决定；
  本预算只覆盖「调用的钱」，不覆盖「对审查结论的审批权」。
- 凭据泄露、只读失守、意外修改真实项目、路线回退、进程失控时仍按计划 §2.3 立即停止。

## 实际消耗登记

> 作业数 / 审核者侧次 ≠ API 请求次数。逐项按实际客户端 usage 或账单登记；无法核实填 unknown，不填 0。

| 时间（+08） | 项目 | Agent | 作业/侧次 | API 请求（若可知） | 实际费用/usage | 凭证 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 21:22 | 30-doctor-codex（探活+负对照） | codex | 1 作业 | unknown | unknown | 30-doctor-codex.* |
| 21:25/21:31 | 31/31b-doctor-claude（两轮） | claude | 2 作业 | unknown | unknown | 31/31b-doctor-claude.* |
| 21:29 | 32-doctor-zcode | glm | 1 作业 | unknown（探针 turn 1 次） | unknown | 32-doctor-zcode.* |
| 21:30 | 33-doctor-agy | gemini | 1 作业 | unknown | unknown | 33-doctor-agy.* |
| 21:37 | 40-B2 doctor-agy | gemini | 1 作业 | unknown | unknown | 40-B2-doctor-agy.* |
| 21:38 | 42-B3 doctor-zcode | glm | 1 作业 | unknown | unknown | 42-B3-doctor-zcode.* |
| 21:39 | 43-B1 doctor-claude | claude | 1 作业 | unknown | unknown | 43-B1-doctor-claude.* |
| 21:39 | 44-B4 doctor-codex（blocker 复现） | codex | 1 作业 | unknown | unknown | 44-B4-doctor-codex.* |
| 21:42 | 47-B1 doctor-claude rerun2 | claude | 1 作业 | unknown | unknown | 47-B1-doctor-claude-rerun2.* |
| 21:49–21:52 | **B2 全程**：claude Driver 会话（原稿+发起+等待+转述）+ gemini 审查 turn（84s，空响应） | claude + gemini | Driver 1 会话 + 审核者 1 侧次 | gemini 1 turn（init 事件实测） | unknown | 41-B2-claude-driver.log + run 20261029T135042Z |
| 21:57–21:58 | **B3 全程**：agy Driver 会话（原稿+预检停） | gemini | Driver 1 会话 | unknown | unknown | 45-B3-agy-driver.log |
| 21:59–22:02 | **B1 全程**：codex Driver 会话（原稿+预检+自动校准 1 轮 doctor(38 次拉起)+预检+停） | codex + claude | Driver 1 会话 + 校准 doctor 1 作业 | unknown | **codex 会话 29,434 tokens**（会话自报） | 46-B1-codex-driver.log |
| 21:56–22:04 | **B4 全程**：ZCode 桌面会话（本会话；认领/原稿/resolve/preflight×2） | glm | Driver 1 会话 | preflight 无模型调用 | 本会话消耗（无法单独核账，unknown） | B4 夹具工件 + 本批日志 |
| 21:53 | agy -p trivium-critic 手动复现（诊断） | gemini | 1 次 | 1 turn | unknown | 复现记录（会话） |
| 21:44/22:06 | claude -p 手动复现 ×2（诊断） | claude | 2 次 | 2 turn | unknown | 复现记录（会话） |
| 21:17 | B1 首发参数错误 ×2（--full-auto 不识别 / 旗标互斥，**未起模型**） | — | 0 | 0 | 0 | 46-B1-codex-driver.log 覆盖前记录 |

合计：**doctor 类 10 作业**（codex 2 / claude 4 / zcode 2 / agy 2）、**Driver 会话 4**（每家 1）、
**审核者侧次 1**（B2 gemini，唯一真实启动的审查 turn）、诊断复现 3 次、参数失败未起模型 2 次。
按基础批次预排（≤12 审核者侧次）计：实际用 1/12。费用总额无法从本机账单核实，全项如实填 unknown；
已知 usage 仅 codex Driver 会话 29,434 tokens。
