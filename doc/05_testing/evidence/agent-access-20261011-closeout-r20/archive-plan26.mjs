/** 已认领plan后，archive.ts唯一出口生成26B完整原稿r29。 */
import fs from 'node:fs';import path from 'node:path';import {writeArtifact} from '../../../../dist/test/src/trivium/archive.js';
import {hash} from '../../../../scripts/agent-access-selection.mjs';import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),topic='Agent双模式接入真实准入收口';
const proposal='doc/05_testing/evidence/agent-access-20261011-closeout-r20/consolidated-gap-plan-proposal.md',parent='.reviews/'+topic+'/plan/2026-10-12-'+topic+'-r28-codex.md';
if(hash(parent)!=='f6b92255f1182e63905ed837ddf9fb1262eb84bdd38b13e80e17292a4687a406')throw Error('25B父定稿漂移');
const content='---\nrole: codex\n---\n\n# Agent双模式接入真实准入收口：第26B集中补充计划原稿（r29）\n\n'+
 '本稿为新的完整当前执行合同，不递归追加旧稿。25B完整r28与23C获批七整改保留，旧采样与失败不回写。相对r28新增CLI inline defaultMode消费面与精确差异、有界显式逐跳认证谱系及v3候选/关闭消费者，其余N/mixed/HTTP/清理/普通与独立审批边界继承并在下文完整列出。新范围未经26B审查和本轮普通批准不得实施。父定稿SHA '+hash(parent)+'，提案SHA '+hash(proposal)+'。\n\n'+fs.readFileSync(proposal,'utf8');
const artifact=await writeArtifact({layout:{archiveRoot:repo+'/.reviews',topic},stage:'plan',role:'codex',writer:'driver',driver:'codex',rerunIndex:29,date:'2026-10-12',content});
saveEvidence(root+'/plan26-original-archive.json',{at:new Date().toISOString(),artifact,proposal_sha256:hash(proposal),prior_final_sha256:hash(parent),claim_label:'r38-plan26-claim',new_sensitive_implementation:false,criteria_adopted:false,new_vendor_starts:0});console.log(JSON.stringify({path:artifact.relPath,sha256:artifact.sha256}));
