#!/usr/bin/env node
/**
 * 「MCP执行工具调用检测」（EV-188）计划 r2 §1.5 / §1.4 的历史扫描（零配额、只读）。
 *
 * 1. 按 rollout 的 `response.toolCalls` 精确统计一个运行根桶下全部保留的 glm 侧 rollout 副本（`<run>/glm/out/rollout.jsonl`）：
 *    运行数、有 node_repl 调用的运行数、调用次数、其余 `mcp__` 调用次数；分三个时间窗（全部 / 2026-09-26 起 / 2026-10-01 起），
 *    另列每个有调用的运行的次数。**只出计数与工具名，不出参数原文**。
 * 2. 非 MCP 的表外内置工具（Read / Grep / Glob 之外）按名计数。
 * 3. 会话日志与 rollout 的调用 id 对应（计划 r2 §7 更正 1）：对命令行给的运行逐个核两边 id 集合是否相同、工具名是否一致。
 *
 * 用法（在仓库根）：node history-scan.mjs [运行根桶目录或 -] [逐个核 id 的 run_id …]
 *   缺省桶（不给或给 -）：~/.trivium/runs/TriviumCode-2217d505。桶不在时**软跳过**、输出「已跳过：原件不在」并退 0（计划双审 CODEX-03）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BUCKET = !process.argv[2] || process.argv[2] === '-' ? path.join(os.homedir(), '.trivium/runs/TriviumCode-2217d505') : process.argv[2];
const ID_RUNS = process.argv.slice(3);
if (!fs.existsSync(BUCKET)) {
  console.log(JSON.stringify({ skipped: true, reason: `已跳过：原件不在（${BUCKET}）` }, null, 2));
  process.exit(0);
}

const jsonl = (f) =>
  fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('{')).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });

const rows = [];
const offList = {};
for (const run of fs.readdirSync(BUCKET).sort()) {
  const f = path.join(BUCKET, run, 'glm/out/rollout.jsonl');
  if (!fs.existsSync(f)) continue;
  let repl = 0;
  let otherMcp = 0;
  for (const o of jsonl(f)) {
    for (const c of o?.response?.toolCalls ?? []) {
      const n = String(c.name);
      if (n === 'mcp__node_repl__js' || n.startsWith('mcp__node_repl__')) repl++;
      else if (n.startsWith('mcp__')) otherMcp++;
      else if (!['Read', 'Grep', 'Glob'].includes(n)) offList[n] = (offList[n] ?? 0) + 1;
    }
  }
  rows.push({ run, repl, otherMcp });
}
const win = (from) => {
  const r = rows.filter((x) => x.run >= from);
  return {
    from, runs: r.length, withNodeRepl: r.filter((x) => x.repl > 0).length,
    nodeReplCalls: r.reduce((a, x) => a + x.repl, 0), otherMcpCalls: r.reduce((a, x) => a + x.otherMcp, 0),
  };
};

const idCheck = ID_RUNS.map((run) => {
  const H = path.join(BUCKET, run, 'glm');
  const roFile = path.join(H, 'out/rollout.jsonl');
  const logDir = path.join(H, 'home/.zcode/cli/log');
  if (!fs.existsSync(roFile) || !fs.existsSync(logDir)) return { run, skipped: '已跳过：原件不在' };
  const ro = new Map();
  for (const o of jsonl(roFile)) for (const c of o?.response?.toolCalls ?? []) ro.set(c.id, c.name);
  const lg = new Map();
  for (const f of fs.readdirSync(logDir).filter((x) => x.endsWith('.jsonl'))) {
    for (const o of jsonl(path.join(logDir, f))) if (o.event === 'tool.call.started') lg.set(o.toolCallId, o.context?.toolName);
  }
  return {
    run,
    rolloutCalls: ro.size,
    logStartedIds: lg.size,
    onlyInRollout: [...ro.keys()].filter((k) => !lg.has(k)).length,
    onlyInLog: [...lg.keys()].filter((k) => !ro.has(k)).length,
    nameMismatch: [...ro.keys()].filter((k) => lg.has(k) && lg.get(k) !== ro.get(k)).length,
    mcpInRollout: [...ro.values()].filter((n) => String(n).startsWith('mcp__')).length,
  };
});

console.log(JSON.stringify({
  bucket: BUCKET,
  windows: [win('2026'), win('20260926'), win('20261001')],
  runsWithNodeRepl: rows.filter((x) => x.repl > 0).map((x) => `${x.run}:${x.repl}`),
  offListBuiltinCalls: offList,
  idCheck,
}, null, 2));
