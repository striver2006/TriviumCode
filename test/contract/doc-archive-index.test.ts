import { test } from 'node:test';
import assert from 'node:assert/strict';
import { REPO_ROOT } from '../helpers/fixture.js';
import {
  KNOWN_INDEXED_DIRS,
  SECTION_HEADING,
  checkDomain,
  checkIndex,
  checkOrder,
  dateOf,
  formatProblems,
  fsIndexIO,
  indexedReadmes,
  parseSection,
  resolveTarget,
  type IndexIO,
  type PathKind,
  type Problem,
  type ProblemKind,
} from '../helpers/doc-archive-index.js';

/**
 * `doc/` 下各 README「当前已归档文件」一节的对账（EV-172，计划 `.reviews/测试报告索引补齐/plan/` r2 §3.5）。
 *
 * 口径与判定函数都在 `test/helpers/doc-archive-index.ts`，这里只做两件事：对活仓库跑一遍（A1～A3），
 * 以及用内存目录树证明判定函数在每种回潮形态下都会报（B 类）。
 *
 * 新增了报告或文档却没进所在目录的索引节，A2 当场红并点名文件；补一条顶格 `- [` 条目、按日期放好位置即可。
 *
 * 「起点 `466bb59` 恰报 19 条缺登与 4 条逆序」不在这里断言（测试不依赖 git 历史，浅克隆会断），
 * 由 `doc/05_testing/evidence/doc-archive-index-20261001/baseline-red.mjs` 做。
 */

const io = fsIndexIO(REPO_ROOT);
const domain = indexedReadmes(io);

test('A1 论域：下限清单里的目录都带索引节，且节标题各恰一次', () => {
  const ps = checkDomain(domain);
  assert.deepEqual(ps, [], `论域缺目录：\n${formatProblems(ps)}`);
  for (const readme of domain) {
    const n = parseSection(io.read(readme) ?? '').headingCount;
    assert.equal(n, 1, `${readme} 的「${SECTION_HEADING}」出现 ${n} 次`);
  }
});

test('A2 覆盖与悬空：目录里的每个文件恰有一条条目，条目与行内链接都指向真实存在的目标', async (t) => {
  for (const readme of domain) {
    await t.test(readme, () => {
      const ps = checkIndex(readme, io);
      assert.deepEqual(ps, [], `索引与目录不一致（新文档要同批进本节；条目要指向存在的文件）：\n${formatProblems(ps)}`);
    });
  }
});

test('A3 顺序：组内无日期条目在前，含日期条目按（日期, 文件名）升序', async (t) => {
  for (const readme of domain) {
    await t.test(readme, () => {
      const ps = checkOrder(readme, io);
      assert.deepEqual(ps, [], `索引节顺序不对：\n${formatProblems(ps)}`);
    });
  }
});

// ─── B：判定函数的反例（内存目录树，不碰仓库） ─────────────────────────────

/**
 * 内存目录树：文件由 `files` 给出，目录由文件路径的前缀与 `dirs` 推出，`others` 是既非文件也非目录的项，
 * `broken` 是列得出名字、类型判不出的项（断链软链）
 */
function memIO(files: Record<string, string>, extra: { dirs?: string[]; others?: string[]; broken?: string[] } = {}): IndexIO {
  const kinds = new Map<string, Exclude<PathKind, null> | 'broken'>();
  const addDirs = (p: string): void => {
    const parts = p.split('/');
    for (let i = 1; i < parts.length; i++) kinds.set(parts.slice(0, i).join('/'), 'dir');
  };
  for (const f of Object.keys(files)) addDirs(f);
  for (const d of extra.dirs ?? []) {
    addDirs(`${d}/x`);
  }
  for (const o of extra.others ?? []) {
    addDirs(o);
    kinds.set(o, 'other');
  }
  for (const b of extra.broken ?? []) {
    addDirs(b);
    kinds.set(b, 'broken');
  }
  for (const f of Object.keys(files)) kinds.set(f, 'file');
  return {
    read: (rel) => files[rel] ?? null,
    list: (rel) => {
      if (kinds.get(rel) !== 'dir') return null;
      const names = new Set<string>();
      for (const p of kinds.keys()) if (p.startsWith(`${rel}/`)) names.add(p.slice(rel.length + 1).split('/')[0]!);
      return [...names];
    },
    kind: (rel) => {
      const k = kinds.get(rel);
      return k === undefined || k === 'broken' ? null : k;
    },
  };
}

const R = 'doc/05_testing/README.md';
const D = 'doc/05_testing';

const GOOD_README = [
  '# 测试',
  '',
  '## 文件命名规范',
  '',
  '| 前缀 | 示例 |',
  '| :--- | :--- |',
  '| `REPORT_<日期>_<名称>.md` | `REPORT_2026-09-10_dual_review_bench.md` |',
  '- [`REPORT_2026-09-10_example.md`](./REPORT_2026-09-10_example.md)：命名规范节里的示例，不是条目',
  '',
  '## 当前已归档文件',
  '',
  '- [`CASE_a.md`](./CASE_a.md)：用例。',
  '- [`REPORT_2026-09-11_b.md`](./REPORT_2026-09-11_b.md)：报告，证据见 [`evidence/x/`](./evidence/x/)。',
  '- [`REPORT_2026-09-11_c.md`](./REPORT_2026-09-11_c.md#结论)：同日按文件名；带片段。',
  '- [`REPORT_2026-09-12_d%20e.md`](./REPORT_2026-09-12_d%20e.md)：百分号编码。',
  '- [`../02_design/x.md`](../02_design/x.md)：跨目录条目，只判悬空。',
  '  - [`REPORT_2026-09-11_b.md`](./REPORT_2026-09-11_b.md)：缩进项不是条目，它的链接算行内链接——不计覆盖、也不算重复',
  '- `evidence/`：目录说明，不是条目。外链 [官网](https://example.com) 与 [锚点](#top) 不解析。',
  '',
  '```',
  '## 当前已归档文件',
  '- [`REPORT_2099-01-01_fenced.md`](./REPORT_2099-01-01_fenced.md)：围栏里的假条目',
  '```',
  '',
  '## 测试分层要求',
  '- [`REPORT_2026-09-01_other_section.md`](./REPORT_2026-09-01_other_section.md)：别的节，不看',
].join('\n');

const GOOD_FILES: Record<string, string> = {
  [R]: GOOD_README,
  [`${D}/CASE_a.md`]: '',
  [`${D}/REPORT_2026-09-11_b.md`]: '',
  [`${D}/REPORT_2026-09-11_c.md`]: '',
  [`${D}/REPORT_2026-09-12_d e.md`]: '',
  [`${D}/.DS_Store`]: '',
  [`${D}/evidence/x/run.json`]: '',
  'doc/02_design/x.md': '',
};

function good(): IndexIO {
  return memIO(GOOD_FILES, { others: [`${D}/fifo`] });
}

function withReadme(text: string, files: Record<string, string> = GOOD_FILES): IndexIO {
  return memIO({ ...files, [R]: text });
}

function kinds(ps: readonly Problem[]): ProblemKind[] {
  return [...new Set(ps.map((p) => p.kind))].sort();
}

function all(r: string, x: IndexIO): Problem[] {
  return [...checkIndex(r, x), ...checkOrder(r, x)];
}

test('B1 基准形态零问题：跨目录条目、斜杠结尾的行内目录链接、目录说明项、围栏与别的节、隐藏项、子目录、非常规文件都不报', () => {
  const ps = all(R, good());
  assert.deepEqual(ps, [], formatProblems(ps));
});

test('B2 删一条条目 ⇒ missing，文案点名该文件', () => {
  const ps = all(R, withReadme(GOOD_README.replace(/^- \[`REPORT_2026-09-11_c\.md`\].*\n/m, '')));
  assert.deepEqual(kinds(ps), ['missing']);
  assert.match(ps[0]!.detail, /REPORT_2026-09-11_c\.md/);
});

test('B3 条目指向不存在的文件 ⇒ dangling；指向目录（含尾斜杠）⇒ dangling', () => {
  const add = (line: string): string => GOOD_README.replace('- `evidence/`', `${line}\n- \`evidence/\``);
  const gone = checkIndex(R, withReadme(add('- [`REPORT_2026-09-30_gone.md`](./REPORT_2026-09-30_gone.md)：不存在')));
  assert.deepEqual(kinds(gone), ['dangling']);
  assert.match(gone[0]!.detail, /REPORT_2026-09-30_gone\.md/);
  for (const t of ['./evidence', './evidence/', './evidence/x/', '../02_design/nope.md', 'https://example.com/a.md']) {
    assert.deepEqual(kinds(checkIndex(R, withReadme(add(`- [\`x\`](${t})：非文件目标`)))), ['dangling'], t);
  }
});

test('B4 目录多一份不进索引的文件（.md 与非 .md 各一）⇒ missing', () => {
  for (const f of ['REPORT_2026-09-30_new.md', 'REPORT_2026-09-30_table.csv']) {
    const ps = all(R, memIO({ ...GOOD_FILES, [`${D}/${f}`]: '' }));
    assert.deepEqual(kinds(ps), ['missing'], f);
    assert.ok(ps[0]!.detail.includes(f), ps[0]!.detail);
  }
});

test('B5 同一文件两条条目 ⇒ duplicate', () => {
  const dup = GOOD_README.replace('- `evidence/`', '- [`CASE_a.md`](./CASE_a.md)：又一条\n- `evidence/`');
  const ps = all(R, withReadme(dup));
  assert.deepEqual(kinds(ps), ['duplicate', 'order']);
  assert.match(ps.find((p) => p.kind === 'duplicate')!.detail, /CASE_a\.md 有 2 条条目/);
});

test('B6 顺序：跨日期逆序、同日文件名逆序、无日期排在含日期之后 ⇒ order；跨小节不报；垫底条目只报一条', () => {
  const lines = GOOD_README.split('\n');
  const at = (name: string): number => lines.findIndex((l) => l.startsWith(`- [\`${name}`));
  const swap = (a: number, b: number): string => {
    const ls = [...lines];
    [ls[a], ls[b]] = [ls[b]!, ls[a]!];
    return ls.join('\n');
  };
  const cross = checkOrder(R, withReadme(swap(at('REPORT_2026-09-11_c.md'), at('REPORT_2026-09-12_d'))));
  assert.deepEqual(kinds(cross), ['order']);
  assert.equal(cross.length, 1);
  const sameDay = checkOrder(R, withReadme(swap(at('REPORT_2026-09-11_b.md'), at('REPORT_2026-09-11_c.md'))));
  assert.deepEqual(kinds(sameDay), ['order']);
  assert.match(sameDay[0]!.detail, /REPORT_2026-09-11_b\.md 应排在 REPORT_2026-09-11_c\.md/);
  const undated = checkOrder(R, withReadme(swap(at('CASE_a.md'), at('REPORT_2026-09-11_b.md'))));
  assert.deepEqual(kinds(undated), ['order']);
  assert.match(undated[0]!.detail, /无日期的 CASE_a\.md/);

  const grouped = GOOD_README.replace('- [`REPORT_2026-09-12_d', '### 另一组\n\n- [`REPORT_2026-09-12_d').replace(
    '- [`CASE_a.md`](./CASE_a.md)：用例。\n- [`REPORT_2026-09-11_b.md`]',
    '- [`CASE_a.md`](./CASE_a.md)：用例。\n- [`REPORT_2026-09-12_d%20e.md`](./REPORT_2026-09-12_d%20e.md)：先出现的后一天。\n\n### 又一组\n\n- [`REPORT_2026-09-11_b.md`]',
  );
  // 同一文件两条条目会报 duplicate；这里只看顺序：跨小节的「后一天在前」不报
  assert.deepEqual(checkOrder(R, withReadme(grouped)), []);

  const bottom = [
    '## 当前已归档文件',
    '- [`REPORT_2026-09-12_d%20e.md`](./REPORT_2026-09-12_d%20e.md)：x',
    '- [`REPORT_2026-09-13_f.md`](./REPORT_2026-09-13_f.md)：x',
    '- [`REPORT_2026-09-14_g.md`](./REPORT_2026-09-14_g.md)：x',
    '- [`REPORT_2026-09-11_b.md`](./REPORT_2026-09-11_b.md)：垫底',
  ].join('\n');
  const ps = checkOrder(R, withReadme(bottom));
  assert.equal(ps.length, 1, formatProblems(ps));
  assert.equal(ps[0]!.line, 5);
});

test('B7 行内链接悬空 ⇒ inline_dangling；带协议与纯锚点的链接不解析', () => {
  const bad = GOOD_README.replace('[`evidence/x/`](./evidence/x/)', '[`evidence/y/`](./evidence/y/)');
  const ps = all(R, withReadme(bad));
  assert.deepEqual(kinds(ps), ['inline_dangling']);
  assert.match(ps[0]!.detail, /evidence\/y\//);
  assert.equal(resolveTarget(D, 'https://example.com/a.md'), null);
  assert.equal(resolveTarget(D, 'mailto:a@b.c'), null);
  assert.equal(resolveTarget(D, '#top'), null);
});

test('B8 论域：节标题两次 ⇒ section_ambiguous；没有该节不入论域；下限清单里的目录不在论域 ⇒ not_in_domain', () => {
  const twice = `${GOOD_README}\n\n${SECTION_HEADING}\n`;
  assert.deepEqual(kinds(checkIndex(R, withReadme(twice))), ['section_ambiguous']);
  assert.deepEqual(kinds(checkOrder(R, withReadme(twice))), ['section_ambiguous']);
  const x = memIO({
    [R]: GOOD_README,
    'doc/02_design/README.md': '# 设计\n\n## 当前已归档的文件\n',
    'doc/08_project/README.md': '# 项目\n',
    'doc/README.md': `# 文档\n\n${SECTION_HEADING}\n`,
  });
  assert.deepEqual(indexedReadmes(x), [R]);
  const ps = checkDomain(indexedReadmes(x), ['doc/02_design', 'doc/05_testing']);
  assert.deepEqual(ps.map((p) => `${p.kind} ${p.readme}`), ['not_in_domain doc/02_design/README.md']);
  assert.deepEqual(checkDomain(indexedReadmes(x), KNOWN_INDEXED_DIRS).length, KNOWN_INDEXED_DIRS.length - 1);
});

test('B9 缩进项与 * 起头的项不是条目 ⇒ 其文件报 missing', () => {
  for (const prefix of ['  - ', '* ', '-  ']) {
    const text = GOOD_README.replace('- [`CASE_a.md`]', `${prefix}[\`CASE_a.md\`]`);
    const ps = checkIndex(R, withReadme(text));
    assert.deepEqual(kinds(ps), ['missing'], JSON.stringify(prefix));
    assert.match(ps[0]!.detail, /CASE_a\.md/);
  }
});

test('B10 目标解析：片段、百分号编码、尾斜杠、上级目录', () => {
  assert.equal(resolveTarget(D, './REPORT_x.md#结论'), `${D}/REPORT_x.md`);
  assert.equal(resolveTarget(D, './REPORT_d%20e.md'), `${D}/REPORT_d e.md`);
  assert.equal(resolveTarget(D, './REPORT_%E4.md'), `${D}/REPORT_%E4.md`);
  assert.equal(resolveTarget(D, './evidence/x/'), `${D}/evidence/x`);
  assert.equal(resolveTarget('doc/02_design', '../05_testing/REPORT_2026-09-11_m0_probe.md'), 'doc/05_testing/REPORT_2026-09-11_m0_probe.md');
  assert.equal(resolveTarget('doc/02_design', './2026-09-10-设计.md'), 'doc/02_design/2026-09-10-设计.md');
  // 日期段锚定文件名起头、校验月日（代码双审 CODEX-03）
  assert.equal(dateOf('REPORT_2026-09-11_m0_probe.md'), '2026-09-11');
  assert.equal(dateOf('2026-09-10-Driver-DualCritic主攻双审流水线设计.md'), '2026-09-10');
  for (const n of ['REPORT_2026-99-99_x.md', 'NOTES_2026-13-45.md', 'REPORT_2026-02-00_x.md', 'v1.2026-01-01.md', 'CASE_manual_2026-09-11.md', 'REPORT_2026-09-11.md', 'ADR_001_isolation_mode.md']) {
    assert.equal(dateOf(n), null, n);
  }
});

test('B12 断链软链：没进索引 ⇒ missing，进了索引 ⇒ dangling；非常规文件不计覆盖（代码双审 CODEX-02）', () => {
  const broken = `${D}/REPORT_2026-09-13_moved.md`;
  const notIndexed = checkIndex(R, memIO(GOOD_FILES, { broken: [broken] }));
  assert.deepEqual(kinds(notIndexed), ['missing']);
  assert.match(notIndexed[0]!.detail, /REPORT_2026-09-13_moved\.md 没有进/);
  const indexedText = GOOD_README.replace('- `evidence/`', '- [`REPORT_2026-09-13_moved.md`](./REPORT_2026-09-13_moved.md)：断链。\n- `evidence/`');
  const indexed = checkIndex(R, memIO({ ...GOOD_FILES, [R]: indexedText }, { broken: [broken] }));
  assert.deepEqual(kinds(indexed), ['dangling']);
  assert.deepEqual(checkIndex(R, memIO(GOOD_FILES, { others: [`${D}/fifo`, `${D}/REPORT_2026-09-13_sock`] })), []);
});

test('B11 解析：围栏里的节标题不算、别的二级标题结束本节、小标题分组', () => {
  const s = parseSection(GOOD_README);
  assert.equal(s.headingCount, 1);
  assert.equal(s.headingLine, 10);
  assert.deepEqual(s.entries.map((e) => e.raw), [
    './CASE_a.md',
    './REPORT_2026-09-11_b.md',
    './REPORT_2026-09-11_c.md#结论',
    './REPORT_2026-09-12_d%20e.md',
    '../02_design/x.md',
  ]);
  assert.deepEqual(s.inline.map((l) => l.raw), ['./evidence/x/', './REPORT_2026-09-11_b.md', 'https://example.com', '#top']);
  const g = parseSection(`${SECTION_HEADING}\n- [a](./a.md)\n### 组\n- [b](./b.md)\n#### 更深\n- [c](./c.md)\n## 下一节\n- [d](./d.md)`);
  assert.deepEqual(g.entries.map((e) => `${e.raw}@${e.group}`), ['./a.md@0', './b.md@1', './c.md@2']);
});
