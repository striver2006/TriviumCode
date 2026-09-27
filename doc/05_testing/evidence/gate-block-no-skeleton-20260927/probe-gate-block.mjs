#!/usr/bin/env node
/**
 * 只读实测（不碰真实 HOME、不改本仓归档）：用仓库构建的 CLI + 桩审查员，在 mkdtemp 夹具里核对
 *   G1 plan 阶段：一轮成功、未裁决，直接再 --start ⇒ 被拦留下了什么（_meta 新文件、run.json、task.json、state.json、运行目录）；
 *      随后 gate --check / --check-artifacts / --await-approval 不带 --run-id 读到的是哪一轮；
 *      补上第 1 轮裁决件后 gate --check（不带 / 带 --run-id）；report 的时间线与未进时间线表；topic resolve 的当轮 Driver；
 *      abandon 后真跑一轮 ⇒ 新一轮的 rerun_index 与被拦骨架是否相同
 *   G2 code 阶段：一轮成功、未裁决，改工作树后再 --start ⇒ changes.diff 便利副本是否被被拦的那次覆盖
 *   G3 registerRun 写失败（主题目录只读 ⇒ task.json 写不进）⇒ 退出码、留下的 run.json 与 _meta、闸门槽位
 *   G4 同步路径 review --stage（runReviewLocked）被拦 ⇒ 是否同样留骨架
 * 收尾只删 mkdtemp 的返回值。
 *
 * 用法：node probe-gate-block.mjs <仓库根>
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pexec = promisify(execFile);
const ROOT = path.resolve(process.argv[2] ?? '.');
const CLI = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
const { encodeStubConfig, STUB_ENV_VAR } = await import(path.join(ROOT, 'dist/test/src/trivium/adapters/stub.js'));
const SESSION = 'S-probe';
const TD = '.' + 'trivium';

async function sh(cwd, bin, args, env = {}) {
  try {
    const o = await pexec(bin, args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 });
    return { code: 0, stdout: o.stdout, stderr: o.stderr };
  } catch (e) {
    return { code: typeof e.code === 'number' ? e.code : null, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}
const OK = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };
const envFor = (stub) => ({ TRIVIUM_ASSET_ROOT: path.join(ROOT, 'skills/dual-critic'), [STUB_ENV_VAR]: encodeStubConfig(stub), CLAUDE_SESSION_ID: SESSION });
const cli = (cwd, args, stub = OK) => sh(cwd, process.execPath, [CLI, ...args], envFor(stub));
const git = (cwd, args) => sh(cwd, 'git', ['-c', 'user.email=a@a', '-c', 'user.name=a', ...args]);
const readJson = async (p) => JSON.parse(await fs.readFile(p, 'utf8'));
const lines = (r, n = 4) => (r.stdout + r.stderr).split('\n').filter(Boolean).slice(0, n);
const jsonOf = (r) => { try { return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))); } catch { return null; } };
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const out = {};

async function fixture(base, topic) {
  const root = path.join(base, topic);
  await fs.mkdir(path.join(root, 'src'), { recursive: true });
  await fs.writeFile(path.join(root, 'src/a.ts'), 'export const a = 1;\n');
  await fs.mkdir(path.join(root, TD), { recursive: true });
  await fs.writeFile(path.join(root, TD, 'config.yaml'), [
    'runtime:', `  run_root: ${path.join(base, 'runs-' + topic)}`,
    'review:', '  default_critics: [gemini, glm]',
    '  timeout_s:', '    plan: 900', '    code: 900', '    bug: 900', '  wait_timeout_s: 30',
    'verify:', '  build: []', '  test: []', '',
  ].join('\n'));
  await git(root, ['init', '-q', '-b', 'main']);
  await git(root, ['add', '-A']);
  await git(root, ['commit', '-q', '-m', 'baseline', '--no-verify']);
  const topicDir = path.join(root, '.reviews', topic);
  const stageDir = path.join(topicDir, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, `${today()}-${topic}-` + 'claude.md'), '# 待审计划\n\n## 一、目标\n\n实测。\n');
  return { root, topicDir, stageDir, runRoot: path.join(base, 'runs-' + topic) };
}

async function start(root, topic, stage = 'plan', entry = 'B') {
  const r = await cli(root, ['review', '--start', '--entry', entry, '--stage', stage, '--topic', topic, '--focus', '实测', '--session-id', SESSION, '--json']);
  const js = r.code === 0 ? jsonOf(r) : null;
  return { r, runId: js?.run_id ?? null };
}
async function waitDone(root, runId) {
  let w;
  for (let i = 0; i < 10; i++) {
    w = await cli(root, ['review', '--wait', runId, '--timeout', '20']);
    if (w.code !== 73) break;
  }
  return w;
}
const ls = async (d) => (await fs.readdir(d).catch(() => [])).sort();
async function listRunDirs(runRoot) {
  const out = [];
  for (const repo of await ls(runRoot)) for (const id of await ls(path.join(runRoot, repo))) out.push(id);
  return out.sort();
}
async function gateOf(root, topic, stage) {
  const s = await readJson(path.join(root, TD, 'state.json')).catch(() => null);
  const g = s?.gates?.[`${topic}/${stage}`];
  return g ? { state: g.state, run_id: g.run_id, rerun_index: g.rerun_index } : null;
}
async function taskRuns(topicDir) {
  const t = await readJson(path.join(topicDir, 'task.json')).catch(() => null);
  return t?.runs?.map((r) => ({ run_id: r.run_id, stage: r.stage, r: r.rerun_index, status: r.status })) ?? null;
}
async function writeDisposition(stageDir, topic, runId) {
  await fs.writeFile(
    path.join(stageDir, `${today()}-${topic}-revised-` + 'claude.md'),
    [
      '---', 'schema: trivium.disposition.v1', `topic: ${topic}`, 'stage: plan',
      'role: claude', 'kind: revised', `run_id: ${runId}`,
      'addresses:', `  - ${today()}-${topic}-gemini.md`, `  - ${today()}-${topic}-glm.md`,
      '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
      '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 确实漏了这一处，需要补 | §1 |',
      '| GLM-01 | glm | blocker | 接受 | 同一处问题，一并补上 | §1 |',
      '',
    ].join('\n'),
    'utf8',
  );
}
async function report(root, topic) {
  const r = await cli(root, ['report', '--topic', topic, '--json']);
  const j = jsonOf(r);
  return {
    code: r.code,
    rounds: (j?.rounds ?? []).map((x) => ({ stage: x.stage, r: x.rerunIndex, runId: x.runId, status: x.status })),
    unlisted: (j?.unlistedRuns ?? []).map((x) => ({ r: x.rerunIndex, runId: x.runId, status: x.status, label: x.label })),
  };
}
const gateCheck = async (root, topic, extra = []) => {
  const r = await cli(root, ['gate', '--stage', 'plan', '--topic', topic, '--check', '--json', '--session-id', SESSION, ...extra]);
  const j = jsonOf(r);
  return { code: r.code, run_id: j?.run_id ?? null, rerun_index: j?.rerun_index ?? null, ok: j?.ok ?? null, failures: (j?.failures ?? []).map((f) => f.code ?? f).slice(0, 5), text: j ? undefined : lines(r, 3) };
};

const base = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-probe-gateblock-'));
try {
  // ── G1 ──
  {
    const topic = 'G1-闸门拦重跑';
    const fx = await fixture(base, topic);
    const s1 = await start(fx.root, topic);
    await waitDone(fx.root, s1.runId);
    const metaDir = path.join(fx.stageDir, '_meta');
    const before = { meta: await ls(metaDir), runDirs: await listRunDirs(fx.runRoot), gate: await gateOf(fx.root, topic, 'plan'), task: await taskRuns(fx.topicDir) };
    const s2 = await start(fx.root, topic);
    const afterMeta = await ls(metaDir);
    const extraMeta = afterMeta.filter((n) => !before.meta.includes(n));
    const skel = extraMeta.find((n) => /^run-/.test(n));
    const skelJson = skel ? await readJson(path.join(metaDir, skel)) : null;
    const runDirsAfter = await listRunDirs(fx.runRoot);
    out.G1_block = {
      r1: s1.runId,
      secondStartCode: s2.r.code,
      secondStartMsg: lines(s2.r, 2),
      extraMetaFiles: extraMeta,
      skeleton: skelJson && { run_id: skelJson.run_id, status: skelJson.status, rerun_index: skelJson.rerun_index, gate: skelJson.gate.state, artifacts: skelJson.artifacts.map((a) => path.basename(a.path)) },
      taskRunsBefore: before.task, taskRunsAfter: await taskRuns(fx.topicDir),
      gateBefore: before.gate, gateAfter: await gateOf(fx.root, topic, 'plan'),
      extraRunDirs: runDirsAfter.filter((d) => !before.runDirs.includes(d)),
    };
    // 被拦之后，不带 --run-id 的三条闸门命令读到哪一轮
    out.G1_gateCheckNoRunIdBeforeDisposition = await gateCheck(fx.root, topic);
    const ca = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', topic, '--check-artifacts']);
    out.G1_checkArtifacts = { code: ca.code, text: lines(ca, 2) };
    await writeDisposition(fx.stageDir, topic, s1.runId);
    out.G1_gateCheckNoRunIdAfterDisposition = await gateCheck(fx.root, topic);
    out.G1_gateAfterNoRunIdCheck = await gateOf(fx.root, topic, 'plan');
    const aw = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', topic, '--await-approval', '--session-id', SESSION]);
    out.G1_awaitNoRunId = { code: aw.code, text: lines(aw, 3) };
    out.G1_gateCheckWithRunId = await gateCheck(fx.root, topic, ['--run-id', s1.runId]);
    out.G1_gateAfterRunIdCheck = await gateOf(fx.root, topic, 'plan');
    out.G1_report = await report(fx.root, topic);
    const tr = await cli(fx.root, ['topic', 'resolve', '--stage', 'plan', '--json', '--', '实测', '--topic', topic]);
    out.G1_topicResolve = { code: tr.code, driver: jsonOf(tr)?.driver ?? null, text: jsonOf(tr) ? undefined : lines(tr, 2) };
    const st = await cli(fx.root, ['status', '--topic', topic, '--json']);
    const sj = jsonOf(st);
    out.G1_status = { code: st.code, keys: sj ? Object.keys(sj) : null, text: sj ? JSON.stringify(sj).slice(0, 600) : lines(st, 6) };
    // 放行之后真跑一轮：轮次号与被拦骨架是否相同
    const gnow = await gateOf(fx.root, topic, 'plan');
    if (gnow?.state !== 'approved' && gnow?.state !== 'idle') {
      await cli(fx.root, ['abandon', '--topic', topic, '--stage', 'plan', '--reason', '实测']);
    }
    const s3 = await start(fx.root, topic);
    if (s3.runId) await waitDone(fx.root, s3.runId);
    const m3 = s3.runId ? await readJson(path.join(metaDir, `run-${s3.runId}.json`)) : null;
    out.G1_realRerun = { startCode: s3.r.code, startMsg: s3.runId ? null : lines(s3.r, 2), rerun_index: m3?.rerun_index ?? null, status: m3?.status ?? null, docs: (await ls(fx.stageDir)).filter((n) => n.endsWith('.md')) };
    out.G1_reportAfterRerun = await report(fx.root, topic);
  }

  // ── G2 code 阶段便利副本 ──
  {
    const topic = 'G2-code便利副本';
    const fx = await fixture(base, topic);
    await git(fx.root, ['add', '-A']);
    await git(fx.root, ['commit', '-q', '-m', 'plan', '--no-verify']);
    await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 2;\n');
    const s1 = await start(fx.root, topic, 'code', 'C');
    if (s1.runId) await waitDone(fx.root, s1.runId);
    const codeMeta = path.join(fx.topicDir, 'code', '_meta');
    const aliasBefore = await fs.readFile(path.join(codeMeta, 'changes.diff'), 'utf8').catch(() => null);
    const metaBefore = await ls(codeMeta);
    await fs.writeFile(path.join(fx.root, 'src/a.ts'), 'export const a = 3;\n');
    const s2 = await start(fx.root, topic, 'code', 'C');
    const aliasAfter = await fs.readFile(path.join(codeMeta, 'changes.diff'), 'utf8').catch(() => null);
    out.G2 = {
      firstStartCode: s1.r.code, firstStartMsg: s1.runId ? null : lines(s1.r, 3),
      secondStartCode: s2.r.code,
      extraMetaFiles: (await ls(codeMeta)).filter((n) => !metaBefore.includes(n)),
      aliasHeadBefore: aliasBefore?.split('\n').find((l) => /^# run/.test(l)) ?? null,
      aliasHeadAfter: aliasAfter?.split('\n').find((l) => /^# run/.test(l)) ?? null,
      aliasOverwritten: aliasBefore !== null && aliasAfter !== aliasBefore,
    };
  }

  // ── G3 registerRun 写失败 ──
  {
    const topic = 'G3-登记写失败';
    const fx = await fixture(base, topic);
    await fs.chmod(fx.topicDir, 0o555); // 阶段目录 plan/ 仍可写；task.json 的原子写（同目录临时文件）写不进
    const s = await start(fx.root, topic);
    await fs.chmod(fx.topicDir, 0o755);
    const metaDir = path.join(fx.stageDir, '_meta');
    const metas = await ls(metaDir);
    const skel = metas.find((n) => /^run-/.test(n));
    const j = skel ? await readJson(path.join(metaDir, skel)) : null;
    out.G3 = {
      startCode: s.r.code, startMsg: lines(s.r, 3),
      metaFiles: metas,
      skeleton: j && { status: j.status, rerun_index: j.rerun_index },
      taskJson: await taskRuns(fx.topicDir),
      gate: await gateOf(fx.root, topic, 'plan'),
      lockFiles: await ls(path.join(fx.root, TD, 'lock')),
      report: await report(fx.root, topic),
    };
    // 登记失败之后再正常跑一轮：能否启动、轮次号
    const s2 = await start(fx.root, topic);
    if (s2.runId) await waitDone(fx.root, s2.runId);
    const m2 = s2.runId ? await readJson(path.join(metaDir, `run-${s2.runId}.json`)).catch(() => null) : null;
    out.G3_after = { startCode: s2.r.code, startMsg: s2.runId ? null : lines(s2.r, 3), rerun_index: m2?.rerun_index ?? null, status: m2?.status ?? null };
  }

  // ── G4 同步路径被拦：a 同一秒内再跑（run_id 撞车）；b 隔 1.2 s 再跑 ──
  for (const [tag, gapMs] of [['a', 0], ['b', 1200]]) {
    const topic = `G4${tag}-同步路径`;
    const fx = await fixture(base, topic);
    const r1 = await cli(fx.root, ['review', '--stage', 'plan', '--topic', topic, '--focus', '实测', '--entry', 'B', '--session-id', SESSION]);
    const metaDir = path.join(fx.stageDir, '_meta');
    const before = await ls(metaDir);
    const firstRun = before.find((n) => /^run-/.test(n));
    const firstJson = firstRun ? await readJson(path.join(metaDir, firstRun)) : null;
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs));
    const r2 = await cli(fx.root, ['review', '--stage', 'plan', '--topic', topic, '--focus', '实测', '--entry', 'B', '--session-id', SESSION]);
    const extra = (await ls(metaDir)).filter((n) => !before.includes(n));
    const skel = extra.find((n) => /^run-/.test(n));
    const j = skel ? await readJson(path.join(metaDir, skel)) : null;
    const firstAfter = firstRun ? await readJson(path.join(metaDir, firstRun)) : null;
    out[`G4${tag}`] = {
      firstCode: r1.code, secondCode: r2.code,
      blockedRunIdInMsg: /上一轮（run (\S+)，/.exec(r2.stdout + r2.stderr)?.[1] ?? null,
      firstRunFile: firstRun,
      firstRunBefore: firstJson && { status: firstJson.status, rerun_index: firstJson.rerun_index, artifacts: firstJson.artifacts.length },
      firstRunAfter: firstAfter && { status: firstAfter.status, rerun_index: firstAfter.rerun_index, artifacts: firstAfter.artifacts.length },
      extraMetaFiles: extra,
      skeleton: j && { status: j.status, rerun_index: j.rerun_index },
      gate: await gateOf(fx.root, topic, 'plan'),
      gateCheckNoRunId: await (async () => {
        const r = await cli(fx.root, ['gate', '--stage', 'plan', '--topic', topic, '--check', '--json', '--session-id', SESSION]);
        const jj = jsonOf(r);
        return { code: r.code, rerun_index: jj?.rerun_index ?? null, failures: (jj?.failures ?? []).map((f) => f.code ?? f).slice(0, 4) };
      })(),
    };
  }
} finally {
  await fs.chmod(base, 0o755).catch(() => {});
  await fs.rm(base, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 2));
