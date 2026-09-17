/**
 * `topic resolve` 的端到端契约（EV-18）：`--` 之后按 argv 逐个 token 解析，不再拼串重切。
 *
 * ## 为什么必须走真实子进程
 *
 * 缺陷在 `cli.ts` 那一跳（`argv.slice(i+1).join(' ')`），单元测试直接调 `resolveTopicArgs`
 * 根本走不到它。既有的两处子进程用例（fault-injection / stub-agent-kit）以前把整串当
 * **一个** argv 元素传——它们测的是旧契约（计划双审 AGY-05）。这里钉住新契约：
 * shell 负责切词，正文里的引号、glob、旗标字样都逐字进 `prompt_hint`。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleMissing, bundleSkipReason, cli, makeFixture } from '../helpers/fixture.js';
import { EXIT } from '../../src/trivium/exit-codes.js';
import { extractJsonCandidate } from '../../src/trivium/parse.js';

const TOPIC = '主题解析契约';

/** EV-18 实撞的字符类 + glob + 旗标字样 + 单引号：全都得逐字到达 */
const FOCUS = '重点看 *.ts 里 ~[^/\\s"\'`]+ 这个字符类，以及 --base 与 --plan-file 的透传是否准确';

interface Resolved {
  topic: string;
  topic_inferred: boolean;
  prompt_hint: string | null;
  notes: string[];
}

async function resolve(root: string, args: string[]) {
  const r = await cli(root, ['topic', 'resolve', '--stage', 'plan', '--json', '--', ...args]);
  const cand = r.code === EXIT.OK ? extractJsonCandidate(r.stdout) : null;
  return { r, json: cand ? (JSON.parse(cand.json) as Resolved) : null };
}

test('正文作为一个 argv 参数：含引号、glob 与旗标字样时 --topic 仍被识别、正文逐字', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { root } = await makeFixture({ topic: TOPIC });
  const { r, json } = await resolve(root, [FOCUS, '--topic', TOPIC]);
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  assert.equal(json?.topic, TOPIC);
  assert.equal(json?.topic_inferred, false, '主题显式给了，不得回落推断');
  assert.equal(json?.prompt_hint, FOCUS, 'FR-20：逐字，一个字符不多不少');
  assert.ok(!json!.notes.some((n) => n.includes('--topic 字样')), '显式给了 --topic 就不该提醒');
});

test('--topic 被包进正文参数且未显式给主题 → 退 64，报错指向写法（EV-18 的响亮失败）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { root } = await makeFixture({ topic: TOPIC });
  const { r } = await resolve(root, [`重点看边界 --topic ${TOPIC}`]);
  assert.equal(r.code, EXIT.USAGE, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout + r.stderr, /--topic 字样/);
  assert.match(r.stdout + r.stderr, /引号之外/);
});

test('旧写法的字面引号原样进正文并给 note，不再被剥（CODEX-08）', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { root } = await makeFixture({ topic: TOPIC });
  const { r, json } = await resolve(root, ['"重点核实 --plan-file 透传说明是否准确"', '--topic', TOPIC]);
  assert.equal(r.code, EXIT.OK, `${r.stdout}${r.stderr}`);
  assert.equal(json?.prompt_hint, '"重点核实 --plan-file 透传说明是否准确"');
  assert.ok(json!.notes.some((n) => n.includes('字面引号')), JSON.stringify(json!.notes));
});

test('--args 传法已删：不给 -- 之后的内容退 64 并给新写法', { skip: bundleMissing && bundleSkipReason }, async () => {
  const { root } = await makeFixture({ topic: TOPIC });
  const r = await cli(root, ['topic', 'resolve', '--stage', 'plan', '--args', `看并发 --topic ${TOPIC}`]);
  assert.equal(r.code, EXIT.USAGE);
  assert.match(r.stdout + r.stderr, /-- 之后/);
});
