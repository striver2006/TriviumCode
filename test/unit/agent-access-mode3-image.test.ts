/** 已清理临时别名的真实回放边界；模拟身份变化均拒绝，无CLI启动。 */
import {test} from 'node:test';import assert from 'node:assert/strict';import path from 'node:path';import {pathToFileURL} from 'node:url';
test('临时别名不存在不影响已采样的稳定native映像核验，未知身份不能放行',async()=>{
 const m=await import(pathToFileURL(path.resolve('doc/05_testing/evidence/agent-access-20261011-closeout-r21/mode3-proof.mjs')).href),alias='/test-only-removed-home/.local/bin/claude',native='/test-only-native',hash='a'.repeat(64),sample={pid:100,parent_pid:99,lstart:'Sun Oct 11 20:41:11 2026',comm:alias,image:native,image_sha256:hash};
 assert.equal(m.verifyCapturedMode3Image(sample,alias,native,hash),true);
 for(const mutation of [{pid:0},{pid:null},{parent_pid:0},{lstart:null},{lstart:'bad'},{comm:'relative'},{comm:'/other-alias'},{image:'/other-native'},{image_sha256:'b'.repeat(64)}])assert.equal(m.verifyCapturedMode3Image({...sample,...mutation},alias,native,hash),false,JSON.stringify(mutation));
 assert.equal(m.verifyCapturedMode3Image(null,alias,native,hash),false);
});
