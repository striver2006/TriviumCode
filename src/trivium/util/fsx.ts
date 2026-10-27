/**
 * 文件系统辅助：原子写、独占创建、哈希、glob 匹配。
 *
 * 归档落盘的「防覆盖」语义（设计 §6.2 / FR-25）依赖 `createExclusive`：
 * 用 'wx' 标志走 O_CREAT|O_EXCL，命中已存在文件即抛 EEXIST，由 archive 抬升 -r<N>。
 */
import { createHash } from 'node:crypto';
import { promises as fs, constants as fsConstants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { IS_WIN } from './platform.js';

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

export async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/** win32 改名覆盖可重试的三种错误码：目标被短暂占用（自家并发写者、杀毒/索引扫描）时的形态（EV-260） */
const WIN_RETRYABLE_RENAME_CODES: ReadonlySet<string> = new Set(['EPERM', 'EACCES', 'EBUSY']);

/**
 * 缺省重试间隔：指数退避，6 次尝试、总睡眠 ≤ 775 ms（取值理由见主题计划 §3.1）。
 * 耗尽路径的墙钟最坏值另计 `onExhausted` 里 `fs.rm` 的重试（maxRetries 3 × 缺省 retryDelay
 * 100 ms），约 1.1 s——预算论证按「单次调用最坏 ~1.1 s」口径（代码双审 CODEX-02）。
 * 导出供回归锚钉值：这张表承载着 Hook 15 s / 取锁等待 4 s / 心跳 30 s 的全部预算论证。
 */
export const WIN_RENAME_RETRY_DELAYS_MS: readonly number[] = [25, 50, 100, 200, 400];

export interface RenameRetryOptions {
  /** 判定平台；缺省 process.platform。测试注入 'win32' 即可在非 Windows 平台跑 win32 分支 */
  platform?: NodeJS.Platform;
  /** 重试间隔表（毫秒）；缺省 [25, 50, 100, 200, 400]。测试注入小值避免真实等待 */
  delaysMs?: readonly number[];
  /** 被测改名函数；缺省 fs.rename。回归锚的故障注入点 */
  rename?: (from: string, to: string) => Promise<void>;
}

/**
 * 改名覆盖目标。win32 上对 EPERM / EACCES / EBUSY 做【有界短重试】（EV-260）：
 * 间隔按 delaysMs 指数退避，耗尽后抛最后一次的原始错误；其余错误码与非 win32
 * 平台单次、立即抛出（POSIX 行为与原先逐字相同）。`onExhausted` 在 win32 三码
 * 耗尽、抛出之前回调（`writeAtomic` 用它清本次临时文件）；**其自身异常在这里
 * 一律吞掉**——原始错误最高优先，清理失败不得顶替它（计划双审 AGY-01）。
 */
export async function renameOverwriting(
  from: string,
  to: string,
  opts?: RenameRetryOptions & { onExhausted?: () => Promise<void> },
): Promise<void> {
  const rename = opts?.rename ?? ((src: string, dest: string) => fs.rename(src, dest));
  // 缺省判定取 IS_WIN（平台事实的唯一落点 platform.ts）；注入平台仅供测试跑出 win32 分支（代码双审 CODEX-05）
  const isWin = opts?.platform === undefined ? IS_WIN : opts.platform === 'win32';
  if (!isWin) {
    await rename(from, to);
    return;
  }
  const delays = opts?.delaysMs ?? WIN_RENAME_RETRY_DELAYS_MS;
  let lastErr: NodeJS.ErrnoException | undefined;
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (!WIN_RETRYABLE_RENAME_CODES.has(err.code ?? '')) throw err;
      lastErr = err;
      if (attempt >= delays.length) break;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  try {
    await opts?.onExhausted?.();
  } catch {
    /* 吞：原始错误优先（AGY-01） */
  }
  // 循环结构保证 break 只发生在 lastErr 赋值之后，此处必非 undefined（代码双审 CLAUDE-02）
  throw lastErr!;
}

/**
 * 原子写：先写同目录临时文件再 rename，避免读到写了一半的内容。
 * win32 上 rename 覆盖若撞 EPERM / EACCES / EBUSY 按 `renameOverwriting` 有界重试，
 * 耗尽清掉本次 tmp 后抛最后一次原始错误；其余错误码与 POSIX 平台单次直通、行为与原先相同。
 */
export async function writeAtomic(target: string, content: string | Buffer, opts?: RenameRetryOptions): Promise<void> {
  await ensureDir(path.dirname(target));
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content);
  await renameOverwriting(tmp, target, {
    ...opts,
    onExhausted: async () => {
      await fs.rm(tmp, { force: true, maxRetries: 3 }).catch(() => undefined);
    },
  });
}

/**
 * 独占创建（O_CREAT|O_EXCL）。文件已存在时抛出 code === 'EEXIST' 的错误。
 * 这是 archive 防覆盖的唯一实现，不得用 exists() 预检代替（有 TOCTOU 竞态）。
 */
export async function createExclusive(target: string, content: string | Buffer): Promise<void> {
  await ensureDir(path.dirname(target));
  const fh = await fs.open(target, 'wx');
  try {
    await fh.writeFile(content);
  } finally {
    await fh.close();
  }
}

export function sha256(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function sha256File(p: string): Promise<string> {
  return sha256(await fs.readFile(p));
}

/** 展开开头的 ~，配置里的 run_root 等字段可能写成 ~/.trivium/runs */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

/**
 * 极简 glob → RegExp。支持 `**`、`*`、`?`、`{a,b}`、字符类。
 * 语义与 .gitignore 类似：`**` 跨目录，`*` 不跨目录分隔符。
 * 仅用于 peer_artifact_globs / sensitive_globs / skip_globs / scratch_paths 这类内部匹配，
 * 不追求 POSIX 完备。
 */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` 允许匹配零级目录；裸 `**` 匹配任意字符
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '{') {
      const close = glob.indexOf('}', i);
      if (close === -1) {
        re += '\\{';
      } else {
        const alts = glob.slice(i + 1, close).split(',');
        re += `(?:${alts.map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
        i = close;
      }
    } else if (c === '[') {
      const close = glob.indexOf(']', i);
      if (close === -1) {
        re += '\\[';
      } else {
        re += glob.slice(i, close + 1);
        i = close;
      }
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function matchesAnyGlob(relPath: string, globs: readonly string[]): boolean {
  /*
   * 匹配域恒用 `/`（与禁读条目的 toDomainRel 同域）：win32 的 path.relative 产出反斜杠，
   * 不归一的话**带目录段**的 glob（任意层级 `*.pem`、`calls` 整棵子树）一条都命中不了——根级无目录段的
   * `*-x.md` 靠 `[^/]*` 吃掉反斜杠是碰巧成立，不作依据。归一必须在匹配输入侧：
   * 输出侧的 toDomainRel 只管落盘形态，救不了「什么进集合」的判定。
   * 归一对真实路径输入（git 产出、path.relative 产物）两平台零变化；POSIX 文件名字面反斜杠
   * 属理论差异，不触发（审查 CLAUDE-10 的口径）。
   */
  const norm = relPath.replace(/^\.\//, '').replace(/\\/g, '/');
  return globs.some((g) => globToRegExp(g).test(norm));
}

/**
 * 临时目录的观察者（EV-251）：带时限的 doctor 装它，把本进程建的临时目录记进落盘台账，
 * 宿主直接 SIGKILL doctor 时由下一次 doctor 补删（其中 codex、zcode 两家放的是含真实凭据的副本）。
 * 观察者出错不连累调用方：记不进台账只是少一层兜底，不该让探针失败。
 */
export interface TempDirObserver {
  created(dir: string): Promise<void>;
  removed(dir: string): Promise<void>;
}

let tempDirObserver: TempDirObserver | null = null;

/** 装上或卸下观察者（传 null）；同一时刻只有一个 */
export function observeTempDirs(o: TempDirObserver | null): void {
  tempDirObserver = o;
}

/** 创建一个隔离的临时目录（探针夹具、运行时副本） */
export async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  try {
    await tempDirObserver?.created(dir);
  } catch {
    /* 见 TempDirObserver */
  }
  return dir;
}

/**
 * 把文字里的用户家目录绝对路径归一成 `~`（EV-136 代码双审 r1 GLM-01；EV-200 起自 `adapters/zcode.ts` 挪来，codex 探活共用）。
 *
 * 探活详情会进 preflight / doctor 输出，而那些输出常被抄进 git 里的 evidence——与 `preflight.ts` 的
 * `displayHomePath` 同一关切。放在这里而不从 preflight 引：preflight 依赖适配层，反过来会成环。
 * 家目录取不到或就是 `/` 时原样返回，免得把每个斜杠都换掉。
 */
export function tildeHome(text: string, home: string = os.homedir()): string {
  if (!home || home === path.sep) return text;
  return text.split(home).join('~');
}

/**
 * 路径在用户家目录之下时显示为 `~/…`：预检输出常被抄进 evidence，不必带出用户名。
 *
 * M12 批次 5 起自 `preflight.ts` 挪来（安装器产物经共享读取面检测也要用它，而它不该引 preflight），
 * 并加可选的 `home`：隔离夹具下按扫描所用的家目录折叠（计划双审 AGY-01）。不传时行为同原来。
 */
export function displayHomePath(p: string, home: string = os.homedir()): string {
  const rel = path.relative(home, p);
  if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) return `~/${rel.split(path.sep).join('/')}`;
  return p;
}

/** 临时目录删除失败时的现场：错误码，与调用方给的位置里删除失败后仍在（或查不了）的那些 */
export interface TempDirLeftover {
  code: string;
  remaining: string[];
}

/**
 * 删 mkdtemp 的返回值：重试三次、失败不抛；删成功返回 null（EV-197 定形，EV-200 起从 zcode 适配器抽来跨载体共用）。
 *
 * `force` 只吞 ENOENT，ENOTEMPTY / EBUSY / EACCES 会从 finally 抛出、顶替原结果（EV-194 代码双审 r1 CODEX-01、EV-197）。
 * 只删传进来的那个路径（2026-09-20 事故后的规矩）：不拼路径、不走别的变量。
 *
 * `copies` 是调用方写过凭据副本的位置，只用于删除失败后的现场 stat、不用于删除：递归删除是删到一半才失败，
 * 按写入时的情形推断两个方向都会说错（EV-197 代码双审 GLM-01 ≡ CODEX-03）。`ENOENT` 才算不在，
 * 查不了（权限等）按在说——宁可多提醒，不在可能含凭据的目录上断言「没有」。为空时不查。
 * 措辞由各载体自持（`zcodeTempDirResidueText`、`codexTempDirResidueText`）。
 *
 * EV-204 起它也删 `workTreeHash` 的临时索引目录、自检夹具根与到期运行目录——最后一种不是 mkdtemp 的返回值，
 * 而是 `pruneRunDirs` 在本项目桶里逐个列出的目录；「只删传进来的那个路径」照旧成立。
 *
 * 与 `probes/zcode.ts` 同形臂的注入选项 `removeTempDir` 不是一回事（EV-200 计划双审 GLM-04）：那个是 zcode 薄包装
 * `removeZcodeTempDir` 的替身、返回整句提示；本函数返回结构化现场。
 */
export async function tryRemoveTempDir(dir: string, copies: readonly string[]): Promise<TempDirLeftover | null> {
  try {
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
    try {
      await tempDirObserver?.removed(dir);
    } catch {
      /* 见 TempDirObserver */
    }
    return null;
  } catch (e) {
    const remaining: string[] = [];
    for (const p of copies) {
      const there = await fs.stat(p).then(
        () => true,
        (err: unknown) => (err as NodeJS.ErrnoException).code !== 'ENOENT',
      );
      if (there) remaining.push(p);
    }
    // 回退到消息时同样归一家目录（代码双审 CODEX-03）：fs 的系统错误恒带 code，这一支近于不可达，但它从此三处共用
    return { code: (e as NodeJS.ErrnoException).code ?? tildeHome((e as Error).message), remaining };
  }
}
