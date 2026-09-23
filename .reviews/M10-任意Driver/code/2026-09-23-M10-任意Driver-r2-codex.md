---
schema: trivium.review.v1
topic: M10-任意Driver
stage: code
role: codex
vendor: openai
agent_cli: codex/0.155.1
model_requested: deepseek-flash
model_effective: deepseek-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260923T030441Z
rerun_index: 2
snapshot_hash: sha256:73b915eedcef9511b0c85c92dda2ce547159ab83b5dd8333a55e291624ff6fb0
blind: true
started_at: 2026-09-23T03:04:43.109Z
finished_at: 2026-09-23T03:24:51.990Z
duration_s: 547
tool_calls:
  run_command: 99
  project_reads: 63
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 1
  major: 2
  minor: 4
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0cc39-023f-7293-a902-8cded1cea3df
---

# 代码审查：M10-任意Driver

> Critic-C · OpenAI Codex ｜ 模型 `deepseek-flash`
> ｜ 运行 `20260923T030441Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

三处必须先落。① Bash 侧写守卫有可达的绕过面：`git -c <k>=<v> …` / `git -C <目录> …` 这类「带独立取值的全局选项」使 looksLikeWriteCommand 恒 false，hookPreBash 的两条规则（独占对象保护、闸门写锁）双双放行——而同一个文件里已有 `GIT_OPTS_WITH_VALUE` 知道这些选项要多吃一个词；本 diff 新增的 CLAUDE.md / protocol snippet / 两处报错文案恰好把这类命令断言成「必然被拦、Bash 工具做不到」。② 新增的 §3.2.2 扫描判据在真实仓库上待判定集为空（实测六处命中全在域外），把两处终端提示整段删掉它照样绿——本步的机械保证目前是空转。③ hooks.ts 提交锚的第一支仍是跨时间后缀判据（全集减 claude），非缺省 Driver 自己的原稿与裁决件仍被判「改动即伪造」，plan §3.1.4/§3.1.5 的表与出口对那一族不成立，且未按 §7.4 登记偏差。另有四条次要：gate 文案的「唯一出口」、扫描报错行号、预检标注缺席、纯词法域判据对软链路径的敏感。已核成立的部分见 agreed。

**结论**：`request-changes`

## 审查意见（共 8 条：阻断 1 ｜ 重要 2 ｜ 次要 4 ｜ 吹毛求疵 1）

### CODEX-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:686（WRITE_LIKE 的 git 分支）＋ 本 diff 新增文案 hooks.ts:931-933 / 1303-1305、CLAUDE.md:37-43、skills/dual-critic/protocol/CLAUDE.md.snippet:35-39` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：WRITE_LIKE 的 git 分支写作 `\bgit\s+(?:-[^\s]+\s+)*\b(?:checkout|restore|switch|stash|reset|…)\b`——选项前缀只吃「自带取值」的形态（`--git-dir=x`），吃不下「选项与取值分两个 token」的形态。于是 `git -c core.quotePath=false restore …`、`git -C <目录> restore …`、`git --git-dir x restore …` 全部判为「不像写命令」，而 `hookPreBash` 的第一道门就是 `if (!writeLike) return ALLOW`（860-884 的保护判定与后面的闸门写锁都在它之后），两条规则一起失效。后果是 `.reviews/**/_meta/**`（含 gate --check 唯一事实来源 review-*.json）与角色后缀审查文档可以被 Bash 侧 `restore/checkout/clean/reset` 改写或删除——Write/Edit 侧对 `_meta/` 的独占保护（hooks.ts:636-644）是有的，Bash 侧正是唯一缺口。**这恰好击穿本 diff 新增文案的核心事实主张**：CLAUDE.md 与 protocol snippet（后者由 init.ts 装进下游项目）写着「恢复命令一提到受保护路径就会被同一条判据再拦一次……Bash 工具做不到，不要在会话里反复重试」，而实测那条命令只要挂上 AGENTS.md 纪律 4 要求的 `-c core.quotePath=false` 前缀就能在会话内跑通。CLAUDE.md 自己两段之前刚写过「对 Bash 只按写命令形态做启发式拦截……不是完备的」，同一文件内两处自相矛盾。

**依据**：只读实测（未落盘、未改文件）：用 `dist/test/src/trivium/hooks.js` 构造最小 ctx 后调 `hookPreBash`——`git restore -- .reviews/T/plan/_meta/run-1.json` ⇒ BLOCK（writeLike=true）、`git -c core.quotePath=false restore -- .reviews/T/plan/_meta/run-1.json` ⇒ **ALLOW（writeLike=false）**、`git -c core.quotePath=false checkout -- .reviews/t/plan/a-gemini.md` ⇒ **ALLOW**、而同样命令去掉 `-c` ⇒ BLOCK；`git -C /proj restore -- .reviews/T/plan/_meta/run-1.json` ⇒ ALLOW。对照同文件 hooks.ts:975-978 已有 `GIT_OPTS_WITH_VALUE = {'-C','-c','--git-dir','--work-tree','--namespace','--exec-path','--config-env'}` 与注释「`--git-dir x` 要多吃一个词」——同一份知识已在文件里，但只用在 `commitTargetsProject` 上。另：既有负例 `test/unit/hooks.test.ts:475`（`git -c core.editor="rm .reviews/t/plan/a-gemini.md" commit`）之所以被拦，是因为值里那个 `rm` 字面命中了 `\b(?:rm|mv|cp|…)\b` 分支，`git 子命令` 分支本身的问题被它掩盖，形成假保证。

**建议**：两条路择一，都要落到留痕：①把 git 子命令分支的介入条件对齐同文件已有的取值型选项知识（`-c/-C/--git-dir/--work-tree/…` 后面不只吃一个 token），并补一条「`git -c core.quotePath=false checkout/restore <受保护路径>` 必须被拦」的负例（现有那条靠值里的 `rm` 蒙过，不能算覆盖）；②如果决定维持「启发式不追求完备」（CLAUDE.md:29-30 的现有口径），就把本 diff 新增的那段改成与该口径同源——说明常规写法会被拦、判定本身是启发式且不完备、绕过判定属违规而非出口——别用「必然结果／做不到」这种确定性措辞，因为它同时会写进下游项目的 CLAUDE 段。

### CODEX-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/contract/bash-recovery-wording.test.ts:25,55-80（WINDOW 与扫描主循环）` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：这条「取代人工数处数」的机械判据在真实仓库上待判定集为空，因此今天恒真、且抓不到它存在的理由所要防的形态——§3.2.2 的四处理论上是它的论域，实际一条都不在域内：全部命中点最近的一个保护字面量也在 705 字符之外，被 `WINDOW = 400` 的窗口全部 `continue` 掉。两条「防空转腿」只证明 stripComments 不是 no-op、以及整文件窗口比逐行强，没有一条断言真实待判定集非空，所以「论域被窗口清空」这种失效不会被这个文件自己发现。计划 §3.2.2 与 §8 把它当作第 2 步的收尾判据之一——照现状，那个保证不存在。

**依据**：① 只读复刻该测试算法（读 src/trivium 下全部 .ts，逐字用它自己的 4 个常量）跑当前工作树：待判定集 `[]`；六处 `git (checkout|restore)` 命中分别落在 hooks.ts:931/948/1302 与 guard.ts:759，其窗口内均无保护字面。② 在内存里把 hooks.ts 本步新增的两处「终端」提示整段删除后再跑同一算法：`WINDOW=400` 仍得 `[]`（**同一变异下该用例仍绿**），`WINDOW=1500` 才出现 3 条 `term=false` 命中——证明是窗口宽度而非文案合规把断言值清空的。③ 实测该用例：`node --test dist/test/test/contract/bash-recovery-wording.test.js` 3 条全绿（dist 为 10:32 构建，含本步代码）。参考实现位置：test/contract/bash-recovery-wording.test.ts:25 `const WINDOW = 400`、:63-69 `start/end/continue`。

**建议**：给判据加一条「论域非空」的下限断言（例如把 §3.2.2 的已知两处站点钉成期望的 `file:line` 集合，或断言命中数 ≥ 2 且其中至少一条 prot=true），否则测试自己无法区分「合规」与「扫了个寂寞」；窗口口径建议从「固定字符数」改成「同一字符串字面量/模板串内」或直接按 hunk 跨度给足（实测 hooks.ts 提交锚恢复指引需要 ≥900 字符）；再补一条真变异腿——删掉某处「终端」提示则必须红，而不是只构造合成样本来证明方法论。

### CODEX-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:498（对照 plan §3.1.4 / §3.1.5 / §7.4）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：`immutableChangeReason` 的第一支仍是**跨时间后缀判据**，其保护集是「全部已登记角色减缺省 Driver（claude）」——正是 EV-55 要重写的那条。它与新加的位置判据并列生效，于是当 Driver 不是 claude（本步的整个主题）时，**Driver 自己的原稿与裁决件仍被这一支拦下**，报错还把合法动作说成「审查文档只能由编排器落盘，改动即伪造」。这使 plan §3.1.4 的行为表对非缺省 Driver 不成立（「plan/bug 原稿 送审前**可改**」「作废轮**可改**」）与 §3.1.5 的两个出口（未送审原稿直接改、作废轮之后直接改并提交）失效；§3.1.1 用「时点后移」换来的那个出口，只对缺省 Driver 成立。EV-55 在 BACKLOG 里预告的「反过来新 Driver 的原稿被判伪造」这一半没有被本步消掉，而 §7.4 的偏差表只登记了第 1 步的两条——即「本步交付了跨时间面重写」这一口径本身需要修正。函数自己的文档块（hooks.ts:468-481）仍写「返回 null 表示该文件本就可变（task.json、**原稿**、**裁决件**、便利副本 changes.diff）」，与第一支的实际效果矛盾，会给下一个改这里的人错误前提。

**依据**：hooks.ts:498 `if (hasRoleSuffixCrossTime(base)) return '审查文档只能由编排器落盘，改动即伪造';`；hooks.ts:195-197 的实现为 `criticRoleSuffixes(DEFAULT_DRIVER)` 后缀正则，hooks.ts:140-142 `ALL_AGENT_IDS.filter((id) => id !== driver)`。用已构建模块实测：`hasRoleSuffixCrossTime('2026-09-23-T-gemini.md') === true`、`'2026-09-23-T-revised-gemini.md' === true`、`'2026-09-22-T-response-codex.md' === true`、`'2026-09-23-T-claude.md' === false`，`criticRoleSuffixes('claude') === ['codex','gemini','glm']`。触发面：plan §0.3 记载 `--driver <别家>` 自 M9 第 5 步起即放行（M9 第 6 步已真实审查过一次），注册表现况 codex/gemini/glm 的 `driverEnabled=false` 只是第 3 步才翻转的开关。计划侧原文：r7 §3.1.4 表「plan / bug 原稿 送审前 可改（未进 artifacts[]）」「送审后（该轮作废）可改（未登记，3.1.1 时点门控）」、§3.1.5「未送审原稿的刷新：直接改、直接提交，不需要出口」「作废轮之后继续改稿：直接改、直接提交」，§3.1.1 三要素表把「作废轮不登记」当成那一族的出口。

**建议**：二选一并写进留痕，不要留在代码注释里：①本步处理——把「已提交即不可变」的判据收敛到**登记**（锚②）与 `_meta/` 位置，后缀支只保留对「历史非 Driver 产出形态」的确证；②承认残余——把这一格如实写进 §7.4 与 BACKLOG EV-55（标明「本步只关了 `_meta` 位置面与归档外域面，Driver 自身后缀面仍有跨时间拦截」），并同步修正 §3.1.4/§3.1.5 的表与出口，别让照表执行的人在非缺省 Driver 下以为「直接改可提交」。无论哪条，报错文案都不该把 Driver 修改自己的原稿/裁决件说成伪造。另建议优先补 §3.3 里那条「裁决件原地改 ⇒ 可提交」正例，并把它写成非缺省 Driver——它正是这条缺陷的鉴别用例。

### CODEX-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/gate.ts:357-368` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：删掉「从版本库恢复该文件」只留「重跑一轮」，对**结论文件已被删除**这一成因来说不是一个能解决问题的出口：那份 `_meta/review-<侧>-<run_id>.json` 就登记在本 run 的 `artifacts[]` 里，重跑只产生新 run、不会恢复旧文件，而 `hook-pre-commit` 的锚②会一直以「已丢失」拦下**任何**提交；真正的修复办法（终端 `git restore`）要等到提交被拦那一屏才出现。计划 §3.2.2 允许这个简化（「或干脆只留重跑一轮」），但它把「会话内可行的出口」当成了「唯一出口」，代价是一整轮双审配额，而这条排障路径恰在安全关键面上。

**依据**：gate.ts:354-368（`missingSides` ⇒ failure）；gate.ts:736-790（`missingSides` 的成因：run.json 记该侧 status 为 ok/parse_fallback，而 `review-<c>-<runId>.json` 读不到、也没有 `.failed.json`）；src/trivium/review.ts:1260-1267（该文件进 `protectedMeta` → `meta.artifacts`）；src/trivium/archive.ts:440-467（缺失判 `kind: 'missing'`）；src/trivium/hooks.ts:1283-1298（`checkRecordedArtifacts` 的 missing/modified 一律进 problems）与 1301-1310（problems 非空 ⇒ `EXIT.GATE_BLOCK`），故重跑不解锚。

**建议**：保留「重跑一轮」为主出口，但同时给出真正的修复路径（在终端恢复被删的登记工件，或先 `/dual-abandon` 再重建），措辞与 `checkArchiveIntegrity` 那段保持同源——现在两处对同一种损坏给了不一致的可行结论。若担心「推荐会话内做不到的动作」，就写成「该文件已丢失/被改动，恢复需在终端完成；也可重跑一轮，但重跑不能替代恢复」。

### CODEX-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/contract/bash-recovery-wording.test.ts:63-69` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：违规位置的行号是在**剥注释后的文本**上算的，而 `stripComments` 把整块注释压成一个空格、连同其中的换行一起丢掉，于是每处命中之后的行号整体前移（本仓块注释动辄几十行）。今天待判定集为空所以看不出来；一旦这条判据真的红（修好 CODEX-02 之后必然如此），给出的 `file:line` 会把人指到相差数百行的位置——而它存在的理由恰恰是「下次新增一处恢复文案时别漏」，排障方向被指错一次，这条判据就会被当成噪声关掉。

**依据**：只读复刻实测（同一算法，同时打印剥注释行号与原文行号）：hooks.ts 中本步新增的 deny 文案命中在剥注释文本里是第 470 行、**真实行号 931**；`checkArchiveIntegrity` 的恢复指引在剥注释文本里是第 729 行、**真实行号 1302**（该文件前面的块注释累计 400 行以上）。代码路径：test/contract/bash-recovery-wording.test.ts:63-64（窗口取自 `src`＝剥注释文本）、:68-69（行号也取自 `src`）。

**建议**：行号映射回原文再输出（先用 `m.index` 定位原文位置、或先建「剥注释后→原文」的偏移映射），或退一步只报字符偏移＋匹配文本片段。

### CODEX-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/review.ts:1533-1538（对照 plan §3.1.1「域」行）` |
| 类别 | scope-drift ｜ 层次 code |
| 置信度 | medium |

**问题**：计划要求「越出归档根 ⇒ 不登记，并在 **run.json 与预检**如实标注「本轮原稿不在保护集」」，实现只落了 run.json（`meta.gate.warnings`）与收尾 stderr 两处；预检那半没有落，也没有按 §7.4 的形态登记为偏差（§7.4 只记了第 1 步的两条）。载体的结构性困难与 §7.4 偏差 1 同源——`preflight` 只接 `--stage`，既不知主题也不知被审对象——但「做不到 ⇒ 登记」这一步在本步缺席，于是「本步无偏差」这个口径是不准的。

**依据**：review.ts:1533-1538（notice 只进 `warnings` 与 `meta.gate.warnings`，随后 1585-1587 打到 stderr）；src/trivium/preflight.ts:39-49（`parsePreflightScope` 只接受 `--stage`，无可传主题/被审对象的入口）；plan r7 §3.1.1 域行「并在 `run.json` 与预检如实标注」与 §7.4 偏差表现状（仅第 1 步两条）。

**建议**：要么在 `review --start` 的预检段（那里已持有 `subjectPath` 与 `ctx.archiveRoot`）加一行前置提示，要么按 §7.4 的写法登记偏差并说明标注只出现在 run.json 与收尾输出——同时保住「不静默跳过」这条本意。

### CODEX-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/contract/bash-recovery-wording.test.ts:22-30（GIT_RECOVERY_RE / stripComments）` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | medium |

**问题**：判据的两侧都比它自称的「全集」窄，且窄的方向都是**静默漏**（漏＝保证失效，不是报错）：①`GIT_RECOVERY_RE = /git\s+(checkout|restore|stash|reset)\b/g` 只认「git 后紧跟子命令」的形态，而本仓 AGENTS.md 纪律 4 要求 git 调用一律前缀 `-c core.quotePath=false`——写成 `git -c core.quotePath=false restore -- <路径>` 或 `git -C <目录> restore …` 时正则整体不匹配，而这恰恰是 CODEX-01 里那条**真的能在会话内存活**的形态（也是唯一需要被提示「终端」的形态反被漏掉）；`git switch|clean|revert` 同样不在枚举内。②`stripComments` 的 `/\/\/.*$/gm` 会把字符串字面量里 `//`（如 `https://…`）到行尾的内容一并剥掉，同一行的恢复文案会整条消失——代码注释自认了这一点，但没有把它算作「漏」的方向。

**依据**：test/contract/bash-recovery-wording.test.ts:22-30 的常量与剥注释实现；对照 src/trivium/hooks.ts:686（守卫侧 `(?:-[^\s]+\s+)*`）与 AGENTS.md:62（「所有 git 调用前缀 `-c core.quotePath=false`」）；实测这两种写法的 `writeLike` 均为 false（见 CODEX-01 证据），即判据与它要保护的现实形态同向失明。

**建议**：把正则放宽到「git 与其后任意取值型选项之后」（`git(\s+-\S+(\s+\S+)?)*\s+(checkout|restore|switch|clean|stash|reset|revert)` 这类形态），并把 `switch|clean|revert` 一并纳入评估；剥注释改用 test/helpers/strip-non-code.ts 那套 AST 级实现（它剥注释、留调用实参，正是本判据需要的方向），别用会切断字符串的正则。

### CODEX-08 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/review.ts:485-487（subjectArtifactRelPath）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | low |

**问题**：域判据是**纯词法**的：两侧路径不先 realpath 就比 `path.relative`。若被审对象是经另一条符号链接路径给出的绝对路径（macOS 的 `/tmp`→`/private/tmp`、工程目录本身是软链、或 `--plan-file` 从 Finder／另一工具取到未归一化的路径），同一个归档内文件会被判「越出归档根」⇒ 走 `relSubject === null` 分支，**静默不登记**（归档内的原稿失去保护），而 notice 的理由「不在归档根内」是错的。仓库对同一坑已有先例（fixture.ts:38 为夹具根特意 realpath；hooks.ts:216-214 的 `isInsideArchiveResolved` 文档块写明 macOS `/var` 软链）。另：`startsWith('..')` 对首个相对分量以 `..` 开头确有误判面，但主题名被 `naming.validateTopic` 禁掉了前导 `.` 与 `..`，故该面不可达，不必改。

**依据**：review.ts:485-487；src/trivium/naming.ts:49-58（主题名禁前导 `.`、禁 `..`，故组成相对路径首段的只能是合法主题名）；src/trivium/topic.ts:85-105（显式分支只做 `exists()` 校验、不 realpath）；实测（只读脚本调已构建模块）：`subjectArtifactRelPath('/private/var/T/.reviews', '/private/var/T/.reviews/EV/plan/a.md') ⇒ 'EV/plan/a.md'`，而同一文件经软链写法 `'/var/T/.reviews/EV/plan/a.md' ⇒ null`。

**建议**：判 null 之前再比一次 realpath（两侧都解一次再 `path.relative`），或至少让 notice 区分「确认在归档外」与「路径形态对不上、无法判定」，别把一次保护静默降级说成正常情况。

## 认为正确的部分

- 登记时点/门控忠实于 §3.1.1：新块排在 `subject_drift`、`driftAction==='fail'`（超时档）与 `mode.abort` 三个作废分支之后，并额外门控 `meta.status === 'success'`（review.ts:1503-1541）；`skipVerdict.skipped` 的提前返回只对 code 阶段存在（review.ts:981-1010），plan/bug 到不了那里，故「作废轮不登记」成立。
- code 阶段确实被 `stage !== 'code'` 挡住、不会重复登记：实测归档 `.reviews/EV-79-写命令判据两处缺口/code/_meta/run-20260922T115822Z.json` 的 artifacts 第一条就是 `…/code/_meta/changes-<runid>.diff`（骨架期由 prepareRun 的 metaArtifacts 登记，review.ts:839-846/895），再登记即重复条目。
- 位置判据的域判据主体正确：归档内文档返回相对路径（`EV/plan/a.md`）、归档外文档返回 null（`../doc/…`）、相邻兄弟目录 `.reviews-backup` 也被正确排除；`path.join(archiveRoot, path)` 的还原口径与 `archive.checkRecordedArtifacts` 同源，新增集成用例（fault-injection.test.ts:113-131）用复算 sha256 把它锁住了。新增的 test/unit/subject-artifact.test.ts 我实跑过，5 条全绿。
- hooks.ts 的求值顺序忠实于计划 §3.1.2：`run-*.json` 分支（hooks.ts:499）确实排在新的位置判据（:519）之前，且这条顺序有测试咬住——`run-*.json：running 态收尾回写可以提交…`（hooks.test.ts:1033-1055）在顺序颠倒时会红，不是只写在注释里。
- `hasRoleSuffixCrossTime` 那支的既有行为没有被本次改动影响：该支条件与位置一字未动（hooks.ts:498），diff 只动了它下面的注释与新增支；`IMMUTABLE_META` 删除后全仓无遗漏消费点（grep 仅剩新测试里的一句注释，已构建 bundle 里是新逻辑）。
- 位置判据的两个排除项在现有归档上确实完备：实读若干真留痕，`_meta/` 内固定名只有 `changes.diff`（.reviews/README.md:93 记载），其余一律带 run_id；task.json 与裁决件都不在 `_meta/` 内（naming.buildArtifactName 产出 `<日期>-<主题>[-r<N>][-revised|-response]-<角色>.md`，落在阶段目录），故位置判据不会误伤 Driver 与编排器的正常产出。
- guard.ts:759 按计划不改的判断成立：该句在 `renderGuardWarnings` 的只读失守段（guard.ts:752-760），不给具体路径、上文只给 `git status --porcelain -uall` 与 `git diff`，对象是违规调用记录里的文件，通常是业务文件；命令文本不含保护字面量时 Bash 守卫放行，会话内可执行。万一对象落在归档内，本步新增的 CLAUDE.md/snippet 段落正好覆盖那一种残余，所以不需要在 guard.ts 再加提示。
- 三处文案改动与实现的对应关系核对无误：Bash 侧 `WRITE_LIKE` 含 `git …(checkout|restore|switch|stash|reset|clean|mv|rm|commit…)`（hooks.ts:686），`bashTargetsProtected` 用 `MENTIONS_OWNED`（hooks.ts:742）覆盖 `_meta`/`task.json`/`state.json`；既有负例 `hooks.test.ts:482`（`git checkout -- .reviews/t/plan/_meta` ⇒ 拦）在守这条。CLAUDE.md:37-43 与 protocol snippet:35-39 两处新增段落语义一致（snippet 版少了「（M10a 第 2 步 EV-55 §3.2.2）」这处出处标注，无害）。
- 三条新增 hooks 单测不是空转：`gate.block_commit` 默认 true（config.ts:395），所以 allow 侧断言不是被早退放行；running 态那条真的走 `readAtHead`（HEAD 里是 running 态），顺序反了会红；新 `_meta` 工件那条用的是旧正则不认的文件名（`trace-…json`），改前必放行，断言咬的正是新判据。集成那条亦非巧合：夹具原稿名 `<today>-<topic>-claude.md` 与断言逐字一致（fixture.ts:142-153），并复算 sha256 验证还原口径。
- §3.3 缺口的风险我再判一次：其中「裁决件原地改 ⇒ 可提交」**不是**低风险——它恰好是 CODEX-03 的鉴别用例（写成非缺省 Driver 就会红），「作废轮后原稿可改」同因；其余三项（`verify-*.json` 改 ⇒ 拦、code 轮不新增登记、归档外不登记 + 标注）风险确实低，可以随下一轮补。

## 未覆盖范围（本侧盲区）

- 未跑全量 `npm test` / `npm run check` / 变异验证（沙箱只读，构建与夹具都要写盘）。只跑了两个纯读用例文件（bash-recovery-wording、subject-artifact）与若干只读复刻脚本；CODEX-01/02 的失效方向是**在内存里**模拟（不改源码）得到的，不是规范意义上的变异验证。
- 未核 `verify` 段的实际落盘与重写面（`verify-<runId>.json` 是否真的只落一次），只按 plan §3.1.3 与 review.ts/verify.ts 的读侧判断，故位置判据对 verify 面的扩张只做了逻辑核对，没有实测。
- 未端到端验证 `--plan-file doc/…`（越出归档根）那条路径：需要在真实夹具上跑一轮 plan 阶段并指向归档外文档，成本与配额允许时才做；因此 §3.1.4「归档外原稿可改」这半只有纯函数与代码路径层面的核实。
- 未审 `skills/dual-critic/` 下 SKILL.md / `argument-hint` 与本步文案是否同步（本步只改 protocol snippet），也未核 init 注入下游后 CLAUDE 段的最终渲染形态。
- 未审多会话/并发下新判据的行为（例如并发两轮收尾时 `meta.gate.warnings` 的追加语义），也未覆盖 Windows 路径分隔（项目声明仅 macOS）。
- 按禁读清单，未读另一位审查员的任何产出与 r1～r6 计划稿，故「本步相对上一轮改了什么」只按本 diff 的 base/head 与 r7 计划正文判断。

## 实际查阅的项目文件

- `.reviews/M10-任意Driver/code/_meta/changes-20260923T030441Z.diff`
- `.reviews/M10-任意Driver/plan/2026-09-22-M10-任意Driver-r7-claude.md`
- `.reviews/M10b-入口资产与真载体验收/plan/2026-09-22-M10b-入口资产与真载体验收-claude.md`
- `.reviews/README.md`
- `.reviews/EV-79-写命令判据两处缺口/code/_meta/run-20260922T115822Z.json`
- `AGENTS.md`
- `CLAUDE.md`
- `skills/dual-critic/protocol/CLAUDE.md.snippet`
- `skills/dual-critic/schema/run.v2.json`
- `skills/dual-critic/scripts/trivium.cjs`
- `src/trivium/archive.ts`
- `src/trivium/cli.ts`
- `src/trivium/config.ts`
- `src/trivium/gate.ts`
- `src/trivium/guard.ts`
- `src/trivium/hooks.ts`
- `src/trivium/meta.ts`
- `src/trivium/naming.ts`
- `src/trivium/preflight.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/topic.ts`
- `src/trivium/util/git.ts`
- `src/trivium/verify.ts`
- `src/trivium/retention.ts`
- `test/contract/bash-recovery-wording.test.ts`
- `test/helpers/fixture.ts`
- `test/helpers/strip-non-code.ts`
- `test/integration/fault-injection.test.ts`
- `test/integration/gate-loop.test.ts`
- `test/unit/gate.test.ts`
- `test/unit/hooks.test.ts`
- `test/unit/registry-parity.test.ts`
- `test/unit/subject-artifact.test.ts`
- `dist/test/test/contract/bash-recovery-wording.test.js`
- `dist/test/test/unit/subject-artifact.test.js`
- `dist/test/src/trivium/hooks.js`
- `dist/test/src/trivium/review.js`
- `dist/test/src/trivium/agents/registry.js`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-09-19_m9_claude_critic_acceptance.md`
- `doc/05_testing/REPORT_2026-09-20_m9_claude_critic_acceptance_r2.md`
- `doc/08_project/BACKLOG.md`
- `/Users/chenzhenbo/.claude/skills/dual-critic/schema/review.v1.json`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":99,"project_reads":63}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
