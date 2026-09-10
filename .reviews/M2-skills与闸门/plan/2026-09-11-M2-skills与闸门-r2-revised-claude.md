---
schema: trivium.disposition.v1
topic: M2-skills与闸门
stage: plan
role: claude
kind: revised
run_id: 20260910T221346Z
addresses:
  - 2026-09-11-M2-skills与闸门-r2-gemini.md
  - 2026-09-11-M2-skills与闸门-r2-glm.md
---

# M2 实施计划（修订版）：skills 与闸门

> - **作者**：Claude Code（Driver）
> - **日期**：2026-09-11
> - **本件性质**：对第 2 轮双审 15 条意见的逐条裁决 + 据此修订的实施计划
> - **原稿**：[`2026-09-11-M2-skills与闸门-claude.md`](./2026-09-11-M2-skills与闸门-claude.md)（原稿保留，未改写）
> - **双审**：[`-r2-gemini.md`](./2026-09-11-M2-skills与闸门-r2-gemini.md)（6 条）、[`-r2-glm.md`](./2026-09-11-M2-skills与闸门-r2-glm.md)（9 条）

## 0. 裁决总览

15 条意见**全部接受**，无驳回、无暂缓。这不是敷衍：逐条核对后确实没有一条是误报，
其中 6 条指向的是「按原稿实现必然失败」的缺陷，而不是风格偏好。

两侧位置集合的 Jaccard = 0.43，未触及 §9.3 的 0.8 退化阈值。有价值的互补有两处：

- **ZCode 独有的 GLM-02**（Bash 工具超时未抬高）是 gemini 完全未覆盖的一条，
  而它直接决定 M2 完成判据 1 能否达成；
- **两侧共同命中 stdio 未规定**（AGY-01 与 GLM-03 从不同角度指出同一缺陷：
  gemini 从「worker 死于 SIGPIPE」入手，ZCode 从「`--start` 调用挂住不返回」入手）。
  按 §6.6 规则 7，共同意见若被驳回需告警——本件全部接受，不触发。

## 1. 逐条裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | blocker | 接受 | 确认成立且是我本会写出的 bug。Node 的 `child_process.spawn` 只做单次 fork+exec，`detached: true` 本身即 POSIX `setsid`，「双 fork」是 C 时代守护进程技巧、在 Node 里无对应物；更关键的是原稿完全没规定 stdio 去向，继承父进程管道后父进程一退出 worker 必死于 SIGPIPE | 修订版 §2.1 用确定的 `spawn` 选项表替换模糊措辞，钉死 `detached` + `stdio` 重定向 + `unref()` + 忽略 SIGHUP；§6 风险 R-A 的验收改为两条可断言的判据 |
| AGY-02 | gemini | blocker | 接受 | 确认成立。原稿把 no-op 判据放在 wrapper **内部**，但 wrapper 文件本身缺失时 shell 返回 127、`loadCtx` 抛 `envError` 返回 69，两者都不是 0，「no-op 铁律」根本没有执行机会。设计 §8.5 注②只论证了「127 ≠ 2 故不阻断」，没论证「不产生噪音」——每次工具调用都报一次钩子错误是真实的可用性问题 | 修订版 §2.3 把守卫上移到 hook 命令层（`test -x … \|\| exit 0` 前置短路），并重新定义三档退出码语义 |
| AGY-03 | gemini | major | 接受 | 确认成立。原稿只为 `hook-pre-write` 定义了「同会话 + 24h TTL」作用域，`hook-pre-commit` 完全没界定，等于对仓库内任何 `git commit` 都可能拦截 | 修订版 §2.3 明确 `hook-pre-commit` 仅在「本会话存在未裁决阶段」时拦截，无活跃主题一律放行 |
| AGY-04 | gemini | major | 接受 | 确认成立。原稿写了「`parse_fallback` 侧按 `<前缀>-F<n>` 编号」，但没说这些虚拟编号要在算「多余 id 差集」**之前**滤除；也没说 `findings: []` 的空集怎么过。按原稿实现会把合法的空审判成硬失败 | 修订版 §2.2 补充校验集合的拆分顺序与空集处理 |
| AGY-05 | gemini | minor | 接受 | 确认成立。原稿三节全是交付物与顺序，通篇无测试规划。M2 涉及多进程派生、心跳失联、畸形 Markdown 解析，这些恰恰是最需要夹具的部分 | 修订版新增 §5「测试规划」，逐交付物列出测试文件与关键场景 |
| AGY-06 | gemini | minor | 接受 | 确认成立，且与 GLM-04 指向同一处但角度不同：gemini 关注「早期猝死造成最长 120s 死锁窗口」，ZCode 关注「PID 复用造成永不回收」。两者都要修 | 修订版 §2.5 的锁回收判据同时解决两者 |
| GLM-01 | glm | major | 接受 | 确认成立，且比 AGY-02 更进一步指出了根因：`.claude/settings.json` **随 Git 分发**，而 wrapper 与 `.trivium/bin` 是 `init` 在本机生成、**不随 Git 分发**。协作者克隆后未跑 `init` 就会每次工具调用报错。这是 AGY-02 的上位描述 | 与 AGY-02 合并落在修订版 §2.3；另按其建议在验收判据 3 的夹具中增加「hooks 已分发但本机未 init」与「config.yaml 存在但 wrapper 缺失」两个场景（见 §5） |
| GLM-02 | glm | major | 接受 | 确认成立，且这是本次最有价值的一条——gemini 完全未覆盖。`--wait` 默认 540s，但 skill 契约（设计 §7.4 步骤 3）与原稿都没规定把该次 Bash 调用的工具级超时从默认 120s 抬到 600s 上限。按现状实现首个 `--wait` 必在 120s 被杀，完成判据 1 首跑即失败。**本次会话亲历同类失败**：我同步跑这次双审时被 600s 工具超时移到后台 | 修订版 §2.4 钉死每个 `--wait` 调用必须显式携带 600s 工具超时，并定义被工具超时杀掉时的记账方式 |
| GLM-03 | glm | major | 接受 | 确认成立。与 AGY-01 互补：AGY-01 关注 worker 侧（SIGPIPE 猝死），GLM-03 关注调用侧（`--start` 的 Bash 调用因管道 EOF 不闭合而挂到 worker 退出）。后者直接违反「`--start` 立即返回」的契约。另外其指出的「现有 `util/exec.ts` 的 `run()` 只有 pipe 模式、没有 detached 分支」属实 | 修订版 §2.1 的 spawn 选项表同时解决；`util/exec.ts` 需新增 `spawnDetached()`，列入 §2.1 交付物 |
| GLM-04 | glm | major | 接受 | 确认成立。macOS PID 复用频繁，`kill(pid, 0)` 成功不能证明是原进程。原稿又没给任何兜底（无 TTL-only 回收、无 `--cancel`），一旦误判就把主题永久锁在退出码 70 上。其建议的「比对进程启动时刻」与「rename → 复验 → 删除」防并发双回收都成立 | 修订版 §2.5 重写锁回收判据；`--cancel` 按 GLM-09 一并补回 |
| GLM-05 | glm | minor | 接受 | 确认成立，且交叉引用很准：macOS 没有 `setsid` 命令行工具，与 M0 坑 P-01「无 `timeout`」同类。三种表述并存会诱导实现者去 shell 层拼命令，重蹈已钉死过的坑 | 修订版 §2.1 统一为唯一机制（Node `spawn` 的 `detached`），删除「setsid/双 fork」字样 |
| GLM-06 | glm | minor | 接受 | 确认成立。原稿把 `--wait` 的全部判定压在 `status.json` 上，却没定义它的生命周期：首次心跳前崩溃时文件不存在怎么算、30s 重写时的撕裂读怎么防。§2.5 的「读→改→原子替换」只列了 `state.json`/`task.json`，漏了 `status.json` | 修订版 §2.1 把 `status.json` 纳入同一条原子替换纪律，并定义缺失与解析失败两种情形的判定 |
| GLM-07 | glm | minor | 接受 | 确认成立。「内部异常返回 1」没给「config 存在但损坏」分类，它不是程序缺陷而是环境不完整。no-op 的语义应当覆盖「判定不了」，而不只是「判定为未初始化」——这个区分我原先没想清楚 | 修订版 §2.3 的三档退出码语义把「无法确认存在合法 config」整体归入 exit 0 |
| GLM-08 | glm | minor | 接受 | 确认成立。`gate --check` / `--await-approval` / `/dual-approve` / `/dual-abandon` / `hook-stop` 计数都在 review 进程结束、锁已释放之后写 `state.json`/`task.json`。原子替换只防撕裂不防丢更新，两个并发写者会互相覆盖 | 修订版 §2.5 把规则改写为「所有读改写都经同一把短临界区主题锁」，并给 hook 计数器一条免锁替代方案 |
| GLM-09 | glm | minor | 接受 | 确认成立。设计 §7.5 的协议是四个子命令，原稿只交付两个且未声明裁剪，违反 §16.2 纪律。且缺 `--status` 会让 `hook-session-start` 的「提醒先 `--wait`」缺一个只读入口，缺 `--cancel` 会让 GLM-04 的卡死场景没有任何工具化恢复路径 | 修订版 §2.1 把 `--status` / `--cancel` 一并列入交付物，不裁剪 |

**统计**：接受 15 ｜ 驳回 0 ｜ 暂缓 0。共同命中项（AGY-01+GLM-03、AGY-02+GLM-01、AGY-06+GLM-04）均已接受，不触发 §6.6 规则 7 的告警。

---

## 2. 修订后的交付物

### 2.1 长时调用协议：四个子命令（原为两个）

依 GLM-09，四个子命令一次做完 —— `--status` 与 `--cancel` 共用同一条 `status.json` 读取路径，边际成本极低。

| 子命令 | 行为 | 返回 |
| :--- | :--- | :--- |
| `review --start` | 预检 → 冻结送审包 → 写 `run.json`(`running`) → 派生工作进程 → **秒级返回** | `0` + `run_id`、`max_waits` |
| `review --wait <id> --timeout <s>` | 轮询 `status.json`，最多等 `<s>` 秒 | `0` 完成 ｜ `73` 仍在运行 ｜ `75` 严格模式单侧失败 |
| `review --status <id>` | 只读一次状态，不等待 | 同上 |
| `review --cancel <id>` | SIGTERM → SIGKILL，标 `cancelled`，回收锁 | `0` |

**工作进程派生规约**（依 AGY-01 / GLM-03 / GLM-05，替换原稿的「setsid/双 fork」）：

唯一机制是 Node `child_process.spawn` 的 `detached` 选项——它本身就完成 POSIX `setsid`。
**不使用** shell 层的 `setsid`（macOS 无此命令，同 M0 坑 P-01），**不存在**「双 fork」这一步。

```ts
const logFd = await fs.open(path.join(runDir, 'worker.log'), 'a');
const child = spawn(nodePath, [triviumCjs, 'review', '--worker', runId], {
  cwd: projectRoot,
  detached: true,                          // = setsid，脱离控制终端
  stdio: ['ignore', logFd.fd, logFd.fd],   // 关键：不继承父进程管道，否则
                                           // ① 父退出后 worker 死于 SIGPIPE（AGY-01）
                                           // ② 管道 EOF 不闭合，--start 挂住不返回（GLM-03）
});
child.unref();                             // 父进程不等它
await fs.writeFile(path.join(runDir, 'worker.pid'), `${child.pid}\n`);
```

worker 进程内首行注册 `process.on('SIGHUP', () => {})` 忽略挂断信号。
`util/exec.ts` 需新增 `spawnDetached()`——现有 `run()` 只有 pipe 模式（GLM-03 指出属实）。

**`status.json` 生命周期**（依 GLM-06）：

- 写入纳入与 `state.json` / `task.json` 相同的「读 → 改 → 原子替换」纪律（临时文件 + rename）；
- **文件不存在** = 尚未产生有效心跳，与「进程是否存活」合并判定：进程活 → 继续等；进程死 → `failed(worker_lost)`；
- **解析失败** = 本次轮询无效，继续等并计入 `--timeout` 预算，不立即判失败。

### 2.2 `gate` 裁决完整性校验

六项硬规则 + 两项默认 warning 照设计 §8.6 不变。依 AGY-04 补充**校验集合的拆分顺序**：

1. 先从裁决表编号中滤出匹配 `<前缀>-F<序号>` 的 `parse_fallback` 虚拟编号，单独成集 `FB`；
2. 用剩余编号与结构化 `findings` 的 id 集合做双向差集（缺 id / 多余 id）——`FB` **不参与**这一步，否则会被判成「多余 id」；
3. 对 `FB` 只校验「有裁决且理由非空」，不参与阻断判定；
4. **`findings: []` 显式合法**：单侧或双侧空集时，IDS 为空集，差集校验自然通过，不得判硬失败。

### 2.3 Hook 三件套

**no-op 守卫上移到 hook 命令层**（依 AGY-02 / GLM-01）。根因是 `.claude/settings.json` 随 Git 分发，
而 wrapper 与 `.trivium/bin` 是 `init` 在本机生成、**不随 Git 分发**，因此「协作者克隆后未跑 init」
是必然会发生的常态，不是边缘情况。`trivium init` 写入的 hook 命令形如：

```sh
sh -c 'W="${CLAUDE_PROJECT_DIR}/.trivium/bin/trivium"; test -x "$W" || exit 0; exec "$W" gate hook-pre-write'
```

**退出码三档语义**（依 GLM-07 重新定义，替换原稿的「内部异常返回 1」）：

| 情形 | 退出码 | 理由 |
| :--- | :--- | :--- |
| 无法确认存在**合法** config：wrapper 缺失、`.trivium/config.yaml` 缺失、不可读、schema 不合 | `0` | no-op 的语义是「判定不了就别管」，不只是「判定为未初始化」 |
| 读到合法 config 且**明确判定**应当拦截 | `2` | 唯一返回 2 的路径 |
| 真正的程序缺陷（hook 子命令自身抛错） | `1` | 非阻断；同时打 `TRIVIUM_DEBUG` 日志便于事后归因 |

**`hook-pre-commit` 作用域**（依 AGY-03）：仅当 `state.json` 记录**本会话**存在处于
`review_done_awaiting_disposition` 的未裁决阶段时才拦截；无活跃流水线主题一律 `exit 0`。
不对仓库内的日常提交设任何默认拦截。

`hook-pre-write` 的作用域仍为「同会话 + 24h TTL」（`approval_lock_scope: session`），不变。

### 2.4 入口 skill 的 Bash 工具超时（新增节，依 GLM-02）

七个入口 skill 中**每个** `--wait` 调用必须显式携带 **600s** 工具级超时
（`review.wait_timeout_s` 默认 540，留 60s 余量给进程收尾与输出）。
这一条要写进 SKILL.md 的执行契约正文，不能只依赖默认值——Bash 工具默认超时是 120s。

**被工具超时杀掉时的记账**：该次视为「一次失败的等待」，计入 `max_waits` 预算后重试
（工作进程不受影响，仍在跑）。这是**非退出码失败**，skill 契约需显式说明：
看不到退出码时按「仍在运行」处理，继续下一次 `--wait`。

`review --wait` 启动时自检可用余量：若环境把 `BASH_MAX_TIMEOUT_MS` 调到低于
`wait_timeout_s`，直接报错而不是等着被杀。

### 2.5 主题锁与状态文件

**锁文件内容**新增进程启动时刻。**回收判据**（依 GLM-04 / AGY-06 重写）：

判定为遗留锁需满足以下**任一**条件，不再要求「PID 不存在」这个不可靠的必要条件：

1. `process.kill(pid, 0)` 抛 `ESRCH`（进程确实不存在）；
2. 进程存在，但 `ps -p <pid> -o lstart=` 取得的启动时刻与锁内记录**不符**
   —— 这一条专治 macOS 的 PID 复用（GLM-04）；
3. `status.json` 缺失或心跳超过 `heartbeat_stale_s`，且运行目录下的 `run.json`
   已被标为终态 —— 这一条消除 AGY-06 指出的「早期猝死造成的 120s 死锁窗口」，
   不必等满 TTL。

**回收动作防并发双回收**（依 GLM-04）：读到遗留锁 → `rename` 成唯一临时名 →
复验内容与预期一致 → 删除。两个并发 `--start` 只有一个能 rename 成功。

**`state.json` / `task.json` 的写入纪律**（依 GLM-08 改写）：

原稿的「只在持锁时写」覆盖不全——`gate --check`、`gate --await-approval`、
`/dual-approve`、`/dual-abandon` 都在 review 进程结束、锁已释放之后写。改为：

> **所有**对 `state.json` / `task.json` 的读改写都必须经同一把主题锁的**短临界区**
> （try-lock，拿不到即退避重试，超过上限则报错而非静默丢更新）。
> review 工作进程的长持锁只是其中一种持锁者，不是唯一。

`hook-stop` 的每阶段阻断计数不适合加锁（hook 有 30s 超时预算），改为
**单独的计数文件 + `O_EXCL` 重试自增**，与主状态文件解耦。

### 2.6 七个入口 skill + 核心 skill

不变：入口 skill 是薄壳，全部 `disable-model-invocation: true`，
核心 skill `dual-critic` 设 `user-invocable: false`。新增约束见 §2.4。

### 2.7 安装器与 `trivium init`

不变，但 `init` 写入 hook 命令时必须采用 §2.3 的短路守卫形式。

---

## 3. 实施顺序（微调）

1. `util/exec.ts` 的 `spawnDetached()` + 主题锁与 `state.json`（锁是其它一切的前提）；
2. `review --start/--wait/--status/--cancel` 四件套 + `status.json` 纪律；
3. `gate --check` 裁决校验（含 §2.2 的集合拆分）；
4. Hook 三件套 + §2.3 的命令层守卫；
5. 七个入口 skill（含 §2.4 的工具超时契约）；
6. 安装器与 `trivium init`。

---

## 4. 完成判据（在原四条上补两条）

原四条不变。依 GLM-01 / GLM-02 补：

5. **hooks 已分发但本机未 `init`** 的仓库里，任何工具调用都不产生钩子报错（退出码 0，无 stderr 输出）；
6. `/dual-review-plan` 首个 `--wait` 调用**不被 Bash 工具超时杀掉**（判据 1 的具体化）。

---

## 5. 测试规划（新增节，依 AGY-05）

| 交付物 | 测试文件 | 关键场景 |
| :--- | :--- | :--- |
| `spawnDetached` | `test/integration/worker-detach.test.ts` | 父进程退出后 worker 仍存活（真实断言，不是 mock）；`--start` 秒级返回；stdio 重定向到日志文件而非管道 |
| 主题锁 | `test/unit/lock.test.ts` | 并发 `--start` 第二个返回 70；PID 不存在 → 回收；**PID 存在但启动时刻不符 → 回收**（GLM-04）；早期猝死不等满 TTL 即可回收（AGY-06）；并发双回收只有一个成功 |
| `status.json` | `test/unit/status.test.ts` | 文件缺失 + 进程活 → 继续等；文件缺失 + 进程死 → `worker_lost`；撕裂读（写入一半的 JSON）→ 本次轮询无效继续等 |
| `gate --check` | `test/unit/gate.test.ts` | 缺 id / 多余 id / 理由为空 / 接受无落点 → 硬失败并报出编号；`findings: []` → 通过；`<前缀>-F<n>` 虚拟编号不被判「多余 id」；空洞理由 → warn 不 fail；共同 blocker 被驳回 → warn |
| 裁决表解析 | `test/unit/disposition-parse.test.ts` | 全角/半角标点混用；多行单元格；列顺序调换；表格前后有正文；「不接受」归一化为「驳回」 |
| Hook 守卫 | `test/integration/hook-noop.test.ts` | wrapper 缺失 → exit 0 无输出；`config.yaml` 缺失 → exit 0；**config 存在但损坏 → exit 0**（GLM-07）；明确判定拦截 → exit 2；子命令抛错 → exit 1 |
| `hook-pre-commit` | 同上 | 无活跃主题的日常 `git commit` → 放行（AGY-03） |

夹具需要一个**未 `init` 的临时 git 仓库** + 一份已分发的 `.claude/settings.json`，
用来复现 GLM-01 指出的「克隆机」场景。

---

## 6. 风险登记（修订）

| # | 风险 | 对策 | 验收 |
| :--- | :--- | :--- | :--- |
| R-A | 工作进程脱离父进程失败 | §2.1 的 spawn 选项表（`detached` + stdio 重定向 + `unref` + 忽略 SIGHUP + pid 文件） | **两条断言**：① 父进程退出后 worker 仍存活；② `--start` 秒级返回（依 GLM-03 改写，原稿只有一条模糊判据） |
| R-B | Stop Hook 与闸门死循环 | 不变：`stop_hook_active` 早退 + 每阶段 2 次上限 + Claude Code 自身 8 次硬上限 | 三层保护各自单测 |
| R-C | 裁决表 Markdown 解析易碎 | 列名归一化；失败时报具体行号 | §5 的 `disposition-parse` 用例集 |
| R-D | `.claude/settings.json` 已有用户 hooks，合并覆盖 | 按事件名追加而非替换；写前备份；冲突提示不强改 | 夹具含已有 hooks 的 settings.json |
| **R-E** | Bash 工具超时杀掉 `--wait`（新增，依 GLM-02） | SKILL.md 显式携带 600s；`--wait` 启动时自检余量；被杀按「仍在运行」记账 | 完成判据 6 |
| **R-F** | macOS PID 复用导致遗留锁永不回收（新增，依 GLM-04） | 三条回收判据取「任一」；rename → 复验 → 删除防并发；`--cancel` 兜底 | §5 的 `lock` 用例集 |

---

## 7. 不做的事（不变）

- 不实现反驳轮（设计 §18.1 #6）；
- 不做 plugin 形态分发（AD-13 二期备选）；
- 不用 async Hook（AD-03 已否决）。

---

## 8. 需要回补修订设计文档的项

按 §16.2 纪律 1，下列实测/评审结论与设计文档不一致，需回补：

| 设计位置 | 需修订内容 | 来源 |
| :--- | :--- | :--- |
| §7.5 `--start` 行为 | 「以 `setsid`/双 fork 派生工作进程」应改为 Node `spawn` 的 `detached` 选项，并补 stdio 重定向要求 | AGY-01 / GLM-05 |
| §7.4 步骤 3 | 需补「该次 Bash 调用必须携带 600s 工具级超时」 | GLM-02 |
| §8.5 Hook 配置 | hook 命令需改为带存在性短路守卫的形式；注②的「非 2 非零码属非阻断」需补充「但会产生噪音，故仍需短路」 | AGY-02 / GLM-01 |
| §12.6 遗留锁回收 | 「PID 不存在且时间戳早于 `heartbeat_stale_s`」应改为三条判据取「任一」，并补进程启动时刻比对 | GLM-04 / AGY-06 |
| §12.6 状态写入 | 「只在持锁时进行」需明确覆盖 `gate` / `approve` / `abandon` / `hook-stop` 等锁释放后的写者 | GLM-08 |
