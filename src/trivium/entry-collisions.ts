/**
 * 读取面同名入口检测（EV-240 方案 A，M12 批次 5）。
 *
 * 判定原先只在安装器里（`src/install.ts` 的 `checkInstall` 与 `isOurEntry`）。本批原样搬到这里，
 * **安装器与编排器两个打包产物引用同一份实现**：
 *
 *   src/install.ts      → dist/install.cjs                          安装前检查、卸载的删除面、`npm run install:check`
 *   src/trivium/cli.ts  → skills/dual-critic/scripts/trivium.cjs    doctor 全量列出、preflight 对本轮相关家告警
 *
 * 安装器的判定输入（入口名单取仓库里的渲染产物）、报错文案与退出码都不变；这里只放判定本身。
 * 编排器装在运行时根，读不到仓库里的渲染产物与 `skills-src/`，入口名单取 {@link ENTRY_SKILL_NAMES}，
 * 由对账用例守它与命令契约、安装器名单三者一致。
 *
 * **本模块不得 import `src/install.ts` 或 `src/entry-render.ts`**：编排器产物不该反向依赖安装器（计划双审 AGY-04）。
 *
 * 只读：任何一个函数都不写、不删。处置一律交给人（安装器「只报错、不删除」的同一条纪律，2026-09-20 事故 R1 / R8）。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { agentById, entrySkillRootOf, type AgentDescriptor, type AgentId } from './agents/registry.js';
import { resolveAssetRoot } from './asset-root.js';
import { displayHomePath, exists } from './util/fsx.js';

/**
 * 四类读取面问题。安装器另有三类（缺家、运行时根重叠 / 外来），只在安装器里产生。
 *
 * `residue` 与 `shared-residue` 是两回事：前者在**安装根**顶层见名即判（r10 §2.1，逐字沿用）；
 * 后者只在**额外读取根**里判、且要按内容认定是本产品的历史形态（{@link isResidueCopy}），
 * 那里的拷贝不是旧版安装留下的，是别的工具整棵带进来的（EV-240 残余，主题 `M12-共享根残留检测`）。
 */
export type EntryCollisionKind = 'residue' | 'shared-residue' | 'third-party' | 'foreign-entry';

export interface EntryCollisionProblem {
  agent: AgentId;
  kind: EntryCollisionKind;
  path: string;
}

/** 一家的扫描目标 */
export interface EntryScanTarget {
  agent: AgentId;
  /** 安装根：其中的自家同名视为上一次安装、放行 */
  skillsRoot: string;
  /** 要查同名的读取根（安装器传完整读取面，doctor / preflight 只传额外读取根） */
  readRoots: readonly string[];
  /** 要查的入口名 */
  names: readonly string[];
  /** 在安装根顶层出现即判「历史形态残留」的名字；空数组表示这一家不查残留 */
  residueNames: readonly string[];
  /**
   * 在额外读取根（`readRoots` 里不等于 `skillsRoot` 的）里按内容判 `shared-residue` 的候选名。
   * 可选：缺省等于空数组、不查（计划双审 CODEX-01——既有调用点与用例不必补字段）。
   */
  sharedResidueNames?: readonly string[];
  /** 真实路径与其中任一相同的候选不判 `shared-residue`：当前运行时根恰好放在共享根里时（计划 r2 D-6） */
  exemptPaths?: readonly string[];
}

/**
 * 本产品的入口 skill 名单（编排器侧用）。
 *
 * 安装器**不用**它：安装器的名单取仓库里的渲染产物，判定输入逐字不变（计划 r2 T-2）。
 * 加删命令时要同步这里——`entry-collisions-bundles` 的对账用例会把它与 `skills-src/commands/` 的契约名、
 * `planInstall` 给每家算出的名单逐一比对，不一致即红。
 */
export const ENTRY_SKILL_NAMES: readonly string[] = [
  'dual-abandon',
  'dual-approve',
  'dual-review-bug',
  'dual-review-code',
  'dual-review-plan',
  'dual-run',
  'dual-status',
];

/**
 * 运行时根的目录名，也是它 `SKILL.md` 身份行里的名字（编排器侧用）。
 * 安装器从 `ENTRY_OUT_DIR` 派生同一个值；对账用例守两者一致（计划 r2 D-7）。
 */
export const RUNTIME_ROOT_NAME = 'dual-critic';

/**
 * 本产品历史形态目录的名字（编排器侧用）：运行时根与入口子树。
 * 安装器**不用**它，仍用自己派生的 `RESIDUE_NAMES`（判定输入逐字不变）；对账用例守两者一致。
 */
export const RESIDUE_DIR_NAMES: readonly string[] = [RUNTIME_ROOT_NAME, 'entry'];

/** 四类问题的短标签：`npm run install:check`、doctor、preflight 共用（原三项取自 install-check 原有的那份，逐字不变） */
export const ENTRY_PROBLEM_LABELS: Readonly<Record<EntryCollisionKind, string>> = {
  'foreign-entry': '本产品的入口出现在不该装的位置（如被别的工具拷进共享根）',
  'third-party': '别家的同名 skill',
  residue: '旧版安装的残留',
  'shared-residue': '本产品运行时或入口子树的整棵拷贝，多半是别的工具导入时带进来的',
};

/**
 * 一个同名目录是不是**本产品**的入口 skill：`SKILL.md` 的 front-matter 名字对得上、
 * 正文调用 `.trivium/bin/trivium`。
 *
 * 它决定三件事：两种撞名的报错措辞、安装根内的升级放行（判真即覆盖），以及**卸载的删除面**
 * （判真即整目录删除，代码双审 GLM-04）。判据的边界：用户从本产品 fork 出来、保留原名、
 * 仍调用 wrapper 的 skill 也会判真——安装会覆盖它、卸载会删掉它。不在卸载侧另设更严的判据：
 * 那样会出现「装得上、卸不掉」的不对称，而改比 description 又会在跨版本改过措辞时误判。
 */
export async function isOurEntry(dir: string, name: string): Promise<boolean> {
  let md: string;
  try {
    md = await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8');
  } catch {
    return false;
  }
  return md.startsWith(`---\nname: ${name}\n`) && md.includes('.trivium/bin/trivium');
}

/**
 * 目录里的 `SKILL.md` 带本产品运行时的身份行：front-matter 首个键是运行时的名字（读不到即否）。
 *
 * 安装器的 `runtime-foreign` 判定、缺省位置旧运行时提示与卸载都经它判（原 `install.ts` 的 `isOurRuntime`，
 * 判据逐字搬来）；共享根残留的运行时拷贝判据也用它，让「运行时身份行」只有一份实现。
 */
export async function hasRuntimeIdentity(dir: string, runtimeName: string): Promise<boolean> {
  try {
    return (await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8')).startsWith(`---\nname: ${runtimeName}\n`);
  } catch {
    return false;
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await fs.stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * 一个残留名单里的目录是不是**本产品的历史形态**（只用于额外读取根，计划 r2 D-2）。任一即真：
 *
 * ① 运行时根拷贝：带运行时身份行，且 `schema/` 是目录。只看身份行不够——别家 skill 也可能首键写同一个名字；
 *    `schema/` 是历来每个版本的运行时根都有、装好的运行时根也带的结构（`scripts/trivium.cjs` 是构建产物，
 *    从仓库拷出的副本没有，不作标记）。
 * ② 含入口子树：在 E ∈ {dir, dir/entry} 里，某个子目录 c 下有本产品的入口 `E/c/〈入口名〉/`（`isOurEntry`）。
 *    `entry/〈载体〉/〈入口〉/` 布局，`dir` 本身是 `entry` 拷贝、或是带 `entry/` 的运行时拷贝都能认出。
 *
 * 只读；列目录失败（不存在、不是目录、无权限）一律当「否」，不抛。
 */
export async function isResidueCopy(dir: string, entryNames: readonly string[] = ENTRY_SKILL_NAMES): Promise<boolean> {
  if ((await hasRuntimeIdentity(dir, RUNTIME_ROOT_NAME)) && (await isDir(path.join(dir, 'schema')))) return true;
  for (const e of [dir, path.join(dir, 'entry')]) {
    let subs: string[];
    try {
      subs = (await fs.readdir(e, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      continue;
    }
    for (const c of subs) {
      for (const n of entryNames) {
        if (await isOurEntry(path.join(e, c, n), n)) return true;
      }
    }
  }
  return false;
}

/** 真实路径；取不到（多半是不存在）退回字面的绝对路径。候选一定存在，豁免路径不存在时不可能与它同一处 */
async function realpathOr(p: string): Promise<string> {
  try {
    return await fs.realpath(p);
  } catch {
    return path.resolve(p);
  }
}

/** 读取面检查：只读，不写任何东西。返回全部问题，调用方决定怎么处置 */
export async function scanEntryCollisions(targets: readonly EntryScanTarget[]): Promise<EntryCollisionProblem[]> {
  const problems: EntryCollisionProblem[] = [];
  for (const t of targets) {
    for (const n of t.residueNames) {
      const p = path.join(t.skillsRoot, n);
      if (await exists(p)) problems.push({ agent: t.agent, kind: 'residue', path: p });
    }
    // 共享根残留：只看额外读取根、按内容认定；安装根顶层仍只走上面那条见名即判（计划 r2 D-5）
    const sharedNames = t.sharedResidueNames ?? [];
    if (sharedNames.length > 0) {
      const exempt = new Set(await Promise.all((t.exemptPaths ?? []).map(realpathOr)));
      for (const r of t.readRoots) {
        if (r === t.skillsRoot) continue;
        for (const n of sharedNames) {
          const p = path.join(r, n);
          if (!(await exists(p))) continue;
          if (exempt.has(await realpathOr(p))) continue;
          if (await isResidueCopy(p, t.names)) problems.push({ agent: t.agent, kind: 'shared-residue', path: p });
        }
      }
    }
    for (const name of t.names) {
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

// ─────────────────────── 编排器侧：共享读取面 ───────────────────────

/** 扫描用的用户环境。测试注入临时家目录；生产缺省见 {@link entryScanEnv} */
export interface EntryScanEnv {
  home: string;
  env: Readonly<Record<string, string | undefined>>;
}

/**
 * 只为隔离测试与诊断：指定共享读取面扫描读哪个家目录（计划双审 CODEX-01）。
 * 只改这一处只读扫描，安装器不读它。
 */
export const ENTRY_SCAN_HOME_ENV = 'TRIVIUM_ENTRY_SCAN_HOME';

/**
 * doctor 与 preflight 扫描所用家目录的**唯一来源**：注入口 → `TRIVIUM_ENTRY_SCAN_HOME` → `os.homedir()`。
 * 两处都经它取，不各自读 `os.homedir()`——否则测试隔离要逐个调用点去补，补漏一处就读到真实家目录。
 */
export function entryScanEnv(inject?: EntryScanEnv): EntryScanEnv {
  if (inject) return inject;
  const fromEnv = process.env[ENTRY_SCAN_HOME_ENV];
  return { home: fromEnv && fromEnv.length > 0 ? fromEnv : os.homedir(), env: process.env };
}

/**
 * 当前进程自身产物所在的运行时根：`argv1` 形如 `〈根〉/scripts/trivium.cjs` 时返回 `〈根〉`，否则 `null`
 * （计划双审 GLM-02）。安装时设了 `TRIVIUM_ASSET_ROOT` 指到共享根、扫描时的 shell 没设，doctor / preflight
 * 仍跑在那份运行时里——只按环境求值会把它报成残留。测试进程的 `argv[1]` 是测试文件，恒为 `null`。
 */
export function selfRuntimeRoot(argv1: string | undefined = process.argv[1]): string | null {
  if (!argv1 || path.basename(argv1) !== 'trivium.cjs') return null;
  const scripts = path.dirname(argv1);
  return path.basename(scripts) === 'scripts' ? path.dirname(scripts) : null;
}

/**
 * 共享读取面的扫描目标：登记了额外读取根的每一家，只查额外读取根（计划 r2 T-3）。
 *
 * 安装根不在这里查：那里的自家同名是正常的升级对象，安装根的问题归安装器与 `install:check`。
 * 额外读取根与安装器同一个求值函数（`entrySkillRootOf`），`CODEX_HOME` 只影响安装根。
 * 安装根残留（`residueNames`）不查；共享根残留按内容查，豁免当前运行时根——按扫描环境求值的那份、
 * 加上当前进程自身所在的那份（`self`，缺省 {@link selfRuntimeRoot}）。
 */
export function sharedReadRootTargets(
  agents: readonly AgentDescriptor[],
  se: EntryScanEnv,
  self: string | null = selfRuntimeRoot(),
): EntryScanTarget[] {
  const exemptPaths = [resolveAssetRoot(undefined, se.env, se.home), ...(self === null ? [] : [self])];
  const out: EntryScanTarget[] = [];
  for (const a of agents) {
    if (a.entrySkillExtraReadRoots.length === 0) continue;
    const roots = entrySkillRootOf(a, se.home, se.env);
    out.push({
      agent: a.id,
      skillsRoot: roots.skillsRoot,
      readRoots: roots.readRoots.filter((r) => r !== roots.skillsRoot),
      names: ENTRY_SKILL_NAMES,
      residueNames: [],
      sharedResidueNames: RESIDUE_DIR_NAMES,
      exemptPaths,
    });
  }
  return out;
}

/** 按路径归并：同一个共享根被几家读到，同一个同名目录就有几条问题 */
function groupByPath(problems: readonly EntryCollisionProblem[]): { path: string; kind: EntryCollisionKind; agents: AgentId[] }[] {
  const byPath = new Map<string, { path: string; kind: EntryCollisionKind; agents: AgentId[] }>();
  for (const p of problems) {
    const g = byPath.get(p.path);
    if (g) {
      if (!g.agents.includes(p.agent)) g.agents.push(p.agent);
    } else {
      byPath.set(p.path, { path: p.path, kind: p.kind, agents: [p.agent] });
    }
  }
  return [...byPath.values()];
}

const displayOf = (id: AgentId): string => agentById(id)?.display ?? id;

/** doctor 的出口句：先只读核对，确认后由人挪走 */
export const SHARED_ROOT_EXIT_HINT =
  '出口：在 TriviumCode 仓库根跑 `npm run install:check` 只读核对，确认无用后手工挪走；安装器与 doctor 都不删这些路径。';

/**
 * 按路径归并后再分两组：同名入口与共享根残留。同名入口组的渲染与 M12 批次 5 逐字相同，
 * 共享根没有残留时两处输出逐字节不变（计划 r2 D-4、§3.3）
 */
function splitGroups(problems: readonly EntryCollisionProblem[]) {
  const groups = groupByPath(problems);
  return {
    groups,
    entries: groups.filter((g) => g.kind !== 'shared-residue'),
    residues: groups.filter((g) => g.kind === 'shared-residue'),
  };
}

const groupLine = (g: { path: string; kind: EntryCollisionKind; agents: AgentId[] }, home: string): string =>
  `  · ${displayHomePath(g.path, home)}  ${ENTRY_PROBLEM_LABELS[g.kind]}（${g.agents.map(displayOf).join('、')} 会读到）`;

/** doctor 用：全部问题，按路径归并、逐行列出，末尾给出口。无问题返回 null */
export function describeSharedRootProblems(problems: readonly EntryCollisionProblem[], home: string): string | null {
  if (problems.length === 0) return null;
  const { entries, residues } = splitGroups(problems);
  const lines: string[] = [];
  if (entries.length > 0) {
    lines.push(
      `共享读取面里有 ${entries.length} 个同名入口（这些根会被多家 CLI 读到：同名时 Codex 的显式调用会失效、ZCode 两份都进模型清单，` +
        '而且它带的 --driver 可能是别家）：',
    );
    for (const g of entries) lines.push(groupLine(g, home));
  }
  if (residues.length > 0) {
    lines.push(
      `共享读取面里有 ${residues.length} 份本产品的历史拷贝（运行时根或入口子树，不随安装更新；带入口子树时会把别家的入口调出来）：`,
    );
    for (const g of residues) lines.push(groupLine(g, home));
  }
  lines.push(`  ${SHARED_ROOT_EXIT_HINT}`);
  return lines.join('\n');
}

/**
 * preflight 与 `review --start` 用：一行。无问题返回 null。
 * `occasion` 只换结尾括号里的场合词（`--start` 传「本次运行」，EV-246）；缺省即预检的原文，逐字不变
 */
export function summarizeSharedRootProblems(
  problems: readonly EntryCollisionProblem[],
  home: string,
  occasion = '本次预检',
): string | null {
  if (problems.length === 0) return null;
  const { groups, entries, residues } = splitGroups(problems);
  const roots = [...new Set(groups.map((g) => displayHomePath(path.dirname(g.path), home)))];
  const agents = [...new Set(groups.flatMap((g) => g.agents))];
  const counts = [
    ...(entries.length > 0 ? [`${entries.length} 个同名入口`] : []),
    ...(residues.length > 0 ? [`${residues.length} 份本产品的历史拷贝`] : []),
  ];
  return (
    `⚠️ 共享读取面 ${roots.join('、')} 有 ${counts.join('、')}，本轮的 ${agents.map(displayOf).join('、')} 会读到；` +
    `跑 doctor 看完整清单与出口（不影响${occasion}）`
  );
}
