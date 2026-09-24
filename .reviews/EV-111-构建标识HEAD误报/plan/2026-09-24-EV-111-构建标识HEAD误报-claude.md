# EV-111：构建标识在纯文档提交后误报「与仓库 HEAD 不同版」实施计划（r1）

> **性质**：独立小主题，**不属 M10b 范围**（M10b r7 §4：EV-111 / EV-112 另计，轮次不进 M10b 阈值）。
> 改动面只有构建标识的比对规则（纯函数）与 doctor 的一行描述，不碰构建脚本、安装器、run.json 字段。
> 走计划双审 → 实施 → 代码双审；验收零配额。

- **日期**：2026-09-24
- **主题**：`EV-111-构建标识HEAD误报`
- **起点**：`46071a2`（`main`）
- **上位**：BACKLOG EV-111（EV-82 第二段计划 r2 §9 登记）；构建标识的设计来源是 EV-82 第一段计划 r2 §2
  （`.reviews/EV-82-同形第二臂与构建标识/plan/` r2 稿）；M10b r7 §3.4（T2 第 6a / 6b 条）、§3.7、§6 第 2 条

---

## 1. 现状核实

### 1.1 实遇（四次，读数已逐条核过）

读的是各次运行的 run.json：`snapshot.git_head`、`snapshot.build`、`gate.warnings`，
再用 `git log` / `git diff --name-only <构建提交> <快照 HEAD> -- <作用面>` 看两者之间改了什么。

| 台账行 | run | 构建于 | 快照 HEAD | 两者之间的提交 | 作用面改动 | 构建标识告警 |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 第 8 行 | `20260924T065129Z` | `7212255` | `9339ac1` | 1 次 `docs(testing)` | 无 | 只有「与仓库 HEAD 不同版」 |
| 第 10 行 | `20260924T084103Z` | `c673ba3` | `1a76c05` | 1 次 `docs(testing)` | 无 | 同上 |
| 第 11 行 | `20260924T090216Z` | `c673ba3` | `1a76c05` | 同上 | 无 | 同上 |
| 第 14 行 | `20260924T113039Z` | `c872b00` | `47d68cc` | 1 次 `docs(testing,review,project,deploy)` | 无 | 同上 |

对照：验收运行 `20260924T104357Z`（构建于 `c872b00`、快照 HEAD `c872b00`）零告警。

四次都是：构建时 `dirty: false`，**没有**出「安装副本不是当前工作树构建的」（即收尾重算的作用面指纹与构建时一致），
只因 HEAD 前进了一次纯文档提交而告警。四次运行的 `snapshot.dirty` 都是 `true`，脏的是作用面外的计划稿，与本条无关。

### 1.2 代码落点

| # | 事实 | 出处 |
| :-- | :--- | :--- |
| C1 | 比对是纯函数 `buildStampWarnings`：非本仓模式恒空；本仓模式下依次判缺失 → dirty → 作用面指纹 → HEAD，**HEAD 比对不看作用面指纹的结论** | `src/trivium/build-stamp.ts` `buildStampWarnings` |
| C2 | 作用面指纹 `inputs_sha256`：对工作树（含未跟踪、不含被忽略文件）的 tree，取 `INSTALL_INPUT_PATHS` 六项的对象 id 拼接后取 sha256。构建时算一次写进标识，收尾在本仓模式下用同一函数重算 | `computeInputsSha256`、`checkBuildStamp` |
| C3 | 消费方两处：收尾 `collectBuildStampNotices` → `meta.gate.warnings`（再经 `gate --check` 转述为 `run_warning`）；doctor `describeBuildStamp` 拼一行 note | `review.ts` 收尾段、`doctor.ts` |
| C4 | 现有单测把误报形态**锁成了预期**：「四条告警各自独立」用例里，`currentInputsSha256` 与标识一致、只改 `projectHead`，断言出一条 `BUILD_WARN_HEAD` | `test/unit/build-stamp.test.ts` |
| C5 | 集成用例「构建标识告警经收尾接线落进 run.json」的注释写「此后构建标识与夹具 HEAD 必然不同，收尾至少出一条告警」。断言只要求「至少一条构建标识类告警」，不点名 HEAD 那条 | `test/integration/fault-injection.test.ts` |
| C6 | 设计文档 `snapshot.build` 行列了四条告警，没写 HEAD 比对的触发条件；`run.v2.json` 的字段描述不提告警 | 设计 v1.3.37 §6.7.1 表；`skills/dual-critic/schema/run.v2.json` |

---

## 2. 「作用面一致而 HEAD 不同」还有没有别的含义

BACKLOG 要求先核这一条。本仓模式、标识非空、收尾重算的指纹 = 构建时指纹，而 HEAD 不同，能走到这一格的情形：

| # | 情形 | 别的告警 | 安装副本与当前工作树的作用面 |
| :-- | :--- | :--- | :--- |
| S1 | 构建后只有作用面外的提交（doc、test、`.reviews`）——**EV-111 本体** | 无 | 一致 |
| S2 | 构建时作用面脏，之后把这些改动提交了 | 「构建时工作树有未提交改动」已报 | 一致 |
| S3 | HEAD 挪到作用面相同的另一个提交（checkout、reset、rebase、amend） | 无 | 一致 |
| S4 | HEAD 前进且改了作用面，但工作树里又把作用面改回构建时的内容（未提交） | 无（`snapshot.dirty` 如实为 true） | 一致 |
| S5 | 被审项目是同一仓库的另一个克隆或 `git worktree`（根提交相同） | 无 | 一致（比的是内容，不是路径） |

五种情形里，「安装副本是不是当前工作树构建的」都已由指纹判定成立。HEAD 不同只剩**出处**这一层信息：
「构建于哪个提交」。这层信息 run.json 本来就有——`snapshot.build.git_head` 与 `snapshot.git_head` 两个字段都照记，
M10b r7 §3.4 T2 第 6a 条正是直接读这两个字段判「收口提交或其后代」，不读告警。

**HEAD 比对也管不到的缺口**（与本题正交，列出来是为了说明拿掉它不损失覆盖）：
- 作用面内被 `.gitignore` 忽略的文件：安装器 `syncDir` 会把 `skills/` 下的文件整树拷走，指纹不收被忽略文件。
  目前作用面内被忽略的只有构建产物 `skills/dual-critic/scripts/trivium.cjs`，没有实际命中；
- `node_modules` 在 `package-lock.json` 不变时的漂移；
- 构建之后、安装之前改了 `skills/`（安装的 SKILL.md 比 bundle 新）：这一格重算指纹不等，已落「不是当前工作树构建的」。

被忽略文件与 `node_modules` 从不进提交，HEAD 比对同样看不见。本题不处理这三格；是否登记 BACKLOG 请审查员一并判断（§8 第 3 条）。

**结论**：作用面指纹已判定一致时，HEAD 比对不提供额外的「副本是否过期」信号，告警纯属误报。

---

## 3. 范围

**做**：
1. 改 `buildStampWarnings`：作用面指纹**已知一致**时不比 HEAD（§4.1）；
2. doctor 描述在这一格补一句出处提示（§4.2）；
3. 用例、变异、设计文档、BACKLOG 同步（§5、§6）。

**不做**：
- 不改构建标识字段、构建脚本、安装器、`INSTALL_INPUT_PATHS`；
- 不处理 §2 末列出的三格正交缺口；
- 不改 M10b 的判据文本（影响见 §7，由用户定是否另起修订）；
- EV-112 另行。

---

## 4. 改动

### 4.1 比对规则（决策 D1，本稿推荐 (a)）

候选：
- **(a) 指纹已知一致 ⇒ 不比 HEAD（推荐）**。指纹不一致或取不到时，HEAD 比对照旧；
- (b) 保留 HEAD 比对，改成另一个前缀的「提示」照样写进 `gate.warnings`。**不取**：`gate.warnings` 是唯一通道，
  `gate --check` 会原样转述成 `run_warning`，换前缀仍是每轮一条噪声；M10b r7 第 6b 条的前缀清单还要跟着改；
- (c) 整条删掉 HEAD 比对。**不取**：指纹重算取不到时，HEAD 是唯一剩下的版本信号；指纹不等时，
  HEAD 那条的「构建于 X，仓库 HEAD Y」也是排查线索（区分「构建后提交过」与「构建后只在工作树里改」）。

(a) 的规则按指纹三态写全：

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

**决策 D2：指纹一致而 HEAD 取不到，不再报「比对未能完成」**（本稿推荐）。
第一段代码双审 r2 CODEX-05 定的原则是「查不出」不得与「查过、没问题」同形。这一格的结论已经由指纹给全，
HEAD 在规则里根本不参与判定，谈不上「查不出」。若审查员认为这一格仍该留痕，退路是保留这条「未能完成」，
代价是它在实践中几乎不出现（本仓模式下根提交取得到而 HEAD 取不到，只剩 git 调用失败），不影响 EV-111 本体。

### 4.2 doctor 描述

`describeBuildStamp` 在零告警时现写「安装副本与当前工作树一致」。指纹一致而 HEAD 不同时补一句出处：
「（构建于 `<7 位>`，仓库 HEAD 已到 `<7 位>`，其间未改作用面）」。HEAD 由 `describeBuildStamp` 自己再取一次（只读）；
`checkBuildStamp` 的签名与返回值不变，收尾路径不受影响。

### 4.3 注释

- `build-stamp.ts` 顶部「比对」一条与 `buildStampWarnings` 文档块写明 HEAD 比对只在指纹未判定一致时做，并引 EV-111；
- 集成用例 C5 的注释改成实际触发的那条：夹具的作用面与本仓构建时不同，指纹必然不等；实施时跑一次看实际落了哪几条，
  按读数写，不按推想写。断言不放宽。

---

## 5. 验证

### 5.1 用例

纯函数（`buildStampWarnings`）：
- **EV-111 本体**：指纹一致、HEAD 不同 ⇒ `[]`；
- 指纹不等、HEAD 不同 ⇒ `[STALE_INPUTS, HEAD…]`，顺序锁住；
- 指纹取不到、HEAD 不同 ⇒ `[INCOMPLETE（指纹）, HEAD…]`；
- dirty、指纹一致、HEAD 不同 ⇒ `[DIRTY]`（S2）；
- 指纹一致、HEAD 取不到 ⇒ `[]`（D2）；指纹不等、HEAD 取不到 ⇒ `[STALE_INPUTS, INCOMPLETE（HEAD）]`；两项都取不到 ⇒ 两条「未能完成」；
- 非本仓模式四种组合仍为 `[]`（现有用例保留）。

C4 那条现有断言（指纹一致、只改 HEAD ⇒ 出 HEAD）**改写为上面第一条**，在用例名里注明「EV-111：原断言把误报锁成了预期」。

真实 git（`checkBuildStamp`，扩展现有临时仓用例）：
- 算标识后只提交 `doc/` 下一个文件 ⇒ `[]`；
- 再提交 `src/` 下一个文件 ⇒ `[STALE_INPUTS, HEAD…]`。

doctor：`describeBuildStamp` 在「只提交 doc」那一步的描述含「一致」与出处提示，不含「不同版」。

集成：C5 用例照跑，断言不改。

### 5.2 变异

沿用 `scripts/mutation-check.mjs`（先 `node scripts/build.mjs --tests-only` 确认被测产物重编），规格与输出进
`doc/05_testing/evidence/ev111-mutation-<日期>/`：
- 去掉 `!inputsMatch` 守卫（回到原行为）⇒ EV-111 本体用例红；
- 守卫取反 ⇒ 指纹不等那条红；
- 指纹取不到时跳过 HEAD 比对（`inputsMatch` 把 null 当一致）⇒ 取不到那条红；
- 指纹一致时仍报 HEAD「未能完成」⇒ D2 用例红；
- doctor 出处提示条件取反 ⇒ doctor 用例红。

### 5.3 验收（零配额）

代码提交后，干净工作树 `npm run build`、`npm run install:local` 各一条；做一次纯文档提交（本主题的收口文档即可）；
跑 `trivium doctor`，note 里该行应为「本仓模式…安装副本与当前工作树一致（构建于 X，仓库 HEAD 已到 Y，其间未改作用面）」。
输出留进 `doc/05_testing/evidence/ev111-acceptance-<日期>/`。下一次真实双审的 run.json 不再出「不同版」，作为附带观察记进台账，不专门花配额。

`npm run typecheck && npm run build && npm test` 全绿；`trivium doctor --selftest` 全绿。

---

## 6. 文档同步

- 设计文档 `snapshot.build` 行：写明 HEAD 比对只在作用面指纹未判定一致时做，并标 EV-111；变更记录追加一条；
- BACKLOG：EV-111 关闭，追加实施提交与验收证据路径；
- M10b 轮次台账：按 r7 §4，EV-111 的轮次不进累计与阈值；墙钟照实计。台账是否另起一段记录由用户定。

---

## 7. 对 M10b 的影响（只登记，不改 M10b 文本）

1. **T2 第 6b 条仍然成立**。6b 禁止五类构建标识告警、容忍 `BUILD_WARN_HEAD`。改后 `BUILD_WARN_HEAD` 只会与
   「不是当前工作树构建的」或「比对未能完成」同时出现，而这两类都在 6b 的禁止清单里——容忍项变成空转，判据本身不用改。
2. **r7 §3.7 的规避不会因本题解除**。§3.7 说 r5 §7.3 白名单构建标识行写的是「claude 轮与 `snapshot.git_head` 一致」，
   这一行比的是**字段**（`snapshot.build.git_head` 对 `snapshot.git_head`），不是告警。本题只改告警、不改字段，
   纯文档提交之后两个字段照样不等。
   **因此 r7 §6 第 2 条「建议在第 4 步之前做，可以省掉 §3.7 的规避」按我的读法不成立**：本题落地后，
   第 4 步兼容轮仍要「构建之后不提交，提交了就重新 build + install」，除非 M10b 把白名单那一行改成与 6a / 6b 同口径
   （例如「`snapshot.build.git_head` 是 `snapshot.git_head` 或其祖先，且 `gate.warnings` 无构建标识告警」）。
   那是 M10b 的判据修订，要不要做、放进哪一稿，由用户定。r7 是已审批件，这条读法若经本轮双审确认，
   更正按「留痕准确优先」在 M10b 下一份文件里留痕，不回改 r7。

---

## 8. 给审查员的重点

1. §2 的五种情形是否穷尽：有没有「作用面指纹一致、HEAD 不同」而安装副本确实过期或不可信的情形；
2. D1 选 (a) 而不取 (b)、(c) 的理由是否站得住；指纹取不到时保留 HEAD 兜底是否必要；
3. §2 末三格正交缺口（被忽略文件、`node_modules` 漂移、构建后安装前改 `skills/`）该不该登记 BACKLOG；
4. D2（指纹一致时 HEAD 取不到不报）与第一段 CODEX-05「查不出不与查过同形」是否冲突；
5. §7 第 2 条对 M10b r5 §7.3 白名单行的读法是否正确：它比的是字段还是告警；
6. §5 用例与变异能否咬住「回到原行为」和「把 null 当一致」两种回归。

## 9. Bash 依赖

build 与 install 各单独一条；会话里命令不带重定向；验收与读数核对走 evidence 目录或 scratchpad 里的只读脚本，
脚本自己写输出（§1.1 的读数就是这么取的）。

## 10. 量级

plan 1～2 轮；code 1 轮（改动约 20 行实现 + 用例）；验收零配额。不进 M10b 轮次阈值。
