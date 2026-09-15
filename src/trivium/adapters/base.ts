/**
 * 适配层统一契约（设计 §11.1）。
 *
 * 适配层是**唯一**允许调用厂商 CLI 的地方（§5.1）。它把两家的差异
 * （参数、输出字段、模型指定方式、只读方式、轨迹来源）收敛为一组请求/结果结构，
 * 上层的 runner / parse / guard 只面对这组结构。
 *
 * 铁律（原则 P7）：命令行**一律由 probe 结论构造**，不得硬编码设计文档里的示例。
 */
import nodePath from 'node:path';
import os from 'node:os';
import type { Config, CriticId, CriticRequest, CriticResult, Stage } from '../types.js';

export interface AdapterContext {
  cfg: Config;
  /** node 绝对路径（GUI 进程不读 .zshrc，§10.5） */
  nodePath: string;
}

export interface CriticAdapter {
  readonly critic: CriticId;
  /** 该侧是否可用（探针结论决定）。不可用时给出人读原因 */
  availability(ctx: AdapterContext): { ok: boolean; reason?: string };
  run(ctx: AdapterContext, req: CriticRequest): Promise<CriticResult>;
}

/**
 * Agent id → 适配器的查表结构。
 *
 * **是 `Partial`，而且必须是。** `CriticId` 在 M7b 第 6 步放开成注册表全集之后，
 * `Record<CriticId, CriticAdapter>` 就成了一句谎话：它承诺**每一个已登记 Agent**
 * 都有适配器，而 Driver（claude）与尚未接入的 codex 本来就没有、也不该有。
 *
 * 谎话的代价不是类型不好看，而是**取值处的 undefined 检查被类型系统免掉了**：
 * `adapters[critic]` 恒被当成非空，真缺一个就在 `adapter.run` 上崩出一条
 * 与原因无关的 TypeError。改成 Partial 后取值处必须显式判空，缺谁说得出名字。
 *
 * 「已启用为审核者的那几家一定在表里」这条保证由 `realAdapters()` 在取表时
 * **运行期**兑现（缺接线即响亮失败），不靠类型硬编。
 */
export type AdapterTable = Partial<Record<CriticId, CriticAdapter>>;

/** 失败结果的统一构造，避免各适配器自行拼字段时漏项 */
export function failedResult(
  critic: CriticId,
  fail: {
    status: 'timeout' | 'failed' | 'parse_fallback';
    reason: string;
    exitCode?: number | null;
    durationS?: number;
    rawStdoutPath?: string;
    tracePath?: string | null;
    rawText?: string | null;
    cliVersion?: string | null;
    commandLine?: string;
    sessionId?: string | null;
  },
): CriticResult {
  return {
    critic,
    status: fail.status,
    exit_code: fail.exitCode ?? null,
    duration_s: fail.durationS ?? 0,
    raw_stdout_path: fail.rawStdoutPath ?? '',
    trace_path: fail.tracePath ?? null,
    review_json: null,
    raw_response_text: fail.rawText ?? null,
    model_effective: null,
    model_effective_source: 'unverified',
    tool_calls: {},
    read_paths: [],
    write_events: [],
    command_texts: [],
    evidence_ok: false,
    fail_reason: fail.reason,
    session_id: fail.sessionId ?? null,
    cli_version: fail.cliVersion ?? null,
    peer_deny_applied: false,
    command_line: fail.commandLine ?? '',
  };
}

/**
 * 判定 Agent 执行证据是否达标（设计 §11.4，五项检查中的前三项）。
 *
 * 这不是可选项：Antigravity 的软拒绝会产生「exit 0 但零工具调用」的空审查，
 * 因此工具轨迹下限是 AC-05 的强制落点。
 */
export interface EvidenceCheck {
  ok: boolean;
  reasons: string[];
  /** 被审对象与送审包之外的项目文件读取次数（AC-11） */
  projectReads: number;
}

export function checkEvidence(
  result: Pick<CriticResult, 'tool_calls' | 'read_paths' | 'trace_path'>,
  req: Pick<CriticRequest, 'min_tool_calls' | 'min_project_reads' | 'subject_path' | 'brief_path' | 'project_root'>,
  opts: { archiveRootAbs: string },
): EvidenceCheck {
  const reasons: string[] = [];

  const tc = result.tool_calls;
  const toolTotal = (tc.read ?? 0) + (tc.grep ?? 0) + (tc.glob ?? 0);

  // ① 轨迹存在
  if (result.trace_path === null && result.read_paths.length === 0 && toolTotal === 0) {
    reasons.push('no_trace：拿不到任何工具调用轨迹');
  }

  // ② 读文件次数下限
  if (toolTotal < req.min_tool_calls) {
    reasons.push(`insufficient_evidence：工具调用 ${toolTotal} 次 < 下限 ${req.min_tool_calls}`);
  }

  // ③ 项目文件读取下限——防止「把 BRIEF 与被审文档反复读 N 遍」通过上一条
  const excluded = new Set([req.subject_path, req.brief_path].map((p) => normalizeAbs(p, req.project_root)));
  const projectReads = result.read_paths.filter((p) => {
    const abs = normalizeAbs(p, req.project_root);
    if (excluded.has(abs)) return false;
    // 归档根内的文件不算「项目上下文」——那是审查材料本身
    if (isUnder(abs, opts.archiveRootAbs)) return false;
    // 项目根之外的读取（~/ 下的无关文件）也不算：AC-11 要的是「结合整个项目评审」
    return isUnder(abs, req.project_root);
  }).length;

  if (projectReads < req.min_project_reads) {
    reasons.push(
      `no_project_context：被审对象与送审包之外的项目文件读取 ${projectReads} 次 < 下限 ${req.min_project_reads}`,
    );
  }

  return { ok: reasons.length === 0, reasons, projectReads };
}

/** 轨迹核验：读取路径中是否命中禁读清单（§10.1 第 ③ 道 (c) 层 / AC-04） */
export function checkPeerLeak(
  readPaths: readonly string[],
  denyPaths: readonly string[],
  projectRoot: string,
): { leaked: boolean; hits: string[] } {
  /*
   * 两边都归一成绝对路径再比：轨迹里可能是 `./x`、`/abs/../abs/x`、macOS 的 `/private/var/…`
   * 对 `/var/…`；原先纯字符串比对，任何写法差异都会让「读到对方产出」漏报，
   * 而漏报的后果是本应作废的结论照常采纳。
   */
  const denyAbs = denyPaths.map((d) => normalizeAbs(d, projectRoot));
  const denySet = new Set(denyAbs);

  /*
   * 目录形态的条目要按**前缀**命中（审查意见 GLM-03）。
   *
   * 纯 `Set.has()` 时，`.trivium` 这类目录条目永远等不到 `.trivium/state.json`
   * 这样的实际读取路径——BRIEF 第 8 段向审查员承诺「读其中任何一个本次审查即作废」，
   * 而机器核验对它的效力是零。那正是措施 a 要关闭的「提示语禁了一堆、核验只对
   * 其中一部分」的错位，不能在这里再造一个。
   *
   * 判据用 `<条目>/` 前缀而非 `startsWith(条目)`：否则 `.trivium` 会误伤
   * `.trivium-backup` 这类同前缀的兄弟路径。
   */
  const hits = readPaths.filter((p) => {
    const abs = normalizeAbs(p, projectRoot);
    if (denySet.has(abs)) return true;
    return denyAbs.some((d) => abs.startsWith(`${d}${nodePath.sep}`));
  });
  return { leaked: hits.length > 0, hits: [...new Set(hits)] };
}

/*
 * ──────────────────────────────────────────────────────────────────────────
 * 措施 b（§10.1 / BACKLOG EV-01）：命令文本字面扫描
 * ──────────────────────────────────────────────────────────────────────────
 *
 * **为什么路径侧不够**：`checkPeerLeak` 吃的是轨迹里的**读取路径**。经 git 对象库
 * 取对端产物（`git show HEAD:<归档内文件>`）不产生文件系统读取，那条路径根本不出现；
 * 而 codex 侧读文件本就是跑 shell，**全部**读取都只在命令文本里（M6 P-C1）。
 * 对前者本措施是补充，对后者是唯一手段。
 *
 * ## 已知形态清单（本措施承诺必检的闭集）
 *
 * 计划双审 GLM-07 要求把论域钉死：不写数量，写清单。
 *
 * **下表与 `test/unit/peer-leak-command.test.ts` 的 `[F-n]` / `[B-n]` 用例名
 * 由 `known-forms-parity` 那条契约测试做双向对账**——这里多一行、那里少一条用例，
 * 或者反过来，都会红。
 *
 * > r1 双审（GLM-05）指出：初版这里写的是「改清单必须同时改用例，否则 known-forms 会红」，
 * > 而那条守卫只断言测试文件内的本地字面量、**既不读本文档块也不读设计**——
 * > 清单长出 F-6 时它什么都不会红。**注释宣称了不存在的保障**，
 * > 与设计 v1.3.6 记过的那条（注释宣称扫 enum/const、实现只有 enum）同形。
 * > 现在那条对账是真的了。
 *
 * | # | 形态 | 例 |
 * | :-- | :--- | :--- |
 * | F-1 | 绝对路径直引 | `cat /abs/proj/.reviews/t/code/x-<peer>.md` |
 * | F-2 | 项目相对路径直引 | `cat .reviews/t/code/x-<peer>.md`、`./.reviews/…` |
 * | F-3 | git 对象库取值 | `git show HEAD:.reviews/…`、`git cat-file -p <sha>:<path>` |
 * | F-4 | 目录级条目命中 | deny 里是目录时，`ls .trivium/`、`grep -r x .reviews/t/code/_meta/` |
 * | F-5 | 引号/命令替换包裹（双引号、单引号、反引号） | `cat "/abs/…"`、`cat '…'`、``cat `echo …` `` |
 * | F-6 | **锚定前缀**：完整字面量在场、左边不是分隔符 | `cat ../<rel>`、`cat $VAR/<rel>`、`/abs/x/../<rel>` |
 * | F-7 | **家目录写法**：deny 是展开态绝对路径 | `ls ~/.trivium/runs`、`$HOME/…`、`${HOME}/…` |
 * | F-8 | brace expansion | `diff {<rel>,other.md}` |
 * | F-9 | **引号切分**：删掉 `"` `'` 后再扫一遍 | `ls "$HOME"/<deny 后缀>` |
 *
 * F-6～F-8 是 r1 双审补的（GLM-01、AGY-03 ≡ GLM-02、AGY-04），三族当时**全部漏检**。
 * **F-3 是本措施存在的理由**；**F-7 是通道③的唯一覆盖**（EV-01），漏它等于该通道没接上。
 *
 * ## 明确检测不到的（威胁模型按 §10.1 末段，R25 已登记）
 *
 * | 盲区 | 例 |
 * | :--- | :--- |
 * | B-1 **分段拼接**：完整字面量从不出现 | `P=.reviews/t; cat $P/code/x-<peer>.md` |
 * | B-2 **未指名 deny 路径的内容转储** | 见下 |
 * | B-3 glob 展开 | `cat .reviews/*​/code/*-<peer>.md` |
 * | B-4 编码/间接（base64、xargs 取自文件、反斜杠转义 `cat \.reviews/…`） | — |
 * | B-5 **重新指名项目根**：回退层级里夹实体段，但归一后仍落回 deny | cwd 在两层子目录时 `cat ../../../proj/<rel>` |
 *
 * > **B-6 已撤销**（r4 双审 GLM-03）：它原本记的是「引号切分」，
 * > 拒绝理由写的是「剥引号要处理嵌套与转义，是另一套穷举面」——
 * > 那是**完整引号解析**的难度，而实际需要的只是「删掉所有引号再扫一遍」。
 * > **用更难的问题替换实际问题，再以前者的难度拒绝后者**，是论证上的偷换。
 * > 该族已改为真收，见 F-9。**B 表现为 B-1～B-5，编号不回收**——
 * > 留个空位比重排编号安全（旧留痕里引的 B-6 仍能对上这段说明）。
 *
 * **B-2 的范围 r1 双审后重划过**（GLM-03，一窄一宽两头都不准）：
 * - **不含** deny **目录条目自身**的目录级引用——`git log -p -- .trivium` 实测**命中**（F-4 覆盖）；
 * - **含**：deny **文件**条目的**祖先目录**（`git log -p -- .reviews/t/code`）、
 *   **无 pathspec 的裸 `git log -p`**、**从根递归的 `grep -rn . `**、`cat` 通配。
 *   三者都是通用只读命令，设计里那份 `readonly_commands` 清单也确实列着它们——
 *   但**那份清单至今没有任何消费方**（见下），所以「在白名单内」说的是纸面而非运行期。
 *   而 `.reviews/` 进 Git——**HEAD 历史里就有对端产物**。
 *
 * **B-5 是 r2 的收窄动作带出来的**（r3 双审 GLM-03 实测）：
 * 它是 F-6 收窄为「前置段仅 `..`/`.`」的代价，且**不真收**，理由见
 * `prefixIsOnlyDotHops` 的注释。
 *
 * > 同一轮还带出过一条 B-6（引号切分），当时也按「不真收」处理，
 * > 拒绝理由是「剥引号要处理嵌套与转义，是另一套穷举面」。
 * > **r4 双审 GLM-03 打穿了这个理由，B-6 已撤销并改为真收**——见上面的撤销注记与 F-9。
 * > 这两段是历史，不是现状：现在没有 B-6，引号切分是**收得住**的。
 *
 * **非蓄意也会撞上的盲区有两条：B-2 与 B-5**（B-6 已于 r4 改为真收，见 F-9）。
 * r4 双审 GLM-01 指出过「B-2 是唯一非蓄意」在 B-5 入表后已为假——
 * B-2 的特殊之处不在「唯一」，而在**它已拍板不收窄、因此没有缓解措施**（EV-16）；
 * B-5 是 F-6 收窄的代价。B-1/B-3/B-4 各需一个刻意动作。
 *
 * B-2 是 §10.1「git 通道保留能力而非封死」
 * 那条取舍的代价所在。收窄它要在**执行侧**限制能跑哪些命令，不是在检测侧加机制——
 * 而设计称作旋钮的 `readonly_commands` **目前没有任何消费方**（BACKLOG EV-15），
 * 所以那个旋钮现在拧不动。**对现役两家不是活风险**（agy 的工具面无命令工具、
 * zcode 全禁 `Bash`），它在 codex 接入（M8 第 3 步）那一刻才变活。
 *
 * **一处反直觉、已实测**：整条赋值里带完整字面量（`P=.reviews/…/x-<peer>.md; cat $P`）
 * **是能检出的**——字面量就在命令文本里。起草时我把「变量拼接」整类写成了盲区，
 * 实测证明只有**分段**拼接才真的躲得过。
 *
 * 本措施的目标是「**泄漏必检 + 成本抬升**」，**不是**抵御蓄意规避——
 * 承诺的是上表 F 清单必检，不是不可绕过。
 */

/** 命令文本里能合法紧邻路径两侧的字符——用于避免子串误命中 */
const CMD_BOUNDARY_CHARS = [
  ' ', '\t', '\n', '\r',
  '"', "'", '`',
  '=', ':', ';', '&', '|', '(', ')', '<', '>', ',',
  // brace expansion（`diff {<peer>,other.md}`，审查意见 AGY-04，已实跑复现漏检）
  '{', '}',
  // `curl -d @<file>`、`git apply @…` 一类把路径直接附在参数上的形态
  '@',
] as const;

const CMD_BOUNDARY = new Set<string>(CMD_BOUNDARY_CHARS);

/**
 * 边界字符的正则字符类（**从同一份定义派生，不另写一套**）。
 *
 * > r4 双审 AGY-01：`tildeUserHit` 当初手写了第二套字符类（`[^/\s"'\`]`），
 * > 与 `CMD_BOUNDARY` 各说各话——于是 `;` `&` `|` `(` `)` `=` `,` `{` `}` `@`
 * > 九种控制符全混得进用户名段（`echo ~;cat/.trivium/runs` 实测误命中），
 * > 而后缀段又把 `}` 吞掉（`diff {other,~user/.trivium/runs}` 漏检）。
 * > **一个概念两处定义，必然分叉**——这是本轮三个问题里两个的共同根因。
 */
const CMD_BOUNDARY_CLASS = CMD_BOUNDARY_CHARS
  .map((c) => c.replace(/[\\\]^-]/g, '\\$&'))
  .join('');

/** 右边界：行尾、分隔符，或 `/`（目录条目下的更深路径，F-4） */
function rightBoundaryOk(text: string, end: number): boolean {
  const after = end >= text.length ? '' : text[end]!;
  /*
   * `/` 写死而不只看 `nodePath.sep`：git 对象语法与 shell 路径分隔符**恒为 `/`**，
   * 与宿主的 `sep` 无关（审查意见 AGY-05）。本项目只跑 macOS，两者当前相等，
   * 所以这不是现行缺陷——但「分隔符取自宿主」这个写法本身就错，与 Windows 无关。
   */
  return after === '' || after === '/' || after === nodePath.sep || CMD_BOUNDARY.has(after);
}

/**
 * 从命中位置回扫出完整的**路径 token**（两侧扩到命令分隔符为止）。
 *
 * 用于 F-6：命中的字面量前面挂了个锚（`../`、`$VAR/`、`/abs/x/../`）。
 * 这时不能只看紧邻的那一个字符——要把整段路径拿出来再判。
 */
function pathTokenAround(
  text: string, start: number, end: number,
): { token: string; hitAt: number } {
  let s = start;
  while (s > 0 && !CMD_BOUNDARY.has(text[s - 1]!)) s--;
  let e = end;
  while (e < text.length && !CMD_BOUNDARY.has(text[e]!)) e++;
  // 一并返回命中在 token 内的偏移：调用方要据此判断「前置段是不是纯回退层级」，
  // 让它自己从三个下标里反推是白白制造一处算错的机会
  return { token: text.slice(s, e), hitAt: start - s };
}

/**
 * token 里含**无法静态解析**的段：变量、命令替换、通配。
 *
 * **`~` 不在其中**（审查意见 AGY-02 ≡ GLM-02）。初版把它一并归进来，
 * 于是 `cat ~/.trivium/config.yaml`、`cat ~/notes/.env` 全成了误报——
 * 而我在 r1 应答里恰恰承诺过「`~/.trivium/…` 归一后是 HOME 下的路径、不等于项目内条目」
 * 这条防线。**`os.homedir()` 是静态已知事实**，`spellingsOf` 自己就在用它做展开，
 * 把它塞进「不可解析」是归并错误。`~` 现在由 `expandTilde` 展开后走精确归一。
 */
const UNRESOLVABLE = /[$`*?]/;

/**
 * `~` 的三种形态要分清（审查意见 AGY-01 ≡ GLM-04）。
 *
 * | 形态 | 处置 | 理由 |
 * | :--- | :--- | :--- |
 * | `~` / `~/…` | **精确展开**后走归一 | `os.homedir()` 是静态已知事实 |
 * | `~user/…` | **保守命中** | 解析不了 `user` 指向谁，而 F-7 是通道③的唯一覆盖 |
 * | 其它 | 原样返回 | 不是家目录写法 |
 *
 * > r2 把 `~` 移出 `UNRESOLVABLE` 时，`~user/` 顺带从「保守命中」掉进了**静默判否**：
 * > 它既不触发保守分支、又展开不了、又过不了 `prefixIsOnlyDotHops`。
 * > 实测 `ls ~username/.trivium/runs` 漏检——而我在那一轮的送审焦点里
 * > 还写着「`~user/` 归入保守命中」，**拿一个不存在的行为去问审查员边界对不对**。
 *
 * 返回 `null` 表示「是家目录写法但展开不了」——调用方据此判保守命中。
 *
 * **但这不是 `~user/` 的主路径**：那种形态下四种派生拼写一个都不在命令文本里，
 * 扫描根本进不到 `hitsAt`，由 `tildeUserHit` 单独兜（见其注释）。
 * 本分支只覆盖「某个拼写已经匹配上、而 token 恰好是 `~user/` 开头」的残余情形，
 * 留着是为了让两条路径的语义一致，不是主要防线。
 */
function expandTilde(token: string): string | null {
  if (token === '~') return os.homedir();
  if (token.startsWith('~/')) return nodePath.join(os.homedir(), token.slice(2));
  if (token.startsWith('~')) return null; // `~user/…`：解析不了，保守命中
  return token;
}

/**
 * token 的前置段是否**仅由 `..` / `.` 组成**（纯回退层级）。
 *
 * 用于逃树兜底的收窄（r1 双审 AGY-01 ≡ GLM-03）：
 * `../<rel>`、`sub/../../<rel>` 是审查员在子目录里指向项目根的自然写法，该命中；
 * `../OtherProject/<rel>` 中间夹了**实体目录段**，判否。
 *
 * > **初版这里写的是「它从任何树内 cwd 都到不了本项目的 deny 条目」——这个全称断言
 * > 不成立**（r2 双审 GLM-03 实测证伪）：cwd 在两层子目录时，
 * > `cat ../../../proj/<rel>` 归一后正是 deny，前置段却含实体名 `proj`。
 * > 这族**重新指名项目根**的写法因此漏检，已登记为盲区 **B-5**。
 * >
 * > 为什么不真收：对整个 token 归一再判，等于把「cwd = 项目根」换成另一组同样无据的
 * > 假设——一层 `../proj/<rel>` 侥幸命中、三层不命中，**「深度决定检出」比明确的盲区更坏**。
 */
function prefixIsOnlyDotHops(token: string, hitStart: number): boolean {
  const prefix = token.slice(0, hitStart);
  if (prefix === '') return true;
  /*
   * **先归一再判段**。按原始段判的话 `sub/../../<rel>` 里的 `sub` 会被当成实体段，
   * 而它归一后就是 `../`——同样是纯回退。起草时漏了这一步，
   * 是用例（照 GLM-03 给的判据写的那条正断言）把它红出来的。
   */
  return nodePath
    .normalize(prefix)
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.')
    .every((seg) => seg === '..');
}

/**
 * 一个 deny 条目在命令文本里可能的写法（绝对、项目相对、`./` 前缀）。
 *
 * **两侧必须用同一套归一**：`normalizeAbs` 会剥掉 macOS 的 `/private` 前缀，
 * 所以 root 也得剥。起草时这里直接用了 `nodePath.resolve(projectRoot)`，
 * 于是临时目录（`/private/var/folders/…`）下 `abs.startsWith(root)` 恒假、
 * **项目相对写法一个都派生不出来**——单测用的是干净的 `/Users/x/proj`，
 * 恰好两边都不带 `/private`，17 条全绿也没照出来。
 * 是故障注入用例在真实临时目录上把它逼出来的。
 */
function spellingsOf(denyPath: string, projectRoot: string): string[] {
  const abs = normalizeAbs(denyPath, projectRoot);
  const root = normalizeAbs('.', projectRoot);
  const out = new Set<string>([abs]);
  // 绝对写法也可能带 /private（命令是照 deny_paths 原样拼的），一并收
  if (abs !== denyPath && nodePath.isAbsolute(denyPath)) out.add(denyPath);

  /*
   * **家目录下的条目补 `~` / `$HOME` 写法**（审查意见 AGY-03 ≡ GLM-02）。
   *
   * 通道③的运行目录（`~/.trivium/runs`）经 `expandHome` 以**展开后的绝对路径**
   * 进 deny 集，而审查员看到 BRIEF 里的绝对路径后改写成 `~/…` 是最自然的动作——
   * 实测 `ls ~/.trivium/runs` 漏检。而 EV-01 明写措施 b 是**通道③在检测侧的唯一覆盖**，
   * 漏它等于该通道在命令侧根本没接上。
   */
  const home = normalizeAbs('.', os.homedir());
  if (abs.startsWith(`${home}/`)) {
    const suffix = abs.slice(home.length); // 含前导 `/`
    out.add(`~${suffix}`);
    out.add(`$HOME${suffix}`);
    out.add(`\${HOME}${suffix}`);
  }

  if (abs === root) return [...out];
  if (abs.startsWith(`${root}${nodePath.sep}`)) {
    const rel = abs.slice(root.length + 1);
    if (rel.length > 0) {
      out.add(rel);
      out.add(`.${nodePath.sep}${rel}`);
    }
  }
  return [...out];
}

/**
 * 措施 b 的判据：命令原文里是否出现了 deny 条目的字面量。
 *
 * 返回**命中的命令原文**（不是命中的路径）——处置时要让人看见「它跑了哪条命令」，
 * 只报路径的话，`git show HEAD:<path>` 与 `cat <path>` 在留痕上无从区分，
 * 而这两者的性质差别正是本措施存在的理由。
 */
export function checkPeerLeakViaCommand(
  commandTexts: readonly string[],
  denyPaths: readonly string[],
  projectRoot: string,
): { leaked: boolean; hits: string[] } {
  if (commandTexts.length === 0 || denyPaths.length === 0) {
    return { leaked: false, hits: [] };
  }
  const denyAbs = denyPaths.map((d) => normalizeAbs(d, projectRoot));
  const spellings = denyPaths.flatMap((d) => spellingsOf(d, projectRoot));

  /** 归一后的 token 是否就是某个 deny 条目、或落在它之下 */
  const resolvesIntoDeny = (token: string): boolean => {
    const a = normalizeAbs(token, projectRoot);
    return denyAbs.some((d) => a === d || a.startsWith(`${d}/`));
  };

  const hitsAt = (cmd: string, s: string, i: number): boolean => {
    const end = i + s.length;
    if (!rightBoundaryOk(cmd, end)) return false;

    const before = i === 0 ? '' : cmd[i - 1]!;
    if (before === '' || CMD_BOUNDARY.has(before)) return true; // F-1～F-9

    /*
     * ── F-6：完整字面量在场，但前面挂了个锚 ──────────────────────────
     *
     * `cat ../<rel>`、`cat $VAR/<rel>`、`/abs/proj/test/../<rel>`：
     * 三者的 deny 字面量**都逐字出现在命令里**，只是左边不是分隔符。
     * 初版在这里直接判否，于是三种全漏——而 `../` 是 agent 在子目录工作时
     * **最自然**的写法，属威胁模型承诺必检的「非对抗穿透」，不该算盲区
     * （审查意见 GLM-01；三种形态均已实跑复现）。
     *
     * 判法：把命中位置所在的整个路径 token 回扫出来再判，而不是只看紧邻字符。
     */
    /*
     * **只认 `/`**（审查意见 AGY-03 ≡ GLM-02）。初版还放行了 `.`，
     * 于是 `cat ..env`（deny 含 `.env`）走进 F-6：回扫出的 prefix 是 `.`，
     * 归一 + 过滤后**段列表为空**，`.every()` 对空数组恒真 ⇒ 误命中。
     * 同族还有 `cat n/...env`、`cat .id_rsa`（deny 含 `id_rsa`）。
     *
     * 去掉 `.` 分支**不损失任何真阳性**：`./<rel>` 的匹配点在 `./` 的**斜杠之后**，
     * 它走的本来就是 `/` 分支。`.` 在 Unix 里不是路径分隔符，
     * 当初把它放进来是把「文件名里的点」误当成了「路径层级」。
     */
    if (before !== '/') return false;
    const { token, hitAt } = pathTokenAround(cmd, i, end);

    /*
     * token 里有变量 / 命令替换 / 通配时**静态解析不了**它指向哪。
     * 判命中而不是判否：deny 的完整拼写已经逐字在场，我们证明不了它指向别处，
     * 而威胁模型的定调是「泄漏必检 + 成本抬升」——此处宁可误报。
     * 误报的代价是一次审查被判作废（人看得见、可复核）；漏报的代价是锚定污染
     * 无声发生，**尤其在 codex 侧这是唯一核验手段**。
     *
     * `~` **不在此列**：它可静态展开（见 `UNRESOLVABLE` 的注释），走下面的精确归一。
     */
    if (UNRESOLVABLE.test(token)) return true;

    /*
     * **替换标记的外壳被回扫切掉了**（r4 双审 GLM-02，实测复现四条）。
     *
     * `(`、`{`、反引号都在 `CMD_BOUNDARY` 里，于是 `cat $(pwd)/<rel>` 回扫出的 token
     * 只剩 `/<rel>`——**`UNRESOLVABLE` 永远看不到它本要保守处理的那个 `$`**。
     * `cat $VAR/<rel>` 能命中纯属巧合：`$` 不是边界字符，留在 token 里了。
     *
     * 实测漏检：`${VAR}/<rel>`、`$(pwd)/<rel>`、`` `pwd`/<rel> ``，以及
     * **`cat $(git rev-parse --show-toplevel)/.trivium/state.json`**——
     * 最后这条是 agent 在任意 cwd 读项目根文件的**教科书写法**，与 F-6 的 `../`
     * 同属「非对抗穿透」，威胁模型承诺必检。登记成盲区就是又一次把承诺面
     * 缩到实现的形状上，所以**真收**。
     *
     * 判法：看截断点左侧紧邻的是不是替换外壳，是则与 `UNRESOLVABLE` 同样保守命中。
     *
     * **看的是闭合侧 `)` `}`，不是开启侧**：回扫止于路径左边最近的边界字符，
     * 而 `$(pwd)/x` 里那个字符是 `)`、`${VAR}/x` 里是 `}`。
     * 起草时我写成了 `(` / `{`，结果只有反引号（开闭同字符）侥幸修好——
     * 三条里两条照旧漏检，是重跑核实脚本才发现的。
     */
    const tokenStart = i - hitAt;
    const shell = tokenStart === 0 ? '' : cmd[tokenStart - 1]!;
    if (shell === ')' || shell === '}' || shell === '`') return true;

    const expanded = expandTilde(token);
    // `~user/…`：是家目录写法但解析不了指向谁 ⇒ 保守命中（同 UNRESOLVABLE 的取舍）
    if (expanded === null) return true;

    /*
     * 能静态解析的绝对 token：归一后落在 deny 之下才算。
     * 这条保住两条误报防线——
     * `cat /Users/other/repo/<rel>` 归一到项目外判否；
     * `cat ~/.trivium/config.yaml` 展开后是 HOME 下的路径、不等于项目内 `.trivium` 条目，
     * 也判否（**这正是 r1 应答承诺过、而初版没做到的那条**，AGY-02 ≡ GLM-02）。
     * 至于 `~/.trivium/runs/<runId>`：它落在 run-root deny 之下，照常命中。
     */
    if (nodePath.isAbsolute(expanded)) return resolvesIntoDeny(expanded);

    /*
     * 相对 token（`../<rel>` 一类）：cwd 未知——审查员**可能**在子目录里。
     * 设计 §10.2 规定工作目录是项目根，但它 `cd` 得动，命令文本本身分辨不了。
     *
     * 所以**只认纯回退层级**（审查意见 AGY-01 ≡ GLM-03）：
     * deny 拼写之前的段仅由 `..` / `.` 组成时才判命中。
     *
     * | token | 判定 | 为什么 |
     * | :--- | :--- | :--- |
     * | `../<rel>` | 命中 | 子目录 cwd 指回项目根的自然写法 |
     * | `sub/../../<rel>` | 命中 | 同上，绕了一圈仍是纯回退 |
     * | `../OtherProject/<rel>` | **判否** | 夹了实体目录段，从任何树内 cwd 都到不了本项目的 deny |
     *
     * **初版这里的注释与实现完全相反**——注释写「归一后仍在项目树内就算命中」，
     * 代码写的是「跑出项目树才命中」，而后者把上表第三行也判成了命中。
     * 误报族集中在 `sensitive_globs` 派生的短名条目上（`.env` / `id_rsa`）：
     * 那类通用名会作为**别的项目**的文件名逐字出现，run-id 档案名则几乎撞不上。
     */
    if (resolvesIntoDeny(expanded)) return true;
    return prefixIsOnlyDotHops(token, hitAt);
  };

  /*
   * `~user/…` 要单独扫，**不能指望 spelling 匹配**（审查意见 AGY-01 ≡ GLM-04）。
   *
   * 派生的拼写只有绝对态、`~/`、`$HOME/`、`${HOME}/` 四种，
   * 而 `~username/.trivium/runs` 里 `~` 与 `/` 之间隔着用户名，
   * **四种拼写一个都不在命令文本里**——扫描根本进不到 `hitsAt`，
   * 所以在那里加「保守命中」分支是修错了层（起草本轮修复时先错了一次）。
   *
   * 判法：把 `~<name>/<后缀>` 的后缀接到本机 HOME 之下再比。
   * 这样 `~someone/.trivium/runs` 与 `~<自己登录名>/.trivium/runs` 一并覆盖——
   * 前者解析不了指向谁（保守命中），后者本就等价于 `~/`。
   *
   * **正则的三段都从 `CMD_BOUNDARY` 派生**（r4 双审 AGY-01 + GLM-06，五类问题一并收）：
   *
   * | # | 形态 | 原判定 | 原因 |
   * | :-- | :--- | :--- | :--- |
   * | ① | `echo ~;cat/.trivium/runs` | 误命中 | 用户名段没排除控制符（九种全混得进） |
   * | ② | `diff {other,~user/.trivium/runs}` | 漏检 | 后缀段没排除 `}` |
   * | ③ | `npm i pkg@1.0~alpha/.trivium/runs` | 误命中 | `~` 前无边界锚 |
   * | ④ | `echo a~b/.trivium/runs` | 误命中 | 同上——**shell 只在词首做 tilde 展开** |
   * | ⑤ | `~$HOME/.trivium/runs` | 误命中 | `~$…` 不是任何 shell 的合法登录名 |
   *
   * ③④ 由词首边界解决，⑤ 由把 `$` 排除出用户名段解决，①② 由派生字符类解决。
   * 五条都是**纯收窄**，无真阳性损失。
   */
  const homeAbs = normalizeAbs('.', os.homedir());
  /*
   * 三段：①词首边界（行首或边界字符）②用户名段（非边界、非 `/`、非 `$`）③后缀段（非边界）。
   * 用户名段用 `*` 而非 `+`：`~/` 形态由 spellings 覆盖，这里匹配到空名也无害
   * （后缀判定仍要落进 deny 才算）。
   */
  const TILDE_USER = new RegExp(
    `(?:^|[${CMD_BOUNDARY_CLASS}])~[^/$${CMD_BOUNDARY_CLASS}]*(/[^${CMD_BOUNDARY_CLASS}]*)`,
    'g',
  );
  const tildeUserHit = (cmd: string): boolean => {
    for (const m of cmd.matchAll(TILDE_USER)) {
      const suffix = m[1]!;
      const asIfHome = normalizeAbs(`${homeAbs}${suffix}`, projectRoot);
      if (denyAbs.some((d) => asIfHome === d || asIfHome.startsWith(`${d}/`))) return true;
    }
    return false;
  };

  const scanOnce = (cmd: string): boolean =>
    tildeUserHit(cmd) ||
    spellings.some((s) => {
      let from = 0;
      for (;;) {
        const i = cmd.indexOf(s, from);
        if (i < 0) return false;
        if (hitsAt(cmd, s, i)) return true;
        from = i + 1;
      }
    });

  /*
   * **F-9：删掉引号再扫一遍**（r4 双审 GLM-03）。
   *
   * `ls "$HOME"/.trivium/runs/<id>` 里 `$HOME/` 这个拼写被引号打断、
   * token 回扫也在 `"` 处截断，一遍扫描看不见它。
   *
   * > 这一族我上一轮登记成了盲区 B-6，理由写的是「剥引号要处理嵌套与转义，
   * > 是另一套穷举面」。**那个理由是论证上的偷换**：它只对「正确解析引号结构」成立，
   * > 而这里需要的只是**删掉所有引号再扫一遍**——不解析任何结构。
   * > 我用一个更难的问题替换了实际问题，再以前者的难度拒绝了后者。
   *
   * 为什么安全：删引号只会**新增**命中、不会丢失命中，而新增的那部分恰好落在
   * **F-5 已经承诺的范围内**（F-5 本就把 `'…'` / `"…"` 整包路径判命中）。
   *
   * **反引号不动**：它是命令替换的语法，删掉会把 `` `pwd`/x `` 变成 `pwd/x`，
   * 改变语义而非只去包装——那才真是另一套穷举面。
   */
  const stripQuotes = (cmd: string): string => cmd.replace(/["']/g, '');

  const hits = commandTexts.filter(
    (cmd) => scanOnce(cmd) || scanOnce(stripQuotes(cmd)),
  );
  return { leaked: hits.length > 0, hits: [...new Set(hits)] };
}

/** 归一成绝对路径：解析 `./`、`..`，并抹平 macOS 的 /private 前缀 */
function normalizeAbs(p: string, projectRoot: string): string {
  const abs = nodePath.resolve(projectRoot, p);
  return abs.startsWith('/private/') ? abs.slice('/private'.length) : abs;
}

function isUnder(abs: string, root: string): boolean {
  const r = root.startsWith('/private/') ? root.slice('/private'.length) : root;
  return abs === r || abs.startsWith(r.endsWith('/') ? r : `${r}/`);
}

/** 模型路由：命令行参数 > 主题级覆盖 > profile > 阶段默认（设计 §11.5 四级） */
export function routeModel(
  cfg: Config,
  critic: CriticId,
  stage: Stage,
  overrides: { cli?: string | null; topic?: string | null } = {},
): { model: string | null; source: 'cli' | 'topic' | 'profile' | 'none' } {
  if (overrides.cli) return { model: overrides.cli, source: 'cli' };
  if (overrides.topic) return { model: overrides.topic, source: 'topic' };
  const profile = cfg.profiles[cfg.active_profile];
  const fromProfile = profile?.[critic]?.[stage];
  if (fromProfile) return { model: fromProfile, source: 'profile' };
  return { model: null, source: 'none' };
}

/** 是否与主脑异构（FR-17 / AC-18）：Claude 系模型即为同源 */
export function isHeterogeneous(model: string | null): boolean {
  if (!model) return true;
  return !/claude/i.test(model);
}
