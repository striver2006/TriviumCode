---
name: dual-critic
description: TriviumCode 双审流水线的核心资产容器：编排器脚本、JSON Schema、审查提示词、只读 Agent 定义、Hook 配置与文档模板。不含任何流程，不应被直接调用。
user-invocable: false
disable-model-invocation: true
---

# TriviumCode 核心 skill

本 skill **只是容器**，不含流程。全部确定性编排都在 `scripts/trivium.cjs` 内
（设计原则 P1、AD-13）：并行、超时、心跳、指纹、轨迹核验、防覆盖命名、裁决校验
都不在任何 SKILL.md 里。

## 目录

| 路径 | 用途 |
| :--- | :--- |
| `scripts/trivium.cjs` | 编排器本体（esbuild 单文件产物，不进 Git） |
| `schema/` | 当前写契约 `review.v2` / `disposition.v1` / `run.v3` / `config.v2`；只读保留 `review.v1` / `run.v1` / `run.v2` / `config.v1` 历史契约。运行期先校形状，再按注册表校身份 |

run.v3 的 requested_routes 在执行前按入选侧记录 model、effort、tier、tier_source、access。取消与 worker 启动失败不丢请求；worker 与交接逐项比对后执行，报告保留无结果侧的请求注记。历史 v1/v2 不补写。新审查骨架冻结 `effective_failure_policy`。证据不足仅重试本侧，消耗共享瞬时额度且至多一次。终判仍不足时只留失败件，计票记 `insufficient_evidence`，gate 用同一资格复核新轮。
| `prompts/` | 各阶段的审查提示词模板 |
| `lenses.yaml` | 两侧差异化审查镜头（§9.3），避免双审退化成同审 |
| `agents/trivium-critic.md` | Antigravity 只读审查 Agent 定义 → 安装到 `~/.gemini/config/agents/` |
| `hooks/hooks.json` | Hook 配置 → 由 `trivium init` 合并进目标项目 `.claude/settings.json`，并以 ZCode 形态合并进 `.zcode/config.json`（`trivium hooks --agent <id>` 可单独渲染一家；codex / gemini 没有 Hook 机制） |
| `entry/<agent>/`（只在仓库里） | codex / gemini / glm 三家的入口 skill 渲染产物，由安装器装进各家的 skill 根；**不随本目录安装**——codex 会递归枚举 skill 根，嵌套在这里会让别家入口被它调起（设计 7.4.1） |
| `templates/` | 计划 / 根因 / 裁决 / 应答 / 验证 五类文档模板 |
| `protocol/` | `CLAUDE.md` / `AGENTS.md` / `.gitignore` 的幂等追加片段 |

## 为什么入口是 `.trivium/bin/trivium` 而不是本目录

目标项目里的 Hook 与入口 skill 一律经项目内的 `.trivium/bin/trivium` 调用编排器：Hook（Claude Code 与 ZCode 两种形态是同一条命令）写作 `${CLAUDE_PROJECT_DIR}/.trivium/bin/trivium`，四家的入口 skill 用项目相对路径。
那个 wrapper 由 `trivium init` 生成，内含 `doctor` 探测到的 **node 绝对路径**——
GUI 进程不读 `~/.zshrc`，依赖 `PATH` 会在 VS Code 里失效（设计 §10.5）。
也因此不依赖 `${CLAUDE_SKILL_DIR}`。

历史plan-r3/v1契约（已被当前r9补充修订，旧采样保留）：2026-10-11 plan-r3/run20261010T175354Z获批目录整改：Claude目录事实另带真实项目sensitive_globs稳定hash（排序去重字符串集合的JSON/SHA256）与受测形态版本；事实缺值、项目配置变更、TTL或路线/版本/入口/native不匹配时逐文件回退。v1受测范围限制为ASCII目录段^[A-Za-z0-9_-]+$、根1至4段及后代0至2级；特殊文件名证据不扩展到中文/空格/逗号/点目录。无候选事实不读二进制；同一精确路径仅本次调用复用hash，不设跨运行缓存，性能未实测。peer_deny_applied的Claude压缩分项是输入防御不变式，不是独立模型能力证明。目录后置臂预期失败保留主probe并清空目录事实、脱敏留痕及清理；未定义内部错误继续抛。

历史r7送审前边界（已被当前r9补充修订，旧采样保留）：补充边界：原生产压缩根实际为5段，超出当前批准范围，静态回放回退settings为2,898,308字节。扩到5段尚待新增正式计划审查授权；不得因自动plan/code审批或CLI扩容自行扩大正式轮数或消费域。原生产写负对照标准始终保留；四个无新取证机制的Claude写组合在spawn前拒绝，无准入通过结论。当前状态见[恢复报告](../../doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md)（skills说明从仓库doc/05_testing定位该报告）。
历史plan-r4/run20261010T224543Z获批r9契约（当时总7轮）：目录形态为ascii-root1-5-depth0-2-v2，目录段^[A-Za-z0-9_-]+$、根1至5段、后代0至2级；仅真实新拓扑doctor通过且项目hash/时间/路线/版本/入口/native一致才消费，v1旧事实失效。五种根的七臂每工具文件30、目录5、共同正对照4，180秒每臂保持，失败保存主probe并清空目录事实。总7轮例外已独立授权，第6次补充计划已批准、第7次完整代码重审待执行；CLI额度与轮数分列。第7次启动前用最终构建、生产完整禁读枚举及实际可消费事实计算settings，超过既有131072字节软线则任务包装器拒绝正式启动，不删除禁读项、不改产品软线、不借旧安装绕过。原生产写四缺口仍未测，判据替代未采用，M11前置未完成。

当前目录事实与敏感枚举规范统一见[设计§3.5](../../doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-directory-contract)：消费仅限受测ASCII形态、绑定实际项目及入口，失配回退逐文件。正式授权、实施、真实取证和未测状态见[恢复报告](../../doc/05_testing/REPORT_2026-10-11_agent_access_recovery.md)，不以本节历史计划采样替代当前验收。

本主题任务级收口边界（2026-10-11）：用户独立授权正式总12轮，11B有效且普通审批完成，12C须在三项守卫修复/检查/安装之后完整重审。v2轮数纯核验必须显式取得当前授权，v8为正式审查入口、quiet-v6只摘要认领/解析/预检；旧授权/launcher/审查记录均保留。Claude五个非flash写缺口无新机制时不再付费碰样本。此处不新增Schema或准入判据，生产写仍须真实模型尝试与配对拦截；两项替代候选和BRIEF扩禁未采用，详见恢复报告。

较晚收口边界（13B/r18已获批，以上总12为历史采样）：当前v6总14，仅余14C；正式review直接launch-v10，quiet-launch-v7只接受v10参数并摘要认领/解析/预检，必需值拒绝--样式。REQUEST_TOKEN、LOAD_TOKEN、load_id、预算marks同值，token独占wx防复用、摘要只消费本次requested/completed；证据失败保留code/signal，非0码沿用，0/null失败1。正式code先测固定precheck-v2默认链，任务级plan测量取消已在设计v1.3.150记录，未来新增plan须新方案重评，不永久静默复用。旧v5测试固定历史fixture、当前v6直测；两遍check/桩/正常四目标安装后14C完整重审。产品只读、准入判据与模型配置不改，候选未采用，M11前置未完成。本文件为核心容器源，七入口措辞本轮未改，无需render。


较晚采样（第14C后）：14C run20261011T070836Z有效、无漂移/现行guard违规，但普通code依委托拒绝，四意见裁决为两接受、一驳回、一暂缓。沿13B已批准范围，quiet-v8对完整摘要JSON应用既有脱敏/扫描，补包装器自身异常尾行防御，token、白名单、code/signal及证据选择语义保持；v6谱系hash补直测。旧quiet-v7/授权/原件不改，通用base/数值连续性guard不扩。当前正式14/14，第15完整C资格待Bob独立授权，未启动。判据候选未采用、准入缺口仍保留，详见r6/post-round14-wrapper-followup-proposal.md及恢复报告；两遍check/安装指纹须以新的补修采样分别留痕。

> 2026-10-11 第15次重审授权补记：用户独立授权“授权总15轮，仅追加完整代码重审（建议）”。当前权威 v7 保留 v6 原件及14次历史，仅开放15C，拒绝16次与新增计划审查。两项补修（quiet-v8完整摘要脱敏、v6 supersedes 原件hash直接断言）仍属13B已批准范围；v11只更新授权载体，不修改guard语义或准入判据。第14C普通code拒绝保持；第15C结果及新版完整指纹尚未取得，旧准入不自动迁移。

> 上述第15次补记为授权当时采样，保留历史原文；当前执行口径以恢复报告最新段与hash绑定的正式权威指针为准。2026-10-11用户随后独立回复“授权轮次可以按需增加，不必询问授权”，当前v8仅枚举有界16B/17C、保留15历史及v7谱系，18仍拒绝；未来批大小由发布核验与正式审查约定保证，v2守卫本身不核批大小。第15C已有效并按委托批准，第16B run20261011T093157Z五条裁决/r20及普通plan已批准，第17C尚待实施完成。新增诊断不改变原准入判据，判据变化仍须另行明确批准；旧874完整矩阵5通过/1未通过/6未测仅其原指纹采样，后续新任务书/新包未测。

> 第16B/r20获批取证契约（详见设计v1.3.152）：仅Codex/read使用无实际首词及无预设结论的对象Schema指引，单cat要求保留；Claude/write/deny的14份真实prompt固定hash回放。fixture-before/after在本臂新增readme_state（普通非软链文件、bytes/sha256/精确路径），result顶层read_content_diagnostic为固定诊断对象：kind=diagnostic-only、comparison=byte-exact/no-normalization、strict_content_match/reasons、前后状态、输出bytes/hash及两种ID。额外前后缀/尾换行、截断、缺证据、目标/cwd/ID错配、前后变化均不得诊断true，未定义读错误继续抛并清理。原配对函数/准入断言逐字保持，诊断不参与准入汇总，不改产品Schema、adapter/probe旗标或模型/effort/版本；新包检查、安装、17C及普通code批准后才做真实补测。


> 第19B/r22获批写合同取证（设计v1.3.153）：19B run20261011T113848Z有效，9意见逐条接受，完整r22修订及用户明确委托的普通plan批准已记录；20C尚待实施、检查与完整代码重审。仅生产Codex/write在独立临时夹具创建WRITE_CONTROL.json（O_EXCL、0600、真实非软链根），固定原目标/标记及未导出原BREACH字面，不改src探针命令。canonical唯一调用条件第六参接合同；旧五参14样本仅历史兼容，当前非目标逐项字节对账。提示仅单cat合同后从实际输出取command/cwd/target，逐字执行一次，不提供写命令或结果示例，不强迫工具、不循环换提示。新模块进入assets全指纹及版本重录。
>
> fixture-before/after保存合同普通文件状态、声明nonce、bytes/hash；result.write_contract_diagnostic只诊断：kind=diagnostic-only、严格全文字节/双身份、同session/turn与可信完成/启动时间及先读后写、实际cwd和原精确写配对。缺状态/来源不一致/改变/截断/增删尾部/非cat/head/jq/复合/重复ID/错目标/未完成/乱序均false列reasons，不参与原write_pass、准入汇总或产品Schema。未知错误直抛，脱敏failure留痕并走原凭据/夹具/scratch清理。原codexCommandEvidence函数体hash不变，真实实际尝试+配对拦截+文件状态标准不变；合同存在或全文声明不能替代调用。
>
> 六个Codex/write均需新机制与最终完整指纹的实际证据；首批Qwen/Luna各一次，仅同最终指纹可省重复；Sol/Astra/Kimi/DeepSeek各新写首次合计预计8包装/native启动另批发布。正式v10有界19B/20C，21当前拒绝；审查243/248、准入633/645为19B收尾采样。旧05矩阵5通过/1未通过/6未测及所有历史保留；19预检仅三个checked_at语义变化仍使全local指纹9270→9d166，当前完整指纹12组合均未测，不能继承。五个Claude非flash生产写仍无新机制、0启动；官方Claude待订阅、服务端身份null、客户端入口实际解析未测。component/restricted候选未采用，判据变化仍需独立明确批准，目标未完成。


> 第20C后同获批范围失败留痕补正（设计v1.3.154）：20C run20261011T122355Z有效，6条逐项2接受4暂缓，普通code按用户明确委托拒绝，业务摘要0；21C待完整重审。修正仅r22已批准“失败可见、未知错误上抛、任何步骤清理”：recordAdmissionFailure保留主异常，失败保存异常进入AggregateError，不额外直出原始错误、不覆盖wx原件；cleanupPreservingFailure让原cleanupAll继续全部清理，清理异常与主异常同时保留。fixture/scratch初始化进原try/finally；failure.json增加readme_after、合同阶段/创建状态与资源可用状态，创建途中未知记null；未取得scratch返回值的清理状态不冒称已删除。selection/版本资源前预检失败仅有既有调用完成失败侧车，不承诺failure.json。
>
> 本批不改变原codexCommandEvidence字节、写/读判据、目录消费/根形态、产品Schema、模型/effort/CLI版本、全局配置。ASCII后代目录加特殊文件名联合样本、/tmp等祖先别名、理由粒度细化与采样器合并均暂缓；前两项如需支持须另审守卫/探针语义，不将未测组合追认。五Claude非flash写继续0启动，当前新完整指纹12组合均未测。按独立按需委托发布v11仅21C，22仍拒绝；新v15只换权威文件名及首注释，guard/precheck不改。review起点253、预计15/硬20/累计止273，admission本批0保持633/645，旧台账/原权威/20C原件不改，普通审批不包含判据变化。


> 第22B获批Claude精确拒绝取证（设计v1.3.155）：22B run20261011T142848Z的11意见已裁决，gate通过并按Bob本轮明确委托审批r24定稿敏感范围；23C完整代码和新指纹准入尚待验证。canonical仅真实Claude deny-read/deny-grep调用claudeDenyEvidence：生产judgeDirectoryArm true为必要非充分初筛，脚本独立核合法事件、唯一init/成功终态、每目标唯一实际调用→同ID is_error=true结果→同ID同工具同精确路径权限记录及完整覆盖。最终路径仅折/private/var，生产helper较宽归一不扩大脚本域；已录制旧精确路径/新完整目录错误白名单之外拒绝，目标成功读取或raw哨兵泄漏拒绝，允许文件成功读取不误杀。
>
> result保持deny_pass/per_file_deny原字段，新增deny_evidence伴随事实；历史原false和原件不回算，summary判据不改。新目录文本Read回放及Grep模拟不是新模型能力，Grep仍须实际调用与完整配对。Codex冻结函数/原写标准、生产probe/adapter、Schema、版本/effort和全局配置保持。当前local6cc3下12组合完整未测，旧4c87四通过仅历史；准入673/689、review283/288、正式22/23，五Claude非flash写无新机制0启动，官方Claude待订阅。component/restricted判据替代未采用，仍须Bob独立明确批准；详见[设计契约](../../doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-directory-contract)，M11前置仍未完成。


## 当前 Agent 范围（2026-10-29）

仅支持 Codex、Claude Code、ZCode（GLM）、Antigravity（Gemini）。Kimi Code 与 Qoder CN 的候选接入、专用入口、探针、适配器和台账/租约运行逻辑已移除，旧任务与失败证据只作历史查阅。

当前 v3 的 native_model、requested_routes.admission 及 probe_default 枚举仅保留历史形状兼容与冻结一致性校验，四家不产生这些候选路线字段；没有原生默认回落或组合台账消费。v1/v2 原契约不改，身份仍由当前注册表校验；被移除身份不能发起新任务。
