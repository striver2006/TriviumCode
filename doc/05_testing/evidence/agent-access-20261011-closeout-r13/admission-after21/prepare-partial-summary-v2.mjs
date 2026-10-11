/** 部分矩阵辅助件：未启动臂没有cleanup文件，明确null；原汇总首失败保留。 */
import fs from'node:fs';import path from'node:path';
import{hash}from'/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-selection.mjs';
import{saveEvidence}from'/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),source=root+'/summarize-after21-mature-partial.mjs',target=root+'/summarize-after21-mature-partial-v2.mjs',old="cleanup: e ? read(path.join(e.dir, 'cleanup.json')) : null",next="cleanup: e && fs.existsSync(path.join(e.dir, 'cleanup.json')) ? read(path.join(e.dir, 'cleanup.json')) : null";
const before=fs.readFileSync(source,'utf8');if(before.split(old).length!==2)throw Error('cleanup精确派生锚无效');
saveEvidence(root+'/partial-summary-first-failure.json',{observed_at:new Date().toISOString(),source,source_sha256:hash(source),code:1,error_code:'ENOENT',path:'/Users/chenzhenbo/.trivium/evidence/agent-access-20261011-closeout-r3/routes/claude-qwen-deny-grep-5/cleanup.json',cause:'原汇总假设显式选择的未启动臂也有cleanup.json；部分停批并无此文件',vendor_cli_starts:0,matrix_not_published:true,first_source_preserved:true});
fs.writeFileSync(target,before.replace(old,next),{flag:'wx',mode:0o600});
saveEvidence(root+'/partial-summary-v2-derivation.json',{source,source_sha256:hash(source),target,target_sha256:hash(target),changes:['未启动cleanup缺失记null'],acceptance_algorithm_unchanged:true,original_failure_preserved:true,new_vendor_starts:0});
console.log(JSON.stringify({target,new_vendor_starts:0}));
