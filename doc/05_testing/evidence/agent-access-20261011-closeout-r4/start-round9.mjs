/** 原样转抄resolve输出，不直接调用厂商CLI。 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { scanSecrets } from '../../../../dist/test/src/trivium/secrets.js';
const dir=path.join(process.env.HOME,'.trivium/evidence/agent-access-20261011-closeout-r3/calls');
const files=fs.readdirSync(dir).filter(n=>n.startsWith('r13-resolve-')&&n.endsWith('-completed.json'));
if(files.length!==1)throw Error('resolve不唯一');
const resolved=JSON.parse(JSON.parse(fs.readFileSync(path.join(dir,files[0]))).stdout);
if(!resolved.ok||resolved.allow_single)throw Error('resolve不适用');
const args=['review','--start','--entry','B','--stage','plan','--topic',resolved.topic,'--driver',resolved.driver,'--critics',resolved.critics.join(','),'--focus',resolved.prompt_hint,'--plan-file',resolved.subject_path,'--context',resolved.context_paths.join(','),'--json'];
for(const [key,flag]of[['profile','--profile'],['task_goal','--goal'],['driver_model','--driver-model'],['driver_provider','--driver-provider']])if(resolved[key]!=null)args.push(flag,resolved[key]);
for(const [field,prefix]of[['models','--model-'],['tiers','--tier-'],['efforts','--effort-'],['vendor_profiles','--profile-']])for(const [id,v]of Object.entries(resolved[field]??{})){
 if(v===null&&field==='vendor_profiles')args.push('--native-'+id);else if(v!=null)args.push(prefix+id,v);
}
// 所有静态范围材料在spawn前扫描；期间不得再追加本目录文件。
const root=path.dirname(new URL(import.meta.url).pathname);
for(const name of fs.readdirSync(root))if(fs.statSync(path.join(root,name)).isFile()&&scanSecrets(fs.readFileSync(path.join(root,name),'utf8')).length)throw Error('静态脱敏扫描失败');
const child=spawn(process.execPath,['doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v5.mjs','review','r13-start','tv',...args],{stdio:'inherit'});
process.exitCode=await new Promise(resolve=>child.once('close',code=>resolve(code??1)));
