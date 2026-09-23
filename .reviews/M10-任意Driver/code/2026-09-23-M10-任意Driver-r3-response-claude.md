---
schema: trivium.disposition.v1
topic: M10-任意Driver
stage: code
role: claude
kind: response
run_id: 20260923T063434Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - AGY-01
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
---

# 应答：M10a 第 2 步（EV-55 跨时间面重写）代码双审 第 3 轮

> 被审对象：相对 `e1a0d9a` 的 15 个文件变更，补丁 98.2 KB ｜ 运行 `20260923T063434Z`
> ｜ 三侧均结构化产出 ｜ 结论：codex `request-changes`，gemini、glm `approve-with-nits`
> ｜ 共 10 条：重要 1 ｜ 次要 5 ｜ 吹毛求疵 4 ｜ 零阻断

## 总述

10 条全部接受。三侧对焦点一、三、五的核对都给了正面结论（选项前缀与提交识别共用一份集合、
abandon 不动已登记工件、两处接线与早退路径成立），本轮的问题集中在两处：

1. **running 态 run.json 的改写窗口（CODEX-01 ≡ GLM-01，外加 GLM-02 的崩溃窗口）**：
   删掉后缀支后，审查文档与原稿的不可变性只剩锚②，而锚②的期望值（run.json 的
   `artifacts[]`）在「已提交版本为 running」时可以被**任意**改写。我在 gate-loop 注释里写的
   「攻击链必须改锚，改锚必被拦」是把带例外的判据写成了确定性保证——**正是第 2 轮
   CODEX-01 那个阻断的同族错误，我在修它的同一轮里又犯了一次**。
   修法取 GLM-01 给的最小约束：running 例外收窄为「同一 run_id、可解析、HEAD 里已登记的
   `artifacts[]` 条目逐条保留且 sha256 不变（只许追加）」。这样既放行正常收尾，又堵住
   「改写 / 删除已登记条目」。**剩余边界如实登记，不再写成确定性保证**：
   收尾时新追加的条目（审查文档、原稿）在追加那一刻仍可被同步改写——那段窗口由写侧
   （Write/Edit 精确拦、Bash 启发式拦）承担；GLM-02 的崩溃窗口（已落盘未登记）同属此类。
2. **扫描判据的语句组比裁决件承诺的窄（CODEX-02 ≡ AGY-01 ≡ GLM-03）**：
   裁决件写了「同一模板串或同一 `[...].join` / `+` 拼接组」，实现只认行尾 `+`。
   三侧独立命中，补齐另两种组形态。

另有两条一行级对齐：审查文档登记改用写入时的冻结哈希（CODEX-04，与原稿、`_meta` 同口径）；
`--await-approval` 成功路径也显示运行期告警（CODEX-03 ≡ GLM-04）；`--shallow-file` 补进
取值型选项集（GLM-05）。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 属实：run-*.json 分支只看 HEAD 的 status，改写内容零校验；「中途提交 → 同一次提交里改审查文档 + 改登记 sha」的链条能自洽通过。gate-loop 注释把它写成「改锚必被拦」，与第 2 轮阻断同族，必须改。收窄 running 例外即可封住「改写 / 删除已登记条目」，不影响正常收尾 | ① `src/trivium/hooks.ts` `immutableChangeReason` 的 running 例外改为：工作树版本可解析、`run_id` 与 HEAD 相同，且 HEAD 里的每条 `artifacts[]`（path + sha256）都原样保留在工作树版本中（只许追加），否则按不可变拦下，报错说明是哪条被删或被改；② `test/unit/hooks.test.ts` 补三格：running 收尾追加条目 ⇒ 放行；running 版本里改已登记条目的 sha ⇒ 拦；删已登记条目 ⇒ 拦；另补一条改 run_id ⇒ 拦；③ `test/integration/gate-loop.test.ts` 注释改为有条件的表述，写明收尾追加那一刻的剩余窗口由写侧承担；④ BACKLOG EV-55 登记剩余边界 |
| CODEX-02 | codex | minor | 接受 | 属实：`groupAround` 只认行尾 `+`，与第 2 轮裁决件承诺的三种组形态不符；数组 join 与跨行模板串会把正确文案判红，并给出误导性报错 | `test/contract/bash-recovery-wording.test.ts`：语句组补两种形态——命中点落在跨行模板串内，则整个模板串为一组（剥注释时顺带记录模板串的字符跨度）；命中行处于跨行数组字面量内，则从 `[` 到对应的 `]` 为一组。补两格用例（数组 join、跨行模板串，提示在另一行时判合规）；同一组里没有「终端」时仍须报出 |
| CODEX-03 | codex | nit | 接受 | 属实：`--await-approval` 只在失败分支渲染告警，成功路径（含 `--json`）丢弃 `run_warning`，而审批停点正是最该看见「原稿不在保护集」的地方 | `src/trivium/cli.ts` `--await-approval` 分支：成功路径的人读输出逐条打印 warnings，`--json` 输出加 `warnings` 字段；`test/integration/fault-injection.test.ts` 归档外用例补一条 `--await-approval --json` 的断言（需先补裁决件） |
| CODEX-04 | codex | minor | 接受 | 属实：审查文档是四处同族里唯一在收尾时重新读盘算哈希的；`writeArtifact` 已返回写入时的 sha256，取用零成本；本轮为原稿定的冻结值口径（GLM-03）同样适用 | `src/trivium/review.ts`：审查文档改为收集 `{ path, sha256: written.sha256 }`，收尾合并时直接用，不再 `sha256File` 重算；fault-injection 用例补断言：审查文档的登记哈希等于写入时的哈希 |
| AGY-01 | gemini | nit | 接受 | 与 CODEX-02 同一问题（语句组只认 `+` 拼接） | 同 CODEX-02 |
| GLM-01 | glm | minor | 接受 | 与 CODEX-01 同一窗口；glm 补充了「running 可被无限延续」这一性质，并给出本轮采用的最小约束（同一 run_id、可解析、artifacts 单调不减） | 同 CODEX-01 ①②；延续性在收窄后不再能用来改写已登记条目，只能追加，这一点写进该分支注释 |
| GLM-02 | glm | minor | 接受 | 属实：审查文档在收尾合并登记之前已逐侧落盘，进程若在两者之间崩溃且该状态被提交，这批文档既不在 `_meta` 也不在登记里，提交锚两层都够不着；会话内的写入仍由 Write/Bash 侧拦。窗口窄，本轮只登记、不改行为 | `test/integration/gate-loop.test.ts` 取舍注释与 BACKLOG EV-55 进展段补写这一边界：「崩溃窗口里落盘且已提交的审查文档不受提交锚保护；会话内写入仍被写侧拦」，并注明可行的后续方向（崩溃轮收尾补登记或登记时点前移） |
| GLM-03 | glm | minor | 接受 | 与 CODEX-02 同一问题；glm 另指出「恢复子命令被拆进两个数组元素时正则整条不命中」这种静默漏出论域的形态 | 同 CODEX-02；拆词形态由 KNOWN_SITES 下限与注释兜底——在判据注释里写明「子命令被拆开的文案不在论域内」，不假装覆盖 |
| GLM-04 | glm | nit | 接受 | 与 CODEX-03 同一问题 | 同 CODEX-03 |
| GLM-05 | glm | nit | 接受 | 属实：`--shallow-file` 是取值分离的 git 全局选项，不在集合里，前缀会断；可达性很低，但补进集合没有成本，也能避免后人以为集合已经穷举 | `src/trivium/hooks.ts` `GIT_OPTS_WITH_VALUE` 补 `--shallow-file`，注释写明「集合按 git(1) 全局选项列出，非完备时仍属启发式」；`test/unit/hooks.test.ts` 补一格 `git --shallow-file x restore …` ⇒ 判为写命令 |

## 实施后的核对口径

- `npm run typecheck && npm run build && npm test` 全绿；
- 新增变异：running 例外还原为「只看 HEAD status」⇒ CODEX-01 新用例变红；语句组退回只认 `+` ⇒ 两格新用例变红。
  **审查文档登记改回重算这一格不可鉴别**：正常运行里重算值与冻结值相同，用例区分不了两种口径
  （原稿的 GLM-03 同理）。如实记在测试报告里，不写成已被变异锁住；
- 进入第 4 轮代码双审。
