{{> args/line@ARG_MODE}}

# 命令 {{ENTRY}} · {{fm:description}}

下文 `TV` 指 `.trivium/bin/trivium`——**一律用这个项目相对路径**，不依赖 `PATH`
也不依赖 `${CLAUDE_SKILL_DIR}`（设计 §5.3 / §10.5）。
若该文件不存在，说明本项目还没初始化：提示用户先运行 `trivium init`，然后**停止**。

## 执行契约（必须严格按序，不得跳步）

**你不得自行调用 `agy` 或 `zcode`。** 并行、超时、指纹、轨迹核验、防覆盖命名、
裁决校验全部在编排器内（设计 §16.2 纪律 4）。你的职责是按序准备被审对象、调用编排器、完整读取审查意见并撰写裁决。

{{> guard/main@GUARD}}

{{> review/claim@SUBJECT_KIND}}

### 1. 解析主题与被审对象

运行 `TV topic resolve --stage {{STAGE}} --json -- {{ARGS}} --driver {{DRIVER}}`。

- 用户什么都没写（既无正文也无 `--focus`）时 `topic resolve` 会退 64 并给出写法提示，
  原样转述即可（FR-20）。
- 若未提供 `--context` → 依据{{SUBJECT_NOUN}}内容补一份涉及路径清单再传入。
  你在起草时本就知道涉及哪些模块，这一步能显著提升审查质量（UR-01 / AC-11）。
  **清单不能写到本轮的禁读范围**：对端的审查件或它们所在的目录、运行目录、`.trivium/`（项目配置与 `bin/` 除外）、
  凭据类文件，或罩住这些的目录（如 `.`）——写到了，第 3 步的 `--start` 会退 64 并逐条点名路径、类别与哪几侧。
  撞上时按来源处置：`--context` 是**用户写的** → 原样转述并停止，由用户改；
  是**你自动补的** → 按报错去掉点名的条目后重跑，并在开场播报里写明去掉了哪几条（不要静默去掉）。

**命令后的正文就是审查焦点**（「这次重点看什么」，进 BRIEF 第 2 段，FR-20 / AC-09 的
唯一落点，逐字嵌入）。用户不需要区分「目标」与「焦点」，直接写重点看什么即可。
任务目标（「这次要达成什么」，进第 4 段）**不必**用户提供：编排器会回退到 `task.json`
已记录的目标或同主题计划定稿；用户确实想指定时写 `--goal <任务目标>`。
也兼容显式写法 `<任务目标> --focus <焦点>`：给了 `--focus`，正文就落到任务目标上。
`--focus` 与 `--goal` 都贪婪取到下一个已知旗标为止，带空格无需引号。

**构造这条命令时，把用户正文整段放进一个单引号参数，旗标放在引号之外。**
`--` 之后的内容按 shell 参数逐个解析、不再重新分词：正文里的 `--xxx`、引号、`$`、
反引号、`*` 都是字面量，会逐字进入焦点。不要指望用户在聊天框里自己加引号：
他们不会，也不该被要求这么做。

例：用户说「重点核实 `{{SUBJECT_FLAG}}` 透传说明是否准确」，要传成

```
TV topic resolve --stage {{STAGE}} --json -- '重点核实 {{SUBJECT_FLAG}} 透传说明是否准确' --topic <主题> --driver {{DRIVER}}
```

正文里若有单引号，写成 `'\''`（关引号、转义一个单引号、再开引号），**其余任何字符一律不转义**：

```
TV topic resolve --stage {{STAGE}} --json -- '看 it'\''s 这一处与 "双引号" 的处理' --topic <主题> --driver {{DRIVER}}
```

**不要改用双引号**（`$`、反引号会被 shell 展开），**不要补字面引号**（新版解析器不剥引号，
补了会原样进 BRIEF）。不包引号就把正文裸露出去，正文里的 `{{SUBJECT_FLAG}}` 会成为真旗标、
连同后一个词一起被抠走。`--topic` 被包进了引号里，resolve 会退 64 并指出来；其余旗标字样
被包进去时 resolve 只在 `notes` 里提醒——照原样转述给用户。

### 2. 预检（在解析之后）

```
TV preflight --stage {{STAGE}} --driver {{DRIVER}} --critics <critics> [--profile <名称>] [--model-<审核者 id> <模型> …] [--tier-<审核者 id> <档> …] [--effort-<审核者 id> <值> …] [--profile-<审核者 id> <名> …] --json [--native-<审核者 id>] [--driver-model <模型>] [--driver-provider <供应商>]
```

- `--critics`：第 1 步 resolve 输出的 `critics` 用逗号连接，**无条件传**；
- `profile` 非空时传 `--profile`；`models` 非空时逐个传对应的 `--model-<审核者 id>`；`tiers` / `efforts` / `vendor_profiles` 非空时逐个传对应的 `--tier-<审核者 id>` / `--effort-<审核者 id>` / `--profile-<审核者 id>`； 接入字段缺席表示继承；vendor_profiles 中显式 null 必须传 --native-<审核者 id>，非空传 --profile-<审核者 id>，同侧不同时传。
- **这几样必须与第 3 步传的是同一组**，都取自第 1 步的输出，不要各拼各的。

预检要查的是本轮实际入选的那几侧：用户用 `--critics` 加进来的一侧没登录或缺本阶段模型，
不带 `--critics` 就查不到，要等拉起之后才失败。

{{> preflight/recalibrate}}

通过时若 `warnings` 非空，把每一条的 `detail` 原样念给用户，**然后继续**，不停下来等确认——警告不阻断，要不要处理由用户决定。

### 3. 启动双审并等待

先运行：

```
TV review --start --entry {{ENTRY}} --stage {{STAGE}} --topic <主题> --driver {{DRIVER}} --focus <提示语> [--goal <任务目标>] {{SUBJECT_SLOT}}{{> review/rounds-slot@STAGE}} {{MODEL_HINT}} {{TIER_HINT}} {{EFFORT_HINT}}{{VENDOR_PROFILE_HINT}} [--profile <名称>] [--context …] [--critics <id,…>] [--allow-single] [--driver-model <模型>] [--driver-provider <供应商>] --json
```

`--entry {{ENTRY}}` 标记本次运行由命令 {{ENTRY}} 发起，记入 run.json 留痕；它也让 CLI 按 B/C/D 规则
校验焦点必填（缺 `--focus` 退 64）。

Driver 会话声明从 resolve 输出的 driver_model / driver_provider 逐项透传至 preflight 与 review --start 的 --driver-model / --driver-provider；null 则不传。只记录声明，不推断当前会话模型。

若上一步 resolve 输出的 `task_goal` 非空，把它原样传给 `--goal`。它与 `--focus` 是两回事：
前者说「这次要达成什么」，进 BRIEF 第 4 段；后者说「这次重点看什么」，进第 2 段。
省略 `--goal` 时编排器会回退到 `task.json` 已记录的目标或同主题计划定稿。

把 resolve 输出的 `prompt_hint` 原样传给 `--focus`。本步走标准 argv 解析，
按普通命令行写法给带空格的值加引号即可，不涉及第 1 步那套拼串规则。

若 resolve 输出的 `profile` 非空，把它原样传给 `--profile`。它换的是本次运行的
模型档位（`config.yaml` 的 `profiles`），与 `--model-*` 不冲突——后者指定具体模型、
优先级更高，前者只换默认值表。档位不存在会退 64 并列出可用值。

{{> review/subject@SUBJECT_KIND}}

**把 resolve 输出的 `critics` 数组用逗号连接后传给 `--critics`，无条件传。**
它是本轮**入选的审核者集合**，resolve 已经解析并校验完：默认值回落、旧旗标 `--only`
的单元素形态、各项合法性，全都在里面了。照抄即可。
不传不会报错——`--start` 会自己再取一次配置默认值——但用户写的 `--critics` 就此消失，
而留痕里记的入选集合看起来一切正常。这与 `--base` 漏传是同一族缺口：不报错、审的不是
用户以为的那几侧。

**不要传 `--only`。** 它是 `--critics` 的单元素旧写法，用户写了它，resolve 会把结果
并进 `critics` 数组并把 `only` 置为 null——你手上根本拿不到可传的值。
两个旗标同时递给 `--start` 会被判互斥并退 64（那是给**用户**同时写两个准备的拦截，
不是给你的）。

`allow_single` 为 true 时加上 `--allow-single`：那是用户显式要求的降级，
允许一侧失败时不中止、产出结果并留痕（§12.4）。
**漏传的后果是静默忽略用户的要求**——一侧失败就整次失败，
而留痕里看不出用户曾经要求过降级。

{{> review/rounds-pass@STAGE}}

若 resolve 输出的 `models` 字段非空，把其中的模型覆盖逐个原样传给对应的
`--model-<审核者 id>`（`models` 的键就是审核者 id：{{MODEL_FLAGS}}）。
**用户指定的模型只在这一步才真正生效**——第 2 步的预检只拿同一组覆盖值做校验，
`--start` 不会沿用它（`--start` 自己再校验一次 slug，见 `review.ts` 的 slug 校验注释），漏传会静默回退到
profile 配置模型，且留痕里记的就是回退后的模型，事后看不出用户曾经指定过。

resolve 输出的 `tiers` / `efforts` / `vendor_profiles`（M11 第 5 步）同理：逐项原样传给对应的旗标。接入字段缺席表示继承；vendor_profiles 中显式 null 必须传 --native-<审核者 id>，非空传 --profile-<审核者 id>，同侧不同时传。
`--tier-<审核者 id>`（{{TIER_FLAGS}}）、`--effort-<审核者 id>`（{{EFFORT_FLAGS}}）、`--profile-<审核者 id>`{{VENDOR_PROFILE_CLAUSE}}，
与第 2 步的预检同一组。漏传会静默回到档位表与 `default_tier` 的取值，留痕里记的是回落后的档位与来源。思考等级与厂商 profile 随请求下传给各家（M11 第 6 步）；取值不合法（枚举外、该侧没有这个概念、厂商 profile 不在本机名单）由预检退 64、gemini 的 slug 已编码档位时只告警——照样原样传，不要自行去掉，拒绝由编排器给出。

它会冻结送审包、派生工作进程后**立即返回**，输出含 `run_id`、`max_waits`、
`wait_timeout_s`、`bash_timeout_ms`，以及开场播报要用的 `stage_timeout_s`
与两侧生效 `models`。

返回含 `finished_inline: true` 时（FR-23 纯文档跳过），**没有工作进程也没有进度**：
跳过下面的开场播报与 `--wait` 循环，直接把 `notice` 转述给用户并收尾。

**`--start` 返回后立刻向用户播报一条**：主题、阶段、两侧模型（`models`）、
本阶段预算（`stage_timeout_s`）、汇报节奏（约每 `wait_timeout_s` 秒一次）、`run_id`；
并告诉他想看本次运行的实时进度用 `TV review --status <run_id>`，想看全局闸门与
降级记录用 `{{cmd:dual-status}}`，想中止用 `TV review --cancel <run_id>`。
这些值**一律取自返回值**，不要写死——模型经 profile 与 `--model-*` 覆盖路由，
写死就会漂移成错误播报。

`--start` 返回的 `warnings` 非空时，在开场播报里逐条原样念出 `detail`，并提醒：想中止就用 `TV review --cancel <run_id>`。
这条警告是按**本轮实际入选侧**、在拉起前复查的（第 2 步的预检已按同一组查过，两步之间配置或探活结论可能变）；
它随返回值到达时审查已经拉起，拦不住拉起，但能让用户立刻决定要不要中止。

然后循环运行：

```
TV review --wait <run_id> --timeout <wait_timeout_s> --json
```

> **每次 `--wait` 的 Bash 调用必须把工具级超时设为返回的 `bash_timeout_ms`。**
> Bash 工具默认超时是 120s，而 `--wait` 会等满 `wait_timeout_s`——不设就必被
> 工具超时杀掉，这一条是本命令能否跑通的前提。
>
> 若某次 `--wait` 因工具超时而拿不到退出码：**按「仍在运行」处理**，
> 计入 `max_waits` 预算后继续下一次 `--wait`。工作进程不受影响，仍在跑。

**每次 `--wait` 返回后，先向用户发一条文本消息，再发下一次 `--wait`。**
这条消息是**给用户看的**，不是工具输出——工具输出在折叠视图下用户看不到，
只打印不等于反馈。内容用返回里的 `progress_brief`，原样念一行即可：不要改写、
不要合并、不要「等下一次一起说」。退出码 `73` 与 `0` 都要说。

若两侧状态较上次有变化（`running`→`ok`、`attempt` 增加、出现 `note`、某侧进入作废重跑），
在那一行后面补一句说明变化。**状态不变时不要补**——每次都写只会淹掉真正的变化。

退出码含义：`73` 仍在运行（播报后继续等）；`0` 两份审查文档与元数据已落盘
（播报总耗时与两份文档路径后进下一步）；其它按原样转述并停止。
循环次数上限以**最近一次** `--wait` 返回的 `max_waits` 为准（`--start` 给的是初值；某侧读到对端产物、
作废重跑时，编排器会追加一个单侧超时的份额），超限则停下求助人工。

### 4. 完整读取两份审查文档

用 Read **读全文**，禁止只读摘要段。两份都要读。

### 5. 写裁决件

依 `trivium.disposition.v1` 写出 `…-{{DISPOSITION}}-<当轮 Driver>.md`（后缀是**你自己的 Agent id**，
不是固定的 `claude`；`role` 字段填同一个值，两者不一致闸门会判 `bad_front_matter`）：

- front-matter 含 `schema` / `topic` / `stage` / `role` / `kind` / `run_id` / `addresses`；
  `addresses` 逐一列出本轮**每个出了结论的审核者**的审查文档文件名（照抄归档里的名字；失败侧不列），**不是意见编号**——
  份数不符、列了别的轮次或编号，闸门判 `bad_front_matter` 并给出期望的文件名；
- 正文含一张裁决表，列名固定：意见编号 ｜ 来源 ｜ 严重度 ｜ 裁决 ｜ 理由 ｜ 落点；
- **每个**意见编号都必须出现且仅出现一次，裁决取值为 接受 / 驳回 / 暂缓；
- 三种裁决**都**要有非空理由；**接受**必须写明落点；
- 禁止静默忽略任何一条（FR-14）。即使全部驳回也必须产出本件并写明「无修改及原因」。

{{> review/next-plan@STAGE}}

{{> review/apply@STAGE}}

### 6. 校验裁决完整性

运行 `TV gate --stage {{STAGE}} --topic <主题> --check --json`。
若返回缺失编号，补齐后重跑本步；重跑最多 3 次（首次校验不计），
仍不通过则向用户说明缺口并停下，交给用户处理。

`failures` 含 `task_unreadable` 时**不是裁决缺口**：审批正本 task.json 读不出，补裁决件无济于事，
也不计入上面的重跑次数。原样转述后停下，由用户在终端恢复正本后再重跑本步。第 7 步的停点命令遇到同样情形也退 2，照此处理。

{{> review/loop@STAGE}}

### 7. 停点

运行 `TV gate --stage {{STAGE}} --topic <主题> --await-approval`，
把它输出的停点话术与三份文档路径转述给用户，然后**停止**。

**审批的发起权在用户手里。** 转述完就停下等他，不要自己去跑 `approve`——
技术上你做得到（`approve` 不校验调用来源），正因如此这句才写在这里。

{{AFTER_GATE}}
