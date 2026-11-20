// 汇总冻结的 2 个负载 × 2 个版本 × (1 次预热 + 5 次计量)，保留每个计划标记。
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const [source, destination] = process.argv.slice(2);
assert.ok(source && destination, '参数为性能采样目录与汇总输出目录');
const names = (await fs.readdir(source)).filter(name => /^(base|e1)-(sparse|dense)-[0-5]\.json$/.test(name)).sort();
assert.equal(names.length, 24, '每组须保留六轮');
const rows = await Promise.all(names.map(async name => JSON.parse(await fs.readFile(path.join(source, name), 'utf8'))));
await fs.mkdir(destination, { recursive: true });
const save = (name, data) => fs.writeFile(path.join(destination, name), data);
await save('性能逐轮原始记录.json.gz', gzipSync(JSON.stringify(rows)));
const critics = ['claude', 'gemini', 'glm'];
const csv = ['版本,负载,轮次,运行号,耗时ms,核心CPU秒,核心峰值KiB,宿主CPU秒,宿主采样峰值KiB,stdout写入字节,元数据写入字节,Claude缺失,Gemini缺失,GLM缺失,Claude可见P95ms,Gemini可见P95ms,GLM可见P95ms'];
for (const r of rows) {
  const sides = critics.map(id => r.sides[id]);
  csv.push([r.variant, r.mode, r.round, r.start.run_id, r.elapsedMs, r.coreCpu, r.corePeakKiB, r.hostCpu.toFixed(3), r.hostPeakKiB,
    sides.reduce((sum,s) => sum+s.bytes, 0), sides.reduce((sum,s) => sum+s.metadata, 0),
    ...sides.map(s => s.missing), ...sides.map(s => s.p95Ms ?? '不可见')].join(','));
}
await save('性能对照.csv', csv.join('\n') + '\n');
const median = values => {
  assert.equal(values.length, 5);
  return values.sort((a,b) => a-b)[2];
};
const summary = {};
for (const mode of ['sparse', 'dense']) {
  const groups = {};
  for (const variant of ['base', 'e1']) {
    const runs = rows.filter(r => r.variant === variant && r.mode === mode && r.round > 0);
    const sides = runs.flatMap(r => Object.values(r.sides));
    const group = {};
    for (const field of ['elapsedMs','hostCpu','coreCpu','hostPeakKiB','corePeakKiB']) {
      group[field] = median(runs.map(r => r[field]));
    }
    group.maxMetaBytes = Math.max(...sides.map(s => s.metadata));
    group.missing = sides.reduce((sum,s) => sum + s.missing, 0);
    group.sampleCount = sides.reduce((sum,s) => sum + s.samples.length, 0);
    group.writeErrors = sides.filter(s => s.bytes !== s.expectedBytes).length;
    group.coreHashes = [...new Set(runs.map(r => r.coreSha))];
    group.vsixHashes = [...new Set(runs.map(r => r.vsixSha))];
    assert.equal(group.coreHashes.length,1);
    assert.equal(group.vsixHashes.length,1);
    if (variant === 'e1') group.medianP95 = Object.fromEntries(critics.map(id => [id, median(runs.map(r => r.sides[id].p95Ms))]));
    groups[variant] = group;
  }
  const { base, e1 } = groups;
  summary[mode] = { groups, pass: {
    time: e1.elapsedMs <= base.elapsedMs * 1.10 + 500,
    cpu: ['hostCpu','coreCpu'].every(k => e1[k] <= base[k] * 1.25 + 0.5),
    rss: ['hostPeakKiB','corePeakKiB'].every(k => e1[k] <= base[k] + 32768),
    writes: base.writeErrors === 0 && e1.writeErrors === 0 && e1.maxMetaBytes <= 16384,
    markers: e1.missing === 0 && Math.max(...Object.values(e1.medianP95)) <= (mode === 'sparse' ? 750 : 1000),
  } };
}
await save('性能判定.json', JSON.stringify(summary, null, 2) + '\n');
assert.ok(Object.values(summary).every(group => Object.values(group.pass).every(Boolean)), '存在未达标组，见性能判定.json');
