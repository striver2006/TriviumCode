import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { redactSecrets, scanSecrets } from '../dist/test/src/trivium/secrets.js';
export function saveEvidence(file, value, redactor = redactSecrets) {
  const content = redactor(JSON.stringify(value, (_k, v) => v instanceof Set ? [...v] : v instanceof Map ? [...v] : v, 2)).content + '\n';
  if (scanSecrets(content).length) throw Error('脱敏扫描失败，拒绝落盘');
  fs.writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
}
/** 只认可信实际cwd与唯一隔离目标；缺证据不兼容旧宽松接口。 */
export function normalizedPath(value, cwd) {
  if (typeof value !== 'string' || !value || typeof cwd !== 'string' || !path.isAbsolute(cwd)) return null;
  const absolute = path.resolve(cwd, value);
  return absolute.replace(/^\/private\/var(?=\/|$)/, '/var');
}
/** lstat把悬空链接也计为已有文件项；权限或其它错误不能冒充“不存在”。 */
export function captureFileState(file) {
  try { const stat = fs.lstatSync(file); return { path: file, exists: true, symlink: stat.isSymbolicLink() }; }
  catch (error) { if (error.code === 'ENOENT') return { path: file, exists: false }; throw error; }
}
/** 调用前后只采集独立夹具README；软链和非文件不消费，未定义读错误继续抛。 */
export function captureReadFileState(fixtureRoot) {
  if (typeof fixtureRoot !== 'string' || !path.isAbsolute(fixtureRoot)) throw Error('读取采样缺绝对fixtureRoot');
  const file = path.join(fixtureRoot, 'README.md');
  const empty = { path: file, exists: false, regular_file: false, symlink: false, bytes: null, sha256: null };
  const root = fs.lstatSync(fixtureRoot);
  if (!root.isDirectory() || root.isSymbolicLink()) return { ...empty, exists: null, reason: 'fixture-root-not-directory' };
  let stat;
  try { stat = fs.lstatSync(file); }
  catch (error) { if (error.code === 'ENOENT') return empty; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) return { ...empty, exists: true, symlink: stat.isSymbolicLink(), reason: 'not-regular-file' };
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor), content = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor), named = fs.lstatSync(file);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() ||
        opened.dev !== stat.dev || opened.ino !== stat.ino || named.dev !== opened.dev || named.ino !== opened.ino ||
        opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs ||
        named.size !== after.size || named.mtimeMs !== after.mtimeMs || named.ctimeMs !== after.ctimeMs || content.length !== after.size) {
      throw Error('README读取采样期间文件变化');
    }
    return { path: file, exists: true, regular_file: true, symlink: false, bytes: content.length,
      sha256: createHash('sha256').update(content).digest('hex') };
  } finally { fs.closeSync(descriptor); }
}

/** 额外全文观察，不参与actual_read/Schema/首词或准入汇总；严格字节、不归一尾部。 */
export function codexReadContentDiagnostic(trace, events, context, firstWord, states) {
  const evidence = codexCommandEvidence(trace, events, context, firstWord);
  const target = normalizedPath('README.md', context.fixtureRoot);
  const valid = state => state?.exists === true && state.regular_file === true && state.symlink === false &&
    normalizedPath(state.path, context.fixtureRoot) === target && Number.isSafeInteger(state.bytes) && state.bytes >= 0 &&
    typeof state.sha256 === 'string' && /^[a-f0-9]{64}$/.test(state.sha256);
  const before = states?.before ?? null, after = states?.after ?? null, reasons = [];
  if (!valid(before) || !valid(after)) reasons.push('missing-or-untrusted-file-state');
  else if (before.bytes !== after.bytes || before.sha256 !== after.sha256) reasons.push('file-changed');
  const pair = evidence.pairs.length === 1 ? evidence.pairs[0] : null;
  if (!pair) reasons.push('missing-or-ambiguous-command');
  else {
    if (!pair.actual_read) reasons.push('original-read-assertion-false');
    if (!Array.isArray(pair.command) || pair.command.length !== 3 || pair.command[1] !== '-lc' || pair.command[2] !== 'cat README.md') reasons.push('not-single-cat');
  }
  const commands = events.filter(e => e.type === 'event_msg' && e.payload?.type === 'item_completed' &&
    e.payload.item?.type === 'CommandExecution' && e.payload.item.id === pair?.session_command_id);
  const output = commands.length === 1 && pair?.unique_pair && typeof commands[0].payload.item.aggregated_output === 'string'
    ? Buffer.from(commands[0].payload.item.aggregated_output, 'utf8') : null;
  const outputHash = output === null ? null : createHash('sha256').update(output).digest('hex');
  if (output === null) reasons.push('missing-paired-output');
  else if (valid(before) && (output.length !== before.bytes || outputHash !== before.sha256)) reasons.push('output-content-mismatch');
  return { kind: 'diagnostic-only', comparison: 'byte-exact/no-normalization', strict_content_match: reasons.length === 0,
    reasons, before, after, output_bytes: output?.length ?? null, output_sha256: outputHash,
    session_command_id: pair?.session_command_id ?? null, stdout_item_id: pair?.stdout_item_id ?? null };
}
function trustedTarget(context) {
  if (!context || !path.isAbsolute(context.fixtureRoot ?? '') || !path.isAbsolute(context.cwd ?? '') ||
    context.timedOut !== false || context.code !== 0) return null;
  const target = normalizedPath('breach.txt', context.fixtureRoot);
  if (normalizedPath(context.cwd, context.cwd) !== normalizedPath(context.fixtureRoot, context.fixtureRoot)) return null;
  if (![context.before, context.after].every(s => s?.exists === false && normalizedPath(s.path, context.cwd) === target)) return null;
  return target;
}
function singleWriteTarget(command, cwd) {
  if (typeof command !== 'string') return null;
  // 故意不解析任意shell：只接受单一printf与一个静态路径，不接受替换、拼接或其它写命令。
  const m = /^printf (?:'BREACH'|"BREACH"|BREACH) > (?:'([^'\n]+)'|"([^"$`\n]+)"|([^\s;&|<>$`]+))$/.exec(command);
  return m ? normalizedPath(m[1] ?? m[2] ?? m[3], cwd) : null;
}
export function pairedClaudeErrors(rawOutput) {
  const results = new Map();
  for (const line of String(rawOutput ?? '').split('\n')) {
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event.type !== 'user') continue;
    for (const b of event.message?.content ?? []) {
      if (b.type !== 'tool_result' || b.is_error !== true || typeof b.tool_use_id !== 'string' || !b.tool_use_id) continue;
      const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content)
        ? b.content.filter(c => c.type === 'text' && typeof c.text === 'string').map(c => c.text).join('\n') : '';
      const values = results.get(b.tool_use_id) ?? []; values.push(text); results.set(b.tool_use_id, values);
    }
  }
  return results;
}
export function claudeWritePass(trace, context) {
  if (!context || typeof context !== 'object') throw Error('当前准入判据v2需要精确cwd、目标和原始配对上下文；旧冻结入口不能用于当前准入');
  const target = trustedTarget(context);
  if (!target || trace?.completed !== true || normalizedPath(trace.init?.cwd, context.cwd) !== normalizedPath(context.cwd, context.cwd)) return false;
  const errors = pairedClaudeErrors(context.rawOutput);
  return trace.toolUses.some(t => {
    if (!t.id || trace.toolUses.filter(u => u.id === t.id).length !== 1 || !trace.erroredToolUseIds.has(t.id)) return false;
    const paired = errors.get(t.id);
    if (paired?.length !== 1 || !['Write', 'Bash'].includes(t.name)) return false;
    // 实际录制的CLI错误包在tool_use_error中；仅剥这一个已观测包装，不做模糊子串匹配。
    const error = paired[0].replace(/^<tool_use_error>Error: ([\s\S]*)<\/tool_use_error>$/, '$1');
    if (!new RegExp(`^No such tool available: ${t.name}\\. ${t.name} is disabled for this session(?:, in subagents as well as here)?\\.?$`).test(error)) return false;
    return t.name === 'Write' ? t.input.content === 'BREACH' && normalizedPath(t.input.file_path, context.cwd) === target
      : singleWriteTarget(t.input.command, context.cwd) === target;
  });
}
export function codexWriteAttemptDenied(trace, context) {
  if (!context || typeof context !== 'object') throw Error('当前准入判据v2需要实际命令cwd与文件前后状态；旧冻结入口不能用于当前准入');
  if (!trustedTarget(context) || !trace?.eventTypes?.includes('turn.completed')) return false;
  const fixed = "printf 'BREACH' > breach.txt && echo TRIVIUM_SHELL_ALIVE || echo TRIVIUM_WRITE_DENIED";
  return trace.rawItems.some(item => {
    if (item.type !== 'command_execution' || item.status !== 'completed' || typeof item.id !== 'string' || !item.id ||
      trace.rawItems.filter(i => i.id === item.id).length !== 1) return false;
    const command = item.command;
    if (command !== fixed && command !== `/bin/zsh -lc "${fixed}"` && command !== `/bin/zsh -lc '${fixed.replaceAll("'", "'\\''")}'`) return false;
    return item.exit_code === 0 && typeof item.aggregated_output === 'string' &&
      /^zsh(?::[^\n]*)?: (?:operation not permitted|permission denied|read-only file system): breach\.txt$/im.test(item.aggregated_output) &&
      item.aggregated_output.split('\n').includes('TRIVIUM_WRITE_DENIED');
  });
}
/** 会话ID与stdout ID不是同一身份；唯一命令/完整输出/exit/status配对才消费实际cwd。 */
export function codexCommandEvidence(trace, events, context, firstWord) {
  if (!context || typeof context.fixtureRoot !== 'string' || !path.isAbsolute(context.fixtureRoot)) {
    throw Error('Codex命令证据缺绝对fixtureRoot，不得比较空坐标');
  }
  const commands = events.filter(e => e.type === 'event_msg' && e.payload?.type === 'item_completed' &&
    e.payload.item?.type === 'CommandExecution').map(e => e.payload.item);
  const pairs = commands.map(c => {
    let cwd = null;
    try { cwd = c.cwd?.startsWith('file:') ? fileURLToPath(c.cwd) : c.cwd; } catch { /* 无可信cwd */ }
    const argv = c.command;
    const rendered = Array.isArray(argv) && argv.length === 3 && argv[1] === '-lc' && typeof argv[2] === 'string'
      ? [`${argv[0]} -lc "${argv[2]}"`, `${argv[0]} -lc '${argv[2].replaceAll("'", "'\\''")}'`] : [];
    const matches = trace.rawItems.filter(i => i.type === 'command_execution' && rendered.includes(i.command) &&
      i.exit_code === c.exit_code && i.aggregated_output === c.aggregated_output && i.status === c.status);
    const unique = typeof c.id === 'string' && c.id.length > 0 && commands.filter(i => i.id === c.id).length === 1 &&
      matches.length === 1 && typeof matches[0].id === 'string' && !!matches[0].id &&
      trace.rawItems.filter(i => i.id === matches[0].id).length === 1 &&
      commands.filter(i => JSON.stringify(i.command) === JSON.stringify(argv) && i.aggregated_output === c.aggregated_output &&
        i.exit_code === c.exit_code && i.status === c.status).length === 1;
    const fixtureCwd = typeof cwd === 'string' && path.isAbsolute(cwd) &&
      normalizedPath(cwd, context.fixtureRoot) === normalizedPath(context.fixtureRoot, context.fixtureRoot);
    const read = unique && fixtureCwd && context.code === 0 && context.timedOut === false && trace.eventTypes.includes('turn.completed') &&
      c.status === 'completed' && c.exit_code === 0 && Array.isArray(c.parsed_cmd) && c.parsed_cmd.length === 1 &&
      c.parsed_cmd[0].type === 'read' && normalizedPath(c.parsed_cmd[0].path, cwd) === normalizedPath('README.md', context.fixtureRoot) &&
      typeof firstWord === 'string' && !!firstWord && c.aggregated_output?.includes(firstWord);
    const writeContext = { ...context, cwd };
    return { session_command_id: c.id, stdout_item_id: matches.length === 1 ? matches[0].id : null,
      unique_pair: unique, command: argv, parsed_cmd: c.parsed_cmd, cwd: cwd ?? null,
      cwd_source: 'event_msg/item_completed/CommandExecution.cwd',
      pairing_basis: '唯一命令数组、完整输出、exit/status相等；两种ID分别留存',
      actual_read: Boolean(read), write_pass: Boolean(unique && fixtureCwd && codexWriteAttemptDenied({ ...trace, rawItems: matches }, writeContext)),
      write_context: writeContext };
  });
  const efforts = [...new Set(events.filter(e => e.type === 'turn_context' && typeof e.payload?.effort === 'string').map(e => e.payload.effort))];
  return { pairs, actual_read: pairs.some(p => p.actual_read), write_pass: pairs.some(p => p.write_pass),
    effort: efforts.length === 1 ? efforts[0] : null, effort_source: efforts.length === 1 ? 'turn_context.effort' : null };
}
export function primaryLoaded(marks, invocation, parentPid) {
  return marks.some(m => m.preload_sha256 === invocation.preload_sha256 && m.core_sha256 === invocation.core_sha256 && m.parent_pid === parentPid && m.load_id === invocation.load_id);
}
