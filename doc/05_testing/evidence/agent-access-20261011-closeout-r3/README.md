# 2026-10-11 新一轮真实准入收口证据

独立证据根；所有历史目录原样保留。`baseline.json`、`shared-entry-audit.json`、`historical-retention-before.json`由零厂商CLI的`static-audit.mjs`生成，脚本落盘前使用现有脱敏及扫描出口。

准入与审查启动的连续权威台账仍为上一证据根`agent-access-20261010-closeout-r2/ledger/{admission,review}`，不复制预占、不重置。新调用的输出放在项目外`~/.trivium/evidence/agent-access-20261011-closeout-r3/`，避免审查期间新增被审证据。送审前的静态材料在本目录。扩容通过现有`openBudget.extend`，扩容不会增加正式轮数。

CLI版本本轮尚未新启动，历史为Claude2.1.296、Codex0.162.1；不能以这些值声称当前CLI实测。服务端身份缺证据仍null。

主题四次既有正式运行都计数，含两个失败运行。用户本轮授权仅再增加计划及代码各一轮，总上限6。编排器没有原生轮数例外接口，采用送审上下文冻结授权记录及任务包装器核对实际归档记录的处理方案；未修改产品计数、状态或Schema。该能力限制必须保留在最终交付。

本轮追加状态：第5次正式计划三审有效，12条接受、r7定稿及委托plan审批已落盘；两次check均3129通过/3跳过/0失败，47项定向及14/14桩通过。checks-and-build-record-v2.json保存日志文件与源hash边界；implementation-checkpoint.json/config-and-plan-approval-checkpoint.json保存保留、预算、配置与安装状态。shape-boundary-diagnostic.json和shape-plan-amendment-proposal.md记录实际5段根超出r7批准4段范围的阻塞及未批准修订。write-criterion-alternative-not-adopted.md为未采用判据候选。formal仍5/6，准入仍342/343；未重装、迁移、提交、推送或真实准入补测，目标未完成。

最新v3：返回式目录追加失败及caller预期失败补齐后，48定向通过、两次串行check均3130通过/3跳过/0失败、14/14桩通过。以implementation-checkpoint-v3.json及*-v3.json检查输出为当前源码证据；前checkpoint按其时间保留，不追认到后改源码。5段修订未采用，formal仍5/6，目标未完成。

后续r9状态：用户独立授权总7轮，第6次补充plan run=20261010T224543Z有效，11条逐条裁决、gate通过及委托审批记录齐备。formal-round-authorization-v2.json为追加授权；formal-round-authority.json与round-guard.mjs核验当前唯一权威，原授权、原launcher及逐字节保留副本不删。CLI版本经本批preflight实测Claude2.1.296/Codex0.162.1/agy1.3.3/zcode0.16.9；此前“尚未实测”按初采样解释。

获批五段ASCII形态v2实施后，24项定向19通过/5失败：生产敏感扫描深度6漏掉所需深度7文件。诊断与未批准敏感整改候选见sensitive-depth-diagnostic.json及sensitive-depth-plan-amendment-proposal.md。源码扫描上限未改，新目录事实尚未采样；另请求总8轮例外未获答复。当前权威/启动前检查5项通过，实际settings 3,049,196字节且旧安装不符，正式code启动前拒绝，见code-start-precheck-current-unready.json。implementation-checkpoint-r9-depth-blocked.json保留完整预算、审批、旧hash核对及当前未完成状态：admission342/343、review68/73、formal6/7；未新增准入、重装、迁移、code审批或提交推送。

后续用户独立授权总8轮：第7次敏感扫描补充B/plan、第8次完整C/code。v3授权引用v2 hash，当前权威核验沿用r9机制，v2原权威逐字节另存；新launch-v3.mjs使用v3，旧launcher保留且旧授权不能正式启动。六项轮数/启动保护回归通过，r10完整计划经archive归档；扫描深度仍6，候选未获审前不实施。review具名扩容15至88，预计15、硬20启动，见review-sensitive-depth-plan-batch.json；admission342/343无新增。第7次送审前核对及全指纹见pre-review-sensitive-depth-freeze.json，各较早段落按采样时点解释。

r12采样：第7次run20261010T232715Z有效三审、七条接受裁决、完整r12及委托审批已落盘，formal7/8、review78/88。实施固定扫描父深度7及回归，targeted-verification-r12.json保存63项通过计数及范围边界；第一遍完整check1-r12.json为3136通过/3跳过/0失败，第二遍串行进行中。project-sensitive-cap6-before.json与project-sensitive-cap7-after.json记录实际项目4170路径、零增删及相同集合hash；sensitive-depth-verification-r12.json保留新独立夹具清理正向证据。旧诊断cleanup=null只有未记录含义，不追补原件。

admission-directory-r12-batch.json发布三条新目录doctor，预计54、硬72启动；具名扩容71后准入池414，现仍342。migrate-install.mjs按有效r12授权备份核对、移动及正常四目标安装；本采样时尚未执行。local-validation.mjs仅运行本地检查/构建/桩，完整输出脱敏落盘；select-evidence.mjs仅显式选择给定variant/hash，当前失败可以保留，版本不完整不得消费，不自动选旧成功。

最终r12-rootfix送审前状态（上述文字按采样时刻保留）：当前正式总上限8、已用7，唯一剩余8C/code；前7B敏感整改审查、逐条裁决及委托审批有效。晚改后两遍check均3136/3/0、桩14/14、正常四目标安装及28入口核对见*-r12-rootfix.json、install-rootfix-r12.json。最终bundle=fbb15ea93b1c8e5c65a6548ab8dd171696487198ea1418fdb7a63d7fba57a31f、inputs=ec00294367b91afe866f6675e202813e3b6f8bc0b73b4756385c6299433218dc；构建时dirty=true，主干尚未提交。

当前唯一连续预算根改为~/.trivium/evidence/agent-access-20261011-closeout-r3/budget，cutover-budget.mjs与budget-continuity-r12.json核原976文件逐字节副本，旧仓内预算不可继续追加，不能重复合计。launch-v4.mjs在每次调用核两侧历史hash及权威；未增Git忽略、删除漂移或改变产品只读判据。旧launch及旧授权保留，当前正式授权v3限定7B/8C。真实能力批38臂/56启动完整收尾，当前准入478/498；matrix-r12-pre-code.json与显式selection按当前完整指纹汇总6通过/5未测/1未通过。arm_details逐项保留失败，known_gaps是初选重点清单，完整缺口以矩阵和恢复报告最终节为准。四Claude生产写、Codex/Qwen写无尝试、k3 Read无尝试、三组合Grep缺.env均仍阻塞，不采用判据候选；官方Claude未测。

重装前全局Codex config hash变化有阻断与观察原件，具体来源/键差异未知；本轮不写全局文件，不把历史medium推断为当前变更，CLI回读high/medium/max分列。模型映射及sensitive_globs声明未改。代码审最终上下文重新resolve/preflight，review具名新增10至108、预计10硬15；当前审查尚未启动，完成审计冻结后不再修改业务及被审证据。

最新code后状态（较早段落按采样保留）：第8次C/code run20261011T005041Z有效三审、全文读取及七条逐项裁决齐备，gate退出0后依据用户明确委托正常approve，原记录session_id=null。code-r3-response-codex经archive.ts落盘；旧failed、引用告警及原规则保留，正式轮数8/8耗尽。审后文档收敛和宽祖先回退单测落实，产品投影算法及guard判据未再修改。BRIEF设计原型与实际运行模板区别见恢复报告最后节，不能冒称运行模板已披露父深度7。

最终两遍check1/check2-r12-code-nits均3137/3/0，selftest-r12-code-nits桩14/14；final-build-r12-code-nits bundle=848445c9609aa6758b9580e95b6aa5d614090d18487ec534d6e57bb80520474e、inputs=885a12a5d043d5e79c3d2736b25b7db8a64bb08d6a770ee7b779de46636602bc。install-code-nits-r12正常四目标、核心SKILL及28入口核对一致，备份/恢复保留；构建时HEAD仍39ed2053、dirty=true。客户端实际入口发现及其他仓库完整依赖面未测。

post-code-fingerprint-r12-batch按公布清单新增69实际启动、无重试，累计准入547/563、review103/108均完整收尾；唯一权威是前述项目外预算根，仓内旧976文件原样冻结，复制不计新增。matrix-r12-code-nits与selection-r12-post-code-all-current明确38臂variant2、完整指纹均相符，新版6组合通过/6组合未测；五Claude生产写和Luna写无当前实际尝试，Kimi coding Read另缺.env尝试，不能隐藏完整禁读false。FBB旧矩阵及其曾通过样本保留，不追认到新bundle；原生产写标准不变，候选未采用。官方Claude未测，server身份全部null。

目录事实六份相关源码未变、当前生产consume/TTL/CLI/形态/globs/入口绑定通过，完整settings26960字节、skipped0，见directory-fact-reuse-scope-code-nits；这项有限复用不代替完整模型准入。current-raw-evidence-cleanup-audit-r12核全部本批原件脱敏和38夹具实际消失状态，采样时间不冒充清理操作时间。final-closeout-state-r12为提交前零CLI冻结及历史hash/安装/预算核对出口。后续独立建议post-code-next-review-proposal已提出第9B/第10C总10轮请求，当前授权上限仍8；轮数授权不等于判据采用批准。goal未完成，M11第12步不可开始。
