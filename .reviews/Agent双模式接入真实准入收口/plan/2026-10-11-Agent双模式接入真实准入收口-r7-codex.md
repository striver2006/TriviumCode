# 相对r6原稿的改动（当前plan-r3，run 20261010T175354Z）

- CLAUDE-01：轮次载体和计数应明确且可回归。doc/05_testing/evidence/agent-access-20261011-closeout-r3/launch.mjs纳入Git及第6轮代码范围；抽取纯核验函数，N=task.runs已启动条目数+1（包括running/failed），历史四ID是保留子集；task与归档ID集合严格相等。测试现4放5B/plan、现5放6C/code、现6及7拒绝、错入口/主题/Driver/critic、不读task、归档多一项均拒绝。
- CLAUDE-02：过期注释需按全仓语义域同步。更新adapters/claude.ts三处、probes/claude.ts1071及1076、types.ts2123、report.ts545；Claude合取为file_shape_verified及实际压缩工具已验证的防御不变式，其他适配器保持探针语义；历史引文逐处注明历史，源注释句族对账。
- CLAUDE-03：四个无新机制的写组合应同样由机制拒绝。scripts/agent-access-closeout.mjs将qwen-pro加入现kimi/kimi-pro/deepseek的write启动前拒绝；测试四组合均不spawn、不消耗启动预算。
- CLAUDE-04：当前指针应同步而历史采样保留。doc/02_design/README.md的ADR003条目指向2026-10-11恢复报告；ADR_003保留10-10历史段，另加10-11当前进度及报告指针。
- CLAUDE-05：历史与当前相同编号应按run区分。七历史行统一code-r2/run20261010T170416Z限定；本次裁决仅plan-r3/run20261010T175354Z，不改历史编号。
- AGY-01：集成构造的目录事实也必须更新。test/integration/claude-directory-adapter.test.ts同步注入真实cfg.review.sensitive_globs的hash及形态事实，并验证缺值/变更回退。
- AGY-02：新增事实必须与原事实同生命周期。src/trivium/doctor.ts路线不稳定时snapshot与existing.probe均清空新增项目hash及形态事实；默认初始化和目录失败也一起清空。
- AGY-03：回放测试应独立于用户本地归档。静态检入test/fixtures/claude-deny-paths-replay.json，消费test/unit/claude-directory.test.ts；来源是原request.json.requests.claude.deny_paths，并与原out/trace.json sourceHash一致，记录原件hash、字段及精确集合hash；不依赖本地文件运行。
- AGY-04：底层只有两个独立预算池。每批admission/review分别发布extension与启动清单，沿用旧根计数，硬上限包含wrapper/native/version/help/失败/超时/重试；CLI扩容与formal总6无关。
- GLM-01：ASCII目录消费域必须精确且依据拓扑实测。精确目录段正则^[A-Za-z0-9_-]+$，根1至4段、根下0至2级子目录，点目录及非ASCII不消费。目录doctor的原七臂扩展至四种根深度及两级后代，同次逐目标配对核验，增加nullable directory_deny_shape事实ascii-root1-4-depth0-2-v1；旧形态缺值不消费。projectClaudeDenyPaths超出段数/后代深度的路径维持逐文件；现生产根被排除时先补上述真实拓扑证据再消费，仍不符则逐文件并显式报告settings大小/启动失败，不悄然扩域。
- GLM-02：避免共享入口已迁移但整改未完的中停态。迁移推迟至业务与两次check已完成后的最终构建；备份、移动、四目标安装及核验作为单一操作记录连续执行。任一步失败或意外中断标记rollback-required并恢复七入口，拒覆盖；重启先恢复该操作再继续，不保留未经登记过渡态。
- GLM-03：hash读取次数需有直接观测通道。claudeDirectoryFingerprint增加可注入readBinary参数（默认fs.readFile），本次调用精确路径Map复用；目录消费解析函数使用同一注入点测试0/1/2次及下一次重读；无跨调用缓存。

# Agent双模式接入真实准入收口：遗留整改与有效复审计划

2026-10-11，Driver=codex；这是第5次正式运行三审后合入全部意见的r7定稿，审批状态以正式闸门记录为准。沿用原主题，正式入口B/plan；第6次正式运行使用C/code。r5和所有失效运行原样保留。

## 一、目标、当前事实与授权

作为M11第12步前置，完成七条遗留整改、有效完整三审、真实准入矩阵和安装收口；七路线全部原标准未满足则目标不完成。基线39ed2053及远程main已核对；运行时与claude/gemini已更新，四目标安装被共享七入口阻断。旧H批5通过/5未测/2读取未通过，只适用历史完整指纹。

用户明确授权同主题额外两轮：第5次遗留计划、第6次完整代码；不以新主题、删计数或改失败状态规避。原生编排器没有例外登记接口，能力限制在恢复报告明说。处理方式：独立授权证据进入正式context冻结；包装器启动前核对task.runs及归档实际运行，两者都须保留原四次并一致，不可读拒绝；第5次只允许B/plan，第6次只允许C/code，>=6拒绝。不宣称该任务约束已经成为产品原生轮数机制。授权记录文件和hash进入调用记录，正式run记录entry/stage/subject/context，结束后逐项核验；失败仍占轮次，无第7次授权。

用户随后明确授权“中途遇到需要审批的，根据你的建议自动审批；如果遇到配额不够的，自动增加配额”。本轮自动plan/code审批以三家有效结构化结论、无作废、逐条裁决、gate通过为前提，审批附言记录本轮授权及具体审查run。若失败，不approve；没有有效审查不得借自动审批实施。一般审批不改变原写负对照判据。敏感guard语义不改，无Bash豁免。

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

第5轮预检及正式启动先发布新增review批清单和硬上限，包含版本/认证/重试/包装边界。当前review38/40，admission与review两池分别具名幂等扩容并核对各自累计上限，不存在合并总池；每次失败、超时和help/version都计，formal轮数仍6。O_EXCL台账沿用旧根，不重置；新静态证据独立目录、动态调用输出在项目外，审查期间只允许现有编排器与预算元数据，不追加被审材料。下一批发布后才spawn。

Codex Qwen/DeepSeek只改变读取配方为明确的单一cat README.md，不改parsed_cmd精确read、cwd、唯一命令/完整输出/exit/status配对标准；禁止ls/echo/回退串扰，模型不执行指定单命令仍未通过。README正确首词不是读取证据。请求、配置、CLI回读、服务端各自列，effort不新增默认值。

Claude flash缺Grep交付、k3缺.env调用，用完整生产enumerateDenyPaths列全部精确目标，继续已授权独立夹具Read/Grep负对照，不改全局配置。四个未注册写工具的模型组合先审历史工具面、样本和配方；现阶段没有新机制，不重试write。原生产写标准必须真实模型实际尝试+精确配对拦截+文件前后状态；注册权限诊断、受控响应和未生成文件不替代。若仍无法取样，保留具体待审替代建议与原标准列，本任务不能因此完成。官方Claude订阅恢复前未测、0新启动；官方三档身份以CLI回读为界，不冒充服务端证明。

## 四、共享七入口迁移方案（独立操作）

只读核对与内容hash见shared-entry-audit.json，客户当前重名解析未测，来源null。影响面是Codex/ZCode所有读取~/.agents/skills的仓库；已读仓库未找到路径依赖，但完整依赖面未测。

在有效plan及本轮自动审批授权落盘、业务整改及两次check完成并生成最终构建后，迁移另写独立操作记录：列出七个精确目录，记录原文件hash/软链/权限，复制到~/.trivium/backups/唯一新目录，逐文件核对备份hash；再将原目录可恢复地移到同一备份根的moved目录。不能删除，不改其他共享skills、不绕安装器检查。确认专用七入口按渲染源和各carrier身份一致，运行四目标安装，核运行时/28专用入口及输入hash。

恢复方法：有残留/失败时停止，将已移动目录逐个移回原精确位置，拒绝覆盖现在存在的文件；恢复后逐文件核hash，恢复原发现面也恢复原冲突。完整备份始终保留。自动plan/code审批不得替换原标准判据，迁移授权的依据必须在操作记录单独写明最新用户授权及已获审方案，不从旧审批推断。

## 五、文档同步与版本边界

先把获批契约修订并入主设计§3.5/§10.1/§11.1/§11.6及ADR_003，再实施。同步PROTOCOL、dual-critic说明、GUIDE_local_pitfalls、QUICKSTART/RUNBOOK、CASE_manual_acceptance、报告及目录README；新增字段不枚举Agent、按现commonProbe形状及注册表纪律检查。业务包版本0.1.0不自动修改，设计文档补丁编号按仓库原口径。入口措辞若改，改skills-src并render，不能手改渲染产物。

## 六、有效审查及审批

第5轮全部静态材料落盘后正式B/plan、--driver codex、--topic原主题、--critics claude,gemini,glm；不allow-single。审查期间停止业务与证据写入，仅使用--wait/--status和现有预算运行元数据，约60秒反馈。读三份全文并逐条接受/驳回/暂缓，所有接受写落点；裁决经archive唯一出口，接受意见写完整下一轮计划。gate通过后await-approval，再按本轮最新自动审批授权调用approve，审批理由包括对应run、有效性核验及用户原指令，不复用旧审批。

实施、定向验证与真机补测完成后，先完成报告/静态审计/历史保留核对，再冻结全部范围；第6轮C/code覆盖相对39ed2053的完整本轮整改，三家完整重新审，不以旧approve类结论代替。逐条裁决、修复接受项并完成受影响检查，gate通过后本轮code审批。第6轮失败保留且停止正式启动，CLI扩容不授予第7轮。

## 七、检查、安装与提交

定向测试使用真实子进程假CLI和精确失败注入；不烧模型配额做回归。获批整改完成后串行两次npm run check，再14/14桩、重建、重装、安装副本hash核对；检查采样与真机能力指纹时点分列。以最终同一构建做能力刷新与正式代码审，未经必要不再重建；若提交后重建改变bundle，重新作范围判断，不自动追认。

自动提交/推送已授权，但只交付明确快照、不宣称未满足前置已完成。暂存逐个文件，Conventional Commits中文subject，末尾Edit by CZB，说明正文经文件传给git commit -F，不跳hook、不force。核远程main实际hash。

## 八、交付与停止条件

最终逐实际模型矩阵、七整改位置/验证、有效审查裁决及本轮审批、证据/预算/配置/安装状态，未测/未通过/剩余阻塞逐一列明。原写缺口未补、官方边界未交代、共享安装未完成或三审无效均保持目标未完成。判据替代须单独具体审查和明确批准，不与一般审批捆绑。预算触顶先发布扩容；正式总6轮触顶停止，不另起主题或改旧件。全部历史Schema、审查件和原证据保留。


不编号附录：本次合入意见的精确实施约束

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
