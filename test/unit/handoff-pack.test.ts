import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packSnapshots, unpackSnapshots } from '../../src/trivium/run-protocol.js';
import { EXIT, exitCodeOf } from '../../src/trivium/exit-codes.js';
import { sha256 } from '../../src/trivium/util/fsx.js';
import type { Snapshot } from '../../src/trivium/freeze.js';
import type { CriticId } from '../../src/trivium/types.js';

/*
 * 交接文件里的冻结补丁只存一份（EV-236 A2，M12 批次 5；计划 r2 §3 / §4 U7）。
 * 往返后与去重前逐字段相等；旧格式原样读出；新格式坏了一律受控 envError（计划双审 AGY-02 / AGY-03）。
 */

const DIFF = 'diff --git a/x.ts b/x.ts\n+SENTINEL_DIFF_LINE_8d1c\n'.repeat(3);
const SIDES: CriticId[] = ['codex', 'glm', 'gemini'];

function snap(diffText: string | null, over: Partial<Snapshot> = {}): Snapshot {
  return {
    gitHead: 'a'.repeat(40), treeHash: 'b'.repeat(40), dirty: true,
    subjectSha256: diffText === null ? 'c'.repeat(64) : sha256(diffText),
    subjectPath: '/p/.reviews/T/code/_meta/changes-1.diff', denyPaths: ['.env'], diffText, takenAt: 't', ...over,
  };
}

const codeSnaps = (): Record<string, Snapshot> => Object.fromEntries(SIDES.map((c) => [c, snap(DIFF)]));
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

function assertEnvError(fn: () => unknown, re: RegExp): void {
  assert.throws(fn, (e: unknown) => {
    assert.equal(exitCodeOf(e), EXIT.ENV);
    assert.match((e as Error).message, re);
    return true;
  });
}

test('U7 code 阶段三侧：落盘后快照里正文零份、frozen_diff 一份；往返与原对象逐字段相等；入参不被改', () => {
  const original = codeSnaps();
  const before = structuredClone(original);
  const packed = packSnapshots(original);
  assert.deepEqual(original, before, 'pack 不得改入参：--start 同进程后面看到的仍是原对象');
  assert.ok(packed.frozen_diff);
  assert.equal(packed.frozen_diff.sha256, sha256(DIFF));
  const onDisk = JSON.parse(JSON.stringify({ stage: 'code', snapshots: packed.snapshots, frozen_diff: packed.frozen_diff }));
  assert.equal(count(JSON.stringify(onDisk.snapshots), 'SENTINEL_DIFF_LINE_8d1c'), 0);
  assert.equal(count(JSON.stringify(onDisk), 'SENTINEL_DIFF_LINE_8d1c'), 3, '只剩 frozen_diff 那一份（正文里本就重复 3 行）');
  for (const c of SIDES) assert.equal(onDisk.snapshots[c].diffText, null);
  assert.deepEqual(unpackSnapshots(onDisk, 'R'), before);
});

test('U7 plan 阶段（各侧 diffText 为 null）与空快照：原样，不出 frozen_diff', () => {
  const plan = Object.fromEntries(SIDES.map((c) => [c, snap(null)]));
  const p = packSnapshots(plan);
  assert.equal(p.frozen_diff, undefined);
  assert.equal(p.snapshots, plan);
  assert.deepEqual(unpackSnapshots({ stage: 'plan', snapshots: plan }, 'R'), plan);
  const empty = packSnapshots({});
  assert.equal(empty.frozen_diff, undefined, '空快照不得提取（AGY-03）');
});

test('U7 各侧正文不一致（防御）：不收，原样写', () => {
  const s = codeSnaps();
  s['glm'] = snap(DIFF + 'x');
  const p = packSnapshots(s);
  assert.equal(p.frozen_diff, undefined);
  assert.equal(p.snapshots, s);
});

test('U7 旧格式（各侧各带正文、无 frozen_diff）原样读出', () => {
  const old = codeSnaps();
  assert.equal(unpackSnapshots({ stage: 'code', snapshots: old }, 'R'), old);
});

test('U7 新格式被改坏：各种篡改一律 envError，指名运行', () => {
  const good = () => {
    const p = packSnapshots(codeSnaps());
    return JSON.parse(JSON.stringify({ stage: 'code', snapshots: p.snapshots, frozen_diff: p.frozen_diff }));
  };
  let h = good();
  h.frozen_diff.text += 'tampered';
  assertEnvError(() => unpackSnapshots(h, 'R1'), /运行 R1 的交接文件已损坏：冻结补丁的正文与它的 sha256 对不上/);

  h = good();
  h.snapshots.glm.diffText = DIFF;
  assertEnvError(() => unpackSnapshots(h, 'R'), /glm 侧快照既带补丁正文/);

  h = good();
  h.snapshots.gemini.subjectSha256 = 'f'.repeat(64);
  assertEnvError(() => unpackSnapshots(h, 'R'), /gemini 侧快照的被审对象哈希与冻结补丁对不上/);

  for (const bad of [null, 'text', 42, { text: 1, sha256: 'x' }, { text: 'x' }]) {
    h = good();
    h.frozen_diff = bad;
    assertEnvError(() => unpackSnapshots(h, 'R'), /冻结补丁的形态不对/);
  }

  h = good();
  h.stage = 'plan';
  assertEnvError(() => unpackSnapshots(h, 'R'), /plan 阶段不该带冻结补丁/);

  h = good();
  delete h.frozen_diff;
  assertEnvError(() => unpackSnapshots(h, 'R'), /code 阶段有一侧快照没有补丁正文/);
});
