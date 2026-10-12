/** 所有送审静态工作先落盘再冻结；供应商启动0，运行元数据不属于业务作用面。 */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {hash} from '../../../../scripts/agent-access-selection.mjs';import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {scanSecrets} from '../../../../dist/test/src/trivium/secrets.js';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),hashes={},scan={files:0,bytes:0,candidates:0};
const put=p=>{hashes[path.resolve(p)]=hash(p);};
function walk(dir,scanBytes=false){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p,scanBytes);else if(e.isFile()){put(p);if(scanBytes){const b=fs.readFileSync(p);if(scanSecrets(b.toString('utf8')).length)throw Error('冻结扫描非零:'+p);scan.files++;scan.bytes+=b.length;}}}}
for(const dir of ['src','scripts','test','skills','skills-src'])walk(dir);
for(const dir of fs.readdirSync('doc',{withFileTypes:true}).filter(e=>e.isDirectory()))for(const e of fs.readdirSync('doc/'+dir.name,{withFileTypes:true}))if(e.isFile()&&e.name.endsWith('.md'))put('doc/'+dir.name+'/'+e.name);
for(const n of [15,16,17,18])walk('doc/05_testing/evidence/agent-access-20261011-closeout-r'+n,true);
for(const p of ['AGENTS.md','package.json','package-lock.json','tsconfig.json','.trivium/config.yaml','.trivium/config.local.yaml','doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authority.json','doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v14.json','doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v18.mjs','doc/05_testing/evidence/agent-access-20261011-closeout-r3/round-guard-v2.mjs','doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-start-precheck-v2.mjs'])put(p);
for(const p of ['.codex/config.toml','.codex/auth.json','.codex/hooks.json','.claude/settings.json'])put(path.join(os.homedir(),p));
const original=JSON.parse(fs.readFileSync(root+'/plan25-original-archive.json'));put(original.artifact.absPath);
const resolved=JSON.parse(fs.readFileSync(root+'/plan25-resolved.json'));for(const p of resolved.context_paths)put(p);
const runPath='.reviews/Agent双模式接入真实准入收口/plan/_meta/run-20261011T171203Z.json';put(runPath);const run=JSON.parse(fs.readFileSync(runPath));for(const a of run.artifacts)put('.reviews/'+a.path);
const guardSupplement=JSON.parse(fs.readFileSync(root+'/static-audit-guard-contract-supplement.json'));put(guardSupplement.approved_plan_path);
if(hash('.trivium/config.local.yaml')!==JSON.parse(fs.readFileSync(root+'/config-after25-preflight-observation.json')).current_sha256)throw Error('预检后配置变化');
saveEvidence(root+'/frozen-before-round25.json',{at:new Date().toISOString(),hashes,scan,subject:original.artifact,formal_before:24,allowed_next:25,formal_limit:26,expected_new_review_starts:5,batch_stop:333,local_sha256:hash('.trivium/config.local.yaml'),bundle_sha256:hash('skills/dual-critic/scripts/trivium.cjs'),criteria_changed:false,new_mode_setting_implemented:false,new_vendor_starts:0});
console.log(JSON.stringify({frozen_files:Object.keys(hashes).length,scan,formal:'24/26',new_vendor_starts:0}));
