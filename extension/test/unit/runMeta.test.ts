/** runMeta 单测：artifacts→addresses 派生、fallback-items 解析、Driver 定位链（r2 计划 D6） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readRunMeta, expectedAddresses, readFallbackIds, allFallbackIds, resolveDriverId, readClaimedDriver, criticOfId, isFallbackId, type RunMetaFs, type RunMetaInfo } from '../../src/disposition/runMeta';

function fsOf(files: Record<string, string>): RunMetaFs {
  return {
    async readFile(p) {
      const v = files[p];
      if (v === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return v;
    },
  };
}

const RUN_META = JSON.stringify(
  {
    schema: 'trivium.run.v3',
    run_id: '20261105T230457Z',
    driver: 'glm',
    rerun_index: 1,
    critics_selected: ['claude', 'gemini', 'codex'],
    critics: { claude: { status: 'ok' }, gemini: { status: 'ok' }, codex: { status: 'ok' } },
    artifacts: [
      { path: 'VSCode插件Phase2/plan/_meta/brief-claude-20261105T230457Z.md' },
      { path: 'VSCode插件Phase2/plan/2026-11-06-VSCode插件Phase2-claude.md' },
      { path: 'VSCode插件Phase2/plan/2026-11-06-VSCode插件Phase2-gemini.md' },
      { path: 'VSCode插件Phase2/plan/2026-11-06-VSCode插件Phase2-codex.md' },
      { path: 'VSCode插件Phase2/plan/2026-11-06-VSCode插件Phase2-revised-glm.md' },
      { path: 'VSCode插件Phase2/plan/_meta/run-20261105T230457Z.json' },
    ],
  },
  null,
  2,
);

test('run-<runId>.json 解析：driver/rerun/critics/artifacts', async () => {
  const fs = fsOf({ '/m/run-20261105T230457Z.json': RUN_META });
  const meta = await readRunMeta(fs, '/m', '20261105T230457Z');
  assert.equal(meta!.driver, 'glm');
  assert.equal(meta!.rerunIndex, 1);
  assert.deepEqual(meta!.criticsSelected, ['claude', 'gemini', 'codex']);
  assert.equal(meta!.artifacts.length, 6);
});

test('addresses 派生：阶段根 + 非裁决件 + 有效侧后缀（对齐 expectedReviewDocs 判据）', async () => {
  const fs = fsOf({ '/m/run-20261105T230457Z.json': RUN_META });
  const meta = await readRunMeta(fs, '/m', '20261105T230457Z');
  const out = expectedAddresses(meta!, 'VSCode插件Phase2', 'plan');
  // _meta 下的 brief/run 不进；裁决件（revised-glm）不进；三家审查正文进
  assert.deepEqual(out, [
    '2026-11-06-VSCode插件Phase2-claude.md',
    '2026-11-06-VSCode插件Phase2-gemini.md',
    '2026-11-06-VSCode插件Phase2-codex.md',
  ]);
});

test('parse_fallback 侧计入、failed 侧不计入（有效侧判定）', async () => {
  const meta: RunMetaInfo = {
    runId: 'r1',
    driver: 'glm',
    rerunIndex: 1,
    criticsSelected: ['claude', 'gemini', 'codex'],
    criticStatus: { claude: 'ok', gemini: 'parse_fallback', codex: 'failed' },
    artifacts: [
      'T/plan/a-claude.md',
      'T/plan/a-gemini.md',
      'T/plan/a-codex.md', // failed 侧的文档也在 artifacts 里（历史轮残留），但侧无效 → 不进
    ],
  };
  const out = expectedAddresses(meta, 'T', 'plan');
  assert.deepEqual(out, ['a-claude.md', 'a-gemini.md']);
});

test('fallback-items 解析：每行编号提取、缺失文件空集', async () => {
  const fs = fsOf({
    '/m/review-gemini-20261105T230457Z.fallback-items.md': [
      '# parse_fallback 待裁决单元',
      '- AGY-F01: 总判断段第一条意见…',
      '- AGY-F02: 逐条编号段落第二条…',
      '（无关行）',
      '- AGY-F03:第三条（无空格变体）',
    ].join('\n'),
  });
  const ids = await readFallbackIds(fs, '/m', 'gemini', '20261105T230457Z');
  assert.deepEqual(ids, ['AGY-F01', 'AGY-F02', 'AGY-F03']);
  const none = await readFallbackIds(fs, '/m', 'claude', '20261105T230457Z');
  assert.deepEqual(none, []);
});

test('allFallbackIds：非 ok 侧并集', async () => {
  const fs = fsOf({
    '/m/review-gemini-r1.fallback-items.md': '- AGY-F01: x\n- AGY-F02: y\n',
    '/m/review-claude-r1.fallback-items.md': '- CLAUDE-F01: z\n',
  });
  const meta: RunMetaInfo = {
    runId: 'r1', driver: 'glm', rerunIndex: 1,
    criticsSelected: ['claude', 'gemini', 'codex'],
    criticStatus: { claude: 'parse_fallback', gemini: 'parse_fallback', codex: 'ok' },
    artifacts: [],
  };
  assert.deepEqual(await allFallbackIds(fs, meta, '/m'), ['CLAUDE-F01', 'AGY-F01', 'AGY-F02']);
});

test('Driver 定位链：run 元数据优先；缺失降级阶段认领；两级缺 → null（不猜）', async () => {
  const fs = fsOf({
    '/m/run-20261105T230457Z.json': RUN_META,
    '/.reviews/T/task.json': JSON.stringify({ drivers: { plan: { driver: 'claude' } } }),
  });
  const meta = await readRunMeta(fs, '/m', '20261105T230457Z');
  assert.deepEqual(await resolveDriverId(fs, meta, '/.reviews', 'VSCode插件Phase2', 'plan'), { driver: 'glm', source: 'run-meta' });
  // run 元数据缺 → 阶段认领（受限 fallback，标注来源）
  assert.deepEqual(await resolveDriverId(fs, null, '/.reviews', 'T', 'plan'), { driver: 'claude', source: 'stage-claim' });
  // 两级缺 → null
  assert.equal(await resolveDriverId(fs, null, '/.reviews', '不存在', 'plan'), null);
  // 闸门 gates[].driver 不进链（同槽位换 Driver 残留旧值，CLAUDE-04/AGY-03/CODEX-04）
});

test('task.json 阶段认领读取', async () => {
  const fs = fsOf({ '/.reviews/T/task.json': JSON.stringify({ drivers: { code: { driver: 'glm' } } }) });
  assert.equal(await readClaimedDriver(fs, '/.reviews', 'T', 'code'), 'glm');
  assert.equal(await readClaimedDriver(fs, '/.reviews', 'T', 'plan'), null);
});

test('编号前缀映射与 fallback 判定', () => {
  assert.equal(criticOfId('CLAUDE-01'), 'claude');
  assert.equal(criticOfId('AGY-F01'), 'gemini');
  assert.equal(criticOfId('GLM-r2-03'), 'glm');
  assert.equal(criticOfId('XX-01'), null, '未注册前缀不猜');
  assert.equal(isFallbackId('AGY-F01'), true);
  assert.equal(isFallbackId('AGY-01'), false);
});
