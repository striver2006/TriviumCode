// 只读：统计本仓归档里各 run-*.json 的 status 分布，列出停在 running 的那些，以及它们在 HEAD 里是否已提交。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = process.argv[2] ?? process.cwd();
const files = execFileSync('find', ['.reviews', '-path', '*/_meta/run-*.json'], { cwd: repo, encoding: 'utf8' })
  .split('\n').filter(Boolean).sort();
const tracked = new Set(
  execFileSync('git', ['-c', 'core.quotepath=off', 'ls-files', '.reviews'], { cwd: repo, encoding: 'utf8' }).split('\n'),
);
const dist = {};
const running = [];
let forgedTrue = 0;
let withGuard = 0;
let verifyStage = 0;
for (const f of files) {
  let m; try { m = JSON.parse(fs.readFileSync(path.join(repo, f), 'utf8')); } catch { dist.unreadable = (dist.unreadable ?? 0) + 1; continue; }
  if (f.includes('/verify/')) verifyStage++;
  if (m.guard) { withGuard++; if (m.guard.forged_role_file === true) forgedTrue++; }
  if (m.run_id === undefined || m.status === undefined) { dist.other = (dist.other ?? 0) + 1; continue; }
  dist[m.status] = (dist[m.status] ?? 0) + 1;
  if (m.status === 'running') running.push(`${f}  tracked=${tracked.has(f)}  finished_at=${m.finished_at}`);
}
// 两个口径（计划双审 r1 CODEX-05）：总数含 verify 阶段；forged_role_file 只在带 guard 段的份数里有
console.log(JSON.stringify({ total_including_verify: files.length, verify_stage: verifyStage, dist, with_guard: withGuard, forged_role_file_true: forgedTrue }, null, 2));
for (const r of running) console.log('  running:', r);
