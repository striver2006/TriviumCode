import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  diffTrees, diffTreesNameStatus, initFixtureRepo, parseNameStatusZ, treeExists, workTreeHash,
} from '../../src/trivium/util/git.js';
import { run } from '../../src/trivium/util/exec.js';
import { entryCommandOf } from '../../src/trivium/agents/registry.js';
import {
  REASON_BAD_BASELINE, REASON_BASELINE_GONE, REASON_GIT_FAILED_PREFIX, REASON_NO_BASELINE, SUMMARY_BUDGET_ENV,
  SUMMARY_BUDGET_MS, SUMMARY_JSON_LIMIT, budgetOverrideNote, fullListCommand, reasonTimeout, renderWorkTreeSummary,
  summarizeWorkTree, summaryBudget, unavailableSummary, type WorkTreeSummary,
} from '../../src/trivium/worktree-summary.js';
import { scratchDir } from '../helpers/scratch.js';
import { SH } from '../helpers/platform.js';

// 2026-10-20 试验性解除 win32 整文件跳过（第三批适配）：实测后按结果定去留。macOS/Linux 行为零变化。
{

/**
 * 审批时的工作树改动摘要（EV-132 候选 ② 折中版；计划 `.reviews/审批前工作树摘要/plan/` r2 §3.1）。
 *
 * 这一族要守的是两条边界：
 *   ① 「比不了」绝不能长得像「无改动」——基线被清、git 出错、超时，都要落成 `available: false` 加原因；
 *   ② 摘要口径与漂移复算同法（`workTreeHash`），只取决于工作树内容，闸门期提交过的改动同样列出。
 *
 * 每条用例一个独立夹具目录（计划双审 CODEX-09）：gc 用例会清掉对象库里的不可达对象，不能与别的用例共享。
 */

async function repo(): Promise<string> {
  const dir = await scratchDir('trivium-wts-');
  await fs.writeFile(path.join(dir, 'a.ts'), 'export const a = 1;\n');
  await fs.writeFile(path.join(dir, 'b.ts'), 'export const b = 1;\n');
  await fs.writeFile(path.join(dir, '.gitignore'), 'ignored.log\n');
  await initFixtureRepo(dir);
  return dir;
}

async function summarize(dir: string, afterTreeHash: string | undefined, budgetMs?: number): Promise<WorkTreeSummary> {
  return summarizeWorkTree({
    projectRoot: dir, archiveRootRel: '.reviews', runId: 'RUN1', afterTreeHash,
    ...(budgetMs !== undefined ? { budgetMs } : {}),
  });
}

const git = (dir: string, args: string[]) =>
  run('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, timeoutMs: 60_000 });

test('1：基线之后没有改动 ⇒ available、total 0，渲染出「无改动」一行', async () => {
  const dir = await repo();
  const base = await workTreeHash(dir);
  const s = await summarize(dir, base);
  assert.equal(s.available, true);
  assert.equal(s.total, 0);
  assert.equal(s.reason, null);
  const r = renderWorkTreeSummary(s, { exit: 'approval', driver: null, topic: 'T' });
  assert.equal(r.warning, false);
  assert.match(r.text, /自审查收尾（run RUN1）以来，未被 \.gitignore 忽略的文件无改动（不含 \.reviews\/ 与 \.trivium\/）。/);
});

test('2：修改 / 新建未跟踪 / 删除 ⇒ M / A / D 三行，按路径排序', async () => {
  const dir = await repo();
  const base = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, 'a.ts'), 'export const a = 2;\n');
  await fs.writeFile(path.join(dir, 'new.ts'), 'x\n');
  await fs.rm(path.join(dir, 'b.ts'));
  const s = await summarize(dir, base);
  assert.equal(s.available, true);
  assert.deepEqual(s.files, [
    { status: 'M', path: 'a.ts' },
    { status: 'D', path: 'b.ts' },
    { status: 'A', path: 'new.ts' },
  ]);
  const r = renderWorkTreeSummary(s, { exit: 'approval', driver: null, topic: 'T' });
  assert.match(r.text, /只告知，不影响审批结论/);
  assert.match(r.text, /3 个文件有变化/);
  assert.match(r.text, /\n {2}M {2}a\.ts\n {2}D {2}b\.ts\n {2}A {2}new\.ts\n/);
  assert.match(r.text, /比对范围：未被 \.gitignore 忽略的文件，不含 \.reviews\/ 与 \.trivium\/；闸门期提交过的改动同样列出/);
});

test('3：被 .gitignore 忽略的文件、归档根、.trivium/ 下的改动都不出现', async () => {
  const dir = await repo();
  const base = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, 'ignored.log'), 'noise\n');
  await fs.mkdir(path.join(dir, '.reviews/topic/plan'), { recursive: true });
  await fs.writeFile(path.join(dir, '.reviews/topic/plan/x.md'), 'd\n');
  await fs.mkdir(path.join(dir, '.trivium'), { recursive: true });
  await fs.writeFile(path.join(dir, '.trivium/scratch.json'), '{}\n');
  await fs.writeFile(path.join(dir, 'a.ts'), 'export const a = 3;\n');
  const s = await summarize(dir, base);
  assert.deepEqual(s.files.map((f) => f.path), ['a.ts']);
  assert.equal(s.total, 1);
});

test('4：闸门期提交过的改动同样列出——基线与当前都按工作树内容算，不相对 HEAD', async () => {
  const dir = await repo();
  const base = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, 'a.ts'), 'export const a = 4;\n');
  await git(dir, ['add', 'a.ts']);
  await git(dir, ['commit', '-q', '-m', 'during gate', '--no-verify']);
  const st = await git(dir, ['status', '--porcelain']);
  assert.equal(st.stdout.trim(), '', '前提：提交后 git status 干净');
  const s = await summarize(dir, base);
  assert.deepEqual(s.files, [{ status: 'M', path: 'a.ts' }]);
});

test('5：路径含空格、双引号、中文 ⇒ 原样（-z 成对解析，不加引号）', async () => {
  const dir = await repo();
  const base = await workTreeHash(dir);
  // win32 文件名禁用双引号——用同样会触发 -z 成对解析的形态（空格/中文/单引号）替代
  const names = process.platform === 'win32' ? ['有 空格.ts', "quote'd.ts", '中文/文件.ts'] : ['有 空格.ts', 'quote"d.ts', '中文/文件.ts'];
  await fs.mkdir(path.join(dir, '中文'), { recursive: true });
  for (const n of names) await fs.writeFile(path.join(dir, n), 'x\n');
  const s = await summarize(dir, base);
  assert.deepEqual(s.files.map((f) => f.path).sort(), [...names].sort());
});

test('6：人读上限 20 条、超出给同口径的照抄命令；JSON 上限 200 条，带 total 与 truncated', async () => {
  const dir = await repo();
  const base = await workTreeHash(dir);
  await fs.mkdir(path.join(dir, 'many'), { recursive: true });
  for (let i = 0; i < 21; i++) await fs.writeFile(path.join(dir, `many/f${String(i).padStart(3, '0')}.ts`), `${i}\n`);
  const s21 = await summarize(dir, base);
  assert.equal(s21.total, 21);
  assert.equal(s21.truncated, false);
  const r = renderWorkTreeSummary(s21, { exit: 'approval', driver: null, topic: 'T' });
  const listed = r.text.split('\n').filter((l) => /^ {2}A {2}many\//.test(l));
  assert.equal(listed.length, 20, '人读恰好列 20 条');
  assert.match(r.text, /……另有 1 个，完整列表：git -c core\.quotePath=false diff-tree -r --name-status \S+ \S+ -- \. /);
  // 照抄命令与摘要同口径（计划双审 CODEX-07）：带排除前缀
  const cmd = fullListCommand(s21);
  assert.match(cmd, /':\(exclude\)\.reviews'/);
  assert.match(cmd, /':\(exclude\)\.trivium'/);

  for (let i = 21; i < 205; i++) await fs.writeFile(path.join(dir, `many/f${String(i).padStart(3, '0')}.ts`), `${i}\n`);
  const s205 = await summarize(dir, base);
  assert.equal(s205.total, 205);
  assert.equal(s205.files.length, SUMMARY_JSON_LIMIT);
  assert.equal(s205.truncated, true);
});

test('照抄命令真能跑，且列出的条数与摘要 total 相同', async () => {
  const dir = await repo();
  const base = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, 'a.ts'), 'changed\n');
  await fs.mkdir(path.join(dir, '.reviews'), { recursive: true });
  await fs.writeFile(path.join(dir, '.reviews/x.md'), 'd\n');
  const s = await summarize(dir, base);
  const r = await run(SH, ['-c', fullListCommand(s)], { cwd: dir, timeoutMs: 60_000 });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').filter(Boolean).length, s.total);
});

test('7：基线缺席 ⇒ available false，原因为中性句（不断言「早于此功能」，计划双审 CODEX-05）', async () => {
  const dir = await repo();
  const s = await summarize(dir, undefined);
  assert.equal(s.available, false);
  assert.equal(s.reason, REASON_NO_BASELINE);
  assert.doesNotMatch(s.reason!, /早于/);
  const r = renderWorkTreeSummary(s, { exit: 'approval', driver: null, topic: 'T' });
  assert.equal(r.warning, true);
  assert.doesNotMatch(r.text, /无改动/);
});

test('8：基线对象被 git 清理 ⇒ 原因 2，绝不是「无改动」（夹具先把基线造成不可达对象，计划双审 GLM-03）', async () => {
  const dir = await repo();
  // 先造一个未跟踪文件再取基线：基线 tree ≠ HEAD tree，于是不可达、gc 能清掉
  await fs.writeFile(path.join(dir, 'temp-untracked.txt'), 'only in baseline\n');
  const base = await workTreeHash(dir);
  const head = (await git(dir, ['rev-parse', 'HEAD^{tree}'])).stdout.trim();
  assert.notEqual(base, head, '前提：基线不等于 HEAD 的 tree');
  await fs.rm(path.join(dir, 'temp-untracked.txt'));
  await git(dir, ['gc', '-q', '--prune=now']);
  assert.equal(await treeExists(dir, base), false, '前提：gc 之后基线对象确已不在');

  const s = await summarize(dir, base);
  assert.equal(s.available, false);
  assert.equal(s.reason, REASON_BASELINE_GONE);
  const r = renderWorkTreeSummary(s, { exit: 'approval', driver: null, topic: 'T' });
  assert.equal(r.warning, true);
  assert.match(r.text, /取不到/);
  assert.doesNotMatch(r.text, /无改动/);
  // 对照：宽松的 diffTrees 在同一情形下返回 []——这正是摘要不用它的理由
  assert.deepEqual(await diffTrees(dir, base, head), []);
});

test('9：非 git 目录 ⇒ 原因 3，不抛', async () => {
  const dir = await scratchDir('trivium-wts-nogit-');
  const s = await summarize(dir, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  assert.equal(s.available, false);
  assert.ok(s.reason!.startsWith(REASON_GIT_FAILED_PREFIX), s.reason!);
});

test('10：严格助手失败即抛；-z 输出段数为奇数即抛（计划双审 AGY-04）', async () => {
  const dir = await repo();
  const base = await workTreeHash(dir);
  await assert.rejects(
    diffTreesNameStatus(dir, base, '0123456789abcdef0123456789abcdef01234567'),
    /git diff-tree 失败/,
  );
  assert.throws(() => parseNameStatusZ('M\0a.ts\0D\0'), /段数为奇数/);
  assert.deepEqual(parseNameStatusZ('M\0a b.ts\0A\0c"d.ts\0'), [
    { status: 'M', path: 'a b.ts' },
    { status: 'A', path: 'c"d.ts' },
  ]);
  assert.deepEqual(parseNameStatusZ(''), []);
});

test('11：预算耗尽 ⇒ 原因 4（超时），不与 git 失败同形（计划双审 CODEX-02）', async () => {
  const dir = await repo();
  const base = await workTreeHash(dir);
  const s = await summarize(dir, base, 1);
  assert.equal(s.available, false);
  assert.equal(s.reason, reasonTimeout(1));
  assert.equal(s.reason, '工作树摘要超时（超过 1 毫秒）。', '不足 1 秒写毫秒，不写「超过 0 秒」（代码双审 r1 CODEX-02）');
  assert.ok(!s.reason!.startsWith(REASON_GIT_FAILED_PREFIX));
  assert.equal(reasonTimeout(20_000), '工作树摘要超时（超过 20 秒）。');
  assert.equal(reasonTimeout(1_200), '工作树摘要超时（超过 2 秒）。', '向上取整');
});

test('12：两种出口的末句——approval 给按 Driver 派生的 abandon 写法，hold 说审批时会再列出（计划双审 AGY-01）', async () => {
  const dir = await repo();
  const base = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, 'a.ts'), 'x\n');
  const s = await summarize(dir, base);
  const ap = renderWorkTreeSummary(s, { exit: 'approval', driver: 'codex', topic: '主题X' });
  assert.ok(ap.text.includes(`${entryCommandOf('codex', 'dual-abandon')} --topic 主题X 作废本轮后重跑`), ap.text);
  assert.doesNotMatch(ap.text, /审批时会再列出一次/);
  const hold = renderWorkTreeSummary(s, { exit: 'hold', driver: 'codex', topic: '主题X' });
  assert.match(hold.text, /审批时会再列出一次/);
  assert.doesNotMatch(hold.text, /作废本轮/);
  const gone = renderWorkTreeSummary({ ...s, available: false, reason: REASON_NO_BASELINE }, { exit: 'hold', driver: null, topic: 'T' });
  assert.match(gone.text, /这不影响停点/);
});

test('13：workTreeHash 不传 timeoutMs 时与传了同值（送审冻结与漂移复算的行为不变）', async () => {
  const dir = await repo();
  await fs.writeFile(path.join(dir, 'u.txt'), 'u\n');
  assert.equal(await workTreeHash(dir), await workTreeHash(dir, { timeoutMs: 60_000 }));
});

test('预算环境变量：只认正整数，否则回缺省；生效时带来源标记', () => {
  assert.deepEqual(summaryBudget({}), { ms: SUMMARY_BUDGET_MS, overridden: false });
  assert.deepEqual(summaryBudget({ [SUMMARY_BUDGET_ENV]: '5' }), { ms: 5, overridden: true });
  for (const bad of ['0', '-1', 'abc', '1.5', '']) {
    assert.deepEqual(summaryBudget({ [SUMMARY_BUDGET_ENV]: bad }), { ms: SUMMARY_BUDGET_MS, overridden: false }, bad);
  }
});

// ─────────── 代码双审 r1（run 20260926T111908Z）的修订 ───────────

test('r1 CODEX-01 ≡ GLM-01：基线是含 shell 元字符的合法引用名 ⇒ 形状闸拦下，不调 git、不回显', async () => {
  const dir = await repo();
  const evil = 'x;echo-pwned';
  // 前提：它确实是一个 git 接受的引用名，能过 cat-file -e——没有形状闸时会一路通到照抄命令
  assert.equal((await git(dir, ['branch', evil])).code, 0, '前提：git 接受这个引用名');
  assert.equal(await treeExists(dir, evil), true, '前提：cat-file -e 认它');
  const s = await summarize(dir, evil);
  assert.equal(s.available, false);
  assert.equal(s.reason, REASON_BAD_BASELINE);
  assert.equal(s.baseline_tree, null, '不合形状的值不回显');
});

test('r1 CODEX-01：以 - 开头的基线同样拦下；非 git 目录里也是形状闸先报（证明闸在任何 git 调用之前）', async () => {
  const nogit = await scratchDir('trivium-wts-shape-');
  for (const bad of ['--output=/tmp/x', 'HEAD', `${'a'.repeat(39)}`, `${'A'.repeat(40)}`]) {
    const s = await summarize(nogit, bad);
    assert.equal(s.reason, REASON_BAD_BASELINE, bad);
  }
  // 合法形状（sha1 40 位、sha256 64 位）过闸，于是在非 git 目录里落到 git 失败
  for (const ok of ['a'.repeat(40), 'b'.repeat(64)]) {
    const s = await summarize(nogit, ok);
    assert.ok(s.reason!.startsWith(REASON_GIT_FAILED_PREFIX), `${ok}：${s.reason}`);
  }
});

test('r1 CODEX-01：照抄命令两个 tree 值也加引号；路径含单引号时照抄命令仍能跑、条数与 total 相同', async () => {
  const dir = await repo();
  const base = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, "it's.ts"), 'x\n');
  await fs.writeFile(path.join(dir, 'a.ts'), 'changed\n');
  const s = await summarize(dir, base);
  const cmd = fullListCommand(s);
  assert.ok(cmd.includes(`'${s.baseline_tree}' '${s.current_tree}'`), cmd);
  const r = await run(SH, ['-c', cmd], { cwd: dir, timeoutMs: 60_000 });
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout.trim().split('\n').filter(Boolean).length, s.total);
  assert.ok(s.files.some((f) => f.path === "it's.ts"));
});

test('r1 AGY-01：原因 3 末尾补句号，与「这不影响」不黏连', () => {
  const s = unavailableSummary('RUN1', '.reviews', new Error('boom 没有句号'));
  const r = renderWorkTreeSummary(s, { exit: 'approval', driver: null, topic: 'T' });
  assert.match(r.text, /git 调用失败：boom 没有句号。这不影响审批；/);
  const done = renderWorkTreeSummary({ ...s, reason: REASON_NO_BASELINE }, { exit: 'approval', driver: null, topic: 'T' });
  assert.doesNotMatch(done.text, /。。/, '自带句号的原因不重复补');
});

test('r1 CODEX-02：预算被环境变量覆盖时，超时原因与人读输出都写明，JSON 带 budget_overridden', async () => {
  const dir = await repo();
  const base = await workTreeHash(dir);
  const s = await summarizeWorkTree({ projectRoot: dir, archiveRootRel: '.reviews', runId: 'R', afterTreeHash: base, budgetMs: 1, budgetOverridden: true });
  assert.equal(s.budget_overridden, true);
  assert.equal(s.budget_ms, 1);
  assert.ok(s.reason!.includes(budgetOverrideNote(1)), s.reason!);
  const r = renderWorkTreeSummary(s, { exit: 'approval', driver: null, topic: 'T' });
  assert.equal(r.text.split(budgetOverrideNote(1)).length - 1, 1, '只出现一次，不重复');
  // 可用时同样追加
  await fs.writeFile(path.join(dir, 'a.ts'), 'y\n');
  const ok = await summarizeWorkTree({ projectRoot: dir, archiveRootRel: '.reviews', runId: 'R', afterTreeHash: base, budgetMs: 60_000, budgetOverridden: true });
  assert.ok(renderWorkTreeSummary(ok, { exit: 'hold', driver: null, topic: 'T' }).text.includes(budgetOverrideNote(60_000)));
  // 未覆盖时不出现
  const plain = await summarize(dir, base);
  assert.equal(plain.budget_overridden, false);
  assert.ok(!renderWorkTreeSummary(plain, { exit: 'hold', driver: null, topic: 'T' }).text.includes(SUMMARY_BUDGET_ENV));
});

test('r1 CODEX-03：总预算是真上界，被杀的 git 按进程组收尾（慢清理过滤器夹具）', async () => {
  const dir = await repo();
  const base = await workTreeHash(dir);
  /*
   * 让临时索引的 add -A 卡在一个会派生子进程的清理过滤器里：sleep 带一个独有的时长，事后按它找孤儿。
   * 过滤器忽略 SIGTERM（`trap '' TERM`，忽略态随 exec 继承给 sleep），只有收尾宽限后的 SIGKILL 杀得掉它——
   * 于是没有整体截止时，返回要等「预算 + 500 ms 宽限」之后；有截止时在预算处返回。两条都由这一条用例咬住。
   */
  const marker = '7.31';
  await git(dir, ['config', 'filter.slow.clean', `sh -c "trap '' TERM; sleep ${marker}; cat"`]);
  await fs.writeFile(path.join(dir, '.gitattributes'), '*.ts filter=slow\n');
  await fs.writeFile(path.join(dir, 'a.ts'), 'slow\n');
  const t0 = Date.now();
  const s = await summarize(dir, base, 800);
  const elapsed = Date.now() - t0;
  assert.equal(s.available, false);
  assert.equal(s.reason, reasonTimeout(800));
  assert.ok(elapsed < 800 + 400, `整体截止应在预算附近返回，实际 ${elapsed} ms`);
  // 收尾宽限（500 ms）过后，按进程组杀掉的过滤器不应还活着
  await new Promise((r) => setTimeout(r, 1500));
  const ps = await run(SH, ['-c', `ps -axo command | grep -F "sleep ${marker}" | grep -v grep || true`], { timeoutMs: 10_000 });
  assert.equal(ps.stdout.trim(), '', `过滤器子进程成了孤儿：\n${ps.stdout}`);
});

}
