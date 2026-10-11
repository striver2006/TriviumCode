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
