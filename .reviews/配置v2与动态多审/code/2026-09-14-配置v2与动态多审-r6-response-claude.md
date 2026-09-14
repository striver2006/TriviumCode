---
schema: trivium.disposition.v1
topic: 配置v2与动态多审
stage: code
role: claude
kind: response
run_id: 20260914T102535Z
addresses: [AGY-01, AGY-02, AGY-03, AGY-04, AGY-05, GLM-01, GLM-02, GLM-03, GLM-04, GLM-05, GLM-06]
---

# 逐条应答与修改方案（M7b 第 6 步 · 第 6 轮代码双审）

> 运行 `20260914T102535Z` ｜ gemini `request-changes`（1 major + 2 minor + 2 nit）
> ｜ glm `approve-with-nits`（4 minor + 2 nit）｜ 共 11 条，**全部接受，零驳回**。

## 一、两侧独立收敛于同一处

**AGY-01 ≡ GLM-02**：放开 `review.v1.json` 的前缀枚举之后，「编号属于本侧」这条保证
在**判定语义**上变强了（按侧 vs 在名单），但**执行权重**没有接住被撤走的后盾。

改之前：非法前缀被 ajv 拒掉 → 整份候选作废 → `parse_fallback` → 由
`enumerateFallbackFindings` 用本侧合法前缀重新编号 → 可裁决。**硬失败路径。**

改之后：非法前缀是 schema 合法的结构化结论，`checkReviewIntegrity` 的 `prefixOk`
只进 `renderGuardWarnings` 的告警文本——不改 `result.status`、不进 run.json、
不进审查文档、gate 也不复核。glm 把两条下游后果都推到底了，我逐条核实属实：

- **死锁**：未登记前缀（如 `FOO-01`）照常落盘并进裁决差集，而 `disposition.ts:206`
  的收行正则只认**已登记**前缀 —— Driver 无论怎么填裁决表那一行都不会被收，
  `gate --check` 永远报 `missing_findings`，且报出的是**误导性的「缺裁决」**。
- **冒名**：某侧产出另一侧的前缀（gemini 出 `GLM-01`），`gate.ts` 的 Set 去重把它
  与 glm 侧合并，裁决一次即过闸 —— 跨侧意见静默碰撞。

gemini 额外指出第三条：这份 schema **同时是 `agy --json-schema` 的生成约束**，
放开后受限解码允许模型产出任意大写前缀，而 schema 错误重试通道不再能纠正它。

### 这条错误的形状，我本会话刚记过

我在设计 6.5 写的是「那道检查比 schema 的枚举更强」。这句话的**前半**成立
（按侧比在名单强），**后半**是我自己加的——我把「判定语义更强」悄悄读成了
「整体保证不弱」，然后基于扩大后的版本拆掉了后盾。

这正是本会话写进记忆的 `assertion-scope-creep`：**把一个已有保证的适用范围悄悄扩大，
然后基于扩大后的版本往下写。** 上一轮的样本是「resolve 已经挡住了这种组合」，
这一轮是「那道检查比枚举更强」。同一形状，一天之内第二次，而且这次是在我
**刚刚写完那条记忆之后**发生的——说明记下来不等于用得上，
记忆条目要补一条可操作的检查动作：**撤掉一道防线时，先问「被撤的那道产生什么后果，
留下的那道产生什么后果」，两者不相等就不是等价替换。**

---

## 二、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | major | 接受 | 属实且已核实到底：`disposition.ts:206` 的收行正则只认已登记前缀，未登记前缀必然死锁且报错指向错误原因；跨侧前缀被 gate 的 Set 合并后静默碰撞。我撤掉 schema 后盾时只比较了两道检查的判定语义，没比较它们的执行后果 | `review.ts` 解析环：`parseReview` 成功后立即跑 `checkReviewIntegrity`，`prefixOk` 为假即按解析失败处置（转 `parse_fallback`、记 `fail_reason`），使消费后果与改前逐项相同；`parse_fallback` 与原因本就落 run.json，留痕无需改 schema |
| GLM-02 | glm | minor | 接受 | 与 AGY-01 同一根因，两侧独立收敛。glm 的补充更准：「判定语义成立但执行权重没接住」，并查明 `RunMeta.guard` 无 integrity 字段、`renderReviewDoc` 不收 integrityIssues、`gate` 不复核前缀——三处都核实属实 | 同 AGY-01。**不另加 run.json 的 guard 字段**：转 `parse_fallback` 之后 `parse_fallback: true` 与 `fail_reason` 已经是持久化留痕，再加一个并行字段是第二事实源 |
| AGY-02 | gemini | minor | 接受 | 属实。FR-31 的条文承诺是「新增一家 Agent 只需一份接入套件，**核心流程零改动**」，而 EV-05 同时承认真实第三家仍需改 `ProbeSection` 与 preflight 三项——两句话不能同时为真。按本项目对 AC-22 的一贯处置，这里标 `[x]` 属过度断言 | **FR-31 改为「部分达成」**（桩级达成，真实接入待 M8 / M9）。**AC-24 保持「已达成」但补两处**：①它自身以桩为口径，达成属实；②显式写明「**AC-24 不足以完整验收 FR-31**」，并把「preflight 是以 `--skip-auth-check` 跑通的」补进证明边界——AC 正文原先没提这一条 |
| AGY-03 | gemini | minor | 接受 | 属实，7 处。其中 `adapters/index.ts:54` 是**直接面向使用者的报错文案**，把开发者引向过时的接入清单。这是「改语义漏改文案」的第四次同形：我为文档列了落点清单，唯独漏了代码里的字符串与注释 | `adapters/index.ts:9,54`、`preflight.ts:257,261`、`review.ts:240,245`、`types.ts:35` 的「六件套」统一改「七件套」，并与设计 5.1.1 的件号对齐 |
| AGY-05 | gemini | nit | 接受 | 属实：我写的注释是「① enum / const 直接列身份」，实现只有 `k === 'enum'` 一个分支。**注释宣称了不存在的覆盖**——这比单纯漏做更糟，它会让下一个人以为这块已经守住 | `registry-parity` 的全目录扫描补 `const` 分支 |
| GLM-03 | glm | minor | 接受 | 与 AGY-05 同处，且 glm 多查出**第二个形态**：`alternation.length >= 2` 的门槛让单前缀字面 pattern（如 `^AGY-`）整类穿过。它同时给了正确的边界——豁免的应是「`vendor` 键的 const」，不是「完全不扫 const」 | 同 AGY-05，另把字符串检测由「≥2 个 token 的交替式」放宽为「出现任一已登记 id 或前缀」；`vendor` 键的 const 豁免。**连带处置**：补 const 分支后会扫出 `disposition.v1.json` 的 `role: {const: "claude"}`——那是真命中（裁决件作者恒为 Driver，M10 才任意化），按 `run.v1.json` 同样的形态给**具名豁免 + 写明理由**，并登记 BACKLOG **EV-07**，不静默跳过整个 const 论域 |
| GLM-01 | glm | minor | 接受 | 属实，而且是与 AGY-01 同一家族的第三个样本：`hashTree` 遇软链即 `continue`，而 `linkDependencies` 恰好在 dest 根挂了一条指向真实仓库 `node_modules` 的软链；我用一句注释「它不属于生产检出，也不会被 overlay 碰」封住这个洞，**后半句是未经任何断言保证的假设**——与第②层存在的理由（「自报可信」不可信）结构完全相同。glm 还指出 `after` 的 `fs.rm` 不跟随软链，污染会留在开发者真实环境里 | 把 carve-out 从注释变成断言：①`hashTree` **改为记录软链条目**（`@symlink -> target`）而非跳过，软链被替换/新增/删除都进差集；②测试断言树内软链恰好只有 `node_modules` 一条；③`Recorder` 对解析后逃出 dest 根的写入就地失败（堵住唯一应当写文件的入口）。**残留边界如实写进注释**：绕开 Recorder 且直写软链目标树仍不可见，本夹具无任何代码路径可达，但那是边界而不是保证 |
| GLM-04 | glm | minor | 接受 | 属实且是本轮我自己的同步漏项：门面 README 写「已合入的只有 M7a」「动态选审核者尚不可用」，与 PRD / MANUAL / QUICKSTART / 设计 README 的新口径**相反**；紧接着那句「本 README 其余部分描述的都是当前可用的系统」还把误读强化了一层。本步的文档同步集覆盖了六份，唯独漏了读者第一眼看的那份 | `README.md:9` 徽章补 M7b；`README.md:30-35` 注记改为「M7b 六步已合入，`--critics` 的 1／2 侧可用；第三家与三侧待 M8 / M9」，与 MANUAL 同款表述，并保住末句的自我承诺 |
| GLM-05 | glm | nit | 接受 | 属实，已核：`config.v2.json` 的 `probe` 段是 `additionalProperties: true`，任意厂商键本就过 ajv；闭合形状**只在** `types.ts` 的 `ProbeSection`。对一条以「登记不修」处置的欠账，**成本描述就是它的全部信息**，多记一个文件会直接误导 M8 / M9 的改动面评估 | BACKLOG EV-05、设计 5.1.1「已知缺口」、`pieces/stub-probe.ts.txt` 注释三处同步改为「改 `types.ts` 的 `ProbeSection` 及其消费点；`config.v2.json` 的 `probe` 段本就开放、无需动」 |
| GLM-06 | glm | nit | 接受 | 属实。报错写「无法取到它的调用参数」，而第 ⑦ 件实测撞出来的形态恰恰是**没有任何调用参数**的段（桩即 `{vendor: stub}`）。排障者会去找一个不存在的东西——与本项目「第一个错误不得把用户引向第二个错误」同形，上一轮 GLM-04 刚记过一次 | `critics.ts` 的报错理由改为如实表述：入选审核者必须在 `agents` 段有条目（统一前置条件；antigravity 形状另需从这里取 `agent` 与 `effort`） |
| AGY-04 | gemini | nit | 接受 | 属实，且 AGENTS.md 纪律 12 现在是**双重过期**：既说「schema 的枚举与前缀集必须与注册表 parity」（新纪律是 schema **不得**枚举身份），又说「扫描是显式路径清单」（已换成全目录兜底）。它是 Driver 与审查员首读的顶层约束文件，留着会持续产出错误改动 | AGENTS.md 纪律 12 重写：机读 schema 只校形状、禁止枚举 Agent 身份与前缀，身份走两段式代码校验，对账由全目录兜底扫描守卫 |

---

## 三、修改计划（按依赖顺序）

1. **AGY-01 / GLM-02**（唯一 major，先做）：`review.ts` 解析环加前缀完整性闸。
   变异验证点：改回「只告警」后，构造跨侧前缀与未登记前缀两条用例必须当场红。
2. **GLM-01**：`overlay.ts` 的 `hashTree` / `Recorder` 与测试断言。
   变异验证点：让 overlay 写一条 `node_modules/...` 路径，断言必须红。
3. **AGY-05 / GLM-03**：parity 扫描补 const 与单前缀形态，`disposition.v1.json` 具名豁免 + EV-07。
   变异验证点：往任一 schema 塞 `const: "gemini"` 与 `pattern: "^AGY-"`，两条都要红。
4. **GLM-06 / AGY-03**：报错文案与「六件套」残留（7 处）。
5. **AGY-02 / GLM-04 / GLM-05 / AGY-04**：文档口径——PRD 的 FR-31 与 AC-24、
   门面 README、EV-05 成本描述、AGENTS.md 纪律 12。

**范围边界**：`disposition.v1.json` 的 `role` 泛化属 M10（Driver 任意化），本轮只登记不改。
`guard` 的重复编号与 evidence-consulted 两项仍是告警，那是**改动前就如此**的既有行为，
未因本次改动变化，本轮不动。

## 四、两侧都提到但我不改的一处

编排器在本轮带回三条 guard 提示（两侧 `consulted` 无法与轨迹交叉核对、
glm 侧两个文件 evidence 引用但未列入 consulted）。这是审查员产出的结构问题，
不影响意见本身的成立与否；两侧的意见我已逐条独立核实，均属实。
`consulted_unverified` 的成因是本机两侧 CLI 都不提供可核对的读取路径轨迹，
属已知环境限制（M6 探针未跑），不在本步范围。
