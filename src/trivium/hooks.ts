/**
 * Claude Code Hook 子命令（设计 §8.5，按修订计划 §2.3 重定义退出码语义）。
 *
 * 闸门「真正停住」的强制层。四个子命令：
 *   `hook-pre-write`   写入前拦截（闸门未审批 / 伪造审查文件）
 *   `hook-pre-commit`  `git commit` 前拦截（裁决未完成）
 *   `hook-stop`        收工前拦截（裁决未完成）
 *   `hook-session-start` 注入待办清单
 *
 * ## 退出码三档（修订计划 §2.3，替换设计原文的「内部异常返回 1」）
 *
 * | 情形 | 码 | 理由 |
 * | :--- | :--- | :--- |
 * | 无法确认存在**合法** config（缺失/不可读/schema 不合） | 0 | no-op 的语义是「判定不了就别管」，不只是「判定为未初始化」（GLM-07） |
 * | 读到合法 config 且**明确判定**应拦截 | 2 | 唯一返回 2 的路径 |
 * | 真正的程序缺陷 | 1 | 非阻断；带 TRIVIUM_DEBUG 时打日志便于归因 |
 *
 * 注意 wrapper 文件本身缺失时 shell 会返回 127、`loadCtx` 抛 envError 返回 69——
 * 两者都不是 0。因此**真正的守卫在 hook 命令层**（`test -x … || exit 0`，见 §2.3），
 * 本文件的三档是第二道。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { Ctx, Stage } from './types.js';
import { EXIT } from './exit-codes.js';
import { listOpenGates, shouldLockWrites } from './state.js';
import { bumpStopBlockCount } from './lock.js';
import { exists } from './util/fsx.js';

/** Claude Code 通过 stdin 传给 hook 的输入（设计 §3.1） */
export interface HookInput {
  session_id?: string;
  cwd?: string;
  hook_event_name?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  stop_hook_active?: boolean;
}

export interface HookOutput {
  exitCode: number;
  /** 写 stdout 的 JSON（Claude Code 的 hookSpecificOutput 协议） */
  json?: Record<string, unknown>;
  /** 写 stderr 的文本（exit 2 时会被喂回 Driver） */
  stderr?: string;
}

const ALLOW: HookOutput = { exitCode: EXIT.OK };

export async function readHookInput(): Promise<HookInput> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) return {};
  try {
    return JSON.parse(raw) as HookInput;
  } catch {
    return {};
  }
}

/** 从 tool_input 里取出目标路径。不同工具的字段名不同 */
export function extractTargetPath(input: HookInput): string | null {
  const ti = input.tool_input ?? {};
  for (const k of ['file_path', 'filePath', 'path', 'notebook_path', 'target_file']) {
    const v = ti[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/** 目标路径是否在归档根内（闸门期允许写归档，那是裁决件的去处） */
export function isInsideArchive(targetPath: string, projectRoot: string, archiveRoot: string): boolean {
  const abs = path.isAbsolute(targetPath) ? targetPath : path.resolve(projectRoot, targetPath);
  const rel = path.relative(archiveRoot, abs);
  return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** 是否试图伪造审查文件（§10.4 / PRD 6.3）。该规则不受会话与 TTL 限制 */
export function isForgedRoleFile(targetPath: string): boolean {
  return /-(?:gemini|glm)\.md$/.test(path.basename(targetPath));
}

// ─────────────────────── hook-pre-write ───────────────────────

/**
 * 写入前拦截（设计 §8.4 第 3 层）。
 *
 * 两条独立规则：
 *   1. **伪造审查文件**：写 `*-gemini.md` / `*-glm.md` 一律拒绝。
 *      主脑不得自己编一份审查（PRD 6.3）——该规则**不受**会话与 TTL 限制。
 *   2. **闸门写锁**：本会话触发的未审批闸门期间，禁止写归档根之外的文件。
 */
export async function hookPreWrite(ctx: Ctx, input: HookInput): Promise<HookOutput> {
  const target = extractTargetPath(input);
  if (!target) return ALLOW; // 拿不到路径就别拦，宁可放过也不误伤

  if (isForgedRoleFile(target)) {
    return deny(
      `禁止写入 ${path.basename(target)}：审查文档只能由编排器从审查员的结构化输出渲染落盘。` +
        `主脑不得自行产出 -gemini.md / -glm.md（PRD 6.3 / 设计 §10.4）。`,
    );
  }

  // 闸门写锁只管归档根之外的业务文件；裁决件本身要写进归档，不能拦
  if (isInsideArchive(target, ctx.projectRoot, ctx.archiveRoot)) return ALLOW;
  if (!ctx.config.gate.block_business_write_when_awaiting_approval) return ALLOW;

  const open = await listOpenGates(ctx.triviumDir);
  for (const gate of open) {
    const decision = shouldLockWrites(gate, {
      currentSessionId: input.session_id ?? null,
      scope: ctx.config.gate.approval_lock_scope,
      ttlHours: ctx.config.gate.approval_lock_ttl_h,
    });
    if (decision.lock) {
      return deny(
        `${decision.reason}，此时不得修改业务文件。\n` +
          `  通过审批：/dual-approve --topic ${gate.topic} --stage ${gate.stage}\n` +
          `  拒绝：    /dual-approve --topic ${gate.topic} --stage ${gate.stage} --reject --reason <理由>\n` +
          `  放弃闸门：/dual-abandon --topic ${gate.topic}`,
      );
    }
  }
  return ALLOW;
}

function deny(reason: string): HookOutput {
  return {
    exitCode: EXIT.GATE_BLOCK,
    json: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    },
    stderr: reason,
  };
}

// ─────────────────────── hook-pre-commit ───────────────────────

/**
 * `git commit` 前拦截（设计 §8.5）。
 *
 * 作用域按修订计划 §2.3（意见 AGY-03）：**仅当本会话存在未裁决阶段时**才拦截。
 * 原稿没界定作用域，等于对仓库内任何 `git commit` 都可能拦截——那会误伤日常提交。
 */
/**
 * 判断这次 Bash 调用是不是在提交。
 *
 * `settings.json` 的 `if: "Bash(git commit:*)"` 已经做了过滤，这里是第二道：
 * 该字段只在工具事件上生效、且写错一个字就会静默全匹配，而本 Hook 一旦全匹配，
 * 闸门期内**每一条** Bash 命令都会被拦下——那是比漏拦更糟的故障形态。
 * 判不出来时按「是提交」处理：Hook 的职责是拦住违规提交，不是放过可疑输入。
 */
/** 需要额外吃掉一个参数值的 git 全局选项 */
const GIT_OPTS_WITH_VALUE = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env',
]);

/**
 * 取一段命令里 git 的**子命令**。
 *
 * 不能拿 `/git.*commit/` 这种正则凑：`git log --format=commit` 会被误判成提交，
 * 于是闸门期内连看日志都被拦。必须跳过全局选项后取第一个非选项词。
 */
function gitSubcommand(segment: string): string | null {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  const gitAt = tokens.findIndex((t) => t === 'git' || t.endsWith('/git'));
  if (gitAt < 0) return null;

  for (let i = gitAt + 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t.startsWith('-')) return t;
    // `--git-dir=x` 自带值；`--git-dir x` 要多吃一个词
    if (GIT_OPTS_WITH_VALUE.has(t)) i++;
  }
  return null;
}

function looksLikeCommit(input: HookInput): boolean {
  const cmd = input.tool_input?.['command'];
  if (typeof cmd !== 'string') return true; // 拿不到命令行 → 不敢放过
  // 复合命令里任一段是提交就算：`npm test && git commit -m y`
  return cmd
    .split(/(?:&&|\|\||[;&|])/)
    .some((seg) => gitSubcommand(seg) === 'commit');
}

export async function hookPreCommit(ctx: Ctx, input: HookInput): Promise<HookOutput> {
  if (!ctx.config.gate.block_commit) return ALLOW;
  if (input.tool_name === 'Bash' && !looksLikeCommit(input)) return ALLOW;

  const open = await listOpenGates(ctx.triviumDir);
  /*
   * **不按会话过滤**（审查意见 AGY-05）。
   *
   * 写锁按会话是 RV-05 的刻意设计——避免 A 会话的闸门误伤 B 会话正在做的无关工作。
   * 但「裁决是否齐备」是**仓库的属性，不是会话的属性**：换个会话、或直接在终端里
   * `git commit`，未裁决的审查意见并不会因此变成已裁决。原先沿用了会话过滤，
   * 等于留了一条「换个会话就能提交」的绕过路径。
   */
  const pending = open.filter((g) => g.state === 'review_done_awaiting_disposition');
  if (pending.length > 0) {
    const list = pending.map((g) => `${g.topic}/${g.stage}`).join('、');
    return {
      exitCode: EXIT.GATE_BLOCK,
      stderr:
        `以下阶段的审查意见尚未逐条裁决，提交被拦下：${list}\n` +
        `  请先补齐裁决件并通过 \`trivium gate --stage <阶段> --check\`。\n` +
        `  如需关闭该拦截，可在 .trivium/config.yaml 设 gate.block_commit: false。`,
    };
  }

  /*
   * ── 留痕完整性：记录在案的工件不得消失或被改动（§17.3 剧本 5）──
   *
   * 仅凭闸门状态拦不住这件事：裁决通过后闸门已放行回 idle，此时删掉一份不顺眼的
   * 审查文档再提交，一路绿灯。而「留痕」的意义恰恰在于它删不掉也改不掉（P5 / P6）。
   *
   * 判据取 run.json 的 artifacts[]（path + sha256），因此能区分「记录在案却不见了」
   * 与「本来就还没写」——后者不在这里拦（那是上面闸门那一段的事）。
   */
  return checkArchiveIntegrity(ctx);
}

async function checkArchiveIntegrity(ctx: Ctx): Promise<HookOutput> {
  const { listTopics } = await import('./topic.js');
  const { checkRecordedArtifacts, listRecordedRuns } = await import('./archive.js');

  const problems: string[] = [];
  for (const topic of await listTopics(ctx)) {
    const layout = { archiveRoot: ctx.archiveRoot, topic };
    const runs = (await listRecordedRuns(layout)).filter((r) => r.artifacts.length > 0);
    for (const t of await checkRecordedArtifacts(layout, runs)) {
      problems.push(
        t.kind === 'missing'
          ? `  · 已丢失：${t.relPath}（run ${t.runId} 记录过它，sha256 ${t.recordedSha256.slice(0, 12)}）`
          : `  · 已被改动：${t.relPath}（run ${t.runId} 记录 ${t.recordedSha256.slice(0, 12)}，现为 ${t.actualSha256?.slice(0, 12)}）`,
      );
    }
  }
  if (problems.length === 0) return ALLOW;

  return {
    exitCode: EXIT.GATE_BLOCK,
    stderr:
      '归档留痕不完整，提交被拦下——已落盘的审查工件不得删除或改动（FR-25 / 设计 §17.3 剧本 5）：\n' +
      problems.slice(0, 20).join('\n') +
      (problems.length > 20 ? `\n  · …另有 ${problems.length - 20} 项` : '') +
      '\n\n  请用 `git checkout -- <路径>` 或 `git restore <路径>` 恢复。\n' +
      '  确实要作废某一轮，用 `/dual-abandon --topic <主题>`——它保留工件、只解闸门。\n' +
      '  重跑会自动抬升 -r<N>，既有工件一律不覆盖，不需要先删。',
  };
}

// ─────────────────────── hook-stop ───────────────────────

/**
 * 收工前拦截（设计 §8.5）。
 *
 * 只拦「审查已落盘但裁决未完成」；`awaiting_approval` 是**期望的**停点，放行。
 * 三层防死循环：`stop_hook_active` 早退、每阶段阻断上限、Claude Code 自身 8 次硬上限。
 */
export async function hookStop(ctx: Ctx, input: HookInput): Promise<HookOutput> {
  // 第一层：Claude Code 已在因 Stop hook 而继续，别再叠加
  if (input.stop_hook_active === true) return ALLOW;

  const open = await listOpenGates(ctx.triviumDir);
  const pending = open.filter((g) => {
    if (g.state !== 'review_done_awaiting_disposition') return false;
    if (ctx.config.gate.approval_lock_scope === 'global') return true;
    return g.session_id !== null && g.session_id === (input.session_id ?? null);
  });
  if (pending.length === 0) return ALLOW;

  // 第二层：每阶段阻断上限
  const g = pending[0]!;
  const { count, exceeded } = await bumpStopBlockCount(
    ctx.triviumDir,
    g.topic,
    g.stage,
    ctx.config.gate.stop_hook_max_blocks,
  );
  if (exceeded) {
    return {
      exitCode: EXIT.OK,
      stderr:
        `已连续 ${count - 1} 次阻断收工仍未完成裁决，本次放行以避免死循环。\n` +
        `  ${g.topic}/${g.stage} 的裁决仍未齐备，请手工处理。`,
    };
  }

  const list = pending.map((x) => `${x.topic}/${x.stage}`).join('、');
  return {
    exitCode: EXIT.GATE_BLOCK,
    json: {
      decision: 'block',
      reason:
        `还有未逐条裁决的审查意见：${list}。\n` +
        `请读完两份审查文档全文，按 trivium.disposition.v1 写出裁决件` +
        `（每个意见编号都要有裁决与理由，接受项要写落点），再运行 ` +
        `\`trivium gate --stage ${g.stage} --check\`。`,
    },
    stderr: `还有未逐条裁决的审查意见：${list}`,
  };
}

// ─────────────────────── hook-session-start ───────────────────────

/** 会话开始时注入待办清单（设计 §8.5）。永不阻断 */
export async function hookSessionStart(ctx: Ctx): Promise<HookOutput> {
  const open = await listOpenGates(ctx.triviumDir);
  const running = await findRunningRuns(ctx);

  const reportable = open.filter((g) => g.state !== 'running');
  if (reportable.length === 0 && running.length === 0) return ALLOW;

  const lines: string[] = ['TriviumCode 待办：'];
  for (const g of open) {
    // running 状态由下面的锁扫描单独报告，避免同一件事说两遍
    if (g.state === 'running') continue;
    if (g.state === 'awaiting_approval') {
      lines.push(
        `  · ${g.topic}/${g.stage} 等待人工审批（自 ${g.since}）` +
          `——/dual-approve --topic ${g.topic} --stage ${g.stage}`,
      );
    } else {
      lines.push(`  · ${g.topic}/${g.stage} 审查已落盘但裁决未齐备`);
    }
  }
  for (const r of running) {
    lines.push(`  · ${r.topic}/${r.stage} 双审进行中（run ${r.runId}）——请先 trivium review --wait ${r.runId}`);
  }

  return {
    exitCode: EXIT.OK,
    json: {
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: lines.join('\n'),
      },
    },
  };
}

async function findRunningRuns(
  ctx: Ctx,
): Promise<{ topic: string; stage: Stage; runId: string }[]> {
  const out: { topic: string; stage: Stage; runId: string }[] = [];
  const lockDir = path.join(ctx.triviumDir, 'lock');
  let entries: string[];
  try {
    entries = await fs.readdir(lockDir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.endsWith('.lock') || e.startsWith('.')) continue;
    try {
      const c = JSON.parse(await fs.readFile(path.join(lockDir, e), 'utf8')) as {
        topic: string;
        stage: Stage | null;
        run_id: string | null;
        kind: string;
      };
      if (c.kind === 'run' && c.run_id && c.stage) {
        out.push({ topic: c.topic, stage: c.stage, runId: c.run_id });
      }
    } catch {
      /* 坏锁文件不影响提示 */
    }
  }
  return out;
}

// ─────────────────────── 统一 wrapper ───────────────────────

export type HookName = 'hook-pre-write' | 'hook-pre-commit' | 'hook-stop' | 'hook-session-start';

/**
 * 统一 wrapper：把三档退出码语义收在一处（修订计划 §2.3 / 意见 GLM-07）。
 *
 * 传 `loadCtx` 而不是 `Ctx`，因为「config 缺失或损坏」这件事本身就要归入 exit 0，
 * 而它只有在真的去加载时才知道。
 */
export async function runHook(
  name: HookName,
  loadCtx: () => Promise<Ctx>,
  input: HookInput,
): Promise<HookOutput> {
  let ctx: Ctx;
  try {
    ctx = await loadCtx();
    // 二次确认：config.yaml 必须真的存在。loadCtx 允许「未初始化」通过时也要拦下
    if (!(await exists(path.join(ctx.triviumDir, 'config.yaml')))) {
      return ALLOW;
    }
  } catch {
    // 无法确认存在合法 config —— 缺失、不可读、schema 不合，一律 no-op
    return ALLOW;
  }

  try {
    switch (name) {
      case 'hook-pre-write':
        return await hookPreWrite(ctx, input);
      case 'hook-pre-commit':
        return await hookPreCommit(ctx, input);
      case 'hook-stop':
        return await hookStop(ctx, input);
      case 'hook-session-start':
        return await hookSessionStart(ctx);
    }
  } catch (e) {
    // 真正的程序缺陷：非阻断，但要能归因
    if (process.env['TRIVIUM_DEBUG']) console.error(e);
    return { exitCode: EXIT.FAIL, stderr: `hook ${name} 内部错误：${(e as Error).message}` };
  }
}
