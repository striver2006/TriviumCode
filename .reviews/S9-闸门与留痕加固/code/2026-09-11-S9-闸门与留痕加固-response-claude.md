---
schema: trivium.disposition.v1
topic: S9-闸门与留痕加固
stage: code
role: claude
kind: response
run_id: 20260911T063947Z
addresses:
  - 2026-09-11-S9-闸门与留痕加固-gemini.md
  - 2026-09-11-S9-闸门与留痕加固-glm.md
---

# 代码审应答：S9-闸门与留痕加固

## 0. 应答总览

14 条意见（gemini 6 + glm 8）：**接受 13、驳回 0、暂缓 1**。两侧均 `ok`，未降级。

最要紧的两条，一条是我这批改动**亲手埋的雷**，一条两侧独立命中同一处：

- **GLM-01（blocker）**：我把 `_meta/changes.diff` 登进了留痕保护集，但它是**不含
  run_id 的固定文件名**、走覆盖写。同主题第二次代码审一覆盖，上一轮记录的 sha256
  就永远对不上，`hook-pre-commit` **永久拦截且无法恢复**（原文件已不存在）。
  已用本次归档实测确认前提：`changes.diff` 确已登记且当前 sha256 匹配。
  这正是「护栏误伤正常工作」的形态——比不加护栏更糟。
- **AGY-01 ≡ GLM-02（major）**：我新加的外部锚 `task.json` 自己没有可信性校验。
  `readTask` 对缺失/损坏一律静默回落 `emptyTask`，于是**搅坏或删掉 task.json
  即可让锚①失去全部对象**。我修掉了「清单来自被核对对象自身」，却让新锚重蹈覆辙。

## 1. 逐条应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-01 | glm | blocker | 接受 | 实测确认前提成立：本次 run.json 已登记 `changes.diff`，而它是固定文件名 + `writeAtomic` 覆盖写。第二轮一覆盖即永久拦截、且不可恢复——我加的护栏会误伤正常工作 | `review.ts` 的补丁改为按轮次命名 `changes-<run_id>.diff` 并登记该名；`code-stage.ts`/brief 引用同步；保留 `changes.diff` 作为指向最新一轮的副本以兼容人读。补一条「同主题连跑两次 code 审后提交仍放行」的集成用例 |
| AGY-01 | gemini | major | 接受 | 与 GLM-02 同一处。锚本身不可信，整条加固就是空的 | 见 GLM-02 |
| GLM-02 | glm | major | 接受 | `readTask` 的静默回落对 `report` 是合理降级，对**留痕核对**是致命的——同一个函数被两种要求不同的调用方共用 | `meta.ts` 增加 `readTaskStrict`（区分「不存在」与「存在但不可读」）；`hooks.ts` 对「存在但不可读」按违例拦截；`report` 继续用宽松版并把损坏写进 notes |
| AGY-02 | gemini | major | 接受 | 成立。`allowMissing` 默认 true 对 `prepareRun`（首轮槽位本就是空的）正确，对 `releaseRunningGate` 错误——槽位不存在时它会凭空造出一条 idle 记录 | `releaseRunningGate` 与 `cancelRun` 的回收显式传 `allowMissing: false`；并补一条「槽位不存在时不得凭空创建闸门」的用例 |
| AGY-03 | gemini | minor | 接受 | 成立且是我手写 JSON 的后果：verify 的 run.json 自称 `trivium.run.v1` 却违反该 schema 的 `stage` 枚举与必填字段。**自称遵循某契约却不遵循，比不声明更糟** | 改用独立标识 `trivium.verify-run.v1`，或补齐 run.v1 必填字段并把 `verify` 加进 schema 的 stage 枚举——取前者：verify 不是审查运行，不该硬套审查运行的 schema |
| AGY-04 | gemini | minor | 接受 | 成立。`JSON.parse` 不认 C 风格八进制 `\NNN`。`core.quotePath=false` 让非 ASCII 不转义，但**路径同时含双引号与中文**时 git 仍会引起来并对中文用八进制——此时还原失败 | `unquoteGitPath` 自行解析 C 风格转义（`\NNN` 八进制、`\\`、`\"`、`\t\n\r`），不再借道 JSON.parse；补带中文+引号的用例（先实测确认 git 的真实输出形态再写） |
| AGY-05 | gemini | minor | 接受 | 与 GLM-03 同一处：`if (runId)` 让「推断不出 runId」整段跳过前置校验，等于留了个后门 | 推断不出 runId 时**拒绝**置闸门（退 65 并提示用 `--run-id` 指定），而不是跳过检查 |
| GLM-03 | glm | minor | 接受 | 补充了我遗漏的一半：跳过校验之后**仍用无条件 `setGate`**，与本批刚确立的「非覆盖场合一律条件迁移」不一致 | 与 AGY-05 同批；`--await-approval` 改用 `setGateChecked`，`expect` 为 `review_done_awaiting_disposition` 且 run_id 匹配 |
| AGY-06 | gemini | minor | 接受 | 成立。我只给 worker 路径加了回收，**同步路径 `runReview` 漏了**——它同样在 `prepareRun` 之后置了 running | `runReview` 包 try/finally，异常时调用同一个 `releaseRunningGate` |
| GLM-04 | glm | minor | 接受 | 成立且是「改写历史」：对已 `success` 的 run 执行 `--cancel`，会把 status.json 改成 cancelled。已完成的运行不该被追溯改写（P6） | `cancelRun` 先判终态：已是终态则只报告、不改写 status，也不动闸门 |
| GLM-05 | glm | minor | 接受 | 成立，我的只读化做了一半：`resolveTopicReadOnly` 只是不再建 `plan/`，`runVerify` 自己仍会为任意主题名建 `verify/` 与 `_meta/` | `cmdVerify` 在主题目录不存在时先退 65（与 `cmdReport` 一致），再进入 `runVerify` |
| GLM-06 | glm | minor | 接受 | 成立的真实缺口：SIGKILL 后的回收全是 push 式，没人再跑 `--wait` 就一直挂到 TTL | `hook-session-start` 增加一次扫描：发现 `running` 闸门但其 worker 已不存在（`processAlive` 判否）即就地回收，并以 `additionalContext` 告知 |
| GLM-07 | glm | nit | 接受 | **我的注释与我自己的测试自相矛盾**：注释说「含空格会被引起来」，而同批新增的用例明写空格路径不加引号、实测也是如此。错误注释比没注释更有害 | 按实测改写 `code-stage.ts` 与 `util/git.ts` 的注释：C 引用集是引号、反斜杠、控制字符与非 ASCII，**不含空格**；空格靠 ` b/` 分界 |
| GLM-08 | glm | nit | 暂缓 | 成立但危害低：`checkRunManifests` 只按 run_id 匹配、不校验 stage，把 run.json 跨阶段挪动仍能命中。**条件**：与 GLM-02 同批改（两者都在动 `checkRunManifests` 的匹配逻辑），若该批未能一次做完则单独提交 | `checkRunManifests` 的 `byId` 改为按 `run_id + stage` 双键匹配，不一致时报「清单位置不符」 |

## 2. 双方共同指出的问题

| 共识项 | glm | gemini |
| :--- | :--- | :--- |
| 外部锚 `task.json` 自身缺可信性校验，搅坏即整枝绕过 | GLM-02 (major) | AGY-01 (major) |
| `--await-approval` 的前置校验可因 runId 推断失败而整段跳过 | GLM-03 (minor) | AGY-05 (minor) |

两条都指向同一个模式：**我在堵一个洞时，新引入的机制自己没被同样的标准检查过。**
锚①用来防「清单被搅坏」，而锚①的清单自己被搅坏时无人过问；
前置校验用来防「跳过裁决」，而它自己有一条可跳过的分支。

## 3. 本轮未覆盖

- 两侧都**没有**核对本批新增的 31 条用例是否真的覆盖了它们所断言的行为，
  只看了实现代码。用例自身的有效性本轮无人复核。
- `hook-session-start` 的既有逻辑两侧都没读（GLM-06 的修改计划要动它）。
- 本批改动对**性能**的影响无人评估：`checkArchiveIntegrity` 现在每次提交都要
  遍历全部主题 + 跑一次 `git diff`，归档变大后的开销未测。
