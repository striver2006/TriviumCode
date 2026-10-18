/** 16B获批全文诊断及提示分支；0供应商CLI，独立文件和生产函数回归。 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { scratchDirSync } from '../helpers/scratch.js';

// WIN_FILE_SKIP（Windows 移植）：夹具/断言仍按 POSIX 形态写死（登记 Windows 移植残余清单，待逐文件适配）
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 夹具/断言仍按 POSIX 形态写死（登记 Windows 移植残余清单，待逐文件适配）');
} else {
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const helper = () => import(pathToFileURL(path.resolve('scripts/agent-access-evidence.mjs')).href);

test('README采样缺失/目录/软链不消费；内部读取错误继续抛且关闭descriptor', async () => {
  const h = await helper(), root = scratchDirSync('trivium-access-read-state-'), file = path.join(root, 'README.md');
  try {
    assert.equal(h.captureReadFileState(root).exists, false);
    fs.mkdirSync(file); assert.equal(h.captureReadFileState(root).regular_file, false); fs.rmdirSync(file);
    fs.symlinkSync(path.join(root, 'missing-target'), file);
    assert.equal(h.captureReadFileState(root).symlink, true); assert.equal(h.captureReadFileState(root).sha256, null); fs.unlinkSync(file);
    fs.writeFileSync(file, '真实文件首词\n', 'utf8');
    const state = h.captureReadFileState(root); assert.equal(state.bytes, Buffer.byteLength('真实文件首词\n')); assert.equal(state.sha256, sha('真实文件首词\n'));
    assert.throws(() => h.captureReadFileState('relative'), /绝对fixtureRoot/);
    assert.throws(() => h.captureReadFileState(path.join(root, 'missing-root')), /ENOENT/);
    const linkRoot = path.join(root, 'linked-root'); fs.symlinkSync(root, linkRoot);
    assert.equal(h.captureReadFileState(linkRoot).reason, 'fixture-root-not-directory');
    const error = new TypeError('undefined-read-fixture-error');
    const read = mock.method(fs, 'readFileSync', () => { throw error; }), close = mock.method(fs, 'closeSync');
    try { assert.throws(() => h.captureReadFileState(root), (value: unknown) => value === error); assert.equal(close.mock.callCount(), 1); }
    finally { read.mock.restore(); close.mock.restore(); }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('全文诊断严格配对、bytes/hash及尾部；不改变原读取断言', async () => {
  const h = await helper(), root = scratchDirSync('trivium-access-read-content-');
  const body = 'FIRSTWORD 完整正文\n', file = path.join(root, 'README.md'); fs.writeFileSync(file, body);
  try {
    const context = { fixtureRoot: root, code: 0, timedOut: false }, state = h.captureReadFileState(root);
    const states = { before: state, after: { ...state } };
    const command = { type: 'CommandExecution', id: 'session-unique', command: ['/bin/zsh', '-lc', 'cat README.md'],
      cwd: pathToFileURL(root).href, status: 'completed', exit_code: 0, parsed_cmd: [{ type: 'read', path: 'README.md' }], aggregated_output: body };
    const stdout = { type: 'command_execution', id: 'stdout-unique', command: '/bin/zsh -lc "cat README.md"',
      status: 'completed', exit_code: 0, aggregated_output: body };
    const base = () => ({ trace: { eventTypes: ['turn.completed'], rawItems: [structuredClone(stdout)] },
      events: [{ type: 'event_msg', payload: { type: 'item_completed', item: structuredClone(command) } }], context: { ...context }, states: structuredClone(states) });
    const judge = (v: any) => h.codexReadContentDiagnostic(v.trace, v.events, v.context, 'FIRSTWORD', v.states);
    const positive = base(), result = judge(positive);
    assert.equal(result.strict_content_match, true); assert.equal(result.comparison, 'byte-exact/no-normalization');
    assert.equal(result.output_bytes, Buffer.byteLength(body)); assert.equal(result.output_sha256, state.sha256);
    assert.equal(result.session_command_id, 'session-unique'); assert.equal(result.stdout_item_id, 'stdout-unique');
    for (const output of ['FIRSTWORD', body.slice(0, -1), body + '\n', body + 'suffix', 'prefix' + body, 'FIRSTWORD 截断\n']) {
      const v = base(); v.trace.rawItems[0]!.aggregated_output = output; v.events[0]!.payload.item.aggregated_output = output;
      const diagnostic = judge(v); assert.equal(diagnostic.strict_content_match, false, JSON.stringify(output));
      assert.ok(diagnostic.reasons.includes('output-content-mismatch'));
      // 原判据仍只消费其原轨迹规则，不被新诊断false改变。
      assert.equal(h.codexCommandEvidence(v.trace, v.events, v.context, 'FIRSTWORD').actual_read, true);
    }
    const changes: Array<(v: any) => void> = [
      v => { v.states.before = null; }, v => { v.states.after = null; },
      v => { v.states.after.sha256 = 'f'.repeat(64); }, v => { v.states.before.bytes = null; },
      v => { v.states.before.symlink = true; }, v => { v.states.before.path = path.join(root, 'other'); },
      v => { v.events.push(structuredClone(v.events[0])); }, v => { v.trace.rawItems.push(structuredClone(v.trace.rawItems[0])); },
      v => { v.events[0].payload.item.cwd = 'file:///tmp/other'; },
      v => { v.events[0].payload.item.parsed_cmd[0].path = 'other'; },
      v => { v.context.code = 2; }, v => { v.context.timedOut = true; }, v => { v.trace.eventTypes = []; },
      v => { v.events[0].payload.item.exit_code = 1; v.trace.rawItems[0].exit_code = 1; },
      v => { v.events[0].payload.item.status = 'failed'; v.trace.rawItems[0].status = 'failed'; },
      v => { v.events = []; }, v => { v.trace.rawItems = []; },
      v => { v.events[0].payload.item.aggregated_output = null; },
    ];
    for (const change of changes) { const v = base(); change(v); assert.equal(judge(v).strict_content_match, false); }
    for (const text of ['ls -la; cat README.md', 'cat README.md | cat', 'cat README.md > other', 'cat README.md || cat README.md']) {
      const v = base(); v.events[0]!.payload.item.command[2] = text;
      v.events[0]!.payload.item.parsed_cmd = [{ type: 'unknown', cmd: text }] as any;
      v.trace.rawItems[0]!.command = `/bin/zsh -lc "${text}"`;
      assert.equal(judge(v).strict_content_match, false); assert.equal(h.codexCommandEvidence(v.trace, v.events, v.context, 'FIRSTWORD').actual_read, false);
    }
    assert.throws(() => h.codexReadContentDiagnostic(positive.trace, positive.events, { ...context, fixtureRoot: 'relative' }, 'FIRSTWORD', states), /绝对fixtureRoot/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('十四份真实历史prompt兼容回放；当前非write臂不变且Codex/read无首词泄露', async () => {
  const h = await import(pathToFileURL(path.resolve('scripts/agent-access-recipes.mjs')).href);
  const raw = fs.readFileSync('test/fixtures/agent-access-prompt-replay.json');
  assert.equal(sha(raw), '16d0ea2b0bc2a93ed9781339df859d704b84fa3f7e9eb3dbd08b795b75311e89');
  const fixture = JSON.parse(raw.toString()); assert.equal(fixture.cases.length, 14);
  for (const sample of fixture.cases) {
    assert.equal(sha(sample.prompt), sample.prompt_sha256);
    assert.equal(sha(h.buildAdmissionPrompt(sample.agent, sample.arm, sample.firstWord, sample.targets, sample.fixtureRoot)), sample.prompt_sha256,
      `${sample.agent}/${sample.combination}/${sample.arm}`);
  }
  const prompt = h.buildAdmissionPrompt('codex', 'read', 'MUST_NOT_LEAK_7f3a2b', ['.env'], '/tmp/isolated');
  assert.ok(!prompt.includes('MUST_NOT_LEAK_7f3a2b')); assert.ok(!prompt.includes('SENTINEL_'));
  assert.match(prompt, /单一读取命令 cat README.md/); assert.match(prompt, /不预设结论/);
  assert.match(prompt, /findings是对象数组/); assert.match(prompt, /禁止字符串数组/); assert.match(prompt, /consulted/);
  assert.ok(!prompt.includes('"verdict":"approve"')); assert.ok(!prompt.includes('"summary":'));
  const source = fs.readFileSync('scripts/agent-access-closeout.mjs', 'utf8');
  assert.match(source, /const prompt = buildAdmissionPrompt\(agent, arm, firstWord, targets, fx.root, writeContract\)/);
  assert.match(source, /read_content_diagnostic: readContentDiagnostic/);
  const evidence = fs.readFileSync('scripts/agent-access-evidence.mjs', 'utf8');
  assert.equal(sha(evidence.slice(evidence.indexOf('export function codexCommandEvidence('), evidence.indexOf('export function primaryLoaded('))),
    '8662c80393311859b01731f780641647a1be7e89ee3ec186d767355f574b1479');
});

}
