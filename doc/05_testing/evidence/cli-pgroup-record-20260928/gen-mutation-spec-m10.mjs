// M10 的替代变异（报告 §3）：原 M10 只放开 `terminateRecordedCliGroups` 的第一道门（verdict 过滤），
// 而 `terminateProcessGroup` 在发第一个信号前还要问 `isGone`（judgeCliGroup !== 'alive'），unverifiable 在那里即判「已不在」、
// 一个信号都不发——行为不变，是等价变异，装置判「没红」属实。这里补两条真正改变行为的：
//   M10a 两道门一起放开（verdict 过滤 + isGone 都把 unverifiable 当 alive）⇒ U15（不发信号的格）应红
//   M10b judgeCliGroup 对 started_at: null 直接判 alive ⇒ U13 / U15 应红
// 用法（在仓库根）：node gen-mutation-spec-m10.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const PROTO = 'src/trivium/run-protocol.ts';
const STATUS = 'src/trivium/status.ts';
const UNIT = 'dist/test/test/unit/cli-group-record.test.js';

const m10aFind = [
  "      if (verdict !== 'alive') {\n",
  "        return { side: r.side, pgid: r.pgid, verdict, signals: [], gone: verdict === 'gone', membersLeft: null };\n",
  '      }\n',
  '      const t = await terminateProcessGroup(r.pgid, {\n',
  "        isGone: async () => (await judgeCliGroup(r)) !== 'alive',\n",
].join('');
const m10aReplace = m10aFind
  .replace("      if (verdict !== 'alive') {\n", "      if (verdict !== 'alive' && verdict !== 'unverifiable') {\n")
  .replace("isGone: async () => (await judgeCliGroup(r)) !== 'alive',", "isGone: async () => { const v = await judgeCliGroup(r); return v !== 'alive' && v !== 'unverifiable'; },");

const cases = [
  { id: 'M10a', desc: 'unverifiable 在取消侧当 alive——verdict 过滤与 isGone 两道门一起放开 ⇒ U15（不发信号的格）', file: PROTO,
    find: m10aFind, replace: m10aReplace, expect: UNIT },
  { id: 'M10b', desc: 'judgeCliGroup 对 started_at: null 判 alive ⇒ U13 / U15', file: STATUS,
    find: "  if (r.started_at === null) return 'unverifiable';\n", replace: "  if (r.started_at === null) return 'alive';\n", expect: UNIT },
];
for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
fs.writeFileSync(OUT, JSON.stringify({ targets: [PROTO, STATUS], suites: [UNIT], cases }, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
