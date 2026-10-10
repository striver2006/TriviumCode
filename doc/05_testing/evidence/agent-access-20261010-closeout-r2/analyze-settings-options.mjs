/** 静态比较，不启动CLI、不改变生产规则；目录候选来自现有敏感glob。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadCtx } from '../../../../dist/test/src/trivium/config.js';
import { enumerateDenyPaths } from '../../../../dist/test/src/trivium/freeze.js';
import { buildDenySettings, denyRuleShapeOf, readonlyToolsFromProbe } from '../../../../dist/test/src/trivium/adapters/claude.js';
import { claudeRouteKey } from '../../../../dist/test/src/trivium/adapters/claude-route.js';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const root = path.dirname(fileURLToPath(import.meta.url)), ctx = await loadCtx();
const saved = ctx.config.probe.cli.claude.routes[claudeRouteKey('qwen')].probe;
const deny = await enumerateDenyPaths(ctx.config, ctx.projectRoot, ctx.archiveRoot, 'claude', 'codex', 'Agent双模式接入真实准入收口');
const candidates = ctx.config.review.sensitive_globs.filter(g => g.endsWith('/**')).map(g => g.slice(0, -3))
  .filter(g => g && !path.isAbsolute(g) && !/[()[\]{}*?!\\\n\r]/.test(g));
const roots = [...new Set(candidates)].sort((a,b) => a.length-b.length).filter((p,i,a) => !a.slice(0,i).some(q => p.startsWith(q+'/')));
const covered = p => roots.find(r => p.startsWith(r+'/'));
const compact = [...new Set([...deny.filter(p => !covered(p)), ...roots.filter(r => deny.some(p => p.startsWith(r+'/')))])].sort();
const tools = readonlyToolsFromProbe(saved.readonly_flags), shape = denyRuleShapeOf(saved.path_deny.rule_syntax);
const original = buildDenySettings(deny, tools, shape), candidate = buildDenySettings(compact, tools, shape);
const result = { observed_at: new Date().toISOString(), script_sha256: hash(fileURLToPath(import.meta.url)),
  modules_sha256: Object.fromEntries(['config','freeze','adapters/claude','adapters/claude-route'].map(n => [n, hash(`dist/test/src/trivium/${n}.js`)])),
  config_sha256: { shared: hash('.trivium/config.yaml'), local: hash('.trivium/config.local.yaml') },
  kind: 'static-candidate-only', actual_cli_semantics: '未测', production_implementation_changed: false,
  settings_original: { paths: deny.length, rules: original.ruleCount, bytes: original.bytes, skipped: original.skipped.length },
  settings_compact_candidate: { expressions: compact.length, rules: candidate.ruleCount, bytes: candidate.bytes, skipped: candidate.skipped.length },
  grouping_basis: '仅现有sensitive_globs字面目录/**；不猜共同前缀，不合并含己方历史的主题根',
  groups: roots.map(root => ({ root, existing_paths: deny.filter(p => p.startsWith(root+'/')).length })),
  remaining_exact_paths: deny.filter(p => !covered(p)),
  current_enumerated_coverage: deny.every(p => compact.includes(p) || roots.some(r => compact.includes(r) && p.startsWith(r+'/'))),
  semantic_limit: '当前路径字面包含关系已核对；CLI子树拒绝、软链接、特殊字符、未来深层文件及误拦边界未测。原始机器枚举和判据保持。' };
const filename = `settings-options-analysis-${crypto.randomUUID()}.json`;
saveEvidence(path.join(root, 'audit-snapshots', filename), result);
console.log(JSON.stringify({ filename, original: result.settings_original, candidate: result.settings_compact_candidate,
  current_enumerated_coverage: result.current_enumerated_coverage }));
