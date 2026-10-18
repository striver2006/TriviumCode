import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { existsSync, promises as fs } from 'node:fs';
import { AGENTS } from '../../src/trivium/agents/registry.js';
import { ENTRY_PROBLEM_LABELS } from '../../src/trivium/entry-collisions.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { scratchDir } from '../helpers/scratch.js';

/*
 * `npm run install:check`（`scripts/install-check.mjs`）对共享根残留的读数（主题 M12-共享根残留检测，计划 r2 §4 U9）。
 *
 * 脚本取安装器产物的 `defaultInstallEnv()`，即 `os.homedir()`：子进程环境**整份构造**，`HOME` 指向夹具，
 * 不继承真实 `HOME` / `CODEX_HOME` / `TRIVIUM_ASSET_ROOT`；输出里出现的路径必须都落在夹具里。
 */

const SCRIPT = path.join(REPO_ROOT, 'scripts/install-check.mjs');
const BUNDLE = path.join(REPO_ROOT, 'dist/install.cjs');
const skip = !existsSync(BUNDLE) && '先 npm run build';

async function fakeHome(): Promise<string> {
  const home = await scratchDir('trivium-icheck-home-');
  for (const a of AGENTS) await fs.mkdir(path.join(home, a.entrySkillRoot.homeRel), { recursive: true });
  return home;
}

function runCheck(home: string, extra: Record<string, string> = {}): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: REPO_ROOT,
    env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home, ...extra },
    encoding: 'utf8',
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** 输出里每个绝对路径都必须在夹具家目录之内（不读真实家目录的证据） */
function assertPathsInside(text: string, home: string): void {
  for (const m of text.matchAll(/(\/[^\s，。（）]+)/g)) {
    const p = m[1]!;
    if (p.startsWith('/')) assert.ok(p.startsWith(home), `输出里出现夹具之外的路径：${p}\n${text}`);
  }
}

test('U9 共享根有 10-16 形态的运行时拷贝 ⇒ 退 1、列出共享根残留标签', { skip }, async () => {
  const home = await fakeHome();
  const d = path.join(home, '.agents/skills/dual-critic');
  await fs.mkdir(path.join(d, 'schema'), { recursive: true });
  await fs.mkdir(path.join(d, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(d, 'SKILL.md'), '---\nname: dual-critic\ndescription: 过时的拷贝\n---\n');
  const r = runCheck(home);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.ok(r.stdout.includes(ENTRY_PROBLEM_LABELS['shared-residue']), r.stdout);
  assert.ok(r.stdout.includes(d), r.stdout);
  assertPathsInside(r.stdout, home);
});

test('U9 运行时根就放在共享根里（TRIVIUM_ASSET_ROOT 指向它）⇒ 豁免、退 0，与真装口径一致', { skip }, async () => {
  const home = await fakeHome();
  const d = path.join(home, '.agents/skills/dual-critic');
  await fs.mkdir(path.join(d, 'schema'), { recursive: true });
  await fs.writeFile(path.join(d, 'SKILL.md'), '---\nname: dual-critic\ndescription: 正在用的运行时\n---\n');
  const r = runCheck(home, { TRIVIUM_ASSET_ROOT: d });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('U9 共享根只有别家的 entry skill ⇒ 退 0、✓ 行照旧', { skip }, async () => {
  const home = await fakeHome();
  const d = path.join(home, '.agents/skills/entry');
  await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(d, 'SKILL.md'), '---\nname: entry\ndescription: 别家的\n---\n');
  const r = runCheck(home);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^✓ 无重名、无残留（已查 .+ 的安装根与额外读取面）\n$/);
});
