import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import YAML from 'yaml';
import {
  probeVerifyCommands, cdPrefix, shQuote, isPlaceholderTestScript,
} from '../../src/trivium/probes/verify-commands.js';

/**
 * 建树：键是相对路径，值是文件内容；以 `/` 结尾表示建空目录。
 * 目录按需自动创建。
 */
async function mkTree(tree: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-probe-'));
  for (const [rel, content] of Object.entries(tree)) {
    const p = path.join(root, rel);
    if (rel.endsWith('/')) {
      await fs.mkdir(p, { recursive: true });
      continue;
    }
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  }
  return root;
}

const pkg = (scripts: Record<string, string>, extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ name: 'x', scripts, ...extra });

// ── A. 回归与基线 ────────────────────────────────────────────────────────

test('根 package.json：三个脚本、无 lockfile → npm，且不带 cd 前缀', async () => {
  const root = await mkTree({ 'package.json': pkg({ build: 'x', typecheck: 'y', test: 'z' }) });
  const r = await probeVerifyCommands(root);
  assert.deepEqual(r.build, ['npm run build']);
  assert.deepEqual(r.test, ['npm run test']);
});

test('build 组按序取第一个命中：无 build 时用 typecheck', async () => {
  const root = await mkTree({ 'package.json': pkg({ typecheck: 'tsc --noEmit' }) });
  const r = await probeVerifyCommands(root);
  assert.deepEqual(r.build, ['npm run typecheck']);
});

test('根 Cargo.toml 与 pubspec.yaml 行为不变', async () => {
  const c = await probeVerifyCommands(await mkTree({ 'Cargo.toml': '[package]' }));
  assert.deepEqual(c.build, ['cargo build']);
  assert.deepEqual(c.test, ['cargo test']);
  const f = await probeVerifyCommands(await mkTree({ 'pubspec.yaml': 'name: a' }));
  assert.deepEqual(f.build, ['flutter build']);
  assert.deepEqual(f.test, ['flutter test']);
});

test('空目录返回空结果而非抛异常', async () => {
  const r = await probeVerifyCommands(await mkTree({}));
  assert.deepEqual(r.build, []);
  assert.deepEqual(r.test, []);
});

test('package.json 损坏时不抛，且同目录 Makefile 候选仍产出', async () => {
  const root = await mkTree({ 'package.json': '{ 坏 JSON', Makefile: 'build:\n\tgo build\n' });
  const r = await probeVerifyCommands(root);
  assert.deepEqual(r.build, ['make build']);
  assert.ok(r.notes.some((n) => n.includes('不是合法 JSON')));
});

test('Makefile 正则：认 `build :`，不被 `build := x` 误命中', async () => {
  const ok = await probeVerifyCommands(await mkTree({ Makefile: 'build :\n\tcc\ntest:\n\tsh\n' }));
  assert.deepEqual(ok.build, ['make build']);
  assert.deepEqual(ok.test, ['make test']);

  const varAssign = await probeVerifyCommands(await mkTree({ Makefile: 'build := out/x\n' }));
  assert.deepEqual(varAssign.build, [], '变量赋值不是 target，不该命中');
});

test('Makefile 兼认 makefile 与 GNUmakefile', async () => {
  const r = await probeVerifyCommands(await mkTree({ GNUmakefile: 'test:\n\tsh\n' }));
  assert.deepEqual(r.test, ['make test']);
});

// ── B. 包管理器 ──────────────────────────────────────────────────────────

test('四种 lockfile 分别映射到 pnpm/yarn/bun/npm', async () => {
  const cases: Array<[string, string]> = [
    ['pnpm-lock.yaml', 'pnpm'], ['yarn.lock', 'yarn'],
    ['bun.lockb', 'bun'], ['package-lock.json', 'npm'],
  ];
  for (const [lock, pm] of cases) {
    const root = await mkTree({ 'package.json': pkg({ build: 'x' }), [lock]: '' });
    const r = await probeVerifyCommands(root);
    assert.deepEqual(r.build, [`${pm} run build`], lock);
  }
});

test('bun 必须是 `bun run test`——`bun test` 跑的是内置运行器，语义不同', async () => {
  const root = await mkTree({ 'package.json': pkg({ test: 'vitest' }), 'bun.lockb': '' });
  const r = await probeVerifyCommands(root);
  assert.deepEqual(r.test, ['bun run test']);
  assert.ok(!r.test.some((c) => /(^|\s)bun test(\s|$)/.test(c)), '不得出现裸 bun test');
});

test('packageManager 字段压过同目录 lockfile', async () => {
  const root = await mkTree({
    'package.json': pkg({ build: 'x' }, { packageManager: 'pnpm@9.1.0' }),
    'package-lock.json': '',
  });
  const r = await probeVerifyCommands(root);
  assert.deepEqual(r.build, ['pnpm run build']);
});

test('多 lockfile 共存：pnpm > yarn > bun > npm', async () => {
  const root = await mkTree({
    'package.json': pkg({ build: 'x' }),
    'pnpm-lock.yaml': '', 'yarn.lock': '', 'package-lock.json': '',
  });
  const r = await probeVerifyCommands(root);
  assert.deepEqual(r.build, ['pnpm run build']);
});

test('lockfile 在仓库根、package.json 在子目录时仍判对（上溯生效）', async () => {
  const root = await mkTree({
    'pnpm-lock.yaml': '',
    'client/package.json': pkg({ build: 'vite build' }),
  });
  const r = await probeVerifyCommands(root);
  assert.deepEqual(r.build, ['cd client && pnpm run build']);
});

test('npm init 的占位 test 被过滤（它恒定非零退出）', async () => {
  const root = await mkTree({
    'package.json': pkg({ test: 'echo "Error: no test specified" && exit 1' }),
  });
  const r = await probeVerifyCommands(root);
  assert.deepEqual(r.test, []);
  assert.ok(r.notes.some((n) => n.includes('占位脚本')));
});

test('isPlaceholderTestScript 只认占位形态，不误伤真实命令', () => {
  assert.ok(isPlaceholderTestScript('echo "Error: no test specified" && exit 1'));
  assert.ok(!isPlaceholderTestScript('vitest run'));
  assert.ok(!isPlaceholderTestScript('node --test'));
});

// ── C. 递归、剪枝与排除 ──────────────────────────────────────────────────

test('UniClip 形态：探出的三条与人工手填的完全一致，且不含 cargo', async () => {
  const root = await mkTree({
    'docker-compose.yml': 'services: {}',
    'docs/README.md': '# doc',
    'scripts/dev.sh': '#!/bin/sh',
    'client/package.json': pkg({ build: 'tsc && vite build' }), // 刻意无 test 脚本
    'client/pnpm-lock.yaml': '',
    'client/node_modules/dep/package.json': pkg({ build: 'should-not-appear' }),
    'client/dist/': '',
    'client/src-tauri/Cargo.toml': '[package]',
    'client/src-tauri/target/': '',
    'server/go.mod': 'module x\n\ngo 1.23\n',
    'server/internal/a.go': 'package internal',
  });
  const r = await probeVerifyCommands(root);

  assert.deepEqual(r.build, ['cd client && pnpm run build', 'cd server && go build ./...']);
  assert.deepEqual(r.test, ['cd server && go test ./...']);
  assert.ok(!r.candidates.some((c) => c.kind === 'cargo'), 'client 命中后不该再下探 src-tauri');
  assert.ok(!r.candidates.some((c) => c.cmd.includes('node_modules')));
  assert.deepEqual(
    r.candidates.map((c) => c.source),
    ['client/package.json', 'server/go.mod', 'server/go.mod'],
  );
});

test('排除名单：产物与点目录下的 manifest 一律不出现', async () => {
  const root = await mkTree({
    'node_modules/a/package.json': pkg({ build: 'x' }),
    '.git/modules/b/go.mod': 'module b',
    '.trivium/x/Cargo.toml': '[package]',
    '.reviews/y/package.json': pkg({ test: 'x' }),
    'dist/c/package.json': pkg({ build: 'x' }),
    'target/d/Cargo.toml': '[package]',
    'testdata/e/go.mod': 'module e',
  });
  const r = await probeVerifyCommands(root);
  assert.deepEqual(r.build, []);
  assert.deepEqual(r.test, []);
});

test('深度上限 2：packages/app 命中，a/b/c 不命中', async () => {
  const hit = await probeVerifyCommands(await mkTree({
    'packages/app/package.json': pkg({ build: 'x' }),
  }));
  assert.deepEqual(hit.build, ['cd packages/app && npm run build']);

  const miss = await probeVerifyCommands(await mkTree({
    'a/b/c/package.json': pkg({ build: 'x' }),
  }));
  assert.deepEqual(miss.build, []);
});

test('JS 工作区根压制后代 node 候选，但不压制后代的 go', async () => {
  const root = await mkTree({
    'pnpm-workspace.yaml': "packages:\n  - 'packages/*'\n",
    'package.json': pkg({ build: 'turbo build' }),
    'packages/a/package.json': pkg({ build: 'vite build' }),
    'packages/svc/go.mod': 'module svc',
  });
  const r = await probeVerifyCommands(root);
  assert.deepEqual(r.build, ['npm run build', 'cd packages/svc && go build ./...']);
  assert.ok(!r.build.some((c) => c.includes('packages/a')));
});

test('go.work 存在时压制后代 module 的 go 候选', async () => {
  const root = await mkTree({
    'go.work': 'go 1.23\n\nuse ./a\n',
    'go.mod': 'module root',
    'a/go.mod': 'module a',
  });
  const r = await probeVerifyCommands(root);
  assert.deepEqual(r.build, ['go build ./...']);
});

test('目录名含空格、单引号或以 - 开头时安全转义', async () => {
  const space = await probeVerifyCommands(await mkTree({
    'my app/package.json': pkg({ build: 'x' }),
  }));
  assert.deepEqual(space.build, [`cd -- 'my app' && npm run build`]);

  const quote = await probeVerifyCommands(await mkTree({
    "it's/package.json": pkg({ build: 'x' }),
  }));
  assert.deepEqual(quote.build, [`cd -- 'it'\\''s' && npm run build`]);

  const dash = await probeVerifyCommands(await mkTree({
    '-weird/package.json': pkg({ build: 'x' }),
  }));
  assert.ok(dash.build[0]!.startsWith('cd -- '), dash.build[0]);
});

test('cdPrefix 与 shQuote 的纯函数行为', () => {
  assert.equal(cdPrefix(''), '');
  assert.equal(cdPrefix('.'), '');
  assert.equal(cdPrefix('client'), 'cd client && ');
  assert.equal(cdPrefix('packages/app'), 'cd packages/app && ');
  assert.equal(shQuote("it's"), `'it'\\''s'`);
});

test('命中目录数触顶时置 truncated', async () => {
  const tree: Record<string, string> = {};
  for (let i = 0; i < 30; i++) tree[`p${String(i).padStart(2, '0')}/package.json`] = pkg({ build: 'x' });
  const r = await probeVerifyCommands(await mkTree(tree));
  assert.ok(r.truncated, '应标记截断');
  assert.ok(r.build.length <= 10, `命中目录应被限制，实际 ${r.build.length}`);
});

test('结果确定：同一夹具连跑两次完全一致', async () => {
  const root = await mkTree({
    'client/package.json': pkg({ build: 'x' }),
    'server/go.mod': 'module s',
    'tools/Cargo.toml': '[package]',
  });
  const a = await probeVerifyCommands(root);
  const b = await probeVerifyCommands(root);
  assert.deepEqual(a.build, b.build);
  assert.deepEqual(a.test, b.test);
});

// ── D. 新增生态 ──────────────────────────────────────────────────────────

test('go.mod 在根：无 cd 前缀', async () => {
  const r = await probeVerifyCommands(await mkTree({ 'go.mod': 'module x' }));
  assert.deepEqual(r.build, ['go build ./...']);
  assert.deepEqual(r.test, ['go test ./...']);
});

test('pyproject：有 pytest 信号才出 test 候选', async () => {
  const withSignal = await probeVerifyCommands(await mkTree({
    'pyproject.toml': '[project]\nname = "x"\n\n[tool.pytest.ini_options]\n',
  }));
  assert.deepEqual(withSignal.test, ['pytest']);

  const without = await probeVerifyCommands(await mkTree({
    'pyproject.toml': '[project]\nname = "x"\n',
  }));
  assert.deepEqual(without.test, [], '无信号时不臆测测试命令');
  assert.ok(without.notes.some((n) => n.includes('pytest')));
});

test('pyproject：运行器前缀 uv > poetry，mypy 归 build 组', async () => {
  const poetry = await probeVerifyCommands(await mkTree({
    'pyproject.toml': '[tool.poetry]\n\n[tool.pytest.ini_options]\n\n[tool.mypy]\n',
    'poetry.lock': '',
  }));
  assert.deepEqual(poetry.build, ['poetry run mypy .']);
  assert.deepEqual(poetry.test, ['poetry run pytest']);

  const uv = await probeVerifyCommands(await mkTree({
    'pyproject.toml': '[tool.poetry]\n\n[tool.pytest.ini_options]\n',
    'poetry.lock': '', 'uv.lock': '',
  }));
  assert.deepEqual(uv.test, ['uv run pytest'], 'uv 优先于 poetry');
});

test('pyproject：conftest.py 也算 pytest 信号', async () => {
  const r = await probeVerifyCommands(await mkTree({
    'pyproject.toml': '[project]\nname = "x"\n', 'conftest.py': '',
  }));
  assert.deepEqual(r.test, ['pytest']);
});

// ── E. 渲染 ──────────────────────────────────────────────────────────────

test('命令含单引号时，输出的 YAML 仍可被解析回原数组', async () => {
  const root = await mkTree({ "it's/package.json": pkg({ build: 'x', test: 'y' }) });
  const r = await probeVerifyCommands(root);
  const yaml = YAML.stringify({ verify: { build: r.build, test: r.test } }, { lineWidth: 0 });
  const back = YAML.parse(yaml) as { verify: { build: string[]; test: string[] } };
  assert.deepEqual(back.verify.build, r.build);
  assert.deepEqual(back.verify.test, r.test);
});
