/**
 * Git 辅助：临时索引快照、状态指纹、diff。
 *
 * 铁律（设计 §9.2）：**绝不使用 `git add -A` 操作真实索引**。
 * 计算 tree_hash 一律走独立的 GIT_INDEX_FILE，跑完即删，
 * 保证不干扰开发者的暂存区、不制造误提交风险。
 */
import path from 'node:path';
import { run, type RunResult } from './exec.js';
import { EXIT, TriviumError, swallowedTextHint } from '../exit-codes.js';
import { makeTempDir, matchesAnyGlob, tildeHome, tryRemoveTempDir } from './fsx.js';
import { warn } from './log.js';

export interface GitStatusEntry {
  /** git status --porcelain 的两字符状态码，如 '??' 'M ' ' M' 'A ' */
  status: string;
  /** 相对仓库根的路径 */
  path: string;
}

/**
 * 不传 `timeoutMs` 时单次 git 调用的缺省超时（120 s）。导出供「比不了」的原因文案排版用
 * （EV-139 代码双审 CODEX-02 ≡ GLM-02）：文案里的时长从这里取，不复制字面量。
 */
export const GIT_DEFAULT_TIMEOUT_MS = 120_000;

async function git(
  cwd: string,
  args: string[],
  env?: Record<string, string | undefined>,
  /**
   * 单次调用的超时；不传即缺省 120 s，与加这个参数之前逐字节相同（送审冻结、漂移复算都不传）。
   *
   * **显式传了才按进程组收尾**（审批前工作树摘要代码双审 r1 CODEX-03）：摘要按剩余预算传小值，
   * 临时索引的 `add -A` 因此可能在中途被杀；git 在带清理过滤器的仓库里会派生子进程，
   * 只杀直接子进程会把干活的那个遗弃给 init（架构纪律 5、`exec.ts` 的 killTree 注释）。
   */
  timeoutMs?: number,
) {
  // core.quotePath=false：否则 git 会把非 ASCII 路径转成 C 风格八进制转义
  // （中文路径变成 "\344\270\216…"），下游拿到的路径无法用于文件系统操作。
  // 实跑时真的踩到过：漂移报告里的中文路径全是乱码。
  const explicit = timeoutMs !== undefined;
  return run('git', ['-c', 'core.quotePath=false', ...args], {
    cwd,
    env,
    timeoutMs: timeoutMs ?? GIT_DEFAULT_TIMEOUT_MS,
    ...(explicit ? { killTree: true, killGraceMs: 500 } : {}),
  });
}

/**
 * git 调用因超时被杀。带 `timedOut` 标记，让调用方把「超时」与「git 报错」分成两种原因
 * （审批前工作树摘要计划 r2 §2.2，计划双审 CODEX-02）。
 */
export class GitTimeoutError extends Error {
  readonly timedOut = true;
  /** 超时的子命令名（如 `diff-tree`）：调用方排版用它，不去裁剪 `message`（EV-139 代码双审 CODEX-02） */
  readonly what: string;
  constructor(what: string) {
    super(`git ${what} 超时`);
    this.name = 'GitTimeoutError';
    this.what = what;
  }
}

export interface GitCallOptions {
  /** 单次 git 调用的超时毫秒；缺省 120 s */
  timeoutMs?: number;
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
 *
 * `opts.timeoutMs` 只给审批时的工作树摘要用（按剩余预算传）；送审冻结与漂移复算不传，
 * 行为与加这个参数之前逐字节相同。任一步超时抛 {@link GitTimeoutError}。
 *
 * 临时目录删不掉不抛（EV-204）：哈希已算出就照常返回，git 某一步失败就让那个原始错误出去。
 * 此前 finally 的裸递归删除会顶替两者——漂移复算那一处会把三侧已跑完的审查整次判 failed。
 * 没有 notes 通道，往 stderr 提示一行，同一进程只提示一次（{@link indexResidueText}）。
 */
export async function workTreeHash(cwd: string, opts: GitCallOptions = {}): Promise<string> {
  const tmpDir = await makeTempDir('trivium-index');
  const idx = path.join(tmpDir, 'index');
  try {
    const env = { GIT_INDEX_FILE: idx };
    const t = opts.timeoutMs;
    // 只有显式给了预算才区分超时：不传时连报错形态都保持原样（送审冻结与漂移复算不受影响）
    const timed = t !== undefined;
    // 以 HEAD 为基线填充临时索引；空仓库（无 HEAD）时跳过，从零开始
    const rt = await git(cwd, ['read-tree', 'HEAD'], env, t);
    if (timed && rt.timedOut) throw new GitTimeoutError('read-tree');
    const add = await git(cwd, ['add', '-A', '--', '.'], env, t);
    if (timed && add.timedOut) throw new GitTimeoutError('add');
    if (add.code !== 0) throw new Error(`git add to temp index failed: ${add.stderr.trim()}`);
    const wt = await git(cwd, ['write-tree'], env, t);
    if (timed && wt.timedOut) throw new GitTimeoutError('write-tree');
    if (wt.code !== 0) throw new Error(`git write-tree failed: ${wt.stderr.trim()}`);
    return wt.stdout.trim();
  } finally {
    const left = await tryRemoveTempDir(tmpDir, []);
    if (left && !indexResidueNoticed) {
      indexResidueNoticed = true;
      warn(indexResidueText(tmpDir, left.code));
    }
  }
}

/**
 * 同一进程只提示一次（EV-204 决策二）：送审逐侧冻结、探针一轮都会连调好几次，同一个成因不必刷屏。
 * 不导出重置口——「只打一次」只在单测的子进程里断言，进程内用例不断言 stderr（计划双审 AGY-03）。
 */
let indexResidueNoticed = false;

/**
 * 临时索引目录删不掉时的提示正文（导出供单测逐字比对）。
 *
 * 主语是本程序、不断言目录全貌（计划双审 CODEX-04）：TriviumCode 往里写的只有 git 经 `GIT_INDEX_FILE`
 * 写的索引文件（`index`，被超时杀掉时可能另有 `index.lock`），而用户仓库的 clean 过滤器之类也能往这个目录写东西。
 */
export function indexResidueText(dir: string, code: string): string {
  return (
    `工作树哈希的临时目录删除失败（${code}）：${tildeHome(dir)} 仍在——` +
    'TriviumCode 只往里写了 git 临时索引、没有凭据，请手工删除（本进程之后的同类失败不再提示）'
  );
}

/** 是否浅克隆（`git rev-parse --is-shallow-repository`）；判不出返回 null */
export async function isShallowRepo(cwd: string): Promise<boolean | null> {
  const r = await git(cwd, ['rev-parse', '--is-shallow-repository']);
  if (r.code !== 0) return null;
  return r.stdout.trim() === 'true';
}

/**
 * 仓库的根提交（`git rev-list --max-parents=0 HEAD`），作**仓库身份**用（EV-82 构建标识）。
 *
 * 多根仓库取字典序第一个，于是同一仓库的**完整**克隆算出同一个值。
 * **浅克隆返回 null**，不返回移植边界：浅仓里 `--max-parents=0` 命中的是浅边界提交，
 * 它随克隆深度变，拿它当身份会让本仓判定静默失效（代码双审 r1 CODEX-03 ≡ GLM-04）。
 * 空仓库、非 git 目录、判不出是否浅仓，同样返回 null。
 */
export async function rootCommit(cwd: string): Promise<string | null> {
  if ((await isShallowRepo(cwd)) !== false) return null;
  const r = await git(cwd, ['rev-list', '--max-parents=0', 'HEAD']);
  if (r.code !== 0) return null;
  const roots = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean).sort();
  return roots[0] ?? null;
}

/**
 * 取 tree 对象下若干路径各自的对象 id；路径不存在记 `absent`（EV-82 构建标识的 `inputs_sha256`）。
 *
 * 与 `workTreeHash` 配合：先得工作树的 tree，再按作用面逐项取子对象，
 * 于是作用面外的改动（`doc/`、`.reviews/`）不影响结果。
 */
export async function treeEntryIds(cwd: string, tree: string, paths: readonly string[]): Promise<Array<[string, string]>> {
  const out: Array<[string, string]> = [];
  for (const p of paths) {
    const r = await git(cwd, ['rev-parse', '--verify', '--quiet', `${tree}:${p}`]);
    out.push([p, r.code === 0 ? r.stdout.trim() : 'absent']);
  }
  return out;
}

/** 作用面内是否有未提交改动（含未跟踪文件）：`git status --porcelain -- <paths>` 非空 */
export async function isDirtyWithin(cwd: string, paths: readonly string[]): Promise<boolean | null> {
  const r = await git(cwd, ['status', '--porcelain', '--', ...paths]);
  if (r.code !== 0) return null;
  return r.stdout.trim().length > 0;
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

/**
 * git 对象名的形状闸：只收 sha1（40 位）或 sha256（64 位）小写十六进制。
 *
 * 从留痕读回的对象名（run.json 的 `after_tree_hash`、运行目录 `request.json` 里的送审快照 `tree_hash`）
 * 在任何 git 调用之前过这道闸：以 `-` 开头的值会被 git 当成选项（如 `--output=〈路径〉` 让 git 往那里写文件），
 * 含 `;` `$(` 的合法引用名能过 `cat-file -e` 与 `diff-tree`。审批前工作树摘要与漂移判定（EV-139）共用。
 */
export const OBJECT_NAME_RE = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * 比较两棵 tree，返回变更文件的相对路径。
 *
 * **失败返回 `[]`**——「比不了」与「没变化」同形，**只能用在失败方向保守的地方**：当前只有
 * agy / zcode 探针的 `probeScratchPaths`（少认几个临时路径 ⇒ 之后多报漂移）。判定类调用一律用
 * {@link diffTreesNameStatus}（失败即抛）；跑后漂移判定 `judgeDrift` 已于 EV-139 改用它——它曾依赖
 * 本函数，送审快照的 tree 被清理时把「比不了」判成了「无漂移」。
 *
 * 不带 `-z`：含制表符、换行、双引号、反斜杠的路径会带 C 风格引号原样返回（不过 `unquoteGitPath`）。
 */
export async function diffTrees(cwd: string, treeA: string, treeB: string): Promise<string[]> {
  const r = await git(cwd, ['diff-tree', '-r', '--name-only', '--no-commit-id', treeA, treeB]);
  if (r.code !== 0) return [];
  return r.stdout.split('\n').filter(Boolean);
}

/**
 * 对象在不在对象库里（`cat-file -e <对象名>`）：退 0 为 true、退 1 为 false，
 * 其它情形（含超时、非 git 目录的 128）抛错——「查不了」不与「不在」同形。
 *
 * **不带 `^{tree}` 剥离**（本机 git 实测）：带剥离时对象缺失与「不是 git 仓库」都退 128，分不开；
 * 不带时缺失退 1、非 git 目录退 128。类型不对（不是 tree）交给随后的 `diff-tree` 报错，不在这里判。
 *
 * 为审批前工作树摘要而设（计划 r2 §2.2）：基线是 `write-tree` 写出的不可达对象，可能被 git 清理。
 */
export async function treeExists(cwd: string, tree: string, opts: GitCallOptions = {}): Promise<boolean> {
  const r = await git(cwd, ['cat-file', '-e', tree], undefined, opts.timeoutMs);
  if (r.timedOut) throw new GitTimeoutError('cat-file');
  if (r.code === 0) return true;
  if (r.code === 1) return false;
  throw new Error(`git cat-file 失败（退出码 ${r.code}）：${r.stderr.trim().split('\n')[0] ?? ''}`);
}

/**
 * 两棵 tree 之间逐文件的变更状态（`diff-tree -r --name-status --no-renames -z`）。
 *
 * **非零退出即抛**——这是与 {@link diffTrees} 的唯一区别，也是它存在的理由：
 * `diffTrees` 失败时返回 `[]`，基线对象被清理时它说「无变化」而不是「比不了」。
 * 为审批前工作树摘要而设（审批前工作树摘要计划 r2 §2.2 / §6.3）；跑后漂移判定 `judgeDrift`
 * 于 EV-139 也改用它，失败即判「比不了」（`freeze.ts` 的 `unknown` 结论）。
 *
 * 解析协议（计划双审 AGY-04）：`-z` 下输出为 `状态\0路径\0` 成对出现；按 `\0` 切分、
 * 丢弃末尾空段，段数为奇数即抛。`--no-renames` 保证不出现三段式；路径不加引号，不走 `unquoteGitPath`。
 */
export async function diffTreesNameStatus(
  cwd: string,
  treeA: string,
  treeB: string,
  opts: GitCallOptions = {},
): Promise<Array<{ status: string; path: string }>> {
  const r = await git(
    cwd,
    ['diff-tree', '-r', '--name-status', '--no-renames', '-z', '--no-commit-id', treeA, treeB],
    undefined,
    opts.timeoutMs,
  );
  if (r.timedOut) throw new GitTimeoutError('diff-tree');
  if (r.code !== 0) {
    throw new Error(`git diff-tree 失败（退出码 ${r.code}）：${r.stderr.trim().split('\n')[0] ?? ''}`);
  }
  return parseNameStatusZ(r.stdout);
}

/** `--name-status -z` 输出的成对解析；导出供单测直接喂畸形输入 */
export function parseNameStatusZ(out: string): Array<{ status: string; path: string }> {
  const parts = out.split('\0');
  if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  if (parts.length % 2 !== 0) {
    throw new Error(`git diff-tree -z 输出段数为奇数（${parts.length}），无法成对解析为「状态、路径」`);
  }
  const res: Array<{ status: string; path: string }> = [];
  for (let i = 0; i < parts.length; i += 2) res.push({ status: parts[i]!, path: parts[i + 1]! });
  return res;
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
  /**
   * 按 glob 剔除的路径（`review.sensitive_globs`）。敏感文件只列进禁读清单是不够的：
   * 根目录一个未被 .gitignore 覆盖的 `.env`、或一份被误提交本次又被修改的 `*.pem`，
   * 会整篇收进补丁，经**被审对象本身**进 BRIEF、argv 与 request.json——
   * 禁读清单里还写着「禁止读取 .env」，内容却已经在任务书里了。
   */
  excludeGlobs: readonly string[] = [],
): Promise<string> {
  const excluded = (rel: string): boolean =>
    excludePrefixes.some((p) => rel === p || rel.startsWith(p.endsWith('/') ? p : `${p}/`)) ||
    matchesAnyGlob(rel, excludeGlobs);

  // 用 pathspec 让 git 自己排除已跟踪文件的变更；glob 魔法与 fsx.matchesAnyGlob 同为 fnmatch 语义
  const pathspecs = [
    ...excludePrefixes.map((p) => `:(exclude)${p.replace(/\/+$/, '')}/**`),
    ...excludeGlobs.map((g) => `:(exclude,glob)${g}`),
  ];
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

/** 建夹具仓库每一步 git 调用的超时（EV-209）：原先三条 `config` 不设超时，git 卡住会让调用方永远等下去 */
export const FIXTURE_GIT_TIMEOUT_MS = 30_000;

/**
 * 建夹具仓库的六步（EV-209），导出供单测逐步构造失败。
 *
 * 基线提交恒带 `--allow-empty`：空目录里没有可提交的内容时 git 退 1，此前被静默吞掉、得到一个没有 HEAD 的仓库。
 * 甄别下来没有调用方依赖「没有 HEAD」，而区分「空目录不提交」与「有内容却提交失败」要解析随语言环境变化的输出，
 * 不如让建出来的仓库恒有 HEAD（计划 r2 §2.2）。
 */
export const FIXTURE_REPO_STEPS: ReadonlyArray<{ name: string; args: readonly string[] }> = [
  { name: '初始化仓库', args: ['init', '-q', '-b', 'main'] },
  { name: '配置提交者邮箱', args: ['config', 'user.email', 'probe@triviumcode.local'] },
  { name: '配置提交者名称', args: ['config', 'user.name', 'trivium-probe'] },
  { name: '关闭提交签名', args: ['config', 'commit.gpgsign', 'false'] },
  { name: '暂存全部文件', args: ['add', '-A'] },
  { name: '提交基线', args: ['commit', '-q', '-m', 'probe fixture baseline', '--no-verify', '--allow-empty'] },
];

/** git 输出的头几行：stderr 为空时退回 stdout——`git commit` 无内容可提交时那句话在 stdout（计划 r2 §1.1） */
function outputHead(r: RunResult): string {
  const text = r.stderr.trim() ? r.stderr : r.stdout;
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 3)
    .map((l) => l.slice(0, 200))
    .join(' / ');
}

/**
 * 某一步失败时的错误文案（EV-209，导出供单测逐字比对与合成直测）。
 *
 * 判定顺序写死（计划双审 AGY-03）：超时 → 启动失败 → 信号 → 非零退出。`run` 超时时先置 `timedOut` 再发 SIGTERM，
 * 那次返回的 `signal` 通常也非空，先判信号会把超时说成「被信号终止」。
 * 不带路径：探针夹具失败后目录已删，自检的失败步骤只需要原因。
 */
export function fixtureRepoStepError(index: number, r: RunResult): string {
  const step = FIXTURE_REPO_STEPS[index - 1]!;
  const head = `建仓第 ${index}/${FIXTURE_REPO_STEPS.length} 步「${step.name}」失败：`;
  if (r.timedOut) return `${head}${FIXTURE_GIT_TIMEOUT_MS / 1000} 秒内未结束，已终止`;
  if (r.code === null && r.signal === null) {
    const spawn = /\[spawn error\] (.+)/.exec(r.stderr)?.[1]?.trim();
    return `${head}git 启动失败（${spawn || '原因不明'}）`;
  }
  if (r.signal !== null) return `${head}被信号 ${r.signal} 终止`;
  const out = outputHead(r);
  return `${head}退出码 ${r.code}${out ? `：${out}` : ''}`;
}

/**
 * 初始化一个干净的夹具仓库（探针、自检与集成测试夹具共用）。
 *
 * 逐步查结果（EV-209）：启动失败、非零退出、超时、被信号终止都抛，文案见 {@link fixtureRepoStepError}；
 * 第一步失败即抛，后面不再跑。此前六步的返回值一个都不看，git 缺失或某一步失败时静默建出残缺的夹具，
 * 失败推迟到后面的步骤、以晦涩的方式出现。
 */
export async function initFixtureRepo(dir: string): Promise<void> {
  for (let i = 0; i < FIXTURE_REPO_STEPS.length; i++) {
    const r = await run('git', FIXTURE_REPO_STEPS[i]!.args, { cwd: dir, timeoutMs: FIXTURE_GIT_TIMEOUT_MS });
    if (r.code !== 0 || r.timedOut) throw new Error(fixtureRepoStepError(i + 1, r));
  }
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
