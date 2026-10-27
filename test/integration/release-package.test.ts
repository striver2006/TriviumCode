/** 分发验收：真正解压安装包，在注入的临时家目录安装、升级、校验并卸载。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { REPO_ROOT } from '../helpers/fixture.js';
import { scratchDir } from '../helpers/scratch.js';
import { planInstall, install, uninstall } from '../../src/install.js';

const execFile = promisify(execFileCallback);
const IS_WIN = process.platform === 'win32';
/*
 * 时限（EV-262）：Windows 全量满载下这条三次都红在时限上——两次是自检子进程到 90 s 被杀，一次是整条到 240 s 超时；
 * 单跑约 50 s。win32 放宽到整条与 `scripts/run-tests.mjs` 的全局上限同级，macOS 不变。
 */
const LIMIT_MS = IS_WIN
  ? { test: 600_000, pack: 300_000, selftest: 300_000 }
  : { test: 240_000, pack: 120_000, selftest: 90_000 };

test('发布包真解压：白名单与哈希、四家28入口、隔离安装升级、14步桩自检与卸载',
  // Linux/WSL 不在支持面（设计 §7.1）；macOS 与 Windows 各自在本平台出包并解包验收
  { skip: process.platform !== 'darwin' && process.platform !== 'win32' ? '只在 macOS 与 Windows 上跑' : false, timeout: LIMIT_MS.test },
  async () => {
    const temp = await scratchDir('trivium-release-');
    try {
      const out = path.join(temp, 'out');
      const r = await execFile(process.execPath, ['scripts/package-release.mjs', '--candidate', '--out', out],
        { cwd: REPO_ROOT, timeout: LIMIT_MS.pack });
      const release = JSON.parse(r.stdout) as { archive: string; sha256: string; version: string };
      const archiveBytes = await fs.readFile(release.archive);
      assert.equal(createHash('sha256').update(archiveBytes).digest('hex'), release.sha256);
      if (IS_WIN) assert.deepEqual(archiveBytes.subarray(0, 4), Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        'Windows 发布包必须是 ZIP，不能是改名的 tar');
      const extracted = path.join(temp, 'extracted');
      await fs.mkdir(extracted);
      // Windows 按发布清单的 Expand-Archive 验收；macOS 包是 tar.gz。
      if (IS_WIN) {
        await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
          'Expand-Archive -LiteralPath $env:TRIVIUM_RELEASE_ARCHIVE -DestinationPath $env:TRIVIUM_RELEASE_EXTRACTED -Force'],
        { windowsHide: true, env: { ...process.env, TRIVIUM_RELEASE_ARCHIVE: release.archive, TRIVIUM_RELEASE_EXTRACTED: extracted } });
      } else {
        await execFile('/usr/bin/tar', ['-xzf', release.archive, '-C', extracted]);
      }
      const [name] = await fs.readdir(extracted);
      const root = path.join(extracted, name!);
      const manifest = JSON.parse(await fs.readFile(path.join(root, '文件校验.json'), 'utf8')) as { path: string; sha256: string }[];
      assert.ok(manifest.length > 50);
      for (const f of manifest) {
        assert.ok(!f.path.split('/').some((p) => ['.trivium', '.reviews', 'node_modules', 'evidence'].includes(p)), f.path);
        assert.equal(createHash('sha256').update(await fs.readFile(path.join(root, f.path))).digest('hex'), f.sha256, f.path);
      }
      assert.ok(manifest.some((f) => f.path.startsWith('skills-src/carriers/')));
      assert.ok(manifest.some((f) => f.path.endsWith('部署手册.md')));
      if (IS_WIN) {
        // 1.2.9：一键安装链路进包——入口 .cmd 与其后端脚本都在，且入口带齐三道闸门（存在性/版本/条件 pause）
        assert.ok(manifest.some((f) => f.path === '一键安装.cmd'), 'zip 须含 一键安装.cmd');
        assert.ok(manifest.some((f) => f.path === 'scripts/quick-install.mjs'), 'zip 须含 scripts/quick-install.mjs');
        const oneClick = await fs.readFile(path.join(root, '一键安装.cmd'), 'utf8');
        assert.ok(oneClick.includes('where node'), 'node 存在性检测在位');
        assert.ok(/if errorlevel 1 goto end\r?\nnode scripts\\quick-install\.mjs/.test(oneClick), '版本闸门后不得直接落到目标命令');
        assert.ok(oneClick.includes('pause') && oneClick.includes('%cmdcmdline%'), '双击场景须保留窗口');
      }
      const metadata = JSON.parse(await fs.readFile(path.join(root, '发布信息.json'), 'utf8'));
      assert.equal(metadata.release_state, 'candidate');
      assert.equal(metadata.platform, IS_WIN ? 'windows' : 'macos');
      assert.equal(metadata.native_windows_supported, true);
      assert.equal(metadata.cli_sha256, manifest.find((f) => f.path === 'skills/dual-critic/scripts/trivium.cjs')?.sha256);
      assert.equal(metadata.source_snapshot.git_head, metadata.source_commit);
      // 实际执行解压出来的安装器，而不是从源码调用替代它。
      const bundled = createRequire(import.meta.url)(path.join(root, 'dist/install.cjs')) as {
        planInstall: typeof planInstall; install: typeof install; uninstall: typeof uninstall;
      };
      const home = path.join(temp, 'home');
      const ie = { home, env: {} };
      const plan = await bundled.planInstall(root, ie);
      for (const t of plan.targets) await fs.mkdir(t.familyRoot, { recursive: true });
      const installed = await bundled.install(root, ie);
      assert.equal(installed.targets.filter((t) => t.status === 'installed').length, plan.targets.length);
      let entries = 0;
      for (const t of plan.targets) {
        for (const source of t.sources) {
          assert.deepEqual(await fs.readFile(path.join(t.skillsRoot, source.name, 'SKILL.md')),
            await fs.readFile(path.join(source.src, 'SKILL.md')));
          entries++;
        }
      }
      assert.equal(entries, 28);
      await assert.rejects(fs.access(path.join(plan.runtimeRoot, 'entry')));
      const stale = path.join(plan.runtimeRoot, '旧版本遗留文件.txt');
      await fs.writeFile(stale, 'upgrade should prune this');
      await bundled.install(root, ie);
      await assert.rejects(fs.access(stale));
      const cli = path.join(plan.runtimeRoot, 'scripts/trivium.cjs');
      assert.equal((await execFile(process.execPath, [cli, '--version'])).stdout.trim(), release.version);
      const selftest = await execFile(process.execPath, [cli, 'doctor', '--selftest', '--asset-root', plan.runtimeRoot],
        { cwd: extracted, timeout: LIMIT_MS.selftest });
      assert.match(selftest.stdout, /14\/14/);
      const removed = await bundled.uninstall(root, ie);
      assert.ok(removed.removed.includes(plan.runtimeRoot));
      for (const t of plan.targets) for (const source of t.sources) {
        await assert.rejects(fs.access(path.join(t.skillsRoot, source.name)));
      }
      await assert.rejects(fs.access(plan.runtimeRoot));
      // 同一路径已有分发产物时不得覆盖，原包字节不变。
      await assert.rejects(execFile(process.execPath, ['scripts/package-release.mjs', '--candidate', '--out', out], { cwd: REPO_ROOT }),
        /不覆盖已有发布物/);
      assert.equal(createHash('sha256').update(await fs.readFile(release.archive)).digest('hex'), release.sha256);
    } finally {
      await fs.rm(temp, { recursive: true, force: true });
    }
  });
