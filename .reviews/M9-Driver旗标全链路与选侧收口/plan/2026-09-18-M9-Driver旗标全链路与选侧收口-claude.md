# M9 第 5 步 · `--driver` 全链路与选侧收口 实施计划

- **日期**：2026-09-18
- **起点**：`8ff9fc3`（M9 第 4 步「审核者启用与夹具收口」），`main` 干净
- **本主题是什么**：把 `--driver` 从「函数支持了但没有任何调用方传值」的状态接进真实链路，
  并同批收口它翻开关后暴露出来的两条论域分叉（EV-53）与一条留痕缺口（EV-54）。
- **本计划的事实基础**：下文每条带行号的断言都是我在 `8ff9fc3` 上**逐条实读**核过的，
  不是从前序文档抄的。凡属我判断而非实读的，都在原地标了「这是我判的」。

---

## 0. 前序指路（新建主题的代价，逐条可核）

本步另起主题目录，原因与第 3、4 步相同：前一主题的闸门已推进到 `code/approved`，
在其下再跑 plan 会把闸门拉回 plan 阶段。代价是审查员失去前序上下文，故此节逐条给出可核位置。

| 项 | 位置 |
| :--- | :--- |
| **当前生效的步骤表** | `.reviews/M9-ClaudeCode审核者接入/plan/2026-09-17-M9-ClaudeCode审核者接入-revised-claude.md` §3 |
| 第 5 步的落点表（原 §6 作废，以此为准） | 同上 §2.1 |
| 第 5 步的显式边界（不进 skill） | 同上 §2.14 |
| `driverEnabled` 校不校验的提案 | `.reviews/M9-ClaudeCode审核者接入/plan/2026-09-17-M9-ClaudeCode审核者接入-claude.md` §6.1 |
| 第 4 步做了什么 | `.reviews/M9-审核者启用与夹具收口/plan/2026-09-18-M9-审核者启用与夹具收口-revised-claude.md` |
| EV 台账（EV-52 / 53 / 54 / 55 / 57） | `doc/08_project/BACKLOG.md`「2026-09-14 演进期认领项」一节 |
| M9 完成判据 J1～J8 | `.reviews/M9-ClaudeCode审核者接入/plan/2026-09-17-M9-ClaudeCode审核者接入-claude.md` §1.1 |
| **明确不读** | `doc/08_project/M9-交底.md` 对第 5 步**一个字都没写**（它没有步骤划分）；`doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md` §7.2 调用模板**已作废** |

---

## 1. 范围与完成判据

### 1.1 本步范围（引步骤表 §2.1，逐字）

> | 落点 | 改什么 |
> | `topic-args.ts` | 解析 `--driver`，传给 `resolveCriticSelection` 与 `locateSubjectReadOnly` |
> | `review.ts` | `ReviewOptions` 新增 `driver?: AgentId`；传给 `locateSubject`、`freeze`、`newRunMeta` |
> | `cli.ts` | 两处 `resolveCriticSelection`（`cmdReview`、`cmdPreflight`）透传；`checkStageArtifacts` 的 driver 位补上 |
> | **新增判据（CODEX-07）** | `locateSubjectReadOnly` / `locateSubject` 的候选若命中**任一 run 元数据的审查件登记**，拒绝并说明——不许把审查件当原稿 |
> | **新增提示（CODEX-07）** | `--driver` 取值非缺省时，预检打一行可见提示 |
>
> §6.1 的「在运行元数据里如实标注」**保留**，因为接线后它才真的兑现得了。

加上两条同批的台账条目：

| # | 内容 | 为什么必须同批 |
| :--- | :--- | :--- |
| **EV-53** | `--model-<id>` 白名单判据与文案的论域，改为「本轮实际能入选谁」 | 触发条件逐字写着「M9 第 5 步 `--driver` 全链路落地时」；且有**硬依赖**，见 §2.2 |
| **EV-54** | 补 `override_reason` 的写入方（**只补写入方**） | 用户已裁定纳入；理由见 §5 |

### 1.2 本步**不包含**（各有出处，不是我划小）

| 不做 | 出处 |
| :--- | :--- |
| `--driver` **不进 skill、不进 `argument-hint`**；J4 / J8 的「经完整编排链路」限定为手工 CLI 路径 | 步骤表 §2.14 逐字 |
| **不翻任何一家的 `driverEnabled`** | `src/trivium/agents/registry.ts` 三处 `driverEnabled: false, // M10 启用` |
| **不校验 `driverEnabled`**（只校验「已登记」） | §6.1，步骤表 §2.1 明写保留 |
| 运行元数据 schema **不加**「`heterogeneous: false` ⇒ 必须有 `override_reason`」的 `if/then` | 见 §7 R-6：加了历史留痕集体读不回 |
| Hook 后缀集的跨时间面（`criticRoleSuffixes` 等） | BACKLOG **EV-55**，触发条件「M10 第一次换 Driver 之前必须先落」 |
| `gate.ts` / `report.ts` / `naming.ts` 以及 `cli.ts` 闸门区的 driver 位 | 不在 §2.1 落点表；本步新登记 **EV-58**，见 §8 |
| `checkConfigAgents` 的两条 skip 用例 | BACKLOG **EV-52**：修法要给校验层加生产入参，与第 4 步同一条范围裁定 |
| 验收实跑本身（J4 / J5 / J6） | 步骤表**第 6 步** |
| 设计 §21 / §24 台账、PRD 侧 AC 状态、`doc/05_testing` 回溯 | BACKLOG **EV-57**，触发条件「M9 第 7 步开工时」 |

### 1.3 完成判据（三条，可判真假）

- **C1**：`--driver <非 claude> --critics claude` 经真实 CLI 子进程能走通选侧（不退 64）。
- **C2**：`--driver claude --critics claude` 经真实 CLI 子进程仍退 64（J8 安全不变量）。
- **C3**：`npm run check` 全绿，且跳过数由 3 降为 2（`topic-args` 那条 skip 因本步恢复执行）。

---

## 2. 开工前的三条核实（每条都推翻或修正了一句前序文字）

### 2.1 步骤表的落点表**漏了一处**：`resolveRerunIndex`

`src/trivium/archive.ts:65-68` 的签名是：

```
export async function resolveRerunIndex(
  l: ArchiveLayout,
  stage: Stage,
  driver: AgentId = DEFAULT_DRIVER,
```

而 `src/trivium/review.ts:559` 与 `src/trivium/cli.ts:731` 两处调用**都只传两个参数**。
步骤表 §2.1 的落点表列了 `locateSubject` / `freeze` / `newRunMeta`，**没列它**。

不补的后果可实算：driver = glm、plan 阶段，归档里有 `-glm.md`（原稿，r1）、`-claude.md`（r1）、
`-r2-claude.md`（r2）。漏传时按 driver = claude 跳过全部 `-claude*`，max 只剩原稿的 1，
下一轮算成 **2**（正确是 3）。`archive.ts:73-77` 的注释记的正是同族后果。

→ **我把 `review.ts:559` 补进本步范围**，`cli.ts:731` 不补（理由见 §8 EV-58）。这条切分请裁定（D5）。

### 2.2 EV-53 不是「顺手清债」，是接线的**硬依赖**

`src/trivium/critics.ts:57-73` 的 `legalList` 论域是「启用集合 ∩ 有配置条目 **减 driver**」：

```
const usable = enabled.filter(
  (c) => cfg.agents[c as CriticId] !== undefined && c !== driver,
);
```

而 `src/trivium/topic-args.ts:451` / `:455` 是**独立的另一套**，不减 Driver：

```
if (!(CRITICS as readonly string[]).includes(id)) {
  throw new TriviumError(EXIT.USAGE,
    `--model-${id}：${id} 当前不是可用审核者，不能为它指定模型。\n` +
    `  当前可用：${CRITICS.join('、')}`);
}
```

本步把 `driver` 传进 `resolveCriticSelection` 之后，**同一条命令里这两段文案会互相矛盾**：
一段说「当前可用：claude、codex、gemini、glm」，另一段说「当前可用：codex | gemini | glm」。
所以 EV-53 不是可选项。

### 2.3 `resolveDriver` 不存在；`DRIVER_AGENT_IDS` 已存在但**零消费方**

- `grep -rn resolveDriver src/ test/ skills/` → 零命中。判定处要新建。
- `DRIVER_AGENT_IDS`（`src/trivium/agents/registry.ts:338`）在 `src/` 下只有定义行，
  没有任何消费方（另两处命中是打包产物 `skills/dual-critic/scripts/trivium.cjs`）。
  **本步也不该消费它**——判据是「已登记」不是「已启用为 Driver」，理由见 §3 步骤 5.0。

---

## 3. 落地顺序（序号即执行顺序，每步单独可验）

> 每步后：`npm run typecheck` → `npm run pretest` → 跑该步对应的测试文件。

| 序 | 动作 | 为什么在这个位置 |
| :--- | :--- | :--- |
| 5.0 | 判定处 `resolveDriver` | 后面五步都消费它，先立判据 |
| 5.1 | `cli.ts` 两个入口接线 | 让 `--driver` 第一次有真实入口 |
| 5.2 | 预检可见提示 | 依赖 5.1 传进来的 `enabledAsDriver` |
| 5.3 | `topic-args.ts` 解析与透传 | 第三个入口，与 5.1 共用 5.0 的判定 |
| 5.4 | **EV-53** 论域合一 | 必须紧跟 5.3：5.3 一落地，两套文案就开始互相矛盾 |
| 5.5 | `review.ts` 三处 + 两处补漏 + 交接文件 | 链路下半段 |
| 5.6 | **CODEX-07** 审查件判别 | 依赖 5.3 / 5.5 已把 driver 传到两个定位函数 |
| 5.7 | 闸门区 `checkStageArtifacts` 的 driver 位 | 事实来源是运行元数据，与前面的旗标链路正交，放最后 |
| 5.8 | **EV-54** 补 `override_reason` 写入方 | 与主链路无耦合，可独立落 |

**5.1～5.4 之间不得留过夜的中间态**：5.3 落地而 5.4 未落时，仓库处于「同一条命令两段文案互相矛盾」的状态。

### 5.0 判定处 —— `src/trivium/critics.ts`

新增导出：

```
resolveDriver(raw: string | null | undefined): { driver: AgentId; enabledAsDriver: boolean }
```

- 缺省（`null` / 空串）→ `{ driver: DEFAULT_DRIVER, enabledAsDriver: true }`
- 未登记 → `TriviumError(EXIT.USAGE, …)`，可用值列 `ALL_AGENT_IDS`
- 已登记但 `driverEnabled === false` → 返回 `enabledAsDriver: false`，**不抛**

**复用现成件**：`isAgentId` / `agentById` / `ALL_AGENT_IDS`（`agents/registry.ts:242, 351, 356`）、
`swallowedTextHint`（`exit-codes.ts:59`，处理「取值像散文」的情形，与 `critics.ts:149` 同款）。

**判定只此一处，三个调用点共用。** 理由见 `critics.ts` 文件头注释：校验分两处实现就是改一漏二，
M7b 第 5 步刚为此收敛过一次。

**错误文案的论域用 `ALL_AGENT_IDS`，不是 `DRIVER_AGENT_IDS`。** 判据是「已登记」，
用后者会让报错列出的清单（只有 claude）与实际接受的取值（四家）不一致——
那正是本仓反复点名的「第一个错误把用户引向第二个错误」。

### 5.1 `cli.ts` 两个入口 —— `src/trivium/cli.ts`

| 落点 | 改什么 |
| :--- | :--- |
| `cmdReview`（:462 附近） | `const { driver, enabledAsDriver } = resolveDriver(flagString(args, 'driver'));` |
| :470-473 | `resolveCriticSelection(ctx.config, { critics, only: onlyRaw, driver })` |
| :480-497 `reviewOpts` | 补 `driver` |
| `cmdPreflight` :633-636 | 同款取值 + 透传 |
| :638-645 `runPreflight` | 补 `driver` / `driverEnabled: enabledAsDriver` |
| USAGE :208 / :226 | 补 `--driver <id>`，**取值清单用插值**（仿 `:175` 的 `doctorOnlyChoices()`，见 `doctor.ts:47-49`），不写死四家 |

`--driver` 是取值旗标，**不进** `BOOLEAN_FLAGS`（:74-78）；`parseArgs` 对非布尔旗标开放，
`flagString(args, 'driver')` 直接可用，无需登记。

### 5.2 预检可见提示 —— `src/trivium/preflight.ts`

`PreflightOptions`（:64-80）加 `driver?: AgentId` 与 `driverEnabled?: boolean`。
`runPreflight`（:591）在 `:604` 的 `checkProbeFreshness` **之前**推一条 `CheckResult`，
**仅当 `driver !== DEFAULT_DRIVER` 时**：

- `name: '当轮 Driver'`，`ok: true`
- `driverEnabled === false` 时 detail 逐字含「本次声明的 Driver 尚未启用为 Driver，该值仅用于选侧判定」

**必须 `ok: true`**：`:606` 起多处用 `checks.every((c) => c.ok)` 做短路，
`exitCode` 由 `:640` 的 `find(c => !c.ok)` 决定。判 false 会把一条**提示**变成一次**失败**。

做成 `CheckResult` 即同时进两条输出：`cli.ts:649-658` 的 `--json`（`r.checks.map(...)`）与
人读（`say(renderPreflight(r))`）**都消费 `r.checks`**。

### 5.3 `topic-args.ts` 解析与透传 —— `src/trivium/topic-args.ts`

1. `STATIC_FLAGS`（:31-35）加 `'driver'` —— 加进去后 `isKnownFlag`（:142）与
   `findSwallowedFlags`（:163）自动覆盖它，零额外成本
2. `scope === 'all'` 的拒绝条件（:318-326）**是否并入 `--driver`** → 见 §6 请裁定 **D3**
3. `resolveCriticSelection`（:328-331）传 `driver`
4. `locateSubjectReadOnly`（:473）补第 5 实参 —— 该函数 `:532` 的形参
   `driver: AgentId = DEFAULT_DRIVER` 早就在，注释自陈「这一处曾经漏改」
5. `TopicResolution`（:200-247）加 `driver: AgentId`；`enabledAsDriver === false` 时 `notes.push(…)`。
   `cli.ts:683` 的 `emitJson({ ok: true, ...r })` 会自动透出
6. `cli.ts` 人读路径：`r.driver !== DEFAULT_DRIVER` 时打一行

### 5.4 EV-53：白名单与文案论域合一 —— `topic-args.ts:448-459`

- 判据由 `CRITICS.includes(id)` 改为「本轮实际能入选谁」
- 文案由 `CRITICS.join('、')` 改为**同一份派生**

**做法**：从 `critics.ts` 导出 `selectableCritics(cfg, driver, descriptors?)`，
并把 `legalList`（:57-73）改为调它。这样 EV-53③ 点名的「两套派生」在**源头**合一，
而不是把同一个 filter 抄两遍——抄两遍是把今天这个缺口原样复制到明天。

### 5.5 `review.ts` 三处 + 两处补漏 + 交接文件

**`src/trivium/review.ts`**

| 落点 | 改什么 |
| :--- | :--- |
| `ReviewOptions`（:279-328） | 加 `driver?: AgentId` |
| `prepareRun` 开头 | `const driver = opts.driver ?? DEFAULT_DRIVER;` |
| :610 `locateSubject` | 补第 4 实参 |
| :650 `freeze({` | 补 `driver,`（实读确认：该实参块现有 `cfg` / `projectRoot` / `archiveRoot` / `stage` / `critic` / `topic` / `subjectPath`，**无 `driver`**） |
| :776 `newRunMeta({` | 补 `driver` / `driverEnabled`（实读确认：现有 13 个字段，**无 `driver`**） |
| **:559 `resolveRerunIndex`（补漏）** | 见 §2.1 |
| **:497 旁（防御）** | `if (sides.includes(driver)) throw usageError(…)` |

关于防御那条：`:466` 是 `const sides = [...(opts.critics ?? resolveCriticSelection(cfg))]`——
**给了 `critics` 就不再过判定处**。worker 从交接文件拷贝、测试与 selftest 手工构造，都能绕过。
这与 `:497` 那条空集合兜底同构，其注释写着「判定处的非空不变式要延伸到直接传参的路径」；
Driver 排除是比空集合更硬的安全不变量，同样该延伸。

**`src/trivium/run-protocol.ts`（§2.1 未列，属同一条链）**

`Handoff.options`（:74-88）、`writeHandoff`（:104-115）、`rebuildContext`（:142-156）三处都要加 `driver`。
`critics` / `sessionId` / `entry` 三个字段的注释各自写明了理由：**worker 是另一个进程，读不到 `--start` 的 argv**。
加了 `ReviewOptions.driver` 而不加这三处，worker 侧的 `opts.driver` 静默为 `undefined`——
而 worker 才是真正跑审查的那一侧。

**留痕字段**

- `src/trivium/meta.ts`：`NewRunMetaInput`（:214 已有 `driver?: AgentId`，:237 `driver: i.driver ?? DEFAULT_DRIVER`）
  加 `driverEnabled?: boolean`；`newRunMeta` **恒写** `driver_enabled`
- `src/trivium/types.ts`：`RunMeta` 加**可选** `driver_enabled?: boolean`
- `skills/dual-critic/schema/run.v2.json`：`properties` 加 `driver_enabled`
  （`type: boolean`，**不进 `required`**、**不加 enum**）

顶层 `additionalProperties: true`（run.v2.json:26）实读确认，所以加可选字段**不会**让历史留痕读不回。

**同批修两句已失实的文字**（本仓纪律：留痕里的失实断言先改再提交）：

- `src/trivium/types.ts:1175`：「M7b 起恒为 `claude`，M10 放开 `--driver` 后才会变。」
- `run.v2.json` 的 `properties.driver.description`：「M7b 起恒为 claude，M10 起可变」

两句都在本步落地后失实——放开 `--driver` 的是 M9 第 5 步，不是 M10。

### 5.6 CODEX-07：审查件不得被当成原稿

**新增** `src/trivium/archive.ts`：

```
recordedArtifactPaths(layout, stage?): Promise<{ paths: Set<string>; unreadable: string[] }>
```

复用现成的 `listRecordedRuns`（:492），把各 run 的 `artifacts[].path` 收进 Set，
`status === 'unreadable'` 的单列 —— **不静默跳过**（与 `:520-535` 既有口径一致）。
否则「把某份 run 元数据搅坏即可绕过本判据」。

**改两处候选逻辑，必须同改**（判据逐项同形）：

- `locateSubjectReadOnly`（`topic-args.ts:520-573`）
- `locateSubject`（`topic.ts:76-119`）

规则：

- 显式 `--plan-file` / `--rca-file` 命中登记 → **硬拒绝**，用 `EXIT.MISSING_ARTIFACT`（与同函数既有错误码一致），
  文案说明「它是第 N 轮由 <某侧> 产出的审查件，不是原稿」
- 自动候选命中登记 → **从候选里剔除**，剔空了才抛，错误里列出被剔文件与理由
- 有 `unreadable` 时在错误 / notes 里点名

**判据为什么可以很干净**（三条实读依据）：

1. run 元数据落在**归档内** `<主题>/<阶段>/_meta/run-<id>.json`（不是 `~/.trivium/runs`，那是沙箱运行目录），
   论域天然按主题有界。实测本仓单主题最多 18 份（`M8-Codex审核者接入`），性能不构成约束。
2. `artifacts[]` 的写入方只有 `review.ts`：`:794` `meta.artifacts = [...metaArtifacts]`、
   `:1369-1378` 追加各侧审查文档。
3. `writeArtifact` 全仓只在 `review.ts:1147` 被调，role 恒为 critic。

→ 所以**带角色后缀且 `kind === null` 的登记条目，按构造必定是审查件**；
原稿与裁决件由 Driver 手写，从不登记。

### 5.7 闸门区的 driver 位 —— `cli.ts:762`

```
checkStageArtifacts(ref.layout, stage, rerunIndex, roundCritics, artifactMeta?.driver, recorded)
```

**事实来源是运行元数据，不是新旗标**；`cmdGate` **不加** `--driver`。
与 `:745-757` 那段注释立的规矩同源（「事实来源是 `critics_selected`，不是键集」）。

### 5.8 EV-54：补 `override_reason` 写入方

`review.ts:1144` 与 `:1341` 两处 `heterogeneous: isHeterogeneous(...)` 旁补传值。

承接侧**已完整接通**，实读确认：`render.ts:99` 声明 `overrideReason?`、`:192` 落盘、`:314` 渲染成
「**与主脑同源**：本侧使用了 Claude 系模型（<理由>）」。**缺的只是 `review.ts` 的两处传值**——
`grep -rn 'override_reason|overrideReason' src/` 只命中 `render.ts` 三行，证实「无写入方」。

**只补写入方，不加 schema 的 `if/then` 机器判据**（见 §7 R-6）。

---

## 4. 测试

### 4.1 已存在、**不要重写**的两条

`test/unit/critics.test.ts:292`（非缺省 Driver **正例**）与 `:308`（非缺省 Driver **负例**）都已在，
且 `:292` 上方注释逐字写着：

> 今天它已经能通过（`resolveCriticSelection` 的 driver 是参数化的，只是**没有调用方传值**）。
> 所以这条用例今天就该在：第 5 步接上 `--driver` 时，它能回答「新做对了，还是本来就对」。

→ **本步不得再写「自己构造入参调 `resolveCriticSelection`」的用例**。
那种用例在本步这个缺口上**必然是绿的**，写了等于给自己发一张假证明。

判定依据同 `test/unit/deny-matrix.test.ts:362` 那条用例的自述：

> 「测试要覆盖调用链」这条对策本身有边界：**它覆盖的是你想到的那一段**。
> 本条补的是最上游那一段，判据因此只能是**扫真实调用点的源码**。

### 4.2 新增 / 改写

| # | 放哪 | 断言 |
| :--- | :--- | :--- |
| **T-1（C2 / J8）** | 新建 `test/integration/driver-flag.test.ts` | 真实子进程：`--driver claude --critics claude` **退 64**，输出含 `/Driver/` 与 `/二次审查/` |
| **T-2（C1 / M10 判据）** | 同上 | `--driver <SELECTABLE[0]> --critics claude` 走通选侧；`--driver X --critics X` 退 64 |
| **T-3（接线·freeze）** | **扩 `test/unit/deny-matrix.test.ts:362` 那条既有用例** | 它已在扫 `review.ts` 的 `await freeze({` 实参块断言 `topic:`；本步补断言 `driver:` 的**值表达式**。扩既有用例而不是另起，因为那条已经锁定「`review.ts` 里应当只有一处 `freeze()` 调用」 |
| **T-4（接线·其余）** | 新建 `test/unit/driver-wiring.test.ts` | 同款扫源码：`newRunMeta({`、`cli.ts` 两处 `resolveCriticSelection(`、`topic-args.ts` 的 `locateSubjectReadOnly(` 第 5 实参、`run-protocol.ts` 的 `Handoff.options` 键集 ⊇ `{critics, sessionId, allowSingle, entry, driver}`。**这是唯一能拦住「函数支持了、调用点没传」的判据** |
| **T-5（CODEX-07）** | `test/unit/topic-args.test.ts` | 造登记过的审查件 → 不得被当原稿；显式指定 → 退 65 且文案含「审查件」；**加一条反向误伤用例**：同目录另有**未登记**原稿时必须能正常选中 |
| **T-6（EV-53）** | `test/unit/topic-args.test.ts:563-618` | 改 `MODEL_FLAG_PENDING` 判据、**取消 skip**；`:611-613` 的 `for (const c of CRITICS)` 改为减 Driver 的清单；**新增**：报错文案里**不得**出现当轮 Driver |
| **T-7（EV-53 正例）** | 同文件 `:620-643` | 保留 `SELECTABLE[0]` 采样；**新增** `--driver <SELECTABLE[0]> --model-claude m-1` 必须**放行**——证明新判据是「本轮实际能入选谁」，不是又一个写死清单 |
| **T-8（留痕）** | `test/unit/run-meta.test.ts` | `driver: 'gemini', driverEnabled: false` → 落盘正确且 `validateRunMeta` 返回 `[]`；另一条：不传 `driverEnabled` 的历史形状仍合契约 |
| **T-9（EV-54）** | `test/unit/render.test.ts` + `run-meta.test.ts` | `heterogeneous === false` 时 `override_reason` 非空，front-matter 与运行元数据两处同值 |

### 4.3 EV-52 三条 skip 的复查结论（实读）

- `test/unit/topic-args.test.ts:592`（`MODEL_FLAG_PENDING.length === 0`）→ **因本步恢复**（T-6）
- `test/unit/config-migrate.test.ts:364` / `:416` → **不恢复**。判据是 `configurableVendors()`
  （`schemas.ts:102-110`），只取决于配置 schema 的 `oneOf` 分支，与 `--driver` 无关

### 4.4 夹具

`test/helpers/critic-fixtures.ts:52` 的 `SELECTABLE = CRITICS.filter(c => c !== DEFAULT_DRIVER)`
**本步不改** —— 本步的 Driver 由旗标决定，不由夹具决定。
`:49` 那句「M10 放开 `--driver` 之后，这里的 `DEFAULT_DRIVER` 要改成『当轮 Driver』，届时**只改这一处**」
**仍然有效**，只是触发时点应改记为 M10 的 skill 层 Driver 感知（本步不动它）。

---

## 5. EV-54 纳入本步的依据（三条，都可核）

1. 触发条件原文就是「**M9 第 5/6 步**」（`BACKLOG.md:151`），本步在射程内。
2. 第 4 步推后的**唯一理由**是「本步 claude 一次也选不上（`--critics claude` 必退 64），
   补的写入方没有任何路径能端到端验证」。**这个理由被本步当场消灭**：
   `--driver <非 claude> --critics claude` 之后 claude 真能入选。
3. **不做的代价落在第 6 步的验收凭据上**：`isHeterogeneous`（`adapters/base.ts:1670-1673`）
   实读是 `return !/claude/i.test(model)`，对 claude 系模型恒返回 `false`；
   而第 6 步的验收剧本正是 `--critics claude`。→ J4 产出的那份运行元数据必然带
   `heterogeneous: false` 且**无 `override_reason`**，与 run.v2 自己 description 里
   「false 时必须有 `override_reason`」的话自相矛盾。那份留痕要作为 J4 达成证据进台账。

**边界**：本步**只补写入方**。「false ⇒ 必须有 `override_reason`」是 run.v2 自己加强的散文契约，
不是 PRD AC-18 的需求约束（AC-18 只背书「覆盖后的模型可见」，而 `model_effective` 本就落盘）。
把它升成机器判据会让历史留痕集体读不回。

---

## 6. 明确请裁定的三处

- **D3**：`topic resolve --stage all`（命令 A）要不要像拒绝 `--critics` / `--only` 那样拒绝 `--driver`？
  现状 `topic-args.ts:318-326` 对那两个是拒绝，理由是「解析成功却被交接说明静默丢弃」。
  §2.14 下 `--driver` 同样不进 skill 模板，接受即静默丢弃。**我倾向同款拒绝**，但这是判断，不是推导。
- **D4**：CODEX-07 是「硬拒绝」还是「先过滤、空了再拒」？**我倾向分两路**（§5.6），理由是 R-1。
- **D5**：`resolveRerunIndex` 两处的切分（`review.ts:559` 进本步 / `cli.ts:731` 推后为 EV-58）是否合理。

---

## 7. 风险与边界

**R-1｜CODEX-07 硬拒绝会误伤「同一主题先后换过 Driver」。**
具体形态：某主题 plan 阶段先跑 `--driver gemini --critics claude`，归档留下**登记过的**
`2026-09-18-<主题>-claude.md`（审查件）；此后同主题再跑缺省 `--driver claude`，
候选排序是 `rerunIndex desc, fileName desc`（`topic-args.ts:564`、`topic.ts:109`），
**日期更晚的那份审查件会排在真原稿前面**。硬拒绝 ⇒ 一条本来合法的工作流被永久卡死，
且用户无自救出口（原稿改名就破坏文件名解析）。
→ 处置：过滤而非拒绝；显式指定才硬拒——那是用户显式意图，必须响亮。

**R-2｜`resolveRerunIndex` 漏传 driver，非缺省 Driver 下从第 2 轮起算错。** 见 §2.1。
后果：闸门按单一轮次过滤必报缺件，或轮次抬升后运行元数据与文件名分叉（`review.ts:1065-1069` 只 warn 不阻断）。

**R-3｜接线只做这几处，其余 driver 消费方仍恒取 `DEFAULT_DRIVER`。**
实读未接线的：`hooks.ts`（`criticRoleSuffixes`，= EV-55）、`gate.ts`、`report.ts`、`naming.ts`、
`cli.ts` 闸门区、`adapters/stub.ts`。
分档：`hooks` 侧 M9 代价为零（只有一个 Driver 启用）但已由 EV-55 登记；
`gate` / `report` 在非缺省 Driver 下会把 Driver 的原稿 / 裁决件误算成审查件。
→ **已在 §1.2 逐条具名**，否则读的人会以为 `--driver` 已经全链路可用。

**R-4｜`prepareRun` 不复查 Driver 排除。** 见 §5.5。

**R-5｜落盘层没有「driver ∉ critics_selected」的机器判据。**
实读 `schemas.ts:255-297` 的 `checkAgentIdentities` 只有三条规则：`driver` 是已登记 id、
`critics_selected` 元素已登记、`critics` 键的 vendor 与注册表一致且 ⊆ `critics_selected`。
**没有 Driver 互斥那条。** 今天只靠 `resolveCriticSelection` 一道上游拦截，
而本步正让 driver 第一次由外部输入决定。→ 登记 EV-59（§8）。

**R-6｜`driverEnabled` 不校验的留痕口径（本步唯一真正不可逆的选择）。**
按 §6.1 落地后，归档里会出现 `driver: 'codex', driver_enabled: false` 的运行元数据；
M10 收紧成 `driverEnabled` 校验后，**那些历史留痕仍要能读回**。
所以 `driver_enabled` 必须是**可选**字段、顶层 `additionalProperties: true` 必须保持、
**不得**给它或 `override_reason` 加 `if/then`。

**R-7｜`--driver` 进 `STATIC_FLAGS` 的副作用。**
`topic resolve` 的正文里若逐字出现 `--driver`，它会被识别为旗标并吞掉下一个 token。
`findSwallowedFlags`（:163）只在**没显式给该旗标**时提醒。这是既有的固有歧义
（`topic-args.ts:117-124` 已论证），**但本主题自身就是高危语料**——
本步之后，任何讨论 `--driver` 的审查焦点都可能撞上它。

**R-8｜成本/配额。** 5.0～5.8 全部零配额（纯单测 + 类型检查）。配额只在第 6 步验收发生。

---

## 8. 本步新登记的两条台账

- **EV-58**：`cli.ts` 闸门区的 `resolveRerunIndex`（:731）与三处 `inferLatestRunId`（:759 / :775 / :866）
  的 driver 位仍空着。取值链是**先算 rerunIndex 再读运行元数据**，存在循环依赖，
  不是补个实参就能解决。M10 第一次换 Driver 会显形。
  修法方向：有 `--run-id` 或能推断出元数据时，改用 `meta.rerun_index` 而不是重算。
- **EV-59**：`test/unit/registry-parity.test.ts:825` 的注释声称
  「`critics_selected` 含当轮 Driver 会触发身份补校的互斥规则」，**实核不存在**（见 R-5）。
  该用例里 `if (spare === DEFAULT_DRIVER) continue;` 的**排除本身无害**
  （那一格本来就会通过），但注释会让读的人以为落盘层有第二道防线。
  注释失实要修；补不补那条规则属设计决策，不在本步。

---

## 9. 不可逆决策

| 决策 | 选择 | 理由 | 回滚方式 |
| :--- | :--- | :--- | :--- |
| `--driver` 校验强度 | 只校验「已登记」，`driverEnabled === false` 不拒但如实标注 | 校验 `driverEnabled` ⇒ 当前只有 claude 合法 ⇒ 第 6 步验收跑不成（死循环）。出处 §6.1 | 改 `resolveDriver` 一处即可收紧；但**已落盘的 `driver_enabled: false` 留痕不可回收**，这是不可逆的那一半 |
| `driver_enabled` 的契约位置 | 可选顶层字段，不进 `required`、不加 `if/then` | 见 R-6：加了历史留痕集体读不回 | 不可逆——一旦有旧留痕写出，`required` 就再也加不上 |
| `override_reason` 只补写入方 | 不升为机器判据 | 同上；且它是 run.v2 自己加强的散文契约，非 PRD 约束 | 可逆（写入方随时可去） |
| CODEX-07 判据的落点 | 按「运行元数据的 `artifacts[]` 登记」判，不按文件名形态判 | 文件名形态判会把 Driver 自己的原稿也扫进去；登记的写入方唯一且可证（§5.6 三条依据） | 可逆 |
| `--driver` 不进 skill | 本轮只作为 CLI / 编排器内部旗标 | §2.14 逐字；进 `argument-hint` 就必须同批改三份 skill 模板 | 可逆（M10 本就要做） |

---

## 10. 验收标准

```
cd /Users/chenzhenbo/Work/TriviumCode
npm run typecheck && npm run pretest
node --test "dist/test/test/unit/critics.test.js" \
            "dist/test/test/unit/topic-args.test.js" \
            "dist/test/test/unit/driver-wiring.test.js" \
            "dist/test/test/unit/review-sides.test.js" \
            "dist/test/test/unit/run-meta.test.js" \
            "dist/test/test/unit/run-meta-strict.test.js" \
            "dist/test/test/unit/registry-parity.test.js" \
            "dist/test/test/unit/deny-matrix.test.js" \
            "dist/test/test/unit/preflight.test.js" \
            "dist/test/test/unit/render.test.js" \
            "dist/test/test/unit/config-migrate.test.js"
node --test "dist/test/test/integration/driver-flag.test.js" \
            "dist/test/test/integration/topic-resolve.test.js" \
            "dist/test/test/integration/gate-loop.test.js"
npm run check
```

**判据**：

- **V1（C2 / J8）**：T-1 绿 —— 真实子进程下 `--driver claude --critics claude` 退 64
- **V2（C1）**：T-2 绿 —— `--driver <非 claude> --critics claude` 走通选侧
- **V3（接线）**：T-3 / T-4 绿 —— 扫源码判据覆盖 `freeze` / `newRunMeta` / 两处选侧 / 定位函数 / 交接文件
- **V4（EV-53）**：T-6 由 skip 转为执行且绿；`npm run check` 的跳过数 **3 → 2**
- **V5（CODEX-07）**：T-5 绿，含反向误伤用例
- **V6（留痕）**：T-8 绿 —— 新旧两种形状都过 `validateRunMeta`
- **V7（EV-54）**：T-9 绿

**变异验证**（每条都该当场红；落地后逐条实跑，红了再还原）：

| 改什么 | 哪条必须红 |
| :--- | :--- |
| 删 `cli.ts:470` 的 `driver` 实参 | T-4 |
| 删 `review.ts:650` `freeze({ … driver })` | T-3 |
| 删 `review.ts:776` `newRunMeta({ … driver })` | T-4 |
| 删 `Handoff.options.driver` | T-4 |
| 把 `topic-args.ts` 的新判据改回 `CRITICS.includes(id)` | T-6 / T-7 |
| 删 `locateSubject` 的登记过滤 | T-5 |
| 把预检提示的 `ok` 改成 `false` | `preflight.test.ts` 既有用例 |

---

## 11. 给审查员的提醒

**请回原文核，不要信本文的概括。** 本文三处最可能出问题的自证薄弱点：

1. **§5.6 的「判据可以很干净」是我的推导，不是实测。** 三条依据（run 元数据落在归档内、
   `artifacts[]` 写入方唯一、`writeArtifact` 只在一处被调）我都实读了，
   但「**带角色后缀且 `kind === null` 的登记条目按构造必定是审查件**」这句是从三条推出来的，
   我没有跑一次真实流水线去反证。请核这条推导有没有漏掉的写入路径。
2. **§3 的落地顺序里「5.1～5.4 不得留过夜中间态」是我判的**，没有机器判据看着它。
   如果有更好的切法（比如把 5.4 提到 5.3 之前），请指出。
3. **§2.1 说步骤表漏了 `resolveRerunIndex`——这是我的断言。** 我实读了签名与两处调用，
   漏传是事实；但「它属于第 5 步范围」是我的判断，步骤表原文确实没列它。
   如果认为它该归 EV-58 一起推后，请说明理由（D5）。

另有一条与审查无关但影响你们读代码的事实：**`.reviews/` 下 M9 有四个主题目录**
（`M9-ClaudeCode审核者接入` / `M9-适配器本体与准入收口` / `M9-审核者启用与夹具收口` / 本主题），
它们是同一条工作的四段，不是四件事。
