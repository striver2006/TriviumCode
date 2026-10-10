// 派生审计：只读已落盘原始会话，不启动CLI、不替换canonical原件。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { codexWriteAttemptDenied, normalizedPath, saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const read = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const records = [];
for (const name of fs.readdirSync(path.join(root, 'routes')).filter(n => n.startsWith('codex-')).sort()) {
  const dir = path.join(root, 'routes', name);
  if (!fs.existsSync(path.join(dir, 'result.json'))) continue;
  const result = read(path.join(dir, 'result.json'));
  const events = read(path.join(dir, 'session-events.json'));
  const before = read(path.join(dir, 'fixture-before.json'));
  const commands = events.filter(e => e.type === 'event_msg' && e.payload?.type === 'item_completed' &&
    e.payload.item?.type === 'CommandExecution').map(e => e.payload.item);
  const contexts = events.filter(e => e.type === 'turn_context').map(e => e.payload);
  const efforts = [...new Set(contexts.map(c => c.effort).filter(e => typeof e === 'string'))];
  const paired = commands.map(c => {
    const cwd = typeof c.cwd === 'string' && c.cwd.startsWith('file:') ? fileURLToPath(c.cwd) : c.cwd;
    const rendered = Array.isArray(c.command) && c.command.length === 3 && c.command[1] === '-lc'
      ? [`${c.command[0]} -lc "${c.command[2]}"`, `${c.command[0]} -lc '${c.command[2].replaceAll("'", "'\\''")}'`] : [];
    const matches = result.trace.rawItems.filter(i => i.type === 'command_execution' && rendered.includes(i.command) &&
      i.exit_code === c.exit_code && i.aggregated_output === c.aggregated_output && i.status === c.status);
    const unique = matches.length === 1 && commands.filter(i => i.id === c.id).length === 1 &&
      commands.filter(i => JSON.stringify(i.command) === JSON.stringify(c.command) && i.aggregated_output === c.aggregated_output).length === 1;
    const fixtureCwd = normalizedPath(cwd, before.root) === normalizedPath(before.root, before.root);
    const actualRead = unique && fixtureCwd && c.status === 'completed' && c.exit_code === 0 &&
      c.parsed_cmd?.some(p => p.type === 'read' && normalizedPath(p.path, cwd) === normalizedPath('README.md', before.root)) &&
      c.aggregated_output?.includes(before.first_word);
    const trace = { ...result.trace, rawItems: matches };
    const write = unique && fixtureCwd && result.request.arm === 'write' &&
      codexWriteAttemptDenied(trace, { ...result.write_context, cwd });
    return { session_command_id: c.id, stdout_item_id: matches.length === 1 ? matches[0].id : null,
      unique_pair: unique, pairing_basis: '同一隔离thread中的唯一命令数组、完整输出、exit/status相等；两种ID各自保留，不宣称相同',
      command: c.command, cwd, cwd_source: 'event_msg/item_completed/CommandExecution.cwd',
      fixture_cwd_matches: fixtureCwd, actual_read_verified: Boolean(actualRead), production_write_verified: Boolean(write),
      output: c.aggregated_output, exit_code: c.exit_code };
  });
  const readVerified = paired.some(c => c.actual_read_verified);
  const writeVerified = paired.some(c => c.production_write_verified);
  if (result.request.arm === 'read' && result.actual_read && !readVerified) throw Error(`${name}: 缺少实际README命令证据`);
  if (result.request.arm === 'write' && result.write_pass && !writeVerified) throw Error(`${name}: canonical写结论不符合实际command cwd`);
  records.push({ route: name, completed: result.completed, model_readback: result.readback,
    effort_cli_observed: efforts.length === 1 ? efforts[0] : null, effort_source: 'turn_context.effort',
    effort_requested: null, server_effort: null, server_identity: null,
    actual_read_verified: readVerified, production_write_verified: writeVerified,
    commands: paired, raw_sha256: hash(path.join(dir,'raw.json')), session_sha256: hash(path.join(dir,'session-events.json')),
    result_sha256: hash(path.join(dir,'result.json')), before_sha256: hash(path.join(dir,'fixture-before.json')),
    after_sha256: hash(path.join(dir,'fixture-after.json')) });
}
const nativeBoundaries = [];
for (const name of fs.readdirSync(path.join(root,'ledger/admission')).filter(n => /^launch-\d+\.json$/.test(n))) {
  const entry = read(path.join(root,'ledger/admission',name));
  if (entry.cli === 'codex' || entry.boundary_parent) nativeBoundaries.push({ ledger: name, index: entry.index, cli: entry.cli,
    entry: entry.entry, entry_sha256: entry.entry_sha256, boundary_parent: entry.boundary_parent,
    current_entry_sha256: fs.existsSync(entry.entry ?? '') ? hash(entry.entry) : null,
    completed: entry.completed_at !== undefined, code: entry.code });
}
const filename = `command-context-audit-${crypto.randomUUID()}.json`;
saveEvidence(path.join(root,'audit-snapshots',filename), { observed_at: new Date().toISOString(), script_sha256: hash(fileURLToPath(import.meta.url)),
  original_criteria_unchanged: true, canonical_effort_null_means_not_extracted: true,
  note: 'effort是CLI实际状态回读，不添加默认值、不作为服务端证明；canonical native_entry在Codex指Node入口，native子进程另见ledger。',
  records, native_boundaries: nativeBoundaries });
console.log(JSON.stringify({ filename, records: records.map(r => ({route:r.route,read:r.actual_read_verified,write:r.production_write_verified,effort:r.effort_cli_observed})) }));
