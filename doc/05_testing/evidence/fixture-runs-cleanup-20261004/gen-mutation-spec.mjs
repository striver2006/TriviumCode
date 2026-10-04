// 生成「夹具运行目录收尾」（EV-207）的变异规格（计划 r2 §2.6：selftest.ts 的 M1～M7、test/helpers/fixture.ts 的 H1～H7；代码双审后补 H8）。
// 照搬 evidence/temp-index-cleanup-20261004/gen-mutation-spec.mjs 的形态：find 串逐条核对在目标文件里恰好出现一次，
// 替换串扫一遍 String.replace 的特殊替换模式，再落盘。每条只有一个期望套件（装置 expect 只收一个）。
// 装置的 targets 不限定 src/（计划双审 GLM-02）：test/helpers/fixture.ts 的产物是 dist/test/test/helpers/fixture.js。
// H5「登记挪到建夹具写盘之后」要删一行、加一行，装置每条只做一次替换，所以 find 取从登记那一行到 initFixtureRepo 那一行的整段
// （从源码里截出来，不手抄），replace 是同一段去掉登记、在末尾补登记。
// 用法（在仓库根）：node doc/05_testing/evidence/fixture-runs-cleanup-20261004/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const ST = 'src/trivium/selftest.ts';
const FX = 'test/helpers/fixture.ts';
const U_TIC = 'dist/test/test/unit/temp-index-cleanup.test.js';
const I_ST = 'dist/test/test/integration/selftest.test.js';
const I_FC = 'dist/test/test/integration/fixture-cleanup.test.js';

const ST_RUNS = "  const runs = path.join(base, 'runs');\n";
const ST_FINISH = '    const left = keep || dir === null ? null : await tryRemoveTempDir(dir, []);\n';
const ST_TEXT = "    '自检只往里写了夹具仓库（含本次自检的审查留痕 .reviews/）与本次自检的运行目录（worker 日志、交接文件与状态文件），' +\n";
const ST_KEPT_LINE = '      L.push(`  本次自检的运行目录（worker 日志、交接文件与状态文件）在 ${r.runRoot}${tail}`);\n';
const ST_KEEP = '    const keep = !ok || opts.keepFixture === true;\n';
const ST_MADE = '  made.dir = raw;\n';
const ST_TAIL = '      const tail = parent === path.dirname(r.fixtureRoot) ?';

const FX_PUSH = '  FIXTURE_BASES.push(raw);\n';
const FX_CHMOD = '    chmodSync(dir, 0o700);\n';
const FX_KEEP = "  if (process.env[KEEP_FIXTURES_ENV] === '1') {\n";
const FX_WARN = '      warnLine(`makeFixture：夹具目录没删掉，请手工删除 ${dir}（${(e as NodeJS.ErrnoException).code ?? String(e)}）`);\n';
const FX_RUNROOT = '      `  run_root: ${runRoot}`,\n';
const FX_READDIR = '    entries = readdirSync(dir, { withFileTypes: true });\n  } catch {\n    return;\n  }\n';
const FX_INIT = '  await initFixtureRepo(root);\n';

const fx = read(FX);
const h5From = fx.indexOf(FX_PUSH);
const h5To = fx.indexOf(FX_INIT) + FX_INIT.length;
if (h5From < 0 || h5To < FX_INIT.length || h5To <= h5From) throw new Error('H5 的段落锚点没找到');
const H5_FIND = fx.slice(h5From, h5To);
const H5_REPLACE = H5_FIND.slice(FX_PUSH.length) + FX_PUSH;

const cases = [
  { id: 'M1', file: ST, expect: I_ST, desc: '自检运行根改回夹具仓库的兄弟目录', find: ST_RUNS, replace: '  const runs = `${base}-runs`;\n' },
  { id: 'M2', file: ST, expect: I_ST, desc: 'finish 删夹具仓库而非父目录', find: ST_FINISH, replace: ST_FINISH.replace('tryRemoveTempDir(dir, [])', 'tryRemoveTempDir(root, [])') },
  { id: 'M3', file: ST, expect: U_TIC, desc: '残留提示不提运行目录', find: ST_TEXT, replace: "    '自检只往里写了夹具仓库（含本次自检的审查留痕 .reviews/），' +\n" },
  { id: 'M4', file: ST, expect: U_TIC, desc: '保留时不给运行目录那一行', find: ST_KEPT_LINE, replace: '' },
  { id: 'M5', file: ST, expect: I_ST, desc: '失败时不保留（keep 去掉 !ok）', find: ST_KEEP, replace: '    const keep = opts.keepFixture === true;\n' },
  { id: 'M6', file: ST, expect: U_TIC, desc: 'made.dir 记成夹具仓库而非 mkdtemp 父目录', find: ST_MADE, replace: "  made.dir = path.join(raw, 'repo');\n" },
  { id: 'M7', file: ST, expect: U_TIC, desc: '保留提示「两者同在」不判同父', find: ST_TAIL, replace: '      const tail = true ?' },
  { id: 'H1', file: FX, expect: I_FC, desc: 'makeFixture 不登记父目录', find: FX_PUSH, replace: '' },
  { id: 'H2', file: FX, expect: I_FC, desc: '权限恢复不先 chmod 自身', find: FX_CHMOD, replace: '    void 0;\n' },
  { id: 'H3', file: FX, expect: I_FC, desc: '忽略保留变量', find: FX_KEEP, replace: '  if (false) {\n' },
  { id: 'H4', file: FX, expect: I_FC, desc: '删不掉不打提示', find: FX_WARN, replace: '' },
  { id: 'H5', file: FX, expect: I_FC, desc: '登记挪到建夹具写盘之后（建到一半抛出时漏收）', find: H5_FIND, replace: H5_REPLACE },
  { id: 'H6', file: FX, expect: I_FC, desc: '配置 run_root 改回兄弟目录（返回字段不变）', find: FX_RUNROOT, replace: '      `  run_root: ${root}-runs`,\n' },
  { id: 'H7', file: FX, expect: I_FC, desc: '权限恢复遍历读目录失败不吞', find: FX_READDIR, replace: FX_READDIR.replace('  } catch {\n    return;\n  }\n', '  } catch (e) {\n    throw e;\n  }\n') },
  // 代码双审 GLM-03 补的一条：一个删不掉就中断整批（与把兜底挪到循环外等价）
  { id: 'H8', file: FX, expect: I_FC, desc: '一个父目录删不掉就中断后面的', find: FX_WARN, replace: FX_WARN + '      break;\n' },
];

for (const c of cases) {
  const n = read(c.file).split(c.find).length - 1;
  if (n !== 1) throw new Error(`${c.id} 的 find 在 ${c.file} 里命中 ${n} 处`);
  if (c.find === c.replace) throw new Error(`${c.id} 的 replace 与 find 相同`);
  if (/\$[$&`'0-9<]/.test(c.replace)) throw new Error(`${c.id} 的 replace 含特殊替换模式`);
}
const spec = {
  targets: [...new Set(cases.map((c) => c.file))],
  suites: [...new Set(cases.map((c) => c.expect))],
  cases,
};
fs.writeFileSync(OUT, JSON.stringify(spec, null, 2) + '\n');
console.log(`已写 ${cases.length} 条 ⇒ ${OUT}`);
