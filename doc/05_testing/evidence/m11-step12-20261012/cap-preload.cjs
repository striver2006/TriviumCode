// 本轮验收的附加上限；既有预算模块仍为唯一累计台账，不重置历史。
const fs=require('node:fs');
const path=require('node:path');
const repo='/Users/chenzhenbo/Work/TriviumCode';
const core=require(path.join(repo,'scripts/agent-access-budget.cjs'));
const original=core.openBudget;
core.openBudget=(root,pool)=>{
 const b=original(root,pool),reserve=b.reserve;
 b.reserve=meta=>{
  const lock=path.join(root,'.m11-step12-reserve-lock');
  let held=false;
  for(let i=0;i<100;i++){try{fs.mkdirSync(lock);held=true;break;}catch(e){if(e.code!=='EEXIST')throw e;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}}
  if(!held)throw Error('本步预算锁忙，拒绝启动，不回收未知锁');
  try {
  const plan=JSON.parse(fs.readFileSync(path.join(__dirname,'budget-plan.json')));
  const count=p=>fs.readdirSync(path.join(root,'ledger',p)).filter(n=>/^reserved-\d+\.json$/.test(n)).length;
  const used=count(pool),total=count('admission')-plan.baseline.admission.used+count('review')-plan.baseline.review.used;
  const localCap=Number(process.env.M11_BATCH_ABSOLUTE_CAP);
  if(!Number.isSafeInteger(localCap)||used>=localCap||used>=plan.absolute_step_caps[pool]||total>=80)throw Error('M11第12步本批或本步CLI启动上限已到，拒绝spawn');
  return reserve(meta);
  } finally {fs.rmdirSync(lock);}
 };
 return b;
};
