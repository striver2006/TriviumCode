/**
 * 运行目录的凭据抹除（BACKLOG EV-20；主题「凭据副本残留与参数静默丢失」计划双审 r1、代码双审 r1）。
 *
 * ## 缺口
 *
 * codex 与 zcode 两侧为了模型覆盖与隔离，都要把**含明文凭据**的配置副本写进
 * `~/.trivium/runs/<项目槽>/<runId>/<侧>/`（codex：`codexhome/` 下三份 toml/json；
 * zcode：`home/.zcode/cli/config.json`）。此前跑完无人清理，副本躺到
 * `retention.run_dir_days`（30 天）到期整删；而 J9 的密钥扫描只挂在归档侧，
 * 运行目录不在它的论域——2026-09-16 有人为查一个键整份打印了一份副本。
 *
 * ## 四处挂载，一份实现
 *
 * | # | 挂载点 | 覆盖 |
 * | :-- | :-- | :-- |
 * | ① | `runner.ts` 每次尝试的 `finally`（`force`） | 成功 / 超时 / 无最终回复 / 拉起异常 / 准备中途失败 / 重试的每一轮 |
 * | ② | `run-protocol.ts` `waitRun` 的 `worker_lost`（进程确认不在时） | 同会话内 worker 崩溃、OOM、强杀 |
 * | ③ | `run-protocol.ts` `cancelRun` | `--cancel` |
 * | ④ | `retention.ts` 会话启动清扫 | 跨会话的崩溃、断电、`kill -9`；①②③ 抹除失败的重试 |
 *
 * 挂载点在 **runner** 而不在各适配器里：一处代码覆盖所有侧，适配器只回答
 * 「我放了什么载体、哪些目录是模型 I/O 日志」（`CriticAdapter.scrubRunDir?`）。
 *
 * ## 三层
 *
 * 1. **载体整份删除**——由该侧适配器做（它知道文件名）。选整删而不是脱敏保留骨架：
 *    黑名单会漏键，而骨架跑后没有任何读者。
 * 2. **自有目录后验扫描**——载体之外「本轮没想到」的文件过 `scanSecrets`，命中即删。
 *    **模型 I/O 日志例外**（codex `sessions/`、zcode `rollout/` 与 `log/`）：它们逐字含送审包全文，
 *    被审代码里的夹具密钥会命中，「命中即删」会丢排障证据与生效模型的回读来源——改为**就地脱敏**
 *    （代码双审 r1 CODEX-05 ≡ GLM-03；计划双审 D-2 的 A 项据此升级，EV-32 随之收口）。
 *    厂商缓存（codex `cache/` `plugins/`、zcode `plugins/` `db/`）不扫：编排器与排障都不需要，
 *    数千个文件白白过一遍。论域内扫不进去的二进制（前 8 KB 含 NUL）整份删除，
 *    `redactUnder` 下的除外——理由见 `scanAndRemoveSecrets`（EV-36）。
 * 3. **编排器自写日志就地脱敏**——`out/` 下的 `stdout.jsonl` / `stdout.json` / `trace.json` /
 *    `rollout.jsonl` 是排障依据，不能删；模型若在沙箱里读了自己的配置副本，token 会随命令输出
 *    逐字落在这里（CODEX-03），按 `redactSecrets` 把值抹掉、结构保留。清单与适配器写入点
 *    由 `test/contract/orchestrator-logs-parity` 对账（GLM-01：手抄清单第一次就漏了 rollout）。
 *
 * `<侧>/out/` 里的其它文件（审查结果）一个不碰：归档时已过 `assertNoSecrets`，且 `executeRun` 在 ① 之后还要用。
 *
 * ## 告警与错误分两档（代码双审 r1 CODEX-02）
 *
 * **错误**（`ok:false`，人读报「副本仍可能在盘上」，④ 会重试）：载体删不掉、命中却删不掉、
 * 日志脱敏写回失败、哨兵写不下去。**告警**（`ok` 不受影响，只进哨兵）：超过扫描上限的文件跳过、
 * 读目录失败。第一次真跑就撞上了 codex 的 21 MB 插件目录缓存与 zcode 的 16 MB 动态库：
 * 把它们记成失败，会话启动会把一条假失败在待办里挂 30 天，而载体其实早已删净。
 *
 * ## 哨兵
 *
 * `<侧>/scrub.json` 记录做了什么。**只对 ③④ 起「已记 ok 即跳过」的作用**；
 * ① 每次尝试都无条件跑，且 runner 在调 `adapter.run` **之前**删旧哨兵——
 * 否则第一次尝试落下的 `ok:true` 会让重试那一轮重新准备的副本漏抹（CODEX-02 ≡ GLM-02）。
 *
 * ## 失败口径
 *
 * 抹除失败**不判该侧运行失败**：结果已产出、配额已烧，判失败只会让用户重跑并再铸一份副本。
 * 代价是失败必须看得见：`ok:false` 进哨兵（④ 会重试）、进 `CriticResult.scrub`
 * → `status.json` 的侧 note（`--wait` 会渲染）、进会话启动那行人读待办。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { CriticId, ScrubOutcome } from './types.js';
import type { CarrierScrub, CriticAdapter } from './adapters/base.js';
import { ALL_AGENT_IDS } from './agents/registry.js';
import { RUN_DIR_FILE_NAMES, VOIDED_ATTEMPTS_DIR } from './run-files.js';
import { redactSecrets, scanSecrets } from './secrets.js';
import { exists, writeAtomic } from './util/fsx.js';

/** 该侧目录下的哨兵文件名 */
export const SCRUB_SENTINEL = 'scrub.json';

/**
 * 编排器自写、可能含模型输出原文的日志——就地脱敏而不删。
 * 适配器往 `req.out_dir` 写的每一份原始日志都必须在这里（契约测试对账）。
 */
export const ORCHESTRATOR_LOG_FILES: readonly string[] = ['stdout.jsonl', 'stdout.json', 'trace.json', 'rollout.jsonl'];

/** 单文件扫描上限：超过就记告警跳过，不把一份几十 MB 的文件整个读进内存 */
export const SCAN_SIZE_CAP = 32 * 1024 * 1024;

/** 逐侧取适配器；缺接线返回 undefined 而不抛（计划双审 CODEX-06） */
export type AdapterLookup = (id: string) => CriticAdapter | undefined;

const emptyOutcome = (adapterScrub: boolean): ScrubOutcome => ({
  ok: true,
  at: new Date().toISOString(),
  adapter_scrub: adapterScrub,
  carriers_deleted: [],
  unscannable_deleted: [],
  scanned_files: 0,
  removed_on_hit: [],
  logs_redacted: {},
  warnings: [],
  complete: true,
  errors: [],
});

export async function readScrubSentinel(sideDir: string): Promise<ScrubOutcome | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(sideDir, SCRUB_SENTINEL), 'utf8')) as ScrubOutcome;
  } catch {
    return null;
  }
}

/**
 * 这一侧的哨兵算不算「收工」——`scrubSideDir` 非 force 路径的跳过判据。
 *
 * 单独导出是给**预览路径**用的（`trivium scrub --dry-run`）：预览要回答
 * 「真跑会不会有活干」，它必须与真跑用同一条判据，否则预览会说一句真跑不成立的话。
 * `ok` 还不够：跳过了目标就说明那几份仍未脱敏，不能据此永久收工（代码双审 r2 AGY-02）。
 *
 * **判 `complete === true` 而不是 `!== false`**：哨兵是 `JSON.parse` 直转、不过校验，
 * 盘上真实存在 `complete` 字段加进来**之前**写的旧哨兵。对它们 `complete` 是 `undefined`，
 * `!== false` 恒真——于是「这一侧没扫完」与「这一侧是旧版本写的、不知道扫没扫完」
 * 长成了同一个样子，两者都被当成收工。2026-09-17 实测代价：TriviumCode 桶里 2 个运行目录的
 * codex 状态库因此从未被处理，而清扫每轮都报「一切正常」。
 * 判 `=== true` 会让旧哨兵被重扫一次（幂等、便宜），扫完即写上新字段，自愈。
 */
export function sentinelSettled(prev: ScrubOutcome | null): boolean {
  return prev !== null && prev.ok === true && prev.complete === true;
}

/**
 * 这个运行目录的**侧层**还有没有活要干：任一已拉起的侧尚未收工即为真。
 *
 * 只答侧层。运行目录那一层（`request.json` 等）**没有哨兵**、每次都要复查一遍，
 * 所以「侧层没活」不等于「整个目录可以不看」——调用方据此计数，不据此跳过。
 */
export async function sideLayerPending(runDirAbs: string): Promise<boolean> {
  for (const id of ALL_AGENT_IDS) {
    const sideDir = path.join(runDirAbs, id);
    if (!(await exists(sideDir))) continue;
    if (!sentinelSettled(await readScrubSentinel(sideDir))) return true;
  }
  return false;
}

/** 准备即失效：runner 在每次 `adapter.run` 之前调，让「上一轮抹过」不遮住「这一轮又准备了」 */
export async function clearScrubSentinel(sideDir: string): Promise<void> {
  await fs.rm(path.join(sideDir, SCRUB_SENTINEL), { force: true });
}

/** 这次抹除有没有真做事——供清扫计数用：「没得抹」与「抹过了」不能长得一样（GLM-05） */
export function scrubDidWork(o: ScrubOutcome): boolean {
  return (
    o.carriers_deleted.length > 0 ||
    o.unscannable_deleted.length > 0 ||
    o.removed_on_hit.length > 0 ||
    Object.keys(o.logs_redacted).length > 0
  );
}

/** 前 8 KB 含 NUL 即当二进制：sqlite、dylib、图片……扫它们只会撞上随机字节 */
async function looksBinary(p: string): Promise<boolean> {
  const fh = await fs.open(p, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, 8192, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}

const toRel = (prefixes: readonly string[]): string[] => prefixes.map((e) => e.split('/').join(path.sep));
const under = (rel: string, prefixes: readonly string[]): boolean =>
  prefixes.some((x) => rel === x || rel.startsWith(x + path.sep));

export interface ScanOptions {
  /** 相对 `root` 的路径前缀：整棵不碰（厂商缓存、二进制库） */
  exclude?: readonly string[];
  /** 相对 `root` 的路径前缀：命中不删、**就地脱敏**（模型 I/O 日志） */
  redactUnder?: readonly string[];
  /** 单文件上限，缺省 `SCAN_SIZE_CAP`；测试用 */
  sizeCap?: number;
}

export interface ScanResult {
  scanned: number;
  /** 命中而删除的文件（相对 root） */
  removed: string[];
  /** 扫不进去（二进制）因而整份删除的文件（相对 root）——见 `scanAndRemoveSecrets` 的说明 */
  unscannableRemoved: string[];
  /** 就地脱敏的文件 → 命中处数（相对 root） */
  redacted: Record<string, number>;
  /** 告警：跳过的超大文件、读目录失败——不影响 ok */
  warnings: string[];
  /** 跳过（超大、读不了、`redactUnder` 下的二进制）的文件数——它们**仍未脱敏**，清扫不能据此收工 */
  skipped: number;
  /** 错误：命中却删不掉、脱敏写回失败——ok:false */
  errors: string[];
}

/**
 * 递归扫描一棵目录里的普通文件。供各侧适配器扫自有目录用。
 * 命中即删；`redactUnder` 下的命中改为就地脱敏；`exclude` 下的不碰；软链不读。
 *
 * ## 二进制为什么是**整删**而不是跳过（BACKLOG EV-36）
 *
 * 这个论域本来就是「**命中即删**」——凡落进来的文件，我们早已承诺「发现密钥就删掉它」。
 * 对一份扫不进去的二进制，我们**判断不了**它有没有密钥；在一个命中即删的论域里保留它，
 * 是自相矛盾的：按 fail-closed 该当作可能命中处置。
 *
 * 保留的代价此前是具体的：跳过 ⇒ `complete` 恒 false ⇒ 哨兵永不收工 ⇒ 每次会话重扫同一批、
 * 人读待办每轮复现同一行**而没有任何动作能让它消失**。实测两例：codex 副本根上的 sqlite 状态库
 * （12 个运行目录、194 条告警），以及 zcode 假 HOME 里 `Library/Caches/com.apple.python 下的 .pyc`
 * ——后者是 HOME 被重定向后操作系统写进去的副产品。
 *
 * **删得安全的依据是论域本身**：跑后有回读者的东西（codex `sessions/`、zcode `rollout/` 与 `log/`）
 * 走 `redactUnder`，厂商缓存与随 CLI 分发的资产走 `exclude`，两者都在这个论域**之外**。
 * 论域之内的文件按构造没有跑后读者。
 * 因此 `redactUnder` 下的二进制**仍然只跳过不删**：那几棵正是回读来源，删了会丢生效模型的来源与排障证据。
 *
 * 超大文件（过 `sizeCap`）不在此列，仍是跳过：那是「我们选择不读」，不是「读不了」，
 * 为一个自设的内存上限去删一份几十 MB 的排障材料，理由不成立。
 */
export async function scanAndRemoveSecrets(root: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const out: ScanResult = {
    scanned: 0, removed: [], unscannableRemoved: [], redacted: {}, warnings: [], skipped: 0, errors: [],
  };
  if (!(await exists(root))) return out;
  const exclude = toRel(opts.exclude ?? []);
  const redactUnder = toRel(opts.redactUnder ?? []);
  const cap = opts.sizeCap ?? SCAN_SIZE_CAP;
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch (e) {
      out.warnings.push(`读目录失败 ${path.relative(root, dir) || '.'}：${(e as Error).message}`);
      out.skipped++;
      continue;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      const rel = path.relative(root, full);
      if (under(rel, exclude)) continue;
      let st: import('node:fs').Stats;
      try {
        st = await fs.lstat(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!st.isFile()) continue; // 软链、socket 之类不读
      if (st.size > cap) {
        out.warnings.push(`跳过超大文件 ${rel}（${st.size} 字节），未扫描`);
        out.skipped++;
        continue;
      }
      let text: string;
      try {
        if (st.size > 0 && (await looksBinary(full))) {
          /*
           * 二进制最初是静默 `continue`，r2 GLM-05 改为「记告警仍跳过」——让没扫的看得见。
           * 看得见之后才发现跳过本身就是错的（EV-36）：这是个命中即删的论域，
           * 判不了就该按可能命中处置。回读来源在 `redactUnder` 下，那几棵仍只跳过。
           */
          if (under(rel, redactUnder)) {
            out.warnings.push(`跳过二进制文件 ${rel}（前 8 KB 含 NUL），它在回读面上、不删，未扫描`);
            out.skipped++;
            continue;
          }
          try {
            await fs.rm(full, { force: true });
            out.unscannableRemoved.push(rel);
          } catch (e2) {
            out.errors.push(`扫不进去又删不掉 ${rel}：${(e2 as Error).message}`);
          }
          continue;
        }
        text = await fs.readFile(full, 'utf8');
      } catch (e) {
        out.warnings.push(`读文件失败 ${rel}：${(e as Error).message}`);
        out.skipped++;
        continue;
      }
      out.scanned++;
      if (under(rel, redactUnder)) {
        const r = redactSecrets(text);
        if (r.count === 0) continue;
        try {
          await writeAtomicPreservingMode(full, r.content, st.mode);
          out.redacted[rel] = r.count;
        } catch (e) {
          out.errors.push(`命中却脱敏不了 ${rel}：${(e as Error).message}`);
        }
        continue;
      }
      if (scanSecrets(text).length === 0) continue;
      try {
        await fs.rm(full, { force: true });
        out.removed.push(rel);
      } catch (e) {
        out.errors.push(`命中却删不掉 ${rel}：${(e as Error).message}`);
      }
    }
  }
  return out;
}

/**
 * 编排器自写日志的就地脱敏；返回 相对路径 → 命中处数。
 *
 * 适配器把这几份写在 `req.out_dir` 即 `<侧>/out/` 下（`review.ts` 的 `out_dir = <run>/<侧>/out`）；
 * 侧目录根也查一遍，以防日后有人把日志挪上来。`out/` 里的其它文件（审查结果）一个不碰。
 */
async function redactLogs(
  dir: string,
  rels: readonly string[],
  cap: number,
): Promise<{ redacted: Record<string, number>; warnings: string[]; skipped: number; errors: string[] }> {
  const redacted: Record<string, number> = {};
  const warnings: string[] = [];
  const errors: string[] = [];
  let skipped = 0;
  for (const rel of rels) {
    const p = path.join(dir, rel);
    if (!(await exists(p))) continue;
    try {
      const st = await fs.stat(p);
      if (st.size > cap) {
        warnings.push(`跳过超大日志 ${rel}（${st.size} 字节），未脱敏`);
        skipped++;
        continue;
      }
      const { content, count } = redactSecrets(await fs.readFile(p, 'utf8'));
      if (count > 0) {
        await writeAtomicPreservingMode(p, content, st.mode);
        redacted[rel] = count;
      }
    } catch (e) {
      errors.push(`${rel} 脱敏失败：${(e as Error).message}`);
    }
  }
  return { redacted, warnings, skipped, errors };
}

/**
 * 原子写回并保留原文件的权限位。
 *
 * `writeAtomic` 是 `writeFile` + `rename`，新文件的 mode 由 umask 定（通常 0644）——
 * 而被改写的正是「按启发式抹过、可能仍有未识别凭据」的厂商会话日志：同一模块给**准备**出来的
 * 副本刻意 chmod 0600，却在**脱敏**这一步把可读性放宽，同机其它用户因此可读（代码双审 r2 CODEX-04）。
 */
async function writeAtomicPreservingMode(p: string, content: string, mode: number): Promise<void> {
  await writeAtomic(p, content);
  await fs.chmod(p, mode & 0o777).catch(() => {
    /* 权限改不回不影响内容已被抹除这件事 */
  });
}

/**
 * 抹一侧。`force` 为真时不看哨兵（runner 的 ① 走这条）；否则哨兵已记 ok 即跳过。
 * 侧目录不存在返回 `skipped: 'no-side-dir'`，不写任何东西。
 */
export async function scrubSideDir(
  adapter: CriticAdapter | undefined,
  sideDir: string,
  opts: { force?: boolean; sizeCap?: number; preRedacted?: Record<string, number> } = {},
): Promise<ScrubOutcome> {
  const hasScrubber = typeof adapter?.scrubRunDir === 'function';
  if (!(await exists(sideDir))) return { ...emptyOutcome(hasScrubber), skipped: 'no-side-dir' };
  if (!opts.force) {
    const prev = await readScrubSentinel(sideDir);
    if (sentinelSettled(prev)) return { ...prev!, skipped: 'already-scrubbed' };
  }

  const out = emptyOutcome(hasScrubber);
  let skipped = 0;
  if (hasScrubber) {
    try {
      const r: CarrierScrub = await adapter!.scrubRunDir!(sideDir, { sizeCap: opts.sizeCap });
      out.carriers_deleted = r.deleted;
      out.unscannable_deleted = r.unscannableDeleted;
      out.scanned_files = r.scanned;
      out.removed_on_hit = r.removedOnHit;
      Object.assign(out.logs_redacted, r.redacted);
      out.warnings.push(...r.warnings);
      out.errors.push(...r.errors);
      skipped += r.skipped;
    } catch (e) {
      out.errors.push(`载体抹除抛出：${(e as Error).message}`);
    }
  }
  const logs = await redactLogs(
    sideDir,
    [...ORCHESTRATOR_LOG_FILES.flatMap((n) => [n, path.join('out', n)]),
      ...(await attemptLogs(path.join(sideDir, 'out'), out.errors)).map(n => path.join('out', n))],
    opts.sizeCap ?? SCAN_SIZE_CAP,
  );
  Object.assign(out.logs_redacted, logs.redacted);
  for (const [name, count] of Object.entries(opts.preRedacted ?? {}))
    out.logs_redacted[name] = (out.logs_redacted[name] ?? 0) + count;
  out.warnings.push(...logs.warnings);
  out.errors.push(...logs.errors);
  skipped += logs.skipped;
  out.complete = skipped === 0;
  out.ok = out.errors.length === 0;

  try {
    await writeAtomic(path.join(sideDir, SCRUB_SENTINEL), JSON.stringify(out, null, 2) + '\n');
  } catch (e) {
    // 哨兵写不下去也要让调用方知道：④ 靠它判「要不要重试」
    out.errors.push(`哨兵写入失败：${(e as Error).message}`);
    out.ok = false;
  }
  return out;
}

/**
 * 运行目录**那一层**的脱敏结果。
 *
 * 与侧目录那一层不对称的地方要说清：这一层**没有哨兵**——本模块刻意不往运行目录那一层
 * 写任何文件（`run-files` 对账的论域正是那一层）。于是它既不能「已抹过就跳过」，
 * 也不能把结果留在盘上等人来读，**只能由调用方上报**。
 * `redactLogs` 幂等（没命中就不写），每次重跑的代价只是把那几份文件再读一遍。
 */
export interface RunDirLayerScrub {
  /** 就地脱敏的文件 → 命中处数（相对运行目录） */
  redacted: Record<string, number>;
  /** 告警：超过扫描上限而跳过——不判失败，但那几份仍未脱敏 */
  warnings: string[];
  /** 跳过的文件数 */
  skipped: number;
  /** 错误：脱敏写回失败、运行目录读不了 */
  errors: string[];
}

/** `scrubRunDir` 的返回：两层分开报，因为它们的处置不同（侧层有哨兵可重试，运行目录层没有） */
export interface RunDirScrub {
  sides: Partial<Record<CriticId, ScrubOutcome>>;
  runDir: RunDirLayerScrub;
}

/**
 * 抹一个运行目录下的全部侧。侧子目录按注册表 id 认（`<runId>/<侧>/`），
 * 缺接线的侧照样扫日志、只是没有载体抹除——不因一侧缺接线整体抛（CODEX-06）。
 */
export async function scrubRunDir(
  runDirAbs: string,
  lookup: AdapterLookup,
  opts: { force?: boolean; sizeCap?: number } = {},
): Promise<RunDirScrub> {
  const sides: Partial<Record<CriticId, ScrubOutcome>> = {};
  /*
   * 运行目录**那一层**的编排器文件同样承载模型与厂商输出（代码双审 r2 CODEX-10）：
   * `request.json` 的交接包逐字含整份送审包（`CriticRequest.brief_text`），
   * `status.json` 的侧 note 与 message 含各适配器截来的厂商 stderr 片段，
   * `worker.log` 是 worker stdio 的重定向目标。它们同样是排障依据、不能删，按同款就地脱敏。
   * 清单取自 `run-files.ts`——与写入点同源，新增一个运行时文件不会在这里悄悄漏掉。
   *
   * **返回值此前被整个丢弃**（`.catch(() => ({}))` 后不赋给任何变量）：一份超大的
   * `request.json` 被跳过、或脱敏写回失败时，`errors` / `warnings` / `skipped` 三条上报通道
   * 一条都不亮——而侧目录那一层有完整的上报链。这里把它接回去。
   */
  const layer = await redactLogs(runDirAbs, RUN_DIR_FILE_NAMES, opts.sizeCap ?? SCAN_SIZE_CAP).catch((e: unknown) => ({
    redacted: {} as Record<string, number>,
    warnings: [] as string[],
    skipped: 0,
    errors: [`运行目录层脱敏抛出：${(e as Error).message}`],
  }));
  const runDir: RunDirLayerScrub = {
    redacted: layer.redacted,
    warnings: [...layer.warnings],
    skipped: layer.skipped,
    errors: [...layer.errors],
  };

  let names: string[];
  try {
    names = await fs.readdir(runDirAbs);
  } catch (e) {
    // 读不了运行目录 = 一侧都没抹，而此前是静默 `return {}`：调用方的三个计数全不增长，
    // 该目录在待办里完全不出现（代码双审 r2 CODEX-10 的同族缺口）
    runDir.errors.push(`读运行目录失败，本轮一侧都没抹：${(e as Error).message}`);
    return { sides, runDir };
  }

  // 本模块只写 `<侧>/` 这一层的哨兵，不往运行目录那一层写任何文件（run-files 对账的论域是那一层）
  for (const name of names) {
    if (!(ALL_AGENT_IDS as readonly string[]).includes(name)) continue;
    const sideDir = path.join(runDirAbs, name);
    try {
      if (!(await fs.stat(sideDir)).isDirectory()) continue;
    } catch {
      continue;
    }
    sides[name as CriticId] = await scrubSideDir(lookup(name), sideDir, opts);
  }
  await redactVoidedAttempts(runDirAbs, runDir, opts.sizeCap ?? SCAN_SIZE_CAP);
  return { sides, runDir };
}

/**
 * 被作废的那次尝试挪去的 `voided/<侧>/attempt-<n>/`（BACKLOG EV-225，`run-files.ts` 的 `VOIDED_ATTEMPTS_DIR`）。
 *
 * 那就是该次尝试原来的 `out/`，挪之前已经过那次尝试的强制抹除；这里补一遍只为覆盖「那次抹除失败」的情形。
 * 只脱敏、不删，结果并进运行目录层的上报（不写哨兵：本模块不往运行目录那一层写任何文件）。
 */
/** E1 保留的历次尝试沿用标准日志名，仅枚举真实目录。 */
async function attemptLogs(dir: string, errors: string[]): Promise<string[]> {
  let entries;
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') errors.push('读取历史尝试目录失败：' + (code ?? 'io'));
    return [];
  }
  return entries.filter(e => e.isDirectory() && /^attempt-[1-9]\d*$/.test(e.name))
    .flatMap(e => ORCHESTRATOR_LOG_FILES.map(name => path.join(e.name, name)));
}

async function redactVoidedAttempts(runDirAbs: string, layer: RunDirLayerScrub, cap: number): Promise<void> {
  const root = path.join(runDirAbs, VOIDED_ATTEMPTS_DIR);
  let sideNames: string[];
  try {
    sideNames = await fs.readdir(root);
  } catch {
    return; // 没有作废重跑过：常态
  }
  for (const side of sideNames) {
    let attempts: string[];
    try {
      attempts = await fs.readdir(path.join(root, side));
    } catch {
      continue;
    }
    for (const a of attempts) {
      const rel = path.join(VOIDED_ATTEMPTS_DIR, side, a);
      const dir = path.join(runDirAbs, rel);
      const r = await redactLogs(dir, [...ORCHESTRATOR_LOG_FILES, ...await attemptLogs(dir, layer.errors)], cap);
      for (const [k, v] of Object.entries(r.redacted)) layer.redacted[path.join(rel, k)] = v;
      layer.warnings.push(...r.warnings.map((w) => `${rel}：${w}`));
      layer.errors.push(...r.errors.map((e) => `${rel}：${e}`));
      layer.skipped += r.skipped;
    }
  }
}

/** 人读一句：哪几侧失败、首个原因——供 status note 与会话启动待办共用 */
export function describeScrubFailure(o: ScrubOutcome): string | null {
  if (o.ok) return null;
  return `凭据副本抹除失败：${o.errors[0] ?? '原因未记录'}${o.errors.length > 1 ? `（另 ${o.errors.length - 1} 条见哨兵）` : ''}`;
}
