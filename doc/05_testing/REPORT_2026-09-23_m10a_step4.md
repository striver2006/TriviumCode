# M10a 第 4 步测试报告 · 登记清理（EV-62 / EV-64 / EV-07）

- **日期**：2026-09-23
- **依据**：`.reviews/M10a-第4步/plan/2026-09-23-M10a-第4步-r3-claude.md`（下称「r3」）。
  - 计划双审两轮：r1 13 条，接受 11、驳回 1、暂缓 1；r2 9 条，全部接受。两轮均已获批。
  - 用户审批 r3 后裁定「直接开工」，r3 未再送计划双审。
  - 上位依据：M10 计划 r7 §5 / §8。
- **基线**：HEAD `21f189a`，加上本步工作区改动。
- **本报告存在的理由**：r3 §5.3 要求的全量回归、变异结果、偏差与缺口都记在这里。代码双审（回到 `M10-任意Driver`）以本报告为改动说明。

---

## 0. 全量回归

| 项 | 结果 |
| :--- | :--- |
| 改动前基线（开工第一件事复跑） | **1694 条：1692 通过 / 0 失败 / 2 跳过**，与第 3 步报告一致 |
| `npm run typecheck` | 通过 |
| `npm run build` 与 `node scripts/build.mjs --tests-only` | 通过 |
| `npm test`，第一次 | **1703 条：1700 通过 / 1 失败 / 2 跳过**。失败的是接入套件「加桩之后类型层依然自洽（tsc --noEmit）」，详见 §2 偏差 1 |
| `npm test`，修夹具后 | **1703 条：1701 通过 / 0 失败 / 2 跳过**。比基线多 9 条：U2、U3、U4、U5 ②、U6、U8、U9、D3、D4。已逐条核对这 9 条新用例名与改名后的 U1、U7 各在输出里出现一次，旧用例名「isHeterogeneous 的两个写点都要配 override_reason」出现 0 次，排除跑的是旧 `dist/test` 的可能 |
| `grep -n inferLatestRunId src test` | 只剩三类：历史叙事（`meta.ts` 两处、`cli.ts` 一处、`driver-wiring` 注释一处）、既有断言的文案，以及 U9 自身 |
| `git diff -- skills/dual-critic/schema/disposition.v1.json src/trivium/types.ts` | 为空。EV-07 两件都没有动这两个文件 |
| `npm run install:local` | 已执行。执行前逐个 `diff -rq skills/<d> ~/.claude/skills/<d>`（8 个 skill）并比对 Antigravity agent 定义：只有 `dual-critic/scripts/trivium.cjs` 内容不同，没有文件增删。装完复核，9 项逐字节一致 |
| `trivium doctor --selftest` | **14/14 通过**。自检各侧走桩，**不覆盖非缺省 Driver 下的 `heterogeneous` 取值**，见 §3 |
| 代码双审 r5 修订后（§4） | `npm test` **1703 条：1701 通过 / 0 失败 / 2 跳过**。用例条数不变：U6 只多一条断言，没有新用例。D1～D4 与 U6 在输出里核对过。改后按规程先 `diff -rq`（只有打包件内容不同、无文件增删），再 `install:local`，装完 8 个 skill 与 agent 定义逐字节一致；`doctor --selftest` 复跑 14/14 通过 |

---

## 1. 变异验证

### 1.1 装置跑的 11 条

**方法**：

- 规格按 r3 §6 逐字写成，由 `scripts/mutation-check.mjs` 执行。本步给装置新加的闸 7 在开跑前核过 11 条 find 都恰好命中一处；
- 套件：`adapter-base.test` / `driver-wiring.test` / `render.test`；
- 基线全绿；跑完哨兵已删，工作树没有残留（`git status` 只有本步的改动）。

| id | 变异 | 期望变红 | 期望条数 | 结果 |
| :--- | :--- | :--- | :--- | :--- |
| M62a | `isHeterogeneous` 退回 `!/claude/i.test(model)`，不感知 Driver | U2、U3、U5 ② | adapter-base 3 | ✓ 咬住（fail=3） |
| M62b | 写点 A 厂商实参 → `agentById(DEFAULT_DRIVER)!.vendor` | U7 | driver-wiring 1 | ✓ 咬住（fail=1） |
| M62b′ | 写点 B 厂商实参 → `'anthropic'` | U7 | driver-wiring 1 | ✓ 咬住（fail=1） |
| M62c | 写点 A 的 `overrideReasonFor` 末参 → `DEFAULT_DRIVER` | U7 | driver-wiring 1 | ✓ 咬住（fail=1） |
| M62f | `overrideReasonFor` 函数体内厂商实参 → `'anthropic'` | U7 | driver-wiring 1 | ✓ 咬住（fail=1） |
| M62d | U7 厂商锚点退回「只看有无第二实参」 | U8 | driver-wiring 1 | ✓ 咬住（fail=1） |
| M62d′ | U7 末参锚点退回「只看有无第五实参」 | U8 | driver-wiring 1 | ✓ 咬住（fail=1） |
| M62e | 同源旗标文案退回「本侧使用了 Claude 系模型」 | U6 | render 1 | ✓ 咬住（fail=1） |
| M64a | `cli.ts` 闸门区加回一行裸调用 | 既有「闸门区」用例 + U9 | driver-wiring 2 | ✓ 咬住（fail=2） |
| M64b | `gate.ts` `verifyRoundForApproval` 内加回一行裸调用 | U9 | driver-wiring 1 | ✓ 咬住（fail=1） |
| M64c | `gate.ts` 末尾加回函数定义（不接调用） | U9 | driver-wiring 1 | ✓ 咬住（fail=1） |

需要说清的几点：

- **装置只报每个套件的失败条数，不报用例名。** 11 条的实跑条数与期望逐条相符，但逐条归因仍是**推断**，不是逐条核实的。
- **M62a 现实中会先被 typecheck 拦下**：参数 `driverVendor` 不再被读，会触发 `noUnusedParameters`。装置不跑 tsc，所以装置里的变红只归因于用例。
  **M62f 选的形态 typecheck 拦不住**：`driver` 形参仍被 `desc.display` 读取。这正是 r2 CODEX-01 要补的那一格。
- **M64a / M64b 是源码文本层的复活**：裸调用不带 import，打包时按自由变量处理，构建能过；运行时该名不存在。它们验的是源码判据，不是运行时行为。
- **M64b 只证明 U9 的论域覆盖到 `gate.ts`**。U9 是全 `src/trivium` 的名字判据，裸调用落在 gate.ts 的哪个函数都一样红，所以它不证明「闸门区某一处」。
  锚点没有用 `const runMeta = await readRunMeta(layout, stage, runId);`：它在 gate.ts 里出现 2 次，闸 7 会拒跑。计划双审 r2 核出这一点，正好说明闸 7 有用。
- **M64c 加回的定义比原函数略简**（把 front-matter 取值合成了一行）。它只是源码文本层的定义复活，简化不影响 U9 的判定。

### 1.2 手工做的 2 条（装置自身）

装置是 `.mjs`，不进构建，没法用它自己来做变异，所以按 D1 / D2 的先例手工做。做之前把装置文件和 D3 的夹具目标 `README.md` 备份到会话临时目录并记下哈希。

| id | 变异 | 期望 | 结果 |
| :--- | :--- | :--- | :--- |
| M-D3 | 让闸 7 的拒跑分支永不成立 | D3 红 | **✓ D3 红**，红在承重的 stderr 断言上（「要点名多处命中的那条及其命中数（8）」）；D4 仍绿，符合预期 |
| M-D4 | 把哨兵只读预检挪到闸 7 之后，即闸 7 抢在预检前面 | D4 红 | **✓ D4 红**（「要报的是上次没善终」）；D1、D3 仍绿，符合预期 |

**收尾**（r3 §3.5）：

- 两条跑完，仓库根都没有残留哨兵；
- `README.md` 与装置文件的哈希都与备份一致；
- `git status` 没有多出本步以外的改动。

**如实说明**：M-D3 下装置真的跑完了一遍。它建了哨兵、构建、跑基线套件，对 `README.md` 做了变异，再由闸 5 恢复，收尾时重建并删掉哨兵。整轮 408ms，没有触及 D3 的 60s 超时。
这正是 r3 §3.5 说的「条件性断言」那种情形：装置干净跑完时，「不留哨兵」「目标文件哈希不变」照样绿；本次变红只靠 stderr 断言。

---

## 2. 与 r3 的出入（如实登记）

| # | r3 怎么写 | 实际怎么做 | 为什么 |
| :--- | :--- | :--- | :--- |
| 1 | 落点清单没有接入套件 | **改了 `test/fixtures/stub-agent-kit/overlay.ts`**：在第 ① 件（注册项）里给桩厂商补一条 `VENDOR_MODEL_FAMILY` 映射；`KIT_WHITELIST` 第 ① 件的说明补「厂商名义模型族」 | 第一次 `npm test` 时，接入套件「加桩之后类型层依然自洽」这条红了：套件往 `AgentVendor` 加了第五个厂商，而 `VENDOR_MODEL_FAMILY` 以 `Record<AgentVendor, …>` 声明，漏登记即编译报错。**这正是 r3 B2 说的效果，这次由一条端到端用例实测证明了**。r3 没预见到接入套件要跟着补一条，所以登记为偏差。第 ① 件的触及路径没变（仍是 `registry.ts`），白名单无需加条目。`doc/08_project/M9-交底.md` 里同一张清单的旧表述是历史交底，不改 |
| 2 | §3.5 闸 7「对每条 case 读基线文件，数命中数」 | 另加两处兜底：目标文件读不出时，报「目标文件读不出来」并归入同一批规格错误；`find` 不是非空字符串时按 0 处计 | 不加的话，路径写错的规格会在 `try` 之外直接抛异常，临时目录也会残留。两处都走拒跑，没有新增放行路径 |
| 3 | §2.5 U7 判函数体内 `desc` 的来源与厂商实参 | 另加一条：参数表须含 `driver: AgentId` | 函数体判据按名字认 `desc` 与 `driver` 的对应（r3 已登记的边界），先确认形参在。它只收紧，不放宽 |
| 4 | 未提及 | `mutation-device.test.ts` 头注释补一段，说明 D3 / D4 同样走拒绝路径；另外 D1 / D4 会在仓库根临时放一个哨兵作夹具，由 `finally` 清理 | 原注释写「这两条」，已不准确 |
| 5 | §4.1 状态列「改为 `done`」 | EV-62、EV-64 也用 `done`，结案段写作「【2026-09-23 done · M10a 第 4 步】」 | 与 EV-07 同批、同口径。BACKLOG 状态列图例里 `done` 即已落地 |
| 6 | §6 变异规格 | 规格与生成脚本收进 `doc/05_testing/evidence/m10a-step4-mutation-20260923/`（`mutation-spec.json` 与 `gen-spec.mjs`），可直接重跑 | 初稿时规格只在会话临时目录里。核对 `git ls-files`，仓库里此前没有任何一份被跟踪的变异规格，第 3 步的提交 `21f189a` 里也没有。用户裁定本步起收进 evidence。**入库后对代码双审 r5 修订后的源码重跑了一遍**：闸 7 放行（11 条 find 各恰好命中一处），11 条全部咬住，条数与 §1.1 逐条一致，收尾无残留 |
| 7 | §2.3「`agentById(driver)!` 的非空断言依赖『入口已经拦过』：入口经 `resolveDriver` 判定过已登记」 | 注释改为真正生效的那一条：run.v2 校验（`validateRunMeta` → `checkAgentIdentities`）。同步路径在 `writeRunMeta` 落盘前，worker 路径在 `readRunMeta` 读回时 | **r3 这句前提写错了，代码双审 r5 CODEX-01 纠正**：worker 分支在 `cmdReview` 里直接进 `workerMain`，根本不经过 `resolveDriver`。结论（断言今天安全）没错，依据指错了地方，与第 3 步 r4 GLM-02「说对结论、说错依据」同族。取「改注释」，不取结构性改法：U7 按字面钉着 `const desc = agentById(driver)!;`，结构改法会连带改动判据锚点 |

另记两笔：本步实施与计划双审期间，撞上**三次已登记的 Bash Hook 误拦**，都是改写命令了事，没有绕判定：

- 两次 grep：模式里有 `>`，命令又提到元数据目录；
- 一次 `node -e`：写了箭头函数。

**台账**：两轮计划双审的收尾台账行都在闸门期被 Hook 拦下，审批后补记。

---

## 3. 没补的缺口

- **EV-62 的判据两层都是启发式，不是确定性保证。** 模型族按模型名判，Driver 的族按厂商名义族近似：编排器不采集 Driver 的生效模型。
  `heterogeneous: true` 的准确读法是「未检出同族」。已知会错的形态按本机模型目录的可达性登记在 **EV-107**：
  - driver=codex 时，gemini 审核者经显式覆盖跑 `gpt-oss-120b-medium` 会被判同族，这一格可达；
  - driver=codex 而审核者跑 qwen，按本机目录不可达。
- **没有端到端用例验证非缺省 Driver 下 `run.json` 与审查文档里的 `heterogeneous` / `override_reason` 取值。**
  现有覆盖由两部分拼成：纯函数单测（U1～U5），加上源码接线判据（U7 / U8，钉住两个写点与函数体的取值来源）。`doctor --selftest` 与既有集成用例都不断言这两个字段在非缺省 Driver 下的实际值。
  不补的理由：写点的取值来源已由源码判据钉住，而补一条集成用例要让桩侧报出一个与桩 Driver 同族的模型名，超出本步范围。**这是一处真实的覆盖空白，不是「低风险」**。
- **U7 钉的是一种字面写法**：语义等价的写法也会红，这是刻意的。它只证「取的是 `meta.driver`」，`meta.driver` 是否就是当轮 Driver 由 `TARGETS` 的 `newRunMeta` 锚点承接；函数体内 `desc` 与 `driver` 形参的对应只按名字认。
- **U9 是名字判据，只防原名复活。** 改名后的同形实现，只有接进 run_id / driver 才有害，而这两个值在 `cli.ts` 与 `gate.ts` 里各有取值判据。
- **D3 的「不留哨兵」「目标文件哈希不变」是条件性判别**：只在装置那一轮留下脏状态时才红。M-D3 实测正是干净跑完、这两条照绿的情形。
- **哨兵只读预检与独占创建之间的并发窗口**由 `wx` 兜住，**没有用例**：构造并发开跑的成本高于本步范围。
- **设计与需求文字与代码不一致**，要到第 5 步回溯完成：PRD FR-17 / AC-18、主设计四处、演进设计 §5、`README.md:89`、验收剧本 `CASE_manual_acceptance.md` `:207` 与 `:211-213`（已追加进 **EV-106**）。**验收剧本那两处须在 M10b 真载体验收之前改**。
- **历史留痕里的旧 `override_reason` 文案**（「落在 Claude 系」）不回改：本步之后的新运行写「与当轮 Driver（…）同族」，两种说法并存。
- **变异的逐条归因是推断**，见 §1.1。
- **变异规格的 find 串钉的是本步提交时的源码**：之后源码改动使某条不再恰好命中一处时，闸 7 会拒跑并点名，那时要按当前源码更新生成脚本（§2 偏差 6）。

---

## 4. 代码双审 r5 的修订

运行 `20260923T125723Z`：gemini `approve`，codex 与 glm `approve-with-nits`；5 条全部接受并获批。应答件为 `.reviews/M10-任意Driver/code/2026-09-23-M10-任意Driver-r5-response-claude.md`。

| 意见 | 改了什么 |
| :--- | :--- |
| CODEX-01 | `review.ts` `overrideReasonFor` 文档块：非空断言的前提改为 run.v2 校验（两条路径各在哪一处），并写明「入口的 `resolveDriver`」对 worker 路径不成立（§2 偏差 7） |
| CODEX-02 | `scripts/mutation-check.mjs` 闸 6、闸 7 的注释标题与拒绝文案共 4 处：「任何写盘之前」改为「任何工作树写盘之前」。临时备份目录的 `mkdtemp` 排在两道闸之前、拒绝时即删；早先轮次叙事里的两处是历史原文，不改 |
| CODEX-03 | `render.ts` 同源旗标标题改为「**疑似与主脑同源**」：这一格是按模型名的检出，不是证明。U6 补一条断言锁住「疑似」 |
| GLM-01 | BACKLOG EV-62 结案段「变异 7 条」改为「8 条」。M62 系是 8 条，8 + 3 = 11，与本报告 §1.1、README 一致；写成 7 是我数错了 |
| GLM-02 | 装置头注释标题「五道闸」改为「七道闸」，并注明原题是闸 6、闸 7 补入前的数；`mutation-device.test.ts` 头注释的引用改为「那张闸表」。第 3 步与 M9 两份历史报告里的「五道闸」是当时的原文，不改 |

**修订本身不要求重跑变异装置**：5 条都是注释、文案与留痕数字的修正，判据没有变化。（规格入库时仍对修订后的源码重跑了一遍，11 条全部咬住，见 §2 偏差 6。）U6 新增的「疑似」断言是文案锁，不单独设变异。装置文件只改了注释与拒绝文案，D1～D4 复跑全绿：D2 断言的是「不在 targets 里」，D3 断言的是「find 命中 N 处」，都不含被改的字样。
