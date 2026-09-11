import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { resolveTaskGoal } from '../../src/trivium/review.js';
import { emptyTask } from '../../src/trivium/meta.js';
import { stageDir, topicDir, type ArchiveLayout } from '../../src/trivium/archive.js';

const TOPIC = '登录重构';

async function fixture(): Promise<ArchiveLayout> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tv-goal-'));
  const layout: ArchiveLayout = { archiveRoot: path.join(root, '.reviews'), topic: TOPIC };
  await fs.mkdir(stageDir(layout, 'code'), { recursive: true });
  return layout;
}

async function writeTaskGoal(l: ArchiveLayout, goal: string | null): Promise<void> {
  const t = emptyTask(l.topic);
  t.goal = goal;
  await fs.writeFile(path.join(topicDir(l), 'task.json'), JSON.stringify(t, null, 2), 'utf8');
}

async function writePlanDoc(l: ArchiveLayout, body: string): Promise<void> {
  await fs.mkdir(stageDir(l, 'plan'), { recursive: true });
  await fs.writeFile(
    path.join(stageDir(l, 'plan'), `2026-09-10-${TOPIC}-claude.md`),
    body,
    'utf8',
  );
}

const ref = (l: ArchiveLayout) => ({ topic: TOPIC, layout: l });
const opts = (taskGoal: string | null = null) =>
  ({ taskGoal, stage: 'code' as const, subjectFile: null });

test('显式 --goal 优先于 task.json 与 plan 原稿', async () => {
  const l = await fixture();
  await writeTaskGoal(l, '落盘的旧目标');
  await writePlanDoc(l, '# 计划标题\n');
  assert.equal(await resolveTaskGoal(opts('命令行目标'), ref(l), '/proj'), '命令行目标');
});

test('无 --goal 时回退 task.json 的 goal', async () => {
  const l = await fixture();
  await writeTaskGoal(l, '把登录改造为 OIDC');
  await writePlanDoc(l, '# 不该被用到的标题\n');
  assert.equal(await resolveTaskGoal(opts(), ref(l), '/proj'), '把登录改造为 OIDC');
});

test('task.json 无 goal 时回退 plan 原稿的首个标题，跳过 front matter', async () => {
  const l = await fixture();
  await writeTaskGoal(l, null);
  await writePlanDoc(l, '---\ntitle: x\n---\n\n# 把登录改造为 OIDC\n\n正文\n');
  assert.equal(await resolveTaskGoal(opts(), ref(l), '/proj'), '把登录改造为 OIDC');
});

test('plan 原稿无标题时取首段正文，且不把围栏代码块当标题', async () => {
  const l = await fixture();
  await writeTaskGoal(l, null);
  await writePlanDoc(l, '```bash\n# 这是代码注释不是标题\n```\n\n本次要把登录改造为 OIDC。\n');
  assert.equal(await resolveTaskGoal(opts(), ref(l), '/proj'), '本次要把登录改造为 OIDC。');
});

test('三级来源全空时返回 null，不兜底成主题名', async () => {
  const l = await fixture();
  assert.equal(await resolveTaskGoal(opts(), ref(l), '/proj'), null);
});

test('plan 阶段不回退 plan 原稿（被审对象就是它，同义反复）', async () => {
  const l = await fixture();
  await writePlanDoc(l, '# 把登录改造为 OIDC\n');
  const r = await resolveTaskGoal({ taskGoal: null, stage: 'plan', subjectFile: null }, ref(l), '/proj');
  assert.equal(r, null);
});

test('超长目标被截断到 200 字符加省略号', async () => {
  const l = await fixture();
  const long = '标'.repeat(300);
  const r = await resolveTaskGoal(opts(long), ref(l), '/proj');
  assert.equal(r?.length, 201);
  assert.ok(r?.endsWith('…'));
});

/*
 * 持久化边界：从 plan 原稿推导出的目标**不得**写回 task.json。
 * 它只是个猜测，一旦占位就会把日后真正传进来的 --goal 挡在门外。
 * （写入发生在 review.ts 的 prepare 阶段，这里直接校验 resolveTaskGoal
 *   本身无副作用——它只读，不碰 task.json。）
 */
test('推导目标不写回 task.json，resolveTaskGoal 全程只读', async () => {
  const l = await fixture();
  await writeTaskGoal(l, null);
  await writePlanDoc(l, '# 把登录改造为 OIDC\n');

  assert.equal(await resolveTaskGoal(opts(), ref(l), '/proj'), '把登录改造为 OIDC');

  const after = JSON.parse(
    await fs.readFile(path.join(topicDir(l), 'task.json'), 'utf8'),
  ) as { goal: string | null };
  assert.equal(after.goal, null, '推导值被写回了 task.json');
});
