/**
 * 审批时的工作树改动摘要（EV-132 候选 ② 折中版；计划 `.reviews/审批前工作树摘要/plan/` r2）。
 *
 * ## 它是什么、不是什么
 *
 * 闸门期（等人工审批时）改业务文件，审批前复核看不见——它只核裁决与本轮审查工件，不看工作树
 * （M10b 第 4 步 3-4 实测：闸门期在终端改 `NOTES.md`，`approve` 仍退 0）。用户定的折中是：
 * **审批时把「自审查收尾以来工作树变了什么」打印出来，由审批人自己判断**。
 *
 * 所以这里**只告知**：不改退出码、不改闸门迁移、不进任何判定。调用点（`cli.ts` 三个出口）
 * 各包一层隔离块，这里自身也不抛错——任何失败都转成 `available: false` 加四种原因之一。
 *
 * ## 基线
 *
 * 取 `run.json.snapshot.after_tree_hash`：审查收尾复算漂移时的工作树 tree（`review.ts` 同一处落盘）。
 * 当前树用同一个 `workTreeHash` 算，于是两边同法、结果只取决于工作树内容——**闸门期提交过的改动同样列出**
 * （相对 HEAD 的 `git status` 看不见它们，这是没选它的理由）。字段缺席时不回落到送审快照 `tree_hash`。
 *
 * ## 盲区（如实写进每次摘要的范围行，不说「未发现越界」）
 *
 * - 被 `.gitignore` 忽略的文件看不见（`add -A` 不收它们）；
 * - 改了又改回的文件，tree 相同，不会列出；
 * - 基线是 `write-tree` 写出的不可达对象，可能被 git 清理——取不到时如实报原因 2，**绝不报「无改动」**。
 *   为此比对用 `diffTreesNameStatus`（失败即抛），不用 `diffTrees`（失败返回 `[]`）。
 */
import { entryCommandOf } from './agents/registry.js';
import { diffExcludePrefixes } from './code-stage.js';
import { OBJECT_NAME_RE, diffTreesNameStatus, treeExists, workTreeHash } from './util/git.js';
import { shellQuoteArg } from './naming.js';

/** 摘要总预算（计划双审 CODEX-02）：超出即落原因 4，审批照常 */
export const SUMMARY_BUDGET_MS = 20_000;
/** JSON 里 `files` 的条数上限（CODEX-04）；全量走照抄命令 */
export const SUMMARY_JSON_LIMIT = 200;
/** 人读列出的条数上限 */
export const SUMMARY_TEXT_LIMIT = 20;
/**
 * 测试专用：覆盖摘要总预算（毫秒，正整数）。与 `TRIVIUM_STUB_CRITIC` 同一种注入惯例；
 * 缺席或不合法时用 {@link SUMMARY_BUDGET_MS}。它只能把预算改小改大，不能让摘要影响审批。
 *
 * **生效即自我暴露**（代码双审 r1 CODEX-02）：同族的 `TRIVIUM_STUB_CRITIC` 生效时会醒目告警、指纹入档；
 * 这里若不留痕，Driver 在 Bash 里加一个环境前缀就能让每次摘要都报「超时」，与慢仓库的真实超时逐字相同。
 * 所以覆盖生效时，人读输出追加 {@link budgetOverrideNote}，JSON 带 `budget_overridden: true`。
 */
export const SUMMARY_BUDGET_ENV = 'TRIVIUM_TEST_SUMMARY_BUDGET_MS';

export interface BudgetSetting {
  ms: number;
  /** 是否被 {@link SUMMARY_BUDGET_ENV} 覆盖 */
  overridden: boolean;
}

/** 取本次生效的预算与来源：环境变量为正整数时用它，否则用缺省 */
export function summaryBudget(env: NodeJS.ProcessEnv = process.env): BudgetSetting {
  const raw = env[SUMMARY_BUDGET_ENV];
  if (raw && /^\d+$/.test(raw) && Number(raw) > 0) return { ms: Number(raw), overridden: true };
  return { ms: SUMMARY_BUDGET_MS, overridden: false };
}

/** 预算被环境变量覆盖时追加的那一句 */
export function budgetOverrideNote(ms: number): string {
  return `预算被 ${SUMMARY_BUDGET_ENV} 覆盖为 ${ms} 毫秒，这只应出现在测试里。`;
}

/**
 * 基线对象名的形状闸（代码双审 r1 CODEX-01 ≡ GLM-01）：只收 sha1（40 位）或 sha256（64 位）十六进制。
 *
 * 基线取自 run.json，而审批前复核只核 `artifacts[]`、不核 run.json 本身。不设这道闸时，
 * 一个含 `;` `$(` 的合法 git 引用名能过 `cat-file -e` 与 `diff-tree`，再被拼进给人复制执行的照抄命令；
 * 以 `-` 开头的值还会被 git 当成选项。不合形状即不做任何 git 调用。
 *
 * 定义已挪到 `util/git.ts`（漂移判定同用，EV-139 计划 r2 §2.2），这里原样再导出。
 */
export { OBJECT_NAME_RE };

/** 不可用原因（计划 r2 §2.5），逐字区分，都不与「无改动」同形 */
export const REASON_NO_BASELINE = '本轮没有审查收尾时的工作树基线，无法比对。';
export const REASON_BASELINE_GONE = '基线对象已不在对象库（可能被 git 清理）。';
export const REASON_BAD_BASELINE = '基线不是合法的对象名（应为 40 或 64 位十六进制），无法比对。';
export const REASON_GIT_FAILED_PREFIX = 'git 调用失败：';
/** 不足 1 秒写毫秒，否则向上取整到秒——避免「超过 0 秒」这种字面矛盾（代码双审 r1 CODEX-02） */
export function reasonTimeout(budgetMs: number): string {
  return budgetMs < 1000
    ? `工作树摘要超时（超过 ${budgetMs} 毫秒）。`
    : `工作树摘要超时（超过 ${Math.ceil(budgetMs / 1000)} 秒）。`;
}

export interface WorkTreeSummary {
  available: boolean;
  /** 四种原因之一；available 为 true 时为 null */
  reason: string | null;
  run_id: string;
  baseline: 'review_end';
  baseline_tree: string | null;
  current_tree: string | null;
  /** 排除后的变更总数 */
  total: number;
  /** `files` 是否被 {@link SUMMARY_JSON_LIMIT} 截断 */
  truncated: boolean;
  /** 按路径排序，最多 {@link SUMMARY_JSON_LIMIT} 条 */
  files: Array<{ status: string; path: string }>;
  /** 比对时排除的路径前缀（`diffExcludePrefixes` 的结果） */
  excluded_prefixes: string[];
  /** 本次生效的总预算（毫秒） */
  budget_ms: number;
  /** 预算是否被 {@link SUMMARY_BUDGET_ENV} 覆盖 */
  budget_overridden: boolean;
}

export interface SummarizeInput {
  projectRoot: string;
  /** 归档根的项目相对路径（如 `.reviews`） */
  archiveRootRel: string;
  /** 本出口复核所用的 run id：approve 为闸门项 run_id，停点为最新一次运行 */
  runId: string;
  /** `run.json.snapshot.after_tree_hash`；缺席传 undefined */
  afterTreeHash: string | undefined;
  /** 总预算毫秒，缺省 {@link SUMMARY_BUDGET_MS} */
  budgetMs?: number;
  /** 预算是否来自 {@link SUMMARY_BUDGET_ENV}；缺省 false */
  budgetOverridden?: boolean;
}

function isTimeout(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { timedOut?: unknown }).timedOut === true;
}

function firstLine(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.trim().split('\n')[0] ?? '';
}

/**
 * 算摘要。**不抛错**：任何失败都转成 `available: false` 加原因。
 *
 * **总预算是真上界**（代码双审 r1 CODEX-03）：每一步 git 的超时取剩余预算，外面再套一道整体截止——
 * 到点即返回超时原因，不等被杀的 git 走完收尾宽限。底层 git 由各自的超时按进程组收尾（`util/git.ts`）。
 */
export async function summarizeWorkTree(i: SummarizeInput): Promise<WorkTreeSummary> {
  const budgetMs = i.budgetMs ?? SUMMARY_BUDGET_MS;
  const excluded = diffExcludePrefixes(i.archiveRootRel);
  const overridden = i.budgetOverridden ?? false;
  const base: WorkTreeSummary = {
    available: false,
    reason: null,
    run_id: i.runId,
    baseline: 'review_end',
    baseline_tree: null,
    current_tree: null,
    total: 0,
    truncated: false,
    files: [],
    excluded_prefixes: excluded,
    budget_ms: budgetMs,
    budget_overridden: overridden,
  };
  if (!i.afterTreeHash) return { ...base, reason: REASON_NO_BASELINE };
  // 形状闸在任何 git 调用之前（CODEX-01 ≡ GLM-01）；不合形状的值不回显进 baseline_tree
  if (!OBJECT_NAME_RE.test(i.afterTreeHash)) return { ...base, reason: REASON_BAD_BASELINE };
  const baseline = i.afterTreeHash;
  const withBase = { ...base, baseline_tree: baseline };
  const timeoutReason = reasonTimeout(budgetMs) + (overridden ? budgetOverrideNote(budgetMs) : '');

  const started = Date.now();
  // 每一步的 git 超时取剩余预算；预算已耗尽时给 1 ms，让那一步当场超时而不是不限时
  const remaining = (): number => Math.max(1, budgetMs - (Date.now() - started));
  const work = (async (): Promise<WorkTreeSummary> => {
    try {
      if (!(await treeExists(i.projectRoot, baseline, { timeoutMs: remaining() }))) {
        return { ...withBase, reason: REASON_BASELINE_GONE };
      }
      const current = await workTreeHash(i.projectRoot, { timeoutMs: remaining() });
      if (current === baseline) return { ...withBase, available: true, current_tree: current };

      const isOwn = (f: string): boolean => excluded.some((p) => f === p || f.startsWith(`${p}/`));
      const changed = (await diffTreesNameStatus(i.projectRoot, baseline, current, { timeoutMs: remaining() }))
        .filter((c) => !isOwn(c.path))
        .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      return {
        ...withBase,
        available: true,
        current_tree: current,
        total: changed.length,
        truncated: changed.length > SUMMARY_JSON_LIMIT,
        files: changed.slice(0, SUMMARY_JSON_LIMIT),
      };
    } catch (e) {
      if (isTimeout(e)) return { ...withBase, reason: timeoutReason };
      return { ...withBase, reason: `${REASON_GIT_FAILED_PREFIX}${firstLine(e)}` };
    }
  })();
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<WorkTreeSummary>((resolve) => {
    timer = setTimeout(() => resolve({ ...withBase, reason: timeoutReason }), budgetMs);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** 调用点隔离块捕获到的异常（如 `readRunMeta` 抛错）也转成同一形态，原因 3 */
export function unavailableSummary(
  runId: string,
  archiveRootRel: string,
  e: unknown,
  budget: BudgetSetting = { ms: SUMMARY_BUDGET_MS, overridden: false },
): WorkTreeSummary {
  return {
    available: false,
    reason: `${REASON_GIT_FAILED_PREFIX}${firstLine(e)}`,
    run_id: runId,
    baseline: 'review_end',
    baseline_tree: null,
    current_tree: null,
    total: 0,
    truncated: false,
    files: [],
    excluded_prefixes: diffExcludePrefixes(archiveRootRel),
    budget_ms: budget.ms,
    budget_overridden: budget.overridden,
  };
}

export interface RenderOptions {
  /** approval：`approve` 通过时；hold：闸门停点 */
  exit: 'approval' | 'hold';
  /** 当轮 Driver：abandon 的调用写法按它取（计划双审 AGY-01） */
  driver: string | null;
  topic: string;
  limit?: number;
}

/** 照抄命令里的单引号参数：路径里若有单引号，写成 '\'' */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * 超出人读上限时给出的完整列表命令，与摘要同口径（排除前缀、quotePath）——计划双审 CODEX-07。
 * 两个 tree 值同样加引号（代码双审 r1 CODEX-01 ≡ GLM-01）：形状闸之外再加一层纯防御，对合法哈希无副作用。
 */
export function fullListCommand(s: WorkTreeSummary): string {
  const excludes = s.excluded_prefixes.map((p) => shQuote(`:(exclude)${p}`)).join(' ');
  return `git -c core.quotePath=false diff-tree -r --name-status ${shQuote(s.baseline_tree ?? '')} ${shQuote(s.current_tree ?? '')} -- . ${excludes}`;
}

/**
 * 渲染人读摘要。不可用时返回的整段以「⚠️」起头，由调用点走 `warn`（stderr）；其余走 `say`。
 * 返回 `{ text, warning }`，调用点据 `warning` 选输出通道。
 */
export function renderWorkTreeSummary(s: WorkTreeSummary, opts: RenderOptions): { text: string; warning: boolean } {
  const override = s.budget_overridden ? budgetOverrideNote(s.budget_ms) : '';
  if (!s.available) {
    const tail = opts.exit === 'approval' ? '这不影响审批' : '这不影响停点';
    // 原因 3 拼的是异常首行，通常不带句号（代码双审 r1 AGY-01）
    const raw = s.reason ?? '原因未知。';
    const reason = raw.endsWith('。') ? raw : `${raw}。`;
    const note = override && !reason.includes(override) ? override : '';
    return { text: `工作树改动摘要取不到：${reason}${note}${tail}；请自行 git status 核对。`, warning: true };
  }
  // 范围行里列归档根与 .trivium/（.git 不是工作树内容，不列）；归档根在前
  const own = [
    ...s.excluded_prefixes.filter((p) => p !== '.git' && p !== '.trivium'),
    ...s.excluded_prefixes.filter((p) => p === '.trivium'),
  ].map((p) => `${p}/`).join(' 与 ');
  if (s.total === 0) {
    return {
      text: `工作树改动摘要：自审查收尾（run ${s.run_id}）以来，未被 .gitignore 忽略的文件无改动（不含 ${own}）。` +
        (override ? `\n  ${override}` : ''),
      warning: false,
    };
  }
  const scope = `未被 .gitignore 忽略的文件，不含 ${own}`;
  const limit = opts.limit ?? SUMMARY_TEXT_LIMIT;
  const shown = s.files.slice(0, limit);
  const lines = [
    `工作树改动摘要（只告知，不影响审批结论）：自审查收尾（run ${s.run_id}）以来，${s.total} 个文件有变化`,
    ...shown.map((f) => `  ${f.status.padEnd(2)} ${f.path}`),
  ];
  if (s.total > shown.length) {
    lines.push(`  ……另有 ${s.total - shown.length} 个，完整列表：${fullListCommand(s)}`);
  }
  lines.push(`  （比对范围：${scope}；闸门期提交过的改动同样列出）`);
  lines.push(
    opts.exit === 'approval'
      ? `  若这些改动不该发生：请自行 git diff 核对，必要时 ${entryCommandOf(opts.driver, 'dual-abandon')} --topic ${shellQuoteArg(opts.topic)} 作废本轮后重跑。`
      : '  审批时会再列出一次。',
  );
  if (override) lines.push(`  ${override}`);
  return { text: lines.join('\n'), warning: false };
}
