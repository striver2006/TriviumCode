# 1.2.x 增补篇

本篇汇编 Windows 线 1.2.x 的增量内容，随《完整手册》发行；事实口径与 [现存 Bug 与未完成工作清单](../doc/08_project/现存Bug与未完成工作清单.md) §3 同源，那里是唯一权威登记处。

## 一、四侧可用性（截至 1.2.9，win32 实测）

| 侧 | 状态 | 要点 |
| :--- | :--- | :--- |
| claude | 可用 | `--restricted` 只读 + `--settings` deny 已验证；CC Switch 网关见下节 |
| codex | 可用（降级） | 只读沙箱在 Windows 不拦截（上游缺口），`readonly_enforcement: prompt-only` 显式降级放行 |
| agy（gemini） | 可用 | 免 pty 可用（管道下 stdout 不丢、headless 哨兵命中，1.2.5 实测） |
| zcode（glm） | 可用 | 最小自定义 provider 配置后探针全绿（2026-10-20 闭合），配置口径见下文 |

Windows 线实测可用的双审组合：`claude,gemini` 与 `claude,codex`（后者含降级注记）。

## 二、CC Switch 第三方网关注入（1.2.0）

`--restricted` 按官方语义忽略 user/project/local settings 文件（含 CC Switch 写入的网关 env 段），回落官方端点即报「未登录」。通道取 claude 子进程的环境变量（受限模式认进程环境变量；1.3.2 起，此前经 `--settings` 内联、键值会出现在进程命令行里）：本机 `.trivium/config.local.yaml` 的 `agents.claude` 段开 `settings_env_source: user_settings` 后，路线解析时读用户级 `~/.claude/settings.json` 的 env 段（只收 `ANTHROPIC_`/`CLAUDE_` 前缀），每次带模型调用时先清掉编排器自身环境里的 `ANTHROPIC_*` 等路线变量、再把提取出的键注入子进程环境。安全边界：键值不进命令行，凭据类键值不落任何留痕（指纹仅 sha256、输出逐值替换脱敏）；模型名键（`ANTHROPIC_MODEL`、`ANTHROPIC_DEFAULT_*_MODEL` 等）的值按模型名记录，生效模型回读记网关回报的真名（1.3.2 起）；子进程环境块同用户进程可读。不要与 claude 的 profile 路线同开（profile 的 `export` 会覆盖同名网关键，部分同名时可能端点与令牌混配而 401）。官方登录机器 env 段为空即自动无操作。codex 侧无此问题（鉴权在 `$CODEX_HOME`）。

## 三、codex 只读降级（1.2.1）

win32 + codex 0.163.0 实测：`-s read-only` 下写命令真实执行且报告成功（上游缺口）。编排器按 fail-closed 判该侧不可用是正确行为。要在此前提下用 codex 作审核者：`agents.codex.readonly_enforcement: prompt-only` 显式开启——负对照失败时保留只读旗标、记 `readonly_enforced: false`，预检以降级注记放行。补偿控制：BRIEF 只读措辞 + 事后轨迹/漂移核验（写入一旦检出该侧作废），防线从「事前阻止」换为「事后必查」。OS 级只读可用的平台（macOS/Linux）不要开启。

## 四、zcode CLI 配置口径（1.2.1–1.2.9）

- 装法：任意盘（如 D:）经 `agents.glm.entry` 在 `config.local.yaml` 指路；探针候选序含 `<安装盘>\Program Files\ZCode\resources\glm\zcode.cjs`。
- `~/.zcode/cli/config.json` 最小自定义 provider：id 不得带 `builtin:`/`account:` 前缀、`source: custom`、`kind: anthropic`、`options.apiKey`+`options.baseURL`、`model.main` 用 `自定义id/模型名` 字符串。
- 已知残余：带桌面环境变量的裸终端 headless 报 Model creation failed（zcode CLI 0.16.9 装配问题，不影响编排器的隔离拉起形态）。

## 五、修复清单与残余（1.2.2–1.2.9）

| 版本 | 内容 |
| :--- | :--- |
| 1.2.2 | 陈旧枚举缓存只认显式龄期（防 pid 复用误杀）；AppData/LocalAppData 残余通道登记（§3.1-10，评估中） |
| 1.2.3–1.2.5 | 测试解除跳过三批（verify/init/hooks/preflight/run-meta-cancel/freeze-drift/lock/retention/worktree-summary/credential-scrub），挖出并修复 related 漂移比对域、抹除报告域随平台换形两处真缺陷 |
| 1.2.6 | 修复生产缺陷：winProcessCreation 缓存命中但 pid 缺席时新生进程 0ms 判 null（缺席先强制重枚举一次）；集成失败 72→30 |
| 1.2.7 | 修复生产缺陷：resolvePlanFinal 路径 win32 出反斜杠进告警正文；集成失败 30→19 |
| 1.2.8 | 修复产品级竞态：`--start` 补写身份的 patchStatus 把已完成终态碾压回 running（快 worker + 慢枚举即触发，`--wait` 误判 worker_lost）——补写只加身份字段、终态不改回；fresh 枚举搭车判据定为启程时刻。同批：测试桩泄漏治理（win32 负 pgid 组信号实测 ESRCH、桩加自毁）、全量回归 `--test-timeout` 兜底（满载挂死根因未定位、已登记） |
| 1.2.9 | Windows 一键安装脚本（`一键安装.cmd`：Git 前置检测 → 前检 → 安装 → 版本核对 → 14 步零配额自检）；连带修复 .cmd 模板版本闸门失效与 node 缺失裸错 |

集成测试残余为登记在案的负载敏感长尾族（lock 并发、秒窗时序、路径 `~` 折叠比对等），逐条排查中；结构性限制（无跨进程优雅取消、`.cmd` 垫片元字符、chmod 语义降级）见部署手册 §1a「边界」。

## 六、一键安装（1.2.9）

发布包内 `一键安装.cmd`（双击或终端运行）依次完成：Git for Windows 硬前置检测 → 安装前检查（复用安装器判定、只读）→ 安装 → 装后版本核对 → `doctor --selftest` 14 步零配额自检。任一步失败停在对应输出，退出码分层（0 全过 / 1 前置或读取面冲突 / 2 安装或核对失败 / 3 自检未全过）。检测到 `TRIVIUM_ASSET_ROOT` 时自动为安装器子进程剥离。分步手动路径见部署手册 §2.1–§2.3（保留作排查通道）。

> 边界：一键链路未做异机真实验收（Bug 清单 §3 口径不变），首次异机使用按部署手册 §1a 前置清单人工核对一遍。
