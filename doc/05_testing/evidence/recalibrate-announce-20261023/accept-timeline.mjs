// EV-252 真实会话验收：从夹具会话的 jsonl 抽时间线（助手文本、工具调用与工具超时、结果前 300 字；家目录归一为 ~），
// 并按计划 r2 D4 末段的三条判据机读核对。格式沿用 EV-251 的 timeline.txt。
// 用法：node accept-timeline.mjs <会话 jsonl> <timeline 输出> <判据 JSON 输出>
import { readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const [, , SRC, OUT_TL, OUT_JSON] = process.argv;
const HOME = os.homedir();
const norm = (s) => String(s).split(HOME).join('~').replace(/\n/g, ' ⏎ ');
const hhmmss = (t) => (t ? new Date(t).toISOString().slice(11, 19) : '');

const events = [];
for (const line of readFileSync(SRC, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  let e;
  try { e = JSON.parse(line); } catch { continue; }
  if (e.type !== 'user' && e.type !== 'assistant') continue;
  const t = e.timestamp ?? null;
  const content = e.message?.content;
  if (typeof content === 'string') { events.push({ t, kind: e.type === 'user' ? 'USER' : 'SAY', text: content }); continue; }
  for (const c of content ?? []) {
    if (c.type === 'text') events.push({ t, kind: e.type === 'user' ? 'USER' : 'SAY', text: c.text });
    else if (c.type === 'tool_use') events.push({ t, kind: 'CALL', id: c.id, tool: c.name, input: c.input });
    else if (c.type === 'tool_result') {
      const body = Array.isArray(c.content) ? c.content.map((x) => x.text ?? '').join('') : String(c.content ?? '');
      events.push({ t, kind: 'RESULT', id: c.tool_use_id, error: c.is_error === true, text: body });
    }
  }
}

const lines = ['# 会话时间线（助手文本、工具调用与工具超时、结果前 300 字）', `# 来源：夹具会话 ${SRC.split('/').pop()}（~/Work/trivium-ev252-accept，用户发起 /dual-review-plan）；家目录已归一 ~`];
for (const ev of events) {
  const ts = `[${hhmmss(ev.t)}]`;
  if (ev.kind === 'CALL') {
    const i = ev.input ?? {};
    const what = ev.tool === 'Bash' ? i.command : (i.file_path ?? i.pattern ?? JSON.stringify(i));
    lines.push(`${ts} CALL ${ev.tool} timeout=${i.timeout ?? '-'} bg=${i.run_in_background === true} :: ${norm(what)}`);
  } else if (ev.kind === 'RESULT') lines.push(`${ts} RESULT ${ev.error ? '(error) ' : ''}${norm(ev.text).slice(0, 300)}`);
  else lines.push(`${ts} ${ev.kind} ${norm(ev.text).slice(0, 300)}`);
}
writeFileSync(OUT_TL, lines.join('\n') + '\n');

// ── 判据 ──
const isBash = (ev) => ev.kind === 'CALL' && ev.tool === 'Bash';
const cmdOf = (ev) => String(ev.input?.command ?? '').trim();
const resultOf = (id) => events.find((x) => x.kind === 'RESULT' && x.id === id);
const pfIdx = events.map((ev, i) => (isBash(ev) && /trivium preflight /.test(cmdOf(ev)) ? i : -1)).filter((i) => i >= 0);
const docIdx = events.map((ev, i) => (isBash(ev) && /trivium doctor /.test(cmdOf(ev)) ? i : -1)).filter((i) => i >= 0);

const firstPf = pfIdx[0];
const firstPfResult = firstPf === undefined ? null : resultOf(events[firstPf].id);
let announce = null;
try { announce = JSON.parse(firstPfResult.text.slice(firstPfResult.text.indexOf('{'))).recalibration?.announce_before ?? null; } catch { /* 留 null */ }
const firstDoc = docIdx[0];
const between = firstPf === undefined || firstDoc === undefined ? [] : events.slice(firstPf + 1, firstDoc).filter((ev) => ev.kind === 'SAY');

const AFTER = '预检首次退 69，已自动校准后通过。';
const secondPf = pfIdx.find((i) => firstDoc !== undefined && i > firstDoc);
const secondPfResultIdx = secondPf === undefined ? -1 : events.findIndex((ev, i) => i > secondPf && ev.kind === 'RESULT' && ev.id === events[secondPf].id);
const firstSayAfter = secondPfResultIdx === -1 ? null : events.slice(secondPfResultIdx + 1).find((ev) => ev.kind === 'SAY') ?? null;

const EXPECT = /^\.trivium\/bin\/trivium doctor --only [a-z]+ --deadline-s \d+ --json$/;
const doctorCalls = docIdx.map((i) => {
  const r = resultOf(events[i].id);
  return {
    at: hhmmss(events[i].t), command: norm(cmdOf(events[i])), exact: EXPECT.test(cmdOf(events[i])),
    timeout: events[i].input?.timeout ?? null, background: events[i].input?.run_in_background === true,
    blocked_by_hook: r ? /PreToolUse:Bash hook error/.test(r.text) : null,
    persisted: r ? /<persisted-output>/.test(r.text) : null,
  };
});

const report = {
  source: SRC.split('/').pop(),
  preflight_calls: pfIdx.length,
  criterion_1_announce_before: {
    expected: announce,
    says_between_first_preflight_and_first_doctor: between.map((ev) => norm(ev.text)),
    pass: announce !== null && between.some((ev) => ev.text.includes(announce)),
  },
  criterion_2_after_pass_first_sentence: {
    first_say_after_second_preflight: firstSayAfter ? norm(firstSayAfter.text).slice(0, 300) : null,
    pass: firstSayAfter !== null && firstSayAfter.text.trimStart().startsWith(AFTER),
  },
  criterion_3_doctor_verbatim: {
    calls: doctorCalls,
    pass: doctorCalls.length > 0 && doctorCalls.every((c) => c.exact && !c.blocked_by_hook),
  },
  first_doctor_output_persisted: doctorCalls[0]?.persisted ?? null,
};
writeFileSync(OUT_JSON, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  c1: report.criterion_1_announce_before.pass, c2: report.criterion_2_after_pass_first_sentence.pass,
  c3: report.criterion_3_doctor_verbatim.pass, doctor_calls: doctorCalls.length, persisted_first: report.first_doctor_output_persisted,
}));
