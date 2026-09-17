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
 *    数千个文件白白过一遍。二进制（前 8 KB 含 NUL）一律跳过。
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
import { RUN_DIR_FILE_NAMES } from './run-files.js';
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

/** 准备即失效：runner 在每次 `adapter.run` 之前调，让「上一轮抹过」不遮住「这一轮又准备了」 */
export async function clearScrubSentinel(sideDir: string): Promise<void> {
  await fs.rm(path.join(sideDir, SCRUB_SENTINEL), { force: true });
}

/** 这次抹除有没有真做事——供清扫计数用：「没得抹」与「抹过了」不能长得一样（GLM-05） */
export function scrubDidWork(o: ScrubOutcome): boolean {
  return o.carriers_deleted.length > 0 || o.removed_on_hit.length > 0 || Object.keys(o.logs_redacted).length > 0;
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
  /** 就地脱敏的文件 → 命中处数（相对 root） */
  redacted: Record<string, number>;
  /** 告警：跳过的超大文件、读目录失败——不影响 ok */
  warnings: string[];
  /** 跳过（超大、二进制、读不了）的文件数——它们**仍未脱敏**，清扫不能据此收工 */
  skipped: number;
  /** 错误：命中却删不掉、脱敏写回失败——ok:false */
  errors: string[];
}

/**
 * 递归扫描一棵目录里的普通文件。供各侧适配器扫自有目录用。
 * 命中即删；`redactUnder` 下的命中改为就地脱敏；`exclude` 下的不碰；二进制与软链不读。
 */
export async function scanAndRemoveSecrets(root: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const out: ScanResult = { scanned: 0, removed: [], redacted: {}, warnings: [], skipped: 0, errors: [] };
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
          // 二进制此前是静默 `continue`：与超大文件同为「没扫」，却在哨兵里看不出来
          // （代码双审 r2 GLM-05）。一份被污染出 NUL 的日志本来会就此免检。
          out.warnings.push(`跳过二进制文件 ${rel}（前 8 KB 含 NUL），未扫描`);
          out.skipped++;
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
  opts: { force?: boolean; sizeCap?: number } = {},
): Promise<ScrubOutcome> {
  const hasScrubber = typeof adapter?.scrubRunDir === 'function';
  if (!(await exists(sideDir))) return { ...emptyOutcome(hasScrubber), skipped: 'no-side-dir' };
  if (!opts.force) {
    const prev = await readScrubSentinel(sideDir);
    // `ok` 还不够：跳过了目标就说明那几份仍未脱敏，不能据此永久收工（代码双审 r2 AGY-02）
    if (prev?.ok && prev.complete !== false) return { ...prev, skipped: 'already-scrubbed' };
  }

  const out = emptyOutcome(hasScrubber);
  let skipped = 0;
  if (hasScrubber) {
    try {
      const r: CarrierScrub = await adapter!.scrubRunDir!(sideDir, { sizeCap: opts.sizeCap });
      out.carriers_deleted = r.deleted;
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
    ORCHESTRATOR_LOG_FILES.flatMap((n) => [n, path.join('out', n)]),
    opts.sizeCap ?? SCAN_SIZE_CAP,
  );
  Object.assign(out.logs_redacted, logs.redacted);
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
 * 抹一个运行目录下的全部侧。侧子目录按注册表 id 认（`<runId>/<侧>/`），
 * 缺接线的侧照样扫日志、只是没有载体抹除——不因一侧缺接线整体抛（CODEX-06）。
 */
export async function scrubRunDir(
  runDirAbs: string,
  lookup: AdapterLookup,
  opts: { force?: boolean } = {},
): Promise<Partial<Record<CriticId, ScrubOutcome>>> {
  const out: Partial<Record<CriticId, ScrubOutcome>> = {};
  let names: string[];
  try {
    names = await fs.readdir(runDirAbs);
  } catch {
    return out;
  }
  /*
   * 运行目录**那一层**的编排器文件同样承载模型与厂商输出（代码双审 r2 CODEX-10）：
   * `request.json` 的交接包逐字含整份送审包（`CriticRequest.brief_text`），
   * `status.json` 的侧 note 与 message 含各适配器截来的厂商 stderr 片段，
   * `worker.log` 是 worker stdio 的重定向目标。它们同样是排障依据、不能删，按同款就地脱敏。
   * 清单取自 `run-files.ts`——与写入点同源，新增一个运行时文件不会在这里悄悄漏掉。
   */
  await redactLogs(runDirAbs, RUN_DIR_FILE_NAMES, SCAN_SIZE_CAP).catch(() => ({}));
  // 本模块只写 `<侧>/` 这一层的哨兵，不往运行目录那一层写任何文件（run-files 对账的论域是那一层）
  for (const name of names) {
    if (!(ALL_AGENT_IDS as readonly string[]).includes(name)) continue;
    const sideDir = path.join(runDirAbs, name);
    try {
      if (!(await fs.stat(sideDir)).isDirectory()) continue;
    } catch {
      continue;
    }
    out[name as CriticId] = await scrubSideDir(lookup(name), sideDir, opts);
  }
  return out;
}

/** 人读一句：哪几侧失败、首个原因——供 status note 与会话启动待办共用 */
export function describeScrubFailure(o: ScrubOutcome): string | null {
  if (o.ok) return null;
  return `凭据副本抹除失败：${o.errors[0] ?? '原因未记录'}${o.errors.length > 1 ? `（另 ${o.errors.length - 1} 条见哨兵）` : ''}`;
}
