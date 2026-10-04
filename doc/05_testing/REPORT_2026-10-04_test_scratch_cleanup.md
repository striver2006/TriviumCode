# 单测临时目录收尾 · 实施报告（EV-208）

> - **主题**：`单测临时目录收尾`（命令 A `/dual-run`，Driver claude）
> - **起点**：`ae5dfbd`（`main`）
> - **计划**：`.reviews/单测临时目录收尾/plan/` r2。计划双审第 1 轮 run `20261004T133008Z`（三侧到齐）：codex（`k3`）`approve-with-nits`、gemini `request-changes`、glm `approve-with-nits`，7 条全接受
> - **代码双审**：见 §7
> - **设计**：主设计 v1.3.86（§17.1「夹具目录约定」段末补一句）
> - **证据**：`doc/05_testing/evidence/test-scratch-cleanup-20261004/`
> - **配额**：零。只改 `test/` 与文档，`src/` 一行未动；不跑任何真实 CLI、不跑真实 doctor

## 1. 问题

`test/` 下各测试文件自己 `mkdtemp` 的临时目录大多跑完不删。2026-10-04 用只读脚本（按 `birthtimeMs`、名字去掉末 6 位随机后缀分组）数系统临时目录：10:45Z 之后跑了三遍全量，新建 `trivium-` / `tv-` 开头的条目 **3145 个、82 个前缀**，每遍约 1048 个；两类条目当时共 165874 个。除 `trivium-index-` 5 个出自产品代码（`workTreeHash` 跑到一半进程被杀，EV-204 残余五）外，81 个前缀都对得上 `test/` 下某一处调用。前几位：`trivium-hook-` 306（`hooks.test.ts`）、`trivium-proto-` 237（`test/helpers/run-ctx.ts`）、`trivium-zcode-model-` 198、`trivium-args-` 135、`trivium-pf-` 132、`trivium-gate-` 114、`trivium-lock-` 111；另有 `tv-goal-` / `tv-goal-lock-` 30 个（`task-goal.test.ts`，前缀不以 `trivium-` 开头，任务目标的 3115 没数到它们）。

调用点口径：`grep mkdtemp` 命中 74 个文件、145 行（含注释与文档串里的提及）；剥掉注释与字符串（`stripNonCode`）后按 `mkdtemp` / `mkdtempSync` / `makeTempDir` 的调用形态数，是 74 个文件、**124 处**。

## 2. 改了什么

- **通用 helper `test/helpers/scratch.ts`**（新）：`scratchDir(prefix)` / `scratchDirSync(prefix)` 在系统临时目录下 mkdtemp，返回值与 `fs.mkdtemp(path.join(os.tmpdir(), prefix))` 完全相同；**一返回就登记**（同一同步段内），首次登记时挂一次 `process.on('exit')`，测试文件进程退出时逐条删。退出收尾逐字沿用 EV-207 给 `makeFixture` 做的三件：提示同步写 fd 2 且永不抛（`warnLine`）、每层先 chmod 自身再列目录且每步吞错（`unlockTreeSync`）、每条一个 try（一个删不掉不中断后面的、不改退出码）。新增三处：
  - 前缀必须形如 `trivium-xxx-`（`trivium-` 之后至少一个字母、数字或下划线，只含字母、数字、下划线、连字符，以连字符结尾；计划双审 AGY-03 放行下划线，代码双审 GLM-01 收紧到与这句文案一致），否则在调用 mkdtemp 之前拒绝——`scratchDirSync` 同步抛 `TypeError`，`scratchDir` 返回被拒的 Promise（GLM-03）；
  - 登记时把返回值与当时的 `os.tmpdir()` 都 `path.resolve`（AGY-02：`os.tmpdir()` 会去掉尾斜杠，但 `TMPDIR` 是相对路径时原样返回相对路径，mkdtemp 的返回值也是相对的），退出时防呆要求「绝对路径、父目录恰是登记时的系统临时目录、名字以登记的前缀开头」三者都满足才删；
  - 提示按调用方分组：`makeFixture` 传「makeFixture / 夹具目录」，三句提示与 EV-207 逐字相同；其余缺省「scratchDir / 测试临时目录」。保留变量沿用 `TRIVIUM_KEEP_FIXTURES=1`，管全部经 helper 建的目录，按调用方各打一行列出路径。
- **`makeFixture`**：只换成 `scratchDir('trivium-fx-', { owner: 'makeFixture', noun: '夹具目录' })`，EV-207 的清单与退出处理整体挪进 `scratch.ts`；`fixture.ts` 从 `scratch.ts` 再导出 `KEEP_FIXTURES_ENV`，FC 组一字未改。
- **改走 helper 的 53 个文件、88 处**：`run-ctx.ts`、`fixture.ts` 两个共享 helper，加 51 个测试文件的 86 处（脚本机械替换 `fs.mkdtemp(path.join(os.tmpdir(), X))` → `scratchDir(X)`，逐文件复数为 0；`report.test.ts` 模块顶层的锁目录用 `scratchDirSync`；`entry-render-parity` 的动态 `import('node:os')` 与 `guard-capability` 的 `nodePath` 写法同样换掉；去掉因此不再使用的 `os` / `fs` 导入）。`task-goal` 的 `tv-goal-` / `tv-goal-lock-` 改名 `trivium-goal-` / `trivium-goal-lock-`。`hooks`、`worker-detach`、`retention`、`zcode-auth-probe` 四个文件里原本就有一部分调用自带 `finally` 删除——整份换、原删除保留（守卫按文件计数，混着裸调用会让新增的一处被已有豁免额度吞掉；目录已被用例删掉时退出收尾 `force` 吞 ENOENT、不误报）。
- **不动的 21 个文件、36 处**：每个目录都在 `finally` 或文件级 `after` 里删、或建在同文件另一个可靠收尾的私有根之下（明细见 §3 的豁免表）；它们大多是 EV-199 / 200 / 204 / 207 刚补过、带权限恢复或私有 `TMPDIR` 的，换成退出收尾会丢掉「本格结束即删」的语义。
- **守卫 `test/unit/scratch-guard.test.ts`**（新）：剥离后逐文件计数，分布必须与豁免表逐项相等。豁免表 = 不动的 21 个文件 + `scratch.ts` 本体 × 2 + 新测试文件 `scratch-cleanup.test.ts` 的私有根 × 1（计划双审三侧同指 r1 漏了这一项），共 **23 个文件、39 处**。

## 3. 用例

| 组 | 格 | 内容 |
| :--- | :--- | :--- |
| SC 行为级（`scratch-cleanup` 集成；子进程 `node --test`，钉私有 `TMPDIR`，去掉 `NODE_TEST_CONTEXT`） | SC1 | 子用例建 7 个（只读子目录、自身只读、已被用例删掉、无手脚、同步版、带尾斜杠的 `TMPDIR`、相对路径的 `TMPDIR` 后再换 cwd），退出后都不在，无「没删掉」「不像」 |
| | SC2 | `TRIVIUM_KEEP_FIXTURES=1`：两个都在，「scratchDir：…保留本进程的 2 个测试临时目录：」与两个路径 |
| | SC3 | `TMPDIR` 只读、两个都删不掉：各打一行（路径与 EACCES / EPERM），子进程仍退 0 |
| | SC4 | 子用例建了目录后故意抛错：退出码非零（失败没被翻成通过），目录照样删 |
| | SC5 | 同进程 `makeFixture` + `scratchDir`：都删；保留时恰两行，`makeFixture` 那行与 EV-207 原文逐字相同 |
| | SC6 | 六个非法前缀（`../x-`、`/abs-`、`foo-`、`trivium-a/b-`，及代码双审后补的形状边界 `trivium-`、`trivium-a`）：`scratchDir` 被拒（`TypeError`）、`scratchDirSync` 同步抛，被拒后零条目；合法的下划线前缀照常建出、退出后删掉 |
| G 守卫（`scratch-guard` 单测） | G0 | 计数自测：注释、字符串、模板串里的提及记 0；`fs.mkdtemp(`、`fs.promises.mkdtemp (`、`mkdtempSync(`、裸 `mkdtemp(`、`makeTempDir(` 各记 1；`scratchDir(` 记 0 |
| | G1 | `test/` 全树（前置断言 > 100；本题落地后 162 个 `.ts`）的分布与豁免表 `deepEqual` |
| FC（EV-207，`fixture-cleanup` 集成） | FC1～FC4 | 一字未改照跑——`makeFixture` 行为与提示逐字不变的证明 |

## 4. 读数

| 项 | 结果 | 留痕 |
| :--- | :--- | :--- |
| 新增与相关用例单跑（`build.mjs --with-tests` 后） | `scratch-guard` 2/2、`scratch-cleanup` 6/6、`fixture-cleanup` 4/4；`tsc --noEmit` 退 0 | — |
| 变异预跑（逐条带超时） | 15/15 咬住，红格与计划预期一致，目标文件逐字节恢复、哨兵已清 | `mutation-spec.r1.json` / `mutation-names-log.r1.txt` / `mutation-names-output.r1.json` |
| 变异装置 | 15/15 咬住 | `mutation-output.r1.txt` |
| 全量 `npm run check` 第 1 次（13:49:37Z～13:54:22Z） | 退 0；2708 / 通过 2706 / 失败 0 / 跳过 2（比 EV-207 收尾时的 2700 多出本题新增的 8 格） | `check-1.txt` |
| `trivium doctor --selftest`（仓库 bundle） | 14/14、退 0，「夹具已清理」 | `doctor-selftest.r1.txt` |
| 全量 `npm run check` 第 2 次（文档定稿后；14:00:10Z～14:04:56Z） | 退 0；2708 / 通过 2706 / 失败 0 / 跳过 2 | `check-2.txt` |
| 代码双审后：单跑三个套件 | `scratch-guard` 2/2、`scratch-cleanup` 6/6（SC6 多了两个边界前缀）、`fixture-cleanup` 4/4；`tsc --noEmit` 退 0 | — |
| 代码双审后：变异预跑与装置（规格与第一轮逐条相同） | 预跑 15/15、装置 15/15 咬住，各条红格数与第一轮相同 | `mutation-spec.json` / `mutation-names-log.txt` / `mutation-names-output.json` / `mutation-output.txt` |
| 代码双审后：全量第 3 次（14:30:56Z～14:35:38Z）、第 4 次（14:35:48Z～14:40:31Z） | 均退 0；2708 / 通过 2706 / 失败 0 / 跳过 2 | `check-3.txt` / `check-4.txt` |
| 代码双审后：`trivium doctor --selftest` | 14/14、退 0，「夹具已清理」 | `doctor-selftest.txt` |
| **验收：系统临时目录新建条目**（`count-new.mjs`，按 `birthtimeMs`） | 四次全量窗口内 `trivium-` / `tv-` 新建依次为 **1、0、1、1 个，全是 `trivium-index-`**（各在开跑后 8～12 秒建，空目录或只有一份 `index`，产品代码在进程被杀时留下，判据单列）；测试自建的前缀四次都是 **0 个**（改前每遍约 1048 个、81 个前缀）。两次自检窗口内都是 0 个。本题全程（13:26Z 开工到第 2 次自检结束，含两轮双审、四次全量、两轮变异、两次自检）合计 3 个，全是上述 `trivium-index-` | `count-new-*.txt`（全程见 `count-new-topic.txt`） |

## 5. 变异明细

| # | 变异 | 期望套件 | 结果（预跑红格） |
| :--- | :--- | :--- | :--- |
| M1 | `scratchDir` 不登记 | `scratch-cleanup` | 红 6（SC1～SC6）；亦跑 `fixture-cleanup` 红 4 |
| M2 | 不挂退出钩子 | `scratch-cleanup` | 红 6；亦跑 `fixture-cleanup` 红 4 |
| M3 | 忽略保留变量 | `scratch-cleanup` | SC2、SC5；亦跑 FC2 |
| M4 | 权限恢复不先 chmod 自身 | `scratch-cleanup` | SC1；亦跑 FC1 |
| M5 | 一个删不掉就中断后面的 | `scratch-cleanup` | SC3；亦跑 FC3 |
| M6 | 防呆的父目录核对取反 | `scratch-cleanup` | SC1、SC3～SC6；亦跑 FC1、FC3、FC4 |
| M7 | 去掉前缀校验 | `scratch-cleanup` | SC6 |
| M8 | `scratchDirSync` 不登记 | `scratch-cleanup` | SC1、SC2 |
| M9 | `makeFixture` 不传主语 | `fixture-cleanup` | FC2、FC3；亦跑 SC5 |
| M10 | 保留提示不按调用方分组 | `scratch-cleanup` | SC5 |
| M11 | `run-ctx.ts` 退回裸 mkdtemp | `scratch-guard` | G1 |
| M12 | `hooks.test.ts` 的 `trivium-hook-` 退回裸 mkdtemp | `scratch-guard` | G1 |
| M13 | 计数不剥离注释与字符串 | `scratch-guard` | G0、G1 |
| M14 | 豁免表少一项 | `scratch-guard` | G1 |
| M15 | 登记时不解析成绝对路径 | `scratch-cleanup` | SC1 |

## 6. 残余

1. 测试进程被信号杀掉时退出钩子不跑，目录照旧遗留（同 EV-207 残余①）。
2. 豁免表里的 23 个文件（含 helper 本体与两个行为级测试文件）靠各自的收尾；守卫只锁「建目录的调用分布」，锁不住它们的收尾日后被改坏。
3. 守卫只认调用形态：字符串里的调用（子进程脚本文本）、解构别名（`import { mkdtemp as m }`）、方括号拼名调用，以及不经 mkdtemp 的固定名目录都看不到；现状都是零（代码双审 codex 在盲区里提到后两种）。
4. 产品代码在测试里建的临时目录不在本题：全量一遍仍会留约 1 个 `trivium-index-`（EV-204 残余五）。
5. 存量未删，由用户定（§8）。

## 7. 代码双审

第 1 轮 run `20261004T140527Z`（三侧到齐，约 22 分钟）：codex（`k3`）`approve-with-nits`、gemini `approve`、glm `approve-with-nits`，2 条吹毛求疵全接受（应答件 `.reviews/单测临时目录收尾/code/`）：

- **CODEX-01**：本报告 §3 的 G1 行照抄了计划时的「159 个 `.ts`」，那是三个新文件建出来之前的数，落地后是 162。已改并注明时点。
- **GLM-01**：前缀正则原为 `^trivium-[A-Za-z0-9_-]*$`，实际放行 `trivium-` 与 `trivium-a`，比本报告 §2 与 BACKLOG 写的「形如 trivium-xxx-」宽（审查件说设计 §17.1 也这么写，核过不是）。取收紧实现：改为 `^trivium-[A-Za-z0-9_-]*[A-Za-z0-9_]-$`，现有 118 个字面前缀与 `cancel-grace-unverifiable` 的模板前缀 `trivium-ev176-〈格名〉-` 全部满足；SC6 补这两个边界。

三侧都独立复核了守卫对账面（codex 用 `stripNonCode` 复算 162 个文件、23 个文件 / 39 处逐项相等）与机械替换（全 diff 扫描加抽读，未见走样）。

## 8. 存量

本题不删存量（决策四）。开工时 `os.tmpdir()` 下 `trivium-` / `tv-` 开头的条目共 165874 个，到第 2 次自检结束只增加 3 个（上面那三个 `trivium-index-`），当时为 165877 个；随后 `verify`（run `20261004T144123Z`，通过）里那遍全量又留下 1 个 `trivium-index-`、同样没有测试自建的，verify 结束时为 165878 个。
