---
schema: trivium.disposition.v1
topic: EV-112-无副本审查运行载体落点
stage: plan
role: claude
kind: revised
run_id: 20260924T152912Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - AGY-01
  - AGY-02
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
---

# 裁决：EV-112（无副本审查运行载体落点）· 计划双审第 1 轮

> 被审对象：`2026-09-24-EV-112-无副本审查运行载体落点-claude.md`（r1）
> ｜ 运行：`20260924T152912Z`（11m1s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`
> ｜ 共 13 条：次要 7 ｜ 吹毛求疵 6 ｜ 零阻断、零重要
> ｜ **全部接受**。同指一组：CODEX-01 ≡ CODEX-04（都指向 D2 改选 (a)）；GLM-03 与 codex「认为正确的部分」第 5 条同一结论（overrides 只作用于子代理）

## 0. 本轮的形状

**三侧一致判定成立的**：
- §1.2 取值链（P1～P4、P8）：codex 与 glm 各自到包里复核了关键字面，gemini 核了 `rB` / `aun` / `Lm.storage` / `JWr`；
- D1 取 (b) 三键；D3 并入会话库两个别名（`aun` 后者赢的读法、C8 键序推理都被确认；清别名使键序不再是风险）；
- §5.1 L1～L9 无漏路径（codex 按行号逐条对，glm 核了 `invokeZcode` 的全部 4 个调用点）；
- M2（先设后清反序）、M4（回读退回真实 HOME）咬得住；
- E0 的做法（合成副本、本地 401 服务、两组对照、无删除调用）站得住；不做 E2 的论证同意（glm 复算 0/133）。

**改方向的一处**：D2 由 (b) 改为 **(a) 两支都设**。gemini 与 glm 认可 (b)，理由都是「不扰动 EV-82 刚验收的副本支」；
codex 给出两个具体的洞（CODEX-01 beta 改写存储根、CODEX-04 副本源就是 CLI 的用户层配置文件），(b) 下这两个洞都开着，(a) 下都关上。
加上我复核时核出的第三个同类键（`ZCODE_RUNTIME_ENV`，见下），(b) 的「不扰动」换来的是三处落点可被宿主或用户配置带偏。
(a) 在副本支设的三个值与该支缺省值逐字相同，布局不变，由 E1 的副本支对照实测确认。

**我在复核 CODEX-01 时追出的第三个键**：`IZn` 在 CLI 启动期执行 `e[cz]=CZn(e,t)`，`cz = "ZCODE_RUNTIME_ENV"`（包内第 4 行 `XHe` 常量段）。
宿主设成 `development` 时，`L = Zzo(R, OCe(env) === "development")` 把 rollout 目录换成 `cli/debug`（包内 15243 行），
而回读只读 `cli/rollout`、`scrubZcodeHome` 的 `redactUnder` 也只列 `rollout` 与 `log`——与 CODEX-01 同构，而且两支都受影响，D2-(a) 也挡不住（它不改存储根，只改子目录名）。只能清。
同一段里 `ZHe` / `FQ` 会从 `ZCODE_TOOL_ENV_PASSTHROUGH_JSON` 回灌环境键，已核：放行名单（`yZn` / `TMi` / `IMi`）只有代理、CA、OTEL、遥测一类，不含任何落点键，这条旁路无害。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实，已到包里复核：CLI 主函数 `Ioc()` 调 `NCe(process.env)`（15449 行）→ `IZn` → `RMi`，`ZCODE_STORAGE_DIR` 为空且 `ZCODE_BETA=1` 或 `ZCODE_ENV=beta` 时，把 `homedir()/.zcode-beta` 写回环境，再经 `aun` 成为 `storage.dir`。(b) 下副本支 Env 层为空，rollout / artifacts 落 `<副本 HOME>/.zcode-beta/cli/…`，回读读不到、`redactUnder` 与 `exclude` 都不认 `.zcode-beta` 前缀。复核时追出同构的第三个键 `ZCODE_RUNTIME_ENV`（见 §0） | r2 §1.2 新增 P9（启动期落点改写：beta、运行档位）；§4.2 D2 改选 (a)，两支都设三键，`RMi` 见 `ZCODE_STORAGE_DIR` 非空即早退；§4.3 清除面新增一组「落点开关键」`ZCODE_BETA`、`ZCODE_ENV`、`ZCODE_RUNTIME_ENV`（与目录 / 路径键同样在全部路径清）；U2 诱饵表加这几个键 |
| CODEX-04 | codex | minor | 接受 | 属实。(b) 的理由是「不改副本支子进程环境」，但三键在副本支的取值与缺省逐字相同，「不改」只买到「不新增取值来源」；代价是 R1 留在 133 次运行的那一支上。R1 也不是外部假设：CLI 的用户层配置 `U7()` 就是 `<HOME>/.zcode/cli/config.json`，正是 `prepareZcodeHome` 的副本源，用户在里面写过 `storage.*` 就会被原样拷进副本并压过缺省值。与 CODEX-01 同指一个修法 | r2 §4.2 D2 改选 (a) 并写明改选理由与 gemini / glm 原认可 (b) 的依据；§8 删去 R1（已收口）；§6.2 M3 改为「副本支不设」⇒ U5 红；§6.3 E1 增加副本支对照（同一 HOME、设与不设三键，布局逐字相同） |
| CODEX-02 | codex | minor | 接受 | 属实，已复核：15243 行 `ZCODE_MESSAGE_ENABLED` 为 `1` / `true` 时建 mailbox，根目录 `zg(env.ZCODE_MAILBOX_ROOT ?? "~/.zcode/mailbox")`，按 HOME 展开、不随存储根。默认关，宿主打开时无副本支落真实 `~/.zcode/mailbox`，宿主预置根目录时两支都落到清扫面外。审查员用不到会话间消息 | r2 §1.2 新增 P10（mailbox）；§4.3 清除面加 `ZCODE_MAILBOX_ROOT`（路径键）与 `ZCODE_MESSAGE_ENABLED`（开关键）：子进程里 mailbox 恒关，不需要再为它设落点。U2 诱饵表同步 |
| CODEX-03 | codex | minor | 接受 | 属实。落点键被采纳是从压缩产物读出来的厂商能力事实，ZCode 随桌面端自动更新。键被改名时无副本支悄悄回到真实 HOME：`route: global` ⇒ 守卫对覆盖不判，唯一症状是 `model_effective` 变 null，被读成「未回读到」。U3 / U4 的假入口与实现用同一份读法，抓不到厂商漂移 | r2 §4.6（新）落点自检：`run()` 在 CLI 成功返回 envelope 且有 `sessionId` 时，核 `cliDir` 下「日志里有本次 `sessionId` 的行」或「rollout 文件在」至少一项成立；都不成立 ⇒ `CriticResult` 新字段 `carriers_landed: false`，经守卫播报（与 `model_override_applied: false` 同一条通道，不阻断），trace.json 记同一事实。§6.1 新增 U8（假入口无视三键、写回 HOME 缺省 ⇒ 字段为 false、守卫出声）；§6.2 新增 M9（去掉自检）。E1 因 401 走失败早退、到不了回读，这一点写进 §6.3 |
| CODEX-05 | codex | nit | 接受 | 属实。日志文件名 `zcode-<日期>.jsonl`、会话库 `db.sqlite` 都不含 sessionId，按文件名找只覆盖 rollout 与 artifacts | r2 §6.3 E1：真实 HOME 与假 HOME 两处都改为按内容核（日志逐文件查 `sessionId` 出现与否、会话库计数，只输出文件名与计数），另核 `~/.zcode-beta` 与 `~/.zcode/mailbox` 的存在性与 mtime；E0 的读数表注明它只按文件名核过 |
| AGY-01 | gemini | nit | 接受 | 属实，而且能加强 M4：只断言「载体在运行目录」证明不了「回读不碰真实 HOME」 | r2 §6.1 新增 U3b：假入口不写任何产物，临时用户目录里放一份带同一 `sessionId` 与模型的诱饵日志和 rollout ⇒ `model_effective` 为 null、`out/rollout.jsonl` 不存在、`carriers_landed: false`。M4 的应红用例加 U3b |
| AGY-02 | gemini | nit | 接受 | 属实。入参是「与 HOME 同层的根」（`<sideDir>/home`），函数内部才拼 `.zcode`；传错一层会得到 `.zcode/.zcode` 嵌套，且不报错 | r2 §4.2：`storageRedirectRoot` 与 `zcodeStorageRedirectEnv` 的 JSDoc 写明入参是 HOME 等价根、不是 `.zcode`；U1 加一条：入参以 `.zcode` 结尾时函数抛错（防嵌套） |
| GLM-01 | glm | minor | 接受 | 属实，读数表漏了这一行。对照组 stderr 首行多一句 `ZCode Built-in missing`，实验组没有。我追了一步：包内含「ZCode Built-in」的报错模板集中在内置 provider 配置的远端刷新（71 行 `xnr` 等，请求 ZCode 配置端点，不是模型调用），两组的 `v2/runtime/provider/…/zcode-builtin-refresh.json` 都在（P8，随 HOME）；「missing」这一句的完整字面不在主包，机理未定。单次样本分不清是三键引起还是刷新时序抖动 | r2 §1.5 读数表补 stderr 一行并如实写「机理未定」；§6.3 E1 每组重复 3 次、记录 stderr 首行。稳定只在对照组出现 ⇒ 定位并写进 §1.5；不稳定 ⇒ 登记为「与三键无关的时序差」；定位不了 ⇒ 如实登记「未解释的观测差」 |
| GLM-02 | glm | minor | 接受 | 属实，已复核：15024 行 `M9o` 拼 `join(storageRoot, "cli", "sessions", sessionId, "workflows", …)`，挂在存储根下。随存储根走，D1 顺带收口，修法不变 | r2 §1.2 新增 P5b（`cli/sessions/<sid>/workflows`）；§1.3 的载体清单与 BACKLOG 现象栏补上；U3 的假入口加写这一路径并断言同根 |
| GLM-03 | glm | minor | 接受 | 属实，codex 在「认为正确的部分」第 5 条独立得出同一结论：`builtInModelSelectionOverrides` 键域只有 `Explore` 与 `general-purpose`，`pluginAgentModelSelectionOverrides` 按插件 agent 展开，都不在主 agent 的选模链上 | r2 §4.1 代价段改写：主 agent 生效模型不受影响；变化的是无副本支**子代理**的模型选择（原先可能吃到用户 profiles 的覆盖，改后回落内置缺省）。§9 删去这条悬问；§7 RUNBOOK 同步句写明子代理回落 |
| GLM-04 | glm | nit | 接受 | 属实。M7 改的是 `run()` 的传参，纯函数没动，U1 不会红 | r2 §6.2 M7 的应红用例改为 U3、U6 |
| GLM-05 | glm | nit | 接受 | 属实。db、artifacts、memories、sessions 在运行目录里不脱敏，随 retention 整删（`run_dir_days`，现 30 天），与副本支同形态；「持久留存已不成立」会被读过头 | r2 §4.5 doctor 文案写成「不再留在真实 `~/.zcode`；落在运行目录，随运行目录保留期整删」；§8 新增 R6 写明这一层；§7 BACKLOG 关闭条目用同一措辞 |
| GLM-06 | glm | nit | 接受 | 属实。`probes/zcode.ts:521` 写「与审查运行同一形态」，D2 改 (a) 后连副本支也不再同形（审查运行多设三键），而这行不含「四个」「四键」字样，按字面兜底扫不到 | r2 §4.5 注释清单补 `probes/zcode.ts:521`；同步时除「四个 / 四键」外，另按「与审查运行同一形态」「目录键」两个短语各扫一次 |

## 2. 修订稿 r2 的改动清单（按节）

| # | 节 | 改动 | 来源 |
| :-- | :--- | :--- | :--- |
| 1 | 稿首 | 一句话结论改写：三键两支都设，另清落点开关键与 mailbox 键 | CODEX-01、CODEX-02、CODEX-04 |
| 2 | §1.2 | 新增 P5b（sessions）、P9（启动期改写：beta、运行档位）、P10（mailbox）；补 `ZCODE_TOOL_ENV_PASSTHROUGH_JSON` 旁路已核无害 | GLM-02、CODEX-01、CODEX-02、§0 |
| 3 | §1.5 | 读数表补 stderr 一行；注明「真实 HOME 未被写入」只按文件名核过 | GLM-01、CODEX-05 |
| 4 | §4.1 | 代价段改写（子代理回落，主 agent 不变） | GLM-03 |
| 5 | §4.2 | D2 改选 (a)；JSDoc 入参层级约定 | CODEX-04、CODEX-01、AGY-02 |
| 6 | §4.3 | 清除面由六键扩为十一键（七个目录 / 路径键 + 四个落点开关键） | CODEX-01、CODEX-02、§0 |
| 7 | §4.5 | doctor 文案措辞；注释清单补 :521 与短语扫描 | GLM-05、GLM-06 |
| 8 | §4.6（新） | 落点自检 `carriers_landed` 与守卫播报 | CODEX-03 |
| 9 | §5 | 影响表：L8 由「不变」改为「设三键（取值同缺省）」；消费方表补 `types.ts`、`guard.ts` | CODEX-04、CODEX-03 |
| 10 | §6.1 | U1 防嵌套；U2 诱饵扩到十一键；U3 加 sessions；新增 U3b、U8；U5 改为副本支也设三键 | AGY-02、CODEX-01、CODEX-02、GLM-02、AGY-01、CODEX-03、CODEX-04 |
| 11 | §6.2 | M3 翻向；M4 加 U3b；M7 改 U3、U6；新增 M9、M10（清单漏开关键） | CODEX-04、AGY-01、GLM-04、CODEX-03、CODEX-01 |
| 12 | §6.3 | E1 加副本支对照、每组 3 次、按内容核真实 HOME、beta / mailbox 目录；写明 E1 到不了回读 | CODEX-04、GLM-01、CODEX-05、CODEX-03 |
| 13 | §8 | 删 R1；新增 R6（运行目录内明文留存至保留期） | CODEX-04、GLM-05 |
| 14 | §9 | 重点改写 | — |
| 15 | 文末 | 与 r1 的偏差表 | — |

## 3. 其它登记

- **建议 r2 送第 2 轮计划双审**，由用户定。理由：D2 改了方向，而 gemini 与 glm 本轮认可的恰是被改掉的 (b)；另外新增了 `CriticResult` 字段与守卫播报（接口面扩大），清除面由六键扩到十一键。
  这三处都是审查员没见过的新内容，不宜不经审查直接定稿。若用户定不送，r2 作定稿，E1 的副本支对照承担 (a) 的主要验证。
- 编排器收尾结构提示：codex 与 glm 都在 evidence 里引用了 `zcode.cjs`，但没列入 consulted。那是项目外的厂商包，两侧都在正文写明了「只读字面抽查」，不影响结论，只记录。
- codex 侧 `peer_leak` 命中一条命令文本（`ls -ld . .reviews .trivium`），类别是编排器状态、不含审查意见，编排器已判不影响独立性。只记录。
- 台账：EV-112 的轮次不进 M10b 累计与阈值（r7 §4），本轮耗时 11m1s。
