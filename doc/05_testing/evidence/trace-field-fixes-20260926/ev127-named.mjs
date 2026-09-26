// 只读：用户点名的几轮与近期主题，逐份列出旧 / 新判据报出的 evidence 未列入 consulted 路径。
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repo = process.cwd();
const R = ['src', 'lib', 'app', 'test', 'tests', 'doc', 'docs', 'packages', 'scripts'].join('|');
const OLD = new RegExp(`\\b((?:${R})\\/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]+)\\b`, 'g');
const NEW = new RegExp(`(?<![A-Za-z0-9_./-])(?:\\.\\/)*((?:${R})\\/[A-Za-z0-9_./-]+\\.[A-Za-z0-9]+)\\b`, 'g');
const topics = ['审批前工作树摘要', '留痕与文案小修', 'EV-125-命令A支持选侧旗标', 'EV-136-glm探活与审查同形'];
const files = execFileSync('find', ['.reviews', '-path', '*/_meta/review-*.json'], { cwd: repo, encoding: 'utf8' })
  .split('\n').filter((f) => topics.some((t) => f.includes(`/${t}/`))).sort();
for (const f of files) {
  const r = JSON.parse(fs.readFileSync(path.join(repo, f), 'utf8'));
  if (!Array.isArray(r.findings)) { console.log(f.split('/').slice(1).join('/'), '（非结构化，不做此项检查）'); continue; }
  const c = new Set(r.consulted ?? []);
  const miss = (re) => {
    const s = new Set();
    for (const x of r.findings) for (const m of String(x.evidence).matchAll(re)) if (!c.has(m[1])) s.add(m[1]);
    return [...s];
  };
  console.log(f.split('/').slice(1).join('/'), 'OLD=', JSON.stringify(miss(OLD)), 'NEW=', JSON.stringify(miss(NEW)));
}
