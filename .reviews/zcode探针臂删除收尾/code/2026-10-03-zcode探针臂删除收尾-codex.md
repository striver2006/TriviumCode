---
schema: trivium.review.v1
topic: zcode探针臂删除收尾
stage: code
role: codex
vendor: openai
agent_cli: codex/0.160.0
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20261003T123538Z
rerun_index: 1
snapshot_hash: sha256:ffef3d20013403a4e14ab304c3ac4dae57ccefc82b0cda86f00c8e41ec63d5bf
blind: true
started_at: 2026-10-03T12:35:41.520Z
finished_at: 2026-10-03T12:46:11.849Z
duration_s: 605
tool_calls:
  run_command: 48
  project_reads: 32
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 0
findings_degraded:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a101c3-588a-7b42-b353-d0e3847ddcd8
---

# 代码审查：zcode探针臂删除收尾

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20261003T123538Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **逐条降级**：本侧有 5 条意见不合 schema，单列在「不合格意见」一节，保留原编号、须逐条裁决，但不参与阻断与共同阻断判定。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

按「跨平台与环境耦合 / 资源与生命周期 / 运行环境与依赖版本」三镜头审了本次 EV-198 补丁。补丁本体是干净的：三条探针臂的 finally 裸删改调 `removeZcodeTempDir`，`copy` 由调用方传入后我在三处逐字核对了副本落点与现场查路径是否同形（白名单臂 HOME 就是临时根、`zcodeCliCopyPath(home)` 与实际 `HOME` 环境变量一致；同形臂与 `prepareZcodeHome` 都走 `zcodeCliCopyPath(zcodeHomeUnder(root))`；认证探活与 doctor headless 同），`attempt` 拆法未改判据与返回形状，`residue` 从 try 体提升到外层闭包后按删除那一刻取值正确，`npx tsc --noEmit` 本轮实跑退 0（无诊断），notes 只做直透、doctor 的 warnings/blocker 由显式字段派生而非按 `⚠️` 前缀反推，所以「结论与 blocker/warning 不变」成立；测试 R1～R7、D18/D19 的摆锁、私有 TMPDIR、位置断言与变异 M1～M20 覆盖面扎实。提出的问题集中在本题的**登记面与残留面**：EV-199 按人工枚举登记同族裸删，实测漏了两处形态完全相同的 `finally` 裸删，其中 codex 认证探活那一处的临时目录里是原样拷入的真实 `auth.json`，删不掉时既崩预检又永久残留凭据且没有任何提示；另有 `zcodeCliCopyPath` 的单源声明与代码现况不符、前缀字面人工抄了 21 处、测试夹具向系统临时目录泄漏（本轮实测 6383 个 `trivium-fullcopy-test-*`）未登记。

**结论**：`approve-with-nits`

## 审查意见

合格意见 0 条；本侧另有 5 条意见逐条降级，见下方「不合格意见」。

## 不合格意见（逐条降级，共 5 条）

> 下列意见不合 `trivium.review.v1`：保留原编号、**仍须逐条裁决**（接受要写落点），
> 但**不参与阻断与共同阻断判定**——其中声称 blocker 的，被驳回也不会触发共同阻断告警。

### CODEX-01 · 不合格

**不合格之处**：
- `confidence`：缺失（(根对象) must have required property 'confidence' {"missingProperty":"confidence"}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | major |
| 位置 | doc/08_project/BACKLOG.md 新增的 EV-199 行；未登记的两处：src/trivium/adapters/codex.ts:361（`authProbe.probe` 的 finally）、src/trivium/probes/codex.ts:666（`probeCodexIsolation` 的 finally） |
| 类别 | security ｜ 层次 code |
| 置信度 | （缺失） |

**问题**：本题的主题是「探针臂删除收尾」，EV-199 按人工枚举登记同族裸删（两个 `cleanup` + 五处外层 finally），但同一族的另外两处形态完全相同的点没进清单，于是「同族已数完」这个印象是错的。① `adapters/codex.ts:336` 建 `trivium-codex-auth-` 临时根，`prepareCodexHome`（`adapters/codex-home.ts:315-321`）把用户真实 `auth.json` **原样 copyFile 进去**（只 chmod 0600），finally 是裸 `fs.rm(tmp,{recursive:true,force:true})`——`force` 只吞 ENOENT，ENOTEMPTY/EBUSY/EACCES 抛出顶替 `probe()` 返回值，穿过 `probeAuth`，正是 EV-197 给 zcode 定性的那个「崩成内部错误」；而 zcode 那套三档残留提示与重试是 zcode 专属，codex 这一处删不掉时既没有提示、又把含真实凭据的 auth.json 永久留在系统临时目录。② `probes/codex.ts:1039` 的 `probe.isolation = await probeCodexIsolation(bin)` 在 `probeCodex` 里无兜底，`runDoctor` 的 codex 段（`doctor.ts:628-640`）也没有 try/catch，那里 finally 的裸删抛穿就丢掉本轮 codex 结论、`checkpoint('codex')` 不执行——与 EV-198 给 zcode 三臂定性的后果逐字相同，只是无凭据。

**依据**：实读 `src/trivium/adapters/codex.ts:331-362`、`src/trivium/adapters/codex-home.ts:313-321`、`src/trivium/probes/codex.ts:626-668` 与 `:1039-1042`、`src/trivium/doctor.ts:628-640`；本轮执行 `grep -rn "fs\.rm(" --include='*.ts' src/trivium | grep -v maxRetries` 与 `grep -rn "os\.tmpdir()" --include='*.ts' src/trivium/probes src/trivium/adapters`，两处都在结果里、都不在 EV-199 的清单里；`grep -n "authProbe\|探活" doc/08_project/BACKLOG.md` 通读未见任何条目覆盖 codex 认证探活的删除失败。

**建议**：本题至少把登记面改准：EV-199 的论域不要靠数厂商，写成「按 `grep -rn "fs\.rm(" src/trivium/probes src/trivium/adapters` 排除带 `maxRetries` 的点派生」并把这两处点名（或明写「含 `adapters/codex.ts` authProbe 与 `probes/codex.ts` probeCodexIsolation」）；另为 codex 认证探活单登一条，按 EV-197 同形态修（重试、失败不抛、提示接进 `detail`、含凭据档措辞）。方向上更省的做法是把 `removeZcodeTempDir` 的「重试 + 失败不抛 + 现场查」抽成跨载体共用（`adapters/base.ts` 或 `util/fsx.ts`），别让每个载体各数一遍。是否在本主题动码由 Driver 裁决，但清单不能是数出来的。

### CODEX-02 · 不合格

**不合格之处**：
- `confidence`：缺失（(根对象) must have required property 'confidence' {"missingProperty":"confidence"}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | minor |
| 位置 | src/trivium/adapters/zcode.ts:902-909（`zcodeCliCopyPath` 的 docblock） |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | （缺失） |

**问题**：新注释宣称「`.zcode/cli` 这段布局只在 `ZCODE_CLI_SUBDIR` 一处定义」，与代码现况不符：同一份布局仍有 ≥6 处各写各的字面——`adapters/zcode.ts:886` 的副本源 `path.join(os.homedir(), '.zcode/cli/config.json')`（正好是 `zcodeCliCopyPath(os.homedir())`）、`probes/zcode.ts:75` 的 `ZCODE_CLI_DIR`、`:278`/`:308`/`:326` 的 `path.join(homeDir, '.zcode/cli')`、`:489` 的 `path.join(home, '.zcode/cli/log')`。这句话会让下一个读者以为布局已单源、只需改 `zcodeCliCopyPath`，而真正会随 CLI 版本漂移失效的是探针回读点那几处字面（日志/rollout/v2 都靠它定位），改一漏二不报错、只在运行期表现成「读不到」。

**依据**：实读 `src/trivium/adapters/zcode.ts:536-537`、`:886`、`:902-909`、`:1044-1066` 与 `src/trivium/probes/zcode.ts:74-75`、`:278`、`:308`、`:326`、`:489`、`:663`；本轮执行 `grep -rn "\.zcode/cli\|ZCODE_CLI_SUBDIR" --include='*.ts' src/trivium` 取得上述点位清单。

**建议**：二选一：把 `zcodeCliConfigSource()` 与 `ZCODE_CLI_DIR` 及探针回读点改成经 `ZCODE_CLI_SUBDIR`/`zcodeCliCopyPath` 派生（真正做到单源），或者把这句注释收窄成「副本的写入与删除失败现场查共用这一处定义」，并在 `ZCODE_CLI_DIR` 处留一句「与 `ZCODE_CLI_SUBDIR` 同形、改一处要改两处」的点名。别留一句对不上账的单源声明。

### CODEX-03 · 不合格

**不合格之处**：
- `confidence`：缺失（(根对象) must have required property 'confidence' {"missingProperty":"confidence"}）
- `layer`：取值不合法（/layer must be equal to one of the allowed values {"allowedValues":["requirement","plan","code","rca"]}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | minor |
| 位置 | test/unit/zcode-full-copy-arm.test.ts:25（`tmp`）、:62-67（`writeSrc`）与本次新增的 R1～R6；doc/05_testing/REPORT_2026-10-03_zcode_probe_arm_cleanup.md §3.1 末段 |
| 类别 | test-gap ｜ 层次 test（不合法） |
| 置信度 | （缺失） |

**问题**：报告自己承认「既有的 `trivium-fullcopy-test-*` 夹具一向不清理，系统临时目录里已积累大量此类目录，非本题引入，未处理」，并把它排除在 EV-199 之外（EV-199 只登记 `src` 侧 fixture 的 cleanup）。本轮实测确认这不是「一些」：我这台机器上已有 6383 个此类目录。本题新增的 9 格每格都要调 `writeSrc()`/`tmp()`，于是每跑一轮全量测试净增数十个——而这一族用例的判据恰恰是「按前缀在临时根里数残留」（R1/R2/R3/R4 的 `left`、D10 的 `leftovers`、probes/zcode.ts:960 那句「前缀不得以 trivium-modeloverride 开头，清理用例按那个前缀找残留，并行跑会互相误判」）。判据依赖的目录被持续污染，将来任何按前缀扫**系统**临时目录的用例或人工排障都会读到历史噪声，`mkdtemp` 与 readdir 也会随目录数增长变慢。

**依据**：本轮实际执行：`ls -d "${TMPDIR}trivium-fullcopy-test-"* | wc -l` → 6383；`ls -d "${TMPDIR}trivium-flagprobe-"* "${TMPDIR}trivium-modeloverride-"* "${TMPDIR}trivium-fullcopyarm-"* → 0`（新用例的私有根收尾确实干净，泄漏只来自旧夹具）；读 `test/unit/zcode-full-copy-arm.test.ts:25,62-67` 与 `armInPrivTmp` 的收尾写法、报告 §3.1 末段与 §5 残余栏。

**建议**：不必在本主题重写所有夹具，但请按你们对 EV-199 的同一口径给它一个去处：登一条 BACKLOG（测试夹具的 `tmp()` 无收尾，按前缀扫残留的判据被历史噪声污染），或直接把本题新写的 `armInPrivTmp` 私有根 + finally 整删形态收成一个共用 helper、让 `writeSrc()` 用它。承认而不登记，等于把这条事实留在一份会过期的报告里。

### CODEX-04 · 不合格

**不合格之处**：
- `confidence`：缺失（(根对象) must have required property 'confidence' {"missingProperty":"confidence"}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | nit |
| 位置 | src/trivium/probes/zcode.ts:195,594,961（前缀字面）＋ test/unit/zcode-provider-env.test.ts:545,591,628、zcode-doctor-probe-home.test.ts:591、zcode-auth-probe.test.ts:253 ＋ doc/06_deployment/RUNBOOK_pipeline_op…（全文见 .degraded.json） |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | （缺失） |

**问题**：五个临时目录前缀现在以字面形式散在 21 处（src 3 处 + 测试 6 处 + RUNBOOK 与报告若干）。本题又把 `trivium-flagprobe-`/`trivium-modeloverride-`/`trivium-fullcopyarm-` 三个手抄进 RUNBOOK 的处置行，同时那份文档行只列了 zcode 的五个前缀，而代码里实际还有 `trivium-codex-auth-`、`trivium-codexhome-`、`trivium-probe-`、`trivium-probe-mem-`——「删不掉的临时目录」这件事的完整清单在文档里是靠人数的。改名或再加一条臂时，测试会红（按前缀扫残留）、文档不会（没人对账），最后误导的是照 RUNBOOK 手工删目录的人。

**依据**：本轮执行 `grep -rn "trivium-flagprobe\|trivium-modeloverride\|trivium-fullcopyarm\|trivium-zcode-doctor\|trivium-zcode-auth" --include='*.ts' src test | wc -l` → 21；`grep -rn "makeTempDir(\|fs.mkdtemp" --include='*.ts' src/trivium/probes src/trivium/adapters` 派生出 8 个前缀，RUNBOOK 那一行列了 5 个；读 `doc/06_deployment/RUNBOOK_pipeline_ops.md:279` 与 `src/trivium/probes/zcode.ts:960` 的并行误判注释。

**建议**：两个便宜方向：① 由各 owning 模块导出一份前缀常量（如 `ZCODE_TEMP_DIR_PREFIXES`），测试的 `startsWith` 过滤器与「前缀不得互相包含」那条注释都从它取；② RUNBOOK 那一行不再枚举前缀，只说「提示里给了完整路径（家目录归一 `~`），按那个路径手工删这**一个**目录，不要通配」——路径本来就在提示里，枚举只是多一份会过期的事实。

### CODEX-05 · 不合格

**不合格之处**：
- `confidence`：缺失（(根对象) must have required property 'confidence' {"missingProperty":"confidence"}）

| 项 | 内容 |
| :--- | :--- |
| 严重度 | nit |
| 位置 | src/trivium/probes/zcode.ts:971-981（同形臂 finally 的取档表达式） |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | （缺失） |

**问题**：取档条件写在一行里、语义靠注释支撑：`opts.replace === 'apiKeyOnly' || residue.length > 0`。两个分支的理由并不相同（前者是「这一档的替换面本身不保证副本干净」，后者是「副本已在盘上且扫出疑似凭据」），而 `residue` 是靠 `transformCopy` 的闭包副作用赋值的——这一点在 EV-198 之前不存在（原声明在 try 体内）。以后有人给这臂加新的早退分支（像 `prep.homeDir === null` 那样不写副本就返回），很容易忘了 `residue` 在删除时刻仍被读、把档取歪，而 M6/M7 只咬现有两个条件、咬不住「新增第三条路时档位选错」。

**依据**：读 `src/trivium/probes/zcode.ts:961-985` 与 `attempt()` 内 `transformCopy`（`:1000-1007`）、两处不拉起的早退（`:1010-1013`、`:1023-1030`）；对照变异规格 M6/M7（`doc/05_testing/evidence/zcode-probe-arm-cleanup-20261003/mutation-spec.json`）。这是读码推断，未实测。

**建议**：不必改行为；把取档抽成一个小函数或带名字的量（例如 `residueCopyKind(opts.replace, residue)`），并在同形臂的 docblock 里明写「`residue` 是副本形状的单一事实源、删除时刻仍要读它」，让下一个加早退分支的人有个地方撞上这句话。

## 认为正确的部分

- `removeZcodeTempDir(runDir, who, copy)` 把「查哪里、有的话说哪一档」交给调用方是对的方向：原先写死 `prepareZcodeHome` 布局，白名单臂套用会把有副本说成没有，本题用 `zcodeCliCopyPath` 收成一处并让写盘与现场查共用同一路径，R2 与变异 M4 正好把这一格钉住
- 删除放进外层 `finally`、结论在内部 `attempt` 拼完（与认证探活 EV-197 同形），并且 `removeZcodeTempDir` 自身不会抛（`fs.stat` 走 `.then(onOk, onErr)`），所以 finally 不会再顶替原异常——这条是本题真正要守的不变量，实现成立
- `ENOENT` 才算没有、查不了按有副本说、现场查优先于调用方档位（R6 与 M9 咬住），方向保守、宁可多提醒，符合凭据面处置的取舍
- `credential` 与 null 两档措辞与 EV-197 逐字相同、第三档由 R7 字面钉住，A1/A2/A4 的期望改用枚举档位而不是布尔，可读性与防漂移都变好
- 同形臂把「扫出残余」与 `apiKeyOnly` 收窄档归入 `credential` 档，并同步改准 EV-198 登记里「三处目录里都没有真实凭据」那句失实表述，是诚实的修正
- 报告 §5 与 BACKLOG 残余栏把「拉起/副本准备本身抛错时提示丢失」「提示只在当次可见」写清，没有假装闭环

## 未覆盖范围（本侧盲区）

- 没有执行写操作，也没有重跑 `npm run check` / 变异装置（只读沙箱不允许构建落盘）：报告里「2633 tests / 变异 20/20 / doctor selftest 14/14」的读数我只做了抽查（`npx tsc --noEmit` 本轮实跑、退 0 且无诊断），未复算
- 未拉起真实 ZCode CLI、未验证任何厂商侧行为（0.16.9 的日志/rollout/v2 布局、真实删除失败形态、EBUSY 重试时序），全部结论来自读码与本机文件系统现状
- 未审 claude / agy / codex 三侧探针的其余生命周期改动，只按我的镜头 grep 了临时目录删除点（这正是 CODEX-01 的来源）
- 未复跑 `removeZcodeTempDir` 在真实 EBUSY/EPERM 下的行为；`maxRetries: 3` 只对瞬时错误生效、EACCES 不重试这一格沿袭 EV-197 残余 ③，我没有新证据
- 未逐字节比对 EV-197 与 EV-198 的认证探活/doctor headless 段「输出逐字不变」，只按 `zcodeTempDirResidueText` 的档位映射（credential↔true、null↔false）与 A1/A2/A4/D10/M19/M20 的断言推断
- 未读 `.reviews/zcode探针臂删除收尾/plan/` 下 gemini/glm 的计划双审原文与 `_meta/review-gemini-*`、`review-glm-*`，也未读 `/Users/chenzhenbo/.trivium/runs`（禁读清单）；因此对「计划双审 10 条全接受」中 GLM-04 的原始表述只做引用、未核对
- 未审本次 diff 里 `check-1.txt`/`check-2.txt`/`mutation-output.txt` 等留痕的完整性与是否可被复用（只看它们的存在与文件名口径）

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-10-03_zcode_probe_arm_cleanup.md`
- `doc/05_testing/evidence/zcode-probe-arm-cleanup-20261003/mutation-spec.json`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/codex-home.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/probes/fixture.ts`
- `src/trivium/probes/codex.ts`
- `src/trivium/doctor.ts`
- `src/trivium/util/fsx.ts`
- `test/unit/zcode-auth-probe.test.ts`
- `test/unit/zcode-doctor-probe-home.test.ts`
- `test/unit/zcode-full-copy-arm.test.ts`
- `test/unit/zcode-provider-env.test.ts`
- `.reviews/zcode探针臂删除收尾/code/_meta/changes-20261003T123538Z.diff`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":48,"project_reads":32}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
