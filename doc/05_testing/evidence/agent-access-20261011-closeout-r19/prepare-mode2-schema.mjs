/** 独立取证Schema追加生命周期形状；历史Schema及生产Schema不变。25B/r28已批准。 */
import fs from 'node:fs';import path from 'node:path';import {Ajv2020} from 'ajv/dist/2020.js';
import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';import {hash} from '../../../../scripts/agent-access-selection.mjs';
const root=path.dirname(new URL(import.meta.url).pathname),source=path.resolve(root,'../agent-access-20261011-closeout-r17/controlled-mechanism.v1.schema.json'),checkpoint=JSON.parse(fs.readFileSync(root+'/plan25-approved-checkpoint.json','utf8'));
if(hash(checkpoint.final.path)!==checkpoint.final.sha256||checkpoint.approval.decision!=='approved')throw Error('25B批准定稿不符');
const schema=JSON.parse(fs.readFileSync(source,'utf8'));
schema.required.push('production_target_count','production_manifest_verified','mode_settings','limits','completed','writes','reads','greps','global_pairing');
schema.properties.production_target_count={type:['integer','null'],minimum:1};schema.properties.production_manifest_verified={type:'boolean'};schema.properties.completed={type:'boolean'};
schema.properties.cleanup.required.push('mode_settings_removed');schema.properties.cleanup.properties.mode_settings_removed={type:['boolean','null']};
schema.$defs.mode_snapshot={type:['object','null'],properties:{valid:{type:'boolean'},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},bytes:{type:'integer',minimum:1},mode:{type:'integer',minimum:0},single_key:{type:'boolean'},reason:{type:['string','null']}},required:['valid'],additionalProperties:false};
schema.properties.mode_settings={type:['object','null'],required:['before','after','removed'],properties:{before:{$ref:'#/$defs/mode_snapshot'},after:{$ref:'#/$defs/mode_snapshot'},removed:{type:['boolean','null']}},additionalProperties:false};
const limitKeys=['requests','per_request_bytes','total_body_bytes','runtime_ms'];
schema.properties.limits={type:['object','null'],required:['requests','bodyBytes','max_request_bytes','started_at','finished_at','host','limits','handlers_finished','server_closed','within_limits','errors'],properties:{
 requests:{type:'integer',minimum:0},bodyBytes:{type:'integer',minimum:0},max_request_bytes:{type:'integer',minimum:0},started_at:{type:['integer','null']},finished_at:{type:['integer','null']},host:{type:'string'},limits:{type:'object',required:limitKeys,properties:Object.fromEntries(limitKeys.map(k=>[k,{type:'integer',minimum:1}])),additionalProperties:false},handlers_finished:{type:'boolean'},server_closed:{type:['boolean','null']},within_limits:{type:['boolean','null']},errors:{type:'array',items:{type:'object'}},
 },additionalProperties:false};
new Ajv2020({strict:true,allErrors:true}).compile(schema);
saveEvidence(root+'/controlled-mechanism.v1.schema.json',schema);
saveEvidence(root+'/mode2-schema-origin.json',{at:new Date().toISOString(),source_ref:{path:source,sha256:hash(source)},output_ref:{path:root+'/controlled-mechanism.v1.schema.json',sha256:hash(root+'/controlled-mechanism.v1.schema.json')},generator_sha256:hash(new URL(import.meta.url)),plan_final_ref:checkpoint.final,historical_schema_modified:false,production_schema_modified:false,new_vendor_starts:0});
console.log(JSON.stringify({schema_sha256:hash(root+'/controlled-mechanism.v1.schema.json'),new_vendor_starts:0}));
