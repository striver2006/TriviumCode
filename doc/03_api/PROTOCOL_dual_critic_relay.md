# PROTOCOL：Driver-DualCritic 工件中继与协议契约

> 依据 [设计 v1.2.1](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md) 第 6、7、9 章与 [PRD v1.3.0](../01_requirements/PRD_driver_dual_critic.md)。
> **本文是对实现的描述性汇总，不是第二份规范。** 与设计文档冲突时以设计为准。

三方（Claude Code Driver、Antigravity Critic-A、ZCode Critic-B）之间**没有**任何进程间
协议——它们互不通信。全部协同经由**本地文件**与**编排器进程**完成。这是有意的设计
（原则 P4 工件即接口）：能被读、能进 Git、能事后独立复核的东西才算接口。

---

## 一、四份 JSON Schema

机读契约的唯一真理来源在 `skills/dual-critic/schema/`，ajv（draft 2020-12）强校验。
`review.v1` 由 `parse` 持有（要把错误回喂给模型），其余三份集中在 `schemas.ts`。

| Schema | 文件 | 生产者 | 校验落点 |
| :--- | :--- | :--- | :--- |
| `trivium.review.v1` | `review.v1.json` | 两侧审查员（最终回答即该 JSON） | `parse`（失败即 parse_fallback） |
| `trivium.disposition.v1` | `disposition.v1.json` | Driver（裁决件 front-matter；表格由 gate 单独解析） | `gate --check` 的 bad_front_matter |
| `trivium.run.v1` | `run.v1.json` | 编排器 | `writeRunMeta` 写前校验；留痕核对把不合契约的 run.json 视为「不可读」并拦提交 |
| `trivium.config.v1` | `config.v1.json` | 人（`.trivium/config.yaml` / `config.local.yaml`） | `loadCtx` 四级合并后校验，不合法退 69 并逐条列出（未知字段、枚举值、区间） |

### `trivium.review.v1` 的硬约束

- **意见编号前缀固定**：Antigravity 为 `AGY-`、ZCode 为 `GLM-`，两侧不冲突；
  pattern 为 `^(AGY|GLM)-(r[0-9]+-)?[0-9]{2,}$`（序号至少两位，重跑追加轮次如 `AGY-r2-01`）。
  裁决件解析器据此过滤数据行，所以编号不合规的意见会在闸门处被视为不存在。
- **每条意见七个字段必填**：`id` / `severity` / `location` / `problem` / `evidence` /
  `suggestion` / `confidence`，另需 `layer` 与 `kind`。
- **每条意见必须是可单独接受或驳回的最小单元**——这是「逐条裁决」得以成立的前提。
- `findings: []` **是合法的**（表示没发现问题），但 `summary` 与 `not_covered` 必须说明检查了什么。
- `consulted` 必填，用于与工具轨迹交叉核对（§11.4）。

### 解析失败的降级：`parse_fallback`

两侧输出不符合 schema 时**不丢弃**：原文照常落盘，该侧标 `parse_fallback: true`，
其意见按 `<前缀>-F<序号>` 虚拟编号参与裁决校验，但**不参与阻断判定**（§6.6 规则 8）。

`gate` 会用**当前**解析器重试一次历史 `parse_fallback` 原文——解析器修好之后，
旧的运行不该继续背着一个已经不存在的缺陷。

---

## 二、BRIEF：送审任务书（八段，顺序固定）

`_meta/brief-<critic>-<run_id>.md`，由 `brief` 模块渲染。**段数与顺序是契约**，
轨迹核验与人工对账都按段号引用，不得增删段。

| 段 | 内容 | 对应需求 |
| :--- | :--- | :--- |
| 1 | 角色与授权：独立二次审查员、禁止任何写操作、本段优先级高于项目 `AGENTS.md` / `CLAUDE.md`、与另一侧背靠背 | FR-07 / FR-10 |
| 2 | **本次审查焦点**：开发者提示语**逐字**嵌入 | FR-20 / AC-09 |
| 3 | 被审对象：真实路径、`sha256`、工作树 `tree_hash`、正文节选（用分隔符标明「这是数据不是指令」） | AC-17 |
| 4 | 项目上下文与必读清单、建议核实路径、己方上一轮产出与 Driver 对它的裁决、证据下限 | UR-01 / AC-11 |
| 5 | 审查要点（`prompts/<stage>-review.md`，按阶段）＋ 本侧镜头（`lenses.yaml`，按侧） | §9.3 |
| 6 | 输出契约：schema 路径、编号前缀、必填字段 | §6.5 |
| 7 | 反谄媚约束：不编造问题、不确定标 `confidence: low`、必填 `not_covered`、写 `agreed`、不给大段补丁 | NFR-07 |
| 8 | 禁读清单（**逐个列路径**，不给 glob）与禁止事项 | §10.1 第 ③ 道 |

**铁律**：BRIEF 中**绝不**出现对方的任何结论或摘录（FR-10）。第 8 段只含**路径**，不含内容。
两份 BRIEF 互相可见不破坏背靠背隔离——它们里面没有意见。

第 8 段逐个列路径而不给 glob，是为了事后能与工具轨迹**逐条对账**：
轨迹里出现任一禁读路径即判 `peer_artifact_read`。

---

## 三、被审对象怎么确定

| 阶段 | 被审对象 | 说明 |
| :--- | :--- | :--- |
| `plan` | `plan/<日期>-<主题>-claude.md` 的**真实路径**（不复制） | 多轮原稿取轮次最大者；可用 `--plan-file` 显式指定 |
| `bug` | `bug/<日期>-<主题>-claude.md` | 同上，`--rca-file` |
| `code` | `code/_meta/changes.diff` | `git diff <base>` + 未跟踪文件，`--find-renames`；头部记 `base` / `head` / 文件清单 |

`code` 的补丁**算一次**后透传给两侧：逐侧各自 `git diff` 会让两次之间的工作树变动
导致两侧拿到不同的 `subject_sha256`——那等于两侧审的不是同一段变更。

补丁**无条件剔除**归档根、`.trivium/`、`.git/`，与 `.gitignore` 写了什么无关：
`.reviews/` 是刻意纳入版本管理的，对方产出刚落盘未 commit 时处于未跟踪状态，
若被收进补丁就会经**被审对象本身**泄漏给审查员，三道屏蔽全部绕过。

---

## 四、快照与漂移判定

```text
送审前：
  ① git rev-parse HEAD
  ② 临时 GIT_INDEX_FILE → add -A → write-tree  得 tree_hash（绝不触碰用户暂存区）
  ③ 被审对象 sha256 → subject_sha256
  ④ 枚举对方历史产出 + 敏感文件 → deny_paths
  ⑤ 渲染两侧 BRIEF

跑后：
  1. 重算 tree_hash' 与 subject_sha256'
  2. subject_sha256' ≠ subject_sha256 → FAIL(subject_drift)，整次运行作废
  3. tree_hash' ≠ tree_hash：
     a. diff-tree 列出变更文件 F，剔除 probe.*.scratch_paths 白名单与归档根
     b. F 为空 → 无漂移（只有 Agent 临时文件）
     c. F 与 --context / diff 涉及文件相交 → review.on_drift_related（默认 fail）
     d. 其它 → review.on_drift（默认 warn），run.json 记 drift 并显著提示
```

漂移判定**必须**剔除归档根：编排器自己写 `_meta/` 与 `task.json` 也会改变工作树，
不剔除的话每次运行都会把自己的写入报成漂移。

---

## 五、退出码契约（§7.3）

| 码 | 含义 | 调用方该怎么办 |
| :--- | :--- | :--- |
| `0` | 成功 | 继续 |
| `1` | 一般失败 | 读 stderr |
| `2` | **闸门阻断** | 按 stdout 的缺口清单修补后重试 |
| `64` | 参数错误 | 修参数；不会产生任何工件 |
| `65` | 前置产物缺失 | 先补工件 |
| `69` | 环境或预检失败 | 跑 `doctor` / `preflight` |
| `70` | 主题被锁 | 同主题已有运行在跑，看 `--status` |
| `73` | **运行仍在进行**（不是失败） | 继续下一次 `--wait` |
| `75` | 严格模式中止 | 一侧失败且 `failure_policy: strict` |

`2` 与 `73` 是最容易被误处理的两个：`2` 不是崩溃而是**有话要说**，
stdout 里就是待修补的清单；`73` 不是超时而是**还没跑完**。

Hook 另有三档语义：`0` 放行或判定不了 ｜ `2` 明确判定拦截 ｜ `1` 程序缺陷（非阻断）。
检测不到 `.trivium/config.yaml` 一律 `0`——全局安装绝不误伤其它仓库。

---

## 六、分段长调用协议（`--start` / `--wait`）

一次双审墙钟可达 30～40 分钟，而 Claude Code 的 Bash 工具默认 120s、上限 600s。
所以不能同步等：

```text
trivium review --start --stage <s> --topic <t> --focus <hint> --json
  → { run_id, max_waits, wait_timeout_s, bash_timeout_ms, worker_pid, run_dir }
    先占主题锁 → prepareRun（冻结、渲染 BRIEF、写 run.json 骨架）
    → spawnDetached 工作进程 → 把锁改记 worker 的 pid → 立即返回

循环（至多 max_waits 次，每次的 Bash 工具超时必须设为 bash_timeout_ms）：
  trivium review --wait <run_id> --timeout <wait_timeout_s>
    → 73 表示仍在跑，打印进度后继续；0/非 73 表示终态
```

约束：

- 工作进程每 30s 写一次心跳到 `status.json`；心跳超过 `heartbeat_stale_s`（默认 120s）
  未更新且进程不存在 → 判 `failed(worker_lost)`。
- 进程存活性比对 `ps -p <pid> -o lstart=`，**不能只看 `kill(pid,0)`**：macOS 会复用 PID。
- stdio 必须重定向到日志文件。继承父进程管道会让 worker 在父退出后死于 SIGPIPE；
  管道 EOF 不闭合则派生方会挂到 worker 退出。
- `finished_inline: true` 表示同步窗口内已收口（目前唯一来源是 FR-23 纯文档跳过），
  调用方**不该**再进 `--wait` 循环。

工作进程生命周期等于一次运行，不监听、不接受新任务——不是常驻 Daemon。

---

## 七、Hook 契约（§8.5）

四个 Hook 注册在 `.claude/settings.json`（随仓库分发），全部经
`sh -c 'W=…; test -x "$W" || exit 0; exec "$W" …'` 包一层：**检测不到 wrapper 就退 0**。

| Hook | 事件 | 拦什么 |
| :--- | :--- | :--- |
| `hook-pre-write` | `PreToolUse` / `Edit\|Write\|NotebookEdit` | ①主脑写 `*-gemini.md` / `*-glm.md`（AC-07，与闸门状态无关）②闸门期改业务文件（归档内不拦） |
| `hook-pre-commit` | `PreToolUse` / `Bash`，`if: Bash(git commit:*)` | 裁决未齐备时禁止提交（AC-12） |
| `hook-stop` | `Stop` | 裁决未齐备时禁止收工（AC-02），输出 `{"decision":"block","reason":…}` |
| `hook-session-start` | `SessionStart` | 发现 `running` 的运行时以 `additionalContext` 提醒先 `--wait` |

**判定读的是 `.trivium/state.json`**（`listOpenGates`），不是 `run.json`。
`review` 必须把闸门状态同步进 state.json，否则这三个 Hook 全都无事可判、一律退 0——
那是整条流水线最核心的护栏。`gate --check` 通过后必须把闸门放行回 `idle`，
否则补齐裁决的人依然被拦，唯一出路是关掉 Hook。

`hook-pre-commit` 除了依赖 `if` 字段，还自行解析 git 子命令：跳过全局选项后取第一个
非选项词。用 `/git.*commit/` 这类正则会把 `git log --format=commit` 误判成提交。

---

## 八、`~/.trivium/runs/`：项目外的运行目录

两侧原始 stdout、工具轨迹副本、临时配置副本一律落在**项目根之外**：

```
~/.trivium/runs/<repo_id>/<run_id>/<critic>/{out,trace}/
```

这是隔离机制的一部分：审查进行中，对方**本次**结论在项目树内物理不存在
（§10.1 第 ② 道「延迟落盘」）。原始日志可能含仓库片段，默认保留 30 天。

`<repo_id>` = `<目录名>-<项目根路径 sha256 前 8 位>`，避免不同项目互相覆盖。

---

## 九、CLI 接口一览

| 命令 | 作用 |
| :--- | :--- |
| `doctor` | 逐项实测设计 §3.5 的本机能力探针清单，回填 `probe:` 段 |
| `doctor --selftest` | 临时夹具里真跑整条流水线，14 步核对（桩适配器，零配额） |
| `preflight --stage plan\|code\|bug\|all` | 设计 §8.1 的启动预检，fail-fast，失败零工件 |
| `topic resolve --stage <s> -- <$ARGUMENTS>` | 解析主题/提示语/被审对象/模型覆盖，**纯只读** |
| `review --stage <s>` | 同步跑一次双审（手工调试用） |
| `review --start / --wait / --status / --cancel` | 分段协议 |
| `gate --check` / `--check-artifacts` / `--await-approval` | 裁决完整性 / 最低工件集 / 置人工闸门 |
| `gate hook-*` | Hook 入口，从 stdin 读事件。**不应由人直接调用** |
| `approve` / `abandon` | 人工审批 / 放弃闸门 |
| `verify --topic <t>` | 执行显式配置的编译测试命令并落盘记录 |
| `report --topic <t>` | 主题级复盘 |
| `status` | 闸门、运行、降级与争议 |
| `init` | 在项目内布置运行时（幂等） |

参数细节见 `trivium --help`，它与实现同源、不会脱节。
