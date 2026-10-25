/**
 * EV-257：网关 env 逐值脱敏只对凭据类键生效，模型名回读不再被吞成占位符。
 *
 * ## 要钉住的事（两个方向同时咬）
 *
 * - **不放松**：凭据类键（`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_BASE_URL` 及其余非模型名键）的值照旧原串替换；
 *   模型名键的值要过四道守卫（键名、`redactSecrets` 无命中、不与凭据同值、长得像模型名）才豁免，
 *   否则照旧替换。S1～S5。
 * - **不吞回读**：模型名键的值不进替换集（S2）；回读字段带脱敏痕迹时记 null + `unverified`，
 *   不以 `envelope` 落盘（S7～S9）。
 * - **未开启零变化**：env 为空时只过模式脱敏，与修复前逐字相同（S6、S8 前三格）。
 *
 * 凭据形态的夹具一律运行时分段拼接（`contract/fixture-credentials`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatewayScrubPlan, scrubGatewayEnv, buildClaudeResult, readonlyToolsFromProbe } from '../../src/trivium/adapters/claude.js';
import { isModelNameKey, looksLikeModelName } from '../../src/trivium/adapters/claude-route.js';
import { claudeModelReadback, parseClaudeEvents } from '../../src/trivium/adapters/claude-trace.js';
import { hasRedactionMark, redactSecrets } from '../../src/trivium/secrets.js';
import { READONLY_INVARIANTS } from '../../src/trivium/probes/claude.js';

const P = '<redacted-env>';

/** 真实模型名形态（含 `:` `/` `.`、日期段、厂商端点 ID）——都要豁免、都不算脱敏痕迹 */
const REAL_MODELS = [
  'claude-opus-4-1-20250805',
  'kimi-for-coding',
  'qwen3-coder-plus',
  'anthropic/claude-sonnet-4',
  'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
  'ep-20250101123456-abcde',
  'glm-4.6',
];

/** 运行时拼接的令牌形态值：静态文本里不出现完整形态 */
const OPENAI_LIKE = ['sk', '-', 'Ab3dEf5hIj7lMn9pQr1tUv3x'].join('');
const JWT_LIKE = ['ey', 'JhbGciOiJIUzI1', '.', 'ey', 'JzdWIiOiIxMjM0', '.', 'Qw3rTy7uIo9pAs2d'].join('');
const RANDOM_TOKEN = ['q7Xk2Lm9', 'Vb4Nc8Zr', 'T1yW6pHs'].join('');
const UUID_TOKEN = ['550e8400', 'e29b', '41d4', 'a716', '446655440000'].join('-');

test('S1 键划分：模型名键为真；凭据键、伪模型键、非全大写键一律为假', () => {
  for (const k of ['ANTHROPIC_MODEL', 'ANTHROPIC_SMALL_FAST_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
    'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
    assert.equal(isModelNameKey(k), true, `${k} 应判为模型名键`);
  }
  for (const k of ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_CUSTOM_HEADERS',
    'ANTHROPIC_DEFAULT_OPUS_MODEL_DESCRIPTION', 'ANTHROPIC_AUTH_MODEL', 'ANTHROPIC_BASE_URL_MODEL',
    'ANTHROPIC_PWD_MODEL', 'ANTHROPIC_PASS_MODEL', 'ANTHROPIC_SECRET_MODEL_NAME', 'ANTHROPIC_MODEL_TOKEN',
    'MODEL', 'OTHER_MODEL', 'ANTHROPIC_model', 'ANTHROPIC_default_haiku_model', 'ANTHROPIC_auth_model',
    'Anthropic_MODEL']) {
    assert.equal(isModelNameKey(k), false, `${k} 须按凭据处理（留在替换集）`);
  }
});

test('S2 逐值替换的两个方向：模型名键的值保留，凭据键的值替换', () => {
  const env = {
    ANTHROPIC_MODEL: 'gw-ev257-model-01',
    ANTHROPIC_AUTH_TOKEN: 'gw-ev257-auth-01',
    ANTHROPIC_BASE_URL: 'https://gw-ev257.invalid/api',
  };
  const out = scrubGatewayEnv(`model=${env.ANTHROPIC_MODEL} auth=${env.ANTHROPIC_AUTH_TOKEN} url=${env.ANTHROPIC_BASE_URL}`, env);
  assert.ok(out.includes(env.ANTHROPIC_MODEL), '模型名键的值须原样保留（否则回读被吞）');
  assert.ok(!out.includes(env.ANTHROPIC_AUTH_TOKEN), '凭据键 AUTH_TOKEN 的值须被替换');
  assert.ok(!out.includes(env.ANTHROPIC_BASE_URL), '凭据键 BASE_URL 的值须被替换');
  assert.equal(out.split(P).length - 1, 2, '两个凭据值各换成一个占位符');
  assert.deepEqual(gatewayScrubPlan(env).exemptKeys, ['ANTHROPIC_MODEL']);
});

test('S3 凭据优先：同一个值同时挂在模型名键与凭据键上，照旧替换', () => {
  const shared = 'gw-ev257-shared-01';
  const env = { ANTHROPIC_MODEL: shared, ANTHROPIC_AUTH_TOKEN: shared };
  assert.ok(!scrubGatewayEnv(`x ${shared} y`, env).includes(shared));
  assert.deepEqual(gatewayScrubPlan(env).exemptKeys, [], '与凭据同值的模型名键不得豁免');
});

test('S4 模型名键里的凭据形态值照旧替换；真实模型名形态全部豁免', () => {
  for (const [label, v] of [['已知厂商令牌形态（JWT，守卫 2）', JWT_LIKE], ['OpenAI 形态（守卫 2 与 4）', OPENAI_LIKE],
    ['非标准随机令牌（守卫 4 的最长段）', RANDOM_TOKEN], ['UUID（守卫 4）', UUID_TOKEN]] as const) {
    const env = { ANTHROPIC_DEFAULT_HAIKU_MODEL: v };
    assert.ok(!scrubGatewayEnv(`init ${v} end`, env).includes(v), `${label}：须被替换`);
    assert.deepEqual(gatewayScrubPlan(env).exemptKeys, [], `${label}：不得豁免`);
  }
  // 守卫 2 独立于守卫 4：JWT 形态各段都短，单靠形态约束放得过去
  assert.equal(looksLikeModelName(JWT_LIKE), true, '前提：JWT 夹具能过形态约束，S4 第一格咬的是守卫 2');
  assert.equal(redactSecrets(RANDOM_TOKEN).count, 0, '前提：随机令牌不命中任何模式规则，S4 第三格咬的是守卫 4');
  assert.equal(redactSecrets(UUID_TOKEN).count, 0, '前提：UUID 不命中任何模式规则');
  for (const m of REAL_MODELS) {
    const env = { ANTHROPIC_MODEL: m, ANTHROPIC_AUTH_TOKEN: 'gw-ev257-auth-01' };
    assert.deepEqual(gatewayScrubPlan(env).exemptKeys, ['ANTHROPIC_MODEL'], `${m} 应豁免`);
    assert.ok(scrubGatewayEnv(`"model":"${m}"`, env).includes(m), `${m} 应原样保留`);
  }
});

test('S5 替换集按长度降序：短凭据是长凭据的子串时不留残段', () => {
  const short = 'abcdefgh12';
  const long = `xyz-${short}-tail9`;
  // 短的排在前面——修复前按 Object.values 次序替换会留下「xyz-」与「-tail9」
  const env = { ANTHROPIC_AUTH_TOKEN: short, ANTHROPIC_BASE_URL: long };
  const out = scrubGatewayEnv(`url=${long}`, env);
  assert.equal(out, `url=${P}`, '长值须整串替换');
  assert.deepEqual(gatewayScrubPlan(env).replace, [long, short]);
});

test('S6 未开启零变化：env 为 undefined / {} 时与只过模式脱敏逐字相同', () => {
  const corpus = [
    '{"type":"system","subtype":"init","model":"claude-haiku-4-5-20251001"}',
    `echo ${OPENAI_LIKE} done`,
    'kimi-for-coding 普通文本 <tag> …',
    '',
  ];
  for (const x of corpus) {
    assert.equal(scrubGatewayEnv(x, undefined), redactSecrets(x).content);
    assert.equal(scrubGatewayEnv(x, {}), redactSecrets(x).content);
  }
  assert.deepEqual(gatewayScrubPlan(undefined), { replace: [], exemptKeys: [] });
  assert.deepEqual(gatewayScrubPlan({}), { replace: [], exemptKeys: [] });
});

test('S7 hasRedactionMark：生产方的每种脱敏产出都认出，真实模型名与非字符串都不认', () => {
  const produced = [
    scrubGatewayEnv('v=gw-ev257-auth-01', { ANTHROPIC_AUTH_TOKEN: 'gw-ev257-auth-01' }),
    redactSecrets(OPENAI_LIKE).content, // 首尾预览形态
    redactSecrets(JWT_LIKE).content,
    redactSecrets(['-----BEGIN PRIVATE KEY-----', ['MIIEvQIBADANBgkq', 'hkiG9w0BAQEFAASC', 'BKcwggSjAgEAAoIB'].join(''),
      '-----END PRIVATE KEY-----'].join('\n')).content, // redactWith 占位形态
  ];
  for (const s of produced) {
    assert.notEqual(s, '', '前提：脱敏有产出');
    assert.equal(hasRedactionMark(s), true, `应认出脱敏痕迹：${s.slice(0, 40)}`);
  }
  for (const m of REAL_MODELS) assert.equal(hasRedactionMark(m), false, `${m} 不是脱敏痕迹`);
  for (const v of [null, undefined, 42, {}]) assert.equal(hasRedactionMark(v), false);
});

test('S8 claudeModelReadback 真值表：缺失 / 空串与修复前逐字相同，带痕迹记 null + unverified', () => {
  /** 修复前 buildClaudeResult 的两格表达式，作对照 */
  const before = (init: { model: string | null } | null) =>
    ({ model: init?.model ?? null, source: init?.model ? 'envelope' : 'unverified' });
  const mk = (model: string | null) => ({ model, tools: [], permissionMode: null, cwd: null });
  for (const init of [null, mk(null), mk('')]) assert.deepEqual(claudeModelReadback(init), before(init));
  assert.deepEqual(claudeModelReadback(mk(P)), { model: null, source: 'unverified' });
  assert.deepEqual(claudeModelReadback(mk(redactSecrets(OPENAI_LIKE).content)), { model: null, source: 'unverified' });
  assert.deepEqual(claudeModelReadback(mk('kimi-for-coding')), { model: 'kimi-for-coding', source: 'envelope' });
});

test('S9 buildClaudeResult：占位符不以 envelope 落盘，正常名照旧 envelope', () => {
  const trace = (model: string) => parseClaudeEvents([
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model, tools: [], permissionMode: 'default' }),
    JSON.stringify({ type: 'result', subtype: 'success', result: '{"ok":1}', total_cost_usd: 0.01, permission_denials: [] }),
  ].join('\n'));
  const args = [{ exitCode: 0, durationMs: 1000, commandLine: 'claude -p' }, { stdout: '/r/s', trace: '/r/t' },
    { version: '2.1.302', path_deny: { file_shape_verified: true } }, readonlyToolsFromProbe(READONLY_INVARIANTS),
    { ruleCount: 0, skipped: [] as string[], bytes: 0 }] as const;
  const swallowed = buildClaudeResult(trace(P), ...args);
  assert.equal(swallowed.model_effective, null, '占位符不得记成生效模型');
  assert.equal(swallowed.model_effective_source, 'unverified');
  const ok = buildClaudeResult(trace('kimi-for-coding'), ...args);
  assert.equal(ok.model_effective, 'kimi-for-coding');
  assert.equal(ok.model_effective_source, 'envelope');
});
