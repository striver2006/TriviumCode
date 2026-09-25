# EV-125 零配额验收读数

- **日期**：2026-09-25
- **计划**：`.reviews/EV-125-命令A支持选侧旗标/plan/…-r2-claude.md` §4.3
- **结果**：**28 / 28 成立**（脚本 `run.mjs`，原始输出 `01-readout.json`）。代码双审前为 25 / 25，之后按 CODEX-01 补了 E2b 三格
- **被测构建**：`npm run build` 产出在仓库内的 `skills/dual-critic/scripts/trivium.cjs`，构建标识 `694e6ce`（作用面内有未提交改动），inputs `2d962f422c56`（代码双审修复后；首跑为 `1e2cc101c796`）
- **不碰真实 HOME**（r2 CODEX-01）：没有跑 `install:local`；资产根经 `TRIVIUM_ASSET_ROOT` 指向工作树，只作用于脚本派生的子进程。预检带 `--skip-auth-check`，全程不发起模型调用。

## E1 解析（`topic resolve --stage all`）

`-- '任意目标' --topic EV-125-E1 --driver codex --critics claude,glm --model-claude m-x --allow-single`：

| 格 | 读数 |
| :--- | :--- |
| 退出码 | 0 |
| `critics` | `["claude","glm"]` |
| `models` | `{"claude":"m-x"}`——非 claude Driver 下把 claude 加进来并给它指定模型，BACKLOG EV-125 缺口 1 的正向格 |
| `allow_single` | `true` |
| `only` | `null` |
| `driver` | `codex` |

`--driver claude --critics claude`：退 64，报错「--critics 含当轮 Driver「claude」：它是本次运行的执笔者，不能同时充当独立审查员」。报错里没有已撤销的「命令 A（全流程）不接受」。

纯只读：`.reviews/` 目录项前后都是 47 个。

## E2 预检（`preflight --stage all --driver codex --critics claude,glm --skip-auth-check --json`）

| 格 | 读数 |
| :--- | :--- |
| 退出码 / `ok` | 0 / `true` |
| 模型 slug | 「已校验 3 个阶段 × 2 侧」 |
| 只读能力 | 「Claude Code、ZCode 均报告可用」——只报入选的两家，没有 Antigravity |

slug 那一项带一行已有提示：「⚠️ 其中无模型目录可比对、未实际校验：claude（探针未记录 Claude Code 模型目录）」。这是 claude 探针本来的状态，不是本题引入的；本题关心的是入选侧与阶段数。

## E2b 预检的完整形态（代码双审 CODEX-01 补）

S0.6 的模板要求把入选、档位、模型覆盖三样一起传给预检，而 E2 只传了 `--critics`，完整形态没有真跑过。

| 格 | 命令要点 | 读数 |
| :--- | :--- | :--- |
| 三样同传 | `--critics claude,glm --profile default --model-glm GLM-5.3 --skip-auth-check` | 退 0，`ok: true` |
| slug 覆盖 | 同上 | 「已校验 3 个阶段 × 2 侧」 |
| 反向格 | `--critics claude,glm --model-gemini x` | 退 64：「--model-gemini：gemini 本轮没有入选，为它指定的模型不会生效。」——与 `review --start` 同一判定 |

## E3 渲染产物（四份 `dual-run`）

| 载体 | `--model-*` 槽位 | 选侧旗标 | 先解析后预检、预检带 `--critics` |
| :--- | :--- | :--- | :--- |
| claude | codex, gemini, glm（与改前逐字相同） | ✓ | ✓ |
| codex | claude, gemini, glm（多回 `--model-claude`） | ✓ | ✓ |
| gemini | claude, codex, glm（同上） | ✓ | ✓ |
| glm | claude, codex, gemini（同上） | ✓ | ✓ |

`npm run render` 报「重写 4 份，删除 0 份残留」，只有这四份 `dual-run` 变了，其余 24 份产物逐字节不变（计划 r2 §3.4 的预期）。

## selftest

`doctor --selftest` 退 0。

## 没做的

- **没真跑命令 A**：一次全流程是两轮多侧真实配额；本题的行为变化都在解析与契约文本上，E1～E3 已覆盖。真实链路下一次有人用 `/dual-run --critics` 时自然验证，届时读留痕 `critics_selected` 对照即可。
- **真实 HOME 的安装副本**：已装的 claude / glm `dual-run` 落后一版，是否用 `--targets claude,glm` 重装由用户定。
