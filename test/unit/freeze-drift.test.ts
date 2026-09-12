import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { judgeDrift, driftAction, type Snapshot } from '../../src/trivium/freeze.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { initFixtureRepo, workTreeHash } from '../../src/trivium/util/git.js';

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
