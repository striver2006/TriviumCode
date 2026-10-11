# 送审路径校正（r11原稿）

送审前静态核对发现r10写了不存在的test/unit/freeze.test.ts；原稿保留，本r11修正为现有test/unit/freeze-drift.test.ts并保留test/unit/deny-matrix.test.ts的身份/同行回归。未启动正式审查，未实施扫描上限。其他完整计划与历史附录保持。

# 敏感枚举深度整改补充计划（r11送审原稿，未批准实施）

本稿继承r9完整业务计划、七条历史整改及plan-r4/run20261010T224543Z的11条接受约束。r9原件不改，原11条及r7附录在末尾逐字保存为历史，当前正式轮数以用户独立总8授权为准。

## 本次单列敏感整改

生产enumerateDenyPaths的walkSensitive当前depth>6返回；五段ASCII根加两层后代需要父目录深度7。独立临时夹具证实文件仍匹配真实sensitive_globs却未入集合，导致目录probe内部覆盖断言5项失败；不得缩小30目标夹具、手填deny_paths或吞掉未知断言。见sensitive-depth-diagnostic.json及候选方案。

仅将此生产扫描父目录上限6提高到7；保持同一matchesAnyGlob、.git/node_modules排除、不跟随目录软链后代（软链项自身仍按现有glob判定）、主题剪枝/身份注册表派生/同行归档矩阵/只读和泄漏判据。父深度8仍是明确未覆盖边界，不宣称无限深度或全部项目敏感文件均覆盖；本任务五段根加两层受测后代内的30文件必须完整入列。其他未测目录前缀仍逐文件，旧形态v1及缺真实新事实不消费。没有更改sensitive_globs，不能声称仅扫描上限改动自动改变其稳定hash；需按新shape和最终完整构建指纹重跑doctor采样。

计划获批后先同步设计§9.2/10.1及§3.5/11.1/11.6、协议/ADR/手册/剧本/报告/索引，再实施src/trivium/freeze.ts的单一边界及注释。test/unit/freeze-drift.test.ts使用标准独立夹具工厂验证父深度6/7匹配文件入列、8保留边界、非匹配/.git/node_modules排除、目录软链目标后代不遍历且匹配软链项自身沿用原规则。旧同行、.trivium及run-root规则原测试继续通过。目录unit和两套真实子进程假CLI集成须30目标全枚举、保留主probe/清理、未知错误不吞；真实模型新facts另批，不由假CLI证明。

启动前检查使用最终构建/安装同一hash、实际当前配置与生产完整禁读枚举、真实可消费新事实，settings<=既有131072字节软线且无skipped才允许第8次C/code；失败不spawn、不占正式轮数，不改变产品soft-line语义。当前实际采样3049196字节、无facts且旧安装不同已经拒绝，不能称在线E2BIG。三路线目录doctor各七臂180秒，文件30/目录5/正对照4；失败清空事实、保留主probe/已取得臂/脱敏原因并清理，不调超时、不换提示碰运气。

正式总8例外与连续review预算分列；不得借本次一般自动plan/code审批采用生产写判据替代。四组合生产写仍未测，七路线完整准入/官方边界/安装与代码三审未满足则目标不完成。

# Agent双模式接入真实准入收口：遗留整改与有效复审计划

2026-10-11，Driver=codex；本r10送审原稿在已获批r9七条整改及11条追加约束上，仅增加敏感枚举父目录深度6→7候选和用户独立授权的总8轮安排。第7次正式B/plan审本候选，第8次正式C/code完整重审；新扫描上限在本轮有效审查、裁决及审批前不实施。

## 一、目标、当前事实与授权

作为M11第12步前置，完成七条遗留整改、有效完整三审、真实准入矩阵和安装收口；七路线全部原标准未满足则目标不完成。基线39ed2053及远程main已核对；运行时与claude/gemini已更新，四目标安装被共享七入口阻断。旧H批5通过/5未测/2读取未通过，只适用历史完整指纹。

原6/7轮授权及六个实际run原样保留。用户2026-10-11独立回复“授权总8轮，先审扫描深度整改，再完整代码重审”。formal-round-authorization-v3.json引用原v2完整hash；总上限8，第7次仅B/plan、第8次仅C/code。原生编排器仍无专用轮数例外接口；沿用已批准的当前权威读取壳，formal-round-authority.json绑定v3文件及hash，先逐字节保存旧v2权威，旧launch/launch-v2和历史guard不改。新launch-v3.mjs沿同一机制核对task/archive已启动ID集合（含failed/running）、六个历史ID、阶段/入口/Driver/critics；已被替代授权及超8均拒绝，不重置计数或修改失败。新载体、旧副本及启动前检查均纳入完整C/code审查。

用户随后明确授权“中途遇到需要审批的，根据你的建议自动审批；如果遇到配额不够的，自动增加配额”。本轮自动plan/code审批以三家有效结构化结论、无作废、逐条裁决、gate通过为前提，审批附言记录本轮授权及具体审查run。若失败，不approve；没有有效审查不得借自动审批实施。一般审批不改变原写负对照判据。只有本文单列的敏感扫描父目录6→7候选经本轮有效计划审查及审批后可实施；其他guard/只读/原写判据不改，无Bash豁免。

## 二、七条整改及落点

| 历史编号 | 实施方案 | 必须回归及留痕 |
| :--- | :--- | :--- |
| code-r2 CLAUDE-01 | adapters/claude.ts新增稳定sensitive_globs哈希函数，对真实项目字符串集合排序去重后JSON/SHA256，不能从替换后夹具配置取值。types.ts新增可选nullable目录项目hash事实；probes/claude.ts在调用目录夹具前保存项目hash，前后项目hash一致、路线/版本/入口/native一致且目录追加臂无failure才保存事实。消费端directoryGuard保存声明/当前项目hash，缺值或不符一律consumed={}，逐文件回退。旧事实无新hash不得借true继续压缩。 | 顺序变化/重复项不改变hash；增删/字符变化使旧事实失效；真实配置与夹具配置不同、旧配置、null、TTL、版本/入口漂移均回退。持久化后再起进程读回并核消费；不伪造doctor结论。 |
| code-r2 CLAUDE-02 | 从已保存run-20261010T170416Z.json的实际deny_paths等冻结非敏感路径集合提取回放fixture，来源完整文件hash、提取字段及精确集合hash都记录，路径分类结构先核实。只保存路径，不保存内容/凭据；不能把扁平的多侧集合冒充单侧完整禁读，单侧原集合优先取原送审包/trace请求实际路径。找不到完整原件就报告缺口，不能编2290条。 | 回放每原路径要么保持逐文件、要么被严格字面目录覆盖；原数组及来源hash不变、合法src/README/audit和相邻calls_extra不被误并。fixture数量来自原件，2290仅历史采样。随check运行；来源不可恢复时明确未测。 |
| code-r2 CLAUDE-03 | adapters/claude.ts的peer_deny_applied注释与types.ts同步：file_shape_verified与实际compressedTools全部verified===true合取，第二项是输入防御不变式；同次buildProjectedDenySettings生产接线不会生成未验证压缩。清理“只读探针、对本批一无所知”的过期注释。 | 保留直调输入变异负例；完整生产接线集成用例，分项守卫不是独立模型能力证明。 |
| code-r2 CLAUDE-04 | 没有可消费目录声明（缺fingerprint/项目hash/时间、无true工具、过期或项目hash不符）时不读入口/native大二进制，observedFingerprint=null、consumed={}。仍需验证时相同精确路径仅在本次函数调用复用一次hash；不按realpath跨不同字符串复用、不建跨运行缓存。 | 缺事实时读hash调用数0；同路径1、不同路径2；漂移/读失败回退；第二次调用文件变化必须重新hash。只证明调用次数，性能收益未实测。 |
| code-r2 GLM-01 | test/unit/claude-directory.test.ts将is_error与permission_denials独立构造，保持判据唯一ID、恰一配对错误、恰一精确权限记录。 | 错ID、is_error=false、无权限/错目标/重复权限记录、重复ID/重复错误均不得true；正常正例仍true；timeout/Schema失败为null、泄漏false。 |
| code-r2 GLM-02 | projectClaudeDenyPaths只消费保守ASCII目录段，如[A-Za-z0-9_-]+，路径分隔符/嵌套按已测拓扑；拒绝中文、空格、逗号、方括号等未测目录前缀，保留逐文件规则。点文件名的目录拓扑证据不外推点目录。projection留受测形态说明。 | 特殊文件名在已测ASCII根下可压缩；特殊目录根不压缩、相邻合法路径保留；现项目doc/05_testing/evidence/...等ASCII候选是否满足限制逐项核对，不能因字符白名单排除现合法根而静默E2BIG。 |
| code-r2 GLM-03 | probes/claude-directory.ts把createFixture纳入预期错误通道；调用者在目录后置臂捕获已定义ProbeFixtureError、路线读盘已知错误及明确预算拒绝。保留主probe；目录三态/hash/时间及新增项目hash清空，directoryEvidence.failure脱敏保存，清理保留独立步骤。catch不吞assert/程序错误、Schema内部异常等未定义内部错误。 | 工厂创建失败、目录populate失败、追加路线失败、预算拒绝时已完成主probe保存且目录不得true，已有臂保留、清理完成；未知TypeError/内部异常必须继续抛。通过doctor持久化接线验证，不只测helper。 |

## 三、准入取证与预算

路线×实际模型×缺口×旧证据×必要启动清单见REPORT_2026-10-11_agent_access_recovery.md。逻辑能力臂Claude20/Codex18，CLI包装与native分别计数；版本7臂及help1另计，三条目录doctor另批。完整指纹仍含全部模块/配置/bundle，整改会使旧H证据失配，不按正确回答或同版本CLI自动追认。先只做预算清单，不在plan批准前启动付费补测。

第7次敏感计划预检及正式启动前发布review-sensitive-depth-plan-batch.json：review此前68/73，预计15新增启动、硬上限20，具名扩容15后池上限88；admission仍342/343，本批无准入启动。只执行第7次B/plan；CLI费用和formal总8分列，版本/help/包装器/native/失败/超时/重试全部计数，旧台账O_EXCL追加。新静态证据独立r3目录，动态输出项目外；审查期间不新增被审材料，仅编排器和预算侧车按既有规则产出元数据。

Codex Qwen/DeepSeek只改变读取配方为明确的单一cat README.md，不改parsed_cmd精确read、cwd、唯一命令/完整输出/exit/status配对标准；禁止ls/echo/回退串扰，模型不执行指定单命令仍未通过。README正确首词不是读取证据。请求、配置、CLI回读、服务端各自列，effort不新增默认值。

Claude flash缺Grep交付、k3缺.env调用，用完整生产enumerateDenyPaths列全部精确目标，继续已授权独立夹具Read/Grep负对照，不改全局配置。四个未注册写工具的模型组合先审历史工具面、样本和配方；现阶段没有新机制，不重试write。原生产写标准必须真实模型实际尝试+精确配对拦截+文件前后状态；注册权限诊断、受控响应和未生成文件不替代。若仍无法取样，保留具体待审替代建议与原标准列，本任务不能因此完成。官方Claude订阅恢复前未测、0新启动；官方三档身份以CLI回读为界，不冒充服务端证明。

## 四、共享七入口迁移方案（独立操作）

只读核对与内容hash见shared-entry-audit.json，客户当前重名解析未测，来源null。影响面是Codex/ZCode所有读取~/.agents/skills的仓库；已读仓库未找到路径依赖，但完整依赖面未测。

在有效plan及本轮自动审批授权落盘、业务整改及两次check完成并生成最终构建后，迁移另写独立操作记录：列出七个精确目录，记录原文件hash/软链/权限，复制到~/.trivium/backups/唯一新目录，逐文件核对备份hash；再将原目录可恢复地移到同一备份根的moved目录。不能删除，不改其他共享skills、不绕安装器检查。确认专用七入口按渲染源和各carrier身份一致，运行四目标安装，核运行时/28专用入口及输入hash。

恢复方法：有残留/失败时停止，将已移动目录逐个移回原精确位置，拒绝覆盖现在存在的文件；恢复后逐文件核hash，恢复原发现面也恢复原冲突。完整备份始终保留。自动plan/code审批不得替换原标准判据，迁移授权的依据必须在操作记录单独写明最新用户授权及已获审方案，不从旧审批推断。

## 五、文档同步与版本边界

先把获批契约修订并入主设计§3.5/§10.1/§11.1/§11.6及ADR_003，再实施。同步PROTOCOL、dual-critic说明、GUIDE_local_pitfalls、QUICKSTART/RUNBOOK、CASE_manual_acceptance、报告及目录README；新增字段不枚举Agent、按现commonProbe形状及注册表纪律检查。业务包版本0.1.0不自动修改，设计文档补丁编号按仓库原口径。入口措辞若改，改skills-src并render，不能手改渲染产物。

## 六、有效审查及审批

第7次敏感补充计划全部静态材料落盘后正式B/plan、--driver codex、--topic原主题、--critics claude,gemini,glm；不allow-single。审查期间停止业务与证据写入，仅使用--wait/--status和现有预算运行元数据，约60秒反馈。读三份全文并逐条接受/驳回/暂缓，所有接受写落点；裁决经archive唯一出口，接受意见写完整下一轮计划。gate通过后await-approval，再按本轮最新自动审批授权调用approve，审批理由包括对应run、有效性核验及用户原指令，不复用旧审批。

实施、定向验证与真机补测完成后，先完成报告/静态审计/历史保留核对，再冻结全部范围；第8轮C/code覆盖相对39ed2053的完整本轮整改，三家完整重新审，不以旧approve类结论代替。逐条裁决、修复接受项并完成受影响检查，gate通过后本轮code审批。第8轮失败保留且停止正式启动，CLI扩容不授予第9轮。

## 七、检查、安装与提交

定向测试使用真实子进程假CLI和精确失败注入；不烧模型配额做回归。获批整改完成后串行两次npm run check，再14/14桩、重建、重装、安装副本hash核对；检查采样与真机能力指纹时点分列。以最终同一构建做能力刷新与正式代码审，未经必要不再重建；若提交后重建改变bundle，重新作范围判断，不自动追认。

自动提交/推送已授权，但只交付明确快照、不宣称未满足前置已完成。暂存逐个文件，Conventional Commits中文subject，末尾Edit by CZB，说明正文经文件传给git commit -F，不跳hook、不force。核远程main实际hash。

## 八、交付与停止条件

最终逐实际模型矩阵、七整改位置/验证、有效审查裁决及本轮审批、证据/预算/配置/安装状态，未测/未通过/剩余阻塞逐一列明。原写缺口未补、官方边界未交代、共享安装未完成或三审无效均保持目标未完成。判据替代须单独具体审查和明确批准，不与一般审批捆绑。预算触顶先发布扩容；正式总8轮触顶停止，不另起主题或改旧件。全部历史Schema、审查件和原证据保留。



不编号附录：历史r9/plan-r4接受约束原文（编号和总7/第7C均属该时点，当前以本r11正文为准）

# 相对r8原稿的改动（plan-r4 / run20261010T224543Z）

- CLAUDE-01：settings-size-reconciliation.json；新构建启动前用生产enumerateDenyPaths及实际目录事实计算settings，必须<=既有131072软上限，否则拒绝第7次spawn、不消耗轮数，不改变产品软线语义。
- CLAUDE-02：r9不编号附录逐字保留r7原文并标历史；本轮5段/总7/第7轮范围集中于正文及当前裁决编号空间。
- CLAUDE-03：round-guard引入当前授权文件及hash绑定的读取壳，纯核验函数显式接收当前权威并拒绝已superseded授权；旧launch不改，旧guard全文另存历史副本；两正式启动只经launch-v2；负例旧授权+5条+6C拒绝、未知hash拒绝及当前6条+7C允许。
- CLAUDE-04：PROTOCOL、QUICKSTART、GUIDE_local_pitfalls、CASE、dual-critic说明的五段待批句及PROTOCOL形态句、ADR003轮数句同步；设计§3.5/10.1/11.1/11.6、README指针/手册/报告更新，全仓逐句核对现行/历史归属。
- CLAUDE-05：round-guard注释不写固定数；r9现行约束写五个冻结ID，旧附录明确历史四；测试按授权historical_run_ids。
- CLAUDE-06：每路线七臂文件30/目录5/正对照4；180s每臂保持不自动放宽；主probe+三路线目录doctor按独立批执行，任一失败无事实/清理不全不消费；旧事实及超软线则第7次不得启动，不随机换提示。
- AGY-01：claude-directory回放固定8个精确生产根及对应coveredCount，projected.paths严格小于原集合，逐项覆盖/相邻合法/原集合与hash不变。
- AGY-02：claude-directory-adapter增加五段ASCII根及两级后代、原v1/缺事实回退，捕获settings并检查五段压缩规则。
- GLM-01：launch.mjs、launch-v2.mjs、round-guard及其保留副本、当前权威载体均纳入Git及完整重审；现行计数依v2五ID，旧历史附录保持原文。
- GLM-02：分歧/不可读立即停，不修改task/失败/计数；新增脱敏诊断证据，按已授权编排器状态/运行元数据核对来源；必要恢复必须另获明确授权及正式审查，墓碑仅说明事实、不得充当复活资格；补双向孤儿/重复负例。
- GLM-03：正文按claudeDirectoryFingerprint、consumeClaudeDirectories、probeClaude、peer_deny_applied与doctor清理符号及注释句族对账，旧附录行号仅历史原文。

第6次实际使用安装基线的18,644字节/192规则已见原trace；来源4053条保持完整，其4029条被8根覆盖，剩24逐文件，共32坐标。前一失败run的3924条同样未剪枝，实际压缩与当前v1无压缩反事实静态值不是同一条件；已对账，不称E2BIG实测。后续第7次以最终构建/当前配置/真实新事实算实际本轮禁读全集，超过现有131072软线则包装器在编排器review启动前拒绝，不消耗唯一代码轮数；不新增Bash豁免、不更改产品软线或只读判据。未通过的doctor不继承旧事实，不能借安装旧副本规避。


不编号附录：历史r7/plan-r3精确约束原文（逐字保留，仅供历史归属，当前范围以本r9正文及上述plan-r4裁决为准；原四ID、总6、根4、行号均属该时点）

CLAUDE-01：doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch.mjs纳入Git及第6轮代码范围；抽取纯核验函数，N=task.runs已启动条目数+1（包括running/failed），历史四ID是保留子集；task与归档ID集合严格相等。测试现4放5B/plan、现5放6C/code、现6及7拒绝、错入口/主题/Driver/critic、不读task、归档多一项均拒绝。

CLAUDE-02：更新adapters/claude.ts三处、probes/claude.ts1071及1076、types.ts2123、report.ts545；Claude合取为file_shape_verified及实际压缩工具已验证的防御不变式，其他适配器保持探针语义；历史引文逐处注明历史，源注释句族对账。

CLAUDE-03：scripts/agent-access-closeout.mjs将qwen-pro加入现kimi/kimi-pro/deepseek的write启动前拒绝；测试四组合均不spawn、不消耗启动预算。

CLAUDE-04：doc/02_design/README.md的ADR003条目指向2026-10-11恢复报告；ADR_003保留10-10历史段，另加10-11当前进度及报告指针。

CLAUDE-05：七历史行统一code-r2/run20261010T170416Z限定；本次裁决仅plan-r3/run20261010T175354Z，不改历史编号。

AGY-01：test/integration/claude-directory-adapter.test.ts同步注入真实cfg.review.sensitive_globs的hash及形态事实，并验证缺值/变更回退。

AGY-02：src/trivium/doctor.ts路线不稳定时snapshot与existing.probe均清空新增项目hash及形态事实；默认初始化和目录失败也一起清空。

AGY-03：静态检入test/fixtures/claude-deny-paths-replay.json，消费test/unit/claude-directory.test.ts；来源是原request.json.requests.claude.deny_paths，并与原out/trace.json sourceHash一致，记录原件hash、字段及精确集合hash；不依赖本地文件运行。

AGY-04：每批admission/review分别发布extension与启动清单，沿用旧根计数，硬上限包含wrapper/native/version/help/失败/超时/重试；CLI扩容与formal总6无关。

GLM-01：精确目录段正则^[A-Za-z0-9_-]+$，根1至4段、根下0至2级子目录，点目录及非ASCII不消费。目录doctor的原七臂扩展至四种根深度及两级后代，同次逐目标配对核验，增加nullable directory_deny_shape事实ascii-root1-4-depth0-2-v1；旧形态缺值不消费。projectClaudeDenyPaths超出段数/后代深度的路径维持逐文件；现生产根被排除时先补上述真实拓扑证据再消费，仍不符则逐文件并显式报告settings大小/启动失败，不悄然扩域。

GLM-02：迁移推迟至业务与两次check已完成后的最终构建；备份、移动、四目标安装及核验作为单一操作记录连续执行。任一步失败或意外中断标记rollback-required并恢复七入口，拒覆盖；重启先恢复该操作再继续，不保留未经登记过渡态。

GLM-03：claudeDirectoryFingerprint增加可注入readBinary参数（默认fs.readFile），本次调用精确路径Map复用；目录消费解析函数使用同一注入点测试0/1/2次及下一次重读；无跨调用缓存。

七条遗留意见均来自code-r2/run20261010T170416Z；上述12条均来自本次plan-r3/run20261010T175354Z，两个编号空间分开对账。
