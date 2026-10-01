/**
 * 第 4 段与第 8 段的交集校验 · 调用链（EV-02，必读交集校验计划 r2 §3.2）。
 *
 * 真实打包 CLI 子进程 + 桩适配器（零配额）。两类格子：
 * - C：`--context` 撞上禁读集 ⇒ 退 64、零工件（`--start` 与同步 `review --stage` 两条入口都拦），
 *   写法（绝对路径、`./`、`..`）与方向（落在其中、罩住它）都算；具名放行照常列；
 * - A：自动条目（建议核实、公约、关键词）撞上 ⇒ 只从撞上的那几侧第 4 段剔除、不拒跑，
 *   告警经三个出口到达：`--start` 的 `warnings`、同步路径（人读 stderr 与 `--json`）、run.json `gate.warnings`
 *   （`gate --check` 回灌为 `run_warning`）。
 * 纯函数一层的矩阵在 `test/unit/mustread-deny.test.ts`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { bundleMissing, bundleSkipReason, cli, listFiles, makeFixture, today, type Fixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';
import type { StubConfig } from '../../src/trivium/adapters/stub.js';

const skip = bundleMissing && bundleSkipReason;
const STUB: StubConfig = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };

/** 一份 glm 侧的审查件：front-matter 带 review schema，对 gemini 侧是禁读（对端审查件），对 glm 侧是己方历史 */
async function writeGlmReview(abs: string, topic: string): Promise<void> {
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(
    abs,
    ['---', 'schema: trivium.review.v1', `topic: ${topic}`, 'stage: plan', 'role: glm', 'verdict: approve', '---', '', '# 审查', ''].join('\n'),
  );
}

/** `.reviews/` 与运行根前后逐字节一致、`.trivium/` 下除锁以外不变（闸门状态文件没被碰） */
async function snapshotTrace(fx: Fixture): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [label, dir] of [['archive', fx.archiveRoot], ['runs', `${fx.root}-runs`], ['trivium', path.join(fx.root, '.trivium')]] as const) {
    for (const f of await listFiles(dir)) {
      if (label === 'trivium' && f.startsWith('lock/')) continue;
      out[`${label}:${f}`] = await fs.readFile(path.join(dir, f), 'utf8');
    }
  }
  return out;
}

async function expectRejected(fx: Fixture, args: string[], what: string) {
  const before = await snapshotTrace(fx);
  const r = await cli(fx.root, args, STUB);
  assert.equal(r.code, EXIT.USAGE, `${what} 应退 64，实际 ${r.code}：\n${r.stdout}\n${r.stderr}`);
  assert.deepEqual(await snapshotTrace(fx), before, `${what}：拒跑必须零工件（归档、运行根、闸门状态一概不动）`);
  const locks = (await listFiles(path.join(fx.root, '.trivium'))).filter((f) => f.startsWith('lock/'));
  assert.deepEqual(locks, [], `${what}：主题锁不得残留`);
  return r;
}

const startArgs = (topic: string, ...extra: string[]) =>
  ['review', '--start', '--stage', 'plan', '--topic', topic, '--focus', 'x', ...extra];

type StartJson = { run_id: string; warnings: { name: string; detail: string }[] };

/** `--start --json` 成功后把运行等到终态（别让 worker 留在后台），返回解析后的 JSON */
async function startAndFinish(fx: Fixture, topic: string, ...extra: string[]): Promise<StartJson> {
  const r = await cli(fx.root, [...startArgs(topic, ...extra), '--json'], STUB);
  assert.equal(r.code, EXIT.OK, `--start 失败：\n${r.stdout}\n${r.stderr}`);
  const js = JSON.parse(extractJsonCandidate(r.stdout)!.json) as StartJson;
  let code: number = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    code = (await cli(fx.root, ['review', '--wait', js.run_id, '--timeout', '20'], STUB)).code ?? EXIT.FAIL;
  }
  assert.equal(code, EXIT.OK, `运行 ${js.run_id} 没有成功收尾（退 ${code}）`);
  return js;
}

/** 读某一侧落盘的任务书，切出第 4 段与第 8 段 */
async function briefSections(stageDir: string, critic: string, runId: string): Promise<{ s4: string; s8: string }> {
  const text = await fs.readFile(path.join(stageDir, '_meta', `brief-${critic}-${runId}.md`), 'utf8');
  const s4 = text.slice(text.indexOf('## 4. '), text.indexOf('## 5. '));
  const s8 = text.slice(text.indexOf('## 8. '));
  assert.ok(s4.length > 0 && s8.length > 0, '任务书段落结构变了');
  return { s4, s8 };
}

const bullet = (p: string): string => `- \`${p}\``;

// ─────────────── C：--context 撞上禁读集 ⇒ 拒跑、零工件 ───────────────

const CTX_TOPIC = '必读交集';

test('C1 · --context 指向对端审查件 ⇒ 退 64、零工件，只点名把它当禁读的那一侧', { skip }, async () => {
  const fx = await makeFixture({ topic: CTX_TOPIC });
  const rel = `.reviews/${CTX_TOPIC}/plan/${today()}-${CTX_TOPIC}-glm.md`;
  await writeGlmReview(path.join(fx.root, rel), CTX_TOPIC);
  const r = await expectRejected(fx, startArgs(CTX_TOPIC, '--context', rel), 'C1');
  assert.match(r.stderr, /--context 里有路径落在本轮的禁读集里/);
  assert.ok(r.stderr.includes(`「${rel}」`), r.stderr);
  assert.ok(r.stderr.includes('对端审查件，读了该侧作废 · 涉及 gemini 侧'), r.stderr);
  assert.ok(!r.stderr.includes('glm 侧'), 'glm 侧读自己的审查件不是禁读，不该被点名');
  assert.match(r.stderr, /出口：从 --context 里去掉这些路径/);
});

test('C4 · 同一路径写成绝对路径、./ 与 .. 形态都拦（判原始写法，不判必读清单的产物）', { skip }, async () => {
  const fx = await makeFixture({ topic: CTX_TOPIC });
  const rel = `.reviews/${CTX_TOPIC}/plan/${today()}-${CTX_TOPIC}-glm.md`;
  await writeGlmReview(path.join(fx.root, rel), CTX_TOPIC);
  // 绝对路径在必读清单里会被静默丢掉（EV-185）——校验不能依赖那份产物
  for (const form of [path.join(fx.root, rel), `./${rel}`, `src/../${rel}`]) {
    const r = await expectRejected(fx, startArgs(CTX_TOPIC, '--context', form), `C4「${form}」`);
    assert.ok(r.stderr.includes(`「${form}」`), `按用户的写法点名：\n${r.stderr}`);
  }
});

test('C2 · --context 指向凭据类文件（只记一笔类）⇒ 同样退 64，两侧都点名；同步 review --stage 也拦', { skip }, async () => {
  const fx = await makeFixture({ topic: CTX_TOPIC });
  const r = await expectRejected(fx, startArgs(CTX_TOPIC, '--context', '.env'), 'C2 --start');
  assert.ok(r.stderr.includes('凭据类文件，读了记一条告警 · 涉及 gemini、glm 侧'), r.stderr);
  const sync = await expectRejected(
    fx,
    ['review', '--stage', 'plan', '--topic', CTX_TOPIC, '--focus', 'x', '--context', 'src/a.ts,.env'],
    'C2 同步路径',
  );
  assert.ok(sync.stderr.includes('「.env」'), sync.stderr);
  assert.ok(!sync.stderr.includes('「src/a.ts」'), '没撞上的条目不列');
});

test('C3 · --context 是罩住禁读条目的目录（项目根）⇒ 退 64，按「含禁读条目」逐条点名', { skip }, async () => {
  const fx = await makeFixture({ topic: CTX_TOPIC });
  const r = await expectRejected(fx, startArgs(CTX_TOPIC, '--context', '.'), 'C3');
  assert.ok(r.stderr.includes('含禁读条目「.env」 · 凭据类文件'), r.stderr);
  assert.ok(r.stderr.includes('含禁读条目「.trivium」 · 编排器状态目录'), r.stderr);
  // 具名放行的项目配置不在罩住的条目里
  assert.ok(!r.stderr.includes('config.yaml'), r.stderr);
});

test('C5 · --context 指向具名放行的项目配置 ⇒ 照常启动，第 4 段列出它，warnings 为空', { skip }, async () => {
  const fx = await makeFixture({ topic: CTX_TOPIC });
  const js = await startAndFinish(fx, CTX_TOPIC, '--context', '.trivium/config.yaml');
  assert.deepEqual(js.warnings, []);
  for (const critic of ['gemini', 'glm']) {
    const { s4 } = await briefSections(fx.stageDir, critic, js.run_id);
    assert.ok(s4.includes(bullet('.trivium/config.yaml')), `${critic} 侧第 4 段应列出它：\n${s4}`);
  }
});

// ─────────────── A：自动条目撞上 ⇒ 按侧剔除 + 告警，不拒跑 ───────────────

/**
 * 建议核实撞上对端审查件的唯一现实形态：归档根配到 `doc/` 下、主题名是 ASCII（抽路径的正则不收汉字），
 * 被审原稿正文提到了对端审查件的路径（计划 r2 §1.5）。
 */
async function suggestedFixture(topic: string): Promise<{ fx: Fixture; stageDir: string; peer: string }> {
  const fx = await makeFixture({ topic, draft: false });
  await fs.appendFile(path.join(fx.root, '.trivium/config.yaml'), 'archive_root: doc/reviews\n');
  const stageDir = path.join(fx.root, 'doc/reviews', topic, 'plan');
  const peer = `doc/reviews/${topic}/plan/${today()}-${topic}-glm.md`;
  await writeGlmReview(path.join(fx.root, peer), topic);
  await fs.writeFile(
    path.join(stageDir, `${today()}-${topic}-claude.md`),
    `# 待审计划\n\n参考 ${peer} 与 src/a.ts。\n`,
  );
  return { fx, stageDir, peer };
}

test('A1 · 建议核实撞上对端审查件 ⇒ 只从 gemini 侧第 4 段剔除；warnings、run.json 与 gate --check 都有这一笔', { skip }, async () => {
  const topic = 'mrd-sugg';
  const { fx, stageDir, peer } = await suggestedFixture(topic);
  const js = await startAndFinish(fx, topic);

  assert.equal(js.warnings.length, 1, JSON.stringify(js.warnings));
  const [w] = js.warnings;
  assert.equal(w!.name, '必读清单剔除');
  assert.ok(w!.detail.startsWith('⚠️ '), w!.detail);
  assert.ok(w!.detail.includes(`「${peer}」（来源：建议核实）落在 gemini 侧的禁读集里`), w!.detail);
  assert.ok(w!.detail.includes('glm 侧照常列出'), w!.detail);

  const gem = await briefSections(stageDir, 'gemini', js.run_id);
  assert.ok(!gem.s4.includes(peer), `gemini 侧第 4 段不该再有它：\n${gem.s4}`);
  assert.ok(gem.s8.includes(bullet(peer)), 'gemini 侧第 8 段仍禁读它');
  assert.ok(gem.s4.includes(bullet('src/a.ts')), '没撞上的建议核实照常列出');
  const glm = await briefSections(stageDir, 'glm', js.run_id);
  assert.ok(glm.s4.includes(bullet(peer)), `glm 侧读自己的审查件不是禁读，第 4 段照常列出：\n${glm.s4}`);
  assert.ok(!glm.s8.includes(peer), 'glm 侧第 8 段本就没有它');

  // run.json 留痕：去掉 ⚠️ 前缀的同一句（计划双审 r1 CODEX-01）
  const meta = JSON.parse(await fs.readFile(path.join(stageDir, '_meta', `run-${js.run_id}.json`), 'utf8')) as {
    gate: { warnings?: string[] };
  };
  const plain = w!.detail.slice('⚠️ '.length);
  assert.deepEqual(meta.gate.warnings?.filter((x) => x.includes('必读') || x.includes('第 4 段')), [plain]);
  const g = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', topic, '--check', '--json'], null);
  const gj = JSON.parse(extractJsonCandidate(g.stdout)!.json) as { warnings: { code: string; message: string }[] };
  assert.ok(gj.warnings.some((x) => x.code === 'run_warning' && x.message === plain), JSON.stringify(gj.warnings));
});

test('A2 · 公约文档被 sensitive_globs 罩住 ⇒ 两侧都剔、8.2 列出，告警写「各侧」', { skip }, async () => {
  const topic = 'mrd-conv';
  const fx = await makeFixture({
    topic,
    extraReview: ['sensitive_globs:', "  - '.env*'", '  - AGENTS.md'],
  });
  await fs.writeFile(path.join(fx.root, 'AGENTS.md'), '# 公约\n');
  const js = await startAndFinish(fx, topic);
  assert.equal(js.warnings.length, 1, JSON.stringify(js.warnings));
  const d = js.warnings[0]!.detail;
  assert.ok(d.includes('「AGENTS.md」（来源：项目公约与文档入口）落在各侧的禁读集里'), d);
  assert.ok(d.includes('凭据类文件，读了记一条告警'), d);
  assert.ok(!d.includes('照常列出'), d);
  for (const critic of ['gemini', 'glm']) {
    const { s4, s8 } = await briefSections(fx.stageDir, critic, js.run_id);
    assert.ok(!s4.includes('AGENTS.md'), `${critic} 侧第 4 段不该有它：\n${s4}`);
    assert.ok(s4.includes(bullet('README.md')), '其余公约文档照常列出');
    assert.ok(s8.slice(s8.indexOf('### 8.2')).includes(bullet('AGENTS.md')), `${critic} 侧 8.2 列出它`);
  }
});

test('A3 · 关键词匹配到的设计文档被 sensitive_globs 罩住 ⇒ 剔除并告警（来源：与主题相关的需求与设计文档）', { skip }, async () => {
  const topic = 'mrd-widget';
  const fx = await makeFixture({
    topic,
    extraReview: ['sensitive_globs:', "  - '.env*'", "  - 'doc/02_design/*-secret.md'"],
  });
  await fs.mkdir(path.join(fx.root, 'doc/02_design'), { recursive: true });
  await fs.writeFile(path.join(fx.root, 'doc/02_design/widget-secret.md'), '# x\n');
  await fs.writeFile(path.join(fx.root, 'doc/02_design/widget-api.md'), '# y\n');
  const js = await startAndFinish(fx, topic);
  assert.equal(js.warnings.length, 1, JSON.stringify(js.warnings));
  assert.ok(js.warnings[0]!.detail.includes('「doc/02_design/widget-secret.md」（来源：与主题相关的需求与设计文档）'), js.warnings[0]!.detail);
  const { s4 } = await briefSections(fx.stageDir, 'gemini', js.run_id);
  assert.ok(!s4.includes('widget-secret.md'), s4);
  assert.ok(s4.includes(bullet('doc/02_design/widget-api.md')), '同批匹配到的其它文档照常列出');
});

test('A5 · 纯文档跳过轮（代码双审 CODEX-03 / GLM-01）：不播报（finished_inline 的 warnings 为 []），run.json 的 gate.warnings 仍记剔除', { skip }, async () => {
  const topic = 'mrd-skip';
  const fx = await makeFixture({ topic, draft: false, extraReview: ['skip_doc_only_review: true'] });
  await fs.appendFile(path.join(fx.root, '.trivium/config.yaml'), 'archive_root: doc/reviews\n');
  const peer = `doc/reviews/${topic}/plan/${today()}-${topic}-glm.md`;
  await writeGlmReview(path.join(fx.root, peer), topic);
  // 纯文档变更（README），正文提到对端审查件——它进「建议核实」，对 gemini 侧是禁读
  await fs.writeFile(path.join(fx.root, 'README.md'), `# 夹具\n\n参考 ${peer}。\n`);
  const r = await cli(fx.root, ['review', '--start', '--stage', 'code', '--topic', topic, '--focus', 'x', '--json'], STUB);
  assert.equal(r.code, EXIT.OK, `${r.stdout}\n${r.stderr}`);
  const js = JSON.parse(extractJsonCandidate(r.stdout)!.json) as { run_id: string; finished_inline?: boolean; warnings: unknown[] };
  assert.equal(js.finished_inline, true, '前提：这一轮是纯文档跳过');
  assert.deepEqual(js.warnings, [], '跳过轮不播报（没有审查员被拉起）');
  const codeDir = path.join(fx.root, 'doc/reviews', topic, 'code');
  const meta = JSON.parse(await fs.readFile(path.join(codeDir, '_meta', `run-${js.run_id}.json`), 'utf8')) as {
    skipped?: boolean; gate: { warnings?: string[] };
  };
  assert.equal(meta.skipped, true);
  const hits = (meta.gate.warnings ?? []).filter((w) => w.includes('（来源：建议核实）'));
  assert.equal(hits.length, 1, `跳过轮也要留这一笔：${JSON.stringify(meta.gate.warnings)}`);
  assert.ok(hits[0]!.includes(`「${peer}」`) && hits[0]!.includes('gemini 侧'), hits[0]);
  // 留痕对得上：落盘的 gemini 侧任务书第 4 段确实没有它
  const { s4 } = await briefSections(codeDir, 'gemini', js.run_id);
  assert.ok(!s4.includes(peer), s4);
});

test('A6 · 剔除超过 5 条（代码双审 CODEX-06）：--start 的 warnings 封顶 5 条（末条是汇总），run.json 存全量', { skip }, async () => {
  const topic = 'mrd-many';
  const fx = await makeFixture({ topic, draft: false });
  await fs.appendFile(path.join(fx.root, '.trivium/config.yaml'), 'archive_root: doc/reviews\n');
  const stageDir = path.join(fx.root, 'doc/reviews', topic, 'plan');
  const peers = ['', '-r2', '-r3', '-r4', '-r5', '-r6'].map((r) => `doc/reviews/${topic}/plan/${today()}-${topic}${r}-glm.md`);
  for (const p of peers) await writeGlmReview(path.join(fx.root, p), topic);
  await fs.writeFile(path.join(stageDir, `${today()}-${topic}-claude.md`), `# 待审计划\n\n${peers.map((p) => `参考 ${p}。`).join('\n')}\n`);
  const js = await startAndFinish(fx, topic);
  assert.equal(js.warnings.length, 5, JSON.stringify(js.warnings));
  assert.ok(js.warnings.slice(0, 4).every((w) => w.detail.includes('（来源：建议核实）')), JSON.stringify(js.warnings));
  assert.ok(js.warnings[4]!.detail.includes('另有 2 条'), js.warnings[4]!.detail);
  const meta = JSON.parse(await fs.readFile(path.join(stageDir, '_meta', `run-${js.run_id}.json`), 'utf8')) as {
    gate: { warnings?: string[] };
  };
  const pruned = (meta.gate.warnings ?? []).filter((w) => w.includes('（来源：建议核实）'));
  assert.equal(pruned.length, 6, `run.json 存全量：${JSON.stringify(meta.gate.warnings)}`);
  for (const p of peers) assert.ok(pruned.some((w) => w.includes(`「${p}」`)), p);
});

test('A4 · 同步 review --stage：人读模式 stderr 打出剔除告警（只一个 ⚠️），--json 的 warnings 含同一句', { skip }, async () => {
  const human = await suggestedFixture('mrd-sync');
  const r = await cli(human.fx.root, ['review', '--stage', 'plan', '--topic', 'mrd-sync', '--focus', 'x'], STUB);
  assert.equal(r.code, EXIT.OK, `${r.stdout}\n${r.stderr}`);
  const line = r.stderr.split('\n').find((l) => l.includes('（来源：建议核实）'));
  assert.ok(line, `人读模式要打出来：\n${r.stderr}`);
  assert.equal((line!.match(/⚠️/g) ?? []).length, 1, `warn() 自带一个 ⚠️，正文不能再带：${line}`);

  const js = await suggestedFixture('mrd-syncj');
  const rj = await cli(js.fx.root, ['review', '--stage', 'plan', '--topic', 'mrd-syncj', '--focus', 'x', '--json'], STUB);
  assert.equal(rj.code, EXIT.OK, `${rj.stdout}\n${rj.stderr}`);
  const out = JSON.parse(extractJsonCandidate(rj.stdout)!.json) as { warnings: string[] };
  const hit = out.warnings.filter((x) => x.includes('（来源：建议核实）'));
  assert.equal(hit.length, 1, JSON.stringify(out.warnings));
  assert.ok(!hit[0]!.startsWith('⚠️'), '字符串通道不带前缀');
});
