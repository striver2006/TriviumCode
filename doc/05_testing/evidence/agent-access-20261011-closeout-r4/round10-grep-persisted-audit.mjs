/** 第10次Claude持久Grep结果只读对账；仅保存hash/路径，不复制结果正文或改旧运行。 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseClaudeEvents} from '../../../../dist/test/src/trivium/adapters/claude-trace.js';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const topic='Agent双模式接入真实准入收口',runId='20261011T024158Z';
const repo=process.cwd(),self=fileURLToPath(import.meta.url),here=path.dirname(self);
const run=JSON.parse(fs.readFileSync(path.join(repo,'.reviews',topic,'code/_meta',`run-${runId}.json`)));
if(run.run_id!==runId||run.status!=='success'||run.guard?.peer_artifact_read!==false)throw Error('原运行元数据不符');
const raw=path.join(os.homedir(),'.trivium/runs/TriviumCode-2217d505',runId,'claude/out/stdout.jsonl');
const bytes=fs.readFileSync(raw),trace=parseClaudeEvents(bytes.toString('utf8'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const id='toolu_e9a0e5acd4844f9490b21db6';
const grepUse=trace.toolUses.filter(u=>u.id===id);
if(grepUse.length!==1||grepUse[0].name!=='Grep'||grepUse[0].input.path!==repo||
  grepUse[0].input.output_mode!=='content'||trace.erroredToolUseIds.has(id))throw Error('Grep调用边界不符');
const grepReturn=trace.toolResults.get(id);
if(!grepReturn)throw Error('Grep结果缺失');
const m=/Full output saved to: ([^\n]+)\n/.exec(grepReturn);
if(!m)throw Error('持久结果路径缺失');
const file=m[1];
if(!path.isAbsolute(file)||!file.startsWith(path.join(os.homedir(),'.claude/projects/') )||
  path.basename(file)!==`${id}.txt`||!file.includes(trace.sessionId))throw Error('持久文件不属于本会话工具ID');
const stat=fs.lstatSync(file);
if(!stat.isFile()||stat.isSymbolicLink())throw Error('持久文件形态不符');
const full=fs.readFileSync(file),fullText=full.toString('utf8');
if(!Buffer.from(fullText,'utf8').equals(full))throw Error('完整结果编码漂移');
const reads=trace.toolUses.filter(u=>u.name==='Read'&&u.input.file_path===file);
if(reads.length!==1||!reads[0].id||trace.erroredToolUseIds.has(reads[0].id))throw Error('持久结果Read不唯一或失败');
const readResult=trace.toolResults.get(reads[0].id);
if(!readResult)throw Error('持久结果Read响应缺失');
const parsePaths=value=>[...new Set(value.split('\n').map(line=>/^([^:]+):\d+:/.exec(line)?.[1])
  .filter(p=>typeof p==='string'&&p.includes('/')).map(p=>p.startsWith(repo+'/')?path.relative(repo,p):p))];
const fullPaths=parsePaths(fullText),readPaths=parsePaths(readResult);
const deny=run.deny_paths;
if(!Array.isArray(deny)||deny.length<3900)throw Error('生产完整禁读集合缺失');
const overlaps=paths=>paths.flatMap(p=>deny.filter(d=>p===d||p.startsWith(d.endsWith('/')?d:d+'/')).map(d=>({path:p,deny:d})));
const prefix='.reviews/'+topic+'/';
const classify=p=>p.startsWith(prefix)?'same-topic-review-tree':p.startsWith('.reviews/')?'other-topic-review-tree':'ordinary';
const rolePaths=paths=>paths.map(p=>({path:p,scope:classify(p),in_actual_read:readPaths.includes(p)}));
const sourceHash=hash(fs.readFileSync(self));
saveEvidence(path.join(here,'round10-grep-persisted-audit.json'),{
  at:new Date().toISOString(),schema:'trivium.access.grep-persisted-audit.v1',run_id:runId,review_status_original:run.status,
  original_guard_peer_artifact_read:run.guard.peer_artifact_read,real_cli_starts:0,
  source:{script:self,sha256:sourceHash,run_meta:path.join(repo,'.reviews',topic,'code/_meta',`run-${runId}.json`),
    run_meta_sha256:hash(fs.readFileSync(path.join(repo,'.reviews',topic,'code/_meta',`run-${runId}.json`))),
    stdout:raw,stdout_sha256:hash(bytes),persistent_file:file,persistent_sha256:hash(full),persistent_bytes:full.length},
  grep:{id,input:grepUse[0].input,return_sha256:hash(Buffer.from(grepReturn)),return_bytes:Buffer.byteLength(grepReturn),
    full_line_count:fullText.split('\n').length,full_paths:rolePaths(fullPaths)},
  read:{id:reads[0].id,input:reads[0].input,response_sha256:hash(Buffer.from(readResult)),response_bytes:Buffer.byteLength(readResult),
    line_count:readResult.split('\n').length,paths:rolePaths(readPaths)},
  deny:{count:deny.length,run_deny_paths_sha256:hash(Buffer.from(JSON.stringify(deny))),
    full_result_overlaps:overlaps(fullPaths),actual_read_overlaps:overlaps(readPaths)},
  inference:'只核两份文本中可解析的路径与本轮生产deny集合；不能由零重叠外推未列工件或未解析格式均隔离。',
  original_run_unchanged:true,criteria_adopted:false});
console.log(JSON.stringify({full_paths:fullPaths.length,actual_read_paths:readPaths.length,
  review_tree_full:fullPaths.filter(p=>p.startsWith('.reviews/')).length,
  review_tree_read:readPaths.filter(p=>p.startsWith('.reviews/')).length,
  full_overlaps:overlaps(fullPaths).length,read_overlaps:overlaps(readPaths).length,
  persistent_bytes:full.length,read_response_bytes:Buffer.byteLength(readResult),real_cli_starts:0}));
