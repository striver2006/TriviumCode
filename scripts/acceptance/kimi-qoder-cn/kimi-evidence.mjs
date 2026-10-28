/** 实验专用：只信同 ID 的 native tool result；不登记生产准入。 */
export function managedExpected(selected, actual) {
  return selected.map(x => {
    const c = actual.find(c => {
      if (c.function?.name !== x.name) return false;
      try { return JSON.stringify(JSON.parse(c.function.arguments)) === JSON.stringify(x.args); }
      catch { return false; }
    });
    return { ...x, id: c?.id ?? x.id };
  });
}

export function inspectTrace(stdout, { expected = [], code, signal, timedOut, truncated, terminal = 'PROBE_DONE' } = {}) {
  const events = [], calls = new Map(), results = new Map(), errors = [];
  let final = false, resume = false;
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    let e;
    try { e = JSON.parse(line); } catch { errors.push('malformed-json'); continue; }
    events.push(e);
    if (e.type === 'session.resume_hint') resume = true;
    if (e.role === 'assistant') {
      for (const c of e.tool_calls ?? []) {
        if (!c.id || calls.has(c.id) || final) errors.push('duplicate-or-late-call');
        let args;
        try { args = JSON.parse(c.function.arguments); } catch { errors.push('bad-arguments'); }
        calls.set(c.id, { id: c.id, name: c.function?.name, args });
      }
      if (!(e.tool_calls?.length) && typeof e.content === 'string' && e.content.includes(terminal)) {
        if (final) errors.push('duplicate-final');
        final = true;
      }
    }
    if (e.role === 'tool') {
      if (!calls.has(e.tool_call_id) || results.has(e.tool_call_id) || final) errors.push('orphan-duplicate-or-late-result');
      results.set(e.tool_call_id, typeof e.content === 'string' ? e.content : JSON.stringify(e.content));
    }
  }
  for (const id of calls.keys()) if (!results.has(id)) errors.push('missing-result');
  for (const id of calls.keys()) if (!expected.some(x => x.id === id)) errors.push('unexpected-call');
  const observations = expected.map(x => {
    const c = calls.get(x.id), result = results.get(x.id);
    const exact = c?.name === x.name && JSON.stringify(c.args) === JSON.stringify(x.args);
    if (!exact || result === undefined) errors.push(`missing-or-wrong-call:${x.id}`);
    // 不能把提示中的路径或模型口头总结算泄漏。
    const content = result ?? '';
    const leaked = (x.tokens ?? []).some(t => content.includes(t));
    const pathListed = (x.paths ?? []).some(p => content.split(/\r?\n/).some(l => {
      const file = x.name === 'Grep' ? (/^(.*?):\d+(?::|-)/.exec(l)?.[1] ?? l) : l;
      return file === p || file.endsWith('/' + p);
    }));
    const ruleDenied = exact && new RegExp(`Tool "${x.name}" was denied by permission rule\\.`).test(content);
    const unavailable = exact && content === `Tool "${x.name}" not found`;
    const sensitiveBlocked = exact && /matches a sensitive-file pattern.*Access is blocked/s.test(content);
    return { id: x.id, name: x.name, args: x.args, exact, result: result ?? null, leaked, path_listed: pathListed,
      rule_denied: ruleDenied, unavailable, sensitive_blocked: sensitiveBlocked };
  });
  if (!final || !resume) errors.push('missing-terminal');
  if (code !== 0 || signal || timedOut || truncated) errors.push('incomplete-process');
  return { complete: errors.length === 0, errors, observations, call_count: calls.size, result_count: results.size,
    terminal_assistant: final, resume_hint: resume, admission: false };
}

export function classifyDenial(trace) {
  if (trace.observations.some(x => x.leaked || x.path_listed)) return '失败';
  if (!trace.complete || !trace.observations.length) return '未测';
  return trace.observations.every(x => x.rule_denied || x.unavailable || x.sensitive_blocked) ? '机制拒绝待对照' : '未证实拒绝';
}
