/** plan认领已完成，原稿仅经archive.ts归档。 */
import fs from 'node:fs';
import path from 'node:path';
import { writeArtifact } from '../../../../dist/test/src/trivium/archive.js';
const topic='Agent双模式接入真实准入收口',content=fs.readFileSync(new URL('./plan-r19-body.md',import.meta.url),'utf8');
const result=await writeArtifact({layout:{archiveRoot:path.resolve('.reviews'),topic},stage:'plan',role:'codex',writer:'driver',driver:'codex',rerunIndex:19,date:'2026-10-11',content});
console.log(JSON.stringify(result));
