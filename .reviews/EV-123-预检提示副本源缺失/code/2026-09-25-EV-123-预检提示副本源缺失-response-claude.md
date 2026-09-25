---
schema: trivium.disposition.v1
topic: EV-123-预检提示副本源缺失
stage: code
role: claude
kind: response
run_id: 20260925T002833Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - AGY-01
  - GLM-01
  - GLM-02
---

# 应答：EV-123（预检提示副本源缺失）· 代码双审第 1 轮

> 被审对象：相对 `b16f144` 的工作树补丁（30 个文件，144.3 KB）
> ｜ 运行：`20260925T002833Z`（6m27s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `request-changes` ｜ glm `approve-with-nits`
> ｜ 共 7 条：重要 1 ｜ 次要 4 ｜ 吹毛求疵 2 ｜ 零阻断
> ｜ **7 条全部接受**。三侧同指一条：CODEX-01 ≡ AGY-01 ≡ GLM-01（复查的 catch 不回收 running 闸门）。口径文档漏项两条同族：CODEX-02、GLM-02

## 0. 本轮的形状：用户的三个焦点

- **焦点一 `startRun` 复查的落点与加锁失败路径**：**落点三侧一致成立，失败路径三侧同指有缺陷。** 落点（FR-23 跳过分支之后、派生之前，`rc.sides` / `rc.adapters`）没有异议。但我给复查单独包的 `try` 只放锁、不回收闸门——而此时 `prepareRun` 已经把该阶段闸门置成 `running`（`review.ts:980`）。紧随其后的主 `catch` 才是这一段正确的对照（`releaseRunningGate` + `lock.release`，注释原话「prepareRun 之后才失败：闸门已经是 running，必须连它一起回收」）；我在偏离清单里写「与紧邻的 prepareRun 失败路径同形」，**选错了对照邻居**。今天这条路径抛不出（`exists()` 吞全部异常，两家 `modelOverrideSource()` 都是纯路径拼接），三侧都认定是潜伏缺陷；但防御分支本身必须正确。修法取三侧共同建议：把复查挪进主 `try` 作为首句，落点不变。
- **焦点二 warn 口径是否每一处都由代码置位**：**五个来源全部由代码置位，三侧一致；但口径段写成了闭集，漏列两格「不标」。** codex 找出 `checkCliVersions` 对**未入选侧**的坏消息记 `ok: true` 加「（本次未选用该侧，仅提示）」；glm 找出「探针结论新鲜」的部分过期 / 未探行。两格都不标 `warn` 是对的，但设计口径段没列，读者会以为「列出来的就是全部」。修文档，不改代码。
- **焦点三 偏离 1（`adapters` 注入、不在文件级钉 HOME）**：**三侧一致站得住。** codex 附带指出选项名读起来像「预检的适配器表」，实际只喂 ④″，④ 只读能力与 ⑧ 探活都不读它——注释补全这一点。

另两条焦点外的意见：探针模块里还有副本源路径的第四处拼写、且是模块加载时取值（CODEX-03）；`warnings` 在 `--start` 与同步 `review --stage --json` 里同键不同形（CODEX-04）。都接受，以文档与登记收口。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实，已复核 `run-protocol.ts:352-358` 与 :429-434、`review.ts:980`。复查位于 `prepareRun` 成功返回之后，闸门已是 `running`，单独的 `catch` 只放锁，闸门会停到 `approval_lock_ttl_h`（默认 24h）；且失败发生在 `writeStatus` 之前，`hookSessionStart` 的清扫拿不到 `worker_pid`，要过 TTL 才回收。今天抛不出，但我刻意写了这个防御分支，它自己必须正确。与 AGY-01、GLM-01 同指 | `src/trivium/run-protocol.ts`：删去复查自带的 `try/catch`，把 `warnings = collectWarnings(await checkModelOverrideSource(rc.sides, rc.adapters))` 挪进下方主 `try` 的首句（仍在 `ensureDir` / `writeHandoff` / 派生之前），继承主 `catch` 的 `releaseRunningGate` + `lock.release`；注释写明为何在主 `try` 内。`02-plan-deviations.md` 末节改正「同形」那句。**观测用例不补**：这条路径按构造抛不出，要构造抛错得给桩或生产接口新开一个只为抛错的口子；挪进主 `try` 后它与 `ensureDir` / `writeHandoff` 失败共用同一条回收路径，而那条路径今天同样没有直接用例——一并登记 BACKLOG 残余（「`startRun` 主 `catch` 的闸门回收无直接用例」），不在本题扩面 |
| CODEX-02 | codex | nit | 接受 | 属实（`preflight.ts:273-277`）。`checkCliVersions` 对未入选侧的入口不可用 / 取版本失败 / 版本已变记 `ok: true` 并缀「（本次未选用该侧，仅提示）」，不标 `warn` 是对的——本次不用它，就不是本次的缺口；但口径段只列了三格「不标」，读起来像闭集 | 设计 §8.1「警告这一级」口径段：「不标」清单补一格「未入选侧的可调用 / 版本提示（本次不用它，不是本次的缺口）」，并把整段改成**非闭集**的写法：先给判据（「本次入选侧有一部分没检查到 / 没按请求做到」），再列「标」与「不标」的已知项，末句注明新增只警告项按判据定、由代码置位 |
| CODEX-03 | codex | minor | 接受 | 属实（`probes/zcode.ts:67-68`）。`ZCODE_CLI_CONFIG` 是 doctor 三条模型覆盖臂的副本源缺省值，模块加载时取值；本题只把**适配器侧**三处收成一个出口，「唯一出处」的总括语比实现宽。并入它要动探针模块的常量（它同时服务 log / rollout / models 三格），属于探针侧重构，不在本题扩面 | `src/trivium/adapters/zcode.ts` 的 `zcodeOverrideSourcePath()` docblock 改为「**审查运行（适配器侧）**的唯一出处」，并点明「探针模块的 `ZCODE_CLI_CONFIG` 未并入，且是模块加载时取值——进程内钉 HOME 对它无效」；设计 :252 与变更记录 v1.3.41 同一措辞改窄；BACKLOG 登记残余「探针侧副本源路径并入同一出处、改为调用时求值」 |
| CODEX-04 | codex | minor | 接受 | 属实（`cli.ts:676-684`、`review.ts:393-408`）。同步 `review --stage --json` 一直带 `warnings: string[]`（guard 告警、凭据副本抹除失败、多审退化），与 `--start` 新增的 `{ name, detail }[]` 同键不同形；设计与 PROTOCOL 只写「同步 `review --stage` 不提示」，字面会被读成「同步路径没有这个键」。不改名：skill 已按 `--start` 的 `warnings` 写好转述句，改名要连带四份 skill、契约用例与设计，而冲突只在文档层面 | 设计 §7.5 `--start` 返回段与 §8.1「警告这一级」段、PROTOCOL §九 `review --start` 行：把「同步 `review --stage` 不提示」改写为「同步 `review --stage` 不做副本源复查；它的 `--json` 另有**既有**的 `warnings: string[]`（运行期告警），与 `--start` 的 `warnings` 同键不同形，不要按 `detail` 读它」 |
| AGY-01 | gemini | major | 接受 | 与 CODEX-01 同指。严重度我按「潜伏缺陷」理解（三侧都核实今天抛不出），但修法不因严重度而变：防御分支必须正确，且挪进主 `try` 是最小改动 | 同 CODEX-01 的落点 |
| GLM-01 | glm | minor | 接受 | 与 CODEX-01 同指。glm 另指出的既有同形缺口（`prepareRun` 置闸后 `resetStopBlockCount` 仍可抛，只由 :308-313 的 `catch` 放锁）属实，但不是本题引入的 | 同 CODEX-01 的落点；BACKLOG 残余一并记下 glm 指出的 `prepareRun` 置闸后同形缺口（不在本题修） |
| GLM-02 | glm | nit | 接受 | 属实（`preflight.ts:171-175`）。「探针结论新鲜」的「过期或未探：X（其余在 TTL 内）」是 `ok: true`、无 ⚠️、不标 `warn`；不标的理由成立（过期侧 ②③ 照查；未探的入选侧会在 ④ 只读能力被判不可用，预检整体失败），但口径段没列。与 CODEX-02 同族 | 同 CODEX-02 的落点：「不标」清单补「探针结论新鲜的部分过期 / 未探行（过期侧 ②③ 照查，未探入选侧由 ④ 兜住）」 |

## 2. 焦点外的小改（不对应编号，随本轮一并做）

- `PreflightOptions.adapters` 的注释补全：「只喂给 ④″；④ 只读能力与 ⑧ 探活都不读它，仍按真实适配器走——新用例若忘了 `skipAuthCheck`，⑧ 会真去探活」（codex「认为正确的部分」第 4 条的提醒）。

## 3. 修改后的验证

- `npm run typecheck && npm test` 全绿；`trivium doctor --selftest` 14 / 14。
- 变异：重跑本题规格，P9（`startRun` 不调新检查）的 `find` 随代码挪位更新，12 条仍须全部咬住。
- `npm run install:local` 之后重跑零配额验收 `check.mjs`，E1～E3 仍须通过。
