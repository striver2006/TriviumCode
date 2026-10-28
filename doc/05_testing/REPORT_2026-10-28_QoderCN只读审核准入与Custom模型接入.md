# Qoder CN 只读审核准入与 Custom 模型接入

日期：2026-10-28；Driver codex；任务主题 `QoderCN只读审核准入与Custom模型接入`。

**整体未完成，生产准入阻塞。** 续实施已增加 Custom 候选适配器、三档/单次覆盖、worker 冻结及组合台账校验；没有任何完整准入组合。registry 的 criticEnabled/defaultSelected/driverEnabled 均 false，真实 Qoder 三审与 Windows 未测。最新状态见文末「续实施批次」；其前各段是04:48及以前历史记录，不能当作当前实现清单。

**环境证据更正（完整代码审首轮）**：run `20261028T041304Z` 两家独立指出并经源码/真实子进程确认：公共run会在process.env之上合并env，早期白名单只返回允许键，未显式删除其余父键。因此本报告此前所有02:38至04:12批次均不能作为“未知父环境不继承”的证据；其中“使用生产新环境策略”只说明使用了同一返回对象，不能证明最终派生隔离。旧批次的调用/拒绝与退出码仍是当时观测，环境条件不满足新策略，不纳入修复后准入。原始JSON及索引不重写，在报告和新索引旁注失效边界。

修复为厂商适配器对所有非白名单父键显式置undefined，沿用run既有删除语义，不改变公共执行器。新增真实run子进程回归：父进程放入未知canary、厂商canary、假云凭据与指向不存在文件的NODE_OPTIONS，子进程正常启动且五键均不可见；默认测试收录。真实厂商env-canary臂另行采集，不拿该Node回归替代厂商完整准入。

修复后原件：[Custom三臂](evidence/qoder-cn-admission-20261028/custom-2026-10-28T04-30-46-046Z-cbceeb.json)、[官方五臂](evidence/qoder-cn-admission-20261028/readonly-2026-10-28T04-31-58-012Z-0a893e.json)。Custom仍为0/0/1（缺配置0是失败反例）；官方env-canary真实Bash调用 `call_829fbb4d554045af90a2245b`，原生tool_result为 `ENV_CANARY__`，两个合成父变量均未继承。此臂仅证明选定两键在该原生Shell路径不可见；其它入口与全部环境空间不能据此通过。已知秘密未命中，来源/认证hash及临时根清理回读均成功。

同批open已改dont_ask及Write精确canary许可，Write实际调用仍被审批拦截、Bash控制写入成功，不能计本批Write正控制通过。还观察到CLI自动批准了模型追加的只读ls/cat命令：显式echo allow规则不是Shell唯一可执行命令的保证。该臂只用于可丢弃对照，不能移作生产审核配方；不以过往accept_edits无路径Write控制替代收紧后缺口。

## 基线、来源与方法

初始工作树干净，HEAD `3425274f`；已有 Kimi 工作及 P2/历史失败证据保留。产品版本仍 1.3.2，未提交、未推送。计划首轮 gemini/glm/claude 三家均修改后通过，22 条意见逐条裁决（21 接受、1 驳回），gate 已通过；r2 为完整实施依据。驳回项不接受以工具列表裁剪替代用户要求的执行层拒绝证据。

官方依据：[Custom](https://docs.qoder.cn/cli/custom-models)、[模型](https://docs.qoder.cn/cli/models)、[配置](https://docs.qoder.cn/cli/settings)、[权限](https://docs.qoder.cn/cli/permissions)。它们说明原生 /model 管理与 CLI modelID 选择，不证明本机隔离或身份回读。当前 CLI 1.1.80、darwin arm64，入口字节 SHA256 `33050a4d2ac134e2f8d0a5293cba3df009d7bdbe0f3ae478c73057f113050a02`。新版采集器复制当前可执行字节到一次性根后运行，避免安装路径更新造成版本漂移；旧首批未固定副本，原件保留。

所有真实调用在一次性夹具内进行。官方臂只复制 `.auth/user`、`.auth/machine_id`，不加载用户 settings/插件目录。Custom 在内存解密缓存后只重加密选中条目，未复制其它五个模型凭据；已知 api_key 值在输出落盘前逐值替换扫描，不记录密钥或解密原文。采集退出码只表示采集器是否完成；每臂原始退出码单列，admission 始终 false。

## Custom 原生机制与实测

当前存储为 `.models/default` 指定账号目录中的 `customs`。CLI 的原生代码使用 `model_cache_decrypt/encrypt` 和 `.auth/machine_id` 读写该缓存。首个文件共 6 项，不能整份复制到隔离根当作最小配置。

诊断脚本从当前安装二进制定位内置 JS/WASM 编解码器，临时执行后删除；这不是官方承诺的公共 API。当前 source/WASM hash 与 CLI hash 一起记录，未将提取的厂商源码或 WASM 纳入仓库。任一边界不唯一、格式变化或未知参数应停止，不能把该方法宣称为跨版本生产加载契约。

选中 `bailian/qwen3.8-flash-tp`，声明 provider 为 bailian、modelID 为 qwen3.8-flash-tp、显示名为 `Qwen-3.8-Flash (Alibaba Cloud Model Studio - China)`。原生目录同时含官方 `Qwen3.8-Flash` 和独立的 Custom 显示名/key，因此官方单列目录解析器没有放宽。

| 真机臂 | 原始退出码 | 事实与判读 |
| --- | --- | --- |
| 选中 1 项最小加载 | 0 | 目录列出该 Custom，真实响应成功；init/assistant 是配置显示名，result.modelUsage 是原生 key；已知密钥未见于 stdout/stderr |
| 不加载 Custom 声明 | 0 | stderr 明确回退 Auto，init/assistant/计费 key 均为 Auto；**失败反例**，不能按退出 0 判通过 |
| 所选项改为合成错误 key | 1 | 原生 401/authentication_failed、error_during_execution、100401；未将认证失败误作模型回退 |

必要身份回读仍不足：显示名和计费 key 都与本地声明有关，未取得独立供应商/底层模型身份。provider_effective/model_effective 保持 null/unknown；没有采信模型正文自述。此处记录了真实可调用性，**不是**完成生产模型身份验收。

当前最新 Custom 原件：[custom-2026-10-28T04-30-46-046Z-cbceeb.json](evidence/qoder-cn-admission-20261028/custom-2026-10-28T04-30-46-046Z-cbceeb.json)。02:43为固定字节的历史批次；首批同名实验与后续原件均保留，不能把首次未固定二进制的证据改写为新装置结果。

额度恢复后，使用共用逐值护栏的复跑：[custom-2026-10-28T04-10-34-193Z-5bc31a.json](evidence/qoder-cn-admission-20261028/custom-2026-10-28T04-10-34-193Z-5bc31a.json)。三臂结论保持0/0/1，known_secret_found=false、sources_unchanged=true、temporary_roots_removed=true；其中0退出的缺配置臂仍是回退失败反例。新增secret_guard_sha256绑定共用护栏，旧原件不补写。

## 官方模型工具与路径对照

固定官方 Qwen3.8-Flash，三臂同一可丢弃装置，初始原件为 [readonly-2026-10-28T02-41-08-623Z-15bc79.json](evidence/qoder-cn-admission-20261028/readonly-2026-10-28T02-41-08-623Z-15bc79.json)。此首批环境白名单由采集器构造，后续固定字节批次直接使用生产 withQoderHome 传入的环境。

固定字节的历史复跑原件（env仅叠加，**不计隔离证据**）：[readonly-2026-10-28T02-44-15-091Z-e3f692.json](evidence/qoder-cn-admission-20261028/readonly-2026-10-28T02-44-15-091Z-e3f692.json)。三臂全部原始 exit 0。与首批不同，第二批审核臂实际产生 Write `call_6c2eda8a59cf48b5b06acc47` 与 Bash `call_27295a179e624ca18d432ff1`，相应 tool_result 为工具不可用错误；is_error=true、permission-rule=false、permission_denials=[]。这是原生工具注册/分发拒绝观测，不能写成“未尝试”，也不能改称permissions规则拒绝。路径臂仍有两条 Read permission-rule 拒绝。

更正：初版报告沿用首批“未调用”描述，误述第二批；两侧代码审均指出后按原件纠正，历史JSON不改。工具裁剪拒绝在tool_result里留痕、没有进入permission_denials，说明两个拒绝观察通道需要独立处理；这两项观察不等于其它执行入口、路径与配置叠加已验收。

额度恢复后的四臂原件：[readonly-2026-10-28T04-11-23-932Z-18cab9.json](evidence/qoder-cn-admission-20261028/readonly-2026-10-28T04-11-23-932Z-18cab9.json)。readonly臂本次未调用危险工具；deny-visible臂虽传完整--tools，实际init只列Glob/Grep/Read，Write/Bash真实调用均Tool not found，说明原生deny也会提前裁剪工具，预期的独立规则拦截仍未测。paths臂两条Read permission-rule拒绝重复成立。

该批开放臂改用dont_ask及窄Shell规则后，Bash成功、Write因需要审批被拒，不能记该臂Write正控制通过。仅再复测open，权限模式改为accept_edits，原件 [readonly-2026-10-28T04-12-18-095Z-595da8.json](evidence/qoder-cn-admission-20261028/readonly-2026-10-28T04-12-18-095Z-595da8.json) 两个canary均从不存在变为存在，Write/Bash正控制成立。两次模式/结果分别保留；没有用后者覆盖前者失败。新版全部未命中已知凭据、全局设置及认证hash不变、临时根删除已回读；这仍不等于强杀后清理通过。

| 项目 | 已观察事实 | 验收状态 |
| --- | --- | --- |
| 正常 Read | 真调用、工具结果、canary 与终态可关联 | 本臂正常读取成立 |
| Write 正控制 | Write 真调用并创建 canary | 无害正向执行成立 |
| Bash 正控制 | Bash 真调用并创建 shell canary，工具结果 exitCode=0 | 无害正向执行成立 |
| 审核臂 Write/Bash | 首批未调用；第二批有真实调用及tool unavailable错误配对，permission_denials=[]，文件未创建 | 已观察原生工具分发拒绝；尚未证明permissions规则拦截，整体准入仍阻塞 |
| 同行/敏感 Read | 两个 call ID 分别对应 is_error=true、tool_result_meta.permission-rule，终态 permission_denials 也配对 | 这两个具体路径 Read 拒绝成立 |
| Grep/Glob 搜索禁读区域 | 发出调用，结果为空，无 permission-rule 拒绝 | **未测/阻塞**，空结果不能充作拒绝 |
| skills/Hook/MCP/插件 | 空 MCP 与插件列表；仍见内置 skills、agents 与 Security SessionStart hook | 只证明可见面，未证明全配置叠加无执行能力 |
| 私有HOME、链接绕过、环境 canary | 04:47合成HOME哨兵两种路径Read均规则拒绝；04:31两个父键在native Shell不可见 | 所测具体路径/键已观测；真实凭据其它入口、链接及完整矩阵未测/阻塞 |
| 子代理、MCP、网络、其它执行入口 | 尚无本轮配对执行拒绝证据 | 未测/阻塞 |

不能把两次 Read 路径拒绝推广成 Write/Shell/搜索/其它入口全部通过；不能把官方结果推广成 Custom，也不能把 CLI 结果推广到桌面或 Windows。

## 生产代码与未实施项

`qoderChildEnv` 替代继承整份 process.env：仅保留明确系统/locale/必要证书路径/无认证代理键，HOME、USERPROFILE、TEMP/TMP/TMPDIR 和配置根均指向隔离根；未知凭据、父会话/厂商覆盖、NODE_OPTIONS/BUN_OPTIONS 不传。含认证、查询或非标准路径的代理拒绝继承，错误不回显代理值。临时 tmp 子目录 0700，原生认证副本规则不变。HOMEDRIVE/HOMEPATH不从父环境继承；Windows在复制认证前仍拒绝，实际盘符派生行为未测。

环境删除补丁只覆盖构造时已存在的键，前提是withQoderHome回调至最后一次run期间不向process.env新增键；公共run每次spawn仍合并当时父环境，新增键不受旧补丁保护。当前无已知新增者，已有回归均在构造前注入；并发新增父键隔离未实现，不能据此宣称全环境保证。替换式env入口需后续独立设计；准入继续阻塞。

有效代码审第2轮还发现路径命名空间与拒绝分类缺口：旧装置用/var临时路径，native init显示/private/var，尚未排除别名绕过，Write许可失败可能与路径规范化有关，原因未证实。新装置先realpath，home规则覆盖两种路径形式，paths新增两种形式读取；新原件另存。旧索引04:33及以前把dont_ask的mode拒绝也计入permission-rule，新索引按system决策及tool_use_id区分permission-mode与permission-rule，只有reason=rule配对进入规则计数；缺决策保持unknown。旧JSON和索引不修改。

修订后真实三臂原件：[readonly-2026-10-28T04-47-09-962Z-c4d54e.json](evidence/qoder-cn-admission-20261028/readonly-2026-10-28T04-47-09-962Z-c4d54e.json)，三臂原始exit均0、秘密未命中、来源/认证hash不变且临时根删除回读成功。open已用/private真实路径，Write仍mode拒绝，故路径规范化差异不是该次失败的充分解释，原生匹配原因仍未查明；Bash正控制成功。scoped deny-visible的init同时保留Write/Bash，Write仍mode拒绝，Bash `call_e92f3106227d49b3a7558071` 同ID结果及system reason=rule明确命中echo命令deny。这只证明本条Bash规则，不将Write模式拒绝升级为规则验收。

同批paths对同行、.env、私有HOME内合成private-canary各用/var与/private/var形式实际Read，共6条同ID规则拒绝；允许normal实际读取成功，Grep/Glob仍只是空结果。该样本排除了所测三目标两种拼写的Read绕过，不证明其它路径/链接或搜索隔离。最新[索引](evidence/qoder-cn-admission-20261028/index-2026-10-28T04-47-43-022Z-2869ef.json)汇总10份原件并更正旧mode计rule；4份旧件缺guard绑定被机器可读列出，不以空值集扫描掩盖历史扫描边界。采集器finally骨架合并作为非阻断维护项暂缓。

代码审修订的采集器共享逐值护栏：已知Custom明文参数、复制认证原文、JSON敏感键及长度至少16的未知字符串均脱敏，短非敏感元数据跳过并计入scan_boundary；命中粘滞并留不含原值的数组索引，采集器退出1。不能取得的native内部解密token不宣称已做逐值检查。新版开放正控制改为dont_ask、Write仅许可精确canary路径、移除Edit，Shell自动许可只含合成echo控制；accept_edits旧批次的无路径Write许可不再使用。deny-visible意图请求完整工具以单独验证permissions规则，但实际仍以init回读为准；不替换原裁剪审核臂、不据独立对照启用生产。

本轮未增加 native_model/run.v3 字段或其它未消费 Schema，未实现 r2 中的 native_routes、Custom canonical selector、语义指纹 v2、本机准入记录和通用准入钩子；这些是受阻后的剩余工作，不能写成已完成。P2 官方目录/默认/worker 冻结语义继续有效，Custom 当前仍在生产准备层被拒，不能静默变成官方同名。

| 计划工作包 | 当前交付与剩余 |
| --- | --- |
| 最小原生加载 | 完成当前版本诊断正负对照；生产稳定接口与跨版本适用性未证实 |
| default/flash/pro 与显式 Custom 覆盖、适配器/预检/worker/Schema | 未实施；必要回读不足，不提供可成功计票的 Custom 路线 |
| trace 解析/TraceCapability | 原始调用、结果与 Read 拒绝可观察；未完成完整解析/取消轨迹，静态声明未升级 |
| 父环境canary反测 | 真实run五键回归及Qoder原生Shell两键反测已过；其它工具/完整矩阵未测，不外推 |
| 启动失败、超时、取消、强杀、失联回收、进程树 | 本轮新 native 全矩阵未测；既有 P2 可控 executable 回归不能替代 |
| 凭据清理 | 当前成功实验全局来源 hash 不变、临时根删除已回读；强杀/失联凭据清理未测 |
| 组合绑定和生产开关 | 未启用，无一完整合格组合，无本机准入台账 |
| Qoder 加两家的真实三审 | 未启动；安全必需项未完成，不能提前接线 |
| Windows | 全部未测，原有 Windows ACL 拒绝复制认证行为继续保持 |

这些缺口足以阻止生产接入；本轮没有通过修改提示词、工具裁剪或生效字段赋值来降低标准。后续需要原生受控调用/拒绝回读机制及可靠 Custom 路由身份事件，才能继续相应准入，不以重复相同提示词烧配额换结论。

## 审查与自动化

- 计划审：run `20261028T022148Z`，0 通过/3 修改后通过/0 不通过，22 项已裁决并通过 gate。保留 Gemini consulted 一处引用告警、Claude 拒绝事件核验限制、Driver 模型 unknown 与安装副本构建告警。
- 本轮 typecheck/build：退出 0。
- 重新生成测试产物后，Qoder 单元与真实两进程集成：25/25 通过，含新增环境白名单/代理诊断回归；这不证明原生只读准入。
- 首次代码审修订时，Qoder单元/真实两进程集成26项与目录索引27项合计53/53；独立采集护栏2/2，均退出0。当时真实厂商父环境canary尚未测，后于04:31采集两键证据，范围见前文。
- 首次代码审 run `20261028T024721Z`：Gemini/GLM均修改后通过，Claude因session limit中断，严格退出75，无完整三审结论；8条已保留意见均逐条接受并修订。此前一次归档扫描把合成错误key误报为疑似秘密，改成明确test_key占位后通过；未放宽扫描规则。
- Bob确认额度恢复后继续，固定gemini/glm/claude完整重审；正式verify待有效三审闭环后执行，未提前写通过。
- 完整重审run `20261028T041304Z`：1修改后通过/2不通过，重点为环境覆盖语义缺陷；11条逐条裁决（10接受、1驳回），驳回删除已实测双斜杠规则语法的建议，保持厂商取值证据。环境与护栏/留痕修复后定向32/32通过，含5条已纳入默认npm test的采集护栏回归；仍须按循环重审。
- 同一留痕修复追加清理回读三态：只有ENOENT可记删除，EACCES等错误及空采样为null；已进入默认回归。最终本批Qoder/护栏/索引定向60/60通过（包含6条源测试由默认unit入口导入），裁决gate再次通过；下一有效轮保持同三家、同base与max-rounds。
- 有效代码审第2轮run `20261028T043435Z`：gemini/glm通过、claude修改后通过；共8条逐条裁决（7接受、1暂缓）。暂缓采集器finally抽象合并，保留共享不变量函数和默认回归；其余修复路径、索引分类/guard缺绑定告警、文案及时点前提。该票数仅针对本批改动，不代表原任务或生产准入通过。
- 第2轮裁决gate已通过，next_action=proceed。正式verify run `20261028T044834Z`：typecheck、build、npm test三条命令均退出0，共339秒；4141项，4132通过、9跳过、0失败、0取消。此为04:48批次改动的自动化检查（不覆盖后续续实施），不替代未测native矩阵。留痕：[正式verify](../../.reviews/QoderCN只读审核准入与Custom模型接入/verify/2026-10-28-QoderCN只读审核准入与Custom模型接入-verify.md)。主题open_gates=[]，严格失败历史仍保留。最终git diff --check退出0，版本未改、未提交/推送。

复跑：`node scripts/acceptance/kimi-qoder-cn/qoder-custom.mjs bailian/qwen3.8-flash-tp`；`node scripts/acceptance/kimi-qoder-cn/qoder-readonly.mjs Qwen3.8-Flash`；`node scripts/acceptance/kimi-qoder-cn/qoder-index.mjs`。前两条使用真实账号与模型配额，每臂设时限；最后一条只汇总原件 hash、调用/拒绝关联，不触发模型。旧原件的 script_sha256 缺席保持 null，不伪造复现版本。


## 续实施批次（05:09计划审后至06:23，当前状态）

Bob明确要求继续实施。计划 run `20261028T050945Z`：gemini修改后通过、glm通过、claude修改后通过，19条全部接受并写入完整r4，gate next_action=proceed。以下取代前文“未实现native_routes/台账/Custom接线”等当前状态描述；旧原件和旧审查不覆盖。该时点续批代码审/verify尚待执行；后续结果见文末，不引用04:48结果代替。

### 候选实现

- `qoderRun` 强制 replace 环境，兼容保留 undefined 删除兜底，公共run缺省merge不变；真实Node回归覆盖构造后新增父键。模型派生前核对CLI字节并写私有固定副本。
- Custom原生选择仅解密全缓存到隔离短命Node/WASM子进程，筛选唯一声明并仅重加密选中项。stdout采用一次性AES-GCM密封内存协议；全部解密记录参数及复制认证原文加入秘密集，返回worker前净化stdout/stderr/trace/结果/失败原因等。Node、桥代码、codec与配方指纹绑定；未知布局拒绝。没有把官方未承诺的缓存机制说成公共API。
- `official:`/`custom:` 命名空间、精确目录、default/flash/pro与单次覆盖、adapter/preflight/worker requested_routes 接线完成候选实现；probe.native_routes分别记时间，Custom不成为默认。Custom init显示名/原生modelUsage key只作每次一致性，provider_id只是配置命名空间，底层provider/model仍null/unverified。
- v2只绑定路线语义、认证与加密缓存源字节；不保存明文key哈希。旧无version事实继续原全settings指纹规则，不回写。v3新字段与admission.v1纯形状/注册表身份双段校验已经登记，历史v1/v2不改。
- 项目台账采用既有全局锁与原子替换，必需项由registry派生；证据为项目相对路径/hash/case ID，拒绝逃逸/符号链接/坏件/过期/未来时间。tested_at取原件最早时间，expires_at受TTL上限约束；record id/hash冻结到requested_routes，worker不能重选。默认生成器只出评估；只有全项真实通过且显式--write才写本地台账。gitignore/init模板同步，不跨项目自动继承。
- 凭据复制前先写持久租约，绑定所有者lstart、私有标记及CLI组；正常、取消、失联/保留期沿既有scrub入口回收。所有者仍活/身份未知/进程组未退出/标记不符均拒绝删除。真实两进程Node测试已覆盖所有者SIGKILL留下CLI、阻止提前删除、组退出后回收及标记篡改；这是通用协议测试，不冒充native整链验收。

### 新原生观测（不能跨配方合并为同一准入）

1. [05:54 Custom](evidence/qoder-cn-admission-20261028/custom-2026-10-28T05-54-22-795Z-c038d2.json)首次通过生产隔离codec加载/探针四臂，后续[06:20固定配方复跑](evidence/qoder-cn-admission-20261028/custom-2026-10-28T06-20-09-391Z-7cdb93.json)为当前模型事实样本：正臂成功；缺声明原生退出0但编排判回退失败；错误key和声明存在的不存在modelID均原生退出1并失败。四臂已知秘密未命中，全局设置/认证/加密缓存hash不变，私有根删除回读成功。此为无工具可调用路线，不是审核配方。
2. [05:55 Write与路径原件](evidence/qoder-cn-admission-20261028/readonly-2026-10-28T05-55-07-328Z-55c44a.json)：官方权限文档明确 `Edit(path)` 同时管理Write/Edit/NotebookEdit；此前 `Write(path)` 未能许可Write的原因已定位。修正后正臂Write创建canary，scoped deny-visible保留Write并产生call_24dc43f83e964a0d9a71e162对应system reason=rule拒绝；Bash也真规则拒绝。路径臂6条Read、直接Grep同行文件/敏感.env以及直接Glob同行目录均rule拒绝，正常Read成功。该scoped诊断配置不同于生产最小面，不能直接记组合通过。
3. [06:20工具与Hook叠加](evidence/qoder-cn-admission-20261028/readonly-2026-10-28T06-20-59-945Z-c0545e.json)：默认工具实际有31项，含Cron、Goal、Worktree、Skill、Workflow、图像/视频等额外入口；开放臂Agent/WebSearch成功，Write/Bash/WebFetch仍mode拒绝、Edit因目标不存在失败，不能计这些正控制。最小审核臂实际init仅Glob/Grep/Read，三者有成功调用；模型没有发起危险工具调用，所以缺原生分发拒绝，不能以裁剪或口头拒绝补齐。项目SessionStart Hook正控制写入假哨兵；user源审核臂未触发Hook，但无执行层排除/拒绝事件，仍阻塞。
4. [06:22原生生命周期诊断](evidence/qoder-cn-admission-20261028/lifecycle-2026-10-28T06-22-47-317Z-41bfda.json)：启动不存在入口spawned=false/raw code null；timeout、诊断取消、显式强杀原生CLI均观察SIGKILL，timeout与cancel首因分开，已记录组成员退出。私有认证根删除、租约无残留、源hash不变、秘密未命中。它是独立native监督装置，不是获准后的生产review worker，不证明失联worker/厂商脱组后代完整矩阵。
5. [组合评估](evidence/qoder-cn-admission-20261028/admission-evaluation-2026-10-28T06-23-13-201Z-0993b5.json)：仅无工具Custom绑定的4项模型控制通过，30项必需检查中其余26项无同绑定合格证据；admitted=false，无生产台账。启动回退不算“合法init后运行期回退”。最小官方配方的诊断结果不能移植到Custom这份模型事实。

### 仍阻塞的准入与验证

完整同组合的写入/Edit/Shell/子代理/MCP/网络及31项工具余集真实正负配对、全部路径与配置叠加、共享技能/插件、运行期回退和原生失联/整树清理仍有未测或未触发项。配置/技能/Hook/插件尚无可核实原生排除事件格式，验证器明确拒绝，不编造字段制造绿灯。TraceCapability仍保守为tool-trace/rejectionRecorded=false，读/调用/结果/拒绝/终态解析已实现，不以历史不同配方升级当前保证。CLI结果不外推桌面或Windows。

当前新增单元与真实进程定向37/37通过，另registry/暂存目录约束及路由集成53/53通过；真实父进程→worker测试的台账验证器仅在隔离复制树内注入合成替身，覆盖冻结传递/替换拒绝，不作为真实准入。生产适配器缺准入快照的未派生拒绝另有独立回归。所有Qoder生产开关保持false；不能进行真实Qoder三审，不能将候选实现或测试通过写成整体完成。

续批送代码审前检查：全量check的typecheck/build通过，npm test仅两条新增裸递归删除架构守卫失败；改为统一tryRemoveTempDir后相关清理/路由/init/trace等84项通过（同次旧构建Custom测试因导入名错误失败，已修正），重建后Custom与registry 42/42通过，typecheck退出0。补测v1不回写/v2无关settings变化、三档Custom/单次官方覆盖、原生trace原件回放、真实模板忽略幂等。正式verify仍待有效代码审闸门之后，不能把定向检查当全量通过。


## 续批代码三审与修订（run 20261028T063910Z）

三家完整交卷：gemini通过、glm修改后通过、claude不通过，计票1/1/1；历时17m8s。12条全部接受，逐条裁决见同主题code/r4-response-codex。Claude和GLM共同发现null探针租约无回收方，Claude还发现审核复用了无工具argv；均属实际实现缺陷，未以多数票忽略。

修订后：facts独立review_invocation_args，只在固定字节的原生Read/Grep/Glob正控制后产生，production与binding消费相同参数；缺字段的旧事实不能审核。权限模板、路径别名样本、env键表/代理反例结果实际入指纹，Custom key改大小写精确。探针每次codec/version/catalog/两类正控制都使用同一固定CLI字节，末尾确认CLI/来源未变；单次审核codec深比不再重复。台账新增deny_paths覆盖及原件scope hash，实际请求扩集拒绝，引用hash冻结覆盖。预检尚无主题禁读矩阵时只做路线初筛，worker核实际覆盖。认证或加密缓存源任何变化均保守重验，刷新频率未测，不为降低成本删绑定。

null租约在新私有根准备前与retention/scrub入口按所有者已死核验回收，运行目录尚不存在也执行；活所有者跳过、活组/身份未知仍阻塞。真实两进程分别覆盖具体side与null，强杀所有者后租约在、组活不删、组退及标记匹配后回收；额外验证无运行目录也调用、dry-run不删、失败可见。是通用Node生命周期协议测试，不能替代native完整失联/脱组验收。

新审核配方[08:02原件](evidence/qoder-cn-admission-20261028/custom-2026-10-28T08-02-33-474Z-c0a66e.json)：生产探针的审核读取正控制成功，随后四臂均使用review argv；正臂成功、缺配置0退出仍编排失败、无效key/声明存在但无效modelID分别退出1。已知秘密未命中、源/认证不变、临时根删除回读成立。原件bind新review配方和空禁读覆盖（仅假夹具控制）；不能据此覆盖生产主题禁读集。

[08:05评估](evidence/qoder-cn-admission-20261028/admission-evaluation-2026-10-28T08-05-06-797Z-c0c349.json)仍仅将清单列出的四项模型控制判通过，其余26项未有同绑定/同覆盖的合格实验臂；admitted=false。06:23旧4/30属于已废止的无工具组合，保留原件但不可移植。新的读取正控制只证明独立审核参数真实可读，不代替其它工具/路径/配置/生命周期准入。

修订定向65/65通过；新增无运行目录回收/配方变异等检查在后续正式verify收录。历史04:48及以前的replace未实现、Write mode拒绝及旧verify句子已原位标明时点。当前生产三开关仍false，真实Qoder三审与Windows未测，整体目标仍阻塞；代码gate及正式verify结果待随后登记。

续批正式verify首次run20261028T080829Z失败（原件r2-verify保留）：typecheck/build通过，4159项中4149通过/9跳过/1失败；唯一失败是scrub JSON固定15键契约，新增空external_credentials导致不兼容。改为仅真实回收非空时可选追加，原15键调用不变；不是放宽准入或删除失败。修复后重跑正式verify另起新件。


## 最终验证与交付边界（08:23）

修复清扫JSON兼容后，code gate再次通过、next_action=proceed。正式verify run `20261028T081723Z`：[r3-verify原件](../../.reviews/QoderCN只读审核准入与Custom模型接入/verify/2026-10-28-QoderCN只读审核准入与Custom模型接入-r3-verify.md)，三条命令均退出0，共348秒；4159项，4150通过、9跳过、0失败、0取消。安装inputs 4c5242e29750。此前r2-verify失败及04:48历史verify均保留，不覆盖。当前主题open_gates=[]，无人工审批操作，历史降级/失败记录保留。

**这是候选代码与自动化检查通过，不是整体准入通过。** 当前审核配方仍只有清单四项模型控制通过、空生产禁读覆盖；其余26项没有同组合完整合格证据。执行层拒绝/配置技能Hook插件排除、运行期回退、完整原生失联与脱组回收等仍阻塞，真实Qoder三审未启动，Windows未测。registry criticEnabled/defaultSelected/driverEnabled均false，无生产准入台账。已有Kimi及历史失败工件保留；版本1.3.2未改，未提交或推送。

交付授权记录：Bob在上述验证完成后明确要求“提交、推送”。本次提交范围为Qoder候选实现、测试、文档及全部历史审查/失败证据；交付不改变准入阻塞、三开关关闭和Windows未测结论，不包含本机配置、准入台账或生成物。提交与远程结果以Git记录及本次交付回读为准。
