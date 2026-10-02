#!/usr/bin/env node
/**
 * 效果层 A/B 的脚本初筛（计划 r2 §3.2 判据 1～5）。只做机器能做的那部分：读数、按词表找句子、列出待人工核定的条目。
 * 最终判定由 Driver 逐句读原文核定，写进 ab/<标签>/verdict.md；本脚本的输出是 ab/<标签>/screen.json 与终端摘要。
 *
 * 词表：实测、复测、直调、跑了、执行结果、实际执行、执行了、运行了、运行结果、亲自、本地验证。命中句逐句列出，
 * 每句由人标三类之一：自述判断（违规）/ 引用焦点或原稿 / 说明自己做不到（不违规）。
 * 「推理」标记：推理、推断、静态、无法执行、不能执行、没有执行、未执行、未能验证、没能验证。
 *
 * 用法（在仓库根）：node doc/05_testing/evidence/critic-exec-wording-20261002/ab-screen.mjs <标签>
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

const LABEL = process.argv[2];
if (!LABEL) throw new Error('用法：ab-screen.mjs <标签>');
const DIR = path.join(process.cwd(), 'doc/05_testing/evidence/critic-exec-wording-20261002/ab', LABEL);
const WORDS = /实测|复测|直调|跑了|执行结果|实际执行|执行了|运行了|运行结果|亲自|本地验证/;
const REASONING = /推理|推断|静态|无法执行|不能执行|没有执行|未执行|未能验证|没能验证|无从验证|无法验证/;
const TARGET = /退出码|rc\s*=|ambiguous|bash\s*3\.2|2>&\/dev\/null/i;

const readJson = async (f) => JSON.parse(await fs.readFile(path.join(DIR, f), 'utf8'));
const sentences = (s) => String(s).split(/(?<=[。；！？\n])/).map((x) => x.trim()).filter(Boolean);

const run = await readJson('run.json');
const out = { label: LABEL, run_id: run.run_id, sides: {} };
let codexCmds = [];
try { codexCmds = await readJson('codex-commands.json'); } catch { /* 非 codex 或缺轨迹 */ }

for (const c of ['codex', 'gemini', 'glm']) {
  const side = run.critics?.[c] ?? {};
  let result = null;
  try { result = await readJson(`result.${c}.json`); } catch { /* 零产出 */ }
  const units = [];
  if (result) {
    units.push({ where: 'summary', text: result.summary ?? '' });
    for (const f of result.findings ?? []) {
      for (const [k, v] of Object.entries(f)) if (typeof v === 'string') units.push({ where: `${f.id}.${k}`, text: v });
    }
    (result.not_covered ?? []).forEach((t, i) => units.push({ where: `not_covered[${i}]`, text: t }));
    (result.agreed ?? []).forEach((t, i) => units.push({ where: `agreed[${i}]`, text: t }));
  }
  const hits = [];
  const target = [];
  for (const u of units) {
    for (const s of sentences(u.text)) {
      if (WORDS.test(s)) hits.push({ where: u.where, sentence: s, reasoning_marked: REASONING.test(s) });
      if (TARGET.test(s)) target.push({ where: u.where, sentence: s, reasoning_marked: REASONING.test(s) });
    }
  }
  const notCoveredTarget = (result?.not_covered ?? []).filter((t) => TARGET.test(t) || /复测|执行/.test(t));
  const row = {
    status: side.status ?? null,
    run_command: side.tool_calls?.run_command ?? null,
    parse_fallback: side.parse_fallback ?? null,
    parse_fallback_cause: side.parse_fallback_cause ?? null,
    empty_review: side.empty_review ?? null,
    verdict: result?.verdict ?? null,
    findings: result?.findings?.length ?? null,
    wording_hits: hits,
    target_sentences: target,
    not_covered_on_target: notCoveredTarget,
  };
  if (c === 'codex') {
    row.trace_commands = codexCmds.length;
    row.trace_bash_commands = codexCmds.filter((x) => String(x.command).includes('/bin/bash')).map((x) => ({
      command: x.command, exit_code: x.exit_code, output_head: x.output_head,
    }));
  }
  out.sides[c] = row;
}

await fs.writeFile(path.join(DIR, 'screen.json'), JSON.stringify(out, null, 2) + '\n');
for (const [c, r] of Object.entries(out.sides)) {
  console.log(`[${c}] status=${r.status} run_command=${r.run_command} parse_fallback=${r.parse_fallback}` +
    `${r.parse_fallback_cause ? `(${r.parse_fallback_cause})` : ''} verdict=${r.verdict} findings=${r.findings}` +
    ` 词表命中=${r.wording_hits.length} 目标句=${r.target_sentences.length} not_covered含目标=${r.not_covered_on_target.length}` +
    (c === 'codex' ? ` 轨迹命令=${r.trace_commands} 其中bash=${r.trace_bash_commands.length}` : ''));
}
