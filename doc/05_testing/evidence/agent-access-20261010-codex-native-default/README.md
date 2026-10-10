# Codex 项目默认切官方 native（2026-10-10）

用户要求“codex默认使用官方配置”。本仓 agents.codex.profile 显式 null，default/flash/pro 三档的 plan/code/bug 均为 gpt-6.1-sol；合并本机配置后九格均匹配。产品内置默认不变，第三方仍可单次显式指定接入与匹配模型；Claude 配置及审核者集合不变。软件版本保持 0.1.0。

- `baseline.json`：改动前项目配置、CLI、全局配置/登录文件 hash；项目配置备份位于独立 0700 临时目录，副本 0600，不把全局配置内容写入证据。
- `approval.json`：40 次初始启动上限、最小补测安排及用户按需扩容授权。
- `launch.mjs`：复用既有编排器预算入口、侧车、脱敏与扫描；只允许 doctor/preflight，不启动正式审查。
- `doctor-summary.json`、`readonly-summary.json`：原生路线 doctor，版本 0.162.0、读取成功、home_copy 隔离、read-only 沙箱；实际写命令和操作系统拒绝的正对照成立，breach.txt 未生成。0.160.1 缓存不复用。
- `calls/`、`loaded/`、`ledger/admission/`：请求、装载、逐次预占与结束；包括 Node 包装器和底层入口，启动数不等于服务端请求数或金额。
- `extension-1.json`、`extensions-by-key/`：首次预检认证子进程在 40 次上限被拒绝启动；原件保留，按用户已授权通过既有预算模块扩容至 64。
- `preflight-summary.json`：第二次官方路线编排器预检通过，覆盖三个阶段；其 Driver 未声明模型的告警保留。这是诊断预检，没有发起审查或审批，日常 Driver 仍为 Codex。
- `global-drift-observed.json`：doctor 期间全局 Codex config.toml 内容 hash 漂移，mtime=03:23:34Z，原因未确认。本轮没有手工编辑该文件；官方基底模型/provider 不变、native 检查通过，auth.json hash 未变。旧完整指纹的能力结论不追认成当前完整准入；后续认证预检发生在该漂移之后。
- `check-{1,2}.json`：串行完整检查的时间、退出码、统计与脱敏日志。
- `final.json`：检查、重建重装、自检、安装副本与预算的最终核对；未提交、未推送，完整 M11 前置任务仍未完成。

其它批次原始证据和预算不改写。旧三供应商批次的 config unchanged 表示其收尾时刻；本次随后更改 Codex 默认接入，不追改旧快照。没有手工填探针事实或修改历史 Schema。

收尾：47/64真实CLI启动全部结束；两次串行check各3105通过、3跳过、0失败；重建、重装、自检14/14及安装bundle/输入指纹核对通过。证据脱敏扫描无候选。已观察到的全局配置漂移之后hash保持稳定，原因未确认，不手工恢复或改写；登录文件hash不变。
