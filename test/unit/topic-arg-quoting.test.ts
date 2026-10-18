/**
 * 建议命令里的主题名统一转义（EV-195，用户 2026-10-06 定取 B）。
 *
 * `validateTopic` 是黑名单：`;` `&` `$` 反引号、引号、括号等都能进主题名。给人复制执行的建议命令
 * 原先把主题名裸拼在 `--topic ` 之后，含这些字符的主题一粘贴就被 shell 解释。现在一律经
 * `shellQuoteArg`：白名单 `[\p{L}\p{N}_.-]` 内的主题逐字不变（本仓现存主题全部在内），其余整体加单引号。
 *
 * 护栏：用 TypeScript AST 扫 `src/` 全部模板串，凡插值前的字面以 `--topic ` 结尾者，插值必须是
 * `shellQuoteArg(…)` 调用；按文件登记调用点数——新增一处建议命令要来这里登记（与 `driver-wiring` 护栏表同一取向）。
 * 注释与普通字符串不在扫描面内（只看模板串节点）。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import ts from 'typescript';
import { shellQuoteArg, validateTopic } from '../../src/trivium/naming.js';
import { claimCommand } from '../../src/trivium/driver-claim.js';
import { approveForkRecovery } from '../../src/trivium/gate.js';
import { REPO_ROOT } from '../helpers/fixture.js';
import { SH } from '../helpers/platform.js';

test('EV-195 Q1：白名单内的主题原样返回（含中文、数字、- _ .）', () => {
  for (const t of ['闸门闭环', 'M10b-第3步', 'run_id避让', 'v1.2.3', 'abc', '失联取消两格退69', 'ÉtéÜber']) {
    assert.equal(shellQuoteArg(t), t, t);
  }
});

test('EV-195 Q2：含白名单外字符时整体加单引号；内含单引号按 \'\\\'\' 转义', () => {
  assert.equal(shellQuoteArg('a;b'), "'a;b'");
  assert.equal(shellQuoteArg('x$(id)'), "'x$(id)'");
  assert.equal(shellQuoteArg('a`b`'), "'a`b`'");
  assert.equal(shellQuoteArg('a&b'), "'a&b'");
  assert.equal(shellQuoteArg('主题（草稿）'), "'主题（草稿）'", '中文全角括号不在白名单，同样加引号');
  assert.equal(shellQuoteArg("it's"), "'it'\\''s'");
  assert.equal(shellQuoteArg(''), "''", '空串也给一对引号，免得参数整个消失');
});

test('EV-195 Q3：这些主题名确实能过 validateTopic（校验不收紧），转义后经 sh 原样还原', async () => {
  const { run } = await import('../../src/trivium/util/exec.js');
  for (const t of ['a;b', 'x$(id)', 'a`b`', "it's", '主题（草稿）', '闸门闭环']) {
    assert.equal(validateTopic(t).ok, true, `${t} 应仍合法（本题不收紧校验）`);
    // SH：POSIX 为 /bin/sh，win32 为 Git Bash 的 sh.exe（shellQuoteArg 是 POSIX 单引号文法，语义随 sh）
    const r = await run(SH, ['-c', `printf '%s' ${shellQuoteArg(t)}`], { timeoutMs: 10_000 });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, t, `${t} 经 shell 还原不一致`);
  }
});

test('EV-195 Q4：两处纯函数调用点——带特殊字符的主题加引号，白名单内逐字不变', async () => {
  assert.equal(claimCommand('a;b', 'plan', 'claude'), "trivium topic claim --topic 'a;b' --stage plan --driver claude");
  assert.equal(claimCommand('闸门闭环', 'plan', 'claude'), 'trivium topic claim --topic 闸门闭环 --stage plan --driver claude');
  const rec = await approveForkRecovery({
    layout: { archiveRoot: '/nonexistent', topic: "it's" }, topic: "it's", stage: 'code', abandonCmd: '/dual-abandon', runId: null,
  });
  assert.ok(rec.missingRunId.includes("/dual-abandon --topic 'it'\\''s' --stage code"), rec.missingRunId);
});

/** 扫一份源码：返回 `--topic ` 之后的插值里，经 shellQuoteArg 的与裸拼的各几处 */
function scanTopicArgs(src: string): { quoted: number; bare: string[] } {
  const sf = ts.createSourceFile('scan.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let quoted = 0;
  const bare: string[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isTemplateExpression(n)) {
      n.templateSpans.forEach((span, i) => {
        const before = i === 0 ? n.head.text : n.templateSpans[i - 1]!.literal.text;
        if (!/--topic\s+$/.test(before)) return;
        const e = span.expression;
        if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'shellQuoteArg') quoted++;
        else bare.push(`${sf.getLineAndCharacterOfPosition(e.getStart(sf)).line + 1}: ${e.getText(sf)}`);
      });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { quoted, bare };
}

test('EV-195 Q5（扫描器自测）：裸拼、经转义、注释与普通字符串各自判对', () => {
  const r = scanTopicArgs([
    'const a = `x --topic ${t} y`;',
    'const b = `x --topic ${shellQuoteArg(t)} --stage ${s}`;',
    'const c = `--stage ${s} --topic ${o.topic}`;',
    '// 注释里的 `--topic ${t}` 不算',
    "const d = '--topic ${t}';",
  ].join('\n'));
  assert.equal(r.quoted, 1);
  assert.deepEqual(r.bare, ['1: t', '3: o.topic']);
});

/** 登记表：各文件里经 shellQuoteArg 的建议命令处数（EV-195 改造时 `--topic ${` 字面核出 20 处） */
const REGISTERED: Record<string, number> = {
  'trivium/approval.ts': 2,
  'trivium/cli.ts': 6,
  'trivium/driver-claim.ts': 1,
  'trivium/gate.ts': 1,
  'trivium/hooks.ts': 7,
  'trivium/review.ts': 2,
  'trivium/worktree-summary.ts': 1,
};

test('EV-195 Q6（源码护栏）：src/ 里 `--topic ` 之后的插值一律经 shellQuoteArg，调用点与登记表一致', async () => {
  const root = path.join(REPO_ROOT, 'src');
  const quoted: Record<string, number> = {};
  const bare: string[] = [];
  const walk = async (d: string): Promise<void> => {
    for (const e of await fs.readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (p.endsWith('.ts')) {
        const rel = path.relative(root, p).split(path.sep).join('/');
        const r = scanTopicArgs(await fs.readFile(p, 'utf8'));
        if (r.quoted > 0) quoted[rel] = r.quoted;
        bare.push(...r.bare.map((b) => `${rel}:${b}`));
      }
    }
  };
  await walk(root);
  assert.deepEqual(bare, [], `建议命令里的主题名要经 shellQuoteArg，裸拼的：\n${bare.join('\n')}`);
  assert.deepEqual(quoted, REGISTERED, '经 shellQuoteArg 的调用点与登记表不一致——新增 / 删除建议命令要同步登记表');
});
