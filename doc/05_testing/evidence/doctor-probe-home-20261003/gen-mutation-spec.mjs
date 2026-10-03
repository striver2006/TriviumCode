// 生成「doctor探针走副本HOME」（EV-194）的源码变异规格（计划 r2 §4 M1～M15，编码时补 M16～M17，代码双审后补 M18～M19 并改 M7 / M8 锚点）：
// find 串从现行源码截取，逐条核对恰好出现一次，替换串扫一遍 String.replace 的特殊替换模式，再落盘。
// 照搬 evidence/breach-gate-wording-20261002/gen-mutation-spec.mjs 的形态；每条只指定一个期望套件（装置每条只收一个套件）。
// 用法（在仓库根）：node doc/05_testing/evidence/doctor-probe-home-20261003/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PROBE = 'src/trivium/probes/zcode.ts';
const ADAPTER = 'src/trivium/adapters/zcode.ts';
const DOCTOR = 'src/trivium/doctor.ts';
const S = { home: 'dist/test/test/unit/zcode-doctor-probe-home.test.js' };

/** 从源码截锚点：含 needle 的那一行起连取 n 行（含换行），要求整段在文件里唯一 */
function blockOf(file, needle, n = 1) {
  const src = read(file);
  const lines = src.split('\n');
  const idx = lines.findIndex((l) => l.includes(needle));
  if (idx < 0) throw new Error(`${file} 里没有「${needle}」`);
  const block = lines.slice(idx, idx + n).join('\n') + '\n';
  const hits = src.split(block).length - 1;
  if (hits !== 1) throw new Error(`${file} 里从「${needle}」起 ${n} 行的锚点命中 ${hits} 处（应为 1）`);
  return block;
}
const sub = (s, a, b) => {
  if (!s.includes(a)) throw new Error(`锚点里没有「${a}」`);
  return s.replace(a, b);
};

// headless 那次拉起：`...launch,` 与其后的 cwd / readonlyArgs 两行（path_deny 那次写法不同，三行合起来唯一）
const P_HEADLESS = blockOf(PROBE, '        ...launch,', 3);
if (!P_HEADLESS.includes('readonlyArgs: readonly,')) throw new Error('P_HEADLESS 没取到 headless 那次');
const P_LAUNCH = blockOf(PROBE, '        omitPersonalProviderConfig: prep.homeDir !== null,', 2);
if (!P_LAUNCH.includes('storageRedirectRoot: landing,')) throw new Error('P_LAUNCH 没取到落点根那行');
const P_DENY = blockOf(PROBE, 'const deny = await probePathDeny(entry, node, fx, readonly, { launch, invoke });');
const P_LOG = blockOf(PROBE, "const trace = await readTrace(out.envelope.sessionId, zcodeStorageRedirectEnv(landing)['ZCODE_LOG_DIR']!);");
const P_ROLL = blockOf(PROBE, 'const rollout = out.envelope.sessionId ? await readRollout(out.envelope.sessionId, landing) : null;');
const P_RM = blockOf(PROBE, '      await fs.rm(runDir, { recursive: true, force: true, maxRetries: 3 }).catch((e: unknown) => {');
const P_PREP = blockOf(PROBE, "prep = await prepareZcodeHome(runDir, opts.launchModel ?? null, { srcConfig: cliConfigPath, requestedFirst: true });");
const P_CATCH = blockOf(PROBE, "'response_field / path_deny / scratch_paths / model_id_form 保留上一次的结论（请检查该文件，或在 ZCode 里重新保存一次模型配置）',", 3);
if (!P_CATCH.includes('return { probe, notes, flagsIndeterminate, flagsZeroExit };')) throw new Error('P_CATCH 没取到 catch 里的 return');
const P_FAILNOTE = blockOf(PROBE, '`ZCode headless 失败（${out.failureKind}，${probed}）：');
const P_TRACE_ALL = blockOf(PROBE, "await Promise.all(files.map((f) => fs.readFile(path.join(logDir, f), 'utf8').catch(() => null)))");
const A_FALLBACK = blockOf(ADAPTER, '? `真实 HOME 下 ZCode 自选的缺省模型（${tildeHome(prep.reason ?? \'\')}）`');
const A_MODEL = blockOf(ADAPTER, "return routeModel(cfg, 'glm', 'plan').model;");
const D_LAUNCH = blockOf(DOCTOR, 'launchModel: zcodeProbeModel(opts.config),');
const P_CAUSE = blockOf(PROBE, "const cause = failed?.failureCause ? `；日志根因：");

const cases = [
  { id: 'M1', desc: 'headless 不展开 launch（回到真实 HOME、注入个人配置、不设落点）', file: PROBE, find: P_HEADLESS,
    replace: sub(P_HEADLESS, '        ...launch,\n', ''), expect: S.home },
  { id: 'M2', desc: '副本支也注入个人配置', file: PROBE, find: P_LAUNCH,
    replace: sub(P_LAUNCH, 'omitPersonalProviderConfig: prep.homeDir !== null,', 'omitPersonalProviderConfig: false,'), expect: S.home },
  { id: 'M3', desc: '不设落点根', file: PROBE, find: P_LAUNCH,
    replace: sub(P_LAUNCH, 'storageRedirectRoot: landing,', 'storageRedirectRoot: null,'), expect: S.home },
  { id: 'M4', desc: 'path_deny 不传 launch', file: PROBE, find: P_DENY,
    replace: sub(P_DENY, '{ launch, invoke }', '{ invoke }'), expect: S.home },
  { id: 'M5', desc: '日志改回真实 ~/.zcode/cli/log', file: PROBE, find: P_LOG,
    replace: sub(P_LOG, "zcodeStorageRedirectEnv(landing)['ZCODE_LOG_DIR']!", "path.join(ZCODE_CLI_DIR, 'log')"), expect: S.home },
  { id: 'M6', desc: 'rollout 改回真实目录', file: PROBE, find: P_ROLL,
    replace: sub(P_ROLL, 'readRollout(out.envelope.sessionId, landing)', 'readRollout(out.envelope.sessionId)'), expect: S.home },
  { id: 'M7', desc: '不删临时运行目录', file: PROBE, find: P_RM,
    replace: sub(P_RM, '      await fs.rm(', '      if (false) await fs.rm('), expect: S.home },
  { id: 'M8', desc: '只在成功走完时删（删除挪出 finally 的等价形态）', file: PROBE, find: P_RM,
    replace: sub(P_RM, '      await fs.rm(', "      if (notes.some((n) => n.startsWith('scratch_paths='))) await fs.rm("), expect: S.home },
  { id: 'M9', desc: '副本源不传 srcConfig（读缺省的 ~/.zcode/cli/config.json）', file: PROBE, find: P_PREP,
    replace: sub(P_PREP, '{ srcConfig: cliConfigPath, requestedFirst: true }', '{ requestedFirst: true }'), expect: S.home },
  { id: 'M10', desc: '不请求置首', file: PROBE, find: P_PREP,
    replace: sub(P_PREP, '{ srcConfig: cliConfigPath, requestedFirst: true }', '{ srcConfig: cliConfigPath }'), expect: S.home },
  { id: 'M11', desc: 'doctor 不传档位模型', file: DOCTOR, find: D_LAUNCH, replace: '', expect: S.home },
  { id: 'M12', desc: '退路措辞漂移', file: ADAPTER, find: A_FALLBACK,
    replace: sub(A_FALLBACK, '真实 HOME 下 ZCode 自选的缺省模型', '真实 HOME 下的缺省模型'), expect: S.home },
  { id: 'M13', desc: '副本源解析失败时退回真实 HOME 继续拉起', file: PROBE, find: P_CATCH,
    replace: sub(P_CATCH, 'return { probe, notes, flagsIndeterminate, flagsZeroExit };',
      "prep = { homeDir: null, route: 'global', qualified: null, cause: 'no_model', reorder: null };"), expect: S.home },
  { id: 'M14', desc: '失败 note 去掉探的是哪条路径', file: PROBE, find: P_FAILNOTE,
    replace: sub(P_FAILNOTE, '（${out.failureKind}，${probed}）', '（${out.failureKind}）'), expect: S.home },
  { id: 'M15', desc: 'readTrace 改回只取最新一片', file: PROBE, find: P_TRACE_ALL,
    replace: sub(P_TRACE_ALL, "await Promise.all(files.map((f) => fs.readFile(path.join(logDir, f), 'utf8').catch(() => null)))",
      "[await fs.readFile(path.join(logDir, files.at(-1)), 'utf8')]"), expect: S.home },
  // ── 编码时补的 ──
  { id: 'M16', desc: '探活模型取错阶段（code）', file: ADAPTER, find: A_MODEL,
    replace: sub(A_MODEL, "'plan'", "'code'"), expect: S.home },
  { id: 'M17', desc: '失败时不从落点日志取结构化根因', file: PROBE, find: P_CAUSE,
    replace: sub(P_CAUSE, 'failed?.failureCause ?', 'false ?'), expect: S.home },
  // ── 代码双审之后追加 ──
  { id: 'M18', desc: '临时目录删除失败照抛（CODEX-01）', file: PROBE, find: P_RM,
    replace: sub(P_RM, '.catch((e: unknown) => {', '.catch((e: unknown) => { throw e;'), expect: S.home },
  { id: 'M19', desc: '读日志分片不逐片兜底（CODEX-02）', file: PROBE, find: P_TRACE_ALL,
    replace: sub(P_TRACE_ALL, ".catch(() => null)", ''), expect: S.home },
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
