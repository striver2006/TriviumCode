/**
 * `guard`：只读失守、漂移、对方产出泄漏、Agent 证据下限的判定（设计 §10.3 / §11.4 / §9.2）。
 *
 * guard 只**判定**，不做中止决策——中止交给 `gate` 与失败策略。
 * 这样「检出」与「处置」分开，处置策略可配而检出逻辑恒定。
 */
import type { Config, CriticId, CriticRequest, CriticResult, Review } from './types.js';
import { checkEvidence, checkPeerLeak } from './adapters/base.js';
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
  /** 轨迹读取路径命中禁读清单 */
  peerArtifactRead: boolean;
  peerHits: string[];
  /** consulted 与轨迹交叉核对未通过 */
  consultedUnverified: boolean;
  /** 结构性问题（编号前缀错、重复编号等） */
  integrityIssues: string[];
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
  opts: { archiveRootAbs: string; projectRoot: string },
): SideVerdict {
  const ev = checkEvidence(result, req, { archiveRootAbs: opts.archiveRootAbs });
  const peer = checkPeerLeak(result.read_paths, req.deny_paths, opts.projectRoot);

  // 轨迹里出现写工具/写命令 = 审查员失守（§10.3 末段：轨迹有写事件的判为失守）
  const readonlyBreach = result.write_events.length > 0;

  // consulted 与轨迹交叉核对
  let consultedUnverified = false;
  const consulted = review?.consulted ?? [];
  if (consulted.length > 0) {
    const traceSet = new Set(
      result.read_paths.map((p) =>
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
    peerArtifactRead: peer.leaked,
    peerHits: peer.hits,
    consultedUnverified,
    integrityIssues,
  };
}

export interface RunVerdict {
  sides: Partial<Record<CriticId, SideVerdict>>;
  drift: DriftVerdict;
  driftAction: 'ok' | 'warn' | 'fail';
  /** 指纹变化但轨迹无写事件 → 开发者手改，按漂移处置而非失守（§9.2 第 4 步） */
  fingerprintChangedFiles: string[];
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
    sides[c] = judgeSide(cfg, c, r, reviews[c] ?? null, q, {
      archiveRootAbs: input.archiveRootAbs,
      projectRoot: input.projectRoot,
    });
  }

  const breachedFiles = Object.values(sides).flatMap((s) => s?.breachEvidence ?? []);
  const fingerprintChangedFiles =
    drift.kind === 'related' || drift.kind === 'unrelated' ? drift.files : [];

  return {
    sides,
    drift,
    driftAction: driftAction(cfg, drift),
    fingerprintChangedFiles: fingerprintChangedFiles.filter(
      (f) => !matchesAnyGlob(f, scratchGlobs),
    ),
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
      if (s?.peerArtifactRead) {
        out.push(`${s.critic} 侧读到了禁读清单内的文件：${s.peerHits.join(', ')}——该侧结论作废`);
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
  for (const s of Object.values(v.sides)) {
    if (!s) continue;
    if (!s.evidenceOk) out.push(`${s.critic} 侧 Agent 执行证据不足：${s.evidenceReasons.join('；')}`);
    if (s.integrityIssues.length > 0) out.push(`${s.critic} 侧结论结构问题：${s.integrityIssues.join('；')}`);
    if (s.consultedUnverified) out.push(`${s.critic} 侧 consulted 无法与工具轨迹交叉核对`);
  }
  return out;
}
