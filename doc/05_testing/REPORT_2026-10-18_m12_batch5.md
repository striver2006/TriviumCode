# M12 批次 5：共享读取面同名入口告警（EV-240 方案 A）与送审请求文件去重（EV-236 A2）

- **日期**：2026-10-18
- **执笔**：Claude Code（当轮 Driver）
- **主题**：`M12-运维防护`（`/dual-run`，A 档）
- **上位**：`doc/08_project/M11后续-开发计划-草案.md` §6.1、§6.2；用户 D-11、D-12
- **起点**：`8c4d359f`（工作树干净）
- **配额**：零真实模型调用（双审本身除外）。验收只跑了各家 CLI 的 `--version`
- **证据**：[`evidence/m12-batch5-20261018/`](./evidence/m12-batch5-20261018/)。只存读数、脚本与 sha256，不存任务书或请求文件原件

---

## 1. 结论

| 项 | 结果 |
| :--- | :--- |
| EV-240 方案 A | 已实现。判定逻辑搬进 `src/trivium/entry-collisions.ts`，安装器与编排器两个打包产物引用同一份实现。doctor 全量列出共享读取面里的同名入口（只告警），preflight 对本轮相关的家给一条 ⚠️（不阻断） |
| 安装器行为不变 | 新旧安装器在 9 格 HOME 隔离夹具上对照（A-1），stdout、stderr、退出码与安装后目录树逐字相同；原有 17 条用例未改动，全部通过 |
| EV-236 A2 | 已实现。`request.json` 里的冻结补丁只存一份（顶层 `frozen_diff`），各侧按引用还原。新旧对照（A-3）规范化后，任务书与被审补丁逐字相同；旧格式运行目录照常可读 |
| 全量 `npm run check` | 第一遍 3711 / 3709 / 0 / 2（tests / pass / fail / skipped），比批次 4 多 24 条，均为新增用例 |
| 变异 | 逐条预跑 14/14、正式装置 14/14 咬住（§5） |
| 计划三审 | run `20261018T002634Z`，7 条全部接受，r2 定稿 |
| 代码三审 | run `20261018T010929Z`：codex、gemini `approve`，glm 3 条 nit 全部接受并已改（§3.2） |

---

## 2. 改动

### 2.1 EV-240：共享读取面同名入口

- **新模块 `src/trivium/entry-collisions.ts`**：从 `src/install.ts` 原样搬来 `isOurEntry` 与判定核心（`scanEntryCollisions`，三类：`residue` / `third-party` / `foreign-entry`）。问题类型在这里声明，`src/trivium/` 不反向依赖安装器。另有编排器侧使用的入口名单常量 `ENTRY_SKILL_NAMES`、三类短标签（与 `install:check` 原文相同）、共享读取面的目标构造与两种文案。
- **安装器**：`checkInstall` 的签名与导出不变，函数体改为调用共享判定。入口名单仍然取仓库里的渲染产物，判定输入、`describeProblems` 文案与 `main()` 退出码都不变。`install-check.mjs` 改为从安装器产物取三类标签，输出逐字不变。
- **doctor**：在环境段调用共享判定，只扫各家的额外读取根（注册表 `entrySkillExtraReadRoots`，今天是 codex 与 glm 共读的 `~/.agents/skills`）。有问题时按路径归并列出，给出出口：先在仓库根跑 `npm run install:check` 只读核对，确认后手工挪走。结果只进 `warnings`，不进 `blockers`，不影响退出码，与 `--only` 无关。
- **preflight**：新增只告警项「共享读取面同名入口」。只看本轮 Driver 和入选审核者中登记了额外读取根的那几家，输出一行，`ok` 恒为真。位置在已废弃配置键之后、归档与 git 检查之前。`review --start` 不跑这一项。
- **扫描用的家目录**：只有一个来源，依次是注入口、环境变量 `TRIVIUM_ENTRY_SCAN_HOME`、`os.homedir()`。这个变量只为测试隔离和诊断而设，只影响这一处只读扫描，安装器不读它。
- `displayHomePath` 从 `preflight.ts` 挪到 `util/fsx.ts`，加了可选的 `home` 参数。不传时行为同原来；preflight 再导出它，原有调用点不变。

### 2.2 EV-236 A2：交接文件去重

- `run-protocol.ts` 新增两个纯函数。`packSnapshots` 只在侧数 ≥ 1、首侧有正文、各侧正文逐字相同时把补丁收成一份，不改入参。`unpackSnapshots` 按序校验后还原。
- `writeHandoff` 写出 `frozen_diff: { sha256, text }`，各侧快照的 `diffText` 落盘为 null。`rebuildContext` 经 `unpackSnapshots` 还原，结果与去重前的内存对象逐字段相等。
- schema 名仍是 `trivium.handoff.v1`：各侧快照的 `diffText` 冻结之后本来就没有读者，旧版 worker 读到 null 不受影响。
- 新格式出现以下任一情况时报 `envError`（退 69）：形态不对、正文与 sha256 不符、某侧仍带正文、某侧哈希对不上、非 code 阶段带 `frozen_diff`、code 阶段丢了正文。这些检查只作用于新格式，旧格式原样通过。

### 2.3 测试侧的 HOME 隔离（计划双审 CODEX-01 / GLM-01）

- `test/helpers/entry-scan-home.ts`：`isolateEntryScanHome()` 把本进程的扫描家目录钉到一个空夹具。
- `fixture.ts` 的 `cli()` 在缺省环境里加上这个变量。直接调用 doctor / preflight 的 5 个测试文件，顶部各加一行调用，不改任何断言。
- `entry-scan-isolation.test.ts` 的 U8 做对账：直接调用 doctor / preflight 却没走隔离的文件会当场红；自己 spawn 产物的文件要逐个登记理由。U9 证明设了变量后，读的就是变量指向的目录。

---

## 3. 双审

### 3.1 计划三审（run `20261018T002634Z`）

- codex `request-changes`：1 major、1 minor。glm `approve-with-nits`：1 minor。gemini `approve-with-nits`：2 minor、2 nit。
- 7 条全部接受，裁决件 `plan/2026-10-18-M12-运维防护-revised-claude.md`，r2 定稿。要点：
  - 隔离面从「做精确断言的旧用例」扩大到「凡能跑到新扫描的测试」，并改为单一来源加对账（CODEX-01、GLM-01）；
  - I1 / A-3 不再数整份 `request.json` 里的哨兵：任务书节选在 400 行内就是全文（CODEX-02）；
  - 告警路径按扫描所用的家目录折叠成 `~/…`（AGY-01）；
  - 坏形态的交接文件给受控 `envError`（AGY-02）；
  - 空快照不提取补丁（AGY-03）；
  - 问题类型在共享模块里独立声明（AGY-04）。

### 3.2 代码三审（run `20261018T010929Z`）

- codex `approve`、gemini `approve`，均为零意见。glm `approve-with-nits`，3 条 nit，全部接受，应答件 `code/2026-10-18-M12-运维防护-response-claude.md`：
  - **GLM-01**：`install:check` 改为从产物取标签表后，「新脚本配批次 5 之前的旧产物」在有冲突时会抛 TypeError，被当成「检查失败」吞掉冲突清单。改为取不到标签表时直接提示「产物过旧，先 `npm run build`」并退 2。在 HOME 隔离夹具上核过三种组合：新脚本配新产物、旧脚本配旧产物，输出逐字相同、退 1；新脚本配旧产物，明确退 2。A-1 随后重跑一遍，9 格仍然逐字相同。
  - **GLM-02**：U8 的直调判据原来只认字面调用，用别名导入可以绕过。现在放宽为「导入了这两个符号或出现调用」任一成立即算，并在用例里写明仍然够不到的形态。
  - **GLM-03**：实现与计划 r2 有三处细目差异没有记录，现补在 §3.3。
- 告警里「安装副本不是当前工作树构建的」属预期：verify 之前会 `install:local`。

### 3.3 相对计划 r2 的实现差异（代码三审 GLM-03）

| 计划 r2 | 实现 | 说明 |
| :--- | :--- | :--- |
| §2.5 `entryScanHome(inject?)` | `entryScanEnv(inject?)` | 返回家目录与环境变量两项（`EntryScanEnv`），供 `entrySkillRootOf` 求值；取值顺序与计划相同 |
| §2.1 `summarizeSharedRootProblems(problems, agents, home)` | 两个参数 `(problems, home)` | 「本轮哪几家会读到」由问题列表里的 `agent` 派生：问题本来就只由相关的家产生，结果相同 |
| §4.1 直调的 6 个文件 | 5 个 | `codex-wiring.test.ts` 只在注释里提到 `runPreflight`，preflight 全经 `cli()`，不需要加隔离；U8 放宽判据后同样不把它判为直调 |

---

## 4. 测试

| 文件 | 新增 | 内容 |
| :--- | :--- | :--- |
| `test/unit/entry-collisions.test.ts` | 6 | 三类判定与次序、`isOurEntry` 边界、共享读取面目标、渲染与 `~` 折叠、扫描家目录来源、`displayHomePath` |
| `test/unit/entry-collisions-bundles.test.ts` | 4 | 两份产物都含共享模块标记且各只有一份实现；安装器源码无判定实现；`src/trivium/` 不 import 安装器；名单三方对账 |
| `test/unit/doctor-shared-roots.test.ts` | 2 | 只进 warnings、按路径归并、带出口、blockers 不变；扫描出错退化为一条告警 |
| `test/unit/preflight.test.ts`（追加） | 3 | 相关性：Driver 算相关、不读共享根的家不出项、干净不出项；`ok` 为真、退出码不变 |
| `test/unit/handoff-pack.test.ts` | 5 | 往返逐字段相等、入参不被改、plan / 空快照 / 不一致时原样、旧格式原样、六类篡改都报 envError |
| `test/unit/entry-scan-isolation.test.ts` | 2 | U8 对账、U9 读源证明 |
| `test/unit/install.test.ts`（追加） | 1 | 报错全文、问题次序与改造前逐字相同（期望文案照原 `describeProblems` 写死） |
| `test/integration/handoff-dedupe.test.ts` | 1 | 打包产物跑 code 阶段：快照不带正文、`frozen_diff` 等于归档补丁、brief 与归档逐字相同、worker 照常收尾 |

全量 `npm run check`：第一遍 3711 / 3709 / 0 / 2。

---

## 5. 变异

规格见 `evidence/m12-batch5-20261018/mutation-spec.json`（由同目录的 `gen-spec.mjs` 生成，逐条核对 find 只命中一处）。

- **逐条预跑**（`mutation-names-bundle.mjs`，`--with-tests` 重打 bundle）：14/14 咬住，读数在 `mutation-names-output.json`。
- **正式装置**（`scripts/mutation-check.mjs`）：工作树干净、基线全绿（7 个套件），14/14 咬住，每条的失败数与预跑相同，读数在 `mutation-output.txt`。

| # | 变异 | 咬住的用例（摘） |
| :--- | :--- | :--- |
| M1 | 安装根里的自家同名不再放行 | install：升级覆盖、裁剪、运行时根放行格（4） |
| M2 | `isOurEntry` 去掉 wrapper 判据 | entry-collisions U1、U2 渲染（3） |
| M3 | doctor 把告警推进 blockers | doctor-shared-roots U5 |
| M4 | preflight 该项 `ok` 置 false | preflight U6 两格 |
| M5 | preflight 相关集去掉 Driver | preflight U6「Driver 算相关」 |
| M6 | 共享读取面目标包含安装根 | entry-collisions U2 两格 |
| M7 | pack 不置 null | handoff-pack 往返、篡改两格 |
| M8 | unpack 不核正文 sha | handoff-pack 篡改 |
| M9 | unpack 漏还原首侧 | handoff-pack 往返 |
| M10 | 旧格式被误判为新格式 | handoff-pack 旧格式 |
| M11 | 忽略 `TRIVIUM_ENTRY_SCAN_HOME` | entry-scan-isolation U9 |
| M12 | 去掉非 code 阶段拒绝 | handoff-pack 篡改 |
| M13 | 安装器对 top 布局也查残留 | install 三格 |
| M14 | `writeHandoff` 不写 `frozen_diff` | handoff-dedupe（worker 拒绝执行） |

**测不到的一处**：如果 `rebuildContext` 不调用 `unpackSnapshots`、直接使用落盘的快照（各侧 `diffText` 为 null），目前没有用例会红。原因是各侧 `diffText` 冻结之后本来就没有读者，计划 §1.2 已经核实过这一点。还原的意义在于保持内存对象与去重前一致，以及在 worker 侧做完整性校验。后者由 M8、M12、M14 间接守住：去掉还原就等于去掉了校验，但校验失败只在交接文件被改坏时才会发生，用例构造不出 worker 读之前篡改文件的时序。如实记为测试缺口，不登记 BACKLOG。

---

## 6. 桩级验收（零真实调用）

旧构建：`git archive 8c4d359f` 导出到会话 scratchpad，软链 `node_modules` 后构建；新构建：当前工作树。夹具一律在临时目录，HOME 隔离。
脚本在会话 scratchpad 里执行，证据目录里存的是副本。`a1-installer.mjs` 把夹具建在脚本所在目录下的 `a1/`，重放时请先把它拷到临时目录再跑，不要在证据目录里直接执行。

### 6.1 A-1 安装器新旧对照

脚本 `a1-installer.mjs`，读数 `a1-installer-output.json`。9 格逐字相同（`all_identical: true`），每格都记了规范化输出的长度与 sha256，以证明对照的不是空输出：

| 格 | 步骤与退出码 |
| :--- | :--- |
| clean-install | install ⇒ 0（52 个文件） |
| reinstall-upgrade | install ⇒ 0；install ⇒ 0 |
| three-kinds | check ⇒ 1；install ⇒ 1 |
| install-root-third-party | check ⇒ 1；install ⇒ 1 |
| targets-missing-family | `--targets gemini` ⇒ 1；`--targets claude,glm` ⇒ 0 |
| runtime-foreign | install ⇒ 1 |
| runtime-overlap | install ⇒ 1；uninstall ⇒ 0 |
| codex-home-elsewhere | check ⇒ 1；install ⇒ 1 |
| install-then-uninstall | `--targets claude,glm,gemini` ⇒ 0；uninstall ⇒ 0 |

### 6.2 A-2 doctor / preflight 读数（新产物）

脚本 `a23-readings.mjs`，读数 `a23-readings-output.json` 的 `a2` 段。夹具项目照搬本仓本机层的 `probe.cli` / `probe.host`（不拷 `probe.auth`），`TRIVIUM_ENTRY_SCAN_HOME` 指向夹具。

- `doctor --only env --no-model-calls`：夹具有同名入口时退 0、blockers 0，恰 1 条共享读取面告警，路径折叠成 `~/.agents/skills/…`；干净时 0 条。
- `preflight --skip-auth-check`：

  | 入选 | 退出码 | 共享读取面项 |
  | :--- | :--- | :--- |
  | `--critics gemini`（缺省 Driver） | 0 | 不出 |
  | `--critics codex,glm` | 0 | 出 1 条 |
  | `--driver glm --critics gemini` | 0 | 出 1 条 |
  | `--critics codex,glm`，家目录干净 | 0 | 不出 |

- **夹具调整**：本机 agy 在本会话期间自动升级（探针记录 1.4.0，安装为 1.4.2）。不调整的话，只选 gemini 的两格会先在「Antigravity 版本与探针一致」退 69，走不到本批的检查项。因此夹具里按 `agy --version` 的当前值改写了版本号（零配额，读数里记了 `agy_version_fixture`），没有改本仓的探针。这一漂移与本批无关，但会影响下一次带 gemini 的真实审查，见 §7。

### 6.3 A-3 送审请求文件新旧对照

`a23-readings-output.json` 的 `a3` 段。同一组桩（gemini、glm 两侧），同一形态的夹具，改动 600 多行（超过任务书 400 行的节选上限）。

- 旧产物与新产物都退 0、`success`。
- 规范化运行 id、时间戳、哈希、夹具路径与运行时根路径后，两侧 brief 与 `changes-<run_id>.diff` 逐字相同，`run.json` 快照字段相同（构建标识 `build` 除外：旧导出没有 `.git`，记为 null，与本批无关）。
- `request.json`：旧 99,962 B，新 76,862 B。扣除运行时根路径长度差后少 22,796 B；一份补丁在 JSON 里占 22,923 B，差额是 `frozen_diff` 外壳与 sha256。旧格式各侧快照带正文 2 份，新格式 0 份。
- 新版 `unpackSnapshots` 读旧格式：原样返回，与旧文件里的快照逐字段相同。读新格式：各侧还原出的补丁等于归档补丁。新格式各侧 `brief_text` 与归档 brief 逐字相同。

---

## 7. 发现与提醒

- **agy 版本漂移**：本机 agy 已从 1.4.0 自动升到 1.4.2，本仓探针未刷新。下一次带 gemini 的真实审查，预检会在「版本与探针一致」退 69，需要先跑 `doctor --only agy`，会花少量配额，由用户决定。本批验收没有改本仓探针。
- **残余**（计划 r2 §7）：
  - 共享根里的 `dual-critic` 历史拷贝，安装器和 doctor 都不判，是否扩大判定范围由用户决定；
  - `review --start` 不跑新检查；
  - 任务书节选里的补丁正文仍是各侧各一份（这是送给审核者的内容）；
  - A1 暂缓、B 不做（D-12）。
