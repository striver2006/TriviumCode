/**
 * **按阶段 Driver 声明**的判据（M10a 第 1 步，EV-72）。
 *
 * 三层分开测，各自的鉴别力不同：
 *
 *   · **分支表**（纯函数）——`claimStageDriver` 的六格，直接喂构造好的输入；
 *   · **三级判定**（Hook 真链路）——`hookPreWrite` 经 `resolveRoundDriver` 的落点，
 *     这一层才证明「声明真的让非缺省 Driver 写得出原稿」；
 *   · **交叉校验与不变量**——两个选侧入口共用的那两条。
 *
 * ## 为什么分支表要单独测而不是只跑 CLI
 *
 * 分支 3′（撤回权因「声明已被使用」而消失）要构造「目录里有带旧后缀的文件」，
 * 经 CLI 造这个前置状态本身就要绕过 Hook 保护。纯函数层直接摆文件即可，
 * 而 CLI 层只需证明「分支结果被正确地翻译成退出码与落盘」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  claimStageDriver, crossCheckDriver, declaredStageDriver, filesBearingSuffix,
  stageDriverInvariant,
} from '../../src/trivium/driver-claim.js';
import { hookPreWrite, type HookInput } from '../../src/trivium/hooks.js';
import { emptyTask, newRunMeta } from '../../src/trivium/meta.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { AgentId, Ctx } from '../../src/trivium/types.js';

const SESSION = 'sess-claim';

async function fakeCtx(): Promise<Ctx> {
  const raw = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-claim-'));
  const root = await fs.realpath(raw);
  const triviumDir = path.join(root, '.trivium');
  await fs.mkdir(triviumDir, { recursive: true });
  await fs.writeFile(path.join(triviumDir, 'config.yaml'), 'schema: trivium.config.v1\n');
  return {
    config: defaultConfig(),
    projectRoot: root,
    archiveRoot: path.join(root, '.reviews'),
    triviumDir,
    sources: ['<test>'],
  };
}

function writeInput(filePath: string): HookInput {
  return { session_id: SESSION, tool_name: 'Write', tool_input: { file_path: filePath } };
}

async function seedRunMeta(
  ctx: Ctx, topic: string, stage: 'plan' | 'code' | 'bug', runId: string, driver: AgentId,
): Promise<void> {
  const dir = path.join(ctx.archiveRoot, topic, stage, '_meta');
  await fs.mkdir(dir, { recursive: true });
  const meta = newRunMeta({
    runId, topic, stage, rerunIndex: 1, command: 'x',
    promptHint: null, taskGoal: null, criticsSelected: ['gemini', 'glm'],
    treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's',
    denyPaths: [], driftPolicy: 'warn', driver,
  });
  await fs.writeFile(path.join(dir, `run-${runId}.json`), JSON.stringify(meta));
}

/** 直接写 task.json 的 drivers 段——测「读侧」时不绕 claim 的分支判定 */
async function seedClaim(
  ctx: Ctx, topic: string, stage: 'plan' | 'code' | 'bug', driver: AgentId,
): Promise<void> {
  const dir = path.join(ctx.archiveRoot, topic);
  await fs.mkdir(dir, { recursive: true });
  const t = emptyTask(topic);
  t.drivers = { [stage]: { driver, claimed_at: '2026-09-22T00:00:00.000Z', claimed_by: SESSION } };
  await fs.writeFile(path.join(dir, 'task.json'), JSON.stringify(t));
}

/** 一次种多个阶段的声明——「按阶段不按主题」的判据要两个阶段同时在场才构造得出来 */
async function seedClaims(
  ctx: Ctx, topic: string, byStage: Partial<Record<'plan' | 'code' | 'bug', AgentId>>,
): Promise<void> {
  const dir = path.join(ctx.archiveRoot, topic);
  await fs.mkdir(dir, { recursive: true });
  const t = emptyTask(topic);
  t.drivers = {};
  for (const [stage, driver] of Object.entries(byStage)) {
    t.drivers[stage as 'plan' | 'code' | 'bug'] = {
      driver: driver as AgentId, claimed_at: '2026-09-22T00:00:00.000Z', claimed_by: SESSION,
    };
  }
  await fs.writeFile(path.join(dir, 'task.json'), JSON.stringify(t));
}

const layoutOf = (ctx: Ctx, topic: string): { archiveRoot: string; topic: string } => ({
  archiveRoot: ctx.archiveRoot,
  topic,
});

// ══════════════════════════════════════════════════════════════
// 一、分支表（计划 §2.3 逐行）
// ══════════════════════════════════════════════════════════════

test('分支 1：该阶段已有 run 留痕且不同 ⇒ 拒，且指向留痕', async () => {
  const ctx = await fakeCtx();
  const r = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'code', driver: 'glm', claimedBy: SESSION,
    runDriver: 'claude',
    // **已声明且与留痕不同**：这正是分支 1 必须排在「已声明」判定之前的那一格。
    // 排序反了的话，这里会落到幂等或撤回分支，非法态被静默接受（r5 GLM-08）。
    existing: { driver: 'glm', claimed_at: 'x', claimed_by: 'y' },
  });
  assert.equal(r.kind, 'blocked-by-run');
  assert.equal(r.kind === 'blocked-by-run' && r.runDriver, 'claude');
});

test('分支 2：已声明且相同 ⇒ 幂等，且不刷新 claimed_at', async () => {
  const ctx = await fakeCtx();
  const existing = { driver: 'glm' as AgentId, claimed_at: 'T0', claimed_by: 'who' };
  const r = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'code', driver: 'glm', claimedBy: 'other-session',
    runDriver: null, existing, now: 'T9',
  });
  assert.equal(r.kind, 'noop');
  /*
   * `claimed_at` 必须还是 T0。幂等档若照写一遍，「什么时候认领的」这个审计事实
   * 会随每次重跑往后漂——而它正是自声明边界要留的那条线索。
   */
  assert.equal(r.kind === 'noop' && r.claim.claimed_at, 'T0');
  assert.equal(r.kind === 'noop' && r.claim.claimed_by, 'who');
});

test('分支 3：零 run 留痕、声明未被使用 ⇒ 撤回改写，旧声明整条入 history', async () => {
  const ctx = await fakeCtx();
  const r = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'plan', driver: 'claude', claimedBy: 'sess-B',
    runDriver: null,
    existing: { driver: 'glm', claimed_at: 'T0', claimed_by: 'sess-A' },
    now: 'T1',
  });
  assert.equal(r.kind, 'revoked');
  if (r.kind !== 'revoked') return;
  assert.equal(r.previous, 'glm');
  assert.equal(r.claim.driver, 'claude');
  assert.deepEqual(r.claim.history, [
    { driver: 'glm', claimed_at: 'T0', claimed_by: 'sess-A', revoked_at: 'T1' },
  ]);
});

test('分支 3：镜像死锁序列仍然解得开（分支 3 的原始职责）', async () => {
  const ctx = await fakeCtx();
  /*
   * 死锁序列：claim glm（零留痕放行）⇒ 发现该用 claude ⇒ 改不回声明 ⇒ 建不了留痕
   * ⇒ task.json 双侧独占 ⇒ 出路只剩新开主题或终端手改受保护文件。
   * 关键前置是「**声明了但还没动手**」——此时该阶段目录下没有任何 -glm.md。
   */
  const r = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'plan', driver: 'claude', claimedBy: SESSION,
    runDriver: null, existing: { driver: 'glm', claimed_at: 'T0', claimed_by: SESSION },
  });
  assert.equal(r.kind, 'revoked', '零留痕、零文件时撤回必须放行，否则死锁回来了');
});

test("分支 3′：声明已被使用（目录有带其后缀的文件）⇒ 撤回权消失", async () => {
  const ctx = await fakeCtx();
  const stageDir = path.join(ctx.archiveRoot, 't/plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, '2026-09-22-t-glm.md'), '# 原稿\n');

  const r = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'plan', driver: 'claude', claimedBy: SESSION,
    runDriver: null, existing: { driver: 'glm', claimed_at: 'T0', claimed_by: SESSION },
  });
  assert.equal(r.kind, 'blocked-by-usage');
  if (r.kind !== 'blocked-by-usage') return;
  assert.equal(r.previous, 'glm');
  assert.deepEqual(r.files, ['2026-09-22-t-glm.md']);
});

test('分支 4：新阶段首次声明 ⇒ 放行', async () => {
  const ctx = await fakeCtx();
  const r = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'bug', driver: 'codex', claimedBy: SESSION,
    runDriver: null, existing: null, now: 'T5',
  });
  assert.equal(r.kind, 'claimed');
  assert.equal(r.kind === 'claimed' && r.claim.claimed_at, 'T5');
  assert.equal(r.kind === 'claimed' && r.claim.history, undefined);
});

test('分支 4：与既有留痕一致的认领 ⇒ 放行（不被分支 1 误伤）', async () => {
  const ctx = await fakeCtx();
  const r = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'code', driver: 'claude', claimedBy: SESSION,
    runDriver: 'claude', existing: null,
  });
  assert.equal(r.kind, 'claimed');
});

// ══════════════════════════════════════════════════════════════
// 二、反复翻转（计划 §2.4 自声明边界，r6 CODEX-02）
// ══════════════════════════════════════════════════════════════

/*
 * **这条是本步的安全用例**。
 *
 * 只以「零 run 留痕」为撤回前置时，同一个会话可以：
 *   claim glm ⇒ 写 -glm.md ⇒ 撤回 claim codex ⇒ 写 -codex.md ⇒ …
 * 在首份 run 留痕诞生前依次拿到**每一家**的后缀豁免——而保护集正是
 * 「全集减当轮 Driver」，当轮 Driver 又取自这个自声明。
 *
 * 断言写成「**第二次翻转必须失败**」而不是「某个具体文件被拦」：
 * 前者锁的是能力（能不能连续取得第二个后缀），后者只锁一个样本。
 */
test('反复翻转：用掉一个后缀之后拿不到第二个', async () => {
  const ctx = await fakeCtx();
  const stageDir = path.join(ctx.archiveRoot, 't/plan');
  await fs.mkdir(stageDir, { recursive: true });

  // 第 1 次翻转：零文件，放行
  const first = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'plan', driver: 'glm', claimedBy: SESSION,
    runDriver: null, existing: { driver: 'codex', claimed_at: 'T0', claimed_by: SESSION },
  });
  assert.equal(first.kind, 'revoked', '还没用过的声明可以撤回');

  // 用掉它：写一份带 glm 后缀的文件
  await fs.writeFile(path.join(stageDir, '2026-09-22-t-glm.md'), '# 原稿\n');

  // 第 2 次翻转：必须失败
  const second = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'plan', driver: 'gemini', claimedBy: SESSION,
    runDriver: null, existing: { driver: 'glm', claimed_at: 'T1', claimed_by: SESSION },
  });
  assert.equal(
    second.kind, 'blocked-by-usage',
    '声明一旦用来写出文件就等同留痕；否则同一会话可依次拿到每一家的后缀豁免',
  );
});

test('声明史追加不覆盖：连续两次撤回留下两条', async () => {
  const ctx = await fakeCtx();
  const r1 = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'plan', driver: 'glm', claimedBy: 'sA',
    runDriver: null, existing: { driver: 'codex', claimed_at: 'T0', claimed_by: 'sZ' },
    now: 'T1',
  });
  assert.equal(r1.kind, 'revoked');
  if (r1.kind !== 'revoked') return;

  const r2 = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'plan', driver: 'gemini', claimedBy: 'sB',
    runDriver: null, existing: r1.claim, now: 'T2',
  });
  assert.equal(r2.kind, 'revoked');
  if (r2.kind !== 'revoked') return;
  assert.equal(r2.claim.history?.length, 2, '追加不覆盖——撤回史是审计面');
  assert.deepEqual(
    r2.claim.history?.map((h) => h.driver), ['codex', 'glm'],
    '按撤回先后排列',
  );
  // 入史的条目不得自带嵌套 history，否则每撤回一次整棵历史翻倍
  assert.equal(
    JSON.stringify(r2.claim.history).includes('"history"'), false,
    '入史条目要剥掉自己的 history 字段',
  );
});

/*
 * **嵌套路径同样算「用过」**（代码双审 r1 CODEX-04）。
 *
 * 上一版只扫阶段目录第一层，而 Hook 的 `stageSegmentsUnder` 只设段数**下界**、
 * 不设上界——`<主题>/plan/sub/x-glm.md` 照样定位到 plan 阶段、按它的 Driver 放行。
 * 于是嵌套一层就逃出论域：`claim glm` → 写 `plan/sub/x-glm.md` → `claim codex`
 * 判为「未被使用」→ 再拿一个后缀。**两份判据不同宽就是那条逃逸路径的成因。**
 */
test('论域含嵌套子目录：写在子目录里的后缀文件照样挡住换手', async () => {
  const ctx = await fakeCtx();
  const sub = path.join(ctx.archiveRoot, 't/plan/sub');
  await fs.mkdir(sub, { recursive: true });
  await fs.writeFile(path.join(sub, '2026-09-22-t-glm.md'), '# 原稿\n');

  // 先确认这条路径在 Hook 眼里确实属于 plan 阶段——否则本用例测的是个不存在的威胁
  await seedClaims(ctx, 't', { plan: 'glm' });
  assert.equal(
    (await hookPreWrite(ctx, writeInput(path.join(sub, '2026-09-22-t-glm.md')))).exitCode,
    EXIT.OK,
    'Hook 对嵌套路径按该阶段的 Driver 判定（段数只有下界）',
  );

  const r = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'plan', driver: 'codex', claimedBy: SESSION,
    runDriver: null, existing: { driver: 'glm', claimed_at: 'T0', claimed_by: SESSION },
  });
  assert.equal(r.kind, 'blocked-by-usage');
  assert.deepEqual(
    r.kind === 'blocked-by-usage' ? r.files : [],
    [path.join('sub', '2026-09-22-t-glm.md')],
    '文案要给出相对阶段目录的路径，用户才找得到要清理什么',
  );
});

/*
 * **分支 4 也要查**（代码双审 r1 GLM-05）。
 *
 * 分支 3′ 关掉的是「撤回链翻转」，但还有一条**不经撤回**的序列：
 * 无声明期缺省 Driver 先写 `-claude.md`（第 3 级判定下合法，保护集不含 claude）
 * → 首次 `claim glm` 走分支 4、上一版不做任何检查 → 再写 `-glm.md`。
 * 同一会话在首份 run 留痕诞生前照样留下两个后缀的文件。
 */
test('分支 4：首次认领时若已有他家后缀的文件，同样拒绝', async () => {
  const ctx = await fakeCtx();
  const stageDir = path.join(ctx.archiveRoot, 't/plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, '2026-09-22-t-claude.md'), '# 缺省 Driver 写的原稿\n');

  const r = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'plan', driver: 'glm', claimedBy: SESSION,
    runDriver: null, existing: null, // ← 从没声明过，走的就是分支 4
  });
  assert.equal(
    r.kind, 'blocked-by-usage',
    '不经撤回的那条序列也要关掉，否则「用掉即锁死」这句话是假的',
  );
  assert.equal(r.kind === 'blocked-by-usage' && r.previous, 'claude');
});

test('分支 4：认领目标自己的后缀不算「他家占用」', async () => {
  const ctx = await fakeCtx();
  const stageDir = path.join(ctx.archiveRoot, 't/plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, '2026-09-22-t-glm.md'), '# 原稿\n');
  const r = await claimStageDriver({
    layout: layoutOf(ctx, 't'), stage: 'plan', driver: 'glm', claimedBy: SESSION,
    runDriver: null, existing: null,
  });
  assert.equal(r.kind, 'claimed', '把认领目标自己的文件算成占用，会把首次认领堵成死局');
});

/*
 * **安全收紧分支在 I/O 异常时不得 fail-open**（代码双审 r1 CODEX-05）。
 *
 * 上一版 `catch { return [] }` 把 EACCES / ELOOP 一律折成「该阶段没有任何文件」——
 * 而这个函数的返回值正是「换手该不该被拒」的判据，读不出来就当没有，等于读不出来就放行。
 * 同仓 `latestRunMeta` 在同一件事上明确区分「一份都没有」与「有但读不出」。
 */
test('论域 I/O 异常不得 fail-open：目录不存在算空，其余抛出', async () => {
  const ctx = await fakeCtx();
  // ① 目录不存在 = 该阶段还没有任何文件，属正常
  assert.deepEqual(await filesBearingSuffix(layoutOf(ctx, 't'), 'plan', 'glm'), []);

  // ② 用一个**文件**顶替阶段目录 ⇒ ENOTDIR。它同样是「这里没有目录」，与 ENOENT 同档
  await fs.mkdir(path.join(ctx.archiveRoot, 't'), { recursive: true });
  await fs.writeFile(path.join(ctx.archiveRoot, 't/plan'), 'not a dir');
  assert.deepEqual(await filesBearingSuffix(layoutOf(ctx, 't'), 'plan', 'glm'), []);

  /*
   * ③ 真正要防的那一族：**读得到路径但读不出内容**。
   * 用一对互指的软链造 ELOOP——比 chmod 造 EACCES 稳（后者在 root 下不成立）。
   */
  const topicDir = path.join(ctx.archiveRoot, 'loop');
  await fs.mkdir(topicDir, { recursive: true });
  await fs.symlink('b', path.join(topicDir, 'bug'));
  await fs.symlink('bug', path.join(topicDir, 'b'));
  await assert.rejects(
    () => filesBearingSuffix(layoutOf(ctx, 'loop'), 'bug', 'glm'),
    (e: NodeJS.ErrnoException) => e.code === 'ELOOP',
    '读不出来必须抛给调用方，不能当成「该阶段没有任何文件」而放行换手',
  );
});

test('filesBearingSuffix：只认该家的后缀，目录不存在返回空', async () => {
  const ctx = await fakeCtx();
  assert.deepEqual(await filesBearingSuffix(layoutOf(ctx, 't'), 'plan', 'glm'), []);

  const stageDir = path.join(ctx.archiveRoot, 't/plan');
  await fs.mkdir(stageDir, { recursive: true });
  for (const f of ['a-glm.md', 'b-codex.md', 'c-revised-glm.md', 'd-glm.txt', 'glm.md']) {
    await fs.writeFile(path.join(stageDir, f), 'x');
  }
  assert.deepEqual(
    await filesBearingSuffix(layoutOf(ctx, 't'), 'plan', 'glm'),
    ['a-glm.md', 'c-revised-glm.md'],
    '裁决件形态 -revised-glm.md 同样算「用过」；扩展名不对或没有连字符的不算',
  );
});

// ══════════════════════════════════════════════════════════════
// 三、三级判定（Hook 真链路）
// ══════════════════════════════════════════════════════════════

test('第 1 级：有留痕时取留痕，声明不参与', async () => {
  const ctx = await fakeCtx();
  await seedRunMeta(ctx, 't', 'code', 'R1', 'codex');
  await seedClaim(ctx, 't', 'code', 'glm'); // 声明说 glm，留痕说 codex

  // 留痕赢 ⇒ 当轮 Driver = codex ⇒ 保护集不含 codex ⇒ 写 -codex.md 放行
  const ok = path.join(ctx.archiveRoot, 't/code/2026-09-22-t-response-codex.md');
  assert.equal((await hookPreWrite(ctx, writeInput(ok))).exitCode, EXIT.OK);

  // 而声明的那一家（glm）在保护集里 ⇒ 拦。声明若赢了，这一条会放行
  const blocked = path.join(ctx.archiveRoot, 't/code/2026-09-22-t-glm.md');
  assert.equal((await hookPreWrite(ctx, writeInput(blocked))).exitCode, EXIT.GATE_BLOCK);
});

test('第 2 级：零留痕时取声明——非缺省 Driver 写得出自己的原稿', async () => {
  const ctx = await fakeCtx();
  await seedClaim(ctx, 't', 'plan', 'glm');

  /*
   * 这一条就是 EV-72 的靶心：plan 原稿写在 `review --start` 之前，
   * 那一刻该阶段零留痕。没有第 2 级时判定回落缺省 Driver，
   * `-glm.md` 落进保护集被判伪造件退 2——glm 连自己的原稿都写不出来。
   */
  const own = path.join(ctx.archiveRoot, 't/plan/2026-09-22-t-glm.md');
  const r = await hookPreWrite(ctx, writeInput(own));
  assert.equal(r.exitCode, EXIT.OK, '声明为 glm 时，glm 的原稿必须写得出来');

  // 反向：缺省 Driver 的后缀此时**进了**保护集
  const other = path.join(ctx.archiveRoot, 't/plan/2026-09-22-t-claude.md');
  const r2 = await hookPreWrite(ctx, writeInput(other));
  assert.equal(r2.exitCode, EXIT.GATE_BLOCK);
  assert.match(
    JSON.stringify(r2.json), /topic claim/,
    '拦截文案要说清判定来源是声明，否则用户查不到为什么判成这一家',
  );
});

test('第 3 级：既无留痕也无声明 ⇒ 缺省 Driver，文案点明', async () => {
  const ctx = await fakeCtx();
  const f = path.join(ctx.archiveRoot, 't/plan/2026-09-22-t-glm.md');
  const r = await hookPreWrite(ctx, writeInput(f));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  assert.match(JSON.stringify(r.json), /既无运行留痕也无声明/);
});

/*
 * **「按阶段而不按主题」的真判据**。
 *
 * 上一版这条用例写的是「plan 有 **run 留痕** claude + code 声明 glm」——
 * 变异验证当场打穿：plan 那边第 1 级就赢了，**压根走不到第 2 级**，
 * 把第 2 级换成「按主题取任意一条声明」它照样绿。
 *
 * 能鉴别的构造只有一个：**两个阶段都只有声明、且声明不同**。
 * 此时主题级单值必然给其中一个阶段回答错的那一家——而那正是计划里说的
 * 「精确覆盖跨阶段换 Driver 发生的那一刻」。
 */
test('按阶段不按主题：两个阶段各自的声明互不渗透', async () => {
  const ctx = await fakeCtx();
  await seedClaims(ctx, 't', { plan: 'claude', code: 'glm' });

  // code 声明 glm ⇒ glm 的原稿放行
  assert.equal(
    (await hookPreWrite(ctx, writeInput(
      path.join(ctx.archiveRoot, 't/code/2026-09-22-t-glm.md'),
    ))).exitCode,
    EXIT.OK,
  );
  // plan 声明 claude ⇒ glm 在保护集里 ⇒ 拦。按主题取值会让这一条放行
  assert.equal(
    (await hookPreWrite(ctx, writeInput(
      path.join(ctx.archiveRoot, 't/plan/2026-09-22-t-glm.md'),
    ))).exitCode,
    EXIT.GATE_BLOCK,
    'plan 的声明是 claude，code 的声明不得渗过去',
  );
  // 对称方向：plan 的 claude 原稿放行，code 的 claude 原稿被拦
  assert.equal(
    (await hookPreWrite(ctx, writeInput(
      path.join(ctx.archiveRoot, 't/plan/2026-09-22-t-claude.md'),
    ))).exitCode,
    EXIT.OK,
  );
  assert.equal(
    (await hookPreWrite(ctx, writeInput(
      path.join(ctx.archiveRoot, 't/code/2026-09-22-t-claude.md'),
    ))).exitCode,
    EXIT.GATE_BLOCK,
    '两个方向都要测——只测一边时，按主题取值有一半概率蒙对',
  );
});

test('跨阶段合法链路：plan 留痕 claude + code 声明 glm ⇒ 两边各按各的判', async () => {
  const ctx = await fakeCtx();
  await seedRunMeta(ctx, 't', 'plan', 'R1', 'claude');
  await seedClaim(ctx, 't', 'code', 'glm');

  /*
   * **这条用例是「按阶段而不按主题」的核心判据**。
   * 主题级单值会精确覆盖跨阶段换 Driver 发生的那一刻——而那正是本字段唯一有用的时候。
   */
  const codeOwn = path.join(ctx.archiveRoot, 't/code/2026-09-22-t-glm.md');
  assert.equal(
    (await hookPreWrite(ctx, writeInput(codeOwn))).exitCode, EXIT.OK,
    'code 阶段声明为 glm ⇒ glm 的原稿放行',
  );

  const planGlm = path.join(ctx.archiveRoot, 't/plan/2026-09-22-t-glm.md');
  assert.equal(
    (await hookPreWrite(ctx, writeInput(planGlm))).exitCode, EXIT.GATE_BLOCK,
    'plan 阶段留痕是 claude，code 的声明不得渗过去',
  );
});

test('留痕损坏时不降级到声明，仍硬失败', async () => {
  const ctx = await fakeCtx();
  const dir = path.join(ctx.archiveRoot, 't/code/_meta');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'run-RBAD.json'), '{ broken }');
  await seedClaim(ctx, 't', 'code', 'glm');

  /*
   * `corrupt` 的含义是「锚本身坏了」。此时退到一个**由被保护方自己写的**声明值，
   * 正好是把权威排序倒过来用——留痕坏了反而让声明说了算。
   */
  const f = path.join(ctx.archiveRoot, 't/code/2026-09-22-t-glm.md');
  const r = await hookPreWrite(ctx, writeInput(f));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
  assert.match(JSON.stringify(r.json), /RBAD/, '要点名是哪份留痕读不出来，不能静默用声明顶上');
});

test('task.json 损坏时落到第 3 级，不硬失败', async () => {
  const ctx = await fakeCtx();
  await fs.mkdir(path.join(ctx.archiveRoot, 't'), { recursive: true });
  await fs.writeFile(path.join(ctx.archiveRoot, 't/task.json'), '{ not json');

  /*
   * 「有没有人声明过」这一级读不出来时**没有可信的声明**，与「没声明」同档。
   * 在这里硬失败会把 Driver 写原稿的路一并堵死，而那不是安全收益是噪声——
   * task.json 损坏本身另有锚在管。
   */
  const f = path.join(ctx.archiveRoot, 't/plan/2026-09-22-t-glm.md');
  const r = await hookPreWrite(ctx, writeInput(f));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK, '落到缺省 Driver ⇒ glm 在保护集里 ⇒ 拦');
  assert.match(JSON.stringify(r.json), /既无运行留痕也无声明/);

  /*
   * **正向断言必须有**（代码双审 r1 AGY-01）：上一版只测了「glm 被拦」，
   * 而本用例注释自称的目的是「不让主题元数据损坏把 Driver 自己写原稿的路一并堵死」——
   * 反向拦截证不了正向可用性，那正好是半格盲区。
   */
  const own = path.join(ctx.archiveRoot, 't/plan/2026-09-22-t-claude.md');
  assert.equal(
    (await hookPreWrite(ctx, writeInput(own))).exitCode, EXIT.OK,
    '缺省 Driver 此时必须写得出自己的原稿，否则这条取舍就没换来可用性',
  );
});

test('孤儿兜底：旧后缀文件在场时，定位不受影响（存量数据）', async () => {
  const ctx = await fakeCtx();
  await seedClaim(ctx, 't', 'plan', 'claude');
  const stageDir = path.join(ctx.archiveRoot, 't/plan');
  await fs.mkdir(stageDir, { recursive: true });
  // 绕过 claim 直接造出来的存量孤儿
  await fs.writeFile(path.join(stageDir, '2026-09-20-t-glm.md'), '# 孤儿\n');

  /*
   * 分支 3′ 之后这一态不再产生，但存量数据要有兜底：
   * 孤儿仍在保护集里（当轮 Driver 是 claude），写它照样被拦。
   */
  const r = await hookPreWrite(ctx, writeInput(path.join(stageDir, '2026-09-20-t-glm.md')));
  assert.equal(r.exitCode, EXIT.GATE_BLOCK);
});

// ══════════════════════════════════════════════════════════════
// 四、交叉校验与不变量（两个选侧入口共用）
// ══════════════════════════════════════════════════════════════

test('交叉校验三档：有留痕比留痕、零留痕比声明、都没有则不校验', () => {
  const T = { topic: 't' };
  // ① 有留痕 ⇒ 与留痕比
  assert.equal(
    crossCheckDriver({ ...T, stage: 'code', driver: 'claude', runDriver: 'claude', declared: 'glm' }),
    null,
    '留痕一致即通过——声明不参与，它在这一档没有话语权',
  );
  const a = crossCheckDriver({
    ...T, stage: 'code', driver: 'glm', runDriver: 'claude', declared: 'glm',
  });
  assert.match(String(a), /运行留痕不符/);
  assert.match(String(a), /claude/, '错误文案要指向留痕的那个值');

  // ② 零留痕但有声明 ⇒ 与声明比
  assert.equal(
    crossCheckDriver({ ...T, stage: 'plan', driver: 'glm', runDriver: null, declared: 'glm' }), null,
  );
  const b = crossCheckDriver({
    ...T, stage: 'plan', driver: 'codex', runDriver: null, declared: 'glm',
  });
  assert.match(String(b), /声明不符/);

  // ③ 都没有 ⇒ 不校验（首次认领本就该放行）
  assert.equal(
    crossCheckDriver({ ...T, stage: 'plan', driver: 'codex', runDriver: null, declared: null }),
    null,
  );
});

/*
 * **省略旗标 = 继承，不是「传了缺省值」**（代码双审 r1 CODEX-01）。
 *
 * 上一版形参非空，而两个入口都传 `resolveDriver(旗标 ?? null).driver`——
 * 「没传」与「传了缺省值」不可区分。于是非缺省 Driver 的主题上**每一次省略该旗标的
 * 运行都退 64**，而文案还建议「去掉 --driver」，照做第二次仍被拒。
 *
 * 断言用 `null` 而不是 `DEFAULT_DRIVER`：后者恰恰是打不出区别的那个取值。
 */
test('交叉校验：省略旗标（driver=null）一律不比对', () => {
  const T = { topic: 't', driver: null } as const;
  assert.equal(crossCheckDriver({ ...T, stage: 'code', runDriver: 'glm', declared: null }), null);
  assert.equal(crossCheckDriver({ ...T, stage: 'plan', runDriver: null, declared: 'codex' }), null);
  // 反证：同一状态下显式传缺省值**要**被拒——两者必须给出不同答案
  assert.notEqual(
    crossCheckDriver({ topic: 't', stage: 'code', driver: 'claude', runDriver: 'glm', declared: null }),
    null,
    '显式传错值仍要拒，否则这条修法把校验一起关掉了',
  );
});

test('不变量：同阶段留痕与声明不一致 ⇒ 报错', () => {
  const T = { topic: 't' } as const;
  assert.equal(stageDriverInvariant({ ...T, stage: 'code', runDriver: null, declared: 'glm' }), null);
  assert.equal(stageDriverInvariant({ ...T, stage: 'code', runDriver: 'glm', declared: null }), null);
  assert.equal(stageDriverInvariant({ ...T, stage: 'code', runDriver: 'glm', declared: 'glm' }), null);

  const msg = stageDriverInvariant({ ...T, stage: 'code', runDriver: 'claude', declared: 'glm' });
  assert.match(String(msg), /没有合法来源/);
  assert.match(String(msg), /--topic t /, '出口命令要带上必填的主题旗标');
});

/*
 * **次序判据要打真入口，不能只断言纯函数**。
 *
 * 顺序反了会发生什么：留痕 claude、声明 glm、用户传 glm。
 * 先跑交叉校验 ⇒ 它按「有留痕比留痕」判 glm≠claude，报「与运行留痕不符」，
 * 用户以为是自己 `--driver` 传错了；而真正坏的是 task.json 被手改过。
 * 两条消息指向**不同的修法**，顺序决定用户走哪条。
 *
 * 只断言 `stageDriverInvariant` 非 null 证明不了这件事——它对两种排序都成立。
 * 能鉴别的只有「真入口报出来的是哪一条」。
 */
test('不变量先于交叉校验：真入口报的是「没有合法来源」而不是「传错了」', async () => {
  const ctx = await fakeCtx();
  await seedRunMeta(ctx, 't', 'code', 'R1', 'claude');
  await seedClaim(ctx, 't', 'code', 'glm');

  const { resolveTopicArgs } = await import('../../src/trivium/topic-args.js');
  /*
   * 显式给 `--critics`：缺省集合含 glm，而「当轮 Driver 不得入选」排在本步校验之前，
   * 不避开它这条用例会红在一个与次序无关的前置上——测的就不是它要测的东西了。
   */
  const err = await resolveTopicArgs({
    ctx,
    scope: 'code',
    rawArgs: ['看这一处', '--topic', 't', '--driver', 'glm', '--critics', 'codex,gemini'],
  }).then(() => null, (e: Error) => e);

  assert.notEqual(err, null, '留痕与声明打架时必须拒绝启动');
  assert.match(String(err?.message), /没有合法来源/, '要说清是留痕本身不自洽');
  assert.doesNotMatch(
    String(err?.message), /与 code 阶段的运行留痕不符/,
    '不得把「基准坏了」报成「你传错了」——两条指向不同的修法',
  );
});

/*
 * ── 接线盯防点（计划 §2.4 末行）──
 *
 * 前面那些用例**在接线缺失时照样是绿的**：它们自己构造入参去调判定函数，
 * 根本走不到「真实入口有没有调它」这一跳。这是本仓反复栽过的缺口形态
 * （`driver-wiring.test.ts` 的头注释记着同族的三次），判据只能是扫源码。
 *
 * 剥注释与字符串用共享的词法器——裸子串会被我自己写在注释里的
 * 「共用 driver-claim.crossCheckDriver」骗倒，那正是它被打穿的第 1 版形态。
 */
test('接线：两个选侧入口都要调校验，且不变量在交叉校验之前', async () => {
  const { stripNonCode } = await import('../helpers/strip-non-code.js');
  const { REPO_ROOT } = await import('../helpers/fixture.js');

  for (const rel of ['src/trivium/topic-args.ts', 'src/trivium/cli.ts']) {
    const src = stripNonCode(await fs.readFile(path.join(REPO_ROOT, rel), 'utf8'));

    const inv = src.indexOf('stageDriverInvariant({');
    const cross = src.indexOf('crossCheckDriver({');
    assert.notEqual(inv, -1, `${rel} 没有调用 stageDriverInvariant——判定有了，入口没接`);
    assert.notEqual(cross, -1, `${rel} 没有调用 crossCheckDriver——判定有了，入口没接`);
    /*
     * 次序判据落在源码上，因为 `review --start` 那一侧没有便宜的运行期构造：
     * 顺序反了会把「基准坏了」报成「你传错了」，两条指向不同的修法。
     */
    assert.ok(inv < cross, `${rel} 里不变量必须排在交叉校验之前，否则会用一个坏基准去判对错`);
  }
});

test('declaredStageDriver：缺字段即未声明', () => {
  const t = emptyTask('t');
  assert.equal(declaredStageDriver(t, 'plan'), null);
  t.drivers = { plan: { driver: 'glm', claimed_at: 'T', claimed_by: 's' } };
  assert.equal(declaredStageDriver(t, 'plan'), 'glm');
  assert.equal(declaredStageDriver(t, 'code'), null, '按阶段取值，不跨阶段渗透');
});
