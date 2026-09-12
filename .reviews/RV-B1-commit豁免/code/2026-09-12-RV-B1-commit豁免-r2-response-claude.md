---
schema: trivium.disposition.v1
topic: RV-B1-commit豁免
stage: code
role: claude
kind: response
run_id: 20260912T134136Z
addresses:
  - AGY-r2-01
  - AGY-r2-02
  - AGY-r2-03
  - AGY-r2-04
  - AGY-r2-05
  - GLM-r2-01
  - GLM-r2-02
  - GLM-r2-03
  - GLM-r2-04
  - GLM-r2-05
  - GLM-r2-06
---

# 代码审应答：RV-B1-commit豁免

## 0. 应答总览

**11 条全部接受，零驳回，零暂缓。**

两侧独立指出了同一件事：`isExemptCommitCommand` 的三个前置条件远不足以守住豁免，
至少有 **5 条**我完全没想到的绕过路径。我对其中三条做了实机验证，**全部成立**：

| 验证 | 命令 | 实测 | 补丁前 |
| :--- | :--- | :--- | :--- |
| 换行绕过 | `git commit -m x⏎rm .reviews/t/plan/a-gemini.md` | **exit 0 放行** | 拦 |
| 附着重定向 | `git commit -m x > .reviews/t/plan/a-glm.md` | **exit 0 放行** | 拦 |
| 文本提及 | `echo 记得 git commit > .reviews/t/plan/_meta/review-glm-R1.json` | **exit 0 放行** | 拦 |

第三条最严重：它**根本不是 commit 命令**，只因命令文本里出现了「git commit」两个词，
就被 `parseGitSegment` 的兜底正则判成提交而豁免，随后重定向写进
`_meta/review-glm-R1.json`——那是 `gate --check` 唯一的事实来源。

**结论：本补丁在护栏上开了真实的洞，不能合入。我的修改方案是撤回 RV-B1（见 §5）。**

## 1. 逐条应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-r2-01 | gemini | blocker | 接受 | 已实机验证成立：分段正则 `/(?:&&\|\|\|[;&\|])/` 不含 `\r\n`，而 shell 把换行当分隔符执行；`tokenize` 又按空白分词，多行串仍解析出 `commit`。实测 exit 0 放行 | 撤回 `isExemptCommitCommand`（§5 方案 A），该路径随豁免一并消失；同时在 `test/unit/hooks.test.ts` 保留一条多行负例锁死此形态 |
| AGY-r2-02 | gemini | blocker | 接受 | `HAS_SUBSTITUTION` 只覆盖 `$(`、反引号、`${`，遗漏进程替换 `<(` / `>(`；宿主以 bash 执行 Bash 工具调用时替换体会真实 fork 执行 | 同上撤回；负例保留 `git commit -F <(rm …)` 一条 |
| AGY-r2-03 | gemini | blocker | 接受 | `git -c core.editor="rm …" commit` 借 git 自身配置经 shell 执行任意命令，而 `parseGitSegment` 恰好会吃掉 `-c` 并把后续判成 commit。`core.hooksPath` 同族。豁免论据「commit 参数里没有被写入的路径」在此不成立 | 同上撤回；负例保留 `-c core.editor` 与 `-c core.hooksPath` 各一条 |
| AGY-r2-04 | gemini | blocker | 接受 | **最根本的一条**：`parseGitSegment` 用 `findIndex` 在整段任意位置找 `git`，且字面 token 找不到时用兜底正则「git 与 commit 同现即按提交论」。该函数是为 `hookPreCommit` 的「宁可错拦」设计的，复用到豁免侧方向翻转成「宁可错放」。实测 `echo 记得 git commit > …` 放行 | 同上撤回；`hooks.ts` 在 `parseGitSegment` 注释中写明「本函数的保守方向是拦截，禁止复用于任何放行/白名单判定」 |
| AGY-r2-05 | gemini | minor | 接受 | 新增用例只覆盖了三个已文档化前置，对换行、进程替换、配置注入、命令前缀、注释伪装零负例，锁不住边界 | 撤回后改为：保留并扩充这批形态作为**保护集不得被绕过**的负例（不再是豁免的负例），见 §5 方案 A 第 3 步 |
| GLM-r2-01 | glm | blocker | 接受 | 与 AGY-r2-01 同一路径，两侧独立复现。GLM 另指出豁免的提前 `return false` 发生在角色后缀整串扫描**之前**，使补丁前必被拦的命令直接放行——这一点我原先没意识到 | 同 AGY-r2-01 |
| GLM-r2-02 | glm | blocker | 接受 | **Gemini 未发现的独有一条**，已实机验证：重定向符不是分段字符，豁免后重定向目标完全不参与检查，`> 受保护文件` 可截断既有审查文档、或在 `_meta/` 下制造损坏的 review JSON。`WRITE_LIKE` 的 `>` 规则只决定进不进闸门分支，救不了 | 同上撤回；负例保留 `> 归档文件` 与 `>> _meta/…` 各一条 |
| GLM-r2-03 | glm | major | 接受 | 与 AGY-r2-04 同一根因，且点出关键：`test/unit/hooks.test.ts` 里 pre-commit 方向对 `echo git commit` 的**过拦**是明文记载的刻意保守，同一判据换到豁免方向恰成过放。这正是我在计划里写「复用 `parseGitSegment`，不要另写判定」时的盲点——问题在复用方向，不在复用本身 | 同 AGY-r2-04 |
| GLM-r2-04 | glm | major | 接受 | `GIT_EDITOR='rm …' git commit --allow-empty`：`VAR=value` 是独立 token，不破坏单段判定也不影响 `findIndex` 定位 `git`，而 git 未给 `-m`/`-F` 时以 shell 执行 `GIT_EDITOR`。与 AGY-r2-03 同族（配置/环境注入） | 同上撤回；负例保留 `GIT_EDITOR=…` 与 `env VAR=… git commit` 各一条 |
| GLM-r2-05 | glm | major | 接受 | 与 AGY-r2-02 同一路径。GLM 标 medium 置信度并说明取决于宿主 shell，判断审慎且正确 | 同 AGY-r2-02 |
| GLM-r2-06 | glm | minor | 接受 | 与 AGY-r2-05 同一缺口。GLM 另指出豁免正例 `git commit -F /tmp/msg.txt` 不含任何保护名、补丁前同样放行，**作为豁免用例不具区分力**——这条批评精准，该用例确实证明不了任何东西 | 同 AGY-r2-05；撤回后该无区分力用例一并删除 |

## 2. 双方共同指出的问题

四条路径两侧独立命中，没有一条是单侧臆测：

- **换行绕过**（AGY-r2-01 / GLM-r2-01）——双方均判 blocker，已实证。
- **`parseGitSegment` 方向反转**（AGY-r2-04 / GLM-r2-03）——这是根因，其余多条都是它的下游。
- **进程替换**（AGY-r2-02 / GLM-r2-05）。
- **测试覆盖不足**（AGY-r2-05 / GLM-r2-06）。

两侧各有独到发现：Gemini 抓到 `-c core.editor` 配置注入；ZCode 抓到**附着重定向**，
那是全部意见里最简单、最致命、而我和 Gemini 都漏掉的一条。异构双审在这里体现了价值。

## 3. 不予采纳的意见及其依据

无。11 条全部接受。

## 4. 本轮未覆盖

- 两侧均未运行测试与构建（只读约束），BACKLOG 声称的 716/716 与真机实测三条未经对方复核。
  我这侧的三条绕过验证是本轮新做的，结论已列在 §0。
- `hookPreCommit` 三条锚中「刚落盘、尚未登记进 `run.json` 的工件被删」的可检出性空窗，
  上一轮已提出、本轮仍未定论，与本补丁无关但仍开着。
- 非 macOS 平台的 shell 分词差异，两侧均未覆盖。
- 我**未**验证 AGY-r2-03 / GLM-r2-04 的配置与环境注入（会真实执行删除，不宜在本仓库实机试）。
  机制推演成立，按接受处理。

## 5. 修改方案

### 方案 A（推荐）：撤回 RV-B1，回到补丁前的 fail-closed

1. 删除 `isExemptCommitCommand` 与 `HAS_SUBSTITUTION`，恢复 `bashTargetsProtected`
   开头的角色后缀整串扫描，`hooks.ts` 回到 `b4fe405` 的判定逻辑。
2. 在 `parseGitSegment` 注释中写明：**本函数的保守方向是拦截（判不出即按提交论），
   禁止复用于任何放行或白名单判定**——防止下次再被对称复用。
3. 测试不删反增：把本轮发现的五类形态（多行 / 附着重定向 / 文本提及 / env 前缀 /
   进程替换）全部作为「保护集任何时候都不得被绕过」的负例保留在
   `test/unit/hooks.test.ts`，删掉无区分力的 `-F /tmp/msg.txt` 正例。
4. 文档回溯修订（§16.2 纪律 1）：设计 §8.5 与 §17.2、CLAUDE.md 与 snippet、
   QUICKSTART §5 全部撤回豁免表述，恢复「出口是 Write / Edit 工具、提交用
   `git commit -F <文件>`」；§21 追加 v1.2.5 记明本次撤回与其依据。
5. BACKLOG 的 RV-B1 改标 **已撤回**，附本轮双审结论与五条绕过路径，作为「护栏上
   打补丁式收窄为何行不通」的案例留存。

**推荐理由**：收益与风险严重不对称。收益只是「commit message 提到归档文件名时不被误拦」，
而已有一个零成本替代——`git commit -F <文件>`，我这几次提交都这么做，并不痛。
代价却是把一处 fail-closed 的护栏改成需要穷举危险形态的 fail-open，而本轮证明我对
shell 攻击面的估计严重不足：三个前置条件漏掉了至少五条路径，其中三条已实测击穿，
且这条路**自述没有任何跑后兜底**。再写一版「更严格」的白名单，我没有把握它就完备了。

还有一条我必须写下来：RV-B1 的起因是**我自己被拦了两次**。我在 BACKLOG 里亲手写过
「不应在降低 Driver 自身摩擦的动机下修改护栏」，然后还是做了。这次双审的结论，
正好印证了那句话。

### 方案 B（若决定保留豁免）：重写为严格白名单

不再「排除已知危险形态」，改为「只允许已知安全形态」，全部条件同时成立才豁免：

- 整条命令 `trim` 后不含换行、回车、任何重定向符（`>` `>>` `2>` `&>` `>|`）、
  进程替换（`<(` `>(`）、命令替换（`$(` 反引号 `${`）、heredoc（`<<`）、注释符 `#`、
  以及全部分段字符；
- 不复用 `parseGitSegment`，另写严格解析：首个有效 token 必须**严格**是 `git` 或以
  `/git` 结尾的绝对路径，不得有 `VAR=value` 前缀、不得经 `sh -c` / `env` 包裹；
- 禁止任何 `-c` / `--config-env` 全局选项；
- 子命令必须是字面量 `commit`，不接受变量、别名与非字面量兜底。

即便如此我仍不推荐：这份清单是本轮双审「碰巧发现」的集合，不是穷举的证明。

## 6. 需要你拍板

方案 A 与 B 二选一。**我推荐 A**，理由见上。

选 A 我就把 `hooks.ts` 回退到 `b4fe405` 的判定、保留加强后的负例、回溯修订四处文档；
选 B 我按上述严格白名单重写，并请求再跑一轮双审复核——这类改动不该只审一次。
