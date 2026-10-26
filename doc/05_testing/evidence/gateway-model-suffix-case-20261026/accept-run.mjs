// EV-258 第二轮零配额验收的执行半边（计划 r2 §6.1）：照第一轮 evidence/gateway-model-suffix-20261026/accept-run.mjs 改。
// 对一棵已构建的树（基线 `1f8e8e87`，即第一轮修法；或当前工作树）用假 CLI 跑审查调用、探活、探针（execArgv 一臂 +
// probeClaude 全量）、目录臂四组，记下输出（归一化后）与回读结论。
// 相对第一轮版只改三处：网关 env 再加两个同值的大写后缀模型名键（ANTHROPIC_DEFAULT_SONNET_MODEL、ANTHROPIC_SMALL_FAST_MODEL，
// 计划写的是 SONNET 与 SUBAGENT，SUBAGENT 已被第一轮占作不带后缀的键，换成 SMALL_FAST）与不带后缀的 *_SONNET_MODEL_NAME；
// 加情形 suffixU（init.model 取大写后缀键，message.model 取不带后缀的键）；被测产物指纹改记 adapters/claude-route.js（本轮改的模块）。
// 装置与 test/integration/claude-gateway-env.test.ts 同口径：宿主前缀变量全部摘下、家目录钉到临时目录、
// 父进程放两个合成键；值全是假值，宿主真实凭据不进子进程、不进记录。
// 情形：default（init.model 恒为缺省名）、model（取 ANTHROPIC_MODEL 的值）、cred（取 ANTHROPIC_AUTH_TOKEN 的值）、
// suffix（取 ANTHROPIC_DEFAULT_OPUS_MODEL 的小写后缀值，message.model 取 ANTHROPIC_DEFAULT_OPUS_MODEL_NAME）、
// suffixU（取 ANTHROPIC_DEFAULT_SONNET_MODEL 的大写后缀值，message.model 取 ANTHROPIC_DEFAULT_SONNET_MODEL_NAME）。
// 归一化输出只记分段 sha256（全文约 90 KB × 12 份，进送审补丁太重）；判读按哈希比相等。
// 用法：node accept-run.mjs 〈树根〉 on|off default|model|cred|suffix|suffixU 〈输出 JSON〉
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const [tree, mode, scenario, outFile] = process.argv.slice(2);
const mod = (p) => import(pathToFileURL(path.join(tree, 'dist/test/src/trivium', p)).href);
const { defaultConfig, resolveReviewSchemaPath } = await mod('config.js');
const { probeClaude, withClaudeProbeRoute, execArgv, probeArgs, READONLY_INVARIANTS } = await mod('probes/claude.js');
const { probeClaudeDirectories } = await mod('probes/claude-directory.js');
const { buildDenySettings, buildClaudeResult, denyRuleShapeOf, invokeClaude, readonlyToolsFromProbe } = await mod('adapters/claude.js');
const traceMod = await mod('adapters/claude-trace.js');
const { parseClaudeEvents } = traceMod;
const { resolveClaudeRoute } = await mod('adapters/claude-route.js');
const ASSET_ROOT = path.join(tree, 'skills/dual-critic');

const SETTINGS_ENV = {
  ANTHROPIC_BASE_URL: 'https://gw-ev257.invalid/api',
  ANTHROPIC_AUTH_TOKEN: 'gw-ev257-auth-01',
  ANTHROPIC_MODEL: 'gw-ev257-model-01',
  ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME: 'gw-ev257-haiku-01',
  CLAUDE_CODE_SUBAGENT_MODEL: 'gw-ev257-sub-01',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'gw-ev258-max-01[1m]',
  ANTHROPIC_DEFAULT_FABLE_MODEL: 'gw-ev258-max-01[1m]',
  ANTHROPIC_DEFAULT_OPUS_MODEL_NAME: 'gw-ev258-max-01',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'gw-ev258-flash-02[1M]',
  ANTHROPIC_SMALL_FAST_MODEL: 'gw-ev258-flash-02[1M]',
  ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: 'gw-ev258-flash-02',
};
const CREDENTIAL_KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN'];
const PARENT = { ANTHROPIC_AUTH_TOKEN: 'parent-ev257-auth', ANTHROPIC_PARENT_ONLY_EV257: 'parent-ev257-only' };
// 情形 → 假 CLI 取哪个环境变量作 init.model（`cred` 取凭据键，键名分段拼接，免得被赋值形态的密钥规则误判）
const MODEL_KEY = { default: '', model: 'ANTHROPIC_MODEL', cred: ['ANTHROPIC', 'AUTH', 'TOKEN'].join('_'),
  suffix: 'ANTHROPIC_DEFAULT_OPUS_MODEL', suffixU: 'ANTHROPIC_DEFAULT_SONNET_MODEL' }[scenario];
const MESSAGE_KEY = { suffix: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME', suffixU: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME' }[scenario] ?? '';
if (MODEL_KEY === undefined) throw new Error(`未知情形 ${scenario}`);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'trivium-ev258b-accept-'));
const real = fs.realpathSync(work);
/**
 * 归一化：临时目录、目录臂自建夹具的随机目录名（`trivium-probe-XXXXXX`）与由它派生的 `sourceHash`、
 * 耗时、时间戳——其余逐字保留。
 */
const norm = (v) => JSON.parse(JSON.stringify(v, (k, x) =>
  /(_at|At|duration|Duration|_s|Ms|elapsed)$/.test(k) && (typeof x === 'number' || typeof x === 'string') ? '〈t〉'
    : k === 'sourceHash' && typeof x === 'string' ? '〈hash〉' : x)
  .split(real).join('〈WORK〉').split(work).join('〈WORK〉').replace(/trivium-probe-[A-Za-z0-9]+/g, '〈FX〉'));
try {
  const script = path.join(work, 'fake-claude.cjs');
  fs.writeFileSync(script, [
    "const fs = require('node:fs');",
    'const argv = process.argv.slice(2);',
    "if (argv.includes('--version')) { process.stdout.write('9.9.9 (Fake Claude)\\n'); process.exit(0); }",
    'function emit(o) { process.stdout.write(JSON.stringify(o) + "\\n"); }',
    "const echo = process.env.ANTHROPIC_AUTH_TOKEN || '';",
    "if (echo) process.stderr.write('echo ' + echo + '\\n');",
    "const modelKey = process.env.FAKE_CLAUDE_INIT_MODEL_KEY || '';",
    "const initModel = (modelKey && process.env[modelKey]) || 'claude-haiku-4-5-20251001';",
    'process.stdin.resume();',
    "process.stdin.on('end', () => {",
    "  const structured = argv.includes('--json-schema');",
    "  emit({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: structured ? ['Read', 'Grep', 'Glob', 'StructuredOutput'] : ['Read', 'Grep', 'Glob'], model: initModel, session_id: 'fake-session' });",
    "  if (echo) emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'echo ' + echo }] } });",
    "  const msgKey = process.env.FAKE_CLAUDE_MESSAGE_MODEL_KEY || '';",
    "  if (msgKey && process.env[msgKey]) emit({ type: 'assistant', message: { model: process.env[msgKey], content: [{ type: 'text', text: 'ok' }] } });",
    "  const result = structured ? JSON.stringify({ schema: 'trivium.review.v1', verdict: 'approve', summary: 'fake summary', findings: [] }) : 'ok';",
    "  emit({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.001, session_id: 'fake-session' });",
    '  process.exit(0);',
    '});',
    '',
  ].join('\n'));
  const home = path.join(work, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ env: SETTINGS_ENV }));

  for (const k of Object.keys(process.env)) if (/^(ANTHROPIC_|CLAUDE_)/.test(k)) delete process.env[k];
  Object.assign(process.env, PARENT, { HOME: home, USERPROFILE: home, FAKE_CLAUDE_INIT_MODEL_KEY: MODEL_KEY,
    FAKE_CLAUDE_MESSAGE_MODEL_KEY: MESSAGE_KEY });

  const cfg = defaultConfig();
  cfg.agents.claude.bin = process.execPath;
  if (mode === 'on') cfg.agents.claude.settings_env_source = 'user_settings';
  const route = { ...resolveClaudeRoute(cfg, null), bin: process.execPath, prefix: [script] };
  const model = 'claude-haiku-4-5-20251001';
  const deny = buildDenySettings(['secret.txt'], ['Read', 'Grep', 'Glob'], denyRuleShapeOf('Read(./x)')).json;
  const opts = (settingsJson) => ({ bin: route.bin, route, cwd: work, prompt: 'review', model, effort: null,
    readonlyArgs: [...READONLY_INVARIANTS], schemaJson: null, settingsJson, timeoutMs: 30_000 });

  const review = await invokeClaude(opts(deny));
  const reviewTrace = parseClaudeEvents(review.stdout);
  const result = buildClaudeResult(reviewTrace, review, { stdout: '/r/s', trace: '/r/t' },
    { version: '9.9.9', path_deny: { file_shape_verified: true } }, readonlyToolsFromProbe(READONLY_INVARIANTS),
    { ruleCount: 0, skipped: [], bytes: 0 });
  const auth = await invokeClaude(opts(null));
  const arm = await withClaudeProbeRoute(route, model, null, () => execArgv(process.execPath, { root: work }, probeArgs({ prompt: 'p' })));
  const probed = await withClaudeProbeRoute(route, model, null, () => probeClaude(process.execPath, { assetRoot: ASSET_ROOT }));
  const directory = await probeClaudeDirectories({ critic: 'claude', cfg, route, model, effort: null,
    readonlyFlags: READONLY_INVARIANTS, schemaPath: resolveReviewSchemaPath(ASSET_ROOT) });

  const texts = { review_stdout: review.stdout, review_stderr: review.stderr, review_commandLine: review.commandLine,
    auth_stdout: auth.stdout, auth_stderr: auth.stderr, arm_raw: arm.raw, arm_stderr: arm.stderr };
  /** 只记键名与次数，不记值 */
  const hits = Object.fromEntries(Object.entries(texts).map(([name, t]) => [name,
    Object.entries(SETTINGS_ENV).filter(([, v]) => t.includes(v)).map(([k]) => k)]));
  const out = {
    tree: path.resolve(tree), mode, scenario,
    route_sha256: createHash('sha256').update(fs.readFileSync(path.join(tree, 'dist/test/src/trivium/adapters/claude-route.js'))).digest('hex'),
    readback: { model_effective: result.model_effective, model_effective_source: result.model_effective_source },
    arm_init_model: arm.init?.model ?? null,
    reported_models: reviewTrace.reportedModels ?? null,
    consistency: typeof traceMod.claudeModelConsistency === 'function'
      ? traceMod.claudeModelConsistency(reviewTrace.init, reviewTrace.reportedModels) : null,
    model_flag: probed.probe.model_flag,
    credential_hits: Object.fromEntries(Object.entries(hits).map(([n, ks]) => [n, ks.filter((k) => CREDENTIAL_KEYS.includes(k))])),
    model_key_hits: Object.fromEntries(Object.entries(hits).map(([n, ks]) => [n, ks.filter((k) => !CREDENTIAL_KEYS.includes(k))])),
    placeholder_in: Object.entries(texts).filter(([, t]) => t.includes('<redacted-env>')).map(([n]) => n),
    normalized_sha256: Object.fromEntries(Object.entries(norm({ texts, result, probe: probed.probe, directory }))
      .map(([k, v]) => [k, createHash('sha256').update(JSON.stringify(v)).digest('hex')])),
  };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2) + '\n');
  console.log(`${mode}/${scenario}：model_effective=${out.readback.model_effective} source=${out.readback.model_effective_source} model_flag=${out.model_flag} reported=${JSON.stringify(out.reported_models)} consistency=${out.consistency}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
