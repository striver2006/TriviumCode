// 对照未经桩改造的基线，将每次唯一标记归一后逐字节核对内容及归档。
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stdoutWorkspace } from '../test/e2e/stdoutWorkspace.mjs';
import { until } from '../test/e2e/workbench.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const base = await fs.realpath(await fs.mkdtemp('/tmp/tv-e1-archive-'));
const baseline = path.join(base, 'baseline');
await fs.mkdir(baseline);
const tar = path.join(base, 'source.tar');
execFileSync('git', ['archive', '--output', tar, '589525fd', 'src', 'scripts', 'skills', 'package.json'], { cwd: root });
execFileSync('tar', ['xf', tar, '-C', baseline]);
await fs.symlink(path.join(root, 'node_modules'), path.join(baseline, 'node_modules'), 'dir');
execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: baseline, stdio: 'pipe' });

const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const current = await json(process.argv[2]);
const report = { base, baseline: '589525fd', windows: [] };
console.log(base);
for (const driver of ['claude', 'codex']) {
  const w = await stdoutWorkspace(base, 'workspace-' + driver, driver, 'controlled', path.join(baseline, 'skills/dual-critic'));
  const start = JSON.parse(execFileSync(path.join(w.root, '.trivium/bin/trivium'), [
    'review', '--start', '--entry', 'B', '--stage', 'plan', '--topic', w.topic, '--driver', driver,
    '--critics', w.critics.join(','), '--focus', w.focus, '--json',
  ], { cwd: w.root, encoding: 'utf8' }));
  const currentWindow = current.windows.find(entry => entry.topic === w.topic);
  const row = { topic: w.topic, baselineRun: start.run_id, e1Run: currentWindow.runId,
    baselineCore: w.core, baselineCoreSha: w.coreSha, e1CoreSha: currentWindow.coreSha, sides: {} };
  for (const id of w.critics) {
    await until('基线子进程就绪', () => json(path.join(w.control, id + '-producer.json')).catch(() => null));
  }
  for (const stage of ['first', 'last']) {
    await Promise.all(w.critics.map(id => fs.writeFile(path.join(w.control, id + '-release-' + stage), '')));
  }

  const metaDir = path.join(w.root, '.reviews', w.topic, 'plan/_meta');
  const meta = await until('基线归档', async () => {
    const m = await json(path.join(metaDir, 'run-' + start.run_id + '.json')).catch(() => null);
    return m?.status === 'success' && m;
  });
  const e1 = await json(currentWindow.archive);
  for (const field of ['schema', 'effective_failure_policy', 'critics_selected', 'status', 'round_verdict', 'review_loop', 'gate']) {
    assert.deepEqual(meta[field], e1[field], field);
  }
  row.roundVerdict = meta.round_verdict;
  row.gateState = meta.gate.state;
  assert.equal(meta.gate.state, e1.gate.state);
  for (const id of w.critics) {
    const producer = await json(path.join(w.control, id + '-producer.json'));
    const exit = await json(path.join(w.control, id + '-exit.json'));
    const side = currentWindow.sides[id];
    const bytes = await fs.readFile(path.join(start.run_dir, id, 'out', path.basename(side.stdout)));
    assert.equal(hash(bytes), exit.sha256);
    const normalized = bytes.toString().replaceAll(producer.marker, 'MARK');
    assert.equal((await fs.readFile(side.stdout, 'utf8')).replaceAll(side.marker, 'MARK'), normalized);
    const expected = await json(path.join(metaDir, 'review-' + id + '-' + start.run_id + '.json'));
    const actual = await json(path.join(path.dirname(currentWindow.archive), 'review-' + id + '-' + currentWindow.runId + '.json'));
    assert.deepEqual(actual, expected);
    const evidence = {};
    for (const field of ['cli_version','evidence_ok','tool_calls','parse_fallback','parse_repairs','findings_degraded','empty_review','status','exit_code']) {
      assert.deepEqual(meta.critics[id][field], e1.critics[id][field], id + '/' + field);
      evidence[field] = e1.critics[id][field];
    }
    row.sides[id] = { evidence, baselineSha: hash(bytes), e1Sha: side.sha256, normalizedSha: hash(normalized),
      reviewSha: hash(JSON.stringify(expected)), status: meta.critics[id].status };
  }
  report.windows.push(row);
}
await fs.writeFile(path.join(base, 'report.json'), JSON.stringify(report, null, 2));
console.log('通过');
