# M2 实施计划：skills 与闸门

> - **作者**：Claude Code（Driver）
> - **日期**：2026-09-11
> - **依据**：[设计 v1.2.0](../../../doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md) §16.1 里程碑 M2、§7.4、§7.5、§8.4~8.6、§12.6
> - **前置**：M0 探针已完成（见 `doc/05_testing/REPORT_2026-09-11_m0_probe.md`），M1 单阶段闭环已可运行

## 1. 目标与完成判据

设计 §16.1 对 M2 的完成判据是四条：

1. `/dual-review-plan` 端到端可跑，且**单次 Bash 调用不超时**；
2. 删一条裁决即被拦；
3. 同会话闸门期写业务文件被 deny，新会话不被误伤；
4. `disable-model-invocation` 生效。

## 2. 交付物

### 2.1 长时调用协议 `review --start` / `--wait`（设计 §7.5 / AD-03）

这是 M2 的技术核心，也是唯一有真实风险的部分。

Driver 的 Bash 工具有工具级超时（默认 120s，上限 600s），而双审单侧上限 900~1200s、
可重试一次，一次运行墙钟可达 30~40 分钟。因此 `review` 必须拆段：

- `review --start`：预检 → 冻结送审包 → 写 `run.json`（`status: running`）→
  以 `setsid`/双 fork 派生工作进程 → **立即返回** `run_id` 与 `max_waits`；
- `review --wait <run_id> --timeout <s>`：轮询运行目录下的 `status.json`，
  最多等 `<s>` 秒（默认 540，须小于 Bash 工具超时）。退出码 `0` 表示工件已落盘，
  `73` 表示仍在运行，`75` 表示严格模式单侧失败；
- 工作进程每 30s 写心跳；`--wait` 发现心跳超过 `heartbeat_stale_s`（默认 120s）
  未更新且进程不存在时判 `failed(worker_lost)`。

**实现要点**：工作进程的生命周期等于一次运行，跑完即退，不监听、不接受新任务，
因此不是 PRD Non-Goal 所指的常驻 Daemon。

### 2.2 `gate` 裁决完整性校验（设计 §8.6）

按 §8.6 的算法实现，六项硬规则 + 两项默认 warning：
- 硬失败：缺 id、多余 id、裁决取值非法、暂缓但未允许、理由为空、接受但无落点；
- 默认 warning：理由仅含空洞词表（`reason_policy: warn`）、
  双方共同 blocker 被驳回（`joint_blocker_policy: warn`）。

裁决表从 Markdown 正文解析，列名固定。`parse_fallback` 侧按 `<前缀>-F<n>` 编号，
只校验「有裁决与理由」，不参与阻断判定。

### 2.3 Hook 三件套（设计 §8.5）

注入目标项目 `.claude/settings.json`：`PreToolUse`（写入拦截 + `git commit` 拦截）、
`Stop`（裁决未完成不得收工）、`SessionStart`（注入待审批闸门清单）。

**铁律**：Hook wrapper 必须对未初始化项目 no-op —— 检测不到 `.trivium/config.yaml`
一律 exit 0；只在明确判定时返回 2；内部异常返回 1。全局安装不得误伤其它仓库。

闸门写锁的作用域是「同会话 + 24h TTL」（`approval_lock_scope: session`）：
比对 `state.json` 记录的 `session_id` 与 Hook 输入的 `session_id`，
其它会话的闸门只提醒不加锁——PRD 4.4 约束的是流水线不得自动继续，
不是开发者在同一仓库的其它编辑。

### 2.4 七个入口 skill + 核心 skill（设计 §7.4 / AD-13）

入口 skill 是**薄壳**：只负责把人的意图翻译成一串确定性调用，
禁止在其中实现编排逻辑。全部设 `disable-model-invocation: true`，
只允许人用 `/` 触发。核心 skill `dual-critic` 设 `user-invocable: false`。

### 2.5 主题锁与状态机（设计 §12.6）

`.trivium/lock/<主题>.lock` 以 `O_EXCL` 创建，内容为 PID、`run_id`、时间戳。
持锁期间同主题再次 `--start` 返回退出码 `70`。锁文件存在但 PID 不存在且时间戳
早于 `heartbeat_stale_s` 时，视为遗留锁自动回收并记入日志。

`state.json` / `task.json` 的写入一律「读 → 改 → 原子替换」，且只在持锁时进行，
避免 `-r<N>` 计算与状态更新竞争。

### 2.6 安装器 `src/install.ts`

把 `skills/*` 拷到 `~/.claude/skills/`，Agent 定义拷到
`~/.gemini/config/agents/trivium-critic/agent.md`，然后跑一次 `doctor`。
`trivium init` 在目标项目生成 `.trivium/`、合并 Hook 进 `.claude/settings.json`、
幂等写 `.gitignore` 与协议片段，并**逐条展示**探测到的编译测试命令候选供用户确认。

## 3. 实施顺序

1. 主题锁与 `state.json`（其它部分都依赖它做互斥）；
2. `review --start/--wait` 与工作进程派生；
3. `gate --check` 裁决校验；
4. Hook 三件套 + wrapper；
5. 七个入口 skill 与核心 skill；
6. 安装器与 `trivium init`。

## 4. 已知风险

| # | 风险 | 对策 |
| :--- | :--- | :--- |
| R-A | 双 fork 派生的工作进程在 macOS 上可能被父进程退出连带杀死 | 用 `detached: true` + `unref()`，并实测「父进程退出后工作进程仍在跑」 |
| R-B | Stop Hook 与闸门交互产生死循环 | `stop_hook_active` 早退 + 每阶段阻断上限 2 次 + Claude Code 自身 8 次硬上限，三层保护 |
| R-C | 裁决表从 Markdown 解析易碎（列顺序、全角符号、换行） | 列名固定并做归一化；解析失败时报出具体行号而非笼统失败；用夹具覆盖全角/半角、多行单元格 |
| R-D | `.claude/settings.json` 已有用户自己的 hooks，合并会覆盖 | 合并策略按事件名追加而非替换；写前备份；冲突时提示而不强改 |

## 5. 不做的事

- 不实现反驳轮（一期不做，设计 §18.1 #6）；
- 不做 plugin 形态分发（二期备选，AD-13）；
- 不用 async Hook（AD-03 已否决，会与人工停点语义打架）。
