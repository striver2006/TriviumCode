// 复现 A7 (ii)：e49279a + 取值面四处，跑两个套件，列出失败用例名与首行文案。收尾只删 mkdtemp 返回值。
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const BASE = process.env.ACCEPT_BASE_REF ?? 'e49279a';
const FACE = process.argv.slice(2);
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-repro-a7-'));
try {
  const tar = path.join(base, 'src.tar');
  execFileSync('git', ['archive', '--format=tar', '-o', tar, BASE, 'src', 'scripts', 'skills', 'skills-src', 'test', 'package.json', 'tsconfig.json'], { cwd: ROOT });
  const dir = path.join(base, 'tree');
  await fs.mkdir(dir);
  execFileSync('tar', ['-xf', tar], { cwd: dir });
  for (const rel of FACE) await fs.copyFile(path.join(ROOT, rel), path.join(dir, rel));
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
  execFileSync(process.execPath, ['scripts/build.mjs', '--with-tests'], { cwd: dir, stdio: 'ignore' });
  let out = '';
  try {
    out = String(execFileSync(process.execPath, ['--test', 'dist/test/test/unit/run-meta-strict.test.js', 'dist/test/test/unit/report.test.js'], { cwd: dir, stdio: 'pipe' }));
  } catch (e) {
    out = String(e.stdout);
  }
  const blocks = [...out.matchAll(/^✖ (.+?) \(\d[^\n]*\n((?:[^\n]*\n){0,12})/gm)].map((m) => ({ name: m[1], head: m[2].split('\n').slice(0, 10).join('\n') }));
  console.log(JSON.stringify({ face: FACE, summary: out.split('\n').filter((l) => /^ℹ (pass|fail)/.test(l)), failed: blocks.slice(0, 4) }, null, 2));
} finally {
  await fs.rm(base, { recursive: true, force: true });
}
