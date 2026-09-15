/**
 * `guard`：只读失守、漂移、对方产出泄漏、Agent 证据下限的判定（设计 §10.3 / §11.4 / §9.2）。
 *
 * guard 只**判定**，不做中止决策——中止交给 `gate` 与失败策略。
 * 这样「检出」与「处置」分开，处置策略可配而检出逻辑恒定。
 */
import nodePath from 'node:path';
import type { Config, CriticId, CriticRequest, CriticResult, Review,
  SuspectedWrite,
} from './types.js';
import {
  checkEvidence,
  checkPeerLeak,
  checkPeerLeakViaCommand,
  effectiveReadPaths,
  TOOL_TRACE_CAPABILITY,
  type TraceCapability,
} from './adapters/base.js';
import { checkReviewIntegrity } from './parse.js';
import { judgeDrift, driftAction, type DriftVerdict, type Snapshot } from './freeze.js';
import { ALL_CLI_NAMES } from './agents/registry.js';
import { matchesAnyGlob } from './util/fsx.js';

export interface SideVerdict {
  critic: CriticId;
  evidenceOk: boolean;
  evidenceReasons: string[];
  projectReads: number;
  /** 轨迹中出现写事件 → 审查员失守（比指纹变化更确定） */
  readonlyBreach: boolean;
  breachEvidence: string[];
  /** 轨迹读取路径命中禁读清单，**或**命令原文里出现了禁读条目（措施 b） */
  peerArtifactRead: boolean;
  /** 命中的读取路径（措施 a） */
  peerHits: string[];
  /**
   * 命中的**命令原文**（措施 b，§10.1）。
   *
   * 与 `peerHits` 分开记而不是并进同一个数组：两者的性质不同——
   * 路径命中说明它**读了**那个文件，命令命中说明它**跑了**一条提到那个文件的命令
   * （可能经 git 对象库，文件系统上根本没发生读取）。处置相同，但排查时
   * 要看得出是哪条通道，否则「为什么 deny 生效了还漏」永远查不清。
   */
  peerCommandHits: string[];
  /** consulted 与轨迹交叉核对未通过 */
  consultedUnverified: boolean;
  /** 结构性问题（编号前缀错、重复编号等） */
  integrityIssues: string[];
  /**
   * **疑似**写入：命中写形态但判不实的命令（M8 第 3 步，r9 双审 GLM-05 接线）。
   *
   * 不参与 `readonlyBreach`——它是排查线索，不是判决。
   * 之所以要让它出现在判定结果里而不是只躺在 `trace.json`：
   * 契约注释承诺了「进 doctor 输出」，而**宣称了不存在的消费方**正是
   * EV-06 记的那个形态。要么让宣称成真，要么把宣称改小；这里选前者，
   * 因为这一档的价值恰恰就在「人读排查有入口」。
   */
  suspectedWrites: SuspectedWrite[];
  /**
   * 该侧两条核验通道的可用档位（§11.1，M8 第 2 步）。
   *
   * **三态不得塌缩**：`readonlyBreach: false` 与 `peerHits: []` 各有两个来源——
   * 「核验过、没命中」与「根本没法核验」。这两个档位就是把它们分开。
   * 不记的话，`command-trace` 侧的空数组与「扫过没命中」在留痕里**完全同形**。
   */
  verification: SideVerification;
}

/** 单侧两条核验通道的档位与生效阈值 */
export interface SideVerification {
  /**
   * 「尝试写」检测是否可用。`unavailable` ⟺ `rejectionRecorded === false`。
   *
   * **记的是能力恒态，与本次是否检出写事件无关**（r3 裁决 GLM-06）。
   * 真阳性由 `readonlyBreach` 表达，两者正交：档位为 `unavailable` 的侧
   * 一样可能 `readonlyBreach === true`（写命令成功执行、照常留痕）。
   * 本档位只修饰**阴性结论**的可信度——「没检出写事件」在该侧不足以排除失守。
   */
  readonly: 'ok' | 'unavailable';
  /**
   * 措施 a（读取路径比对 deny）是否有结构化输入可扫。
   * `unavailable` ⟺ `traceShape === 'command-trace'`——该族 `read_paths` 恒空，
   * deny 核验只剩措施 b 一条通道（已知形态必检，非完备，R25）。
   */
  path: 'ok' | 'unavailable';
  /** 本次生效的项目读取下限（`command-trace` 族折减后的值） */
  evidenceThreshold: number;
}

/**
 * 单侧判定。
 *
 * `consulted` 交叉核对的阈值是 80%（§11.4）：允许少量路径写法差异，
 * 但大面积对不上就说明是编造的。
 */
export function judgeSide(
  cfg: Config,
  critic: CriticId,
  result: CriticResult,
  review: Review | null,
  req: CriticRequest,
  opts: { archiveRootAbs: string; projectRoot: string; capability?: TraceCapability },
): SideVerdict {
  /*
   * 未传能力声明时按结构化轨迹处理——那是本步之前的唯一形态，行为逐字等价。
   * 这**不是**「默认放行」：`command-trace` 的侧由适配器显式声明，
   * 漏传会让该侧按 tool-trace 判（证据恒不达标），响亮失败而非静默放行。
   */
  const cap = opts.capability ?? TOOL_TRACE_CAPABILITY;

  const ev = checkEvidence(result, req, { archiveRootAbs: opts.archiveRootAbs, capability: cap });

  /*
   * 措施 a **只吃 `read_paths`，不吃回填**（r2/r3 双审两侧均确认）：
   * 回填路径的语义是「跑了一条提到该文件的命令」，不等于「读到了该文件」。
   * 命令通道由下面的措施 b 承担，两条分列才看得出泄漏走的是哪条。
   */
  const peer = checkPeerLeak(result.read_paths, req.deny_paths, opts.projectRoot);
  /*
   * 措施 b（§10.1 / EV-01）：命令原文的字面扫描。
   *
   * 与措施 a **同等处置**——两者任一命中即该侧作废。不设权重也不设开关：
   * **§18.1 #21** 的默认值就是不提供 `hard|warn|off` 开关，理由是**开关会引入
   * 「绕过检测」的合法路径**——这条理由独立成立，是拒绝开关的全部依据。
   *
   * > 初版这里写的是「§18.1 **#8**」（那是闸门期写锁的作用域，引错了），
   * > 并接了一句「确需收窄 git 通道时裁 `readonly_commands` 已是更强的旋钮」——
   * > 而**同一个补丁**刚以「拿一个不存在、且已决定不用的机制当拒绝理由，
   * > 是把论证建在空处」为由把那句话从 §18.1 #21 删掉。一面删、一面写进新注释。
   * > 该旋钮无消费方（BACKLOG **EV-15**），且已拍板不收窄（**EV-16**）。
   */
  const peerCmd = checkPeerLeakViaCommand(result.command_texts, req.deny_paths, opts.projectRoot);

  /*
   * 轨迹里出现写事件 = 审查员失守（§10.3 末段）。
   *
   * **两档一律成立，与 `rejectionRecorded` 无关。** M6 的 P-C2 只断言
   * 「被沙箱拒绝的命令不产生事件」；成功执行的命令照常留痕（P-C1 的样本本身
   * 就是 `status:"completed"`、`exit_code:0` 的 `command_execution`）。
   * 所以沙箱一旦失守、写命令真的跑成了，那是**正向确凿证据**，必须判失守——
   * 把它压成 false 会让失守信号凭空消失，还会让下面的漂移判定把审查员的写入
   * 归因成开发者手改（方向正好反）。
   *
   * `rejectionRecorded === false` 影响的只有**阴性结论**：没检出写事件时，
   * 不足以排除「尝试过写但被拒、没留痕」，该侧只读保障从三重降到两重。
   * 这一层由 `verification.readonly` 档位表达，不动本判定。
   */
  const readonlyBreach = result.write_events.length > 0;

  // consulted 与轨迹交叉核对——吃回填后的有效路径，否则 command-trace 侧每轮误报
  let consultedUnverified = false;
  const consulted = review?.consulted ?? [];
  if (consulted.length > 0) {
    const traceSet = new Set(
      effectiveReadPaths(result, cap, opts.projectRoot).map((p) =>
        p.startsWith(opts.projectRoot) ? p.slice(opts.projectRoot.length).replace(/^\/+/, '') : p,
      ),
    );
    const matched = consulted.filter((c) => traceSet.has(c) || traceSet.has(`./${c}`)).length;
    consultedUnverified = matched / consulted.length < 0.8;
  } else if (review !== null) {
    // 结构化成功但没填 consulted，无法核对
    consultedUnverified = true;
  }

  const integrityIssues: string[] = [];
  if (review) {
    const i = checkReviewIntegrity(review, critic);
    if (!i.prefixOk) integrityIssues.push(`编号前缀不属于本侧：${i.badIds.join(', ')}`);
    if (i.duplicateIds.length > 0) integrityIssues.push(`编号重复：${i.duplicateIds.join(', ')}`);
    if (i.evidenceNotInConsulted.length > 0) {
      integrityIssues.push(`evidence 引用但未列入 consulted：${i.evidenceNotInConsulted.join(', ')}`);
    }
    if (i.emptyWithoutExplanation) integrityIssues.push('零意见但未说明检查了什么');
  }

  void cfg;
  return {
    critic,
    evidenceOk: ev.ok,
    evidenceReasons: ev.reasons,
    projectReads: ev.projectReads,
    readonlyBreach,
    breachEvidence: result.write_events,
    peerArtifactRead: peer.leaked || peerCmd.leaked,
    peerHits: peer.hits,
    peerCommandHits: peerCmd.hits,
    consultedUnverified,
    integrityIssues,
    suspectedWrites: [...(result.suspected_write_events ?? [])],
    verification: {
      readonly: cap.rejectionRecorded ? 'ok' : 'unavailable',
      path: cap.traceShape === 'command-trace' ? 'unavailable' : 'ok',
      evidenceThreshold: ev.minProjectReads,
    },
  };
}

export interface RunVerdict {
  sides: Partial<Record<CriticId, SideVerdict>>;
  drift: DriftVerdict;
  driftAction: 'ok' | 'warn' | 'fail';
  /**
   * 指纹变化但轨迹无写事件 → 开发者手改，按漂移处置而非失守（§9.2 第 4 步）。
   *
   * **这个归因只对 `verification.readonly === 'ok'` 的侧成立。** 前提是
   * 「轨迹无写事件」能证明「审查员没写」——而对 `rejectionRecorded=false` 的侧，
   * 无写事件**不能**排除审查员写过（被拒的不留痕）。那种情形下文件落进
   * `unattributedDriftFiles`，不得记到开发者头上。
   */
  fingerprintChangedFiles: string[];
  /**
   * 指纹变化、但本轮有侧的只读核验不可用 ⇒ **无法归因**（§11.1，M8 第 2 步）。
   *
   * 既不判审查员失守（没有正向证据），也不判开发者手改（阴性证据不可信）。
   * 单列而不是并进 `fingerprintChangedFiles`：后者是一个**已归因**的结论，
   * 把不可归因的混进去，等于用一个更强的断言掩盖证据的缺口。
   */
  unattributedDriftFiles: string[];
  readonlyBreach: boolean;
  breachedFiles: string[];
  peerArtifactRead: boolean;
}

export interface JudgeRunInput {
  cfg: Config;
  projectRoot: string;
  archiveRootAbs: string;
  /** 归档根的项目相对路径，漂移判定要整体排除它 */
  archiveRootRel: string;
  /** `.trivium/` 的项目相对路径，同样排除；缺省 `.trivium` */
  triviumDirRel?: string;
  before: Snapshot;
  afterTreeHash: string;
  afterSubjectSha256: string;
  relatedPaths: string[];
  results: Partial<Record<CriticId, CriticResult>>;
  reviews: Partial<Record<CriticId, Review | null>>;
  requests: Partial<Record<CriticId, CriticRequest>>;
  /**
   * 逐侧的轨迹能力声明，取自适配器表（`ctx.adapters[critic].capability`）。
   *
   * **必须由调用方透传**：能力的唯一起源是适配器，`judgeRun` 自己取不到。
   * 缺某一侧时该侧按 `tool-trace` 判——对结构化轨迹两家是正确默认，
   * 对 `command-trace` 侧则会因证据恒不达标而响亮失败，不会静默放行。
   */
  capabilities?: Partial<Record<CriticId, TraceCapability>>;
}

/** 整次运行的判定 */
export async function judgeRun(input: JudgeRunInput): Promise<RunVerdict> {
  const { cfg, results, reviews, requests } = input;

  /*
   * 全部已探 CLI 的 scratch 白名单并集：这一步不能省，否则会把 Agent 自己的
   * 会话缓存误判成「只读失守」（M0 实测本机两侧均为空，但别的机器上未必）。
   *
   * 遍历而不是写死两段（原文是 `[...cfg.probe.agy.scratch_paths, ...cfg.probe.zcode.scratch_paths]`）：
   * 探针段 Partial 化之后那种写法在 `noUncheckedIndexedAccess` 下直接编译不过，
   * 而若图省事强转，缺段时会变成运行期 TypeError——这是 guard 这条只读护栏的路径，
   * 不能靠强转糊过去（审查意见 AGY-03）。取并集也天然对第三家成立。
   *
   * 按 `ALL_CLI_NAMES` 取键，**不按盘上实有键**（审查意见 GLM-08）：
   * `Object.values(cfg.probe.cli)` 会把未登记的键也算进来，于是一个没人登记的段
   * 能往只读失守的白名单里塞 glob——而 `preflight` / `doctor` 都按注册表遍历、
   * 根本看不见它。`schemas.ts` 已补了「probe.cli 键 ⊆ 已登记 CLI」的校验把关，
   * 这里同口径是第二道：即使有人直接改盘绕过校验，影响面也不会扩大。
   */
  const scratchGlobs = ALL_CLI_NAMES.flatMap((n) => cfg.probe.cli[n]?.scratch_paths ?? []);

  const drift = await judgeDrift({
    cfg,
    projectRoot: input.projectRoot,
    before: input.before,
    afterTreeHash: input.afterTreeHash,
    afterSubjectSha256: input.afterSubjectSha256,
    relatedPaths: input.relatedPaths,
    scratchGlobs,
    archiveRootRel: input.archiveRootRel,
    ...(input.triviumDirRel ? { triviumDirRel: input.triviumDirRel } : {}),
  });

  const sides: Partial<Record<CriticId, SideVerdict>> = {};
  for (const c of Object.keys(results) as CriticId[]) {
    const r = results[c];
    const q = requests[c];
    if (!r || !q) continue;
    /*
     * 已经失败或超时的一侧不再评判证据。
     *
     * 一个超时被 SIGTERM 掉的进程当然「零工具调用、零项目文件读取」——
     * 再报一遍「证据不足」只会把真正的原因（超时）埋在噪音里。
     * 真实运行中就出现过这种误导：glm 侧 900s 超时，人读输出却说它证据不足。
     * 失败原因由 runner 的 fail_reason 与 decideMode 的 degraded_reason 负责。
     */
    if (r.status === 'timeout' || r.status === 'failed') continue;
    const cap = input.capabilities?.[c];
    sides[c] = judgeSide(cfg, c, r, reviews[c] ?? null, q, {
      archiveRootAbs: input.archiveRootAbs,
      projectRoot: input.projectRoot,
      ...(cap ? { capability: cap } : {}),
    });
  }

  const breachedFiles = Object.values(sides).flatMap((s) => s?.breachEvidence ?? []);
  const fingerprintChangedFiles =
    drift.kind === 'related' || drift.kind === 'unrelated' ? drift.files : [];
  const changed = fingerprintChangedFiles.filter((f) => !matchesAnyGlob(f, scratchGlobs));

  /*
   * 归因分流（§9.2 第 4 步 + §11.1）。
   *
   * 「指纹变了但轨迹无写事件 ⇒ 开发者手改」这条推理的前提是**轨迹能证明审查员没写**。
   * 对 `readonly: 'unavailable'` 的侧（`rejectionRecorded=false`）这个前提不成立：
   * 被拒的写不留痕，无写事件排除不了审查员写过。只要本轮有任一侧处于该档位，
   * 变更文件就落进 `unattributedDriftFiles` 而不是被记成开发者手改——
   * 否则审查员的失守会被安到开发者头上，方向正好反。
   *
   * 取「任一侧」而不是逐侧分配：指纹是**整个工作树**的快照，看不出是哪一侧改的。
   * 有一侧不可归因，这批文件的归因就不可靠。
   *
   * **判据取 `input.capabilities` 而不是 `sides`**（r6 双审 AGY-02）：
   * `sides` 只含成功侧——超时/失败的一侧在上面的循环里被 `continue` 跳过。
   * 而能力是**静态声明**，与该侧这次跑没跑成无关。按 `sides` 算会有一个很坏的性质：
   * **不可用侧崩得越彻底，归因越「自信」**——它一超时就不进 `sides`，
   * `anyReadonlyUnavailable` 变 false，于是漂移被记成开发者手改。
   */
  const anyReadonlyUnavailable = Object.values(input.capabilities ?? {}).some(
    (c) => c?.rejectionRecorded === false,
  );

  /*
   * 已确诊失守的文件不进「无法归因」桶：那批有**正向证据**，
   * 与「既无正向证据也不能排除」的语义相反。不扣除的话，
   * 运行时会同屏打出「只读失守：轨迹中出现了写事件」与「无法归因：无正向证据」两条。
   *
   * ## 判据是**路径解析后的相等比对**，不是子串包含
   *
   * 两侧都提过三次才收敛到这里，把失败的路子记下来：
   *
   * - **裸 `includes`**（r6 实现）：`write_to_file(/proj/src/metadata.ts)` 对
   *   `data.ts` 判真——无边界子串，不相干文件被误扣。
   * - **只加左边界 `/${f}`**（r7 实现）：挡住了上一族，但**斜杠对齐的后缀分量**
   *   与**右端开放**两族还在——`/proj/sub/README.md` 对根 `README.md` 判真、
   *   `/proj/src/a.ts.bak` 对 `src/a.ts` 判真（r8 双审 GLM-01 ≡ AGY-03，实测复现）。
   *   r7 应答件写的「这一条就能杀掉尾段子串误扣」**只对无边界族成立**。
   *
   * 所以回到 r6 应答件的原案：**从 `toolName(...)` 形态剥出路径、归一后做相等比对**。
   * 子串匹配无论怎么补边界都是在猜路径的边在哪，而括号里的内容本来就是完整路径。
   *
   * **已知限制（漏扣方向，保守可接受）**：剥不出路径的形态——agy 侧拿不到 `path`
   * 时用 `JSON.stringify(parameters).slice(0, 80)` 填充、被截断的长路径，
   * 以及不带括号的自定义事件串——一律**留在原桶**。
   * 宁可多报一个「无法归因」，也不要把有证据的漂移悄悄归掉。
   */
  const breachedAbs = new Set(
    [...new Set(breachedFiles)].flatMap((ev) => {
      // `toolName(<path>)`：取最后一对括号内的内容，避免路径自身含括号时被切断
      const open = ev.indexOf('(');
      const close = ev.lastIndexOf(')');
      if (open < 0 || close <= open) return [];
      const inner = ev.slice(open + 1, close).trim();
      if (inner.length === 0) return [];
      return [nodePath.resolve(input.projectRoot, inner)];
    }),
  );
  const attributedToBreach = (f: string): boolean =>
    breachedAbs.has(nodePath.resolve(input.projectRoot, f));

  const unattributed = anyReadonlyUnavailable ? changed.filter((f) => !attributedToBreach(f)) : [];

  return {
    sides,
    drift,
    driftAction: driftAction(cfg, drift),
    fingerprintChangedFiles: anyReadonlyUnavailable ? [] : changed,
    unattributedDriftFiles: unattributed,
    readonlyBreach: Object.values(sides).some((s) => s?.readonlyBreach === true),
    breachedFiles: [...new Set(breachedFiles)],
    peerArtifactRead: Object.values(sides).some((s) => s?.peerArtifactRead === true),
  };
}

/** 人读告警文本（命令输出用）。**绝不自动 git checkout 回滚**（§10.3） */
export function renderGuardWarnings(v: RunVerdict): string[] {
  const out: string[] = [];

  if (v.readonlyBreach) {
    out.push(
      '只读失守：审查员的工具轨迹中出现了写事件。受影响的调用：\n' +
        v.breachedFiles.map((f) => `    ${f}`).join('\n') +
        '\n  编排器**不会**自动回滚。建议人工核对：\n' +
        '    git status --porcelain -uall\n' +
        '    git diff\n' +
        '  确认无误后再决定是否 `git checkout --` 相关文件。',
    );
  }

  if (v.peerArtifactRead) {
    for (const s of Object.values(v.sides)) {
      if (!s?.peerArtifactRead) continue;
      /*
       * 两条通道分开播报（措施 a / 措施 b）。
       *
       * 合并成一行会在**只有命令通道命中**时打出「读到了禁读清单内的文件：」后面跟空清单
       * ——处置是对的（该侧照样作废），但人读留痕看起来像个 bug，排查的人会先去
       * 怀疑检测器本身。两条通道的性质本来就不同：路径命中说明它读了那个文件，
       * 命令命中说明它跑了一条提到那个文件的命令（可能经 git 对象库，文件系统上没发生读取）。
       */
      if (s.peerHits.length > 0) {
        out.push(`${s.critic} 侧读到了禁读清单内的文件：${s.peerHits.join(', ')}——该侧结论作废`);
      }
      if (s.peerCommandHits.length > 0) {
        out.push(
          `${s.critic} 侧的命令里出现了禁读清单内的路径：${s.peerCommandHits.join(' ｜ ')}` +
            '——该侧结论作废（措施 b：命令文本通道，可能经 git 对象库取值而不产生文件读取）',
        );
      }
    }
  }
  switch (v.drift.kind) {
    case 'subject_drift':
      out.push('被审对象在审查期间被修改：本次结论已不对应送审的那份内容，整次运行作废');
      break;
    case 'related':
      out.push(
        `与被审范围相关的文件在审查期间被修改（策略 ${v.driftAction}）：\n` +
          v.drift.files.map((f) => `    ${f}`).join('\n'),
      );
      break;
    case 'unrelated':
      out.push(
        `审查期间有无关文件被修改（策略 ${v.driftAction}）：\n` +
          v.drift.files.map((f) => `    ${f}`).join('\n'),
      );
      break;
    case 'none':
      break;
  }
  if (v.unattributedDriftFiles.length > 0) {
    out.push(
      '审查期间有文件变更，但本轮有侧的只读核验不可用，**无法归因**：\n' +
        v.unattributedDriftFiles.map((f) => `    ${f}`).join('\n') +
        '\n  既不能判为审查员失守（无正向证据），也不能判为开发者手改' +
        '（该侧被拒的写不留痕，无写事件排除不了审查员写过）。请人工核对。',
    );
  }

  for (const s of Object.values(v.sides)) {
    if (!s) continue;
    if (!s.evidenceOk) out.push(`${s.critic} 侧 Agent 执行证据不足：${s.evidenceReasons.join('；')}`);
    if (s.integrityIssues.length > 0) out.push(`${s.critic} 侧结论结构问题：${s.integrityIssues.join('；')}`);
    if (s.consultedUnverified) out.push(`${s.critic} 侧 consulted 无法与工具轨迹交叉核对`);

    /*
     * 降级档位的运行时告警——五面留痕的第五面（r1 裁决 §2.4 点名要补的那一面）。
     *
     * 既有的 `peer_deny_applied` 有四面留痕却独缺运行时这一面，新字段不重蹈：
     * 降级如果只落在 run 元数据里，跑的人当场看不见，等到复盘才发现「这一侧
     * 其实没核验过」已经晚了。
     */
    if (s.verification.readonly === 'unavailable') {
      out.push(
        `${s.critic} 侧只读核验不可用：该侧被拒的写操作不进轨迹，` +
          '「未检出写事件」不足以排除失守（只读保障从三重降到两重，指纹比对仍有效）',
      );
    }
    /*
     * 疑似写入的人读出口（r9 双审 GLM-05）。
     *
     * 这一档不判失守，但**必须看得见**：它记的是「命中写形态却判不实」的命令，
     * 恰恰是排查只读问题时最该先看的那几条。只落 `trace.json` 等于埋起来——
     * 而契约注释承诺过它会出现在输出里。
     */
    if (s.suspectedWrites.length > 0) {
      const head = s.suspectedWrites.slice(0, 3).map((w) => `「${w.command}」（${w.why}）`);
      out.push(
        `${s.critic} 侧有 ${s.suspectedWrites.length} 条**疑似写入**（不判失守，仅供排查）：` +
          head.join('；') +
          (s.suspectedWrites.length > head.length ? ` …另 ${s.suspectedWrites.length - head.length} 条见 trace.json` : ''),
      );
    }
    if (s.verification.path === 'unavailable') {
      out.push(
        `${s.critic} 侧路径核验无结构化输入：该侧读取路径只存在于命令文本里，` +
          '措施 a 无通道可扫，deny 核验完全由措施 b 承担（已知形态必检，非完备）',
      );
    }
  }
  return out;
}
