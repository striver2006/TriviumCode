---
schema: trivium.disposition.v1
topic: M8-Codex审核者接入
stage: plan
role: claude
kind: revised
run_id: 20260915T103755Z
addresses:
  - 2026-09-15-M8-Codex审核者接入-r2-gemini.md
  - 2026-09-15-M8-Codex审核者接入-r2-glm.md
---

# 计划修订（r2）：M8 第 2 步 · 适配层契约泛化

## 0. 裁决总览

**16 条全部接受，零驳回**（gemini 7 条 + glm 9 条）。两侧均判 `request-changes`，
gemini 给出 1 条 blocker。

**六对独立收敛**：AGY-01≡GLM-02、AGY-02≡GLM-01、AGY-03≡GLM-04、AGY-05≡GLM-08、
AGY-06≡GLM-05(c)、AGY-07≡GLM-09。

### 0.1 根因：我没读 r1 裁决件

r2 稿的十六条里有**十条**指向同一件事——**r2 相对 r1 裁决出现静默回退**。
两侧各自独立地用「r1 已接受并承诺」为依据把我驳回，而我拿不出任何推翻那些结论的新证据，
因为我起草 r2 时**根本没打开 `-revised-claude.md`**。我只读了总计划 `-claude.md`，
就以为掌握了上游。

四处回退，逐一核实属实：

| # | r1 已裁定 | r2 写成了什么 | 核实 |
| :--- | :--- | :--- | :--- |
| 1 | `TraceCapability = { traceShape: 'tool-trace' \| 'command-trace', rejectionRecorded }`（r1 §2.3） | 拆回 `pathStructured`，并宣称 `commandSemantics` **无消费方**建议暂缓 | r1 §2.3 原文「`pathStructured` 与 `commandSemantics` 合并进 `traceShape`，消费方有两个」 |
| 2 | 挂 **`CriticAdapter`**（`readonly capability`），明确「不挂 `CriticResult`」（r1 §2.3） | 改成登记在**注册表** | r1 §2.3「挂载点（AGY-03 的第二问）」段 |
| 3 | `checkEvidence` **两条口径写死**：`project_reads` 提取启发式与漏报边界、`toolTotal` 计入 `run_command`、`min_project_reads` 单独定阈值或「下限不适用」（r1 §2.2） | 只剩一个函数签名，`toolTotal` 整条丢失 | r1 §2.2 第 1、2 条 |
| 4 | 降级留痕按**五面**落地（r1 §2.4） | 只写三面，缺 front-matter 与 `renderGuardWarnings` | r1 §2.4「新字段按五面落地，比先例多补运行时那一面」 |

**这与 r1 自己记下的教训是同一条的第四次复发**：r1 §2.2 写着「**限定/口径必须跟着结论一起搬家**」。
这次搬家丢的不是限定，是**整份裁决**。

**方法上的处置**（不是文档修辞，是下一轮的硬前置）：
起草任何 `-rN-claude.md` 之前，**必须先读同主题同阶段的全部 `-revised-claude.md` / `-response-claude.md`**，
并在新稿里显式列出「本稿与上一轮裁决的差异及理由」一节。
无差异就写「无」；有差异必须给出推翻理由，而不是静默改掉。
这一节缺失时，本轮裁决视为未完成。

### 0.2 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | 阻断 | 接受 | 核实为真且是我写错了逻辑：`rejectionRecorded=false` 的实测语义是「被拒操作不留痕」，成功写命令**照常产生事件**（P-C1 样本即 `status:"completed"`）。我把「阴性结论不可信」写成了「阳性证据也丢弃」 | §1.1 重写 §2.4 规则表；§4.2 两行断言改写 |
| GLM-02 | glm | 重要 | 接受 | 同一缺陷，且多指出一条连带后果比 AGY 更远：真失守被压成 `breach=false` 后，`guard.ts:122-123` 的漂移判定会把审查员的写入归因成**开发者手改**，方向正好反了 | 同上；§1.1 记入归因链 |
| AGY-02 | gemini | 重要 | 接受 | 核实为真：`base.ts:104` 的 `toolTotal = read+grep+glob`，不含 `run_command`。codex 侧三者恒 0 ⇒ 必触 `insufficient_evidence`。我宣称的「无消费方」当场证伪 | §1.2 恢复 r1 的 `traceShape`；`checkEvidence` 两条口径写死 |
| GLM-01 | glm | 重要 | 接受 | 同上，且把返工点定得更准：**返工发生在本步，不是第 3 步**——§4.3 的 `read_mechanism` 桩断言 `evidence_ok` 为真，不裁定计数口径就无法成立（`stub.ts:145` 的 `read:6` 要么伪造形状、要么清零恒红） | 同上；§4.3 桩形态连带处置 |
| AGY-03 | gemini | 重要 | 接受 | 核实为真且是我**自己的承诺没兑现**：§2.3 写「它必须进留痕（§2.5）」，而 §2.5 三处落点全部只针对 `readonly_verification`，措施 a 无输入可扫这件事零落点 | §1.3 补路径通道档位留痕 |
| GLM-04 | glm | 重要 | 接受 | 同上，并排除了一个我可能拿来搪塞的替代：既有「路径级 deny 未生效」旗标说的是 CLI deny 注入（第 ③ 道 (c) 层），与「措施 a 无结构化输入」是两件事，盖不住 | 同上 |
| AGY-04 | gemini | 重要 | 接受 | 核实为真：`critics.ts:128-134` 在 `criticEnabled=false` 时抛 `EXIT.USAGE`，而本步「不碰 `criticEnabled`」。集成测试只能选 gemini/glm，两者恒 `tool-trace` ⇒ §4.3 桩形态**逻辑上跑不通** | §1.4 挂载点回到 `CriticAdapter`（即 r1 原裁决） |
| GLM-03 | glm | 重要 | 接受 | 核实为真：r1 §2.4 钉死五面，r2 缺 front-matter（`render.ts:100-107` 有现成先例位）与 `renderGuardWarnings`（`guard.ts:217-278` 无降级行）。§2.5 自己写「缺一处就等于没记」，缺的恰是裁决点名要补的两面 | §1.3 恢复五面 |
| GLM-05 | glm | 重要 | 接受 | 三条全核实为真：(a) §24.1 台账「11.1 适配层契约泛化」批 B-契约、纪律是「工前并入」，本步正在实施却无设计修订条目；(b) schema 增字段的四处连带同步未列；(c) `run-protocol.ts` 全文 `guard` 出现 0 次 | §1.5 §3 补四行同步义务 + 落点更正 |
| AGY-06 | gemini | 次要 | 接受 | 与 GLM-05(c) 同一事实，独立收敛。`meta.guard` 的写入在 `review.ts:978-998`，读侧在 `report.ts` / `meta.ts` | 同上 |
| GLM-06 | glm | 重要 | 接受 | 核实为真：r1 §2.2 明文承诺「提取启发式与漏报边界必须写清」「`min_project_reads` 要么单独定阈值、要么按『下限不适用』处置」，r2 只剩签名。四组未决口径（路径 token 边界、相对路径 cwd、`HEAD:<path>` 与通配、写命令提到的路径）直接决定 J4 在 codex 侧可达性 | §1.2 连同 `toolTotal` 一并写死 |
| AGY-05 | gemini | 次要 | 接受 | 核实为真：`test/unit/guard.test.ts` 不存在（实有 49 个测试文件，无此文件）。我把它列为「第一验收项」，是虚构判据 | §1.6 §4.1 改真实清单 |
| GLM-08 | glm | 次要 | 接受 | 同上，且多指出一处自相矛盾：`adapter-base.test.ts:23-31` 以结果对象形态调用 `checkEvidence`，§3 一改签名这些调用点必改，而 §4.1 的「不改一行 + 要改就当缺陷查」会把纯机械适配误当回归排查 | 同上；措辞按 GLM 建议改写 |
| GLM-07 | glm | 次要 | 接受 | 核实为真：`AgyProbe` / `ZcodeProbe` 无对应字段，「探针校验声明」对既有两家不闭合；且 `CodexProbe` 两处消费方注释在注册表接管后会指向已被取代的路径 | §1.4 写明对账范围；§3 的 `types.ts` 行补注释更新 |
| AGY-07 | gemini | 次要 | 接受 | 核实为真：本步正是措施 a 被主动收窄的那一刻，契约却不载明「只剩单通道」，构成文档脱节 | §1.7 本步即登记 |
| GLM-09 | glm | 吹毛求疵 | 接受 | 同源，且给出更省的落法：合成结论目前只活在散文与 `base.ts` 的 B-2 注释里，EV-01/EV-16/R25 各记局部事实，无一承载它。加一行 BACKLOG 成本极低 | 同上；BACKLOG 加一行 |

---

## 1. 逐项处置

### 1.1 只读失守分档：规则表改写（AGY-01 ≡ GLM-02）

**我错在把「阴性结论不可信」写成了「阳性证据也丢弃」。**

M6 报告 P-C2 断言的是「**被沙箱拒绝的**命令一条事件都不产生」；P-C1 的样本本身就是
`status:"completed"`、`exit_code:0` 的 `command_execution`——**成功命令照常留痕**。
所以 `rejectionRecorded=false` 的准确语义是「**尝试写**的检测失效」，
不是「轨迹对写事件全盲」。

规则表改为：

| rejectionRecorded | readonlyBreach | readonlyVerificationUnavailable |
| :--- | :--- | :--- |
| true | `write_events.length > 0` | false |
| false | `write_events.length > 0`（**同样成立**） | `write_events.length === 0` 时为 true |

即：`readonlyBreach` 两档一律由写事件判定；`readonlyVerificationUnavailable`
只修饰**阴性结论**的可信度——「没检出写事件」在该侧不足以排除失守。

**连带的归因链必须一并修**（GLM-02 独有的发现，价值最高的一条）：
`guard.ts:122-123` 的 `fingerprintChangedFiles` 语义是「指纹变化但轨迹无写事件 ⇒ 开发者手改」。
若真失守被压成 `breach=false`，漂移判定会把**审查员的写入记到开发者头上**。
第 2 步实现时要确认：`readonlyVerificationUnavailable=true` 的侧发生指纹变化时，
归因不得直接走「开发者手改」分支，而应标注为**无法归因**。

§4.2 的两行断言随之改写：`rejectionRecorded:false + 有写事件 ⇒ breach=true`、
`rejectionRecorded:false + 无写事件 ⇒ breach=false 且 unavailable=true`。

### 1.2 恢复 `traceShape` 枚举与 `checkEvidence` 两条口径（AGY-02 ≡ GLM-01、GLM-06）

回到 r1 §2.3 的裁定：

```ts
export interface TraceCapability {
  /** 轨迹形态：专用工具带结构化路径，还是 shell 命令 */
  traceShape: 'tool-trace' | 'command-trace';
  /** 被拒的操作是否留痕（false ⇒ 该侧「尝试写」的检测失效） */
  rejectionRecorded: boolean;
}
```

我在 r2 §2.2 论证「`commandSemantics` 无消费方」时，**漏掉的消费方就是 `checkEvidence` 的 ②**。
`base.ts:104` 的 `toolTotal = read+grep+glob` 不含 `run_command`，codex 侧三者恒 0——
回填路径只救 ③ `project_reads`，救不了 ②。GLM-01 把返工点定在本步是对的：
§4.3 的桩断言 `evidence_ok` 为真，不裁定计数口径就无法成立。

**本步写死的口径（r1 §2.2 的两条，一条不少）**：

1. **`toolTotal`**：`command-trace` 族计入 `run_command`；
2. **`project_reads`**：从 `command_texts` 提取项目内路径去重计数，**提取规则与漏报边界写进设计 §11.1**。
   四组口径逐一裁定（GLM-06 列出的）：
   - 哪些 token 算路径（引号包裹、含空格与中文）；
   - 相对路径按什么 cwd 解析——**不得比措施 b 更宽松**（`base.ts:533-552` 对相对 token
     只认纯回退层级并明说 cwd 不可知），更宽松就必须给出理由；
   - `HEAD:<path>` 与通配是否提取；
   - 写命令提到的路径（`echo > f`）算不算「读」；
3. **`min_project_reads`**：对 `command-trace` 族**单独定阈值或按「下限不适用」处置**，
   不沿用为结构化轨迹定的那个数。提取系统性偏低，沿用就是给该族设了一道不可达的闸。

§4.2 为每组口径各配正负例，不用「命令原文里的路径进入有效路径」这条笼统断言。

**`commandSemantics` 枚举本身不单独登记**——GLM-01 说得对，写事件分类确属适配器内部知识；
但它的**消费语义**（`run_command` 在 command-trace 族计入证据）由 `traceShape` 承载，
不跟着枚举一起丢。这是我 r2 唯一论证方向没错、但结论搬错了的地方。

### 1.3 留痕恢复五面，并补路径通道档位（GLM-03、AGY-03 ≡ GLM-04）

r1 §2.4 钉死的五面，逐面恢复：

1. `run.v2.json` 的 `guard` 段新字段；
2. **审查文档 front-matter 标记**（`render.ts:100-107` 有 `peer_deny` / `consulted_unverified` 先例位）；
3. 正文横幅；
4. `report.ts` 的 `guardFlags`；
5. **`renderGuardWarnings` 增一行运行时告警**（`guard.ts:217-278` 现有六类无降级行）。

**并且留痕要覆盖两个通道，不是一个**——这是我 §2.3 承诺了却没在 §2.5 兑现的：

| 档位 | 记什么 | 触发 |
| :--- | :--- | :--- |
| `readonly_verification` | 「尝试写」检测是否可用 | `rejectionRecorded=false` |
| `path_verification` | 措施 a 是否有结构化输入可扫 | `traceShape='command-trace'` |

第二个是新增的。没有它，codex 侧 `peerHits` 恒为空数组，
在 run 元数据与报告里与「扫过、没命中」**完全同形**——这正是 §2.3 说要避免的误读。
既有的「路径级 deny 未生效」旗标不能复用：它说的是 CLI deny 注入是否生效（第 ③ 道 (c) 层），
与「无结构化输入可扫」是两件事（GLM-04 已排除）。

### 1.4 挂载点回到 `CriticAdapter`（AGY-04、GLM-07）

r1 §2.3 定的是 `CriticAdapter` 上的 `readonly capability: TraceCapability`，
并明确「不挂 `CriticResult`」。我 r2 改成注册表登记，AGY-04 指出了直接后果：
`critics.ts:128-134` 在 `criticEnabled=false` 时抛 `EXIT.USAGE`，而本步不碰 `criticEnabled`——
集成测试只能选 gemini/glm，两者恒 `tool-trace`，§4.3 的桩形态**在静态注册表下逻辑不可跑**。
挂 `CriticAdapter` 则桩适配器可以声明自己的能力，泛化才有机器判据。

**我 §2.1 的论证保留、结论撤回**：「声明与实测分开、两者才能对账」这个论点 GLM-07 也认可
（「注册表方向与时序都可接受」），它对挂 `CriticAdapter` 同样成立——适配器的 `capability`
是静态声明，探针测的是实际行为，两者照样能对账。我错的是把「需要一个静态声明」
推成了「必须登记在注册表」，而注册表那条路恰好堵死了可测试性。

**对账范围写清**（GLM-07）：`AgyProbe` / `ZcodeProbe` 无对应字段，
机器对账**仅对 codex（及 M9 的 claude）**做；gemini / glm 以**适配器现状行为等价**为据。
不写清范围就是一次可预见的返工。
连带：`CodexProbe.trace_path_structured` / `rejected_command_in_trace` 两处消费方注释
要在本步更新（现写「M8 的 project_reads 统计与禁读核验」，接管后消费方变成 doctor 对账），
列入 §3 的 `types.ts` 行。

### 1.5 改动清单补同步义务与落点更正（GLM-05、AGY-06）

**落点更正**：`readonly_verification` / `path_verification` 的读写
**不在** `run-protocol.ts`（全文 `guard` 出现 0 次，它是 `--start`/`--wait`/`--cancel` 长调用协议），
写在 `review.ts:978-998`，读在 `report.ts` / `meta.ts`。

**补四行同步义务**：

1. 设计文档 §11.1 / §10.1 回补并升补丁版本——§24.1 台账把「11.1 适配层契约泛化」
   登记为 **B-契约**，纪律是「所属里程碑**工前并入**、准入前置」，本步正在实施它；
2. `doc/03_api/PROTOCOL_dual_critic_relay.md`；
3. `skills/dual-critic/SKILL.md`；
4. `AGENTS.md` 契约面。

后三项是 `AGENTS.md`「改动同步清单」里 JSON Schema 行的四处连带，r1 §2.4「连带」段已点名过。

### 1.6 回归基准改真实清单（AGY-05 ≡ GLM-08）

`test/unit/guard.test.ts` **不存在**，我虚构了它并把它列为第一验收项。
基准改为实有文件：`adapter-base.test.ts`、`peer-leak-command.test.ts`、
`known-forms-parity.test.ts`、`run-meta.test.ts`。

措辞同时改（GLM-08 的第二层）：原文「不改一行地通过；若有测试需要改，那说明行为变了，
要当成缺陷查」与 §3 的「`checkEvidence` 签名吃有效路径」**自相矛盾**——
`adapter-base.test.ts:23-31` 以结果对象形态调用它，签名一改必改调用点。
改为：**断言逐项不变，调用点允许随签名做机械适配**。签名重构不是行为变化，
不该与「当缺陷查」共用同一条规则。

### 1.7 单通道限制本步即登记（AGY-07 ≡ GLM-09）

本步正是措施 a 被主动收窄的那一刻，契约却不载明「只剩单通道」，构成文档脱节。
本步交付时落两处：

1. 设计 §10.1 / §11.1 的已知限制段；
2. `doc/08_project/BACKLOG.md` 加一行，承载**合成结论**：
   「`command-trace` 族审核者的 deny 轨迹核验仅剩措施 b 一条通道，且仅覆盖已知形态」。
   EV-01 / EV-16 / R25 各自只登记了局部事实，无一承载它（GLM-09 核实）。

第 3 步引用该条，而不是重新发明。

---

## 2. 两处对我自己的更正

1. **§2.2 「本轮找不到消费方」是错的**，且证伪只需读一眼 `base.ts:104`。
   我是在没打开 r1 裁决、也没核对 `checkEvidence` 实现的情况下写下那句话的，
   还把它标成「本稿最可能判错的地方，不希望被默认通过」——
   自评风险的位置找对了，但**没做本该做的核实**。标注风险不能替代核实。

2. **§4.1 引用了不存在的 `test/unit/guard.test.ts`**。
   两侧都当场 Glob 出实有文件清单打穿了它。我在写「第一验收项」时没有验证文件存在。

---

## 3. 未采纳的部分

无。16 条全部接受。

需要说明的是：**这不是照单全收**。十条指向 r1 裁决回退，我逐条打开 `-revised-claude.md`
原文核对，条条对得上；其余六条中，`guard.test.ts` 不存在、`run-protocol.ts` 无 `guard` 读写、
`base.ts:104` 不含 `run_command`、`critics.ts` 在 `criticEnabled=false` 时抛 `EXIT.USAGE`、
`stub.ts:145` 的 `read:6`、P-C2 只断言被拒命令——**全部是可验证的事实断言，我逐条跑了核实**。
没有一条属于「意见分歧」，所以没有可驳回或暂缓的。
