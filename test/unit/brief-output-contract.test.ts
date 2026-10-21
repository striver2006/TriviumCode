/**
 * 任务书第 6 节输出契约（设计 §9.4；计划 r2 §3.7、§5.1 B 组；EV-113、EV-124）。
 *
 * 枚举取值与必填字段**从 review.v2.json 读**再比对，不在用例里写死第二份——schema 改了，这里跟着变。
 * 名字带〔回归〕的格在改前构建上也必须绿。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBrief, type BriefInput } from '../../src/trivium/brief.js';
import { defaultConfig } from '../../src/trivium/config.js';
import { buildCodexArgs } from '../../src/trivium/adapters/codex.js';
import { CRITIC_VENDOR, CRITICS, type CriticId } from '../../src/trivium/types.js';
import type { Snapshot } from '../../src/trivium/freeze.js';
import reviewSchema from '../../skills/dual-critic/schema/review.v2.json' with { type: 'json' };

const SNAP: Snapshot = {
  gitHead: null, treeHash: 't', dirty: false, subjectSha256: 's',
  subjectPath: '/proj/.reviews/T/plan/2026-10-01-T-claude.md', denyPaths: [], diffText: null, takenAt: 'x',
};

function brief(critic: CriticId): string {
  const input: BriefInput = {
    cfg: defaultConfig(), critic, stage: 'plan', topic: 'T', runId: 'R', projectRoot: '/proj', snapshot: SNAP,
    promptHint: null, subjectExcerpt: '# 计划', mustRead: [], suggestedRead: [], ownHistory: [],
    schemaPath: '/s/review.v2.json', lenses: {}, taskGoal: null, taskGoalAppendix: null, minToolCalls: 5, minProjectReads: 3,
    commandExecution: 'none', mcpExecPrefixes: [],
  };
  return renderBrief(input);
}

function section6(b: string): string {
  const start = b.indexOf('## 6. 输出契约');
  const end = b.indexOf('## 7.', start);
  assert.ok(start >= 0 && end > start, '第 6 节应存在');
  return b.slice(start, end);
}

type Schema = {
  required: string[];
  properties: Record<string, { enum?: string[] }> & {
    findings: { items: { required: string[]; properties: Record<string, { enum?: string[] }> } };
  };
};
const S = reviewSchema as unknown as Schema;

test('B1 四个枚举字段的合法取值逐项列出，且与 review.v2.json 一致', () => {
  const s6 = section6(brief('codex'));
  for (const k of ['severity', 'layer', 'kind', 'confidence']) {
    const values = S.properties.findings.items.properties[k]!.enum!;
    const line = s6.split('\n').find((l) => l.includes(`\`${k}\`：`));
    assert.ok(line, `第 6 节应有 ${k} 的取值行`);
    const listed = [...line!.matchAll(/`([^`]+)`/g)].map((m) => m[1]).slice(1);
    assert.deepEqual(listed, values, `${k} 的取值应与 schema 逐项相等`);
  }
});

test('B2 意见全部必填字段都列出、个数随 schema；根必填与 verdict 取值列出；要求裸 JSON、不加 schema 外字段', () => {
  const s6 = section6(brief('gemini'));
  const req = S.properties.findings.items.required;
  assert.match(s6, new RegExp(`${req.length} 个字段全部必填`));
  for (const f of req) assert.ok(s6.includes(`\`${f}\``), `应列出 ${f}`);
  for (const f of S.required) assert.ok(s6.includes(`\`${f}\``), `应列出根必填 ${f}`);
  for (const v of S.properties['verdict']!.enum!) assert.ok(s6.includes(`\`${v}\``), `应列出 verdict 取值 ${v}`);
  assert.match(s6, /裸 JSON 对象/);
  assert.match(s6, /不要代码围栏/);
  assert.match(s6, /不要添加 schema 之外的字段/);
  assert.doesNotMatch(s6, /七个字段/, '旧文案「七个字段」与 schema 的九个必填不符');
});

test('B2′ 可选根字段的类型描述与 schema 一致（代码双审 r1 CODEX-06：不写死「是字符串数组」）', () => {
  const s6 = section6(brief('codex'));
  type P = { type?: string; items?: { type?: string } };
  const props = (reviewSchema as unknown as { properties: Record<string, P>; required: string[] });
  const optional = Object.keys(props.properties).filter((k) => !props.required.includes(k));
  assert.ok(optional.length > 0, '前提：schema 有可选根字段');
  for (const k of optional) {
    const p = props.properties[k]!;
    const want = p.type === 'array' && p.items?.type === 'string' ? '字符串数组' : null;
    if (want) assert.ok(s6.includes(`\`${k}\`（${want}）`), `${k} 的类型描述应为 ${want}`);
  }
  assert.doesNotMatch(s6, /`consulted` 是字符串数组/, '旧的整句写死形状不应再出现');
});

test('B3 zcode 侧有「不要调用 ExitPlanMode」一句，其余各家没有（按厂商判）', () => {
  for (const c of CRITICS) {
    const s6 = section6(brief(c));
    if (CRITIC_VENDOR[c] === 'zcode') assert.match(s6, /不要调用 ExitPlanMode/, `${c} 侧应有`);
    else assert.doesNotMatch(s6, /ExitPlanMode/, `${c} 侧不应有`);
  }
  assert.ok(CRITICS.some((c) => CRITIC_VENDOR[c] === 'zcode'), '前提：注册表里至少有一家 zcode');
});

test('B4〔回归〕八段结构不变：第 6 节仍在第 5 与第 7 节之间', () => {
  const b = brief('codex');
  const i5 = b.indexOf('## 5.');
  const i6 = b.indexOf('## 6. 输出契约');
  const i7 = b.indexOf('## 7.');
  assert.ok(i5 >= 0 && i5 < i6 && i6 < i7);
});

test('B5〔回归〕codex argv 不含 --output-schema（EV-124：本机 qwen provider 实测不生效；改动须先按同一装置重测）', () => {
  const argv = buildCodexArgs({ profile: 'qwen', model: 'm', effort: 'high', readonlyArgs: ['-s', 'read-only'], cwd: '/p' });
  assert.equal(argv.includes('--output-schema'), false);
});
