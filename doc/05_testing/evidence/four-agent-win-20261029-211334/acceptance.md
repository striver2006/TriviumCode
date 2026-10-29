# Windows 四家 Agent 真机验收汇总（acceptance.md）

批次 `four-agent-win-20261029-211334` ｜ 基线 `4bd1d0d50d15d9641156598487bea7fcae5f751f`（四家收口 main 提交）｜
执行日 2026-10-29 ｜ 执行人：ZCode 桌面会话（GLM，受托 Driver）｜ 预算：按需授权（见 budget.md）

## 一句话结论

**W0/W1（离线回归）全绿通过；W2 四个单侧 B 无一格走通完整审查链路——四家 Driver 侧准备链路（认领→原稿→resolve→preflight→按契约停止）全部验证正常，
三个格子被产品 fail-closed 准入正确拦截（codex 沙箱失守、zcode 0.17.0 旗标缺口、claude 探针隔离环境未证实），
一个格子暴露产品缺陷（BRIEF 引用工作区外 schema 绝对路径致 agy 软拒绝）。基础验收范围（W0～W4）未整体通过，不宣布「四家全部通过」。**

## 1. 实测环境

Windows 11 Pro 10.0.26300 Build 26300 真机（联想 REN7000K-28IMB，i9-10900/32G，非 VM）；Node v24.19.0；
Git for Windows 2.56.0.windows.3（pin `D:\Program Files\Git`，PATH 的 MSYS2/ucrt64 布局已按计划 §3.3 显式绕开）；
PowerShell 5.1.26100（harness 脚本 ASCII-only 规避无 BOM 乱码坑）；D 盘 NTFS。火绒 + Defender 在位、未关闭。

路线表（本机实测）：

| Agent | 客户端 | 版本 | 本机实际路线 | 模型身份（实测回读/证据） |
| :-- | :-- | :-- | :-- | :-- |
| codex | Codex CLI | 0.163.0 | 第三方 ccswitch → api.kimi.com | kimi-for-coding 家族（**无官方 OpenAI 凭据**） |
| claude | Claude Code | 2.1.302 | 第三方网关 token-plan.cn-beijing.maas.aliyuncs.com | **qwen3.8-flash[1m]**（启动横幅实测；非 Anthropic 官方） |
| glm | ZCode（桌面自带 CLI） | 0.17.0 | 桌面安装内置 provider | GLM-5.3（会话日志 context.model 回读：bigmodel-plan/GLM-5.3） |
| gemini | Antigravity | 1.4.10 | 原生 | gemini-3.8-flash-high（init 事件流回读；审查响应为空） |

## 2. 分层结果

### W0 基线与环境 —— 通过
独立克隆自 origin（gitcode.com/czb99/TriviumCode.git，无内嵌凭据），checkout --detach 基线，rev-parse 比对一致、工作树干净。环境留痕齐备（environment-*.json/txt）。

### W1 零模型回归、安装与 Windows 特性 —— 通过（含两条偏差记录）
- **W1-01 自动化**：`npm ci` → `npm run check`（typecheck+build+test）**tests 3136 / pass 3089 / fail 3 / cancelled 0 / skipped 44，563s**。
  首跑 3 失败（diff-pathspec-env EV-222 W、plan-final-gate I3、plan-final-recheck C1；worker 失联/退 1 形态，时间集中），
  按计划做**一次具名复跑：18/18 通过**（ISSUE-05，flaky 待定位，现场保留）。44 skip 为 win32 平台整文件 skip（POSIX 专属），
  与基线自述 macOS 4022+10 的差异属平台预期。render 零漂移（13-render-diff 退 0）；four-agent-scope 3/3；selftest **14/14 步**。
- **W1-02 安装**：`install:check`（前/后）+ `dist/install.cjs` 全过；运行时根 `~/.claude/skills/dual-critic` 与源 bundle **SHA256 一致**；
  四家各 7 入口 + gemini 侧只读 Agent 定义，共 52 文件；**无 Kimi/Qoder 候选残留**。偏差：安装前未备份旧安装（ISSUE-06）。
- **W1-03 中文空格路径**：`W1-03-zh 中文空格` 夹具 init/status/doctor --no-model-calls 全过，路径未乱码、参数未拆散；
  `.cmd`、cmd.exe、Git Bash 三种 wrapper 形态 `--version` 均 1.3.2。
- **W1-04 原子写真实占用**（接本批源码，metafile 核验引用本批 fsx.ts）：场景 A 成功（**422ms**，内容 updated-A，无 .tmp 残留）；
  场景 B 有界失败（**832ms**，原始 EPERM，无残留，**final_content === 'initial' 补充断言成立**）。
- **W1-05 进程树观察**：npm test 期间 15 样本、均值 113/峰值 125 进程，序列平稳无风暴；最深 node 链 13 层为
  bash→powershell→npm→node 测试管道自身，非编排器递归枚举。
- **W1-06**：cancel-way-out 等由全量测试覆盖（win32 路径），未例行重复。
- **W1-07 清理**：见 §5。
- 离线发现：`npm ci` 时 npm allow-scripts 拦截 esbuild postinstall（警告级，构建正常）；zcode 探针入口需在
  config.local.yaml 显式指路（非 C 盘装法，probes/zcode.ts 注明的设计内路径）。

### W2 真实审核者与路由 —— 四格：1 失败 + 3 阻塞；Driver 侧链路四家全部验证正常

| 用例 | Driver（客户端形态） | 审核者 | 结局 | 卡点 | 定性 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| B1 | Codex（codex exec headless） | claude | **阻塞** | preflight「只读能力可用」退 69；claude 探针隔离环境 headless 哨兵 3 次未读到（直连手动读取正常） | 环境/路线（ISSUE-04）；codex Driver 自动校准一轮后按契约停止，行为规范 |
| B2 | Claude Code（claude -p headless） | gemini | **失败** | 审查拉起后 gemini 零响应；事件流实锤 view_file 读 `~/.claude/.../review.v2.json` 被工作区权限拒绝 | **产品缺陷**（ISSUE-01）；claude Driver 全流程规范（原稿/resolve/start/wait/失败转述/未动业务文件） |
| B3 | Antigravity（agy -p headless） | glm | **阻塞** | preflight「只读能力可用」退 69；zcode 0.17.0 三个只读旗标候选停在「Select a model」 | **产品适配缺口**（ISSUE-02）；agy Driver 认领/原稿/预检/停止规范 |
| B4 | ZCode 桌面（本会话，正式 Skill 入口） | codex | **阻塞** | preflight 退 69「只读能力可用」；codex read-only 沙箱负对照失败（写未被沙箱拦）被产品禁入 | 环境/路线（ISSUE-03）；ZCode Driver 认领/原稿/回读/resolve/预检拦截全部正常 |

通过判据逐项：判据 1（run 元数据与请求一致）在 B2 的 run.json 核验通过（driver/entry/stage/max_rounds=1来源flag/requested_routes 均一致、无候选残留）；
判据 2（真实厂商 CLI 启动、无桩指纹）B2 满足（gemini 真实 turn、事件流完整）；判据 3（工具轨迹读项目）B2 的 gemini read=0（正因软拒绝）——不满足；
判据 4（请求/配置/回读分离）B2 满足（requested_routes 记录、init 事件回读模型一致）；判据 5/6 因无一侧出有效结论而未达，但**业务文件零意外写入已在四格核验**（仅 init 资产 untracked）。

**W4 只读与安全边界（部分完成）**：准入拦截即 W4-S 系列的核心证据——
codex 只读沙箱负对照**实测失守并被 fail-closed 拦截**（doctor blocker + preflight 退 69，两夹具复现）；
zcode path_deny 否定对照成立（无路径级 deny，能力边界如实记录）；agy headless 哨兵正对照通过；
claude 只读负对照未完成（探针环境未证实）。W4-01/W4-02 依赖「对应单侧已准入」，四侧皆未准入 → 阻塞。

### W3 原生客户端入口 —— 部分完成
四家**CLI/桌面形态**（claude -p、codex exec、agy -p、ZCode 桌面会话）全部证明：技能被真实加载并按契约执行
（认领→写本方后缀原稿→回读→resolve→preflight→按规停止），原稿后缀与 role 与各 Driver 身份一致
（codex/claude/gemini/glm 各就各位），无冒写他侧后缀。**未达**：审批停点（gate --await-approval）——依赖审查成功，
四格均未走到。ZCode CLI（命令行形态）本机未安装（仅桌面），该格未测。

### W5 A/C/D 与审批扩展 —— 未测（W2~W4 前置未满足）

## 3. 结论边界（不外推）

- 本机 claude 经第三方网关跑 qwen3.8-flash[1m]：即使后续修通，也**只证明该客户端+该路线可用**，不证明 Anthropic 官方模型通过（计划 §1.2）。
- codex 本机无官方凭据、第三方路线沙箱失守：**不证明 OpenAI 官方路线通过或失败**。
- Windows 10、WSL、虚拟机、额外 IDE 插件形态：未测。
- ZCode CLI 命令行形态：未安装，未测。
- W5 全部入口（A/C/D/审批/放弃）：未测，本报告不宣称任何客户端「A/B/C/D 全流程通过」。

## 4. 待 Bob 决定 / 后续

1. B2 产品缺陷（ISSUE-01）建议另起变更修复（BRIEF 内联 schema 或工作区内相对路径）后，B2 路线复测。
2. ISSUE-02（ZCode 0.17.0 探针适配）建议产品侧排期；修复后 B3 复测。
3. ISSUE-03/04（本机 codex 沙箱、claude 探针网关）：需账号/环境侧决策（接入官方凭据或修复第三方路线的沙箱/配置），非产品可修。
4. 四个夹具与闸门状态保留（无活跃闸门——均停在 preflight，未产生待审批件）；无需 approve/abandon。
5. 首跑 3 失败（ISSUE-05）留观 Windows 复现率。

## 5. 清理与残留（W1-07）

- 本批进程：doctor/审查/会话均已结束；无残留本批 node/powershell 进程。
- 临时目录（按创建时间区分，本机 Temp 另有 **1167 个历史 trivium-* 残留不属本批、未代删**）：
  - 已清理（本批、证据已收、无凭据）：原子写实验 `trivium-atomic-live-A/B-*` 两个、selftest 夹具 `trivium-selftest-BL8dRi`；
  - 保留（计划 §4.1 命令 `--keep-fixture` 显式要求）：`trivium-fx-upsRuB`；
  - 历史残留中含 `trivium-codexhome-*` 家族（内见 config.toml / qwen.config.toml，**凭据副本风险**）——
    建议用户择期核对属主后清理，本批未动；无本批 `.tmp-` 残留。
- 源码副本 `git status --porcelain`：干净（零产品源码改动）。
- 克隆仓库、夹具、证据目录全部保留供复测与审查；不删任何 `.reviews` 工件。
- 用户级安装保留为本批版本（与基线一致）；如需回退见 ISSUE-06 的说明。


---

## 复测附记（1.3.3，2026-10-29 深夜，同日执行）

按 Bob 决策修复后复测：ISSUE-01/02 产品修复 + ISSUE-04 两件配置（settings_env_source + 网关模型名），
**B1r / B2r / B3r 三个单侧 B 全部走通**（真实厂商审查 read 7~9、模型回读与请求一致、裁决件 + r2 计划 + 人工停点，
业务文件零改动）。B4 维持阻塞（本机 codex 沙箱失守，ISSUE-03 环境侧）。修复后全量 check 再现同模式
3 个跨进程类失败（另外三个文件，具名复跑通过）——ISSUE-05 升级为 Windows 并发下系统性 worker 稳定性问题。
完整结论见仓库 `doc/05_testing/REPORT_2026-10-29_Windows四家Agent验收.md`。
