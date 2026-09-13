# Agent 注册表与多审泛化 · 实施计划

> - **角色**：Driver（Claude Code），后缀 `claude`
> - **日期**：2026-09-13
> - **阶段**：plan（待双审）
> - **上游**：
>   ① 提案稿 [`2026-09-13-通用Agent编排与动态多审设计-glm.md`](../../../doc/02_design/2026-09-13-通用Agent编排与动态多审设计-glm.md) v0.1.4（ZCode 起草，下称「提案」）
>   ② [主设计 v1.2.5](../../../doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md)（唯一实现依据）
>   ③ [PRD v1.3.1](../../../doc/01_requirements/PRD_driver_dual_critic.md)、[LLD_orchestrator](../../../doc/02_design/LLD_orchestrator.md)、[PROTOCOL](../../../doc/03_api/PROTOCOL_dual_critic_relay.md)
> - **本文定位**：对提案逐项裁定，补其漏项，收紧其验收口径，给出**可分阶段回退**的实施计划。本文是实施依据的候选；经双审与人工批准后回溯修订主设计与 PRD（纪律 1，禁止两套规范并行）。

---

## 0. 结论速览

**总体裁定：接受提案的中心方案（Agent 注册表派生一切差异），接受 R-1～R-6 的功能形态，但三处必须改。**

| # | 裁定 | 对象 |
| :--- | :--- | :--- |
| D-1 | **接受**注册表中心方案与五件套契约 | 提案 §5.1 |
| D-2 | **收紧** AC-N5「核心流程零改动」口径：分拆为「Critic 路径零改动（可验收）」与「Driver 路径受限改动（枚举白名单）」——原口径不可达，理由见 §2.1 | 提案 §7.6、AC-N5 |
| D-3 | **驳回**「deny 矩阵按后缀集差集生成」：后缀无法区分「Driver 原稿」与「同一 Agent 历史审查产出」，是隔离破洞而非留痕问题。改为**按归档索引的角色登记**生成，见 §3.1 | 提案 §8.1、R23 |
| D-4 | **补全**提案 §4 漏掉的 4 处硬编码点，其中 2 处泛化后会**静默出错**（不报错、结论错），见 §2.2 | 提案 §4 |
| D-5 | **裁定** joint blocker 三审语义：提案「任意两个审核者均驳回」在三审下留有空洞，见 §3.2 | 提案 §9.1 |
| D-6 | **改造** M7 的回退性：拆 M7a/M7b，把契约升版与内部重构分到不同可回退单元，见 §4 | 提案 §14 |
| D-7 | **下调** M7 工作量估计：`runBothSides` 现状已是 N 路 `allSettled`（非双侧硬编码），提案高估了并行层的改造量，见 §2.3 | 提案 §4 #11 |

**待人工拍板**：提案 §16 八项我在 §5 给出建议值，其中 #1（默认审核者数）与 #4（三档挂 Agent 还是挂模型）需项目负责人确认后才进 M7。

---

## 1. 现状核实结论

提案 §4 的 20 点硬编码清单我逐点对照了工作树，**结论：18 点准确，1 点高估，另有 4 点遗漏**（遗漏项见 §2.2）。核实到的关键事实：

| 位置 | 现状 | 对泛化的意义 |
| :--- | :--- | :--- |
| `src/trivium/types.ts:17,24,25,27` | `CriticId = 'gemini'\|'glm'`，`CRITICS`/`CRITIC_VENDOR`/`CRITIC_PREFIX` 三张字面表 | 三张表正是注册表的雏形——注册表是**替换它们**，不是新加一层 |
| `src/trivium/types.ts:336,341` | `critics` 与 `peer_deny_applied` **已是** `Partial<Record<CriticId,…>>` map | run.json 的 critics 段无需结构改造，只需 key 集合放开 |
| `src/trivium/runner.ts:158-200` | `runBothSides` 按 `Object.keys(input.requests)` 动态 `allSettled` | **已经是 N 路**，见 §2.3 |
| `src/trivium/freeze.ts:48` | `peerRole = critic === 'gemini' ? 'glm' : 'gemini'` | 二元三目，必改；且只枚举 `*-<peer>.md`（漏 `_meta`，提案已登记） |
| `src/trivium/disposition.ts:240-243` | `inferSource` 末行 `return id.startsWith('AGY-') ? 'gemini' : 'glm'` | **静默误判**，见 §2.2 |
| `src/trivium/archive.ts:66` | `resolveRerunIndex` 里 `if (i.parsed.role === 'claude') continue` | **提案未登记**，Driver 任意化后直接错，见 §2.2 |
| `src/trivium/config.ts:101-128` | `critics.{gemini,glm}` + `profiles.*.{gemini,glm}` 裸 slug | 与提案 §11 一致，v1→v2 迁移必要 |

---

## 2. 对「核心流程零改动」的裁定（焦点一）

### 2.1 D-2：原口径不可达，必须分拆

提案 AC-N5 的验收方式是「桩 Agent 接入后 freeze/brief/runner/gate/archive/hooks **无 diff**」。这个口径对 **Critic 路径成立**，对 **Driver 路径不成立**，理由是提案自己写下的 §7.5：

- `guardLevel: 'L1' | 'L2'` 是注册表里的**枚举字段**，但它的消费端是**分支逻辑**：L1 走 Hook 拦截，L2 走 approve 前置复核 + 漂移复算。新增第五家 Agent 若带来第三种护栏形态（例如有 Hook 但无 Stop 事件），`guardLevel` 的值域和分支都要改。
- `hooks.json` 的多目标合并（提案 §9.3）是**目标表驱动 + 每家配置格式各异**：Claude 的 `.claude/settings.json` 与 ZCode 的 Hook 配置键名、嵌套形状不同，合并逻辑不可能纯数据驱动。
- 提案 §7.6 的桩 Agent 是 `probe+registry+stub adapter+lens+假入口`——**它是 critic-only 的**，跑不到 Driver 路径，因此「无 diff」这个验收本身就没覆盖 Driver 侧。

**这不是提案的缺陷，是「任意 Agent 可为 Driver」的固有代价**：Critic 是编排器拉起的受控子进程，接口由我们定义，可以完全数据驱动；Driver 是人的交互面，护栏能力由厂商决定，天然异构。提案已经诚实写了「不追求四家 Driver 护栏能力拉齐」（§1.3），但 AC-N5 的口径没跟上这条 Non-Goal。

**改为**：

| 验收 | 口径 | 验证 |
| :--- | :--- | :--- |
| AC-N5a | **Critic 路径零改动**：新增 critic-only Agent 后，`freeze / brief / runner / gate / archive / disposition / naming / schema 生成` 八个模块**逐字节无 diff** | 桩 critic Agent 夹具（提案 §7.6 保留） |
| AC-N5b | **Driver 路径受限改动**：新增 Driver-capable Agent 时，允许改动的文件限于**白名单**：`agents/registry.ts`（注册项）、`hooks.ts` 的目标表常量、`install.ts` 的 `installTargets[]`、协议片段模板目录。白名单外任何 diff 判失败 | 新增契约测试 `driver-onboarding-scope.test.ts`：以 git diff 对照白名单 |

AC-N5b 比「零改动」弱，但它**可验收且诚实**；「零改动」写进验收标准只会在接入第五家时被迫解释豁免，那正是纪律 1 要避免的两套规范。

### 2.2 D-4：提案 §4 遗漏的 4 处硬编码点

前两处泛化后会**静默出错**——不抛异常、不退非零码、结论直接是错的，因此优先级高于提案已登记的任何一点。

| # | 位置 | 现状 | 泛化后的故障 | 处置 |
| :--- | :--- | :--- | :--- | :--- |
| A-1 | `disposition.ts:240-243` `inferSource` | `return id.startsWith('AGY-') ? 'gemini' : 'glm'` | **静默误判**：`CODEX-03` 不以 `AGY-` 开头 → 归入 `glm`。裁决差集按错误来源比对，gate 可能放过缺口、也可能报假缺口 | 改为注册表 `findingPrefix → AgentId` 的**显式查表**；**无匹配返回 `null` 并让调用方报错**，禁止兜底到任一 Agent |
| A-2 | `archive.ts:66` `resolveRerunIndex` | `if (i.parsed.role === 'claude') continue`（「原稿与裁决件不决定轮次」） | **静默错轮次**：ZCode 为 Driver 时 `-glm.md` 原稿被当成审查件参与 `max` 计算，重跑轮次凭空 +1，`gate --check-artifacts` 按单一轮次过滤时报缺件 | 判据改为 `i.parsed.role === <当轮 driver 的 suffix>`；`resolveRerunIndex` 签名增 `driver` 参数 |
| A-3 | `naming.ts:136` `looksLikeRoleArtifact` | `/-(?:claude\|gemini\|glm)\.md$/` | 新后缀 `-codex.md` 落进 `_meta/` 时不再被 AC-07 检查器识别 | 正则由注册表后缀集生成；纳入 `registry-parity` 对账 |
| A-4 | `disposition.ts:264` `isFallbackId` | `/^(AGY\|GLM)-F\d+$/` | `CODEX-F1` 不被识别为 fallback 虚拟编号 → 裁决校验把它当真实意见 id 处理 | 同上，前缀集由注册表生成 |

A-1 与 A-2 共同的性质：**二元假设被编码成了「非 A 即 B」而不是「查表」**。泛化的第一条实现纪律因此定为：**任何从值反推 Agent 的函数必须返回 `AgentId | null`，禁止三目兜底**；`registry-parity.test.ts` 增负例——喂一个未注册前缀，必须得到 `null` 而非任意 Agent。

### 2.3 D-7：并行层工作量下调

提案 §4 #11 写「`runBothSides`/`decideMode` 双侧语义 → `runSides`（N 路 allSettled）」，估在 M7 的 3 天里。核实结果：

```ts
// runner.ts:158-163（现状）
const sides = (Object.keys(input.requests) as CriticId[]).filter((c) => input.requests[c]);
const settled = await Promise.allSettled(sides.map((c) => runOneSide(input, c, input.requests[c]!)));
```

**已经是 N 路**。`runBothSides` 只是名字还叫「Both」。真正要改的只有 `decideMode` 的返回值语义（`'dual'|'single'` → `'full'|'partial'`）与 `okSides.length === 0` 的 abort 判据（现状对 N 侧已正确）。

同理 `types.ts:336,341` 的 `critics` / `peer_deny_applied` 已是动态 map。

**结论**：M7 的并行与 run.json 结构改造量显著小于提案估计，省下的预算应转移到 §3.1 的 deny 矩阵重做（那一项提案低估了）。M7 总预估维持 3 天不变，内部配比调整。

---

## 3. N 侧隔离与裁决泛化的破洞（焦点二）

### 3.1 D-3：deny 矩阵按后缀生成是**隔离破洞**

提案 §8.1 定义：

> 审核者 c 的禁读 = 后缀 ∈（全部注册后缀 − {c.suffix, driver.suffix}）的全部角色工件

并在下方注明「Driver 后缀文件（原稿/裁决件）对全部审核者是**合法输入**，不禁」。

**这里有洞。** 提案 §5.2 自己写了：「**同一后缀在不同运行中可能是 Driver 也可能是审核者**」，并把它登记为 R23「留痕误读」风险。但它的后果不止是留痕误读——它直接击穿 deny 矩阵：

设某主题历史上跑过两轮：
- 第 1 轮：Driver = ZCode，审核者 = {claude, gemini} → 产出 `2026-09-12-X-claude.md`，**这是 Claude Code 作为审核者的审查意见**
- 第 2 轮：Driver = Claude Code，审核者 = {gemini, glm} → 原稿 `2026-09-13-X-claude.md`

第 2 轮的 deny 矩阵按后缀计算：`driver.suffix = 'claude'` → **`-claude.md` 全部不禁**。于是 gemini 和 glm 都能合法读到第 1 轮 Claude 作为审核者写下的完整审查意见。这正是隔离要防的锚定污染，而且**不会被任何检测命中**——路径不在 deny 集合，命令文本扫描（措施 b）的字面集也是同一个 deny 集合派生的，一并放行。

后缀是**产出方**标识，不携带**产出角色**信息；用它做差集，等价于假设「一个 Agent 在同一主题里角色恒定」——而 Driver 任意化恰恰废除了这个假设。R23 把它归类为「语义混淆 / 留痕误读」，低估了一级。

**处置**：deny 矩阵改为**按角色登记生成**，而非按后缀通配。

- 事实来源：`task.json.runs[]` 已逐轮记录该轮的工件清单；M7 为每条 run 记录增 `driver` 与 `critics_selected`（提案 §5.2 已要求），据此可为归档内**每个文件**反推「它是哪一轮、哪个角色的产出」。
- 生成规则：审核者 c 的禁读 = 归档内**全部**满足「产出角色 = critic 且产出方 ≠ c」的工件 + 其 `_meta` 结构化件 + 敏感 globs + `.trivium/` + `~/.trivium/`。当轮 Driver 的**本轮**原稿与裁决件不禁（合法输入）；**历史轮次的 Driver 后缀文件按其当轮角色判定**。
- 索引缺失的兜底（历史主题无 `driver` 字段，或 `task.json` 损坏）：**fail-closed**——该后缀的全部文件一律禁读。宁可让审核者少读一份 Driver 原稿（BRIEF 第 3 段本就内嵌被审对象全文，代价可控），也不能放行一份对方审查意见。
- 这条规则同时修掉提案措施 a 的 `_meta` 缺口（同源生成，自然覆盖）。

**新增测试**（M7）：`deny-matrix.test.ts` 的关键用例即上述「跨轮角色翻转」场景——构造「上轮 claude 当审核者、本轮 claude 当 Driver」的归档夹具，断言 `-claude.md` 中**上轮那份**进 deny 集合、**本轮原稿**不进。这条用例是 D-3 的回归锚点。

### 3.2 D-5：joint blocker 三审语义裁定

提案 §9.1：「由『双方同 location blocker 均驳回』扩为『**任意两个**审核者同 location blocker 均驳回』→ warn/hard」。

三审下有个未定义的情形：**A、B 驳回，C 接受**。按「任意两个」触发 disputed；但 C 接受意味着该 blocker 已有一方认可 Driver 的判断。双审时「双方均驳回」= 全体驳回，语义无歧义；三审时「任意两个」≠ 全体，它把「多数反对」和「全体反对」混为一谈。

**裁定**：joint blocker 的语义锚点是「**Driver 驳回了一条无人为其背书的 blocker**」，因此判据应为**全体驳回**：

- 触发条件：某 location 上的 blocker，**全部提出该 blocker 的审核者**（≥2 个）均被 Driver 驳回，且**无任何入选审核者**在该 location 提出并被接受的对应意见。
- n=2 时退化为现状「双方均驳回」，**行为逐字节兼容**。
- n=3 且 2 驳 1 接受：不触发 disputed，但 `task.json` 记 `partial_dispute: {location, dissenting: [A,B], endorsed_by: [C]}`，`report` 显著展示。理由：这是审核者之间的分歧，不是 Driver 单方面对抗全体；把它标成 disputed 会让「多找一个审核者」变成惩罚，与 R-3 的意图相悖。

这条裁定也顺带回答了提案 §16 待拍板 #1 的隐含成本：三审不应在裁决语义上比双审更严苛，否则 `default_critics` 永远不会有人调到 3。

### 3.3 其余 N 化点的复核结论

| 提案项 | 复核 | 备注 |
| :--- | :--- | :--- |
| `checkAdjudication` 的 `missingSides` 遍历 `critics_selected` | **成立** | 差集逻辑本就按来源集合做，改集合来源即可 |
| fallback 虚拟编号规则不变 | **成立**，但依赖 A-4 的前缀集泛化 | 见 §2.2 |
| `disposition.v1.json` 的 `addresses` 1..3 | **建议改为 1..N**（上界取 `review.max_critics`） | 写死 3 会让未来调高 `max_critics` 时 schema 先红；schema 由注册表/配置生成即可 |
| 延迟落盘「全部 N 侧完成后同时落盘」 | **成立**，但需复核超时交互 | N 侧中最慢一侧超时时，落盘时机与 `max_waits` 预算的关系要在 M7 补测（现状按两侧写的断言可能默认了「至多一侧慢」） |
| `review_mode` 由「计划 vs 完成」推导，选 1 审不标降级 | **成立且正确** | 与 AC-06「绝不改名冒充」不冲突：那条禁的是把 partial 写成 full，不是禁止计划性单审 |

---

## 4. 分阶段可回退的实施路线（焦点三）

### 4.1 对提案 M6～M11 的改造：D-6

提案的里程碑链是 `M6 →（M7 → M8/M9 → M10）→ M11`，其中 **M7 是一个不可分割的巨型步骤**：它同时包含「内部重构（行为等价）」与「对外契约升版（config v2 + run v2 + 两份 schema 扩展）」。这在回退性上是坏的：

- 契约升版一旦落地并产生了 v2 工件，回退 M7 意味着**已产生的 v2 工件读不回去**（v2 的 `critics` 开放 map 在 v1 schema 下非法）。回退不再是 `git revert`，而是数据迁移。
- 内部重构本身是纯代码变更，回退成本几乎为零。

把两者绑在一个里程碑里，等于让零成本回退的部分继承了高成本回退的属性。

**改造为 M7a / M7b 两个独立可回退单元**：

| 里程碑 | 内容 | 对外契约 | 回退动作 | 回退成本 |
| :--- | :--- | :--- | :--- | :--- |
| **M7a** 内部重构 | `agents/registry.ts`；types 三张字面表迁入注册表；naming/freeze/disposition/archive/hooks 的字面量改读注册表（含 §2.2 四处遗漏点）；`decideMode` 语义改名；**§3.1 deny 矩阵重做**；`registry-parity` + `deny-matrix` 测试 | **零变更**：仍只注册 gemini/glm 两家，仍写 config v1 / run v1，工件逐字节同现状 | `git revert` | 零 |
| **M7b** 契约升版 | config v2 + run v2 + review/disposition schema 扩展；v1 双读与内存迁移；`--driver`/`--critics`/`--tier-*` 等 CLI 旗标；注册 codex/claude 两家（`critic_enabled: false`） | 升版，带双读 | `git revert` + 已产 v2 工件降级脚本（M7b 交付物之一） | 低（有脚本） |

**回退闸口设在 M7a 与 M7b 之间**：M7a 完成后必须 `npm run check` 全绿 + 既有主题 `gate --check` 通过 + 双侧真实跑一轮对照工件逐字节相同，才准进 M7b。这个闸口是整条路线上最有价值的一个——它把「注册表抽象是否真的行为等价」这个最大的技术不确定性，在**零对外影响**的前提下证伪或证成。

### 4.2 修订后的路线

| 里程碑 | 内容 | 完成判据 | 回退单元 | 预估 |
| :--- | :--- | :--- | :--- | :--- |
| **M6** 探针扩展 | 同提案（`probes/codex.ts`、`probes/claude.ts`、Driver 入口承载面、zcode effort 复测） | `doctor --only codex/claude` 有确定结论；待拍板 #3 收敛 | 独立（只加文件） | 1～2 天 |
| **M7a** 注册表重构（行为等价） | §4.1 表内 | `npm run check` 全绿；**双侧真实跑一轮工件逐字节同现状**；deny 矩阵跨轮翻转用例通过（§3.1） | `git revert` | 2 天 |
| **M7b** 契约升版与 CLI | §4.1 表内 + 降级脚本 | v1 配置不改也能跑；v1 工件可读；三侧桩跑通；命令文本伪造命中作废（AC-N6） | revert + 脚本 | 1.5 天 |
| **M8** Codex 审核者 | `adapters/codex.ts` + 逐家族 provider 探活 + lens + 密钥扫描 | 两家族各真实审查一次（AC-N1）；沙箱负对照通过 | 摘注册项（`critic_enabled:false`） | 1～2 天 |
| **M9** Claude 审核者 | `adapters/claude.ts` + CLAUDE.md 审查员片段 | 真实审查一次；`consulted` 交叉核对 | 同上 | 1 天 |
| **M10** 任意 Driver | 四家入口资产与单源渲染；install 多目标；`hooks --agent`；`approve` 复核；协议片段两段式；`driver-onboarding-scope` 测试（AC-N5b） | AC-N2；ZCode/Codex Driver 夹具跑通 | 入口资产可单独卸载；`--driver` 缺省 claude 使旧路径不受影响 | 2～3 天 |
| **M11** 档位全链路与文档收口 | tiers 四侧配齐 + `--tier-*` 全链 + report 聚合；主设计/PRD/PROTOCOL 回溯修订（提案 §17 清单） | AC-N4；文档对账零冲突 | 文档单独 revert | 1～2 天 |

依赖：`M6 →（M7a → M7b → M8/M9 → M10）→ M11`；M8/M9 可并行。M7a 不依赖 M6 结论（注册表形状与探针无关）——**因此 M7a 可与 M6 并行启动**，这是修订后路线相对提案多出的一段并行窗口。

### 4.3 每个里程碑的独立价值（回退时保留什么）

回退性不只是「能撤回」，还要求「撤到上一站时手上有东西」：

- **M6 单独有价值**：探针结论回填坑清单，即使后续全部不做，`doctor` 也更准。
- **M7a 单独有价值**：§2.2 的 A-1/A-2 是**现存**的正确性隐患（A-1 在双侧下恰好不触发，A-2 在 Driver 固定为 claude 时恰好不触发——两者都是「靠巧合正确」）；§3.1 的 deny 矩阵重做修掉的 `_meta` 缺口是**现存**隔离漏洞。这三项与多审无关，M7a 即使不往下走也应该合入。
- **M7b 单独有价值**：CLI 旗标与配置 v2 就位后，双审用户可立即用 `--tier-*` 管理档位。
- **M8/M9 单独有价值**：各自是一个可用的新审核者，与 Driver 任意化无耦合。
- **M10 是唯一「不做就没有」的整块**：Driver 任意化没有中间态。

---

## 5. 对提案 §16 待拍板事项的建议

| # | 议题 | 我的建议 | 理由 |
| :--- | :--- | :--- | :--- |
| 1 | 默认审核者数量 | **维持 `[gemini, glm]`**（需负责人确认） | 成本与现状一致；§3.2 已确保三审不在裁决语义上更严苛，用户可无顾虑地按需调高 |
| 2 | Codex 多家族 provider 配置引导 | **采纳提案默认**（doctor 展示样例、人写入） | 与纪律 5 一致，无异议 |
| 3 | Antigravity 作为 Driver 的入口形态 | **M6 后定**；若探针显示无参数系统，建议**一期不支持 gemini Driver** | 「口述命令意图」的 Driver 不具备命令契约的确定性，会让 AC-N2 名存实亡 |
| 4 | 三档挂 Agent 还是挂模型 | **挂 Agent**（采纳提案）（需负责人确认） | GLM-5.3/Flash 先例决定了 tier 必须是 `(model, effort?)` 组合；挂模型表达不了 |
| 5 | schema 升级策略 | **采纳提案**（run/config 升 v2 双读，review/disposition 原地扩展），但 `addresses` 上界改 N（§3.3） | — |
| 6 | claude 审核者读 CLAUDE.md | **采纳提案**（加审查员身份片段），`critic_enabled: false` 兜底 | — |
| 7 | 旧旗标别名保留期 | **长期保留** | 目标项目的 SKILL.md 不随编排器同步升级，移除即静默破坏 |
| 8 | 命令文本命中是否提供开关 | **采纳提案**（hard，不设开关） | 设开关等于提供合法绕过路径；`readonly_commands` 已是更强的既有旋钮 |

---

## 6. 风险增补（提案 §15 之上）

| # | 风险 | 影响 | 对策 |
| :--- | :--- | :--- | :--- |
| R27 | **跨轮角色翻转的隔离破洞**（§3.1）在 M7a 之前**已经存在于双审世界**吗？—— 否（现状 Driver 恒为 claude，claude 从不当审核者），但 M10 一落地即激活 | 隔离静默失效 | deny 矩阵按角色登记生成 + 跨轮翻转回归用例；**M10 的准入条件包含该用例通过** |
| R28 | `task.json` 成为 deny 矩阵的事实来源后，它损坏/缺失的影响面从「留痕」升级为「隔离」 | 单点依赖 | fail-closed 兜底（§3.1）+ `task.json` 已受 Hook 保护（`bashTargetsProtected` 字面集含之） |
| R29 | M7a 的「工件逐字节同现状」判据依赖一次真实双审运行，消耗配额且有环境依赖 | 闸口可能因环境问题误判 | 允许以**录制轨迹回放**替代真实运行做初判，真实运行作为 M7a 合入前的最后一次确认 |
| R30 | AC-N5b 的白名单会随时间被逐步放宽（每次接入新 Agent 加一个例外） | 「零改动」承诺缓慢腐烂 | 白名单**写进测试**而非文档；放宽白名单必须改测试，改测试会进 diff、进双审 |

---

## 7. 回溯修订清单（在提案 §17 之上增补）

提案 §17 的清单我逐项复核**全部成立**，增补三条：

| 文档 | 增补修订点 |
| :--- | :--- |
| 主设计 | §10 隔离章增「deny 矩阵按**角色登记**生成，禁止按后缀差集」的实现纪律（D-3）；§8.6 裁决章增 joint blocker 全体驳回语义与 `partial_dispute`（D-5） |
| PRD | AC-N5 按 §2.1 拆为 AC-N5a/AC-N5b；新增「反推 Agent 的函数必须返回 `AgentId \| null`」为实现纪律（D-4） |
| `AGENTS.md`（本仓库） | 增：禁止三目兜底反推 Agent；deny 矩阵禁止按后缀生成 |

---

## 8. 本计划与提案的关系

本文**不替代**提案。提案的 §3（技术事实）、§7（各 Agent 接入设计）、§11（配置 v2 全量示例）、§13（测试矩阵）内容完整且准确，实施时直接引用，本文不重复。本文只做三件事：**裁定**（§0 的 D-1～D-7）、**补漏**（§2.2、§3.1、§3.2）、**改造回退性**（§4）。

两文经双审与人工批准后，按纪律 1 合并回溯进主设计 v1.3.0 与 PRD v1.4.0，**提案与本文均降级为历史记录，不作为实施依据**。
