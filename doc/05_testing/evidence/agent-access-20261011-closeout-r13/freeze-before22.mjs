/** 最后静态快照；审查期间只观察编排器，禁止增改业务/本目录。 */
import fs from'node:fs';import path from'node:path';
import{hash}from'../../../../scripts/agent-access-selection.mjs';import{saveEvidence}from'../../../../scripts/agent-access-evidence.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),staticHashes={},business={},walk=(dir,put)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())walk(p,put);else if(e.isFile())put(p);}};
walk(root,p=>staticHashes[path.relative(root,p)]=hash(p));
for(const dir of['src','scripts','test','skills','skills-src'])walk(dir,p=>{if(!p.endsWith('trivium.cjs'))business[p]=hash(p);});
for(const p of['AGENTS.md','package.json','package-lock.json','tsconfig.json'])business[p]=hash(p);
for(const dir of fs.readdirSync('doc',{withFileTypes:true}).filter(e=>e.isDirectory()))for(const e of fs.readdirSync('doc/'+dir.name,{withFileTypes:true}))if(e.isFile()&&e.name.endsWith('.md')){const p='doc/'+dir.name+'/'+e.name;business[p]=hash(p);}
const topic='Agent双模式接入真实准入收口',original=JSON.parse(fs.readFileSync(root+'/plan22-original-archive.json')),auth='doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v12.json';
saveEvidence(root+'/frozen-before-round22.json',{at:new Date().toISOString(),hashes:staticHashes,business_hashes:business,plan:{path:original.artifact.absPath,sha256:hash(original.artifact.absPath)},configs:{shared:hash('.trivium/config.yaml'),local:hash('.trivium/config.local.yaml')},current_authority_sha256:hash('doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json'),authorization_sha256:hash(auth),launcher_sha256:hash('doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v16.mjs'),bundle:hash('skills/dual-critic/scripts/trivium.cjs'),formal_before:21,allowed_next:22,criteria_changed:false,business_implemented:false});
console.log(JSON.stringify({static_files:Object.keys(staticHashes).length,business_files:Object.keys(business).length,plan_sha256:hash(original.artifact.absPath),new_vendor_starts:0}));
