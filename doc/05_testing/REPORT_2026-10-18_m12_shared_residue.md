# 共享根历史形态残留检测（EV-240 残余）

- **日期**：2026-10-18
- **执笔**：Claude Code（当轮 Driver）
- **主题**：`M12-共享根残留检测`（`/dual-run`，A 档）
- **上位**：BACKLOG EV-240 残余；`REPORT_2026-10-18_m12_batch5.md` §7；用户 2026-10-18 定做
- **起点**：`a0c3a609`（工作树干净）
- **配额**：零真实模型调用（双审本身除外）。验收只跑了各家 CLI 的 `--version`
- **证据**：[`evidence/m12-shared-residue-20261018/`](./evidence/m12-shared-residue-20261018/)。只存脚本与读数

---

## 1. 结论

| 项 | 结果 |
| :--- | :--- |
| 共享根残留检测 | 已实现。新类别 `shared-residue`：额外读取根（今天即 codex、zcode 共读的 `~/.agents/skills`）里的 `dual-critic` / `entry`，按内容认定为本产品才判。安装器与 `install:check` 整次拒装（只报错、不删除），doctor 全量列出，preflight 对本轮相关的家给一条警告、不阻断。四处用的是 `src/trivium/entry-collisions.ts` 里同一份判定 |
| 不误伤别家同名 skill | 别家叫 `entry` / `dual-critic` 的 skill 不判：单测矩阵 8 格（U1）、安装器用例、A-1 的「别家 entry 与 dual-critic」格、A-2 的残留夹具（摆了别家 `entry`，只报 `dual-critic` 一条） |
| 安装根不变 | 安装根顶层 `residue` 的判定、文案、退出码不变，既有用例一条没改（连构造字段都不用补）。A-1 无残留 10 格新旧逐字相同 |
| 无残留时逐字节相同 | doctor / preflight 在「干净」「只有同名入口」两类夹具上新旧读数逐字相同（A-2 10 格，子进程 HOME 隔离） |
| 变异 | 逐条预跑 15/15、正式装置 14/14 咬住（§5） |
| 计划三审 | run `20261018T023000Z`：三侧 `approve-with-nits`，6 条全部接受，r2 定稿 |
| 代码三审 | run `20261018T031358Z`：glm、gemini `approve`（无意见），codex `approve-with-nits` 1 条 minor，已接受并改（§3.2） |
| 全量 `npm run check` | 3730 / 3728 / 0 / 2（tests / pass / fail / skipped），比批次 5 多 19 条，均为本主题新增用例（§4） |

---

## 2. 改动

### 2.1 判定（计划 r2 D-1～D-7）

- **认定是本产品的历史形态**（`isResidueCopy`），满足任一即判：
  - ① 运行时根拷贝：`SKILL.md` 从首行起是运行时身份行（`---` + `name: dual-critic`），并且有 `schema/` 目录。仓库里历来 10 个版本的运行时根都是这个身份行、都带 `schema/`；装好的运行时根也带。
  - ② 含入口子树：它本身，或它下面的 `entry/`，里面有 `〈载体〉/〈入口〉/` 形态、`isOurEntry` 判真的入口。
- **只看额外读取根**：判定循环显式跳过安装根。安装根顶层仍是原来那条见名即判的 `residue`。
- **豁免当前运行时根**（按真实路径比对）：安装器与 `install:check` 用本次的 `plan.runtimeRoot`；编排器用按扫描环境求值的 `resolveAssetRoot()`，再加上当前进程自身所在的运行时根（`process.argv[1]` 形如 `〈根〉/scripts/trivium.cjs`，计划双审 GLM-02）。
- **名单来源**：编排器侧用常量 `RESIDUE_DIR_NAMES` / `RUNTIME_ROOT_NAME`；安装器仍用自己从 `ENTRY_OUT_DIR` 派生的 `RESIDUE_NAMES`。对账用例保证两边一致。
- **运行时身份行只留一份实现**：安装器的 `isOurRuntime` 改为调用共享模块的 `hasRuntimeIdentity`，判据逐字不变。`runtime-foreign`、缺省位置旧运行时提示、卸载这三处调用点没改。
- `EntryScanTarget` 新增的两个字段 `sharedResidueNames`、`exemptPaths` 都是可选的。不传时等于不查（计划双审 CODEX-01 / GLM-01 / AGY-01）。

### 2.2 文案

- 安装器 `describeProblems` 为新类别单列一句；短标签表新增一项（`install:check`、doctor、preflight 共用），原有三项不变。
- doctor：原来的「同名入口」段保持原样，残留另起一段，出口句只出现一次。
- preflight：仍是一行，两类分别计数（「N 个同名入口、M 份本产品的历史拷贝」）。
- 共享根里没有残留时，以上输出与 `a0c3a609` 逐字节相同。

### 2.3 不做

- 被改了名的拷贝不判，因为要判就得遍历共享根、逐个读内容。
- 卸载不删共享根里的残留。
- `review --start` 不跑这条检查。
- 剩余的豁免边界：如果某份运行时放在共享根里，它既不是当前进程所在的那份，扫描时也没有用 `TRIVIUM_ASSET_ROOT` 指向它，doctor / preflight 会把它报成残留（只告警，不影响安装器）。A-2 的 `self_root` 段记录了两种情形的读数。

---

## 3. 双审

### 3.1 计划三审（run `20261018T023000Z`）

三侧都是 `approve-with-nits`，6 条全部接受，裁决见 `.reviews/M12-共享根残留检测/plan/` 下的 revised 件，r2 定稿：

- 三侧同指一处（CODEX-01 / GLM-01 / AGY-01）：新字段如果设为必填，既有用例就要补字段，与「一条不改」冲突。已改为可选。
- GLM-02：安装时设了 `TRIVIUM_ASSET_ROOT`、扫描时没设，活运行时会被误报。已补自身产物所在运行时根的豁免。
- AGY-02：`isResidueCopy` 的入口名单参数加缺省值。
- AGY-03：豁免比对改按真实路径（macOS 的 `/var` 软链）。

### 3.2 代码三审（run `20261018T031358Z`）

glm、gemini `approve`，无意见；codex `approve-with-nits`，1 条：

- CODEX-01（minor）：A-2 只把共享根扫描指到夹具，子进程仍继承真实 `HOME`，`agy --version` 也是。与「夹具全程隔离 HOME」不符。已接受：全部子进程改用同一份隔离环境后重取读数，结论不变（§6.2）。产品代码与单测不受影响。

---

## 4. 测试

| 文件 | 新增 | 内容 |
| :--- | :--- | :--- |
| `test/unit/entry-collisions.test.ts`（追加） | 8 | `isResidueCopy` 判定矩阵与不可读目录；扫描次序、只看额外读取根、缺省字段等于不查；豁免按真实路径（真实路径、软链、含 `..` 的写法）；`sharedReadRootTargets` 与 `selfRuntimeRoot`；渲染（只有同名入口时与批次 5 文案逐字相同、只有残留、两类混合） |
| `test/unit/install.test.ts`（追加） | 3 | 10-16 形态整次拒装，错误全文写死，装前装后目录树不变；别家 `entry` / `dual-critic` 照常安装；运行时根放在共享根里时豁免，`checkInstall` 不传运行时根时不豁免 |
| `test/unit/entry-collisions-bundles.test.ts`（追加） | 2 | 两份产物里 `hasRuntimeIdentity`、`isResidueCopy` 各只有一份实现，安装器源码不再自带身份行；名单对账 |
| `test/unit/doctor-shared-roots.test.ts`（追加） | 1 | 只有残留时多一条告警；残留加同名入口时仍只多一条（分两段）；blockers 不变 |
| `test/unit/preflight.test.ts`（追加） | 2 | 只看本轮相关的家；出项时 `ok` 为真、退出码不变 |
| `test/unit/install-check-script.test.ts`（新） | 3 | 子进程跑 `install:check`，环境整份构造、`HOME` 指向夹具：有残留时退 1 并列出新标签；运行时根放在共享根时豁免、退 0；只有别家 `entry` 时退 0，✓ 行与原来相同 |

单跑相关 7 个套件全绿。全量见 §1。

---

## 5. 变异

规格由 `gen-spec.mjs` 生成，逐条核对 find 在源码中只命中一处。

- 逐条预跑（`mutation-names-bundle.mjs`，全量规格 15 条，含 `scripts/install-check.mjs` 的 M11）：15/15 咬住，失败用例名见 `mutation-names-log.txt`。
- 正式装置（`scripts/mutation-check.mjs`，只支持 `.ts` 目标，14 条）：14/14 咬住，见 `mutation-output.txt`。

| 编号 | 变异 | 咬住它的用例 |
| :--- | :--- | :--- |
| M1 | 共享根残留循环不排除安装根 | U2 次序格 |
| M2 | `isResidueCopy` 恒真（见名即判） | U1 矩阵等 4 条 |
| M3 | 去掉 `schema/` 判据 | U1 矩阵 |
| M4 | 去掉入口子树判据 | U1 矩阵、U4 |
| M5 | 入口子树只查 D、不查 D/entry | U1 矩阵 |
| M6 | 去掉豁免 | U2 豁免格、U3 |
| M7 | `sharedReadRootTargets` 传空名单 | U3、U4 |
| M8 | 安装器传空名单 | 安装器两格 |
| M9 | doctor 漏掉残留段的逐行 | U4 |
| M10 | 无残留时 preflight 也带残留计数 | U4 逐字格 |
| M11 | `install:check` 不传运行时根（只在预跑里跑） | U9 豁免格 |
| M12 | 身份行不要求从首行起 | U1 矩阵 |
| M13 | 豁免比对不取真实路径 | U2 豁免格、U3 |
| M14 | 漏掉自身所在运行时根的豁免 | U3 |
| M15 | `install()` 不传运行时根 | 安装器豁免格 |

---

## 6. 桩级验收（零真实调用）

旧构建是把 `git archive a0c3a609` 导出到会话 scratchpad，软链 `node_modules` 后构建的；新构建是当前工作树。两份产物的 sha256 都不同（`install.cjs` 旧 `db60d584…`、新 `824d1f8e…`）。夹具一律放在临时目录，HOME 隔离。脚本在会话 scratchpad 里执行，证据目录里存的是副本。`a1-installer.mjs` 会把夹具建在脚本所在目录下的 `a1/`，重放前请先拷到临时目录。

### 6.1 A-1 安装器新旧对照

脚本 `a1-installer.mjs`，读数 `a1-installer-output.json`。13 格全部符合预期（`all_as_expected: true`）：

| 组 | 格 | 旧 ⇒ 新 |
| :--- | :--- | :--- |
| 应逐字相同 | clean-install | check 0、install 0 |
| | install-root-residue（codex 安装根放 `dual-critic/`） | check 1、install 1 |
| | install-root-entry-third-party（安装根里别家 `entry`） | check 1、install 1（安装根仍是见名即判） |
| | shared-third-party-entry-and-dual-critic | check 0、install 0 |
| | shared-same-name-third-party | check 1、install 1 |
| | shared-foreign-entry | check 1、install 1 |
| | runtime-foreign | install 1 |
| | runtime-overlap | install 1 |
| | asset-root-in-shared（`TRIVIUM_ASSET_ROOT` 指到共享根下的 `dual-critic`） | install 0、check 0、install 0 |
| | targets-missing-family | `--targets gemini` 1、`--targets claude,glm` 0 |
| 应不同 | shared-runtime-copy-1016 | 旧 check 0 / install 0 ⇒ 新 check 1 / install 1，新产物目录树不变 |
| | shared-entry-subtree | 旧 0 / 0 ⇒ 新 1 / 1，目录树不变 |
| | shared-residue-and-foreign-entry | 旧 1 / 1（只报同名入口）⇒ 新 1 / 1，多出两条 `shared-residue`，目录树不变 |

### 6.2 A-2 doctor / preflight 新旧读数

脚本 `a2-readings.mjs`，读数 `a2-readings-output.json`。夹具项目照搬了本仓本机层的 `probe.cli` / `probe.host`（没拷 `probe.auth`）；agy 版本号按 `agy --version` 的当前值改写，这一点与批次 5 相同。

**隔离口径（代码三审 CODEX-01 后重取）**：所有子进程（doctor、preflight、`agy --version`）共用一份环境，`HOME` 指向夹具里单独的 `home-cli/`，`CODEX_HOME`、`ZCODE_HOME`、`XDG_*`、`TRIVIUM_ASSET_ROOT` 一律删掉；共享根扫描另经 `TRIVIUM_ENTRY_SCAN_HOME` 指向各格的夹具家目录。读数文件里没有真实家目录路径。初稿只隔离了共享根扫描、子进程仍继承真实 `HOME`，那一版读数已作废。批次 5 的 A-2 脚本是同一形态，也有这个缺口，这里只记录，不重跑。

- doctor `--only env --no-model-calls`，4 类家目录：「干净」「只有同名入口」两类新旧逐字相同；只有残留的夹具新产物多一条告警，旧产物没有；混合夹具新产物在原同名入口段之后多出残留段。退出码都是 0，blockers 都是 0。
- preflight `--skip-auth-check`，4 种入选 × 3 类家目录，共 12 格，退出码都是 0：「干净」「只有同名入口」8 格新旧逐字相同。只有残留时，`--critics gemini`（缺省 Driver）不出项；`--critics glm`、`--driver glm --critics gemini`、`--driver codex --critics gemini` 各出 1 条。
- 入选组合不选 codex 当审核者：隔离 HOME 后夹具里没有 codex 的家目录配置，「档位组合合法」会先退 64（新旧都一样），走不到本主题的检查项。那份配置含明文凭据，不拷进夹具。codex 读共享根这一侧由「codex 作 Driver」一格覆盖。
- `self_root`（GLM-02）：把新产物的运行时根整棵放进夹具共享根的 `dual-critic/`，不设 `TRIVIUM_ASSET_ROOT`。从那份运行时里的 `scripts/trivium.cjs` 跑 doctor，不报它；从仓库产物跑，会报它，即 §2.3 登记的剩余边界。

---

## 7. 发现与提醒

- 闸门报过运行告警：本机安装副本构建于 `8c4d359`，并且是带未提交改动的构建（批次 5 verify 时那份），批次 5 提交后没有重装。重装由用户决定。
- 批次 5 的 A-2 验收脚本有同样的 HOME 隔离缺口（§6.2），只记录，不重跑。
- 收口时有一次误判：后台任务的完成通知早于全量检查的实际结束，据此又发了两遍，三遍互相重叠。三遍读数（2～3 条失败，都落在按进程表判 worker 的用例上，且各遍不同）全部作废，之后单独前台跑的一遍为准（§1）。四遍跑完后，系统临时目录里本次新增的只有 3 个 `trivium-index-*`，是已知的 EV-204 残余（约每遍全量 1 个），没有删。
