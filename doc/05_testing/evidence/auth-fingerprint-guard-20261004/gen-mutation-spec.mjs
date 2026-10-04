// 生成「探活指纹读盘兜底」（EV-202）的源码变异规格（计划 r2 §4 的 M1～M12，按实际源码定稿）。
// 照搬 evidence/codex-probe-cleanup-20261003/gen-mutation-spec.mjs 的形态：find 串逐条核对在目标文件里恰好出现一次，
// 替换串扫一遍 String.replace 的特殊替换模式，再落盘。每条只指定一个期望套件（装置每条只收一个套件）。
// 与计划的出入：M6 按实际代码拆成两条——M6a 构造抛错支的退出码、M6b 失败支（probe 抛错与返回失败共用）的退出码。
// M9（⑧ 改回内联）与 M11（去掉 TRIVIUM_DEBUG 打印）是计划里预计存活的两条，照样放进规格，如实记读数。
// 用法（在仓库根）：node doc/05_testing/evidence/auth-fingerprint-guard-20261004/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PF = 'src/trivium/preflight.ts';
const SUITE = 'dist/test/test/unit/preflight-auth-guard.test.js'; // G1～G9、R1～R3

const FP_TRY = '  try {\n    fp = await auth.fingerprint();\n  } catch (e) {\n    fpError = thrownText(e);\n  }\n';
const CACHE_BRANCH = '  } else if (!opts.refreshAuth) {\n';
const CACHE_COND = '    cache: r.ok && fpError === null\n';
const NOTE = "  const note = fpError === null ? '' : `；⚠️ 指纹读不了：${fpError}，本次未用缓存、也不写缓存`;\n";
const PROBE_TRY =
  '  try {\n    r = await auth.probe();\n  } catch (e) {\n    r = { ok: false, detail: `探活内部失败：${thrownText(e)}` };\n  }\n';
const CTOR_FAIL =
  '      result: { name, ok: false, exitCode: EXIT.ENV, detail: `探活内部失败：${thrownText(e)}` },\n';
const CTOR_CATCH = '  } catch (e) {\n    return {\n      critic,\n' + CTOR_FAIL;
const FAIL_BRANCH = '      : { name, ok: false, exitCode: EXIT.ENV, detail: r.detail + note },\n';
const OK_BRANCH = '      ? { name, ok: true, detail: r.detail + note }\n';
const TILDE = '  return tildeHome(e instanceof Error ? e.message : String(e));\n';
const DEBUG = "  if (process.env['TRIVIUM_DEBUG']) console.error(e);\n";
const WIRE = '      const probes = await probeAuthAll(ctx, selected, realAdapters(), opts);\n';
const NO_ENTRY = "  if (!entry) return { valid: false, reason: '无缓存' };\n";

const cases = [
  { id: 'M1', desc: '指纹调用去掉 try（裸 await）', find: FP_TRY, replace: '  fp = await auth.fingerprint();\n' },
  { id: 'M2', desc: '指纹读不了时仍进缓存判据（以 null 比）', find: CACHE_BRANCH, replace: '  }\n  if (!opts.refreshAuth) {\n' },
  { id: 'M3', desc: '写缓存条件去掉 fpError', find: CACHE_COND, replace: '    cache: r.ok\n' },
  { id: 'M4', desc: '指纹注明置空', find: NOTE, replace: "  const note = '';\n" },
  { id: 'M5', desc: 'probe 调用去掉 try', find: PROBE_TRY, replace: '  r = await auth.probe();\n' },
  { id: 'M6a', desc: '构造抛错支的退出码改成 1', find: CTOR_FAIL, replace: CTOR_FAIL.replace('EXIT.ENV', 'EXIT.FAIL') },
  { id: 'M6b', desc: '失败支的退出码改成 1', find: FAIL_BRANCH, replace: FAIL_BRANCH.replace('EXIT.ENV', 'EXIT.FAIL') },
  { id: 'M7', desc: 'thrownText 去掉家目录归一', find: TILDE, replace: '  return e instanceof Error ? e.message : String(e);\n' },
  { id: 'M8', desc: '构造抛错不兜（原样抛出）', find: CTOR_CATCH, replace: '  } catch (e) {\n    throw e;\n    return {\n      critic,\n' + CTOR_FAIL },
  {
    id: 'M9', desc: '⑧ 改回内联 Promise.all（预计存活）', find: WIRE,
    replace:
      '      const adapters = realAdapters();\n      const probes = await Promise.all(\n        selected\n' +
      '          .filter((id) => adapters[id])\n          .map((id) => probeAuth(ctx, id, adapters[id]!, opts)),\n      );\n',
  },
  { id: 'M10', desc: 'authCacheValid 对 null 指纹判失效', find: NO_ENTRY, replace: NO_ENTRY + "  if (fingerprint === null) return { valid: false, reason: '指纹为 null' };\n" },
  { id: 'M11', desc: '去掉 TRIVIUM_DEBUG 打印（预计存活）', find: DEBUG, replace: '' },
  {
    id: 'M12', desc: '注明与 probe 详情的拼接顺序对调', find: OK_BRANCH + FAIL_BRANCH,
    replace: OK_BRANCH.replace('r.detail + note', 'note + r.detail') + FAIL_BRANCH.replace('r.detail + note', 'note + r.detail'),
  },
].map((c) => ({ ...c, file: PF, expect: SUITE }));

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
