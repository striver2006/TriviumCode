// EV-25 真实 codex 验证：在脚本自己的 mkdtemp 夹具里跑一次生产代码的只读负对照（runReadonlyControl），记读数。
// 花 1 次 codex 真实调用。profile / 模型按 probeCodex 的选法从本机探针记录（仓库 .trivium/config.local.yaml，只读）里取。
// 收尾只删本脚本 mkdtemp 的返回值（R1 / R2 / R5）。
// 用法（在仓库根，先 node scripts/build.mjs --with-tests）：node doc/05_testing/evidence/codex-readonly-control-20261006/real-codex-control.mjs
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import YAML from 'yaml';

const ROOT = process.cwd();
const mod = await import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium/probes/codex.js')).href);

const local = YAML.parse(await fs.readFile(path.join(ROOT, '.trivium', 'config.local.yaml'), 'utf8'));
const rec = local?.probe?.cli?.codex ?? {};
const bin = rec.entrypoint ?? '/opt/homebrew/bin/codex';
let profile = null;
let model = null;
for (const name of rec.profiles ?? []) {
  const models = rec.models_by_profile?.[name] ?? [];
  const usable = models.find((m) => m === 'deepseek-flash') ?? models[0];
  if (usable) { profile = name; model = usable; break; }
}
if (!model) throw new Error('探针记录里没有可用的 profile / 模型，停下（不花配额）');

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev25real-'));
const t0 = Date.now();
let out;
try {
  const { verdict, write } = await mod.runReadonlyControl(bin, { root: tmp }, profile, model);
  const narrative = /只读|read-only|not permitted|sandbox/i.test(write.finalText ?? '');
  out = {
    bin, profile, model,
    recorded_readonly_flags: rec.readonly_flags ?? null,
    recorded_rejected_command_in_trace: rec.rejected_command_in_trace ?? null,
    verdict,
    completed: write.completed,
    timedOut: write.timedOut,
    elapsed_ms: Date.now() - t0,
    file_exists_after: await fs.access(path.join(tmp, mod.READONLY_CONTROL_FILE)).then(() => true, () => false),
    // 与 probeCodex 同一公式（判据未改），看提示换成钉死命令后的读数
    rejected_command_in_trace_now: !write.completed ? null : narrative ? write.commands.length > 0 : null,
    commands: write.commands.map((c) => ({ command: c.command, status: c.status, exitCode: c.exitCode, output: (c.output ?? '').slice(0, 400) })),
    finalText: (write.finalText ?? '').slice(0, 600),
    errors: write.errors,
  };
} finally {
  // R5：只删本脚本 mkdtemp 的返回值，且必须落在系统临时目录下
  const base = await fs.realpath(os.tmpdir());
  const real = await fs.realpath(tmp);
  if (!real.startsWith(base + path.sep) || !path.basename(real).startsWith('trivium-ev25real-')) {
    throw new Error(`拒绝删除：${real} 不在 ${base} 下或前缀不符`);
  }
  await fs.rm(tmp, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
