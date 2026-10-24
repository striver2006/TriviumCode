// EV-252 零配额干跑（自动校准播报与照抄计划 r2 第二节第 7 步、D4 末段夹具）：
// 新建夹具 → 用仓库刚构建的打包 CLI `init` → 照搬本仓本机层的 probe.cli / probe.host / generated_at（不拷 auth / auth_routes）→
// 把 agy、zcode 的记录版本改成 0.0.0-ev252-drift → `preflight --skip-auth-check --json`，只输出播报与调用清单的摘要（不打印配置内容）。
// 用法：node doc/05_testing/evidence/recalibrate-announce-20261023/dry-run.mjs <夹具父目录（须已存在、为空的临时目录）>
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';

const REPO = process.cwd();
const BUNDLE = path.join(REPO, 'skills/dual-critic/scripts/trivium.cjs');
const YAML = createRequire(path.join(REPO, 'package.json'))('yaml');
const fx = mkdtempSync(path.join(process.argv[2], 'ev252-fx-'));

mkdirSync(path.join(fx, 'src'), { recursive: true });
writeFileSync(path.join(fx, 'src/x.ts'), 'export const x = 1;\n');
execFileSync('git', ['init', '-q'], { cwd: fx });
execFileSync('git', ['add', 'src/x.ts'], { cwd: fx });
execFileSync('git', ['-c', 'user.email=fx@example.invalid', '-c', 'user.name=fx', 'commit', '-qm', 'fx'], { cwd: fx });

const cli = (args) => spawnSync(process.execPath, [BUNDLE, ...args], { cwd: fx, encoding: 'utf8', maxBuffer: 64 << 20 });
const init = cli(['init']);
if (init.status !== 0) throw new Error(`init 退 ${init.status}：${init.stderr.slice(0, 400)}`);

const localPath = path.join(fx, '.trivium', 'config.local.yaml');
const src = YAML.parse(readFileSync(path.join(REPO, '.trivium', 'config.local.yaml'), 'utf8'));
let dst = {};
try { dst = YAML.parse(readFileSync(localPath, 'utf8')) ?? {}; } catch { /* 新夹具可能没有 */ }
dst.probe = { ...(dst.probe ?? {}), generated_at: src.probe.generated_at, cli: structuredClone(src.probe.cli), host: structuredClone(src.probe.host) };
for (const k of ['agy', 'zcode']) dst.probe.cli[k].version = '0.0.0-ev252-drift';
writeFileSync(localPath, YAML.stringify(dst), 'utf8');

const pf = cli(['preflight', '--stage', 'plan', '--driver', 'claude', '--critics', 'codex,gemini,glm', '--skip-auth-check', '--json']);
const j = JSON.parse(pf.stdout);
const rc = j.recalibration ?? null;
const keys = rc ? Object.keys(rc) : [];
console.log(JSON.stringify({
  fixture: fx,
  exit: pf.status,
  failed: j.checks.filter((c) => !c.ok).map((c) => c.name),
  recalibration_keys: keys,
  eligible: rc?.eligible ?? null,
  announce_before: rc?.announce_before ?? null,
  invocations: (rc?.invocations ?? []).map((i) => ({ only: i.only, args: i.args, bash_timeout_ms: i.bash_timeout_ms })),
  announce_after_pass: rc?.announce_after_pass ?? null,
  announce_before_precedes_invocations_in_stdout: pf.stdout.indexOf('"announce_before"') !== -1
    && pf.stdout.indexOf('"announce_before"') < pf.stdout.indexOf('"invocations"'),
}, null, 2));
