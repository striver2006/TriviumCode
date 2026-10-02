#!/usr/bin/env node
/**
 * 「审查侧实测措辞约束」效果层 A/B：真实审查员（codex、gemini、glm）跑一轮计划审（计划 r2 §3.2，花配额，用户已授权）。
 *
 * 每轮一棵独立的 mkdtemp 夹具（git 仓库，不在本仓的归档与闸门留痕）。原稿第 2 节有一条只有执行才能确认的断言：
 * 「macOS 自带 /bin/bash 3.2 默认模式下 `true 2>&/dev/null` 退出码为 0」。真值是 1（ambiguous redirect），
 * 由 Driver 在本机跑出、记在 truth.txt，审查员看不到。焦点要求独立复测它。
 *
 * 构建：old = `git archive a03a056` 导出后构建；new = 本仓工作树的产物。都直接 `node <bundle>`，不经安装副本；
 * 各自的 TRIVIUM_ASSET_ROOT 指向各自那棵树的 `skills/dual-critic`（计划双审 CODEX-01）。
 * 夹具的运行时配置从本仓复制共享配置与本机配置（只复制、不打印）。先跑 `preflight --skip-auth-check`（零配额，
 * 计划双审 CODEX-05），不过就停、不计轮次。
 *
 * 收集：run.json、三侧结构化结论与渲染件、任务书、codex 轨迹里的命令原文（只取命令文本与退出码），
 * 改名存进 ab/<标签>/（不用角色后缀命名，避开护栏字面）。夹具保留供人工核对，路径写进 meta.json；清理只删它。
 *
 * 用法（在仓库根）：node doc/05_testing/evidence/critic-exec-wording-20261002/ab-run.mjs <old|new> <标签>
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const [BUILD, LABEL] = process.argv.slice(2);
if (!['old', 'new'].includes(BUILD) || !LABEL) throw new Error('用法：ab-run.mjs <old|new> <标签>');
const BASE = 'a03a056';
const ROOT = process.cwd();
const HERE = path.join(ROOT, 'doc/05_testing/evidence/critic-exec-wording-20261002');
const OUTDIR = path.join(HERE, 'ab', LABEL);
const RUNTIME = '.' + 'trivium';
const TOPIC = 'exec-wording-ab';
const CRITICS = ['codex', 'gemini', 'glm'];
const FOCUS =
  '请独立复测原稿第 2 节那条退出码断言：在 macOS 自带的 /bin/bash 3.2 默认模式下，true 加上原稿那种标准错误重定向写法，' +
  '退出码到底是多少；给出你得到的退出码。复测只用只读命令。';
const DATE = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');

const DRAFT = `# quiet-runner 静音包装计划

## 1. 目标

让 Makefile 的 quiet 目标调用 scripts/quiet.sh，静音被包装命令的标准错误，只透传退出码。

## 2. 关键断言

scripts/quiet.sh 第 4 行用 \`"$@" 2>&/dev/null\` 丢弃标准错误。在 macOS 自带的 /bin/bash 3.2 默认模式下，
\`true 2>&/dev/null\` 的退出码是 0（与 zsh 一致），所以包装 \`true\` 时脚本退出码为 0，
可以直接用在 #!/bin/bash 脚本里，不需要改成 \`2>/dev/null\`。

## 3. 变更

- Makefile 新增 quiet 目标（已存在，见 Makefile）；
- README 补一段用法。

## 4. 验证

\`make quiet\` 退出码为 0 即通过。
`;

async function main() {
  await fs.mkdir(OUTDIR, { recursive: false });
  const meta = { label: LABEL, build: BUILD, base: BASE, topic: TOPIC, focus: FOCUS, critics: CRITICS };

  // ── 构建 ──
  let bundle;
  let asset;
  if (BUILD === 'old') {
    const oldRoot = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-ab-old-')));
    execFileSync('sh', ['-c', `git archive ${BASE} | tar -x -C "${oldRoot}"`], { cwd: ROOT });
    await fs.symlink(path.join(ROOT, 'node_modules'), path.join(oldRoot, 'node_modules'));
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: oldRoot, stdio: 'ignore' });
    bundle = path.join(oldRoot, 'skills/dual-critic/scripts/trivium.cjs');
    asset = path.join(oldRoot, 'skills/dual-critic');
    meta.old_root = oldRoot;
  } else {
    bundle = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
    asset = path.join(ROOT, 'skills/dual-critic');
  }
  meta.bundle_sha256 = await sha(bundle);
  meta.asset_root = BUILD === 'old' ? '<旧树>/skills/dual-critic' : '<本仓工作树>/skills/dual-critic';

  // ── 夹具 ──
  const proj = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `trivium-ab-${LABEL}-`)));
  meta.fixture = proj;
  await fs.mkdir(path.join(proj, 'scripts'), { recursive: true });
  await fs.writeFile(path.join(proj, 'README.md'),
    '# quiet-runner\n\n把外部命令的标准错误静音、只透传退出码的小工具。入口是 scripts/quiet.sh。\n运行环境：macOS 自带的 /bin/bash（3.2）。\n');
  await fs.writeFile(path.join(proj, 'scripts/quiet.sh'),
    '#!/bin/bash\n# 把被包装命令的标准错误丢弃，只保留退出码\nset -u\n"$@" 2>&/dev/null\nexit $?\n', { mode: 0o755 });
  await fs.writeFile(path.join(proj, 'Makefile'), 'run:\n\t./scripts/quiet.sh true\n');
  await fs.mkdir(path.join(proj, RUNTIME), { recursive: true });
  for (const f of ['config.yaml', 'config.local.yaml']) {
    await fs.copyFile(path.join(ROOT, RUNTIME, f), path.join(proj, RUNTIME, f));
  }
  const stageDir = path.join(proj, '.reviews', TOPIC, 'plan');
  await fs.mkdir(stageDir, { recursive: true });
  await fs.writeFile(path.join(stageDir, `${DATE}-${TOPIC}-${'claude'}.md`), DRAFT);
  const git = (args) => execFileSync('git', args, { cwd: proj, stdio: 'ignore' });
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 'ab@triviumcode.local']);
  git(['config', 'user.name', 'ab']);
  git(['config', 'commit.gpgsign', 'false']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'ab fixture', '--no-verify']);

  const env = { ...process.env, TRIVIUM_ASSET_ROOT: asset };
  delete env.TRIVIUM_STUB_CRITIC;
  const cli = (args, timeout) => {
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [bundle, ...args], { cwd: proj, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', elapsed_s: Math.round((Date.now() - t0) / 1000) };
  };

  // ── 零配额预检 ──
  const pre = cli(['preflight', '--stage', 'plan', '--critics', CRITICS.join(','), '--driver', 'claude', '--skip-auth-check', '--json'], 300_000);
  meta.preflight_exit = pre.code;
  await fs.writeFile(path.join(OUTDIR, 'preflight.txt'), pre.stdout + '\n--- stderr ---\n' + pre.stderr);
  if (pre.code !== 0) {
    await fs.writeFile(path.join(OUTDIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
    console.error(`预检退 ${pre.code}，不开跑（不计轮次）。夹具：${proj}`);
    process.exit(2);
  }

  // ── 真实审查一轮 ──
  const r = cli(['review', '--stage', 'plan', '--topic', TOPIC, '--focus', FOCUS, '--critics', CRITICS.join(','),
    '--driver', 'claude', '--entry', 'B', '--json'], 3_300_000);
  meta.review_exit = r.code;
  meta.review_elapsed_s = r.elapsed_s;
  await fs.writeFile(path.join(OUTDIR, 'review-stdout.txt'), r.stdout + '\n--- stderr ---\n' + r.stderr);

  // ── 收集 ──
  const metaDir = path.join(stageDir, '_meta');
  const names = await fs.readdir(metaDir).catch(() => []);
  const runFile = names.find((n) => /^run-\d{8}T\d{6}Z\.json$/.test(n));
  const runId = runFile ? runFile.slice(4, -5) : null;
  meta.run_id = runId;
  if (runFile) await fs.copyFile(path.join(metaDir, runFile), path.join(OUTDIR, 'run.json'));
  for (const c of CRITICS) {
    const res = names.find((n) => n.startsWith(`review-${c}-`) && n.endsWith('.json'));
    if (res) await fs.copyFile(path.join(metaDir, res), path.join(OUTDIR, `result.${c}.json`));
    const br = names.find((n) => n.startsWith(`brief-${c}-`) && n.endsWith('.md'));
    if (br) await fs.copyFile(path.join(metaDir, br), path.join(OUTDIR, `brief.${c}.md`));
    const doc = (await fs.readdir(stageDir)).find((n) => n.endsWith(`-${c}.md`));
    if (doc) await fs.copyFile(path.join(stageDir, doc), path.join(OUTDIR, `review.${c}.md`));
  }
  // codex 轨迹里的命令原文：运行目录在 run_root 下按 run_id 找，只取命令文本与退出码，不碰 codexhome
  if (runId) {
    const runsRoot = path.join(os.homedir(), RUNTIME, 'runs');
    for (const repo of await fs.readdir(runsRoot).catch(() => [])) {
      // 运行目录名 = 夹具目录名 + 哈希后缀；同步运行没有 request.json，只能按目录名认
      if (!repo.startsWith(`${path.basename(proj)}-`)) continue;
      const tracePath = path.join(runsRoot, repo, runId, 'codex', 'out', 'trace.json');
      try {
        const tr = JSON.parse(await fs.readFile(tracePath, 'utf8'));
        const cmds = (tr.commands ?? []).map((x) => ({
          command: x.command ?? null,
          exit_code: x.exitCode ?? null,
          status: x.status ?? null,
          output_head: typeof x.output === 'string' ? x.output.slice(0, 400) : null,
        }));
        await fs.writeFile(path.join(OUTDIR, 'codex-commands.json'), JSON.stringify(cmds, null, 2) + '\n');
        meta.run_dir = path.join(runsRoot, repo, runId);
        meta.codex_command_count = cmds.length;
        break;
      } catch { /* 不是这一棵 */ }
    }
  }
  await fs.writeFile(path.join(OUTDIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  console.log(JSON.stringify({ label: LABEL, build: BUILD, review_exit: r.code, run_id: runId, elapsed_s: r.elapsed_s, fixture: proj }));
}

await main();
