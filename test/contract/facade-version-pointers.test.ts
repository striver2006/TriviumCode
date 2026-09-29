import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../helpers/fixture.js';
import {
  CHANGELOG_LINE_RE,
  HISTORICAL_SAMPLES,
  MARKER,
  POINTERS,
  ROOT_FACADE_FILES,
  checkHistoricalSamples,
  checkPointers,
  facadeCandidates,
  facadeCorpus,
  findUnlistedMarkers,
  formatProblems,
  linksVersionedDoc,
  scanGlobalRules,
  type PointerEntry,
  type ProblemKind,
  type ReadFn,
} from '../helpers/facade-pointers.js';

/**
 * 门面文档版本指针的对账（EV-167，计划 `.reviews/门面文档版本指针/plan/` r2 §5.2）。
 *
 * 门面指针只链接目标文档并注明当前版本见其文档头，不写死版本号；增长型计数不写死。
 * 清单、论域规则与判定函数都在 `test/helpers/facade-pointers.ts`，这里只做两件事：
 * 对活仓库跑一遍（T1、T2、T3、T5），以及用内存文件证明判定函数在每种回潮形态下都会报（T4）。
 *
 * 「清单内每个位置在 `79d2ed4` 上都会红」不在这里断言（测试不依赖 git 历史，浅克隆会断），
 * 由 `doc/05_testing/evidence/facade-version-pointers-20260929/baseline-red.mjs` 做。
 */

const read: ReadFn = (rel) => {
  try {
    return readFileSync(path.join(REPO_ROOT, rel), 'utf8');
  } catch {
    return null;
  }
};

const corpus = facadeCorpus(
  facadeCandidates({
    exists: (rel) => existsSync(path.join(REPO_ROOT, rel)),
    readdir: (rel) => readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true }),
  }),
);

test('T1 每条当前版本指针：不写死版本号、带标记短语、仍链接目标文档', async (t) => {
  for (const e of POINTERS) {
    await t.test(`${e.id} ${e.file}「${e.anchor}」`, () => {
      const ps = checkPointers([e], read);
      assert.deepEqual(ps, [], `门面指针回潮或失位：\n${formatProblems(ps)}`);
    });
  }
});

test('T2 带标记短语的行都在清单里，清单项的文件都在门面论域内', () => {
  assert.ok(corpus.length > 0, '门面论域为空——论域规则把全部文件排除掉了');
  for (const f of ROOT_FACADE_FILES) assert.ok(corpus.includes(f), `根级门面文件不在论域内：${f}`);
  const ps = findUnlistedMarkers(corpus, POINTERS, read);
  assert.deepEqual(ps, [], `清单与门面文档不一致（新增的当前版本指针要进清单；清单项不能删）：\n${formatProblems(ps)}`);
});

test('T3 历史语境不误报：样本行确含版本号，不与清单项同行，不被全局规则命中', () => {
  const ps = checkHistoricalSamples(HISTORICAL_SAMPLES, POINTERS, read);
  assert.deepEqual(ps, [], `历史样本失位或被误伤：\n${formatProblems(ps)}`);
});

test('T5 全局规则：门面论域里没有自指版本与写死的增长型计数', () => {
  const ps = scanGlobalRules(corpus, read);
  assert.deepEqual(ps, [], `门面文档回潮：\n${formatProblems(ps)}`);
});

// ─── T4：判定函数的反例（内存文件，不碰仓库） ─────────────────────────────

const FILE = 'doc/x/README.md';
const GOOD = [
  '# 索引',
  '- [`LLD_orchestrator.md`](./LLD_orchestrator.md)：**设计**（当前版本见其文档头，状态：草稿）。依据 [PRD](../PRD_driver_dual_critic.md)（当前版本见其文档头）。',
  '- 另一行，第七章如实记录的现状缺口（已解决的划线保留）。',
  '> - **变更说明**：v1.0.1 随[设计 v1.3.0](./LLD_orchestrator.md) 同步：改为当前版本见其文档头；删去 50 个模块、七条现状缺口；截至本版（v1.0.1）。',
  '| **v1.0.1** | 2026-09-29 | [LLD](./LLD_orchestrator.md) 当前版本见其文档头；本版（v1.0.1） |',
  '编排器按「一个模块一件事」划分。',
  '- [`REPORT_x.md`](./REPORT_x.md)：索引条目改为「当前版本见其文档头」的写法。',
].join('\n');
const ENTRY: PointerEntry = { id: 'X1', file: FILE, anchor: '**设计**', links: ['LLD_orchestrator.md', 'PRD_driver_dual_critic.md'] };

function memRead(files: Record<string, string>): ReadFn {
  return (rel) => files[rel] ?? null;
}

function kinds(ps: readonly { kind: ProblemKind }[]): ProblemKind[] {
  return [...new Set(ps.map((p) => p.kind))].sort();
}

function withLine(i: number, line: string): string {
  const ls = GOOD.split('\n');
  ls[i] = line;
  return ls.join('\n');
}

test('T4 基准：改后形态零问题（变更记录形态、「一个模块」、只引述标记短语的叙述句都不报）', () => {
  const r = memRead({ [FILE]: GOOD });
  assert.deepEqual(checkPointers([ENTRY], r), []);
  assert.deepEqual(findUnlistedMarkers([FILE], [ENTRY], r), []);
  assert.deepEqual(scanGlobalRules([FILE], r), []);
});

test('T4 写回版本号 ⇒ forbidden', () => {
  const r = memRead({ [FILE]: GOOD.replace('（当前版本见其文档头，状态', '（v1.3.43，当前版本见其文档头，状态') });
  assert.deepEqual(kinds(checkPointers([ENTRY], r)), ['forbidden']);
});

test('T4 回到 79d2ed4 形态（版本号 + 无标记 + 无 PRD 链接）⇒ 三类同时报', () => {
  const r = memRead({ [FILE]: withLine(1, '- [`LLD_orchestrator.md`](./LLD_orchestrator.md)：**设计**（**v1.3.43**，状态：草稿）。依据 PRD v1.4.8。') });
  assert.deepEqual(kinds(checkPointers([ENTRY], r)), ['forbidden', 'link_missing', 'marker_missing']);
});

test('T4 锚点找不到 ⇒ anchor_missing；锚点重复 ⇒ anchor_ambiguous；文件不存在 ⇒ file_missing', () => {
  assert.deepEqual(kinds(checkPointers([ENTRY], memRead({ [FILE]: GOOD.replace('**设计**', '**设计说明**') }))), ['anchor_missing']);
  assert.deepEqual(kinds(checkPointers([ENTRY], memRead({ [FILE]: `${GOOD}\n再提一次 **设计**` }))), ['anchor_ambiguous']);
  assert.deepEqual(kinds(checkPointers([ENTRY], memRead({}))), ['file_missing']);
});

test('T4 删掉链接 ⇒ link_missing；删掉标记短语 ⇒ marker_missing', () => {
  const noLink = memRead({ [FILE]: GOOD.replace('依据 [PRD](../PRD_driver_dual_critic.md)（当前版本见其文档头）。', '依据 PRD。') });
  assert.deepEqual(kinds(checkPointers([ENTRY], noLink)), ['link_missing']);
  const noMarker = memRead({ [FILE]: withLine(1, '- [`LLD_orchestrator.md`](./LLD_orchestrator.md)：**设计**（状态：草稿）。依据 [PRD](../PRD_driver_dual_critic.md)。') });
  assert.deepEqual(kinds(checkPointers([ENTRY], noMarker)), ['marker_missing']);
});

test('T4 从清单删掉一项 ⇒ unlisted_marker；新增一行带标记短语的指针而不进清单 ⇒ unlisted_marker', () => {
  const r = memRead({ [FILE]: GOOD });
  assert.deepEqual(kinds(findUnlistedMarkers([FILE], [], r)), ['unlisted_marker']);
  const extra = memRead({ [FILE]: `${GOOD}\n- [\`MANUAL_user.md\`](./MANUAL_user.md)：**手册**（${MARKER}）。` });
  const ps = findUnlistedMarkers([FILE], [ENTRY], extra);
  assert.deepEqual(kinds(ps), ['unlisted_marker']);
  assert.equal(ps[0]?.line, GOOD.split('\n').length + 1);
});

test('T4 只引述标记短语、不带会升版文档链接的叙述句不报；带了就报（CODEX-06）', () => {
  const narrative = `${GOOD}\n本规范要求索引写「${MARKER}」，见 [说明](./notes.md)。`;
  assert.deepEqual(findUnlistedMarkers([FILE], [ENTRY], memRead({ [FILE]: narrative })), []);
  const pointer = `${GOOD}\n依据 [设计](../2026-09-10-Driver-DualCritic主攻双审流水线设计.md)（${MARKER}）。`;
  assert.deepEqual(kinds(findUnlistedMarkers([FILE], [ENTRY], memRead({ [FILE]: pointer }))), ['unlisted_marker']);
  assert.ok(linksVersionedDoc('[P](../01_requirements/PRD_driver_dual_critic.md)'));
  assert.ok(!linksVersionedDoc('PRD_driver_dual_critic.md 不在链接里'));
});

test('T4 清单项的文件不在论域内 ⇒ not_in_corpus', () => {
  assert.deepEqual(kinds(findUnlistedMarkers([], [ENTRY], memRead({ [FILE]: GOOD }))), ['not_in_corpus']);
});

test('T4 全局规则：自指版本、阿拉伯与汉字数字的增长型计数都报', () => {
  const cases: Array<[string, ProblemKind]> = [
    ['截至本版（v1.4.8）：AC-20 已达成', 'self_version'],
    ['截至本版 (v1.4.8)', 'self_version'],
    ['50 个模块 / 16437 行代码的分层地图', 'stat_count'],
    ['规模基准：16437 行 TypeScript', 'stat_count'],
    ['16,437 行代码', 'stat_count'],
    ['以及第七章如实记录的七条现状缺口', 'stat_count'],
    ['第十章如实列出的九条已知限制', 'stat_count'],
    ['六条执行流的调用链', 'stat_count'],
    ['七个日常场景', 'stat_count'],
    ['17 条现状缺口', 'stat_count'],
  ];
  for (const [line, kind] of cases) {
    const ps = scanGlobalRules([FILE], memRead({ [FILE]: line }));
    assert.deepEqual(kinds(ps), [kind], `「${line}」应报 ${kind}，实得：\n${formatProblems(ps)}`);
  }
  for (const line of ['编排器按「一个模块一件事」划分', '三个核心状态机、贯穿全局的五条实现约束', '七条命令的完整契约、五道护栏', '截至 v1.4.8：AC-20 已达成']) {
    assert.deepEqual(scanGlobalRules([FILE], memRead({ [FILE]: line })), [], `「${line}」不应报`);
  }
});

test('T4 历史样本：版本号被删 ⇒ forbidden；与清单项同行 ⇒ sample_on_pointer', () => {
  const sample = { id: 'HX', file: FILE, anchor: '随设计', why: '测试' };
  const hist = memRead({ [FILE]: 'a\n本条随设计 v1.3.0 同步\nb' });
  assert.deepEqual(checkHistoricalSamples([sample], [], hist), []);
  const erased = memRead({ [FILE]: 'a\n本条随设计同步\nb' });
  assert.deepEqual(kinds(checkHistoricalSamples([sample], [], erased)), ['forbidden']);
  const same = { id: 'HY', file: FILE, anchor: '**设计**', why: '测试' };
  const r = memRead({ [FILE]: GOOD.replace('状态：草稿', '状态：草稿，v1.0.0 起') });
  assert.deepEqual(kinds(checkHistoricalSamples([same], [ENTRY], r)), ['sample_on_pointer']);
});

test('T4 论域规则：报告、证据、项目日志、参考答卷、演进设计不在论域内；根级门面文件在', () => {
  const got = facadeCorpus([
    'README.md',
    'AGENTS.md',
    'CLAUDE.md',
    '.reviews/README.md',
    'doc/README.md',
    'doc/02_design/README.md',
    'doc/05_testing/README.md',
    'doc/05_testing/REPORT_2026-09-29_x.md',
    'doc/05_testing/evidence/a/b.md',
    'doc/08_project/BACKLOG.md',
    'doc/02_design/reference/r.md',
    'doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md',
    'doc/02_design/x.png',
  ]);
  assert.deepEqual(got, ['.reviews/README.md', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'doc/02_design/README.md', 'doc/05_testing/README.md', 'doc/README.md']);
});

test('T4 候选路径：只收存在的根级门面文件，doc/ 递归展开', () => {
  const tree: Record<string, Array<[string, 'd' | 'f']>> = {
    doc: [['README.md', 'f'], ['02_design', 'd']],
    'doc/02_design': [['README.md', 'f'], ['reference', 'd']],
    'doc/02_design/reference': [['r.md', 'f']],
  };
  const got = facadeCandidates({
    exists: (rel) => rel === 'README.md' || rel === 'CLAUDE.md',
    readdir: (rel) => (tree[rel] ?? []).map(([name, t]) => ({ name, isDirectory: () => t === 'd', isFile: () => t === 'f' })),
  });
  assert.deepEqual(got, ['README.md', 'CLAUDE.md', 'doc/README.md', 'doc/02_design/README.md', 'doc/02_design/reference/r.md']);
});

test('T4 变更记录形态的识别', () => {
  assert.ok(CHANGELOG_LINE_RE.test('> - **变更说明**：v1.4.17（2026-09-29）'));
  assert.ok(CHANGELOG_LINE_RE.test('| **v1.3.63** | 2026-09-29 | …'));
  assert.ok(CHANGELOG_LINE_RE.test('| v1.0.0 | 2026-09-10 | 首版'));
  assert.ok(!CHANGELOG_LINE_RE.test('> 依据 [设计](…)（两者的当前版本见其文档头）。'));
  assert.ok(!CHANGELOG_LINE_RE.test('| [PRD](…) v1.4.0 → **v1.4.8** | A + B |'));
});
