---
schema: trivium.disposition.v1
topic: M9-审核者启用与夹具收口
stage: plan
role: claude
kind: revised
run_id: 20260918T134236Z
addresses:
  - 2026-09-18-M9-审核者启用与夹具收口-codex.md
  - 2026-09-18-M9-审核者启用与夹具收口-gemini.md
  - 2026-09-18-M9-审核者启用与夹具收口-glm.md
---

# 计划修订（r1）：M9 第 4 步 · 配套六件 + Hook 语义 + 夹具收口

## 0. 裁决总览：12 个编号，接受 10 ｜ 驳回 2 ｜ 暂缓 0

三侧齐备（gemini 3、glm 7、codex 2 个兜底编号内含 7 条实质意见）。
verdict：gemini `approve-with-nits`、glm `approve-with-nits`、codex `request-changes`
（该侧 `parse_fallback: true`，**不参与阻断判定**——但它的内容是本轮最重的一条，见 §0.1）。

### 0.1 本轮的形状：**我测了一件事，把它当成了另一件事的证据**

CODEX-01（major）逐字打中计划的中心事实：

> §3 的「真实失败面 19 条」是**单变量实验**（只把 `registry.ts:136` 的 `criticEnabled` 改 true）
> 的结果，而那只是本步**第 5 步动作**的失败面。

**回原文核过，完全成立，而且三条用例我逐字对上了**：

`configurableVendors()`（`schemas.ts:96-113`）**从 schema 现取** `vendor` 判别式。
第 ⑦ 件给 `config.v2.json` 的 `agents.oneOf` 加 anthropic 分支之后：

| 用例 | 断言原文 | 加分支后为何红 |
| :--- | :--- | :--- |
| `config-schema.test.ts:150` | `assert.ok(pending.length > 0, '注册表里应当至少有一个形状未定义的 Agent（当前是 claude / codex）')` | `declared` 含 anthropic ⇒ `pending` 空集 |
| `config-migrate.test.ts:330-337` | `cfg.agents['claude'] = { vendor: 'anthropic' }`，断言报错含「形状尚未定义」 | `configurableVendors().has('anthropic')` 为 true ⇒ 那条 `continue` 分支不再触发 |
| `config-migrate.test.ts:340-348` | 断言未登记 id 的报错含 `/尚未定义/` | 该尾句只在 `pending.length > 0` 时拼出（`schemas.ts:165-172`） |

**我的方法段如实写了「只改 registry.ts:136」，但结论段把它称作「本步的真实失败面」**，
于是 §1.3 判据 1（`npm run check` 全绿）与 §7 的 V1 / V4 按现文都达不到。
更糟的是 §6 把第 ⑦ 件排在第 3 步、翻开关排在第 5 步——**实现时必然先撞上这三条，再回头改判据**。

这与 §9 我自己写的警示是同一个形状，只是换了一层：不是「引用了没读的原文」，
而是「**做了一次实验，却把它的适用范围悄悄扩大**」。本仓的记忆条目里就有这一条。

### 0.2 一处**三侧都没抓到、我自己复核时查出来**的失实断言

计划 §5.2 写：「`DEFAULT_CRITICS` 仍是 gemini / glm（`defaultSelected` 不翻）」。

**错的。** `registry.ts` 的 `defaultSelected: true` 有三处（`:188` codex、`:202` gemini、
`:216` glm），claude 在 `:137` 是 false。所以 `DEFAULT_CRITICS` = **codex、gemini、glm 三家**，
恰好等于 `DEFAULT_MAX_CRITICS = 3`。

**本次双审自己就是证据**：`--critics` 我传的是 resolve 解析出的三家，
三份文档落的就是 codex / gemini / glm。我一边看着三侧跑，一边在计划里写「缺省两家」。

§5.2 的**结论不变**（三家都非 Claude 系，AC-18 第一句继续成立；改锚到 `DEFAULT_CRITICS`
仍是加强），但这句成员描述必须改。glm 在「认为正确的部分」里写「`DEFAULT_CRITICS` 不含 claude」——
那句对，但它核的是不含谁，没核含谁。

**这条与 GLM-03 是同族**（见 §2.3），两条一起构成本轮的第二个形状：
**我对注册表当前状态的记忆是错的，而它就在我改过三遍的那个文件里。**

### 0.3 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | minor | 驳回 | 它核出的**事实**成立且有价值（另两家 bin 确有消费方），但**处置**与另两侧相反：glm 与 codex 独立核到同一组事实、得出「claude 侧不加」。核实：`codex.ts:312` 与 `:521` 均 `cfg.bin ?? probe.entrypoint`、`doctor.ts:474` 把 `agents.gemini.bin` 传进 `probeAgy`、`doctor.ts:493` 消费 glm 的 `entry`——**先例恰恰是「有消费方才登记」**。而 claude 侧 `doctor.ts` 给 `probeClaude` 传的第一个参数逐字是 `null`，适配器两处入口取值（`:680-681` / `:727-730`）都走 `probe.entrypoint`。「补齐消费接线」是**新增生产功能**，不属本步声称的「夹具收口」范围 | 事实并入 §4.2 的改写（见 CODEX-03）；接线诉求登记 BACKLOG，挂「本机入口覆盖」需求真出现时 |
| AGY-02 | gemini | minor | 接受 | 与 GLM-01 ≡ CODEX-02(b) 同一处。核 `schemas.ts:64` 与 `:122`：`validateConfig(data)` / `checkConfigAgents(data)` 都只收 data，注册表是模块级绑定，**手写 descriptors 到不了那条分支** | §2.2 |
| AGY-03 | gemini | nit | 接受 | 核 `critics.test.ts:195-200`：原用例遍历 `CRITICS` 验单元素合法性。改用 `SELECTABLE` 后 claude 从未作为单元素审核者被执行——**这正是第 5 步落 `--driver` 后要用的那条路径** | §2.4 |
| GLM-01 | glm | minor | 接受 | 与 AGY-02 同一处，且区分得更准：**第 19 条可行**（`validateRunMeta` 校形状、meta 对象本就手写）、**第 18 条不可行**。它给的两条出路比我原文具体 | §2.2 |
| GLM-02 | glm | minor | 接受 | 核实成立且**今天就已经漏了**：`hooks.ts:580` 的拒绝文案逐字写「审查文档的角色后缀（`-gemini.md` / `-glm.md`）」——codex 自 M8 起已在保护集内却不在这句里；`CLAUDE.md:12-15` 同样只列两家。我 §3.1 引用了 `CLAUDE.md` 那句矛盾，却没把改写它排进 §6 | §2.5 |
| GLM-03 | glm | nit | 接受 | **`assertDefaultsEnabled` 全仓零命中——那个函数名是我编的。** 真正的守卫是 `deriveDefaultCritics`（`registry.ts:299-320`）的两条不变量，其中不变量二正是 glm 说的「4 > 3」（见 §0.2：缺省集合现为三家） | §2.3，与 §0.2 合并 |
| GLM-04 | glm | nit | 接受 | 核实成立：按 §3.2 末句，`SELECTABLE` 会在 `critics.test.ts` 与 `topic-args.test.ts` 各立一份同义派生。**同一事实两处手写**正是本项目反对的形态 | §2.4 |
| GLM-05 | glm | nit | 接受 | 核 `critics.ts:32-35`：`legalList` 读的是模块级 `CRITICS`，签名只有 `cfg` 与 `driver`。注入手写注册表后报错文案仍按真实注册表列——与 `critics.ts` 自立的「第一个错误不得把用户引向第二个错误」口径相悖 | §2.2 |
| GLM-06 | glm | nit | 接受 | 核 PRD `:394-395`：AC-18 第二句要求可见的是「**覆盖后的模型**」，而 `model_effective` 本就落 run.json 与 front-matter。「false ⇒ `override_reason`」是 `run.v2.json:579-584` **description 的自我加强**，不是 PRD 原文。我把 schema 散文的约束力当成了需求约束力 | §2.6 |
| GLM-07 | glm | nit | 接受 | 核 `BACKLOG.md:141`：状态列已是 `done`、实质裁定与 `types.ts` 一致，但正文开头仍是登记期措辞「做不做，待裁定」「倾向」。先读 BACKLOG 的人会误读成未决 | §2.7 |
| CODEX-F01 | codex | —（兜底） | 驳回 | 非意见单元：它是模型在 JSON 前多写的一句引言「I have enough verified ground. Here is my review.」，**无任何技术主张可裁**。但它是本次 `parse_fallback` 的**直接成因**，另行登记 | 不改计划；登记 BACKLOG（见 §2.8） |
| CODEX-F02 | codex | —（兜底） | 接受 | 整块 JSON，内含 **7 条独立编号意见**（CODEX-01～07，2 major + 5 minor）。**不作为一条囫囵接受**——逐条裁决见 §1 | §1 逐条 |

**统计**：编号 **12** ｜ 接受 **10** ｜ 驳回 **2** ｜ 暂缓 **0**。
codex 内层 7 条另计：接受 **7**（其中 CODEX-02 有一个子论断被驳回，见 §1.2）。

> **两条驳回都不是「不同意事实」**：AGY-01 驳的是处置不是事实（事实已并入 §4.2 的改写），
> CODEX-F01 驳的是「它不是一条意见」。**没有一条实质技术主张被驳回。**

---

## 1. codex 侧 7 条实质意见的逐条裁决

### 1.1 CODEX-01（major）：**接受**——本轮最重的一条

见 §0.1。三条用例逐字核对成立。**落地方案见 §2.1。**

### 1.2 CODEX-02（major）：**主论断接受，一个子论断驳回**

**(a) 第 15 条漏列在「注入口无效」的例外名单里 —— 接受。**
核 `topic-args.ts:449-458`：那段 `for (const id of ALL_AGENT_IDS)` **直读模块级 `CRITICS`**，
不经 `resolveCriticSelection`，所以 §3.3 第 1 点的 descriptors 注入口对它同样无效。
我原文只把第 18 / 19 条列为例外，**漏了第 15 条**。

**(a) 附带的「该用例内部 `for (const c of CRITICS)` 子断言也要按 SELECTABLE 同改」—— 驳回。**
核 `topic-args.ts:455-456`：那条报错文案逐字是
`` `  当前可用：${CRITICS.join('、')}` ``——**不经 `legalList`**，因此**含 claude**，
`topic-args.test.ts:567-569` 的 `for (const c of CRITICS)` 子断言**能通过**，不需要改。
（会红的是同一用例 `:561` 那句 `driverSide` 取不到值，即成因 C。）
对照：第 16 条走的是 `resolveCriticSelection`（`topic-args.ts:328`），报错经 `legalList`
排除 Driver，**那条才需要按 SELECTABLE 改**——我原文的归类在这一点上是对的。

**(b) 「手写 descriptors 数组」造不出来 + 「本分支不可达」措辞不准 —— 接受。**
核 `schemas.ts:204-214`：`if (!CRITIC_AGENT_IDS.includes(id as never))` 这条分支
**对未登记 id（如 `nobody`）仍然可达**，四家全启用后不可达的只是
「**登记但未启用**」这一子情形。我原文写「本分支在真实注册表下不可达」说过头了。

### 1.3 CODEX-03（minor）：**接受**

与 AGY-01 核到同一组事实、与 glm 同一结论。裁定取 **(b)（不加 `bin`）**，
但**理由整条换掉**：不是「`bin` 与 `effort` 同构地零消费方」（那句对另两家是错的），
而是「**另三家的入口字段都有消费方；claude 的入口由 `probe.cli.claude.entrypoint` 独占**」。
并在 `config.v2.json` 的 anthropic 分支与 `ClaudeAgentConfig` 上写明
**这处形状不对称是刻意的**，免得后来者为「补齐」把死字段加回来。

### 1.4 CODEX-04（minor）：**接受，裁定由 ① 改为 ③**

它指出 §5.1 的紧迫性论证**与我自己的 §2.3 矛盾**：「翻开关后第一次真跑 claude，
`run.json` 会落一个自相矛盾的组合」在本步**不可能发生**——claude 要到第 5 步落 `--driver`
之后才可能入选。而且缺口不是翻开关带来的：`isHeterogeneous` 只看模型串（`base.ts:1669-1672`），
`--model-gemini claude-*` 今天就能落出同一个组合。

**核实成立，两处都对。** 我原计划选 ①（本步补写入方）的理由因此失效：
本步补的写入方**没有任何路径能端到端验证**（§7 的 V1～V7 也确实没有一行覆盖它）。

**改裁 ③**：(a)(b) 一并推到第 5 / 6 步，与 claude 真能入选的那一刻对齐。
同时按 GLM-06 把论证分两层（PRD AC-18 只背书「模型可见」，
「false ⇒ `override_reason`」按 `run.v2` description 的契约自洽性论证），
并把「同一缺口今天在 `--model-<side> claude-*` 上已存在」写进 BACKLOG，
让 AC-18 的收口挂到正确的里程碑。

### 1.5 CODEX-05（minor）：**接受**

核 `probes/claude.ts:56`：`const PROBE_MODEL = 'claude-haiku-4-5-20251001'`，
注释逐字「探能力不探质量，挑最便宜的一档」；REPORT_2026-09-17 §4 的括号逐字写着
「haiku 已由 M6 探针证过，作正对照，不重复烧」。

**所以我 §4.1 那句「只能用上表这两个回读过的值」是失实的**——回读过的是三个，
而我漏掉的正是最便宜的一档。后果具体：把 sonnet 同时写进 default 与 flash，
会让 **flash 档在 claude 侧退化成与 default 完全相同**，而另两家的 flash 行都不同。
我引用的「codex 侧 default/flash 相同」那条先例，其原文理由是
「deepseek 目录下只有 flash 与 v4-pro 两档」——**不能用来支持「有更便宜一档却不用」**。

### 1.6 CODEX-06（minor）：**接受**

核 `.trivium/bin/trivium`：`exec "/opt/homebrew/opt/node/bin/node" "/Users/chenzhenbo/.claude/skills/dual-critic/scripts/trivium.cjs" "$@"`；
核 `.claude/settings.json`：三条 Hook 的 command 统一走
`W="${CLAUDE_PROJECT_DIR}/.trivium/bin/trivium"; test -x "$W" && exec "$W" gate hook-pre-*`。

**Hook 跑的是全局已安装副本，不是工作树。** 所以 §6 那句
「第 1 / 2 步与第 5 步之间不得留过夜的中间态——中间态下本仓库的双审流水线是坏的」
**机制上不成立**：工作树怎么排都不会锁死 Driver，直到 `install:local` 那一刻才生效。

真正的不变量是：**Hook 语义修复与翻开关必须落在同一次 `install:local` 里**。
这恰是我自己那条记忆里的事实（wrapper 指向全局副本），**而我在 §6 里把它用反了**。

### 1.7 CODEX-07（minor）：**接受**

核 `doctor.ts:214-219`：
`const gate = (message) => ctx.enabled || ctx.asked ? { level: 'blocker', … } : { level: 'note', …（该侧尚未启用为审核者，故不阻断）}`，
而 `doctor.ts:551` 传的是 `enabled: agentByCliName('claude')?.criticEnabled === true`。

⇒ 翻开关后，claude 侧的「未找到可执行文件 / 入口不可用 / 读不出文件」**从 note 升成 blocker**，
且 `doctor` 默认探四家、**不看本次入选侧**，所以影响的是**每一个装了全局副本的项目**。
本机探针健康（`readonly_breach: false`、`headless_read_ok: true`），
**`npm run check` 无论如何都照不出这一格**。

---

## 2. 修订内容

### 2.1 §3 重写：失败面改为「第 ⑦ 件 + 翻开关」的合并清单（CODEX-01）

- §3 增一节 **§3.0「测量口径」**，写明：19 条是**单变量实验**（只翻开关）的结果，
  **不等于本步的失败面**；本步还含第 ⑦ 件，它自身独立打红三条。
- 新增 **§3.4「第 ⑦ 件自身会红的三条」**，逐条给断言原文与机理（表见 §0.1）。
- 这三条的处置一并写进 §4.2 的落点：`config-schema.test.ts:150` 与
  `config-migrate.test.ts:330 / :341` 三处的夹具前提（「至少有一家形状未定义」）
  在四家形状齐备后消失，与成因 C **同族**，按 §2.2 的口径处置；
  `schemas.ts:165-172` 与 `:180-183` 里「随 M8 / M9 / M10」的措辞同批更新。
- §1.3 判据 1 与 §7 的 V1 改为「与**合并后的清单**逐条对」；V4 补上这三条。
- **§6 的顺序不动**（第 ⑦ 件仍在第 3 步），但每一步补一行「本步预期会红哪几条」，
  让实现时的红/绿是预期内的。

### 2.2 §3.3 重写：成因 C 的例外名单补第 15 条，并二选一（AGY-02 ≡ GLM-01 ≡ CODEX-02b，+GLM-05）

1. **例外名单补第 15 条**，并写明它的机理（`topic-args.ts:449-458` 直读 `CRITICS`）；
   同时**写清它内部那条 `for (const c of CRITICS)` 子断言不需要改**及其理由（§1.2），
   免得实现时按 codex 的建议一并改掉，反而把一条本来正确的覆盖改错。
2. **第 18 / 19 条分开处置**（采 GLM-01 的区分）：
   - **第 19 条**：改成「遍历全部已登记 id 的形状断言」——比「找一个未启用的」更强，
     且不随注册表状态失效；
   - **第 18 条**：**明说放弃负例、只留自适应断言**，并登记 BACKLOG
     （触发条件：第五家未启用 Agent 引入，或 `checkConfigAgents` 因别的原因开出注入口时恢复）。
     **不在本步给 `schemas.ts` 开注入口**——那是校验层的生产改动，
     连带它自己的双审成本，超出「夹具收口」的范围（codex 与 glm 都点了这一层）。
3. **措辞改准**（CODEX-02b）：不写「本分支不可达」，写
   「**「登记但未启用」这一子情形**在四家全启用后不可达；该分支对未登记 id 仍然可达」。
4. **`legalList` 一并线程化**（GLM-05）：实现 descriptors 注入口时，
   `legalList` 从注入的 descriptors 派生可用清单。**不取「注明为可接受取舍」那条**——
   报错文案与论域不一致，正是 `critics.ts` 自己立规矩要防的形态。

### 2.3 §4 件表 ① 的论据改到真名（GLM-03），并改正 §5.2 的成员描述（§0.2）

- `assertDefaultsEnabled` 是我编的函数名，**全仓零命中**。改写为：
  「翻 `defaultSelected` 会被 `deriveDefaultCritics`（`registry.ts:311-317`）的
  **上限不变量**在模块加载期拦下——缺省集合将达 4 家，超过内置 `max_critics = 3`」。
- **§5.2 的「`DEFAULT_CRITICS` 仍是 gemini / glm」改为「codex、gemini、glm 三家」**，
  并补一句：**该集合已满 `DEFAULT_MAX_CRITICS = 3`**，这正是 §2.16 那条
  「四家启用后永远不能四侧并存」的同一处约束的另一面。
- §5.2 的结论（改锚到 `DEFAULT_CRITICS` 是加强）**不变**，但要写明改锚后遍历三家，
  `routeModel(cfg, 'codex', stage)` 有值（`profiles` 三档齐备）。

### 2.4 §3.2 的 `SELECTABLE`：移入共享 helper，并补 claude 单选覆盖（GLM-04 + AGY-03）

- 夹具**一处定义**（`test/helpers/` 下），两个测试文件导入；语义、
  「改夹具而不是改用例」的约定、`SELECTABLE.length >= 2` 自适应断言**与定义同处**。
- **补一条用例**（AGY-03）：显式传 `driver: 'gemini'`（或任一非 claude 值），
  断言 `--critics claude` **单选成功**。它闭合的正是第 5 步 `--driver` 落地后要走的路径——
  **今天就该有，否则第 5 步分不清「新做对了」与「本来就对」**，与 V6 负例互为正反两面。

### 2.5 §6 增一步：两处人读枚举与机器判据同批更新（GLM-02）

并入第 1 步（Hook 语义改动）：

- `hooks.ts:580` 的拒绝文案：枚举补全，或改为按注册表派生的表述
  （**今天就已漏 `-codex.md`**，不是本步引入，但本步是碰它的正当时机）；
- 仓库根 `CLAUDE.md:12-15` 那两句按新判据语义改写
  （如「除当轮 Driver 外的全部已登记角色后缀」），消除翻开关当日开始的自我矛盾。

> 与 §2.1 作废的那件**不是同一件**：那件是第 ⑤ 件的片段注入（EV-44 已裁定不做），
> 这件是 Hook 保护集的人读描述。glm 特意点明了这个区分，是对的。

### 2.6 §5.1 改裁 ③，论证分两层（CODEX-04 + GLM-06）

- **裁定由 ① 改为 ③**：`override_reason` 的写入方与 `run.v2` 的机器判据
  **一并推到第 5 / 6 步**，与 claude 真能入选的那一刻对齐。理由见 §1.4。
- **论证分两层**：PRD AC-18 只背书「覆盖后的模型可见」（`model_effective` 已满足）；
  「`heterogeneous: false` ⇒ 必须有 `override_reason`」按 `run.v2.json` description 的
  **契约自洽性**论证，不挂 PRD 名下。
- **BACKLOG 新条目**：记明「同一缺口今天在 `--model-<side> claude-*` 上已存在」，
  把 AC-18 的这一格挂到正确的里程碑。

### 2.7 §4.1 的模型取值重裁（CODEX-05）

候选集补上 `claude-haiku-4-5-20251001`（`probes/claude.ts:56`，M6 已回读证过）。
**`profiles.flash.claude` 单独裁定**，二选一并写明依据：

- **取 haiku**（我的倾向）：flash 档名副其实，与另两家一致；
  边界写明「回读在 2.1.273 / 2.1.276 上取得、**审查尺度未测**」；
- 或明说 claude 侧 flash 与 default 有意相同及其原因。

无论哪种，**「真实审查尺度的成本仍未测」这句话要挂在取值旁**，
避免下一轮把「未测」读成「已定」——这正是本主题反复交代过的形状。

### 2.8 §6 的危险点改到正确的对象（CODEX-06），并补 doctor 验证行（CODEX-07）

- §6 那句「不得留过夜的中间态」**降级为偏好**，真正的不变量改写为：
  「**Hook 语义修复与 `criticEnabled` 翻转必须落在同一次 `npm run install:local` 里**；
  install 之前工作树怎么排都不会锁死 Driver（Hook 走的是全局已安装副本）。」
- **§7 补 V8**：翻开关并装到全局副本之后跑一次全量 `trivium doctor`，
  记录退出码与 blockers 清单，**与翻之前的同一次输出对照**；
  并把「claude 侧诊断档位随 `criticEnabled` 从 note 升为 blocker」
  写进 §4 件表 ① 的行为变化说明——它是「改一行、每个人每次都感觉得到」的那类变化。
- **BACKLOG 新条目**（CODEX-F01 的落点）：`parse_fallback` 的成因是模型在 JSON 前
  多写了一句引言。本轮 codex 侧 7 条实质意见（含 2 条 major、1 条改写了计划中心事实）
  塌缩成两个兜底编号，**若不是我逐条读原文就会整体失效**。
  与 EV-10 同族但成因不同（EV-10 是多带 front-matter 字段，这次是 JSON 前导文本），
  登记为独立条目，修法方向：解析器容忍 ```json 代码块前的自然语言前缀。

---

## 3. 三个焦点的答案

**焦点一：19 条的三类成因划分成不成立？`SELECTABLE` 该不该付那个代价？**

- **分类三侧一致判成立，无一条归错**（gemini、glm、codex 各自逐条机械复核）。
  但**清单本身不完整**——CODEX-01 补出第 ⑦ 件独立打红的三条（§0.1）。
  **分类对，论域小了。**
- **`SELECTABLE` 采纳**。三侧都支持，glm 给的理由最完整：自述盲区已有三重独立锚
  （`critics.test.ts:104-122` 两条既有 Driver 负例、V6 负例、`length >= 2` 自适应断言），
  而备选的硬写 `['codex','gemini','glm']` 恰是 `registry-parity` 明确反对的第二事实源。
  **叠加两项修正**：移入共享 helper（GLM-04）、补 claude 单选正例（AGY-03）。

**焦点二：`bin` 加不加？**

**不加（取 (b)），但我原来的理由是错的。** 三侧独立核出同一组事实：
另三家的入口字段**都有消费方**，所以「照先例」的先例是「有消费方才登记」。
正确理由：**claude 的入口由探针独占**。gemini 主张「保留并补齐接线」被驳回——
那是新增生产功能，不属本步范围；诉求登记 BACKLOG。

**焦点三：`override_reason` 做到哪一格？V7 逐腿核过没有？**

- **改裁 ③（推到第 5 / 6 步）**，不是我原来倾向的 ①。理由是 CODEX-04 指出的
  自相矛盾：本步 claude 一次也选不上，补的写入方**无路径可验**。
- **V7 三侧独立逐腿核过，结论比我的观测更强**：codex 给了最细的一份
  （`:150` 对账自洽、`:160/:169/:176` 走 `ALL_AGENT_IDS`、`:270/:308` 查字面量、
  `:505/:568` 扫 `src/`、`:728/:766/:865` 扫静态 schema、其余与注册表布尔无关），
  唯一可能受影响的镜头键腿因 `lenses.yaml:65` 已有 `claude:` 顶层键而保持绿。
  **我的「只红一条」观测成立，且现在有了逐腿的依据。**

---

## 4. 仍然成立、本次不动的部分

- **§3.1 成因 A 的诊断与处置**（三侧一致核过）：两处派生点、两个消费者、
  「今天行为逐字不变」、跨时间不对称如实登记、识别集 ⊇ 保护集的不等式用例。
  codex 另补一条正面论据：**若把提交锚也改成全集，Driver 自己的 `-claude.md` 连提交都会被拦。**
- **§2.1 EV-44 的转述**：glm 与 codex 都回了 `BACKLOG.md:141` 原文，
  确认与 `types.ts` 实质一致（GLM-07 只指出正文开头措辞未与 `done` 状态对齐）。
  **我 §9 自陈「读的是第 3 步自己写的文本」这个担心，两侧都替我核掉了。**
- **§2.3 的四个调用点**、**§4 件表的现状陈述**、**§6 的步骤顺序**、
  **V1～V7 的可测性**、**§4.2 的 profiles 不需动 schema**（codex 核过）。
- **翻开关本身成本中性且可回滚**（codex）：`defaultSelected` 不翻 ⇒ 缺省集合不变，
  预检与模型路由都不被卷入，回退是注册表三行 + 一次安装。

---

## 5. 一条要带走的

本轮三个形状，**没有一个是「方案错了」**：

1. **我做了一次单变量实验，却把结论的适用范围扩大到整步**（§0.1）；
2. **我引用了一个不存在的函数名**（GLM-03）——`assertDefaultsEnabled` 是编的；
3. **我对注册表当前状态的记忆是错的**（§0.2）——`DEFAULT_CRITICS` 是三家不是两家，
   而本次双审跑的就是那三家，**证据在我眼前跑了 14 分钟**。

三条的共同形状：**断言的对象我都碰过**，`registry.ts` 我这一步要改三行、
那个实验是我自己跑的、那三侧是我自己启动的。**不是没读原文，是以为不必再读。**

本仓的记忆里已有一条「别把断言的适用范围悄悄扩大」——第 1 条正是它的原样复发。
写进计划 §9 的提醒清单，措辞要换（上一轮的措辞我自己已经免疫了）：
**凡是写「实测」二字的地方，句子里必须同时写明「变的是哪一个量」。**
