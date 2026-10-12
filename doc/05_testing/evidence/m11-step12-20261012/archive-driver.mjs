/** 验收Driver工件的唯一落盘助手；命名与防覆盖仍由生产archive.ts实现。 */
import fs from 'node:fs';
import path from 'node:path';
import {writeArtifact} from '../../../../dist/test/src/trivium/archive.js';
import {readTask} from '../../../../dist/test/src/trivium/meta.js';
const config=JSON.parse(fs.readFileSync(import.meta.dirname+'/client-batch.json'));
if(process.cwd()!==config.fixture)throw Error('验收项目不符');
const input=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!config.topics.includes(input.topic)||!['plan','code','bug'].includes(input.stage))throw Error('主题/阶段不在本批');
const layout={archiveRoot:path.join(process.cwd(),'.reviews'),topic:input.topic};
const task=await readTask(layout),claimed=task?.drivers?.[input.stage]?.driver;
if(['plan','bug'].includes(input.stage)&&claimed!==input.driver)throw Error('先认领本阶段');
if(input.role!==input.driver)throw Error('只能产出本轮Driver工件');
console.log(JSON.stringify(await writeArtifact({layout,stage:input.stage,writer:'driver',driver:input.driver,role:input.role,kind:input.kind??null,rerunIndex:input.rerunIndex,content:input.content,date:'2026-10-12'})));
