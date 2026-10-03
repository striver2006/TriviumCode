#!/usr/bin/env node
/**
 * 「收工闸门文案区分只读失守」（EV-98 文案部分）改前 / 改后对照（计划 r2 §3.4，零配额）。
 *
 * 旧构建：`git archive 364ef0f` 解到 mkdtemp，`node_modules` 软链本仓工作树（不联网、不 npm ci），在归档里
 * `node scripts/build.mjs --with-tests`；新构建：本仓工作树（先 `node scripts/build.mjs --with-tests`）。
 * 前置：旧树与工作树的 package.json 依赖区逐字相同、package-lock.json 字节相同，不同即停。
 *
 * 两份构建各用自己的测试夹具助手（`dist/test/test/helpers/fixture.js`，各绑自己的 bundle 与资产根），
 * 同一桩配置跑同步 `review --stage plan --entry A`，再以 Hook 身份经各自的 bundle 调 `gate hook-stop` / `gate hook-pre-commit`：
 *
 * - **失守格**：gemini 桩 `write_breach`、glm 桩 `ok`，写齐裁决件 ⇒ 两份构建 `gate --check` 都退非零、失败只有 `readonly_breach`，
 *   该条 message 归一化后逐字相同（抽常量不改 gate 输出的端到端佐证）；旧构建两个 Hook 说「未逐条裁决」、
 *   新构建说「只读失守」并列出调用记录与作废出口；退出码两份相同。
 * - **未裁决格**：两侧桩都 `ok`、不写裁决件 ⇒ 两个 Hook 的 stdout / stderr / 退出码归一化后逐字相同。
 *
 * 归一化覆盖：夹具根、构建树根（即资产根）、run_id、长十六进制、时间戳。主题名两份相同，不需要替换。
 * 用法（在仓库根）：node acceptance.mjs [输出 JSON 路径]
 * 清理：本脚本先 mkdtemp 一个父目录并把 TMPDIR 指过去，夹具与运行根都落在它下面；收尾只删这个 mkdtemp 返回值。
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BASE = '364ef0f';
const ROOT = process.cwd();
const OUT = process.argv[2] ?? null;
const TOPIC = '失守文案对照';
const SESSION = 'S-对照';
const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');
const PARENT = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ev98acc-')));
process.env.TMPDIR = PARENT;

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? '✔' : '✖'} ${name}${detail && !ok ? ` —— ${detail}` : ''}`);
};

async function loadBuild(tree) {
  const m = (rel) => import(pathToFileURL(path.join(tree, 'dist/test', rel)).href);
  return { tree, fixture: await m('test/helpers/fixture.js'), exec: await m('src/trivium/util/exec.js') };
}

const norm = (t, root, tree) => String(t ?? '')
  .split(root).join('〈ROOT〉')
  .split(tree).join('〈TREE〉')
  .replace(/\d{8}T\d{6}Z/g, '〈RUN〉')
  .replace(/\b[0-9a-f]{12,64}\b/g, '〈HEX〉')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/g, '〈TS〉');

/** 以 Hook 身份经该构建的 bundle 调用，从 stdin 喂事件 JSON（与 gate-loop.test.ts 的 hook() 同式） */
async function hook(b, root, name, input) {
  return b.exec.run(process.execPath, [b.fixture.BUNDLE, 'gate', name], {
    cwd: root,
    env: { TRIVIUM_ASSET_ROOT: b.fixture.ASSET_ROOT, CLAUDE_SESSION_ID: SESSION, TRIVIUM_STUB_CRITIC: undefined },
    stdin: JSON.stringify(input),
    timeoutMs: 30_000,
  });
}

const stopEvent = { session_id: SESSION, hook_event_name: 'Stop' };
const commitEvent = { session_id: SESSION, tool_name: 'Bash', tool_input: { command: 'git commit -m x' } };

async function scenario(b, stub, withDisposition) {
  const fx = await b.fixture.makeFixture({ topic: TOPIC });
  const r = await b.fixture.cli(
    fx.root,
    ['review', '--stage', 'plan', '--topic', TOPIC, '--focus', 'x', '--entry', 'A', '--session-id', SESSION],
    stub,
  );
  if (r.code !== 0) throw new Error(`review 退 ${r.code}\n${r.stdout}\n${r.stderr}`);
  const metaDir = path.join(fx.stageDir, '_meta');
  const runFile = (await fs.readdir(metaDir)).find((f) => /^run-.+\.json$/.test(f));
  const runMeta = JSON.parse(await fs.readFile(path.join(metaDir, runFile), 'utf8'));
  let check = null;
  if (withDisposition) {
    const today = b.fixture.today();
    await fs.writeFile(
      path.join(fx.stageDir, `${today}-${TOPIC}-revised-claude.md`),
      [
        '---', 'schema: trivium.disposition.v1', `topic: ${TOPIC}`, 'stage: plan',
        'role: claude', 'kind: revised', `run_id: ${runMeta.run_id}`,
        'addresses:', `  - ${today}-${TOPIC}-gemini.md`, `  - ${today}-${TOPIC}-glm.md`,
        '---', '',
        '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改落点 |',
        '| :--- | :--- | :--- | :--- | :--- | :--- |',
        '| AGY-01 | gemini | blocker | 接受 | 确实漏了这一处，需要补 | §1 |',
        '| GLM-01 | glm | blocker | 接受 | 同一处问题，一并补上 | §1 |',
        '',
      ].join('\n'),
      'utf8',
    );
    const g = await b.fixture.cli(fx.root, ['gate', '--stage', 'plan', '--topic', TOPIC, '--check', '--json', '--session-id', SESSION]);
    const json = JSON.parse(g.stdout.slice(g.stdout.indexOf('{')));
    check = {
      code: g.code,
      codes: json.failures.map((x) => x.code),
      breachMsg: norm(json.failures.find((x) => x.code === 'readonly_breach')?.message, fx.root, b.tree),
    };
  }
  const stop = await hook(b, fx.root, 'hook-stop', stopEvent);
  const commit = await hook(b, fx.root, 'hook-pre-commit', commitEvent);
  const n = (t) => norm(t, fx.root, b.tree);
  return {
    breach: runMeta.guard.readonly_breach,
    check,
    stop: { code: stop.code, stdout: n(stop.stdout), stderr: n(stop.stderr) },
    commit: { code: commit.code, stdout: n(commit.stdout), stderr: n(commit.stderr) },
  };
}

const reasonOf = (s) => {
  try { return JSON.parse(s.stdout.trim().split('\n')[0]).reason ?? ''; } catch { return ''; }
};

async function main() {
  // ── 前置：依赖一致、旧树、两份 bundle ──
  const pkgOld = JSON.parse(execFileSync('git', ['show', `${BASE}:package.json`], { cwd: ROOT, encoding: 'utf8' }));
  const pkgNew = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const depsSame = JSON.stringify([pkgOld.dependencies, pkgOld.devDependencies]) === JSON.stringify([pkgNew.dependencies, pkgNew.devDependencies]);
  let lockSame = true;
  try { execFileSync('git', ['diff', '--quiet', BASE, '--', 'package-lock.json'], { cwd: ROOT }); } catch { lockSame = false; }
  check('前置：旧树与工作树的依赖区逐字相同、package-lock.json 字节相同', depsSame && lockSame);
  if (!(depsSame && lockSame)) throw new Error('依赖变了，对照会掺入依赖变量，停下');

  const old = await fs.mkdtemp(path.join(PARENT, 'old-'));
  execFileSync('sh', ['-c', `git archive ${BASE} | tar -x -C "${old}"`], { cwd: ROOT });
  await fs.symlink(path.join(ROOT, 'node_modules'), path.join(old, 'node_modules'));
  execFileSync(process.execPath, ['scripts/build.mjs', '--with-tests'], { cwd: old, stdio: 'ignore' });
  const builds = { old: await loadBuild(old), new: await loadBuild(ROOT) };
  const shaOld = await sha(builds.old.fixture.BUNDLE);
  const shaNew = await sha(builds.new.fixture.BUNDLE);
  check('两份 bundle 的 sha256 不同', shaOld !== shaNew, `${shaOld} / ${shaNew}`);
  check('两份构建的夹具助手各绑自己的 bundle', builds.old.fixture.BUNDLE.startsWith(old) && builds.new.fixture.BUNDLE.startsWith(ROOT));

  // ── 失守格 ──
  const breachStub = { gemini: { mode: 'write_breach' }, glm: { mode: 'ok' } };
  const bo = await scenario(builds.old, breachStub, true);
  const bn = await scenario(builds.new, breachStub, true);
  check('失守格：两份构建的留痕都记 readonly_breach: true', bo.breach === true && bn.breach === true);
  check('失守格：两份构建 gate --check 都退非零、失败只有 readonly_breach',
    bo.check.code !== 0 && bn.check.code !== 0 && JSON.stringify(bo.check.codes) === '["readonly_breach"]' && JSON.stringify(bn.check.codes) === '["readonly_breach"]',
    JSON.stringify([bo.check, bn.check]));
  check('失守格：readonly_breach 的 message 归一化后改前改后逐字相同（抽常量不改 gate 输出）',
    bo.check.breachMsg !== '' && bo.check.breachMsg === bn.check.breachMsg, `${bo.check.breachMsg}\n----\n${bn.check.breachMsg}`);
  check('失守格：两个 Hook 的退出码改前改后相同（都拦）',
    bo.stop.code === 2 && bn.stop.code === 2 && bo.commit.code === 2 && bn.commit.code === 2,
    JSON.stringify([bo.stop.code, bn.stop.code, bo.commit.code, bn.commit.code]));
  const ro = reasonOf(bo.stop);
  const rn = reasonOf(bn.stop);
  check('失守格·旧构建：收工 Hook 说「未逐条裁决」、不提失守', ro.includes('还有未逐条裁决的审查意见') && !ro.includes('只读失守'), ro);
  check('失守格·新构建：收工 Hook 说「只读失守」、列调用记录与作废出口、不再说未裁决',
    rn.startsWith(`本轮审查记录到只读失守：${TOPIC}/plan。`) && rn.includes('write_to_file(') &&
      rn.includes(`/dual-abandon --topic ${TOPIC} --stage plan`) && !rn.includes('未逐条裁决'), rn);
  check('失守格·旧构建：提交 Hook 说「尚未逐条裁决」', bo.commit.stderr.includes('尚未逐条裁决') && !bo.commit.stderr.includes('只读失守'), bo.commit.stderr);
  check('失守格·新构建：提交 Hook 说「只读失守」、不再说尚未逐条裁决',
    bn.commit.stderr.startsWith(`以下阶段的审查记录到只读失守，提交被拦下：${TOPIC}/plan`) && !bn.commit.stderr.includes('尚未逐条裁决'), bn.commit.stderr);

  // ── 未裁决格 ──
  const okStub = { gemini: { mode: 'ok' }, glm: { mode: 'ok' } };
  const no = await scenario(builds.old, okStub, false);
  const nn = await scenario(builds.new, okStub, false);
  check('未裁决格：两份构建的留痕都记 readonly_breach: false', no.breach === false && nn.breach === false);
  check('未裁决格：收工 Hook 的退出码、stdout、stderr 归一化后改前改后逐字相同',
    JSON.stringify(no.stop) === JSON.stringify(nn.stop), JSON.stringify([no.stop, nn.stop]));
  check('未裁决格：提交 Hook 的退出码、stdout、stderr 归一化后改前改后逐字相同',
    JSON.stringify(no.commit) === JSON.stringify(nn.commit), JSON.stringify([no.commit, nn.commit]));
  check('未裁决格：确实是拦截态（不是两边都放行而相同）', no.stop.code === 2 && no.commit.code === 2);

  const readout = {
    base: BASE, sha256: { old: shaOld, new: shaNew },
    samples: {
      breach: { old: { stopReason: ro, commitStderr: bo.commit.stderr }, new: { stopReason: rn, commitStderr: bn.commit.stderr } },
      pending: { stop: nn.stop, commit: nn.commit },
    },
    passed: checks.filter((c) => c.ok).length, total: checks.length, checks,
  };
  if (OUT) await fs.writeFile(OUT, JSON.stringify(readout, null, 2) + '\n');
  console.log(`${readout.passed}/${readout.total}`);
  if (readout.passed !== readout.total) process.exitCode = 1;
}

try {
  await main();
} finally {
  await fs.rm(PARENT, { recursive: true, force: true });
}
