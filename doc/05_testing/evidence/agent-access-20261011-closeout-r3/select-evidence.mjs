/** 显式选择本批版本及路线，按给定variant引用，不寻找旧成功或最大编号。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { hash } from '../../../../scripts/agent-access-selection.mjs';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(os.homedir(), '.trivium/evidence/agent-access-20261011-closeout-r3');
const [label, codexVariant, claudeVariant, ...routes] = process.argv.slice(2);
if (!/^[\w-]+$/.test(label ?? '') || !/^[1-9]\d*$/.test(codexVariant ?? '') || !/^[1-9]\d*$/.test(claudeVariant ?? ''))
  throw Error('显式选择标签/两类版本编号无效');
function ref(key, variant, requireComplete = true) {
  const dir = path.join(evidence, 'routes', `${key}-${variant}`);
  const result = JSON.parse(fs.readFileSync(path.join(dir, 'result.json')));
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'fingerprints-after.json')));
  if (requireComplete && (result.completed !== true || after.unchanged !== true)) throw Error(`版本未完成或漂移：${key}-${variant}`);
  return { variant, ...Object.fromEntries(['requested.json', 'result.json', 'fingerprints-after.json'].map(n => [n, hash(path.join(dir, n))])) };
}
const manifest = { schema: 'trivium.access.selection.v1', created_at: new Date().toISOString(),
  versions: { 'static-codex-version': ref('static-codex-version', Number(codexVariant)),
    ...Object.fromEntries(['qwen', 'kimi', 'deepseek'].map(p => [`static-${p}-version`, ref(`static-${p}-version`, Number(claudeVariant))])) }, routes: {} };
for (const pair of routes) {
  const m = /^([a-z0-9]+(?:-[a-z0-9]+)*)=([1-9]\d*)$/.exec(pair);
  if (!m) throw Error(`路线引用无效：${pair}`);
  if (manifest.routes[m[1]]) throw Error(`重复路线引用：${m[1]}`);
  manifest.routes[m[1]] = ref(m[1], Number(m[2]), false); // 显式保存当前失败；不得退回旧成功。
}
const target = path.join(root, `${label}.json`); saveEvidence(target, manifest);
console.log(JSON.stringify({ selection: target, sha256: hash(target), routes: Object.keys(manifest.routes).length }));
