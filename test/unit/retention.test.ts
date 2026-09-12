import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { promises as fs } from 'node:fs';
import { pruneRunDirs } from '../../src/trivium/retention.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { repoId } from '../../src/trivium/review.js';
import { newStatus, writeStatus } from '../../src/trivium/status.js';
import { processStartTime } from '../../src/trivium/util/exec.js';

const DAY = 86_400_000;

async function bucket() {
  const runRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ret-'));
  const projectRoot = '/tmp/some-project';
  const cfg = defaultConfig();
  cfg.runtime.run_root = runRoot;
  const b = path.join(runRoot, repoId(projectRoot));
  await fs.mkdir(b, { recursive: true });
  return { cfg, projectRoot, b };
}

/** 把目录连同 status.json 的心跳一起「变老」：writeStatus 每次都会把 heartbeat_at 刷成现在 */
async function age(dir: string, days: number) {
  const t = new Date(Date.now() - days * DAY);
  const sp = path.join(dir, 'status.json');
  try {
    const s = JSON.parse(await fs.readFile(sp, 'utf8')) as { heartbeat_at: string };
    s.heartbeat_at = t.toISOString();
    await fs.writeFile(sp, JSON.stringify(s), 'utf8');
  } catch { /* 没有 status.json 的残留目录 */ }
  for (const f of await fs.readdir(dir)) await fs.utimes(path.join(dir, f), t, t);
  await fs.utimes(dir, t, t);
}

test('超过 run_dir_days 的终态运行目录被删，新的保留', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const old = path.join(b, 'R-old');
  const fresh = path.join(b, 'R-fresh');
  for (const d of [old, fresh]) {
    await fs.mkdir(d);
    const s = newStatus({ runId: path.basename(d), topic: 't', stage: 'plan', sides: [], models: {} });
    s.phase = 'success';
    await writeStatus(d, s);
  }
  await age(old, 40);
  const r = await pruneRunDirs(cfg, projectRoot);
  assert.deepEqual(r.removed, [old]);
  assert.equal(r.kept, 1);
  await assert.rejects(fs.access(old));
  await fs.access(fresh);
});

test('仍在跑的运行（worker 活着）无论多老都不动', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const d = path.join(b, 'R-running');
  await fs.mkdir(d);
  const s = newStatus({ runId: 'R-running', topic: 't', stage: 'plan', sides: [], models: {} });
  s.phase = 'running';
  s.worker_pid = process.pid;
  s.worker_started_at = await processStartTime(process.pid);
  await writeStatus(d, s);
  await age(d, 90);
  const r = await pruneRunDirs(cfg, projectRoot);
  assert.deepEqual(r.removed, []);
  await fs.access(d);
});

test('没有 status.json 的残留目录按 mtime 处理；run_dir_days 为 0 时不清理', async () => {
  const { cfg, projectRoot, b } = await bucket();
  const junk = path.join(b, 'R-junk');
  await fs.mkdir(junk);
  await age(junk, 60);
  cfg.retention.run_dir_days = 0;
  assert.deepEqual((await pruneRunDirs(cfg, projectRoot)).removed, []);
  cfg.retention.run_dir_days = 30;
  assert.deepEqual((await pruneRunDirs(cfg, projectRoot, { dryRun: true })).removed, [junk]);
  await fs.access(junk, undefined);
  assert.deepEqual((await pruneRunDirs(cfg, projectRoot)).removed, [junk]);
});

test('只清本项目的桶，别的项目的运行目录不碰', async () => {
  const { cfg, projectRoot } = await bucket();
  const other = path.join(cfg.runtime.run_root, 'other-project-deadbeef', 'R1');
  await fs.mkdir(other, { recursive: true });
  await age(other, 100);
  await pruneRunDirs(cfg, projectRoot);
  await fs.access(other);
});
