---
schema: trivium.disposition.v1
topic: M10b-入口资产与真载体验收
stage: code
role: claude
kind: response
run_id: 20260925T060626Z
addresses:
  - 2026-09-25-M10b-入口资产与真载体验收-codex.md
  - 2026-09-25-M10b-入口资产与真载体验收-gemini.md
  - 2026-09-25-M10b-入口资产与真载体验收-glm.md
---

# 代码应答：M10b 第 2 步（入口资产单源渲染、命令 A 放开 Driver、缺省减 Driver、多目标安装器、协议片段两段式）

## 0. 裁决总览

三侧结论：gemini `approve`（0 条）；glm `request-changes`（1 major / 2 minor / 2 nit）；
codex `request-changes`，但本侧**解析降级**（原文是合法 JSON，外面多套了一层代码围栏），
编排器判它不参与阻断——**我仍按原文里的 5 条逐条裁决**，降级只影响闸门计数，不影响意见本身成不成立。

**逐条裁决：10 条意见（主表 7 个裁决单元：codex 降级切出的 F01 / F02 与 glm 五条；F02 内含 5 条在 §1.1 逐条裁决）全部接受，驳回 0，暂缓 0。** 其中 GLM-04 只接受「改准文档块」一半，
「给卸载加更强判据」不采纳，理由见该行。

### 一处收敛：两侧独立命中同一个删除面

| 问题 | codex | glm |
| :--- | :--- | :--- |
| 运行时根的路径随 `TRIVIUM_ASSET_ROOT` 取值，安装侧整树同步裁剪、卸载侧整棵删除，两处都没有身份判定 | CODEX-01（major） | GLM-01（major）、GLM-02（minor） |

**核实**：

- `src/install.ts:130` 的 `runtimeRoot` 取 `resolveAssetRoot(undefined, ie.env, ie.home)`，环境变量优先（`src/trivium/asset-root.ts:22-24`）；
- `syncDir`（:137-164）裁剪「目标里源没有的项」，调用处 :286 顶层排除 `entry`（`ENTRY_SUBDIR`）⇒ 源与目标同为 `<repo>/skills/dual-critic` 时，`keep` 里没有 `entry`，**进 Git 的 21 份渲染产物会被裁掉**；
- `uninstall()`（:369-371）对运行时根无条件 `fs.rm(recursive, force)`；
- 改动前（`git show HEAD:src/install.ts`）运行时根取自 `defaultTargets()` 的固定家目录路径，不随该变量走——**删除面是本步把运行时根改为与编排器同源取值（r5 §5.4）时新引入的**；同源取值本身有计划依据，缺的是删前判定；
- `AGENTS.md:161`、`GUIDE_env_setup.md:146,181` 恰好教用户把这个变量指向工作树，因此这不是假想路径。

GLM-02 的「同文件 `copyFile` 会截断」我在本机实测了：Node v25.2.1 / darwin 下
`fs.copyFileSync(f, f)` 不抛错、内容不变。**截断在本机不成立**，但同路径本身就是 CODEX-01 那一格，
按同一处修法消除，不再依赖运行时的同文件行为。

## 1. 裁决表

codex 侧解析降级，编排器把原文切成两个单元：`CODEX-F01`（白话开场）与 `CODEX-F02`（JSON 本体）。
主表按这两个编号裁决；F02 内含的 5 条意见**逐条裁决见 §1.1，不折叠**（与 M9 r3 应答同一写法）。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-F01 | codex（降级） | nit | 接受 | 该单元是 codex 的白话开场（「I've completed my investigation. Here is my review conclusion.」），**不含意见**。降级的成因就在这里：它在 JSON 前加了散文、又套了一层代码围栏，解析器取不出来。如实记一笔作为过程留痕。 | 无代码落点，记录于本件 §0 |
| CODEX-F02 | codex（降级） | major | 接受 | JSON 本体，内含 **5 条**意见（2 major、1 medium、2 minor），**逐条裁决见 §1.1，不折叠**。最重的 CODEX-01 与 glm 的 GLM-01 独立命中同一个删除面，已逐行核实（§0）；本单元按 major 计。 | 逐条见 §1.1 |
| GLM-01 | glm | major | 接受 | 与 CODEX-01 同一个删除面（见 §0 收敛表），卸载侧的核实结论相同；旧版卸载不受该变量影响，属本步新引入。 | 同 CODEX-01 的落点（`uninstall()` 删运行时根前做身份判定，不满足就降级为列清单提示）；另在 `test/unit/install.test.ts` 专门补「`TRIVIUM_ASSET_ROOT` 指向源树时卸载不删任何东西」一格。 |
| GLM-02 | glm | minor | 接受 | 截断在本机实测不成立（Node v25.2.1 / darwin，同文件 `copyFileSync` 内容不变），但同路径同步会裁掉 `entry/`，这一点已确定（CODEX-01），根因相同。 | 同 CODEX-01 的判定①（运行时根落在源树内即拒绝），因此不会走到同路径拷贝；`syncDir` 里再加一道 `path.resolve` 后 src===dst 的短路作为防御。实测读数写进第 2 步报告。 |
| GLM-03 | glm | minor | 接受 | 属实：`init.ts:101-124` 的指纹表靠注释提醒维护，改了片段忘记补录也没有任何判据会变红，这正是架构纪律 12 要消除的依赖记性的纪律。不采纳 sidecar 方案：它会在项目 `.trivium/` 下多一份要维护的状态。 | `src/trivium/init.ts`：增加 `CURRENT_PROTOCOL_SHA256` 常量，登记当前片段组合的指纹；`test/unit/init.test.ts` 加一条契约，要求「当前 `driver.snippet` 加 `critic.snippet` 组合正文的指纹 == CURRENT」。片段一改这条就红，失败提示写明「把旧的 CURRENT 挪进 LEGACY 表，再更新 CURRENT」。维护注释改为指向这条测试。 |
| GLM-04 | glm | nit | 接受 | 文档块与实际用法矛盾属实：`isOurEntry` 写着「不据此删除任何东西」，而 `uninstall()` 正是据它决定删不删，改准。「给卸载加更强判据」不采纳：安装侧的升级放行用的也是这个判据，卸载若比安装更严，就会出现「装得上、卸不掉」的不对称；改用 description 比对，又会在跨版本改过 description 时误判。 | `src/install.ts:168-181`：`isOurEntry` 的文档块改为写明它同时决定安装根内的升级放行与卸载的删除面，并注明判据的边界（同名、调用本产品 wrapper 的 fork 会被视为本产品）。README 卸载描述里补一句这一点。 |
| GLM-05 | glm | nit | 接受 | 属实：两阶段权威值互异时，与两个阶段都相容的显式取值不存在，照提示走会再退一次 64；显式冲突分支（`driver-claim.ts:431-438`）给了出口，这一条没有。 | `src/trivium/topic-args.ts:538-546`：报错文案补出口：这种情况下不存在与两个阶段都相容的取值，请用 `topic claim --stage <其一> --driver <另一个>` 改写其中一个阶段的声明（仅当该阶段没有运行留痕、也没有产出带后缀的文件时可行），或另开主题。`test/unit/topic-args.test.ts` 对应用例的锚点同步更新。 |

### 1.1 CODEX-F02 内含 5 条的逐条裁决

| 意见编号 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | major | 接受 | 已逐行核实（见 §0）。四个安装目标里只有运行时根由外部输入决定路径，它却是唯一没有身份判定的；README:304「不删你的东西」的承诺在这一格不成立。删除面是本步新引入的。 | `src/install.ts`：`checkInstall` 增加运行时根一格：① 解析后落在安装源树内（含 src===dst）一律拒绝；② 目标已存在且非空时，必须带本产品标记（`scripts/trivium.cjs` 与 `schema/` 在场）才放行，否则计为问题、一个文件都不写。`uninstall()` 删运行时根前过同一判定，不满足就只列路径、提示手工处理。`test/unit/install.test.ts` 补三格：指向源树、指向带内容的非本产品目录、卸载时指向非本产品目录。README / MANUAL 卸载描述同步改准。 |
| CODEX-02 | major | 接受 | 已核实：`resolveCriticSelection` 在三个调用点（`cli.ts:568/599`、`cli.ts:765/775`、`topic-args.ts:565/599`）都先于 `assertModelOverrideKeys` 算出本轮入选集合，但后者只比对能力面（`selectableCritics`），为未入选的一侧指定的模型会被接受、然后静默丢弃。`critics.ts` 与 `cli.ts` 的文档块声称这个缺口已关，这句话本身失实。D-4 之后，这一格在非 claude Driver 的缺省路径上成了常规形态，而三家的入口资产把 `--model-claude` 写进了参数写法行。 | `src/trivium/critics.ts`：`assertModelOverrideKeys` 增加入参「本轮入选集合」，键不在其中时退 64，报错写明「本轮没有这一侧」，与「是 Driver」的报错分开措辞；三个调用点传入已解析的 `critics`。改动前先列全断言这一语义的落点（两处文档块、`topic-args.ts:595` 的注释、`src/entry-render.ts:270` 的 MODEL_HINT 措辞、USAGE 文案），逐处改准。`test/unit/critics.test.ts` 与 `test/unit/topic-args.test.ts` 补「`--critics gemini --model-glm X` 退 64」与「codex 当 Driver、缺省路径下 `--model-claude X` 退 64」两格。 |
| CODEX-03 | medium | 接受 | 已核实：`main()` 的 `--uninstall` 分支在 `parseOnly` 之前就 return，`--targets` 被静默忽略；两条路径都没有校验未知旗标。卸载是破坏性的，用户写下的旗标被静默吞掉，违背本项目一贯的口径。 | `src/install.ts`：argv 解析收成一处，只认 `--uninstall` 与 `--targets`，未知旗标退非零并打印用法；`--uninstall` 同时带 `--targets` 时退非零，说明 `--targets` 只对安装有效。不做「按家卸载」：运行时根由各家共用，按家卸载无法判断该不该删它。`install.test.ts` 补 argv 解析用例（把解析函数导出后直测）。 |
| CODEX-04 | minor | 接受 | 已核实：`registry-parity.test.ts` 的扫描根是 `src/trivium`，本步新增的 `src/entry-render.ts` 不在论域内。它今天是干净的，但没有记成边界，以后在里面按 id 分叉不会被拦。 | `test/unit/registry-parity.test.ts`：把 `src/entry-render.ts` 单独纳入同一条对账（它只该从注册表取值，不需要豁免条目）。`src/install.ts` 仍留在论域外：它的路径常量里有各家家根的字面量，纳入就得开豁免；同时把 :237 的注释改成写明「`src/` 顶层两个模块，一个纳入、一个不纳入」及理由。 |
| CODEX-05 | minor | 接受 | 已核实：`AGENTS.md` 里零处提到 `render` 或 `skills-src`；README 的目录树没有 `skills-src/`；契约测试的失败提示把手改产物的人引向 `npm run render`，而这条命令会把他的改动覆盖掉。r5 §8.4 的文档落点表里确实没有 AGENTS.md 这一项。 | `AGENTS.md`：项目概览、常用命令、改动同步清单各补一行（`skills-src/` 是源；`skills/<命令>/SKILL.md` 与 `skills/dual-critic/entry/**` 是产物，改源后跑 `npm run render`，产物不手改）。`README.md` 目录树同步。`test/contract/entry-render-parity.test.ts` 的失败提示改成「先改 `skills-src/` 再跑 `npm run render`；手改过产物的，请把改动挪进源」。在第 2 步报告里注明：AGENTS.md 已追加进 r5 §8.4 的落点表。 |

## 2. 修改方案汇总（待 `/dual-approve` 后实施）

1. **安装器运行时根的身份判定**（CODEX-01 / GLM-01 / GLM-02）：安装前检查与卸载共用同一判定；源树内拒绝；非空目标必须带本产品标记；`syncDir` 加同路径短路；补 4 格单测；README / MANUAL 的卸载描述改准。
2. **`--model-<id>` 判据改为与本轮入选集合同源**（CODEX-02）：先列全断言这一语义的落点再改；三个调用点传入 `critics`；补 2 格单测。
3. **安装器 argv 收口**（CODEX-03）：未知旗标退非零；`--uninstall` 与 `--targets` 同时出现时退非零。
4. **对账论域补 `src/entry-render.ts`**（CODEX-04），注释写明 `src/` 顶层的边界。
5. **源与产物关系写进 AGENTS.md / README，并改准契约测试的失败提示**（CODEX-05）。
6. **协议指纹改成由测试守护**（GLM-03）：`CURRENT` 常量加一条契约测试。
7. **文档块与报错文案改准**（GLM-04、GLM-05）。

实施后按惯例跑 `npm run check` 与 `npm test`，并在新增判据上补变异，确认它们确实咬住；读数追加进
`doc/05_testing/REPORT_2026-09-25_m10b_step2.md`。改动面涉及安装器的破坏性路径，修完后**再送一轮代码双审**。

## 3. 关于 gemini 侧

gemini 判 `approve`、没有提出意见，本件对该侧无需逐条裁决。但它认为「安装器杜绝误伤用户目录」，
这一判断被 CODEX-01 / GLM-01 推翻：它核了入口目录的 `isOurEntry` 守卫，没有核运行时根这一格。
留作这一侧覆盖面的读数，不另立条目。
