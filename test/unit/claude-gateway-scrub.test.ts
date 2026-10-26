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
 * - **上下文窗口后缀**（EV-258）：守卫 4 只放行末尾一个 `[数字k|m]` 后缀，剥后其余判据照旧（S10～S13）；
 *   放行过窄（真实带后缀形态被替换）与过宽（方括号在别处、多个后缀、内容不符、剥后跳过判据）两个方向都咬。
 *   AC-20 留痕：`init.model` 与服务端回报的 `message.model` 的比对只进 `trace.json`（S14）。
 *
 * 凭据形态的夹具一律运行时分段拼接（`contract/fixture-credentials`）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatewayScrubPlan, scrubGatewayEnv, buildClaudeResult, readonlyToolsFromProbe } from '../../src/trivium/adapters/claude.js';
import { isModelNameKey, looksLikeModelName, stripContextWindowSuffix } from '../../src/trivium/adapters/claude-route.js';
import { claudeModelConsistency, claudeModelReadback, parseClaudeEvents } from '../../src/trivium/adapters/claude-trace.js';
import { hasRedactionMark, redactSecrets } from '../../src/trivium/secrets.js';
import { READONLY_INVARIANTS } from '../../src/trivium/probes/claude.js';
import { modelFamily } from '../../src/trivium/model-family.js';

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
  'qwen3.8-max[1m]', // EV-258：CC Switch 写进生效模型名键的上下文窗口后缀形态（2026-10-26 Windows 实测）
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

/** 带合法上下文窗口后缀的真实形态（EV-258）：都要放行、豁免、原样保留 */
const SUFFIXED_MODELS = ['qwen3.8-max[1m]', 'qwen3.8-flash[1m]', 'claude-sonnet-4-5[1m]', 'claude-opus-4-1[200k]', 'glm-4.6[1000k]'];

test('S10 带后缀的真实形态放行：守卫 4 为真、模型名键豁免、输出原样保留（过窄方向）', () => {
  for (const m of SUFFIXED_MODELS) {
    assert.equal(looksLikeModelName(m), true, `${m} 应像模型名`);
    const env = { ANTHROPIC_MODEL: m, ANTHROPIC_AUTH_TOKEN: 'gw-ev258-auth-01' };
    assert.deepEqual(gatewayScrubPlan(env).exemptKeys, ['ANTHROPIC_MODEL'], `${m} 应豁免`);
    assert.deepEqual(gatewayScrubPlan(env).replace, ['gw-ev258-auth-01'], `${m}：替换集只剩凭据值`);
    assert.ok(scrubGatewayEnv(`"model":"${m}"`, env).includes(m), `${m} 应原样保留`);
  }
});

test('S11 方括号形态的反例照旧不豁免：别处方括号、两个后缀、后缀内容不符、只有后缀、方括号包令牌（过宽方向）', () => {
  const B = 'qwen3.8-max';
  const negatives = [`qwen[1m]-max`, `${B}[1m][1m]`, `${B}[abc]`, `${B}[1g]`, `${B}[0m]`, `${B}[12345m]`, `${B}[1M]`,
    `${B}[]`, `${B}[ 1m]`, `${B}[1m] `, '[1m]', `[${RANDOM_TOKEN}]`];
  for (const v of negatives) {
    const env = { ANTHROPIC_MODEL: v, ANTHROPIC_AUTH_TOKEN: 'gw-ev258-auth-01' };
    // 第一层：形态拒绝、不豁免
    assert.equal(looksLikeModelName(v), false, `${v} 不应像模型名`);
    assert.deepEqual(gatewayScrubPlan(env).exemptKeys, [], `${v}：不得豁免`);
    if (v.length >= 8) {
      // 第二层：够长的反例进替换集、输出不含原值
      assert.ok(gatewayScrubPlan(env).replace.includes(v), `${v}：须进替换集`);
      assert.ok(!scrubGatewayEnv(`"model":"${v}"`, env).includes(v), `${v}：须被替换`);
    } else {
      // 第三层：短于 8 字符的值不进替换集，与修复前相同（阈值不动，计划三审 CODEX-02）
      assert.ok(!gatewayScrubPlan(env).replace.includes(v), `${v}：短值行为须与修复前相同`);
    }
  }
});

test('S12 剥掉后缀后其余判据照旧：令牌 / UUID / 厂商形态加合法后缀仍不豁免', () => {
  for (const [label, core] of [['随机令牌（最长段）', RANDOM_TOKEN], ['UUID', UUID_TOKEN], ['OpenAI 形态（守卫 2）', OPENAI_LIKE]] as const) {
    const v = `${core}[1m]`;
    assert.equal(stripContextWindowSuffix(v), core, `前提：${label} 的后缀本身合法、剥得掉——这格咬的是剥后判据`);
    const env = { ANTHROPIC_DEFAULT_OPUS_MODEL: v };
    assert.deepEqual(gatewayScrubPlan(env).exemptKeys, [], `${label} + 后缀：不得豁免`);
    assert.ok(!scrubGatewayEnv(`init ${v} end`, env).includes(v), `${label} + 后缀：须被替换`);
  }
  assert.equal(looksLikeModelName(`${RANDOM_TOKEN}[1m]`), false, '随机令牌 + 后缀：守卫 4 须拒');
  assert.equal(looksLikeModelName(`${UUID_TOKEN}[1m]`), false, 'UUID + 后缀：守卫 4 须拒');
  assert.ok(redactSecrets(`${OPENAI_LIKE}[1m]`).count > 0, '前提：OpenAI 形态加后缀仍命中模式规则，咬的是守卫 2');
});

test('S13 Windows 实测形态整表：同值的带后缀模型名键一并豁免，替换集只剩凭据；挂同值的非模型名键让它们全部不豁免', () => {
  const flash = 'gw-ev258-flash';
  const max = 'gw-ev258-max';
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: 'https://gw-ev258.invalid/api',
    ANTHROPIC_AUTH_TOKEN: 'gw-ev258-auth-01',
    ANTHROPIC_MODEL: `${flash}[1m]`,
    ANTHROPIC_DEFAULT_SONNET_MODEL: `${flash}[1m]`,
    ANTHROPIC_DEFAULT_OPUS_MODEL: `${max}[1m]`,
    ANTHROPIC_DEFAULT_FABLE_MODEL: `${max}[1m]`,
    CLAUDE_CODE_SUBAGENT_MODEL: `${max}[1m]`,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: flash,
    ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: flash,
    ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: flash,
    ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: max,
    ANTHROPIC_DEFAULT_FABLE_MODEL_NAME: max,
  };
  const models = Object.keys(env).filter((k) => !['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'].includes(k));
  const plan = gatewayScrubPlan(env);
  assert.deepEqual([...plan.exemptKeys].sort(), [...models].sort(), '10 个模型名键须全部豁免');
  assert.deepEqual(plan.replace, [env['ANTHROPIC_BASE_URL'], env['ANTHROPIC_AUTH_TOKEN']], '替换集恰为两个凭据值（降序）');

  // 凭据优先：一个非模型名键挂着 max[1m] 这个值 ⇒ 挂它的三个模型名键全部不豁免，其余照旧
  const tainted = { ...env, ANTHROPIC_EXTRA_EV258: `${max}[1m]` };
  const p2 = gatewayScrubPlan(tainted);
  for (const k of ['ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_FABLE_MODEL', 'CLAUDE_CODE_SUBAGENT_MODEL']) {
    assert.ok(!p2.exemptKeys.includes(k), `${k}：与非模型名键同值，不得豁免`);
  }
  assert.ok(p2.replace.includes(`${max}[1m]`), '与非模型名键同值的带后缀值须进替换集');
  assert.equal(p2.exemptKeys.length, 7, '其余 7 个模型名键照旧豁免');
});

test('S14 AC-20 留痕：reportedModels 收集与 claudeModelConsistency 真值表；带后缀的模型族判定不变', () => {
  const ev = (o: unknown) => JSON.stringify(o);
  const t = parseClaudeEvents([
    ev({ type: 'system', subtype: 'init', model: 'gw-a[1m]', tools: [] }),
    ev({ type: 'assistant', message: { model: 'gw-a', content: [] } }),
    ev({ type: 'assistant', message: { model: '', content: [] } }),
    ev({ type: 'assistant', message: { model: 42, content: [] } }),
    ev({ type: 'assistant', message: { model: 'gw-b', content: [] } }),
    ev({ type: 'assistant', message: { model: 'gw-a', content: [] } }),
    ev({ type: 'user', message: { model: 'gw-user', content: [] } }),
  ].join('\n'));
  assert.deepEqual(t.reportedModels, ['gw-a', 'gw-b'], '去重保序；空串、非字符串、非 assistant 事件不收');
  assert.deepEqual(parseClaudeEvents(ev({ type: 'system', subtype: 'init', model: 'x' })).reportedModels, []);

  const mk = (model: string | null) => ({ model, tools: [], permissionMode: null, cwd: null });
  for (const init of [null, mk(null), mk(''), mk(P)]) assert.equal(claudeModelConsistency(init, ['gw-a']), null, '回读取不到 ⇒ null');
  assert.equal(claudeModelConsistency(mk('gw-a'), []), null, '没有回报值 ⇒ null');
  assert.equal(claudeModelConsistency(mk('gw-a'), ['gw-a']), true, '逐字相同 ⇒ true');
  assert.equal(claudeModelConsistency(mk('gw-a[1m]'), ['gw-a']), true, 'init 带后缀、回报不带 ⇒ true');
  assert.equal(claudeModelConsistency(mk('gw-a[1m]'), ['gw-a[1m]', 'gw-a']), true);
  assert.equal(claudeModelConsistency(mk('gw-a[1m]'), ['other-model']), false, '完全不同名 ⇒ false');
  assert.equal(claudeModelConsistency(mk('gw-a[1m]'), ['gw-']), false, '回报是 init 的真前缀但不是剥后缀结果 ⇒ false（GLM-02）');
  assert.equal(claudeModelConsistency(mk('gw-a[1m]'), ['gw-a', 'gw-b']), false, '有一个不符 ⇒ false');
  assert.equal(claudeModelConsistency(mk('qwen[1m][1m]'), ['qwen[1m]']), false, '两个后缀只剥一个 ⇒ false（CODEX-03）');
  assert.equal(claudeModelConsistency(mk('qwen[1M]'), ['qwen']), false, '后缀不合法不剥 ⇒ false');

  assert.equal(modelFamily('qwen3.8-max[1m]'), 'qwen');
  assert.equal(modelFamily('claude-opus-4-1[1m]'), 'claude');
});
