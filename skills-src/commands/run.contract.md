---
name: dual-run
description: 全流程双审：出方案 → 双审 → 修订 → 编码 → 双审 → 应答 → 改码 → 真实执行编译测试（命令 A）
argument-hint: <任务目标> [--topic <主题>] [--focus <提示语>] [--context <路径,…>] [--profile <名称>] {{MODEL_HINT}} [--critics <id,…>] [--only {{ONLY_CHOICES}}] [--allow-single]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*), Bash, Read, Write, Edit, Glob, Grep
@ARG_KIND: text
@QUOTE_RULE_AT: S0.5
---

{{> args/line@ARG_MODE}}

# 命令 A · 全流程

下文 `TV` 指 `.trivium/bin/trivium`——**一律用这个项目相对路径**，不依赖 `PATH`。
若该文件不存在，提示用户先 `trivium init` 并停止。

**你不得自行调用 `agy` 或 `zcode`。** 并行、超时、指纹、轨迹核验、防覆盖命名、
裁决校验全部在编排器内（设计 §16.2 纪律 4）。

**命令 A 不设人工闸门**（PRD 4.4），但仍受两条护栏约束：审查期禁写业务文件、
{{> guard/run-enforce@GUARD}}
本命令保留 Bash 是给 S5 编码用的（跑构建、跑测试）；审查期内**不要**用它改业务文件——
审查员正在读真实工作树，改了就是快照漂移，跑后复算会把整次运行作废。

{{> guard/main@GUARD}}

## 状态机 S0.5～S10（设计 §8.2）

**先解析、后预检**，与命令 B/C/D 的次序相反（EV-125）：预检要查的是**本轮实际入选**的那几家，
而入选要等解析之后才知道。用户用 `--critics` 加进来的一家若缺 code 阶段的模型 slug 或没登录，
不在开跑前查出来，就要到 S6——编码已经做完——才暴露。原先的「S0 预检」因此挪到解析之后，记为 S0.6；
S0 这个标签不再使用。

### S0.5 解析主题与参数
`TV topic resolve --stage all --json -- {{ARGS}} --driver {{DRIVER}}`

**命令后的正文是任务目标**（「这次要达成什么」，进 BRIEF 第 4 段）；审查焦点是可选补充，
只认显式 `--focus <提示语>`（进第 2 段）。输出字段：
- `topic` / `topic_inferred`：主题名。未显式 `--topic` 时由任务目标推导——**这里先不停下来确认**，
  等 S0.6 预检通过后再回显给用户确认（预检失败的话，这一轮确认就白费了）；
- `task_goal`：透传给 S2/S6 的 `--goal`；
- `prompt_hint`：非空时透传给 S2/S6 的 `--focus`，为空则省略；
- `context_paths` / `models` / `profile`：分别透传给 `--context`、对应审核者的 `--model-<审核者 id>`（{{MODEL_FLAGS}}）、`--profile`；
- `critics`：本轮**入选的审核者集合，计划审与代码审两轮共用这一组**。S0.6、S2、S6 都把 resolve 输出的 `critics`
  用逗号连接后传给 `--critics`，**无条件传**——用户没写 `--critics` 时它就是缺省集合（已减去当轮 Driver），照传即可；
- `allow_single`：为 true 时 S2、S6 都加 `--allow-single`（用户显式要求的降级：一侧失败时不中止，§12.4）。

用户写的 `--only` 已被 resolve 并进 `critics`、输出的 `only` 恒为 null——**任何一步都不要传 `--only`**。

`notes` 非空时，把每一条原样念给用户——尤其是「主题由任务目标推导」与「主题异常短」两条：
后者通常意味着正文被裸露的 `--xxx` 旗标截断了，S0.6 之后回显主题时要提醒用户核对原始输入。

构造这条命令时，把正文整段放进**一个单引号参数**、旗标放在引号之外
（`-- '让 --base 真正进入冻结' --focus '看同类缺口'`）：`--` 之后按 shell 参数逐个解析，
不再重新分词，正文里的 `--xxx`、引号、`$` 都是字面量。正文里的单引号写成 `'\''`，其余不转义；
不要改用双引号，也不要补字面引号（新版不剥引号，补了会原样进 BRIEF）。
不包引号，正文里的 `--base` 就会被当成真旗标吞掉后一个词。

### S0.6 预检（在解析之后）

```
TV preflight --stage all --driver {{DRIVER}} --critics <critics> [--profile <名称>] [--model-<审核者 id> <模型> …] --json
```

- `--critics`：S0.5 的 `critics` 用逗号连接，**无条件传**；
- `profile` 非空时传 `--profile`；`models` 非空时逐个传对应的 `--model-<审核者 id>`；
- **这三样必须与 S2 / S6 传的是同一组**，都取自 S0.5 的输出，不要各拼各的。

`--stage all` 是命令 A 专用的范围：它校验**全部三个阶段**入选各侧的模型 slug，
并执行「`verify.build` / `verify.test` 皆空则拒绝启动」检查——
跑完全流程却无法收口是不可接受的（§14.1）。跳过单阶段专属项（此时原稿还不存在）。

失败则**原样转述**并停止。预检失败时不会产生任何工件，可以放心重试。

通过时若 `warnings` 非空，把每一条的 `detail` 原样念给用户，**然后继续**，不停下来等确认——警告不阻断，要不要处理由用户决定。

**通过之后**，若 S0.5 的 `topic_inferred` 为 true，在这里把推导出的主题回显给用户、确认后再进 S0.8。
用户改了主题，就把改后的主题作为 `--topic <主题>` 加进 S0.5 的命令重跑（正文与其余旗标不变）——
不带它照原样重跑，只会从同一个任务目标推导出同一个主题。重跑后 `critics` / `profile` / `models` 仍取自新输出，
与本步所用不同时才重跑本步。`driver` 不在比对之列：S0.5 的命令恒显式带上本载体自己的 id 作为 Driver，输出的 `driver` 恒等于它，
新主题的留痕或声明与之冲突时解析会退 64，而不是换一个 Driver。

{{> run/claim-plan}}

### S1 起草计划
把方案写成 `.reviews/<主题>/plan/<日期>-<主题>-<当轮 Driver>.md`。用 Write 落盘。
后缀是**你自己的 Agent id**，不是固定的 `claude`——S2 定位被审对象时按当轮 Driver 过滤，
写错后缀会在那一步退 65（找不到被审对象），比闸门报得还早。

### S2 计划双审
按 `{{cmd:dual-review-plan}}` 的第 3 步执行 `--start` / `--wait` 循环，但：
- **`--entry A`** 替代那里的 `--entry B`——它标记这轮由命令 A 发起，并让编排器接受省略 `--focus`；
- `--goal` 传 S0.5 的 `task_goal`（它在这里落进 `task.json`，之后 S6、乃至后续 bug 定位都会
  自动复用，审查员才知道这次改动要达成什么，§9.4）；
- `--focus` 传 S0.5 的 `prompt_hint`，为空则不传；`--context` 传 `context_paths`；
- `--profile` 传 S0.5 的 `profile`，为空则不传；`models` 非空时逐个传对应的 `--model-<审核者 id>`；
- `--critics` 传 S0.5 的 `critics`（逗号连接），**无条件传**；`allow_single` 为 true 时加 `--allow-single`；
  **不要传 `--only`**（理由见 S0.5）：两个旗标同时递给 `--start` 会被判互斥退 64；
- **`--driver {{DRIVER}}` 照带**（与 S0.5 / S0.6 同一个值）：它决定原稿按谁的后缀定位、谁不得入选。

**每次 `--wait` 的 Bash 调用工具超时设为返回的 `bash_timeout_ms`。**

**开场播报（含 `warnings` 的逐条转述）与每次 `--wait` 后的进度播报，随委托一并继承**，`finished_inline: true`
时跳过两者、直接转述 `notice` 的分支也一并继承。那里对 Driver 说的「先向用户发一条
文本消息，再发下一次 `--wait`」在 S2 / S6 里同样是硬要求——命令 A 的链路更长，
用户等得更久，漏掉播报的代价比命令 B/C/D 还大。

**本命令收到的模型覆盖（{{MODEL_FLAGS}}）、档位（`--profile`）、入选集合（`--critics`）
与降级许可（`--allow-single`）要一并传下去。** S2/S6 是委托执行，交接处最容易把它们丢掉：
- 模型覆盖与档位一丢，就静默回退到配置里的 `active_profile`，留痕里记的是回退后的模型；
- 入选集合一丢，`--start` 会自己重取配置缺省——用户加进来的那一家就此消失，两轮还可能不是同一组；
- 降级许可一丢，一侧失败就整次失败。

事后都看不出用户曾经指定过。开场播报念出的 `models` 以本轮入选侧为键——侧名与用户要求的不符，就是漏传了。

### S3 修订计划
读两份审查全文，写 `…-revised-<当轮 Driver>.md`，逐条裁决（接受/驳回/暂缓 + 理由，接受写落点）。
后缀与 front-matter 的 `role` 都填**你自己的 Agent id**，不是固定的 `claude`。

### S4 裁决校验
`TV gate --stage plan --topic <主题> --check --json`。有缺口则回到 S3 补齐，最多 3 次。

{{> run/claim-code}}

### S5 编码实现
按**已批准的修订计划**改代码。你是唯一有权改业务代码的角色（FR-01）。

### S6 代码双审
同 S2（`--entry A`、`--driver {{DRIVER}}`，含 `--goal` / `--focus` / `--context` / `--profile` / `--critics` / `--allow-single` / 模型覆盖的透传——
入选集合用的仍是 S0.5 那一组，S2 里某侧失败过也照样传它），但 `--stage code`，
按 `{{cmd:dual-review-code}}` 的第 3 步执行。被审对象是 `git diff`，不是文档。
比较基线默认 `HEAD`，即「尚未提交的全部改动」；S5 若已经提交过，
要按 `{{cmd:dual-review-code}}` 第 3 步的说明显式给出 `--base`，否则补丁为空会退 65。

### S7 应答确认
写 `…-response-<当轮 Driver>.md`（后缀与 `role` 都填你自己的 Agent id），
逐条「接受/驳回/暂缓 + 理由 + 修改计划」。

### S8 裁决校验
`TV gate --stage code --topic <主题> --check --json`。有缺口回到 S7。

### S9 按已接受项改代码
**只改已接受的项。** 驳回与暂缓的不要动。

### S10 编译测试（出口）
`TV verify --topic <主题>`。它**真实执行** `.trivium/config.yaml` 里显式配置的命令。

> **失败不得宣称成功。** 任一命令非零退出 → 全流程状态为 `failed`，
> 已产生的全部工件保留（FR-21 / AC-10）。如实向用户报告失败与退出码。

## 遇到 Bug 根因材料时

命令 A 的链路**不含**独立根因审阶段。若运行中产出了待审的根因材料，
引导用户改用 `{{cmd:dual-review-bug}}`，并**不得**把未送审的根因标为已完成双审（FR-22）。
