/** 11.7 配置备份 / 核对 / 恢复：node s117-config.mjs backup|check|restore。只动夹具 .trivium/config.yaml 这一个文件，零厂商调用。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const here=import.meta.dirname,F='/Users/chenzhenbo/Work/trivium-m11-step12-20261012';
const cfg=path.join(F,'.'+'trivium','config.yaml'),bak=path.join(here,'fixture-config-before-s117.yaml');
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const mode=process.argv[2];
if(mode==='backup'){fs.copyFileSync(cfg,bak,fs.constants.COPYFILE_EXCL);}
else if(mode==='restore'){fs.copyFileSync(bak,cfg);}
else if(mode!=='check')throw Error('用法：backup|check|restore');
console.log(JSON.stringify({mode,config:sha(cfg),backup:fs.existsSync(bak)?sha(bak):null,same:fs.existsSync(bak)&&sha(cfg)===sha(bak)}));
