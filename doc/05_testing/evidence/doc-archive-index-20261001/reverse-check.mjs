// 反向验证（计划 r2 §5.3）：每种回潮形态施加在一份临时镜像上，跑镜像里的目标测试，必须红且失败文案点名预期对象。
//
// **不碰活工作树**：镜像在 mkdtemp 里搭，活仓库的 doc/、test/、dist/ 一概不写。镜像构成（计划双审 CODEX-05）：
//   · package.json 拷贝、node_modules 软链——fixture.ts 向上找 package.json 求 REPO_ROOT，因此镜像里的测试指向镜像；
//   · dist/test/test/ 整份拷贝（弱化变异要改其中的编译产物），dist/test 下其余子目录软链（只读导入）；
//   · doc/ 只拷顶层文件与各一级目录的顶层文件，一级目录下的子目录一律软链到真实位置（evidence/ 不拷）。
//     判定的 kind 跟随软链，软链子目录仍判 dir、不计入覆盖，与活仓库同形；变异只改顶层文件，不写穿软链。
// 每种形态之间重建镜像；读数记镜像构建与目标测试的耗时。
//
// 形态：D1～D7 是文档回潮（用户决策的四种 + 追加三种）；W1～W9 是判定函数弱化（改镜像里的编译产物，锚点核对唯一）；
// C0 是未施加变异的对照，必须零失败。
// 退出码：0 全部符合期望；1 有形态没红、没点名预期对象或对照不绿；2 环境前提不满足（含锚点不唯一、测试输出解析不出、
// 测试超时、构建产物形状不对）。退 2 时当前镜像照样删除。
//
// 环境前提（代码双审 CODEX-04 / CODEX-09）：
//   · 失败读数按本机 Node 的 spec 报告器输出形状解析（行首 `ℹ pass N` / `ℹ fail N`、失败用例行以 `✖ ` 起头）；
//     本次在 Node v25.2.1 上验证，别的版本解析不出即退 2，不出读数；
//   · dist/test 与 dist/test/test 是真目录（构建脚本每次 rm -rf 后逐文件转译出来的形状），否则退 2；
//   · 起点提交与重编见 lib.mjs。
// 用法：node doc/05_testing/evidence/doc-archive-index-20261001/reverse-check.mjs
import { spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HERE, ROOT, checkPrereqs, fatalEnv, git } from './lib.mjs';

checkPrereqs();
for (const rel of ['dist/test', 'dist/test/test']) {
  let st = null;
  try {
    st = lstatSync(path.join(ROOT, rel));
  } catch {
    st = null;
  }
  if (!st || !st.isDirectory() || st.isSymbolicLink()) fatalEnv(`${rel} 不是真目录，镜像的构造前提不成立`);
}

const TEST_TIMEOUT_MS = 180_000;

/** 环境问题：在 run() 里抛出，镜像在 finally 里删掉之后再退 2 */
class EnvError extends Error {}

const T_README = 'doc/05_testing/README.md';
const HELPER_REL = 'dist/test/test/helpers/doc-archive-index.js';
const TEST_REL = 'dist/test/test/contract/doc-archive-index.test.js';

function buildMirror() {
  const t0 = performance.now();
  const m = mkdtempSync(path.join(os.tmpdir(), 'trivium-docidx-'));
  copyFileSync(path.join(ROOT, 'package.json'), path.join(m, 'package.json'));
  symlinkSync(path.join(ROOT, 'node_modules'), path.join(m, 'node_modules'));
  mkdirSync(path.join(m, 'dist/test'), { recursive: true });
  for (const n of readdirSync(path.join(ROOT, 'dist/test'))) {
    const src = path.join(ROOT, 'dist/test', n);
    if (n === 'test') cpSync(src, path.join(m, 'dist/test/test'), { recursive: true });
    else symlinkSync(src, path.join(m, 'dist/test', n));
  }
  mkdirSync(path.join(m, 'doc'));
  let files = 0;
  let links = 0;
  for (const n of readdirSync(path.join(ROOT, 'doc'))) {
    const src = path.join(ROOT, 'doc', n);
    if (statSync(src).isFile()) {
      copyFileSync(src, path.join(m, 'doc', n));
      files++;
      continue;
    }
    mkdirSync(path.join(m, 'doc', n));
    for (const c of readdirSync(src)) {
      const s = path.join(src, c);
      if (statSync(s).isDirectory()) {
        symlinkSync(s, path.join(m, 'doc', n, c));
        links++;
      } else {
        copyFileSync(s, path.join(m, 'doc', n, c));
        files++;
      }
    }
  }
  return { dir: m, build_ms: Math.round(performance.now() - t0), copied_files: files, symlinked_dirs: links };
}

function runTest(m) {
  const t0 = performance.now();
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', path.join(m, TEST_REL)], { cwd: m, encoding: 'utf8', maxBuffer: 64 << 20, timeout: TEST_TIMEOUT_MS });
  const ms = Math.round(performance.now() - t0);
  if (r.error) throw new EnvError(`目标测试${r.error.code === 'ETIMEDOUT' ? `超时（${TEST_TIMEOUT_MS} ms）` : `拉起失败：${r.error.message}`}`);
  const out = `${r.stdout}\n${r.stderr}`;
  const fail = out.match(/^ℹ fail (\d+)/m);
  const pass = out.match(/^ℹ pass (\d+)/m);
  if (!fail || !pass) throw new EnvError(`测试输出解析不出（退出码 ${r.status}；本机 Node ${process.version} 的报告器形状不符？）：\n${out.slice(0, 2000)}`);
  const failing = [...new Set(out.split('\n').filter((l) => /^\s*✖ /.test(l) && !/^\s*✖ failing tests:/.test(l)).map((l) => l.trim().replace(/ \([\d.]+ms\)$/, '')))];
  return { exit: r.status, pass: Number(pass[1]), fail: Number(fail[1]), failing, out, test_ms: ms };
}

const edit = (m, rel, fn) => {
  const p = path.join(m, rel);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`变异没有改动任何内容：${rel}`);
  writeFileSync(p, after);
};

/** 在编译产物里把唯一的 find 换成 replace；不唯一就退 2 */
const patch = (find, replace) => (m) =>
  edit(m, HELPER_REL, (s) => {
    const n = s.split(find).length - 1;
    if (n !== 1) throw new EnvError(`弱化变异锚点在 ${HELPER_REL} 里出现 ${n} 次（应恰为 1）：${find}`);
    return s.replace(find, () => replace);
  });

const lineOf = (text, needle) => {
  const ls = text.split('\n');
  const i = ls.findIndex((l) => l.startsWith(needle));
  if (i < 0 || ls.findIndex((l, j) => j > i && l.startsWith(needle)) >= 0) throw new Error(`定位不唯一：${needle}`);
  return i;
};

const FORMS = [
  {
    id: 'D1',
    what: '删一条索引条目（lock_reclaim_enoent）',
    apply: (m) => edit(m, T_README, (s) => { const ls = s.split('\n'); ls.splice(lineOf(s, '- [`REPORT_2026-09-30_lock_reclaim_enoent.md`]'), 1); return ls.join('\n'); }),
    expect: ['[missing]', 'REPORT_2026-09-30_lock_reclaim_enoent.md 没有进'],
  },
  {
    id: 'D2',
    what: '加一条指向不存在文件的条目',
    apply: (m) => edit(m, T_README, (s) => { const ls = s.split('\n'); ls.splice(lineOf(s, '- [`REPORT_2026-10-01_parse_degrade.md`]') + 1, 0, '- [`REPORT_2026-10-02_nonexistent.md`](./REPORT_2026-10-02_nonexistent.md)：不存在的报告。'); return ls.join('\n'); }),
    expect: ['[dangling]', 'REPORT_2026-10-02_nonexistent.md'],
  },
  {
    id: 'D3',
    what: '目录里放一份不进索引的 .md',
    apply: (m) => writeFileSync(path.join(m, 'doc/05_testing/REPORT_2026-10-02_unindexed.md'), '# 未登记\n'),
    expect: ['[missing]', 'REPORT_2026-10-02_unindexed.md 没有进'],
  },
  {
    id: "D3'",
    what: '目录里放一份不进索引的非 .md',
    apply: (m) => writeFileSync(path.join(m, 'doc/05_testing/REPORT_2026-10-02_table.csv'), 'a,b\n'),
    expect: ['[missing]', 'REPORT_2026-10-02_table.csv 没有进'],
  },
  {
    id: 'D4',
    what: '交换两条相邻的含日期条目（09-27 gate_block_no_skeleton 与 orphan_worker）',
    apply: (m) => edit(m, T_README, (s) => {
      const ls = s.split('\n');
      const a = lineOf(s, '- [`REPORT_2026-09-27_gate_block_no_skeleton.md`]');
      const b = lineOf(s, '- [`REPORT_2026-09-27_orphan_worker.md`]');
      if (b !== a + 1) throw new Error('D4 的两条不相邻');
      [ls[a], ls[b]] = [ls[b], ls[a]];
      return ls.join('\n');
    }),
    expect: ['[order]', 'REPORT_2026-09-27_gate_block_no_skeleton.md 应排在 REPORT_2026-09-27_orphan_worker.md'],
  },
  {
    id: 'D5',
    what: '06_deployment 的节标题改一个字',
    apply: (m) => edit(m, 'doc/06_deployment/README.md', (s) => s.replace('## 当前已归档文件', '## 当前已归档文档')),
    expect: ['[not_in_domain]', 'doc/06_deployment/README.md'],
  },
  {
    id: 'D6',
    what: '一条条目重复（CASE_manual_acceptance 抄一行）',
    apply: (m) => edit(m, T_README, (s) => { const ls = s.split('\n'); const i = lineOf(s, '- [`CASE_manual_acceptance.md`]'); ls.splice(i + 1, 0, ls[i]); return ls.join('\n'); }),
    expect: ['[duplicate]', 'CASE_manual_acceptance.md 有 2 条条目'],
  },
  {
    id: 'D7',
    what: '行内链接指向不存在的证据目录',
    apply: (m) => edit(m, T_README, (s) => s.replace('(./evidence/m10b-step2-20260925/)', '(./evidence/m10b-step2-nonexistent/)')),
    expect: ['[inline_dangling]', './evidence/m10b-step2-nonexistent/'],
  },
  {
    id: 'W1',
    what: '判定弱化：去掉覆盖检查',
    apply: patch('if (!own.has(f)) out.push', 'if (false) out.push'),
    expect: ['✖ B2'],
  },
  {
    id: 'W2',
    what: '判定弱化：去掉悬空检查（目标不存在或非文件也放过）',
    apply: patch('if (e.target === null || io.kind(e.target) !== "file") {', 'if (e.target === null) {'),
    expect: ['✖ B3'],
  },
  {
    id: 'W3',
    what: '判定弱化：去掉含日期条目的顺序检查',
    apply: patch('if (last && !(date > last.date', 'if (false && !(date > last.date'),
    expect: ['✖ B6'],
  },
  {
    id: 'W4',
    what: '判定弱化：去掉「无日期排在含日期之后」检查',
    apply: patch('if (last) out.push({ kind: "order"', 'if (false) out.push({ kind: "order"'),
    expect: ['✖ B6'],
  },
  {
    id: 'W5',
    what: '判定弱化：不再排除隐藏项（镜像的 05_testing 顶层另放一个 .DS_Store）',
    apply: (m) => {
      patch('!n.startsWith(".") && ', '')(m);
      writeFileSync(path.join(m, 'doc/05_testing/.DS_Store'), '');
    },
    expect: ['✖ B1', '.DS_Store 没有进'],
  },
  {
    id: 'W6',
    what: '判定弱化：条目识别放宽到任意链接',
    apply: patch('const ENTRY_RE = /^- \\[', 'const ENTRY_RE = /\\['),
    expect: ['✖ B9'],
  },
  {
    id: 'W7',
    what: '判定弱化：去掉尾斜杠归一',
    apply: patch('.replace(/\\/+$/, "")', ''),
    expect: ['✖ B10'],
  },
  {
    id: 'W8',
    what: '判定弱化：不认围栏（围栏里的假条目与假节标题被当真）',
    apply: patch('const FENCE_RE = /^\\s*(```|~~~)/;', 'const FENCE_RE = /^\\0never/;'),
    expect: ['✖ B1'],
  },
  {
    id: 'W9',
    what: '判定弱化：断链软链不计入覆盖（代码双审 CODEX-02）',
    apply: patch('const coverable = (k) => k === "file" || k === null;', 'const coverable = (k) => k === "file";'),
    expect: ['✖ B12'],
  },
];

const results = [];
const run = (form) => {
  const mirror = buildMirror();
  try {
    if (form.apply) form.apply(mirror.dir);
    const r = runTest(mirror.dir);
    const named = form.expect.map((e) => ({ needle: e, found: r.out.includes(e) }));
    const ok = form.control ? r.fail === 0 && r.exit === 0 : r.fail > 0 && named.every((n) => n.found);
    const firstLines = r.out
      .split('\n')
      .filter((l) => /^\s*\[(missing|dangling|duplicate|inline_dangling|order|not_in_domain|section_ambiguous)\]/.test(l))
      .map((l) => l.trim());
    results.push({
      id: form.id,
      what: form.what,
      ok,
      exit: r.exit,
      pass: r.pass,
      fail: r.fail,
      failing: r.failing,
      expect: named,
      problem_lines: [...new Set(firstLines)].slice(0, 6),
      mirror: { build_ms: mirror.build_ms, copied_files: mirror.copied_files, symlinked_dirs: mirror.symlinked_dirs },
      test_ms: r.test_ms,
    });
    console.log(`${ok ? '✓' : '✗'} ${form.id} ${form.what}：fail ${r.fail}（${r.failing.slice(0, 4).join('；')}）｜ 镜像 ${mirror.build_ms} ms，测试 ${r.test_ms} ms`);
  } finally {
    rmSync(mirror.dir, { recursive: true, force: true });
  }
};

const status0 = git(['status', '--porcelain']).trim();
try {
  run({ id: 'C0', what: '对照：未施加变异', control: true, expect: [] });
  for (const f of FORMS) run(f);
} catch (e) {
  if (e instanceof EnvError) fatalEnv(e.message);
  throw e;
}
const status1 = git(['status', '--porcelain']).trim();

const bad = results.filter((r) => !r.ok).length;
const readout = {
  generated_at: new Date().toISOString(),
  head: git(['rev-parse', '--short', 'HEAD']).trim(),
  node: process.version,
  worktree_untouched: status0 === status1,
  summary: `${results.length - bad}/${results.length} 符合期望（对照 1 + 文档形态 ${FORMS.filter((f) => f.id.startsWith('D')).length} + 判定弱化 ${FORMS.filter((f) => f.id.startsWith('W')).length}）`,
  results,
};
writeFileSync(path.join(HERE, 'reverse-check.json'), `${JSON.stringify(readout, null, 2)}\n`);
console.log(`\n${readout.summary}；活工作树 git status 前后${readout.worktree_untouched ? '一致' : '不一致'}`);
process.exit(bad || !readout.worktree_untouched ? 1 : 0);
