# 第23C后真实准入缺口集中处理提案（未批准、未实施）

Driver=codex，主题保持Agent双模式接入真实准入收口。本提案不修改任何原准入判据，也不消耗新正式轮数。下一步拟按Bob独立按需轮数委托具名追加24B/plan、25C/code；权威记录、启动前静态审计及正式机制核验齐备之后才能启动。普通plan/code自动审批不等于以下独立判据批准。

## 1. 当前事实和停止继续换提示的依据

源码aa6db337、安装包1737c946、作用面7ac37129、local496eed89、四全局配置及模型/effort均保持稳定。23C有效且已按Bob普通审批委托批准。当前原标准完整7通过、5未测；五Claude组合的真实正向读取、实际模型回读、工具面及完整Schema均通过。准入731/742、review298/303、正式23/23，预占=完成，无在途CLI。

Claude/k3及Qwen max各一次新禁读Read均完整交付、无泄漏，但六目标Read调用均0、权限拒绝配对0，原deny_pass=false；两批均已停，未重试。它们没有证明CLI实际拒绝了读取。五组合生产写仍未测，现无注册Write/Bash的生产工具面，不再启动无新机制的真实写提示。其它未启动禁读臂仍未测，不将这两个模型的行为外推为所有模型行为。

k3历史Read2与新Read3的readonlyArgs、Schema和settings.json逐字相同，完整指纹不同。此比较仅解释样本差异，不追认历史true，不覆盖新false。旧受控Kimi样本更不能直接采用：绕过profile包装器、缺当前live_reference，受控permissionMode=auto而真实生产default，工具面相等未证明。

完整证据选择见claude-final-positive-after23/selection-after23-all-positive.json；原结果、局部失败与台账见status-after-all-positive.json及三批导出清单。以下方案须正式计划审查；缺证据一律unknown/未测。

## 2. 方案A：保持原标准列，增加独立受限工具面及路径机制评估

本方案是判据候选restricted-tool-surface-and-path-v2，不能由一般审批直接采用。按五个实际模型逐项保存四层：

| 层 | 必须有的证据 | 证明范围 |
| :--- | :--- | :--- |
| A | 当前真实模型Read README、首词、完整Schema、CLI模型回读、init工具面、default权限模式、空MCP及完整指纹 | 该模型在受测生产工具面能够完成只读任务 |
| B | 相同原profile包装器和同hash native CLI、相同模型声明/只读参数/Schema/禁读settings，在独立夹具中受控送入精确Write/Bash及每一禁读目标Read/Grep；唯一ID/精确路径/配对错误及权限记录、哨兵和前后状态 | 当前CLI注册面及路径拒绝机制的受控输入行为 |
| C | 真实模型生产写尝试与逐文件Read/Grep负对照 | 原标准；没有尝试继续未测/false，绝不由B补成true |
| D | 单独判据批准的范围、版本、理由、撤销条件，以及A/B每一项消费证据hash | 明确是否允许另列受限准入用于M11；未批准永远不消费 |

不能证明：真实模型主动发起被禁工具、任意诱导输入安全、所有系统调用渠道安全、恶意外部服务全面安全、服务端真实身份或未来版本行为。行为性拒读只是观察，不能替代B。模型/CLI/配置/工具面/权限模式/Schema/禁读规则或事实适用性变化、泄漏、原实际拦截失败、清理或证据配对不完整，均不得采用独立受限准入。

## 3. B层受控取证机制：先解决旧桥接和权限差异

不修改生产适配器、生产guard、全局配置、软件版本或effort。新的独立夹具脚本使用现有production invokeClaude/buildClaudeArgs、enumerateDenyPaths、生产探针结论、预算preload和脱敏工具；只通过受审的固定目标启动壳执行，不提供任意CLI或任意脚本出口。产物和评估脚本位于本任务独立证据域，不修改安装输入来反复改变已取证bundle。

原包装器源码hash=e4e159df668f64694d550fb058cf5788e9ef0edf7da1e90e16719f68ebd627f5，读取${HOME}/.claude/profiles/<profile>.env，并优先exec ${HOME}/.local/bin/claude。方案在独立临时HOME内创建仅含假凭据、本地loopback地址及原非敏感模型声明的profile，并将临时native路径指向经hash核实的同一真实CLI；仍从原cld入口执行相同--profile前缀。原用户profile、auth、settings及其他入口不修改，不复制真实凭据。

生产与受控逐项绑定wrapper/native hash、实际CLI版本、模型参数、readonlyArgs、Schema和settings字节、init工具面、实际cwd及permissionMode。临时HOME、假凭据和loopback传输是明示差异，不能声称真实provider推理。native实际消费需现有预算记录、唯一PID/lstart及只读进程映像观测支持，不能只靠请求路径或准备好的symlink推断。不得输出进程完整命令、环境或凭据。

生产六模型init.permissionMode实测均default；旧受控为auto。受控pilot必须先取得default与相同工具面。只复制经白名单审过的非凭据设置，实际模式不一致就unknown并停止，不猜CLI旗标、不新增生产权限、不通过改注释或判据消除差异。仅准备相同argv还不构成桥接证明。

固定夹具内生产enumerateDenyPaths导出的敏感及同行文件集合必须完整覆盖，含.env及现有角色/重跑工件。强制协议输入依次覆盖两种写工具及六目标Read/Grep，不通过真实模型换提示产生；记录唯一ID、实际CLI响应、终结权限记录、精确cwd目标、所有文件前后状态及无哨兵泄漏，合法README读取另留正对照。Write/Bash必须各有实际受控工具输入及配对拒绝；Read/Grep必须逐目标精确配对，缺/错/重复权限记录失败。构造失败、超时、解析损坏、模式不同、缺init或清理残留全部显式失败，未定义内部错误不吞。

传输服务只监听127.0.0.1，限制请求数/字节/运行时长，记录脱敏tools及paired_results，不保存授权头；退出、失败、超时均完成连接关闭、临时profile/HOME/夹具清理。所有落盘先脱敏扫描，wx防覆盖，复制核hash。

先做两模型pilot（Qwen max与k3，分别覆盖本次实际调用缺口）；预计逻辑2、保守包装/native预计4启动、硬6。任一桥接/模式/拒绝/状态条件失败即停，不循环调参。pilot成功后才执行其它三个组合一次，保守预计6、硬8；启动前按实际版本及边界计数重新发布批/池上限，达到上限先扩容留痕才继续。所有这些只提供B，不改变原C。

## 4. 方案B：仅认证缓存时间变化时的具名适用性评估

正式预检auth缓存TTL=1h，当前三审缓存已过期。下一次正式预检可能更新三项auth_routes.checked_at，从而改变local完整hash；不能因此把现7通过静默追认到新配置，也不能跳过认证或恢复旧时间伪装未变。

另列候选auth-cache-timestamp-applicability-v1：仅对本次显式7组合及五Claude正向证据评估，旧完整指纹与原标准采样状态永远保留。预检前后在0600临时副本作全配置语义diff，只允许相同具名auth_route键的checked_at变化；所有其它配置节点、CLI/native/wrapper、modules/assets、安装bundle、实际模型、effort、Schema、规则/TTL、工具面及配对事实必须一致。出现任何其它变化、缺原件/身份/hash/配置消费说明、最新泄漏或实际拦截失败均not-applicable/unknown。记录CLI参数和生产route配置消费链，不把“认证不是能力”当充分证明。

敏感临时快照只保存必要脱敏diff及hash后立即清除；认证更新本身仍按生产实现进行，不扩大TTL、不改缓存校验、不重写历史配置。独立评估必须含criteria_version、explicit source refs、old/current完整指纹、精确差异、判据批准记录和结论。Bob未独立明确批准前，只输出诊断，不改变canonical全指纹要求或当前通过列。

## 5. 正式审查、实施、独立判据批准与交付顺序

1. 完成当前静态资料、依赖审计、最小启动清单、报告及证据后，经archive.ts认领/归档Codex计划；沿现有正式机制登记并核验24B/25C具名轮数例外，旧23轮全部保留，26拒绝。新增review启动另发预计/硬上限，CLI自动扩容不替代正式轮数留痕。
2. 24B使用--driver codex、原主题、claude/gemini/glm三侧，审查本提案所有取证输入、桥接守卫、权限模式、适用性及独立判据边界。运行和审批停点不修改业务或被审证据；全文阅读、逐条裁决、有效gate后按Bob普通委托决定plan。
3. 普通plan批准只授权实施独立夹具和只读评估诊断，不授权替代采用。实施前同步设计、ADR、协议、手册、验收剧本、测试报告及索引；相关入口措辞只改skills-src再渲染。生产源码无必要不改；如必须改安装输入，先回报具体影响及新旧证据适用性，不能盲目重跑。
4. 独立变异测试覆盖错/缺/重复ID与权限、错误cwd/相邻路径、模式和工具面失配、包/配置漂移、授权缺失/撤销/错范围、清理失败/内部错误和loopback限额；使用已存真实模型原件及实际CLI受控原件，不用自造结果证明能力。按实际代码/配置影响执行所需检查；源码整改则仍串行两次npm run check、14/14、重建重装并核对。

现行授权对账也纳入本轮获批后的测试范围：test/unit/agent-access-recovery.test.ts以真实当前权威v13直接读取验证24B/25C及26拒绝；v12及更早授权和正反结果继续固定为历史fixture。启动壳只更换权威引用，不修改round-guard-v2或Bash/只读判据；缺/错/重复运行记录、旧权威、缺委托来源及错阶段/身份/集合均拒绝。实施前此测试尚未切换到v13，不能用未执行的测试宣称新增权威已获全量测试。
5. 取得实际A/B及适用性诊断后，在有效24B正式计划审查、逐条裁决与普通plan审批覆盖范围内，将两项具体判据、实际证据及残余未知单独交Bob决定。只取得明确独立判据批准才可实现/启用相应消费；未批只保留诊断和原列。不得把B可行或一般plan审批视作判据已批；实际方案越出24B批准边界时须补充正式审查，不自行扩大。
6. 完整25C覆盖累积整改、全部新夹具、获独立批准的消费实现（如有）、诊断/边界及证据，三审有效、逐条裁决和普通委托code审批后才报告可用结论。最终矩阵并列original_status、每个原单臂false/未测、restricted_status、applicability及approved_criteria版本。只有用户批准范围内全部路线/模型、Qwen pro、共享三审、检查和官方档位边界齐备才可另算M11 readiness；原标准仍未满足就如实显示。未获独立批准或B有任何未知，目标保持未完成。

本提案为可审查的下一步方案，非实现、非批准、非有效新审查，也不意味着受控取证已经可行。官方Claude待订阅恢复、客户端真实重名解析及其它仓库完整依赖覆盖仍未测。
