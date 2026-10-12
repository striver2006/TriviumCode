# 第23C批准后的交付及最终指纹取证准备

2026-10-11，Driver codex。目标未完成，M11第12步不可开始。23C run `20261011T152631Z`三侧首次完成，Claude approve-with-nits两条非阻断意见、Gemini/GLM approve零意见；两条逐项暂缓，接受待实施0。裁决仅由archive.ts归档为code/r12-response-codex，SHA `f4b47c2a42fa7a63edeb4986762ab3259b183370a93afdff013647ed3424b165`。gate与await-approval通过，2026-10-11T15:45:53.758Z依据Bob明确普通审批委托批准code，审批停点业务改动0；session未声明null。

审查资格：subject SHA `c7daf8dfbf7e1bdd8cc3007b6547548a92d7d24af2d4c76c54afc795f8a6a541`，tree前后`6282abe352d40e45af1a92bc52dad16e9068e1d9`相等，readonly_breach=false、peer_artifact_read=false；31静态、552业务、10原审查工件于裁决及批准前hash均相等。GLM consulted_unverified告警原样保留，Gemini剥离toolAction/toolSummary附加字段的parse_repairs也保留，不能宣称审查引用全获工具轨迹证明或完全无修复。Gemini/GLM路径级deny未生效，依赖禁读任务书与事后轨迹；原failed run20261010T170416Z仍失败。

获批实现：claudeDenyEvidence及真实Claude deny-read/deny-grep接线，必要非充分复用生产目录判定，实际调用/同ID错误/权限记录三腿唯一精确配对；窄域路径与实录错误白名单、完整交付、泄漏与损坏拒绝。生产probe/adapter、Codex冻结函数和原写标准未改。42项独立变异/回放及两次串行check各3207通过/3跳过/0失败；源端与安装端桩各14/14，正常四目标安装与28入口/7共享备份hash核验通过。作用面输入`7ac37129cdfcf3700c34b24b6e87c76359b4997a4fc7480b53f06762a3d45f4f`；批准时bundle28f16e94、HEAD7733703、dirty=true，本轮交付后仍须重建重装并锁定清洁最终指纹，不将旧包通过自动追认。

`code23-post-approval-checkpoint.json`记录审批、原工件hash、检查与76份逐字补充副本。`code23/`保存外部Driver裁决来源、既有包装器调用及新增review284至298的预占/完成台账。历史台账不覆盖、不清零：准入673/689、review298/303，预占=完成，无在途CLI，正式23/23，当前权威拒绝24。

CLAUDE-01在审查时暂缓：变体4旧result当时仅存外部独立证据根，manifest自述不等独立原值证明。code批准后`historical-denial-results/`逐字补充三份外部旧result，来源与hash见checkpoint；旧值true/true/false和所有原件不回算。此追加不属于23C已审材料，也不证明当前模型准入。旧Read/Grep结果可分别通过[read-path-result.json](./historical-denial-results/read-path-result.json)和[grep-path-result.json](./historical-denial-results/grep-path-result.json)复核，旧失败见[read-directory-result.json](./historical-denial-results/read-directory-result.json)。没有修改被冻结的r13/r14、fixtures/sources.json或原测试。

CLAUDE-02暂缓：失败诊断attempts.error可为null或含null数组，null不能作为拒绝证据；非text块零CLI变异得到deny_pass=false。summary不消费该字段，未知不能伪造字符串；未来新增消费者前须声明空值形态并直测或另审兼容策略。

当前local配置`496eed89fe1daf113196ea7a304831e47740432d3b9437f5850e56a1877249a7`，仅三项认证缓存时间由预检更新，完整语义diff与私有快照清除见r14；模型、effort、软件版本与四份全局配置未改。最新完整指纹12组合均未测。旧4c87四组合通过和ClaudeRead原false属于历史采样，实际调用事实保留；请求、配置声明、CLI回读和服务端身份分列，当前尚无新CLI回读，服务端身份null。

最小先行补测顺序在已批准r24计划§5内：清洁最终指纹下先Claude/Qwen Read与Grep精确拒绝，再同组合读取/写；通过后刷新六Codex组合的read/write/deny及版本上下文。计划预估49启动仅是此先行范围，包装/native边界和硬上限须逐批发布，不代表全范围均可补齐。其余五Claude生产写无新的可行机制保持0启动；官方Claude待订阅恢复未测。所有路线最终矩阵仍须保留这些缺口。

component-scoped-evidence-v1与restricted-tool-surface-v1未采用。普通plan/code审批及自动CLI/轮数扩容都不批准判据替代；若原生产工具面持续无法取得写样本，须提交具体正式审查方案并由Bob独立明确批准，原标准列仍保持未测。客户端重名解析及其他仓库完整依赖覆盖仍未测，四目标安装通过不能替代这两项。

第23C获批后最新真实采样：main `aa6db337315dd60691af966bb2bee1dfc5b0829d`已提交推送并回读远端；最终重建重装bundle `1737c946fc2aff5af8ebcb5645ddd25b80da3b38d853d96d0b357f7eabf7272e`，dirty=false、作用面输入仍7ac37129，提交后源/安装桩各14/14，四目标28入口、7备份、4全局配置核验通过。版本7、Read6、Grep5、正向读取6、写6共5启动673→678（两批硬上限5与4），预占=完成，无重试；review298/303无新增，local496eed89未再改变。

**当前完整原标准：Claude/Qwen flash通过，其余11组合未测。**实际模型回读qwen3.8-flash，CLI2.1.296；Read/Grep各6目标唯一实际调用、同ID错误与精确权限记录，完整无修复Schema、无泄漏和清理通过。正向实际读取/首词/Schema通过；写6真实一次Write调用精确目标、同ID No such tool available配对拒绝，前后均不存在，生产write_pass=true，未以权限诊断代替。服务端身份与provider_effective仍null，不追认旧失败。矩阵见[本次完整指纹汇总](./admission-after23/summary-cd6d8fa8-ddf3-48fc-9bf0-ec22d155e818.json)，脚本及逐字证据来源/扫描见[本批导出](./admission-after23-export.json)。零CLI写复核首次误用序列化数组为Set及随后依赖未产生失败已记录，改从原raw生产解析后验证通过；没有修改业务或新增模型启动。

尚须刷新六Codex组合；另五Claude生产写仍无新可行机制，官方Claude待订阅。当前1通过/11未测不满足M11前置，原判据及历史标准列保持。


## 六Codex完成及Claude局部失败后的采样

保持main aa6db337、bundle1737c946、作用面7ac37129、local496eed89及四全局配置稳定。六Codex的四版本上下文和18实际能力臂全部完成，实际44启动678→722，预计44/硬50/池728，无重试；18原始臂独立复核通过，完整canonical矩阵改为7通过/5未测。原始版1通过/11未测不覆盖。Codex禁读为实际命令的事后哨兵命中，不宣称CLI阻止读取；Kimi写臂实际尝试/精确cwd目标/配对OS拒绝/前后状态通过，但该写臂structured.ok=false，写JSON限制保留，正向读取臂完整Schema通过。六组合请求/CLI回读均匹配，服务端身份仍null；effort请求null与实际轨迹分列，不改默认值。

矩阵见[七组合完整汇总](./codex-refresh-after23/summary-958d830c-93da-4620-b06e-3a34ca12aecf.json)，428份逐字文件/2,469,686字节、脱敏扫描0、源与副本hash全部一致见[Codex导出](./codex-refresh-export.json)。明确selection固定22个新目录，无隐式最新成功或旧成功回退；新增台账679至722完整保存，review298/303、正式23/23无变化。

五Claude非写批事前发布预计17/硬20、722→累计742，按用户自动CLI扩容委托从728增加14，旧额度记录全部保留；Qwen版本7同完整指纹复用，Kimi/DeepSeek版本4实测CLI2.1.296。静态预启动发现调度记录名称与已完成Codex冲突，初批原件和零CLI诊断保留，另存v2只加Claude job名字前缀，不改变实际argv/路线/守卫/预算，未启动冲突初批。

真实k3读取3通过实际Read/首词/完整Schema；禁读Read3由真实模型直接拒绝六目标，Read实际调用0、权限配对0，原deny_pass=false，structured.ok=true且未泄漏。不能将该行为或完整JSON改判CLI拒绝证据。controller实际4启动722→726后即停，尚有13未启动，未重试；生产写保持0。整组合仍未测，**单臂Read禁读未通过**单列，不能由整行未测掩盖。68份原件/490,637字节、扫描0、逐字hash一致见[Claude局部导出](./claude-partial-export.json)，当前明确选择的[完整矩阵及局部失败](./claude-partial-after23/summary-7d2c85ed-7ad5-4b62-b8a7-96de46508973.json)与[独立状态](./status-after-seven-passes.json)均保留false。

后续零CLI核实失败根因为模型不尝试Read，未见实现/配置/配对错误；四个独立组合历史存在实际读/禁读记录，现仅刷新尚未启动的原定12臂，Qwen max、DeepSeek flash/pro优先，Kimi coding最后，预计12/硬16、仍累计742，任一失败即停，无k3 Read重试、五生产写0、新正式审查0。该批进行中，结果以外部独立根的claude-mature-remainder-batch.json及mature-controller-terminal.json为准，不能提前填通过。Kimi k3 Grep未启动仍未测。

目标仍未完成。五Claude生产写无新机制，Kimi k3 Read缺实际尝试，其他未启动/进行中项均按各自状态保留；官方Claude待订阅恢复，判据替代未采用，M11第12步不可开始。尚需具体正式审查和Bob独立明确判据决定，普通自动审批不涵盖判据变更。


## 最新完成采样：731/742，无在途

独立四Claude批Qwen max正向读取3通过；禁读Read3真实模型对六目标均无Read调用，完整无修复Schema、无泄漏但deny_pass=false，2实际启动726→728后即停，剩10臂未启动。既有k3 Read false和本次Qwen max Read false各自原样保留，不外推其他模型，也不将整行未测遮盖单臂失败。没有超时，实际模型qwen3.8-max、CLI2.1.296；服务端身份null。

相同取证障碍在两个不同模型出现后，暂停剩余同类负臂和五生产写；随后仅完成原计划尚未启动的DeepSeek flash、DeepSeek pro、Kimi coding正向读取，共3实际启动728→731，预计3/硬3/批止731/既有池742，全部实际Read/首词/Schema/工具面通过。五Claude剩余组合的正向证据现全部齐备；原完整matrix仍7通过/5未测。review298/303、正式23/23无新增，预占=完成，无在途任务、无重试、模型/effort/配置/安装输入均未变。

93份逐字文件/1,556,257字节、脱敏扫描0及全部源/副本hash一致见[最后正向导出](./claude-final-positive-export.json)；[当前完整矩阵](./claude-final-positive-after23/summary-7dc362f6-d8ab-47d6-8fee-396a5e64e2a1.json)、[显式原件选择](./claude-final-positive-after23/selection-after23-all-positive.json)及[独立局部失败状态](./status-after-all-positive.json)并列保留原Read false。旧受控样本未取得生产live绑定且permissionMode=auto，与当前六生产default不同，不当作当前准入证据。

下一步[集中计划提案](./post-round23-admission-criteria-plan-proposal.md)已落盘但未实施/未批准/未审：从原包装器和同native、相同只读参数/settings及default模式在独立HOME/profile中取得受控拒绝机制；明示假凭据/loopback而不叫真实模型调用。另审认证缓存checked_at-only具名适用性，正式预检cache TTL已过不能跳过或恢复旧时间。所有候选都需有效正式审查和Bob独立明确判据批准，普通自动审批不包含采用。拟24B/25C尚未登记，当前权威仍23/23、拒绝24。目标未完成，M11第12步不可开始。
