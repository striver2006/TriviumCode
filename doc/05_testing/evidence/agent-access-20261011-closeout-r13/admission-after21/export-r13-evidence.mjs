/** 本批独立副本：逐字hash/凭据扫描，保留首次辅助失败与所有CLI原件。 */
import fs from'node:fs';import path from'node:path';
import{hash}from'/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-selection.mjs';
import{saveEvidence}from'/Users/chenzhenbo/Work/TriviumCode/scripts/agent-access-evidence.mjs';
import{scanSecrets}from'/Users/chenzhenbo/Work/TriviumCode/dist/test/src/trivium/secrets.js';
const source=path.dirname(new URL(import.meta.url).pathname),destination='/Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/agent-access-20261011-closeout-r13/admission-after21',copies=[];
if(fs.existsSync(destination))throw Error('新独立目录已存在，禁止覆盖');
function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p);else if(e.isFile()){const rel=path.relative(source,p),out=destination+'/'+rel,bytes=fs.readFileSync(p);if(scanSecrets(bytes.toString('utf8')).length)throw Error('扫描非零：'+rel);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes,{flag:'wx',mode:0o600});if(hash(out)!==hash(p))throw Error('副本hash不符');copies.push({source:p,relative:rel,sha256:hash(out),bytes:bytes.length});}else throw Error('证据非普通文件');}}
walk(source);saveEvidence(path.dirname(destination)+'/evidence-export-after21.json',{at:new Date().toISOString(),source,destination,copies,files:copies.length,bytes:copies.reduce((n,c)=>n+c.bytes,0),secret_candidates:0,new_vendor_starts:0,criteria_changed:false,goal_complete:false});
console.log(JSON.stringify({destination,files:copies.length,bytes:copies.reduce((n,c)=>n+c.bytes,0),secret_candidates:0}));
