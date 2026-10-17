---
schema: trivium.disposition.v1
topic: M12-审查期误判两则
stage: plan
role: claude
kind: revised
run_id: 20261017T042520Z
addresses:
  - 2026-10-17-M12-审查期误判两则-gemini.md
  - 2026-10-17-M12-审查期误判两则-glm.md
---

# 裁决：M12-审查期误判两则 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-17-M12-审查期误判两则-claude.md`（r1，起点 `02f9c0e1`）
> 两侧：gemini `request-changes`（2 major、1 nit），glm `approve-with-nits`（3 minor、1 nit）。7 条全部接受，合入后的计划见 `plan/2026-10-17-M12-审查期误判两则-r2-claude.md`。
> 裁决前回代码核了两处：`AgyStreamResult.conversationId` 存在（`adapters/agy-events.ts:33`）；`VOIDING_DENY_CATEGORIES` 在 `gate.ts` 只有 `:11` 导入与 `:1435` 一处使用。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| AGY-01 | gemini | major | 接受 | 属实：r1 超时档只凭 `timedOut` 就以「模型侧响应慢、可稍后重试」打头，无法区分「turn 已在进行、模型慢」与「零交互静默挂起」（后者可能是在等交互登录）。Z1 样本同时有 `status=SUCCESS` 与 print timeout，正是可用的区分特征。建议①扩充认证正则（login、auth、keychain 等）**只部分采纳**：仓库里只有 `Please sign in` 一条原始样本，按「解析厂商 CLI 输出的样本必须取原始输出」的既有纪律，不凭猜测加词——`auth` 一类宽词还会误伤正常 stderr；未识别特征的未登录由下面的分层兜住 | r2 §2.3：超时档细分两层——有交互证据（`printTimeoutWarned`、`parsed.status === 'SUCCESS'`、`parsed.conversationId` 非空，任一）⇒「模型侧响应慢，可稍后重试」；无任何交互证据的静默超时 ⇒ 以「可能在等交互登录，请交互运行一次 agy 确认」打头，其次才是「也可能是网络或服务端无响应」；认证正则维持 `/please sign in/i` 并写明理由；r2 §4 单测补「静默超时」与「有交互的超时」各一格 |
| AGY-02 | gemini | major | 接受 | 属实两点：①`guard.ts:403` 的 `typed` 是 `DenyCategory[]`（裸字符串），把它传给收对象数组的 `hitsVoid` 类型不符；②r1 只让守卫逐条命令改调 `hitsVoid`，侧级 `peerArtifactRead`（`:485`）仍按本地数组长度独立派生，与闸门不是同一个函数 | r2 §2.1：谓词分三层——`categoriesVoid(cats: readonly DenyCategory[])`（`guard.ts:416` 逐条命令用）、`hitsVoid(hits)` = `categoriesVoid(hits.map(h => h.category))`、`leakRecordVoids(rec)`（侧级）；守卫的 `peerArtifactRead` 改为用与 run.json 同形的记录（`{ path: { hits: typedHits }, command: { hit, hits: typedCommandHits } }`）调 `leakRecordVoids`，闸门调同一个函数，两处侧级判定字面上是同一次调用 |
| AGY-03 | gemini | nit | 接受 | 属实：改调后 `VOIDING_DENY_CATEGORIES` 在 `gate.ts` 再无引用，`tsc` 的未用导入检查会报 | r2 §3 改动表 `gate.ts` 一行补「从 `:11` 的导入里去掉 `VOIDING_DENY_CATEGORIES`」 |
| GLM-01 | glm | minor | 接受 | 属实：r1 写「取不到特征的未登录落到其他档」，但挂起到外层超时的那种落的是超时档，归属写窄了；照抄进主设计会是错误口径 | r2 §2.3「样本口径的已知局限」改为：取不到特征的未登录，快速失败落其他档、挂起到超时落超时档的「无交互证据」一层，两处文案都以登录指引打头或包含登录指引；r2 §6 主设计 12.1 按此口径写 |
| GLM-02 | glm | minor | 接受 | 属实：上位计划 §4.2 写的是「`timedOut` 或 `printTimeoutWarned`」，r1 无声明地收窄成只看 `timedOut`；内层 print timeout 触发后 agy 在外层超时前自行退出、status 非 SUCCESS 的角落会落到「其他档」，丢掉更可操作的指引 | r2 §2.3：超时档触发条件恢复为 `timedOut || printTimeoutWarned`（仍排在认证档之后）；`printTimeoutWarned` 同时算交互证据（AGY-01 的分层）；r2 §4 单测补「print timeout、未外层超时、status 非 SUCCESS」一格 |
| GLM-03 | glm | minor | 接受 | 属实：`ok = SUCCESS && !timedOut` 不变，则「内层 print timeout、120 s 内带部分输出退出、status 仍为 SUCCESS」时 ok 为真、探活判通过；r1「不把打印超时但有部分输出当作已认证」与之矛盾。这一角落是现行行为：status=SUCCESS 说明服务端已开始回应，按现状接受，本批不改 ok | r2 §2.3 把那句改为不做项「不因打印超时而改动 ok 的判定」，并如实写明上述角落现状判通过、本批接受；r2 §6 主设计 12.1 不写入「部分输出不算已认证」 |
| GLM-04 | glm | nit | 接受 | 属实：`gate.test.ts:1052` 用例 ③ 的行内理由「该通道没有类别信息，命中即算」修完后不再成立，留着会与闸门新注释矛盾 | r2 §4：用例 ③ 断言不变，行内注释改为「旧记录没有 hits，回退 hit 口径（旧口径）」 |

## 无修改及原因

无：7 条均接受并已写入 r2。
