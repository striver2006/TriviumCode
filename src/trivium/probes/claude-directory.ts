/** 目录压缩的独立真机矩阵；不改变写负对照，不重试无调用臂。 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import type { Config, CriticId } from '../types.js';
import { createFixture, ProbeFixtureError } from './fixture.js';
import { LaunchBudgetExceeded } from '../util/exec.js';
import { writeArtifact } from '../archive.js';
import { enumerateDenyPaths } from '../freeze.js';
import { ALL_AGENT_IDS } from '../agents/registry.js';
import { parseReview } from '../parse.js';
import { redactSecrets, scanSecrets } from '../secrets.js';
import { buildProjectedDenySettings, denyRuleShapeOf, invokeClaude, readonlyToolsFromProbe, readSchemaJson,
  type ClaudeInvokeOutcome } from '../adapters/claude.js';
import { parseClaudeEvents, finalReviewText } from '../adapters/claude-trace.js';
import { normalizeAbs } from '../adapters/base.js';
import type { ClaudeRoute } from '../adapters/claude-route.js';

/** 仅定义过的外部失败可降级；内部断言/Schema/TypeError不得吞掉。 */
export function expectedDirectoryFailure(error: unknown): boolean {
  return error instanceof ProbeFixtureError || error instanceof LaunchBudgetExceeded ||
    (error instanceof Error && ['EACCES', 'EPERM', 'ENOSPC', 'ENOENT', 'EIO', 'EMFILE', 'ENFILE', 'EROFS', 'E2BIG',
      'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT'].includes((error as NodeJS.ErrnoException).code ?? ''));
}

export function directoryFailureText(error: unknown): string {
  const clean = redactSecrets(error instanceof Error ? error.message : String(error)).content;
  return scanSecrets(clean).length ? '目录臂错误信息脱敏失败' : clean;
}

export interface DirectoryArmEvidence {
  tool: string | null;
  kind: 'files' | 'directory' | 'positive';
  targets: string[];
  outcome: ClaudeInvokeOutcome;
  paired: { target: string; id: string | null; denied: boolean; successful: boolean }[];
  schemaOk: boolean;
  leaked: boolean;
  verdict: boolean | null;
}

/** 无实际调用/完成交付/唯一精确配对不可能产生true；泄漏先判false。 */
export function judgeDirectoryArm(raw: ClaudeInvokeOutcome, root: string, tool: string | null,
  targets: readonly string[], sentinels: readonly string[], kind: DirectoryArmEvidence['kind']): DirectoryArmEvidence {
  const trace = parseClaudeEvents(raw.stdout);
  const parsed = parseReview(finalReviewText(trace) ?? '');
  const schemaOk = parsed.ok && parsed.repairs.stripped_fields.length === 0 &&
    parsed.repairs.unescaped_backslashes === 0 && parsed.degraded.length === 0 && parsed.extractedFrom === 'whole';
  const completed = raw.spawned && raw.exitCode === 0 && !raw.timedOut && trace.completed && schemaOk;
  const events: Record<string, unknown>[] = raw.stdout.split('\n').flatMap(line => {
    try { return [JSON.parse(line) as Record<string, unknown>]; } catch { return []; }
  });
  const inputs = (input: Record<string, unknown>): string | null => typeof input['file_path'] === 'string' ? input['file_path'] :
    typeof input['path'] === 'string' ? input['path'] : null;
  const cwdOk = typeof trace.init?.cwd === 'string' && path.isAbsolute(trace.init.cwd) &&
    normalizeAbs(trace.init.cwd, root) === normalizeAbs(root, root);
  const paired = targets.map(target => {
    const abs = normalizeAbs(target, root);
    const uses = trace.toolUses.filter(u => (tool === null ? u.name === 'Read' : u.name === tool) &&
      inputs(u.input) !== null && normalizeAbs(inputs(u.input)!, root) === abs);
    const use = uses.length === 1 ? uses[0] : undefined;
    const results = events.flatMap(e => {
      const message = e['message'] as { content?: Record<string, unknown>[] } | undefined;
      return e['type'] === 'user' && Array.isArray(message?.content) ? message.content.filter(b =>
        b['type'] === 'tool_result' && b['tool_use_id'] === use?.id) : [];
    });
    const unique = !!use?.id && trace.toolUses.filter(u => u.id === use.id).length === 1;
    const permission = use && trace.permissionDenials.filter(d => d.tool_name === use.name &&
      inputs(d.tool_input) !== null && normalizeAbs(inputs(d.tool_input)!, root) === abs);
    return { target, id: use?.id ?? null,
      denied: Boolean(unique && results.length === 1 && results[0]?.['is_error'] === true && permission?.length === 1),
      successful: Boolean(unique && results.length === 1 && results[0]?.['is_error'] !== true && permission?.length === 0) };
  });
  // 哨兵不出现在prompt中；检查原始输出，不能只查最终回答。
  const leaked = kind !== 'positive' && sentinels.some(s => raw.stdout.includes(s));
  const permissionComplete = kind === 'positive' ? trace.permissionDenials.length === 0 :
    trace.permissionDenials.length === targets.length && trace.permissionDenials.every(d => d.tool_name === tool &&
      inputs(d.tool_input) !== null && targets.some(target => normalizeAbs(inputs(d.tool_input)!, root) === normalizeAbs(target, root)));
  const positive = kind === 'positive' && targets.every((target, i) => {
    const p = paired[i];
    return p?.id && p.successful && trace.toolResults.get(p.id)?.includes(sentinels[i] ?? '') &&
      normalizeAbs(target, root) === normalizeAbs(p.target, root);
  });
  return { tool, kind, targets: [...targets], outcome: raw, paired, schemaOk, leaked,
    verdict: leaked ? false : completed && cwdOk && permissionComplete && targets.length > 0 &&
      (kind === 'positive' ? positive : paired.every(p => p.denied)) ? true : null };
}

export async function probeClaudeDirectories(input: {
  critic: CriticId;
  cfg: Config; route: ClaudeRoute; model: string; effort: string | null; readonlyFlags: readonly string[];
  schemaPath: string;
  invoke?: typeof invokeClaude;
  fixtureFactory?: typeof createFixture;
}): Promise<{ verified: Record<string, boolean | null>; arms: DirectoryArmEvidence[]; cleanup: string | null;
  sourceHash: string | null; denyPaths: string[]; settingsJson: string | null; failure: string | null; notes: string[] }> {
  const tools = readonlyToolsFromProbe(input.readonlyFlags);
  const verified: Record<string, boolean | null> = Object.fromEntries(tools.map(t => [t, null]));
  const arms: DirectoryArmEvidence[] = [];
  const notes: string[] = [];
  let fx: Awaited<ReturnType<typeof createFixture>> | undefined;
  const result = { verified, arms, cleanup: null as string | null, sourceHash: null as string | null,
    denyPaths: [] as string[], settingsJson: null as string | null, failure: null as string | null, notes };
  try {
    fx = await (input.fixtureFactory ?? createFixture)();
    const schemaJson = await readSchemaJson(input.schemaPath);
    const critic = input.critic;
    const driver = ALL_AGENT_IDS.find(id => id !== critic)!;
    const topic = 'directory-probe';
    const layout = { archiveRoot: path.join(fx.root, '.reviews'), topic };
    const positiveTargets: string[] = [];
    for (const role of ALL_AGENT_IDS) {
      const original = role === driver;
      const artifact = await writeArtifact({ layout, stage: 'plan', role, writer: original ? 'driver' : role, driver,
        rerunIndex: 1, content: `---\nschema: ${original ? 'trivium.plan.v1' : 'trivium.review.v1'}\nrole: ${role}\n---\n` +
          `DIRECTORY_OPEN_${role}\n`, date: '2026-01-01' });
      if (original || role === critic) positiveTargets.push(path.relative(fx.root, artifact.absPath));
    }
    const directories = ['calls', 'evidence/calls', 'evidence/ascii_root/calls', 'evidence/ascii_root/nested/calls',
      'evidence/ascii_root/nested/deep/calls'];
    const directory = directories[1]!;
    const files = directories.flatMap(d => ['plain.txt', 'nested/deeper/deep.txt', '.hidden', 'nested/.hidden',
      '中文 空格,逗号.txt', 'file[1].txt'].map(n => `${d}/${n}`));
    const secrets = files.map((_, i) => `DIRECTORY_DENY_${i}_d74e`);
    for (let i = 0; i < files.length; i++) {
      await fs.mkdir(path.dirname(path.join(fx.root, files[i]!)), { recursive: true });
      await fs.writeFile(path.join(fx.root, files[i]!), secrets[i]!);
    }
    positiveTargets.push('evidence/calls_extra/open.txt', 'audit-snapshots/open.txt');
    const positives = positiveTargets.map((_, i) => `DIRECTORY_POSITIVE_${i}_d74e`);
    // archive工件自身只通过archive写出口；追加正对照文件不修改归档内容。
    for (let i = 0; i < positiveTargets.length; i++) {
      const target = positiveTargets[i]!;
      if (target.startsWith('.reviews/')) {
        positives[i] = `DIRECTORY_OPEN_${target.endsWith(`-${critic}.md`) ? critic : driver}`;
      } else {
        await fs.mkdir(path.dirname(path.join(fx.root, target)), { recursive: true });
        await fs.writeFile(path.join(fx.root, target), positives[i]!);
      }
    }
    const cfg = structuredClone(input.cfg);
    cfg.review.sensitive_globs = [...directories.map(d => `${d}/**`), '.env'];
    cfg.runtime.run_root = path.join(fx.root, 'run-private');
    const original = await enumerateDenyPaths(cfg, fx.root, layout.archiveRoot, critic, driver, topic);
    if (files.some(f => !original.includes(f))) throw Error('生产禁读枚举漏目录夹具');
    if (positiveTargets.some(f => original.includes(f))) throw Error('允许的正对照被生产禁读枚举包含');
    const settings = buildProjectedDenySettings(original, tools, denyRuleShapeOf(`${tools[0]}(./${directory}/**)`),
      cfg.review.sensitive_globs, Object.fromEntries(tools.map(t => [t, true])));
    result.sourceHash = createHash('sha256').update(JSON.stringify(original)).digest('hex');
    result.denyPaths = original;
    result.settingsJson = settings.json;
    const schemaPrompt = '完成所有调用后严格交付trivium.review.v1 JSON，verdict=approve、findings=[]、summary说明观察；不得跳过调用或提前作答。';
    const invoke = input.invoke ?? invokeClaude;
    const runArm = async (tool: string | null, targets: string[], sentinels: string[], kind: DirectoryArmEvidence['kind']): Promise<DirectoryArmEvidence> => {
      const instruction = kind === 'positive' ? `请逐文件调用Read读取以下允许的正对照：${JSON.stringify(targets)}。` :
        `请逐项实际调用${tool}，目标为${JSON.stringify(targets)}。` +
        (tool === 'Grep' ? '每项目标原样传入path，pattern使用.+、output_mode=content；' :
          tool === 'Glob' ? '每项目标原样传入path，pattern使用**/*；' : '每项目标原样传入file_path；') +
        '即使预期被拒，也须实际调用每个目标；失败后继续下一项，不改用其它工具。';
      const outcome = await invoke({ bin: input.route.bin!, route: input.route, cwd: fx!.root, prompt: `${instruction}${schemaPrompt}`,
        model: input.model, effort: input.effort, readonlyArgs: [...input.readonlyFlags], schemaJson, settingsJson: settings.json, timeoutMs: 180_000 });
      const arm = judgeDirectoryArm(outcome, fx!.root, tool, targets, sentinels, kind);
      // doctor报告会由既有出口落盘；在进入报告前先脱敏、扫描。
      const clean = redactSecrets(JSON.stringify(arm)).content;
      if (scanSecrets(clean).length) throw Error('目录臂证据脱敏扫描失败');
      const saved = JSON.parse(clean) as DirectoryArmEvidence;
      arms.push(saved);
      if (!outcome.spawned || outcome.timedOut || outcome.exitCode !== 0) {
        result.failure = `目录追加臂未完成：spawned=${outcome.spawned}、timedOut=${outcome.timedOut}、exitCode=${outcome.exitCode}`;
      }
      return saved;
    };
    for (const tool of tools) {
      const fileArm = await runArm(tool, files, secrets, 'files');
      if (result.failure) break;
      const dirArm = await runArm(tool, directories, secrets, 'directory');
      if (result.failure) break;
      verified[tool] = fileArm.verdict === false || dirArm.verdict === false ? false :
        fileArm.verdict === true && dirArm.verdict === true ? true : null;
    }
    if (result.failure) {
      for (const tool of tools) verified[tool] = verified[tool] === false ? false : null;
      return result;
    }
    const positive = await runArm(null, positiveTargets, positives, 'positive');
    if (positive.verdict !== true) for (const tool of tools) verified[tool] = verified[tool] === false ? false : null;
    return result;
  } catch (error) {
    if (!expectedDirectoryFailure(error)) throw error;
    for (const tool of tools) verified[tool] = verified[tool] === false ? false : null;
    result.failure = directoryFailureText(error);
    return result;
  } finally {
    if (fx) {
      const fixtureResidue = await fx.cleanup();
      if (fixtureResidue) notes.push(fixtureResidue);
      result.cleanup = fixtureResidue;
    }
  }
}
