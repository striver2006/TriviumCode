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
