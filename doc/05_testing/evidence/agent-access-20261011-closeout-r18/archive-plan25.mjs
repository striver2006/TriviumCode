/** 先认领plan；archive.ts为唯一写出口，Codex原稿r27。 */
import fs from 'node:fs';import path from 'node:path';import {writeArtifact} from '../../../../dist/test/src/trivium/archive.js';
import {hash} from '../../../../scripts/agent-access-selection.mjs';import {saveEvidence} from '../../../../scripts/agent-access-evidence.mjs';
const repo=process.cwd(),root=path.dirname(new URL(import.meta.url).pathname),topic='Agent双模式接入真实准入收口';
const proposal='doc/05_testing/evidence/agent-access-20261011-closeout-r17/post-pilot-mode-plan-proposal.md',prior='.reviews/'+topic+'/plan/2026-10-12-'+topic+'-r26-codex.md';
const supplementary=`## 本轮完整执行边界补充

本轮普通plan只授权独立临时mode设置、固定受控目标、局部取证守卫、测试及只读适用性；不改生产适配器、产品guard/gate/hooks、Bash判据、Schema历史、模型/effort/CLI版本或全局配置，不批准两个候选采用。由24B主合同已经实施的资产不得回滚，所有新整改仍需26C完整代码三审和普通code决定。

认证预检必须按生产1h TTL执行，不能跳过或恢复旧时间。若25B预检再次更新同三具名auth_routes.checked_at，本轮上下文保存前/后确切完整hash与原值语义diff、私有副本清理记录；本计划审查明确覆盖这一次具体时间链相对于原496eed89样本的适用性补充。只允许原r26三个确定键及checked_at，ok必须旧新严格true，时间有效不倒退，全部其它原值/CLI/model/effort/TTL与消费链一致；其它变化即停，不扩大probe.auth或其它routes。本次新时间链未经此正式plan、相应实现核验及Bob独立明确判据批准不得消费旧7组合或5正向；旧fb64诊断仅按其采样时刻保留。

现行独立批准校验approval_valid只说明本地批准原文谱系、事件清单与引用hash，sourceFactsVerified是独立取证评估的必要门，不能凭此布尔声明证明能力；实际产品消费者保持关闭。本次落实消费时必须同时按候选版本重验每一来源原件的合同、当前完整指纹及撤销条件，未知不消费，受控mechanism_pass=false不能填受限通过。sourceFactsVerified不得绕过既有原件完整性/实际机制/当前指纹判定；两候选分开scope与批准，不得把auth诊断批准扩成受限准入批准。

受控新版本保留并明确首次脚本/launcher/批次/失败原件来源，用独立mode2一次性路径，启动必须绑定本轮有效plan run/最终定稿hash/普通批准以及新fixture/guard/helper/launcher/Schema和live原件hash；不得向原variant1目录写入。临时permissions.defaultMode只从指定live init默认权限default映射，配置文件独立0600且只此键，不能新增allow或工具；生成的文件、生产注入settings和argv分别分列，不把临时settings称生产复制件。模型声明/effort/软件和全局配置保持，actual_provider_inference=false、server_identity=null，唯一OS映像与预算记录核实原wrapper到同native实际消费，缺任何事实均unknown并停。

限额和清理测试必须调用独立夹具实际接入的helper，而不是另造未接线模拟器：监听127.0.0.1、合法端点与协议输入、请求数/每请求及总字节、运行时超时、异常记录；HTTP异常/关闭时等待在途handler完结后再聚合错误，避免清理之后迟到异常漏记。主probe已有成果保留，未知内部错误不吞，多个清理任务全部尝试，失败合并并脱敏wx落盘；没有资源与失败清理仍明确null/false，不称完成。模式2所有目标数量从生产enumerateDenyPaths及原manifest的N派生；两写+2N路径+合法README与权限2N，现有白名单/精确配对谓词不扩大，少/多/错/重复/悬空、unknown状态与清理失败均拒绝。

授权作用面和来源重复、原文/版本/plan/hash/可信原消息、事件完整清单/未知/撤销/损坏/冲突等负例新增或补全；局部JSON Schema与唯一渲染源真实对账。真正的Bob消息缺席仍没有实际判据批准，普通自动approve、轮数授权、模拟或Driver推荐不替代；不声称密码学用户身份证明。

当前第25B额度review313/333、预计15硬20、累计止333，admission732/742且本轮计划审查新增0。批准后mode2两组合各一次预计4、硬6、累计最多738，成功后另批其余三组合预计6硬8，事前发布并按实际需要追加池上限，失败即停、不循环调参。正式本轮v14只有25B、26C（27拒绝），原未执行25C被明示替代，24次历史及全部失败/判据/旧台账保留；原生无专用例外接口，沿已审的授权hash+现有启动守卫+归档实记计数+正式context冻结机制记录。

全部静态审计、报告、指纹与原件先落盘，审查和人工/委托审批停点不改业务或被审证据。计划审批后同步设计补丁、ADR003、PROTOCOL、坑指南、手册、RUNBOOK、验收剧本、恢复报告及索引；实际入口措辞才改skills-src再渲染。最终代码重审覆盖原39ed205基线至当前完整产品整改及本轮独立取证资产。产品安装作用面如变，须先回报具体影响，串行两check、14/14、重建重装及必要真实刷新不省略；同生产作用面旧检查与新局部检查分列。
`;
const body='---\nrole: codex\n---\n\n# Agent双模式接入真实准入收口：第25B补充计划原稿（r27）\n\n原七整改已通过有效23C、24B完整r26已普通批准，本稿不回滚。首次受控pilot模式不符的证据已取得且后续未启动；本次新临时设置及集中补正尚未实施，等正式plan审查与普通批准。v14仅25B/26C、27拒绝，判据采用未批准。\n\n提案来源SHA '+hash(proposal)+'，父定稿r26 SHA '+hash(prior)+'。以下本次补充与父合同完整适用；父合同中的24/25轮数、旧localfb64及待实施描述按其采样时刻解释，现行v14与本次预检原件优先，不将旧正文改写。\n\n'+fs.readFileSync(proposal,'utf8')+'\n\n'+supplementary+'\n\n## 附录：第24B已批准r26完整合同及历史边界\n\n'+fs.readFileSync(prior,'utf8');
const artifact=await writeArtifact({layout:{archiveRoot:repo+'/.reviews',topic},stage:'plan',role:'codex',writer:'driver',driver:'codex',rerunIndex:27,date:'2026-10-12',content:body});
saveEvidence(root+'/plan25-original-archive.json',{at:new Date().toISOString(),artifact,proposal_sha256:hash(proposal),prior_final_sha256:hash(prior),claim_label:'r36-plan25-claim',new_mode_implemented:false,criteria_adopted:false,new_vendor_starts:0});
console.log(JSON.stringify({path:artifact.relPath,sha256:artifact.sha256,new_vendor_starts:0}));
