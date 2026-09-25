#!/usr/bin/env node
/**
 * 3-1 轮 §7.3.1 两条 plan 阶段形态的 Hook 探针：把 PreToolUse 负载直接喂给**夹具**的
 * `gate hook-pre-write`（与夹具 `.claude/settings.json` 里的 Hook 同一入口、同一 CLAUDE_PROJECT_DIR），
 * 记录退出码与 stderr。只读夹具，只写本目录 `02-hook-probe-<phase>.json`。
 *
 *   node hook-probe.mjs <fixture> <phase>
 *     phase = before-review：原稿已写、尚未送审 → 刷新原稿应放行（退 0）
 *     phase = in-review：审查中 → 写 Hook 只拦业务文件；原稿未登记，锚②尚未生效
 *     phase = at-gate-*：成功收尾后原稿已登记 → 改原稿本身写 Hook 放行，但 pre-commit 按锚②退 2
 */
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [fixture, phase] = process.argv.slice(2);
if (!fixture || !phase) {
  console.error('用法：node hook-probe.mjs <fixture> <phase>');
  process.exit(64);
}
const TOPIC = '限流器重构';
const planDir = path.join(fixture, '.reviews', TOPIC, 'plan');
const names = (await fs.readdir(planDir)).sort();
const draft = names.find((n) => /^\d{4}-\d{2}-\d{2}-.+-claude\.md$/.test(n) && !/-(revised|response)-/.test(n));
if (!draft) {
  console.error(`plan 目录里没有 claude 原稿：${names.join(', ')}`);
  process.exit(1);
}
const draftAbs = path.join(planDir, draft);
const revisedAbs = path.join(planDir, draft.replace(/-claude\.md$/, '-revised-claude.md'));
const wrapper = path.join(fixture, '.trivium', 'bin', 'trivium');

const samples = [
  { id: 'write-draft', tool_name: 'Write', tool_input: { file_path: draftAbs, content: '# 刷新\n' } },
  { id: 'edit-draft', tool_name: 'Edit', tool_input: { file_path: draftAbs, old_string: 'a', new_string: 'b' } },
  { id: 'write-revised', tool_name: 'Write', tool_input: { file_path: revisedAbs, content: '# 裁决\n' } },
  { id: 'write-business', tool_name: 'Write', tool_input: { file_path: path.join(fixture, 'src', 'limiter.ts'), content: '' } },
];

// 锚②：原稿成功收尾时登记进 run.json artifacts[]，之后由 pre-commit / approve 复核按 sha256 拦（写 Hook 本就不拦原稿）
samples.push({ id: 'commit', hook: 'hook-pre-commit', tool_name: 'Bash', tool_input: { command: 'git commit -m probe' } });

const results = samples.map((s) => {
  const payload = { hook_event_name: 'PreToolUse', tool_name: s.tool_name, tool_input: s.tool_input, cwd: fixture };
  const r = spawnSync(wrapper, ['gate', s.hook ?? 'hook-pre-write'], {
    cwd: fixture,
    input: JSON.stringify(payload),
    env: { ...process.env, CLAUDE_PROJECT_DIR: fixture },
    encoding: 'utf8',
  });
  const target = s.tool_input.file_path ? path.relative(fixture, s.tool_input.file_path) : s.tool_input.command;
  return { id: s.id, hook: s.hook ?? 'hook-pre-write', tool: s.tool_name, target, exit: r.status, stderr: (r.stderr ?? '').trim().slice(0, 1200) };
});

const out = { at: new Date().toISOString(), fixture, phase, draft, results };
await fs.writeFile(path.join(HERE, `02-hook-probe-${phase}.json`), JSON.stringify(out, null, 2) + '\n', 'utf8');
for (const r of results) console.log(`${r.id.padEnd(15)} ${r.tool.padEnd(5)} exit=${r.exit}  ${r.stderr.split('\n')[0] ?? ''}`);
