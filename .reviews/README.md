# 多智能体协同审计与留痕目录 (.reviews)

本目录是 **「主攻 + 多审」（Driver-MultiCritic）** 流水线对外的**事实来源**：全部审查结论、逐条裁决与审计材料都落在这里并纳入 Git 版本管理，验收标准（AC-01～AC-19；演进项 AC-20 / AC-24 已达成、AC-22 部分达成，其余待实施）都从本目录读取。

> 规范依据：[PRD v1.4.6](../doc/01_requirements/PRD_driver_dual_critic.md) FR-08 / FR-09，[设计 v1.3.30](../doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md) 第 6 章。
>
> **措辞说明**：N 方化后「双审」的正确称谓是「**多审**」，文档层面统称多审；
> 但**命令名 `/dual-*`、本目录名 `.reviews/` 与运行时目录一律不改名**（兼容优先）。
> **当前真实生效的是多审**：四家 Agent 均已启用为审核者，缺省集合为 codex / gemini / glm 三家（M8 D4-4）；
> claude 作审核者须 `--driver` 取另一家（M9）；换一家 Agent 主攻仍为【待实施 · M10】，见设计 16.1 与 §24 台账。
> 本目录内的文件**一律由编排器 `trivium` 的 `archive` 模块生成**，是唯一落盘出口；请勿手工创建或改名。

---

## 一、目录结构

```text
.reviews/
├── README.md
└── <主题>/                                  # 每个任务主题一个子目录
    ├── task.json                            # 主题级元数据：各轮指针、闸门状态、审批记录、争议项
    ├── plan/                                # 计划审（命令 B / 命令 A 的 S2）
    ├── code/                                # 代码审（命令 C / 命令 A 的 S6）
    ├── bug/                                 # 根因审（命令 D，不得由 A 或 C 代替）
    └── verify/                              # 编译测试出口（命令 A 的 S10）
```

**主题名规则**：允许中英文、数字、`-`、`_`、`.`，长度 1～64；禁止路径分隔符、`..`、前导 `.`、控制字符（空格自动转 `-`）；不得以 `-r<数字>`、`-revised`、`-response`、`-verify` 结尾（这些是保留后缀，否则文件名无法解析）。

---

## 二、文件命名规范（FR-08）

```text
<YYYY-MM-DD>-<主题字段>-<角色>.md

主题字段 = <主题>[-r<N>][-revised|-response]
角色     = claude | codex | gemini | glm  # 取值即 Agent id，由注册表统一派生（权威来源见 agents/registry.ts）
```

| 片段 | 含义 |
| :--- | :--- |
| `<YYYY-MM-DD>` | 该文件**首次生成**当日的本地日期 |
| `-r<N>` | 同一主题同一阶段**重跑**时出现，`N` 从 2 起递增（首跑无后缀）。同一次运行内两侧审查与裁决件共用同一 `N` |
| `-revised` | 计划修订件 / 根因修订件专用，只出现在 `plan/`、`bug/` 下**当轮 Driver 后缀**的文件 |
| `-response` | 代码应答件专用，只出现在 `code/` 下**当轮 Driver 后缀**的文件 |
| `claude` | Claude Code 产出 |
| `codex` | OpenAI Codex 产出 |
| `gemini` | Google Antigravity 产出 |
| `glm` | 智谱 ZCode 产出 |

**同一个 Agent 在不同运行里既可能是 Driver 也可能是审核者**，后缀只说「这份是谁产出的」，
不说它当时是什么身份——身份看同一轮 `_meta/run-*.json` 的 `driver` 与 `critics_selected`。
Driver 产出起草件与裁决件（原稿、`-revised`、`-response`），审核者产出审查文档。

**角色后缀是硬约束**：审查员不得产出 Driver 的后缀，Driver 不得产出审核者的后缀
（由 Claude Code Hook 与 `archive` 双重拦截）。受保护的后缀集是**全部已登记角色减当轮 Driver**，
权威判据是 `hooks.ts` 的 `criticRoleSuffixes()`——**不要在这里枚举**，枚举过的地方
在 M8 接入 codex 时漏过一次。

> **后缀标识产出方，不标识发起方**。发起方（当轮 Driver）记在运行元数据里，两者**正交**——
> 【待实施 · M10】任意 Agent 可为 Driver 之后，同一个后缀在不同运行中既可能是 Driver 也可能是审核者。
> 这条正交性是禁读矩阵**不能按后缀差集生成**的根本原因。
**只追加不覆盖**：既有工件无论是否已审批一律不覆盖，`archive` 以 `O_CREAT|O_EXCL` 原子创建，命中已存在文件即视为重跑并自动抬升 `-r<N>`（FR-25）。

---

## 三、各阶段最低工件集（`trivium gate --check-artifacts` 强校验）

| 阶段 | 必备工件 | 对应需求 |
| :--- | :--- | :--- |
| `plan/` | ①`…-claude.md` 原始计划 ②`…-gemini.md` ③`…-glm.md` ④`…-revised-claude.md` 修订计划（含逐条裁决） | FR-04 / AC-01 |
| `code/` | ①`…-gemini.md` ②`…-glm.md` ③`…-response-claude.md` 应答件（逐条接受/驳回/暂缓 + 理由 + 修改计划） | FR-05 / AC-01 |
| `bug/` | ①`…-claude.md` 根因原稿 ②`…-gemini.md` ③`…-glm.md` ④`…-revised-claude.md` 修订根因 | FR-22 / AC-15 |
| `verify/` | `…-verify.md` + `_meta/verify-<run_id>.json`（含实际执行的命令与退出码）。不在 `--check-artifacts` 的阶段范围内（它只认 plan/code/bug），由留痕核对保护 | FR-21 / AC-10 |
| 每次运行 | `_meta/run-<run_id>.json`、两份 `brief-*`、两份 `review-*.json`（单审时缺失侧以 `review-<critic>-<run_id>.failed.json` 记录原因） | NFR-05 / AC-06 / AC-17 |

缺件即失败。**审查结果为零条意见时文件照常落盘**并在元数据标 `empty_review: true`，不得删除该侧文件假装没跑（P5 不可伪装）。

---

## 四、`_meta/` 审计材料

`_meta/` 由**编排器**（而非任何 Agent）产出，是送审可审计性（AC-17）、生效模型可核对（AC-13 / AC-18）、单审可见（AC-06）的落点。因此它**不适用**第二节的角色后缀命名，且 `archive` 保证 `_meta/` 内不出现以 `-claude.md` / `-gemini.md` / `-glm.md` 结尾的文件。

```text
<阶段>/_meta/
├── brief-gemini-<run_id>.md     # Critic-A 审查任务书：角色、焦点提示语、被审对象路径与 sha256、
├── brief-glm-<run_id>.md        # 必读清单、禁读清单、本侧审查镜头、输出契约
├── review-gemini-<run_id>.json  # 结构化审查结论原文（trivium.review.v1）
├── review-glm-<run_id>.json
├── changes-<run_id>.diff        # 仅 code 阶段：本轮被审补丁（受留痕核对保护）
├── changes.diff                 # 指向最新一轮的便利副本（人读用，不进保护集）
└── run-<run_id>.json            # 运行元数据（trivium.run.v1）：快照哈希、两侧生效模型、
                                 # 起止时间、工具轨迹计数、降级原因、只读与隔离核验结论
```

两份 `brief-*` 互相可见但**不含任何意见**（只有被审对象、镜头、清单与契约），因此不破坏背靠背隔离；AC-04 检查的是对方的 `*-gemini.md` / `*-glm.md` 及其摘录。

---

## 五、目录示例

```text
.reviews/登录重构/
├── task.json
├── plan/
│   ├── 2026-09-10-登录重构-claude.md              # 原始计划（送审前冻结）
│   ├── 2026-09-10-登录重构-gemini.md              # 计划审 · Antigravity
│   ├── 2026-09-10-登录重构-glm.md                 # 计划审 · ZCode
│   ├── 2026-09-10-登录重构-revised-claude.md      # 修订计划（逐条裁决）
│   ├── 2026-09-10-登录重构-r2-gemini.md           # 同阶段重跑，原文件字节不变
│   ├── 2026-09-10-登录重构-r2-glm.md
│   ├── 2026-09-10-登录重构-r2-revised-claude.md
│   └── _meta/
├── code/
│   ├── 2026-09-10-登录重构-gemini.md
│   ├── 2026-09-10-登录重构-glm.md
│   ├── 2026-09-10-登录重构-response-claude.md
│   └── _meta/{changes-<run_id>.diff, changes.diff, brief-*.md, review-*.json, run-*.json}
├── bug/
│   ├── 2026-09-10-登录超时-claude.md
│   ├── 2026-09-10-登录超时-gemini.md
│   ├── 2026-09-10-登录超时-glm.md
│   ├── 2026-09-10-登录超时-revised-claude.md
│   └── _meta/
└── verify/
    ├── 2026-09-10-登录重构-verify.md
    └── _meta/verify-20260910T151002Z.json
```

---

## 六、不进 Git 的部分

| 内容 | 位置 | 原因 |
| :--- | :--- | :--- |
| 两侧原始 stdout、工具轨迹副本、临时配置副本 | `~/.trivium/runs/<repo_id>/<run_id>/<critic>/`（**项目根之外**） | 隔离机制的一部分：审查进行中，对方**本次**结论在项目树内物理不存在；原始日志可能含仓库片段，默认保留 30 天 |
| 流水线状态机、主题锁、日志 | `.trivium/{state.json,lock/,logs/}` | 本机运行时状态 |
| 探针结论与本机绝对路径 | `.trivium/config.local.yaml` | 随机器而异 |

落盘前 `archive` 会对 Markdown / JSON 做密钥扫描（常见 token 形态 + ZCode 凭据的 `<id>.<secret>` 形态），命中即拒绝落盘（NFR-04）。

---

## 七、复盘

`trivium report --topic <主题>` 依据本目录生成人读复盘：时间线、每轮意见数与严重度分布、采纳率、被驳回项与理由、降级与告警清单、耗时与 token 汇总。
