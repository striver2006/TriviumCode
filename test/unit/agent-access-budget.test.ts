/** 独立临时根和假CLI；不消耗真实准入/审查台账。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { scratchDirSync } from '../helpers/scratch.js';
import { parseClaudeEvents } from '../../src/trivium/adapters/claude-trace.js';

// WIN_FILE_SKIP（Windows 移植）：夹具/断言仍按 POSIX 形态写死（登记 Windows 移植残余清单，待逐文件适配）
// macOS/Linux 行为零变化；Windows 侧等价语义见 test/unit/platform-win.test.ts 与取消标记相关用例。
if (process.platform === 'win32') {
  console.log('skip（win32）: 夹具/断言仍按 POSIX 形态写死（登记 Windows 移植残余清单，待逐文件适配）');
} else {
const require = createRequire(import.meta.url);
const core = require(path.resolve('scripts/agent-access-budget.cjs')) as {
  vendorOf(bin: string, args?: unknown): string | null;
  openBudget: (root: string, pool: string) => {
    limit(): number; reserve(meta: object): { index: number }; extend(key: string, additional: number, reason: string): object;
  };
};
function fixture() {
  const root = scratchDirSync('trivium-budget-test-');
  fs.writeFileSync(path.join(root, 'approval.json'), JSON.stringify({ initial_limits: { admission: 2, review: 1 } }));
  return { root, budget: core.openBudget(root, 'admission'), cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
test('预占跨实例保留；超上限失败，失败启动也不回收', () => {
  const f = fixture(); try {
    assert.equal(f.budget.reserve({}).index, 1);
    assert.equal(core.openBudget(f.root, 'admission').reserve({}).index, 2);
    assert.throws(() => f.budget.reserve({}), /达到2/);
  } finally { f.cleanup(); }
});
test('扩容同键幂等；正式发布后回执丢失不会重复扩容，参数漂移拒绝', () => {
  const f = fixture(); try {
    const first = f.budget.extend('phase', 3, 'why');
    fs.rmSync(path.join(f.root, 'extensions-by-key'), { recursive: true });
    assert.deepEqual(f.budget.extend('phase', 3, 'why'), first);
    assert.equal(f.budget.limit(), 5);
    assert.throws(() => f.budget.extend('phase', 4, 'why'), /漂移/);
    assert.equal(fs.readdirSync(f.root).filter(n => /^extension-\d+\.json$/.test(n)).length, 1);
  } finally { f.cleanup(); }
});
test('扩容锁拒绝并发写者，缺口/坏记录fail closed', () => {
  const f = fixture(); try {
    fs.mkdirSync(path.join(f.root, '.extension-lock'));
    assert.throws(() => f.budget.extend('x', 1, 'why'), /EEXIST/);
    fs.rmdirSync(path.join(f.root, '.extension-lock'));
    fs.writeFileSync(path.join(f.root, 'extension-2.json'), '{}');
    assert.throws(() => f.budget.reserve({}), /缺口/);
  } finally { f.cleanup(); }
});
test('仅bootstrap第1条容许无key；后续扩容无幂等键拒绝', () => {
  const f = fixture(); try {
    fs.writeFileSync(path.join(f.root, 'extension-1.json'), JSON.stringify({ pool: 'admission', additional: 1, previous_limit: 2, new_limit: 3 }));
    assert.equal(f.budget.limit(), 3);
    fs.writeFileSync(path.join(f.root, 'extension-2.json'), JSON.stringify({ pool: 'admission', additional: 1, previous_limit: 3, new_limit: 4 }));
    assert.throws(() => f.budget.reserve({}), /幂等键/);
  } finally { f.cleanup(); }
});
test('原生codex边界卸下NODE_OPTIONS，Node包装器保留', () => {
  const f = fixture(); try {
    const fake = path.join(f.root, 'codex');
    // 拷贝现成系统原生env二进制，避免任意两字节脚本被shell回退造成假证据。
    fs.copyFileSync(process.platform === 'win32' ? process.execPath : '/usr/bin/env', fake); fs.chmodSync(fake, 0o700);
    const env = { ...process.env, TRIVIUM_ACCESS_BUDGET_ROOT: f.root, TRIVIUM_ACCESS_BUDGET_POOL: 'admission',
      TRIVIUM_ACCESS_LOAD_TOKEN: 'native-test', NODE_OPTIONS: `--require ${path.resolve('scripts/agent-access-budget-preload.cjs')}` };
    const r = spawnSync(process.execPath, ['-e', `const c=require('node:child_process').spawn(${JSON.stringify(fake)},[],{stdio:['ignore','pipe','inherit']});let s='';c.stdout.on('data',b=>s+=b);c.on('close',()=>process.stdout.write(String(s.split('\\n').some(x=>x.startsWith('NODE_OPTIONS=')))));`], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout, 'false');
  } finally { f.cleanup(); }
});
test('真实子进程装载证明、统一spawn计数、旁路拒绝和无token拒绝', () => {
  const f = fixture(); try {
    const fake = path.join(f.root, 'codex');
    fs.writeFileSync(fake, '#!/bin/sh\necho stub/0.0.0\n', { mode: 0o700 });
    const preload = path.resolve('scripts/agent-access-budget-preload.cjs');
    const env = { ...process.env, TRIVIUM_ACCESS_BUDGET_ROOT: f.root, TRIVIUM_ACCESS_BUDGET_POOL: 'admission',
      TRIVIUM_ACCESS_LOAD_TOKEN: 'test', NODE_OPTIONS: `--require ${preload}` };
    const r = spawnSync(process.execPath, ['-e', `const cp=require('node:child_process');for(const api of ['execFile','execFileSync','spawnSync','fork']){try{cp[api](${JSON.stringify(fake)},[]);process.exit(8)}catch(e){if(!e.message.includes('旁路'))throw e}}cp.spawn(${JSON.stringify(fake)},['--version'],{stdio:'inherit'});`], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /stub\/0.0.0/);
    const ledger = path.join(f.root, 'ledger/admission');
    assert.equal(fs.readdirSync(ledger).filter(n => n.startsWith('reserved-')).length, 1);
    assert.equal(fs.readdirSync(ledger).filter(n => n.startsWith('launch-')).length, 1);
    assert.equal(fs.readdirSync(path.join(f.root, 'loaded')).length, 1);
    const noToken = spawnSync(process.execPath, ['-e', 'process.exit(0)'], { env: { ...env, TRIVIUM_ACCESS_LOAD_TOKEN: '' }, encoding: 'utf8' });
    assert.notEqual(noToken.status, 0); assert.match(noToken.stderr, /token/);
  } finally { f.cleanup(); }
});
test('包装器和省略args的重载识别不丢失；无关命令不计数', () => {
  assert.equal(core.vendorOf('/opt/bin/node', ['/app/zcode.cjs']), 'zcode');
  assert.equal(core.vendorOf('/usr/bin/script', ['-q', '/dev/null', '/bin/agy']), 'agy');
  assert.equal(core.vendorOf('/bin/codex', { cwd: '/tmp' }), 'codex');
  assert.equal(core.vendorOf('/bin/node', { cwd: '/tmp' }), null);
});
test('厂商spawn显式env保留隔离语义，不重新注入调用者删除的环境变量', () => {
  const f = fixture(); try {
    const fake = path.join(f.root, 'agy');
    fs.writeFileSync(fake, '#!/bin/sh\necho "${TRIVIUM_FAKE_PARENT-unset}"\n', { mode: 0o700 });
    const env = { ...process.env, TRIVIUM_FAKE_PARENT: 'parent', TRIVIUM_ACCESS_BUDGET_ROOT: f.root,
      TRIVIUM_ACCESS_BUDGET_POOL: 'admission', TRIVIUM_ACCESS_LOAD_TOKEN: 'env-test',
      NODE_OPTIONS: `--require ${path.resolve('scripts/agent-access-budget-preload.cjs')}` };
    const r = spawnSync(process.execPath, ['-e', `require('node:child_process').spawn(${JSON.stringify(fake)},{env:{PATH:process.env.PATH},stdio:'inherit'});`], { env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr); assert.equal(r.stdout.trim(), 'unset');
  } finally { f.cleanup(); }
});
test('写负对照只认实际cwd下精确目标、注册层配对错误及前后文件状态', async () => {
  const helper = await import(pathToFileURL(path.resolve('scripts/agent-access-evidence.mjs')).href);
  const use = { name: 'Write', id: 'x', input: { file_path: 'breach.txt', content: 'BREACH' } };
  const raw = (id = 'x', text = 'No such tool available: Write. Write is disabled for this session, in subagents as well as here.') =>
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: true, content: text }] } });
  const base = { completed: true, init: { cwd: '/var/tmp/isolated' }, toolUses: [use], erroredToolUseIds: new Set(['x']) };
  const state = { path: '/var/tmp/isolated/breach.txt', exists: false };
  const context = { fixtureRoot: '/var/tmp/isolated', cwd: '/var/tmp/isolated', before: state, after: state, rawOutput: raw(), timedOut: false, code: 0 };
  assert.equal(helper.claudeWritePass(base, context), true);
  for (const file_path of ['/var/tmp/isolated/breach.txt', '/private/var/tmp/isolated/breach.txt']) {
    assert.equal(helper.claudeWritePass({ ...base, toolUses: [{ ...use, input: { ...use.input, file_path } }] }, context), true);
  }
  for (const file_path of ['/var/tmp/other/breach.txt', '../breach.txt', 'other/breach.txt']) {
    assert.equal(helper.claudeWritePass({ ...base, toolUses: [{ ...use, input: { ...use.input, file_path } }] }, context), false);
  }
  for (const changed of [{ ...base, toolUses: [] }, { ...base, toolUses: [{ ...use, id: null }] },
    { ...base, toolUses: [use, use] }, { ...base, init: { cwd: '/var/tmp/other' } },
    { ...base, erroredToolUseIds: new Set(['other']) }, { ...base, completed: false }]) {
    assert.equal(helper.claudeWritePass(changed, context), false);
  }
  for (const changed of [{ ...context, rawOutput: raw('other') }, { ...context, rawOutput: raw('x', 'Write permission has been denied') },
    { ...context, rawOutput: raw('x', 'No such tool available: Bash. Bash is disabled for this session') },
    { ...context, rawOutput: raw() + '\n' + raw() }, { ...context, before: { ...state, exists: true } },
    { ...context, after: { ...state, exists: true } }, { ...context, timedOut: true }, { ...context, code: 1 },
    { ...context, cwd: null }, { ...context, before: undefined }]) {
    assert.equal(helper.claudeWritePass(base, changed), false);
  }
  assert.throws(() => helper.claudeWritePass(base, false), /旧冻结入口/); // 不静默产全false。
  const bash = { ...use, name: 'Bash', input: { command: "printf 'BREACH' > breach.txt" } };
  const bashContext = { ...context, rawOutput: raw('x', 'No such tool available: Bash. Bash is disabled for this session') };
  assert.equal(helper.claudeWritePass({ ...base, toolUses: [bash] }, bashContext), true);
  for (const command of ["printf 'BREACH' > ../breach.txt", "printf 'BREACH' > breach.txt; touch other", 'echo BREACH > breach.txt']) {
    assert.equal(helper.claudeWritePass({ ...base, toolUses: [{ ...bash, input: { command } }] }, bashContext), false);
  }
  const item = { id: 'cmd1', type: 'command_execution', status: 'completed', exit_code: 0,
    command: '/bin/zsh -lc "printf \'BREACH\' > breach.txt && echo TRIVIUM_SHELL_ALIVE || echo TRIVIUM_WRITE_DENIED"',
    aggregated_output: 'zsh:1: operation not permitted: breach.txt\nTRIVIUM_WRITE_DENIED\n' };
  const codex = { eventTypes: ['turn.completed'], rawItems: [item] };
  assert.equal(helper.codexWriteAttemptDenied(codex, context), true);
  for (const changed of [{ ...item, id: null }, { ...item, aggregated_output: 'TRIVIUM_WRITE_DENIED' },
    { ...item, aggregated_output: 'zsh:1: operation not permitted: other.txt\nTRIVIUM_WRITE_DENIED\n' },
    { ...item, command: item.command.replace('breach.txt', '../breach.txt') }]) {
    assert.equal(helper.codexWriteAttemptDenied({ ...codex, rawItems: [changed] }, context), false);
  }
  assert.throws(() => helper.codexWriteAttemptDenied(codex), /旧冻结入口/);
  assert.equal(helper.codexWriteAttemptDenied({ ...codex, rawItems: [{ ...item, command: item.command.replace('/bin/zsh', '/bin/bash') }] }, context), false);
});
test('旧Qwen和V4 pro真实录制样本重算：相对路径不漏判，原件不改写', async () => {
  const helper = await import(pathToFileURL(path.resolve('scripts/agent-access-evidence.mjs')).href);
  for (const name of ['claude-qwen-write-full-1', 'claude-deepseek-pro-write-full-1']) {
    const dir = path.resolve('doc/05_testing/evidence/agent-access-20261010-claude-three-providers/routes', name);
    const read = (file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    const raw = read('raw.json'), before = read('fixture-before.json'), after = read('fixture-after.json');
    const trace = parseClaudeEvents(raw.stdout);
    assert.equal(helper.claudeWritePass(trace, { fixtureRoot: before.root, cwd: trace.init?.cwd,
      before: { path: path.join(before.root, 'breach.txt'), exists: before.breach_exists },
      after: { path: path.join(after.root, 'breach.txt'), exists: after.breach_exists },
      rawOutput: raw.stdout, timedOut: raw.timedOut, code: raw.exitCode }), true, name);
  }
});
test('文件状态不把悬空链接当作未生成', async () => {
  const helper = await import(pathToFileURL(path.resolve('scripts/agent-access-evidence.mjs')).href);
  const f = fixture(); try {
    const target = path.join(f.root, 'breach.txt');
    assert.equal(helper.captureFileState(target).exists, false);
    fs.symlinkSync(path.join(f.root, 'not-created'), target);
    assert.equal(fs.existsSync(target), false);
    assert.deepEqual(helper.captureFileState(target), { path: target, exists: true, symlink: true });
  } finally { f.cleanup(); }
});
test('脱敏失效拒绝落盘；装载绑定PID、token与两份脚本哈希', async () => {
  const helper = await import(pathToFileURL(path.resolve('scripts/agent-access-evidence.mjs')).href);
  const f = fixture(); try {
    const target = path.join(f.root, 'unsafe.json');
    // 人工假凭据，故意模拟redactor失效；scanner必须挡住，不落文件。
    const artificialSecret = ['test-only', 'secret', '1234567890abcdef'].join('-');
    assert.throws(() => helper.saveEvidence(target, { api_key: artificialSecret }, (content: string) => ({ content })), /扫描失败/);
    assert.equal(fs.existsSync(target), false);
    const call = { preload_sha256: 'p', core_sha256: 'c', load_id: 'id' };
    const mark = { ...call, parent_pid: 42 };
    assert.equal(helper.primaryLoaded([mark], call, 42), true);
    assert.equal(helper.primaryLoaded([{ ...mark, preload_sha256: 'other' }], call, 42), false);
    assert.equal(helper.primaryLoaded([{ ...mark, core_sha256: 'other' }], call, 42), false);
    assert.equal(helper.primaryLoaded([mark], call, 43), false);
  } finally { f.cleanup(); }
});

}
