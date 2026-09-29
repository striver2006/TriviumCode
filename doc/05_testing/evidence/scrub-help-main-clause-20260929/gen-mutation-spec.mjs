// 生成「清扫帮助主句失实」（EV-166）的源码变异规格（计划 r2 §4.2 M1～M11）：find 串从现行源码截取，逐条核对恰好出现一次，再落盘。
// 照搬 evidence/scrub-output-text-20260929/gen-mutation-spec.mjs 的形态。
// 期望套件经真实 bundle 跑：装置每条都跑 build.mjs --with-tests，bundle 随之重建。
// 用法（在仓库根）：node gen-mutation-spec.mjs 〈输出路径〉
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CLI = 'src/trivium/cli.ts';
const HOOKS = 'src/trivium/hooks.ts';
const SCRUB = 'src/trivium/scrub.ts';
const S = {
  it: 'dist/test/test/integration/scrub-output-text.test.js',
  parity: 'dist/test/test/contract/orchestrator-logs-parity.test.js',
};

// 新动机句整行（前导 6 空格 + 句子 + 换行），从源码里按行截取，而不是手抄
const cliText = read(CLI);
const MOTIVE_LINE = cliText.split('\n').find((l) => l.includes('到期整删也只在它的会话启动时跑')) + '\n';
const MOTIVE_OLD_LINE =
  '      不再回到那个仓库时，副本会一直躺到 retention.run_dir_days 整删（那一轮记录里的审查员 CLI 仍在、判不了或读不懂时，到期也不删）。这条命令补那一格。\n';
const QUAL = '（记录里的审查员 CLI 仍在、判不了或读不懂时到期也不删）';

const cases = [
  { id: 'M1', desc: '动机句整句换回 48a7e4d 的旧句 ⇒ T5、T8', file: CLI,
    find: MOTIVE_LINE, replace: MOTIVE_OLD_LINE, expect: S.it },
  { id: 'M2', desc: '删掉限定语（括号整段）⇒ T5、T8', file: CLI,
    find: '到期整删也只在它的会话启动时跑' + QUAL + '；', replace: '到期整删也只在它的会话启动时跑；', expect: S.it },
  { id: 'M3', desc: '「没有任何自动清理」→「副本会一直躺到整删」⇒ T5、T8', file: CLI,
    find: '；不再回到那个仓库就没有任何自动清理，', replace: '；不再回到那个仓库，副本会一直躺到整删，', expect: S.it },
  { id: 'M4', desc: '动机句在「；」处折成两行 ⇒ T5、T8（代码双审 r1 CODEX-06：拆行后含「没有任何自动清理」的半行缺前半句要素）', file: CLI,
    find: QUAL + '；不再回到那个仓库', replace: QUAL + '；\n      不再回到那个仓库', expect: S.it },
  { id: 'M5', desc: '「只补抹凭据」→「补那一格」⇒ T5', file: CLI,
    find: '，这条命令只补抹凭据。\n', replace: '，这条命令补那一格。\n', expect: S.it },
  { id: 'M6', desc: 'scrub 一节第二行（冻结）改一个字 ⇒ T5', file: CLI,
    find: '      会话启动清扫只覆盖本项目的桶，别的仓库遗留的副本要等它自己再开一次会话；\n',
    replace: '      会话启动清扫只覆盖本项目的桶，别的仓库留下的副本要等它自己再开一次会话；\n', expect: S.it },
  { id: 'M7', desc: '帮助别处（trivium status 说明行）加「副本会一直躺到整删」⇒ T8（全文扫描）', file: CLI,
    find: '      打印闸门、运行、降级与争议。\n', replace: '      打印闸门、运行、降级与争议。副本会一直躺到整删。\n', expect: S.it },
  { id: 'M8', desc: '第四格之后的提示行（EV-164 句）改一个字 ⇒ T1、T2', file: CLI,
    find: "「记录读不懂」不会自愈，需把该侧 cli 改回 null（到期整删也会保留它）');",
    replace: "「记录读不懂」不会自愈，须把该侧 cli 改回 null（到期整删也会保留它）');", expect: S.it },
  { id: 'M9', desc: '会话启动第四格「CLI 结束后下次会话会再判」改一个字 ⇒ T7', file: HOOKS,
    find: '`CLI 结束后下次会话会再判；记录读不懂的不会自愈。首个：', replace: '`CLI 结束后下次会话会重判；记录读不懂的不会自愈。首个：', expect: S.it },
  { id: 'M10', desc: '动机句句末加长到超过 151（仍一行）⇒ T5、T8（宽度断言）', file: CLI,
    find: '，这条命令只补抹凭据。\n', replace: '，这条命令只补抹凭据，目录一概不删，要腾空间请人工确认那个桶不再有用之后自己删掉。\n', expect: S.it },
  { id: 'M11', desc: 'ORCHESTRATOR_LOG_FILES 去掉 rollout.jsonl ⇒ orchestrator-logs-parity（核对新失败文案）', file: SCRUB,
    find: "'trace.json', 'rollout.jsonl'];", replace: "'trace.json'];", expect: S.parity },
];

if (!MOTIVE_LINE.startsWith('      到期整删也只在它的会话启动时跑')) throw new Error('没截到新动机句');
for (const c of cases) {
  const text = read(c.file);
  const n = text.split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里出现 ${n} 次（应为 1）`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
}
const spec = { targets: [CLI, HOOKS, SCRUB], suites: Object.values(S), cases };
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`${cases.length} 条，锚点全部唯一 → ${OUT}`);
