# RUNBOOK：双审流水线运行期故障处置

面向**已经装好并在用**的场景。装不上、跑不通第一条任务属于安装问题，看
[`QUICKSTART.md`](../07_manuals/QUICKSTART.md) 第 1、3 节；本文只管**跑起来之后卡住了**。

> 处置总原则：**先 `trivium status` 看清楚状态，再动手。**
> 本流水线大量状态（闸门、锁、留痕）是故意做成难以绕过的（设计原则 P5「不可伪装」、
> P6「只追加不覆盖」）。绕过它们通常意味着你在破坏这次审查的可信度，
> 而不是在解决问题。下面每条都给了**正规出口**，请优先用。

---

## 零、先做这一步

```bash
trivium status                 # 全部主题的闸门、运行、降级与争议
trivium status --topic <主题>   # 只看一个主题
trivium status --json          # 要脚本处理时
```

它会告诉你：闸门停在哪个状态、有没有运行中的 run、哪一侧降级了。
**下面所有条目的入口都是这里看到的状态。**

---

## 一、退出码速查

| 码 | 含义 | 是不是故障 |
| :--- | :--- | :--- |
| `0` | 成功 | 否 |
| `1` | 一般失败 | 是，看 stderr |
| `2` | 闸门阻断 | **否**，是护栏按预期工作 → 见 §三 |
| `64` | 参数错误（缺提示语、模型 slug 非法、主题名非法） | 是，改命令 |
| `65` | 前置产物缺失（找不到计划 / 根因材料 / 无代码变更） | 是 → 见 §六 |
| `69` | 环境或预检失败（CLI 不可调用、未认证、非 git 仓库、归档根不可写） | 是 → 见 §五 |
| `70` | 同主题已被锁 | 是 → 见 §二 |
| `73` | 运行仍在进行中（仅 `review --wait`） | **否**，继续下一次 `--wait` |
| `75` | 严格模式中止（超时或单侧失败） | 是 → 见 §四 |

`2` 和 `73` 最容易被误判成故障。`2` 是闸门在挡你，`73` 是还没跑完。

---

## 二、主题被锁（exit 70）

**现象**：`review` 或 `/dual-*` 报「同主题已有运行持锁」，带一个 `run_id`。

锁文件在 `.trivium/lock/<主题>.lock`，不进 Git。

### 先判断是真在跑还是遗留锁

```bash
trivium review --status <run_id>
```

编排器**会自动回收遗留锁**，判据四条取其一（`src/trivium/lock.ts` 的 `judgeStale`）：

| 判据 | 含义 |
| :--- | :--- |
| `pid_gone` | 持有者进程没了 |
| `pid_reused` | PID 还在但启动时刻对不上——是被系统复用的无关进程 |
| `heartbeat_dead` | 运行已是终态，或短临界区持有超过心跳阈值 |
| `unparsable` | 锁文件内容坏了，无法判定持有者 |

回收时会打印 `回收主题「X」的遗留锁（原因 …）`。**看到这行说明已自动处理，重跑即可。**

### 确实还在跑，但你想停掉

```bash
trivium review --cancel <run_id>
```

SIGTERM → 宽限 → SIGKILL，按**进程组**杀（厂商 CLI 会派生子进程，只杀父进程杀不干净），
标 `cancelled` 并回收锁。

> `--cancel` **不会**改写已经终态（`success` / `failed` / `cancelled`）的运行，
> 也不动闸门。那一轮的闸门可能正等着裁决，不该因为一次误敲就被清掉。

### 最后手段

手删 `.trivium/lock/<主题>.lock`。**只在上面两条都不奏效时用**，且先确认没有 `trivium`
进程在跑，否则两个运行会同时写同一个主题目录。

---

## 三、闸门挡住了你（exit 2）

这不是故障。三个 Hook 按状态机挡三种动作：

| Hook | 挡什么 | 什么状态下挡 |
| :--- | :--- | :--- |
| `hook-pre-write` | 业务文件写入 | `awaiting_approval`（等人工审批）、`running`（审查进行中，改了会造成快照漂移） |
| `hook-pre-commit` | `git commit` | 同上，外加留痕完整性校验失败 |
| `hook-stop` | 收工 | `review_done_awaiting_disposition`（裁决件没齐） |

### 闸门状态与出口

```
idle → running → review_done_awaiting_disposition → awaiting_approval → approved / rejected
                                                                      ↘ abandoned
```

| 卡在 | 为什么 | 正规出口 |
| :--- | :--- | :--- |
| `running` | 审查进行中 | 等它跑完；或 `review --cancel <run_id>` |
| `review_done_awaiting_disposition` | 审查意见没逐条裁决 | 补齐裁决件（接受/驳回/暂缓 + 理由，接受要写落点），再 `trivium gate --stage <s> --topic <主题> --check` |
| `awaiting_approval` | 等你人工审批 | `/dual-approve --topic <主题>`；不想继续就 `/dual-abandon --topic <主题>` |

### 裁决校验不过

`gate --check` 会拒绝**空洞理由**（`isHollowReason`）——「已知悉」「后续再说」这类
不构成裁决。它还会检查两侧**共同标记为 blocker 却都被驳回**的项
（`findJointRejectedBlockers`），那需要显式理由。

### 想彻底退出这个主题

```bash
/dual-abandon --topic <主题>              # 放弃该主题下全部未关闭闸门
/dual-abandon --topic <主题> --stage code # 只放弃一个阶段
```

留痕**不会**被删除——`abandoned` 是一个被记录的终态，不是撤销。

### 跨仓库误拦

本项目的闸门**不应该**挡住对其它仓库的提交。`hook-pre-commit` 会跟踪命令段落里的
当前目录（`cd` 更新它，`git -C` / `--work-tree` / `--git-dir` 覆盖该段目标），
目标能确认在项目外才放行。**推断不出的一律按项目内处理**（`cd $VAR`、`cd -`、
`git -C "$REPO"`）——漏拦一次违规提交的代价大于多拦一条命令。

> ⚠️ PreToolUse 在命令**执行前**判定。所以「同一条 Bash 命令里先解除闸门、再 git commit」
> 会被拦——判定时闸门还在。**拆成两步执行。** 这是 Hook 语义，不是缺陷。

---

## 四、审查跑挂了

### 一侧超时（默认 strict → exit 75）

默认策略是 strict：**一侧超时就中止整次运行**，不产出半个双审。

```bash
# 调整超时：.trivium/config.yaml 的 review.timeout_s
# 或临时降级为单审（会被明确标记为降级，不是双审）
trivium review --stage <s> --topic <主题> --allow-single …
```

`--allow-single` 的产出会在 `_meta/run-*.json` 留下降级原因，缺失侧记为
`review-<critic>-<run_id>.failed.json`。**这不是双审**，复盘时算降级。

### 某侧被判「证据不足」

该侧读的项目文件数或工具调用数没达下限——通常意味着它没真读代码就下了结论。

```bash
cat .reviews/<主题>/<阶段>/_meta/run-*.json   # 看 tool_calls 与 project_reads
```

### 输出解析失败（`parse_fallback`）

厂商没按 `trivium.review.v1` 契约返回。编排器会降级为文本解析并标记，
审查结论仍然落盘。看 `_meta/review-<critic>-<run_id>.json` 原文。

### 工作进程半路死了（`worker_lost`）

`--wait` 会报 `worker_lost` 并释放闸门。原始 stdout 在**项目外**：

```bash
ls ~/.trivium/runs/<repo_id>/<run_id>/<critic>/
```

默认保留 30 天。**它可能含仓库片段，所以不在项目树内**，也不进 Git。

### 会话启动时的自动清扫

`hook-session-start` 会扫除持有者已死的 `running` 闸门（`sweepDeadRunningGates`）。
新开一个 Claude Code 会话通常能自动清掉上次崩溃遗留的 `running` 状态。

---

## 五、环境与厂商侧（exit 69）

```bash
trivium preflight --stage <s>   # 会指出是探针过期、CLI 不可调用还是未认证
trivium doctor                  # 重跑 18 项探针
trivium doctor --only agy       # 只探一侧，省配额
```

| 现象 | 处置 |
| :--- | :--- |
| 厂商 CLI 升级后行为变了 | 重跑 `trivium doctor`。实现代码只读探针结论、不硬编码命令行（设计原则 P7），所以重探通常就够 |
| 配额打满 | 换模型档位，或 `--allow-single` 单侧跑（记为降级） |
| 未认证 | 按厂商自己的登录流程处理。**凭据不经编排器**，配置里只放模型 slug 与路径 |
| 探针结论过期 | `.trivium/config.local.yaml` 的 `probe.generated_at`，重跑 `doctor` 刷新 |

已知的厂商行为坑列在 [`REPORT_2026-09-11_m0_probe.md`](../05_testing/REPORT_2026-09-11_m0_probe.md)。
其中几条值得单独记住：

- `agy` 的 `-p` 进程只活约 10s，实际工作在**跨运行复用的 hub** 里。这意味着
  per-run 的 `HOME` 隔离**对 hub 不生效**。
- ZCode 会把进程名改成 `zcode-cli`，`pgrep -f 'zcode\.cjs'` 永远是空的。
- `agy` 的模型 slug 若已编码 effort（如 `-high` 后缀），再传 `--effort` 会被拒。

---

## 六、留痕相关

### 提交被拦下，说「归档留痕不完整」

已落盘的审查工件被删除或改动了。这是**设计要挡的**（P5 / P6、FR-25）：
留痕的意义恰恰在于它删不掉也改不掉。

校验有三个锚：git 索引（删除一律拦；审查文档、`_meta/` 审计材料与运行清单等**不可变工件**的改动也拦，task.json 与裁决件的正常改动放过）、`task.json` 的 `runs[]`、以及 `.trivium/state.json`（记过运行的主题，其 `task.json` 必须还在——首次提交前 git 没有基线，这是仅剩的锚）。另外 `hook-pre-write` 不允许 Driver 写 `_meta/` 与 `task.json`：它们是锚与 `gate --check` 的事实来源。

**处置**：把被删/被改的文件恢复回去（`git checkout -- <path>`）。
如果你确实想重跑那一轮，正规做法是**再跑一次**——`archive` 以 `O_CREAT|O_EXCL`
原子创建，命中已存在文件即自动抬升 `-r<N>`，原文件字节不变。

### 前置产物缺失（exit 65）

| 阶段 | 缺什么 |
| :--- | :--- |
| `plan` | 找不到 `…-claude.md` 原始计划 |
| `code` | 工作树无代码变更（或变更全被 FR-23 路径分类跳过，如纯文档改动） |
| `bug` | 找不到根因材料 |

`trivium gate --check-artifacts --stage <s> --topic <主题>` 会列出缺哪件。

### 纯文档改动被跳过

FR-23 会把纯文档/配置变更判为无需代码审，在同步窗口内直接收口（`max_waits: 0`）。
这是预期行为，不是失败。

---

## 七、复盘与取证

```bash
trivium report --topic <主题>      # 时间线、采纳率、被驳回项、降级清单、耗时与 token
```

取证材料的位置：

| 要找什么 | 在哪 | 进 Git |
| :--- | :--- | :--- |
| 审查结论（人读） | `.reviews/<主题>/<阶段>/*-{gemini,glm}.md` | 是 |
| 逐条裁决 | `.reviews/<主题>/<阶段>/*-{revised,response}-claude.md` | 是 |
| 送审任务书、结构化结论、运行元数据 | `.reviews/<主题>/<阶段>/_meta/` | 是 |
| 本轮被审补丁 | `_meta/changes-<run_id>.diff` | 是 |
| 两侧原始 stdout、工具轨迹 | `~/.trivium/runs/<repo_id>/<run_id>/<critic>/` | **否**（项目外，30 天） |
| 流水线状态机、锁、日志 | `.trivium/{state.json,lock/,logs/}` | 否 |
| 探针结论与本机绝对路径 | `.trivium/config.local.yaml` | 否 |

---

## 八、确认整套还正常

```bash
trivium doctor --selftest                  # 14 步端到端，用桩适配器，不烧配额
trivium doctor --selftest --keep-fixture   # 保留夹具
```

保留夹具后，在夹具里去掉 `TRIVIUM_STUB_CRITIC` 重跑，可以检验两侧**真实**审查
（会烧配额）。

> ⚠️ **改完 TriviumCode 自身的代码必须重装**，否则你验的是旧产物——
> `.trivium/bin/trivium` 指向已安装的副本，不是你刚改的源码。
> 详见 [`GUIDE_env_setup.md`](../04_development/GUIDE_env_setup.md)。

---

## 九、什么时候该找人而不是自己动手

- 两侧**都**判定同一条为 blocker，而你想全部驳回——`gate --check` 会挡，
  这是故意的，需要显式理由。
- 留痕完整性反复失败且你没动过那些文件——可能是 `task.json` 与实际工件不一致，
  属于编排器缺陷，留下 `trivium status --json` 的输出再排查。
- 探针结论与 [M0 坑清单](../05_testing/REPORT_2026-09-11_m0_probe.md)
  记载冲突——按实现纪律，**改适配层，不改外部产品，也不改验收口径**，同时回补设计文档。
