// 生成「建仓步骤失败显式化」（EV-209）的源码变异规格（计划 r2 §4 的 M1～M17，按实际源码定稿；M16 构造不出、已删，见报告）。
// 照搬 evidence/probe-fixture-cleanup-20261004/gen-mutation-spec.mjs 的形态：find 串逐条核对在目标文件里恰好出现一次，
// 替换串扫一遍 String.replace 的特殊替换模式，再落盘。期望套件是本题新文件（U / P / D 三组）；
// 跨文件的红格放 `also`（预跑脚本顺带跑、装置忽略）：M1 / M2 的自检 S1 / S2，M3 的 hook-config 那一格。
// 用法（在仓库根）：node doc/05_testing/evidence/fixture-repo-init-20261005/gen-mutation-spec.mjs <输出路径>
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUT = process.argv[2];
if (!OUT) throw new Error('用法：node gen-mutation-spec.mjs <输出路径>');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const GIT = 'src/trivium/util/git.ts';
const FX = 'src/trivium/probes/fixture.ts';
const DR = 'src/trivium/doctor.ts';
const CL = 'src/trivium/probes/claude.ts';
const SUITE = 'dist/test/test/unit/fixture-repo-init.test.js';
const SELFTEST = 'dist/test/test/integration/selftest.test.js';
const HOOKCFG = 'dist/test/test/unit/hook-config.test.js';

const THROW = '    if (r.code !== 0 || r.timedOut) throw new Error(fixtureRepoStepError(i + 1, r));\n';
const LOOP =
  '  for (let i = 0; i < FIXTURE_REPO_STEPS.length; i++) {\n' +
  "    const r = await run('git', FIXTURE_REPO_STEPS[i]!.args, { cwd: dir, timeoutMs: FIXTURE_GIT_TIMEOUT_MS });\n" +
  THROW +
  '  }\n}\n';
const HEAD = '  const head = `建仓第 ${index}/${FIXTURE_REPO_STEPS.length} 步「${step.name}」失败：`;\n';
const TIMED = '  if (r.timedOut) return `${head}${FIXTURE_GIT_TIMEOUT_MS / 1000} 秒内未结束，已终止`;\n';
const RESIDUE = '    const residue = root === null ? null : await removeFixtureRoot(kind, root);\n';
const GUARD = '    if (!(e instanceof ProbeFixtureError)) throw e;\n    onFail(probeFixtureBlocker(cli, e));\n';
const MEM_CATCH = '    if (!(e instanceof ProbeFixtureError)) throw e;\n    notes.push(`project_memory_blocked 本轮未刷新';

const cases = [
  { id: 'M1', file: GIT, desc: '步骤结果不看（失败不抛）', find: THROW, replace: '    void r;\n', also: [SELFTEST] },
  {
    id: 'M2', file: GIT, desc: '启动失败（code 为 null）不算失败',
    find: THROW, replace: THROW.replace('r.code !== 0 ||', '(r.code !== 0 && r.code !== null) ||'), also: [SELFTEST],
  },
  {
    id: 'M3', file: GIT, desc: '基线提交去掉 --allow-empty',
    find: "'--no-verify', '--allow-empty'] }", replace: "'--no-verify'] }", also: [HOOKCFG],
  },
  {
    id: 'M4', file: GIT, desc: '文案丢掉步骤名',
    find: HEAD, replace: "  const head = `建仓第 ${index}/${FIXTURE_REPO_STEPS.length} 步失败：${step ? '' : ''}`;\n",
  },
  {
    id: 'M5', file: GIT, desc: 'stderr 为空时不退回 stdout',
    find: '  const text = r.stderr.trim() ? r.stderr : r.stdout;\n', replace: '  const text = r.stderr;\n',
  },
  {
    id: 'M6', file: GIT, desc: '第一步失败后不停、跑完全部步骤再抛第一个失败',
    find: LOOP,
    replace:
      '  let failed: Error | null = null;\n' +
      LOOP.replace(THROW, '    if ((r.code !== 0 || r.timedOut) && !failed) failed = new Error(fixtureRepoStepError(i + 1, r));\n')
        .replace('  }\n}\n', '  }\n  if (failed) throw failed;\n}\n'),
  },
  {
    id: 'M7', file: FX, desc: 'createFixture（main）失败时不删目录',
    find: RESIDUE, replace: "    const residue = root === null || kind === 'main' ? null : await removeFixtureRoot(kind, root);\n",
  },
  {
    id: 'M8', file: FX, desc: 'createMemoryFixture（memory）失败时不删目录',
    find: RESIDUE, replace: "    const residue = root === null || kind === 'memory' ? null : await removeFixtureRoot(kind, root);\n",
  },
  {
    id: 'M9', file: FX, desc: '删不掉时不把残留提示接在原因后面',
    find: "    super(`建探针夹具失败：${why}${residue ? `；${residue}` : ''}`, { cause });\n",
    replace: '    super(`建探针夹具失败：${why}`, { cause });\n',
  },
  { id: 'M10', file: DR, desc: 'guardFixture 不接、原样重抛', find: GUARD, replace: '    throw e;\n' },
  {
    id: 'M11', file: DR, desc: 'guardFixture 接住但不推 blocker（也不记失败侧）',
    find: GUARD, replace: '    if (!(e instanceof ProbeFixtureError)) throw e;\n    void probeFixtureBlocker(cli, e);\n',
  },
  {
    id: 'M12', file: DR, desc: 'guardFixture 连普通异常也吞',
    find: GUARD, replace: '    if (!(e instanceof ProbeFixtureError)) return null;\n    onFail(probeFixtureBlocker(cli, e));\n',
  },
  {
    id: 'M13', file: DR, desc: '「尚无探针实现」那一圈不排除夹具失败侧',
    find: '    if (fixtureFailed.has(name)) continue; // 本次探了、夹具没建起来：已有 blocker，不是「尚无探针实现」（EV-209）\n',
    replace: '',
  },
  {
    id: 'M14', file: CL, desc: 'probeClaude 不在记忆夹具处接住（穿到 doctor 层）',
    find: MEM_CATCH, replace: MEM_CATCH.replace('    if (!(e instanceof ProbeFixtureError)) throw e;\n', '    throw e;\n'),
  },
  {
    id: 'M15', file: DR, desc: 'doctor 不推记忆格 warning',
    find: '      if (r.memoryFixtureFailure) warnings.push(memoryFixtureWarning(r.memoryFixtureFailure));\n', replace: '',
  },
  {
    id: 'M17', file: GIT, desc: '判定顺序改为信号先于超时',
    find: TIMED, replace: '  if (r.signal !== null) return `${head}被信号 ${r.signal} 终止`;\n' + TIMED,
  },
].map((c) => ({ ...c, expect: SUITE }));

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
console.error(`规格 ${cases.length} 条 → ${OUT}`);
