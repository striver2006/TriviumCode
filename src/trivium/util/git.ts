/**
 * Git 辅助：临时索引快照、状态指纹、diff。
 *
 * 铁律（设计 §9.2）：**绝不使用 `git add -A` 操作真实索引**。
 * 计算 tree_hash 一律走独立的 GIT_INDEX_FILE，跑完即删，
 * 保证不干扰开发者的暂存区、不制造误提交风险。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { run } from './exec.js';
import { makeTempDir } from './fsx.js';

export interface GitStatusEntry {
  /** git status --porcelain 的两字符状态码，如 '??' 'M ' ' M' 'A ' */
  status: string;
  /** 相对仓库根的路径 */
  path: string;
}

async function git(cwd: string, args: string[], env?: Record<string, string | undefined>) {
  // core.quotePath=false：否则 git 会把非 ASCII 路径转成 C 风格八进制转义
  // （中文路径变成 "\344\270\216…"），下游拿到的路径无法用于文件系统操作。
  // 实跑时真的踩到过：漂移报告里的中文路径全是乱码。
  return run('git', ['-c', 'core.quotePath=false', ...args], { cwd, env, timeoutMs: 120_000 });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await git(cwd, ['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && r.stdout.trim() === 'true';
}

export async function repoRoot(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['rev-parse', '--show-toplevel']);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function headSha(cwd: string): Promise<string | null> {
  const r = await git(cwd, ['rev-parse', 'HEAD']);
  return r.code === 0 ? r.stdout.trim() : null;
}

export async function gitVersion(): Promise<string | null> {
  const r = await run('git', ['--version'], { timeoutMs: 15_000 });
  if (r.code !== 0) return null;
  return r.stdout.trim().replace(/^git version\s*/, '');
}

/**
 * 用**临时索引**计算当前工作树（含未跟踪文件）的 tree hash。
 *
 * 步骤：复制当前索引到临时文件 → `add -A`（作用于临时索引）→ `write-tree`。
 * 全程 GIT_INDEX_FILE 指向临时文件，真实的 .git/index 分毫不动。
 */
export async function workTreeHash(cwd: string): Promise<string> {
  const tmpDir = await makeTempDir('trivium-index');
  const idx = path.join(tmpDir, 'index');
  try {
    const env = { GIT_INDEX_FILE: idx };
    // 以 HEAD 为基线填充临时索引；空仓库（无 HEAD）时跳过，从零开始
    await git(cwd, ['read-tree', 'HEAD'], env);
    const add = await git(cwd, ['add', '-A', '--', '.'], env);
    if (add.code !== 0) throw new Error(`git add to temp index failed: ${add.stderr.trim()}`);
    const wt = await git(cwd, ['write-tree'], env);
    if (wt.code !== 0) throw new Error(`git write-tree failed: ${wt.stderr.trim()}`);
    return wt.stdout.trim();
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

/** `git status --porcelain -uall` 的结构化结果，用于只读指纹与 scratch_paths 探针 */
export async function statusPorcelain(cwd: string): Promise<GitStatusEntry[]> {
  const r = await git(cwd, ['status', '--porcelain', '-uall']);
  if (r.code !== 0) return [];
  return r.stdout
    .split('\n')
    .filter((l) => l.length > 3)
    .map((l) => {
      const status = l.slice(0, 2);
      let p = l.slice(3);
      // 重命名形如 "old -> new"，取新路径
      const arrow = p.indexOf(' -> ');
      if (arrow !== -1) p = p.slice(arrow + 4);
      // core.quotePath=false 后一般不会再加引号，但含空格/引号的路径仍会被引起来
      if (p.startsWith('"') && p.endsWith('"')) {
        try {
          p = JSON.parse(p) as string;
        } catch {
          p = p.slice(1, -1);
        }
      }
      return { status, path: p };
    });
}

/** 比较两棵 tree，返回变更文件的相对路径 */
export async function diffTrees(cwd: string, treeA: string, treeB: string): Promise<string[]> {
  const r = await git(cwd, ['diff-tree', '-r', '--name-only', '--no-commit-id', treeA, treeB]);
  if (r.code !== 0) return [];
  return r.stdout.split('\n').filter(Boolean);
}

/**
 * code 阶段的被审补丁：`git diff <base>` + 未跟踪文件。
 *
 * `excludePrefixes` 是**安全边界，不是优化**。未跟踪文件靠 `--exclude-standard`
 * 走 `.gitignore`，但那是用户的文件，不能拿它当保障：
 *
 * - `.reviews/` 是**刻意纳入版本管理**的，对方的审查产出一旦处于未跟踪状态
 *   （刚落盘还没 commit，正是常态）就会被收进补丁，
 *   于是经**被审对象本身**泄漏给审查员——三道屏蔽全部绕过。
 * - `.trivium/` 下的运行时状态、锁、日志同理，只会给补丁添噪。
 *
 * 所以这两处由调用方显式传入并在此无条件剔除，与 `.gitignore` 写了什么无关。
 */
export async function diffAgainst(
  cwd: string,
  base: string,
  excludePrefixes: readonly string[] = [],
): Promise<string> {
  const excluded = (rel: string): boolean =>
    excludePrefixes.some((p) => rel === p || rel.startsWith(p.endsWith('/') ? p : `${p}/`));

  // 用 pathspec 让 git 自己排除已跟踪文件的变更
  const pathspecs = excludePrefixes.map((p) => `:(exclude)${p.replace(/\/+$/, '')}/**`);
  const tracked = await git(cwd, ['diff', '--find-renames', base, '--', '.', ...pathspecs]);
  let out = tracked.code === 0 ? tracked.stdout : '';

  const untracked = await git(cwd, ['ls-files', '--others', '--exclude-standard']);
  if (untracked.code === 0) {
    for (const f of untracked.stdout.split('\n').filter(Boolean)) {
      if (excluded(f)) continue;
      const d = await git(cwd, ['diff', '--no-index', '--find-renames', '/dev/null', f]);
      // --no-index 有差异时退出码为 1，属正常
      if (d.stdout) out += d.stdout;
    }
  }
  return out;
}

/** 初始化一个干净的夹具仓库（探针用） */
export async function initFixtureRepo(dir: string): Promise<void> {
  await run('git', ['init', '-q', '-b', 'main'], { cwd: dir, timeoutMs: 30_000 });
  await run('git', ['config', 'user.email', 'probe@triviumcode.local'], { cwd: dir });
  await run('git', ['config', 'user.name', 'trivium-probe'], { cwd: dir });
  await run('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  await run('git', ['add', '-A'], { cwd: dir, timeoutMs: 30_000 });
  await run('git', ['commit', '-q', '-m', 'probe fixture baseline', '--no-verify'], {
    cwd: dir,
    timeoutMs: 30_000,
  });
}
