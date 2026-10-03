/**
 * Codex 适配器（设计 §11.1 / §3.6，M8 第 3 步）。
 *
 * 与既有两家最要紧的差别不在参数，在**能力形状**：codex 读文件就是跑 shell，
 * 路径只在命令文本里（P-C1），被沙箱拒绝的命令一条事件都不产生（P-C2）。
 * 判定层已在第 2 步改为面向 `TraceCapability`，所以这里只声明能力、不特判。
 *
 * 铁律（原则 P7）：**取值必须靠实测才知道的旗标**一律由 probe 结论构造，
 * 不得硬编码设计文档里的示例。**这不等于「适配层不得出现任何旗标字面量」**——
 * 机制类旗标（输出格式、cwd、颜色、prompt 载入方式）由编排器需求决定、不是厂商能力事实，
 * 按设计 §11.1「旗标归属判据」就该写在本层；下面的 buildXxxArgs 本来就是这么写的。
 */
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import type { CriticRequest, CriticResult, CodexCriticConfig } from '../types.js';
import { run } from '../util/exec.js';
import { ensureDir, exists, sha256File, tildeHome, tryRemoveTempDir } from '../util/fsx.js';
import { agentConfigOf } from '../config.js';
import {
  parseCodexEvents,
  readSessionMeta,
  succeededCommands,
  traceCompleted,
  type CodexSessionMeta,
  type CodexTrace,
} from './codex-trace.js';
import {
  codexCredentialCopies, codexHomeOf, codexHomeUnder, codexPrepStepOf, prepareCodexHome, scrubCodexHome,
  type CodexHomePrep,
} from './codex-home.js';
import {
  classifyWriteCommands,
  failedResult,
  COMMAND_TRACE_CAPABILITY,
  type AdapterContext,
  type CriticAdapter,
} from './base.js';

export interface CodexInvokeOptions {
  bin: string;
  cwd: string;
  /** 送审包全文。走 stdin，不进 argv */
  prompt: string;
  profile: string | null;
  model: string | null;
  effort: string | null;
  /** 探针实测被接受的只读旗标（argv 形态） */
  readonlyArgs: string[];
  codexHome: string;
  fakeHome: string;
  timeoutMs: number;
}

/**
 * argv 拼装。纯函数，与执行分离，让调用配方有回归测试。
 *
 * **prompt 走 stdin（末尾的 `-`）而不是 argv**：送审包是几十 KB 量级的文本，
 * 塞进 argv 是在赌 `ARG_MAX`。`codex exec --help` 明载 `[PROMPT]` 支持 `-`
 * 从 stdin 读，本步实测以 78 KB 跑通。
 *
 * **不传 `--output-schema`，这是实测结论而不是遗漏**（EV-124，解析回退逐条降级主题）：
 * 本机 qwen provider（经 `responses` 兼容端点）下两次最小调用——一次喂 `review.v1.json`、一次喂
 * 严格模式兼容的最小 schema——CLI 都退 0，模型输出都**逐字照提示违规**，schema 被静默忽略
 * （读数 `doc/05_testing/evidence/parse-degrade-20261001/ev124-probe/`）。在已测的 provider 上接了不生效，
 * 还会让读代码的人以为 codex 侧有生成约束；codex 侧的输出约束只靠任务书第 6 节。
 * **其它 provider（含 OpenAI 自家 Responses）未测**：换 provider 或 CLI 升级后要接，先按同一装置重测
 * （BACKLOG EV-179），不要照 agy / claude 的样子顺手加上。
 */
export function buildCodexArgs(
  opts: Pick<CodexInvokeOptions, 'profile' | 'model' | 'effort' | 'readonlyArgs' | 'cwd'>,
): string[] {
  return [
    'exec',
    ...(opts.profile ? ['-p', opts.profile] : []),
    ...(opts.model ? ['-m', opts.model] : []),
    ...(opts.effort ? ['-c', `model_reasoning_effort=${opts.effort}`] : []),
    ...opts.readonlyArgs,
    '--json',
    '--skip-git-repo-check',
    '-C', opts.cwd,
    '-',
  ];
}

/**
 * 只读旗标由探针结论构造（P7）。
 *
 * 本机实测值是 `['-s','read-only']`，且该结论是**负对照挣来的**：探针让模型
 * 在 cwd 建文件，文件没被创建才记这个值；创建成功则记空数组。
 * 所以空数组的含义是「本机沙箱不可信」，此时该侧必须判不可用——
 * 绝不能回落到一个「文档上写着应该管用」的默认值。
 */
export function readonlyArgsFromProbe(readonlyFlags: readonly string[]): string[] {
  return [...readonlyFlags];
}

export interface CodexInvokeOutcome {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  commandLine: string;
  durationMs: number;
}

/** **唯一**执行 codex 的地方 */
export async function invokeCodex(opts: CodexInvokeOptions): Promise<CodexInvokeOutcome> {
  const args = buildCodexArgs(opts);
  const r = await run(opts.bin, args, {
    cwd: opts.cwd,
    env: { CODEX_HOME: opts.codexHome, HOME: opts.fakeHome },
    /*
     * stdin 必须显式给：codex 在 argv 已带 prompt 时**仍然读 stdin**
     * （stderr 恒打印 `Reading additional input from stdin...`）。
     * 本步实测踩过——继承了一个不会 EOF 的 stdin，进程挂到超时被杀。
     */
    stdin: opts.prompt,
    timeoutMs: opts.timeoutMs,
    killTree: true,
  });
  return {
    stdout: r.stdout,
    stderr: r.stderr,
    exitCode: r.code,
    timedOut: r.timedOut,
    commandLine: r.commandLine,
    durationMs: r.durationMs,
  };
}

/**
 * 认证探活临时目录删不掉时的人读提示（EV-200）：与 zcode 的 `zcodeTempDirResidueText` 同句式，主语固定「探活」。
 *
 * 只有两档、没有哨兵档：副本里的三份载体（裁剪后的 `config.toml`、profile 分层文件、原样拷入的 `auth.json`）
 * 都可能含真实凭据——`trimCodexToml` 保留整段 `[model_providers.*]`，里面可以有 `experimental_bearer_token`。
 * `hasCopies` 是删除失败后现场查的结论（查不了按有说），不是按写入时的情形推断。
 * 两档共用一个前缀，家目录统一归一成 `~`（计划双审 AGY-01）。
 *
 * 「没有」档只说没有凭据副本、不断言剩下的是什么（代码双审 CODEX-02 ≡ GLM-01）：副本准备失败时 CLI 从未拉起，
 * `rewriteHomePaths` 拷进来的用户文件（如模型目录）也可能比三份载体后删——说成「CLI 产物」都不属实。
 */
export function codexTempDirResidueText(runDir: string, code: string, hasCopies: boolean): string {
  return (
    `⚠️ 探活临时目录删除失败（${code}）：${tildeHome(runDir)} 仍在，` +
    (hasCopies
      ? '其中的 codexhome 凭据副本（auth.json 与 toml）含真实凭据，请手工删除'
      : '其中没有凭据副本，剩下的是本次探活的临时文件，请手工删除')
  );
}

/** 删认证探活的临时目录（只删 mkdtemp 的返回值）：失败不抛，返回上面那句提示；删成功返回 null */
async function removeCodexAuthTempDir(tmp: string, profile: string | null): Promise<string | null> {
  const left = await tryRemoveTempDir(tmp, codexCredentialCopies(codexHomeUnder(tmp), profile));
  return left === null ? null : codexTempDirResidueText(tmp, left.code, left.remaining.length > 0);
}

/**
 * 从一份 TOML 里抽出全部 `[model_providers.*]` 段的正文（含段头）。
 *
 * 供探活指纹使用：**只有这部分与鉴权相关**，其余顶层杂项每次用 codex 都在变，
 * 并进指纹会让缓存恒失效。抽不到就返回 null（该文件没有 provider 定义）。
 */
export function providerSection(text: string): string | null {
  const out: string[] = [];
  let inSection = false;
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (t.startsWith('[')) {
      inSection = t.startsWith('[model_providers');
      if (inSection) out.push(line);
      continue;
    }
    if (inSection) out.push(line);
  }
  return out.length > 0 ? out.join('\n') : null;
}

/** 取 codex 的配置段。缺段或 vendor 不符时由 `agentConfigOf` 响亮失败 */
function codexConfig(ctx: AdapterContext): CodexCriticConfig {
  return agentConfigOf(ctx.cfg, 'codex', 'openai') as CodexCriticConfig;
}

/**
 * 把一次运行的原始事实组装成 `CriticResult`。
 *
 * **抽成纯函数是为了能被变异验证打中**（M8 第 3 步）：这里有一条 AC-20 的硬判据——
 * 「生效模型以回读为准、拿不到就记 `unverified`，绝不用 requested 冒充」——
 * 而它原先埋在 `run()` 里，要真跑 codex 才走得到。跑一次 M4 变异
 * （`meta.modelEffective ?? req.model`）证实了这一点：全量用例无一变红。
 * 冒充的后果不是数字难看，是 AC-20 那条验收**永远通过、永远没有意义**。
 */
export function buildCodexResult(
  trace: CodexTrace,
  meta: CodexSessionMeta,
  o: Pick<CodexInvokeOutcome, 'exitCode' | 'durationMs' | 'commandLine'>,
  paths: { stdout: string; trace: string },
  /*
   * `path_deny` 取 `file_shape_verified` 那一格（EV-42）：入参类型跟着收，
   * 免得窄化结构体把新字段挡在外面、又得回头改一次。
   */
  probe: { version: string | null; path_deny: { file_shape_verified: boolean | null } },
  projectRoot: string,
  /**
   * 本次请求的厂商 profile（`agents.codex.profile`）。
   *
   * **走入参而不是让 `run()` 事后补**：M8 第 3 步的 M4 变异证实过，
   * 埋在 `run()` 里的字段组装没有任何用例守得到（要真跑 codex 才走得到那行）。
   * 请求值与回读值在同一个纯函数里成对产出，单测才咬得住「谁是请求、谁是回读」。
   */
  profileRequested: string | null,
): CriticResult {
  /*
   * 写判据在这里算，不从调用方传进来：判据与它产出的两个字段绑在一处，
   * 才不会出现「算了一套、填了另一套」。入参只喂**成功执行**的命令，
   * 而 `command_texts` 拿全集——两者论域不同，见 `classifyWriteCommands` 的契约。
   */
  const allCommands = trace.commands.map((c) => c.command);
  const { writes, suspected } = classifyWriteCommands(succeededCommands(trace), projectRoot);

  return {
    critic: 'codex',
    status: 'ok',
    exit_code: o.exitCode,
    duration_s: o.durationMs / 1000,
    raw_stdout_path: paths.stdout,
    trace_path: paths.trace,
    review_json: null, // 由 parse 填充
    raw_response_text: trace.finalText,
    model_effective: meta.modelEffective,
    /*
     * 回读到就记 trace，回读不到记 unverified——**绝不用 requested 冒充**
     * （与 zcode 侧同一条纪律）。AC-20 要核对「生效模型与指定一致」，
     * 拿意图值冒充会让那条验收永远通过、永远没有意义。
     */
    model_effective_source: meta.modelEffective ? 'trace' : 'unverified',
    /*
     * 回读值。`parseCodexSessionMeta` 一直解析着它，而上一版把它丢了——
     * 采了、丢了，全仓零消费方（计划双审 E-1）。
     * 它与 `model_effective` 是两个维度：实测 `-p qwen -m deepseek-v4-pro` 成功，
     * provider=qwen 而模型名是 deepseek-v4-pro。
     */
    model_provider: meta.modelProvider,
    /*
     * 请求值。与上面一行成对，且**方向相反**：这条来自配置，那条来自会话文件。
     * 绝不互相顶替——拿请求值冒充回读值会让 AC-20 永远通过、永远没有意义。
     */
    profile_requested: profileRequested,
    model_route: 'config_copy',
    tool_calls: { run_command: trace.commands.length },
    /*
     * **恒为空数组，且这是能说明理由的空**：codex 没有结构化读取路径字段
     * （P-C1 实测），读取路径由判定层从 `command_texts` 回填
     * （`effectiveReadPaths`，第 2 步落地）。空的含义是「该侧没有这种字段」，
     * 不是「没采集」。
     */
    read_paths: [],
    /*
     * **未采集**，不是「无此事实」（代码双审 CODEX-01）：命令 stdout 就在轨迹里
     * （`codex-trace.ts` 把 `aggregated_output` 收进 `commands[].output`，run() 原样落 trace.json），
     * 只是适配器没对它做搜索命中解析——解析任意 shell 输出另是一档代价（EV-19 族）。
     * 记 null 表示「本侧没有采集这项事实」；要做时从 trace.json 的 `commands[].output` 起步。
     */
    search_hit_paths: null,
    write_events: writes,
    suspected_write_events: suspected,
    command_texts: allCommands,
    evidence_ok: false, // 由 guard 判定
    fail_reason: null,
    session_id: trace.threadId,
    cli_version: meta.cliVersion ?? probe.version,
    // 实测：codex 无路径级 deny 机制（`path_deny.supported === false`）
    /*
     * **读 `file_shape_verified`，不读 `supported`**（BACKLOG EV-42，代码双审 r4 CODEX-03）。
     *
     * `supported` 回答「这家 CLI 有没有路径级 deny 机制」；这一格回答的是
     * **「本机曾实测该逐文件形状可拦」**——两件事。
     *
     * **措辞要准**（代码双审 r2 GLM-01）：上一版这里写的是「本次注入的那些逐文件
     * 路径真的挡住了」，那**比字段能知道的更多**——它的取值来自探针夹具里的
     * 单条 ASCII 路径，对**本次**注入的那批规则（可能含被跳过的、含 glob 元字符的）
     * 一无所知。逐条结果看 `trace.json` 的 `denySettings.skippedPaths`。
     *
     * 三态在这里天然安全：`null`（没验过）与 `false` 都判不过 `=== true`。
     */
    peer_deny_applied: probe.path_deny.file_shape_verified === true,
    /*
     * 该侧不注入 `--settings`（无路径级 deny 机制），**恒为 0 且这是能说明理由的零**：
     * 含义是「没有这种概念」，不是「注入了但一条都没跳过」。
     */
    deny_skipped: 0,
    deny_rule_count: 0,
    deny_bytes: 0,
    command_line: o.commandLine,
  };
}

export const codexAdapter: CriticAdapter = {
  critic: 'codex',
  /*
   * 读即命令、被拒不留痕。两条都是 M6 实测（P-C1 / P-C2），
   * 本步的隔离实测再次复现了后者：让模型写 /tmp，文件没建成，
   * 而轨迹里连那条命令都没有。
   */
  capability: COMMAND_TRACE_CAPABILITY,

  /*
   * 能执行只读命令：`CODEX_READONLY_INVARIANTS` = `-s read-only`，沙箱让 shell 跑、写在系统调用层失败（EV-95）。
   * 与上一行的 `command-trace` 是两件事：那一项说轨迹形状，这一项说审查员能做什么。
   */
  commandExecution: 'readonly-shell',

  /**
   * 探活。
   *
   * 指纹取三部分：本次 profile 的分层文件、`auth.json`、以及基底 `config.toml` 里的
   * **`[model_providers.*]` 段**。任一改动都会换掉凭据或 provider，旧的「已认证」随即失效。
   *
   * 基底文件**整份**不进指纹——它的其余内容（plugins、mcp_servers、projects 信任表）
   * 与鉴权无关且每次用 codex 都在变，整份哈希会让缓存恒失效。
   * 只取 provider 段是 r9 双审 GLM-10 的处置：那条指出 provider 定义**可能只写在基底里**
   * （`probeCodexProviders` 对两份 toml 都查，正说明这是真实形态），
   * 而我当初排除整个基底的理由只对那些杂项成立、对 provider 段不成立。
   *
   * 最小调用走与真实审查**同一条隔离路径**（裁剪副本 + 双覆盖）：
   * 探活若走宿主机配置而真实运行走副本，探到的「能用」证明不了副本里也能用——
   * 那正是本步要防的失败形态（F-2 的退出就发生在副本里，宿主机上一切正常）。
   */
  authProbe(ctx: AdapterContext, projectRoot: string) {
    const cfg = ctx.cfg;
    const profile = codexConfig(ctx).profile;
    return {
      async fingerprint(): Promise<string | null> {
        const home = codexHomeOf();
        const parts: string[] = [];
        for (const f of [profile ? `${profile}.config.toml` : null, 'auth.json']) {
          if (!f) continue;
          const p = path.join(home, f);
          if (await exists(p)) parts.push((await sha256File(p)) ?? '');
        }
        /*
         * 基底 `config.toml` 的 **provider 段**也要进指纹（r9 双审 GLM-10）。
         *
         * 不取整份文件：它的大部分内容（plugins、mcp_servers、projects 信任表）
         * 与鉴权无关且每次用 codex 都在变，整份哈希会让缓存恒失效——那是当初
         * 排除它的理由，而那个理由**只对那些杂项成立**。
         * provider 段可能只写在基底里（`probeCodexProviders` 对两份 toml 都查
         * 正说明这是真实形态），在那里轮换凭据不该让「已认证」缓存继续沿用。
         */
        const base = path.join(home, 'config.toml');
        if (await exists(base)) {
          const seg = providerSection(await fs.readFile(base, 'utf8'));
          if (seg) parts.push(createHash('sha256').update(seg).digest('hex'));
        }
        return parts.length > 0 ? parts.join(':') : null;
      },
      async probe(): Promise<{ ok: boolean; detail: string }> {
        const probe = cfg.probe.cli.codex;
        const bin = codexConfig(ctx).bin ?? probe?.entrypoint ?? null;
        if (!bin) return { ok: false, detail: 'codex 入口未记录' };

        /*
         * 临时根下的 `codexhome/` 里是含真实凭据的副本，用完即删；删除只认 mkdtemp 的返回值（2026-09-20 事故后的规矩）。
         *
         * 删除收尾（EV-200，照 zcode 探活 EV-197 的形态）：结果在 `attempt` 里拼完，删除放在它外面的 finally、失败不抛。
         * 此前 finally 里裸删、结果在 try 里直接 return——ENOTEMPTY / EBUSY / EACCES 会顶替探活结果，穿过无兜底的
         * `probeAuth` 把预检崩成内部错误，含真实凭据的副本留在系统临时目录无人知晓。删不掉时把残留提示接在详情末尾，
         * 结论（ok）不因此改变；提示用哪一档由删除失败后现场查三份凭据副本决定。
         * 已知残余：attempt 抛错且删不掉时提示随异常丢失（与 zcode 两侧同形；副本准备已兜住，抛出面近于空）；
         * 正结论入缓存后，TTL 期内的预检走缓存命中，提示只在当次可见。
         */
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-codex-auth-'));
        let r: { ok: boolean; detail: string };
        let residue: string | null = null;
        try {
          r = await attempt(bin, tmp, probe?.readonly_flags ?? []);
        } finally {
          residue = await removeCodexAuthTempDir(tmp, profile);
        }
        return residue === null ? r : { ok: r.ok, detail: `${r.detail}；${residue}` };
      },
    };

    /** 一次探活的全部工作（EV-200 从 probe() 拆出）：结果在这里拼完，删除留给调用方的 finally */
    async function attempt(bin: string, tmp: string, readonlyFlags: readonly string[]): Promise<{ ok: boolean; detail: string }> {
      let home: CodexHomePrep;
      /*
       * 副本准备会读、写、收紧权限，都可能抛（EV-200 决策三）：落成一条可读的检查项失败，不能抛出去——`probeAuth` 没有兜底。
       * 前缀与 `run()` 的兜底同一句；步骤名由 `prepareCodexHome` 挂在原错误对象上（消息不改，`run()` 的输出因此不变）。
       */
      try {
        home = await prepareCodexHome(tmp, { profile, projectRoot });
      } catch (e) {
        const step = codexPrepStepOf(e);
        return {
          ok: false,
          detail: `准备 codex 隔离副本失败${step ? `（${step}）` : ''}：${tildeHome(e instanceof Error ? e.message : String(e))}`,
        };
      }
      const out = await invokeCodex({
        bin,
        cwd: projectRoot,
        prompt: '只回复 OK 两个字母，不要调用任何工具。',
        profile,
        model: null, // 用 profile 的默认模型，探的是凭据不是模型路由
        effort: null,
        readonlyArgs: readonlyArgsFromProbe(readonlyFlags),
        codexHome: home.codexHome,
        fakeHome: home.fakeHome,
        timeoutMs: 120_000,
      });
      const trace = parseCodexEvents(out.stdout);
      const ok = traceCompleted(trace, out.timedOut);
      return {
        ok,
        detail: ok
          ? `探活通过（${Math.round(out.durationMs / 1000)}s）`
          : `探活失败：${trace.errors.join('；') || out.stderr.slice(0, 200) || '(无错误消息)'}。\n` +
            `  请确认 profile「${profile ?? '(未配置)'}」对应的 provider 凭据可用。`,
      };
    }
  },

  availability(ctx: AdapterContext) {
    // 两态判据同另两家：以 probed_at 区分「没探过」与「探过没找到」
    const p = ctx.cfg.probe.cli.codex;
    if (!p?.probed_at) {
      return { ok: false, reason: 'codex 尚未探测，请先运行 trivium doctor --only codex' };
    }
    if (!p.entrypoint) {
      return { ok: false, reason: '探针未找到 codex 可执行文件，请先运行 trivium doctor' };
    }
    if (p.readonly_flags.length === 0) {
      return {
        ok: false,
        reason:
          '探针未实测到可用的只读旗标——**这包括只读沙箱负对照失败的情形**' +
          '（read-only 下文件仍被创建时探针会把该字段清空）。无法保障审查员只读，该侧不可用。',
      };
    }
    if (p.exec_headless_read_ok === false) {
      return {
        ok: false,
        reason: 'codex exec headless 读不到文件，该侧无法作为审查员使用。请重跑 trivium doctor --only codex',
      };
    }
    if (p.exec_headless_read_ok === null) {
      return {
        ok: false,
        reason: '探针尚未实测 codex 的 headless 读取能力（上次探测没跑完），请重跑 trivium doctor --only codex',
      };
    }

    /*
     * provider 家族必须带得出凭据（J8 / AC-20 末条）。
     *
     * 判据落在**本次 profile** 上而不是「有任意一家可用」：家族由 profile 决定，
     * 而未知 profile 会被 codex **静默回落**到基底配置（`unknown_profile_rejected`
     * 实测为 false），所以这里不拦，用户就会以为跑的是 deepseek、实际跑的是别家。
     */
    const wanted = codexConfig(ctx).profile;
    if (wanted !== null) {
      const hit = p.providers.find((x) => x.profile === wanted);
      if (!hit) {
        const known = p.providers.map((x) => x.profile).join('、') || '（探针未发现任何 profile）';
        return {
          ok: false,
          reason:
            `配置的 codex profile「${wanted}」在本机不存在。已探测到的：${known}。\n` +
            '  注意 codex 对未知 profile 不报错、而是静默回落基底配置，所以这道拦截由预检负责。',
        };
      }
      if (!hit.credentialed) {
        return {
          ok: false,
          reason:
            `codex profile「${wanted}」对应的 provider「${hit.provider ?? '未知'}」没有可用凭据。\n` +
            `  请在 ${'~/.codex'}/${wanted}.config.toml 或 config.toml 的 [model_providers.${hit.provider ?? '<家族>'}] 段配置凭据后重跑 doctor。\n` +
            '  编排器不代写凭据、也不改你的全局配置（纪律 5）。',
        };
      }
    }
    return { ok: true };
  },

  /**
   * 本次 profile 生效的模型目录（D4-1 = C″，计划双审 CODEX-05）。
   *
   * 数据来自探针的 `models_by_profile`——**不实时读盘**：`availability()` 其余五条判据
   * 全部读探针结论，同一件事在同一个文件里出现两份判据、两个时点是 CODEX-04 点名的形态。
   * 目录文件变了由探针 TTL 与 `checkProbeFreshness` 负责，不由本函数兜。
   *
   * **四种返回的语义以 `CriticAdapter.catalogModelsFor` 的契约表为准，此处不复述**——
   * 上一版在这里复述成「三种」且把 `fallback` 那一支写成了「无法校验」，
   * 与同文件的实现和它自己的锁例直接矛盾（代码双审 CODEX-04）。
   * 复述两处正是「同一个问题两个答案」，而它已经漂过一次。
   */
  catalogModelsFor(cfg) {
    const profile = agentConfigOf(cfg, 'codex', 'openai').profile;
    const p = cfg.probe.cli.codex;

    /*
     * 没配 profile ⇒ 生效的就是基底目录。**用它的可见子集校验，不是 `models` 全集**：
     * 全集含 `visibility: "hide"` 的条目（本机基底 7 条里有 2 条），
     * 而端点的合法名单只认可见项——拿全集当判据会放行隐藏项、复制 E-4 的误放，
     * 而这正是 `probeCodexModels` 文档块自己写着要防的（代码双审 GLM-03：
     * 上一版只在配了 profile 的那一半做了过滤，默认形态原样漏着）。
     */
    if (!profile) {
      const visible = p?.models_visible ?? [];
      return visible.length > 0
        ? { kind: 'catalog' as const, models: visible, source: '基底模型目录（可见项）' }
        : null; // 旧留痕没有这个字段 ⇒ 回落 `probe.models`，行为与本步之前逐字相同
    }

    /*
     * 采集**失败**（子进程非零退出、输出不可解析）——不知道目录里有什么。
     * 这一格必须与「确认没有目录」分开：合流会让一次子进程失败静默变成放行
     * （代码双审 CODEX-01）。
     */
    const failed = p?.models_by_profile_errors?.[profile];
    if (failed) {
      return {
        kind: 'fallback' as const,
        why: `profile「${profile}」的模型目录采集失败（${failed}），本次改用基底目录校验`,
      };
    }

    const byProfile = p?.models_by_profile ?? {};
    /*
     * 整张表为空 ⇒ M8 第 4 步之前落盘的旧 `config.local.yaml`（那时还没有这个字段）。
     *
     * **回落基底、但要说出来**（代码双审 CODEX-05）。上一版这里返回 `null`，
     * 于是预检**静默**拿含隐藏项的基底全集校验——与修复前逐字相同的行为，
     * 而 `types.ts` 那边的契约文字却承诺「记为 unverifiable、不静默通过」，
     * 承诺与实现对不上。走 `fallback` 两头都顾：不 fail-open（照常校验），
     * 且「回落要说出来」的纪律覆盖到这一格。
     */
    if (Object.keys(byProfile).length === 0) {
      return {
        kind: 'fallback' as const,
        why: '探针结论早于逐 profile 模型目录，本次按基底目录校验，请重跑 doctor --only codex',
      };
    }

    const models = byProfile[profile];
    /*
     * 表在、没有失败记录、却也没有本 profile 的条目 ⇒ 探针跑过但该 profile 不在名单里
     * （配置里写了一个 `$CODEX_HOME` 下不存在的 profile）。这不是「目录为空」，
     * 交给 `availability()` 的 profile 存在性检查去拦，本函数如实报「没测过」。
     */
    if (models === undefined) {
      return {
        kind: 'fallback' as const,
        why: `探针没有 profile「${profile}」的模型目录结论（该 profile 可能不存在），本次改用基底目录校验`,
      };
    }
    /*
     * 采到了、而且确实是空的 ⇒ 该机没配 `model_catalog_json`（只装官方 `auth.json`
     * 的普通安装是常态，计划双审 CODEX-11）。这一格才是真正的「无法校验」。
     */
    if (models.length === 0) {
      return {
        kind: 'unverifiable' as const,
        why: `profile「${profile}」渲染出的模型目录为空（该机可能未配置 model_catalog_json）`,
      };
    }
    return { kind: 'catalog' as const, models, source: `profile「${profile}」的模型目录` };
  },

  /**
   * 凭据载体在 `<侧>/codexhome/`，由 `prepareCodexHome` 写入；抹除见 `scrubCodexHome`。
   * 调用方是 `runner` 的 `finally` 与三处清扫路径，不在本适配器内自调（`scrub.ts` 文件头）。
   */
  async scrubRunDir(sideDir: string, opts?: { sizeCap?: number }) {
    return scrubCodexHome(codexHomeUnder(sideDir), opts);
  },

  async run(ctx: AdapterContext, req: CriticRequest): Promise<CriticResult> {
    // 先取配置：失败出口也要写得出请求值（CODEX-03 ≡ GLM-02）
    const cfgEarly = codexConfig(ctx);
    const probe = ctx.cfg.probe.cli.codex;
    if (!probe?.probed_at) {
      return failedResult('codex', {
        status: 'failed',
        reason: 'codex 尚未探测，请先运行 trivium doctor --only codex',
        profileRequested: cfgEarly.profile,
      });
    }
    if (!probe.entrypoint) {
      return failedResult('codex', {
        status: 'failed',
        reason: 'codex 入口未探测到',
        profileRequested: cfgEarly.profile,
      });
    }

    const cfg = codexConfig(ctx);
    const bin = cfg.bin ?? probe.entrypoint;
    await ensureDir(req.out_dir);
    const stdoutPath = path.join(req.out_dir, 'stdout.jsonl');
    const tracePath = path.join(req.out_dir, 'trace.json');

    // 隔离：CODEX_HOME + HOME 双覆盖，配置按白名单裁剪（EV-08 + 本步实测）
    let home: CodexHomePrep;
    try {
      home = await prepareCodexHome(path.dirname(req.out_dir), {
        profile: cfg.profile,
        projectRoot: req.project_root,
      });
    } catch (e) {
      return failedResult('codex', {
        status: 'failed',
        reason: `准备 codex 隔离副本失败：${(e as Error).message}`,
        profileRequested: cfg.profile,
      });
    }

    let out: CodexInvokeOutcome;
    try {
      out = await invokeCodex({
        bin,
        cwd: req.project_root,
        prompt: req.brief_text,
        profile: cfg.profile,
        model: req.model,
        effort: req.effort ?? null,
        readonlyArgs: readonlyArgsFromProbe(probe.readonly_flags),
        codexHome: home.codexHome,
        fakeHome: home.fakeHome,
        timeoutMs: req.timeout_s * 1000,
      });
    } catch (e) {
      return failedResult('codex', {
        status: 'failed',
        reason: `拉起 codex 失败：${(e as Error).message}`,
        profileRequested: cfg.profile,
      });
    }

    await fs.writeFile(stdoutPath, out.stdout, 'utf8');
    const trace = parseCodexEvents(out.stdout);

    if (out.timedOut) {
      return failedResult('codex', {
        status: 'timeout',
        reason: `脚本级超时（${req.timeout_s}s）`,
        exitCode: out.exitCode,
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: trace.threadId,
        profileRequested: cfg.profile,
      });
    }

    if (!traceCompleted(trace, out.timedOut)) {
      /*
       * 没有最终回复即视为没跑成——退出码不足以判定（codex 在模型拒绝任务时也可能退 0）。
       * 失败原因优先取事件流里的 error 消息：跨家族调用时那里写的是
       * `Model not found: …`，而退出码只有一个 1。
       */
      const why = trace.errors.length > 0 ? trace.errors.join('；') : out.stderr.slice(0, 300);
      return failedResult('codex', {
        status: 'failed',
        reason: `codex 未产出最终回复：${why || '(无错误消息)'}`,
        exitCode: out.exitCode,
        durationS: out.durationMs / 1000,
        rawStdoutPath: stdoutPath,
        cliVersion: probe.version,
        commandLine: out.commandLine,
        sessionId: trace.threadId,
        profileRequested: cfg.profile,
      });
    }

    // 生效模型回读：会话文件首行的 session_meta（事件流里没有 model 字段）
    const meta = await readSessionMeta(home.codexHome, trace.threadId);

    /*
     * 写判定：只把**成功执行**的命令喂进分类器。
     * `command_texts` 保留全集给措施 b——泄漏企图即便失败也要被扫到，两者论域不同。
     */
    const { writes, suspected } = classifyWriteCommands(
      succeededCommands(trace),
      req.project_root,
    );

    await fs.writeFile(
      tracePath,
      JSON.stringify(
        {
          threadId: trace.threadId,
          eventTypes: trace.eventTypes,
          itemTypes: trace.itemTypes,
          commands: trace.commands,
          errors: trace.errors,
          writeEvents: writes,
          suspectedWrites: suspected,
          isolation: {
            codexHome: home.codexHome,
            strippedKeys: home.strippedKeys,
            rewrittenPaths: home.rewrittenPaths,
            copiedFiles: home.copiedFiles,
            warnings: home.warnings,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    return buildCodexResult(
      trace,
      meta,
      out,
      { stdout: stdoutPath, trace: tracePath },
      probe,
      req.project_root,
      cfg.profile,
    );
  },
};
