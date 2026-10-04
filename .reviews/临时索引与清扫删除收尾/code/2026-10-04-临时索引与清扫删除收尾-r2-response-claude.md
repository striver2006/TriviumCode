---
schema: trivium.disposition.v1
topic: 临时索引与清扫删除收尾
stage: code
role: claude
kind: response
run_id: 20261004T071443Z
addresses:
  - 2026-10-04-临时索引与清扫删除收尾-r2-codex.md
  - 2026-10-04-临时索引与清扫删除收尾-r2-gemini.md
  - 2026-10-04-临时索引与清扫删除收尾-r2-glm.md
---

# 应答：临时索引与清扫删除收尾 · 代码双审第 2 轮

> 被审对象：相对 HEAD 的 29 个文件变更（`_meta/changes-20261004T071443Z.diff`，738.9 KB，大头是证据目录的全量与变异读数）
> ｜ 运行：`20261004T071443Z`（命令 C 重跑，约 15 分 30 秒）
> ｜ 结论：codex（`k3`）`approve-with-nits`（吹毛求疵 1）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（吹毛求疵 1）
> ｜ 共 2 条：接受 2、驳回 0、暂缓 0

**为什么有第 2 轮**：第 1 轮 run `20261004T063823Z`（命令 A 的 S6）因 codex 侧服务端 429 限流、两次尝试都没产出最终回复，未带 `--allow-single`，整次判失败；当时 gemini `approve` 零意见、glm `approve-with-nits` 一条——正是本轮重提的 GLM-01。两轮之间工作树里本题的改动一字未动；仓库 HEAD 由 `e00a1e2` 变为 `f3482fa`，是用户自己的提交（codex 审核者改用 kimi 家族，只改 `.trivium/config.yaml`），不在本题补丁内。

三侧都独立核实了六个焦点：`workTreeHash` 删不掉照常返回哈希、git 失败与超时仍抛原始错误；自检两处结论不变、失败步骤报原始原因；到期整删记账、落回抹除、循环继续，待办措辞与 mtime 刷新后的重试时机一致；全树守卫豁免表与源码逐字相等（codex、glm 各自独立复算）；摆锁装置与变异读数（含 M9 存活→补 R3b→复跑咬住）支撑结论；文档与 EV-206 / EV-207 登记与代码一致。

## 1. 应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | nit | 接受 | 属实：RUNBOOK 新行在列完三种提示后统一写「家目录已归一成 `~`」，但会话启动待办那一行经 `removeFailedLine` 拼的是原路径（`hooks.ts` 注释写明是刻意的：与同段 unknown / deferred 各行一致写原路径），操作者按 RUNBOOK 在待办里找 `~` 会落空。只改文档、不改 `removeFailedLine` 的既定设计：括号改为「前两种提示的家目录已归一成 `~`，会话启动待办那一行给的是原路径」 | `doc/06_deployment/RUNBOOK_pipeline_ops.md` 第 280 行（EV-204 新行）的括号；改后重跑全量两次 |
| GLM-01 | glm | nit | 接受 | 属实：`finish` 里 `made.dir!` 成立只因 `finish` 仅在建夹具成功之后可达（`!selfScript` 早退与建夹具 catch 都是字面 return），这个前提没写下来；将来若在建夹具成功前多出一条 `return finish(…)`，`made.dir` 为 null 不会在断言处红——`tryRemoveTempDir` 吞掉 `fs.rm` 的一切抛出，错误码回退支会把整段 TypeError 消息当成「错误码」拼进 `cleanupResidue`，缺陷以怪文案静默存在。取建议里的显式短路：`made.dir === null` 时不删、不报残留（夹具根根本没建出来，「无残留」如实），去掉非空断言，注释写明前提与短路的理由。不新增用例（这条路径今天不可达，加注入口去造它不值）；变异与 S 组用例照旧覆盖删不掉 / 删成功两支 | `src/trivium/selftest.ts` 的 `finish`；改后重建、单跑 `temp-index-cleanup` 与 `selftest` 集成、按修订后源码重生成变异规格重跑、全量两次、doctor 自检 |

## 2. 无修改的部分及原因

- gemini 零意见；三侧「未覆盖范围」（未实跑测试与变异、`maxRetries` 重试路径、进程被杀形态、NFS 一类文件系统的错误码、祖先进程链在更深包装下的稳健性）属本题零配额与已登记残余的既定边界，报告 §3 覆盖边界与 BACKLOG EV-204 残余已如实写明，不另处置。
- 第 1 轮（失败轮）glm 的同一条意见即本轮 GLM-01，在此一并处置。
- 闸门期不改代码：两条接受项待用户审批后再动。
