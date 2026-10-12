/** 26B/r30当前唯一合同；设计#agent-access-inline-mode3-contract，旧合同只读历史。 */
const ref={type:'object',required:['path','sha256'],properties:{path:{type:'string',minLength:1},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'}},additionalProperties:false};
const scope={type:'array',minItems:1,uniqueItems:true,items:{type:'object',required:['route','model','arm','source_refs'],properties:{route:{type:'string',minLength:1},model:{type:'string',minLength:1},arm:{type:'string',minLength:1},source_refs:{type:'array',minItems:1,uniqueItems:true,items:ref}},additionalProperties:false}};
export const approvalSchema={
 $schema:'https://json-schema.org/draft/2020-12/schema',type:'object',
 required:['schema','decision_id','topic','criterion_version','decision','scope','plan_run_id','plan_final_ref','user_decision_ref','user_statement_exact','initiator','performed_by','delegated','session_id','reason','approved_at','revocation_conditions','consumer_version','consumer_sha256','can_prove','cannot_prove'],
 properties:{schema:{const:'criteria-approval.v1'},decision_id:{type:'string',minLength:1},topic:{type:'string',minLength:1},criterion_version:{type:'string',minLength:1},decision:{enum:['approved','rejected']},scope,plan_run_id:{type:'string',minLength:1},plan_final_ref:ref,user_decision_ref:ref,user_statement_exact:{type:'string',minLength:1},initiator:{type:'string',minLength:1},performed_by:{type:'string',minLength:1},delegated:{const:false},session_id:{type:['string','null']},reason:{type:'string',minLength:1},approved_at:{type:'string',minLength:1},revocation_conditions:{type:'array',minItems:1,items:{type:'string',minLength:1}},consumer_version:{type:'string',minLength:1},consumer_sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},can_prove:{type:'array',minItems:1,items:{type:'string',minLength:1}},cannot_prove:{type:'array',minItems:1,items:{type:'string',minLength:1}}},additionalProperties:false,
};
export const revocationSchema={
 $schema:'https://json-schema.org/draft/2020-12/schema',type:'object',required:['schema','event_id','decision_id','criterion_version','source_ref','reason','at'],
 properties:{schema:{const:'criteria-revocation.v1'},event_id:{type:'string',minLength:1},decision_id:{type:'string',minLength:1},criterion_version:{type:'string',minLength:1},source_ref:ref,reason:{type:'string',minLength:1},at:{type:'string',minLength:1}},additionalProperties:false,
};

export const CANDIDATE_VERSIONS=Object.freeze(['restricted-tool-surface-and-path-v3','auth-cache-timestamp-applicability-v1']);
