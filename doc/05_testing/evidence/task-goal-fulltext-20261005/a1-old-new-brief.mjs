// A1 · 旧构建逐字比对（任务目标全文送审计划 r2 §5，EV-210）。
//
// 把基线提交导出到 mkdtemp 目录、软链 node_modules、编出 dist/test，分别 import 新旧
// `dist/test/src/trivium/brief.js`，对同一组输入渲染任务书：附录为 null 时新旧必须逐字相同。
// 另比 buildMustReadList：新版第五个参数传 null 时与旧版四参数结果相同（对本仓库只读）。
//
// 用法：node doc/05_testing/evidence/task-goal-fulltext-20261005/a1-old-new-brief.mjs [基线，缺省 722a471]
// 前提：新构建已就绪（node scripts/build.mjs --with-tests）。
// 删除只认本脚本 mkdtemp 的返回值，且先断言它在系统临时目录下（never-run-scrub R1 / R5）。
import { spawnSync } from 'node:child_process';
import { promises as fs, realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const BASE = process.argv[2] ?? '722a471';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const NEW_BRIEF = path.join(REPO, 'dist/test/src/trivium/brief.js');
const NEW_CONFIG = path.join(REPO, 'dist/test/src/trivium/config.js');

const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 退 ${r.status}：\n${r.stderr}`);
  return r.stdout;
};

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-a1-'));
const TMP_ROOT = realpathSync(os.tmpdir());
let failed = 0;
try {
  if (!realpathSync(tmp).startsWith(TMP_ROOT + path.sep)) throw new Error(`临时目录不在系统临时目录下：${tmp}`);
  const oldTree = path.join(tmp, 'old');
  await fs.mkdir(oldTree);
  const tarball = path.join(tmp, 'old.tar');
  sh('git', ['-C', REPO, 'archive', '--format=tar', '-o', tarball, BASE]);
  sh('tar', ['-xf', tarball, '-C', oldTree]);
  await fs.symlink(path.join(REPO, 'node_modules'), path.join(oldTree, 'node_modules'));
  sh(process.execPath, ['scripts/build.mjs', '--with-tests'], { cwd: oldTree });

  const oldBrief = await import(pathToFileURL(path.join(oldTree, 'dist/test/src/trivium/brief.js')).href);
  const oldConfig = await import(pathToFileURL(path.join(oldTree, 'dist/test/src/trivium/config.js')).href);
  const newBrief = await import(pathToFileURL(NEW_BRIEF).href);
  const newConfig = await import(pathToFileURL(NEW_CONFIG).href);

  const snap = (stage) => ({
    gitHead: 'abcdef0123456789', treeHash: 'tree', dirty: false, subjectSha256: 'sha',
    subjectPath: `/proj/.reviews/T/${stage}/2026-10-05-T-claude.md`,
    denyPaths: ['.reviews/T/plan/2026-10-05-T-glm.md', '.reviews/T/plan/_meta/review-glm-R.json', '.trivium', '/runs', '.env'],
    diffText: null, takenAt: 'x',
  });
  const LONG_SUMMARY = `${'甲乙丙丁'.repeat(50)}…`;
  const cases = [
    { name: '计划阶段·短目标·gemini', stage: 'plan', critic: 'gemini', taskGoal: '把登录改造为 OIDC', commandExecution: 'none', mcp: [] },
    { name: '计划阶段·目标为空·codex', stage: 'plan', critic: 'codex', taskGoal: null, commandExecution: 'readonly-shell', mcp: [] },
    { name: '代码阶段·长目标摘要·glm（带执行型 MCP）', stage: 'code', critic: 'glm', taskGoal: LONG_SUMMARY, commandExecution: 'none', mcp: ['mcp__node_repl__'] },
    { name: 'bug 阶段·短目标·claude', stage: 'bug', critic: 'claude', taskGoal: '定位偶发 500', commandExecution: 'readonly-shell', mcp: [] },
  ];
  const lenses = { gemini: { plan: '看架构' }, glm: { code: '看边界' }, codex: { plan: '看实现' } };
  const results = [];
  for (const c of cases) {
    const base = (cfg) => ({
      cfg, critic: c.critic, stage: c.stage, topic: 'T', runId: '20261005T000000Z', projectRoot: '/proj', snapshot: snap(c.stage),
      promptHint: c.stage === 'plan' ? null : '重点看并发', subjectExcerpt: '# 计划\n正文\n',
      mustRead: ['CLAUDE.md', 'doc/02_design/x.md'], suggestedRead: ['src/a.ts'], ownHistory: ['.reviews/T/plan/2026-10-04-T-gemini.md'],
      schemaPath: '/s/review.v1.json', lenses, taskGoal: c.taskGoal, minToolCalls: 5, minProjectReads: 3,
      stagePrompt: '阶段要点', commandExecution: c.commandExecution, mcpExecPrefixes: c.mcp,
    });
    const before = oldBrief.renderBrief(base(oldConfig.defaultConfig()));
    const after = newBrief.renderBrief({ ...base(newConfig.defaultConfig()), taskGoalAppendix: null });
    const same = before === after;
    if (!same) failed++;
    results.push({ case: c.name, same, bytes: Buffer.byteLength(before) });
  }

  // buildMustReadList：对本仓库只读，新版第五个参数传 null
  for (const [topic, ctx] of [['任务目标全文送审', []], ['brief', ['src/trivium/brief.ts', 'CLAUDE.md']]]) {
    const before = await oldBrief.buildMustReadList(oldConfig.defaultConfig(), REPO, topic, ctx);
    const after = await newBrief.buildMustReadList(newConfig.defaultConfig(), REPO, topic, ctx, null);
    const same = JSON.stringify(before) === JSON.stringify(after);
    if (!same) failed++;
    results.push({ case: `buildMustReadList(${topic}, [${ctx.join(', ')}])`, same, entries: before.length });
  }

  console.log(JSON.stringify({ base: BASE, results, failed }, null, 2));
} finally {
  if (!realpathSync(tmp).startsWith(TMP_ROOT + path.sep)) throw new Error(`拒绝删除系统临时目录之外的路径：${tmp}`);
  await fs.rm(tmp, { recursive: true, force: true });
}
process.exit(failed === 0 ? 0 : 1);
