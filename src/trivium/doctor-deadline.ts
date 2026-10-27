/**
 * `doctor --deadline-s` 的时限控制器与临时目录台账（EV-251，预检失败自动校准计划 r2 D3）。
 *
 * 预检退 69 时 skill 会在会话里前台调 doctor，而会话的 Bash 工具有硬上限：工具超时杀掉 doctor 时，
 * 探针拉起的子进程组够不到、探针 `finally` 里删的临时目录（codex、zcode 两家放的是含真实凭据的副本）留在盘上。
 * 这里让 doctor 自己在时限内收场：
 *
 *   - 控制器是与 `runDoctor` 并行的独立路径（计划三审 AGY-02）：到点或收到信号时置「中止派生」、按组结束段内
 *     派生过的进程组、等在写的 checkpoint、再给段至多 `unwindMs` 退出来；等不到就由 `stuck` 兑现，调用方按已记的
 *     段状态出结果，不依赖挂住的 await 返回。事件循环被**同步**代码堵住时计时器得不到执行（已知边界）。
 *   - 台账：本进程经 `makeTempDir` 建的目录同步记进 `<run_root>/doctor-temp-<pid>.json`（跨桶清扫只进目录、
 *     跳过普通文件），删成功即注销；收尾时删掉本进程仍在盘上的条目，下一次 doctor 启动时补删已退出进程留下的台账。
 *     补删只认台账里的路径、且真实路径在系统临时目录下、目录名是 `makeTempDir` 的形态——不按前缀扫系统临时目录
 *     （2026-09-20 事故规矩 R1：删除类调用只认 mkdtemp 的返回值）。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  abortProbeSections, newProbeAbortToken, processMatchesRecord, processStartTime, terminateProbeSectionGroups,
  type ProbeSectionScope, type SectionTerminateResult,
} from './util/exec.js';
import { observeTempDirs, tildeHome, tryRemoveTempDir, writeAtomic } from './util/fsx.js';
import { IS_WIN } from './util/platform.js';

/** 到点后给段退出来的兜底时长（计划 r2 D3 第 5 条） */
export const DEADLINE_UNWIND_MS = 20_000;

/**
 * 收尾每一步（等按组结束、末次落盘、临时目录收尾）至少给多久（代码三审 CODEX-03）：兜底路径进来时剩余预算已近于零，
 * 三步合计至多 15 s，加上兜底时长仍在 skill 的工具超时（总时限加 60 s）之内。
 */
export const FINALIZE_STEP_FLOOR_MS = 5_000;

/**
 * `--deadline-s` 的取值范围：下限防误写成毫秒级。上限 900 s（用户 2026-10-22 定缺省 15 分钟）：skill 的工具超时
 * 是时限加 60 s（`doctorToolTimeoutMs`），即至多 960 s，超过 Claude Code Bash 工具缺省的 600 s 上限——
 * 载体侧须把上限抬到 960 s（Claude Code 是 `BASH_MAX_TIMEOUT_MS=960000`），否则时限大于 540 s 时工具会先于
 * 到点收尾把 doctor 杀掉。另三家载体的上限未实测（BACKLOG EV-251），低于此时把配置键调小。
 */
export const DEADLINE_MIN_S = 30;
export const DEADLINE_MAX_S = 900;

/** 余量：进程启动、到点后的按组结束、兜底 20 s 与收尾各步（至多 15 s）都落在里面 */
const TOOL_TIMEOUT_MARGIN_MS = 60_000;

/**
 * skill 跑一次带时限的 doctor 应设的工具超时：时限加 60 s。与 `--wait` 的 `bashTimeoutFor` 分开——
 * 那个封顶 600 s（Bash 缺省上限）；这里时限可到 900 s，封顶是 `DEADLINE_MAX_S` 加余量（960 s）。
 */
export function doctorToolTimeoutMs(deadlineS: number): number {
  return Math.min(DEADLINE_MAX_S * 1000 + TOOL_TIMEOUT_MARGIN_MS, deadlineS * 1000 + TOOL_TIMEOUT_MARGIN_MS);
}

export type DeadlineSectionState = 'finished' | 'in_progress' | 'not_started';

/** `deadline.sections` 的一项：本次要探的每一段都有（计划三审 CODEX-06） */
export interface DoctorDeadlineSection {
  only: string;
  state: DeadlineSectionState;
  /** 段作用域内派生的子进程数（含 git 辅助调用）；不区分哪几次调了模型，按上界交代配额 */
  launches: number;
  /** 该段的 notes 原文（`[cli]` 前缀那些） */
  notes: string[];
  /** 给用户在终端复制的完整命令 */
  rerun: string;
  /** 只在未探完的段出现 */
  note?: string;
}

export interface DoctorDeadline {
  limit_s: number;
  hit: boolean;
  /** 到点（deadline）还是收到信号（signal）；未到点为 null */
  reason: 'deadline' | 'signal' | null;
  /** 兜底触发：到点后段在 `unwindMs` 内没退出来，结果按控制器记的段状态给出 */
  stuck: boolean;
  sections: DoctorDeadlineSection[];
  /** 结束不了的进程组、删不掉或不敢删的临时目录 */
  residue: string[];
}

/**
 * 未探完那一段的说明。EV-243 一句不写 Agent id 或 CLI 名字面量（registry-parity 纪律）：
 * 它对哪一家都成立，是「会话里拉起」这件事的先例。
 */
export function unfinishedSectionNote(launches: number): string {
  // 一次都没派生（到点时还没开始）：不说「配额已花」（代码三审 AGY-02 ≡ GLM-05）
  if (launches === 0) return '到点时本段还没有开始，没有拉起子进程、没有花配额。请在终端单独跑上面这条命令。';
  return (
    `在时限内没探完，本段已拉起 ${launches} 次子进程，结论未落盘（其中调用模型的那几次配额已花）。` +
    '会话里拉起的厂商 CLI 有过间歇挂满单次探针超时的先例（EV-243），请在终端单独跑上面这条命令。'
  );
}

// ─────────────────────── 台账 ───────────────────────

const LEDGER_RE = /^doctor-temp-(\d+)\.json$/;
/** `makeTempDir(prefix)` 的产物形态：`trivium-…-` 加 mkdtemp 的 6 位后缀 */
const TEMP_NAME_RE = /^trivium-[A-Za-z0-9-]+-[A-Za-z0-9]{6}$/;

function ledgerFile(dir: string, pid: number): string {
  return path.join(dir, `doctor-temp-${pid}.json`);
}

async function realTmpRoot(): Promise<string> {
  // 回退分支也规范化，与 path.dirname 的结果同形（代码三审 AGY-01）
  return fs.realpath(os.tmpdir()).catch(() => path.resolve(os.tmpdir()));
}

/** 台账条目能不能删：真实路径在系统临时目录下、目录名是 makeTempDir 的形态。不在盘上返回 'gone' */
async function deletable(p: string): Promise<'yes' | 'no' | 'gone'> {
  let real: string;
  try {
    real = await fs.realpath(p);
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT' ? 'gone' : 'no';
  }
  const root = await realTmpRoot();
  // NTFS 路径大小写不敏感，盘符与目录名的大小写可能两处不一（双平台统一时补）；只会让该删的多留一条残余，不会误删
  const sameDir = IS_WIN ? path.dirname(real).toLowerCase() === root.toLowerCase() : path.dirname(real) === root;
  return sameDir && TEMP_NAME_RE.test(path.basename(real)) ? 'yes' : 'no';
}

async function removeListed(dirs: readonly string[]): Promise<string[]> {
  const residue: string[] = [];
  for (const d of dirs) {
    const v = await deletable(d);
    if (v === 'gone') continue;
    if (v === 'no') {
      residue.push(`台账里的 ${tildeHome(d)} 不在系统临时目录下或不是探针临时目录的形态，未删，请手工核对`);
      continue;
    }
    const left = await tryRemoveTempDir(d, []);
    if (left !== null) residue.push(`探针临时目录 ${tildeHome(d)} 删除失败（${left.code}），其中可能有凭据副本，请手工删除`);
  }
  return residue;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * 台账的主人还在吗：pid 不在 ⇒ 不在；在而台账记过它的规范化启动时刻、此刻核对确认不是同一进程 ⇒ pid 已被复用、
 * 主人不在（双平台统一时补：Windows 的 pid 复用快，只看 pid 会让旧台账永远被跳过）；其余（同一进程、判不了、
 * 旧台账没记启动时刻）⇒ 当它还在，宁可留到下一次。
 */
async function ledgerOwnerGone(pid: number, started: string | null, matcher: StartMatcher): Promise<boolean> {
  if (!pidAlive(pid)) return true;
  if (started === null) return false;
  const m = await matcher(pid, started);
  return m === 'different';
}

/** 按 pid 与记录的规范化启动时刻判身份：`processMatchesRecord` 的三态结论（测试可注入） */
export type StartMatcher = (pid: number, started: string) => Promise<'same' | 'different' | 'unverifiable'>;

const defaultStartMatcher: StartMatcher = async (pid, started) => {
  const m = await processMatchesRecord(pid, { canonical: started, legacy: null });
  return m.identity ?? (m.sameProcess ? 'same' : 'different');
};

/**
 * 补删已退出的 doctor 留下的台账（宿主直接 SIGKILL 的那一格）。进程还活着（或判不了）的台账不碰，
 * 宁可留到下一次；pid 被复用的按 `ledgerOwnerGone` 识别。返回删不掉或不敢删的条目说明。
 */
export async function sweepDoctorLedgers(dir: string, o: { matchStart?: StartMatcher } = {}): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const residue: string[] = [];
  for (const name of names.sort()) {
    const m = LEDGER_RE.exec(name);
    if (!m) continue;
    const pid = Number(m[1]);
    if (pid === process.pid) continue;
    const file = path.join(dir, name);
    let dirs: string[] = [];
    let started: string | null = null;
    let parsedOk = true;
    try {
      const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as { dirs?: unknown; started?: unknown };
      dirs = Array.isArray(parsed.dirs) ? parsed.dirs.filter((d): d is string => typeof d === 'string') : [];
      started = typeof parsed.started === 'string' && parsed.started.length > 0 ? parsed.started : null;
    } catch {
      parsedOk = false;
    }
    // 先判主人在不在：读不懂的台账若主人还在（可能正写到一半），不该报残余
    if (!(await ledgerOwnerGone(pid, started, o.matchStart ?? defaultStartMatcher))) continue;
    if (!parsedOk) {
      residue.push(`doctor 临时目录台账 ${tildeHome(file)} 读不懂，未据它删除任何目录`);
      continue;
    }
    residue.push(...(await removeListed(dirs)));
    await fs.rm(file, { force: true }).catch(() => undefined);
  }
  return residue;
}

/** 本进程的台账：经 `observeTempDirs` 接上 `makeTempDir` / `tryRemoveTempDir` */
export class TempDirLedger {
  private readonly dirs = new Set<string>();
  private readonly file: string;
  private chain: Promise<void> = Promise.resolve();
  /** 本进程的规范化启动时刻：写进台账，供下一次 doctor 识别 pid 复用（取不到为 null，按旧行为处置） */
  private started: Promise<string | null> = Promise.resolve(null);

  constructor(dir: string) {
    this.file = ledgerFile(dir, process.pid);
  }

  install(): void {
    // 在任何探针段之外起取（doctor 在进段前 install）：段内的 run() 会被中止令牌截住
    this.started = processStartTime(process.pid, { canonical: true }).catch(() => null);
    observeTempDirs({
      created: (d) => this.update(() => this.dirs.add(d)),
      removed: (d) => this.update(() => this.dirs.delete(d)),
    });
  }

  /** 改内存、串行落盘（原子写：win32 上经 writeAtomic 的有界重试，EV-260） */
  private update(mutate: () => unknown): Promise<void> {
    mutate();
    const snapshot = [...this.dirs];
    this.chain = this.chain.then(async () => {
      const started = await this.started;
      await writeAtomic(this.file, JSON.stringify({ pid: process.pid, started, dirs: snapshot }));
    }).catch(() => undefined);
    return this.chain;
  }

  /** 收尾：卸下观察者，删掉本进程仍在盘上的条目；全部处理完就删台账，否则留给下一次 doctor */
  async finish(): Promise<string[]> {
    observeTempDirs(null);
    await this.chain;
    const residue = await removeListed([...this.dirs]);
    this.dirs.clear();
    if (residue.length === 0) await fs.rm(this.file, { force: true }).catch(() => undefined);
    return residue;
  }
}

// ─────────────────────── 控制器 ───────────────────────

/** 限时等一个 Promise：在 `ms` 内兑现给 `{ ok: true, value }`，否则 `{ ok: false }`（不取消它，只是不再等） */
export async function bounded<T>(p: Promise<T>, ms: number): Promise<{ ok: true; value: T } | { ok: false }> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<{ ok: false }>((r) => {
    timer = setTimeout(() => r({ ok: false }), ms);
  });
  try {
    return await Promise.race([p.then((value) => ({ ok: true as const, value })), late]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * 接管的信号。Windows 上（双平台统一时补）跨进程发不出能被捕获的 SIGTERM（`kill` 即 TerminateProcess，处理器跑不到），
 * 能到的只有控制台 Ctrl+C（SIGINT）与 Ctrl+Break（SIGBREAK）；宿主硬杀与 POSIX 被 SIGKILL 同一格：
 * 靠进程内计时器到点自收尾，来不及的由下一次 doctor 按台账补删临时目录。
 */
const HANDLED_SIGNALS: readonly NodeJS.Signals[] = IS_WIN ? ['SIGINT', 'SIGTERM', 'SIGBREAK'] : ['SIGINT', 'SIGTERM'];

export interface DeadlineControllerOptions {
  ms: number;
  unwindMs: number;
  graceMs: number;
  killWaitMs: number;
  /** 接管 SIGINT / SIGTERM（CLI 传 true；经 runDoctor 跑的单测不接管） */
  handleSignals: boolean;
}

export class DeadlineController {
  reason: 'deadline' | 'signal' | null = null;
  /** 本次 doctor 各段共用的中止令牌（段作用域经 `newProbeSection(name, token)` 带上） */
  readonly token = newProbeAbortToken();
  readonly scopes: ProbeSectionScope[] = [];
  /** 到点后按组结束的结果（含等在写的 checkpoint）；未到点为 null */
  termination: Promise<SectionTerminateResult> | null = null;
  /** 到点后段在兜底时长内没退出来时兑现 */
  readonly stuck: Promise<void>;
  private resolveStuck: () => void = () => undefined;
  private timer: NodeJS.Timeout | undefined;
  private stuckTimer: NodeJS.Timeout | undefined;
  private inflight: Promise<unknown> | null = null;
  private readonly onSignal = (sig: NodeJS.Signals): void => {
    // 第二个信号：用户或宿主坚持要走，立即退出（同前台中断转发的「再按一次」）
    if (this.reason !== null) process.exit(sig === 'SIGTERM' ? 143 : 130);
    process.stderr.write(`收到 ${sig}：doctor 按到点处置，结束本次拉起的探针子进程并收尾（再发一次立即退出）\n`);
    this.fire('signal');
  };

  constructor(private readonly o: DeadlineControllerOptions) {
    this.stuck = new Promise<void>((r) => {
      this.resolveStuck = () => {
        this.stuckFired = true;
        r();
      };
    });
  }

  /** 兜底已触发（到点后段在兜底时长内没退出来，或收尾某步挂住） */
  stuckFired = false;

  /**
   * 收尾的一步限时等（代码审第 2 轮 CODEX-01）：预算是剩余预算、至少 `FINALIZE_STEP_FLOOR_MS`；
   * 同时与兜底竞速——正常收尾进行中收到信号时，预算已按到点时刻缩短，正在等的这一步要跟着放弃，
   * 不能按开始等待时的旧预算等下去（兜底再调收尾函数拿到的是同一个缓存的 Promise，帮不上忙）。
   * 兜底触发之后的各步只给下限。
   */
  async limitStep<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
    const budget = this.stuckFired ? FINALIZE_STEP_FLOOR_MS : Math.max(this.remainingMs(), FINALIZE_STEP_FLOOR_MS);
    const raced: Promise<{ v: T } | null> = this.stuckFired
      ? p.then((v) => ({ v }))
      : Promise.race([p.then((v) => ({ v })), this.stuck.then(() => null)]);
    const r = await bounded(raced, budget);
    if (!r.ok || r.value === null) return { ok: false };
    return { ok: true, value: r.value.v };
  }

  start(): void {
    this.startedAt = Date.now();
    this.timer = setTimeout(() => this.fire('deadline'), this.o.ms);
    if (this.o.handleSignals) for (const s of HANDLED_SIGNALS) process.on(s, this.onSignal);
  }

  /** 记下正在写的 checkpoint：到点收尾要等它写完（`patchProbe` 不经 `run()`，不受中止影响） */
  track(p: Promise<unknown>): void {
    this.inflight = p;
    void p.finally(() => {
      if (this.inflight === p) this.inflight = null;
    });
  }

  /**
   * 到点（或收到信号）：置中止令牌、**当即**起兜底计时器（代码三审 CODEX-03：此前要等按组结束完成才起算，
   * 清理链自己挂住时兜底永不生效），再并行地按组结束、限时等在写的 checkpoint。
   */
  fire(reason: 'deadline' | 'signal'): void {
    if (this.reason !== null) return;
    this.reason = reason;
    this.firedAt = Date.now();
    if (this.timer) clearTimeout(this.timer);
    abortProbeSections(this.token);
    this.stuckTimer = setTimeout(() => this.resolveStuck(), this.o.unwindMs);
    this.termination = (async () => {
      const t = await terminateProbeSectionGroups(this.scopes, { graceMs: this.o.graceMs, killWaitMs: this.o.killWaitMs });
      if (this.inflight) await bounded(this.inflight.catch(() => undefined), this.remainingMs());
      return t;
    })();
  }

  private firedAt: number | null = null;
  private startedAt = Date.now();

  /**
   * 收尾还剩多少预算（毫秒）：到点后是「到点时刻 + 兜底时长」，未到点是「总时限 + 兜底时长」。
   * 收尾的每一步都按它限时（代码三审 CODEX-03），合计不越过 skill 的工具超时（总时限加 60 s）。
   */
  remainingMs(): number {
    const end = (this.firedAt ?? this.startedAt + this.o.ms) + this.o.unwindMs;
    return Math.max(0, end - Date.now());
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.stuckTimer) clearTimeout(this.stuckTimer);
    if (this.o.handleSignals) for (const s of HANDLED_SIGNALS) process.removeListener(s, this.onSignal);
  }
}
