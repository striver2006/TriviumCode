/**
 * 前置链（FR-3，r2 计划 CLAUDE-02 裁决后的次序）。
 *
 * 次序：resolve → preflight →（UI 回显主题、用户确认）→ claim（仅入口 A/B、
 * 确认之后；C/D 不预认领，认领归终端会话的 S4.5/S0.8）。
 *
 * 终端里的入口 skill 会把同一条链再跑一遍：resolve 只读、preflight 可重复、
 * claim 对同一 Driver 幂等（退 0 不改写）——重复开销可忽略，且不产生任何竞态。
 */
import type { TriviumCommands, TopicResolveOutput } from '../cli/commands';
import { explainExitCode } from '../cli/exitCodes';
import { ENTRY_STAGE, ENTRY_CLAIM_STAGE, type EntryKind } from './entryCommand';

export interface PrechainFlags {
  driver: string;
  critics: string[];
  maxRounds?: number;
  topic?: string;
  /** 其余透传旗标（--profile / --model-* 等），已按 CLI 形态组好 */
  extra?: string[];
}

export type PrechainStep =
  | { step: 'resolve'; state: 'ok'; out: TopicResolveOutput }
  | { step: 'resolve'; state: 'failed'; code: number | null; message: string }
  | { step: 'preflight'; state: 'ok'; warnings: { name: string; detail: string }[] }
  | { step: 'preflight'; state: 'failed'; code: number | null; message: string }
  | { step: 'claim'; state: 'ok' }
  | { step: 'claim'; state: 'failed'; code: number | null; message: string }
  | { step: 'skipped'; reason: string };

export interface PrechainReport {
  steps: PrechainStep[];
  /** resolve 成功后的主题（UI 须回显确认后再 claim） */
  topic: string | null;
  topicInferred: boolean | null;
  taskGoal: string | null;
  notes: string[];
  /** 任一步失败即 true；此后 UI 不应进入 claim/点火 */
  failed: boolean;
}

/** 第一步 + 第二步：resolve → preflight（用 resolve 的 critics）。claim 独立成步（确认后调用）。 */
export async function runResolveAndPreflight(
  cmds: TriviumCommands,
  args: { entry: EntryKind; body: string; flags: PrechainFlags },
): Promise<PrechainReport> {
  const steps: PrechainStep[] = [];
  const cliFlags = buildCliFlags(args.flags);
  const resolve = await cmds.topicResolve({
    stage: ENTRY_STAGE[args.entry],
    body: args.body,
    flags: cliFlags,
  });
  if (resolve.code !== 0 || !resolve.out?.ok) {
    const message = firstLine(resolve.stderr || resolve.stdout) || '解析失败';
    steps.push({ step: 'resolve', state: 'failed', code: resolve.code, message });
    return { steps, topic: null, topicInferred: null, taskGoal: null, notes: [], failed: true };
  }
  steps.push({ step: 'resolve', state: 'ok', out: resolve.out });

  const critics = resolve.out.critics ?? [];
  const preflight = await cmds.preflight({
    stage: ENTRY_STAGE[args.entry],
    driver: resolve.out.driver ?? args.flags.driver,
    critics,
    // CLAUDE-03：预检必须校验本轮实际运行配置——profile/模型/档位类旗标与
    // resolve 同源透传；--topic/--max-rounds/--context 不属预检面
    flags: preflightFlagList(args.flags.extra ?? []),
  });
  if (preflight.code !== 0 || !preflight.out?.ok) {
    const failChecks = (preflight.out?.checks ?? [])
      .filter((c) => !c.ok)
      .map((c) => `${c.name}：${c.detail}`)
      .join('\n');
    const message = failChecks || firstLine(preflight.stderr) || explainExitCode(preflight.code ?? 1).label;
    steps.push({ step: 'preflight', state: 'failed', code: preflight.code, message });
    return {
      steps,
      topic: resolve.out.topic,
      topicInferred: resolve.out.topic_inferred,
      taskGoal: resolve.out.task_goal,
      notes: resolve.out.notes ?? [],
      failed: true,
    };
  }
  steps.push({ step: 'preflight', state: 'ok', warnings: preflight.out.warnings ?? [] });
  return {
    steps,
    topic: resolve.out.topic,
    topicInferred: resolve.out.topic_inferred,
    taskGoal: resolve.out.task_goal,
    notes: resolve.out.notes ?? [],
    failed: false,
  };
}

/** 主题确认后的 claim（仅 A/B；其余入口调用方不触发本步） */
export async function claimAfterConfirm(
  cmds: TriviumCommands,
  entry: EntryKind,
  topic: string,
  driver: string,
): Promise<PrechainStep> {
  const stage = ENTRY_CLAIM_STAGE[entry];
  if (!stage) {
    return { step: 'skipped', reason: `入口 ${entry} 不预认领（认领由终端会话在正确时点执行）` };
  }
  const r = await cmds.topicClaim(topic, stage, driver);
  if (r.code === 0 && r.out?.ok) return { step: 'claim', state: 'ok' };
  return {
    step: 'claim',
    state: 'failed',
    code: r.code,
    message: firstLine(r.stderr) || explainExitCode(r.code ?? 1).label,
  };
}

/** 表单旗标 → CLI 旗标（--driver/--critics/--max-rounds/--topic + extra） */
export function buildCliFlags(f: PrechainFlags): string[] {
  const flags: string[] = ['--driver', f.driver, '--critics', f.critics.join(',')];
  if (f.maxRounds !== undefined) flags.push('--max-rounds', String(f.maxRounds));
  if (f.topic !== undefined && f.topic !== '') flags.push('--topic', f.topic);
  if (f.extra && f.extra.length > 0) flags.push(...f.extra);
  return flags;
}

function firstLine(text: string): string {
  return (text ?? '').split('\n').find((l) => l.trim().length > 0)?.trim() ?? '';
}

/** preflight 接受的运行旗标前缀（CLAUDE-03：与 review --start 同一预检面，含 Driver 声明） */
const PREFLIGHT_FLAG_PREFIXES = [
  '--profile',
  '--model-',
  '--tier-',
  '--effort-',
  '--profile-',
  '--native-',
  '--driver-model',
  '--driver-provider',
];

/** 从 extra 旗标数组筛出 preflight 面的旗标（保留其值位） */
export function preflightFlagList(extra: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < extra.length; i++) {
    const tok = extra[i]!;
    if (PREFLIGHT_FLAG_PREFIXES.some((p) => tok === p || tok.startsWith(p))) {
      out.push(tok);
      // 值位：本组旗标形态均为 --flag value（布尔形态 --native-* 无值位）
      const next = extra[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out.push(next);
        i += 1;
      }
    }
  }
  return out;
}

/** 失败步类型守卫（联合类型收窄用，测试与 UI 共用） */
export function isFailedStep(s: PrechainStep): s is Extract<PrechainStep, { state: 'failed' }> {
  return 'state' in s && s.state === 'failed';
}
