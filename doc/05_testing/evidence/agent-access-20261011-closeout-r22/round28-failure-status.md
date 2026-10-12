# 第28B正式失败及当前停点

2026-10-12，Driver=codex。run `20261012T044824Z` 于UTC04:48:36开始，05:33:37结束。Claude/Qwen flash、Gemini flash-high、GLM-5.3均首次尝试达到2700秒上限，正式状态failed，未生成任何有效审查意见；不能批准计划或进入本次r23补测实施。没有改写失败状态、补造裁决或借27C批准实施新计划。

正式原件为`.reviews/Agent双模式接入真实准入收口/plan/_meta/run-20261012T044824Z.json`及其6份列明工件。实际检查点见[round28-failed-checkpoint.json](round28-failed-checkpoint.json)：1839冻结文件变化0，6工件hash全部一致，git前后tree相同；全局plan闸门已回idle，无开放闸门，但run仍failed。`review --wait`退出75，`gate --check`退出2（missing_disposition）。全侧失败、没有有效意见，不写一份空裁决来恢复资格。未执行plan审批、未实施新guard/批次、未启动新准入样本。

原始轨迹与终态元数据分列：Claude实际有17个工具调用、init声明qwen3.8-flash，另有3个API retry（error_status=null、error=unknown），没有完整结论；Gemini实际完成过读工具，末尾ERROR为流式请求EOF，没有完整结论；GLM输出0字节，原因null。三侧终态元数据model_effective=null及project_reads=0保持，不能将部分原始轨迹变成有效审查或模型准入。尚无证据证明三侧有同一根因，也不能仅凭超时归因额度、配置或业务代码。未自动换模型、effort、版本、超时判据，未直接重跑。

预算实际完成数：准入734/742，正式审查CLI373/398。28B预检10启动（358→368），正式三侧5启动（368→373），均保留实际台账；内部API重试不是新的CLI进程启动。正式轮数28/29，28B已计入失败，原29C预留不能用于绕过尚未通过的计划。必要后续计划复审须依Bob已授予的按需轮数机制先具名登记、事前发布启动清单，再走同主题正式入口；本记录不代替复审或批准，不自行开始新的三审。

Bob本轮明确“不采用，保留当前未测状态”，拒绝消息/事件及实际消费者拒绝见[auth-decision-20261012-rejected](auth-decision-20261012-rejected/)。认证判据已拒绝，不再待决定；受限工具面候选也未采用。当前完整local `54f73dd6656da78fb0bd1ad2d5397535de9eaabb45639ecbc4f0fad4625bf749` 下原标准0通过/12未测；历史496的7通过/5未测及Qwen max/k3原Read false保留，原mode3停止批次不恢复。官方Claude仍未测，server_identity=null。

已安装runtime与四目标28入口仍等于当前源；七共享入口重新出现，当前再次正常完整安装受同名冲突阻断，恢复来源/操作者null，客户端解析未测。具体只读事实、备份/影响/恢复提案见[shared-entry-reappearance-plan-proposal.md](shared-entry-reappearance-plan-proposal.md)，未迁移或删除共享目录。完整迁移仍需对此次具体对象的明确批准。

检查点第一次脚本错误（项目triviumDir误作runtime根）见round28-failure-checkpoint-initial-error.json，源副本保留；修正仅使用现有生产runRoot/config和repoId定位实际原件，第二次复算成功，新增供应商启动0。当前检查点不重跑或冒称两次npm run check/14步自检；生产输入、bundle、历史测试的适用范围保持此前记录。M11第12步前置任务未完成。
