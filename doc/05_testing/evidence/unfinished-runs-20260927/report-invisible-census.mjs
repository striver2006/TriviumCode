// 只读：对本仓归档逐主题跑 buildTopicReport（仓库构建产物 dist/test），
// 列出时间线里不出现的运行（归档里有 run-*.json、但 report 的轮次没选中它）。
// 用法：node report-invisible-census.mjs <仓库根>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = path.resolve(process.argv[2] ?? '.');
const archiveRoot = path.join(repo, '.reviews');
const { buildTopicReport } = await import(pathToFileURL(path.join(repo, 'dist/test/src/trivium/report.js')).href);

// report 的告警会走 stderr；这里只要数据
const origErr = console.error;
console.error = () => {};

const STAGES = ['plan', 'code', 'bug'];
const rows = [];
let totalRuns = 0;
let topics = 0;
for (const topic of fs.readdirSync(archiveRoot).sort()) {
  const tdir = path.join(archiveRoot, topic);
  if (topic.startsWith('.') || !fs.statSync(tdir).isDirectory()) continue;
  topics++;
  const rep = await buildTopicReport({ archiveRoot, topic });
  const shown = new Set(rep.rounds.map((r) => `${r.stage}/${r.runId}`));
  for (const stage of STAGES) {
    const md = path.join(tdir, stage, '_meta');
    if (!fs.existsSync(md)) continue;
    const metas = fs.readdirSync(md).filter((f) => /^run-.+\.json$/.test(f)).sort();
    const parsed = metas.map((f) => {
      const id = f.slice(4, -5);
      try { return { id, j: JSON.parse(fs.readFileSync(path.join(md, f), 'utf8')) }; } catch { return { id, j: null }; }
    });
    for (const { id, j } of parsed) {
      totalRuns++;
      if (shown.has(`${stage}/${id}`)) continue;
      if (!j) { rows.push({ topic, stage, id, kind: '不可解析' }); continue; }
      const sideStates = Object.entries(j.critics ?? {}).map(([c, v]) => `${c}:${v.status}`).join(',');
      const hasDoc = (j.artifacts ?? []).some((a) => /\.md$/.test(a.path) && !a.path.includes('/_meta/') && /-(gemini|glm|codex|claude)\.md$/.test(a.path));
      const failedJson = (j.artifacts ?? []).filter((a) => /\.failed\.json$/.test(a.path)).length;
      const sameIdxShown = parsed.some((p) => p.j && p.id !== id && p.j.rerun_index === j.rerun_index && shown.has(`${stage}/${p.id}`));
      let kind;
      if (j.status === 'running') kind = 'running（未收尾）';
      else if (j.status === 'cancelled') kind = 'cancelled';
      else if (j.gate?.state === 'skipped_doc_only') kind = '纯文档跳过';
      else if (j.status === 'failed' && failedJson > 0 && !hasDoc) kind = '入选侧全部失败';
      else kind = `其它（status=${j.status} gate=${j.gate?.state} hasDoc=${hasDoc}）`;
      rows.push({ topic, stage, id, rerun: j.rerun_index, status: j.status, kind, sideStates, sameIdxShown });
    }
  }
}
console.error = origErr;

console.log(`主题 ${topics}；审查阶段 run.json ${totalRuns}；时间线不出现的 ${rows.length}`);
const byKind = {};
for (const r of rows) byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
console.log('按类：', JSON.stringify(byKind));
for (const r of rows) {
  console.log(`- ${r.topic} ${r.stage} ${r.id} r${r.rerun ?? '?'} ${r.kind} ｜ 同轮次号另有进时间线的运行=${r.sameIdxShown ? '是' : '否'} ｜ ${r.sideStates ?? ''}`);
}
