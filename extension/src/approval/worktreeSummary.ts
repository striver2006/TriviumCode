/**
 * 提示性工作树摘要（FR-9，计划 r2 §D3；纯函数 + 注入 runner）。
 *
 * 数据源：只读 `git status --porcelain=v1 -z --untracked-files=all`（提示性口径，
 * **相对 HEAD**——看不见闸门期已提交的改动；权威口径是批准时 approve --json 输出的
 * worktree_summary，基线为审查收尾 tree）。
 * 展示过滤：按编排器 diffExcludePrefixes 同语义剔除 `.reviews/`、`.trivium/`、`.git/`
 * 前缀（AGY-05：审查工件落盘不该被当成业务改动误报）。
 * 纯只读查询：无锁、无索引写（编排器摘要的 write-tree/临时索引机制**不**在插件侧模仿）。
 */
export interface WorktreeHint {
  available: boolean;
  reason: string | null;
  total: number;
  files: Array<{ status: string; path: string }>;
}

/** 编排器系统保留前缀（worktree-summary.ts diffExcludePrefixes 的展示层等价集） */
export const EXCLUDED_PREFIXES = ['.reviews/', '.trivium/', '.git/'];

/** porcelain=v1 -z 输出解析（NUL 分隔；重命名条目是 `XY new\0old` 双段） */
export function parsePorcelainZ(raw: string): Array<{ status: string; path: string }> {
  const out: Array<{ status: string; path: string }> = [];
  const segs = raw.split('\0');
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i] ?? '';
    if (seg === '') continue;
    const xy = seg.slice(0, 2);
    const p = seg.slice(3);
    if (p === '') continue;
    out.push({ status: xy, path: p });
    // 跳过原路径段（重命名/复制的 XY 任一位是 R/C——含工作树未暂存重命名 ' R'，r5 AGY-02）
    if (xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C') i += 1;
  }
  return out;
}

/** 前缀过滤（含目录自身形态，如 `.reviews` 无斜杠时也视为前缀匹配） */
export function filterExcluded(entries: Array<{ status: string; path: string }>, prefixes: string[] = EXCLUDED_PREFIXES): Array<{ status: string; path: string }> {
  return entries.filter((e) => {
    for (const p of prefixes) {
      const bare = p.endsWith('/') ? p.slice(0, -1) : p;
      if (e.path === bare || e.path.startsWith(p)) return false;
    }
    return true;
  });
}

/** 状态码 → 中文标签（展示层；AGY-05：' M'（未暂存修改）首位是空格，须看 y 位） */
export function statusText(xy: string): string {
  const map: Record<string, string> = { M: '修改', A: '新增', D: '删除', R: '重命名', C: '复制', '?': '未跟踪', '!': '忽略', U: '冲突' };
  if (xy.startsWith('??')) return '未跟踪';
  if (xy.startsWith('!!')) return '忽略';
  const x = xy[0] ?? '?';
  const y = xy[1] ?? '';
  return map[x] ?? map[y] ?? xy;
}

/** 注入的 git runner（spawn 'git' …的宿主侧包装；测试注入桩） */
export type GitRunner = (args: string[], timeoutMs: number) => Promise<{ code: number | null; stdout: string; stderr: string }>;

export async function summarizeWorktreeHint(run: GitRunner, limit = 50): Promise<WorktreeHint> {
  let r: { code: number | null; stdout: string; stderr: string };
  try {
    r = await run(['status', '--porcelain=v1', '-z', '--untracked-files=all'], 5_000);
  } catch (e) {
    return { available: false, reason: `git 调用失败：${e instanceof Error ? e.message : String(e)}`, total: 0, files: [] };
  }
  if (r.code !== 0) {
    return { available: false, reason: `git status 退出码 ${r.code}（非 git 仓库或 git 不可用）`, total: 0, files: [] };
  }
  const files = filterExcluded(parsePorcelainZ(r.stdout)).sort((a, b) => a.path.localeCompare(b.path));
  return { available: true, reason: null, total: files.length, files: files.slice(0, limit) };
}

/** 权威摘要（approve 输出的 worktree_summary 单阶段条目）→ 展示行集 */
export function authoritativeFiles(s: { available: boolean; reason: string | null; total: number; truncated: boolean; files: Array<{ status: string; path: string }> } | undefined | null): { kind: 'ok'; total: number; truncated: boolean; files: Array<{ status: string; path: string }> } | { kind: 'unavailable'; reason: string } | null {
  if (!s) return null;
  if (!s.available) return { kind: 'unavailable', reason: s.reason ?? '编排器未能计算摘要（如实呈现，不伪造空清单）' };
  return { kind: 'ok', total: s.total, truncated: s.truncated, files: s.files ?? [] };
}
