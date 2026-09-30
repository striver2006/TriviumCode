#!/usr/bin/env node
/**
 * 「锁回收误判已删锁文件」（EV-173 / EV-149）零配额验收（计划 r2 §6.2）。
 *
 * **不碰真实 HOME、不改本仓归档、不碰真实运行根**：旧构建、CLI 夹具都建在一个 mkdtemp 目录下；不发起任何模型调用；
 * 收尾只删 mkdtemp 的返回值。
 *
 * 新旧两份构建：
 *   - 新：工作树（先 `npm run build` 与 `node scripts/build.mjs --tests-only`）；
 *   - 旧：`git archive` 固定提交（缺省 3e38d29，ACCEPT_BASE_REF 可覆盖，不写 HEAD），`node_modules` 软链工作树；
 *     **把新树的三份测试文件拷进旧树**（CODEX-02）再 `node scripts/build.mjs --with-tests`；
 *   - 锁模块取各自的 `dist/test/src/trivium/lock.js`，CLI 取各自的 `skills/dual-critic/scripts/trivium.cjs`，都直接 node 调。
 *
 *   A0 前置闸与静态：归档内 package.json / package-lock.json 与工作树逐字节相同；拷入旧树的测试文件与新树逐字节相同；
 *      新旧 bundle 与 lock.js 的 sha256 都不同
 *   A1 probe-inproc：P1 旧告警 unparsable、新无告警且拿到锁；P1c 两边都 70 无告警；P2 旧双持有、新单持有且只有一条回收告警
 *   A2 probe-xproc e149 各 ROUNDS 轮：旧 unparsable 告警轮数 ≥ 1；新 unparsable 0、多赢家 0、区间重叠 0、D4 放不回告警 0、
 *      pid_gone 回收告警恰每轮一条（r1 读数暴露残余窗口后补 D8，见报告 §3）
 *   A3 probe-xproc x1 各 ROUNDS 轮：旧告警轮数 ≥ 1；新 0、区内 > 1 为 0、丢更新 0
 *   A4 移植测试在旧构建上跑：**正面断言** X3、加强后的 EV-149、U1～U12 的用例名出现在输出里（计入执行）；记旧构建上各自红绿；
 *      新构建上同一批全绿
 *   A5 CLI 对照（非竞态路径）：`topic claim` 碰到 pid 已死的 .task 锁——新旧都回收、退 0，stdout / stderr 归一化后逐字相同
 *      （告警文字未改）；碰到活持有者的 .task 锁——新旧都退 70、输出归一化后逐字相同
 *
 * 用法（仓库根）：node doc/05_testing/evidence/lock-reclaim-enoent-20260930/acceptance.mjs [输出 JSON 路径]
 *   环境变量 ACCEPT_ROUNDS（缺省 600）、ACCEPT_PARALLEL（缺省 8）
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { promises as fs, existsSync, readFileSync, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pexec = promisify(execFile);
const ROOT = process.cwd();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = process.argv[2] ?? null;
const BASE_REF = process.env.ACCEPT_BASE_REF ?? '3e38d29';
const ROUNDS = Number(process.env.ACCEPT_ROUNDS ?? '600');
const PARALLEL = Number(process.env.ACCEPT_PARALLEL ?? '8');
const TD = '.' + 'trivium';
const TOPIC = '锁验收';
const MARK = 'lock-reclaim-enoent-accept-holder';
const PORTED = ['test/unit/lock.test.ts', 'test/integration/lock-cross-process.test.ts', 'test/integration/run-protocol.test.ts'];

const results = [];
const readout = { base_ref: BASE_REF, node: process.version, platform: process.platform, rounds: ROUNDS, parallel: PARALLEL };
const check = (id, ok, detail) => {
  results.push({ id, ok, detail });
  console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`);
};
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

async function sh(cwd, bin, args, env = {}, timeout = 900_000) {
  try {
    const o = await pexec(bin, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 256 * 1024 * 1024, timeout });
    return { code: 0, stdout: o.stdout, stderr: o.stderr };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);

const NEW = {
  name: 'new',
  root: ROOT,
  cli: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'),
  asset: path.join(ROOT, 'skills/dual-critic'),
  lock: path.join(ROOT, 'dist/test/src/trivium/lock.js'),
};
for (const p of [NEW.cli, NEW.lock]) if (!existsSync(p)) throw new Error(`找不到：${p}（先 npm run build 与 --tests-only）`);

const base = realpathSync(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-accept-lock-reclaim-')));
const holders = [];
try {
  // ── 旧构建装配 ──
  const oldRoot = path.join(base, 'old');
  await fs.mkdir(oldRoot);
  const arch = path.join(base, 'old.tar');
  const a = await git(ROOT, ['archive', '-o', arch, BASE_REF]);
  if (a.code !== 0) throw new Error(`git archive 失败：${a.stderr}`);
  await sh(oldRoot, 'tar', ['-xf', arch]);
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(oldRoot, 'node_modules'));
  const OLD = {
    name: 'old',
    root: oldRoot,
    cli: path.join(oldRoot, 'skills/dual-critic/scripts/trivium.cjs'),
    asset: path.join(oldRoot, 'skills/dual-critic'),
    lock: path.join(oldRoot, 'dist/test/src/trivium/lock.js'),
  };

  // A0 前置闸
  const pkgSame = ['package.json', 'package-lock.json'].map((f) => ({ f, old: sha(path.join(oldRoot, f)), new: sha(path.join(ROOT, f)) }));
  readout.a0_pkg = pkgSame;
  const pkgOk = pkgSame.every((x) => x.old === x.new);
  check('A0 依赖声明一致', pkgOk, pkgSame.map((x) => `${x.f} ${x.old === x.new ? '相同' : '不同'}`).join('；'));
  if (!pkgOk) throw new Error('依赖声明不一致，拒绝开跑');
  const ported = [];
  for (const f of PORTED) {
    const before = sha(path.join(oldRoot, f));
    await fs.copyFile(path.join(ROOT, f), path.join(oldRoot, f));
    const after = sha(path.join(oldRoot, f));
    ported.push({ f, old_tree_before: before, old_tree_after: after, new_tree: sha(path.join(ROOT, f)) });
  }
  readout.a0_ported = ported;
  check('A0 移植测试逐字节相同', ported.every((x) => x.old_tree_after === x.new_tree && x.old_tree_before !== x.new_tree),
    ported.map((x) => `${x.f}：拷入前与新树${x.old_tree_before === x.new_tree ? '相同（未改动？）' : '不同'}、拷入后${x.old_tree_after === x.new_tree ? '相同' : '不同'}`).join('；'));
  const b = await sh(oldRoot, process.execPath, ['scripts/build.mjs', '--with-tests']);
  if (b.code !== 0 || !existsSync(OLD.cli) || !existsSync(OLD.lock)) throw new Error(`旧构建失败：${b.stderr.slice(-2000)}`);
  readout.a0_sha = { old_cli: sha(OLD.cli), new_cli: sha(NEW.cli), old_lock: sha(OLD.lock), new_lock: sha(NEW.lock) };
  check('A0 新旧产物不同', readout.a0_sha.old_cli !== readout.a0_sha.new_cli && readout.a0_sha.old_lock !== readout.a0_sha.new_lock,
    `trivium.cjs ${readout.a0_sha.old_cli.slice(0, 12)} / ${readout.a0_sha.new_cli.slice(0, 12)}；lock.js ${readout.a0_sha.old_lock.slice(0, 12)} / ${readout.a0_sha.new_lock.slice(0, 12)}`);

  // A1 probe-inproc
  const inproc = {};
  for (const B of [OLD, NEW]) {
    const r = await sh(ROOT, process.execPath, [path.join(HERE, 'probe-inproc.mjs'), B.lock]);
    inproc[B.name] = JSON.parse(r.stdout);
  }
  readout.a1_inproc = inproc;
  const w = (x) => x.reclaim_warnings.join(' | ');
  check('A1 P1 旧', inproc.old.P1_enoent_after_eexist.injected === 1 && /原因 unparsable/.test(w(inproc.old.P1_enoent_after_eexist)),
    `注入 ${inproc.old.P1_enoent_after_eexist.injected} 次；告警：${w(inproc.old.P1_enoent_after_eexist) || '无'}`);
  check('A1 P1 新', inproc.new.P1_enoent_after_eexist.injected === 1 && inproc.new.P1_enoent_after_eexist.acquired === true
    && inproc.new.P1_enoent_after_eexist.reclaim_warnings.length === 0,
    `注入 ${inproc.new.P1_enoent_after_eexist.injected} 次；拿到锁 ${inproc.new.P1_enoent_after_eexist.acquired}；告警：${w(inproc.new.P1_enoent_after_eexist) || '无'}`);
  check('A1 P1c 两边', ['old', 'new'].every((k) => inproc[k].P1c_control_no_delete.code === 70 && inproc[k].P1c_control_no_delete.reclaim_warnings.length === 0),
    `旧 ${inproc.old.P1c_control_no_delete.code}、新 ${inproc.new.P1c_control_no_delete.code}，均无告警`);
  const p2 = (k) => inproc[k].P2_reclaim_displaces_live_lock;
  check('A1 P2 旧', p2('old').double_holder === true, `双持有 ${p2('old').double_holder}；C 抢锁时机：${p2('old').c_tried_at}；回收告警 ${p2('old').reclaim_warnings.length} 条`);
  check('A1 P2 新', p2('new').double_holder === false && p2('new').c_error?.code === 70 && p2('new').reclaim_warnings.length === 1,
    `双持有 ${p2('new').double_holder}；C 抢锁时机：${p2('new').c_tried_at}，结局 ${p2('new').c_error?.code}；回收告警 ${p2('new').reclaim_warnings.length} 条`);

  // A2 / A3 probe-xproc（先旧后新，逐场景串行跑，免得两份负载互相叠加）
  const xproc = {};
  for (const sc of ['e149', 'x1']) {
    xproc[sc] = {};
    for (const B of [OLD, NEW]) {
      const r = await sh(ROOT, process.execPath, [path.join(HERE, 'probe-xproc.mjs'), '--scenario', sc, '--rounds', String(ROUNDS), '--parallel', String(PARALLEL), '--lock', B.lock], {}, 3_600_000);
      const s = JSON.parse(r.stdout);
      await fs.writeFile(path.join(HERE, `acceptance-xproc-${sc}-${B.name}.json`), JSON.stringify(s, null, 2) + '\n');
      delete s.bad_rounds;
      xproc[sc][B.name] = s;
    }
  }
  readout.a2_a3_xproc = xproc;
  const e = xproc.e149;
  check('A2 e149 旧', e.old.rounds_with_unparsable_warn >= 1,
    `${ROUNDS} 轮：unparsable 告警 ${e.old.rounds_with_unparsable_warn} 轮，多赢家 ${e.old.rounds_multi_winner} 轮（重叠 ${e.old.rounds_multi_winner_overlapping}、先后 ${e.old.rounds_multi_winner_sequential}），晚就绪 ${e.old.rounds_with_late_boot} 轮`);
  check('A2 e149 新', e.new.rounds_with_unparsable_warn === 0 && e.new.rounds_multi_winner === 0 && e.new.rounds_multi_winner_overlapping === 0
    && !e.new.reclaim_reason_counts.displaced_unrestorable && e.new.reclaim_reason_counts.pid_gone === ROUNDS,
    `${ROUNDS} 轮：unparsable 告警 ${e.new.rounds_with_unparsable_warn} 轮，多赢家 ${e.new.rounds_multi_winner} 轮，晚就绪 ${e.new.rounds_with_late_boot} 轮；回收原因计数 ${JSON.stringify(e.new.reclaim_reason_counts)}`);
  const x = xproc.x1;
  check('A3 x1 旧', x.old.rounds_with_reclaim_warn >= 1,
    `${ROUNDS} 轮：告警 ${x.old.rounds_with_reclaim_warn} 轮（${JSON.stringify(x.old.reclaim_reason_counts)}），区内 > 1 ${x.old.rounds_max_inside_gt1} 轮，丢更新 ${x.old.rounds_lost_update} 轮`);
  check('A3 x1 新', x.new.rounds_with_reclaim_warn === 0 && x.new.rounds_max_inside_gt1 === 0 && x.new.rounds_lost_update === 0 && x.new.rounds_not_all_ok === 0,
    `${ROUNDS} 轮：告警 ${x.new.rounds_with_reclaim_warn} 轮，区内 > 1 ${x.new.rounds_max_inside_gt1} 轮，丢更新 ${x.new.rounds_lost_update} 轮`);

  // A4 移植测试
  const WANT = [
    '跨进程：多个进程同时回收同一把遗留锁，仍只有一个拿到',
    '锁回收误判 X3',
    ...['U1', 'U2', 'U3', 'U4', 'U4′', 'U4b', 'U5', 'U6', 'U7', 'U8', 'U9', 'U10', 'U11', 'U12'].map((u) => `锁回收误判 ${u}：`),
  ];
  const testFiles = ['dist/test/test/unit/lock.test.js', 'dist/test/test/integration/lock-cross-process.test.js', 'dist/test/test/integration/run-protocol.test.js'];
  const ran = {};
  for (const B of [OLD, NEW]) {
    const r = await sh(B.root, process.execPath, ['--test', '--test-reporter=spec', '--test-timeout=120000', ...testFiles], {}, 900_000);
    await fs.writeFile(path.join(HERE, `acceptance-ported-tests-${B.name}.txt`), r.stdout + r.stderr);
    const lines = (r.stdout + r.stderr).split('\n');
    ran[B.name] = WANT.map((want) => {
      const l = lines.find((s) => /^[✔✖]/.test(s.trim()) && s.includes(want));
      return { want, seen: Boolean(l), pass: l ? l.trim().startsWith('✔') : null };
    });
    const tail = lines.filter((s) => /^ℹ (tests|pass|fail) /.test(s)).join('；');
    ran[B.name + '_summary'] = tail;
  }
  readout.a4_ported = ran;
  check('A4 旧构建跑到了全部目标用例', ran.old.every((x) => x.seen), ran.old.filter((x) => !x.seen).map((x) => x.want).join('、') || `全部 ${WANT.length} 条出现；${ran.old_summary}`);
  check('A4 旧构建上的红绿（记录）', true, ran.old.map((x) => `${x.want.replace('锁回收误判 ', '').replace('：', '')}${x.pass ? '绿' : '红'}`).join(' '));
  check('A4 新构建全绿', ran.new.every((x) => x.seen && x.pass), `${ran.new.filter((x) => x.pass).length}/${WANT.length}；${ran.new_summary}`);

  // A5 CLI 对照（非竞态路径）
  async function fixture(name) {
    const root = path.join(base, name);
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
    await fs.mkdir(path.join(root, TD), { recursive: true });
    const runRoot = path.join(base, 'runs-' + name);
    await fs.writeFile(path.join(root, TD, 'config.yaml'), ['runtime:', `  run_root: ${runRoot}`, 'review:', '  default_critics: [gemini, glm]', 'verify:', '  build: []', '  test: []', ''].join('\n'));
    await git(root, ['init', '-q', '-b', 'main']);
    await git(root, ['add', '-A']);
    await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
    return { root, runRoot, lockFile: path.join(root, TD, 'lock', `.task-${TOPIC}.lock`) };
  }
  const norm = (t, fx) => String(t ?? '')
    .split(fx.root).join('〈ROOT〉').split(fx.runRoot).join('〈RUNROOT〉')
    .replace(/\d{8}T\d{6}Z(?:-\d+)?/g, '〈RUN〉')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, '〈TS〉')
    .replace(/(pid|持有者 pid)\s*\d+/g, '$1 〈PID〉')
    .replace(/"(claimed_at|updated_at)": "[^"]*"/g, '"$1": "〈TS〉"');
  const deadPid = async () => {
    const c = spawn(process.execPath, ['-e', ''], { stdio: 'ignore' });
    await new Promise((r) => c.on('exit', r));
    return c.pid;
  };
  const liveHolder = async () => {
    const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)', MARK], { detached: true, stdio: 'ignore' });
    c.unref();
    holders.push(c.pid);
    await new Promise((r) => setTimeout(r, 300));
    return c.pid;
  };
  const claim = ['topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'claude', '--json'];
  const a5 = {};
  for (const [cell, pidOf] of [['dead', deadPid], ['live', liveHolder]]) {
    a5[cell] = {};
    for (const B of [NEW, OLD]) {
      const fx = await fixture(`${cell}-${B.name}`);
      await fs.mkdir(path.dirname(fx.lockFile), { recursive: true });
      const pid = await pidOf();
      await fs.writeFile(fx.lockFile, JSON.stringify({ topic: `.task-${TOPIC}`, stage: null, run_id: null, pid, pid_started_at: null, acquired_at: new Date().toISOString(), kind: 'critical' }, null, 2) + '\n');
      const r = await sh(fx.root, process.execPath, [B.cli, ...claim], { TRIVIUM_ASSET_ROOT: B.asset, CLAUDE_SESSION_ID: 'S-验收' });
      a5[cell][B.name] = { code: r.code, stdout: norm(r.stdout, fx), stderr: norm(r.stderr, fx) };
    }
  }
  readout.a5_cli = a5;
  check('A5 死持有者：新旧都回收、输出逐字相同', a5.dead.new.code === 0 && a5.dead.old.code === 0
    && a5.dead.new.stdout === a5.dead.old.stdout && a5.dead.new.stderr === a5.dead.old.stderr && /回收主题/.test(a5.dead.new.stderr),
    `退出码 新 ${a5.dead.new.code} / 旧 ${a5.dead.old.code}；stderr：${a5.dead.new.stderr.trim().split('\n').find((l) => l.includes('回收主题')) ?? '(无告警)'}`);
  check('A5 活持有者：新旧都 70、输出逐字相同', a5.live.new.code === 70 && a5.live.old.code === 70
    && a5.live.new.stdout === a5.live.old.stdout && a5.live.new.stderr === a5.live.old.stderr,
    `退出码 新 ${a5.live.new.code} / 旧 ${a5.live.old.code}`);
} finally {
  for (const pid of holders) {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* 已退出 */ }
  }
  await fs.rm(base, { recursive: true, force: true });
}

const pass = results.filter((r) => r.ok).length;
console.log(`\n验收：${pass}/${results.length} 通过`);
readout.results = results;
if (OUT) await fs.writeFile(OUT, JSON.stringify(readout, null, 2) + '\n');
process.exit(pass === results.length ? 0 : 1);
