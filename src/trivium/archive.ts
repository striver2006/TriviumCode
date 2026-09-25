/**
 * `archive`：**唯一**写 `.reviews/` 的模块（设计 §5.1 / §16.2 纪律 2）。
 *
 * 任何模块想往归档里写东西都必须经这里，命名规则只在 naming.ts 一处实现。
 * 这样 AC-07（命名与目录）才有单点保证，而不是散落在各模块里各写一遍。
 *
 * 三条铁律：
 *   1. **防覆盖**（FR-25 / AD-11）：以 `O_CREAT|O_EXCL` 原子创建。既有工件无论
 *      是否已审批一律不覆盖；命中已存在即抬升 `-r<N>`。不得用「先 exists 再写」
 *      代替——那有 TOCTOU 竞态。
 *   2. **落盘前密钥扫描**（NFR-04）：归档要进 Git，写入即永久泄露。
 *   3. **`_meta/` 不得出现角色后缀文件名**（§6.2）：否则 AC-07 的检查器会把
 *      编排器产出的审计材料误判成审查文档。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { DEFAULT_DRIVER, type AgentId } from './agents/registry.js';
import { DEFAULT_CRITICS, type CriticId, type Stage, type StageOrVerify } from './types.js';
import {
  buildArtifactName,
  buildVerifyName,
  localDate,
  looksLikeRoleArtifact,
  parseArtifactName,
  roleArtifactSuffixLabel,
  roleIsAllowedForWriter,
  type ArtifactName,
  type DispositionKind,
  type Role,
} from './naming.js';
import { assertNoSecrets } from './secrets.js';
import { createExclusive, ensureDir, exists, sha256, sha256File, writeAtomic } from './util/fsx.js';
import { validateRunMeta, validateRunMetaV1 } from './schemas.js';

export interface ArchiveLayout {
  archiveRoot: string;
  topic: string;
}

export const topicDir = (l: ArchiveLayout): string => path.join(l.archiveRoot, l.topic);
export const stageDir = (l: ArchiveLayout, stage: StageOrVerify): string =>
  path.join(topicDir(l), stage);
export const metaDir = (l: ArchiveLayout, stage: StageOrVerify): string =>
  path.join(stageDir(l, stage), '_meta');

/**
 * 计算本次运行应使用的重跑轮次（§12.5）。
 *
 * **只看审查工件**（带角色后缀、且该角色不是当轮 Driver 的那些），不看 Driver 的原稿。
 * 判据在下面按 `i.parsed.role === driver` 逐条算，**此处不重抄一份后缀枚举**：
 * 抄的那份会随注册表漂移（同族的三处今天就已漏过 `-codex.md`）。
 * 依据设计 §6.2 的目录示例：重跑时原稿**不重新生成**，停留在第 1 轮，
 * 只有两侧审查与裁决件带 `-r<N>`：
 *
 * ```
 * 2026-09-10-登录重构-claude.md            ← 原稿，只有一份
 * 2026-09-10-登录重构-gemini.md            ← 第 1 轮
 * 2026-09-10-登录重构-r2-gemini.md         ← 第 2 轮
 * ```
 *
 * 若把原稿也算进去，首次审查就会被算成第 2 轮——这是实跑时真的踩到的。
 *
 * 一次运行只算一次，两侧审查文档与裁决件**共用同一个 N**，否则会出现
 * `-r2-gemini.md` 配 `-r3-glm.md` 这种对不上的组合。
 */
export async function resolveRerunIndex(
  l: ArchiveLayout,
  stage: Stage,
  driver: AgentId = DEFAULT_DRIVER,
): Promise<number> {
  const items = await listStageArtifacts(l, stage);
  let max = 0;
  for (const i of items) {
    /*
     * 跳过**当轮 Driver 的产出**（原稿与裁决件不决定轮次），而非字面 claude
     * （计划 §2.2 / A-2）。写死时，ZCode 为 Driver 的 `-glm.md` 原稿会被
     * 当成审查件参与 max 计算，轮次凭空 +1，`gate --check-artifacts`
     * 按单一轮次过滤时必报缺件。双侧下 Driver 恒为 claude，恰好正确。
     */
    if (i.parsed.role === driver) continue;
    if (i.parsed.rerunIndex > max) max = i.parsed.rerunIndex;
  }
  return max + 1;
}

/**
 * 从 `startAt` 起找第一个对**全部**给定角色都空闲的轮次（同一天同主题）。
 *
 * `writeArtifact` 命中已存在时逐侧独立抬升，两侧各自 `n++` 会分叉成
 * `-r2-gemini.md` 配 `-r3-glm.md`——与上面「共用同一个 N」的不变式矛盾，
 * `gate --check-artifacts` 按单一轮次过滤时必报缺件。executeRun 落盘前先用它定一个
 * 共同的 N，再把两侧都写到那个 N 上。
 */
export async function firstFreeRerunIndex(
  l: ArchiveLayout,
  stage: Stage,
  roles: readonly Role[],
  startAt: number,
  date: string = localDate(),
): Promise<number> {
  const dir = stageDir(l, stage);
  for (let n = Math.max(1, startAt); n < startAt + MAX_BUMP; n++) {
    const taken = await Promise.all(
      roles.map((role) =>
        exists(path.join(dir, buildArtifactName({ date, topic: l.topic, rerunIndex: n, kind: null, role }))),
      ),
    );
    if (!taken.some(Boolean)) return n;
  }
  throw new Error(`从第 ${startAt} 轮起 ${MAX_BUMP} 个轮次都被占用：${dir}`);
}

/**
 * 这份文件是不是**审查件**（M9 第 5 步，计划双审 CODEX-07）。
 *
 * ## 判据为什么落在文件内容上
 *
 * 被审对象的候选按「后缀等于当轮 Driver 且无裁决中缀」筛。换过 Driver 的主题里，
 * 上一轮由别家当 Driver 时，**这一家的后缀正是审查件的后缀**——候选排序按
 * `rerunIndex desc, fileName desc`，日期更晚的那份审查件会排在真原稿前面，
 * 于是编排器会拿一份审查意见当计划原稿送去再审。
 *
 * 曾经考虑过按 `run.json.artifacts[]` 的登记反推（登记过 ⇒ 编排器产出的审查件）。
 * 那条在今天的归档上成立（实测 84 份运行元数据、162 条带角色后缀的登记条目，
 * **162/162 含 `trivium.review.v1`**），但它靠的是**调用点清单**而不是不变式：
 * `roleIsAllowedForWriter` 本就允许 `writer === 'driver'` 产出角色工件，
 * 哪天 Driver 的原稿也走 `writeArtifact`，那条判据就会把合法原稿判死。
 *
 * ## 为什么不复用 freeze.ts 的 classifyArtifact
 *
 * 那个函数是**三值**的（`peer-review | own-or-driver | indeterminate`）、为禁读矩阵
 * 设计、fail-closed，而且它的文档块明写「**fail-closed 只用在这里，不外扩**」。
 * 把它搬进选原稿语境会：①造成 `topic.ts → freeze.ts` 的分层倒置；
 * ②让显式指定的、没有 front-matter 的手写原稿被判 `indeterminate` 进而误拒——
 * 而那正是本判据自己要留的逃生门。它还是模块私有的，「复用」本身就落不了地。
 *
 * 所以这里是**二值**谓词：只回答「是不是审查件」，不做安全判决。
 *
 * ## 边界
 *
 * `parseFrontMatter` 对「不以 `---` 开头 / 没有闭合 `---` / YAML 解析失败」一律返回
 * null 且不抛；读文件失败也吞掉。于是 front-matter 缺失、损坏、非 UTF-8、空文件
 * **四类形态全部坍缩为「不是审查件」**——放行，不误拒。
 *
 * 残余风险（EV-63）：front-matter 被剥掉或改坏的**真审查件**会被当原稿放行。
 * 登记判据在这一格反而可靠（只是不完备）。**所以本谓词只对未损坏的留痕成立**，
 * 不要把它当成防伪造的防线。
 */
export async function isReviewArtifact(absPath: string): Promise<boolean> {
  /*
   * **模块加载放在 try 之外**（代码双审 CODEX-07）。
   *
   * 上一版把它和 readFile/parse 一起包进 try，于是模块加载失败也走 `return false`——
   * 谓词恒假，显式路径的硬拒与自动候选的过滤**同时变成空操作**，
   * 而「拿审查意见当原稿」原样回来，且没有任何用例能发现（用例调的是同一个函数）。
   * 这里没有需要回避的循环依赖：`render.ts` 只静态 import `types.js` 与 `agents/registry.js`。
   */
  const { parseFrontMatter } = await import('./render.js');
  let fm: Record<string, unknown> | null = null;
  try {
    // try 只兜这两步——它们的失败才是文档块里写明要吞的那四类
    fm = parseFrontMatter(await fs.readFile(absPath, 'utf8'));
  } catch {
    return false;
  }
  return fm?.['schema'] === 'trivium.review.v1';
}

export interface WriteArtifactInput {
  layout: ArchiveLayout;
  stage: Stage;
  role: Role;
  /** 谁在写——用于角色后缀硬约束校验 */
  writer: 'driver' | CriticId;
  kind?: DispositionKind | null;
  rerunIndex: number;
  content: string;
  date?: string;
}

export interface WrittenArtifact {
  /** 相对归档根的路径，写进 run.json.artifacts */
  relPath: string;
  absPath: string;
  fileName: string;
  sha256: string;
  /** 因命中已存在文件而实际抬升到的轮次（等于入参时表示未抬升） */
  effectiveRerunIndex: number;
}

const MAX_BUMP = 200;

/**
 * 落盘一份角色工件（审查文档或裁决件）。
 *
 * 命中已存在文件时**不覆盖**，而是抬升 `-r<N>` 重试。上限存在是为了防止目录被
 * 外部程序塞满时无限循环。
 */
export async function writeArtifact(input: WriteArtifactInput): Promise<WrittenArtifact> {
  const { layout, stage, role, writer, content } = input;
  const kind = input.kind ?? null;
  const date = input.date ?? localDate();

  if (!roleIsAllowedForWriter(writer, role)) {
    throw new Error(
      `角色后缀违规：${writer} 不得产出 -${role}.md（设计 §6.2 / PRD 6.3）。` +
        `审查员不得产出 claude 后缀，Driver 不得产出 gemini/glm 后缀。`,
    );
  }

  const dir = stageDir(layout, stage);
  await ensureDir(dir);
  assertNoSecrets(content, `${layout.topic}/${stage}`);

  let n = input.rerunIndex;
  for (let i = 0; i < MAX_BUMP; i++) {
    const fileName = buildArtifactName({ date, topic: layout.topic, rerunIndex: n, kind, role });
    const absPath = path.join(dir, fileName);
    try {
      await createExclusive(absPath, content);
      return {
        relPath: path.join(layout.topic, stage, fileName),
        absPath,
        fileName,
        sha256: sha256(content),
        effectiveRerunIndex: n,
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      n++; // 命中已存在 → 抬升轮次重试，绝不覆盖
    }
  }
  throw new Error(`抬升重跑轮次超过 ${MAX_BUMP} 次仍无法落盘：${dir}`);
}

/**
 * 落盘 `_meta/` 下的审计材料（brief / review json / run json / diff）。
 *
 * `_meta/` 按 `run_id` 命名，同一 `run_id` 重写等价于修正，因此**允许覆盖**
 * （与角色工件的防覆盖语义不同）。但必须保证不出现角色后缀文件名。
 */
export async function writeMeta(
  layout: ArchiveLayout,
  stage: StageOrVerify,
  fileName: string,
  content: string,
  opts: { scanSecrets?: boolean; scan?: 'full' | 'added-lines' } = {},
): Promise<{ absPath: string; relPath: string; sha256: string }> {
  if (looksLikeRoleArtifact(fileName)) {
    throw new Error(
      `_meta/ 内不得出现以 ${roleArtifactSuffixLabel()} 结尾的文件名（收到 ${fileName}）：` +
        `会与 AC-07 的角色后缀检查器混淆（设计 §6.2）`,
    );
  }
  const dir = metaDir(layout, stage);
  await ensureDir(dir);
  if (opts.scanSecrets !== false) {
    assertNoSecrets(content, `${layout.topic}/${stage}/_meta/${fileName}`, opts.scan ?? 'full');
  }
  const absPath = path.join(dir, fileName);
  await writeAtomic(absPath, content);
  return {
    absPath,
    relPath: path.join(layout.topic, stage, '_meta', fileName),
    sha256: sha256(content),
  };
}

/** 验证记录（§6.2：不带角色后缀，由编排器产出） */
export async function writeVerifyRecord(
  layout: ArchiveLayout,
  content: string,
  opts: { rerunIndex?: number; date?: string } = {},
): Promise<WrittenArtifact> {
  const dir = stageDir(layout, 'verify');
  await ensureDir(dir);
  assertNoSecrets(content, `${layout.topic}/verify`);

  const date = opts.date ?? localDate();
  let n = opts.rerunIndex ?? 1;
  for (let i = 0; i < MAX_BUMP; i++) {
    const fileName = buildVerifyName(date, layout.topic, n);
    const absPath = path.join(dir, fileName);
    try {
      await createExclusive(absPath, content);
      return {
        relPath: path.join(layout.topic, 'verify', fileName),
        absPath,
        fileName,
        sha256: sha256(content),
        effectiveRerunIndex: n,
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      n++;
    }
  }
  throw new Error(`验证记录落盘失败：${dir}`);
}

/** 阶段目录下的角色工件清单（供 gate --check-artifacts 与 report 使用） */
export async function listStageArtifacts(
  layout: ArchiveLayout,
  stage: Stage,
): Promise<{ fileName: string; parsed: ArtifactName }[]> {
  const dir = stageDir(layout, stage);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: { fileName: string; parsed: ArtifactName }[] = [];
  for (const fileName of entries.sort()) {
    const parsed = parseArtifactName(fileName);
    if (parsed && parsed.topic === layout.topic) out.push({ fileName, parsed });
  }
  return out;
}

/** 各阶段最低工件集校验（设计 §6.3，供 `gate --check-artifacts`） */
export interface ArtifactCheck {
  ok: boolean;
  missing: string[];
  present: string[];
}

export async function checkStageArtifacts(
  layout: ArchiveLayout,
  stage: Stage,
  rerunIndex: number,
  /**
   * 本轮实际入选的审核者。写死后缀时，审核者集合一变
   * `gate --check-artifacts` 必报假缺件（计划 §2.1 / B-3）。
   *
   * **回落值取缺省集合而非启用全集**（M8 第 3 步）：codex 启用后，
   * 「能跑的」是三家而「默认跑的」是两家，按前者回落会对每一个两侧轮次报假缺口。
   * 读不到记录时，最合理的猜测是「跑了默认那几家」。
   */
  critics: readonly Role[] = DEFAULT_CRITICS,
  /** 当轮 Driver：原稿与裁决件的后缀 */
  driver: AgentId = DEFAULT_DRIVER,
  /**
   * 全部 run.json 登记过的工件路径（相对归档根）。
   * 给了就核对「阶段目录里有没有没登记的审核者工件」；`null` 跳过该项。
   */
  recordedPaths: ReadonlySet<string> | null = null,
): Promise<ArtifactCheck> {
  const all = await listStageArtifacts(layout, stage);
  const thisRound = all.filter((i) => i.parsed.rerunIndex === rerunIndex);

  const hasThisRound = (role: Role, kind: DispositionKind | null) =>
    thisRound.some((i) => i.parsed.role === role && i.parsed.kind === kind);
  /**
   * 原稿**跨轮次**查找。
   *
   * 依设计 §6.2 的目录示例，重跑时原稿不重新生成、停留在第 1 轮，
   * 只有两侧审查与裁决件带 `-r<N>`。若按当前轮次过滤去找原稿，
   * 任何重跑都会误报「缺原稿」——这与 resolveRerunIndex 的语义必须一致，
   * 否则 `gate --check-artifacts` 在每次重跑上都会假失败。
   */
  const hasAnyRound = (role: Role, kind: DispositionKind | null) =>
    all.some((i) => i.parsed.role === role && i.parsed.kind === kind);

  const required: { label: string; ok: boolean }[] = [];
  // code 阶段的被审对象是 diff 而非文档，因此没有原稿
  if (stage === 'plan' || stage === 'bug') {
    required.push({ label: `原稿 …-${driver}.md（任一轮次）`, ok: hasAnyRound(driver, null) });
  }
  for (const c of critics) {
    required.push({ label: `审查 …-${c}.md`, ok: hasThisRound(c, null) });
  }
  const kind: DispositionKind = stage === 'code' ? 'response' : 'revised';
  required.push({ label: `裁决件 …-${kind}-${driver}.md`, ok: hasThisRound(driver, kind) });

  /*
   * ── 未登记的审核者工件（审查意见 GLM-03）──
   *
   * 阶段目录里出现了审核者后缀的工件，却不在任何一轮 `run.json.artifacts[]` 的登记内，
   * 说明它不是编排器写的。此前对这种文件**完全失明**：`hook-pre-commit` 的 git 锚只看
   * 已跟踪文件的改动，新增未跟踪文件不触发；`checkRecordedArtifacts` 只核对「登记过的
   * 还在不在、有没有被改」，反方向（「没登记的混进来」）无人管。
   *
   * 它堵的是把伪审查件搬进阶段目录的整类手法——`cp -R doc/ .reviews/t/plan/`、`tar`、
   * 手工拖拽一视同仁。之所以放在这里而不是 Hook：这是**路径信号**，对「文件怎么进来的」
   * 不敏感，不像命令行字面扫描那样可以被改写命令绕开（Bash 侧收窄的三轮教训见
   * `hooks.ts` 里那段注释）。
   *
   * `recordedPaths` 为 null 时跳过本项（调用方没提供登记清单，不代表文件非法）。
   */
  const unregistered: string[] = [];
  if (recordedPaths !== null) {
    for (const i of all) {
      if (!critics.includes(i.parsed.role)) continue; // 只管审核者后缀的工件
      const rel = path.relative(layout.archiveRoot, path.join(stageDir(layout, stage), i.fileName));
      if (!recordedPaths.has(rel)) unregistered.push(i.fileName);
    }
  }
  for (const f of unregistered) {
    required.push({ label: `未登记的审查件 ${f}（不在任何 run.json 的 artifacts 内）`, ok: false });
  }

  return {
    ok: required.every((r) => r.ok),
    missing: required.filter((r) => !r.ok).map((r) => r.label),
    present: required.filter((r) => r.ok).map((r) => r.label),
  };
}

/** 一份「记录在案却已不符」的工件，或一份「登记过却读不到」的清单 */
export interface TamperedArtifact {
  /** 相对归档根的路径 */
  relPath: string;
  kind: 'missing' | 'modified' | 'manifest_missing' | 'manifest_unreadable';
  runId: string;
  stage: StageOrVerify;
  recordedSha256: string;
  actualSha256?: string;
  /**
   * `manifest_unreadable` 的**真实**原因，透传自 `runManifestProblem()`。
   *
   * 存在的理由见 `RecordedRun.unreadableReason`：不透传的话，调用方只能硬编码
   * 「解析失败」，而那对「解析成功但契约不认」的记录是错误的排障方向。
   */
  reason?: string;
}

/**
 * 核对 `run.json` 记录过的工件是否仍在、内容是否仍是原样（FR-25 / P5 / P6）。
 *
 * ## 为什么需要这个
 *
 * 设计 §17.3 剧本 5 明文要求：「删掉一份审查文档后执行 `git commit`，
 * `hook-pre-commit` 应阻断」。而仅凭闸门状态做不到——裁决通过后闸门已放行回
 * `idle`，此时删掉一份不顺眼的审查再提交，一路绿灯。
 *
 * 判据用 `run.json` 的 `artifacts[]`（path + sha256）而不是「最低工件集是否齐备」：
 * 前者能区分「**记录在案却不见了**」与「本来就还没写」，也能顺带发现内容被改动。
 * 这是不可伪装性的落点——留痕的意义在于它删不掉也改不掉。
 */
export async function checkRecordedArtifacts(
  layout: ArchiveLayout,
  runs: { run_id: string; stage: StageOrVerify; artifacts: { path: string; sha256: string }[] }[],
): Promise<TamperedArtifact[]> {
  const out: TamperedArtifact[] = [];
  for (const r of runs) {
    for (const a of r.artifacts) {
      const abs = path.join(layout.archiveRoot, a.path);
      let actual: string;
      try {
        actual = await sha256File(abs);
      } catch {
        out.push({
          relPath: a.path, kind: 'missing', runId: r.run_id, stage: r.stage,
          recordedSha256: a.sha256,
        });
        continue;
      }
      if (actual !== a.sha256) {
        out.push({
          relPath: a.path, kind: 'modified', runId: r.run_id, stage: r.stage,
          recordedSha256: a.sha256, actualSha256: actual,
        });
      }
    }
  }
  return out;
}

/** 读某主题各阶段全部 run.json（供 checkRecordedArtifacts 与 report 用） */
export interface RecordedRun {
  run_id: string;
  stage: StageOrVerify;
  artifacts: { path: string; sha256: string }[];
  status: string;
  skipped?: boolean;
  /** run.json 存在但读不出来——**成因不止一种**，见下 */
  unreadable?: boolean;
  /**
   * 不可读的具体原因（审查意见 GLM-03）。
   *
   * M7b 第 3 步之前，unreadable 基本只有「JSON 坏了」一种成因，调用方硬编码
   * 「存在但解析失败」是准的。本步把**契约拒绝**（未知 schema、不合 v1/v2）
   * 也纳入 unreadable 之后，那句话对一份**解析完全成功、只是 schema 不被接受**的
   * 文件就是错的——排障者会被引去查 JSON 损坏。
   *
   * 而这条链路正是「写错会永久拦死每一次 `git commit`」的那条：
   * 在最需要准确诊断的地方给错方向，代价最高。所以原因必须透传，不能在 catch 里丢掉。
   */
  unreadableReason?: string;
}

/**
 * 运行清单的**读侧按阶段分发**（设计 §6.7.1，规格钉死、写错会锁死仓库提交）。
 *
 * 返回 null 表示可读；返回字符串表示不可读，字符串本身是原因。
 *
 * ```text
 * 审查阶段（plan / code / bug）：
 *   trivium.run.v1  → v1 校验器（历史契约，按写入时的规范解读）
 *   trivium.run.v2  → v2 校验器
 *   其余（含缺失）   → 不可读
 *
 * verify 阶段：
 *   trivium.verify-run.v1 → 照常可读
 *   trivium.run.v1        → 照常可读，且**不施加审查元数据契约校验**
 *   其余                   → 不可读
 * ```
 *
 * 两处要点，都不是随手写的：
 *
 * **一、审查阶段的兜底从「放过」改成「不可读」（§2.4 的收严）。** 旧实现是
 * `schema === 'trivium.run.v1' && 校验不过` 才判坏——`schema` 一旦不是那个字面量，
 * 第一个合取项即为 false，整个校验被跳过、`artifacts` 原样进清单。而这份清单正是
 * 提交完整性锚的消费对象：**把 schema 改成任意别的字符串，清单就脱离了契约校验**。
 * 那是个伪造通道，不是宽容。升 v2 后若沿用 `if (v1) … else …` 的形态还会放大它。
 *
 * **二、verify 阶段的 `run.v1` 不走审查校验器。** 这不是宽容，是按写入时的规范
 * 解读留痕（P6「只追加不覆盖」的同一立场）：`verify` 本就不是一次审查运行，
 * 早期落盘的记录违反 `stage` 枚举、缺大量必填字段。本仓库归档中**每一份** verify
 * 运行留痕都命中本规则（绝大多数是 `verify-run.v1`，另有历史遗留的 `run.v1`），
 * 且**每跑一次 `verify` 就多一份**——所以这里不写具体数量：写死的计数必然过期，
 * 而分支按形状分发、与数量无关（审查意见 GLM-04：原注释写「5 份」，实测已是 6 份）。
 * 按无分支的字面规则实现会把它们全判不可读，而 `hooks.ts` 的 `checkRunManifests`
 * 见 unreadable 即 `EXIT.GATE_BLOCK`——**此后每一次 `git commit` 都会被拦死，
 * 且无法通过改代码之外的任何手段解除。**
 */
export function runManifestProblem(
  stage: StageOrVerify,
  meta: { schema?: string },
): string | null {
  if (stage === 'verify') {
    if (meta.schema === 'trivium.verify-run.v1') return null;
    // 历史形状：可读，但不施加审查元数据契约校验
    if (meta.schema === 'trivium.run.v1') return null;
    return `verify 阶段不认识的 schema：${JSON.stringify(meta.schema)}`;
  }
  if (meta.schema === 'trivium.run.v2') {
    const problems = validateRunMeta(meta);
    return problems.length > 0 ? `不符合 trivium.run.v2：${problems.join('；')}` : null;
  }
  if (meta.schema === 'trivium.run.v1') {
    const problems = validateRunMetaV1(meta);
    return problems.length > 0 ? `不符合 trivium.run.v1：${problems.join('；')}` : null;
  }
  return `不认识的 schema：${JSON.stringify(meta.schema)}`;
}

export async function listRecordedRuns(layout: ArchiveLayout): Promise<RecordedRun[]> {
  const out: RecordedRun[] = [];
  // 'verify' 也要在内：验证记录是 AC-10 的对账凭证，不该逃过留痕核对（GLM-r2-08）
  for (const stage of ['plan', 'code', 'bug', 'verify'] as StageOrVerify[]) {
    const dir = metaDir(layout, stage);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files.sort()) {
      const m = /^run-(.+)\.json$/.exec(f);
      if (!m) continue;
      try {
        const meta = JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as {
          schema?: string; run_id?: string; status?: string; skipped?: boolean;
          artifacts?: { path: string; sha256: string }[];
        };
        const bad = runManifestProblem(stage, meta);
        if (bad) throw new Error(bad);
        out.push({
          run_id: meta.run_id ?? m[1]!,
          stage,
          artifacts: meta.artifacts ?? [],
          status: meta.status ?? 'unknown',
          ...(meta.skipped !== undefined ? { skipped: meta.skipped } : {}),
        });
      } catch (e) {
        /*
         * 读不出来的 run.json **不能静默跳过**（审查意见 GLM-r2-03）。
         * 跳过等于「搅坏清单即可让核对失去对象」——而清单本身就是被保护的东西。
         * 记成 unreadable，交给调用方按违例处理。
         *
         * **原因要带上**（审查意见 GLM-03）：这里的异常有两种来源，
         * `JSON.parse` 抛的（文件真坏了）与 `runManifestProblem` 抛的（契约不认），
         * 排障动作完全不同。丢掉原因就只能靠调用方猜，而它猜的那句「解析失败」
         * 对后一种是错的。
         */
        out.push({
          run_id: m[1]!, stage, artifacts: [], status: 'unreadable', unreadable: true,
          unreadableReason: (e as Error).message,
        });
      }
    }
  }
  return out;
}

/**
 * 以 `task.json.runs[]` 为**外部锚**核对运行清单是否完整（审查意见 GLM-r2-03 ≡ AGY-04）。
 *
 * 原先的核对只枚举各阶段 `_meta/` 下的 `run-*.json` 并比对它们记录的工件——
 * 也就是说，**清单来自被核对对象自身**。于是三条路径都能整枝绕过：
 *   · 删掉 `run-<id>.json`（连同那份不顺眼的审查文档一起删）；
 *   · 把 `run-<id>.json` 搅坏（旧实现静默跳过）；
 *   · 删掉整个主题目录、或把它改名成 `_`/`.` 前缀（`listTopics` 会过滤掉）。
 *
 * `task.json` 在每次 `registerRun` 时登记 run 指针，是现成的外部锚：
 * 它记过的 run，其 `run-<id>.json` 就必须在、且必须可读。
 */
export async function checkRunManifests(
  layout: ArchiveLayout,
  registered: { run_id: string; stage: StageOrVerify }[],
  present: RecordedRun[],
): Promise<TamperedArtifact[]> {
  /*
   * 按 `run_id + stage` 双键匹配（审查意见 GLM-08）。
   * 只按 run_id 的话，把 `run-<id>.json` 从 plan/_meta 挪到 bug/_meta 照样命中，
   * 期望路径与实际位置对不上却无人发现。
   */
  const byKey = new Map(present.map((r) => [`${r.stage}/${r.run_id}`, r]));
  const out: TamperedArtifact[] = [];

  for (const reg of registered) {
    const got = byKey.get(`${reg.stage}/${reg.run_id}`);
    const rel = path.join(layout.topic, reg.stage, '_meta', runMetaFileNameOf(reg.run_id));
    if (!got) {
      out.push({
        relPath: rel, kind: 'manifest_missing',
        runId: reg.run_id, stage: reg.stage, recordedSha256: '',
      });
    } else if (got.unreadable) {
      out.push({
        relPath: rel, kind: 'manifest_unreadable',
        runId: reg.run_id, stage: reg.stage, recordedSha256: '',
        ...(got.unreadableReason ? { reason: got.unreadableReason } : {}),
      });
    }
  }
  return out;
}

const runMetaFileNameOf = (runId: string): string => `run-${runId}.json`;
