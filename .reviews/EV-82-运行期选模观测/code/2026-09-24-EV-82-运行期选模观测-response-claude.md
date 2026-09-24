---
schema: trivium.disposition.v1
topic: EV-82-运行期选模观测
stage: code
role: claude
kind: response
run_id: 20260924T074436Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
---

# 应答：EV-82 第二段（运行期选模观测）· 代码双审第 1 轮

> 被审对象：相对 `HEAD`（`49e284ea`）的 5 个文件，补丁 48.7 KB
> ｜ 运行：`20260924T074436Z`（8m30s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve`（零意见） ｜ glm `approve-with-nits`
> ｜ 共 9 条：次要 4 ｜ 吹毛求疵 5 ｜ 零阻断、零重要
> ｜ **全部接受**；两组同指：CODEX-01 ≡ GLM-04（审查臂的日志目录变量），CODEX-02 ≡ GLM-03（provider 键未按 trim 定位）

## 0. 本轮的形状

**三侧一致判定成立的**：运行期读数的六种成因互斥、fail-closed、只取 `context.model` 一个字段；两臂的读取都在临时根整删之前（RS2 / RS3 变异双向咬合）；置首只动顺序，成员定位与导入器同规则，挪不动一律不当成功；同形臂新补的请求模型限定没有改变 as-is 路径与既有早退；运行期对照只比 modelId 段，与配置层判据同口径；12 条变异覆盖计划 §7 列的全部形态。codex 另从包内字面核实了生产者形态：事件名、`context.model` 为 `providerId/modelId` 字符串、选定为空时整键缺失、日志文件名是固定宽度日期（字典序等于时间序，「取最新文件」成立）。

**意见集中在三处边**：①审查臂仍继承宿主的 `ZCODE_LOG_DIR`（本段按计划没动审查臂）；②置首在 provider 一级没按 trim 定位；③运行期 ⚠️ 的触发面：`no_model_field` 漏报，`null` 档不报是否有意没说清，显式请求首位模型时判据失明而不提示。另有设计文档一格与新行为相反。**没有代码行为错误**。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实：`grep ZCODE_LOG_DIR src/` 只命中探针两处，审查臂经 `zcodeProviderEnv` 原样继承。宿主一旦预置该变量，后果有两条。①`modelFromLog` 静默落空，生效模型只剩 rollout 一个来源；而计划 C5 的「真实运行启动即回落」正是用 `modelFromLog` 核实的。②CLI 日志（可能含送审包全文）落到副本 HOME 与 `scrubZcodeHome` 清扫面之外。建议给了两种修法：「审查臂也清」改的是审查运行的环境构造，计划 r2 §2 明文「本段不改审查臂」，M10b r5 §14 要求越范围改动由用户拍板；所以本段取另一种修法「doctor note」，并正式登记，不只留在代码注释里 | ① `probeZcode`：宿主预置 `ZCODE_LOG_DIR` 时出一条 note，与 `hostCredentialEnv` 同型，只判有无、不打印值。文案写明「两条探针臂已清；审查运行不清，CLI 日志会落到副本 HOME 与清扫面之外，`modelFromLog` 读不到，生效模型只剩 rollout 一源」。补桩用例，并补一条变异「note 条件取反」。② BACKLOG 新增条目：审查臂对 `ZCODE_LOG_DIR` 的处置。候选修法是并进 `ZCODE_DIR_ENV_KEYS` 清除集，一行改动、方向 fail-safe；列为第三段候选，待用户拍板。③ 计划 §5 只读脚本的环境登记加一项「宿主是否预置 `ZCODE_LOG_DIR`」 |
| GLM-04 | glm | nit | 接受 | 与 CODEX-01 同指。glm 补了「与 `ZCODE_DATA_BASE_DIR` 当初进清除清单的理由同构」这一论据，并判不处理符合计划；它的建议（登记 BACKLOG，或 doctor 对宿主预置出 note）正是 CODEX-01 的落点 ①② | 并入 CODEX-01 的落点 ①（doctor note）与 ②（BACKLOG 条目），条目里引用 glm 的同构论据 |
| CODEX-02 | codex | minor | 接受 | 属实，codex 已在产物上复现：`{' bp ': …}` 请求 `bp/B` 时，限定通过而置首报「副本源里没有 provider bp」，与事实相反。计划 §4 规定挪不动的读数不落 (F1) / (F3)，实验就会去查一个不存在的问题。docbox 写「与导入器同一规则」，但成员一级成立、provider 一级不成立 | `reorderRequestedFirst` 定位 provider 改成扫 `Object.keys(providers)`，取 `trim()` 后等于 `providerKey` 的原始键，重建时仍用原始键。若有多个原始键 trim 后同名，判 `applied:false`，理由是导入器在重名时取哪个未经核实，不猜。docbox 改为「provider 与成员两级都按 trim 定位」。补用例：键带空白能挪动；两键 trim 后同名判挪不动。补变异「provider 按原样键查」 |
| GLM-03 | glm | nit | 接受 | 与 CODEX-02 同指；glm 从源码推演得出，codex 在产物上实测 | 并入 CODEX-02 的落点 |
| CODEX-03 | codex | minor | 接受 | 属实：`no_model_field` 表示已拉起、启动阶段选定为空，请求值必然没被采用，比「≠」更强，现在却只在 note 中段一小句。计划 §3 只写了「≠ 时对照」，是计划缺口，本段补上；codex 的前提（选定为空时整键消失）已从包内核实 | `probeZcode` 的对照循环：配置层 `config_copy` 且运行期 `no_model_field` 时，单列一条 ⚠️「配置读取层写出了请求值，但启动阶段选定为空」。补桩用例，并补一条变异「去掉该分支」 |
| GLM-02 | glm | nit | 接受 | 收窄是有意的，但没写明，这一点属实。⚠️ 文案的前提是「配置读取层写出了请求值」：`null` 表示配置层本轮未判定，`global` 表示没写出，两档下这个前提都不成立，对照无从说起；运行期读数已在 note 中段，`global` 另有配置层 ⚠️。glm 说的「超时被杀：v2 未写、启动事件已在」这一格，读数照常进 note，不会丢 | 对照循环的注释写明「只在 `config_copy` 下对照；`null` / `global` 两档前提不成立，不叠加，运行期读数照常进 note」。补一条 `override: null` + 运行期 ok≠请求的桩用例，锁住「不响 ⚠️、note 带读数」 |
| CODEX-04 | codex | nit | 接受 | 属实：`opts.model` 绕过了 `pickNonFirstModel`。请求首位模型时，「采信」与「回落」回读同值，判据按构造失明；设计文档把「固定请求非首位」写成了前提。同理，同形臂的 `requested-first` 变体按构造把请求挪到首位，配置层判据也失明，这一格 codex 没点，一并处理。结论本身不改（`override` 照常出）：改结论等于替实验下判断；如实标注即可 | 两臂取模型后判一次：请求的 modelId 段是否等于源目录（`legacyProviderMembers` 首个 provider 的首个成员）的首位。是则在 `why` 追加「请求为目录首位：采信与回落回读同值，本轮配置层结论无判别力」。`requested-first` 且置首生效时，`why` 追加「置首后配置层判据按构造失明，本次只看运行期读数」。`opts.model` 注释写明这条不变量。设计文档第 252 行「固定请求**非首位**」改为「缺省请求非首位；显式指定首位或置首时，结论照出并标注无判别力」。补用例两条 |
| GLM-01 | glm | minor | 接受 | 属实：设计文档探针表 `zcode.model_override_full_copy` 一格仍写「只判配置读取层，看不见运行期注册表层」，与变更后的行为相反；源码里同一句已随本段改掉，设计文档漏同步，违反改动同步清单。**版本号不升**：第一段往同一文档加两行时也没升，版本号留到 M10b 收口统一处理 | 设计文档第 287 行改为：「**配置层结论**只判配置读取层；**运行期选定**另读启动事件 `context.model`（与审查臂 `modelFromLog` 同一字段），进 note 并在 `config_copy` 下对照，不落盘、不进 `ProbeSection`」。`zcode.model_override` 一行补同一句。第 252 行随 CODEX-04 修改 |
| GLM-05 | glm | nit | 接受 | 属实：计划 r2 §3 写的签名是 `readRuntimeSelectedModel(home, launched)`，实现为单参，`not_launched` 由两臂在早退路径注入。这是有意偏离（未拉起就不该去读；把「没读」伪装成读数，反而多一个出错面），但函数 docbox 与偏差说明都没点出 | docbox 加一句「`not_launched` 由调用方在早退路径注入，不进签名」；本件 §2 登记为有意偏离 |

## 2. 实现相对计划 r2 的偏差（如实登记）

1. **C2 事实失准**（计划的，不是审查意见）：计划 r2 C2 称同形臂「已调 `qualifyAgainstCliConfig`」，实际原先没有，是本段补上的。codex、gemini、glm 三侧都核过，这次调用没改变 as-is 路径与既有早退。计划 r2 原文不改（已审批定稿），以本条为准。
2. **签名偏离**（GLM-05）：见上表。
3. **实施中多补的一处**：`requested-first` 变体遇到请求模型限定失败时，`variant.reason` 写明「限定失败，无从置首」，此前只有 `applied:false`。有用例覆盖。
4. **运行期读数与审查臂取法方向相反**（codex「认为正确的部分」末条，非编号意见）：本处取「最新文件里最后一条启动事件」，审查臂 `parseZcodeTrace` 取「第一条带 `context.model` 的行」。计划 r2 §3 明文要求取最后一条；真实日志目前只有一行带该字段，两种取法等价。落点：`readRuntimeSelectedModel` 的 docbox 点一句，免得后来人以为两处逐字同源。
5. **不在本段修、只登记的**：
   - 构建标识在纯文档提交后误报「与 HEAD 不同版」（计划 r2 §9）。进 BACKLOG，候选修法是 `inputs_sha256` 一致时降级；
   - 审查臂 `ZCODE_LOG_DIR`（CODEX-01 ≡ GLM-04）。进 BACKLOG，第三段候选。
6. **环境变化**：本轮首次预检报 agy 版本由 1.2.9 变为 1.2.10（退 69，未启动）；第二次预检时探针记录已是 1.2.10，预检通过。轮次台账备注记这一条。

## 3. 修改后的核验

- 新增用例：CODEX-01 note、CODEX-02 两条、CODEX-03、GLM-02、CODEX-04 两条；
- 新增变异：provider 按原样键查、`no_model_field` 分支去掉、日志目录 note 条件取反、首位判定取反。变异规格追加进 `doc/05_testing/evidence/ev82-seg2-mutation-20260924/`，旧输出保留，新输出另存；
- 依次跑 typecheck、全量测试、build、`install:local`、`doctor --selftest`；
- 改动面涉及 4 个源与测试文件、1 份设计文档，均按上表执行，另起代码双审第 2 轮与否由用户定。

## 4. 本轮之后

审批后按上表修改，再交用户决定是否送第 2 轮。提交后在干净工作树上重建、重装，按计划 r2 §5 跑只读脚本的三次拉起，结果追加进报告。M10b r6 修订稿与 BACKLOG 条目随后补。
