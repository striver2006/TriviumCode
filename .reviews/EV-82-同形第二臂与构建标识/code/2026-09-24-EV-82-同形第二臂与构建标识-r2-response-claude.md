---
schema: trivium.disposition.v1
topic: EV-82-同形第二臂与构建标识
stage: code
role: claude
kind: response
run_id: 20260924T055944Z
addresses:
  - CODEX-F01
  - GLM-01
  - GLM-02
---

# 应答：EV-82 小主题第一段 · 代码双审第 2 轮

> 被审对象：相对 `HEAD`（`833598cd`）的 19 个文件，补丁 104.6 KB（含第 1 轮已审部分与本轮修改）
> ｜ 运行：`20260924T055944Z`（10m41s）
> ｜ 结论：codex **解析回退**（原文 JSON 自报 `approve-with-nits`，7 条：次要 3 ｜ 吹毛求疵 4）
> ｜ gemini `approve`（零意见） ｜ glm `approve-with-nits`（次要 2）
> ｜ **全部接受**

## 0. 本轮的形状

**第 1 轮 9 条应答的落地，三侧都逐条对代码核过**。例如：
- codex 读了打包产物，确认 `__TRIVIUM_BUILD__` 已替换成字面量；
- codex 实测 `os.tmpdir()` 会逐次读 `TMPDIR`，所以私有 TMPDIR 的清理断言确有判别力；
- 15 条变异的 `find` 字面在现工作树上都各命中一处。

浅克隆那一支，codex 与 glm 都构造不出「本仓被判否且一声不响」的路径。设计文档两行与代码一致。

**codex 侧解析回退**：编排器把它的整段输出抽成一个回退单元 `CODEX-F01`，闸门按这个编号校验。
原文是完整的结构化 JSON，内含 7 条意见 CODEX-01～07。**7 条逐条裁决见 §1**，不因合成一格而笼统处理（FR-14）。

**问题集中在残余扫描**：它是第 1 轮为堵黑名单漏判加的第二层，本轮三处意见都打在它的边界上。
- **论域窄于应答承诺**（CODEX-01 ≡ GLM-02）：第 1 轮应答写「凡位于 `provider.*` 之下」，实现只扫 `provider.*.options`。
- **锚定正则放过 `Bearer <token>` 这种带空格的形态**（GLM-01）：`apiKeyOnly` 档又不做 `headers` 容器替换，第二段第一刀一跑就会漏。
- **误挡一侧过宽**（CODEX-04）：UUID 这类合法长标识会被当成凭据，把实验永久挡成未判定。

我照单实现时自己收窄了扫描论域，理由（避开长模型 id 误挡）写在代码注释里，**没有回到应答件登记为偏离**。这正是「断言的适用范围悄悄变了」那一族。

**另一处漏接（CODEX-03）已核属实**：`test/unit/zcode-provider-env.test.ts` 的 `doctorOnZcode` 调 `runDoctor` 时既不传 `cliConfigPath`，`DoctorOptions` 也没有探针注入口。
在装了 ZCode 的机器上，两条臂都会读真实的 `~/.zcode/cli/config.json`。白名单臂那一路是既病（EV-94 ① 同族），同形臂又多了一路。

**闸门期不改代码。** 落点在 `/dual-approve` 之后实施。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-F01 | codex | minor | 接受 | codex 侧解析回退，本单元即其原文 JSON，内含 CODEX-01～07 七条（次要 3、吹毛求疵 4）。七条逐条核过，全部接受，逐条理由与落点见 §1 子表。其中 CODEX-01 与 GLM-02 同指，合并处置 | 见 §1 子表七行；合并处置的落点写在 GLM-02 行 |
| GLM-01 | glm | minor | 接受 | 核对属实：`RESIDUE_RE` 是整串锚定的 `^[A-Za-z0-9._+/=-]{20,}$`，`Bearer <token>` 因空格整串不命中；`apiKeyOnly` 分支不调 `sentinelizeCredentials`，`headers` 容器规则走不到。第 1 轮 CODEX-04 的应答已写明第二段第一刀就用这一档复跑，真实配置若带 Bearer 头，就会真实鉴权 | 采纳审查员三个选项中的①与②：<br>①`apiKeyOnly` 档**仍对 `headers` 容器内的字符串换哨兵**。收窄的变量只是「键名替换面」，容器规则与它正交；白名单臂对导入器的分析（headers 可缺、不影响导入成败）说明这不污染诊断目的。<br>②残余扫描判定前**先剥鉴权 scheme 前缀**（`Bearer` / `Basic` / `Token` 加空白），再对余下段测长随机串形态，两档都生效。<br>用例：对照用例的夹具加一个带 `headers.Authorization: 'Bearer <长串>'` 的变体，断言 `apiKeyOnly` 档副本里没有原值；再断言「`options` 里有 `Bearer <长串>` 的非 headers 键」时残余扫描命中、不拉起。变异：去掉前缀剥离 ⇒ 后一条用例红 |
| GLM-02 | glm | minor | 接受 | 核对属实（与 CODEX-01 同指）：第 1 轮应答落点写「凡位于 `provider.*` 之下」，实现只 walk `provider.*.options`；provider 级其它键与顶层都不进扫描，也没有结构兜底。`CREDENTIAL_KEY_RE` 不含 `key` / `auth` / `session` / `passphrase` 这类短键，裸长十六进制值挂在这些键下会三层全过。我收窄时没把它登记为偏离 | ①**扫描论域放宽到整个 `provider.<id>`**，只跳 `models` 子树与 `name` 键，与第 1 轮应答文字对齐。<br>②**顶层仍不扫**：顶层有 `model.main` 一类合法长值（`bigmodel-coding-plan/GLM-5.3-Flash`），扫描会把实验挡成未判定。这一收窄**登记为已知残余**，写进设计文档探针行与本段收口报告，不再只留在代码注释里。<br>③`CREDENTIAL_KEY_RE` 增**全键名精确匹配**的短键：`key`、`auth`、`session`、`passphrase`（只在键名恰好等于它们时命中，不做子串匹配，避免 `keyboard` 这类误伤）。<br>用例：`provider.x.auth.key` 配裸长十六进制值 ⇒ 被替换或被扫到、不拉起；变异：论域退回只扫 `options` ⇒ 该用例红 |

## 1. CODEX-F01 内含七条的逐条裁决

> 本表只为逐条说清，不是闸门的裁决表；闸门按 §0 所述以 `CODEX-F01` 一格校验。

| 原文编号 | 严重度 | 裁决 | 理由与落点 |
| :--- | :--- | :--- | :--- |
| CODEX-01 | minor | 接受 | 与 GLM-02 同指，合并处置，落点见裁决表 GLM-02 行（论域放宽到 `provider.*` 减 `models` / `name`；顶层收窄登记为已知残余；短键精确匹配） |
| CODEX-02 | minor | 接受 | 核对属实：`apiKeyOnly` 档 `replacedPaths` 恒为空，但 `options.apiKey` 随后被无条件改写，why 报「替换 0 处」与盘上事实不符；注释把两档并列成「都照做残余扫描」，读者会以为安全前提一致。落点：①`forceProviderApiKeySentinel` 返回它改写的键路径，两档都并入 `replacedPaths`，读数与盘上一致；②`apiKeyOnly` 档注释、设计文档探针行写明「本档只收窄键名替换面；`headers` 容器替换、`apiKey` 结构兜底与残余扫描照旧（GLM-01 落点①）；**不做键名替换的凭据若不被残余扫描命中，会进副本**」，不宣称与 `full` 档同等零配额；③对照用例把「`replacedPaths` 为空」改为「只含各 provider 的 `options.apiKey` 路径」 |
| CODEX-03 | minor | 接受 | 核对属实（§0）。落点：`DoctorOptions` 增可选 `zcodeProbe?: { cliConfigPath?; modelOverrideProbe?; modelOverrideFullCopyProbe? }`，由 `runDoctor` 透传给 `probeZcode`，与 `probeZcode` 既有注入口同形；`doctorOnZcode` 注入合成 `cliConfigPath` 与两臂恒 null 的桩。扫一遍全部 `runDoctor` / `probeZcode` 调用点，确认没有第二处漏接，扫描结论写进收口报告 |
| CODEX-04 | nit | 接受 | 成立：`RESIDUE_RE` 连 UUID（36 位带连字符）、不带 scheme 的端点、长项目名都会命中，命中即把实验挡成未判定。落点：判定前**排除**标准 UUID 形态（`8-4-4-4-12` 十六进制）与「含 `/` 且至少两段」的路径形态；补负向用例「合法长标识不被拦」（UUID、`open.example.cn/api/paas/v4`）。**不加「显式开关放行」**：放行开关本身就是绕过零配额承诺的口子 |
| CODEX-05 | nit | 接受 | 成立：出错转告警只覆盖抛异常；本仓模式下 `computeInputsSha256` 重算失败（返回 null）或 `projectHead` 取不到时，对应判据静默消失，与「查过、干净」同形。落点：`buildStampWarnings` 在本仓模式、`build` 非 null 时，`currentInputsSha256 === null` 或 `projectHead === null` 各产出一条「构建标识比对未能完成：<哪一项>取不到」；用例两条；变异：去掉这两条 ⇒ 红 |
| CODEX-06 | nit | 接受 | 核对属实：第 1 轮 GLM-03 落点承诺「断言 run.json 的 `gate.warnings` 有这条」，落地的只有纯函数单测，`review.ts` 的接线没有任何用例或变异覆盖。落点：在 `test/integration/fault-injection.test.ts` 已有的「本轮原稿不在保护集」端到端用例旁加一条：夹具项目的 `package.json` 的 `name` 设为 `triviumcode`（测试构建无标识 ⇒ 按包名进本仓模式），跑完整流程，断言落盘 run.json 的 `gate.warnings` 含「构建标识缺失」、`gate --check` 转述为 `run_warning`。走真实路径，**不在生产代码里开测试后门**。变异清单加一条：删去 `review.ts` 那段循环 ⇒ 该集成用例红 |
| CODEX-07 | nit | 接受 | 成立：对拍只断言两值相等，两臂同时退化成 `[null, null]` 也全绿，正是它替代「同一引用断言」时要防的共模失效。落点：四种形态各钉期望值：无旗标 `config_copy` / 请求值；`FAKE_IGNORE_MAIN` `global` / 首位；`FAKE_NO_IMPORT` `global` / null；`FAKE_CRASH` null / null。两臂各自断言期望值，再断言相等 |

## 2. 本轮不做的事

- 不扫顶层（GLM-02 落点②），登记为已知残余。
- 不加残余扫描的放行开关（CODEX-04）。
- r2 §4 的实验仍在提交之后。
