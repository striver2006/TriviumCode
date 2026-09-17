/**
 * Claude Code Hook 子命令（设计 §8.5，按修订计划 §2.3 重定义退出码语义）。
 *
 * 闸门「真正停住」的强制层。四个子命令：
 *   `hook-pre-write`   写入前拦截（闸门未审批 / 伪造审查文件）
 *   `hook-pre-bash`    Bash 写命令的启发式拦截（闸门期的 `cat >`、`sed -i`、`tee`、`rm/mv/cp`、`git checkout` …）
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
 * | config 合法但 `state.json` **存在却读不出来** | 2 | 它是唯一判定依据，坏了不能当成没有闸门（否则搅坏它即可整枝绕过） |
 * | 真正的程序缺陷 | 1 | 非阻断；带 TRIVIUM_DEBUG 时打日志便于归因 |
 *
 * 注意 wrapper 文件本身缺失时 shell 会返回 127、`loadCtx` 抛 envError 返回 69——
 * 两者都不是 0。因此**真正的守卫在 hook 命令层**（见 §2.3），本文件的三档是第二道。
 * 该守卫不再是一律 `|| exit 0`：那样 `rm -rf .trivium/bin` 就能让四个拦截型 Hook
 * 全部永真放行（审查意见 AGY-03）。现在它区分「项目从未初始化」（exit 0）与
 * 「初始化过但 wrapper 没了」（exit 2 并说明修复办法），契约由
 * `test/contract/hook-guard.test.ts` 实跑守住；wrapper 目录本身也进了
 * `hook-pre-bash` 的保护集。
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import { CRITICS, type Ctx, type Stage } from './types.js';
import { EXIT } from './exit-codes.js';
import { listOpenGates, readState, shouldLockWrites, StateCorruptError } from './state.js';
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

/**
 * 文件名是不是审核者角色工件的形态。**只问形态，不问位置。**
 *
 * 后缀集由 Agent 注册表派生，不写死字面量（`registry-parity` 的 grep 对账守着）。
 */
export function hasCriticRoleSuffix(fileName: string): boolean {
  return new RegExp(`-(?:${CRITICS.join('|')})\\.md$`).test(path.basename(fileName));
}

/**
 * 目标是否落在归档根内——**词法路径与真实路径取并集**（设计 §8.4，2026-09-14 收窄）。
 *
 * 两个方向的软链都要拦，缺一不可：
 *   · 词法在归档内、realpath 指向归档外 → 仍算归档内。否则「在归档里放一个指向 /tmp
 *     的软链」就能让对归档内路径的写入被放行。
 *   · 词法在归档外、realpath 落在归档内 → 也算归档内。否则 `doc/x-glm.md` 做成指向
 *     真审查件的软链，Write 会沿链覆写它。
 *
 * `archiveRoot` 必须**对称**做 realpath：macOS 的 `/var` 是指向 `/private/var` 的系统
 * 软链，只解一边会把同一个位置判成两处（`adapters/base.ts` 的 `normalizeAbs` 抹平
 * `/private` 前缀正是同一个坑）。
 *
 * **本函数不抛异常。** 解析失败一律回退到纯词法比较——异常若外泄到 `runHook`，
 * 外层 catch 会 `return ALLOW`，或走 `EXIT.FAIL=1`（`hooks.json` 约定「1 = 非阻断」），
 * 两条路径都是**静默放行**，与本判定的 fail-closed 取向正相反。
 */
export function isInsideArchiveResolved(
  targetPath: string,
  projectRoot: string,
  archiveRoot: string,
): boolean {
  const lexical = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(projectRoot, targetPath);

  // 词法先判：归档内的软链指向归档外，也算归档内
  if (isInside(archiveRoot, lexical)) return true;

  const root = safeRealpath(archiveRoot);
  if (root === null) return false; // 归档根不可解析 → 退化为纯词法比较（等价于现状）

  return isInside(root, resolveExisting(lexical));
}

/** realpath，失败返回 null。绝不抛 */
function safeRealpath(p: string): string | null {
  try {
    return fsSync.realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * 尽力解析绝对路径：逐级向上回溯到**首个真实存在的祖先**做 realpath，
 * 再把其余部分拼回去。
 *
 * 不能因为 `ENOENT` 就下结论——`doc/new_sub/x-glm.md` 这类新建子目录的合法写入、
 * 以及归档根尚未创建的测试夹具，都会走到这里。直接判「在归档内」会把它们全锁死。
 */
function resolveExisting(abs: string, depth = 0): string {
  /*
   * **悬空软链要先于回溯处理**（审查意见 AGY-02）。
   *
   * `realpathSync` 对指向不存在目标的软链同样抛 ENOENT，若直接进回溯逻辑，
   * `doc/x-gemini.md`（软链 → 归档内尚未创建的文件）会被当成「doc 下一个还不存在的
   * 普通文件」，拼回后判归档外而放行——而 Write 会沿链在归档内把文件创建出来。
   * 所以先用 lstat 看这一层自己是不是软链，是就跟着 readlink 走。
   */
  if (depth < 32) {
    try {
      if (fsSync.lstatSync(abs).isSymbolicLink()) {
        const target = fsSync.readlinkSync(abs);
        const next = path.isAbsolute(target) ? target : path.resolve(path.dirname(abs), target);
        return resolveExisting(next, depth + 1); // 递归：软链可以指向软链
      }
    } catch {
      // lstat/readlink 失败 → 落到下面的回溯逻辑
    }
  }

  const tail: string[] = [];
  let cur = abs;

  for (let i = 0; i < 64; i++) {
    const real = safeRealpath(cur);
    if (real !== null) return tail.length === 0 ? real : path.join(real, ...tail);

    const parent = path.dirname(cur);
    if (parent === cur) break; // 到根了
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  return abs; // 一路解析不出（不该发生）→ 用词法路径
}

/**
 * 是否试图伪造审查文件（§10.4 / PRD 6.3）。该规则不受会话与 TTL 限制。
 *
 * = 形态像审查件 **且** 落在归档根内。归档根之外的同形态文件不拦——它们不进入
 * `gate` 的任何读取面（`loadRoundReviews` 只读 `_meta/review-<critic>-<runId>.json`，
 * `checkAdjudication` 只取 `listStageArtifacts` 的结果），拦它没有防御价值，
 * 只会锁死 `doc/` 下沿用同一命名规范的设计文档。
 */
export function isForgedRoleFile(
  targetPath: string,
  projectRoot: string,
  archiveRoot: string,
): boolean {
  return (
    hasCriticRoleSuffix(targetPath) &&
    isInsideArchiveResolved(targetPath, projectRoot, archiveRoot)
  );
}

/**
 * 归档内由编排器**独占维护**的文件：`_meta/` 下的全部审计材料与 `task.json`。
 *
 * Driver 合法要写的只有原稿与裁决件。`_meta/review-*.json` 是 `gate --check` 唯一的
 * 事实来源，`run-*.json` 的 sha256 与 `task.json.runs[]` 是留痕核对的锚——
 * 这些若对 Driver 开放，「改锚即可整枝绕过」（P5 不可伪装）。该规则同样不受会话与 TTL 限制。
 */
/** `.trivium/state.json` 与 `.trivium/lock/**`：闸门状态与锁，Driver 不得手工改 */
export function isTriviumStateFile(targetPath: string, projectRoot: string, triviumDir: string): boolean {
  const abs = path.isAbsolute(targetPath) ? targetPath : path.resolve(projectRoot, targetPath);
  const rel = path.relative(triviumDir, abs);
  if (rel.length === 0 || rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return rel === 'state.json' || rel === 'lock' || rel.startsWith(`lock${path.sep}`);
}

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
  /*
   * 这里用**纯后缀检查**，不做位置判定（审查意见 AGY-03）。
   *
   * 调用方 `deletedOrModifiedTracked` 传进来的范围本就是 `archiveRel`——能进
   * `tracked.modified` 的文件天然在归档根内，再判一次位置是多余的，还会给每次
   * `git commit` 加上一轮 realpath I/O。
   *
   * 也正因如此，这里**不能**换成组合判定 `isForgedRoleFile`：`base` 是 basename，
   * 位置判定会把它解析到项目根、恒判「归档外」，提交锚就此静默失效。
   */
  if (hasCriticRoleSuffix(base)) return '审查文档只能由编排器落盘，改动即伪造';
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

  if (isForgedRoleFile(target, ctx.projectRoot, ctx.archiveRoot)) {
    return deny(
      `禁止写入 ${path.basename(target)}：审查文档只能由编排器从审查员的结构化输出渲染落盘。` +
        `主脑不得自行产出归档根内的审查员后缀文件（PRD 6.3 / 设计 §10.4）。\n` +
        `  归档根之外的同形态文件不受此限——doc/ 下沿用「日期-主题-角色」命名的设计稿可正常编辑。`,
    );
  }
  // 闸门状态与锁同样是编排器独占的：Driver 用 Write 覆盖 state.json 等于自己解闸
  if (isTriviumStateFile(target, ctx.projectRoot, ctx.triviumDir)) {
    return deny(
      `禁止写入 ${path.relative(ctx.projectRoot, path.resolve(ctx.projectRoot, target))}：` +
        '.trivium/state.json 与 .trivium/lock/ 由编排器独占维护，是全部 Hook 的判定依据。' +
        '要解除闸门请走 /dual-approve 或 /dual-abandon。',
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

// ─────────────────────── hook-pre-bash ───────────────────────

/**
 * Bash 命令是否**像**在改动工作树。
 *
 * 启发式，不是 shell 语义分析：`hook-pre-write` 只挂在 Edit / Write / NotebookEdit 上，
 * `cat > src/a.ts`、`sed -i`、`tee`、`git checkout` 全是旁路——而这恰恰是模型最顺手的工具。
 * 方向取保守：宁可在闸门期多拦一条无害命令（用户可以等审完再跑），也不能放过一次写入。
 * 只在闸门期生效，日常不受影响。
 */
const WRITE_LIKE: readonly RegExp[] = [
  /(^|[^<>|&\d])>{1,2}(?!\s*(?:&|\/dev\/null))/,        // 重定向（排除 2>&1 与 > /dev/null）
  /\btee\b/,
  /\bsed\s+(?:-[A-Za-z]*i|--in-place)\b/,
  /\bperl\s+-[A-Za-z]*i\b/,
  /\b(?:rm|mv|cp|touch|mkdir|rmdir|ln|install|rsync|patch|dd|truncate|chmod|chown|unzip|tar)\b/,
  /\bgit\s+(?:-[^\s]+\s+)*(?:checkout|restore|switch|stash|reset|apply|am|cherry-pick|merge|rebase|pull|revert|clean|mv|rm|commit)\b/,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add|remove|rm|uninstall|update|up|pkg|link)\b/,
  /\bpip3?\s+(?:install|uninstall)\b/,
  /\bcargo\s+(?:add|remove|install)\b/,
  /\bgo\s+(?:get|mod)\b/,
  /\bopen\([^)]*['"][wax]/,          // python open(..., 'w')
  /\b(?:writeFile|appendFile|mkdirSync|rmSync)\w*\(/, // node -e
  /\b(?:write_text|write_bytes|rmtree|unlink|makedirs)\(/, // python pathlib / shutil / os
  /\b(?:os|shutil)\.(?:remove|rename|replace|copy\w*|move)\(/,
];

/**
 * 剥掉 heredoc 正文（`<<'TAG' … TAG`）：那是喂给命令的**数据**，不是命令。
 * 不剥的话，`python3 - <<'PY'` 里嵌着的测试源码只要含 `writeFile(` 或 `-gemini.md`
 * 字样就会被当成真实写命令——本项目自己的实施过程就被这条误报拦过。
 * 代价是 heredoc 喂给解释器的脚本本身若写文件，这里看不见；启发式本就不追求完备。
 */
export function stripHeredocs(cmd: string): string {
  // 保留标记所在的整行（`cat <<'EOF' > src/a.ts` 的重定向就在那一行），只剥正文与终止符
  return cmd.replace(
    /(<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2[^\n]*\n)[\s\S]*?\n\s*\3(?=\s|$)/g,
    '$1__HEREDOC_BODY__',
  );
}

export function looksLikeWriteCommand(cmd: string): boolean {
  const effective = stripHeredocs(cmd);
  return WRITE_LIKE.some((re) => re.test(effective));
}

/**
 * 命令段里的候选路径 token：剥掉前导重定向符与选项，其余一律当作可能的路径。
 * `cat q >x.json` 与 `cat q > x.json` 都要能取到 `x.json`。
 */
function candidatePathTokens(segment: string): string[] {
  const out: string[] = [];
  for (const raw of tokenize(segment)) {
    const t = raw.replace(/^\d*(?:>{1,2}|<)/, '');
    if (t.length === 0 || t.startsWith('-')) continue;
    out.push(t);
  }
  return out;
}

/**
 * 字面兜底：token 里直接出现独占对象的**路径组件**。
 *
 * 归一化判定要求推断得出当前目录，而 `cd $VAR`、子 shell 都会让它失效。
 * 这条不依赖当前目录：`rm -rf _meta`、`> ../x/task.json` 一律命中。
 * 误报代价低（改归档内的合法文件可以用 Write 工具），与规则 1 的保守取向一致。
 *
 * 边界用「非路径字符」而不是 `/` 或行尾：`tokenize` 会吃掉引号，
 * `open('.trivium/state.json','w')` 出来是 `open(.trivium/state.json,w)`——
 * 路径尾部是逗号、括号而非 `/`。但 `my_meta`、`state.jsonx` 不能误命中，
 * 故前后都排除构成文件名的字符（`\w`、`.`、`-`）。
 */
const MENTIONS_OWNED = /(?:^|[^\w.\-])(?:_meta|task\.json|state\.json|\.trivium)(?:$|[^\w\-])/;

/**
 * 一个已归一化的绝对路径是否是编排器独占对象。
 *
 * 独占集合：
 *   - `.trivium` 目录本身，及其下的 `state.json` / `lock` / `bin`
 *     （`bin` 是审查意见 AGY-03：wrapper 一旦被删或去掉执行位，
 *      `.claude/settings.json` 里每条 Hook 的存在性守卫都会永真放行，
 *      整套闸门被一次性解除——它必须和判定文件同级受保护）
 *   - 归档根本身，及其下任意含 `_meta` 组件的路径、任意 `task.json`
 */
function isOrchestratorOwnedPath(abs: string, ctx: Ctx): boolean {
  if (isInside(ctx.triviumDir, abs)) {
    const rel = path.relative(ctx.triviumDir, abs);
    if (rel === '') return true;
    const head = rel.split(path.sep)[0]!;
    return head === 'state.json' || head === 'lock' || head === 'bin';
  }
  if (isInside(ctx.archiveRoot, abs)) {
    const rel = path.relative(ctx.archiveRoot, abs);
    if (rel === '') return true;
    const parts = rel.split(path.sep);
    return parts.includes('_meta') || parts[parts.length - 1] === 'task.json';
  }
  return false;
}

/*
 * ## 为什么这里没有「git commit 豁免」（RV-B1，已撤回）
 *
 * 曾经加过一条豁免：整条命令就是一次 `git commit` 时跳过本函数的保护集扫描，
 * 动机是 commit message 天然会提到归档文件名，而字面扫描区分不了「写它」与「说它」。
 * 论据看着也成立：commit 不改工作树，参数是 message、pathspec 与 `-F` 读的文件。
 *
 * 双审把它打穿了（2026-09-12，11 条意见全部接受，留痕见 `.reviews/RV-B1-commit豁免/`）。
 * 三个前置条件（单段 / 无命令替换 / 无 heredoc）至少漏掉五条路径，其中三条实测放行：
 *   · 换行：`git commit -m x` + 换行 + `rm …-gemini.md`——分段正则不含 `\n`，shell 却照执行
 *   · 附着重定向：`git commit -m x > …-glm.md`——重定向符不是分段字符，目标不参与任何检查
 *   · 文本提及：`echo 记得 git commit > …/_meta/review-glm-R1.json`——根本不是 commit，
 *     只因 `parseGitSegment` 的兜底正则见到 git 与 commit 同现就按提交论
 * 另有 `-c core.editor=…` / `GIT_EDITOR=…` 经 shell 执行、进程替换 `<(…)` 两条。
 *
 * 结论不是「再收窄一点」，而是**这个方向本身不成立**：原判定是 fail-closed（看见字面
 * 就拦，代价是误拦），豁免把它变成需要穷举危险形态的 fail-open，而 shell 的攻击面
 * 穷举不完。误拦有零成本出口（Write / Edit 工具落文件，提交用 `git commit -F <文件>`），
 * 漏拦则直接击穿「编排器独占对象任何时候都 deny」，且这条路没有任何跑后兜底。
 *
 * 本轮发现的五类形态已作为负例留在 `test/unit/hooks.test.ts`，谁再开这个口子会当场红。
 */

/**
 * 分段字符。**含换行**：`git commit -m x` 换行后接 `rm …` 时，shell 把第二行当独立命令
 * 执行，而分段正则若不含 `\n`，两行会被当成一段——`cd` 段的 `continue` 会让整段后续
 * token 漏检（审查意见 AGY-01）。
 */
const SEGMENT_SPLIT = /(?:&&|\|\||[;&|\n\r])/;

/**
 * 角色后缀字面量（宽口径：词边界，不锚定行尾，不看 basename）。
 *
 * 出现在命令文本任何位置都拦——见下方「为什么 Bash 侧不做收窄」。
 */
const ROLE_SUFFIX_ANYWHERE = new RegExp(`-(?:${CRITICS.join('|')})\\.md\\b`);

/*
 * ## 为什么 Bash 侧不做收窄（2026-09-14，代码双审后撤回）
 *
 * Write/Edit 侧已按「归档内才拦」收窄，解掉了 `doc/` 下设计文档被锁死的痛点。
 * Bash 侧曾同步尝试收窄（「宽介入、严放行」：只有全部含后缀的 token 都是干净纯路径、
 * cwd 可推断、解析后在归档外，且同段没有别的 token 指进归档根时才放行），
 * 三轮双审逐一打穿，最终撤回：
 *
 *   · plan r1：`core.editor=rm …`、`GIT_EDITOR=…`、`sh -c "…"`、`<(rm …)`
 *     —— `path.resolve` 对任何字符串都返回路径，「解析成功」被当成了「解析正确」
 *   · plan r2：介入条件用 basename，而 `<(rm …-gemini.md)` 的 token 尾随 `)`，
 *     `$` 锚定的正则不匹配 ⇒ 规则不介入即放行，后面再严的判据都执行不到
 *   · code r1：脏 token 被 `continue` 跳过等于放行（`--target-directory=…`、`$DEST`）；
 *     「干净」用黑名单定义，漏 `~` 与 glob（`cp doc/x-glm.md ~/…/.reviews/t/plan/`
 *     在本仓库布局下直接可用）；管道两端被 `|` 拆成不同段而脱离同段检查；
 *     `(cd …)` 子 shell 不被识别为目录变更
 *
 * 压垮它的是另一件事：收窄**创设了新的系统状态**——`doc/` 下从此可以合法存在
 * `-gemini.md` 形态的文件，于是 `cp -R doc/ .reviews/t/plan/` 这类**全程不含后缀
 * 字样**的目录级搬运成为新通道，以字面量为介入信号的规则结构性失效。
 * 攻击不再需要提到后缀，补字符集与加负例都救不回来。
 *
 * 账算下来与 RV-B1 撤回时逐行同构：收益是 `git mv doc/a-glm.md doc/b.md` 这类
 * 低频命令可直接用（且有 Write/Edit 与人工两条出口），代价是把 fail-closed 变成
 * 需要穷举 shell 攻击面的 fail-open，而漏拦没有任何跑后兜底。
 *
 * 目录级搬运这条通道**不因撤回而消失**（收窄前的整条正则同样不含后缀字样时拦不住），
 * 它改由 `archive.checkStageArtifacts` 的「角色工件须在 run.json 登记内」跑后核对兜住——
 * 那是路径信号而非字面信号，对「文件怎么进来的」不敏感。
 */

/**
 * Bash 写命令是否指向编排器独占的东西（角色后缀 / _meta / task.json / state.json / lock / bin）。
 *
 * 原先用模板字面量拼正则，`[^\s]` 在模板里被 JS 解析成 `[^s]`（未识别转义丢反斜杠），
 * `task\.json` 的点同样退化为通配。**主题名只要含 ASCII 字母 `s`（session、auth_svc…），
 * 归档的 `_meta/` 与 `task.json` 对 Bash 写入就完全失防**——护栏是否生效取决于
 * 主题名怎么起（审查意见 AGY-01，本轮实跑复现）。
 *
 * 现在改为路径判定：按 `cd` 跟踪当前目录（复用 `commitTargetsProject` 的思路，
 * 审查意见 GLM-04），把候选 token 归一化成绝对路径再比对独占集合；
 * 推断不出目录时退回不依赖目录的字面兜底。
 */
function bashTargetsProtected(cmd: string, ctx: Ctx, startCwd: string): boolean {
  // ① 角色后缀：审查文档只能由编排器落盘，出现在命令任何位置都拒（收窄尝试已撤回，见上）
  if (ROLE_SUFFIX_ANYWHERE.test(cmd)) return true;

  const segments = cmd.split(SEGMENT_SPLIT);
  /** 当前目录。null 表示推断不出，此后只靠字面兜底 */
  let cwd: string | null = startCwd;

  for (const seg of segments) {
    const tokens = tokenize(seg);
    if (tokens.length === 0) continue;

    if (tokens[0] === 'cd') {
      const target = tokens[1];
      if (target === undefined || target === '-' || /[$`]/.test(target)) cwd = null;
      else cwd = cwd === null ? null : path.resolve(cwd, target);
      continue;
    }

    for (const t of candidatePathTokens(seg)) {
      if (MENTIONS_OWNED.test(t)) return true;
      if (cwd === null || /[$`]/.test(t)) continue;
      if (isOrchestratorOwnedPath(path.resolve(cwd, t), ctx)) return true;
    }
  }
  return false;
}

/**
 * `PreToolUse` 的 Bash 分支（B5）。两条规则，与 hook-pre-write 一一对应：
 *   1. 写命令指向编排器独占对象（审查文档 / _meta / task.json / state.json / lock / bin）一律拒绝；
 *   2. 闸门写锁期间，任何像在改动工作树的命令都拒绝。
 * 判不出命令行时放行——Bash 事件里没有 command 字段只可能是协议变了，别把整条工具链拦死。
 */
export async function hookPreBash(ctx: Ctx, input: HookInput): Promise<HookOutput> {
  if (input.tool_name && input.tool_name !== 'Bash') return ALLOW;
  const cmd = input.tool_input?.['command'];
  if (typeof cmd !== 'string' || cmd.trim().length === 0) return ALLOW;
  /*
   * **在未剥离 heredoc 的原文上判定**（审查意见 GLM-03）。
   *
   * 原先先剥 heredoc 再判「是否写命令」，于是 `python3 - <<'PY' … PY` 剥完只剩
   * `python3 -`，两条规则连评估机会都没有就提前放行。被豁免的恰是没有跑后兜底的对象：
   * `judgeDrift` 把归档根与 `.trivium/` 整体排除（编排器自有写入区），提交锚只在 commit 时触发。
   * 结果是一条 heredoc 就能在裁决期把 `_meta/review-<侧>-<run>.json` 改成 `findings: []`
   * 再配一张空裁决表过闸，而 RUNBOOK 宣称的「任何时候都挡」对它并不成立。
   *
   * 代价是 heredoc 正文里出现保护路径字面量的命令会被误拦（本项目实施过程中就遇到过）。
   * 这个代价是**刻意接受**的：正文写保护路径正是要防的攻击形态，
   * 而合法需求可以改用 Write 工具。`looksLikeWriteCommand` 保留剥离语义供他处使用。
   */
  const writeLike = WRITE_LIKE.some((re) => re.test(cmd));
  if (!writeLike) return ALLOW;

  const shown = cmd.length > 120 ? `${cmd.slice(0, 120)}…` : cmd;
  if (bashTargetsProtected(cmd, ctx, input.cwd ?? ctx.projectRoot)) {
    return deny(
      `禁止用 Bash 改动编排器独占的文件：${shown}\n` +
        '  两类保护对象，Bash 侧都按**命令文本出现字面量**拦（判定在未剥 heredoc 的原文上做）：\n' +
        '    · 归档内 _meta/ 与 task.json、.trivium/ 下的 state.json、lock/ 与 bin/\n' +
        '      （删掉或改坏 bin/ 会让 .claude/settings.json 里每条 Hook 的守卫永真放行）\n' +
        '    · 审查文档的角色后缀（-gemini.md / -glm.md）\n' +
        '  只能由编排器维护（FR-25 / P5）。\n' +
        '\n' +
        '  只是在文本里「提到」这些名字（写文档、脚本正文、commit message），不是要改它们？\n' +
        '  那是本 Hook 的已知误拦：看见字面就拦，区分不了「写它」与「说它」。\n' +
        '  出口：改用 Write / Edit 工具落文件，提交用 `git commit -F <文件>`——它们精确判定，不看字面。\n' +
        '  Write / Edit 对角色后缀只拦**归档根内**的目标：doc/ 下沿用「日期-主题-角色」命名的\n' +
        '  设计稿可以直接编辑，Bash 侧则维持字面拦（收窄尝试经三轮双审打穿后撤回，见 hooks.ts 注释）。\n' +
        '  这是刻意接受的取舍（正文写保护路径正是要防的攻击形态），**不要想办法绕过判定**。',
    );
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
        `${decision.reason}，此时不得用 Bash 改动工作树：${shown}\n` +
          '  这是按写命令形态的启发式判定（重定向、tee、sed -i、rm/mv/cp、git checkout…），只在闸门期生效。\n' +
          '  裁决件请用 Write 工具写进归档；其它改动请等审查结束，或\n' +
          `  通过审批：/dual-approve --topic ${gate.topic} --stage ${gate.stage}\n` +
          `  放弃闸门：/dual-abandon --topic ${gate.topic}`,
      );
    }
  }
  return ALLOW;
}

// ─────────────────────── hook-pre-commit ───────────────────────

/**
 * `git commit` 前拦截（设计 §8.5）。
 *
 * 作用域**不按会话过滤**（意见 AGY-05）：裁决完整性是仓库的属性，不是会话的属性——
 * 换个会话就能把未裁决的审查提交进去，等于这道护栏不存在。误伤面由另一侧收窄：
 * 只拦真正打在**本项目**上的提交（commitTargetsProject），仓库外的 `git -C /other commit` 不管。
 */
/**
 * 判断这次 Bash 调用是不是在提交。
 *
 * 这里是**唯一**一道过滤。`settings.json` 原先带 `if: "Bash(git commit:*)"`，但那是前缀匹配：
 * `sh -c 'git commit -m x'` 不以 `git commit` 开头，Hook 根本不触发（意见 GLM-02）。该字段已删除，
 * 本 Hook 改挂全部 Bash 事件，过滤全在进程内完成。
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
 *
 * ⚠️ **本函数的保守方向是「拦截」，禁止复用于任何放行 / 白名单判定。**
 *
 * 它处处向「是提交」倾斜：`findIndex` 在整段**任意位置**找 `git`；找不到字面 token 时
 * 用兜底正则（`git` 与 `commit` 同现即按提交论）；子命令非字面量时也按提交处理。
 * 这些在 `hookPreCommit` 方向上是对的——宁可误拦一条 `echo git commit`，
 * 也不能漏过一次违规提交（对应用例：test/unit/hooks.test.ts 的「已知过拦」一组）。
 *
 * 但同一判据换到放行方向，「宁可错拦」就变成「宁可错放」：
 * `echo 记得 git commit > …/_meta/review-glm-R1.json` 会被判成提交而获得豁免。
 * RV-B1 正是这么被打穿的（2026-09-12 双审，AGY-r2-04 / GLM-r2-03，已撤回）。
 * 要做放行判定就另写严格解析（首个 token 必须严格是 git、无 env 前缀、无兜底），
 * 不要图省事复用这一个。
 */
interface GitCall {
  subcommand: string;
  /** `-C` 等选项给出的路径；没有则为 null，表示「就在当前目录」 */
  dirOption: string | null;
}

function parseGitSegment(segment: string): GitCall | null {
  const tokens = tokenize(segment);
  const gitAt = tokens.findIndex((t) => t === 'git' || t.endsWith('/git'));
  if (gitAt < 0) {
    /*
     * 找不到字面 `git` token **不等于**这段不是提交（审查意见 GLM-02）。
     *
     * `tokenize` 把引号内的空格保留进同一个 token，于是 `sh -c 'git commit -m x'`
     * 产出的是一个 `git commit -m x`——没有任何 token 等于 `git`，原先直接返回 null，
     * `looksLikeCommit` 判「不是提交」，`hookPreCommit` 在闸门与留痕完整性检查**之前**
     * 就放行了。后果是在 `review_done_awaiting_disposition`（不加写锁的状态）下，
     * 可以绕过「裁决未齐不得提交」与 `checkArchiveIntegrity` 两条拦截，
     * 把被篡改的归档一次性洗进 HEAD——此后 git 锚对这笔篡改永久失明。
     *
     * 兜底与本函数既有的保守原则一致（子命令非字面量时按「是提交」处理）：
     * 整段里 `git` 与 `commit` 同时出现就按提交论。dirOption 取 null，
     * 于是沿用当前段的 cwd 判断目标仓库——`cd /tmp/x && sh -c 'git commit'`
     * 仍能正确判在项目外，跨仓库不误拦的性质不受影响。
     */
    return /\bgit\b[^|;&]*\bcommit\b/.test(segment) ? { subcommand: 'commit', dirOption: null } : null;
  }

  let dirOption: string | null = null;
  /** `-c alias.<name>=commit` 定义的别名：随后出现的 <name> 就是 commit */
  const commitAliases = new Set<string>();
  for (let i = gitAt + 1; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (!t.startsWith('-')) {
      /*
       * 子命令不是字面量（`git $S`、`` git `cat x` ``）→ 推断不出，按「是提交」处理：
       * 与本函数上方目录推断不出时的保守原则一致，否则 `S=commit; git $S` 直接放行。
       */
      if (/[$`]/.test(t)) return { subcommand: 'commit', dirOption };
      return { subcommand: commitAliases.has(t) ? 'commit' : t, dirOption };
    }

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
        else if (t === '-c') {
          const alias = /^alias\.([^=]+)=commit\b/.exec(val);
          if (alias) commitAliases.add(alias[1]!);
        }
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
          /*
           * 原因用透传的真实值，不再硬编码「解析失败」（审查意见 GLM-03）。
           * 不可读有两种成因：文件真的坏了，与解析成功但不合它自称的契约。
           * 后者报「解析失败」会把排障者引去查 JSON 损坏，而这条链路是提交拦截，
           * 诊断给错方向的代价最高。
           */
          : `  · 运行清单不可读：${t.relPath}（run ${t.runId}：${t.reason ?? '存在但读不出来'}）`,
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
    const msg =
      `已连续 ${count - 1} 次阻断收工仍未完成裁决，本次放行以避免死循环。\n` +
      `  ${g.topic}/${g.stage} 的裁决仍未齐备，请手工处理。`;
    // exit 0 的 stderr 不会展示给用户；systemMessage 才会——这条提示恰恰是给人看的
    return { exitCode: EXIT.OK, json: { systemMessage: msg }, stderr: msg };
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

  /*
   * 顺手按 retention.run_dir_days 清理本项目过期的运行目录。会话开始是唯一稳定的
   * pull 式时机；失败不影响会话（目录清不掉只是占空间）。
   */
  let pruned = 0;
  let scrubbed = 0;
  let scrubFailed: { dir: string; reason: string }[] = [];
  let unknown = 0;
  let unknownDirs: string[] = [];
  let incomplete: string[] = [];
  /** 清扫本身抛了：原先只在 DEBUG 下打印，新职责（凭据抹除）挂上来之后不能再静默（CODEX-06） */
  let retentionError: string | null = null;
  try {
    const { pruneRunDirs } = await import('./retention.js');
    const { wiredAdapter } = await import('./adapters/index.js');
    const r = await pruneRunDirs(ctx.config, ctx.projectRoot, { adapters: wiredAdapter });
    pruned = r.removed.length;
    scrubbed = r.scrubbed.length;
    scrubFailed = r.scrubFailed;
    unknown = r.unknown.length;
    unknownDirs = r.unknown;
    incomplete = r.incomplete;
  } catch (e) {
    retentionError = (e as Error).message;
    if (process.env['TRIVIUM_DEBUG']) console.error('[retention]', e);
  }

  const open = await listOpenGates(ctx.triviumDir);
  const running = await findRunningRuns(ctx);

  const reportable = open.filter((g) => g.state !== 'running');
  if (
    reportable.length === 0 && running.length === 0 && swept.length === 0 &&
    pruned === 0 && scrubbed === 0 && scrubFailed.length === 0 && unknown === 0 &&
    incomplete.length === 0 && retentionError === null
  ) return ALLOW;

  const lines: string[] = ['TriviumCode 待办：'];
  if (pruned > 0) {
    lines.push(`  · 已清理 ${pruned} 个超过 ${ctx.config.retention.run_dir_days} 天的运行目录（retention.run_dir_days）`);
  }
  if (scrubbed > 0) {
    lines.push(`  · 已抹除 ${scrubbed} 个运行目录的凭据副本`);
  }
  if (unknown > 0) {
    /*
     * 单独一行且纳入早退条件（代码双审 r1 CODEX-04 ≡ GLM-02）：status 读不到的目录**不会自愈**、
     * 不会被重试，副本可能一直躺到整删——只在「顺便抹了别的目录」时作为从句出现，等于静默。
     */
    lines.push(
      `  · ${unknown} 个运行目录的状态读不到（缺失或损坏），凭据副本未处理也不会自动重试——` +
        `请人工检查后删除，首个：${unknownDirs[0]}`,
    );
  }
  if (incomplete.length > 0) {
    /*
     * 「抹了但没扫完」是第三档：载体已删（不报失败），但有文件因超大/二进制被跳过、仍未脱敏。
     * 只记哨兵等于静默——哨兵在无人读的目录里（代码双审 r2 AGY-02）。
     */
    lines.push(
      `  · ${incomplete.length} 个运行目录抹除后仍有文件未扫描（超大或二进制），那几份未脱敏——` +
        `详见该侧的 scrub.json，首个：${incomplete[0]}`,
    );
  }
  if (scrubFailed.length > 0) {
    const first = scrubFailed[0]!;
    lines.push(
      `  · ${scrubFailed.length} 个运行目录的凭据副本抹除失败（首个：${first.reason}，哨兵在 ${first.dir}）——` +
        '副本仍在盘上，下次会话启动会重试',
    );
  }
  if (retentionError) {
    lines.push(`  · 运行目录清扫本身失败：${retentionError}——过期目录与凭据副本本次都没处理`);
  }
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

export type HookName = 'hook-pre-write' | 'hook-pre-bash' | 'hook-pre-commit' | 'hook-stop' | 'hook-session-start';

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
      case 'hook-pre-bash':
        return await hookPreBash(ctx, input);
      case 'hook-pre-commit':
        return await hookPreCommit(ctx, input);
      case 'hook-stop':
        return await hookStop(ctx, input);
      case 'hook-session-start':
        return await hookSessionStart(ctx);
    }
  } catch (e) {
    if (e instanceof StateCorruptError) {
      // 判定依据本身坏了 ≠ 判定不了：fail-closed。session-start 永不阻断，改为提示
      if (name === 'hook-session-start') {
        return {
          exitCode: EXIT.OK,
          json: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: `TriviumCode：${e.message}` } },
        };
      }
      return { exitCode: EXIT.GATE_BLOCK, stderr: e.message };
    }
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
      if (!st?.worker_pid) {
        /*
         * 读不到 status（运行目录被 retention 清掉、或从未写成）：拿不准就不动——
         * 但不能永远不动。超过 approval_lock_ttl_h 的 running 闸门早已不再加锁
         * （shouldLockWrites 的 TTL 判据），却会一直卡在 running 上：report / status
         * 永远显示进行中，下一轮 --start 也要靠 expect 绕过它。过了 TTL 就回收。
         */
        const ageH = (Date.now() - new Date(g.since).getTime()) / 3_600_000;
        if (!(ageH > ctx.config.gate.approval_lock_ttl_h)) continue;
        alive = false;
      } else {
        alive = (await processAlive(st.worker_pid, st.worker_started_at ?? null)).alive;
      }
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
