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

会话启动清扫只进**本项目**的桶 `<run_root>/<repoId>/`。于是在别的仓库干活的会话不会抹这个
仓库遗留的副本；崩溃、断电之后若不再回到同一个仓库开会话，副本会一直躺到 `run_dir_days` 整删。
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
| 状态读不到 N 个 | `status.json` 缺失或损坏，**不会自愈也不会重试** | 人工确认后删掉那些目录 |
| 仍有文件未扫描 N 个 | 那几份未脱敏 | 侧层成因翻该侧 `scrub.json`；运行目录层成因直接看行内带出的告警 |
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
| guard 告警说某侧「**请求的模型没有生效**」 | 该侧的模型覆盖没落到实处：`run.json` 的 `model_requested` 与 `model_effective` 不是同一个模型（判据只看 `<providerId>/<modelId>` 的 **modelId 段**——两种 providerId 形态并存，前缀不同不算问题）。**该侧的审查结论仍然有效**，但模型路由（FR-06）与异构默认（NFR-06）在本侧失效：若另一侧模型与它同家族，这一轮不构成真正的双审。glm 侧先看 `trace.json` 的 `modelSelection` 段：`route` 为 `global` 说明压根没做覆盖（同段 `reason` 写明为什么），为 `config_copy` 而 `model_override_applied` 为 `false` 说明副本写了但 CLI 没按它走——多半是 ZCode 又改了 legacy 导入的流程，先跑 `trivium doctor --only zcode --no-model-calls` 看 `model_override` 那一格（探针臂零配额实测这条前提），再按 P-31 的方式复核包内字面。**另两种成因**（代码双审 r3）：副本源 `~/.zcode/cli/config.json` 里有 `apiKeyRequired: false` 的免密 provider——导入器对整份配置直接拒掉（`Fqa`），探针臂与运行都会落回退；请求的模型名是被标 `deleted` 的成员、或该成员的 `id` 字段与键名不同形——限定按导入器同一组规则判，这两种会在准备阶段就记 `route: global` 并给理由 |
| glm 侧起得来，但留痕里的 `model_effective` 不是请求的 GLM 模型 | **已修（EV-82，2026-09-21）**。根因不是 0.16.9 删了 `model.main` 的读取点，而是编排器注入了指向你真实个人 provider 配置的变量——个人文件存在，CLI 就跳过 legacy 导入，副本里的 `model.main` 没人读。现在审查运行的副本 HOME 下**不注入**个人变量，CLI 从 `cli/config.json` 副本导入、`model.main` 生效；`trivium doctor --only zcode`（含 `--no-model-calls`）的 `model_override` 一格会在真实 CLI 上零配额实测这条前提——记 `config_copy` 即生效，记 `global` 则 CLI 又改了流程，去看 notes 里 CLI 实际写出的选择。覆盖没落实时 guard 也会出声（见上一行）。**glm 已可作为审核者启用**——此前「EV-82 结案前双审一律 `--critics codex,gemini`」的限制解除；端到端验证请用非首位模型（`--model-glm GLM-5.3-Flash`），默认档 `GLM-5.3` 恰是首位模型，回落也得到它，验不出差别 |
| `preflight`「ZCode 已认证」报 `Error: Model creation failed (traceId: …)` | CLI 在**真实 HOME** 下建不出模型，与编排器的副本机制无关（该探活走 `homeDir: null`）。`failureKind` 落在 `other` 说明它既不是缺 `cli/config.json`（那报 `model_config_missing`），也不是 provider 鉴权失败。**先取结构化根因**：`~/.zcode/cli/log/zcode-<日期>.jsonl` 里按 traceId 找 `turn.failed` 行的 `error.cause.message`（只取这个字段，日志含模型 I/O 全文，不要整份打印）。2026-09-21 实测根因是下一行 |
| 结构化根因是 `Select a model before continuing` | CLI 的模型选择解析为空。包内逻辑：先拿 `~/.zcode/v2/provider_config.json` 的 `config.defaultModelSelection` 去注册表**精确匹配**（providerId 与 modelId 都要相等，且 provider 不能 `visibility: hidden`），验不过就回落到注册表第一个可见模型，再没有就报这条。三种成因按顺序查（都只看键名与布尔值，**不要打印凭据值**）：① 该键是否缺失——`python3 -c` 读 JSON 只打 `sorted(config.keys())`；② `providerConfigRules.providerRules[].enabled` 是否全 `false`（桌面端切换 provider 家族时会关掉家族外的 provider，2026-09-21 实测如此）；③ 键指向的 providerId/modelId 是否与注册表精确相等（自定义 provider 是 UUID 形态；内置套餐是 `account:bigmodel-individual-coding-plan` + 小写 `glm-5.3`，**不是** `cli/config.json` 里的 `bigmodel-coding-plan/GLM-5.3`）。修复：先 `cp` 备份，再只改那一个键或那一个布尔值，写成 `.new` 文件核对后再 `mv` 覆盖；恢复后重跑 `trivium doctor --only zcode` 刷新探针结论 |

已知的厂商行为坑列在 [`REPORT_2026-09-11_m0_probe.md`](../05_testing/REPORT_2026-09-11_m0_probe.md)。
其中几条值得单独记住：

- `agy` 的 `-p` 进程只活约 10s，实际工作在**跨运行复用的 hub** 里。这意味着
  per-run 的 `HOME` 隔离**对 hub 不生效**。
- ZCode 会把进程名改成 `zcode-cli`，`pgrep -f 'zcode\.cjs'` 永远是空的。
- `agy` 的模型 slug 若已编码 effort（如 `-high` 后缀），再传 `--effort` 会被拒。

---

## 六、留痕相关

### 把 doctor / preflight 的输出抄进 evidence 目录之前

`doc/05_testing/evidence/` 下的实测留痕是**人工抄录**的，那条路径上**没有** secrets 闸门——
归档件与送审补丁有，手抄的没有。而 doctor 的 notes、preflight 的失败详情里会带 **CLI 的 stderr 原话**。

编排器已经把这几处原文在拼进 note / 详情之前过了一遍 `redactSecrets()`（旗标探针的未判定成因、
headless 失败 note、ZCode 探活详情、`critic.run()` 的失败提示），所以正常情况下抄过去是安全的。
**但它只认已登记的凭据形态**：厂商换一种回显写法，脱敏就漏。所以抄录前仍然自己扫一眼，
尤其是任何形如 `<id>.<secret>` 的长串。含凭据的配置文件一律 `grep` 目标键名，**不要整份打印**。

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
