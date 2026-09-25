/**
 * 安装器：把构建产物与入口资产装到用户目录（设计 §5.2 / 交付物 #8）。
 *
 * ## M10b 第 2 步起是多目标（计划 r2 §3.2、r5 §5.4 / §5.5、r9 §2.1、r10 §2.1 / §2.2）
 *
 *   运行时根（**必装**）  skills/dual-critic/（不含 entry/）
 *                        → `TRIVIUM_ASSET_ROOT ?? ~/.claude/skills/dual-critic`（与编排器同源，`asset-root.ts`）
 *   各家入口 skill        claude：skills/<命令名>/                          → ~/.claude/skills/<命令名>/
 *                        另三家：skills/dual-critic/entry/<agent>/<命令名>/ → <该家 skill 根>/<命令名>/（**拍平**）
 *   只读审查 Agent 定义   skills/dual-critic/agents/trivium-critic.md
 *                        → ~/.gemini/config/agents/trivium-critic/agent.md
 *
 * 各家 skill 根由注册表派生（`entrySkillRootOf`：codex 走 `CODEX_HOME`，未设回落 `~/.codex`）；
 * 哪家的产物在仓库哪个布局，读 `skills-src/carriers/`（与渲染同一份源）。
 *
 * ## 几条硬约束
 *
 * - **拍平，任何目标里都不得出现 `entry/` 子树**：codex 递归枚举 skill 根，`entry/` 下别家的入口会进它的
 *   列表、还能被 `$名字` 调起（第 1 步报告 §5）。运行时根的内容映射同样排除 `entry/`。
 * - **家根不存在即跳过**（本机没装这一家），报告里写明；**运行时根除外**——装了入口却没有运行时，
 *   四条命令一家都跑不了（r2 §3.2.1）。
 * - **先查后写**：残留、重名任何一条不过，整次安装一个文件都不写，报错列出路径。
 *   **只报错、不删除**：那些是用户目录、共享根，删错不可逆（2026-09-20 事故 R1 / R8；r10 §2.1）。
 * - **查重名按完整读取面**：codex、zcode 还读 `~/.agents/skills`（只查不装，那是共享读取面，钉为禁装）。
 * - **运行时根也要过身份判定**：它是唯一由环境变量决定路径的目标，安装整树同步、卸载整棵删除。
 *   与仓库重叠、或非空却不是本产品的运行时，安装拒绝、卸载只提示（`checkRuntimeRoot`）。
 *
 * **不改用户的日常配置**（§16.2 纪律 5）：只写自己的 skill 目录与自己的 Agent 定义，
 * 不碰各家 CLI 的设置文件，也不写 `~/.zcode/**` 的全局模型设置。
 *
 * 升级：目标目录里源码已不存在的文件会被**裁剪**（只裁我们自己的那几个 skill 目录）。
 * 卸载：`node dist/install.cjs --uninstall`。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { agentById, entrySkillRootOf, isAgentId, type AgentId } from './trivium/agents/registry.js';
import { resolveAssetRoot } from './trivium/asset-root.js';
import { ENTRY_OUT_DIR, loadCarriers, type Carrier } from './entry-render.js';

/** 安装面对的用户环境。**测试一律注入临时 home**（r2 §3.2.3），生产取 `os.homedir()` 与 `process.env` */
export interface InstallEnv {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}

export function defaultInstallEnv(): InstallEnv {
  return { home: os.homedir(), env: process.env };
}

/** 运行时资产在仓库里的目录（相对仓库根）：`entry/` 的父目录 */
const RUNTIME_SRC = path.dirname(ENTRY_OUT_DIR);
/** 运行时根里要排除的子目录名 */
const ENTRY_SUBDIR = path.basename(ENTRY_OUT_DIR);
/** 另三家目标根顶层出现即判「历史形态残留」的名字（r10 §2.1） */
const RESIDUE_NAMES: readonly string[] = [path.basename(RUNTIME_SRC), ENTRY_SUBDIR];

export interface EntryTarget {
  agent: AgentId;
  layout: Carrier['layout'];
  familyRoot: string;
  skillsRoot: string;
  readRoots: readonly string[];
  /** 入口 skill 名与仓库内源目录 */
  sources: readonly { name: string; src: string }[];
}

export interface InstallPlan {
  runtimeRoot: string;
  agentTarget: string;
  targets: EntryTarget[];
}

/**
 * 仓库根：本文件编译为 dist/install.cjs，故上溯一级。
 *
 * 不用 `import.meta.url` 兜底：产物是 CJS bundle，esbuild 会把 `import.meta` 置空
 * 并在**每次构建**都警告一次——一个恒不生效的分支换来一条长期警告，不值得。
 * `__filename` 在 CJS 里必然存在；退路用 argv[1]，只为 ESM 测试构建下不至于抛错。
 */
function repoRoot(): string {
  const self = typeof __filename === 'string' ? __filename : (process.argv[1] ?? process.cwd());
  return path.resolve(path.dirname(self), '..');
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 路径的真实形态：最近一个存在的祖先取 realpath，其余段原样接上。
 * 目标可能还不存在（首次安装），而 macOS 的 `/var` → `/private/var` 这类软链会让两条同一处的路径字面不等。
 */
async function realOrResolved(p: string): Promise<string> {
  const abs = path.resolve(p);
  const rest: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return path.join(await fs.realpath(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/** `a` 是否等于 `b` 或在 `b` 之内（都须是 `realOrResolved` 之后的形态） */
function within(a: string, b: string): boolean {
  const rel = path.relative(b, a);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 运行时根 `SKILL.md` 的身份行：front-matter 首个键是本产品运行时的名字 */
const RUNTIME_IDENTITY = `---\nname: ${path.basename(RUNTIME_SRC)}\n`;

/**
 * 运行时根能不能写、能不能删（代码双审 CODEX-01 / GLM-01）。
 *
 * 四个安装目标里**只有它的路径由外部输入决定**（`TRIVIUM_ASSET_ROOT`，文档还教人把它指向工作树），
 * 而安装侧对它整树同步并裁剪、卸载侧整棵删除——所以它必须和入口目录一样先过身份判定：
 *
 * - **与仓库重叠**（落在仓库里，或把仓库包在里面）：拒绝。指向 `<repo>/skills/dual-critic` 时
 *   源即目标，裁剪会删掉进 Git 的 `entry/` 渲染产物；卸载会删掉整棵运行时源。
 * - **已存在且非空、却不是本产品的运行时**：拒绝。判据是 `SKILL.md` 的身份行，不是
 *   `scripts/trivium.cjs`——同步按目录序拷贝，`SKILL.md` 先落盘、`scripts/` 在后，
 *   一次被打断的安装会留下前者而缺后者，按后者判就会把自家目录拒之门外。
 * - 不存在或空目录：放行。
 *
 * 只读，不写任何东西。返回 null 表示可以放行。
 */
async function checkRuntimeRoot(root: string, runtimeRoot: string): Promise<InstallProblem | null> {
  const rt = await realOrResolved(runtimeRoot);
  const repo = await realOrResolved(root);
  if (within(rt, repo) || within(repo, rt)) {
    return { agent: null, kind: 'runtime-overlap', path: runtimeRoot };
  }
  let stat;
  try {
    stat = await fs.stat(runtimeRoot);
  } catch {
    return null;
  }
  if (!stat.isDirectory()) return { agent: null, kind: 'runtime-foreign', path: runtimeRoot };
  if ((await fs.readdir(runtimeRoot)).length === 0) return null;
  return (await isOurRuntime(runtimeRoot)) ? null : { agent: null, kind: 'runtime-foreign', path: runtimeRoot };
}

/** 目录里的 `SKILL.md` 带本产品运行时的身份行（读不到即否） */
async function isOurRuntime(dir: string): Promise<boolean> {
  try {
    return (await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8')).startsWith(RUNTIME_IDENTITY);
  } catch {
    return false;
  }
}

/** 一个目录下带 `SKILL.md` 的直接子目录名（排序），可再排除若干名字 */
async function skillDirs(dir: string, exclude: ReadonlySet<string> = new Set()): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory() || exclude.has(e.name)) continue;
    if (await exists(path.join(dir, e.name, 'SKILL.md'))) out.push(e.name);
  }
  return out.sort();
}

export async function planInstall(root: string, ie: InstallEnv): Promise<InstallPlan> {
  const carriers = await loadCarriers(root);
  const targets: EntryTarget[] = [];
  for (const c of carriers) {
    const agent = agentById(c.agent)!;
    const roots = entrySkillRootOf(agent, ie.home, ie.env);
    const srcDir = c.layout === 'top'
      ? path.join(root, 'skills')
      : path.join(root, ENTRY_OUT_DIR, c.agent);
    const names = await skillDirs(srcDir, c.layout === 'top' ? new Set([path.basename(RUNTIME_SRC)]) : new Set());
    if (names.length === 0) {
      throw new Error(`找不到 ${c.agent} 的入口资产（${path.relative(root, srcDir) || srcDir}）。请先运行 \`npm run render\`。`);
    }
    targets.push({
      agent: c.agent,
      layout: c.layout,
      ...roots,
      sources: names.map((name) => ({ name, src: path.join(srcDir, name) })),
    });
  }
  return {
    runtimeRoot: resolveAssetRoot(undefined, ie.env, ie.home),
    agentTarget: path.join(ie.home, '.gemini/config/agents/trivium-critic/agent.md'),
    targets,
  };
}

/**
 * 递归同步：复制源里的全部文件，删掉目标里源已没有的文件（裁剪孤儿）。`exclude` 只作用于顶层。
 * 导出只为测试直测同路径短路：那一层是防御，公共入口在装前检查里就被拦下，走不到它。
 */
export async function syncDir(
  src: string,
  dst: string,
  exclude: ReadonlySet<string> = new Set(),
): Promise<{ copied: number; removed: string[] }> {
  /*
   * 源与目标同路径：什么都不做（代码双审 GLM-02）。
   * 否则顶层 `exclude` 掉的名字不在 `keep` 里，会被当成孤儿从**源里**裁掉。
   * 运行时根那一格在装前检查里已经拒掉了（`checkRuntimeRoot`），这里是防御，不是主判据。
   */
  if ((await realOrResolved(src)) === (await realOrResolved(dst))) return { copied: 0, removed: [] };
  let copied = 0;
  const removed: string[] = [];
  await fs.mkdir(dst, { recursive: true });
  const srcEntries = (await fs.readdir(src, { withFileTypes: true })).filter((e) => !exclude.has(e.name));
  const keep = new Set(srcEntries.map((e) => e.name));
  for (const e of srcEntries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) {
      const r = await syncDir(s, d);
      copied += r.copied;
      removed.push(...r.removed);
    } else {
      await fs.copyFile(s, d);
      copied++;
    }
  }
  for (const e of await fs.readdir(dst, { withFileTypes: true })) {
    if (keep.has(e.name)) continue;
    const d = path.join(dst, e.name);
    await fs.rm(d, { recursive: true, force: true });
    removed.push(d);
  }
  return { copied, removed };
}

/**
 * 一个同名目录是不是**本产品**的入口 skill：`SKILL.md` 的 front-matter 名字对得上、
 * 正文调用 `.trivium/bin/trivium`。
 *
 * 它决定三件事：两种撞名的报错措辞、安装根内的升级放行（判真即覆盖），以及**卸载的删除面**
 * （判真即整目录删除，代码双审 GLM-04）。判据的边界：用户从本产品 fork 出来、保留原名、
 * 仍调用 wrapper 的 skill 也会判真——安装会覆盖它、卸载会删掉它。不在卸载侧另设更严的判据：
 * 那样会出现「装得上、卸不掉」的不对称，而改比 description 又会在跨版本改过措辞时误判。
 */
async function isOurEntry(dir: string, name: string): Promise<boolean> {
  let md: string;
  try {
    md = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8');
  } catch {
    return false;
  }
  return md.startsWith(`---\nname: ${name}\n`) && md.includes('.trivium/bin/trivium');
}

export interface InstallProblem {
  /** 哪一家的目标；运行时根不属于任何一家，为 null */
  agent: AgentId | null;
  kind: 'residue' | 'third-party' | 'foreign-entry' | 'missing-family' | 'runtime-overlap' | 'runtime-foreign';
  path: string;
}

/** 装前检查：只读，不写任何东西。返回全部问题，调用方决定是否继续 */
export async function checkInstall(selected: readonly EntryTarget[]): Promise<InstallProblem[]> {
  const problems: InstallProblem[] = [];
  for (const t of selected) {
    /*
     * 残留检测只查另三家，claude 目标根豁免：**前提是缺省时运行时根就落在它下面**，
     * 那里的 `dual-critic/` 是自家产物，不是残留（代码双审 r2 CODEX-05）。
     * 运行时根被 `TRIVIUM_ASSET_ROOT` 指到别处时，缺省位置可能留着上一版的运行时——
     * 它不再更新，但也不是嵌套入口（历次安装都排除了 `entry/`）。那一格不在这里阻断，
     * 由 `install()` 在报告里提示（开发机上设过这个变量是常态，阻断会让每次调试安装都先撞墙）。
     */
    if (t.layout === 'entry') {
      for (const n of RESIDUE_NAMES) {
        const p = path.join(t.skillsRoot, n);
        if (await exists(p)) problems.push({ agent: t.agent, kind: 'residue', path: p });
      }
    }
    for (const { name } of t.sources) {
      for (const r of t.readRoots) {
        const p = path.join(r, name);
        if (!(await exists(p))) continue;
        const ours = await isOurEntry(p, name);
        if (r === t.skillsRoot && ours) continue; // 安装根里的自家同名：上一次安装，升级覆盖
        problems.push({ agent: t.agent, kind: ours ? 'foreign-entry' : 'third-party', path: p });
      }
    }
  }
  return problems;
}

export class InstallConflictError extends Error {
  constructor(readonly problems: readonly InstallProblem[]) {
    super(describeProblems(problems));
  }
}

function describeProblems(problems: readonly InstallProblem[]): string {
  const why: Record<InstallProblem['kind'], string> = {
    residue: '目标根顶层有本产品历史形态的目录（整树搬运的残留）：codex 会递归枚举它，把别家的入口调出来',
    'third-party': '读取面里已有同名 skill，且不是本产品的：不覆盖用户的 skill',
    'foreign-entry': '共享读取面里有本产品的同名入口：两份同名时 codex 显式调用会失效、zcode 两份都进模型清单，而且它带的 --driver 可能是别家',
    'missing-family': '指定要装这一家，但它的家根不存在（本机未安装该 CLI，或 CODEX_HOME 指错）',
    'runtime-overlap':
      '运行时根与本仓库重叠（多半是 TRIVIUM_ASSET_ROOT 指向了工作树）：同步会裁掉仓库里的渲染产物。' +
      '安装时请取消这个变量，或指向仓库之外的目录',
    'runtime-foreign':
      '运行时根已存在、非空，但不是本产品的运行时（SKILL.md 身份行对不上）：安装要整树同步它，会删掉里面的东西。' +
      '请检查 TRIVIUM_ASSET_ROOT 是否指错',
  };
  const lines = ['安装前检查未通过，**一个文件都没有写**。以下路径需要你手工处理（安装器不删用户目录里的东西）：'];
  for (const p of problems) lines.push(`  · [${p.agent ?? '运行时根'}] ${p.path}\n      ${why[p.kind]}`);
  lines.push('处理完再重跑安装。');
  return lines.join('\n');
}

export interface TargetReport {
  agent: AgentId;
  skillsRoot: string;
  status: 'installed' | 'skipped';
  /** 跳过原因（人读） */
  reason?: string;
  dirs: { dir: string; files: number }[];
}

export interface InstallReport {
  runtime: { dir: string; files: number };
  targets: TargetReport[];
  removed: string[];
  agentInstalled: string | null;
  notes: string[];
}

export interface InstallOptions {
  /** 只装这几家的入口（运行时根照装）。缺省：家根存在的全部 */
  only?: readonly AgentId[];
}

export async function install(root: string, ie: InstallEnv, opts: InstallOptions = {}): Promise<InstallReport> {
  const bundle = path.join(root, RUNTIME_SRC, 'scripts/trivium.cjs');
  if (!(await exists(bundle))) {
    throw new Error(`找不到构建产物 ${bundle}\n  请先运行 \`npm run build\`——安装器只搬运，不负责构建。`);
  }
  const plan = await planInstall(root, ie);
  const notes: string[] = [];
  const skipped: TargetReport[] = [];
  const selected: EntryTarget[] = [];
  const problems: InstallProblem[] = [];
  for (const t of plan.targets) {
    if (opts.only && !opts.only.includes(t.agent)) {
      skipped.push({ agent: t.agent, skillsRoot: t.skillsRoot, status: 'skipped', reason: '本次未选', dirs: [] });
      continue;
    }
    if (!(await exists(t.familyRoot))) {
      if (opts.only) {
        problems.push({ agent: t.agent, kind: 'missing-family', path: t.familyRoot });
      } else {
        skipped.push({
          agent: t.agent, skillsRoot: t.skillsRoot, status: 'skipped',
          reason: `未检测到 ${t.familyRoot}（本机未安装该 CLI）`, dirs: [],
        });
      }
      continue;
    }
    selected.push(t);
  }
  const rtProblem = await checkRuntimeRoot(root, plan.runtimeRoot);
  if (rtProblem) problems.push(rtProblem);
  problems.push(...(await checkInstall(selected)));
  if (problems.length > 0) throw new InstallConflictError(problems);

  // ── 运行时根：必装，不随任何一家目标走（r2 §3.2.1）──
  const runtimeExisted = await exists(plan.runtimeRoot);
  const rt = await syncDir(path.join(root, RUNTIME_SRC), plan.runtimeRoot, new Set([ENTRY_SUBDIR]));
  const removed = [...rt.removed];
  const top = plan.targets.find((t) => t.layout === 'top');
  // 运行时根换过位置、缺省位置还留着一份本产品的运行时：只提示，不删、不阻断（代码双审 r2 CODEX-05）
  const defaultRuntime = resolveAssetRoot(undefined, {}, ie.home);
  if (
    (await realOrResolved(defaultRuntime)) !== (await realOrResolved(plan.runtimeRoot)) &&
    (await isOurRuntime(defaultRuntime))
  ) {
    notes.push(
      `缺省位置 ${defaultRuntime} 还有一份本产品的运行时，本次装到了 ${plan.runtimeRoot}（TRIVIUM_ASSET_ROOT）。\n` +
        '  那一份不会再更新；各项目的 wrapper 若仍指向它，跑的就是旧版。确认不用后请手工处理。',
    );
  }
  if (!runtimeExisted && top && skipped.some((s) => s.agent === top.agent && s.reason?.startsWith('未检测到'))) {
    notes.push(
      `运行时资产落在 ${plan.runtimeRoot}：本机没有检测到 ${top.familyRoot}，这个目录是为运行时新建的。\n` +
        '  跨产品副作用：日后装上 Claude Code 时，它会把这个目录当成已安装的 skill（其 SKILL.md 标了不可调用）。',
    );
  }

  // ── 各家入口：拍平装到各自 skill 根 ──
  const reports: TargetReport[] = [];
  for (const t of selected) {
    const dirs: { dir: string; files: number }[] = [];
    for (const { name, src } of t.sources) {
      const dst = path.join(t.skillsRoot, name);
      const r = await syncDir(src, dst);
      dirs.push({ dir: dst, files: r.copied });
      removed.push(...r.removed);
    }
    reports.push({ agent: t.agent, skillsRoot: t.skillsRoot, status: 'installed', dirs });
  }

  /*
   * 只读审查 Agent 定义：**Antigravity 的家根在场才装**（M10b 第 2 步起）。
   * 此前无条件写，会在没装 agy 的机器上凭空建出 `~/.gemini`——多目标安装按「家根在不在」判断
   * 本机装了哪家，下一次安装就会把 agy 的入口 skill 也装进去（本步测试撞出来的交互）。
   */
  let agentInstalled: string | null = null;
  const agentSrc = path.join(root, RUNTIME_SRC, 'agents/trivium-critic.md');
  const agentFamily = path.join(ie.home, path.relative(ie.home, plan.agentTarget).split(path.sep)[0]!);
  if (!(await exists(agentFamily))) {
    notes.push(`未检测到 ${agentFamily}，只读审查 Agent 定义未安装（本机没有 Antigravity 时它用不上）`);
  } else if (await exists(agentSrc)) {
    await fs.mkdir(path.dirname(plan.agentTarget), { recursive: true });
    await fs.copyFile(agentSrc, plan.agentTarget);
    agentInstalled = plan.agentTarget;
  }

  // 装了入口却没有运行时 ⇒ 安装失败（r5 §5.4）。同步刚做完，这里是防「同步静默少拷」的末端核对
  if (!(await exists(path.join(plan.runtimeRoot, 'scripts/trivium.cjs')))) {
    throw new Error(`运行时根 ${plan.runtimeRoot} 里没有 scripts/trivium.cjs：入口资产装了也跑不起来，按安装失败处理。`);
  }

  return {
    runtime: { dir: plan.runtimeRoot, files: rt.copied },
    targets: [...reports, ...skipped],
    removed,
    agentInstalled,
    notes,
  };
}

export interface UninstallReport {
  removed: string[];
  notes: string[];
}

/**
 * 卸载：只删我们装过的东西——各家 skill 根里的本产品入口、运行时根、只读审查 Agent 定义。
 *
 * 运行时根**按它自己的归属**移除，不绑在 claude 目标在不在场上（r2 §3.2.1）：
 * 否则在没有 Claude Code 的机器上它永远删不掉，成了不属于任何目标的孤儿。
 * 各家 skill 根里的同名目录**只删本产品的**（`isOurEntry`），别人的同名 skill 留着并提示。
 * 各项目内的 `.trivium/` 与 `.claude/settings.json` 里的 Hook **不动**：那是项目的一部分，
 * 随仓库分发，删了会影响协作者；要清理请在项目里手工处理。
 */
export async function uninstall(root: string, ie: InstallEnv): Promise<UninstallReport> {
  const plan = await planInstall(root, ie);
  const removed: string[] = [];
  const notes: string[] = [];
  for (const t of plan.targets) {
    for (const { name } of t.sources) {
      const d = path.join(t.skillsRoot, name);
      if (!(await exists(d))) continue;
      if (!(await isOurEntry(d, name))) {
        notes.push(`${d} 不是本产品的入口 skill，未删除`);
        continue;
      }
      await fs.rm(d, { recursive: true, force: true });
      removed.push(d);
    }
  }
  // 运行时根与安装侧过同一道身份判定（代码双审 CODEX-01 / GLM-01）：判不过就只提示、不删
  if (await exists(plan.runtimeRoot)) {
    const p = await checkRuntimeRoot(root, plan.runtimeRoot);
    if (p) {
      notes.push(
        p.kind === 'runtime-overlap'
          ? `${plan.runtimeRoot} 与本仓库重叠（TRIVIUM_ASSET_ROOT 指向了工作树？），未删除`
          : `${plan.runtimeRoot} 不是本产品的运行时根（SKILL.md 身份行对不上），未删除；请检查 TRIVIUM_ASSET_ROOT`,
      );
    } else {
      await fs.rm(plan.runtimeRoot, { recursive: true, force: true });
      removed.push(plan.runtimeRoot);
    }
  }
  if (await exists(plan.agentTarget)) {
    await fs.rm(plan.agentTarget, { force: true });
    removed.push(plan.agentTarget);
  }
  notes.push(
    '各项目内的 .trivium/（config.yaml、wrapper）与 .claude/settings.json 里的 Hook 未动：',
    '  它们随仓库分发；如需清理请在项目里删除 .trivium/ 并从 settings.json 移除 gate hook-* 条目。',
    '  settings.json 里的 Hook 命令带存在性守卫，wrapper 不在时会自动 no-op，不会报错。',
  );
  return { removed, notes };
}

const USAGE = '用法：node dist/install.cjs [--targets <id,…>]   或   node dist/install.cjs --uninstall';

export type InstallArgs = { mode: 'install'; only?: AgentId[] } | { mode: 'uninstall' };

/**
 * 命令行只认两个旗标（代码双审 CODEX-03）：`--targets a,b` 与 `--uninstall`。
 *
 * 其余一律报错，不静默忽略：`--target claude` 这类拼错此前会照装四家；
 * `--uninstall --targets claude` 此前会把四家连同运行时根全删——卸载是破坏性的，
 * 用户写下的限定被吞掉比报错危险得多。不做按家卸载：运行时根各家共用，按家卸载判断不了该不该删它。
 */
export function parseInstallArgs(argv: readonly string[]): InstallArgs {
  let uninstallFlag = false;
  let targetsRaw: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--uninstall') {
      uninstallFlag = true;
    } else if (a === '--targets') {
      if (targetsRaw !== undefined) throw new Error(`--targets 写了多次。\n${USAGE}`);
      targetsRaw = argv[++i] ?? '';
    } else {
      throw new Error(`不认识的参数「${a}」。\n${USAGE}`);
    }
  }
  if (uninstallFlag) {
    if (targetsRaw !== undefined) {
      throw new Error(`--targets 只对安装有效；卸载总是移除全部各家入口与运行时根。\n${USAGE}`);
    }
    return { mode: 'uninstall' };
  }
  if (targetsRaw === undefined) return { mode: 'install' };
  const ids = targetsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  const bad = ids.filter((id) => !isAgentId(id));
  if (ids.length === 0 || bad.length > 0) {
    throw new Error(`--targets 取值不合法：「${targetsRaw}」。应为逗号分隔的 Agent id`);
  }
  return { mode: 'install', only: ids as AgentId[] };
}

async function main(): Promise<number> {
  const root = repoRoot();
  const ie = defaultInstallEnv();

  let args: InstallArgs;
  try {
    args = parseInstallArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    return 1;
  }

  if (args.mode === 'uninstall') {
    console.log('TriviumCode 卸载');
    console.log('─'.repeat(60));
    const r = await uninstall(root, ie);
    for (const p of r.removed) console.log(`  - ${p}`);
    if (r.removed.length === 0) console.log('  （没有找到已安装的内容）');
    console.log('');
    for (const n of r.notes) console.log(n);
    return 0;
  }

  console.log('TriviumCode 安装');
  console.log('─'.repeat(60));
  let r: InstallReport;
  try {
    r = await install(root, ie, args.only ? { only: args.only } : {});
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    return 1;
  }
  let total = r.runtime.files;
  console.log(`  + 运行时根 ${r.runtime.dir}（${r.runtime.files} 个文件）`);
  for (const t of r.targets) {
    if (t.status === 'skipped') {
      console.log(`  = ${t.agent}：跳过（${t.reason}）`);
      continue;
    }
    const files = t.dirs.reduce((n, d) => n + d.files, 0);
    total += files;
    console.log(`  + ${t.agent}：${t.skillsRoot}（${t.dirs.length} 个入口，${files} 个文件）`);
  }
  for (const p of r.removed) console.log(`  - ${p}（源里已不存在，已裁剪）`);
  if (r.agentInstalled) console.log(`  + ${r.agentInstalled}`);
  else if (!r.notes.some((n) => n.includes('只读审查 Agent 定义未安装'))) {
    console.error('  ⚠️ 找不到 skills/dual-critic/agents/trivium-critic.md——Antigravity 侧的只读保障会失效');
  }
  for (const n of r.notes) console.log(`  ⚠️ ${n}`);

  console.log(`\n共 ${total} 个文件。`);
  // `trivium` 不进 PATH 是有意的（AD-13），所以这里一律打印可直接复制执行的完整命令。
  // cliPath 与运行时根同源（r5 §5.4）：`TRIVIUM_ASSET_ROOT` 设了，这里打印的就是那边的产物。
  const cliPath = path.join(r.runtime.dir, 'scripts/trivium.cjs');
  console.log('下一步（`trivium` 不在 PATH 上，用下面的完整命令）：');
  console.log('  1. 实测本机能力（会消耗少量厂商配额）：');
  console.log(`       node ${cliPath} doctor`);
  console.log('  2. 在要启用双审的项目根启用：');
  console.log(`       node ${cliPath} init`);
  console.log('  3. init 之后该项目内改用 wrapper（内含 node 绝对路径——GUI 进程不读 ~/.zshrc）：');
  console.log('       ./.trivium/bin/trivium doctor');
  console.log('  4. 用 `/dual-review-plan <审查焦点>` 试跑一条（各家的调用写法见 QUICKSTART）。');
  console.log('  升级：重新 `npm run build && node dist/install.cjs`（会裁剪旧版残留），各项目内重跑 init 刷新 wrapper。');
  console.log('  只装部分家：`node dist/install.cjs --targets claude,glm`（运行时根照装）。');
  console.log('  卸载：`node dist/install.cjs --uninstall`。');
  return 0;
}

// 只在作为脚本直接执行时跑 main：ESM 测试构建会 import 本文件取 install / uninstall
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  main()
    .then((c) => {
      process.exitCode = c;
    })
    .catch((e: unknown) => {
      console.error(`安装失败：${(e as Error).message}`);
      process.exitCode = 1;
    });
}
