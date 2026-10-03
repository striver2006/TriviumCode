#!/usr/bin/env node
/**
 * 「收工闸门文案区分只读失守」安装副本复核（报告 §4「真实会话自证」的兑现，零配额）。
 *
 * 用户重装之后跑：同一夹具里先用仓库构建跑桩审查，再以 Hook 身份分别经**仓库 bundle** 与**安装副本 bundle**
 * （`~/.claude/skills/dual-critic/scripts/trivium.cjs`，资产根取安装侧）调 `gate hook-stop` / `gate hook-pre-commit`：
 *
 * - 失守格（gemini 桩 write_breach、齐裁决件）：安装副本两个 Hook 都说「只读失守」、列调用记录与作废出口、不说未裁决；
 * - 未裁决格（两侧 ok、不写裁决件）：安装副本两个 Hook 都说未裁决（原文案）；
 * - 两格里安装副本与仓库 bundle 的退出码、stdout、stderr 逐字相同（同一夹具、同一时刻，不需要归一化）。
 *
 * 用法（在仓库根，先 node scripts/build.mjs --with-tests）：node acceptance-installed.mjs [输出 JSON 路径]
 * 清理：mkdtemp 一个父目录并把 TMPDIR 指过去，收尾只删这个 mkdtemp 返回值。
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = process.cwd();
const OUT = process.argv[2] ?? null;
const TOPIC = '失守文案安装复核';
const SESSION = 'S-安装复核';
const INST_ROOT = path.join(os.homedir(), '.claude/skills/dual-critic');
const INST_BUNDLE = path.join(INST_ROOT, 'scripts/trivium.cjs');
const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');
const PARENT = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev98inst-')));
process.env.TMPDIR = PARENT;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail && !ok ? ` —— ${detail}` : ''}`);
};
const m = (rel) => import(pathToFileURL(path.join(ROOT, 'dist/test', rel)).href);
const fixture = await m('test/helpers/fixture.js');
const exec = await m('src/trivium/util/exec.js');

async function hook(bundle, assetRoot, root, name, input) {
  return exec.run(process.execPath, [bundle, 'gate', name], {
    cwd: root,
    env: { TRIVIUM_ASSET_ROOT: assetRoot, CLAUDE_SESSION_ID: SESSION, TRIVIUM_STUB_CRITIC: undefined },
    stdin: JSON.stringify(input),
    timeoutMs: 30_000,
  });
}
const stopEvent = { session_id: SESSION, hook_event_name: 'Stop' };
const commitEvent = { session_id: SESSION, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } };
const pick = (r) => ({ code: r.code, stdout: r.stdout, stderr: r.stderr });

async function scenario(stub, withDisposition) {
  const fx = await fixture.makeFixture({ topic: TOPIC });
  const r = await fixture.cli(fx.root, ['review', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--entry', 'A', '--session-id', SESSION], stub);
  if (r.code !== 0) throw new Error(`review 退 ${r.code}\n${r.stdout}\n${r.stderr}`);
  if (withDisposition) {
    const metaDir = path.join(fx.stageDir, '_meta');
    const runFile = (await fs.readdir(metaDir)).find((f) => /^run-.+\.json$/.test(f));
    const runId = JSON.parse(await fs.readFile(path.join(metaDir, runFile), 'utf8')).run_id;
    const today = fixture.today();
    await fs.writeFile(path.join(fx.stageDir, `${today}-${TOPIC}-revised-claude.md`), [
      '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan', 'role: claude', 'kind: revised', `run_id: ${runId}`,
      'addresses:', `  - ${today}-${TOPIC}-gemini.md`, `  - ${today}-${TOPIC}-glm.md`, '---', '',
      '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |', '| :--- | :--- | :--- | :--- | :--- | :--- |',
      '| AGY-01 | gemini | blocker | 接受 | 确实漏了这一处，需要补 | §1 |', '| GLM-01 | glm | blocker | 接受 | 同一处问题，一并补上 | §1 |', '',
    ].join('\n'), 'utf8');
  }
  const out = {};
  for (const [side, bundle, asset] of [['inst', INST_BUNDLE, INST_ROOT], ['repo', fixture.BUNDLE, fixture.ASSET_ROOT]]) {
    out[side] = {
      stop: pick(await hook(bundle, asset, fx.root, 'hook-stop', stopEvent)),
      commit: pick(await hook(bundle, asset, fx.root, 'hook-pre-commit', commitEvent)),
    };
  }
  return out;
}
const reasonOf = (s) => { try { return JSON.parse(s.stdout.trim().split('\n')[0]).reason ?? ''; } catch { return ''; } };

async function main() {
  const shaInst = await sha(INST_BUNDLE);
  const shaRepo = await sha(fixture.BUNDLE);
  /*
   * 跑本脚本前要 build.mjs --with-tests 才有测试助手，这一步会重写仓库 bundle 的 built_at（构建时刻）。
   * 所以比「去掉 built_at 之后逐字相同」：git_head、dirty、inputs_sha256 与全部代码都在比对面内。
   */
  const stripBuiltAt = async (p) => (await fs.readFile(p, 'utf8')).replace(/built_at: "[^"]*"/, 'built_at: "〈T〉"');
  const sameBody = (await stripBuiltAt(INST_BUNDLE)) === (await stripBuiltAt(fixture.BUNDLE));
  check('安装副本 bundle 与仓库 bundle 除构建时刻 built_at 外逐字相同', sameBody, `${shaInst} / ${shaRepo}`);

  const b = await scenario({ gemini: { mode: 'write_breach' }, glm: { mode: 'ok' } }, true);
  const rs = reasonOf(b.inst.stop);
  check('失守格·安装副本：两个 Hook 都拦（退 2）', b.inst.stop.code === 2 && b.inst.commit.code === 2);
  check('失守格·安装副本：收工 Hook 说只读失守、列调用记录与作废出口、不说未裁决',
    rs.startsWith(`本轮审查记录到只读失守：${TOPIC}/plan。`) && rs.includes('write_to_file(') &&
      rs.includes(`/dual-abandon --topic ${TOPIC} --stage plan`) && rs.includes('都须先作废这一轮') && !rs.includes('未逐条裁决'), rs);
  check('失守格·安装副本：提交 Hook 说只读失守、不说尚未逐条裁决',
    b.inst.commit.stderr.startsWith(`以下阶段的审查记录到只读失守，提交被拦下：${TOPIC}/plan`) && !b.inst.commit.stderr.includes('尚未逐条裁决'), b.inst.commit.stderr);
  check('失守格：安装副本与仓库 bundle 输出逐字相同', JSON.stringify(b.inst) === JSON.stringify(b.repo));

  const p = await scenario({ gemini: { mode: 'ok' }, glm: { mode: 'ok' } }, false);
  check('未裁决格·安装副本：两个 Hook 都拦且说未裁决（原文案）',
    p.inst.stop.code === 2 && reasonOf(p.inst.stop).startsWith(`还有未逐条裁决的审查意见：${TOPIC}/plan。`) &&
      p.inst.commit.code === 2 && p.inst.commit.stderr.startsWith(`以下阶段的审查意见尚未逐条裁决，提交被拦下：${TOPIC}/plan`));
  check('未裁决格：安装副本与仓库 bundle 输出逐字相同', JSON.stringify(p.inst) === JSON.stringify(p.repo));

  const readout = { sha256: { installed: shaInst, repo: shaRepo }, passed: checks.filter((c) => c.ok).length, total: checks.length, checks };
  if (OUT) await fs.writeFile(OUT, JSON.stringify(readout, null, 2) + '\n');
  console.log(`${readout.passed}/${readout.total}`);
  if (readout.passed !== readout.total) process.exitCode = 1;
}

try { await main(); } finally { await fs.rm(PARENT, { recursive: true, force: true }); }
