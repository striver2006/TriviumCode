// EV-221 复现装置（单份）：照搬 EV-218 I2 的场景——同一仓库两个主题对齐到一秒开头并发 review --start，
// 等两轮到终态，读归档 run.json 的 status 与运行目录 status.json 的 message。
// 只用测试构建的 helper（夹具建在 scratchDir 登记的 mkdtemp 里，进程退出时由 helper 自己删）；零配额（桩审查员）。
// 输出一行 JSON；退出码：0 两轮都 success，1 有一轮 failed，2 其它异常。
import path from 'node:path';
import { promises as fs } from 'node:fs';

const REPO = '/Users/chenzhenbo/Work/TriviumCode';
const T = (p) => path.join(REPO, 'dist/test', p);
const { cli, makeFixture, today } = await import(T('test/helpers/fixture.js'));
const { repoId } = await import(T('src/trivium/review.js'));
const { extractJsonCandidate } = await import(T('src/trivium/parse.js'));
const { EXIT } = await import(T('src/trivium/exit-codes.js'));

const A = 'EV221甲';
const B = 'EV221乙';
const STUB = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };
const startArgs = (topic) => ['review', '--start', '--stage', 'plan', '--topic', topic, '--focus', 'x', '--json'];
const runIdOf = (stdout) => JSON.parse(extractJsonCandidate(stdout).json).run_id;

async function waitTerminal(root, runId) {
  let code = EXIT.STILL_RUNNING;
  for (let i = 0; i < 12 && code === EXIT.STILL_RUNNING; i++) {
    const w = await cli(root, ['review', '--wait', runId, '--timeout', '20'], STUB, 60_000);
    code = w.code;
  }
  return code;
}

const out = { ok: false };
try {
  const fx = await makeFixture({ topic: A });
  const d = path.join(fx.archiveRoot, B, 'plan');
  await fs.mkdir(d, { recursive: true });
  await fs.writeFile(path.join(d, `${today()}-${B}-claude.md`), '# 待审计划\n\n## 一、目标\n\n验证编排器行为。\n', 'utf8');
  const ms = Date.now() % 1000;
  await new Promise((res) => setTimeout(res, ((1000 - ms) % 1000) + 20));
  const [ra, rb] = await Promise.all([cli(fx.root, startArgs(A), STUB), cli(fx.root, startArgs(B), STUB)]);
  out.start = [ra.code, rb.code];
  if (ra.code !== 0 || rb.code !== 0) throw new Error(`--start 未退 0：${ra.stderr}${rb.stderr}`);
  const ids = [runIdOf(ra.stdout), runIdOf(rb.stdout)];
  out.ids = ids;
  out.wait = [];
  for (const id of ids) out.wait.push(await waitTerminal(fx.root, id));
  const bucket = path.join(fx.runRoot, repoId(fx.root));
  out.status = [];
  out.message = [];
  for (const [id, topic] of [[ids[0], A], [ids[1], B]]) {
    const meta = JSON.parse(await fs.readFile(path.join(fx.archiveRoot, topic, 'plan', '_meta', `run-${id}.json`), 'utf8'));
    out.status.push(meta.status);
    let msg = null;
    try {
      msg = JSON.parse(await fs.readFile(path.join(bucket, id, 'status.json'), 'utf8')).message ?? null;
    } catch (e) {
      msg = `status.json 读不出：${e.code ?? e.message}`;
    }
    out.message.push(msg);
  }
  out.ok = out.status.every((s) => s === 'success');
  out.unableToStat = out.message.some((m) => typeof m === 'string' && m.includes('unable to stat'));
  console.log(JSON.stringify(out));
  process.exitCode = out.ok ? 0 : out.status.every((s) => s === 'success' || s === 'failed') ? 1 : 2;
} catch (e) {
  out.error = String(e?.stack ?? e);
  console.log(JSON.stringify(out));
  process.exitCode = 2;
}
