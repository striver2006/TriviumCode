/** 批 X 前置（D5）：Z2 审批后的夹具改动（clear() 实现与测试、.gitignore 的 .codex/ 条目、m11-s12-cross 归档）提交成新基线。零厂商调用。 */
import {execFileSync} from 'node:child_process';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,F='/Users/chenzhenbo/Work/trivium-m11-step12-20261012';
const git=(...a)=>execFileSync('git',['-C',F,...a],{encoding:'utf8'});
const snap=()=>({head:git('rev-parse','HEAD').trim(),status:git('status','--porcelain=v1','--untracked-files=all').split('\n').filter(Boolean)});
const before=snap();
const expected=[' M .gitignore',' M src/stack.js',' M test/stack.test.js'];
for(const l of expected)if(!before.status.includes(l))throw Error('夹具状态与预期不符：'+l);
if(before.status.some(l=>!expected.includes(l)&&!l.startsWith('?? .reviews/m11-s12-cross/')))throw Error('出现预期外改动：'+JSON.stringify(before.status));
git('add','--','.gitignore','src/stack.js','test/stack.test.js','.reviews/m11-s12-cross');
const staged=git('diff','--cached','--name-only').split('\n').filter(Boolean);
git('commit','-q','-m','test(fixture): 固定批Z审批后的夹具基线（clear()与m11-s12-cross归档，批X前置）');
const after=snap();
saveEvidence(here+'/fixture-baseline-2.json',{at:new Date().toISOString(),fixture:F,decision:'closeout-20261016-01/user-decision-02.json D5',before,staged,after});
console.log(JSON.stringify({before:before.head,after:after.head,staged:staged.length,remaining:after.status}));
