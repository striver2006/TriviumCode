---
schema: trivium.disposition.v1
topic: Agent注册表与多审泛化
stage: code
role: claude
kind: response
run_id: 20260913T121713Z
addresses:
  - 2026-09-13-Agent注册表与多审泛化-gemini.md
  - 2026-09-13-Agent注册表与多审泛化-glm.md
---

# 代码审应答：Agent注册表与多审泛化

## 0. 应答总览

两侧均判 `request-changes`，gemini 5 条（含 1 blocker）、glm 8 条，共 13 条：
**接受 11 条、驳回 0 条、暂缓 2 条。**

十三条我逐条回仓核实，**没有一条虚报**。

**四组独立收敛**：

| 问题 | gemini | glm |
| :--- | :--- | :--- |
| `topic-args.ts:401` 未迁移，且被白名单无理由掩盖 | AGY-03 | GLM-01 |
| B-8 主题剪枝未实现 | AGY-02 | GLM-02 |
| `report.ts` 同族 Driver 硬编码被白名单遮蔽 | AGY-04 | GLM-06 |
| 设计文档 v0.1.5→v0.1.4 回退搭车本次补丁 | —— | GLM-08 |

### 本次实施最严重的三个问题

**其一，AGY-01（blocker）：deny 矩阵重做在真实流水线上是断链的。** 我改了
`enumerateDenyPaths` 的签名加 `driver` 参数，却没改唯一调用它的 `freeze()`——
`FreezeInput` 没有 `driver` 字段，第 234 行只传 4 个参数。于是真实路径上
`driver` 恒为缺省值，我这次重做的全部价值在 M10 到来时会**静默失效**。
更糟的是：`deny-matrix.test.ts` 直接调 `enumerateDenyPaths` 绕过了 `freeze()`，
10 条测试全绿却盖住了断链。**测试覆盖了函数，没覆盖调用链**——这是本次最该记的一条。

**其二，GLM-03：我自己造了一个「提示语禁了、机器核验为零」的缺口。**
`out.add('.trivium')` 是目录条目，而 `checkPeerLeak` 用 `Set.has()` 精确匹配绝对路径，
审核者实际读的是 `.trivium/state.json`，永远不相等。这恰好重演了措施 a 声称要关闭的
那类错位——我在修这个缺口的同一次改动里新造了一个同形态的。

**其三，AGY-03/04 与 GLM-01/06 共同指出的：我用白名单掩盖了未改造的点。**
`LITERAL_ALLOWLIST` 我一次性列了 22 项，其中八项没写理由，而 `topic-args.ts` 与
`report.ts` 根本不是「Agent 专属实现」，是**没改完的模块**。grep 对账本是为补人工
清单的漏而设（计划原话「人工清单会漏，机器对账不会」），白名单把这处漏重新变成
了盲区、测试恒绿。GLM-06 说得准确：「白名单正在做该测试注释自己警告的事」。

**「12 处」的实际完成度**：交付口径是 A-1～A-4 + B-1～B-8 共 12 处，实际完成 11 处
（B-1 只完成一半：`topic.ts` 改了、`topic-args.ts` 没改），B-8 完全未做。
两侧独立算出同一个数。

---

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | blocker | 接受 | 核实属实且是本次最严重问题：`freeze.ts:234` 只传 4 参、`FreezeInput` 无 `driver` 字段，真实路径 driver 恒为缺省。测试绕过 `freeze()` 直调，盖住了断链 | `FreezeInput` 增 `driver?: AgentId`，`freeze()` 透传；`deny-matrix` 增一条**走 `freeze()` 入口**的用例，锚住调用链 |
| AGY-02 | gemini | major | 接受 | 核实属实。我在实施期擅自偏离了计划（见 §2 的偏离说明），而两侧共同指出不剪枝的实际后果是**误伤**：非 Claude Driver 下，全仓其它主题的 `-claude.md` 原稿因无 schema 且 `role !== driver` 被判 indeterminate 全部误禁 | `enumerateDenyPaths` 增 `topic` 参数，扫描范围收窄到 `<archiveRoot>/<topic>` |
| AGY-03 | gemini | major | 接受 | 核实属实，与 GLM-01 同一处。`topic-args.ts:401` 仍写死 `role === 'claude'`，:390/:409 报错文案同样写死 | `locateSubjectReadOnly` 增 `driver` 参数并改判据与文案；白名单移除 `topic-args.ts` |
| AGY-04 | gemini | major | 接受 | 核实属实，与 GLM-06 同一处。`report.ts:93`（轮次计算）与 `:127`（裁决件定位）是 A-2/B-2 的同族形态，既不在 12 处清单里，又被白名单遮蔽 | `enumerateRounds` / `loadDisposition` 增 `driver` 参数；白名单移除 `report.ts` |
| AGY-05 | gemini | nit | 接受 | 核实属实。`CODEX-03` 能查到已登记 Agent，只是未启用为 Critic，而提示语说「不属于任何已登记 Agent」——与事实冲突 | `inferSource` 区分两种情形，提示语分别措辞 |
| GLM-01 | glm | major | 接受 | 同 AGY-03。GLM 另外点明了要害：白名单让「机器对账」退回「人工清单」，测试恒绿 | 同 AGY-03 落点 |
| GLM-02 | glm | minor | 接受 | 同 AGY-02。GLM 补充了性能维度：新增的 `classifyArtifact` 对每个候选**读文件**，全归档 × 每侧 × 每次运行，比重构前（只看文件名）更重 | 同 AGY-02 落点；并在 `classifyArtifact` 之前按 `parsed.topic` 过滤 |
| GLM-03 | glm | minor | 接受 | 核实属实（`adapters/base.ts:129` 为 `denySet.has(normalizeAbs(p))` 精确匹配）。严重度我按 major 对待——它是隔离层的真实失效，不是可维护性问题 | `checkPeerLeak` 对目录形态条目做前缀匹配；补「读 `.trivium` 内文件 → 命中」的测试；收敛 `brief.ts:212` 的重复表述 |
| GLM-04 | glm | minor | 接受 | 核实属实。`classifyArtifact` 首行 `if (kind !== null) return 'own-or-driver'` 不看 role，而 `…-revised-gemini.md` **确实以 `-gemini.md` 结尾**，重构前会被禁、现在直接放行——deny 集合在这一点上相对重构前收窄了 | `kind !== null` 时按 `role === driver` 分流：等于判 own-or-driver，不等于判 indeterminate（禁） |
| GLM-05 | glm | minor | 接受 | 核实属实。B-7 的两句我只做了前一句：两重检测都用登记前缀集生成，真正未登记的前缀（错拼、第五家接入前的编号）两重都不命中，照旧静默 `continue` | 第二重检测放宽为「形如 `大写前缀-数字` 即报 problem」，不限于登记集 |
| GLM-06 | glm | minor | 接受 | 同 AGY-04，且指出白名单八项无理由注释。这条批评对我的实现方式成立：我一次性列了 22 项，等于先承认了 22 处豁免 | 白名单逐条补理由；移除 `topic-args.ts` 与 `report.ts`；另移除经核查确无字面量的条目 |
| GLM-07 | glm | minor | 暂缓 | 指控属实（schema JSON 不在对账范围），但**落点在 M7b**——这也是 GLM 自己建议的时机（原文「M7b 做 schema 扩展时…一并落进」）。M7a 内 schema 的 `^(AGY\|GLM)-` 与当前启用集合**一致**，无不一致可断言；此刻加断言等于断言一个有意尚未同步的状态 | 不改代码。**显式记入 M7b 清单**（§3）——GLM-06 批评的正是「靠人工清单」，所以这条待办写进应答件与里程碑表，不留在口头 |
| GLM-08 | glm | minor | 暂缓 | 指控属实且我在实施期已独立发现并向用户报告过：工作树里该文档被从 v0.1.5 回退到 v0.1.4，而 HEAD 提交 `a90ac87` 自称 v0.1.5、`doc/02_design/README.md:43` 索引也写 v0.1.5，三方谱系矛盾。**但这不是我的改动**——会话开始时 git status 只有 `.trivium/config.yaml` 一处。我无权替项目负责人裁定哪套模型目录为准，也不该把别人的改动裹进我的提交 | 不改该文件、**不纳入本次提交**。已向用户报告，由其裁定 v0.1.5 与 v0.1.4 孰为准绳后单独处置 |

---

## 2. 一处需要交代的实施期偏离

AGY-02 / GLM-02 指出的 B-8，**不是我忘了做，是我在实施期自行判断后没做，且没有说明**。

当时的判断：计划 §2.1 B-8 写「按当前主题目录剪枝（跨主题工件本就不该进本主题 deny 集）」，
我认为剪枝会**缩小** deny 语义——跨主题的对方审查意见不再禁读——于是保留了全归档扫描，
只打算在「限制 front-matter 读取范围」上做 I/O 优化。

两侧的审查证明这个判断是**错的**，而且错在只看了一侧代价：

- 我只权衡了「缩小 deny 语义」的风险（跨主题锚定污染，实际很弱：那是另一个任务的意见）；
- 没看到不剪枝的代价是**误伤**（AGY-02）：非 Claude Driver 下全仓历史主题的 `-claude.md`
  原稿因 `role !== driver` 被判 indeterminate 全部入禁读集，而误伤的后果不是「少读一份」，
  是 `peer_leak` 作废重跑——这正是我在计划 §2.2 里刚刚纠正过的同一个代价误判。

**程序上的问题比技术判断更值得记**：即便技术判断成立，实施期偏离已批准的计划也应当
当场写明，而不是默默执行、等审查员发现。本次是后者。

---

## 3. 移交 M7b 的待办（GLM-07）

写在这里而非留在口头，是因为 GLM-06 批评的恰好是「靠人工清单维持完整性」：

| 待办 | 来源 | M7b 落点 |
| :--- | :--- | :--- |
| `skills/dual-critic/schema/*.json` 的 pattern ↔ `ALL_FINDING_PREFIXES` 对账断言 | GLM-07 | 与 `review.v1.json` / `disposition.v1.json` 的 schema 扩展同一次提交；`registry-parity` 直接读 schema JSON 比对生成片段 |
| `grep` 对账范围从 `src/trivium/**.ts` 扩到 `skills/` 下的 schema 与资产 | GLM-07 | 同上 |

---

## 4. 修改计划

按裁决表逐项落地，只改已接受的 11 条：

1. **`freeze.ts`**：`FreezeInput` 增 `driver?: AgentId` 并透传（AGY-01）；`enumerateDenyPaths`
   增 `topic` 参数、扫描收窄到主题目录（AGY-02/GLM-02）；`classifyArtifact` 的 `kind !== null`
   分支按 `role === driver` 分流（GLM-04）。
2. **`adapters/base.ts`**：`checkPeerLeak` 对目录形态条目做前缀匹配（GLM-03）。
3. **`topic-args.ts`**：`locateSubjectReadOnly` 增 `driver` 参数，判据与两处报错文案改用它（AGY-03/GLM-01）。
4. **`report.ts`**：`enumerateRounds` / `loadDisposition` 增 `driver` 参数（AGY-04/GLM-06）。
5. **`disposition.ts`**：`inferSource` 区分「未登记」与「已登记未启用」（AGY-05）；
   第二重检测放宽为不限登记集（GLM-05）。
6. **`brief.ts`**：收敛与新 deny 条目重复的写死表述（GLM-03 附带）。
7. **`registry-parity.test.ts`**：白名单逐条补理由，移除 `topic-args.ts`、`report.ts` 及
   其它经核查无字面量的条目（GLM-06）。
8. **`deny-matrix.test.ts`**：增「走 `freeze()` 入口」用例（AGY-01）、「读 `.trivium` 内文件
   触发 `checkPeerLeak` 命中」用例（GLM-03）、「peer 后缀带裁决件中缀被禁」用例（GLM-04）。

全部改完后跑 `npm run check`（typecheck + build + test）作为出口。
