# M8 第 2 步 · 适配层契约泛化 实施计划（r2）

- **日期**：2026-09-15
- **起点**：`194ef0b`（M8 第 1 步收口，措施 b 已落地）
- **上游**：[M8 总计划](./2026-09-15-M8-Codex审核者接入-claude.md) §3 与 §4 第 2 步
- **判据**：J7 的一半（§5.1.1 接入套件）、§11.1 适配层契约泛化
- **本稿定位**：总计划 §3 给出了设计骨架，本稿把它细化到可执行，并把其中
  **三处需要裁定的取舍**显式摆出来，不替审查员做决定。

---

## 0. 为什么单独出一稿

总计划 §3 写于 M8 开工前，当时第 1 步（措施 b）还没落地。第 1 步实际落地后有两处
与 §3 的预设不同，直接照 §3 施工会踩空：

1. **`command_texts` 已经在 `CriticResult` 里了**（第 1 步随措施 b 一并加的），
   §3.2 把它列为本步新增，实际本步只需消费，不需新增；
2. **措施 b 的判定已经独立成 `checkPeerLeakViaCommand`**，与 `checkPeerLeak`
   并列接进 `judgeSide`。这直接决定了本步「路径回填」的作用域——见 §2.3，
   那是本稿与 §3 分歧最大的一处。

---

## 1. 缺口复述（对照 HEAD 实际代码）

三个消费方当前的形态：

| 消费方 | 位置 | 现在依赖什么 | codex 上为什么不成立 |
| :--- | :--- | :--- | :--- |
| `checkEvidence` | [base.ts:96](../../../src/trivium/adapters/base.ts#L96) | `read_paths` 数下限 | 路径不在结构化字段里 ⇒ `projectReads` 恒 0 ⇒ 必然 `no_project_context` |
| `checkPeerLeak` | [base.ts:137](../../../src/trivium/adapters/base.ts#L137) | `read_paths` 比 deny | 同上 ⇒ 措施 a 对该侧恒不命中 |
| `judgeSide` | [guard.ts:118](../../../src/trivium/guard.ts#L118) | `write_events.length > 0` | 被拒操作不进事件流；且 `run_command` 是读取手段 |

`consulted` 交叉核对（[guard.ts:124-135](../../../src/trivium/guard.ts#L124-L135)）是**第四个**
消费方，总计划 §3.1 漏列了它。它同样吃 `read_paths`，codex 上会让 `consultedUnverified`
恒为 true——审查员如实填了 consulted 反而被判编造。

---

## 2. 设计

### 2.1 能力声明登记在**注册表**，不随 `CriticResult` 流动

```ts
// agents/registry.ts，作为 AgentDescriptor 的新字段
export interface TraceCapability {
  /** 读取路径是否有结构化字段。false ⇒ 证据路径需从命令原文回填 */
  pathStructured: boolean;
  /** 被拒的操作是否留痕。false ⇒ 轨迹核验对「只读失守」这一半失效 */
  rejectionRecorded: boolean;
}
```

四家登记值：

| Agent | pathStructured | rejectionRecorded | 依据 |
| :--- | :--- | :--- | :--- |
| gemini | true | true | 现状行为等价 |
| glm | true | true | 现状行为等价 |
| codex | false | false | M6 P-C1 / P-C2 实测 |
| claude | true | true | M6 第 3 步 claude 探针实测 |

**为什么登记而不是让适配器随结果产出**（总计划 §3.2 原文是「由探针结论决定」）：

- 注册表是「全部 Agent 差异的唯一登记处」，`registry-parity` 以 grep 级对账守着
  「任何模块不得出现具体 Agent id 字面量」。登记在这里，`judgeSide` 用
  `agentById(critic).traceCapability` 取值，消费方零 id 字面量——纪律 7 满足；
- 更关键：**「声明」与「实测」分开，两者才能对账**。若能力只由适配器运行期产出，
  就只剩一个来源，探针测出的形状与代码假设的形状不一致时无从发现。
  登记在注册表后，探针的职责变成**校验声明**（`doctor` 层面，第 3 步落）；
- `guardLevel` 已是同族的静态护栏分级，新字段与它同层，不引入新的登记范式。

**风险与反方**：注册表值是**人写的**，写错了就是一个静默错误的单一来源。
缓解靠第 3 步的探针对账；在对账落地前，codex 的两个 false 属于「按实测登记但未机器校验」，
这一点要如实写进第 3 步的前置条件，不能当成已验证。

### 2.2 `commandSemantics` 本轮**不登记**——请重点裁这一条

总计划 §3.2 提的第三个字段：

```ts
commandSemantics: 'write-tool' | 'read-mechanism';
```

本稿建议**暂缓**，理由：**本轮找不到消费方**。

它要回答的是「`run_command` 算写事件还是读取手段」，而这个判断落在**适配器填
`write_events` 的那一刻**——`AGY_WRITE_TOOLS`（[agy-events.ts:59](../../../src/trivium/adapters/agy-events.ts#L59)）
是 agy 自己的集合，codex 适配器第 3 步会有自己的集合。**适配器本来就知道自己是谁**，
不需要读一份能力声明来决定怎么给自己分类。

先例有两条，方向一致：

- M6 计划稿原拟新增 `probeKey`，双审两侧独立判为**过度登记**（AGY-01 / GLM-04）——
  理由是「给同一个事实立第二个字段」；
- BACKLOG **EV-15**：`readonly_commands` 旋钮无消费方，已登记为不实现。

若审查员认为第 3 步的 codex 适配器确实需要它（例如 `write_events` 的分类要在
适配器之外被复核），本条推翻即可，加回来的成本是一行登记 + 一处 parity 对账。
**我不希望这条被默认通过**——它是本稿最可能判错的地方。

### 2.3 路径回填的作用域：喂 `checkEvidence` 与 `consulted`，**不**喂 `checkPeerLeak`

新增派生函数（`adapters/base.ts`）：

```ts
/**
 * 判定层使用的**有效读取路径**。
 * pathStructured=true  ⇒ 就是 read_paths（现状，零行为变化）
 * pathStructured=false ⇒ read_paths ∪ 从 command_texts 提取的路径 token
 */
export function effectiveReadPaths(
  result: Pick<CriticResult, 'read_paths' | 'command_texts'>,
  cap: TraceCapability,
  projectRoot: string,
): string[];
```

消费方接线：

| 消费方 | 吃什么 | 为什么 |
| :--- | :--- | :--- |
| `checkEvidence` | **effectiveReadPaths** | 不回填则 codex 的 `project_reads` 恒 0，AC-11 的下限对该侧永远不可能满足 |
| `consulted` 交叉核对 | **effectiveReadPaths** | 同上，否则如实填报反被判编造 |
| `checkPeerLeak`（措施 a） | **仍是 `read_paths`** | ← 见下 |
| `checkPeerLeakViaCommand`（措施 b） | `command_texts`（不变） | 它本来就是命令通道 |

**措施 a 不吃回填，是本稿的一处主动收窄**：

回填出来的路径来自命令原文，语义是「跑了一条提到该文件的命令」，**不等于**
「读到了该文件」——`git log -p` 提到某路径但未必读它，`grep -l` 列出文件名也不读内容。
把它并进措施 a，等于把措施 b 的命中原样复制一份到措施 a 的通道里：

- **处置上零增益**：两者同等处置，措施 b 已经让该侧作废；
- **排查上有损**：`peerHits` 与 `peerCommandHits` 分列的全部意义就是「看得出是哪条通道」
  （[guard.ts:26-34](../../../src/trivium/guard.ts#L26-L34) 写明了这条），
  混进去之后「为什么 deny 生效了还漏」这类问题永远查不清；
- **语义上是降级**：措施 a 声称的是文件系统级读取事实，掺入推测会让这个断言变弱，
  而它是 BRIEF 第 8 段对审查员的承诺。

代价是 codex 侧的措施 a 确实**恒不命中**——这不是被掩盖的漏洞，而是该侧本来就只有
措施 b 一条通道。**它必须进留痕**（§2.5），否则看起来像「扫了没命中」。

### 2.4 只读失守判定按 `rejectionRecorded` 分档

`SideVerdict` 增一个字段，与 `readonlyBreach` 并列：

```ts
/**
 * 该侧轨迹**无法**判定只读失守（rejectionRecorded=false）。
 * 为 true 时 readonlyBreach 恒 false 且**不具判定力**——
 * 只读保障对该侧只剩指纹比对一重（§3.3）。
 */
readonlyVerificationUnavailable: boolean;
```

判定规则：

| rejectionRecorded | readonlyBreach | readonlyVerificationUnavailable |
| :--- | :--- | :--- |
| true | `write_events.length > 0`（现状不变） | false |
| false | 恒 false，**不由轨迹判定** | **true** |

**三态纪律在能力面上的同一条**：`readonlyBreach === false` 有两种来源——「扫过、没写」
和「根本没法扫」。合成一个布尔值就是把「没测到」说成「测出来没有」。第二个字段就是
把这两者分开。指纹比对（`judgeRun` 层的 `tree_hash` + `git status`）**不受影响**，
真写了文件照样发现——所以这不是把 codex 的只读保障归零，是从三重降到两重。

### 2.5 留痕：降级必须看得见

三处落点，缺一处这个降级就等于没记：

1. **`run.v2.json` 的 `guard` 段**增 `readonly_verification`，逐审核者对象，
   与 `peer_leak_via_command` 同构（三态落在结构上：字段缺失 = 早于本次接线；
   某侧的键缺失 = 那一侧没跑；值 = 该侧的核验档位）；
2. **`report.ts` 的 `guardFlags`**（[report.ts:245](../../../src/trivium/report.ts#L245) 邻域）
   增一条：`<critic> 侧只读核验不可用（只剩指纹一重）`，与既有的
   `<critic> 侧路径级 deny 未生效` 同格式；
3. **`render.ts`** 的审查文档：该侧的保障档位进正文，让人读留痕时也看得到，
   不是只有机器可读的 run 元数据里有。

`skills/dual-critic/schema/run.v2.json` 同步改，描述里写明三态含义——
schema 的 description 是这套留痕唯一的解释面。

---

## 3. 改动清单

| 文件 | 改动 |
| :--- | :--- |
| `src/trivium/agents/registry.ts` | `TraceCapability` 类型 + `AgentDescriptor.traceCapability` + 四家登记值 |
| `src/trivium/types.ts` | 重导出 `TraceCapability`（消费方不必从 registry 取类型） |
| `src/trivium/adapters/base.ts` | 新增 `effectiveReadPaths`；`checkEvidence` 签名吃有效路径 |
| `src/trivium/guard.ts` | `judgeSide` 取能力声明并分档；`SideVerdict` 增 `readonlyVerificationUnavailable` |
| `src/trivium/report.ts` | `guardFlags` 增降级提示 |
| `src/trivium/render.ts` | 审查文档正文体现保障档位 |
| `src/trivium/run-protocol.ts` | `readonly_verification` 的读写 |
| `skills/dual-critic/schema/run.v2.json` | `guard.readonly_verification` |
| `src/trivium/adapters/stub.ts` | `StubMode` 增 `read_mechanism` 形态 |
| `test/unit/registry-parity.test.ts` | 对账：四家都登记了能力声明 |
| `test/unit/guard-capability.test.ts` | **新建**，见 §4 |

**不改**：`checkPeerLeak` 本体、`checkPeerLeakViaCommand` 本体、`AGY_WRITE_TOOLS`、
`ZCODE_WRITE_TOOLS`。既有两家的能力声明全 true，走的是与现在**逐字相同**的分支。

---

## 4. 测试计划

### 4.1 回归（最重要的一条）

**既有两家的判定结果逐项不变**。这是本步的第一验收项，因为本步是重构性质的改动，
任何行为变化都是回归而非改进。

做法：现有 `test/unit/guard.test.ts`、`adapter-base.test.ts` 全套不改一行地通过。
若有测试需要改，那说明行为变了，要当成缺陷查而不是改测试迁就。

### 4.2 新建 `test/unit/guard-capability.test.ts`

| 用例 | 断言 |
| :--- | :--- |
| `pathStructured: true` | `effectiveReadPaths` 逐项等于 `read_paths`（不是「包含」，是相等） |
| `pathStructured: false` | 命令原文里的路径进入有效路径；`read_paths` 原有项保留 |
| 措施 a 不受回填 | 只在命令里提到 deny 条目时，`peerHits` 为空、`peerCommandHits` 非空 |
| `rejectionRecorded: true` + 有写事件 | `readonlyBreach = true`、`readonlyVerificationUnavailable = false` |
| `rejectionRecorded: false` + 有写事件 | `readonlyBreach = false`、`readonlyVerificationUnavailable = true` |
| `CriticResult` 不被污染 | 回填只在判定层派生，**不回写**进 `result.read_paths` |

最后一条单列的理由：`CriticResult` 是**诚实记录**，记的是适配器实际采到什么。
判定层的派生视图回写进去，留痕就从「采到的」变成「推出来的」，事后复盘再也分不清。

### 4.3 桩的新形态

`StubMode` 增 `read_mechanism`：路径只出现在 `command_texts` 里、`read_paths` 为空。
让泛化本身有机器判据，而不是等 codex 接上才知道对不对。

集成测试断言：该形态下 `evidence_ok` 为真（回填生效），且若命令里提到 deny 条目则
措施 b 命中、措施 a 不命中。

---

## 5. 请审查者重点看

1. **§2.2 `commandSemantics` 暂缓登记**——这是本稿最可能判错的地方。
   我的论证是「本轮无消费方」，若第 3 步的 codex 适配器实际需要它，现在缓登记
   会让第 3 步返工。请直接判断第 3 步会不会用到。
2. **§2.3 措施 a 不吃回填**——这是对总计划 §3 的主动收窄。
   我认为把推测性路径掺进文件系统级断言是降级，但代价是 codex 侧措施 a 恒不命中。
   请判断这个取舍是否成立，以及 §2.5 的留痕是否足以让「恒不命中」不被误读成「扫了没命中」。
3. **§2.1 能力登记在注册表**——与总计划 §3.2 原文「由探针结论决定」有张力。
   我的解法是「注册表声明 + 探针对账」，但对账要到第 3 步才落地，中间这段
   codex 的登记值是未经机器校验的。请判断这个时序是否可接受。
4. **§2.4 的三态是否完整**——`readonlyVerificationUnavailable` 只区分了
   「能判」与「不能判」。是否还有第三种「部分能判」的形态被我漏掉了？

---

## 6. 明确不做

- **不动 codex 适配器本体**——那是第 3 步，本步只让契约能表达它；
- **不碰 `criticEnabled`**——翻早了 `realAdapters()` 当场失败（总计划第 3 步末条）；
- **不扩大措施 b 的承诺**——R25 的盲区边界不变，本步只是让它的结论接进新契约；
- **不给 codex 补路径级 deny**——三家都不支持，不是本步能解决的。

---

## 7. 一处自查

§2.3 说「措施 a 对 codex 恒不命中，但这不是漏洞」——这个断言依赖一个前提：
**措施 b 的覆盖面足以接住 codex 侧的全部泄漏通道**。而措施 b 的承诺是
「已知形态必检」，不是完备（R25）。

所以准确的说法是：codex 侧的 deny 核验**只有措施 b 一条通道，且该通道承诺的是
已知形态**。这比既有两家弱——它们有 a、b 两条。这一点应当作为 codex 接入的
**已知限制**登记进第 3 步，而不是在本步被「留痕写了」掩过去。

我没有在本步解决它，因为解法（路径级 deny 或结构化路径）都在 CLI 能力之外。
但它不该以「已处理」的面目进入第 3 步。
