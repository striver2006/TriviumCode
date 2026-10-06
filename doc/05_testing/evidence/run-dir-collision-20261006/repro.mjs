// EV-218 零配额复现：同一仓库两个主题同一秒 `review --start`，看是否分到同一 run_id、是否共用一个运行目录、
// status.json / request.json 是否互相覆盖。桩审查员（TRIVIUM_STUB_CRITIC），不调任何真实 CLI。
// 夹具由测试辅助函数 makeFixture 建在 scratchDir（mkdtemp）里、本进程退出时由它自己删；本脚本不写任何删除代码。
// 运行根在夹具父目录下（makeFixture 钉的 runtime.run_root），不碰 ~/.trivium/runs。
// 用法（在仓库根，先 node scripts/build.mjs --with-tests）：node doc/05_testing/evidence/run-dir-collision-20261006/repro.mjs
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const fx = await import(pathToFileURL(path.join(ROOT, 'dist/test/test/helpers/fixture.js')).href);
const { extractJsonCandidate } = await import(pathToFileURL(path.join(ROOT, 'dist/test/src/trivium/parse.js')).href);

const STUB = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };
const A = 'EV218甲';
const B = 'EV218乙';
const MAX_ATTEMPTS = 6;

const runIdOf = (r) => {
  try {
    return JSON.parse(extractJsonCandidate(r.stdout).json).run_id ?? null;
  } catch {
    return null;
  }
};
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));

const attempts = [];
let collided = null;
for (let i = 1; i <= MAX_ATTEMPTS && !collided; i++) {
  const f = await fx.makeFixture({ topic: A });
  // 第二个主题的计划原稿（与夹具给 A 写的同形）
  const stageB = path.join(f.archiveRoot, B, 'plan');
  await fs.mkdir(stageB, { recursive: true });
  await fs.writeFile(path.join(stageB, `${fx.today()}-${B}-claude.md`), '# 待审计划\n\n## 一、目标\n\n验证编排器行为。\n', 'utf8');

  // 等到一秒的开头再同时发两条，尽量落在同一秒
  const ms = Date.now() % 1000;
  await new Promise((r) => setTimeout(r, (1000 - ms) % 1000 + 20));
  const startArgs = (t) => ['review', '--start', '--stage', 'plan', '--topic', t, '--focus', 'x', '--json'];
  const [ra, rb] = await Promise.all([fx.cli(f.root, startArgs(A), STUB), fx.cli(f.root, startArgs(B), STUB)]);
  const idA = runIdOf(ra);
  const idB = runIdOf(rb);
  const rec = { attempt: i, codeA: ra.code, codeB: rb.code, idA, idB };
  attempts.push(rec);
  if (!idA || !idB) {
    rec.stderrA = ra.stderr.slice(0, 600);
    rec.stderrB = rb.stderr.slice(0, 600);
    continue;
  }
  if (idA !== idB) continue;

  // 同一 run_id：看运行目录
  const bucket = (await fs.readdir(f.runRoot))[0];
  const runDir = path.join(f.runRoot, bucket, idA);
  const listing = await fs.readdir(runDir);
  const request = await readJson(path.join(runDir, 'request.json')).catch((e) => ({ error: String(e) }));
  const statusNow = await readJson(path.join(runDir, 'status.json')).catch((e) => ({ error: String(e) }));
  // 两边各等到终态（桩很快），看各自 --wait 的结论
  const waitArgs = ['review', '--wait', idA, '--timeout', '30'];
  const wa = await fx.cli(f.root, waitArgs, STUB, 90_000);
  const statusAfter = await readJson(path.join(runDir, 'status.json')).catch((e) => ({ error: String(e) }));
  const metaA = await readJson(path.join(f.archiveRoot, A, 'plan', '_meta', `run-${idA}.json`)).catch((e) => ({ error: String(e) }));
  const metaB = await readJson(path.join(f.archiveRoot, B, 'plan', '_meta', `run-${idB}.json`)).catch((e) => ({ error: String(e) }));
  collided = {
    run_id: idA,
    run_dir_shared: true,
    run_dir_listing: listing,
    request_topic: request.topic ?? request,
    status_topic_before_wait: statusNow.topic ?? statusNow,
    wait_code: wa.code,
    wait_tail: (wa.stdout + wa.stderr).slice(-800),
    status_after: { topic: statusAfter.topic, phase: statusAfter.phase, message: (statusAfter.message ?? '').slice(0, 300) },
    archive_A: { status: metaA.status, critics: metaA.critics ? Object.keys(metaA.critics) : metaA },
    archive_B: { status: metaB.status, critics: metaB.critics ? Object.keys(metaB.critics) : metaB },
  };
}
console.log(JSON.stringify({ attempts, collided }, null, 2));
