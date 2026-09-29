// 中断演练（代码双审 r1 CODEX-02）：验证 doc-mutation.mjs 被打断后工作树原样。
//   D1 SIGTERM：跑到变异中途发 SIGTERM ⇒ 处理器按备份还原、日志删除、退 130；
//   D2 SIGKILL：硬杀 ⇒ 日志留存、再跑会拒跑（退 2）；--recover 按备份还原、日志删除。
// 每格前后比对「工作树指纹」：git diff 全文 + 未跟踪文件内容（不含本目录的读数文件）的 sha256。
// 读数写 interrupt-drill.json；任一格不符退 1。
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HERE, ROOT, git } from './lib.mjs';

const SCRIPT = path.join(HERE, 'doc-mutation.mjs');
const JOURNAL = path.join(HERE, 'doc-mutation.journal.json');
const OWN = new Set(['doc-mutation-output.json', 'interrupt-drill.json'].map((f) => path.relative(ROOT, path.join(HERE, f))));

function fingerprint() {
  const h = createHash('sha256');
  h.update(git(['diff']));
  for (const f of git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean).sort()) {
    if (OWN.has(f)) continue;
    h.update(f);
    h.update(readFileSync(path.join(ROOT, f)));
  }
  return h.digest('hex');
}

/** 起跑后等到日志出现（说明已有文件处于变异态），再发信号 */
async function runAndSignal(sig) {
  const child = spawn(process.execPath, [SCRIPT], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const deadline = Date.now() + 60_000;
  let journalSeen = false;
  while (Date.now() < deadline) {
    if (existsSync(JOURNAL)) {
      const j = JSON.parse(readFileSync(JOURNAL, 'utf8'));
      if (j.current?.id?.startsWith('DV-P3')) {
        journalSeen = true;
        break;
      }
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  child.kill(sig);
  const code = await new Promise((r) => child.on('exit', (c, s) => r(c ?? s)));
  return { journalSeen, code, stderr: stderr.trim().split('\n').slice(-2).join(' / ') };
}

const before = fingerprint();
const cells = [];

const d1 = await runAndSignal('SIGTERM');
cells.push({ cell: 'D1 SIGTERM', ...d1, journal_left: existsSync(JOURNAL), restored: fingerprint() === before, ok: d1.journalSeen && d1.code === 130 && !existsSync(JOURNAL) && fingerprint() === before });

const d2 = await runAndSignal('SIGKILL');
const leftAfterKill = existsSync(JOURNAL);
const dirtyAfterKill = fingerprint() !== before;
const refuse = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, encoding: 'utf8' });
const recover = spawnSync(process.execPath, [SCRIPT, '--recover'], { cwd: ROOT, encoding: 'utf8' });
const restored = fingerprint() === before;
cells.push({
  cell: 'D2 SIGKILL + --recover',
  ...d2,
  journal_left_after_kill: leftAfterKill,
  worktree_dirty_after_kill: dirtyAfterKill,
  rerun_refused_exit: refuse.status,
  recover_exit: recover.status,
  recover_stdout: recover.stdout.trim(),
  journal_left: existsSync(JOURNAL),
  restored,
  ok: d2.journalSeen && leftAfterKill && dirtyAfterKill && refuse.status === 2 && recover.status === 0 && !existsSync(JOURNAL) && restored,
});

writeFileSync(path.join(HERE, 'interrupt-drill.json'), `${JSON.stringify({ generated_at: new Date().toISOString(), fingerprint_before: before, cells }, null, 2)}\n`);
for (const c of cells) console.log(`${c.ok ? '✓' : '✗'} ${c.cell}：${JSON.stringify(c)}`);
process.exit(cells.every((c) => c.ok) ? 0 : 1);
