/** 仅验证生成器目标项目路由及坏证据拒绝，不调用原生CLI，不作为native准入。 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {run} from '../../src/trivium/util/exec.js';
import {parseQoderCatalog,qoderHash} from '../../src/trivium/adapters/qoder-cn-model.js';
import {REPO_ROOT} from '../helpers/fixture.js';
import {scratchDir} from '../helpers/scratch.js';
import type {NativeModelFacts} from '../../src/trivium/types.js';

test('生成器显式目标项目读证据/写拒绝评估，坏证据不写台账，隐式写入被拒绝',async()=>{
  const root=await fs.realpath(await scratchDir('trivium-admission-generator-'));
  try{
    const source=path.join(root,'empty-native-source');await fs.mkdir(source);
    const parsed=parseQoderCatalog('MODEL\nExact');
    const facts:NativeModelFacts={model:'Exact',source:'catalog-default',observed_user_model:null,models:parsed.models,route_labels:parsed.routeLabels,
      catalog_sha256:parsed.semanticHash,catalog_raw_sha256:qoderHash('fixture'),configuration_sha256:null,entrypoint:process.execPath,cli_sha256:qoderHash(await fs.readFile(process.execPath)),
      cli_version:'synthetic-not-invoked',platform:process.platform,prepared_at:new Date().toISOString(),default_verified:true,invocation_args:['fixture'],review_invocation_args:['fixture']};
    await fs.writeFile(path.join(root,'facts.json'),JSON.stringify({facts}));
    await fs.writeFile(path.join(root,'bad-evidence.json'),JSON.stringify({at:new Date().toISOString(),schema:'synthetic-invalid-native-proof',cases:[]}));
    await fs.writeFile(path.join(root,'manifest.json'),JSON.stringify({facts_file:'facts.json',ttl_days:1,deny_paths:['.trivium'],evidence:[{check:'model-positive',path:'bad-evidence.json',case_id:'none'}]}));
    const script=path.join(REPO_ROOT,'scripts/acceptance/kimi-qoder-cn/qoder-admission.mjs');
    const implicit=await run(process.execPath,[script,'manifest.json','--write'],{cwd:root,env:{QODERCN_CONFIG_DIR:source},timeoutMs:30000,killTree:true});
    assert.notEqual(implicit.code,0);assert.match(implicit.stderr,/必须显式指定目标项目/);
    const result=await run(process.execPath,[script,'manifest.json','--project-root',root,'--write'],{cwd:REPO_ROOT,env:{QODERCN_CONFIG_DIR:source},timeoutMs:30000,killTree:true});
    assert.equal(result.code,0,result.stderr);
    const line=JSON.parse(result.stdout.trim()) as {file:string;admitted:boolean;passed:number};
    assert.equal(line.admitted,false);assert.equal(line.passed,0);assert.ok(line.file.startsWith(root+path.sep));
    assert.equal(path.dirname(line.file),root); // 默认跟随manifest目录，不强加本仓doc主题路径。
    const evaluation=JSON.parse(await fs.readFile(line.file,'utf8'));assert.equal(evaluation.record.project_root,root);assert.ok(evaluation.reasons['model-positive'].length);
    await assert.rejects(fs.lstat(path.join(root,'.trivium/admission.local.json')),{code:'ENOENT'});
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
