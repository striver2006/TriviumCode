/** 当前准入的显式选择契约。新请求未完成不能退回旧成功；不扫描最大成功编号。 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
export const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
export function loadSelection(file) {
  if (!file) throw Error('缺显式批次manifest；不得隐式引用variant1或最新成功');
  const manifest = read(file);
  if (manifest.schema !== 'trivium.access.selection.v1' || !manifest.routes || !manifest.versions) throw Error('批次manifest形状无效');
  return { manifest, file: path.resolve(file), sha256: hash(file) };
}
export function selectedEvidence(root, selection, key, kind = 'routes') {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) throw Error('证据key无效');
  const ref = selection.manifest[kind]?.[key];
  if (ref === undefined || ref === null) return null; // 显式未测；不寻找其它目录。
  if (!Number.isSafeInteger(ref.variant) || ref.variant < 1) throw Error(`${key}: variant无效`);
  const dir = path.join(root, 'routes', `${key}-${ref.variant}`);
  const files = ['requested.json', 'result.json', 'fingerprints-after.json'];
  const values = {};
  for (const file of files) {
    const full = path.join(dir, file);
    if (!fs.existsSync(full)) return { dir, ref, complete: false, missing: file, selection: selection.file };
    if (typeof ref[file] !== 'string' || hash(full) !== ref[file]) throw Error(`${key}: ${file}引用hash不符`);
    values[file] = read(full);
  }
  const request = values['requested.json'];
  if (`${request.agent}-${request.combination}-${request.arm}` !== key || request.variant !== ref.variant) throw Error(`${key}: 请求身份不符`);
  return { dir, ref, complete: values['result.json'].completed === true,
    request, result: values['result.json'], after: values['fingerprints-after.json'], selection: selection.file };
}
export function selectedVersion(root, selection, routeKey, currentFingerprints, ledgerRoot = root) {
  const evidence = selectedEvidence(root, selection, `static-${routeKey}-version`, 'versions');
  if (!evidence?.complete || evidence.after?.unchanged !== true) throw Error(`${routeKey}: 所选版本证据缺失、未完成或漂移`);
  let native = null;
  const comparison = { ...currentFingerprints };
  if (routeKey === 'codex') {
    if (!evidence.result.native_version_reference) throw Error('Codex缺显式native版本引用');
    native = nativeVersionFromLedger(ledgerRoot, path.join(evidence.dir, 'requested.json'), evidence.result.native_version_reference);
    if (currentFingerprints.native_entry !== native.entry_sha256) throw Error('Codex当前native入口hash不符');
    comparison.native_entry = evidence.request.fingerprints.native_entry;
  }
  if (JSON.stringify(evidence.request.fingerprints) !== JSON.stringify(comparison)) throw Error(`${routeKey}: 所选版本入口/包装器/配置/源码指纹不符`);
  const version = evidence.result.version ?? /(\d+\.\d+\.\d+(?:-[\w.-]+)?)/.exec(evidence.result.stdout ?? '')?.[1];
  if (typeof version !== 'string' || !version) throw Error(`${routeKey}: 未取得CLI版本`);
  return { version, native_entry: native?.entry ?? null, reference: { dir: evidence.dir, ...evidence.ref,
    native_version_reference: native, manifest: selection.file, manifest_sha256: selection.sha256 } };
}

/** 只绑定同一版本请求的成功native实际启动；显式引用不能回退扫描其它版本。 */
export function nativeVersionFromLedger(root, requestFile, reference) {
  const request = read(requestFile);
  const dir = path.join(root, 'ledger', 'admission');
  const records = fs.readdirSync(dir).filter(n => /^launch-\d{4}\.json$/.test(n)).map(file => ({ file, value: read(path.join(dir, file)) }))
    .filter(r => r.value.fingerprint_manifest === path.resolve(requestFile) && r.value.kind === 'version' && r.value.cli === 'codex');
  const children = records.filter(r => r.value.boundary_parent && r.value.spawned === true && r.value.code === 0 &&
    r.value.signal === null && r.value.error_code === null);
  if (children.length !== 1) throw Error('Codex版本native实际子边界缺失或歧义');
  const child = children[0], native = child.value;
  const parents = records.filter(r => `codex:${r.value.parent_pid}:${r.value.index}` === native.boundary_parent &&
    r.value.spawned === true && r.value.code === 0 && r.value.signal === null && r.value.error_code === null &&
    Number.isSafeInteger(r.value.pid) && r.value.pid === native.parent_pid && r.value.entry === request.entry);
  if (parents.length !== 1 || typeof native.entry !== 'string' || !path.isAbsolute(native.entry) ||
    native.entry === request.entry || hash(native.entry) !== native.entry_sha256 || hash(request.entry) !== parents[0].value.entry_sha256) {
    throw Error('Codex版本native入口/父边界/hash未证实');
  }
  const observed = { request_sha256: hash(requestFile), native_ledger: child.file, native_ledger_sha256: hash(path.join(dir, child.file)),
    parent_ledger: parents[0].file, parent_ledger_sha256: hash(path.join(dir, parents[0].file)), entry: native.entry, entry_sha256: native.entry_sha256 };
  if (reference !== undefined && JSON.stringify(reference) !== JSON.stringify(observed)) throw Error('Codex显式native版本引用不符');
  return observed;
}
/** 任一清理/证据落盘失败也继续其余项；所有失败必须可见。 */
export async function cleanupAll(steps) {
  const results = [];
  for (const [name, action] of steps) {
    try { results.push({ name, ok: true, value: await action() }); }
    catch (error) { results.push({ name, ok: false, error: String(error?.code ?? error?.name ?? 'cleanup-error') }); }
  }
  if (results.some(r => !r.ok)) throw new AggregateError(results.filter(r => !r.ok).map(r => Error(`${r.name}:${r.error}`)), '独立清理失败', { cause: results });
  return results;
}
