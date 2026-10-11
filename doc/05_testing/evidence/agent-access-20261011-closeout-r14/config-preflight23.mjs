/** 私有0600配置快照仅完整语义对账，永不输出全文，用后清除。 */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const {parse}=createRequire(import.meta.url)('yaml');
const root=path.dirname(new URL(import.meta.url).pathname),local=path.join(process.cwd(),'.trivium/config.local.yaml');
const privateFile=path.join(os.homedir(),'.trivium/evidence/agent-access-20261011-closeout-r3/private-config-before23.yaml');
const sha=v=>createHash('sha256').update(v).digest('hex'),mode=process.argv[2];
if(mode==='before'){
 const bytes=fs.readFileSync(local);fs.writeFileSync(privateFile,bytes,{flag:'wx',mode:0o600});
 saveEvidence(root+'/config-before23-preflight.json',{at:new Date().toISOString(),before_sha256:sha(bytes),private_snapshot_mode:fs.statSync(privateFile).mode&0o777,configuration_fulltext_output:false,vendor_cli_starts:0});
}else if(mode==='after'){
 try{
  const before=fs.readFileSync(privateFile),after=fs.readFileSync(local),changes=[];
  function diff(a,b,p=''){
   if(JSON.stringify(a)===JSON.stringify(b))return;
   if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){
    for(const k of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[k],b[k],p?`${p}.${k}`:k);
   }else{const timestamp=/^probe\.auth_routes\.[a-f0-9]{64}\.checked_at$/.test(p);changes.push({path:p,before_value_sha256:sha(JSON.stringify(a)??'undefined'),after_value_sha256:sha(JSON.stringify(b)??'undefined'),...(timestamp?{before_checked_at:a??null,after_checked_at:b??null}:{})})}
  }
  diff(parse(before.toString()),parse(after.toString()));
  const onlyCache=changes.every(c=>/^probe\.auth_routes\.[a-f0-9]{64}\.checked_at$/.test(c.path));
  fs.unlinkSync(privateFile);
  saveEvidence(root+'/config-after23-preflight-observation.json',{at:new Date().toISOString(),before_sha256:sha(before),current_sha256:sha(after),complete_semantic_diff:changes,only_auth_cache_checked_at_changed:onlyCache,models_effort_globals_changed:!onlyCache,full_fingerprint_reuse:false,private_snapshot_removed:true,configuration_fulltext_output:false,vendor_cli_starts:0});
  if(!onlyCache)throw Error('预检改变缓存时间以外配置，停止审查待分析');
 }finally{if(fs.existsSync(privateFile))fs.unlinkSync(privateFile)}
}else throw Error('未知采样操作');
