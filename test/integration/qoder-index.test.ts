/** 索引坏件隔离与缺绑定可见性；不调用厂商，不作为native验收。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {run} from '../../src/trivium/util/exec.js';
import {REPO_ROOT} from '../helpers/fixture.js';
import {scratchDir} from '../helpers/scratch.js';

test('execution坏JSON/坏routes/坏stdout逐件隔离，好件仍索引且旧缺绑定保持null',async()=>{
  const root=await fs.realpath(await scratchDir('trivium-index-mixed-'));
  try{
    await fs.writeFile(path.join(root,'execution-1.json'),'{broken');
    await fs.writeFile(path.join(root,'execution-2.json'),JSON.stringify({routes:{}}));
    await fs.writeFile(path.join(root,'execution-3.json'),JSON.stringify({routes:[{cases:[{candidate:{stdout:42}}]}]}));
    await fs.writeFile(path.join(root,'execution-4.json'),JSON.stringify({script_sha256:'fixture',routes:[]}));
    const result=await run(process.execPath,[path.join(REPO_ROOT,'scripts/acceptance/kimi-qoder-cn/qoder-index.mjs'),root],{cwd:REPO_ROOT,timeoutMs:30000,killTree:true});
    assert.equal(result.code,1,result.stderr);
    const output=JSON.parse(result.stdout.trim());assert.ok(output.file.startsWith(root+path.sep));
    const index=JSON.parse(await fs.readFile(output.file,'utf8'));
    assert.equal(index.execution.length,4);assert.equal(index.execution.filter((x:{error_code?:string})=>x.error_code).length,3);
    const good=index.execution.find((x:{file:string})=>x.file==='execution-4.json');assert.equal(good.script_sha256,'fixture');assert.equal(good.secret_guard_sha256,null);
    assert.equal(index.guard_binding_missing_count,1);assert.deepEqual(index.execution_binding_warnings,[{file:'execution-4.json',missing:['secret_guard_sha256','evidence_helper_sha256']}]);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
