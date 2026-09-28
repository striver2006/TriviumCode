/**
 * 桩适配器与跨进程注入（设计 §17.1 集成层，按修订版 M3 计划 §5 实现）。
 *
 * ## 为什么需要跨进程机制
 *
 * `review --start` 会 `spawnDetached` 一个独立的 `trivium review --worker <runId>` 进程，
 * 而 `rebuildContext` 在那个进程里**硬编码**真实适配器：
 *
 * ```ts
 * adapters: { gemini: agyAdapter, glm: zcodeAdapter }
 * ```
 *
 * 因此「只在测试主进程里替换 `CriticAdapter.run`」对派生的 worker **完全无效**——
 * 故障注入会静默失效，测试看似通过实则什么都没注入（审查意见 AGY-05）。
 *
 * 解法是环境变量：`spawnDetached` 继承环境变量，worker 里的适配器工厂读到它就返回桩。
 *
 * ## 安全边界
 *
 * 生产路径若检测到这个变量会打**醒目告警**——它能伪造「审查通过」，
 * 绝不能在真实审查里生效而无人知晓。
 */
import path from 'node:path';
import { agentById, DEFAULT_DRIVER } from '../agents/registry.js';
import { CRITICS, type CriticId, type CriticRequest, type CriticResult } from '../types.js';
import {
  failedResult,
  TOOL_TRACE_CAPABILITY,
  type AdapterContext,
  type AdapterTable,
  type CriticAdapter,
} from './base.js';
import { warn } from '../util/log.js';
import { run } from '../util/exec.js';

export const STUB_ENV_VAR = 'TRIVIUM_STUB_CRITIC';

/** 可注入的故障形态，对应 §17.2 的必测用例 */
export type StubMode =
  /** 正常返回一份合规结论 */
  | 'ok'
  /** 超时（对应「一侧进程被杀」） */
  | 'timeout'
  /** 返回非 JSON（对应「一侧返回非 JSON」） */
  | 'dirty_output'
  /** exit 0 但零工具调用（对应 Antigravity 软拒绝 / 纯 LLM 冒充 Agent） */
  | 'no_tools'
  /** 只读了送审包与被审对象，未读任何项目文件 */
  | 'no_project_reads'
  /** 向项目写文件（对应「审查中写入业务文件」） */
  | 'write_breach'
  /**
   * 读取了禁读清单里的文件（对应「读到对方产出」）——措施 a 的通道。
   *
   * `note` 为条目筛选子串（缺省读全部条目，筛空则该侧失败）。
   */
  | 'peer_leak'
  /**
   * 读运行根这棵**混合树**下的具体文件——`note: 'own'`（缺省）读本侧那一份与
   * 编排器的运行时文件，`note: 'peer'` 读对端那一份。
   *
   * 两者撞的是**同一个** deny 条目（整棵运行根），处置却分属「不算命中」与
   * 「判作废」两档。`peer_leak` 的条目筛选分不开它们，所以单列一个形态。
   */
  | 'run_material_leak'
  /**
   * **只**经命令文本提到禁读条目、文件系统上没有对应读取
   * （`git show HEAD:<归档内文件>`）——措施 b 的通道（§10.1 / EV-01）。
   *
   * 与 `peer_leak` 分列而不是合并：两条通道要能各自单独触发，
   * 否则「一条挂了另一条还在」的单边失效测不出来。
   */
  | 'peer_leak_via_command'
  /**
   * **真的**改动工作树里的一个文件（`note` = 项目相对路径，不存在则创建），
   * 对应「审查期间开发者在别处继续改代码」——轨迹里没有写事件，只有指纹变化。
   * 用来验证跑后复算的漂移判定（设计 §9.2）。
   */
  | 'mutate_file'
  /**
   * 产出**前缀不属于本侧**的结论（`note` = 要冒用的前缀，缺省为「另一侧的前缀」）。
   *
   * 对应两种真实形态：冒名（某侧产出对侧前缀）与未登记前缀（模型自造 `FOO-01`）。
   * 放开 `review.v1.json` 的前缀枚举之前，这两种都被 ajv 挡在门外；放开之后
   * 它们是 schema 合法的结构化结论，必须由注册表判定接住——本模式就是那条
   * 接力是否成立的检验（审查意见 AGY-01 ≡ GLM-02）。
   */
  | 'wrong_prefix'
  /**
   * **「读即命令」形态**（§11.1，M8 第 2 步）：路径只存在于命令文本里，
   * `read_paths` 恒空、`tool_calls` 只有 `run_command`，且被拒的写不留痕。
   *
   * 形态取自 M6 真实录制样本 `test/fixtures/codex-events/read-sentinel.jsonl`
   * 的命令形状（`/bin/zsh -lc '…'` 子 shell 封装），但**路径改写到测试 projectRoot 之下**——
   * 样本里的路径在探针临时目录 `/tmp/codex-probe-…` 下（项目外），逐字重放过不了
   * `checkEvidence` 的 `isUnder(project_root)` 过滤，任何「证据达标」的断言都不可达。
   * r1 裁决的措辞是「以真实录制样本为**蓝本**」，蓝本允许改写路径套形态，
   * 不是字面重放（r3 裁决 GLM-01(b)）。
   *
   * **新增注入形态而非改 `baseResult`**：`read:6` 被全部既有模式共享，
   * 全局替换会把 selftest 与故障注入的绿路径一并改形，与「既有判定逐项不变」冲突。
   * 与 `peer_leak` / `peer_leak_via_command` 分列同理——每条形状要能单独触发。
   */
  | 'command_trace'
  /**
   * **一直挂着**，直到进程被杀（`review --cancel`）；兜底 10 分钟后按超时返回。
   *
   * 取消类用例要的是「worker 确实还在跑」：`timeout` 模式会立刻返回，worker 转眼就自己收尾，
   * 用例能不能赶在它前面 `--cancel` 全凭时序，会抖（EV-128 实施时核出）。
   */
  | 'hang'
  /**
   * 与 `hang` 同为「一直挂着」，但**真实拉起一个子进程**：以仓库的 `run()` 按 `killTree: true`（适配器的写法）
   * 派生 `sh -c 'sleep 600; : "$0"' trivium-stub-cli:<out_dir>`，一直等它结束（EV-152，取消够不到审查员CLI计划 r2 §5.2）。
   *
   * `hang` 在进程内 `setTimeout`，不起子进程，测不出「worker 被取消时够不到它拉起的 CLI」。这里保留 `sh` + `sleep`
   * 两层，让组里有不带标记的成员，用例按组号判「组空」才测得到「按组」；标记带 `out_dir`，用例据此认出本运行的组长。
   * `ignoreTerm` 为真时命令前加 `trap '' TERM;`（`sleep` 继承忽略），模拟不响应 SIGTERM 的 CLI。
   */
  | 'hang_cli'
  /** 进程级失败 */
  | 'fail';

export interface StubSpec {
  mode: StubMode;
  /** `ok` / `no_project_reads` 等模式下要产出的意见数 */
  findings?: number;
  /** 覆盖回读到的生效模型，用于 AC-13 的用例 */
  modelEffective?: string;
  /**
   * 模拟「模型覆盖是否落实」的四态（EV-82，代码双审 r2 AGY-02）：不给 ⇒ 字段缺席（无覆盖尝试），
   * 给 `true` / `false` / `null` ⇒ 原样产出。桩不判定，只让 `review.ts` 的条件展开与 `run.v2` 校验、
   * `guard` 的播报这条链能被集成用例端到端咬住。
   */
  modelOverrideApplied?: boolean | null;
  /**
   * 模拟置首结论（EV-82 第三段 r3 §3.4）：给了就原样产出 `model_override_reorder`。
   * 只为集成用例咬住两件事：guard 按 `kind` 分句；`review.ts` 不把它写进 run.json。
   */
  modelOverrideReorder?: CriticResult['model_override_reorder'];
  /**
   * 模拟落点自检（EV-112 计划 r3 §4.6）：给了就原样产出 `carriers_landed`。只为集成用例咬住两件事：
   * `review.ts` 把它写进 run.json 逐侧段；guard 按两项合取与 `leaked_to_home` 出声。
   */
  carriersLanded?: CriticResult['carriers_landed'];
  /**
   * 模拟「没做覆盖而实际模型不同」（EV-122）：给了就原样产出 `model_unenforced`。只为集成用例咬住两件事：
   * `review.ts` 把它写进 run.json 逐侧段；guard 按 `cause` 出声。
   */
  modelUnenforced?: CriticResult['model_unenforced'];
  /**
   * 模拟「该侧靠副本做模型覆盖」（EV-123）：给了就实现 `modelOverrideSource`，返回这个路径。
   * 只为集成用例咬住 `review --start` 的副本源复查：`--start` 路径上唯一的注入通道是本环境变量。
   */
  modelOverrideSource?: string;
  /** `hang_cli` 模式下让子进程忽略 SIGTERM（EV-152） */
  ignoreTerm?: boolean;
  note?: string;
}

export type StubConfig = Partial<Record<CriticId, StubSpec>>;

/** 从环境变量读注入配置。解析失败即视为未注入——绝不因它出错而影响生产路径 */
export function readStubConfig(env: NodeJS.ProcessEnv = process.env): StubConfig | null {
  const raw = env[STUB_ENV_VAR];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StubConfig;
    if (typeof parsed !== 'object' || parsed === null) return null;
    return parsed;
  } catch {
    warn(`${STUB_ENV_VAR} 不是合法 JSON，已忽略`);
    return null;
  }
}

/** 序列化，供测试设置环境变量 */
export const encodeStubConfig = (c: StubConfig): string => JSON.stringify(c);

function sampleReview(critic: CriticId, n: number, prefixOverride?: string): string {
  /*
   * 前缀取自注册表，不用三目兜底（与 A-1 同一形态）。
   *
   * 桩适配器是 AC-N5a「新增 critic 后核心流程零改动」的验收夹具——
   * 它自己写死两家的话，接第三家时桩会产出错误前缀的意见，
   * 夹具本身就成了泛化的绊脚石。这一处是 `registry-parity` 的
   * grep 对账抓出来的，两侧计划审查与我的原稿都漏了它。
   */
  const prefix = prefixOverride ?? agentById(critic)?.findingPrefix ?? critic.toUpperCase();
  const findings = Array.from({ length: n }, (_, i) => ({
    id: `${prefix}-${String(i + 1).padStart(2, '0')}`,
    severity: i === 0 ? 'blocker' : 'minor',
    layer: 'plan',
    kind: 'correctness',
    location: `src/stub.ts:${10 + i}`,
    problem: `桩注入的第 ${i + 1} 条问题`,
    evidence: '读了 src/stub.ts',
    suggestion: '这是桩数据，不代表真实审查结论',
    confidence: 'high',
  }));
  return JSON.stringify({
    schema: 'trivium.review.v1',
    verdict: n > 0 ? 'request-changes' : 'approve',
    summary: '桩适配器产出的结论，仅用于故障注入测试。',
    findings,
    agreed: [],
    not_covered: ['这是桩数据'],
    consulted: ['src/stub.ts'],
  });
}

function baseResult(critic: CriticId, req: CriticRequest, spec: StubSpec): CriticResult {
  const n = spec.findings ?? 1;
  return {
    critic,
    status: 'ok',
    exit_code: 0,
    duration_s: 1,
    raw_stdout_path: `${req.out_dir}/stub-stdout.json`,
    trace_path: `${req.out_dir}/stub-trace.json`,
    review_json: null,
    raw_response_text: sampleReview(critic, n),
    model_effective: spec.modelEffective ?? req.model,
    model_effective_source: 'envelope',
    // 与真适配器同一条口径：不给就**缺席**，不写 null（缺席与 null 是两件事）
    ...(spec.modelOverrideApplied === undefined ? {} : { model_override_applied: spec.modelOverrideApplied }),
    ...(spec.modelOverrideReorder === undefined ? {} : { model_override_reorder: spec.modelOverrideReorder }),
    ...(spec.carriersLanded === undefined ? {} : { carriers_landed: spec.carriersLanded }),
    ...(spec.modelUnenforced === undefined ? {} : { model_unenforced: spec.modelUnenforced }),
    // 桩不模拟厂商事实：这两个字段的真实形态只有真适配器才产得出（AC-24 的证明边界）
    model_provider: null,
    profile_requested: null,
    tool_calls: { read: 6, grep: 2, glob: 1, run_command: 0 },
    // 桩不产真实工具输出：搜索命中这种事实不存在，null（与 model_provider 同款）
    search_hit_paths: null,
    // 4 条项目内读取：min_project_reads 默认下限是 3，留一点余量
    read_paths: [
      `${req.project_root}/src/a.ts`,
      `${req.project_root}/src/b.ts`,
      `${req.project_root}/src/c.ts`,
      `${req.project_root}/README.md`,
    ],
    /*
     * 路径提取覆盖率（设计 10.1.1 第②层）：**四条读取全都提出了路径**。
     *
     * 桩模拟的是「结构化轨迹族的正常形态」，而真适配器两家现在都报这两个计数；
     * 不报的话，桩侧会落到「该侧没报数 → unavailable」那一支——
     * 那一支留给旧留痕，拿它当结构化轨迹侧的常态会让端到端用例测在别的分支上。
     *
     * 要模拟**提取器退化**（`partial` 档）时把 `with_path` 调小即可，
     * 目前没有哪条用例需要，故不另设 `StubMode`。
     */
    path_bearing_reads: 4,
    path_bearing_reads_with_path: 4,
    write_events: [],
    command_texts: [],
    evidence_ok: false, // 由 guard 判定
    fail_reason: null,
    session_id: 'stub-session',
    cli_version: 'stub/0.0.0',
    peer_deny_applied: false,
    /*
    * 该侧不注入 `--settings`（无路径级 deny 机制），**恒为 0 且这是能说明理由的零**：
    * 含义是「没有这种概念」，不是「注入了但一条都没跳过」。
    */
    deny_skipped: 0,
    deny_rule_count: 0,
    deny_bytes: 0,
    command_line: `<stub ${critic} mode=${spec.mode}>`,
  };
}

/** 造一个按 spec 行事的桩适配器 */
export function makeStubAdapter(critic: CriticId, spec: StubSpec): CriticAdapter {
  return {
    critic,
    /*
     * 桩的能力**随注入形态变化**，这与「capability 是该侧固有能力」不矛盾：
     * 桩适配器是一个**可配置的「侧」**——每次 `makeStubAdapter` 构造出的是一个
     * 不同的侧，不是同一侧两次运行报出不同能力（后者才是挂 `CriticResult` 的毛病）。
     *
     * 这正是能力挂适配器而非注册表的价值：`criticEnabled=false` 锁死 codex 时，
     * `command-trace` 形态仍然可以在集成测试里被真实走到。
     */
    capability:
      spec.mode === 'command_trace'
        ? { traceShape: 'command-trace', rejectionRecorded: false }
        : TOOL_TRACE_CAPABILITY,
    availability: () => ({ ok: true }),
    ...(spec.modelOverrideSource !== undefined
      ? { modelOverrideSource: () => spec.modelOverrideSource as string }
      : {}),
    async run(_ctx: AdapterContext, req: CriticRequest): Promise<CriticResult> {
      switch (spec.mode) {
        case 'hang':
          await new Promise((r) => setTimeout(r, 600_000));
          return failedResult(critic, {
            status: 'timeout',
            reason: '桩挂起 600s 未被取消',
            durationS: 600,
          });
        case 'hang_cli': {
          // 标记走 `$0`（sh -c 的第一个位置参数），进 argv、不经 shell 解析路径
          const body = `${spec.ignoreTerm ? "trap '' TERM; " : ''}sleep 600; : "$0"`;
          const r = await run('/bin/sh', ['-c', body, `trivium-stub-cli:${req.out_dir}`], {
            killTree: true,
            timeoutMs: 610_000,
          });
          return failedResult(critic, {
            status: 'timeout',
            reason: `桩 CLI 挂起未被取消（code=${r.code} signal=${r.signal}）`,
            durationS: Math.round(r.durationMs / 1000),
          });
        }
        case 'timeout':
          return failedResult(critic, {
            status: 'timeout',
            reason: `桩注入超时（${req.timeout_s}s）`,
            durationS: req.timeout_s,
          });
        case 'fail':
          return failedResult(critic, {
            status: 'failed',
            reason: spec.note ?? '桩注入的进程级失败',
            exitCode: 1,
          });
        case 'dirty_output':
          return {
            ...baseResult(critic, req, spec),
            raw_response_text: '我觉得这个计划挺好的，没什么大问题。（桩注入的非结构化输出）',
          };
        case 'no_tools':
          return {
            ...baseResult(critic, req, spec),
            tool_calls: {},
            read_paths: [],
          };
        case 'no_project_reads':
          return {
            ...baseResult(critic, req, spec),
            // 工具调用数达标，但读的全是送审材料自己
            tool_calls: { read: 10 },
            read_paths: [req.subject_path, req.brief_path],
          };
        case 'write_breach':
          return {
            ...baseResult(critic, req, spec),
            write_events: [`write_to_file(${req.project_root}/src/injected.ts)`],
          };
        case 'peer_leak': {
          /*
           * **`note` 给了就只读拼写里含该子串的条目**，缺省读全部。
           *
           * 修好下面那个路径拼接之后，「读全部」意味着**必定**读到运行根——
           * 而运行根整棵是对端输出那一档，于是任何用 `peer_leak` 的用例都作废，
           * 分档里其余三类再也测不到。这不是判定错了（读运行根该作废），
           * 是夹具把五类混成了一次注入：要测「读凭据不作废」，
           * 注入就得只做「读凭据」这一件事（r2 CODEX-02 的落地说明）。
           *
           * 筛空即失败，不静默放过：筛选条件写错时，这条用例会读到 0 个禁读条目、
           * 然后以「没命中」为由绿着通过——那正是本主题一路在修的形态。
           */
          const targets = spec.note
            ? req.deny_paths.filter((p) => p.includes(spec.note!))
            : req.deny_paths;
          if (targets.length === 0) {
            return failedResult(critic, {
              status: 'failed',
              reason: `桩的 peer_leak 筛选 note=${JSON.stringify(spec.note)} 没匹配到任何禁读条目`,
              exitCode: 1,
            });
          }
          return {
            ...baseResult(critic, req, spec),
            read_paths: [
              ...baseResult(critic, req, spec).read_paths,
              /*
               * **绝对路径直接用，只有相对路径才拼前缀**（r2 AGY-07 ≡ CODEX-02）。
               *
               * 禁读集里混着两种形态：归档内的条目是项目相对路径，而运行根是
               * **绝对路径**。初版一律拼 `${project_root}/${p}`，于是运行根被拼成
               * `/proj//var/…`、归一化成 `/proj/var/…`——**与真实运行根永远匹配不上**。
               *
               * 后果不是「少测一条」，而是**整条端到端用例是空的**：
               * 它声称覆盖「读到禁读清单内的文件」，而其中最要紧的那棵树（运行根）
               * 的命中从未发生过。上一轮我拿这条用例当「分档真正生效」的证据写进裁决件，
               * 而它证明不了任何事。
               */
              ...targets.map((p) => (path.isAbsolute(p) ? p : path.join(req.project_root, p))),
            ],
          };
        }
        case 'run_material_leak': {
          /*
           * 运行根这棵**混合树**的两侧（设计 §10.1.1 的 ②′ 与 ②）。
           *
           * 与 `peer_leak` 分列的理由同前：这两条路径都在**同一个** deny 条目
           * （整棵运行根）之下，靠筛条目分不开——要分开只能给出具体的叶子路径。
           * 而这正是分档的要害所在：同一棵树、两个子目录、两种处置。
           *
           * `out_dir` 是 `<运行根>/<项目槽>/<runId>/<本侧>/out`（`review.ts` 的
           * `path.join(runDirBase, critic, 'out')`），所以运行目录那一层——
           * 编排器的 `request.json` 一类写在那儿——要**退两级**。
           * 起草时只退了一级，于是「对端」路径落进了自己那棵子树、被己方材料放行，
           * 用例当场红：夹具把两个子树指到了同一处，而这两条用例的全部意义
           * 就是它们分属不同子树。
           */
          const runDir = path.dirname(path.dirname(req.out_dir));
          const peer = CRITICS.find((c) => c !== critic) ?? critic;
          const which = spec.note ?? 'own';
          const extra =
            which === 'peer'
              ? [path.join(runDir, peer, 'out', 'result.json')]
              : [path.join(req.out_dir, 'result.json'), path.join(runDir, 'request.json')];
          return {
            ...baseResult(critic, req, spec),
            read_paths: [...baseResult(critic, req, spec).read_paths, ...extra],
          };
        }
        case 'peer_leak_via_command':
          /*
           * 措施 b 的故障注入（§10.1 / EV-01）：**只**经命令通道泄漏。
           *
           * 与 `peer_leak` 分成两个形态，而不是给它加个参数——这两条通道
           * 要能各自单独触发。合成一个的话，「措施 a 挂了但 b 还在」这种
           * 单边失效**测不出来**：两条通道同时注入时，只要有一条活着就全绿。
           *
           * 走 `git show HEAD:<path>` 形态（F-3）：这条正是措施 a 看不见的那种——
           * 经 git 对象库取值不产生文件系统读取，`read_paths` 里什么都没有。
           */
          /*
           * `note: 'own-run'` 时改发一条**提到己方运行材料具体路径**的命令。
           *
           * 这条形态是命令通道与路径通道「同一个谓词」的检验点：分类喂的若是
           * **条目**（整棵运行根），它必然落到对端输出那一档、该侧作废；
           * 喂的是**命令里那个路径**，才认得出它属己方材料。
           * 两条通道对同一次泄漏给出相反结论，正是 r2 阻断一的形态。
           */
          if (spec.note === 'own-run') {
            return {
              ...baseResult(critic, req, spec),
              tool_calls: { ...baseResult(critic, req, spec).tool_calls, run_command: 1 },
              read_paths: [],
              command_texts: [`cat ${path.join(req.out_dir, 'result.json')}`],
            };
          }
          return {
            ...baseResult(critic, req, spec),
            tool_calls: { ...baseResult(critic, req, spec).tool_calls, run_command: 1 },
            command_texts: req.deny_paths.map((p) => `git show HEAD:${p}`),
          };
        case 'command_trace': {
          /*
           * 借样本的命令形态、把路径改写到测试 projectRoot 之下（见 StubMode 的说明）。
           *
           * 七条命令逐条对应提取器的一组口径（**行尾注释标明是哪一组**），
           * 条数也足以过 `min_tool_calls`（默认 5）。
           * 断言在 `test/integration/command-trace.test.ts`——
           * 上一版这里写着覆盖「写目标位、逃逸相对」而命令清单里两样都没有，
           * 正因为没有任何断言咬住它，清单写错了也不会红（r6 双审 GLM-07 ≡ AGY-04）。
           *
           * `read_paths` 恒空是本形态的**要害**——判定层拿不到结构化路径，
           * 全靠 `command_texts` 回填，泛化是否真的成立就看这一条。
           */
          const cmds = [
            `/bin/zsh -lc 'head -n 1 ${req.project_root}/src/a.ts'`, // 子 shell + 绝对
            `/bin/zsh -lc 'cat src/b.ts'`, //                          子 shell + 裸相对
            `sed -n '1,40p' ${req.project_root}/src/c.ts`, //           sed 脚本参数排除
            `git show HEAD:README.md`, //                              git 对象语法
            `grep -rn foo src/d.ts 2>/dev/null`, //                     fd 前缀重定向排除
            `cp src/e.ts ${req.project_root}/tmp/e.bak`, //             写动词目标位排除
            `cat ../Other/outside.ts`, //                              逃逸相对（项目外，过滤掉）
          ];
          return {
            ...baseResult(critic, req, spec),
            // 读即命令：没有专用读工具，三类结构化计数恒 0
            tool_calls: { read: 0, grep: 0, glob: 0, run_command: cmds.length },
            read_paths: [],
            command_texts: cmds,
          };
        }
        case 'mutate_file': {
          const { promises: fsp } = await import('node:fs');
          const nodePath = await import('node:path');
          const target = nodePath.join(req.project_root, spec.note ?? 'src/mutated-by-stub.ts');
          await fsp.mkdir(nodePath.dirname(target), { recursive: true });
          await fsp.appendFile(target, `// mutated during review by stub ${critic}\n`, 'utf8');
          return baseResult(critic, req, spec);
        }
        case 'wrong_prefix': {
          /*
           * 缺省冒用「另一侧」的前缀：那是最危险的形态——未登记前缀会在闸门处
           * 以「缺裁决」现形（虽然报错指向错误原因），而冒名前缀会被 gate 的
           * Set 去重与对侧合并，裁决一次即过闸，**静默**碰撞。
           *
           * **排除当轮 Driver**（M9 第 4 步，代码双审 CODEX-08）：`CRITICS` 的顺序
           * 即注册表顺序，claude 打头。翻开关后 `others[0]` 由 codex 变成 claude，
           * 于是注入的是**当轮 Driver 的前缀**——而 Driver 根本不会作为审查侧出现，
           * 「冒用真正在场的对侧」这个故障就不再被模拟了。用例只断言
           * `status === 'parse_fallback'` 与前缀归属报错，所以这次退化**不会红**：
           * 属于「故障注入夹具不再注入它声称的那个故障」。
           *
           * **边界**：跨侧编号碰撞（冒名前缀被 gate 合并、裁决一次即过闸）这一层
           * 当前**没有机器判据**——上面那段描述的是设计意图，不是被断言守着的行为。
           */
          const others = CRITICS.filter((c) => c !== critic && c !== DEFAULT_DRIVER);
          const fallbackPrefix = others[0] ? (agentById(others[0])?.findingPrefix ?? 'OTHER') : 'OTHER';
          return {
            ...baseResult(critic, req, spec),
            raw_response_text: sampleReview(critic, spec.findings ?? 1, spec.note ?? fallbackPrefix),
          };
        }
        case 'ok':
        default:
          return baseResult(critic, req, spec);
      }
    },
  };
}

/**
 * 适配器工厂：**唯一**决定用真实适配器还是桩的地方。
 *
 * 所有拉起审查的路径（同步 `review`、worker 的 `rebuildContext`）都必须经这里，
 * 否则跨进程注入就会漏掉那条路径。
 */
export function resolveAdapters(
  real: AdapterTable,
  env: NodeJS.ProcessEnv = process.env,
): AdapterTable {
  const stub = readStubConfig(env);
  if (!stub) return real;

  warn(
    `⚠️ 检测到 ${STUB_ENV_VAR}：正在使用**桩适配器**，产出的不是真实审查结论。\n` +
      `  注入配置：${JSON.stringify(stub)}\n` +
      '  这只应出现在测试里。若这是真实审查，请立即清除该环境变量并重跑。',
  );

  const out = { ...real };
  for (const critic of Object.keys(stub) as CriticId[]) {
    const spec = stub[critic];
    if (spec) out[critic] = makeStubAdapter(critic, spec);
  }
  return out;
}
