/**
 * `_meta/` 运行元数据只读解析（FR-8 数据源，计划 r2 §D1/§D6）。
 *
 * 三件事（全部只读派生，正确性由编排器 `gate --check` 兜底）：
 * - 当轮 Driver id 定位链：`run-<runId>.json`.driver（run 权威）→ task.json
 *   drivers[stage]（阶段认领声明，受限 fallback）→ 闸门 gates[].driver（仅展示比对，不采信）；
 * - addresses 期望集：从 `run-<runId>.json`.artifacts[] 派生（对齐 gate.ts expectedReviewDocs
 *   的判据：阶段根、非裁决件、后缀属有效侧；**不做日期拼名**——跨零点与撞名抬升会改实际落盘名）；
 * - fallback 期望编号：`review-<critic>-<runId>.fallback-items.md` 每行 `- <前缀>-F<n>: …`
 *   （missing_disposition 提前返回时 gate 的 fallback_ids 恒空，不能用）。
 */
import path from 'node:path';

/** 注入的文件系统面（与 runHistory.FsApi 同形） */
export interface RunMetaFs {
  readFile(p: string): Promise<string>;
}

export interface RunMetaInfo {
  runId: string;
  driver: string | null;
  rerunIndex: number | null;
  criticsSelected: string[];
  /** 逐侧运行状态（critics.<c>.status）；缺省空对象 */
  criticStatus: Record<string, string>;
  /** artifacts[] 的登记路径（`<主题>/<阶段>/<文件名>` 或含 `_meta/` 前缀） */
  artifacts: string[];
}

interface RunMetaJson {
  driver?: string;
  rerun_index?: number;
  critics_selected?: string[];
  critics?: Record<string, { status?: string }>;
  artifacts?: Array<{ path?: string } | string>;
}

/** 意见编号前缀 → critic agent id。**边界如实标注（r4 CLAUDE-05）**：与主仓
 * src/trivium/agents/registry.ts 的 findingPrefix 同源，但插件集成面（CLI + 文件面）
 * 不 import 主仓 src——这里是登记处的**镜像副本**，新增/调整 Agent 时需人工同步
 * 此表与下方单测的锁定集；未登记前缀返回 null（展示「—」，不猜）。 */
const PREFIX_TO_CRITIC: Record<string, string> = {
  CLAUDE: 'claude',
  CODEX: 'codex',
  AGY: 'gemini',
  GLM: 'glm',
};

/** `<前缀>[-rN]-NN` / `<前缀>-F<n>` → 前缀段 */
export function criticOfId(id: string): string | null {
  const m = /^([A-Z][A-Z0-9]{1,15})-(?:r\d+-)?(?:F)?\d+/i.exec(id.trim());
  return m ? (PREFIX_TO_CRITIC[m[1]!.toUpperCase()] ?? null) : null;
}

/** fallback 编号（`<前缀>-F<n>`）判定——行级落点要求的例外类（checkRow 第二参数） */
export function isFallbackId(id: string): boolean {
  return /-F\d+$/i.test(id.trim());
}

/** 读 `_meta/run-<runId>.json`；读不出/坏 JSON 返回 null（调用方明示降级，不猜） */
export async function readRunMeta(fs: RunMetaFs, metaDir: string, runId: string): Promise<RunMetaInfo | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(metaDir, `run-${runId}.json`));
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  // 根形状防御（r2 CLAUDE-07）：合法 JSON null/标量/数组不做类型断言直读——一律 null
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const obj = parsed as RunMetaJson;
  if (obj.critics !== undefined && (typeof obj.critics !== 'object' || Array.isArray(obj.critics))) return null;
  if (obj.artifacts !== undefined && !Array.isArray(obj.artifacts)) return null;
  const criticStatus: Record<string, string> = {};
  for (const [c, v] of Object.entries(obj.critics ?? {})) {
    if (v && typeof v === 'object' && typeof v.status === 'string') criticStatus[c] = v.status;
  }
  return {
    runId,
    driver: typeof obj.driver === 'string' && obj.driver.length > 0 ? obj.driver : null,
    rerunIndex: typeof obj.rerun_index === 'number' ? obj.rerun_index : null,
    criticsSelected: Array.isArray(obj.critics_selected) ? obj.critics_selected.filter((c) => typeof c === 'string') : [],
    criticStatus,
    artifacts: (Array.isArray(obj.artifacts) ? obj.artifacts : [])
      .map((a) => (typeof a === 'string' ? a : a && typeof a === 'object' && typeof a.path === 'string' ? a.path : null))
      .filter((p): p is string => p !== null),
  };
}

/**
 * addresses 期望集（对齐 gate.ts expectedReviewDocs 的只读派生，非校验复制）：
 * 有效侧 = critics_selected 里 critics.<c>.status ∈ {ok, parse_fallback}；
 * 条目筛选 = 相对路径位于 `<主题>/<阶段>/` 根（排除 `_meta/` 子目录）、文件名不是裁决件
 * （`-(rN-)?(revised|response)-<后缀>.md`）、后缀属于有效侧 agent id。
 */
export function expectedAddresses(meta: RunMetaInfo, topic: string, stage: string): string[] {
  const selected = meta.criticsSelected.length > 0 ? meta.criticsSelected : [];
  const effective = new Set(selected.filter((c) => {
    const s = meta.criticStatus[c];
    return s === 'ok' || s === 'parse_fallback';
  }));
  const stageRel = `${topic}/${stage}`;
  const out: string[] = [];
  for (const a of meta.artifacts) {
    const rel = a.split(path.sep).join('/');
    const dir = rel.slice(0, rel.lastIndexOf('/'));
    if (dir !== stageRel) continue;
    const base = rel.slice(rel.lastIndexOf('/') + 1);
    if (!base.endsWith('.md')) continue;
    // 裁决件：`-revised-` / `-response-`（可带 -rN 抬升）不进 addresses
    if (/-(?:r\d+-)?(?:revised|response)-[^/]+\.md$/.test(base)) continue;
    // 后缀（最后一个 `-` 段去掉 .md）须属有效侧
    const m = /^[\s\S]*-([A-Za-z0-9]+)\.md$/.exec(base);
    if (!m || !effective.has(m[1]!)) continue;
    if (!out.includes(base)) out.push(base);
  }
  return out;
}

/** 解析 `.fallback-items.md`（每行 `- <前缀>-F<n>: …`）；文件缺失/坏行返回空集 */
export async function readFallbackIds(fs: RunMetaFs, metaDir: string, critic: string, runId: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(metaDir, `review-${critic}-${runId}.fallback-items.md`));
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const line of raw.split('\n')) {
    const m = /^\s*-\s+([A-Z][A-Z0-9]{1,15}-(?:r\d+-)?F\d+)\s*:/.exec(line);
    if (m && !ids.includes(m[1]!)) ids.push(m[1]!);
  }
  return ids;
}

/** 全部有效侧的 fallback 期望编号并集（r3 CLAUDE-04：只认 parse_fallback 侧——
 * failed 侧无清单语义；gate 会用当前解析器重试 parse_fallback 原文，重试成功的侧
 * 其结构化编号已在 gate 输出里，F 行若被复检判 unknown 由裁决台的删除语义收口） */
export async function allFallbackIds(fs: RunMetaFs, meta: RunMetaInfo, metaDir: string): Promise<string[]> {
  const out: string[] = [];
  for (const c of meta.criticsSelected) {
    if (meta.criticStatus[c] !== 'parse_fallback') continue;
    for (const id of await readFallbackIds(fs, metaDir, c, meta.runId)) {
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}

/** task.json 的 drivers 段（受限 fallback 源：阶段认领声明，非逐 run 身份） */
export async function readClaimedDriver(fs: RunMetaFs, reviewsRoot: string, topic: string, stage: string): Promise<string | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path.join(reviewsRoot, topic, 'task.json'));
  } catch {
    return null;
  }
  try {
    const obj = JSON.parse(raw) as { drivers?: Record<string, { driver?: string }> };
    const d = obj.drivers?.[stage]?.driver;
    return typeof d === 'string' && d.length > 0 ? d : null;
  } catch {
    return null;
  }
}

/**
 * 当轮 Driver id 定位链（计划 r2 §D6）：run 元数据 → 阶段认领声明。
 * 闸门项 driver **不进链**（state.ts 只在 awaiting_approval 迁移时写入，raf 阶段沿用旧值）。
 * 返回带来源标注，供 UI 展示核对；两级都缺返回 null（调用方禁用草稿生成，不猜）。
 */
export async function resolveDriverId(
  fs: RunMetaFs,
  meta: RunMetaInfo | null,
  reviewsRoot: string,
  topic: string,
  stage: string,
): Promise<{ driver: string; source: 'run-meta' | 'stage-claim' } | null> {
  if (meta?.driver) return { driver: meta.driver, source: 'run-meta' };
  const claimed = await readClaimedDriver(fs, reviewsRoot, topic, stage);
  if (claimed) return { driver: claimed, source: 'stage-claim' };
  return null;
}
