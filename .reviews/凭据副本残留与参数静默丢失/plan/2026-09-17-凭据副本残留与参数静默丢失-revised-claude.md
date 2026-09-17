---
schema: trivium.disposition.v1
topic: 凭据副本残留与参数静默丢失
stage: plan
role: claude
kind: revised
run_id: 20260917T004747Z
addresses:
  - 2026-09-17-凭据副本残留与参数静默丢失-codex.md
  - 2026-09-17-凭据副本残留与参数静默丢失-gemini.md
  - 2026-09-17-凭据副本残留与参数静默丢失-glm.md
---

# 计划修订（r1）：前提错了一条，挂载点要重摆

## 0. 总裁决：25 条全部接受，零驳回，两条子项暂缓

三侧各自独立读到同一条阻断（CODEX-01 ≡ AGY-01 ≡ GLM-01）：原稿 §7 断言「zcode 运行目录里没有凭据副本」，
而 `adapters/zcode.ts:153-180` 的 `prepareZcodeHome` 每次指定模型都把整份 `~/.zcode/cli/config.json`（含 provider 明文 apiKey）
写进 `<run>/home/.zcode/cli/config.json`，0600，跑后零清理。`retention.ts:5` 的文件头注释白纸黑字写着
「每次运行还各留两份 zcode 凭据副本」——**那份文件在我自己给审查者的必读清单里**，我读了它的函数体、没读它的文件头。
按原稿做完，EV-20 会在 zcode 侧假性收口，且错误断言随 §4.3 进入设计 §10.5。这一条的代价我在 §6 单记。

其余 22 条按主题归并成七组，逐条裁决见 §1 表，落点见 §2～§5 的重写段。两条子项暂缓并登记编号：
CODEX-04 的「跨项目全量清扫子命令」（登记 EV-33）、CODEX-08 的「解析器代次字段」（同批安装 + 旧写法指纹告警已覆盖窗口）。

三侧「认为正确」段对我 §1 两处 BACKLOG 更正、D-1 / D-3 的论证、上限表放分发层、删 `tokenize` 而非修、16 个布尔旗标全集
（三侧各自 grep 复核）均判为成立，本件不再重复论证。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | blocker | 接受 | 属实，我复读 `zcode.ts:153-180` 与 `:307` 调用点：整份 config.json 含凭据落运行目录，四个出口不清理；agy 侧我与三侧各自 grep（`config.json`/`copyFile`/`HOME`）零命中，「agy 无副本」维持但按 codex 的措辞改为「未发现反例」 | §2.1：zcode 实现 `scrubRunDir`，载体 `home/.zcode/cli/config.json` 整份删；§7 断言改写；EV-20 的 done 判定覆盖两侧 |
| CODEX-02 | codex | major | 接受 | 属实：`runner.ts:113-150` 同一 `req.out_dir` 重试，`codex-home.ts:191` 路径不带轮次，「哨兵在即跳过」会让第二次尝试的副本漏抹。原稿那句「不受影响」是没有机制支撑的断言 | §2.2：挂载点上移到 runner，每次尝试前删旧哨兵、尝试后无条件抹除；哨兵只对清扫路径起「跳过」作用；§4 补「同目录两次准备→抹除」用例 |
| CODEX-03 | codex | major | 接受 | 属实：`codex.ts:495/533` 把事件流逐字写进 `stdout.jsonl`，zcode 同形写 `stdout.json`（`zcode.ts:299/324`），`trace.json` 含命令原文。2026-09-16 那次泄露的留痕就在这类文件里，原稿的扫描面恰好绕开它 | §2.3：编排器自写的 `<side>/stdout.jsonl`、`stdout.json`、`trace.json` 纳入扫描面，命中**就地脱敏**（新 `redactSecrets()`），不删——它们是排障依据；`sessions/` 仍登记 EV-32 |
| CODEX-04 | codex | major | 接受 | ① `retention.ts:29-30` 的 `days<=0` 早退属实，把安全底线挂在可关的档位上与原稿自己的立场矛盾，接受解耦；② 只清本项目桶属实，边界要写明。③「显式子命令做全 run_root 清扫」是新范围，**暂缓**：本轮先把边界写进设计与 §7，登记 EV-33 | §2.4：清扫与 TTL 整删解耦，`days<=0` 仍抹除；§4 补用例；§7 与设计 §13.1 写明「只清本项目桶」；BACKLOG 登记 EV-33 |
| CODEX-05 | codex | major | 接受 | 属实：`status.ts:95-103` 对缺失与损坏都返回 null，原稿判据把「读不到」折叠成「可抹」，对不可逆操作是 fail-open。GLM 在「认为正确」段持相反意见（现有判据够用），我采 codex/gemini 的严判据：多一条合取式零成本，误判方向不对称 | §2.4：抹除前提改为「status 读得到 ∧（终态 ∨（非 starting ∧ 有 pid ∧ processAlive 明确否））」，null 单列为第三种结论并计数；§4 补「无 status.json 的目录不被抹」用例 |
| CODEX-06 | codex | major | 接受 | 属实：`adapters/index.ts:41-70` 缺接线即 throw，`hooks.ts:1035-1041` 的 catch 只在 DEBUG 下打印。把新职责挂上去会连今天的磁盘清理一起静默不跑 | §2.4：新增不抛的逐侧取表 `wiredAdapter(id)`，清扫按运行目录里实际存在的侧目录逐侧取，缺接线记 note；失败计数进人读输出（与 CODEX-10 同落点） |
| CODEX-07 | codex | major | 接受 | 属实：`cli.ts:76-79` 的 `=` 分支无条件存字符串，`--reject=true` 仍静默变通过。与 AGY-07、GLM-04 同一条 | §3：`BOOLEAN_FLAGS` 同时约束 `=` 分支——`true`/`1` 置位、`false`/`0` 不置位、其余退 64；对账测试两种形态都扫 |
| CODEX-08 | codex | major | 接受 | ①旧指引 + 新 CLI 的窗口里，字面引号会原样进 `prompt_hint`——属实且无报错；②`$ARGUMENTS` 不加引号时 glob 展开属实（今天也如此，只是原稿没写）；③同批安装要写成显式前置。④「解析器代次字段」**暂缓**：skill 与 CLI 同一提交、`install:local` 同批装，①的指纹告警已覆盖开着的旧会话那个窗口，再加一个字段是为一次性窗口留永久接口 | §5：切分后检测 rest/贪婪值 token 首尾成对字面引号 → `notes` 告警「新版不需补引号」；skill 指引用单引号包裹（同时解决 glob）；§8 执行前置写明「skill 与 CLI 同批安装」；§4 补含 glob 与旗标字样的真子进程用例 |
| CODEX-09 | codex | major | 接受 | 属实：`topic-args.ts:22-30/44-50` 头注释登记的正是这一族，D-4 只盯 `--topic` 把覆盖面收窄了。档位按建议分两级 | §5：检测遍历 `NAMED_FLAGS`，论域为 rest token 与贪婪旗标的值（合 GLM-03）；`--topic` 退 64，其余进 `notes`；§7 不再需要那条豁免声明 |
| CODEX-10 | codex | minor | 接受 | 属实：哨兵在无人读的目录里，人读输出只报成功数，等于换个方式静默 | §2.5：SessionStart 那行同时报「M 个抹除失败（原因，哨兵路径）」；`ok:false` 的哨兵由清扫重试；§4 补「失败时人读输出含失败计数」用例 |
| CODEX-11 | codex | minor | 接受 | 属实：`cli.ts:1188-1195` 的 help/version 短路在分发之前，`trivium help topic` 今天能跑。上限判据放在短路之后即可，并显式列豁免以免日后被当回归修掉 | §3：上限表显式 `help: ∞`、`version: ∞`（判据挂在短路之后）；§4 补 `trivium help topic` 用例 |
| CODEX-12 | codex | nit | 接受 | 属实：`codex-wiring.test.ts:44-58` 已有假二进制写法（只回显版本，事件流发射器仍要写，但骨架现成）；`run()` 真起子进程按 AGENTS.md 分层属 integration | §4：三出口 + 幂等 + status 缺失用例统一落 `test/integration/`，复用该写法；§5.1 成本改为「复用现有夹具骨架，约两三小时」 |
| AGY-01 | gemini | major | 接受 | 与 CODEX-01 ≡ GLM-01 同一事实，独立发现 | 同 CODEX-01 |
| AGY-02 | gemini | major | 接受 | 属实：`run-protocol.ts:580-598` 的 `worker_lost` 分支置 failed 并回收闸门后直接 throw，是原稿三处挂载之外的**第五种结局**（同会话内崩溃/强杀，既不走 `--cancel` 也不等下次会话启动） | §2.2：`worker_lost` 分支在回收闸门后对该运行目录逐侧抹除，成为第四处挂载 |
| AGY-03 | gemini | major | 接受 | 属实：原稿教「含单引号时改用双引号并转义四种字符」是把 shell 展开与命令替换的风险交给模型手工转写，正文含 `$`、反引号、`\s+` 时必出事。POSIX 单引号 + `'\''` 是唯一机械可靠的形态 | §5：四条 skill 指引只教一种形态：整段单引号包裹，内部单引号写成 `'\''`，其余字符一律不转义；给可照抄模板；删去双引号建议 |
| AGY-04 | gemini | minor | 接受 | 与 CODEX-05 同一缺口的另一面：`status.ts:78` 新建时 `phase: 'starting'`、`worker_pid: null`，宽判据会把刚拉起的运行误判为「worker 不在」。严判据同时排除 starting 与 null | 同 CODEX-05 |
| AGY-05 | gemini | minor | 接受 | 属实，且**推翻我 §4.2 的一句断言**：`fault-injection.test.ts:579` 与 `stub-agent-kit.test.ts:224-226` 都以单一字符串传 `--` 之后的内容，它们就是 `cmdTopic` 的端到端用例，只是编码的是旧契约。改数组语义后必红 | §4：两处用例改为数组传参（`'--topic', TOPIC, '--critics', 'glm', '看并发'` 形态）；原稿「从未被测过」改为「被测过、但测的是旧契约」 |
| AGY-06 | gemini | nit | 接受 | 属实：worker 是后台派生进程，stdout/stderr 进 `worker.log`（`run-protocol.ts:50/305`），适配器内的 `warn` 前台看不见。`CriticResult` 现无 `warnings` 字段（我 grep 核实），按最小面加 | §2.5：`CriticResult` 加可选 `scrub` 字段；worker 的 `patchStatus` 把失败写进该侧 `note`，`--wait` 的 `progress_brief` 已会渲染 note；`run.json` 不改 |
| AGY-07 | gemini | nit | 接受 | 与 CODEX-07 ≡ GLM-04 同一事实 | 同 CODEX-07 |
| GLM-01 | glm | blocker | 接受 | 与 CODEX-01 ≡ AGY-01 同一事实；GLM 额外指出「错误断言会随 §4.3 进设计 §10.5」，这条后果我接受并在 §6 记 | 同 CODEX-01 |
| GLM-02 | glm | major | 接受 | 与 CODEX-02 同一缺口；GLM 的建议「finally 无条件抹除、幂等跳过只用于清扫路径」正是采纳的形态 | 同 CODEX-02 |
| GLM-03 | glm | major | 接受 | 属实：`topic-args.ts:118-123` 贪婪循环把整个 token 收进 `named.focus`，rest 为空，原稿判据不命中——用户显式 `--focus '… --topic …'` 正是最常见的写法 | 同 CODEX-09（论域含贪婪值）；§4 补「显式 `--focus` 含 `--topic` 字样且未给主题 → 64；给了 → 逐字保留」用例 |
| GLM-04 | glm | minor | 接受 | 与 CODEX-07 ≡ AGY-07 同一事实 | 同 CODEX-07 |
| GLM-05 | glm | minor | 接受 | 属实：`codex-home.ts:200-243` 先写 config.toml 后拷 auth.json，中途失败时前者已在盘上，而 `codex.ts:496-502` 的 catch 直接 return。挂载点上移到 runner 后（CODEX-02 的落点）`adapter.run` 整个被包住，准备失败的早退自然覆盖，不需要单独一行 | 同 CODEX-02（结构性解决）；§4 补「准备中途失败也抹除」用例 |
| GLM-06 | glm | minor | 接受 | ①「只教一种机械形态、给可照抄模板」与 AGY-03 一致，采纳；②「把 §8.5 的裁决写进修订件」采纳，见 §5。③**「默认仍 `$ARGUMENTS` 直传、只在含旗标字样时才包裹」不采纳**：不加引号的文本会先经 shell 的引号解析与展开——裸 `"` 是语法错误、成对 `"` 被剥掉、`$`/反引号/`*` 被展开——最常走的路径反而是风险最高的路径；单引号包裹是唯一不需要模型判断「要不要包」的形态 | §5 |

## 2. EV-20 重写：挂载点上移、两侧载体、扫描面加一层

### 2.1 哪一侧放了凭据副本，哪一侧抹

| 侧 | 载体（整份删除） | 该侧自有目录（扫描，命中即删） | 跑后回读物（保留） |
| :-- | :-- | :-- | :-- |
| codex | `codexhome/config.toml`、`codexhome/<profile>.config.toml`、`codexhome/auth.json` | `codexhome/` 下 `sessions/` 以外的普通文件（`models-*.json`、`fakehome/` 内容） | `codexhome/sessions/`（生效模型来源，`codex-trace.ts:206`） |
| glm（zcode） | `home/.zcode/cli/config.json` | `home/` 下其余普通文件 | 无（`prepareZcodeHome` 返回值只喂本次 `invokeZcode`，跑后无人回读） |
| gemini（agy） | 无 | 无 | 无 |

`CriticAdapter.scrubRunDir?(sideDir)` 由 codex 与 zcode 实现；agy 与桩不实现，清扫如实记「该侧无副本」。
原稿 §7「不给 agy / zcode 加」那条删除。**agy 侧的口径按 codex 的措辞**：三侧与我各自 grep 未发现副本写入，是「未发现反例」，不是「已证明」。

### 2.2 四处挂载，第一处上移到 runner

| # | 挂载点 | 覆盖 | 变化 |
| :-- | :-- | :-- | :-- |
| ① | `runner.ts` `runOneSide` **每次尝试**：调 `adapter.run` 前删该侧旧哨兵，`try { run } finally { scrubSide }` | 成功、超时、无最终回复、拉起异常、**准备中途失败**（GLM-05）、适配器抛异常；**每次重试各抹一次**（CODEX-02 / GLM-02） | 原稿挂在 `codex.ts` 适配器内，只覆盖一侧、且从「准备成功起」；上移后一处代码覆盖所有侧，适配器只需实现 `scrubRunDir` |
| ② | `run-protocol.ts` `waitRun` 的 `worker_lost` 分支，回收闸门之后 | 同会话内 worker 崩溃 / OOM / 强杀（AGY-02） | 新增 |
| ③ | `run-protocol.ts` `cancelRun`，进程组确认死亡之后 | `--cancel` | 不变 |
| ④ | `retention.ts` 会话启动清扫 | 跨会话的崩溃、断电、`kill -9`；①②③ 抹除失败的重试 | 判据、作用域、取表方式三处改，见 2.4 |

哨兵 `<side>/scrub.json`：时间、删了什么、扫了几个文件、脱敏几处、失败原因。**只对 ③④ 起「`ok:true` 即跳过」的作用**；① 每次尝试都无条件跑，并在跑前删旧哨兵。

### 2.3 扫描面加一层：编排器自写的日志

CODEX-03 指出的缺口：`<side>/stdout.jsonl`（codex）、`<side>/stdout.json`（zcode）、`<side>/trace.json` 是编排器自己写的逐字原文，
模型若在沙箱里读了自己的配置，token 就在这里，而这三份是排障依据，不能删。处置：**就地脱敏**——`secrets.ts` 新增
`redactSecrets(content): { content, count }`，按现有 `RULES` 逐条 `replace`，命中处换成现有 `redact()` 的首尾四字符预览；
写回原文件，计数进哨兵。`trace.json` 的脱敏只动字符串值内部，结构不变，下游读 `commands` 做措施 b 核验不受影响
（路径不是密钥形态，`looksReal` 不会命中）。

**不动 `<side>/out/`**：那是审查结果，归档时已过 `assertNoSecrets`，且 `executeRun` 在 ① 之后还要读它。
**不动 `codexhome/sessions/`**：D-2 的 B 项，登记 EV-32 不变。

### 2.4 清扫的判据、作用域与取表

- **判据**（CODEX-05 / AGY-04）：`status.json` 读得到 **∧**（`isTerminal(phase)` **∨**（`phase !== 'starting'` ∧ `worker_pid` 非空 ∧ `processAlive` 明确返回不存活或非同一进程））。
  读不到（缺失或损坏）**一律跳过**，单列计数「N 个目录状态未知，未处理」。GLM 认为现有判据够用；我采严判据：抹除不可逆，多一条合取式零成本。
- **与 TTL 解耦**（CODEX-04）：`run_dir_days <= 0` 只跳过到期整删，抹除照跑。
- **作用域**：仍只清本项目桶。**边界如实写进设计 §13.1 与 §7**：在别的仓库干活的会话不会抹这个仓库的残留；全 run_root 清扫登记 EV-33。
- **取表**（CODEX-06）：`adapters/index.ts` 新增 `wiredAdapter(id): CriticAdapter | undefined`，不抛；清扫按运行目录里实际存在的侧子目录逐侧取，缺接线记 note。`pruneRunDirs` 的入参加 `adapters` 查表函数。

### 2.5 失败要看得见

| 路径 | 落点 |
| :-- | :-- |
| ① runner | `CriticResult` 加可选 `scrub: ScrubOutcome`；worker 的 `patchStatus` 把 `ok:false` 写进该侧 `sides[c].note`，`--wait` 的 `progress_brief` 已渲染 note（AGY-06）。`run.json` 不改 |
| ④ 清扫 | SessionStart 那行改为「已抹除 N 个运行目录的凭据副本；M 个抹除失败（首个原因，哨兵路径）；K 个状态未知未处理」（CODEX-10）；`catch` 里的失败也进这行，不再只在 DEBUG 下打印（CODEX-06） |

「抹除失败只告警不判该侧运行失败」的取舍**维持**：codex 与 glm 都判它成立，前提是失败可见且会被重试——上表就是这两个前提的落点。

## 3. EV-24 补两处

- `BOOLEAN_FLAGS` 同时约束 `=` 分支（CODEX-07 ≡ AGY-07 ≡ GLM-04）：`--x=true`/`--x=1` 置位，`--x=false`/`--x=0` 不置位，其余值退 64 并给写法。对账测试对每个布尔旗标扫两种形态：`--x 值`（值落位置参数 → 64）与 `--x=乱值`（→ 64）。
- 上限表显式豁免 `help` / `version`（CODEX-11），判据挂在 `main()` 的 help/version 短路之后；用例 `trivium help topic` 退 0。
- 其余不变：上限表 `topic: 1`、`gate: 1`、缺省 0；`approve`/`abandon` 的提示指向 `--reason`；USAGE、停点话术、`dual-approve` skill 同步。

## 4. EV-18 补三处、改一处断言

- **响亮失败的论域**（CODEX-09 + GLM-03）：切分完成后，对 rest token **与 `--focus`/`--goal` 的值**逐个匹配 `/(^|\s)--<name>(=|\s|$)/`，`name` 遍历 `NAMED_FLAGS`，且该旗标未显式给出：`topic` → 退 64（文案照原稿）；其余 → `notes` 一条「正文含 `--<name>` 字样但未识别为旗标，若你本想传它请放在引号之外」。
- **旧写法指纹**（CODEX-08）：某个 rest/贪婪值 token 首尾是成对字面 `"` 或 `'` → `notes`「新版不需要补字面引号，这对引号会原样进入焦点」。不退 64：正文本身以引号起止是合法内容。
- **既有端到端用例改数组**（AGY-05）：`fault-injection.test.ts:579` 与 `stub-agent-kit.test.ts:224` 两处；原稿「`cmdTopic` 从未被端到端测过」改为「测过，测的是旧契约」。
- **USAGE 与设计**：`topic resolve` 的规格写成「`--` 之后按 argv 逐个解析，每个 argv 元素是一个 token，不再分词」。

## 5. skill 指引：只教一种形态（AGY-03 ≡ GLM-06 的模板部分，回答原稿 §8.5）

四条 review skill 第 2 步的新指引（B/C/D 同文，dual-run 同义）：

> `--` 之后的内容按 shell 参数逐个解析，不再重新分词。**把用户正文整段放进一个单引号参数，旗标放在引号之外**：
>
> ```
> TV topic resolve --stage plan --json -- '<正文原样>' --topic <主题> [其余旗标]
> ```
>
> 正文里的单引号写成 `'\''`（关引号、转义一个单引号、再开引号），**其余任何字符一律不转义**——
> `$`、反引号、`\`、`"`、`*`、`--xxx` 在单引号里都是字面量，会逐字进入焦点。
> 不要改用双引号，不要补字面引号：新版解析器不剥引号，补了会原样进 BRIEF。

GLM-06 提的「默认直传、按需包裹」不采纳，理由见裁决表：不包裹的路径要先过 shell 的引号解析与展开，正文含裸引号是语法错误、含成对引号被剥、含 `$` 被展开——那是最常走也最危险的路径。**同批安装**（CODEX-08 ③）写进 §8。

## 6. 本轮的一件事值得单记

三侧同时逮到的阻断，反例在我给审查者的**必读清单**里（`retention.ts` 文件头第 5 行）。我读了那个文件的函数体来定位清理逻辑，
没读它的头注释；给 zcode 侧下「没有副本」的结论时，依据是「凭据走 CLI 登录态」这句从记忆里来的话，没有对 `adapters/zcode.ts` 做过哪怕一次 grep。
原稿 §7 那条末尾写了「若审查者知道反例，请指出」——这句话把核实的责任推给了审查，而核实成本是一次 grep。
与 M8 r11 CODEX-07 那课（落点清单不能靠记性）同形：**「明确不做」的每一条也是断言，也要有依据行号。**

## 7. 修订后的「明确不做」

- 不扫 `codexhome/sessions/`，登记 EV-32（不变）。
- 不做全 `run_root` 的跨项目清扫子命令，登记 EV-33；只清本项目桶的边界写进设计 §13.1。
- 不加配置开关（不变）。
- 不动 `retention.run_dir_days` 的整删语义与默认值（不变）；抹除与它解耦。
- 不给 agy 加 `scrubRunDir`：三侧与我各自 grep 未发现副本写入（`agy.ts` 无 `config.json`/`copyFile`/`HOME` 命中）——是未发现反例，不是已证明。
- 不动 `review --start` 的解析（不变）。
- 不做「审批附言」之外的新字段（不变）。
- 不修 `tokenize`，直接删（不变）。
- 不给 `topic resolve` 加解析器代次字段（CODEX-08 ④ 暂缓，理由见裁决表）。

## 8. 修订清单（审批后执行）

| # | 落点 | 做什么 | 对应意见 |
| :-- | :-- | :-- | :-- |
| 1 | `src/trivium/scrub.ts`（新） | `scrubSide(adapter, sideDir)`：调 `adapter.scrubRunDir?`、扫该侧自有目录、脱敏三份日志、写哨兵；`ScrubOutcome` 类型 | CODEX-01/02/03 |
| 2 | `src/trivium/secrets.ts` | `redactSecrets()` | CODEX-03 |
| 3 | `src/trivium/adapters/base.ts` | `CriticAdapter.scrubRunDir?`；`CriticResult.scrub?` | CODEX-01、AGY-06 |
| 4 | `src/trivium/adapters/codex-home.ts` / `codex.ts` | codex 的 `scrubRunDir`（三载体 + `codexhome/` 扫描，排除 `sessions/`） | 原稿 |
| 5 | `src/trivium/adapters/zcode.ts` | zcode 的 `scrubRunDir`（`home/.zcode/cli/config.json` + `home/` 扫描） | CODEX-01 ≡ AGY-01 ≡ GLM-01 |
| 6 | `src/trivium/adapters/index.ts` | `wiredAdapter(id)` 不抛取表 | CODEX-06 |
| 7 | `src/trivium/runner.ts` | 每次尝试前删哨兵，`finally` 抹除，结果挂 `scrub` | CODEX-02、GLM-02、GLM-05 |
| 8 | `src/trivium/run-protocol.ts` | `worker_lost` 分支与 `cancelRun` 各加一处；worker 的 `patchStatus` 写侧 note | AGY-02、AGY-06 |
| 9 | `src/trivium/retention.ts` / `hooks.ts` | 严判据、与 TTL 解耦、逐侧取表、人读输出三段计数 | CODEX-04/05/06/10、AGY-04 |
| 10 | `src/trivium/cli.ts` | `BOOLEAN_FLAGS` 两分支；上限表含 help/version 豁免；`trailing: string[]`；删 `--args`；USAGE；停点话术 | CODEX-07/11、AGY-07、GLM-04、原稿 |
| 11 | `src/trivium/topic-args.ts` / `exit-codes.ts` | 数组入参、删 `tokenize`、旗标字样检测（全旗标、含贪婪值）、旧写法指纹、文案 | CODEX-08/09、GLM-03、原稿 |
| 12 | 四条 review skill、`dual-approve` skill | §5 的指引；附言写法 | AGY-03、GLM-06、原稿 |
| 13 | `test/integration/`（新文件） | 假 codex 二进制发事件流；三出口 + 重试两次 + 准备中途失败 + status 缺失 + `run_dir_days: 0` 仍抹除 + 失败计数可见 | CODEX-02/04/05/10/12、GLM-05 |
| 14 | `test/unit/retention.test.ts`、`codex-adapter.test.ts`、新 zcode 抹除用例 | 载体删除、自有目录扫描、哨兵、幂等；`redactSecrets` 用例 | 原稿、CODEX-01/03 |
| 15 | `test/integration/gate-loop.test.ts` | 多余位置参数 / `--reject 理由` / `--reject=true` / `--reason` 落盘 | 原稿、CODEX-07 |
| 16 | `test/contract/`（新） | 布尔旗标两形态对账；skill 不含「字面双引号」字样 | 原稿、CODEX-07 |
| 17 | `test/unit/topic-args.test.ts`、`fault-injection.test.ts`、`stub-agent-kit.test.ts` | 数组入参；裸引号；`--focus` 含 `--topic` 字样两态；旧写法指纹；glob 与旗标字样真子进程逐字 | 原稿、AGY-05、GLM-03、CODEX-08 |
| 18 | 设计 §10.5 / §7.1 / §13.1 / §21 v1.3.15、`doc/02_design/README.md`、PROTOCOL、MANUAL、BACKLOG（EV-18/20/24 done，EV-32/33 新增） | §10.5 凭据行写「codex 与 zcode 两侧」，不写 agy 已证明无副本 | 原稿、GLM-01、CODEX-04 |

变异验证补三条：⑥去掉 runner 里「尝试前删哨兵」→ 重试用例红；⑦去掉 `worker_lost` 分支的抹除 → 对应用例红；⑧把清扫判据改回「status 为 null 也算已死」→ 状态未知用例红。

**执行前置**：`/dual-approve` → 实施 → `npm run check` → `npm run install:local`（skill 与 CLI **同批**装，CODEX-08 ③）→ 手工三条端到端（原稿 §5，第 3 条对 codex 与 glm 两侧目录各查一次，只 `ls` 与 grep 哨兵）→ `/dual-review-code`。

四个决策的推荐不变：D-1 A（整份删，现在覆盖两侧载体）、D-2 A（自有目录扫描 + 日志就地脱敏，`sessions/` 除外）、D-3 删除 `--args`、D-4 退 64（论域按 §4 扩大）。审批即视为按推荐项执行；要改哪一项请在审批时说明。
