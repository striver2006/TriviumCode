#!/usr/bin/env node
/**
 * EV-125 契约源（`skills-src/commands/run.contract.md`）的变异验证。
 *
 * ## 为什么不走 `scripts/mutation-check.mjs`
 *
 * 装置的闸 4 比对的是 `dist/test/<源>.js` 这份被测产物；契约源是 Markdown、不进构建，
 * 没有对应产物可比（与 EV-123 的 P7、M10b 第 2 步的先例同一处境）。契约测试在运行时从
 * `skills-src/` 现场渲染（`renderEntries(REPO_ROOT)`），所以改源、直接跑已编译的契约套件即可。
 *
 * ## 判据：点名的用例必须红，不是「有东西红」
 *
 * 改任何契约源，`entry-render-parity` 的「盘上产物 = 源」都会红——那不说明本条断言咬住了。
 * 所以每条变异记下**期望变红的用例名片段**，只有它们出现在 `✖` 行里才判咬住；
 * 其余顺带变红的用例原样列出，供读数核对。
 *
 * ## 闸（照 `mutation-check.mjs` 的同名闸）
 *
 * - **哨兵**（闸 3 前半，代码双审 CODEX-03）：开跑时在本目录独占创建 `.contract-mutations-running`，善终才删；
 *   它已存在 ⇒ 上次没善终、源文件可能还带着变异 ⇒ 拒跑。本脚本原地改写的是四家 28 份入口资产的唯一源，
 *   残留变异被当成下一轮的基线读入、收尾再写回去，随后一次 `npm run render` 就传进全部产物；
 * - **写盘前**断言每条 find 在基线里恰好命中一处（闸 7 前移）：有一条不满足就整体拒跑，
 *   脏基线（残留的变异版缺了某条 find）也在这一步被拦下——第一版是记一行就 `continue`、其余照跑；
 * - 变异后断言文件哈希确实变了（闸 4 的源文件版）；
 * - 每条跑完恢复并与基线逐字节比对（闸 5）；
 * - 开跑前基线套件全绿（闸 3 后半）。
 *
 * 用法：node doc/05_testing/evidence/ev125-mutation-20260925/contract-mutations.mjs
 * 输出：同目录 `contract-mutations-output.txt`（会话里的命令不带重定向，输出由脚本自己写）。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const FILE = path.join(ROOT, 'skills-src/commands/run.contract.md');
const SUITES = [
  'dist/test/test/contract/skill-flag-parity.test.js',
  'dist/test/test/contract/entry-render-parity.test.js',
];

/** 逐段断言的用例名片段（代码双审后由「S2 与 S6 的交接都点名……」扩为三段） */
const HANDOFF = '的交接各自点名入选、档位、模型覆盖';

const CASES = [
  {
    id: 'C1',
    desc: '删掉 S2 交接里的 --critics 那一条',
    find: '- `--critics` 传 S0.5 的 `critics`（逗号连接），**无条件传**；`allow_single` 为 true 时加 `--allow-single`；\n  **不要传 `--only`**（理由见 S0.5）：两个旗标同时递给 `--start` 会被判互斥退 64；\n',
    replace: '',
    expect: [HANDOFF],
  },
  {
    id: 'C2',
    desc: 'S6 的透传清单去掉 --critics / --allow-single',
    find: '`--profile` / `--critics` / `--allow-single` / 模型覆盖的透传',
    replace: '`--profile` / 模型覆盖的透传',
    expect: [HANDOFF],
  },
  {
    id: 'C3',
    desc: 'S2 交接只传 --critics、不提 --allow-single',
    find: '**无条件传**；`allow_single` 为 true 时加 `--allow-single`；\n  **不要传',
    replace: '**无条件传**；\n  **不要传',
    expect: [HANDOFF],
  },
  {
    id: 'C7',
    desc: '删掉 S0.6 交接里「profile / models 怎么传」那一条（代码双审 CODEX-01）',
    find: '- `profile` 非空时传 `--profile`；`models` 非空时逐个传对应的 `--model-<审核者 id>`；\n',
    replace: '',
    expect: [HANDOFF],
  },
  {
    id: 'C8',
    desc: 'S6 的透传清单去掉 --profile（代码双审 AGY-01 的原形）',
    find: '`--context` / `--profile` / `--critics`',
    replace: '`--context` / `--critics`',
    expect: [HANDOFF],
  },
  {
    id: 'C9',
    desc: '删掉 S2 交接里的 --profile 那一条（代码双审 AGY-01 的原形）',
    find: '- `--profile` 传 S0.5 的 `profile`，为空则不传；`models` 非空时逐个传对应的 `--model-<审核者 id>`；\n',
    replace: '',
    expect: [HANDOFF],
  },
  {
    id: 'C4',
    desc: '预检不带 --critics（回到只查缺省集合）',
    find: 'TV preflight --stage all --driver {{DRIVER}} --critics <critics> [--profile',
    replace: 'TV preflight --stage all --driver {{DRIVER}} [--profile',
    expect: ['命令 A 先解析、后预检'],
  },
  {
    id: 'C5',
    desc: '预检挪回解析之前（在状态机开头放一条预检命令）',
    find: '## 状态机 S0.5～S10（设计 §8.2）\n',
    replace: '## 状态机 S0.5～S10（设计 §8.2）\n\n`TV preflight --stage all --driver {{DRIVER}} --json`\n',
    expect: ['命令 A 先解析、后预检'],
  },
  {
    id: 'C6',
    desc: '删掉 S0.5 字段清单里的 critics 条（整篇不再有「resolve 输出的 `critics`」）',
    find: '- `critics`：本轮**入选的审核者集合，计划审与代码审两轮共用这一组**。S0.6、S2、S6 都把 resolve 输出的 `critics`\n  用逗号连接后传给 `--critics`，**无条件传**——用户没写 `--critics` 时它就是缺省集合（已减去当轮 Driver），照传即可；\n',
    replace: '',
    expect: ['dual-run：正文要交代把 resolve 输出的 critics 透传下去'],
  },
  {
    id: 'C10',
    desc: '删掉 S0.5 之后的 notes 转述约定（代码双审 CODEX-07）',
    find: '`notes` 非空时，把每一条原样念给用户',
    replace: 'resolve 的其余输出按需参考',
    expect: ['交代 resolve 输出的 notes 要逐条念给用户'],
  },
];

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

async function runSuites() {
  let out = '';
  try {
    const r = await run('node', ['--test', ...SUITES], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    out = r.stdout;
  } catch (e) {
    out = (e.stdout ?? '') + (e.stderr ?? '');
  }
  const m = /^ℹ fail (\d+)$/m.exec(out);
  if (!m) throw new Error(`读不出测试结果：\n${out.slice(-600)}`);
  // 只取顶层失败行（node --test 的 spec 报告里失败用例以 ✖ 开头）
  const failed = [...new Set(out.split('\n').filter((l) => /^\s*✖ /.test(l)).map((l) => l.replace(/^\s*✖ /, '').replace(/ \([\d.]+ms\)$/, '').trim()))]
    // node --test 在末尾汇总段落前打一行「✖ failing tests:」，它是标题不是用例
    .filter((n) => n !== 'failing tests:');
  return { fail: Number(m[1]), failed };
}

const lines = [];
const log = (s) => { lines.push(s); console.log(s); };

const OUT = path.join(HERE, 'contract-mutations-output.txt');
const SENTINEL = path.join(HERE, '.contract-mutations-running');
const refuse = async (msg) => {
  log(msg);
  await fs.writeFile(OUT, lines.join('\n') + '\n', 'utf8');
  process.exit(1);
};

log(`# EV-125 契约源变异 · ${new Date().toISOString()}`);

// ── 哨兵：独占创建，已存在即拒跑（任何读写源文件之前）──
try {
  await fs.writeFile(SENTINEL, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' });
} catch {
  await refuse(
    `✖ 哨兵 ${path.relative(ROOT, SENTINEL)} 已存在：上次运行没有善终，源文件可能还带着变异——拒跑。\n` +
      '  先 `git diff skills-src/commands/run.contract.md` 核对源文件，确认无误后手工删掉哨兵再跑。',
  );
}

const base = await fs.readFile(FILE);
const baseSha = sha(base);
const baseText = base.toString('utf8');
log(`目标：skills-src/commands/run.contract.md（基线 sha256 ${baseSha.slice(0, 12)}）`);
log(`套件：${SUITES.join('、')}`);

// ── 写盘前：每条 find 恰好命中一处，否则整体拒跑（脏基线会缺某条 find）──
const badFinds = CASES.map((c) => [c.id, baseText.split(c.find).length - 1]).filter(([, n]) => n !== 1);
if (badFinds.length > 0) {
  await fs.unlink(SENTINEL); // 没碰过源文件，哨兵可以撤
  await refuse(`✖ find 命中数不为 1：${badFinds.map(([id, n]) => `${id}=${n}`).join('、')}——基线可能不干净或规格写错了，拒跑`);
}

const baseline = await runSuites();
if (baseline.fail !== 0) {
  await fs.unlink(SENTINEL);
  await refuse(`✖ 基线不绿（fail=${baseline.fail}）：${baseline.failed.join(' | ')}——拒跑`);
}
log('基线：fail=0；全部 find 恰好命中一处\n');

let allBit = true;
try {
  for (const c of CASES) {
    const mutated = baseText.replace(c.find, c.replace);
    await fs.writeFile(FILE, mutated, 'utf8');
    if (sha(await fs.readFile(FILE)) === baseSha) {
      log(`${c.id} ✖ 变异后哈希未变——${c.desc}`);
      allBit = false;
    } else {
      const r = await runSuites();
      const bit = c.expect.every((e) => r.failed.some((f) => f.includes(e)));
      if (!bit) allBit = false;
      log(`${c.id} ${bit ? '✓ 咬住' : '✖ 没咬住'}（fail=${r.fail}）——${c.desc}`);
      log(`   期望红：${c.expect.join('；')}`);
      log(`   实际红：${r.failed.join(' | ') || '（无）'}`);
    }
    await fs.writeFile(FILE, base);
    if (sha(await fs.readFile(FILE)) !== baseSha) throw new Error(`${c.id} 恢复后与基线不一致——停止`);
  }
} finally {
  await fs.writeFile(FILE, base);
}
const after = sha(await fs.readFile(FILE));
log(`\n收尾：恢复件与基线${after === baseSha ? '逐字节一致' : '**不一致**'}；结论 ${allBit ? `${CASES.length} / ${CASES.length} 咬住` : '有未咬住项'}`);
// 善终（恢复件与基线一致）才撤哨兵；不一致时留着它，让下一次运行拒跑
if (after === baseSha) await fs.unlink(SENTINEL);
else log(`哨兵 ${path.relative(ROOT, SENTINEL)} 保留：源文件与基线不一致，请先核对`);
await fs.writeFile(OUT, lines.join('\n') + '\n', 'utf8');
process.exit(allBit && after === baseSha ? 0 : 1);
