// EV-254 真实验收读数（只读）：从 doctor --json 输出取判据字段，并读夹具落盘后的本机层核对登记。
// 用法：node accept-readout.mjs 〈仓库根〉 〈doctor 输出 JSON〉 〈夹具目录〉
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(process.argv[2]);
const out = fs.readFileSync(process.argv[3], 'utf8');
const fixture = path.resolve(process.argv[4]);
const { loadCtx } = await import(path.join(repo, 'dist/test/src/trivium/config.js'));
const { claudeProbeForRoute, resolveClaudeRoute } = await import(path.join(repo, 'dist/test/src/trivium/adapters/claude-route.js'));
const { CLAUDE_ROUTE_CHANGED_BLOCKER } = await import(path.join(repo, 'dist/test/src/trivium/doctor.js'));

const j = JSON.parse(out.slice(out.indexOf('{')));
const c = j.probe.cli.claude;
const persisted = (await loadCtx({ cwd: fixture, allowUninitialized: true })).config;
const p = persisted.probe.cli.claude;
const native = p?.routes?.native;
console.log(JSON.stringify({
  ok: j.ok,
  blockers: j.blockers,
  route_changed_blocker: j.blockers.includes(CLAUDE_ROUTE_CHANGED_BLOCKER),
  warnings: j.warnings,
  report: { version: c?.version, entrypoint: c?.entrypoint, readonly_flags: c?.readonly_flags,
    directory_deny_verified: c?.directory_deny_verified, directory_deny_fingerprint_set: Boolean(c?.directory_deny_fingerprint),
    routes: Object.fromEntries(Object.entries(c?.routes ?? {}).map(([k, v]) => [k, v.probe.version])) },
  persisted: { version: p?.version ?? null, native_version: native?.probe.version ?? null,
    native_fingerprint_matches: native ? native.fingerprint === resolveClaudeRoute(persisted, null, native.probe.version).fingerprint : null,
    native_consumable_version: claudeProbeForRoute(persisted, null)?.version ?? null,
    readonly_flags: p?.readonly_flags ?? null },
  directory_failure: j.directoryEvidence?.failure ?? null,
}, null, 2));
