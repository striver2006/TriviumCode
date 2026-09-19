# M9 第 7 步 · 纪律 6 回溯的 grep 差集自检（2026-09-20）

- **依据**：`.reviews/M9-ClaudeCode审核者接入/plan/2026-09-17-M9-ClaudeCode审核者接入-claude.md` §8.2
  （落点清单由 grep 生成、必须做差集自检）+ 修订稿 2.8（补 `*.snippet` include）+ 2.12（补 `--only` / `gemini|glm` 措辞锚）。
- **装置**：同目录 `grep-anchors.py`（四条锚 + 广撒网 `claude`，每条命中只给前后 70 字窗口）；
  最终输出 `grep-anchors.out.txt`（在全部改动落盘**之后**跑的一遍）。
- **论域**：`*.md` / `*.ts` / `*.snippet`，排除 `node_modules` / `.reviews` / `dist` / `reference` / `evidence` / `.git`。
  另**跳过**史实与行为面：`test/`、`doc/05_testing/REPORT_*`、`M9-交底.md`、`EV-12-实施计划.md`、
  主设计 §21 台账（≥ 3160 行）与 16.1 里程碑表（2890～2900 行）——它们记的是「当时」，不是现状断言。
- **结论**：四条锚共 396 处命中，逐条人读后**现状断言类的失实句已全部改准**（落点见主设计 §21 v1.3.30 行）；
  残余命中分三类，处置如下。广撒网 `claude` 另有 859 行不含任何锚——按文件计数逐个看过，
  未再发现锚点集漏掉的**现状**措辞（只有 `CASE_manual_acceptance.md` / `RUNBOOK` 里「两侧」作「一次运行的各侧」用，不是审核者数目断言）。

## 跑前 / 跑后计数

| 锚 | 跑前（改动前） | 跑后（改动后） | 说明 |
| :--- | :--- | :--- | :--- |
| A1 待 M9 / 尚未启用 / 随后续里程碑 | 18 | 19 | 新增 1 处是本轮写进 LLD 的「尚未启用为 Driver」（描述预检标注行为，非状态断言） |
| A2 两侧审查 / 两家 / 三家 / 第三家 / 第四家 | 229 | 230 | 绝大多数是 M8 / M9 叙事里的「第三家 / 第四家」；本轮改准的失实句见下表 |
| A3 criticEnabled / driverEnabled | 120 | 122 | 主要在 `src/`；文档侧改准 LLD「当前边界」、设计 6.2 表与 13.1.1 例句 |
| A4 `--only gemini\|glm` / `gemini\|glm` | 22 | 25 | 新增 3 处是本轮写进文档的「codex / gemini / glm 为缺省集合」 |
| 广撒网 `claude`（不含四锚） | 860 | 859 | 按文件计数见 `.out.txt` 末段 |

## 本轮据此改准的失实现状句（跑前命中，跑后消失或改为史实叙述）

| 落点 | 原句要点 | 失实起点 |
| :--- | :--- | :--- |
| 主设计抬头 | 「M9 第 5～7 步与 M10～M11 尚未开工」 | M9 第 5 步（2026-09-19） |
| 主设计 1.1 R-1 / R-3 / R-6 | 【待实施 · M8】/【待实施 · M7b】 | M7b 第 5 步 / M8 第 4 步 |
| 主设计 1.1 R-5、15.3 FR-31 / AC-24 | 「真实接入待 M8 / M9」「M8/M9 才是对真检验」「仍需改 `ProbeSection` 与 preflight 三项」 | M8 第 3 步（EV-05 两项收敛）/ M9 第 6 步 |
| 主设计 6.2 表 | 「生效枚举仍锁定 gemini \| glm……【待实施 · M8 / M9】」 | M8 第 3 步 |
| 主设计 6.7.1 `driver` 行 | 「值恒为 `claude` 直到 M10」 | M9 第 5 步 |
| 主设计 12.1 演进增补行 | M7b 四行 + M8 一行全部挂「待实施」 | M7b 第 5 步 / M8 第 3 步 |
| 主设计 13.1.1 | 「Driver 自身（如 `claude`，`critic_enabled: false`）」 | M9 第 4 步 |
| 主设计 15.3 AC-22 | 【待实施 · M7b】 | M7b 第 5 步 |
| 主设计 17.1 端到端行 | 「真实两家 Agent」 | M8 第 3 步 |
| PRD 抬头 / 3.2 / FR-29 / FR-31 / AC-22 / AC-24 / S6～S8 / 追溯矩阵 | 「第三家仍待 M8 / M9」「只有两家启用」「三侧待 M8 / M9」「真机验收未跑」 | M8 第 3～4 步 |
| `LLD_orchestrator.md` 2.6 与 Hook 判据 | 「`criticEnabled` 只对 gemini / glm 为真」「basename 匹配 `-（gemini\|glm）.md`」 | M7a（派生）/ M8 |
| `PROTOCOL` 抬头 | 「两侧审核者」「前缀四值……均尚未生效」「当前实际可选的只有两家」 | M8 第 3 步 |
| `QUICKSTART` / `MANUAL_user` 抬头与 §4.2 | 「两侧审查」「只有两家启用了审核者能力」「当前可选的只有两家」 | M8 第 3 步 |
| `.reviews/README.md` | 「当前真实生效的仍是两侧审查」「AC-20～AC-25 待实施」 | M7b 第 5 步 / M8 |
| `README.md` | 「第四家待 M9」「两家 CLI」「三家 CLI」 | M9 第 4 步 |
| `doc/02_design/README.md` | 主设计条目停在 v1.3.15；「M6 及其后一律待实施」 | v1.3.16 起 |
| `doc/03_api/README.md` | 「当前生效为 gemini / glm（两侧审核者）」 | M8 第 3 步 |
| 根 `CLAUDE.md` 与 `CLAUDE.md.snippet` | 「Antigravity 与 ZCode 只做只读审查」 | M8 第 3 步（只改这一处枚举，护栏口径不动） |
| `AGENTS.md` | 「`adapters/` 收敛两家 CLI 差异」 | M8 第 3 步 |

## 残余命中的处置（跑后仍在）

| 类别 | 落点 | 处置 |
| :--- | :--- | :--- |
| **代码注释 / 文案**（本步零代码改动） | `agents/registry.ts:29`（「claude 的审核者能力仍待 M9」）、`:263`（「M7a：gemini / glm」）、`adapters/base.ts:192`、`topic-args.ts:229` / `:484`、`schemas.ts:168`、`critics.ts:289`（报错文案「适配器随后续里程碑接入」）、`cli.ts:212`（`--only gemini\|glm`）、三处 `dual-review-*/SKILL.md` 的 `argument-hint`、`MANUAL_user.md:260` 的用法块 | 归入 **EV-61 扩项**（随下次动该文件或 M10 入口资产单源渲染一并改）；`skill-flag-parity` 只抓旗标名，改取值提示不会红 |
| **史实叙述** | PRD 第 31 行（v1.4.2 变更说明）、BACKLOG 各条保留的「原始条目」、主设计 §21 / 16.1、`M9-交底.md`、演进设计（v1.0.0 冻结正文） | 不改——它们记的是当时 |
| **一次运行的「两侧」** | `CASE_manual_acceptance.md`（多处）、`RUNBOOK_pipeline_ops.md:153/319/332/343`、`skills/dual-review-code/SKILL.md:90`、`skills/dual-critic/SKILL.md:21` | 语义是「本轮各侧」而非审核者数目；CASE 随 M11（§24.2）、skills 随 M10 收口时统一改「各侧」 |
| **原则 / 理由文本** | 主设计 2913（纪律 1「两家 Agent」）、592 与 `ADR_001:54`（AD-05 取舍理由）、`GUIDE_env_setup.md:94`（「两家 CLI 行为与文档不符是常态」） | 写的是 M0 时的经验来源，不是现状断言；不改 |
| **测试夹具注释** | `test/fixtures/stub-agent-kit/overlay.ts:39`（「对真检验要等 M8 / M9」） | 论域已排除 `test/`；随 EV-61 同批 |

## 复跑方式

```bash
python3 doc/05_testing/evidence/m9-step7-20260920/grep-anchors.py
```

> 锚点集本身仍是手写清单（计划稿 §8.2 的警示原文照录）：下一轮回溯**必须**换措辞再跑一遍广撒网，
> 本文件的锚不能直接照抄当结论。
