/** 健康模型单测（probe 段驱动） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHealth } from '../../src/env/health';
import type { ProbeSection } from '../../src/env/config';

function probeWith(cli: Record<string, Record<string, unknown>>, auth: Record<string, Record<string, unknown>> = {}): ProbeSection {
  return { generatedAt: '2026-11-06T00:00:00Z', cli, auth };
}

test('无 probe：四家全部 not-probed', () => {
  const list = buildHealth(null);
  assert.equal(list.length, 4);
  assert.ok(list.every((h) => h.availability === 'not-probed'));
});

test('有入口且认证通过 → available；探针键用 CLI 名（gemini→agy、glm→zcode）', () => {
  const list = buildHealth(
    probeWith(
      {
        claude: { entrypoint: '/bin/claude', version: '2.1.0' },
        agy: { entrypoint: '/bin/agy', version: '1.5.1' },
      },
      { claude: { ok: true }, gemini: { ok: true } },
    ),
  );
  const claude = list.find((h) => h.agentId === 'claude')!;
  assert.equal(claude.availability, 'available');
  assert.equal(claude.version, '2.1.0');
  const gemini = list.find((h) => h.agentId === 'gemini')!;
  assert.equal(gemini.availability, 'available');
  const glm = list.find((h) => h.agentId === 'glm')!;
  assert.equal(glm.availability, 'not-probed');
});

test('auth.ok=false → auth-missing', () => {
  const list = buildHealth(probeWith({ zcode: { entrypoint: '/bin/zcode' } }, { glm: { ok: false } }));
  assert.equal(list.find((h) => h.agentId === 'glm')!.availability, 'auth-missing');
});

test('不泄漏指纹类字段（health 输出无 fingerprint 键）', () => {
  const list = buildHealth(probeWith({ claude: { entrypoint: '/bin/claude' } }, {}));
  const raw = JSON.stringify(list);
  assert.ok(!raw.includes('fingerprint'));
});
