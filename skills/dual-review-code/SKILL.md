---
name: dual-review-code
description: 对已有代码变更做背靠背双审，并产出逐条应答与修改方案（命令 C）
argument-hint: <审查焦点提示语> [--topic <主题>] [--context <路径,…>] [--model-gemini <slug>] [--model-glm <id>] [--base <ref>]
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

- 若提示语为空 → 停止并说明「命令 C 必须携带审查焦点提示语」（FR-20）。
  提示语会**逐字**进入两侧送审材料，是 AC-09 的验收落点，不能省。
- 若未提供 `--context` → 依据代码变更 内容补一份涉及路径清单再传入。
  你在起草时本就知道涉及哪些模块，这一步能显著提升审查质量（UR-01 / AC-11）。

### 3. 启动双审并等待

先运行：

```
TV review --start --stage code --topic <主题> --focus <提示语> [--context …] --json
```

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

**此后不得自动改代码、不得合入。** 等用户 `/dual-approve` 之后才能继续。
