/**
 * run_id 同秒避让（EV-147）：`allocateRunId` 从 `newRunId(now)` 起，被占用（task.json 登记或任一阶段
 * `_meta/run-<id>.json`）就往后抬一秒；格式不变、抬出来的大于被占用者；task.json 读不出时只看文件；用尽抛 69。
 * 另有一格源码护栏：除 `meta.ts` 自身外不得直接调 `newRunId` 分配 run_id（新分配点绕过避让会再撞）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { allocateRunId, newRunId } from '../../src/trivium/meta.js';
import { metaDir } from '../../src/trivium/archive.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import type { StageOrVerify } from '../../src/trivium/types.js';
import { scratchDir } from '../helpers/scratch.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { stripNonCode } from '../helpers/strip-non-code.js';

const TOPIC = 'run_id避让';
const NOW = new Date('2026-10-06T01:02:03.456Z');
const at = (s: number) => newRunId(new Date(NOW.getTime() + s * 1000));

async function layout() {
  const archiveRoot = await scratchDir('trivium-runid-');
  const l = { archiveRoot, topic: TOPIC };
  await fs.mkdir(path.join(archiveRoot, TOPIC), { recursive: true });
  return l;
}

async function register(l: { archiveRoot: string; topic: string }, ids: string[]) {
  const runs = ids.map((run_id) => ({
    run_id, stage: 'plan', rerun_index: 1, status: 'success', review_mode: 'full', started_at: NOW.toISOString(), driver: 'claude',
  }));
  await fs.writeFile(path.join(l.archiveRoot, TOPIC, 'task.json'), JSON.stringify({ topic: TOPIC, runs }, null, 2) + '\n');
}

async function plantMeta(l: { archiveRoot: string; topic: string }, stage: StageOrVerify, id: string) {
  const d = metaDir(l, stage);
  await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(d, `run-${id}.json`), '{}\n');
}

test('EV-147 A1：没有占用 ⇒ 就是 newRunId(now)，格式 YYYYMMDDTHHMMSSZ', async () => {
  const l = await layout();
  const id = await allocateRunId(l, NOW);
  assert.equal(id, '20261006T010203Z');
  assert.equal(id, newRunId(NOW));
});

test('EV-147 A2：task.json 已登记同秒 ⇒ 抬一秒', async () => {
  const l = await layout();
  await register(l, [at(0)]);
  assert.equal(await allocateRunId(l, NOW), at(1));
});

test('EV-147 A3：别的阶段 _meta 里有同名 run.json ⇒ 也算占用（task.json 跨阶段共用键空间）', async () => {
  const l = await layout();
  await plantMeta(l, 'verify', at(0));
  await plantMeta(l, 'code', at(1));
  await plantMeta(l, 'bug', at(2));
  await plantMeta(l, 'plan', at(3));
  const id = await allocateRunId(l, NOW);
  assert.equal(id, at(4));
  assert.ok(id > at(3), '抬出来的 id 字典序大于被占用者');
});

test('EV-147 A4：登记与文件混合占用、中间有空档 ⇒ 取第一个空档', async () => {
  const l = await layout();
  await register(l, [at(0), at(2)]);
  await plantMeta(l, 'plan', at(1));
  assert.equal(await allocateRunId(l, NOW), at(3));
});

test('EV-147 A5：task.json 读不出 ⇒ 不抛，只看文件', async () => {
  const l = await layout();
  await fs.writeFile(path.join(l.archiveRoot, TOPIC, 'task.json'), '{坏');
  assert.equal(await allocateRunId(l, NOW), at(0));
  await plantMeta(l, 'plan', at(0));
  assert.equal(await allocateRunId(l, NOW), at(1));
});

test('EV-147 A6：连续占用超过上限 ⇒ 抛 69，文案点名主题与起点', async () => {
  const l = await layout();
  await register(l, [at(0), at(1), at(2)]);
  await assert.rejects(allocateRunId(l, NOW, 2), (e: { code?: number; message?: string }) => {
    assert.equal(e.code, EXIT.ENV);
    assert.ok(e.message!.includes(TOPIC) && e.message!.includes(at(0)), e.message);
    return true;
  });
  assert.equal(await allocateRunId(l, NOW, 3), at(3), '上限内仍能分到');
});

test('EV-147 A7（源码护栏）：除 meta.ts 外，src/ 不直接调 newRunId 分配 run_id', async () => {
  const root = path.join(REPO_ROOT, 'src');
  const hits: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (p.endsWith('.ts') && path.relative(root, p) !== path.join('trivium', 'meta.ts')) {
        const text = stripNonCode(await fs.readFile(p, 'utf8'));
        if (/\bnewRunId\s*\(/.test(text)) hits.push(path.relative(root, p));
      }
    }
  };
  await walk(root);
  assert.deepEqual(hits, [], `分配 run_id 应走 allocateRunId（同秒避让），直接调 newRunId 的：${hits.join('、')}`);
});
