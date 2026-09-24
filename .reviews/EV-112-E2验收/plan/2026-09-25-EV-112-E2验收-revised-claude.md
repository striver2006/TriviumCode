---
schema: trivium.disposition.v1
topic: EV-112-E2验收
stage: plan
role: claude
kind: revised
run_id: 20260924T172304Z
addresses:
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
  - GLM-07
  - GLM-08
---

# 裁决：EV-112 E2 验收载体稿 · 单侧 glm

> 被审对象：`2026-09-25-EV-112-E2验收-claude.md`（EV-112 E2 真实配额验收的载体稿）
> ｜ 运行：`20260924T172304Z`（16m42s，**单侧 glm**，不构成多审）
> ｜ 结论：glm `request-changes` ｜ 共 8 条：重要 2 ｜ 次要 6
> ｜ **全部接受**

## 0. 本轮的形状

这一轮的目的不是审这份载体稿，而是让 glm 在无副本一支里完整跑一次真实审查，验收 EV-112 的产物落点（计划 r3 §6.3 E2）。
glm 的 8 条意见都在说载体稿的判据不够全、操作没写失败路径。**审查运行已经跑完**，所以接受的意见不再出 r2：
判据类意见全部以**事后只读补核**落实，写进 `doc/05_testing/evidence/ev112-acceptance-20260925/e2-check.mjs` 的补核格与 `02-e2-readout.md` 的判据表；
操作类意见在读数件里如实登记本轮的做法与缺口。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-01 | glm | major | 接受 | 属实。memories 随存储根落位、没有专键，落点自检不覆盖，载体稿的正查与反查都漏了它，而它恰是本轮要升为实测的一格 | `e2-check.mjs` 补两格：运行目录 `memories/projects` 正查（有 `triviumcode-2217d5056b753581`）、真实 HOME `memories/projects` 下运行窗口内有无改动（无）。读数件判据表第 5、8 格。sessions 同样补进正反查，本轮未产生，读数件第 6 格如实写 |
| GLM-02 | glm | major | 接受 | 属实。载体稿只有「跑完立即挪回」一句意图，没有失败出口与复原判据。本轮挪开前**没有记哈希**，这一缺口无法事后补 | 读数件判据表第 11 格：复原依据如实写为「只改名」加大小（1140 字节）与修改时间（2026-09-20T11:12:00Z）不变、无 `.ev112-e2` 残留，并注明未记哈希。以后同类操作先记哈希、布好复原命令再挪开 |
| GLM-03 | glm | minor | 接受 | 属实。`model_route: global` 还有限定失败一因，进入成因应直接落进证据，不靠两条判据组合反推 | `e2-check.mjs` 读 trace `modelSelection.reason`：「未找到 …/.zcode/cli/config.json，无法做模型覆盖；将沿用 ZCode CLI 的全局默认」。读数件判据表第 1 格 |
| GLM-04 | glm | minor | 接受 | 属实。db 只核存在性说明不了会话库落进了运行目录 | `e2-check.mjs` 在运行目录 `db.sqlite` 里按内容计本次 sessionId：576 次。读数件判据表第 5 格 |
| GLM-05 | glm | minor | 接受 | 属实。个人 provider 配置在是无副本支能跑起来、并消耗真实配额的前提，载体稿没声明 | `e2-check.mjs` 只核存在性（在）。读数件判据表第 10 格，并写明它是这一支的配额通道 |
| GLM-06 | glm | minor | 接受 | 属实，而且本轮正好踩中：我是**挪开之后**才跑预检的，指纹变化触发了一次真实探活，探活在真实 HOME 下跑、不设落点，于是真实 `~/.zcode/cli/log` 在窗口内有 1 个文件改过 | 读数件「关于第 8 格」一节写明这一时序与判定口径（按本次 sessionId 内容命中，那个文件里没有本次会话），并写明以后先预检、再挪开 |
| GLM-07 | glm | minor | 接受 | 属实。载体稿静默少了 r3 E2 的 scrub.json 一格 | `e2-check.mjs` 读 `glm/scrub.json`：`ok`、`complete`、无错误，`logs_redacted` 为空。读数件判据表第 9 格写明「按字面『记了脱敏』不成立：本轮无凭据形态可记，不是没扫」 |
| GLM-08 | glm | minor | 接受 | 属实。「走到工具调用」是 artifacts / sessions / memories 各格生效的前提，要有直接读数 | `e2-check.mjs` 计工具调用：27 次（read 15、grep 11、glob 1），`project_reads` 13，`evidence_ok: true`。读数件判据表第 4 格 |

## 2. 其它登记

- **artifacts 与 workflow 本轮未产生**：27 次工具调用都是短读取，运行目录与真实 HOME 下都没有 `artifacts/`、`sessions/`；推测 artifacts 只收超长工具结果，未核。这两格仍只有静态读数与假入口用例支撑，读数件如实写。
- **附带观测**：无副本一支的 glm 侧实际跑的是个人配置默认模型 `qwen3.8-max`，守卫不出声。登记 BACKLOG EV-122，处置由用户定。
- **成因更正**：计划 r3 写的「未指定模型」一因在流水线里走不到（`review.ts` 派发前即拒空模型）。设计、RUNBOOK、BACKLOG 已更正。
- 本轮单侧 glm、配置意图如此，编排器已声明不构成多审；不计入 M10b 轮次阈值（r7 §4）。
