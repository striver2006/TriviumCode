# RUNBOOK：双审流水线运行期故障处置

> 稳定版文档整理（2026-10-18）：本文保留运行期故障与历史取证记录；当前新机安装、升级和卸载见[中文手册](./稳定版部署手册.md)。历史采样中的“尚未完成”等措辞不代表当前统一状态；M11/M12 当前结论以主设计台账及报告末节为准。

2026-10-12第27C普通批准采样：run20261011T212239Z三审有效、零漂移，三意见2暂缓1驳回，gate/await通过、停点业务摘要0；按Bob本轮明确委托由Codex批准code，session=null。两项准入判据仍未采用；新r22保存160份r21原件hash和具体27臂/4跳认证决策方案。下文26B阶段状态按当时采样解释，原false/未测、停止批次和官方Claude待订阅保持，M11前置未完成。

26B已有效审查并按Bob普通委托批准完整r30（SHA 9c457711d4146644d9dedd976cbdf854128283df0802ddf32ba6f4bc0cf75d5c），新CLI inline defaultMode/精确deny差异、有界1..32逐跳原值/hash及v3关闭消费者规范见[设计v1.3.158当前合同](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-inline-mode3-contract)。旧v2/mode2正文按历史采样保留；v3/auth两项独立采用仍未批准，原标准false/未测不改。实施采样：Qwen max一次真实CLI取得default与受控机制事实，事后proof错误使首批停止；修正后只读复算通过，原停止保留，k3及其他组合未启动。27C预检正常刷新三项认证时间，4跳/27臂/378组件/91引用重验通过，当前6a2c6213 canonical0通过/12未测。r21实际消费者先核15依赖及独立批准，忽略调用方事实布尔值，再重验原件/完整指纹/scope；候选报告消费与产品准入分列，实际两个候选缺批准保持关闭，正向实际独立批准消费未测。准入734/742、review353/363全部完成，正式26/27，27C尚未启动，M11前置未完成。

25B后取证执行见[设计v1.3.157](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-evidence-guard-contract)与r19批准检查点。首个auto/default失败与旧原列保留；mode2绑定本次run/定稿hash/具名敏感批准及脚本/来源指纹，任一失败停止。限额/关闭/迟到错误须聚合，清理全部尝试；启动清单和硬上限事前发布，普通扩容不批准判据采用。

面向**已经装好并在用**的场景。装不上、跑不通第一条任务属于安装问题，看
[`QUICKSTART.md`](../07_manuals/QUICKSTART.md) 第 1、3 节；本文只管**跑起来之后卡住了**。

> 处置总原则：**先 `trivium status` 看清楚状态，再动手。**
> 本流水线大量状态（闸门、锁、留痕）是故意做成难以绕过的（设计原则 P5「不可伪装」、
> P6「只追加不覆盖」）。绕过它们通常意味着你在破坏这次审查的可信度，
> 而不是在解决问题。下面每条都给了**正规出口**，请优先用。

---

## 零、先做这一步

2026-10-09 接入诊断：先核对本轮解析的模式/profile/模型/effort，再检查该路线入口和指纹。Claude 每条路线的能力结论独立，包装器、profile配置或底层CLI版本变更后须重跑同路线 doctor；不能用原生结论证明 profile。认证缓存按实际组合隔离；已知不存在的 profile 或相互冲突的 native/profile 退64，环境不可用69。不自动换路线，不修改全局凭据。v3 中 null 表示无回读，unknown 表示模型族无法确认；均不可据此宣称异构已证明。

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
| `73` | 运行仍在进行中（仅 `review --wait`） | **否**，向用户播报进度后继续下一次 `--wait` |
| `75` | 严格模式中止（超时或单侧失败） | 是 → 见 §四 |

`2` 和 `73` 最容易被误判成故障。`2` 是闸门在挡你，`73` 是还没跑完。

### 等待期的进度反馈

`73` 返回里带 `progress_brief`（单行成品摘要）与结构化进度
（`elapsed_s` / `budget_s` / `pct` / `waits_done` / `max_waits` / `sides`）。
Driver 被要求**每次都向用户播报**那一行，不是只打印到工具输出——设计 7.5.1。

**调节反馈密度**：改项目 `.trivium/config.yaml` 的 `review.wait_timeout_s`。
它既是单次等待窗口，也是用户能收到进度的最小间隔（Bash 工具在命令退出前不回传
stdout，窗口内 Driver 说不了话）。默认 180s；调小更密，代价是等待往返变多，
code 阶段大补丁下可到数十次。

> **升级已有项目的配置只能手工改。** `trivium init` 对已存在的 `config.yaml`
> 无条件跳过、绝不覆盖，重跑它改不了 `wait_timeout_s`。新默认值只对
> 全新 `init` 出来的项目生效。

`pct` 的分母是**单阶段超时**，不含重试预算；一侧触发重试、墙钟超出预算后，
摘要不再显示百分比，改说「已超单次预算 · 重试收尾中」。此时 `waits_done/max_waits`
仍有余量是正常的——两者分母本就不同源，这是有意的取舍，不是计数错乱。

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
| `heartbeat_dead` | 运行已是终态，或短临界区持有超过持有超时——`heartbeat_stale_s` 与 30 秒取大（EV-161）：阈值配得再小，活着的临界区持有者 30 秒内也不会被回收，等待的命令约 3～4 秒后退 `70`，稍后重试即可 |
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

这不是故障。四个 Hook 按状态机挡四种动作：

| Hook | 挡什么 | 什么状态下挡 |
| :--- | :--- | :--- |
| `hook-pre-write` | 业务文件写入（Edit / Write） | `awaiting_approval`（等人工审批）、`running`（审查进行中，改了会造成快照漂移） |
| `hook-pre-bash` | 像在改动工作树的 Bash 命令（重定向、`tee`、`sed -i`、`rm/mv/cp`、`git checkout` …，启发式） | 同上；对审查文档 / `_meta/` / `task.json` / `state.json` / `.trivium/bin` 的写命令则任何时候都挡。判定在**未剥离 heredoc 的原文**上做：`python3 - <<'PY' … PY` 的正文若指向上述对象同样拦，代价是正文里出现这些路径字面量的无害命令会被误拦（改用 Write 工具即可） |
| `hook-pre-commit` | `git commit`，含 `sh -c 'git commit …'` 这类被引号整段包裹的形态 | 同上，外加留痕完整性校验失败。它挂在**全部** Bash 事件上而不是靠 `if: Bash(git commit:*)` 过滤——那是前缀匹配，包裹形态不以 `git commit` 开头，会整个漏掉 |
| `hook-stop` | 收工 | `review_done_awaiting_disposition`（裁决件没齐） |

### 闸门状态与出口

```
idle → running → review_done_awaiting_disposition ──gate --check──┬─ entry B/C/D ─→ awaiting_approval ─→ approved / rejected
                                                                  │                                   ↘ abandoned
                                                                  └─ entry A / 无 entry ─→ idle
```

| 卡在 | 为什么 | 正规出口 |
| :--- | :--- | :--- |
| `running` | 审查进行中 | 等它跑完；或 `review --cancel <run_id>` |
| `review_done_awaiting_disposition` | 审查意见没逐条裁决 | 补齐裁决件（接受/驳回/暂缓 + 理由，接受要写落点），再 `trivium gate --stage <s> --topic <主题> --check` |
| `awaiting_approval` | 等你人工审批 | `/dual-approve --topic <主题> --stage <s>`；不想继续就 `/dual-abandon --topic <主题>` |

命令 B/C/D 的 `gate --check` 通过后会**直接**把闸门立起来（停点是这三条命令的定义，
不靠执笔者记得走下一步），`gate --await-approval` 随后输出停点话术。
通过审批必须带 `--stage`（一次放行哪一道要说清楚）；拒绝与放弃可以省略。

> **审批这道关的信任边界（请照实理解，不要高估）**
>
> `trivium approve` 是普通 CLI 子命令，`recordApproval` **不校验调用来源**，而
> `/dual-review-*` 的 allowed-tools 预批准了 `Bash(.trivium/bin/trivium:*)`。也就是说
> **人工审批闸门可以由 Driver 自己一条命令关掉，不需要你任何确认**；CLAUDE.md 里
> 「想继续请让用户走 /dual-approve」是提示词约束，不是机械保证。
> 按会话区分也没用——人工审批与自批发生在同一个会话里。
>
> 曾经加过一枚一次性确认码（`--await-approval` 发码、approve 必须 `--code`），
> 后来**移除了**：码的明文经 stdout 由 Driver 转述给你，Driver 读得到它，
> 于是它构不成权限边界，只会让人以为这道关是机械保证的——虚假的安全感比没有护栏更糟。
>
> 现有的是**事后对账**：每次审批都会把时间、阶段、run_id 与会话来源写进
> `task.json.approvals`。若你怀疑某次 approve 不是你本人发起的，那里可查。
> 真正的机械边界需要宿主提供一条不经过模型的带外通道（TTY、审批 UI），本项目没有。

### 裁决校验不过

`gate --check` 会拒绝**空洞理由**（`isHollowReason`）——「已知悉」「后续再说」这类
不构成裁决。它还会检查两侧**共同标记为 blocker 却都被驳回**的项
（`findJointRejectedBlockers`），那需要显式理由。

### 想彻底退出这个主题

```bash
/dual-abandon --topic <主题>              # 放弃该主题下全部未关闭闸门（running 的除外：先 --cancel）
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

`hook-session-start` 会扫除持有者已死的 `running` 闸门（`sweepDeadRunningGates`），
并顺手抹掉**本项目桶**里遗留的凭据副本、清理过期运行目录。
新开一个 Claude Code 会话通常能自动清掉上次崩溃遗留的 `running` 状态。

### 别的仓库遗留的凭据副本（跨仓清扫）

会话启动清扫只进**本项目**的桶 `<run_root>/<repoId>/`，到期整删也在这一步里跑（配 `run_dir_days: 0` 时整删这一支关闭，凭据抹除照常）。于是在别的仓库干活的会话
既不会抹这个仓库遗留的副本，也不会整删它过期的运行目录；崩溃、断电之后若不再回到同一个仓库开会话，
**那个桶就不会有任何自动清理**——凭据副本与运行目录都一直留在盘上（回去开会话时，那一轮记录里的审查员 CLI 仍在、
判不了或读不懂的目录到期也不删——见下表「因审查员 CLI 未动」与 BACKLOG EV-164）。
前提是那个仓库装了入口、会话启动 Hook 真的跑了——没装入口，或 Hook 没跑（例如状态文件坏掉时会话启动只提示、不清扫），
同样没有自动清理。桶名由仓库的绝对路径派生，仓库挪了位置或改了名，旧桶同样不会再被清（EV-166）。
2026-09-17 实测：一个几天没回去的项目桶下 20 个运行目录各留着一份含 apiKey 的
`home/.zcode/cli/config.json`，零哨兵——从没被抹过。

```bash
trivium scrub --dry-run   # 先看侧层本会抹哪些，盘上什么都不动
trivium scrub             # 遍历全部项目桶，只抹凭据、一个目录都不删
```

**它不删目录**：整删是 `run_dir_days` 的职责且按项目划界，跨仓删别人的目录是越权——
那是别人的排障材料。**退出码恒 0**，判成败读人读输出或 `--json` 的 `ok` / `scrub_failed`。

输出里这几档要分清：

| 档 | 含义 | 你要做什么 |
| :--- | :--- | :--- |
| 已抹除 N 个 | 真抹了凭据副本 | 无 |
| 另 N 个只做了交接包脱敏 | 一份载体都没抹，只脱敏了 `request.json` 那一层 | 无 |
| 侧层已收工 N 个 | 哨兵已记完成；**运行目录层仍会复查**（那层不写哨兵） | 无 |
| 准入未过 N 个 | 正在启动／状态判不了／进程仍在，未动 | 多为瞬态，再跑一次重判；持续出现才人工看 |
| 因审查员 CLI 未动 | 工作进程已不在，但 status.json 记录里的审查员 CLI 进程组仍在／组长已退出但组员仍在（`orphaned`，带精确成员数，EV-165）／判不了／记录读不懂（逐条带成因；会话启动清扫里到期被挡下的目录也落在这一格，EV-157） | CLI 结束后再跑即重判（组长已退出、组员仍在的组也可用 `trivium review --cancel` 按组结束）；「记录读不懂」不自愈，核对进程确已不在后把该侧 `cli` 改回 null——到期整删也会保留它 |
| 状态读不到 N 个 | `status.json` 缺失或损坏，**不会自愈也不会重试** | 人工确认后删掉那些目录 |
| 仍有文件未扫描 N 个 | 那几份未脱敏 | 侧层成因翻该侧 `scrub.json`；运行目录层成因直接看行内带出的告警。告警是「跳过超大日志 request.json」时，多半是送审 diff 里混进了未提交的大证据，见「六、留痕相关」的「代码阶段送审之前」 |
| 项目桶读不了 | 整棵没进论域，其中的副本一个没抹 | 查权限后重跑 |

---

## 五、环境与厂商侧（exit 69）

```bash
trivium preflight --stage <s>   # 会指出是探针过期、CLI 不可调用还是未认证
trivium doctor                  # 重跑 18 项探针
trivium doctor --only agy       # 只探一侧，省配额
```

| 现象 | 处置 |
| :--- | :--- |
| 厂商 CLI 升级后行为变了 | 重跑 `trivium doctor`。实现代码只读探针结论、不硬编码设计文档列出的命令行（设计原则 P7），所以重探通常就够 |
| 配额打满 | 换模型档位，或 `--allow-single` 单侧跑（记为降级） |
| 未认证 | 按厂商自己的登录流程处理。**凭据不经编排器**，配置里只放模型 slug 与路径 |
| 探针结论过期 | `.trivium/config.local.yaml` 的 `probe.generated_at`，重跑 `doctor` 刷新 |
| `preflight` 在「ZCode 已认证」退 69，详情含「无法定位 CLI ZCode Built-in Provider Config」 | ZCode 0.16.9 起 CLI 按入口目录推算 provider 配置，应用包布局下推算不到（坑 P-28）。编排器已按入口派生并注入 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` / `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`，仍报错说明 `<ZCode.app>/Contents/Resources/config/provider/zcode-builtin.json` 不在原位——跑 `trivium doctor --only zcode --no-model-calls`，看 notes 里 `provider_config` 那行。这是**安装布局**问题，不是凭据问题 |
| 自己在 shell 里设了 `ZCODE_BUILTIN_PROVIDER_CONFIG_FILE` / `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE`，但不生效 | **编排器独占这两个变量**，拉起 zcode 的三条路径（version 探针、旗标探针、审查执行）一律按 ZCode 安装布局派生后注入，派生不到就把它们从子进程环境里**删除**。这是有意的：判据必须是「子进程拿不到」而不是「编排器没主动注入」，否则宿主环境能改变探针行为（旗标探针那侧会因此烧七次真实配额）。`doctor` 探测到宿主预置值时会出一条 ⚠️ note。要换 provider 配置的位置，请调整 ZCode 安装布局，不要靠环境变量 |
| guard 告警说某侧「**请求的模型没有生效**」 | 该侧的模型覆盖没落到实处：`run.json` 的 `model_requested` 与 `model_effective` 不是同一个模型（判据只看 `<providerId>/<modelId>` 的 **modelId 段**——两种 providerId 形态并存，前缀不同不算问题）。**该侧的审查结论仍然有效**，但模型路由（FR-06）与异构默认（NFR-06）在本侧失效：若另一侧模型与它同家族，这一轮不构成真正的双审。glm 侧先看 `trace.json` 的 `modelSelection` 段：`route` 为 `global` 说明压根没做覆盖（同段 `reason` 写明为什么），为 `config_copy` 而 `model_override_applied` 为 `false` 说明副本写了但 CLI 运行期没选它。**先看同段的 `reorder`**（EV-82 第三段起审查运行会把请求模型排到副本首位）：`kind` 为 `applied` 说明置首已生效仍回落，CLI 的回落规则可能变了；为 `not_movable` 说明置首没做成，原因在 `reason`；为 `identity` 说明请求本在首位；**`reorder` 段缺席**而 `route` 为 `global`，说明请求模型限定失败、压根没做置首，原因在 `modelSelection.reason`。再跑 `trivium doctor --only zcode --no-model-calls`，看 `runtime_selection`（零配额两支对照：`reorder_needed` 为当前正常形态，`reorder_ineffective` 说明置首也挡不住）与 `model_override` 两格，必要时按 P-31 的方式复核包内字面。**另两种成因**（代码双审 r3）：副本源 `~/.zcode/cli/config.json` 里有 `apiKeyRequired: false` 的免密 provider——导入器对整份配置直接拒掉（`Fqa`），探针臂与运行都会落回退；请求的模型名是被标 `deleted` 的成员、或该成员的 `id` 字段与键名不同形——限定按导入器同一组规则判，这两种会在准备阶段就记 `route: global` 并给理由 |
| guard 告警说某侧「**本次没有做模型覆盖**：请求的是 X，实际跑的是 Y」 | 该侧这一轮压根没做模型覆盖，CLI 跑的是它自己选的模型（EV-122）；与上一行「覆盖做了却没生效」互斥，排查方向不同。**该侧的审查结论仍然有效**，但模型路由（FR-06）与异构默认（NFR-06）在本侧不成立。按 `run.json` 的 `critics.<id>.model_unenforced.cause` 分两种：**`source_missing`**——副本源 `~/.zcode/cli/config.json` 不在，CLI 用真实 HOME 的个人配置默认模型；把副本源放回原处即可（EV-112 E2 就是这么复现的）。**`qualify_failed`**——请求的模型名在副本源的 provider 目录里限定失败（没有这个成员、有多个拥有者、被标 `deleted`、或 `id` 与键名不同形），副本已建但没改 `model.main`，CLI 跑的是副本源自己的默认或回落模型；对照 profile 与 `--model-glm` 的写法和副本源 `provider[*].models` 的键，原因原文在同段 `reason` 与 `trace.json` 的 `modelSelection.reason`。**不播报的一格**：限定失败而回落模型恰与请求同名（modelId 段相同），此时跑的就是请求的模型。`reason` 文案只供人读，脚本判成因请认 `cause` |
| 预检或开场播报说「**ZCode 模型覆盖副本源**」：副本源 `~/.zcode/cli/config.json` 不在 | EV-123 起的只警告提示，**不拒跑**。原因：glm 侧的模型覆盖靠把这份文件拷进运行目录的副本 HOME 实现，文件不在时编排器不做覆盖，CLI 跑的是它自己选的模型——EV-112 E2 实测为真实 HOME 下个人配置的默认模型（当时是 qwen3.8-max，而请求是 GLM-5.3）。影响：该侧的审查结论仍然有效，但模型路由（FR-06）与异构默认（NFR-06）在该侧**可能**不成立（个人默认模型碰巧与请求同 modelId 时跑的就是请求的那个）。处理：要按请求的模型跑，先把副本源放回原处再发起；预检时警告、而当轮没选 glm 的，可以忽略（预检按缺省选侧查，`--start` 按当轮选侧再查一次）；开场播报里出现、说明拉起时仍不在，审查已经在跑——可以 `review --cancel <run_id>` 中止，或者接受并看收尾那条「本次没有做模型覆盖」告警（注意它只在回读到生效模型时出声，回读不到时静默）。|
| glm 侧起得来，但留痕里的 `model_effective` 不是请求的 GLM 模型 | **已修（EV-82，2026-09-24 结案）**：配置层 2026-09-21 修；运行期回落由第三段置首修法消除，2026-09-24 端到端验收通过（run `20260924T104357Z`，请求 `GLM-5.3-Flash`，rollout 13 条全为 Flash）。第一层根因：编排器曾注入指向你真实个人 provider 配置的变量——个人文件存在，CLI 就跳过 legacy 导入，副本里的 `model.main` 没人读；现在审查运行的副本 HOME 下**不注入**个人变量，CLI 从 `cli/config.json` 副本导入、默认选择写出请求值。**第二层**（2026-09-24 第二段实测）：写出的默认选择在运行期被判不可选，CLI 回落「第一个可见 provider 的第一个模型」——所以置首修法（`c872b00`）之前的运行会跑到首位模型。第三段起审查运行把请求模型排到副本首位，回落就落在它上面（见上一行的 `reorder`）；`trivium doctor --only zcode`（含 `--no-model-calls`）的 `model_override` 一格零配额实测配置层——记 `config_copy` 即写出了请求值，记 `global` 则 CLI 又改了导入流程；`runtime_selection` 一格零配额实测运行期是否仍需置首。覆盖没落实时 guard 也会出声（见上一行）。**审查运行的 CLI 日志、rollout、会话库与存储根下的产物（artifacts / sessions / memories / plugins）落在运行目录**（EV-112 起）：编排器清掉宿主预置的十一个落点相关变量后，再把日志目录 / 存储根 / 会话库指到 `<运行目录>/glm/home/.zcode/…`；无副本的审查运行（副本源 `~/.zcode/cli/config.json` 缺失；「未指定模型」在派发前就被拒，走不到这里）仍用真实 HOME 与你的个人配置选模型——**这时 glm 侧跑的是你个人配置的默认模型，不一定是 GLM**（本机实测是 qwen3.8-max，EV-122），但这些产物不再留在 `~/.zcode`。跑后只自检日志与 rollout 两类。代价：这一支看不到你装在 `~/.zcode` 下的 plugins / profiles / skills / MCP，子代理的模型覆盖回落内置缺省（主 agent 不受影响）。glm 可作为审核者启用。若之后再出现本症状，先看 doctor 的 `runtime_selection`：`reorder_ineffective` 说明 CLI 的回落规则变了、置首已挡不住。端到端验证请用非首位模型（`--model-glm GLM-5.3-Flash`），默认档 `GLM-5.3` 恰是首位模型，回落也得到它，验不出差别 |
| guard 告警说 glm 侧「**运行目录里缺本次会话的日志 / rollout**」，或「本次会话的 CLI 产物**出现在真实 HOME 下**」 | 落点自检没过（EV-112）：编排器把 CLI 的日志目录、存储根、会话库指到运行目录，这一轮跑完却在那里找不到本次会话的日志或 rollout。最可能的原因是 ZCode 升级后不再认其中某个环境变量。**不影响该侧结论的有效性，但送审内容可能落在了清扫面之外**。排查：① `trivium doctor --only zcode --no-model-calls` 看 `cli_version` 是否变了；② 看 `run.json` 的 `critics.glm.carriers_landed`：`log` / `rollout` 哪一项为 false，就是哪一族落点键失效（日志键与存储根走两条不同的代码路径）；③ 出现泄漏句时看 `carriers_landed.leaked_to_home` 哪一项为 true，按 `run.json` 的 `session_id` 自查：rollout 一项在 `~/.zcode/cli/rollout/` 下找 `model-io-<sessionId>.jsonl`，确认后自己删掉；日志一项用 `grep -l <sessionId> ~/.zcode/cli/log/*.jsonl` 找出文件（`-l` 只出文件名），这些文件可能混有其它会话，确认后自己处理（编排器不动真实 HOME）。再跑 glm 之前把这件事报上来，要重新核 ZCode 包内的取值链 |
| `preflight`「ZCode 已认证」或 doctor 的 headless 探针报 `Error: Model creation failed (traceId: …)` | CLI 建不出模型。**先看详情括号里探的是哪条路径**：认证探活自 EV-136、doctor 的 headless 与 path_deny 自 EV-194 起与审查运行同路径——写「模型 X」是副本支（副本 HOME、不注入个人配置，用的是 `cli/config.json` 副本），写「真实 HOME 下 ZCode 自选的缺省模型」才是退路支（档位没给模型或副本源缺失，此时才读你的个人配置）。`failureKind` 落在 `other` 说明它既不是缺 `cli/config.json`（那报 `model_config_missing`），也不是 provider 鉴权失败。**结构化根因**：两处探针的 CLI 日志落在各自的临时目录、探完即删，doctor 的失败 note 会带上从那份日志取出的 `turn.failed` 根因；直接用 ZCode CLI 复现时才去 `~/.zcode/cli/log/zcode-<日期>.jsonl` 按 traceId 找 `turn.failed` 行的 `error.cause.message`（只取这个字段，日志含模型 I/O 全文，不要整份打印）。2026-09-21 实测根因是下一行 |
| 结构化根因是 `Select a model before continuing` | CLI 的模型选择解析为空。包内逻辑：先拿 `~/.zcode/v2/provider_config.json` 的 `config.defaultModelSelection` 去注册表**精确匹配**（providerId 与 modelId 都要相等，且 provider 不能 `visibility: hidden`），验不过就回落到注册表第一个可见模型，再没有就报这条。三种成因按顺序查（都只看键名与布尔值，**不要打印凭据值**）：① 该键是否缺失——`python3 -c` 读 JSON 只打 `sorted(config.keys())`；② `providerConfigRules.providerRules[].enabled` 是否全 `false`（桌面端切换 provider 家族时会关掉家族外的 provider，2026-09-21 实测如此）；③ 键指向的 providerId/modelId 是否与注册表精确相等（自定义 provider 是 UUID 形态；内置套餐是 `account:bigmodel-individual-coding-plan` + 小写 `glm-5.3`，**不是** `cli/config.json` 里的 `bigmodel-coding-plan/GLM-5.3`）。修复：先 `cp` 备份，再只改那一个键或那一个布尔值，写成 `.new` 文件核对后再 `mv` 覆盖；恢复后重跑 `trivium doctor --only zcode` 刷新探针结论。**这一行只管读个人配置的路径**：EV-136 / EV-194 起认证探活、doctor 的 headless 与 path_deny、审查运行在副本支下都不读个人配置，个人缺省坏了不影响它们（2026-10-02 实遇：个人缺省指向停用 provider，改个人配置也修不了——那份配置在时 CLI 不从 `cli/config.json` 导入 provider，修法是 EV-194 让 doctor 不走它） |
| doctor 告警「**ZCode headless 探针本轮进了真实调用，但没刷新 response_field**（…）」 | EV-196 起的只告警项，**不拦、不改退出码**。括号里是哪一支：副本源读取或解析失败、headless 调用失败、退 0 但抠不出 JSON envelope。告警点名的几项（`response_field` 等）是**上一次**探到的结论，本轮没刷新——旧值让「headless 未跑通」那条 blocker 不触发，所以 doctor 照样退 0。为什么要紧：doctor 的 headless 与审查运行走同一条选模路径（EV-194），这里不通，审查大概率同样跑不通。**根因看告警里点名的那条 `[zcode]` note**（headless 失败那条带 `turn.failed` 的结构化根因）；headless 失败的按上面「`Model creation failed`」两行处置、副本源坏了的检查该文件，修好后重跑 `trivium doctor --only zcode`，告警消失即本轮已刷新。告警只在跑 doctor 的当期出现，之后的预检不会再提 |
| doctor note 或预检「ZCode 已认证」「Codex 已认证」详情末尾出现「**探针 / 探活临时目录删除失败（错误码）：… 仍在**」，或 doctor note 出现「**探针夹具删除失败（错误码）：… 仍在**」「**codex 隔离探针临时目录删除失败（错误码）：… 仍在**」 | 探完删临时运行目录失败（重试三次仍失败，EV-197 起不再抛出、不改探活结论）。目录在系统临时目录下，doctor headless 段的前缀是 `trivium-zcode-doctor-`、zcode 探活是 `trivium-zcode-auth-`、codex 探活是 `trivium-codex-auth-`（EV-200 起同样不抛）；doctor 的旗标探针、白名单臂、同形臂依次是 `trivium-flagprobe-`、`trivium-modeloverride-`、`trivium-fullcopyarm-`（EV-198 起同样不抛），提示里给了完整路径（家目录归一成 `~`）。写「副本含真实凭据」时里面有 `cli/config.json` 副本，codex 写「codexhome 凭据副本（auth.json 与 toml）含真实凭据」时里面有你的 `auth.json` 与带 `[model_providers.*]` 段的 toml 副本，**请按提示里的路径手工删掉那一个目录**（权限不够先看错误码：`EACCES` 多为目录被改成只读）；写「是探针副本、凭据已换成哨兵」时副本里没有真实凭据，同样请删；写「没有副本」时只是 CLI 产物、codex 写「没有凭据副本」时剩下的是探活的其余临时文件，同样建议删。探针夹具（主夹具前缀 `trivium-probe-`、记忆夹具 `trivium-probe-mem-`，四侧 doctor 探针共用）与 codex 隔离探针（`trivium-codexhome-`）的临时目录 EV-199 起同样不抛、提示进该侧 note、结论不变：夹具那句写「其中剩下的只会是探针写的夹具文件（…）与本次探测的临时文件，探针没有往里放真实凭据」，隔离探针那句写「其中剩下的只会是探针写的 config.toml 与本次探测的临时文件，没有拷入凭据」——两句里都没有凭据副本，同样请按路径删。不要用通配删除（系统临时目录里可能还有早先测试借用 `trivium-probe-` 前缀留下的目录，通配会把它们与夹具混在一起）。探活的正结论会进缓存，TTL 期内的预检不再重复这条提示，看到一次就处理 |
| 终端（或运行目录的 `worker.log`）出现「**⚠️  工作树哈希的临时目录删除失败（错误码）：… 仍在**」，或 `doctor --selftest` 末尾出现「**自检临时目录删除失败（错误码）：… 仍在**」（EV-207 之前的版本写作「自检夹具目录删除失败」），或会话启动待办出现「**N 个到期运行目录删不掉：…**」 | 删临时目录失败（重试三次仍失败），EV-204 起不再抛出、不改结果：工作树哈希照常返回（送审、漂移复算、审批摘要都照常走完），自检结论不变，会话启动清扫照常处理后面的目录。三种目录依次是：系统临时目录下的 `trivium-index-*`（TriviumCode 只往里写了 git 临时索引——项目文件的路径与对象哈希，没有文件内容、没有凭据；同一进程只提示一次，之后的同类失败不再提示，所以可能不止一个）；系统临时目录下的 `trivium-selftest-*`（EV-207 起里面是夹具仓库 `repo/`——夹具文件与桩产出的审查留痕——与本次自检的运行目录 `runs/`——worker 日志、交接文件与状态文件，没有凭据；删这一个目录两者一起走。EV-207 之前的版本还会在旁边留一个 `trivium-selftest-*-runs`，同样没有凭据，可一并删）；`run_root` 本项目桶下的运行目录（括号里是错误码，最多列三个、超出写「等 N 个」）。**请按提示里的完整路径手工删除那一个目录**（前两种提示的家目录已归一成 `~`，会话启动待办那一行与同段其余各行一样给的是原路径；`EACCES` / `EPERM` 多为里面有被改成只读的子目录，先恢复权限再删）。worker 里的漂移复算那一行只落 `worker.log`、`--wait` 不播报。运行目录**删掉一部分**时目录 mtime 被刷新，下次会话判为未到期、这一行随之消失，要再过一个保留期（`retention.run_dir_days`）才会自动重试整删；若删掉的那部分里有 `status.json`，期间该目录改出现在「状态读不到」那一行——两种情形都请按路径手工删。删不掉的运行目录改按未到期目录走凭据抹除（准入照旧），抹除失败另见「凭据副本抹除失败」那一行 |
| doctor 阻断项出现「**〈某侧〉本轮没有探测成：建探针夹具失败：建仓第 N/6 步「…」失败：…**」，或告警出现「**Claude Code（claude）项目记忆一格本轮没有探测成：建探针夹具失败：…**」，或 `doctor --selftest` 的「**创建夹具仓库**」一步失败、原因是「**建仓第 N/6 步「…」失败：…**」 | EV-209 起建夹具仓库逐步查 git 的结果：探针要一个临时 git 仓库当夹具，建它的六步（初始化、三条配置、暂存、基线提交）与基线哈希任一步失败都直接报出来，不再静默建出残缺的夹具、也不再把 doctor 崩成「内部错误」。原因里写的是哪一步与 git 输出的头三行，或「git 启动失败（spawn git ENOENT）」（`PATH` 里没有 git）、「30 秒内未结束」（git 卡住）。**先修 git**：终端里 `git --version` 应能看到版本，再对照原因里 git 输出的那几行处置；建临时目录本身失败（临时目录不存在或不可写）时原因以 `ENOENT` / `EACCES` 开头。阻断项那一侧**本轮没有探测**，`config.local.yaml` 里它的结论原样保留（从未探过则仍为空），其余侧照常探完；修好后按阻断项末尾给的命令 `trivium doctor --only 〈侧〉` 重跑。`--no-model-calls` 下 agy、codex、claude 不建夹具，zcode 仍建（只读旗标探针在夹具里跑）。项目记忆那一条只是告警、不改退出码：claude 其余各格已刷新，只有 `project_memory_blocked` 沿用上一次。建到一半的夹具目录已自动删掉；删不掉时原因后面会接一句「探针夹具删除失败（错误码）：… 仍在」，按上一行的「探针夹具」处置。自检那一步失败时临时目录同样已删 |
| 预检「Codex 已认证」「Antigravity 已认证」等详情末尾出现「**⚠️ 指纹读不了：…，本次未用缓存、也不写缓存**」，或详情是「**探活内部失败：…**」 | EV-202 起的兜底，不再把整个预检崩成「内部错误」。**指纹读不了**：该侧用来判缓存是否失效的凭据文件在、但读不了（codex 是 `~/.codex/` 下的 `<profile>.config.toml`、`auth.json`、`config.toml`；agy 是 `~/.gemini/config/agents/<Agent 名>/agent.md`），原因里写着是哪个文件、什么错——`EACCES` 看权限（`ls -l` 该文件），`EISDIR` 是那个名字成了目录。本次没用缓存、照常探活，探活结论照常算数；**修好之前每次预检该侧都会重探一次**（codex 多数情形在准备隔离副本那一步就因同一个文件读不了而失败，到不了真实调用；agy 会真拉起、花一次配额），修好就恢复走缓存。**探活内部失败**：适配器内部抛了异常，该侧按失败计（退 69），其余各侧照常出结论；看详情里的原因，要栈就 `TRIVIUM_DEBUG=1` 重跑预检（栈打到 stderr），属缺陷请记下原因报告 |

已知的厂商行为坑列在 [`GUIDE_local_pitfalls.md`](../04_development/GUIDE_local_pitfalls.md)（本机坑清单 `P-xx`）。
其中几条值得单独记住：

- `agy` 的 `-p` 进程只活约 10s，实际工作在**跨运行复用的 hub** 里。这意味着
  per-run 的 `HOME` 隔离**对 hub 不生效**。
- ZCode 会把进程名改成 `zcode-cli`，`pgrep -f 'zcode\.cjs'` 永远是空的。
- `agy` 的模型 slug 若已编码 effort（如 `-high` 后缀），再传 `--effort` 会被拒。

### 档位、思考等级与厂商 profile

档位与 `--tier-<id>` / `--effort-<id>` / `--profile-<id>` / `--native-<id>` 参数错误统一先退 **64**、零工件；明确不存在的 profile 同样退 64。凭据、服务、入口或只读能力不可用退 **69**。预检与准备阶段按同一顺序解析、检查本轮实际组合（EV-229、EV-232）。

| 现象 | 处置 |
| :--- | :--- |
| 「**--tier-〈id〉 只接受**〈三个档名〉**，收到：…**」或「**--〈tier / effort / profile〉-〈id〉 需要一个值，但没有给出。**」 | 旗标值写错或漏写。档名只有这三个；思考等级与厂商 profile 的值紧跟在旗标后面 |
| 「**--〈…〉-〈id〉：〈id〉 本轮没有入选，为它指定的…不会生效**」 | 与 `--model-<id>` 同一判据：要么用 `--critics` 把它加进本轮，要么去掉这个旗标 |
| 「**--profile-〈id〉：〈id〉 没有厂商 profile 概念**」 | 只有注册表声明能力的侧可选 profile，目前为 Claude、Codex。`--profile <档位表名>` 仍独立选择模型档位；原生路线用 `--native-〈id〉` |
| 「**档位「〈档〉」（经命令行 / 档位表格子 / agents.〈id〉.default_tier 指定）未在 agents.〈id〉.tiers 定义。可用：…**」（或「agents.〈id〉 未定义 tiers」） | 档名对、但这一侧没定义那一档。补上那一档，或改选报错里列出的档。注意本机层 `config.local.yaml` 写了 `tiers` 会**整段替换**共享配置里的那份——本机层只写了两档，共享层的第三档就不存在了 |
| 「**〈家〉 不支持思考等级，档位 / 档位表却给了「…」。去掉该 effort**」 | ZCode 没有思考等级，档位里只能写模型；去掉该档或该格子里的 `effort`，也别给 `--effort-glm` |
| 「**思考等级「…」不在模型「…」的原生枚举中。可用值：…**」 | 改用列出的值。可选值来自本机探针：codex 取本机模型目录文件里该模型的思考等级表，claude 取 `claude --help`。**本机目录可能比厂商窄**（如本机 qwen 目录不列 `xhigh` 而厂商接受，设计 3.6）：确认厂商确实接受后，改本机目录文件、重跑 `trivium doctor --only codex`，不要指望放宽校验 |
| 明确不存在的厂商 profile（退 64） | 核对本机对应 profile 文件；预检与审查准备阶段均先校参数。Claude 位于 ~/.claude/profiles/，Codex 位于 $CODEX_HOME |
| 「只读能力可用」一格报「**codex profile「…」对应的 provider「…」没有可用凭据**」（退 69） | 那个 profile 的 provider 段没配凭据。按报错点名的文件与 `[model_providers.〈家族〉]` 段自己补上（编排器不代写），再重跑 `trivium doctor --only codex` |
| 「**不在 … 模型目录中，可用值：…**」，且这一侧的厂商 profile 来自档位或 `--profile-codex` | 模型目录逐 profile 分层（坑 P-25）：换了 profile 就要换成该 profile 目录里的模型。只给 `--profile-codex` 不给 `--model-codex` 时最常见 |
| 预检告警「**模型「…」的 slug 已编码档位，思考等级「…」不生效**」 | Antigravity 的模型名带 `-low` / `-medium` / `-high` 后缀时以后缀为准，请求值照记、不下传。要换思考等级就换模型名或换档 |
| 预检告警「**〈侧〉/〈阶段〉：命令行…覆盖了档位「…」的…**」 | 只是告知：命令行精确值盖过了档位里对应的那一项。档位提供的字段被全部盖掉时，run.json 该侧记 `tier: null`、`tier_source: override` |
| 预检告警「**其中思考等级 / 厂商 profile 无从比对、未实际校验：…**」 | 探针没取到可选值（如 claude 的 `effort_levels` 为空、profile 名单为空），这一格跳过校验、照常下传。先跑 `trivium doctor`（`--only` 那一侧）补探针；不补的话，写错的思考等级要到运行期才被厂商拒绝——该侧整格失败、白花一次调用 |
| 切换 profile 后探活失败 | 探活按实际 Agent / 模式 / profile / 模型 / effort 分开缓存，不跨组合复用。核对所选路线的凭据和服务；失败不会自动改用另一家（EV-229） |
| run.json 某侧 `effort_effective` 为 `null`、`effort_effective_source` 为 `unverified` | Codex 与 Claude Code 的正常读数：它们收下思考等级但不回报实际用了哪一档，`null` 是如实的「不知道」，不是出错（PRD AC-23 达成边界）。ZCode 侧两项都是 `null`（没有思考等级概念）。字段整个不存在说明是 M11 第 6 步之前的旧留痕 |

---

## 六、留痕相关

### 把 doctor / preflight 的输出抄进 evidence 目录之前

`doc/05_testing/evidence/` 下的实测留痕是**人工抄录**的，那条路径上**没有** secrets 闸门——
归档件与送审补丁有，手抄的没有。而 doctor 的 notes、preflight 的失败详情里会带 **CLI 的 stderr 原话**。

编排器已经把这几处原文在拼进 note / 详情之前过了一遍 `redactSecrets()`（旗标探针的未判定成因、
headless 失败 note、ZCode 探活详情、`critic.run()` 的失败提示），所以正常情况下抄过去是安全的。
**但它只认已登记的凭据形态**：厂商换一种回显写法，脱敏就漏。所以抄录前仍然自己扫一眼，
尤其是任何形如 `<id>.<secret>` 的长串。含凭据的配置文件一律 `grep` 目标键名，**不要整份打印**。

### 代码阶段送审之前：大证据先提交，送审任务书原件别拷进仓库

code 阶段的被审对象是工作树相对基线的整份 diff，**未提交的证据文件也在里面**。
2026-10-11 一轮代码审的送审包到了 149 MB（BACKLOG EV-236）：diff 45.7 MB 里大头是当时未提交的
`doc/05_testing/evidence/` 取证目录，其中又有历次送审的任务书原件——原件里带着上一轮的 diff，
再被下一轮送审，一轮比一轮大。代价是送审成本抬高，以及超过清扫上限的 `request.json` 跳过脱敏，
会话启动反复提示「抹除后仍有文件未扫描」。

- 发起 code 阶段审查之前，大体量的证据**先单独提交**（已提交的文件不在相对 `HEAD` 的 diff 里），
  或者放到仓库之外的 `~/.trivium/evidence/<主题>/`。
- **不要把送审任务书、请求文件的原件拷进仓库内的证据目录**；要留存就只记 sha256 与路径，原件放仓库外。
- 已经出现的超大 `request.json`：先用生产 `scanSecrets` 只读全文扫一遍确认零命中，再等
  `retention.run_dir_days` 到期整删，或人工确认后自行删除那个运行目录。
- M12 批次 5（EV-236 A2）起，`request.json` 里的冻结补丁只存一份（顶层 `frozen_diff`），不再按侧各存一遍。
  各侧任务书里的补丁节选（400 行以内即全文）照旧各有一份，所以大改动仍会让它变大，上面两条规矩照样要守。
  worker 读到形态不对或哈希对不上的 `request.json` 会以「交接文件已损坏」退 69：那是文件被改坏了，重跑这一轮即可，不要手工修它。

### 提交被拦下，说「归档留痕不完整」

已落盘的审查工件被删除或改动了。这是**设计要挡的**（P5 / P6、FR-25）：
留痕的意义恰恰在于它删不掉也改不掉。

校验有三个锚：git 索引（删除一律拦；已跟踪的 `_meta/` 审计材料与运行清单被改也拦——M10a 第 2 步起按**位置**判，排除便利副本 `changes.diff` 与仍在 running 的运行清单；task.json 与裁决件的正常改动放过）、`task.json` 的 `runs[]` 与各运行清单的 `artifacts[]`（审查文档与**成功送审**的 plan / bug 原稿按 sha256 登记，被删或被改即拦；归档外的被审原稿不登记）、以及 `.trivium/state.json`（记过运行的主题，其 `task.json` 必须还在——首次提交前 git 没有基线，这是仅剩的锚）。另外 `hook-pre-write` 不允许 Driver 写 `_meta/` 与 `task.json`：它们是锚与 `gate --check` 的事实来源。

**处置**：出口按工件在 git 里的状态分两档。**已提交过的**：把被删 / 被改的文件恢复回去（`git checkout -- <path>`），**这一步请在终端里手动执行**——恢复对象是归档内的 `_meta/` 与角色后缀文件，常规写法在会话里会被 `hook-pre-bash` 按字面拦下；那条判据是启发式、不完备，换写法绕过属于违规，不是出口。**尚未提交过的或已丢失的**审查文档 / 原稿：没有副本可恢复，出口是 `/dual-abandon` 作废这一轮后重跑。
**运行清单（`_meta/run-*.json`）报「不可读」或「已丢失」的不适用这一句**：abandon 加重跑不会让那份旧清单变可读，提交照样被拦；删掉它判定会放行，但提交锚改报「已丢失」。它按成因分三档——本工具版本落后于写入方（常见于装好的副本比写入方旧，`git status` 往往干净）⇒ 按 [MANUAL §3.6「升级」](../07_manuals/MANUAL_user.md) 更新重装；已提交而工作树被改坏 ⇒ 在终端 `git restore`；从未提交、或已提交的版本本身就读不出 ⇒ **工具内没有出口**，保留文件、人工判断（BACKLOG EV-148 剩余项）。`review --start` / `topic resolve` / `topic claim` / `gate` / `approve` 与写入前 Hook 遇到读不出时给的就是这三档（设计 8.4「留痕读不出：成因与出口」）；提交拦截（`hook-pre-commit`）自己的文案尚未与之统一（EV-182），以本节为准。
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
trivium doctor --selftest --keep-fixture   # 保留夹具（夹具仓库 repo/ 与运行目录 runs/ 同在一个临时目录下，排查完删那一个目录）
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
- 探针结论与 [本机坑清单](../04_development/GUIDE_local_pitfalls.md)
  记载冲突——按实现纪律，**改适配层，不改外部产品，也不改验收口径**，同时回补设计文档。

---

## 十、别家主攻（L2 Driver）时的人工兜底

ZCode、Codex、Antigravity 当 Driver 时，护栏等级是 **L2**（[QUICKSTART §5.2](../07_manuals/QUICKSTART.md)）：
Hook 不保证拦得住写入——ZCode 的 Hook 只作尽力拦截，Codex 与 Antigravity 没有 Hook。下面几件事靠你。

### 审批之前自己核

1. **看工作树改动**：闸门期（等你审批时）业务文件不该有新改动。**这一格不拦**——审批前复核只核裁决与本轮登记的审查工件、不看工作树；跑后漂移复算只在审查运行收尾时做。但停点和 `approve` 会打印一段**工作树改动摘要**：自审查收尾以来改过的文件（只告知，不影响审批结论；被 `.gitignore` 忽略的看不见；BACKLOG EV-132 候选 ② 折中版）。摘要报「取不到」时（基线被 git 清理、git 出错、超过 20 秒），自己跑 `git status --short`。
   `approve` 没有确认这一步：摘要在落审批之前打印，但同一条命令里来不及中止。想在审批前看，就看停点那次打印；审批后发现不该有的改动，用 `dual-abandon` 作废本轮后重跑。
   有改动就先问清来源，必要时 `--reject` 让它回到裁决。
2. **`trivium gate --stage <阶段> --topic <主题> --check`**：裁决齐备（`approve` 也会复核这一格）。
3. **提示语是不是你写的那句**：别家主攻时提示语由 Driver 模型转抄，看开场播报或 `run.json` 的 `topic` 与 BRIEF 第 2 段焦点。
4. **`approve` 由你发起**。入口资产预批准了 `.trivium/bin/trivium`，L2 的 Driver 能自写裁决件、自己跑 `approve`——复核只保「裁决齐备」，不保「审批来自人」。
   M10b 验收里，Codex 会话发起的审批与 ZCode 会话发起的认领，来源分别记为 `session_id: null` 与 `unknown-session`（这两家不向 shell 注入会话标识），会话里批的和终端里批的无从区分，对账只能看时间。

### 审批之后

审批前复核只核**本轮**、只在审批那一刻做；更早轮次与审批之后的改动，靠的是提交锚（`hook-pre-commit` 在每次提交时全量核对登记工件）——而**提交锚只在带 Hook 的载体会话里触发**。
Codex / Antigravity 主攻的轮次，审批之后删改审查工件没有任何机制会发现（BACKLOG EV-132 同一范围）。出口二选一：在 Claude Code 会话里提交，让提交锚补上这一道；或者提交前自己核 `git status` 与归档里本轮的审查工件是否还在、没被改。

### 护栏自身被动过手脚时，看不见

Hook 与预检只做**存在性**检查：wrapper（`.trivium/bin/trivium`）内容被替换、全局安装副本被改、Hook 配置段里的命令或 matcher 被改，都看不见。
怀疑时重跑安装器与 `init` 恢复，再跑 `doctor`。这一条对 L1 同样成立。

### ZCode 的 Hook 配置：四态与手工清理

| 状态 | 做法 | 要知道的 |
| :--- | :--- | :--- |
| 安装 | `init`，或 `.trivium/bin/trivium hooks --agent glm` | 装完在 ZCode 桌面端重新信任该工作区；信任前 Hook 不跑；要先信任、再开会话 |
| 更新 | 重跑同一条命令，按识别标记原位替换 TriviumCode 那段 | 配置一变就退回待信任，要重新信任 |
| 停用 | 删掉 TriviumCode 那段，或把 `hooks.enabled` 设为 `false` | 信任记录留在 ZCode 自己那里 |
| 清理 | 卸载**不动**项目里的 `.zcode/config.json`，按下面手工清 | 残留的段在重新信任后会继续生效 |

手工清理：打开 `.zcode/config.json`，删掉 `hooks.events` 下调用 `.trivium/bin/trivium gate hook-…` 的条目，其余键原样保留（或整体把 `hooks.enabled` 设为 `false`）；
同目录的 `config.json.trivium-backup` 是写入前的备份，确认不需要后可删。还用 ZCode 的话，改完重新信任一次。

**写盘前的备份只在真正写入时生成**（M10b 第 3 步起）：重跑 `init` / `hooks --agent` 判定「已就位」时不再覆写 `.claude/settings.json.trivium-backup` 与 `.zcode/config.json.trivium-backup`，上一份备份得以保留（旧版每次都先备份）。
早就 `init` 过的项目，`.gitignore` 里这两行要手工补（QUICKSTART §3「升级与卸载」）。

### 需要你在终端里执行的动作

下面几类动作按规矩**不在会话里做**，由你在终端执行——会话里的常规写法会被 `hook-pre-bash` 按字面拦下（L1），或者本就不该由 Driver 动手（L2）：

| 动作 | 为什么在终端 |
| :--- | :--- |
| 恢复被误改的受保护文件（归档内 `_meta/` 与角色后缀文件的 `git checkout --` / `git restore`） | 命令参数正是受保护路径，会话里会被同一条判据拦下；换写法绕过属于违规，不是出口 |
| 验收或排障时故意造缺件、改工件，验证 `approve` 复核 | `_meta/` 是编排器独占对象；M10b 验收里 Codex 就拒绝了代做，改由用户在终端篡改 |
| 清理孤儿原稿、撤回前留下的他家后缀文件 | 防的正是「会话自己删文件、反复翻转认领」 |
| 删除临时夹具与运行目录（`~/.trivium/runs/<仓库>-<哈希>/`） | 破坏性动作；会话只核对路径、不执行 |

终端里执行的命令**不要在行尾写 `# 注释`**：交互式 zsh 默认不开 `interactivecomments`，`#` 后面的词会被当成参数。

2026-10-11获批整改执行边界：目录事实绑定真实项目sensitive_globs稳定hash、形态版本及入口/native/版本/路线/TTL；缺值或变化逐文件回退，目录追加预期失败保存主probe并清空目录事实。实际旧压缩根5段超出当前批准的4段拓扑，修订候选须补充正式计划审查，未擅自扩大范围。共享七入口迁移必须在最终代码及两次check完成后连贯执行备份核hash、移动、四目标安装核验；失败/意外中断先标rollback-required并恢复，拒覆盖目标。详见[恢复报告](../05_testing/REPORT_2026-10-11_agent_access_recovery.md)。

当前目录事实与敏感枚举规范统一见[设计§3.5](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-directory-contract)：消费仅限受测ASCII形态、绑定实际项目及入口，失配回退逐文件。正式授权、实施、真实取证和未测状态见[恢复报告](../05_testing/REPORT_2026-10-11_agent_access_recovery.md)，不以本节历史计划采样替代当前验收。
<!-- 2026-10-11 r12：运行元数据与被审diff分离，原判据保留。 -->
本轮完整代码审前，预算连续台账已逐文件核验切换到项目外`~/.trivium/evidence/agent-access-20261011-closeout-r3/budget`。仓内旧台账保持原样；新根复制的旧启动不另计，后续累计启动以新根为唯一权威。使用本轮`launch-v4.mjs`，不能继续用旧预算根增加启动。第8次C/code仍消耗正式轮数；元数据目录迁移不改变任何只读/漂移判据、不增Git忽略、不追认旧failed。Codex版本核验读取ledgerRoot，动态输出根只保存取证工件；记录中的包装器/native配对须与相同请求hash绑定。

当前收口运维补记（2026-10-11）：上段launch-v4/第8次仅属原时点。现行权威v5总12，第11次B/plan已有效批准，第12次C/code待实施后完整审。正式审查使用接`round-guard-v2`的`launch-v8`；`quiet-launch-v6`机械拒绝review而仅摘要认领/解析/预检。改recipes后串行两次check、build、正常四目标安装，并由正式启动前检查核输入/副本一致、完整敏感枚举与settings软线/skip；安装后复查七份共享重名目录仍缺席及备份hash，复现即停并记录时点。CLI预算与正式轮数分列，旧账和旧失败不动；原写准入仍需真实调用与配对拦截，详见[恢复报告](../05_testing/REPORT_2026-10-11_agent_access_recovery.md)。

较晚运维（13B/r18已获批）：当前正式13/14，下一14C相对39ed全量审；使用launch-v10，quiet-v7只摘要claim/resolve/preflight且version=v10。本次token贯通REQUEST_TOKEN→LOAD_TOKEN/load_id/marks，独占wx及requested/completed精确配对，旧label不能选证据；错误退出信息保留。code启动测量固定v2导入/hash，仅code执行；未来独立新plan轮须重评新launcher，不能直接永久复用收窄。实施后串行两次check、桩14/14、build/正常四目标安装及28入口/七共享/备份/配置/hash核验，全部静态证据先落盘再冻结审查。CLI自动扩容不扩大14轮，也不批准准入判据候选。旧台账/审查/失败/拒绝全保留。


较晚采样（第14C后）：14C run20261011T070836Z有效、无漂移/现行guard违规，但普通code依委托拒绝，四意见裁决为两接受、一驳回、一暂缓。沿13B已批准范围，quiet-v8对完整摘要JSON应用既有脱敏/扫描，补包装器自身异常尾行防御，token、白名单、code/signal及证据选择语义保持；v6谱系hash补直测。旧quiet-v7/授权/原件不改，通用base/数值连续性guard不扩。当前正式14/14，第15完整C资格待Bob独立授权，未启动。判据候选未采用、准入缺口仍保留，详见r6/post-round14-wrapper-followup-proposal.md及恢复报告；两遍check/安装指纹须以新的补修采样分别留痕。

> 2026-10-11 独立总15轮授权仅开放15C完整重审。v7保留v6与14次历史，任务级v11只更新授权载体；quiet-v8摘要脱敏与授权谱系直接测试属13B已批准范围。正式review本批178→最多193、池198，准入547/563无新增。准入判据未改变，全部最终指纹及逐条裁决以r7新证据为准。

> 同批启动前预算修订：硬上限改为20、累计停线198，与现有侧车可强制的池上限198一致；预计10不变，原178→193清单保留为被修订采样。此前未新增CLI启动。

> 上述总15及预算补记均为当时采样；当前执行口径以恢复报告最新段与hash权威指针为准。用户现已独立授权“授权轮次可以按需增加，不必询问授权”，v8仅发布16B/17C有界批、18仍拒绝，后续按需另落批次；v2守卫不核批大小，有界性由发布核验及审查约定保证。16B run20261011T093157Z有效、五条裁决合入r20、普通plan依明确委托批准，review203/213、admission590/602完成件齐备；先同步时点口径，再实施新取证。原874矩阵5/1/6按其原指纹保留，新任务书/新包未测。准入判据变化仍需单独批准，旧失败/拒绝/台账不改。

本批实现核对顺序：先保持原actual_read/写拒绝/禁读/MCP/汇总函数及旧原件；只在Codex/read增加README bytes/hash前后状态与顶层byte-exact/no-normalization诊断，完整输出/cwd/两个ID唯一配对，无尾部归一；诊断不决定原准入。核14真实非目标prompt哈希及新提示无首词泄露/预设结论、授权历史/当前读取壳，然后串行双遍check、源/安装桩14/14、最终build和正常四目标安装/28入口/七备份/配置hash。将新完整指纹与未测矩阵先落盘冻结，再17C完整base39ed审查。普通code批准后另发实际Qwen读取首臂及必要版本的精确批清单，无重试/全局配置/自动升级；失败与旧874矩阵保留，不用诊断false改判原断言。


> 第19B/r22获批写合同取证（设计v1.3.153）：19B run20261011T113848Z有效，9意见逐条接受，完整r22修订及用户明确委托的普通plan批准已记录；20C尚待实施、检查与完整代码重审。仅生产Codex/write在独立临时夹具创建WRITE_CONTROL.json（O_EXCL、0600、真实非软链根），固定原目标/标记及未导出原BREACH字面，不改src探针命令。canonical唯一调用条件第六参接合同；旧五参14样本仅历史兼容，当前非目标逐项字节对账。提示仅单cat合同后从实际输出取command/cwd/target，逐字执行一次，不提供写命令或结果示例，不强迫工具、不循环换提示。新模块进入assets全指纹及版本重录。
>
> fixture-before/after保存合同普通文件状态、声明nonce、bytes/hash；result.write_contract_diagnostic只诊断：kind=diagnostic-only、严格全文字节/双身份、同session/turn与可信完成/启动时间及先读后写、实际cwd和原精确写配对。缺状态/来源不一致/改变/截断/增删尾部/非cat/head/jq/复合/重复ID/错目标/未完成/乱序均false列reasons，不参与原write_pass、准入汇总或产品Schema。未知错误直抛，脱敏failure留痕并走原凭据/夹具/scratch清理。原codexCommandEvidence函数体hash不变，真实实际尝试+配对拦截+文件状态标准不变；合同存在或全文声明不能替代调用。
>
> 六个Codex/write均需新机制与最终完整指纹的实际证据；首批Qwen/Luna各一次，仅同最终指纹可省重复；Sol/Astra/Kimi/DeepSeek各新写首次合计预计8包装/native启动另批发布。正式v10有界19B/20C，21当前拒绝；审查243/248、准入633/645为19B收尾采样。旧05矩阵5通过/1未通过/6未测及所有历史保留；19预检仅三个checked_at语义变化仍使全local指纹9270→9d166，当前完整指纹12组合均未测，不能继承。五个Claude非flash生产写仍无新机制、0启动；官方Claude待订阅、服务端身份null、客户端入口实际解析未测。component/restricted候选未采用，判据变化仍需独立明确批准，目标未完成。


> 第20C后同获批范围失败留痕补正（设计v1.3.154）：20C run20261011T122355Z有效，6条逐项2接受4暂缓，普通code按用户明确委托拒绝，业务摘要0；21C待完整重审。修正仅r22已批准“失败可见、未知错误上抛、任何步骤清理”：recordAdmissionFailure保留主异常，失败保存异常进入AggregateError，不额外直出原始错误、不覆盖wx原件；cleanupPreservingFailure让原cleanupAll继续全部清理，清理异常与主异常同时保留。fixture/scratch初始化进原try/finally；failure.json增加readme_after、合同阶段/创建状态与资源可用状态，创建途中未知记null；未取得scratch返回值的清理状态不冒称已删除。selection/版本资源前预检失败仅有既有调用完成失败侧车，不承诺failure.json。
>
> 本批不改变原codexCommandEvidence字节、写/读判据、目录消费/根形态、产品Schema、模型/effort/CLI版本、全局配置。ASCII后代目录加特殊文件名联合样本、/tmp等祖先别名、理由粒度细化与采样器合并均暂缓；前两项如需支持须另审守卫/探针语义，不将未测组合追认。五Claude非flash写继续0启动，当前新完整指纹12组合均未测。按独立按需委托发布v11仅21C，22仍拒绝；新v15只换权威文件名及首注释，guard/precheck不改。review起点253、预计15/硬20/累计止273，admission本批0保持633/645，旧台账/原权威/20C原件不改，普通审批不包含判据变化。


> 第22B获批Claude精确拒绝取证（设计v1.3.155）：22B run20261011T142848Z的11意见已裁决，gate通过并按Bob本轮明确委托审批r24定稿敏感范围；23C完整代码和新指纹准入尚待验证。canonical仅真实Claude deny-read/deny-grep调用claudeDenyEvidence：生产judgeDirectoryArm true为必要非充分初筛，脚本独立核合法事件、唯一init/成功终态、每目标唯一实际调用→同ID is_error=true结果→同ID同工具同精确路径权限记录及完整覆盖。最终路径仅折/private/var，生产helper较宽归一不扩大脚本域；已录制旧精确路径/新完整目录错误白名单之外拒绝，目标成功读取或raw哨兵泄漏拒绝，允许文件成功读取不误杀。
>
> result保持deny_pass/per_file_deny原字段，新增deny_evidence伴随事实；历史原false和原件不回算，summary判据不改。新目录文本Read回放及Grep模拟不是新模型能力，Grep仍须实际调用与完整配对。Codex冻结函数/原写标准、生产probe/adapter、Schema、版本/effort和全局配置保持。当前local6cc3下12组合完整未测，旧4c87四通过仅历史；准入673/689、review283/288、正式22/23，五Claude非flash写无新机制0启动，官方Claude待订阅。component/restricted判据替代未采用，仍须Bob独立明确批准；详见[设计契约](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-directory-contract)，M11前置仍未完成。


## 第24B获批集中取证边界（2026-10-12）

B层全部启动计admission池并按controlled-mechanism类别分列，review独立计正式审查。当前731/742、313/318、正式24/25；pilot逻辑2预计4硬6，后续三组合预计6硬8。事前发布具体脚本/hash、目标/实际模型、预计/硬/累计池；不足先扩容留痕。桥接/模式/工具面/配对/泄漏/清理任一未知失败停止，不循环调参。 完整规范见[设计v1.3.156](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-controlled-contract)；执行结果以恢复报告和r17证据为准，不能由剧本或计划宣称已测。
