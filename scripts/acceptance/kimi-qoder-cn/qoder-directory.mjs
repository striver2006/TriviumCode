/** 当前 CN 目录/默认原始取证；认证只进一次性 HOME，不修改用户设置。 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const repo = path.resolve(import.meta.dirname, '../../..');
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'trivium-cn-model-'));
await fs.chmod(temp, 0o700);
const config = path.join(temp, '.qoder-cn');
const source = path.join(os.homedir(), '.qoder-cn');
const globalSettings = path.join(source, 'settings.json');
const before = hash(await fs.readFile(globalSettings));
const evidence = {at: new Date().toISOString(), platform: process.platform, settings_before: before, calls: [], cleanup: null};
const secretValues = [];
try {
  await fs.mkdir(path.join(config, '.auth'), {recursive:true, mode:0o700});
  for (const name of ['user', 'machine_id']) {
    const value = await fs.readFile(path.join(source, '.auth', name));
    try {
      const collect = v => {if(typeof v==='string')secretValues.push(v);else if(v&&typeof v==='object')Object.values(v).forEach(collect);};
      collect(JSON.parse(value.toString()));
    } catch { secretValues.push(value.toString()); }
    await fs.writeFile(path.join(config, '.auth', name), value, {mode:0o600});
  }
  await fs.writeFile(path.join(config, 'settings.json'), JSON.stringify({general:{enableAutoUpdate:false}}), {mode:0o600});
  await build({stdin:{contents:"export {run} from './src/trivium/util/exec.ts'; export {redactSecrets} from './src/trivium/secrets.ts';",resolveDir:repo},bundle:true,platform:'node',format:'esm',outfile:path.join(temp,'runtime.mjs'),logLevel:'silent'});
  const {run,redactSecrets} = await import(pathToFileURL(path.join(temp,'runtime.mjs')).href);
  const safe = value => {
    let out=redactSecrets(value).content;
    for(const s of secretValues)if(s.length>=8)out=out.split(s).join('[REDACTED]');
    return out.split(os.homedir()).join('~').split(temp).join('<TEMP>');
  };
  const bin = path.join(os.homedir(), '.local/bin/qoderclicn');
  evidence.cli_sha256 = hash(await fs.readFile(bin));
  const env={...process.env,HOME:temp,USERPROFILE:temp};
  for(const k of Object.keys(env))if(/^(QODER|ANTHROPIC|OPENAI|CODEX|TRIVIUM)_/.test(k)||k==='NODE_OPTIONS')delete env[k];
  env.QODERCN_CONFIG_DIR=config;
  const args=['--config-dir',config,'--setting-sources','user'];
  const cases=[['version',['--version']],['catalog',[...args,'--list-models']]];
  if(process.argv.includes('--default'))cases.push(['default',[...args,'--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--no-session-persistence','--output-format','stream-json','-p','Reply OK only.']]);
  for(const [name,argv] of cases) {
    const result=await run(bin,argv,{cwd:temp,env,timeoutMs:name==='version'?15000:90000,killTree:true});
    evidence.calls.push({name,...result,stdout:safe(result.stdout),stderr:safe(result.stderr),commandLine:safe(result.commandLine)});
    console.log(JSON.stringify({name,code:result.code,stdout:safe(result.stdout),stderr:safe(result.stderr)}));
  }
} finally {
  await fs.rm(temp,{recursive:true,force:true});
  evidence.cleanup={ok:true};
  evidence.settings_after=hash(await fs.readFile(globalSettings));
  const root=path.join(repo,'doc/05_testing/evidence/qoder-cn-model-20261028');
  await fs.mkdir(root,{recursive:true});
  const file=path.join(root,`directory-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomBytes(3).toString('hex')}.json`);
  await fs.writeFile(file,JSON.stringify(evidence,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log(JSON.stringify({file,settings_unchanged:evidence.settings_after===before,cleanup:evidence.cleanup}));
}
