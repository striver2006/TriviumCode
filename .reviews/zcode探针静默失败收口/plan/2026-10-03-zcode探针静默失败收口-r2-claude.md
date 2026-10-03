# zcode 探针静默失败收口（EV-196 + EV-197）计划 r2

起点：`ee4ac5b`（`main`，工作树干净）。下文源码行号均取自 `ee4ac5b`。
任务目标见本主题任务文件（用户决策在任务目标里，下文按「决策 一～五」引用）；焦点未给（命令 A `--entry A`）。
全程零配额（决策五）：不跑任何真实 ZCode 调用，doctor 层与认证探活都用桩或假入口。

r2 相对 r1 的改动（计划双审第 1 轮 run `20261003T063541Z`，7 条全接受，裁决见 `…-revised-claude.md`）：
§1.2 一句改写（CODEX-01）；§3.1 共用函数按「有无副本」分两档措辞（GLM-02）；§3.3 改写、§3.4 新增两条已知残余（GLM-01、CODEX-02）；§4.1 字面断言保留、认证探活装置钉 `TMPDIR`、副本支前提写明、加 A4（CODEX-03、GLM-03、CODEX-04、GLM-02）；§4.2 加 M15、M16；§6 R1 定案、R5 改写、加 R6。

## 0. 范围与不做

**做**：

1. **EV-196**（决策一）：`probeZcode`（`src/trivium/probes/zcode.ts:1130`）多带出一项「本轮进了真实调用段、但 `response_field` 没被刷新」的过程事实（哪一支、哪几项结论沿用旧值），不落盘；doctor 的 zcode 段（`src/trivium/doctor.ts:554-606`）据此出一条 **warning**，不拦。
2. **EV-197**（决策二）：认证探活 `authProbe.probe()`（`src/trivium/adapters/zcode.ts:1092-1155`）的临时目录删除改为重试三次、失败不抛，失败时把残留提示接在探活详情末尾；删除与措辞抽成一个共用函数，doctor 侧（`probes/zcode.ts:1577-1588`）改调同一个函数，doctor 副本支的 note 逐字节不变。

**不做**（决策三）：

- 不改 `ZCODE_HEADLESS_NOT_OK_HINT` blocker 的判据（仍是 `response_field === null && !skipModelCalls`）、不改 doctor 退出码、不改 `ZcodeProbe` 结论的 schema（不落盘任何新字段）；
- 不取出路二（失败时把 `response_field` 置 null）：一次临时失败就会拦下全量 doctor，并让 `availability()` 判该侧不可用、预检随之拒跑，力度过头；
- 不改审查运行 `run()`、旗标探针、三条模型覆盖探针臂、`probePathDeny` 本体；
- 不改 TTL 与探活缓存口径、不改 `probeAuth` 的结构（`preflight.ts:699-740`，仍无兜底——本题让 `probe()` 自己不因删除失败而抛，而不是在调用方兜）；由此留下的两条残余见 §3.4；
- 不改「拉起本身抛错」的行为（`invokeZcode` 抛出时原样上抛，doctor 用例 D5 锁着）。

## 1. 现状（`ee4ac5b`，已核）

### 1.1 probeZcode 的返回与真实调用段

- 返回形状 `{ probe, notes, flagsIndeterminate, flagsZeroExit }`（:1158），共 5 处 `return`（:1209 入口缺失、:1436 跳过真实调用、:1470 副本源失败、:1503 headless 失败、:1595 正常收尾）。
- `probe` 以 `existing` 的 `structuredClone` 为起点（:1174），跳过或早退的探测保留旧值。
- 真实调用段从 :1458 的 `mkdtemp` 开始。三条路径让 `response_field` 本轮不刷新：
  - **A 副本源读取或解析失败**（:1462-1471）：`prepareZcodeHome` 抛 → 推 note「副本源 … 读取或解析失败：…——response_field / path_deny / scratch_paths / model_id_form 保留上一次的结论…」→ return。四项全部沿用旧值；
  - **B headless 失败**（:1492-1504）：`failureKind !== 'none'` → 推 note「ZCode headless 失败（kind，探的路径）：stderr；日志根因：…」→ return。四项全部沿用旧值；
  - **C headless 退 0 但抠不出 envelope**（:1558-1560）：推 note「ZCode stdout 中抠不出 JSON envelope」，**不 return**，path_deny 与 scratch_paths 照跑照刷。沿用旧值的是 `response_field` 与 `model_id_form`。未登记在 EV-196 里，本题一并覆盖（决策一）。
- 不进真实调用段的两种情形（:1431-1437）：`skipModelCalls`（`doctor --no-model-calls`）或 `cli/config.json` 缺失——按决策一**不算**。
- 「有 envelope」那一支里 `response_field` 恒被重写（`'response'` 或 null，:1520），是本轮的结论，不算未刷新。

### 1.2 doctor 的 zcode 段

- 布局 blocker（:576）与旗标 blocker（:579）早已不借道 `response_field`（r2 CODEX-06 ≡ AGY-05 的注释 :568-575 记着回归形态下「全量 doctor 退 0、blockers 为空」这一格）。
- 旗标先例（:592-603）：`flagsIndeterminate` 是探针单独带出、不落盘的过程事实，doctor 据此推 **warning**，说清「保留的是上一次的结论」与排查方向，不拦。
- headless blocker（:604）只看 `response_field === null`。A / B / C 三支本身恒可达、不以 `response_field` 为入口条件；existing 里是 `'response'` 时，三支发生后旧值顶替本轮结论，这条 blocker 不触发——这正是 EV-196 的静默形态（r1 此句写反，CODEX-01）。
- warnings 在 `renderDoctorReport` 里阻断之前渲染、不影响退出码（:713-714）；`--json` 输出带 `warnings`。退出码只由 blockers 决定。

### 1.3 认证探活的删除收尾

- :1099 `mkdtemp`；:1102-1135 `try { prepareZcodeHome（失败即 return 一条可读失败）; invokeZcode } finally { await fs.rm(runDir, { recursive: true, force: true }) }`；:1136-1154 在 finally **之后**用 `out` / `prep` 拼结果。落点根两支都设（:1125 `storageRedirectRoot: zcodeHomeUnder(runDir)` 不分支）。
- `force` 只吞 ENOENT：ENOTEMPTY / EBUSY / EACCES 从 finally 抛出、顶替原结果（含 :1112 那条早退的失败结论），穿过无兜底的 `probeAuth`（:730）把预检崩成内部错误；副本支下含真实凭据的 `cli/config.json` 副本留在系统临时目录。
- doctor 侧同形删除（`probes/zcode.ts:1582-1587`）已在 EV-194 改成 `maxRetries: 3` + `.catch` 推 note：「⚠️ 探针临时目录删除失败（code）：~/… 仍在，其中的 cli/config.json 副本含真实凭据，请手工删除」，用例 D10 锁着。
- 临时目录里是否真有副本（GLM-02）：`prepareZcodeHome` 在 `source_missing` / `no_model` 两档直接返回、不建副本（`adapters/zcode.ts:964-974`）；解析失败时 `ensureDir`（:978）已建目录、`writeFile`（:993）未到，同样没有副本。只有「成功返回且 `homeDir !== null`」时副本才写下。

## 2. EV-196 设计

### 2.1 探针侧：带出本轮事实

新增导出（`probes/zcode.ts`，紧挨 `probeZcode`）：

```ts
export type ZcodeHeadlessUnrefreshedBranch = 'source_unreadable' | 'headless_failed' | 'no_envelope';
export interface ZcodeHeadlessUnrefreshed {
  branch: ZcodeHeadlessUnrefreshedBranch;
  /** 本轮沿用上一次结论的几项（按结论字段名） */
  carried: readonly string[];
}
/** 三支的人读名与「根因在哪条 note」的定位字面——探针推 note 与 doctor 出 warning 引同一份 */
export const ZCODE_HEADLESS_UNREFRESHED: Record<ZcodeHeadlessUnrefreshedBranch, { what: string; noteKey: string; carried: readonly string[] }>;
```

- `source_unreadable`：what「副本源读取或解析失败」，noteKey「读取或解析失败」，carried `response_field / path_deny / scratch_paths / model_id_form`；
- `headless_failed`：what「headless 调用失败」，noteKey「ZCode headless 失败」，carried 同上四项；
- `no_envelope`：what「headless 退 0 但 stdout 里抠不出 JSON envelope」，noteKey「ZCode stdout 中抠不出 JSON envelope」，carried `response_field / model_id_form`。

返回形状加第五项 `headlessUnrefreshed: ZcodeHeadlessUnrefreshed | null`：

- 三支各在推 note 处置值；其余路径（入口缺失、跳过真实调用、有 envelope）为 null；
- 三条现有 note **逐字节不变**，只把其中的定位字面改成引用表里的 `noteKey`（模板串拼接结果相同），让「warning 指向的 note」与 note 本身不会各改各的；
- 注释写明它与 `flagsIndeterminate` 同类：是「本次探测过程」的事实，不是被探对象的属性，不落盘（r3 的「过程状态不落盘」裁决）。

`carried` 放表里而不在三处现场各写一份：每支沿用哪几项是由代码结构决定的静态事实（A / B 在 path_deny 之前 return，C 之后 path_deny 照跑），表与 §1.1 的分析一一对应；返回时拷一份（`[...]`），调用方改不到表。

### 2.2 doctor 侧：一条 warning

在 zcode 段旗标 warning 之后、headless blocker 之前：

```
if (r.headlessUnrefreshed) warnings.push(zcodeHeadlessUnrefreshedWarning(r.headlessUnrefreshed));
```

措辞（函数放 `doctor.ts`，与旗标 warning 同处）：

> ZCode headless 探针本轮进了真实调用，但没刷新 response_field（{what}）：{carried 以 / 连接} 沿用的是上一次的结论（首次探测则为空），不是本轮探到的。审查运行走同一条选模路径，大概率同样跑不通——根因见含「{noteKey}」的那条 [zcode] note。

- 只出 warning、不进 blockers：blockers 的内容与条数和改动前逐项相同；
- 判据只有一条（决策一）：`headlessUnrefreshed !== null`。existing 里 `response_field` 本就是 null（含首次探测）时，既有 blocker 照出、本 warning 也出——warning 补的是「哪一支、根因在哪」，不与 blocker 互斥，不加第二个条件（三侧一致认可，§6 R1）；
- 不改 `--no-model-calls`：那条路径不进真实调用段，`headlessUnrefreshed` 恒 null。

### 2.3 残余（不新登）

warning 只在**跑 doctor 的当期**可见；此后 `preflight` 与审查运行照常消费落盘的旧 `response_field`——与 EV-86（旗标结论「冻结」不可见）同一形态，修法方向也相同（落一个「上一次判定完成的时刻」持久事实）。按决策四不新登，EV-196 结案说明里写明「残余同 EV-86」。

## 3. EV-197 设计

### 3.1 共用函数（`adapters/zcode.ts`，紧挨 `tildeHome`）

```ts
/** 删除失败的人读提示：探针与探活同一句，只差主语与「有没有副本」 */
export function zcodeTempDirResidueText(who: '探针' | '探活', runDir: string, code: string, hasCopy: boolean): string
// hasCopy 为 true（副本已写下）：
//   `⚠️ ${who}临时目录删除失败（${code}）：${tildeHome(runDir)} 仍在，其中的 cli/config.json 副本含真实凭据，请手工删除`
// hasCopy 为 false（退路支、副本源解析失败）：
//   `⚠️ ${who}临时目录删除失败（${code}）：${tildeHome(runDir)} 仍在，其中没有 cli/config.json 副本，是本次探测的 CLI 产物，请手工删除`

/** 删 mkdtemp 的返回值：重试三次、失败不抛，返回上面那句（成功返回 null） */
export async function removeZcodeTempDir(runDir: string, who: '探针' | '探活', hasCopy: boolean): Promise<string | null>
// fs.rm(runDir, { recursive: true, force: true, maxRetries: 3 })，catch 取 code ?? message
```

- `hasCopy` 由调用方按「`prepareZcodeHome` 成功返回且 `homeDir !== null`」判定（GLM-02）：副本只在这一情形下写下（§1.3 末条）。没有副本时不断言「产物里没有敏感内容」，只说清没有副本；
- doctor 侧 :1582-1587 改为 `const residue = await removeZcodeTempDir(runDir, '探针', hasCopy); if (residue) notes.push(residue);`——副本支的 note 与 EV-194 时逐字节相同（D10 照绿）；
- 删除只认传进来的 `runDir`（mkdtemp 返回值），函数内不拼路径（2026-09-20 事故后的规矩）。

### 3.2 认证探活

把 :1100-1154 收成一个内部函数 `attempt(runDir, seen)`，**在里面**算出完整的 `{ ok, detail }`（含副本源失败那条早退），并把「副本是否写下」记进调用方给的持有对象 `seen`（回调里赋值的 `let` 在外层会被收窄，按坑清单用对象持有）；外层：

```ts
const runDir = await fs.mkdtemp(...);
const seen = { hasCopy: false };
let r: { ok: boolean; detail: string };
let residue: string | null = null;
try {
  r = await attempt(runDir, seen);
} finally {
  residue = await removeZcodeTempDir(runDir, '探活', seen.hasCopy);
}
return residue ? { ok: r.ok, detail: `${r.detail}；${residue}` } : r;
```

- 结论（`ok`）不因删除失败改变（决策二）；残留提示用全角分号接在详情末尾，成功与失败两种详情都接；
- 两条路径（副本源早退、正常拉起）都经同一个 finally，残留提示不会只在其中一支出现；
- 输出在删除成功时与改动前逐字节相同（现有 10 条 `zcode-auth-probe.test.ts` 锁着）。

### 3.3 拉起抛错的路径（GLM-01：已知残余，不修）

`attempt` 内拉起抛错时，finally 里的删除不再可能抛出顶替它——原异常照旧上抛给 `probeAuth`（与 doctor 侧 D5 同形），这是 §3.2 结构的直接结果。**但**此时 finally 算出的残留提示无人消费：删不掉时含凭据副本留在临时目录而没有提示。doctor 侧同形（D5 抛错路径下已推进 notes 的残留 note 随异常一起丢），是 EV-194 起就有的同族缺口。

裁决为已知残余、不修：拉起抛错本身已让预检崩成内部错误（`probeAuth` 无兜底，决策三不改），用户在这条路径上面对的是一次崩溃；修它要么改写上抛异常的 message（改变异常形状，内部错误的呈现路径要连带核），要么改 `probeAuth`——都越出决策三的范围。写进 §6 R6 与 BACKLOG EV-197 结案说明（两侧同形）。

### 3.4 缓存期的可见性（CODEX-02：已知残余，不修）

`probeAuth` 对 `ok: true` 写缓存（`preflight.ts:736-738`，条目不含 detail）；TTL 期内的预检走缓存命中、详情是 `authCacheValid` 的 reason——残留提示只在删除失败的那一次预检可见。与 §2.3 同族（过程事实只在当期可见）。不改 `probeAuth`（决策三）；RUNBOOK 那行顺带说明残留目录在系统临时目录、前缀 `trivium-zcode-auth-`（doctor 侧 `trivium-zcode-doctor-`），BACKLOG EV-197 结案说明写明。

## 4. 验证（决策五，全程零配额）

### 4.1 单测

探针侧（`test/unit/zcode-doctor-probe-home.test.ts` 增补；新用例的既有结论把 `response_field` 设为 `'response'`，「沿用」与「刷新」才分得开）：

| 编号 | 摆法 | 断言 |
| :--- | :--- | :--- |
| D11 | 桩 headless 失败 | `headlessUnrefreshed` 为 `headless_failed`、carried 四项；`response_field` 仍为 `'response'`；含 noteKey 的 note 在 |
| D12 | 副本源不是合法 JSON | `source_unreadable`、carried 四项；零次拉起；含 noteKey 的 note 在 |
| D13 | 桩退 0 但 envelope 为 null | `no_envelope`、carried 恰为 `response_field / model_id_form`；拉起两次（path_deny 照跑）、`path_deny.method` 被刷新；含 noteKey 的 note 在 |
| D14 | 成功、`skipModelCalls`、cli 配置缺失三格 | `headlessUnrefreshed` 均为 null |
| D15 | doctor 层（`runDoctor` only zcode，`cfg.probe.cli.zcode` 摆 `response_field: 'response'` 的既有结论，经 `zcodeProbe.invoke` 注入失败桩），同一世界再跑一次成功桩作对照 | 失败轮 `warnings` 恰多一条本题 warning（含 what、carried、noteKey，且 notes 里确有含 noteKey 的 `[zcode]` 行）；两轮 `blockers` 逐项相等、不含 `ZCODE_HEADLESS_NOT_OK_HINT`；成功轮无本题 warning |
| D16 | doctor 层三支逐一（副本源坏、headless 失败、无 envelope） | 每支的 warning 都点名该支 what，且其 noteKey 确实出现在该轮某条 `[zcode]` note 里（定位字面不漂） |

D10（EV-194 的删除失败）的三段字面断言（`startsWith('⚠️ 探针临时目录删除失败')`、`/（EACCES）/`、`/含真实凭据，请手工删除/`）**保留不删**，另叠加一条「与 `zcodeTempDirResidueText('探针', runDir, 'EACCES', true)` 逐字相等」（CODEX-03：只比函数输出会自我循环）。

认证探活侧（`test/unit/zcode-auth-probe.test.ts` 增补）：

- **装置**（GLM-03）：新增用例把 `TMPDIR` 钉到用例私有根（与 doctor 侧同法），结束时恢复权限后整删私有根；观测文件只用来断言「残留确在」，不承担清理；root 下跳过；
- **锁开关**（CODEX-04）：假入口加一个开关，在 `ZCODE_STORAGE_DIR` 下建只读子目录并放一个文件，让临时目录删不掉；开关打开却拿不到 `ZCODE_STORAGE_DIR` 时退非 0 并写明原因——摆不出就红，不静默通过。认证探活两支都设落点根（§1.3），所以退路支也能摆。

| 编号 | 摆法 | 断言 |
| :--- | :--- | :--- |
| A1 | 副本支（档位有模型 + 副本源可读）+ 探活通过 + 删不掉 | 不抛；`ok` 仍为 true；详情以「探活通过（」开头；末尾是 `；⚠️ 探活临时目录删除失败（EACCES）：` 起头、含「含真实凭据，请手工删除」的字面，且与 `；` + `zcodeTempDirResidueText('探活', runDir, 'EACCES', true)` 逐字相等；私有根下确有一个残留 |
| A2 | 副本支 + 探活失败（退 1）+ 删不掉 | 不抛；`ok` 仍为 false；详情以「探活失败（other，」开头、末尾同 A1 |
| A3 | 两侧同源（纯函数） | `zcodeTempDirResidueText` 两个主语、两档 `hasCopy` 的输出：同档之间除主语外逐字相同；`true` 档含「含真实凭据，请手工删除」，`false` 档含「没有 cli/config.json 副本」且不含「含真实凭据」 |
| A4 | 退路支（档位无模型）+ 探活通过 + 删不掉 | 不抛；`ok` 仍为 true；详情末尾是 `false` 档措辞（GLM-02），不含「含真实凭据」 |

### 4.2 变异

逐条带 `--test-timeout` 预跑（照 `evidence/lock-reclaim-enoent-20260930/mutation-names.mjs`），再跑 `scripts/mutation-check.mjs`；锚点用生成脚本从源码截并核对唯一；替换串扫一遍特殊替换模式。拟定：

| 编号 | 变异 | 应被咬住的用例 |
| :--- | :--- | :--- |
| M1 | A 支不置 `headlessUnrefreshed` | D12、D16 |
| M2 | B 支不置 | D11、D15、D16 |
| M3 | C 支不置 | D13、D16 |
| M4 | 有 envelope 那一支也置成 `no_envelope` | D14、D15 |
| M5 | 跳过真实调用那条 return 带上 `headless_failed` | D14 |
| M6 | C 支 carried 取成四项 | D13 |
| M7 | doctor 不推 warning | D15 |
| M8 | doctor 把它推进 blockers | D15 |
| M9 | headless blocker 判据改成「`response_field === null` 或 headlessUnrefreshed」（即出路二的等价形态） | D15 |
| M10 | 某支 note 的定位字面改写（不再引 noteKey） | D16 |
| M11 | `removeZcodeTempDir` 去掉 `.catch`（裸删） | A1、A2、D10 |
| M12 | 探活不把残留接进详情 | A1、A2 |
| M13 | 探活在删除失败时把 `ok` 置 false | A1 |
| M14 | 探活退回旧写法（finally 里裸 `fs.rm`） | A1、A2 |
| M15 | 改写共用函数里 `true` 档的文案字面（CODEX-03） | D10、A1 的字面断言 |
| M16 | 探活恒传 `hasCopy: true`（GLM-02） | A4 |

`maxRetries: 3` 本身不做变异：重试只对 EBUSY / ENOTEMPTY / EPERM 等瞬时错误生效，用例摆的 EACCES 不重试，观测不到——如实记为未覆盖面。

### 4.3 全量与自检

`npm run check` 串行两次（一次只发一条、输出重定向到证据目录、`echo exit=$?` 取真实退出码，发之前 `pgrep -fl 'node --test'` 确认无残留），`doctor --selftest`。单跑用例前一律 `node scripts/build.mjs --with-tests` 并核用例总数含新增。

## 5. 文档（决策四）

- 主设计 §11.3 第 7 条末尾补一句：doctor 在 headless 进了真实调用段却没刷新 `response_field` 时出 warning、不拦（三支），认证探活的临时目录删除失败不抛、残留提示接在详情末尾（按有无副本分两档）；版本 v1.3.79 + 变更记录一行；
- RUNBOOK §五 表格加一行：doctor 报「ZCode headless 探针本轮…没刷新 response_field」怎么读（看哪条 note、为什么不拦、审查大概率同样跑不通、修好后重跑 doctor 刷新），以及探活 / 探针详情末尾出现「临时目录删除失败」时怎么认残留（系统临时目录、前缀）；
- BACKLOG：EV-196、EV-197 翻 done，写读数；EV-196 写「残余同 EV-86」，EV-197 写两条残余（§3.3 抛错路径两侧同形、§3.4 缓存期只当次可见）；
- 测试报告 `doc/05_testing/REPORT_2026-10-03_zcode_probe_silent_fail.md` 与证据目录 `doc/05_testing/evidence/zcode-probe-silent-fail-20261003/`，`doc/05_testing/README.md` 索引补一行。

## 6. 风险

| 编号 | 风险 | 对策 |
| :--- | :--- | :--- |
| R1 | warning 与既有 blocker 同时出现（existing 为 null 时）显得重复 | 定案（三侧一致）：不互斥。两者说的事不同（blocker：没跑通；warning：哪一支、根因在哪），判据保持单一 |
| R2 | noteKey 改用常量拼接后 note 文本漂移 | 现有 D4 / D6 对这几条 note 的断言照跑；另加 D16 |
| R3 | 认证探活结构调整引入行为差 | 删除成功时输出逐字节不变由现有 10 条用例锁住；M14 守住「不退回旧写法」 |
| R4 | 摆删不掉目录的用例在 root 下无效 | 与 D10 同样 `skip: getuid() === 0` |
| R5 | 认证探活用例在真实系统临时目录留下只读残留 | 新增用例钉 `TMPDIR` 到私有根，结束恢复权限后整删私有根（GLM-03） |
| R6 | 拉起抛错且删不掉时残留提示丢失（两侧同形） | 已知残余，§3.3；BACKLOG EV-197 结案说明登明 |
