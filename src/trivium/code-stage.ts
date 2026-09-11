/**
 * `code` 阶段特有的两件事：被审补丁的冻结（§9.2）与纯文档跳过判定（§6.4 / FR-23）。
 *
 * `plan` / `bug` 的被审对象是一份现成的 Markdown 原稿，`code` 没有——它的被审对象
 * 是**一段变更**。所以要先把变更物化成 `code/_meta/changes.diff`，
 * 其 sha256 即 `subject_sha256`，后续漂移检测与 brief 引用都以它为准。
 */
import path from 'node:path';
import { matchesAnyGlob } from './util/fsx.js';
import { unquoteGitPath } from './util/git.js';
import type { Config } from './types.js';

/** 冻结后的补丁 */
export interface FrozenDiff {
  /** `code/_meta/changes.diff` 的绝对路径——它就是 subject_path */
  path: string;
  sha256: string;
  /** diff 涉及的项目相对路径 */
  files: string[];
  base: string;
  head: string | null;
  /** 补丁正文字节数，用于在 brief 里给出规模提示 */
  bytes: number;
}

/**
 * 从统一 diff 里抽出涉及的文件路径。
 *
 * 只认 `diff --git a/X b/X` 行：`+++ b/X` 会把 `/dev/null` 也算进来，
 * 而重命名的 diff 头里 a/ 与 b/ 路径不同，两侧都要收。
 */
export function filesInDiff(diff: string): string[] {
  const out = new Set<string>();
  for (const line of diff.split('\n')) {
    if (!line.startsWith('diff --git ')) continue;
    const rest = line.slice('diff --git '.length);

    /*
     * 路径可能被引号包起来（审查意见 GLM-r2-06）。
     *
     * `core.quotePath=false` 只解决「可打印非 ASCII 被转成八进制」；路径含空格、
     * 双引号、反斜杠或控制字符时 git **仍会**引起来。旧正则只认未加引号的形态，
     * 这类文件会**从清单里消失**——而 `classifyDiff` 正是拿这份清单做 FR-23 判定：
     * 一份「文档 + 引号路径业务文件」的 diff 会被判成 doc_only，
     * 开了 skip_doc_only_review 时那个业务变更整只逃过审查。
     * 方向性极差：错在漏审而非多审。
     */
    const pair = splitDiffGitPaths(rest);
    if (!pair) continue;
    out.add(stripPrefix(pair[0], 'a/'));
    out.add(stripPrefix(pair[1], 'b/'));
  }
  // /dev/null 只会出现在 ---/+++ 行，这里不会混进来，但新增文件的 a/ 侧是同名路径
  return [...out].sort();
}

/** 把 `a/X b/Y` 拆成两段，两侧都可能带引号 */
function splitDiffGitPaths(rest: string): [string, string] | null {
  if (rest.startsWith('"')) {
    // 引号形态：`"a/含 空格.ts" "b/含 空格.ts"` 或 `"a/x" b/y`
    const end = findClosingQuote(rest, 0);
    if (end === -1) return null;
    const left = unquoteGitPath(rest.slice(0, end + 1));
    const right = rest.slice(end + 1).trim();
    return [left, right.startsWith('"') ? unquoteGitPath(right) : right];
  }
  // 未加引号：右侧若带引号，以 ` "b/` 为界；否则按 ` b/` 拆
  const quotedRight = rest.indexOf(' "b/');
  if (quotedRight !== -1) {
    return [rest.slice(0, quotedRight), unquoteGitPath(rest.slice(quotedRight + 1))];
  }
  const m = /^(a\/.+?) (b\/.+)$/.exec(rest);
  return m ? [m[1]!, m[2]!] : null;
}

/** 找到从 `from` 起那个双引号字符串的收尾引号下标（跳过 \" 转义） */
function findClosingQuote(s: string, from: number): number {
  for (let i = from + 1; i < s.length; i++) {
    if (s[i] === '\\') {
      i++;
      continue;
    }
    if (s[i] === '"') return i;
  }
  return -1;
}

const stripPrefix = (p: string, prefix: string): string =>
  p.startsWith(prefix) ? p.slice(prefix.length) : p;

/**
 * 被审补丁必须无条件剔除的项目内路径。
 *
 * 归档根尤其关键：`.reviews/` 是刻意纳入版本管理的，对方的审查产出刚落盘还没
 * commit 时处于未跟踪状态，若被收进补丁就会经**被审对象本身**递给审查员——
 * BRIEF 禁读清单、CLI 路径 deny、事后轨迹核验三道全被绕过。
 * 这不能靠用户的 `.gitignore` 保障，必须在生成补丁时就排除。
 */
export function diffExcludePrefixes(archiveRootRel: string): string[] {
  const out = new Set<string>(['.trivium', '.git']);
  const rel = archiveRootRel.replace(/^\.\//, '').replace(/\/+$/, '');
  if (rel && !rel.startsWith('..')) out.add(rel);
  return [...out];
}

/**
 * 补丁头部：base / head 与文件清单。
 *
 * 审查员拿到的是一份**离线**补丁。没有这几行它就无法判断「这段 diff 相对什么」，
 * 事后复核也无从确认补丁与仓库状态的对应关系（AC-17）。
 */
export function buildDiffHeader(i: {
  runId: string;
  base: string;
  head: string | null;
  files: readonly string[];
}): string {
  return [
    '# trivium changes.diff',
    `# run_id: ${i.runId}`,
    `# base: ${i.base}`,
    `# head: ${i.head ?? '(无 HEAD，空仓库)'}`,
    `# files: ${i.files.length}`,
    ...i.files.map((f) => `#   ${f}`),
    '',
  ].join('\n');
}

// ───────────────────── FR-23 路径分类 ─────────────────────

export type DiffCategory = 'doc_only' | 'business' | 'dependency' | 'ci_or_permission';

export interface SkipVerdict {
  /** 是否**可以**跳过。注意「可以」不等于「已经」——还要看 skip_doc_only_review */
  skippable: boolean;
  /** 最终是否跳过 */
  skipped: boolean;
  category: DiffCategory;
  /** 判定依据，逐条写进 run.json，供人复核 */
  reasons: string[];
  /** 命中 never_skip_globs 的路径 */
  neverSkipHits: string[];
  /** 未匹配 skip_globs 的路径 */
  nonDocPaths: string[];
  /** diff 涉及的全部路径。带上它，判定结果才自解释——渲染与落盘都不必再传一遍 */
  files: string[];
}

/** 依赖清单（锁文件除外——锁文件变更由依赖清单变更带出，单独审无意义） */
const DEPENDENCY_FILES = [
  'package.json',
  'pubspec.yaml',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'Gemfile',
  'build.gradle',
  'pom.xml',
];
const LOCK_FILES = /(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock|Gemfile\.lock|pubspec\.lock|go\.sum)$/;

const isDependencyManifest = (rel: string): boolean => {
  const base = path.basename(rel);
  if (LOCK_FILES.test(base)) return false;
  if (DEPENDENCY_FILES.includes(base)) return true;
  return /^requirements.*\.txt$/.test(base);
};

/**
 * 判定这次 diff 能否跳过代码审。
 *
 * **判定由程序做，不由模型做**（§6.4 的原话）——把「这算不算纯文档」交给模型
 * 等于把跳过审查的权力交给被审方。
 *
 * 一期只做路径判定。「仅注释/格式变化」需要语言感知，属二期；
 * 因此一个只改了注释的 `.ts` 文件**不会**被跳过——宁可多审一次。
 */
export function classifyDiff(cfg: Config, files: readonly string[]): SkipVerdict {
  const reasons: string[] = [];
  const neverSkipHits = files.filter((f) => matchesAnyGlob(f, cfg.review.never_skip_globs));
  const nonDocPaths = files.filter((f) => !matchesAnyGlob(f, cfg.review.skip_globs));
  const dependencyHits = files.filter(isDependencyManifest);

  /*
   * 分类顺序按「更具体者优先」，而不是按 never_skip_globs 是否命中。
   *
   * 默认的 never_skip_globs 本身就包含 package.json / pubspec.yaml 等依赖清单，
   * 若先判它，依赖清单永远会被标成 `ci_or_permission`——两者都不可跳过，结果不变，
   * 但类别就与 §6.4 表格的两行分类对不上了，复盘时看到的原因也是错的。
   * 所以：命中 never_skip 且是依赖清单 → 依赖类；命中 never_skip 是别的原因 → CI/权限类。
   */
  const nonDependencyNeverSkip = neverSkipHits.filter((f) => !isDependencyManifest(f));

  let category: DiffCategory = 'business';
  if (neverSkipHits.length > 0) {
    reasons.push(`命中 never_skip_globs：${neverSkipHits.join('、')}`);
  }
  if (nonDependencyNeverSkip.length > 0) {
    category = 'ci_or_permission';
    reasons.push(`其中属 CI / 权限 / 运行时配置：${nonDependencyNeverSkip.join('、')}`);
  } else if (dependencyHits.length > 0) {
    category = 'dependency';
    reasons.push(`涉及依赖清单（锁文件不计）：${dependencyHits.join('、')}`);
  } else if (nonDocPaths.length === 0) {
    category = 'doc_only';
    reasons.push(`全部 ${files.length} 个路径均匹配 skip_globs：${cfg.review.skip_globs.join('、')}`);
  } else {
    reasons.push(`存在非文档路径：${nonDocPaths.slice(0, 10).join('、')}${nonDocPaths.length > 10 ? ` 等 ${nonDocPaths.length} 个` : ''}`);
  }

  const skippable = category === 'doc_only';
  const skipped = skippable && cfg.review.skip_doc_only_review;
  if (skippable && !skipped) {
    reasons.push('可跳过，但 review.skip_doc_only_review 为 false，仍照常送审');
  }
  return { skippable, skipped, category, reasons, neverSkipHits, nonDocPaths, files: [...files] };
}

/** 跳过时的人读说明。**绝不**因跳过而生成任何伪造的审查文档（§6.4 末句） */
export function renderSkipNotice(v: SkipVerdict): string {
  return [
    `本次代码审已跳过：判定为纯文档变更（${v.files.length} 个路径）。`,
    ...v.reasons.map((r) => `  · ${r}`),
    '  已在 run.json 记 skipped: true 与命中规则；**未**生成任何审查文档——',
    '  跳过就是跳过，不会伪造两份「无问题」的结论。',
    '  若需强制送审，把 review.skip_doc_only_review 置为 false 后重跑。',
  ].join('\n');
}

/** 供 brief 引用：补丁的规模摘要 */
export function summarizeDiff(d: FrozenDiff): string {
  const kb = (d.bytes / 1024).toFixed(1);
  return `相对 ${d.base}（HEAD ${d.head?.slice(0, 8) ?? '—'}）的 ${d.files.length} 个文件变更，补丁 ${kb} KB`;
}
