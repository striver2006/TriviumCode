/** 仅Bob系统终端，在关闭对应客户端后回滚整个新夹具；隔离失败现场，不删任何目录。 */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {here,read,inventory,fixture,budget,saveEvidence} from './common.mjs';
const [name,closed]=process.argv.slice(2);assert.equal(process.argv.length,4);assert.equal(closed,'--client-closed');
const p=read(here+'/preparation.json'),cwd=fixture(p,name),backup=p.root+(name==='archive'?'/backup':'/empty-backup');
assert(fs.existsSync(here+'/setup-'+name+'-before.json'),'未开始setup，无需回滚');
assert(!fs.existsSync(here+'/rollback-'+name+'.json'));
const expected=name==='archive'?p.original_files:p.empty_files;
assert.deepEqual(inventory(backup),expected,'备份不完整，拒绝回滚');
const held=cwd+'-failed-'+Date.now();assert(!fs.existsSync(held));
saveEvidence(here+'/rollback-'+name+'-before.json',{at:new Date().toISOString(),cwd,held,files:inventory(cwd),budget:budget(),operator_confirmation:closed});
fs.renameSync(cwd,held);
fs.cpSync(backup,cwd,{recursive:true,errorOnExist:true,force:false});
assert.deepEqual(inventory(cwd),expected);
saveEvidence(here+'/rollback-'+name+'.json',{at:new Date().toISOString(),cwd,held,files:inventory(cwd),equal_to_pre_setup:true,budget:budget(),scope:'失败目录完整保留；历史批次停止，不重试setup或客户端'});
console.log(JSON.stringify({restored:true,quarantined:held}));
