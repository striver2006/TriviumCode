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
import { EXIT, TriviumError, swallowedTextHint } from '../exit-codes.js';
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
/**
 * 还原 git 加过引号的路径。
 *
 * `core.quotePath=false` 只解决「非 ASCII 被转成八进制」这一类。
 * git 的 C 引用集是**双引号、反斜杠、控制字符**（以及 quotePath=true 时的非 ASCII），
 * **不含空格**——含空格的路径不会被引起来。不还原的话，路径会带着引号进入后续比对。
 */
export function unquoteGitPath(p: string): string {
  if (!(p.startsWith('"') && p.endsWith('"') && p.length >= 2)) return p;
  const body = p.slice(1, -1);

  /*
   * 自己解析 C 风格转义，**不能借道 `JSON.parse`**（审查意见 AGY-04）。
   *
   * JSON 不支持八进制转义，而 git 在 `core.quotePath=true`（默认值）下正是用它
   * 表示非 ASCII：实测 `src/中文"引号.ts` 会输出成
   *   "src/\344\270\255\346\226\207\"\345\274\225\345\217\267.ts"
   * `JSON.parse` 直接抛，旧实现退回 `slice(1,-1)`，留下满是裸转义的文本。
   *
   * 我们自己的调用一律加 `-c core.quotePath=false`，所以这条平时不触发；
   * 但 `filesInDiff` 也会解析**外部产生的**补丁，那里没有这个保证。
   *
   * 八进制按**字节**收集后再整体按 UTF-8 解码——逐字节转 char 会把多字节汉字拆碎。
   */
  const bytes: number[] = [];
  const pushStr = (str: string): void => {
    for (const b of Buffer.from(str, 'utf8')) bytes.push(b);
  };

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]!;
    if (ch !== '\\') {
      pushStr(ch);
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    if (next >= '0' && next <= '7') {
      // 最多三位八进制
      let oct = '';
      let k = i + 1;
      while (k < body.length && oct.length < 3 && body[k]! >= '0' && body[k]! <= '7') {
        oct += body[k]!;
        k++;
      }
      bytes.push(Number.parseInt(oct, 8) & 0xff);
      i = k - 1;
      continue;
    }
    const simple: Record<string, string> = {
      n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', a: '\x07',
      '\\': '\\', '"': '"',
    };
    const mapped = simple[next];
    pushStr(mapped ?? next); // 未知转义原样保留那个字符
    i++;
  }
  return Buffer.from(bytes).toString('utf8');
}

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
      return { status, path: unquoteGitPath(p) };
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
  /*
   * ── 非零退出必须抛，不能吞（审查意见 GLM-r2-04）──
   *
   * `--base` 是用户参数。拼错 ref、ref 被重写掉、git 环境异常时，原先
   * `tracked.code === 0 ? tracked.stdout : ''` 会让**已跟踪变更全部消失**，
   * 而未跟踪文件的 diff 仍让 body 非空——空判定不触发，一份缺失全部已跟踪变更的
   * 残缺补丁带着错误的 `# base:` 照常物化成 changes.diff、成为两侧共同的
   * subject_sha256。两侧「认真审完」的其实是一段不完整的变更。
   */
  if (tracked.code !== 0) {
    throw new TriviumError(
      EXIT.USAGE,
      `\`git diff ${base}\` 失败（退出码 ${tracked.code}）。\n` +
        `  ${tracked.stderr.trim().split('\n').slice(0, 3).join('\n  ')}\n` +
        '  --base 是否写错？请给出一个存在的 ref。被审补丁在冻结前失败，未产生任何工件。' +
        swallowedTextHint(base),
    );
  }
  let out = tracked.stdout;

  const untracked = await git(cwd, ['ls-files', '--others', '--exclude-standard']);
  if (untracked.code !== 0) {
    throw new TriviumError(
      EXIT.ENV,
      `枚举未跟踪文件失败（退出码 ${untracked.code}）：${untracked.stderr.trim().slice(0, 200)}\n` +
        '  未跟踪文件也是被审变更的一部分，拿不到就不能声称补丁完整。',
    );
  }
  {
    for (const f of untracked.stdout.split('\n').filter(Boolean).map(unquoteGitPath)) {
      if (excluded(f)) continue;
      /*
       * ── `--` 分隔符不是装饰（审查意见 GLM-04）──
       *
       * `ls-files` 输出的是不带 `./` 的相对路径，仓库根下一个名为 `-weird.txt`
       * 的未跟踪文件会被 git 当成选项：实测退出码 129、stdout 为空。
       * 少了这个分隔符，该文件就从补丁里静默消失。
       */
      const d = await git(cwd, ['diff', '--no-index', '--find-renames', '--', '/dev/null', f]);
      /*
       * ── 退出码不足以判定成败，要合看 stdout/stderr ──
       *
       * `--no-index` 有差异时退出码为 1（正常），空文件无内容差异时为 0（也正常）。
       * 但文件在 `ls-files` 枚举之后、diff 之前被删掉时**同样是 1**，只是
       * stdout 为空而 stderr 为 `error: Could not access '<f>'`——单看退出码
       * 区分不出来。沿用本函数上方 tracked 分支确立的原则（GLM-r2-04）：
       * 拿不到就不能声称补丁完整，宁可整次失败也不产出残缺补丁。
       *
       * `code === null` 是进程被信号终止（如 OOM kill），同样拿不到完整输出。
       */
      if (d.code === null || d.code > 1 || (d.code === 1 && !d.stdout && d.stderr.trim())) {
        throw new TriviumError(
          EXIT.ENV,
          `未跟踪文件 ${f} 的补丁生成失败（${d.code === null ? '被信号终止' : `退出码 ${d.code}`}）：` +
            `${d.stderr.trim().slice(0, 200)}\n` +
            '  它是被审变更的一部分，漏掉它等于让两侧审查一段不完整的补丁。',
        );
      }
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

/**
 * 工作树中相对 HEAD **被删除或被改动**的已跟踪文件（限定某个路径前缀）。
 *
 * 留痕核对的第二个外部锚（审查意见 GLM-r2-03）。第一个锚 `task.json.runs[]` 治不了
 * 「把整个主题目录删掉或改名」——那会把 `task.json` 自己也带走。
 * 而 `.reviews/` 是**刻意纳入版本管理**的，git 索引记得每一份已提交的工件，
 * 删目录、改目录名（表现为一批删除 + 一批未跟踪新增）都瞒不过它。
 *
 * 只看已跟踪文件，所以它与基于 run.json 的核对互补：
 * git 管已提交的，run.json 管刚落盘还没提交的。
 */
/** 读 HEAD 中某文件的内容（路径相对仓库根）。无 HEAD 或文件不在 HEAD 里返回 null */
export async function readAtHead(cwd: string, relPath: string): Promise<string | null> {
  const r = await git(cwd, ['show', `HEAD:${relPath}`]);
  return r.code === 0 ? r.stdout : null;
}

export async function deletedOrModifiedTracked(
  cwd: string,
  pathPrefix: string,
): Promise<{ deleted: string[]; modified: string[] }> {
  const r = await git(cwd, ['diff', '--name-status', '--no-renames', 'HEAD', '--', pathPrefix]);
  const deleted: string[] = [];
  const modified: string[] = [];
  if (r.code !== 0) return { deleted, modified }; // 无 HEAD（空仓库）等情形：没有可比对的基线
  for (const line of r.stdout.split('\n')) {
    const m = /^([A-Z])\t(.+)$/.exec(line.trim());
    if (!m) continue;
    if (m[1] === 'D') deleted.push(m[2]!);
    else if (m[1] === 'M') modified.push(m[2]!);
  }
  return { deleted, modified };
}
