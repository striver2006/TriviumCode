// 生成「清扫输出失实文字」（EV-164）的源码变异规格（计划 r2 §4.2 M1～M11；代码双审 r1 之后新增 M12）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/cancel-wait-cli-admission-20260929/gen-mutation-spec.mjs 的形态。
// 期望套件经真实 bundle 跑：装置每条都跑 build.mjs --with-tests，bundle 随之重建（build.mjs :90）。
// 用法（在仓库根）：node gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CLI = 'src/trivium/cli.ts';
const HOOKS = 'src/trivium/hooks.ts';
const S = { it: 'dist/test/test/integration/scrub-output-text.test.js' };
const NEVER = "process.env['TRIVIUM_MUT_NEVER'] === '1'";
const ALWAYS = "process.env['TRIVIUM_MUT_NEVER'] !== '1'";

const HINT_NEW = "需把该侧 cli 改回 null（到期整删也会保留它）');\n";
const HINT_OLD = "需把该侧 cli 改回 null 或等 run_dir_days 整删');\n";
const HINT_IF = "  if (r.deferredCli.length > 0) say('    CLI 结束后再跑会重判；";
const LOOP = '  for (const x of r.deferredCli) say(`  · 因审查员 CLI 未动：${x.dir}（${x.detail}）`);\n';
const HINT_LINE = "  if (r.deferredCli.length > 0) say('    CLI 结束后再跑会重判；「记录读不懂」不会自愈，需把该侧 cli 改回 null（到期整删也会保留它）');\n";
const MOTIVE_NEW = '整删（那一轮记录里的审查员 CLI 仍在、判不了或读不懂时，到期也不删）。这条命令补那一格。\n';

const cases = [
  { id: 'M1', desc: '提示行改回旧文字（「或等 run_dir_days 整删」）⇒ T1 / T2', file: CLI,
    find: HINT_NEW, replace: HINT_OLD, expect: S.it },
  { id: 'M2', desc: '帮助动机句改回旧文字 ⇒ T5', file: CLI,
    find: MOTIVE_NEW, replace: '整删。这条命令补那一格。\n', expect: S.it },
  { id: 'M3', desc: '提示行触发条件恒假 ⇒ T1 / T2', file: CLI,
    find: HINT_IF, replace: `  if (r.deferredCli.length > 0 && ${NEVER}) say('    CLI 结束后再跑会重判；`, expect: S.it },
  { id: 'M4', desc: '提示行触发条件恒真 ⇒ T3', file: CLI,
    find: HINT_IF, replace: `  if (r.deferredCli.length > 0 || ${ALWAYS}) say('    CLI 结束后再跑会重判；`, expect: S.it },
  { id: 'M5', desc: '提示行挪到第四格逐条之前（位置）⇒ T1 / T2', file: CLI,
    find: LOOP + HINT_LINE, replace: HINT_LINE + LOOP, expect: S.it },
  { id: 'M6', desc: '「侧层已收工」一行改一个字（其余人读行）⇒ T1 / T2 / T3', file: CLI,
    find: '  · 侧层已收工 ${r.settled} 个', replace: '  · 侧层已完工 ${r.settled} 个', expect: S.it },
  { id: 'M7', desc: '「因审查员 CLI 未动」模板改一个字 ⇒ T1 / T2', file: CLI,
    find: '  · 因审查员 CLI 未动：${x.dir}', replace: '  · 因审查员CLI 未动：${x.dir}', expect: S.it },
  { id: 'M8', desc: 'dry-run 的「预览只预测侧层」一行改一个字 ⇒ T2', file: CLI,
    find: "    预览只预测侧层：运行目录层是否有活", replace: "    预览只预测侧层：运行目录层有没有活", expect: S.it },
  { id: 'M9', desc: '帮助 --dry-run 说明行改一个字（其余帮助行）⇒ T5', file: CLI,
    find: '      --dry-run  列出「侧层本会抹哪些运行目录」', replace: '      --dry-run  列出「侧层将会抹哪些运行目录」', expect: S.it },
  { id: 'M10', desc: '帮助动机句拆成两行（行数）⇒ T5', file: CLI,
    find: MOTIVE_NEW, replace: '整删（那一轮记录里的审查员 CLI 仍在、判不了或读不懂时，到期也不删）。\n      这条命令补那一格。\n', expect: S.it },
  { id: 'M11', desc: '--json 的 deferred_cli 键改名 ⇒ T4', file: CLI,
    find: '      deferred_cli: r.deferredCli,\n', replace: '      deferred_clis: r.deferredCli,\n', expect: S.it },
  // 代码双审 r1 CODEX-04：核后不改的会话启动第四格，由新增的 T7 逐字钉住
  { id: 'M12', desc: '会话启动第四格「CLI 结束后下次会话会再判」改一个字 ⇒ T7', file: HOOKS,
    find: '`CLI 结束后下次会话会再判；记录读不懂的不会自愈。首个：', replace: '`CLI 结束后下次会话会重判；记录读不懂的不会自愈。首个：', expect: S.it },
];

for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [CLI, HOOKS], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
