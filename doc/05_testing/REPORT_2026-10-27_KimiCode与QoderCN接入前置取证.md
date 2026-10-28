# Kimi Code 与 Qoder CN 双角色接入前置取证报告

日期：2026-10-27（证据 UTC 时间为 2026-10-26，属同一次新加坡本地会话）。执笔：Codex。状态：S5 能力前置受阻，整体需求未完成；本报告不是双角色实现交付或发布报告。

## 1. 流水线与实现状态

初始工作树干净、无未关闭闸门。按正式 `$dual-run` 解析，Driver 为 codex；实际入选 gemini、glm，与本机配置及成功预检一致。计划审 run `20261026T174236Z`：两侧均 `pass-after-changes`，13 条意见全接受，逐条裁决与完整 r2 计划已落盘。gate 第 1/3 轮通过、next_action 为 proceed。code 已认领；没有自行审批、缩减审核者或扩大轮次。

工件：[完整修订计划](../../.reviews/KimiCode与QoderCN双角色接入/plan/2026-10-27-KimiCode与QoderCN双角色接入-r2-codex.md)、[逐条裁决](../../.reviews/KimiCode与QoderCN双角色接入/plan/2026-10-27-KimiCode与QoderCN双角色接入-revised-codex.md)。

本阶段新增受控 CLI 取证脚本和 Windows 复跑包装、验收清单；本轮随后已完成两家候选 L2 Driver 入口、配置/Schema 形状、入口源与生成产物接入。由于规则加载、技能发现和五客户端验收仍无完整证据，两家 `driverEnabled` 均保持关闭；**两家也未启用为审核者，未填写未经实测的 TraceCapability**。生产审核适配器、真实模型目录消费和安全准入仍阻塞；代码审第 2 轮已按固定 gemini、glm 完成并通过 gate，但正式 verify 和五客户端 Driver 验收仍未完成。

## 2. 环境与证据方式

| 客户端 | 本机版本 | 已确认范围 |
| --- | --- | --- |
| Kimi Code CLI | 2.3.0 | 官方原生 managed provider、实际 CLI 调用 |
| Qoder CN CLI | 1.1.79 | 入口帮助明确 Qoder CLI CN、原生认证临时副本 |
| Kimi Code Desktop | 1.1.1 | 本机应用 plist；GUI 调用未测 |
| VS Code / Kimi 插件 | 1.143.1 / 0.8.3 | 本机版本/扩展包；Extension Host 实际调用未测 |
| Qoder CN Desktop | 0.4.11 | 本机应用 plist；GUI 调用未测 |

证据目录：[kimi-qoder-cn-20261027](./evidence/kimi-qoder-cn-20261027/)。每份 JSON 独占创建，包含时间、平台、CLI/script 哈希、argv、脱敏 stdout/stderr、随机 canary 结果和清理结果。早期 JSON 保留原样；后续脚本增加了 doctor 校验、trace_observation、规则形态等字段，不能把晚期字段倒填给早期证据。

脚本：[probe.mjs](../../scripts/acceptance/kimi-qoder-cn/probe.mjs)。认证材料仅进入 0700 临时根下的 0600 文件；Windows 路径先设置私有 ACL（Windows 实测未测）。厂商环境覆盖清理，Kimi 用 KIMI_CODE_HOME，Qoder 用独立 config-dir。用户全局账号、供应商及模型配置没有改动。全部已完成调用均记录 cleanup.ok=true；超时后的全部后代进程确认、强杀父进程异常清理尚未验证。

## 3. macOS 审核能力结果

| 项目 | Kimi Code | Qoder CN |
| --- | --- | --- |
| 普通 Read/Grep/Glob | 真实调用成功；首跑搜索到了夹具父目录及会话日志，边界不足 | 修正 prompt 后三工具正向成功，中文空格路径成功 |
| 同行工件 Read 禁读 | **失败**：精确路径、规范化路径和工具级 deny 均读出随机同行 canary | 修正规则后实际拒绝，轨迹带 permission-rule |
| 敏感文件 Read | `.env` 内置硬拦截成功；不能证明自定义 deny 生效 | 修正规则后实际拒绝 |
| Grep/Glob 隔离 | **失败**：同行文件仍可搜索/枚举 | 修正规则后同行/敏感内容无命中；已有错误规则正向泄漏作对照 |
| 工具裁剪 | 实际仅调用 Read；禁用工具执行分发反向证据**未测** | init 列出 Read/Grep/Glob；模型未发起禁用工具调用，执行分发反向证据**未测** |
| 外部执行扩展隔离 | 完整项目 Hook/MCP/插件注入矩阵**未测** | 共享技能及内置 SessionStart hook 出现；完整隔离**未测** |
| 模型回读 | 请求来自现有原生默认配置；生效回读 null/unknown | 请求 auto、客户端标签 Auto；底层模型 null/unknown |
| 不存在模型 | CLI 退 1，零工具调用 | **失败**：警告后回退 auto，仍调用工具并退 0 |
| 超时 | 1.5 秒触发，CLI 退 143；整棵派生树退出**未测** | 1.5 秒触发，CLI 退 143；整棵派生树退出**未测** |
| 临时认证清理 | 本批正常结束/超时 cleanup.ok=true；强杀异常未测 | 同左 |
| Windows 全部审核能力 | **未测** | **未测** |

关键证据：

- Kimi 最后一次工具级 deny：`kimi-deny-2026-10-26T18-19-55-543Z-71cf3702.json`。`kimi doctor` 退 0，确认临时 config.toml 与 tui.toml 有效；随后仍发生真实 Read/Grep/Glob，同行 canary 泄漏。该结果足以阻止当前参数组合准入，但不能据此断言所有 Kimi 版本/接口都不支持隔离，内部根因尚未定位。
- Qoder 初次失败：`qoder-cn-deny-2026-10-26T18-13-47-709Z-d0742e5b.json`。脚本错误地使用单斜杠绝对路径规则。按官方双斜杠规则修正并规范化 realpath 后，`qoder-cn-deny-2026-10-26T18-15-03-084Z-1d3ead41.json` 的 Read 两次实际拒绝、搜索无命中。初次失败不归因为客户端缺陷，也不删除旧证据。
- Qoder 正向搜索复测：`qoder-cn-open-2026-10-26T18-18-10-886Z-2bcf3534.json`；首跑的父目录权限错误不算搜索正向通过。
- 禁用工具：`kimi-tools-2026-10-26T18-18-10-884Z-bfafa262.json` 与 `qoder-cn-tools-2026-10-26T18-15-50-785Z-534cdaa0.json`。模型说工具不可用且没调，不是执行层拒绝证据。早期 Qoder JSON 的“待核验”在本报告人工判为**未测**。
- 无效模型：`qoder-cn-failure-2026-10-26T18-17-37-128Z-c2234452.json`。本轮已加入 Qoder 模型请求/目录校验与回退 fail-closed 纯逻辑及单测，但尚未绑定真实审核适配器或官方目录采集；真实复测仍未完成。

Kimi 原生默认 alias 从本机 config 解析为 `kimi-code/kimi-for-coding`，未猜测或更改。Qoder 本机保存的是自定义模型 ID，本次未继承该路线，显式测试目录中的原生 auto 项；`production_default_verified:false`。尚不能据此填入三档生产默认值。

`TraceCapability`、默认模型准入和安全参数均没有写入生产探针。没有用提示词只读替代隔离，没有把工具未发生调用当作拦截有效。

## 4. 客户端与 Windows 状态

桌面控制工具分别访问 `com.kimi.code.desktop` 与 `com.qodercn.app`，均返回 `bootstrapTimedOut`；统一桌面接口随后可读到应用清单，但进入两应用分别在 30 秒、20 秒后执行超时并重置内核。未取得有效截图或界面会话证据。macOS 五个 Driver 入口的七技能发现、实际参数/cwd、身份、裁决、人工审批和恢复均**未测**；CLI 能力取证不替代 Driver 验收。VS Code Extension Host 实际调用**未测**。当前候选入口已安装，但 Driver 开关保持关闭。

Windows 证据尚未回传，五个 Driver、两家审核者、原生进程调用、PowerShell/Git Bash、进程树取消及中文空格路径逐项**未测**。已提供[双平台验收清单](./CASE_KimiCode与QoderCN双平台验收.md)、[PowerShell 包装](../../scripts/acceptance/kimi-qoder-cn/windows.ps1)与 [Git Bash 包装](../../scripts/acceptance/kimi-qoder-cn/git-bash.sh)。这些脚本不代替 Windows 实测。

## 5. 自动化与审查

`node --check probe.mjs`、`bash -n git-bash.sh` 已通过，仅证明语法。15 份原始证据经仓库 scanSecrets 模式扫描零命中，不代表覆盖未知格式凭据。PowerShell 脚本执行未测。新增生产接入的注册表/Schema、入口渲染、安装查重、自审、配置兼容、Qoder 模型 fail-closed、轨迹解析、跨进程交接、防覆盖与异常清理测试已实现并在本轮定向复测；真实客户端安全准入与 Extension Host 证据仍未测。

此前 `doctor --selftest` 已通过 14/14 步，夹具已清理，全部审核者使用桩；本轮最终 `npm run check` 通过（4113 项，4104 通过、9 跳过、0 失败），但这些检查覆盖现有产品回归，不能替代新增客户端验收。正式 verify 尚未执行：代码审 gate 当前等待人工审批，且生产审核接线、真实安全证据和五客户端 Driver 验收仍未完成。

按授权重装了本次构建：`node dist/install.cjs` 成功；六个已登记载体各安装 7 份入口，`npm run install:check` 无重名/残留。源码 bundle 与已安装 bundle SHA-256 均为 `a4a2eabfc2ed4a199e8350022e49f4a917a279e0042bb1015d3ff21919aca89d`，项目 wrapper 指向该安装路径，实际版本回读 1.3.2。Kimi/Qoder 入口只是候选资产，Driver 开关仍关闭，不代表客户端验收。

## 6. 开发记录与恢复条件

本轮依次完成现场状态/版本核对、固定审核者预检、阶段认领、计划双审及 13 条裁决、受控 CLI 取证、L2 Driver 注册与入口渲染、Qoder 模型 fail-closed 纯逻辑及单测、反例保留、Windows 脚本和验收材料。没有提交、推送、发布或安装未完成的新入口。

继续工作仍需解决当前 Kimi 隔离失败，并为两家取得禁用工具真实执行拒绝、外部扩展隔离与可审计轨迹证据。Qoder 的模型请求/回退纯逻辑已加入自动化，但尚未绑定真实审核适配器和官方目录采集，也未把实验值写成生产默认；必须真实复测。桌面控制恢复后继续逐客户端取证，Windows 待 Bob 回传。全部准入、实现、代码审与正式测试完成之前，整体保持未完成，不修改当前发布版支持范围。

已核查 Kimi 原生 Hook 作为备选：官方说明异常/超时默认放行，不能把它直接作为唯一安全边界；本轮没有用它替代失败的权限规则，也未宣称 Hook 方案经过实测。[官方 Hook 说明](https://moonshotai.github.io/kimi-code/en/customization/hooks)。

官方依据（能力结论仍以本报告实测为准）：[Kimi 配置规则](https://moonshotai.github.io/kimi-code/en/configuration/config-files)、[Kimi 工具](https://moonshotai.github.io/kimi-code/en/reference/tools)、[Qoder CN 权限与双斜杠路径](https://docs.qoder.cn/cli/permissions)、[Qoder CN 配置范围](https://docs.qoder.cn/cli/config-scope)。

## 7. 后续实施计划与规则控制复测（2026-10-27 追加）

前述取证批次随后已在 `c4d495ee` 提交并推送；§6 的未提交陈述保留为当时状态。本次核对基线为 `10ce14bf`，无未关闭闸门，已制定[实施分解](../08_project/KimiCode与QoderCN双角色接入实施计划.md)。生产接入仍未实现。

探针新增 Kimi 单因素规则控制臂，并执行 6 种规则形态：`allow-only`、`deny-only`、`allow-first`、`paths-only`、`none`、`paths`。6 次 CLI 均退出 0 后实际读出普通和同行 canary，敏感 canary 未泄漏，文件未改变，临时根清理成功。证据目录：[kimi-qoder-cn-20261027-controls](./evidence/kimi-qoder-cn-20261027-controls/)。

该组反例排除了“此次失败必须依赖后续 broad allow”这一解释；不能据此断言具体内部根因。配置加载、模式与规则匹配仍需定位；禁用工具实际分发拒绝、扩展注入、进程树取消和 Windows 仍未测。已完成的 L2 Driver 注册不改变审核准入；未更新 TraceCapability 或放开审核准入。Qoder 的请求/配置声明/有效回读分离逻辑已加单测，但真实目录采集、真实回退中止和正式适配器接线仍未完成。

提交前补验（历史基线）：在更新后的基线 `cef044a5` 上执行 `npm run check`，退出 0；4025 项中 4015 通过、10 跳过、0 失败，测试耗时约 387 秒。此为历史材料检查，不替代当前工作树结果。

## 8. 当前代码审与复测状态（2026-10-28）

代码审第 1 轮 run `20261027T155518Z` 已完成：gemini `reject`（5 条），glm `pass-after-changes`（13 条）；已写 Codex 逐条应答，接受 17 条、驳回 1 条。代码审第 2 轮 run `20261027T163726Z` 已完成：gemini、glm 均为 `pass-after-changes`，5 条意见全部接受；gate `--check` 通过，`next_action=proceed`，当前停在人工审批前。glm 报告的 `consulted` 结构告警已保留，不把它当审查通过证据。

本轮新增真实证据：Kimi tools [JSON](./evidence/kimi-qoder-cn-20261027-tools/kimi-tools-2026-10-27T15-53-39-513Z-4c128b5e.json) 与 Qoder tools [JSON](./evidence/kimi-qoder-cn-20261027-tools/qoder-cn-tools-2026-10-27T15-54-06-952Z-bd026537.json) 均为“未测”：模型没有发起禁用工具调用，不能替代执行层拒绝；Qoder 无效模型 [JSON](./evidence/kimi-qoder-cn-20261027-failure/qoder-cn-failure-2026-10-27T15-54-24-268Z-23e4a1e1.json) 记录 `trivium-invalid-model` 被警告后回退 `Auto`、执行 Read/Grep/Glob 且退出 0，仍判失败。

当前自动化复测已通过定向入口/安装/发布包/注册表 Schema 对账 83/83；`npm run typecheck` 通过；最终 `npm run check` 通过（4113 项，4104 通过、9 跳过、0 失败）；已安装 bundle 与工作树 bundle SHA-256 均为 `a4a2eabfc2ed4a199e8350022e49f4a917a279e0042bb1015d3ff21919aca89d`；selftest 14/14。第 2 轮意见已全部裁决并完成代码复测，正式 verify 需在人工审批后执行；未完成前整体仍未完成。

本轮 r2 落点包括：Qoder CN 回退检测限定在 stderr 的模型系统提示并增加正常 stdout 反例；归档 `_meta` 文件名的 owner 后缀改由注册表派生；补齐 Qoder 后缀禁读正例和相关注册表/驱动注释。上述改动已重新构建、安装并通过 gate；未启用任何新的审核者或 Driver 准入。

## 9. Kimi macOS 独立根因诊断（2026-10-28 追加）

新主题三审后的单因素实验见 [Kimi macOS 规则报告](./REPORT_2026-10-28_KimiCode_macOS规则根因与只读准入.md)。旧 probe、失败证据与上述历史状态均保留。新证据有效版本为 2.3.3，不把 2.3.0 或首个版本/hash 不一致 spike 合并为同一指纹；新报告区分真实 native 受控机制、官方真实模型未测及源码推断。

配置实际被读取，但 `permission.rules` 未进入运行规则集合是与本次行为一致的源码层根因；规则顺序、manual/auto/yolo、agent/skills、根/cwd 与 PTY 对照未修复泄漏。Read/Grep 链接别名还可绕过合成敏感文件的词法过滤。没有找到项目可控且满足标准的官方原生修复；生产审核与 Driver 开关仍 false。真实模型桥接因现有 token 为空在启动前停止，未登录或改账号配置；不以本地受控服务取代该证据。
