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
