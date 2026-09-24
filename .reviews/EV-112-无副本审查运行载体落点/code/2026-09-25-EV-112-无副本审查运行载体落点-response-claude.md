---
schema: trivium.disposition.v1
topic: EV-112-无副本审查运行载体落点
stage: code
role: claude
kind: response
run_id: 20260924T164417Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - AGY-01
  - GLM-01
  - GLM-02
---

# 应答：EV-112（无副本审查运行载体落点）· 代码双审第 1 轮

> 被审对象：相对 HEAD `b739c50` 的 18 个文件变更（补丁 136.9 KB）
> ｜ 运行：`20260924T164417Z`（9m51s）
> ｜ 结论：codex `request-changes` ｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`（**证据不足**，成因见 §0）
> ｜ 共 6 条：重要 1 ｜ 次要 2 ｜ 吹毛求疵 3 ｜ 零阻断
> ｜ **全部接受**；同指一组：CODEX-01 ≡ GLM-01（反向核只盖 rollout，日志这一半漏报）

## 0. 本轮的形状

**三侧一致判定成立的**：先清后设的顺序与十一键清除面在全部拉起路径一致落地，探针与探活没有被误设落点；落点根、回读目录、清扫根三处同根；
合取判据、run.json 条件展开与 schema 一致；假入口忠实于包内取值链；13 条变异的 find 串逐条唯一、装置闸门可信（codex、glm 各自对账）。

**唯一一条重要意见**（CODEX-01 ≡ GLM-01）：合取判据的前提是日志键与存储键能各自漂移，而反向核只核 rollout。
「丢日志键、存储根还认」时留痕是 `{log:false, rollout:true, leaked_to_home:false}`，而日志在无副本支的唯一兜底就是真实 `~/.zcode/cli/log`——
含送审包全文的日志写进了真实 HOME，归档却记「没泄漏」，泄漏句不响，RUNBOOK 的清理指引也只指向 rollout。这正是 EV-112 原本登记的那个载体。

**本轮自己撞上了 R7**（glm 顺带报的观测，已核实）：本次审查运行跑的是旧构建（安装副本构建于 `1b7cfed`，收尾两条构建标识告警如实报出），
旧构建只清四键、不设存储根。送审补丁里有 `…/zcode-beta.app` 这样的字面（用例与计划正文），整份送审包作为 `--prompt` 进了 argv，
命中包内 `RMi` 的 argv 判据 ⇒ glm 副本 HOME 的存储根被改写到 `.zcode-beta/`：
`~/.trivium/runs/TriviumCode-2217d505/20260924T164417Z/glm/home/` 下实有 `.zcode-beta/cli/{rollout,memories,plugins}`，
而日志与会话库不随存储根、仍在 `.zcode/cli/`。rollout 落在回读目录之外 ⇒ 本侧读取路径（取自 rollout）为空 ⇒ **glm「证据不足：项目文件读取 0 次」的成因就是它**。
计划双审第 2 轮那次运行的送审包里没有这一字面，副本 HOME 下没有 `.zcode-beta/`（同法只列文件名核过）。
这是 R7 在真实运行里兑现的第一次：新代码两支都设存储根，`RMi` 早退，不会再发生；它也说明 R7 在探针路径上并非纸面风险——探针提示语是固定的，
但只要入口路径命中就会触发。glm 本侧结论照读（它与 codex 独立命中了同一处重要缺陷），不计为合格双审的一半。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 属实。合取判据立论的「两条路径各自漂移」对反向核同样成立，而反向核只查 rollout 文件名；日志键单独失效时，日志回落真实 `~/.zcode/cli/log`（包内 `N6s` 唯一兜底），归档与播报都给出「没泄漏」。采用直接取证，不采用「无副本 + `log === false` 即推定泄漏」的推断：后者在日志因别的原因缺失时会误报，而直接扫真实日志目录、按 `sessionId` 字段判定只多一次只读扫描 | 修改计划 ①：`checkZcodeCarriers` 的反向核扩到日志——无副本支读真实 `~/.zcode/cli/log/*.jsonl` 中**修改时间不早于本次拉起**的文件（限定扫描面，不读历史大文件），有顶层 `sessionId` 等于本次会话的行即记泄漏，只输出布尔、不读出内容；`leaked_to_home` 由布尔改为 `{ log, rollout }` 两项，与正向核同形。guard 泄漏句点名泄漏的是哪一类及其路径；`types.ts`、`run.v2.json`、设计 6.7.1、RUNBOOK 排查第③步同步（日志按 `sessionId` 用 `grep -l` 自查，注明该文件可能混有其它会话、需自行确认后处理）。用例：假入口新增 `store` 形态（只认存储键、不认日志键）⇒ `{log:false, rollout:true, leaked_to_home:{log:true, rollout:false}}`；其余形态的断言形状随之改；变异新增 M14（去掉日志反向核）⇒ `store` 臂红 |
| GLM-01 | glm | minor | 接受 | 与 CODEX-01 同指；另给了「对真实 HOME 的 log 目录做同样的只读扫描、只输出布尔」这一实现方向，正是修改计划 ① 采用的形态 | 并入 CODEX-01 的落点 |
| CODEX-02 | codex | minor | 接受 | 属实。自检扫日志目录下全部文件，紧邻的回读仍只取最新一个，跨午夜时会出现「自检说日志在、回读说读不到」。两支的日志目录现在都是本次运行独占的（落点根 `zcodeHomeUnder(sideDir)`），目录里的文件全属于本次运行，不必再只取最新一个 | 修改计划 ②：`run()` 回读改为按文件名排序读日志目录下全部 `.jsonl`、拼接后交 `parseZcodeTrace` 一次解析（仍按 `sessionId` 过滤），与自检共用同一个文件集合；`probes/zcode.ts` `readRuntimeSelectedModel` 文档块里「取法与审查臂对齐：排序取最新」改为写明两处各自的取法与理由（探针 HOME 单会话、取最新；审查臂读运行目录全部）。用例：假入口新增 `split` 形态（启动事件写在前一天的文件、其余写在后一天）⇒ `model_effective` 读回；变异新增 M15（回读退回只取最新）⇒ `split` 臂红。计划 r3 §8 R3（跨午夜回读落空）随之收口，在结案留痕里写明 |
| CODEX-03 | codex | nit | 接受 | 属实。三键只管到日志目录、存储根与会话库；包内至少还有 workspace-hook trust store（`yas`，按 `homedir()` 或用户配置的 `storage.dir` 推）与 rollout 的 `homedir()` 兜底（`e4s`，在未传 `modelIoDir` 时生效）两条不经三键的路径，是否在 `--prompt` 形态下被走到未核；落点自检也只观测 log 与 rollout 两类。「一律」比机制与自检的覆盖面宽 | 修改计划 ③：设计 v1.3.39 变更记录标题与 §11.3 那一条、RUNBOOK 第 267 行、doctor note 的「一律 / 不再留在真实 ~/.zcode」改为按载体列举（日志、rollout、会话库、存储根下的 artifacts / sessions / memories / plugins），并注明「落点自检只覆盖日志与 rollout 两类」；设计的残余段补一句 `yas` / `e4s` 两条路径（不含送审内容、未核是否走到） |
| AGY-01 | gemini | nit | 接受 | 属实。计划 r3 §5.2 的消费方清单除 `zcode-model-selection.test.ts:201` 之外还漏列了几处：第 1 行漏 `zcode-model-selection.test.ts:201`（键集全等）与 `zcode-runtime-selection.test.ts:324`（宿主预置下的探针臂，语义未变、断言照旧成立）；第 2 行 `storageRedirectRoot` 漏 U3 / U4 / U5；第 3 行 `zcodeStorageRedirectEnv` 漏 U2 / U5；第 5 行 `carriers_landed` 漏 `src/trivium/adapters/stub.ts`（U9 所需的注入口）。代码与用例都已落地，漏的是登记 | 计划 r3 是已提交的定稿，不回改；完整清单以本表为准，并在结案留痕（BACKLOG EV-112 关闭条目）里写明「r3 §5.2 漏列五处，见代码双审应答件」。同类登记在实施报告里如实报出 |
| GLM-02 | glm | nit | 接受 | 属实。U2 直接写 `process.env` 且只在 finally 里删除，不保存也不还原宿主旧值；本机宿主若预置了这些键，后续用例看到的底色就被改了。同文件 U7 与 model-selection 的端到端用例都是先记后还原 | 修改计划 ④：U2 照 U7 的写法，先记旧值，finally 里原值为 undefined 则删、否则写回 |

## 2. 修改计划（审批后执行）

1. **反向核扩到日志**（CODEX-01 ≡ GLM-01）：`checkZcodeCarriers(cliDir, sessionId, realHome, since)`，`since` 为 `run()` 在拉起前取的时间戳；
   `leaked_to_home: { log, rollout }`；guard 泄漏句按项点名；`types.ts` / `run.v2.json` / 设计 6.7.1 / RUNBOOK 同步；新增 `store` 形态用例；
2. **回读与自检共用日志文件集**（CODEX-02）：回读读全部 `.jsonl`；探针侧文档块改写；新增 `split` 形态用例；
3. **措辞收窄**（CODEX-03）：设计、RUNBOOK、doctor note 按载体列举，注明自检覆盖面；设计残余段补 `yas` / `e4s`；
4. **U2 还原宿主环境**（GLM-02）；
5. **变异**：规格补 M14（去掉日志反向核）、M15（回读只取最新），M13 的 find 随代码改；重跑 15 条，输出覆盖进同一 evidence 目录；
6. `npm run typecheck`、`node scripts/build.mjs --with-tests`、`npm test` 全绿。

改动面：`src/trivium/adapters/zcode.ts`、`src/trivium/guard.ts`、`src/trivium/types.ts`、`src/trivium/probes/zcode.ts`（注释与 note）、`skills/dual-critic/schema/run.v2.json`、
`test/unit/zcode-carriers.test.ts`、`test/unit/zcode-provider-env.test.ts`、`test/unit/zcode-model-selection.test.ts`（U5 形状）、`test/integration/code-stage.test.ts`（U9 形状）、
设计文档、RUNBOOK、变异规格。不改方向，不新增接口面之外的字段。**建议不再送第 2 轮代码双审**，由用户定：本轮只有一条重要意见，两侧给出的修法形态一致，其余都是边上的修整。

## 3. 其它登记

- **收尾两条构建标识告警**（安装副本不是当前工作树构建的；与仓库 HEAD 不同版）属预期：本次审查运行用的是 `1b7cfed` 构建的旧编排器，被审改动尚未构建安装。§0 的 R7 实例正是它的后果。
- **glm 侧证据不足**的成因已在 §0 定位，不是适配器缺陷：旧构建下 argv 触发的 beta 改写把 rollout 带出回读目录。新代码落地后，同样的送审包不会再触发。
- **编排器收尾结构提示**：codex、glm 在 evidence 里引用了项目外的厂商包或未列入 consulted 的用例文件；三侧 consulted 均无法与工具轨迹交叉核对。只记录。
- **E1 零配额验收**仍排在代码提交之后；本轮 §0 的观测提示 E1 的 argv 约束（计划 r3 §6.3）要严格执行，E1 脚本的提示语与路径不得含该字面。
- 台账：EV-112 的轮次不进 M10b 累计与阈值（r7 §4），本轮耗时 9m51s。
