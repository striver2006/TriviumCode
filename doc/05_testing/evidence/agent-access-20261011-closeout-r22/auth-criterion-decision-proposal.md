# 认证时间戳证据适用性：独立判据决策

建议单独采用auth-cache-timestamp-applicability-v1，只对本文件及auth-criterion-decision-scope.json具名的27份历史来源臂建立当前指纹下的“经批准复用”报告列。现状态为待Bob另行明确决定，没有实际criterion批准，不能计为当前通过。

正式26B计划run20261011T200004Z及完整r30已批准；最终定稿SHA为9c457711d4146644d9dedd976cbdf854128283df0802ddf32ba6f4bc0cf75d5c。完整27C/code run20261011T212239Z三审有效、零漂移，3条minor/nit已2暂缓1驳回并通过gate；按Bob普通委托批准。裁决SHA为66dd93befe3bb878e76b95ad79e5b335c44e6c0351c4719615b488ef0461d436，实际普通审批原件见code27-approved-checkpoint.json。普通委托不含本项判据采用。

具体证据：auth-diagnostic-after-code27.json，SHA ad95160cf68a5cc9d9fb33e8dbe1178a709711d5cc73afc75f0fa17491a63514。采用实际已审核的replayAuthTimestampEvidence重新核验4个显式hop、27臂、378组件、91引用及6份配置消费来源；latest_review绑定第27次实际成功运行，最新受控原件绑定Qwen mode3副本，完整生产N=6重枚举，泄漏/实际拦截失败均false。受控模式适用性字段保持保守false，不以这份认证诊断提升机制准入。

旧完整配置496eed89fe1daf113196ea7a304831e47740432d3b9437f5850e56a1877249a7，当前完整配置6a2c6213ad3d62cb5f33f42480c90c40311bf6e35a4fb6d3080ce9afe84a79a5，路径为496→fb64→c5b4→b40→6a2。每跳来源普通文件/hash实核、端点连续无环、三具名auth_routes.checked_at严格ISO递增/旧新ok=true；除此以外所有原值含凭据相等。反向重建完整旧hash，私有0600副本删除，Buffer清零；重建不称原样本。CLI版本仅历史实测加当前同native hash，不冒称本轮重新运行版本命令。

具体作用面（每份原件路径/hash均列于JSON，不授予整路线无限复用）：

| 路线×历史CLI实际模型 | 具名历史臂 | 可复用边界 |
| :--- | :--- | :--- |
| Claude×qwen3.8-flash | read/write/deny-read/deny-grep | 旧496完整通过能力，仅这4臂 |
| Claude×qwen3.8-max、kimi-for-coding、k3、deepseek-flash、deepseek-v4-pro | 各1份read | 仅旧生产正向，不能补负对照或全组合准入 |
| Codex×gpt-6.1-sol、gpt-6-luna、gpt-6-astra、qwen3.8-flash、kimi-for-coding、deepseek-flash | 各read/write/deny | 旧496六组合完整通过能力，仅这18臂 |

精确scope摘要为6d8b5e7314e38660ffa823c5dc6276964f660ab856659c1a6e128ea8027b6c2a。该scope每项含route/model/arm及原result和本次诊断两个hash引用；拒绝省略、替换、重复或扩大作用面。JSON中的scope摘要是作用面摘要，不是完整JSON文件hash。

具体消费者为r21/criteria-consumer-v3.mjs，version candidate-consumer-v3，SHA aa760fac18d22677739e39e888fc8b0e9087d0b38ddf6e455aba5f9646fd53cb，并固定15项依赖hash。它先核独立用户原文、plan/hash、批准/撤销/完整事件目录及全对象摘要，再重验全部来源事实、当前完整指纹和scope，最后复核状态机。调用方sourceFactsVerified不能开门。采用后须实际运行消费者确认candidate_report_consumable；未知或任何不一致不消费。实际独立批准的正向端到端消费当前未测，普通模拟单元测试不代替本次执行。

能证明：在列出的本机CLI/配方/源模块/入口/安装bundle/全局及profile配置等hash均一致时，完整项目配置的唯一变化是这4个已列认证时间戳刷新；因此这些历史能力证据可以在当前6a2指纹的验收报告中作为“经批准复用”单独展示。

仍不能证明：认证成功等于能力重测、服务端身份/上游版本不变、未来行为、任何未列模型/臂/文件形态。不能填补5组Claude生产写负对照、Qwen max/k3原读取false、未启动k3受控样本、官方Claude订阅、客户端重名解析或其他仓库依赖。原canonical0通过/12未测、旧7通过/5未测、原false/未测及原停止记录保持；不重写历史、不开产品生产消费者、M11前置仍未完成。

撤销/关闭条件：Bob撤销或拒绝；独立原消息、事件清单、scope、consumer或15依赖hash变化/未知/冲突；任何实际源码/module/bundle/安装/native/CLI/profile/model/effort/TTL/凭据等非时间值变化；当前完整配置不再是上述6a2或新增未列hop；原件或生产N/安全事实缺失、损坏、软链、漂移；任一泄漏/实际拦截失败或未知。今后另有认证刷新须显式新诊断及符合独立授权的来源，当前批准不自动扩展未来hop，即使实现长度界为1..32。

决定记录须保存Bob本次实际回复原文、来源/hash与作用面引用，不由普通自动审批生成。若采用，仅本认证判据生效；restricted-tool-surface-and-path-v3仍未采用，原停止批次不恢复，不包含新增正式轮数/模型配置/守卫实施或提交授权。若不采用，本方案保持未采用，列出必要实际重新取证清单，绝不把旧证据自动追认。
