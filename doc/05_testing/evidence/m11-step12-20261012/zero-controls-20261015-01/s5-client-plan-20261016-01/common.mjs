/** S5后续准备的公共只读检查。无顶层初始化、Hook或厂商调用。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
export {saveEvidence} from '../../../../../../scripts/agent-access-evidence.mjs';
export const here=import.meta.dirname,base=path.resolve(here,'../..'),repo=path.resolve(here,'../../../../../..');
export const read=f=>JSON.parse(fs.readFileSync(f,'utf8'));
export const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
export const hash=f=>digest(fs.readFileSync(f));
export function inventory(dir,rel='') {
 assert(fs.lstatSync(dir).isDirectory()&&!fs.lstatSync(dir).isSymbolicLink());
 return fs.readdirSync(path.join(dir,rel)).sort().flatMap(n=>{
  const p=rel?rel+'/'+n:n,f=path.join(dir,p),s=fs.lstatSync(f);
  assert(!s.isSymbolicLink(),'拒绝软链接：'+p);
  if(s.isDirectory())return inventory(dir,p);
  assert(s.isFile(),'拒绝特殊文件：'+p);
  return [{path:p,sha256:hash(f),mode:s.mode&0o777,bytes:s.size}];
 });
}
export function budget() {
 const p=read(base+'/budget-plan.json');
 return Object.fromEntries(['admission','review'].map(k=>[k,fs.readdirSync(p.budgetRoot+'/ledger/'+k).filter(n=>/^reserved-\d+\.json$/.test(n)).length]));
}
export function verifyAnchors(p) {
 assert.deepEqual(budget(),p.budget_before,'预算变化，需重新审阅批次');
 for(const x of p.anchors)assert.equal(hash(x.file),x.sha256,'指纹变化：'+x.file);
 assert.deepEqual(inventory(p.source),p.original_files,'原工程发生变化，停止');
 assert.deepEqual(inventory(p.root+'/backup'),p.original_files,'备份发生变化，停止');
}
export function fixture(p,name) {
 assert(['archive','empty'].includes(name));
 const dir=p.fixtures[name];assert.equal(fs.realpathSync(dir),dir);return dir;
}
export function authorization(file,scope) {
 // 本轮只准备；审批回执不在本脚本生成，不以传入旗标自我授权。
 assert(fs.existsSync(file),'未取得具名授权：'+file);
 const a=read(file);
 assert.equal(a.decision,'approved');assert.equal(a.scope,scope);
 assert(typeof a.user_instruction==='string'&&a.user_instruction.length>0);
 assert.equal(a.preparation_sha256,hash(here+'/preparation.json'));
 assert.equal(a.proposal_sha256,hash(here+'/proposal-manifest.json'));
 for(const x of read(here+'/proposal-manifest.json').files)assert.equal(hash(here+'/'+x.file),x.sha256,'方案发布后文件变化');
 assert.deepEqual(a.vendor_increment,{admission:0,review:0});
 return a;
}
export function assertSameExcept(a,b,paths) {
 const omit=v=>v.filter(x=>!paths.includes(x.path));
 assert.deepEqual(omit(a),omit(b),'预期范围外发生变化');
}
export const phases={baseline:{fixture:'archive',exit:0},missing:{fixture:'archive',exit:2},
 'restored-missing':{fixture:'archive',exit:0},changed:{fixture:'archive',exit:2},
 'restored-changed':{fixture:'archive',exit:0},empty:{fixture:'empty',exit:0}};
export function toolInput(p,phase) {
 assert(Object.hasOwn(phases,phase));
 return {command:'GIT_INDEX_FILE='+p.root+'/'+phases[phase].fixture+'.index git -c core.quotePath=false --no-optional-locks commit --dry-run',
 description:'M11-S5N01 '+phase+' dry-run'};
}
