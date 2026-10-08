// AC-23 验收留痕收集：夹具与 scratchpad 输出 → doc/05_testing/evidence/m11-ac23-acceptance-20261008/
// 文件名去掉角色后缀；审查文档只收 front-matter；ps 只收 codex exec / 本次运行派生的 agy 行（剔除无关的 agy hub 进程）。
// 用法：node collect.cjs <名称> <critic>…（可多对），或 node collect.cjs --static 收夹具脚本与负对照。
const fs = require('fs');
const path = require('path');
const SP = '/private/tmp/claude-501/-Users-chenzhenbo-Work-TriviumCode/d8a869f3-11f6-4327-a7a1-61c9337e76d1/scratchpad/ac23';
const FX = SP + '/fx';
const DEST = '/Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-ac23-acceptance-20261008';
fs.mkdirSync(DEST, { recursive: true });

function put(name, text) {
  const p = path.join(DEST, name);
  if (fs.existsSync(p)) throw new Error('refuse to overwrite ' + p);
  fs.writeFileSync(p, text);
  console.log('wrote ' + name + ' (' + Buffer.byteLength(text) + ' B)');
}

const args = process.argv.slice(2);
if (args[0] === '--static') {
  put('build-fixture.sh', fs.readFileSync(SP + '/build-fixture.sh', 'utf8'));
  put('merge-probe.cjs', fs.readFileSync(SP + '/merge-probe.cjs', 'utf8'));
  put('neg.sh', fs.readFileSync(SP + '/neg.sh', 'utf8'));
  put('run-one.sh', fs.readFileSync(SP + '/run-one.sh', 'utf8'));
  put('collect.cjs', fs.readFileSync(__filename, 'utf8'));
  put('plan-subject.md', fs.readFileSync(SP + '/plan-template.md', 'utf8'));
  put('fixture-config.yaml', fs.readFileSync(FX + '/.trivium/config.yaml', 'utf8'));
  put('negative-controls-before-probe-merge.txt', fs.readFileSync(SP + '/negative-controls-before-probe-merge.txt', 'utf8'));
  put('negative-controls.txt', fs.readFileSync(SP + '/negative-controls.txt', 'utf8'));
  put('doctor-no-model-calls.txt', fs.readFileSync(SP + '/doctor.txt', 'utf8'));
  process.exit(0);
}

const name = args[0];
const critic = args[1];
const O = SP + '/out/' + name;
const topic = 'ac23-' + name;
const runId = fs.readFileSync(O + '/run_id.txt', 'utf8').trim();
const stageDir = FX + '/.reviews/' + topic + '/plan';

put(name + '-flags.txt', fs.readFileSync(O + '/flags.txt', 'utf8'));
put(name + '-preflight.json', fs.readFileSync(O + '/preflight.json', 'utf8'));
put(name + '-start.json', fs.readFileSync(O + '/start.json', 'utf8'));
const waits = fs.readdirSync(O).filter(function (f) { return /^wait-\d+\.json$/.test(f); })
  .sort(function (a, b) { return Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]); });
put(name + '-wait-final.json', fs.readFileSync(O + '/' + waits[waits.length - 1], 'utf8'));
put(name + '-run.json', fs.readFileSync(stageDir + '/_meta/run-' + runId + '.json', 'utf8'));

const docs = fs.readdirSync(stageDir).filter(function (f) { return f.endsWith('-' + critic + '.md'); });
if (docs.length !== 1) throw new Error('expected exactly one review doc for ' + critic + ', got ' + JSON.stringify(docs));
const doc = fs.readFileSync(stageDir + '/' + docs[0], 'utf8');
const m = doc.match(/^---\n[\s\S]*?\n---\n/);
if (!m) throw new Error('no front-matter in ' + docs[0]);
put(name + '-review-front-matter.md', '<!-- 源文件：' + docs[0].replace('-' + critic + '.md', '-〈' + critic + '〉.md') + '，只收 front-matter -->\n' + m[0]);

put(name + '-report.txt', fs.readFileSync(O + '/report.txt', 'utf8'));

let ps = '';
try { ps = fs.readFileSync(O + '/ps.txt', 'utf8'); } catch (e) { ps = ''; }
// agy 的 -p 把整份任务书放进 argv，ps 输出被拆成多行：只留启动行与带 --model / --effort 的尾行。
const seen = new Set();
const kept = [];
for (const l of ps.split('\n')) {
  if (!l) continue;
  if (/--hub\b/.test(l)) continue;                // 无关的 agy hub 常驻进程（带本机 csrf_token）
  if (!/codex exec|\/agy -p|--model |--effort /.test(l)) continue;
  const key = l.replace(/^\d\d:\d\d:\d\dZ /, '');
  if (seen.has(key)) continue;
  seen.add(key);
  kept.push(l);
}
put(name + '-ps.txt', '# 审查进行中每 3 秒采样、按内容去重；已剔除与本次运行无关的 agy hub 常驻进程；\n' +
  '# agy 的任务书正文（argv 中的多行 -p 值）不收，只留启动行与模型 / 思考等级旗标所在行\n' + kept.join('\n') + '\n');
