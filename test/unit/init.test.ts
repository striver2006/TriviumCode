import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  runInit, mergeHooks, fixGitignore, writeWrapper, type InitReport,
} from '../../src/trivium/init.js';
import { defaultConfig } from '../../src/trivium/config.js';
import type { Ctx } from '../../src/trivium/types.js';

/** 造一份最小的 asset root（init 只需要 hooks.json 与 protocol/ 片段） */
async function fakeAssets(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-assets-'));
  await fs.mkdir(path.join(root, 'hooks'), { recursive: true });
  await fs.mkdir(path.join(root, 'protocol'), { recursive: true });
  await fs.mkdir(path.join(root, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(root, 'scripts/trivium.cjs'), '// bundle');
  await fs.writeFile(
    path.join(root, 'hooks/hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Edit|Write', hooks: [{ type: 'command', command: 'sh -c \'W=X; test -x "$W" || exit 0; exec "$W" gate hook-pre-write\'' }] },
        ],
        Stop: [{ hooks: [{ type: 'command', command: 'sh -c \'W=X; test -x "$W" || exit 0; exec "$W" gate hook-stop\'' }] }],
      },
    }),
  );
  await fs.writeFile(path.join(root, 'protocol/gitignore.snippet'),
    '\n# TriviumCode 编排器运行时目录 (.trivium/)\n.trivium/bin/\n.trivium/config.local.yaml\n');
  await fs.writeFile(path.join(root, 'protocol/CLAUDE.md.snippet'), '## TriviumCode 协议\n\n内容。\n');
  await fs.writeFile(path.join(root, 'protocol/AGENTS.md.snippet'), '## 审查员身份\n\n内容。\n');
  return root;
}

async function fakeProject(): Promise<Ctx> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-proj-'));
  return {
    config: defaultConfig(),
    projectRoot: root,
    archiveRoot: path.join(root, '.reviews'),
    triviumDir: path.join(root, '.trivium'),
    sources: ['<test>'],
  };
}

const emptyReport = (): InitReport => ({ created: [], updated: [], skipped: [], notes: [] });

test('init 产出 config.yaml、wrapper、协议片段与归档 README', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  const r = await runInit({ ctx, assetRoot, nodePath: '/usr/bin/node' });

  for (const rel of ['.trivium/config.yaml', '.trivium/bin/trivium', 'CLAUDE.md', 'AGENTS.md', '.reviews/README.md']) {
    await fs.access(path.join(ctx.projectRoot, rel));
  }
  assert.ok(r.created.length >= 5);
  // config.yaml 不应含 probe 段——那是本机结论，属 config.local.yaml
  const cfg = await fs.readFile(path.join(ctx.projectRoot, '.trivium/config.yaml'), 'utf8');
  assert.ok(!cfg.includes('probe:'), 'config.yaml 不该含 probe 段');
  assert.ok(cfg.includes('archive_root'));
});

test('未确认编译测试命令时 verify 留空，并明确说明不猜测执行', async () => {
  const ctx = await fakeProject();
  const r = await runInit({ ctx, assetRoot: await fakeAssets() });
  assert.ok(r.notes.some((n) => n.includes('不猜测执行')));
  const cfg = await fs.readFile(path.join(ctx.projectRoot, '.trivium/config.yaml'), 'utf8');
  assert.match(cfg, /verify:\s*\n\s*build:\s*\[\]/);
});

test('已确认的命令会写入 verify', async () => {
  const ctx = await fakeProject();
  await runInit({
    ctx, assetRoot: await fakeAssets(),
    verify: { build: ['npm run build'], test: ['npm test'] },
  });
  const cfg = await fs.readFile(path.join(ctx.projectRoot, '.trivium/config.yaml'), 'utf8');
  assert.match(cfg, /npm run build/);
  assert.match(cfg, /npm test/);
});

test('wrapper 内写死 node 绝对路径且可执行（GUI 进程不读 .zshrc）', async () => {
  const ctx = await fakeProject();
  const report = emptyReport();
  await writeWrapper(ctx.triviumDir, '/opt/homebrew/bin/node', '/assets', report, false);
  const p = path.join(ctx.triviumDir, 'bin/trivium');
  const s = await fs.readFile(p, 'utf8');
  assert.match(s, /exec "\/opt\/homebrew\/bin\/node"/);
  assert.match(s, /\/assets\/scripts\/trivium\.cjs/);
  const st = await fs.stat(p);
  assert.equal(st.mode & 0o111, 0o111, '必须可执行');
});

// ── Hook 合并（风险 R-D）──

test('合并 Hook 保留用户自己的 hooks，并按事件名追加', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  await fs.mkdir(path.join(ctx.projectRoot, '.claude'), { recursive: true });
  await fs.writeFile(
    path.join(ctx.projectRoot, '.claude/settings.json'),
    JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] },
      otherSetting: 42,
    }),
  );
  const report = emptyReport();
  await mergeHooks(ctx.projectRoot, path.join(assetRoot, 'hooks/hooks.json'), report, false);

  const s = JSON.parse(
    await fs.readFile(path.join(ctx.projectRoot, '.claude/settings.json'), 'utf8'),
  ) as { hooks: Record<string, { hooks: { command: string }[] }[]>; otherSetting: number };

  const cmds = s.hooks['PreToolUse']!.flatMap((e) => e.hooks.map((h) => h.command));
  assert.ok(cmds.includes('echo mine'), '用户原有 hook 必须保留');
  assert.ok(cmds.some((c) => c.includes('hook-pre-write')), 'trivium 的 hook 应被追加');
  assert.equal(s.otherSetting, 42, '其它设置不得丢失');
  assert.ok(s.hooks['Stop'], '新事件应被创建');
  // 必须备份
  await fs.access(path.join(ctx.projectRoot, '.claude/settings.json.trivium-backup'));
});

test('合并 Hook 幂等：重复合并不叠加', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  const report = emptyReport();
  await mergeHooks(ctx.projectRoot, path.join(assetRoot, 'hooks/hooks.json'), report, false);
  await mergeHooks(ctx.projectRoot, path.join(assetRoot, 'hooks/hooks.json'), report, false);
  const s = JSON.parse(
    await fs.readFile(path.join(ctx.projectRoot, '.claude/settings.json'), 'utf8'),
  ) as { hooks: Record<string, { hooks: unknown[] }[]> };
  const total = s.hooks['PreToolUse']!.reduce((n, e) => n + e.hooks.length, 0);
  assert.equal(total, 1, `重复合并不应叠加，实际 ${total}`);
});

test('settings.json 不是合法 JSON 时跳过合并而非破坏内容', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  const p = path.join(ctx.projectRoot, '.claude/settings.json');
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, '{ 这不是 JSON');
  const report = emptyReport();
  await mergeHooks(ctx.projectRoot, path.join(assetRoot, 'hooks/hooks.json'), report, false);
  assert.equal(await fs.readFile(p, 'utf8'), '{ 这不是 JSON', '内容必须原样保留');
  assert.ok(report.notes.some((n) => n.includes('解析失败')));
});

// ── .gitignore（RV-06）──

test('把整体忽略 .claude/ 改为白名单写法', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  await fs.writeFile(path.join(ctx.projectRoot, '.gitignore'), 'node_modules/\n.claude/\n*.log\n');
  const report = emptyReport();
  await fixGitignore(ctx.projectRoot, path.join(assetRoot, 'protocol/gitignore.snippet'), report, false);

  const g = await fs.readFile(path.join(ctx.projectRoot, '.gitignore'), 'utf8');
  assert.ok(!/^\.claude\/$/m.test(g), '整体忽略应被移除');
  assert.match(g, /^\.claude\/\*$/m);
  assert.match(g, /^!\.claude\/settings\.json$/m);
  assert.match(g, /^\.claude\/settings\.local\.json$/m);
  assert.match(g, /node_modules\//, '其它规则不得丢失');
  assert.match(g, /\.trivium\/config\.local\.yaml/);
  assert.ok(report.notes.some((n) => n.includes('白名单')));
});

test('.gitignore 幂等：重复修正不重复追加', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  const snippet = path.join(assetRoot, 'protocol/gitignore.snippet');
  const report = emptyReport();
  await fixGitignore(ctx.projectRoot, snippet, report, false);
  await fixGitignore(ctx.projectRoot, snippet, report, false);
  const g = await fs.readFile(path.join(ctx.projectRoot, '.gitignore'), 'utf8');
  const n = (g.match(/TriviumCode 编排器运行时目录/g) ?? []).length;
  assert.equal(n, 1, `片段应只出现一次，实际 ${n}`);
});

test('无 .claude/ 整体忽略时不乱改', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  await fs.writeFile(path.join(ctx.projectRoot, '.gitignore'), '.claude/*\n!.claude/settings.json\n');
  const report = emptyReport();
  await fixGitignore(ctx.projectRoot, path.join(assetRoot, 'protocol/gitignore.snippet'), report, false);
  const g = await fs.readFile(path.join(ctx.projectRoot, '.gitignore'), 'utf8');
  assert.equal((g.match(/!\.claude\/settings\.json/g) ?? []).length, 1);
});

// ── 协议片段幂等 ──

test('协议片段带标记且幂等，原有内容保留', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  await fs.writeFile(path.join(ctx.projectRoot, 'CLAUDE.md'), '# 我的项目\n\n原有内容。\n');
  await runInit({ ctx, assetRoot });
  await runInit({ ctx, assetRoot });
  const md = await fs.readFile(path.join(ctx.projectRoot, 'CLAUDE.md'), 'utf8');
  assert.match(md, /^# 我的项目/);
  assert.match(md, /原有内容。/);
  assert.equal((md.match(/BEGIN TriviumCode/g) ?? []).length, 1, '片段不得重复追加');
  assert.equal((md.match(/END TriviumCode/g) ?? []).length, 1);
});

test('已存在的 config.yaml 不被覆盖', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  await fs.mkdir(ctx.triviumDir, { recursive: true });
  await fs.writeFile(path.join(ctx.triviumDir, 'config.yaml'), '# 我手工调过的配置\nactive_profile: security\n');
  const r = await runInit({ ctx, assetRoot });
  const cfg = await fs.readFile(path.join(ctx.triviumDir, 'config.yaml'), 'utf8');
  assert.match(cfg, /我手工调过的配置/);
  assert.ok(r.skipped.some((s) => s.includes('config.yaml')));
});

test('--dry-run 不落盘', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  const r = await runInit({ ctx, assetRoot, dryRun: true });
  assert.ok(r.created.length > 0, '仍应报告将要创建什么');
  await assert.rejects(fs.access(path.join(ctx.triviumDir, 'config.yaml')));
});

test('缺少构建产物时给出明确提示（而不是静默产出坏 wrapper）', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  await fs.rm(path.join(assetRoot, 'scripts/trivium.cjs'));
  const r = await runInit({ ctx, assetRoot });
  assert.ok(r.notes.some((n) => n.includes('npm run build')));
});
