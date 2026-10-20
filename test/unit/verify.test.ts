import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  assertVerifyConfigured,
  collectCommands,
  renderVerifyDoc,
  runVerify,
  summarizeVerify,
  tailLines,
  type VerifyRecord,
} from '../../src/trivium/verify.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { Ctx } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';

// 2026-10-20 解除 win32 整文件跳过（审查 CLAUDE-07 首批锚点）：本文件夹具本就跨平台
// （真命令 true/false/echo 经 Git for Windows 的 sh 执行、scratchDir 通用），实测全绿后留常驻——
// 它正是「verify 命令在 win32 经 sh 分发」这一本批改动面的直接锚点。macOS/Linux 行为零变化。
{

/**
 * 编译测试出口（设计 §14）。
 *
 * 这些用例跑的是真命令（`true` / `false` / `echo`），不是 mock：
 * 「只执行显式配置的命令」「非零退出不得宣称成功」两条都只有真执行才测得出来。
 */

async function ctxWith(build: string[], testCmds: string[]): Promise<Ctx> {
  const raw = await scratchDir('trivium-verify-');
  const root = await fs.realpath(raw);
  const cfg = defaultConfig();
  cfg.verify.build = build;
  cfg.verify.test = testCmds;
  return {
    config: cfg,
    projectRoot: root,
    archiveRoot: path.join(root, '.reviews'),
    triviumDir: path.join(root, '.trivium'),
    sources: ['<test>'],
  };
}

const layoutFor = (ctx: Ctx) => ({ archiveRoot: ctx.archiveRoot, topic: '出口主题' });

// ── 命令收集 ──

test('命令顺序为 build 先于 test', () => {
  const cfg = defaultConfig();
  cfg.verify.build = ['b1', 'b2'];
  cfg.verify.test = ['t1'];
  assert.deepEqual(collectCommands(cfg).map((c) => `${c.group}:${c.cmd}`), [
    'build:b1', 'build:b2', 'test:t1',
  ]);
});

test('--only 只取一组', () => {
  const cfg = defaultConfig();
  cfg.verify.build = ['b1'];
  cfg.verify.test = ['t1'];
  assert.deepEqual(collectCommands(cfg, 'test').map((c) => c.cmd), ['t1']);
  assert.deepEqual(collectCommands(cfg, 'build').map((c) => c.cmd), ['b1']);
});

test('未配置时命令集为空——绝不回退到猜测的默认命令', () => {
  // §14.1：探测到的候选只展示不执行。这里断言的是「空就是空」
  assert.deepEqual(collectCommands(defaultConfig()), []);
});

test('assertVerifyConfigured 在两组皆空时抛 64', () => {
  const cfg = defaultConfig();
  assert.throws(() => assertVerifyConfigured(cfg), /均未配置/);
  cfg.verify.test = ['npm test'];
  assert.doesNotThrow(() => assertVerifyConfigured(cfg));
});

// ── 真实执行 ──

test('全部通过 → success，退 0，两份记录落盘', async () => {
  const ctx = await ctxWith(['true'], ['echo hello']);
  const out = await runVerify({ ctx, layout: layoutFor(ctx), runId: 'R1' });

  assert.equal(out.record.status, 'success');
  assert.equal(out.exitCode, EXIT.OK);
  assert.equal(out.record.commands.length, 2);
  assert.match(out.record.commands[1]!.stdout_tail, /hello/);
  assert.ok((await fs.stat(out.artifactPath)).isFile());
  assert.ok((await fs.stat(out.metaPath)).isFile());
  assert.match(path.basename(out.artifactPath), /-出口主题-verify\.md$/);
});

test('任一命令非零 → failed，退 1，绝不宣称成功', async () => {
  const ctx = await ctxWith([], ['true', 'false', 'echo 不该跑到这里']);
  const out = await runVerify({ ctx, layout: layoutFor(ctx), runId: 'R2' });

  assert.equal(out.record.status, 'failed');
  assert.equal(out.exitCode, EXIT.FAIL);
  // test 组内失败不中断后续 test 命令——只有 build 失败才中断
  assert.equal(out.record.commands.length, 3);
  const doc = await fs.readFile(out.artifactPath, 'utf8');
  assert.match(doc, /❌ 失败/);
  assert.doesNotMatch(doc, /✅ 通过/);
});

test('build 失败即不跑 test——免得根因被连带失败埋掉', async () => {
  const ctx = await ctxWith(['false', 'echo 第二条构建'], ['echo 测试']);
  const out = await runVerify({ ctx, layout: layoutFor(ctx), runId: 'R3' });

  assert.equal(out.record.commands.length, 1, `实际执行了：${out.record.commands.map((c) => c.cmd).join('、')}`);
  assert.equal(out.record.commands[0]!.cmd, 'false');
  assert.equal(out.record.status, 'failed');
});

test('两组皆空 → 落盘一份「未配置」记录并退 64，而不是静默算通过', async () => {
  const ctx = await ctxWith([], []);
  const out = await runVerify({ ctx, layout: layoutFor(ctx), runId: 'R4' });

  assert.equal(out.record.unconfigured, true);
  assert.equal(out.exitCode, EXIT.USAGE, '未配置不能退 0——「什么都没跑」不是「通过」');
  const doc = await fs.readFile(out.artifactPath, 'utf8');
  assert.match(doc, /均为空/);
  assert.match(doc, /这\*\*不等于通过\*\*/);
});

test('命令原文与其 sha256 一并记录，可与配置对账（AC-10）', async () => {
  const ctx = await ctxWith([], ['echo 对账']);
  const out = await runVerify({ ctx, layout: layoutFor(ctx), runId: 'R5' });
  const rec = out.record.commands[0]!;
  assert.equal(rec.cmd, 'echo 对账', '必须是配置里的原文，不得规整化');
  assert.match(rec.cmd_sha256, /^[0-9a-f]{64}$/);

  const meta = JSON.parse(await fs.readFile(out.metaPath, 'utf8')) as VerifyRecord;
  assert.equal(meta.commands[0]!.cmd_sha256, rec.cmd_sha256);
  assert.equal(meta.schema, 'trivium.verify.v1');
});

test('走 shell 执行，管道与 && 语义保留', async () => {
  const ctx = await ctxWith([], ['echo a && echo b | tr a-z A-Z']);
  const out = await runVerify({ ctx, layout: layoutFor(ctx), runId: 'R6' });
  assert.equal(out.record.status, 'success');
  assert.match(out.record.commands[0]!.stdout_tail, /B/);
});

test('在项目根执行，而不是在编排器的工作目录', async () => {
  // win32 用 pwd -W（Git Bash 的 Windows 形态输出）：裸 pwd 会被 MSYS 把 TEMP 挂载映射成 /tmp，
  // 字符串归一救不回；-W 给的就是 C:/… 形态，切斜杠+小写后与 realpath 精确可比
  const ctx = await ctxWith([], [process.platform === 'win32' ? 'pwd -W' : 'pwd']);
  const out = await runVerify({ ctx, layout: layoutFor(ctx), runId: 'R7' });
  const norm = (s: string) => process.platform === 'win32' ? s.replace(/\//g, '\\').toLowerCase() : s;
  assert.equal(norm(out.record.commands[0]!.stdout_tail.trim()), norm(ctx.projectRoot));
  assert.equal(out.record.project_root, ctx.projectRoot);
});

test('超时被记录为 timed_out 而非普通失败', async () => {
  const ctx = await ctxWith([], ['sleep 5']);
  const out = await runVerify({ ctx, layout: layoutFor(ctx), runId: 'R8', timeoutS: 1 });
  assert.equal(out.record.commands[0]!.timed_out, true);
  assert.equal(out.record.status, 'failed');
  const doc = await fs.readFile(out.artifactPath, 'utf8');
  assert.match(doc, /超时/);
});

test('重跑不覆盖既有记录（P6 只追加）', async () => {
  const ctx = await ctxWith([], ['true']);
  const first = await runVerify({ ctx, layout: layoutFor(ctx), runId: 'R9' });
  const bytes = await fs.readFile(first.artifactPath);

  const second = await runVerify({ ctx, layout: layoutFor(ctx), runId: 'R10' });
  assert.notEqual(second.artifactPath, first.artifactPath, '第二次必须另起文件');
  assert.deepEqual(await fs.readFile(first.artifactPath), bytes, '首份记录须逐字节不变');
});

// ── 渲染与摘要 ──

test('尾部截断保留末尾并标注省略行数', () => {
  const text = Array.from({ length: 500 }, (_, i) => `line${i}`).join('\n');
  const t = tailLines(text, 10);
  const lines = t.split('\n');
  assert.equal(lines.length, 11, '10 行内容 + 1 行省略提示');
  assert.match(lines[0]!, /已省略前 490 行/);
  assert.equal(lines.at(-1), 'line499');
  // 短文本原样返回
  assert.equal(tailLines('a\nb', 10), 'a\nb');
});

test('渲染把失败项排在输出摘要最前', () => {
  const rec: VerifyRecord = {
    schema: 'trivium.verify.v1', run_id: 'R', topic: 'T',
    started_at: 'S', finished_at: 'F', project_root: '/p',
    commands: [
      { cmd: 'ok1', cmd_sha256: 'a'.repeat(64), group: 'build', exit_code: 0, duration_s: 1, timed_out: false, stdout_tail: 'fine', stderr_tail: '' },
      { cmd: 'bad', cmd_sha256: 'b'.repeat(64), group: 'test', exit_code: 3, duration_s: 2, timed_out: false, stdout_tail: '', stderr_tail: 'boom' },
    ],
    status: 'failed', unconfigured: false,
  };
  const doc = renderVerifyDoc(rec);
  assert.ok(doc.indexOf('`bad`') < doc.indexOf('### `ok1`'), '看记录的人先要找哪条挂了');
  assert.match(doc, /工件全部保留/);
});

test('表格里的管道符被转义，不破坏 Markdown 表格', () => {
  const rec: VerifyRecord = {
    schema: 'trivium.verify.v1', run_id: 'R', topic: 'T',
    started_at: 'S', finished_at: 'F', project_root: '/p',
    commands: [
      { cmd: 'a | b', cmd_sha256: 'c'.repeat(64), group: 'test', exit_code: 0, duration_s: 1, timed_out: false, stdout_tail: '', stderr_tail: '' },
    ],
    status: 'success', unconfigured: false,
  };
  assert.match(renderVerifyDoc(rec), /`a \\\| b`/);
});

test('摘要点名失败的命令', () => {
  const rec: VerifyRecord = {
    schema: 'trivium.verify.v1', run_id: 'R', topic: 'T',
    started_at: 'S', finished_at: 'F', project_root: '/p',
    commands: [
      { cmd: 'npm run build', cmd_sha256: 'd'.repeat(64), group: 'build', exit_code: 1, duration_s: 3, timed_out: false, stdout_tail: '', stderr_tail: '' },
    ],
    status: 'failed', unconfigured: false,
  };
  assert.match(summarizeVerify(rec), /失败：npm run build/);
  assert.match(
    summarizeVerify({ ...rec, unconfigured: true, commands: [] }),
    /既非通过也非失败/,
  );
});

// ── unconfigured 与「本次没选中」是两回事（审查意见 GLM-r2-07）──

test('--only build 而 build 未配：不得写成「两组均为空」', async () => {
  const ctx = await ctxWith([], ['npm test']); // test 配了，build 没配
  const out = await runVerify({ ctx, layout: layoutFor(ctx), runId: 'R1', only: 'build' });

  assert.equal(out.record.unconfigured, false, '另一组配了，就不是配置缺失');
  assert.equal(out.record.selected_empty, 'build');

  const doc = await fs.readFile(out.artifactPath, 'utf8');
  assert.doesNotMatch(doc, /均为空/, '审计记录里不能出现与事实不符的陈述');
  assert.match(doc, /--only build/);
  assert.match(doc, /另一组是配置齐全的/);
  assert.match(summarizeVerify(out.record), /另一组已配置/);
});

test('两组皆空时仍判 unconfigured', async () => {
  const ctx = await ctxWith([], []);
  const out = await runVerify({ ctx, layout: layoutFor(ctx), runId: 'R2', only: 'build' });
  assert.equal(out.record.unconfigured, true);
  assert.equal(out.record.selected_empty, undefined);
  assert.match(await fs.readFile(out.artifactPath, 'utf8'), /均为空/);
});

test('verify 的 run.json 用独立 schema 标识，不冒充 trivium.run.v1（AGY-03）', async () => {
  const ctx = await ctxWith([], ['true']);
  const out = await runVerify({ ctx, layout: layoutFor(ctx), runId: 'R-SCHEMA' });
  const dir = path.dirname(out.metaPath);
  const runJson = JSON.parse(await fs.readFile(path.join(dir, 'run-R-SCHEMA.json'), 'utf8')) as {
    schema: string; stage: string;
  };
  /*
   * 自称遵循某契约却不遵循，比不声明更糟——它会让下游以为可以按 run.v1 解析，
   * 而这份文档违反 run.v1 的 stage 枚举、缺大量必填字段。
   */
  assert.equal(runJson.schema, 'trivium.verify-run.v1');
  assert.notEqual(runJson.schema, 'trivium.run.v1');
  assert.equal(runJson.stage, 'verify');
});

}
