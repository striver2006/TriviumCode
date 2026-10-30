# Windows 四家 Agent 真机验收报告

- 日期：2026-10-29 ｜ 批次：`four-agent-win-20261029-211334` ｜ 执行人：ZCode 桌面会话（GLM，受托 Driver）
- 任务书：[`PLAN_Windows四家Agent真机与客户端验收任务.md`](./PLAN_Windows四家Agent真机与客户端验收任务.md)
- 被测基线：`4bd1d0d50d15d9641156598487bea7fcae5f751f`（四家收口 main 提交，产品版本字段 1.3.2）；
  修复复测段在 `1.3.3`（本报告同批提交）
- 机器：Windows 11 Pro 10.0.26300 Build 26300 **真机**（联想 REN7000K-28IMB，i9-10900 / 32G，非 VM）；
  Node v24.19.0；Git for Windows 2.56.0.windows.3（pin `D:\Program Files\Git`，PATH 的 MSYS2/ucrt64 布局按任务书 §3.3 显式绕开）；
  PowerShell 5.1；火绒 + Defender 在位未关闭
- 预算：按需授权（会话内明确）；实际消耗 doctor 类 14 作业、Driver 会话 7、审核者侧次 4，详见 `budget.md`
- 证据索引：`evidence/four-agent-win-20261029-211334/`（脱敏子集；run root 不整包上传，临时凭据副本未带入仓库）

## 1. 路线表（请求 / 配置声明 / 运行回读分列）

| Agent | 客户端（形态） | 版本 | 本机实际路线 | 回读（模型身份） |
| :-- | :-- | :-- | :-- | :-- |
| codex | Codex CLI（`codex exec` headless） | 0.163.0 | 第三方 ccswitch → api.kimi.com（**无官方 OpenAI 凭据**） | 目录 kimi-for-coding 家族；审查未启用（见 §3） |
| claude | Claude Code（`claude -p` headless） | 2.1.302 | **第三方网关** token-plan.cn-beijing.maas.aliyuncs.com（CC Switch 写 settings.json env 段，12 键） | B1r 审查回读 **qwen3.8-flash**（`model_effective_source: envelope`，与请求一致）——按任务书 §1.2 口径：**只证明该客户端与该路线，不证明 Anthropic 官方模型** |
| glm | ZCode 桌面自带 CLI（桌面会话 Driver；CLI 经适配层拉起） | 0.17.0 | 桌面安装内置 provider + config_copy 隔离 | B3r 审查回读 **bigmodel-plan/GLM-5.3**（`model_effective_source: trace`，请求 GLM-5.3） |
| gemini | Antigravity（`agy -p` headless） | 1.4.10 | 原生 | B2r 审查回读 **gemini-3.8-flash-high**（`source: envelope`，与请求一致） |

## 2. W0～W1：离线回归与 Windows 特性 —— 通过

- **全量回归（首跑）**：tests **3136 / pass 3089 / fail 3 / cancelled 0 / skipped 44**，563s。3 个失败（`diff-pathspec-env` EV-222 W、`plan-final-gate` I3、`plan-final-recheck` C1）形态为 worker 失联（pid_gone）/运行退 1，按任务书做**一次具名复跑：18/18 通过**（ISSUE-05）。44 skip 为 win32 对 POSIX 专属测试的整文件跳过，与 macOS 基线自述（4022+10）的差异属平台预期。render 零漂移、four-agent-scope 3/3、selftest **14/14 步**。**修复后（1.3.3）再次全量：同分布 3 失败但为另外三个文件**（`access-v3` 跨进程保留、锁回收 X3 高频抢放、`--cancel` 终止工作进程——全部跨进程/锁/worker 类），具名复跑照过（`59/60-postfix-*.log`）——**ISSUE-05 由 flaky 嫌疑升级为 Windows 全量并发下系统性的 worker 稳定性问题**：两次全量打红不同文件、全是真实子进程并发类测试、单文件跑全过，与 B3r 真实审查的 pid_gone 同方向（见 §6）。
- **安装**：`install:check` 前后 + `dist/install.cjs` 全过；运行时根与源 bundle **SHA256 一致**；四家各 7 入口 + gemini 侧只读 Agent 定义共 52 文件；**无 Kimi/Qoder 候选残留**。流程偏差一条：安装前未备份本机旧安装即覆盖（ISSUE-06，旧版可从 git 历史重建）。
- **中文空格路径**（W1-03）：`W1-03-zh 中文空格` 夹具 init / status / doctor --no-model-calls 全过，路径未乱码、参数未拆散；PowerShell `.cmd`、cmd.exe、Git Bash `trivium` 三种 wrapper 均 1.3.2（修复后 1.3.3）。PS 5.1 无 BOM 中文脚本按 ANSI 解码的坑按任务书 §3.1 预防（harness ASCII-only + 通配符定位）。
- **原子写真实占用实验**（W1-04，接本批源码、metafile 核验）：场景 A 成功（**422ms**，内容 `updated-A`，无 `.tmp-` 残留）；场景 B 有界失败（**832ms**，原始 EPERM，无残留），任务书追加断言 **`final_content === 'initial'` 成立**。
- **进程树观察**（W1-05）：npm test 期间 15 样本均值 113 / 峰值 125 进程，序列平稳无递归风暴；最深 node 链 13 层为 bash→powershell→npm→node 测试管道自身。
- **清理**（W1-07）：本批临时目录已清（保留 `--keep-fixture` 件）；**发现 Temp 有 1167 个历史 trivium-* 残留**，其中 `trivium-codexhome-*` 家族含 config.toml（凭据副本风险），非本批所有未代删——建议属主核对后清理。

## 3. W2 首轮：四个单侧 B —— 1 失败 + 3 阻塞（Driver 侧四家全部正常）

四家 Driver 侧准备链路（认领 → 写本方后缀原稿 → 回读 → resolve → preflight → 按契约停止）**全部验证正常**；原稿 role/后缀与各 Driver 身份一致（codex / claude / gemini / glm 各就各位），业务文件零意外写入。

| 用例 | Driver | 审核者 | 首轮结局 | 根因（问题单） |
| :-- | :-- | :-- | :-- | :-- |
| B1 | Codex | claude | 阻塞（预检退 69） | claude 探针隔离环境 headless 哨兵未读到——两个成因：网关键未注入（配置缺 `settings_env_source`）+ 探针硬编码 haiku 模型名网关 400（ISSUE-04） |
| B2 | Claude | gemini | **失败（审查软拒绝）** | BRIEF 第 6 节引用工作区外 schema 绝对路径，agy headless 越界读被拒后模型零输出（issue #548 形态）——**产品缺陷**（ISSUE-01） |
| B3 | Antigravity | glm | 阻塞（预检退 69） | ZCode CLI 0.17.0 无凭据停点前移为 `Select a model`，`ZCODE_ARGV_PARSED_RE` 未收录 → readonly_flags 全 indeterminate → fail-closed 拒入——**产品适配缺口**（ISSUE-02） |
| B4 | ZCode 桌面 | codex | 阻塞（预检退 69） | codex 0.163.0（ccswitch 第三方路线）`-s read-only` 沙箱负对照**实测失守**（写未被拦）→ 产品禁入。两夹具复现；另产品默认 codex 模型 `qwen3.8-flash` 不在本机目录（需显式路线参数）（ISSUE-03） |

**安全准入（W4-S1 的核心证据）**：codex 沙箱失守由探针负对照**实测捕获并被 fail-closed 正确拦截**；zcode path_deny 否定对照成立（无路径级 deny，能力边界如实记录）；agy headless 哨兵正对照通过；修复复测后 claude 只读负对照成立且**被拒尝试留在轨迹**。W4-01（三审组合）/W4-02（取消）依赖「对应单侧已准入」，首轮四侧皆未准入 → 阻塞；复测后三侧准入，本轮未再扩展（独立新批次事项）。

## 4. 修复（1.3.3，本批同提交）

按 Bob 决策「各起变更修复后复测 B2/B3；支持官方凭据与第三方路线」执行：

1. **ISSUE-01（`brief.ts`）**：任务书第 6 节输出契约**自足化**——删去资产根下 schema 绝对路径的引用（完整字段/必填/枚举本就从 schema 实时读取并列在该节，路径引用零信息增量），补「字符串根字段不可为空串」。`run.json` 的 `schema_path` 留痕不受影响。同步 5 个单测的 `BriefInput` 构造。
2. **ISSUE-02（`adapters/zcode.ts`）**：`ZCODE_ARGV_PARSED_RE` 补 0.17.0 实测停点 `Select a model`。前置验证（零配额）：同环境（只给内置 provider + 空 HOME）加 `--bogus-flag` 照报 `Unknown option`、合法旗标才走到该停点——证明它发生在参数解析**之后**，属「参数已吃完」的正向证据；与 P-29「provider 定位先于参数解析」不同族。补端到端用例（假入口新开关：五个合法候选判接受、两个 Unknown 候选照拒、零 indeterminate）。坑清单新登 **P-32**。
3. **ISSUE-04（配置面，产品机制本就完备）**：EV-256 的 `settings_env_source: user_settings` 声明后网关键 12 键经子进程环境变量注入（受限模式保住鉴权）；探针/审查模型须显式取网关目录名（`--model-claude qwen3.8-flash`）——探针缺省 haiku 名在网关 400（`Model not exist`）。**产品代码零改动**，属第三方网关机器的配置指引（见 §7 建议）。
4. 版本 1.3.2 → **1.3.3**；设计文档 §9.4 第 6 条与 §3.5 探针清单同批修订；修复后全量 check exit 0。

## 5. W2 复测（1.3.3）：三个单侧 B 全部走通

复测用原夹具新主题（首轮失败样本原样保留），Driver 仍为对应原生客户端 headless 会话：

| 用例 | 主题 | run | 审查证据（真实厂商调用） | 裁决/停点 |
| :-- | :-- | :-- | :-- | :-- |
| B2r（Claude 审 gemini） | Win四家B2r | 20261029T144920Z | agy/1.4.10，**read 8 / glob 1 / project_reads 8**，回读 gemini-3.8-flash-high = 请求，blind，138s | 裁决件 + r2 计划 + **人工停点** |
| B3r（Antigravity 审 glm） | Win四家B3r | 20261029T145743Z | zcode/0.17.0，**read 7 / grep 1 / glob 1**，回读 bigmodel-plan/GLM-5.3（请求 GLM-5.3，trace），blind，209s | 裁决件 + r2 计划 + **人工停点**（joint 降级告警如实披露） |
| B1r（Codex 审 claude） | Win四家B1r | 20261029T151222Z | claude/2.1.302 经网关，**read 9 / glob 1 / project_reads 9**，回读 qwen3.8-flash = 请求（envelope），blind，253s，4 条意见 | 裁决件 + r2 计划 + **人工停点** |

三格 run 元数据（driver / entry B / round 1/1 来源 flag / requested_routes）与预检一致、无候选 Agent 残留；三个夹具业务文件零改动。

**审批环节实测（补记，覆盖 W5「审批」一行）**：三主题随后由 Bob 经 `dual-approve` 逐一批准（plan 阶段，附言「Windows验收复测：链路验证达成，批准放行」）——操作前后状态可读回、工作树改动摘要打印、业务写锁解除、全部工件保留，审批记录（时间、结论、理由）写入各夹具 task.json 的 `approvals` 段供事后对账。夹具为验收专用样本，不继续下一阶段实施。

首轮 B4（ZCode 审 codex）未复测：本机 codex 无官方凭据、第三方路线沙箱实测失守，属账号/环境侧，产品拦截正确（ISSUE-03 维持）。

## 6. 遗留问题与残留

| 编号 | 级别 | 状态 | 说明 |
| :-- | :-- | :-- | :-- |
| ISSUE-01 | P1 产品缺陷 | **已修复（1.3.3）+ 复测通过** | BRIEF schema 路径越界（本报告 §4.1） |
| ISSUE-02 | P1 适配缺口 | **已修复（1.3.3）+ 复测通过** | ZCode 0.17.0 停点（P-32；§4.2） |
| ISSUE-03 | P1 环境 | 维持阻塞 | 本机 codex 第三方路线 read-only 沙箱失守 + 默认模型不在目录；待官方凭据或沙箱有效路线后另批复测 |
| ISSUE-04 | P1 配置 | **配置解决 + 复测通过** | `settings_env_source` + 网关模型名（§4.3）；建议部署手册补第三方网关指引 |
| ISSUE-05 | P1 | **已定位并修复（1.3.4）：双根因**（详见 §9 补记） | ① 05a：run_root 在项目工作树内时，工作树哈希 `add -A` 读 worker 心跳正原子替换的 status.json，Windows 报 `short read` 退非零、worker 异常退出；② 05b：`--wait` 判 `pid_gone` 的读 status/查 pid 两步竞态，worker「写终态→退出」落在两步之间时被误判失联、success 被覆盖收尾成 failed——即集成测试并发下随机红（三批全量各红不同文件、具名复跑全过）与 B3r 首跑失败的形态 |
| ISSUE-06 | P2 流程偏差 | 已记录 | 安装前未备份旧版即覆盖 |
| ISSUE-07 | P3 | 已记录 | 环境适配（D 盘路径 / MSYS2 布局 pin / PS5.1 BOM / cmd `//c` 转义） |

## 7. 未测边界（不外推）

- Windows 10、WSL、虚拟机、IDE 插件形态、ZCode CLI 命令行形态（本机未装）：未测。
- claude 侧结论仅覆盖第三方网关路线（qwen3.8-flash）；**Anthropic 官方模型未测**（无官方凭据）。codex 同理（OpenAI 官方未测）。
- W4-01 三审组合、W4-02 取消、W4-S3/S4/S5 Hook 负向、W5 的 A/C/D 入口与审批**拒绝/放弃**分支：未测——复测后三侧已准入，具备独立新批次的准入条件。W5 的**审批通过**环节已实测（§5 补记，三例）。
- 本报告不宣称任何客户端「A/B/C/D 全流程通过」；B 入口在三格上的完整链路（含人工停点）已实测。

## 8. 建议

1. ISSUE-05（Windows worker 稳定性）排期定位——两个独立场景同形态，非单次偶发。
2. 部署手册补「第三方网关机器」配置段：`settings_env_source: user_settings` + 显式网关模型名（本报告 §4.3 的两个配置项）。
3. ~~三个复测主题的审批停点待 Bob 决定~~ 已批准（§5 补记）。

## 9. ISSUE-05 定位与修复补记（2026-10-29 深夜，验收同日续做）

按 Bob 指示继续定位。**双根因**，均有现场实锤与修复前后对照：

**05a（worker 真死，git 快照竞态）**：受控冲击实验（stub 审查、真实 worker 派生、8 并发）在
run_root 指进项目内的夹具上 24 例复现 5 例 worker 死，现场 status 收尾带 git 原文
`short read while indexing runs/…/status.json`——工作树哈希的临时索引 `add -A` 读到 worker
心跳正原子替换的文件。run_root 挪出项目外后 0/24。修复（1.3.4）：`diffExcludePrefixes`
增可选运行根排除（冻结与漂移复算传入）+ `isShortReadIndexError` 并入暂态重试判据。

**05b（worker 误判死，wait 竞态）**：修复 05a 后的巩固轮仍出 1/40 pid_gone，现场解剖实锤——
worker.log 完整跑完并落盘报告，status 的 `lost.at` 与最后心跳同一毫秒：`interpretStatus`
先读 status（旧的非终态心跳）、后查 pid（worker 恰已正常退出）→ 误判失联并把 success
覆盖成 failed。秒级运行窗口命中率最高，正是三批全量随机红（各 1~3 个不同文件）的形态，
B3r 首跑失败与此同族。修复（1.3.4）：判 `pid_gone` 前重读一次 status.json，读到终态按终态处理。

**验证**：判据/排除单测（纯函数用例移出 win32 平台门双平台跑）；冲击实验修复前
19/24 → 修复后 24/24、40 例 1 例（即 05b 现场）→ 重读修复后 64/64；集成并发 2 轮复跑（修复后产物）。
坑清单登 **P-33/P-34**；设计文档 EV-221 详段、§7.5 wait 判定约束与版本表（v1.3.3/v1.3.4）同批修订。

## 10. 扩展批次（2026-10-30，按 Bob「全部执行」指示）

前置：重装 1.3.4；六个扩展夹具（run_root 一律项目外，P-33 教训）；各侧真实探针 10 例全过。

| 用例 | Driver／审核者 | 结果 | 要点 |
| :-- | :-- | :-- | :-- |
| W4-02 取消 | codex（名义）／glm | **通过** | 审核者进程确认启动后 `--cancel`：phase=cancelled、取消留痕、请求快照（GLM-5.3）与工件保留、worker/CLI 进程收口、只点名本 run PID |
| W4-01 三审组合 | codex／claude+gemini+glm | **通过** | 三侧各自真实审查（read 9/8/6、回读一致、blind、三份 brief），裁决覆盖三侧，人工停点待批。注：首跑预检三侧同败系与探针任务并发竞争，串行重试即过 |
| W4-S3 Hook 负向 | （停点夹具审查：gemini） | **未达成（ISSUE-09）** | 审查与停点正常；canary 写入**未被拦**：事件流无 PreToolUse hook_started（项目 hooks 未注册）、claude 探测不到 D 盘 Git（「Git Bash wasn't found」，PATH 注入无效）、hook 失败形态为放行。L1 在本机实测不成立 |
| W5-D bug 入口 | codex／claude | **通过** | 可复现现场（b 位漏检）→ 认领 bug → 根因稿 → 审查（网关路线）→ 裁决 → bug 停点。首次以 agy Driver 发起时 worker 12 秒静默死（ISSUE-08），改 codex 后全通 |
| W5-C code 入口 | codex／gemini | **通过** | 冻结 diff 与预置改动**逐字一致**；gemini 3 意见逐条裁决并完成改码、`node --test` 自查 3/3；停点。途中 agy 探活连续失败系 ISSUE-08 的孤儿 agy 进程持日志锁（已核对身份后结束） |
| W5-A dual-run | claude／gemini+glm | **通过（至第一停点）** | verify 命令按任务书 §8 配置后，S0～S3.5 完整：计划原稿 → 两侧真实审查（5 意见）→ 裁决全接受 → r2 定稿 → 计划审批停点；批准后从 S4.5（实施→代码双审→verify）继续 |

**新登问题单**：ISSUE-08（P1，产品）：Windows 上 **agy 会话派生的 detached worker 随工具通道结束被杀**（Job 继承逃不出；B3r 首跑与 W5-D 首跑均 12~15 秒静默死、worker.log 止于尝试行，而 codex/claude 会话与终端直接派生均存活）——agy 载体在 Windows 上的审查链路实际不可用，产品需 Windows 专用派生通道；次生现象为 worker 被杀时审查 CLI 成孤儿并持日志锁，令后续 agy 探活连锁失败。ISSUE-09（P1，环境/适配）：本机 Claude L1 Hook 三层失效（见 W4-S3 行），QUICKSTART「L1 以实测成立为条件」在本机不成立，待 Git 装回默认路径或产品改 hook 命令形态（去 sh 依赖）后复测。

**停点处置（按 Bob「按建议执行」，2026-10-30）**：WinW4-01／WinW5-Db／WinW5-C **批准**（各阶段 approve 首例，工件全保留）；WinW4S3 **放弃**（abandon 分支实测：闸门解除、写锁释放、工件保留、流水线不自动继续）；WinW5-A **批准后跑完 A 入口全流程**——S4.5 认领与实施（自查 8/8）→ S6 代码双审（gemini 通过 0 意见 + glm 4 条改进）→ S7/S8 应答全接受并改码（自查 9/9）→ S9 gate 通过 → **S10 verify 真实执行通过**（`node --check` ✓、`node --test` 9 用例全绿，留痕 `verify/2026-10-30-WinW5-A-verify.md`）→ code 批准 → 实施提交（夹具 `8e64e8a`）。审批矩阵本轮覆盖 **approve×5 + abandon×1**，仅「拒绝」分支未测。
