# M10a 第 5 步段二 · 纪律 6 回溯的 grep 锚差集自检（2026-09-24）

- **依据**：`.reviews/M10a-第5步/plan/2026-09-23-M10a-第5步-r2-claude.md` §4.2 第二层；先例 `../m9-step7-20260920/grep-anchors.md`。
- **装置**：同目录 `grep-anchors.mjs`，七条锚，每条命中给前后约 120 字的窗口。
  - `before`：段二任何改动落盘之前跑；
  - `after`：全部改动落盘之后跑；
  - `readme-at-head`：从 `git show HEAD:` 取 `.reviews/README.md` 改动前的文本，单独计数。
  - 输出分别是 `grep-anchors.before.txt`、`grep-anchors.after.txt`、`grep-anchors.readme-at-head.txt`。
- **论域**：`*.md` / `*.snippet` / `src/**/*.ts`（源码只读注释与文案，本步不改代码），外加归档根下的 `.reviews/README.md` 一份，共 **119** 个文件。
  - 排除：`node_modules`、`dist`、`.git`、`doc/02_design/reference/`、`doc/05_testing/REPORT_*`、`doc/05_testing/evidence/`，以及 `.reviews/` 下除根级 `README.md` 外的全部归档件。这些都是开工指令明定的冻结材料。
- **结论**：七条锚改动后的每一处命中都已人读归类，**残余待办不为空，共 5 项**，去向见末节。
  - 改动前命中过、改动后仍在的失实现状句：没有找到。
  - 改动后命中数上升的锚，增量全部来自本步新写的准确口径，那些句子本身就带着锚词。

## 初版装置失明了一份文件（代码双审 r7 CODEX-01 ≡ GLM-01）

初版 `walk()` 对目录求 `excluded('.reviews/')`，结果恒为真，整棵归档子树都不下潜，「`.reviews/` 下除 `README.md` 外」那条例外永远到不了：

- 实际论域是 118 个文件，**`.reviews/README.md` 不在其中**；
- 而这份文件恰是被审补丁唯一剔除的改动（`code-stage.ts` 的 `diffExcludePrefixes`），第二层核法在它上面也看不见；
- 初版本文件却写它「在论域内」，还把 B5 的一部分增量算在它名下。这是把没核的事写成了核过的事实，写在了证据件里。

修法：`.reviews/` 单独处理，进入后只收根级 `README.md`，子目录不下潜；输出目录改用 `fileURLToPath`；开头断言工作目录是仓库根（CODEX-02）。
初版 `before` 已不可复现：它当时论域 118 个文件、不含这份 README。改动前的完整计数 = 初版 `before` + `readme-at-head`。

## 跑前 / 跑后计数

| 锚 | 模式 | 跑前（118 份） | README@HEAD | 跑前合计（119 份） | 跑后（119 份） | 差值的解释 |
| :--- | :--- | --: | --: | --: | --: | :--- |
| B1 | 未拆分的 `M10`（后不跟 a / b / 数字） | 89 | 2 | 91 | 65 | 主设计 31→18，PRD 6→1；LLD、QUICKSTART、MANUAL、PROTOCOL、`doc/03_api/README.md`、`README.md`、`.reviews/README.md` 归零。剩下的见下表 |
| B2 | `driverEnabled` / 唯一启用 / 尚未启用为 Driver / 只校验「已登记」 | 54 | 0 | 54 | 60 | 「唯一启用」只剩主设计 §24.2 的「原记」引述一处；「只校验「已登记」」零命中；新增的是「翻开 `driverEnabled` 并收紧」这类新写口径 |
| B3 | `Claude 系` / `非 Claude` / `claude-*` / `heterogeneous: false` | 25 | 0 | 25 | 29 | 「默认非 Claude 系」这类把 Claude 当判据本身的句子归零；新增的是「claude 为 Driver 时即非 Claude 系」之类的限定句 |
| B4 | 唯一来源是 / 回落缺省 Driver / 零留痕 | 33 | 0 | 33 | 36 | 主设计 8.5「唯一来源是 `run.json.driver`」归零；新增的是三级判定与 `topic claim` 段里的「零留痕时取声明」 |
| B5 | 提交锚 / 不可变 / `verify-` | 71 | 2 | 73 | 88 | 新增的是 8.5 Hook 表、`.reviews/README.md` 新节（改动后 5 处，改动前 2 处）、BACKLOG 结案段、RUNBOOK 一句 |
| B6 | `approve` 与复核或确认码同行 | 30 | 0 | 30 | 41 | 新增的是 8.4 解除方式、8.5 L2 表、R18、PRD AC-21、MANUAL §8.2 |
| B7 | 后缀枚举（`*-gemini.md`、`-glm.md`、`角色 = `、`gemini/glm`、`gemini \| glm`） | 92 | 10 | 102 | 96 | 改为判据式的有：README 的 L111 / L202 / L207、主设计 §10.4 与 6.2 枚举块、MANUAL 与 QUICKSTART 的护栏表、PROTOCOL 的 Hook 表。剩下的见下表 |

## 残余命中的归类（跑后）

| 类别 | 落点 | 处置 |
| :--- | :--- | :--- |
| **本步新写的准确口径**（含锚词，属实） | 主设计：抬头、术语表、1.1、1.2、6.2、6.7.1、7.1、8.4、8.5、11.5、15.x、16.1 两行、19、§21 v1.3.37、§24<br>PRD：抬头、3.2、FR-01、FR-17、FR-28、AC-18、AC-21、第 12 章子表<br>其他：LLD 2.6；MANUAL §8；CASE 4.3 与其后一段；README L89；根 `CLAUDE.md`；协议片段；PROTOCOL 第 16 行与第 343 行；BACKLOG 结案段；`.reviews/README.md` 提交锚一节与 `verify/` 行；`doc/05_testing/README.md` 的本步索引行 | 不改 |
| **史实**（记的是当时） | 主设计 §21 各版本行、16.1 M6～M9 各行、§24.1 的 M6 行；PRD 与 LLD 旧版变更说明（LLD 第 10 行属 v1.1.1 变更说明）；BACKLOG 各条原文与进展段；`doc/08_project/M10a-轮次台账.md`；`doc/08_project/M9-交底.md`；`doc/05_testing/README.md` 的历史报告索引 | 不改 |
| **冻结正文**（演进设计 v1.0.0） | §5.4 末条、§6 AC 表的「里程碑」行、§9.4、§12 / §13 各行、§14「依赖关系」一句、§15 R 行、§17.2 第 17、18 行 | 不改；口径修正落主设计，§24.1 新增一行注明（方案 A） |
| **非现状断言** | 纪律 7「唯一来源是注册表」一类的原则句；PRD 基线需求原文与 AC-01、AC-04、AC-15 的两侧形态；主设计 §6.3 最低工件集、§6.5 示例、§10 deny 示例路径、§17 故障注入表的示例文件名；CASE 剧本步骤里的示例命令；配置缺省值（MANUAL 第 392 行、主设计照录的 `peer_artifact_globs`）；`.reviews/README.md` 第 38 行的角色取值（已写「由注册表统一派生」）、第 99 行 AC-04 的检查对象、第 133～152 行目录示例里的文件名 | 不改 |
| **代码注释与文案**（本步零业务代码改动） | `src/trivium/**` 里标有版本的历史叙事，以及仍属实的现状句 | 不改；其中失实的两处进残余待办 ① ② |
| **论域外的杂项** | `.zcode/plans/…md`：ZCode 会话的计划缓存，不是项目文档 | 不改 |

## 残余待办（给去向）

| # | 落点 | 为什么没在本步改 | 去向 |
| :-- | :--- | :--- | :--- |
| ① | `src/trivium/hooks.ts` `resolveRoundDriver` 上方文档块「代价是非缺省 Driver 仍写不出自己的原稿（已登记为已知边界）」 | 改注释也是改代码；段二零代码改动 | BACKLOG EV-61 扩项 |
| ② | `src/trivium/hooks.ts` `hookPreWrite` 上方仍以 `criticRoleSuffixes(DEFAULT_DRIVER)` 作当轮保护集的指针 | 同上 | BACKLOG EV-61 扩项 |
| ③ | 门面文档的示例与枚举缺 codex，涉及三处：<br>・`README.md` 角色表与目录示例（第 46、157、213、214 行）；<br>・`.reviews/README.md` 第三节工件表（第 73～75 行）与**第四节导语那句「`archive` 保证 `_meta/` 内不出现以三家后缀结尾的文件」（第 85 行）**——初版装置失明，这句是修好之后才扫到的（代码双审 r7 GLM-03）；<br>・MANUAL 第 499 行、QUICKSTART 第 179、280 行的目录示例 | M8 D4-4 以来的残留。第 85 行虽是保证形态，方向是少列一家，不是多承诺 | BACKLOG EV-61 扩项，随 M10b 入口资产回溯同批改 |
| ④ | LLD 第 369 行误拦示例名单只列 `*-glm.md`，没说 D3 之后 `-claude.md` 也在内 | 示例名单，没有断言「只有这些」，不失实 | 报告缺口节登记，不立条目 |
| ⑤ | 配置缺省值 `peer_artifact_globs` 只含 gemini / glm 两家（`config.ts` 与两份文档一致） | 文档照录的是配置事实；这个键今天还有没有消费方，**本步没核** | 报告缺口节登记为未核的观察 |

## 复跑方式

```bash
node doc/05_testing/evidence/m10a-step5-20260924/grep-anchors.mjs after            # 改动后
node doc/05_testing/evidence/m10a-step5-20260924/grep-anchors.mjs readme-at-head   # HEAD 版的 .reviews/README.md
```

`before` 是在段二任何改动落盘之前、用初版装置跑的，**不可复现**。再跑一次得到的是当时工作树的结果，而且初版论域不含 `.reviews/README.md`。
