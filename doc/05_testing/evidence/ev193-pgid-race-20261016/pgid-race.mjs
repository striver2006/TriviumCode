// EV-193 假设验证（并发版）：一个进程不停派生 detached 的带标记 sh，另一个进程同时不停跑 ps。
// 标记经环境变量交给采样进程（不进采样进程自己的 argv），统计「argv 带标记但 pid≠pgid」的行，
// 并记下那一行的 pgid 是否等于派生方的 pid / 派生方所在的组（I6 里派生方是 detached 的 worker，两者相同）。
import { spawn, execFileSync } from 'node:child_process';

const role = process.argv[2];
if (role === 'sampler') {
  const MARK = process.env.EV193_MARK;
  const spawnerPid = Number(process.env.EV193_SPAWNER);
  const until = Date.now() + Number(process.env.EV193_MS);
  const spawnerPgid = Number(process.env.EV193_SPAWNER_PGID);
  let samples = 0, leaderRows = 0, mismatched = 0, pgidIsSpawner = 0, pgidIsSpawnerGroup = 0;
  const examples = [];
  while (Date.now() < until) {
    const out = execFileSync('/bin/ps', ['-axo', 'pid=,pgid=,command='], { encoding: 'utf8' });
    samples++;
    for (const line of out.split('\n')) {
      const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (!m || !m[3].includes(MARK)) continue;
      if (m[1] === m[2]) { leaderRows++; continue; }
      mismatched++;
      if (+m[2] === spawnerPid) pgidIsSpawner++;
      if (+m[2] === spawnerPgid) pgidIsSpawnerGroup++;
      if (examples.length < 5) examples.push({ pid: +m[1], pgid: +m[2] });
    }
  }
  console.log(JSON.stringify({ samples, leaderRows, mismatched, pgidIsSpawner, pgidIsSpawnerGroup, spawnerPid, spawnerPgid, examples }, null, 1));
} else {
  const MARK = `ev193-race2-${process.pid}`;
  const MS = Number(process.argv[2] ?? 20000);
  const sampler = spawn(process.execPath, [new URL(import.meta.url).pathname, 'sampler'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, EV193_MARK: MARK, EV193_SPAWNER: String(process.pid), EV193_MS: String(MS),
      EV193_SPAWNER_PGID: execFileSync('/bin/ps', ['-o', 'pgid=', '-p', String(process.pid)], { encoding: 'utf8' }).trim() },
  });
  const children = [];
  const until = Date.now() + MS - 500;
  let n = 0;
  const tick = () => {
    if (Date.now() >= until) return;
    const c = spawn('/bin/sh', ['-c', 'sleep 1; : "$0"', `${MARK}:${n++}`], { detached: true, stdio: 'ignore' });
    children.push(c);
    setTimeout(tick, 5);
  };
  tick();
  sampler.on('exit', () => {
    for (const c of children) { try { process.kill(-c.pid, 'SIGKILL'); } catch {} }
    console.log(JSON.stringify({ spawned: n }));
  });
}
