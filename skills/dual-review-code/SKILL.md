---
name: dual-review-code
description: 对已有代码变更做背靠背双审，并产出逐条应答与修改方案（命令 C）
argument-hint: <审查焦点提示语> [--goal <任务目标>] [--topic <主题>] [--context <路径,…>] [--profile <名称>] [--model-gemini <slug>] [--model-glm <id>] [--base <ref>] [--only gemini|glm] [--allow-single]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*), Read, Write, Edit, Glob, Grep
---

参数：$ARGUMENTS

# 命令 C · 对已有代码变更做背靠背双审，并产出逐条应答与修改方案（命令 C）

下文 `TV` 指 `.trivium/bin/trivium`——**一律用这个项目相对路径**，不依赖 `PATH`
也不依赖 `${CLAUDE_SKILL_DIR}`（设计 §5.3 / §10.5）。
若该文件不存在，说明本项目还没初始化：提示用户先运行 `trivium init`，然后**停止**。

## 执行契约（必须严格按序，不得跳步）

**你不得自行调用 `agy` 或 `zcode`。** 并行、超时、指纹、轨迹核验、防覆盖命名、
裁决校验全部在编排器内（设计 §16.2 纪律 4）。你的职责只有三件：按序调用、读文件、写裁决。

### 1. 预检

运行 `TV preflight --stage code --json`。失败则**原样转述**错误并停止，不要自行猜测修复。

### 2. 解析主题与被审对象

运行 `TV topic resolve --stage code --json -- $ARGUMENTS`。

- 用户什么都没写（既无正文也无 `--focus`）时 `topic resolve` 会退 64 并给出写法提示，
  原样转述即可（FR-20）。
- 若未提供 `--context` → 依据代码变更内容补一份涉及路径清单再传入。
  你在起草时本就知道涉及哪些模块，这一步能显著提升审查质量（UR-01 / AC-11）。

**命令后的正文就是审查焦点**（「这次重点看什么」，进 BRIEF 第 2 段，FR-20 / AC-09 的
唯一落点，逐字嵌入）。用户不需要区分「目标」与「焦点」，直接写重点看什么即可。
任务目标（「这次要达成什么」，进第 4 段）**不必**用户提供：编排器会回退到 `task.json`
已记录的目标或同主题 plan 原稿；用户确实想指定时写 `--goal <任务目标>`。
也兼容显式写法 `<任务目标> --focus <焦点>`：给了 `--focus`，正文就落到任务目标上。
`--focus` 与 `--goal` 都贪婪取到下一个已知旗标为止，带空格无需引号。

**构造这条命令时，由你给自由文本补上字面双引号**——只要其中出现 `--` 开头的词。
不要指望用户在聊天框里自己加：他们不会，也不该被要求这么做。

例：用户说「重点核实 `--base` 透传说明是否准确」，要传成

```
TV topic resolve --stage code --json -- '"重点核实 --base 透传说明是否准确"'
```

漏了那对引号，`--base` 就成了真旗标，连同后一个词一起被抠走：焦点只剩「重点核实」，
而 `--base` 拿到一个必然非法的值。加引号**不改变逐字内容**，只是让解析器看清边界，
FR-20 的逐字承诺不受影响。resolve 若提示「主题异常短」，多半就是这里漏了引号。

> 为什么 shell 的引号不管用：`--` 之后的内容会被**拼成一整串再重新分词**，
> shell 引号在拼接那一刻就没了。引号必须作为**字面字符**出现在那一串里。
> 这条只对本步有效——第 3 步的 `review --start` 走标准 argv 解析，不存在这个问题。

### 3. 启动双审并等待

先运行：

```
TV review --start --entry C --stage code --topic <主题> --focus <提示语> [--goal <任务目标>] [--base <ref>] [--model-gemini <slug>] [--model-glm <id>] [--profile <名称>] [--context …] [--only <侧>] [--allow-single] --json
```

`--entry C` 标记本次运行由命令 C 发起，记入 run.json 留痕；它也让 CLI 按 B/C/D 规则
校验焦点必填（缺 `--focus` 退 64）。

若上一步 resolve 输出的 `task_goal` 非空，把它原样传给 `--goal`。它与 `--focus` 是两回事：
前者说「这次要达成什么」，进 BRIEF 第 4 段；后者说「这次重点看什么」，进第 2 段。
省略 `--goal` 时编排器会回退到 `task.json` 已记录的目标或同主题 plan 原稿。

把 resolve 输出的 `prompt_hint` 原样传给 `--focus`。本步走标准 argv 解析，
按普通命令行写法给带空格的值加引号即可，不涉及第 2 步那套拼串规则。

若 resolve 输出的 `profile` 非空，把它原样传给 `--profile`。它换的是本次运行的
模型档位（`config.yaml` 的 `profiles`），与 `--model-*` 不冲突——后者指定具体模型、
优先级更高，前者只换默认值表。档位不存在会退 64 并列出可用值。

**把上一步 resolve 输出的 `base` 字段原样传给 `--base`，无条件传，不要判断用户有没有写过。**
resolve 总是输出该字段（用户没传时它就是 `HEAD`），而显式传 `HEAD` 与省略完全等价，
所以照抄最省事也最不容易错。它决定被审补丁是 `git diff <base>` 到**当前工作区**的两点差异
（含已暂存、未暂存、未跟踪文件），不是 merge-base 语义。
**漏传不会报错，只会静默错审**：补丁悄悄退回 `git diff HEAD`，两侧审查员读到的变更范围
与用户以为送审的对不上，而留痕里记的 base 看起来一切正常。

若 resolve 输出的 `only` 非空，把它传给 `--only`；`allow_single` 为 true 时加上
`--allow-single`。两者都是用户显式要求的降级：前者只跑一侧，后者允许一侧失败时
不中止、产出单审结果并留痕（§12.4）。**漏传的后果是静默忽略用户的要求**——
照常跑两侧、一侧失败就整次失败，而留痕里看不出用户曾经要求过降级。

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

依 `trivium.disposition.v1` 写出 `…-response-claude.md`：

- front-matter 含 `schema` / `topic` / `stage` / `role` / `kind` / `run_id` / `addresses`；
- 正文含一张裁决表，列名固定：意见编号 ｜ 来源 ｜ 严重度 ｜ 裁决 ｜ 理由 ｜ 落点；
- **每个**意见编号都必须出现且仅出现一次，裁决取值为 接受 / 驳回 / 暂缓；
- 三种裁决**都**要有非空理由；**接受**必须写明落点；
- 禁止静默忽略任何一条（FR-14）。即使全部驳回也必须产出本件并写明「无修改及原因」。

### 6. 校验裁决完整性

运行 `TV gate --stage code --topic <主题> --check --json`。
若返回缺失编号，补齐后重跑本步；最多重试 `max_check_retries`（默认 3）次，
仍不通过则向用户说明缺口并停止求助。

### 7. 停点

运行 `TV gate --stage code --topic <主题> --await-approval`，
把它输出的停点话术与三份文档路径转述给用户，然后**停止**。

话术里有一枚**一次性审批确认码**，要原样转述给用户——没有它用户没法通过审批。
**这个码是给用户的，不是给你的。** 不要自己拿它去跑 `approve`：
审批是解除护栏的动作，发起权在用户手里（见 approval.ts 对这道护栏的说明）。

**此后不得自动改代码、不得合入。** 等用户 `/dual-approve` 之后才能继续。
