# 取消与失联的凭据准入核CLI 实施计划（r1）

> **性质**：BACKLOG EV-157。**不属任何里程碑**。
> **一句话**：凭据抹除的准入抽成单一来源 `scrubAdmission`（worker 一半 `workerConfirmedGone` + CLI 一半 `cliGroupsConfirmedGone`），`admitScrub`、`cancelRun` 的挂载点 ③、`waitRun` 的挂载点 ② 都经它；`pruneRunDirs` 的到期整删在 worker 一半（`workerStillAlive`）之外再问同一个 CLI 一半，CLI 组仍活着、判不了或记录读不懂时当作仍在用、不删、计入 kept。
> **用户已定（2026-09-29，送审前）**：只做 EV-157（EV-161、EV-162、EV-159 第二形态不并入）；三处都改，判据与 `admitScrub` 同源、抽成单一来源，`admitScrub` 改用它且行为不变；CLI 仍活着 / 判不了 / 记录读不懂时，取消与等待两处不抹、按事实告警（哪一侧、哪个进程组、为什么），留给会话启动清扫，到期整删不删、计入 kept；不新增结束进程的动作（`--wait` 仍不结束任何进程，`--cancel` 按记录结束 CLI 的既有做法不变，准入判的是结束之后的事实）；`cancelLostWorker` 那一格仍不抹、范围不动；凭据副本与运行目录的形状、哨兵语义、清扫子命令的输出格式不改，新增告警之外的输出逐字不变；不花配额；超范围的问题登记暂缓、不停下。
> **本稿自定、请审查员重点看的**：单一来源的形状（D1）；到期整删只加 CLI 一半、被挡下的过期目录落回「未到期」路径（D2）；「记录读不懂」到期不删之后，清扫子命令里「或等 run_dir_days 整删」那半句失实——本稿建议改掉这半句，与「输出逐字不变」有冲突（D3）；告警文案（D4）；`--cancel` 的归档收尾仍只看 worker 一半（D5）；给 `cancelRun` 开一个单测注入口（D6）；到期整删的 worker 一半另有缺口，暂缓新登（D7）。

- **日期**：2026-09-29
- **主题**：`取消与失联的凭据准入核CLI`（`topic claim` plan → claude，2026-09-28T23:06:25Z）
- **起点**：`08396d2`（`main`，clean）。下文行号均取自该提交的**源码**
- **上位**：BACKLOG EV-157（本主题）；EV-38 / EV-154（`CLI进程组记录`，`admitScrub` 的 CLI 一半与记录本身）；EV-146 / EV-159（`--cancel` 终态分支的两格，不动）；`.reviews/CLI进程组记录/plan/` r2 §4.5（准入口径）与 §7.3（本条的来历）；`doc/05_testing/REPORT_2026-09-28_cli_pgroup_record.md`（I6 / B5：会话启动清扫与 `trivium scrub` 在 CLI 仍活时不抹）
- **全量基线**：`npm run check` 2241 / 2239 / 0 / 2（`08396d2`，上一主题报告）
- **文档基线**：主设计 v1.3.57、LLD v1.1.15、MANUAL v1.0.15、PRD 核后定

---

## 0. 范围与不做

| 做 | 不做 |
| :--- | :--- |
| `status.ts`：`cliGroupsConfirmedGone` 改为逐条判完并返回全部阻挡项 `blockers`（`why` 保持今天的文字）；新增组合判据 `scrubAdmission` 与文案函数 `scrubHoldWhy`（§3.1） | 改 `judgeCliGroup` / `cliRecordsOf` 的口径；改 `workerConfirmedGone` |
| `retention.ts`：`admitScrub` 改经 `scrubAdmission`，分档与文字不变（§3.2）；`pruneRunDirs` 到期整删前问 `cliGroupsConfirmedGone`（§3.3） | 把到期整删的 worker 一半从 `workerStillAlive` 换成 `workerConfirmedGone`（D2、D7） |
| `run-protocol.ts`：`cancelRun` 挂载点 ③ 与 `waitRun` 挂载点 ② 改经 `scrubAdmission`，CLI 挡住时按事实告警（§3.4、§3.5） | 新增任何结束进程的动作；改 `cancelLostWorker`、`finalizeGoneWorker`、终态早退分支 |
| `cli.ts` 清扫子命令的一句提示、两处注释里「或等 run_dir_days 整删」改准（D3） | 清扫子命令的 JSON 字段与其余人读行；凭据副本、运行目录、哨兵的形状 |
| 单测、集成、变异、零配额验收（新旧构建，旧 = `08396d2`）、doctor 自检；主设计 / LLD / MANUAL / PROTOCOL / BACKLOG 同步，PRD 核后定（§4、§5） | 真实厂商 CLI 实测；skill 文本与入口资产；run.v2 schema；本仓根 `CLAUDE.md`（EV-138） |

---

## 1. 现状（逐条对照代码，`08396d2`）

### 1.1 四个挂载点与各自的准入

| 挂载点 | 位置 | 判据 | 抹 / 删的动作 |
| :--- | :--- | :--- | :--- |
| ② `--wait` 判 `worker_lost` | `run-protocol.ts` :1253-1267 | `workerConfirmedGone(meta0, fallbackPid)`，不核 CLI | `scrubRunDir`；未过则 `scrubNote = 凭据副本未抹：〈why〉（〈reason〉），留给会话启动清扫` |
| ③ `--cancel` 主路径 | `run-protocol.ts` :1775-1785 | `workerConfirmedGone(readStatus, pid)`，不核 CLI；判在按记录结束 CLI（:1754-1765，b / c 格）**之后** | `scrubRunDir`；未过则 `warn(凭据副本未抹：〈why〉——留给会话启动清扫)` |
| ④ 会话启动清扫 / `trivium scrub` | `retention.ts` :116-136 `admitScrub` | `workerConfirmedGone` + `cliGroupsConfirmedGone`（EV-38） | `applyScrub`；CLI 挡住计入 `deferred` 与 `deferredCli` |
| 到期整删 | `retention.ts` :219-229 `pruneRunDirs` | 只看 `workerStillAlive`（:99-104：非终态且 pid 是同一进程） | `fs.rm(dir, { recursive: true, force: true })` |

- `cancelRun` 的 `goneNow`（:1775）还有第二个用途：传给 `finalizeCancelledRunMeta` 的 `workerGone`（:1801），决定归档 run.json 能否收尾为 `cancelled`。
- `waitRun` 的归档收尾另用 `goneForArchive`（:1184-1187，改写 status.json **之前**的事实），与挂载点 ② 的 `gone` 是两次独立判定。
- `cliGroupsConfirmedGone`（`status.ts` :318-333）读到第一个阻挡项即返回：形状坏的记录优先（`CLI 记录读不懂（〈侧〉：〈原值〉；…）：判不了`），其次按记录顺序第一个 `alive`（`〈侧〉 侧审查员 CLI 进程组 〈组号〉 仍在`）或 `unverifiable`（`… 仍有活进程、启动时刻没记下：判不了`）。`reused` 与 `gone` 放行。
- `admitScrub` 的 `why` 会进人读输出：`trivium scrub` 的 `· 因审查员 CLI 未动：〈目录〉（〈detail〉）`（`cli.ts` :1923）与会话启动提示的「首个：〈目录〉（〈detail〉）」（`hooks.ts` :1570-1571）。

### 1.2 不抹副本、也不在本主题的几格

- 终态早退分支（:1666-1737）：按记录结束 CLI（EV-154 D3）、`cancelLostWorker`（EV-146）、`finalizeGoneWorker`（EV-159）——都**不调 `scrubRunDir`**，留给会话启动清扫。用户决策「`cancelLostWorker` 那一格仍不抹副本，范围不动」，其余两格同样不动。
- runner 自己的 `finally`（挂载点 ①）：CLI 在本进程内已结束，不涉及。

### 1.3 两处取消 / 等待在 CLI 这一半的残留面

- `--cancel` 主路径：b 格（worker 被升级 SIGKILL）与 c 格（worker 此前已不在）已先按记录结束 CLI。**结束之后仍可能挡住准入的**只有：`unverifiable`（没记下启动时刻而组长还在，不发信号）、形状坏（不发信号）、发了信号而未确认退出（`gone: false`）。a 格（worker 活着、自己的 SIGTERM 处理器转发）里处理器的看门狗到点而 CLI 未结束时，记录里的组仍活着——这一格今天也照抹。
- `--wait`：不结束任何进程，worker 被强杀 / 崩溃之后 CLI 仍在的全部形态都会撞上。

### 1.4 到期整删的现状

`run_dir_days` 缺省 30 天。worker 已不在（或 status 为终态）、最后活动早于保留期即 `fs.rm`，不问 CLI。记录里有仍活着的 CLI 组意味着 CLI 活过了保留期而运行目录无活动——现实触发面近于零（EV-157 原文），但整删比抹副本更不可逆，按用户决策与另两处同口径。

---

## 2. 覆盖矩阵

「记录」指 status.json 的 `sides[c].cli`。格名沿用用户要求的五格：

| 格 | 含义 | `cliGroupsConfirmedGone` |
| :--- | :--- | :--- |
| A 仍活着 | 组长在、规范化启动时刻相符（`alive`） | 挡住 |
| B 已结束 | 组长不在（`gone`），或组号已被别的进程占用（`reused`） | 放行 |
| C 判不了 | 组长在、`started_at` 为 null（`unverifiable`） | 挡住 |
| D 读不懂 | `cli` 键在而形状不合法（`malformed`） | 挡住 |
| E 没有记录 | 两侧 `cli` 缺席或 null | 放行 |

三处的预期（worker 一半已通过，即「工作进程已不在」）：

| 格 | `--cancel` ③ | `--wait` ② | 到期整删 |
| :--- | :--- | :--- | :--- |
| A | 不抹、告警〈侧〉〈组号〉仍在（今天：抹） | 不抹、报错正文里说明（今天：抹） | 不删、kept（今天：删） |
| B | 抹（不变） | 抹（不变） | 删（不变） |
| C | 不抹、告警判不了（今天：抹） | 不抹、说明（今天：抹） | 不删、kept（今天：删） |
| D | 不抹、告警读不懂（今天：抹） | 不抹、说明（今天：抹） | 不删、kept（今天：删） |
| E | 抹（不变） | 抹（不变） | 删（不变） |

worker 一半未通过时三处都与今天逐字相同（`--cancel` / `--wait` 的「凭据副本未抹：工作进程 〈pid〉 仍在…」，到期整删的 `workerStillAlive` kept）。

---

## 3. 改法

### 3.1 `status.ts`：单一来源（D1）

```ts
/** 挡住凭据抹除 / 到期整删的一条 CLI 记录（EV-157） */
export interface CliBlocker {
  side: CriticId;
  /** 形状坏的记录没有可信的组号，为 null */
  pgid: number | null;
  kind: 'alive' | 'unverifiable' | 'malformed';
  /** 单条的事实句：〈侧〉 侧审查员 CLI 进程组 〈组号〉 仍在 / …判不了 / 〈侧〉 侧的 CLI 记录读不懂（〈原值〉）：判不了 */
  detail: string;
}

// 形状扩展：多一个 blockers；why 逐字保持今天的「第一个阻挡项」文字（admitScrub 的 detail 会进人读输出）
export async function cliGroupsConfirmedGone(s: RunStatus | null): Promise<{ gone: boolean; why: string; blockers: CliBlocker[] }>;

/** 凭据抹除的准入（EV-20 + EV-38 + EV-157）：admitScrub、cancelRun ③、waitRun ② 共用 */
export interface ScrubAdmission {
  admit: boolean;
  /** worker 一半，原样是 workerConfirmedGone 的结果——cancelRun 的归档收尾只用这一半（D5） */
  worker: { gone: boolean; why: string };
  /** CLI 一半；worker 一半未通过时不判（null），与今天 admitScrub 只在 gone 之后才问一致 */
  cli: { gone: boolean; why: string; blockers: CliBlocker[] } | null;
}
export async function scrubAdmission(status: RunStatus | null, fallbackPid: number | null): Promise<ScrubAdmission>;

/** 未准入时的事实句（D4）：worker 一半未过 ⇒ worker.why 原样；CLI 挡住 ⇒ 〈worker.why〉，但审查员 CLI 未确认结束——〈逐条 detail，以「；」连接〉 */
export function scrubHoldWhy(a: ScrubAdmission): string;
```

- `cliGroupsConfirmedGone` 不再读到第一个阻挡项就返回，而是逐条判完、收齐 `blockers`（形状坏的在前，其余按记录顺序）；`why` 按今天的规则由 `blockers` 生成：有形状坏的 ⇒ `CLI 记录读不懂（〈侧〉：〈原值〉；…）：判不了`，否则取第一条的 `detail`；没有阻挡项 ⇒ `记录里没有仍在的审查员 CLI`。**逐字不变**由 U1 钉住。
- 代价：两侧都挡住时多判一次（一次 `kill(pgid, 0)`，组长在时多一次规范化 `ps`）。记录通常在 CLI 退出时已清成 null，只有 worker 死在 CLI 之前的目录才有记录。
- `scrubAdmission` 就是今天 `admitScrub` 前半段的逐行搬移：`workerConfirmedGone(status, fallbackPid)`；通过才问 `cliGroupsConfirmedGone(status)`；`admit = worker.gone && cli.gone`。
- **到期整删为什么不走 `scrubAdmission`**：它的 worker 一半是 `workerStillAlive`（活着才保留），比 `workerConfirmedGone`（确认不在才准入）宽。换过来会让「status 读不到」「非终态而拿不到 pid」的过期目录永远删不掉——这是整删语义的改动，不属 EV-157（D2 / D7）。到期整删只加 CLI 一半，用的是**同一个** `cliGroupsConfirmedGone`，判据仍是一处。

### 3.2 `retention.ts` `admitScrub`（:116-136）

```ts
const a = await scrubAdmission(status, await readWorkerPid(dir));
if (a.admit) return true;
if (a.worker.gone) {            // worker 已不在而 CLI 挡住：走到这里 status 必然读得到
  out.deferred.push(dir);
  out.deferredCli.push({ dir, detail: a.cli!.why });
  return false;
}
if (status) out.deferred.push(dir);
else out.unknown.push(dir);
return false;
```

分档、`detail` 文字、调用次序与今天相同；文档块 :110-114 里「`waitRun` / `cancelRun` 自己的准入暂不核 CLI」改为「三处经 `scrubAdmission` 同源；到期整删只问 CLI 一半」。

### 3.3 `retention.ts` `pruneRunDirs` 到期整删（:224-229）

```ts
if (days > 0 && now - lastActive > ttlMs) {
  /*
   * 到期也不删还在用的目录（EV-157）：记录里的审查员 CLI 仍活着、判不了、或记录读不懂 ⇒ 当作仍在用。
   * worker 一半仍是上面的 workerStillAlive（D2）；CLI 一半与凭据抹除的准入同一个函数。
   */
  if ((await cliGroupsConfirmedGone(status)).gone) {
    if (!opts.dryRun) await fs.rm(dir, { recursive: true, force: true });
    out.removed.push(dir);
    continue;
  }
}
out.kept++;
// ── 凭据抹除（未到期，或到期而 CLI 挡住）──
```

- **被挡下的过期目录落回「未到期」那条路**：`kept++`，再走凭据抹除的准入——`admitScrub` 以同一判据把它记进 `deferred` / `deferredCli`，会话启动提示照今天的第四格如实带出（「〈N〉 个运行目录因审查员 CLI 进程组记录未动…首个：〈目录〉（〈detail〉）」）。不新增输出形态；两次判定之间 CLI 恰好结束的话，这一轮会抹副本、下一轮再删目录，无害。
- `status` 为 null（读不到）时 `cliRecordsOf` 返回空 ⇒ 放行，与今天按 mtime 删一致。
- `dryRun`：被挡下的不进 `removed`（预览与真跑同判据）。
- 文档块 :175-185 补一句「到期整删对记录里仍在的 CLI 同样保留」。

### 3.4 `run-protocol.ts` `cancelRun` 挂载点 ③（:1770-1785）

```ts
const adm = await scrubAdmission(await readStatus(runDir), pid);
const goneNow = adm.worker;                       // 归档收尾只看 worker 一半（D5），:1801 不改
if (adm.admit) { …今天的抹除与失败告警，逐行不动… }
else warn(`凭据副本未抹：${scrubHoldWhy(adm)}——留给会话启动清扫`);
```

- 判定时机不变：在 b / c 格按记录结束 CLI **之后**（用户决策「准入判的是结束之后的事实」）。此刻 status.json 里已结束的组记录还没清（清在 :1809-1820 的 `patchStatus` 里），`judgeCliGroup` 判 `gone`，放行——常态格与 b / c 格里 CLI 被按记录结束的情形输出逐行不变。
- 注释 :1771-1774 改写：准入与另两处同源，CLI 一半在按记录结束之后判。
- worker 一半未过时的告警逐字不变。

### 3.5 `run-protocol.ts` `waitRun` 挂载点 ②（:1253-1267）

```ts
const adm = await scrubAdmission(meta0, fallbackPid);
if (!adm.admit) {
  scrubNote = `\n  凭据副本未抹：${scrubHoldWhy(adm)}（${reading.reason}），留给会话启动清扫`;
} else { …今天的抹除与失败说明，逐行不动… }
```

- 仍不结束任何进程。报错正文是这一支唯一的播报通道（r1 AGY-01 的既有口径），告警进 `scrubNote`。
- `goneForArchive`（:1184-1187）不动：归档收尾与凭据准入是两件事。
- 注释 :1247-1252 改写同上。

### 3.6 告警文案（D4）

worker 一半通过、CLI 一半挡住时：

- `--cancel`：`凭据副本未抹：工作进程 〈pid〉 已不存在，但审查员 CLI 未确认结束——gemini 侧审查员 CLI 进程组 〈组号〉 仍在；glm 侧审查员 CLI 进程组 〈组号〉 仍有活进程、启动时刻没记下：判不了——留给会话启动清扫`
- `--wait`：`凭据副本未抹：〈同上〉（pid_gone），留给会话启动清扫`
- 形状坏的一条：`〈侧〉 侧的 CLI 记录读不懂（〈原值，截断 200 字〉）：判不了`。

「哪一侧、哪个进程组、为什么判不了」三项都在 `detail` 里；两侧都挡住时逐条列出，不像 `why` 那样只取第一条（`why` 保持今天的文字是为了清扫子命令的输出不变）。`--cancel` 在 C / D 格里 `reportRecordedCliGroups` 已经各打过一行「不发信号——请用 ps 核对」，这一行说的是另一件事（副本没抹、为什么），不合并。

### 3.7 「或等 run_dir_days 整删」（D3）

§3.3 之后，记录读不懂的运行目录到期也不删。下面几处说法随之失实：

| 位置 | 今天 | 改为 |
| :--- | :--- | :--- |
| `cli.ts` :1924（`trivium scrub` 人读输出） | `「记录读不懂」不会自愈，需把该侧 cli 改回 null 或等 run_dir_days 整删` | `「记录读不懂」不会自愈，需把该侧 cli 改回 null（到期整删也会保留它）` |
| `hooks.ts` :1567（注释） | `要人把该侧 cli 改回 null，或等 run_dir_days 整删` | 同上 |
| `run-protocol.ts` :871（注释） | `出口是人把该侧 cli 改回 null，或等 run_dir_days 整删` | 同上 |
| MANUAL :632 | `它会一直不抹，直到 run_dir_days 到期整删那个运行目录` | 到期也不删，出口只有改回 null |

**冲突**：用户定了「清扫子命令的输出格式不改；新增告警之外的输出逐字不变」。`cli.ts` :1924 是清扫子命令的一行人读输出。本稿建议改：格式（行数、位置、触发条件）不变，只把一个会被本主题做成假话的半句改准；留着它，就是工具在人读输出里给出一条走不通的出口。**请审查员判断**；若认为应严守逐字不变，替代是保留原句并在 BACKLOG 登记文案失实——本稿不倾向。

### 3.8 测试注入口（D6）

`CancelOptions`（:1484-1486）加可选 `terminateCli?: (s: RunStatus | null) => Promise<RecordedCliOutcome>`，缺省 `terminateRecordedCliGroups`；b / c 格两处调用改经它。只为单测造「发了信号而未确认退出、组仍活着」（A 格在 `--cancel` 下的唯一现实形态：真实进程在 SIGKILL 之下必死，零配额造不出）。与既有的 `terminateWorker` 同形。

---

## 4. 验证

### 4.1 单测（新文件 `test/unit/scrub-admission.test.ts`）

CLI 组用 `spawn('sh', ['-c', 'sleep 600; : "$0"', 标记], { detached: true })` 造真实进程组，记录的 `started_at` 取 `processStartTime(pgid, { canonical: true })`；worker 用已退出的 pid（先起一个 `node -e ''` 等它退出）。每格只往本格的 mkdtemp 里写；收尾按组结束（`test/helpers/proc.ts` 的 `killGroup`）。

| 用例 | 内容 |
| :--- | :--- |
| U1 | `cliGroupsConfirmedGone`：A / B（gone 与 reused 两种）/ C / D / E 五格的 `gone`、`blockers`；两侧都挡住时 `blockers` 两条、`why` 逐字等于今天的「第一条」文字；形状坏与活组并存时 `why` 是「读不懂」那句、`blockers` 形状坏在前 |
| U2 | `scrubAdmission`：worker 已不在 × 五格的 `admit`；worker 仍在（本进程 pid + 真实启动时刻）时 `cli` 为 null、形状坏的记录也不判；`scrubHoldWhy` 两种形态的文字 |
| U3 `admitScrub` 不变 | 经 `scrubAllRunRoot` 与 `pruneRunDirs`（未到期）：worker 已不在 × 五格的 `scrubbed` / `deferred` / `deferredCli` 分档与 `detail` 文字；worker 仍在而记录形状坏 ⇒ 只进 `deferred`、不进 `deferredCli`（今天如此）。既有 `retention.test.ts` 的 EV-154 U14 两条原样保留 |
| U4 到期整删 | `pruneRunDirs`（`now` 推到保留期之后）：五格的 `removed` / `kept`、目录在不在；A / C / D 同时进 `deferredCli`；`dryRun` 下 A 格不进 `removed`；`run_dir_days: 0` 时不问 CLI（没有整删就没有这一问） |
| U5 `--cancel` | 进程内 `cancelRun`（夹具同 `run-protocol.test.ts` 的 `fakeCtx` / `seedRun` 形态，worker 已死、status 非终态、glm 侧放一份载体）：A（`terminateCli` 注入「未确认退出」，组仍活着）/ B / C / D / E；断言载体在不在、stderr 的「凭据副本未抹：…〈侧〉…〈组号〉…」与没有这行、**归档 run.json 在五格里都收尾为 `cancelled`**（D5）、status.json 为 `cancelled`、锁已回收 |
| U6 `--wait` | 进程内 `waitRun`（worker 已死 ⇒ `pid_gone`）：五格；断言载体、报错正文的 `凭据副本未抹：…（pid_gone）`、A / C 格的组在 `--wait` 之后仍活着（不结束进程）、归档 run.json 在五格里都收尾为 `failed` |
| U7 回归 | worker 仍在（`heartbeat_stale`）时 `--wait` 的「凭据副本未抹：工作进程 〈pid〉 仍在（heartbeat_stale）」逐字不变（既有 `gate-loop` :980 与 `run-protocol.test.ts` L2 之外，这里直接比整句） |

### 4.2 集成（`gate-loop.test.ts`，真实 bundle 与 `hang_cli` 桩，沿用 `startWithRecordedClis` / `killWorker` / `groupMemberCount`）

| 用例 | 序列与断言 |
| :--- | :--- |
| K1 `--wait` | 两侧 `hang_cli`，按组 SIGKILL worker（CLI 仍活），glm 侧放载体 → `--wait` 退 1、判失联；报错正文按两侧列出组号、`仍在`；载体仍在；两组仍各有成员（`--wait` 不结束进程）→ 按组结束两组 → 会话启动 Hook ⇒ 载体已抹 |
| K2 `--wait`，CLI 已结束 | 同 K1，但 `--wait` 之前先结束两组 ⇒ 载体已抹、正文没有「凭据副本未抹」 |
| K3 `--cancel`，判不了 | 两侧 `hang_cli`，SIGKILL worker，把 status.json 两侧的 `started_at` 改成 null（worker 已死，无并发写者）→ `--cancel` 退 0；stderr 两行「判不了…不发信号」、一行「凭据副本未抹：…gemini 侧…判不了；glm 侧…判不了——留给会话启动清扫」；载体仍在；两组仍活；run.json `cancelled` → 结束两组 → 会话启动 Hook ⇒ 载体已抹 |
| K4 `--cancel`，按记录结束之后 | 两侧 `hang_cli`，SIGKILL worker → `--cancel` 按记录结束两组（既有 I3 形态）⇒ 载体已抹、stderr 没有「凭据副本未抹」 |

`--cancel` 在 A 格（组相符而仍活着）下会先按记录把它结束，所以集成里「两侧 CLI 挂着、`--cancel` 之后副本仍在」只能用 C / D 格造（K3）；A 格由 U5 的注入口覆盖。

### 4.3 源码变异（`scripts/mutation-check.mjs`；规格由 `gen-mutation-spec.mjs` 从源码截锚点并核对唯一；失败用例名与文案用 `mutation-names.mjs` 补）

| 编号 | 变异 | 期望红 |
| :--- | :--- | :--- |
| M1 | `cancelRun` 抹除改看 `adm.worker.gone`（回到今天） | `scrub-admission`（U5 A / C / D） |
| M2 | `waitRun` 抹除改看 `adm.worker.gone` | `scrub-admission`（U6） |
| M3 | 到期整删去掉 CLI 一问 | `scrub-admission`（U4） |
| M4 | 到期整删被挡下后 `continue`（不计 kept、不走凭据准入） | `scrub-admission`（U4 kept 与 `deferredCli`） |
| M5 | `cancelRun` 归档收尾改传 `adm.admit`（D5） | `scrub-admission`（U5 归档断言） |
| M6 | `scrubAdmission` 在 worker 一半未过时也判 CLI | `scrub-admission`（U2 `cli` 为 null；U3 形状坏只进 `deferred`） |
| M7 | `cliGroupsConfirmedGone` 的 `why` 改为全部阻挡项连写 | `scrub-admission`（U1 `why` 逐字） |
| M8 | `scrubHoldWhy` 只取第一条 `detail` | `scrub-admission`（U1 / U5 两侧都在告警里） |
| M9 | `unverifiable` 不挡 | `scrub-admission`、`retention` |
| M10 | 形状坏不挡 | `scrub-admission`、`retention` |
| M11 | `scrubHoldWhy` 在 worker 一半未过时加前缀 | `scrub-admission`（U7） |
| M12 | `admitScrub` 的 `deferredCli.detail` 改用 `scrubHoldWhy` | `scrub-admission`（U3 detail 逐字） |

每条记 fail 数与失败用例名；没咬住的逐条论证是否等价。

### 4.4 零配额验收（scratchpad → `doc/05_testing/evidence/cancel-wait-cli-admission-20260929/`）

新构建 = 工作树；旧构建 = `git archive 08396d2`（带 `.reviews/`，`node_modules` 软链工作树，只叠加必要的桩——`08396d2` 的 `hang_cli` 已有全部所需选项，预计无叠加）。新旧都直接 `node` 调 bundle 路径，记 sha256 并断言不同；比对前的归一化覆盖主题名、run_id、时间戳、路径、pid 与组号。

| 格 | 序列 | 新 | 旧 |
| :--- | :--- | :--- | :--- |
| A1 | K1 序列到 `--wait` | 载体在、正文多一行「凭据副本未抹…两侧…」、两组仍活 | 载体已抹、没有该行 |
| A2 | K3 序列到 `--cancel` | 载体在、多一行告警、run.json `cancelled` | 载体已抹、run.json `cancelled` |
| A3 | 到期整删：worker 已死、两组仍活，把心跳与目录时间推到 31 天前，跑会话启动 Hook | 目录在、提示多出第四格那行、没有「已清理」 | 目录已删、「已清理 1 个」 |
| A4 | A1～A3 的后半：结束两组之后再跑 Hook | 载体已抹 / 目录已删 | （同，基线已处理） |
| A5 | K4、K2：CLI 已结束 | 与旧逐行相同、退出码相同 | — |
| A6 | 常态：`hang_cli` 常态 `--cancel`（a 格）、`hang` 正常跑完 | 与旧逐行相同、退出码相同 | — |
| A7 | `trivium scrub`：worker 已死、CLI 仍活 → CLI 结束后再跑 | 与旧逐行相同（`admitScrub` 行为不变）、退出码相同 | — |
| A8 | 新旧对同一现场的退出码 | A1 两者都是 1、A2 两者都是 0 | — |

「其余输出逐字不变」的判法：新旧 stdout 与归一化后的 stderr 逐行 diff，只允许出现 §3.6 的那一行（A1 / A2）或第四格那一行（A3），其余为空。

### 4.5 doctor 自检与全量

`doctor --selftest`（仓库构建 + `TRIVIUM_ASSET_ROOT`）14 / 14；`npm run check` 至少两次（文档同步前后）。已知偶发红 EV-149 / EV-153 若出现，单跑复核、截失败文案、如实记录。

---

## 5. 文档同步

| 文件 | 落点 |
| :--- | :--- |
| 主设计 → v1.3.58 | 当前版本行；「审查员 CLI 进程组记录」段（:1477）的准入句：三处经同一判据、到期整删同样保留；10.5 凭据行（:2253）准入句；变更记录行 |
| LLD → v1.1.16 | 版本行；`waitRun` 判失联一节（:285 附近）与 `cancelRun` 引述块（:471、:483-485）的准入句；已知缺口表 :601 那一行改为已修、另记 D7 |
| MANUAL → v1.0.16 | :632 那句（D3）；取消 / 失联一节补「CLI 仍活着时副本不抹、告警长什么样、留给会话启动清扫」 |
| PROTOCOL | `scrub` 行（:369）不改判据描述；`review --cancel / --wait` 行补一句准入同源 |
| BACKLOG | EV-157 done；新登 EV-163（D7）；EV-38 / EV-154 注记指向本条 |
| PRD | 核：对凭据只有 NFR-04「不入归档」、对 `--cancel` 只有 FR-24——预计不改，核后定 |

---

## 6. 风险与边界

### 6.1 对既有不变量

- **`admitScrub` 行为不变**：分档、`detail` 文字、判定次序逐行搬移；U3 与验收 A7 钉住。唯一差别是两侧都挡住时多判一侧（多一次 `kill 0` 与可能一次 `ps`），不改结果。
- **常态格输出不变**：正常结束的运行记录已清成 null；`--cancel` 在 a / b / c 格里 CLI 已结束时判 `gone` 放行（验收 A5 / A6）。
- **归档收尾不连坐**：`--cancel` 的 `finalizeCancelledRunMeta` 仍只看 worker 一半；`--wait` 的 `goneForArchive` 本来就是另一次判定。
- **不新增结束进程的动作**：`scrubAdmission` 只读进程表。
- **cli-group-record、EV-146、EV-159 那几格不动**：终态早退分支不调凭据准入。

### 6.2 如实保留

- **记录读不懂的运行目录永远不整删**（用户决策的直接后果）：出口只有人把该侧 `cli` 改回 null。只在手改坏或未来版本改了形状时出现。
- **判不了的**：`started_at` 为 null 而组长 pid 被别的长寿进程复用时，同样一直保留（没有比对基准就判不出 `reused`，EV-154 AGY-01 同口径）。
- **两次判定之间的窗口**：到期整删被挡下之后、凭据准入之前 CLI 恰好结束 ⇒ 这一轮抹副本、下一轮删目录。无害，无用例。
- **组长已退出而组员还在**（EV-154 用户决策 4）：判 `gone` 放行，组员若仍在用副本会照抹——与 `admitScrub` 今天同口径，不在本主题。
- **秒级启动时刻精度**、**判定与抹除之间 CLI 新起**：不适用（worker 已不在，没有人会再派生 CLI）。
- 实测只在 Node v25.2.1 / macOS。

### 6.3 相邻、不在本主题（D7：暂缓并新登 EV-163）

**到期整删的 worker 一半**：`workerStillAlive` 对终态一律返回 false。`--wait` 判 `heartbeat_stale` 时把**活着的** worker 写成 `failed`（EV-146 那一格）；若它一直挂着而无人 `--cancel`，保留期过后到期整删会删掉一个 worker 仍活着的运行目录。与 EV-157 同形（「还在用的目录被删」），但判的是 worker 而不是 CLI；修它要把到期整删的 worker 一半改成 `workerConfirmedGone` 口径，并论证「status 读不到 / 非终态而拿不到 pid」的过期目录怎么收（否则永远删不掉），是整删语义的改动。现实触发面：一个挂住 30 天的 worker。用户决策「只做 EV-157」，**暂缓并新登**。

### 6.4 回滚

不产生新的文件、字段与取值。回滚即回退 `status.ts`、`retention.ts`、`run-protocol.ts`、`cli.ts`、`hooks.ts` 与用例；`npm run build`、`npm run check`；由用户在终端重装。

---

## 7. 决策点

| 编号 | 问题 | 本稿取法 | 理由 |
| :--- | :--- | :--- | :--- |
| D1 | 单一来源的形状 | `scrubAdmission`（组合）+ 扩展 `cliGroupsConfirmedGone` 返回 `blockers`；`why` 保持旧文 | 三处准入一个函数；到期整删与之共用 CLI 一半；清扫子命令输出不变 |
| D2 | 到期整删的判据 | worker 一半仍 `workerStillAlive`，只加 CLI 一半；被挡下的落回未到期路径（kept + 凭据准入） | 换 worker 一半是整删语义改动（D7）；落回未到期路径复用第四格的人读提示，不新增输出形态 |
| D3 | 「或等 run_dir_days 整删」 | 改准（`cli.ts` :1924 一行输出 + 两处注释 + MANUAL） | 不改就是给出走不通的出口；与「输出逐字不变」冲突，请审查员判 |
| D4 | 告警文案 | worker 一半未过时逐字不变；CLI 挡住时列出全部阻挡项 | 用户要「哪一侧、哪个进程组、为什么」；两侧都挡住时只说一侧不如实 |
| D5 | `--cancel` 归档收尾 | 仍只看 worker 一半 | 归档 `cancelled` 说的是 worker 的事实；CLI 挡住只影响副本 |
| D6 | 单测注入口 | `CancelOptions.terminateCli` | A 格在 `--cancel` 下零配额造不出；与 `terminateWorker` 同形 |
| D7 | 到期整删的 worker 一半 | 暂缓，新登 EV-163 | 用户决策只做 EV-157；是另一半判据的语义改动 |

## 8. 流程（命令 A，一口气跑）

plan 已认领 → 本稿 → 计划双审 → 逐条裁决（`…-revised-claude.md`）→ `gate --check` → 认领 code → 编码与 §4 全部验证、实施报告 `doc/05_testing/REPORT_2026-09-29_cancel_wait_cli_admission.md` → 代码双审 → 应答 → 按接受项修订并重跑读数 → `verify`。不提交、不推送、不审批。
