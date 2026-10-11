import fs from 'node:fs';
import path from 'node:path';
import { writeArtifact } from '../../../../dist/test/src/trivium/archive.js';
const topic='Agent双模式接入真实准入收口',run='20261011T020308Z',root=path.dirname(new URL(import.meta.url).pathname);
const changes=`# 相对r13的修订（第9次B/plan，run${run}）

- CLAUDE-01：9B三家有效不齐、作废、gate失败或无本轮审批立即停止，不实施、不启动10C。既有round-guard只校启动计数/参数，不机械校审批链；该停机是Driver操作纪律，另存正负情境说明，不冒充原生接口能力。
- CLAUDE-02：quiet-launch-v5.mjs明确纳入新增面。仅用于claim/resolve/preflight的输出摘要，调用后须全文读取completed.stdout并原样播报警告；禁止用于review --start/--wait/--status。本次9B实际通过start-round9→launch-v5，正式等待/状态直接launch-v5；旧包装器不删改。
- CLAUDE-03：计划普通批准后在REPORT_2026-10-11_agent_access_recovery.md追加具采样时间的当前段，明确总10/9B/10C、三审及判据未采用/矩阵/预算；旧总8句保留为历史，逐句核现行/历史归属。
- AGY-01：当前权威测试（原62行）改按v4八ID验证9B/10C/拒11及模拟pointer；历史总8测试（原105行）固定读不可变v3、显式assertFormalRoundCore，保留7/8历史正反边界与旧guard hash。
- AGY-02：未批准判据前所有适用性诊断脚本只落doc/05_testing/evidence/agent-access-20261011-closeout-r4/，不新增scripts生产输入，不为诊断改变848 bundle或INSTALL_INPUT_PATHS。
- AGY-03：第10次正式C/code resolve及start均必须显式--base 39ed20530d64a72f81f183095c6d9516632d0228，核返回base与补丁，不能默认HEAD漏掉已提交整改。
- GLM-01：9B已完成，不能伪造其事前settings测量。本轮实际trace为26960字节、skipped0且三工具压缩事实消费，另记事后核验；后续正式启动前独立检查安装/输入、按实际stage解析路线、生产完整枚举/facts消费/settings≤131072。既有code-only precheck路径与本次事前缺口明确保留，新增v2测量/新版本launcher后纳入10C，不回改launch-v5或旧记录。
- GLM-02：无论判据拒绝或未答复，仍实施r4内只读诊断ledger及必要负例，输出historical-mechanism-only、not-applicable或unknown，approval_record缺席时current_admission_accepted=false，不更改canonical原字段、不将其消费为M11准入。判据消费实现仅在独立明确批准后开展，10C范围写清实际分支。
- GLM-03：已用于审查的launch-v5原件保留hash与旧注释；后续新版本launcher首行标实际入口及沿革，不改旧launcher伪装修复历史。

当前r14是完整定稿：下面合入以上九项；旧r12全文仍作为不编号历史附录逐字保留。接受不等于实施，普通委托审批与判据采用分开。

`;
let body=fs.readFileSync(path.join(root,'plan-r13-body.md'),'utf8').replaceAll('r13送审稿','r14完整修订计划').replace('当前操作以本正文为准','当前操作以r14正文及以上九项修订为准');
body=body.replaceAll('scripts/agent-access-applicability.mjs','doc/05_testing/evidence/agent-access-20261011-closeout-r4/agent-access-applicability.mjs');
body=body.replace('业务正常整改限：','业务正常整改限（AGY-01/GLM-02）：');
body=body.replace('当前权威切换使原动态硬编码总8用例不再适用','原62行实时读取壳按v4八历史ID核9B/10C/拒11及v4模拟pointer，原105行总8案例固定读v3；当前权威切换使原动态硬编码总8用例不再适用');
body=body.replace('新增静态取证/适用性脚本及真正必要负例测试，不能改生产canonical原列的断言。','新增r4静态取证/只读适用性诊断及必要负例无条件实施；未答复/拒绝时ledger不消费判据，输出具原因的历史机制/unknown/not-applicable且current_admission_accepted=false。只有判据独立批准后才实施采用层，不能改生产canonical原列的断言。');
body=body.replace('失效不得approve，不重写失败或删漂移文件。','失效不得approve，不重写失败或删漂移文件。第9次三家有效结论不齐备、任何作废、gate未过或没有本轮审批即停止，不实施、不启动第10次；此为Driver操作纪律，既有round-guard不校审批链，不宣称原生机制兜底。quiet-launch-v5明确纳入新增面，仅claim/resolve/preflight摘要可用且后续必须读取完整输出播报警告，禁止用于review start/wait/status。');
body=body.replace('普通整改和独立批准判据（如有）实施前','普通计划获批后先在恢复报告追加当前总10/9B有效审查/10C待执行、两判据未采用/预算及矩阵段，旧总8段保留按时点解释，并逐句核状态锚。普通整改和独立批准判据（如有）实施前');
body=body.replace('第10次C/code相对39ed20530d64a72f81f183095c6d9516632d0228完整diff','第10次C/code的resolve和start显式传--base 39ed20530d64a72f81f183095c6d9516632d0228，核返回base及完整补丁，覆盖该基线后的完整diff');
body=body.replace('必须三家有效完整意见','本次9B没有事前机械settings测量，实际trace26960字节/skip0只是事后证据。后续新v2 precheck按真实stage解析路线，正式启动前核安装/输入/生产枚举/facts/settings/skip，旧v5不改；新launcher注释准确并纳10C。若判据未答复/拒绝，10C只覆盖普通整改及r4只读诊断，不含采用层。必须三家有效完整意见');
const historical=fs.readFileSync(`.reviews/${topic}/plan/2026-10-11-${topic}-r12-codex.md`,'utf8');
const final=changes+body+'\n\n不编号附录：r12历史全文（逐字保留；当前以r14正文及九项修订为准）\n\n'+historical;
const table=[
['CLAUDE-01','claude','major','有效性/审批链与计数是不同边界，明确停止且不声称guard强制','r14§6及后续10C操作核验'],
['CLAUDE-02','claude','minor','新增摘要包装器必须具名纳范围，警告须读取原件原样反馈','r14§6；正式start/wait/status仅launch-v5或后续新版本'],
['CLAUDE-03','claude','minor','权威状态锚必须追加当前采样，原句不覆盖','r14§7；批准后恢复报告及句族核对'],
['AGY-01','gemini','minor','两处动态测试分别是实时权威与历史固定断言','r14§3；agent-access-recovery.test.ts两用例'],
['AGY-02','gemini','minor','scripts属于生产安装输入，不为只读诊断使38臂失配','r14§4；r4内适用性诊断脚本'],
['AGY-03','gemini','nit','当前HEAD已含原整改，默认HEAD将漏累积diff','r14§7；10C resolve/start显式base39ed2053'],
['GLM-01','glm','minor','接受前置约束补齐；9B已发生不补造事前检查，实际26960/skip0仅事后核验；历史第7次阶段说法保留原件不采信','r14§6/7；新增stage-aware测量/launcher版本，旧v5不改'],
['GLM-02','glm','minor','诊断与采用分支明确：未答复/拒绝也可诊断，不能消费准入','r14§3/4/5/7；r4 ledger始终显式审批缺席/accepted=false'],
['GLM-03','glm','nit','旧脚本已参与冻结不能回改，后续新版本注释准确','r14§7；新launcher入口注释；保留v5及旧件']];
const disposition=`---\nschema: trivium.disposition.v1\ntopic: ${topic}\nstage: plan\nrole: codex\nkind: revised\nrun_id: ${run}\naddresses:\n  - 2026-10-11-${topic}-r6-claude.md\n  - 2026-10-11-${topic}-r6-gemini.md\n  - 2026-10-11-${topic}-r6-glm.md\n---\n\n# 第9次正式计划三审逐条裁决\n\n三家全文均已读取。run success、三家evidence_ok=true、fallback/degraded=false；readonly_breach/peer_artifact_read/forged均false，快照前后tree相同、无subject/related漂移。模型族unknown和embedded历史dirty告警保留，Gemini/GLM无路径级CLI deny不冒充拦截。Claude未展开两判据实质可行性，GLM未逐项展开组件材料，各侧盲区保留，不将三审形式有效当作所有新机制已实测。\n\n| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n`+table.map(([id,role,severity,why,landing])=>`| ${id} | ${role} | ${severity} | 接受 | ${why} | ${landing} |`).join('\n')+'\n\n九项合入完整r14。普通plan委托审批与component-scoped-evidence-v1/restricted-tool-surface-v1采用独立；原矩阵6通过/6未测、原生产写标准不变，M11前置尚未完成。\n';
const layout={archiveRoot:path.resolve('.reviews'),topic};
const written=await writeArtifact({layout,stage:'plan',role:'codex',writer:'driver',driver:'codex',kind:'revised',rerunIndex:6,date:'2026-10-11',content:disposition});
const next=await writeArtifact({layout,stage:'plan',role:'codex',writer:'driver',driver:'codex',rerunIndex:14,date:'2026-10-11',content:final});
fs.writeFileSync(path.join(root,'round9-disposition-archive.json'),JSON.stringify({written,next,accepted:table.map(r=>r[0]),criteria_adopted:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({written,next}));
