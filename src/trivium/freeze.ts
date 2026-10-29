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
import { ALL_AGENT_IDS, DEFAULT_DRIVER, isAgentId, suffixAlternation, type AgentId } from './agents/registry.js';
import type { Config, CriticId, DenyCategory, DriftUnknownReason, Stage } from './types.js';
import { isReviewSchemaId, VOIDING_DENY_CATEGORIES } from './types.js';
import { parseArtifactName, type DispositionKind, type Role } from './naming.js';
import { parseFrontMatter } from './render.js';
import {
  GIT_DEFAULT_TIMEOUT_MS,
  GitTimeoutError,
  OBJECT_NAME_RE,
  diffAgainst,
  diffTreesNameStatus,
  headSha,
  statusPorcelain,
  treeExists,
  workTreeHash,
} from './util/git.js';
import { expandHome, matchesAnyGlob, sha256, sha256File } from './util/fsx.js';
import { diffExcludePrefixes } from './code-stage.js';
import { runRoot } from './config.js';
import { normalizeAbs, isUnder } from './adapters/base.js';
import { isRunDirFile } from './run-files.js';

/**
 * 敏感文件父目录深度上限（项目根为0）。五段受测目录根加两层后代需要7；
 * 不随消费形态自动扩域。父深度8仍未覆盖，归档同行扫描无此上限。
 * BRIEF原型§9.4第8段与机器集合使用同一边界，不能宣称全深度枚举。
 */
export const SENSITIVE_SCAN_MAX_PARENT_DEPTH = 7;

/**
 * 编排器状态目录里**允许审查员读**的具名清单（设计 §10.1.1）。
 *
 * ## 为什么是「整棵禁 + 具名放行」而不是「把子树展开成文件清单」
 *
 * 后者是 fail-open：将来任何版本往那棵树里新写一个文件（日志、缓存、轨迹副本），
 * 默认就可读，而没有任何机制会红。这与 16.2 纪律 11「禁止手工枚举禁读矩阵」冲突。
 * 现在的形态是：deny 集里保留整棵目录条目，命中时**减去**这份放行前缀。
 *
 * ## 为什么只有这两项
 *
 * - 项目级共享配置：审查员有正当阅读理由（它就是「这个项目怎么审」的声明）。
 * - `bin/` 下的 wrapper：无信息价值。
 *
 * **本机覆盖配置不在此列**：探针结论落在那里（共享配置在 `init` 写盘时显式剥掉
 * `probe` 段），放行等于把本机绝对路径、各 CLI 入口与 provider 端点整份摊进
 * 审查员上下文，而默认 `sensitive_globs` 的形态（`.env*` / `*.pem` / `*.key` /
 * `id_rsa*`）挡不住它。审查员若确实需要探针结论，正解是由编排器把非敏感字段
 * 摘进 BRIEF——暴露面由代码控制，而不是放开整个文件。
 *
 * 状态文件与锁目录同样继续挡：它们是编排器运行态（闸门进度、run_id、会话 id），
 * 审查员没有读它的正当理由，泄的是运行时序信号。
 */
export const ORCHESTRATOR_READABLE: readonly string[] = ['config.yaml', 'bin'];

/**
 * 判定一条**被命中的**禁读路径属于哪一类（设计 §10.1.1）。
 *
 * ## 为什么是一个纯函数，而不是在 freeze 与 guard 各写一遍
 *
 * 分类要同时作用于两条判定通道（措施 a 读取路径、措施 b 命令文本）与三个消费面
 * （机器判定、BRIEF 文案、审查文档 front-matter）。规则写两份必然漂移，
 * 而漂移的症状恰恰是本批要修的那一族——「提示语说作废、机器做的是不算」。
 *
 * ## 为什么运行根必须细分
 *
 * 运行根是**混合树**：对端本轮原始输出与审查员**自己**的运行时材料
 * （sandbox home、请求文件、工作日志）同处一棵。按整棵前缀匹配，
 * 「读自己的运行目录」会被判成泄漏对端产物——把误伤换个地方制造一次。
 * 2026-09-16 的计划双审里，一侧审查员以第一手证据指出这点：它自己的进程
 * 就跑在那棵被禁的树下。
 *
 * 己方子路径的判据是 `<运行根>/…/<runId>/<自己的 id>/`——运行目录按
 * `<项目槽>/<runId>/<侧>/` 布局，末段就是侧名。
 */
export function classifyDenyPath(
  hitPath: string,
  ctx: {
    projectRoot: string;
    triviumDir: string;
    runRoot: string;
    critic: CriticId;
    sensitiveGlobs: readonly string[];
  },
): DenyCategory {
  /*
   * 归一化走 `normalizeAbs`，与 `checkPeerLeak` **同一套口径**（r1 CODEX-06）。
   * 初版这里用裸 `path.relative`，而匹配侧抹平了 macOS 的 `/private` 前缀——
   * 运行根落在 `/var` 一类路径上时，匹配通道命中而分类通道判在根之外，
   * 于是落回兜底最重档：两条通道对同一次命中给出不同的判断。
   */
  const abs = normalizeAbs(hitPath, ctx.projectRoot);
  const rel = path.relative(normalizeAbs(ctx.projectRoot, ctx.projectRoot), abs);

  /*
   * ── 运行根：先分己方/对端，再谈处置 ──
   *
   * **`isUnder` 而不是 `relative(...)` 非空**（r1 三侧独立收敛的阻断一）：
   * 初版判据是 `if (runRel && …)`，而 `path.relative(根, 根)` 返回**空串**——
   * 空串 falsy，于是**根本身**跳过全部分类、一路落到兜底 `peer-artifact`。
   * 而禁读集里存的恰恰是整棵目录条目（见 `enumerateDenyPaths`），
   * 于是四类分档、具名放行、己方豁免**三项一次都不生效**。
   * 单测当时全绿，因为喂的是叶子路径——生产喂进来的是根。
   */
  if (isUnder(abs, normalizeAbs(ctx.runRoot, ctx.projectRoot))) {
    const runRel = path.relative(normalizeAbs(ctx.runRoot, ctx.projectRoot), abs);
    const seg = runRel === '' ? [] : runRel.split(path.sep);

    /*
     * 布局是 `<项目槽>/<runId>/<侧>/…`（见 `run-protocol.ts` 的 `runDirFor`）。
     *
     * **第三段是侧名还是编排器自己的运行时文件，要分开判**（r1 三侧收敛）：
     * `request.json` / `worker.log` / `worker.pid` / `status.json` 就写在
     * `<项目槽>/<runId>/` 这一层，第三段是**文件名**，永不等于侧名——
     * 初版一律判 `peer-run-output`（作废），而设计 §10.1.1 的 ②′ 行
     * **逐字点名**这两个文件属「己方运行时材料，不判作废」。
     * 实现与设计对同一份材料给了相反的处置，且「保守」在这里保护不了什么：
     * 真正的对端输出在 `<侧>/` 子树里，靠第三段就认得出来。
     */
    if (seg.length >= 3) {
      if (seg[2] === ctx.critic) return 'own-run-material';
      if (isRunDirFile(seg[2]!)) return 'own-run-material';
      return 'peer-run-output';
    }
    /*
     * 段数不足（根本身、项目槽、runId 那几层）：这些层**同时含**对端子树，
     * 按对端处置——保守方向，宁可多判一次让人来纠。
     */
    return 'peer-run-output';
  }

  // 编排器状态目录。同样用 isUnder：目录条目自身是这里最常见的形态
  if (isUnder(abs, normalizeAbs(ctx.triviumDir, ctx.projectRoot))) {
    return 'orchestrator-state';
  }

  // 凭据文件优先于「对端产物」判：它不在归档里，两者不会重叠
  if (matchesAnyGlob(rel, ctx.sensitiveGlobs)) return 'sensitive';

  return 'peer-artifact';
}

/*
 * 运行目录那一层的编排器文件：**从写入点共用的常量派生**，不再手抄字面量。
 *
 * 上一版在这里写了一份四元素的字面量集合，与真正的写入点（`run-protocol.ts` /
 * `status.ts`）没有任何机器联系——那边新增一个运行时文件或改名，这里不会报错，
 * 只会让审查员读自己那轮的材料时被判作废（r2 代码双审 AGY-05 ≡ GLM-07）。
 *
 * `isRunDirFile` 还认原子写的临时态（`status.json.tmp-<pid>-<ms>`）：
 * 心跳每次落盘都会在运行目录里短暂出现一个，一次目录列举撞上它，
 * 按纯文件名匹配的白名单认不出来——那是个与内容无关、与时机有关的随机误伤。
 */

/** 该类是否会让这一侧的结论作废（设计 §10.1.1 的第①②类） */
export function isVoidingCategory(c: DenyCategory): boolean {
  return VOIDING_DENY_CATEGORIES.includes(c);
}

/*
 * ── 作废谓词：守卫与闸门共用（BACKLOG EV-239，M12 批次 1）──
 *
 * 作废判定曾有三个派生点：守卫的侧级判定、run.json 的共同阻断运行期三态（读守卫的结果）、
 * 闸门的 `voidedSides`。前两处只认作废类；闸门那处对命令通道按 `hit === true` 一律作废，
 * 注释写着「命令通道没有类别信息，命中即算」——那句是 2026-09-17 `f2bc7635` 写的，
 * 同主题 r2 的 `333e5a29` 随即给命令通道补了逐条带类的 `hits`，闸门没跟上。
 * 后果是只命中编排器状态目录（告警级）的一侧在守卫看来有效、在闸门看来作废，
 * 两审形态下共同阻断这一档静默不执行，同一次运行的 run.json 与 task.json 记着不同的有效侧数
 * （M11 第 12 步 Z2 / B2 实测）。
 *
 * 现在守卫的侧级判定与闸门的作废派生**调同一个 `leakRecordVoids`**：前者喂内存里的命中，
 * 后者喂落盘的同形记录。M12 批次 3 的作废侧重跑（EV-225）也要从这里取判定，别再另写一份。
 */

/** 一组类别里有没有作废类（守卫逐条命令分档时手上是裸类别数组） */
export function categoriesVoid(cats: readonly DenyCategory[]): boolean {
  return cats.some((c) => isVoidingCategory(c));
}

/** 一组带类命中里有没有作废类 */
export function hitsVoid(hits: readonly { category: DenyCategory }[]): boolean {
  return categoriesVoid(hits.map((h) => h.category));
}

/**
 * 一侧的两条泄漏通道记录是否判该侧作废。形状与 run.json `guard.peer_leak_via_path` /
 * `peer_leak_via_command` 的单侧值相同，守卫在落盘前就用同形的内存记录调它。
 *
 * **旧记录各按旧口径，不追溯改判**：
 * - 路径通道缺 `hits`（早于按侧留痕的接线）⇒ 按无作废——那时无从区分哪一类命中；
 * - 命令通道缺 `hits`（2026-09-17 之前的 run.json 只有 `commands`）⇒ 退回 `hit === true`，
 *   即当时「命中即作废」的口径。
 * 有 `hits` 时一律按类别判：`hit` 的语义是「这条通道扫到了东西」，含告警档，不能拿来判作废。
 */
export function leakRecordVoids(rec: {
  path?: { hits?: readonly { category: DenyCategory }[] } | undefined;
  command?: { hit: boolean; hits?: readonly { category: DenyCategory }[] } | undefined;
}): boolean {
  const pathVoids = hitsVoid(rec.path?.hits ?? []);
  const cmd = rec.command;
  const commandVoids = cmd === undefined ? false : cmd.hits !== undefined ? hitsVoid(cmd.hits) : cmd.hit === true;
  return pathVoids || commandVoids;
}

/**
 * 命中的这条路径是否落在编排器目录的**具名放行清单**里。
 *
 * 两条通道（措施 a / 措施 b）都要调它——只在一条上豁免，就会出现
 * 「路径通道放行、命令通道照样作废」这种自相矛盾的处置。
 */
export function isOrchestratorReadable(
  hitPath: string,
  ctx: { projectRoot: string; triviumDir: string },
): boolean {
  const abs = normalizeAbs(hitPath, ctx.projectRoot);
  const dir = normalizeAbs(ctx.triviumDir, ctx.projectRoot);
  if (!isUnder(abs, dir)) return false;
  const rel = path.relative(dir, abs);
  /*
   * 目录**自身**不放行：它代表整棵子树，而子树里绝大多数条目要继续挡。
   * （这一行的 `rel === ''` 分支是显式写出来的——初版靠 `!rel` 的 falsy 落到
   * 同一结果，但那是巧合而非意图：`classifyDenyPath` 里同样的写法就判错了。）
   */
  if (rel === '') return false;
  const head = rel.split(path.sep)[0] ?? '';
  return ORCHESTRATOR_READABLE.includes(head);
}

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
  // v1 ∪ v2（EV-247）：漏认 v2，对端的新审查件就落进下面「后缀等于 Driver 即放行」的分支——禁读静默失效
  if (isReviewSchemaId(schema)) return 'peer-review';
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
/** 项目相对路径转 BRIEF/命令匹配域形态：恒用 `/`（win32 的 path.relative 产出反斜杠，须归一；macOS 无痕） */
const toDomainRel = (p: string): string => (path.sep === '\\' ? p.replace(/\\/g, '/') : p);

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
   * indeterminate，整批进禁读集——审核者正常读取即 `peer_leak`、该侧结论作废。
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
      const metaHit = new RegExp(`^review-(${suffixAlternation()})-.+\\.(?:json|md)$`).exec(e.name);
      if (metaHit) {
        const owner = metaHit[1]!;
        if (owner !== critic && isAgentId(owner)) out.add(toDomainRel(rel));
        continue;
      }

      const parsed = parseArtifactName(e.name);
      if (!parsed) continue;
      if (parsed.role === critic) continue; // 己方历史产出：合法输入
      if (!matchesAnyGlob(rel, artifactGlobs)) continue;

      const verdict = await classifyArtifact(abs, parsed.role, parsed.kind, driver);
      // 禁读条目是 BRIEF/命令匹配域的项目相对形态，恒用 `/`（win32 的 relative 产出反斜杠）
      if (verdict === 'peer-review' || verdict === 'indeterminate') out.add(toDomainRel(rel));
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
    if (depth > SENSITIVE_SCAN_MAX_PARENT_DEPTH) return;
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
      if (matchesAnyGlob(rel, cfg.review.sensitive_globs)) out.add(toDomainRel(rel));
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
   * **`review.ts` 那个唯一调用点曾经漏传，剪枝因此在真实流水线上从未生效过**
   * （代码双审 r1 CODEX-01；实测本主题 code 阶段禁读集 270 条里只有 4 条属于本主题）。
   * 现有一条用例扫真实调用点的源码，判的是**值表达式在场**而不是键在场。
   *
   * ## 承诺边界：剪枝按**主题名的字面串**，不是「同一被审对象」
   *
   * 于是同一份工作**只要换过主题名**，前一个目录下的对端意见就同时从机器集合
   * （`checkPeerLeak`）与 BRIEF §8.1 提示语里消失——两者同源于这一份
   * `snapshot.denyPaths`，**没有第二张网**。
   *
   * 下面 `enumerateDenyPaths` 给的理由是「那是**另一个任务**的意见」，
   * 而该前提在「同一里程碑换名」时**不成立**：本仓
   * `.reviews/M9-ClaudeCode审核者接入/` 与 `.reviews/M9-适配器本体与准入收口/`
   * 就是同一条工作的两处目录（实测剪枝前 270 条里有 20 条属于前者，剪枝后归零）。
   * 审查员去读它在本轮既不在提示语里、也不进 `peer_artifact_read`——**静默放宽**。
   *
   * **这是承诺边界，不是解释性文字**（代码双审 r2 CODEX-03）。换扫描键登记 EV-48。
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
  /*
   * 归档根、.trivium/、.git 不进 tree_hash（EV-221），与 code 阶段补丁同一份排除：漂移判定本就剔除这几处，
   * 而另一个主题的工作进程正往归档根或 .trivium/ 原子写的临时文件会让临时索引的 `add -A` 报「unable to stat」。
   * 运行根一并排除（ISSUE-05a）：run_root 指进项目内时 worker 心跳正在原子替换的文件
   * 在 Windows 上会让 `add -A` 报「short read」——排除 + `workTreeHash` 的暂态重试双保险。
   */
  const ownExcludes = diffExcludePrefixes(path.relative(projectRoot, archiveRoot), path.relative(projectRoot, runRoot(cfg)));
  const treeHash = await workTreeHash(projectRoot, { exclude: ownExcludes });
  const status = await statusPorcelain(projectRoot);
  const dirty = status.length > 0;

  let subjectSha256: string;
  let subjectPath: string;
  let diffText: string | null = null;

  if (stage === 'code') {
    const base = input.base ?? 'HEAD';
    diffText =
      input.diffText ??
      (await diffAgainst(projectRoot, base, ownExcludes, cfg.review.sensitive_globs));
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

/**
 * 漂移结论。`unknown` = 两棵 tree 不同、却比不了改了哪些文件（EV-139）：不知道改了什么，
 * 就排除不了被审范围内的文件被改，处置按 `on_drift_related`（见 {@link driftAction}）。
 * 加新的一种时，`driftAction` 与 `guard.ts` 的 `renderGuardWarnings` 都会在编译期报漏写。
 */
export type DriftVerdict =
  | { kind: 'none' }
  | { kind: 'subject_drift' }
  | { kind: 'related'; files: string[] }
  | { kind: 'unrelated'; files: string[] }
  | ({ kind: 'unknown' } & DriftUnknownReason);

/** 比对失败之后两次核对对象（`cat-file -e`）合用的总预算，与单次 git 缺省超时同值 */
export const DRIFT_PROBE_BUDGET_MS = GIT_DEFAULT_TIMEOUT_MS;

/** 报错首行，截到 300 字符——它进 run.json 的 `unknown_reason.detail`（随归档进版本库），只留够判断成因的一行 */
function firstLineOf(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return (msg.trim().split('\n')[0] ?? '').slice(0, 300);
}

/**
 * 严格比对失败之后分原因（EV-139 计划 r2 §2.2）。导出供单测直接喂超时与非 git 目录。
 *
 * 次序：比对本身超时 ⇒ `timeout`，**不再查对象**（坏仓库里不叠加第二次超时）；否则逐棵 `treeExists`，
 * 任一不在 ⇒ `object_gone`；核对对象时超时 ⇒ `timeout`、出别的错 ⇒ `git_error`（两段首行都带）；
 * 两棵都在 ⇒ `git_error`（比对报错首行）。两棵 tree 对称判：跑后那棵刚写出、几乎不会被删，
 * 但不能让它掉进 `git_error`。
 *
 * **两次核对共用一份预算**（代码双审 CODEX-01 ≡ GLM-03）：比对本身走缺省 {@link GIT_DEFAULT_TIMEOUT_MS}，
 * 快速失败之后的两次 `cat-file -e` 合计不超过 {@link DRIFT_PROBE_BUDGET_MS}（逐次传剩余毫秒，显式传值即按进程组收尾）。
 * 于是比不了那一格最坏比改前多等一个预算：比对 120 s + 核对至多 120 s。
 */
export async function classifyCompareFailure(
  projectRoot: string,
  beforeTree: string,
  afterTree: string,
  err: unknown,
  /** 测试注入：只为让单测看到传给核对的预算；生产不传 */
  deps: { treeExists?: typeof treeExists } = {},
): Promise<DriftUnknownReason> {
  const exists = deps.treeExists ?? treeExists;
  // 时长与子命令名都取结构化来源（代码双审 CODEX-02 ≡ GLM-02）：不复制字面量、不裁剪 message
  const timedOut = (e: GitTimeoutError, budgetMs: number): DriftUnknownReason => ({
    cause: 'timeout',
    detail: `git ${e.what} 未在 ${Math.round(budgetMs / 1000)} s 内结束`,
  });
  if (err instanceof GitTimeoutError) return timedOut(err, GIT_DEFAULT_TIMEOUT_MS);
  const compareLine = firstLineOf(err);
  const trees: Array<[string, string]> = [
    [beforeTree, `送审快照的 tree ${beforeTree.slice(0, 12)} 在审查期间被清理`],
    [afterTree, `跑后复算的 tree ${afterTree.slice(0, 12)} 已被清理`],
  ];
  const started = Date.now();
  const remaining = (): number => Math.max(1, DRIFT_PROBE_BUDGET_MS - (Date.now() - started));
  for (const [tree, goneDetail] of trees) {
    let present: boolean;
    try {
      present = await exists(projectRoot, tree, { timeoutMs: remaining() });
    } catch (probeErr) {
      if (probeErr instanceof GitTimeoutError) return timedOut(probeErr, DRIFT_PROBE_BUDGET_MS);
      return { cause: 'git_error', detail: `${compareLine}；核对对象时：${firstLineOf(probeErr)}` };
    }
    if (!present) return { cause: 'object_gone', detail: goneDetail };
  }
  return { cause: 'git_error', detail: compareLine };
}

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
 *
 * **比不了 ⇒ `unknown`，不是 `none`**（EV-139）：两棵 tree 不同、而 3.a 列不出变更（tree 值不合形状、
 * 送审快照的 tree 在审查期间被清理、git 出错或超时）时，不知道改了什么，护栏不能说「无漂移」。
 * 3.a 因此用失败即抛的 `diffTreesNameStatus`，不用失败返回 `[]` 的 `diffTrees`。
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

  /*
   * 3.a′ 形状闸：两棵 tree 的值都从留痕读回（worker 的送审快照取自运行目录的 request.json），
   * 任何 git 调用之前先核形状——以 `-` 开头的值会被 git 当成选项。不合即比不了，不回显该值。
   */
  if (!OBJECT_NAME_RE.test(before.treeHash) || !OBJECT_NAME_RE.test(afterTreeHash)) {
    const which = OBJECT_NAME_RE.test(before.treeHash) ? '跑后复算的 tree' : '送审快照的 tree';
    return { kind: 'unknown', cause: 'git_error', detail: `${which} 值不是合法的 git 对象名（不回显该值）` };
  }

  // 3.a 列出变更文件（失败即抛 ⇒ 比不了），剔除 scratch 白名单、归档根与 .trivium/
  let entries: Array<{ status: string; path: string }>;
  try {
    entries = await diffTreesNameStatus(projectRoot, before.treeHash, afterTreeHash);
  } catch (e) {
    return { kind: 'unknown', ...(await classifyCompareFailure(projectRoot, before.treeHash, afterTreeHash, e)) };
  }
  const changed = entries
    .map((c) => c.path)
    .filter((f) => !matchesAnyGlob(f, scratchGlobs) && !isOwn(f));
  // 3.b 全是 Agent 临时文件 → 无漂移
  if (changed.length === 0) return { kind: 'none' };

  // 3.c 与 --context / diff 涉及文件相交 → 相关漂移
  /*
   * related 比对域恒用 `/`（1.2.5，win32 解除 freeze-drift 跳过后暴露的真缺陷）：
   * git 产出的路径是正斜杠，`path.normalize` 在 win32 归一成反斜杠——`startsWith('src/')`
   * 对 `src\a.ts` 永远不成立，--context 相关漂移在 win32 全部落 unrelated。两侧同归一到
   * 匹配域再比，与 matchesAnyGlob/toDomainRel 同一条纪律。
   */
  const relatedSet = new Set(relatedPaths.map((p) => path.normalize(p).replace(/\\/g, '/')));
  const related = changed.filter((f) => {
    const n = path.normalize(f).replace(/\\/g, '/');
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
    // 比不了 ⇒ 排除不了被审范围内的文件被改，按相关漂移那一档（EV-139，用户决策）
    case 'unknown':
      return cfg.review.on_drift_related === 'fail' ? 'fail' : 'warn';
    case 'unrelated':
      return cfg.review.on_drift === 'fail' ? 'fail' : 'warn';
  }
}
