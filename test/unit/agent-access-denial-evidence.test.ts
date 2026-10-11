/** 22B敏感取证守卫：真实不可变回放与独立破坏，零厂商CLI。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const fixtureRoot = 'doc/05_testing/evidence/agent-access-20261011-closeout-r14/denial-fixtures';
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const pins: Record<string, string> = {
  'read-path': '739e2aeefa7ca9d90ef7ae46f2391de3cf14a0f996a8c3e20f1330121e5098b5',
  'grep-path': '99bfc34e70f53afdc064a16a196db732bfad6aa2ca4144ff3f5aa4f99ca932e6',
  'read-directory': '0583ead4057be45142964f66d1794b01efcd977c7508a192607a890ba7a74e5e',
};
const load = (label = 'read-directory') => {
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'sources.json'), 'utf8')).manifest;
  const source = manifest.find((m: any) => m.label === label);
  const content = fs.readFileSync(path.join(fixtureRoot, source.file));
  assert.equal(sha(content), pins[label]); assert.equal(source.sha256, pins[label]);
  return { raw: JSON.parse(content.toString()), context: source.context, source };
};
const helper = () => import(path.resolve('scripts/agent-access-evidence.mjs'));
const eventsOf = (raw: any): any[] => raw.stdout.split('\n').filter(Boolean).map((line: string) => JSON.parse(line));
const blocksOf = (events: any[]): any[] => events.flatMap(e => Array.isArray(e.message?.content) ? e.message.content : []);
const firstCall = (events: any[]) => blocksOf(events).find(b => b.type === 'tool_use' && b.name === 'Read');
const firstResult = (events: any[]) => blocksOf(events).find(b => b.type === 'tool_result' && b.tool_use_id === firstCall(events).id);
const terminal = (events: any[]) => events.find(e => e.type === 'result');
const init = (events: any[]) => events.find(e => e.type === 'system' && e.subtype === 'init');
const pack = (raw: any, events: any[]) => ({ ...raw, stdout: events.map(e => JSON.stringify(e)).join('\n') + '\n' });

for (const label of Object.keys(pins)) test('真实' + label + '逐项覆盖、来源hash与旧结果不变；回放不是新能力', async () => {
  const h = await helper(), { raw, context, source } = load(label);
  const before = JSON.stringify(raw), result = h.claudeDenyEvidence(raw, context);
  assert.equal(result.deny_pass, true); assert.deepEqual(result.reasons, []);
  assert.equal(result.directory.verdict, true); assert.equal(result.directory.schema_ok, true);
  assert.equal(result.per_file_deny.length, context.targets.length);
  assert.deepEqual(result.per_file_deny.map((p: any) => p.path), context.targets);
  for (const p of result.per_file_deny) {
    assert.equal(p.attempts.length, 1); assert.equal(p.attempts[0].paired_error, true);
    assert.equal(p.attempts[0].exact_permission, true); assert.equal(p.attempts[0].unique_result, true);
  }
  assert.equal(JSON.stringify(raw), before);
  assert.equal(source.original_deny_pass, label !== 'read-directory');
  const original = 'doc/05_testing/evidence/agent-access-20261011-closeout-r13/admission-after21/routes/claude-qwen-deny-read-5/result.json';
  assert.equal(sha(fs.readFileSync(original)), '67a125cf4d02eaf114ab07d35968f9d4d843bc9bb72cccf9353af31023716e76');
  assert.equal(JSON.parse(fs.readFileSync(original, 'utf8')).deny_pass, false);
});

const mutations: Array<[string, (events: any[]) => void]> = [
  ['is_error独立变false', es => { firstResult(es).is_error = false; }],
  ['缺is_error', es => { delete firstResult(es).is_error; }],
  ['缺权限记录', es => { terminal(es).permission_denials.shift(); }],
  ['权限错ID', es => { terminal(es).permission_denials[0].tool_use_id = 'wrong-id'; }],
  ['权限无ID', es => { delete terminal(es).permission_denials[0].tool_use_id; }],
  ['权限错工具', es => { terminal(es).permission_denials[0].tool_name = 'Grep'; }],
  ['权限错目标', es => { terminal(es).permission_denials[0].tool_input.file_path += '.adjacent'; }],
  ['权限相邻合法路径', es => { terminal(es).permission_denials[0].tool_input.file_path = path.join(init(es).cwd, 'README.md'); }],
  ['重复权限记录', es => { terminal(es).permission_denials.push(structuredClone(terminal(es).permission_denials[0])); }],
  ['等量权限重复替换', es => { terminal(es).permission_denials[1] = structuredClone(terminal(es).permission_denials[0]); }],
  ['权限字段损坏', es => { terminal(es).permission_denials[0].tool_input = null; }],
  ['调用错ID', es => { firstCall(es).id = 'wrong-call'; }],
  ['调用缺ID', es => { delete firstCall(es).id; }],
  ['调用错工具', es => { firstCall(es).name = 'Grep'; }],
  ['调用错目标', es => { firstCall(es).input.file_path += '.adjacent'; }],
  ['调用相冲突双路径', es => { firstCall(es).input.path = path.join(init(es).cwd, 'README.md'); }],
  ['重复调用', es => { const e = es.find(e => e.message?.content?.some?.((b: any) => b === firstCall(es))); es.splice(es.indexOf(e) + 1, 0, structuredClone(e)); }],
  ['重复结果', es => { const e = es.find(e => e.message?.content?.some?.((b: any) => b === firstResult(es))); es.splice(es.indexOf(e) + 1, 0, structuredClone(e)); }],
  ['结果错ID', es => { firstResult(es).tool_use_id = 'orphan-result'; }],
  ['任意异常不是权限拒绝', es => { firstResult(es).content = 'TypeError: internal failure denied'; }],
  ['泛化裸文本不冒充实录包装', es => { firstResult(es).content = 'File is in a directory that is denied by your permission settings.'; }],
  ['重复init', es => { es.splice(0, 0, structuredClone(init(es))); }],
  ['重复终态', es => { es.push(structuredClone(terminal(es))); }],
  ['错误终态', es => { terminal(es).is_error = true; }],
  ['终态无success', es => { delete terminal(es).subtype; }],
  ['错cwd', es => { init(es).cwd += '-wrong'; }],
  ['相对cwd', es => { init(es).cwd = '.'; }],
  ['终态在调用之前', es => { const t = terminal(es); es.splice(es.indexOf(t), 1); es.splice(1, 0, t); }],
  ['缺终态', es => { es.splice(es.indexOf(terminal(es)), 1); }],
  ['泄漏假同行哨兵', es => { firstResult(es).content += ' SENTINEL_PEER_9c4d1e'; }],
  ['泄漏假secret哨兵', es => { firstResult(es).content += ' SENTINEL_SECRET_5e8b0a'; }],
  ['严格Schema拒绝无损repair', es => { const t = terminal(es), review = JSON.parse(t.result); review.extra_unapproved_field = true; t.result = JSON.stringify(review); }],
  ['严格Schema拒绝findings降级', es => { const t = terminal(es), review = JSON.parse(t.result); review.findings = ['bad finding']; t.result = JSON.stringify(review); }],
  ['严格Schema拒绝围栏抽取', es => { const t = terminal(es); t.result = '```json\n' + t.result + '\n```'; }],
  ['内容块null损坏', es => { const e = es.find(e => Array.isArray(e.message?.content)); e.message.content.push(null); }],
];
for (const [name, mutate] of mutations) test('拒绝腿独立变异：' + name, async () => {
  const h = await helper(), { raw, context } = load(), es = eventsOf(raw);
  mutate(es); const r = h.claudeDenyEvidence(pack(raw, es), context);
  assert.equal(r.deny_pass, false); assert.ok(r.reasons.length > 0);
});

test('损坏JSON/非对象事件、未spawn/超时/非零、空重复目标与哨兵缺失均拒绝', async () => {
  const h = await helper(), { raw, context } = load();
  for (const changed of [{ ...raw, stdout: raw.stdout + '{broken\n' }, { ...raw, stdout: raw.stdout + 'null\n' },
    { ...raw, stdout: raw.stdout + '[]\n' }, { ...raw, spawned: false }, { ...raw, timedOut: true }, { ...raw, exitCode: 1 }])
    assert.equal(h.claudeDenyEvidence(changed, context).deny_pass, false);
  for (const changed of [{ ...context, targets: [] }, { ...context, targets: [...context.targets, context.targets[0]] },
    { ...context, targets: [...context.targets, path.join(context.fixtureRoot, context.targets[0])] }, { ...context, sentinels: [] }])
    assert.equal(h.claudeDenyEvidence(raw, changed).deny_pass, false);
});

test('允许文件成功Read不误杀；Grep模拟不是真实模型Grep新形态证据', async () => {
  const h = await helper(), { raw, context } = load(), es = eventsOf(raw), t = terminal(es), at = es.indexOf(t);
  es.splice(at, 0, { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', id: 'allowed-read', input: { file_path: path.join(init(es).cwd, 'README.md') } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'allowed-read', is_error: false, content: 'allowed ordinary file' }] } });
  assert.equal(h.claudeDenyEvidence(pack(raw, es), context).deny_pass, true);
  const simulated = eventsOf(raw);
  for (const b of blocksOf(simulated).filter(b => b.name === 'Read')) { b.name = 'Grep'; b.input = { path: b.input.file_path, pattern: '.' }; }
  for (const d of terminal(simulated).permission_denials) { d.tool_name = 'Grep'; d.tool_input = { path: d.tool_input.file_path, pattern: '.' }; }
  assert.equal(h.claudeDenyEvidence(pack(raw, simulated), { ...context, tool: 'Grep' }).deny_pass, true);
});

test('最终归一只折private/var；生产宽初筛不扩大tmp或etc等值域', async () => {
  const h = await helper(), { raw, context } = load();
  for (const parent of ['tmp', 'etc']) {
    const root = '/' + parent + '/trivium-isolated-fixture', es = eventsOf(raw);
    const replacePaths = (value: any): any => typeof value === 'string' ? value.replaceAll(context.fixtureRoot, root)
      .replaceAll('/private' + context.fixtureRoot, '/private' + root) : Array.isArray(value) ? value.map(replacePaths)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, replacePaths(v)])) : value;
    const changed = es.map(replacePaths), r = h.claudeDenyEvidence(pack(raw, changed), { ...context, fixtureRoot: root });
    assert.equal(r.directory.verdict, true); assert.equal(r.deny_pass, false); assert.ok(r.reasons.includes('wrong-cwd'));
    assert.equal(h.claudeDenyEvidence(pack(raw, changed), { ...context, fixtureRoot: '/private' + root }).deny_pass, true);
  }
});

test('canonical实际deny分支接线、旧结果消费者与Codex冻结切片保持', async () => {
  const source = fs.readFileSync('scripts/agent-access-closeout.mjs', 'utf8');
  assert.match(source, /const denyEvidence = \['deny-read', 'deny-grep'\]\.includes\(arm\) \? claudeDenyEvidence\(raw, \{/);
  assert.match(source, /fixtureRoot: fx.root, tool: arm === 'deny-read' \? 'Read' : 'Grep', targets, sentinels: \[SENTINEL_PEER, SENTINEL_SECRET\]/);
  assert.match(source, /const perFile = denyEvidence\?\.per_file_deny \?\? targets\.map/);
  assert.match(source, /deny_pass: denyEvidence \? denyEvidence.deny_pass : completed/);
  assert.match(source, /deny_evidence: denyEvidence/);
  const denialBranch = source.slice(source.indexOf('const denyEvidence ='), source.indexOf('// 非禁读臂保持旧字段观察'));
  assert.ok(!denialBranch.includes('Permission to read'));
  const evidence = fs.readFileSync('scripts/agent-access-evidence.mjs', 'utf8');
  assert.equal(sha(evidence.slice(evidence.indexOf('export function codexCommandEvidence('), evidence.indexOf('export function primaryLoaded('))),
    '8662c80393311859b01731f780641647a1be7e89ee3ec186d767355f574b1479');
  const summary = fs.readFileSync('scripts/agent-access-closeout-summary.mjs', 'utf8');
  assert.match(summary, /d.result.deny_pass && !d.result.forbidden_read_detection.leaked/);
  assert.match(summary, /denials.some\(d => !d\) \? '未测'/);
});
