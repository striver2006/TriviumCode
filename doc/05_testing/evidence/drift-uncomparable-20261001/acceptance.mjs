#!/usr/bin/env node
/**
 * 「漂移比不了不放行」（EV-139）零配额验收（计划 r2 §5.4）。
 *
 * **不碰真实 HOME、不碰本仓归档**：审核者换成桩（`TRIVIUM_STUB_CRITIC`），不发起任何模型调用；每格一个夹具，
 * 全部建在一个 mkdtemp 目录下，运行目录（`runtime.run_root`）也在里面；收尾只删 mkdtemp 的返回值。
 *
 * 两份构建：
 *   - 改前：`git archive 9db67ca` 导出到 mkdtemp 下，`node_modules` 软链本仓，`node scripts/build.mjs`；
 *   - 改后：本仓工作树当前的 `skills/dual-critic/scripts/trivium.cjs`（跑前先 `node scripts/build.mjs`）。
 *   两份 bundle 记 sha256 并断言不同；都直接 `node <bundle>` 调用，资产根经 `TRIVIUM_ASSET_ROOT` 指向各自的 `skills/dual-critic`。
 *
 * 审查期间删对象：改前构建没有 `prune_objects` 桩，所以两边统一用外部手段——gemini `ok`、glm `hang_cli`（`sleepS: 60`，
 * 这就是窗口长度；到点自然结束后按 timeout 失败，`--allow-single` 让本轮降级续跑）。`--start` 返回时归档骨架 run.json
 * 已含 `snapshot.tree_hash`（冻结完成的确定性标志），脚本随即 `git prune --expire=now` 并改 `src/b.ts`。
 *
 * 格：
 *   A 无清理（对照）：新旧都应 changed: false、退出码相同；
 *   B 清理 + 缺省配置：旧 changed: false（静默放行）；新 unknown_reason.cause = object_gone、policy fail、退 1；
 *   C 清理 + on_drift_related: warn（只跑新构建）：policy warn、退 0、unknown_reason 在。
 * 旧构建 B 的判据（计划双审 CODEX-02 ≡ GLM-01）：changed: false **且**跑后 tree 里 src/b.ts 的 blob 等于改后内容的
 * hash-object——前者在送审 tree 还在时不可能（会列出 src/b.ts），后者证明改文件早于复算。外部 cat-file 只作旁证。
 *
 * V0：git 清理对不可达 tree 的影响、diffTrees 与 diffTreesNameStatus 同集、diff-tree 与 workTreeHash 耗时。
 *
 * 用法：node doc/05_testing/evidence/drift-uncomparable-20261001/acceptance.mjs
 * 读数写进同目录 `acceptance-readout.json`，终端出摘要；任一判据不过退 1。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pexec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const OLD_COMMIT = '9db67ca';
const TOPIC = '验收-漂移比不了';
const today = new Date().toISOString().slice(0, 10);
const WINDOW_S = 60;
const MAX_ATTEMPTS = 2;

const { encodeStubConfig, STUB_ENV_VAR } = await import(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const gitMod = await import(path.join(ROOT, 'dist/test/src/trivium/util/git.js'));
const STUB = encodeStubConfig({ gemini: { mode: 'ok' }, glm: { mode: 'hang_cli', sleepS: WINDOW_S } });

const results = [];
const readout = { old_commit: OLD_COMMIT, window_s: WINDOW_S, builds: {}, cells: {}, v0: {} };
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`); };

async function sh(cwd, bin, args, env = {}, timeout = 600_000) {
  try {
    const o = await pexec(bin, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, timeout });
    return { code: 0, stdout: o.stdout, stderr: o.stderr };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);
const sha256 = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');

/** 归一化：主题名、run_id、十六进制对象名、临时路径、pid 换成占位，供新旧文本对照 */
function normalize(s) {
  return String(s ?? '')
    .replaceAll(TOPIC, '〈主题〉')
    .replace(/\d{8}T\d{6}Z/g, '〈run_id〉')
    .replace(/\b[0-9a-f]{40}\b|\b[0-9a-f]{64}\b/g, '〈对象名〉')
    .replace(/\b[0-9a-f]{12}\b/g, '〈短对象名〉')
    .replace(/\/(?:private\/)?var\/folders\/[^\s"'）)]+/g, '〈临时路径〉')
    .replace(/\b(pid|worker_pid)\D{0,3}\d+/g, '$1 〈pid〉')
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '〈时间戳〉');
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev139-accept-'));
try {
  // ── 两份构建 ──
  const oldDir = path.join(base, 'old-build');
  await fs.mkdir(oldDir, { recursive: true });
  const arch = await sh(ROOT, 'sh', ['-c', `git archive ${OLD_COMMIT} | tar -x -C "$1"`, 'sh', oldDir]);
  if (arch.code !== 0) throw new Error(`git archive 失败：${arch.stderr}`);
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(oldDir, 'node_modules'));
  const ob = await sh(oldDir, process.execPath, ['scripts/build.mjs']);
  if (ob.code !== 0) throw new Error(`改前构建失败：${ob.stdout}${ob.stderr}`);
  const builds = {
    old: { cli: path.join(oldDir, 'skills/dual-critic/scripts/trivium.cjs'), assets: path.join(oldDir, 'skills/dual-critic') },
    new: { cli: path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs'), assets: path.join(ROOT, 'skills/dual-critic') },
  };
  for (const [k, b] of Object.entries(builds)) readout.builds[k] = { bundle_sha256: await sha256(b.cli) };
  check('构建不同', readout.builds.old.bundle_sha256 !== readout.builds.new.bundle_sha256,
    `old ${readout.builds.old.bundle_sha256.slice(0, 12)} / new ${readout.builds.new.bundle_sha256.slice(0, 12)}`);
  const oldHasFix = (await fs.readFile(builds.old.cli, 'utf8')).includes('unknown_reason');
  const newHasFix = (await fs.readFile(builds.new.cli, 'utf8')).includes('unknown_reason');
  check('构建内容', !oldHasFix && newHasFix, `改前 bundle 含 unknown_reason=${oldHasFix}，改后=${newHasFix}`);

  const cli = (b, cwd, args) => sh(cwd, process.execPath, [b.cli, ...args], {
    TRIVIUM_ASSET_ROOT: b.assets,
    [STUB_ENV_VAR]: STUB,
  });

  /** 一格：建夹具 → --start → （可选）清理并改文件 → 等到终态 → 读 run.json 与终态 message */
  async function cell(buildKey, name, { prune, extraReview = [] }) {
    const b = builds[buildKey];
    const root = path.join(base, `${buildKey}-${name}`);
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    for (const f of ['a.ts', 'b.ts']) await fs.writeFile(path.join(root, 'src', f), `export const ${f[0]} = 1;\n`);
    await fs.writeFile(path.join(root, 'README.md'), '# 验收夹具\n');
    await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
    await fs.writeFile(path.join(root, '.trivium/config.yaml'), [
      'runtime:', `  run_root: ${path.join(base, 'runs', `${buildKey}-${name}`)}`,
      'review:', '  default_critics: [gemini, glm]',
      '  timeout_s:', '    plan: 300', '    code: 300', '    bug: 300', '  wait_timeout_s: 30',
      ...extraReview.map((l) => `  ${l}`),
      'verify:', '  build: []', '  test: []', '',
    ].join('\n'));
    await git(root, ['init', '-q', '-b', 'main']);
    await git(root, ['add', '-A']);
    await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
    // 未跟踪文件：让送审快照的 tree 不等于 HEAD 的 tree（否则它可达、清理不掉）
    await fs.writeFile(path.join(root, 'src/untracked-seed.ts'), 'export const seed = 1;\n');
    const stageDir = path.join(root, '.reviews', TOPIC, 'plan');
    await fs.mkdir(stageDir, { recursive: true });
    await fs.writeFile(path.join(stageDir, `${today}-${TOPIC}-claude.md`), '# 待审计划\n\n验收漂移比不了。\n');

    const t0 = Date.now();
    const started = await cli(b, root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', TOPIC,
      '--focus', '验收', '--allow-single', '--json']);
    if (started.code !== 0) throw new Error(`[${buildKey}-${name}] --start 失败：${started.stdout}${started.stderr}`);
    const runId = JSON.parse(started.stdout.slice(started.stdout.indexOf('{'))).run_id;
    const runJson = path.join(stageDir, '_meta', `run-${runId}.json`);
    const skeleton = JSON.parse(await fs.readFile(runJson, 'utf8'));
    const treeHash = skeleton.snapshot?.tree_hash;
    if (!treeHash) throw new Error(`[${buildKey}-${name}] 骨架 run.json 没有 snapshot.tree_hash`);

    const r = { build: buildKey, run_id: runId, tree_hash: treeHash, pruned: false };
    if (prune) {
      const p = await git(root, ['prune', '--expire=now']);
      r.prune_code = p.code;
      r.prune_at_ms = Date.now() - t0;
      r.cat_file_after_prune = (await git(root, ['cat-file', '-e', treeHash])).code;
      await fs.appendFile(path.join(root, 'src/b.ts'), '// 审查期间改的一行\n');
      r.mutated_at_ms = Date.now() - t0;
      r.pruned = true;
    }
    let code = 73;
    for (let i = 0; i < 30 && code === 73; i++) code = (await cli(b, root, ['review', '--wait', runId, '--timeout', '20'])).code;
    r.exit_code = code;
    r.elapsed_ms = Date.now() - t0;
    const meta = JSON.parse(await fs.readFile(runJson, 'utf8'));
    r.status = meta.status;
    r.review_mode = meta.review_mode;
    r.degraded_reason = meta.degraded_reason ?? null;
    r.drift = meta.snapshot.drift;
    r.after_tree_hash = meta.snapshot.after_tree_hash ?? null;
    const term = await cli(b, root, ['review', '--wait', runId, '--timeout', '5', '--json']);
    const termJson = JSON.parse(term.stdout.slice(term.stdout.indexOf('{')));
    r.message = termJson.message ?? null;
    r.message_normalized = normalize(r.message);
    if (prune && r.after_tree_hash) {
      // 跑后 tree 里 src/b.ts 的 blob 是否就是改后的内容 ⇒ 改文件早于复算
      const inAfter = (await git(root, ['rev-parse', `${r.after_tree_hash}:src/b.ts`])).stdout.trim();
      const nowBlob = (await git(root, ['hash-object', 'src/b.ts'])).stdout.trim();
      r.after_tree_has_mutation = inAfter.length > 0 && inAfter === nowBlob;
    }
    return r;
  }

  async function cellWithRetry(buildKey, name, opts, accept) {
    let last;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      last = await cell(buildKey, `${name}-a${attempt}`, opts);
      last.attempt = attempt;
      if (accept(last)) return last;
    }
    return last;
  }

  // ── A：无清理（对照）──
  for (const k of ['old', 'new']) readout.cells[`A-${k}`] = await cell(k, 'A', { prune: false });
  for (const k of ['old', 'new']) {
    const r = readout.cells[`A-${k}`];
    check(`A ${k}`, r.drift.changed === false && r.drift.unknown_reason === undefined,
      `changed=${r.drift.changed}、退 ${r.exit_code}、status ${r.status}、${r.review_mode}`);
  }
  check('A 新旧退出码相同', readout.cells['A-old'].exit_code === readout.cells['A-new'].exit_code,
    `old ${readout.cells['A-old'].exit_code} / new ${readout.cells['A-new'].exit_code}`);

  // ── B：清理 + 缺省配置 ──
  const oldB = await cellWithRetry('old', 'B', { prune: true }, (r) => r.after_tree_has_mutation === true);
  readout.cells['B-old'] = oldB;
  check('B old 窗口命中', oldB.after_tree_has_mutation === true,
    `跑后 tree 含改后的 src/b.ts（第 ${oldB.attempt} 次）；清理后 cat-file 退 ${oldB.cat_file_after_prune}（旁证）`);
  check('B old 静默放行（bug 复现）', oldB.drift.changed === false && oldB.exit_code === 0 && oldB.status === 'success',
    `changed=${oldB.drift.changed}、files=${JSON.stringify(oldB.drift.files)}、退 ${oldB.exit_code}、status ${oldB.status}`);

  const newB = await cellWithRetry('new', 'B', { prune: true }, (r) => r.after_tree_has_mutation === true);
  readout.cells['B-new'] = newB;
  check('B new 窗口命中', newB.after_tree_has_mutation === true, `第 ${newB.attempt} 次`);
  check('B new 判比不了并按 fail 处置',
    newB.drift.unknown_reason?.cause === 'object_gone' && newB.drift.policy === 'fail' && newB.drift.changed === true
      && newB.exit_code === 1 && newB.status === 'failed',
    `unknown_reason=${JSON.stringify(newB.drift.unknown_reason)}、policy ${newB.drift.policy}、退 ${newB.exit_code}、status ${newB.status}`);
  check('B new 告警', /比不了改了哪些文件/.test(newB.message ?? '') && /策略 fail/.test(newB.message ?? ''),
    '终态 message 含告警与策略');

  // ── C：清理 + on_drift_related: warn（只跑新构建）──
  const newC = await cellWithRetry('new', 'C', { prune: true, extraReview: ['on_drift_related: warn'] },
    (r) => r.after_tree_has_mutation === true);
  readout.cells['C-new'] = newC;
  check('C new 按 warn 处置', newC.drift.unknown_reason?.cause === 'object_gone' && newC.drift.policy === 'warn'
      && newC.exit_code === 0 && newC.status === 'success' && /请人工核对/.test(newC.message ?? ''),
    `policy ${newC.drift.policy}、退 ${newC.exit_code}、status ${newC.status}`);

  // ── V0：git 清理实测、同集、耗时 ──
  {
    const v = path.join(base, 'v0');
    await fs.mkdir(v, { recursive: true });
    await fs.writeFile(path.join(v, 'a'), 'a\n');
    await git(v, ['init', '-q', '-b', 'main']);
    await git(v, ['add', '-A']);
    await git(v, ['commit', '-q', '-m', 'i']);
    await fs.writeFile(path.join(v, 'b'), 'b\n');
    const tree = await gitMod.workTreeHash(v);
    const exists = async () => (await git(v, ['cat-file', '-e', tree])).code;
    await git(v, ['gc', '-q']);
    readout.v0.after_gc_default = await exists();
    await git(v, ['maintenance', 'run', '--task=loose-objects', '--quiet']);
    readout.v0.after_maintenance_loose_objects = await exists();
    await git(v, ['gc', '-q', '--prune=now']);
    readout.v0.after_gc_prune_now = await exists();
    const dt = await git(v, ['diff-tree', '-r', '--name-only', tree, 'HEAD^{tree}']);
    readout.v0.diff_tree_after_prune = { code: dt.code, stderr: dt.stderr.trim().split('\n')[0] };
    readout.v0.git_version = (await sh(v, 'git', ['--version'])).stdout.trim();
    check('V0 缺省清理不删', readout.v0.after_gc_default === 0 && readout.v0.after_maintenance_loose_objects === 0,
      `gc 缺省后 cat-file 退 ${readout.v0.after_gc_default}、maintenance 后退 ${readout.v0.after_maintenance_loose_objects}`);
    check('V0 立即清理即删', readout.v0.after_gc_prune_now === 1 && dt.code === 128,
      `--prune=now 后 cat-file 退 ${readout.v0.after_gc_prune_now}、diff-tree 退 ${dt.code}`);

    // 同集：本仓两棵相距较远的 tree，普通路径
    const tA = (await git(ROOT, ['rev-parse', `${OLD_COMMIT}~100^{tree}`])).stdout.trim();
    const tB = (await git(ROOT, ['rev-parse', `${OLD_COMMIT}^{tree}`])).stdout.trim();
    let t = Date.now();
    const lenient = await gitMod.diffTrees(ROOT, tA, tB);
    const lenientMs = Date.now() - t;
    t = Date.now();
    const strict = (await gitMod.diffTreesNameStatus(ROOT, tA, tB)).map((c) => c.path);
    const strictMs = Date.now() - t;
    const same = JSON.stringify([...lenient].sort()) === JSON.stringify([...strict].sort());
    readout.v0.same_set = { from: `${OLD_COMMIT}~100^{tree}`, to: `${OLD_COMMIT}^{tree}`, files: strict.length, same, lenient_ms: lenientMs, strict_ms: strictMs };
    check('V0 同集', same && strict.length > 0, `${strict.length} 个文件，两种输出同集；diffTrees ${lenientMs} ms、diffTreesNameStatus ${strictMs} ms`);
    t = Date.now();
    await gitMod.workTreeHash(ROOT);
    readout.v0.work_tree_hash_ms = Date.now() - t;
    check('V0 耗时', true, `本仓 workTreeHash ${readout.v0.work_tree_hash_ms} ms（与 diff-tree 同一 120 s 缺省超时）`);
  }
} finally {
  readout.results = results;
  await fs.writeFile(path.join(HERE, 'acceptance-readout.json'), JSON.stringify(readout, null, 2) + '\n');
  await fs.rm(base, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length > 0 ? 1 : 0);
