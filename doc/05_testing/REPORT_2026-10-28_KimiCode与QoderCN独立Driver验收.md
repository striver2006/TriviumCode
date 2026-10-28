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
