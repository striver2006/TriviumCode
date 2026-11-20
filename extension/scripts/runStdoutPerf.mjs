// 在同一台 Mac 上交替运行基线和 E1。每轮单独启动安装态工作台和三侧 worker。
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { stdoutWorkspace } from '../test/e2e/stdoutWorkspace.mjs';
import { portForHost, hostCounters } from '../test/e2e/hostCounters.mjs';
import { baseline } from '../test/e2e/perfBaseline.mjs';
import { openWorkspace, installVsix, until } from '../test/e2e/workbench.mjs';
import { extensionRoot } from '../test/e2e/workspace.mjs';
const exec = promisify(execFile);
const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const base = await fs.realpath(await fs.mkdtemp('/tmp/tv-e1p-'));
console.log(base);
const code = process.env.VSCODE_EXECUTABLE_PATH;
assert.ok(code);
const variants = [
  { id: 'base', assets: await baseline(base), vsix: path.join(extensionRoot, 'trivium-cockpit-0.3.0-glm-relay.vsix') },
  { id: 'e1', assets: process.env.TRIVIUM_E1_ASSETS || path.resolve(extensionRoot, '../skills/dual-critic'), vsix: process.env.TRIVIUM_TEST_VSIX },
];
for (const v of variants) {
  v.base = path.join(base, v.id);
  await fs.mkdir(v.base);
  await installVsix({ ...v, code });
  v.vsixSha = createHash('sha256').update(await fs.readFile(v.vsix)).digest('hex');
}
const children = [];
async function hostPid(profile) {
  let entries = [];
  for await (const file of fs.glob('logs/*/window*/exthost/exthost.log', { cwd: profile })) entries.push(file);
  const m = /Extension host with pid (\d+) started/.exec(await fs.readFile(path.join(profile, entries.sort().at(-1)), 'utf8'));
  return Number(m[1]);
}
async function sample(pid) {
  const { stdout } = await exec('ps', ['-p', String(pid), '-o', 'time=,rss=']);
  const [time, rss] = stdout.trim().split(/\s+/);
  return { at: Date.now(), cpu: time.split(':').reduce((t, n) => t * 60 + Number(n), 0), rssKiB: Number(rss) };
}
async function observe(frame, every) {
  await frame.evaluate(every => {
    window.perfSample = { received: {}, visible: {} };
    const box = document.getElementById('runs');
    const marks = /E1-[A-Za-z0-9-]+-(\d+)\./g;
    let drawing = false;
    function draw() {
      drawing = false;
      const cards = box.querySelectorAll('.critic-stdout');
      if (cards.length) cards[Math.floor(cards.length / 2)].scrollIntoView({ block: 'center' });
      for (const details of cards) {
        const port = details.querySelector('.log').getBoundingClientRect();
        const node = details.querySelector('pre').firstChild;
        if (!node || !details.open) continue;
        for (const m of node.textContent.matchAll(marks)) {
          if (Number(m[1]) % every) continue;
          const key = m[0].slice(0, -1);
          if (window.perfSample.visible[key]) continue;
          const range = new Range();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + key.length);
          const r = range.getBoundingClientRect();
          if (r.top + r.height / 2 >= Math.max(port.top, 0) && r.bottom - r.height / 2 <= Math.min(port.bottom, innerHeight)
              && r.left >= Math.max(port.left, 0) - 1 && r.right <= Math.min(port.right, innerWidth) + 1) {
            window.perfSample.visible[key] = Date.now();
          }
        }
      }
    }
    new MutationObserver(() => {
      if (!drawing) { drawing = true; requestAnimationFrame(draw); }
    }).observe(box, { childList: true, characterData: true, subtree: true });
    window.addEventListener('message', e => {
      if (e.data.type !== 'stdout') return;
      for (const m of e.data.text.matchAll(marks)) {
        if (!(Number(m[1]) % every)) window.perfSample.received[m[0].slice(0, -1)] ??= Date.now();
      }
    });
  }, every);
}
async function trial(v, mode, round) {
  const count = mode === 'dense' ? 512 : 60;
  const size = mode === 'dense' ? 16384 : 256;
  const every = mode === 'dense' ? 25 : 4;
  const fx = await stdoutWorkspace(v.base, mode + round, 'codex', mode, v.assets);
  const inspectExtensions = process.env.TRIVIUM_PERF_TRACE === '1' ? await portForHost() : undefined;
  const w = await openWorkspace(fx, { ...v, code, children, inspectExtensions });
  const probe = inspectExtensions ? await hostCounters(inspectExtensions) : undefined;
  await probe?.traceReads();
  await w.page.bringToFront();
  // 三侧视口须同时落在桌面，缩放与运行负载无关，两版一致。
  for (let i = 0; i < 3; i++) await w.page.keyboard.press('Meta+-');
  await observe(w.frame, every);
  const extPid = await hostPid(w.profile);
  const host = [await sample(extPid)];
  let stop = false;
  const meter = (async () => {
    while (!stop) { await sleep(100); host.push(await sample(extPid)); }
  })();
  let result;
  try {
    const started = Date.now();
    const start = JSON.parse(execFileSync(path.join(w.root, '.trivium/bin/trivium'), ['review','--start','--entry','B',
      '--stage','plan','--topic',w.topic,'--driver',w.driver,'--critics',w.critics.join(','),'--focus',w.focus,'--json'],
    { cwd: w.root, encoding: 'utf8' }));
    const status = path.join(start.run_dir, 'status.json');
    const ended = await until('审查终态', async () => {
      const s = await json(status);
      return ['success','failed','cancelled'].includes(s.phase) && s;
    }, 90);
    const end = Date.now();
    stop = true;
    await meter;
    assert.equal(ended.phase, 'success');
    const worker = await until('退出计量', () => json(path.join(w.control, 'worker-' + ended.worker_pid + '.json')).catch(() => null));
    assert.equal(worker.core, w.core);
    const ui = await w.frame.evaluate(() => window.perfSample);
    const reads = await probe?.reads();
    const archive = await json(path.join(w.root, '.reviews', w.topic, 'plan/_meta', 'run-' + start.run_id + '.json'));
    result = { variant: v.id, round, mode, start, started, end, elapsedMs: end - started, worker, host, extPid,
      hostCpu: host.at(-1).cpu - host[0].cpu, hostPeakKiB: Math.max(...host.map(x => x.rssKiB)),
      coreCpu: (worker.usage.userCPUTime + worker.usage.systemCPUTime)/1e6, corePeakKiB: worker.usage.maxRSS,
      coreSha: w.coreSha, vsix: v.vsix, vsixSha: v.vsixSha, sides: {} };
    for (const id of w.critics) {
      assert.equal(archive.critics[id].cli_version, 'stub/0.0.0');
      const out = path.join(start.run_dir, id, 'out');
      const producer = await json(path.join(out, 'producer.json'));
      const stat = await fs.stat(path.join(out, 'stdout.jsonl'));
      assert.equal(stat.size, count * size);
      const samples = producer.samples.filter((_, i) => i % every === 0).map(s => ({
        ...s, received: ui.received[s.mark] ?? null, visible: ui.visible[s.mark] ?? null,
      }));
      const delays = samples.filter(s => s.visible).map(s => s.visible-s.sent).sort((a,b) => a-b);
      const writes = worker.writes.filter(x => path.dirname(x.file) === out);
      if (reads) {
        const file = path.join(out,'stdout.jsonl');
        let position = 0;
        const completed = writes.filter(w => w.file === file).map(w => ({end:position += w.bytes,at:w.at}));
        for (const [index, sample] of samples.entries()) {
          const offset = index * every * size;
          const end = offset + Buffer.byteLength(sample.mark);
          sample.diskAt = completed.find(w => w.end >= end)?.at ?? null;
          sample.readAt = reads.find(r => r.file === file && r.start <= offset && r.end >= end)?.at ?? null;
          if (v.id === 'e1') assert.ok(sample.sent <= sample.diskAt && sample.diskAt <= sample.readAt &&
            sample.readAt <= sample.received && sample.received <= sample.visible, sample.mark);
        }
      }
      const bytes = writes.filter(x => path.basename(x.file) === 'stdout.jsonl').reduce((a,x) => a+x.bytes, 0);
      const metadata = writes.filter(x => path.basename(x.file).startsWith('stdout-live.')).reduce((a,x) => a+x.bytes,0);
      result.sides[id] = { samples, bytes, expectedBytes: stat.size, metadata, fingerprint: archive.critics[id].cli_version,
        missing: samples.length-delays.length, p95Ms: delays[Math.ceil(delays.length*.95)-1] ?? null };
    }
    return result;
  } finally {
    stop = true;
    await meter;
    probe?.close();
    w.child.kill();
  }
}
try {
  for (let round = 0; round <= Number(process.env.TRIVIUM_PERF_ROUNDS ?? 5); round++) {
    for (const mode of ['sparse','dense']) for (const v of (round % 2 ? [...variants].reverse() : variants)) {
      if (process.env.TRIVIUM_PERF_VARIANT && v.id !== process.env.TRIVIUM_PERF_VARIANT) continue;
      const r = await trial(v, mode, round);
      const file = path.join(base, v.id + '-' + mode + '-' + round + '.json');
      await fs.writeFile(file, JSON.stringify(r));
      console.log(file, r.elapsedMs, Object.values(r.sides).map(s => [s.missing, s.p95Ms, s.bytes]));
    }
  }
} finally { for (const p of children) if (!p.killed) p.kill(); }
