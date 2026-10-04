// 生成「单测临时目录收尾」（EV-208）的变异规格（计划 r2 §5.2：M1～M15）。
// 照搬 evidence/fixture-runs-cleanup-20261004/gen-mutation-spec.mjs 的形态：find 串逐条核对在目标文件里恰好出现一次，
// 替换串扫一遍 String.replace 的特殊替换模式，再落盘。每条只有一个期望套件（装置 expect 只收一个）；
// 计划里写「亦红」的另一个套件放进 `also`，只给逐条预跑脚本观察，装置忽略该字段。
// targets 含 test/helpers 下的三个 helper、被守的 hooks.test.ts 与守卫自身——装置不限定 src/。
// M11、M12 改的是被守对象本身：变异后的写法不必能跑（守卫读的是源码），但要能过 esbuild 编译。
// 用法（在仓库根）：node doc/05_testing/evidence/test-scratch-cleanup-20261004/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const SC = 'test/helpers/scratch.ts';
const FX = 'test/helpers/fixture.ts';
const RC = 'test/helpers/run-ctx.ts';
const HK = 'test/unit/hooks.test.ts';
const GD = 'test/unit/scratch-guard.test.ts';
const I_SC = 'dist/test/test/integration/scratch-cleanup.test.js';
const I_FC = 'dist/test/test/integration/fixture-cleanup.test.js';
const U_G = 'dist/test/test/unit/scratch-guard.test.js';

const SC_REG_ASYNC = '  // 与 await 之间没有别的 await：一返回就登记，早于调用方的任何写盘，建到一半抛出也会被收尾\n  register(raw, parent, prefix, who);\n';
const SC_REG_SYNC = '  const raw = mkdtempSync(path.join(os.tmpdir(), prefix));\n  register(raw, parent, prefix, who);\n';
const SC_ARM = "    process.on('exit', removeScratchDirsSync);\n";
const SC_KEEP = "  if (process.env[KEEP_FIXTURES_ENV] === '1') {\n";
const SC_CHMOD = '    chmodSync(dir, 0o700);\n';
const SC_WARN = '      warnLine(`${who.owner}：${who.noun}没删掉，请手工删除 ${dir}（${(e as NodeJS.ErrnoException).code ?? String(e)}）`);\n';
const SC_PARENT = 'path.dirname(dir) !== parent';
const SC_PREFIX = '  if (!PREFIX_RE.test(prefix)) {\n';
const SC_GROUP = String.raw`      const key = ` + '`${e.who.owner}' + String.raw`\u0000` + '${e.who.noun}`;\n';
const SC_PUSH = '  ENTRIES.push({ dir: path.resolve(raw), parent, prefix, who });\n';
const FX_OWNER = "  const raw = await scratchDir('trivium-fx-', FIXTURE_OWNER);\n";
const RC_CALL = '  const root = await scratchDir(prefix);\n';
const HK_CALL = "  const root = await scratchDir('trivium-hook-');\n";
const GD_STRIP = '  return [...stripNonCode(src).matchAll(';
const GD_ENTRY = "  'test/unit/probe-verify.test.ts': 1,\n";

const cases = [
  { id: 'M1', file: SC, expect: I_SC, also: [I_FC], desc: 'scratchDir 不登记', find: SC_REG_ASYNC, replace: '  // （变异：不登记）\n' },
  { id: 'M2', file: SC, expect: I_SC, also: [I_FC], desc: '不挂退出钩子', find: SC_ARM, replace: '    void 0;\n' },
  { id: 'M3', file: SC, expect: I_SC, also: [I_FC], desc: '忽略保留变量', find: SC_KEEP, replace: '  if (false) {\n' },
  { id: 'M4', file: SC, expect: I_SC, also: [I_FC], desc: '权限恢复不先 chmod 自身', find: SC_CHMOD, replace: '    void 0;\n' },
  { id: 'M5', file: SC, expect: I_SC, also: [I_FC], desc: '一个删不掉就中断后面的', find: SC_WARN, replace: SC_WARN + '      break;\n' },
  { id: 'M6', file: SC, expect: I_SC, also: [I_FC], desc: '防呆的父目录核对取反', find: SC_PARENT, replace: 'path.dirname(dir) === parent' },
  { id: 'M7', file: SC, expect: I_SC, desc: '去掉前缀校验', find: SC_PREFIX, replace: '  if (false) {\n' },
  { id: 'M8', file: SC, expect: I_SC, desc: 'scratchDirSync 不登记', find: SC_REG_SYNC, replace: '  const raw = mkdtempSync(path.join(os.tmpdir(), prefix));\n' },
  { id: 'M9', file: FX, expect: I_FC, also: [I_SC], desc: 'makeFixture 不传主语（提示落成缺省 scratchDir / 测试临时目录）', find: FX_OWNER, replace: "  const raw = await scratchDir('trivium-fx-');\n" },
  { id: 'M10', file: SC, expect: I_SC, desc: '保留提示不按调用方分组（合成一行）', find: SC_GROUP, replace: "      const key = 'all';\n" },
  { id: 'M11', file: RC, expect: U_G, desc: 'run-ctx 退回裸 mkdtemp', find: RC_CALL, replace: "  const root = await (await import('node:fs')).promises.mkdtemp(prefix);\n" },
  { id: 'M12', file: HK, expect: U_G, desc: 'hooks.test 的 trivium-hook- 退回裸 mkdtemp', find: HK_CALL, replace: "  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-hook-'));\n" },
  { id: 'M13', file: GD, expect: U_G, desc: '计数不剥离注释与字符串', find: GD_STRIP, replace: '  return [...src.matchAll(' },
  { id: 'M14', file: GD, expect: U_G, desc: '豁免表少一项', find: GD_ENTRY, replace: '' },
  { id: 'M15', file: SC, expect: I_SC, desc: '登记时不解析成绝对路径', find: SC_PUSH, replace: '  ENTRIES.push({ dir: raw, parent, prefix, who });\n' },
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
