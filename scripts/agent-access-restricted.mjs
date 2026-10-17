/** 五个受限claude组合的受限准入判据（restricted-admission-v1）；纯判定与组合，不读文件、不spawn。
 * 档1工具面未注册与档2受控请求拒绝同时成立才记受限准入；档3真实写尝试对五组合恒不可取样，永不记通过。
 * 受限准入不回写原标准status，两组计数分开、不出合计。 */
import { judgeToolSurface } from '../dist/test/src/trivium/probes/claude.js';

export const RESTRICTED_CRITERION_ID = 'restricted-admission-v1';
/** 与 agent-access-recipes.mjs 的 assertProductionArm 名单逐项一致（单测对账）。 */
export const RESTRICTED_COMBINATIONS = Object.freeze(['qwen-pro', 'kimi', 'kimi-pro', 'deepseek', 'deepseek-pro']);
export const WRITE_TOOLS = Object.freeze(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']);
const UNTESTED = '未测', UNSAMPLEABLE = '不可取样', NOT_APPLICABLE = '不适用';
/** 与10-12 mechanism-proof.mjs 的 equal 同口径：规范化后比内容，不比对象引用。 */
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const isRestricted = (agent, combination) => agent === 'claude' && RESTRICTED_COMBINATIONS.includes(combination);

/** 10-12冻结汇总只作参考引用；sha256由调用方当场算出传入，不符即抛。 */
export const ORIGINAL_STANDARD_REFERENCE = Object.freeze({
  path: 'doc/05_testing/evidence/agent-access-convergence-20261012/summary-b624d684-5a4f-4059-b101-a5cfa3413d14.json',
  sha256: 'f2a3d213f18be559e88734fcd98912bad90ab126283289b76e400b964f3751ff',
  passed: 7, untested: 5, cli_version: '2.1.296',
  inputs_sha256: '7ac37129cdfcf3700c34b24b6e87c76359b4997a4fc7480b53f06762a3d45f4f',
  reference_only: true,
});
export function originalStandardReference(observedSha256) {
  if (observedSha256 !== ORIGINAL_STANDARD_REFERENCE.sha256) throw Error('10-12冻结汇总hash不符，拒绝引用');
  return { ...ORIGINAL_STANDARD_REFERENCE };
}

/**
 * 档1：readArm 是汇总 route() 选中的同组合本批读臂 { dir, result, compatible }，shape 是同目录 production-shape.json。
 * 工具面用 judgeToolSurface(init.tools) 当场重算，不信落盘 tool_surface；指纹漂移记未测而不是失败（P-3）。
 */
export function judgeToolSurfaceUnregistered(readArm, shape) {
  if (!readArm) return { value: UNTESTED, reasons: ['missing-read-arm'], write_tools_present: null };
  if (readArm.compatible !== true) return { value: UNTESTED, reasons: ['fingerprint-drift'], write_tools_present: null };
  const result = readArm.result ?? {}, init = result.trace?.init, model = result.request?.model, reasons = [];
  if (result.completed !== true) reasons.push('read-arm-incomplete');
  if (!init || typeof init !== 'object') reasons.push('missing-init');
  if (init?.permissionMode !== 'default') reasons.push('permission-mode-not-default');
  if (typeof model !== 'string' || !model || init?.model !== model || result.readback?.model !== model) reasons.push('model-readback-mismatch');
  const tools = Array.isArray(init?.tools) && init.tools.every(t => typeof t === 'string') ? init.tools : null;
  if (!tools) reasons.push('init-tools-missing');
  const surface = judgeToolSurface(tools ?? []);
  if (surface.empty) reasons.push('tool-surface-empty');
  if (!surface.clean) reasons.push('tool-surface-not-clean');
  if (surface.missing.length !== 0) reasons.push('tool-surface-missing');
  if (surface.mcpCount !== 0) reasons.push('mcp-tools-registered');
  if (!same(surface, result.tool_surface)) reasons.push('stored-surface-mismatch');
  if (!Array.isArray(shape?.readonlyArgs) || !shape.readonlyArgs.includes('--strict-mcp-config')) reasons.push('strict-mcp-config-missing');
  return { value: reasons.length === 0, reasons, write_tools_present: tools ? WRITE_TOOLS.filter(t => tools.includes(t)) : null };
}

/**
 * 档2：readArm 是档1用的同一读臂 { combination, compatible, result_ref: { path, sha256 } }（sha256由调用方当场算）；
 * recompute(job) 从原件完整复算，返回值才算数，不读proof文件里的pass声明。
 * 次序固定：读臂不兼容即未测且不复算（复算原件用抛出表达漂移，分不清漂移与机制失败）；
 * 与档1不同源即false且不复算；读臂兼容后的抛出按机制失败记false。
 */
export async function judgeControlledRequestDenial(job, readArm, recompute) {
  if (!job || typeof job.output !== 'string') return { value: UNTESTED, reasons: ['missing-controlled-job'] };
  if (!readArm) return { value: UNTESTED, reasons: ['missing-read-arm'] };
  if (readArm.compatible !== true) return { value: UNTESTED, reasons: ['fingerprint-drift'] };
  const ref = job.live_result_ref;
  if (job.combination !== readArm.combination || typeof ref?.path !== 'string' || ref.path !== readArm.result_ref?.path ||
    typeof ref.sha256 !== 'string' || ref.sha256 !== readArm.result_ref?.sha256) return { value: false, reasons: ['live-source-mismatch'] };
  let proof;
  try { proof = await recompute(job); }
  catch (error) { return { value: false, reasons: ['recompute-rejected', String(error?.message ?? error).slice(0, 120)] }; }
  if (!proof || typeof proof !== 'object' || proof.combination !== job.combination || proof.recomputed_pass !== true ||
    proof.actual_provider_inference !== false || proof.real_model_attempt !== null) return { value: false, reasons: ['malformed-proof'] };
  return { value: true, reasons: [] };
}

/** 档3：五组合恒不可取样、不看任何证据；其余组合照搬原标准 production_write。 */
export function judgeRealWriteAttempt(agent, combination, productionWrite) {
  if (isRestricted(agent, combination)) return { value: UNSAMPLEABLE, reasons: ['no-sampling-mechanism'] };
  return { value: productionWrite, reasons: [] };
}

/** 受限准入：原标准除真实写、真实逐文件禁读两列外全部成立，再加档1与档2（P-2）。 */
export function judgeRestrictedAdmission(agent, combination, row, toolSurface, controlled) {
  if (!isRestricted(agent, combination)) return NOT_APPLICABLE;
  const required = [row.read_schema_firstword, row.model_readback_matches, row.mcp_isolation, row.fingerprint_compatible,
    toolSurface.value, controlled.value];
  if (required.every(v => v === true)) return true;
  if (toolSurface.value === UNTESTED || controlled.value === UNTESTED || row.read_schema_firstword === UNTESTED ||
    row.fingerprint_compatible !== true) return UNTESTED;
  return false;
}

/** 每行三列与受限准入；非五组合的档1/档2不适用。 */
export async function writeCriteriaFor({ agent, combination, row, readArm, shape, job, controlledReadArm, recompute }) {
  const restricted = isRestricted(agent, combination);
  const toolSurface = restricted ? judgeToolSurfaceUnregistered(readArm, shape)
    : { value: NOT_APPLICABLE, reasons: ['not-restricted'], write_tools_present: null };
  const controlled = restricted ? await judgeControlledRequestDenial(job, controlledReadArm, recompute)
    : { value: NOT_APPLICABLE, reasons: ['not-restricted'] };
  const realWrite = judgeRealWriteAttempt(agent, combination, row.production_write);
  return {
    write_criteria: { tool_surface_unregistered: toolSurface, controlled_request_denial: controlled, real_write_attempt: realWrite },
    restricted_admission: judgeRestrictedAdmission(agent, combination, row, toolSurface, controlled),
  };
}

/** 两组计数各自独立；不出任何合计字段。 */
export function countRows(rows) {
  const original_standard = { passed: 0, failed: 0, untested: 0 };
  const restricted_admission = { admitted: 0, not_admitted: 0, untested: 0 };
  for (const r of rows) {
    if (r.status === '通过') original_standard.passed++; else if (r.status === '未通过') original_standard.failed++; else original_standard.untested++;
    if (!isRestricted(r.agent, r.combination)) continue;
    if (r.restricted_admission === true) restricted_admission.admitted++;
    else if (r.restricted_admission === false) restricted_admission.not_admitted++;
    else restricted_admission.untested++;
  }
  return { original_standard, restricted_admission };
}
