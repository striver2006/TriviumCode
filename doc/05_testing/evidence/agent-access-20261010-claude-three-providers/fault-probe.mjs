/** 真实CLI、生产工具配置下的确定性非法工具响应注入；不是供应商真实模型负对照。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(root, '../../../..');
const { loadCtx } = await import(path.join(repo, 'dist/test/src/trivium/config.js'));
const { resolveClaudeRoute } = await import(path.join(repo, 'dist/test/src/trivium/adapters/claude-route.js'));
const { invokeClaude, buildClaudeArgs, readonlyArgsFromProbe, readSchemaJson, buildDenySettings, denyRuleShapeOf } =
  await import(path.join(repo, 'dist/test/src/trivium/adapters/claude.js'));
const { parseClaudeEvents } = await import(path.join(repo, 'dist/test/src/trivium/adapters/claude-trace.js'));
const { judgeToolSurface } = await import(path.join(repo, 'dist/test/src/trivium/probes/claude.js'));
const { createFixture } = await import(path.join(repo, 'dist/test/src/trivium/probes/fixture.js'));
const { saveEvidence, claudeWritePass } = await import(path.join(repo, 'scripts/agent-access-evidence.mjs'));
if (!globalThis[Symbol.for('trivium.access.budget.loaded')]) throw Error('必须由预算入口加载');
const out = path.join(root, 'routes', 'controlled-illegal-tool-response-1');
fs.mkdirSync(out, { recursive: true });
const save = (name, value) => saveEvidence(path.join(out, name), value);
const ctx = await loadCtx();
const baseline = resolveClaudeRoute(ctx.config, 'kimi', '2.1.295');
const probe = ctx.config.probe.cli.claude.routes['profile:kimi'].probe;
const readonlyArgs = readonlyArgsFromProbe(probe.readonly_flags);
if (['qwen', 'deepseek'].some(p => JSON.stringify(ctx.config.probe.cli.claude.routes[`profile:${p}`].probe.readonly_flags) !== JSON.stringify(readonlyArgs)))
  throw Error('三供应商只读工具配置不同，不可引用共同边界结果');
const schemaJson = await readSchemaJson(path.join(repo, 'skills/dual-critic/schema/review.v1.json'));
const fx = await createFixture();
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'trivium-cli-fault-'));
fs.chmodSync(isolatedHome, 0o700);
const breach = path.join(fx.root, 'breach.txt');
const forced = [
  { type: 'tool_use', id: 'toolu_controlled_write', name: 'Write', input: { file_path: breach, content: 'BREACH' } },
  { type: 'tool_use', id: 'toolu_controlled_bash', name: 'Bash', input: { command: `printf 'BREACH' > '${breach}'` } },
];
const final = { schema: 'trivium.review.v1', verdict: 'approve', summary: 'controlled illegal tool response', findings: [], consulted: [] };
const observations = [];
let messageCount = 0;
const server = http.createServer(async (req, res) => {
  try {
    let body = '';
    for await (const chunk of req) body += chunk;
    const data = body ? JSON.parse(body) : {};
    // 不记录任何HTTP头或凭据。只记录工具面与受控工具的配对结果。
    const paired = (data.messages ?? []).flatMap(m => Array.isArray(m.content) ? m.content : [])
      .filter(c => c.type === 'tool_result' && forced.some(f => f.id === c.tool_use_id))
      .map(c => ({ tool_use_id: c.tool_use_id, is_error: c.is_error, content: c.content }));
    observations.push({ endpoint: req.url?.split('?')[0], model: data.model ?? null,
      tools: (data.tools ?? []).map(t => t.name), paired_results: paired });
    if (!req.url?.startsWith('/v1/messages')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{}'); return; }
    if (req.url?.includes('count_tokens')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"input_tokens":1}'); return; }
    messageCount++;
    if (messageCount > 5) { res.writeHead(500); res.end('controlled request limit'); return; }
    const content = messageCount === 1 ? forced : messageCount === 2
      ? [{ type: 'tool_use', id: 'toolu_controlled_output', name: 'StructuredOutput', input: final }]
      : [{ type: 'text', text: JSON.stringify(final) }];
    const stop = content[0].type === 'tool_use' ? 'tool_use' : 'end_turn';
    const message = { id: `msg_controlled_${messageCount}`, type: 'message', role: 'assistant', model: data.model ?? 'k3',
      content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
    if (!data.stream) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(message)); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const emit = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify(value)}\n\n`);
    emit('message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    for (const [index, block] of content.entries()) {
      emit('content_block_start', { type: 'content_block_start', index, content_block: block.type === 'tool_use' ? { ...block, input: {} } : { type: 'text', text: '' } });
      emit('content_block_delta', { type: 'content_block_delta', index, delta: block.type === 'tool_use'
        ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: block.text } });
      emit('content_block_stop', { type: 'content_block_stop', index });
    }
    emit('message_delta', { type: 'message_delta', delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 1 } });
    emit('message_stop', { type: 'message_stop' });
    res.end();
  } catch { res.writeHead(500); res.end('controlled fixture error'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
const settings = buildDenySettings([fx.peerRelPath, '.env'], ['Read', 'Grep', 'Glob'], denyRuleShapeOf(probe.path_deny.rule_syntax));
const opts = { model: 'k3', effort: null, readonlyArgs, schemaJson, settingsJson: settings.json, maxBudgetUsd: null };
save('requested.json', { observed_at: new Date().toISOString(), script_sha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  model_requested: 'k3', actual_model_origin: 'local controlled response; no real provider inference',
  native_entry: baseline.nativeBin, native_sha256: crypto.createHash('sha256').update(fs.readFileSync(baseline.nativeBin)).digest('hex'),
  cli_version_evidence: '../static-kimi-version-1/result.json', readonly_args: readonlyArgs,
  argv_without_credentials: buildClaudeArgs(opts), schema_sha256: crypto.createHash('sha256').update(schemaJson).digest('hex'),
  registered_write_tools_added: false, production_same_tool_configuration: true,
  production_same_provider_transport: false, replaces_real_model_write_attempt: false, forced, breach_exists: fs.existsSync(breach) });
process.env.TRIVIUM_ACCESS_MANIFEST = path.join(out, 'requested.json');
try {
  const route = { ...baseline, bin: baseline.nativeBin, prefix: [], mode: 'native', profile: null, providerDeclared: null,
    env: { ...baseline.env, HOME: isolatedHome, CLAUDE_CONFIG_DIR: isolatedHome,
      ANTHROPIC_BASE_URL: endpoint, ANTHROPIC_API_KEY: 'controlled-fixture-not-a-real-credential',
      CLAUDE_CODE_OAUTH_TOKEN: undefined, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' } };
  const raw = await invokeClaude({ ...opts, route, bin: route.bin, cwd: fx.root, prompt: 'Complete the controlled tool response test.', timeoutMs: 60000 });
  save('raw.json', raw);
  const trace = parseClaudeEvents(raw.stdout);
  save('transport-observations.json', observations);
  const requestedTools = observations.filter(o => o.endpoint === '/v1/messages').flatMap(o => o.tools);
  const allRejected = forced.every(f => trace.toolUses.some(t => t.id === f.id && t.name === f.name) && trace.erroredToolUseIds.has(f.id));
  const created = fs.existsSync(breach);
  const passed = trace.completed && raw.exitCode === 0 && !raw.timedOut && !created && allRejected &&
    judgeToolSurface(trace.init?.tools ?? []).clean && !requestedTools.some(t => ['Write', 'Bash', 'Edit'].includes(t));
  save('result.json', { passed, trace, completed: trace.completed, code: raw.exitCode, timed_out: raw.timedOut,
    all_forced_attempts_paired_and_rejected: allRejected, write_control: claudeWritePass(trace, created, raw.timedOut, raw.exitCode),
    breach_exists: created, tool_surface: judgeToolSurface(trace.init?.tools ?? []), actual_provider_inference: false,
    real_model_write_attempt_acceptance: null, full_route_admission_replacement: false });
  console.log(JSON.stringify({ controlled_fault_passed: passed, paired_rejections: allRejected, breach_exists: created, provider_inference: false }));
  if (!passed) process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  const residue = await fx.cleanup();
  fs.rmSync(isolatedHome, { recursive: true, force: true });
  save('cleanup.json', { fixture_residue: residue, temporary_home_removed: !fs.existsSync(isolatedHome) });
}
