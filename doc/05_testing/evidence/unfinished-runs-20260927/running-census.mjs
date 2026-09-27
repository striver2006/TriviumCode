// 只读：列出本仓归档里 status 为 running 的 run.json，并核对同阶段是否有同 rerun_index 的其它运行、
// 是否有该 run_id 的审查文档、运行目录（~/.trivium/runs/<id>）是否还在。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = process.argv[2] ?? '.reviews';
const runsRoot = path.join(os.homedir(), '.trivium', 'runs');

function* walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const all = [];
for (const f of walk(root)) {
  const m = /\/_meta\/run-(.+)\.json$/.exec(f);
  if (!m) continue;
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  all.push({ f, id: m[1], j });
}

const running = all.filter((x) => x.j.status === 'running');
console.log(`run.json 总数 ${all.length}，running ${running.length}`);
for (const r of running) {
  const stageDir = path.dirname(path.dirname(r.f));
  const docs = fs.readdirSync(stageDir).filter((n) => n.endsWith('.md'));
  const sameIdx = all
    .filter((x) => path.dirname(x.f) === path.dirname(r.f) && x.j.rerun_index === r.j.rerun_index && x.id !== r.id)
    .map((x) => `${x.id}(${x.j.status})`);
  const metaFiles = fs.readdirSync(path.dirname(r.f)).filter((n) => n.includes(r.id));
  const runDir = path.join(runsRoot, r.id);
  let runDirInfo = '运行目录不在';
  if (fs.existsSync(runDir)) {
    const st = path.join(runDir, 'status.json');
    runDirInfo = fs.existsSync(st) ? `status.json phase=${JSON.parse(fs.readFileSync(st, 'utf8')).phase}` : '运行目录在、无 status.json';
    const log = path.join(runDir, 'worker.log');
    if (fs.existsSync(log)) {
      const t = fs.readFileSync(log, 'utf8').trim().split('\n').slice(-3).join(' ⏎ ');
      runDirInfo += ` ｜ worker.log 末 3 行：${t.slice(0, 400)}`;
    }
  }
  console.log('---');
  console.log(path.relative('.', r.f));
  console.log(`  schema=${r.j.schema} rerun=${r.j.rerun_index} started=${r.j.started_at} gate.state=${r.j.gate?.state}`);
  console.log(`  critics 键=${Object.keys(r.j.critics ?? {}).join(',') || '（空）'} selected=${(r.j.critics_selected ?? []).join(',')}`);
  console.log(`  artifacts 条目=${r.j.artifacts.length}；_meta 下带本 id 的文件=${metaFiles.join(', ')}`);
  console.log(`  同阶段同轮次的其它运行=${sameIdx.join(', ') || '无'}`);
  console.log(`  阶段目录 .md 数=${docs.length}`);
  console.log(`  ${runDirInfo}`);
}
