---
name: dual-review-plan
description: 对已有计划做 Antigravity + ZCode 背靠背双审，并产出逐条裁决的修订计划（命令 B）
argument-hint: <任务目标> --focus <审查焦点提示语> [--topic <主题>] [--context <路径,…>] [--profile <名称>] [--model-gemini <slug>] [--model-glm <id>] [--plan-file <路径>]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*), Read, Write, Edit, Glob, Grep
---

参数：$ARGUMENTS

# 命令 B · 对已有计划做 Antigravity + ZCode 背靠背双审，并产出逐条裁决的修订计划（命令 B）

下文 `TV` 指 `.trivium/bin/trivium`——**一律用这个项目相对路径**，不依赖 `PATH`
也不依赖 `${CLAUDE_SKILL_DIR}`（设计 §5.3 / §10.5）。
若该文件不存在，说明本项目还没初始化：提示用户先运行 `trivium init`，然后**停止**。

## 执行契约（必须严格按序，不得跳步）

**你不得自行调用 `agy` 或 `zcode`。** 并行、超时、指纹、轨迹核验、防覆盖命名、
裁决校验全部在编排器内（设计 §16.2 纪律 4）。你的职责只有三件：按序调用、读文件、写裁决。

### 1. 预检

运行 `TV preflight --stage plan --json`。失败则**原样转述**错误并停止，不要自行猜测修复。

### 2. 解析主题与被审对象

运行 `TV topic resolve --stage plan --json -- $ARGUMENTS`。

- 焦点为空时 `topic resolve` 会直接退 64 并给出写法提示，原样转述即可（FR-20）。
  **注意旧写法迁移**：`<一段话>` 会被当作任务目标而非焦点，必须显式 `--focus`。
- 若未提供 `--context` → 依据计划 内容补一份涉及路径清单再传入。
  你在起草时本就知道涉及哪些模块，这一步能显著提升审查质量（UR-01 / AC-11）。

**首参是任务目标，焦点走 `--focus`。** 前者说「这次要达成什么」（进 BRIEF 第 4 段），
后者说「这次重点看什么」（进第 2 段，FR-20 / AC-09 的唯一落点，逐字嵌入）。
`--focus` 贪婪取到下一个已知旗标为止，所以焦点带空格无需引号。

**构造这条命令时，由你给任务目标与焦点补上字面双引号**——只要其中出现 `--` 开头的词。
不要指望用户在聊天框里自己加：他们不会，也不该被要求这么做。哪一段是目标、哪一段是焦点，
只有你分得清，所以这件事只能你做。

例：用户说「让 `--plan-file` 真正生效，重点核实还有没有同类缺口」，要传成

```
TV topic resolve --stage plan --json -- '"让 --plan-file 真正生效" --focus 重点核实还有没有同类缺口'
```

漏了那对引号，`--plan-file` 就成了真旗标，连同后一个词一起被抠走：任务目标只剩「让」，
主题也跟着被推成单字，而 `--plan-file` 拿到一个必然非法的值。加引号**不改变逐字内容**，
只是让解析器看清边界，FR-20 的逐字承诺不受影响。

> 为什么 shell 的引号不管用：`--` 之后的内容会被**拼成一整串再重新分词**，
> shell 引号在拼接那一刻就没了。引号必须作为**字面字符**出现在那一串里。
> 这条只对本步有效——第 3 步的 `review --start` 走标准 argv 解析，不存在这个问题。

### 3. 启动双审并等待

先运行：

```
TV review --start --stage plan --topic <主题> --focus <提示语> [--goal <任务目标>] [--plan-file <路径>] [--model-gemini <slug>] [--model-glm <id>] [--profile <名称>] [--context …] --json
```

若上一步 resolve 输出的 `task_goal` 非空，把它原样传给 `--goal`。它与 `--focus` 是两回事：
前者说「这次要达成什么」，进 BRIEF 第 4 段；后者说「这次重点看什么」，进第 2 段。
省略 `--goal` 时编排器会回退到 `task.json` 已记录的目标或同主题 plan 原稿。

把 resolve 输出的 `prompt_hint` 原样传给 `--focus`。本步走标准 argv 解析，
按普通命令行写法给带空格的值加引号即可，不涉及第 2 步那套拼串规则。

若 resolve 输出的 `profile` 非空，把它原样传给 `--profile`。它换的是本次运行的
模型档位（`config.yaml` 的 `profiles`），与 `--model-*` 不冲突——后者指定具体模型、
优先级更高，前者只换默认值表。档位不存在会退 64 并列出可用值。

若 resolve 输出的 `subject_path` 非空，把它原样传给 `--plan-file`。
resolve 用它定位被审对象，而 `--start` 会**重新定位一次**——不传就自动取
`plan/` 下最新的一份原稿，用户显式指定的那份会被静默换掉，
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

运行 `TV gate --stage plan --topic <主题> --check --json`。
若返回缺失编号，补齐后重跑本步；最多重试 `max_check_retries`（默认 3）次，
仍不通过则向用户说明缺口并停止求助。

### 7. 停点

运行 `TV gate --stage plan --topic <主题> --await-approval`，
把它输出的停点话术与三份文档路径转述给用户，然后**停止**。

**此后不得开始编写或修改任何业务代码。** 等用户 `/dual-approve` 之后才能继续。
