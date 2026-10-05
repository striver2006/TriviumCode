---
schema: trivium.disposition.v1
topic: 目标回退取计划定稿
stage: code
role: claude
kind: response
run_id: 20261005T093847Z
addresses:
  - 2026-10-05-目标回退取计划定稿-codex.md
  - 2026-10-05-目标回退取计划定稿-gemini.md
  - 2026-10-05-目标回退取计划定稿-glm.md
---

# 目标回退取计划定稿 · 代码双审第 1 轮应答

run `20261005T093847Z`（17m37s，三侧到齐）：glm `approve`（零意见）、gemini `approve-with-nits`（次要 1、吹毛求疵 1）、
codex `request-changes`（重要 1、次要 1、吹毛求疵 2）。共 6 条，全部接受。AGY-01 与 CODEX-01 同指一处（测试报告与索引缺失），一并处理。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 属实：计划 r2 §5 列了测试报告与 README 索引，设计 v1.3.91 版本记录与 BACKLOG EV-212 已引用该报告，而本次 diff 里没有它——两处留痕引用了不存在的文件。我原打算等读数齐了再写，但 EV-215 的惯例是报告随被审 diff 送审、代码双审一栏审后回填，本题偏离了惯例且没声明 | 新增 `doc/05_testing/REPORT_2026-10-05_goal_fallback_plan_final.md`（含「与计划的出入」一节，登记 M3a 等价、M4 杀手分布、新增 M3b）；`doc/05_testing/README.md` 按文件名升序登记 |
| AGY-01 | gemini | minor | 接受 | 同 CODEX-01 | 同 CODEX-01 |
| CODEX-02 | codex | minor | 接受 | 属实：同族套件 `plan-final-recheck` / `plan-final-gate` 都逐侧断言桩指纹，本套件断言面（第 4 段目标行、`task_goal`、warnings）都在审查员执行前由编排器写出，桩注入静默失效时真实 CLI 跑完退 0 也会让断言照过 | `test/integration/goal-fallback-plan-final.test.ts` 的 `startAndFinish` 收尾后读 run.json，逐个入选侧断言 `cli_version === 'stub/0.0.0'`（三侧格含 codex） |
| AGY-02 | gemini | nit | 接受 | 属实：`taskGoalAppendix` 文档块仍写「目标来自任务文件或计划原稿时它为空」，本题已把第三级来源统一称「计划定稿」 | `src/trivium/review.ts` 该注释改为「计划定稿」 |
| CODEX-03 | codex | nit | 接受 | 属实：同一文件里两条用例名改了、第一条没改；`topic-args.test.ts` 的断言消息仍写旧措辞，而它对应的源码注释已改 | `test/unit/task-goal.test.ts` 首条用例名、`test/unit/topic-args.test.ts:380` 断言消息改为「计划定稿」 |
| CODEX-04 | codex | nit | 接受 | 属实：M4 预跑与装置都是 fail=6，既有单测改用夹具根当 projectRoot 后同样与 cwd 不同、同样能杀；「唯一杀手」说错了。GLM-01 的担心（该格退化成永绿）仍成立，所以 T7 照样要求断言非空 | `test/unit/task-goal.test.ts` T7 注释改为「集成侧对它没有鉴别力；单测侧凡项目根与 cwd 不同的格都能杀，本格是专为它写、断言非空的那一格」；报告「与计划的出入」登记 |

## 修改计划

1. 测试报告与索引（CODEX-01 / AGY-01）：报告按 EV-215 报告的章节写——范围、读数（单测、集成、A1/A2、变异、全量、自检、临时目录）、与计划的出入、留痕；代码双审一栏写本轮结论与本应答。README 按文件名升序插在 `REPORT_2026-10-05_fixture_repo_init_failure.md` 与 `REPORT_2026-10-05_plan_final_recheck.md` 之间（以实际排序为准）。
2. 桩指纹（CODEX-02）：`startAndFinish` 增加入参 `critics`，收尾后逐侧断言；调用处传各格实际入选侧。
3. 措辞与注释（AGY-02、CODEX-03、CODEX-04）：只改注释与用例文案，不动断言逻辑。
4. 改完重编，跑本题单测与集成；改到 `src/` 的只有一行注释，变异规格的 find 锚点不受影响（不在被改行），仍重跑一次装置确认；之后全量两次（串行）与 doctor 自检，前后数临时目录。
