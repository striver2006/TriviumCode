# 第24B获批集中取证实施证据

Driver codex，原主题Agent双模式接入真实准入收口。24B run `20261011T171203Z`三家首轮完成，1357冻结文件及10原审查工件hash一致，无subject/tree漂移或只读越界；13意见逐条12接受/1驳回，gate通过。普通plan依Bob自动审批委托于2026-10-11T17:30:50.521Z批准，非Bob亲自执行，会话声明null。

完整定稿为[计划r26](../../../../.reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r26-codex.md)，SHA `af93c0bb996da1b2125e70f66784b1151dc6d09c87853d2c8a77c718672ea2f9`。裁决为[第24B逐条裁决](../../../../.reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r12-revised-codex.md)，来源脚本和裁决原件校验留痕在外部`~/.trivium/evidence/agent-access-20261011-closeout-r3/plan24-criteria-closeout`。原r15/r16冻结资料保持；两旧候选v1均未采用，当前两独立判据也未批准，25C尚未启动。

新增局部脚本/Schema仅用于受控机制、只读诊断及独立批准校验，不进入安装输入，不改canonical原准入判据。core SKILL经核对无需修改：产品入口和原标准不变，其现有主设计/恢复报告动态指针继续适用；理由及hash见`plan24-approved-contract-sync.json`。主设计v1.3.156、ADR、协议、坑指南、手册、Runbook、验收剧本、恢复报告及索引先同步。

本阶段起点：准入731/742、review313/318、正式24/25；旧local496下7通过/5未测，当前localfb64严格完整0通过/12未测，k3/Qwen max禁读Read原false保留。源码aa6db337、作用面7ac37129、bundle1737c946保持。官方Claude待订阅恢复，服务端身份null，M11第12步前置未完成。

当前新增v13锁定及v9至v12固定历史授权测试，实际执行结果另追加；受控pilot和认证适用性诊断均未执行。普通plan/code、CLI自动扩容或轮数委托都不授权采用两个判据；待实际A/B与具体诊断齐备后交Bob单独决定。

已完成首批验证：`authority-and-doc-checks.json`保存typecheck、仅测试构建和定向测试原输出，44通过/1跳过/0失败。现行v13明确锁定24B/25C、26拒绝与criteria_change_authorized=false；新增v9至v12固定历史边界及现行权威拒旧断言。安装作用面及bundle前后hash相等。设计新附录末尾格式修正后`git diff --check`通过，其较晚hash在`plan24-approved-checkpoint.json`分列，初始同步采样保留。

`review24-originals/`保存13份审查、定稿、裁决及meta逐字副本，复制前扫描、逐份hash相等。完整资格/本轮批准/台账/残余缺口见`plan24-approved-checkpoint.json`。首次零CLI观察脚本误用预算根的ENOENT及部分副本保留，v2修正后仅核对并复用既有相等副本，未覆盖、未reserve或重复启动；见`zero-cli-checkpoint-path-failure.json`。受控机制、独立批准校验及适用性诊断的实际实现和pilot仍待继续，未将本批定向检查冒充最终两次完整check或准入通过。

后续采样：受控mixed评估、固定夹具与固定启动壳已实施；`controlled-before-launch-checks.json`保存48通过/0失败的定向结果及typecheck、仅测试构建，安装输入与bundle保持。模拟终态字段及派生启动壳导入的首次静态失败均独立保留，未靠修改生产解析器消除。`controlled-launcher-negative-checks.json`的四项真实Node子进程负例在供应商启动前拒绝，新增CLI 0。

事前两组合清单见`controlled-pilot-batch.json`：Qwen max/k3预计4、硬6、累计止737、admission池742。实际只执行Qwen一次，经原包装器和生产invokeClaude，同PID exec到native占1启动，累计732/742完成，review313/318、正式24/25保持。`controlled-pilot-stop.json`及`controlled-pilot-qwen/`保存七份逐字原件与hash，扫描0命中；两写、六目标Read及六目标Grep拒绝精确配对、native消费映像及完整交付均有受控证据，但permission_mode observed=auto、live=default，mechanism_pass=false。清理三项true，原配置/安装输入保持；按失败停点未启动k3和其它三组合，重试0。该证据无真实provider推理、真实模型负对照null、原准入列不变，不能采用受限准入。权限模式来源须先只读定位；不猜旗标、调参重试或扩大判据。独立时间戳诊断/批准校验及25C仍待执行，M11前置继续未完成。

再后采样：`permission-mode-readonly-diagnosis.json`仅记录当前用户缓存相关false值与独立HOME缺缓存、官方文档依据和待实测原因；无历史.claude.json hash、不声称因果已证实。认证只读守卫、原值变异及独立批准/撤销校验已实施；`approved-diagnostic-checks.json`保存typecheck、仅测试构建与124项定向测试全部通过的原输出。安装输入7ac37129、bundle1737c946保持；本次新增供应商0、累计732/742与313/318不动，不冒充最终全量check。

`auth-timestamp-diagnostic.json`保留首次false及首次脚本（错误地把故意Codex负对照的旧检测命中当最新泄漏）；`auth-diagnostic-v2-origin.json`保存纠正来源。v2依据原检测分层合同，将最新安全事实绑定有效24B与受控原raw，两类历史检测/新安全事实分列；27项显式原件、378项组件比较、87个来源hash，重建旧配置字节严格命中496eed89，三指定checked_at以外原值一致，私有快照清理true，applicable_diagnostic=true。诊断只支持已列本机配置/二进制/配方的有限事实，不证明上游稳定、新模型实测或未测负对照；当前strict canonical 0/12仍不变。

局部批准校验形状在`criteria-approval.v1.schema.json`与`criteria-revocation.v1.schema.json`，由`criteria-contract.mjs`渲染；模拟批准与事件均仅在测试临时目录，未生成实际批准。普通审批、轮数授权、自行推荐、错scope/hash、缺来源、撤销/未知/冲突/遗漏事件等拒绝，production_consumer_enabled固定false。尚需集中补齐loopback限额/清理故障及形状一致性等静态测试，完成后才完整代码审查。

集中补充提案见`post-pilot-mode-plan-proposal.md`：拟另经正式计划审查为临时HOME添加仅permissions.defaultMode、值来自实测default，声明新设置差异、同工具面/原拒绝参数/文件状态仍严格实测；当前未实施、未启动。建议将未执行25C改25B补充计划、26C完整代码，总26（27拒绝），依据Bob按需轮数委托通过现有机制登记；目前该新轮数例外尚未登记，仍是24/25。本提案不改变原标准或批准采用两候选，M11前置未完成。
