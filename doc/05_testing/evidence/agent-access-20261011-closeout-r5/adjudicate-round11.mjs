/** 第11次B/plan三侧全文裁决，经archive.ts唯一写出口归档。 */
import fs from 'node:fs';
import path from 'node:path';
import { writeArtifact } from '../../../../dist/test/src/trivium/archive.js';
const topic = 'Agent双模式接入真实准入收口', run = '20261011T031230Z';
const root = path.dirname(new URL(import.meta.url).pathname);
const body = fs.readFileSync(path.join(root, 'plan-r15-body.md'), 'utf8');
const changes = `# 相对r15的修订（第11次B/plan，run${run}）

- CLAUDE-01、AGY-01：实时读取壳及新v2纯核验切v5（历史10ID，11B/12C/拒13）；总10的9B/10C旧边界固定读取不可变v4并显式第5参。总6/7/8历史fixture与旧guard原件继续保留。当前check在计划期对动态v4断言失配只是静态推断，获批后执行定向与全check，不把未跑的检查说成已红实测。
- CLAUDE-02、AGY-02、GLM-01、GLM-03：launch-v7第1行误写launch-v6路径且尾注误写v5，原件不回改；在当前恢复报告追加具时刻勘误，明确11B实际走v7/旧guard/v5授权。新建launch-v8.mjs作为12C正式入口，首行准确、import round-guard-v2.mjs、记录v2 guard hash；quiet-launch-v6只委托v8。v5/v6/v7字节与历史收据均保留。
- CLAUDE-03：恢复报告及doc/05_testing/README.md、r3目录README核当前总12/v5/11B口径；旧总10句保留时点标记，逐句检查其他设计/协议/手册/测试文档中的现行指针。入口措辞不涉及skills-src时明确记“未触及”，若实际改命令入口才从源render。
- AGY-03：修改recipes后先串行两次check、build、node dist/install.cjs，formal-start-precheck-v2核inputs_match与install_matches_source及settings/事实/skip全部通过，再允许12C启动；不把此序列当成准入实测。
- GLM-02：四目标安装后另核七份共享重名目录仍缺席、备份逐文件内容一致；复现即停止安装/交付，记录时点并按现有获批恢复方案处理，来源未明仍标unknown。
- GLM-04：quiet-v6白名单在预算/子进程前判mode必须tv、首个子命令token必须恰为topic claim、topic resolve或preflight。claim需唯一--topic/--stage/--driver；resolve需唯一--stage与双短横线焦点分隔符；preflight需唯一--stage/--driver/--critics；值仍交产品CLI验证，其余旗标原样透传。全部review/probe/未知首token拒绝，正反例核0 spawn/0预算增量。
- GLM-05：BRIEF扩禁若未来提出，当前v5只允11/12，第13次先停并另向Bob取得正式轮数授权后再独立审；12C不扩大为扩禁评审。原禁读与准入判据不变。

本r16正文与以下具名修订共同组成完整当前计划；历史r14全文继续置于不编号附录。接受意见仅经本轮普通计划批准后实施，不包含准入判据批准。\n\n`;
const integration = `\n## 第11次三审合入的实施约束\n\n` +
`**测试与权威。** 当前指针v5已生效，获批后先把test/unit/agent-access-recovery.test.ts实时用例切至round-guard-v2，核10个历史ID、11B及模拟11后12C、13拒绝、缺第5参拒绝、v4旧权威拒绝；旧总10的9B/10C用例固定读不可变v4并显式第5参，原总6/7/8用例和旧guard hash不改。测试尚未实际重跑，静态失配不可称check实测失败。\n\n` +
`**生产接线与沿革。** 新建launch-v8.mjs，准确注释调用路径与v7→v8、v5授权、v2守卫，正式12C的start/wait/status直接用v8；其调用收据中的round_guard_sha256必须对应round-guard-v2.mjs。新quiet-launch-v6只委托v8并在前置阶段实施白名单：mode=tv，首命令序列仅topic claim/topic resolve/preflight；claim唯一--topic/--stage/--driver，resolve唯一--stage及--正文分隔符，preflight唯一--stage/--driver/--critics；其余旗标和值由编排器原CLI校验，不能以白名单代替原CLI预检。review各子命令、probe及未知模式均拒绝，拒绝前不spawn/不计预算。旧launch-v7首行误写v6路径和v5保留尾注，字节与收据不动，恢复报告具时刻勘误并写11B实走v7。\n\n` +
`**文档、安装与复审时序。** REPORT_2026-10-11_agent_access_recovery.md先追加当前总12/v5/11B时点段，旧总10段标历史；doc/05_testing/README.md及r3目录README同步当前句，并扫描主设计/协议/QUICKSTART/RUNBOOK/GUIDE/CASE/dual-critic说明/ADR的现行指针。此次任务级launcher不改变skills-src命令措辞；若实际发现入口措辞需要改，先改源再render。完成recipes与测试后串行两次npm run check，再build及node dist/install.cjs，formal-start-precheck-v2必须测inputs_match/install_matches_source=true、完整settings不越软线、目录事实实际消费与skipped=0，才启动12C。四目标安装后复核七份共享目录缺席与备份逐文件hash一致；重现即停并记录时点、按既有恢复方案处理，客户端发现仍未测。12C明确base39ed2053，审完整diff及本轮新守卫/文档。\n\n` +
`**扩禁轮数。** 他侧历史BRIEF是输入件而非原始审查结论，当前4290项deny未包含它；本轮不扩生产enumerateDenyPaths/readonly语义，不将10C重判。若将来决定扩禁，v5最多12轮，第13次必须先获Bob独立轮数授权、正式计划审查及审批；不能搭12C便车。原生产写准入标准和两项未批准候选始终不变。\n`;
const revised = changes + body.replace('## 实施、复审及停止条件', integration + '\n## 实施、复审及停止条件') +
  '\n\n不编号附录：r14历史全文（逐字保留；原采样状态不覆盖r16正文）\n\n' +
  fs.readFileSync(`.reviews/${topic}/plan/2026-10-11-${topic}-r14-codex.md`, 'utf8');
const table = [
  ['CLAUDE-01','claude','major','实时测试当前读v5却仍断言v4，分离当前与不可变v4历史边界','r16测试与权威；agent-access-recovery.test.ts'],
  ['CLAUDE-02','claude','minor','v7已用于11B，保留字节并具时刻勘误，新v8才修注释与v2接线','r16生产接线；恢复报告与launch-v8.mjs'],
  ['CLAUDE-03','claude','minor','总10现行指针已失时，更新报告及双README并核跨文档口径','r16文档时序；REPORT、05_testing/README、r3/README'],
  ['AGY-01','gemini','minor','v4九/十边界必须固定为历史回归，v5实时壳独立','r16测试与权威；agent-access-recovery.test.ts'],
  ['AGY-02','gemini','nit','新正式入口具名v8并和quiet-v6/v2守卫一致','r16生产接线；launch-v8.mjs/quiet-launch-v6.mjs'],
  ['AGY-03','gemini','nit','recipes改安装输入后应先重装核两类匹配再启12C','r16文档安装时序；formal-start-precheck-v2实测'],
  ['GLM-01','glm','minor','v2若无生产调用即无修复，新v8列为必交付物','r16生产接线；launch-v8.mjs及12C diff'],
  ['GLM-02','glm','minor','共享七入口曾未知来源复现，安装后须再次读盘','r16安装时序；七目录与备份hash核查工件'],
  ['GLM-03','glm','minor','v7误述保留审计原件而在报告勘误，v8首行准确','r16生产接线；恢复报告沿革'],
  ['GLM-04','glm','nit','定义白名单token前缀及必需旗标层级，产品CLI仍校验值','r16生产接线；quiet-v6正反测试'],
  ['GLM-05','glm','nit','扩BRIEF守卫需额外轮数且不附着12C','r16扩禁轮数；后续独立授权停点']
];
const disposition = `---\nschema: trivium.disposition.v1\ntopic: ${topic}\nstage: plan\nrole: codex\nkind: revised\nrun_id: ${run}\naddresses:\n  - 2026-10-11-${topic}-r7-claude.md\n  - 2026-10-11-${topic}-r7-gemini.md\n  - 2026-10-11-${topic}-r7-glm.md\n---\n\n# 第11次正式计划三审逐条裁决\n\n三家原件全文已读。运行success、三侧evidence_ok=true、无fallback/degraded、snapshot tree前后相同、subject/related零漂移、readonly_breach/peer_artifact_read/forged=false。Gemini/GLM的路径级deny未生效与Driver模型族unknown警告保留，不把三审形式有效外推为全部准入实测。十一项意见均在r16具名合入，原BRIEF扩禁与两项候选判据未获采用。\n\n| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |\n| :--- | :--- | :--- | :--- | :--- | :--- |\n` +
 table.map(([id, role, severity, why, landing]) => `| ${id} | ${role} | ${severity} | 接受 | ${why} | ${landing} |`).join('\n') +
 '\n\n本轮plan普通审批不改变准入标准；旧10C code拒绝保留，第12次只有实施/核验完成后才能正式启动。\n';
const layout = { archiveRoot: path.resolve('.reviews'), topic };
const written = await writeArtifact({ layout, stage:'plan', role:'codex', writer:'driver', driver:'codex', kind:'revised', rerunIndex:7, date:'2026-10-11', content:disposition });
const next = await writeArtifact({ layout, stage:'plan', role:'codex', writer:'driver', driver:'codex', rerunIndex:16, date:'2026-10-11', content:revised });
fs.writeFileSync(path.join(root,'round11-disposition-archive.json'), JSON.stringify({ written, next, accepted:table.map(r=>r[0]), criteria_adopted:false },null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({written,next,accepted:table.length}));
