// EV-252 验收后的盘面与残留核对：夹具 agy / zcode 的记录版本与 probed_at（只取这两个键，不打印配置其余内容）、
// 夹具运行根下的 doctor 临时目录台账、仍在跑的 doctor / 探针进程。
// 用法：node accept-residue.mjs <夹具根>
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const FX = process.argv[2];
const YAML = createRequire(path.join(process.cwd(), 'package.json'))('yaml');
const local = YAML.parse(readFileSync(path.join(FX, '.trivium', 'config.local.yaml'), 'utf8'));
const probe = {};
for (const k of ['agy', 'zcode']) probe[k] = { version: local.probe.cli[k].version, probed_at: local.probe.cli[k].probed_at };

const runsRoot = path.join(os.homedir(), '.trivium', 'runs');
const base = path.basename(FX);
const ledgers = [];
for (const d of existsSync(runsRoot) ? readdirSync(runsRoot).filter((n) => n.startsWith(`${base}-`)) : []) {
  for (const f of readdirSync(path.join(runsRoot, d))) if (/^doctor-temp-\d+\.json$/.test(f)) ledgers.push(path.join(d, f));
}
const ps = execFileSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf8' }).split('\n')
  .filter((l) => /trivium\.cjs doctor|--deadline-s/.test(l) && !l.includes('accept-residue'));

console.log(JSON.stringify({ fixture_probe: probe, ledgers, live_doctor_or_probe: ps.map((l) => l.trim()) }, null, 2));
