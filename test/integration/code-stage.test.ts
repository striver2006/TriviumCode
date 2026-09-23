import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, listFiles, makeFixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { RunMeta } from '../../src/trivium/types.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';

/**
 * `code` 阶段走真实打包 CLI（设计 §6.4 / §9.2 / §8.2 S6）。
 *
 * 与 plan 的关键差别：被审对象不是现成文件，而是一段变更，必须先物化成
 * `code/_meta/changes.diff`。因此这些用例必须真的动工作树、真的让 git 产出 diff。
 */

const TOPIC = '代码审';
const STUB: StubConfig = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };

async function codeFixture() {
  const fx = await makeFixture({ topic: TOPIC, draft: false });
  const codeDir = path.join(fx.archiveRoot, TOPIC, 'code');
  return { ...fx, codeDir };
}

/** 跑完 --start → --wait，返回 run.json */
async function runCode(
  root: string,
  codeDir: string,
  extra: string[] = [],
  stub: StubConfig = STUB,
): Promise<{ exitCode: number; meta: RunMeta; out: string }> {
  const started = await cli(
    root,
    ['review', '--start', '--stage', 'code', '--topic', TOPIC, '--focus', '看变更', '--json', ...extra],
    stub,
  );
  assert.equal(started.code, EXIT.OK, `--start 失败：\n${started.stdout}\n${started.stderr}`);
  const cand = extractJsonCandidate(started.stdout);
  assert.ok(cand, `无可解析 JSON：\n${started.stdout}`);
  const js = JSON.parse(cand.json) as { run_id: string; finished_inline?: boolean };

  let exitCode: number = EXIT.STILL_RUNNING;
  let out = started.stdout;
  for (let i = 0; i < 12 && exitCode === EXIT.STILL_RUNNING; i++) {
    const w = await cli(root, ['review', '--wait', js.run_id, '--timeout', '20'], stub, 60_000);
    exitCode = w.code ?? EXIT.FAIL;
    out += w.stdout + w.stderr;
  }
  const meta = JSON.parse(
    await fs.readFile(path.join(codeDir, '_meta', `run-${js.run_id}.json`), 'utf8'),
  ) as RunMeta;
  return { exitCode, meta, out };
}

test('审查期间被审代码被改 → subject_drift，整次作废（设计 §9.2 第 2 步）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/app.ts'), 'export const x = 2;\n');
  /*
   * 原先跑后复算读的是冻结的 changes-<run_id>.diff 本身，与冻结值恒等，
   * 这条护栏在 code 阶段从未触发过；run.json 照样写 drift: false。
   * 桩在「审查期间」真的改动了被审文件，被审对象（相对 base 的变更）已经不是送审的那份。
   */
  const { exitCode, meta } = await runCode(
    fx.root, fx.codeDir, [],
    { gemini: { mode: 'mutate_file', note: 'src/app.ts' }, glm: { mode: 'ok' } },
  );
  assert.notEqual(exitCode, EXIT.OK, '被审对象漂移必须让整次运行失败');
  assert.equal(meta.status, 'failed');
  assert.equal(meta.snapshot.drift.changed, true, 'run.json 不得再写 drift: false');
  assert.equal(meta.gate.state, 'failed');
});

test('审查期间无关文件被改：code 阶段的被审对象是整段工作树变更，同样判 subject_drift', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/app.ts'), 'export const x = 2;\n');
  // 新建一个与 diff 无关的文件：git diff HEAD 含未跟踪文件，补丁正文随之变化
  const { exitCode, meta } = await runCode(
    fx.root, fx.codeDir, [],
    { gemini: { mode: 'mutate_file', note: 'src/unrelated.ts' }, glm: { mode: 'ok' } },
  );
  assert.notEqual(exitCode, EXIT.OK);
  assert.equal(meta.status, 'failed');
  assert.equal(meta.snapshot.drift.changed, true);
});

test('.env 等敏感文件的改动不进被审补丁（M17）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/app.ts'), 'export const x = 2;\n');
  // 夹具的 .env 未被 .gitignore 覆盖：原先会整篇进补丁，经被审对象本身送到两家厂商
  await fs.writeFile(path.join(fx.root, '.env'), 'DB_PASSWORD=Tr0ub4dor\n');
  const { exitCode, meta } = await runCode(fx.root, fx.codeDir);
  assert.equal(exitCode, EXIT.OK);
  const diffEntry = meta.artifacts.find((a) => /changes-.+\.diff$/.test(a.path));
  assert.ok(diffEntry);
  const diff = await fs.readFile(path.join(fx.archiveRoot, diffEntry!.path), 'utf8');
  assert.match(diff, /src\/app\.ts/);
  assert.doesNotMatch(diff, /Tr0ub4dor/, '.env 的内容进了补丁');
  assert.doesNotMatch(diff, /\.env/);
});

test('run.json 记下发起命令 --entry', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/app.ts'), 'export const x = 2;\n');
  const { exitCode, meta } = await runCode(fx.root, fx.codeDir, ['--entry', 'C']);
  assert.equal(exitCode, EXIT.OK);
  assert.equal(meta.entry, 'C', 'run.json 应记下发起命令，供事后追溯这轮是谁发起的');
});

test('无待审变更 → 退 65 且零工件', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  const before = await listFiles(fx.archiveRoot);

  const r = await cli(
    fx.root,
    ['review', '--start', '--stage', 'code', '--topic', TOPIC, '--focus', 'x'],
    STUB,
  );
  assert.equal(r.code, EXIT.MISSING_ARTIFACT, `应退 65：\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /没有待审变更/);
  assert.deepEqual(await listFiles(fx.archiveRoot), before, '失败出口不得留半套工件');
});

test('有变更 → 冻结 changes.diff，其 sha256 即 subject_sha256', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 999;\n', 'utf8');

  const { exitCode, meta } = await runCode(fx.root, fx.codeDir);
  assert.equal(exitCode, EXIT.OK, '双审应成功');

  const diffPath = path.join(fx.codeDir, '_meta', 'changes.diff');
  const diff = await fs.readFile(diffPath, 'utf8');
  assert.match(diff, /# trivium changes\.diff/);
  assert.match(diff, /# base: HEAD/);
  assert.match(diff, /#   src\/a\.ts/);
  assert.match(diff, /\+export const a = 999;/);

  const { createHash } = await import('node:crypto');
  const sha = createHash('sha256').update(diff).digest('hex');
  assert.equal(meta.snapshot.subject_sha256, sha, 'subject_sha256 必须是补丁全文的 sha256');
});

test('code 轮不新增原稿登记：补丁只在骨架期登记一次（M10a 第 2 步 EV-55 §3.1.1 硬约束 1，代码双审 r2 GLM-02 (b)）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 7;\n', 'utf8');

  const { exitCode, meta } = await runCode(fx.root, fx.codeDir);
  assert.equal(exitCode, EXIT.OK, '双审应成功');
  assert.equal(meta.status, 'success');

  /*
   * 收尾的原稿登记块被 `stage !== 'code'` 挡住。去掉这道门控时，code 阶段的被审对象
   * （补丁）会被再登记一次——要么是同一份 `changes-<run_id>.diff` 的重复条目，
   * 要么是每轮覆盖写的便利副本 `changes.diff`（登记了就再也改不动）。两种都在这里红。
   */
  const diffEntries = meta.artifacts.filter((a) => a.path.endsWith(`changes-${meta.run_id}.diff`));
  assert.equal(diffEntries.length, 1, `补丁应只登记一次：${JSON.stringify(meta.artifacts)}`);
  assert.equal(
    meta.artifacts.some((a) => a.path.endsWith('/_meta/changes.diff') || a.path.endsWith(`${path.sep}_meta${path.sep}changes.diff`)),
    false,
    `便利副本 changes.diff 不得进 artifacts[]：${JSON.stringify(meta.artifacts)}`,
  );
});

test('两侧拿到同一份补丁——逐侧各自 git diff 会让两侧审到不同东西', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 1;\nexport const z = 2;\n', 'utf8');

  const { meta } = await runCode(fx.root, fx.codeDir);
  const briefs = (await fs.readdir(path.join(fx.codeDir, '_meta'))).filter((f) => f.startsWith('brief-'));
  assert.equal(briefs.length, 2);

  // 两份 brief 引用的被审对象 sha256 必须一致
  const shas = new Set<string>();
  for (const b of briefs) {
    const text = await fs.readFile(path.join(fx.codeDir, '_meta', b), 'utf8');
    const m = /([0-9a-f]{64})/.exec(text);
    assert.ok(m, `brief ${b} 里没有 sha256`);
    shas.add(m[1]!);
  }
  assert.equal(shas.size, 1, `两侧 brief 的被审对象 sha256 不一致：${[...shas].join(' / ')}`);
  assert.ok(shas.has(meta.snapshot.subject_sha256));
});

test('--base 指定基线', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 2;\n', 'utf8');

  const { meta, out } = await runCode(fx.root, fx.codeDir, ['--base', 'HEAD']);
  assert.equal(meta.status, 'success', out);
  const diff = await fs.readFile(path.join(fx.codeDir, '_meta', 'changes.diff'), 'utf8');
  assert.match(diff, /# base: HEAD/);
});

test('未跟踪的新文件也进补丁', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/新增.ts'), 'export const n = 1;\n', 'utf8');

  await runCode(fx.root, fx.codeDir);
  const diff = await fs.readFile(path.join(fx.codeDir, '_meta', 'changes.diff'), 'utf8');
  assert.match(diff, /新增\.ts/, '未跟踪文件必须纳入，否则新增代码完全逃过审查');
});

test('纯文档变更 + 开关打开 → 跳过，不派生 worker、不产审查文档', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({
    topic: TOPIC, draft: false,
    extraReview: ['skip_doc_only_review: true'],
  });
  const codeDir = path.join(fx.archiveRoot, TOPIC, 'code');
  await fs.writeFile(path.join(fx.root, 'README.md'), '# 只改了文档\n', 'utf8');

  const r = await cli(
    fx.root,
    ['review', '--start', '--stage', 'code', '--topic', TOPIC, '--focus', 'x', '--json'],
    STUB,
  );
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  const js = JSON.parse(extractJsonCandidate(r.stdout)!.json) as {
    run_id: string; finished_inline?: boolean; skipped?: boolean; max_waits?: number;
  };
  /*
   * 关键断言：必须在同步窗口内收口。若这里还要 --wait，说明派生了 worker——
   * 而 worker 自己 rebuildContext、拿不到跳过判定，会照样跑完整双审，
   * 判定形同失效且白烧两侧配额。
   */
  assert.equal(js.finished_inline, true, '跳过必须在派生前收口');
  assert.equal(js.max_waits, 0, 'skill 不该再进 --wait 循环');

  const docs = await fs.readdir(codeDir);
  assert.ok(
    !docs.some((f) => f.endsWith('-gemini.md') || f.endsWith('-glm.md')),
    `跳过时不得生成任何审查文档，实际：${docs.join(', ')}`,
  );

  const meta = JSON.parse(
    await fs.readFile(path.join(codeDir, '_meta', `run-${js.run_id}.json`), 'utf8'),
  ) as RunMeta;
  assert.equal(meta.skipped, true);
  assert.ok(meta.skip_reason, '必须写明命中的规则');
  assert.match(meta.skip_reason!, /skip_globs/);
});

test('纯文档但开关关闭 → 照常送审', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture(); // 默认 skip_doc_only_review: false
  await fs.writeFile(path.join(fx.root, 'README.md'), '# 只改了文档\n', 'utf8');

  const { exitCode, meta } = await runCode(fx.root, fx.codeDir);
  assert.equal(exitCode, EXIT.OK);
  assert.notEqual(meta.skipped, true, 'FR-23 是 P2，默认关闭');
  const docs = await fs.readdir(fx.codeDir);
  assert.ok(docs.some((f) => f.endsWith('-gemini.md')), `应照常产出审查文档：${docs.join(', ')}`);
});

test('文档里掺一个源码文件 → 不跳过', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await makeFixture({
    topic: TOPIC, draft: false,
    extraReview: ['skip_doc_only_review: true'],
  });
  const codeDir = path.join(fx.archiveRoot, TOPIC, 'code');
  await fs.writeFile(path.join(fx.root, 'README.md'), '# 文档\n', 'utf8');
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 3;\n', 'utf8');

  const { exitCode, meta } = await runCode(fx.root, codeDir);
  assert.equal(exitCode, EXIT.OK);
  assert.notEqual(meta.skipped, true, '掺了源码就必须审');
});

test('未提交的对方审查产出不得进补丁（经被审对象泄漏）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 7;\n', 'utf8');

  /*
   * 摆一份「刚落盘还没 commit」的对方审查产出——这正是常态：
   * archive 写完文件，Driver 还没提交，此时就跑 code 审。
   * 未跟踪文件本来会被 `git ls-files --others` 收进补丁，
   * 于是对方结论经**被审对象本身**递到审查员手里，三道屏蔽全部绕过。
   */
  const planDir = path.join(fx.archiveRoot, TOPIC, 'plan');
  await fs.mkdir(planDir, { recursive: true });
  const SENTINEL = '哨兵串-对方结论-不该出现在补丁里';
  await fs.writeFile(path.join(planDir, '2026-09-11-代码审-glm.md'), `# GLM 审查\n\n${SENTINEL}\n`, 'utf8');
  await fs.writeFile(path.join(fx.root, '.trivium', 'state.json'), '{"gates":{}}\n', 'utf8');

  await runCode(fx.root, fx.codeDir);
  const diff = await fs.readFile(path.join(fx.codeDir, '_meta', 'changes.diff'), 'utf8');

  assert.doesNotMatch(diff, new RegExp(SENTINEL), '对方审查产出绝不能出现在被审补丁里');
  assert.doesNotMatch(diff, /\.reviews\//, '归档根下的任何路径都不该进补丁');
  assert.doesNotMatch(diff, /\.trivium\//, '运行时状态不该进补丁');
  assert.match(diff, /src\/a\.ts/, '真正的代码变更仍须在内');
});

test('坏 --base → 在冻结前失败且零工件（审查意见 GLM-r2-04）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 5;\n', 'utf8');
  // 造一个未跟踪文件：它的 diff 会让 body 非空，正是旧实现的空判定失效之处
  await fs.writeFile(path.join(fx.root, 'src/未跟踪.ts'), 'export const u = 1;\n', 'utf8');

  const before = await listFiles(fx.archiveRoot);
  const r = await cli(
    fx.root,
    ['review', '--start', '--stage', 'code', '--topic', TOPIC, '--focus', 'x', '--base', '压根不存在的ref'],
    STUB,
  );

  /*
   * 旧实现吞掉 `git diff` 的非零退出：已跟踪变更全部消失，而未跟踪文件让 body
   * 非空，于是一份**缺失全部已跟踪变更**的残缺补丁带着错误的 base 照常送审，
   * 两侧「认真审完」的其实是一段不完整的变更。
   */
  assert.equal(r.code, EXIT.USAGE, `坏 base 应退 64：\n${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /压根不存在的ref/, '要回显用户给的原值');
  assert.deepEqual(await listFiles(fx.archiveRoot), before, '失败在冻结之前，不得留任何工件');
});

test('未跟踪文件的引号路径也进补丁', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/含 空格.ts'), 'export const s = 1;\n', 'utf8');

  const { meta } = await runCode(fx.root, fx.codeDir);
  assert.equal(meta.status, 'success');
  const diff = await fs.readFile(path.join(fx.codeDir, '_meta', 'changes.diff'), 'utf8');
  assert.match(diff, /含 空格\.ts/);
});

test('同主题连跑两次 code 审后仍能提交（审查意见 GLM-01，blocker）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const fx = await codeFixture();
  // 夹具里 src/a.ts 本来就是 `export const a = 1;`，必须写成不同的内容才有变更
  await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 111;\n', 'utf8');
  const run1 = await runCode(fx.root, fx.codeDir);
  assert.equal(run1.exitCode, EXIT.OK);

  const { run } = await import('../../src/trivium/util/exec.js');
  const hookEv = JSON.stringify({
    session_id: 'S', tool_name: 'Bash', tool_input: { command: ['git', 'commit', '-m', 'x'].join(' ') },
  });
  const { BUNDLE, ASSET_ROOT } = await import('../helpers/fixture.js');
  const preCommit = () =>
    run(process.execPath, [BUNDLE, 'gate', 'hook-pre-commit'], {
      cwd: fx.root,
      env: { TRIVIUM_ASSET_ROOT: ASSET_ROOT, TRIVIUM_STUB_CRITIC: undefined },
      stdin: hookEv, timeoutMs: 30_000,
    });

  const today2 = (await import('../helpers/fixture.js')).today();
  /** 补一轮裁决并通过闸门校验，让拦截原因只可能剩「留痕不完整」 */
  const adjudicate = async (runId: string, roundPrefix: string) => {
    await fs.writeFile(
      path.join(fx.codeDir, `${today2}-${TOPIC}-${roundPrefix}response-claude.md`),
      [
        '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: code',
        'role: claude', 'kind: response', `run_id: ${runId}`,
        'addresses:',
        `  - ${today2}-${TOPIC}-${roundPrefix}gemini.md`,
        `  - ${today2}-${TOPIC}-${roundPrefix}glm.md`,
        '---', '',
        '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |',
        '| :--- | :--- | :--- | :--- | :--- | :--- |',
        '| AGY-01 | gemini | blocker | 接受 | 桩数据 | 某处 |',
        '| GLM-01 | glm | blocker | 接受 | 桩数据 | 某处 |',
        '',
      ].join('\n'),
      'utf8',
    );
    const g = await cli(fx.root, ['gate', '--stage', 'code', '--topic', TOPIC, '--check']);
    assert.equal(g.code, EXIT.OK, `第 ${roundPrefix || 'r1'} 轮裁决应通过：\n${g.stdout}${g.stderr}`);
  };

  await adjudicate(run1.meta.run_id, '');
  assert.equal((await preCommit()).code, EXIT.OK, '第一轮之后应放行');

  // 第二轮：被审补丁若是固定文件名，这里会把第一轮的覆盖掉
  await fs.writeFile(path.join(fx.root, 'src/b.ts'), 'export const b = 2;\n', 'utf8');
  const run2 = await runCode(fx.root, fx.codeDir);
  assert.equal(run2.exitCode, EXIT.OK);
  await adjudicate(run2.meta.run_id, 'r2-');

  /*
   * 这是 GLM-01 的核心：第一轮 run.json 记录了被审补丁的 sha256。若补丁是固定
   * 文件名，第二轮一覆盖，第一轮的记录就**永远**对不上——hook 永久拦截且不可恢复
   * （原文件已被覆盖，谁也拿不回来）。护栏误伤正常工作，比不加护栏更糟。
   */
  const r = await preCommit();
  assert.equal(r.code, EXIT.OK, `第二轮之后不该被自己的护栏拦死：\n${r.stdout}${r.stderr}`);

  // 两轮的被审补丁各自独立留存
  const metas = await fs.readdir(path.join(fx.codeDir, '_meta'));
  const perRun = metas.filter((f) => /^changes-.+\.diff$/.test(f));
  assert.equal(perRun.length, 2, `每轮应各有一份补丁，实际：${metas.join(', ')}`);
  assert.ok(metas.includes('changes.diff'), '便利副本仍在（人读用，不进保护集）');
});

test('run.v2 逐侧段：没有覆盖尝试的侧（桩适配器）model_override_applied **缺席**，不是 null（代码双审 r1 codex 子项 05 ≡ AGY-03）', { skip: bundleMissing && bundleSkipReason }, async () => {
  /*
   * 字段缺席与 null 是两件事（EV-82 r1 AGY-03）：缺席＝本次没有覆盖尝试；null＝尝试了但没回读到生效模型。
   * review.ts 落 run.json 那处用条件展开而不是恒写，正是为了保住这个区分——此前零用例，去掉门恒写 null 全量照绿。
   */
  const fx = await codeFixture();
  // code 阶段的被审对象是 git diff：先造一处变更，否则 --start 退 65「没有待审变更」
  await fs.writeFile(path.join(fx.root, 'src/app.ts'), 'export const x = 3;\n');
  const { meta } = await runCode(fx.root, fx.codeDir);
  const sides = Object.entries(meta.critics ?? {});
  assert.ok(sides.length > 0, '至少要有一侧');
  for (const [side, entry] of sides) {
    assert.equal('model_override_applied' in (entry as object), false, `${side} 侧没有覆盖尝试，字段必须缺席`);
  }
});

test('run.v2 逐侧段：桩注入 model_override_applied=false → 该侧落盘 false、另一侧缺席、guard 播报「没有生效」（代码双审 r2 AGY-02）', { skip: bundleMissing && bundleSkipReason }, async () => {
  /*
   * r1 只锁了「桩侧缺席」这一半；true / false / null 经 review.ts 条件展开落盘、过 run.v2 校验、
   * 再被 guard 播报——这条链此前没有端到端用例，review.ts 那一行键名手误抓不到。
   */
  const fx = await codeFixture();
  await fs.writeFile(path.join(fx.root, 'src/app.ts'), 'export const x = 4;\n');
  const { meta, out } = await runCode(fx.root, fx.codeDir, [], {
    gemini: { mode: 'ok' },
    glm: { mode: 'ok', modelOverrideApplied: false },
  });
  const glm = meta.critics.glm as Record<string, unknown> | undefined;
  const gemini = meta.critics.gemini as Record<string, unknown> | undefined;
  assert.ok(glm && gemini, '两侧都要有');
  assert.equal(glm!['model_override_applied'], false, '注入的 false 必须原样落到 run.json（键名手误在这里现形）');
  assert.equal('model_override_applied' in gemini!, false, '没注入的一侧必须缺席，不是 null');
  // guard 的播报随 ReviewOutcome.warnings 进 status.json.message，`--wait --json` 的终态返回原样透出
  const w = await cli(fx.root, ['review', '--wait', meta.run_id, '--timeout', '5', '--json'], STUB, 60_000);
  const cand = extractJsonCandidate(w.stdout);
  assert.ok(cand, `终态查询无可解析 JSON：\n${w.stdout}\n${w.stderr}\n${out.slice(-300)}`);
  const terminal = JSON.parse(cand.json) as { message?: string | null };
  assert.ok(
    (terminal.message ?? '').includes('没有生效'),
    `guard 必须把「请求的模型没有生效」播报进终态 message，实得：${terminal.message ?? '(空)'}`,
  );
});
