// 在本仓**当前** HEAD 的编译产物上跑 M9 第 6 步第 2 轮验收 claude 侧
// CLAUDE-01 / CLAUDE-02 的那组判据。
// 用法：node verify-claude-findings-on-head.mjs   （先 node scripts/build.mjs --tests-only）
//
// **本脚本的输出随 HEAD 变化，不是固定的「复现」件**（代码双审 CODEX-01）：
//   · 缺陷还在时跑 ⇒ 复现形状，见 verify-claude-findings-on-head.BEFORE-a75ec43.out.txt
//   · 缺陷修掉后跑 ⇒ 结案形状，见 verify-claude-findings-on-head.out.txt
// 两份分文件存放；**复跑只会覆盖后者**，修前那份是历史留痕不要动。
// 输出头部会自动落当前 HEAD，避免再出现「同名文件被无声覆盖、看不出是哪一轮」。
//
// EV-79 结案时扩写：原版七条 case **全在写面**、零 `extractPathTokens` 调用，
// 而「读面污染」正是选「改共用正则」而非「只补写面」的唯一理由——
// 复跑只证写面等于半边没有归档证据。本版补上读面两格与各拼写族。
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
// 仓库根由 git 推导，不写死绝对路径（代码双审 CODEX-05）
const REPO_ROOT = execSync('git rev-parse --show-toplevel', { encoding: 'utf8' }).trim();
const m = await import(pathToFileURL(`${REPO_ROOT}/dist/test/src/trivium/adapters/base.js`).href);
const root = '/tmp/fake-project-root';

/*
 * 前言由脚本自己产出（代码双审 CODEX-05）。
 * 此前是我手写在 .out.txt 前 9 行的——而那份文件的抬头自己写着「本件会被复跑覆盖」，
 * 下一个照做的人会把说明连同教训一起冲掉。
 *
 * 戳里带**工作树指纹**：本轮被审代码在未提交的工作树上，只落 HEAD 会让
 * 「不含修复的 HEAD」与「标着它的结案证据」共用同一个短哈希，看不出差别。
 */
const head = execSync('git rev-parse --short HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
const dirty = execSync('git status --porcelain -uall', { cwd: REPO_ROOT, encoding: 'utf8' }).trim().length > 0;

console.log(`# ═══ EV-79 结案证据（修后观测）═══`);
console.log(`#`);
console.log(`# 基线 HEAD=${head}${dirty ? ' + 未提交改动（工作树脏）' : ''} ｜ 生成于 ${new Date().toISOString()}`);
console.log(`# 先 \`node scripts/build.mjs --tests-only\` 重编测试树，否则跑的是旧产物（EV-82 教训）。`);
console.log(`#`);
console.log(`# 读这份要看的是**两条缺陷修掉后**的样子，与同目录`);
console.log(`# verify-claude-findings-on-head.BEFORE-a75ec43.out.txt（修前）逐条对照。`);
console.log(`# 本件会被复跑覆盖；修前那份是历史留痕，不要覆盖它。`);
console.log(`#`);

// ── 写面：缺口一（递归 + 强制）与缺口二（重定向运算符族） ──
const cases = [
  ['CLAUDE-01 对照：短旗标', 'rm -rf src/existing-dir'],
  ['CLAUDE-01 主张：长旗标 + 递归', 'rm -r --force src/existing-dir'],
  ['CLAUDE-01 对照：无 -f 的递归删除', 'rm -r src/existing-dir'],
  ['CLAUDE-01 对照：无 -r 的 -f（仍应判幂等）', 'rm -f src/gone.ts'],
  ['CLAUDE-02 主张：仅 &> 作写入手段', 'echo secret &> src/leak.txt'],
  ['CLAUDE-02 主张：仅 &>> 作写入手段', 'echo secret &>> src/leak.txt'],
  ['CLAUDE-02 对照：普通 >', 'echo x > src/a.ts'],
  ['CLAUDE-02 对照：现有用例形态', 'echo x > src/a.ts &> /dev/null'],
  // EV-79 扩：论域在 r1～r5 里扩了四次，每次都由实测驱动
  ['EV-79 后置 &：紧贴', 'echo secret >&src/leak.txt'],
  ['EV-79 后置 &：分离', 'echo secret >& src/leak.txt'],
  ['EV-79 fd 前缀 + 非数字目标', 'echo secret 2>& src/leak.txt'],
  ['EV-79 双流追加', 'echo secret >>& src/leak.txt'],
  ['EV-79 强制覆盖 × 文件目标', 'echo secret >&| src/leak.txt'],
  ['EV-79 强制覆盖 × 数字目标（r5 漏检面）', 'echo x >&| 2'],
  ['EV-79 普通覆盖后缀', 'echo P >| src/p1.txt'],
  ['EV-79 数字目标是文件名（r4 漏检面）', 'echo x > 2'],
  ['EV-79 等值防线', 'echo Y >&2foo'],
  ['EV-79 fd 复制：紧贴（应一档都不进）', 'echo x >&2'],
  ['EV-79 fd 复制：分离（应一档都不进）', 'echo x >& 2'],
  ['EV-79 fd 目标不得顶替写动词目标', 'cp src/a.ts /tmp/out.ts >& 2'],
];

console.log('═══ 写面 ═══\n');
for (const [label, cmd] of cases) {
  const r = m.classifyWriteCommands([cmd], root);
  console.log(
    `${label}\n  $ ${cmd}\n  writes=${JSON.stringify(r.writes)} suspected=${JSON.stringify(r.suspected.map((s) => s.why))}`,
  );
}

// ── 读面：重定向目标不得以读取身份进路径面 ──
//
// 危害出口是 checkEvidence 的 projectReads 与 judgeSide 的 consulted 交叉核对
// （措施 a 只吃真实读取事实、不吃回填）。目标进了读面 = 审查员能借一条
// 从未读过的路径坐实虚假的 consulted 声明，即「证据自证」。
const readCases = [
  ['负：&> 分离目标不算读取', 'echo secret &> src/leak.txt', 'src/leak.txt'],
  ['负：&> 紧贴整串不算读取', 'echo secret &>src/leak.txt', '&>src/leak.txt'],
  ['负：&> 紧贴剥出目标也不算读取', 'echo secret &>src/leak.txt', 'src/leak.txt'],
  ['负：>& 分离目标不算读取', 'echo secret >& src/leak.txt', 'src/leak.txt'],
  ['负：2>& 分离目标不算读取', 'echo secret 2>& src/leak.txt', 'src/leak.txt'],
  ['负：>>& 分离目标不算读取', 'echo secret >>& src/leak.txt', 'src/leak.txt'],
  // 强制覆盖族——本轮修复主题恰是给读面补它的锁，证据件要跟上（GLM-03）
  ['负：>&! 分离目标不算读取', 'echo secret >&! src/leak.txt', 'src/leak.txt'],
  ['负：>&| 分离目标不算读取', 'echo secret >&| src/leak.txt', 'src/leak.txt'],
  ['正：普通读命令仍算读取', 'cat src/a.ts', 'src/a.ts'],
  ['正：读+重定向混合，只留被读的那个', 'grep foo src/a.ts &> /dev/null', 'src/a.ts'],
];

console.log('\n═══ 读面（extractPathTokens） ═══\n');
for (const [label, cmd, probe] of readCases) {
  const reads = m.extractPathTokens(cmd);
  const hit = reads.includes(probe);
  console.log(`${label}\n  $ ${cmd}\n  reads=${JSON.stringify(reads)}  含 ${probe}? ${hit}`);
}
