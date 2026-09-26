---
schema: trivium.disposition.v1
topic: 审批前工作树摘要
stage: plan
role: claude
kind: revised
run_id: 20260926T100417Z
addresses:
  - 2026-09-26-审批前工作树摘要-codex.md
  - 2026-09-26-审批前工作树摘要-gemini.md
  - 2026-09-26-审批前工作树摘要-glm.md
---

# 裁决：审批前工作树摘要 · 计划双审第 1 轮

> 被审对象：`2026-09-26-审批前工作树摘要-claude.md`（r1）
> ｜ 运行：`20260926T100417Z`（16m7s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`
> ｜ 共 16 条：重要 3 ｜ 次要 10 ｜ 吹毛求疵 3 ｜ 零阻断
> ｜ **16 条全部接受**。同指四组：
>   - CODEX-01 ≡ AGY-02：`l2-notice` 草案丢了命令限定，漏列契约测试；
>   - CODEX-03 ≡ AGY-03：`approve` 摘要的时点与异常隔离；
>   - CODEX-06 ≡ GLM-01：同步表漏 PROTOCOL；
>   - CODEX-09 ② ≡ GLM-03：gc 用例的夹具前提。

## 0. 本轮的形状

焦点四项三侧都核过：
- **① 不改判定、不破坏 EV-133 字节不变**：三侧独立成立。glm 另核出 :1339 是 `snapshot.drift` 的唯一写点；run.json 唯一的收尾落盘在 :1621，早于三步窗口。
- **② 失败不被报成「无改动」**：三侧认同严格助手与 `cat-file` 预检的分层。glm 补了一格 TOCTOU：基线在 `cat-file` 之后、`diff-tree` 之前被清掉，只会落「git 调用失败」。
- **③ 三个出口没有遗漏**：`holdNoticeFor` 全仓只有两个调用点，加上 approve 通过支，恰好三个。
- **④ 文案落点**：codex 与 glm 各自全仓反扫，落点齐全。

问题集中在三处：

1. **我自己写的草案不合计划自己的限定**。§7 末段写了「按命令 B / C / D 限定」，但 `l2-notice` 草案把括号丢了；停点草案「不会被拦」又与 l2-hook 档前缀「尽力拦截」同句矛盾。这正是上一主题整轮在修的那类失实。
2. **approve 这一格没写死**。时点两种说法并存，耗时没有上限，异常隔离没有覆盖 `readRunMeta`。
3. **契约面的漏项**：PROTOCOL、approve 入口资产、JSON 无上限、照抄命令与摘要口径不一致。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 已核 `test/contract/entry-render-parity.test.ts` :298：正向断言渲染产物含 `**闸门期**（命令 B / C / D 等待审批时）`。r1 §7 的 `l2-notice` 草案去掉了这个括号，照抄必红；而且 `l2-notice` 也注入命令 A 的产物，「审批时打印摘要」对命令 A 永不发生，会重新引入上一主题刚修掉的失实 | r2 §7 D6 草案：`l2-notice` 保留「（命令 B / C / D 等待审批时）」括号，摘要一句写在该括号限定的同一条里；r2 §3.2 与 D6 代价列补 `entry-render-parity.test.ts` 的 EV-132 用例（:259-315）；r2 §5 注明 12 份入口产物与契约测试同批提交 |
| AGY-02 | gemini | minor | 接受 | 属实：r1 D6 选 (b) 要改 `L2_AFTER_THE_FACT` 与 `driver.snippet` :27，却只给了停点与 `l2-notice` 两处草案；这两处也被 `entry-render-parity` 纳入反向扫描，没有逐字规格，实施时容易丢限定 | r2 §7 D6 补齐四处逐字草案：停点前段、`l2-notice` :5、`L2_AFTER_THE_FACT`、`driver.snippet` :27，外加 `registry.ts` :77 注释。每处都显式带「命令 B / C / D」限定，并按 GLM-02 避开「拦不拦」的断言；契约测试补进验证清单，同 CODEX-01 |
| CODEX-02 | codex | major | 接受 | 属实：`git.ts` :25 每次 git 调用 120 s，`workTreeHash` 走临时索引 `add -A`、没有 stat 缓存，未被忽略的大目录会让 approve 响应时间不可预期。「只告知」的输出不该让审批命令卡上几分钟 | r2 §2.1 / §4：摘要给独立的总预算（常量，暂定 20 s），逐次 git 调用的超时取剩余预算。`workTreeHash` 加可选 `timeoutMs` 入参，缺省仍为 120 s，送审冻结与漂移复算的行为不变。超时落第四种原因「工作树摘要超时（>20s）」。r2 §3.1 补一条超时用例（注入极小预算），§4 写明慢仓库上的代价，QUICKSTART 那一格同步 |
| CODEX-03 | codex | major | 接受 | 属实：r1 §2.4 approve 行的位置列写「recordApproval 之前」，人读列写「落审批后打印」，两者对「被砍掉时审批落没落笔」的答案不同。取**先算、先打印、再落审批**：摘要有 CODEX-02 的预算上限，被砍在摘要段时审批未记录、闸门仍在等待，重跑即可，是良性的一边 | r2 §2.4 approve 行统一为：复核全过 → 逐阶段算摘要并打印 → `recordApproval`。首句写「只告知，不影响审批结论」，删去「本次审批照常记录」这类预言句（落笔前说不准）。r2 §3.2 补 W7：摘要打印之后、落审批之前，闸门仍为 `awaiting_approval`（以预算注入超时构造，不靠杀进程） |
| AGY-03 | gemini | minor | 接受 | 属实：r1 只说「调用点再包一层 try/catch」，没点名 `readRunMeta` 在不在隔离范围内；它有文件 IO 与解析，放在隔离外抛错会中断审批 | r2 §2.4：每个出口一个隔离块，覆盖 `readRunMeta` 与摘要的计算、渲染；任何异常转成 `available: false` 并 `warn` 一行，不影响 `recordApproval` 的调用、退出码与 JSON 输出。变异 M8 扩为「隔离块缩到只包 summarize、`readRunMeta` 抛错」应红 |
| CODEX-04 | codex | minor | 接受 | 属实：一次分支切换就可能产出上千条；approve 的 `--json` 会经入口资产原样转述进 Driver 上下文，全量无界不值 | r2 §2.1：`WorkTreeSummary` 加 `total` 与 `truncated`。JSON 上限取常量（暂定 200，按路径排序取前 N），需要全量时走照抄命令。r2 §7 D3「JSON 给全量」改为有界，单测 6 同步 |
| CODEX-05 | codex | minor | 接受 | 属实：r1 把基线缺席归成「留痕早于此功能」这一个成因，但 §2.3 自己写了未走到复算不落盘；schema 描述写的是两种成因并列，运行时文案反而比契约窄。glm 核出后一成因在审批停点实际不可达，但文案不该靠这个推断来保证属实 | r2 §2.5 第一种原因改为中性句「本轮没有审查收尾时的工作树基线，无法比对」；单测 7 断言这句逐字，并断言不含「早于」 |
| CODEX-06 | codex | minor | 接受 | 属实：`approve` 的 JSON 新增 `worktree_summary`，属于对外输出面，AGENTS.md 同步清单要求同步 PROTOCOL 与命令契约。`approve.contract.md` 只有「原样转述」一句，L2 Driver 看到「3 个文件有变化」时，没有文字告诉它这与审批结论无关，存在自行「修复」被列文件的空间，而那正是闸门期越界写入 | r2 §5 补两行：PROTOCOL :356 `approve` 行与 gate 相关行加摘要与 `worktree_summary` 键（注明不参与判定）；`skills-src/commands/approve.contract.md` 加一句「输出里的工作树改动摘要只告知，不改变审批结论；不得据此改文件、拒绝放行或代替用户判断」，重渲染各载体的 `dual-approve` 产物 |
| GLM-01 | glm | minor | 接受 | 同 CODEX-06。另指出 PROTOCOL §四「跑后」第 1 步（:201 重算 tree_hash'）将多一个落盘副作用，已核属实 | r2 §5 PROTOCOL 行同时覆盖 §四 :195-203（复算的 tree 落盘为 `snapshot.after_tree_hash`，只供审批时摘要作基线）与 :356 |
| CODEX-09 | codex | minor | 接受 | 属实两点：①摘要里的 run id 与闸门项 run_id 同源，这一点代码自洽，但没有用例钉住，重跑后审批的交错形态值得钉；② gc 用例若与同文件其它用例共享对象库，会误清别人的不可达对象 | r2 §3.2 补 W8：同阶段重跑一轮后审批，断言摘要里的 run id 等于闸门项 run_id，基线取自新一轮；取不到基线时也带上该 id。单测 8 与 W5 注明使用独立夹具目录 |
| GLM-03 | glm | minor | 接受 | 属实：`initFixtureRepo` 全量提交，干净夹具下基线 tree 等于 HEAD tree，可达，`gc --prune=now` 清不掉，单测 8 造不出「不在对象库」，M4 的应红也依赖这个前提 | r2 §3.1 单测 8 写明搭法：先造一个未跟踪文件再取基线（使基线不可达），删掉该文件后再 `git gc --prune=now`；r2 §3.3 M4 注明以此夹具为前提 |
| CODEX-07 | codex | nit | 接受 | 属实：r1 给的照抄命令不带排除口径，也不带 `core.quotePath=false`，照抄会比摘要多出归档行，中文路径还会成八进制——与纪律 4 的实测教训同一个坑 | r2 §2.5 照抄命令改为 `git -c core.quotePath=false diff-tree -r --name-status <基线> <当前> -- . ':(exclude)<归档根>' ':(exclude).trivium'`，由渲染按实际排除前缀生成；单测 6 断言命令中含排除项 |
| CODEX-08 | codex | nit | 接受 | 方向属实：摘要最被需要的时候（闸门期多次提交），恰是基线最可能被清的时候，这个缺失不是随机的。codex 自标低置信：`gc --auto` 的 prune 仍受 `gc.pruneExpire` 约束，是否真会在两周内清掉需要实测，不按推断写死 | r2 §6.1 与 QUICKSTART 那一格写成「基线可能被 git 清理而取不到，取不到时会如实报，不会假称无改动」；r2 §3.4 零配额验收加一次最小实测：夹具里闸门期多次提交并触发 `git gc --auto`，记录 `cat-file` 是否仍在，按实测定口径 |
| AGY-01 | gemini | minor | 接受 | 属实：r1 的 `renderWorkTreeSummary(s, limit)` 拿不到出口类型与当轮 Driver，兑现不了 §2.5 停点与审批两套首尾句，也渲染不出按 Driver 派生的 abandon 写法 | r2 §2.1 签名改为 `renderWorkTreeSummary(s, opts)`，`opts` 含 `exit`（取 approval 或 hold）、`driver`（可为 null）、`topic`、可选 `limit`；abandon 写法经 `entryCommandOf(driver, 'dual-abandon')` 派生；单测补两种出口的首尾句 |
| AGY-04 | gemini | nit | 接受 | 属实：`-z` 下 `--name-status` 的输出是 `状态\0路径\0` 成对出现，按行或 tab 切会错位；`--no-renames` 保证不出现三段式 | r2 §2.2 写明解析协议：按 `\0` 切分后成对读取（状态、路径），末尾空段丢弃，奇数段即抛；单测 5 覆盖含空格与引号的路径 |
| GLM-02 | glm | minor | 接受 | 属实：`hook-config.ts` :413-414 的 l2-hook 档前缀是「本载体的 Hook 只作尽力拦截、不兜底」，r1 共用前段草案紧接着写「不会被拦」，同句自相矛盾；现行 :403 刻意不就「拦不拦」表态。本次改的是「事后」覆盖面，不该顺手引入「拦」的新断言 | r2 §7 D6 所有草案去掉「不会被拦 / 不拦」，共用前段只讲两件事：「改了也不会让审批失败」与「审批时 approve 会列出自审查收尾以来改过的文件（只告知）」。拦不拦交给各档前缀；`hook-config.test.ts` 新断言加反向一条：三档 L2 文本都不含「不会被拦」 |

## 2. 不改的部分

- D1～D6 的取舍三侧都认同，不变：D1 取 ②、不回落；D2 三个出口；D6 (b)。
- 三个出口的位置不变：approve 通过支、`--await-approval`、`--check` 自动立停点。
- 两处调整进 r2：D3 的 JSON 由全量改为有界（CODEX-04）；D5 的原因由三种增为四种，第一种改成中性句（CODEX-02 / CODEX-05）。
- 设计取舍无驳回、无暂缓。

## 3. 下一步

审批通过后，按本件落点写 r2 定稿（`2026-09-26-审批前工作树摘要-r2-claude.md`），照惯例先提交计划再实施。
