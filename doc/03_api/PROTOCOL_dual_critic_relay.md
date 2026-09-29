# PROTOCOL：Driver-DualCritic 工件中继与协议契约

> 依据 [设计 v1.3.43](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md) 第 6、7、9 章与 [PRD v1.4.8](../01_requirements/PRD_driver_dual_critic.md)。
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
> **`--driver <id>` 自 M9 第 5 步起生效**：缺省 `claude`，取值须为**可用作 Driver 的 Agent**（已登记且 `driverEnabled`；M10a 第 3 步起四家均已启用）。未登记或已登记未启用的一律退 64——M9 时是「只校验已登记、未启用的放行并标注」，M10a 第 3 步收紧；收紧只作用于经 `resolveDriver` 的入口（`review --start` / `preflight` / `topic resolve` / `topic claim`，含继承判定后的再解析）。
> 它决定本轮谁是 Driver，进而决定**原稿与裁决件的后缀**（`locateSubject` 按它定位
> 被审对象，写错后缀在 `review --start` 就退 65）、闸门按谁定位裁决件、以及留痕里
> 记的发起方。规则细则见设计 §7.1。
> **四家入口自 M10b 第 2 步起生效**：每家各有一套入口 skill（安装目标与调用写法见设计 7.4.1：claude / gemini / glm 写 `/dual-*`，codex 写 `$dual-*`），
> 各自在 `preflight` / `topic resolve` / `review --start` 里写死本载体的 `--driver`；命令 A / B / D 的入口在写原稿之前跑 `topic claim`。
> 选侧来自缺省集合时**先减去当轮 Driver**（D-4）。非 claude 载体上命令参数由 Driver 模型转抄，保真边界见设计 8.5。
>
> **裁决件 `role` 自 M9 第 6 步前置（EV-66）起放宽**：取值是**当轮 Driver 的 Agent id**，
> schema 不枚举（`type: string`），「是否已登记」由代码层按注册表校验——与 `run.v2` 的
> `driver` 同口径。**不是「enum 四值」**：那等于在 schema 里抄第二份 id，第五家登记时必漏改。
> 文件名后缀与 `role` 必须同指一人，闸门两头都比对，不一致即 `bad_front_matter`。
>
> **`addresses` 基数 1～3 已随 M7b 的 `--critics` 生效**（`minItems: 1`）。**份数等于本轮落了审查文档的入选侧数**
> （status ∈ {ok, parse_fallback}，失败侧不计），每项是审查文档的文件名（或以 `<主题>/<阶段>/<文件名>` 结尾的路径）、**不是意见编号**；
> 闸门按 `run.json.artifacts[]` 派生期望集逐项比对（设计 v1.3.45 / EV-134；此前只核非空）。
> **意见编号前缀已是四值**（`CODEX-` 随 M8、`CLAUDE-` 随 M9；取值由注册表派生、schema 不枚举）；
> `--tier-*` / `--effort-*` 等旗标**尚未生效**，随 M11 并入本文（v1.3.43 前写「M10b / M11」；M10b 份额是四家入口，已生效，见上）。
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

**`run.v2` 的可选字段 `driver_guard_level`**（M10b 第 3 步，B1）：取值 `L1` / `L2`，记当轮 Driver 的**有效**护栏等级（登记 L1 的载体在 Hook 配置不在场时记 `L2`；登记 L2 的恒 `L2`，不读探针字段），规范见设计 8.5。**可选**：早于该步的留痕没有它，缺席即「无从得知」，不等于 L1；`trivium report` 时间线对旧留痕显示「—」。其余字段不变。

**`run.v2` 的可选字段 `termination`**（设计 v1.3.48，EV-142；v1.3.50 扩值，EV-145；v1.3.51 扩值，EV-150）：`{ by, exit_code }`（`by` ∈ `worker_exception` / `prepare_exception` / `sync_exception` / `post_spawn_exception`）或 `{ by: "worker_lost", reason }`（`reason` ∈ `no_status_file` / `heartbeat_stale` / `pid_gone`），记这一次 `failed` 由哪条事后收尾写：worker 异常分支自己写、`--wait` 判 `worker_lost` 且工作进程确认已退出时写（或 `--cancel` 在 `--wait` 判 `heartbeat_stale` 之后结束仍挂着的工作进程并确认退出时照写同一取值，设计 v1.3.54，EV-146）、准备阶段写完骨架之后失败（含 `--start` 在子进程诞生之前失败）或同步路径异常时由本进程写、`--start` 在子进程诞生之后失败时终止工作进程并确认退出之后由本进程写（`post_spawn_exception`）；都只在 run.json 仍为 `running` 时写。**只增不减**：旧版本读不懂新取值，回滚代码时保留取值面（schema、`EXCEPTION_TERMINATION_BY`、`report` 的说明与对应用例），只回退行为代码。只存结构化字段、不存异常原文。缺席 = 正常收尾、取消轮（`status: cancelled` 已说明来路）或本字段之前的留痕，规范见设计 6.7 注记与 6.7.1。

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
  4. tree_hash' 落盘为 snapshot.after_tree_hash（与 drift 同一次收尾写入）——
     只供审批时的工作树改动摘要作基线，不参与任何判定（设计 8.5 / 6.7.1，EV-132 候选 ② 折中版）
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
    先占主题锁 → prepareRun（冻结、渲染 BRIEF、置闸门 running——被拦即退 2 且不落盘、写 run.json 骨架）
    → spawnDetached 工作进程 → 把锁改记 worker 的 pid → 立即返回
    （写完骨架之后、子进程诞生之前失败：回收闸门后把骨架收尾为 failed，termination.by = prepare_exception，设计 v1.3.50）
    （子进程诞生之后失败：先按进程组终止工作进程并以子进程句柄确认退出，再回收闸门、收尾为 failed，
      termination.by = post_spawn_exception、status.json 已终态不动、放锁；确认不了退出则一概不回收，设计 v1.3.51）

循环（至多 max_waits 次，每次的 Bash 工具超时必须设为 bash_timeout_ms）：
  trivium review --wait <run_id> --timeout <wait_timeout_s>
    → 73 表示仍在跑，打印进度后继续；0/非 73 表示终态
```

约束：

- 工作进程每 30s 写一次心跳到 `status.json`；`--wait` 在进程不在或已不是同一进程（`pid_gone`）、
  进程活着但心跳超过 `heartbeat_stale_s`（默认 120s）未更新（`heartbeat_stale`）、status.json 与 pid 都拿不到（`no_status_file`）
  三种情形下判 `failed(worker_lost)`；工作进程确认已退出时先把归档 run.json 收尾为 `failed`（设计 v1.3.48，EV-142）。
  `heartbeat_stale_s` 不大于心跳间隔（30 s）时健康的工作进程也会被判失联：`--wait` 的报错当场点明，预检与 `--start` 事前出只警告项「失联阈值」，两处共用 `status.ts` 的 `staleThresholdWithinHeartbeat`（设计 v1.3.57，EV-160）。
- 进程存活性比对 `ps -p <pid> -o lstart=`，**不能只看 `kill(pid,0)`**：macOS 会复用 PID。`lstart` 随 TZ 与区域设置变化：status.json 的 `worker_started_at_canonical` 与锁文件的 `pid_started_at_canonical`（EV-158，设计 v1.3.55）记以 `LC_ALL=C`、`TZ=UTC0` 取的规范化启动时刻，有它时身份只按它比（读者也按规范化环境取），缺席（旧版写的）才退回按读者缺省环境比 `worker_started_at` / `pid_started_at`。规范化形态是盘上契约：变更须换新字段名，禁止就地改。
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
| `hook-pre-write` | `PreToolUse` / `Edit\|Write\|NotebookEdit` | ①主脑在归档内写审核者后缀的文件（全部已登记角色减当轮 Driver，claude 为 Driver 时即另三家；AC-07，与闸门状态无关）②编排器独占对象（运行时状态与锁、归档内 `_meta/` 与 `task.json`）③闸门期改业务文件（归档内不拦） |
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
| `preflight --stage plan\|code\|bug\|all [--critics <id,…>] [--profile <名称>] [--model-<id> <模型>]` | 设计 §8.1 的启动预检，fail-fast，失败零工件。`--critics` 指定本次要用哪几侧——只读能力、模型 slug、探活都只查这几侧，缺省取 `review.default_critics`（M8 第 3 步）。**命令 B / C / D 的第 1 步不传它**：那时 `topic resolve` 还没跑、选侧尚未解析出来；选了非缺省侧时，该侧的可用性由 `review --start` 在拉起 CLI 之前的 `availability()` 兜住（AC-20 末条的落点），但探活不在其中。**命令 A 自 EV-125 起在解析之后预检**（S0.6）：带上 `topic resolve` 输出的 `critics`，以及非空时的 `--profile` / `--model-<id>`，三个阶段入选各侧的 slug 与探活都在开跑前查——命令 A 漏查的 code 阶段 slug 要到 S6（编码之后）才会暴露。`--critics` 也供用户显式预检时用。**只警告项**（EV-123，设计 8.1「警告这一级」）：`--json` 输出恒带 `warnings`（`{ name, detail }[]`，无警告时为 `[]`），`checks[]` 单项在 `warn` 为真时带 `warn: true`；`warn` 不影响 `ok` 与退出码，skill 在通过时逐条念给用户后继续 |
| `topic resolve --stage <s> -- '<正文>' [--topic <主题>] [其余旗标]` | 解析主题/提示语/被审对象/模型覆盖，**纯只读**。`--stage` 也接受 `all`（命令 A 用）。`--` 之后按 argv 逐个 token 解析、不再分词（EV-18）：正文整段放进一个单引号参数，旗标放在引号之外；`--topic` 字样被包进正文而未显式给主题时退 64。`--args` 传法已删 |
| `topic claim --topic <主题> --stage <s> --driver <id> [--session-id <id>]` | 为该**阶段**声明当轮 Driver（M10a 第 1 步，EV-72）。plan / bug 原稿写在 `review --start` 之前，那一刻该阶段零留痕、判定回落缺省 Driver，非缺省 Driver 写不出自己的原稿。`--stage` **必填不默认**：声明直接决定 Write / Edit 侧的保护集。判定顺序自上而下：**留痕优先**——该阶段已有运行留痕且与 `--driver` 不同 ⇒ 退 64（出口是新开主题或换阶段）；已声明同值 ⇒ 幂等退 0 且**不刷新** `claimed_at`；该阶段子树里已存在**他家角色后缀**的文件 ⇒ 退 64（那些文件可能是撤回前的旧声明留下的，也可能是尚无声明时写下、仍在使用的原稿；出口是由用户确认去留、在终端处理后重试。不在会话里删它们来换回认领——这条限制防的正是会话自己反复翻转声明，见设计 7.1 `topic claim` 段）；其余合法认领放行。撤回的旧声明整条追加进 `drivers[<阶段>].history`，不覆盖。`--session-id` 落进 `claimed_by`，与 `approvals[].session_id` 同一个用途：自声明边界要让事后对得上账 |
| `review --stage <s>` | 同步跑一次双审（手工调试用） |
| `review --start / --wait / --status / --cancel` | 分段协议。`--start` 的返回恒带 `warnings`（EV-123）：拉起前按**当轮入选侧**复用预检的判定函数 `checkModelOverrideSource` 查出的只警告项，以及 `checkHeartbeatThreshold` 的「失联阈值」（`heartbeat_stale_s` 不大于工作进程心跳间隔 30 s 时出；只读配置、与入选侧无关；设计 v1.3.57，EV-160），两者同一次汇总，形状同预检；在派生之后随返回值到达（拦不住拉起，skill 在开场播报里念出并提示可 `--cancel`）；`finished_inline` 时为 `[]`；同步 `review --stage` 不做这项复查，它的 `--json` 另有既有的 `warnings: string[]`（运行期告警），与 `--start` **同键不同形**，不要按 `detail` 读。`--cancel`：向工作进程组发 SIGTERM，工作进程先按组终止它以 `killTree` 拉起的审查员 CLI（宽限 2 s → SIGKILL，真实 CLI 对 SIGTERM 的处置未实测）再以 SIGTERM 退出；5 s 内没退出即升级 SIGKILL；那时以及工作进程此前已不在时（含 status 已被 `--wait` 判失联写成 failed、走终态早退分支的情形），按 status.json 的逐侧 CLI 进程组记录逐组结束审查员 CLI（组长活着且规范化启动时刻相符、或组长已退出但组号下还有非僵尸成员时都发信号，宽限链同上，v1.3.60 起后者同样按组结束，EV-165；终态分支只结束进程、不写 status.json（`gone` 格自 EV-159 起补收归档 run.json / task.json，见下方「失联后仍挂着的工作进程」段末句，status.json 仍不写）；判不了、记录读不懂、成员计数取不到、没有记录时 stderr 如实提示；设计 v1.3.53，EV-154）；CLI 先于工作进程退出后遗留的子进程、CLI 自己脱离进程组的后代也够不到，这两格不打提示（设计 7.5「工作进程的信号语义」）。`--wait --json` 的 `sides` 与 `--status --json` 的 `status.sides` 每侧多一个 `cli` 键（`{ pgid, started_at }` 或 null，设计 v1.3.53；加法，旧调用方忽略）；status 另多一个 `worker_started_at_canonical` 键（字符串或 null，设计 v1.3.55，EV-158；加法，旧调用方忽略）。（EV-128，设计 v1.3.47）工作进程确认退出后，把仍为 `running` 的归档 run.json（仅 run.v2）收尾为 `cancelled`（只改 `status` / `finished_at` / `gate.state`，`artifacts[]` 原样）并同步 `task.json` 登记（run.json 不是 cancelled、登记里找不到、登记已不是 running 时跳过），再把 status.json 标 `cancelled`、回收锁与闸门；没确认退出或 run.json 已是终态时不写，输出写明原因；单步写失败只告警、没有第二次机会，告警要求人工核对。**失联后仍挂着的工作进程**（设计 v1.3.54，EV-146）：`--wait` 判 `worker_lost` 时在 status.json 记 `lost = { reason, at }`（`--wait --json` / `--status --json` 的 `status` 因此多出 `lost` 键，对外 JSON 形状的加法，旧调用方忽略）；`heartbeat_stale` 的报错先列判定依据再给 `--cancel` 出口。之后 `--cancel` 在 status.json 为 failed、`lost.reason` 为 `heartbeat_stale`、工作进程仍是同一进程时，按组结束它（宽限 5 s → SIGKILL → 至多再等 5 s 确认）、按记录结束审查员 CLI、把仍为 `running` 的 run.json 与登记补收为 `failed`（`termination` 同 `--wait`）、按 run_id + pid 回收锁；status.json 不写、闸门不动、凭据副本不抹；确认不了退出时 run.json 与锁不动；身份判不上（`mismatch`）时连记录里的审查员 CLI 也不结束，身份缺失（`no_identity`）时 CLI 沿用 EV-154 终态分支自己的判断；两格 stdout 都说「未对工作进程……发信号」而不是「无需取消」；一个信号都没发就判已不在时说「未及发信号」。退出码仍为 0。**`gone` 格补收**（设计 v1.3.56，EV-159 第一形态）：`worker_pid` 上已没有活进程时（含「两种启动时刻都缺失」这一收窄进来的子情形），`--cancel` 与 `alive` 格一样按 EV-142 的前提把仍为 `running` 的 run.json 与登记补收为 `failed`（`termination` 同 `worker_lost` / `heartbeat_stale`）、按 run_id + pid 回收锁；status.json 不写、闸门不动、凭据不抹；stdout 说「工作进程 N 已不在」，不说「无需取消」，也不复述归档补收的结果（只说「见上方输出」，那两行由前面的收尾步骤播报）；已是终态或归档缺失时按前提跳过、如实说明，可重入。`mismatch` 与「两种启动时刻都缺失但进程还在」的 `no_identity` 不在此列，一律不补收。**凭据副本的准入**（设计 v1.3.58，EV-157）：`--cancel` 主路径与 `--wait` 判失联抹凭据副本之前，与会话启动清扫 / `scrub` 同一判据——工作进程确认已不在，且 status.json 记录里的审查员 CLI 进程组没有仍在、判不了或读不懂的（`--cancel` 判的是按记录结束之后的事实）；被 CLI 挡住时不抹，`--cancel` 的 stderr、`--wait` 的报错正文各多一行「凭据副本未抹：工作进程 N 已不存在，但审查员 CLI 未确认结束——〈逐侧〉…留给会话启动清扫」，退出码、归档收尾与其余输出不变；工作进程一半未过时那一行的文字与此前相同。`--wait` 在阻挡项里有判「仍在」或「组长已退出、组员仍在」（`orphaned`，v1.3.60 起，EV-165）的组时再多一行 `--cancel` 出口（`--cancel` 的终态分支会按记录结束它们；判不了 / 读不懂时不给，代码双审 r1 CODEX-02） |
| `review --worker <run_id>` | 工作进程入口，由 `--start` 派生。**不应由人直接调用** |
| `gate --check` / `--check-artifacts` / `--await-approval` | 裁决完整性 / 最低工件集 / 置人工闸门。立停点时（`--await-approval`，以及命令 B / C / D 的 `--check` 通过后自动立）追加打印工作树改动摘要，`--await-approval --json` 带 `worktree_summary` 键；只告知，不参与判定、不改退出码 |
| `gate hook-*` | Hook 入口，从 stdin 读事件。**不应由人直接调用** |
| `approve` / `abandon` | 人工审批 / 放弃闸门。审批附言走 `--reason`；多余的位置参数退 64（EV-24），布尔旗标（`--reject` 等）不吞下一个 token、`=` 传值只认 true/false。**通过前复核**（M10a 第 3 步）：与 `gate --await-approval` 共用一份判定——本轮裁决齐备 + 本轮 `run.json.artifacts[]` 的 sha256 抽核；不通过退 2，推断不出 run_id 或运行元数据读不出退 65（出口是 abandon 后重跑）。拒绝与放弃不复核。复核不保证「审批来自人」。**通过时先打印工作树改动摘要**（复核之后、落审批之前）：自审查收尾以来改过的文件，基线 `snapshot.after_tree_hash`；`--json` 带 `worktree_summary`（按阶段，每阶段 `available` / `reason` / `run_id` / `baseline_tree` / `current_tree` / `total` / `truncated` / `files`（最多 200 条）/ `excluded_prefixes` / `budget_ms` / `budget_overridden`）。只告知，不参与判定、不改退出码；取不到时报原因，不报「无改动」 |
| `verify --topic <t>` | 执行显式配置的编译测试命令并落盘记录 |
| `report --topic <t>` | 主题级复盘；没产出审查文档的运行另列「未进时间线的运行」，`--json` 输出多一个 `unlistedRuns` 字段（设计 v1.3.48，EV-144） |
| `status` | 闸门、运行、降级与争议 |
| `scrub [--dry-run] [--json]` | 对**整个运行根**做一次凭据清扫：遍历全部项目桶，**只抹凭据、一个目录都不删**（整删是 `run_dir_days` 的职责且按项目划界，跨仓删别人的目录是越权）。准入判据与会话启动清扫同源（`admitScrub`）：worker 现势活着的不动，状态读不到一律跳过并计数；worker 已不在而 status.json 记录里的审查员 CLI 进程组仍活着、判不了或记录读不懂的也不动，计入 `deferred` 并在 `--json` 的 `deferred_cli`（`{ dir, detail }[]`）里逐条带成因（设计 v1.3.53，EV-38）。人读输出在这一格之后的提示只给一个出口：「记录读不懂」需把该侧 `cli` 改回 null（到期整删也会保留它）；帮助动机句带同样的限定（设计 v1.3.59，EV-164），且自设计 v1.3.61 起写明到期整删只在该仓库自己的会话启动时跑、不再回到那个仓库就没有任何自动清理（EV-166；此前「副本会一直躺到 retention.run_dir_days 整删」失实）；`--json` 不变。**退出码恒 `0`**，理由见 §五末段。`--dry-run` 只预测**侧层**——运行目录那一层没有哨兵、每轮都复查，有没有活取决于正文是否命中密钥，不读正文答不了（BACKLOG EV-33） |
| `init` | 在项目内布置运行时（幂等）。M10b 第 3 步起两家 Hook 一起合并：`.claude/settings.json` 与 `.zcode/config.json`（ZCode 形态），只增不删、写盘前备份只在真正写入时发生 |
| `hooks --agent <id> [--dry-run]` | 单独为一家渲染并合并 Hook 配置（M10b 第 3 步）：落点与形态取注册表 `hookConfigTarget`——claude 写 `.claude/settings.json`，glm 写 `.zcode/config.json`；codex / gemini 没有 Hook 机制，退 64 且零写入。`--dry-run` 零落盘。当轮 Driver 的判定**不读** `--agent`（设计 8.4 注记），它只选渲染目标 |

参数细节见 `trivium --help`，它与实现同源、不会脱节。
