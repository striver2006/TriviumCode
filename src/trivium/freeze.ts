/**
 * `freeze`：快照、禁读清单与漂移判定（设计 §9.2 / ADR-001）。
 *
 * 就地模式下**不复制任何文件**（AD-05）：快照 = 内容哈希 + 清单。
 * 两条铁律：
 *   1. 计算 `tree_hash` 一律走独立 `GIT_INDEX_FILE`，**绝不** `git add -A` 碰真实索引
 *      （与用户 Git 习惯冲突且有误提交风险）。
 *   2. 漂移判定必须先剔除 `probe.*.scratch_paths` 白名单，否则会把两家 Agent 自己的
 *      会话缓存误判成「只读失守」。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Config, CriticId, Stage } from './types.js';
import { diffTrees, headSha, statusPorcelain, workTreeHash, diffAgainst } from './util/git.js';
import { matchesAnyGlob, sha256, sha256File } from './util/fsx.js';
import { diffExcludePrefixes } from './code-stage.js';

export interface Snapshot {
  gitHead: string | null;
  treeHash: string;
  dirty: boolean;
  /** 被审对象的 sha256：plan/bug 是原稿文档，code 是 changes.diff */
  subjectSha256: string;
  subjectPath: string;
  /** 对方历史产出等禁读文件的**项目相对**路径，逐个列出（§9.4 第 8 段） */
  denyPaths: string[];
  /** code 阶段的补丁内容，其它阶段为 null */
  diffText: string | null;
  takenAt: string;
}

/**
 * 枚举禁读清单。
 *
 * 由两部分组成：
 *   - 对方**历史**产出：按 `isolation.peer_artifact_globs` 在归档根内扫描，
 *     但只收**对方**角色的文件（己方历史产出是要给审查员看的，§9.4 第 4 段最后一条）；
 *   - 敏感文件：`review.sensitive_globs`。
 *
 * 逐个列出真实路径而非给 glob，是为了让轨迹核验与提示语之间可以逐条对账。
 */
export async function enumerateDenyPaths(
  cfg: Config,
  projectRoot: string,
  archiveRoot: string,
  critic: CriticId,
): Promise<string[]> {
  const peerRole: CriticId = critic === 'gemini' ? 'glm' : 'gemini';
  const out = new Set<string>();

  // 1) 对方历史审查产出
  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(abs);
        continue;
      }
      const rel = path.relative(projectRoot, abs);
      if (!e.name.endsWith(`-${peerRole}.md`)) continue;
      if (matchesAnyGlob(rel, cfg.isolation.peer_artifact_globs)) out.add(rel);
    }
  };
  await walk(archiveRoot);

  // 2) 敏感文件（就地模式无法「不带入」，只能列进禁读清单，§9.2 末条）
  const walkSensitive = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === '.git' || e.name === 'node_modules') continue;
      const abs = path.join(dir, e.name);
      const rel = path.relative(projectRoot, abs);
      if (e.isDirectory()) {
        await walkSensitive(abs, depth + 1);
        continue;
      }
      if (matchesAnyGlob(rel, cfg.review.sensitive_globs)) out.add(rel);
    }
  };
  await walkSensitive(projectRoot, 0);

  return [...out].sort();
}

export interface FreezeInput {
  cfg: Config;
  projectRoot: string;
  archiveRoot: string;
  stage: Stage;
  critic: CriticId;
  /** plan/bug：原稿绝对路径。code：忽略，改用 base 生成 diff */
  subjectPath?: string;
  /** code 阶段的 diff 基线 */
  base?: string;
  /**
   * code 阶段：已算好的补丁正文。
   *
   * 必须由调用方算一次后传进来。freeze 是**逐侧**调用的，若每侧各自
   * `git diff` 一次，两次之间工作树一有变动，同一次运行的两侧就会拿到不同的
   * `subject_sha256`——那等于两侧审的根本不是同一段变更。
   */
  diffText?: string;
}

/** 冻结送审快照。**不复制文件** */
export async function freeze(input: FreezeInput): Promise<Snapshot> {
  const { cfg, projectRoot, archiveRoot, stage, critic } = input;

  const gitHead = await headSha(projectRoot);
  const treeHash = await workTreeHash(projectRoot);
  const status = await statusPorcelain(projectRoot);
  const dirty = status.length > 0;

  let subjectSha256: string;
  let subjectPath: string;
  let diffText: string | null = null;

  if (stage === 'code') {
    const base = input.base ?? 'HEAD';
    diffText =
      input.diffText ??
      (await diffAgainst(projectRoot, base, diffExcludePrefixes(path.relative(projectRoot, archiveRoot))));
    subjectSha256 = sha256(diffText);
    // 真实路径在 _meta/ 下，由调用方落盘后回填；这里先给逻辑路径
    subjectPath = path.join(archiveRoot, '_pending', 'changes.diff');
  } else {
    if (!input.subjectPath) throw new Error(`${stage} 阶段必须提供 subjectPath`);
    subjectPath = input.subjectPath;
    subjectSha256 = await sha256File(subjectPath);
  }

  const denyPaths = await enumerateDenyPaths(cfg, projectRoot, archiveRoot, critic);

  return {
    gitHead,
    treeHash,
    dirty,
    subjectSha256,
    subjectPath,
    denyPaths,
    diffText,
    takenAt: new Date().toISOString(),
  };
}

export type DriftVerdict =
  | { kind: 'none' }
  | { kind: 'subject_drift' }
  | { kind: 'related'; files: string[] }
  | { kind: 'unrelated'; files: string[] };

export interface DriftInput {
  cfg: Config;
  projectRoot: string;
  before: Snapshot;
  /** 跑后重算的 tree hash */
  afterTreeHash: string;
  /** 跑后重算的被审对象 sha256（code 阶段传重算的 diff 哈希） */
  afterSubjectSha256: string;
  /** `--context` 指明的路径与 diff 涉及文件，用于判定「相关」 */
  relatedPaths: string[];
  /** 两侧 Agent 的 scratch 白名单并集 */
  scratchGlobs: string[];
  /**
   * 归档根的**项目相对**路径（如 `.reviews`）。判定漂移时整体排除。
   *
   * 为什么必须排除：编排器自己在运行中就会往归档里写送审包、`run.json`、`task.json`，
   * 而基线 `tree_hash` 是在写这些**之前**取的。不排除就会把自己的写入判成漂移——
   * 实跑时这条真的误报了 4 个文件。
   * 被审对象本身的漂移由 `subject_sha256` 单独把关（第 2 步），不会因此漏掉。
   */
  archiveRootRel: string;
}

/**
 * 漂移判定（设计 §9.2 跑后复算，四步）。
 *
 * 顺序有讲究：被审对象漂移优先级最高（整次运行作废），
 * 因为此时结论对应的已经不是送审的那份东西了。
 */
export async function judgeDrift(input: DriftInput): Promise<DriftVerdict> {
  const { cfg, projectRoot, before, afterTreeHash, afterSubjectSha256, relatedPaths, scratchGlobs } = input;
  const archivePrefix = input.archiveRootRel.replace(/^\.\//, '').replace(/\/+$/, '');

  // 第 2 步：被审对象被改 → 整次作废
  if (afterSubjectSha256 !== before.subjectSha256) return { kind: 'subject_drift' };

  // 第 3 步：工作树无变化 → 无漂移
  if (afterTreeHash === before.treeHash) return { kind: 'none' };

  // 3.a 列出变更文件，剔除 scratch 白名单与归档根
  const changed = (await diffTrees(projectRoot, before.treeHash, afterTreeHash)).filter(
    (f) =>
      !matchesAnyGlob(f, scratchGlobs) &&
      !(archivePrefix.length > 0 && (f === archivePrefix || f.startsWith(`${archivePrefix}/`))),
  );
  // 3.b 全是 Agent 临时文件 → 无漂移
  if (changed.length === 0) return { kind: 'none' };

  // 3.c 与 --context / diff 涉及文件相交 → 相关漂移
  const relatedSet = new Set(relatedPaths.map((p) => path.normalize(p)));
  const related = changed.filter((f) => {
    const n = path.normalize(f);
    for (const r of relatedSet) {
      if (n === r || n.startsWith(r.endsWith('/') ? r : `${r}/`)) return true;
    }
    return false;
  });
  if (related.length > 0) return { kind: 'related', files: related };

  // 3.d 其它 → 无关漂移
  void cfg;
  return { kind: 'unrelated', files: changed };
}

/** 漂移结论 → 处置动作（按配置的 on_drift / on_drift_related） */
export function driftAction(cfg: Config, v: DriftVerdict): 'ok' | 'warn' | 'fail' {
  switch (v.kind) {
    case 'none':
      return 'ok';
    case 'subject_drift':
      return 'fail';
    case 'related':
      return cfg.review.on_drift_related === 'fail' ? 'fail' : 'warn';
    case 'unrelated':
      return cfg.review.on_drift === 'fail' ? 'fail' : 'warn';
  }
}
