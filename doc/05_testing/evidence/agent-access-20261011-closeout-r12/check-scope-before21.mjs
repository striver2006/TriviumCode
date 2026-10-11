/** 21C前双check同输入与串行核验，0厂商CLI，既有结果不覆盖。 */
import fs from 'node:fs';import path from 'node:path';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {hash} from '../../../../scripts/agent-access-selection.mjs';
import {computeBuildStamp} from '../../../../dist/test/src/trivium/build-stamp.js';
const root=path.dirname(new URL(import.meta.url).pathname),prior=JSON.parse(fs.readFileSync(root+'/../agent-access-20261011-closeout-r11/check-pair-r22-final-scope.json'));
const inputs=await computeBuildStamp(process.cwd());
if(inputs.inputs_sha256!=='63cf4e39240c89da3656a7643896b7b3c605d5fac32058a8b51bd1896c2794d4')throw Error('完成检查后的输入变化');
const checks=['check1-r23-final.json','check2-r23-final.json'].map(file=>{
 const r=JSON.parse(fs.readFileSync(root+'/'+file));if(r.code!==0||r.signal!==null)throw Error('check未通过');
 const count=field=>Number(new RegExp('ℹ '+field+' (\\d+)').exec(r.stdout)?.[1]);
 const pass=count('pass'),skip=count('skipped'),fail=count('fail'),total=count('tests');
 if(pass!==3165||skip!==3||fail!==0||total!==3168)throw Error('check实际计数不符');
 return{file,sha256:hash(root+'/'+file),started_at:r.started_at,finished_at:r.finished_at,pass,skip,fail,total};
});
if(Date.parse(checks[0].finished_at)>Date.parse(checks[1].started_at))throw Error('check并行');
const hashes=Object.fromEntries(Object.keys(prior.hashes).map(f=>[f,hash(f)]));
saveEvidence(root+'/check-pair-r23-final-scope.json',{at:new Date().toISOString(),inputs,hashes,checks,serial:true,targeted:51,vendor_cli_starts:0});
console.log(JSON.stringify({serial:true,checks:checks.map(c=>({file:c.file,pass:c.pass,skip:c.skip,fail:c.fail})),inputs:inputs.inputs_sha256}));
