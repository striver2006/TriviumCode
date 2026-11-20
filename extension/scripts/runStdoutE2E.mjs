// 安装态 E1 时序。子进程必须等到文件、Webview、M3 三处回读才会退出。
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stdoutWorkspace } from '../test/e2e/stdoutWorkspace.mjs';
import { until, installVsix, command, openWorkspace } from '../test/e2e/workbench.mjs';

const json = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const hash = b => createHash('sha256').update(b).digest('hex');
const base = await fs.realpath(await fs.mkdtemp(path.join(process.platform === 'darwin' ? '/tmp' : os.tmpdir(), 'trivium-e1-host-')));
const vsix = process.env.TRIVIUM_TEST_VSIX;
assert.ok(vsix, '请指定 TRIVIUM_TEST_VSIX');
const code = process.env.VSCODE_EXECUTABLE_PATH;
assert.ok(code, '请指定 VSCODE_EXECUTABLE_PATH');
const children = [];
const report = { base, code, vsix: path.resolve(vsix), vsixSha: hash(await fs.readFile(vsix)), windows: [] };
console.log(base);
async function prepare(w) {
  const f = w.frame;
  await f.locator('#entry').selectOption('B');
  await f.locator('#driver').selectOption(w.driver);
  await f.locator('#topic').fill(w.topic);
  await f.locator('#body').fill(w.focus);
  await f.locator('#btnPrechain').click();
  await until('前置链', async () => {
    const error = await f.locator('#steps .fail').allTextContents();
    if (error.length) throw new Error(error.join(' '));
    return f.locator('#btnIgnite').isEnabled();
  });
  await f.evaluate(() => {
    window.e1Audit = { leaked: false, messages: 0 };
    const marker = ['sk-', 'unitFixture0123456789', 'abcdefghijk'].join('');
    window.addEventListener('message', e => {
      if (e.data.type === 'stdout') window.e1Audit.messages++;
      if (JSON.stringify(e.data).includes(marker)) window.e1Audit.leaked = true;
    });
    new MutationObserver(() => {
      if (document.querySelector('#runs').textContent.includes(marker)) window.e1Audit.leaked = true;
    }).observe(document.querySelector('#runs'), { childList: true, subtree: true, characterData: true });
  });
}
async function observe(w) {
  const f = w.frame;
  const start = await until('点火返回 ' + w.root, () => json(path.join(w.root, '.trivium/start.json')).catch(() => null));
  const { run_id: runId, run_dir: runDir } = start;
  const card = f.locator('#runs .card').filter({ hasText: runId });
  const result = { root: w.root, topic: w.topic, runId, runDir, profile: w.profile, installedJs: w.installedJs, core: w.core, coreSha: w.coreSha, sides: {} };
  report.windows.push(result);
  const status = () => json(path.join(runDir, 'status.json'));
  const state = await until('工作进程登记', async () => { const s = await status(); return s.worker_pid && s; });
  const cmd = execFileSync('ps', ['-p', String(state.worker_pid), '-o', 'command='], { encoding: 'utf8' }).trim();
  assert.ok(cmd.includes(w.core), cmd);
  result.worker = { pid: state.worker_pid, command: cmd };
  const sides = w.critics.map(id => ({
    id, out: path.join(runDir, id, 'out'), file: name => path.join(w.control, id + '-' + name),
    view: card.locator('.critic-stdout[data-critic="' + id + '"] .log-lines'),
  }));
  for (const s of sides) {
    const p = await until('审核者启动 ' + s.id, () => json(s.file('producer.json')).catch(() => null));
    const meta = await json(path.join(s.out, 'stdout-live.json'));
    const stdout = path.join(s.out, meta.file);
    await until(s.id + ' 磁盘标记', async () => (await fs.readFile(stdout, 'utf8')).includes(p.marker));
    const diskAt = Date.now();
    await s.view.filter({ hasText: p.marker }).waitFor();
    await s.view.scrollIntoViewIfNeeded();
    assert.ok(await s.view.isVisible());
    const domAt = Date.now();
    assert.equal(await fs.stat(s.file('exit.json')).catch(() => null), null);
    assert.match(execFileSync('ps', ['-p', String(p.pid), '-o', 'command='], { encoding: 'utf8' }), /fixture-|controlledCritic/);
    result.sides[s.id] = { ...p, stdout, diskAt, domAt, attempt: meta.attempt };
  }
  await command(w.page, 'Terminal: Kill the Active Terminal Instance');
  await f.locator('#modeBadge.m3').waitFor();
  assert.equal((await status()).phase, 'running');
  for (const s of sides) await fs.writeFile(s.file('release-first'), '');
  for (const s of sides) {
    const r = result.sides[s.id];
    await s.view.filter({ hasText: 'M3-' + r.marker }).waitFor();
    assert.ok((await card.innerText()).includes(w.topic));
    r.m3At = Date.now();
  }
  for (const s of sides) await fs.writeFile(s.file('release-last'), '');
  for (const s of sides) {
    const r = result.sides[s.id];
    const e = await until('退出回执', () => json(s.file('exit.json')).catch(() => null));
    assert.ok(r.sent <= r.diskAt && r.diskAt <= r.domAt && r.domAt <= r.m3At && r.m3At <= e.at);
    const bytes = await until('最终 stdout', async () => {
      const i = await json(path.join(s.out, 'stdout-live.json'));
      return i.state === 'complete' && fs.readFile(r.stdout);
    });
    Object.assign(r, { exitAt: e.at, bytes: bytes.length, sha256: hash(bytes), expected: e });
    assert.equal(r.sha256, e.sha256, s.id);
    assert.equal(bytes.length, e.bytes);
  }
  const archive = path.join(w.root, '.reviews', w.topic, 'plan/_meta', 'run-' + runId + '.json');
  const a = await until('终态归档', async () => {
    const m = await json(archive);
    return ['failed', 'success'].includes(m.status) && m;
  });
  result.diskAudit = await until('逐次写入的磁盘回读', () => json(path.join(w.control, 'disk-audit.json')).catch(() => null));
  for (const id of w.critics) {
    assert.ok(result.diskAudit[id].writes >= 2);
    assert.equal(result.diskAudit[id].leaked, false);
  }
  result.archive = archive;
  result.status = a.status;
  result.audit = await f.evaluate(() => window.e1Audit);
  assert.equal(result.audit.leaked, false);
  assert.ok(result.audit.messages > 0);
  assert.equal(a.status, 'success', archive);
}
try {
  report.packedJsSha = hash(execFileSync('unzip', ['-p', vsix, 'extension/dist/extension.js']));
  report.extensionVersion = JSON.parse(execFileSync('unzip', ['-p', vsix, 'extension/package.json'])).version;
  const windows = [];
  for (const driver of ['claude', 'codex']) {
    const fx = await stdoutWorkspace(base, 'workspace-' + driver, driver, 'controlled');
    const windowBase = path.join(base, driver);
    await fs.mkdir(windowBase);
    await installVsix({ base: windowBase, code, vsix });
    const w = await openWorkspace(fx, { base: windowBase, code, vsix, children });
    w.installedJs = path.join(windowBase, 'extensions', 'triviumcode.trivium-cockpit-' + report.extensionVersion, 'dist/extension.js');
    assert.equal(hash(await fs.readFile(w.installedJs)), report.packedJsSha);
    await prepare(w);
    windows.push(w);
  }
  await Promise.all(windows.map(w => w.frame.locator('#btnIgnite').click()));
  await Promise.all(windows.map(observe));
  report.passed = true;
} finally {
  await fs.writeFile(path.join(base, 'report.json'), JSON.stringify(report, null, 2));
  for (const child of children) child.kill();
}
