// 只读：扫描 .reviews 下各主题计划阶段每一轮，按 EV-214 计划 r2 的规则模拟「若一律校验」会不会转红（设计 §6.6 规则 9）。
// 历史 run.json 没有 plan_final_check，被审对象按 snapshot.subject_sha256 与执笔方计划逐份比对认出；认不出时基准退回 rerun_index。
// 「已被接手」= 本阶段 run_id 更晚的某次运行，其被审对象（同法认出）的轮次高于基准。
// 接受集合按 r2 限期望集内：合格编号取 _meta/review-<侧>-<run>.json 的 findings[].id，虚拟编号行一律算（历史上未必有清单）。
// 用法（在仓库根，dist/test 已由 build.mjs --with-tests 生成）：node <本脚本>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const ROOT = process.cwd();
const D = path.join(ROOT, 'dist/test/src/trivium');
const { parseDisposition, isFallbackId } = await import(path.join(D, 'disposition.js'));
const { parseArtifactName } = await import(path.join(D, 'naming.js'));
const { mentionsFindingId } = await import(path.join(D, 'gate.js'));
const AR = path.join(ROOT, '.reviews');
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const isReview = (p) => /^---[\s\S]*?schema:\s*trivium\.review\.v1/.test(fs.readFileSync(p, 'utf8').slice(0, 2000));

const tally = { 通过: 0, 不要求: 0, 缺新一轮计划: 0, 缺编号: 0, 跳过: 0 };
const latestRed = [];
for (const topic of fs.readdirSync(AR).sort()) {
  const pd = path.join(AR, topic, 'plan');
  const md = path.join(pd, '_meta');
  if (!fs.existsSync(md)) continue;
  const files = fs.readdirSync(pd);
  const runs = [];
  for (const rf of fs.readdirSync(md).filter((f) => /^run-.*\.json$/.test(f)).sort()) {
    try { runs.push(JSON.parse(fs.readFileSync(path.join(md, rf), 'utf8'))); } catch { /* 读不出的跳过 */ }
  }
  const plansOf = (driver) => files.map((f) => ({ f, p: parseArtifactName(f) }))
    .filter((c) => c.p && c.p.topic === topic && c.p.role === driver && c.p.kind === null && !isReview(path.join(pd, c.f)));
  const subjectOf = (j) => plansOf(j.driver ?? 'claude').find((c) => sha(path.join(pd, c.f)) === j.snapshot?.subject_sha256)?.p.rerunIndex ?? null;
  const lastWithDisp = [...runs].reverse().find((j) => files.some((f) => {
    const p = parseArtifactName(f);
    return p && p.kind === 'revised' && p.role === (j.driver ?? 'claude') && p.rerunIndex === j.rerun_index;
  }));
  for (const j of runs) {
    const driver = j.driver ?? 'claude';
    const N = j.rerun_index;
    const disp = files.find((f) => { const p = parseArtifactName(f); return p && p.topic === topic && p.role === driver && p.kind === 'revised' && p.rerunIndex === N; });
    if (!disp) { tally.跳过++; console.log([topic, j.run_id, `r${N}`, '无裁决件', j.status].join(' | ')); continue; }
    const pdisp = parseDisposition(fs.readFileSync(path.join(pd, disp), 'utf8'));
    if (pdisp.frontMatter?.run_id && pdisp.frontMatter.run_id !== j.run_id) { tally.跳过++; console.log([topic, j.run_id, `r${N}`, '裁决件属别的 run'].join(' | ')); continue; }
    const expected = new Set();
    for (const c of j.critics_selected ?? Object.keys(j.critics ?? {})) {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(md, `review-${c}-${j.run_id}.json`), 'utf8'));
        for (const x of r.findings ?? []) expected.add(x.id);
      } catch { /* 回退侧或缺失 */ }
      for (const id of j.critics?.[c]?.findings_degraded ?? []) expected.add(id);
    }
    const acc = [...new Set(pdisp.rows.filter((r) => r.disposal === '接受' && (isFallbackId(r.id) || expected.has(r.id))).map((r) => r.id))].sort();
    const subj = subjectOf(j);
    const base = subj ?? N;
    const later = runs.filter((k) => k.run_id > j.run_id).map(subjectOf).filter((s) => typeof s === 'number');
    const superseded = later.some((s) => s > base);
    const cands = plansOf(driver).filter((c) => c.p.rerunIndex > base);
    let verdict;
    if (acc.length === 0) { verdict = '不要求'; tally.不要求++; }
    else if (cands.length === 0) { verdict = `缺新一轮计划（需 > r${base}）`; tally.缺新一轮计划++; }
    else {
      const sorted = [...cands].sort((a, b) => (superseded ? a.p.rerunIndex - b.p.rerunIndex : b.p.rerunIndex - a.p.rerunIndex) || b.f.localeCompare(a.f));
      const text = fs.readFileSync(path.join(pd, sorted[0].f), 'utf8');
      const miss = acc.filter((id) => !mentionsFindingId(text, id));
      if (miss.length) { verdict = `缺编号 ${miss.join(',')}（核 ${sorted[0].f.replace(topic, 'T')}）`; tally.缺编号++; }
      else { verdict = '通过'; tally.通过++; }
    }
    const isLatest = j === lastWithDisp;
    if (isLatest && /^缺/.test(verdict)) latestRed.push(`${topic}（${j.run_id}）`);
    console.log([topic, j.run_id, `r${N}`, `接受${acc.length}`, `基准 r${base}${subj === null ? '（认不出被审对象，退回 rerun_index）' : ''}`, superseded ? '已被接手' : '在用', verdict, isLatest ? '最新一轮' : ''].join(' | '));
  }
}
console.log('\n汇总（按轮）：' + JSON.stringify(tally));
console.log(`最新一轮会转红的主题 ${latestRed.length} 个：${latestRed.join('、')}`);
