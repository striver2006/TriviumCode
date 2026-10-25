// EV-256 零配额验收的执行半边：对一棵已构建的树（基线 `40dbab4f` 或当前工作树）用假 CLI 跑四组带模型调用
// （审查调用、探活、探针各臂、目录臂），记下每次 spawn 的 argv 与 ANTHROPIC_/CLAUDE_ 环境。
// 装置与 test/integration/claude-gateway-env.test.ts 同口径：宿主前缀变量全部摘下、家目录钉到临时目录、
// 父进程放两个合成键。值全是假值，宿主真实凭据不进子进程、不进记录。
// 加 `--sample` 时假 CLI 每次调用多停 1.5 秒，期间按 300 ms 间隔用 ps 采样带本次标记的子进程命令行（A-2 进程表），
// 只记「采到几行、其中几行含网关值、含的是哪些键名」，不记值。
// 用法：node accept-run.mjs 〈树根〉 on|off 〈输出 JSON〉 [--sample]
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const [tree, mode, outFile] = process.argv.slice(2);
const sample = process.argv.includes('--sample');
const mod = (p) => import(pathToFileURL(path.join(tree, 'dist/test/src/trivium', p)).href);
const { defaultConfig, resolveReviewSchemaPath } = await mod('config.js');
const { probeClaude, withClaudeProbeRoute, READONLY_INVARIANTS } = await mod('probes/claude.js');
const { probeClaudeDirectories } = await mod('probes/claude-directory.js');
const { buildDenySettings, denyRuleShapeOf, invokeClaude } = await mod('adapters/claude.js');
const { resolveClaudeRoute } = await mod('adapters/claude-route.js');
const ASSET_ROOT = path.join(tree, 'skills/dual-critic');

const SETTINGS_ENV = {
  ANTHROPIC_BASE_URL: 'https://gw-ev256.invalid/api',
  ANTHROPIC_AUTH_TOKEN: 'gw-ev256-auth-01',
  ANTHROPIC_MODEL: 'gw-ev256-model-01',
  CLAUDE_CODE_SUBAGENT_MODEL: 'gw-ev256-sub-01',
  GATEWAY_EXTRA_EV256: 'gw-ev256-extra-01',
  ANTHROPIC_EMPTY_EV256: '',
};
const PARENT = { ANTHROPIC_AUTH_TOKEN: 'parent-ev256-auth', ANTHROPIC_PARENT_ONLY_EV256: 'parent-ev256-only' };
const VALUES = Object.entries(SETTINGS_ENV).filter(([, v]) => v.length > 0);

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'trivium-ev256-accept-'));
try {
  const marker = `ev256mark${process.pid}`;
  const script = path.join(work, `fake-claude-${marker}.cjs`);
  fs.writeFileSync(script, [
    "const fs = require('node:fs');",
    'const argv = process.argv.slice(2);',
    "const valueKeys = (process.env.FAKE_CLAUDE_VALUE_KEYS || '').split(',').filter(Boolean);",
    'const env = {};',
    'for (const k of Object.keys(process.env)) if (/^(ANTHROPIC_|CLAUDE_)/.test(k)) env[k] = valueKeys.includes(k) ? process.env[k] : null;',
    "fs.appendFileSync(process.env.FAKE_CLAUDE_LOG, JSON.stringify({ argv, env, extra: 'GATEWAY_EXTRA_EV256' in process.env }) + '\\n');",
    "if (argv.includes('--version')) { process.stdout.write('9.9.9 (Fake Claude)\\n'); process.exit(0); }",
    'function emit(o) { process.stdout.write(JSON.stringify(o) + "\\n"); }',
    'process.stdin.resume();',
    "process.stdin.on('end', () => setTimeout(() => {",
    "  const structured = argv.includes('--json-schema');",
    "  emit({ type: 'system', subtype: 'init', cwd: process.cwd(), tools: structured ? ['Read', 'Grep', 'Glob', 'StructuredOutput'] : ['Read', 'Grep', 'Glob'], model: 'claude-haiku-4-5-20251001', session_id: 'fake-session' });",
    "  const result = structured ? JSON.stringify({ schema: 'trivium.review.v1', verdict: 'approve', summary: 'fake summary', findings: [] }) : 'ok';",
    "  emit({ type: 'result', subtype: 'success', is_error: false, result, total_cost_usd: 0.001, session_id: 'fake-session' });",
    '  process.exit(0);',
    '}, Number(process.env.FAKE_CLAUDE_SLEEP_MS || 0)));',
    '',
  ].join('\n'));
  const home = path.join(work, 'home');
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ env: SETTINGS_ENV }));
  const log = path.join(work, 'calls.jsonl');

  for (const k of Object.keys(process.env)) if (/^(ANTHROPIC_|CLAUDE_)/.test(k)) delete process.env[k];
  Object.assign(process.env, PARENT, { HOME: home, USERPROFILE: home, FAKE_CLAUDE_LOG: log,
    FAKE_CLAUDE_VALUE_KEYS: [...Object.keys(SETTINGS_ENV), ...Object.keys(PARENT)].join(','),
    FAKE_CLAUDE_SLEEP_MS: sample ? '1500' : '0' });

  const cfg = defaultConfig();
  cfg.agents.claude.bin = process.execPath;
  if (mode === 'on') cfg.agents.claude.settings_env_source = 'user_settings';
  const route = { ...resolveClaudeRoute(cfg, null), bin: process.execPath, prefix: [script] };
  const model = 'claude-haiku-4-5-20251001';
  const deny = buildDenySettings(['secret.txt'], ['Read', 'Grep', 'Glob'], denyRuleShapeOf('Read(./x)')).json;
  const opts = (settingsJson) => ({ bin: route.bin, route, cwd: work, prompt: 'review', model, effort: null,
    readonlyArgs: [...READONLY_INVARIANTS], schemaJson: null, settingsJson, timeoutMs: 30_000 });

  // A-2：ps 采样（只在 --sample 时）
  const ps = { samples: 0, lines: 0, leakLines: 0, leakKeys: [] };
  let timer = null;
  if (sample) {
    timer = setInterval(() => {
      let out = '';
      try { out = execFileSync('/bin/ps', ['-axww', '-o', 'pid=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }); } catch { return; }
      ps.samples++;
      for (const line of out.split('\n')) {
        if (!line.includes(marker) || line.includes('accept-run.mjs')) continue;
        ps.lines++;
        const hit = VALUES.filter(([, v]) => line.includes(v)).map(([k]) => k);
        if (hit.length) { ps.leakLines++; for (const k of hit) if (!ps.leakKeys.includes(k)) ps.leakKeys.push(k); }
      }
    }, 300);
  }

  const groups = {};
  const take = async (name, fn) => {
    fs.writeFileSync(log, '');
    await fn();
    groups[name] = fs.readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  };
  try {
    await take('review', () => invokeClaude(opts(deny)));
    await take('auth', () => invokeClaude(opts(null)));
    await take('probe', () => withClaudeProbeRoute(route, model, null, () => probeClaude(process.execPath, { assetRoot: ASSET_ROOT })));
    await take('directory', () => probeClaudeDirectories({ critic: 'claude', cfg, route, model, effort: null,
      readonlyFlags: READONLY_INVARIANTS, schemaPath: resolveReviewSchemaPath(ASSET_ROOT) }));
  } finally {
    if (timer) clearInterval(timer);
  }
  // 归一化：本次临时目录、假 CLI 路径、探针夹具的随机目录名
  const norm = (s) => s.split(work).join('<work>').split(script).join('<script>')
    .replace(/[^\s"'\\]*trivium-[A-Za-z0-9_-]*[A-Za-z0-9]{6}[^\s"'\\]*/g, '<tmp>');
  const normalized = Object.fromEntries(Object.entries(groups).map(([k, recs]) =>
    [k, recs.map((r) => ({ argv: r.argv.map(norm), env: r.env, extra: r.extra }))]));
  fs.writeFileSync(outFile, JSON.stringify({ tree, mode, sample, groups: normalized, ...(sample ? { ps } : {}) }, null, 2) + '\n');
  console.log(`${mode}${sample ? ' sample' : ''}: ${Object.entries(groups).map(([k, v]) => `${k}=${v.length}`).join(' ')}` +
    (sample ? ` ps: samples=${ps.samples} lines=${ps.lines} leakLines=${ps.leakLines} keys=${ps.leakKeys.join(',') || '-'}` : ''));
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
