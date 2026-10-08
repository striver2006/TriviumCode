// 把本仓本机层的 probe.cli / probe.host 原样拷进夹具本机层（用户 2026-10-08 拍板「照搬本仓探针」）。
// 不拷 probe.auth（由预检自己探活）；夹具 doctor --no-model-calls 产出的其余字段保留。
// 用法：node merge-probe.cjs [--write]；不带 --write 只比对版本、不落盘。
const fs = require('fs');
const YAML = require('/Users/chenzhenbo/Work/TriviumCode/node_modules/yaml');
const SRC = '/Users/chenzhenbo/Work/TriviumCode/.trivium/config.local.yaml';
const SP = '/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/d8a869f3-11f6-4327-a7a1-61c9337e76d1/scratchpad/ac23';
const DST = SP + '/fx/.trivium/config.local.yaml';
if (!DST.startsWith(SP + '/fx/')) throw new Error('refuse: destination outside fixture');

const src = YAML.parse(fs.readFileSync(SRC, 'utf8'));
const dstText = fs.readFileSync(DST, 'utf8');
const dst = YAML.parse(dstText);

const keys = ['claude', 'codex', 'agy', 'zcode'];
for (const k of keys) {
  const a = src.probe.cli[k] || {};
  const b = dst.probe.cli[k] || {};
  console.log(`${k}: repo version=${a.version} probed_at=${a.probed_at} | fixture version=${b.version} probed_at=${b.probed_at}`);
}
const cx = 'codex';
console.log('codex profiles repo=' + JSON.stringify(src.probe.cli[cx].profiles) + ' fixture=' + JSON.stringify(dst.probe.cli[cx].profiles));
console.log('codex kimi levels repo=' + JSON.stringify(src.probe.cli[cx].reasoning_levels.by_profile.kimi) +
  ' fixture=' + JSON.stringify((dst.probe.cli[cx].reasoning_levels || {}).by_profile && dst.probe.cli[cx].reasoning_levels.by_profile.kimi));
console.log('agy models equal=' + (JSON.stringify(src.probe.cli.agy.models) === JSON.stringify(dst.probe.cli.agy.models)));
console.log('host repo=' + JSON.stringify(src.probe.host) + ' fixture=' + JSON.stringify(dst.probe.host));

if (process.argv.includes('--write')) {
  const header = dstText.split('\n').filter(function (l) { return l.startsWith('#'); }).join('\n');
  dst.probe.cli = src.probe.cli;
  dst.probe.host = src.probe.host;
  fs.writeFileSync(DST, header + '\n\n' + YAML.stringify(dst));
  console.log('written: ' + DST);
}
