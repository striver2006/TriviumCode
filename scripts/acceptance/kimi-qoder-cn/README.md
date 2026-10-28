# Kimi/Qoder 取证工具

旧 `probe.mjs` 与 Windows/Git Bash 包装保持原默认及历史 hash 语义。

2026-10-28 Qoder 候选接入与诊断（生产准入仍关闭）：

```sh
node scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs bailian/qwen3.8-flash-tp
node scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs Qwen3.8-Flash open deny-visible paths
node scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs Qwen3.8-Flash matrix-open matrix-readonly project-hook-open project-hook-readonly
node scripts/acceptance/kimi-qoder-cn/qoder-lifecycle.mjs Qwen3.8-Flash
node scripts/acceptance/kimi-qoder-cn/qoder-admission.mjs doc/05_testing/evidence/qoder-cn-admission-20261028/manifest-custom-0802.json
node scripts/acceptance/kimi-qoder-cn/qoder-index.mjs
```

前四条消耗真实配额，显式选择样本；后两条仅校验/汇总项目证据。admission生成器默认仅输出候选评估，全部必需项通过且带--write才写项目台账；当前新review配方仅4项模型控制/30项，空禁读覆盖不能用于生产，不写台账，不打开registry。历史原件wx保留，复跑指当前源码，不保证复原旧脚本/临时路径。

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
