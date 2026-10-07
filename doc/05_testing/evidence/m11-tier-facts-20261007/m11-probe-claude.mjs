#!/usr/bin/env node
// M11 第 1 步 · claude 思考等级探针。用法：node 本文件 〈证据目录〉 〈临时根（scratchpad）〉
// 每格一次最小调用：临时目录作 cwd、只载 project 设置源（该目录没有）、关全部工具、strict MCP、不持久化会话。
// 证据只记事件类型、带 effort / thinking 字样的键与值、init 的 model、result 的用量摘要；不落原文。
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

const [outDir, tmpBase] = process.argv.slice(2).map((p) => path.resolve(p));
const bin = process.env.CLAUDE_BIN;
const cells = [
  { id: 'c0', model: 'claude-sonnet-5', effort: null },
  { id: 'c1', model: 'claude-sonnet-5', effort: 'low' },
  { id: 'c2', model: 'claude-sonnet-5', effort: 'max' },
  { id: 'c3', model: 'claude-haiku-4-5-20251001', effort: 'high' },
  { id: 'c4', model: 'claude-sonnet-5', effort: 'bogus' },
];
const runOnce = (args, cwd) => new Promise((resolve) => {
  const p = spawn(bin, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '';
  const t = setTimeout(() => p.kill('SIGTERM'), 180_000);
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { err += d; });
  p.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
});
const pick = (s) => [...new Set([...s.matchAll(/"([A-Za-z_]*(?:effort|Effort|thinking|Thinking)[A-Za-z_]*)"\s*:\s*("[^"]*"|[0-9.]+|true|false|null|\{|\[)/g)].map((m) => `${m[1]}=${m[2]}`))];

const results = [];
for (const c of cells) {
  const tmp = await fs.mkdtemp(path.join(tmpBase, 'trivium-m11claude-'));
  const args = ['-p', 'Reply with exactly one word: OK.', '--output-format', 'stream-json', '--verbose',
    '--model', c.model, '--setting-sources', 'project', '--tools', '', '--strict-mcp-config',
    '--no-session-persistence', ...(c.effort ? ['--effort', c.effort] : [])];
  const r = await runOnce(args, tmp);
  const events = r.out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const result = events.find((e) => e.type === 'result');
  const rec = {
    ...c,
    exit_code: r.code,
    event_types: [...new Set(events.map((e) => `${e.type}${e.subtype ? '/' + e.subtype : ''}`))],
    init_model: init?.model ?? null,
    init_keys: init ? Object.keys(init).sort() : null,
    effort_like_keys_stdout: pick(r.out),
    result_subtype: result?.subtype ?? null,
    result_is_error: result?.is_error ?? null,
    result_text: typeof result?.result === 'string' ? result.result.slice(0, 40) : null,
    model_usage: result?.modelUsage ? Object.fromEntries(Object.entries(result.modelUsage).map(([m, u]) => [m, { output: u.outputTokens ?? null, cost: u.costUSD ?? null }])) : null,
    stderr_tail: r.code === 0 ? null : r.err.trim().split('\n').slice(-3).join(' ｜ ').slice(0, 300),
    stdout_head_if_no_events: events.length === 0 ? r.out.slice(0, 200) : null,
  };
  results.push(rec);
  console.log(JSON.stringify({ id: c.id, exit: rec.exit_code, init_model: rec.init_model, effort_keys: rec.effort_like_keys_stdout, err: rec.stderr_tail }));
  await fs.rm(tmp, { recursive: true, force: true });
}
await fs.writeFile(path.join(outDir, 'claude-effort-cells.json'), JSON.stringify(results, null, 2) + '\n');
