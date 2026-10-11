/** 最终build后的源码及安装输入核对，供正常安装的前置，零厂商CLI。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { computeBuildStamp } from '../../../../dist/test/src/trivium/build-stamp.js';
import { saveEvidence } from '../../../../scripts/agent-access-evidence.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname);
const record=JSON.parse(fs.readFileSync(path.join(root,'finalbuild-r21-before18.json')));
if(record.code!==0)throw Error('最终build失败');
const source=path.join(repo,'skills/dual-critic/scripts/trivium.cjs'),bytes=fs.readFileSync(source);
const source_stamp=await computeBuildStamp(repo),embedded_inputs=/inputs_sha256: "([a-f0-9]{64})"/.exec(bytes.toString())?.[1];
if(!source_stamp||embedded_inputs!==source_stamp.inputs_sha256)throw Error('最终build输入漂移');
saveEvidence(path.join(root,'final-build-fingerprint-before18.json'),{at:new Date().toISOString(),bundle_sha256:crypto.createHash('sha256').update(bytes).digest('hex'),source_stamp,embedded_inputs,new_vendor_cli_starts:0});
console.log(JSON.stringify({inputs:embedded_inputs,bundle:crypto.createHash('sha256').update(bytes).digest('hex')}));
