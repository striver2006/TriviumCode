/** 证据选择、真实会话配对与失败清理；不启动供应商CLI。 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scratchDirSync } from '../helpers/scratch.js';

test('显式新臂未完成不回退旧成功；引用hash与身份必须一致', async () => {
  const h = await import(path.resolve('scripts/agent-access-selection.mjs'));
  const root = scratchDirSync('trivium-access-selection-');
  try {
    const key = 'claude-kimi-pro-read';
    const write = (variant: number, completed: boolean) => {
      const dir = path.join(root, 'routes', `${key}-${variant}`); fs.mkdirSync(dir, { recursive: true });
      for (const [name, value] of Object.entries({ 'requested.json': { agent: 'claude', combination: 'kimi-pro', arm: 'read', variant },
        'result.json': { completed }, 'fingerprints-after.json': { unchanged: true } })) fs.writeFileSync(path.join(dir, name), JSON.stringify(value));
      return { variant, ...Object.fromEntries(['requested.json', 'result.json', 'fingerprints-after.json'].map(n => [n, h.hash(path.join(dir, n))])) };
    };
    const old = write(1, true), current = write(2, false);
    const file = path.join(root, 'selection.json');
    fs.writeFileSync(file, JSON.stringify({ schema: 'trivium.access.selection.v1', routes: { [key]: current }, versions: {} }));
    const selection = h.loadSelection(file);
    assert.equal(h.selectedEvidence(root, selection, key).complete, false);
    fs.rmSync(path.join(root, 'routes', `${key}-2/result.json`));
    assert.equal(h.selectedEvidence(root, selection, key).missing, 'result.json');
    assert.equal(h.selectedEvidence(root, selection, 'claude-qwen-read'), null);
    selection.manifest.routes[key] = old;
    fs.appendFileSync(path.join(root, 'routes', `${key}-1/result.json`), ' ');
    assert.throws(() => h.selectedEvidence(root, selection, key), /hash不符/);
    selection.manifest.routes[key] = { variant: '../1' };
    assert.throws(() => h.selectedEvidence(root, selection, key), /variant无效/);
    assert.throws(() => h.loadSelection(), /缺显式/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('版本从零与刷新均显式引用；未完成、入口/配置漂移拒绝', async () => {
  const h = await import(path.resolve('scripts/agent-access-selection.mjs'));
  const root = scratchDirSync('trivium-access-version-');
  try {
    const file = path.join(root, 'selection.json');
    fs.writeFileSync(file, JSON.stringify({ schema: 'trivium.access.selection.v1', routes: {}, versions: {} }));
    const entry = path.join(root, 'node-wrapper'), native = path.join(root, 'native-cli');
    fs.writeFileSync(entry, 'wrapper'); fs.writeFileSync(native, 'native');
    fs.mkdirSync(path.join(root, 'ledger/admission'), { recursive: true });
    const selection = h.loadSelection(file), fingerprints = { entry: h.hash(entry), native_entry: h.hash(native), globals: { config: 'config-hash' } };
    assert.throws(() => h.selectedVersion(root, selection, 'codex', fingerprints), /缺失/);
    for (const variant of [1, 3]) {
      const key = 'static-codex-version', dir = path.join(root, 'routes', `${key}-${variant}`); fs.mkdirSync(dir, { recursive: true });
      const scoped = { ...fingerprints, profile_config: variant === 1 ? 'native-config' : 'qwen-config' };
      const values = { 'requested.json': { agent: 'static', combination: 'codex', arm: 'version', variant, entry, profile: variant === 1 ? null : 'qwen', fingerprints: { ...scoped, native_entry: null } },
        'result.json': { completed: true, version: `0.162.${variant}` }, 'fingerprints-after.json': { unchanged: true } };
      for (const [n, v] of Object.entries(values)) fs.writeFileSync(path.join(dir, n), JSON.stringify(v));
      const requestFile = path.join(dir, 'requested.json');
      const common = { fingerprint_manifest: requestFile, kind: 'version', cli: 'codex', spawned: true, code: 0, signal: null, error_code: null };
      fs.writeFileSync(path.join(root, `ledger/admission/launch-000${variant}.json`), JSON.stringify({ ...common, index: variant, parent_pid: 100, pid: 200, entry, entry_sha256: h.hash(entry) }));
      fs.writeFileSync(path.join(root, `ledger/admission/launch-000${variant + 4}.json`), JSON.stringify({ ...common, index: variant + 4, parent_pid: 200, boundary_parent: `codex:100:${variant}`, entry: native, entry_sha256: h.hash(native) }));
      const nativeReference = h.nativeVersionFromLedger(root, requestFile);
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ ...values['result.json'], native_version_reference: nativeReference }));
      selection.manifest.versions[key] = { variant, ...Object.fromEntries(Object.keys(values).map(n => [n, h.hash(path.join(dir, n))])) };
      assert.equal(h.selectedVersion(root, selection, 'codex', scoped).version, `0.162.${variant}`);
      assert.equal(h.selectedVersion(root, selection, 'codex', scoped).native_entry, native);
      assert.throws(() => h.selectedVersion(root, selection, 'codex', { ...scoped, profile_config: 'other-profile' }), /指纹不符/);
      const duplicate = path.join(root, 'ledger/admission/launch-0010.json');
      fs.copyFileSync(path.join(root, `ledger/admission/launch-000${variant + 4}.json`), duplicate);
      assert.throws(() => h.selectedVersion(root, selection, 'codex', scoped), /歧义/);
      fs.unlinkSync(duplicate);
      fs.writeFileSync(native, 'upgraded');
      assert.throws(() => h.selectedVersion(root, selection, 'codex', scoped), /native入口/);
      fs.writeFileSync(native, 'native');
      assert.throws(() => h.selectedVersion(root, selection, 'codex', { ...scoped, entry: 'new-binary' }), /指纹不符/);
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(values['result.json']));
      selection.manifest.versions[key]['result.json'] = h.hash(path.join(dir, 'result.json'));
      assert.throws(() => h.selectedVersion(root, selection, 'codex', scoped), /缺显式native/);
      fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ completed: false, version: `0.162.${variant}` }));
      selection.manifest.versions[key]['result.json'] = h.hash(path.join(dir, 'result.json'));
      assert.throws(() => h.selectedVersion(root, selection, 'codex', scoped), /未完成/);
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('六条Codex读取真实录制样本消费实际命令cwd；echo/错目录/歧义不通过', async () => {
  const h = await import(path.resolve('scripts/agent-access-evidence.mjs'));
  const root = path.resolve('doc/05_testing/evidence/agent-access-20261010-closeout-r2/routes');
  for (const combination of ['native-sol', 'native-luna', 'native-astra', 'qwen', 'kimi', 'deepseek']) {
    const dir = path.join(root, `codex-${combination}-read-1`);
    const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const result = read('result.json'), before = read('fixture-before.json'), events = read('session-events.json');
    const context = { fixtureRoot: before.root, timedOut: false, code: 0 };
    assert.throws(() => h.codexCommandEvidence(result.trace, events, {}, before.first_word), /绝对fixtureRoot/);
    assert.throws(() => h.codexCommandEvidence(result.trace, events, { fixtureRoot: 'relative' }, before.first_word), /绝对fixtureRoot/);
    assert.equal(h.codexCommandEvidence(result.trace, events, context, before.first_word).actual_read, true, combination);
    const altered = (change: (item: any) => void) => {
      const copy = structuredClone(events);
      for (const event of copy) if (event.type === 'event_msg' && event.payload?.type === 'item_completed' && event.payload.item?.type === 'CommandExecution') change(event.payload.item);
      return copy;
    };
    assert.equal(h.codexCommandEvidence(result.trace, altered(c => { c.cwd = 'file:///tmp/other'; }), context, before.first_word).actual_read, false);
    assert.equal(h.codexCommandEvidence(result.trace, altered(c => { c.parsed_cmd = [{ type: 'unknown', cmd: 'echo README.md' }]; }), context, before.first_word).actual_read, false);
    assert.equal(h.codexCommandEvidence(result.trace, [...events, ...events], context, before.first_word).actual_read, false);
    assert.equal(h.codexCommandEvidence({ ...result.trace, rawItems: [...result.trace.rawItems, ...result.trace.rawItems] }, events, context, before.first_word).actual_read, false);
    assert.equal(h.codexCommandEvidence(result.trace, events, { ...context, timedOut: true }, before.first_word).actual_read, false);
  }
});

test('五条实际写拒绝重算使用CommandExecution cwd；session默认目录不能补足缺证据', async () => {
  const h = await import(path.resolve('scripts/agent-access-evidence.mjs'));
  const root = path.resolve('doc/05_testing/evidence/agent-access-20261010-closeout-r2/routes');
  for (const combination of ['native-sol', 'native-astra', 'qwen', 'kimi', 'deepseek']) {
    const dir = path.join(root, `codex-${combination}-write-1`);
    const read = (name: string) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const result = read('result.json'), events = read('session-events.json');
    const context = { ...result.write_context, cwd: null };
    assert.equal(h.codexCommandEvidence(result.trace, events, context, 'SENTINEL_').write_pass, true, combination);
    const copy = structuredClone(events);
    for (const event of copy) if (event.payload?.item?.type === 'CommandExecution') delete event.payload.item.cwd;
    assert.equal(h.codexCommandEvidence(result.trace, copy, context, 'SENTINEL_').write_pass, false);
  }
});

test('脱敏落盘或凭据清理失败，仍清除夹具和临时凭据目录并汇总错误', async () => {
  const h = await import(path.resolve('scripts/agent-access-selection.mjs'));
  const root = scratchDirSync('trivium-access-cleanup-');
  const credential = path.join(root, 'scratch'), fixture = path.join(root, 'fixture');
  fs.mkdirSync(credential); fs.mkdirSync(fixture);
  fs.writeFileSync(path.join(credential, 'auth.json'), 'artificial fixture');
  const attempted: string[] = [];
  await assert.rejects(h.cleanupAll([
    ['credential-scrub', () => { attempted.push('scrub'); throw Error('injected scrub failure'); }],
    ['credential-evidence', () => { attempted.push('save'); throw Error('injected scan failure'); }],
    ['fixture-cleanup', () => fs.rmSync(fixture, { recursive: true })],
    ['scratch-cleanup', () => fs.rmSync(credential, { recursive: true })],
    ['cleanup-evidence', () => attempted.push('end')],
  ]), (error: any) => error instanceof AggregateError && error.errors.length === 2);
  assert.deepEqual(attempted, ['scrub', 'save', 'end']);
  assert.equal(fs.existsSync(credential), false); assert.equal(fs.existsSync(fixture), false);
  fs.rmSync(root, { recursive: true, force: true });
});
