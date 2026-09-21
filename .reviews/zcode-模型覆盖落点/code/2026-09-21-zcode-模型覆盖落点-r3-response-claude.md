---
schema: trivium.disposition.v1
topic: zcode-模型覆盖落点
stage: code
role: claude
kind: response
run_id: 20260921T140524Z
addresses:
  - 2026-09-21-zcode-模型覆盖落点-r3-codex.md
  - 2026-09-21-zcode-模型覆盖落点-r3-gemini.md
---

# 代码双审 r3 应答：zcode-模型覆盖落点（EV-82）

**codex 4 条（2 次要 ｜ 2 吹毛，`approve-with-nits`），gemini 零意见（`approve`）。4 条全部接受，零驳回、零暂缓。**

本轮 codex 做了我在焦点第四点里点名希望有人做的事——**进 `zcode.cjs` 包内独立复核**了 `Oqa` / `Nqa` / `Fqa` / `okt` / `skt` 的字面
（r2 两侧都记了「未进包内」）。结论：白名单「⊇ 必需键」的方向成立，但我据此推出的「导入没发生在两种副本下**同真同假**」**不成立**，
且我对 `Fqa` 的语义写反了。四条我都在包内逐一复核过，属实；本机 `cli/config.json` 里 `apiKeyRequired` / `deleted` / `id` 三个键**都不存在**
（只计数，未读值），所以是潜在缺口而非活缺陷——但方向明确、修法便宜，本轮一并落。

---

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | **已复核属实**：包内 `Fqa(e){return e.options?.apiKeyRequired===!1}`——是「显式声明**不需要**鉴权就抛 `ikt`」，不是我注释写的「既无 apiKey 又无其它鉴权才抛」；`skt` 捕获 `ikt` 后**整份**导入返回 null。白名单恰好把 `options.apiKeyRequired` 裁掉了：宿主配置里有一个免密 provider 时，探针副本不触发抛错、判 `config_copy`，而审查运行的整份拷贝会带上它、导入被拒、静默回退——探针对审查运行**假乐观**，恰是解禁 glm 的判据面。EV-94 ② 只登记了反方向 | 取意见的 ①+②：`buildProbeCliConfig` 的 `options` 白名单**加回 `apiKeyRequired`**（布尔，非凭据）——探针副本在这一键上与整份拷贝同形，免密 provider 会让探针也判不出导入、如实落 `global`；注释里 `Fqa` 的语义改准；EV-94 ② 补「探针 `config_copy` 而运行 `global`」这一反向触发；RUNBOOK 成因清单补「副本源里有 `apiKeyRequired: false` 的 provider 使整份导入被拒」；用例：夹具加一个免密 provider ⇒ 探针臂 `global`（假入口按 `Fqa` 语义应答） |
| CODEX-02 | codex | minor | 接受 | **已复核属实**：`Nqa` 跳过 `deleted===true` 的成员、modelId 取 `(s.id ?? key).trim()`；`Oqa` 跳过 `builtin:` / `account:` 前缀与 `source` 非 custom 的 provider。`qualifyAgainstCliConfig` 与 `pickNonFirstModel` 只按键名与 `in models` 判，看不见这三条——限定成功、`Mqa` 只解析字符串不校目录、v2 文件照样写出请求值（探针 `config_copy`），而运行期 `isSelectable` 在注册表里配不上，guard 报「没有生效」并把排查引向「CLI 又改了流程」。v1.3.32 引以为戒的「注册表形态异源」换了个维度复发。本机三键均不存在，潜在 | 抽 `legacyProviderMembers(cfg)`：按 `Oqa` / `Nqa` 同一组规则产出 `Map<providerKey, Set<modelId>>`（跳 builtin:/account:/非 custom 的 provider；跳 `deleted`；modelId 取 `id ?? key` 并 trim）；`qualifyAgainstCliConfig` 与 `pickNonFirstModel` 都改读它；用例夹具加 `deleted` 成员、`id ≠ key` 成员、`account:` 前缀 provider 三种变体各一腿 |
| CODEX-03 | codex | nit | 接受 | **已复核属实**：包内 `okt` 用 `indexOf('/')`（第一个），provider 段不含 `/`、model 段可含；本仓限定与 `zcodeModelTail` 用 `lastIndexOf`。模型键名不含 `/` 时等价，含 `/` 时限定会把合法请求判成「provider 键不存在」。假入口夹具按 `indexOf` 切——与真 CLI 同形、与本仓限定不同形，恰好印证缝隙。切分规则也是外部产品事实，纪律 1 该按包内字面取齐 | `qualifyAgainstCliConfig` 与 `zcodeModelTail` 改用**第一个** `/`（与 `okt` 同规则），注释写明来源；用例增一腿「模型键名含 `/`」的限定与比对。`qualifyZcodeModel`（只喂目录比对，EV-93）本轮不动 |
| CODEX-04 | codex | nit | 接受 | 属实：`legacyLayout(opts?.cliConfigPath ? {} : {})` 两支同为 `{}`，是改主意后的残留 | 改为 `legacyLayout()` |

---

## 二、修改方案（**审批通过后执行**）

1. `src/trivium/probes/zcode.ts`：`buildProbeCliConfig` 的 options 白名单加 `apiKeyRequired`（仅当源值为布尔）；注释改准 `Fqa` 语义并写明「免密 provider 会让整份导入被拒，探针与运行同形」；`pickNonFirstModel` 改读 `legacyProviderMembers`。
2. `src/trivium/adapters/zcode.ts`：新增导出 `legacyProviderMembers(cfg)`；`qualifyAgainstCliConfig` 改读它、切分改第一个 `/`；`zcodeModelTail` 改第一个 `/`。
3. 用例：夹具加免密 provider / `deleted` 成员 / `id ≠ key` 成员 / `account:` 前缀 provider / 模型键名含 `/`；假入口按 `Fqa` 语义应答（源有 `apiKeyRequired:false` ⇒ 不写 v2、退 1）；`probeWith` 死三元删除；变异：白名单去掉 `apiKeyRequired`、成员规则退回键名、切分退回 lastIndexOf 各一条。
4. 留痕：EV-94 ② 补反向触发；RUNBOOK 成因清单补两条（免密 provider 使导入被拒；请求名是被删成员或键与 id 不同形）；设计 §21 v1.3.33 补「代码双审 r3 落地」段；M0 P-31 改判段补「`okt` 按第一个 `/` 切」。

---

## 三、方法记账

r2 应答件里我写「白名单 ⊇ 导入器必需键，故同真同假」，是**只看了 `Oqa` 读了哪些键、没看每个键被读来做什么**——`apiKeyRequired` 被读来
决定抛不抛错，裁掉它改变的不是「导入缺不缺信息」而是「导入会不会被拒」。同一份包内字面，读到函数名就停下，和读到判定语义再停下，
结论相反。这一条与 P-31 的错判同源（当时也是 grep 到字面就下了「无读取点」的结论）。对策已在 r2 稿写过一次，本轮再加一句：
**引用包内函数作论据时，注释里要写它的判定语义，不只写它读了什么键。**

---

## 四、实施记录（审批通过后，2026-09-21）

§二四条全部落地：

1. `src/trivium/probes/zcode.ts`：`buildProbeCliConfig` options 白名单加 `apiKeyRequired`（仅当源值为布尔）；注释改准 `Fqa` 语义；`pickNonFirstModel` 改读 `legacyProviderMembers`。
2. `src/trivium/adapters/zcode.ts`：新增导出 `legacyProviderMembers(cfg)`；`qualifyAgainstCliConfig` 改读它、切分改第一个 `/`；`zcodeModelTail` 改第一个 `/`。理由措辞保持既有断言可匹配（「没有 provider」「models 里没有」「没有任何 provider 提供模型」）。
3. 用例（`test/unit/zcode-model-selection.test.ts`，42 条）：假入口按 `Fqa` 语义应答（源里有 `apiKeyRequired:false` ⇒ 不写 v2、退 1）并把该键放进 options 白名单检查；新增三腿——免密 provider → 探针 `global` 且副本带 `apiKeyRequired`；成员规则四种形态（`deleted`、`id ≠ 键名`、`account:` 前缀、`source: managed`）对限定与挑选的影响；键名含 `/` 的限定与 `zcodeModelTail`/`decideModelOverride` 比对。`probeWith` 死三元删除。**一处预期改判**：裸写 `org/model-x` 按 `okt` 会被当成 provider `org`，限定判 null 是正确行为，这种模型名只能写全限定。
4. 留痕：BACKLOG EV-94 ② 补反向触发、EV-82 补 r3 收口记录；RUNBOOK 成因两条；设计 §21 v1.3.33 补第十段；M0 P-31 补导入器三条成员规则。

**验证**：`npm run check` 全量 1566 / 1564 pass / 0 fail / 2 skipped。变异五条（M-R3-A 白名单去掉 `apiKeyRequired`；B 成员规则退回键名；C 切分退回 `lastIndexOf`；D provider 过滤退回；E `pickNonFirstModel` 退回键名）全部咬住，复原后字节比对一致。`install:local` 后 `doctor --only zcode --no-model-calls` 在真实 zcode.cjs 0.16.9 上 `model_override=config_copy`，请求 = 写出 = `bigmodel-coding-plan/GLM-5.3-Flash`。

**验证过程里的一次空跑**：前两轮变异循环分别用了不存在的 `tsconfig.test.json` 与不含测试树的 `npm run build`，`dist/test` 没有重编，五条变异「全部逃逸」其实是跑在旧产物上；改用 `scripts/build.mjs --tests-only` 后才是真结果。记进设计 §21：变异验证先确认被测产物真被重编。
