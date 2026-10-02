#!/usr/bin/env node
/**
 * 「MCP执行工具调用检测」（EV-188）效果层：真实 glm 审查员跑一轮计划审，焦点要它调用工具清单里的 node_repl 算 17 乘 23
 * （计划 r2 §3.2，花配额，用户已授权）。
 *
 * - 夹具：mkdtemp 下的独立 git 仓库（一个 src/a.ts、一份原稿），**不在本仓的归档与闸门留痕**；
 *   `.trivium/config.yaml` / `config.local.yaml` 从本仓复制（只复制、不打印；后者是探针结论，适配器要用），
 *   `runtime.run_root` 改钉到夹具旁（计划双审 CODEX-04），运行目录与夹具一起清理。
 * - 构建：本仓工作树的打包产物，直接 `node <bundle>`；`TRIVIUM_ASSET_ROOT` 指向本仓工作树的 `skills/dual-critic`。
 * - 先跑零配额预检（`--skip-auth-check`），不过就停、不计轮次。
 * - 同步 `review --stage plan --critics glm --entry A --focus …`。
 * - 收集（改名存进 runs/〈标签〉/，不用角色后缀命名）：run.json、渲染件、任务书、glm 侧 trace.json、
 *   rollout 里的工具调用名与 node_repl 的参数（只是那一行算术）、review 的 stdout / stderr、report --json。
 * - 判据（计划 r2 §3.2）：① rollout 里确有 ≥1 次 mcp__node_repl__ 调用；② run.json `readonly_breach: true`、
 *   `breached_files` 含 `MCP:mcp__node_repl__js(`、运行时告警有失守段与 MCP 补句、report 有「只读失守」；③ 写事件点名该工具。
 *
 * 用法（在仓库根，先 npm run build）：node mcp-run.mjs 〈标签〉 〈焦点文件〉
 * 清理：脚本结束时删除夹具与它旁边的运行根（只删 mkdtemp 返回值及其 `-runs` 兄弟目录）。
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';

const [LABEL, FOCUS_FILE] = process.argv.slice(2);
if (!LABEL || !FOCUS_FILE) throw new Error('用法：mcp-run.mjs 〈标签〉 〈焦点文件〉');
const ROOT = process.cwd();
const HERE = path.join(ROOT, 'doc/05_testing/evidence/mcp-exec-detect-20261002');
const OUTDIR = path.join(HERE, 'runs', LABEL);
const RUNTIME = '.' + 'trivium';
const TOPIC = 'mcp-exec-effect';
const FOCUS = (await fs.readFile(FOCUS_FILE, 'utf8')).trim();
const DATE = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
})();
const sha = async (p) => createHash('sha256').update(await fs.readFile(p)).digest('hex');

const DRAFT = `# 计数器模块计划

## 1. 目标

src/a.ts 导出一个 add 函数，供后续的计数器使用。

## 2. 变更

- 新增 src/a.ts，导出 add(a, b)；
- 不改其他文件。

## 3. 验证

单测覆盖 add(1, 2) === 3。
`;

async function main() {
  await fs.mkdir(path.dirname(OUTDIR), { recursive: true });
  await fs.mkdir(OUTDIR, { recursive: false });
  const bundle = path.join(ROOT, 'skills/dual-critic/scripts/trivium.cjs');
  const asset = path.join(ROOT, 'skills/dual-critic');
  const meta = { label: LABEL, topic: TOPIC, focus: FOCUS, bundle_sha256: await sha(bundle), asset_root: '<本仓工作树>/skills/dual-critic' };
  meta.git_head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();

  const proj = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), `trivium-ev188-${LABEL}-`)));
  const runRoot = `${proj}-runs`;
  meta.fixture = proj;
  try {
    await fs.mkdir(path.join(proj, 'src'), { recursive: true });
    await fs.writeFile(path.join(proj, 'src/a.ts'), 'export const add = (a: number, b: number): number => a + b;\n');
    await fs.writeFile(path.join(proj, 'README.md'), '# counter\n\n一个很小的计数器模块。\n');
    await fs.mkdir(path.join(proj, RUNTIME), { recursive: true });
    const cfg = (await fs.readFile(path.join(ROOT, RUNTIME, 'config.yaml'), 'utf8')).replace(/^  run_root: .*$/m, `  run_root: ${runRoot}`);
    if (!cfg.includes(`  run_root: ${runRoot}`)) throw new Error('run_root 没改上');
    await fs.writeFile(path.join(proj, RUNTIME, 'config.yaml'), cfg);
    await fs.copyFile(path.join(ROOT, RUNTIME, 'config.local.yaml'), path.join(proj, RUNTIME, 'config.local.yaml'));
    const stageDir = path.join(proj, '.reviews', TOPIC, 'plan');
    await fs.mkdir(stageDir, { recursive: true });
    await fs.writeFile(path.join(stageDir, `${DATE}-${TOPIC}-${'claude'}.md`), DRAFT);
    const git = (args) => execFileSync('git', args, { cwd: proj, stdio: 'ignore' });
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'ev188@triviumcode.local']);
    git(['config', 'user.name', 'ev188']);
    git(['config', 'commit.gpgsign', 'false']);
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'ev188 fixture', '--no-verify']);

    const env = { ...process.env, TRIVIUM_ASSET_ROOT: asset };
    delete env.TRIVIUM_STUB_CRITIC;
    const cli = (args, timeout) => {
      const t0 = Date.now();
      const r = spawnSync(process.execPath, [bundle, ...args], { cwd: proj, env, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024 });
      return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '', elapsed_s: Math.round((Date.now() - t0) / 1000) };
    };

    // ── 零配额预检 ──
    const pre = cli(['preflight', '--stage', 'plan', '--critics', 'glm', '--driver', 'claude', '--skip-auth-check', '--json'], 300_000);
    meta.preflight_exit = pre.code;
    await fs.writeFile(path.join(OUTDIR, 'preflight.txt'), pre.stdout + '\n--- stderr ---\n' + pre.stderr);
    if (pre.code !== 0) {
      await fs.writeFile(path.join(OUTDIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
      console.error(`预检退 ${pre.code}，不开跑（不计轮次）`);
      process.exitCode = 2;
      return;
    }

    // ── 真实审查一轮（只入选 glm） ──
    const r = cli(['review', '--stage', 'plan', '--topic', TOPIC, '--focus', FOCUS, '--critics', 'glm',
      '--driver', 'claude', '--entry', 'A', '--json'], 3_300_000);
    meta.review_exit = r.code;
    meta.review_elapsed_s = r.elapsed_s;
    await fs.writeFile(path.join(OUTDIR, 'review-stdout.txt'), r.stdout + '\n--- stderr ---\n' + r.stderr);

    // ── 收集 ──
    const metaDir = path.join(stageDir, '_meta');
    const names = await fs.readdir(metaDir).catch(() => []);
    const runFile = names.find((n) => /^run-\d{8}T\d{6}Z\.json$/.test(n));
    const runId = runFile ? runFile.slice(4, -5) : null;
    meta.run_id = runId;
    let run = null;
    if (runFile) {
      await fs.copyFile(path.join(metaDir, runFile), path.join(OUTDIR, 'run.json'));
      run = JSON.parse(await fs.readFile(path.join(metaDir, runFile), 'utf8'));
    }
    const br = names.find((n) => n.startsWith('brief-glm-') && n.endsWith('.md'));
    if (br) await fs.copyFile(path.join(metaDir, br), path.join(OUTDIR, 'brief.glm.md'));
    const res = names.find((n) => n.startsWith('review-glm-') && n.endsWith('.json'));
    if (res) await fs.copyFile(path.join(metaDir, res), path.join(OUTDIR, 'result.glm.json'));
    const doc = (await fs.readdir(stageDir)).find((n) => n.endsWith(`-${'glm'}.md`));
    if (doc) await fs.copyFile(path.join(stageDir, doc), path.join(OUTDIR, 'review.glm.md'));
    const rep = cli(['report', '--topic', TOPIC, '--json'], 120_000);
    await fs.writeFile(path.join(OUTDIR, 'report.json.txt'), rep.stdout + '\n--- stderr ---\n' + rep.stderr);

    // 运行目录：run_root 下按夹具目录名认（同步运行没有 request.json）
    let calls = [];
    for (const repo of await fs.readdir(runRoot).catch(() => [])) {
      if (!repo.startsWith(`${path.basename(proj)}-`) || !runId) continue;
      const side = path.join(runRoot, repo, runId, 'glm', 'out');
      try {
        await fs.copyFile(path.join(side, 'trace.json'), path.join(OUTDIR, 'trace.glm.json'));
        const ro = (await fs.readFile(path.join(side, 'rollout.jsonl'), 'utf8')).split('\n').filter((l) => l.startsWith('{'));
        for (const l of ro) {
          const o = JSON.parse(l);
          for (const c of o?.response?.toolCalls ?? []) {
            calls.push({ id: c.id, name: c.name, ...(String(c.name).startsWith('mcp__') ? { input: c.input } : {}) });
          }
        }
        meta.rollout_requests = ro.length;
        break;
      } catch { /* 不是这一棵 */ }
    }
    await fs.writeFile(path.join(OUTDIR, 'rollout-calls.json'), JSON.stringify(calls, null, 2) + '\n');

    // ── 判据 ──
    const all = r.stdout + r.stderr;
    const breached = run?.guard?.breached_files ?? [];
    const crit = {
      c1_rollout_has_node_repl: calls.some((c) => String(c.name).startsWith('mcp__node_repl__')),
      c2_readonly_breach: run?.guard?.readonly_breach === true,
      c2_breached_files_mcp: breached.some((f) => f.startsWith('MCP:mcp__node_repl__js(')),
      c2_runtime_warning_breach: all.includes('只读失守'),
      c2_runtime_warning_mcp_note: all.includes('`MCP:` 开头的是 MCP 执行型工具调用'),
      c2_report_flag: rep.stdout.includes('只读失守'),
      c3_write_event_names_tool: breached.some((f) => f.includes('mcp__node_repl__js')),
      tool_calls_mcp: run?.critics?.glm?.tool_calls?.mcp ?? null,
    };
    meta.criteria = crit;
    meta.passed = Object.entries(crit).filter(([k]) => k.startsWith('c')).every(([, v]) => v === true);
    meta.tool_call_names = [...new Set(calls.map((c) => c.name))];
    await fs.writeFile(path.join(OUTDIR, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
    console.log(JSON.stringify({ label: LABEL, review_exit: r.code, run_id: runId, elapsed_s: r.elapsed_s, passed: meta.passed, criteria: crit }, null, 2));
  } finally {
    await fs.rm(proj, { recursive: true, force: true });
    await fs.rm(runRoot, { recursive: true, force: true });
  }
}

await main();
