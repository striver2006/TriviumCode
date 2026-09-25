# glm 第二轮薄冒烟 · 逐步清单（用户在 ZCode 桌面端操作）

> **目的**：验证 M10b 第 3 步渲染出的 `.zcode/config.json` 在真载体上的行为——信任、写入拦截、`Stop`、`SessionStart`、停点话术。
> 这是第 4 步 glm 轮（J4，不可降级）之前的去风险；**不耗审查配额**（夹具里的审查是桩跑的）。
> **夹具**：`/private/var/folders/b_/9c_2y9gx4bx9hg3chvdwmdl00000gn/T/m10b-smoke2-FSFhzT`（搭建读数 `01-setup-readout.json`）
> **起始状态**：主题 `冒烟二轮`，plan 阶段闸门 `review_done_awaiting_disposition`（审查已落盘、裁决未写）；原稿 glm 后缀；
> 桩审查件 codex（CODEX-01 blocker、CODEX-02 minor）、gemini（AGY-01 blocker），run `20260925T142741Z`。

每步照做、把**实际看到的**记下来（原文贴回来最好，截图也行）。不符合期望时**不要重试、不要让会话自己修**，直接记下来继续下一步。

## 步骤

| # | 你做什么 | 期望 | 记录什么 |
| :-- | :--- | :--- | :--- |
| 1 | ZCode 桌面端打开上面的夹具目录 | 弹出工作区 Hook 的信任提示 | 有没有弹；提示原文（能截就截） |
| 2 | 点**信任** | — | 点击时间（大概即可） |
| 3 | 新建一个会话。先**只发一句**：「本轮不要使用子代理（Agent 工具），所有操作由你直接执行。你这次会话开始时有没有收到 TriviumCode 的提示？有的话原样贴出来。」 | 会话报告收到一段待办提示，提到 `冒烟二轮/plan` 审查已落盘、裁决未齐备（`SessionStart` 注入） | 会话贴出的原文；没收到也如实记 |
| 4 | 发：「用 Write 工具新建文件 `.reviews/冒烟二轮/plan/2026-09-26-冒烟二轮-codex.md`，内容写一行 test。」 | **被 Hook 拒**：文案说该后缀是受保护的审查员角色件、当轮 Driver 是 glm | 拒绝原文；若写成了，记「未拦」 |
| 5 | 发：「只回答 1+1 等于几，然后结束本轮。」 | 会话收尾时被 `Stop` 拦**一次**，理由是裁决未完成（缺 `…-revised-glm.md`）；**不应反复拦成死循环** | 拦了几次、原文；会话最后是否正常停下 |
| 6 | 发下面「附：裁决件」整段，让会话用 **Write** 写到 `.reviews/冒烟二轮/plan/2026-09-25-冒烟二轮-revised-glm.md` | 写成（自己后缀的裁决件，不拦） | 写没写成 |
| 7 | 发：「运行 `.trivium/bin/trivium gate --stage plan --topic 冒烟二轮 --check`，再运行 `.trivium/bin/trivium gate --stage plan --topic 冒烟二轮 --await-approval`，把两条输出原样贴出来。」 | `--check` 通过；`--await-approval` 的话术：调用写法是 `/dual-approve`，最后一句是「在此期间不得修改业务文件——本载体的 Hook 只作尽力拦截、不兜底（L2），靠你自觉；……」，**不是**「Hook 会拦下」 | 两条输出原文 |
| 8 | 发：「用 Edit 工具在 `src/app.ts` 末尾加一行注释 `// smoke`。」 | **被 Hook 拒**（闸门期禁写业务文件），拒绝文案里的出口是 `/dual-approve --topic 冒烟二轮 --stage plan` | 拒绝原文；若改成了，记「未拦」 |
| 9 | 发：「好，结束。」 | 这时裁决已齐备，`Stop` 不再拦 | 是否正常结束 |
| 10 | 告诉我「冒烟二轮做完了」 | 我去收会话留痕与夹具状态 | — |

**不要**在这个会话里跑 `review --start`、`preflight`、`doctor`（会调真实模型或探活）。整个过程只用这一个会话；中途不要切去别的 ZCode 会话。

## 第二段（第一段读数见 `02-readout-part1.md`；按它重排）

第一段核出两件事：①闸门处在待裁决时，**每一次**收工都会触发 `Stop`（已测到，生效）；②`SessionStart` 没注入，很可能是信任提示在第一轮开始之后才出现。
第二段在**已信任**的状态下复测 `SessionStart`，并先写裁决件让 `Stop` 安静下来，再测其余几项。

| # | 你做什么 | 期望 | 记录什么 |
| :-- | :--- | :--- | :--- |
| B1 | **关掉**第一段那个会话，在同一夹具里**新建一个会话**（不要续用旧会话）。第一句只发：「本轮不要使用子代理（Agent 工具），所有操作由你直接执行。你这次会话开始时有没有收到 TriviumCode 的提示（不算 AGENTS.md 那段）？有的话原样贴出来。回答完就停，不要做别的。」 | 会话贴出一段 TriviumCode 待办，提到 `冒烟二轮/plan` 等待裁决。答完收工时 `Stop` 会再拦一次，会话可能又开始去裁决——**看到它开始查文件就直接停止**，属正常 | 会话贴出的原文；没收到也如实记 |
| B2 | 发下面「附：裁决件」整段，并说：「用 Write 工具原样写到 `.reviews/冒烟二轮/plan/2026-09-25-冒烟二轮-revised-glm.md`，写完就停，不要读别的文件、不要做别的。」 | 写成 | 写没写成 |
| B3 | 发：「运行 `.trivium/bin/trivium gate --stage plan --topic 冒烟二轮 --check`，再运行 `.trivium/bin/trivium gate --stage plan --topic 冒烟二轮 --await-approval`，把两条输出原样贴出来，然后停。」 | `--check` 通过；`--await-approval` 话术里调用写法是 `/dual-approve`，最后一句是「在此期间不得修改业务文件——本载体的 Hook 只作尽力拦截、不兜底（L2），靠你自觉；……」 | 两条输出原文 |
| B4 | 发：「用 Write 工具新建文件 `.reviews/冒烟二轮/plan/2026-09-26-冒烟二轮-codex.md`，内容写一行 test。被拒就把拒绝原文贴出来，不要换别的办法重试。」 | **被 Hook 拒**，文案说这是受保护的审查员角色件（当轮 Driver 是 glm） | 拒绝原文；若写成了，记「未拦」 |
| B5 | 发：「用 Edit 工具在 `src/app.ts` 末尾加一行注释 `// smoke`。被拒就把拒绝原文贴出来，不要换别的办法重试。」 | **被 Hook 拒**（等待审批期间不得改业务文件），出口写 `/dual-approve --topic 冒烟二轮 --stage plan` | 拒绝原文；若改成了，记「未拦」 |
| B6 | 发：「好，结束。」 | 裁决已齐备，`Stop` 不再拦，会话正常结束 | 是否正常结束 |
| B7 | 回来告诉我「冒烟二轮第二段做完了」，贴 B1～B6 看到的原文 | — | — |

## 附：裁决件（第 6 步整段发给会话）

```markdown
---
schema: trivium.disposition.v1
topic: 冒烟二轮
stage: plan
role: glm
kind: revised
run_id: 20260925T142741Z
addresses:
  - CODEX-01
  - CODEX-02
  - AGY-01
---

# 冒烟二轮 · 裁决（夹具，桩审查）

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | blocker | 驳回 | 夹具桩意见，冒烟不改计划 | 无修改 |
| CODEX-02 | codex | minor | 驳回 | 夹具桩意见，冒烟不改计划 | 无修改 |
| AGY-01 | gemini | blocker | 驳回 | 夹具桩意见，冒烟不改计划 | 无修改 |
```

## 我收尾时收什么

- ZCode 会话留痕：本会话的 `model-io-sess_<id>.jsonl` 与同时段 `model-io-sess_subagent_*`（应为空），只摘工具调用、用户消息、Hook 相关的系统消息与每条请求的 `model`；
- 夹具的 `.trivium/state.json`、闸门与锁状态、`.reviews/冒烟二轮/`、`git status`；
- 结论写进第 3 步报告附录，不符合期望的逐条登记并判断是否要修（修了走代码双审）。
