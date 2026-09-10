import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateTopic,
  buildArtifactName,
  buildVerifyName,
  parseArtifactName,
  roleIsAllowedForWriter,
  dispositionKindForStage,
  looksLikeRoleArtifact,
  localDate,
} from '../../src/trivium/naming.js';

test('主题名：合法值通过，空格转 -', () => {
  assert.deepEqual(validateTopic('登录重构'), { ok: true, normalized: '登录重构' });
  assert.deepEqual(validateTopic('  登录 重构  '), { ok: true, normalized: '登录-重构' });
  assert.equal(validateTopic('auth_v2.1-fix').ok, true);
});

test('主题名：拒绝路径分隔符、.. 与前导点', () => {
  assert.equal(validateTopic('a/b').ok, false);
  assert.equal(validateTopic('a\\b').ok, false);
  assert.equal(validateTopic('../etc').ok, false);
  assert.equal(validateTopic('.hidden').ok, false);
});

test('主题名：拒绝保留后缀并给出修正建议', () => {
  for (const bad of ['登录重构-r2', '登录重构-revised', '登录重构-response', '登录重构-verify']) {
    const v = validateTopic(bad);
    assert.equal(v.ok, false, `${bad} 应被拒绝`);
    assert.ok(v.reason?.includes('保留后缀'));
    assert.equal(v.suggestion, '登录重构');
  }
});

test('主题名：超长拒绝并截断建议', () => {
  const v = validateTopic('x'.repeat(70));
  assert.equal(v.ok, false);
    assert.equal(v.suggestion?.length, 64);
});

test('生成：首跑无 -r 后缀', () => {
  assert.equal(
    buildArtifactName({ date: '2026-09-10', topic: '登录重构', rerunIndex: 1, kind: null, role: 'gemini' }),
    '2026-09-10-登录重构-gemini.md',
  );
});

test('生成：重跑加 -r<N>，裁决件加 -revised/-response', () => {
  assert.equal(
    buildArtifactName({ date: '2026-09-10', topic: '登录重构', rerunIndex: 2, kind: null, role: 'glm' }),
    '2026-09-10-登录重构-r2-glm.md',
  );
  assert.equal(
    buildArtifactName({ date: '2026-09-10', topic: '登录重构', rerunIndex: 1, kind: 'revised', role: 'claude' }),
    '2026-09-10-登录重构-revised-claude.md',
  );
  assert.equal(
    buildArtifactName({ date: '2026-09-10', topic: '登录重构', rerunIndex: 2, kind: 'response', role: 'claude' }),
    '2026-09-10-登录重构-r2-response-claude.md',
  );
});

test('生成：裁决件后缀不得用于审查员角色', () => {
  assert.throws(
    () => buildArtifactName({ date: '2026-09-10', topic: 'x', rerunIndex: 1, kind: 'revised', role: 'gemini' }),
    /Driver 裁决件专用后缀/,
  );
});

test('解析：生成与解析互为逆运算', () => {
  const cases = [
    { date: '2026-09-10', topic: '登录重构', rerunIndex: 1, kind: null, role: 'claude' as const },
    { date: '2026-09-10', topic: '登录重构', rerunIndex: 3, kind: null, role: 'gemini' as const },
    { date: '2026-09-10', topic: 'auth-v2', rerunIndex: 2, kind: 'response' as const, role: 'claude' as const },
    { date: '2026-09-10', topic: 'auth-v2', rerunIndex: 1, kind: 'revised' as const, role: 'claude' as const },
  ];
  for (const c of cases) {
    assert.deepEqual(parseArtifactName(buildArtifactName(c)), c, JSON.stringify(c));
  }
});

test('解析：主题本身含连字符时不会被误切', () => {
  const p = parseArtifactName('2026-09-10-auth-v2-oidc-r2-revised-claude.md');
  assert.equal(p?.topic, 'auth-v2-oidc');
  assert.equal(p?.rerunIndex, 2);
  assert.equal(p?.kind, 'revised');
  assert.equal(p?.role, 'claude');
});

test('解析：非本流水线产出返回 null', () => {
  for (const bad of ['README.md', 'PLAN_RAW.md', '2026-09-10-x-unknown.md', '20260910-x-claude.md']) {
    assert.equal(parseArtifactName(bad), null, bad);
  }
});

test('角色后缀硬约束：审查员不得产 claude，Driver 不得产 gemini/glm', () => {
  assert.equal(roleIsAllowedForWriter('driver', 'claude'), true);
  assert.equal(roleIsAllowedForWriter('driver', 'gemini'), false);
  assert.equal(roleIsAllowedForWriter('driver', 'glm'), false);
  assert.equal(roleIsAllowedForWriter('gemini', 'gemini'), true);
  assert.equal(roleIsAllowedForWriter('gemini', 'claude'), false);
  assert.equal(roleIsAllowedForWriter('gemini', 'glm'), false);
});

test('阶段决定裁决件后缀：code 用 response，plan/bug 用 revised', () => {
  assert.equal(dispositionKindForStage('code'), 'response');
  assert.equal(dispositionKindForStage('plan'), 'revised');
  assert.equal(dispositionKindForStage('bug'), 'revised');
});

test('verify 记录不带角色后缀，且不会被角色检查器误判', () => {
  const n = buildVerifyName('2026-09-10', '登录重构');
  assert.equal(n, '2026-09-10-登录重构-verify.md');
  assert.equal(looksLikeRoleArtifact(n), false);
  assert.equal(looksLikeRoleArtifact('2026-09-10-登录重构-glm.md'), true);
});

test('localDate 取本地日期而非 UTC', () => {
  // 构造一个本地时间为当日、UTC 已跨日的时刻，确认取的是本地日期
  const d = new Date(2026, 8, 10, 23, 30, 0); // 本地 2026-09-10 23:30
  assert.equal(localDate(d), '2026-09-10');
});
