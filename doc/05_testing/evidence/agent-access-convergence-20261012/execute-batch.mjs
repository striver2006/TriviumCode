/** 本轮一次性固定批；只调既有包装器，复算原判据，失败停止，不自动重试。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { saveEvidence, claudeDenyEvidence, claudeWritePass, codexCommandEvidence } from '../../../../scripts/agent-access-evidence.mjs';
import { hash } from '../../../../scripts/agent-access-selection.mjs';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { parseClaudeEvents } from '../../../../dist/test/src/trivium/adapters/claude-trace.js';
import { parseCodexEvents } from '../../../../dist/test/src/trivium/adapters/codex-trace.js';
import { SENTINEL_PEER, SENTINEL_SECRET } from '../../../../dist/test/src/trivium/probes/fixture.js';
const here = path.dirname(fileURLToPath(import.meta.url)), repo = path.resolve(here, '../../../..');
const root = path.join(os.homedir(), '.trivium/evidence/agent-access-20261011-closeout-r3');
const budgetRoot = root + '/budget', launcher = 'doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch-v21.mjs';
const { openBudget, hashFile } = createRequire(import.meta.url)(repo + '/scripts/agent-access-budget.cjs');
const read = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const budget = openBudget(budgetRoot, 'admission');
const counts = () => { const ns = fs.readdirSync(budget.dir); return { used: ns.filter(n => /^reserved-\d+\.json$/.test(n)).length,
  completed: ns.filter(n => /^launch-\d+\.json$/.test(n)).length, limit: budget.limit() }; };
const snapshot = () => {
  const files = [launcher, ...['closeout','budget','budget-preload','selection','evidence','recipes','write-contract'].map(n => 'scripts/agent-access-' + n + (n.startsWith('budget') ? '.cjs' : '.mjs')),
    '.trivium/config.local.yaml', '.trivium/config.yaml', '.trivium/bin/trivium', 'skills/dual-critic/scripts/trivium.cjs', 'skills/dual-critic/schema/review.v1.json'];
  const walk = d => { for (const e of fs.readdirSync(repo + '/' + d, { withFileTypes: true })) { const p = d + '/' + e.name; if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p); } };
  walk('dist/test/src/trivium');
  return Object.fromEntries([...files.map(f => path.join(repo, f)), ...['.codex/config.toml','.codex/auth.json','.codex/hooks.json','.claude/settings.json', '.claude/skills/dual-critic/scripts/trivium.cjs'].map(f => path.join(os.homedir(),f))].map(f => [f, hashFile(f)]));
};
const batchFile = here + '/batch-a.json';
if (process.argv[2] === 'prepare') {
  const baseline = read(here + '/baseline.json'), c = counts(), stamp = await computeBuildStamp(repo);
  if (c.used !== 734 || c.completed !== 734 || c.limit !== 742 || stamp.git_head !== baseline.git_head || stamp.dirty || hash(repo + '/.trivium/config.local.yaml') !== baseline.local_config_sha256) throw Error('准备基线不符');
  const allocated = new Set(fs.readdirSync(root + '/routes')), jobs = [];
  function add(agent, combo, arm, context, versionProfile) {
    const key = `${agent}-${combo}-${arm}`; let variant = 1;
    while (allocated.has(`${key}-${variant}`)) variant++;
    const dir = `${key}-${variant}`; allocated.add(dir);
    const args = [agent, combo, arm, String(variant), ...(versionProfile ? [versionProfile] : [])];
    const name = agent === 'static' ? `version-${context}` : key;
    jobs.push({ name, key, route_directory: dir, args, context, expected_starts: agent === 'claude' || combo === 'qwen' && agent === 'static' ? 1 : 2, hard_starts: 3 });
  }
  add('static','qwen','version','claude-qwen');
  for (const arm of ['deny-read','deny-grep','read','write']) add('claude','qwen',arm,'claude-qwen');
  add('static','codex','version','codex-native');
  for (const combo of ['native-sol','native-luna','native-astra']) for (const arm of ['read','write','deny']) add('codex',combo,arm,'codex-native');
  for (const combo of ['qwen','kimi','deepseek']) { add('static','codex','version','codex-'+combo,combo); for (const arm of ['read','write','deny']) add('codex',combo,arm,'codex-'+combo); }
  saveEvidence(batchFile, { at: new Date().toISOString(), authorization: { user_question: '可以不通过双审，直接执行吗？', user_instruction: '那就开始执行', formal_review_waived: true, formal_approval: false, criteria_change: false, shared_migration: false },
    repo, evidence_root: root, budget_root: budgetRoot, before: c, expected_starts: 49, hard_starts: 81, batch_stop: 815, jobs, source_stamp: stamp, files: snapshot(), controller_sha256: hash(fileURLToPath(import.meta.url)), launcher, failure_policy: '停止本批，保留失败，不自动重试' });
  console.log(JSON.stringify({ prepared: true, jobs: jobs.length, expected: 49, hard: 81, batch_stop: 815 }));
} else if (['validate','run'].includes(process.argv[2])) {
  const batch = read(batchFile);
  async function validate() {
    if (hash(fileURLToPath(import.meta.url)) !== batch.controller_sha256) throw Error('控制脚本变化');
    for (const [f,h] of Object.entries(batch.files)) if (hashFile(f) !== h) throw Error('冻结输入变化:' + f);
    const stamp = await computeBuildStamp(repo);
    if (stamp.git_head !== batch.source_stamp.git_head || stamp.inputs_sha256 !== batch.source_stamp.inputs_sha256 || stamp.dirty) throw Error('生产输入变化');
    const c = counts(); if (c.used !== c.completed || c.used > batch.batch_stop) throw Error('预算未闭合或超限');
  }
  await validate();
  if (process.argv[2] === 'validate') {
    if (batch.jobs.length !== 27 || batch.jobs.reduce((s,j) => s+j.expected_starts,0) !== 49 || batch.jobs.reduce((s,j) => s+j.hard_starts,0) !== 81 || new Set(batch.jobs.map(j=>j.route_directory)).size !== 27) throw Error('批次不符');
    for (const j of batch.jobs) if (fs.existsSync(root + '/routes/' + j.route_directory)) throw Error('目标已存在');
    console.log(JSON.stringify({ validation: 'passed', vendor_starts: 0, jobs: 27, production_unchanged: true }));
  } else {
    if (counts().used !== batch.before.used) throw Error('启动前计数变化');
    saveEvidence(here + '/started.json', { at:new Date().toISOString(), batch_sha256:hash(batchFile) });
    const extension = budget.extend('direct-convergence-20261012-a', 73, '用户免双审直接执行A批；734起预计49、硬81，累计815，失败即停不重试');
    saveEvidence(here + '/budget-extension.json', extension);
    const versions = {}, proofs = [], selection = { schema:'trivium.access.selection.v1', routes:{}, versions:{} };
    let failed = null;
    for (const job of batch.jobs) {
      try {
        await validate();
        const dir = root + '/routes/' + job.route_directory, before = counts();
        if (fs.existsSync(dir) || before.used + job.hard_starts > batch.batch_stop) throw Error('重复任务或预算不足');
        const env = { ...process.env }; delete env.TRIVIUM_ACCESS_SELECTION;
        if (job.args[0] !== 'static') {
          if (!versions[job.context]) throw Error('缺本批版本');
          const selectedFile = here + '/' + job.name + '-selection.json';
          saveEvidence(selectedFile,{schema:selection.schema,routes:{},versions:versions[job.context]}); env.TRIVIUM_ACCESS_SELECTION=selectedFile;
        }
        saveEvidence(here + '/' + job.name + '-started.json',{at:new Date().toISOString(),job,before,batch_sha256:hash(batchFile)});
        console.log(JSON.stringify({ starting:job.name, used:before.used, cap:batch.batch_stop }));
        const child=spawn(process.execPath,[repo+'/'+launcher,'admission','convergence-a-'+job.name,'probe',...job.args],{cwd:repo,env,stdio:['ignore','pipe','pipe']});
        let stdout='',stderr=''; child.stdout.on('data',b=>stdout+=b); child.stderr.on('data',b=>stderr+=b); child.on('error',e=>stderr+='spawn:'+e.code);
        const heartbeat=setInterval(()=>console.log(JSON.stringify({running:job.name,used:counts().used})),30000);
        const [code,signal]=await new Promise(r=>child.once('close',(...v)=>r(v))); clearInterval(heartbeat);
        const after=counts(); saveEvidence(here+'/'+job.name+'-dispatch.json',{at:new Date().toISOString(),code,signal,stdout,stderr,before,after});
        if(code!==0) throw Error('包装器/配方失败，见dispatch');
        await validate();
        const r=read(dir+'/result.json'), f=read(dir+'/fingerprints-after.json'), reasons=[];
        if (!r.completed) reasons.push('未完整完成');
        if (!f.unchanged) reasons.push('指纹漂移');
        if (after.used-before.used>job.hard_starts) reasons.push('单任务超过公布硬上限');
        const ref={variant:Number(job.args[3]),...Object.fromEntries(['requested.json','result.json','fingerprints-after.json'].map(n=>[n,hash(dir+'/'+n)]))};
        let recomputed=null;
        if(job.args[0]==='static') versions[job.context]={[job.key]:ref};
        else {
          selection.routes[job.key]=ref;
          const raw=read(dir+'/raw.json'), beforeFx=read(dir+'/fixture-before.json'), afterFx=read(dir+'/fixture-after.json'), cleanup=read(dir+'/cleanup.json'), arm=job.args[2];
          if(r.readback.model!==r.request.model) reasons.push('模型回读不符');
          if(cleanup.fixture_residue!==null||!cleanup.scratch_removed||fs.existsSync(beforeFx.root)) reasons.push('清理不完整');
          if(job.args[0]==='codex') {
            const isolation=read(dir+'/isolation.json');
            if(!isolation.independent_home||isolation.configs.some(c=>c.mcp_sections_present!==false)||r.mcp_calls.length||fs.existsSync(isolation.fakeHome)) reasons.push('隔离或清理失败');
            recomputed=codexCommandEvidence(parseCodexEvents(raw.stdout),read(dir+'/session-events.json'),{fixtureRoot:beforeFx.root,before:beforeFx.target,after:afterFx.target,timedOut:raw.timedOut,code:raw.exitCode},beforeFx.first_word);
            if(arm==='read'&&(!r.actual_read||!recomputed.actual_read||!r.strict_first_word||!r.structured.ok)) reasons.push('原精确读取/首词/结构化条件未通过');
            if(arm==='write'&&(!r.write_pass||!recomputed.write_pass||r.write_control.kind!=='held')) reasons.push('原真实写拒绝条件未通过');
            if(arm==='deny'&&!r.forbidden_read_detection.leaked) reasons.push('原事后检测未通过');
          } else {
            const shape=read(dir+'/production-shape.json');
            if(!r.tool_surface.clean||r.tool_surface.missing.length||r.tool_surface.mcpCount||!shape.readonlyArgs.includes('--strict-mcp-config')) reasons.push('生产工具面不符');
            if(arm==='read'&&(!r.actual_read||!r.strict_first_word||!r.structured.ok)) reasons.push('原读取条件未通过');
            if(arm==='write'&&(!r.write_pass||!claudeWritePass(parseClaudeEvents(raw.stdout),r.write_context))) reasons.push('原真实写拒绝条件未通过');
            if(arm.startsWith('deny-')) {
              recomputed=claudeDenyEvidence(raw,{fixtureRoot:beforeFx.root,tool:arm==='deny-read'?'Read':'Grep',targets:read(dir+'/deny-paths.json').per_file_targets,sentinels:[SENTINEL_PEER,SENTINEL_SECRET]});
              if(!r.deny_pass||!recomputed.deny_pass||r.forbidden_read_detection.leaked) reasons.push('原逐文件实际配对拒绝未通过');
            }
          }
        }
        const proof={at:new Date().toISOString(),job:job.name,pass:reasons.length===0,reasons,original_criteria:true,reference:ref,directory:dir,actual_starts:after.used-before.used,budget:after,model_requested:r.request?.model??null,model_effective:r.readback?.model??null,provider_effective:r.readback?.provider??null,server_identity:null,recomputed};
        saveEvidence(here+'/'+job.name+'-proof.json',proof);proofs.push(proof);
        console.log(JSON.stringify({finished:job.name,pass:proof.pass,reasons,used:after.used}));
        if(!proof.pass) throw Error(reasons.join('；'));
      } catch(e) { failed={job:job.name,error:e.message}; break; }
    }
    saveEvidence(here+'/selection-final.json',selection);
    saveEvidence(here+'/batch-result.json',{at:new Date().toISOString(),failed,completed_jobs:proofs.length,passed_jobs:proofs.filter(p=>p.pass).length,unstarted_jobs:batch.jobs.filter(j=>!fs.existsSync(here+'/'+j.name+'-started.json')).map(j=>j.name),budget:counts(),formal_reviews_started:0,criteria_changed:false,prerequisite_complete:false});
    console.log(JSON.stringify({batch_finished:true,failed,completed:proofs.length,budget:counts()}));
    if(failed)process.exitCode=1;
  }
} else throw Error('用法：prepare | validate | run');
