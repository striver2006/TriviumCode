// 驾驶舱验收：两份临时仓共享运行根，两个独立 Extension Host 同时点火。
// TRIVIUM_TEST_VSIX 指定时只从包安装；不向 VS Code 传开发扩展路径。
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { openWorkspace, until, command, installVsix } from '../test/e2e/workbench.mjs';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { extensionRoot, makeWorkspace } from '../test/e2e/workspace.mjs';

const base = await fs.realpath(await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'trivium-phase4-')));
const code = process.env.VSCODE_EXECUTABLE_PATH || await downloadAndUnzipVSCode('stable');
const vsix = process.env.TRIVIUM_TEST_VSIX;
const keep = process.env.TRIVIUM_KEEP_WINDOW === '1';
const children = [];
let handoff = false;
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
async function prepare(w) {
  const f = w.frame;
  await f.locator('#entry').selectOption('B');
  await f.locator('#driver').selectOption('claude');
  await f.locator('#body').fill(w.focus);
  await f.locator('#topic').fill(w.topic);
  await f.locator('#btnPrechain').click();
  await until('前置链 ' + w.topic, async () => {
    const error = await f.locator('#steps .fail').allTextContents();
    if (error.length) throw new Error(error.join(' '));
    return f.locator('#btnIgnite').isEnabled();
  });
}
async function startInCockpit(w) {
  await w.frame.locator('#btnIgnite').click();
  await w.frame.locator('#modeBadge.m1').waitFor();
  return w.frame;
}
async function ignite(w) {
  const f = await startInCockpit(w);
  await f.locator('#relayInput').fill('核对续话 ' + w.topic);
  await f.locator('#btnRelay').click();
  await until('续话到达同一终端', async () => (await fs.readFile(path.join(w.root, '.trivium/relay.txt'), 'utf8').catch(() => '')) === '核对续话 ' + w.topic);
  const start = await until('真实子进程 --start 回读', () => json(path.join(w.root, '.trivium/start.json')).catch(() => null));
  assert.ok(start.ok && start.run_id);
  w.runId = start.run_id;
  await f.locator('#runs .card').filter({ hasText: w.runId }).waitFor();
  await command(w.page, 'Terminal: Kill the Active Terminal Instance');
  await f.locator('#modeBadge.m3').waitFor();
  const meta = path.join(w.root, '.reviews', w.topic, 'plan/_meta', 'run-' + w.runId + '.json');
  const result = await until('归档成功', async () => {
    const r = await json(meta).catch(() => null);
    if (r?.status === 'failed') throw new Error('审查失败 ' + meta);
    return r?.status === 'success' && r;
  });
  assert.deepEqual(Object.keys(result.critics).sort(), ['gemini', 'glm']);
  for (const c of Object.values(result.critics)) assert.equal(c.cli_version, 'stub/0.0.0');
  w.fingerprints = Object.fromEntries(Object.entries(result.critics).map(([id, c]) => [id, c.cli_version]));
  await f.locator('#runs .card').filter({ hasText: w.runId }).locator('.finding').first().waitFor();
}
// 故意让一侧晚到超时，验证关闭终端后确实又收到同一运行的新终态。
async function liveClose(w) {
  await prepare(w);
  const f = await startInCockpit(w);
  const start = await until('点火返回运行编号', () => json(path.join(w.root, '.trivium/start.json')).catch(() => null));
  assert.ok(start.ok && start.run_id);
  const card = f.locator('#runs .card').filter({ hasText: start.run_id });
  await card.locator('.phase.running').waitFor();
  await command(w.page, 'Terminal: Kill the Active Terminal Instance');
  await f.locator('#modeBadge.m3').waitFor();
  const status = path.join(start.run_dir, 'status.json');
  const phaseAtClose = (await json(status)).phase;
  assert.equal(phaseAtClose, 'running');
  await card.locator('.phase.failed').waitFor({ timeout: 45000 });
  const archive = path.join(w.root, '.reviews', w.topic, 'plan/_meta', 'run-' + start.run_id + '.json');
  const meta = await json(archive);
  assert.equal(meta.status, 'failed');
  for (const id of ['gemini', 'glm']) assert.equal(meta.critics[id].cli_version, 'stub/0.0.0');
  return { root: w.root, runId: start.run_id, phaseAtClose, afterClose: meta.status,
    mode: await f.locator('#modeBadge').innerText(), archive };
}
async function disposition(w, peer) {
  const f = w.frame;
  const cards = await f.locator('#runs .card .head b').allTextContents();
  assert.ok(cards.length && cards.every(c => c.includes(w.topic) && !c.includes(peer.topic)), String(cards));
  assert.ok(!(await f.locator('#gateArea').innerText()).includes(peer.topic));
  await f.getByRole('button', { name: '进入裁决台（FR-8）' }).click();
  const rows = f.locator('#desk tr[data-id]');
  await rows.first().waitFor();
  assert.equal(await rows.count(), 2);
  for (const row of await rows.all()) {
    await row.locator('select').selectOption('驳回');
    await row.locator('textarea').first().fill('桩意见描述的实现位于示例代码，当前夹具只包含说明文件。');
  }
  await f.getByRole('button', { name: '生成预览' }).click();
  await f.locator('.desk-preview').waitFor();
  await f.getByRole('button', { name: '预览确认后落盘' }).click();
  await f.getByRole('button', { name: '批准', exact: true }).waitFor();
  const task = await json(path.join(w.root, '.reviews', w.topic, 'task.json'));
  const state = await json(path.join(w.root, '.trivium/state.json'));
  const gate = state.gates[w.topic + '/plan'];
  assert.equal(gate.state, 'awaiting_approval');
  assert.equal(gate.run_id, w.runId);
  assert.equal(task.approvals.length, 0);
  await f.locator('#gateArea').scrollIntoViewIfNeeded();
  await w.page.screenshot({ path: path.join(base, w.topic + '-gate.png') });
  return { root: w.root, profile: w.profile, topic: w.topic, runId: w.runId, fingerprints: w.fingerprints,
    cards, mode: await f.locator('#modeBadge').innerText(), gate, approvals: task.approvals };
}
// 同一实际 Webview 的渲染基准。合成 payload 不改写运行日志，测量含一次布局的渲染时间。
async function benchmark(f) {
  return f.evaluate(async () => {
    const text = Array.from({ length: 50000 }, (_, i) => '日志行 ' + String(i).padStart(5, '0')).join('\n');
    const payload = { type: 'runs', runs: [{ runId: 'perf', topic: '日志测量', stage: 'plan', terminal: true,
      phase: 'success', phaseLabel: '完成', sides: [], reviewFiles: [], artifacts: [], logTail: text }] };
    const t0 = performance.now();
    window.dispatchEvent(new MessageEvent('message', { data: payload }));
    const port = document.querySelector('.log');
    port.parentElement.open = true;
    await new Promise(r => setTimeout(r, 50));
    const samples = [];
    for (let i = 1; i <= 100; i++) {
      port.scrollTop = Math.round((port.scrollHeight - port.clientHeight) * i / 100);
      const t = performance.now();
      port.dispatchEvent(new Event('scroll'));
      port.getBoundingClientRect();
      samples.push(performance.now() - t);
    }
    const visible = port.querySelector('pre').textContent;
    const scrollTop = port.scrollTop;
    window.dispatchEvent(new MessageEvent('message', { data: payload }));
    const restored = document.querySelector('.log');
    samples.sort((a, b) => a - b);
    return { lines: 50000, bytes: new TextEncoder().encode(text).length, renderedRows: visible.split('\n').length,
      lastLine: visible.split('\n').at(-1), restored: restored.parentElement.open && restored.scrollTop === scrollTop,
      samples: samples.length, p95Ms: samples[94], maxMs: samples.at(-1),
      elapsedMsIncludingOpenWait: performance.now() - t0 };
  });
}
console.log('验收目录', base);
try {
  if (vsix) await installVsix({ code, base, vsix });
  const workspaces = await Promise.all(['甲', '乙'].map((id, i) => makeWorkspace(base, 'repo-' + i, '入口B验收' + id)));
  const windows = [];
  for (const fx of workspaces) windows.push(await openWorkspace(fx, { base, code, vsix, children }));
  // 稳定填写各自窗口的表单，再并行启动两个真实运行。
  for (const w of windows) await prepare(w);
  await Promise.all(windows.map(ignite));
  const gates = [];
  for (const [i, w] of windows.entries()) gates.push(await disposition(w, windows[1-i]));
  const performance = await benchmark(windows[1].frame);
  assert.ok(performance.renderedRows <= 18 && performance.lastLine === '日志行 49999' && performance.restored);
  let manual = null;
  if (vsix) {
    const page = windows[1].page;
    await command(page, '打开 Trivium 驾驶舱使用手册');
    manual = await until('安装包自带中文手册', async () => {
      for (const frame of page.frames()) {
        if (await frame.getByRole('heading', { name: '走通一次入口 B' }).count()) return '走通一次入口 B';
      }
    });
  }
  const slow = await makeWorkspace(base, 'repo-slow', '运行中关闭终端', null, true);
  const monitor = await liveClose(await openWorkspace(slow, { base, code, vsix, children }));
  const report = { code, monitor, vsix: vsix ? path.resolve(vsix) : null, base, gates, performance, manual };
  await fs.writeFile(path.join(base, 'before-approval.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (keep && vsix) {
    await windows[0].page.bringToFront();
    // 对于外部启动的 VS Code，这里只断开 Playwright 的连接。
    await windows[0].browser.close();
    handoff = true;
  }
} finally {
  // 保留安装包验收的首窗口，供 Bob 亲自点击；其余都只关闭本轮创建的进程。
  for (const child of children.slice(handoff ? 1 : 0)) child.kill();
}

// E1 独立安装包还要经过四家可控 CLI 的退出闩锁验收。
if (vsix && path.basename(vsix).endsWith('-e1.vsix')) await import('./runStdoutE2E.mjs');
