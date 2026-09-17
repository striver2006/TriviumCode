/**
 * 运行目录的保留期清理（设计 §6.2 / RUNBOOK：「默认保留 30 天」）。
 *
 * `retention.run_dir_days` 原先只有配置与文档、没有任何实现：`~/.trivium/runs`
 * 无限增长（审核时已 3400 个目录、580MB，每次运行还各留两份 zcode 凭据副本）。
 *
 * **整删**只清理本项目的桶 `<run_root>/<repoId>/`：别的项目的运行目录是别人的排障材料。
 * 判据：运行已终态（或 worker 已不在）且最后活动时间早于保留期。进行中的运行
 * （status 非终态且 worker 进程还活着）一律不动，哪怕它很老。
 *
 * **凭据抹除**有两个入口，作用域不同而判据同源（共用 `admitScrub` + `applyScrub`）：
 * `pruneRunDirs` 挂在会话启动上、只进本项目桶；`scrubAllRunRoot` 是显式子命令
 * `trivium scrub`、遍历整个运行根但**一个目录都不删**（BACKLOG EV-33）。
 * 分两个入口而不是给前者加个开关：会话启动是 pull 式时机，把别的仓库的目录卷进来
 * 会让一次「开个会话」变成对整台机器的遍历；而跨仓清扫本就该由人显式发起。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Config } from './types.js';
import { runRoot } from './config.js';
import { repoId } from './review.js';
import { isTerminal, readStatus, workerConfirmedGone, type RunStatus } from './status.js';
import { processAlive } from './util/exec.js';
import { RUN_DIR_FILES } from './run-files.js';
import { scrubDidWork, scrubRunDir, sideLayerPending, type AdapterLookup } from './scrub.js';

/** 读运行目录那一层的 `worker.pid`：`status.json` 缺失或没记 pid 时的同源兜底 */
async function readWorkerPid(dir: string): Promise<number | null> {
  try {
    const n = Number.parseInt(await fs.readFile(path.join(dir, RUN_DIR_FILES.workerPid), 'utf8'), 10);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/**
 * 凭据抹除的分档计数——`pruneRunDirs`（本项目桶）与 `scrubAllRunRoot`（整个运行根）共用。
 *
 * 抽出来是因为两条路径的**判据必须同源**：EV-33 要的跨仓清扫如果另写一套准入判断，
 * 「status 读不到一律跳过」这条严判据就有两个实现，改一处漏一处不会报错（纪律 10）。
 *
 * **分档要闭合**：看过的每个运行目录都必须落进恰好一格，否则人读输出会自称全景而漏掉一类
 * （代码双审 GLM-04：`starting`、拿不到 pid、终态但进程仍活这三类此前哪一格都不进，
 * 而 `starting` 类可能已经写下了凭据副本）。
 */
export interface ScrubTally {
  /** 本次真抹了**凭据**的运行目录：载体整删、扫描命中删除、或该侧日志就地脱敏 */
  scrubbed: string[];
  /**
   * 本次**只**动了运行目录那一层（`request.json` 等就地脱敏）、侧层一份载体没碰的目录。
   *
   * 与 `scrubbed` 分两格是因为人读文案说的是「抹除凭据副本」，而这一格一份副本都没抹
   * （代码双审 GLM-06：判据含 `runDir.redacted` 时，话比事实强）。
   * 它也是 `settled` 与真跑之间那点不对称的落点：侧层哨兵已收工的目录仍会走这一层。
   */
  runDirRedacted: string[];
  /** 抹除失败的运行目录与首个原因——要进人读输出，不能只躺在哨兵里 */
  scrubFailed: { dir: string; reason: string }[];
  /** `status.json` 读不到（缺失或损坏）、因此**没做**不可逆抹除的目录 */
  unknown: string[];
  /**
   * 准入判据未过、而 `status.json` **读得到**的目录：`starting`（副本可能正在写下）、
   * 非终态但拿不到 pid、终态但 pid 现势仍是同一活进程。
   *
   * 不抹它们是 EV-20 的既定安全决策，登记这一格只为**可见**——它们此前不计 `alive`
   * （`workerStillAlive` 对三类都返回 false）、不计 `unknown`（status 存在）、
   * 也不进 `eligible`/`settled`，于是对所有入口都不可见地躺到 TTL（代码双审 GLM-04）。
   */
  deferred: string[];
  /**
   * 抹过但没扫完——那几份仍未脱敏。`detail` 区分两种成因：
   * 侧层（超大 / 回读面下的二进制 / 读不了）留空，取证去该侧的 `scrub.json`；
   * 运行目录层带上首条告警原文，因为**那一层刻意不写哨兵**，按「详见该侧 scrub.json」
   * 翻过去会一无所获（代码双审 CODEX-04 ≡ AGY-02 ≡ GLM-03）。
   */
  incomplete: { dir: string; detail?: string }[];
}

export interface PruneResult extends ScrubTally {
  removed: string[];
  kept: number;
}

const emptyTally = (): ScrubTally => ({
  scrubbed: [], runDirRedacted: [], scrubFailed: [], unknown: [], deferred: [], incomplete: [],
});

/**
 * 一个运行目录的 worker 现势还在不在：非终态且 pid 确实是同一进程才算活着。
 * `pruneRunDirs` 用它决定「无论多老都不动」，`scrubAllRunRoot` 用它决定「跳过不抹」。
 */
async function workerStillAlive(status: RunStatus | null): Promise<boolean> {
  if (!status || isTerminal(status.phase) || !status.worker_pid) return false;
  const a = await processAlive(status.worker_pid, status.worker_started_at ?? null);
  return a.alive && a.sameProcess;
}

/**
 * 抹除的准入判据——两条清扫路径共用，拆成独立一件是因为**预览也要走它**：
 * 不走，`--dry-run` 的清单会把 status 读不到的目录算进「本会抹」。
 *
 * 判据与 `waitRun` / `cancelRun` 共用 `workerConfirmedGone`（代码双审 r2 三侧收敛）。
 * 终态也要看进程：`waitRun` 判 `heartbeat_stale` 时会把**活着的**进程写成 failed。
 * 调用前假定已确认 worker 不活（`workerStillAlive` 为 false）。
 */
async function admitScrub(dir: string, status: RunStatus | null, out: ScrubTally): Promise<boolean> {
  const gone = await workerConfirmedGone(status, await readWorkerPid(dir));
  if (gone.gone) return true;
  // 「没有证据说它死了」与「它还活着」是两回事：前者要让人知道，后者是正常状态。
  // 两种都要落格，否则看过的目录会有一类哪一格都不进（代码双审 GLM-04）。
  if (status) out.deferred.push(dir);
  else out.unknown.push(dir);
  return false;
}

/** 真抹一个运行目录并把结果记进计数——准入已由 `admitScrub` 判过 */
async function applyScrub(
  dir: string,
  adapters: AdapterLookup,
  out: ScrubTally,
  sizeCap?: number,
): Promise<void> {
  let r;
  try {
    r = await scrubRunDir(dir, adapters, { sizeCap }); // 非 force：哨兵已记 ok 的侧跳过
  } catch (e) {
    out.scrubFailed.push({ dir, reason: (e as Error).message });
    return;
  }
  const outcomes = Object.values(r.sides).filter((o) => o !== undefined);
  /*
   * 运行目录**那一层**的失败也要在这里报：那一层刻意不写哨兵（run-files 对账的论域），
   * 于是它没有「留在盘上等人读」这条退路，调用方不报就是三条通道全灭。
   */
  const reason = outcomes.find((o) => !o.ok)?.errors[0] ?? r.runDir.errors[0];
  if (reason !== undefined) out.scrubFailed.push({ dir, reason });
  else {
    // 只有真删了/真抹了才算 scrubbed：「没得抹」的空目录不能报成「已抹除」（代码双审 r1 GLM-05）
    if (outcomes.some((o) => !o.skipped && scrubDidWork(o))) out.scrubbed.push(dir);
    // 只动了运行目录那一层的单列一格：人读文案说的是「凭据副本」，而这一格一份副本都没抹
    else if (Object.keys(r.runDir.redacted).length > 0) out.runDirRedacted.push(dir);
  }
  /*
   * 扫完了没有是另一问：跳过的那几份仍未脱敏，人得知道（代码双审 r2 AGY-02 ≡ CODEX-06 ≡ GLM-05）。
   * 两种成因的**取证路径不同**：侧层去翻该侧的哨兵，运行目录层没有哨兵可翻——
   * 所以后者必须把告警原文带出来，否则计数亮了而「哪份文件为何跳过」哪都没有
   * （代码双审 CODEX-04 ≡ AGY-02 ≡ GLM-03）。
   */
  if (outcomes.some((o) => o.complete === false)) out.incomplete.push({ dir });
  else if (r.runDir.skipped > 0) out.incomplete.push({ dir, detail: r.runDir.warnings[0] ?? '运行目录层有文件未扫描' });
}

/**
 * 两件事，两套判据：
 *
 * - **到期整删**：沿用原判据（终态或 worker 已死，且最后活动早于保留期；status 读不到按 mtime）。
 *   `run_dir_days <= 0` 关闭这一支。
 * - **凭据抹除**（EV-20，挂载点 ④）：对**未到期**的目录逐侧调适配器抹载体。
 *   与整删解耦——它是安全底线，不该挂在一个可以关掉的档位上（计划双审 CODEX-04）；
 *   判据比整删**更严**：抹除不可逆，`status.json` 读不到（缺失或损坏）一律**跳过并计数**，
 *   `starting`（worker_pid 尚为 null 的拉起瞬间）也跳过（CODEX-05 ≡ AGY-04）。
 *   传 `adapters` 才做；不传（旧调用形态）行为与原先一致。
 */
export async function pruneRunDirs(
  cfg: Config,
  projectRoot: string,
  opts: { now?: number; dryRun?: boolean; adapters?: AdapterLookup; sizeCap?: number } = {},
): Promise<PruneResult> {
  const days = cfg.retention.run_dir_days;
  const out: PruneResult = { removed: [], kept: 0, ...emptyTally() };
  const bucket = path.join(runRoot(cfg), repoId(projectRoot));
  let entries: string[];
  try {
    entries = await fs.readdir(bucket);
  } catch {
    return out;
  }
  const now = opts.now ?? Date.now();
  const ttlMs = days * 86_400_000;

  for (const name of entries) {
    const dir = path.join(bucket, name);
    let st: import('node:fs').Stats;
    try {
      st = await fs.stat(dir);
    } catch {
      continue;
    }
    if (!st.isDirectory()) continue;

    const status = await readStatus(dir);
    let lastActive = st.mtimeMs;
    if (status) {
      const hb = new Date(status.heartbeat_at).getTime();
      if (Number.isFinite(hb)) lastActive = Math.max(lastActive, hb);
    }
    if (await workerStillAlive(status)) {
      out.kept++;
      continue; // 还在跑，无论多老都不动
    }

    // ── 到期整删 ──
    if (days > 0 && now - lastActive > ttlMs) {
      if (!opts.dryRun) await fs.rm(dir, { recursive: true, force: true });
      out.removed.push(dir);
      continue;
    }
    out.kept++;

    // ── 未到期：凭据抹除 ──
    if (!opts.adapters || opts.dryRun) continue;
    if (await admitScrub(dir, status, out)) await applyScrub(dir, opts.adapters, out, opts.sizeCap);
  }
  return out;
}

export interface SweepResult extends ScrubTally {
  /** 扫过的项目桶（`<run_root>/` 下的一级目录名） */
  buckets: string[];
  /** 看过的运行目录总数 */
  visited: number;
  /** 因 worker 现势还活着而没动的运行目录数 */
  alive: number;
  /**
   * 准入判据通过、且**侧层**确实还有活要干的运行目录。
   *
   * 两条路径都填：`--dry-run` 下它是「真跑会抹哪些」，非 dry-run 下是「本轮真去抹的是哪些」。
   * 判据取自 `sideLayerPending`——与真跑的跳过判据同源，否则预览会报出一个真跑不成立的数
   * （实测：88 个目录里 84 个准入通过，而其中绝大多数哨兵早已收工，报「本会抹 84 个」是失实的）。
   *
   * **它只论侧层，这是刻意的**（代码双审 CODEX-03 ≡ AGY-01）：运行目录那一层没有哨兵，
   * 「有没有活」取决于 `request.json` 等的**内容**是否命中密钥，不读正文答不了；
   * 而预览的承诺是不动盘、也不该为了预览把三份文件整个读一遍。
   * 于是那一层的实际动作由 `runDirRedacted` 事后如实记账，预览不预测它——
   * 两者的边界写在这里，而不是让人读文案含糊带过。
   */
  eligible: string[];
  /**
   * 准入通过、但**侧层**哨兵已收工的运行目录数。
   *
   * 不等于「真跑什么都不做」：运行目录那一层每轮都复查（那层没有哨兵），
   * 因此这些目录仍可能落进 `runDirRedacted`。人读文案必须带上这个限定，
   * 否则就是第二个「真跑不成立的数」（代码双审 CODEX-03）。
   */
  settled: number;
  /**
   * `stat` / `readdir` 失败、整棵没进论域的项目桶。
   *
   * 不记账就是**整个桶**里未抹的凭据副本不出现在任何一格，而命令照常报 ok
   * ——与 `scrubRunDir` 里「运行目录读不了」是同一形状的缺口，只是高一层（代码双审 CODEX-01）。
   */
  unreadableBuckets: { bucket: string; reason: string }[];
}

/**
 * 对**整个运行根**做一次凭据清扫：只抹凭据、不删任何目录（BACKLOG EV-33）。
 *
 * ## 为什么需要它
 *
 * 会话启动清扫（`pruneRunDirs`）沿用整删的作用域 `<run_root>/<repoId>/`——**只有本项目的桶**。
 * 于是在别的仓库干活的会话不会抹这个仓库遗留的副本；崩溃、断电之后若不再回到同一个仓库
 * 开会话，副本就一直躺到 `run_dir_days` 整删（计划双审 CODEX-04 ②）。
 * 2026-09-17 实测：`UniClip` 桶下 20 个运行目录各留着一份 `home/.zcode/cli/config.json`，
 * 零哨兵——从没被抹过，因为我只在 TriviumCode 里开会话。
 *
 * ## 边界
 *
 * **不删目录**：整删是 `retention.run_dir_days` 的职责、且作用域按项目划分；
 * 跨仓遍历时删别的项目的目录是越权——那是别人的排障材料。本函数只做不可逆程度最低的那件事。
 *
 * **判据沿用严判据**：`status.json` 读不到一律跳过并计数（`admitScrub`），
 * worker 现势活着的跳过。跨仓遍历比本仓清扫更容易撞上「别的仓库正在跑的运行」，
 * 这条判据在这里只会更重要。
 */
export async function scrubAllRunRoot(
  cfg: Config,
  opts: { adapters: AdapterLookup; dryRun?: boolean; sizeCap?: number },
): Promise<SweepResult> {
  const out: SweepResult = {
    buckets: [], visited: 0, alive: 0, eligible: [], settled: 0, unreadableBuckets: [], ...emptyTally(),
  };
  const root = runRoot(cfg);
  let buckets: string[];
  try {
    buckets = await fs.readdir(root);
  } catch {
    return out; // 运行根还不存在：没跑过任何一次，不是错误
  }

  for (const b of buckets.sort()) {
    const bucketDir = path.join(root, b);
    let entries: string[];
    try {
      if (!(await fs.stat(bucketDir)).isDirectory()) continue;
      entries = await fs.readdir(bucketDir);
    } catch (e) {
      // 静默 continue 就是整桶失联而命令报 ok——同一形状的缺口在下一层刚修过（CODEX-01）
      out.unreadableBuckets.push({ bucket: b, reason: (e as Error).message });
      continue;
    }
    out.buckets.push(b);

    for (const name of entries) {
      const dir = path.join(bucketDir, name);
      try {
        if (!(await fs.stat(dir)).isDirectory()) continue;
      } catch {
        continue;
      }
      out.visited++;
      const status = await readStatus(dir);
      if (await workerStillAlive(status)) {
        out.alive++;
        continue;
      }
      /*
       * 准入判据与「有没有活干」分两问，两条路径都答：
       * 前者漏了会把 status 读不到的目录算进「本会抹」，后者漏了会把哨兵早已收工的
       * 目录也算进去——实测那是 84 比 4 的差距，预览就此变成一句真跑不成立的话。
       */
      if (!(await admitScrub(dir, status, out))) continue;
      if (await sideLayerPending(dir)) out.eligible.push(dir);
      else out.settled++;

      // 侧层没活也要真跑：运行目录那一层没有哨兵，每次都得复查一遍
      if (!opts.dryRun) await applyScrub(dir, opts.adapters, out, opts.sizeCap);
    }
  }
  return out;
}
