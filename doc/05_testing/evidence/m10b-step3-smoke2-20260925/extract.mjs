#!/usr/bin/env node
/**
 * 冒烟二轮的会话留痕摘录（只读 ~/.zcode/cli/rollout，只写本目录 04-rollout-excerpt.json）。
 *
 * 入仓只收摘录（r10 §4.1 第 5 条同一口径）：每条请求的模型、**新增**的用户消息 / 系统提醒（只收含 Hook 反馈或
 * TriviumCode 字样的，或用户亲手发的）、助手发出的工具调用（名字与关键入参）、工具结果里的 Hook 拒绝原文。
 * 不收系统提示、AGENTS.md 全文与模型推理全文。
 *
 * 用法：node doc/05_testing/evidence/m10b-step3-smoke2-20260925/extract.mjs
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SESSIONS = {
  part1: '3e67d48c-f0b4-4eaa-bcfa-4ada5703d946',
  part2: '95a64b26-379c-466a-8a41-42913b7e651d',
};
const text = (c) => {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p.text ?? (typeof p.content === 'string' ? p.content : '') ?? '')).join('\n');
  return c ? JSON.stringify(c) : '';
};
const HOOKISH = /Stop hook|SessionStart|hook additional context|TriviumCode 待办|禁止写入|闸门未审批|不得修改业务文件|护栏失效/;

const out = {};
for (const [part, id] of Object.entries(SESSIONS)) {
  const p = path.join(os.homedir(), `.zcode/cli/rollout/model-io-sess_${id}.jsonl`);
  const recs = (await fs.readFile(p, 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const events = [];
  const seen = new Set();
  for (const [i, r] of recs.entries()) {
    const model = typeof r.model === 'string' ? r.model : r.model?.id ?? r.model?.modelId ?? JSON.stringify(r.model);
    const msgs = r.request?.messages ?? [];
    for (const m of msgs) {
      const role = m.role ?? m.type;
      const t = text(m.content);
      const key = `${role}:${t.slice(0, 400)}`;
      if (seen.has(key)) continue; // 请求是累积的，只收首次出现
      seen.add(key);
      if (role === 'system') {
        // 系统消息整体不收；只截取其中 Hook 注入的那一段（SessionStart 的 additionalContext 落在这里）
        const k = t.search(/SessionStart hook additional context|Stop hook additional context/);
        if (k >= 0) events.push({ req: i, role: 'system(hook)', text: t.slice(k, k + 300) });
        continue;
      }
      if (role === 'user') {
        if (/agentsMd|# agentsMd/.test(t)) { events.push({ req: i, role, note: '[AGENTS.md 注入，略]' }); continue; }
        events.push({ req: i, model, role, text: t.slice(0, 1200) });
      } else if (role === 'assistant') {
        const calls = (Array.isArray(m.content) ? m.content : []).filter((c) => c.type === 'tool_use' || c.type === 'tool-call' || c.type === 'toolCall');
        for (const c of calls) {
          const inp = c.input ?? c.args ?? c.arguments ?? {};
          events.push({ req: i, role: 'tool_call', name: c.name ?? c.toolName, input: JSON.stringify(inp).slice(0, 300) });
        }
        if (m.tool_calls) {
          for (const c of m.tool_calls) events.push({ req: i, role: 'tool_call', name: c.function?.name, input: String(c.function?.arguments ?? '').slice(0, 300) });
        }
      } else if (role === 'tool') {
        if (HOOKISH.test(t)) events.push({ req: i, role: 'tool_result(hook)', text: t.slice(0, 800) });
      }
    }
  }
  out[part] = { session: id, requests: recs.length, first_at: recs[0]?.startedAt, last_at: recs.at(-1)?.completedAt, events };
}
await fs.writeFile(path.join(HERE, '04-rollout-excerpt.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
for (const [part, v] of Object.entries(out)) {
  console.log(`== ${part} ${v.session} requests=${v.requests} ${v.first_at} → ${v.last_at}`);
  for (const e of v.events) {
    const body = e.text ?? e.note ?? `${e.name} ${e.input}`;
    console.log(`  #${e.req} ${e.role}: ${body.replace(/\s+/g, ' ').slice(0, 230)}`);
  }
}
