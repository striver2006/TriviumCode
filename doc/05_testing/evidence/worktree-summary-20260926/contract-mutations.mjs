#!/usr/bin/env node
/**
 * 「审批前工作树摘要」入口资产与协议片段的变异验证（计划 r2 §3.4 M12 与 D6 (b) 的非 `src/*.ts` 落点）。
 *
 * ## 为什么不走 `scripts/mutation-check.mjs`
 *
 * 装置的闸 4 比对 `dist/test/<源>.js` 这份被测产物；这些源是 Markdown / 片段，不进构建。
 * 契约测试在运行时从 `skills-src/` 现场渲染、从 `protocol/*.snippet` 现场读，改源后直接跑已编译套件即可。
 * 形态照「留痕与文案小修」的 `contract-mutations.mjs`（同名、同闸），只换 CASES。
 *
 * ## 判据：点名的用例必须红，不是「有东西红」
 *
 * 改任何契约源，「源 → 产物零 diff」都会红——那不说明本条断言咬住了。每条变异记下期望变红的用例名片段，
 * 只有它们出现在 `✖` 行里才判咬住；其余顺带变红的原样列出。
 *
 * ## 闸
 *
 * - 哨兵：开跑时独占创建 `.contract-mutations-running`，善终才删；已存在即拒跑（上次可能残留变异）；
 * - 写盘前断言每条 find 在其目标文件基线里恰好命中一处，有一条不满足就整体拒跑；
 * - 变异后断言目标文件哈希确实变了；
 * - 每条跑完恢复并与基线逐字节比对；
 * - 开跑前基线套件全绿。
 *
 * 用法：node doc/05_testing/evidence/worktree-summary-20260926/contract-mutations.mjs
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
const SUITES = [
  'dist/test/test/contract/entry-render-parity.test.js',
  'dist/test/test/unit/init.test.js',
];
const GATE_LINE = 'EV-132 ② 折中版：L2 闸门期那一条写';
const APPROVE = 'EV-132 ② 折中版：各载体的 dual-approve';
const SNIPPET = 'EV-132 ② 折中版：driver.snippet 的 L2 事后覆盖面同步改写';

const CASES = [
  {
    id: 'K1',
    desc: 'M12：l2-notice 闸门期那一条去掉「（命令 B / C / D 等待审批时）」限定（计划双审 CODEX-01 ≡ AGY-02 的原形）',
    file: 'skills-src/partials/guard/l2-notice.md',
    find: '- **闸门期**（命令 B / C / D 等待审批时）改业务文件：**不会让审批失败**',
    replace: '- **闸门期**改业务文件：**不会让审批失败**',
    expect: [GATE_LINE, 'EV-132：L2 护栏段的审批两格带命令限定'],
  },
  {
    id: 'K2',
    desc: 'D6：l2-notice 闸门期那一条改回「没有机制会发现」',
    file: 'skills-src/partials/guard/l2-notice.md',
    find: '改业务文件：**不会让审批失败**——审批前复核只核裁决齐备与本轮审查工件的 sha256，不看工作树；审批时 `approve` 会列出自审查收尾以来改过的文件（只告知，被 .gitignore 忽略的看不见，取不到时如实报原因），由审批人判断。',
    replace: '改业务文件：**没有机制会发现**——审批前复核只核裁决齐备与本轮审查工件的 sha256，不看工作树。',
    expect: [GATE_LINE],
  },
  {
    id: 'K6',
    desc: '代码双审 r1 GLM-02：l2-notice 的「会列出」去掉「取不到时如实报原因」（改回无条件承诺）',
    file: 'skills-src/partials/guard/l2-notice.md',
    find: '（只告知，被 .gitignore 忽略的看不见，取不到时如实报原因），由审批人判断。',
    replace: '（只告知，被 .gitignore 忽略的看不见），由审批人判断。',
    expect: [GATE_LINE],
  },
  {
    id: 'K3',
    desc: 'D6：l2-notice 闸门期那一条写成「不拦」（计划双审 GLM-02 的原形）',
    file: 'skills-src/partials/guard/l2-notice.md',
    find: '改业务文件：**不会让审批失败**——',
    replace: '改业务文件：**不拦、不会让审批失败**——',
    expect: [GATE_LINE],
  },
  {
    id: 'K4',
    desc: '计划双审 CODEX-06：dual-approve 删掉「摘要只告知、不改变审批结论」那一句',
    file: 'skills-src/commands/approve.contract.md',
    find: '把输出原样转述给用户。输出里的工作树改动摘要只告知，不改变审批结论；不得据此改文件、拒绝放行或代替用户判断。',
    replace: '把输出原样转述给用户。',
    expect: [APPROVE],
  },
  {
    id: 'K5',
    desc: 'D6：driver.snippet 改回旧句（旧版指纹仍在已知表里，init.test 不会红，只能由专设断言咬住）',
    file: 'skills/dual-critic/protocol/driver.snippet',
    find: '闸门期改业务文件不会让审批失败（命令 B / C / D 审批时只打印工作树改动摘要），',
    replace: '闸门期改业务文件没有机制会发现，',
    expect: [SNIPPET],
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
  const failed = [...new Set(out.split('\n').filter((l) => /^\s*✖ /.test(l)).map((l) => l.replace(/^\s*✖ /, '').replace(/ \([\d.]+ms\)$/, '').trim()))]
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

log(`# 审批前工作树摘要 · 入口资产 / 协议片段变异 · ${new Date().toISOString()}`);

try {
  await fs.writeFile(SENTINEL, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' });
} catch {
  await refuse(`✖ 哨兵 ${path.relative(ROOT, SENTINEL)} 已存在：上次运行没有善终，源文件可能还带着变异——拒跑。先 git diff 核对，确认无误后手工删掉哨兵再跑。`);
}

const files = [...new Set(CASES.map((c) => c.file))];
const base = new Map();
for (const f of files) {
  const buf = await fs.readFile(path.join(ROOT, f));
  base.set(f, { buf, sha: sha(buf), text: buf.toString('utf8') });
  log(`目标：${f}（基线 sha256 ${sha(buf).slice(0, 12)}）`);
}
log(`套件：${SUITES.join('、')}`);

const badFinds = CASES.map((c) => [c.id, base.get(c.file).text.split(c.find).length - 1]).filter(([, n]) => n !== 1);
if (badFinds.length > 0) {
  await fs.unlink(SENTINEL);
  await refuse(`✖ find 命中数不为 1：${badFinds.map(([id, n]) => `${id}=${n}`).join('、')}——拒跑`);
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
    const b = base.get(c.file);
    const abs = path.join(ROOT, c.file);
    await fs.writeFile(abs, b.text.replace(c.find, c.replace), 'utf8');
    try {
      if (sha(await fs.readFile(abs)) === b.sha) {
        log(`${c.id} ✖ 变异后哈希未变——${c.desc}`);
        allBit = false;
        continue;
      }
      const r = await runSuites();
      const bit = c.expect.every((e) => r.failed.some((f) => f.includes(e)));
      if (!bit) allBit = false;
      log(`${c.id} ${bit ? '✓ 咬住' : '✖ 没咬住'}（fail=${r.fail}）——${c.desc}`);
      log(`   期望红：${c.expect.join('；')}`);
      log(`   实际红：${r.failed.join(' | ') || '（无）'}`);
    } finally {
      await fs.writeFile(abs, b.buf);
      if (sha(await fs.readFile(abs)) !== b.sha) {
        allBit = false;
        log(`   ✖ 恢复后与基线不一致：${c.file}`);
      }
    }
  }
} finally {
  for (const [f, b] of base) {
    const now = sha(await fs.readFile(path.join(ROOT, f)));
    if (now !== b.sha) {
      await fs.writeFile(path.join(ROOT, f), b.buf);
      log(`收尾：${f} 与基线不一致，已按基线写回`);
    }
  }
  await fs.unlink(SENTINEL).catch(() => {});
}

log(`\n结论：${allBit ? `${CASES.length}/${CASES.length} 全部咬住` : '有变异没咬住或恢复异常，见上'}`);
await fs.writeFile(OUT, lines.join('\n') + '\n', 'utf8');
process.exit(allBit ? 0 : 1);
