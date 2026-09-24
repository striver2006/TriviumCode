# EV-111：构建标识在纯文档提交后误报「与仓库 HEAD 不同版」实施计划（r2 · 定稿）

> **性质**：独立小主题，**不属 M10b 范围**（M10b r7 §4：EV-111 / EV-112 另计，轮次不进 M10b 阈值）。
> 改动面只有构建标识的比对规则（纯函数）与 doctor 的一行描述，不碰构建脚本、安装器、run.json 字段。
> 走计划双审 → 实施 → 代码双审；验收零配额。
>
> **r2 的来历**：r1 经第 1 轮计划双审（run `20260924T134342Z`，11 条全接受，裁决件 `…-revised-claude.md`），
> 用户审批「开始实现」。本稿为完整稿、作定稿；与 r1 的偏差见 §11。

- **日期**：2026-09-24
- **主题**：`EV-111-构建标识HEAD误报`
- **起点**：`46071a2`（`main`）
- **上位**：BACKLOG EV-111（EV-82 第二段计划 r2 §9 登记）；构建标识的设计来源是 EV-82 第一段计划 r2 §2
  （`.reviews/EV-82-同形第二臂与构建标识/plan/` r2 稿）；M10b r7 §3.4（T2 第 6a / 6b 条）、§3.7、§6 第 2 条

---

## 1. 现状核实

### 1.1 实遇（五次，读数已逐条核过）

读的是各次运行的 run.json：`snapshot.git_head`、`snapshot.build`、`gate.warnings`，
再用 `git log` / `git diff --name-only <构建提交> <快照 HEAD> -- <作用面>` 看两者之间改了什么。

| 台账行 | run | 构建于 | 快照 HEAD | 两者之间的提交 | 作用面改动 | 构建标识告警 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 第 8 行 | `20260924T065129Z` | `7212255` | `9339ac1` | 1 次 `docs(testing)` | 无 | 只有「与仓库 HEAD 不同版」 |
| 第 10 行 | `20260924T084103Z` | `c673ba3` | `1a76c05` | 1 次 `docs(testing)` | 无 | 同上 |
| 第 11 行 | `20260924T090216Z` | `c673ba3` | `1a76c05` | 同上 | 无 | 同上 |
| 第 14 行 | `20260924T113039Z` | `c872b00` | `47d68cc` | 1 次 `docs(testing,review,project,deploy)` | 无 | 同上 |
| —（**r2 补**，本主题计划双审第 1 轮） | `20260924T134342Z` | `c872b00` | `46071a2` | `47d68cc`、`46071a2` 两次纯文档提交 | 无 | 同上 |

对照：验收运行 `20260924T104357Z`（构建于 `c872b00`、快照 HEAD `c872b00`）零告警。

五次都是：构建时 `dirty: false`，**没有**出「安装副本不是当前工作树构建的」（即收尾重算的作用面指纹与构建时一致），
只因 HEAD 前进了纯文档提交而告警。各次运行的 `snapshot.dirty` 都是 `true`，脏的是作用面外的计划稿，与本条无关。

### 1.2 代码落点

| # | 事实 | 出处 |
| :-- | :--- | :--- |
| C1 | 比对是纯函数 `buildStampWarnings`：非本仓模式恒空；本仓模式下依次判缺失 → dirty → 作用面指纹 → HEAD，**HEAD 比对不看作用面指纹的结论** | `src/trivium/build-stamp.ts` `buildStampWarnings` |
| C2 | 作用面指纹 `inputs_sha256`：对工作树（含未跟踪、不含被忽略文件）的 tree，取 `INSTALL_INPUT_PATHS` 六项的对象 id 拼接后取 sha256。构建时算一次写进标识，收尾在本仓模式下用同一函数重算。`BuildStamp.inputs_sha256` 类型为非空 string，指纹取不到时 `computeBuildStamp` 整份返回 null | `computeInputsSha256`、`computeBuildStamp`、`checkBuildStamp` |
| C3 | 消费方两处：收尾 `collectBuildStampNotices` → `meta.gate.warnings`（再经 `gate --check` 转述为 `run_warning`）；doctor `describeBuildStamp` 拼一行 note（环境段，不受 `--no-model-calls` 影响） | `review.ts` 收尾段、`doctor.ts` |
| C4 | **两处**现有单测把旧行为锁成了预期（**r2 修正**，CODEX-01 ≡ AGY-01 ≡ GLM-02）：<br>①「四条告警各自独立」用例：指纹一致、只改 `projectHead` ⇒ 断言一条 `BUILD_WARN_HEAD`（EV-111 本体）；<br>②「判据输入取不到 ⇒ 比对未能完成（r2 CODEX-05）」用例的 `noHead`：指纹一致、`projectHead: null` ⇒ 断言一条「比对未能完成」（D2 要翻的那格） | `test/unit/build-stamp.test.ts` |
| C5 | 集成用例「构建标识告警经收尾接线落进 run.json」的注释写「此后构建标识与夹具 HEAD 必然不同，收尾至少出一条告警」。断言只要求「至少一条构建标识类告警」，不点名 HEAD 那条 | `test/integration/fault-injection.test.ts` |
| C6 | 设计文档 `snapshot.build` 行列了四条告警，没写 HEAD 比对的触发条件，并写「判据输入（作用面指纹重算、仓库 HEAD）取不到时各记一条」；`run.v2.json` 的字段描述不提告警。设计文档版本 v1.3.37 出现在抬头、§21、`doc/02_design/README.md` 三处 | 设计 v1.3.37 §6.7.1 表；`skills/dual-critic/schema/run.v2.json`；`doc/02_design/README.md` |
| C7 | `describeBuildStamp` 在 `test/` 下零用例 | 全仓 grep |

---

## 2. 「作用面一致而 HEAD 不同」还有没有别的含义

本仓模式、标识非空、收尾重算的指纹 = 构建时指纹，而 HEAD 不同，能走到这一格的情形：

| # | 情形 | 别的告警 | 安装副本与当前工作树的作用面 |
| :-- | :--- | :--- | :--- |
| S1 | 构建后只有作用面外的提交（doc、test、`.reviews`）——**EV-111 本体** | 无 | 一致 |
| S2 | 构建时作用面脏，之后把这些改动提交了 | 「构建时工作树有未提交改动」已报 | 一致 |
| S3 | HEAD 挪到作用面相同的另一个提交（checkout、reset、rebase、amend） | 无 | 一致 |
| S4 | HEAD 前进且改了作用面，但工作树里又把作用面改回构建时的内容（未提交） | 无（`snapshot.dirty` 如实为 true） | 一致 |
| S5 | 被审项目是同一仓库的另一个克隆或 `git worktree`（根提交相同） | 无 | 一致（比的是内容，不是路径） |

五种情形里，「构建输入与当前工作树一致」都已由指纹判定成立。HEAD 不同只剩**出处**这一层信息：
「构建于哪个提交」。这层信息 run.json 本来就有：`snapshot.build.git_head` 与 `snapshot.git_head` 两个字段都照记，
M10b r7 §3.4 T2 第 6a 条正是直接读这两个字段判「收口提交或其后代」，不读告警。

### 2.1 指纹的覆盖边界（**r2 重写**，CODEX-05、AGY-02、GLM-03）

指纹管的是「构建时的作用面 = 收尾时的作用面」，**不管安装副本本身的字节**。
第一段 r2 §2 已把「不校验安装副本内容」写成明确的「不做」（M10b r5 §6.2 的内容层边界）。下面几项都在这条边界及其延伸内：

| 项 | 情形 | 指纹 | HEAD 比对 | 处置 |
| :-- | :--- | :--- | :--- | :--- |
| B1 | 作用面内被 `.gitignore` 忽略的文件：安装器整树拷贝 `skills/`，指纹不收。现只命中构建产物 `skills/dual-critic/scripts/trivium.cjs` 本身 | 看不见 | 看不见（从不进提交） | 登记 EV-114，不修 |
| B2 | `package-lock.json` 不变时的 `node_modules` 漂移（构建不确定） | 看不见 | 看不见 | 登记 EV-114，不修 |
| B3 | **「改完装上再改回」**：构建（指纹 F1）→ 改 `skills/` → 安装（改过的资产进了安装副本）→ 把 `skills/` 改回 F1 ⇒ 收尾重算 = F1，零告警 | 看不见 | 中间没有提交时看不见；中间恰有提交时，改前会**碰巧**报出「不同版」，改后不再报 | 登记 EV-114，不修。(a) 拿掉的这条偶然信号本来就不针对这种形态（它同样会在 S1 上响），本题接受这个代价 |
| — | 构建之后、安装之前改 `skills/`，**改动留到收尾** | 重算不等，已报「不是当前工作树构建的」 | — | 已覆盖，**不是缺口**，不登记 |

**结论**：除 B3 这一种已归入边界的形态外，作用面指纹已判定一致时，HEAD 比对不提供额外的「副本是否过期」信号，告警纯属误报。

---

## 3. 范围

**做**：
1. 改 `buildStampWarnings`：作用面指纹**已知一致**时不比 HEAD（§4.1）；
2. doctor 描述在这一格补一句出处提示（§4.2）；
3. 用例、变异、设计文档、BACKLOG 同步（§5、§6）。

**不做**：
- 不改构建标识字段、构建脚本、安装器、`INSTALL_INPUT_PATHS`；
- 不修 §2.1 的 B1～B3：新立 **EV-114**「构建标识指纹的覆盖边界」登记，无实遇、无触发不动（**r2 补**，GLM-03）；
- 不改 M10b 的判据文本（影响见 §7，由用户定是否另起修订）；
- EV-112 另行。

---

## 4. 改动

### 4.1 比对规则（D1 = (a)，双审一致认可）

候选与取舍（r1 原文，未改）：
- **(a) 指纹已知一致 ⇒ 不比 HEAD（采用）**。指纹不一致或取不到时，HEAD 比对照旧；
- (b) 保留 HEAD 比对，改成另一个前缀的「提示」照样写进 `gate.warnings`。**不取**：`gate.warnings` 是唯一通道，
  `gate --check` 会原样转述成 `run_warning`，换前缀仍是每轮一条噪声；M10b r7 第 6b 条的前缀清单还要跟着改；
- (c) 整条删掉 HEAD 比对。**不取**：指纹重算取不到时（包括包名兜底进入本仓模式、而指纹重算失败的路径），HEAD 是唯一剩下的版本信号；
  指纹不等时，HEAD 那条的「构建于 X，仓库 HEAD Y」也是排查线索。

规则按指纹三态写全：

| 收尾重算的指纹 | 指纹那条 | HEAD 那条 |
| :--- | :--- | :--- |
| = 构建时 | 不报 | **不比、不报**（新） |
| ≠ 构建时 | 「不是当前工作树构建的」 | 照旧：不同则报「不同版」，取不到则报「比对未能完成」 |
| 取不到 | 「比对未能完成：作用面指纹…」 | 照旧（此时 HEAD 是唯一的版本信号） |

`build === null`（缺失）与 `build.dirty`（dirty）两条不变；非本仓模式不变。示意：

```ts
const inputsMatch = i.currentInputsSha256 !== null && i.currentInputsSha256 === i.build.inputs_sha256;
if (i.currentInputsSha256 === null) out.push(`${BUILD_WARN_INCOMPLETE}：作用面指纹…`);
else if (!inputsMatch) out.push(BUILD_WARN_STALE_INPUTS);
if (!inputsMatch) {
  if (i.projectHead === null) out.push(`${BUILD_WARN_INCOMPLETE}：仓库 HEAD 取不到…`);
  else if (i.projectHead !== i.build.git_head) out.push(`${BUILD_WARN_HEAD}（构建于 …，仓库 HEAD …）`);
}
```

输出顺序与现在相同，文案常量一个不改。

**D2：指纹一致而 HEAD 取不到，不再报「比对未能完成」**（双审一致认可与 CODEX-05 不冲突）。
这一格的结论已经由指纹给全，HEAD 在规则里不参与判定，谈不上「查不出」；指纹未判定一致时，CODEX-05 照旧成立。

### 4.2 doctor 描述

`describeBuildStamp` 在零告警时现写「安装副本与当前工作树一致」。指纹一致而 HEAD 不同时补一句出处：
「（构建于 `<7 位>`，仓库 HEAD 已到 `<7 位>`，作用面与构建时一致）」；HEAD 相同时不补。
措辞不写「其间未改作用面」：S4（改了又改回）下那句不成立，指纹能担保的只是「一致」。
HEAD 由 `describeBuildStamp` 自己再取一次（只读）；`checkBuildStamp` 的签名与返回值不变，收尾路径不受影响。

### 4.3 注释

- `build-stamp.ts` 顶部「比对」一条与 `buildStampWarnings` 文档块写明 HEAD 比对只在指纹未判定一致时做，并引 EV-111；
- 集成用例 C5 的注释改成实际触发的那条：夹具的作用面与本仓构建时不同，指纹必然不等；实施时跑一次看实际落了哪几条，
  按读数写，不按推想写。断言不放宽。

---

## 5. 验证

### 5.1 用例

纯函数（`buildStampWarnings`）：
- **EV-111 本体**：指纹一致、HEAD 不同 ⇒ `[]`。由 C4 ① 改写而来，用例名注明「EV-111：原断言把误报锁成了预期」；
- 指纹不等、HEAD 不同 ⇒ `[STALE_INPUTS, HEAD…]`，顺序锁住；
- 指纹取不到、HEAD 不同 ⇒ `[INCOMPLETE（指纹）, HEAD…]`；
- dirty、指纹一致、HEAD 不同 ⇒ `[DIRTY]`（S2）；
- **D2**：指纹一致、HEAD 取不到 ⇒ `[]`。由 C4 ② 改写而来，注释写明「EV-111：指纹已判定一致时 HEAD 不参与判定，此格不再是 CODEX-05 的『查不出』；
  指纹未判定一致时 CODEX-05 照旧成立，见下一条断言」（**r2 补**，GLM-02）；
- 同一用例补：指纹不等、HEAD 取不到 ⇒ `[STALE_INPUTS, INCOMPLETE（HEAD）]`（**r2 补**，AGY-01）；两项都取不到 ⇒ 两条「未能完成」；
- 非本仓模式四种组合仍为 `[]`（现有用例保留）。

真实 git（`checkBuildStamp`，扩展现有临时仓用例）：
- 算标识后只提交 `doc/` 下一个文件 ⇒ `[]`；
- 再提交 `src/` 下一个文件 ⇒ `[STALE_INPUTS, HEAD…]`。

doctor（**r2 补落点**，CODEX-06；**补反向格**，GLM-01）：并进 `test/unit/build-stamp.test.ts` 的真实 git 段，直接调 `describeBuildStamp(dir, stamp)`：
- 构建后无提交（HEAD 相同）⇒ 含「一致」，**不含**出处句；
- 只提交 `doc/` ⇒ 含「一致」与出处句，不含「不同版」。

集成：C5 用例照跑，断言不改。

### 5.2 变异

沿用 `scripts/mutation-check.mjs`（先 `node scripts/build.mjs --tests-only` 确认被测产物重编），规格与输出进
`doc/05_testing/evidence/ev111-mutation-<日期>/`：
1. 去掉 `!inputsMatch` 守卫（回到原行为）⇒ EV-111 本体用例红；
2. 守卫取反 ⇒ 指纹不等那条红；
3. **把 null 当一致**：判据改成 `currentInputsSha256 === null || currentInputsSha256 === build.inputs_sha256` ⇒ 取不到那条红。
   规格 desc 注明：删掉 `currentInputsSha256 !== null &&` 是**等效变异**（`inputs_sha256` 非空，`null === <string>` 恒假），不要用它（**r2 修正**，CODEX-04）；
4. 指纹一致时仍报 HEAD「未能完成」⇒ D2 用例红；
5. doctor 出处句条件**取反** ⇒「只提交 doc」那格红；条件**恒真** ⇒「HEAD 相同」那格红（**r2 拆为两个**，GLM-01）。

### 5.3 验收（零配额）

代码提交后，干净工作树 `npm run build`、`npm run install:local` 各一条；做一次纯文档提交（本主题的收口文档即可）；
跑 `trivium doctor --only env --no-model-calls`（**r2 修正**，CODEX-02：不带 `--no-model-calls` 会对四家发真实模型调用并回写探针结论；
构建标识那行在环境段，`env` 档就能读到），note 里该行应为「本仓模式…安装副本与当前工作树一致（构建于 X，仓库 HEAD 已到 Y，作用面与构建时一致）」。
输出留进 `doc/05_testing/evidence/ev111-acceptance-<日期>/`。下一次真实双审的 run.json 不再出「不同版」，作为附带观察记录，不专门花配额。

`npm run typecheck && npm run build && npm test` 全绿；`trivium doctor --selftest` 全绿。

---

## 6. 文档同步

- 设计文档（**r2 拆为四项**，CODEX-03）：
  ①§6.7.1 `snapshot.build` 行：写明 HEAD 比对只在作用面指纹未判定一致时做（EV-111），并把「判据输入…取不到时各记一条」限定为「HEAD 那条只在指纹未判定一致时才记」；
  ②抬头「当前版本」升到 v1.3.38；③§21 追加 v1.3.38 一行；④`doc/02_design/README.md` 跟版；
- BACKLOG：EV-111 关闭，追加实施提交与验收证据路径；新立 **EV-114**（§2.1 B1～B3）；
- M10b 轮次台账：按 r7 §4，EV-111 的轮次不进累计与阈值；墙钟照实计。台账是否另起一段记录由用户定。

---

## 7. 对 M10b 的影响（只登记，不改 M10b 文本）

1. **T2 第 6b 条仍然成立**。6b 禁止五类构建标识告警、容忍 `BUILD_WARN_HEAD`。改后 `BUILD_WARN_HEAD` 只会与
   「不是当前工作树构建的」或「比对未能完成」同时出现，而这两类都在 6b 的禁止清单里——容忍项变成空转，判据本身不用改。
   **连带（r2 补，codex 核出）**：新规则下「零构建标识告警」仍严格等价于「标识非空 + 构建时干净 + 指纹取得到且一致」，
   r7 §3.4 用「`gate` 段无 `warnings` 键」反推「收尾时安装作用面内没有未提交改动」的那条证据链不被削弱。
2. **r7 §3.7 的规避不会因本题解除**（双审一致确认）。r5 §7.3 白名单构建标识行写「claude 轮与 `snapshot.git_head` 一致」，
   比的是**字段**（`snapshot.build.git_head` 对 `snapshot.git_head`），不是告警。本题只改告警、不改字段，纯文档提交之后两个字段照样不等。
   **因此 r7 §6 第 2 条「建议在第 4 步之前做，可以省掉 §3.7 的规避」不成立**：本题落地后，
   第 4 步兼容轮仍要「构建之后不提交，提交了就重新 build + install」，除非 M10b 把白名单那一行改成与 6a / 6b 同口径
   （例如「`snapshot.build.git_head` 是 `snapshot.git_head` 或其祖先，且 `gate.warnings` 无构建标识告警」）。
   那是 M10b 的判据修订，要不要做、放进哪一稿，由用户定。r7 是已审批件，更正在 M10b 下一份文件里留痕，不回改 r7。

---

## 8. Bash 依赖

build 与 install 各单独一条；会话里命令不带重定向；验收与读数核对走 evidence 目录或 scratchpad 里的只读脚本，
脚本自己写输出（§1.1 的读数就是这么取的）。

## 9. 量级

plan 1 轮（已完成，r2 作定稿）；code 1 轮（改动约 20 行实现 + 用例）；验收零配额。不进 M10b 轮次阈值。

## 10. 实施顺序

1. `build-stamp.ts`：比对规则、`describeBuildStamp` 出处句、注释；
2. `build-stamp.test.ts`：改写两处、补用例；`fault-injection.test.ts` 注释按实跑读数改；
3. `npm run typecheck && npm run build && npm test`；变异（§5.2）；
4. 文档同步（§6）；
5. 代码双审（用户发起）→ 裁决 → 审批 → 提交 → 验收（§5.3）。

## 11. 与 r1 的偏差

| # | r1 | r2 | 来源 |
| :-- | :--- | :--- | :--- |
| 1 | §1.1 四次实遇 | 五次，补本主题计划双审第 1 轮 | 附带观测 |
| 2 | §1.2 C4 一处现有断言 | 两处；新增 C7（`describeBuildStamp` 零用例） | CODEX-01、AGY-01、GLM-02、CODEX-06 |
| 3 | §2 末三格并列为「缺口」，登记与否交审查员 | §2.1 按边界重写：B1～B3 登记 EV-114；「改动留到收尾」那格已覆盖、不登记；B3 写明 (a) 的代价 | CODEX-05、AGY-02、GLM-03 |
| 4 | §5.1 doctor 用例无落点、只有正向格 | 落 `build-stamp.test.ts` 真实 git 段；补 HEAD 相同的反向格 | CODEX-06、GLM-01 |
| 5 | §5.2 第 3 条「把 null 当一致」写法未定，最自然写法是等效变异 | 改为非等效替换，注明等效写法；第 5 条拆成取反、恒真两个 | CODEX-04、GLM-01 |
| 6 | §5.3 `trivium doctor` | `trivium doctor --only env --no-model-calls` | CODEX-02 |
| 7 | §6 设计文档一项 | 四项（行文、抬头、§21、README 跟版）；BACKLOG 新立 EV-114 | CODEX-03、GLM-03 |
| 8 | §7 第 1 条 | 补「零告警」等价性连带 | codex 认为正确的部分 ③ |
