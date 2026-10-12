---
role: codex
---

# Agent双模式接入真实准入收口：第28B集中补测计划原稿（r31）

本稿须正式三审、逐条裁决及本轮普通plan批准后实施。普通自动审批不采用任何准入判据。第27C run20261011T212239Z已有效并普通code批准；原七整改、原39ed205以来完整代码和历史失败保持。当前生产inputs 7ac37129cdfcf3700c34b24b6e87c76359b4997a4fc7480b53f06762a3d45f4f、bundle1737c946fc2aff5af8ebcb5645ddd25b80da3b38d853d96d0b357f7eabf7272e、main aa6db337315dd60691af966bb2bee1dfc5b0829d；全工作树有文档/测试/证据变化，生产输入dirty=false。

26B父定稿 .reviews/Agent双模式接入真实准入收口/plan/2026-10-12-Agent双模式接入真实准入收口-r30-codex.md，SHA 9c457711d4146644d9dedd976cbdf854128283df0802ddf32ba6f4bc0cf75d5c；27C批准及零漂移实际原件见本独立目录code27-approved-checkpoint.json。提案SHA 2fe16a7db1ea472822f5ec7fbe85df99f1484ba159fbc1b8982458d7fe956603。后文完整给出本次新增执行合同，旧r21实现/Schema/全部160文件仍按保存快照原字节只读；不将27C批准冒称本28B批准。

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

# 第27C之后的集中机制收口方案（未审、未实施）

目的仅为补齐受限工具面候选缺少的当前现场事实，避免继续追加零散守卫或反复换提示。27C已有效且普通code批准；本文件须再正式B/plan审查和普通批准，才可实施。按Bob“授权轮次可以按需增加，不必询问授权”建议具名追加28B/29C，仍不授权判据采用。现权威v15总27已用满，本文件不改计数、不自行启动。

已有事实：26B首批Qwen一次实际CLI得到default及完整机制事实，事后proof解析已删除临时别名失败，停止规则已触发；后续修正只读复算通过，原失败和lease保留。其余4机制组合未启动，Qwen事实为历史b40，当前6a2严格消费拒绝。不得删除旧lease、恢复原batch或把修正后的复算改写为原批次成功。

敏感范围一：在新的独立执行域和唯一新批次，明确许可同配方现场重新取样一次，5组合固定为Qwen max、Kimi k3、Kimi coding、DeepSeek flash、DeepSeek pro。Qwen重复的必要性是当前完整指纹不同且原批次已经停止；这是待审的新一次性许可，不在原26B授权下执行，也不借认证判据未批准来跳过指纹。新batch/lease与旧batch/lease分别保留，不更换提示、inline值、模型、effort、CLI版本或HTTP配方。每组合最多一次、任一失败停止后续，无重试或第二配方。

新的任务级启动guard/proof/consumer只更新具名28B批准、批次、当前来源及lease绑定；唯一criteria-validation-core、全部旧r21实现/Schema/事实保持只读，禁止复制状态机。受控事实谓词不扩大：inline deny逐项/顺序不变、唯一argv项新增defaultMode=default且实际init严格default；生产enumerateDenyPaths/N=6、两写+2N读/Grep+合法README、唯一精确调用/结果/权限配对、未repair Schema、终态、全部前后状态/哨兵、native PID/lstart/captured absolute comm/稳定image hash/实际账本匹配、HTTP12请求/1MiB每体/8MiB累计/120秒/127.0.0.1/在途与迟到错误/聚合全清理保持。已清理别名不做事后realpath；未知错误抛出，失败保存主成果与清理结果。

静态读码明确落点：获批后新独立r23中仅产生本批mode3-launch-guard.mjs、mode3-launch-measurement.mjs、launch-controlled-mode3.mjs、controlled-fixture-mode3.mjs、mode3-proof.mjs及关闭的criteria-consumer-v3.mjs。旧guard的PLAN26/两pilot/733→739/742和旧proof的固定claim计划不可直接消费新样本；新guard固定实际28B成功run、定稿完整hash和批准reason、五项有序jobs及事前实测数字，新measurement仍现场核全局闸门/实际批准/来源/完成台账，fixture只换新执行目录与脚本引用，proof只换具名新计划/claim/fixture来源，consumer只接本批受限候选和新proof。固定复用r21的controlled-inline-mode.mjs、controlled-mechanism-mode3.mjs及原mode3 Schema、r19的runtime和r21唯一criteria-validation-core/contract，不复制这些谓词/状态机，不扩Schema形状或版本。新外部目录固定controlled-after28-mode3，五项仍variant=3；所有来源都必须逐文件hash进入新manifest，不能按目录存在推断接线。

实施前字段消费清单须逐项列出来源、读取模块与拒绝负例，至少覆盖新计划run/hash/批准reason、唯一batch/claim/output、五jobs顺序/精确模型profile、前置实际proof、当前完整配置与全部模块/安装/native/全局profile来源、原schema/helper、预算before/expected/hard/stop/pool和账本完成数。旧lease/旧batch、PLAN26原件、旧proof、相同输出/重复claim、缺失或错来源、首项未全通过仍启动后项、未来组合/顺序变化均须在零供应商启动检查中拒绝。新的一次性许可不授予第三配方、未来批次或旧停止批次恢复。

首组合Qwen的新当前完整proof是后续唯一先决事实；K3及后续只消费本新批次实际完成的上一组合全proof，不消费旧b40 proof，不修复false，不以请求或本地模拟替代真实native进程。所有actual_provider_inference=false、real_model_attempt/server_identity=null；不得升原标准C。新consumer固定新plan/实际批准及全部依赖hash，仅候选v3报告关闭消费，不重新授权旧auth消费者。两项判据今后如拟采用，仍分别交Bob按最终具体事实/作用面/消费者hash决定；本计划不授予采用。

敏感范围二：启动前核测量来源完整、实际生产模块/安装/入口/全局与profile配置/完整当前配置/native同一来源，先完成零CLI输入负例与字段消费对账。唯一已审core用于批准/撤销/未知/冲突判断；全对象摘要已含decision_id/topic/version，不因已驳回意见增加重复身份门。维护nits保持暂缓，不改核心SKILL或生产配方组合表，不引入无关生产输入变化。

顺序收敛：28B计划批准后实施和定向验证；先解析29C完整代码审查参数并完成一次正常29C预检，再发布机制批次的实际当前完整指纹、预算、脚本/Schema/native/配置全来源并执行现场取样；取得全部结果及最终文档/静态审计后冻结，才启动29C。预检和正式start的driver/critics/models/tiers/efforts/vendor_profiles/base一致，补充context须重新resolve并核字段一致。不得在现场取证之后又为了取版本/帮助刷新认证而使同批指纹失配；期间如外部变化或缓存需要新刷新，停止，以真实新来源另行审查，不调TTL、不恢复旧时间、不假造零变化。正式审查中和审批停点冻结业务与证据。

预算建议（均未发布执行清单）：正式28B/29C各预计15、硬20，review当前358/363，合计硬止398，开始前追加35到398并保留旧扩容记录。机制5组合各预计2/hard3，admission当前734/742，新batch预计10/hard15、累计硬止749，开始前追加7到749；版本/帮助/失败/超时/包装器与native按实际边界计数，启动不是请求数/金额。实际baseline如有变化，重新出具体清单，不借另一池、不从本文件直接reserve。

29C从原39ed205全范围重审到当前全部七整改、所有新旧独立取证资产及事实；逐条裁决、gate和普通code决定后再准备判据决策。生产输入未变时明确历史两check/14步及新独立资产验证的区别；有变化则串行两check、14步、正常四目标重装及真实适用指纹刷新，不自动修改版本。文档统一当前设计锚、协议/手册/案例/报告/索引；所有旧失败、旧Schema、旧审查原件与台账保持。

若任何现场样本再次失败，按一次性停止，给Bob具体失败可行性和候选不适用/原标准未测的决策，不再开启第三配方或新增外围系统。认证方案如独立获批也仅27具名历史臂，不能替代这5组受控机制事实或原生产写负对照。M11前置仍以完整准入、必要检查和官方档位边界为准。
