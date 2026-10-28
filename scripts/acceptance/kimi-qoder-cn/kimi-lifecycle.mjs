/** 外层监督者持有凭据夹具；强杀 native/包装进程后仍由监督者确认整组退出再清理。 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

if(process.platform!=='darwin')throw Error('仅 macOS 生命周期机制实验');
const here=path.dirname(fileURLToPath(import.meta.url));
const temp=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'trivium-kimi-life-')));
await fs.chmod(temp,0o700);
const output=path.resolve(process.argv[2]??path.join(here,'../../../doc/05_testing/evidence/kimi-macos-20261028'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const manifest={schema:'trivium.kimi-lifecycle.v1',at:new Date().toISOString(),source_kind:'controlled-wrapper-with-real-native-cli',admission:false,real_credentials:false,arms:[]};
let server,runtime,stop,interrupted=false;
const interrupt=()=>{interrupted=true;stop?.();};
for(const s of ['SIGTERM','SIGINT','SIGHUP'])process.once(s,interrupt);
function rows() {
  const p=spawnSync('/bin/ps',['-axo','pid=,ppid=,pgid=,stat=,lstart='],{encoding:'utf8',env:{...process.env,TZ:'UTC',LC_ALL:'C'}});
  if(p.status!==0)return null;
  return p.stdout.split('\n').flatMap(l=>{const m=/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/.exec(l);return m?[{pid:+m[1],ppid:+m[2],pgid:+m[3],stat:m[4],lstart:m[5].trim()}]:[];}).filter(x=>!x.stat.startsWith('Z'));
}
try {
  await build({stdin:{contents:`export {run,newProbeSection,withProbeSection,terminateProbeSectionGroups} from './src/trivium/util/exec.ts';`,resolveDir:path.resolve(here,'../../..')},bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'runtime.mjs'),logLevel:'silent'});
  runtime=await import(pathToFileURL(path.join(temp,'runtime.mjs')).href);
  const bin=path.join(temp,'kimi-native');await fs.copyFile(path.join(os.homedir(),'.kimi-code/bin/kimi'),bin);await fs.chmod(bin,0o700);
  manifest.cli_sha256=hash(await fs.readFile(bin));
  let requested=false;
  server=http.createServer(async(req,res)=>{for await(const chunk of req){void chunk;}requested=true;res.writeHead(200,{'content-type':'text/event-stream'});res.write(': held by synthetic provider\n\n');});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const home=path.join(temp,'config');await fs.mkdir(home,{mode:0o700});
  const token='SYNTHETIC_'+crypto.randomBytes(24).toString('hex');
  await fs.writeFile(path.join(home,'config.toml'),`default_model="probe"\nmerge_all_available_skills=false\nbuiltin_product_skills=false\ntelemetry=false\n[providers.probe]\ntype="openai"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\napi_key="${token}"\n[models.probe]\nprovider="probe"\nmodel="probe"\nmax_context_size=32768\n`,{mode:0o600});
  await fs.writeFile(path.join(home,'tui.toml'),'[upgrade]\nauto_install=false\n',{mode:0o600});
  const env={...process.env};for(const k of Object.keys(env))if(/^(KIMI|MOONSHOT|OPENAI|ANTHROPIC|TRIVIUM)_/.test(k)||['NODE_OPTIONS','BUN_OPTIONS'].includes(k))delete env[k];env.KIMI_CODE_HOME=home;
  const helper=path.join(temp,'helper.mjs');
  await fs.writeFile(helper,"process.on('SIGTERM',()=>{});setInterval(()=>{},1000);",{mode:0o600});
  const wrapper=path.join(temp,'wrapper.mjs');
  await fs.writeFile(wrapper,`import {spawn} from 'node:child_process';process.on('SIGTERM',()=>{});spawn(process.execPath,[${JSON.stringify(helper)}],{stdio:'ignore'});const c=spawn(${JSON.stringify(bin)},['-p','Say PROBE_DONE','--output-format','stream-json'],{stdio:['ignore','pipe','pipe']});c.stdout.pipe(process.stdout);c.stderr.pipe(process.stderr);setInterval(()=>{},1000);`,{mode:0o600});
  for(const name of ['success','failure','term-tree','force-kill-tree']) {
    if(interrupted)throw Error('interrupted');
    requested=false;const scope=runtime.newProbeSection(name),samples=[];let injected=false;
    const cancel=name.endsWith('tree');
    const timer=setInterval(()=>{
      const table=rows();
      for(const g of scope.groups){const members=table?.filter(x=>x.pgid===g.pgid)??null;if(members?.length)samples.push({pgid:g.pgid,members});
        if(cancel&&requested&&!injected&&members?.length>=3&&g.child.exitCode===null&&g.child.signalCode===null){injected=true;if(name==='force-kill-tree')process.kill(-g.pgid,'SIGSTOP');stop?.();}}
    },100);
    let r,ended;
    try {r=await runtime.withProbeSection(scope,()=>runtime.run(cancel?process.execPath:bin,cancel?[wrapper]:name==='success'?['--version']:['--nonexistent-trivium-option'],{cwd:temp,env,killTree:true,timeoutMs:7000,killGraceMs:500,stopEarly:s=>{stop=s;}}));}
    finally {clearInterval(timer);stop=undefined;ended=await runtime.terminateProbeSectionGroups([scope],{graceMs:500,killWaitMs:3000});}
    const after=rows(),identities=samples.flatMap(x=>x.members);
    const survivors=after===null?null:identities.filter(x=>after.some(y=>y.pid===x.pid&&y.lstart===x.lstart));
    manifest.arms.push({name,requested,controlled_descendant_wrapper:cancel,samples,injected,...r,commandLine:undefined,tree_shutdown:ended,identity_survivors:survivors,
      tree_exit_verified:survivors!==null&&survivors.length===0&&ended.remaining.length===0});
    console.log(JSON.stringify({arm:name,code:r.code,signal:r.signal,injected,survivors:survivors?.length??null}));
    if(ended.remaining.length||survivors===null||survivors.length)throw Error('tree-exit-unverified');
  }
  manifest.credential_fixture={kind:'synthetic-only',mode:(await fs.stat(path.join(home,'config.toml'))).mode&0o777};
  manifest.cli_sha256_after=hash(await fs.readFile(bin));
} catch(e){manifest.error=e.message;process.exitCode=1;}
finally {
  if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  // 无真实凭据；若树退出核对失败仍保留事实，不宣称 real credential 生命周期合格。
  let cleanupError=null;
  try {await fs.rm(temp,{recursive:true,force:true,maxRetries:3});}catch(e){cleanupError=e.message;process.exitCode=1;}
  manifest.cleanup={root_absent:await fs.access(temp).then(()=>false,()=>true),error:cleanupError,real_credential_cleanup_verified:false};
  await fs.mkdir(output,{recursive:true});const file=path.join(output,`kimi-lifecycle-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.json`);
  const safe=JSON.stringify(manifest,null,2).replaceAll(os.homedir(),'~');
  await fs.writeFile(file,safe+'\n',{mode:0o600,flag:'wx'});console.log(JSON.stringify({file,error:manifest.error,cleanup:manifest.cleanup}));
  for(const s of ['SIGTERM','SIGINT','SIGHUP'])process.removeListener(s,interrupt);
}
