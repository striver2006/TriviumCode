import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { resolveTaskGoal, resolvePlanFinal, PLAN_FINAL_UNLISTED_WARNING, type PlanFinal } from '../../src/trivium/review.js';
import { emptyTask, updateTask, readTask } from '../../src/trivium/meta.js';
import { stageDir, topicDir, type ArchiveLayout } from '../../src/trivium/archive.js';
import type { Stage } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

const TOPIC = '登录重构';

/** 夹具根（realpath 过）与归档布局；`root` 同时当 projectRoot 用：桩与被测函数同根 */
async function fixture(): Promise<ArchiveLayout & { root: string }> {
  const root = await fs.realpath(await scratchDir('trivium-goal-'));
  const layout = { archiveRoot: path.join(root, '.reviews'), topic: TOPIC, root };
  await fs.mkdir(stageDir(layout, 'code'), { recursive: true });
  return layout;
}

async function writeTask(l: ArchiveLayout, mutate: (t: ReturnType<typeof emptyTask>) => void): Promise<void> {
  const t = emptyTask(l.topic);
  mutate(t);
  await fs.writeFile(path.join(topicDir(l), 'task.json'), JSON.stringify(t, null, 2), 'utf8');
}

async function writeTaskGoal(l: ArchiveLayout, goal: string | null): Promise<void> {
  await writeTask(l, (t) => { t.goal = goal; });
}

/** 计划阶段声明为 codex（任务文件的按阶段声明；第 2 级判据），任务文件无目标 */
async function claimPlanCodex(l: ArchiveLayout): Promise<void> {
  await writeTask(l, (t) => {
    t.drivers = { plan: { driver: 'codex', claimed_at: '2026-10-05T00:00:00.000Z', claimed_by: 'test', history: [] } } as typeof t.drivers;
  });
}

async function writePlanFile(l: ArchiveLayout, name: string, body: string): Promise<void> {
  await fs.mkdir(path.dirname(path.join(stageDir(l, 'plan'), name)), { recursive: true });
  await fs.writeFile(path.join(stageDir(l, 'plan'), name), body, 'utf8');
}

async function writePlanDoc(l: ArchiveLayout, body: string): Promise<void> {
  await writePlanFile(l, `2026-09-10-${TOPIC}-claude.md`, body);
}

const ref = (l: ArchiveLayout) => ({ topic: TOPIC, layout: l });
const opts = (taskGoal: string | null = null, stage: Stage = 'code') => ({ taskGoal, stage });
/** 生产侧同一个取法：按计划阶段执笔方取定稿 */
const lookup = (l: ArchiveLayout & { root: string }) => () => resolvePlanFinal(ref(l), l.root);
const goal = (l: ArchiveLayout & { root: string }, o = opts()) => resolveTaskGoal(o, ref(l), l.root, lookup(l));

test('显式 --goal 优先于 task.json 与计划定稿', async () => {
  const l = await fixture();
  await writeTaskGoal(l, '落盘的旧目标');
  await writePlanDoc(l, '# 计划标题\n');
  assert.equal(await goal(l, opts('命令行目标')), '命令行目标');
});

test('无 --goal 时回退 task.json 的 goal', async () => {
  const l = await fixture();
  await writeTaskGoal(l, '把登录改造为 OIDC');
  await writePlanDoc(l, '# 不该被用到的标题\n');
  assert.equal(await goal(l), '把登录改造为 OIDC');
});

test('task.json 无 goal 时回退计划定稿的首个标题，跳过 front matter', async () => {
  const l = await fixture();
  await writeTaskGoal(l, null);
  await writePlanDoc(l, '---\ntitle: x\n---\n\n# 把登录改造为 OIDC\n\n正文\n');
  assert.equal(await goal(l), '把登录改造为 OIDC');
});

test('计划定稿无标题时取首段正文，且不把围栏代码块当标题', async () => {
  const l = await fixture();
  await writeTaskGoal(l, null);
  await writePlanDoc(l, '```bash\n# 这是代码注释不是标题\n```\n\n本次要把登录改造为 OIDC。\n');
  assert.equal(await goal(l), '本次要把登录改造为 OIDC。');
});

test('三级来源全空时返回 null，不兜底成主题名', async () => {
  const l = await fixture();
  assert.equal(await goal(l), null);
});

test('plan 阶段不回退计划文档（被审对象就是它，同义反复）', async () => {
  const l = await fixture();
  await writePlanDoc(l, '# 把登录改造为 OIDC\n');
  assert.equal(await goal(l, opts(null, 'plan')), null);
});

test('超长目标被截断到 200 字符加省略号', async () => {
  const l = await fixture();
  const long = '标'.repeat(300);
  const r = await goal(l, opts(long));
  assert.equal(r?.length, 201);
  assert.ok(r?.endsWith('…'));
});

/*
 * task.json 的读改写在短临界区内：原子替换只防撕裂不防丢更新。
 * worker 收尾的 registerRun、verify 的登记、approve 的审批记录三者并发时，
 * 原先互不持锁（withTopicLock 全仓零调用），后写者用旧内存态覆盖前者。
 */
test('并发 updateTask 不丢更新（走 .task-<主题> 短临界区）', async () => {
  const l = await fixture();
  const triviumDir = await scratchDir('trivium-goal-lock-');
  const lock = { triviumDir, heartbeatStaleMs: 120_000 };
  await Promise.all(
    Array.from({ length: 8 }, (_, i) =>
      updateTask(l, (t) => {
        t.runs.push({ run_id: `R${i}`, stage: 'code', rerun_index: 1, status: 'success', review_mode: 'dual', started_at: 'x' });
      }, lock),
    ),
  );
  const t = await readTask(l);
  assert.equal(t.runs.length, 8, `8 个并发登记应全部保留，实际 ${t.runs.length}`);
  // 临界区锁名不与主题锁撞名：主题锁 `<主题>.lock` 此时不存在
  const locks = await fs.readdir(path.join(triviumDir, 'lock')).catch(() => [] as string[]);
  assert.ok(!locks.includes(`${TOPIC}.lock`), '不得占用主题的长持锁，否则 worker 自己收尾会自锁');
});

/*
 * 持久化边界：从计划定稿推导出的目标**不得**写回 task.json。
 * 它只是个猜测，一旦占位就会把日后真正传进来的 --goal 挡在门外。
 * （写入发生在 review.ts 的 prepare 阶段，这里直接校验 resolveTaskGoal
 *   本身无副作用——它只读，不碰 task.json。）
 */
test('推导目标不写回 task.json，resolveTaskGoal 全程只读', async () => {
  const l = await fixture();
  await writeTaskGoal(l, null);
  await writePlanDoc(l, '# 把登录改造为 OIDC\n');

  assert.equal(await goal(l), '把登录改造为 OIDC');

  const after = JSON.parse(
    await fs.readFile(path.join(topicDir(l), 'task.json'), 'utf8'),
  ) as { goal: string | null };
  assert.equal(after.goal, null, '推导值被写回了 task.json');
});

// ─────────────── EV-212：第三级按计划阶段执笔方取计划定稿 ───────────────

test('T1 · 计划阶段声明 codex：代码与 bug 阶段都取 -r2-codex.md 的标题，不取 claude 后缀那份、也不取 r1', async () => {
  const l = await fixture();
  await claimPlanCodex(l);
  await writePlanFile(l, `2026-10-04-${TOPIC}-codex.md`, '# 甲：codex 原稿\n');
  await writePlanFile(l, `2026-10-05-${TOPIC}-r2-codex.md`, '# 乙：codex 定稿\n');
  await writePlanFile(l, `2026-10-05-${TOPIC}-claude.md`, '# 丙：claude 后缀\n');
  assert.equal(await goal(l, opts(null, 'code')), '乙：codex 定稿');
  assert.equal(await goal(l, opts(null, 'bug')), '乙：codex 定稿');
});

test('T2 · 别家后缀不误取：计划阶段声明 codex、目录里只有 -claude.md ⇒ null', async () => {
  const l = await fixture();
  await claimPlanCodex(l);
  await writePlanFile(l, `2026-10-05-${TOPIC}-claude.md`, '# 别家后缀的计划\n');
  assert.equal(await goal(l, opts(null, 'code')), null);
  assert.equal(await goal(l, opts(null, 'bug')), null);
});

test('T3 · 计划阶段留痕读不出：代码与 bug 阶段都 null、不抛（不取、不拒跑、不报错）', async () => {
  const l = await fixture();
  await writePlanFile(l, `2026-10-05-${TOPIC}-r2-claude.md`, '# 不该被取到\n');
  await writePlanFile(l, '_meta/run-20261005T000000Z.json', '{ 坏');
  // 前提：取件这一层确实判为留痕读不出（带告警），不是「没有计划阶段」
  assert.equal((await resolvePlanFinal(ref(l), l.root)).warning?.name, PLAN_FINAL_UNLISTED_WARNING);
  assert.equal(await goal(l, opts(null, 'code')), null);
  assert.equal(await goal(l, opts(null, 'bug')), null);
});

/** 计数桩：记调用次数，返回给定结果 */
function countingLookup(result: PlanFinal | (() => never)): { fn: () => Promise<PlanFinal>; calls: () => number } {
  let n = 0;
  return {
    fn: async () => {
      n += 1;
      return typeof result === 'function' ? result() : result;
    },
    calls: () => n,
  };
}

test('T4 · 惰性：显式目标、任务文件有目标、计划阶段都不调取件；走到第三级时恰调一次', async () => {
  const l = await fixture();
  await writePlanDoc(l, '# 计划标题\n');
  const rel = path.relative(l.root, path.join(stageDir(l, 'plan'), `2026-09-10-${TOPIC}-claude.md`));

  const a = countingLookup({ path: rel, warning: null });
  assert.equal(await resolveTaskGoal(opts('显式'), ref(l), l.root, a.fn), '显式');
  assert.equal(a.calls(), 0, '显式 --goal 时不该取计划定稿');

  const b = countingLookup({ path: rel, warning: null });
  assert.equal(await resolveTaskGoal(opts(null, 'plan'), ref(l), l.root, b.fn), null);
  assert.equal(b.calls(), 0, '计划阶段不走第三级');

  const c = countingLookup({ path: rel, warning: null });
  assert.equal(await resolveTaskGoal(opts(null, 'bug'), ref(l), l.root, c.fn), '计划标题');
  assert.equal(c.calls(), 1, '第三级恰调一次');

  await writeTaskGoal(l, '任务文件的目标');
  const d = countingLookup({ path: rel, warning: null });
  assert.equal(await resolveTaskGoal(opts(null, 'code'), ref(l), l.root, d.fn), '任务文件的目标');
  assert.equal(d.calls(), 0, '任务文件有目标时不该取计划定稿');
});

test('T5 · 取件抛错 ⇒ null（bug 阶段现算那次不新增拒跑面）', async () => {
  const l = await fixture();
  const boom = countingLookup(() => { throw new Error('留痕读取意外失败'); });
  assert.equal(await resolveTaskGoal(opts(null, 'bug'), ref(l), l.root, boom.fn), null);
  assert.equal(boom.calls(), 1);
});

test('T6 · 取件返回 path 为 null 且带告警 ⇒ null，告警不进返回值', async () => {
  const l = await fixture();
  const w = countingLookup({ path: null, warning: { name: PLAN_FINAL_UNLISTED_WARNING, detail: 'x' } });
  assert.equal(await resolveTaskGoal(opts(null, 'bug'), ref(l), l.root, w.fn), null);
  assert.equal(await resolveTaskGoal(opts(null, 'code'), ref(l), l.root, w.fn), null);
});

/*
 * 计划双审 GLM-01：取件给的是项目相对路径，第三级必须按**同一个** projectRoot 还原。
 * 这里桩与被测函数共用一个与进程 cwd、与夹具都不同的根：relative 产出 `..` 开头的路径，
 * 正确实现还原后读得到；改成按进程 cwd 读就落 catch 返回 null。集成侧子进程 cwd 就是项目根，
 * 对那种变异没有鉴别力；单测侧凡项目根与 cwd 不同、且期望取到目标的格都能杀它（变异实测 6 格红，
 * 代码双审 CODEX-04 订正了「唯一杀手」的说法）。本格是专为它写的那一格，所以务必断言**非空**——
 * 桩与函数的根一旦不一致，正确实现与变异会同样返回 null，这一格就退化成永绿（计划双审 GLM-01）。
 */
test('T7 · projectRoot 与 cwd 不同：按同一个根还原相对路径，取到非空目标', async () => {
  const l = await fixture();
  await writePlanDoc(l, '# 换了根也取得到\n');
  const proj = '/proj';
  assert.notEqual(process.cwd(), proj);
  const r = await resolveTaskGoal(opts(), ref(l), proj, () => resolvePlanFinal(ref(l), proj));
  assert.equal(r, '换了根也取得到');
});
