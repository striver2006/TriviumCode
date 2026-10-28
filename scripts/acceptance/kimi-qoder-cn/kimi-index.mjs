/** wx 重建证据索引；不调用厂商、不自动延续历史人工预算声明。 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const root=path.resolve(process.argv[2]??path.join(repo,'doc/05_testing/evidence/kimi-macos-20261028'));
const built=await build({stdin:{contents:"export {scanSecrets} from './src/trivium/secrets.ts'",resolveDir:repo},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {scanSecrets}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const entries=[];
for(const file of (await fs.readdir(root)).sort()) {
  if(!file.endsWith('.json')||file.startsWith('index-'))continue;
  const bytes=await fs.readFile(path.join(root,file));const data=JSON.parse(bytes);
  const source=data.source_code;
  entries.push({file,sha256:hash(bytes),bytes:bytes.length,secret_scan_hits:scanSecrets(bytes.toString()).length,
    script_sha256:data.script_sha256??null,source_saved:typeof source==='string',source_matches:typeof source==='string'?hash(source)===data.script_sha256:null,
    native_launches_explicit:data.native_launches??null});
}
const out={schema:'trivium.kimi-evidence-index.v2',at:new Date().toISOString(),admission:false,entries,
  native_launches_explicit_total:entries.reduce((n,x)=>n+(x.native_launches_explicit??0),0),
  count_complete:entries.every(x=>x.native_launches_explicit!==null||x.file.startsWith('official-')),
  count_note:'Historical v1 files have no explicit ledger; null stays unknown, prior manual 60 is not recomputed here.'};
const file=path.join(root,'index-'+Date.now()+'.json');
await fs.writeFile(file,JSON.stringify(out,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({file,files:entries.length,hits:entries.reduce((n,x)=>n+x.secret_scan_hits,0),count_complete:out.count_complete}));
