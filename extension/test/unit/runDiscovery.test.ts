/** run 目录定位单测（含重试退避：闸门先行、目录后建的窗口，CODEX-02） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { locateRunDir, locateRunDirWithRetry } from '../../src/monitor/runDiscovery';

function fixture(): { runRoot: string; clean: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'trivium-run-disc-'));
  return {
    runRoot: dir,
    clean: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test('按 run_id 浅扫描定位（不复制 repoId 推导）', async () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.runRoot, 'SomeRepo-ab12cd34', '20261106T000000Z'), { recursive: true });
    writeFileSync(path.join(f.runRoot, 'SomeRepo-ab12cd34', '20261106T000000Z', 'status.json'), '{}');
    mkdirSync(path.join(f.runRoot, 'OtherRepo-ffff0000', '19990101T000000Z'), { recursive: true });
    assert.equal(
      await locateRunDir(f.runRoot, '20261106T000000Z'),
      path.join(f.runRoot, 'SomeRepo-ab12cd34', '20261106T000000Z'),
    );
    assert.notEqual(await locateRunDir(f.runRoot, '19990101T000000Z'), null);
    assert.equal(await locateRunDir(f.runRoot, '不存在'), null);
  } finally {
    f.clean();
  }
});

test('运行根不可读 → null（不抛）', () => {
  return locateRunDir(path.join(tmpdir(), 'trivium-不存在-目录'), 'x').then((r) => assert.equal(r, null));
});

test('重试退避：目录在两轮后创建则命中', async () => {
  const f = fixture();
  try {
    const target = path.join(f.runRoot, 'Repo-1-ab12cd34', '20261106T000001Z');
    const sleeps: number[] = [];
    const policy = { intervalMs: 5, rounds: 5 };
    const p = locateRunDirWithRetry(f.runRoot, '20261106T000001Z', policy, { repoHint: 'Repo-1' }, async (ms) => {
      sleeps.push(ms);
      if (sleeps.length === 2) mkdirSync(target, { recursive: true });
    });
    const dir = await p;
    assert.equal(dir, target);
    assert.equal(sleeps.length, 2);
  } finally {
    f.clean();
  }
});

test('重试耗尽仍无目录 → null', async () => {
  const f = fixture();
  try {
    const dir = await locateRunDirWithRetry(f.runRoot, 'x', { intervalMs: 1, rounds: 2 }, {}, async () => {});
    assert.equal(dir, null);
  } finally {
    f.clean();
  }
});

// ── 归属校验（CODEX-02：跨仓同秒 run_id 不得串仓） ─────────────────────────

function writeStatusIn(dir: string, topic: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'status.json'), JSON.stringify({ schema: 'trivium.status.v1', topic, phase: 'running' }));
}

test('跨桶同名 run_id：桶前缀过滤取本仓', async () => {
  const f = fixture();
  try {
    writeStatusIn(path.join(f.runRoot, 'MyRepo-11111111', 'R1'), 'T');
    writeStatusIn(path.join(f.runRoot, 'OtherRepo-22222222', 'R1'), '别的主题');
    const dir = await locateRunDir(f.runRoot, 'R1', { repoHint: 'MyRepo' });
    assert.equal(dir, path.join(f.runRoot, 'MyRepo-11111111', 'R1'));
  } finally {
    f.clean();
  }
});

test('桶前缀不唯一时用 topic 比对判归属', async () => {
  const f = fixture();
  try {
    // 两个同前缀桶（重命名/迁移场景）同名 run：topic 能唯一判别
    writeStatusIn(path.join(f.runRoot, 'MyRepo-11111111', 'R2'), '主题甲');
    writeStatusIn(path.join(f.runRoot, 'MyRepo-22222222', 'R2'), '主题乙');
    const dir = await locateRunDir(f.runRoot, 'R2', { repoHint: 'MyRepo', expectTopic: '主题乙' });
    assert.equal(dir, path.join(f.runRoot, 'MyRepo-22222222', 'R2'));
  } finally {
    f.clean();
  }
});

test('判别不了（同主题同名多桶）→ null 不接管', async () => {
  const f = fixture();
  try {
    writeStatusIn(path.join(f.runRoot, 'MyRepo-11111111', 'R3'), '同主题');
    writeStatusIn(path.join(f.runRoot, 'MyRepo-22222222', 'R3'), '同主题');
    assert.equal(await locateRunDir(f.runRoot, 'R3', { repoHint: 'MyRepo', expectTopic: '同主题' }), null);
  } finally {
    f.clean();
  }
});

test('status.json 未建时不因读不到而崩（候选保留，topic 判别不了则 null）', async () => {
  const f = fixture();
  try {
    mkdirSync(path.join(f.runRoot, 'MyRepo-11111111', 'R4'), { recursive: true });
    writeStatusIn(path.join(f.runRoot, 'MyRepo-22222222', 'R4'), '主题丙');
    const dir = await locateRunDir(f.runRoot, 'R4', { repoHint: 'MyRepo', expectTopic: '主题丙' });
    assert.equal(dir, path.join(f.runRoot, 'MyRepo-22222222', 'R4'));
  } finally {
    f.clean();
  }
});

// ── 负向：绝不接管他仓（CLAUDE-02/CODEX-02 收紧） ─────────────────────────

test('唯一候选但桶前缀不匹配本仓 → 不接管（等本仓目录）', async () => {
  const f = fixture();
  try {
    writeStatusIn(path.join(f.runRoot, 'OtherRepo-12345678', 'R5'), '我的主题');
    assert.equal(await locateRunDir(f.runRoot, 'R5', { repoHint: 'MyRepo', expectTopic: '我的主题' }), null);
    assert.equal(await locateRunDir(f.runRoot, 'R5', { repoHint: 'MyRepo' }), null);
  } finally {
    f.clean();
  }
});

test('topic 明确不匹配（matched=0）→ 不接管', async () => {
  const f = fixture();
  try {
    writeStatusIn(path.join(f.runRoot, 'MyRepo-11111111', 'R6'), '别的主题');
    assert.equal(await locateRunDir(f.runRoot, 'R6', { repoHint: 'MyRepo', expectTopic: '我的主题' }), null);
  } finally {
    f.clean();
  }
});

test('无 repoHint 时多候选不接管、单候选直取（旧调用兼容）', async () => {
  const f = fixture();
  try {
    writeStatusIn(path.join(f.runRoot, 'A-1', 'R7'), 't');
    writeStatusIn(path.join(f.runRoot, 'B-2', 'R7'), 't');
    assert.equal(await locateRunDir(f.runRoot, 'R7'), null);
    writeStatusIn(path.join(f.runRoot, 'C-3', 'R8'), 't');
    assert.equal(await locateRunDir(f.runRoot, 'R8'), path.join(f.runRoot, 'C-3', 'R8'));
  } finally {
    f.clean();
  }
});
