# Kimi Code 与 Qoder CN macOS 独立 Driver 验收

日期：2026-10-28。Driver：Codex。基线：`main / d4abd6f3d4e04276217b5e1f73a8ac02cb039e83`，开始时工作树干净。Bob授权继续独立Driver工作、暂不双审；本批没有启动真实A/B/C/D、审核者CLI或人工审批，没有提交、推送、发布或更改版本1.3.2。

## 1. 基线和隔离边界

仓库AGENTS已读取。安装wrapper指向`~/.claude/skills/dual-critic/scripts/trivium.cjs`；开始时`install:check`通过，status全部主题的`open_gates=[]`。安装产物最终hash及自动化结果见本目录[证据索引](evidence/driver-cli-20261028/index.json)与[验证摘要](evidence/driver-cli-20261028/validation.json)。历史失败证据不改写。

本机Kimi CLI仍为2.3.3，二进制hash `28ad8a2434f8ce01034648e90596b04562f82af044d9e1bd296e37fa21f51120`；Qoder CLI CN仍为1.1.80，hash `33050a4d2ac134e2f8d0a5293cba3df009d7bdbe0f3ae478c73057f113050a02`。实验复制当前可执行字节，未升级厂商CLI。历史2.4.0规则失败保留于原报告，本批不再下载或重跑。

新工具为`driver-cli.mjs`，四种显式case：discover、status、collision、local。默认销毁私有根；每次写唯一JSON，保留配置/认证来源hash前后值、实际argv/cwd、原生轨迹、退出码及清理回读。每次最多16次派生，每次90秒，Node侧按组TERM→KILL；这不是完整原生逃逸后代生命周期验收。仅local可显式保留无凭据夹具；私有凭据不得保留。

local只在esbuild读取注册表时把关闭候选的`driverEnabled`转换为true，记录变换前后和bundle hash，工作树注册表及生产开关不动。这个独立产物没有安装。项目wrapper仅接受status、topic claim/resolve；当前保留夹具的审查入口锁定。这是实验防误调用措施，不宣称为厂商沙箱。

## 2. 原生CLI发现与实际调用

| 项目 | Kimi 2.3.3 | Qoder CLI CN 1.1.80 |
| --- | --- | --- |
| 七技能及来源 | 原生请求system技能目录列出七项，私有`KIMI_CODE_HOME/skills`，每项一次、hash与仓库一致 | 原生`skills list`列出七项，私有`.qoder-cn/skills`，每项一次、hash与仓库一致 |
| 用户共享读取面 | 独立`~/.agents/skills/driver-shared-sentinel`被发现 | 同一形状共享哨兵被发现 |
| 同名控制 | 用户根/共享根/项目`.agents/skills`同时放dual-status时，仅项目项生效 | 同一控制下仅自家用户项生效，项目`.agents`没有覆盖它；其它项目路径优先级未测 |
| 安装查重 | 生产checkInstall对共享同名项报错，没有删除它凑通过 | 同左 |
| `-p`实际调用 | `/skill:dual-status …`原样进入模型；原生Skill工具加载后追加`ARGUMENTS:` | `/dual-status …`经原生入口识别并发起Bash状态命令 |
| 参数与cwd | 受控响应下原生Skill→Bash→真实wrapper→status通过 | 官方真实模型→Bash→真实wrapper→status通过 |
| 模型边界 | loopback合成响应，真实模型未测；现有认证文件access/refresh token为空，认证前置阻塞 | 官方默认Auto路线；标签/计费键不证明底层具体模型，底层身份null/unknown |
| 交互TUI菜单语法 | 未测；不把headless等同TUI | 未测；本批是官方CLI非交互模式 |

参数样本为 ``中文 空格 O'Bob $HOME `literal` --尾``，cwd为私有`中文 空格项目`。成功批次同时核验原生工具调用、wrapper账本的完整argv/cwd、底层status退出0；不能只看厂商result success。Kimi的Bash参数由受控响应指定，仅证明原生参数传输和执行接线，不证明真实模型会正确转抄；Qoder的参数由真实模型生成，该次逐字一致不承诺所有提示/版本恒真。

七技能逐项状态：

| 技能 | Kimi发现 | Qoder发现 | 实际执行状态 |
| --- | --- | --- | --- |
| dual-run | 通过 | 通过 | 两家真实A流程未测 |
| dual-review-plan | 通过 | 通过 | 两家真实B流程未测 |
| dual-review-code | 通过 | 通过 | 两家真实C流程未测 |
| dual-review-bug | 通过 | 通过 | 两家真实D流程未测 |
| dual-approve | 通过 | 通过 | 两家未测，仅Bob显式发起 |
| dual-status | 通过 | 通过 | Kimi受控原生通过；Qoder真实模型通过 |
| dual-abandon | 通过 | 通过 | 两家未测，须专用主题及显式授权 |

官方[技能文档](https://www.kimi.com/code/docs/en/kimi-code-cli/customization/skills.html)说明原生占位符和无占位符尾段机制；本机Skill调用实录验证了后者。官方[Qoder能力说明](https://docs.qoder.cn/cli/built-ins)与本机help用于定位命令，验收结论仍来自本次原生输出。

## 3. 独立自动化与原稿身份

两家local均通过：生产bundle对关闭的Driver退64；独立候选bundle认领plan成功；认领之后经archive唯一出口生成本身份后缀原稿；另一真实CLI进程的topic resolve省略driver时继承认领值；第三进程同值认领noop。task、原稿路径及输出保存在原件。它们是本地进程和隔离构建测试，没有模型或审核worker。

两份保留夹具位置与candidate hash见最新local原件的`retained_fixture`及临时根`fixture.json`。它们仅用于复查status/resolve和认领继承，不含认证；不应当安装candidate产物，亦不应在未收到正式入口请求时解除wrapper的审查锁定。系统清理临时目录后可按以下命令重建：

```sh
node scripts/acceptance/kimi-qoder-cn/driver-cli.mjs --agent kimi --case local --keep-fixture yes
node scripts/acceptance/kimi-qoder-cn/driver-cli.mjs --agent qoder-cn --case local --keep-fixture yes
```

保留目录是有意留存，不记作“已删除”。普通native批次的私有根均逐项回读不存在；Qoder认证只复制user/machine_id，使用生产私有根加载/清理设施及0600权限。所有已采集来源hash前后一致。监督者自身被SIGKILL、逃逸后代及Windows ACL仍未测。

## 4. 本轮实际修改和失败留痕

- 新增Driver验收工具与默认回归。目录解析同时校数量与实际来源，不能以文本含技能名判通过；候选变换失败即拒绝；清理只接受ENOENT，EACCES等抛错；已知复制凭据逐值脱敏。
- 入口渲染器新增通用`native-tail`模式；Kimi载体使用该模式，修正“本载体不替换参数”的错误概括；七份入口统一render，保留显式调用、空参和shell转抄规则。Qoder资产不改，生产开关全部保持false。
- 同步主设计、注册表实测注释、实施计划、矩阵、工具说明与本报告。本次无版本号变更。

装置失败全部保留：首个helper ESM bundle动态require失败；候选变换正则不够精确而在构建前拒绝；假`.git`目录导致loadCtx退69；topic resolve缺原始参数/缺认领后原稿而退64/65。修正为CJS helper、逐注册块精确变换、真实git init、正确原始参数契约和认领后archive原稿。

首轮Kimi/Qoder状态调用虽然完整透传，底层status因假`.git`退69；旧采集器当时只看native成功与argv，因此旧`checks`不能作为状态成功结论。后续增加账本`exit_code`和`status_succeeded`，两家修正装置的新批次底层status均退出0。Qoder真实模型共两次状态调用：一次装置失败、一次成功，没有重复提示词碰审核拒绝。Kimi所有调用均为受控响应；没有复制其真实认证，没有冒充真实模型通过。首轮清理单测误把ENOTDIR当ENOENT预期，修正测试后通过，判定代码未放宽。

## 5. 正式入口待验步骤与标准

以下均未执行。本轮不通过现有正式入口自行启动审查。准备范围为中文空格Git夹具、原稿、隔离候选bundle和具体调用文本；完整可审查客户端会话及认证仍待正式入口授权后准备。Kimi需要可用的私有原生登录/账号决定；不代Bob登录或改全局配置。

在对应原生CLI的**专用隔离项目**中，由Bob显式发起（主题分别使用新后缀，固定已定gemini,glm，不自行少选；本轮Codex执笔与以后被验客户端Driver身份分别记录）：

| 入口 | Kimi显式文本 | Qoder CN显式文本 |
| --- | --- | --- |
| A | `/skill:dual-run 为夹具增加一个有测试的纯函数 --topic DriverCLI-Kimi-A --critics gemini,glm` | `/dual-run 为夹具增加一个有测试的纯函数 --topic DriverCLI-Qoder-A --critics gemini,glm` |
| B | `/skill:dual-review-plan 检查夹具纯函数计划 --topic DriverCLI-Kimi-B --critics gemini,glm` | `/dual-review-plan 检查夹具纯函数计划 --topic DriverCLI-Qoder-B --critics gemini,glm` |
| C | `/skill:dual-review-code 检查夹具纯函数实现 --topic DriverCLI-Kimi-C --base HEAD --critics gemini,glm` | `/dual-review-code 检查夹具纯函数实现 --topic DriverCLI-Qoder-C --base HEAD --critics gemini,glm` |
| D | `/skill:dual-review-bug 检查夹具已知缺陷根因 --topic DriverCLI-Kimi-D --critics gemini,glm` | `/dual-review-bug 检查夹具已知缺陷根因 --topic DriverCLI-Qoder-D --critics gemini,glm` |

执行前先在隔离项目建立可用HEAD、相应阶段材料及真实探针；当前local夹具只锁定本地命令，不能直接用它宣称正式入口可执行。收到Bob正式请求后再在专用项目准备允许该次流程的wrapper及私有客户端会话，严禁修改产品registry凑通过。若生产关闭仍使前置不满足，继续标阻塞，不能绕过检查当成正式产品验收。

标准：原生入口完整加载；preflight、topic、review的Driver同值；原稿后缀、run.driver、交接options.driver及worker恢复值相同；requested_routes逐项冻结；真实审核者指纹/模型路线、逐条裁决和gate有对应留痕。B/C/D审批前必须停点，只有Bob显式的`/skill:dual-approve --topic <主题> --stage <阶段>`或`/dual-approve …`才可继续。恢复与专用主题abandon另验，不能由status或local回归推成通过。正式双审/verify本批均未测。

## 6. 状态与剩余阻塞

Driver已有CLI发现、原生状态调用、参数/cwd及隔离认领证据；两家生产Driver仍关闭，完整Driver接入未完成。Kimi真实模型受认证前置阻塞；真实任务、审查worker交接、裁决、人工停点/恢复/放弃均未测。CLI之后的Kimi桌面、Qoder CN桌面、Kimi VS Code Extension Host均未测。

审核者独立保持阻塞：Kimi 2.3.3/2.4.0规则执行反例不变；Qoder Edit/Bash等完整执行层安全矩阵、路径/配置叠加与生命周期缺口不变。所测合成Custom的100406不推广成官方/BYOK不可用。没有新增生产准入台账，两家criticEnabled/defaultSelected/driverEnabled仍false。Windows全部未测。

本批完整检查、最终安装和本地自检结果在验证摘要中另列，自动化不等于真实客户端正式审查验收。完成后等待Bob决定提交/推送；不自动执行Git交付。

最终自动化：`npm run check`退出0，4177项中4168通过、9跳过、0失败，测试350.8秒；新增采集器5/5通过（纳入默认测试），当前入口/文档索引/采集器定向54/54通过；桩自检14/14通过，正式verify未测。最终再build并重装，install:check通过；仓库/安装bundle SHA256同为`22fce4561d43e6cc6b9d97f4fd3e2b19f0875ec769c209285a69be6587f8c604`，两家共14份安装入口与当前源产物逐字节一致。两家配置/认证hash与首批快照相等，最终open_gates=[]，两家三个生产开关均false，无准入台账，HEAD仍d4abd6f3。摘要索引保留23份采集原件，首轮装置失败及后续成功分别列示，原件source hash不伪装为最终采集器逐字复跑。

交付授权：Bob随后明确要求“提交、推送”。提交本轮Driver工具、入口资产、测试、同步文档及脱敏证据，推送当前main至origin；不含本机配置、凭据、临时candidate或构建产物。验证日志摘录以`.txt`随交付保存，避免被仓库日志忽略规则遗漏；仅复制摘录并去除行尾空白，验证摘要同步excerpt hash，历史native原件和原始完整日志不改。上述未提交状态保留为开发收尾时点，最终提交号与远端状态以Git回读为准；Git交付不提升任何未测或准入状态。

## 7. main / 892c4767 独立身份续验（2026-10-28）

本节为之后的新一轮，Codex执笔，开始时`main / 892c4767747cbce3acb2aa213097f9aa28f37781`、工作树干净，所有主题`open_gates=[]`，安装检查通过。沿用Bob“暂不双审”：未在本仓或真实客户端调用正式A/B/C/D、审核者CLI、approve或abandon，没有提交、推送、发布、修改版本或生产开关。前六节及旧23份原件保持历史事实；上节Git交付授权不延续为本轮自动提交授权。

### 7.1 新装置与自动化

新增`driver-identity.mjs`、`driver-identity-index.mjs`、`kimi-auth.mjs`与回归，默认测试收录。只在临时esbuild的单个注册块开启被验侧Driver，记录源/变换/bundle指纹，完全不安装候选。`src/`、`skills-src/`与生成入口均无修改，产品契约及版本仍1.3.2。

新夹具用真实Git init和一次夹具提交建立可用HEAD，HEAD中的sum错误为减法，工作树为加法，另有计划/根因材料、项目配置和独立run_root。夹具提交不涉及本仓Git。plan/bug先认领再由验收wrapper调用生产archive唯一出口写归属材料；code也放一个明确标记为“归属材料”的文件用于验证使用后不能换身份，**不把它说成正式命令C的必需原稿**。模型实际调用的是wrapper；采集器没有替模型直接发认领命令。归属材料正文由装置固定生成，不代表真实业务原稿撰写质量已验。

零配额回归覆盖两候选×三个阶段：生产关闭退64，独立进程认领/解析，真实HEAD上的diff可用，plan/bug找本身份原稿；两个并发进程同值认领均noop，声明字节不变；异身份claim/resolve退64且不改声明。另用真实轨迹离线验证：入口必须有同ID成功结果；缺失/错ID/被拒不能通过，首批失败与客户端纠错不能抹除。

上一轮两份保留夹具仍存在，但`git rev-parse --verify HEAD`失败（仅有初始化git，没有提交）；未覆盖或删除。新两份有效夹具及`formal-pending.json`的位置见本批local原件，均无凭据，清理责任写入`fixture.json`。中间一次仅本地认领夹具已另列清理，不能把“保留”报成已删除。

### 7.2 Kimi认证核清及真实客户端

当前安装仍2.3.3，不升级。按该版本官方固定commit的[认证源码摘要](evidence/driver-identity-20261028/kimi-auth-source.json)核清：原生file OAuth的`oauth/kimi-code`映射到`credentials/kimi-code.json`；空access token属于revoked记录。配置也支持内联api_key、显式api_key_env及provider env的KIMI_API_KEY路径；它们不是可从任意产品认证文件自动拼出的官方登录。keyring仅见schema声明，本轮不读取系统钥匙串，也不宣称已证明其可用。

仅读取当前配置所需非敏感键与hash：managed官方endpoint为`https://api.kimi.com/coding/v1`，default alias为`kimi-code/kimi-for-coding`，model声明为`kimi-for-coding`；全局对应file OAuth的access/refresh均为空、无内联key或显式api_key_env、当前进程无Kimi认证环境变量。新私有副本中的实际请求退出1，明确报`provider managed:kimi-code has no credential configured`，不是由历史采样推断所有认证方式不可用。原件见[kimi-auth](evidence/driver-identity-20261028/kimi-auth-1793195452509-24a5e3.json)。

Bob随后亲自在单独HOME/KIMI_CODE_HOME运行官方login并报告成功。采集器只将该私有原生OAuth引用、配置及必要身份文件复制到一次性0700根/0600文件，不改成静态key，不动全局账号、provider/model。真实客户端成功批次见[Kimi原件](evidence/driver-identity-20261028/kimi-real-1793196160184-33e015.json)：

- 原生`/skill:dual-status` → Skill同ID加载 → Bash → wrapper账本 → 底层status退出0。
- 两个独立官方CLI会话实际Read三份已安装入口内容，再由模型生成本地Bash命令；plan/code/bug各自认领为kimi，归属材料均为kimi后缀，第二会话省略driver解析继承、同值noop、改codex均退64。
- CLI均完整退出0，无超时/截断；两个会话ID不同。配置声明与模型请求有hash绑定，底层具体模型身份仍null/unknown；不把别名当服务端身份证明。

Kimi status另写了私有会话内计划文件，均在一次性根中；这是Driver行为，不是只读审核通过证据。Kimi真实模型特殊字符argv仍未测，本批只补真实status和身份项，旧受控透传证据不提升来源。

两次装置问题保留：首次要求新login一定有region，导致启动前ENOENT，未发模型请求，另存失败说明；随后`--auto`与`-p`组合被2.3.3拒绝，原件[kimi失败](evidence/driver-identity-20261028/kimi-real-1793195792649-de6a64.json)，并未调用模型。去掉不兼容旗标后才产生上面的真实成功。

### 7.3 Qoder CN真实客户端及失败边界

仍为1.1.80，采用最小官方认证副本和生产withQoderHome清理设施。省略`--model`，私有settings未声明model；原生init回读Auto，底层身份null/unknown。本批不重复status、特殊字符参数、中文空格cwd的既有独立项目。

首批两个真实会话完成身份操作，但私有skills目录不在工作区，Read和cat实际被拒；且采集器只看首个resolve失败，漏掉模型后续成功调用。保留[首批原件](evidence/driver-identity-20261028/qoder-cn-real-1793195599403-3d29d8.json)，该批不能算入口加载通过。不是审核只读准入实验。

根据实际错误加入官方`--add-dir <私有skills根>`，只扩大本轮Driver对无凭据入口目录的工作区读取，未扩大到auth目录。补验[原件](evidence/driver-identity-20261028/qoder-cn-real-1793195912680-2d1e36.json)的两个不同会话均实际Read三份原入口，工具结果含对应driver命令；plan/code/bug认领、归属材料、继承、noop、错误身份拒绝全部有Bash同ID结果及wrapper的argv/cwd/底层退出码、task落盘关联。

这批原件的`passed=false`保留：模型第一次把fixture-draft误写成旗标形状，被wrapper退64，之后纠正成正确位置参数。离线索引分列`identity_items_passed=true`、`collector_passed=false`、`clean_first_attempts=false`。**独立身份项有证据通过，整场无误调用不通过**，不能改旧总标志或再烧配额只为得到绿色。工具加载和本地身份结果也不代表正式斜杠审查入口已运行。

### 7.4 更新后的矩阵与正式待验

| macOS独立项 | Kimi 2.3.3 | Qoder CN 1.1.80 |
| --- | --- | --- |
| 官方真实模型原生status | 通过（本批） | 通过（上一批，本批未重跑） |
| 三阶段入口内容实际加载为参考 | 通过 | 通过；首批权限失败保留 |
| plan/code/bug认领及本身份归属材料 | 三阶段通过 | 三阶段通过；含一次wrapper参数错误后纠正 |
| 另一官方CLI会话继承、noop、异身份退64 | 三阶段通过 | 三阶段通过 |
| 无误调用会话总检查 | 通过 | 失败；不掩盖纠错样本 |
| 正式A/B/C/D、worker交接、裁决、人工停点/恢复/放弃 | 未测 | 未测 |
| 生产Driver启用 | 关闭/阻塞，完整验收未完成 | 关闭/阻塞，完整验收未完成 |
| 审核者严格只读准入 | 阻塞；原反例保留，本批未重测 | 阻塞；完整安全矩阵仍缺，本批未重测 |
| 桌面端、Kimi VS Code插件、Windows全部 | 未测 | 未测；不含Qoder插件 |

每份新local夹具已准备四条确切入口文本、独立主题、B/D原稿、C的HEAD/diff和前置条件，写在`formal-pending.json`，源工具可重建。A要求增加测试并修正sum，B审计划，C审当前改动，D审减法根因；文本沿用上一批`--critics gemini,glm`，实际账号、探针与正式集合仍须未来显式入口核定，**本批未预检**。

标准继续为：入口/认领/原稿/run.driver/交接options.driver/worker恢复一致，requested_routes逐项冻结，真实审核指纹与路线、逐条裁决和gate齐全；B/C/D在人工停点停止，Bob显式approve才恢复；专用主题恢复/abandon另验。当前wrapper仍拒绝正式命令，`formal-pending`只是材料准备，不代表可审查客户端已经就绪。生产Driver关闭仍是正式产品前置阻塞，不能用candidate代替生产通过。

本批离线索引、最终自动化、全局/安装回读和清理事实见[evidence目录](evidence/driver-identity-20261028/)中的最新index与validation；原件不补写，采集器迭代hash不同如实记录。全部可独立推进的取证完成后等待Bob另行决定Git交付或正式入口。

### 7.5 本批验证与清理收尾

`npm run check`退出0：4181项、4172通过、9跳过、0失败，374.2秒；入口/文档索引/取证工具定向58/58，最后工具回归4/4。既有全量测试在各自临时夹具中包含桩review、approve/abandon等状态机回归，没有真实审核者CLI或本仓闸门变化；不能充作本轮正式流程验收。工具最终又补了实际HEAD读取及实时关联摘要，这些零模型改动有最后定向回归，不追加真实模型调用，也不宣称按最终脚本hash逐字重跑历史原件。本轮selftest、正式verify未测。

本批真实模型客户端启动为Kimi三次（status和两个身份会话）、Qoder四次（首批两个、补验两个），每次内部均有多轮模型交互，不能把CLI启动数称为网络请求数。无凭据请求与不兼容旗标的失败另外列证，受控loopback调用本批0次。

全局两家配置/认证五个hash仍与本轮开始及上一轮validation相等；`driverEnabled/criticEnabled/defaultSelected`六个值全部false，无新增准入台账，最终open_gates为空。安装check通过，14份安装入口与仓库生成物字节相同。安装bundle保持`22fce456…`；check重建的仓库bundle为`8484607d…`，只含构建标识差异（HEAD/inputs/built_at）；精确移除唯一构建标识赋值后其余字节完全相等，归一化SHA256为`fb43672b96d828bba097c4039e465bfda57a07322134254d56f5b7c4da7f200e`。本轮未改运行时代码或入口，不重装生产，也没有安装candidate；两个完整hash与回读存入[validation](evidence/driver-identity-20261028/validation.json)。

两家真实批次一次性根全部逐项回读不存在。Bob使用的私有登录根在确认无匹配残留进程、私有来源hash未变及已知凭据扫描无匹配后删除；该login.sh路径现已失效，无待Bob补做认证。它不改变全局空token记录。中间多余的local根及临时公开源码根也已删除。新两份有HEAD/正式待验材料的local根和历史两份旧夹具有意保留，均无凭据；见[cleanup](evidence/driver-identity-20261028/cleanup.json)与validation，不能称作全部临时根均已删除。完整厂商逃逸后代/监督者强杀回收及Windows ACL仍未测。

下一依赖是Bob另行显式调用具体正式入口及未来Driver开关的准入决定；当前没有认证操作待办。Git交付须另行授权，本轮HEAD未动。

本节后续交付：Bob明确授权“提交、推送”，本轮工具、测试、同步文档及18份脱敏证据按文件清单提交至当前main并推送origin。交付前远端与892c4767一致、133个主题无未关闭闸门，12份索引对象hash逐项匹配、18份证据敏感信息扫描无匹配。未纳入全局配置、凭据、临时candidate或构建产物，不改版本及生产开关。Git交付不提升正式入口、审核者准入或Windows状态；提交号和推送结果以Git回读为准。

## 8. main / 0048e086 Qoder CN命令B前置（2026-10-28）

Codex为开发Driver，被验客户端为Qoder CN官方CLI。开始时main/0048e08633bd9a4e15aa2d93ecbee9c2ffb92782、工作树干净，安装check通过，133个主题没有open_gates。读取仓库AGENTS、环境/开发指南、设计§3.5/8.3/10.3/11.2/11.3及上轮第7节、validation、最新index、两份Qoder真实原件、cleanup、矩阵、计划和工具说明。本批只解除了专用夹具Qoder B限制，没有启动本仓开发主题审查、Kimi模型、A/C/D、approve或abandon；无提交/推送/发布。

**结果：前置阻塞，真实命令B未启动。** 当前两审路线声明为gemini-3.8-flash-high（effort high）和GLM-5.3（effort null）。两家的生产availability报告可用，Gemini安装只读Agent与仓库字节一致；这只说明现有工具配置可用。项目保存的两份path_deny均为false，method记录同行哨兵读取反例，coverage_complete/file_shape_verified均为null。GLM的工具deny参数与Gemini的只读白名单不覆盖这些缺口。没有把口头约束、工具未调用或工作树无变化当成执行层拒绝，也没有改动产品guard/gate或用候选Driver开关放宽审核准入。这里核的是既有探针记录，**不是本批新真实实验**，也不推断厂商所有新版本均不可用。

两份组合认证缓存为当日08:59/08:58 UTC的历史成功，当前来源fingerprint/声明CLI版本仍匹配，但已过认证TTL。当前账号能否调用、实际CLI版本/模型/effort回读均未重新探活；本次只记录入口hash、探针声明和历史缓存，不将它们称作本批认证通过。严格前置失败后未花模型配额重取绿色，亦不改少审核者。Qoder二进制hash仍为33050a4d…，对应历史1.1.80字节；本批没有模型会话。

### 8.1 独立装置与自动化

新增qoder-plan.mjs及默认收录的回归。保留旧Qoder夹具HEAD ff8fa2d…、原稿hash40f72615…、candidate hashd9c3ff95…均匹配；旧目录与原件不修改。另建明确标记的专用B根，真实Git HEAD、原稿、独立run_root及清理责任写入fixture-B.json。新候选仍只在esbuild内转换qoder-cn.driverEnabled；其它开关及源注册表不动，不安装候选。计划先在夹具中认领qoder-cn，再用archive唯一出口落盘；本地claim和固定原稿只算备料，不算真实客户端撰写或认领。

新wrapper把范围限定为本主题/plan/qoder-cn/gemini,glm/B，拒绝审批、放弃、其它阶段/集合、未知run和直接worker恢复；归档通道只消费夹具内暂存正文并使用archive。当前review --start在派生前固定退69，不能通过把spec布尔改true解锁。它是启动前备料/拒绝装置，**正式审查能力仍未验**；没有将它或旧本地wrapper称作正式流程通过。未来严格证据齐备后须按证据修订专用装置，当前没有隐式解锁选项。

5项定向回归包含真实独立wrapper子进程，核验未执行candidate、底层69/64拒绝码和账本。首跑cwd测试使用/var别名与子进程/private/var比较，4通过/1失败；修正测试根先realpath，与生产一致，判据不放宽。失败摘要单独保留。装置准备有三份版本原件：首个未把认证TTL加入blockers，第二个之后又将helper加载移到指纹核验之后，最新一份为当前；不改写早期原件，旧根的脚本pin已失配，不能称作可直接运行。

### 8.2 真实B逐环节及停点

| 环节 | 本轮状态 |
| --- | --- |
| 旧夹具核验、新夹具/HEAD/原稿/run_root/清理责任 | 通过，仅备料 |
| 隔离候选、范围拒绝与archive通道 | 自动化通过；正式客户端能力未测 |
| gemini/glm严格只读前置 | 阻塞，既有负对照及覆盖缺口 |
| 当前账号真实可调用、正式preflight | 阻塞/未测，缓存过期后未重跑 |
| Qoder原生B入口/工具ID/argv/cwd/底层退出码 | 未测，未启动；装置账本不代替原生轨迹 |
| Qoder实际认领与真实撰写原稿/修订计划/裁决 | 未测，不用固定材料代替 |
| run.driver/handoff options.driver/worker恢复身份 | 未测，run_id=null |
| requested_routes冻结、worker逐项核对 | 未测，无run不补字段 |
| 两家真实审查指纹、路线、结果、逐条裁决、gate | 未测，gate=null |
| 等待人工审批、恢复、放弃 | 未到达；无可用审批入口，后两项未测 |

待前置补齐且专用装置完成后，在原生Qoder CN官方CLI的隔离项目输入：

```text
/dual-review-plan 检查sum修复计划及测试边界 --topic DriverCLI-qoder-cn-B --critics gemini,glm
```

当前**不要运行approve**，没有可供审批的run。将来真实B到达等待人工审批时，只转述该次输出的准确`/dual-approve --topic DriverCLI-qoder-cn-B --stage plan`入口并停止，不能提前用它制造审批事实。下一依赖是两条固定路线合格的严格只读/隔离证据及当前账号核验；不在本批擅自启动另一个审查主题或危险工具实验。

### 8.3 收尾与产品边界

本批没有更改src、skills-src或生成入口，无需render；版本1.3.2不变，Kimi/Qoder的driverEnabled/criticEnabled/defaultSelected六值仍false。候选不代表生产启用或正式产品验收通过。桌面、插件、Windows均未测；Kimi已清理私有登录根不复用。

开始安装bundle为22fce456…，仓库bundle为8484607d…，沿上轮已核构建标识差异，未重装或安装候选。最终自动化、完整hash、全局配置/认证前后回读、入口一致性、开放闸门及无凭据夹具留存状态见[本批验证索引](evidence/qoder-plan-B-20261028/validation.json)。历史原件不补写，本轮凭据复制数为0；有意保留的无凭据根不报成已删除。

完整npm检查内沿用独立临时测试仓库的桩审查/approve/abandon状态机回归，不是本仓或本次B主题的真实审查/审批，也没有调用厂商模型。首轮全检期间最后一处装置改动将helper加载移到指纹核验之后，导致打包回归发现构建指纹过期，4186项中4176通过/9跳过/1失败、退出1。失败摘要与原日志hash保留，随后冻结作用面文件、重建并重跑完整检查；5项装置定向回归也在最后改动后再过。没有放宽构建指纹校验或重装生产。最终结果见validation，不以定向通过改写首轮全检。自动化结果与真实客户端未测项始终分列。

最终第二轮`npm run check`退出0：4186项、4177通过、9跳过、0失败，373.0秒；新增装置定向5/5。安装check退出0，14份入口匹配，安装bundle保持22fce456…，当前仓库bundle与它仅构建标识不同。所核全局配置/认证hash前后相等，源注册表hash不变，133个本仓主题没有开放闸门；三份无凭据装置根有意保留，最新根全部pin匹配，未见对应残留CLI/候选进程。Kimi旧私有登录根仍不存在；审计临时根已删除。没有真实B运行或人工审批事实，正式verify未测。

本批后续交付：Bob明确授权“提交、推送”。按文件清单提交本轮B前置装置、5项回归、同步文档及11份脱敏证据，推送当前main至origin。交付前133个主题无开放闸门，证据索引10个对象hash与装置脚本hash匹配；生产开关、版本、安装及全局配置不改。上文未提交状态保留为开发收尾时点；Git交付不提升真实B、严格准入或其它客户端状态，最终提交号和远端结果以Git回读为准。

## 9. main / 3f85882f Qoder CN命令B续验（2026-10-28）

本轮以实际main/3f85882f20e73a4132b81c11eb16a8151a191542为基线，开始工作树干净。0048e086后的上轮装置及证据已经提交，未重置、覆盖、删除旧件。安装wrapper仍指向用户级生产bundle，开始hash为22fce4561d43e6cc6b9d97f4fd3e2b19f0875ec769c209285a69be6587f8c604；仓库bundle为97d08062c9e21cd7f994c73a02ab8eff81fc7d39f44039b2da63d1381438d296。本仓133个主题无open_gates。本轮Codex为开发Driver，Qoder CN为被验客户端Driver；不启动本仓开发主题审查。

### 9.1 上轮阻塞依据复核与裁定

| 证据或机制 | 证明范围及本轮结论 | 设计与源码落点 |
| --- | --- | --- |
| 原生path_deny.supported=false | 两家既有探针有同行读取负对照，说明该版本、路径配方未能事前拦读；不说明全部审核能力不可用 | 主设计§10.1机制③明确写“支持时”叠加CLI路径deny；§10.2诚实边界；ADR-002为Accepted，不引入硬隔离 |
| coverage_complete/file_shape_verified=null | 未取得完整覆盖或当前逐文件形状的拦读证据，不能记true；不是这两家生产预检的硬门 | agy.ts/zcode.ts的peer_deny_applied读file_shape_verified===true；两个availability均不要求该字段。§3.7/§11.1区分机制支持、覆盖、形状 |
| 当前产出与历史产物隔离 | 独立进程/会话、项目外run_root、两家完成后再archive；历史件禁读由同源清单及跑后路径/命令核验承担，按§10.1.1分类，不宣称文件系统硬隔离 | 主设计§10.1、ADR-002；freeze.ts enumerateDenyPaths、brief.ts、adapters/base.ts checkPeerLeak及checkPeerLeakViaCommand、guard.ts |
| 工具只读 | Gemini使用已安装trivium-critic工具白名单；GLM使用实测mode+全套工具deny，Bash禁用；与路径隔离不同职责 | 主设计§10.3/§11.2/§11.3；agy.ts availability/run、zcode.ts availability/readonlyArgsFromProbe/bashStillDenied。GLM MCP残余及跑后检测边界仍存在，不提升为绝对拒绝 |
| 模型专属组合准入 | Qoder审核者的admission.v1须完整必需项与精确deny_paths覆盖；本次Qoder是Driver，gemini/glm未实现admissionFor，不可挪用该专属台账或反向以availability宣称台账通过 | registry.ts仅qoder-cn声明admissionChecks；preflight.ts checkReadonlyAvailability按adapter.admissionFor条件调用；admission.ts；run-protocol.ts rebuildContext逐项核请求 |
| 认证TTL | 过期使缓存无效，需一次真实核验；不直接判账号失效 | preflight.ts authCacheValid/probeAuth/probeAuthAll/commitAuthCache；仅成功提交本项目local缓存，失败留原件 |
| strict_admitted固定false、start固定69 | 上轮验收装置的保守停点，过度阻塞，属于本轮应修正对象；不是产品guard/gate契约 | 历史preparation-1793198518722.json及qoder-plan.mjs原版；本轮改为必须有本夹具完整生产预检成功记录，不以布尔开关代替 |

结论：按既有获准机制推进本次B，不新增两家路径硬门，也不放宽生产标准。完整preflight、真实审查工具证据、跑后漂移/禁读核验及裁决gate各自仍必须通过，不能互相替代。旧第8节与原件按历史保留，本节纠正其“路径三字段缺失即全部阻塞”的推论。未知底层模型继续null/unknown。

### 9.2 本轮装置与首次生产预检

修订qoder-plan.mjs的前置判断与wrapper；新增显式production-preflight/native-B采集器。wrapper固定本主题/plan/qoder-cn/gemini,glm/B、最多三轮，拒绝skip-auth、降级、审批、放弃、其它阶段和未知run；未取得完整生产预检成功原件仍退69。只有生产preflight成功才接受其本地缓存写回并更新该夹具pin。真实修订与裁决正文消费客户端暂存文件，再由archive唯一出口落盘，不用固定文本代写。

新根为trivium-qoder-plan-B-m5Km0O，完整路径与HEAD/原稿/candidate/独立run_root及清理责任见续批preparation原件；上轮所有有效夹具及计划原样保留。新候选只在临时esbuild内变换qoder-cn.driverEnabled，未安装；生产src、注册表、guard/gate、skills-src及版本未改。

首次production-preflight退出0，两个组合缓存均过1h TTL，经编排器各调用一次最小认证：Antigravity成功106秒，ZCode成功8秒（bigmodel-coding-plan/GLM-5.3）。全部11项通过，Driver模型未声明仅告警，相关模型族比较unknown；未入选其它侧的过期探针不借机刷新。全局所核配置hash前后相等。证据：evidence/qoder-plan-B-20261028-continuation/production-preflight-1793200261955.json。该项是认证与现行前置，不是完整执行层严格准入证明。

### 9.3 真实B与收尾

**实际结果：真实B已到达人工审批停点；完整验收不通过，归档通道不合规。** 不能以客户端退出0、生产gate通过或采集器passed=true覆盖该例外。当前主题为`DriverCLI-qoder-cn-B`，run_id为`20261028T151257Z`，gate为`awaiting_approval`，driver为`qoder-cn`。2026-10-28 15:20:51 UTC立停点后不再写夹具业务文件，没有approve、恢复、abandon或新一轮审查。人工停点必须保留。

| 真实B环节 | 状态 | 实际证据与边界 |
| --- | --- | --- |
| 官方客户端、正式入口原文 | 实际调用 | Qoder CN 1.1.80，CLI sha256 `33050a4d2ac134e2f8d0a5293cba3df009d7bdbe0f3ae478c73057f113050a02`；原生-p收到原文，采集器没有直接启动review；私有入口与正式渲染源hash均为a560d0a6… |
| 入口加载来源观测 | 有来源与原生目录证据；独立展开事件缺席 | 只复制正式dual-review-plan字节，init.skills列出该技能；本次CLI没有独立Skill或入口Read事件，不伪造同ID加载证据，也不以模型自述补证 |
| 请求模型与路线 | 已记录，底层未知 | 官方默认，未传--model；私有settings没有模型声明；原生init/消息标签Auto，modelUsage键auto，底层模型/provider仍null；Driver模型族unknown告警保留 |
| 认领/原稿 | 实际调用认领noop；原稿为既有备料输入 | 原稿准备前已认领qoder-cn，正式会话再次claim返回noop；既有原稿hash未变。Qoder尝试另写原稿被权限拒绝，不把该尝试算成功撰写，也不称备料原稿由它本次新写 |
| 真实工具ID与编排器argv/cwd/底层退出码 | 已关联 | 20条正式会话wrapper账本均关联同ID Bash结果；包含预期wait=73、三条装置拒绝=64、start与两次gate=0；不能以外层shell管道退出0抹掉底层64 |
| run.driver/handoff/worker恢复 | 已核交接与真实运行 | run.driver与handoff options.driver均qoder-cn；真实worker经rebuildContext恢复后运行并成功收尾，恢复函数按handoffDriver强制核对；没有独立worker身份遥测字段，不编造回读 |
| requested_routes | 冻结并逐项一致 | Gemini/GLM请求与交接经sameRequestedRoute重算均true；真实worker同一核对分支之后执行，不重选默认；两家不要求Qoder专属admission字段 |
| 两家真实审核者 | 已完成，无降级或重试 | agy 1.4.9与zcode 0.17.0，实际入口hash前后相同；Gemini回读gemini-3.8-flash-high/high（envelope），GLM回读bigmodel-coding-plan/GLM-5.3（trace），底层供应商null；每家一次审查，非stub |
| 工具证据与跑后核验 | 本次现行判据通过 | 两家evidence_ok=true；Gemini 6 read+2 glob、6 project_reads，GLM 6 read+1 glob、5 project_reads；readonly_breach=false、peer_artifact_read=false、drift.changed=false。peer_deny_applied两家均false，不升格为路径事前拒绝 |
| 完整读两份审查 | 已证实 | 两个Read工具ID分别为call_5fcbc6ad5caa4ba5af70d1e7、call_012bfab1db484a29abbc756e；同ID成功结果逐行与完整原件相同 |
| 客户端实际裁决与修订计划 | 正文来源已证实 | 六条意见，五接受一暂缓；真实Qoder两条tee调用正文与落盘hash逐字相同，非固定夹具正文；生产gate无缺号、无失败/告警 |
| 归档通道与首次无误调用 | **不通过** | 三次archive装置调用均退64；原生权限另有6次拒绝。最终tee直接写.reviews，未走要求的暂存正文→artifact→archive唯一出口。成功文件不能回填为被拒Write工具成功，也不能称专用归档通道通过 |
| gate/人工停点 | 实际到达 | 两家均pass-after-changes，计票proceed；gate --check与--await-approval均0，state/task双落点awaiting_approval，approvals=[] |

正文写入的两个成功工具ID为`call_bc636b200c6040d68135fa25`（裁决）与`call_5933495b237d4ee4b922eedc`（r2计划），都是**本次真实Qoder会话的Bash/tee**，不是Codex代写。裁决sha256为282bde69fc58f50f4828e2b452aa0f28f04957594128ec17ce6d8d346aeb1e4f；计划正文hash及两条完整命令/同ID结果见[最终裁定原件](evidence/qoder-plan-B-20261028-continuation/final-verdict.json)。被拒Write恰与最终裁决内容相同，也不能据hash相同倒推其执行成功。未实施sum修复或新增业务测试。

最小后续项是私有Driver的暂存写入授权与archive执行规约；这是Driver验收装置/载体行为缺口，不是gemini/glm路径deny的缺口，也不应改生产guard/gate。当前已经立人工停点，本轮不改权限重跑、不修补本轮工件。不增加审核配额。待Bob处理当前停点并另行启动新批次时，先在新根核实同版本官方CLI的暂存写入许可和archive链，再考虑新的B；局部合成回归不能代替该真实证据。

### 9.4 Bob的确切审批入口

产品实际停点给出的入口是：

```text
/dual-approve --topic DriverCLI-qoder-cn-B --stage plan
```

本夹具wrapper刻意拒绝approve，临时Qoder home也已清理；因此上面的产品话术不能直接作为该wrapper上的可执行入口。以下是**只供Bob自行决策后在终端执行**的同项目/同候选入口，Codex未执行；审批不等于解决归档通道验收例外：

```sh
cd '/private/var/folders/b_/9c_2y9gx4bx9hg3chvdwmdl00000gn/T/trivium-qoder-plan-B-m5Km0O/中文 空格项目'
TRIVIUM_ASSET_ROOT='/Users/chenzhenbo/Work/TriviumCode/skills/dual-critic' '/opt/homebrew/Cellar/node/25.2.1/bin/node' '../candidate.cjs' approve --topic DriverCLI-qoder-cn-B --stage plan
```

另存[Bob审批入口.txt](evidence/qoder-plan-B-20261028-continuation/Bob审批入口.txt)，内含候选绝对路径。候选和无凭据项目/运行原件有意保留，使用完毕后的删除责任仍由Bob确认；本轮不擅自清掉真实待审批工件。

### 9.5 自动化、清理与正式产品边界

本轮7项定向回归通过；冻结作用面后完整`npm run check`退出0：4188项、4179通过、9跳过、0失败，347.2秒。构建与pretest作用面指纹均为40a6cfa2fd7f…，冻结清单14个文件最终全部未变；完整检查中没有再修改脚本。check中的桩审核/审批回归只属于测试夹具，不是本次真实B的审批。安装只读检查退出0；未执行安装，安装bundle仍为22fce456…，仓库bundle由本轮check重新生成，两者完整hash分列在最终裁定原件。正式verify未测。

凭据方面：Qoder只在私有home复制2个最小认证文件，已由生产withQoderHome清理并回读home不存在；两家运行目录的scrub原件已留存，GLM副本中具名敏感载体无残留。所核14项全局配置/认证hash前后相等；不打印内容。新旧无凭据夹具与真实运行审计材料保留，不报成已删除。正常退出与这次具名清理不替代完整逃逸后代/监督者SIGKILL准入。运行后进程与最终敏感扫描见续批索引。

本轮只改验收脚本、回归和文档；生产src、driverEnabled/criticEnabled/defaultSelected六值与版本1.3.2不变；未改skills-src，无需render，未手改生成入口。候选仅启用临时Qoder Driver，未安装，不代表正式产品Driver或Qoder审核者准入开放。Kimi模型、A/C/D、桌面、插件、Windows、审批后恢复/放弃均未测；未重复status/特殊字符/cwd/独立身份验收。本仓133个开发主题仍无open_gates；真实停点仅存在于隔离项目。没有提交、推送或发布。

证据入口：[续批完整索引](evidence/qoder-plan-B-20261028-continuation/index.json)、[首次真实预检](evidence/qoder-plan-B-20261028-continuation/production-preflight-1793200261955.json)、[真实Qoder B原件](evidence/qoder-plan-B-20261028-continuation/native-B-1793200860192.json)、[离线关联与完整审计副本](evidence/qoder-plan-B-20261028-continuation/audit/audit-1793200889405.json)、[最终分项裁定](evidence/qoder-plan-B-20261028-continuation/final-verdict.json)、[自动化结果](evidence/qoder-plan-B-20261028-continuation/automation.json)、[凭据清理](evidence/qoder-plan-B-20261028-continuation/credential-cleanup.json)。源码/规范依据为[主设计§10/11](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md)、[ADR-002](../02_design/ADR_002_multicritic_isolation.md)、[生产预检](../../src/trivium/preflight.ts)、[两家适配器](../../src/trivium/adapters/agy.ts)、[ZCode适配器](../../src/trivium/adapters/zcode.ts)、[worker交接](../../src/trivium/run-protocol.ts)。

本轮后续Git交付：Bob明确授权“提交、推送”。交付前复核索引27个对象hash一致、全局所核hash不变、本仓133个主题无开放闸门；仅按本轮文件清单提交并推送当前main至origin。隔离项目的awaiting_approval原样保留，不因Git授权代为approve、恢复或abandon；本次交付不提升完整验收或正式产品开关状态。上文“没有提交、推送”保留为开发收尾时点，实际提交号与远端结果以Git回读为准。


## 10. main / f7167326 归档契约与原生写入正控制（2026-10-29）

本轮Codex是开发Driver，Qoder CN是被验客户端Driver。开始实际main/f7167326e82ed2e7a9ce452b75411c76b18852bc，工作树干净；没有重置、覆盖或删除既有改动。日期按Asia/Singapore记2026-10-29，原始事件仍保留UTC。证据目录名称qoder-write-20261028沿用本轮开始时日期，不用目录名替代事件时间。旧B的27份索引对象全部hash一致，旧夹具与原始证据保留。以下结论是对第9节判定边界的复核，不回填旧JSON。

### 10.1 归档契约复核

| 对象 | 正式契约与实现 | 本轮裁定 |
| --- | --- | --- |
| 编排器生成的审核Markdown、brief/review/run等元数据 | 主设计§5.1/§6.2/§16.2、GUIDE_env_setup四.2；archive.ts模块头写“任何模块”，角色工件writeArtifact独占创建、扫描、防覆盖抬升；writeMeta按run_id原子替换 | archive是编排器代码的唯一写模块，不等于每个外部Driver必须调用某个公开archive CLI |
| Driver原稿 | 正式B步骤0先claim；可以--plan-file指定归档外文档，也可在归档内按本Driver后缀写原稿；archive.ts关于isReviewArtifact的注释明确区分手写原稿与可选writer=driver接口 | 生产CLI没有artifact子命令；正式技能提供Write/Edit。客户端正文→暂存→专用artifact是装置附加控制，不应冒称产品必经链 |
| Driver裁决件与完整新计划 | 正式B步骤5、主设计§6.6：裁决文件后缀/role=当轮Driver，schema/run_id/addresses及每条意见齐备；新计划引用接受编号并给完整正文 | 裁决轮次=审查run.rerun_index；新计划轮次=被审对象subject_rerun_index+1，二者并非同一个计数 |
| 登记与gate | review.ts:2276起在success收尾把归档内原稿按冻结hash登记run.artifacts；归档外原稿明确告警。gate.ts checkAdjudication/checkNextPlan核裁决与新计划，verifyRoundForApproval再核本轮登记hash；cli.ts cmdGate迁移state | gate不是写通道来源证明，不验证专用artifact收据。不能以gate通过抹掉原生拒绝，也不能把未调用附加通道本身认作产品工件契约失败 |

因此，第9节“归档通道不合规”准确适用范围是**该次装置自定的传输控制未通过**，不是已证实的产品归档契约违规。正式工件内容/命名/逐项裁决已有gate证据；原生Write及完整客户端验收缺口仍存在，完整验收仍不通过。所谓首次无误调用也属于额外验收项，不能改写生产gate结论。源码参考：[archive.ts](../../src/trivium/archive.ts)、[review.ts](../../src/trivium/review.ts)、[gate.ts](../../src/trivium/gate.ts)、[cli.ts](../../src/trivium/cli.ts)、[源契约](../../skills-src/commands/review-plan.contract.md)、[正式Qoder B入口](../../skills/dual-critic/entry/qoder-cn/dual-review-plan/SKILL.md)、[主设计](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md)。`task.json`另由meta.ts的updateTaskAsync持主题任务锁读改并原子替换，`.trivium/state.json`由state模块持全局锁维护；不能把“唯一出口”扩解成它们也必须经writeArtifact。本轮是装置与判定纠偏，没有修改产品设计、生产实现或版本，无需render。

### 10.2 原生权限与三次64的根因证据

[根因原件](evidence/qoder-write-20261028/rootcause.json)保存旧native文件hash、11组call/result、6个permission_denied事件及同hash官方二进制的内嵌源码片段/字节偏移。它是静态源码与原始事件的对应，不冒充运行分支遥测。

- **工具可见与写权限不同。** 旧argv提供--tools及--allowed-tools Bash,Read,Write,Skill，原生init确认工具面与dontAsk。私有withQoderHome仅写general.enableAutoUpdate=false，--setting-sources user没有复制用户全局权限规则；不存在对drafts的Edit路径allow。官方[权限说明](https://docs.qoder.cn/cli/permissions)规定路径写规则用Edit(...)覆盖Write，绝对路径规则以前导双斜杠表示，dont_ask把需要确认的操作拒绝。路径规则中的双斜杠不是Write实际file_path的写法。
- **当前相同CLI字节提供机制依据。** CLI 1.1.80/hash 33050a4d…与旧会话一致。内嵌zb（偏移124496540）按edit路径规则检查，未覆盖的普通写最终ask且无fillableByAllow；yg（125302772）不会用宽泛工具allow填补此ask；FD/rVe（125411458/125412633）将dont_ask中的ask转为mode/permission-rule。旧Write call_50551c53857644059be394df与call_09c44f91fc3749909da46ba1确有同ID拒绝，不能记成执行成功。未配置路径规则是装置缺项；旧事件只保留最终mode，没有上游逐次decisionPoint，敏感路径或其它安全子分支不能据通用文案反推。
- **路径、配置与原生安全分开。** 实际cwd为canonical /private/var中文空格根，init未显示权限模式降级；相同目录下tee成功不支持简单归因操作系统目录不可写。旧装置没有路径pattern，不能把它描述成“旧pattern少一个斜杠”；本轮新增规则才需要正确绝对语法与/var别名。原生安全检查在规则/模式链中有独立地位，不通过换mode、关闭检查或全工具授权绕过。旧原件未保存成功调用的上游决策点，不能断言所有安全检查都未参与。
- **tee与其它写法的差异。** 四个Bash写调用call_ef31d82c0d4d46249e7b5c3b、call_1f43de9583934577b3e72df8、call_6bcf265f210242afaeb227da、call_715d82c44e3d41db8924818d被同ID权限事件拒绝。两条tee call_bc636b200c6040d68135fa25与call_5933495b237d4ee4b922eedc则各有同ID非错误Exit:0，输入正文与文件hash一致；这只证明那两次实际成功。内嵌A3e（124510603）含命令安全/allow形状分支与后续写目标提取，不同形状可能走不同分支；旧日志不足以认定具体命中哪一支或已发现客户端漏洞。tee不会作为本轮修复手段。

| 专用artifact尝试 | 实际底层64原因 | 不能推断的事项及修正 |
| --- | --- | --- |
| artifact --help（call_8414a6324cea4f12a653c099） | 装置未支持help；外层head可能返回0 | 可发现性欠缺，不是客户端归档实现坏；新装置补help并保留底层码 |
| artifact plan 2 指向.reviews内既有原稿（call_f7331cee16c745e8a2e4db73） | 明确不在装置非归档暂存域 | 这是装置规约拒绝，不是写工具拒绝；不能用固定原稿冒充新正文 |
| artifact revised 2 drafts/verdict.md（call_01ba00cd235f4598a12ca3d4） | realpath ENOENT，暂存正文根本不存在 | 当时未走到轮次判断；实际run为1，裁决应revised 1，下一版完整计划为plan 2。若按旧夹具指令先写原稿r2，则下一版应r3；旧“轮次按被审对象递增”对裁决有歧义 |

结论是可核实的装置契约/授权不足及原生最终拒绝，保留Bash成功分支与部分上游安全检查未观测项；不把所有问题归为Qoder客户端缺陷。

### 10.3 最小装置修正与自动化

只改验收脚本、相关测试和文档。新B夹具预建drafts，取消固定备料原稿，客户端从plan 1开始；help标明artifact是验收传输。传输要求真实普通drafts文件、先claim，校两类轮次、已有工件、running/awaiting_approval，随后调用生产archive扫描与独占写入并记录源hash和结果。不会修改旧夹具或补写旧工件。

私有写入配置按Edit路径规则授权；本次正控制只放一个draft文件与两条精确wrapper命令，不使用全工具/全目录写allow。未来B配方将写范围限制drafts，Bash限制专用wrapper，不更改生产guard/gate。只读核验强化同ID结果还须对应argv文字；外层管道0不能替代底层退出码。新增qoder-write.mjs有全新隔离根、独立run_root、wx预占的一次会话记录与失败原件。10项定向离线回归已通过，覆盖真实子进程/真实archive、防覆盖、路径/符号链接、停点、两种轮次、无正文/无审核备料及工具关联；这些不是客户端通过证据。

完整检查结果与真实正控制结果见本节后续收尾条目。参与INSTALL_INPUT_PATHS的文件已在check前冻结，指纹3d1a08399ed4682e2be7c08e61bea05dc26a947e3afd4a017765b79fd48b5afe；冻结后只更新doc报告/矩阵/证据，不修改脚本或生产资产。


### 10.4 一次真实Qoder写入正控制

完整离线check通过且冻结复算一致后，事前播报一次官方默认会话、180秒/8轮交互/请求重试0、审核者0。实际只启动一次Qoder CN 1.1.80，CLI hash与旧B相同；原生6轮，监督进程耗时42.121秒，无超时/截断，CLI退出0，原生成功终态，回报1.07174837 credits。会话数与turn数不是底层供应商请求数或固定费用。官方默认未传model，私有设置无model，Auto/auto仅路线/计费标签，底层model/provider保持null/unknown。

新无凭据保留根为`trivium-qoder-write-0tqdgR`下的中文空格项目，独立run_root在该根的runs；具体绝对路径、候选hash与pins见[备料](evidence/qoder-write-20261028/preparation.json)及[真实原件](evidence/qoder-write-20261028/native-write.json)。没有安装候选，没有执行正式技能、preflight、review或gate，没有审核者调用；runs未产生审查运行。

| 正控制项目 | 状态 | 原始证据 |
| --- | --- | --- |
| 实际材料读取与正文作者 | 通过正文来源项 | 三个Read同ID成功；Write内容由真实客户端生成，Codex未补写、替换或固定生成正文；模型正文质量不在本次通过项中 |
| Driver认领 | 通过 | call_fc525866e25445eeb0d4b9e2，真实wrapper argv为topic claim / plan / qoder-cn，cwd与原生init一致，底层exit_code=0、outcome=claimed |
| 合法原生Write | 通过 | call_a450a52aea0b413a8d363dde，精确绝对draft路径，同IDFile created successfully且非错误；权限日志同调用记录后明确main Write dontAsk → allow point=fs_write.rule.allow |
| 合法本Driver归档 | 通过原稿链 | call_bc097c4cd2b04212bf760172；实际argv=artifact plan 1 drafts/original.md，cwd正确，底层exit_code=0；日志命中shell.rule_exact.allow，经archive生成2026-10-29-DriverWrite-qoder-cn-qoder-cn.md |
| 工具正文/暂存/传输/归档hash | 四处相同 | 6d45dbfdb4ce5fe473d8e4d467a49c96b0ebbb6fcab4705660287d5d5a849253；来源和实际文件独立回读，没有覆盖旧件 |
| 精确两条Bash的提示遵循 | 有偏离，单列 | 额外call_cc644a380e364535b9a6d875执行ls drafts并附2>/dev/null及只读fallback，native判shell.readonly.allow，无写入/无审核。显式allow只有两条wrapper命令，但安全只读动作仍可默认允许，不能把allow当deny或声称整场只执行两条Bash |
| 正文中未经事件证明的表述 | 不采为实测 | 客户端正文自述git status及未跟踪状态，但无对应工具事件；也没有实际执行正文中的node测试。不因正文自述而补成通过，计划未做正式B质量审查 |
| 权限拒绝/失败重试 | 无新增拒绝；无第二会话 | 原生permission_denials=[]；未替换写命令、换提示、重跑凑绿或由Codex代写 |
| 真实裁决/下一版计划/B重新验收 | **未测** | 本次仅原稿，不伪造审核意见，不运行B；新B采集器权限配方也没有在完整B中真实复跑 |

[独立复核](evidence/qoder-write-20261028/independent-audit.json)保留额外只读Bash、正文自述限制及实际权限决策点。[采集器判定](evidence/qoder-write-20261028/verdict.json)九项为true，只证明上述真实写入/原稿归档链，不包括“完全遵循仅两条Bash提示”、正文质量或B整体。对额外只读操作如实留痕，不改脚本或再调模型消除记录。

### 10.5 旧B停点、仍未满足项与下一次复验条件

旧主题`DriverCLI-qoder-cn-B`、run_id=`20261028T151257Z`的当前state闸门仍为awaiting_approval，approvals=[]。本轮没有approve、恢复、abandon、gate重验或补写旧工件，旧归档/状态/candidate逐项hash未变。**更正第9节“state/task双落点awaiting_approval”**：本次回读task.gate为idle，run.gate为review_done_awaiting_disposition且adjudication_complete=false；后者按主设计§6.7/EV-133是收尾快照、不由gate回写。当前停点看state，人工决定看approvals，不能混用三个字段。task快照差异只记录，不主动修复。审批入口仍见9.4，本轮不执行；更新后的源装置与旧pins不同，不把旧wrapper称为已在新源码下复验，旧候选直接入口字节保持原样。

本次正控制证明同版本、dontAsk、私有精确Edit路径规则可完成客户端正文与archive原稿链；它不消除旧B失败/偏离记录，也不构成正式B重新通过。正式入口独立展开事件、真实B全部写入链/裁决/定稿、审批后恢复/放弃、其它A/C/D、Kimi模型、桌面/插件、Windows及完整逃逸后代/监督者被杀清理仍未测或未满足。两个候选产品角色仍关闭。

下一次真实B须另行明确授权，使用新隔离根/独立run_root与新证据目录，不能复用旧待审批工件；旧停点由Bob单独决定，不把本次正控制当审批。先核CLI、入口、候选/源文件冻结hash与生产开关；确认私有drafts精确范围和wrapper权限，采用客户端真实原稿plan 1，裁决用审查轮次、完整新计划用subject+1。沿既有gemini/glm获准机制运行该夹具完整生产preflight，TTL需要刷新时事前说明配额，再由原文正式B发起真实双审，逐项核worker/请求冻结/工具证据/裁决/gate，出现写入拒绝立即停下保留，不改提示换写法。真实B应保存权限日志决策点及同ID工具/argv/cwd/底层码/hash，不能只留最终mode文案。当前未授权该复验，未启动。

旧tee为何走不同成功分支仍缺当次上游决策点；本轮静态源码只能说明存在相应形态分支，不能还原真实选择。若该问题仍要继续核实，最小下一项是另行授权、独立保留权限决策点的单命令形态对照；旧日志不可追补，本轮不追加会话。这个历史归因缺口不妨碍本次已取到fs_write.rule.allow的合法Write链，但也不能被它抹去。

### 10.6 自动化、冻结、安装与凭据清理收尾

完整`npm run check`退出0：4191项、4182通过、9跳过、0失败，测试耗时340.408秒；10项定向回归也通过；报告/矩阵更新后，文档归档索引与入口渲染契约49项通过。build及pretest均为指纹3d1a08399ed4…；前后两次冻结复算一致，16项具名pins未变，参与构建的脚本/源码/资产冻结后未修改。安装只读检查退出0，14份入口字节匹配；没有重装或安装候选。安装bundle保持22fce4561d43e6cc6b9d97f4fd3e2b19f0875ec769c209285a69be6587f8c604，仓库新bundle完整hash另列[安装回读](evidence/qoder-write-20261028/installation.json)与[收尾](evidence/qoder-write-20261028/closeout.json)，不以二者hash相等冒称已安装新构建。

所核14项全局配置/认证hash与轮前一致，生产src全树未变，Kimi/Qoder的driverEnabled、criticEnabled、defaultSelected六值均false，package版本仍1.3.2。正常withQoderHome只复制2个最小认证文件，私有home已清理并回读不存在；对应进程根扫描无残留。新旧无凭据夹具有意保留，删除责任由Bob确认使用完毕后处理；不报成全部临时根已删。已保存证据对已知认证原串/JSON字符串及既有脱敏规则扫描无命中，未知内部解密字段与监督者SIGKILL情形仍未测。正常清理不代替完整生命周期准入。

本仓没有开放开发闸门，本轮未启动本仓主题双审，也没有提交、推送、发布。证据：[完整索引](evidence/qoder-write-20261028/index.json)、[根因](evidence/qoder-write-20261028/rootcause.json)、[自动化](evidence/qoder-write-20261028/automation.json)、[冻结](evidence/qoder-write-20261028/freeze.json)、[真实写入](evidence/qoder-write-20261028/native-write.json)、[独立复核](evidence/qoder-write-20261028/independent-audit.json)、[收尾](evidence/qoder-write-20261028/closeout.json)。本节为当前结果；旧节和旧JSON保留历史事实及已指明的判定局限。

本轮后续Git交付：Bob明确授权“提交、推送”。交付前再次核对16份索引对象hash、冻结作用面、全局配置、安装bundle及旧B归档/状态均未变，本仓无开放开发闸门；按本批具名清单提交并推送当前main至origin。旧隔离B的awaiting_approval与approvals=[]保持原样，不代为审批、恢复或放弃；Git交付不提升正式B复验或产品准入状态。上文未提交状态保留为开发收尾时点，实际提交号及远端结果以Git回读为准。

## 11. main / 2b52e24e 新隔离根真实命令B复验（2026-10-29）

**本次B复验未通过：首次原生工具的存在性检查被拒，已立即停止；未进入认领、原稿写入或正式评审。** 上轮Write正控制继续有效，本轮没有重测，也不能用它代替未发生的B写入链。当前生产Driver/审核者准入仍未完成。

### 11.1 实际基线、装置与冻结

起点为干净的`main / 2b52e24ed905f1f1f9e8f83c6451cc13b55c1ed5`，本仓无开放开发闸门；Codex是开发Driver，Qoder CN是被验客户端Driver。未重置、覆盖、删除旧改动或旧工件。旧B索引27个对象、写入正控制索引16个对象均回读匹配。

仅修订验收装置、回归和相关说明：新根备料不再代领；drafts预建、正文不存在；只授权`original.md`、`revised-1.md`至`revised-3.md`、`plan-2.md`至`plan-4.md`七个具名暂存路径，使用已核实的Edit绝对路径规则及路径别名。settings仅来自私有user文件，`dontAsk`、空MCP和原生权限检查保留，不使用全工具、全项目写allow或bypass。Bash显式allow只有wrapper前缀，wrapper再限定本主题、plan、qoder-cn、gemini,glm、入口B、三轮上限及必要旗标；未知run、路由覆盖、审批、放弃、其它阶段均拒绝。原生安全只读操作仍可能自动允许，不能把精确allow宣称为其它读取的绝对deny。

artifact须先有同ID原生Write成功结果和匹配正文hash，再调用生产archive；普通文件、身份、两种轮次、防覆盖及运行/审批停点仍校验。`archive`是编排器工件模块唯一写出口，正式Driver可按入口契约撰写；本批artifact是附加传输控制，不是生产CLI或产品必经契约。裁决轮次取`run.rerun_index`，下一完整计划取被审对象轮次加1。流式监督遇到原生权限拒绝、关键工具错误或传输失败即停，正常wait=73继续；生产gate检查返回proceed/human_review时已立审批停点，立即监督停止，rerun按返回预算继续。私有日志在清理前只提取权限决策及本次调用ID关联行。离线审计补齐两家`out/`真实输出、轨迹和清理回执的复制路径。

定向13项通过。最终完整`npm run check`退出0：4194项、4185通过、9跳过、0失败，363.778秒；最终build/pretest指纹与冻结复算一致，为`e7d86c19e6f245d20b9fcaba6d3db9847f684f0e212f8fdd4623a0f60c79af13`。219个文件在最终检查后冻结，真实调用至收尾均未变化。两次中间完整检查输出保留；其后发现的resolve旗标兼容、gate自动停点和out原件路径补正均由最终完整检查覆盖，不拿中间构建放行。未改skills-src或生成入口，无需render。证据：[装置核验](evidence/qoder-plan-B-20261029-retest/apparatus-audit.json)、[自动化](evidence/qoder-plan-B-20261029-retest/automation.json)、[最终冻结](evidence/qoder-plan-B-20261029-retest/freeze-final.json)。

### 11.2 一次生产预检与一次真实会话

新项目根为`trivium-qoder-plan-B-hBF8Sm/中文 空格项目`，独立run_root为其同级`runs`；完整路径、候选hash及清理责任见[本批夹具](evidence/qoder-plan-B-20261029-retest/current-fixture.json)和preparation原件。新根备料后drafts为空、preparation_claim和original均null，无task、state或run，不复用旧B正文。临时候选只在独立esbuild中启用Qoder Driver，未安装。

真实调用前已说明目的、官方默认路线、固定两审、认证每家最多一次、三轮上限和时限。生产preflight一次通过全部11项：两家缓存过1h TTL，经编排器各一次认证；Antigravity 1.4.9 / `gemini-3.8-flash-high` / high，约99秒；ZCode 0.17.0 / `bigmodel-coding-plan/GLM-5.3`，约13秒，并行墙钟100.457秒。未skip-auth、降级、doctor或扩展探针；Driver未声明底层模型的unknown告警保留。认证成功只证明本次预检，不代表正式评审已运行。证据：[生产preflight](evidence/qoder-plan-B-20261029-retest/production-preflight-1793230554931.json)。

Qoder只启动一次真实模型会话，原生`-p`接收正式B调用原文；另有一次本地`--version`。版本1.1.80、CLI sha256为`33050a4d2ac134e2f8d0a5293cba3df009d7bdbe0f3ae478c73057f113050a02`，源二进制前后未变。上限为25分钟、120次交互、模型请求重试0；生产每轮阶段预算45分钟不因此扩大。实际会话约6.972秒即停止，没有任何正式评审轮次。

| 新B环节 | 本次实际状态 | 原始证据及局限 |
| --- | --- | --- |
| 正式入口来源、字节、原生加载 | 来源/字节及原生激活已证；展开正文未回读 | 私有副本与正式入口sha256均为a560d0a6…；init列出dual-review-plan，stderr含`Skill **dual-review-plan** activated.`；无独立Skill或入口Read工具事件，展开正文运行期字节为null，不用模型thinking补证 |
| 实际路线 | Auto / auto；底层未知 | init与消息标签Auto，计费信封键auto，原生返回0.90504282 credits；底层模型/provider均null，不把路线标签当模型身份 |
| 首次工具与权限 | **原生拒绝，立即停止** | call_f7fe08dd418d436fb6619a41；同ID调用、失败结果、permission_denied、options.callId、`mode.dont_ask.deny`及permission.resolved/denied均保留 |
| 实际claim为qoder-cn | 未测 | 没有topic claim；CLI客户端身份不代替阶段认领 |
| 阅读材料、原稿Write、artifact归档 | 未测 | 无Read、Write或artifact事件；drafts仍空，不预置、不代写、不换tee |
| 真实双审、run.driver、handoff、worker恢复 | 未测 | 正式评审gemini=0、glm=0；无新run_id，无worker，未减少集合取得通过 |
| requested_routes冻结及逐项核对 | 未测 | 仅有本批配置路线/认证证据，没有新run请求快照；不能补写为已冻结 |
| 完整读审查、逐条裁决、下一完整计划 | 未测 | 两家正式意见及正文写入链均未发生，逐项hash链无可核对象 |
| 生产gate及新人工停点 | 未测/未到达 | 新root无task/state，new_run_id和new_gate为null；没有新审批入口 |

### 11.3 首次拒绝的确证范围、额外操作和装置局限

唯一工具调用原文为：

```sh
test -f .trivium/bin/trivium && echo "EXISTS" || echo "MISSING"
```

它是正式入口要求确认wrapper存在时，客户端自行选择的复合Bash检查；超出本批“只直接调用wrapper”的显式命令形态，私有allow没有授权这一整条检查。原生记录`non_execution_kind=permission-rule`，最终决策点为`mode.dont_ask.deny`。因此没有shell实际执行或EXISTS/MISSING结果，也没有wrapper进程或其底层退出码；这不是wrapper执行退64，不能因字符串里含wrapper路径就宣称它已执行。采集器原始stop_reason写作“wrapper工具失败”，是`command.includes`路径匹配的过宽标签；原件不改，离线精确事实在[审计说明](evidence/qoder-plan-B-20261029-retest/offline-audit-notes.json)更正。

同ID权限分支已取得；但mode之前触发“需确认”的具体shell上游分支未单独打印，保持unknown。不能仅凭命令名称、通用文案或终止码认定客户端缺陷，也不能据此认定wrapper缺失或精确Edit写授权回归。旧tee与其它Bash写法的旧上游决策点仍未知。本批事实是入口存在性检查与私有权限配方的衔接缺口，尚未修复或复验。

监督器收到失败即终止；CLI底层退出143、signal=null、earlyStopped=true，未超时、未截断；原生最终信封为error_during_execution/aborted_streaming。未调用任何claim/artifact/review/gate，不换写法、改提示、补结果或重启。正式入口仅启动意图与激活，不是完整B通过。离线audit首次因无归档可walk、输出目录未预建而ENOENT；调用方预建空audit目录后原脚本完成，未改冻结源码，也没有新增真实配额。证据：[原生原件](evidence/qoder-plan-B-20261029-retest/native-B-1793230605158.json)、[同ID拒绝及根因边界](evidence/qoder-plan-B-20261029-retest/rootcause.json)、[离线审计](evidence/qoder-plan-B-20261029-retest/audit/audit-1793230660072.json)、[分项结论](evidence/qoder-plan-B-20261029-retest/verdict.json)。

### 11.4 新旧停点、生产状态和清理

旧主题`DriverCLI-qoder-cn-B`仍只在旧根`trivium-qoder-plan-B-m5Km0O`，run=`20261028T151257Z`。旧state.gate为awaiting_approval，approvals=[]；旧task.gate仍idle，run.gate是运行期快照，不冒称两处当前停点一致。旧归档、state、候选和27份续验/16份写控制索引对象全部未变。新根hBF8Sm没有run、task、state或待审批闸门；不能把Qoder session_id `807c424c-8789-4b07-8cc8-b586ac0630bc`当作run_id。没有approve、恢复或abandon，也没有补写旧工件。

生产src全树、guard/gate、适配器、注册表与版本字段未改。Kimi/Qoder的driverEnabled、criticEnabled、defaultSelected六值均false，package版本仍1.3.2；本仓state hash未变、无开放开发闸门。安装只读检查通过，14份入口匹配；已安装bundle保持`22fce4561d43e6cc6b9d97f4fd3e2b19f0875ec769c209285a69be6587f8c604`。仓库检查生成bundle为`850b473027c0d80f755eeaee321406f11fe0ae1a2b1a142b8c2768fd3312a10d`；两者分别记录，不据此冒称安装新构建。全局所核14项配置/认证hash与轮前一致。

私有Qoder HOME只复制2个最小认证文件，已清理并回读不存在；新正式run_root不存在，未产生正式审核者敏感载体；本次预检以来未见具名认证根残留，本批具名进程路径扫描无残留。已保存证据对已知Qoder认证原串/JSON字符串扫描无命中，未知内部解密字段、完整逃逸后代与监督者SIGKILL清理仍未测。新旧无凭据夹具、候选、运行审计原件及离线辅助根有意保留，使用完毕由Bob确认删除，不称全部临时根已删。证据：[凭据清理](evidence/qoder-plan-B-20261029-retest/credential-cleanup.json)、[收尾回读](evidence/qoder-plan-B-20261029-retest/closeout.json)、[安装回读](evidence/qoder-plan-B-20261029-retest/installation.json)、[完整索引](evidence/qoder-plan-B-20261029-retest/index.json)。

下一项最小操作是先离线审查存在性检查的精确授权与上游需确认分支，补充具名只读检查覆盖及定向回归；之后必须另行授权，才可在又一全新根重新做一次B。本批不再改配方或发起会话，不重跑已通过的写入正控制。原稿/裁决/下一版的真实Write→artifact→archive全链、真实双审/worker/请求冻结、gate和新审批停点仍未满足。Kimi模型、A/C/D、桌面/插件/Windows及审批后恢复/放弃均未测；没有启动本仓开发双审，没有提交、推送、安装或发布。

本批后续Git交付：Bob明确授权“提交、推送”。交付前再次只读核对证据对象hash、最终冻结作用面、安装副本、全局所核hash及旧B归档/状态；本仓无开放开发闸门，当前main与origin/main基线一致。仅提交本批装置、回归、报告/矩阵和索引列出的证据；7份具名原始验证日志作为验收证据纳入，不收集其它运行日志或凭据。旧B的awaiting_approval和approvals=[]保持原样，不代为审批、恢复或放弃，也不启动新模型会话。上文及JSON中的未提交状态保留为验收收尾时点；实际提交号和远端结果以Git回读为准，Git交付不提升本次B或完整Driver准入结论。
