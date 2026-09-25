# glm 第二轮薄冒烟 · 第二段读数（2026-09-25，ZCode 桌面端，用户操作）

- **前提**：工作区已在第一段信任过；关掉第一段会话，在同一夹具**新建**会话（清单 B1～B7）

| 步 | 读数（会话原文，由用户贴回） | 判断 |
| :-- | :--- | :--- |
| B1 `SessionStart` 复测 | 「有。会话开始时我收到了一段 SessionStart hook 注入的附加上下文（与 AGENTS.md 无关），原样如下：`#1` / `TriviumCode 待办：` / `  · 冒烟二轮/plan 审查已落盘但裁决未齐备`」；另报技能清单里登记了七个入口 skill | **✓ 生效**。第一段未注入的成因确认为**时序**：那个会话第一轮开始（14:53:33）早于信任授予（14:53:40～44），信任前 Hook 不跑。ZCode 接受 Claude Code 形态的 `hookSpecificOutput.additionalContext` 输出，不需要改代码 |
| B1 之后的 `Stop` | 会话答完收工时再次收到「`#1` 还有未逐条裁决的审查意见：冒烟二轮/plan」；这次按用户「回答完就停」的指令**没有自行去补裁决**，说明原因后停住 | **✓ 生效**，每次收工拦一次、无死循环。会话建议的出口里有一句「用 dual-approve 审批关闭」不准确（闸门在待裁决态时 approve 会被拒）——那是模型自己的解释，不是编排器文案，不作缺陷登记 |
| B2 写裁决件 | 「已写入：`2026-09-25-冒烟二轮-revised-glm.md`，内容与你给的代码块一致，未被 Hook 拦截。按指令到此停住。」；会话未报收工被 Stop 拦 | **✓**：Driver 自己后缀的裁决件经结构化写工具写入不拦；裁决件在场后 `Stop` 不再拦收工 |
| B3 `gate --check` | 「✓ 裁决完整性校验通过（3 条裁决，含 0 条降级编号）」+ `⚠️ [joint_blocker_rejected] … CODEX-01+AGY-01@src/stub.ts:10`（共同 blocker 被驳回，按配置只告警、记为 disputed）；随后「裁决齐备，已置为等待人工审批：冒烟二轮 / plan（第 1 轮）」，末句「在此期间不得修改业务文件——本载体的 Hook 只作尽力拦截、不兜底（L2），靠你自觉；越界不会被事前拦下，会在审批前复核与跑后漂移复算时暴露。」 | **✓**：`--check` 自动置等待审批那一句已按当轮 Driver（glm，L2 尽力拦截）措辞（第 3 步 §2.1） |
| B3 `gate --await-approval` | 「通过：`/dual-approve --topic 冒烟二轮 --stage plan [--reason <附言>]`」「拒绝：`/dual-approve … --reject --reason <理由>`」「放弃：`/dual-abandon --topic 冒烟二轮`」，末句同上（L2 尽力拦截档），不含「Hook 会拦下」 | **✓**：第 2 步薄冒烟核出的「对 glm 说 Hook 会拦下」已修正；调用写法按注册表 `entryInvocation`（glm 为 `/名字`） |
| B4 伪造审查员后缀 | Write `.reviews/冒烟二轮/plan/2026-09-26-冒烟二轮-codex.md` **被拒**：「禁止写入 2026-09-26-冒烟二轮-codex.md：审查文档只能由编排器从审查员的结构化输出渲染落盘。主脑不得自行产出归档根内的审查员后缀文件（PRD 6.3 / 设计 §10.4）。 本轮 Driver 判定为「glm」（取自该阶段最近一份运行留痕），其余已登记角色的后缀均受保护。 …」；文件未创建 | **✓**：ZCode 渲染的 `PreToolUse`（matcher `Edit\|Write`）→ `gate hook-pre-write` 生效；当轮 Driver 按运行留痕判为 glm，保护集为除 glm 外的全部角色 |
| B5 闸门期改业务文件 | Edit `src/app.ts` **被拒**：「主题「冒烟二轮」的 plan 阶段闸门未审批，此时不得修改业务文件。 通过审批：/dual-approve --topic 冒烟二轮 --stage plan 拒绝： /dual-approve --topic 冒烟二轮 --stage plan --reject --reason <理由> 放弃闸门：/dual-abandon --topic 冒烟二轮」；文件未改动 | **✓**：闸门写锁在 ZCode 上生效；拒绝文案的调用写法按闸门记下的 Driver（glm）派生（第 3 步 §2.1 Hook 三处之一） |
| B6 收工 | 会话总结收尾状态后结束，未报 Stop 拦截 | **✓**：闸门在等待审批、裁决齐备时 `Stop` 放行 |

## 机读核对

- 会话留痕摘录 `04-rollout-excerpt.json`（`extract.mjs` 生成，只收用户消息、Hook 反馈片段与工具结果里的 Hook 拒绝原文）：
  第二段首条请求的最后一条 system 消息含「SessionStart hook additional context: #1 TriviumCode 待办：· 冒烟二轮/plan 审查已落盘但裁决未齐备」；第一段首条请求**没有**这一段——与「第一段早于信任」的时序判断一致；
  B3 / B4 / B5 的 CLI 输出与 Hook 拒绝原文与用户贴回的逐字相同。
- 夹具最终状态（会话结束后只读核）：`src/app.ts` 未改动（`git diff` 为空）；`2026-09-26-冒烟二轮-codex.md` 不存在；`…-revised-glm.md` 在场；`trivium status`：`plan: awaiting_approval`，⚠️ 有争议项（共同 blocker 被驳回，按配置只告警）。

## 结论

第 3 步渲染的 `.zcode/config.json` 五个 Hook 在 ZCode 桌面端**全部按设计生效**：`SessionStart` 注入、`Stop` 收工拦截（每次一次、无死循环、裁决齐备后放行）、`PreToolUse` 写入拦截（审查员后缀）与闸门写锁（业务文件），停点话术与 Hook 文案的调用写法与护栏档位也都按当轮 Driver（glm）措辞。**不需要改代码。**

新登记一条**时序边界**，写进第 5 步文档与第 4 步 glm 轮操作卡：**工作区信任要在会话开始之前完成**——ZCode 的信任提示可能在第一个会话开始之后才弹出，那个会话的 `SessionStart` 不跑（信任前 Hook 不跑，第 1 步报告 §3.1.1 已测的同一形态）。操作卡写法：先打开夹具、点完信任，再新建会话。

清单第一段的一处误判如实记：闸门处在待裁决时，**每一次**收工都会触发 `Stop`，不只是清单第 5 步。
