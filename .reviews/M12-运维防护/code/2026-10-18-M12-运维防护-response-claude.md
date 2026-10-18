---
schema: trivium.disposition.v1
topic: M12-运维防护
stage: code
role: claude
kind: response
run_id: 20261018T010929Z
addresses:
  - 2026-10-18-M12-运维防护-codex.md
  - 2026-10-18-M12-运维防护-gemini.md
  - 2026-10-18-M12-运维防护-glm.md
---

# 代码应答：M12-运维防护（第 1 轮）

codex、gemini 两侧 `approve`、零意见；glm 侧 `approve-with-nits`、三条 nit。回工作树逐条核过，三条全部成立，全部接受。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-01 | glm | nit | 接受 | 属实：`install-check.mjs` 改为从安装器产物取三类标签之后，「新脚本 + 批次 5 之前构建的旧产物」时 `KIND` 为 undefined，有冲突时 `KIND[p.kind]` 抛 TypeError，被 catch 成「检查失败」退 2，用户看不到冲突清单。这正是该脚本最常被用到的场景（拉了新代码、本机恰有同名入口） | `scripts/install-check.mjs`：解构后若取不到标签表，明确提示「产物过旧，先 `npm run build`」并退 2（与「产物缺失」同一退出码语义）；取到时输出逐字不变。另在已有标签表时对未知类别回落为类别名（`KIND[p.kind] ?? p.kind` 原样保留） |
| GLM-02 | glm | nit | 接受 | 属实：U8 按字面 `run(Doctor或Preflight)(` 识别直调，别名导入可以绕过；spawn 一侧也是启发式。按本仓「对账不靠记性」的纪律，应把条件放宽到「导入了这两个符号」（宁可误报），并写明剩余局限 | `test/unit/entry-scan-isolation.test.ts`：直调判据改为「静态导入了 `runDoctor` / `runPreflight`，或出现对它们的调用」任一成立；在名单常量旁写明仍未覆盖的形态（动态导入后改名、经变量拼出命令名的 spawn），由 `cli()` 缺省隔离兜底 |
| GLM-03 | glm | nit | 接受 | 属实：实现与计划 r2 有三处细目差异未记录——`entryScanHome()` 实现名为 `entryScanEnv()`（返回家目录与环境两项）；`summarizeSharedRootProblems` 由三参改为两参（本轮相关的家从问题列表派生，行为等价）；§4.1 点名 6 个直调文件，实际 5 个（`codex-wiring.test.ts` 只在注释里提到 `runPreflight`，全经 `cli()`） | 报告 `REPORT_2026-10-18_m12_batch5.md` 新增「相对计划 r2 的实现差异」一节逐条列出；代码不改名（主设计 v1.3.166 与报告已按实现名书写） |

## 修改计划

1. `scripts/install-check.mjs`：取不到 `ENTRY_PROBLEM_LABELS` 时退 2 并提示重建（GLM-01）。
2. `test/unit/entry-scan-isolation.test.ts`：U8 直调判据放宽到导入即算，补局限说明（GLM-02）。
3. 报告补「相对计划 r2 的实现差异」与代码三审读数（GLM-03）。
4. 改完：相关套件单跑、`install:check` 在 HOME 隔离夹具下新旧产物各跑一次（核取到标签时输出不变、旧产物时明确退 2），全量两遍，`install:local` 后 verify。
