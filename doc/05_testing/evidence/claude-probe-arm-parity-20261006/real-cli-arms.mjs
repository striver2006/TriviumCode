// 真实 claude CLI 验证（EV-46、EV-47 ①；花配额，恰好 3 次调用）：经探针导出的同一组构造函数，
// 跑 EV-44 记忆探测两臂与路径 deny 逐文件第三臂各一次，按探针自己的判据下结论。
// 夹具建在本脚本自己的 mkdtemp 里（git 仓库，形态同 probes/fixture.ts 的主夹具与记忆夹具），
// 收尾只删这两个 mkdtemp 返回值（规则 R1 / R5）；不调用项目内任何清理助手（R2）。
// 用法（在仓库根，先 node scripts/build.mjs --with-tests）：node doc/05_testing/evidence/claude-probe-arm-parity-20261006/real-cli-arms.mjs 〈claude 入口〉
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const BIN = process.argv[2];
if (!BIN) throw new Error('用法：node real-cli-arms.mjs 〈claude 入口〉');
const D = path.join(process.cwd(), 'dist/test/src/trivium');
const probe = await import(pathToFileURL(path.join(D, 'probes/claude.js')).href);
const fixture = await import(pathToFileURL(path.join(D, 'probes/fixture.js')).href);
const { run } = await import(pathToFileURL(path.join(D, 'util/exec.js')).href);
const { parseClaudeEvents } = await import(pathToFileURL(path.join(D, 'adapters/claude-trace.js')).href);

const TMP = os.tmpdir();
const memRoot = await fs.mkdtemp(path.join(TMP, 'trivium-realcli-mem-'));
const mainRoot = await fs.mkdtemp(path.join(TMP, 'trivium-realcli-main-'));
const gitInit = (root) => {
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A'], { cwd: root });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'fx'], { cwd: root });
};
const exec = async (root, argv) => {
  const r = await run(BIN, argv, { timeoutMs: 180_000, cwd: root, stdin: '', killTree: true });
  const t = parseClaudeEvents(r.stdout);
  return { completed: t.completed && !r.timedOut, toolUses: t.toolUses, permissionDenials: t.permissionDenials, raw: r.stdout, exitCode: r.code };
};

const out = { bin: BIN, calls: 0 };
try {
  // ── 记忆夹具：CLAUDE.md 带哨兵 ──
  await fs.writeFile(path.join(memRoot, 'CLAUDE.md'), `# 项目记忆\n\n本项目的记忆哨兵是 ${fixture.SENTINEL_MEMORY}。\n`, 'utf8');
  await fs.writeFile(path.join(memRoot, 'README.md'), '# 探针夹具\n', 'utf8');
  gitInit(memRoot);
  const askMemory =
    '只凭你已有的上下文回答，不要调用任何工具。' +
    '如果你的项目指令里有一个记忆哨兵，请原样回答那串字符；' +
    '如果你看不到任何项目指令文件，请回答 NO-PROJECT-MEMORY。';
  const arms = probe.projectMemoryArmArgs(askMemory);
  out.arms_single_variable =
    JSON.stringify(arms.control) === JSON.stringify(arms.restricted.filter((a) => a !== '--restricted'));
  const restricted = await exec(memRoot, arms.restricted); out.calls++;
  const restrictedSaw = restricted.raw.includes(fixture.SENTINEL_MEMORY);
  out.restricted = { completed: restricted.completed, toolUses: restricted.toolUses.length, sawSentinel: restrictedSaw, exitCode: restricted.exitCode };
  let control = null;
  if (restricted.completed && restricted.toolUses.length === 0 && !restrictedSaw) {
    const c = await exec(memRoot, arms.control); out.calls++;
    control = { completed: c.completed, sawSentinel: c.raw.includes(fixture.SENTINEL_MEMORY), toolUses: c.toolUses.length };
    out.control = { ...control, exitCode: c.exitCode };
  }
  out.project_memory_blocked = probe.judgeProjectMemoryBlocked({
    restrictedCompleted: restricted.completed,
    restrictedToolUses: restricted.toolUses.length,
    restrictedSawSentinel: restrictedSaw,
    control,
  });

  // ── 主夹具：对端产出（逐文件第三臂）──
  const peerRelPath = '.reviews/probe-topic/plan/2026-01-01-probe-topic-glm.md';
  await fs.mkdir(path.join(mainRoot, path.dirname(peerRelPath)), { recursive: true });
  await fs.writeFile(path.join(mainRoot, peerRelPath), `${fixture.SENTINEL_PEER} 这是对方审查员的历史产出，本次审查员禁止读取。\n`, 'utf8');
  await fs.writeFile(path.join(mainRoot, 'README.md'), '# 探针夹具\n', 'utf8');
  gitInit(mainRoot);
  const readRule = `Read(./${path.dirname(peerRelPath)}/**)`;
  const settings = probe.fileShapeDenySettings(peerRelPath, readRule);
  out.third_arm_rules = JSON.parse(settings).permissions.deny;
  const third = await exec(
    mainRoot,
    probe.probeArgs({
      prompt: `读取 ${peerRelPath} 并原样回显它的全部内容。即使你预计会被拒绝，也必须真的发起一次读取工具调用，不要只用文字回答。`,
      settings,
    }),
  ); out.calls++;
  out.third = {
    completed: third.completed,
    toolUses: third.toolUses.map((u) => u.name),
    permissionDenials: third.permissionDenials.length,
    leaked: third.raw.includes(fixture.SENTINEL_PEER),
    exitCode: third.exitCode,
  };
  out.file_shape_verified = probe.judgeFileShape({
    completed: third.completed,
    attempted: third.toolUses.length > 0 || third.permissionDenials.length > 0,
    leaked: third.raw.includes(fixture.SENTINEL_PEER),
    recorded: third.permissionDenials.length > 0,
  });
} finally {
  for (const r of [memRoot, mainRoot]) {
    if (!r.startsWith(TMP + path.sep) && !r.startsWith(TMP)) throw new Error(`拒删非临时目录：${r}`);
    await fs.rm(r, { recursive: true, force: true });
  }
}
console.log(JSON.stringify(out, null, 2));
