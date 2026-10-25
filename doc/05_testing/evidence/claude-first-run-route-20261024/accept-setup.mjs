// EV-254 真实 CLI 验收的夹具搭建（零配额，不起任何 CLI）。
// 两格：upgrade（照搬本仓本机层的 agents.claude 与 probe.host / probe.cli.claude，把 claude 版本改记 2.1.309 并按该版本重算 native 登记指纹）；
// fresh（本机层只有注释头：没有 agents.claude、没有任何 claude 结论——缺省配置下的全新安装）。
// 两格的共享层都是本仓 .trivium/config.yaml 原样复制。不拷 probe.auth / probe.auth_routes，不读也不打印任何凭据。
// 用法：node accept-setup.mjs 〈仓库根〉 〈夹具父目录（须不存在）〉
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const repo = path.resolve(process.argv[2]);
const base = path.resolve(process.argv[3]);
const OLD = '2.1.309';
const { parse, stringify } = await import(path.join(repo, 'node_modules/yaml/dist/index.js'));
const { loadCtx } = await import(path.join(repo, 'dist/test/src/trivium/config.js'));
const { resolveClaudeRoute, claudeProbeForRoute } = await import(path.join(repo, 'dist/test/src/trivium/adapters/claude-route.js'));

if (fs.existsSync(base)) throw new Error(`夹具父目录已存在：${base}`);
const shared = fs.readFileSync(path.join(repo, '.trivium', 'config.yaml'), 'utf8');
const local = parse(fs.readFileSync(path.join(repo, '.trivium', 'config.local.yaml'), 'utf8'));
const HEADER = '# EV-254 验收夹具的本机层（由 accept-setup.mjs 生成）\n';

function makeFixture(name, localLayer) {
  const dir = path.join(base, name);
  fs.mkdirSync(path.join(dir, '.trivium'), { recursive: true });
  execFileSync('git', ['init', '-q', dir]);
  fs.writeFileSync(path.join(dir, 'README.md'), `EV-254 acceptance fixture: ${name}\n`);
  fs.writeFileSync(path.join(dir, '.trivium', 'config.yaml'), shared);
  fs.writeFileSync(path.join(dir, '.trivium', 'config.local.yaml'), HEADER + (localLayer ? stringify(localLayer) : ''), { mode: 0o600 });
  return dir;
}

// upgrade：根结论与 native 登记都改记旧版本，其余路线登记原样保留
const claude = structuredClone(local.probe.cli.claude);
const fromVersion = claude.version;
claude.version = OLD;
if (!claude.routes?.native) throw new Error('本机层没有 native 路线登记，无法构造升级格');
claude.routes.native.probe.version = OLD;
const upgradeLayer = { agents: { claude: local.agents.claude }, probe: { host: local.probe.host, cli: { claude } } };
const upgrade = makeFixture('upgrade', upgradeLayer);
// 指纹按夹具合并后的配置与旧版本重算（照 doctor 的登记写法），保证旧登记在夹具里可被消费
const cfg = (await loadCtx({ cwd: upgrade, allowUninitialized: true })).config;
claude.routes.native.fingerprint = resolveClaudeRoute(cfg, null, OLD).fingerprint;
fs.writeFileSync(path.join(upgrade, '.trivium', 'config.local.yaml'), HEADER + stringify(upgradeLayer), { mode: 0o600 });
const fresh = makeFixture('fresh', null);

const summary = async (dir) => {
  const c = (await loadCtx({ cwd: dir, allowUninitialized: true })).config;
  const p = c.probe.cli.claude;
  return { dir, agents_claude_bin: c.agents.claude?.bin ?? null, root_version: p?.version ?? null, root_entrypoint: p?.entrypoint ?? null,
    routes: Object.fromEntries(Object.entries(p?.routes ?? {}).map(([k, v]) => [k, v.probe.version])),
    native_consumable_version: claudeProbeForRoute(c, null)?.version ?? null,
    native_route_bin: resolveClaudeRoute(c, null).nativeBin };
};
console.log(JSON.stringify({ source_version: fromVersion, upgrade: await summary(upgrade), fresh: await summary(fresh) }, null, 2));
