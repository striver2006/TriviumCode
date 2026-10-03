# zcode 探针臂删除收尾（EV-198）计划 r1

起点：`4a3d9f3`（`main`，工作树干净）。下文源码行号均取自 `4a3d9f3`。
任务目标见本主题任务文件（用户决策在任务目标里，下文按「决策 一～五」引用）；焦点未给（命令 A `--entry A`）。
全程零配额（决策五）：不跑任何真实 ZCode 调用，三条探针臂用假入口，doctor 层用桩。

## 0. 范围与不做

**做**：

1. 旗标探针 `probeReadonlyFlags`（`src/trivium/probes/zcode.ts:135-256`）、白名单臂 `probeModelOverride`（:546-623）、同形臂 `probeModelOverrideFullCopy`（:866-1004）三处 finally 的裸删改调 `removeZcodeTempDir`：重试三次、失败不抛（决策一）；
2. 删除失败的提示经三个函数的返回值带出，`probeZcode`（:1336-1483）逐臂推进 notes；探针结论不因此改变（决策一）；
3. `zcodeTempDirResidueText` 加第三档「探针副本、凭据已换成哨兵」，「现场查副本在哪」由调用方传入（决策二）；认证探活与 doctor headless 段输出逐字不变；
4. BACKLOG EV-198 改准「三处都没有真实凭据」后结案（决策三）；设计 §11.3 第 7 条补半句、RUNBOOK 删除失败那一行补三个前缀与第三档（决策四）。

**不做**：

- 不改三处的判据与拉起方式（argv、env、超时、killTree、三分判定），不改 doctor 的 blocker 与 warning（决策一）；
- 不改「拉起或副本准备本身抛错」的行为：那是 EV-197 残余 ①（提示随异常丢失）的同形，见 §4；
- 不改探针夹具 `createFixture().cleanup`（`src/trivium/probes/fixture.ts:84`、:134）——它也是裸删，但四侧共用，见 §4；
- 不新登条目，除非双审核出新缺口（决策四）。§4 列出的两处同族形态请审查员判断是否构成新缺口。

## 1. 现状（`4a3d9f3`，已核）

### 1.1 三处临时目录与里面有什么

| 臂 | 建目录 | 副本位置 | 副本内容 | finally |
|---|---|---|---|---|
| 旗标探针 | :192 `makeTempDir('trivium-flagprobe')`，作空 HOME | 无 | 不写任何配置；七次拉起都停在模型层，CLI 可能在 HOME 下写产物 | :253 裸删 |
| 白名单臂 | :580 `makeTempDir('trivium-modeloverride')`，作 HOME | `<临时目录>/.zcode/cli/config.json`（:583-585） | `buildProbeCliConfig`（:369-394）白名单重建：每个 provider 只留 `name/kind/source/enabled/models`，`options` 只留 `baseURL`、`apiKeyRequired` 与哨兵 `apiKey` | :621 裸删 |
| 同形臂 | :928 `makeTempDir('trivium-fullcopyarm')`，HOME 是 `prepareZcodeHome` 给的 `<临时目录>/home` | `<临时目录>/home/.zcode/cli/config.json`（`adapters/zcode.ts:1016-1035`） | 整份拷贝，`transformCopy`（:937-944）写盘前换哨兵，同一回调里算残余扫描 | :1002 裸删 |

三处 finally 都是 `fs.rm(dir, { recursive: true, force: true })`：`force` 只吞 ENOENT，ENOTEMPTY / EBUSY / EACCES 从 finally 抛出、顶替原返回值；`probeZcode` 调三处（:1338、:1383、:1407、:1422，同形臂调两次）没有逐臂兜底，异常一路穿过 `runDoctor`，doctor 崩成内部错误，本轮已探的结论在 checkpoint 之前丢失。

### 1.2 「三处都没有真实凭据」说过头的两支（任务目标现状三 + 本次补核）

- **同形臂扫出残余**（:954-963）：`prepareZcodeHome` 先写盘（`adapters/zcode.ts:1033`）再返回，残余扫描在 `transformCopy` 里算、判定在写盘之后——扫出疑似未替换的凭据时只是不拉起，副本已在盘上，里面可能留着疑似凭据。
- **同形臂 `replace: 'apiKeyOnly'` 档**（:877-885，本次补核）：注释原话「`apiKeyOnly` 档下，不在 `headers` 里、键名又不叫 apiKey 的凭据若不被残余扫描命中，会原样进副本」。doctor 不走这一档（`probeZcode` 不传 `replace`），实验脚本会走；这一档下即使残余扫描为空，副本里也可能有真实凭据。

白名单臂是白名单重建，`options` 只留 `baseURL` / `apiKeyRequired` / 哨兵，不含凭据形态；旗标探针没有副本。

### 1.3 共用删除函数的现状（`src/trivium/adapters/zcode.ts:901-939`）

- `zcodeTempDirResidueText(who, runDir, code, hasCopy: boolean)`：两档，`true` ⇒「其中的 cli/config.json 副本含真实凭据，请手工删除」，`false` ⇒「其中没有 cli/config.json 副本，是本次探测的 CLI 产物，请手工删除」。
- `removeZcodeTempDir(runDir, who)`：删除失败后现场 `stat` 查副本——位置写死成 `path.join(zcodeHomeUnder(runDir), ZCODE_CLI_SUBDIR, 'config.json')`，即 `prepareZcodeHome` 的布局；ENOENT 才算没有，查不了按有说。
- 调用方两处：认证探活（:1153，`'探活'`）、doctor headless 段（`probes/zcode.ts:1639`，`'探针'`）。两处的目录都由 `prepareZcodeHome` 写副本，布局对得上。
- 套到三臂上：同形臂布局对得上；**白名单臂对不上**（副本直接在 `<临时目录>/.zcode/cli/`，不在 `home/` 下），直接套用会把有副本说成没有（任务目标现状四）；旗标探针没有副本，套用后 `stat` 必 ENOENT，结果碰巧对，但语义是「凭空查一个不可能存在的位置」。

### 1.4 返回形状

- `probeReadonlyFlags` 返回 `{ accepted, rejected, indeterminate, zeroExit }`（:139-152）；
- `ModelOverrideProbe`（:426-440）、`FullCopyOverrideProbe extends ModelOverrideProbe`（:847-851）；
- 都没有地方带一条删除失败的提示（任务目标现状五）。`probeZcode` 的两个测试注入口 `modelOverrideProbe` / `modelOverrideFullCopyProbe` 的桩（如 `test/unit/zcode-doctor-probe-home.test.ts` 的 `ARM_STUBS`）只给部分字段。

## 2. 方案

### 2.1 措辞：第三档（决策二）

`zcodeTempDirResidueText` 第四个参数由 `hasCopy: boolean` 改为 `copy: ZcodeTempDirCopyKind | null`，`ZcodeTempDirCopyKind = 'credential' | 'sentinel'`：

| `copy` | 措辞（接在「⚠️ {who}临时目录删除失败（{code}）：{路径} 仍在，」之后） |
|---|---|
| `'credential'` | 其中的 cli/config.json 副本含真实凭据，请手工删除（与原 `true` 逐字相同） |
| `'sentinel'` | 其中的 cli/config.json 是探针副本、凭据已换成哨兵，仍请手工删除（**新增**） |
| `null` | 其中没有 cli/config.json 副本，是本次探测的 CLI 产物，请手工删除（与原 `false` 逐字相同） |

不保留布尔重载：调用方只有本仓两处与测试，一并改，免得 `true` 与 `'credential'` 两种写法并存。

### 2.2 删除函数：副本位置与档位由调用方传入（决策二）

```
removeZcodeTempDir(runDir, who, copy: { path: string; kind: ZcodeTempDirCopyKind } | null)
```

- 删除照旧只删 `runDir`（mkdtemp 的返回值），`maxRetries: 3`、失败不抛、成功返回 null；
- `copy` 为 null（旗标探针：从不写副本）⇒ 删除失败时不查、直接取 `null` 档；
- `copy` 非 null ⇒ 删除失败后现场 `stat(copy.path)`：ENOENT ⇒ `null` 档；存在或查不了 ⇒ `copy.kind` 档（「查不了按有说」的取向不变）；
- 新增导出 `zcodeHomeCopyPath(runDir)` = `path.join(zcodeHomeUnder(runDir), ZCODE_CLI_SUBDIR, 'config.json')`，`prepareZcodeHome` 写副本处改用它算路径，认证探活与 doctor headless 段传 `{ path: zcodeHomeCopyPath(runDir), kind: 'credential' }`——副本布局只有一处定义，两处既有调用的输出逐字不变；
- `copy.path` **只用于 stat、不用于删除**：删除面仍只有 `runDir`，2026-09-20 事故后的规矩不变。

### 2.3 三臂改法（决策一）

统一照认证探活 EV-197 的形态：结果在内部 `attempt` 里拼完，删除放在外层 finally、失败不抛，删除失败时把提示挂到返回值上。

- **返回形状**：`probeReadonlyFlags` 返回值加 `tempDirResidue: string | null`；`ModelOverrideProbe` 加可选 `tempDirResidue?: string`（只在删除失败时出现；可选是为了不动两处测试注入口的既有桩，`FullCopyOverrideProbe` 经继承得到）。
- **旗标探针**：try 体里没有 return，不必拆 `attempt`；finally 改为 `residue = await removeZcodeTempDir(emptyHome, '探针', null)`，return 带上它。
- **白名单臂**：副本路径在 try 之前算成一个常量 `copyPath = path.join(home, '.zcode/cli', 'config.json')`，写盘与删除共用；try 体原样收进 `attempt`；finally 传 `{ path: copyPath, kind: 'sentinel' }`。
- **同形臂**：`residue` 的声明从 try 内挪到 try 外（`transformCopy` 照旧在写盘前给它赋值）；try 体原样收进 `attempt`；finally 传 `{ path: zcodeHomeCopyPath(root), kind }`，其中 `kind = opts.replace === 'apiKeyOnly' || residue.length > 0 ? 'credential' : 'sentinel'`——
  - 扫出残余那一支（§1.2 第一条）取「含真实凭据」，宁可多提醒（决策二）；
  - `apiKeyOnly` 档（§1.2 第二条）同取「含真实凭据」：这一档的零配额与无凭据保证本来就弱于 `full`，按它的注释原话，残余扫描为空也不能断言没有；
  - `kind` 在 finally 里按**当时**的 `residue` 算，所以 `prepareZcodeHome` 写盘后抛错（`chmod` 失败等）的路径也按扫描结果取档，不按「走到了哪一支」推断；`transformCopy` 没跑到时 `residue` 为空、副本也不存在，现场 stat 得 ENOENT ⇒ `null` 档。
- **结论不变**：`attempt` 的返回值原样透出，只在删除失败时多一个 `tempDirResidue` 字段；判据、`why`、`override`、`runtimeSelected` 一字不动。

### 2.4 probeZcode 推 notes（决策一）

在每次臂调用之后、紧跟该臂既有 note 推一条：

- 旗标探针：:1338 调用后、旗标结论 note 之后（:1374 之后）`if (flags.tempDirResidue) notes.push(...)`；
- 白名单臂：:1389-1394 那条 note 之后；
- 同形臂原样支：:1412-1417 那条 note 之后；
- 同形臂置首支：:1422-1426 调用之后（这一支没有自己的 note，只推残留提示）。

提示原样推，不加前缀：措辞里已有「探针临时目录」与完整路径，路径里的前缀（`trivium-flagprobe-` / `trivium-modeloverride-` / `trivium-fullcopyarm-`）足以分辨是哪一臂。doctor 的 blocker、warning、退出码、结论 schema 都不动。

### 2.5 文档（决策三、四）

- BACKLOG EV-198：改准「三处都没有真实凭据」（同形臂扫出残余与 `apiKeyOnly` 两支可能有），置 done、写结案摘要与读数；
- 设计 §11.3 第 7 条末尾「静默失败收口」那句后补半句：旗标探针与两条模型覆盖臂的临时目录删除同样走 `removeZcodeTempDir`，提示按「没有副本 / 探针副本凭据已换哨兵 / 可能含真实凭据」三档、副本位置由调用方给出；版本记录加 v1.3.80 一行；
- RUNBOOK `doc/06_deployment/RUNBOOK_pipeline_ops.md:279`：前缀补 `trivium-flagprobe-`、`trivium-modeloverride-`、`trivium-fullcopyarm-`，措辞补第三档「探针副本、凭据已换成哨兵」的处置（同样建议手工删）；
- 测试报告 `doc/05_testing/REPORT_2026-10-03_zcode_probe_arm_cleanup.md`，证据 `doc/05_testing/evidence/zcode-probe-arm-cleanup-20261003/`。

## 3. 验证（决策五，全程零配额）

### 3.1 单测

摆「删不掉」的方式沿用 EV-197 的教训：要锁住**副本所在的** `cli/` 目录；锁兄弟目录时递归删除并行进行、顺序不定，副本可能先被删掉。

- **R1 旗标探针**（`test/unit/zcode-provider-env.test.ts`，假入口加 `FAKE_LOCK`：在 `$HOME` 下建只读子目录放一个文件，七次拉起幂等）：不抛；`accepted/rejected/indeterminate` 与不锁时相同；`tempDirResidue` 以「⚠️ 探针临时目录删除失败（EACCES）」开头、取「没有副本」档、路径含 `trivium-flagprobe-`。
- **R2 白名单臂**（假入口在 `$HOME/.zcode/cli` 写完 v2 之后把 `cli/` 改只读）：不抛；`override / observed / why` 与不锁时相同；提示取「探针副本、凭据已换成哨兵」档。**这一格专咬 §1.3 的布局错位**：若删除函数仍按 `prepareZcodeHome` 布局查，会得 ENOENT、说成「没有副本」。
- **R3 同形臂正常支**（同上，锁 `<临时目录>/home/.zcode/cli`）：不抛、结论相同、取「探针副本」档。
- **R4 同形臂扫出残余支**：这一支不拉起，子进程摆不了锁。给同形臂加一个测试注入口 `removeTempDir?: typeof removeZcodeTempDir`（与 `probeZcode` 的 `invoke` / `modelOverrideProbe` 同理），用例的包装先把 `copy.path` 所在目录改只读、再调真实的 `removeZcodeTempDir`、最后解锁——走的仍是真实删除与真实措辞，只是锁的时机由用例掌握。断言：不抛、`override` 为 null、`why` 照旧列出残余路径、提示取「含真实凭据」档、注入口收到的 `copy.kind` 是 `'credential'`。
- **R5 同形臂 `apiKeyOnly` 档**：同 R3 的锁法，`replace: 'apiKeyOnly'` 且副本无残余 ⇒ 取「含真实凭据」档。
- **R6 现场查优先于调用方档位**：同形臂残余支，包装里锁目录前先删掉副本 ⇒ 取「没有副本」档（`kind` 只决定「有副本时说哪一档」）。
- **R7 措辞三档逐字**：`zcodeTempDirResidueText` 三档输出钉字面；`'credential'` 与 `null` 两档与改前 `true` / `false` 逐字相同（字面写死在用例里，不由函数自比）。
- **D18 接线**（`test/unit/zcode-doctor-probe-home.test.ts`）：两个臂桩各返回一条 `tempDirResidue`，同形臂桩按 `variant` 返回不同字面，假入口锁旗标探针的 HOME ⇒ `probeZcode` 不抛，notes 里四条提示各出现一次、顺序与 §2.4 一致；`readonly_flags`、`model_override`、`model_override_full_copy` 按桩照常写入；臂桩不给 `tempDirResidue` 时 notes 不多出任何「临时目录删除失败」行。
- **D19 doctor 不崩**：同 D18 的锁法跑 `runDoctor`（只探 zcode），退出码与不锁时相同、不抛内部错误，结论文件照常 checkpoint。
- **既有用例照绿**：认证探活 A1～A4、doctor headless 段 D10～D10d（`zcodeTempDirResidueText(..., true)` 的调用改为 `'credential'`，断言的字面不改）、三臂的既有清理用例（「临时根跑后被清」）。
- 单跑前一律 `node scripts/build.mjs --with-tests`，核用例总数含新增的那几格（坑清单）。等桩触发的 Promise 一律带超时；锁一律在 finally 里解开。

### 3.2 变异

照上一题 `evidence/zcode-probe-silent-fail-20261003/` 的 `gen-mutation-spec.mjs` 生成规格（find 锚点从源码截、核唯一，替换串扫一遍特殊替换模式），先用带 `--test-timeout` 的逐条预跑脚本过一遍，再跑装置。计划中的变异（编码后按实际源码定稿）：

1. 三臂 finally 各自退回裸删（3 条）⇒ R1/R2/R3 红；
2. 白名单臂传 `prepareZcodeHome` 布局的路径 ⇒ R2 红；
3. 白名单臂 `kind` 改 `'credential'` ⇒ R2 红；
4. 同形臂 `kind` 恒取 `'sentinel'`（丢残余条件）⇒ R4 红；丢 `apiKeyOnly` 条件 ⇒ R5 红；
5. 旗标探针传非 null 的 `copy` ⇒ R1 红（档位错）；
6. `removeZcodeTempDir` 删除失败后不现场查、直接取 `copy.kind` ⇒ R6 红；
7. `probeZcode` 四处推 note 各删一处（4 条）⇒ D18 红；
8. 三臂丢掉 `tempDirResidue`（删除失败时照旧返回原对象）⇒ R1～R3 红；
9. 第三档措辞改字 ⇒ R7 红；
10. `zcodeHomeCopyPath` 改错层级 ⇒ 认证探活 / D10 系列红。

### 3.3 全量与自检

全量检查两次（串行，一次只发一条，输出直接重定向到文件、`echo exit=$?` 取真实退出码，发前 `pgrep` 确认无残留）、doctor 自检。已知偶发红（lock-cross-process、state.test「并发 setGate 不丢更新」）单跑复核后如实记录。

## 4. 已知残余与请审查员判断的两处

1. **拉起或副本准备本身抛错时，删除失败的提示随异常丢失**：与 EV-197 残余 ① 同形（认证探活与 doctor headless 段同样如此）。三臂里 `run()` 不抛（spawn 失败落成 `code: null`），可抛的是同形臂的 `prepareZcodeHome`（写盘 / `chmod` 失败）——那时异常本身照旧穿过 `probeZcode` 崩掉 doctor，这是「副本准备失败」而非「删除失败」，不在 EV-198 的论域。本题让删除不再**顶替**原异常，不再多造一种崩法。
2. **探针夹具 `createFixture().cleanup` 也是裸删**（`fixture.ts:84`、:134）：`probeZcode` 末尾 :1645、以及 agy / claude / codex 三侧探针各一处调用。夹具里没有凭据（只有哨兵文件与一个假 `.env`），但删除失败同样会抛穿 `runDoctor`。四侧共用、越出「zcode 三臂」的范围，本题不改；它是否该另登条目，请审查员判断（决策四：双审核出才登）。
3. **提示只在当次 doctor 可见**：同 EV-86 / EV-197 残余 ② 形态，不在本题处理。
4. **EV-86 的触发条件**：它写的是「下一次改动 `probeReadonlyFlags` 或 `availability()` 的**旗标判据**」。本题只改旗标探针的删除收尾，不动判据，按条目原意不触发，EV-86 维持暂缓。
