#!/usr/bin/env node
/**
 * 「两个空配置项收口」真实配置读数（计划 r2 §6「真实配置读数」，零配额）。
 *
 * 把本仓 `.trivium/config.yaml` 与 `config.local.yaml` **拷进一个临时 git 仓库**，在那里用新构建跑：
 *   - `doctor --only env --no-model-calls --json`（只跑环境段）；
 *   - `preflight --stage all --critics codex,gemini,glm --skip-auth-check --json`（跳过探活 = 不花配额；CLI 版本检查只跑 `--version`）。
 * 不在本仓里直接跑：doctor 收尾会写 `config.local.yaml` 的探针段，那是用户的本机文件。
 *
 * 只记退出码、warnings / blockers 与各检查项的名称和结论，**不落 doctor 的 probe 全文**（避免把本机细节整份写进证据）。
 * 另记 doctor notes 里的「编排器构建标识」一行（git_head、dirty、inputs 哈希），bundle 哈希每次构建都变、对不上源码
 * （代码双审 r1 CODEX-04）。
 *
 * 用法（在仓库根，先 `npm run build`）：node doc/05_testing/evidence/config-dead-keys-20261001/real-config-readout.mjs <标签> [输出 JSON 路径]
 * 标签用来区分删键前 / 删键后两次读数。标签为 `before` 时，`config.yaml` 取自 `git show 9cc9249:`（起点提交里的本仓配置，
 * 带两键）——工作树里的已经删过键，修订后要重取「删键前」只能从提交里拿；`config.local.yaml` 两次都取工作树（不进 Git）。
 * 清理：只删本脚本 mkdtemp 返回的目录。
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const LABEL = process.argv[2];
const OUT = process.argv[3] ?? null;
if (!LABEL) throw new Error('用法：real-config-readout.mjs <标签> [输出 JSON 路径]');
const BUNDLE = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
const SRC_DIR = path.join(ROOT, '.trivium');
const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');

const proj = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-realcfg-'));
const readout = { label: LABEL, bundle_sha256: await sha(BUNDLE), config_sha256: {}, doctor: null, preflight: null };
try {
  execFileSync('git', ['init', '-q'], { cwd: proj });
  await fs.writeFile(path.join(proj, 'x.txt'), 'x\n');
  execFileSync('git', ['add', 'x.txt'], { cwd: proj });
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'], { cwd: proj });
  await fs.mkdir(path.join(proj, '.trivium'), { recursive: true });
  const BASE = '9cc9249';
  for (const name of ['config.yaml', 'config.local.yaml']) {
    const dst = path.join(proj, '.trivium', name);
    if (LABEL === 'before' && name === 'config.yaml') {
      const text = execFileSync('git', ['show', `${BASE}:.trivium/config.yaml`], { cwd: ROOT, encoding: 'utf8' });
      await fs.writeFile(dst, text, 'utf8');
      readout.config_source = `git show ${BASE}:.trivium/config.yaml`;
    } else {
      await fs.copyFile(path.join(SRC_DIR, name), dst);
    }
    readout.config_sha256[name] = await sha(dst);
  }
  const deprecatedLines = (await fs.readFile(path.join(proj, '.trivium', 'config.yaml'), 'utf8'))
    .split('\n').filter((l) => /^\s*(max_check_retries|readonly_commands)\s*:/.test(l)).map((l) => l.trim());
  readout.config_yaml_deprecated_lines = deprecatedLines;

  const d = spawnSync(process.execPath, [BUNDLE, 'doctor', '--only', 'env', '--no-model-calls', '--json'], {
    cwd: proj, encoding: 'utf8', timeout: 180_000,
  });
  const dj = JSON.parse(d.stdout);
  readout.doctor = { exit: d.status, ok: dj.ok, warnings: dj.warnings, blockers: dj.blockers };
  readout.build_stamp = (dj.notes ?? []).find((n) => n.startsWith('编排器构建标识')) ?? null;

  const p = spawnSync(process.execPath, [
    BUNDLE, 'preflight', '--stage', 'all', '--critics', 'codex,gemini,glm', '--skip-auth-check', '--json',
  ], { cwd: proj, encoding: 'utf8', timeout: 300_000 });
  const pj = JSON.parse(p.stdout);
  readout.preflight = {
    exit: p.status,
    ok: pj.ok,
    checks: pj.checks.map((c) => ({ name: c.name, ok: c.ok, warn: c.warn ?? false })),
    warnings: pj.warnings,
  };
} finally {
  await fs.rm(proj, { recursive: true, force: true });
}
const dep = (arr) => (arr ?? []).filter((w) => (typeof w === 'string' ? w : w.detail).includes('已废弃的键'));
console.log(`[${LABEL}] ${readout.build_stamp ?? '（构建标识缺失）'}`);
console.log(`[${LABEL}] config.yaml 里的已废弃键行：${readout.config_yaml_deprecated_lines.join('、') || '（无）'}`);
console.log(`[${LABEL}] doctor exit=${readout.doctor.exit} 已废弃键提示 ${dep(readout.doctor.warnings).length} 条${dep(readout.doctor.warnings).length ? '：' + dep(readout.doctor.warnings)[0] : ''}`);
console.log(`[${LABEL}] preflight exit=${readout.preflight.exit} ok=${readout.preflight.ok} 已废弃配置键 ${dep(readout.preflight.warnings).length} 条；检查项：${readout.preflight.checks.map((c) => `${c.ok ? (c.warn ? '⚠' : '✓') : '✗'}${c.name}`).join(' ')}`);
if (OUT) await fs.writeFile(OUT, JSON.stringify(readout, null, 2) + '\n');
