/** 批 Z / X 前置（user-decision-02.json D5）：把夹具现有改动提交成新基线；.codex/ 按 D6 原样保留、不提交。零厂商调用。 */
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {saveEvidence} from '../../../../../scripts/agent-access-evidence.mjs';
const here=import.meta.dirname,F='/Users/chenzhenbo/Work/trivium-m11-step12-20261012';
const git=(...a)=>execFileSync('git',['-C',F,...a],{encoding:'utf8'});
const snap=()=>({head:git('rev-parse','HEAD').trim(),status:git('status','--porcelain=v1','--untracked-files=all').split('\n').filter(Boolean)});
const before=snap();
const expected=['AGENTS.md','src/stack.js','test/stack.test.js'];
for(const f of expected)if(!before.status.some(l=>l.startsWith(' M '+f)))throw Error('夹具状态与准备时不符：'+f);
const paths=[...expected,'.reviews/m11-s12-capacity','.reviews/m11-s12-stack'];
git('add','--',...paths);
const staged=git('diff','--cached','--name-only').split('\n').filter(Boolean);
if(staged.some(p=>p.startsWith('.codex/')))throw Error('.codex/ 不应进基线');
git('commit','-q','-m','test(fixture): 固定剧本1～6验收后的夹具基线（M11第12步收口批Z/X前置）');
const after=snap();
saveEvidence(here+'/fixture-baseline.json',{at:new Date().toISOString(),fixture:F,decision:'closeout-20261016-01/user-decision-02.json D5/D6',before,staged_count:staged.length,staged_top:[...new Set(staged.map(p=>p.split('/').slice(0,2).join('/')))],after});
console.log(JSON.stringify({before:before.head,after:after.head,staged:staged.length,remaining:after.status}));
