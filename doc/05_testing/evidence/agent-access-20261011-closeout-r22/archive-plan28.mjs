/** 已按正式入口认领；通过archive.ts唯一出口保存28B原稿，未实施新guard。 */
import fs from 'node:fs';import path from 'node:path';
import {writeArtifact} from '../../../../dist/test/src/trivium/archive.js';
import {hash} from '../../../../scripts/agent-access-selection.mjs';import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),topic='Agent双模式接入真实准入收口',proposal=root+'/post-code27-mechanism-plan-proposal.md',parent='.reviews/'+topic+'/plan/2026-10-12-'+topic+'-r30-codex.md';
const authority=JSON.parse(fs.readFileSync('doc/05_testing/evidence/agent-access-20261011-closeout-r3/formal-round-authorization-v16.json'));
if(hash(parent)!=='9c457711d4146644d9dedd976cbdf854128283df0802ddf32ba6f4bc0cf75d5c'||hash(proposal)!==authority.proposal_ref.sha256)throw Error('父定稿或提案不符');
const content=`---
role: codex
---

# Agent双模式接入真实准入收口：第28B集中补测计划原稿（r31）

本稿须正式三审、逐条裁决及本轮普通plan批准后实施。普通自动审批不采用任何准入判据。第27C run20261011T212239Z已有效并普通code批准；原七整改、原39ed205以来完整代码和历史失败保持。当前生产inputs 7ac37129cdfcf3700c34b24b6e87c76359b4997a4fc7480b53f06762a3d45f4f、bundle1737c946fc2aff5af8ebcb5645ddd25b80da3b38d853d96d0b357f7eabf7272e、main aa6db337315dd60691af966bb2bee1dfc5b0829d；全工作树有文档/测试/证据变化，生产输入dirty=false。

26B父定稿 ${parent}，SHA ${hash(parent)}；27C批准及零漂移实际原件见本独立目录code27-approved-checkpoint.json。提案SHA ${hash(proposal)}。后文完整给出本次新增执行合同，旧r21实现/Schema/全部160文件仍按保存快照原字节只读；不将27C批准冒称本28B批准。

原七整改落点保持：实际sensitive_globs稳定hash/目录事实/消费失效及逐文件回退；3924真实回放来源与逐项覆盖/邻接/原集合；peer_deny_applied生产防御性合取；无事实不做二进制hash且仅本调用精确路径复用；is_error/permission_denials独立缺错重复记录拒绝；受测ASCII五段根/敏感扫描七层，其余目录逐文件；预期追加探针失败保留主成果/清空事实/清理，未知错误抛出。不增加Bash豁免、不扩大目录域、不改产品配置/模型/effort/软件或包版本。

## 路线×实际模型×缺口×可复用证据×新增启动

| 路线 | 历史CLI实际模型 | 原标准缺口 | 可复用证据与边界 | 本计划新增 |
| :--- | :--- | :--- | :--- | :--- |
| Claude/Qwen flash | qwen3.8-flash | 当前完整配置指纹适用性 | 旧496四能力臂完整通过，独立认证方案待Bob决定 | 0；不盲目全重跑 |
| Codex官方三档 | gpt-6.1-sol、gpt-6-luna、gpt-6-astra | 同上；effort回读缺席null | 旧496各完整通过，认证方案待决定 | 0 |
| Codex/Qwen、Kimi、DeepSeek | qwen3.8-flash、kimi-for-coding、deepseek-flash | 同上 | 旧496各完整通过；原复合unknown失败保留 | 0 |
| Claude/Qwen max | qwen3.8-max | 原禁读Read false、生产真实写未测；当前受控机制未测 | 正向A与历史b40机制主成果/事后只读复算，旧停止批次保留 | 新一次性受控B预计2/硬3，首项失败停止全部 |
| Claude/Kimi k3 | k3 | 原禁读Read false、生产真实写未测；受控机制未测 | 正向A，原0次Read拒绝不提升 | 前项全proof通过后受控B预计2/硬3 |
| Claude/Kimi coding | kimi-for-coding | 生产真实写未测；受控机制未测 | 正向A与历史路径事实 | 前项全proof通过后受控B预计2/硬3 |
| Claude/DeepSeek flash | deepseek-flash | 生产真实写未测；受控机制未测 | 正向A；pro不代flash | 前项全proof通过后受控B预计2/硬3 |
| Claude/DeepSeek pro | deepseek-v4-pro | 生产真实写未测；受控机制未测 | 正向A，必须本模型独立样本 | 前项全proof通过后受控B预计2/硬3 |
| Claude官方 | null | 订阅未恢复，未测 | 无在线官方准入证据 | 0，待外部恢复后另具体清单 |

此表新增都是独立受控机制B，actual_provider_inference=false、real_model_attempt/server_identity=null；不满足原生产模型实际尝试标准C。当前6a2 strict canonical 0通过/12未测，旧496 7通过/5未测分列，原false不改。认证独立批准至多建立具名27历史臂的经批准复用报告列，不补本表五组负对照。受限工具面候选仍未采用，M11前置未完成。

`+fs.readFileSync(proposal,'utf8');
const artifact=await writeArtifact({layout:{archiveRoot:repo+'/.reviews',topic},stage:'plan',role:'codex',writer:'driver',driver:'codex',rerunIndex:31,date:'2026-10-12',content});
saveEvidence(root+'/plan28-original-archive.json',{at:new Date().toISOString(),artifact,proposal_sha256:hash(proposal),prior_final_sha256:hash(parent),claim_label:'r42-plan28-claim',new_sensitive_implementation:false,criteria_adopted:false,new_vendor_starts:0});
console.log(JSON.stringify({path:artifact.relPath,sha256:artifact.sha256}));
