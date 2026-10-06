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
import { type Ctx, type RunMeta, type Stage, STAGES } from './types.js';
import { looksLikeRoleArtifact, shellQuoteArg } from './naming.js';
import { ALL_AGENT_IDS, DEFAULT_DRIVER, entryCommandOf, type AgentId } from './agents/registry.js';
import { EXIT } from './exit-codes.js';
import { listOpenGates, readState, shouldLockWrites, StateCorruptError, type GateEntry } from './state.js';
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
 * **保护集**：哪些角色后缀属于「只能由编排器落盘的审查件」（M9 第 4 步）。
 *
 * ## 为什么不是 `CRITICS`
 *
 * 此前这里用的是 `CRITICS`（`criticEnabled` 派生集合）。那在 claude 未启用为
 * 审核者时**恰好**等于「全集减 Driver」，于是判据看起来对、理由却是错的——
 * M9 翻开 claude 的 `criticEnabled` 的那一刻，`-claude.md` 会进入保护集，
 * 而它正是 **Driver 自己交卷的文件名**：归档内写裁决件会被 `isForgedRoleFile`
 * 判成伪造件而退 2，整条流水线锁死（实测：`gate-loop` 的「归档内的写入不受闸门
 * 写锁约束」一条由退 0 变退 2）。仓库根 `CLAUDE.md` 那句「你的产出后缀是 `-claude`」
 * 与 Hook 的拦截承诺，会从翻开关当日起互相矛盾。
 *
 * 正确判据是**「全部已登记角色」减「当轮 Driver」**：谁能当审核者是 `criticEnabled`
 * 的事，而谁的产出**不该由 Driver 手写**是身份的事，两者不同源。
 * **翻开关之前**两者取值恰好相同（那时 `CRITICS` 是 codex/gemini/glm），
 * 所以本次改判据**行为等价**——换的是理由，为的是翻开关那一刻不失守。
 * **翻开关之后两者不再相同**（`CRITICS` 四家、本函数三家），而这正是本改动的目的：
 * 谁能当审核者与谁的产出不该由 Driver 手写，从此各走各的判据。
 *
 * ## 与识别集的不等式
 *
 * `naming.looksLikeRoleArtifact` 用的是**全量**后缀（`suffixAlternation()`）。
 * 改动后两者不再相等：**识别集 ⊇ 保护集**，差集恰是当轮 Driver。
 * 这层不等式由 `hooks.test.ts` 的专门用例锁住——**恒成立，但证伪力有限**：
 * 那条用例自己的注释里已经算清楚了它证伪不了什么（差集断言是重言式；
 * 换回被替换掉的旧判据也不会红）。真正锁住当轮语义的是它下面那条换 Driver 的用例。
 *
 * ## `driver` 参数（EV-68 已接上，**不再是 M10 的预留接口**）
 *
 * 上一版这里写「`driver` 参数留着是为了 M10 按会话 Driver 取值」，并指出两处消费点
 * 都在模块加载期烙死缺省值。**那个时点判断已过期**：M9 第 5 步放开 `--driver` 之后，
 * 第 6 步验收就要「非缺省 Driver + `--critics claude`」跑一轮，届时两个方向当场显形
 * （它写不出自己的裁决件；claude 的产出反而失守）。所以接上的时点是 **M9 第 6 步前置**，
 * 不是 M10——EV-68 结案。
 *
 * 两处消费点现已各自处置：
 *   · 当轮面 → `hasProtectedRoleSuffix(fileName, driver)`，driver **必填**，
 *     取值由 `hookPreWrite` 经 `resolveRoundDriver` 从 `run.json.driver` 解析；
 *   · 跨时间面 → Bash 侧 `roleSuffixAnywhere()`，取值口径不变（全集减缺省 Driver），
 *     已由模块级 `const` 改惰性求值。提交锚那一处已于 M10a 第 2 步（EV-55）撤掉后缀判据，
 *     改由 run 元数据的 `artifacts[]` 登记判不可变（见 `immutableChangeReason`）。
 *
 * ## `driver` 没有默认值（第 2 轮代码双审 CODEX-03）
 *
 * 本步的手法是「漏传变编译期错误」，源头却留着 `= DEFAULT_DRIVER` 就不对称——
 * 新增调用点漏传会静默退回「缺省 Driver 的补集」，正是 EV-68 / EV-69 要消灭的形态。
 * 跨时间面的调用点（EV-55 后剩 Bash 侧两处）显式写 `criticRoleSuffixes(DEFAULT_DRIVER)`：**它们要的就是缺省值**，
 * 显式写出来比靠默认值省略更说明问题。
 *
 * ## M10a 第 5 步（D3）的变化
 *
 * 上一段说的「Bash 侧两处」已改为取 `bashProtectedRoleSuffixes()`（全集），不再调用本函数。
 * **本函数此后只剩当轮面一个消费者**（`hasProtectedRoleSuffix`）。上面「两处消费点」一段是 EV-68 时的记录，原文保留。
 */
export function criticRoleSuffixes(driver: AgentId): readonly string[] {
  return ALL_AGENT_IDS.filter((id) => id !== driver);
}

/**
 * 文件名是不是**受保护的**角色工件形态。**只问形态，不问位置。**
 *
 * 后缀集由 Agent 注册表派生，不写死字面量（`registry-parity` 的 grep 对账守着）。
 *
 * **消费者的判据含义不同，这层不对称是有意留下的**（M9 第 4 步，计划双审
 * AGY-02 ≡ CODEX-04；消费点计数由代码双审 CODEX-03 改准）。
 *
 * 角色后缀判据今天有**两处语义**：
 *
 *   · `isForgedRoleFile` / `hookPreWrite`——形态 + 位置，**当轮**语境；
 *   · `roleSuffixAnywhere()` → `bashTargetsProtected`——**跨时间**面：
 *     它无条件按命令文本里的字面后缀拦，不看位置、不看是不是本轮的文件、
 *     不受闸门与 TTL 限制。**它与提交锚不同源**：Bash 侧拿不到 run 上下文，
 *     所以 EV-55 给提交锚的修法方向（按 run 元数据的 artifacts 登记判不可变）
 *     **覆盖不到这一处**，需要单独决定。
 *
 * ## 两种语义已在签名上分家（EV-68，M9 第 6 步前置）
 *
 * 上一版这里是**一个无参函数**被两种语义共用，调用点看不出自己吃的是哪一种——
 * 这正是 EV-68 那一族缺口能长期潜伏的结构性原因。现在拆成两个具名函数：
 *
 *   · `hasProtectedRoleSuffix(fileName, driver)`——**当轮**面，`driver` **必填且无默认值**。
 *     漏传是编译期错误，不是运行期的静默回落。理由与 EV-69 登记的教训同源：
 *     `gate.ts` 的 `voidedSides` 注释原话是「可选参数的默认值让漏传静默成功」。
 *   · 跨时间面当时拆出的 `hasRoleSuffixCrossTime(fileName)` 供提交锚使用；
 *     M10a 第 2 步（EV-55）提交锚改按 `artifacts[]` 登记判不可变后，它已无消费者，
 *     随之删除（代码双审 r2 CODEX-03）。Bash 侧的跨时间面仍是 `roleSuffixAnywhere()`。
 *
 * **M10a 第 5 步（D3）**：Bash 侧那一处的后缀集已改为全集（`bashProtectedRoleSuffixes()`），
 * 不再是「全集减缺省 Driver」，因此它与本函数的取值从此不同源——当轮面减当轮 Driver，Bash 侧一家不减。
 */
export function hasProtectedRoleSuffix(fileName: string, driver: AgentId): boolean {
  return new RegExp(`-(?:${criticRoleSuffixes(driver).join('|')})\\.md$`).test(
    path.basename(fileName),
  );
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
  driver: AgentId,
): boolean {
  return (
    hasProtectedRoleSuffix(targetPath, driver) &&
    isInsideArchiveResolved(targetPath, projectRoot, archiveRoot)
  );
}

/**
 * 解析「当轮 Driver」——**只给 `isForgedRoleFile` 这一个当轮面判据用**（EV-68）。
 *
 * ## 为什么来源是 run 元数据，而不是闸门项
 *
 * 上一版计划把 `state.json` 的 `GateEntry.driver` 定为第 1 级来源，计划双审
 * **两侧独立打穿**（CODEX-01 / AGY-01）：`review.ts` 的四处 `setGateChecked`
 * （置 `running`、置 `review_done_awaiting_disposition` 等）**全都不传 driver**，
 * 唯一写闸门项 driver 的是 `cli.ts` 的两处 `awaiting_approval`，而后者以
 * 「裁决件已落盘」为前置——**Driver 写裁决件正发生在那之前**。
 * 于是在唯一要紧的那个窗口里，闸门项要么没有这个字段，要么更糟：
 * `setGate` 的 upsert 会**沿用前一条的值**（`state.ts` 的「driver 记下就不丢」），
 * 同槽位重跑换 Driver 时拿到的是**上一轮**的 driver，被当成权威值。
 *
 * 所以闸门项**不作为来源**。权威来源是运行留痕：`run.v2` 里 `driver` 是必填字段，
 * 与设计 §6.2「该判定按当轮 Driver（`run.json.driver`）泛化」的既有口径一致，
 * 也与 `cmdGate` 自己的取法（`latestRunMeta` 的 `driver`）同源。
 *
 * ## 三种结局
 *
 *   · 取到留痕 → 用它；
 *   · `scanned === 0`（该阶段从未跑过）→ 回落缺省 Driver。**这不是把「无从得知」
 *     重定义为「缺省」**，而是可用性取舍：plan/bug 阶段的原稿写在 `review --start`
 *     **之前**，那一刻该阶段一份留痕都没有，fail-closed 会当场锁死今天走得通的
 *     `/dual-review-plan`。代价是非缺省 Driver 仍写不出自己的原稿（已登记为已知边界）。
 *     **M10a 第 1 步（EV-72）的变化**：回落缺省之前先查该阶段的 `topic claim` 声明（`resolveStageDriver`
 *     的第 2 级）；非缺省 Driver 先认领、再写原稿即可，上一句的代价已不成立（EV-72 已结案）。
 *     M10b 第 2 步起，入口资产在「写原稿之前」渲染了认领步骤。上一句是当时的叙事，保留原文。
 *   · 有留痕却读不出来（一份都读不出，**或**比被采信的那份更新的读不出）→ **硬失败**：
 *     那是「留痕坏了」，不能判成「按缺省 Driver 算」，也不能判成「按上一轮 Driver 算」
 *     （计划双审 CODEX-06 / AGY-04；代码双审 GLM-01 ≡ CODEX-01 补出后一格）。
 *
 * ## 与 `cmdGate` 在中间格曾经**有意分叉**（EV-73 起同口径）
 *
 * EV-73 之前 `cmdGate` 对「最新那份坏了、较旧一份可读」是静默采信较旧的那份，本函数判红。
 * EV-73（用户 2026-10-06 定取 A）起 `cmdGate` 同样判坏、退 65、以共用出口段收尾，查看旧轮改走 `--run-id`。
 * 下面是当时维持分叉的理由，保留原文作为那次评估的出发点。
 *
 * 这不是漏改，但理由要写准（第 2 轮代码双审 GLM-03 纠正）：**跑后核对是存在的**——
 * 错误放行方向由 `archive.checkStageArtifacts` 的「角色工件须在 run.json 登记内」兜底
 * （本文件 `bashTargetsProtected` 那段注释引的就是它），`gate` 侧另有提交锚 `checkRunManifests`。
 * 上一版这里写「没有任何跑后核对能追回来」，与同一文件的那段注释自相矛盾。
 *
 * 准确的不对称在于**兜底不无条件在场**：`checkStageArtifacts` 只在 `gate --check-artifacts`
 * 路径触发，提交锚 `checkArchiveIntegrity` 并不含它，且它对 `critics_selected` 之外的角色失明；
 * 而 Hook 是拦截型，判错当场生效，`warn()` 又只写 stderr、在退 0 路径上 Driver 根本看不见。
 * 拦截侧取更严的取向仍然成立。`gate` 侧那一格是否也要收紧，
 * 需要与上述兜底的**实际覆盖面**一起评估，已单独登记 **EV-73**，不在本步。
 * （EV-73 的结论：gate 是立停点、走向审批的入口，审批落到上一轮同样是「判错当场生效」，故收紧。）
 */
/**
 * 当轮 Driver 的三级判定（M10a 第 1 步，EV-72）。
 *
 * **判定本身在 `driver-claim.ts` 的 `resolveStageDriver`，本文件只是它的一个消费点。**
 * 本函数曾经是判定的所在地，而另外三个消费点各写各的
 * `latestRunMeta(...).meta?.driver ?? null`——同一条语义两份实现、**结论相反**
 * （这里对损坏留痕硬失败，那边把它折成「零留痕」再用自声明顶上）。
 * 收成一处之后这一层只剩转发，理由见那个函数的文档块（代码双审 r1 CODEX-03 ≡ GLM-01）。
 */
async function resolveRoundDriver(ctx: Ctx, topic: string, stage: Stage) {
  const { resolveStageDriver } = await import('./driver-claim.js');
  return resolveStageDriver({ archiveRoot: ctx.archiveRoot, topic }, stage);
}

/**
 * 从归档内的目标路径解析出 `<主题>/<阶段>`，用来定位该阶段的运行留痕。
 *
 * 守卫两件事（计划双审 AGY-02 / CODEX-05）：段数与阶段合法性。归档内并非所有路径
 * 都是三段式——`<主题>/task.json`、主题根直放的文件、`<主题>/verify/*`（`verify`
 * 不是 `Stage`）都会在这里落空。
 *
 * **落空不等于放行。** 调用方此时回落缺省 Driver，即改动前的判定口径——
 * 「定位不出阶段」说的是「不知道该查哪份留痕」，不是「这个文件不用保护」。
 *
 * 两条路径都要试。只试词法会漏掉「归档外的软链指向归档内」——那条软链的词法路径
 * 在 `doc/` 下，定位必然落空；若落空即放行，`Write` 会沿链把文件在归档内创建出来，
 * 而这正是 `isInsideArchiveResolved` 那段注释点名要拦的形态（实测：会让悬空软链用例由退 2 变退 0）。
 *
 * ## realpath 优先，词法兜底——**与 `isInsideArchiveResolved` 有意不同源**
 *
 * 那个函数取词法 ∪ realpath 的**并集**，因为它问的是「要不要管」，fail-closed 方向是「都算在内」。
 * 本函数问的是「这份写入**实际落在**哪个阶段」，只能有一个答案，而写入会沿软链落到 realpath 那侧。
 * 两者口径不同是有意的，**不要为了「对齐」把其中一个改成另一个**。
 *
 * ## 顺序**有真实的行为差异**（第 2 轮代码双审 AGY-01 ≡ CODEX-02 更正）
 *
 * 第 1 轮我把这条判成「表达性修正、无可观测差异」，**那个结论是错的**，
 * 错因值得记：当时的夹具用 `t/mirror -> t/code`，而 `mirror` **不是合法 Stage**，
 * `stageSegmentsUnder` 的白名单守卫直接返回 null ⇒ 词法分支压根不命中 ⇒ 必然回退 realpath。
 * 「调换顺序用例仍绿」靠的是这个巧合，不是我当时写的「readdir 沿软链」。
 * **用「变异后用例仍绿」当等价性证据之前，要先确认那条用例真的覆盖了被变异的路径。**
 *
 * 实测（构造复现）：**文件级（终端组件）软链**是反例——
 * `t/plan/x-claude.md -> t/code/x-claude.md` 时词法定位 `t/plan`、realpath 定位 `t/code`，
 * 而这两个阶段的 `_meta` 是**不同的物理目录**，读到的是不同留痕、可能是不同 Driver。
 * 词法优先会按 `t/plan` 的 Driver 判身份，放行一份实际落在 `t/code` 的写入，
 * 覆写那一阶段受保护的审核者产出。等价只在**阶段目录整体是软链**那一格成立
 * （那时词法侧的 `_meta` 会沿同一条软链落到同一个物理目录）。
 *
 * ## 以及：解析结果落在归档外时**不得回落词法**
 *
 * 这是第 2 轮 GLM-01 报的安全缺口，由「按留痕定 driver」引入、构造实测复现过：
 * 归档外预置一份合法 run 留痕 → `ln -s <归档外目录> .reviews/<新主题>/code`
 * （Bash 侧不命中：无角色后缀字面，阶段目录本身也不在编排器独占集）→
 * 写 `.reviews/<新主题>/code/x-glm.md`。此时 realpath 解到归档外 ⇒ 段解析因 `..` 返回 null ⇒
 * **若回落词法**就会得到 `<新主题>/code`，`latestRunMeta` 再沿软链读到**攻击者的留痕**，
 * 保护集变成「全集减攻击者自选的 driver」，伪件放行。改动前保护集是静态的，没有这条通道。
 *
 * 所以落在归档外一律返回 null（⇒ 按缺省 Driver 判定，三家后缀仍受保护）。
 * 这也让本函数与 `isInsideArchiveResolved` 的口径**对齐**：那边按并集拦下
 * 「归档内软链指向归档外」的写入，这边拒绝采信归档外的留痕，同一形态不再两处相反。
 */
function locateArchiveTarget(
  targetPath: string,
  projectRoot: string,
  archiveRoot: string,
): { topic: string; stage: Stage } | null {
  const lexical = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(projectRoot, targetPath);

  const root = safeRealpath(archiveRoot);
  if (root !== null) {
    const resolved = resolveExisting(lexical);
    /*
     * 解析后落在**归档根之外** ⇒ 软链把落点引出了归档，这里必须返回 null
     * （即「定位不出」⇒ 按缺省 Driver 判定），**绝不能回落词法定位**。
     * 回落会把 driver 的来源一起带出归档根——见本函数文档块的攻击链一节。
     */
    if (!isInside(root, resolved)) return null;
    return stageSegmentsUnder(root, resolved);
  }
  // 归档根自身不可解析时才退化为纯词法（等价于改动前的行为）
  return stageSegmentsUnder(archiveRoot, lexical);
}

/** `<root>/<主题>/<阶段>/…` 的段解析。不合形态一律 null。 */
function stageSegmentsUnder(root: string, abs: string): { topic: string; stage: Stage } | null {
  const rel = path.relative(root, abs);
  if (rel.length === 0 || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  const segs = rel.split(path.sep);
  if (segs.length < 3) return null;
  const [topic, stage] = segs;
  if (topic === undefined || stage === undefined) return null;
  if (!STAGES.includes(stage as Stage)) return null;
  return { topic, stage: stage as Stage };
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
 *
 * **判据从「后缀枚举」改为「位置」（M10a 第 2 步 EV-55 §3.1.2）**：原判据靠一条
 * 正则枚举 `_meta/` 下的文件名形态（`review-*.json` / `brief-*.md` /
 * `changes-*.diff`），新增一种 `_meta/` 工件类型就要跟着改枚举——新增判据改为
 * 「位于 `_meta/` 内即不可变」，只留两个排除项（下方 run-*.json 分支、
 * `changes.diff` 便利副本）。**原稿的不可变性不在这个函数里判**：原稿不落在
 * `_meta/` 内，它的保护改由锚②（`archive.checkRecordedArtifacts`）按 §3.1.1 的
 * 登记承接——谁登记了谁不可变，这个函数不需要认得「什么是原稿」。
 */
async function immutableChangeReason(projectRoot: string, relFromRoot: string): Promise<string | null> {
  const base = path.basename(relFromRoot);
  const inMeta = relFromRoot.split('/').includes('_meta');
  /*
   * **不再按角色后缀判**（M10a 第 2 步代码双审 r2 CODEX-03）。
   *
   * 上一版这里第一支是 `hasRoleSuffixCrossTime(base)`：保护集「全集减**缺省** Driver」。
   * 它区分不了「Driver 自己的原稿 / 裁决件」与「同名历史审查件」，于是当轮 Driver
   * 不是缺省值时，它自己的 `-<id>.md` 原稿与 `-response-<id>.md` 裁决件被判
   * 「改动即伪造」——计划 §3.1.4 的行为表与 §3.1.5 的出口对那一族不成立。
   *
   * 删掉它保护不丢：审查文档自 M1 起就在收尾时登记进 `artifacts[]`
   * （`review.ts` 里 `artifacts.push(written.absPath)` → `meta.artifacts`），
   * 由锚②（`archive.checkRecordedArtifacts`）按登记 sha256 核对——这正是计划
   * §3.1.2「原稿与审查件的不可变性改由锚②按登记承接」的本意。删除则由锚①兜住。
   */
  if (inMeta && /^run-.+\.json$/.test(base)) {
    /*
     * run.json 只在运行**期间**被编排器改写（骨架 → 收尾）。已提交的版本若还是
     * `running`，说明有人在运行中途提交过，本次改动是正常收尾，不能拦。
     *
     * **这一支必须排在下面的 `_meta/` 位置判据之前求值**：位置判据本会把
     * `run-*.json` 也判成不可变，`run-*.json` 需要这条更细的例外先拦下、
     * 不落到位置判据的通用拒绝上。
     */
    const { readAtHead } = await import('./util/git.js');
    const head = await readAtHead(projectRoot, relFromRoot);
    if (head) {
      let headStatus: string | undefined;
      try {
        headStatus = (JSON.parse(head) as { status?: string }).status;
      } catch {
        /* HEAD 里的版本本身就坏了：按不可变处理 */
      }
      if (headStatus === 'running') {
        const work = await fs.readFile(path.join(projectRoot, relFromRoot), 'utf8').catch(() => null);
        return runningRewriteViolation(head, work);
      }
    }
    return '运行清单是留痕核对的锚，改锚即可整枝绕过';
  }
  if (inMeta && base !== 'changes.diff') {
    /*
     * 便利副本 `changes.diff` 每轮覆盖写（`.reviews/README.md` 记载的就是这个
     * 名字），受保护的是同目录下带 run_id 的那份（已命中 `review-*` / `brief-*` /
     * `changes-*.diff` 等旧枚举，现由本条位置判据统一覆盖）。
     */
    return '_meta/ 下的审计材料一经落盘即不可变（changes.diff 便利副本除外）';
  }
  return null;
}

/**
 * running 态 run.json 的改写是否越出「正常收尾」（M10a 第 2 步代码双审 r3 CODEX-01 ≡ GLM-01）。
 *
 * 上一版只看 HEAD 里的 `status === 'running'` 就放行，对改写内容零校验：
 * 「运行中途提交过一次」之后，同一次提交里既改审查文档 / 原稿、又改 `artifacts[]`
 * 里它的 sha256（或删掉条目），锚② 读到的是被同步改过的期望值，自证清白。
 * 删掉提交锚的后缀支之后，那是这些文件唯一的一道保护。
 *
 * 收尾对 `artifacts[]` 只做**追加**（`review.ts` 收尾合并用的是展开追加），
 * 所以正常收尾满足：同一 `run_id`、HEAD 里的每条登记原样保留。据此收窄：
 *   · 工作树版本读不出 / 解析不了 ⇒ 拦（收尾从不写坏 JSON）；
 *   · `run_id` 变了 ⇒ 拦；
 *   · HEAD 里任一 `artifacts[]` 条目在工作树版本里消失或 sha256 变了 ⇒ 拦。
 *
 * **剩余边界，不写成确定性保证**：收尾**新追加**的条目（审查文档、原稿）在追加那一刻
 * 仍可被同步改写——那段窗口由写侧（Write/Edit 精确拦、Bash 启发式拦）承担；
 * 已落盘未登记时进程崩溃并被提交的审查文档（r3 GLM-02）同属此类。
 * running 态可以被一直延续，但延续期间只能追加、不能改写已登记条目。
 *
 * 返回 null 表示放行。
 */
export function runningRewriteViolation(headText: string, workText: string | null): string | null {
  type Manifest = { run_id?: unknown; artifacts?: Array<{ path?: unknown; sha256?: unknown }> };
  let head: Manifest;
  let work: Manifest;
  try {
    head = JSON.parse(headText) as Manifest;
  } catch {
    return '运行清单是留痕核对的锚，改锚即可整枝绕过';
  }
  if (workText === null) return '运行中的运行清单读不出来：收尾回写不会产生这种状态';
  try {
    work = JSON.parse(workText) as Manifest;
  } catch {
    return '运行中的运行清单被改成了不可解析的内容：收尾回写不会产生这种状态';
  }
  if (work.run_id !== head.run_id) return '运行中的运行清单 run_id 被改动：收尾回写不会改 run_id';
  const workEntries = new Map<unknown, unknown>();
  for (const a of work.artifacts ?? []) workEntries.set(a.path, a.sha256);
  for (const a of head.artifacts ?? []) {
    if (!workEntries.has(a.path)) {
      return `运行中的运行清单删掉了已登记条目 ${String(a.path)}：收尾只追加登记，不删改`;
    }
    if (workEntries.get(a.path) !== a.sha256) {
      return `运行中的运行清单改写了已登记条目 ${String(a.path)} 的 sha256：收尾只追加登记，不删改`;
    }
  }
  return null;
}

// ─────────────────────── hook-pre-write ───────────────────────

/**
 * 写入前拦截（设计 §8.4 第 3 层）。
 *
 * 两条独立规则：
 *   1. **伪造审查文件**：写归档内带**受保护角色后缀**的文件一律拒绝。
 *      判据见 `hasProtectedRoleSuffix(target, driver)`：保护集是全部已登记角色减**当轮** Driver，
 *      `driver` 由 `resolveRoundDriver` 按三级判定解析（运行留痕 → 认领声明 → 缺省），
 *      不是缺省 Driver（M10b 第 2 步改准：此前这里指向 `criticRoleSuffixes(DEFAULT_DRIVER)`，
 *      括注却写「减当轮 Driver」，指针与括注互相矛盾）——
 *      **不在这里重抄一份枚举**：抄的那份会随注册表漂移，而它今天就已经漏过
 *      `-codex.md`（M8 起 codex 已在保护集内，这句话却只列了两家）。
 *      主脑不得自己编一份审查（PRD 6.3）——该规则**不受**会话与 TTL 限制。
 *   2. **闸门写锁**：本会话触发的未审批闸门期间，禁止写归档根之外的文件。
 */
export async function hookPreWrite(ctx: Ctx, input: HookInput): Promise<HookOutput> {
  const target = extractTargetPath(input);
  if (!target) return ALLOW; // 拿不到路径就别拦，宁可放过也不误伤

  /*
   * ## 短路顺序（EV-68，计划双审 CODEX-05 / AGY-02）
   *
   * 当轮 Driver 解析要读 run 元数据（readdir + 逐份解析校验），而本函数拦的是
   * **全工作区**的每一次 Edit/Write。所以先用两个纯词法/纯路径的判据挡住绝大多数调用：
   *   ① 文件名不是角色工件形态 → 直接走后续判定，**一次留痕都不读**；
   *   ② 不在归档内 → 同上。
   *
   * 这两条命中才解析 driver。这样「非角色后缀、或归档外的写入」其退出码
   * 不因本步新增的读取而改变——关掉写锁的项目（`block_business_write_when_awaiting_approval`
   * 为 false）今天在业务写入前根本不读任何状态文件，改后依然不读。
   * 该性质由这个短路条件**结构性**保证——不是靠断言兜住的：一条只看退出码的用例
   * 区分不了「解析被前置」与「解析没被前置」（两条路径都退 0）。用例锁的是
   * 「退出码不受影响」，鉴别力来自夹具里那份**读不出的留痕**（代码双审 CODEX-05 ≡ GLM-03）。
   */
  if (
    looksLikeRoleArtifact(path.basename(target)) &&
    isInsideArchiveResolved(target, ctx.projectRoot, ctx.archiveRoot)
  ) {
    /*
     * 定位不出 `<主题>/<阶段>` 时**回落缺省 Driver**，即改动前的判定口径——
     * 不是跳过判定。归档内的两段式路径（`<主题>/x-gemini.md`）、`verify/` 下的文件
     * 原本都会被拦，跳过判定会把它们一起放行，那是安全回归而不是守卫。
     */
    const loc = locateArchiveTarget(target, ctx.projectRoot, ctx.archiveRoot);
    let driver: AgentId = DEFAULT_DRIVER;
    let why = '定位不出所属阶段，按缺省 Driver 判定';
    if (loc) {
      const res = await resolveRoundDriver(ctx, loc.topic, loc.stage);
      if (res.kind === 'corrupt') {
        /*
         * 出口与其余七处同状态的拒绝**共用一段**（`meta.ts` 的 `unreadableRunMetaExitAt`，
         * 留痕读不出的出口计划 r2 §2.2）。
         * 更早一版写的是「请先修复或清理该阶段 _meta/ 下的运行清单」——对受话人是死路：
         * Driver 对 `_meta/` 的任何写都会被本 Hook 自己拒绝，已登记的 run 清单又被提交锚判为不可变
         * （第 2 轮代码双审 GLM-02 ≡ CODEX-01）。之后改成的「重跑该阶段双审」同样走不通：
         * `review --start` 在冻结送审包之前就按同一个 `corrupt` 判定拒绝。共用段按成因给出口。
         */
        const { unreadableRunMetaExitAt } = await import('./meta.js');
        return deny(
          `无法判定当轮 Driver：${loc.topic} / ${loc.stage} 的运行留痕读不出来` +
            `（${res.unreadable.join('、')}）——文件损坏、schema 不识，或不合 run.v1/v2 契约。\n` +
            '  「审查文档只能由编排器落盘」这条判定要先知道本轮执笔者是谁，留痕坏了就判不了。\n' +
            '  这里**不**按缺省 Driver 继续，**也不**退回更旧的那一份——前者把「留痕坏了」\n' +
            '  判成「按缺省算」，后者判成「按上一轮的执笔者算」，两条都会让判定悄悄用错身份。\n' +
            unreadableRunMetaExitAt({ archiveRoot: ctx.archiveRoot, topic: loc.topic }, loc.stage, res.unreadable),
        );
      }
      driver = res.driver;
      // 三级判定各有各的来源句——判错身份时用户要能从文案里看出是哪一级出的问题
      why = {
        run: '取自该阶段最近一份运行留痕',
        claim: '该阶段尚无运行留痕，取自 topic claim 的声明',
        default: '该阶段既无运行留痕也无声明，按缺省 Driver 判定',
      }[res.source];
    }
    // 外层 `if` 已确立落在归档内，这里只问后缀——不再走 `isForgedRoleFile`，
    // 那会把 realpath 解析重跑第三遍（代码双审 AGY-01）。该函数本身保留为完整语义判据。
    if (hasProtectedRoleSuffix(target, driver)) {
      return deny(
        `禁止写入 ${path.basename(target)}：审查文档只能由编排器从审查员的结构化输出渲染落盘。` +
          `主脑不得自行产出归档根内的审查员后缀文件（PRD 6.3 / 设计 §10.4）。\n` +
          `  本轮 Driver 判定为「${driver}」（${why}），其余已登记角色的后缀均受保护。\n` +
          `  归档根之外的同形态文件不受此限——doc/ 下沿用「日期-主题-角色」命名的设计稿可正常编辑。`,
      );
    }
  }
  // 闸门状态与锁同样是编排器独占的：Driver 用 Write 覆盖 state.json 等于自己解闸
  if (isTriviumStateFile(target, ctx.projectRoot, ctx.triviumDir)) {
    return deny(
      `禁止写入 ${path.relative(ctx.projectRoot, path.resolve(ctx.projectRoot, target))}：` +
        '.trivium/state.json 与 .trivium/lock/ 由编排器独占维护，是全部 Hook 的判定依据。' +
        // 这一支不经当轮 Driver 判定（状态文件对谁都禁写）；写法取值同提交 Hook 那处的说明
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
          /*
           * 调用写法按记下这道闸门的 Driver（M10b 第 3 步）；旧闸门没有 driver 字段时回落缺省 Driver。
           * 这里**只拿闸门项的 `driver` 选写法，不参与身份判定**（代码双审 r3 CODEX-05）：本模块头部 EV-68 那段写明
           * 闸门项不作当轮身份来源（同槽位重跑换 Driver 时它留着上一轮的值）；锁分支可能同时开着多道闸门，
           * 拿不到单一的「当轮」。最坏情况是给出上一轮 Driver 的写法——今天带 Hook 的两家写法相同，看不出差别。
           * 下面 Bash 拦截与会话开场待办两处同此。
           */
          `  通过审批：${entryCommandOf(gate.driver, 'dual-approve')} --topic ${shellQuoteArg(gate.topic)} --stage ${gate.stage}\n` +
          `  拒绝：    ${entryCommandOf(gate.driver, 'dual-approve')} --topic ${shellQuoteArg(gate.topic)} --stage ${gate.stage} --reject --reason <理由>\n` +
          `  放弃闸门：${entryCommandOf(gate.driver, 'dual-abandon')} --topic ${shellQuoteArg(gate.topic)}`,
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
/**
 * 需要额外吃掉一个参数值的 git 全局选项（`WRITE_LIKE` 与 `commitTargetsProject` 共用）。
 *
 * 按 git(1) 的全局选项列出；`--shallow-file` 是内部 / 测试用旗标，同样取值分离，
 * 一并收进来（代码双审 r3 GLM-05）。集合是照文档枚举的，git 新增全局选项时不会自动跟上——
 * 判据本身仍属启发式、不完备。
 */
const GIT_OPTS_WITH_VALUE = new Set([
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env', '--shallow-file',
]);

/**
 * git 子命令之前的全局选项前缀。
 *
 * **取值型选项要多吃一个 token**（M10a 第 2 步代码双审 r2 CODEX-01）：上一版只写了
 * `(?:-[^\s]+\s+)*`，吃得下 `--git-dir=x` 这种自带取值的形态，吃不下
 * `git -c core.quotePath=false restore …` / `git -C <目录> checkout …`——取值那个词
 * 不以 `-` 开头，前缀就此断掉，整条命令判「不像写命令」，`hookPreBash` 的两条规则
 * 在第一道门就一起放行。取值允许带引号段（`-c core.editor="a b"`）。
 */
export const GIT_OPT_PREFIX =
  `(?:(?:${[...GIT_OPTS_WITH_VALUE].join('|')})\\s+(?:[^\\s"']|"[^"]*"|'[^']*')+\\s+|-[^\\s]+\\s+)*`;

const WRITE_LIKE: readonly RegExp[] = [
  /(^|[^<>|&\d])>{1,2}(?!\s*(?:&|\/dev\/null))/,        // 重定向（排除 2>&1 与 > /dev/null）
  /\btee\b/,
  /\bsed\s+(?:-[A-Za-z]*i|--in-place)\b/,
  /\bperl\s+-[A-Za-z]*i\b/,
  /\b(?:rm|mv|cp|touch|mkdir|rmdir|ln|install|rsync|patch|dd|truncate|chmod|chown|unzip|tar)\b/,
  new RegExp(
    `\\bgit\\s+${GIT_OPT_PREFIX}(?:checkout|restore|switch|stash|reset|apply|am|cherry-pick|merge|rebase|pull|revert|clean|mv|rm|commit)\\b`,
  ),
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
 *     **M10b 第 2 步更正（EV-61 ⑥，计划 r5 §1.2）**：上面那句的因果只对守卫修好之前成立。
 *     守卫改为区分两种情形之后（本文件头注释、`hooks.json` 的 `_comment`）：被删或去掉执行位 ⇒ 守卫
 *     保守拦截（exit 2）；wrapper **内容被替换**为放行脚本才会永真放行；Hook 配置段或 `.trivium/`
 *     整体被移除 ⇒ 不再有任何拦截。`bin` 仍须受保护，理由换成后两条。原句保留作当时的叙事。
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
 *
 * 后缀集取**跨时间**口径（`criticRoleSuffixes(DEFAULT_DRIVER)`，即全集减**缺省** Driver），
 * 与 Write/Edit 侧的当轮口径**有意不同**（提交锚已于 EV-55 改按登记判定，不再共用）——这一处要对历史文件与
 * 纯文本表态，拿不到 run 上下文，也就没有「当轮 Driver」可言（EV-68 / EV-55）。
 *
 * **惰性求值**（EV-68）：上一版是模块级 `const`，正则在**模块加载期**就固化了。
 * 那个固化是隐式的副作用——本步把它变成一个显式取值点，口径一字未改，
 * 好让 EV-55 真做跨时间面收口时不必先拆一次模块加载期的耦合。
 */
/*
 * ## M10a 第 5 步（D3）：后缀集改为**全集**
 *
 * 上面那段「跨时间口径（全集减缺省 Driver）」是 EV-68 / EV-55 时的写法，原文保留作历史。
 * M10a 计划 r7 §3.2 / A3 决定 Bash 侧改为**全部已登记角色的后缀都拦**（四家，含当轮 Driver 自己的）；
 * 第 2 步没有实施、也没有获批的撤回记录，第 5 步段一补上（第 5 步计划 r2 §2.1）。
 *
 * 为什么不是「全集减缺省 Driver」：M10a 第 3 步翻开 `driverEnabled` 之后，当轮 Driver 可以是任一家，
 * 缺省 Driver 的后缀在非缺省轮次里恰是**审核者**的产出。这里拿不到 run 上下文、判不出当轮，
 * 减掉任何一家都会让那一家在某些轮次里失守；唯一不依赖「当轮」的取值是全集。
 *
 * 代价（r7 §3.2.1，R22 已登记）：命令文本提到**当轮 Driver 自己的**后缀的写形态命令同样被拦，
 * 包括缺省 Driver 的 `-claude.md`。出口不变：Write / Edit 落文件、`git commit -F`、
 * 恢复与清理在终端执行。**不做收窄、不开白名单**（下方「为什么 Bash 侧不做收窄」、RV-B1）。
 *
 * 判据与 `hookPreBash` 拦截文案**同源**：两处都取 {@link bashProtectedRoleSuffixes}。
 * 上一版是两个独立取值点，只改一处就会出现「拦下了却少列一个后缀」的提示。
 */
export function bashProtectedRoleSuffixes(): readonly string[] {
  return ALL_AGENT_IDS;
}

function roleSuffixAnywhere(): RegExp {
  return new RegExp(`-(?:${bashProtectedRoleSuffixes().join('|')})\\.md\\b`);
}

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
  if (roleSuffixAnywhere().test(cmd)) return true;

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
        '      （bin/ 被删或去掉执行位 ⇒ 守卫保守拦截；wrapper **内容被替换** ⇒ 每条 Hook 的守卫永真放行；\n' +
        '        Hook 配置段或 .trivium/ 整体被移除 ⇒ 不再有任何拦截）\n' +
        `    · 角色工件的后缀（${bashProtectedRoleSuffixes().map((s) => `-${s}.md`).join(' / ')}）——\n` +
        '      **全部已登记角色，含当轮 Driver 自己的**：Bash 侧拿不到「当轮」，只能全集字面拦\n' +
        '  审查文档与审计材料只能由编排器维护（FR-25 / P5）；Driver 自己的原稿与裁决件请用 Write / Edit 落笔。\n' +
        '\n' +
        '  只是在文本里「提到」这些名字（写文档、脚本正文、commit message），不是要改它们？\n' +
        '  那是本 Hook 的已知误拦：看见字面就拦，区分不了「写它」与「说它」。\n' +
        '  出口：改用 Write / Edit 工具落文件，提交用 `git commit -F <文件>`——它们精确判定，不看字面。\n' +
        '  Write / Edit 对角色后缀只拦**归档根内**的目标：doc/ 下沿用「日期-主题-角色」命名的\n' +
        '  设计稿可以直接编辑，Bash 侧则维持字面拦（收窄尝试经三轮双审打穿后撤回，见 hooks.ts 注释）。\n' +
        '  这是刻意接受的取舍（正文写保护路径正是要防的攻击形态），**不要想办法绕过判定**。\n' +
        '\n' +
        '  确实要**恢复**一个被误改的受保护文件（`git checkout --` / `git restore`）？\n' +
        '  请在终端里手动执行。那条命令本身会提到同一个受保护路径，常规写法在会话里会被\n' +
        '  这条判据再拦一次（M10a 第 2 步 EV-55 §3.2.2）。这条判据是按命令形态的启发式、\n' +
        '  并不完备——但换一种写法让它认不出来属于绕过判定，不是出口。',
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
          `  通过审批：${entryCommandOf(gate.driver, 'dual-approve')} --topic ${shellQuoteArg(gate.topic)} --stage ${gate.stage}\n` +
          `  放弃闸门：${entryCommandOf(gate.driver, 'dual-abandon')} --topic ${shellQuoteArg(gate.topic)}`,
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

// ─────────────── 待裁决闸门的只读失守文案（EV-98 文案部分） ───────────────

/*
 * 确证改动的只读失守（`gate.ts` 的 `classifyReadonlyBreach` 判 `confirmed`）时 `gate --check` 必败
 * （`readonly_breach` failure），闸门停在 `review_done_awaiting_disposition`，两处 Hook 照旧拦——
 * 但原文案一律说「未逐条裁决」，把 Driver 引去补裁决件，而补多少都解不开（EV-79 代码双审 r2：
 * 22 条裁决齐备、最终 abandon）。
 *
 * **失守项只收确证格**（只读失守未确证改动放行计划 r2 §3，用户决策 2026-10-06）：复算无变化或比不了的
 * 失守轮，`gate --check` 降为告警放行，补齐裁决件就解得开——那一轮按普通轮出原文案，逐字不变。
 *
 * 这里只换给人看的文字：退出码、是否拦、阻断计数都在读留痕之前定好，读取结果只选文案。
 * 所以不需要 `resolveRoundDriver` 那套 realpath / 软链守卫——伪造一份失守留痕的最坏后果
 * 是把「未裁决」说成「失守」，拦截照旧（计划 r2 §4 R1）。
 */

/** 本轮失守的一个闸门项与它那一轮的运行留痕 */
interface BreachedGate {
  g: GateEntry;
  meta: RunMeta;
}

/**
 * 该闸门项**这一轮**是否记录了只读失守。
 *
 * 按闸门项的 `run_id` 直读那一份（`readRunMeta`），**不用 `latestRunMeta`**（计划 r2 §2.1）：
 * 后者遇读不出的留痕会 `warn` 到进程 stderr，「读不出时文案逐字不变」当场不成立；
 * 而闸门项的 `run_id` 就是置这一格的那次运行，直读天然是「这一轮」。
 *
 * 已知边界（计划 r2 §4 R4）：这一轮读不出、更旧一轮记着失守时，这里判「未见失守」出原文案，
 * 而不带 `--run-id` 的 `gate --check` 会退回更旧一轮报失守。不改——那一格本身是留痕坏了。
 */
async function roundBreach(ctx: Ctx, g: GateEntry): Promise<BreachedGate | null> {
  // `readState` 不校验条目形状：被手改或旧版写出的 state.json 缺键时是 undefined，与 null 同按「没有留痕可读」（代码双审 CODEX-02）
  if (!g.run_id) return null;
  const { readRunMeta } = await import('./meta.js');
  const meta = await readRunMeta({ archiveRoot: ctx.archiveRoot, topic: g.topic }, g.stage, g.run_id);
  if (meta?.guard.readonly_breach !== true) return null;
  // 判据与 gate --check 同一个函数（计划 r2 §3，决策四）：未确证的失守轮按普通轮处理
  const { classifyReadonlyBreach } = await import('./gate.js');
  return classifyReadonlyBreach(meta.snapshot.drift) === 'confirmed' ? { g, meta } : null;
}

/** 把待裁决闸门按「本轮失守 B / 未见失守 N」拆开，保持原顺序 */
async function splitByBreach(
  ctx: Ctx,
  pending: GateEntry[],
): Promise<{ normal: GateEntry[]; breached: BreachedGate[] }> {
  const normal: GateEntry[] = [];
  const breached: BreachedGate[] = [];
  for (const g of pending) {
    const b = await roundBreach(ctx, g);
    if (b) breached.push(b);
    else normal.push(g);
  }
  return { normal, breached };
}

const gateLabel = (g: GateEntry): string => `${g.topic}/${g.stage}`;

/*
 * 「gate --check 对这类只读失守判失败」陈述的是 `checkAdjudication` 只对 `classifyReadonlyBreach`
 * 判确证的失守推 failure 这件事（`gate.ts` 的 `READONLY_BREACH_TRIAGE` 旁有互指注释）。
 * 判据再变时这句要同改；`gate-loop` 集成用例（齐裁决件仍失败 + Hook 说失守）会先红。
 */
const BREACH_UNFIXABLE =
  '这道闸门靠补裁决件解不开——跑后复算确证审查期间工作树有改动，gate --check 对这类只读失守判失败，裁决件写得再齐也不放行';

/**
 * 快照漂移的实际取值，按 Hook 已读到的那份留痕直接写出（计划双审 CODEX-08）。
 * 失守项只收确证格，`changed` 恒 true、无 `unknown_reason`，摘要与 `gate --check` 同源（`confirmedDriftText`）。
 */
async function driftText(meta: RunMeta): Promise<string> {
  const { confirmedDriftText } = await import('./gate.js');
  const t = confirmedDriftText(meta.snapshot.drift);
  return meta.snapshot.drift.files.length > 0 ? `检出 ${t}` : t;
}

/**
 * 失守段的逐项段 + 共用处置段（计划 r2 §2.3）。首句由调用方各写各的。
 *
 * 处置判据句取 `gate.ts` 的 `READONLY_BREACH_TRIAGE`，与 `gate --check` 只有一份来源（CODEX-01）；
 * 作废命令按该轮 run.json 的 `driver` 取写法（CODEX-04），每个失守项各给一条（AGY-01）。
 */
async function breachLines(items: BreachedGate[], indent: string): Promise<string[]> {
  const { READONLY_BREACH_TRIAGE, breachRecordsText } = await import('./gate.js');
  const lines: string[] = [];
  for (const { g, meta } of items) {
    lines.push(
      `${indent}· ${gateLabel(g)}（run ${meta.run_id}）`,
      `${indent}  调用记录（非文件路径）：${breachRecordsText(meta.guard.breached_files ?? [])}`,
      `${indent}  快照漂移：${await driftText(meta)}`,
      `${indent}  出口：由用户决定用 ${entryCommandOf(meta.driver, 'dual-abandon')} ` +
        `--topic ${shellQuoteArg(g.topic)} --stage ${g.stage} 作废这一轮（保留工件、只解闸门）。`,
    );
  }
  lines.push(
    `${indent}${READONLY_BREACH_TRIAGE}`,
    `${indent}（与 gate --check 的 readonly_breach 一条同一判据；裁决件尚未落盘时 gate --check 会先报缺件、看不到那一条。）`,
    /*
     * 「重跑」不是独立出口（实施期核实，计划 r2 §7）：闸门停在待裁决时 `review --start` 的比较-交换
     * 拒绝启动（`review.ts` 的「尚未裁决，不能直接重跑」），而确证失守轮的 `gate --check` 又必败——
     * 要重跑都得先作废这一轮。
     */
    `${indent}要重跑须先作废这一轮：` +
      '闸门停在待裁决时 review --start 拒绝重跑，而这一轮的 gate --check 不会通过。',
  );
  return lines;
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
    const { normal, breached } = await splitByBreach(ctx, pending);
    if (breached.length === 0) {
      // 未见失守：与改前逐字相同（计划 r2 §2.2）
      const list = pending.map((g) => `${g.topic}/${g.stage}`).join('、');
      return {
        exitCode: EXIT.GATE_BLOCK,
        stderr:
          `以下阶段的审查意见尚未逐条裁决，提交被拦下：${list}\n` +
          `  请先补齐裁决件并通过 \`trivium gate --stage <阶段> --check\`。\n` +
          `  如需关闭该拦截，可在 .trivium/config.yaml 设 gate.block_commit: false。`,
      };
    }
    // 有失守：未见失守的项照原文案前两行，失守段在后，关闭方式恒为最后一行、只出一次（GLM-03）
    const lines: string[] = [];
    if (normal.length > 0) {
      lines.push(
        `以下阶段的审查意见尚未逐条裁决，提交被拦下：${normal.map(gateLabel).join('、')}`,
        `  请先补齐裁决件并通过 \`trivium gate --stage <阶段> --check\`。`,
      );
    }
    lines.push(
      `以下阶段的审查记录到只读失守，提交被拦下：${breached.map((b) => gateLabel(b.g)).join('、')}`,
      `  ${BREACH_UNFIXABLE}。`,
      ...(await breachLines(breached, '  ')),
      `  如需关闭该拦截，可在 .trivium/config.yaml 设 gate.block_commit: false。`,
    );
    return { exitCode: EXIT.GATE_BLOCK, stderr: lines.join('\n') };
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
      '  **这一步请在终端里手动执行**：恢复命令的参数正是上面列出的受保护路径，\n' +
      '  常规写法在会话里会被 hook-pre-bash 拦下（M10a 第 2 步 EV-55 §3.2.2）。\n' +
      '  那条判据是按命令形态的启发式、并不完备，但换写法绕过它属于违规，不是出口。\n' +
      // 这里拿不到当轮 Driver（提交 Hook 不对应某一道闸门）；会跑到提交 Hook 的只有带 Hook 的载体，
      // 它们的调用写法今天都是 `/名字`（注册表 entryInvocation）。第三家带 Hook 的载体用别的写法时要改这里
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
 *
 * 该闸门这一轮记录了只读失守时，拦截与计数不变，只把文案换成真因与出口（EV-98 文案部分，
 * 见 `splitByBreach`）；未见失守时文案与改前逐字相同。
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
  // 退出码与计数已在上面定好；下面只按本轮是否失守选文案（计划 r2 §2.2）
  const { normal, breached } = await splitByBreach(ctx, pending);

  if (exceeded) {
    let msg: string;
    if (breached.length === 0) {
      msg =
        `已连续 ${count - 1} 次阻断收工仍未完成裁决，本次放行以避免死循环。\n` +
        `  ${g.topic}/${g.stage} 的裁决仍未齐备，请手工处理。`;
    } else {
      // 有失守就 N 与 B 都点名：Hook 已放行，这句话是人唯一的提示（CODEX-02）
      msg = [
        `已连续 ${count - 1} 次阻断收工，本次放行以避免死循环。`,
        ...(normal.length > 0 ? [`  ${normal.map(gateLabel).join('、')} 的裁决仍未齐备，请手工处理。`] : []),
        `  ${breached.map((b) => gateLabel(b.g)).join('、')} 本轮记录到只读失守，补裁决件解不开这道闸门，请手工处理：`,
        ...(await breachLines(breached, '  ')),
      ].join('\n');
    }
    // exit 0 的 stderr 不会展示给用户；systemMessage 才会——这条提示恰恰是给人看的
    return { exitCode: EXIT.OK, json: { systemMessage: msg }, stderr: msg };
  }

  if (breached.length > 0) {
    const bList = breached.map((b) => gateLabel(b.g)).join('、');
    const head: string[] = [];
    const stderr: string[] = [];
    if (normal.length > 0) {
      // 混合：原两句只列未见失守的项，指引句末说明只针对这几项（CODEX-03）
      const nList = normal.map(gateLabel).join('、');
      head.push(
        `还有未逐条裁决的审查意见：${nList}。`,
        `请读完两份审查文档全文，按 trivium.disposition.v1 写出裁决件` +
          `（每个意见编号都要有裁决与理由，接受项要写落点），再运行 ` +
          `\`trivium gate --stage ${normal[0]!.stage} --check\`` +
          `（只针对上列阶段；下列只读失守的阶段另行处置，它们的 gate --check 不会通过）。`,
        `另有阶段本轮审查记录到只读失守：${bList}。${BREACH_UNFIXABLE}，不要再为解闸门去补裁决件。`,
      );
      // 两个真因都进 stderr，失守不在 stderr 面隐形（AGY-02 ≡ GLM-04）
      stderr.push(`还有未逐条裁决的审查意见：${nList}`, `另有阶段本轮审查记录到只读失守：${bList}`);
    } else {
      head.push(`本轮审查记录到只读失守：${bList}。${BREACH_UNFIXABLE}，不要再为解闸门去补裁决件。`);
      stderr.push(`本轮审查记录到只读失守：${bList}`);
    }
    return {
      exitCode: EXIT.GATE_BLOCK,
      json: { decision: 'block', reason: [...head, ...(await breachLines(breached, ''))].join('\n') },
      stderr: stderr.join('\n'),
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

/** 删不掉的到期运行目录在待办里最多列几个：待办注入每个会话的上下文，权限类成因可能一次几十个 */
const REMOVE_FAILED_LISTED = 3;

/**
 * 到期整删删不掉的那一行（EV-204）。不承诺「下次会话会再试」（计划双审 CODEX-01）：删掉一部分会刷新目录 mtime，
 * 下次会话判为未到期、这一行随之不再出现，要再过一个保留期才重试整删。路径与同段其余各行一致写原路径。
 * 也不说「已抹除」：落回的抹除仍要过准入（status 读不到就进 unknown 不抹），结果由同段其余各行如实报。
 */
export function removeFailedLine(failed: readonly { dir: string; code: string }[]): string {
  const listed = failed.slice(0, REMOVE_FAILED_LISTED).map((f) => `${f.dir}（${f.code}）`).join('、');
  const more = failed.length > REMOVE_FAILED_LISTED ? `等 ${failed.length} 个` : '';
  return (
    `  · ${failed.length} 个到期运行目录删不掉：${listed}${more}——凭据副本改按未到期目录处理（抹除结果见同段其余各行）；` +
    '请人工删除（删掉一部分的目录要再过一个保留期才会自动重试）'
  );
}

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
  let removeFailed: { dir: string; code: string }[] = [];
  let scrubbed = 0;
  let runDirRedacted = 0;
  let scrubFailed: { dir: string; reason: string }[] = [];
  let unknown = 0;
  let unknownDirs: string[] = [];
  let deferred: string[] = [];
  let deferredCli: { dir: string; detail: string }[] = [];
  let incomplete: { dir: string; detail?: string }[] = [];
  /** 清扫本身抛了：原先只在 DEBUG 下打印，新职责（凭据抹除）挂上来之后不能再静默（CODEX-06） */
  let retentionError: string | null = null;
  try {
    const { pruneRunDirs } = await import('./retention.js');
    const { wiredAdapter } = await import('./adapters/index.js');
    const r = await pruneRunDirs(ctx.config, ctx.projectRoot, { adapters: wiredAdapter });
    pruned = r.removed.length;
    removeFailed = r.removeFailed;
    scrubbed = r.scrubbed.length;
    runDirRedacted = r.runDirRedacted.length;
    scrubFailed = r.scrubFailed;
    unknown = r.unknown.length;
    unknownDirs = r.unknown;
    deferred = r.deferred;
    deferredCli = r.deferredCli;
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
    pruned === 0 && removeFailed.length === 0 && scrubbed === 0 && runDirRedacted === 0 && scrubFailed.length === 0 &&
    unknown === 0 && deferred.length === 0 && incomplete.length === 0 && retentionError === null
  ) return ALLOW;

  const lines: string[] = ['TriviumCode 待办：'];
  if (pruned > 0) {
    lines.push(`  · 已清理 ${pruned} 个超过 ${ctx.config.retention.run_dir_days} 天的运行目录（retention.run_dir_days）`);
  }
  if (removeFailed.length > 0) lines.push(removeFailedLine(removeFailed));
  if (scrubbed > 0) {
    lines.push(`  · 已抹除 ${scrubbed} 个运行目录的凭据副本`);
  }
  if (runDirRedacted > 0) {
    /*
     * 与上一行分开：这一格一份凭据载体都没抹，只是把运行目录那一层的交接包脱敏了。
     * 并进「已抹除凭据副本」会让话比事实强（代码双审 GLM-06）。
     */
    lines.push(`  · 另 ${runDirRedacted} 个运行目录只做了交接包脱敏（未发现待抹的凭据副本）`);
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
  const cliHeld = new Set(deferredCli.map((x) => x.dir));
  const deferredWorker = deferred.filter((d) => !cliHeld.has(d));
  if (deferredWorker.length > 0) {
    /*
     * 准入未过而 status 读得到的三类（starting / 拿不到 pid / 终态但进程仍活）。
     * 不抹是既定安全决策，但此前它们哪一格都不进——其中 starting 类可能已经写下了
     * 凭据副本（准备阶段崩溃），对所有入口都不可见地躺到 TTL（代码双审 GLM-04）。
     */
    lines.push(
      `  · ${deferredWorker.length} 个运行目录准入未过（正在启动／状态判不了／进程仍在），未动——` +
        `多为瞬态，下次会话会再判一次；持续出现请人工检查，首个：${deferredWorker[0]}`,
    );
  }
  if (deferredCli.length > 0) {
    /*
     * 第四格（EV-154 / EV-38，代码双审 r1 CODEX-01）：worker 已不在，但记录里的审查员 CLI 进程组仍活着、判不了、或记录读不懂。
     * 成因逐条带出：CLI 还活着的在它结束后自愈；「读不懂」不自愈，出口只有人把该侧 cli 改回 null——到期整删也保留它（EV-157）。
     * 到期而被 CLI 挡下的目录也落在这一格（`pruneRunDirs` 把它们落回未到期路径，取消与失联的凭据准入核CLI计划 r2 §3.3）。
     */
    lines.push(
      `  · ${deferredCli.length} 个运行目录因审查员 CLI 进程组记录未动（CLI 仍在／判不了／记录读不懂）——` +
        `CLI 结束后下次会话会再判；记录读不懂的不会自愈。首个：${deferredCli[0]!.dir}（${deferredCli[0]!.detail}）`,
    );
  }
  if (incomplete.length > 0) {
    /*
     * 「抹了但没扫完」是第三档：载体已删（不报失败），但有文件因超大/回读面下的二进制被跳过、仍未脱敏。
     * 只记哨兵等于静默——哨兵在无人读的目录里（代码双审 r2 AGY-02）。
     * **取证路径按成因分流**：运行目录那一层根本不写哨兵，指着 scrub.json 会一无所获，
     * 所以那一档直接把告警原文带出来（代码双审 CODEX-04 ≡ AGY-02 ≡ GLM-03）。
     */
    const first = incomplete[0]!;
    lines.push(
      `  · ${incomplete.length} 个运行目录抹除后仍有文件未扫描，那几份未脱敏——首个：${first.dir}` +
        (first.detail ? `（运行目录层：${first.detail}；该层不写哨兵）` : '（详见该侧的 scrub.json）'),
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
          // 闸门项的 driver 只用来选写法、不作身份来源（见写入拦截那处的说明）
          `——${entryCommandOf(g.driver, 'dual-approve')} --topic ${shellQuoteArg(g.topic)} --stage ${g.stage}`,
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
 * 判据**只看存活**：取 `status.json` 的 `worker_pid` 经 `processAlive` 判 `.alive`，启动时刻不参与判定
 * （原注释写「比对启动时间」，与实现不符；worker启动时刻规范化计划 r2 §4.5 更正）。macOS 会复用 PID：复用者活着时
 * 这里把它当 worker 仍在、不回收闸门——保守方向，`approval_lock_ttl_h` 兜底。也因此它不受 TZ / 区域设置影响（EV-158）。
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
        // 只取 .alive：不传启动时刻，免得被误读成在比身份（worker启动时刻规范化代码双审 r1 CODEX-02）
        alive = (await processAlive(st.worker_pid, null)).alive;
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
