---
topic: VSCode插件Phase0-1
stage: code
role: glm
kind: delivery-note
run_id: pending-S6
---

# VSCode插件Phase0-1 · S5 交付说明（Driver 留档）

- 日期：2026-11-06 ｜ Driver：glm（ZCode）
- 计划定稿：`.reviews/VSCode插件Phase0-1/plan/2026-11-06-VSCode插件Phase0-1-r2-glm.md`
- 本件是 S5 第 10 步的 check 留档与注入矩阵实测记录（D6′：不改 .trivium/config.yaml，机械保证由本件 + S6 送审前复跑承担）

## 一、verify 执行记录（D6′）

extension 侧（`npm run check --prefix extension` = typecheck + esbuild + 单测 + 集成）：

| 命令 | 结果 | 明细 |
| :--- | :--- | :--- |
| `npm run typecheck` | ✅ 绿 | tsc strict + noUncheckedIndexedAccess + noUnused*，0 error |
| `npm run test:unit` | ✅ 50/50 | injectText/exitCodes/carriers 对账/entryCommand/versionCheck/health/statusModel/stateModel/runDiscovery/yamlLoad |
| `npm run test:integration` | ✅ 23/23 | 激活/健康/probe 锚点/前置链含错误面/状态监视含历史残留与回落/心跳零事件失联/闸门先行窗口/侧完成归档/终端 direct+shellCommand 字节级通道保真/身份键复用/续话中继/Disposable |
| `TRIVIUM_E2E=1 npm run e2e` | ✅ 2/2 | 真实 trivium.cjs：resolve → review --start（JSON 桩配置）→ RunWatch 旁观至终态 → run.json 三侧 `cli_version=stub/0.0.0` |
| `TRIVIUM_REAL=1 npm run real` | ✅ 4/4 | 四家真实 CLI 启动冒烟（零模型调用） |
| `npx vsce package` | ✅ | trivium-cockpit-0.1.0.vsix（79.32 KB，7 文件） |

主仓侧：`npm run check`（typecheck + build + test）在 S5 收尾时回归执行：**全绿**（tests 4046 / pass 4030 / fail 0 / 退出码 0；16 项为平台性跳过）。

**环境敏感发现（与本批无关，如实登记）**：主仓单测 `zcode-full-copy-arm.test.js` 在 shell 环境存在 `ZCODE_BASE_URL` 时失败（期望 `['ZCODE_API_KEY']`、实际多出 `ZCODE_BASE_URL`）；本会话由 ZCode 桌面端拉起自带该变量。剔除该变量后 26/26 绿——干净终端跑 `npm run check` 不受影响，属主仓测试的环境敏感项，建议后续单独立项处理。

## 二、注入矩阵实测结论（D8′，macOS 真机）

| 维度 | claude | codex | gemini(agy) | glm(zcode) | 手段 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 直启进交互 TUI | ✅ | ✅ | ✅ | ✅（shellCommand 经 node） | 自动化（test/real，真 entrypoint，6s 存活断言） |
| 就绪延迟中位数 | 未测（缺省 3000ms，可配） | 同左 | 同左 | 同左 | 需人工观察，F5 调 `trivium.launch.readyDelayMs` |
| sendText 模式 | fakeTUI ✅（execute 字节级） | 同左 | 同左 | 同左 | 自动化（fakeTUI 双形态：可执行 sh / raw-mode .cjs） |
| 短正文注入 | ✅ 字节级 | ✅ | ✅ | ✅ | 自动化 |
| 长正文（~1.2KB 中文） | ✅ 字节级（分段 256B×5） | ✅ | ✅ | ✅ | 自动化 |
| 续话中继 | ✅ | ✅ | ✅ | ✅ | 自动化 |
| 关闭→降级 M3 | 逻辑就位（onDidCloseTerminal → cockpit 消息），GUI 端到端待 F5 | — | — | — | 半自动 |
| 同主题复用不开新终端 | ✅（身份键 agent\|topic\|entry） | ✅ | ✅ | ✅ | 自动化 |
| 入口解析保真（真 dual-run 全链比对 task_goal） | **本批未执行**（一次真会话 30~40 分钟且烧配额，超出本批预算登记；命令条兜底保证不阻塞） | — | — | — | 手工矩阵交付 |

**实测发现的平台事实（已按矩阵结论固化为设计/测试）**：
1. macOS 终端 ICANON 模式 MAX_CANON=255 字节行缓冲——长行注入依赖目标 TUI 开 raw mode；真实四家 CLI 均为 raw（冒烟证实存活即 TUI 形态），fakeTUI 已对齐开 raw mode（否则长行被内核吞）。
2. 新版 VS Code for macOS 主二进制名为 `Code`（非 `Electron`）——`process.execPath` 不能当解释器判据（测试侧踩坑记录）。
3. VS Code FileSystemWatcher 对 workspace 外路径（run_root 在 `~/.trivium/runs`）事件不可靠——RunWatch 改用 node `fs.watch` 目录级监听（吃原子替换，目录未建时 2s 重试挂载）。

## 三、验收对照（r2 计划 §五）

Phase 0：三项全过（健康面板数据面/probe 锚点/未 init 判定有集成测试；引导链接静态存在——命令运行时逐候选探测，勿改 doc 路径）。
Phase 1：装配表单/前置链次序与错误面/终端协同/监控/降级/中止/失联/历史残留——均有自动化测试覆盖（见上表与集成清单）；「全程无手敲命令」的 GUI 走查属人工验收项，本批以消息协议与处理器全覆盖 + fakeTUI 通道保真代偿，F5 人工走查留给用户。

## 四、已知局限（如实交付）

- 就绪探测为延迟+人工兜底（无事件驱动，D3′ 设计如此）；「重新注入」与命令条常驻。
- 真机注入的 sendText 逐家语义（execute/split/manual 哪个最稳）需 F5 实测定档，本批缺省 execute、可按载体覆盖。
- 入口解析保真（真 dual-run 全链）本批未执行（预算登记在案）。
- Windows 未适配（CODEX-04 边界登记）。
- 审查正文只做「打开文件」，结构化展示属 FR-6（P2）。

## 五、变更清单

- 新增 `extension/` 独立包（src 19 文件 + test 19 文件 + 脚手架，不进主仓构建链与闸门）。
- 修改 `.gitignore`（+`extension/.vscode-test/`、`+extension/*.vsix`、`+extension/out-test/`、`+!extension/src/env/` 反忽略）。
- **未改**：`src/**`、`skills-src/**`、`skills/**`、`test/**`、主仓构建配置、`.trivium/config.yaml`（AGY-03 裁决）。
- 工作树中另有本批之前已存在的用户改动（`.trivium/config.yaml` 的 default_critics/timeout、`doc/08_project/README.md`、未跟踪的 v2 计划文档），本批未触碰。

## 六、代码审第 1/5 轮修订记录（20 条全接受，见 response 件）

- 两条阻断（CLAUDE-01/CODEX-01）：`.gitignore` 无锚定 `env/` 规则吞掉 `extension/src/env/` 三模块——已加 `!extension/src/env/` 反忽略并经 `git check-ignore` 验证三模块进跟踪面。
- AGY-01：`extension/out-test/` 86 个编译产物已忽略（生成物不入库）。
- CLAUDE-02：解释器只认绝对路径 runner（zcode 探针的 `runner: 'node'` 是能力标识）；拿不到绝对路径即点火失败明示，不静默回落 PATH。
- CLAUDE-03：preflight 透传 profile/模型/档位类旗标（`--topic/--max-rounds/--context` 不传）；桩记录 argv，集成测试断言。
- CLAUDE-04/CODEX-06：重试耗尽登记 30s 低频重发现（至定位或 dispose）；发现期按 runId 去重防并发双建。
- CLAUDE-05/CODEX-04：`--status` 按真实形状双读嵌套 `status`；复核三态（CLI 终态→修正终稿并 dispose / CLI 仍在运行→恢复监控 / 复核失败→文件终稿+注明）。
- CLAUDE-06：卡片 `ended` 标志 + note 恒展示；闸门回落后不再伪装运行中、不再提供中止。
- CLAUDE-07/AGY-02/CODEX-05：服务订阅返回 Disposable、驾驶舱关闭即退订；Cockpit 单例 + reveal；异步路径 await 后复查 disposed。
- CLAUDE-08：前置链成功冻结表单快照，点火校验一致性（宿主+Webview 双侧），变更即强制重跑前置链。
- CODEX-02：locateRunDir 归属校验（桶前缀过滤 + status.json topic 比对），判别不了不接管；四组跨桶用例。
- CODEX-03：StateWatch 订阅即回放最近快照（晚订阅不丢初始扫描）。
- CODEX-07/AGY-04：config/state/status 三源 schema 结论汇总 worstVerdict，命中即降级只读（禁点火+横幅）；RunWatch 上报 schemaIssue。
- AGY-03：终端复用前查 exitStatus，已退出即移除重建。
- CODEX-08：子进程输出分块收集 Buffer、收尾整体解码；跨块中文逐字节用例。

**修订后 verify**：extension check 全绿（单测 56 + 集成 28）；e2e 2/2；`git check-ignore` 验证 src/env 三模块不再被忽略、out-test 已忽略。

## 七、代码审第 2/5 轮修订记录（13 条全接受，见 r2-response 件）

第 2 轮判「修改后通过 → proceed」。修订后 verify：**extension check 全绿（单测 59 + 集成 34）；e2e 2/2**。

- CLAUDE-01/AGY-r2-01/CODEX-01（三侧同点）：面板关闭 ≠ 实例销毁——onDidDispose 只做面板级清理（清 runs/panel），实例与服务订阅保留，可再次打开（集成测试覆盖打开→关闭→再打开、订阅数恒定）；open() 时显式重扫 state 消除订阅竞态。
- CLAUDE-02/CODEX-02：locateRunDir 收紧——repoHint 零命中不接管（等本仓目录）、expectTopic 必须唯一命中（0 或 >1 均不接管）；负向单测 ×3。
- CLAUDE-03：`--driver-model/--driver-provider` 纳入 preflight 透传面，集成断言扩展。
- CLAUDE-04：闸门回落统一收尾 `finalizeEndedRun`——无论有无快照都复核一次 `--status`（成功按 CLI 构造终稿、失败注明），随后释放全部监控资源；集成测试覆盖（含 --status 复核为 failed 的终稿）。
- CLAUDE-05：未 init 时健康树为空 → viewsWelcome 引导生效；视图层测试。
- CLAUDE-06：卡片瞬态 note 全量替换（失联恢复后旧警示清除）；信号面测试。
- AGY-r2-02：pushRuns 守卫 `&&`→`||`（面板未开不检索不广播）。
- CODEX-03：复核期间文件事件记 pendingRefresh，恢复监控时补读；「复核挂起期间落盘终态」集成测试。
- CODEX-04：挂载重试收敛为单例任务（成功即停、dispose 全清）；`hasMountRetry` 可观测 + 目录晚建用例。
- CODEX-05：点火链每个 await 后复查生命周期（停用后不再建终端/注入）。
- 夹具修正：run 桶名对齐真机语义 `<工作区名>-<hash8>`（cockpit 归属过滤依赖它）。

## 八、S10 出口记录

- 第一次 verify（20261105T220656Z）：`npm test` 退出码 1——失败项为主仓 `doctor-deadline.test.js` 的 I4 兜底时序用例（**偶发**：单文件连跑 3/3 绿、本批未触碰 src/、此前干净环境全量 4030/0 亦绿，系全量并发下的时序敏感）。已如实留痕。
- 第二次 verify（20261105T221607Z）：**通过**——typecheck ✓（6.2s）+ build ✓（3.5s）+ test ✓（465.4s），共 475s。
- extension check（D6′ 机械保证，送审前复跑）：单测 59 + 集成 34 + e2e 2 全绿。
