/**
 * 编译测试命令候选探针（设计 §14.1）。
 *
 * **只探测，绝不执行**——探到的 `scripts.test` 可能耗时极长、依赖外部服务或有副作用。
 * 候选仅供 `trivium doctor --suggest-verify` 展示，由人确认后手工写入 `verify.build/test`。
 * 本模块只读文件，不 spawn 任何进程。
 *
 * 产出的每条命令都**相对项目根自包含**：`trivium verify` 以项目根为 cwd、
 * 逐条起独立的 `/bin/sh -c`（verify.ts），`cd` 不跨条累积，故子目录命中时自带 `cd` 前缀。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { exists } from '../util/fsx.js';

export type CandidateKind = 'node' | 'make' | 'cargo' | 'flutter' | 'go' | 'python';

export interface VerifyCandidate {
  /** 可直接交给 /bin/sh -c 的完整命令，已含 cd 前缀 */
  cmd: string;
  group: 'build' | 'test';
  /** 命中来源，相对项目根，如 `client/package.json` */
  source: string;
  kind: CandidateKind;
}

export interface VerifyProbeResult {
  /** 落盘契约：仅命令字符串。顺序与 candidates 一致 */
  build: string[];
  test: string[];
  /** 内存态，供展示来源列 */
  candidates: VerifyCandidate[];
  /** 截断、解析失败、过滤等提示 */
  notes: string[];
  truncated: boolean;
}

/**
 * 目录黑名单。
 *
 * 另有一条更强的规则：所有 `.` 开头的目录一律跳过（一次吃掉 .git/.trivium/.reviews/
 * .venv/.next/.dart_tool/…，也避免漏名单）。
 *
 * `testdata` 必须在列：Go 的 `testdata/` 里放 `go.mod` 是标准做法。
 * `build` 在列的已知代价：极少数项目把源码放在 build/ 下会被整个跳过——
 * 少探到一个远好过扫进 CMake/Gradle 的产物堆。
 */
const DENY_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'vendor', 'third_party',
  'coverage', 'tmp', 'temp', 'venv', 'env', '__pycache__', 'Pods',
  'bin', 'obj', 'testdata', 'fixtures', 'gen', 'generated',
]);

const MAX_DEPTH = 2;
const MAX_DIRS = 300;
const MAX_HIT_DIRS = 10;
const MAX_CMDS = 24;
/** 防止有人在仓库里塞个巨大的生成文件叫 Makefile */
const MAX_MANIFEST_BYTES = 1024 * 1024;

/** POSIX 单引号转义：a'b → 'a'\''b' */
export function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** 首字符排除 `-`，避免 `cd -foo` 被当成选项 */
const SAFE_REL = /^[A-Za-z0-9._][A-Za-z0-9._\-/]*$/;

/**
 * 相对根的目录 → `cd <dir> && ` 前缀；根目录返回空串。
 *
 * 安全路径刻意不加引号：这些字符串的用途就是给人看、给人粘贴，
 * `cd client && …` 比 `cd 'client' && …` 更可读。
 */
export function cdPrefix(relDir: string): string {
  if (relDir === '' || relDir === '.') return '';
  // 统一分隔符：命令交给 /bin/sh，反斜杠在那里是转义符而非分隔符
  const posix = relDir.split(path.sep).join('/');
  if (SAFE_REL.test(posix)) return `cd ${posix} && `;
  return `cd -- ${shQuote(posix)} && `;
}

// ── package.json / 包管理器 ────────────────────────────────────────────────

type Pm = 'npm' | 'pnpm' | 'yarn' | 'bun';

/** 同目录多 lockfile 共存时的固定优先级：package-lock 最易被误 `npm install` 遗留，排最后 */
const LOCKFILES: ReadonlyArray<readonly [string, Pm]> = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lockb', 'bun'],
  ['bun.lock', 'bun'],
  ['package-lock.json', 'npm'],
];

/**
 * 判定包管理器。
 *
 * corepack 的 `packageManager` 字段优先——那是人的显式声明，不是推断。
 * 其次同目录 lockfile，再次逐级上溯到项目根（pnpm/yarn workspace 只在仓库根放一份 lock）。
 */
export async function choosePm(
  projectRoot: string,
  dirAbs: string,
  declared: string | undefined,
): Promise<Pm> {
  const name = declared?.split('@')[0]?.trim();
  if (name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'npm') return name;

  let cur = dirAbs;
  for (;;) {
    for (const [file, pm] of LOCKFILES) {
      if (await exists(path.join(cur, file))) return pm;
    }
    if (path.resolve(cur) === path.resolve(projectRoot)) break;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return 'npm';
}

/**
 * `npm init` 的占位 test 脚本。
 *
 * 必须过滤：它恒定非零退出，粘进 verify.test 会让整条流水线永远 failed。
 */
export function isPlaceholderTestScript(v: string): boolean {
  return /no test specified/i.test(v) || /^\s*echo\b.*\bexit\s+1\s*$/.test(v.trim());
}

/**
 * 一律输出 `<pm> run <script>`，不做 pnpm/yarn 省略 run 的优化。
 *
 * 因为 `bun test` 与 `bun run test` **语义不同**：前者跑 bun 内置测试运行器
 * （自行扫 *.test.ts），后者才跑 scripts.test。探针的职责是把 scripts.test 转成命令，
 * 用 `bun test` 是实打实的错误输出。既然 bun 必须特判，统一规则比四套规则更不易错。
 */
async function detectNode(
  projectRoot: string,
  relDir: string,
  notes: string[],
): Promise<VerifyCandidate[]> {
  const dirAbs = path.join(projectRoot, relDir);
  const pkgPath = path.join(dirAbs, 'package.json');
  if (!(await exists(pkgPath))) return [];

  let pkg: { scripts?: Record<string, string>; packageManager?: string };
  try {
    pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as typeof pkg;
  } catch {
    notes.push(`${path.join(relDir, 'package.json')} 不是合法 JSON，已跳过该生态`);
    return [];
  }

  const scripts = pkg.scripts ?? {};
  const pm = await choosePm(projectRoot, dirAbs, pkg.packageManager);
  const prefix = cdPrefix(relDir);
  const source = relDir === '' ? 'package.json' : `${relDir}/package.json`;
  const out: VerifyCandidate[] = [];

  const push = (script: string, group: 'build' | 'test'): void => {
    out.push({ cmd: `${prefix}${pm} run ${script}`, group, source, kind: 'node' });
  };

  // build 组按序取第一个命中的；typecheck 也算 build（沿用既有语义）
  for (const s of ['build', 'typecheck', 'type-check']) {
    if (scripts[s]) { push(s, 'build'); break; }
  }
  const t = scripts['test'];
  if (t !== undefined) {
    if (isPlaceholderTestScript(t)) {
      notes.push(`${source} 的 test 是 \`npm init\` 占位脚本（恒定非零退出），已过滤`);
    } else {
      push('test', 'test');
    }
  }
  return out;
}

// ── 其余生态 ──────────────────────────────────────────────────────────────

/** 读文本，超大文件直接跳过 */
async function readManifest(p: string): Promise<string | null> {
  try {
    const st = await fs.stat(p);
    if (!st.isFile() || st.size > MAX_MANIFEST_BYTES) return null;
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

const MAKEFILE_NAMES = ['Makefile', 'makefile', 'GNUmakefile'] as const;

/**
 * `^build\s*:(?!=)` 而非 `^build:`：后者漏 `build :`，且会被 `build := x` 变量赋值误命中。
 */
async function detectMake(projectRoot: string, relDir: string): Promise<VerifyCandidate[]> {
  for (const name of MAKEFILE_NAMES) {
    const p = path.join(projectRoot, relDir, name);
    const mk = await readManifest(p);
    if (mk === null) continue;
    const prefix = cdPrefix(relDir);
    const source = relDir === '' ? name : `${relDir}/${name}`;
    const out: VerifyCandidate[] = [];
    if (/^build\s*:(?!=)/m.test(mk)) {
      out.push({ cmd: `${prefix}make build`, group: 'build', source, kind: 'make' });
    }
    if (/^test\s*:(?!=)/m.test(mk)) {
      out.push({ cmd: `${prefix}make test`, group: 'test', source, kind: 'make' });
    }
    return out;
  }
  return [];
}

async function detectCargo(projectRoot: string, relDir: string): Promise<VerifyCandidate[]> {
  if (!(await exists(path.join(projectRoot, relDir, 'Cargo.toml')))) return [];
  const prefix = cdPrefix(relDir);
  const source = relDir === '' ? 'Cargo.toml' : `${relDir}/Cargo.toml`;
  return [
    { cmd: `${prefix}cargo build`, group: 'build', source, kind: 'cargo' },
    { cmd: `${prefix}cargo test`, group: 'test', source, kind: 'cargo' },
  ];
}

async function detectFlutter(projectRoot: string, relDir: string): Promise<VerifyCandidate[]> {
  if (!(await exists(path.join(projectRoot, relDir, 'pubspec.yaml')))) return [];
  const prefix = cdPrefix(relDir);
  const source = relDir === '' ? 'pubspec.yaml' : `${relDir}/pubspec.yaml`;
  return [
    { cmd: `${prefix}flutter build`, group: 'build', source, kind: 'flutter' },
    { cmd: `${prefix}flutter test`, group: 'test', source, kind: 'flutter' },
  ];
}

/** `go build ./...` 对 library-only 模块也做全量类型检查，安全 */
async function detectGo(projectRoot: string, relDir: string): Promise<VerifyCandidate[]> {
  if (!(await exists(path.join(projectRoot, relDir, 'go.mod')))) return [];
  const prefix = cdPrefix(relDir);
  const source = relDir === '' ? 'go.mod' : `${relDir}/go.mod`;
  return [
    { cmd: `${prefix}go build ./...`, group: 'build', source, kind: 'go' },
    { cmd: `${prefix}go test ./...`, group: 'test', source, kind: 'go' },
  ];
}

/**
 * Python。Node 18 无 TOML 解析器，用行扫描识别 section 头即可——探针不需要完整语义。
 *
 * 刻意**不**猜 `python -m unittest discover`（发现规则变数太多，猜错概率高于猜对），
 * 也不出 `python -m build`（需额外装包，且打 wheel 不是 verify 要的「编译通过」信号）。
 * 这些命令会被真实执行，宁缺毋滥。
 */
async function detectPython(
  projectRoot: string,
  relDir: string,
  notes: string[],
): Promise<VerifyCandidate[]> {
  const dirAbs = path.join(projectRoot, relDir);
  const pyproject = await readManifest(path.join(dirAbs, 'pyproject.toml'));
  if (pyproject === null) return [];

  const has = async (f: string): Promise<boolean> => exists(path.join(dirAbs, f));
  const section = (name: string): boolean =>
    new RegExp(`^\\s*\\[${name.replace(/[.[\]]/g, '\\$&')}\\]`, 'm').test(pyproject);

  let runner = '';
  if (await has('uv.lock')) runner = 'uv run ';
  else if ((await has('poetry.lock')) || section('tool.poetry')) runner = 'poetry run ';
  else if ((await has('pdm.lock')) || section('tool.pdm')) runner = 'pdm run ';

  const prefix = cdPrefix(relDir);
  const source = relDir === '' ? 'pyproject.toml' : `${relDir}/pyproject.toml`;
  const out: VerifyCandidate[] = [];

  // build 组：只在有静态检查配置时出，与「scripts.typecheck 归 build」的既有语义一致
  if (section('tool.mypy') || (await has('mypy.ini'))) {
    out.push({ cmd: `${prefix}${runner}mypy .`, group: 'build', source, kind: 'python' });
  }

  const pytestSignal =
    section('tool.pytest.ini_options') ||
    (await has('pytest.ini')) ||
    (await has('conftest.py')) ||
    /\bpytest\b/.test(pyproject);
  if (pytestSignal) {
    out.push({ cmd: `${prefix}${runner}pytest`, group: 'test', source, kind: 'python' });
  } else {
    notes.push(`${source} 未见 pytest 信号，不臆测测试命令——请自行确认后填写`);
  }
  return out;
}

// ── 目录收集与编排 ────────────────────────────────────────────────────────

/**
 * BFS 收集候选目录。同层按字典序 → 结果确定（防 readdir 顺序不稳）。
 *
 * 不用 `git ls-files` 白嫖 .gitignore：doctor 要能在非 git 目录跑
 * （cli.ts 用 allowUninitialized），且会给测试夹具凭空加一层 git 依赖。
 */
export async function collectDirs(root: string): Promise<string[]> {
  const out: string[] = ['']; // 根永远在列
  let queue: Array<{ rel: string; depth: number }> = [{ rel: '', depth: 0 }];
  let visited = 0;

  while (queue.length > 0) {
    const next: typeof queue = [];
    for (const { rel, depth } of queue) {
      if (depth >= MAX_DEPTH || visited >= MAX_DIRS) continue;
      visited++;
      let entries;
      try {
        entries = await fs.readdir(path.join(root, rel), { withFileTypes: true });
      } catch {
        continue; // 权限不足等：跳过，不是 doctor 的职责
      }
      for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        // 符号链接一律不跟：既防环，也防探到仓库外
        if (!e.isDirectory() || e.isSymbolicLink()) continue;
        if (e.name.startsWith('.') || DENY_DIRS.has(e.name)) continue;
        const childRel = rel === '' ? e.name : path.join(rel, e.name);
        out.push(childRel);
        next.push({ rel: childRel, depth: depth + 1 });
      }
    }
    queue = next;
  }
  return out;
}

interface DirOpts {
  suppressNode: boolean;
  suppressGo: boolean;
  notes: string[];
}

/** 单目录内固定顺序，保证结果确定且测试可断言 */
async function probeDir(
  projectRoot: string,
  relDir: string,
  o: DirOpts,
): Promise<VerifyCandidate[]> {
  const out: VerifyCandidate[] = [];
  if (!o.suppressNode) out.push(...(await detectNode(projectRoot, relDir, o.notes)));
  out.push(...(await detectMake(projectRoot, relDir)));
  out.push(...(await detectCargo(projectRoot, relDir)));
  out.push(...(await detectFlutter(projectRoot, relDir)));
  if (!o.suppressGo) out.push(...(await detectGo(projectRoot, relDir)));
  out.push(...(await detectPython(projectRoot, relDir, o.notes)));
  return out;
}

/** 根是 JS 工作区时，后代的 node 候选已被根的聚合命令覆盖 */
async function detectJsWorkspaceRoot(projectRoot: string): Promise<boolean> {
  if (await exists(path.join(projectRoot, 'pnpm-workspace.yaml'))) return true;
  const raw = await readManifest(path.join(projectRoot, 'package.json'));
  if (raw === null) return false;
  try {
    return (JSON.parse(raw) as { workspaces?: unknown }).workspaces !== undefined;
  } catch {
    return false;
  }
}

export async function probeVerifyCommands(projectRoot: string): Promise<VerifyProbeResult> {
  const notes: string[] = [];
  const suppressNodeDescendants = await detectJsWorkspaceRoot(projectRoot);
  const hasGoWork = await exists(path.join(projectRoot, 'go.work'));

  const dirs = await collectDirs(projectRoot);
  const hitDirs: string[] = [];
  const candidates: VerifyCandidate[] = [];
  let truncated = false;

  for (const rel of dirs) {
    /*
     * 命中即剪枝：某个**非根**目录产出了候选，就认定它是一个项目单元边界，不再下探其子树。
     * 专治 Tauri 这类布局——client/ 命中后不再进 client/src-tauri/，
     * 否则会吐出一条没人要的 `cargo build`（Rust 侧本该由 `pnpm tauri build` 驱动）。
     * 根永不剪枝：否则「根有文档站 package.json + server/ 是 Go」会漏掉 Go。
     */
    if (hitDirs.some((h) => h !== '' && (rel === h || rel.startsWith(h + path.sep)))) continue;
    if (hitDirs.length >= MAX_HIT_DIRS || candidates.length >= MAX_CMDS) {
      truncated = true;
      break;
    }

    const got = await probeDir(projectRoot, rel, {
      suppressNode: rel !== '' && suppressNodeDescendants,
      suppressGo: rel !== '' && hasGoWork,
      notes,
    });
    if (got.length > 0) {
      candidates.push(...got);
      hitDirs.push(rel);
    }
  }

  const seen = new Set<string>();
  const uniq = candidates.filter((c) => (seen.has(c.cmd) ? false : (seen.add(c.cmd), true)));

  return {
    build: uniq.filter((c) => c.group === 'build').map((c) => c.cmd),
    test: uniq.filter((c) => c.group === 'test').map((c) => c.cmd),
    candidates: uniq,
    notes,
    truncated,
  };
}
