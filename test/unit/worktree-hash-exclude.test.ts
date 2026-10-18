/**
 * EV-221：工作树哈希排除归档根与 `.trivium/`，`git add` 遇文件中途消失时重试。
 *
 * 同一仓库两个主题并发审查时，一侧算工作树哈希的 `git add -A`（临时索引）会撞上另一侧正往归档根或 `.trivium/`
 * 原子写的临时文件——列目录时还在、stat 时已不在，报 `unable to stat … No such file or directory`，整轮判失败。
 * 修法两条：① 调用方传 `diffExcludePrefixes` 的结果，这几处不收进哈希（漂移判定与审批摘要本就剔除它们）；
 * ② `add` 报「文件中途消失」时至多重试 2 次，兜住排除面之外的原子写。
 *
 *   E：排除语义——被排除处的改、增、删不改哈希，业务改动照常改变哈希；漂移结论与不排除时相同；
 *      `GIT_LITERAL_PATHSPECS=1` 下照常；前缀按字面匹配、规范化与 `isOwn` 同口径；构建标识的排除与作用面不相交。
 *   R：重试——真实 git 的 clean 过滤器在 `add` 期间删掉一个已被列入的未跟踪文件（git 先列目录、再更新已跟踪文件、
 *      最后逐个 stat 未跟踪文件，过滤器在第二步跑），一次性的重试后成功、每次都删的用尽后抛；其它报错（假 git）不重试。
 *   S：审批摘要接线——当前树与同法算的基线相同。
 *   G：源码护栏——`workTreeHash` 调用点按文件登记，四处必须传 `exclude` 且取值来自 `diffExcludePrefixes`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import ts from 'typescript';
import {
  ADD_VANISHED_RETRIES, initFixtureRepo, isVanishedFileError, workTreeHash,
} from '../../src/trivium/util/git.js';
import { judgeDrift, type Snapshot } from '../../src/trivium/freeze.js';
import { diffExcludePrefixes } from '../../src/trivium/code-stage.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { INPUT_HASH_EXCLUDES, INSTALL_INPUT_PATHS, computeInputsSha256 } from '../../src/trivium/build-stamp.js';
import { summarizeWorkTree } from '../../src/trivium/worktree-summary.js';
import { run } from '../../src/trivium/util/exec.js';
import { scratchDir } from '../helpers/scratch.js';
import { FAKE_GIT_STDERR, writeFakeGit } from '../helpers/fake-git.js';
import { REPO_ROOT } from '../helpers/fixture.js';

// WIN_FILE_SKIP（Windows 移植）：依赖 POSIX 专属机制（shebang 假 CLI / PATH 垫片 / ps 故障注入）
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 依赖 POSIX 专属机制（shebang 假 CLI / PATH 垫片 / ps 故障注入）');
} else {

const EX = diffExcludePrefixes('.reviews');

/** 夹具仓库：业务文件、归档里一份已跟踪的计划、`.trivium/config.yaml`，全部提交 */
async function repo(): Promise<string> {
  const dir = await scratchDir('trivium-wthx-');
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.mkdir(path.join(dir, '.reviews/t/plan/_meta'), { recursive: true });
  await fs.mkdir(path.join(dir, '.trivium'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 1;\n');
  await fs.writeFile(path.join(dir, 'src/b.ts'), 'export const b = 2;\n');
  await fs.writeFile(path.join(dir, '.reviews/t/plan/2026-10-06-t-claude.md'), '# 计划\n');
  await fs.writeFile(path.join(dir, '.trivium/config.yaml'), 'archive_root: .reviews\n');
  await initFixtureRepo(dir);
  return dir;
}

async function headTree(dir: string): Promise<string> {
  const r = await run('git', ['rev-parse', 'HEAD^{tree}'], { cwd: dir, timeoutMs: 30_000 });
  assert.equal(r.code, 0, r.stderr);
  return r.stdout.trim();
}

/** 编排器自己的写入：改、增、删归档里的文件，往 `.trivium/` 写状态、锁与原子临时文件 */
async function touchOwn(dir: string): Promise<void> {
  await fs.writeFile(path.join(dir, '.reviews/t/plan/2026-10-06-t-claude.md'), '# 计划（改过）\n');
  await fs.writeFile(path.join(dir, '.reviews/t/plan/_meta/run-x.json'), '{}\n');
  await fs.writeFile(path.join(dir, '.reviews/t/plan/_meta/review-gemini-x.json.tmp-1-2'), '{}\n');
  await fs.mkdir(path.join(dir, '.reviews/u/plan'), { recursive: true });
  await fs.writeFile(path.join(dir, '.reviews/u/plan/2026-10-06-u-claude.md'), '# 另一个主题\n');
  await fs.mkdir(path.join(dir, '.trivium/lock'), { recursive: true });
  await fs.writeFile(path.join(dir, '.trivium/lock/t.lock'), '{}\n');
  await fs.writeFile(path.join(dir, '.trivium/lock/.task-t.lock.tmp-1-x'), '{}\n');
  await fs.writeFile(path.join(dir, '.trivium/state.json.tmp-1-2'), '{}\n');
}

function snap(treeHash: string): Snapshot {
  return {
    gitHead: null, treeHash, dirty: false, subjectSha256: 'SUBJ',
    subjectPath: '/x', denyPaths: [], diffText: null, takenAt: 'now',
  };
}

// ─────────────────────────── E：排除语义 ───────────────────────────

test('EV-221 E1：传了排除 ⇒ 归档根与 .trivium 下的改、增、删都不改哈希（等于 HEAD 的 tree）；不传时同一批改动改变哈希', async () => {
  const dir = await repo();
  const head = await headTree(dir);
  const before = await workTreeHash(dir, { exclude: EX });
  assert.equal(before, head, '干净工作树上排除与否都等于 HEAD 的 tree');
  const rawBefore = await workTreeHash(dir);
  await touchOwn(dir);
  await fs.rm(path.join(dir, '.reviews/t/plan/2026-10-06-t-claude.md'));
  assert.equal(await workTreeHash(dir, { exclude: EX }), before, '被排除处的改动进了哈希');
  assert.notEqual(await workTreeHash(dir), rawBefore, '前提：不排除时这批改动看得见');
});

test('EV-221 E2：传了排除 ⇒ 业务文件的改、增、删照常改变哈希，且被排除处干净时与不排除同值', async () => {
  const dir = await repo();
  const before = await workTreeHash(dir, { exclude: EX });
  await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 2;\n');
  const modified = await workTreeHash(dir, { exclude: EX });
  assert.notEqual(modified, before, '改已跟踪文件');
  assert.equal(modified, await workTreeHash(dir), '被排除处没动时排除与否同值');
  await fs.writeFile(path.join(dir, 'src/new.ts'), 'export const n = 1;\n');
  const added = await workTreeHash(dir, { exclude: EX });
  assert.notEqual(added, modified, '新增未跟踪文件');
  await fs.rm(path.join(dir, 'src/b.ts'));
  const removed = await workTreeHash(dir, { exclude: EX });
  assert.notEqual(removed, added, '删已跟踪文件');
  await touchOwn(dir);
  assert.equal(await workTreeHash(dir, { exclude: EX }), removed, '再叠加被排除处的改动，哈希不动');
});

test('EV-221 E3：漂移判定的结论与不排除时相同（只动归档与 .trivium / 无关业务改动 / 相关业务改动 / 增删业务文件）', async () => {
  const cases: Array<{ name: string; related: string[]; act: (dir: string) => Promise<void>; kind: string }> = [
    { name: '只动归档与 .trivium', related: ['src/a.ts'], act: touchOwn, kind: 'none' },
    {
      name: '无关业务改动 + 归档改动', related: ['src/a.ts'], kind: 'unrelated',
      act: async (dir) => { await touchOwn(dir); await fs.writeFile(path.join(dir, 'src/b.ts'), '// 改\n'); },
    },
    {
      name: '相关业务改动 + .trivium 改动', related: ['src/a.ts'], kind: 'related',
      act: async (dir) => { await touchOwn(dir); await fs.writeFile(path.join(dir, 'src/a.ts'), '// 改\n'); },
    },
    {
      name: '新增与删除业务文件', related: [], kind: 'unrelated',
      act: async (dir) => { await fs.writeFile(path.join(dir, 'src/c.ts'), '1\n'); await fs.rm(path.join(dir, 'src/b.ts')); },
    },
  ];
  for (const c of cases) {
    const dir = await repo();
    const beforeEx = await workTreeHash(dir, { exclude: EX });
    const beforeRaw = await workTreeHash(dir);
    await c.act(dir);
    const afterEx = await workTreeHash(dir, { exclude: EX });
    const afterRaw = await workTreeHash(dir);
    const base = { cfg: defaultConfig(), projectRoot: dir, afterSubjectSha256: 'SUBJ', relatedPaths: c.related, scratchGlobs: [], archiveRootRel: '.reviews' };
    const ex = await judgeDrift({ ...base, before: snap(beforeEx), afterTreeHash: afterEx });
    const raw = await judgeDrift({ ...base, before: snap(beforeRaw), afterTreeHash: afterRaw });
    assert.equal(ex.kind, c.kind, `${c.name}：${JSON.stringify(ex)}`);
    assert.deepEqual(ex, raw, `${c.name}：排除前后结论不同`);
  }
});

test('EV-221 E4：用户环境带 GIT_LITERAL_PATHSPECS=1 时照常算、照常排除（add 这一步钉回 0）', async () => {
  const dir = await repo();
  const before = await workTreeHash(dir, { exclude: EX });
  await touchOwn(dir);
  const prev = process.env['GIT_LITERAL_PATHSPECS'];
  process.env['GIT_LITERAL_PATHSPECS'] = '1';
  try {
    assert.equal(await workTreeHash(dir, { exclude: EX }), before);
    await fs.writeFile(path.join(dir, 'src/a.ts'), '// 改\n');
    assert.notEqual(await workTreeHash(dir, { exclude: EX }), before);
  } finally {
    if (prev === undefined) delete process.env['GIT_LITERAL_PATHSPECS'];
    else process.env['GIT_LITERAL_PATHSPECS'] = prev;
  }
});

test('EV-221 E5：前缀按字面匹配（rev[1] 不吃 rev1、rev* 不吃 revX），规范化与 isOwn 同口径（./x/ 同 x；空串、. 与上溯路径不排除）', async () => {
  const dir = await repo();
  await fs.mkdir(path.join(dir, 'rev[1]'), { recursive: true });
  await fs.mkdir(path.join(dir, 'rev1'), { recursive: true });
  await fs.writeFile(path.join(dir, 'rev[1]/f'), '1\n');
  await fs.writeFile(path.join(dir, 'rev1/f'), '1\n');
  const lit = ['rev[1]'];
  const h0 = await workTreeHash(dir, { exclude: lit });
  await fs.writeFile(path.join(dir, 'rev[1]/f'), '2\n');
  assert.equal(await workTreeHash(dir, { exclude: lit }), h0, 'rev[1] 下的改动应被排除');
  await fs.writeFile(path.join(dir, 'rev1/f'), '2\n');
  assert.notEqual(await workTreeHash(dir, { exclude: lit }), h0, 'rev1 不是 rev[1]，不该被当成 glob 一并排除');
  // `*` 在 glob 形态下跨 `/` 匹配，`rev*` 会把 revX/f 一并排除；按字面只排除名叫 rev* 的目录（预跑实测 rev[1] 一格区分不了两种形态）
  await fs.mkdir(path.join(dir, 'rev*'), { recursive: true });
  await fs.mkdir(path.join(dir, 'revX'), { recursive: true });
  await fs.writeFile(path.join(dir, 'rev*/f'), '1\n');
  await fs.writeFile(path.join(dir, 'revX/f'), '1\n');
  const star = ['rev*'];
  const s0 = await workTreeHash(dir, { exclude: star });
  await fs.writeFile(path.join(dir, 'rev*/f'), '2\n');
  assert.equal(await workTreeHash(dir, { exclude: star }), s0, 'rev* 目录下的改动应被排除');
  await fs.writeFile(path.join(dir, 'revX/f'), '2\n');
  assert.notEqual(await workTreeHash(dir, { exclude: star }), s0, 'revX 不是 rev*，不该被当成 glob 一并排除');

  const d2 = await repo();
  const n0 = await workTreeHash(d2, { exclude: EX });
  await touchOwn(d2);
  assert.equal(await workTreeHash(d2, { exclude: ['./.reviews/', '.trivium/'] }), n0, './x/ 与 x 同义');
  await fs.writeFile(path.join(d2, 'src/a.ts'), '// 改\n');
  const raw = await workTreeHash(d2);
  assert.equal(await workTreeHash(d2, { exclude: ['', '.', './', '../elsewhere'] }), raw, '空串、.、上溯路径一律不排除（排除 . 等于整棵树不算）');
});

test('EV-221 E6：构建标识的排除含缺省归档根与 .trivium、与作用面不相交，作用面指纹不受这两处改动影响', async () => {
  assert.ok(INPUT_HASH_EXCLUDES.includes(defaultConfig().archive_root), '与缺省归档根对不上');
  assert.ok(INPUT_HASH_EXCLUDES.includes('.trivium'));
  assert.deepEqual([...INPUT_HASH_EXCLUDES], diffExcludePrefixes(defaultConfig().archive_root), '与 diffExcludePrefixes 同源');
  const overlap = INPUT_HASH_EXCLUDES.filter((e) => INSTALL_INPUT_PATHS.some((p) => e === p || e.startsWith(`${p}/`) || p.startsWith(`${e}/`)));
  assert.deepEqual(overlap, [], '排除与作用面相交 ⇒ 传排除会改 inputs_sha256');
  const dir = await repo();
  const h0 = await computeInputsSha256(dir);
  await touchOwn(dir);
  assert.equal(await computeInputsSha256(dir), h0);
});

// ─────────────────────────── R：重试 ───────────────────────────

/**
 * 给夹具仓库挂「删受害文件」的 clean 过滤器，只挂在 `src/x.ts` 上，每次 `add` 跑一次（临时索引由 `read-tree HEAD`
 * 填充、stat 信息为空，已跟踪文件每次都重新过滤）。过滤器删掉 `src/` 下现有的 `victim-*`；`persist` 时再造下一个
 * （不在本次 add 的列表里、在下一次的列表里），于是每次 add 都撞上。返回读调用次数的函数。
 */
async function armVanish(dir: string, persist: boolean): Promise<() => Promise<number>> {
  const counter = path.join(path.dirname(dir), `${path.basename(dir)}-zap-count`);
  const script = path.join(path.dirname(dir), `${path.basename(dir)}-zap.sh`);
  const src = path.join(dir, 'src');
  const lines = [
    `n=$(cat '${counter}' 2>/dev/null || echo 0); n=$((n+1)); echo $n > '${counter}'`,
    `rm -f '${src}'/victim-*`,
    ...(persist ? [`: > '${src}/victim-'$n`] : []),
    'cat',
    '',
  ];
  await fs.writeFile(script, lines.join('\n'), 'utf8');
  await fs.writeFile(path.join(dir, 'src/x.ts'), 'export const x = 1;\n');
  const add = await run('git', ['add', 'src/x.ts'], { cwd: dir, timeoutMs: 30_000 });
  assert.equal(add.code, 0, add.stderr);
  const commit = await run('git', ['commit', '-q', '-m', 'x', '--no-verify'], { cwd: dir, timeoutMs: 30_000 });
  assert.equal(commit.code, 0, commit.stderr);
  /*
   * mtime 拨到一小时前：否则 x.ts 与临时索引落在同一秒，`write-tree` 写索引时把它当「racily clean」重比内容、
   * 又跑一次过滤器（首跑实测 R1 数到 3 次，第 3 次的父进程是 write-tree），计数随时机变。
   */
  const past = new Date(Date.now() - 3600_000);
  await fs.utimes(path.join(dir, 'src/x.ts'), past, past);
  await fs.mkdir(path.join(dir, '.git', 'info'), { recursive: true });
  await fs.writeFile(path.join(dir, '.git', 'info', 'attributes'), 'src/x.ts filter=trvzap\n', 'utf8');
  const cfg = await run('git', ['config', 'filter.trvzap.clean', `sh '${script}'`], { cwd: dir, timeoutMs: 30_000 });
  assert.equal(cfg.code, 0, cfg.stderr);
  await fs.writeFile(path.join(src, 'victim-0'), 'gone soon\n');
  return async () => Number(await fs.readFile(counter, 'utf8').catch(() => '0'));
}

test('EV-221 R1：add 报「unable to stat … No such file or directory」⇒ 重跑一次成功，哈希是受害文件不在时的工作树', async () => {
  // 夹具放在 scratchDir 下的子目录：计数文件与过滤器脚本落在它旁边，不进被哈希的工作树
  const dir = path.join(await scratchDir('trivium-wthr-'), 'repo');
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 1;\n');
  await initFixtureRepo(dir);
  const calls = await armVanish(dir, false);
  const h = await workTreeHash(dir, { exclude: EX });
  assert.equal(await calls(), 2, '应是第 1 次撞上、第 2 次成功——过滤器被调的次数不对');
  assert.equal(h, await headTree(dir), '受害文件已不在，工作树等于 HEAD');
});

test('EV-221 R2：每次都撞上 ⇒ 至多重试 2 次（共 3 次 add），抛最后一次的原文', async () => {
  assert.equal(ADD_VANISHED_RETRIES, 2);
  const dir = path.join(await scratchDir('trivium-wthr-'), 'repo');
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 1;\n');
  await initFixtureRepo(dir);
  const calls = await armVanish(dir, true);
  await assert.rejects(workTreeHash(dir), (e: Error) => {
    assert.ok(e.message.startsWith('git add to temp index failed: fatal: unable to stat '), e.message);
    assert.ok(e.message.includes('victim-2'), `应是第 3 次的原文：${e.message}`);
    assert.ok(e.message.endsWith('No such file or directory'), e.message);
    return true;
  });
  assert.equal(await calls(), 3);
});

test('EV-221 R3：其它报错不重试——假 git 让临时索引的 add 失败（stderr 不是「文件中途消失」）⇒ add 只调 1 次、抛原文', async () => {
  const base = await scratchDir('trivium-wthr-');
  const dir = path.join(base, 'repo');
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 1;\n');
  await initFixtureRepo(dir);
  await writeFakeGit(path.join(base, 'bin'));
  const log = path.join(base, 'git.log');
  const keys = ['PATH', 'FAKE_GIT_FAIL', 'FAKE_GIT_LOG'];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env['PATH'] = `${path.join(base, 'bin')}${path.delimiter}${saved['PATH'] ?? ''}`;
  process.env['FAKE_GIT_FAIL'] = 'index-add';
  process.env['FAKE_GIT_LOG'] = log;
  try {
    for (const opts of [{}, { exclude: EX }]) {
      await fs.rm(log, { force: true });
      await assert.rejects(workTreeHash(dir, opts), (e: Error) => {
        assert.equal(e.message, `git add to temp index failed: ${FAKE_GIT_STDERR.join('\n')}`);
        return true;
      });
      const adds = (await fs.readFile(log, 'utf8')).split('\n').filter((l) => l.includes(' add -A '));
      assert.equal(adds.length, 1, `不该重试：${adds.join(' | ')}`);
    }
  } finally {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
});

test('EV-221 R4：「文件中途消失」判据只认 unable to stat 且 No such file or directory 的英文原文', () => {
  assert.equal(isVanishedFileError("fatal: unable to stat '.reviews/t/plan/_meta/run-x.json.tmp-1-2': No such file or directory\n"), true);
  assert.equal(isVanishedFileError("fatal: unable to stat 'src/a': Permission denied"), false, '不是消失');
  assert.equal(isVanishedFileError("fatal: Unable to create '/x/index.lock': No such file or directory"), false, '不是 stat');
  assert.equal(isVanishedFileError("error: external filter 'sh x' failed 1"), false);
  assert.equal(isVanishedFileError("致命错误：不能对 'src/a' 调用 stat：没有那个文件或目录"), false, '翻译过的报错不重试，退回改前的行为');
  assert.equal(isVanishedFileError(''), false);
});

// ─────────────────────────── S：审批摘要接线 ───────────────────────────

test('EV-221 S1：审批摘要的当前树与同法算的基线相同——审查收尾之后只动归档与 .trivium 时 current_tree 等于基线', async () => {
  const dir = await repo();
  const baseline = await workTreeHash(dir, { exclude: EX });
  await touchOwn(dir);
  const s = await summarizeWorkTree({ projectRoot: dir, archiveRootRel: '.reviews', runId: 'R1', afterTreeHash: baseline });
  assert.equal(s.available, true, JSON.stringify(s));
  assert.equal(s.current_tree, baseline, '摘要没按同一份排除算当前树');
  assert.equal(s.total, 0);
  await fs.writeFile(path.join(dir, 'src/a.ts'), '// 改\n');
  const s2 = await summarizeWorkTree({ projectRoot: dir, archiveRootRel: '.reviews', runId: 'R1', afterTreeHash: baseline });
  assert.deepEqual(s2.files, [{ status: 'M', path: 'src/a.ts' }]);
});

// ─────────────────────────── G：源码护栏 ───────────────────────────

type CallKind = 'same-source' | 'bare' | 'other-source';

/**
 * 扫一份源码里的 `workTreeHash(…)` 调用：第二参是对象字面量且有 `exclude` 属性、取值是 `diffExcludePrefixes(…)` 调用
 * 或本文件里初值为它的变量 ⇒ same-source；没有 `exclude` ⇒ bare；其余 ⇒ other-source。
 */
function scanWorkTreeHashCalls(src: string): Array<{ line: number; kind: CallKind }> {
  const sf = ts.createSourceFile('scan.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const inits = new Map<string, ts.Expression[]>();
  const calls: ts.CallExpression[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      inits.set(n.name.text, [...(inits.get(n.name.text) ?? []), n.initializer]);
    }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'workTreeHash') calls.push(n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const isDiffExclude = (e: ts.Expression): boolean =>
    ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'diffExcludePrefixes';
  return calls.map((c) => {
    const line = sf.getLineAndCharacterOfPosition(c.getStart(sf)).line + 1;
    const opts = c.arguments[1];
    if (opts === undefined) return { line, kind: 'bare' as const };
    if (!ts.isObjectLiteralExpression(opts)) return { line, kind: 'other-source' as const };
    let value: ts.Expression | null = null;
    for (const p of opts.properties) {
      if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'exclude') value = p.initializer;
      if (ts.isShorthandPropertyAssignment(p) && p.name.text === 'exclude') value = p.name;
    }
    if (value === null) return { line, kind: 'bare' as const };
    if (isDiffExclude(value)) return { line, kind: 'same-source' as const };
    if (ts.isIdentifier(value)) {
      const found = inits.get(value.text) ?? [];
      if (found.length > 0 && found.every(isDiffExclude)) return { line, kind: 'same-source' as const };
    }
    return { line, kind: 'other-source' as const };
  });
}

test('EV-221 G1（扫描器自测）：直接调用、经变量、缺 exclude、来源不明各自判对', () => {
  const r = scanWorkTreeHashCalls([
    "const ex = diffExcludePrefixes('.reviews');",
    'await workTreeHash(root, { exclude: ex });',
    'await workTreeHash(root, { timeoutMs: 1, exclude: diffExcludePrefixes(rel) });',
    'await workTreeHash(root);',
    'await workTreeHash(root, { timeoutMs: 1 });',
    "await workTreeHash(root, { exclude: ['.reviews'] });",
    'await workTreeHash(root, opts);',
    '// await workTreeHash(root) 注释不算',
  ].join('\n'));
  assert.deepEqual(r.map((x) => x.kind), ['same-source', 'same-source', 'bare', 'bare', 'other-source', 'other-source']);
});

/**
 * 登记表：各文件里 `workTreeHash` 调用点的形态。四处送审 / 复算 / 摘要 / 构建标识必须传同源排除；
 * 三处探针在 mkdtemp 建的夹具仓库上算，没有归档根与 `.trivium/`，不传。新增调用点要来这里登记。
 */
const REGISTERED: Record<string, Partial<Record<CallKind, number>>> = {
  'trivium/build-stamp.ts': { 'same-source': 1 },
  'trivium/freeze.ts': { 'same-source': 1 },
  'trivium/probes/agy.ts': { bare: 1 },
  'trivium/probes/fixture.ts': { bare: 1 },
  'trivium/probes/zcode.ts': { bare: 1 },
  'trivium/review.ts': { 'same-source': 1 },
  'trivium/worktree-summary.ts': { 'same-source': 1 },
};

test('EV-221 G2（源码护栏）：src/ 里的 workTreeHash 调用点与登记表一致，四处传 diffExcludePrefixes 同源的排除', async () => {
  const root = path.join(REPO_ROOT, 'src');
  const seen: Record<string, Partial<Record<CallKind, number>>> = {};
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (p.endsWith('.ts')) {
        const rel = path.relative(root, p).split(path.sep).join('/');
        for (const c of scanWorkTreeHashCalls(await fs.readFile(p, 'utf8'))) {
          const m = (seen[rel] ??= {});
          m[c.kind] = (m[c.kind] ?? 0) + 1;
        }
      }
    }
  };
  await walk(root);
  assert.deepEqual(seen, REGISTERED, 'workTreeHash 调用点与登记表不一致——新增调用点要登记，送审、复算、摘要、构建标识四处要传同源排除');
});

}
