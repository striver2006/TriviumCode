# Qoder CN 官方模型路由与回退阻断

2026-10-28；dual-run 主题 QoderCN官方模型路由与回退阻断；Driver codex。计划首轮计票为修改后通过，16 条意见全部接受，gate 校验完成。代码第 1 轮 2 不通过/1 修改后通过，第 2 轮 1 通过/2 修改后通过，27 条代码意见全部接受并经 gate 校验。第三次代码送审 2 通过/1 修改后通过，新增 3 条全部接受并经 gate 校验；正式 verify 首次失败后修复，最终运行 `20261028T003504Z` 三条命令全部退出 0，本次 P2 模型路由全流程完成；不代表 P3 只读审核准入。

## 实施与证据

真实适配器接线使用独立认证配置根；异步探针读取账号目录并验证省略 --model 时的 init 默认标签，纯 defaultModelFor 将同一事实作为 resolveTier 的 probe_default 最末层。default/flash/pro 无显式值时同源，profile/agent/CLI 显式值优先。native_model 分别保存默认声明、原始 override、实际请求、来源指纹、信封回读与计费键；worker 确定性比对交接，不重新选择默认。

官网来源：[CN 模型](https://docs.qoder.cn/cli/models)、[CN 配置](https://docs.qoder.cn/cli/settings)、[CN 成本用量](https://docs.qoder.cn/cli/sdk/cost-usage)。网页示例型号会漂移，具体可用项取 1.1.80 当前账号 --list-models。用户原始 model.name 为 Custom 观察声明，未作为官方默认继承；没有修改用户全局设置。

| macOS 当前真机项 | 观察结论 |
| --- | --- |
| 官方目录 | MODEL 单列返回 11 个标识，包含 Auto/Fast 路由标签；纯官方认证副本未复制 Custom 配置 |
| 三张 profile 表默认 | 都解析为已验证的 Auto 路由标签，tier_source=probe_default；pro 仅夹具内创建，未写用户配置 |
| 省略 --model | init 和 assistant 回读 Auto；底层身份 null/unverified |
| 有效显式覆盖 | Qwen3.8-Flash、DeepSeek-Flash 的请求、init/assistant 标签一致；model_effective_source=envelope，仍不代表服务端独立身份认证 |
| modelUsage | 不同显式样本 result 使用 qfmodel/dfmodel；官方未给映射，计费键单列保留，不猜别名，不当底层身份 |
| 无效显式模型 | 生产准备层抛配置错误，模型进程未派生、厂商退出码不存在 |
| 当前版本运行回退 | 首轮旧证据含 result success 后才停止，不能宣称阻止模型调用。修复完整告警后，新证据在 stderr 告警到达约 1.27 秒时停止，after_result=false、stdout 无模型标签、编排失败、原始退出143；仍不推断服务端请求是否已发出 |
| 原生配置默认 | 另建临时官方认证来源，settings.json 声明目录内 DeepSeek-Flash；真实探针产 source=config，默认执行同名回读成功；用户原始 settings 不变 |
| 项目配置反向对照 | cwd 的 .qoder/settings.json 和 settings.local.json 都指向无效模型，隔离默认与有效覆盖仍按上述请求生效 |
| 用户设置与临时认证 | 当前成功证据 settings 前后 hash 一致，全部临时根与认证子目录回读已清理；removed 还计入先行删除的认证子目录，不要求计数等于 created |
| Windows | 未测，当前实现拒绝在未验证 ACL 的 Windows 路线上复制认证 |

当前真机证据：[adapter-2026-10-28T00-16-37-108Z-f6e2e7.json](evidence/qoder-cn-model-20261028/adapter-2026-10-28T00-16-37-108Z-f6e2e7.json)。首份目录/默认原始证据：[directory-2026-10-27T23-15-59-345Z-c54e0b.json](evidence/qoder-cn-model-20261028/directory-2026-10-27T23-15-59-345Z-c54e0b.json)。失败试验与中间证据全部保留：一次 ESM/CJS 装载失败、一次将不明计费键误判模型身份、两次临时根被安全组件重建；不能把它们改写为通过。首轮代码审还发现完整告警尾句漏检及清理对象真值误判，已修复并补独立反例。最终实现区分计费键，并按进程启动时刻核对本临时 HOME 内辅助可执行文件、读取 sameProcess 后终止并复删；自然退出跳过、身份不明不杀，清理失败仍尽力删除认证/根并保留执行事实；不处理全局安全进程。

## 自动化与审查状态

- 定向模型与注册表契约：46/46 通过（第一次跨层导入违反 probes/adapters 依赖契约，已移除，未放宽守卫）。
- 真实可控 executable：退出0+回退失败、stdout/stderr 分块与无换行尾部早停、成功/超时/启动失败前三组通过。
- 隔离复制树两进程 worker：首跑夹具原稿作者后缀错误，未进入 worker；修正后四组集成 4/4 通过，冻结配置 hash 被篡改时真实 worker 在模型派生前拒绝，正对照将原生请求与原始退出码保留到 run.v3。
- 正式 verify `20261028T000656Z`：typecheck/build 退出 0，npm test 退出 1。暴露日志脱敏清单漏登记、新增适配器使桩接线表尾锚点失配、认证子目录裸删除及测试目录未走 scratchDir 四类契约问题；逐项修复，未放宽检查。随后全量 npm test 退出 0：4130 项，4121 通过、9 跳过、0 失败，336.4 秒；失败工件保留。最终正式 verify `20261028T003504Z`：typecheck/build/npm test 全部退出 0；4131 项，4122 通过、9 跳过、0 失败；总耗时 348 秒。成功归档为 [r2-verify.md](../../.reviews/QoderCN官方模型路由与回退阻断/verify/2026-10-28-QoderCN官方模型路由与回退阻断-r2-verify.md)。
- 扩展相关回归首批 139/139 通过；首轮代码审后新增/更新的模型、解析回显、清理/PID复用、来源绑定、config 探针及 worker 定向 44/44 通过，类型检查通过。代码首轮 2 不通过/1 修改后通过，18 条全部接受，第二轮 1 通过/2 修改后通过，新增 9 条全部接受，87 项定向回归通过；之后首次全量 verify 失败，如上记录。

第三次代码送审运行 `20261028T002149Z`：Gemini/Claude 通过、GLM 修改后通过；GLM-01 补真实适配器退出0且成功result但无模型标签的未核实失败/trace断言，CLAUDE-01 执行前错误统一安全展开摘要，CLAUDE-02 明确认证缺失分属直调准备与adapter版本验证两条覆盖。gate 通过，正式 verify 已通过；本主题 open_gates=[]，未降级、未跳过审核者。

## 能力边界

本次只交付 P2 模型路由机制，真实适配器的工具面刻意为空，尚不能作为完成只读准入的生产审核者。registry 的 Qoder criticEnabled/driverEnabled 均保持关闭。没有用安装、单元测试或模型正文代替只读执行层验收。产品版本不变；本文验收时尚未提交推送，后续 Git 交付与功能验收分别记录。

## Git 交付范围（2026-10-28）

Bob 随后调用 deliver，授权提交并推送当前 Qoder 成果。交付包括 P2 代码与测试、设计/协议/Schema 同步、报告与原始证据、完整计划/代码审查及两次 verify 留痕（包含首次失败）；不纳入此前已有的 Kimi 未提交变更。共享文档只暂存 Qoder 对应段落，工作树中的 Kimi 内容保留。Custom/BYOK 接入及严格只读审核准入仅已起草下一轮提示语，本次未实施、未启用。
