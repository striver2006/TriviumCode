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
import { displayHomePath, exists } from './util/fsx.js';

/** 三类读取面问题。安装器另有三类（缺家、运行时根重叠 / 外来），只在安装器里产生 */
export type EntryCollisionKind = 'residue' | 'third-party' | 'foreign-entry';

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

/** 三类问题的短标签：`npm run install:check`、doctor、preflight 共用（取自 install-check 原有的那份，逐字不变） */
export const ENTRY_PROBLEM_LABELS: Readonly<Record<EntryCollisionKind, string>> = {
  'foreign-entry': '本产品的入口出现在不该装的位置（如被别的工具拷进共享根）',
  'third-party': '别家的同名 skill',
  residue: '旧版安装的残留',
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

/** 读取面检查：只读，不写任何东西。返回全部问题，调用方决定怎么处置 */
export async function scanEntryCollisions(targets: readonly EntryScanTarget[]): Promise<EntryCollisionProblem[]> {
  const problems: EntryCollisionProblem[] = [];
  for (const t of targets) {
    for (const n of t.residueNames) {
      const p = path.join(t.skillsRoot, n);
      if (await exists(p)) problems.push({ agent: t.agent, kind: 'residue', path: p });
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
 * 共享读取面的扫描目标：登记了额外读取根的每一家，只查额外读取根，不查残留（计划 r2 T-3）。
 *
 * 安装根不在这里查：那里的自家同名是正常的升级对象，安装根的问题归安装器与 `install:check`。
 * 额外读取根与安装器同一个求值函数（`entrySkillRootOf`），`CODEX_HOME` 只影响安装根。
 */
export function sharedReadRootTargets(agents: readonly AgentDescriptor[], se: EntryScanEnv): EntryScanTarget[] {
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

/** doctor 用：全部问题，按路径归并、逐行列出，末尾给出口。无问题返回 null */
export function describeSharedRootProblems(problems: readonly EntryCollisionProblem[], home: string): string | null {
  if (problems.length === 0) return null;
  const groups = groupByPath(problems);
  const lines = [
    `共享读取面里有 ${groups.length} 个同名入口（这些根会被多家 CLI 读到：同名时 Codex 的显式调用会失效、ZCode 两份都进模型清单，` +
      '而且它带的 --driver 可能是别家）：',
  ];
  for (const g of groups) {
    lines.push(`  · ${displayHomePath(g.path, home)}  ${ENTRY_PROBLEM_LABELS[g.kind]}（${g.agents.map(displayOf).join('、')} 会读到）`);
  }
  lines.push(`  ${SHARED_ROOT_EXIT_HINT}`);
  return lines.join('\n');
}

/** preflight 用：一行。无问题返回 null */
export function summarizeSharedRootProblems(problems: readonly EntryCollisionProblem[], home: string): string | null {
  if (problems.length === 0) return null;
  const groups = groupByPath(problems);
  const roots = [...new Set(groups.map((g) => displayHomePath(path.dirname(g.path), home)))];
  const agents = [...new Set(groups.flatMap((g) => g.agents))];
  return (
    `⚠️ 共享读取面 ${roots.join('、')} 有 ${groups.length} 个同名入口，本轮的 ${agents.map(displayOf).join('、')} 会读到；` +
    '跑 doctor 看完整清单与出口（不影响本次预检）'
  );
}
