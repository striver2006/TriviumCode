/**
 * EV-260 零配额实测入口（Windows）。
 *
 * 被测对象：esbuild 即时打包的 writeAtomic（源：仓库 src/trivium/util/fsx.ts，零改编），
 * 缺省参数（真 775 ms 档）——测的是缺省行为。持柄方 hold.ps1 以 FileShare.None 打开目标
 * （不含 Delete ⇒ rename 覆盖被拒），File.Open 成功后打一行 READY，本侧读到 READY 才起表。
 *
 * 场景 A：按住 400 ms 放开 → 重试后成功（耗时按缺省档应在 ~775 ms 一带）。
 * 场景 B：按住 5000 ms（≫上界）→ 抛原始错误（EPERM/EACCES）且 tmp 已清。
 * 输出：JSON 读数打到 stdout（由外层收集，UTF-8 落盘在仓库外）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { writeAtomic } from './fsx-src.ts';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function holdViaPowerShell(target: string, holdMs: number): { ready: Promise<void>; done: Promise<void> } {
  const child = spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(import.meta.dirname, 'hold.ps1'), '-Path', target, '-HoldMs', String(holdMs)],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let out = '';
  let readyResolve: () => void;
  const ready = new Promise<void>((r) => {
    readyResolve = r;
  });
  child.stdout.on('data', (chunk: Buffer) => {
    out += chunk.toString('utf8');
    if (out.includes('READY')) readyResolve();
  });
  const done = new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`powershell exited ${code}`))));
  });
  return { ready, done };
}

const tmpLeftovers = async (dir: string): Promise<string[]> =>
  (await fs.readdir(dir)).filter((n) => n.includes('.tmp-'));

async function scenarioA(): Promise<Record<string, unknown>> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-atomic-live-A-'));
  const target = path.join(dir, 'status.json');
  await writeAtomic(target, 'initial');
  const hold = holdViaPowerShell(target, 400);
  await hold.ready;
  const t0 = Date.now();
  await writeAtomic(target, 'updated-A');
  const elapsedMs = Date.now() - t0;
  const content = await fs.readFile(target, 'utf8');
  const leftovers = await tmpLeftovers(dir);
  await hold.done;
  return {
    scenario: 'A: hold 400ms then release -> retry succeeds',
    ok: content === 'updated-A' && leftovers.length === 0 && elapsedMs >= 300 && elapsedMs <= 1500,
    elapsed_ms: elapsedMs,
    final_content: content,
    tmp_leftovers: leftovers,
  };
}

async function scenarioB(): Promise<Record<string, unknown>> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-atomic-live-B-'));
  const target = path.join(dir, 'status.json');
  await writeAtomic(target, 'initial');
  const hold = holdViaPowerShell(target, 5000);
  await hold.ready;
  const t0 = Date.now();
  let err: NodeJS.ErrnoException | null = null;
  try {
    await writeAtomic(target, 'updated-B');
  } catch (e) {
    err = e as NodeJS.ErrnoException;
  }
  const elapsedMs = Date.now() - t0;
  // 先等按柄方放手再读目标：FileShare.None 连读都不给（harness 时序，非被测行为）
  await hold.done;
  const leftovers = err ? await tmpLeftovers(dir) : [];
  const finalContent = await fs.readFile(target, 'utf8');
  return {
    scenario: 'B: hold 5000ms (beyond bound) -> original error, tmp cleaned',
    ok: err !== null && (err.code === 'EPERM' || err.code === 'EACCES') && leftovers.length === 0 && elapsedMs >= 700 && elapsedMs <= 3000,
    error_code: err?.code ?? null,
    error_message: err?.message ?? null,
    elapsed_ms: elapsedMs,
    tmp_leftovers: leftovers,
    final_content: finalContent,
  };
}

const results = [await scenarioA(), await scenarioB()];
console.log(JSON.stringify({ generated_at: new Date().toISOString(), results }, null, 2));
if (results.some((r) => !r.ok)) process.exit(1);
