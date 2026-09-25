#!/usr/bin/env node
/**
 * M10b r5 §7.3.2 Hook 退出码对照装置（3-2 轮 J3）。
 *
 * 把同一组 PreToolUse 输入分别喂给 M9 时代构建（`f4f3970` 导出物，登记见
 * `../m10b-m9-baseline-20260925/baseline-registration.json`）与当前安装副本（夹具 wrapper），比较退出码。
 * 两侧同一夹具、同一 `CLAUDE_PROJECT_DIR`、同一 cwd。装置只读夹具与两份产物，只写本目录
 * `02-hook-parity-<phase>.json`；样本（含「写形态 + 角色后缀」）只存在于本文件，不进任何 Bash 命令文本（r5 §9 第 11 行）。
 *
 *   node hook-parity.mjs <fixture> <phase>
 */
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [fixture, phase] = process.argv.slice(2);
if (!fixture || !phase) {
  console.error('用法：node hook-parity.mjs <fixture> <phase>');
  process.exit(64);
}
const reg = JSON.parse(await fs.readFile(path.join(HERE, '..', 'm10b-m9-baseline-20260925', 'baseline-registration.json'), 'utf8'));
const m9Cli = reg.cli_path;
const m9Sha = createHash('sha256').update(await fs.readFile(m9Cli)).digest('hex');
if (m9Sha !== reg.cli_sha256) {
  console.error(`M9 基线产物摘要与登记不符：${m9Sha} ≠ ${reg.cli_sha256}`);
  process.exit(1);
}
const curWrapper = path.join(fixture, '.trivium', 'bin', 'trivium');

const T = '限流器重构';
const A = (...p) => path.join(fixture, ...p);
const plan = (n) => A('.reviews', T, 'plan', n);
const code = (n) => A('.reviews', T, 'code', n);
const D = '2026-09-25';

/** whitelist：M9 → 当前允许出现的差异（r5 §7.3 表），形如 { m9, cur, row } */
const D3 = { m9: 0, cur: 2, row: 'Bash 侧角色后缀全集字面保护（D3）' };
const samples = [
  // ── Write / Edit（hook-pre-write）──
  { id: 'W1-business', hook: 'hook-pre-write', tool: 'Write', input: { file_path: A('src', 'limiter.ts'), content: '' } },
  { id: 'W2-new-business', hook: 'hook-pre-write', tool: 'Write', input: { file_path: A('src', 'new.ts'), content: '' } },
  { id: 'W3-critic-doc-code', hook: 'hook-pre-write', tool: 'Write', input: { file_path: code(`${D}-${T}-codex.md`), content: '' } },
  { id: 'W4-critic-doc-plan-existing', hook: 'hook-pre-write', tool: 'Edit', input: { file_path: plan(`${D}-${T}-gemini.md`), old_string: 'a', new_string: 'b' } },
  { id: 'W5-response-claude', hook: 'hook-pre-write', tool: 'Write', input: { file_path: code(`${D}-${T}-response-claude.md`), content: '' } },
  { id: 'W6-plan-draft-claude', hook: 'hook-pre-write', tool: 'Edit', input: { file_path: plan(`${D}-${T}-claude.md`), old_string: 'a', new_string: 'b' } },
  { id: 'W7-meta-run', hook: 'hook-pre-write', tool: 'Write', input: { file_path: plan('_meta/run-20260925T153032Z.json'), content: '{}' } },
  { id: 'W8-task-json', hook: 'hook-pre-write', tool: 'Write', input: { file_path: A('.reviews', T, 'task.json'), content: '{}' } },
  { id: 'W9-state-json', hook: 'hook-pre-write', tool: 'Write', input: { file_path: A('.trivium', 'state.json'), content: '{}' } },
  { id: 'W10-suffix-outside-archive', hook: 'hook-pre-write', tool: 'Write', input: { file_path: A('doc', 'x-codex.md'), content: '' } },
  { id: 'W11-glm-suffix-archive', hook: 'hook-pre-write', tool: 'Write', input: { file_path: code(`${D}-${T}-glm.md`), content: '' } },
  // ── Bash（hook-pre-bash）──
  { id: 'B1-redirect-claude-suffix', hook: 'hook-pre-bash', tool: 'Bash', input: { command: `echo x > .reviews/${T}/code/${D}-${T}-response-claude.md` }, whitelist: D3 },
  { id: 'B2-cat-claude-suffix', hook: 'hook-pre-bash', tool: 'Bash', input: { command: `cat .reviews/${T}/plan/${D}-${T}-claude.md` } },
  { id: 'B3-git-add-claude-suffix', hook: 'hook-pre-bash', tool: 'Bash', input: { command: `git add .reviews/${T}/plan/${D}-${T}-revised-claude.md` } },
  { id: 'B4-rm-meta', hook: 'hook-pre-bash', tool: 'Bash', input: { command: `rm .reviews/${T}/plan/_meta/brief-codex-20260925T153032Z.md` } },
  { id: 'B5-redirect-business', hook: 'hook-pre-bash', tool: 'Bash', input: { command: 'echo x > src/limiter.ts' } },
  { id: 'B6-sed-i-codex', hook: 'hook-pre-bash', tool: 'Bash', input: { command: `sed -i '' s/a/b/ .reviews/${T}/plan/${D}-${T}-codex.md` } },
  { id: 'B7-ls', hook: 'hook-pre-bash', tool: 'Bash', input: { command: 'ls -la' } },
  { id: 'B8-redirect-state', hook: 'hook-pre-bash', tool: 'Bash', input: { command: 'echo x > .trivium/state.json' } },
  { id: 'B9-tee-gemini', hook: 'hook-pre-bash', tool: 'Bash', input: { command: `echo x | tee .reviews/${T}/code/${D}-${T}-gemini.md` } },
  { id: 'B10-mv-claude-suffix', hook: 'hook-pre-bash', tool: 'Bash', input: { command: `mv /tmp/x .reviews/${T}/plan/${D}-${T}-revised-claude.md` }, whitelist: D3 },
  { id: 'B11-node-test', hook: 'hook-pre-bash', tool: 'Bash', input: { command: 'node --test test/limiter.test.ts' } },
  // ── 提交（hook-pre-commit）──
  { id: 'C1-git-commit', hook: 'hook-pre-commit', tool: 'Bash', input: { command: 'git commit -m x' } },
  // ── 收工（hook-stop）──
  { id: 'S1-stop', hook: 'hook-stop', tool: null, input: null },
];

function runHook(side, s) {
  const payload = s.tool
    ? { hook_event_name: 'PreToolUse', tool_name: s.tool, tool_input: s.input, cwd: fixture }
    : { hook_event_name: 'Stop', stop_hook_active: false, cwd: fixture };
  const [bin, args] = side === 'm9' ? [process.execPath, [m9Cli, 'gate', s.hook]] : [curWrapper, ['gate', s.hook]];
  const r = spawnSync(bin, args, {
    cwd: fixture,
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: fixture, TRIVIUM_ASSET_ROOT: '' },
    encoding: 'utf8',
  });
  return { exit: r.status, stderr: (r.stderr ?? '').trim().split('\n').slice(0, 3).join(' ⏎ ').slice(0, 400) };
}

const rows = samples.map((s) => {
  const m9 = runHook('m9', s);
  const cur = runHook('cur', s);
  const same = m9.exit === cur.exit;
  const wl = !same && s.whitelist && s.whitelist.m9 === m9.exit && s.whitelist.cur === cur.exit ? s.whitelist.row : null;
  return { id: s.id, hook: s.hook, tool: s.tool, target: s.input?.file_path ? path.relative(fixture, s.input.file_path) : s.input?.command ?? null, m9_exit: m9.exit, cur_exit: cur.exit, same, whitelisted: wl, verdict: same || wl ? 'ok' : 'REGRESSION?', m9_stderr: m9.stderr, cur_stderr: cur.stderr };
});

const out = { at: new Date().toISOString(), phase, fixture, m9: { cli: m9Cli, sha256: m9Sha, commit: reg.commit }, cur: { wrapper: curWrapper }, rows };
await fs.writeFile(path.join(HERE, `02-hook-parity-${phase}.json`), JSON.stringify(out, null, 2) + '\n', 'utf8');
for (const r of rows) console.log(`${r.id.padEnd(30)} m9=${String(r.m9_exit).padEnd(3)} cur=${String(r.cur_exit).padEnd(3)} ${r.verdict}${r.whitelisted ? `（白名单：${r.whitelisted}）` : ''}`);
const bad = rows.filter((r) => r.verdict !== 'ok');
if (bad.length) for (const r of bad) console.log(`\n[${r.id}]\n  m9 : ${r.m9_stderr}\n  cur: ${r.cur_stderr}`);
