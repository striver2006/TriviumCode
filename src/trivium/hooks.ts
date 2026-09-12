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
import { listOpenGates, readState, shouldLockWrites } from './state.js';
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

/**
 * 归档内由编排器**独占维护**的文件：`_meta/` 下的全部审计材料与 `task.json`。
 *
 * Driver 合法要写的只有原稿与裁决件。`_meta/review-*.json` 是 `gate --check` 唯一的
 * 事实来源，`run-*.json` 的 sha256 与 `task.json.runs[]` 是留痕核对的锚——
 * 这些若对 Driver 开放，「改锚即可整枝绕过」（P5 不可伪装）。该规则同样不受会话与 TTL 限制。
 */
export function isOrchestratorOwned(targetPath: string, projectRoot: string, archiveRoot: string): boolean {
  const abs = path.isAbsolute(targetPath) ? targetPath : path.resolve(projectRoot, targetPath);
  const rel = path.relative(archiveRoot, abs);
  if (rel.length === 0 || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return rel.split(path.sep).includes('_meta') || path.basename(abs) === 'task.json';
}

/**
 * 已提交的归档文件里，哪些**一经落盘即不可变**（git 锚要拦其改动）。
 * 返回 null 表示该文件本就可变（task.json、原稿、裁决件、便利副本 changes.diff）。
 */
const IMMUTABLE_META = /^(?:review-.+\.(?:json|fallback-items\.md)|brief-.+\.md|changes-.+\.diff)$/;
async function immutableChangeReason(projectRoot: string, relFromRoot: string): Promise<string | null> {
  const base = path.basename(relFromRoot);
  const inMeta = relFromRoot.split('/').includes('_meta');
  if (isForgedRoleFile(base)) return '审查文档只能由编排器落盘，改动即伪造';
  if (inMeta && IMMUTABLE_META.test(base)) return '审计材料一经落盘即不可变';
  if (inMeta && /^run-.+\.json$/.test(base)) {
    /*
     * run.json 只在运行**期间**被编排器改写（骨架 → 收尾）。已提交的版本若还是
     * `running`，说明有人在运行中途提交过，本次改动是正常收尾，不能拦。
     */
    const { readAtHead } = await import('./util/git.js');
    const head = await readAtHead(projectRoot, relFromRoot);
    if (head) {
      try {
        if ((JSON.parse(head) as { status?: string }).status === 'running') return null;
      } catch {
        /* HEAD 里的版本本身就坏了：按不可变处理 */
      }
    }
    return '运行清单是留痕核对的锚，改锚即可整枝绕过';
  }
  return null;
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

  // 闸门写锁只管归档根之外的业务文件；裁决件本身要写进归档，不能拦——
  // 但 `_meta/` 与 task.json 是编排器独占的锚，Driver 一律不得手工改动
  if (isInsideArchive(target, ctx.projectRoot, ctx.archiveRoot)) {
    if (isOrchestratorOwned(target, ctx.projectRoot, ctx.archiveRoot)) {
      return deny(
        `禁止写入 ${path.relative(ctx.projectRoot, path.resolve(ctx.projectRoot, target))}：` +
          '归档内的 _meta/ 与 task.json 由编排器独占维护，是留痕核对的锚与 gate --check 的事实来源（FR-25 / P5）。' +
          'Driver 只应写原稿与裁决件。',
      );
    }
    return ALLOW;
  }
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
 * 一段命令里的 git 调用：**子命令** + 它自己指定的工作目录
 * （`-C` / `--work-tree` / `--git-dir`）。
 *
 * 子命令不能拿 `/git.*commit/` 这种正则凑：`git log --format=commit` 会被误判成提交，
 * 于是闸门期内连看日志都被拦。必须跳过全局选项后取第一个非选项词。
 */
interface GitCall {
  subcommand: string;
  /** `-C` 等选项给出的路径；没有则为 null，表示「就在当前目录」 */
  dirOption: string | null;
}

function parseGitSegment(segment: string): GitCall | null {
  const tokens = tokenize(segment);
  const gitAt = tokens.findIndex((t) => t === 'git' || t.endsWith('/git'));
  if (gitAt < 0) return null;

  let dirOption: string | null = null;
  for (let i = gitAt + 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t.startsWith('-')) return { subcommand: t, dirOption };

    // `--git-dir=x` 自带值；`--git-dir x` 要多吃一个词
    const eq = t.indexOf('=');
    if (eq > 0) {
      const name = t.slice(0, eq);
      if (name === '--work-tree') dirOption = t.slice(eq + 1);
      else if (name === '--git-dir') dirOption = stripDotGit(t.slice(eq + 1));
      continue;
    }
    if (GIT_OPTS_WITH_VALUE.has(t)) {
      const val = tokens[i + 1];
      if (val !== undefined) {
        if (t === '-C' || t === '--work-tree') dirOption = val;
        else if (t === '--git-dir') dirOption = stripDotGit(val);
      }
      i++;
    }
  }
  return null;
}

/** `--git-dir` 指向 `.git` 本身，仓库根是它的父目录 */
const stripDotGit = (p: string): string =>
  path.basename(p) === '.git' ? path.dirname(p) : p;

/** 极简分词：够用于识别 `cd`/`git` 与它们的第一个路径参数，不追求完整 shell 语义 */
function tokenize(segment: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  for (const ch of segment.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * 这条命令里的 `git commit` 是否**打在本项目上**（审查意见：跨仓库误拦）。
 *
 * 实测暴露的问题：`hookPreCommit` 原先只看命令串里有没有 `git commit`，
 * **完全不看提交的目标是哪个仓库**。于是一条
 * `cd /tmp/夹具 && git init && git commit …` 会被**本项目**的闸门拦下，
 * 而那次提交与本项目的归档状态毫无关系。
 * 也就是说：本项目的闸门会拦住你对任何其它仓库的提交。
 *
 * 原则是**保守**的：能确认目标在项目外才放行，推断不出一律按「在项目内」处理。
 * 从命令串推断目标仓库天然不可能严密（变量、子 shell、`cd -`……），
 * 宁可多拦一次，也不能让真正该拦的提交溜过去。
 */
function commitTargetsProject(command: string, projectRoot: string): boolean {
  const segments = command.split(/(?:&&|\|\||[;&|])/);
  /** 当前目录。null 表示「已经推断不出来了」——此后一律按项目内处理 */
  let cwd: string | null = projectRoot;

  for (const seg of segments) {
    const tokens = tokenize(seg);
    if (tokens.length === 0) continue;

    // ① cd 改变后续段落的当前目录
    if (tokens[0] === 'cd') {
      const target = tokens[1];
      // `cd`（回 HOME）、`cd -`、`cd $VAR` 一律判为推断不出
      if (target === undefined || target === '-' || /[$`]/.test(target)) {
        cwd = null;
      } else {
        cwd = cwd === null ? null : path.resolve(cwd, target);
      }
      continue;
    }

    // ② 这一段是不是提交
    const call = parseGitSegment(seg);
    if (!call || call.subcommand !== 'commit') continue;

    let target: string | null;
    if (call.dirOption !== null) {
      if (/[$`]/.test(call.dirOption)) target = null; // 路径含变量，推断不出
      else target = cwd === null ? null : path.resolve(cwd, call.dirOption);
    } else {
      target = cwd;
    }

    if (target === null) return true; // 推断不出 → 按项目内处理
    if (isInside(projectRoot, target)) return true;
    // 这一段明确打在项目外，继续看后面还有没有别的提交
  }
  return false;
}

/** `child` 是否在 `parent` 之内（含相等） */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function looksLikeCommit(input: HookInput, projectRoot: string): boolean {
  const cmd = input.tool_input?.['command'];
  if (typeof cmd !== 'string') return true; // 拿不到命令行 → 不敢放过
  // 复合命令里任一段是**打在本项目上**的提交才算
  return commitTargetsProject(cmd, projectRoot);
}

export async function hookPreCommit(ctx: Ctx, input: HookInput): Promise<HookOutput> {
  if (!ctx.config.gate.block_commit) return ALLOW;
  if (input.tool_name === 'Bash' && !looksLikeCommit(input, ctx.projectRoot)) return ALLOW;

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
  const { checkRecordedArtifacts, checkRunManifests, listRecordedRuns } = await import('./archive.js');
  const { readTaskStrict } = await import('./meta.js');
  const { deletedOrModifiedTracked } = await import('./util/git.js');

  const problems: string[] = [];

  /*
   * ── 锚 ①：git 索引（审查意见 GLM-r2-03）──
   *
   * 目录枚举 + run.json 治不了「把整个主题目录删掉或改名」——那会把 `task.json`
   * 自己也带走，核对随之失去对象。而 `.reviews/` 是**刻意纳入版本管理**的，
   * git 记得每一份已提交的工件：删目录、改目录名（表现为一批删除 + 未跟踪新增）
   * 都瞒不过它。与 run.json 互补：git 管已提交的，run.json 管刚落盘未提交的。
   */
  const archiveRel = path.relative(ctx.projectRoot, ctx.archiveRoot) || ctx.config.archive_root;
  const tracked = await deletedOrModifiedTracked(ctx.projectRoot, archiveRel);
  /*
   * 删除一律拦；改动**只拦不可变工件**。
   *
   * 原先 git 锚刻意只看删除，把「内容变了」全交给 run.json 的 sha256。但 run.json 自己
   * 也在归档里、同样可改：改一份审查文档 → 重算 sha 写回 run.json → 两处都是 `M`，
   * git 锚失明、run.json 锚自证清白，全程放行。锚与被核对对象同域时，锚本身必须由
   * 不可变规则守住：审查文档、`_meta/` 审计材料、运行清单一经提交即不得改动。
   *
   * 仍然放过两类本就该可变的文件：编排器每次运行都要更新的 `task.json`，以及 Driver
   * 本就该修订的裁决件（「修订」正是它的用途）。护栏一旦误伤正常工作，第一个被关掉的
   * 就是它自己。
   */
  for (const f of tracked.deleted) problems.push(`  · 已提交的归档文件被删除：${f}`);
  for (const f of tracked.modified) {
    const why = await immutableChangeReason(ctx.projectRoot, f);
    if (why) problems.push(`  · 已提交的不可变工件被改动：${f}（${why}）`);
  }

  /*
   * ── 锚 ③：state.json 记过闸门的主题，其 task.json 必须还在 ──
   *
   * 首次提交之前归档全是未跟踪文件，git 锚没有基线；此时 `rm -rf .reviews/<主题>`
   * 会把 task.json 与全部 run.json 一起带走，锚 ①② 同时失去对象、`listTopics`
   * 也枚举不到它。state.json 在 .trivium/ 下、每次运行都会为主题写一条闸门（含终态），
   * 是此刻仍然在手的锚。只看带 run_id 的闸门：那才意味着真的跑过、task.json 真的写过。
   */
  const gates = Object.values((await readState(ctx.triviumDir)).gates).filter((g) => g.run_id !== null);
  for (const topic of new Set(gates.map((g) => g.topic))) {
    if (!(await exists(path.join(ctx.archiveRoot, topic, 'task.json')))) {
      problems.push(`  · 主题归档已消失：${path.join(archiveRel, topic, 'task.json')}（state.json 记录过该主题的运行）`);
    }
  }

  for (const topic of await listTopics(ctx)) {
    const layout = { archiveRoot: ctx.archiveRoot, topic };
    const present = await listRecordedRuns(layout);

    /*
     * ── 锚 ②：task.json 登记过的 run，其 run.json 必须在、且必须可读 ──
     *
     * 锚自身也要可信（审查意见 AGY-01 ≡ GLM-02）：`task.json` **存在但读不出来**
     * 意味着锚被搅坏了，必须按违例拦截；「不存在」则是正常（主题刚建、还没跑过）。
     * 静默回落成空 task 等于「搅坏它就能整枝绕过」——正是我上一批刚修掉的那个毛病。
     */
    const t = await readTaskStrict(layout);
    if (t.state === 'unreadable') {
      problems.push(`  · 主题元数据不可读：${path.join(topic, 'task.json')}（${t.error ?? '解析失败'}）`);
    }
    const manifests = await checkRunManifests(
      layout,
      t.task.runs.map((r) => ({ run_id: r.run_id, stage: r.stage })),
      present,
    );
    for (const t of manifests) {
      problems.push(
        t.kind === 'manifest_missing'
          ? `  · 运行清单已丢失：${t.relPath}（task.json 登记过 run ${t.runId}）`
          : `  · 运行清单不可读：${t.relPath}（run ${t.runId} 的 run.json 存在但解析失败）`,
      );
    }

    // ② 清单内登记的工件必须在、且内容不变
    const runs = present.filter((r) => r.artifacts.length > 0);
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
    // 与 shouldLockWrites 同一条保守原则：只有明确记录了**别的**会话才放行，
    // null 无从证明是别人的，按本会话处理（否则默认路径上收工拦截从不生效）
    return g.session_id === null || g.session_id === (input.session_id ?? null);
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
  /*
   * ── 先清扫「没人看管的 running 闸门」（审查意见 GLM-06）──
   *
   * SIGKILL / 断电之后的闸门回收原先全是 **push 式**：要么 worker 自己的 finally，
   * 要么有人再跑一次 `--wait`。worker 被硬杀、且此后无人 `--wait` 时，闸门就一直
   * 挂在 running 上，业务写入被拦到 24h TTL——而开发者往往只是关掉终端又开了一个。
   *
   * 会话开始是天然的 pull 式时机：此时扫一遍，发现 worker 已不存在就地回收。
   */
  const swept = await sweepDeadRunningGates(ctx);

  const open = await listOpenGates(ctx.triviumDir);
  const running = await findRunningRuns(ctx);

  const reportable = open.filter((g) => g.state !== 'running');
  if (reportable.length === 0 && running.length === 0 && swept.length === 0) return ALLOW;

  const lines: string[] = ['TriviumCode 待办：'];
  for (const s of swept) {
    lines.push(`  · 已回收 ${s} 的遗留闸门：其工作进程已不存在（崩溃或被强杀），业务写入已解锁`);
  }
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

/**
 * 回收「闸门还是 running、但工作进程早已不存在」的遗留状态（审查意见 GLM-06）。
 *
 * 判据用 `status.json` 里记的 `worker_pid` + `worker_started_at`，
 * 经 `processAlive` 比对启动时间——macOS 会复用 PID，只看 `kill(pid,0)` 会把
 * 别人的新进程当成我们的 worker 还活着。
 *
 * 拿不准的一律**不回收**：宁可多拦一会儿（还有 TTL 兜底），
 * 也不能在 worker 其实还在跑的时候把护栏撤了。
 */
async function sweepDeadRunningGates(ctx: Ctx): Promise<string[]> {
  const { listOpenGates: list, setGateChecked } = await import('./state.js');
  const { readStatus } = await import('./status.js');
  const { processAlive } = await import('./util/exec.js');
  const { runDirFor } = await import('./run-protocol.js');

  const swept: string[] = [];
  for (const g of (await list(ctx.triviumDir)).filter((x) => x.state === 'running')) {
    if (!g.run_id) continue;
    let alive = true;
    try {
      const st = await readStatus(runDirFor(ctx.config, ctx.projectRoot, g.run_id));
      if (!st?.worker_pid) continue; // 读不到就别动它
      alive = (await processAlive(st.worker_pid, st.worker_started_at ?? null)).alive;
    } catch {
      continue; // 判不了就不回收
    }
    if (alive) continue;

    const r = await setGateChecked({
      triviumDir: ctx.triviumDir,
      topic: g.topic, stage: g.stage, state: 'idle', runId: g.run_id,
      heartbeatStaleMs: ctx.config.review.heartbeat_stale_s * 1000,
      expect: { state: ['running'], runId: g.run_id, allowMissing: false },
    });
    if (r.applied) swept.push(`${g.topic}/${g.stage}`);
  }
  return swept;
}
