/** 共享七入口迁移后的其它仓库根指令只读抽样；不调用客户端，不遍历凭据。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const home=os.homedir(),work=path.join(home,'Work');
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
const names=['dual-run','dual-review-plan','dual-review-code','dual-review-bug','dual-approve','dual-abandon','dual-status'];
const roots=fs.readdirSync(work,{withFileTypes:true}).filter(e=>e.isDirectory()&&e.name!=='TriviumCode')
  .map(e=>path.join(work,e.name));
const cowork=path.join(home,'AI_Cowork');if(fs.existsSync(cowork)&&fs.statSync(cowork).isDirectory())roots.push(cowork);
const docs=[];
for(const root of roots)for(const name of ['AGENTS.md','CLAUDE.md']){
  const file=path.join(root,name);
  if(!fs.existsSync(file)||!fs.lstatSync(file).isFile())continue;
  const bytes=fs.readFileSync(file),s=bytes.toString('utf8');
  docs.push({root,file,sha256:digest(bytes),mentions_shared_root:/\.agents\/skills/.test(s),
    mentions_explicit_shared_dual_path:/\.agents\/skills\/dual-(?:run|review-plan|review-code|review-bug|approve|abandon|status)/.test(s),
    names_mentioned:names.filter(n=>s.includes(n))});
}
const sharedRoot=path.join(home,'.agents/skills');
const shared=names.map(name=>({name,exists:fs.existsSync(path.join(sharedRoot,name))}));
const verdict={at:new Date().toISOString(),schema:'trivium.access.shared-entry-other-repos-root-docs.v1',
  script_sha256:digest(fs.readFileSync(new URL(import.meta.url))),roots_considered:roots.length,
  root_instruction_docs_read:docs.length,docs,shared,
  explicit_shared_dual_path_refs:docs.filter(d=>d.mentions_explicit_shared_dual_path).length,
  other_repos_with_entry_names:[...new Set(docs.filter(d=>d.names_mentioned.length).map(d=>d.root))],
  bounds:['只读抽样Work一级仓库根AGENTS/CLAUDE及AI_Cowork根；不代表所有目录/仓库依赖',
    '提到dual命令不证明依赖共享根同名副本','未实测任何客户端重名解析或入口发现','七共享入口的重新出现来源仍未知'],
  real_cli_starts:0};
saveEvidence('doc/05_testing/evidence/agent-access-20261011-closeout-r4/shared-entry-other-repos-root-audit.json',verdict);
console.log(JSON.stringify({roots:roots.length,docs:docs.length,explicit_shared_path_refs:verdict.explicit_shared_dual_path_refs,
  repos_mentioning_commands:verdict.other_repos_with_entry_names.length,shared_absent:shared.every(x=>!x.exists),real_cli_starts:0}));
