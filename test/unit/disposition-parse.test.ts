import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDisposition, normalizeCell, normalizeDisposal, splitTableRow, isFallbackId,
} from '../../src/trivium/disposition.js';

/** R-C 的用例集：裁决表是人手写的 Markdown，解析器必须对写法宽容、对语义严格 */

const FM = `---
schema: trivium.disposition.v1
topic: 登录重构
stage: plan
role: claude
kind: revised
run_id: R1
addresses:
  - 2026-09-10-登录重构-gemini.md
  - 2026-09-10-登录重构-glm.md
---
`;

function doc(table: string, prose = ''): string {
  return `${FM}\n# 修订计划\n\n${prose}\n\n${table}\n\n## 后续章节\n\n正文若干。\n`;
}

const STANDARD = `| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | blocker | 接受 | 确认存在并发回滚缺口 | 修订计划 §3.2 |
| GLM-03 | glm | major | 驳回 | 该分支在配置校验处已被上游拒绝 | 不改 |
| AGY-04 | gemini | minor | 暂缓 | 需等依赖库升级 | 遗留风险 §5 |`;

test('标准表格：三行全部解析，字段归位', () => {
  const p = parseDisposition(doc(STANDARD));
  assert.deepEqual(p.problems, []);
  assert.equal(p.rows.length, 3);
  assert.deepEqual(p.rows[0], {
    id: 'AGY-01', source: 'gemini', severity: 'blocker',
    disposal: '接受', reason: '确认存在并发回滚缺口', action: '修订计划 §3.2',
  });
  assert.equal(p.rows[1]?.disposal, '驳回');
  assert.equal(p.rows[2]?.disposal, '暂缓');
});

test('front-matter 被解析出来', () => {
  const p = parseDisposition(doc(STANDARD));
  assert.equal(p.frontMatter?.schema, 'trivium.disposition.v1');
  assert.equal(p.frontMatter?.kind, 'revised');
  assert.equal(p.frontMatter?.addresses.length, 2);
});

test('缺 front-matter 会报出来', () => {
  const p = parseDisposition(`# 无头文档\n\n${STANDARD}`);
  assert.equal(p.frontMatter, null);
  assert.ok(p.problems.some((x) => x.message.includes('缺少 front-matter')));
});

test('列顺序调换不影响解析', () => {
  const shuffled = `| 裁决 | 意见编号 | 理由 | 落点 | 来源 | 严重度 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 接受 | AGY-01 | 确认成立 | §3.2 | gemini | blocker |`;
  const p = parseDisposition(doc(shuffled));
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0]?.id, 'AGY-01');
  assert.equal(p.rows[0]?.action, '§3.2');
});

test('列名同义写法可识别（编号/处置/原因/修改点）', () => {
  const alt = `| 编号 | 来自 | 严重性 | 处置 | 原因 | 修改点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-02 | glm | major | 采纳 | 确实缺了 | src/x.ts |`;
  const p = parseDisposition(doc(alt));
  assert.equal(p.rows.length, 1);
  assert.equal(p.rows[0]?.disposal, '接受', '「采纳」应归一化为「接受」');
});

test('全角标点混用不影响解析', () => {
  const fullwidth = `| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | blocker | 接受。 | 确认成立（见 §3） | 修订计划 §3.2 |`;
  const p = parseDisposition(doc(fullwidth));
  assert.equal(p.rows[0]?.disposal, '接受');
  assert.match(p.rows[0]!.reason, /确认成立\(见 §3\)/);
});

test('「不接受」归一化为「驳回」（§6.6 规则 2）', () => {
  assert.equal(normalizeDisposal('不接受'), '驳回');
  assert.equal(normalizeDisposal('拒绝'), '驳回');
  assert.equal(normalizeDisposal('reject'), '驳回');
  assert.equal(normalizeDisposal('同意'), '接受');
  assert.equal(normalizeDisposal('搁置'), '暂缓');
  assert.equal(normalizeDisposal('看情况'), null);
});

test('无法识别的裁决词报出具体行号（R-C 要求）', () => {
  const bad = `| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | blocker | 再想想 | 还没定 | — |`;
  const p = parseDisposition(doc(bad));
  assert.equal(p.rows.length, 0);
  const prob = p.problems.find((x) => x.message.includes('AGY-01'));
  assert.ok(prob, '应报出问题');
  assert.ok(prob!.line > 1, `应给出具体行号，实际 ${prob!.line}`);
  assert.match(prob!.message, /接受 \/ 驳回 \/ 暂缓/);
});

test('表格前后有正文、文中另有表格都不影响（只认列名对得上的那张）', () => {
  const other = `| 阶段 | 状态 |\n| :--- | :--- |\n| plan | 完成 |`;
  const md = `${FM}\n# 修订\n\n先说明背景。\n\n${other}\n\n以下是裁决：\n\n${STANDARD}\n\n收尾正文。\n`;
  const p = parseDisposition(md);
  assert.equal(p.rows.length, 3, '不应把「阶段/状态」那张表当裁决表');
});

test('单元格里的转义竖线不被当作分隔符', () => {
  const cells = splitTableRow('| AGY-01 | gemini | blocker | 接受 | 见 a \\| b | §3 |');
  assert.equal(cells.length, 6);
  assert.equal(cells[4], '见 a | b');
});

test('分隔行与空行被跳过，小结行不被当数据', () => {
  const withNoise = `${STANDARD}
| :--- | :--- | :--- | :--- | :--- | :--- |
|  |  |  |  |  |  |
| **合计** | — | — | 接受 3 | — | — |`;
  const p = parseDisposition(doc(withNoise));
  assert.equal(p.rows.length, 3, '合计行不带 AGY-/GLM- 前缀，不应被当作数据行');
});

test('来源列缺失时按编号前缀反推', () => {
  const noSource = `| 意见编号 | 裁决 | 理由 |
| :--- | :--- | :--- |
| AGY-01 | 接受 | 成立 |
| GLM-02 | 驳回 | 不成立 |
| AGY-F01 | 接受 | 降级意见 |`;
  const p = parseDisposition(doc(noSource));
  assert.equal(p.rows[0]?.source, 'gemini');
  assert.equal(p.rows[1]?.source, 'glm');
  assert.equal(p.rows[2]?.source, 'fallback');
});

test('落点列缺失时 action 为空字符串而非报错（由 gate 决定是否算失败）', () => {
  const noAction = `| 意见编号 | 裁决 | 理由 |
| :--- | :--- | :--- |
| AGY-01 | 接受 | 成立 |`;
  const p = parseDisposition(doc(noAction));
  assert.equal(p.rows[0]?.action, '');
});

test('必需列缺失（无「裁决」列）时明确报找不到裁决表', () => {
  const noDisposal = `| 意见编号 | 理由 |\n| :--- | :--- |\n| AGY-01 | 成立 |`;
  const p = parseDisposition(doc(noDisposal));
  assert.equal(p.rows.length, 0);
  assert.ok(p.problems.some((x) => x.message.includes('找不到裁决表')));
});

test('重跑轮次编号（AGY-r2-01）可识别', () => {
  const rerun = `| 意见编号 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- |
| AGY-r2-01 | 接受 | 成立 | §3 |`;
  const p = parseDisposition(doc(rerun));
  assert.equal(p.rows[0]?.id, 'AGY-r2-01');
});

test('fallback 编号识别', () => {
  assert.equal(isFallbackId('AGY-F01'), true);
  assert.equal(isFallbackId('GLM-F12'), true);
  assert.equal(isFallbackId('AGY-01'), false);
  assert.equal(isFallbackId('AGY-r2-01'), false);
});

test('normalizeCell 去零宽字符与折叠空白', () => {
  assert.equal(normalizeCell('  接​受  '), '接受');
  assert.equal(normalizeCell('a\n b'), 'a b');
});

test('「修改计划」必须被认作落点列——设计与模板都用这个词', () => {
  /*
   * 随仓库分发的 templates/response.md.template 用的就是「修改计划」。
   * 漏了这个别名，照模板写的应答件会被闸门判成「接受但没写落点」。
   */
  const md = [
    '---', 'schema: trivium.disposition.v1', 'topic: T', 'stage: code',
    'role: claude', 'kind: response', 'run_id: R', 'addresses: []', '---', '',
    '| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 修改计划 |',
    '| :--- | :--- | :--- | :--- | :--- | :--- |',
    '| AGY-01 | gemini | major | 接受 | 确实成立 | util/git.ts 抛错而非吞掉 |',
    '',
  ].join('\n');
  const r = parseDisposition(md);
  assert.equal(r.rows.length, 1, `解析失败：${JSON.stringify(r.problems)}`);
  assert.equal(r.rows[0]!.action, 'util/git.ts 抛错而非吞掉');
});

test('落点列的其它同义写法一并认', () => {
  for (const header of ['落点', '修改落点', '落地点', '修改点', '动作', 'action', '计划']) {
    const md = [
      '| 意见编号 | 裁决 | 理由 | ' + header + ' |',
      '| :--- | :--- | :--- | :--- |',
      '| GLM-01 | 接受 | 成立 | 某处 |',
      '',
    ].join('\n');
    const r = parseDisposition(md);
    assert.equal(r.rows[0]?.action, '某处', `列名「${header}」没被认出来`);
  }
});
