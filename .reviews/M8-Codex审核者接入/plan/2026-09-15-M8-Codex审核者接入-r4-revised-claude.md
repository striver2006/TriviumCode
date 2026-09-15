---
schema: trivium.disposition.v1
topic: M8-Codex审核者接入
stage: plan
role: claude
kind: revised
run_id: 20260915T135556Z
addresses:
  - 2026-09-15-M8-Codex审核者接入-r4-gemini.md
  - 2026-09-15-M8-Codex审核者接入-r4-glm.md
---

# 计划修订（r4）：M8 第 3 步 · codex 接入为审核者

## 0. 裁决总览

**17 条全部接受，零驳回**（gemini 6 条：1 阻断 + 3 重要 + 2 次要；glm 11 条：6 重要 + 5 次要）。
两侧均判 `request-changes`，且**在最危险的那一条上独立收敛**。

**四对独立收敛**：AGY-01 ≡ GLM-01（写动词表误用）、AGY-03 ≡ GLM-06（preflight 厂商分支该泛化）、
AGY-02 ≡ GLM-08（`~` 重写的边界与顺序）、AGY-04 ≡ GLM-05（配置契约与 profile 来源留白）。

### 0.1 本轮的硬伤：一个正确的理由，用在了错误的地方

§3.3 我写「写动词的识别复用措施 b 已有的资产（`WRITE_VERB_TARGET` 那张表的动词集），
**不新起一张表**——两张表会漂移」。

打开那张表（`adapters/base.ts:274-292`）只要二十行，注释自己把键集分成三族：

```
// 写入点：目标位是被写的文件        cp / mv / install / tee
// 目录目标：参数是目录，不是被读的文件   cd / mkdir / rmdir / touch / pushd
// 非读取动词：参数位既不读也不是目录     rm / chmod / chown
```

`cd` 与 `pushd` **不发生任何写系统调用**，在只读沙箱下恒成功退 0。
按我写的判据，审查员第一条 `cd src/trivium && grep -rn …` 就会进 `write_events`，
而 `guard.ts:136` 是 `write_events.length > 0` 即 `readonlyBreach`、**无分级**——
整侧以「只读失守」作废。这不是边缘情形，是**几乎必然触发**。

**「防漂移」这个理由本身没错，错在前提**：防漂移的前提是两张表**语义相同**。
而它们语义根本不同——一张回答「这个参数位算不算读证据」，另一张要回答「这是不是写操作」。
同一个键集在两个语义下的正确内容不一样，共用它不是防漂移，是**把一个答案当成另一个问题的答案**。

**这是 r3 那条教训的第二次**。r3 裁决 §0.1 写的是「引用一个已有机制作为新口径的依据前，
先读它的实现与文档块」。这一轮我引用的是一张**表的键集**——比 r3 那次更容易核实
（二十行，键名直接摆在眼前），却照样没打开。

所以把那条纪律再推一格，且这次带可执行动作：
**凡写下「复用 X」，必须在同一句里写出 X 的完整取值或键集**。
写不出来就说明没打开过；写出来了，`cd` 就藏不住。

### 0.2 一处需要说明的：本轮范围会因此变大

AGY-03 ≡ GLM-06 与 GLM-04 合起来，要求把 `preflight.ts` 的**三处**厂商分派收敛掉
（只读能力判据、探活编排、模型目录校验）。我接受，并如实说明代价：

**本步从「接一家」变成「接一家 + 清三笔 preflight 泛化欠账」**，工作量与回归面都变大，
既有两家的预检行为会被碰到（S5 的回归压力上升）。

但两侧独立指到同一处，而且 GLM-06 用的是**我自己在 §3.2 立的标准**打我：
「若本步发现判定层仍需为 codex 改动，那是第 2 步泛化不彻底的证据，要如实记，不要顺手改」——
这一条正是该如实记的证据，我却把它写进了「固有成本」表。**固有成本与没做的泛化，
区别在于有没有现成的泛化路径**；`CriticAdapter.availability()` 契约已经在库里（`base.ts:61-68`），
路径是现成的，那就不是固有成本。

---

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | 阻断 | 接受 | 核实为真且是必然触发：`base.ts:274-292` 的键集含 `cd`/`pushd`（注释自证是「目录目标」族），只读沙箱下恒成功退 0；`guard.ts:136` 无分级，误报即整侧作废。`/dev/null` 与工作区外边界同样被我忽略 | §2.1 §3.3 整节重写 |
| AGY-02 | gemini | 重要 | 接受 | 核实为真：`package.json` 只有 ajv 与 yaml，**无 TOML 解析库**，而我写的「扫描并重写」没给解析与拷贝的安全规范；目录/不存在路径会 EISDIR/ENOENT | §2.3 §3.4 补顺序、stat 校验与重写算法 |
| AGY-03 | gemini | 重要 | 接受 | 与 GLM-06 独立收敛。泛化路径现成（`availability()` 契约在 `base.ts:61-68`），我把它写成「固有成本」是判错了性质（§0.2） | §2.4 preflight 三处收敛 |
| AGY-04 | gemini | 重要 | 接受 | 核实为真：`config.v2.json` 既有两支都有严格 required 与判别式，而我只写「加 `CodexCriticConfig`」没给字段；`CriticRequest`（`types.ts:854+`）无 profile 字段，`-p` 的取值链路确实断着 | §2.5 定义字段集与 profile 单一来源 |
| AGY-05 | gemini | 次要 | 接受 | 核实为真：§6.1 六条用例全在 `test/unit/`，而 S2/S3 是 CLI 全链路判据。M7b 第 5 步的教训（`--critics` 调用链零覆盖、全量 873 条测试无一变红）正是这个形状 | §2.7 补集成用例 |
| AGY-06 | gemini | 次要 | 接受 | 两点均成立：stdin 传 BRIEF 我只读了 `--help` 没实跑；profile 级 catalog 覆盖有仓库旁证（`probes/codex.ts:800-824` 的 `readCatalogPath` 就是为此写的），我的拷贝口径只提了一份 | §2.6 U 表补 U6/U7 |
| GLM-01 | glm | 重要 | 接受 | 与 AGY-01 独立收敛，且多给两族反例：`mkdir -p <已存在>` 与 `rm -f <不存在>` 按 POSIX 退 0（幂等空操作）、`touch x \|\| true` 与 `;` 掩码让整条命令的 exit 0 与写段成功脱钩。「误报面极小」的结论不成立 | §2.1 |
| GLM-02 | glm | 重要 | 接受 | 核实为真且难堪：§3.3 自己写了「两种错法代价不对称、误判成写 ⇒ 整侧作废」，而 §6 的四条变异**没有一条守误报方向**——代价更高的那一侧零覆盖 | §2.2 补负断言与第五条变异 |
| GLM-03 | glm | 重要 | 接受 | 核实为真：`probes/codex.ts:637-652` 的负对照唯一形态是「在当前目录创建 breach.txt」，`/tmp`、`$TMPDIR` 从未探过；且「项目外写入算不算失守」我在 §9.1 提了问题却没裁决 | §2.1（裁决口径）+ §2.6（并进 U1 实测） |
| GLM-04 | glm | 重要 | 接受 | 核实为真：`preflight.ts:349-376` 只有 antigravity / zcode 两分支，兜底文案「厂商 X 没有模型目录探针」对 codex **失实**——`CodexProbe` 继承 `CommonProbe.models`，目录字段存在只是没人消费 | §2.4 |
| GLM-05 | glm | 重要 | 接受 | 与 AGY-04 独立收敛且更进一层：`-p` 取值来源与「模型→家族」解析是**两处共用一份没写的映射**，而 `unknown_profile_rejected=false` 意味着映射错一次就是静默回落 | §2.5 家族由 profile 决定 |
| GLM-06 | glm | 重要 | 接受 | 与 AGY-03 收敛，且指出同一事实**已经分叉**：`preflight.ts:379-400` 不查 `--disallowed-tools` 硬前置，而 `zcode.ts:199-218` 查——preflight 版是弱化版 | §2.4 |
| GLM-07 | glm | 次要 | 接受 | 核实为真且是我自己两套口径：`~` 重写我写了「命中项逐条留痕」，剥离键却不留痕。白名单方向对，但「静默丢功能」没有可见性兜底 | §2.3 剥离同口径留痕 |
| GLM-08 | glm | 次要 | 接受 | 与 AGY-02 收敛。顺序只由步骤编号暗示、没写成硬性规定；先重写后裁剪会把 `notify` 这类已剥段指向的文件也拷进副本，白扩敏感面 | §2.3 写死三步顺序 |
| GLM-09 | glm | 次要 | 接受 | 核实为真：`LITERAL_ALLOWLIST` 无 `secrets.ts`，而 `probes/codex.ts` 那条豁免的理由**原文预言了这次撞名**（cliName == AgentId）。`zcode-api-key` 不命中是因为 'zcode' 是 cliName | §2.8 规则按凭据形态命名 |
| GLM-10 | glm | 次要 | 接受 | 核实为真：三条与既有两侧字面重合（`lenses.yaml:10-14` 的「回滚路径」、`:16-19` 的「谁会被打断」、`:36-40` 的「环境」）。Jaccard 是「长期 > 0.8」才提示，一两轮看不出 | §2.9 三条收窄 |
| GLM-11 | glm | 次要 | 接受 | 核实为真：S4 只写了「怎么验」没钉机器判据，而 F-3 用的是三家字面量 grep——换台机器换一批 skill 就测不出泄漏 | §2.10 判据改结构性 |

---

## 2. 逐项处置

### 2.1 §3.3 整节重写：写动词判据、掩码、项目内外（AGY-01 ≡ GLM-01，含 GLM-03 的口径裁决）

**① 独立定义写动词闭集，不复用那张表。**

```
W = { cp, mv, install, tee, ln, rm, rmdir, truncate, dd, chmod, chown, touch, mkdir }
剔除：cd, pushd（纯目录切换，无写系统调用）
```

两张表的关系写进注释：`WRITE_VERB_TARGET` 回答「参数位算不算读证据」，
`W` 回答「这是不是写操作」，**语义不同故不共用**；由一条对账用例守着
「`cd`/`pushd` 在 `WRITE_VERB_TARGET` 中而不在 `W` 中」，防止后来者再合并一次。

**② 按段拆分，不对整条命令归因。** 命令先按 `&&` / `||` / `;` / `|` 切段，
逐段判动词与目标；**整条命令的 `exit 0` 不用于任何一段的成功判定**。
含掩码结构（`|| true`、`; true`）时，写段的成功与否**判不出**——归入 ③ 的疑似档。

**③ 判定改两档，写事件只收高置信形态。**

| 档 | 条件 | 后果 |
| :--- | :--- | :--- |
| **写事件**（`write_events`） | 写动词 ∈ W，**且**目标路径归一后落在 `project_root` 内，**且**该段无掩码结构，**且**整条命令 `status: completed` | 进 `readonlyBreach`（`guard.ts:136` 不改） |
| **疑似**（新增 `suspected_write_events`） | 命中写动词但目标判不出 / 目标在项目外 / 段含掩码 / 幂等形态（`mkdir -p`、`rm -f`） | **不**触发失守，进运行元数据与 doctor 输出，人读可见 |

`/dev/null`、`/dev/stderr`、`/dev/stdout` 等设备路径**不算目标**（既不在项目内，也不该进疑似）。

**④ 「项目外写入算不算失守」——本步裁决：不算，但进疑似档。**

理由不是宽松，是**自洽性**：codex 每次运行都会往 `$CODEX_HOME/sessions/` 写会话文件，
而 F-1 的模型回读**正是靠读那个文件**。若项目外写入算失守，那么
「本步赖以回读生效模型的那次写入」自己就会把每一轮都判成失守——判据与它依赖的机制自相矛盾。

只读承诺的保护对象是**被审项目与归档留痕**，不是「该进程一个字节都不许写」。
项目外写入仍值得留痕（可能是把被审代码外泄到 `/tmp` 的前兆），故进疑似档而非丢弃。

> `suspected_write_events` 是 `CriticResult` 的**增补字段**，不改 `judgeSide` 的判定语义，
> 与 §3.2「本步不动判定层」不冲突：判定层读的仍是 `write_events`。
> 但它确实是一处契约改动（`types.ts` + `run.v2` schema），如实计入 §5.2 的套件外清单。

### 2.2 §6 补误报方向的用例与变异（GLM-02）

§6.1 的 `codex-trace` 行补**负断言**：下列形态**不得**产生 `write_events`——

`cd src && grep -rn x .`｜`mkdir -p <已存在>`｜`rm -f <不存在>`｜`touch x || true`｜
`find . 2>/dev/null`｜`grep x y > /dev/null`｜`cp a /tmp/b`（项目外，落疑似档）

§6.2 变异表补第五条：**M5 · 把 `cd` 加进写动词集 `W` ⇒ 上述负断言必须变红**，
与 M1～M4 同等对待。

### 2.3 §3.4 隔离：写死顺序、加安全校验、剥离同口径留痕（AGY-02 ≡ GLM-08，含 GLM-07）

**顺序写成硬性规定：裁剪 → 重写 → 拷贝。** 先裁剪保证重写只作用于**白名单幸存键**——
否则 `notify` 这类已剥段指向的文件会被一并拷进副本，白扩敏感面。

**重写算法规范**（无外部 TOML 库，`package.json` 只有 ajv + yaml）：
按行正则处理**字符串标量值**，判据是「值为字符串且以 `~/` 开头」；
数组、内联表、多行字符串**不处理并逐条留痕**（说明「本键含非标量值，未重写」），
不做半吊子解析——解析不完整比不解析更危险。

**拷贝前 `stat` 校验**：仅对**真实存在且为普通文件**的目标执行拷贝；
目录、不存在、符号链接逐条留痕跳过，不抛异常中断整次运行。

**剥离键/段逐条留痕**，与 `~` 重写同一套口径（GLM-07）：副本丢弃了哪些键，
进运行元数据，`doctor` 与 S4 可点名。白名单「静默丢功能」的取舍由此变成**有痕丢功能**。

**拷贝物清单进留痕**，J9 的扫描面覆盖**副本内全部文件**，不枚举形态（GLM-08 第②点）。

**`model_catalog_json` 扫两份 toml**（AGY-06）：基底 `config.toml` 与
`<profile>.config.toml` 都要处理——`probes/codex.ts:800-824` 的 `readCatalogPath`
就是为「profile 文件层也能设这个键」写的，我的口径只提了一份。

### 2.4 §5.2 preflight 三处收敛（AGY-03 ≡ GLM-06，含 GLM-04）

从「固有成本」表里**移出**，改为本步的泛化工作：

| 处 | 现状 | 本步改法 |
| :--- | :--- | :--- |
| `checkReadonlyCapability`（`preflight.ts:379-400`） | 写死 zcode `readonly_flags` + agy `agent.md` 路径，且**弱于**适配器自身判据 | 改为遍历 `realAdapters()` 调 `availability()`；厂商专属判据回到各适配器（消除已存在的分叉） |
| 探活（`preflight.ts:455-560`） | `probeAgyAuth` / `probeZcodeAuth` 两个写死分支 | `CriticAdapter` 增可选 `authProbe?(ctx)`，preflight 按入选集合遍历调用 |
| `checkModelAgainstCatalog`（`preflight.ts:349-376`） | antigravity / zcode 两分支，其余落 `unverifiable`，**文案对 codex 失实** | 改为通用：按 `cliName` 取 `CommonProbe.models`；zcode 的短名补全移入 zcode 适配器（可选 `normalizeModelForCatalog?()`）。兜底文案同步修正 |

**代价如实说**：这会碰既有两家的预检行为面，S5 的回归压力上升。
收益是三处厂商分派清零，且**当场消除一处已分叉的判据**（preflight 版不查
`--disallowed-tools` 硬前置，而 `zcode.ts:199-218` 查——同一事实两个答案）。

§5.2 的「套件外」表相应缩小，只剩 `doctor.ts`（能力对账）、`base.ts`（新增能力常量与
`suspected_write_events` 契约）、`secrets.ts`（J9）。第 4 步回填 §5.1.1 与 EV-05 时按此为据。

### 2.5 配置契约与 profile 单一来源（AGY-04 ≡ GLM-05）

**`CodexCriticConfig` 字段集**（进 `types.ts` 与 `config.v2.json` 的 oneOf）：

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `vendor` | `const 'openai'` | 可辨识联合的形状判别式（纪律 12 的唯一例外，必须留） |
| `bin` | `string \| null` | 入口覆盖，同 `agents.gemini.bin` |
| `profile` | `string \| null` | **厂商 profile（R-6 的落点）**，`-p` 的唯一来源 |
| `effort` | `{plan,code,bug}` | 思考等级，进 `-c model_reasoning_effort=` |

`defaultConfig().agents.codex` 给出对应默认值；`profiles.{default,flash}.codex` 只给模型 slug。

**「家族」的唯一判定规则：家族由 profile 决定，不由模型 slug 猜。**

依据是本次 F-1 实测：`model_provider` 随 `-p` 走（`qwen` / `deepseek` 两组互可区分）。
于是：`agents.codex.profile` → 探针 `providers` 记录的该 profile 对应 provider → 家族。
§3.5 的「本次模型所属家族」改写为「**本次 profile 对应的 provider 家族**」，
`-p` 的取值与家族判定**共用这一条规则**，不留第二份映射。

按 slug 前缀猜家族的做法**明确否决**：目录命名会漂移，而 `unknown_profile_rejected=false`
意味着猜错一次就是静默回落基底——恰是 §3.5 自己要防的事故。

### 2.6 §8 自查表补四行（AGY-06、GLM-03、GLM-05 与我自己补的一条）

| # | 未证实的断言 | 何时验 |
| :--- | :--- | :--- |
| U6 | `codex exec -` 经 stdin 接收几十 KB BRIEF 能正常 EOF 并触发执行 | **并进 U1 那次开工实测**（零配额可测：给一个长 stdin 看是否起跑） |
| U7 | profile 级 `model_catalog_json` 覆盖下，两份 toml 的重写与拷贝都正确 | 同上 |
| U8 | 只读沙箱对 `/tmp`、`$TMPDIR` 是否拒写（负对照只覆盖 cwd） | **并进 U1 实测**，同一次 exec 带一条 `/tmp` 写探针，近零额外配额 |
| U9 | profile 与 `-m` 跨家族时家族判定仍正确（如 `-p qwen -m deepseek-flash`） | 同上；本条是我自己补的——§2.5 把家族钉在 profile 上，而 `-m` 能跨家族指模型，两者不一致时的行为没验过 |

U1（隔离副本下会话文件是否仍落在 `$CODEX_HOME/sessions`）仍是唯一会**推翻方案**的一条，
U6～U9 属**会让方案返工**的层级——这个分层沿用 glm 的判断。

### 2.7 §6.1 补集成测试（AGY-05）

新增 `test/integration/codex-wiring.test.ts`，走**真实子进程**：
`doctor --only codex` 给出确定结论、`review --start --critics codex,glm` 的入选集合
如实记入运行元数据、拼错 profile 退 64 且零工件。

理由用 M7b 第 5 步的原案：那次把 `opts.critics ?? …` 改成永远取默认值（模拟接线漏传），
**全量 873 条测试无一变红**——参数透传只有真实子进程测得出。

### 2.8 J9 的规则命名（GLM-09）

`secrets.ts` 的新规则**按凭据形态命名**（如 `toml-bearer-token`、`toml-provider-key`），
避开 `codex` 这个字面——它恰好既是 cliName 又是 AgentId，会命中 `registry-parity` 的扫描。
`zcode-api-key` 现状不命中是因为 'zcode' 是 cliName（AgentId 是 `glm`），codex 没有这个侥幸。

若实现中发现确实避不开，则如实新增 `LITERAL_ALLOWLIST` 豁免并写明理由，
**计入第 4 步的 FR-31 反证**，不静默加。

> J9 确非伪需求，有旁证：`secrets.ts:93` 的 `generic-secret-assignment` 要求
> `\b(?:…|token|…)\b`，而 `experimental_bearer_token` 里 `token` 前面是 `_`（word 字符），
> **词边界不成立**——现有兜底规则扫不到本机这种凭据形态。

### 2.9 §5.3 镜头三条收窄（GLM-10）

| 阶段 | 原提议（重合） | 改为 |
| :--- | :--- | :--- |
| plan | 可回滚性 ↔ gemini「迁移方案、回滚路径」 | **回滚与迁移的成本核算**（时间、配额、人工步数） |
| code | 对既有调用方的兼容性 ↔ gemini「谁会被这次改动打断」 | **运行环境与依赖版本兼容**（Node 版本、平台、CLI 版本漂移） |
| bug | 干净环境复现 ↔ glm「复现是否充分：步骤、环境」 | **时序与环境变量态的影响**（并发、时钟、locale、env 泄漏） |

与 A/B 两侧保持零字面交叠；U4 的事后 Jaccard 观测保留为兜底，不作为唯一手段。

### 2.10 S4 的机器判据改为结构性（GLM-11）

判据钉死为：渲染输出的 skill roots **恰为** `[<副本>/skills/.system]`、MCP 工具段为空。
字面量 grep（`deliver` / `autoglm` / `node_repl`）降级为辅助断言——
它只能证明「这三家不在」，换台机器就测不出泄漏。

---

## 3. 修订后的范围变化（一句话）

本步从「接一家（②③④⑥⑦ + J2 + J8）」变为
「**接一家 + 清三笔 preflight 泛化欠账 + 一处证据契约增补（`suspected_write_events`）**」。
工作量与回归面都变大，代价已在 §0.2 与 §2.4 写明；不做的代价是第三次堆砌厂商分支，
以及一个几乎必然触发的误报把整侧作废。

## 4. 三个决策的状态

D-1（默认侧数）、D-2（`Critic-C`）、D-3（J9 前移）**两侧均判理由成立**，
glm 另给了 D-3 的实锤旁证（§2.8 末段）与 D-1 的补充论据（config 值是用户面数据，
不属纪律 10 的模块字面量管辖）。三条**待用户在审批环节拍板**，本件不代为裁定。
