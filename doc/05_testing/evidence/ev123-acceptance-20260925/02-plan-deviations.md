# EV-123 实施与计划 r3 定稿的偏离

计划：`.reviews/EV-123-预检提示副本源缺失/plan/2026-09-25-EV-123-预检提示副本源缺失-r3-claude.md`。
下列三处实施与 r3 字面不同，均在代码双审前由 Driver 主动列出。

## 偏离 1：`runPreflight` 用例不在文件级钉 HOME，改用 `adapters` 注入

- **r3 §4.1 原文**：「`runPreflight` 汇总：文件级把 HOME 钉到 mkdtemp、默认摆好副本源」。
- **实施**：`PreflightOptions` 新增可选字段 `adapters?: AdapterTable`（只为可测性，只喂给 ④″ 的 `checkModelOverrideSource`，⑧ 探活不读它）；新增的 `runPreflight` 用例一律传 `adapters`（注入只实现 `modelOverrideSource` 的假适配器，或传 `{}`），并用 `critics: ['gemini']` 与 `probeWithVersionProbe` 让预检走到 ④″。
- **理由**：`test/unit/preflight.test.ts` 同一文件里还有 `runDoctor` 的用例，文件级改 `process.env.HOME` 会一并改变它们的环境；注入比钉 HOME 更精确，也与 `checkModelOverrideSource` 本身的注入口同形。
- **代价**：**现有**的 `runPreflight` 用例不传 `adapters`，④″ 仍读真实 `realAdapters()` 与开发机真实 HOME。在没有 `~/.zcode/cli/config.json` 的机器上，入选 glm 且能走到 ④″ 的现有用例会多出一条 `ok: true`、`warn: true` 的项。已核：现有用例没有断言检查项完整清单或条数的（唯一的 `checks.length === 1` 在 ① 就短路，到不了 ④″），不会因此变红；但它们的输出随开发机状态变化这一点，r3 想消除而本实施没有消除。

## 偏离 2：`--start` 人读输出直接打印 detail，不再叠加 `⚠`

- **r3 §3.3 原文**：「人读分支在非空时逐条打印 `⚠ <detail>`」。
- **实施**：`cli.ts` 打印 `  ${w.detail}`。detail 由同一个函数产出，本身以 `⚠️ ` 开头，再叠一个符号是重复。

## 偏离 3：会话里用过一次重定向

- **r3 §6**：「会话里的命令不带重定向」。
- **实施**：生成 `doc/05_testing/evidence/ev123-mutation-20260925/run.mjs` 时用了一次 `sed … > run.mjs`（从 EV-122 的同名包装改两处字样）。文件内容已核对无误，此后的读数都由脚本自己写文件。

## 实施中新增、r3 没写到的小件

- `preflight.ts` 导出 `displayHomePath()`（`~/` 展示）与 `collectWarnings()`（`warnings` 汇总，预检与 `startRun` 共用）。
- ~~`startRun` 里的复查包在 `try` 中，抛错时先 `lock.release()` 再重抛——与紧邻的 `prepareRun` 失败路径同形~~。**这句选错了对照邻居**（代码双审 r1 CODEX-01 ≡ AGY-01 ≡ GLM-01）：复查位于 `prepareRun` 成功返回之后，闸门已是 `running`，正确的对照是紧随其后的主 `catch`（`releaseRunningGate` + `lock.release`）。已改为把复查挪进主 `try` 的首句。
