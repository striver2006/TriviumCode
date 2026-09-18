/**
 * 禁读矩阵（计划 §3.1 / D-3）。
 *
 * 这里守的是一条**只在 Driver 任意化之后才会激活**的隔离破洞：
 * 后缀标识产出方、不携带产出角色，因此「deny = 全部后缀 − {自身, driver}」
 * 会把「上一轮某 Agent 当审核者写下的审查意见」误判成「本轮 Driver 的原稿」
 * 而整体放行。跨轮角色翻转用例（下面第一个）就是那条破洞的回归锚点。
 *
 * 另一侧同样重要：**不能误伤**。deny 集合与 `checkPeerLeak` 的核验集合同源，
 * 一旦把被审对象原稿错误地放进去，审核者正常读取即触发 peer_leak、
 * 该侧作废重跑——代价不是「少读一份」，是「读了就作废」。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { enumerateDenyPaths, freeze } from '../../src/trivium/freeze.js';
import { checkPeerLeak } from '../../src/trivium/adapters/base.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { REPO_ROOT } from '../helpers/fixture.js';

/** 一份合格的审查件：front-matter 带 review schema，这是角色判定的主判据 */
function reviewDoc(role: string): string {
  return [
    '---',
    'schema: trivium.review.v1',
    'topic: 某主题',
    'stage: plan',
    `role: ${role}`,
    'verdict: request-changes',
    '---',
    '',
    '# 计划审查',
    '',
    '### 意见一条',
  ].join('\n');
}

/** 一份 Driver 原稿：人写的 Markdown，没有 review/disposition schema */
function draftDoc(): string {
  return ['# 实施计划', '', '## 1. 背景', '正文若干。'].join('\n');
}

/** 一份裁决件 */
function dispositionDoc(role: string): string {
  return [
    '---',
    'schema: trivium.disposition.v1',
    'topic: 某主题',
    'stage: plan',
    `role: ${role}`,
    'kind: revised',
    '---',
    '',
    '# 计划修订',
  ].join('\n');
}

interface Fixture {
  root: string;
  archiveRoot: string;
  cleanup: () => Promise<void>;
}

async function makeFixture(files: Record<string, string>): Promise<Fixture> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-deny-'));
  const archiveRoot = path.join(root, '.reviews');
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(archiveRoot, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
  }
  return { root, archiveRoot, cleanup: () => fs.rm(root, { recursive: true, force: true }) };
}

const deny = (f: Fixture, critic: 'gemini' | 'glm', driver: 'claude' | 'codex' | 'gemini' | 'glm') =>
  enumerateDenyPaths(defaultConfig(), f.root, f.archiveRoot, critic, driver);

// ───────────────── 1. D-3 的回归锚点：跨轮角色翻转 ─────────────────

test('跨轮角色翻转：上轮当审核者的 claude 审查件必须禁读，本轮 claude 原稿不禁', async () => {
  /*
   * 第 1 轮：Driver = ZCode，审核者 = {claude, gemini} → 产出 `-claude.md`（审查意见）
   * 第 2 轮：Driver = Claude Code                      → 产出 `-claude.md`（原稿）
   *
   * 两份文件后缀相同，仅 front-matter 可区分。按后缀差集判，
   * 第 2 轮的 driver 后缀是 claude，两份都放行——第 1 轮那份审查意见就泄漏了。
   */
  const f = await makeFixture({
    '某主题/plan/2026-09-12-某主题-claude.md': reviewDoc('claude'), // 上轮：审查件
    '某主题/plan/2026-09-13-某主题-claude.md': draftDoc(), // 本轮：原稿
  });
  try {
    const paths = await deny(f, 'gemini', 'claude');

    assert.ok(
      paths.some((p) => p.endsWith('2026-09-12-某主题-claude.md')),
      '上一轮 claude 作为审核者写下的审查意见没有进 deny 集合——这正是 D-3 要修的破洞',
    );
    assert.ok(
      !paths.some((p) => p.endsWith('2026-09-13-某主题-claude.md')),
      '本轮 Driver 原稿被误禁：审核者读被审对象会触发 peer_leak 作废重跑',
    );
  } finally {
    await f.cleanup();
  }
});

// ───────────────── 2. 不误伤：合法输入必须放行 ─────────────────

test('负例：审核者读当轮原稿不触发禁读', async () => {
  const f = await makeFixture({
    '某主题/plan/2026-09-13-某主题-claude.md': draftDoc(),
  });
  try {
    for (const critic of ['gemini', 'glm'] as const) {
      const paths = await deny(f, critic, 'claude');
      assert.deepEqual(
        paths.filter((p) => p.includes('某主题-claude.md')),
        [],
        `${critic} 侧误禁了被审对象原稿`,
      );
    }
  } finally {
    await f.cleanup();
  }
});

test('负例：Driver 裁决件是审查员的合法上下文，不禁', async () => {
  const f = await makeFixture({
    '某主题/plan/2026-09-13-某主题-revised-claude.md': dispositionDoc('claude'),
  });
  try {
    const paths = await deny(f, 'gemini', 'claude');
    assert.deepEqual(paths.filter((p) => p.includes('revised')), []);
  } finally {
    await f.cleanup();
  }
});

test('负例：己方历史审查产出不禁（审查员要看自己上轮说过什么）', async () => {
  const f = await makeFixture({
    '某主题/plan/2026-09-12-某主题-gemini.md': reviewDoc('gemini'),
  });
  try {
    const paths = await deny(f, 'gemini', 'claude');
    assert.deepEqual(paths.filter((p) => p.includes('gemini.md')), [], '己方产出被误禁');
  } finally {
    await f.cleanup();
  }
});

// ───────────────── 3. 正例：他人意见的全部载体 ─────────────────

test('正例：他方审查件的 .md 正文进 deny 集合', async () => {
  const f = await makeFixture({
    '某主题/plan/2026-09-13-某主题-glm.md': reviewDoc('glm'),
  });
  try {
    const paths = await deny(f, 'gemini', 'claude');
    assert.ok(paths.some((p) => p.endsWith('2026-09-13-某主题-glm.md')));
  } finally {
    await f.cleanup();
  }
});

test('正例：_meta 下的结构化意见原文同样进 deny 集合（措施 a 的缺口修补）', async () => {
  /*
   * 重构前只枚举 `*-<对方>.md`，`_meta/review-<对方>-<runId>.json` 不在机器集合里：
   * 提示语禁了一堆、核验只对其中一部分。用 Read 读它不会命中 peer_leak——
   * 而它装的是同一批意见的原文。
   */
  const f = await makeFixture({
    '某主题/plan/_meta/review-glm-20260913T000000Z.json': '{"findings":[]}',
    '某主题/plan/_meta/review-gemini-20260913T000000Z.json': '{"findings":[]}',
  });
  try {
    const paths = await deny(f, 'gemini', 'claude');
    assert.ok(
      paths.some((p) => p.endsWith('review-glm-20260913T000000Z.json')),
      '对方的结构化意见原文没有进 deny 集合',
    );
    assert.ok(
      !paths.some((p) => p.endsWith('review-gemini-20260913T000000Z.json')),
      '己方的结构化结论被误禁',
    );
  } finally {
    await f.cleanup();
  }
});

test('正例：编排器状态目录 .trivium 进 deny 集合', async () => {
  const f = await makeFixture({ '某主题/plan/2026-09-13-某主题-claude.md': draftDoc() });
  try {
    const paths = await deny(f, 'gemini', 'claude');
    assert.ok(paths.includes('.trivium'), '.trivium 没有进禁读清单');
  } finally {
    await f.cleanup();
  }
});

// ───────────────── 4. fail-closed 只用在判不出的情形 ─────────────────

test('fail-closed：顶着审核者后缀却无可辨识 schema 的文件，判不出就禁', async () => {
  const f = await makeFixture({
    '某主题/plan/2026-09-13-某主题-glm.md': '没有 front-matter 的裸文本',
  });
  try {
    const paths = await deny(f, 'gemini', 'claude');
    assert.ok(
      paths.some((p) => p.endsWith('2026-09-13-某主题-glm.md')),
      '判不出角色的对方后缀文件应当保守禁读',
    );
  } finally {
    await f.cleanup();
  }
});

test('fail-closed 不外扩：无 schema 且后缀等于 driver 的，按原稿放行', async () => {
  /*
   * v1 历史主题的 task.json 没有 driver 字段，但「v1 时代 Driver 恒为 claude」
   * 是由 schema 版本可判的确定事实，不是不确定情形——不得对这类主题
   * 一律 fail-closed，那会把全部历史原稿与裁决件推进 deny 集。
   */
  const f = await makeFixture({
    '旧主题/plan/2026-08-01-旧主题-claude.md': draftDoc(),
    '旧主题/plan/2026-08-01-旧主题-revised-claude.md': dispositionDoc('claude'),
  });
  try {
    const paths = await deny(f, 'glm', 'claude');
    assert.deepEqual(
      paths.filter((p) => p.includes('旧主题')),
      [],
      'v1 历史主题的原稿与裁决件被 fail-closed 误伤',
    );
  } finally {
    await f.cleanup();
  }
});

// ───────────────── 5. Driver 换家后的对称性 ─────────────────

// ───────────── 6. 调用链：deny 矩阵必须在 freeze() 入口上真的生效 ─────────────

test('调用链：freeze() 透传 driver，非 Claude Driver 的原稿不被误禁', async () => {
  /*
   * 代码审查 AGY-01（blocker）的回归锚点。
   *
   * 上面所有用例都直接调 `enumerateDenyPaths`，而真实流水线走的是 `freeze()`。
   * 曾经 `FreezeInput` 没有 `driver` 字段、`freeze()` 只传 4 个参数——函数签名
   * 改对了，调用链却是断的，10 条用例全绿也照样发现不了。
   * **测试要覆盖调用链，不只是函数。**
   */
  const f = await makeFixture({
    '某主题/plan/2026-09-13-某主题-glm.md': draftDoc(), // ZCode 当 Driver 的原稿
    '某主题/plan/2026-09-12-某主题-claude.md': reviewDoc('claude'), // Claude 当审核者
  });
  try {
    // freeze 要算 tree_hash，需要真实 git 仓库
    execFileSync('git', ['init', '-q'], { cwd: f.root });
    const subjectPath = path.join(f.archiveRoot, '某主题/plan/2026-09-13-某主题-glm.md');
    const snap = await freeze({
      cfg: defaultConfig(),
      projectRoot: f.root,
      archiveRoot: f.archiveRoot,
      stage: 'plan',
      critic: 'gemini',
      topic: '某主题',
      driver: 'glm',
      subjectPath,
    });

    assert.ok(
      !snap.denyPaths.some((p) => p.endsWith('2026-09-13-某主题-glm.md')),
      'freeze() 没把 driver 透传给 enumerateDenyPaths：被审原稿进了禁读集，'
        + '审核者读它即 peer_leak 作废重跑',
    );
    assert.ok(
      snap.denyPaths.some((p) => p.endsWith('2026-09-12-某主题-claude.md')),
      'freeze() 入口上他方审查意见没被屏蔽',
    );
  } finally {
    await f.cleanup();
  }
});

// ───────────── 7. 目录条目必须在 checkPeerLeak 上真的命中 ─────────────

test('目录条目：读 .trivium 内文件会被 checkPeerLeak 命中', async () => {
  /*
   * 代码审查 GLM-03 的回归锚点。
   *
   * `checkPeerLeak` 曾是纯 `Set.has()` 精确匹配，`.trivium` 这个目录条目
   * 永远等不到 `.trivium/state.json`——BRIEF 承诺「读到即作废」，机器核验
   * 效力却是零。这正是措施 a 要关闭的那类错位，不能在修它的同一次改动里
   * 又造一个。
   */
  const f = await makeFixture({ '某主题/plan/2026-09-13-某主题-claude.md': draftDoc() });
  try {
    const denyPaths = await deny(f, 'gemini', 'claude');
    assert.ok(denyPaths.includes('.trivium'), '前置条件：.trivium 应在禁读清单里');

    const hit = checkPeerLeak([path.join(f.root, '.trivium/state.json')], denyPaths, f.root);
    assert.equal(hit.leaked, true, '读 .trivium 子树内的文件没有命中禁读核验');

    // 同前缀的兄弟目录不得误伤
    const sibling = checkPeerLeak([path.join(f.root, '.trivium-backup/x.json')], denyPaths, f.root);
    assert.equal(sibling.leaked, false, '.trivium-backup 被 .trivium 前缀误伤');
  } finally {
    await f.cleanup();
  }
});

// ───────────── 8. 伪造的裁决件中缀不得成为绕过通道 ─────────────

test('伪造名：审核者后缀 + 裁决件中缀的文件仍被禁', async () => {
  /*
   * 代码审查 GLM-04 的回归锚点。
   *
   * `classifyArtifact` 曾在 `kind !== null` 时直接判 own-or-driver 而不看后缀，
   * 于是 `…-revised-gemini.md` 在读文件之前就被放行——它以 `-gemini.md` 结尾，
   * 重构前是禁的，deny 集合反而收窄了。文件名零成本可伪造，把他人意见原文
   * 改个中缀就绕过整套 front-matter 判定。
   */
  const f = await makeFixture({
    '某主题/plan/2026-09-13-某主题-revised-glm.md': reviewDoc('glm'),
  });
  try {
    const paths = await deny(f, 'gemini', 'claude');
    assert.ok(
      paths.some((p) => p.endsWith('2026-09-13-某主题-revised-glm.md')),
      '审核者后缀带裁决件中缀的文件被放行——裁决件本就只能是 Driver 后缀，'
        + '这种自相矛盾的名字禁掉不构成误伤',
    );
  } finally {
    await f.cleanup();
  }
});

test('Driver 换成 ZCode 时：glm 原稿放行，claude 审查件对 gemini 仍禁', async () => {
  const f = await makeFixture({
    '某主题/plan/2026-09-13-某主题-glm.md': draftDoc(), // ZCode 当 Driver 的原稿
    '某主题/plan/2026-09-13-某主题-claude.md': reviewDoc('claude'), // Claude 当审核者
  });
  try {
    const paths = await deny(f, 'gemini', 'glm');
    assert.ok(
      !paths.some((p) => p.endsWith('某主题-glm.md')),
      'ZCode 作为 Driver 的原稿被误禁',
    );
    assert.ok(
      paths.some((p) => p.endsWith('某主题-claude.md')),
      'Claude 作为审核者的意见没被屏蔽',
    );
  } finally {
    await f.cleanup();
  }
});

test('调用链：freeze() 的真实调用点必须传 topic（不只是函数支持它）', async () => {
  /*
   * ## 为什么这条用例扫的是**源码**而不是调用函数
   *
   * `FreezeInput.topic` 的注释写着「不给就退回全归档扫描——只为兼容尚未传参的
   * 旧调用，新代码一律传」，而 `review.ts` 那个**唯一**调用点一直没传。
   * 于是主题剪枝在真实流水线上**从未生效**：本主题 code 阶段实测禁读集 270 条，
   * 只有 4 条属于本主题（代码双审 r1 CODEX-01）。
   *
   * **这是同一个错误的第二次**：`FreezeInput.driver` 的注释记着第一次——
   * `enumerateDenyPaths` 加了 driver 参数，唯一调用入口没跟着加。
   *
   * 那次的对策**确实落成了用例**（上方「调用链：freeze() 透传 driver」那条），
   * 而它**仍然没拦住这一次**——原因值得记下来：**那条用例覆盖的是
   * 「`freeze` → `enumerateDenyPaths`」这一段，它自己调 `freeze({… topic: '某主题' …})`
   * 时把 topic 传了**，于是更上游的「`review.ts` → `freeze`」那一段照样是断的。
   *
   * 所以「测试要覆盖调用链」这条对策本身有边界：**它覆盖的是你想到的那一段**。
   * 本条补的是最上游那一段，判据因此只能是**扫真实调用点的源码**——
   * 任何「自己构造入参去调 freeze」的用例，在这个缺口上都必然是绿的。
   */
  // 用 REPO_ROOT 而不是 import.meta.url 的 pathname：后者是百分号编码的 URL 片段，
  // 仓库路径含空格或非 ASCII 时会解析失败（代码双审 r1 CODEX-09 在准入脚本里点过同一个坑）
  const src = await fs.readFile(path.join(REPO_ROOT, 'src/trivium/review.ts'), 'utf8');
  const calls = [...src.matchAll(/await freeze\(\{/g)];
  assert.equal(calls.length, 1, `review.ts 里应当只有一处 freeze() 调用，实得 ${calls.length} 处——多出来的那处也要单独核`);

  // 取该调用的实参块（到配对的 `});` 为止，按缩进定位足够稳）
  const start = calls[0]!.index!;
  const end = src.indexOf('\n    });', start);
  assert.ok(end > start, '定位不到 freeze() 实参块的结尾——扫描写错了会让本条永绿');
  const argBlock = src.slice(start, end);

  /*
   * **判据是「值表达式在场」，不是「键在场」**（代码双审 r2 CODEX-09）。
   *
   * 上一版判的是子串 `topic:`，于是 `topic: undefined`（或传一个可为 undefined
   * 的变量）**照样绿**——而它的失效后果恰恰就是剪枝再次静默失效，
   * 正是这条用例要守的那一格。
   */
  for (const key of ['topic: ref.topic', 'stage', 'critic']) {
    assert.ok(
      argBlock.includes(key),
      `freeze() 的实参块里没有 ${key}——` +
        (key.startsWith('topic')
          ? '主题剪枝会退回全归档扫描，禁读集放大一个数量级且误伤面敞开。' +
            '注意本条要的是**值表达式**：只写 `topic:` 而值是 undefined 同样不行'
          : '该字段是必需的'),
    );
  }
});
