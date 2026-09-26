#!/usr/bin/env node
/**
 * 「留痕与文案小修」入口资产与协议片段的变异验证（EV-131 / EV-132 / EV-134 的非 `src/*.ts` 落点）。
 *
 * ## 为什么不走 `scripts/mutation-check.mjs`
 *
 * 装置的闸 4 比对 `dist/test/<源>.js` 这份被测产物；这些源是 Markdown / 片段，不进构建。
 * 契约测试在运行时从 `skills-src/` 现场渲染、`init.test` 现场读 `protocol/*.snippet`，改源后直接跑已编译套件即可。
 * 形态照 EV-125 的 `contract-mutations.mjs`，区别是这里**跨多个文件**：每条变异记下自己的目标文件。
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
 * 用法：node doc/05_testing/evidence/trace-copy-fixes-20260926/contract-mutations.mjs
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
const NEG = 'EV-132：L2 事后覆盖面的两族失实措辞';

const CASES = [
  {
    id: 'K1',
    desc: 'EV-131：命令 B 描述写回两家实名',
    file: 'skills-src/commands/review-plan.contract.md',
    find: 'description: 对已有计划做背靠背双审',
    replace: 'description: 对已有计划做 Antigravity + ZCode 背靠背双审',
    expect: ['EV-131：命令描述与一级标题不写死'],
  },
  {
    id: 'K2',
    desc: 'EV-132 D2：l2-notice 改回「由 approve 前置复核……与跑后漂移复算暴露」',
    file: 'skills-src/partials/guard/l2-notice.md',
    find: '越界不会被事前拦下。\n',
    replace: '越界不会被事前拦下，而是在事后由 approve 前置复核（裁决齐备 + 本轮工件 sha256）与跑后漂移复算暴露。\n',
    expect: [NEG],
  },
  {
    id: 'K3',
    desc: 'EV-132 D2：l2-notice 写回「只比已跟踪文件」（r1 CODEX-01 ≡ AGY-01 的原形）',
    file: 'skills-src/partials/guard/l2-notice.md',
    find: '跑后漂移复算会发现（被 .gitignore 忽略的文件除外）',
    replace: '跑后漂移复算会发现（只比已跟踪文件）',
    expect: [NEG],
  },
  {
    id: 'K4',
    desc: 'EV-132 D3：run-enforce.l2-none 改回「越界只会在事后由 approve 前置复核与跑后漂移复算暴露」',
    file: 'skills-src/partials/guard/run-enforce.l2-none.md',
    find: '审查期越界由跑后漂移复算发现（分档同下面的护栏段）；',
    replace: '越界只会在事后由 approve 前置复核与跑后漂移复算暴露；',
    expect: [NEG],
  },
  {
    id: 'K5',
    desc: 'EV-132 D4：driver.snippet 改回旧句（同时让当前正文指纹不在表里）',
    file: 'skills/dual-critic/protocol/driver.snippet',
    find: '  审查进行中的越界由跑后漂移复算发现（被 .gitignore 忽略的文件除外），闸门期改业务文件没有机制会发现，\n  审批之后删改审查工件只有带 Hook 的载体在提交时核对（详见 QUICKSTART §5.2）。',
    replace: '  越界由 approve 前置复核（裁决齐备 + 本轮工件 sha256）与跑后漂移复算在事后暴露。',
    expect: [NEG, '已知指纹表覆盖当前版'],
  },
  {
    id: 'K6',
    desc: 'EV-134：body.md 删掉 addresses 的填法说明',
    file: 'skills-src/partials/review/body.md',
    find: '  `addresses` 逐一列出本轮**每个出了结论的审核者**的审查文档文件名（照抄归档里的名字；失败侧不列），**不是意见编号**——\n  份数不符、列了别的轮次或编号，闸门判 `bad_front_matter` 并给出期望的文件名；\n',
    replace: '',
    expect: ['EV-134：命令 B / C / D 的写裁决件一步交代 addresses'],
  },
  {
    id: 'K8',
    desc: 'EV-132：l2-notice 去掉命令限定、改回「复核会拦下」（代码双审 r1 GLM-02 + CODEX-04 的原形）',
    file: 'skills-src/partials/guard/l2-notice.md',
    find: '- **审查工件**：命令 B / C / D 审批之前删改本轮的，审批前复核会发现不符并拒绝审批；',
    replace: '- **审查工件**：审批之前删改本轮的，复核会拦下；',
    expect: ['EV-132：L2 护栏段的审批两格带命令限定'],
  },
  {
    id: 'K7',
    desc: 'EV-132 D5：QUICKSTART §5.2 写回「它结尾……会在审批前复核与跑后漂移复算时暴露」',
    file: 'doc/07_manuals/QUICKSTART.md',
    find: '闸门停点那句提示与上表一致：闸门期无机制兜底、审批之后看由谁提交。',
    replace: '它结尾「越界……会在审批前复核与跑后漂移复算时暴露」半句对闸门期不成立，以上表为准。',
    expect: [NEG],
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

log(`# 留痕与文案小修 · 入口资产 / 协议片段变异 · ${new Date().toISOString()}`);

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
