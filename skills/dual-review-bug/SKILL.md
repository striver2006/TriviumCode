---
name: dual-review-bug
description: 对已有 Bug 根因定位材料做背靠背双审，并产出修订后的根因结论（命令 D）
argument-hint: <任务目标> --focus <审查焦点提示语> [--topic <主题>] [--context <路径,…>] [--profile <名称>] [--model-gemini <slug>] [--model-glm <id>] [--rca-file <路径>]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*), Read, Write, Edit, Glob, Grep
---

参数：$ARGUMENTS

# 命令 D · 对已有 Bug 根因定位材料做背靠背双审，并产出修订后的根因结论（命令 D）

下文 `TV` 指 `.trivium/bin/trivium`——**一律用这个项目相对路径**，不依赖 `PATH`
也不依赖 `${CLAUDE_SKILL_DIR}`（设计 §5.3 / §10.5）。
若该文件不存在，说明本项目还没初始化：提示用户先运行 `trivium init`，然后**停止**。

## 执行契约（必须严格按序，不得跳步）

**你不得自行调用 `agy` 或 `zcode`。** 并行、超时、指纹、轨迹核验、防覆盖命名、
裁决校验全部在编排器内（设计 §16.2 纪律 4）。你的职责只有三件：按序调用、读文件、写裁决。

### 1. 预检

运行 `TV preflight --stage bug --json`。失败则**原样转述**错误并停止，不要自行猜测修复。

### 2. 解析主题与被审对象

运行 `TV topic resolve --stage bug --json -- $ARGUMENTS`。

- 焦点为空时 `topic resolve` 会直接退 64 并给出写法提示，原样转述即可（FR-20）。
  **注意旧写法迁移**：`<一段话>` 会被当作任务目标而非焦点，必须显式 `--focus`。
- 若未提供 `--context` → 依据根因材料 内容补一份涉及路径清单再传入。
  你在起草时本就知道涉及哪些模块，这一步能显著提升审查质量（UR-01 / AC-11）。

### 3. 启动双审并等待

先运行：

```
TV review --start --stage bug --topic <主题> --focus <提示语> [--goal <任务目标>] [--rca-file <路径>] [--model-gemini <slug>] [--model-glm <id>] [--profile <名称>] [--context …] --json
```

若上一步 resolve 输出的 `task_goal` 非空，把它原样传给 `--goal`。它与 `--focus` 是两回事：
前者说「这次要达成什么」，进 BRIEF 第 4 段；后者说「这次重点看什么」，进第 2 段。
省略 `--goal` 时编排器会回退到 `task.json` 已记录的目标或同主题 plan 原稿。

**焦点必须走 `--focus`，不能直接写成首参。** 首参是**任务目标**（这次要达成什么，
进 BRIEF 第 4 段），`--focus` 是**本次重点看什么**（进第 2 段，FR-20 / AC-09 的
唯一落点，逐字嵌入）。两者语义不同，不可互相顶替。

`--focus` 会贪婪取到下一个已知旗标为止，所以焦点里带空格无需引号；
但要把它写在其它旗标**之前**或用旗标隔开，否则后面的内容会被一并吃进焦点。

**自由文本里若出现 `--` 开头的词，必须用双引号包起来再传。** 例如焦点是
「核实 --base 透传是否准确」，要写成 `--focus "核实 --base 透传是否准确"`——
否则 `--base` 会被当成真旗标，连同后一个词一起从焦点里被抠走，且**不报错**。
任务目标同理。这里的引号是**字面字符**：`--` 之后的内容会被拼成一整串再重新分词，
shell 的引号在拼接时就没了，所以引号要真实出现在 `$ARGUMENTS` 文本里。
（多数误吞会被下游校验拦住——档位不存在退 64、坏 base 退 64、非法 slug 退 64——
但焦点被截短后仍是合法字符串，没有任何校验能发现，只能靠引号。）

若 resolve 输出的 `profile` 非空，把它原样传给 `--profile`。它换的是本次运行的
模型档位（`config.yaml` 的 `profiles`），与 `--model-*` 不冲突——后者指定具体模型、
优先级更高，前者只换默认值表。档位不存在会退 64 并列出可用值。

若 resolve 输出的 `subject_path` 非空，把它原样传给 `--rca-file`。
resolve 用它定位被审对象，而 `--start` 会**重新定位一次**——不传就自动取
`bug/` 下最新的一份原稿，用户显式指定的那份会被静默换掉，
而 resolve 阶段的存在性校验反倒让一切看起来正常。

若 resolve 输出的 `models` 字段非空，把其中的模型覆盖原样传给 `--model-gemini` /
`--model-glm`。**用户指定的模型只在这一步才真正生效**——独立的 `preflight` 看不到
步骤 3 才传来的覆盖值（`review.ts` 的 slug 校验注释写明了这点），漏传会静默回退到
profile 配置模型，且留痕里记的就是回退后的模型，事后看不出用户曾经指定过。

它会冻结送审包、派生工作进程后**立即返回**，输出含 `run_id`、`max_waits`、
`wait_timeout_s` 与 `bash_timeout_ms`。

然后循环运行：

```
TV review --wait <run_id> --timeout <wait_timeout_s> --json
```

> **每次 `--wait` 的 Bash 调用必须把工具级超时设为 `bash_timeout_ms`（600000）。**
> Bash 工具默认超时是 120s，而 `--wait` 会等 540s——不设就必被工具超时杀掉，
> 这一条是本命令能否跑通的前提。
>
> 若某次 `--wait` 因工具超时而拿不到退出码：**按「仍在运行」处理**，
> 计入 `max_waits` 预算后继续下一次 `--wait`。工作进程不受影响，仍在跑。

退出码含义：`73` 仍在运行（打印进度后继续等）；`0` 两份审查文档与元数据已落盘；
其它按原样转述并停止。循环次数上限为返回的 `max_waits`，超限则停下求助人工。

### 4. 完整读取两份审查文档

用 Read **读全文**，禁止只读摘要段。两份都要读。

### 5. 写裁决件

依 `trivium.disposition.v1` 写出 `…-revised-claude.md`：

- front-matter 含 `schema` / `topic` / `stage` / `role` / `kind` / `run_id` / `addresses`；
- 正文含一张裁决表，列名固定：意见编号 ｜ 来源 ｜ 严重度 ｜ 裁决 ｜ 理由 ｜ 落点；
- **每个**意见编号都必须出现且仅出现一次，裁决取值为 接受 / 驳回 / 暂缓；
- 三种裁决**都**要有非空理由；**接受**必须写明落点；
- 禁止静默忽略任何一条（FR-14）。即使全部驳回也必须产出本件并写明「无修改及原因」。

### 6. 校验裁决完整性

运行 `TV gate --stage bug --topic <主题> --check --json`。
若返回缺失编号，补齐后重跑本步；最多重试 `max_check_retries`（默认 3）次，
仍不通过则向用户说明缺口并停止求助。

### 7. 停点

运行 `TV gate --stage bug --topic <主题> --await-approval`，
把它输出的停点话术与三份文档路径转述给用户，然后**停止**。

**此后不得自动实施修复。** 等用户 `/dual-approve` 之后才能继续。
