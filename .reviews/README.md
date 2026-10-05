# 多智能体协同审计与留痕目录 (.reviews)

本目录是 **「主攻 + 多审」（Driver-MultiCritic）** 流水线对外的**事实来源**：全部审查结论、逐条裁决与审计材料都落在这里并纳入 Git 版本管理，验收标准（AC-01～AC-19；演进项 AC-20 / AC-21 / AC-24 已达成（AC-21 含达成边界，见 PRD）、AC-22 部分达成，其余待实施）都从本目录读取。

> 规范依据：[PRD](../doc/01_requirements/PRD_driver_dual_critic.md) FR-08 / FR-09，[设计](../doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md) 第 6 章（两者的当前版本见其文档头）。
>
> **措辞说明**：N 方化后「双审」的正确称谓是「**多审**」，文档层面统称多审；
> 但**命令名 `/dual-*`、本目录名 `.reviews/` 与运行时目录一律不改名**（兼容优先）。
> **当前真实生效的是多审**：四家 Agent 均已启用为审核者，缺省集合为 codex / gemini / glm 三家（M8 D4-4）；
> claude 作审核者须 `--driver` 取另一家（M9）；换一家 Agent 在自己的 CLI 里主攻自 M10b 起可用（2026-09-26；编排器侧的判定与护栏随 M10a 交付，各载体的护栏等级见设计 8.5 与 QUICKSTART §5.2），见设计 16.1 与 §24 台账。
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
（由 Hook 与 `archive` 双重拦截：Claude Code 主攻时 Hook 兜得住；ZCode 主攻时 Hook 只作尽力拦截；Codex / Antigravity 主攻时没有 Hook，只剩 `archive` 与事后核对，见设计 8.5）。受保护的后缀集是**全部已登记角色减当轮 Driver**，
权威判据是 `hooks.ts` 的 `criticRoleSuffixes()`——**不要在这里枚举**，枚举过的地方
在 M8 接入 codex 时漏过一次。

> **后缀标识产出方，不标识发起方**。发起方（当轮 Driver）记在运行元数据里，两者**正交**——
> M10a 起可按运行（`--driver`）或按阶段（`topic claim`）指定别家为 Driver（M10b 起也可在别家自己的 CLI 里执笔），
> 同一个后缀在不同运行中既可能是 Driver 也可能是审核者。
> 这条正交性是禁读矩阵**不能按后缀差集生成**的根本原因。
**只追加不覆盖**：既有工件无论是否已审批一律不覆盖，`archive` 以 `O_CREAT|O_EXCL` 原子创建，命中已存在文件即视为重跑并自动抬升 `-r<N>`（FR-25）。

---

## 三、各阶段最低工件集（`trivium gate --check-artifacts` 强校验）

| 阶段 | 必备工件 | 对应需求 |
| :--- | :--- | :--- |
| `plan/` | ①`…-<Driver>.md` 原始计划 ②每个入选审核者一份 `…-<审核者>.md` ③`…-revised-<Driver>.md` 修订计划（含逐条裁决） ④有接受项时的新一轮计划 `…-r<N>-<Driver>.md`（N = 本轮被审对象轮次 + 1，开头逐条引用接受编号；设计 §6.6 规则 9，v1.3.89 起由闸门核对，不在 `--check-artifacts` 的最低工件集里） | FR-04 / AC-01 |
| `code/` | ①每个入选审核者一份 `…-<审核者>.md` ②`…-response-<Driver>.md` 应答件（逐条接受/驳回/暂缓 + 理由 + 修改计划） | FR-05 / AC-01 |
| `bug/` | ①`…-<Driver>.md` 根因原稿 ②每个入选审核者一份 `…-<审核者>.md` ③`…-revised-<Driver>.md` 修订根因 | FR-22 / AC-15 |

`<Driver>` 是当轮 Driver 的后缀（缺省 `claude`）；`<审核者>` 取入选的那几家（缺省三侧：`codex` / `gemini` / `glm`）。例如缺省配置下 plan 阶段是 `…-claude.md`、`…-codex.md`、`…-gemini.md`、`…-glm.md`、`…-revised-claude.md` 五份；glm 主攻时原稿与修订件换成 `…-glm.md` / `…-revised-glm.md`，审核者缺省去掉 glm。
| `verify/` | `…-verify.md` + `_meta/verify-<run_id>.json`（含实际执行的命令与退出码）。不在 `--check-artifacts` 的阶段范围内（它只认 plan/code/bug），由提交时的留痕核对保护：verify 运行清单登记了它（锚②），它又位于 `_meta/` 内（锚①），见 §四末「提交时的留痕核对」 | FR-21 / AC-10 |
| 每次运行 | `_meta/run-<run_id>.json`，每个入选审核者一份 `brief-*` 与一份 `review-*.json`（某侧失败时以 `review-<critic>-<run_id>.failed.json` 记录原因） | NFR-05 / AC-06 / AC-17 |

缺件即失败。**审查结果为零条意见时文件照常落盘**并在元数据标 `empty_review: true`，不得删除该侧文件假装没跑（P5 不可伪装）。

---

## 四、`_meta/` 审计材料

`_meta/` 由**编排器**（而非任何 Agent）产出，是送审可审计性（AC-17）、生效模型可核对（AC-13 / AC-18）、单审可见（AC-06）的落点。因此它**不适用**第二节的角色后缀命名：经编排器 `archive.writeMeta` 写出的文件名不得以任一已登记角色后缀结尾（后缀集由注册表派生，不在这里枚举），违者拒写。

```text
<阶段>/_meta/
├── brief-gemini-<run_id>.md     # Critic-A 审查任务书：角色、焦点提示语、被审对象路径与 sha256、
├── brief-glm-<run_id>.md        # 必读清单、禁读清单、本侧审查镜头、输出契约
├── brief-codex-<run_id>.md      # 每个入选审核者一份（此处以缺省三侧为例）
├── review-gemini-<run_id>.json  # 结构化审查结论原文（trivium.review.v1）
├── review-glm-<run_id>.json
├── review-codex-<run_id>.json
├── changes-<run_id>.diff        # 仅 code 阶段：本轮被审补丁（受留痕核对保护）
├── changes.diff                 # 指向最新一轮的便利副本（人读用，不进保护集）
└── run-<run_id>.json            # 运行元数据（trivium.run.v2；旧留痕为 v1）：快照哈希、各侧生效模型、
                                 # 起止时间、工具轨迹计数、降级原因、只读与隔离核验结论
```

各侧的 `brief-*` 互相可见但**不含任何意见**（只有被审对象、镜头、清单与契约），因此不破坏背靠背隔离；AC-04 检查的是对方的审查文档（`*-<审核者>.md`）及其摘录。

### 提交时的留痕核对（提交锚）

`hook-pre-commit` 在每次提交前核对归档（设计 8.5 Hook 表）。M10a 第 2 步（EV-55）起，「已提交的工件不可改」按两条判据判，**都与角色后缀无关**：

1. **位置（锚①）**：已跟踪、位于 `_meta/` 内的文件被改即拦。例外两项：`changes.diff`（便利副本，每轮覆盖写）；已提交版本仍是 `running` 的 `run-*.json`（说明运行中途被提交过，这次改动是正常收尾；只许同一 run_id、已登记条目逐条保留且 sha 不变、只追加新条目）。
2. **登记（锚②）**：`run.json.artifacts[]` 登记过的文件按 sha256 核对，被删或被改即拦。审查文档自 M1 起即登记；**plan / bug 的原稿**自 M10a 第 2 步起也登记，三要素是：
   - **时点**：该轮**成功收尾**时才登记。作废轮不登记，作废之后继续改稿可以直接提交；
   - **路径**：按**归档相对路径**登记（两侧先解到真实路径再取相对）；
   - **域**：被审原稿**在归档根内**才登记。归档外的（如 `--plan-file doc/…`）不登记，改为在 `run.json` 的 `gate.warnings` 写一条「本轮原稿不在保护集」，收尾 stderr 与 `gate --check` 同句提示。

`verify/_meta/verify-<run_id>.json` 由此**从一层变成两层保护**：它早由 verify 的运行清单登记、受锚②保护；M10a 第 2 步的位置判据让它再多锚① 一层。（此前多处写成「由不受保护变为受保护」，说过头了。）

**你能怎么改**：未送审的原稿直接改；作废轮之后的原稿直接改；**已成功送审的原稿要改，另起 `-r<N>` 新稿**（原稿文件名里的 `-r<N>` 与审查轮次号是两套编号）。裁决件（`-revised` / `-response`）与 `task.json` 不在这两条判据里，可以改。

**边界（照实写，不是保证）**：

- 提交锚只挂在 Claude Code 的 Bash 事件上，**终端里直接提交完全绕过**；
- 两格够不着：收尾新追加的登记条目在追加那一刻可被同步改写；审查文档已落盘、登记还没发生时进程崩溃，且这个状态被提交（BACKLOG EV-108）；
- 预检不标注「本轮原稿不在保护集」，标注只在上面三处。

**Bash 侧**（`hook-pre-bash`）另有一道**启发式**拦截：命令像写命令（词边界字面匹配重定向、`tee`、`sed -i`、`rm` / `mv` / `cp`、`git checkout|restore|commit…` 等）且命令文本提到保护对象时即拦，不区分「写它」与「说它」，判定在未剥 heredoc 的原文上做。保护对象里的角色后缀取**全部已登记角色，含当轮 Driver 自己的**（M10a 第 5 步起；Bash 侧拿不到当轮）。出口：改用 Write / Edit 落文件，提交写 `git commit -F <文件>`；恢复或清理带后缀、`_meta` 的文件请在终端执行。判据不完备，换写法让它认不出来属于绕过判定，不是出口。

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

> 上例写于只有两家审核者的时期。现在缺省三侧，每个审查阶段还会多一份 `…-codex.md`（Codex 审查），`_meta/` 里多一份 `brief-codex-*` 与 `review-codex-*`；
> 换别家主攻时，原稿与修订件 / 应答件的后缀随当轮 Driver 变（见第三节）。

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

---

> **给审查本文件改动的人**：本文件位于归档根，code 阶段的被审补丁按 `diffExcludePrefixes` **无条件排除**归档根，所以任何一步改了本文件，改动都不会出现在送审补丁里。
> 改动本文件的步骤须在其报告里注明，审查员请照例直读工作树核对（M10b 第 5 步代码双审 r4 GLM-01 核出）。
