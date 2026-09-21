---
schema: trivium.disposition.v1
topic: zcode-provider配置注入
stage: code
role: claude
kind: response
run_id: 20260921T091034Z
addresses:
  - 2026-09-21-zcode-provider配置注入-r5-codex.md
  - 2026-09-21-zcode-provider配置注入-r5-gemini.md
---

# 应答与修改方案（第 5 轮）：zcode-provider配置注入

两侧结论：codex `approve-with-nits`（0 blocker / 0 major / 3 minor / 3 nit）、
gemini `approve`（0 findings）。**codex 侧本轮没有降级**——连续两轮 `parse_fallback` 中断，
两侧都产出结构化结论，**共同阻断这一档在本主题首次真正执行**。闸门要求裁决的编号 6 个。
**接受 5，驳回 0，暂缓 1。**

两侧都明确回答了焦点里那句「能不能就此提交」：codex「本收口轮可以提交」，gemini「批准提交」。
6 条意见里没有一条要求在提交前改判据方向，最重的 CODEX-01 是**判据适用范围**问题（纪律 1），
它给出的两支处置里有一支是纯文档 + 登记。

**一条我自己的判断被证伪**：r4 裁决件 §五 判断 3 说「hostPreset 的 note 没写用例，是因为要摆形态
就得改测试进程自身的环境」——CODEX-05 指出同一个文件里的「诱饵变量清除」用例**本来就在**设置
并复位这两个环境变量。理由不成立，用例照补（§2.5）。

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实且指到纪律 1：「内置文件缺失 ⇒ 该侧不可用」这条断言的依据是 0.16.9 的实测（M0 P-28 明写 0.16.5 无此问题，最近一次 glm 成功留痕正是 0.16.5），而代码只读 `builtin_file === null` 一个事实、不看同一个对象里现成的 `version`；注入路径本身是版本中立的。**取意见给的第二支**（文案与设计写明版本前提 + 登记触发条件），不做版本门控——理由见 §2.1：版本比较是新判据、`version` 可能为 null 时的语义要另立，在收口轮引入它等于用一条未经审查的新逻辑去防一个尚未发生的回退场景。 | §2.1、EV-85 |
| CODEX-02 | codex | minor | 接受 | 属实，而且是这轮最实的一条：旗标探针的零配额不变量是「空 HOME + 只给内置 ⇒ 必停在 `Model creation failed` 退 1」（P-30 实测），所以这条路径上出现退 0 的唯一现实解释是**一次完整 headless 运行真的发生了、配额真的烧了**——而新判据把它静默记成接受，note / warnings / 结论文件三处零信号。r3 给「turn 里 3 分钟不退」加了 `killTree`（超时 ⇒ `code` 为 null ⇒ 会被看见），「跑完并成功」这个同族形态反而无人说话。 | §2.2 |
| CODEX-03 | codex | minor | 暂缓 | 意见成立：正向证据列表自述不完备，一旦真实停点文案漂移，`readonly_flags` 从此冻结，而「本轮未判定」只在跑 doctor 的当期可见，此后每次 preflight 与每次审查都静默消费旧结论。但它的修法是**新增一个落盘字段**（`readonly_flags_decided_at`）加一套新鲜度判据（「明显落后」的阈值是新语义），属于新增机制而非修补本轮改动；审查员本人也写了「可随下一次动探针实施，不必卡本轮提交」。**暂缓不是搁置**：登记 EV-86，触发条件写死为「下一次改动 `probeReadonlyFlags` 或 `availability()` 的旗标判据」。 | EV-86（不在本轮实施） |
| CODEX-04 | codex | nit | 接受 | 属实：`probeZcodeEntry` 的 `run` 是全仓唯一没开 `killTree` 的厂商 CLI 拉起（其余五处都开了），而 r3 给旗标探针补这一项时写的注释正是「`exec.ts` 要求拉起厂商 CLI 一律打开」。本轮刚动过这个函数（清两个键），顺手补齐口径的成本是一行。 | §2.3 |
| CODEX-05 | codex | nit | 接受 | 属实，**且它证伪了我 r4 §五 判断 3 给出的理由**：同文件的「诱饵变量清除」用例本来就在设置并复位这两个环境变量，「摆形态要改测试进程环境」不构成不写用例的理由。这条 note 是 RUNBOOK「编排器独占这两个变量」的运行时半边，而我在 r4 接受 CODEX-03 时用的正是「档位定义只靠注释、没有机制钉住」这个理由——同一把尺子要对自己也用。 | §2.4 |
| CODEX-06 | codex | nit | 接受 | 属实且值得按更强的那一支做：`why` 与四处 `stderr.slice()` 把 CLI 原话拼进 note / detail / reason，而这些输出的实际流转方式是**人工抄进 git 里的 evidence 目录**——那里没有 secrets 闸门，防线只剩手抄纪律（同一句「未打印任何配置文件内容」我在三份留痕里各写了一遍，本身就说明它靠的是记性）。`secrets.ts` 为 ZCode 凭据形态专设过扫描规则，说明「CLI 错误文本回显凭据」是被当过真的风险。仓里已有 `redactSecrets()`，接上它比在 RUNBOOK 写一句提醒强。 | §2.5 |

**统计**：接受 5 ｜ 驳回 0 ｜ 暂缓 1。**gemini 侧 0 findings**，无可裁决项。

---

## 二、修改方案

### 2.1 把版本前提写出来，不做版本门控（CODEX-01）

落点三处：
① `ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT` 的常量注释写明「该判据以 **0.16.9** 实测为据；
0.16.5 无此问题（M0 P-28），旧版或未来改布局的版本上它可能误拦」；
② 设计 §3.5 的 `zcode.provider_config` 行把「内置缺失则独立拉起必失败」限定到 0.16.9；
③ BACKLOG 登记 **EV-85**，触发条件「下一次改动 `availability()` 的布局支，或 ZCode 跨版本升级」。

**为什么不直接加版本门控**：`probe.version` 可能为 null（version 探针失败），此时该门控要选
「按有问题处理」还是「放行」——这是一条新语义，且版本比较本身要引入 semver 比较逻辑。
在一个已被两侧判为可提交的收口轮里，用一条**未经审查的新判断**去防一个尚未发生的回退场景，
风险方向反了。审查员给的两支里这一支是它自己列的备选，不是我在躲。

### 2.2 旗标探针退 0 要出声（CODEX-02）

`probeReadonlyFlags` 返回值增 `zeroExit: string[]`（记哪些候选是靠退 0 判的接受）；
`probeZcode` 在其非空时 push 一条 ⚠️ note，并经新增返回项 `flagsZeroExit` 交给 `doctor`
出一条 `warnings`：「旗标探针出现 N 次退 0——空 HOME 停在模型层的假设（P-30）已被打破，
本轮疑似发生 N 次真实模型调用，请核对停点形态」。
**结论不变**（退 0 仍记接受，逻辑上它确实证明 argv 吃完了），变的只是「它不再是静默的」。
用例：假入口在给定环境变量时退 0 并产出 envelope，断言 `accepted` 含该候选且 `zeroExit` 同时记到它。

### 2.3 version 探针补 `killTree`（CODEX-04）

`probeZcodeEntry` 的 `run` 加 `killTree: true`，与其余五处拉起口径一致。

### 2.4 补 hostPreset note 的用例（CODEX-05）

复用 `layout()` 与 `doctorOnZcode()`：预置两个环境变量跑一次 `runDoctor`，断言 notes 里出现
含「独占」字样的那条，`finally` 复位。同时把 r4 裁决件 §五 判断 3 的理由标注为**已被证伪**
（不改历史结论，加一行更正）。

### 2.5 CLI 原文拼入前过脱敏（CODEX-06）

`redactSecrets()` 接到**五处** CLI stderr 外泄点：
`probes/zcode.ts` 的 `why`（stderr 首行）与 headless 失败 note；
`adapters/zcode.ts` 的 `authProbe` 详情两处、`critic.run()` 的 hint 两处。
只改拼入前的那一步，不动 `ZcodeInvokeOutcome.stderr` 本身（它是给轨迹与调试用的原始值，
落盘面另有闸门）。RUNBOOK 抄录留痕那一节补一句「doctor note 含 CLI 原文，粘贴前过一遍脱敏」
作为第二道（机制在先，纪律在后）。

---

## 三、本轮的两条新登记

- **EV-85**：布局判据未按 CLI 版本门控（CODEX-01 的未尽部分）。触发条件：下一次改动
  `availability()` 的布局支，或 ZCode 跨版本升级。
- **EV-86**：旗标结论冻结不可见（CODEX-03，本轮暂缓）。修法方向为落 `readonly_flags_decided_at`
  这一**持久事实**（判定发生过的时刻，不是当轮状态，故不与 r3「过程状态不落盘」的裁决冲突），
  并在它明显落后 `probed_at` 时由 `availability()` / `preflight` 出降级提示。
  触发条件：下一次改动 `probeReadonlyFlags` 或 `availability()` 的旗标判据。

## 四、执行顺序

用户 `/dual-approve` 之后：按 §2.1～§2.5 修 → 全量校验 → 刷新全局副本 → **提交**。

**本轮不再开第 6 轮**，理由写在这里备查：两侧都给了可提交结论；本轮接受的 5 条里，
§2.1 / §2.4 是文档与用例，§2.3 是一行口径对齐，§2.2 与 §2.5 是**只增信号、不改判定结果**
的改动（退 0 仍记接受，脱敏只改拼入前的文本）——没有一条改变 r5 送审时被两侧核过的判据行为。
若实施过程中发现任一条实际动到了判定结果，按纪律停下来再审一轮，不自行放行。

**共同阻断档位本轮已执行**（两侧均结构化，有效侧 2 家）——这是本主题五轮里第一次。
r3 / r4 缺席的那两轮，其结论仍应按单侧看待；已登记的 EV-84 是让它不再随机缺席的那条。

---

## 五、实施记录（2026-09-21，用户审批通过、附言「修改后提交」）

§2.1～§2.5 **已全部实施**，EV-85 / EV-86 已登记。全量校验 1517 tests / 1515 pass / 2 skipped / 0 fail
（较送审时 +2）；全局副本已刷新；`doctor --only zcode --no-model-calls` 零配额复验退 0、**无告警**。
留痕见 `doc/05_testing/evidence/zcode-provider-config-20260920/r5-implementation-doctor-20260921.md`。

**「无告警」是本轮该看的那个结果**：退 0 告警与宿主预置告警都是**异常信号**，本机两者都不该出现——
真实 CLI 仍停在模型层（零配额前提成立），shell 里也没预置那两个变量。两条的正例都由用例覆盖。

**§四 立的那条自律在实施中成立**：五条落地没有一条改变判定结果——
§2.2 退 0 仍记接受（只多了 note 与 warning）、§2.5 只改拼入前的文本（`ZcodeInvokeOutcome.stderr`
原值不动）、§2.3 是一行口径对齐、§2.1 / §2.4 是文档与用例。故按 §四 不再开第 6 轮。

**一处实施时的判断**：§2.5 原计划「五处」，实施时确认 `probes/zcode.ts` 的 headless 失败 note
也是同一形态，一并接上——最终是 `probes/zcode.ts` 两处（未判定成因、headless 失败 note）
与 `adapters/zcode.ts` 三处（探活详情两支、`critic.run()` 的 hint）。数字与裁决表一致，落点更明确。
