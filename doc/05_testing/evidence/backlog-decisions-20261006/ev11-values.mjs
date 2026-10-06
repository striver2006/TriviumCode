// 只读：按 2026-10-01 普查（census-pre-d418ce7.json）里报了 layer / kind / severity 越界的那些意见，
// 回到原始结论文件取出越界的原值，按字段计数（EV-11 论证用）。不打印意见正文。
import fs from 'node:fs';
const census = JSON.parse(fs.readFileSync('doc/05_testing/evidence/parse-degrade-20261001/census-pre-d418ce7.json', 'utf8'));
const ENUM = {
  layer: ['requirement', 'plan', 'code', 'rca'],
};
const counts = { layer: {}, kind: {}, severity: {} };
const bySide = {};
let missingFile = 0;
const jsonObjects = (text) => {
  // 取文本里所有顶层 {...} 候选（粗取：从每个 '{' 尝试 JSON.parse 最长可解析段）
  const out = [];
  for (let i = text.indexOf('{'); i >= 0; i = text.indexOf('{', i + 1)) {
    for (let j = text.lastIndexOf('}'); j > i; j = text.lastIndexOf('}', j - 1)) {
      try { out.push(JSON.parse(text.slice(i, j + 1))); i = j; break; } catch { /* 继续缩 */ }
    }
  }
  return out;
};
for (const r of census.rows) {
  const bad = [];
  for (const c of r.candidates ?? []) for (const f of c.findings ?? []) {
    for (const e of f.errors ?? []) {
      const m = /^\/(layer|kind|severity) must be equal to one of/.exec(e);
      if (m) bad.push({ index: f.index, field: m[1] });
    }
  }
  if (bad.length === 0) continue;
  if (!fs.existsSync(r.file)) { missingFile += bad.length; continue; }
  const raw = JSON.parse(fs.readFileSync(r.file, 'utf8'));
  // 结论文件里保存的原始输出字段名不确定：依次找 findings 数组
  let findings = Array.isArray(raw.findings) && raw.findings.length ? raw.findings : null;
  if (!findings) {
    const text = typeof raw.raw === 'string' ? raw.raw : typeof raw.raw_text === 'string' ? raw.raw_text : JSON.stringify(raw);
    const objs = jsonObjects(text).filter((o) => Array.isArray(o?.findings));
    findings = objs[0]?.findings ?? null;
  }
  for (const b of bad) {
    const v = findings?.[b.index]?.[b.field];
    const key = v === undefined ? '（取不到原值）' : JSON.stringify(v);
    counts[b.field][key] = (counts[b.field][key] ?? 0) + 1;
    bySide[r.side] = (bySide[r.side] ?? 0) + 1;
  }
}
console.log(JSON.stringify({ counts, bySide, missingFile }, null, 1));
