---
schema: trivium.disposition.v1
topic: EV-82-同形第二臂与构建标识
stage: code
role: claude
kind: response
run_id: 20260924T050351Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
---

# 应答：EV-82 小主题第一段 · 代码双审第 1 轮

> 被审对象：相对 `HEAD`（`833598cd`）的 16 个文件，补丁 78.1 KB
> ｜ 运行：`20260924T050351Z`（10m6s）
> ｜ 结论：codex `request-changes` ｜ gemini `approve`（零意见） ｜ glm `approve-with-nits`
> ｜ 共 9 条：重要 1 ｜ 次要 5 ｜ 吹毛求疵 3 ｜ 零阻断
> ｜ **全部接受**

## 0. 本轮的形状

**六个焦点，三侧一致判定成立的**：
- ①构建标识的本仓限定、指纹与收尾重算同口径；
- ②`prepareZcodeHome` 不传参数时逐字不变，审查臂唯一调用处未受影响；
- ③早退杜绝以真实 HOME 拉起；
- ④白名单臂六支文案与 HEAD 逐字相同（codex 用 `git show HEAD:` 逐条对过）；
- ⑤判不出不覆盖、不一致告警只比本轮值。

⑥包名兜底：gemini、glm 判合理；codex 认可方向，但指出三处要处置（CODEX-02）。

**一个真实运行里的旁证**：本轮收尾，编排器报出「构建时工作树有未提交改动：安装副本不对应任何一个提交」。
这是构建标识第一次在真实运行中生效，而且报得对：送审的安装副本确实是从带着这批未提交改动的工作树构建的。

**最重的一条是 CODEX-01**，已核属实：
- `cli.ts` 的 USAGE 对 `--no-model-calls` 承诺「只做静态探测，不消耗厂商配额」；
- `secrets.ts` 的 `zcode-api-key` 规则要求 `<hex>.<secret>` 的点形态，`generic-secret-assignment` 要求键名出现在串内，所以不带点的长十六进制裸值、键名为 `key` / `auth` / `passphrase` 的值都不会被命中；
- 同形臂保留全部 provider 与全部键，黑名单只要漏掉一个，那份真实凭据就会进副本，CLI 就可能真鉴权、真发请求。

这正是白名单臂当初放弃黑名单的理由（`buildProbeCliConfig` 注释与代码双审 r1 codex 子项 03），同形臂少了那层结构上的兜底。

**浅克隆两侧同指（CODEX-03 ≡ GLM-04）**：`rev-list --max-parents=0` 在浅克隆里返回的是移植边界，本仓模式会**静默**失效，与「真的不是本仓」落成同一个观测。

**闸门期不改代码。** 下表落点在 `/dual-approve` 之后实施，改完送代码双审第 2 轮。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 核对属实（§0）：同形臂的零配额只由黑名单保证，漏判一个凭据就可能发生真实调用，违背 `--no-model-calls` 的对外承诺；notes 只报替换了几处，看不出有没有漏 | `probes/zcode.ts` 三处：<br>①**无条件**：每个 provider 的 `options.apiKey` 一律写哨兵（不存在也写），与白名单臂同一结构兜底；键与结构不动，不影响 H2 要判的差异面。<br>②**拉起前残余扫描**：替换后对副本再扫一遍，凡位于 `provider.*` 之下、长度 ≥ 20、只由 `[A-Za-z0-9._+/=-]` 组成、且不是 URL 的字符串，登记为「疑似未替换的凭据」（**只记键路径，不记值**）。**有疑似项就不拉起**，记 `override: null`，why 列出这些路径：宁可本轮未判定，也不冒真实调用的风险。<br>③把零配额前提（「所有凭据都命中替换规则」）写进该臂每次输出的 note，不只留在计划里。<br>用例：合成配置里放一个键名为 `key`、值为不带点长十六进制串的 provider 字段，断言不拉起、why 含其路径；放一个 provider 不带 `apiKey`，断言副本里补上了哨兵 `apiKey`。变异：去掉残余扫描 ⇒ 该用例红 |
| CODEX-02 | codex | minor | 接受 | 成立三处：(a) 包名兜底是 r2 计划里没有的判据，未回补；(b) `SELF_PACKAGE_NAME` 是 `package.json` `name` 的第二份副本，改名或加 scope 后兜底静默失效，而现有用例自证循环、不会红；(c) 兜底分支不看根提交，任何 `name` 为 `triviumcode` 的第三方项目都会进本仓模式 | ①用例对账：`SELF_PACKAGE_NAME === JSON.parse(package.json).name`，改名当场红。<br>②`isSelfRepo` 注释写明兜底的代价：同名第三方项目会收到一条「构建标识缺失」告警，无害、不阻断。<br>③偏离登记：本段收口报告写明「缺构建标识时用包名兜底判本仓，否则『构建标识缺失』永不出现」，并在 r2 §2 的偏离记录里追加（按 r5 §14 口径，不回改已审批的 r2 原文） |
| CODEX-03 | codex | minor | 接受 | 成立（与 GLM-04 同指）：浅克隆下 `rev-list --max-parents=0 HEAD` 返回移植边界，本仓模式静默失效，与「真的不是本仓」不可区分 | ①`util/git.ts` 增 `isShallowRepo`（`git rev-parse --is-shallow-repository`）；`rootCommit` 在浅仓里返回 null，不返回移植边界。<br>②构建侧：浅仓里取不到根提交，`computeBuildStamp` 返回 null ⇒ 运行时走包名兜底，本仓里会出「构建标识缺失」，**可见**。<br>③被审项目侧：`isSelfRepo` 改为：有标识**且**被审项目根提交可得时比根提交；被审项目根提交取不到（浅仓）时退到包名兜底，**不静默判否**。<br>④doctor 那一行在浅仓时注明「浅克隆，本仓判定按包名」。<br>用例：在临时仓上 `git clone --depth 1` 出浅副本，断言 `rootCommit` 为 null、本仓模式仍按包名成立 |
| CODEX-04 | codex | minor | 接受 | 成立（与 GLM-02 ① 同指）：r2 §5 的「只换凭据键时，同形臂判定与未替换前相同」对照用例没有落地；它是 §4 判读表 (cc, global) 一格「先分 H2 与替换伪影」的单元层基线 | `zcode-full-copy-arm.test.ts` 增对照用例：同一合成配置，分别用「全量替换」与「只换 `options.apiKey`」两种 `transformCopy` 造副本，在假入口下断言两者判定相同（都为 `config_copy`）。计划 §4 第二段第一刀的描述里写明以此为基线 |
| CODEX-05 | codex | minor | 接受 | 核对属实：设计 §6.7.1「写侧新增字段」表是 run.json 形状的唯一增量登记处，没有 `snapshot.build`；探针项表有 `zcode.model_override` 一行，没有第二臂；AGENTS.md 改动同步清单把 schema 与探针项都列为必同步 | 设计文档本批回补两行：<br>①§6.7.1 增 `snapshot.build`：可选、可 null 的语义，非本仓只记不比，谁消费（收尾告警、doctor）；<br>②探针项表增 `zcode.model_override_full_copy`：只存三态、只判配置读取层、看不见运行期注册表层，谁消费（doctor 两臂不一致告警）。<br>放在本批代码改动里一起提交，不等 M10b 第 5 步 |
| GLM-01 | glm | nit | 接受 | 核对属实：r2 §2 写「测试构建注入固定测试值」，实现没有在 `buildTests` 里注入，测试构建下 `embeddedBuildStamp()` 恒 null。这是有意的简化：告警逻辑是纯函数，用例都显式传入 stamp；若给测试构建注入固定值，所有端到端用例（外部夹具项目）都会带上一份与真实构建无关的标识。但它确是对已审批计划的偏离，未登记 | 保留「测试构建不注入、以 null 为测试值」，**登记为偏离**：本段收口报告与 r2 的偏离记录里写明理由；`build-stamp.ts` 的 `embeddedBuildStamp` 注释里补一句「这是对 r2 §2 的有意偏离，理由见收口报告」 |
| GLM-02 | glm | nit | 接受 | 成立两处：①对照用例未落地（同 CODEX-04）；②r2 §3.2 第 7 条「用例断言两臂调的是同一个判据函数」没有用例 | ①同 CODEX-04 落点。<br>②同一引用：两臂都静态 import 同一个 `judgeOverrideReadback`，运行时要断言「同一引用」只能靠 spy 改写模块，得不偿失。改以**行为对拍**代替：同一份回读与退出形态，分别喂给两臂的判定路径，断言三态与 observed 相同；并在收口报告里写明这一子项「以行为对拍 + 代码评审代替引用断言」 |
| GLM-03 | glm | minor | 接受 | 核对属实：`checkBuildStamp` 内部各步失败都以 null 收口，能进 `review.ts` 那个空 catch 的基本只剩编程错误，而那恰是最该被看见的一类；doctor 侧同类失败会记一条「读取失败」，两处口径不一 | `review.ts` 的 catch 改为：不重抛，但把 `(e as Error).message` 拼成一条 gate.warning「构建标识比对失败：<msg>」，与 doctor 侧同型；只告警、不阻断。用例：注入一个会抛的 stamp 检查，断言 run.json 的 `gate.warnings` 有这条 |
| GLM-04 | glm | nit | 接受 | 成立（与 CODEX-03 同指）：`rootCommit` 注释「同一仓库在任何克隆里算出同一个值」把前提说满了 | 同 CODEX-03 落点（算法层处置浅克隆）；`rootCommit` 注释改写为「浅克隆返回 null，不返回移植边界」 |

## 1. 本轮不做的事

- **不跑 r2 §4 的实验**：实验在代码合入之后，按 r2 的约定。
- **不改 `prepareZcodeHome` 的默认行为**：本轮所有改动都落在同形臂、`build-stamp.ts` 与 `util/git.ts`。
