/** runHistory 单测（r2 计划 D9′：第一事实源 + run_root 探测纪律） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listTopics, listRuns } from '../../src/history/runHistory';

/** 内存文件系统 */
function fsOf(map: Record<string, string>) {
  const fsApi = {
    async readdir(p: string): Promise<string[]> {
      const dir = p.replace(/\/$/, '');
      const prefix = `${dir}/`;
      const out = new Set<string>();
      for (const k of Object.keys(map)) {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          if (rest.length > 0) out.add(rest.split('/')[0]!);
        }
      }
      return [...out];
    },
    async readFile(p: string): Promise<string> {
      const v = map[p];
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
  };
  return fsApi;
}

function reviewJson(critic: string, verdict: string, sevs: string[]): string {
  const findings = sevs.map((s, i) => ({
    id: `${critic.toUpperCase()}-${String(i + 1).padStart(2, '0')}`, severity: s, layer: 'code', kind: 'correctness',
    location: 'src/a.ts:1', problem: 'p', evidence: 'e', suggestion: 's', confidence: 'high',
  }));
  return JSON.stringify({ schema: 'trivium.review.v2', verdict, summary: 's', findings });
}

const ROOT = '/ws/.reviews';

test('listTopics：扫 task.json 主题目录，按更新时间倒序', async () => {
  const fs = fsOf({
    [`${ROOT}/主题A/task.json`]: JSON.stringify({ topic: '主题A', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', runs: [{ run_id: 'r1', status: 'success' }], drivers: { plan: { driver: 'glm' } } }),
    [`${ROOT}/主题B/task.json`]: JSON.stringify({ topic: '主题B', updated_at: '2026-01-05T00:00:00Z', runs: [] }),
    [`${ROOT}/无task目录/其他.md`]: '# 无 task.json',
  });
  const out = await listTopics(fs, ROOT);
  assert.equal(out.length, 2);
  assert.equal(out[0]!.topic, '主题B'); // 更新时间倒序
  assert.equal(out[1]!.runCount, 1);
  assert.deepEqual(out[1]!.drivers, ['glm']);
});

test('listRuns：_meta/run-*.json 第一事实源 + review 统计（AGY-05）', async () => {
  const runId = '20260101T000000Z';
  const map: Record<string, string> = {
    [`${ROOT}/主题A/task.json`]: JSON.stringify({
      topic: '主题A',
      runs: [{ run_id: runId, stage: 'code', rerun_index: 1, status: 'success', driver: 'glm', started_at: '2026-01-01T00:01:00Z' }],
    }),
    [`${ROOT}/主题A/code/_meta/run-${runId}.json`]: JSON.stringify({ run_id: runId, stage: 'code', rerun_index: 1, driver: 'glm', critics_selected: ['claude', 'gemini'], started_at: '2026-01-01T00:01:00Z', finished_at: '2026-01-01T00:10:00Z' }),
    [`${ROOT}/主题A/code/_meta/review-claude-${runId}.json`]: reviewJson('claude', 'pass-after-changes', ['blocker', 'major']),
    [`${ROOT}/主题A/code/_meta/review-gemini-${runId}.json`]: reviewJson('gemini', 'reject', ['minor']),
  };
  let probed = 0;
  const out = await listRuns(fsOf(map), ROOT, '主题A', async () => {
    probed++;
    return null;
  });
  assert.equal(out.length, 1);
  const run = out[0]!;
  assert.equal(run.runId, runId);
  assert.equal(run.stage, 'code');
  assert.equal(run.status, 'success');
  assert.equal(run.driver, 'glm');
  assert.equal(run.metaLocated, true);
  assert.deepEqual(run.criticsSelected, ['claude', 'gemini']);
  assert.equal(run.sides.length, 2);
  const claude = run.sides.find((s) => s.critic === 'claude')!;
  assert.equal(claude.verdict, 'pass-after-changes');
  assert.equal(claude.counts.blocker, 1);
  assert.equal(claude.counts.major, 1);
  // 归档齐全 → 不探 run_root（AGY-05：探测次数为 0）
  assert.equal(probed, 0);
});

test('listRuns：归档缺失 → 探 run_root；探测失败不接管', async () => {
  const map: Record<string, string> = {
    [`${ROOT}/主题B/task.json`]: JSON.stringify({
      topic: '主题B',
      runs: [{ run_id: '20260102T000000Z', stage: 'plan', rerun_index: 1, status: 'success', started_at: '2026-01-02T00:00:00Z' }],
    }),
    // 无 _meta/run-*.json（归档缺失）
  };
  const fs = fsOf(map);
  // 探测失败（run_root 无该目录）
  const out1 = await listRuns(fs, ROOT, '主题B', async () => null);
  assert.equal(out1[0]!.metaLocated, false);
  // 探测成功：status.json 可读 → 定位并补 phase
  const withStatus = fsOf({ ...map, '/runs/bucket-1/20260102T000000Z/status.json': JSON.stringify({ phase: 'success', topic: '主题B' }) });
  const out2 = await listRuns(withStatus, ROOT, '主题B', async (runId) => `/runs/bucket-1/${runId}`);
  assert.equal(out2[0]!.metaLocated, true);
  assert.equal(out2[0]!.status, 'success'); // task.json 优先
});

test('listRuns：仅有归档无 task 记录的 run 追加（防御）；降级侧统计贯通', async () => {
  const runId = '20260103T000000Z';
  const map: Record<string, string> = {
    [`${ROOT}/主题C/plan/_meta/run-${runId}.json`]: JSON.stringify({ run_id: runId, stage: 'plan', driver: 'claude', started_at: '2026-01-03T00:00:00Z' }),
    [`${ROOT}/主题C/plan/_meta/review-claude-${runId}.json`]: JSON.stringify({ schema: 'trivium.review.v1', verdict: 'pass', findings: [] }),
  };
  const out = await listRuns(fsOf(map), ROOT, '主题C', async () => null);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.stage, 'plan');
  assert.equal(out[0]!.sides[0]!.state, 'unsupported-schema');
  assert.ok(out[0]!.sides[0]!.notice);
});
