#!/usr/bin/env node
// M11 第 1 步 · agy 档位 slug 回读探针。用法：node 本文件 〈仓库根〉 〈证据目录〉 〈临时根（scratchpad）〉
// 经项目自己的 invokeAgy（buildAgyArgs 同一组参数），临时目录作 cwd，每格一次最小调用。
// 证据只记退出码、parsed.model（回执里的生效模型）、事件类型与带 effort 字样的键值，不落原文。
import { promises as fs } from 'node:fs';
import path from 'node:path';

const [root, outDir, tmpBase] = process.argv.slice(2).map((p) => path.resolve(p));
const A = await import(path.join(root, 'dist/test/src/trivium/adapters/agy.js'));
const bin = process.env.AGY_BIN;
const cells = [
  { id: 'a1', model: 'gemini-3.8-flash-low', effort: null },
  { id: 'a2', model: 'gemini-3.8-flash-medium', effort: null },
  { id: 'a3', model: 'gemini-3.8-flash-high', effort: 'low' },
];
const pick = (s) => [...new Set([...s.matchAll(/"([A-Za-z_]*(?:effort|Effort|thinking|Thinking|model|Model)[A-Za-z_]*)"\s*:\s*("[^"]{0,60}"|[0-9.]+|true|false|null)/g)].map((m) => `${m[1]}=${m[2]}`))];
const results = [];
for (const c of cells) {
  const tmp = await fs.mkdtemp(path.join(tmpBase, 'trivium-m11agy-'));
  const o = await A.invokeAgy({
    bin, cwd: tmp, prompt: 'Reply with exactly one word: OK. Do not use any tool.',
    model: c.model, effort: c.effort, timeoutMs: 180_000,
  });
  const rec = {
    ...c,
    args_effort_passed: A.buildAgyArgs({ prompt: 'x', model: c.model, effort: c.effort }).includes('--effort'),
    exit_code: o.exitCode,
    timed_out: o.timedOut,
    duration_s: Math.round(o.durationMs / 100) / 10,
    parsed_model: o.parsed.model ?? null,
    keys: pick(o.stdout),
    stderr_tail: o.exitCode === 0 ? null : o.stderr.trim().split('\n').slice(-2).join(' ｜ ').slice(0, 300),
  };
  results.push(rec);
  console.log(JSON.stringify(rec));
  await fs.rm(tmp, { recursive: true, force: true });
}
await fs.writeFile(path.join(outDir, 'agy-tier-cells.json'), JSON.stringify(results, null, 2) + '\n');
