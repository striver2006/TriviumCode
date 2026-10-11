/** 原汇总算法不改判据；独立保存精确选择、原件副本、结构化降级及作用边界。 */
import fs from 'node:fs';import path from 'node:path';
import { saveEvidence } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
import { hash } from '/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-selection.mjs';
import { scanSecrets } from '/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/secrets.js';
const root=path.dirname(new URL(import.meta.url).pathname),batch=JSON.parse(fs.readFileSync(root+'/read-deny-batch.json')),routes={},details=[],copies=[];
for(const [combination,readVariant]of [['qwen',5],['native-luna',4]])for(const arm of ['read','write','deny']){
 const key='codex-'+combination+'-'+arm,variant=arm==='write'?5:readVariant,dir=batch.evidence_root+'/routes/'+key+'-'+variant;
 const r=JSON.parse(fs.readFileSync(dir+'/result.json')),a=JSON.parse(fs.readFileSync(dir+'/fingerprints-after.json')),c=JSON.parse(fs.readFileSync(dir+'/cleanup.json'));
 if(r.completed!==true||a.unchanged!==true||c.fixture_residue!==null||c.scratch_removed!==true)throw Error('指定臂未完整结束/指纹变化/清理不齐');
 routes[key]={variant,...Object.fromEntries(['requested.json','result.json','fingerprints-after.json'].map(n=>[n,hash(dir+'/'+n)]))};
 const destination=root+'/routes/'+key+'-'+variant;fs.mkdirSync(destination,{recursive:true});
 for(const n of fs.readdirSync(dir)){
  const source=dir+'/'+n;if(!fs.statSync(source).isFile())throw Error('原件非单层文件');
  const bytes=fs.readFileSync(source);if(scanSecrets(bytes.toString('utf8')).length)throw Error('原件扫描非零，停止复制');
  const target=destination+'/'+n;fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});if(hash(source)!==hash(target))throw Error('原件副本hash不符');
  copies.push({source,target,sha256:hash(target),bytes:bytes.length});
 }
 details.push({key,completed:r.completed,model_requested:r.request.model,model_readback:r.readback,structured_ok:r.structured.ok,structured_degraded:r.structured.degraded??null,structured_failure:r.structured.ok===false?{cause:r.structured.cause,reason:r.structured.reason}:null,actual_read:r.actual_read,write_pass:r.write_pass,read_content_diagnostic:r.read_content_diagnostic??null,write_contract_diagnostic:r.write_contract_diagnostic??null,forbidden_read_detection:r.forbidden_read_detection,mcp_calls:r.mcp_calls,cleanup:c,scope:arm==='deny'?'原Codex deny配方要求完整结果而未要求JSON；验证事后检测命中，不能声称CLI阻止读取或本臂结构化成功':arm==='write'?'原生产写标准，合同来源诊断单列，解析降级原样保留':'原实际读取/严格首词/Schema要求，全文匹配诊断单列'});
}
saveEvidence(root+'/selection-after21-first.json',{schema:'trivium.access.selection.v1',created_at:new Date().toISOString(),versions:{},routes,original_criteria_unchanged:true,implicit_fallback:false});
saveEvidence(root+'/after21-first-arm-details.json',{at:new Date().toISOString(),details,copies,criteria_changed:false,goal_complete:false,official_claude:'未测：订阅待恢复',remaining_claude_write:'五个非flash写仍无新机制，禁止提示重试；原标准列保留未测',current_full_fingerprint_new_other_combinations:'未测，不追认历史组合通过'});
const source='/Users/chenzhenbo/.trivium/evidence/agent-access-20261011-closeout-r3/admission-after18-c912bce7/summarize-after18.mjs';
let text=fs.readFileSync(source,'utf8').replace("const filename = 'matrix-after18.json';","const filename = 'matrix-after21-first.json';");
const old=/configuration_changes: '本批不改配置\/模型\/effort；18C[^\n]*'/;
if(!old.test(text))throw Error('历史描述取址失败');
text=text.replace(old,"configuration_changes: '本批不改配置/模型/effort；21C认证回填后4c87本机配置，最终77337038清洁cd94包；先写8及读/禁读8均按wrapper/native计数，不消费旧完整包组合通过'");
text=text.replace("summary.canonical_parent_sha256 =", "summary.derivation_source = "+JSON.stringify(source)+";\nsummary.derivation_source_sha256 = "+JSON.stringify(hash(source))+";\nsummary.current_details = 'after21-first-arm-details.json';\nsummary.canonical_parent_sha256 =");
const target=root+'/summarize-after21-first.mjs';fs.writeFileSync(target,text,{flag:'wx',mode:0o600});
saveEvidence(root+'/after21-summary-derivation.json',{source,source_sha256:hash(source),target,target_sha256:hash(target),changes:['输出文件名','当前配置描述','来源谱系和补充证据引用'],acceptance_algorithm_unchanged:true,extra_details_sha256:hash(root+'/after21-first-arm-details.json'),new_vendor_starts:0});
console.log(JSON.stringify({selected_arms:details.length,copies:copies.length,summary_script:target,new_vendor_starts:0}));
