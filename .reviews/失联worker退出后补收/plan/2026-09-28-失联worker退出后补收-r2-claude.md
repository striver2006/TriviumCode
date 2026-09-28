# 失联worker退出后补收（EV-159）计划 r2

起点：`fc42d30`（worker启动时刻规范化，EV-158 已 done）。任务目标见 `task.json`；焦点未给（命令 A `--entry A`，允许省略）。
r2 相对 r1 的改动：按计划双审第 1 轮裁决（`…-revised-claude.md`，8 条全接受）——结论句改用「见上方输出」范式
（CODEX-01 ≡ AGY-01 ≡ GLM-02）、A1 验收构造次序改正（GLM-01）、noSecondChance 文案改准（CODEX-02、GLM-03）、
G1 补顺序断言 / M8 改指（CODEX-03 ≡ GLM-04）、meta.ts 文档块调用方计数改准（AGY-02）、章节编号与 квирк 笔误改正（AGY-03）。

## 0. 范围与不做

**只做 EV-159 的第一形态**：`--cancel` 终态分支的 `gone` 格（`classifyLostCancel` 判定 `worker_pid` 上已没有活进程）在
「工作进程确认已不在」时，按 EV-142 的前提把仍为 `running` 的 run.json 与 task.json 运行登记补收为 `failed`；
`termination` 沿用 `worker_lost` / `heartbeat_stale`（与 `alive` 格同一取值，**不新增取值**）；status.json 一个字节都不写、
闸门不动、凭据副本不抹，与 `alive` 格（`cancelLostWorker`，EV-146）同口径。

**不做**：

- **EV-157**（凭据准入）、**EV-160**（阈值事前告警）——不并入，与本格无交互面。
- **第二形态**（升级前被旧版 `--wait` 判失联、status.json 没有 `lost` 字段的运行）——本稿 §3.6 论证后**暂缓**，理由见该节。
- **`mismatch` 格补收**——用户决策明确「一律不补收」：规范化记录不符的成因含「本次取不到启动时刻」，旧版记录不符的成因还含
  TZ / 区域设置差异，两者都判不了「已不在」，补收会撞上 EV-142 要防的「两写者」（在 worker 其实还活着时写 run.json）。
- **不新增归档取值**：`termination.reason` 仍只有 `heartbeat_stale` 这一种来源；`RunTermination` 类型不改；run.v2 schema 不改。
- **不花配额做真实 CLI 实测**（用户决策）。

**要做但不是新功能，是延伸**：`classifyLostCancel` 的 `no_identity` 格目前把「pid 不合法」与「pid 合法但两种启动时刻都
缺失」合并处理。§3.1 论证后收窄：pid 合法而两种启动时刻都缺失时，改问「进程还在不在」（不需要启动时刻，只有判断「是不是同一进程」
才需要）——进程不在就归入 `gone` 格、一并补收；进程还在则仍是 `no_identity`（判不了身份，不发信号，维持现状）。

## 1. 现状（逐条对照代码，`fc42d30`）

### 1.1 `classifyLostCancel` 判格（`run-protocol.ts` :1421-1438）

```ts
export async function classifyLostCancel(s: RunStatus): Promise<LostCancelCell> {
  const lost = lostOf(s);
  if (s.phase !== 'failed' || lost?.reason !== 'heartbeat_stale') return { kind: 'none' };
  const pid: unknown = s.worker_pid;
  const legacy: unknown = s.worker_started_at;
  const legacyOk = typeof legacy === 'string' && legacy.trim().length > 0;
  if (
    typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1 ||
    (canonicalStartOf(s.worker_started_at_canonical) === null && !legacyOk)
  ) {
    return { kind: 'no_identity' };
  }
  const rec: RecordedStart = { canonical: s.worker_started_at_canonical, legacy: legacyOk ? (legacy as string) : null };
  const live = await processMatchesRecord(pid, rec);
  if (!live.alive) return { kind: 'gone', pid };
  if (!live.sameProcess) return { kind: 'mismatch', pid, basis: live.basis };
  return { kind: 'alive', pid, rec, lost };
}
```

`gone` 格的判据已经是最严格的形态——`processMatchesRecord` 的 `!live.alive` 就是「进程不存在」（`process.kill(pid, 0)` 抛错），
与用户决策「进程不存在才算」逐字相同。**不需要另写一次确认**：判格本身就是确认。

`no_identity` 格今天把两种情形合并：① `pid` 本身不合形状（非整数、≤ 1）——真的判不了；② `pid` 合法但两种启动时刻都
取不到——这只挡住了「是不是同一进程」的判断，不挡「在不在」（§3.1 展开）。

### 1.2 `cancelRun` 终态分支（:1611-1670）

```ts
if (s && ['success', 'failed', 'cancelled'].includes(s.phase)) {
  const cell = await classifyLostCancel(s);
  if (cell.kind === 'alive') return cancelLostWorker(ctx, runId, runDir, s, cell, o);

  const recs = cliRecordsOf(s);
  if (cell.kind !== 'mismatch' && recs.records.length + recs.malformed.length > 0 && (await workerConfirmedGone(s, pidFromFile)).gone) {
    reportRecordedCliGroups(await terminateRecordedCliGroups(s), true, runDir);
  }

  if (cell.kind === 'mismatch') { /* 告警 + say，return EXIT.OK */ }
  if (cell.kind === 'no_identity') { /* 告警 + say，return EXIT.OK */ }

  say(`运行 ${runId} 已处于终态（${s.phase}），无需取消。`);
  say('  已完成的运行不会被追溯改写——归档里的事实就是当时发生的事实。');
  return EXIT.OK;
}
```

`gone` 格今天**没有专属分支**，直接落到最后的通用「无需取消」。CLI 记录的结束已经覆盖 `gone` 格
（`cell.kind !== 'mismatch'` 为真），**唯独 run.json 与 task.json 的补收缺失**——这正是 EV-159 的缺口，且只差这一步。

### 1.3 `cancelLostWorker`（`alive` 格，:1486-1589）第 4、5 步

```ts
// 4. 补收 run.json 与登记
const fin = await finalizeFailedRunMeta({
  layout: { archiveRoot: ctx.archiveRoot, topic: s.topic },
  stage: s.stage, runId,
  lock: { triviumDir: ctx.triviumDir, heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000 },
  workerGone: true,
  termination: { by: 'worker_lost', reason: 'heartbeat_stale' },
});
const noSecondChance = '……（BACKLOG EV-159）……';           // :1563-1565，待改（§3.2）
reportFinalizeStep(fin.runMeta, …);
reportFinalizeStep(fin.task, …);

// 5. 按 run_id + pid 复核回收主题锁
const existing = await inspectLock(ctx.triviumDir, s.topic);
if (existing && existing.run_id === runId && existing.pid === pid) { … } else if (existing) { … }

// 结论（:1580-1587，从不复述归档结果，只指向「见上方输出」——这是 gone 格要沿用的既有范式）
say(noSignalSent ? `……未对它发信号。` : `……已结束仍挂着的工作进程 ${pid}。`);
say('  status.json 的 phase 与 message 保持失联判定时的样子（不追溯改写）；归档 run.json 与运行登记见上方输出。');
```

这两步与 `gone` 格要做的事**逐字相同**（`finalizeFailedRunMeta` 的四个前提本就与「谁在调用」无关，见 `meta.ts` :644-658 的文档块；
锁复核同样只看 `run_id` + `pid`）。§3.2 把它们抽成共享函数，两处调用，不重复写一遍；**结论句从不复述归档结果**这一点
也一并沿用（§3.3）——这是计划双审 r1 CODEX-01 ≡ AGY-01 ≡ GLM-02 的落点。

### 1.4 `finalizeFailedRunMeta` 的天然幂等（`meta.ts` :660-700）

`unfinishedRunMetaStep` 第 4 个前提「合契约且仍为 `running`」：`meta.status !== 'running'` 时直接 `skip('已是终态（…），不追溯改写')`，
不是异常（`error` 不置位），走 `step()` 播报，不是 `warn()`。**这就是可重入的机制本身，不用另写**：gone 格第一次成功补收之后，
run.json 变成 `failed`；再跑一次 `--cancel`（仍会落进 `gone` 格，因为 status.json 没变）会再次调用同一函数，第一步立刻判「已是终态」
跳过，第二步（task.json）同理——两步都不报错，`reportFinalizeStep` 如实播报「按前提跳过」，`gone` 格的结论句（§3.3）
不复述这件事、只说「见上方输出」，读者看上面两行就知道跳过了，不会读到互相矛盾的两句话。

`finalizeFailedRunMeta` 的调用方（`meta.ts` :576-581 文档块，AGY-02）目前枚举「七个调用方」，本次之后是**第八个**：
`--cancel` 在 `gone` 格经 `finalizeLostAndReclaimLock` 调用（§3.5 同步这处文档）。

### 1.5 现有测试对 `gone` 格的既定假设（`test/integration/run-protocol.test.ts`）

- **K8**（:1099-1114）：本格（`alive`）成功之后再跑一次 `--cancel`，落进 `gone` 格，**断言**输出为
  `/运行 R-K8 已处于终态（failed），无需取消。/`，且 run.json / status.json **逐字节不变**。这条断言在 EV-159 之后要变——
  `gone` 格改为调用 `finalizeLostAndReclaimLock`，虽然因为已是终态而不改写文件（run.json 逐字节不变这一半仍成立），
  但**输出**会从「无需取消」变成 §3.3 的新结论句（「工作进程已不在……见上方输出」），K8 要重写为断言新文案（§4.1 N2 承接）。
- **K4**（:885-916）:905：`/可以再跑一次 --cancel（仍会入这一格）；若改为在终端手工结束它.*BACKLOG EV-159/`——
  这句话在 EV-159 之后**不再准确**：手工结束之后再跑 `--cancel` 现在会落进 `gone` 格并补收，不再是「只结束 CLI，
  归档要人工核对」。§3.5 改文案，§4.1 更新断言。
- **K9**（:1116-1131）:1124：`alive` 格自己归档写失败时的 `noSecondChance` 原文引用 `BACKLOG EV-159`；
  §3.2 抽出共享函数后这句话统一改准（§3.5），K9 断言同步更新。
- **K5′**（:979-1028）后半段（`R-K5P-N`，:1007-1028）：构造「`worker_started_at = null`、pid 合法、worker 已死」——
  这正是 §3.1 要收窄的 `no_identity` 子情形。**EV-159 之后这个场景的 `classifyLostCancel` 结果会从 `no_identity`
  变成 `gone`**：CLI 结束的断言（沿用 `workerConfirmedGone`，与 `classifyLostCancel` 的格无关）不受影响，
  但**新增**的 `gone` 格 run.json 补收逻辑会在这个场景里跑一次——测试没有 `seedArchive`，
  `finalizeFailedRunMeta` 读不到 run.json 会跳过（`skipped('归档里没有 run-….json')`），只多几行 stderr/stdout，
  不影响现有 `assert.match`。§4.1 N7 在这个场景上补一条直接调用 `classifyLostCancel` 的断言，钉住「格变了」这件事，
  并把测试标题改准（不再说「no_identity 且 worker 已不在」）。

## 2. 覆盖矩阵（`--cancel` 终态分支，续用 EV-146/158 的格名）

| 格 | 判据 | 今天（`fc42d30`） | 本次之后 |
| :--- | :--- | :--- | :--- |
| `none` | 不是「failed + heartbeat_stale」 | 「无需取消」 | 不变 |
| `alive` | pid 合法、启动时刻可比、进程在且同一 | `cancelLostWorker`：杀 → 补收 → 回锁 | 不变（第 4/5 步改走共享函数） |
| `gone` | pid 合法、启动时刻可比、进程不在 | CLI 结束 + 「无需取消」 | CLI 结束 + **补收 run.json/task.json + 回锁**（新） |
| `gone`（延伸） | pid 合法、**两种启动时刻都缺失**、进程不在 | 落 `no_identity`：不发信号、不补收 | **改判 `gone`**：CLI 结束（沿用今天）+ 补收（新） |
| `no_identity`（延伸后剩余） | pid 合法、两种启动时刻都缺失、**进程还在** | 不发信号、不补收 | 不变——判不了身份，补收要担「两写者」的风险 |
| `no_identity`（原样） | pid 不合形状 | 不发信号、不补收 | 不变——pid 都不可信，无从判定 |
| `mismatch` | pid 合法、启动时刻不符 | 不发信号、不补收 | 不变（用户决策，§0） |
| 第二形态 | phase=failed、无 `lost` 字段（升级窗口） | 落 `none`：「无需取消」 | 不变，§3.6 论证后暂缓 |

## 3. 改法

### 3.1 `classifyLostCancel` 收窄 `no_identity`（`run-protocol.ts`）

```ts
export async function classifyLostCancel(s: RunStatus): Promise<LostCancelCell> {
  const lost = lostOf(s);
  if (s.phase !== 'failed' || lost?.reason !== 'heartbeat_stale') return { kind: 'none' };
  const pid: unknown = s.worker_pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 1) {
    return { kind: 'no_identity' };
  }
  const legacy: unknown = s.worker_started_at;
  const legacyOk = typeof legacy === 'string' && legacy.trim().length > 0;
  if (canonicalStartOf(s.worker_started_at_canonical) === null && !legacyOk) {
    // EV-159：两种启动时刻都缺失，判不了「是不是同一进程」；但「在不在」不需要启动时刻
    return (await processAlive(pid)).alive ? { kind: 'no_identity' } : { kind: 'gone', pid };
  }
  const rec: RecordedStart = { canonical: s.worker_started_at_canonical, legacy: legacyOk ? (legacy as string) : null };
  const live = await processMatchesRecord(pid, rec);
  if (!live.alive) return { kind: 'gone', pid };
  if (!live.sameProcess) return { kind: 'mismatch', pid, basis: live.basis };
  return { kind: 'alive', pid, rec, lost };
}
```

`processAlive(pid)` 不传第二参、只取 `.alive`——不触发「期望为假值即相符」的 `sameProcess` quirk（那是给「是不是同一进程」
用的，这里只问「在不在」，与 `.sameProcess` 无关）。`processAlive` 已在文件顶部导入（:40），无需新增导入。

**为什么这是安全的收窄，不是新判据**：`gone` 格本来的判据就是 `!processMatchesRecord(pid, rec).alive`，
而 `processMatchesRecord` 在 `rec.canonical` 为 null 时会退回 `processAlive(pid, rec.legacy)`——当 `rec.legacy` 也是
假值时，`processAlive` 提前返回 `sameProcess: true`（quirk），但 `.alive` 字段本身**不受这个 quirk 影响**，
是同一次 `process.kill(pid, 0)` 判出来的。换句话说：`classifyLostCancel` 原本为了避开 `sameProcess` 的 quirk，
把「两种启动时刻都缺失」整个挡在 `processMatchesRecord` 调用之前，连带把 `.alive` 这个不受 quirk 影响的字段也一起挡掉了。
本次只是把「在不在」这一半放出来，「是不是同一进程」那一半（依赖 quirk 的部分）继续挡在外面——不引入新的判定能力，
只是不再用「怕误判身份」的理由连坐「判进程还在不在」。

### 3.2 抽出共享函数 `finalizeLostAndReclaimLock`（`run-protocol.ts`，`cancelLostWorker` 与新 `finalizeGoneWorker` 共用）

```ts
/**
 * 按 EV-142 的前提把仍为 running 的 run.json 与 task.json 登记补收为 failed（termination 固定
 * worker_lost / heartbeat_stale），再按 run_id + pid 复核回收主题锁——alive 格（cancelLostWorker）
 * 与 gone 格（finalizeGoneWorker，EV-159）的第 4、5 步逐字相同，抽成一份。返回两步的 FinalizeStep，
 * 供单测直接钉住每一步的结果；调用方的结论句一律不复述这两步的结果，只说「见上方输出」（§3.3，
 * 计划双审 r1 CODEX-01 ≡ AGY-01 ≡ GLM-02）——`reportFinalizeStep` 已经把结果如实播报在前面几行。
 */
async function finalizeLostAndReclaimLock(
  ctx: Ctx, runId: string, s: RunStatus, pid: number,
): Promise<{ runMeta: FinalizeStep; task: FinalizeStep }> {
  const fin = await finalizeFailedRunMeta({
    layout: { archiveRoot: ctx.archiveRoot, topic: s.topic },
    stage: s.stage,
    runId,
    lock: { triviumDir: ctx.triviumDir, heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000 },
    workerGone: true,
    termination: { by: 'worker_lost', reason: 'heartbeat_stale' },
  });
  const noSecondChance =
    '这一步可以再跑一次 --cancel 重试：只要 run.json 仍为 running，再跑一次会落进会重试这一步的格' +
    '（本次工作进程已被结束过，下一次判格时它已经不在了，通常是 gone 格；EV-159 起 gone 格与 alive 格一样会重试这一步）。' +
    '若这次写失败的原因是持续性故障（比如目录只读），重试不会自愈，请人工核对归档 run.json 与 task.json 的运行登记';
  reportFinalizeStep(fin.runMeta, `已把归档里的 run-${runId}.json 收尾为 failed`, `归档 run-${runId}.json 未回写`, noSecondChance);
  reportFinalizeStep(fin.task, '已把 task.json 的运行登记同步为 failed', 'task.json 的运行登记未改', noSecondChance);

  const existing = await inspectLock(ctx.triviumDir, s.topic);
  if (existing && existing.run_id === runId && existing.pid === pid) {
    if (await reclaimStaleLock(lockPathFor(ctx.triviumDir, s.topic), existing)) {
      say(`已回收主题「${s.topic}」的锁`);
    } else {
      step('主题锁在回收时已被别的进程动过，未回收');
    }
  } else if (existing) {
    step(`主题锁已不归本运行的工作进程（run_id ${existing.run_id ?? '无'}，pid ${existing.pid}），不动`);
  }
  return fin;
}
```

`cancelLostWorker` 的第 4、5 步（:1554-1579）替换为 `await finalizeLostAndReclaimLock(ctx, runId, s, pid);`，
原地的两个 `reportFinalizeStep` 调用与锁复核块整段删除（逻辑一字不差地搬进共享函数）；`cancelLostWorker` 自己的结论句
（:1582-1587）**不改**——它本来就是「见上方输出」的范式，只是调用点从内联代码换成共享函数调用，输出逐字不变。

**noSecondChance 措辞是本次对 `alive` 格唯一可见的行为差异**（计划双审 r1 CODEX-02、GLM-03 落点）：原文「不会再有第二次机会……
（BACKLOG EV-159）」在 EV-159 落地后不再是事实——写失败之后，只要下一次 `--cancel` 时 worker 已确认不在
（大概率成立，因为上一次已经杀过一次），就会落进 `gone` 格并重试这一步；新文案改为肯定句、且把「格」的指称从
「同一格」改为「会重试这一步的格」，不再暗示是 `alive` 格自己。§4.1 K9 的断言要跟着改。

### 3.3 新增 `finalizeGoneWorker`（`gone` 格入口）

```ts
/**
 * gone 格：--wait 判 heartbeat_stale 之后，工作进程确认已不在（EV-159，计划 r2 §3）。
 * 形态：worker 自己死了、被手工结束，或 cancelLostWorker 确认退出之后、补收之前本进程被中断。
 * 只做 finalizeLostAndReclaimLock 那一步——不发信号（本来就没有活进程可杀）。status.json 不写、
 * 闸门不动、凭据副本不抹，与 alive 格同口径；CLI 记录的结束在调用方已经做过（cancelRun 里 gone 格
 * 与 alive 格共用同一段 workerConfirmedGone 判定，见 :1633-1639），本函数不重复。
 *
 * 结论句沿用 cancelLostWorker 的范式（:1582-1587）——不复述 finalizeLostAndReclaimLock 两步的结果，
 * 只说「见上方输出」：可重入（已是终态）与归档缺失（没有 run.json）都走 skip、由 reportFinalizeStep
 * 在前面如实播报，结论句里再断言一次「已补收」会在这两种情形下说假话（计划双审 r1 CODEX-01 ≡ AGY-01 ≡ GLM-02）。
 */
async function finalizeGoneWorker(ctx: Ctx, runId: string, s: RunStatus, cell: { pid: number }): Promise<number> {
  await finalizeLostAndReclaimLock(ctx, runId, s, cell.pid);
  say(`运行 ${runId} 已被 --wait 判为失联（heartbeat_stale）：工作进程 ${cell.pid} 已不在。`);
  say('  status.json 的 phase 与 message 保持失联判定时的样子（不追溯改写）；归档 run.json 与运行登记见上方输出。');
  return EXIT.OK;
}
```

### 3.4 接线（`cancelRun` 终态分支）

```ts
const cell = await classifyLostCancel(s);
if (cell.kind === 'alive') return cancelLostWorker(ctx, runId, runDir, s, cell, o);

const recs = cliRecordsOf(s);
if (cell.kind !== 'mismatch' && recs.records.length + recs.malformed.length > 0 && (await workerConfirmedGone(s, pidFromFile)).gone) {
  reportRecordedCliGroups(await terminateRecordedCliGroups(s), true, runDir);
}

if (cell.kind === 'gone') return finalizeGoneWorker(ctx, runId, s, cell);   // EV-159 新增

if (cell.kind === 'mismatch') { … }
if (cell.kind === 'no_identity') { … }

say(`运行 ${runId} 已处于终态（${s.phase}），无需取消。`);
```

顺序刻意排在 CLI 结束块**之后**：CLI 结束依赖的 `workerConfirmedGone(s, pidFromFile)` 与 `classifyLostCancel` 是两次
独立判定（前者用 `pidFromFile` 兜底、判据略宽），先把「按记录结束 CLI」这一步做完、播报完，再进 `gone` 格补收——
两段各自的 stdout/stderr 顺序与今天 `alive` 格「先报 worker 结束、再报 CLI 结束、再报补收」的顺序呼应，人读起来次序一致；
§4.2 G1 显式断言这个先后顺序（计划双审 r1 CODEX-03 ≡ GLM-04），不只是靠「结果都对」间接兜底。

### 3.5 文案改准（指向 EV-159 的注释、告警、MANUAL、LLD、meta.ts）

- `LostCancelCell` 文档块（:1394-1401）：`gone` 那一行「走原有终态早退（run.json 的补收暂缓，BACKLOG EV-159）」
  改为「按 EV-142 的前提补收 run.json 与登记，锁按 alive 格同一复核回收（EV-159）」。
- `cancelLostWorker` 函数文档块开头「已终态的运行不追溯改写，只有一格例外（EV-146）」（:1344-1345）改为
  「……两格例外：alive 格（本函数，EV-146）与 gone 格（`finalizeGoneWorker`，EV-159），status.json 都不写，
  只补收归档」。
- `cancelLostWorker` 内「未能确认退出」告警（:1539-1541）：
  - 旧：`……可以再跑一次 --cancel（仍会入这一格）；若改为在终端手工结束它，之后再跑 --cancel 只会结束审查员 CLI，归档 run.json 与运行登记要人工核对（BACKLOG EV-159）`
  - 新：`……可以再跑一次 --cancel（仍会入这一格，再次尝试结束）；若改为在终端手工结束它，之后再跑 --cancel 会判它已不在（gone 格），按前提补收归档 run.json 与运行登记（EV-159）`
- `noSecondChance`（原 :1563-1565）：随 §3.2 的抽出一并改准，见上方共享函数里的新文案。
- **`meta.ts` :576-581**（`finalizeFailedRunMeta` 文档块，AGY-02）：「七个调用方」改为「八个调用方」，枚举末尾补一条
  「`--cancel` 在 `--wait` 判 heartbeat_stale 之后发现工作进程已不在（沿用 `worker_lost` / `heartbeat_stale`，
  EV-159，经 `finalizeLostAndReclaimLock`）」。
- `MANUAL_user.md` :651：句尾「归档里的 `run-<id>.json` 与运行登记要你自己核对（BACKLOG EV-159）」改为
  「之后再跑一次 `trivium review --cancel <run_id>` 会判它已不在，按前提补收归档 `run-<id>.json` 与运行登记（EV-159）」。
- `MANUAL_user.md` :657：句尾「`--cancel` 仍会说「已处于终态」，只能在终端手工结束（BACKLOG EV-159）」——
  这句描述的正是**第二形态**（无 `lost` 字段的升级窗口），本次不做（§3.6），**保留原句**，只把落款从
  「BACKLOG EV-159」改为「BACKLOG EV-159 第二形态，暂缓」，避免读者误以为本版已解决。
- `LLD_orchestrator.md` :478（「仍会停在 running 的」枚举）：把「它之后自己死了或被手工结束的那一格仍停在
  running，EV-159」改为「它之后自己死了或被手工结束——EV-159 起 `--cancel` 的 gone 格会补收；仍停在 running 的
  只剩两处：本格确认退出到补收之间被中断（毫秒级），以及第二形态（升级窗口，无 `lost` 字段，暂缓）」。
- `LLD_orchestrator.md` :601（已知缺口表 EV-159 行）：改为「第一形态已修（gone 格补收，本主题）；第二形态
  （无 `lost` 的升级窗口）暂缓，见 BACKLOG 注记」。
- **不改**：`PROTOCOL_dual_critic_relay.md`（没有 EV-159 相关锚点，`grep` 已确认）；PRD（预计不改，实施时再核一次，
  写进报告）；run.v2 schema（不新增取值，契约不变）。

### 3.6 第二形态：论证与结论（暂缓）

第二形态：升级前（早于 EV-146 提交 `6b89cc0`）由旧版 `--wait` 判定失联的运行，status.json 的 `phase` 是 `failed`，
但**没有** `lost` 字段（该字段由 EV-146 引入，旧版根本不写）。`classifyLostCancel` 第一行 `lost?.reason !== 'heartbeat_stale'`
即为真，直接落 `none` 格。

**能不能只凭结构化事实覆盖？** 用户要求的判据形状是：`status.json` 终态 + 归档 `run.json` 仍 `running` + worker 确认已不在。
问题在于：**这个结构化特征描述的不是唯一一种成因**。

同样满足「status.json phase=failed、run.json 仍 running、worker 已不在」的，还有一种完全不同、且是**当前版本**就会
发生的形态：EV-142 的 worker 异常分支（`workerMain` 的 `catch`）也会把 status.json 写成 `failed`，正常情况下它自己
紧接着调 `finalizeFailedRunMeta({ termination: { by: 'worker_exception', … } })` 补收 run.json；但如果**那一次补收本身
写失败**（比如归档目录一过性不可写），run.json 就会停在 `running`，而 status.json 已经是 `failed`、也没有 `lost` 字段
（worker 异常分支从不写 `lost`，那是 `--wait` 专用字段）。这两种成因（「旧版判的 heartbeat_stale」vs「本版 worker 异常
但补收失败」）在结构化数据里**逐位相同**，唯一的区别在 `message` 里——而判据不许读 `message`。

**代价不对称**：worker 异常分支的正确 `termination` 是 `worker_exception` 加具体退出码，不是 `worker_lost` /
`heartbeat_stale`——如果按「结构化特征匹配就当成第二形态」补收，会把一个已经确定成因的失败**写成错误的成因**，
这正是用户决策里「会扩大『已终态运行也改写』的面」要防的那种代价：不是「值得不值得」的风险，是「写错了就回不去」
的风险（归档只追加不覆盖，run.json 一旦写定就是历史记录）。

**结论：暂缓**。登记进 BACKLOG（§7），保留现状——这类运行仍要人工核对，`MANUAL` 的既有说明不改（§3.5）。
如果日后要做，候选方向是给 worker 异常分支的补收失败也留一个可区分的痕迹（比如即使写 run.json 失败也在别处留一行
结构化标记），但那是另一个改动面，不在本次范围内。

### 3.7 `no_identity` 延伸之外维持现状的两种情形

- **pid 不合形状**（非整数、`≤ 1`）：pid 本身不可信，无法对任何进程做 `kill(pid, 0)`，没有「在不在」可判。维持现状。
- **pid 合法、两种启动时刻都缺失、`processAlive(pid).alive` 为真**：进程确实在，但判不了「是不是同一进程」——
  PID 有可能已被别的进程复用。补收的前提是「确认这个曾经的 worker 已经不在」，这里只能确认「pid 上有个进程」，
  不能确认那个进程是不是曾经的 worker（也可能不是，判据本身就说明不了）。维持现状：不发信号、不补收，
  `no_identity` 的既有告警文案（:1663）已经准确（「pid 或启动时刻缺失 / 形状不对，判不了是不是同一进程」），不改。

## 4. 验证

### 4.1 单测（`test/integration/run-protocol.test.ts`，沿用既有 `fakeCtx` / `seedRun` / `seedArchive` / `holdLock` / `lostScenario` / `staleHeartbeat` / `captureOut`）

- **N1（主线）**：`lostScenario` 造出 `alive` 格现场后，先手工 `killQuietly(pid)` 确认死透（不经 `cancelLostWorker`，
  模拟「worker 自己死了 / 被手工结束」），确认 `classifyLostCancel` 落 `gone`；跑 `--cancel` ⇒ run.json / task.json
  变 `failed`、`termination` 为 `{ by: 'worker_lost', reason: 'heartbeat_stale' }`、锁按 run_id+pid 复核回收、
  status.json 逐字节不变、闸门不动；输出不说「无需取消」，说「工作进程已不在……见上方输出」，且上方确有
  「已把归档里的 run-….json 收尾为 failed」与「已把 task.json 的运行登记同步为 failed」两行。
- **N2（可重入 / 已终态不改写，接替 K8）**：先跑一次 `--cancel`（落 `alive` 格，`cancelLostWorker` 成功），
  再跑一次（此时 worker 已死，落 `gone` 格）——第二次 run.json / task.json / status.json 都逐字节不变，
  上方输出为「已是终态（failed），不追溯改写」，结论句仍是 §3.3 的固定文案（不出现「已补收」字样，因为结论句
  结构上就没有这个分支）；重写 K8 断言。
- **N3（锁不相符，两种）**：仿 K6，`gone` 格下 run_id 相同而 pid 不同 / run_id 不同两种，锁不动、如实说明；
  run.json 与 task.json 照常补收。
- **N4（写失败）**：仿 K9，`gone` 格归档目录只读 ⇒ 告警带新版 noSecondChance（肯定句「可以再跑一次 --cancel 重试」，
  不再说「不会再有第二次机会」），锁不连坐。
- **N5（mismatch 两种依据都不补收）**：仿 K5④，`gone` 格判据不成立、落 `mismatch`（canonical 与 legacy 两种 basis
  各一格）时，run.json 保持 `running`（新增断言，原 K5 测试没检查这一半，因为今天 `mismatch` 本来就不补收——
  本条是回归防线，确认新代码没有误伤 `mismatch`）。
- **N6（no_identity 延伸：判不了维持现状）**：pid 合法、两种启动时刻都缺失、进程**还在**（活的假 worker，不杀）
  ⇒ `classifyLostCancel` 仍判 `no_identity`；run.json 不动、不发信号。
- **N7（no_identity 延伸：判得了则改判 gone，接替/扩展 K5′ 的 R-K5P-N）**：pid 合法、两种启动时刻都缺失、进程**已死**
  ⇒ 直接调用 `classifyLostCancel` 断言返回 `{ kind: 'gone', pid }`（不是 `no_identity`）；集成层面复用 K5′ 的
  `R-K5P-N` 场景，补一条 run.json 补收路径被触发的断言（该场景没 `seedArchive`，断言「归档里没有 run-….json」的跳过分支
  也被覆盖到），并把测试标题里「no_identity 且 worker 已不在」改成准确描述。
- **K4 断言更新**：:905 的正则随 §3.5 的文案改动同步更新（不再断言「只会结束审查员 CLI……人工核对」）。
- **K9 断言更新**：:1124 的正则随 §3.2 的共享函数文案同步更新（肯定句 + 「会重试这一步的格」）。
- **classifyLostCancel 直接单测（新文件或沿用既有位置）**：四格矩阵——pid 不合法（不管死活）⇒ `no_identity`；
  pid 合法+两时刻缺失+活着 ⇒ `no_identity`；pid 合法+两时刻缺失+已死 ⇒ `gone`；pid 合法+有时刻+已死 ⇒ `gone`
  （既有行为，回归）。

### 4.2 集成（`test/integration/gate-loop.test.ts`，真实 bundle + `hang_cli` 桩，沿用 `lostHungRun` / `test/helpers/proc.ts`）

- **G1**：复用 `lostHungRun` 造出 heartbeat_stale 现场（worker 与两侧 CLI 组都活着），**不经 `--cancel`**，
  直接按组 `SIGKILL` worker（模拟终端手工结束）、确认其消亡；跑 `--cancel` ⇒ 落 `gone` 格：CLI 两组都按记录结束
  （沿用今天的行为）、run.json 补收为 `failed`、task.json 登记同步、锁回收；status.json 与闸门不动。
  **另加一条顺序断言**（计划双审 r1 CODEX-03 ≡ GLM-04）：合并输出（stdout+stderr）里「按记录结束审查员 CLI」
  首次出现的位置早于「已把归档里的 run-…json 收尾为 failed」首次出现的位置。计时只防挂死，上界参考 J1 但更小
  （不需要走 SIGTERM 宽限链）。
- **G2（新旧构建可重入）**：在 G1 的产物上再跑一次 `--cancel` ⇒ 幂等、无二次写入、输出为「已是终态」。

### 4.3 源码变异（`scripts/mutation-check.mjs`；规格由生成脚本从源码截锚点并逐条核对唯一，照搬
`evidence/worker-start-canonical-20260928/gen-mutation-spec.mjs`；失败用例名与文案用同目录 `mutation-names.mjs` 补，
确认没有前置失败）

| # | 变异 | 预期咬住 |
| :-- | :--- | :--- |
| M1 | `classifyLostCancel` 两时刻缺失分支恒返回 `no_identity`（去掉 `processAlive` 改判） | N7、classifyLostCancel 矩阵 |
| M2 | `classifyLostCancel` 两时刻缺失分支恒返回 `gone`（不管死活） | N6 |
| M3 | `cancelRun` 不调用 `finalizeGoneWorker`（`gone` 格仍走旧的「无需取消」） | N1 |
| M4 | `finalizeGoneWorker` 不调用 `finalizeLostAndReclaimLock`（只播报不写） | N1（run.json 未变） |
| M5 | `finalizeLostAndReclaimLock` 的 `termination.reason` 恒为别的值 | N1（termination 断言） |
| M6 | `finalizeLostAndReclaimLock` 跳过锁复核（去掉整段） | N3 |
| M7 | `finalizeLostAndReclaimLock` 的锁复核不比对 `pid`（只比 `run_id`） | N3 |
| M8 | `finalizeGoneWorker` 在 CLI 结束块之前调用（改变接线顺序） | G1 的 CLI 结束断言（该变异下 CLI 两组不会被结束，因为 `finalizeGoneWorker` 的 `return` 让 CLI 结束块整段不可达）+ G1 新增的顺序断言 |

装置只记 fail 数；失败用例名与文案逐条补齐（名字核对）。

### 4.4 零配额验收（scratchpad → `doc/05_testing/evidence/lost-worker-gone-finalize-20260928/`）

照搬 `evidence/worker-start-canonical-20260928/acceptance.mjs` 的骨架：旧构建 `git archive fc42d30`（带 `.reviews/`、
`node_modules` 软链工作树、叠加 `hang_cli` 桩），新旧都直接 `node` 调 bundle 路径，记 sha256 并断言不同；输出归一化
覆盖主题名、run_id、时间戳、路径与 pid。

| 格 | 构造 | 判据 |
| :-- | :--- | :--- |
| A1（新旧对照，方向一，**构造次序按 GLM-01 改正**） | 旧构建 `--start` + 心跳阈值调小；**worker 仍存活时**，旧构建 `--wait` 判 `heartbeat_stale`（写 status.json + `lost`；此刻 `workerGone=false`，旧版自己的归档收尾因「未确认退出」跳过，run.json 停在 `running`——这正是要的现场）；**随后**按组 `kill -9` worker；**新构建** `--cancel` | run.json / task.json 补收为 `failed`，`termination` 为 `worker_lost`/`heartbeat_stale`，输出不说「无需取消」（强杀必须发生在失联判定之后，先后次序是本格判据成立的前提——先杀会让旧版 `--wait` 判 `pid_gone`，见 `status.ts` :413-420） |
| A2（新旧对照，方向二：回滚） | 新构建走完 A1（run.json 已由新版补收为 `failed`）；**旧构建** `--cancel` 再跑一次 | 旧版落它自己的判格逻辑（此时 status.json 仍是 heartbeat_stale 现场、worker 已不在，旧版没有 `gone` 格的补收分支，走它自己的默认早退）；不报错、不改写一个已经是 `failed` 的 run.json——这一步只验证「旧版读新版补收过的归档不报错、不二次改写」，不是「行为一致」 |
| A3（可重入） | 新构建走完 A1；新构建再跑一次 `--cancel` | 幂等，run.json / task.json / status.json 均逐字节不变 |
| A4 | 新构建 `doctor --selftest` | 14/14 |

### 4.5 doctor 自检与全量

`npm run check` 文档改前、改后各一次；`node dist/… doctor --selftest`。

## 5. 文档同步

- **主设计**（`2026-09-10-Driver-DualCritic主攻双审流水线设计.md`）：v1.3.54 那段（1479 行附近）末尾「如实保留」
  一句「`--wait` 判 `heartbeat_stale` 之后工作进程自己死了、被手工结束，或本格在确认退出之后、补收之前被中断——
  run.json 停在 `running`，再跑 `--cancel` 不补（BACKLOG EV-159）」改为「……gone 格会补收（EV-159，本主题）；
  仍如实保留的只剩两处：确认退出到补收之间被中断的毫秒级窗口，以及第二形态（升级窗口，暂缓）」。
  变更记录新增一行 v1.3.56（单行，表格单元格不换行）。
- **LLD_orchestrator.md**：见 §3.5；变更说明块新增一行。
- **MANUAL_user.md**：见 §3.5 两处。
- **PROTOCOL_dual_critic_relay.md**：不改（无锚点）。
- **`meta.ts`**：`finalizeFailedRunMeta` 文档块「七个调用方」→「八个调用方」（§3.5，AGY-02）。
- **BACKLOG**：EV-159 第一形态标 done（引用本主题、读数摘要）；第二形态另起一段，标「暂缓」并写清 §3.6 的论证结论
  （不是新登条目，是把 EV-159 行拆成「第一形态 done / 第二形态暂缓」两段，沿用同一编号）。
- **PRD**：`grep` 核一遍是否有字段级表述提到 `--cancel` 的 `gone` 格或「无需取消」，预计不改，实施时再核一次并在报告里写明。
- **实施报告**：`doc/05_testing/REPORT_2026-09-28_lost_worker_gone_finalize.md`；证据
  `doc/05_testing/evidence/lost-worker-gone-finalize-20260928/`。

## 6. 风险与边界

- **回滚**：本次不新增归档取值、不改 schema；回退 `run-protocol.ts` 的三处改动（`classifyLostCancel`、
  `finalizeLostAndReclaimLock` 抽出、`finalizeGoneWorker` 接线）与文档即可，由用户在终端重装。
- **对 `alive` 格的行为影响仅限文案**：§3.2 的抽出不改变 `alive` 格的判定、发信号、补收顺序，唯一可见差异是
  `noSecondChance` 的措辞（更准确，不改变退出码或哪些文件被写）。
- **K8 / K4 / K9 三条既有测试的断言必须同步改**（§4.1），否则会红——这是本次预期之内的测试变更，不是回归。
- **`gone` 格延伸到 no_identity 子情形之后，K5′ 的 `R-K5P-N` 场景分类会变**（no_identity → gone），
  §4.1 N7 与测试标题一并处理，避免代码双审读到「格变了但没人管」。
- **G1 集成测试的「强杀 worker」构造**：按组 `SIGKILL`（不是先礼后兵）确保干净退出，且要在杀之前确认两侧 CLI 组
  仍活着（用例前提），杀 worker 本身不会经过 EV-152 的 SIGTERM 转发（因为不是经 SIGTERM 触发），CLI 组会真的
  成为孤儿——这正是 `--cancel` 的 `gone` 格里「按记录结束 CLI」这段代码本来就要处理的场景，用真实孤儿去验证
  比 mock 更贴近用户遇到的情形。
- **不改变已终态运行的判定范围**：`unfinishedRunMetaStep` 的「仍为 running 才写」前提没有任何改动，
  `gone` 格与 `alive` 格一样受它保护，不会追溯改写一个已经是 `success`/`cancelled` 的 run.json。
- **结论句不复述归档结果**是本次修订的核心防线（计划双审 r1 CODEX-01 ≡ AGY-01 ≡ GLM-02）：任何日后再往
  `finalizeGoneWorker` 加逻辑的人，如果想在结论句里加一句「已补收」，都应该先确认 `finalizeLostAndReclaimLock`
  的两步是不是真的都 `written`——更稳妥的做法是继续不加，保持「见上方输出」的范式不被打破。

## 7. BACKLOG

- **EV-159 第一形态 → done**（本主题）：`gone` 格补收、`no_identity` 收窄、共享函数与文案改动、读数见实施报告。
- **EV-159 第二形态 → 暂缓**（§3.6 论证）：升级前旧版判失联、无 `lost` 字段的运行，结构化特征与「本版 worker 异常
  补收失败」不可区分，误写成因的代价不可逆，本次不做。
- 不新登条目（本主题范围内的延伸——`no_identity` 收窄——已在 §0/§3.7 说清边界，不是独立缺口）。

## 8. 决策点

**用户已定（送审前，2026-09-28）**：见任务目标原文，摘要：

1. 只做第一形态；EV-157、EV-160 不并入。
2. `termination` 沿用 `worker_lost` / `heartbeat_stale`，不新增取值；已终态不追溯改写；status.json 不写、闸门不动、
   凭据不抹，与 alive 格同口径；「已不在」用严格形态（进程不存在才算），mismatch 一律不补收。
3. 锁复核回收沿用 alive 格同一逻辑。
4. 第二形态判据不得解析人读文案；论证覆盖可行性，判不了就暂缓写清理由。
5. no_identity 格论证 pid 合法而进程不存在时能否补收；判不了就维持现状。
6. 输出按事实说（补收了/按前提跳过/写失败），写失败的措辞要改准（能不能重试）；退出码不变；可重入。
7. 指向 EV-159 的注释、告警、MANUAL、LLD 一并改准。
8. 新旧两方向都要验收（§4.4 A1/A2）。
9. 不花配额做真实 CLI 实测。

**本稿自定**（用户决策留给实现细节的部分，计划双审 r1 已核实并接受）：

- D-A：`classifyLostCancel` 的 `no_identity` 收窄采用「pid 合法 + 两时刻缺失时改问 processAlive」的实现（§3.1），
  而不是新增一个判格类型——理由是它本质仍是「已不在」这同一个结论，复用 `gone` 格的下游处理（CLI 结束、补收、
  文案）不用另写一套。
- D-B：把 `cancelLostWorker` 第 4/5 步与新 `finalizeGoneWorker` 的逻辑抽成共享函数 `finalizeLostAndReclaimLock`
  （§3.2），而不是各写一份——理由是两处逻辑逐字相同，不抽会有维护期分叉的风险（EV-146 代码双审 r1 CODEX-06
  抽过一次类似的重复，本次是同一治理方向的延伸）。
- D-C：`finalizeGoneWorker` 不重复 CLI 结束逻辑，依赖调用方（`cancelRun`）已经做过的那一段——理由是 CLI 结束的
  判据（`workerConfirmedGone(s, pidFromFile)`）本来就覆盖 `gone` 格（`cell.kind !== 'mismatch'`），重复调用
  `terminateRecordedCliGroups` 是幂等的（按记录里的 pgid 结束，组已空则无操作），但没必要在两处各调一次、
  播报两次「按记录结束审查员 CLI」——保持今天「先报 CLI、再报归档补收」的单一顺序。
- D-D：第二形态的论证结论是「暂缓」而非「找到覆盖方案」（§3.6）——计划双审 r1 三侧一致认可该论证成立，无异议。
- D-E（r2 新增，计划双审 r1 CODEX-01 ≡ AGY-01 ≡ GLM-02 的落点）：`finalizeGoneWorker` 的结论句不按
  `finalizeLostAndReclaimLock` 的返回值分流文案，而是无条件采用「见上方输出」的固定范式——理由见 §6 最后一条：
  这比「按结果动态拼句子」更简单，也从结构上排除了「结论句与步骤行矛盾」这一类问题重新出现的可能。

## 9. 流程（命令 A，一口气跑）

计划双审 → 逐条裁决 → 编码（§3～§4 全部做完）→ 代码双审 → 逐条应答 → 按接受项改代码 → verify。跑完 verify 就停，
不提交、不推送、不自己审批。
