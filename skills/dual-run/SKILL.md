---
name: dual-run
description: 全流程双审：出方案 → 双审 → 修订 → 编码 → 双审 → 应答 → 改码 → 真实执行编译测试（命令 A）
argument-hint: <任务目标> [--topic <主题>] [--focus <提示语>] [--context <路径,…>] [--profile <名称>] [--model-codex <模型>] [--model-gemini <模型>] [--model-glm <模型>] [--tier-codex <档>] [--tier-gemini <档>] [--tier-glm <档>] [--effort-codex <值>] [--effort-gemini <值>] [--effort-glm <值>] [--profile-codex <名>] [--critics <id,…>] [--only codex|gemini|glm] [--allow-single]
disable-model-invocation: true
allowed-tools: Bash(.trivium/bin/trivium:*), Bash, Read, Write, Edit, Glob, Grep
---

参数：$ARGUMENTS

# 命令 A · 全流程

下文 `TV` 指 `.trivium/bin/trivium`——**一律用这个项目相对路径**，不依赖 `PATH`。
若该文件不存在，提示用户先 `trivium init` 并停止。

**你不得自行调用 `agy` 或 `zcode`。** 并行、超时、指纹、轨迹核验、防覆盖命名、
裁决校验全部在编排器内（设计 §16.2 纪律 4）。

**命令 A 不设人工闸门**（PRD 4.4），但仍受两条护栏约束：审查期禁写业务文件、
裁决未完成不得收工。两者都由 Hook 强制，不靠你自觉：Edit / Write 精确拦截，
Bash 按写命令形态启发式拦截（重定向、`tee`、`sed -i`、`rm/mv/cp`、`git checkout` …）。
本命令保留 Bash 是给 S5 编码用的（跑构建、跑测试）；审查期内**不要**用它改业务文件——
审查员正在读真实工作树，改了就是快照漂移，跑后复算会把整次运行作废。

**护栏（L1）**：本载体装有 TriviumCode Hook，审查期与闸门期的越界写入会被事前拦下。
Hook 的 Bash 侧判据有**已知误拦**：命令文本在未剥 heredoc 的原文上命中写动词、又提到任一角色后缀
（含你自己的）/ `_meta` / `task.json` / `state.json` / `.trivium` 时会被拦，不区分「写它」与「说它」。
所以原稿与裁决件用结构化写工具（Write / Edit）落笔；恢复与清理交给用户在终端执行，不要在会话里换写法重试。
`TV` 本身就含 `.trivium`：用户给的焦点或任务目标里若有写动词字面（如 `rm`、`chmod`、`tee`、重定向），
这条命令会被拦——**先问用户改措辞**（焦点要逐字进送审包，不能由你改），不要换调用路径去绕判据。

## 状态机 S0.5～S10（设计 §8.2）

**先解析、后预检**，与命令 B/C/D 的次序相反（EV-125）：预检要查的是**本轮实际入选**的那几家，
而入选要等解析之后才知道。用户用 `--critics` 加进来的一家若缺 code 阶段的模型 slug 或没登录，
不在开跑前查出来，就要到 S6——编码已经做完——才暴露。原先的「S0 预检」因此挪到解析之后，记为 S0.6；
S0 这个标签不再使用。

### S0.5 解析主题与参数
`TV topic resolve --stage all --json -- $ARGUMENTS --driver claude`

**命令后的正文是任务目标**（「这次要达成什么」，进 BRIEF 第 4 段）；审查焦点是可选补充，
只认显式 `--focus <提示语>`（进第 2 段）。输出字段：
- `topic` / `topic_inferred`：主题名。未显式 `--topic` 时由任务目标推导——**这里先不停下来确认**，
  等 S0.6 预检通过后再回显给用户确认（预检失败的话，这一轮确认就白费了）；
- `task_goal`：透传给 S2/S6 的 `--goal`；
- `prompt_hint`：非空时透传给 S2/S6 的 `--focus`，为空则省略；
- `context_paths` / `models` / `profile`：分别透传给 `--context`、对应审核者的 `--model-<审核者 id>`（`--model-codex` / `--model-gemini` / `--model-glm`）、`--profile`；
- `tiers` / `efforts` / `vendor_profiles`（M11 第 5 步）：分别透传给对应审核者的 `--tier-<审核者 id>`（`--tier-codex` / `--tier-gemini` / `--tier-glm`）、`--effort-<审核者 id>`（`--effort-codex` / `--effort-gemini` / `--effort-glm`）、`--profile-<审核者 id>`（`--profile-codex`）；思考等级与厂商 profile 随请求下传给各家，档位名与来源记入留痕（M11 第 6 步）。取值不合法（枚举外、该侧没有这个概念、厂商 profile 不在本机名单）由预检退 64——照样原样传，不要自行去掉，拒绝由编排器给出；
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
TV preflight --stage all --driver claude --critics <critics> [--profile <名称>] [--model-<审核者 id> <模型> …] [--tier-<审核者 id> <档> …] [--effort-<审核者 id> <值> …] [--profile-<审核者 id> <名> …] --json
```

- `--critics`：S0.5 的 `critics` 用逗号连接，**无条件传**；
- `profile` 非空时传 `--profile`；`models` 非空时逐个传对应的 `--model-<审核者 id>`；`tiers` / `efforts` / `vendor_profiles` 非空时逐个传对应的 `--tier-<审核者 id>` / `--effort-<审核者 id>` / `--profile-<审核者 id>`；
- **这几样必须与 S2 / S6 传的是同一组**，都取自 S0.5 的输出，不要各拼各的。

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

### S0.8 认领 plan 阶段
`TV topic claim --topic <主题> --stage plan --driver claude --json`（`<主题>` 取 S0.5 输出的 `topic`）

S1 的原稿写在 S2 的 `--start` 之前，那一刻 plan 阶段还没有运行留痕，护栏只能按**声明**判定这一阶段归谁写。
本阶段已声明为你自己时它退 0、什么都不改；**退 64 时原样转述并停止**：plan 阶段已由别家执笔，
或阶段目录里已有别家后缀的文件——**不要删那些文件来换回认领**，它们的去留请用户在终端处理。
认领是**自声明**：它记下「这一阶段由谁执笔」，证明不了你就是那一家；窗口内的认领次数也不设上限（M10a 边界 ⑥）。

### S1 起草计划
把方案写成 `.reviews/<主题>/plan/<日期>-<主题>-<当轮 Driver>.md`。用 Write 落盘。
后缀是**你自己的 Agent id**，不是固定的 `claude`——S2 定位被审对象时按当轮 Driver 过滤，
写错后缀会在那一步退 65（找不到被审对象），比闸门报得还早。

### S2 计划双审
按 `/dual-review-plan` 的第 3 步执行 `--start` / `--wait` 循环，但：
- **`--entry A`** 替代那里的 `--entry B`——它标记这轮由命令 A 发起，并让编排器接受省略 `--focus`；
- `--goal` 传 S0.5 的 `task_goal`（它在这里落进 `task.json`，之后 S6、乃至后续 bug 定位都会
  自动复用，审查员才知道这次改动要达成什么，§9.4）；
- `--focus` 传 S0.5 的 `prompt_hint`，为空则不传；`--context` 传 `context_paths`；
- `--profile` 传 S0.5 的 `profile`，为空则不传；`models` 非空时逐个传对应的 `--model-<审核者 id>`；`tiers` / `efforts` / `vendor_profiles` 非空时逐个传对应的 `--tier-<审核者 id>` / `--effort-<审核者 id>` / `--profile-<审核者 id>`；
- `--critics` 传 S0.5 的 `critics`（逗号连接），**无条件传**；`allow_single` 为 true 时加 `--allow-single`；
  **不要传 `--only`**（理由见 S0.5）：两个旗标同时递给 `--start` 会被判互斥退 64；
- **`--driver claude` 照带**（与 S0.5 / S0.6 同一个值）：它决定原稿按谁的后缀定位、谁不得入选。

**每次 `--wait` 的 Bash 调用工具超时设为返回的 `bash_timeout_ms`。**

**开场播报（含 `warnings` 的逐条转述）与每次 `--wait` 后的进度播报，随委托一并继承**，`finished_inline: true`
时跳过两者、直接转述 `notice` 的分支也一并继承。那里对 Driver 说的「先向用户发一条
文本消息，再发下一次 `--wait`」在 S2 / S6 里同样是硬要求——命令 A 的链路更长，
用户等得更久，漏掉播报的代价比命令 B/C/D 还大。

**本命令收到的模型覆盖（`--model-codex` / `--model-gemini` / `--model-glm`）、档位（`--profile`）、档位旗标（`--tier-codex` / `--tier-gemini` / `--tier-glm`、`--effort-codex` / `--effort-gemini` / `--effort-glm` 与厂商 profile 旗标（`--profile-codex`））、入选集合（`--critics`）
与降级许可（`--allow-single`）要一并传下去。** S2/S6 是委托执行，交接处最容易把它们丢掉：
- 模型覆盖与档位一丢，就静默回退到配置里的 `active_profile`，留痕里记的是回退后的模型；
- 档位旗标一丢，就静默回到档位表与 `default_tier` 的取值——用户选的档、指定的思考等级与厂商 profile 都消失（留痕里记的是回落后的档位与来源，看起来一切正常）；
- 入选集合一丢，`--start` 会自己重取配置缺省——用户加进来的那一家就此消失，两轮还可能不是同一组；
- 降级许可一丢，一侧失败就整次失败。

事后都看不出用户曾经指定过。开场播报念出的 `models` 以本轮入选侧为键——侧名与用户要求的不符，就是漏传了。

### S3 修订计划
读两份审查全文，写 `…-revised-<当轮 Driver>.md`，逐条裁决（接受/驳回/暂缓 + 理由，接受写落点）。
后缀与 front-matter 的 `role` 都填**你自己的 Agent id**，不是固定的 `claude`。

**裁决件里有「接受」时，同时写一份新一轮计划**（§6.6 规则 9，EV-214）：

- 文件名 `…-r<N>-<当轮 Driver>.md`，与原稿同目录；N 比本轮被审对象的轮次大 1（第 1 轮即 `r2`），后缀同样是**你自己的 Agent id**；
- 开头列「相对上一轮的改动」，**逐条引用**被接受意见的编号（整份回退侧的 `<前缀>-F<n>` 也要写），再给出合入后的完整计划；
- 它就是代码阶段送审的「本主题计划定稿」——代码审查员读的是轮次最大的那份计划，没有它读到的是未修订的原稿。写完之后不要再另写更高轮次的计划而不送审；
- 全部驳回或全部暂缓时不写，上一轮计划即为定稿。

闸门对带 `plan_final_check` 标记的轮次核两件事：这份文件存在，每个被接受的编号在其中整词逐字出现；缺了判 `missing_next_plan` / `next_plan_missing_ids`，并给出应写的文件名或缺的编号。它只核字面，不核合得对不对。

S5 编码依据的「已批准的修订计划」就是这份新一轮计划（没有接受项时是上一轮计划）。

### S4 裁决校验
`TV gate --stage plan --topic <主题> --check --json`。有缺口则回到 S3 补齐后重跑本步；
重跑最多 3 次（首次校验不计），仍不通过则向用户说明缺口并停下，交给用户处理。

### S4.5 认领 code 阶段
`TV topic claim --topic <主题> --stage code --driver claude --json`

让 code 阶段在 S6 的 `--start` 之前就有权威值：手工补跑的 CLI 调用漏传 `--driver` 时，
也不会静默回落到缺省 Driver。退 0 / 退 64 的处置与 S0.8 相同。

### S5 编码实现
按**已批准的修订计划**改代码。你是唯一有权改业务代码的角色（FR-01）。

### S6 代码双审
同 S2（`--entry A`、`--driver claude`，含 `--goal` / `--focus` / `--context` / `--profile` / `--critics` / `--allow-single` / 模型覆盖 / 档位旗标（`--tier-<审核者 id>` / `--effort-<审核者 id>` / `--profile-<审核者 id>`）的透传——
入选集合用的仍是 S0.5 那一组，S2 里某侧失败过也照样传它），但 `--stage code`，
按 `/dual-review-code` 的第 3 步执行。被审对象是 `git diff`，不是文档。
比较基线默认 `HEAD`，即「尚未提交的全部改动」；S5 若已经提交过，
要按 `/dual-review-code` 第 3 步的说明显式给出 `--base`，否则补丁为空会退 65。

### S7 应答确认
写 `…-response-<当轮 Driver>.md`（后缀与 `role` 都填你自己的 Agent id），
逐条「接受/驳回/暂缓 + 理由 + 修改计划」。

### S8 裁决校验
`TV gate --stage code --topic <主题> --check --json`。有缺口则回到 S7 补齐后重跑本步；
重跑最多 3 次（首次校验不计），仍不通过则向用户说明缺口并停下，交给用户处理。

### S9 按已接受项改代码
**只改已接受的项。** 驳回与暂缓的不要动。

### S10 编译测试（出口）
`TV verify --topic <主题>`。它**真实执行** `.trivium/config.yaml` 里显式配置的命令。

> **失败不得宣称成功。** 任一命令非零退出 → 全流程状态为 `failed`，
> 已产生的全部工件保留（FR-21 / AC-10）。如实向用户报告失败与退出码。

## 遇到 Bug 根因材料时

命令 A 的链路**不含**独立根因审阶段。若运行中产出了待审的根因材料，
引导用户改用 `/dual-review-bug`，并**不得**把未送审的根因标为已完成双审（FR-22）。
