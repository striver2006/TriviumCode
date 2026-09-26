---
schema: trivium.disposition.v1
topic: 留痕与文案小修
stage: code
role: claude
kind: response
run_id: 20260926T081442Z
addresses:
  - 2026-09-26-留痕与文案小修-codex.md
  - 2026-09-26-留痕与文案小修-gemini.md
  - 2026-09-26-留痕与文案小修-glm.md
---

# 代码审应答：留痕与文案小修（EV-129 / EV-130 ① / EV-131 / EV-132 ① / EV-133 / EV-134）

三侧结论：codex `approve-with-nits`（2 minor + 2 nit）、gemini `approve`（零意见）、glm `approve-with-nits`（3 minor）。共 7 条，**全部接受**。
同指一组：CODEX-03 ≡ GLM-03（EV-133 宣称三条路径不回写，只钉住了 `--check` 一条）。

本件是 EV-134 收紧之后的第一份裁决件，由刚装上的新判据核对：`addresses` 列三份审查文档的文件名。

## 逐条裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 已核：主设计 :3075「`judgeDrift` 是 git 树比对、**只看已跟踪文件**」仍在，正是该段自数的四处落点之一，与同文档 8.5 新注记前后矛盾；同文档另一处命中（:1624「提交锚……只看已跟踪文件的改动」）说的是 `deletedOrModifiedTracked`，语义正确不改 | 主设计 :3075 按 8.5 同口径改写；报告 §3.2 补「doc/02_design 全文」这条 grep 面与本处落点 |
| CODEX-02 | codex | minor | 接受 | 属实且是既有状态：本仓根 `CLAUDE.md` 的协议块是手工演进的旧形态，指纹不在任何已知档，`init` 永远走「未知、不替换、提示手工合并」，`driver.snippet` 的演进（含本轮 EV-132 新句）不会自动同步进去。仓库根 `CLAUDE.md` 同时是用户的项目指令文件，第 5 步已定「核对、不改正文」，本主题不动它 | 新登 BACKLOG EV-138：写明本仓 `CLAUDE.md` 属手工维护、协议块与 `driver.snippet` 的同步靠人，给出两个候选（登记为已知历史指纹后由 `init` 原位升级 / 维持手工并在块内注明），由用户定 |
| CODEX-03 | codex | nit | 接受 | 属实：注释、schema 与设计都宣称 `--check` 通过、`--await-approval`、`approve` 三条路径都不回写，用例与变异 M7 只钉了 `--check` 一条；首次提交之前的窗口里回写不会被提交锚拦，正是最该有测试的时段 | `gate-loop.test.ts` EV-133 用例扩为三步：`--check` → `--await-approval` → `approve`，每步后 run.json 逐字节不变（用走 B/C/D 路径的 `--entry B` 夹具，才能立起停点）；变异加 M16（`approve` 路径回写） |
| CODEX-04 | codex | nit | 接受 | 属实：「审批之前删改本轮的，复核会拦下」把事后核对说成拦截，与本段首句「不会被事前拦下」自相矛盾，也与 QUICKSTART「不符即拒」口径不一——正是 EV-132 要消灭的那族措辞 | `l2-notice.md` 该句改为「审批前复核会发现不符并拒绝审批」（与 GLM-02 一起改），重渲染 |
| GLM-01 | glm | minor | 接受 | 已核：PRD 第 5 行「当前版本」升到 v1.4.9，第 8 行「文档版本」仍是 v1.4.8；两字段历来同升 | PRD 第 8 行改 v1.4.9 |
| GLM-02 | glm | minor | 接受 | 属实：`l2-notice` 经 `main.l2-*` 也注入命令 A（`/dual-run`），而命令 A 没有审批停点——「闸门期（等待审批）」「审批之前……复核」两格在命令 A 的产物里指向永不发生的复核；同一份产物的 `run-enforce` 段自己写着「命令 A 没有审批这一步」 | `l2-notice.md` 闸门期与审查工件两格加「命令 B / C / D」限定，并补一句「命令 A 没有审批这一步：审查工件的事后防线只剩带 Hook 载体的提交锚」；只改措辞不动判定；渲染断言补「dual-run 产物里审批两格带命令限定」一格，契约变异加一条 |
| GLM-03 | glm | minor | 接受 | 同 CODEX-03 | 同 CODEX-03 |

## 实施与验证计划（审批后执行）

1. 按上表改：主设计 :3075、PRD 第 8 行、`l2-notice.md`（CODEX-04 + GLM-02）→ `npm run render`；`gate-loop.test.ts` EV-133 用例扩三步；`entry-render-parity` 补 GLM-02 那一格。
2. 变异：源码侧加 M16（`approve` 路径回写 run.json）；契约侧加 K8（`l2-notice` 去掉命令限定）；两侧全量重跑。
3. BACKLOG 新登 EV-138（CODEX-02）；报告 §3.2、§2 读数与本轮修订登记同步。
4. `npm run check`、`doctor --selftest`；用户重装后我复核安装副本；按用户指示提交。
