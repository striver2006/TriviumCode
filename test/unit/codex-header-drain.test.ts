/**
 * EV-205：codex header 探测的轮询计时器收尾。
 *
 * `probeCodexHeader` 在 `run()` 的 `stopEarly` 回调里挂 50 ms 轮询，原先只在见到 header 时清掉，另有一个 31 s 的兜底；
 * `run()` 在子进程自然退出时不通知调用方，所以 codex 不打 header 就退出时，轮询要再空转至多 31 s，
 * 而 CLI 收尾只设 `process.exitCode`、靠事件循环排空退出——doctor 会多挂这么久。现在轮询由调用方的 finally 在 `run` 返回后清掉。
 *
 * 判据是「调用返回之后，进程多久能自然退出」：只能在一个干净的子进程里量（测试进程自己的事件循环里还挂着别的东西）。
 * 每格起一个 drain 子进程，它 import 构建产物、调一次 `probeCodexHeader`、打一行 `RETURNED <结果 JSON>` 后什么都不做；
 * 父侧记下收到那一行与子进程 `exit` 的时刻。修好后排空是毫秒级；漏清时约 31 s 减去调用耗时（不打 header 的格调用在 1 s 内）。
 * 两个上限都取 10 s，两侧余量都在 2 倍以上（计划 r2 §4.1）。
 *
 * 零配额：假 codex 是私有目录里的脚本文件，直接作为 `bin` 传入，不经 `PATH`，不可能拉起真实 CLI。
 *
 * 收尾分工（计划双审 CODEX-02 ≡ GLM-01）：父侧只对自己的直接子进程（drain 子进程，`exit` 到达前 pid 不可复用）兜底 SIGKILL，
 * **不按任何 pid 补杀假 codex**——测试进程是它的祖父，「未回收即不可复用」的保护不成立。假 codex 自己负责不遗留：
 * 父进程变了（drain 子进程被杀、自己成孤儿）就立即退出，另有 40 s 自毙上限。drain 子进程里不加任何清理逻辑：
 * 它的事件循环正是被测对象，多挂一个句柄就会掩盖或伪造漏清。
 *
 * 覆盖边界：codex 挂住既不打 header 也不退出时，要到 `run` 的 30 s 超时才兑现，这条不测（计划 r2 §3.4）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scratchDir } from '../helpers/scratch.js';

/** 构建产物里的被测模块（本文件编译后在 `dist/test/test/unit/`） */
const CODEX_JS = fileURLToPath(new URL('../../src/trivium/probes/codex.js', import.meta.url));

/** 调用返回、返回后排空的上限：修好后两者都远在其下，漏清时排空约 29～31 s */
const LIMIT_MS = 10_000;

/**
 * 假 codex。`FAKE_MODE`：
 *   refuse  —— 不打 header，stderr 一行报错，退 2；
 *   silent  —— 不打 header、无输出，退 0；
 *   labels  —— 打齐五个标签（无分隔线）后自睡，等 run 早退；
 *   divider —— 只打 `model: x` 与分隔线后自睡，等 run 早退。
 * 写 stderr 用 `fs.writeSync`：macOS 上管道写是异步的，紧跟 `process.exit` 可能丢。
 */
const FAKE_BODY = `
const fs = require('node:fs');
const ppid0 = process.ppid;
setInterval(() => { if (process.ppid !== ppid0) process.exit(0); }, 100);
setTimeout(() => process.exit(0), 40000);
const mode = process.env.FAKE_MODE;
if (mode === 'refuse') { fs.writeSync(2, 'error: unknown profile\\n'); process.exit(2); }
if (mode === 'silent') process.exit(0);
if (mode === 'labels') {
  fs.writeSync(2, 'model: m1\\nprovider: p1\\nsandbox: read-only\\nreasoning effort: high\\napproval: never\\n');
}
if (mode === 'divider') fs.writeSync(2, 'model: x\\n--------\\n');
`;

/** drain 子进程：调一次、报一行、什么都不做 */
const DRAIN_BODY = `
import fs from 'node:fs';
const { probeCodexHeader } = await import(process.env.CODEX_JS_URL);
const r = await probeCodexHeader(process.env.FAKE_BIN, [], process.env.PROBE_CWD);
fs.writeSync(1, 'RETURNED ' + JSON.stringify(r) + '\\n');
`;

interface HeaderJson {
  model: string | null;
  provider: string | null;
  sandbox: string | null;
  effort: string | null;
  approval: string | null;
  exitCode: number | null;
  gotHeader: boolean;
  stderr: string;
}

interface Outcome {
  result: HeaderJson;
  /** 拉起 drain 子进程到收到 RETURNED */
  callMs: number;
  /** 收到 RETURNED 到子进程 exit */
  drainMs: number;
}

/** p 在 ms 内兑现则给其值，否则给 'timeout'；计时器在返回前清掉 */
async function within<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runDrain(c: { mode?: string; missingBin?: boolean }): Promise<Outcome> {
  const dir = await scratchDir('trivium-hdrdrain-');
  const fake = path.join(dir, c.missingBin ? 'no-such-codex' : 'codex');
  if (!c.missingBin) await fs.writeFile(fake, `#!${process.execPath}\n${FAKE_BODY}`, { mode: 0o755 });
  const script = path.join(dir, 'drain.mjs');
  await fs.writeFile(script, DRAIN_BODY);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FAKE_MODE: c.mode ?? '',
    FAKE_BIN: fake,
    PROBE_CWD: dir,
    CODEX_JS_URL: pathToFileURL(CODEX_JS).href,
  };
  delete env['NODE_TEST_CONTEXT'];

  const startedAt = Date.now();
  const child = spawn(process.execPath, [script], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let exitedAt: number | null = null;
  const exited = new Promise<void>((resolve) => {
    child.once('exit', () => {
      exitedAt = Date.now();
      resolve();
    });
  });
  let out = '';
  let err = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d: string) => {
    err += d;
  });
  const returned = new Promise<{ json: string; at: number }>((resolve) => {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      out += d;
      const m = /^RETURNED (.*)$/m.exec(out);
      if (m) resolve({ json: m[1]!, at: Date.now() });
    });
  });

  try {
    // 子进程先退出（崩溃）也要结束等待；RETURNED 先于 exit 写出，正常时总是 returned 先到
    const first = await within(Promise.race([returned, exited.then(() => null)]), LIMIT_MS);
    assert.notEqual(first, 'timeout', `调用没有在 ${LIMIT_MS / 1000} 秒内返回（stderr：${err.trim()}）`);
    const ret = first === null ? await within(returned, 1_000) : first;
    assert.ok(ret !== null && ret !== 'timeout', `drain 子进程没打出 RETURNED 就退出了（stderr：${err.trim()}）`);

    const gone = await within(exited, LIMIT_MS);
    assert.notEqual(
      gone,
      'timeout',
      `调用返回后 ${LIMIT_MS / 1000} 秒子进程仍未退出：轮询计时器漏清（EV-205）`,
    );
    return {
      result: JSON.parse(ret.json) as HeaderJson,
      callMs: ret.at - startedAt,
      drainMs: Math.max(0, (exitedAt ?? Date.now()) - ret.at),
    };
  } finally {
    if (exitedAt === null) {
      child.kill('SIGKILL');
      await within(exited, 2_000);
    }
  }
}

/** 计时读数打进测试输出，报告从这里取 */
function report(name: string, o: Outcome): void {
  console.log(`${name}：调用 ${o.callMs} ms，返回后排空 ${o.drainMs} ms`);
}

test('H1 不打 header、非零退出：结论照旧，返回后进程即可退出（EV-205）', async () => {
  const o = await runDrain({ mode: 'refuse' });
  report('H1', o);
  assert.equal(o.result.gotHeader, false);
  assert.equal(o.result.exitCode, 2);
  for (const k of ['model', 'provider', 'sandbox', 'effort', 'approval'] as const) assert.equal(o.result[k], null, k);
  assert.match(o.result.stderr, /error: unknown profile/);
});

test('H2 不打 header、零退出：结论照旧，返回后进程即可退出（EV-205）', async () => {
  const o = await runDrain({ mode: 'silent' });
  report('H2', o);
  assert.equal(o.result.gotHeader, false);
  assert.equal(o.result.exitCode, 0);
  for (const k of ['model', 'provider', 'sandbox', 'effort', 'approval'] as const) assert.equal(o.result[k], null, k);
});

test('H3 入口不存在（启动失败）：结论照旧，返回后进程即可退出（EV-205）', async () => {
  const o = await runDrain({ missingBin: true });
  report('H3', o);
  assert.equal(o.result.gotHeader, false);
  assert.equal(o.result.exitCode, null);
  assert.match(o.result.stderr, /\[spawn error\]/);
});

test('H4 五个标签打齐：早退、字段逐一取到（结论与改动前相同）', async () => {
  const o = await runDrain({ mode: 'labels' });
  report('H4', o);
  assert.deepEqual(
    {
      model: o.result.model,
      provider: o.result.provider,
      sandbox: o.result.sandbox,
      effort: o.result.effort,
      approval: o.result.approval,
      gotHeader: o.result.gotHeader,
      exitCode: o.result.exitCode,
    },
    { model: 'm1', provider: 'p1', sandbox: 'read-only', effort: 'high', approval: 'never', gotHeader: true, exitCode: null },
  );
});

test('H5 只见到分隔线：早退、只取到已打出的标签（结论与改动前相同）', async () => {
  const o = await runDrain({ mode: 'divider' });
  report('H5', o);
  assert.deepEqual(
    {
      model: o.result.model,
      provider: o.result.provider,
      sandbox: o.result.sandbox,
      effort: o.result.effort,
      approval: o.result.approval,
      gotHeader: o.result.gotHeader,
      exitCode: o.result.exitCode,
    },
    { model: 'x', provider: null, sandbox: null, effort: null, approval: null, gotHeader: true, exitCode: null },
  );
});
