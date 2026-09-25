# M10b 第 1 步 · 准入实测报告（进行中）

> **状态**：进行中。本稿只收已取得的读数；每格三态（true / false / null），未测的格记「未测」。
> **上位**：`.reviews/M10b-入口资产与真载体验收/plan/2026-09-24-M10b-入口资产与真载体验收-r5-claude.md` §4（r7、r8 未替换 r5 §4.1 / §4.2 / §4.4，核过 §0 清单）
> **日期**：2026-09-24（首次落笔）；2026-09-25 补 §1 agy、§2 codex、§5 嵌套枚举
> **证据**：`doc/05_testing/evidence/m10b-entry-probe-20260925/`（2026-09-25 各臂的原始输出，已脱敏，见 §6）

## 0. 抬头：版本

| 项 | 值 | 取法 |
| :--- | :--- | :--- |
| 本仓 HEAD | `de5fb76` | `git rev-parse HEAD` |
| Claude Code | 2.1.280 | `preflight` |
| Codex CLI | 0.156.1 | `preflight` |
| Antigravity（agy） | 1.2.9 | `preflight` |
| ZCode CLI | 0.16.9 | `preflight` |
| ZCode 桌面端 | 3.14.3 | `Info.plist` `CFBundleShortVersionString` |
| ZCode CLI 入口 | `/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，14 820 819 字节，mtime 2026-09-22 11:10:24，sha256 前 16 位 `b1df2ef3e5bd76c4` | `stat`、`shasum -a 256` |

> 入口文件的 mtime 晚于 EV-82 判失效的运行（2026-09-21 14:53Z），版本串未变。EV-82 诊断说明已据此加注「环境漂移不可排除」。

**2026-09-25 补测时**（§1、§2、§5 的读数只对这一行版本成立）：

| 项 | 值 | 取法 |
| :--- | :--- | :--- |
| 本仓 HEAD | `d40f155` | `git rev-parse --short HEAD` |
| Codex CLI | 0.156.1（原生二进制 `@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex`） | `codex --version` |
| Antigravity（agy），PATH 上的入口 | **1.2.10**（`~/.local/bin/agy`，本次真实调用走它） | `agy --version` |
| Antigravity，`~/.gemini/bin/agy` | 1.2.9 | `~/.gemini/bin/agy --version` |

> 本机有两个 agy 二进制，版本不同。上表 2026-09-24 的「1.2.9」与后者一致，前者已升到 1.2.10。
> §1 引的静态字面在两个二进制里都核过（各 1 处或同为 0 处），不受这个差异影响。

## 1. agy：skills 加载行为（§4.1）

> **口径偏离（用户 2026-09-25 两次拍板）**：r5 §4.1 要求隔离 `HOME`、哨兵放 `<fakehome>/.gemini/config/skills/`。
> 实测隔离 `HOME` 不可行（1.1），全程**不隔离 `HOME`**。先把哨兵放在 mkdtemp 项目的**工作区根** `<workspace>/.agents/skills/`（1.2，未命中），
> 用户随后选 (b)，改在**真实全局根** `~/.gemini/config/skills/` 补测三臂与嵌套（1.3）；再选 C，补测参数到达（1.4 的 g5）。
> 全局根的写入：只在目标路径事先不存在时写，每臂跑完立刻清理（逐字校验内容 → `unlink` 文件 → 非递归 `rmdir` 空目录），一次确认覆盖三臂。

### 1.1 隔离 `HOME` 不可行：登录态在登录钥匙串（**已测**）

| 试探 | 读数 |
| :--- | :--- |
| `HOME=<空 fakehome> agy models` | 退 1：`Error: Please sign in to view available models. Launch the CLI without arguments to sign in.` |
| 同上，另把 `~/.gemini/jetski-standalone-oauth-token` 拷进 `<fakehome>/.gemini/`（用户拍板；脚本 `fs.copyFile`，内容不读不打印，随 mkdtemp 目录删除） | 仍退 1，报错相同 ⇒ 该文件不是 CLI 的登录态 |
| `HOME=<空 fakehome> agy agents`（两次） | 退 0，空输出（fakehome 下无 agent 定义） |
| 二进制字面（两个二进制都有） | 链接 `zalando/go_keyring` 的 `keyring.macOSXKeychain.Get / Set / Delete` |
| `security list-keychains`：真实 `HOME` 对 `HOME=<空目录>` | 前者 `~/Library/Keychains/login.keychain-db` + `System.keychain`；后者只剩 `System.keychain`，`security default-keychain` 报 `A default keychain could not be found` |
| 不隔离时的 agy 日志（§1.2 的运行） | `keyringAuth: loaded token …` → `ChainedAuth: authenticated via keyring (effective: keyring)` |

**结论**：agy CLI 1.2.10 的登录态存在 macOS 登录钥匙串里，而钥匙串搜索列表随 `HOME` 走，**隔离 `HOME` 就丢了登录态**。**true**（行为 + 静态）。
与 M0 报告的 `agy.isolation = shared` 一致；r5 §4.1 的「隔离 `HOME`」手法在本机做不到。

顺带：九次脚本运行（共 11 次 agy 调用：零配额 4 次、真实 7 次）前后比对进程表，都**没有**留下新的 agy 常驻进程；1.2.10 的日志显示后端在进程内拉起（`Creating CLI server backend: … workspaceDirs=[<tmp>/proj]`）。
M0 的 P-17（`-p` 进程把工作交给跨运行复用的 hub）在本版本**没有复现**，只作观察，不作结论。

### 1.2 正对照（工作区根）：**未命中**

哨兵 `SKILL.md`（与 §2 同形，只换标签）：frontmatter `name: dualtest`、`description: … DESC-AGW-4H6`；正文 `BODY-AGW-4H6`，要求模型逐字照抄 `<<<AGW-4H6 ARGS=[$ARGUMENTS] A0=[$0] A1=[$1] AI0=[$ARGUMENTS[0]]>>>`、不做任何替换。
这样写，回显能区分「CLI 替换过」（见到 `甲 乙`）与「CLI 没替换」（见到字面 `$ARGUMENTS`）。

| 臂 | 命令与布局 | 读数 | 三态 |
| :--- | :--- | :--- | :--- |
| a1 | `agy -p '/dualtest 甲 乙' --output-format stream-json --print-timeout 180s`，cwd = `<tmp>/proj`（非 git），哨兵在 `<tmp>/proj/.agents/skills/dualtest/SKILL.md` | 退 0，186 s（stderr：`root agent idle; waiting up to 3m0s for 1 background task(s)` / `terminating 1 background task(s) on exit`）。输出里**没有哨兵**；模型把 `/dualtest` 当字面文本，执行 `grep -rn "dualtest" ~/.gemini` 找它的定义 | **false** |
| a1-git | 同上，只多一步：工作区先 `git init`（诊断变体，对应二进制里的 `FindGitRoot` / `workspace %q: unsupported vcs %q`） | 退 0，28 s，失败形态相同 | **false** |

两次的日志都一样：`Print mode: … sending message` → `Forwarding user message … (items=1, media=0)`，消息原样转发；
`Reloading system slash commands and skills` 与发送消息只差约 1.6 ms；
**没有**出现 `GetAllSkills: loaded %d skills`，也**没有**出现 `Failed to load skill commands during slash command resolution: %v`（两条格式串在二进制里都存在）。
生效模型：日志 `Propagating selected model override to backend: label="Gemini 3.8 Flash (High)"`。

**判读**：工作区根的哨兵在 print 模式下**没有被斜杠展开，也不在模型可见的 skill 清单里**：模型没去读 SKILL.md，而是 grep。
1.3 的全局根在同样的时序下（重载与发送相差约 18 ms）展开成功，所以竞态解释可能性低（未排除）；读数与「**print 模式不读工作区根**」一致（本机两种布局：非 git、git）。
这与二进制里的 `{workspace}/.agents/skills/{skill_name}/SKILL.md` 字面**冲突**，冲突原因未定位；那条路径也可能只对交互模式或 IDE 生效，未测。
信任门控的可能性较低：二进制里检索不到把 untrusted 与 skill 连在一起的字面。

### 1.3 全局根 `~/.gemini/config/skills/`（补测，**已测**）

哨兵标签 `AGG-2R8`，其它与 1.2 同形；cwd 仍是 mkdtemp 项目（非 git）。判读规则事先定死：哨兵要经**斜杠展开**进来才算「见到」；
如果只是模型自己用工具读文件读来的，记为「**被污染**」。依据是日志 `printmode.go` 的展开记录，以及 stream-json 里有没有工具步骤。

| 臂 | 布局与命令 | 日志 | 输出 | 三态 |
| :--- | :--- | :--- | :--- | :--- |
| g1 正对照 | `~/.gemini/config/skills/dualtest/SKILL.md`；`agy -p '/dualtest 甲 乙' --output-format stream-json --print-timeout 180s` | `Print mode: expanded slash command "dualtest" (skill)`；`Forwarding user message … (items=2, media=0)` | 11 s，**零工具步骤**，回复 `AGG-2R8 ARGS=[$ARGUMENTS] A0=[$0] A1=[$1] AI0=[$ARGUMENTS[0]]` | 经展开见到哨兵 **true** |
| g2 负对照 | 同 g1，加 `--disable-slash-commands` | `Print mode: slash command expansion disabled`；`items=1` | 回复里**有**哨兵，但前面有一步 `view_file ~/.gemini/config/skills/dualtest/SKILL.md`：模型自己按路径读了文件 | 展开被关 **true**；哨兵经工具进来，记「被污染」 |
| g3 第三臂 | 全局根无哨兵（开跑前断言） | `items=1`，无展开 | 无哨兵；模型跑了 `grep` / `ls`（放行），`find`（被拒），最终回复为空 | 不见哨兵 **true** |

读法：

- **全局根会被斜杠展开**，而且展开后消息是 `items=2`（工作区根那两次和 g2、g3 都是 `items=1`）。
- **全局 skill 同时在模型可见的清单里**：g2 里斜杠展开是关着的，模型却知道这份 SKILL.md 的确切路径，直接用 `view_file` 读了。也就是说，关掉斜杠展开**挡不住**模型自己加载 skill。这与 codex 的常驻 skill 列表同形。
- 斜杠名匹配不到时（1.2、g3、1.4 的嵌套臂），agy **不报错**，把原文当普通消息发给模型。

生效模型四次都是 Gemini 3.8 Flash (High)。

### 1.4 参数：CLI 不替换 `$ARGUMENTS`（**false**），但原文到达模型（**true**）

- **替换**：g1 的回复是字面 `$ARGUMENTS` / `$0` / `$1`，模型收到的正文没被替换过。与静态读数一致：两个 agy 二进制里 `$ARGUMENTS` 字面都是 **0 处**。**false**。
- **到达**（g5，用户选 C 后补测，第 12 次真实调用）：哨兵正文改为「逐字复述命令后收到的全部用户文本，前缀 `AGA-9V3 GOT=[`；没收到就回 `AGA-9V3 GOT=<none>`；不跑命令、不读文件」，
  发 `` /dualtest 甲 乙 "带引号" *星号* `反引号` ``。日志 `expanded slash command "dualtest" (skill)`、`items=2`；**零工具步骤**；
  回复 `` AGA-9V3 GOT=[甲 乙 "带引号" *星号* `反引号`] ``，与命令后文本**逐字一致**（双引号、星号、反引号都保留）。**true**。
  模型编不出这段原文，所以它只能是随展开一起送到的，推测就是 `items=2` 的第二项（这半句是推断）。

适用范围：单次、单模型（Gemini 3.8 Flash (High)）。「逐字」来自**模型转抄**，不是 CLI 替换，所以不能排除长文本、特殊字符更多时转抄出错。

### 1.5 对照 r5 §4.1 的判据与拍板 §18.1 #16

| 判据成分 | 读数 |
| :--- | :--- |
| 正对照见哨兵 | ✓（g1，经展开） |
| 参数逐字回显 | 按字面 ✗：`$ARGUMENTS` 不替换（1.4），与 codex 相同（§2.2）。改读为「参数原文到达模型」则 ✓（g5；codex 有 rollout 为证） |
| 负对照不见 | 展开层面 ✓（日志明示已关）；但哨兵经模型自己 `view_file` 进来（g2） |
| 第三臂不见 | ✓（g3） |

**用户 2026-09-25 的拍板路径**：字面判据在 codex 上同样不成立，区分不了「skills 优先」与「退路」；用户在 A（改读判据）、B（按字面走退路）、C（先补测参数到达，再按 A）三者中选 **C**，
约定「复述到了 ⇒ 按 A 拍板；没到 ⇒ 按 B」。g5 复述逐字一致 ⇒ **§18.1 #16 落 A：skills 优先**，判据中「参数逐字回显」一格改读为「参数原文到达模型」。
主设计 §18.1 #16 从「倾向」改为「已拍板」、写明判据改读及理由，属于第 5 步纪律 6 回溯的份额，本报告不改主设计。

**随拍板而来的代价（如实登记）**：非 Claude Driver（agy、codex）的入口 skill 不能再用 `$ARGUMENTS` 占位，要改写成「把命令后的全部文本原样当参数」。
FR-20 的「审查焦点逐字进送审包」在这两家上从「CLI 保证」降为「模型转抄」，需要作为 Driver 间的差异登记（落点由第 2 步计划定）。

### 1.6 副作用（如实登记）

不隔离 `HOME` 的七次真实运行里，有五次模型在真实 `HOME` 下**自己调用了只读工具**（g1、g5 零工具步骤；g2 的 `view_file` 见 1.3）：
a1-git 的 `grep -rn "dualtest" ~/.gemini` 跑完了，输出带出了用户其它 agy 会话的片段；g3 跑了 `grep` 与 `ls -la ~/.gemini/…`；嵌套臂跑了 `ls -la ~/.gemini/config/skills/…`。
`sqlite3 …/conversations/<id>.db`（a1-git）和 `find ~/.gemini …`（g3、嵌套臂）被自动拒绝：stderr `a tool required the "command" permission that headless mode cannot prompt for, so it was auto-denied`，结果里 `denied_actions: [{"action":"command"}]`。
全程没有写操作；全局根和 `~/.gemini/config/` 一层的前后快照里，唯一的差异是全局根目录自身的 mtime（我自己建、删哨兵目录造成的）。
入仓的 `stdout.jsonl` 里，这些工具输出一律换成 `<已省略…>`。

**这件事本身也是一条读数**：不带 `--agent trivium-critic` 时，agy 在 print 模式下按用户配置的 allow 规则（日志 `allow=29 deny=0 ask=0`）**放行一部分 shell 命令**，规则外的自动拒绝。
作审核者时有 agent 白名单挡着；**作 Driver 时，这一面由用户自己的 allow 规则决定**。

## 2. codex：`$ARGUMENTS` 展开（§4.2）

**手法**（r2 §2.2）：隔离目录由 `prepareCodexHome`（`dist/test` 构建，与编排器同一实现）准备，
`CODEX_HOME=<tmp>/run/codexhome`、`HOME=<tmp>/run/codexhome/fakehome`，profile `qwen`。
真实调用的 argv 与适配器 `buildCodexArgs` 同形：`codex exec -p qwen -s read-only [-c …] --json --skip-git-repo-check -C <tmp>/proj -`，prompt 走 stdin。
五次真实调用的生效模型都是 `qwen3.8-flash`（rollout `turn_context.model`），effort `medium`。哨兵 `SKILL.md` 与 §1.2 同形（标签 `CXH-7Q2`）。

### 2.1 读取面（零配额：`codex debug prompt-input`，6 次渲染，不计入预算）

| 渲染 | 布局 | Skill roots | 列表条目 |
| :--- | :--- | :--- | :--- |
| z1 `$dualtest 甲 乙` | `$CODEX_HOME/skills/dualtest` | r0 = `$CODEX_HOME/skills`，r1 = `…/skills/.system` | `dualtest … DESC-CXH-7Q2 (file: r0/dualtest/SKILL.md)` |
| z2 `/dualtest 甲 乙` | 同 z1 | 同 z1 | 同 z1 |
| z3 负对照 `-c 'skills.config=[{name="dualtest",enabled=false}]'` | 同 z1 | **只剩** `…/skills/.system` | 无 `dualtest` |
| z4 第三臂 | 不放哨兵 | 只有 `…/skills/.system` | 无 |
| z5 双根同名 | `$CODEX_HOME/skills/dualtest`（CXH-7Q2）+ `$HOME/.agents/skills/dualtest`（AGT-3K9） | r0 = `$CODEX_HOME/skills`，r1 = `<fakehome>/.agents/skills`，r2 = `.system` | **两条都列**：先 `DESC-AGT-3K9 (r1)`，后 `DESC-CXH-7Q2 (r0)` |
| z6 嵌套 | 见 §5 | r0、r1 | 见 §5 |

读法：

- 根的枚举顺序是 `$CODEX_HOME/skills` → `$HOME/.agents/skills` → `.system`；**只列至少有一个生效 skill 的根**（z3 禁用唯一的 skill 后，r0 也跟着消失）。
- 六次渲染里，用户消息后面**都没有** `<skill>` 注入块，而 c1 真实调用在同一布局下有注入（2.2）⇒ `prompt-input` 不做提及展开。r2 §2.2「`debug prompt-input` 只证常驻不证展开」得到印证。
- 负对照的机制：`SkillConfig` 有 3 个字段（二进制 `struct SkillConfig with 3 elements`，旁边是 `path` / `name`），按 `name` 禁用有效。

### 2.2 展开行为（真实调用）

| 臂 | 读数（rollout = `codexhome/sessions/**/rollout-*.jsonl`） | 三态 |
| :--- | :--- | :--- |
| c1 正对照 `$dualtest 甲 乙` | 第 6 行用户消息 `$dualtest 甲 乙`；**第 8 行是 CLI 注入的用户消息** `<skill><name>dualtest</name><path>…/skills/dualtest/SKILL.md</path>` 加 SKILL.md **原文**，其中 `$ARGUMENTS`、`$0`、`$1`、`$ARGUMENTS[0]` **全是字面**；模型回复 `CXH-7Q2 ARGS=[$ARGUMENTS] A0=[$0] A1=[$1] AI0=[$ARGUMENTS[0]]`；全程没有 shell 调用 | 见哨兵 **true**；显式提及即注入正文 **true**；**CLI 替换 `$ARGUMENTS`：false** |
| c2 负对照（同 z3 的 `-c`） | 列表无 `dualtest`，无注入，无哨兵。（模型把消息误读成 `$dual $low $beta $this $runs $by $design` 一串词，与判据无关，照录） | 不见哨兵 **true** |
| c3 第三臂 | 无注入，无哨兵；模型执行 `pwd && ls -la` 后反问需求 | 不见哨兵 **true** |

**按 r2 §2.1 的判据**：正对照见哨兵 ✓、负对照不见 ✓、第三臂不见 ✓，但**「参数逐字回显」不成立**：回显的是字面 `$ARGUMENTS`。
rollout 直接看得到模型收到的输入，所以这不是「模型没照做」，是 **CLI 没替换**。参数只以用户消息原文 `$dualtest 甲 乙` 的形式到达模型。

适用范围：`codex exec` + 提示词里的 `$名字` 提及。`/dualtest` 写法只做过零配额渲染（z2），真实调用**未测**（null）。
静态线索：二进制里另有一处 `$ARGUMENTS{{}}!`，紧挨着 `source-command-` / `No command template body was found.`，属于**命令模板**路径，不在 skill 注入路径上。那条路径替不替换，未测。

### 2.3 同名双根（c4 真实调用 + z5）

| 问题 | 读数 | 三态 |
| :--- | :--- | :--- |
| 同名去重 | 两份都进列表 | **false** |
| 告警 | stderr 为空，列表无诊断 | **false** |
| 显式提及 `$dualtest` 时加载哪份 | **两份都不注入**：rollout 里没有 `<skill>` 块。模型自己用 shell `cat` 读了两份，回复「Two different skills are installed under the same name `dualtest` … I'm not going to guess」，反问该用哪份 | 优先级：**无**；同名直接让显式调用**失效** |

与 P-21（zcode 重名不去重不告警）同形；codex 更糟一层，同名时显式调用本身就失效了。

### 2.4 M6 报告结论复核（按具名行号）

| M6 报告位置 | 原结论 | 本次 | 结论 |
| :--- | :--- | :--- | :--- |
| §1 第 63～76 行（臂 C） | `~/.agents/skills` 随 `HOME` 派生 | z5 / c4：隔离后 r1 = `<fakehome>/.agents/skills` | **成立** |
| §2 第 138～151 行 | 「参数展开：**支持**」（依据是第 143 行内嵌的 SKILL.md 撰写规范原文） | 0.156.1 二进制里那句原文还在；但行为上 skill 注入**不替换** | 在 `exec` + `$` 提及路径上**被推翻** |
| §2 第 158 行 | skills 是常驻承载面 | 六次渲染、五次真实调用的 developer 消息里都有 skill 列表（负对照、第三臂里只剩 `.system` 自带的几项） | **成立** |

P-22（`~/.agents/skills` 是 codex 与 zcode 共享的用户级根）：codex 一侧**成立**；zcode 一侧本次未测。

## 3. zcode

### 3.1 Hook 形态（§4.3.1）：静态核（**已测**）

扫描对象是上述入口文件，只读，用 python 按字面检索（本机 `grep` 为 ugrep，长上下文模式超出其复杂度限制）。
符号名是打包后的混淆名，只作定位用，**不作判据**；判据是字面量与结构。

| 问题 | 读数 | 三态 |
| :--- | :--- | :--- |
| 是否支持 Hook | `PreToolUse` 27 处、`hookEventName` 58 处、`permissionDecision` 11 处；事件枚举 `SessionStart / UserPromptSubmit / PreToolUse / PermissionRequest / PostToolUse / PostToolUseFailure / Stop`，每项带 `matcher` 字符串 | **true**（静态） |
| Hook 配置从哪里来 | ①插件目录下的 `hooks/hooks.json`（`listPluginHookSources` / `loadPluginHookSource`），与 Claude Code 插件、本仓 `skills/dual-critic/hooks/hooks.json` 同形；②分层设置的 `hooks` 键，层级 System / User / Project / Session / Env / Cli；Project 层文件疑为 `<项目>/.zcode/config.json`（`".zcode/config.json"` 3 处）；workspace 级 hooks 设置带审阅流程（`settingsSection:"hooks"`、`settingsScope:"workspace"`、`reviewFlowId`），疑需用户信任确认 | 来源 ① **true**（静态）；Project 层路径 **null**（待行为实测） |
| 读不读 `.claude/settings.json` | 字面 `.claude/settings` 零处、`settings.local.json` 零处 | **false**（静态）：ZCode 不会自动沿用本仓 `.claude/settings.json` 里的 Hook |
| 命令型 Hook 的 stdin 负载形态 | 兼容层（混淆名 `T0n`）把内部负载转成 Claude Code 蛇形字段：`hook_event_name`、`permission_mode`、`session_id`、`tool_name`、`tool_input`、`tool_use_id`、`transcript_path`（写到临时目录 `zcode-claude-hook-*` 下）；PostToolUse 另加 `tool_response` | **true**（静态）：`hooks.ts` 读的 `tool_input` / `tool_name` 能拿到 |
| 命令型 Hook 的环境变量 | `CLAUDE_CODE_SESSION_ID`、`CLAUDE_PROJECT_DIR`（取 `cwd` 或工作目录）、`CLAUDE_SESSION_ID`、`ZCODE_PROJECT_DIR`、`ZCODE_SESSION_ID`；插件型另加 `CLAUDE_PLUGIN_ROOT` / `ZCODE_PLUGIN_ROOT` 等 | **true**（静态）：本仓守卫脚本依赖的 `${CLAUDE_PROJECT_DIR}` 有值 |
| 拒写语义（`exit 2` 是否拒） | 静态：`exitCode===2` 走 `kQs`，PreToolUse 上转成 `permissionDecision: "deny"`，理由取 stderr。**行为见 3.1.1** | **true**（行为） |
| 超时语义（r5 §4.3.1 新增） | 静态：缺省 `hooks.timeoutMs = 60000`；非 0 / 非 2 退出与超时都进「`Hook process failed`（`recoverable: true`）」分支。**行为见 3.1.1** | **超时即放行**（行为） |

#### 3.1.1 行为实测（2026-09-25，ZCode 桌面端，用户操作）

**夹具**：scratchpad 下的 git 仓库，`.zcode/config.json` 配两条 PreToolUse Hook（`hooks.enabled: true`，配置形态是 `hooks.events.PreToolUse[] = {matcher?, hooks: [{type: "command", command, timeoutMs?}]}`，比 Claude Code 多一层 `events`）：
A 不带 matcher、`timeoutMs: 5000`，记录 stdin 负载与环境变量名，目标含 `DENYME` 就 `exit 2`，含 `SLOWME` 就挂起 20 秒；B 的 matcher 为 `Edit|Write`，只记录、一律放行。
会话由用户在桌面端打开夹具新建，生效模型 GLM-5.3（rollout `model.modelId`）。每一步的用户消息、工具调用结果、Hook 记录都能在证据里对上。

| 问题 | 读数 | 三态 |
| :--- | :--- | :--- |
| 项目级 `<项目>/.zcode/config.json` 的 Hook 会不会被加载 | 会：信任后每次工具调用都有 A 的记录（上表「Project 层路径」一格由 null 转为已测） | **true** |
| 工作区 Hook 要不要信任确认 | 要：打开夹具后弹出信任提示（用户口述；提示原文未留） | **true** |
| **信任确认之前**的写调用 | 用户在点信任**之前**发了「用 Write 新建 `a.txt`」：`a.txt` 在 10:12 写成（内容 `hello`），**没有任何 Hook 记录**；第一条 Hook 记录在 10:14，点信任之后 | **放行**：信任待定期间工作区 Hook 不跑、写工具照常执行 |
| `exit 2` 拒写：Write | `DENYME-write.txt`：A 记 `decision=exit2`，文件不存在；模型收到 `{"role":"tool","content":"probe-deny: blocked by M10b hook A","toolName":"Write","isError":true}`（stderr 原样作理由） | **true** |
| `exit 2` 拒写：Bash | `echo x > DENYME-bash.txt`：同上，`toolName: "Bash"`、`isError: true`，文件不存在 | **true** |
| 超时 | `SLOWME.txt`：A 于 10:25:43 开始挂起，日志里**没有**醒来那一行（到 5 秒被杀）；B 于 10:25:48 才执行；文件**写成**；模型收到 `File created successfully`、`isError: false`，**没有任何告警**；用户体感约 6 秒 | **超时即放行**，且对模型与用户都不可见 |
| 同一事件下多条 Hook 的执行顺序 | SLOWME 那次 B 在 A 超时后才跑 | **依次执行**（一次观察） |
| matcher `Edit\|Write` 的语义 | Write、Edit 调用时 A、B 都触发；Bash 调用时只有 A 触发 | **按「或」匹配工具名**（`Edit\|Write` 这种写法可用；是正则还是按 `\|` 拆分未区分） |
| stdin 负载 | 驼峰与蛇形两套字段并存：`tool_name` / `toolName`、`tool_input` / `toolInput`、`session_id` / `sessionId`、`hook_event_name`、`transcript_path`（系统临时目录 `zcode-claude-hook-*` 下）、`cwd`、`permission_mode`、`riskLevel`、`sideEffectScope` 等 20 个键 | **true**：`hooks.ts` 读的 `tool_name` / `tool_input` 都在 |
| 负载里的路径形态 | `cwd` 与 `CLAUDE_PROJECT_DIR` 是 `/tmp/…`，工具输入里的 `file_path` 是 `/private/tmp/…`，同一目录两种写法 | 观察：本仓写侧判定对词法路径与 realpath 取并集，能应付；若有按前缀比较 `CLAUDE_PROJECT_DIR` 的代码，要留意 |
| Hook 进程的环境变量 | `CLAUDE_CODE_SESSION_ID`、`CLAUDE_SESSION_ID`、`ZCODE_SESSION_ID`（三者同值）、`CLAUDE_PROJECT_DIR`、`ZCODE_PROJECT_DIR` 都有值 | **true**（行为，印证静态） |

证据：`evidence/m10b-entry-probe-20260925/zcode-desktop-session/`（`fixture/` 配置与脚本、`hook-log/` 每次触发的负载与环境变量名、`rollout-excerpt.json` 每轮用户消息与工具结果、`fixture-final-state.txt`）。

### 3.2 写类工具全集（§4.3.3）：来源 ①二进制字面（**已测**）；来源 ②会话实测（**已测**，见 3.2.1）

| 读数 | 出处（字面） |
| :--- | :--- |
| 工具注册表：`Read, Write, Edit, ApplyPatch, Bash, Glob, Grep, WebFetch, WebSearch, web_search, TodoRead, TodoWrite, GoalRead, ReadSessionContext, AskUserQuestion, SendMessage, RespondToCoordinator, TaskOutput, TaskStop, …` | 工具名数组 |
| 分类表：`Write` / `Edit` / `ApplyPatch` ⇒ `file-write`；`Bash` ⇒ `shell` | 工具分类映射 |
| `isWriteTool` = `Write, Edit, ApplyPatch, Bash`；`isDestructiveTool` = `Bash` | 能力判定函数 |
| **Hook matcher 别名**：`hookMatcherToolNamesForTool` 的映射含 `["ApplyPatch", ["Write","Edit"]]`，调用处以 `matchValues: RNe(t.name)` 传入。即 ApplyPatch 触发 Hook 时同时按 `ApplyPatch`、`Write`、`Edit` 三个名字匹配 matcher | 匹配值映射 |
| `MultiEdit` 字面**零处**；`NotebookEdit` 2 处但**不在**工具注册表内 | 全文检索 |

**对 r5 的影响**（只报告，不改计划）：

1. 本仓 `zcode-trace.ts` 的 `ZCODE_WRITE_TOOLS` 登记了 `MultiEdit` 与 `NotebookEdit`，按本入口它们不存在。那是 headless 轨迹用的只读 denylist，多登记不会漏拦，**不构成缺陷**；但 §4.3.3「全集」以来源 ① 为准时，写类工具是 **Write / Edit / ApplyPatch（file-write）+ Bash（shell）**。
2. matcher 别名意味着：沿用 `Edit|Write` 形态的 matcher，名字层面**可能已经覆盖** ApplyPatch。§6.1 条件 2(i) 仍以行为实测为准。
3. **ApplyPatch 的 `tool_input` 键形态未取到**：注册表里有名字，但静态检索没有定位到它的输入 schema。这正是 §6.1 条件 2(ii)「按目标判」要实测的一格：若它只带 patch 正文、不带 `extractTargetPath` 认得的路径键，写侧会对它**静默放行**。**null**，待来源 ② 实测。
   **2026-09-25 补**：来源 ② 里 ApplyPatch 不在模型可见清单上（3.2.1），这一格在 GLM-5.3 桌面会话里**无从实测**，仍为 null。

#### 3.2.1 来源 ②：桌面会话实测（2026-09-25，同 3.1.1 的会话）

**模型可见工具清单**（rollout `request.toolNames`，35 个）：`Agent, AskUserQuestion, Bash, CronCreate, CronDelete, CronList, CronUpdate, Edit, EnterPlanMode, ExitPlanMode, Read, Skill, TaskOutput, TaskStop, TodoRead, TodoWrite, WebFetch, WebSearch, Write, OffPeakCreate, OffPeakList, SendMessage, ReadSessionContext, CreateWorkflow, AmendWorkflow, SaveWorkflow, EvalWorkflowSnippet, ListWorkflowRuns, GetWorkflowRun, ResumeWorkflowRun, ResolveWorkflowQuestion, ListSavedWorkflows, ListModels, mcp__plugin_image-search_image_search__search_image, mcp__node_repl__js`。

| 工具 | 来源 ① | 来源 ② | 输入键（Hook 负载实录） | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| Write | 有 | 有 | `file_path`、`content` | 新建与整体覆写都走它 |
| Edit | 有 | 有 | `file_path`、`old_string`、`new_string`、`replace_all` | |
| Bash | 有 | 有 | `command`、`description` | 按命令文本判（D3 同形） |
| ApplyPatch | 有 | **无** | —— | 要求「只用 ApplyPatch」时模型回答工具列表里没有它。为什么不暴露（按模型、按设置还是按宿主），未查 |
| `mcp__node_repl__js` | —— | **有** | 未触发 | **来源 ① 看不到的写路径**：来自本机 MCP 配置的 JS REPL，能直接写文件；本仓 Hook 的 matcher（`Edit\|Write\|NotebookEdit` 与 `Bash`）**不覆盖**它 |
| `Agent` | —— | 有 | 未触发 | 子代理里的工具调用会不会过工作区 Hook，未测 |

**两源差异的解释**：来源 ① 是 CLI 注册表的全集，来源 ② 是某个模型、某台机器在某次会话里实际暴露的子集加上外挂工具（MCP、插件）。
所以「全集 = 两源交叉后的观察集，**完备性不保证**」（r5 §4.3.3 的措辞）在这里被坐实：两个来源**互不包含**。

**glm Driver 角色工件的新建与修改**（不指定工具，看模型自己选）：新建 `.reviews-demo/2026-09-25-demo-glm.md` 用 **Write**，改第一行用 **Edit**，两次 A、B 都触发、`file_path` 都在。
对照 r5 §4.3.3 结局表：本仓自己的角色工件走的是结构化写工具，**不必经 shell**，D3 的 Bash 侧字面拦截不会挡住 glm 写自己的原稿。

**对照 r5 §4.3.3 结局表**（只报告，不判第 3 步能否通过）：

- Write / Edit：名字在现有 matcher 里、目标能取出 ⇒ 这一部分满足「全集进 matcher、目标都能取出」。
- `mcp__node_repl__js`：落在「**有结构化写工具，但名字不在 matcher 里**」一行 ⇒ 这一面名为 L1、实为 L2。它来自用户本机的 MCP 配置，不是 ZCode 自带；是否纳入、用 matcher 还是用文档约束，由 §6.1 定。
- ApplyPatch：本会话里不存在；其它模型或设置下若出现，按 3.2 第 2 条的别名，`Edit|Write` 在名字层面可能覆盖，输入键仍未知。

### 3.3 真载体（P-a）：**true**

- **做法**：用户在 ZCode 桌面端打开工作区 `/Users/chenzhenbo/Work/TriviumCode`，新建会话，要求它用终端工具执行
  `.trivium/bin/trivium preflight --stage plan --json; echo "EXIT=$?"` 并原样贴出输出。
- **原始输出**（用户贴回，2026-09-24）：`"ok": true`、`"scope": "plan"`，11 项检查全部 `ok: true`，末行 `EXIT=0`，JSON 内 `"exit_code": 0`。
- **边界**：三家「已认证」一格都走了缓存（「0.61h 前探活通过」），本次没有真实探活。P-a 只验「一条只读 CLI 调用能在 ZCode 会话里跑通」（r5 §3.2），走缓存不影响结论。
- **留痕佐证**：见 3.4，调用本体、时间与退出码都能在 ZCode 本地留痕里对上，不只凭用户转贴。

**P-a 成立。** r5 §3.2：第 2 步的开工前提满足。

### 3.4 会话留痕与会话标识（§4.3.2）

| 问题 | 读数 | 三态 |
| :--- | :--- | :--- |
| 1 交互会话把工具调用记在哪里、记不记命令原文 | **与 headless 同一处**：`~/.zcode/cli/rollout/model-io-sess_<会话 ID>.jsonl`。本次会话 `sess_13624e01-2592-42f6-9a85-f19c23a69637`，3 行、每行一次模型请求，字段 `startedAt / completedAt / durationMs / requestId / model / request / response / sessionId / querySource / traceId / turnId`。第 0 行响应里有工具调用 `Bash`，输入 `{"command": ".trivium/bin/trivium preflight --stage plan --json; echo \"EXIT=$?\"", "description": "在项目根目录执行 trivium preflight 阶段检查"}`；第 1 行请求里带回的工具结果含 `EXIT=0`。时间 03:34:52Z～03:35:06Z | **true** |
| 1′（**超出预期**）留痕记不记 Driver 实际用的模型 | **记**：每行 `model` 为 `GLM-5.3` | **true**。r5 §4.3.2 末段写「会话留痕证明不了该会话的模型就是 GLM」，对 ZCode 这一家**不再成立**：rollout 逐请求记模型。这是 EV-107 根本解（采集 Driver 生效模型）在 zcode 侧的一个现成数据源，只登记、不在本里程碑展开 |
| 2 会不会向 shell 工具注入会话标识环境变量 | **2026-09-25 实测**（3.1.1 同一会话）：让会话用终端工具执行 `pwd`（夹具目录）、`ps -o pid=,comm= -p $PPID`（`zcode-cli`）、`env \| cut -d= -f1 \| sort`、`env \| grep -E '^(ZCODE\|CLAUDE)[A-Z_]*(SESSION\|PROJECT)[A-Z_]*='`。shell 环境里有 `ZCODE_APP_VERSION`、`ZCODE_RUNTIME_ENV`、`ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 等十几个 `ZCODE_*` / `ZAI_*` 变量，但 grep **无匹配**（`EXIT=1`）：没有任何会话 ID 或项目目录变量。对照：同一会话里 Hook 进程的环境**有** `ZCODE_SESSION_ID` 等（3.1.1） | **false**：会话 ID 只进 Hook 环境，不进 shell 工具环境。渲染 glm 入口资产时不能指望在 shell 里读到它经 `--session-id` 传下去 |
| 3 留痕里有没有凭据字段 | **2026-09-25 补核**：09-24 那份会话文件已被 ZCode 自己清掉（见下行 3′），改核目录里现存的 3 份（都是 `x-title: Z Code@cli` 的 headless 会话，不是桌面端）。只列键名、不读值：`request.headers` 16 个头键里**没有**鉴权类（authorization / api-key / token / cookie）；对全文做凭据形态扫描（bearer、`sk-`、JWT、`<32hex>.<16>` 形态、`api_key=`），3 份都是 **0 命中** | **false**（留痕里没有凭据字段）。适用范围：这 3 份 headless 会话；桌面端会话的留痕与它们同一写入函数（`JWr`），推定同形，没有单独核 |
| 3′（**超出预期**）留痕保留多久 | 入口文件字面：新建会话文件前调 `XFs(目录, VFs-1)`，按修改时间删掉最旧的 `model-io-*.jsonl`，`VFs = 3`，所以目录里**最多留 3 份**；单文件超过 `HFs = 64 MiB`（debug 模式 `GFs = 256 MiB`）就整份重写，原有记录丢失；非 debug 模式剥掉 `request.body` 里的 `messages` 副本与 `response.body`，顶层按 `messageOffset` 增量记录的 `request.messages` 保留。实测对上：09-24 03:34Z 的桌面会话文件已不在，现存 3 份的时间都晚于它；其中 00:27:45Z 那份与 codex 探活（`checked_at` 00:27:50Z）相差 5 秒，推测是 `preflight` 的认证探活，来源未核 | **true**：rollout 是「最近 3 个会话」的滚动窗口，与任何其它 zcode CLI 调用（含本仓自己的探活）共用 |

**对 J4 的意义**：J4 的载体证据可以落在这份 rollout 上：同一 run_id 的 `review --start` 工具调用 + 每条请求的 `model`。r5 §10.3 R-o（载体证据拿不到）的风险**基本解除**，剩「会话标识是否进 shell 环境」一格。
**2026-09-25 补一条前提**（3′）：rollout 只留最近 3 个会话，J4 会话之后再有 3 次任意 zcode 调用（包括 `preflight` 探活、审查运行的无副本支）就会把它挤掉。所以 J4 的剧本要写明「**会话结束当场把 rollout 拷进 evidence**」，不能事后再去取。

证据：`evidence/m10b-entry-probe-20260925/zcode-rollout/`（`rollout-shape.txt` 只含文件清单、键名、非凭据的会话类型头、常量与相关函数字面；生成脚本同目录）。
2026-09-25 桌面会话实测时，新会话一建，当时最旧的那份（09-24 17:50Z）就被删掉，目录仍是 3 份，保留策略在行为上也对上了。本次会话的 rollout 是在用户做完操作后立刻拷走的，摘录见 3.1.1 的证据目录。

### 3.5 `hooks_deny_ok` 落哪一格（r5 §4.3.4 要求本报告显式回答）

**true，但有三个前提**，缺一个就是静默放行：

| 前提 | 不满足时 | 依据 |
| :--- | :--- | :--- |
| ① 工作区 Hook 已经过用户信任确认 | 信任前写工具照常执行、Hook 不跑 | 3.1.1「信任确认之前」 |
| ② Hook 在超时内返回 | 超时即放行，对模型与用户都不可见 | 3.1.1「超时」；缺省超时 60 秒，本仓 Hook 是毫秒级脚本，正常情况下不会碰到 |
| ③ 写入走的是 matcher 覆盖到的工具 | `mcp__node_repl__js` 这类外挂工具不过 matcher | 3.2.1 |

适用范围：ZCode 0.16.9 桌面端、GLM-5.3、项目级 `.zcode/config.json`、单次会话。headless（`zcode` CLI）下工作区 Hook 的信任怎么处理（静态里有 `workspace_hooks_require_trust_capable_host` 一类状态），未测。

**取值路径 (a) / (b) 仍由用户二选一**（r5 §4.3.4）：本次实测是人工在桌面端完成的，自动化探针要在 headless 下复现「信任 + 触发写工具」，前提 ① 在 headless 下能否满足本身未知。
所以 (a) 探针臂自动实测的工程量**至少**包含先测清 headless 的信任行为；(b) 人工填写 + 防漂校验的依据就是本节。

**对 §4.3.3 的顺带读数**：交互会话的 shell 工具名是 `Bash`（与 headless 注册表同名），输入键是 `command`（不是路径键），D3 的 Bash 侧判据按 `command` 文本判，与 Claude Code 同形。

## 4. claude

基线，无需实测（§4.5）。

### 4.1 顺带：两侧解析回退的形态（r5 §4.5 → r2 §2.7，只诊断、不修复）

**做法**：只读扫描本仓 `.reviews/` 全部 168 份 run.json 的 `critics.<侧>.status` 与 `fail_reason`；
再把所有回退侧的原文（`review-<侧>-<run>.json` 的 `raw`）用**当前**解析器（`dist/test` 构建的 `parseReview`）重跑一遍，并按 `review.v1.json` 抽出越界枚举值与多余根键。
脚本与输出在 `evidence/m10b-entry-probe-20260925/parse-fallback/`。

回退率：

| 侧 | 回退 / 总数 | 生效模型 | 当前解析器重跑能过 |
| :--- | :--- | :--- | :--- |
| codex | **22 / 107**（另 timeout 5） | qwen3.8-flash 14、deepseek-flash 8 | 0 / 22 |
| glm | **14 / 145**（另 timeout 3） | GLM-5.3 14 | 0 / 14 |
| gemini | 4 / 150（另 failed 4） | gemini-3.8-flash-high 4 | **2 / 4**（早期两份，后来的解析器已修好） |

形态（按 `fail_reason` 归类；一份可以同时占几类）：

| 形态 | codex | glm | gemini | 已有条目 |
| :--- | :--- | :--- | :--- | :--- |
| 每条意见都缺 `confidence` | **9** | — | — | 无 |
| 枚举越界 | **9**：`layer` 取 spec / test / process / doc；`kind` 取 requirement / risk / completeness / fact / plan | **6**：`severity` 取 medium（6 处）/ info；`kind` 取 completeness（9 处）等；`layer` 取 docs（4 处）/ design / schema 等 | — | EV-11 |
| 缺 `confidence` 之外的必填字段 | — | 2 | 1 | 无 |
| 根对象多余键：把送审包抬头抄进结论 | — | **6 份**：`stage` 6、`topic` 5、`role` 5、`run_id` 2、`rerun_index` 2 等 | 1 | EV-10 |
| JSON 语法错（非法转义为主） | 4（deepseek 3 份是非法转义） | 1 | 2 | 无 |
| 找不到 JSON 对象 | — | 2 | — | EV-113（`ExitPlanMode` 收尾） |

r2 §2.7 的起因「glm 连续三轮回退」能在 M10 计划的三次运行里对上（`20260921T145353Z`、`…152520Z`、`20260922T004543Z`），三次的形态都是枚举越界，不是 JSON 写坏了。

**可修复性评估**（给「是否里程碑内修复」的数据依据，**修复不在 M10b 范围内**）：

1. **codex 最大的一块有现成的修法**：`codex exec --help` 有 `--output-schema <FILE>`，但本仓 codex 适配器**没接**（`buildCodexArgs` 里没有），而 agy（`--json-schema`）和 claude 都接了；三家里 gemini 的回退率最低，与此一致。
   codex 22 份里有 18 份是 schema 层面的问题（缺 `confidence`、枚举越界），**如果** `--output-schema` 对 qwen / deepseek 这类非 OpenAI provider 也生效，这一块可以整体消掉。它对这些 provider 生不生效，**未测**。**BACKLOG 里没有这一条**，建议新立。
2. **glm 的两大块都已有条目**（EV-10 剥抬头键、EV-11 枚举不够用），而且是同一种形态反复出现。剥抬头键属于低风险的宽松化；枚举越界要么扩枚举、要么做同义映射，后者会改变 `severity` 的阻断语义（例如把 medium 映射成 major 还是 minor），不能由解析器自己决定。
3. **JSON 语法错**（7 份）和**找不到 JSON**（2 份）不属于「解析器太严」，修法在提示词或载体一侧（EV-113），宽松解析救不回来。
4. 按现在的回退率，M10b 余下的双审和四轮验收里，codex 侧大约每 5 次运行回退 1 次，glm 大约每 10 次 1 次。回退只会让该侧意见按 `<前缀>-F<n>` 兜底裁决、`joint_check` 降级，不会让流程卡死。从数据看，**不修也能走完 M10b**；codex 的 `--output-schema` 性价比最高，适合作为独立小主题排在 M10b 之外。

## 5. 嵌套枚举一臂（§4.4）

**手法**（r2 §2.4）：照 `syncDir` 整目录递归搬运后的真实形态布置：`<根>/dual-critic/SKILL.md`（哨兵 TOP-5M1）
加 `<根>/dual-critic/entry/x/dual-zzz/SKILL.md`（哨兵 NEST-8P4），发 `dual-zzz 甲 乙`。

| 家 | 根 | 读数 | 三态 |
| :--- | :--- | :--- | :--- |
| codex | `$CODEX_HOME/skills` | 零配额 z6：列表里有 `dual-critic (file: r0/dual-critic/SKILL.md)`，**也有** `dual-zzz (file: r0/dual-critic/entry/x/dual-zzz/SKILL.md)`。真实调用 c5 `$dual-zzz 甲 乙`：rollout 注入 `<skill><name>dual-zzz</name><path>…/dual-critic/entry/x/dual-zzz/SKILL.md</path>` 与原文，模型回复 `<<<NEST-8P4 ARGS=[$ARGUMENTS] …>>>` | **true**：递归枚举，且能被显式调用加载 |
| agy | `~/.gemini/config/skills`（全局根，用户追加授权第 11 次调用） | g4 `agy -p '/dual-zzz 甲 乙' …`：日志**没有**展开记录，`items=1`；模型先 `view_file …/dual-critic/SKILL.md`，再逐层 `ls` 进 `dual-critic/`、`entry/`，`find` 被拒，最终回复为空；两个哨兵都没出现 | **false**：`dual-zzz` 没有注册成斜杠命令；模型知道 `dual-critic` 的路径，却要自己翻目录找 `dual-zzz`，说明后者也不在模型可见清单里（这半句是从行为推断） |
| zcode | — | 不在本次指令范围 | 未测 |

**按 r2 §2.4 的「结论用途」**：codex 会递归枚举 ⇒ 第 2 步要换落点或改扁平命名（r2 §3.1.1 备选）；agy 全局根不递归。
把 `dual-critic` 连同 `entry/<agent>/` 一起装进 codex 的任何 skill 根，都会让其它 Driver 的入口资产出现在 codex 的列表里，还能被 `$名字` 调起。

## 6. 2026-09-25 补测的调用台账与证据

真实调用 12 次。授权上限原为 10 次；第 11 次（agy 嵌套臂）是用户在补测前追加授权的，条件是「正对照通过才跑」；第 12 次（agy 参数到达）是用户选 C 时授权的。

| # | 臂 | 起止（UTC） | 退出码 |
| :--- | :--- | :--- | :--- |
| 1 | codex c1 正对照 | 01:00:20～01:00:29 | 0 |
| 2 | codex c2 负对照 | 01:00:57～01:01:10 | 0 |
| 3 | codex c3 第三臂 | 01:01:10～01:01:31 | 0 |
| 4 | codex c4 同名双根 | 01:01:31～01:01:55 | 0 |
| 5 | codex c5 嵌套 | 01:03:25～01:03:33 | 0 |
| 6 | agy a1 正对照（工作区根，非 git） | 01:18:33～01:21:39 | 0 |
| 7 | agy a1-git 正对照（工作区根，git） | 01:23:43～01:24:11 | 0 |
| 8 | agy g1 正对照（全局根） | 01:36:19～01:36:30 | 0 |
| 9 | agy g2 负对照（全局根） | 01:36:51～01:37:04 | 0 |
| 10 | agy g3 第三臂（全局根无哨兵） | 01:37:07～01:37:35 | 0 |
| 11 | agy g4 嵌套（全局根） | 01:37:37～01:38:20 | 0 |
| 12 | agy g5 参数到达（全局根） | 01:49:05～01:49:31 | 0 |

**不耗模型配额的调用**（不计入上限）：`codex debug prompt-input` 6 次；`agy models` / `agy agents` 各 2 次（空 fakehome 一轮、拷入 token 文件一轮）；`security list-keychains` / `default-keychain` 只读核对。

**隔离与清理**：每臂一个 `fs.mkdtemp(os.tmpdir()/m10b-probe-*)` 目录，脚本末尾断言目标在 `os.tmpdir()` 下且前缀是 `m10b-probe-` 后，只删这个返回值；实验脚本里不引用项目的清理助手。
codex 的凭据副本（`auth.json`、裁剪后的 `config.toml`）由 `prepareCodexHome` 写进 mkdtemp 目录，随目录删除。agy 的 token 文件副本同样随目录删除。
agy 全局根的哨兵（g1、g2、g4）不在 mkdtemp 目录里，按用户认可的另一套流程清理：写入前断言目标不存在，跑完逐字校验内容一致后 `unlink`，再由深到浅非递归 `rmdir`。
g5 同样如此。四次写入的清理记录都是全部 `unlink` / `rmdir` 成功（见各臂 `meta.json` 的 `cleanup`），事后 `ls` 全局根，没有 `dual*` / `*test*` 残留。
凭据文件一律没有打印：`~/.codex/config.toml` 只看过段头，以及 `model` / `model_provider` 两个非凭据键；agy 的 `trustedFolders.json` 只统计了条目数与取值集合。

**证据目录** `doc/05_testing/evidence/m10b-entry-probe-20260925/`：

| 子目录 | 内容 |
| :--- | :--- |
| `codex-zero/` | z1～z6 的 `prompt-input` 渲染与 stderr、`summary.json`（argv 与退出码） |
| `codex-real/<臂>/` | `stdout.jsonl`（`--json` 事件流）、`stderr.txt`、`session-0.jsonl`（rollout，模型实际收到的输入）、`meta.json`（argv、时间、`prepareCodexHome` 剥掉的键名与拷入的文件名） |
| `agy-zero/` | 隔离 `HOME` 两轮试探的输出与 fakehome 目录树 |
| `agy-real/<臂>/` | 工作区根两次：`stdout.jsonl`（stream-json）、`stderr.txt`、`agy-log-excerpt.txt`（本次新日志里与 skill / slash / workspace 相关的行）、`meta.json` |
| `agy-global/<臂>/` | 全局根五次（g1～g5）：同上四件；`meta.json` 另含判读字段（哨兵出现在回复还是工具输出、工具步骤清单）、清理记录，以及 `~/.gemini/config` 与全局根一层的前后快照差异 |

脱敏：临时目录前缀 → `<tmp>`，用户主目录 → `~`，邮箱 → `<email>`；`meta.json` 里 `prepareCodexHome` 剥掉的 `[projects."…"]` 信任表段名折叠成计数；
agy 模型在真实 `HOME` 下执行命令的输出替换成 `<已省略…>`（§1.6）。入仓前做过凭据形态扫描（bearer / `sk-` / `ya29.` / JWT / `*_token` 键值），**0 命中**。

## 7. 对 r5 的影响（只报告，不改计划）

1. **codex 入口资产不能靠 `$ARGUMENTS`**（§2.2）：在 `exec` + `$名字` 路径上，参数只以用户消息原文到达模型。第 2 步单源渲染的 codex 产物，正文要写成「从用户消息里 skill 提及之后的文本取参数」，或者改走命令模板路径（未测）。选哪条由第 2 步计划定。
2. **嵌套落点要换**（§5）：r2 §3.1.1 的 `skills/dual-critic/entry/<agent>/` 在 codex 下会被递归枚举并可调用。
3. **查重名要覆盖 codex 的两根**（§2.3）：同名时 codex 显式调用直接失效、无告警。r2 §3.2.2 已把 `~/.agents/skills` 钉为禁装目标；但 codex 仍会从这里读，所以安装器查重名时有没有把宿主机 `~/.agents/skills` 里已有的同名项算进去，第 2 步计划要核（本报告未核 r2 §3.2.2 查重名一段的原文范围）。
4. **§18.1 #16 已按用户选择的 C 路径落 A：skills 优先**（§1.5）。第 2 步要为 gemini 渲染入口 skill，落全局根 `~/.gemini/config/skills/`；agy、codex 两家的入口 skill 不用 `$ARGUMENTS` 占位，改为「把命令后的全部文本原样当参数」；FR-20「焦点逐字」在这两家上降为模型转抄，差异要登记。主设计 §18.1 #16 的状态改写归第 5 步回溯。
5. **agy 入口资产只能落全局根**（§1.2、§1.3）：print 模式不读工作区根 `<workspace>/.agents/skills`（本机两种布局）。安装目标本来就是全局根，不受影响；但「项目级装 agy 入口」这条路不可用。
6. **`--disable-slash-commands` 挡不住模型自己加载 skill**（§1.3 g2）：它只关斜杠展开，不从常驻清单里去掉 skill。
7. **agy 隔离 `HOME` 不可行**（§1.1）；agy 作 Driver 时，print 模式下的 shell 能力由用户自己的 allow 规则决定（§1.6）。后者是否要在第 3 步 Hook 多目标或 L1 / L2 定级里体现，由计划决定。
8. **zcode 的 Hook 能拒写，但 L1 有三个前提**（§3.5）：工作区信任、不超时、写工具在 matcher 覆盖内。其中「信任前放行」「超时放行」都是静默的；第 3 步的 L1 / L2 定级与文档要把这三条写进边界。`hooks_deny_ok` 的取值路径 (a) / (b) 待用户在进入第 3 步前拍板。
9. **ZCode 的 Hook 配置不能照抄 Claude Code 的形态**（§3.1.1）：要写 `hooks.enabled: true`，事件放在 `hooks.events` 下，文件是 `<项目>/.zcode/config.json`（或 `zcode.json`）。第 3 步 `hooks --agent` 渲染 zcode 目标时按这个形态。
10. **会话 ID 不进 shell 工具环境**（§3.4 问题 2）：r5 §4.3.2 设想的「经 `--session-id` 传进 `topic claim` / `review --start` / `approve`」在 zcode 上拿不到值，只能由 Hook 侧取，或者不传。
11. **J4 的载体证据要当场拷走**（§3.4 行 3′）：rollout 只留最近 3 个会话。
12. **写类工具两源互不包含**（§3.2.1）：`mcp__node_repl__js` 这类外挂写工具在 L1 下是漏口；ApplyPatch 在 GLM-5.3 桌面会话里不暴露，输入键仍未知。

**第 1 步仍未测的 zcode 格**：加载面（两根各放哨兵、真实调用一次，r5 §4.3.1）；ApplyPatch 的输入键；`Agent` 子代理里的工具调用过不过工作区 Hook；headless 下工作区 Hook 的信任行为。
