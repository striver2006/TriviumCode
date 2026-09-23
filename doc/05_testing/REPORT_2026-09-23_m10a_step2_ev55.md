# M10a 第 2 步（EV-55）测试报告 · 提交锚「位置 + 登记」重写的变异验证

- **日期**：2026-09-23
- **依据**：`.reviews/M10-任意Driver/plan/2026-09-22-M10-任意Driver-r7-claude.md` §3 与 §8；
  代码双审第 2 轮（`code/2026-09-23-M10-任意Driver-r2-response-claude.md`，18 条全接受）与
  第 3 轮（`…-r3-response-claude.md`，10 条全接受），两轮均获人工审批
- **基线**：HEAD `e1a0d9a` + 本步工作区改动
- **本报告存在的理由**：第 2 轮裁决件承诺「按 §8 逐条跑变异，结果写进测试报告」。
  第 1 轮代码双审前的改动说明里曾把 §3.3 的若干用例以「低风险」为由暂缓，三侧不认同
  （r2 GLM-02：§8 五条 3.1.1 变异只有一条有可红用例）——本报告即那一格的交付。

---

## 0. 全量回归

| 项 | 结果 |
| :--- | :--- |
| `npm run typecheck` | 通过 |
| `npm run build` + `node scripts/build.mjs --tests-only` | 通过 |
| `npm test` | **1673 条：1671 通过 / 0 失败 / 2 跳过**（跳过的两条带预设条件，与本步无关） |
| `npm run install:local` | 已执行（执行前 `diff -rq` 确认只有内容差异、无文件增删） |

> **测试产物要单独重编**：`npm run build` 只产出打包件，`dist/test` 需要
> `node scripts/build.mjs --tests-only`。本步实施中一度跑的是旧 `dist/test`，
> 用例名还是改前的——看到「全绿」时先核对用例名。

---

## 1. 变异验证

**方法**：脚本对源文件做单点替换 → 重新构建打包件与测试产物 → 只跑指定测试文件 →
记录红绿 → `finally` 中还原原文并重建。每条变异断言锚点在原文中恰好出现一次，否则跳过。
变异期间不改动其他源文件。

### 1.1 第 2 轮（11 条，全部变红）

| # | 变异 | 变红的用例 |
| :-- | :--- | :--- |
| 1 | 登记门控去掉 `meta.status === 'success'`（作废轮也登记，等价于「登记时点移回 --start」） | fault-injection「作废轮（subject_drift）不登记原稿…」 |
| 2 | 去掉 `stage !== 'code'` 阶段门控 | code-stage「code 轮不新增原稿登记…」 |
| 3 | 去掉域检查（相对路径一律登记） | subject-artifact 四格 + fault-injection「归档外被审对象…」 |
| 4 | 空串不再判域外 | subject-artifact「原稿恰好落在归档根本身…」 |
| 5 | 去掉软链归一化 | subject-artifact「经软链写法给出的归档内原稿…」 |
| 6 | 登记改用绝对路径 | fault-injection「plan 原稿在成功收尾后进 meta.artifacts…」 |
| 7 | 删除 `run-*.json` 的 running 例外 | hooks「running 态收尾回写可以提交…」 |
| 8 | git 选项前缀还原为单 token 形态（r2 CODEX-01 阻断） | hooks「git 取值型全局选项不能让恢复 / 改写命令绕过…」 |
| 9 | 复原提交锚的跨时间后缀支（r2 CODEX-03） | hooks「非缺省 Driver 的原稿与裁决件…可以提交」 |
| 10 | `gate --check` 不接 `runWarnings` | fault-injection「归档外被审对象…」（另一条因变异后语法连带失败，不计） |
| 11 | gate 文案删去终端恢复出口 | bash-recovery-wording 主判据 |

### 1.2 第 3 轮（4 条，全部变红）

| # | 变异 | 变红的用例 |
| :-- | :--- | :--- |
| 12 | running 例外还原为「只看 HEAD 的 status」（r3 CODEX-01） | hooks「running 窗口的篡改链…」 |
| 13 | 语句组退回只认行尾 `+`（r3 CODEX-02） | bash-recovery-wording「语句组：跨行模板串与数组 join…」 |
| 14 | `--await-approval` 成功路径丢弃告警（r3 CODEX-03） | fault-injection「归档外被审对象…」 |
| 15 | 选项集去掉 `--shallow-file`（r3 GLM-05） | hooks「git --shallow-file 同样是…」 |

### 1.3 扫描判据自带的变异腿

`bash-recovery-wording` 内置一条：在内存里把 hooks.ts 源文本的「终端」替换掉，
两处已知站点必须成为 offender。它随每次 `npm test` 执行，不依赖本报告的脚本。

---

## 2. 不可鉴别项（如实登记，不算已被变异锁住）

| 项 | 为什么鉴别不了 |
| :--- | :--- |
| 原稿登记用冻结哈希 `primarySnap.subjectSha256`，而非收尾重算（r2 GLM-03） | 正常运行里两者相等；断言「登记值 = run.json 的 `snapshot.subject_sha256`」只锁住值可还原，区分不了口径 |
| 审查文档登记用写入时的哈希，而非收尾重算（r3 CODEX-04） | 同上 |

要鉴别需要在「写入」与「收尾」之间注入一次改写，桩适配器目前没有这个时点的钩子。

---

## 3. 剩余边界（不是测试缺口，是判据本身够不着）

与 BACKLOG EV-55 进展段同源：删掉提交锚后缀支之后，审查文档与原稿只剩锚②一道。

- 已提交版本为 running 的运行清单已收窄为「同一 run_id、已登记条目逐条保留且 sha 不变、只许追加」；
- 仍够不着的两格：① 收尾**新追加**的条目在追加那一刻可被同步改写；② 审查文档已落盘、
  登记未发生时进程崩溃且该状态被提交（r3 GLM-02）。这两格只剩写侧（Write/Edit 精确拦、Bash 启发式拦）。

---

## 4. 未覆盖

- **真载体 Hook**：以上全部在测试夹具与打包 CLI 上完成，没有在 Claude Code 真实会话里触发提交锚（归 M10b）。
- **非缺省 Driver 的全流程**：只用单测锁住「非缺省 Driver 改自己的原稿 / 裁决件可提交」，
  没有以 `--driver codex` 跑一轮完整审查（注册表里其他三家的 `driverEnabled` 尚未翻开，计划第 3 步）。
- **预检标注**：计划 §3.1.1 的「预检如实标注」未做，已在 BACKLOG EV-55 登记为偏差。
