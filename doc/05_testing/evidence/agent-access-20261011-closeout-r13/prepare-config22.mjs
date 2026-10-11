/** v21私有配置语义采样的同构副本，仅改轮次/文件名。 */
import fs from'node:fs';import path from'node:path';
import{hash}from'../../../../scripts/agent-access-selection.mjs';import{saveEvidence}from'../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),source=path.resolve(root,'../agent-access-20261011-closeout-r12/config-preflight21.mjs'),target=root+'/config-preflight22.mjs';
const text=fs.readFileSync(source,'utf8').replaceAll('before21','before22').replaceAll('after21','after22');fs.writeFileSync(target,text,{flag:'wx',mode:0o600});
saveEvidence(root+'/config22-derivation.json',{source,source_sha256:hash(source),target,target_sha256:hash(target),changes:['采样轮次和独立文件名'],semantic_comparison_unchanged:true,new_vendor_starts:0});
