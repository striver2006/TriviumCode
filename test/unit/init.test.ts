import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  runInit, mergeHooks, fixGitignore, writeWrapper, hookNamesOf, stableNodePath, checkWrapper, type InitReport,
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

test('已配置 verify 的项目重跑 init 不误报留空（判据取实际配置，非本次入参）', async () => {
  const ctx = await fakeProject();
  // 模拟 loadCtx 从磁盘 config.yaml 合并出的状态：verify 已配好
  ctx.config.verify = { build: ['cd server && go build ./...'], test: ['cd server && go test ./...'] };
  await fs.mkdir(ctx.triviumDir, { recursive: true });
  await fs.writeFile(path.join(ctx.triviumDir, 'config.yaml'), 'verify:\n  build:\n    - cd server && go build ./...\n  test:\n    - cd server && go test ./...\n');

  const r = await runInit({ ctx, assetRoot: await fakeAssets() });
  assert.ok(
    !r.notes.some((n) => n.includes('不猜测执行')),
    `已配置 verify 却仍告警留空：${r.notes.join(' | ')}`,
  );
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

// ── wrapper 的 node 路径要稳定（brew upgrade 后不能失效）──

test('Homebrew Cellar 版本化路径换成 opt/ 稳定入口；其它路径原样', async () => {
  const yes = async () => true;
  const no = async () => false;
  assert.equal(
    await stableNodePath('/opt/homebrew/Cellar/node/25.2.1/bin/node', yes),
    '/opt/homebrew/opt/node/bin/node',
  );
  assert.equal(
    await stableNodePath('/usr/local/Cellar/node@22/22.1.0/bin/node', yes),
    '/usr/local/opt/node@22/bin/node',
  );
  assert.equal(await stableNodePath('/opt/homebrew/Cellar/node/25.2.1/bin/node', no), '/opt/homebrew/Cellar/node/25.2.1/bin/node', '稳定入口不存在就保持原样');
  assert.equal(await stableNodePath('/Users/x/.nvm/versions/node/v22.0.0/bin/node', yes), '/Users/x/.nvm/versions/node/v22.0.0/bin/node');
});

test('checkWrapper：wrapper 在但写死的 node 或 bundle 没了 → 报出来（否则每次 Hook 报 127）', async () => {
  const ctx = await fakeProject();
  assert.deepEqual(await checkWrapper(ctx.triviumDir), [], '没有 wrapper 时无事可报');
  const report = emptyReport();
  await writeWrapper(ctx.triviumDir, '/nonexistent/Cellar/node/1.0.0/bin/node', '/nonexistent/assets', report, false);
  const problems = await checkWrapper(ctx.triviumDir);
  assert.equal(problems.length, 2, JSON.stringify(problems));
  assert.match(problems[0]!, /node 已不存在/);
  assert.match(problems[1]!, /bundle 已不存在/);
  // 换成真实存在的 node 与 bundle 后不再报
  await writeWrapper(ctx.triviumDir, process.execPath, path.dirname(path.dirname(new URL(import.meta.url).pathname)), report, false);
  const stillBundleMissing = await checkWrapper(ctx.triviumDir);
  assert.ok(stillBundleMissing.every((p) => !/node 已不存在/.test(p)));
});

test('重跑 writeWrapper 报告为 updated 而非 created', async () => {
  const ctx = await fakeProject();
  const r1 = emptyReport();
  await writeWrapper(ctx.triviumDir, '/usr/bin/node', '/assets', r1, false);
  const r2 = emptyReport();
  await writeWrapper(ctx.triviumDir, '/usr/bin/node', '/assets', r2, false);
  assert.equal(r1.created.length, 1);
  assert.equal(r2.created.length, 0);
  assert.equal(r2.updated.length, 1);
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

test('升级路径：旧版 TriviumCode Hook 被替换，不叠加也不残留', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  await fs.mkdir(path.join(ctx.projectRoot, '.claude'), { recursive: true });
  // 旧版：命令文本不同（没有存在性守卫、timeout 不同），但调的是同一个 gate hook-pre-write
  await fs.writeFile(
    path.join(ctx.projectRoot, '.claude/settings.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [
          { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] },
          { matcher: 'Edit|Write', hooks: [{ type: 'command', command: '.trivium/bin/trivium gate hook-pre-write', timeout: 5 }] },
        ],
      },
    }),
  );
  const report = emptyReport();
  await mergeHooks(ctx.projectRoot, path.join(assetRoot, 'hooks/hooks.json'), report, false);
  const s = JSON.parse(await fs.readFile(path.join(ctx.projectRoot, '.claude/settings.json'), 'utf8')) as {
    hooks: Record<string, { hooks: { command: string }[] }[]>;
  };
  const preWrite = s.hooks['PreToolUse']!.filter((e) => e.hooks.some((h) => h.command.includes('hook-pre-write')));
  assert.equal(preWrite.length, 1, `旧版应被替换而非叠加，实际 ${preWrite.length} 条`);
  assert.match(preWrite[0]!.hooks[0]!.command, /test -x/, '应是新版命令文本');
  assert.ok(s.hooks['PreToolUse']!.some((e) => e.hooks.some((h) => h.command === 'echo mine')), '用户自己的 hook 不动');
  assert.ok(report.notes.some((n) => n.includes('替换')));
});

test('hookNamesOf 从真实命令串里识别出 gate hook-<name>（旧正则匹配不到 JSON 转义后的引号）', () => {
  const entry = { matcher: 'Edit', hooks: [{ type: 'command', command: 'sh -c \'W="${CLAUDE_PROJECT_DIR}/.trivium/bin/trivium"; test -x "$W" || exit 0; exec "$W" gate hook-pre-write\'' }] };
  assert.deepEqual([...hookNamesOf(entry)], ['pre-write']);
  assert.deepEqual([...hookNamesOf({ hooks: [{ command: 'echo mine' }] })], []);
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
  await fs.writeFile(path.join(ctx.triviumDir, 'config.yaml'), '# 我手工调过的配置\nactive_profile: flash\n');
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
