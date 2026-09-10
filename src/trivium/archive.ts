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
import type { CriticId, Stage, StageOrVerify } from './types.js';
import {
  buildArtifactName,
  buildVerifyName,
  localDate,
  looksLikeRoleArtifact,
  parseArtifactName,
  roleIsAllowedForWriter,
  type ArtifactName,
  type DispositionKind,
  type Role,
} from './naming.js';
import { assertNoSecrets } from './secrets.js';
import { createExclusive, ensureDir, sha256, writeAtomic } from './util/fsx.js';

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
 * **只看审查工件**（`-gemini.md` / `-glm.md`），不看 Driver 的原稿。
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
export async function resolveRerunIndex(l: ArchiveLayout, stage: Stage): Promise<number> {
  const items = await listStageArtifacts(l, stage);
  let max = 0;
  for (const i of items) {
    if (i.parsed.role === 'claude') continue; // 原稿与裁决件不决定轮次
    if (i.parsed.rerunIndex > max) max = i.parsed.rerunIndex;
  }
  return max + 1;
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
  opts: { scanSecrets?: boolean } = {},
): Promise<{ absPath: string; relPath: string; sha256: string }> {
  if (looksLikeRoleArtifact(fileName)) {
    throw new Error(
      `_meta/ 内不得出现以 -claude/-gemini/-glm.md 结尾的文件名（收到 ${fileName}）：` +
        `会与 AC-07 的角色后缀检查器混淆（设计 §6.2）`,
    );
  }
  const dir = metaDir(layout, stage);
  await ensureDir(dir);
  if (opts.scanSecrets !== false) {
    assertNoSecrets(content, `${layout.topic}/${stage}/_meta/${fileName}`);
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
  // code 阶段的被审对象是 diff 而非文档，因此没有 -claude.md 原稿
  if (stage === 'plan' || stage === 'bug') {
    required.push({ label: '原稿 …-claude.md（任一轮次）', ok: hasAnyRound('claude', null) });
  }
  required.push({ label: '审查 …-gemini.md', ok: hasThisRound('gemini', null) });
  required.push({ label: '审查 …-glm.md', ok: hasThisRound('glm', null) });
  const kind: DispositionKind = stage === 'code' ? 'response' : 'revised';
  required.push({ label: `裁决件 …-${kind}-claude.md`, ok: hasThisRound('claude', kind) });

  return {
    ok: required.every((r) => r.ok),
    missing: required.filter((r) => !r.ok).map((r) => r.label),
    present: required.filter((r) => r.ok).map((r) => r.label),
  };
}
