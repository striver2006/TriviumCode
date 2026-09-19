# PROTOCOL：Driver-DualCritic 工件中继与协议契约

> 依据 [设计 v1.3.30](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md) 第 6、7、9 章与 [PRD v1.4.6](../01_requirements/PRD_driver_dual_critic.md)。
> **本文是对实现的描述性汇总，不是第二份规范。** 与设计文档冲突时以设计为准。
>
> **⚠️ 本文描述的是当前真实生效的契约**（**`config.v2`** / **`run.v2`** / 四家审核者（缺省三家）/ `--driver <id>`）。
> `run.v2`（含 `driver` / `critics_selected` / `review_mode: full|partial`）于 M7b 第 3 步生效，规范见设计 6.7.1；
> `config.v2`（`critics.*` → `agents.*`、`allow_single_flag` → `allow_partial_flag`、
> 新增 `review.default_critics` / `max_critics`）于第 4 步生效，规范见设计 13.1.1。
> 两份 v1 均降为**历史契约**：`run.v1` 读侧双读，`config.v1` 读侧自动迁移——
> **已初始化的项目不改配置也能跑**，磁盘改写由 `trivium init` 可选执行（带备份）。
> **`--critics <id,…>` 自 M7b 第 5 步起生效**：选 1～`max_critics` 个审核者，
> 缺省取 `review.default_critics`，校验不过退 64 且零工件；`--only` 是它的单元素旧写法，
> **两者同时给即拒**。选 1 侧记 `review_mode: full`、不写 `degraded_reason`——
> 配置意图不是降级。规则细则见设计 7.1。
> **`--driver <id>` 自 M9 第 5 步起生效**：缺省 `claude`，取值须为已登记 Agent。
> 它决定本轮谁是 Driver，进而决定**原稿与裁决件的后缀**（`locateSubject` 按它定位
> 被审对象，写错后缀在 `review --start` 就退 65）、闸门按谁定位裁决件、以及留痕里
> 记的发起方。规则细则见设计 §7.1。
>
> **裁决件 `role` 自 M9 第 6 步前置（EV-66）起放宽**：取值是**当轮 Driver 的 Agent id**，
> schema 不枚举（`type: string`），「是否已登记」由代码层按注册表校验——与 `run.v2` 的
> `driver` 同口径。**不是「enum 四值」**：那等于在 schema 里抄第二份 id，第五家登记时必漏改。
> 文件名后缀与 `role` 必须同指一人，闸门两头都比对，不一致即 `bad_front_matter`。
>
> **`addresses` 基数 1～3 已随 M7b 的 `--critics` 生效**（`minItems: 1`，上限即入选审核者数）。
> **意见编号前缀已是四值**（`CODEX-` 随 M8、`CLAUDE-` 随 M9；取值由注册表派生、schema 不枚举）；
> `--tier-*` / `--effort-*` 等旗标**尚未生效**，随 M10 / M11 并入本文。
> `--critics` 当前可选四家：codex / gemini / glm 为缺省集合（默认即三侧，D4-4），
> claude 只在 `--driver` 取非 claude 时可入选（当轮 Driver 不得入选）。
> **按本文实现的客户端不会被演进破坏**：读侧双读、旧形态长期兼容。

各方（当轮 Driver 与入选审核者 Critic-A～D）之间**没有**任何进程间
协议——它们互不通信。全部协同经由**本地文件**与**编排器进程**完成。这是有意的设计
（原则 P4 工件即接口）：能被读、能进 Git、能事后独立复核的东西才算接口。

---

## 一、六份 JSON Schema

机读契约的唯一真理来源在 `skills/dual-critic/schema/`，ajv（draft 2020-12）强校验。
`review.v1` 由 `parse` 持有（要把错误回喂给模型），其余集中在 `schemas.ts`。

| Schema | 文件 | 生产者 | 校验落点 |
| :--- | :--- | :--- | :--- |
| `trivium.review.v1` | `review.v1.json` | 各入选审查员（最终回答即该 JSON） | `parse`（失败即 parse_fallback） |
| `trivium.disposition.v1` | `disposition.v1.json` | Driver（裁决件 front-matter；表格由 gate 单独解析） | `gate --check` 的 bad_front_matter |
| `trivium.run.v2` | `run.v2.json` | 编排器 | `writeRunMeta` 写前校验；留痕核对把不合契约的 run.json 视为「不可读」并拦提交 |
| `trivium.run.v1` | `run.v1.json` | **已停写**（M7b 第 3 步前的编排器） | 只读：既有归档按写入时的规范解读，读进内存时迁移为 v2 形状 |
| `trivium.config.v2` | `config.v2.json` | 人（`.trivium/config.yaml` / `config.local.yaml`） | `loadCtx` 四级合并后校验，不合法退 69 并逐条列出（未知字段、枚举值、区间） |
| `trivium.config.v1` | `config.v1.json` | **已停写**（M7b 第 4 步前的形状） | 只读：`loadCtx` 在合并**之前**逐源迁成 v2，磁盘文件不动 |

### `trivium.run.v2` 的读侧分发（按阶段，设计 6.7.1）

审查阶段（`plan` / `code` / `bug`）只认 `run.v1`（迁移为内存 v2）与 `run.v2`，
**其余取值含缺失一律判「不可读」**——此前是「非 v1 即放过」，把 `schema` 改成任意
字符串就能让工件清单脱离契约校验。verify 阶段另认 `verify-run.v1` 与历史 `run.v1`，
且**不施加审查元数据契约校验**：那是按写入时的规范解读留痕，改错会让归档中的历史记录
被判不可读，进而永久拦死每一次提交。

`run.v2` 的 Agent id 与 vendor **不在 schema 里枚举**：唯一来源是 `agents/registry.ts`
（设计 §16.2 纪律 7），身份校验由 `schemas.ts` 在 ajv 之后按注册表补做。

### `trivium.config.v2` 的迁移与两段式校验（设计 13.1.1）

`loadCtx` 对**每个** YAML 源单独做 v1 → v2 迁移，且**在四级合并之前**——
顺序颠倒会让磁盘上的 `critics` 段作为额外的键并排落在结果里，而 `agents` 仍是内置默认，
**用户配的值一个都不生效且不报错**。迁移的触发条件也不只看 `schema` 字段：
`config.local.yaml` 是覆盖片段、通常没有那个字段，因此另认 `critics` 与
`review.allow_single_flag` 两个旧形态的特征键（它们在 v2 里都已不是合法键，不存在误伤）。

**迁移只在内存里发生，磁盘文件不动**；`trivium init` 提供可选的一次性改写（备份走 `O_EXCL`，
YAML 往返会丢注释，原注释保留在备份中）。三条跨字段规则由代码层补校：
`agents` 的键必须是已登记 Agent（**不要求 `criticEnabled`**——Driver 自身也需要配置容身之处）、
`agents.<id>.vendor` 必须与注册表相符、`default_critics` 每项必须是可用审核者且在 `agents` 中有配置段。

### `trivium.review.v1` 的硬约束

- **意见编号前缀逐侧固定，但不由 schema 枚举**：Antigravity 为 `AGY-`、ZCode 为 `GLM-`，各侧不冲突；
  schema 的 pattern 只校**形状**——`^[A-Z][A-Z0-9]*-(r[0-9]+-)?[0-9]{2,}$`
  （序号至少两位，重跑追加轮次如 `AGY-r2-01`）。
  **「哪些前缀合法、各属哪一家」的唯一来源是 Agent 注册表**（设计 16.2 纪律 7）：
  前缀是否属于本侧由 `parse.ts` 的 `checkReviewIntegrity` 按注册表判定，不合则 `guard` 记 integrity 问题
  ——那道检查校的是「属于本侧」，比枚举「在名单里」更强。
  裁决件解析器同样按注册表派生的前缀交替式过滤数据行，所以编号不合规的意见会在闸门处被视为不存在。

  > 此处曾写死 `^(AGY|GLM)-`（至设计 v1.3.5）。M7b 第 6 步的桩夹具实测发现：
  > 那样写会让第三家的**合法**结论被 ajv 拒掉、整份退化成 `parse_fallback`，
  > 而当时没有任何检查看着这份 schema，全套测试照常全绿。详见设计 6.5 与 5.1.1。
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

第 8 段逐个列路径而不给 glob，是为了事后能与工具轨迹**逐条对账**（措施 a，路径通道）。

**命令原文里出现禁读条目也同等判定**（措施 b，设计 §10.1 / M8 第 1 步）：
经 git 对象库取值（`git show HEAD:<归档内文件>`）**不产生文件系统读取**，
路径通道对它效力为零；而 codex 侧读文件本就是跑 shell，全部读取只在命令文本里。

**命中不等于作废——要看命中的是哪一类**（设计 §10.1.1，2026-09-17 收窄）。
禁读集由四类性质完全不同的对象拼成，处置分档：

| 类别 | 是什么 | 处置 |
| :--- | :--- | :--- |
| ① 对端审查产出 | 归档里他侧的审查件与 `_meta` 结构化意见 | **该侧作废** |
| ② 对端运行输出 | 运行目录里对端本轮的原始输出 | **该侧作废** |
| ②′ 己方运行材料 | 运行目录里本侧那一份，以及编排器的运行时文件 | **不算命中**（读它是编排器要求的动作） |
| ③ 编排器状态 | `.trivium/`（`config.yaml` 与 `bin/` 具名放行） | 记一笔，不影响结论 |
| ④ 凭据文件 | 命中 `sensitive_globs` 的文件 | 记一笔走安全告警线，不影响结论 |

只有前两类置 `guard.peer_artifact_read`。**分档作用在「命中的那条路径」上，不是在
禁读条目上**：运行根是一棵混合树，同一个条目下 ②′ 与 ② 并存，按条目分档等于
把整棵判成最重的那一类——那正是 2026-09-16／17 连续两轮代码双审判为阻断的形态。

两条通道逐侧记于 `run.v2` 的 `guard.peer_leak_via_path` / `guard.peer_leak_via_command`
（键缺 = 该侧没扫 ／ `hit:false` = 扫过没命中 ／ `hit:true` = 扫到了东西，**未必作废**——
作废与否看 `peer_artifact_read`）。两个字段的 `hits` 逐条带类，命令通道的 `hits`
还带命令原文与该命令碰到的那个路径。

措施 b 的承诺面是「已知形态必检」的闭集而非不可绕过，形态与盲区清单见设计 §10.1 措施 b。
它判的是「命令文本里**提到**了禁读条目」——提到即作废（经 git 对象库等方式取值
不留文件系统痕迹，证明不了没读到），但留痕措辞与措施 a 的「读到」分开，
两者是不同强度的断言。

**两条通道不是对每一侧都成立**（M8 第 2 步）：读取路径只存在于命令文本里的一族
（`traceShape: 'command-trace'`），措施 a 没有结构化输入可扫、**恒不命中**，
deny 核验完全由措施 b 承担。这一降级逐侧记于 `guard.verification_degraded.path`——
不记的话该侧的空命中清单与「扫过没命中」在留痕里完全同形。
同一字段的 `readonly` 键记另一条通道：被拒的写操作是否留痕
（`unavailable` 时「未检出写事件」不足以排除失守，但**检出了仍然判失守**）。
已知限制的完整表述见 BACKLOG **EV-19**。

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

`scrub` **不按上表分档，恒返回 `0`**——这是刻意的契约，不是漏写。它的职责是「把能抹的抹掉」，
而抹不动的两类（状态读不到、扫不完）都要人工看一眼；用非零码把它们说成失败，会让这条
本该随手可跑的运维命令在任何 `set -e` 的脚本里变成阻断。真出错（抹除失败）进人读输出与
`--json` 的 `ok: false` / `scrub_failed`——**调用方判成败读那里，不读它的退出码**。

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

**五个** Hook 注册在 `.claude/settings.json`（随仓库分发）——`PreToolUse` 下三条
（`Edit|Write|NotebookEdit` 一条、`Bash` 两条），加 `Stop` 与 `SessionStart` 各一条。

每条命令外层都包一层存在性守卫，且**区分两种情形**：

```sh
sh -c 'D="${CLAUDE_PROJECT_DIR}/.trivium"; W="$D/bin/trivium";
       test -x "$W" && exec "$W" gate hook-<名>;      # 正常路径
       test -f "$D/config.yaml" || exit 0;            # 项目从未初始化 → 静默放行
       echo "护栏失效…" >&2; exit 2'                   # 已初始化但 wrapper 没了 → 保守拦截
```

wrapper 是 `trivium init` 在本机生成的产物、**不随 Git 分发**，所以「协作者克隆仓库后还没跑过
init」是必然常态，那种情况必须静默 exit 0。但守卫**不能一律 exit 0**：那样一条 `rm -rf` 或
`chmod -x` 打在 wrapper 上，就能把四个拦截型 Hook 一次性变成永真放行，而且悄无声息。
`SessionStart` 不是拦截型 Hook（只注入待办清单），仍一律 exit 0。

| Hook | 事件 | 拦什么 |
| :--- | :--- | :--- |
| `hook-pre-write` | `PreToolUse` / `Edit\|Write\|NotebookEdit` | ①主脑写 `*-gemini.md` / `*-glm.md`（AC-07，与闸门状态无关）②编排器独占对象（运行时状态与锁、归档内 `_meta/` 与 `task.json`）③闸门期改业务文件（归档内不拦） |
| `hook-pre-bash` | `PreToolUse` / `Bash`（无 `if` 过滤） | `hook-pre-write` 只覆盖 Edit / Write，`cat > f`、`sed -i`、`tee`、`git checkout` 是旁路。按写命令形态做**启发式**拦截：命中编排器独占对象 → **任何时候**都拦；其余写命令 → 仅闸门期拦。判定在**未剥 heredoc 的原文**上进行 |
| `hook-pre-commit` | `PreToolUse` / `Bash`（无 `if` 过滤） | 裁决未齐备时禁止提交（AC-12），并校验留痕完整性 |
| `hook-stop` | `Stop` | 裁决未齐备时禁止收工（AC-02），输出 `{"decision":"block","reason":…}` |
| `hook-session-start` | `SessionStart` | 发现 `running` 的运行时以 `additionalContext` 提醒先 `--wait`；顺带回收死掉的 `running` 闸门 |

**判定读的是 `.trivium/state.json`**（`listOpenGates`），不是 `run.json`。
`review` 必须把闸门状态同步进 state.json，否则这四个拦截型 Hook 全都无事可判、一律退 0——
那是整条流水线最核心的护栏。

`gate --check` 通过后**按 `run.json` 的 `entry` 分流**：entry = B/C/D 直接立起
`awaiting_approval`（这三条命令的停点就是人工审批）；entry = A 或无 entry 才回 `idle`
（命令 A 不设人工闸门）。这两种去向都必须发生——若 B/C/D 也放回 idle，停点就被丢掉；
若 A 也停在 awaiting_approval，补齐裁决的人反被拦住，唯一出路是关掉 Hook。

**还有第三种去向：什么都不做（2026-09-16 起）。** 本轮若已有人工审批记录
（归档 `task.json.approvals[]` 里有该 run_id 的 approved / rejected / abandoned），
`gate --check` **不推进任何状态**，只输出校验结论。理由是它是**校验**命令，
没有资格撤销人的审批——而此前它无条件推进，于是「审批后按裁决补修复 →
改动涉及裁决件 → 顺手复校一次完整性」这条常见路径会把已放行的闸门重新关上，
撞上之后连提交都做不了。同样的前置判断也挂在 `--await-approval` 上（那是第二个入口）。

判据以归档里的审批记录为**正本**，读不出来时 fail-closed（视为已表态、不推进）：
把「锚被搅坏」当成「没有审批记录」，就是同一个缺陷换个触发条件重现。

`hook-pre-commit` 曾依赖 `if: Bash(git commit:*)` 做第一道过滤，但那是**前缀**匹配：
`sh -c 'git commit -m x'` 不以 `git commit` 开头，Hook 根本不触发。现已删去 `if`，改为挂
全部 Bash 事件、在进程内自行解析 git 子命令：跳过全局选项后取第一个非选项词（用
`/git.*commit/` 这类正则会把 `git log --format=commit` 误判成提交），并额外判定这次提交
**打在哪个仓库上**——前缀规则表达不了这件事。它也**不按会话过滤**：裁决完整性是仓库的
属性，不是会话的属性。

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
| `preflight --stage plan\|code\|bug\|all [--critics <id,…>]` | 设计 §8.1 的启动预检，fail-fast，失败零工件。`--critics` 指定本次要用哪几侧——只读能力、模型 slug、探活都只查这几侧，缺省取 `review.default_critics`（M8 第 3 步）。**四条 skill 的第 1 步不传它**：那时 `topic resolve` 还没跑、选侧尚未解析出来。选了非缺省侧时，该侧的可用性由 `review --start` 在拉起 CLI 之前的 `availability()` 兜住（AC-20 末条的落点），`--critics` 供用户显式预检时用 |
| `topic resolve --stage <s> -- '<正文>' [--topic <主题>] [其余旗标]` | 解析主题/提示语/被审对象/模型覆盖，**纯只读**。`--stage` 也接受 `all`（命令 A 用）。`--` 之后按 argv 逐个 token 解析、不再分词（EV-18）：正文整段放进一个单引号参数，旗标放在引号之外；`--topic` 字样被包进正文而未显式给主题时退 64。`--args` 传法已删 |
| `review --stage <s>` | 同步跑一次双审（手工调试用） |
| `review --start / --wait / --status / --cancel` | 分段协议 |
| `review --worker <run_id>` | 工作进程入口，由 `--start` 派生。**不应由人直接调用** |
| `gate --check` / `--check-artifacts` / `--await-approval` | 裁决完整性 / 最低工件集 / 置人工闸门 |
| `gate hook-*` | Hook 入口，从 stdin 读事件。**不应由人直接调用** |
| `approve` / `abandon` | 人工审批 / 放弃闸门。审批附言走 `--reason`；多余的位置参数退 64（EV-24），布尔旗标（`--reject` 等）不吞下一个 token、`=` 传值只认 true/false |
| `verify --topic <t>` | 执行显式配置的编译测试命令并落盘记录 |
| `report --topic <t>` | 主题级复盘 |
| `status` | 闸门、运行、降级与争议 |
| `scrub [--dry-run] [--json]` | 对**整个运行根**做一次凭据清扫：遍历全部项目桶，**只抹凭据、一个目录都不删**（整删是 `run_dir_days` 的职责且按项目划界，跨仓删别人的目录是越权）。准入判据与会话启动清扫同源（`admitScrub`）：worker 现势活着的不动，状态读不到一律跳过并计数。**退出码恒 `0`**，理由见 §五末段。`--dry-run` 只预测**侧层**——运行目录那一层没有哨兵、每轮都复查，有没有活取决于正文是否命中密钥，不读正文答不了（BACKLOG EV-33） |
| `init` | 在项目内布置运行时（幂等） |

参数细节见 `trivium --help`，它与实现同源、不会脱节。
