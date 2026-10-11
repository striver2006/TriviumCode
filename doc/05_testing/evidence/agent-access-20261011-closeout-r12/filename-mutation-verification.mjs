/** 批准后反证CLAUDE-01：只在内存改合同模块文件名；不改源码/既有测试，0厂商CLI。 */
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
import {hash} from '../../../../scripts/agent-access-selection.mjs';
const repo=process.cwd(),base=path.dirname(new URL(import.meta.url).pathname),source='scripts/agent-access-write-contract.mjs',testFile='test/unit/agent-access-write-contract.test.ts';
const sourceHash=hash(source),testHash=hash(testFile),text=fs.readFileSync(source,'utf8');
const old="export const WRITE_CONTRACT_FILE = 'WRITE_CONTROL.json';";
assert.equal(text.split(old).length,2);
const altered=text.replace(old,"export const WRITE_CONTRACT_FILE = 'MUTATED_CONTROL.json';")
 .replace("'../dist/test/src/trivium/probes/codex.js'",JSON.stringify(pathToFileURL(path.join(repo,'dist/test/src/trivium/probes/codex.js')).href))
 .replace("'./agent-access-evidence.mjs'",JSON.stringify(pathToFileURL(path.join(repo,'scripts/agent-access-evidence.mjs')).href));
const mutated=await import('data:text/javascript;base64,'+Buffer.from(altered).toString('base64'));
const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'trivium-filename-mutation-')));
let observed;
try {
 const contract=mutated.createWriteContract(root);assert.equal(contract.file,'MUTATED_CONTROL.json');
 try { fs.statSync(path.join(root,'WRITE_CONTROL.json')); }catch(error){ observed=error.code; }
 assert.equal(observed,'ENOENT'); // 既有真实文件测试第71行会在此失败，而非诊断静默false。
}finally{fs.rmSync(root,{recursive:true,force:true});}
assert.equal(hash(source),sourceHash);assert.equal(hash(testFile),testHash);
saveEvidence(base+'/filename-mutation-verification.json',{at:new Date().toISOString(),original_source_sha256:sourceHash,original_test_sha256:testHash,in_memory_mutation_only:true,observed_fixed_filename_stat_error:observed,existing_test_would_fail:true,source_and_test_unchanged:true,temporary_fixture_removed:!fs.existsSync(root),new_vendor_cli_starts:0,script_sha256:hash(new URL(import.meta.url))});
console.log(JSON.stringify({fixed_filename_stat_error:observed,source_unchanged:true,test_unchanged:true,fixture_removed:!fs.existsSync(root),new_vendor_cli_starts:0}));
