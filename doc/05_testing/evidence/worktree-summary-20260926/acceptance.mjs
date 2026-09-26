#!/usr/bin/env node
/**
 * 「审批前工作树摘要」零配额验收（计划 r2 §3.5）。
 *
 * **不碰真实 HOME、不碰本仓归档**：用仓库构建出的 `skills/dual-critic/scripts/trivium.cjs`，资产根经 `TRIVIUM_ASSET_ROOT`
 * 指向工作树；审核者换成桩（`TRIVIUM_STUB_CRITIC`），不发起任何模型调用。每格一个夹具，全部建在一个 mkdtemp 目录下，
 * 运行目录（`runtime.run_root`）也在里面；收尾只删 mkdtemp 的返回值。
 *
 * 名义 Driver 取 codex（L2、没有 Hook），走命令 B，复现 M10b 第 4 步 3-4 的形态：闸门期在终端改业务文件，再审批。
 *
 *   B1 闸门期改 README.md、新建 NOTES.md ⇒ approve 退 0、照常落审批，输出列出两者，abandon 写法按 codex（`$dual-abandon`）；
 *   B2 闸门期没有改动 ⇒ approve 退 0，输出「无改动」一行；
 *   B3 审批前 `git gc --prune=now` 清掉基线 ⇒ approve 退 0，报「取不到：基线对象已不在对象库」，不报「无改动」；
 *   B4 闸门期连续提交 5 次后跑 `git gc --auto`（缺省配置，与 `-c gc.auto=1` 强制各一次）⇒ 记录基线对象是否仍在
 *      （计划双审 CODEX-08：按实测定口径，不按推断写），并核对 approve 仍列出提交掉的改动；
 *   B5 停点出口：`--check` 自动立停点时已列出裁决期的改动，且说「审批时会再列出一次」。
 * 每格都核：审批前后 run.json 逐字节不变（EV-133 的不变量）。
 *
 * 用法：node doc/05_testing/evidence/worktree-summary-20260926/acceptance.mjs
 * 读数写进同目录 `acceptance-readout.json`，终端出摘要。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pexec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const CLI = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
const { encodeStubConfig, STUB_ENV_VAR } = await import(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const STUB = encodeStubConfig({ gemini: { mode: 'ok' }, glm: { mode: 'ok' } });
const TOPIC = '验收-工作树摘要';
const DRIVER = 'codex';
const today = new Date().toISOString().slice(0, 10);

const results = [];
const raw = {};
const check = (id, ok, detail) => { results.push({ id, ok, detail }); console.log(`${ok ? '✓' : '✖'} ${id}：${detail}`); };

async function sh(cwd, bin, args, env = {}) {
  try {
    const o = await pexec(bin, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, stdout: o.stdout, stderr: o.stderr };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
const cli = (cwd, args) => sh(cwd, process.execPath, [CLI, ...args], {
  TRIVIUM_ASSET_ROOT: path.join(ROOT, 'skills/dual-critic'),
  [STUB_ENV_VAR]: STUB,
});
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);

/** 建一个夹具项目，跑完一轮命令 B 的审查并写好裁决件（尚未 --check） */
async function fixture(base, name) {
  const root = path.join(base, name);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  for (const f of ['a.ts', 'b.ts']) await fs.writeFile(path.join(root, 'src', f), `export const ${f[0]} = 1;\n`);
  await fs.writeFile(path.join(root, 'README.md'), '# 验收夹具\n');
  await fs.mkdir(path.join(root, '.trivium'), { recursive: true });
  await fs.writeFile(path.join(root, '.trivium/config.yaml'), [
    'runtime:', `  run_root: ${path.join(base, 'runs', name)}`,
    'review:', '  default_critics: [gemini, glm]',
    '  timeout_s:', '    plan: 120', '    code: 120', '    bug: 120', '  wait_timeout_s: 30',
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);

  const stageDir = path.join(root, '.reviews', TOPIC, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, `${today}-${TOPIC}-${DRIVER}.md`), '# 待审计划\n\n## 一、目标\n\n验收工作树摘要。\n');

  const started = await cli(root, ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', TOPIC, '--driver', DRIVER, '--focus', '验收', '--json']);
  if (started.code !== 0) throw new Error(`review --start 失败：${started.stdout}${started.stderr}`);
  const runId = JSON.parse(started.stdout.slice(started.stdout.indexOf('{'))).run_id;
  let code = 73;
  for (let i = 0; i < 20 && code === 73; i++) code = (await cli(root, ['review', '--wait', runId, '--timeout', '20'])).code;
  if (code !== 0) throw new Error(`review --wait 退 ${code}`);

  await fs.writeFile(path.join(stageDir, `${today}-${TOPIC}-revised-${DRIVER}.md`), [
    '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan', `role: ${DRIVER}`, 'kind: revised', `run_id: ${runId}`,
    'addresses:', `  - ${today}-${TOPIC}-gemini.md`, `  - ${today}-${TOPIC}-glm.md`, '---', '',
    '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |', '| :--- | :--- | :--- | :--- | :--- | :--- |',
    '| AGY-01 | gemini | blocker | 接受 | 验收用 | §1 |', '| GLM-01 | glm | blocker | 接受 | 验收用 | §1 |', '',
  ].join('\n'));
  const runJson = path.join(stageDir, '_meta', `run-${runId}.json`);
  return { root, stageDir, runId, runJson };
}

const checkStop = (fx) => cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check']);
const approve = (fx) => cli(fx.root, ['approve', '--topic', TOPIC, '--stage', 'plan', '--reason', '验收']);
async function approvedLast(fx) {
  const task = JSON.parse(await fs.readFile(path.join(fx.root, '.reviews', TOPIC, 'task.json'), 'utf8'));
  return task.approvals.at(-1)?.decision === 'approved';
}

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-wts-accept-'));
try {
  // ── B1：3-4 形态 ──
  {
    const fx = await fixture(base, 'b1');
    const c = await checkStop(fx);
    check('B1 停点', c.code === 0, `--check 退 ${c.code}`);
    const before = await fs.readFile(fx.runJson, 'utf8');
    await fs.appendFile(path.join(fx.root, 'README.md'), '闸门期在终端追加的一行\n');
    await fs.writeFile(path.join(fx.root, 'NOTES.md'), '闸门期新建\n');
    const r = await approve(fx);
    raw.B1 = r;
    check('B1 退出码', r.code === 0, `approve 退 ${r.code}（期望 0：摘要只告知）`);
    check('B1 列出改动', /\n {2}M {2}README\.md\n/.test(r.stdout) && /\n {2}A {2}NOTES\.md\n/.test(r.stdout), '列出 M README.md 与 A NOTES.md');
    check('B1 先打印再落审批', r.stdout.indexOf('工作树改动摘要') >= 0 && r.stdout.indexOf('工作树改动摘要') < r.stdout.indexOf('已通过'), '摘要在「已通过」之前');
    check('B1 abandon 写法按 codex', r.stdout.includes('$dual-abandon --topic'), '含 $dual-abandon');
    check('B1 审批落盘', await approvedLast(fx), 'task.json 最后一条为 approved');
    check('B1 run.json 不变', (await fs.readFile(fx.runJson, 'utf8')) === before, '--check 之后到 approve 之后逐字节一致');
  }
  // ── B2：无改动 ──
  {
    const fx = await fixture(base, 'b2');
    await checkStop(fx);
    const r = await approve(fx);
    raw.B2 = r;
    check('B2 无改动', r.code === 0 && /未被 \.gitignore 忽略的文件无改动（不含 \.reviews\/ 与 \.trivium\/）/.test(r.stdout), `退 ${r.code}，含「无改动」一行`);
  }
  // ── B3：基线被清 ──
  {
    const fx = await fixture(base, 'b3');
    await checkStop(fx);
    const gc = await git(fx.root, ['gc', '-q', '--prune=now']);
    const r = await approve(fx);
    raw.B3 = r;
    check('B3 基线被清', gc.code === 0 && r.code === 0 && /工作树改动摘要取不到：基线对象已不在对象库/.test(r.stderr) && !/无改动/.test(r.stdout + r.stderr),
      `gc 退 ${gc.code}，approve 退 ${r.code}，报「基线对象已不在对象库」、不报「无改动」`);
    check('B3 审批落盘', await approvedLast(fx), '摘要取不到也照常落审批');
  }
  // ── B4：闸门期多次提交 + gc --auto 的实测 ──
  {
    const fx = await fixture(base, 'b4');
    await checkStop(fx);
    const baseline = JSON.parse(await fs.readFile(fx.runJson, 'utf8')).snapshot.after_tree_hash;
    for (let i = 1; i <= 5; i++) {
      await fs.appendFile(path.join(fx.root, 'src/a.ts'), `// 闸门期提交 ${i}\n`);
      await git(fx.root, ['add', 'src/a.ts']);
      await git(fx.root, ['commit', '-q', '-m', `gate ${i}`, '--no-verify']);
    }
    const auto1 = await git(fx.root, ['gc', '--auto']);
    const exists1 = (await git(fx.root, ['cat-file', '-e', baseline])).code === 0;
    const auto2 = await git(fx.root, ['-c', 'gc.auto=1', 'gc', '--auto']);
    const exists2 = (await git(fx.root, ['cat-file', '-e', baseline])).code === 0;
    const packs = (await git(fx.root, ['count-objects', '-v'])).stdout.trim();
    const pruneExpire = (await git(fx.root, ['config', '--get', 'gc.pruneExpire'])).stdout.trim() || '（未设，git 缺省 2.weeks.ago）';
    raw.B4_readings = { baseline, gc_auto_default: { code: auto1.code, baseline_exists_after: exists1 }, gc_auto_forced: { code: auto2.code, baseline_exists_after: exists2 }, count_objects: packs, gc_pruneExpire: pruneExpire };
    check('B4 实测记录', true, `缺省 gc --auto 后基线在=${exists1}；强制 gc.auto=1 后基线在=${exists2}；gc.pruneExpire=${pruneExpire}`);
    const r = await approve(fx);
    raw.B4 = r;
    if (exists2) {
      check('B4 提交掉的改动仍列出', r.code === 0 && /\n {2}M {2}src\/a\.ts\n/.test(r.stdout), `approve 退 ${r.code}，列出 M src/a.ts（git status 此时是干净的）`);
    } else {
      check('B4 基线被 gc --auto 清掉时如实报', r.code === 0 && /取不到/.test(r.stderr), `approve 退 ${r.code}，报取不到`);
    }
    const st = await git(fx.root, ['status', '--porcelain']);
    raw.B4_git_status = st.stdout;
  }
  // ── B5：停点出口 ──
  {
    const fx = await fixture(base, 'b5');
    await fs.writeFile(path.join(fx.root, 'NOTES.md'), '裁决期新建\n');
    const c = await checkStop(fx);
    raw.B5 = c;
    check('B5 停点列出改动', c.code === 0 && /\n {2}A {2}NOTES\.md\n/.test(c.stdout) && /审批时会再列出一次/.test(c.stdout), `--check 退 ${c.code}，列出 NOTES.md 并说审批时会再列出`);
  }
} finally {
  await fs.rm(base, { recursive: true, force: true });
}

await fs.writeFile(path.join(HERE, 'acceptance-readout.json'), JSON.stringify({ at: new Date().toISOString(), results, raw }, null, 2) + '\n', 'utf8');
const bad = results.filter((x) => !x.ok);
console.log(`\n结论：${results.length - bad.length}/${results.length} 通过`);
process.exit(bad.length === 0 ? 0 : 1);
