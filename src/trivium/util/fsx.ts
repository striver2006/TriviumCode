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

/** 原子写：先写同目录临时文件再 rename，避免读到写了一半的内容 */
export async function writeAtomic(target: string, content: string | Buffer): Promise<void> {
  await ensureDir(path.dirname(target));
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, content);
  await fs.rename(tmp, target);
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
  const norm = relPath.replace(/^\.\//, '');
  return globs.some((g) => globToRegExp(g).test(norm));
}

/** 创建一个隔离的临时目录（探针夹具、运行时副本） */
export async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
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
