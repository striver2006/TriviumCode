// M10b 第 2 步收尾：codex 零配额枚举核对（计划 r10 §2.1）。
//
// 把 codex 目标装进一个临时 CODEX_HOME + 临时 HOME（同一个 mkdtemp 目录下），跑一次
// `codex debug prompt-input`，断言 skill 列表里本产品入口的每个 `file:` 路径都是 `r<n>/<名字>/SKILL.md`、
// 没有带层级的路径（r9 §2.1：codex 递归枚举 skill 根，任何目标里都不得出现 entry/ 子树）。
//
// 纪律（2026-09-20 事故 R1 / R2 / R5）：
//   · 唯一的删除动作只作用于本脚本 mkdtemp 的直接返回值，删前断言它在 os.tmpdir() 下且前缀对得上；
//   · 不引用项目内任何清理助手；不拷贝任何凭据（prompt-input 不发请求，不需要鉴权）。
//
// 用法：node <本文件> <仓库根> <输出目录>   （仓库根须已 `node scripts/build.mjs --with-tests`）
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';

const ROOT = process.argv[2];
const OUT = process.argv[3];
const PREFIX = 'm10b-step2-codex-enum-';
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), PREFIX));
try {
  const home = path.join(tmp, 'home');
  const codexHome = path.join(tmp, 'codexhome');
  await fs.mkdir(home, { recursive: true });
  await fs.mkdir(codexHome, { recursive: true });

  const { install } = await import(path.join(ROOT, 'dist/test/src/install.js'));
  const report = await install(ROOT, { home, env: { CODEX_HOME: codexHome } }, { only: ['codex'] });

  const r = spawnSync('codex', ['debug', 'prompt-input', '$dual-review-plan 甲 乙'], {
    env: { ...process.env, HOME: home, CODEX_HOME: codexHome },
    encoding: 'utf8',
    timeout: 120_000,
  });
  const redact = function (s) { return (s ?? '').split(tmp).join('<tmp>').split(os.homedir()).join('~'); };
  const stdout = redact(r.stdout);
  const stderr = redact(r.stderr);

  const lines = stdout.split(/\\n|\n/).filter(function (l) { return /\(file: /.test(l); });
  const ours = [];
  for (const l of lines) {
    for (const m of l.matchAll(/- (dual-[a-z-]+):[^\n]*?\(file: ([^)]+)\)/g)) ours.push({ name: m[1], file: m[2] });
  }
  const flat = ours.filter(function (o) { return /^r\d+\/dual-[a-z-]+\/SKILL\.md$/.test(o.file); });
  const nested = ours.filter(function (o) { return !/^r\d+\/dual-[a-z-]+\/SKILL\.md$/.test(o.file); });
  const roots = [...stdout.matchAll(/r\d+ = [^\n\\]+/g)].map(function (m) { return m[0]; });

  const summary = {
    codex_version: spawnSync('codex', ['--version'], { encoding: 'utf8' }).stdout.trim(),
    exit_code: r.status,
    installed: report.targets.filter(function (t) { return t.status === 'installed'; }).map(function (t) {
      return { agent: t.agent, skillsRoot: redact(t.skillsRoot), entries: t.dirs.length };
    }),
    skill_roots: roots,
    our_entries: ours,
    flat_count: flat.length,
    nested_count: nested.length,
    verdict: r.status === 0 && ours.length === 7 && nested.length === 0 ? 'PASS' : 'FAIL',
  };
  await fs.mkdir(OUT, { recursive: true });
  await fs.writeFile(path.join(OUT, 'codex-enum-prompt-input.json'), stdout);
  await fs.writeFile(path.join(OUT, 'codex-enum-stderr.txt'), stderr);
  await fs.writeFile(path.join(OUT, 'codex-enum-summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
} finally {
  // R5：删前断言目标是本脚本 mkdtemp 的返回值形态
  if (!(tmp.startsWith(os.tmpdir()) && path.basename(tmp).startsWith(PREFIX))) {
    throw new Error(`拒绝删除：${tmp} 不是本脚本 mkdtemp 的返回值形态`);
  }
  await fs.rm(tmp, { recursive: true, force: true });
}
