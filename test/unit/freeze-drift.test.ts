import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  judgeDrift, driftAction, enumerateDenyPaths, classifyCompareFailure, DRIFT_PROBE_BUDGET_MS,
  type DriftVerdict, type Snapshot,
} from '../../src/trivium/freeze.js';
import { defaultConfig } from '../../src/trivium/config.js';
import {
  GIT_DEFAULT_TIMEOUT_MS, GitTimeoutError, initFixtureRepo, treeExists, workTreeHash,
} from '../../src/trivium/util/git.js';
import { run } from '../../src/trivium/util/exec.js';

async function repo(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-drift-'));
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.mkdir(path.join(dir, '.reviews/t/plan/_meta'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 1;\n');
  await fs.writeFile(path.join(dir, 'src/b.ts'), 'export const b = 2;\n');
  await fs.writeFile(path.join(dir, '.reviews/t/plan/2026-09-11-t-claude.md'), '# 计划\n');
  await initFixtureRepo(dir);
  return dir;
}

function snap(treeHash: string, subjectSha = 'SUBJ'): Snapshot {
  return {
    gitHead: null, treeHash, dirty: false, subjectSha256: subjectSha,
    subjectPath: '/x', denyPaths: [], diffText: null, takenAt: 'now',
  };
}

const BASE = {
  cfg: defaultConfig(),
  relatedPaths: [] as string[],
  scratchGlobs: [] as string[],
  archiveRootRel: '.reviews',
};

test('禁读清单：子目录里的 .env.production 也在内（默认 sensitive_globs 补了 **/.env*）', async () => {
  const dir = await repo();
  await fs.mkdir(path.join(dir, 'config'), { recursive: true });
  await fs.writeFile(path.join(dir, 'config/.env.production'), 'X=1\n');
  await fs.writeFile(path.join(dir, '.env'), 'X=1\n');
  const deny = await enumerateDenyPaths(defaultConfig(), dir, path.join(dir, '.reviews'), 'gemini');
  assert.ok(deny.includes('.env'));
  assert.ok(deny.includes('config/.env.production'), JSON.stringify(deny));
});

test('工作树未变 → 无漂移', async () => {
  const dir = await repo();
  const h = await workTreeHash(dir);
  const v = await judgeDrift({
    ...BASE, projectRoot: dir, before: snap(h),
    afterTreeHash: h, afterSubjectSha256: 'SUBJ',
  });
  assert.equal(v.kind, 'none');
});

test('被审对象被改 → subject_drift，优先级最高（整次作废）', async () => {
  const dir = await repo();
  const h = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, 'src/a.ts'), '// 同时改了别的文件\n');
  const after = await workTreeHash(dir);
  const v = await judgeDrift({
    ...BASE, projectRoot: dir, before: snap(h),
    afterTreeHash: after, afterSubjectSha256: 'SUBJ-CHANGED',
  });
  assert.equal(v.kind, 'subject_drift', '被审对象漂移应盖过其它漂移');
  assert.equal(driftAction(BASE.cfg, v), 'fail');
});

test('回归：编排器自己往归档写入不算漂移（实跑时误报过 4 个文件）', async () => {
  const dir = await repo();
  const before = await workTreeHash(dir);
  // 模拟编排器在运行中写送审包、run.json、task.json
  await fs.writeFile(path.join(dir, '.reviews/t/plan/_meta/brief-gemini-R1.md'), '# BRIEF\n');
  await fs.writeFile(path.join(dir, '.reviews/t/plan/_meta/run-R1.json'), '{}\n');
  await fs.writeFile(path.join(dir, '.reviews/t/task.json'), '{}\n');
  const after = await workTreeHash(dir);
  assert.notEqual(before, after, '前提：这些写入确实改变了 tree_hash');

  const v = await judgeDrift({
    ...BASE, projectRoot: dir, before: snap(before),
    afterTreeHash: after, afterSubjectSha256: 'SUBJ',
  });
  assert.equal(v.kind, 'none', '归档根内的变更必须被整体排除');
});

test('回归：编排器往 .trivium/ 写 state.json 与锁文件不算漂移（不依赖用户的 .gitignore）', async () => {
  const dir = await repo();
  const before = await workTreeHash(dir);
  await fs.mkdir(path.join(dir, '.trivium/lock'), { recursive: true });
  await fs.writeFile(path.join(dir, '.trivium/state.json'), '{}\n');
  await fs.writeFile(path.join(dir, '.trivium/lock/t.lock'), '{}\n');
  const after = await workTreeHash(dir);
  assert.notEqual(before, after, '前提：夹具没有 .gitignore，这些写入确实进了 tree_hash');

  const v = await judgeDrift({
    ...BASE, projectRoot: dir, before: snap(before),
    afterTreeHash: after, afterSubjectSha256: 'SUBJ',
  });
  assert.equal(v.kind, 'none', '.trivium/ 是编排器自己的写入点，必须整体排除');
});

test('无关业务文件被改 → unrelated，默认 warn', async () => {
  const dir = await repo();
  const before = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, 'src/b.ts'), 'export const b = 999;\n');
  const after = await workTreeHash(dir);
  const v = await judgeDrift({
    ...BASE, projectRoot: dir, before: snap(before),
    afterTreeHash: after, afterSubjectSha256: 'SUBJ',
  });
  assert.equal(v.kind, 'unrelated');
  assert.deepEqual(v.kind === 'unrelated' ? v.files : [], ['src/b.ts']);
  assert.equal(driftAction(BASE.cfg, v), 'warn');
});

test('--context 涉及的文件被改 → related，默认 fail', async () => {
  const dir = await repo();
  const before = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, 'src/a.ts'), 'export const a = 999;\n');
  const after = await workTreeHash(dir);
  const v = await judgeDrift({
    ...BASE, projectRoot: dir, before: snap(before),
    afterTreeHash: after, afterSubjectSha256: 'SUBJ',
    relatedPaths: ['src'],
  });
  assert.equal(v.kind, 'related');
  assert.equal(driftAction(BASE.cfg, v), 'fail');
});

test('Agent 的 scratch 白名单文件被排除，不算漂移', async () => {
  const dir = await repo();
  const before = await workTreeHash(dir);
  await fs.mkdir(path.join(dir, '.agents'), { recursive: true });
  await fs.writeFile(path.join(dir, '.agents/cache.json'), '{}\n');
  const after = await workTreeHash(dir);

  const withoutWhitelist = await judgeDrift({
    ...BASE, projectRoot: dir, before: snap(before),
    afterTreeHash: after, afterSubjectSha256: 'SUBJ',
  });
  assert.equal(withoutWhitelist.kind, 'unrelated', '不加白名单时会被判漂移');

  const withWhitelist = await judgeDrift({
    ...BASE, projectRoot: dir, before: snap(before),
    afterTreeHash: after, afterSubjectSha256: 'SUBJ',
    scratchGlobs: ['.agents/**'],
  });
  assert.equal(withWhitelist.kind, 'none', '加了白名单就不算漂移');
});

test('回归：含中文的路径在漂移报告里可读，不是八进制转义', async () => {
  const dir = await repo();
  const before = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, 'src/登录重构.ts'), 'export const x = 1;\n');
  const after = await workTreeHash(dir);
  const v = await judgeDrift({
    ...BASE, projectRoot: dir, before: snap(before),
    afterTreeHash: after, afterSubjectSha256: 'SUBJ',
  });
  assert.equal(v.kind, 'unrelated');
  const files = v.kind === 'unrelated' ? v.files : [];
  assert.deepEqual(files, ['src/登录重构.ts'], `应为可读中文路径，实际 ${JSON.stringify(files)}`);
});

test('漂移策略可配：on_drift=fail 时无关文件也判失败', async () => {
  const cfg = defaultConfig();
  cfg.review.on_drift = 'fail';
  assert.equal(driftAction(cfg, { kind: 'unrelated', files: ['x'] }), 'fail');
  cfg.review.on_drift_related = 'warn';
  assert.equal(driftAction(cfg, { kind: 'related', files: ['y'] }), 'warn');
});

// ── EV-139：比不了 ⇒ unknown，不是 none（漂移比不了不放行计划 r2 §5.1）──

/** 立即清理全部不可达对象：送审快照的 tree 是 write-tree 写出的不可达对象，这一步之后它就不在了 */
async function pruneNow(dir: string): Promise<void> {
  const r = await run('git', ['prune', '--expire=now'], { cwd: dir, timeoutMs: 30_000 });
  assert.equal(r.code, 0, `前提：git prune 成功（${r.stderr}）`);
}

/**
 * 造一棵**不可达**的送审 tree：夹具刚初始化时工作树等于 HEAD，`workTreeHash` 得到的是 HEAD 的 tree（可达，
 * 清理不掉），所以先加一个未跟踪文件再取。随后改一个文件得跑后 tree，再清理——两棵都不可达、都被删。
 */
async function prunedPair(dir: string, mutate = 'src/b.ts'): Promise<{ before: string; after: string }> {
  await fs.writeFile(path.join(dir, 'src/untracked-before.ts'), 'export const u = 1;\n');
  const before = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, mutate), 'export const changed = true;\n');
  const after = await workTreeHash(dir);
  assert.notEqual(before, after, '前提：两棵 tree 不同');
  await pruneNow(dir);
  assert.equal(await treeExists(dir, before), false, '前提：送审快照的 tree 已被清理');
  return { before, after };
}

function asUnknown(v: DriftVerdict): Extract<DriftVerdict, { kind: 'unknown' }> {
  assert.equal(v.kind, 'unknown', `应判比不了，实际 ${JSON.stringify(v)}`);
  return v as Extract<DriftVerdict, { kind: 'unknown' }>;
}

test('EV-139 U1：送审快照的 tree 在审查期间被清理 ⇒ unknown / object_gone，不再判 none', async () => {
  const dir = await repo();
  const { before, after } = await prunedPair(dir);
  const v = asUnknown(await judgeDrift({
    ...BASE, projectRoot: dir, before: snap(before), afterTreeHash: after, afterSubjectSha256: 'SUBJ',
  }));
  assert.equal(v.cause, 'object_gone');
  assert.match(v.detail, new RegExp(`送审快照的 tree ${before.slice(0, 12)} 在审查期间被清理`));
});

test('EV-139 U1′：只有跑后复算的 tree 不在 ⇒ 同样 object_gone，detail 指明是跑后那棵', async () => {
  const dir = await repo();
  // 送审快照取 HEAD 的 tree（可达、清理不掉），跑后那棵不可达、被清理
  const before = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, 'src/b.ts'), 'export const changed = true;\n');
  const after = await workTreeHash(dir);
  await pruneNow(dir);
  assert.equal(await treeExists(dir, before), true, '前提：送审 tree 可达、仍在');
  assert.equal(await treeExists(dir, after), false, '前提：跑后 tree 已被清理');
  const v = asUnknown(await judgeDrift({
    ...BASE, projectRoot: dir, before: snap(before), afterTreeHash: after, afterSubjectSha256: 'SUBJ',
  }));
  assert.equal(v.cause, 'object_gone');
  assert.match(v.detail, new RegExp(`跑后复算的 tree ${after.slice(0, 12)} 已被清理`));
});

test('EV-139 U2：比不了时不看 relatedPaths——覆盖与不覆盖被改文件都判 unknown', async () => {
  for (const relatedPaths of [['src'], ['doc']]) {
    const dir = await repo();
    const { before, after } = await prunedPair(dir, 'src/a.ts');
    const v = await judgeDrift({
      ...BASE, projectRoot: dir, before: snap(before), afterTreeHash: after, afterSubjectSha256: 'SUBJ', relatedPaths,
    });
    assert.equal(v.kind, 'unknown', `relatedPaths=${JSON.stringify(relatedPaths)} 时应判比不了`);
  }
});

test('EV-139 U3：unknown 按 on_drift_related 处置，与 on_drift 无关', () => {
  const v: DriftVerdict = { kind: 'unknown', cause: 'object_gone', detail: 'x' };
  assert.equal(driftAction(defaultConfig(), v), 'fail', '缺省 on_drift_related=fail');

  const relatedWarn = defaultConfig();
  relatedWarn.review.on_drift_related = 'warn';
  assert.equal(driftAction(relatedWarn, v), 'warn');

  // 反过来配：on_drift=fail、on_drift_related=warn ⇒ 跟 related 走，是 warn
  const crossed = defaultConfig();
  crossed.review.on_drift = 'fail';
  crossed.review.on_drift_related = 'warn';
  assert.equal(driftAction(crossed, v), 'warn', 'unknown 不能跟 on_drift 走');
});

test('EV-139 U4：送审快照名指向一个 blob（对象在、不是 tree）⇒ git_error，detail 带 diff-tree 报错首行', async () => {
  const dir = await repo();
  const blob = (await run('git', ['hash-object', '-w', 'src/a.ts'], { cwd: dir })).stdout.trim();
  await fs.writeFile(path.join(dir, 'src/b.ts'), 'export const changed = true;\n');
  const after = await workTreeHash(dir);
  const v = asUnknown(await judgeDrift({
    ...BASE, projectRoot: dir, before: snap(blob), afterTreeHash: after, afterSubjectSha256: 'SUBJ',
  }));
  assert.equal(v.cause, 'git_error');
  assert.match(v.detail, /git diff-tree 失败（退出码 \d+）/);
});

test('EV-139 U5：比对超时 ⇒ timeout，且不再查对象（项目根不存在也照样返回）', async () => {
  const u = await classifyCompareFailure(
    path.join(os.tmpdir(), 'trivium-no-such-dir-ev139'), 'a'.repeat(40), 'b'.repeat(40), new GitTimeoutError('diff-tree'),
  );
  // 时长与子命令名从结构化来源推出（代码双审 CODEX-02 ≡ GLM-02），不锁字面串
  assert.deepEqual(u, { cause: 'timeout', detail: `git diff-tree 未在 ${GIT_DEFAULT_TIMEOUT_MS / 1000} s 内结束` });
  assert.equal(DRIFT_PROBE_BUDGET_MS, GIT_DEFAULT_TIMEOUT_MS, '核对段的总预算与单次缺省同值');
});

test('EV-139 U5′：比对快速失败之后核对对象共用一份有界预算（逐次显式传剩余毫秒）', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-drift-budget-'));
  const seen: Array<number | undefined> = [];
  // 只记录传给 treeExists 的超时，不改它的行为：非 git 目录让核对当场出错，走 git_error
  const u = await classifyCompareFailure(dir, 'a'.repeat(40), 'b'.repeat(40), new Error('boom'), {
    treeExists: async (cwd, tree, opts) => { seen.push(opts?.timeoutMs); return treeExists(cwd, tree, opts); },
  });
  assert.equal(u.cause, 'git_error');
  assert.equal(seen.length, 1, '第一次核对出错即返回');
  assert.ok(typeof seen[0] === 'number' && seen[0] > 0 && seen[0] <= DRIFT_PROBE_BUDGET_MS, `应显式传剩余预算，实际 ${String(seen[0])}`);
});

test('EV-139 U6：核对对象时 git 也出错（非 git 目录）⇒ git_error，两段首行都在', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-drift-nogit-'));
  const u = await classifyCompareFailure(dir, 'a'.repeat(40), 'b'.repeat(40), new Error('比对炸了\n第二行不要'));
  assert.equal(u.cause, 'git_error');
  assert.match(u.detail, /^比对炸了；核对对象时：git cat-file 失败（退出码 \d+）/);
  assert.doesNotMatch(u.detail, /第二行不要/);
});

test('EV-139 U7：文件名含制表符的文件被改 ⇒ related（严格比对走 -z，路径原样；旧调用带引号、误落 unrelated）', async () => {
  const dir = await repo();
  const odd = 'src/a\tb.ts';
  const before = await workTreeHash(dir);
  await fs.writeFile(path.join(dir, odd), 'export const t = 1;\n');
  const after = await workTreeHash(dir);
  const v = await judgeDrift({
    ...BASE, projectRoot: dir, before: snap(before), afterTreeHash: after, afterSubjectSha256: 'SUBJ',
    relatedPaths: [odd],
  });
  assert.equal(v.kind, 'related', `含制表符的路径应原样匹配上 relatedPaths，实际 ${JSON.stringify(v)}`);
  assert.deepEqual(v.kind === 'related' ? v.files : [], [odd]);
});

test('EV-139 U9：tree 值不合形状 ⇒ git_error，不调 git、不回显该值（以 - 开头的值会被 git 当成选项）', async () => {
  const dir = await repo();
  await fs.writeFile(path.join(dir, 'src/b.ts'), 'export const changed = true;\n');
  const after = await workTreeHash(dir);
  const pwned = path.join(dir, 'pwned-by-option.txt');
  const cases: Array<{ before: string; afterTree: string; which: string }> = [
    { before: `--output=${pwned}`, afterTree: after, which: '送审快照的 tree' },
    { before: 'a'.repeat(39), afterTree: after, which: '送审快照的 tree' },
    { before: after, afterTree: `--output=${pwned}`, which: '跑后复算的 tree' },
  ];
  for (const c of cases) {
    const v = asUnknown(await judgeDrift({
      ...BASE, projectRoot: dir, before: snap(c.before), afterTreeHash: c.afterTree, afterSubjectSha256: 'SUBJ',
    }));
    assert.equal(v.cause, 'git_error');
    assert.equal(v.detail, `${c.which} 值不是合法的 git 对象名（不回显该值）`);
    assert.ok(!v.detail.includes('--output'), 'detail 不得回显该值');
  }
  await assert.rejects(fs.stat(pwned), '形状闸在任何 git 调用之前：选项形态的值不得让 git 写出文件');
});
