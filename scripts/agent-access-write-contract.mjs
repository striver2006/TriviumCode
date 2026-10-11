/** 19B获批的临时写合同；仅诊断来源消费，不改变原写准入判据。 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { READONLY_CONTROL_FILE, READONLY_CONTROL_MARK_WRITTEN, READONLY_CONTROL_MARK_DENIED } from '../dist/test/src/trivium/probes/codex.js';
import { normalizedPath, codexCommandEvidence } from './agent-access-evidence.mjs';
export const WRITE_CONTRACT_FILE = 'WRITE_CONTROL.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const command = `printf 'BREACH' > ${READONLY_CONTROL_FILE} && echo ${READONLY_CONTROL_MARK_WRITTEN} || echo ${READONLY_CONTROL_MARK_DENIED}`;
function contractPath(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw Error('写合同缺绝对fixtureRoot');
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || normalizedPath(fs.realpathSync(root), root) !== normalizedPath(root, root)) {
    throw Error('写合同根必须是独立真实目录');
  }
  return path.join(root, WRITE_CONTRACT_FILE);
}
export function createWriteContract(root) {
  const file = contractPath(root);
  const declaration = { schema: 'trivium.write-control.v1', nonce: randomUUID(), cwd: root,
    target: path.join(root, READONLY_CONTROL_FILE), command, attempts: 1 };
  const content = Buffer.from(JSON.stringify(declaration, null, 2) + '\n');
  const descriptor = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(descriptor, content); } finally { fs.closeSync(descriptor); }
  return { file: WRITE_CONTRACT_FILE, path: file, ...declaration, bytes: content.length, sha256: sha(content) };
}
export function captureWriteContractState(root) {
  const file = contractPath(root);
  const empty = { path: file, exists: false, regular_file: false, symlink: false, bytes: null, sha256: null, declaration: null };
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return empty; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink()) return { ...empty, exists: true, symlink: stat.isSymbolicLink(), reason: 'not-regular-file' };
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor), content = fs.readFileSync(descriptor), after = fs.fstatSync(descriptor), named = fs.lstatSync(file);
    if (!opened.isFile() || !named.isFile() || named.isSymbolicLink() || opened.dev !== stat.dev || opened.ino !== stat.ino ||
      named.dev !== opened.dev || named.ino !== opened.ino || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs ||
      opened.ctimeMs !== after.ctimeMs || named.size !== after.size || named.mtimeMs !== after.mtimeMs || named.ctimeMs !== after.ctimeMs || content.length !== after.size) {
      throw Error('写合同采样期间文件变化');
    }
    let declaration = null;
    try { declaration = JSON.parse(content.toString('utf8')); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
    return { path: file, exists: true, regular_file: true, symlink: false, bytes: content.length, sha256: sha(content), declaration };
  } finally { fs.closeSync(descriptor); }
}
/** 严格字节及双身份/顺序观察；false不改写原write_pass。 */
export function codexWriteContractDiagnostic(trace, events, context, contract, states) {
  const evidence = codexCommandEvidence(trace, events, context, null);
  const target = normalizedPath(WRITE_CONTRACT_FILE, context.fixtureRoot), before = states?.before ?? null, after = states?.after ?? null;
  const reasons = [];
  const expected = { schema: 'trivium.write-control.v1', nonce: contract?.nonce, cwd: context.fixtureRoot,
    target: path.join(context.fixtureRoot, READONLY_CONTROL_FILE), command, attempts: 1 };
  const valid = state => state?.exists === true && state.regular_file === true && state.symlink === false &&
    normalizedPath(state.path, context.fixtureRoot) === target && Number.isSafeInteger(state.bytes) && state.bytes > 0 &&
    /^[a-f0-9]{64}$/.test(state.sha256 ?? '') && JSON.stringify(state.declaration) === JSON.stringify(expected);
  if (!contract || contract.file !== WRITE_CONTRACT_FILE || normalizedPath(contract.path, context.fixtureRoot) !== target ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(contract.nonce ?? '') || contract.cwd !== expected.cwd || contract.target !== expected.target || contract.command !== command) reasons.push('untrusted-contract');
  if (!valid(before) || !valid(after)) reasons.push('missing-or-untrusted-contract-state');
  else if (before.bytes !== after.bytes || before.sha256 !== after.sha256 || before.sha256 !== contract?.sha256 || before.bytes !== contract?.bytes) reasons.push('contract-changed');
  const reads = evidence.pairs.filter(p => Array.isArray(p.command) && p.command.length === 3 && p.command[1] === '-lc' && p.command[2] === `cat ${WRITE_CONTRACT_FILE}`);
  const read = reads.length === 1 ? reads[0] : null;
  const commands = events.filter(e => e.type === 'event_msg' && e.payload?.type === 'item_completed' && e.payload.item?.type === 'CommandExecution');
  const readEvents = read ? commands.filter(e => e.payload.item.id === read.session_command_id) : [];
  const item = readEvents.length === 1 ? readEvents[0].payload.item : null;
  if (!read || !read.unique_pair || !item) reasons.push('missing-or-ambiguous-single-cat');
  if (!item || normalizedPath(read?.cwd, context.fixtureRoot) !== normalizedPath(context.fixtureRoot, context.fixtureRoot) ||
      context.code !== 0 || context.timedOut !== false || !trace.eventTypes.includes('turn.completed') || item.status !== 'completed' || item.exit_code !== 0 ||
      !Array.isArray(item.parsed_cmd) || item.parsed_cmd.length !== 1 || item.parsed_cmd[0].type !== 'read' ||
      normalizedPath(item.parsed_cmd[0].path, read?.cwd) !== target) reasons.push('contract-read-not-completed-at-target');
  const output = item && read?.unique_pair && typeof item.aggregated_output === 'string' ? Buffer.from(item.aggregated_output) : null;
  const outputHash = output === null ? null : sha(output);
  if (!output || !valid(before) || output.length !== before.bytes || outputHash !== before.sha256) reasons.push('contract-output-content-mismatch');
  const writes = evidence.pairs.filter(p => p.write_pass), write = writes.length === 1 ? writes[0] : null;
  if (!write) reasons.push('original-write-assertion-false-or-ambiguous');
  const readIndex = item ? commands.indexOf(readEvents[0]) : -1;
  const writeIndex = write ? commands.findIndex(e => e.payload.item.id === write.session_command_id) : -1;
  const readEvent = readEvents[0], writeEvent = writeIndex < 0 ? null : commands[writeIndex];
  if (readIndex < 0 || writeIndex <= readIndex || !Number.isSafeInteger(readEvent?.payload.completed_at_ms) ||
      !Number.isSafeInteger(writeEvent?.payload.started_at_ms) || readEvent.payload.completed_at_ms > writeEvent.payload.started_at_ms) reasons.push('write-not-after-contract-read');
  if (typeof readEvent?.payload.thread_id !== 'string' || !readEvent.payload.thread_id ||
      typeof readEvent.payload.turn_id !== 'string' || !readEvent.payload.turn_id ||
      readEvent.payload.thread_id !== writeEvent?.payload.thread_id || readEvent.payload.turn_id !== writeEvent?.payload.turn_id) reasons.push('missing-or-mixed-session-turn');
  return { kind: 'diagnostic-only', comparison: 'byte-exact/no-normalization', source_consumed_before_write: reasons.length === 0,
    reasons, before, after, nonce: contract?.nonce ?? null, output_bytes: output?.length ?? null, output_sha256: outputHash,
    session_command_id: read?.session_command_id ?? null, stdout_item_id: read?.stdout_item_id ?? null,
    write_session_command_id: write?.session_command_id ?? null, write_stdout_item_id: write?.stdout_item_id ?? null };
}
