/** 零CLI补证：逐行剥Read呈现编号，严格还原持久Grep文件全部字节。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {parseClaudeEvents} from '../../../../dist/test/src/trivium/adapters/claude-trace.js';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const auditFile=path.join(here,'round10-grep-persisted-audit-v2.json');
const audit=JSON.parse(fs.readFileSync(auditFile));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
if(audit.run_id!=='20261011T024158Z'||audit.grep.id!=='toolu_e9a0e5acd4844f9490b21db6'||
  audit.deny.full_result_overlaps.length||audit.deny.actual_read_overlaps.length)throw Error('核验输入范围不符');
const raw=fs.readFileSync(audit.source.stdout),persisted=fs.readFileSync(audit.source.persistent_file);
if(sha(raw)!==audit.source.stdout_sha256||sha(persisted)!==audit.source.persistent_sha256)throw Error('原始结果hash漂移');
const trace=parseClaudeEvents(raw.toString('utf8'));
const readResult=trace.toolResults.get(audit.read.id);
if(typeof readResult!=='string'||sha(Buffer.from(readResult))!==audit.read.response_sha256)throw Error('Read响应缺失或漂移');
const lines=readResult.split('\n');
const numberPrefix=/^\s*\d+\t/;
if(!lines.length||lines.some(l=>!numberPrefix.test(l)))throw Error('Read行号形态未全量满足');
const normalized=lines.map(l=>l.replace(numberPrefix,'')).join('\n');
if(!Buffer.from(normalized,'utf8').equals(persisted))throw Error('Read内容不能严格还原持久文件');
const paths=audit.read.paths.map(p=>p.path);
if(paths.length!==audit.grep.full_paths.length||audit.grep.full_paths.some(p=>!paths.includes(p.path)))throw Error('完整路径与实际Read路径不等');
saveEvidence(path.join(here,'round10-grep-read-exact-verify.json'),{at:new Date().toISOString(),run_id:audit.run_id,
  script_sha256:sha(fs.readFileSync(fileURLToPath(import.meta.url))),v2_audit_sha256:sha(fs.readFileSync(auditFile)),
  full_file_sha256:sha(persisted),actual_read_response_sha256:sha(Buffer.from(readResult)),
  read_lines:lines.length,all_lines_numbered:true,normalized_bytes:Buffer.byteLength(normalized),
  normalized_exactly_equals_persistent_file:true,distinct_paths:paths.length,same_path_set:true,
  actual_read_deny_overlap:audit.deny.actual_read_overlaps.length,
  actual_read_external_historical_briefs:paths.filter(p=>/^\.reviews\/.*\/_meta\/brief-(?:gemini|glm)-/.test(p)),
  historical_run_unchanged:true,real_cli_starts:0,criteria_adopted:false});
console.log(JSON.stringify({read_lines:lines.length,normalized_bytes:Buffer.byteLength(normalized),exact:true,
  distinct_paths:paths.length,external_briefs:paths.filter(p=>/^\.reviews\/.*\/_meta\/brief-(?:gemini|glm)-/.test(p)).length,
  deny_overlap:0,real_cli_starts:0}));
