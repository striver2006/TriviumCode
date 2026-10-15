/** 只读/纯核对。授权、累计事实、父级证据分开；不预占、不写真实台账。 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
export function ledgerSnapshot(root){
 const entries=[];
 for(const pool of ['admission','review']){
  const dir=path.join(root,'ledger',pool);
  const names=fs.readdirSync(dir).filter(n=>/^reserved-\d+\.json$/.test(n)).sort();
  for(let n=0;n<names.length;n++){
   const file=path.join(dir,names[n]),raw=fs.readFileSync(file),r=JSON.parse(raw);
   assert.equal(Number(names[n].match(/\d+/)[0]),n+1,'累计台账序号缺口');assert.equal(r.index,n+1);assert.equal(r.pool,pool);
   entries.push({pool,index:r.index,sha256:sha(raw)});
  }
 }
 return {counts:Object.fromEntries(['admission','review'].map(p=>[p,entries.filter(x=>x.pool===p).length])),entries,digest:sha(JSON.stringify(entries))};
}
export function verifyBudgetBinding(binding,baseline,current){
 assert.equal(binding.schema,'s5-budget-binding.v2');
 assert.equal(binding.baseline_digest,baseline.digest,'旧累计基线被替换');
 assert.deepEqual(binding.expected_counts,current.counts,'当前累计数不符合具名绑定');
 assert.equal(binding.expected_digest,current.digest,'当前预占集合有未绑定改变');
 assert.equal(current.counts.review,baseline.counts.review,'Hook批次不许借用review余量');
 assert(current.counts.admission>=baseline.counts.admission);
 const old=new Map(baseline.entries.map(x=>[x.pool+':'+x.index,x.sha256]));
 for(const e of current.entries)if(old.has(e.pool+':'+e.index))assert.equal(e.sha256,old.get(e.pool+':'+e.index),'历史预占内容变化');
 assert.deepEqual(current.entries.filter(x=>x.index<=baseline.counts[x.pool]),baseline.entries);
 const extra=current.entries.filter(x=>x.index>baseline.counts[x.pool]);
 assert(Array.isArray(binding.driver_starts));assert.equal(binding.driver_starts.length,extra.length,'新增启动逐项绑定不足');
 const keys=new Set();
 for(const entry of extra){
  const matches=binding.driver_starts.filter(x=>x.pool===entry.pool&&x.index===entry.index);assert.equal(matches.length,1);
  const s=matches[0];assert.equal(s.pool,'admission');assert.equal(s.reserved_sha256,entry.sha256);
  assert(typeof s.start_receipt==='string'&&path.isAbsolute(s.start_receipt));assert(/^[a-f0-9]{64}$/.test(s.start_receipt_sha256));
  const key=s.pool+':'+s.index;assert(!keys.has(key));keys.add(key);
 }
 return {exact_reserved_set:true,new_driver_boundaries:extra.length,review_delta:0};
}
