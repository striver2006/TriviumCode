/**
 * `topic claim` 的端到端契约（M10a 第 1 步，EV-72）。
 *
 * ## 为什么要走真实子进程
 *
 * 分支判定本身在 `test/unit/driver-claim.test.ts` 已经逐格测过，而且那些用例
 * **自己构造入参**——CLI 把哪几个值取错了、落盘落没落、退出码翻译对不对，
 * 它们一概看不见。本文件只管这一跳：取值 → 判定 → 落盘 → 退出码。
 *
 * ## 零配额
 *
 * `topic claim` 不拉起任何适配器，全部用例都是纯本地文件操作。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, makeFixture, today } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { TaskMeta } from '../../src/trivium/meta.js';

const TOPIC = '按阶段认领';

async function readTaskJson(root: string): Promise<TaskMeta> {
  const raw = await fs.readFile(path.join(root, '.reviews', TOPIC, 'task.json'), 'utf8');
  return JSON.parse(raw) as TaskMeta;
}

/**
 * 从报错文案里抠出那条 `trivium topic claim …` 出口命令的 argv。
 *
 * 按**子串**定位而不是「整行以 trivium 开头」：文案里它可能带前缀
 * （`改声明：trivium topic claim …`）。判据要盯的是命令本身能不能跑，
 * 不是它被排版成什么样——用行首匹配会让一个纯排版差异伪装成「文案里没有出口」。
 */
function claimCommandArgv(stderr: string): string[] | null {
  for (const raw of stderr.split('\n')) {
    const at = raw.indexOf('trivium topic claim');
    if (at < 0) continue;
    return raw.slice(at).trim().split(/\s+/).slice(1); // 去掉 `trivium` 这个程序名
  }
  return null;
}

function parseJson(stdout: string): Record<string, unknown> {
  const c = extractJsonCandidate(stdout);
  assert.notEqual(c, null, '--json 必须产出可解析的 JSON');
  return JSON.parse(c!.json) as Record<string, unknown>;
}

test(
  '首次认领：落盘 drivers[<阶段>]，--json 形状齐备',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC });
    const r = await cli(root, [
      'topic', 'claim', '--topic', TOPIC, '--stage', 'code', '--driver', 'glm',
      '--session-id', 'sess-1', '--json',
    ]);
    assert.equal(r.code, EXIT.OK, r.stderr);

    const j = parseJson(r.stdout);
    assert.equal(j['outcome'], 'claimed');
    assert.equal(j['stage'], 'code');
    assert.equal(j['driver'], 'glm');
    assert.equal(j['claimed_by'], 'sess-1');
    assert.equal(j['history_len'], 0);

    const task = await readTaskJson(root);
    assert.equal(task.drivers?.code?.driver, 'glm');
    assert.equal(task.drivers?.code?.claimed_by, 'sess-1', 'claimed_by 要真落盘，不只是回显');
    assert.equal(task.schema, 'trivium.task.v1', 'additive 字段不得改 schema 版本');
    // 认领 code 不得污染别的阶段
    assert.equal(task.drivers?.plan, undefined);
  },
);

test(
  '幂等：同值再认领退 0，且 claimed_at 不被刷新',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC });
    const a = await cli(root, [
      'topic', 'claim', '--topic', TOPIC, '--stage', 'code', '--driver', 'glm',
      '--session-id', 'sess-1', '--json',
    ]);
    assert.equal(a.code, EXIT.OK);
    const first = (await readTaskJson(root)).drivers?.code?.claimed_at;

    const b = await cli(root, [
      'topic', 'claim', '--topic', TOPIC, '--stage', 'code', '--driver', 'glm',
      '--session-id', 'sess-2', '--json',
    ]);
    assert.equal(b.code, EXIT.OK);
    assert.equal(parseJson(b.stdout)['outcome'], 'noop');

    const task = await readTaskJson(root);
    assert.equal(
      task.drivers?.code?.claimed_at, first,
      '幂等档不写盘——照写会让「什么时候认领的」随每次重跑往后漂',
    );
    assert.equal(
      task.drivers?.code?.claimed_by, 'sess-1',
      '幂等不得把认领人改成后来那个会话',
    );
  },
);

test(
  '--stage 必填：缺它退 64，不默认到 plan',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC });
    const r = await cli(root, ['topic', 'claim', '--topic', TOPIC, '--driver', 'glm']);
    assert.equal(r.code, EXIT.USAGE, '声明直接决定保护集，认哪一道必须说清');
    assert.match(r.stderr, /--stage/);
    // 没有落盘副作用
    await assert.rejects(() => readTaskJson(root));
  },
);

test(
  '--driver 必填且须是已登记 Agent',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC });
    const a = await cli(root, ['topic', 'claim', '--topic', TOPIC, '--stage', 'code']);
    assert.equal(a.code, EXIT.USAGE);
    assert.match(a.stderr, /--driver/);

    const b = await cli(root, [
      'topic', 'claim', '--topic', TOPIC, '--stage', 'code', '--driver', 'zcode',
    ]);
    assert.equal(b.code, EXIT.USAGE, 'zcode 是 cliName 不是 AgentId');
    assert.match(b.stderr, /已登记/, '报错要列出可用取值');
  },
);

test(
  '撤回：零留痕且未用过 ⇒ 改写成功，旧声明进 history',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC });
    await cli(root, [
      'topic', 'claim', '--topic', TOPIC, '--stage', 'code', '--driver', 'glm',
      '--session-id', 'sess-1',
    ]);
    const r = await cli(root, [
      'topic', 'claim', '--topic', TOPIC, '--stage', 'code', '--driver', 'codex',
      '--session-id', 'sess-2', '--json',
    ]);
    assert.equal(r.code, EXIT.OK, r.stderr);
    const j = parseJson(r.stdout);
    assert.equal(j['outcome'], 'revoked');
    assert.equal(j['revoked'], 'glm');
    assert.equal(j['history_len'], 1);

    const task = await readTaskJson(root);
    assert.equal(task.drivers?.code?.driver, 'codex');
    assert.equal(task.drivers?.code?.history?.[0]?.driver, 'glm');
    assert.equal(task.drivers?.code?.history?.[0]?.claimed_by, 'sess-1');
    assert.ok(task.drivers?.code?.history?.[0]?.revoked_at, '撤回时刻要落盘');
  },
);

test(
  '撤回权因「声明已被使用」而消失：退 64 且文案列出那些文件',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC, draft: false });
    await cli(root, [
      'topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'glm',
    ]);

    // 用掉这个声明：写一份带 glm 后缀的原稿
    const stageDir = path.join(root, '.reviews', TOPIC, 'plan');
    await fs.mkdir(stageDir, { recursive: true });
    const orphan = `${today()}-${TOPIC}-glm.md`;
    await fs.writeFile(path.join(stageDir, orphan), '# 原稿\n', 'utf8');

    const r = await cli(root, [
      'topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'claude',
    ]);
    assert.equal(r.code, EXIT.USAGE);
    assert.match(r.stderr, /已被使用/);
    assert.match(r.stderr, new RegExp(orphan.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      '要点名是哪些文件挡住了撤回，否则用户不知道该清理什么');
    assert.match(r.stderr, /终端/, '出口必须写明——会话内删不掉是刻意的');

    // 声明没被改动
    assert.equal((await readTaskJson(root)).drivers?.plan?.driver, 'glm');
  },
);

test(
  '留痕优先：该阶段已有运行留痕时，异声明退 64',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC });
    /*
     * 造一份 plan 阶段的 run 留痕。这里直接摆文件而不跑一轮真双审——
     * 本用例要证的是「claim 读不读得到留痕」，跑真双审只会多烧一次配额。
     */
    const metaDir = path.join(root, '.reviews', TOPIC, 'plan', '_meta');
    await fs.mkdir(metaDir, { recursive: true });
    const { newRunMeta } = await import('../../src/trivium/meta.js');
    await fs.writeFile(
      path.join(metaDir, 'run-R1.json'),
      JSON.stringify(newRunMeta({
        runId: 'R1', topic: TOPIC, stage: 'plan', rerunIndex: 1, command: 'x',
        promptHint: null, taskGoal: null, criticsSelected: ['gemini', 'glm'],
        treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's',
        denyPaths: [], driftPolicy: 'warn', driver: 'claude',
      })),
      'utf8',
    );

    const r = await cli(root, [
      'topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'glm',
    ]);
    assert.equal(r.code, EXIT.USAGE);
    assert.match(r.stderr, /已由 claude 执笔/);
    assert.match(r.stderr, /新开主题/, '出口要给全：留痕不可改，只能换主题或换阶段');

    // 同值认领仍可通过（分支 1 只拒绝与留痕**不同**的那一档）
    const ok = await cli(root, [
      'topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'claude',
    ]);
    assert.equal(ok.code, EXIT.OK, ok.stderr);
  },
);

test(
  '交叉校验：review --start 的 --driver 与声明不符时拒绝启动',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    // draft:false ⇒ 认领时该阶段还没有任何带后缀的文件（分支 4 的前提）
    const { root } = await makeFixture({ topic: TOPIC, draft: false });
    const c = await cli(root, [
      'topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'glm',
    ]);
    assert.equal(c.code, EXIT.OK, c.stderr);

    /*
     * **必须在冻结送审包之前拒**：判错身份的那一轮跑完才发现，代价是整轮作废。
     * 断言零工件就是这条的落点。
     */
    const r = await cli(root, [
      'review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', TOPIC,
      '--focus', '看边界', '--driver', 'codex', '--critics', 'gemini,glm',
    ]);
    assert.equal(r.code, EXIT.USAGE, r.stdout);
    assert.match(r.stderr, /声明不符/);

    const metaDir = path.join(root, '.reviews', TOPIC, 'plan', '_meta');
    const left = await fs.readdir(metaDir).catch(() => [] as string[]);
    assert.deepEqual(left, [], '拒绝发生在冻结之前，不得留下半个送审包');

    /*
     * **出口同样要真跑一遍**，不做子串匹配——上一版这里写的是
     * `assert.match(stderr, /topic claim --stage plan --driver codex/)`，
     * 而那个子串在**缺必填主题旗标**的错误命令里同样成立，判据零鉴别力
     * （代码双审 r1 CODEX-02）。
     */
    const argv = claimCommandArgv(r.stderr);
    assert.ok(argv, `报错里应当有一条出口命令，实得：\n${r.stderr}`);
    const rerun = await cli(root, argv!);
    assert.equal(
      rerun.code, EXIT.OK,
      `报错教的命令自己跑不通（退 ${rerun.code}）：\n  ${argv!.join(' ')}\n  ${rerun.stderr}`,
    );
  },
);

/*
 * ══════════════════════════════════════════════════════════════
 * **报错教的命令必须真能跑**（代码双审 r1 CODEX-02）
 * ══════════════════════════════════════════════════════════════
 *
 * 上一版两处文案手写 `topic claim --stage X --driver Y`，**漏了必填的 --topic**，
 * 用户照抄第一次就退 64——正是本计划 §3.2.2 整节在处理的失效形态。
 *
 * 而当时配的判据是 `assert.match(stderr, /topic claim --stage code --driver claude/)`：
 * 那个子串在**缺 --topic 的错误命令里同样存在**，于是判据零鉴别力，
 * 反倒把错文案钉成了期望值。
 *
 * 所以这条用例不匹配子串，而是**把文案里的命令原样抠出来跑一遍**。
 * 判据是它的退出码，不是它长什么样。
 */
test(
  '不变量的出口命令：从报错里抠出来原样执行，必须退 0',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    /*
     * `draft: false`：夹具默认会落一份 `-claude.md` 原稿，而分支 4 现在会因为
     * 「该阶段已有他家后缀的文件」拒绝首次认领——那是刻意的（代码双审 r1 GLM-05），
     * 所以构造顺序必须是「先认领、后落文件」。
     */
    const { root } = await makeFixture({ topic: TOPIC, draft: false });
    // 造出「留痕说 claude、声明说 glm」这个非法态：声明先落，再直接摆一份留痕
    const c = await cli(root, [
      'topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'glm',
    ]);
    assert.equal(c.code, EXIT.OK, c.stderr);
    const metaDir = path.join(root, '.reviews', TOPIC, 'plan', '_meta');
    await fs.mkdir(metaDir, { recursive: true });
    const { newRunMeta } = await import('../../src/trivium/meta.js');
    await fs.writeFile(
      path.join(metaDir, 'run-R1.json'),
      JSON.stringify(newRunMeta({
        runId: 'R1', topic: TOPIC, stage: 'plan', rerunIndex: 1, command: 'x',
        promptHint: null, taskGoal: null, criticsSelected: ['gemini', 'glm'],
        treeHash: 'h', gitHead: null, dirty: false, subjectSha256: 's',
        denyPaths: [], driftPolicy: 'warn', driver: 'claude',
      })),
      'utf8',
    );

    /*
     * 用 `topic resolve` 而不是 `review --start` 来触发这个非法态：前者**纯只读、零配额**，
     * 而后者过了校验就会真的去拉适配器。本用例要测的是文案与出口，不该顺带烧一次配额。
     * 不变量在两个入口是同一处判定，所以在这里测同样成立。
     */
    const broken = await cli(root, [
      'topic', 'resolve', '--stage', 'plan', '--', '看边界', '--topic', TOPIC,
    ]);
    assert.equal(broken.code, EXIT.USAGE, broken.stdout);
    assert.match(broken.stderr, /没有合法来源/);

    // ── 把文案里那条命令抠出来，原样执行 ──
    const argv = claimCommandArgv(broken.stderr);
    assert.ok(argv, `报错里应当有一条出口命令，实得：\n${broken.stderr}`);
    const rerun = await cli(root, argv!);
    assert.equal(
      rerun.code, EXIT.OK,
      `报错教的命令自己跑不通（退 ${rerun.code}）：\n  ${argv!.join(' ')}\n  ${rerun.stderr}`,
    );

    // 跑完之后那个非法态真的消失了——**出口要把状态修好，不能只是自己不报错**
    await fs.writeFile(
      path.join(root, '.reviews', TOPIC, 'plan', `${today()}-${TOPIC}-claude.md`),
      '# 原稿\n', 'utf8',
    );
    const after = await cli(root, [
      'topic', 'resolve', '--stage', 'plan', '--', '看边界', '--topic', TOPIC,
    ]);
    assert.equal(after.code, EXIT.OK, after.stderr);
    assert.doesNotMatch(after.stderr, /没有合法来源/);
  },
);

/*
 * **省略 --driver = 继承该阶段的权威值**（代码双审 r1 CODEX-01）。
 *
 * 上一版把「没传」当成「传了缺省值」，于是非缺省 Driver 的主题上每一次省略该旗标的
 * 运行都退 64——而文案还建议「去掉 --driver」，照做第二次仍被拒。
 */
test(
  '省略 --driver：按该阶段的声明继承，不退 64',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC, draft: false });
    // 先认领、后落原稿：分支 4 会拒绝「该阶段已有他家后缀文件」时的首次认领
    const c = await cli(root, [
      'topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'glm',
    ]);
    assert.equal(c.code, EXIT.OK, c.stderr);
    await fs.mkdir(path.join(root, '.reviews', TOPIC, 'plan'), { recursive: true });
    await fs.writeFile(
      path.join(root, '.reviews', TOPIC, 'plan', `${today()}-${TOPIC}-glm.md`),
      '# glm 的原稿\n', 'utf8',
    );

    const r = await cli(root, [
      'topic', 'resolve', '--stage', 'plan', '--json', '--',
      '看边界', '--topic', TOPIC, '--critics', 'codex,gemini',
    ]);
    assert.equal(r.code, EXIT.OK, r.stderr);
    const j = parseJson(r.stdout);
    assert.equal(j['driver'], 'glm', '声明为 glm 时，省略旗标应当继承它而不是回落缺省值');
    assert.match(
      JSON.stringify(j['notes']), /已继承/,
      '继承是静默改变身份，必须在 notes 里说出来',
    );
  },
);

/*
 * **未归一化的主题会让校验读错目录**（代码双审 r1 GLM-04）。
 *
 * `validateTopic` 会把内部空白折成 `-`。claim 落盘走归一化，而上一版 `review --start`
 * 的校验块直接用原始旗标值组 layout：声明落在 `M10-任意`、校验读 `M10 任意`，
 * 目录不存在 ⇒ 零留痕零声明 ⇒ **静默通过**。
 */
test(
  '带空格的主题名：声明与校验落在同一个归一化目录',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC, draft: false });
    const spaced = '带 空格 主题';
    const normalized = '带-空格-主题';

    const c = await cli(root, [
      'topic', 'claim', '--topic', spaced, '--stage', 'plan', '--driver', 'glm',
    ]);
    assert.equal(c.code, EXIT.OK, c.stderr);
    const raw = await fs.readFile(
      path.join(root, '.reviews', normalized, 'task.json'), 'utf8',
    );
    assert.equal((JSON.parse(raw) as TaskMeta).drivers?.plan?.driver, 'glm');

    // 校验若读未归一化的名字，这里会因「查不到声明」而静默放行
    const r = await cli(root, [
      'review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', spaced,
      '--focus', '看边界', '--driver', 'codex', '--critics', 'gemini,glm',
    ]);
    assert.equal(r.code, EXIT.USAGE, r.stdout);
    assert.match(r.stderr, /声明不符/, '归一化之后才查得到那份声明');
  },
);

/*
 * **留痕损坏在入口处硬失败，不降级到声明**（代码双审 r1 CODEX-03 ≡ GLM-01）。
 *
 * 上一版三个消费点都写 `latest.meta?.driver ?? null`，把 `unreadable` 丢掉，
 * 于是「留痕坏了」在 Hook 侧硬失败、在会写下新一份留痕的入口处却降级到自声明。
 */
test(
  '留痕损坏：入口与 Hook 同口径硬失败，不用声明顶上',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC, draft: false });
    await cli(root, ['topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'glm']);
    const metaDir = path.join(root, '.reviews', TOPIC, 'plan', '_meta');
    await fs.mkdir(metaDir, { recursive: true });
    await fs.writeFile(path.join(metaDir, 'run-RBAD.json'), '{ broken', 'utf8');

    for (const argv of [
      ['review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', TOPIC,
        '--focus', '看边界', '--critics', 'gemini,glm'],
      ['topic', 'resolve', '--stage', 'plan', '--', '看边界', '--topic', TOPIC],
      ['topic', 'claim', '--topic', TOPIC, '--stage', 'plan', '--driver', 'codex'],
    ]) {
      const r = await cli(root, argv);
      assert.notEqual(r.code, EXIT.OK, `${argv[0]} ${argv[1]} 在留痕损坏时不得照常继续`);
      assert.match(r.stderr, /读不出来/, `${argv[0]} ${argv[1]} 要点名是留痕坏了`);
    }
  },
);

test(
  'topic 只认 resolve / claim 两个子命令',
  { skip: bundleMissing && bundleSkipReason },
  async () => {
    const { root } = await makeFixture({ topic: TOPIC });
    const r = await cli(root, ['topic', 'bogus', '--topic', TOPIC]);
    assert.equal(r.code, EXIT.USAGE);
    assert.match(r.stderr, /resolve \/ claim/);
  },
);
