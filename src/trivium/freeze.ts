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
import { ALL_AGENT_IDS, DEFAULT_DRIVER, isAgentId, type AgentId } from './agents/registry.js';
import type { Config, CriticId, Stage } from './types.js';
import { parseArtifactName, type DispositionKind, type Role } from './naming.js';
import { parseFrontMatter } from './render.js';
import { diffTrees, headSha, statusPorcelain, workTreeHash, diffAgainst } from './util/git.js';
import { expandHome, matchesAnyGlob, sha256, sha256File } from './util/fsx.js';
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
 * 判定一份角色工件是不是「他人的审查意见」——即对 `critic` 必须屏蔽的内容。
 *
 * ## 为什么不能按后缀差集判（计划 §3.1 / D-3）
 *
 * 后缀标识**产出方**，不携带**产出角色**。Driver 任意化之后，同一后缀在
 * 不同运行里可能是 Driver 也可能是审核者：设某主题第 1 轮 ZCode 当 Driver、
 * Claude 当审核者，产出 `…-claude.md`（一份完整的审查意见）；第 2 轮换回
 * Claude 当 Driver，按「deny = 全部后缀 − {自身, driver}」计算，`-claude.md`
 * 因等于 driver 后缀而**整体不禁**——上一轮的审查意见就这样合法地摊在
 * 另外两个审核者面前，且不会被任何检测命中（命令文本扫描的字面集同源派生，
 * 一并放行）。
 *
 * ## 判据优先级（front-matter 为主）
 *
 * 审查件与裁决件的 front-matter 自带 `schema` 与 `role`，是**文件自身携带
 * 的角色证据**，不依赖任何外部登记——这一点关键：`run.json.artifacts` 只
 * 收录编排器本轮写出的审查件与 `_meta` 材料，原稿（审查前由人写）与裁决件
 * （审查后由 Driver 写）根本不在其中，「按登记清单反推」对最需要判定的两类
 * 文件没有事实来源。
 */
async function classifyArtifact(
  absPath: string,
  role: Role,
  kind: DispositionKind | null,
  driver: AgentId,
): Promise<'peer-review' | 'own-or-driver' | 'indeterminate'> {
  /*
   * 裁决件由 Driver 产出，是审查员的合法上下文（§9.4 第 4 段）——但**必须同时
   * 核对后缀**（审查意见 GLM-04）。只看 `kind` 会放行 `…-revised-gemini.md`
   * 这类「审核者后缀 + 裁决件中缀」的名字：它以 `-gemini.md` 结尾，重构前会被
   * 禁，只看 kind 则在读文件之前就直接放行，deny 集合反而比重构前收窄。
   *
   * 编排器自己不会产出这种名字（`buildArtifactName` 会拦），但 deny 矩阵的定位
   * 正是兜住「留痕被误放或被动过」的文件——文件名零成本可伪造，把他人意见原文
   * 改个中缀就绕过整套 front-matter 判定。裁决件本就只能是 Driver 后缀，
   * 后缀对不上的判不确定即禁，不构成误伤。
   */
  if (kind !== null) return role === driver ? 'own-or-driver' : 'indeterminate';

  let fm: Record<string, unknown> | null = null;
  try {
    fm = parseFrontMatter(await fs.readFile(absPath, 'utf8'));
  } catch {
    fm = null;
  }

  const schema = typeof fm?.['schema'] === 'string' ? (fm['schema'] as string) : null;
  if (schema === 'trivium.review.v1') return 'peer-review';
  if (schema === 'trivium.disposition.v1') return 'own-or-driver';

  /*
   * 没有可辨识的 schema：原稿就是这种形态（Driver 手写的 Markdown）。
   * 后缀等于当轮 Driver 时按原稿处理；否则是一份「顶着审核者后缀却不是
   * 审查件」的可疑文件，判不出就禁——fail-closed 只用在这里，不外扩。
   */
  return role === driver ? 'own-or-driver' : 'indeterminate';
}

/**
 * 枚举禁读清单。
 *
 * 由四部分组成：
 *   - **他人的审查意见**：`.md` 审查件按 `classifyArtifact` 逐份判定（见上），
 *     己方历史产出不禁（是要给审查员看的，§9.4 第 4 段最后一条）；
 *   - 同一批意见的**结构化原文** `_meta/review-<他人>-<runId>.json` 与其
 *     fallback 编号件——重构前只禁 `.md` 而漏掉这些，提示语禁了一堆、机器
 *     核验只对其中一部分，是现存的隔离缺口（计划 §2.2 措施 a）；
 *   - 编排器自身的状态目录 `.trivium/`；
 *   - 敏感文件：`review.sensitive_globs`。
 *
 * 逐个列出真实路径而非给 glob，是为了让轨迹核验与提示语之间可以逐条对账——
 * BRIEF 第 8 段的禁读清单与 `checkPeerLeak` 的机器集合由**同一份**返回值生成。
 */
export async function enumerateDenyPaths(
  cfg: Config,
  projectRoot: string,
  archiveRoot: string,
  critic: CriticId,
  driver: AgentId = DEFAULT_DRIVER,
  /**
   * 当轮主题。给了就只扫 `<archiveRoot>/<topic>`（审查意见 AGY-02 / GLM-02）。
   *
   * 不剪枝有两重代价，其中误伤那重是实打实的：非 Claude Driver 下，全仓**其它
   * 主题**的 `-claude.md` 原稿因无 review schema 且 `role !== driver` 被判
   * indeterminate，整批进禁读集——审核者正常读取即 `peer_leak` 作废重跑。
   * 另一重是 I/O：`classifyArtifact` 要读文件，全归档 × 每侧 × 每次运行。
   *
   * 跨主题的他人审查意见不再入集是有意的：那是另一个任务的意见，锚定污染的
   * 风险远低于上面那种误伤。
   */
  topic: string | null = null,
): Promise<string[]> {
  const out = new Set<string>();
  const scanRoot = topic ? path.join(archiveRoot, topic) : archiveRoot;

  /*
   * 候选 glob 由注册表生成，配置项 `peer_artifact_globs` 降为**追加**项。
   * 重构前默认值只有两条审核者后缀，`-claude.md` 压根不在候选里——
   * 这正是上面那个跨轮翻转场景无人拦截的直接原因。
   */
  const artifactGlobs = [
    ...ALL_AGENT_IDS.map((id) => `**/*-${id}.md`),
    ...cfg.isolation.peer_artifact_globs,
  ];

  // 1) 他人的审查产出（.md 正文 + _meta 结构化原文）
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

      /*
       * `_meta/` 下的结构化意见与 fallback 编号件：它们是意见**原文**，
       * 泄漏后果与 `.md` 等同。按文件名里的角色段判定，不读内容。
       */
      const metaHit = /^review-([a-z]+)-.+\.(?:json|md)$/.exec(e.name);
      if (metaHit) {
        const owner = metaHit[1]!;
        if (owner !== critic && isAgentId(owner)) out.add(rel);
        continue;
      }

      const parsed = parseArtifactName(e.name);
      if (!parsed) continue;
      if (parsed.role === critic) continue; // 己方历史产出：合法输入
      if (!matchesAnyGlob(rel, artifactGlobs)) continue;

      const verdict = await classifyArtifact(abs, parsed.role, parsed.kind, driver);
      if (verdict === 'peer-review' || verdict === 'indeterminate') out.add(rel);
    }
  };
  await walk(scanRoot);

  /*
   * 1b) 编排器自身的两个目录。
   *
   * `.trivium/`：护栏载体（state.json、lock、bin），审查员没有读它的正当理由。
   *
   * `~/.trivium/runs/`：**对方本轮的原始输出就写在这里**——延迟落盘只保证
   * 项目树内看不到，运行目录里是实时的。它一直写在 BRIEF 第 8 段的提示语里，
   * 却从不在机器集合中（措施 a 的通道③）。既然 `checkPeerLeak` 现在支持
   * 目录前缀匹配（审查意见 GLM-03），就一并收进来——否则收敛提示语之后，
   * BRIEF 仍在承诺一件机器核验不了的事，只修一半等于没修。
   */
  out.add('.trivium');
  out.add(expandHome(cfg.runtime.run_root));

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
  /**
   * 当轮主题。禁读枚举只扫这个主题的目录（审查意见 AGY-02 / GLM-02）。
   *
   * 不给就退回全归档扫描——只为兼容尚未传参的旧调用，新代码一律传。
   */
  topic?: string;
  /**
   * 当轮 Driver（审查意见 AGY-01）。
   *
   * 这个字段曾经**漏掉**：`enumerateDenyPaths` 加了 driver 参数，而作为唯一
   * 调用入口的 `freeze()` 没跟着加，于是真实流水线上 driver 恒为缺省值——
   * 整个按角色判定的 deny 矩阵在 M10 到来时会静默失效。`deny-matrix` 的用例
   * 当时直接调 `enumerateDenyPaths`、绕过了这里，10 条全绿也没能发现。
   * 教训：测试要覆盖**调用链**，不只是函数。
   */
  driver?: AgentId;
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
      (await diffAgainst(projectRoot, base, diffExcludePrefixes(path.relative(projectRoot, archiveRoot)), cfg.review.sensitive_globs));
    subjectSha256 = sha256(diffText);
    // 真实路径在 _meta/ 下，由调用方落盘后回填；这里先给逻辑路径
    subjectPath = path.join(archiveRoot, '_pending', 'changes.diff');
  } else {
    if (!input.subjectPath) throw new Error(`${stage} 阶段必须提供 subjectPath`);
    subjectPath = input.subjectPath;
    subjectSha256 = await sha256File(subjectPath);
  }

  const denyPaths = await enumerateDenyPaths(
    cfg,
    projectRoot,
    archiveRoot,
    critic,
    input.driver ?? DEFAULT_DRIVER,
    input.topic ?? null,
  );

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
  /**
   * `.trivium/` 的项目相对路径，同样整体排除。编排器运行中会写 `state.json` 与
   * 主题锁文件；真实项目里它们被 `init` 写进 .gitignore 才没进 tree_hash，
   * 但漂移判定不该依赖用户的 .gitignore——夹具里没有那几行时就误报了两个文件。
   * 缺省为 `.trivium`。
   */
  triviumDirRel?: string;
}

/**
 * 漂移判定（设计 §9.2 跑后复算，四步）。
 *
 * 顺序有讲究：被审对象漂移优先级最高（整次运行作废），
 * 因为此时结论对应的已经不是送审的那份东西了。
 */
export async function judgeDrift(input: DriftInput): Promise<DriftVerdict> {
  const { cfg, projectRoot, before, afterTreeHash, afterSubjectSha256, relatedPaths, scratchGlobs } = input;
  const normPrefix = (p: string): string => p.replace(/^\.\//, '').replace(/\/+$/, '');
  // 编排器自己的写入点：归档根与 .trivium/，整体排除
  const ownPrefixes = [normPrefix(input.archiveRootRel), normPrefix(input.triviumDirRel ?? '.trivium')]
    .filter((p) => p.length > 0 && !p.startsWith('..'));
  const isOwn = (f: string): boolean => ownPrefixes.some((p) => f === p || f.startsWith(`${p}/`));

  // 第 2 步：被审对象被改 → 整次作废
  if (afterSubjectSha256 !== before.subjectSha256) return { kind: 'subject_drift' };

  // 第 3 步：工作树无变化 → 无漂移
  if (afterTreeHash === before.treeHash) return { kind: 'none' };

  // 3.a 列出变更文件，剔除 scratch 白名单、归档根与 .trivium/
  const changed = (await diffTrees(projectRoot, before.treeHash, afterTreeHash)).filter(
    (f) => !matchesAnyGlob(f, scratchGlobs) && !isOwn(f),
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
