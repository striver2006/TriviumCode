import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { claudeCatalog, driverArgs, emptyCatalog, readDriverCatalog } from '../../src/launch/driverModels';
import { nativeCommand, type InteractiveProgram } from '../../src/launch/glmInteractive';

const menu = { models: [{ id: 'alpha', label: 'Alpha', efforts: ['low', 'high'] },
  { id: 'beta', label: 'Beta', efforts: ['high'] }], defaultEfforts: ['high'], note: '' };

test('CLI 默认逐字段省略，独立强度按当前默认模型校验', () => {
  for (const id of ['codex', 'claude', 'gemini', 'glm'] as const) assert.deepEqual(driverArgs(id, emptyCatalog(''), {}), []);
  assert.deepEqual(driverArgs('codex', menu, { driverModel: 'alpha' }), ['-m', 'alpha']);
  assert.deepEqual(driverArgs('codex', menu, { driverEffort: 'high' }), ['-c', 'model_reasoning_effort=high']);
  assert.deepEqual(driverArgs('codex', menu, { driverModel: 'alpha', driverEffort: 'low' }),
    ['-m', 'alpha', '-c', 'model_reasoning_effort=low']);
  assert.deepEqual(driverArgs('claude', menu, { driverEffort: 'high' }), ['--effort', 'high']);
  assert.deepEqual(driverArgs('gemini', menu, { driverModel: 'alpha' }), ['--model', 'alpha']);
  assert.throws(() => driverArgs('codex', menu, { driverModel: 'unknown' }), /不可用/);
  assert.throws(() => driverArgs('codex', menu, { driverModel: 'beta', driverEffort: 'low' }), /不匹配/);
  assert.throws(() => driverArgs('codex', menu, { driverEffort: 'low' }), /不匹配/);
  assert.throws(() => driverArgs('gemini', menu, { driverEffort: 'high' }), /独立/);
  assert.throws(() => driverArgs('glm', emptyCatalog(''), { driverModel: '后台模型' }), /不可用/);
});

test('Claude 将本入口的命令帮助与本供应商逐模型能力取交集', () => {
  const init = JSON.stringify({ type: 'control_response', response: { request_id: 'catalog', response: { models: [
    { value: 'default', supportsEffort: true, supportedEffortLevels: ['high'] },
    { value: 'opus', displayName: '本地模型', supportsEffort: true, supportedEffortLevels: ['low', 'high', 'max'] },
    { value: 'haiku', supportsEffort: false, supportedEffortLevels: ['low'] },
  ] } } });
  const cap = claudeCatalog('  --model <model>\n  --effort <level>\n      (low, high)', init);
  assert.deepEqual(cap.defaultEfforts, ['high']);
  assert.deepEqual(cap.models.map(m => m.efforts), [['low', 'high'], []]);
  assert.deepEqual(driverArgs('claude', cap, { driverModel: 'opus', driverEffort: 'low' }), ['--model', 'opus', '--effort', 'low']);
  assert.deepEqual(claudeCatalog('  --model <model>', init).defaultEfforts, []);
});

test('Codex 原生分页目录过滤隐藏项，默认强度跟随工作区模型', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'driver catalog '));
  try {
    const entrypoint = path.join(cwd, 'catalog.cjs');
    await writeFile(entrypoint, `const rl = require('node:readline').createInterface({input:process.stdin});
      const model = (id, level, extra={}) => ({ model:id, supportedReasoningEfforts:[{reasoningEffort:level}], ...extra });
      rl.on('line', l => {
        const m = JSON.parse(l); if (m.id == null) return;
        const result = m.method === 'initialize' ? {} : m.method === 'config/read' ? {config:{model:'beta'}} :
          m.params.cursor ? {data:[model('beta','max')]} :
          {data:[model('alpha','low',{isDefault:true}),model('internal','high',{hidden:true})],nextCursor:'page2'};
        process.stdout.write(JSON.stringify({id:m.id,result})+'\\n');
      });`);
    const program: InteractiveProgram = { entrypoint, source: '设置', launchMode: 'shellCommand', nodePath: process.execPath };
    const cap = await readDriverCatalog('codex', program, cwd);
    assert.deepEqual(cap.models.map(m => m.id), ['alpha','beta']);
    assert.deepEqual(cap.defaultEfforts, ['max']);
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

test('直接程序和 Node 脚本保留每个参数的字面边界', () => {
  const args = ['--model','模型 with spaces','--effort','high'];
  assert.deepEqual(nativeCommand({ entrypoint: '/bin/program', launchMode: 'direct' }, args),
    { shellPath: '/bin/program', shellArgs: args });
  assert.deepEqual(nativeCommand({ entrypoint: '/tmp/a b.cjs', launchMode: 'shellCommand', nodePath: '/bin/node' }, args),
    { shellPath: '/bin/node', shellArgs: ['/tmp/a b.cjs', ...args] });
});

test('旧 Codex 的可见目录、Antigravity 变体及独立 ZCode 的两个开关分别取自交互脚本', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'driver choices '));
  try {
    const entrypoint = path.join(cwd, 'cli.cjs');
    await writeFile(entrypoint, `switch (process.argv[2]) {
      case '--help': console.log(process.env.FIXTURE_HELP); break;
      case 'models': console.log('variant-high\\t模型（high）'); break;
      case 'debug': console.log(JSON.stringify({models:[
        {slug:'shown', visibility:'list', supported_reasoning_levels:[{effort:'low'}]},
        {slug:'internal', visibility:'hide', supported_reasoning_levels:[{effort:'max'}]}]})); break;
      default: process.exitCode = 1;
    }`);
    const program: InteractiveProgram = { entrypoint, source: '设置', launchMode: 'shellCommand', nodePath: process.execPath };
    const catalog = (agent: 'codex' | 'gemini' | 'glm', help: string) =>
      readDriverCatalog(agent, program, cwd, { ...process.env, FIXTURE_HELP: help });
    const codex = await catalog('codex', '');
    assert.deepEqual(codex.models, [{ id: 'shown', label: 'shown', efforts: ['low'] }]);
    const agy = await catalog('gemini', '  --model <id>\n  --effort <effort>');
    assert.deepEqual(agy.models, [{ id: 'variant-high', label: '模型（high）', efforts: [] }]);
    assert.deepEqual(driverArgs('gemini', agy, { driverModel: 'variant-high' }), ['--model', 'variant-high']);
    for (const help of ['Usage: zcode', '  --model <id>', '  --effort <level>']) {
      const zcode = await catalog('glm', help);
      assert.deepEqual(zcode.models, []);
      assert.deepEqual(zcode.defaultEfforts, []);
      assert.match(zcode.note, help.startsWith('Usage') ? /原生供应商/ : /启动参数有变化/);
    }
    await assert.rejects(catalog('glm', ''), error =>
      error instanceof Error && error.message.includes(entrypoint) && error.message.includes('--help'));
  } finally { await rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});
