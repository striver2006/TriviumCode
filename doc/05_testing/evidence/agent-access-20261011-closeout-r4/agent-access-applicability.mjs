/** r14获批只读诊断；没有准入判据采用层，绝不改原matrix/canonical或恢复旧通过列。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const stamp=/define_TRIVIUM_BUILD_default = \{ repo_root_commit: "[a-f0-9]{40}", git_head: "[a-f0-9]{40}", dirty: (?:true|false), inputs_sha256: "[a-f0-9]{64}", built_at: "[0-9TZ:.+-]+" \};/g;

/** 只接受唯一精确构建声明；其余所有字节（包括注释/空白）均保留。 */
export function compareCompiledBytes(oldBytes,currentBytes) {
  const normalize=b=>{const s=b.toString('utf8'),matches=[...s.matchAll(stamp)];
    if(matches.length!==1||!Buffer.from(s).equals(b))throw Error('唯一构建声明或UTF8边界不成立');
    return Buffer.from(s.replace(stamp,'<TRIVIUM_BUILD_STAMP>'));};
  const oldNormalized=normalize(oldBytes),currentNormalized=normalize(currentBytes);
  return {old_full_sha256:sha(oldBytes),current_full_sha256:sha(currentBytes),
    normalization:'exact-single-build-declaration-placeholder:<TRIVIUM_BUILD_STAMP>;all-other-bytes-preserved',
    old_compiled_sha256:sha(oldNormalized),current_compiled_sha256:sha(currentNormalized),
    compiled_bytes_equal:oldNormalized.equals(currentNormalized),full_bytes_equal:oldBytes.equals(currentBytes)};
}

/** 诊断不消费审批；任何输入均不能产生current_admission_accepted=true。 */
export function diagnoseHistoricalPair(pair,checks) {
  const reasons=[];
  if(!checks.source_files_verified)reasons.push('source-files-missing-or-hash-mismatch');
  if(!checks.compiled_bytes_equal)reasons.push('compiled-business-bytes-different-or-unknown');
  if(pair.invariantDifferences?.length!==0)reasons.push('route-bindings-different-or-unknown');
  const differences=pair.fingerprintDifferences;
  if(!Array.isArray(differences)||differences.length!==1||differences[0]?.field!=='assets.skills/dual-critic/scripts/trivium.cjs')reasons.push('full-fingerprint-differences-outside-build');
  if(!pair.old_completed||!pair.current_completed)reasons.push('selected-arm-incomplete');
  if(!pair.old_readback?.model||pair.old_readback.model!==pair.current_readback?.model)reasons.push('actual-model-mismatch-or-unknown');
  if(!checks.old_actual_mechanism_proven)reasons.push('old-actual-paired-mechanism-not-proven');
  const historical= reasons.length===0;
  // 全上下文inventory未取得，不把编译字节相同升级成模型环境相同；也不借普通审批采用准入。
  reasons.push('context-assets-inventory-or-consumption-unknown','independent-criterion-approval-absent');
  return {key:pair.key,old_variant:pair.old_variant,current_variant:pair.current_variant,
    diagnostic_status:historical?'historical-mechanism-only':'not-applicable',approval_record:null,
    criteria_version:null,candidate_version:'component-scoped-evidence-v1-not-adopted',
    current_admission_accepted:false,current_original_status:'未测',differences:differences??null,
    reasons,server_identity:null,canonical_full_fingerprint_requirement_unchanged:true};
}

export function produceDiagnostic(repo=process.cwd()) {
  const root=path.dirname(fileURLToPath(import.meta.url)),prior=path.join(repo,'doc/05_testing/evidence/agent-access-20261011-closeout-r3');
  const audit=JSON.parse(fs.readFileSync(path.join(root,'static-audit-before-round9.json')));
  const checked=name=>{const b=fs.readFileSync(path.join(root,name)),entry=audit.files.find(f=>f.name===name);
    if(!entry||entry.sha256!==sha(b))throw Error('冻结静态证据hash不符：'+name);return JSON.parse(b);};
  const comparison=checked('component-evidence-scope-comparison.json'),build=checked('build-stamp-only-comparison.json');
  const oldBytes=fs.readFileSync(build.old_file),currentBytes=fs.readFileSync(build.new_file);
  const bundles=compareCompiledBytes(oldBytes,currentBytes);
  if(bundles.old_full_sha256!==build.old_sha256||bundles.current_full_sha256!==build.new_sha256)throw Error('当前或旧bundle已变化；不能选择另一成功');
  const matrixNames=['matrix-r12-pre-code.json','matrix-r12-code-nits.json'];
  const matrices=matrixNames.map((name,i)=>{const b=fs.readFileSync(path.join(prior,name));
    if(sha(b)!==(i?comparison.current_matrix_sha256:comparison.old_matrix_sha256))throw Error('显式matrix来源hash漂移');return JSON.parse(b);});
  const keys=['claude-kimi-deny-read','claude-deepseek-pro-write','codex-native-luna-write'];
  const rows=keys.map(key=>{
    const pairs=comparison.comparisons.filter(c=>c.key===key);if(pairs.length!==1)throw Error('具名臂缺失或重复');const pair=pairs[0];
    const arms=matrices.map((m,i)=>{const selected=m.arm_details.filter(a=>a.key===key);if(selected.length!==1)throw Error('显式矩阵臂不唯一');
      const arm=selected[0],expected=i?pair.current_variant:pair.old_variant;
      if(arm.reference?.variant!==expected)throw Error('显式variant不符');
      for(const filename of ['requested.json','result.json','fingerprints-after.json']){
        const b=fs.readFileSync(path.join(m.dynamic_root,'routes',`${key}-${expected}`,filename));
        if(sha(b)!==arm.reference[filename])throw Error('实际所选臂来源hash漂移');
      }
      return arm;});
    const oldMechanism=key==='claude-kimi-deny-read'?arms[0].deny_pass===true&&
      arms[0].per_file_deny?.some(p=>p.path==='.env'&&p.attempts?.length===1):arms[0].write_pass===true;
    return {...diagnoseHistoricalPair(pair,{source_files_verified:true,compiled_bytes_equal:bundles.compiled_bytes_equal,
      old_actual_mechanism_proven:oldMechanism}),source_references:arms.map(a=>a.reference),
      old_actual_mechanism_proven:oldMechanism,current_original_sample:{write_pass:arms[1].write_pass,deny_pass:arms[1].deny_pass,
        env_read_attempts:arms[1].per_file_deny?.find(p=>p.path==='.env')?.attempts?.length??null}};
  });
  return {recorded_at:new Date().toISOString(),schema:'trivium.access.applicability.diagnostic.v1',real_cli_starts:0,
    criterion_adopted:false,approval_record:null,current_admission_accepted:false,full_fingerprints_equal:false,bundles,rows,
    source_matrix_hashes:[comparison.old_matrix_sha256,comparison.current_matrix_sha256],
    producer_canonical_hashes:matrices.map(m=>m.canonical_sha256),original_matrix_unchanged:true,
    restricted_candidate:{adopted:false,current_original_write_status:'未测',
      controlled_deviations:['native-bypasses-profile-wrapper','independent-HOME/config','local-provider-transport','artificial-credential'],
      production_same_shape_proven:false,reason:'现有受控机制不满足全路线同形，缺桥接证据不能采用'},m11_prerequisite_complete:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(produceDiagnostic(),null,2));
}
