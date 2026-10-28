# Kimi/Qoder 取证工具

2026-10-28 main/3f85882f续验：第8节的路径deny硬前置已按现行设计纠正，详见[报告第9节](../../../doc/05_testing/REPORT_2026-10-28_KimiCode与QoderCN独立Driver验收.md#9-main--3f85882f-qoder-cn命令b续验2026-10-28)。gemini/glm沿用设计10.1/10.3及ADR-002的获准机制；path_deny=false/null仍是未取得原生路径拒绝证据，不能写成硬隔离通过。Qoder审核者专属模型组合准入台账不移作两家既有审核者的条件。availability不代替完整preflight，TTL过期须刷新，不直接判账号失效。

```sh
node scripts/acceptance/kimi-qoder-cn/qoder-plan.mjs <新证据目录>
node scripts/acceptance/kimi-qoder-cn/qoder-plan-live.mjs production-preflight <新fixture-B.json> <新证据目录>
node scripts/acceptance/kimi-qoder-cn/qoder-plan-live.mjs native-B <同fixture-B.json> <新证据目录>
```

后两步显式消耗真实配额，不能隐式批量运行：首次生产预检最多两家各一次认证调用；native-B只允许一次官方客户端会话，原文调用/dual-review-plan，不能由采集器直接启动review。wrapper要求一小时内本夹具完整预检成功，固定plan/qoder-cn/gemini,glm/B与三轮上限，禁止skip-auth、降级、审批与放弃。原生客户端实际撰写修订与裁决，归档仍经archive；失败保留原件。候选不安装，正式注册表/版本/guard/gate不变。到awaiting_approval立即停写，只给Bob确切审批入口；工具自身不会approve或abandon。CLI退出0只是会话完成，真实B各环节须离线核验后另列，不能用采集器passed代替。

以下0048e086说明保留为历史装置事实；其中固定strict_admitted=false和启动固定退69已由续验修订，不能继续当作产品契约。

2026-10-28 main/0048e086专用Qoder CN命令B前置：

```sh
node scripts/acceptance/kimi-qoder-cn/qoder-plan.mjs
node --test scripts/acceptance/kimi-qoder-cn/qoder-plan.test.mjs
```

本工具只准备无凭据Git夹具、隔离候选、B专用传输/归档装置和阻塞原件，不安装任何候选，不隐式启动真实客户端或审核者。旧有效夹具核验后原样保留，新夹具另根记录清理责任。仅临时构建把qoder-cn的Driver开关转换为true，生产三个开关不动。正文归档通道消费客户端暂存文件并调用archive，不用固定正文冒充真实裁决。

本批严格前置失败：gemini/glm的既有探针均有path_deny.supported=false及同行读取反例，coverage_complete/file_shape_verified为null；两个认证组合缓存指纹仍匹配，但已过TTL。安装只读Agent一致、availability返回可用都不能替代严格准入。没有为凑绿重探、探活或改少审核者。B wrapper的review --start固定退69，不能改一个布尔值解锁；approve/abandon/其它阶段退64。它是**启动前备料与拒绝装置，正式审查能力未验**，不能用新wrapper名称把旧本地能力升级为通过。解除阻塞需要合格的真实严格隔离/拒绝证据及账号核验，再修订专用装置；本批不提供绕过开关。

当前没有真实命令B会话、run_id、worker、requested_routes、裁决、gate或人工审批入口。具体原件、逐环节矩阵与待验文本见[报告第8节](../../../doc/05_testing/REPORT_2026-10-28_KimiCode与QoderCN独立Driver验收.md#8-main--0048e086-qoder-cn命令b前置2026-10-28)。只允许本轮指定的Qoder B；Kimi模型、其它入口、桌面/插件/Windows未测。

2026-10-28 main/892c4767新增三阶段独立身份工具（不运行正式审查，不安装候选）：

```sh
node scripts/acceptance/kimi-qoder-cn/driver-identity.mjs --agent kimi --case local --keep-fixture yes
node scripts/acceptance/kimi-qoder-cn/driver-identity.mjs --agent qoder-cn --case local --keep-fixture yes
node scripts/acceptance/kimi-qoder-cn/driver-identity.mjs --agent qoder-cn --case real
node scripts/acceptance/kimi-qoder-cn/kimi-auth.mjs
# Bob自行完成上条工具生成的私有login.sh；不要回传token。
node scripts/acceptance/kimi-qoder-cn/driver-identity.mjs --agent kimi --case real --kimi-home '/本次私有登录根/home/.kimi-code'
node scripts/acceptance/kimi-qoder-cn/driver-identity-index.mjs
node --test scripts/acceptance/kimi-qoder-cn/driver-identity.test.mjs
```

real显式消耗官方真实配额：Qoder每批两个全新CLI会话；Kimi每批status加两个身份会话。不要为了重取绿色重复当前通过项。Kimi必须显式指定Bob登录的私有根，拒绝全局根；复制原生OAuth引用，不转换静态key。--output可指定新证据目录。仅macOS，Windows未测。native每进程限180秒（Kimi status120秒），Node侧TERM→宽限→KILL；完整逃逸后代与监督者被杀回收仍未测。

local建立真实Git HEAD和dirty diff、三个阶段认领/归属材料/解析继承/幂等/异身份拒绝；生产关闭退64。--keep-fixture yes只保留无凭据local根，内有fixture.json、formal-pending.json，记录清理责任。B/D待验材料先认领再用archive写，C有HEAD/diff，四条入口文本及前置条件已备；wrapper仍只允许本地命令，绝不代表正式审查就绪。到期目录被系统清理后按local命令重建，不能依赖旧路径。

real让真实模型读取实际安装的三份入口为参考并生成Bash，通过wrapper认领及生成材料，第二会话继承/幂等/拒绝。Qoder用--add-dir仅纳入私有skills目录；不纳入auth目录。它不调用四个正式斜杠入口，原稿正文固定由夹具archive生成；自动化、参考加载、独立身份、正式入口与真实业务撰写质量分开。Kimi真实status经原生Skill加载，特殊字符模型转抄仍未测。

所有原件wx保留，索引只离线关联同ID工具结果和wrapper账本。Qoder首批入口Read被拒不能通过；补验实际加载/身份项通过，但一次fixture-draft参数错误被拒后纠正，使原件整场passed仍false。索引分列identity_items_passed、collector_passed及clean_first_attempts，不改旧证据也不重跑凑绿。详见[报告第7节](../../../doc/05_testing/REPORT_2026-10-28_KimiCode与QoderCN独立Driver验收.md#7-main--892c4767-独立身份续验2026-10-28)。本批结束已清理的私有登录路径不可复用；需新登录时由kimi-auth重新准备，不代Bob登录。

2026-10-28新增独立Driver工作（不启动审查、不审批、不改生产开关）：

```sh
node scripts/acceptance/kimi-qoder-cn/driver-cli.mjs --agent kimi --case status
node scripts/acceptance/kimi-qoder-cn/driver-cli.mjs --agent qoder-cn --case discover
node scripts/acceptance/kimi-qoder-cn/driver-cli.mjs --agent qoder-cn --case status
node scripts/acceptance/kimi-qoder-cn/driver-cli.mjs --agent kimi --case collision
node scripts/acceptance/kimi-qoder-cn/driver-cli.mjs --agent qoder-cn --case collision
node scripts/acceptance/kimi-qoder-cn/driver-cli.mjs --agent kimi --case local --keep-fixture yes
node scripts/acceptance/kimi-qoder-cn/driver-cli.mjs --agent qoder-cn --case local --keep-fixture yes
node --test scripts/acceptance/kimi-qoder-cn/driver-cli.test.mjs
```

仅macOS。两家均可显式选discover/status/collision/local；--bin固定指定CLI，--output指定新原件目录。Qoder status消耗一次官方默认路线真实配额并临时复制最小认证，其它Qoder case不调用模型；Kimi native case只使用无真实凭据loopback，不是模型准入。local仅临时构建候选开关、真实本地CLI进程认领/继承，不启动审查worker。默认删除根；--keep-fixture yes仅允许local，留无凭据夹具与fixture.json、拒绝review的wrapper，不安装candidate。每批上限16次派生，每次90秒；完整逃逸后代/监督进程被杀回收未测。

七项须从原生目录核数量与来源；status还须核native工具、argv/cwd及账本exit_code=0。第一批假.git装置失败与旧缺exit_code原件保留，不得引用其中旧checks宣称status成功。Kimi -p保留斜杠原文，原生Skill追加参数尾段；模型转抄与原生加载分别登记。正式A/B/C/D、审批、恢复/放弃和Windows未测，具体待验文本见[Driver报告](../../../doc/05_testing/REPORT_2026-10-28_KimiCode与QoderCN独立Driver验收.md)。

2026-10-28直接整改（Bob授权暂不双审）：execution采集器与生产准入共用适配层qoder-cn-execution判据，原件新增文件前态与proof目标，精确核对Write内容、Edit替换和Bash命令。成功观测须保留完整派生/信号/超时/早停/截断事实；原件明确real-model来源，loopback或缺来源不能生成准入。源声明不是独立底层身份认证。旧原件不补字段，历史Write可观察性仍保留，不能移作新判据通过。工具未调用不改变提示重试；本批未新增厂商模型调用。新增准入反例由默认unit测试收录。

20:30左右的续调查见两份报告末节：隔离下载官方Kimi 2.4.0并校验发布digest，final五臂仍复现规则未阻止执行；没有替换本机2.3.3。Qoder 1.1.80本地合成模型响应实验在鉴权/目录能力层失败，localhost请求0，不能补成Edit/Bash分发拒绝证据。该临时原型只以脱敏文本留存于evidence，不新增受支持的生产入口。

源码工具现支持显式完整commit，默认仍固定历史2.3.3，不跟随main或浮动标签；导入模块不会联网。新版本复核用已解析的官方release commit，例如：

```sh
python3 scripts/acceptance/kimi-qoder-cn/kimi-source.py doc/05_testing/evidence/kimi-240-20261028 --commit f26e4d91ef8d5d233f6c20b42a150f96924d4f5e
```

只接受40位十六进制SHA，拒绝main、短SHA与任意URL。新原件记录该commit、源码归档hash与采集器hash；旧原件不改写。该源码检索和受控响应均不是生产真实模型准入。

旧 `probe.mjs` 与 Windows/Git Bash 包装保持原默认及历史 hash 语义。

2026-10-28 Qoder 候选接入与诊断（生产准入仍关闭）：

```sh
node scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs bailian/qwen3.8-flash-tp
node scripts/acceptance/kimi-qoder-cn/qoder-execution.mjs custom:bailian/qwen3.8-flash-tp
node scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs Qwen3.8-Flash open deny-visible paths
node scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs Qwen3.8-Flash matrix-open matrix-readonly project-hook-open project-hook-readonly
node scripts/acceptance/kimi-qoder-cn/qoder-lifecycle.mjs Qwen3.8-Flash
node scripts/acceptance/kimi-qoder-cn/qoder-admission.mjs doc/05_testing/evidence/qoder-cn-admission-20261028/manifest-custom-0802.json
node scripts/acceptance/kimi-qoder-cn/qoder-index.mjs
```

custom、execution、readonly、lifecycle命令消耗真实配额，显式选择样本；admission/index仅校验或汇总项目证据。admission生成器默认仅输出候选评估，全部必需项通过且带--write和显式项目根才写项目台账；08:05历史review配方评估仅4项模型控制/30项，空禁读覆盖不能用于生产。09:24新可观察性诊断独立列示，不与旧4/30合并；不写台账，不打开registry。历史原件wx保留，复跑指当前源码，不保证复原旧脚本/临时路径。

新增 execution 命令消耗真实配额：先核实显式 Custom 唯一声明，另以生产官方探针实际路线独立核对。两路线合计至多24次原生CLI启动（包括版本/目录，比24次模型调用更严格）与60分钟模型派生窗口；每臂最多180秒，不因未调用换提示重试。固定提示词/hash、实际argv、两臂权限语义、同ID工具轨迹与假文件回读都入原件。候选原样消费生产审核参数/权限模板；无害正控制另列，不能算审核配方。生产枚举生成非空禁读集，集合冻结不等于路径拒绝已验；临时项目删除后证据仅用于可观察性诊断，不供其它项目写台账。

execution 首跑装置失败及回收单独留痕，后续修正不覆盖。原生完整进程树/codec/worker失联仍需另测；本批组回读只作安全收尾。任一核心必需项阻塞时停止扩展其它准入调用。工具未暴露且未调用是未测；只有真实调用和同ID分发错误才称tool-unavailable，mode/rule单列。代码自动化通过不提升为准入。

admission 生成器可用 `--project-root <隔离项目根>`；manifest、facts、证据和覆盖均相对该项目，评估原件默认放manifest所在目录。`--write` 必须同时显式给项目根且全部必需项通过；不传根仍兼容本仓评估，不写台账但写评估原件。生成器只冻结manifest集合，不自行运行生产禁读枚举；execution采集器调用enumerateDenyPaths，生产消费端将实际请求禁读集与已验集合复核。隔离项目应配置自己的runtime.run_root；新增同行工件扩集须重验，不能用目录前缀替代精确台账覆盖。

代码审修订：真实候选越权成功或假文件变化直接记fail/unsafe并停止后续派生，不能降成untested。未调用或正控制不足才记untested；有调用但不满足执行层拒绝记fail。此新增反例仅合成回归，未追加native调用，不改09:24原件。

GLM续裁修订：来源快照使用生产加载器返回的实际root（尊重QODERCN_CONFIG_DIR），新原件带实际入口、护栏/辅助hash及monitor首因/通道/终态因子；索引转录绑定并将缺字段列为警告，不给旧件补字段。`qoder-index.mjs [证据目录]`可对隔离夹具运行，坏execution逐件记录错误并继续，好件仍索引，脚本退出1。逐臂清理先保留监督结果，remaining/reused立即拒绝下一派生。共享执行器的身份ps移出探针段，真实Node限额回归通过；当前采集器hash已不同于09:24原件，逐臂清理/新增字段仍未追加native实测，不据自动化提升准入。

Custom复用生产单条加载器：当前CLI内置非公共JS/WASM在私有replace环境短命Node子进程运行，筛选唯一声明，仅重加密一项；所有解密参数加入秘密集，传输AES-GCM密封，不复制全目录或提取物进项目。模型/CLI/Node/codec/配方指纹绑定，未知布局拒绝；密钥不进配置、日志或工件。可调用不等于只读准入，底层model/provider未知保持null。

readonly可选择 open/readonly/deny-visible/paths/env-canary/matrix-open/matrix-readonly/project-hook-open/project-hook-readonly。Write路径规则实际由Edit(path)管理；05:55已有Write/Bash正控制与可见rule拒绝、直接Grep/Glob禁读拒绝。06:20最小工具仅Read/Grep/Glob且正常调用成功，危险工具未调用不能算分发拒绝；项目Hook正控制执行而user源臂未触发，缺原生执行层排除证据仍阻塞。默认工具31项需完整审计，不能只检查Write/Bash。

生命周期装置观察真实CLI启动失败、超时、诊断取消和强杀，并核组退出/私有根/租约清理；不是生产三审worker，不能替代失联与脱组后代准入。通用两进程租约/冻结测试使用明确合成夹具，也不能冒充native验收。

历史环境/拒绝更正范围见[报告](../../../doc/05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md)：04:12及以前只叠加env，04:30后undefined删除，续批qoderRun强制replace覆盖构造后新增键；mode与rule按原生system决策ID区分。旧JSON/索引不回填。共用护栏回归已由默认npm test导入；未知内部解密认证字段如实列扫描边界。官方/Custom、诊断/审核配方、平台与CLI版本的结果不能互相套用。生产三审、Windows与完整安全矩阵未通过。

2026-10-28 新增 macOS Kimi 独立诊断：

```sh
node scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs --suite spike
node scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs --suite rules
node scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs --suite extra
node scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs --suite verify
node scripts/acceptance/kimi-qoder-cn/kimi-rootcause.mjs --suite final
node scripts/acceptance/kimi-qoder-cn/kimi-lifecycle.mjs
node --test scripts/acceptance/kimi-qoder-cn/kimi-evidence.test.mjs
python3 scripts/acceptance/kimi-qoder-cn/kimi-source.py
node scripts/acceptance/kimi-qoder-cn/kimi-index.mjs
```

`--bin <原生CLI>` 指定版本；`--output <目录>` 指定新证据目录。CLI 固定到私有临时副本，不升级用户二进制。每次证据 wx 创建，不覆盖失败。loopback 合成 provider 不携带真实凭据，工具请求被送入官方 native dispatcher；不使用自建权限分发器。`rules` 22 臂、`extra` 17 臂、`verify` 5 臂，另有 version/doctor 辅助启动。单次脚本上限 64 个实验臂不是跨次全局预算；本批总量见报告，不自动批量重跑。

`--suite managed` 为独立真实模型桥接：只读全局声明和现有 access_token 快照，生成临时官方 endpoint 配置，不复制 refresh_token、不调用登录、不回写全局。它改变临时认证交付方式（OAuth 引用→静态 api_key），需与原生路线区别记录。没有 access_token 时启动前失败，不能用 loopback 结果替代；本次该臂 0 次 native 启动。

`extra` 的两个旧生命周期臂只观察了 native 所属进程组，后续确认留下两个脱组的合成等待进程，均按精确合成命令与 PID/lstart 核实后 TERM/KILL 回收。原件不改，真实整树取消判失败；当前代码禁止再启动这两臂（因此新 extra 是 15 臂，历史原件仍 17 臂）。`kimi-lifecycle.mjs` 用真实 native CLI 加显式受控 wrapper/后代验证监督与强杀清理；它使用合成凭据，不能证明真实账号凭据、厂商自派生/逃逸进程或监督者自身被杀后的回收。

判定模块为实验专用，未接生产 TraceCapability。`complete` 只表示本脚本定义的 JSONL 配对/终态契约，不表示厂商全部执行事件均可审计；native stream-json 没有独立权限审计终态。过滤、未调用、口头拒绝、退出 0、文件未变均不升格为执行拒绝。`机制拒绝待对照` 也不是准入通过。

实验测试独立运行，不在 `npm run check` 或 `trivium verify` 的默认收录中。Windows 与其它客户端不适用本批结果。生产开关继续关闭。

采集器退出 0 表示采集完成，不能作为安全准入成功。`status` 的泄漏标签也用于 none/allow 正控制；解读时必须结合该臂规则与预期。`final` 重复最小失败对照并记录 Write 文件前后状态、配置前后 hash；原失败文件不回填。

历史批次脚本在 spike/rules/extra/managed/verify/final 之间迭代，早期源码版本未逐份保存，不能按旧 script_sha256 逐字重建旧批次；当前命令仅表示使用当前代码重新执行同名控制，并不复原历史端口/临时根/字节。代码审修复后的采集器未追加 native 运行。新运行会记录 source_code、实际 commandLine 和结构化 rerun 命令；后者重建整个 suite，临时 native argv 仅供本次事实核对。`skill_sentinel_seen` 等字段是后来新增的观测面，以各原件 script_sha256/字段为准。

拒绝文案按版本固定：not found 与敏感路径错误取自 2.3.3 实录；`rule_denied` 文案只取官方源码候选，本批从未在 native 里生效，正向单测是合成回放。换版本时文案不匹配即未证实，必须另取真实正反对照，不能仅为得到绿色而扩大正则。

源码检索工具固定官方 commit，保存全部检索正则、逐项命中与关键函数正文；它不证明二进制等价。索引工具重算原件 hash/模式敏感扫描，不覆盖旧索引，不调用厂商。旧 v1 原件无机读启动账本，v2 索引保持 null/count_complete=false；历史 60 是报告中的逐批人工推算，不伪装为新工具自动核算。新索引也不重复读取用户全局凭据。

Qoder续批代码审修订：无工具callability参数与review_invocation_args分开；探针追加真实最小读取控制（会多一次模型调用），只有成功才提供review参数。当前08:02四臂已改用review argv；旧06:23的4/30不可跨配方继承。模板/环境允许键实际入hash，Custom key大小写精确。无运行目录也会从retention/scrub回收所有者已死的null租约，活组仍拒绝。manifest须列deny_paths已验覆盖，原件scope hash一致且实际请求不扩集才可能准入；当前无完整合格组合。
