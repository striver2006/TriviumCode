// 真实安装态覆盖旧核心、隐藏/恢复、取消、重试和磁盘故障，并独立计量空闲期。
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolveCliPathFromVSCodeExecutablePath } from '@vscode/test-electron';
import { installVsix, openWorkspace, until } from '../test/e2e/workbench.mjs';
import { stdoutWorkspace } from '../test/e2e/stdoutWorkspace.mjs';
import { portForHost, hostCounters } from '../test/e2e/hostCounters.mjs';
const exec = promisify(execFile);
const base = await fs.realpath(await fs.mkdtemp('/tmp/tv-e1-life-'));
const vsix = process.env.TRIVIUM_TEST_VSIX;
const code = process.env.VSCODE_EXECUTABLE_PATH;
const children = [];
const hash = data => createHash('sha256').update(data).digest('hex');
const packed = JSON.parse(execFileSync('unzip',['-p',vsix,'extension/package.json']));
const installedJs = path.join(base,'extensions',packed.publisher + '.' + packed.name + '-' + packed.version, packed.main);
const report = { base, vsix, vsixSha: hash(await fs.readFile(vsix)), installedJs,
  packedJsSha: hash(execFileSync('unzip',['-p',vsix,'extension/' + packed.main.replace(/^\.\//,'')])), scenarios: [] };
const json = async f => JSON.parse(await fs.readFile(f, 'utf8'));
console.log(base);
async function scenario(kind) {
  const baseline = kind === 'idle-baseline';
  const legacy = kind === 'legacy' || baseline;
  const fx = await stdoutWorkspace(base, kind, 'codex', 'latch', legacy ? process.env.TRIVIUM_BASELINE_ASSETS : undefined);
  const port = await portForHost();
  const w = await openWorkspace(fx, { base, code, vsix, children, inspectExtensions: port });
  const measure = await hostCounters(port);
  const draws = [], messages = [];
  try {
    const tv = async (...args) => {
      const { stdout } = await exec(path.join(w.root, '.trivium/bin/trivium'), [...args, '--json'], { cwd: w.root });
      return stdout.trim() ? JSON.parse(stdout) : null;
    };
    if (kind === 'fault') await fs.writeFile(path.join(w.control, 'fault.json'), JSON.stringify({ claude: 'short', gemini: 'permanent', glm: 'slow' }));
    if (['retry','voided','timeout'].includes(kind)) {
      const wrapper = path.join(w.root, '.trivium/bin/trivium');
      const specs = Object.fromEntries(w.critics.map(id => [id, { stdout:'latch', mode:'ok', findings:0 }]));
      specs.claude.attempts = kind === 'retry' ? [{ stdout:'latch', mode:'fail', note:'ECONNRESET' }, { stdout:'latch', mode:'ok', findings:0 }] : [{ stdout:'timeout', mode:'timeout' }];
      if (kind === 'voided') specs.claude = { stdout:'latch', mode:'peer_leak', rerun:{ stdout:'latch', mode:'ok', findings:0 } };
      await fs.writeFile(wrapper, (await fs.readFile(wrapper,'utf8')).replace(/^export TRIVIUM_STUB_CRITIC=.*$/m, "export TRIVIUM_STUB_CRITIC='" + JSON.stringify(specs) + "'"));
    }
    const start = await tv('review','--start','--entry','B','--stage','plan','--topic',w.topic,'--driver',w.driver,
      '--critics',w.critics.join(','),'--focus',w.focus);
    const card = w.frame.locator('#runs .card').filter({hasText:start.run_id});
    const r = { kind, runId: start.run_id, runDir: start.run_dir, core: w.core, coreSha: w.coreSha, sides:{} };
    report.scenarios.push(r);
    const dir = id => path.join(start.run_dir, id, 'out');
    const read = (id, name) => json(path.join(dir(id), name));
    await until('实际管道发出首批', () => Promise.all(w.critics.map(id => read(id,'producer.json'))).catch(() => null));
    const release = n => Promise.all(w.critics.map(id => fs.writeFile(path.join(dir(id),'release-' + n), '')));
    if (baseline) await card.locator('.phase.running').waitFor();
    else if (legacy) {
      await card.getByText(/未提供实时 stdout 记录/).first().waitFor();
      assert.equal(await card.locator('.critic-stdout .log-lines').allTextContents().then(a => a.join('')), '');
    } else if (kind === 'fault') {
      await card.getByText(/实时写入暂缓/).first().waitFor();
    } else {
      await card.locator('.critic-stdout .log-lines').filter({hasText:'E1-'}).first().waitFor();
    }
    if (kind === 'hidden' || baseline) {
      await w.page.exposeFunction('e1Observed', (type, at) => (type === 'paint' ? draws : messages).push(at));
      const observePanel = () => {
        if (window.e1ActivityObserved) return;
        window.e1ActivityObserved = true;
        new MutationObserver(mutations => {
          if (mutations.some(m => m.target.parentElement?.closest('.critic-stdout'))) window.e1Observed('paint', Date.now());
        }).observe(document.getElementById('runs'), { subtree: true, characterData: true, childList: true });
        window.addEventListener('message', e => { if (e.data.type === 'stdout') window.e1Observed('message', Date.now()); });
      };
      await w.frame.evaluate(observePanel);
      r.beforeHide = await measure.sample();
      if (!baseline) assert.ok(r.beforeHide.live > 0 && r.beforeHide.opens > 0, '已验证监视器能观察到活动');
      await exec(resolveCliPathFromVSCodeExecutablePath(code), ['--user-data-dir', w.profile, '--extensions-dir', path.join(base,'extensions'), '--reuse-window', path.join(w.root,'README.md')]);
      await w.page.locator('.tab.active').filter({hasText:'README.md'}).waitFor();
      await until('隐藏后释放文件监听', async () => (await measure.sample()).live === 0);
      r.hiddenStart = await measure.sample();
      await release(0);
      await sleep(1500);
      r.hiddenEnd = await measure.sample();
      assert.equal(r.hiddenStart.opens, r.hiddenEnd.opens);
      assert.equal(r.hiddenStart.timers, r.hiddenEnd.timers);
      r.reopenedAt = Date.now();
      await w.page.locator('.tab').filter({hasText:'Trivium 驾驶舱'}).first().click();
      const activeFrame = await until('恢复驾驶舱上下文', async () => {
        for (const f of w.page.frames()) if (await f.locator('#runs .card').count()) return f;
      });
      if (!baseline) await Promise.all(w.critics.map(id => activeFrame.locator('.critic-stdout .log-lines').filter({hasText:'E1-' + start.run_id + '-' + id + '-1'}).waitFor()));
      r.restoredAt = Date.now();
      await activeFrame.evaluate(observePanel);
      r.hiddenMessages = messages.filter(t => t >= r.hiddenStart.at && t <= r.hiddenEnd.at).length;
      r.hiddenPaints = draws.filter(t => t >= r.hiddenStart.at && t <= r.hiddenEnd.at).length;
      assert.equal(r.hiddenMessages, 0);
      assert.equal(r.hiddenPaints, 0);
      if (!baseline) assert.ok(r.restoredAt-r.reopenedAt <= 1000, '恢复尾部超过一秒');
    } else if (kind !== 'cancel') await release(0);
    if (kind === 'cancel') await tv('review','--cancel', start.run_id);
    else await release(1);
    if (kind === 'voided') {
      const moved = path.join(start.run_dir,'voided','claude','attempt-1','stdout-live.json');
      await until('首尝试已作废，重跑已发出第一批', async () => (await json(moved).catch(() => null))?.attempt === 1 && (await read('claude','producer.json').catch(() => null))?.samples.length > 0);
      await Promise.all([0,1].map(n => fs.writeFile(path.join(dir('claude'),'release-' + n),'')));
      r.voidedInfo = await json(moved);
    }
    const ended = await until('运行已结束', async () => {
      const s = await json(path.join(start.run_dir, 'status.json'));
      return ['failed','cancelled','success'].includes(s.phase) && s;
    }, 90);
    r.phase = ended.phase;
    assert.equal(r.phase, kind === 'cancel' ? 'cancelled' : kind === 'timeout' ? 'failed' : 'success');
    for (const id of w.critics) {
      const i = await read(id, 'stdout-live.json').catch(() => null);
      r.sides[id] = i;
      if (legacy) assert.equal(i, null);
      else if (kind === 'cancel') assert.equal(i.state,'incomplete');
      else if (kind === 'fault') {
        assert.equal(i.state, {claude:'complete', gemini:'incomplete', glm:'recovered'}[id]);
        const summary = card.locator('.critic-stdout[data-critic="' + id + '"] summary');
        await summary.filter({ hasText: {claude:'完整记录',gemini:'完整性未确认',glm:'已恢复'}[id] }).waitFor();
        const content = await fs.readFile(path.join(dir(id),i.file),'utf8');
        const expected = [0,1].map(n => ('E1-' + start.run_id + '-' + id + '-' + n).padEnd(255,'.') + '\n').join('');
        assert.equal(content, id === 'gemini' ? '' : expected);
      }
      else if (kind === 'timeout' && id === 'claude') {
        assert.equal(i.state,'incomplete'); assert.equal(i.reason,'timeout');
      } else assert.equal(i.state,'complete');
      if (kind === 'voided' && id === 'claude') assert.equal(i.attempt, 2);
      if (kind === 'retry' && id === 'claude') {
        assert.equal(i.attempt, 2);
        assert.equal((await read(id,'attempt-1/stdout-live.json')).attempt, 1);
      }
    }
    if (kind === 'timeout') await card.locator('.critic-stdout[data-critic="claude"] summary').filter({ hasText:'超时' }).waitFor();
    if (kind !== 'cancel') {
      const meta = await json(path.join(w.root,'.reviews',w.topic,'plan/_meta','run-' + start.run_id + '.json'));
      assert.ok(Object.values(meta.critics).every(c => c.cli_version === 'stub/0.0.0'));
    }
    await until('终态释放全部 stdout 监听', async () => (await measure.sample()).live === 0);
    if (kind === 'hidden' || baseline) {
      r.idle = [];
      await sleep(1500);
      for (let i=0; i<5; i++) {
        const before = await measure.sample();
        await sleep(60000);
        const after = await measure.sample();
        const between = t => t >= before.at && t <= after.at;
        const ipc = messages.filter(between).length, paints = draws.filter(between).length;
        r.idle.push({ before, after, ipc, paints });
        assert.equal(ipc,0); assert.equal(paints,0);
        assert.equal(after.opens, before.opens);
        assert.equal(after.timers, before.timers);
        assert.equal(after.live, 0);
      }
    }
    console.log(kind, r.runId, r.phase);
  } finally {
    measure.close();
    w.child.kill();
  }
}
try {
  await installVsix({ base, code, vsix });
  report.installedJsSha = hash(await fs.readFile(installedJs));
  assert.equal(report.installedJsSha,report.packedJsSha);
  for (const kind of process.argv.slice(2)) await scenario(kind);
} finally {
  await fs.writeFile(path.join(base,'report.json'),JSON.stringify(report,null,2));
  for (const child of children) if (!child.killed) child.kill();
}
