import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import {
  runInit, mergeHooks, fixGitignore, writeWrapper, hookNamesOf, stableNodePath, checkWrapper, type InitReport,
  protocolPlan, protocolFingerprint, composeProtocol, KNOWN_PROTOCOL_SHA256, upsertProtocolBlock,
} from '../../src/trivium/init.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { AGENTS } from '../../src/trivium/agents/registry.js';
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
  await fs.writeFile(path.join(root, 'protocol/driver.snippet'), '\n## TriviumCode 双审流水线协议（Driver）\n\nDRIVER-段。\n');
  await fs.writeFile(path.join(root, 'protocol/critic.snippet'), '\n## 审查员身份说明（TriviumCode）\n\nCRITIC-段。\n');
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

  for (const rel of ['.trivium/config.yaml', '.trivium/bin/trivium', 'CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.reviews/README.md']) {
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

/*
 * ── 协议片段两段式（M10b 第 2 步；计划 r2 §3.3、r5 §5.5）──
 *
 * 旧版 `appendSnippet` 见标记就跳过，片段永远停在 init 那天（MANUAL「坑二」）。
 * 新版按标记内正文的指纹判断：已知旧版原位换成新两段，别的一律不动并提示。
 */

/** 旧版 `protocol/AGENTS.md.snippet`（@2d7cbbc，唯一一版）的正文——指纹在 init.ts 的旧版表里 */
const LEGACY_AGENTS_SNIPPET = [
  '## 审查员身份说明（TriviumCode）',
  '',
  '若你是通过 TriviumCode 编排器以**审查员**身份被启动的（提示词首段会明确声明角色），',
  '则以**提示词首段的角色与禁令为准**，忽略本文件中面向执笔者的任务指令——',
  '那些是给主攻方（Driver）的，不是给你的。',
  '',
  '作为审查员你只读不写：不得修改任何文件、不得执行写命令、不得读取任务书中',
  '禁读清单列出的文件。你的结论由编排器落盘，不要自行写文件到仓库。',
].join('\n');

const block = (body: string): string => `\n<!-- BEGIN TriviumCode -->\n${body}\n<!-- END TriviumCode -->\n`;

test('协议片段按注册表派生：CLAUDE.md 只带 Driver 段；AGENTS.md / GEMINI.md 审查员段在前、Driver 段在后', () => {
  const plan = Object.fromEntries(protocolPlan().map((p) => [p.file, p.sections]));
  assert.deepEqual(plan, {
    'CLAUDE.md': ['driver'],
    'AGENTS.md': ['critic', 'driver'],
    'GEMINI.md': ['critic', 'driver'],
  });
  // 派生而不是写死：审核者读不到项目记忆的那一家不带审查员段（EV-44）
  const flipped = AGENTS.map((a) => (a.instructionFiles.includes('CLAUDE.md') ? { ...a, criticReadsInstructionFiles: true } : a));
  assert.deepEqual(protocolPlan(flipped).find((p) => p.file === 'CLAUDE.md')?.sections, ['critic', 'driver']);
});

test('init 按片段组合写三个项目记忆文件，且 GEMINI.md 是新增的', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  const r = await runInit({ ctx, assetRoot, nodePath: '/usr/bin/node' });
  const read = (f: string): Promise<string> => fs.readFile(path.join(ctx.projectRoot, f), 'utf8');
  const claude = await read('CLAUDE.md');
  assert.match(claude, /DRIVER-段/);
  assert.doesNotMatch(claude, /CRITIC-段/);
  for (const f of ['AGENTS.md', 'GEMINI.md']) {
    const md = await read(f);
    assert.ok(md.indexOf('CRITIC-段') >= 0 && md.indexOf('CRITIC-段') < md.indexOf('DRIVER-段'), `${f}：审查员段须在前`);
  }
  assert.ok(r.created.some((c) => c.endsWith('GEMINI.md')));
});

test('已知旧版单段：原位升级为两段式，只有一块，块外内容不动', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  const agentsMd = path.join(ctx.projectRoot, 'AGENTS.md');
  await fs.writeFile(agentsMd, `# 项目说明\n${block(LEGACY_AGENTS_SNIPPET)}\n## 后文\n\n保留。\n`);
  const r = await runInit({ ctx, assetRoot, nodePath: '/usr/bin/node' });
  const md = await fs.readFile(agentsMd, 'utf8');
  assert.equal((md.match(/BEGIN TriviumCode/g) ?? []).length, 1, '替换而不是追加第二块');
  assert.match(md, /CRITIC-段[\s\S]*DRIVER-段/);
  assert.doesNotMatch(md, /以\*\*提示词首段的角色与禁令为准/, '旧正文应被换掉');
  assert.match(md, /^# 项目说明/);
  assert.match(md, /## 后文\n\n保留。\n$/);
  assert.ok(r.notes.some((n) => /从已知旧版升级为当前版本/.test(n)), JSON.stringify(r.notes));
  // 再跑一次：已是当前版本，幂等
  const r2 = await runInit({ ctx, assetRoot, nodePath: '/usr/bin/node' });
  assert.ok(r2.skipped.some((x) => x.includes('AGENTS.md') && /当前版本/.test(x)));
  assert.equal(await fs.readFile(agentsMd, 'utf8'), md);
});

test('标记内被手工改过：不替换、原样保留，提示手工合并', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  const claudeMd = path.join(ctx.projectRoot, 'CLAUDE.md');
  const original = `# 我的项目\n${block('## 我改过的协议\n\n本项目专属约定。')}`;
  await fs.writeFile(claudeMd, original);
  const r = await runInit({ ctx, assetRoot, nodePath: '/usr/bin/node' });
  assert.equal(await fs.readFile(claudeMd, 'utf8'), original);
  assert.ok(r.notes.some((n) => n.includes('CLAUDE.md') && /手工合并/.test(n)), JSON.stringify(r.notes));
  // 判据是指纹而不是「长得像」：旧版正文多一个字就不再是已知旧版
  assert.notEqual(protocolFingerprint(`${LEGACY_AGENTS_SNIPPET}。`), protocolFingerprint(LEGACY_AGENTS_SNIPPET));
});

test('只有开始标记没有结束标记：不动，提示', async () => {
  const ctx = await fakeProject();
  const assetRoot = await fakeAssets();
  const gm = path.join(ctx.projectRoot, 'GEMINI.md');
  const original = '# x\n<!-- BEGIN TriviumCode -->\n半截\n';
  await fs.writeFile(gm, original);
  const r = await runInit({ ctx, assetRoot, nodePath: '/usr/bin/node' });
  assert.equal(await fs.readFile(gm, 'utf8'), original);
  assert.ok(r.notes.some((n) => /标记不完整/.test(n)));
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

test('已知指纹表覆盖当前版：改了协议片段忘了登记，这里当场变红（代码双审 GLM-03）', async () => {
  /*
   * 表只追加、含当前版，且**按指令文件分档**（见 init.ts 的 KNOWN_PROTOCOL_SHA256）。
   * 此前靠注释提醒「改片段时补指纹」，忘了补的后果是已 init 的项目下次被判成「手工改过」、
   * 静默停在旧版——不报错、不可见。取**仓库里真实的片段**，不取夹具：要守的正是那两份文件的改动。
   */
  const assetRoot = path.join(REPO_ROOT, 'skills/dual-critic');
  const missing: string[] = [];
  for (const item of protocolPlan()) {
    const body = await composeProtocol(assetRoot, item.sections);
    assert.ok(body !== null, `${item.file}：仓库里缺协议片段`);
    const fp = protocolFingerprint(body);
    if (!KNOWN_PROTOCOL_SHA256[item.file]?.has(fp)) {
      missing.push(`  [${item.file}] '${fp}', // ${item.sections.join(' + ')}`);
    }
  }
  assert.deepEqual(
    missing, [],
    '当前协议片段拼出的正文指纹不在 KNOWN_PROTOCOL_SHA256 该文件那一档里。请把下面这些行**追加**进对应的档\n' +
      '（只追加、不删旧值：旧值是已 init 项目的升级依据）：\n' + missing.join('\n'),
  );
});

/*
 * 删掉一段后恰好等于**别的文件**的已知正文：不得当成「已知旧版」复原（代码双审 r2 CODEX-02）。
 * 三类正文（审查员段单独 = 旧 AGENTS.md 片段、Driver 段单独 = CLAUDE.md 当前版、两段拼合）都在表里，
 * 不分文件查表时，用户的删除会被静默撤销。这里用仓库真实片段构造，因为要撞的正是真实指纹。
 *
 * **刻意不含「AGENTS.md 只剩审查员段」**：那与旧版 init 给 AGENTS.md 写的正文逐字相同，
 * 「用户删了 Driver 段」与「这是旧版 init 的项目」在盘上是同一个状态，无从区分；按旧版升级是对的
 * （后者远为常见）。这是分档也消不掉的固有边界，登记在 init.ts 的 KNOWN_PROTOCOL_SHA256 注释里。
 */
for (const [file, keep] of [
  ['AGENTS.md', ['driver']],
  ['GEMINI.md', ['driver']],
  ['GEMINI.md', ['critic']],
  ['CLAUDE.md', ['critic', 'driver']],
] as const) {
  test(`${file} 里只剩 ${keep.join(' + ')}（手工删改后恰等于别的文件的正文）：不替换，提示手工合并`, async () => {
    const assetRoot = path.join(REPO_ROOT, 'skills/dual-critic');
    const sections = protocolPlan().find((p) => p.file === file)!.sections;
    const body = (await composeProtocol(assetRoot, sections))!;
    const leftover = (await composeProtocol(assetRoot, keep))!;
    assert.notEqual(leftover.trim(), body.trim(), '前提：剩下的正文不是本文件的当前版');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-protocol-'));
    const target = path.join(dir, file);
    const original = `# 项目说明\n${block(leftover)}\n## 后文\n`;
    await fs.writeFile(target, original);
    const r: InitReport = { created: [], updated: [], skipped: [], notes: [] };
    await upsertProtocolBlock(target, body, r, false);
    assert.equal(await fs.readFile(target, 'utf8'), original, '用户删改后的块必须原样保留');
    assert.deepEqual(r.updated, []);
    assert.ok(r.notes.some((n) => /与任何已知版本都不同/.test(n)), JSON.stringify(r.notes));
  });
}
