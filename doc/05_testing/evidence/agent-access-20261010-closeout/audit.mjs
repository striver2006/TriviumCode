/** 只读核对：不启动厂商 CLI，不执行 profile，不修改配置。输出先脱敏再扫描。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadCtx } from '../../../../dist/test/src/trivium/config.js';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { resolveClaudeRoute, claudeProfilesDir } from '../../../../dist/test/src/trivium/adapters/claude-route.js';
import { codexAdapter } from '../../../../dist/test/src/trivium/adapters/codex.js';
import { redactSecrets, scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const git = (...args) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: repo, encoding: 'utf8' }).trim();
const ctx = await loadCtx({ cwd: repo });
const output = {
  client_date: '2026-10-10', timezone: 'Asia/Singapore', observed_at: new Date().toISOString(),
  real_cli_launches: 0, budget_approval: null,
  script_sha256: sha(fileURLToPath(import.meta.url)),
  prior_probe_script_sha256_current_only: sha(path.join(repo, 'scripts/probe-agent-access.mjs')),
  historical_probe_script_sha256: null,
  git: { head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
    status_before_audit: git('status', '--short'), remote_main: git('ls-remote', 'origin', 'refs/heads/main').split(/\s+/)[0] },
  current_build: await computeBuildStamp(repo),
  package_version: JSON.parse(fs.readFileSync(path.join(repo, 'package.json'))).version,
  wrapper: { path: path.join(repo, '.trivium/bin/trivium'), sha256: sha(path.join(repo, '.trivium/bin/trivium')) },
  bundles: [], claude: [], codex: [], old_batches: [],
  shared_critics: ['claude', 'gemini', 'glm'], effective_critics: ctx.config.review.default_critics,
  current_cli_version_probe: null,
};
for (const file of [path.join(repo, 'skills/dual-critic/scripts/trivium.cjs'),
  path.join(os.homedir(), '.claude/skills/dual-critic/scripts/trivium.cjs')]) {
  const text = fs.readFileSync(file, 'utf8');
  const match = /define_TRIVIUM_BUILD_default = \{ repo_root_commit: "([a-f0-9]+)", git_head: "([a-f0-9]+)", dirty: (true|false), inputs_sha256: "([a-f0-9]+)", built_at: "([^"]+)" \}/.exec(text);
  output.bundles.push({ path: file, sha256: sha(file), stamp: match ? {
    repo_root_commit: match[1], git_head: match[2], dirty: match[3] === 'true', inputs_sha256: match[4], built_at: match[5],
  } : null });
}
for (const profile of ['qwen', 'kimi', 'deepseek']) {
  const route = resolveClaudeRoute(ctx.config, profile);
  const saved = ctx.config.probe.cli.claude?.routes?.[`profile:${profile}`];
  const text = fs.readFileSync(path.join(claudeProfilesDir(), `${profile}.env`), 'utf8');
  const declarations = {};
  for (const key of ['ANTHROPIC_MODEL', 'ANTHROPIC_DEFAULT_OPUS_MODEL', 'ANTHROPIC_DEFAULT_SONNET_MODEL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL']) {
    declarations[key] = new RegExp('^\\s*export\\s+' + key + '=["\x27]?([\\w./:+-]+)', 'm').exec(text)?.[1] ?? null;
  }
  const entry = fs.realpathSync(route.nativeBin);
  output.claude.push({ profile, native_entry: route.nativeBin, resolved_entry: entry, entry_sha256: sha(entry),
    wrapper: route.bin, wrapper_sha256: route.wrapperSha256, configuration_sha256: route.configurationSha256,
    fingerprint_with_saved_version: route.fingerprint, saved_fingerprint: saved?.fingerprint ?? null,
    fingerprint_matches_using_saved_version: route.fingerprint === saved?.fingerprint,
    saved_cli_version: saved?.probe.version ?? null, current_version_probe: null, declarations,
    denied_tool_in_trace: saved?.probe.denied_tool_in_trace ?? null,
    current_model_effective: null, current_provider_effective: null,
  });
}
for (const profile of [null, 'qwen', 'kimi', 'deepseek']) {
  const access = codexAdapter.accessFor(ctx.config, profile);
  const entry = fs.realpathSync(access.launcher_requested);
  let staticPackage = null;
  let dir = path.dirname(entry);
  for (let i = 0; i < 5; i++, dir = path.dirname(dir)) {
    const file = path.join(dir, 'package.json');
    if (fs.existsSync(file)) { const pkg = JSON.parse(fs.readFileSync(file)); staticPackage = { path: file, name: pkg.name, version: pkg.version }; break; }
  }
  output.codex.push({ profile, access, resolved_entry: entry, entry_sha256: sha(entry), static_package: staticPackage,
    saved_capability_version: ctx.config.probe.cli.codex?.version ?? null, current_version_probe: null,
    current_model_effective: null, current_provider_effective: null,
  });
}
const oldRoot = path.join(repo, 'doc/05_testing/evidence/agent-access-20261009');
for (let batch = 1; batch <= 4; batch++) {
  const dir = path.join(oldRoot, `batch-${batch}`);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json')));
  const files = fs.readdirSync(dir).filter(n => /^(launch|reserved)-\d+\.json$/.test(n));
  const launches = files.filter(n => n.startsWith('launch-')).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
  const records = launches.map(name => {
    const file = path.join(dir, name), raw = JSON.parse(fs.readFileSync(file));
    const toolUses = [];
    for (const line of (raw.stdout ?? '').split('\n')) {
      let event; try { event = JSON.parse(line); } catch { continue; }
      if (event.type === 'assistant') for (const block of event.message?.content ?? []) {
        if (block.type === 'tool_use') toolUses.push({ name: block.name, id: block.id ?? null });
      }
    }
    return { name, sha256: sha(file), code: raw.code, timed_out: raw.timedOut,
      kind: raw.commandLine?.includes('--version') ? 'version' : raw.commandLine?.includes('--help') ? 'help' : 'probe', tool_uses: toolUses };
  });
  output.old_batches.push({ batch, used: summary.used, limit: summary.limit,
    reserved_records: files.filter(n => n.startsWith('reserved-')).length, launch_records: launches.length,
    summary_sha256: sha(path.join(dir, 'summary.json')), records });
}
output.global_hashes = Object.fromEntries(['.codex/config.toml','.codex/auth.json','.codex/hooks.json','.claude/settings.json','.gemini/config/agents/trivium-critic/agent.md'].map(n => [n, fs.existsSync(path.join(os.homedir(), n)) ? sha(path.join(os.homedir(), n)) : null]));
output.historical_roots = [];
for (const n of ['agent-access-20261010-admission','agent-access-20261010-claude-three-providers','agent-access-20261010-provider-routing','agent-access-20261010-codex-native-default','agent-access-20261010-codex-native-tiers']) {
  const dir = path.join(repo, 'doc/05_testing/evidence', n);
  const files = {};
  function walk(d) { for (const e of fs.readdirSync(d, {withFileTypes:true})) { const p=path.join(d,e.name); if(e.isDirectory()) walk(p); else files[path.relative(dir,p)]=sha(p); } }
  walk(dir);
  output.historical_roots.push({name:n,files});
}
const clean = redactSecrets(JSON.stringify(output, null, 2)).content + '\n';
if (scanSecrets(clean).length) throw new Error('脱敏后扫描未通过，拒绝落盘');
fs.writeFileSync(path.join(here, 'baseline.json'), clean, { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ evidence: path.join(here, 'baseline.json'), real_cli_launches: 0,
  bundle_match: output.bundles[0].sha256 === output.bundles[1].sha256,
  embedded_head: output.bundles[0].stamp?.git_head, embedded_dirty: output.bundles[0].stamp?.dirty,
  inputs_match: output.bundles[0].stamp?.inputs_sha256 === output.current_build?.inputs_sha256,
  old_launches: output.old_batches.reduce((n, b) => n + b.launch_records, 0), secret_scan: 'passed' }));
