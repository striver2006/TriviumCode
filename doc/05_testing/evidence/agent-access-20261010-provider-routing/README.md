# Claude 项目供应商配置调整

用户授权暂时只使用 Qwen、Kimi、DeepSeek。项目 default/flash 使用 `qwen3.8-flash + qwen`，pro/high 使用 `qwen3.8-max + qwen`，无 effort 默认值。Kimi 与 DeepSeek 使用现有 `--profile-claude` 和匹配的 `--model-claude` 参数；未新增供应商档位表。官方实现和离线测试保留，项目默认/pro 不使用官方，失败不自动回退。

`before.json` 保存当前 CLI 入口、二进制、包装器、profile 指纹与全局文件哈希；Qwen 已通过的原批次证据仍匹配。`resolved-config.json` 覆盖 default/flash/pro 三阶段，`explicit-routes.json` 覆盖三供应商的显式选择。`rollback-fixture.json` 是独立夹具故障注入，两文件恢复后哈希匹配，不宣称生产配置真实故障。

`run.mjs` 仅执行项目编排器 preflight，复用原预算模块和侧车。先预占再启动；版本、失败、超时和包装器子进程均计数。`approval.json` 记录已有额度授权和本次配置授权。四组预检通过：默认 Claude/Qwen、Gemini、GLM 三审，以及 Qwen pro、Kimi、DeepSeek 单侧实际组合；原始输出在 `calls/`。实际预占与完成均 28/40，正式审查 0/0。旧原始预算48/48、准入100/100、正式审查29/40原件保留、不清零。

Claude 2.1.295；Codex 0.162.0，旧doctor缓存0.160.1仍只作未选审核者告警，不追改为已测。Driver模型未声明、Claude完整服务端模型目录未知，预检告警继续。CLI启动次数不是服务端请求数或费用。

本机移除两审覆盖后有效默认集合为 Claude、Gemini、GLM。这里只证明恢复后三审预检与探活通过，未启动正式三审全文审查。Kimi/DeepSeek生产同形写负对照仍未测，独立权限诊断不替代它；官方真实验收待订阅恢复。七条全准入仍未完成，不能进入M11第12步。

全量检查、自检、重装及安装副本核对结果保存到 `check-*.json`、`selftest.json`、`install.json` 和 `final.json`。版本号保持0.1.0；本批配置变更未提交、未推送。
