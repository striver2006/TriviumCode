/** 本主题正式代码启动前检查；不修改产品的软线或guard判据，不启动任何厂商CLI。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { loadCtx } from '../../../../dist/test/src/trivium/config.js';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { enumerateDenyPaths } from '../../../../dist/test/src/trivium/freeze.js';
import { resolveTier } from '../../../../dist/test/src/trivium/adapters/base.js';
import { claudeProbeForRoute, resolveClaudeRoute } from '../../../../dist/test/src/trivium/adapters/claude-route.js';
import { buildProjectedDenySettings, consumeClaudeDirectories, denyRuleShapeOf, readonlyToolsFromProbe,
  DENY_SETTINGS_SOFT_CAP_BYTES, CLAUDE_DIRECTORY_SHAPE } from '../../../../dist/test/src/trivium/adapters/claude.js';
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** 纯边界核验；调用者在编排器正式启动前消费，失败不得reserve或写入正式run。 */
export function assertCodeStartMeasurement(measurement) {
  if (measurement.install_matches_source !== true || measurement.inputs_match !== true ||
      !Number.isSafeInteger(measurement.settings_bytes) || measurement.settings_bytes < 0 ||
      measurement.settings_bytes > DENY_SETTINGS_SOFT_CAP_BYTES || measurement.skipped_count !== 0 ||
      measurement.file_shape_verified !== true || measurement.directory_shape !== CLAUDE_DIRECTORY_SHAPE ||
      measurement.directory_fact_consumed !== true || measurement.deny_settings_applied !== true) {
    throw Error('最终安装/事实/settings未具备正式代码启动条件');
  }
  return true;
}

export async function measureCodeStart(repo, topic, args) {
  if (args.includes('--profile')) throw Error('任务启动前检查未支持全局profile覆盖，拒绝猜测实际配置');
  const ctx = await loadCtx({ cwd: repo });
  const get = flag => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  const overrides = {};
  if (args.includes('--native-claude')) overrides.vendorProfile = null;
  else if (get('--profile-claude') !== undefined) overrides.vendorProfile = get('--profile-claude');
  if (get('--model-claude') !== undefined) overrides.model = get('--model-claude');
  if (get('--tier-claude') !== undefined) overrides.tier = get('--tier-claude');
  if (get('--effort-claude') !== undefined) overrides.effort = get('--effort-claude');
  const routed = resolveTier(ctx.config, 'claude', 'code', overrides);
  const probe = claudeProbeForRoute(ctx.config, routed.vendorProfile);
  if (!probe) throw Error('所选Claude路线无可用探针');
  const route = resolveClaudeRoute(ctx.config, routed.vendorProfile, probe.version);
  const guard = await consumeClaudeDirectories(probe, route, probe.version, ctx.config.review.sensitive_globs, ctx.config.probe_ttl_days);
  const paths = await enumerateDenyPaths(ctx.config, repo, ctx.archiveRoot, 'claude', 'codex', topic);
  const tools = readonlyToolsFromProbe(probe.readonly_flags);
  const shape = probe.path_deny.supported === true ? denyRuleShapeOf(probe.path_deny.rule_syntax) : null;
  const settings = buildProjectedDenySettings(paths, tools, shape, ctx.config.review.sensitive_globs, guard.consumed);
  const installed = path.join(os.homedir(), '.claude/skills/dual-critic/scripts/trivium.cjs');
  const source = path.join(repo, 'skills/dual-critic/scripts/trivium.cjs');
  const sourceStamp = await computeBuildStamp(repo);
  const embedded = /inputs_sha256: "([a-f0-9]{64})"/.exec(fs.readFileSync(installed, 'utf8'))?.[1] ?? null;
  return { measured_at: new Date().toISOString(), topic, profile: routed.vendorProfile, requested_model: routed.model,
    cli_version: probe.version, route_fingerprint: route.fingerprint, source_paths_count: paths.length,
    source_paths_sha256: crypto.createHash('sha256').update(JSON.stringify(paths)).digest('hex'),
    source_bundle_sha256: hash(source), installed_bundle_sha256: hash(installed),
    install_matches_source: hash(source) === hash(installed), inputs_match: embedded !== null && embedded === sourceStamp?.inputs_sha256,
    directory_shape: guard.shape, directory_fact_consumed: tools.length > 0 && tools.every(tool =>
      guard.consumed[tool] === true && settings.projection?.compressedTools.includes(tool)),
    deny_settings_applied: shape !== null && settings.json !== null && settings.ruleCount > 0,
    file_shape_verified: probe.path_deny.file_shape_verified, settings_bytes: settings.bytes, settings_rules: settings.ruleCount,
    skipped_count: settings.skipped.length, soft_cap_bytes: DENY_SETTINGS_SOFT_CAP_BYTES,
    compressed_tools: settings.projection?.compressedTools ?? [], config_shared_sha256: hash(path.join(repo, '.trivium/config.yaml')),
    config_local_sha256: hash(path.join(repo, '.trivium/config.local.yaml')), real_cli_starts: 0 };
}
