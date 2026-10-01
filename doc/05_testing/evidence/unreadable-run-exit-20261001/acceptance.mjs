#!/usr/bin/env node
/**
 * 「留痕读不出的出口」（EV-148 文案部分）零配额验收（计划 r2 §5.4）。
 *
 * **不碰真实 HOME、不碰本仓归档**：审核者换成桩（`TRIVIUM_STUB_CRITIC`），不发起任何模型调用；每格一个夹具，
 * 全部建在一个 mkdtemp 目录下，运行目录（`runtime.run_root`）也在里面；收尾只删 mkdtemp 的返回值。
 * 夹具里的 restore / 删除 / 改坏 run.json 都只发生在这些 mkdtemp 夹具里（真实场景里 restore 由用户在终端做）。
 *
 * 三份构建：
 *   - 改前：`git archive 14c188b` 导出、`node_modules` 软链本仓、`node scripts/build.mjs`；
 *   - 改后：本仓工作树当前的 `skills/dual-critic/scripts/trivium.cjs`（跑前先 `node scripts/build.mjs`）；
 *   - 落后版本（只给 C 格当读取方）：`git archive a89a46f`（`e49279a` 的父提交，其 run.v2 的 `termination.by`
 *     枚举只有 `worker_exception`，读不懂 `sync_exception`），同法构建。
 *   三份 bundle 记 sha256，断言改前 ≠ 改后。
 *
 * 格（计划 r2 §1.4）：
 *   A 已提交的 run.json 在工作树里被改坏   → 五处拒绝；夹具内 git restore 后 topic resolve / 重跑退 0
 *   B 尚未提交的 run.json 本身就坏          → 五处拒绝；restore 失败；重跑被拒；删掉后判定放行但提交锚拦下
 *   C 本工具版本落后于写入方                → 新构建写出 sync_exception 并提交（git status 干净），
 *                                             落后版本判 corrupt，换回新构建即恢复
 *   D 运行中途被打断（worker 被 SIGKILL）   → 骨架可读、不进本状态；--wait 收尾后仍可读
 *   E1 approve 时闸门项 run_id 指向不存在的运行 → abandon 后重跑退 0
 *   E2 approve 时闸门项 run_id 指向该阶段最新且读不出的一份 → abandon 退 0，重跑仍退 2
 *   E3 同 E2 但已提交 → 夹具内 restore 后直接重新 approve 退 0（计划双审 AGY-01）
 *   F 最新一份坏、较旧一份可读            → Driver 侧判 corrupt；gate 按 EV-73 采信较旧一份（只记录）
 *
 * 用法：node doc/05_testing/evidence/unreadable-run-exit-20261001/acceptance.mjs
 * 读数写进同目录 `acceptance-readout.json`，终端出摘要；任一判据不过退 1。
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pexec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const BEFORE_COMMIT = '14c188b';
const LAGGING_COMMIT = 'a89a46f';
const TD = '.' + 'trivium';
const today = new Date().toISOString().slice(0, 10);

const { encodeStubConfig, STUB_ENV_VAR } = await import(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const { UNREADABLE_RUN_META_EXIT_BODY: BODY } = await import(path.join(ROOT, 'dist/test/src/trivium/meta.js'));
const OK = encodeStubConfig({ gemini: { mode: 'ok' }, glm: { mode: 'ok' } });
const HANG = encodeStubConfig({ gemini: { mode: 'hang' }, glm: { mode: 'hang' } });
const CIRCULAR = [/重跑[^\n]*(落一份可读|随即恢复|当场恢复)/, /出口是\**重跑/];

const results = [];
const readout = { before_commit: BEFORE_COMMIT, lagging_commit: LAGGING_COMMIT, builds: {}, cells: {} };
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`); };

/**
 * 起子进程跑一条命令。**带超时**（代码双审 r1 CODEX-04）：到点按进程组 SIGKILL（`detached` 让它自成一组，
 * 连同 `--start` 派生的工作进程一起结束），结果记 `timed_out: true`、退出码 null——判据会因此判 ✖，不会挂住整台机器。
 */
const SH_TIMEOUT_MS = 300_000;
function sh(cwd, bin, args, env = {}, input, timeoutMs = SH_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const c = spawn(bin, args, { cwd, env: { ...process.env, ...env }, detached: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-c.pid, 'SIGKILL'); } catch { /* 组已不在 */ }
    }, timeoutMs);
    c.stdout.on('data', (d) => { stdout += d; });
    c.stderr.on('data', (d) => { stderr += d; });
    c.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: timedOut ? null : code, stdout, stderr: timedOut ? `${stderr}\n〈超时 ${timeoutMs} ms，已按进程组结束〉` : stderr, timed_out: timedOut });
    });
    c.stdin.end(input ?? '');
  });
}
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);
const sha256 = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');
const isCircular = (s) => CIRCULAR.some((re) => re.test(s));

let base;
/** 归一化：主题名、run_id、日期、时间戳、临时路径、pid 换成占位，供新旧文本对照 */
function normalize(s) {
  let t = String(s ?? '');
  if (base) t = t.split(base).join('〈临时根〉');
  return t
    .replace(/\/(?:private\/)?var\/folders\/[^\s"'）)]+/g, '〈临时路径〉')
    .replace(/\d{8}T\d{6}Z/g, '〈run_id〉')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '〈时间戳〉')
    .replace(/\d{4}-\d{2}-\d{2}/g, '〈日期〉')
    .replace(/\b(pid|worker_pid|进程组)\D{0,3}\d+/g, '$1 〈pid〉')
    .replace(/\d+(\.\d+)?s\b/g, '〈秒〉');
}
const out = (r) => `${r.stdout}${r.stderr}`;
const rec = (r) => ({ code: r.code, text: normalize(out(r)).split('\n').filter((l) => l && !/桩|STUB|注入配置|只应出现|同步模式/.test(l)) });

async function exportBuild(commit, dir) {
  await fs.mkdir(dir, { recursive: true });
  const arch = await sh(ROOT, 'sh', ['-c', `git archive ${commit} | tar -x -C "$1"`, 'sh', dir]);
  if (arch.code !== 0) throw new Error(`git archive ${commit} 失败：${arch.stderr}`);
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  const b = await sh(dir, process.execPath, ['scripts/build.mjs']);
  if (b.code !== 0) throw new Error(`${commit} 构建失败：${b.stdout}${b.stderr}`);
  return { cli: path.join(dir, 'skills/dual-critic/scripts/trivium.cjs'), assets: path.join(dir, 'skills/dual-critic') };
}

readout.started_at = new Date().toISOString();
base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev148-accept-')));
try {
  const builds = {
    before: await exportBuild(BEFORE_COMMIT, path.join(base, 'build-before')),
    after: { cli: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'), assets: path.join(ROOT, 'skills/dual-critic') },
    lagging: await exportBuild(LAGGING_COMMIT, path.join(base, 'build-lagging')),
  };
  for (const [k, b] of Object.entries(builds)) readout.builds[k] = { bundle_sha256: await sha256(b.cli) };
  check('构建不同', readout.builds.before.bundle_sha256 !== readout.builds.after.bundle_sha256,
    `before ${readout.builds.before.bundle_sha256.slice(0, 12)} / after ${readout.builds.after.bundle_sha256.slice(0, 12)} / lagging ${readout.builds.lagging.bundle_sha256.slice(0, 12)}`);
  const afterHas = (await fs.readFile(builds.after.cli, 'utf8')).includes('重跑该阶段双审不是出口');
  const beforeHas = (await fs.readFile(builds.before.cli, 'utf8')).includes('重跑该阶段双审不是出口');
  check('构建内容', afterHas && !beforeHas, `改后 bundle 含共用出口段=${afterHas}，改前=${beforeHas}`);

  const cli = (b, cwd, args, stub = OK, input) =>
    sh(cwd, process.execPath, [b.cli, ...args], { TRIVIUM_ASSET_ROOT: b.assets, [STUB_ENV_VAR]: stub, CLAUDE_SESSION_ID: 'S-accept' }, input);

  async function fixture(tag, topic) {
    const root = path.join(base, tag);
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
    await fs.mkdir(path.join(root, TD), { recursive: true });
    await fs.writeFile(path.join(root, TD, 'config.yaml'), [
      'runtime:', `  run_root: ${path.join(base, 'runs', tag)}`,
      'review:', '  default_critics: [gemini, glm]', '  wait_timeout_s: 30',
      'verify:', '  build: []', '  test: []', '',
    ].join('\n'));
    await git(root, ['init', '-q', '-b', 'main']);
    await git(root, ['add', '-A']);
    await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
    const stageDir = path.join(root, '.reviews', topic, 'plan');
    await fs.mkdir(stageDir, { recursive: true });
    await fs.writeFile(path.join(stageDir, `${today}-${topic}-` + 'claude.md'), '# 待审计划\n\n验收。\n');
    return { root, topic, stageDir, metaDir: path.join(stageDir, '_meta') };
  }
  const runFiles = async (dir) => (await fs.readdir(dir).catch(() => [])).filter((n) => /^run-.+\.json$/.test(n)).sort();
  const syncReview = (b, fx, stub = OK) => cli(b, fx.root, ['review', '--stage', 'plan', '--topic', fx.topic, '--focus', '验收', '--entry', 'B'], stub);
  const startReview = (b, fx, stub = OK) => cli(b, fx.root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', fx.topic, '--focus', '验收', '--json'], stub);
  const topicResolve = (b, fx) => cli(b, fx.root, ['topic', 'resolve', '--stage', 'plan', '--json', '--', '验收', '--topic', fx.topic]);
  const topicClaim = (b, fx) => cli(b, fx.root, ['topic', 'claim', '--topic', fx.topic, '--stage', 'plan', '--driver', 'claude']);
  const gateCheck = (b, fx) => cli(b, fx.root, ['gate', '--stage', 'plan', '--topic', fx.topic, '--check']);
  const hookPreWrite = (b, fx) => cli(b, fx.root, ['gate', 'hook-pre-write'], OK, JSON.stringify({
    tool_name: 'Write', tool_input: { file_path: path.join(fx.stageDir, `${today}-${fx.topic}-` + 'gemini.md'), content: 'x' }, cwd: fx.root,
  }));
  const preCommit = (b, fx) => cli(b, fx.root, ['gate', 'hook-pre-commit'], OK, JSON.stringify({
    tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, cwd: fx.root,
  }));
  const approve = (b, fx) => cli(b, fx.root, ['approve', '--topic', fx.topic, '--stage', 'plan', '--reason', '验收']);
  const abandon = (b, fx, reason = '验收') => cli(b, fx.root, ['abandon', '--topic', fx.topic, '--stage', 'plan', '--reason', reason]);
  async function writeDisposition(fx, runId) {
    await fs.writeFile(path.join(fx.stageDir, `${today}-${fx.topic}-revised-` + 'claude.md'), [
      '---', 'schema: trivium.disposition.v1', `topic: ${fx.topic}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${runId}`,
      'addresses:', `  - ${today}-${fx.topic}-gemini.md`, `  - ${today}-${fx.topic}-glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 验收夹具，接受 | §1 |',
      '| GLM-01 | glm | blocker | 接受 | 验收夹具，接受 | §1 |', '',
    ].join('\n'));
  }
  /** 跑一轮、写裁决件、经 --check 立起停点；返回 run_id */
  async function toAwaiting(b, fx) {
    const r = await syncReview(b, fx);
    if (r.code !== 0) throw new Error(`首轮失败：${out(r)}`);
    const [rf] = (await runFiles(fx.metaDir)).slice(-1);
    const runId = /^run-(.+)\.json$/.exec(rf)[1];
    await writeDisposition(fx, runId);
    const g = await gateCheck(b, fx);
    if (g.code !== 0) throw new Error(`立停点失败：${out(g)}`);
    return runId;
  }

  /** 五处（不含第 6、7 处）的拒绝文案 */
  async function fiveSites(b, fx) {
    return {
      reviewStart: await startReview(b, fx),
      topicClaim: await topicClaim(b, fx),
      topicResolve: await topicResolve(b, fx),
      hookPreWrite: await hookPreWrite(b, fx),
      gateCheck: await gateCheck(b, fx),
    };
  }
  /** 改后构建上五处文案的判据：退出码不变、共用段在、列出文件、无循环出口；改前构建上记录循环出口在 */
  function judgeFive(tag, which, sites, files) {
    const expectCode = { reviewStart: 2, topicClaim: 2, topicResolve: 2, hookPreWrite: 2, gateCheck: 65 };
    for (const [k, r] of Object.entries(sites)) {
      const t = out(r);
      check(`${tag}/${which}/${k} 退出码`, r.code === expectCode[k], `退 ${r.code}（应 ${expectCode[k]}）`);
      if (which === 'after') {
        const hasBody = t.includes(BODY) || t.includes(JSON.stringify(BODY).slice(1, -1));
        const listed = files.every((f) => t.includes(f));
        check(`${tag}/after/${k} 出口`, hasBody && listed && !isCircular(t), `共用段=${hasBody}、列出文件=${listed}、循环出口=${isCircular(t)}`);
      } else {
        check(`${tag}/before/${k} 复现循环出口`, isCircular(t), `改前文案含循环出口=${isCircular(t)}`);
      }
    }
  }

  for (const which of ['before', 'after']) {
    const b = builds[which];
    const cells = {};
    readout.cells[which] = cells;

    // ── A：已提交、工作树里改坏 ──
    {
      const fx = await fixture(`${which}-A`, `A-已提交改坏`);
      await syncReview(b, fx);
      await abandon(b, fx);
      await git(fx.root, ['add', '-A']);
      await git(fx.root, ['commit', '-q', '-m', 'run1', '--no-verify']);
      const [rf] = await runFiles(fx.metaDir);
      const file = path.join(fx.metaDir, rf);
      await fs.writeFile(file, '{}\n');
      const sites = await fiveSites(b, fx);
      judgeFive('A', which, sites, [file]);
      const pc = await preCommit(b, fx);
      const restore = await git(fx.root, ['restore', file]);
      const resolveAfter = await topicResolve(b, fx);
      const rerun = await syncReview(b, fx);
      check(`A/${which} 出口走通`, restore.code === 0 && resolveAfter.code === 0 && rerun.code === 0,
        `restore ${restore.code} → topic resolve ${resolveAfter.code} → 重跑 ${rerun.code}`);
      cells.A = { sites: Object.fromEntries(Object.entries(sites).map(([k, r]) => [k, rec(r)])), preCommit: rec(pc), restore: rec(restore), resolveAfter: { code: resolveAfter.code }, rerun: { code: rerun.code } };
    }

    // ── B：尚未提交就坏 ──
    {
      const fx = await fixture(`${which}-B`, `B-未提交就坏`);
      await syncReview(b, fx);
      await abandon(b, fx);
      const [rf] = await runFiles(fx.metaDir);
      const file = path.join(fx.metaDir, rf);
      await fs.writeFile(file, '{}\n');
      const sites = await fiveSites(b, fx);
      judgeFive('B', which, sites, [file]);
      const pc = await preCommit(b, fx);
      const restore = await git(fx.root, ['restore', file]);
      const rerun = await startReview(b, fx);
      await fs.unlink(file);
      const resolveAfterDel = await topicResolve(b, fx);
      const pcAfterDel = await preCommit(b, fx);
      check(`B/${which} 工具内没有出口`,
        restore.code !== 0 && rerun.code === 2 && pc.code === 2,
        `restore 退 ${restore.code}（应非 0）、重跑退 ${rerun.code}（应 2）、提交锚退 ${pc.code}（应 2）`);
      check(`B/${which} 删除只把拒绝挪到提交时`,
        resolveAfterDel.code === 0 && pcAfterDel.code === 2 && out(pcAfterDel).includes('运行清单已丢失'),
        `删后 topic resolve 退 ${resolveAfterDel.code}、提交锚退 ${pcAfterDel.code}、含「运行清单已丢失」=${out(pcAfterDel).includes('运行清单已丢失')}`);
      cells.B = { sites: Object.fromEntries(Object.entries(sites).map(([k, r]) => [k, rec(r)])), preCommit: rec(pc), restore: rec(restore), rerun: { code: rerun.code }, resolveAfterDel: { code: resolveAfterDel.code }, preCommitAfterDel: rec(pcAfterDel) };
    }

    // ── C：本工具版本落后于写入方 ──
    {
      const fx = await fixture(`${which}-C`, `C-版本落后`);
      await fs.mkdir(fx.metaDir, { recursive: true });
      await fs.chmod(fx.stageDir, 0o555);
      let w;
      try { w = await syncReview(b, fx); } finally { await fs.chmod(fx.stageDir, 0o755); }
      const [rf] = await runFiles(fx.metaDir);
      const file = path.join(fx.metaDir, rf);
      const meta = JSON.parse(await fs.readFile(file, 'utf8'));
      await git(fx.root, ['add', '-A']);
      await git(fx.root, ['commit', '-q', '-m', 'run1', '--no-verify']);
      const status = await git(fx.root, ['status', '--porcelain', '--', file]);
      const lagResolve = await topicResolve(builds.lagging, fx);
      const lagGate = await gateCheck(builds.lagging, fx);
      const newResolve = await topicResolve(b, fx);
      check(`C/${which} 构造`, w.code !== 0 && meta.termination?.by === 'sync_exception' && status.stdout === '',
        `写入方退 ${w.code}、termination.by=${meta.termination?.by}、git status 干净=${status.stdout === ''}`);
      check(`C/${which} 落后版本判读不出`, lagResolve.code === 2 && /读不出/.test(out(lagResolve)) && lagGate.code === 65,
        `落后版本 topic resolve 退 ${lagResolve.code}、gate --check 退 ${lagGate.code}`);
      check(`C/${which} 换回不旧于写入方的版本即恢复`, newResolve.code === 0, `topic resolve 退 ${newResolve.code}`);
      cells.C = { writer: { code: w.code, termination: meta.termination }, gitStatusClean: status.stdout === '', laggingTopicResolve: rec(lagResolve), laggingGateCheck: rec(lagGate), resolveWithWriterBuild: { code: newResolve.code } };
    }

    // ── D：运行中途被打断 ──
    {
      const fx = await fixture(`${which}-D`, `D-中途打断`);
      const st = await startReview(b, fx, HANG);
      const js = JSON.parse(st.stdout.slice(st.stdout.indexOf('{')));
      await new Promise((r) => setTimeout(r, 1500));
      const [rf] = await runFiles(fx.metaDir);
      const skel = JSON.parse(await fs.readFile(path.join(fx.metaDir, rf), 'utf8'));
      let killed = false;
      try { process.kill(-js.worker_pid, 'SIGKILL'); killed = true; } catch { /* 组已不在 */ }
      await new Promise((r) => setTimeout(r, 1000));
      const resolve1 = await topicResolve(b, fx);
      const wait = await cli(b, fx.root, ['review', '--wait', js.run_id, '--timeout', '5', '--json'], HANG);
      const after = JSON.parse(await fs.readFile(path.join(fx.metaDir, rf), 'utf8'));
      const resolve2 = await topicResolve(b, fx);
      check(`D/${which} 骨架可读、不进本状态`,
        skel.status === 'running' && killed && resolve1.code === 0 && resolve2.code === 0,
        `骨架 status=${skel.status}、按组结束 worker=${killed}、打断后 topic resolve 退 ${resolve1.code}、--wait 收尾后（status=${after.status}，termination=${JSON.stringify(after.termination)}）退 ${resolve2.code}`);
      cells.D = { skeletonStatus: skel.status, killed, resolveAfterKill: { code: resolve1.code }, wait: { code: wait.code }, finalStatus: after.status, termination: after.termination, resolveAfterWait: { code: resolve2.code } };
    }

    // ── E1 / E2 / E3：approve 分叉 ──
    for (const variant of ['E1', 'E2', 'E3']) {
      const fx = await fixture(`${which}-${variant}`, `${variant}-审批分叉`);
      const runId = await toAwaiting(b, fx);
      const file = path.join(fx.metaDir, `run-${runId}.json`);
      if (variant === 'E1') {
        const stPath = path.join(fx.root, TD, 'state.json');
        const st = JSON.parse(await fs.readFile(stPath, 'utf8'));
        for (const g of Object.values(st.gates)) if (g.topic === fx.topic) g.run_id = '29990101T000000Z';
        await fs.writeFile(stPath, JSON.stringify(st, null, 2));
      } else {
        if (variant === 'E3') {
          await git(fx.root, ['add', '-A']);
          await git(fx.root, ['commit', '-q', '-m', 'run1', '--no-verify']);
        }
        await fs.writeFile(file, '{}\n');
      }
      const ap = await approve(b, fx);
      const t = out(ap);
      const cell = { approve: rec(ap) };
      check(`${variant}/${which} approve 退 65`, ap.code === 65, `退 ${ap.code}`);
      if (which === 'after' && variant !== 'E1') {
        const restoreFirst = t.indexOf('恢复后直接重新 approve');
        const abandonAt = t.indexOf('dual-abandon');
        check(`${variant}/after approve 出口`, t.includes(BODY) && t.includes(file) && restoreFirst >= 0 && abandonAt > restoreFirst && !isCircular(t),
          `共用段=${t.includes(BODY)}、列出文件=${t.includes(file)}、恢复先于 abandon=${restoreFirst >= 0 && abandonAt > restoreFirst}`);
      }
      if (which === 'after' && variant === 'E1') {
        check('E1/after approve 出口', t.includes('恢复后直接重新 approve') && t.includes('dual-abandon'), '先恢复、恢复不了才 abandon 两句都在');
      }
      if (variant === 'E3') {
        const restore = await git(fx.root, ['restore', file]);
        const again = await approve(b, fx);
        check(`E3/${which} 恢复后直接重新 approve`, restore.code === 0 && again.code === 0,
          `restore 退 ${restore.code} → 重新 approve 退 ${again.code}`);
        cell.restore = { code: restore.code };
        cell.approveAgain = rec(again);
      } else {
        const ab = await abandon(b, fx, '本机闸门与归档分叉');
        const rerun = await syncReview(b, fx);
        cell.abandon = { code: ab.code };
        cell.rerun = rec(rerun);
        if (variant === 'E1') {
          check(`E1/${which} abandon 后重跑走通`, ab.code === 0 && rerun.code === 0, `abandon ${ab.code} → 重跑 ${rerun.code}`);
        } else {
          check(`E2/${which} abandon 走通、重跑仍被拒`, ab.code === 0 && rerun.code === 2, `abandon ${ab.code} → 重跑 ${rerun.code}`);
          if (which === 'after') {
            const rt = out(rerun);
            check('E2/after 重跑被拒时给同一段出口', rt.includes(BODY) && rt.includes(file) && !isCircular(rt), `共用段=${rt.includes(BODY)}、列出文件=${rt.includes(file)}`);
          } else {
            check('E2/before 重跑被拒时复现循环出口', isCircular(out(rerun)), `含循环出口=${isCircular(out(rerun))}`);
          }
        }
      }
      cells[variant] = cell;
    }

    // ── F：最新一份坏、较旧一份可读（EV-73，只记录） ──
    {
      const fx = await fixture(`${which}-F`, `F-较新一份坏`);
      await syncReview(b, fx);
      await abandon(b, fx);
      await new Promise((r) => setTimeout(r, 1100));
      await syncReview(b, fx);
      await abandon(b, fx);
      const files = await runFiles(fx.metaDir);
      const newest = path.join(fx.metaDir, files.at(-1));
      await fs.writeFile(newest, '{}\n');
      const resolve = await topicResolve(b, fx);
      const g = await gateCheck(b, fx);
      check(`F/${which} Driver 侧判读不出`, resolve.code === 2, `topic resolve 退 ${resolve.code}；gate --check 退 ${g.code}（EV-73：采信较旧一份，只记录）`);
      cells.F = { runs: files.length, topicResolve: rec(resolve), gateCheck: rec(g) };
    }
  }
} catch (e) {
  // 中途抛错也要把已跑出的读数留下来（代码双审 r1 CODEX-04），并记成一条失败
  readout.error = String(e?.stack ?? e);
  check('矩阵跑完', false, `中途抛错：${String(e?.message ?? e).split('\n')[0]}`);
} finally {
  await fs.rm(base, { recursive: true, force: true });
  readout.finished_at = new Date().toISOString();
  readout.summary = { total: results.length, pass: results.filter((r) => r.ok).length, fail: results.filter((r) => !r.ok).map((r) => r.id) };
  await fs.writeFile(path.join(HERE, 'acceptance-readout.json'), JSON.stringify(readout, null, 2) + '\n');
}

console.log(`\n合计 ${readout.summary.pass}/${readout.summary.total}`);
process.exit(readout.summary.fail.length === 0 ? 0 : 1);
