/** plan已noop认领；原稿只经archive.ts，Driver身份codex。 */
import fs from'node:fs';import path from'node:path';
import{writeArtifact}from'../../../../dist/test/src/trivium/archive.js';
import{saveEvidence}from'../../../../scripts/agent-access-evidence.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),topic='Agent双模式接入真实准入收口',repo=process.cwd();
const body=fs.readFileSync(root+'/post-round21-denial-evidence-plan-proposal.md','utf8');
const artifact=await writeArtifact({layout:{archiveRoot:repo+'/.reviews',topic},stage:'plan',role:'codex',writer:'driver',driver:'codex',rerunIndex:23,date:'2026-10-11',content:'---\nrole: codex\n---\n\n'+body});
saveEvidence(root+'/plan22-original-archive.json',{at:new Date().toISOString(),artifact,claim_label:'r24-plan-claim',business_implemented:false,criteria_changed:false,new_vendor_starts:0});
console.log(JSON.stringify({path:artifact.relPath,sha256:artifact.sha256,new_vendor_starts:0}));
