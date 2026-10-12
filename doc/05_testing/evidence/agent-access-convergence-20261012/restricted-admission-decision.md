# 本轮五组合受限准入与M11前置验收例外提案

状态：待Bob独立明确决定，尚未采用。实际材料见`remaining-evidence-audit.json`、`mechanism-batch.json`、各`mechanism-*-proof.json`和`portable-evidence-manifest.json`；原标准汇总为`summary-40fcbf94-09e7-49d5-892a-57b38e1d8f3f.json`。

## 本次可以作出的具体决定

仅对当前指纹下Claude路线的qwen3.8-max、kimi-for-coding、k3、deepseek-flash、deepseek-v4-pro五组合，采用既有`restricted-tool-surface-and-path-v3`机制作为本轮**受限准入**的依据，并明确批准一次M11第12步前置验收例外：七个原标准通过组合，加这五个受限组合，可以进入M11第12步。

这个决定改变本轮前置验收口径；不是声称原标准的12组合全部通过。原标准列、真实写尝试未测、历史Read失败、旧停止批次和旧失败审批记录全部保留。若同意，还需明确豁免**这次判据变更**的额外正式双审；此前的一般免双审及“继续完成”不自动代替此独立决定。

## 已有事实

| 组合 | 当前真实模型正向读取 | 当前受控机制 | 原标准真实模型写尝试 |
| :--- | :--- | :--- | :--- |
| Claude / qwen3.8-max | 通过 | 通过 | 未测 |
| Claude / kimi-for-coding | 通过 | 通过 | 未测 |
| Claude / k3 | 通过 | 通过 | 未测 |
| Claude / deepseek-flash | 通过 | 通过 | 未测 |
| Claude / deepseek-v4-pro | 通过 | 通过 | 未测 |

真实正向阶段均取得实际Read、首词、完整结构化交付、实际模型、只读工具面和default权限模式；配置/请求/CLI回读与服务端身份分列。受控阶段经同hash包装器及native CLI实际执行，两种写请求、六目标逐项Read/Grep拒绝、合法README读取、唯一ID与权限配对、前后文件状态、完整Schema和四项资源清理均通过，并与PID/lstart/实际映像及启动台账配对。已在清理后从原始证据重新计算全部五个proof。

新增12次启动：真实来源7次、受控CLI5次；累计admission795/815、review373/398，没有重试或新增正式审查。此前七成熟组合仍按完整当前指纹通过；正常四目标28入口安装及安装副本14/14自检已完成。

## 必须接受的证明边界

- 受控阶段由本地传输注入调用，`actual_provider_inference=false`、`real_model_attempt=null`、`server_identity=null`；不证明这些模型会主动发起写调用，也不证明上游或未来行为。
- 使用独立临时HOME、假凭据及本地HTTP；唯一CLI inline差异是在原deny数组保持精确顺序和内容的前提下加入`permissions.defaultMode=default`。不是生产settings字节完全相同的重放，工具面/实际权限模式与本轮真实正向样本另行对账。
- 对Qwen max、k3历史真实Read负臂false以及当前缺失的真实负臂，受控Read/Grep只能证明路径拒绝机制；不把旧失败改成通过。
- 此例外只改变本轮验收报告及进入下一阶段的授权；不修改产品guard/gate/hooks、canonical原标准汇总或全局模型配置，不开启旧认证复用，不把现有“候选报告消费者”冒充产品准入开关。
- 只适用本批五个精确模型、Claude CLI 2.1.296、当前完整来源与`mechanism-batch.json`的全部hash。任一来源、配置、CLI、模型或工具面改变，先复核或重测；不自动延伸至未来版本。认证时间戳也不作例外复用。
- Claude官方仍因订阅未恢复而未测；其他仓库依赖完备性和客户端实际入口解析未测，不因本决定变成已测。

## 两种明确后果

1. **批准受限准入、M11前置例外及本次判据免审**：据本批证据记录“7原标准通过 + 5受限准入；按用户明确例外允许进入M11第12步”。原标准全量完成字段仍为false；M11第12步本身仍需另行真实执行与验收。
2. **保持原标准**：继续记录7通过/5未测，M11前置未完成；没有新的真实生产取样机制就不再付费换提示。受控成果作为诊断保留，不采用本提案。

用户可随时撤回本次例外；届时回到第二种状态。记录用户实际答复与提案hash，不写入虚构的正式审查或plan/code批准，不调用`trivium approve`。
