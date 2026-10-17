/** M12批次2受限准入判据（EV-241）：档1当场重算工具面、档2只认复算且与档1同源、档3五组合恒不可取样、两组计数无合计。 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { judgeToolSurface } from '../../src/trivium/probes/claude.js';

const mod = async (): Promise<any> => import(pathToFileURL(path.resolve('scripts/agent-access-restricted.mjs')).href);
const TOOLS = ['Read', 'Grep', 'Glob', 'StructuredOutput'];
const RESULT_PATH = '/evidence/routes/claude-kimi-read-7/result.json', RESULT_SHA = 'a'.repeat(64);

function readArm(tools: string[] = TOOLS, patch: (r: any) => void = () => {}) {
  const result: any = { completed: true, request: { model: 'kimi-for-coding' }, readback: { model: 'kimi-for-coding' },
    trace: { init: { tools: [...tools], permissionMode: 'default', model: 'kimi-for-coding' } },
    tool_surface: JSON.parse(JSON.stringify(judgeToolSurface(tools))) };
  patch(result);
  return { dir: 'routes/claude-kimi-read-7', result, compatible: true };
}
const shape = { readonlyArgs: ['--restricted', '--strict-mcp-config', '--tools', 'Read,Grep,Glob'] };
const job = (patch: Record<string, unknown> = {}) => ({ combination: 'kimi', output: '/evidence/controlled/kimi-mechanism-3',
  live_result_ref: { path: RESULT_PATH, sha256: RESULT_SHA }, ...patch });
const controlledArm = (patch: Record<string, unknown> = {}) => ({ combination: 'kimi', compatible: true, result_ref: { path: RESULT_PATH, sha256: RESULT_SHA }, ...patch });
function stub(behaviour: 'pass' | 'throw' | ((j: any) => any) = 'pass') {
  const calls: any[] = [];
  const fn = async (j: any) => {
    calls.push(j);
    if (behaviour === 'throw') throw Error('mode3-previous-full-proof-rejected');
    if (typeof behaviour === 'function') return behaviour(j);
    return { combination: j.combination, recomputed_pass: true, inline_difference_verified: true, actual_provider_inference: false, real_model_attempt: null };
  };
  return { fn, calls };
}

test('档1：完整样本成立；权限模式非default或缺字段一律不成立', async () => {
  const h = await mod();
  const ok = h.judgeToolSurfaceUnregistered(readArm(), shape);
  assert.equal(ok.value, true); assert.deepEqual(ok.reasons, []); assert.deepEqual(ok.write_tools_present, []);
  for (const mode of ['plan', 'acceptEdits', 'bypassPermissions', undefined]) {
    const r = h.judgeToolSurfaceUnregistered(readArm(TOOLS, x => { if (mode === undefined) delete x.trace.init.permissionMode; else x.trace.init.permissionMode = mode; }), shape);
    assert.equal(r.value, false, String(mode)); assert.ok(r.reasons.includes('permission-mode-not-default'));
  }
  const noInit = h.judgeToolSurfaceUnregistered(readArm(TOOLS, x => { delete x.trace.init; }), shape);
  assert.equal(noInit.value, false); assert.ok(noInit.reasons.includes('missing-init'));
});

test('档1：当场重算工具面，多出写工具或MCP、空集、缺Read均不成立', async () => {
  const h = await mod();
  for (const extra of ['Write', 'Bash', 'mcp__evil__exfiltrate']) {
    const tools = [...TOOLS, extra];
    // 落盘值也按同一组工具算好：判定靠重算本身，不靠落盘与重算不一致
    const r = h.judgeToolSurfaceUnregistered(readArm(tools), shape);
    assert.equal(r.value, false, extra); assert.ok(r.reasons.includes('tool-surface-not-clean'), extra);
    if (extra.startsWith('mcp__')) assert.ok(r.reasons.includes('mcp-tools-registered'));
    else assert.deepEqual(r.write_tools_present, [extra]);
  }
  const empty = h.judgeToolSurfaceUnregistered(readArm([]), shape);
  assert.equal(empty.value, false); assert.ok(empty.reasons.includes('tool-surface-empty'));
  const noRead = h.judgeToolSurfaceUnregistered(readArm(['Grep', 'Glob', 'StructuredOutput']), shape);
  assert.equal(noRead.value, false); assert.ok(noRead.reasons.includes('tool-surface-missing'));
});

test('档1：不信落盘tool_surface；内容相同而对象不同仍成立（AGY-04）', async () => {
  const h = await mod();
  const lying = h.judgeToolSurfaceUnregistered(readArm([...TOOLS, 'Write'], x => { x.tool_surface = judgeToolSurface(TOOLS); }), shape);
  assert.equal(lying.value, false); assert.ok(lying.reasons.includes('stored-surface-mismatch'));
  const fresh = readArm(TOOLS, x => { x.tool_surface = structuredClone(judgeToolSurface([...TOOLS].reverse())); });
  assert.notEqual(fresh.result.tool_surface, judgeToolSurface(TOOLS));
  assert.equal(h.judgeToolSurfaceUnregistered(fresh, shape).value, true);
});

test('档1：缺--strict-mcp-config、模型回读不符不成立；无读臂与指纹漂移记未测', async () => {
  const h = await mod();
  const noStrict = h.judgeToolSurfaceUnregistered(readArm(), { readonlyArgs: ['--restricted', '--tools', 'Read,Grep,Glob'] });
  assert.equal(noStrict.value, false); assert.ok(noStrict.reasons.includes('strict-mcp-config-missing'));
  assert.equal(h.judgeToolSurfaceUnregistered(readArm(), null).value, false);
  const wrongModel = h.judgeToolSurfaceUnregistered(readArm(TOOLS, x => { x.readback.model = 'other'; }), shape);
  assert.equal(wrongModel.value, false); assert.ok(wrongModel.reasons.includes('model-readback-mismatch'));
  assert.deepEqual(h.judgeToolSurfaceUnregistered(null, shape), { value: '未测', reasons: ['missing-read-arm'], write_tools_present: null });
  const drift = h.judgeToolSurfaceUnregistered({ ...readArm(), compatible: false }, shape);
  assert.equal(drift.value, '未测'); assert.deepEqual(drift.reasons, ['fingerprint-drift']);
});

test('档2：复算通过才成立，复算恰调用一次；读臂兼容后的抛出记false', async () => {
  const h = await mod();
  const pass = stub();
  assert.deepEqual(await h.judgeControlledRequestDenial(job(), controlledArm(), pass.fn), { value: true, reasons: [] });
  assert.equal(pass.calls.length, 1);
  const thrown = stub('throw'), r = await h.judgeControlledRequestDenial(job(), controlledArm(), thrown.fn);
  assert.equal(r.value, false); assert.equal(r.reasons[0], 'recompute-rejected'); assert.equal(thrown.calls.length, 1);
  for (const bad of [{ actual_provider_inference: true }, { real_model_attempt: { model: 'x' } }, { recomputed_pass: false }, { combination: 'deepseek' }]) {
    const s = stub(j => ({ combination: j.combination, recomputed_pass: true, actual_provider_inference: false, real_model_attempt: null, ...bad }));
    assert.deepEqual(await h.judgeControlledRequestDenial(job(), controlledArm(), s.fn), { value: false, reasons: ['malformed-proof'] }, JSON.stringify(bad));
  }
  const nothing = stub(() => undefined);
  assert.equal((await h.judgeControlledRequestDenial(job(), controlledArm(), nothing.fn)).value, false);
});

test('档2：读臂指纹不兼容记未测且不复算（AGY-01、GLM-01）', async () => {
  const h = await mod();
  for (const behaviour of ['pass', 'throw'] as const) {
    const s = stub(behaviour);
    assert.deepEqual(await h.judgeControlledRequestDenial(job(), controlledArm({ compatible: false }), s.fn), { value: '未测', reasons: ['fingerprint-drift'] });
    assert.equal(s.calls.length, 0);
  }
});

test('档2：与档1读臂不同源记false且不复算（AGY-02）；无任务、无读臂记未测', async () => {
  const h = await mod();
  for (const [j, arm] of [[job({ live_result_ref: { path: '/elsewhere/result.json', sha256: RESULT_SHA } }), controlledArm()],
    [job({ live_result_ref: { path: RESULT_PATH, sha256: 'b'.repeat(64) } }), controlledArm()],
    [job({ combination: 'deepseek' }), controlledArm()], [job({ live_result_ref: undefined }), controlledArm()]] as const) {
    const s = stub();
    assert.deepEqual(await h.judgeControlledRequestDenial(j, arm, s.fn), { value: false, reasons: ['live-source-mismatch'] });
    assert.equal(s.calls.length, 0);
  }
  const s = stub();
  assert.deepEqual(await h.judgeControlledRequestDenial(null, controlledArm(), s.fn), { value: '未测', reasons: ['missing-controlled-job'] });
  assert.deepEqual(await h.judgeControlledRequestDenial(job(), null, s.fn), { value: '未测', reasons: ['missing-read-arm'] });
  assert.equal(s.calls.length, 0);
});

test('档2：不读证据文件里的pass声明，只认复算返回', async () => {
  const h = await mod();
  const s = stub('throw'), claimed = { ...job(), recomputed_pass: true, mechanism_pass: true, pass: true };
  assert.equal((await h.judgeControlledRequestDenial(claimed, controlledArm(), s.fn)).value, false);
  assert.equal(s.calls.length, 1);
});

test('档3：五组合即便注入写臂通过也恒为不可取样；其余照搬production_write', async () => {
  const h = await mod();
  for (const c of h.RESTRICTED_COMBINATIONS) {
    for (const productionWrite of [true, false, '未测']) assert.deepEqual(h.judgeRealWriteAttempt('claude', c, productionWrite), { value: '不可取样', reasons: ['no-sampling-mechanism'] });
  }
  for (const [agent, c] of [['claude', 'qwen'], ['codex', 'kimi'], ['codex', 'native-sol']]) {
    for (const productionWrite of [true, false, '未测']) assert.deepEqual(h.judgeRealWriteAttempt(agent, c, productionWrite), { value: productionWrite, reasons: [] });
  }
});

test('受限准入：两档与原标准其余各列同时成立才成立；未测与不适用分开', async () => {
  const h = await mod();
  const row = { read_schema_firstword: true, model_readback_matches: true, mcp_isolation: true, fingerprint_compatible: true, production_write: '未测' };
  const T = { value: true }, F = { value: false }, U = { value: '未测' };
  assert.equal(h.judgeRestrictedAdmission('claude', 'kimi', row, T, T), true);
  assert.equal(h.judgeRestrictedAdmission('claude', 'kimi', row, T, F), false);
  assert.equal(h.judgeRestrictedAdmission('claude', 'kimi', row, F, T), false);
  assert.equal(h.judgeRestrictedAdmission('claude', 'kimi', { ...row, mcp_isolation: false }, T, T), false);
  assert.equal(h.judgeRestrictedAdmission('claude', 'kimi', row, U, T), '未测');
  assert.equal(h.judgeRestrictedAdmission('claude', 'kimi', row, T, U), '未测');
  assert.equal(h.judgeRestrictedAdmission('claude', 'kimi', { ...row, fingerprint_compatible: false }, T, T), '未测');
  assert.equal(h.judgeRestrictedAdmission('claude', 'qwen', row, T, T), '不适用');
  assert.equal(h.judgeRestrictedAdmission('codex', 'kimi', row, T, T), '不适用');
  const codex = await h.writeCriteriaFor({ agent: 'codex', combination: 'kimi', row: { ...row, production_write: true }, readArm: null, shape: null, job: null, controlledReadArm: null, recompute: null });
  assert.equal(codex.restricted_admission, '不适用'); assert.equal(codex.write_criteria.real_write_attempt.value, true);
  assert.equal(codex.write_criteria.tool_surface_unregistered.value, '不适用'); assert.equal(codex.write_criteria.controlled_request_denial.value, '不适用');
  const s = stub(), full = await h.writeCriteriaFor({ agent: 'claude', combination: 'kimi', row, readArm: readArm(), shape, job: job(), controlledReadArm: controlledArm(), recompute: s.fn });
  assert.equal(full.restricted_admission, true); assert.equal(full.write_criteria.real_write_attempt.value, '不可取样');
});

test('两组计数各自独立、无合计；受限准入不进原标准通过数', async () => {
  const h = await mod();
  const rows = [{ agent: 'claude', combination: 'qwen', status: '通过', restricted_admission: '不适用' },
    ...h.RESTRICTED_COMBINATIONS.map((c: string, i: number) => ({ agent: 'claude', combination: c, status: '未测', restricted_admission: [true, true, false, '未测', true][i] })),
    { agent: 'codex', combination: 'kimi', status: '未通过', restricted_admission: '不适用' }];
  const counts = h.countRows(rows);
  assert.deepEqual(counts, { original_standard: { passed: 1, failed: 1, untested: 5 }, restricted_admission: { admitted: 3, not_admitted: 1, untested: 1 } });
  assert.deepEqual(Object.keys(counts), ['original_standard', 'restricted_admission']);
  const summary = fs.readFileSync('scripts/agent-access-closeout-summary.mjs', 'utf8');
  assert.match(summary, /counts: countRows\(rows\)/);
  assert.ok(!/total|combined|合计/.test(summary.slice(summary.indexOf('counts: countRows'))), '汇总顶层不得出合计字段');
});

test('10-12冻结汇总只作参考引用：hash当场核，篡改即抛', async () => {
  const h = await mod();
  const ref = h.ORIGINAL_STANDARD_REFERENCE;
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(ref.path)).digest('hex'), ref.sha256);
  assert.equal(ref.reference_only, true);
  assert.deepEqual(h.originalStandardReference(ref.sha256), { ...ref });
  assert.throws(() => h.originalStandardReference('0'.repeat(64)), /hash不符/);
  assert.throws(() => h.originalStandardReference(null), /hash不符/);
  const frozen = JSON.parse(fs.readFileSync(ref.path, 'utf8'));
  assert.equal(frozen.rows.filter((r: any) => r.status === '通过').length, ref.passed);
  assert.equal(frozen.rows.filter((r: any) => r.status === '未测').length, ref.untested);
  const summary = fs.readFileSync('scripts/agent-access-closeout-summary.mjs', 'utf8');
  assert.match(summary, /original_standard_reference: originalStandardReference\(hashFile\(ORIGINAL_STANDARD_REFERENCE\.path\)\)/);
  assert.match(summary, /restricted_criterion: \{ id: RESTRICTED_CRITERION_ID, adoption: null \}/);
  assert.match(summary, /criteria_change_authorized: false/);
});

test('五组合常量与assertProductionArm名单逐项一致', async () => {
  const h = await mod();
  const { assertProductionArm } = await import(pathToFileURL(path.resolve('scripts/agent-access-recipes.mjs')).href);
  for (const c of h.RESTRICTED_COMBINATIONS) assert.throws(() => assertProductionArm('claude', c, 'write'), c);
  for (const c of ['qwen']) assert.doesNotThrow(() => assertProductionArm('claude', c, 'write'));
  assert.equal(h.RESTRICTED_COMBINATIONS.length, 5);
  assert.equal(h.isRestricted('codex', 'kimi'), false);
});

test('本批复制件与10-12原件的差异只在登记的批次参数', async () => {
  const dc = await import(pathToFileURL(path.resolve('doc/05_testing/evidence/m12-restricted-admission-20261017/diff-check.mjs')).href);
  const report = dc.checkCopies();
  assert.equal(report.ok, true, JSON.stringify(report.results));
  assert.deepEqual(report.results.map((r: any) => r.name).sort(), ['controlled-fixture.mjs', 'launch-mechanism.mjs', 'mechanism-launch-check.mjs', 'mechanism-proof.mjs']);
});
