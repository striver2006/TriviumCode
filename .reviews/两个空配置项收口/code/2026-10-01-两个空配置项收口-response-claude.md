---
schema: trivium.disposition.v1
topic: 两个空配置项收口
stage: code
role: claude
kind: response
run_id: 20261001T131816Z
addresses:
  - 2026-10-01-两个空配置项收口-codex.md
  - 2026-10-01-两个空配置项收口-gemini.md
  - 2026-10-01-两个空配置项收口-glm.md
---

# 应答：两个空配置项收口 · 代码双审第 1 轮

> 被审对象：相对 `9cc9249` 的工作树改动（57 个文件，补丁 722.9 KB；`.trivium/config.yaml` 的删键不在送审面，见 CODEX-03）
> ｜ 运行：`20261001T131816Z`（约 9 分 53 秒）
> ｜ 结论：codex `approve-with-nits`（次要 2、吹毛求疵 2）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（次要 1、吹毛求疵 1）
> ｜ 共 6 条：接受 6、驳回 0、暂缓 0

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：演进设计 §8.3 仍逐字写着「既有配置 `readonly_commands` 即 paranoid 旋钮」且本体无注，ADR_002 的更正块停在「没有消费方」。计划 r2 §0 以「冻结」为由不动演进设计，但核到它的 §18 待拍板 8 已有 2026-09-15 的就地更正先例——带日期的注记不算改正文，同型处理缺了这一步。只加注、不改原句；§0 第 1 点、§8.2 行②、配置示例在 §8.3 的注里一并点名（意见里写的「§5.4 示例」核实在 §11「配置 v2 全量示例与迁移」，注里按实写 §11），不逐处加注（冻结正文少动为宜） | 演进设计 §8.3 段末加「2026-10-01 注」；ADR_002 更正块末加一句；BACKLOG EV-15 落地记要与设计 v1.3.72 变更记录把这两份列入落点 |
| CODEX-02 | codex | minor | 接受 | 「重跑最多 3 次（首次校验不计）」从配置降为散文后落在 6 处源文件里，本主题的对账面只守「两键不回潮」、不守这句一致——S8 原无上限正是同族漏写。加一条轻量契约：单一常量 + 源文件清单逐处断言含该句 | `test/unit/config-consumers.test.ts` 新增 U9：`skills-src/partials/review/body.md`（1 处）、`skills-src/commands/run.contract.md`（2 处，S4 / S8）、主设计（2 处，7.4 / 8.6）、MANUAL（1 处）各自恰含规定次数；渲染产物由 `entry-render-parity` 守 |
| CODEX-03 | codex | nit | 接受 | 属实：本仓配置删键不进送审面（`.trivium/` 不在补丁里），结案文案没提，读结案的人会以为本仓配置还带着两键 | BACKLOG EV-15 落地记要、设计 v1.3.72 变更记录各补半句「本仓 `.trivium/config.yaml` 的两键已删（该文件不进送审面，取证见报告 §4.5）」 |
| CODEX-04 | codex | nit | 接受 | 属实：两份读数脚本只记 bundle 哈希，而 bundle 每次构建都变，事后对不上源码。doctor 的 notes 里本就有「编排器构建标识」一行，被脚本丢了 | `acceptance.mjs` 与 `real-config-readout.mjs` 的读数里加构建标识（取 doctor `--json` 的 notes 里那一行）；`real-config-readout.mjs` 的「删键前」改为从 `git show 9cc9249:` 取本仓 `config.yaml`（删键后工作树已无两键，才能在修订后重取）；两份读数重跑一遍，新读数加 `.r1` 后缀、首轮原样保留 |
| GLM-01 | glm | minor | 接受 | 属实：§5 那句插在表格中间，`doctor --selftest` 那一行成了孤立行 | 报告 §5：那句挪到表格之后 |
| GLM-02 | glm | nit | 接受 | 有意为之，维持现状：④⁗ 挂在「前项全 ok」门后，与 ④′～④‴ 及 EV-160 P4 同形——预检失败时用户要先处理失败项，此时多念一条「可删两行配置」只会稀释注意力；doctor 是无条件的兜底出口。缺的是把这层取舍写出来 | `preflight.ts` ④⁗ 处注释与 `checkDeprecatedConfigKeys` 文档块各补一句「预检失败时不出，以 doctor 为兜底」；报告 §7 加一条 |

## 2. 修订后要补的验证

- U9 新增后：相关套件重跑；装置只认 `src/*.ts`，U9 的咬合放进 `contract-mutations.mjs` 补两格（K8 把 review 正文那句的 3 改成 5、K9 删掉 run.contract.md S8 的那句，期望 U9 红），整份重跑记 `.r1`；
- 两份读数脚本重跑（`.r1`）；
- 全量检查两次重跑（文档改了，坑清单「改完文档要重跑」）；doctor 自检重跑。
