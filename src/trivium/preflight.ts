/**
 * `preflight`：启动预检（设计 §8.1 / FR-18 / AC-16，按修订版 M3 计划 §1 实现）。
 *
 * 铁律：**预检失败时不得创建主题目录、不得写任何 `_meta/`、不得产生任何双审标记**（AC-16）。
 * 因此这里的每一项检查都必须是**无残留**的：
 *   - 归档根可写性用 `access` 探测；目录不存在时只检查**父目录**权限，严禁创建它；
 *   - 探活缓存写推迟到**全部检查通过之后**（审查意见 GLM-05）。
 *
 * 另一条铁律：探针过期时**快速失败**，不在预检里隐式拉起 `doctor`
 * （AGY-03 / GLM-08）。预检是被 skill 在**非交互**的 Bash 工具里调用的，
 * 无处告知也无从等待；而完整 `doctor` 会击穿 600s 工具超时，
 * 届时配额已烧而探针一字未落盘。
 */
import path from 'node:path';
import { promises as fs, constants as fsConstants } from 'node:fs';
import type { AuthCacheEntry, CommonProbe, Config, CriticId, Ctx, Stage } from './types.js';
import { DEFAULT_CRITICS, STAGES } from './types.js';
import { EXIT, TriviumError } from './exit-codes.js';
import { patchProbe, probeIsFresh, staleCliProbes } from './config.js';
import { ALL_CLI_NAMES, DEFAULT_DRIVER, agentById, agentByCliName, type AgentId } from './agents/registry.js';
import { realAdapters } from './adapters/index.js';
import { routeModel, type AdapterContext, type CriticAdapter } from './adapters/base.js';
import { exists } from './util/fsx.js';
import { isGitRepo } from './util/git.js';
import { run } from './util/exec.js';
import { step } from './util/log.js';

/**
 * 预检范围。`all` **不是** `Stage`——它不是一个审查阶段，
 * 塞进 `Stage` 会污染 `timeout_s` / `min_tool_calls` 等按阶段索引的配置（GLM-02）。
 */
export type PreflightScope = Stage | 'all';

export function parsePreflightScope(raw: string | null): PreflightScope {
  if (!raw) throw new TriviumError(EXIT.USAGE, `缺少 --stage，取值：${STAGES.join(' | ')} | all`);
  if (raw === 'all') return 'all';
  if ((STAGES as readonly string[]).includes(raw)) return raw as Stage;
  throw new TriviumError(
    EXIT.USAGE,
    `--stage 只接受 ${STAGES.join(' | ')} | all，收到：${raw}`,
  );
}

const scopeStages = (scope: PreflightScope): Stage[] => (scope === 'all' ? [...STAGES] : [scope]);

export interface CheckResult {
  name: string;
  ok: boolean;
  detail: string;
  /** 失败时应返回的退出码 */
  exitCode?: number;
}

export interface PreflightResult {
  ok: boolean;
  scope: PreflightScope;
  checks: CheckResult[];
  /** 第一个失败项决定退出码 */
  exitCode: number;
  /** 通过后待写入的探活缓存（失败时不写——AC-16） */
  pendingAuthCache: Partial<Record<CriticId, AuthCacheEntry>>;
}

export interface PreflightOptions {
  ctx: Ctx;
  scope: PreflightScope;
  /** 本次实际生效的模型覆盖，用于按「实际生效值」校验 slug（GLM-01） */
  modelOverrides?: Partial<Record<CriticId, string>>;
  /** 跳过探活（调试用，会在输出中标注） */
  skipAuthCheck?: boolean;
  /** 强制重新探活，穿透 TTL 缓存（AGY-02） */
  refreshAuth?: boolean;
  /**
   * 本次入选的审核者。缺省取配置的 `review.default_critics`（M8 第 3 步）。
   *
   * 只读能力、模型 slug、探活三项都按**这一集合**检查，不按注册表全集：
   * 启用第三家之后，全集检查会让「本次压根没选它」的运行也因它环境未配而失败。
   */
  critics?: readonly CriticId[];
  /** 当轮 Driver（M9 第 5 步）。缺省即注册表缺省值，此时不打提示 */
  driver?: AgentId;
  /**
   * 该 Driver 是否已启用为 Driver；**只有显式 `true` 才按「已启用」呈现**。
   *
   * 缺省取**保守**的一侧（第 3 轮 CODEX-04）：这个字段的存在理由是 M9 的
   * 「只校验已登记，放行但如实标注」，那条口径只能靠留痕与提示兜住。
   * M10a 第 3 步起入口（`resolveDriver`）对未启用者退 64，**生产路径上传进来的恒为 true**；
   * false 那一臂只剩注入测试会走到，保留它是因为本函数按参数渲染、不自己查表。
   * 上一版把 `undefined` 与 `true` 一并当作「已启用」，于是任何新调用方
   * 传了 `driver` 却忘了 `driverEnabled`，那半句保留话术会**静默消失**——
   * 而「少说一句」正是这个字段最不该有的失败方式。
   */
  driverEnabled?: boolean;
}

// ─────────────────────── 各项检查 ───────────────────────



function authCacheValid(
  entry: AuthCacheEntry | undefined,
  cliVersion: string | null,
  fingerprint: string | null,
  ttlHours: number,
  now = Date.now(),
): { valid: boolean; reason: string } {
  if (!entry) return { valid: false, reason: '无缓存' };
  const ageH = (now - new Date(entry.checked_at).getTime()) / 3_600_000;
  if (!Number.isFinite(ageH)) return { valid: false, reason: '缓存时间戳不可解析' };
  if (ageH > ttlHours) return { valid: false, reason: `缓存已超过 ${ttlHours}h TTL` };
  // CLI 自升级过就失效——agy 在 M0 期间真的升过一次（坑 P-02）
  if (entry.cli_version !== cliVersion) {
    return { valid: false, reason: `CLI 版本已变（${entry.cli_version} → ${cliVersion}）` };
  }
  if (entry.fingerprint !== fingerprint) {
    return { valid: false, reason: '关键配置文件已变（Agent 定义或 CLI config.json）' };
  }
  return { valid: true, reason: `缓存有效（${ageH.toFixed(2)}h 前探活通过）` };
}

/** 探针新鲜度。过期即**快速失败**，不隐式拉起 doctor（AGY-03 / GLM-08） */
function checkProbeFreshness(cfg: Config): CheckResult {
  if (cfg.probe.generated_at === null) {
    return {
      name: '探针结论存在',
      ok: false,
      exitCode: EXIT.ENV,
      detail:
        '尚未运行过探针。请先手动运行 `trivium doctor`（约需 2~4 分钟，会消耗少量厂商配额），然后重试。\n' +
        '  预检刻意**不**自动拉起 doctor：它会击穿 Bash 工具的 600s 超时，届时配额已烧而结论未落盘。',
    };
  }
  const stale = staleCliProbes(cfg);
  if (!probeIsFresh(cfg)) {
    return {
      name: '探针结论未过期',
      ok: false,
      exitCode: EXIT.ENV,
      detail:
        `探针结论已全部过期或从未探过（超过 probe_ttl_days=${cfg.probe_ttl_days}）：${stale.join('、')}。\n` +
        '  请手动运行 `trivium doctor` 重新校准后重试。',
    };
  }
  /*
   * 部分过期**不判失败**，但要点名。
   *
   * 判据是「有没有任一侧还新鲜」而不是「是否全都新鲜」：四家登记之后，
   * 尚无探针实现的 codex / claude 永远不会有 `probed_at`，
   * 按「全都新鲜」判会让预检**恒失败**——那是把登记当成了欠账。
   */
  const detail =
    stale.length === 0
      ? `全部 ${ALL_CLI_NAMES.length} 侧均在 TTL 内`
      : `过期或未探：${stale.join('、')}（其余在 TTL 内；跑 doctor --only <名> 可单独补）`;
  return { name: '探针结论新鲜', ok: true, detail };
}

/**
 * 按探针记录的方式再取一次版本。
 *
 * 返回 `undefined` 表示**无从检查**（第三态），此时 `why` 说明原因、进预检输出点名。
 * 三种「无从查」都不判失败，但都不静默：没记录取版本方式、运行时不认识、
 * `extract` 不是合法正则。
 */
async function readCliVersion(
  cfg: Config,
  probe: CommonProbe,
): Promise<{ version: string | null } | { unverifiable: string }> {
  const vp = probe.version_probe;
  const entry = probe.entrypoint;
  if (!vp || !entry) return { unverifiable: '探针结论未记录取版本的方式' };

  /*
   * 只识别 `'node'` 与 `null` 两种运行时（审查意见 GLM-03）。
   *
   * 原实现写的是 `vp.runner === 'node' ? … : <直接执行 entrypoint>`，
   * 于是盘上任何别的值（手工改的、或将来第三家写进去的 `'python'`）
   * 都被**静默**当成「直接执行」，结果是去直接跑一个 .py 文件、报一个看不懂的错。
   * TS 的 `'node' | null` 拦得住新代码写错字面量，拦不住盘上的值。
   * 这里把「将来可扩展」变成显式契约：不认识就如实说不认识。
   */
  if (vp.runner !== null && vp.runner !== 'node') {
    return { unverifiable: `不认识的运行时「${String(vp.runner)}」（当前只支持 node 与直接执行）` };
  }

  /*
   * 正则由盘上数据构造，必须防非法（审查意见 GLM-07）。
   * 不防的话 `SyntaxError` 会穿到 cli.ts 的全局 catch，用户看到的是 JS 正则错误加原始栈——
   * 而该做的事是重跑 doctor。错误信息把人引向错误的方向，与 critics.ts 那条
   * 「无法取到调用参数」是同族问题。
   */
  let re: RegExp | null = null;
  if (vp.extract) {
    try {
      re = new RegExp(vp.extract);
    } catch {
      return { unverifiable: `探针记录的 extract 不是合法正则：${vp.extract}` };
    }
  }

  const runner = vp.runner === 'node' ? (cfg.runtime.node ?? process.execPath) : entry;
  const args = vp.runner === 'node' ? [entry, ...vp.args] : vp.args;
  const r = await run(runner, args, { timeoutMs: 60_000 });
  if (r.code !== 0) return { version: null };
  if (!re) return { version: r.stdout.trim() };
  return { version: re.exec(r.stdout)?.[1] ?? null };
}

/**
 * CLI 版本与探针记录是否一致（治 agy 自升级，坑 P-02）。
 *
 * **遍历已探 CLI，不再无条件检查写死的两家**（审查意见 GLM-02）。
 * 原实现是两段逐字展开的分支，于是 BACKLOG EV-05② 记的
 * 「第三家的 CLI 在不在、版本对不对一律不被检查，且不报任何提示」就成立。
 * 泛化的前提是「怎么取版本」这条知识随探针结论落盘（`VersionProbe`），
 * 而它**不依赖任何 M8 适配器**——这正是把本项从 EV-05② 里摘出来、
 * 收进 M6 第 1 步的理由。
 *
 * 三态而非两态：查得通、查出漂移、**无从查**。第三态不判失败但要点名，
 * 否则「检查过」与「没得检查」在输出里长得一模一样——与 M7b 第 6 步
 * `checkModelSlugs` 的口径一致。
 */
async function checkCliVersions(
  cfg: Config,
  critics: readonly CriticId[] = DEFAULT_CRITICS,
): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  const unverifiable: string[] = [];
  /*
   * **未入选侧的版本漂移降级为 note，不判失败**（r9 双审 GLM-08）。
   *
   * 为什么不像只读能力那样直接跳过：版本漂移是本机环境的客观事实，
   * 说出来对排查有价值（「codex 升级了，下次探针该重跑」）。
   * 但它不该让一次**压根没选它**的运行整场失败——`doctor` 默认会探测全部四家，
   * 于是 codex 自升级后，默认两侧的运行也会被它拦下，
   * 而那正是 `runPreflight` 里「按入选侧检查」这条原则要避免的。
   *
   * 两条原则的分工写在这里，免得后来者看到同一个函数里一处全查一处按需查而困惑：
   * **能不能用** 按入选侧判（不选就不关心），**环境变没变** 全查但只对入选侧计失败。
   */
  const selectedCli = new Set(
    critics.map((c) => agentById(c)?.cliName).filter((n): n is string => Boolean(n)),
  );

  for (const cliName of ALL_CLI_NAMES) {
    const probe = cfg.probe.cli[cliName];
    // 没探过的 CLI 不在这里报——`checkProbeFreshness` 已经统一点过名了，
    // 这里再报一遍会把「没探过」说成「不可调用」，是两回事。
    if (!probe?.probed_at) continue;
    const selected = selectedCli.has(cliName);

    const label = agentByCliName(cliName)?.display ?? cliName;
    /** 未入选侧的坏消息只报为 note：说出来有价值，但不该让没选它的运行失败 */
    const fail = (name: string, detail: string): CheckResult =>
      selected
        ? { name, ok: false, exitCode: EXIT.ENV, detail }
        : { name, ok: true, detail: `${detail}（本次未选用该侧，仅提示）` };

    const entry = probe.entrypoint;
    if (!entry || !(await exists(entry))) {
      out.push(
        fail(`${label} 可调用`, `探针记录的 ${cliName} 入口不可用：${entry ?? '(未记录)'}。请重新运行 doctor。`),
      );
      continue;
    }

    const res = await readCliVersion(cfg, probe);
    if ('unverifiable' in res) {
      unverifiable.push(`${cliName}（${res.unverifiable}）`);
      out.push({ name: `${label} 可调用`, ok: true, detail: `${cliName} 入口在位（版本未校验）` });
      continue;
    }
    const v = res.version;
    if (v === null) {
      out.push(fail(`${label} 可调用`, `${cliName} 取版本失败。请重新运行 doctor。`));
    } else if (v !== probe.version) {
      out.push(
        fail(
          `${label} 版本与探针一致`,
          `${cliName} 版本已变（探针记录 ${probe.version} → 实际 ${v}）。\n` +
            '  参数与行为可能随版本漂移，请重新运行 `trivium doctor`。',
        ),
      );
    } else {
      out.push({ name: `${label} 可调用`, ok: true, detail: `${cliName} ${v}` });
    }
  }

  if (unverifiable.length > 0) {
    out.push({
      name: '版本漂移检查覆盖面',
      ok: true,
      detail:
        '⚠️ 下列 CLI 本次只确认入口在位、未实际比对版本（括号内为原因）：' +
        `${unverifiable.join('、')}。重跑 doctor 可补齐。`,
    });
  }
  return out;
}

/**
 * 模型 slug 合法性（GLM-01）。
 *
 * 按「**本次实际生效**的模型」校验——命令行覆盖 > profile。数据源是探针记录的模型清单。
 * 这一项的执行点不只在独立 `preflight` 命令，`review --start` 也必须内嵌同一套校验，
 * 否则覆盖参数的非法值会漏到运行中段才暴露（白烧配额 + strict 中止）。
 */
export function checkModelSlugs(
  cfg: Config,
  scope: PreflightScope,
  overrides: Partial<Record<CriticId, string>> = {},
  critics: readonly CriticId[] = DEFAULT_CRITICS,
): CheckResult {
  const bad: string[] = [];
  /** 无法校验的侧：**不判失败，但必须说出来**（详见 checkModelAgainstCatalog） */
  const unverifiable = new Set<string>();
  /**
   * **校验了、但用的不是本该用的那份目录**的侧。
   *
   * 与 `unverifiable` 分开记：那个是「没比对」，这个是「比对了，只是比的是回落来源」。
   * 两者都不判失败，但都不能静默——一次目录采集失败若无声无息地回落，
   * 用户看到的是一模一样的「✓ 模型 slug 合法」（代码双审 CODEX-01）。
   */
  const fellBack = new Set<string>();

  for (const stage of scopeStages(scope)) {
    for (const critic of critics) {
      const routed = routeModel(cfg, critic, stage, { cli: overrides[critic] ?? null });
      if (!routed.model) {
        bad.push(`${critic}/${stage}: profile「${cfg.active_profile}」未定义模型且无覆盖`);
        continue;
      }
      const r = checkModelAgainstCatalog(cfg, critic, routed.model);
      if (r.kind === 'bad') bad.push(`${critic}/${stage}: ${r.detail}`);
      else if (r.kind === 'unverifiable') unverifiable.add(`${critic}（${r.why}）`);
      else if (r.note) fellBack.add(r.note);
    }
  }

  if (bad.length > 0) {
    return { name: '模型 slug 合法', ok: false, exitCode: EXIT.USAGE, detail: bad.join('\n  ') };
  }
  // 报「实际校验了几侧」，用本次入选集合而不是全集——否则数字与实际做的事对不上
  const scale = `已校验 ${scopeStages(scope).length} 个阶段 × ${critics.length} 侧`;
  return {
    name: '模型 slug 合法',
    ok: true,
    detail: [
      scale,
      ...(unverifiable.size > 0
        ? [`  ⚠️ 其中无模型目录可比对、未实际校验：${[...unverifiable].join('、')}`]
        : []),
      ...(fellBack.size > 0 ? [`  ⚠️ 其中已回落到基底目录校验：${[...fellBack].join('、')}`] : []),
    ].join('\n'),
  };
}

/** 单侧模型 slug 的比对结论。三态，**「无法校验」与「通过」分开记** */
type CatalogCheck =
  /** `note` 非空表示「校验过了，但用的不是本该用的那份目录」——回落要说出来，不能静默 */
  | { kind: 'ok'; note?: string | undefined }
  | { kind: 'bad'; detail: string }
  | { kind: 'unverifiable'; why: string };

/**
 * 拿本侧**厂商**的模型目录比对 slug。
 *
 * ## 为什么按 vendor 分派，而不是按审核者 id 穷尽
 *
 * 上一版写的是 `if (critic === 'gemini') … else if (critic === 'glm') … else never`。
 * 那个 `never` 是 M7b 第 1 步刻意加的，用来治更早的 `if/else` 二分——二分会把
 * 任何非 gemini 的侧拿去按 ZCode 的目录校验，报出一条驳斥自己的错
 * （「模型 X 不在 ZCode 模型目录中」，而那侧压根不是 ZCode）。
 *
 * 但 `never` 只是把静默误判换成了**编译期硬阻塞**：注册表一加第三家，本文件
 * 当场编译不过，而修法只有「再加一个 case」——于是「新增 Agent 只需接入套件」
 * 这句话就不成立了，第 6 步的零改动验收会被自己打红（计划 §3.5 / GLM-03 警告的正是这个形态）。
 *
 * 真正的判据是 vendor：模型目录是**厂商**的事实，不是 Agent 身份的事实。
 * 而 vendor 随新 Agent 一起进注册表（接入套件第 ① 件），所以按它分派不需要改这里。
 *
 * ## 未知厂商为什么记「无法校验」而不是失败
 *
 * 探针目录本来就可能为空（`makeFixture` 不给 `probeModels` 时就是空），
 * 此前的写法在目录为空时**整段跳过、静默通过**。判失败会让没探过针的场景一律
 * 起不来；静默通过则让「校验了」和「没得校验」看起来一模一样。
 * 所以取第三态：不拦，但把是哪几侧没校验写进预检输出。
 */
function checkModelAgainstCatalog(cfg: Config, critic: CriticId, model: string): CatalogCheck {
  /*
   * **按 cliName 通用消费 `CommonProbe.models`**（M8 第 3 步收敛，计划双审 GLM-04）。
   *
   * 收敛前按 vendor 分派 antigravity / zcode 两支，其余落 `unverifiable` 并给一句
   * 「厂商 X 没有模型目录探针」——那句话对 codex **是失实的**：`CodexProbe` 继承
   * `CommonProbe`，`models` 一直都在，只是没人消费。
   *
   * 后果不止文案难看：codex **不校验 model 在不在目录里**（M6 C-2），本步实测拼错
   * slug 的代价是 `Model not found` 重试五次、耗时数分钟才失败。预检不拦就是白烧。
   *
   * 厂商特有的 slug 归一（zcode 的短名补全）下沉到适配器的 `normalizeModelForCatalog`，
   * 这里只做「目录里有没有」这一件通用的事。
   */
  const a = agentById(critic);
  const cliName = a?.cliName ?? null;
  // 文案用 display（用户看的是「ZCode」不是「zcode」），索引用 cliName
  const label = a?.display ?? critic;

  /*
   * **目录随配置分层的侧，先问它自己**（M8 第 4 步，计划双审 CODEX-05）。
   *
   * `probe.models` 是**单一**列表，对 codex 取自基底 `config.toml` 的目录；
   * 而它的目录随 `-p` 分层。拿基底那份校验别的 profile 会**两个方向都错**：
   * 误杀该 profile 自己的默认模型、误放只在基底目录里的 slug——后者要到
   * `turn.failed` 才被端点拒，而预检存在的全部理由就是把这类失败挡在花钱之前（AC-16）。
   *
   * 钩子缺席即回落 `probe.models`，既有两家行为逐字不变。
   */
  const scoped = realAdapters()[critic]?.catalogModelsFor?.(cfg) ?? null;
  if (scoped?.kind === 'unverifiable') {
    return { kind: 'unverifiable', why: `${label}：${scoped.why}` };
  }
  /*
   * `fallback` 与 `unverifiable` **必须分开处置**（代码双审 CODEX-01）：
   * 前者是「没测到」——回落基底目录**照常校验**，只是把回落这件事说出来；
   * 后者是「测出来没有」——没有可比对的东西，如实记无法校验。
   * 合成一格的后果是一次子进程失败静默变成放行。
   */
  const probeModels = (cliName ? cfg.probe.cli[cliName]?.models : null) ?? [];
  const models = scoped?.kind === 'catalog' ? scoped.models : probeModels;
  if (models.length === 0) {
    return {
      kind: 'unverifiable',
      why: scoped?.kind === 'fallback' ? `${label}：${scoped.why}，而基底目录也是空的` : `探针未记录 ${label} 模型目录`,
    };
  }

  const normalized = realAdapters()[critic]?.normalizeModelForCatalog?.(cfg, model) ?? model;
  const short = normalized.includes('/') ? (normalized.split('/').pop() ?? normalized) : normalized;

  const where = scoped?.kind === 'catalog' ? scoped.source : `${label} 模型目录`;
  // 前面留一个空格：既有断言按「不在 ZCode 模型目录中」的原文匹配，去掉会静默破坏它
  return models.some((m) => m === model || m === normalized || m === short)
    ? { kind: 'ok', note: scoped?.kind === 'fallback' ? `${label}：${scoped.why}` : undefined }
    : {
        kind: 'bad',
        /*
         * **回落时要在报错里说清楚**（代码双审 CODEX-08）：
         * 上一版这一路只写「不在 <label> 模型目录中，可用值：…」并列出**基底**名单，
         * 只字不提「本该用该 profile 的目录而采集失败」。用户照报错去基底名单里挑模型，
         * 而端点实际执行的是 profile 目录——误杀方向的新误导。
         */
        detail:
          (scoped?.kind === 'fallback' ? `${scoped.why}；` : '') +
          `模型「${model}」不在 ${where}中。可用值：${models.join(', ')}`,
      };
}

/**
 * 只读能力可用（§8.1）—— **遍历适配器自己的 `availability()`**（M8 第 3 步收敛）。
 *
 * 收敛前这里写死两家：查 zcode 的 `readonly_flags` 非空、查 agy 的 `agent.md` 存在。
 * 两个问题：
 *
 * ① **第三家一律不被检查**（EV-05①），加一家就要在这里再写一支；
 * ② **同一事实有两份判据且已经分叉**——`zcode.ts` 的 `availability()` 把
 *    `--disallowed-tools` 当硬前置（`--mode plan` 拦不住 Bash，M0 实测），
 *    而这里的版本不查那一条，于是预检放行、适配器拒绝，同一个问题两个答案。
 *
 * 计划双审两侧独立指到这里（AGY-03 ≡ GLM-06）。现在只剩一份判据，
 * 住在「最知道自己怎么才算可用」的那个模块里。
 */
function checkReadonlyCapability(ctx: Ctx, critics: readonly CriticId[]): CheckResult {
  const adapters = realAdapters();
  // nodePath 取与运行期同一口径：配了 runtime.node 的机器上，预检与真实运行
  // 必须走同一个 node，否则就是本函数注释自称要消灭的那种「同一个问题两个答案」
  const actx: AdapterContext = { cfg: ctx.config, nodePath: ctx.config.runtime.node ?? process.execPath };
  const problems: string[] = [];
  const oks: string[] = [];

  for (const id of critics) {
    const a = adapters[id];
    if (!a) {
      problems.push(`${agentById(id)?.display ?? id}：注册表启用了它，但 adapters/index.ts 没有接线`);
      continue;
    }
    const v = a.availability(actx);
    if (v.ok) oks.push(agentById(id)?.display ?? id);
    else problems.push(`${agentById(id)?.display ?? id}：${v.reason ?? '不可用（未给出原因）'}`);
  }

  return problems.length === 0
    ? { name: '只读能力可用', ok: true, detail: `${oks.join('、')} 均报告可用` }
    : { name: '只读能力可用', ok: false, exitCode: EXIT.ENV, detail: problems.join('\n  ') };
}

/**
 * 归档根与 git（§8.1）。
 *
 * **无残留**：目录存在则 `access(W_OK)`；不存在则检查**父目录**权限，
 * 严禁为了探测而创建 `.reviews/`（AGY-01 / GLM-05）。
 */
async function checkArchiveAndGit(ctx: Ctx): Promise<CheckResult> {
  const problems: string[] = [];

  if (!(await isGitRepo(ctx.projectRoot))) {
    problems.push('当前目录不是 git 仓库——快照与漂移检测依赖 git');
  }

  const target = (await exists(ctx.archiveRoot)) ? ctx.archiveRoot : path.dirname(ctx.archiveRoot);
  try {
    await fs.access(target, fsConstants.W_OK);
  } catch {
    problems.push(`归档根不可写：${target}`);
  }

  return problems.length === 0
    ? { name: '归档与 git 可用', ok: true, detail: `归档根 ${ctx.archiveRoot}` }
    : { name: '归档与 git 可用', ok: false, exitCode: EXIT.ENV, detail: problems.join('\n  ') };
}

/**
 * doctor 的 `zcode.runtime_selection` 读数为 `reorder_ineffective` 时给一条警告（EV-82 第三段 r3 §4.2）：
 * 零配额的两支对照显示「置首也挡不住回落」，glm 侧审查运行的模型覆盖大概率不会生效。
 * **只警告、不拒跑**（`ok: true`）：判据是 doctor 在哨兵凭据下的读数，不是本次运行的事实；
 * 本次运行是否跑对了模型，由 guard 的 `model_override_applied` 比对给出。其余三值与未探过都不出项。
 */
export function checkZcodeRuntimeSelection(cfg: Config, selected: readonly CriticId[]): CheckResult | null {
  // 按入选侧经注册表取 CLI 名，不写 Agent id 字面量（registry-parity 的对账纪律）；这一格目前只有 ZCode 的探针结论有
  for (const critic of selected) {
    const cliName = agentById(critic)?.cliName;
    if (!cliName) continue;
    const probe = cfg.probe.cli[cliName] as { runtime_selection?: unknown } | undefined;
    if (probe?.runtime_selection !== 'reorder_ineffective') continue;
    const label = agentByCliName(cliName)?.display ?? cliName;
    return {
      name: `${label} 运行期选模`,
      ok: true,
      detail:
        `⚠️ doctor 的 ${cliName}.runtime_selection 为 reorder_ineffective：零配额探针上置首也没挡住运行期回落，` +
        `本次 ${critic} 侧大概率跑不到请求的模型（跑完看 guard 的「请求的模型没有生效」告警与 trace.json 的 modelSelection.reorder）`,
    };
  }
  return null;
}

/** 命令 A 专属：`verify.build` / `verify.test` 皆空则拒绝启动（§14.1 / GLM-02） */
function checkVerifyConfigured(cfg: Config, scope: PreflightScope): CheckResult | null {
  if (scope !== 'all') return null;
  const b = cfg.verify.build.length;
  const t = cfg.verify.test.length;
  if (b + t > 0) {
    return { name: '编译测试命令已配置', ok: true, detail: `build ${b} 条 / test ${t} 条` };
  }
  return {
    name: '编译测试命令已配置',
    ok: false,
    exitCode: EXIT.ENV,
    detail:
      'verify.build 与 verify.test 皆为空，命令 A 拒绝启动——跑完全流程却无法收口是不可接受的（§14.1）。\n' +
      '  请把 `trivium doctor` 探测到的候选**逐条确认**后写入 .trivium/config.yaml。' +
      '编排器只执行显式配置的命令，不猜测执行。',
  };
}

// ─────────────────────── 探活 ───────────────────────

interface AuthOutcome {
  critic: CriticId;
  result: CheckResult;
  /** 通过时待写入缓存的条目（失败时为 null——只缓存正结论，GLM-06） */
  cache: AuthCacheEntry | null;
}

/**
 * 探活 —— **遍历适配器的 `authProbe()`**（M8 第 3 步收敛）。
 *
 * 收敛前是 `probeAgyAuth` / `probeZcodeAuth` 两个写死的函数，加一家就加一个。
 * 现在切分是：**厂商知识在适配器**（指纹算哪个文件、最小调用怎么发、失败怎么说），
 * **缓存策略在这里**（TTL、版本比对、只缓存正结论）。后者留在一处的理由是
 * 它一旦被抄三份就会各自漂移，而它决定的是「要不要再烧一次配额」。
 *
 * 没实现 `authProbe` 的侧**如实报告为「没得探」**，不静默算通过——
 * 「探过通过」与「压根没探」长得一样，是本项目反复出现的那类失真。
 */
async function probeAuth(
  ctx: Ctx,
  critic: CriticId,
  adapter: CriticAdapter,
  opts: PreflightOptions,
): Promise<AuthOutcome> {
  const cfg = ctx.config;
  const display = agentById(critic)?.display ?? critic;
  const name = `${display} 已认证`;
  const cliName = agentById(critic)?.cliName ?? null;
  const version = (cliName ? cfg.probe.cli[cliName]?.version : null) ?? null;

  const auth = adapter.authProbe?.(
    { cfg, nodePath: cfg.runtime.node ?? process.execPath },
    ctx.projectRoot,
  );
  if (!auth) {
    return {
      critic,
      result: { name, ok: true, detail: '该侧未实现探活，本项未检查（不等于已通过）' },
      cache: null,
    };
  }

  const fp = await auth.fingerprint();
  if (!opts.refreshAuth) {
    const v = authCacheValid(cfg.probe.auth?.[critic], version, fp, cfg.preflight.auth_cache_ttl_h);
    if (v.valid) return { critic, result: { name, ok: true, detail: v.reason }, cache: null };
    step(`[${critic}] 探活缓存不可用（${v.reason}），执行最小 headless 探活`);
  }

  const r = await auth.probe();
  return {
    critic,
    result: r.ok
      ? { name, ok: true, detail: r.detail }
      : { name, ok: false, exitCode: EXIT.ENV, detail: r.detail },
    cache: r.ok
      ? { checked_at: new Date().toISOString(), cli_version: version, fingerprint: fp, ok: true }
      : null,
  };
}

// ─────────────────────── 编排 ───────────────────────

export async function runPreflight(opts: PreflightOptions): Promise<PreflightResult> {
  const { ctx, scope } = opts;
  const cfg = ctx.config;
  const checks: CheckResult[] = [];
  const pendingAuthCache: Partial<Record<CriticId, AuthCacheEntry>> = {};
  /*
   * 本次入选的审核者。只读能力、模型 slug、探活三项都按它检查，而不是按注册表全集：
   * codex 启用之后，全集检查会让「本次没选它」的运行也因它环境未配而失败
   * （而那正是 D-1 决定「默认不选它」时要避免的连带影响）。
   */
  const selected: readonly CriticId[] = opts.critics ?? cfg.review.default_critics;

  /*
   * ⓪ 当轮 Driver 非缺省时打一行可见提示（M9 第 5 步）。
   *
   * **必须 `ok: true`**：下面多处用 `checks.every((c) => c.ok)` 做短路，
   * `exitCode` 又由 `find((c) => !c.ok)` 决定——判 false 会把一条**提示**
   * 变成一次**失败**，而且是在探针检查之前就把整个预检短路掉。
   *
   * 做成 `CheckResult` 而不是单独打印，是因为 `--json` 与人读两条输出路径
   * 都消费 `r.checks`：单独 print 只有人读那条看得见。
   *
   * 缺省 Driver 时不推：那是绝大多数运行的形态，每次都打一行等于没打。
   */
  const driver = opts.driver ?? DEFAULT_DRIVER;
  if (driver !== DEFAULT_DRIVER) {
    checks.push({
      name: '当轮 Driver',
      ok: true,
      // 缺省走保守侧：不是显式 true 就带上保留话术（第 3 轮 CODEX-04）
      detail: opts.driverEnabled === true
        ? driver
        : `${driver}（本次声明的 Driver 尚未启用为 Driver，该值仅用于选侧判定）`,
    });
  }

  // ① 探针新鲜度（过期即快速失败，不拉 doctor）
  checks.push(checkProbeFreshness(cfg));
  // ② ③ CLI 可调用且版本与探针一致
  if (checks.every((c) => c.ok)) checks.push(...(await checkCliVersions(cfg, selected)));
  // ④ 只读能力
  if (checks.every((c) => c.ok)) checks.push(checkReadonlyCapability(ctx, selected));
  // ④′ ZCode 运行期选模（EV-82 第三段 r3 §4.2）：只警告、不拒跑
  if (checks.every((c) => c.ok)) {
    const w = checkZcodeRuntimeSelection(cfg, selected);
    if (w) checks.push(w);
  }
  // ⑤ 模型 slug（按本次实际生效值）
  if (checks.every((c) => c.ok)) checks.push(checkModelSlugs(cfg, scope, opts.modelOverrides, selected));
  // ⑥ 归档与 git（无残留探测）
  if (checks.every((c) => c.ok)) checks.push(await checkArchiveAndGit(ctx));
  // ⑦ 命令 A 的编译测试配置
  if (checks.every((c) => c.ok)) {
    const v = checkVerifyConfigured(cfg, scope);
    if (v) checks.push(v);
  }
  // ⑧ 探活（最贵的一项，放最后，前面失败就不必烧配额）
  if (checks.every((c) => c.ok)) {
    if (opts.skipAuthCheck) {
      checks.push({
        name: '探活',
        ok: true,
        detail: '⚠️ 已跳过（--skip-auth-check）。若凭据实际失效，会在运行中段才暴露。',
      });
    } else {
      const adapters = realAdapters();
      const probes = await Promise.all(
        selected
          .filter((id) => adapters[id])
          .map((id) => probeAuth(ctx, id, adapters[id]!, opts)),
      );
      for (const p of probes) {
        checks.push(p.result);
        if (p.cache) pendingAuthCache[p.critic] = p.cache;
      }
    }
  }

  const failed = checks.find((c) => !c.ok);
  return {
    ok: failed === undefined,
    scope,
    checks,
    exitCode: failed?.exitCode ?? (failed ? EXIT.ENV : EXIT.OK),
    pendingAuthCache,
  };
}

/**
 * 全部通过后才写探活缓存（GLM-05），且走全局锁（GLM-07）。
 *
 * 顺序很重要：**先判定通过，再写缓存**。反过来会让「预检失败」也留下写入，
 * 使 AC-16 的零工件承诺在字面上不成立。
 */
export async function commitAuthCache(ctx: Ctx, r: PreflightResult): Promise<void> {
  if (!r.ok) return;
  if (Object.keys(r.pendingAuthCache).length === 0) return;
  await patchProbe(
    ctx.triviumDir,
    (p) => {
      p.auth = { ...(p.auth ?? {}), ...r.pendingAuthCache };
    },
    ctx.config.review.heartbeat_stale_s * 1000,
  );
}

export function renderPreflight(r: PreflightResult): string {
  const lines = [`预检（scope=${r.scope}）`, '─'.repeat(60)];
  for (const c of r.checks) {
    lines.push(`  ${c.ok ? '✓' : '✗'} ${c.name}`);
    if (c.detail) for (const l of c.detail.split('\n')) lines.push(`      ${l}`);
  }
  lines.push('');
  lines.push(r.ok ? '✓ 预检通过' : `✗ 预检未通过（退出码 ${r.exitCode}）——不会产生任何工件`);
  return lines.join('\n');
}
