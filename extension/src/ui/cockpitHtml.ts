/**
 * 驾驶舱 Webview HTML（原生无框架，全中文 UI，严格 CSP）。
 *
 * 仅声明视图与消息协议；全部业务在 Extension Host 侧（cockpit.ts），
 * Webview 只 postMessage + 渲染（性能：IO 全在宿主异步侧）。
 */
export function cockpitHtml(nonce: string, cspSource: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: 13px; padding: 10px 12px 60px; margin: 0; }
  h3 { margin: 14px 0 6px; font-size: 13px; color: var(--vscode-foreground); opacity: .9; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0; }
  label { white-space: nowrap; }
  select, input[type=text], input[type=number], textarea {
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); border-radius: 3px; padding: 3px 6px;
    font-family: inherit; font-size: 12px;
  }
  textarea { width: 100%; min-height: 64px; resize: vertical; }
  .chip { display: inline-flex; align-items: center; gap: 4px; border: 1px solid var(--vscode-checkbox-border, #888);
          border-radius: 10px; padding: 1px 8px; margin: 1px 2px; cursor: pointer; }
  .chip.off { opacity: .45; cursor: not-allowed; }
  .chip.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground);
           border: none; border-radius: 3px; padding: 4px 12px; cursor: pointer; font-size: 12px; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: .5; cursor: not-allowed; }
  .banner { padding: 6px 10px; border-radius: 4px; margin: 6px 0; }
  .banner.warn { background: var(--vscode-inputValidation-warningBackground, #5a4a1a); }
  .banner.info { background: var(--vscode-inputValidation-infoBackground, #1a3a5a); }
  .cmdbar { display: flex; gap: 6px; align-items: flex-start; margin: 6px 0; }
  .cmdbar code { flex: 1; background: var(--vscode-textCodeBlock-background); padding: 6px 8px; border-radius: 4px;
                 font-family: var(--vscode-editor-font-family); font-size: 11px; word-break: break-all; white-space: pre-wrap; }
  .steps { margin: 4px 0; padding-left: 0; list-style: none; }
  .steps li { padding: 2px 0 2px 18px; position: relative; }
  .steps li::before { content: '·'; position: absolute; left: 6px; }
  .steps li.ok::before { content: '✓'; color: var(--vscode-charts-green, #3fb950); }
  .steps li.fail::before { content: '✗'; color: var(--vscode-charts-red, #f85149); }
  .steps li.fail .msg { color: var(--vscode-errorForeground); white-space: pre-wrap; }
  .card { border: 1px solid var(--vscode-panel-border, #444); border-radius: 6px; padding: 8px 10px; margin: 8px 0; }
  .card .head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
  .card .head b { font-size: 13px; }
  .phase { padding: 0 8px; border-radius: 8px; font-size: 11px; }
  .phase.success, .phase.ok { background: rgba(63,185,80,.2); }
  .phase.failed { background: rgba(248,81,73,.2); }
  .phase.running, .phase.starting { background: rgba(56,139,253,.2); }
  .side { display: inline-block; border: 1px solid var(--vscode-panel-border, #555); border-radius: 4px;
          padding: 3px 8px; margin: 3px 4px 0 0; font-size: 12px; }
  .side .st-ok { color: var(--vscode-charts-green, #3fb950); }
  .side .st-failed, .side .st-timeout { color: var(--vscode-charts-red, #f85149); }
  .side .st-running { color: var(--vscode-charts-blue, #4493f8); }
  .files a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; display: block; }
  details { margin: 4px 0; }
  pre.log { background: var(--vscode-textCodeBlock-background); padding: 6px; border-radius: 4px;
            font-size: 11px; max-height: 180px; overflow: auto; white-space: pre-wrap; }
  .bottom { position: fixed; bottom: 0; left: 0; right: 0; display: flex; gap: 8px; padding: 8px 12px;
            background: var(--vscode-editor-background); border-top: 1px solid var(--vscode-panel-border, #444); }
  .bottom input { flex: 1; }
  .mode { font-size: 11px; padding: 1px 8px; border-radius: 8px; border: 1px solid var(--vscode-panel-border, #666); }
  .mode.m1 { color: var(--vscode-charts-green, #3fb950); }
  .mode.m3 { color: var(--vscode-charts-blue, #4493f8); }
  .hint { opacity: .75; font-size: 11px; }
</style>
</head>
<body>
  <div class="row">
    <span class="mode" id="modeBadge">M3 外部驾驶舱（纯监控）</span>
    <span class="hint" id="healthLine"></span>
    <span style="flex:1"></span>
    <button class="secondary" id="btnHealth">刷新环境</button>
    <button class="secondary" id="btnDoctor">静态重探（零配额）</button>
  </div>
  <div id="banner"></div>

  <h3>装配（FR-2）</h3>
  <div class="row">
    <label>Driver：</label><select id="driver"></select>
    <label>审查者：</label><span id="critics"></span>
    <label>入口：</label>
    <select id="entry">
      <option value="A">A · 全流程</option>
      <option value="B">B · 计划双审</option>
      <option value="C">C · 代码双审</option>
      <option value="D">D · Bug 根因双审</option>
    </select>
    <label>轮次上限：</label><input type="number" id="maxRounds" min="1" max="10" placeholder="缺省 3" style="width:70px">
  </div>
  <div class="row"><label id="bodyLabel">任务目标：</label></div>
  <textarea id="body" placeholder="任务目标：这次要达成什么（入口 A 的语义）"></textarea>
  <div class="row">
    <label>主题（可选，不填由解析推导）：</label><input type="text" id="topic" style="width:200px">
  </div>
  <details>
    <summary>高级（档位 / 上下文 / 额外旗标）</summary>
    <div class="row"><label>档位：</label><select id="profile"><option value="">（缺省档）</option></select></div>
    <div class="row">
      <label>context 路径：</label><span id="ctxList" class="hint">（未选）</span>
      <button class="secondary" id="btnCtx">从工作区选择…</button>
    </div>
    <div class="row"><label>额外旗标：</label><input type="text" id="extraFlags" placeholder="如 --model-claude k3.1-pro --effort-codex high" style="flex:1"></div>
    <div class="hint" id="argHint"></div>
  </details>
  <div class="row" style="margin-top:8px">
    <button id="btnPrechain">① 执行前置链（resolve → preflight）</button>
    <button id="btnIgnite" disabled>② 确认主题并点火</button>
    <span class="hint">阶段循环由终端里的 Driver 会话驱动，插件旁观。</span>
  </div>
  <ul class="steps" id="steps"></ul>
  <div id="confirmBox"></div>
  <div class="cmdbar" id="cmdbar" style="display:none">
    <code id="cmdText"></code>
    <div>
      <button class="secondary" id="btnCopy">复制</button>
      <button class="secondary" id="btnResend">重新注入</button>
    </div>
  </div>

  <h3>运行监控（FR-4 · 自动发现，含别处发起的运行）</h3>
  <div id="runs"><span class="hint">（暂无活跃运行）</span></div>

  <div class="bottom">
    <input type="text" id="relayInput" placeholder="续话中继到协同终端（尽力而为；TUI 兼容差时请在终端直输）">
    <button id="btnRelay">发送 ▸</button>
  </div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  let state = { health: [], topic: null, inferDone: false, ctxPaths: [], frozen: null };

  // ── 渲染 ──
  function renderHealth(list) {
    state.health = list;
    $('healthLine').textContent = list.map(h => h.display + (h.availability === 'available' ? '✓' : '✗')).join('  ');
    const ds = $('driver'); ds.innerHTML = '';
    for (const h of list) {
      const o = document.createElement('option');
      o.value = h.agentId; o.textContent = h.display + (h.availability === 'available' ? '' : '（不可用）');
      o.disabled = h.availability !== 'available';
      ds.appendChild(o);
    }
    renderCritics();
  }
  function renderCritics() {
    const box = $('critics'); box.innerHTML = '';
    const driver = $('driver').value;
    for (const h of state.health) {
      const excluded = h.agentId === driver;   // 自动排除与 Driver 同身份项
      const disabled = excluded || h.availability !== 'available';
      const on = !disabled && !excluded;
      const chip = document.createElement('span');
      chip.className = 'chip ' + (on ? 'on' : 'off');
      chip.textContent = (on ? '✓' : '') + h.display + (excluded ? '（Driver）' : '');
      if (!disabled) chip.onclick = () => { chip.classList.toggle('on'); };
      else chip.onclick = null;
      box.appendChild(chip);
    }
  }
  function selectedCritics() {
    const out = [];
    const chips = $('critics').children;
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i];
      if (c.classList.contains('on')) out.push(state.health[i].agentId);
    }
    return out;
  }
  function entryChanged() {
    const e = $('entry').value;
    $('bodyLabel').textContent = e === 'A' ? '任务目标：' : '审查焦点（必填）：';
    $('body').placeholder = e === 'A' ? '任务目标：这次要达成什么（入口 A 的语义）' : '审查焦点：这次重点看什么（入口 ' + e + ' 必填）';
    vscode.postMessage({ type: 'entry-changed', entry: e });
  }
  function renderSteps(report) {
    const ul = $('steps'); ul.innerHTML = '';
    if (!report) return;
    for (const s of report.steps) {
      const li = document.createElement('li');
      if (s.state === 'ok') { li.className = 'ok'; li.textContent = label(s.step) + ' 通过'; }
      else if (s.state === 'failed') {
        li.className = 'fail';
        li.innerHTML = label(s.step) + ' 失败' + (s.code !== null && s.code !== undefined ? '（退出码 ' + s.code + '）' : '') +
          '<div class="msg">' + escapeHtml(String(s.message || '')) + '</div>';
      } else if (s.state === 'skipped') { li.textContent = label(s.step) + ' 跳过：' + s.reason; }
      if (s.step === 'preflight' && s.state === 'ok' && s.warnings) {
        for (const w of s.warnings) {
          const wli = document.createElement('li'); wli.textContent = '⚠ ' + w.name + '：' + w.detail;
          ul.appendChild(wli);
        }
      }
      ul.appendChild(li);
    }
    const box = $('confirmBox'); box.innerHTML = '';
    if (!report.failed && report.topic) {
      const div = document.createElement('div'); div.className = 'banner info';
      div.innerHTML = '解析主题：<b>' + escapeHtml(report.topic) + '</b>' +
        (report.topicInferred ? '（由任务目标推导——请核对）' : '（显式指定）') +
        (report.notes && report.notes.length ? '<div class="hint">' + report.notes.map(escapeHtml).join('<br>') + '</div>' : '');
      box.appendChild(div);
      $('btnIgnite').disabled = false;
      state.topic = report.topic;
      state.frozen = collect(); // 冻结快照（CLAUDE-08）：点火只接受与快照一致的表单
    } else {
      $('btnIgnite').disabled = true;
      state.topic = null;
      state.frozen = null;
    }
  }
  function checkFrozen() {
    if (!state.frozen) return;
    if (JSON.stringify(collect()) !== JSON.stringify(state.frozen)) {
      state.frozen = null;
      $('btnIgnite').disabled = true;
      const box = $('confirmBox');
      const d = document.createElement('div'); d.className = 'banner warn';
      d.textContent = '表单在确认后已变更：请重新执行前置链（步骤 ①）再点火。';
      box.appendChild(d);
    }
  }
  function label(step) { return { resolve: '解析（topic resolve）', preflight: '预检（preflight）', claim: '认领（topic claim）' }[step] || step; }
  function showCmd(text) { $('cmdbar').style.display = 'flex'; $('cmdText').textContent = text; }
  function banner(kind, text) {
    const b = $('banner'); b.innerHTML = '';
    if (!text) return;
    const d = document.createElement('div'); d.className = 'banner ' + kind; d.textContent = text; b.appendChild(d);
  }
  function setMode(mode) {
    const badge = $('modeBadge');
    if (mode === 'M1') { badge.textContent = 'M1 终端协同'; badge.className = 'mode m1'; }
    else { badge.textContent = 'M3 外部驾驶舱（纯监控）'; badge.className = 'mode m3'; }
  }
  function renderRuns(runs) {
    const box = $('runs'); box.innerHTML = '';
    if (!runs.length) { box.innerHTML = '<span class="hint">（暂无活跃运行）</span>'; return; }
    for (const r of runs) {
      const card = document.createElement('div'); card.className = 'card';
      const head = document.createElement('div'); head.className = 'head';
      head.innerHTML = '<b>' + escapeHtml(r.topic || '?') + ' · ' + escapeHtml(r.stage || '?') + '</b>' +
        '<span class="phase ' + r.phase + '">' + escapeHtml(r.phaseLabel) + '</span>' +
        '<span class="hint">' + escapeHtml(r.runId) + '</span>';
      if (!r.terminal) {
        const btn = document.createElement('button'); btn.className = 'secondary'; btn.textContent = '中止';
        btn.onclick = () => vscode.postMessage({ type: 'cancel', runId: r.runId });
        head.appendChild(btn);
      }
      card.appendChild(head);
      const sides = document.createElement('div');
      for (const s of r.sides) {
        const sp = document.createElement('span'); sp.className = 'side';
        sp.innerHTML = '<b>' + escapeHtml(s.critic) + '</b> <span class="st-' + s.state + '">' + escapeHtml(s.stateLabel) + '</span>' +
          (s.model ? ' · ' + escapeHtml(s.model) : '') + (s.elapsedS != null ? ' · ' + s.elapsedS + 's' : '');
        sides.appendChild(sp);
      }
      card.appendChild(sides);
      if (r.note) {
        const d = document.createElement('div');
        d.className = 'banner ' + (r.stale ? 'warn' : 'info');
        d.textContent = (r.stale ? '⚠ ' : '') + r.note;
        card.appendChild(d);
      }
      if (r.message) { const d = document.createElement('div'); d.className = 'hint'; d.textContent = r.message; card.appendChild(d); }
      const files = document.createElement('div'); files.className = 'files';
      for (const f of r.reviewFiles) {
        const a = document.createElement('a'); a.textContent = '📄 ' + f.name + (f.role ? '（' + f.role + '）' : '');
        a.onclick = () => vscode.postMessage({ type: 'open-file', path: f.absPath });
        files.appendChild(a);
      }
      for (const a2 of r.artifacts) {
        const a = document.createElement('a'); a.textContent = '📦 ' + a2.split('/').pop();
        a.onclick = () => vscode.postMessage({ type: 'open-file', path: a2 });
        files.appendChild(a);
      }
      card.appendChild(files);
      if (r.logTail) {
        const det = document.createElement('details');
        det.innerHTML = '<summary>worker.log 尾部</summary><pre class="log">' + escapeHtml(r.logTail) + '</pre>';
        card.appendChild(det);
      }
      box.appendChild(card);
    }
  }
  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ── 事件 ──
  $('driver').onchange = () => { renderCritics(); checkFrozen(); };
  $('entry').onchange = () => { entryChanged(); checkFrozen(); };
  for (const id of ['body', 'topic', 'maxRounds', 'profile', 'extraFlags']) {
    $(id).oninput = checkFrozen;
  }
  $('btnPrechain').onclick = () => vscode.postMessage({ type: 'prechain', form: collect() });
  $('btnIgnite').onclick = () => vscode.postMessage({ type: 'ignite', form: collect(), topic: state.topic });
  $('btnCopy').onclick = () => vscode.postMessage({ type: 'copy', text: $('cmdText').textContent });
  $('btnResend').onclick = () => vscode.postMessage({ type: 'resend' });
  $('btnRelay').onclick = () => { const v = $('relayInput').value.trim(); if (v) { vscode.postMessage({ type: 'relay', text: v }); $('relayInput').value = ''; } };
  $('relayInput').onkeydown = (e) => { if (e.key === 'Enter') { const v = e.target.value.trim(); if (v) { vscode.postMessage({ type: 'relay', text: v }); e.target.value = ''; } } };
  $('btnHealth').onclick = () => vscode.postMessage({ type: 'refresh-health' });
  $('btnDoctor').onclick = () => vscode.postMessage({ type: 'doctor-static' });
  $('btnCtx').onclick = () => vscode.postMessage({ type: 'pick-context' });

  function collect() {
    return {
      driver: $('driver').value,
      critics: selectedCritics(),
      entry: $('entry').value,
      body: $('body').value,
      topic: $('topic').value.trim(),
      maxRounds: $('maxRounds').value ? Number($('maxRounds').value) : undefined,
      profile: $('profile').value || undefined,
      ctxPaths: state.ctxPaths,
      extraFlags: $('extraFlags').value.trim(),
    };
  }

  // ── 宿主消息 ──
  window.addEventListener('message', (e) => {
    const m = e.data;
    switch (m.type) {
      case 'init':
        renderHealth(m.health);
        if (m.profileNames) {
          const ps = $('profile');
          for (const p of m.profileNames) { const o = document.createElement('option'); o.value = p; o.textContent = p; ps.appendChild(o); }
        }
        entryChanged();
        setMode(m.mode || 'M3');
        renderRuns(m.runs || []);
        break;
      case 'health': renderHealth(m.health); break;
      case 'prechain-result':
        renderSteps(m.report);
        if (m.cmdText) showCmd(m.cmdText);
        if (m.report && m.report.failed) state.frozen = null;
        break;
      case 'degraded':
        if (m.degraded) { $('btnPrechain').disabled = true; $('btnIgnite').disabled = true; }
        break;
      case 'ignite-result':
        if (m.ok) { banner('info', '已注入协同终端「' + m.terminalName + '」。提示语语义：任务目标/焦点作为首条消息进入会话。'); }
        else { banner('warn', '点火未完成：' + m.message); }
        showCmd(m.cmdText || '');
        setMode(m.ok ? 'M1' : 'M3');
        break;
      case 'runs': renderRuns(m.runs); break;
      case 'relay-result': banner(m.ok ? 'info' : 'warn', m.note); break;
      case 'cancel-result': banner(m.ok ? 'info' : 'warn', m.note); break;
      case 'mode': setMode(m.mode); break;
      case 'banner': banner(m.kind, m.text); break;
      case 'ctx-picked': state.ctxPaths = m.paths; $('ctxList').textContent = m.paths.join('，') || '（未选）'; break;
      case 'arg-hint': $('argHint').textContent = m.text ? '可用旗标（来自入口产物）：' + m.text : ''; break;
    }
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
