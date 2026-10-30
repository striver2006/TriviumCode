# 问题单（issues.md）

批次：four-agent-win-20261029-211334 ｜ 基线：`4bd1d0d50d15d9641156598487bea7fcae5f751f` ｜ 机器：Windows 11 Pro 26300 真机（Lenovo REN7000K，i9-10900/32G）

状态分类：产品缺陷 / 账号网络与路线 / 测试装置 / 流程偏差 / 待定位。

---

## ISSUE-01（P1 · 产品缺陷）BRIEF 引用工作区外 schema 绝对路径，agy 侧必然软拒绝

- 用例：W2-B2（claude Driver 审 gemini）｜ run：20261029T135042Z
- 现象：gemini 审核者 zero 响应，fail_reason「工具被 headless 软拒绝且无任何输出：read_file（issue #548）」
- 根因（stdout.jsonl 第 34/35 事件实锤）：BRIEF 第 188 行写「schema 在：`C:\Users\k_bo\.claude\skills\dual-critic\schema\review.v2.json`」。
  该路径在审查工作区（项目根）之外，agy 1.4.10 headless 拒绝越界读
  （`permission check failed for read_file ... user denied permission`），模型被告知 Proceed 后未输出任何 JSON 即结束。
- 影响：任何 agy 审核者侧（gemini）在带工作区权限边界的客户端上**必然失败**——与被审内容无关。
- 复现：`view_file` 读该绝对路径 → TOOL_ERROR permission check failed；BRIEF 内联了字段要点但模型仍尝试读完整 schema。
- 建议（另起变更，不在本验收修）：BRIEF 内联完整 schema，或把 schema 副本放进运行目录（工作区内）再引相对路径。
- 证据：`45-B3…` 不涉及；`W2-B2/run-artifacts/`、`41-B2-claude-driver.log`、runs 目录 stdout.jsonl。
- 是否继续：不继续该侧；其余用例不受影响。

## ISSUE-02（P1 · 产品适配缺口）ZCode CLI 0.17.0 只读旗标探针停在模型选择，glm 审核者 fail-closed 禁入

- 用例：W2-B3（agy Driver 审 glm）｜ doctor：42-B3-doctor-zcode.log
- 现象：探针 3 个只读旗标候选（`--mode plan` / `--mode yolo` 等）全部「未识别的失败形态（退出码 1）：Error: Select a model before sending a message」→
  readonly_flags 未判定（保留 []）→ preflight「只读能力可用」退 69，recalibration 判不可修。
- 根因：P-29/P-30 机理在新版演化——0.16.x 的「空 HOME/仅内置配置停在配置解析」前提在 0.17.0 失效，旗标探针路径现在停在**模型选择**层，
  无法据「没报 Unknown option」判定旗标接受与否。产品按 fail-closed 拒绝（正确），但 glm 侧在本机不可准入。
- 旁证：headless 哨兵读取本身通过（哨兵命中=true、生效模型回读 bigmodel-plan/GLM-5.3、read 工具计数 1）——是**旗标判定**缺口，不是读取能力缺口。
- 影响：ZCode CLI 0.17.0（当前 Windows 桌面端自带版本）上 glm 审核者全部禁入。
- 建议：探针针对 0.17.0 增加模型层前置的判定路径（例如旗标探测时显式选一个模型再判参数错误）。
- 是否继续：不继续该侧。

## ISSUE-03（P1 · 账号网络与路线）本机 codex 仅有第三方路线且 read-only 沙箱负对照失败

- 用例：W2-B4（zcode Driver 审 codex）｜ doctor：30 与 44（两夹具复现）
- 现象 A：doctor 退 69，blocker「codex 只读沙箱负对照失败：-s read-only 下文件仍被创建」。
- 现象 B：产品默认 codex 模型 `qwen3.8-flash` 不在本机目录（本机 ccswitch profile 仅 kimi-for-coding* / k3.1-pro*），
  不带路线参数的 preflight 退 64；带 `--profile-codex ccswitch --model-codex kimi-for-coding` 后 slug 过、仍被「只读能力可用」拦（退 69）。
- 定性：**只读失守信号由产品探针实测捕获并正确拦截**（fail-closed 行为通过验收）；本机无官方 OpenAI 凭据，第三方 kimi 路线沙箱失效，
  属环境/账号侧问题，非产品缺陷。按计划 §2.3/§7.2 停止该侧接入。
- 是否继续：否，待该机 codex 具备沙箱有效路线（或官方凭据）后另批复测。

## ISSUE-04（P1 · 账号网络与路线）本机 Claude Code 走第三方网关，探针隔离环境 headless 读取未证实

- 用例：W2-B1（codex Driver 审 claude）｜ doctor：31、31b、47（三次一致）+ 46 会话日志
- 现象 A：doctor 探针三次报「headless 未读到哨兵文件 / 读文件探针未得出结论」；preflight「只读能力可用」退 69；
  codex Driver 自动校准一轮后按契约停止。
- 现象 B：手动复现 `claude -p` 读取**成功**（读到文件、stream-json 事件流正常）。启动横幅暴露实际路线：
  `[claude-code:unrecognized_model] {"model":"qwen3.8-flash[1m]"}` + 请求经 `token-plan.cn-beijing.maas.aliyuncs.com` 网关。
- 定性：探针的隔离/受限环境形态下调 claude 失败（隔离副本缺第三方网关配置/凭据的迹象）；直连环境正常。
  产品 fail-closed 拒绝（正确）。**模型身份如实记录：claude 客户端经第三方网关跑 qwen3.8-flash[1m]，
  不可据此宣称 Anthropic 官方模型通过**（计划 §1.2 口径）。
- 另记：stream-json 里 Claude Code 提示「Git Bash wasn't found … SessionStart hook ran in PowerShell」——claude 进程视角缺 Git Bash PATH，与本验收 pin Git for Windows 的环境适配一致。
- 是否继续：否；待本机 claude 具备探针隔离环境可用的路线后另批复测。

## ISSUE-05（P2 · 待定位）全量首跑 3 个集成测试一次性失败，具名复跑 18/18 通过

- 用例：W1-01 ｜ 首跑：11-check.log（tests 3136 / pass 3089 / fail 3 / skip 44）
- 失败项（时间集中 21:18–21:19）：
  1. `diff-pathspec-env.test.js` EV-222 W（GIT_LITERAL_PATHSPECS=1）——worker 失联（pid_gone）
  2. `plan-final-gate.test.js` I3——运行未成功收尾（退 1）
  3. `plan-final-recheck.test.js` C1——运行未成功收尾（退 1）
- 复跑：`16-diag-rerun.log` 一次具名复跑 18/18 通过、0 失败。
- 定性：Windows 高负载下的时序性失败（worker 子进程存活判定/启动竞速），疑似 flaky；按计划不放宽、不豁免，首跑现场保留。
  建议：后续在 Windows CI 上观察复现率；若复现，定位 worker 进程观察（ps -o lstart= 的 Windows 等价实现）在高并发下的采样稳定性。
- 是否继续：继续（不影响后续步骤判定）。

## ISSUE-06（P2 · 流程偏差）安装前未备份本机旧 TriviumCode 用户级安装即覆盖

- 计划 §4.2 要求先备份待覆盖文件并记录哈希；本批直接执行了安装（16a/16/17 三步均通过，无同名冲突告警）。
- 影响：无法一键回退到安装前版本；旧版可从 git 历史（1.3.2 基线 642a238e 或更早）重建。
- 处置：已在 manifest 与本单如实登记；保留本批安装（与基线一致）。

## ISSUE-07（P3 · 环境适配记录）

1. 计划默认 `C:\Work\*`，本批改用 `D:\Work\*`（原仓库与 Git 均在 D 盘，C 盘仅 82G、D 盘 3.1T）。
2. shell PATH 将 git/sh 解析到 MSYS2/ucrt64 布局目录；按计划 §3.3 显式 pin `D:\Program Files\Git`（git 2.56.0.windows.3），
   未改全局 PATH。
3. PS 5.1 无 BOM UTF-8 脚本按 ANSI 解码：含中文字面量的脚本报错/路径乱码（W1-03 首次失败实锤），harness 改为
   ASCII-only + 通配符定位中文目录，符合计划 §3.1 的 BOM 要求精神。
4. cmd.exe 经 Git Bash 调用时 `/c` 被 MSYS 转成路径，需 `//c` 转义——wrapper 本身无问题。

---

## ISSUE-08（P1 · 产品缺陷）Windows 上 agy 会话派生的 detached worker 随工具通道结束被杀

- 用例：W5-D 首跑（agy Driver）+ B3r 首跑（同形态回看）｜ 现场：ext-runs 下 run 目录完整保留
- 现象：agy `--dangerously-skip-permissions -p` 会话内 `review --start` 派生的 worker 在 12~15 秒内静默消失
  （worker.log 止于「第 1 次尝试」、无终态、`worker_lost(pid_gone)`），codex/claude 会话与终端直接派生均存活。
- 定性：Windows Job 继承——detached spawn 逃不出 agy 工具通道的 Job，通道结束即整树收杀。次生：worker 被杀时
  审查 CLI 成孤儿（本批实测：PID 56496 持 agy 日志锁，致后续 agy 探活连锁失败；核对命令行属本批后已结束）。
- 建议：Windows 专用派生通道（逃 Job：CREATE_BREAKAWAY / 中间 shell / WMI），并在 worker 失联收尾时清理本 run 的 CLI 子树。

## ISSUE-09（P1 · 环境与产品适配）本机 Claude L1 Hook 三层失效（W4-S3 未达成）

- 现象：闸门停点期 claude 会话 Write 业务 canary **未被拦**（三次实验，事件流佐证 75/76/77 号日志）。
- 三层成因：① 事件流无 PreToolUse hook_started——项目级 hooks 未注册（含手工加信任条目后仍未注册）；
  ② claude 2.1.302 报「Git Bash wasn't found」——其探测清单不含 D:\Program Files\Git 的自定义安装，PATH 注入无效；
  ③ hook 命令为 `sh -c` 形态，sh 解析不到时失败即放行（非阻断）。
- 定性：L1 以「原生 Hook 安装和实测成立为条件」（QUICKSTART §5.2）——本机实测不成立。Git 装回默认路径可验证①②；
  ③属产品 Windows 适配缺口（hook 命令去 sh 依赖），建议另起变更。
