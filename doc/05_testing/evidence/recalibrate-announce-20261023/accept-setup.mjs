// EV-252 真实会话验收的夹具搭建（自动校准播报与照抄计划 r2 D4 末段，CODEX-01：同时造两家漂移）。
// 新建 ~/Work/trivium-ev252-accept（已存在则拒绝）→ 写 README 与 src/greet.ts 并提交 → 用全局副本 `init` →
// 照搬本仓本机层的 probe.cli / probe.host / generated_at（不拷 auth / auth_routes，零配额）→ agy、zcode 的记录版本改成 0.0.0-ev252-drift →
// 放一份待审计划原稿（沿用 EV-251 验收的那份）→ `preflight --skip-auth-check --json` 零配额干跑，只输出摘要（不打印配置内容）。
// 用法：在本仓根执行 `node doc/05_testing/evidence/recalibrate-announce-20261023/accept-setup.mjs`
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const REPO = process.cwd();
const BUNDLE = path.join(os.homedir(), '.claude/skills/dual-critic/scripts/trivium.cjs');
const YAML = createRequire(path.join(REPO, 'package.json'))('yaml');
const FX = path.join(os.homedir(), 'Work', 'trivium-ev252-accept');
const TOPIC = '自动校准验收';
const DRAFT_SRC = path.join(REPO, 'doc/05_testing/evidence/preflight-recalibrate-20261022/accept-20261023/fixture-reviews/plan', `2026-10-23-${TOPIC}-claude.md`);

if (existsSync(FX)) throw new Error(`夹具目录已存在，不覆盖：${FX}`);
mkdirSync(path.join(FX, 'src'), { recursive: true });
writeFileSync(path.join(FX, 'README.md'), '# trivium-ev252-accept\n\nEV-252 真实会话验收夹具（自动校准播报与照抄）。\n');
writeFileSync(path.join(FX, 'src/greet.ts'), "export function greet(name: string): string {\n  return `hello ${name}`;\n}\n");
const git = (args) => execFileSync('git', args, { cwd: FX, encoding: 'utf8' });
git(['init', '-q']);
git(['add', 'README.md', 'src/greet.ts']);
git(['-c', 'user.email=fx@example.invalid', '-c', 'user.name=fx', 'commit', '-qm', 'fixture']);

const cli = (args) => spawnSync(process.execPath, [BUNDLE, ...args], { cwd: FX, encoding: 'utf8', maxBuffer: 64 << 20 });
const init = cli(['init']);
if (init.status !== 0) throw new Error(`init 退 ${init.status}：${init.stderr.slice(0, 400)}`);

const localPath = path.join(FX, '.trivium', 'config.local.yaml');
const src = YAML.parse(readFileSync(path.join(REPO, '.trivium', 'config.local.yaml'), 'utf8'));
let dst = {};
try { dst = YAML.parse(readFileSync(localPath, 'utf8')) ?? {}; } catch { /* init 可能没写本机层 */ }
dst.probe = { ...(dst.probe ?? {}), generated_at: src.probe.generated_at, cli: structuredClone(src.probe.cli), host: structuredClone(src.probe.host) };
for (const k of ['agy', 'zcode']) dst.probe.cli[k].version = '0.0.0-ev252-drift';
writeFileSync(localPath, YAML.stringify(dst), 'utf8');

const planDir = path.join(FX, '.reviews', TOPIC, 'plan');
mkdirSync(planDir, { recursive: true });
writeFileSync(path.join(planDir, `2026-10-23-${TOPIC}-claude.md`), readFileSync(DRAFT_SRC, 'utf8'));

const pf = cli(['preflight', '--stage', 'plan', '--driver', 'claude', '--critics', 'codex,gemini,glm', '--skip-auth-check', '--json']);
const j = JSON.parse(pf.stdout);
const rc = j.recalibration ?? null;
console.log(JSON.stringify({
  fixture: FX,
  bundle: BUNDLE,
  exit: pf.status,
  failed: j.checks.filter((c) => !c.ok).map((c) => c.name),
  recalibration_keys: rc ? Object.keys(rc) : [],
  eligible: rc?.eligible ?? null,
  announce_before: rc?.announce_before ?? null,
  invocations: (rc?.invocations ?? []).map((i) => i.args.join(' ')),
  warnings: j.warnings.map((w) => w.name),
}, null, 2));
