# Bob拒绝认证复用后的必要真实刷新（并入28B，不新增轮次）

Bob本轮独立答复“不采用，保留当前未测状态”，精确消息、拒绝事件及实际消费者关闭验证见auth-decision-20261012-rejected/。原6a2/四跳/27臂提案保持历史，未采用且今后不会自动扩大或重新提请认证复用；正常预检的时间刷新如实记录，但不据此提升历史证据。

本补充与r31原稿一起构成28B完整当前合同：原七整改、原mode3谓词/Schema/HTTP/清理边界不变；受控五组合仍各一次、任一失败停后续。新增的是用户原任务要求的必要当前能力刷新，不改配方、判据、模型、effort、CLI版本、产品guard或用户全局配置。

## 必要新增启动清单

认证复用已拒绝，当前完整指纹下没有可计入的旧能力臂。只刷新曾成功的七组合22臂及其余五组合正向read共27臂；五Claude生产写因生产未注册工具面仍无可行取样机制，不重试这些被assertProductionArm拒绝的臂，也不重复Qwen max/k3已无实际Read尝试的负臂。旧通过、false和停止保持。

| 路线×实际历史模型 | 原配方当前刷新 | 能解决的缺口 | 预计/硬启动 |
| :--- | :--- | :--- | :--- |
| Claude/qwen3.8-flash | read、write、deny-read、deny-grep各一次 | 当前完整指纹下完整四臂，要求实际调用/配对/交付/状态 | 4/12 |
| Codex/gpt-6.1-sol、gpt-6-luna、gpt-6-astra、qwen3.8-flash、kimi-for-coding、deepseek-flash | 每模型read、write、deny各一次，共18臂 | 当前读取全文/精确目标、真实写尝试配对状态和事后禁读检测 | 36/54 |
| Claude/qwen3.8-max、k3、kimi-for-coding、deepseek-flash、deepseek-v4-pro | 各read一次，共5臂 | 当前正向A，并成为本新批次受控B的具名live来源；不补原C | 5/15 |
| 三Claude profile及Codex原生/三profile | 7个静态version臂各一次 | selectedVersion必须的同当前完整指纹/profile/native来源 | 11/21 |
| 五Claude受控mode3 | 原配方各一次，顺序Qwen max→k3→Kimi coding→DS flash→DS pro | 单列候选B；不证明provider/model真实尝试 | 10/15 |
| Claude官方 | 0 | 订阅未恢复，未测 | 0/0 |

正常版本刷新不重复取help；机制参数仍读现有实测探针。正常预检若发现版本、来源或配置非时间字段变化，停止当前批次，不自动升级/改探针或追認旧CLI能力。27真实能力臂使用现有scripts/agent-access-closeout.mjs、recipes/evidence/selection/write-contract和r2薄入口；不改这些已审源文件，不手调供应商CLI。Codex read/write既有独立合同、原精确判据、所有guard及失败留痕保持。

## 顺序、预算及拒绝边界

28B批准后在独立r23增加本次具名production-refresh-dispatch.mjs及不可变manifest/selection，沿用既有once-only调度和预算wrapper，仅绑定28B实际批准/来源/完整指纹/具体34项jobs/输出/claim/累计预算；它必须在任何供应商spawn之前拒绝旧计划、旧selection/版本、重复/已有输出、未知组合或禁止生产写、缺来源、未完成账本和超限。未知内部错误继续抛出，失败保留已取得成果并完成清理，不新增重试或回退旧成功编号。批次选择仅具名实际result/request/fingerprints-after完整hash，版本profile分列，不以同物理CLI推断完整profile指纹适用。

完成新绑定与定向验证后，先做29C正常preflight，再按实际当前完整指纹发布7版本+27能力的34项清单。当前准入基线734，预计56/硬102，累计最坏止836；事前将池742按既有扩容授权追加至851并记录原因，达到批停线立即停止。真实批次失败时停止后续，不用正确答案替代实际读取、文件未生成替代真实写调用，保存未完成行；没有自动重试。五个新正向A结果须全合格才开启五项受控B，否则受控候选仍未测。

五受控B的before必须取34项批次实际完成后的准入台账，不硬编码734；预计10/硬15，batch_stop=实测before+15、pool_limit=851，最坏总止851。本次r31中734→749/+7只是拒绝决定之前的预算建议，现由本段取代；不得同时消费两份批次。守卫/批准reason具名两批数字及新一次性许可，仍不授予旧停止批次恢复或任何判据采用。review28B仍before358预计15/硬20/止378，池398；29C另按实际基线发布预计15/硬20的清单，不混入准入池。

production刷新在受控B之前；新measurement/proof/fixture只消费本批当前五正向A的init/模型/profile/settings/Schema/包装器/native全来源，明确不是历史认证复用。所有版本、源码/模块/入口/安装、全局/profile和完整项目配置必须在批次前后逐项相等。期间如任何外部变化或必须正常刷新认证，停止，不调TTL/恢复时间，不循环追加版本或第三配方；提供本批已取得与未测的精确结论。

全部新事实、静态审计、脱敏扫描、报告及当前矩阵在29C冻结前落盘。29C仍从原39ed205完整作用面重审，普通code批准后才能交付新实施；受限候选如具备推荐条件，再给Bob精确能/不能证明的独立决定。认证候选本轮明确拒绝，不再处于待审批；当前未测保持直到实际新证据取得。新清单尚未实施或扩准入池，28B正常preflight/正式审查仍须依正式入口完成。
