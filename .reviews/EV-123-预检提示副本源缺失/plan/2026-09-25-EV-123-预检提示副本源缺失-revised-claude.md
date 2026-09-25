---
schema: trivium.disposition.v1
topic: EV-123-预检提示副本源缺失
stage: plan
role: claude
kind: revised
run_id: 20260924T230522Z
addresses:
  - CODEX-F01
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
---

# 裁决：EV-123（预检提示副本源缺失）· 计划双审第 1 轮

> 被审对象：`2026-09-25-EV-123-预检提示副本源缺失-claude.md`（r1）
> ｜ 运行：`20260924T230522Z`（7m44s）
> ｜ 结论：codex `approve-with-nits`（**解析回退**：编排器切出 1 个意见单元 CODEX-F01，即 codex 的原文 JSON，完整可读，内含 8 条具名意见 CODEX-01～08）｜ gemini `approve-with-nits` ｜ glm `request-changes`
> ｜ 闸门单元 11 个：CODEX-F01 + AGY-01～04 + GLM-01～06。按具名意见计共 18 条：重要 2 ｜ 次要 11 ｜ 吹毛求疵 5 ｜ 零阻断
> ｜ **11 个单元全部接受**；CODEX-F01 内的 8 条逐条裁决见 §1.1，也全部接受。同指五组：CODEX-01 ≡ GLM-02（判侧落点）；CODEX-02 ≈ GLM-01（预检的选侧、时点都不等于拉起时）；CODEX-03 ≡ AGY-01 ≈ GLM-04（收尾兜底有前提）；CODEX-04 ≡ AGY-04 ≈ AGY-02（JSON 那一层没人测）；CODEX-05 ≈ GLM-06（HOME 与注入口）

## 0. 本轮的形状：用户的五个焦点

- **焦点一 D1（适配器导出路径、预检导入）**：**方向保留，形态要改。** gemini 认为按 r1 的写法站得住；codex 与 glm 独立指出同一个缺口（CODEX-01、GLM-02）：r1 只定了「路径字面住在哪」，没定「预检怎么知道哪一侧是 zcode」。C5 不需要判侧，因为它靠探针数据的形状自然定向；新检查要主动去查一个 ZCode 特有的文件，必须有显式判据。于是实现者只剩两条路：在 preflight 里写 `'zcode'` 字面量（parity 扫描抓不到它，会静默不红），或者按适配器能力判侧——后者其实就是 (b) 的轻量形态。r1 否决 (b) 的理由「只有一个调用方」也与事实不符：preflight 本来就在消费四个逐侧可选钩子（`base.ts:89-132`）。我复核后采信 codex 与 glm。r2 取 GLM-02 给的中间形态 **(a′)**：唯一出处仍是适配器导出的函数；`CriticAdapter` 加一个可选成员 `modelOverrideSource?()`，preflight 遍历入选侧，按这个能力判侧。不开完整的 `preflightAdvisories` 钩子，提示措辞仍由 preflight 统一写。
- **焦点二 D2（不在 `--start` 再报一次）**：**三侧意见分歧，我采纳 glm，r2 翻转为在 `--start` 复用同一个检查函数。** codex 与 gemini 都认为不在 `--start` 复报站得住；codex 同时指出预检的选侧不等于当轮的选侧（CODEX-02），也指出收尾兜底有前提（CODEX-03）。glm 判重要（GLM-01）。促使我翻转的是两个我复核属实的事实：
  ① 「`--start` 紧接在预检之后」对命令 A 不成立：S0 预检与 S2 `--start` 之间隔着 S1 起草，窗口以分钟计（GLM-01）；
  ② 预检的选侧不等于当轮的选侧：skill 第 1 步不传 `--critics`，预检按缺省集合查。当轮用 `--critics` 选了缺省集合以外的侧时，新检查根本不出项（CODEX-02；PROTOCOL :341 写明这一格本就由 `--start` 兜）。这一半只有在 `--start` 查才能补上。
  r1 说的「两处判定分叉」在复用同一个函数时不成立，而且有现成先例：`checkModelSlugs` 就是预检与 `--start`（`review.ts:581`）各调一次，那段注释写着「这里才是真正决定烧不烧配额的地方」。收尾播报也不是无条件兜底，它要求回读到生效模型（CODEX-03、AGY-01、GLM-04），这个前提写进 r2。
  **需要你知道的边界**：`--start` 在派生工作进程之后才返回，所以这条警告是在「已拉起」后念出来的。它的价值在于开场播报时就能看到、可以立即 `--cancel`，代价是几秒而不是一整轮。它不能在拉起之前拦住。要在拉起前拦，只能拒跑（EV-122 的候选 ②，你没选）或把检查改成阻断，r2 都不做。**这是 r2 对你原定取舍的实质改动，批不批由你定**；如果你维持 r1 的「不在 `--start` 复报」，CODEX-02 的漏报那一半需要改为登记已知限制。
- **焦点三 措辞是否越界成成因断言**：**主干句不越界，两处附带断言越界。** glm 核过：「CLI 跑的是它自己选的模型」是构造性事实——`source_missing` 早退、编排器不注入模型。但 codex 与 gemini 指出另外两处把条件写成了断言：「FR-06 / NFR-06 在该侧不成立」（个人默认模型碰巧与请求同 modelId 时，跑的就是请求的那个），以及「跑完 guard 会给告警」（要求回读到生效模型）。另外 codex 指出「本轮 glm 侧」预设了预检的选侧就是当轮的选侧，glm 指出硬写 `glm` 与「不写 Agent id 字面」自相矛盾。r2 §3.2 全部改成条件句加插值。
- **焦点四 C5 有没有漏看的转述通道**：**三侧一致：没有漏看。** dual-status 只转述闸门概览；status 和 report 走 run.json；guard 只在运行结束后、只播它自己的字段。skill 走 `--json`，C5 的文字确实躺在工具结果里，缺的是**转述约定**，不是投递（codex 的说法比 r1 的「未必到得了用户眼前」更准，BACKLOG 登记按这个口径写）。gemini 另外找出同形的一条：「版本漂移检查覆盖面」也是 `ok: true` 加 `⚠️`（AGY-03），我又复核出「探活 已跳过」，r2 一并纳入。
- **焦点五 零配额、不挪用户文件的验收**：**方向对，补三处。** glm 判充分；codex 与 gemini 各补了缺口。E1 没带 `--skip-auth-check`，「零配额」要靠探活缓存命中才成立（CODEX-06）；E1 断言「warnings 为空」会被 C5 的本机读数、以及加了旗标后「探活已跳过」那条弄红（GLM-03）；E2 只在函数层验，`cli.ts` 那段手写的 JSON 映射是 skill 路径上唯一承重的通道，却没人测（CODEX-04、AGY-02、AGY-04）。r2：E1 带旗标、断言改为「键在、且不含副本源条目」；新增 E3，用 mkdtemp 的 HOME 跑安装后的 CLI；测试套件里补一条子进程用例。**「不在真实 HOME 上挪文件」维持**，三侧都认同。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-F01 | codex（解析回退切出的意见单元） | 未标注（解析回退；单元内 8 条具名意见为 minor ×7、nit ×1） | 接受 | 解析回退只是信封格式出错：单元正文是完整的 `trivium.review.v1` JSON，8 条具名意见 CODEX-01～08 都有位置、依据与建议，可以逐条裁决。我逐条复核了代码与文档引用，**8 条全部属实，全部接受**，逐条理由见 §1.1。它们是本轮 r2 改动的主要来源：判侧落点（01）、选侧不一致（02）、措辞里的条件断言（03）、JSON 映射无测（04）、P6 杀不死与注入口（05）、E1 配额（06）、设计 §7.4 副本（07）、先例引用（08） | 逐条落点见 §1.1：r2 §3.1（01）、§3.2 与 §3.3 (c′)（02、03）、§3.3 与 §4.1 子进程用例 + P8（04）、§4.1 世界 B 与注入参数（05）、§4.3 E1 / E3 旗标（06）、§5 设计 §7.4 / §8.2 / PROTOCOL（07）、§4.1 contract 用例（08） |
| AGY-01 | gemini | minor | 接受 | 与 CODEX-03 同指：「跑完 guard 会告警」是后验断言，同 modelId 段或回读不到时不会出声。C5 的写法「跑完看 guard 的……」是指引式，照它的口径改 | r2 §3.2：告警一句改为「已经发起的，跑完看 guard 有没有……告警（回读不到生效模型时它不出声）」 |
| AGY-02 | gemini | minor | 接受 | 属实。E2 只从构建产物导入函数，覆盖不到 CLI 包装与 `--json` 序列化层；CLI 本来就支持 `--skip-auth-check`，可以零配额地从命令入口跑一遍。子进程用例（CODEX-04）在测试套件里补同一层；E3 在安装副本上再补一次 | r2 §4.3 新增 E3：evidence 目录里的脚本用 `mkdtemp` 建空 HOME，以 `env HOME=<临时目录>` 拉起**安装后的** `trivium preflight --stage plan --skip-auth-check --json`，断言退出码 0、`warnings` 含副本源条目、路径以 `~/` 展示；若临时 HOME 下有无关检查先失败，照实写进读数，不去绕它；清理只认 `mkdtemp` 的返回值 |
| AGY-03 | gemini | nit | 接受 | 属实。`preflight.ts:290-297` 的「版本漂移检查覆盖面」也是 `ok: true` 加 `⚠️`；我另外复核出同形的「探活 已跳过」（:689-694）。不界定口径，就是本题要治的形状留下两个漏网者 | r2 §3.3 定口径：**现有 `ok: true` 且 detail 以 `⚠️` 开头的项一律标 `warn: true`**，即 C5、版本漂移覆盖面、探活已跳过三条；「当轮 Driver」那条提示不带 `⚠️`、只是信息，不标。§4.1 每条各有一个断言 `warn: true` 的用例 |
| AGY-04 | gemini | nit | 接受 | 属实（`cli.ts:789`）。与 CODEX-04 同一处映射 | r2 §3.3：`--json` 的 `checks[]` 单项在 `warn` 为真时带 `warn: true`；用例与变异见 §4.1 子进程用例、§4.2 P8 |
| GLM-01 | glm | major | 接受 | 属实。`skills/dual-run/SKILL.md`：S0 预检 → S0.5 解析 → S1 起草（Write 整份计划）→ S2 `--start`，窗口以分钟计。r1 用一句对命令 A 不成立的事实，盖住了一个真实窗口。取 glm 的第二个建议：「`--start` 沿用同一个检查函数」——不新增判定，也就没有分叉；先例是 `checkModelSlugs` 在预检与 `--start` 各调一次。它同时补上 CODEX-02 的漏报那一半 | r2 §3.3 (c′)：`startReview` 在 `checkModelSlugs` 之后、派生工作进程之前，以当轮 `sides` 调 `checkModelOverrideSource`；结果进 `--start` 的 JSON `warnings`（恒在）；skill 第 3 步的开场播报逐条念出，并提示可以 `--cancel`。边界写明：警告是在拉起**之后**念出的，价值是可以立即中止 |
| GLM-02 | glm | major | 接受 | 与 CODEX-01 同指。glm 给的「挂到 zcodeAdapter 上作为可选能力字段」就是 r2 取的形态；它还点出 parity 的带引号扫描只抓 `ALL_AGENT_IDS`、`'zcode'` 字面量会**静默不红**，这是不能留给实现者临场发挥的理由 | r2 §3.1：`CriticAdapter` 加可选成员 `modelOverrideSource?(): string`，zcodeAdapter 实现为返回 `zcodeOverrideSourcePath()`；preflight 按有无这个成员判侧，没有新的厂商字面量，不需要 parity 豁免 |
| GLM-03 | glm | minor | 接受 | 属实。r2 让 C5、探活已跳过都进 `warnings`，E1 带 `--skip-auth-check` 后「探活已跳过」必然出现，C5 是否出现取决于本机 doctor 读数。「warnings 为空」必红，而那不是回归 | r2 §4.3 E1 的断言改为：`warnings` 键在；不含「模型覆盖副本源」条目；`checks[]` 里没有该项。读数里记下实际出现了哪几条 warn 及其来源 |
| GLM-04 | glm | minor | 接受 | 属实。`decideModelUnenforced` 首行 `if (attempted \|\| !requested \|\| !effective) return undefined`，回读不到时两句播报都不出声。r1「已经兜住」的全称表述会被当成完全覆盖来引用。r2 加了 (c′) 后，「预检之后被挪走」这一格主要由 `--start` 那条接住，收尾播报退为第二层 | r2 §3.3 写明兜底分层与边界：`--start` 那条（拉起时点、当轮选侧）为主；收尾 `model_unenforced` 只在回读到生效模型、且与请求 modelId 不同时出声；「拉起之后才被挪走」不在本题论域（副本在拉起时已建好） |
| GLM-05 | glm | minor | 接受 | 属实。C5 的 detail 用 `${critic}` / `${label}` 插值（`preflight.ts:536-542`）；r1 的草稿硬写 `glm`，与同段的声明自相矛盾。长文案里内嵌的 id，parity 扫描抓不到 | r2 §3.2：name 为 `${label} 模型覆盖副本源`，detail 里的侧名与 CLI 名全部经注册表插值；「EV-112 E2 实测」这类 ZCode 专属背景移进 RUNBOOK，不进通用文案 |
| GLM-06 | glm | nit | 接受 | 属实，与 CODEX-05 同源。r2 改为注入适配器之后，新检查本身不再依赖 HOME；仍依赖 HOME 的是 `zcodeOverrideSourcePath` 与 `~/` 展示，这两处的两个臂都要钉 HOME | r2 §4.1：凡读 HOME 的用例，两个臂都把 HOME 钉到 mkdtemp（一个摆 `config.json`、一个不摆），用完恢复；新检查的可测性走 `adapters` 参数注入，写进函数文档 |

### 1.1 CODEX-F01 细目：codex 原文 8 条的逐条处理

codex 的 JSON 没能被结构化解析，闸门只认上表那一个单元。下表是单元内 8 条具名意见的逐条处理，保证每一条都有去向。

| codex 原文条目 | 严重度 | 处理 | 依据 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| CODEX-01 判侧落点 | minor | 接受 | 属实。我复核了 `preflight.ts:528-549`：C5 靠 `probe.cli[cliName].runtime_selection` 的数据形状定向，从头到尾不判「谁是 zcode」；新检查必须判。`base.ts:89-132` 里 preflight 已在消费四个逐侧可选钩子，注释原话是「这条知识属于那一侧……不住在 preflight 里」，r1 否决 (b) 的「只有一个调用方」与此不符。「与 C5 同形」的类比也不成立。与 GLM-02 同指 | r2 §3.1 (a′)。完整的 `preflightAdvisories(ctx)` 钩子仍不取：措辞留在 preflight 统一写，适配器只报「覆盖要读哪个文件」这一条事实 |
| CODEX-02 选侧不一致 | minor | 接受 | 属实。四条 skill 的第 1 步是固定命令、不传 `--critics`，PROTOCOL :341 明写「选了非缺省侧时由 `review --start` 兜住」；`preflight.ts:641` 的 `selected = opts.critics ?? cfg.review.default_critics`。两个方向都会错：当轮没选 glm 时照样收到 glm 警告（误报）；当轮选了缺省以外的 glm 时不出项（漏报）。误报靠措辞改成条件句解决，漏报与 GLM-01 合并处理 | r2 §3.2 措辞改为条件句「该侧若在它缺位时拉起……」；r2 §3.3 (c′)：`--start` 用当轮实际入选侧 `sides` 复用同一个函数 |
| CODEX-03 措辞里的条件断言 | minor | 接受 | 属实。`zcode.ts:160-163` 的 `decideModelUnenforced`：`!effective` 时不产出；`zcodeModelTail(effective) === zcodeModelTail(requested)` 时也不产出。所以「FR-06 / NFR-06 不成立」比机制强，「跑完会告警」也不是无条件的。与 AGY-01 同指，与 GLM-04 同源 | r2 §3.2：detail 删去 FR-06 / NFR-06 一句（移进 RUNBOOK，写成「可能不成立」），告警一句改为条件句；r2 §3.3 写明收尾兜底的前提 |
| CODEX-04 JSON 映射无测 | minor | 接受 | 属实。`cli.ts:786-793` 的 `emitJson` 手写映射 `checks.map(c => ({name, ok, detail}))`，skill 一律走 `--json`，`renderPreflight` 在 skill 路径上根本不被调用。漏加 `warnings` 时 skill 的转述句会静默不触发，这正是本题要治的形状换了一层 | r2 §4.1 子进程用例（沿用 `test/integration/codex-wiring.test.ts` 的 `preflight … --skip-auth-check --json` harness）：`warnings` 键恒在，「探活已跳过」那条同时出现在 `warnings` 里、在 `checks[]` 里带 `warn: true`；r2 §4.2 变异 P8；E1 断言改为「键在」 |
| CODEX-05 P6 杀不死、无注入口 | minor | 接受 | 属实。r1 的 P6 在「不放文件」的世界里与基线观测相同，杀不死；D1 的「唯一出处」因此没有机器判据。新检查也没有注入口，用例只能读真实的 `os.homedir()` | r2 §4.1：加一个「HOME 下**摆着**副本源」的世界 B，`prepareZcodeHome`（不传 `srcConfig`）不报 `source_missing`、fingerprint 非 null，P6 在这里咬住；新检查带 `adapters` 注入参数；`runPreflight` 用例在文件级把 HOME 钉到 mkdtemp |
| CODEX-06 E1 会烧配额 | minor | 接受 | 属实。`preflight.ts:687-707`：⑧ 探活是唯一真实消耗配额的一项，只有 `--skip-auth-check` 能确保跳过；新检查在 ④″，加旗标不影响它出项 | r2 §4.3 E1、E3 一律带 `--skip-auth-check`，并写明它只跳过 ⑧ |
| CODEX-07 漏设计 §7.4 副本 | minor | 接受 | 属实。设计 :1353（§7.4 第 1 步）是 skill 执行契约的逐字副本，§8.2 的 S0 行也指向它。r2 还会改 `--start` 的返回字段与 skill 第 3 步，设计与 PROTOCOL 里对应的副本同样要同步 | r2 §5：设计 §7.4 第 1 步与第 3 步、§8.2 S0 / S2 行、§8.1、:252、:289；PROTOCOL §九 `preflight` 与 `review --start` 两行 |
| CODEX-08 先例引用不实 | nit | 接受 | 属实。`topic-args.test.ts` 只在 :391 的注释里提到 SKILL.md；读 skill 文本做对账的先例在 `test/contract/`（`skill-flag-parity`、`skill-quoting`、`disposition-role-assets` 的全目录扫描） | r2 §4.1：skill 文本用例放进 `test/contract/`，全目录扫描 `skills/*/SKILL.md`，不写死文件名 |

## 2. 修订稿 r2（在 r1 基础上的改动，按节）

### §1.2 现状核实：补三格

| # | 事实 | 出处 |
| :-- | :--- | :--- |
| C9 | 预检的选侧是 `opts.critics ?? default_critics`，skill 第 1 步不传 `--critics`；当轮的选侧由 `--start` 的 `sides` 决定。两者可以不同 | `preflight.ts:641`；`review.ts:564`；PROTOCOL :341 |
| C10 | `--start` 已经在派生之前复用预检的判定函数（`checkModelSlugs`），这是「同一函数、两处调用」的先例 | `review.ts:581` |
| C11 | `ok: true` 加 `⚠️` 的同形项共三条：C5、「版本漂移检查覆盖面」、「探活 已跳过」 | `preflight.ts:290-297`、:520-549、:689-694 |

C5「与本检查同形」一句删去（CODEX-01）。

### §2 范围

**做**（替换 r1 的 1–4）：
1. zcode 适配器导出 `zcodeOverrideSourcePath()`，作为 C1、C2 的唯一出处；`CriticAdapter` 加可选成员 `modelOverrideSource?()`，由 zcodeAdapter 实现（§3.1）；
2. 新检查 `checkModelOverrideSource`：按能力判侧，只警告（§3.2）；
3. `warn` 级、`warnings` 汇总、`--json` 映射、人读渲染；现有三条 `⚠️` 项一并标 `warn`（§3.3）；
4. `review --start` 以当轮 `sides` 复用同一个函数，结果进返回值的 `warnings`（§3.3 (c′)）；
5. skill 第 1 步与第 3 步各补一句转述约定（§3.4）；
6. 用例、变异、验收、文档同步（§4、§5）。

**不做**：删去 r1 的「不在 `review --start` 再报一次」，其余四条维持。另加一条：**不拒跑，也不在拉起前阻断**（`--start` 的警告在派生之后返回）。

### §3.1 判侧与唯一出处（D1 → (a′)）

- `adapters/zcode.ts`：`export function zcodeOverrideSourcePath(): string`，返回 `path.join(os.homedir(), '.zcode/cli/config.json')`；`prepareZcodeHome` 的 `srcConfig` 缺省值、`authProbe.fingerprint()` 都改为调用它（C1、C2 两处字面合为一处）。
- `adapters/base.ts`：`CriticAdapter` 新增可选成员

  ```ts
  /**
   * 该侧做模型覆盖时要读的用户侧文件（绝对路径）。**可选**：不靠副本做覆盖的侧不实现。
   * 契约：文件不在 ⇒ 该侧拉起时不做模型覆盖，跑的是 CLI 自己选的模型。
   * 预检与 `review --start` 据此给一条只警告的提示；这条知识属于那一侧，不住在 preflight 里。
   * 路径按运行编排器那个进程的 HOME 解析，与拉起侧同源。
   */
  modelOverrideSource?(): string;
  ```

  zcodeAdapter 实现为 `() => zcodeOverrideSourcePath()`。
- preflight 按「入选侧的适配器有没有这个成员」判侧，不写 Agent id 或 CLI 名字面量，不需要 parity 豁免。
- 不取完整的 `preflightAdvisories(ctx)` 钩子：它会把措辞也下放到各适配器，而这条提示的措辞对任何实现了该契约的侧都成立，统一写一处即可。

### §3.2 新检查与措辞（D3）

`checkModelOverrideSource(selected: readonly CriticId[], adapters: AdapterTable = realAdapters()): Promise<CheckResult[]>`：遍历 `selected`，对实现了 `modelOverrideSource` 的侧查文件在不在，不在的各出一项（通常 0 或 1 项）。`adapters` 参数是注入口，函数文档注明「为可测性；本函数只判存在、不读内容」。

```text
name:   `${label} 模型覆盖副本源`
ok:     true
warn:   true
detail: `⚠️ ${critic} 侧做模型覆盖要读的副本源 ${shown} 不在。该侧若在它缺位时拉起，就不做模型覆盖，` +
        `跑的是 ${cliName} 自己选的模型，不一定是请求的那个。要按请求的模型跑，先把副本源放回原处再发起；` +
        `已经发起的，跑完看 guard 有没有「本次没有做模型覆盖」告警（回读不到生效模型时它不出声）。`
```

- `label` / `critic` / `cliName` 一律经注册表取（GLM-05）；
- `shown`：路径在 `os.homedir()` 之下时显示为 `~/…`，否则原样显示（evidence 里不带出用户名）；
- 删去 r1 的「FR-06 / NFR-06 在该侧不成立」与「EV-112 E2 实测为……」：前者比机制强（CODEX-03），后者是 ZCode 专属背景。两句都移进 RUNBOOK，前者改写为「可能不成立」；
- 「该侧若在它缺位时拉起」对预检与 `--start` 两个调用点都成立：预检时当轮可能压根没选该侧（CODEX-02），`--start` 时文件可能在派生之前就已放回；
- 位置：④″，紧跟 C5，同样只在前面各项都通过时才跑，在探活之前。

### §3.3 警告这一级与转述通道（D2 → (a) + (c′)）

- `CheckResult` 加 `warn?: true`；`PreflightResult` 加 `warnings: { name: string; detail: string }[]`，由 `checks.filter(c => c.warn)` 得出，恒存在（无警告时为 `[]`）。`ok` 与退出码不受影响。
- **口径**：现有 `ok: true` 且 detail 以 `⚠️` 开头的项一律标 `warn`，即 C5、「版本漂移检查覆盖面」、「探活 已跳过」三条（AGY-03）；「当轮 Driver」不标。今后新增只警告项，用 `warn` 表达语义，`⚠️` 只是展示。
- `cli.ts` 预检的 `--json`：`checks[]` 单项在 `warn` 为真时带 `warn: true`；顶层 `warnings` 恒在（CODEX-04、AGY-04）。
- 人读：`warn` 项行首用 `⚠`；末行「✓ 预检通过」后追加「（含 N 条警告）」，无警告时与今天逐字相同。
- **(c′) `--start` 复用**（GLM-01、CODEX-02）：`startReview` 在 `checkModelSlugs` 之后、派生之前，以当轮 `sides` 调 `checkModelOverrideSource`；结果放进返回结构的 `warnings`，`--start` 的 JSON 恒带该键（`finished_inline` 分支为 `[]`）。不写进 run.json：事后的实际情况由 guard 的 `model_override_applied` / `model_unenforced` 记录。
- **兜底分层**（GLM-04、CODEX-03）：
  ① 预检：最早，按缺省选侧，措辞为条件句；
  ② `--start`：当轮选侧、拉起时点，**在派生之后**念出，用户可以立即 `--cancel`；
  ③ 收尾 `model_unenforced`：只在回读到生效模型、且与请求 modelId 不同时出声；回读不到时静默，由失败播报与落点自检旁证。
  「拉起之后才被挪走」不在论域：副本在拉起时就已建好。
- 命令 B / C / D 下，文件缺失时同一条警告会在第 1 步与第 3 步各念一次，相隔几秒。**接受这个重复**：只在文件确实缺失时出现，第二次恰好确认了拉起时的状态。

### §3.4 skill 的转述约定

- 第 1 步（`dual-review-{plan,code,bug}` 第 1 步、`dual-run` S0）：在「失败则原样转述」之后补一句
  > 通过时若 `warnings` 非空，把每一条的 `detail` 原样念给用户，**然后继续**，不停下来等确认——警告不阻断，要不要处理由用户决定。
- 第 3 步开场播报（三个 `dual-review-*` 的第 3 步；`dual-run` 的 S2 / S6 显式写一句「同上」）：
  > `--start` 返回的 `warnings` 非空时，在开场播报里逐条原样念出 `detail`，并提醒：想中止就用 `TV review --cancel <run_id>`。

### §4.1 用例（替换 r1）

- **唯一出处**（CODEX-05、GLM-06）：HOME 钉到 mkdtemp，用完恢复。
  - 世界 A（HOME 下不摆文件）：`zcodeOverrideSourcePath()` 返回 `<临时 HOME>/.zcode/cli/config.json`；`prepareZcodeHome` 不传 `srcConfig` ⇒ `cause: 'source_missing'`；`fingerprint()` 为 null。
  - 世界 B（HOME 下摆一份最小 `config.json`）：`prepareZcodeHome` 不传 `srcConfig` ⇒ **不是** `source_missing`；`fingerprint()` 非 null。
- **`checkModelOverrideSource`**（注入假适配器）：无该成员 ⇒ `[]`；有成员且文件不在 ⇒ 一项，`ok: true`、`warn: true`，detail 以 `⚠️` 开头，含 `~/.zcode/cli/config.json`、**不含**临时 HOME 的绝对路径，侧名与注册表一致；文件在 ⇒ `[]`；该侧未入选 ⇒ `[]`；zcodeAdapter 确实实现了该成员，且返回值等于 `zcodeOverrideSourcePath()`。
- **三条现有警告项**：C5、版本漂移覆盖面、探活已跳过，各有一个断言 `warn: true` 的用例（AGY-03）。
- **`runPreflight` 汇总**：preflight 用例文件在文件级把 HOME 钉到 mkdtemp，默认摆好副本源，保证现有用例不受开发机状态影响；让 C5 与新检查各出一条 ⇒ `warnings` 恰两条、`ok: true`、`exitCode` 0；都不出 ⇒ `warnings` 为 `[]`。
- **人读输出**：`warn` 项行首为 `⚠`，末行含「含 N 条警告」；无警告时末行与今天逐字相同。
- **`--json` 子进程**（CODEX-04）：沿用 `codex-wiring.test.ts` 的 harness 跑 `preflight … --skip-auth-check --json`，断言 `warnings` 键在，含「探活」那一条，且 `checks[]` 中对应项带 `warn: true`。
- **`--start`**（GLM-01）：注入带该成员的假适配器，入选且文件不在 ⇒ `warnings` 一项；未入选 ⇒ `[]`；`--start` 的 JSON 恒带 `warnings` 键。
- **skill 文本**（CODEX-08）：`test/contract/` 新增用例，全目录扫描 `skills/*/SKILL.md`：含 `preflight --stage` 的文件必须有第 1 步的转述句，含 `review --start` 的文件必须有开场播报的转述句。

### §4.2 变异（替换 r1；规格与输出进 `doc/05_testing/evidence/ev123-mutation-<日期>/`，另写 `00-readout.md`，写明「工作树干净」的口径）

- P1 新检查恒返回 `[]` ⇒「文件不在 ⇒ 出项」红；
- P2 不看 `selected`（遍历全部适配器）⇒「未入选 ⇒ []」红；
- P3 detail 用绝对路径 ⇒「不含绝对路径」红；
- P4 `warnings` 不过滤 `warn` ⇒ 汇总条数红；
- P5 C5 不标 `warn` ⇒「恰两条」红；P5′ 探活已跳过不标 `warn` ⇒ 子进程用例红；
- P6 `prepareZcodeHome` 的缺省值改成另一个路径（如在文件名后加 `.bak`），不走 `zcodeOverrideSourcePath` ⇒ 世界 B 红；
- P7 删掉某一个 `SKILL.md` 的某一句转述 ⇒ contract 用例红；
- P8 删掉 `cli.ts` 预检 JSON 映射里的 `warnings` ⇒ 子进程用例红；
- P9 `startReview` 不调新检查 ⇒ `--start` 用例红。

### §4.3 验收（零配额，不挪用户文件）

- **E1 正向**（本机，副本源在）：`npm run install:local` 之后跑 `trivium preflight --stage plan --skip-auth-check --json`（旗标只跳过 ⑧，不影响 ④″）。断言 `warnings` 键在、不含「模型覆盖副本源」条目、`checks[]` 里没有该项；读数里记下实际出现的 warn 项及其来源（GLM-03）。
- **E2 反向，函数层**：evidence 目录里的脚本从构建产物导入 `checkModelOverrideSource` 与 `renderPreflight`，HOME 钉到 mkdtemp 空目录，传入真实的 `realAdapters()`，断言出项、措辞、`⚠` 行与末行。
- **E3 反向，CLI 层**（AGY-02）：同一份脚本以 `env HOME=<mkdtemp 空目录>` 拉起安装后的 `trivium preflight --stage plan --skip-auth-check --json`，断言退出码 0、`warnings` 含副本源条目、路径以 `~/` 展示。临时 HOME 下若有无关检查先失败，照实写进读数，不绕；清理只认 `mkdtemp` 的返回值。
- **不在真实 HOME 上挪 `~/.zcode/cli/config.json`**，维持。
- `--start` 那一路只有用例覆盖，**没有真实验收**：真跑一次 `--start` 就会拉起审查、消耗配额。这一点写进读数。
- `npm run typecheck && npm run build && npm test` 全绿；`trivium doctor --selftest` 全绿。

### §5 文档同步（补 CODEX-07）

- **设计文档**：§8.1 预检表补 C5 一行（C8 的欠账）与新检查一行，版本漂移覆盖面、探活跳过两行标注 `warn`；表下补一段「警告这一级」（`warn` 不影响 `ok` 与退出码、`warnings` 恒在、skill 负责念出）；§7.4 第 1 步与第 3 步的 skill 契约副本同步；§8.2 S0 / S2 行；:252「与预检的分工」补上新检查与 `--start` 复用；:289 runtime_selection 行注明该警告带 `warn`；`--start` 返回字段处补 `warnings`；变更记录追加一条，版本跟进；`doc/02_design/README.md` 跟版。
- **PROTOCOL** §九：`preflight` 行补 `warnings`；`review --start` 行补返回的 `warnings`，以及「按当轮选侧复用预检的判定函数」一句。
- **RUNBOOK**：新增一行「预检或开场播报说副本源 `~/.zcode/cli/config.json` 不在」：原因（C1）；影响（该侧不做覆盖，FR-06 / NFR-06 在该侧可能不成立；EV-112 E2 实测跑的是个人配置的默认模型）；处理（放回原处再发起；已发起的可以 `--cancel`，或者接受并看收尾告警，注意它在回读不到时不出声）。
- **BACKLOG**：EV-123 关闭。登记一句：C5 在本题之前**没有转述约定**，信息一直在工具结果里，EV-82 第三段以来是否被念给过用户无从查证（只记录，不追溯）。
- **skills**：§3.4 所列各处。

### §8 量级

实现量从约 50 行上调到约 90 行，多出来的是：一个可选成员、`--start` 一处调用加返回字段、JSON 映射、三条现有项标 `warn`、两类转述句。另加八组用例。plan 预计 2 轮（r2 改了 D1、D2 的形态）；code 1 轮；验收零配额。不进 M10b 轮次阈值。

## 3. 其它登记

- codex 的「未覆盖范围」第 2 条：Driver 会话的 HOME 被改写时（codex 的 agent 会话把 HOME 指到 `fakehome`），预检读到的 `~` 与用户真实家目录脱钩。今天的 Driver 是 claude，不受影响，本题不处理；§3.1 的成员文档已写明「按运行编排器那个进程的 HOME 解析」，让它与拉起侧同源。
