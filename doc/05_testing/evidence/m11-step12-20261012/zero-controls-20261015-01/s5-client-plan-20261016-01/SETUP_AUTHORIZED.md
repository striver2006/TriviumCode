# 本地setup已获授权，等待Bob系统终端执行

2026-10-16（Asia/Singapore），Bob明确指令：“批准两个新夹具的本地 setup，厂商增量为 0；不启动客户端、不做故障注入。”

[setup-authorization.json](./setup-authorization.json)绑定原preparation与proposal-manifest指纹，授权两个具名夹具各一次正式init及已展示的采集wrapper安装；不是Trivium审查闸门审批，也不授权客户端、故障注入、提交推送。[只读核对](./setup-authorization-check.json)确认18个原操作包文件未变、原工程/完整副本/备份各141文件一致，空夹具/备份各18文件一致，预算838/401，实际setup执行次数0，退出码均null。

原README与操作包已按hash冻结，其中“未授权”描述保留为准备时快照；当前setup授权以此文件及新回执为准。不要修改原README、脚本、manifest，也不要重跑旧validate（它验证的是未授权状态）。

根据Bob先前明确要求，受保护路径修改仍由Bob系统终端执行。先执行第一段：

```bash
S5_PLAN='/Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-step12-20261012/zero-controls-20261015-01/s5-client-plan-20261016-01'
/opt/homebrew/opt/node/bin/node "$S5_PLAN/setup.mjs" archive
```

仅当第一段成功退出，且最后输出包含`"setup":"archive","ready_for_client":false`，才执行第二段。setup内部已经对正式init结果逐文件核对；不能只看前面init输出的`ok:true`就继续。

```bash
/opt/homebrew/opt/node/bin/node "$S5_PLAN/setup.mjs" empty
```

第二段预期成功退出，最后输出包含`"setup":"empty","ready_for_client":false`。两个夹具保持原有/标准Hook全集，采集wrapper为755。真实结果保存在setup-<名称>-before/init-result/standard-wrapper/after及新根calls回执中，以回读为准。

任一段报错立即停，不重试、不继续另一段、不自行修wrapper。保留现场和回执，再只读核对原因；如需回滚，使用原README给出的用户终端恢复步骤，先确认相应客户端已关闭。当前未发生任何初始化或漂移，无恢复操作。

完成两段后停止，回复“已完成”。不要启动或恢复客户端，不执行checkpoint、fixture-step、任何Hook或故障注入命令。5.2～5.5仍为客户端未测，后续启动预算需独立核定。
