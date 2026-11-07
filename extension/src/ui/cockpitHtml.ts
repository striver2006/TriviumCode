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
  .sev { display: inline-block; min-width: 34px; text-align: center; border-radius: 8px; font-size: 11px; padding: 0 6px; }
  .sev.blocker { background: rgba(248,81,73,.35); color: var(--vscode-charts-red, #f85149); }
  .sev.major { background: rgba(255,123,114,.22); color: var(--vscode-charts-orange, #d29922); }
  .sev.minor { background: rgba(187,128,9,.22); color: var(--vscode-charts-yellow, #e3b341); }
  .sev.nit { background: rgba(139,148,158,.25); color: var(--vscode-descriptionForeground, #8b949e); }
  .finding { display: flex; gap: 6px; align-items: baseline; padding: 1px 0; }
  .finding .loc { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .finding .warn { color: var(--vscode-charts-yellow, #e3b341); font-size: 11px; }
  .finding button { padding: 0 8px; font-size: 11px; }
  .grp-head { cursor: pointer; user-select: none; }
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
  /* Phase 3：闸门区 / 裁决台 / 预设 */
  .gate-card { border: 1px solid var(--vscode-charts-yellow, #e3b341); border-radius: 6px; padding: 8px 10px; margin: 8px 0; }
  .gate-card .vote-row { margin: 3px 0; }
  .gate-card .verdict { padding: 0 6px; border-radius: 8px; font-size: 11px; margin-right: 4px; }
  .verdict.pass { background: rgba(63,185,80,.2); }
  .verdict.pass-after-changes { background: rgba(187,128,9,.25); }
  .verdict.reject { background: rgba(248,81,73,.3); }
  .gate-actions { display: flex; gap: 6px; margin-top: 6px; align-items: center; flex-wrap: wrap; }
  .gate-actions textarea { flex: 1 100%; min-height: 40px; }
  .wt-list { font-size: 11px; max-height: 120px; overflow: auto; margin: 4px 0; }
  .wt-list div { font-family: var(--vscode-editor-font-family); }
  .desk { border: 1px solid var(--vscode-panel-border, #444); border-radius: 6px; padding: 8px 10px; margin: 8px 0; }
  .desk table { border-collapse: collapse; width: 100%; font-size: 12px; margin: 6px 0; }
  .desk th, .desk td { border: 1px solid var(--vscode-panel-border, #555); padding: 3px 6px; text-align: left; vertical-align: top; }
  .desk textarea { min-height: 34px; width: 96%; resize: vertical; font-size: 11px; }
  .desk .id-link { color: var(--vscode-textLink-foreground); cursor: pointer; }
  .desk .err { color: var(--vscode-errorForeground); font-size: 11px; white-space: pre-wrap; }
  .desk-preview { background: var(--vscode-textCodeBlock-background); padding: 6px; border-radius: 4px;
                  font-family: var(--vscode-editor-font-family); font-size: 11px; max-height: 300px; overflow: auto; white-space: pre-wrap; }
  .preset-row select { max-width: 220px; }
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
  <div class="row preset-row">
    <label>预设：</label><select id="presetSel"><option value="">（选择预设…）</option></select>
    <button class="secondary" id="btnPresetSave">另存（工作区级）</button>
    <button class="secondary" id="btnPresetSaveG">另存（用户级）</button>
    <button class="secondary" id="btnPresetDel">删除</button>
    <span class="hint">只存装配参数（不含主题与正文）。</span>
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

  <div id="gateArea"></div>
  <div id="gateResult"></div>
  <div id="desk" style="display:none"></div>

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
      if (r.findingsSummary && r.findingsSummary.length > 0) card.appendChild(renderFindings(r));
      if (r.logTail) {
        const det = document.createElement('details');
        det.innerHTML = '<summary>worker.log 尾部</summary><pre class="log">' + escapeHtml(r.logTail) + '</pre>';
        card.appendChild(det);
      }
      box.appendChild(card);
    }
  }
  function renderFindings(r) {
    const wrap = document.createElement('details');
    wrap.open = true;
    const sum = document.createElement('summary');
    const counts = { blocker: 0, major: 0, minor: 0, nit: 0 };
    for (const s of r.findingsSummary) for (const k of Object.keys(counts)) counts[k] += (s.counts[k] || 0);
    sum.innerHTML = '审查意见（' + r.findingsSummary.length + ' 侧 · ' +
      (counts.blocker + counts.major + counts.minor + counts.nit) + ' 条：' +
      '<span class="sev blocker">阻断 ' + counts.blocker + '</span> <span class="sev major">重要 ' + counts.major + '</span>' +
      ' <span class="sev minor">次要 ' + counts.minor + '</span> <span class="sev nit">微瑕 ' + counts.nit + '</span>）';
    wrap.appendChild(sum);
    if (r.consistencyNote) {
      const cn = document.createElement('div'); cn.className = 'hint'; cn.textContent = 'ⓘ ' + r.consistencyNote;
      wrap.appendChild(cn);
    }
    if (r.buildNotice) {
      const bn = document.createElement('div'); bn.className = 'banner warn'; bn.textContent = '⚠ ' + r.buildNotice;
      wrap.appendChild(bn);
    }
    // 按审查者分组（组头带 verdict 徽标与分层开关，FR-6a/6b）
    const byCritic = {};
    for (const f of (r.findings || [])) (byCritic[f.critic] = byCritic[f.critic] || []).push(f);
    const enabled = r.enabledCritics; // null = 全部启用（CLAUDE-05）
    for (const s of r.findingsSummary) {
      const critic = s.critic;
      const list = byCritic[critic] || [];
      const grp = document.createElement('details');
      grp.open = true;
      const head = document.createElement('summary');
      head.className = 'grp-head';
      const on = enabled === null || enabled.indexOf(critic) >= 0;
      head.innerHTML = '<input type="checkbox"' + (on ? ' checked' : '') + ' title="开关该审查者的批注与列表（Problems 同步）"/> ' +
        '<b>' + escapeHtml(critic) + '</b> · ' + escapeHtml(s.verdictLabel) +
        (s.state !== 'ok' ? ' <span class="warn">（' + escapeHtml(s.notice || s.state) + '）</span>' : '') +
        ' · 共 ' + (s.counts.blocker + s.counts.major + s.counts.minor + s.counts.nit) + ' 条（列出 ' + list.length + ' 条）';
      head.querySelector('input').onclick = (e) => {
        e.preventDefault();
        vscode.postMessage({ type: 'toggle-critic', critic: critic });
      };
      grp.appendChild(head);
      for (const f of list) {
        const row = document.createElement('div'); row.className = 'finding';
        const sev = document.createElement('span'); sev.className = 'sev ' + f.severity; sev.textContent = { blocker: '阻断', major: '重要', minor: '次要', nit: '微瑕' }[f.severity] || f.severity;
        row.appendChild(sev);
        const id = document.createElement('span'); id.textContent = f.id; row.appendChild(id);
        const problem = document.createElement('span'); problem.textContent = f.problem.split('\\n')[0]; problem.style.flex = '1';
        row.appendChild(problem);
        if (f.label) { const w = document.createElement('span'); w.className = 'warn'; w.textContent = '⚠ ' + f.label; row.appendChild(w); }
        if (f.consistency === 'mismatch' || f.consistency === 'edited') {
          const w = document.createElement('span'); w.className = 'warn';
          w.textContent = f.consistency === 'mismatch' ? '⚠ 与送审版本不一致' : '⚠ 文件已编辑';
          row.appendChild(w);
        }
        if (f.level === 'line' && f.file) {
          const loc = document.createElement('span'); loc.className = 'loc';
          loc.textContent = (f.relPath || '') + ':' + f.startLine + (f.endLine !== f.startLine ? '-' + f.endLine : '');
          loc.title = '点击跳转';
          loc.onclick = () => vscode.postMessage({ type: 'open-finding', file: f.file, startLine: f.startLine, endLine: f.endLine });
          row.appendChild(loc);
        } else {
          const loc = document.createElement('span'); loc.className = 'hint'; loc.textContent = f.location;
          row.appendChild(loc);
        }
        if (f.secondary && f.secondary.length) {
          const sec = document.createElement('span'); sec.className = 'hint'; sec.textContent = '↳ ' + f.secondary.join('；');
          row.appendChild(sec);
        }
        // CLAUDE-02：Diff 入口按变更集成员判定（与跳转解耦）——missing-file（如本轮删除的文件）
        // 也能打开只读基线
        if (f.relPath && f.inChangeset) {
          const btn = document.createElement('button'); btn.className = 'secondary'; btn.textContent = 'Diff';
          btn.title = '被审基线对比当前文件（删除文件打开只读基线）';
          btn.onclick = () => vscode.postMessage({ type: 'open-diff', runId: r.runId, relPath: f.relPath, startLine: f.startLine, endLine: f.endLine });
          row.appendChild(btn);
        }
        grp.appendChild(row);
      }
      wrap.appendChild(grp);
    }
    return wrap;
  }
  function escapeHtml(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ── Phase 3：闸门区（FR-9）──
  const VERDICT_TEXT = { 'pass': '通过', 'pass-after-changes': '修改后通过', 'reject': '不通过' };
  const STATUS_TEXT = { 'M': '修改', 'A': '新增', 'D': '删除', 'R': '重命名', 'C': '复制' };
  function statusText(xy) {
    if (xy === '??') return '未跟踪';
    return STATUS_TEXT[xy[0]] || STATUS_TEXT[xy[1]] || xy; // ' M'（未暂存）看 y 位
  }
  function renderGateArea(msg) {
    const box = $('gateArea'); box.innerHTML = '';
    const cards = msg.cards || [];
    if (!cards.length) return;
    const h = document.createElement('h3'); h.textContent = '闸门区（FR-9 · 人工审批带外通道）'; box.appendChild(h);
    for (const c of cards) box.appendChild(renderGateCard(c, msg.noVoteNote));
  }
  function renderGateCard(c, noVoteNote) {
    const card = document.createElement('div'); card.className = 'gate-card';
    const head = document.createElement('div'); head.className = 'head';
    head.innerHTML = '<b>' + escapeHtml(c.topic + ' / ' + c.stage) + '</b>' +
      (c.mode === 'aa' ? ' <span class="phase running">等待人工审批</span>' : ' <span class="phase failed">裁决未齐</span>') +
      ' <span class="hint">' + escapeHtml(c.runId) + '（第 ' + (c.rerunIndex || '—') + ' 轮）</span>';
    card.appendChild(head);
    if (c.mode === 'aa') {
      if (c.vote) {
        const v = document.createElement('div'); v.className = 'vote-row';
        v.innerHTML = '<b>计票：</b>' + c.vote.sides.map(function (s) {
          return '<span class="verdict ' + s.verdict + '">' + escapeHtml(s.critic) + ' · ' + (VERDICT_TEXT[s.verdict] || s.verdict) + '</span>';
        }).join(' ') + ' → <b>' + escapeHtml(c.vote.outcome) + '</b>';
        card.appendChild(v);
        if (c.vote.roundLine) { const rl = document.createElement('div'); rl.className = 'hint'; rl.textContent = c.vote.roundLine; card.appendChild(rl); }
      } else {
        const nv = document.createElement('div'); nv.className = 'hint'; nv.textContent = noVoteNote || '无计票信息。'; card.appendChild(nv);
      }
      if (c.hint) {
        const hint = document.createElement('div');
        hint.innerHTML = '<b>工作树摘要（提示性 · 相对 HEAD）：</b>' +
          (c.hint.available
            ? c.hint.total === 0 ? '无业务文件改动。' :
              '<div class="wt-list">' + c.hint.files.map(function (f) {
                return '· [' + statusText(f.status) + '] ' + escapeHtml(f.path);
              }).join('') + (c.hint.total > c.hint.files.length ? '<div>…共 ' + c.hint.total + ' 项</div>' : '') + '</div>'
            : '<span class="hint">不可用：' + escapeHtml(c.hint.reason || '') + '</span>') +
          '<div class="hint">⚠ 本摘要相对 HEAD，看不见闸门期已提交的改动；完整口径（自审查收尾以来）在批准时由编排器给出。</div>';
        card.appendChild(hint);
      }
    }
    for (const f of (c.failureSummary || [])) {
      const d = document.createElement('div'); d.className = 'banner warn';
      d.textContent = '✗ [' + f.code + '] ' + f.message; card.appendChild(d);
    }
    for (const w of (c.warnings || [])) {
      const d = document.createElement('div'); d.className = 'hint';
      d.textContent = '⚠ [' + w.code + '] ' + w.message; card.appendChild(d);
    }
    const actions = document.createElement('div'); actions.className = 'gate-actions';
    if (c.mode === 'raf') {
      const btnDesk = document.createElement('button'); btnDesk.textContent = '进入裁决台（FR-8）';
      btnDesk.onclick = () => vscode.postMessage({ type: 'gate-open', topic: c.topic, stage: c.stage });
      actions.appendChild(btnDesk);
    } else {
      const ok = document.createElement('button'); ok.textContent = '批准';
      ok.title = 'approve --topic --stage（点击不经任何模型上下文）';
      ok.onclick = () => vscode.postMessage({ type: 'approve-req', topic: c.topic, stage: c.stage });
      const no = document.createElement('button'); no.className = 'secondary'; no.textContent = '拒绝（必填理由）';
      const reason = document.createElement('textarea'); reason.placeholder = '拒绝理由（人工输入，必填——留空将被拦截）';
      no.onclick = () => vscode.postMessage({ type: 'reject-req', topic: c.topic, stage: c.stage, reason: reason.value });
      const drop = document.createElement('button'); drop.className = 'secondary'; drop.textContent = '放弃…';
      drop.onclick = () => vscode.postMessage({ type: 'abandon-req', topic: c.topic, stage: c.stage });
      actions.appendChild(ok); actions.appendChild(no); actions.appendChild(drop); actions.appendChild(reason);
    }
    const refresh = document.createElement('button'); refresh.className = 'secondary'; refresh.textContent = '刷新';
    refresh.onclick = () => vscode.postMessage({ type: 'gate-refresh', topic: c.topic, stage: c.stage });
    actions.appendChild(refresh);
    card.appendChild(actions);
    if (c.mode === 'raf') {
      const note = document.createElement('div'); note.className = 'hint';
      note.textContent = '「进入裁决台」读取 gate --check 缺口清单，生成契约裁决件草稿（预览确认后才落盘）。';
      card.appendChild(note);
    }
    return card;
  }
  function renderGateAction(msg) {
    // 独立结果区：gateArea 刷新清空不影响（代码审 r1 CLAUDE-08/CODEX-09）
    const area = $('gateResult');
    area.innerHTML = msg.busy
      ? '<div class="banner info">正在执行 ' + escapeHtml(msg.kind) + '…</div>'
      : '<div class="banner ' + (msg.ok ? 'info' : 'warn') + '">' + (msg.ok ? '✓ ' : '✗ ') + escapeHtml(msg.note || '') + '</div>';
    if (msg.authoritative) {
      const d = document.createElement('div');
      d.innerHTML = '<b>权威工作树摘要（自审查收尾以来）：</b>' + (msg.authoritative.kind === 'ok'
        ? (msg.authoritative.total === 0 ? '无改动。' :
          '<div class="wt-list">' + msg.authoritative.files.map(function (f) {
            return '· [' + f.status + '] ' + escapeHtml(f.path);
          }).join('') + (msg.authoritative.truncated ? '<div>…已截断，共 ' + msg.authoritative.total + ' 项</div>' : '') + '</div>')
        : '<span class="hint">不可用：' + escapeHtml(msg.authoritative.reason || '') + '</span>');
      area.appendChild(d);
    }
  }

  // ── Phase 3：裁决台（FR-8）──
  let deskRows = [];
  function renderDesk(msg) {
    const box = $('desk'); box.style.display = ''; box.innerHTML = '';
    if (!msg.ok) {
      box.innerHTML = '<div class="banner warn">' + escapeHtml(msg.error || '打开失败') + '</div>';
      return;
    }
    const m = msg.model;
    const head = document.createElement('div'); head.className = 'head';
    head.innerHTML = '<b>裁决台（FR-8）</b> ' + escapeHtml(m.topic + ' / ' + m.stage) +
      ' · run ' + escapeHtml(m.runId) +
      (m.form === 'repair' ? ' · <span class="phase failed">修复模式</span>' : ' · <span class="phase running">起草模式</span>') +
      ' · Driver：<b>' + escapeHtml(m.driver ? m.driver.driver : '未定位（草稿禁用）') + '</b>' +
      (m.driver && m.driver.source === 'stage-claim' ? '<span class="hint">（阶段认领声明，非 run 元数据）</span>' : '');
    box.appendChild(head);
    for (const s of (m.structural || [])) {
      const d = document.createElement('div'); d.className = 'banner warn';
      d.textContent = '✗ [' + s.code + '] ' + s.message; box.appendChild(d);
    }
    for (const p of (m.planGaps || [])) {
      const d = document.createElement('div'); d.className = 'banner warn';
      d.textContent = '✗ [' + p.code + '] ' + p.message + '（新一轮计划属 Driver 会话职责，裁决台不代写）'; box.appendChild(d);
    }
    for (const w of (m.warnings || [])) {
      const d = document.createElement('div'); d.className = 'hint';
      d.textContent = '⚠ [' + w.code + '] ' + w.message; box.appendChild(d);
    }
    deskRows = (msg.session ? msg.session.rows : []).slice();
    if (m.items.length > 0) {
      const table = document.createElement('table');
      const lastCol = m.stage === 'code' ? '修改计划' : '落点';
      table.innerHTML = '<tr><th>意见编号</th><th>来源</th><th>严重度</th><th>裁决</th><th>理由（必填）</th><th>' + lastCol + '</th></tr>';
      for (const item of m.items) {
        const cur = msg.session ? (msg.session.rows.find(function (r) { return r.id === item.id; }) || {}) : {};
        const tr = document.createElement('tr');
        const tdId = document.createElement('td');
        const idSpan = document.createElement('span'); idSpan.className = 'id-link'; idSpan.textContent = item.id;
        idSpan.title = '点击定位行内批注'; idSpan.onclick = () => vscode.postMessage({ type: 'locate-finding', id: item.id });
        tdId.appendChild(idSpan);
        if (item.problemNote) { const w = document.createElement('div'); w.className = 'err'; w.textContent = '⚠ ' + item.problemNote; tdId.appendChild(w); }
        tr.appendChild(tdId);
        const tdC = document.createElement('td'); tdC.textContent = item.critic || '—'; tr.appendChild(tdC);
        const tdS = document.createElement('td'); tdS.textContent = item.severity || '—'; tr.appendChild(tdS);
        // 单组单元格构造（r2 CLAUDE-01/AGY-01/CODEX-01：重复声明是语法错误，整段脚本失效）
        const tdR = document.createElement('td');
        const ta = document.createElement('textarea'); ta.value = cur.reason || ''; ta.placeholder = '人工输入（三种裁决都要求非空）';
        tdR.appendChild(ta);
        const tdA = document.createElement('td');
        const taA = document.createElement('textarea'); taA.value = cur.action || '';
        taA.placeholder = item.requireAction ? '接受项必填（结构化行）' : '可选（fallback 行）';
        tdA.appendChild(taA);
        const tdV = document.createElement('td');
        const sel = document.createElement('select');
        const opts = ['（未选）', '接受', '驳回'];
        if (item.deferAllowed) opts.push('暂缓');
        for (const opt of opts) {
          const o = document.createElement('option'); o.value = opt === '（未选）' ? '' : opt; o.textContent = opt;
          if (cur.verdict === o.value) o.selected = true; sel.appendChild(o);
        }
        if (item.removeable) {
          // unknown 类：默认勾选删除，勾选时裁决/理由/落点禁用（CLAUDE-02/AGY-01/CODEX-06）
          const del = document.createElement('label');
          del.style.cssText = 'display:block;font-size:11px;margin-top:3px';
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = cur.removed !== false;
          cb.onchange = () => {
            sel.disabled = cb.checked; ta.disabled = cb.checked; taA.disabled = cb.checked;
            collectDesk();
          };
          del.appendChild(cb); del.appendChild(document.createTextNode(' 删除该行'));
          sel.disabled = cb.checked; ta.disabled = cb.checked; taA.disabled = cb.checked;
          tdV.appendChild(sel); tdV.appendChild(del);
        } else {
          tdV.appendChild(sel);
        }
        tr.appendChild(tdV); tr.appendChild(tdR); tr.appendChild(tdA);
        tr.dataset.id = item.id; tr.dataset.requireAction = item.requireAction ? '1' : '';
        table.appendChild(tr);
      }
      box.appendChild(table);
      // r3 CLAUDE-05：任何行控件变更即时回传（预览失效走宿主 formHash 比对）
      table.addEventListener('input', () => collectDesk());
      table.addEventListener('change', () => collectDesk());
    } else {
      box.insertAdjacentHTML('beforeend', '<div class="hint">（无待裁/待修条目）</div>');
    }
    if ((m.readonlyRows || []).length > 0) {
      const d = document.createElement('details');
      d.innerHTML = '<summary>已合法裁决的行（' + m.readonlyRows.length + ' 条，保留原文）</summary>' +
        '<div class="hint">' + m.readonlyRows.map(function (r) {
          return escapeHtml(r.id + ' · ' + r.verdict + ' · ' + (r.reason || '').slice(0, 40));
        }).join('<br>') + '</div>';
      box.appendChild(d);
    }
    // addresses 手工兜底通道（CLAUDE-12/AGY-06）：展示派生结果并允许编辑；空时落盘被拒
    const addrBox = document.createElement('details');
    addrBox.style.margin = '4px 0';
    const addrSummary = document.createElement('summary');
    const addrList = m.addresses || [];
    addrSummary.textContent = 'addresses（应答的审查文档文件名，每行一项' + (addrList.length ? '' : '——派生为空，须手工补齐') + '）';
    addrBox.appendChild(addrSummary);
    const addrTa = document.createElement('textarea');
    addrTa.style.minHeight = '48px';
    addrTa.value = addrList.length ? addrList.join('\\n') : '';
    addrTa.oninput = () => vscode.postMessage({ type: 'desk-addresses', text: addrTa.value });
    addrBox.appendChild(addrTa);
    box.appendChild(addrBox);
    const bar = document.createElement('div'); bar.className = 'gate-actions';
    const btnPreview = document.createElement('button'); btnPreview.textContent = '生成预览';
    const btnSave = document.createElement('button'); btnSave.textContent = '预览确认后落盘'; btnSave.disabled = true;
    const btnClose = document.createElement('button'); btnClose.className = 'secondary'; btnClose.textContent = '关闭裁决台';
    btnClose.onclick = () => { box.style.display = 'none'; vscode.postMessage({ type: 'desk-close' }); };
    btnPreview.onclick = () => { collectDesk(); vscode.postMessage({ type: 'desk-preview' }); };
    // 落盘不再先发 desk-update（r2 CODEX-03：update 会失效预览形成死循环）——
    // 预览时的表单快照即落盘内容；宿主侧另有「表单变更即拒绝落盘」的复核
    btnSave.onclick = () => vscode.postMessage({ type: 'desk-save' });
    bar.appendChild(btnPreview); bar.appendChild(btnSave); bar.appendChild(btnClose);
    box.appendChild(bar);
    const pv = document.createElement('div'); pv.id = 'deskPreview'; box.appendChild(pv);
    box.insertAdjacentHTML('beforeend', '<div class="hint">落盘是本插件对 .reviews 的唯一写入：预览确认后生效，命名与契约由编排器 gate --check 兜底。</div>');
    window.deskSaveBtn = btnSave;
  }
  function collectDesk() {
    const table = $('desk').querySelector('table');
    if (!table) { vscode.postMessage({ type: 'desk-update', rows: deskRows }); return; }
    const rows = [];
    for (const tr of table.querySelectorAll('tr')) {
      if (!tr.dataset.id) continue;
      const del = tr.querySelector('input[type=checkbox]');
      rows.push({
        id: tr.dataset.id,
        verdict: del && del.checked ? null : (tr.querySelector('select').value || null),
        reason: tr.querySelectorAll('textarea')[0].value,
        action: tr.querySelectorAll('textarea')[1].value,
        removed: !!(del && del.checked),
      });
    }
    deskRows = rows;
    vscode.postMessage({ type: 'desk-update', rows });
    if (window.deskSaveBtn) window.deskSaveBtn.disabled = true; // 预览失效，须重新预览
  }
  function renderDeskPreview(msg) {
    const pv = $('deskPreview');
    if (!msg.ok) {
      pv.innerHTML = '<div class="err">' + (msg.errors || []).map(escapeHtml).join('<br>') + '</div>';
      if (window.deskSaveBtn) window.deskSaveBtn.disabled = true;
      return;
    }
    // 空洞理由等非阻断警示逐条展示（r2 CLAUDE-11：承诺的即时提示）
    pv.innerHTML =
      (msg.warnings && msg.warnings.length ? '<div class="banner warn">' + msg.warnings.map(function (w) { return '⚠ ' + escapeHtml(w); }).join('<br>') + '</div>' : '') +
      (msg.removedIds && msg.removedIds.length ? '<div class="hint">将从裁决表删除：' + msg.removedIds.map(escapeHtml).join('、') + '</div>' : '') +
      '<div class="banner info">草稿预览：' + escapeHtml(msg.fileName) +
      (msg.form === 'repair' ? '（修复：原文手术——只改修复行，表外正文与合法行原样保留）' : '（起草：独占创建新文件）') + '</div>' +
      '<div class="desk-preview">' + escapeHtml(msg.text) + '</div>';
    if (window.deskSaveBtn) window.deskSaveBtn.disabled = false;
  }
  function renderDeskResult(msg) {
    const pv = $('deskPreview');
    const d = document.createElement('div');
    d.className = 'banner ' + (msg.ok ? (msg.gatePass ? 'info' : 'warn') : 'warn');
    d.textContent = (msg.ok ? (msg.gatePass ? '✓ ' : '⚠ ') : '✗ ') + (msg.note || '');
    pv.insertBefore(d, pv.firstChild);
  }

  // ── Phase 3：预设（FR-11）──
  function renderPresets(msg) {
    const sel = $('presetSel');
    const current = sel.value;
    sel.innerHTML = '<option value="">（选择预设…）</option>';
    for (const p of (msg.list || [])) {
      const o = document.createElement('option');
      o.value = p.name + '\\u0000' + p.scope;
      o.textContent = p.name + '（' + (p.scope === 'global' ? '用户级' : '工作区级') + '）';
      sel.appendChild(o);
    }
    if (current) sel.value = current;
  }
  function applyPreset(msg) {
    const f = msg.fields;
    if (!f) return;
    $('driver').value = f.driver;
    renderCritics();
    const chips = $('critics').children;
    const want = new Set(f.critics || []);
    for (let i = 0; i < chips.length; i++) {
      const c = chips[i];
      const on = want.has(state.health[i].agentId);
      c.classList.toggle('on', on);
    }
    $('entry').value = f.entry;
    $('maxRounds').value = f.maxRounds != null ? String(f.maxRounds) : '';
    $('profile').value = f.profile || '';
    $('extraFlags').value = f.extraFlags || '';
    state.ctxPaths = f.ctxPaths || [];
    $('ctxList').textContent = state.ctxPaths.join('，') || '（未选）';
    entryChanged();
    checkFrozen(); // CLAUDE-08：回填即表单变更，须重跑前置链
    banner('info', msg.note + (msg.staleNote ? ' ' + msg.staleNote : ''));
  }

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
  // Phase 3：预设（FR-11）。名称输入与删除确认都在宿主侧（r2 AGY-02/CODEX-10：
  // Webview 沙箱禁用 window.prompt/confirm，静默不可用）；选择保留不清空（删除可达）
  $('presetSel').onchange = () => {
    const v = $('presetSel').value;
    if (!v) return;
    const sep = v.indexOf('\\u0000');
    vscode.postMessage({ type: 'preset-load', name: v.slice(0, sep), scope: v.slice(sep + 1) });
  };
  $('btnPresetSave').onclick = () => vscode.postMessage({ type: 'preset-save-req', scope: 'workspace', form: collect() });
  $('btnPresetSaveG').onclick = () => vscode.postMessage({ type: 'preset-save-req', scope: 'global', form: collect() });
  $('btnPresetDel').onclick = () => {
    const v = $('presetSel').value;
    if (!v) { banner('warn', '请先在下拉里选中要删除的预设。'); return; }
    const sep = v.indexOf('\\u0000');
    vscode.postMessage({ type: 'preset-delete-req', name: v.slice(0, sep), scope: v.slice(sep + 1) });
  };

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
      // ── Phase 3 ──
      case 'gate-area': renderGateArea(m); break;
      case 'gate-action': renderGateAction(m); break;
      case 'desk-state': renderDesk(m); break;
      case 'desk-severity': {
        // severity 回填（Hub 数据面就绪后到达；只更新「—」空槽）
        const map = new Map(m.map || []);
        const table = $('desk').querySelector('table');
        if (table) {
          for (const tr of table.querySelectorAll('tr')) {
            if (!tr.dataset.id) continue;
            const sev = map.get(tr.dataset.id);
            const td = tr.children[2];
            if (sev && td && td.textContent === '—') td.textContent = sev;
          }
        }
        break;
      }
      case 'desk-preview': renderDeskPreview(m); break;
      case 'desk-result': renderDeskResult(m); break;
      case 'desk-closed': $('desk').style.display = 'none'; break;
      case 'presets': renderPresets(m); break;
      case 'preset-applied': applyPreset(m); break;
      case 'preset-result': banner(m.ok ? 'info' : 'warn', m.note); break;
    }
  });
  vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}
