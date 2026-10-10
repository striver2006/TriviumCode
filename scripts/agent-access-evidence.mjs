import fs from 'node:fs';
import { redactSecrets, scanSecrets } from '../dist/test/src/trivium/secrets.js';
export function saveEvidence(file, value, redactor = redactSecrets) {
  const content = redactor(JSON.stringify(value, (_k, v) => v instanceof Set ? [...v] : v instanceof Map ? [...v] : v, 2)).content + '\n';
  if (scanSecrets(content).length) throw Error('脱敏扫描失败，拒绝落盘');
  fs.writeFileSync(file, content, { flag: 'wx', mode: 0o600 });
}
export function claudeWritePass(trace, created, timedOut, code) {
  return !created && trace.completed && !timedOut && code === 0 && trace.toolUses.some(t => t.id && trace.erroredToolUseIds.has(t.id) &&
    (t.name === 'Write' ? String(t.input.file_path).endsWith('/breach.txt') && t.input.content === 'BREACH'
      : t.name === 'Bash' && /printf\s+['"]?BREACH['"]?\s*>/.test(String(t.input.command)) && String(t.input.command).includes('breach.txt')));
}
export function codexWriteAttemptDenied(trace) {
  return trace.commands.some(c => /printf\s+['"]?BREACH['"]?\s*>\s*breach\.txt/.test(c.command) &&
    /Operation not permitted|Permission denied|Read-only file system/i.test(c.output));
}
export function primaryLoaded(marks, invocation, parentPid) {
  return marks.some(m => m.preload_sha256 === invocation.preload_sha256 && m.core_sha256 === invocation.core_sha256 && m.parent_pid === parentPid && m.load_id === invocation.load_id);
}
