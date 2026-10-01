// 生成「两个空配置项收口」（EV-30 ① / EV-15）的源码变异规格（计划 r2 §6）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/unreadable-run-exit-20261001/gen-mutation-spec.mjs 的形态。每条只指定一个期望套件（装置每条只收一个套件）。
// 用法（在仓库根）：node doc/05_testing/evidence/config-dead-keys-20261001/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CONFIG = 'src/trivium/config.ts';
const PREFLIGHT = 'src/trivium/preflight.ts';
const DOCTOR = 'src/trivium/doctor.ts';
const S = {
  consumers: 'dist/test/test/unit/config-consumers.test.js',
  preflight: 'dist/test/test/unit/preflight.test.js',
};

/** 从源码截锚点：取包含 needle 的那一整行（含换行），并要求该行在文件里唯一 */
function lineOf(file, needle) {
  const lines = read(file).split('\n');
  const hits = lines.filter((l) => l.includes(needle));
  if (hits.length !== 1) throw new Error(`${file} 里含「${needle}」的行有 ${hits.length} 行（应为 1）`);
  return hits[0] + '\n';
}
const sub = (s, a, b) => {
  if (!s.includes(a)) throw new Error(`锚点里没有「${a}」`);
  return s.replace(a, b);
};

const WALK_PUSH = lineOf(CONFIG, "if (tail.length === 0) found.push([...trail, k].join('.'));");
const STAR = lineOf(CONFIG, "const keys = head === '*' ? Object.keys(obj).sort() : [head];");
const NOTICE_KEYS = lineOf(CONFIG, '`配置里有已废弃的键：${keys.join(\'、\')}。` +');
const DEF_GATE = lineOf(CONFIG, '// max_check_retries 已删除（EV-30 ①）：见 DEPRECATED_CONFIG_KEYS');
const DEF_AGY = lineOf(CONFIG, '// readonly_commands 已删除（EV-15）：见 DEPRECATED_CONFIG_KEYS');
const PF_PUSH = lineOf(PREFLIGHT, 'if (d) checks.push(d);');
const PF_WARN = lineOf(PREFLIGHT, "return { name: '已废弃配置键', ok: true, warn: true, detail: `⚠️ ${notice}` };");
const DR_PUSH = lineOf(DOCTOR, 'if (deprecatedNotice !== null) warnings.push(deprecatedNotice);');

const cases = [
  { id: 'M1', desc: 'deprecatedConfigKeysIn 什么都不报（判定失效）', file: CONFIG, find: WALK_PUSH,
    replace: sub(WALK_PUSH, "found.push([...trail, k].join('.'))", 'void 0'), expect: S.consumers },
  { id: 'M2', desc: "'*' 不展开（agents 一支不判）", file: CONFIG, find: STAR,
    replace: '    const keys = [head];\n', expect: S.consumers },
  { id: 'M3', desc: 'preflight 不推「已废弃配置键」', file: PREFLIGHT, find: PF_PUSH,
    replace: sub(PF_PUSH, 'if (d) checks.push(d);', 'void d;'), expect: S.preflight },
  { id: 'M4', desc: 'doctor 不推已废弃键告警', file: DOCTOR, find: DR_PUSH,
    replace: sub(DR_PUSH, 'warnings.push(deprecatedNotice)', 'void 0'), expect: S.preflight },
  { id: 'M5', desc: 'preflight 该项去掉 warn（不进 warnings）', file: PREFLIGHT, find: PF_WARN,
    replace: sub(PF_WARN, ' warn: true,', ''), expect: S.preflight },
  { id: 'M6', desc: 'defaultConfig 加回 max_check_retries', file: CONFIG, find: DEF_GATE,
    replace: '      max_check_retries: 3,\n', expect: S.consumers },
  { id: 'M7', desc: 'defaultConfig 加回 readonly_commands', file: CONFIG, find: DEF_AGY,
    replace: "        readonly_commands: ['git log'],\n", expect: S.consumers },
  { id: 'M8', desc: '正文改回静态列举两键', file: CONFIG, find: NOTICE_KEYS,
    replace: sub(NOTICE_KEYS, "${keys.join('、')}", 'gate.max_check_retries、agents.gemini.readonly_commands'), expect: S.consumers },
  { id: 'M9', desc: "'*' 展开不排序", file: CONFIG, find: STAR,
    replace: sub(STAR, 'Object.keys(obj).sort()', 'Object.keys(obj)'), expect: S.consumers },
  { id: 'M10', desc: '正文自带 ⚠️（doctor 人读会双重渲染）', file: CONFIG, find: NOTICE_KEYS,
    replace: sub(NOTICE_KEYS, '`配置里有', '`⚠️ 配置里有'), expect: S.consumers },
];

// 每条 find 在目标文件中恰好一处（装置闸 7 同口径，这里先核一遍）
for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里命中 ${n} 处`);
}
const spec = {
  targets: [...new Set(cases.map((c) => c.file))],
  suites: [...new Set(cases.map((c) => c.expect))],
  cases,
};
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，写入 ${OUT}`);
