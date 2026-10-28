#!/usr/bin/env node
/** 离线关联原件；不调用模型，不回填或覆盖旧证据。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeChecks,repo,sha,stages} from './driver-identity.mjs';

export function assess(e){
  if(e.case!=='real'||!e.observation||!e.entries)return null;
  const rows=e.observation.rows;
  const firstEnd=Math.max(...rows.map((r,i)=>r.argv.includes('native-first')||r.argv[0]==='fixture-draft'?i:-1))+1;
  const native=e.commands.filter(c=>typeof c.pass==='number').map(c=>{
    const subset=c.pass===1?rows.slice(0,firstEnd).filter(r=>r.argv[0]!=='status'):rows.slice(firstEnd);
    return nativeChecks(c,e.entries.filter(x=>x.name!=='dual-status'),{spec:{agent:e.agent}},c.pass,subset);
  });
  const stagesPassed=stages.every(s=>e.observation.per_stage[s]&&Object.values(e.observation.per_stage[s]).every(Boolean));
  const sessions=native.map(n=>n.session_id);
  const completed=e.commands.every(c=>c.code===0&&!c.timedOut&&!c.truncated&&!c.earlyStopped);
  const sourceRead=native.length===2&&native.every(n=>n.entries_loaded)&&e.entries.every(x=>x.sha256===x.source_sha256);
  const blocked=rows.filter(r=>!r.allowed);
  const statusRows=rows.filter(r=>r.argv[0]==='status');
  return {source_kind:e.source_kind,admission:false,identity_items_passed:stagesPassed&&completed&&sourceRead&&new Set(sessions).size===2&&sessions.every(Boolean),collector_passed:e.passed,per_stage:e.observation.per_stage,native,distinct_native_sessions:new Set(sessions).size===2&&sessions.every(Boolean),entries_loaded_as_reference:sourceRead,formal_slash_entry_executed:false,blocked_wrapper_attempts:blocked.map(r=>({argv:r.argv,exit_code:r.exit_code})),clean_first_attempts:blocked.length===0&&rows.filter(r=>r.argv[1]==='resolve').every(r=>r.exit_code===0),status:e.agent==='kimi'?{succeeded:statusRows.length>0&&statusRows.every(r=>r.exit_code===0),rows:statusRows,skill_loaded:e.commands.some(c=>c.pass==='status'&&c.stdout.includes('loaded inline'))}:'沿用上一批真实status；本批未重复',limits:['归属材料由验收wrapper调用生产archive生成，不代表模型自主撰写真实业务原稿质量','入口文件经真实Read加载为参考；正式A/B/C/D斜杠流程未执行','工具结果文本与wrapper账本关联，不宣称通用shell argv解析或厂商执行层沙箱','底层模型身份null；CLI回读路线标签与真实底层身份分开']};
}

async function main(){
  const dir=path.resolve(process.argv[2]??path.join(repo,'doc/05_testing/evidence/driver-identity-20261028'));
  const files=[];
  for(const name of (await fs.readdir(dir)).sort()){
    if(!name.endsWith('.json')||name.startsWith('index-'))continue;
    const b=await fs.readFile(path.join(dir,name)),e=JSON.parse(b);
    files.push({file:name,sha256:sha(b),bytes:b.length,schema:e.schema,agent:e.agent??null,case:e.case??null,source_kind:e.source_kind??null,error:e.error??null,collector_passed:e.passed??null,assessment:assess(e)});
  }
  const target=path.join(dir,`index-${Date.now()}.json`);
  await fs.writeFile(target,JSON.stringify({schema:'trivium.driver-identity-index.v1',at:new Date().toISOString(),script_sha256:sha(await fs.readFile(fileURLToPath(import.meta.url))),admission:false,formal_review:'未测；未启动',windows:'未测',files},null,2),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({file:target,files:files.length,real:files.filter(f=>f.assessment).map(f=>({file:f.file,identity_items_passed:f.assessment.identity_items_passed,collector_passed:f.collector_passed}))}));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
