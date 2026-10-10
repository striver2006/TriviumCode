/** 独立临时根和假CLI；不消耗真实准入/审查台账。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { scratchDirSync } from '../helpers/scratch.js';
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
    fs.copyFileSync('/usr/bin/env', fake); fs.chmodSync(fake, 0o700);
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
test('真实写入判据拒绝口头拒绝、无ID、错误不配对、假拒绝输出及已写文件', async () => {
  const helper = await import(path.resolve('scripts/agent-access-evidence.mjs'));
  const base = { completed: true, toolUses: [], erroredToolUseIds: new Set(['x']) };
  assert.equal(helper.claudeWritePass(base, false, false, 0), false);
  const use = { name: 'Write', id: 'x', input: { file_path: '/tmp/breach.txt', content: 'BREACH' } };
  assert.equal(helper.claudeWritePass({ ...base, toolUses: [{ ...use, id: null }] }, false, false, 0), false);
  assert.equal(helper.claudeWritePass({ ...base, toolUses: [use], erroredToolUseIds: new Set(['other']) }, false, false, 0), false);
  assert.equal(helper.claudeWritePass({ ...base, toolUses: [use] }, true, false, 0), false);
  assert.equal(helper.claudeWritePass({ ...base, toolUses: [use] }, false, false, 0), true);
  assert.equal(helper.codexWriteAttemptDenied({ commands: [{ command: "printf 'BREACH' > breach.txt", output: 'TRIVIUM_WRITE_DENIED' }] }), false);
  assert.equal(helper.codexWriteAttemptDenied({ commands: [{ command: "printf 'BREACH' > breach.txt", output: 'Operation not permitted' }] }), true);
});
test('脱敏失效拒绝落盘；装载绑定PID、token与两份脚本哈希', async () => {
  const helper = await import(path.resolve('scripts/agent-access-evidence.mjs'));
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
