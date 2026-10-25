// 零配额核验：全新安装（agents.claude.bin 未设、盘上无 entrypoint）时，
// 写回前后只统一 version（候选 B）是否仍判路线变化。纯函数，不起任何 CLI。
import path from 'node:path';
const root = process.argv[2];
const { resolveClaudeRoute } = await import(path.join(root, 'dist/test/src/trivium/adapters/claude-route.js'));
const { defaultConfig } = await import(path.join(root, 'dist/test/src/trivium/config.js'));

function cell(name, mk) {
  const cfg = defaultConfig();
  mk(cfg);
  const before = resolveClaudeRoute(cfg, null);
  const fresh = { ...cfg.probe.cli.claude, entrypoint: '/fixture/bin/claude', version: '2.1.310' };
  delete fresh.routes;
  const mutated = { ...cfg, probe: { ...cfg.probe, cli: { ...cfg.probe.cli, claude: fresh } } };
  const afterWriteback = resolveClaudeRoute(mutated, null);
  const afterPinnedVersion = resolveClaudeRoute(mutated, null, cfg.probe.cli.claude?.version ?? null);
  const afterCopy = resolveClaudeRoute(cfg, null);
  console.log(JSON.stringify({ cell: name,
    nativeBin: [before.nativeBin, afterWriteback.nativeBin],
    stable_writeback: before.fingerprint === afterWriteback.fingerprint,
    stable_B_pin_version: before.fingerprint === afterPinnedVersion.fingerprint,
    stable_A_copy: before.fingerprint === afterCopy.fingerprint }));
}

cell('全新安装·bin 未配置', () => {});
cell('全新安装·bin 已配置', (cfg) => { cfg.agents.claude.bin = '/fixture/bin/claude'; });
cell('升级·盘上 2.1.309', (cfg) => { cfg.probe.cli.claude.entrypoint = '/fixture/bin/claude'; cfg.probe.cli.claude.version = '2.1.309'; });
