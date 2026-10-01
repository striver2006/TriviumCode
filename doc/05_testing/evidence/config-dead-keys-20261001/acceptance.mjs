#!/usr/bin/env node
/**
 * 「两个空配置项收口」（EV-30 ① / EV-15）兼容验收（计划 r2 §6「兼容验收」，零配额）。
 *
 * 四格：旧构建 / 新构建 × 配置带两个已废弃键 / 不带。每格在一个新的临时 git 仓库里写 `.trivium/config.yaml`，
 * 直接 `node <bundle> doctor --only env --no-model-calls --json`（只跑环境段，不碰任何审查员 CLI）。
 *
 * 期望：四格都退 0、stderr 不出现「配置不合法」；只有「新 × 带」的 warnings 里有已废弃键的提示，且只列这两个键。
 *
 * **旧构建的获取路径**（计划双审 CODEX-01 / GLM-03）：`git archive <BASE>` 解到 mkdtemp 目录，`node_modules` 软链到本仓工作树
 * （不联网、不 npm ci），在归档目录里跑 `node scripts/build.mjs` 得到 `skills/dual-critic/scripts/trivium.cjs`。
 * 不用已安装的全局副本当旧构建：它随用户重装而变，不钉在提交上。
 * 新构建取本仓工作树的同名产物（先 `npm run build`）。两份 bundle 记 sha256 并断言不同。
 *
 * 用法（在仓库根）：node doc/05_testing/evidence/config-dead-keys-20261001/acceptance.mjs [输出 JSON 路径]
 * 清理：只删本脚本 mkdtemp 返回的目录（R1）。
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const BASE = '9cc9249';
const ROOT = process.cwd();
const OUT = process.argv[2] ?? null;
const NEW_BUNDLE = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');
const made = [];
const tmp = async (prefix) => {
  const d = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
};

const WITH = [
  'schema: trivium.config.v2',
  'gate:',
  '  max_check_retries: 3',
  'agents:',
  '  gemini:',
  '    vendor: antigravity',
  '    bin: null',
  '    agent: trivium-critic',
  '    effort: { plan: high, code: high, bug: high }',
  '    readonly_commands: [git log, ls]',
  '',
].join('\n');
const WITHOUT = [
  'schema: trivium.config.v2',
  'gate:',
  '  stop_hook_max_blocks: 2',
  'agents:',
  '  gemini:',
  '    vendor: antigravity',
  '    bin: null',
  '    agent: trivium-critic',
  '    effort: { plan: high, code: high, bug: high }',
  '',
].join('\n');

const readout = { base: BASE, bundles: {}, cells: [], pass: 0, total: 0 };
try {
  // ── 旧构建 ──
  const oldRoot = await tmp('trivium-acc-old-');
  execFileSync('sh', ['-c', `git archive ${BASE} | tar -x -C "${oldRoot}"`], { cwd: ROOT });
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(oldRoot, 'node_modules'));
  execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: oldRoot, stdio: 'ignore' });
  const OLD_BUNDLE = path.join(oldRoot, 'skills/dual-critic/scripts/trivium.cjs');
  readout.bundles = {
    old: { commit: BASE, sha256: await sha(OLD_BUNDLE) },
    new: { commit: 'working-tree', sha256: await sha(NEW_BUNDLE) },
  };
  if (readout.bundles.old.sha256 === readout.bundles.new.sha256) throw new Error('新旧 bundle 哈希相同：新构建没包含本主题改动');

  for (const [bname, bundle] of [['old', OLD_BUNDLE], ['new', NEW_BUNDLE]]) {
    for (const [cname, yaml] of [['with', WITH], ['without', WITHOUT]]) {
      const proj = await tmp(`trivium-acc-${bname}-${cname}-`);
      execFileSync('git', ['init', '-q'], { cwd: proj });
      await fs.mkdir(path.join(proj, '.trivium'), { recursive: true });
      await fs.writeFile(path.join(proj, '.trivium/config.yaml'), yaml, 'utf8');
      const r = spawnSync(process.execPath, [bundle, 'doctor', '--only', 'env', '--no-model-calls', '--json'], {
        cwd: proj, encoding: 'utf8', timeout: 120_000,
      });
      let json = null;
      try { json = JSON.parse(r.stdout); } catch { /* 留给判定 */ }
      const notices = (json?.warnings ?? []).filter((w) => w.includes('已废弃的键'));
      const invalid = /配置不合法/.test(r.stderr ?? '') || /配置不合法/.test(r.stdout ?? '');
      const wantNotice = bname === 'new' && cname === 'with';
      const checks = {
        exit0: r.status === 0,
        json_ok: json !== null,
        no_invalid: !invalid,
        notice: wantNotice
          ? notices.length === 1 && notices[0].includes('已废弃的键：gate.max_check_retries、agents.gemini.readonly_commands。')
          : notices.length === 0,
      };
      const ok = Object.values(checks).every(Boolean);
      // 构建标识（git_head、dirty、inputs 哈希）：bundle 哈希每次构建都变，对不上源码（代码双审 r1 CODEX-04）
      const buildStamp = (json?.notes ?? []).find((n) => n.startsWith('编排器构建标识')) ?? null;
      readout.bundles[bname].build_stamp ??= buildStamp;
      readout.cells.push({ bundle: bname, config: cname, exit: r.status, checks, ok, notices, build_stamp: buildStamp, stderr_tail: (r.stderr ?? '').split('\n').slice(-5) });
      readout.total += 1;
      if (ok) readout.pass += 1;
      console.log(`${ok ? '✓' : '✗'} ${bname} × ${cname}：exit=${r.status} ${JSON.stringify(checks)}${notices.length ? ' ｜ ' + notices[0] : ''}`);
    }
  }
} finally {
  for (const d of made) await fs.rm(d, { recursive: true, force: true });
}
console.log(`结果：${readout.pass}/${readout.total}`);
if (OUT) await fs.writeFile(OUT, JSON.stringify(readout, null, 2) + '\n');
process.exit(readout.pass === readout.total ? 0 : 1);
