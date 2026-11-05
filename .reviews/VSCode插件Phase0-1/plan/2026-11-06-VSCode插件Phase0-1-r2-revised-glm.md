---
schema: trivium.disposition.v1
topic: VSCode插件Phase0-1
stage: plan
role: glm
kind: revised
run_id: 20261105T170023Z
addresses:
  - 2026-11-06-VSCode插件Phase0-1-r2-claude.md
  - 2026-11-06-VSCode插件Phase0-1-r2-gemini.md
  - 2026-11-06-VSCode插件Phase0-1-r2-codex.md
---

# 裁决与修订计划：VSCode插件Phase0-1（计划审第 1/5 轮）

三侧结论：claude `pass-after-changes`（10 条：阻断 1 ｜ 重要 6 ｜ 次要 3）、gemini `pass-after-changes`（5 条：阻断 2 ｜ 重要 2 ｜ 次要 1）、codex `reject`（8 条：重要 6 ｜ 次要 2）。共 **23 条：接受 23 ｜ 驳回 0 ｜ 暂缓 0**。

三侧独立命中的三处要害（本轮必改）：
1. **入口调用建模**（CLAUDE-01 阻断、CODEX-01、AGY-01 阻断）：单字符前缀模型错误——ZCode 命令行是 `/skill dual-run` 而非 `/dual-run`；且注入文本不应含 `--` 分隔符与 shell 引号（那是 TV 直调的 shell 语法，不是聊天输入语法）。r2 改为**完整调用模板**（终端 CLI 形态）+ 防漂移测试改为对账注册表源码与载体 yaml，不再从产物正文猜前缀。
2. **终端拉起方式**（AGY-02 阻断）：zcode 的 entrypoint 是 `.cjs` 脚本，不能直接当 `shellPath`。r2 按载体声明拉起模式：可执行二进制直启；脚本类经默认 shell + `"<node>" "<entrypoint>"` 激活（node 路径来自探针 runner，兜底解析 wrapper 内嵌绝对路径）。
3. **监控状态机**（CLAUDE-04/05、AGY-04、CODEX-02/03）：活跃态白名单 + run_id 非空 + 历史终态不进活跃看板；run 定位加重试退避与激活期初始扫描（闸门先写、status.json 后建的窗口）；心跳失联加独立于 watcher 的周期重估（无后续事件场景）。

D6（verify.test 接线）裁决说明：claude 认可该机制、gemini 以 v2 计划 §6.0/§9「不并入主仓闸门」为由反对。取 gemini：v2 计划是上位文档且本批硬约束明写「不并入主仓构建链」，保守读法成立；机械保证改为 **S5 内执行 extension check 并留档输出、S6 送审前复跑**（见 r2 §五 第 10 步与 §六），是否接入 `.trivium/config.yaml` verify.test 留给用户后续决策。

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | blocker | 接受 | 核实成立：README 与注册表均区分 ZCode 桌面端 `/名字` 与命令行 `/skill 名字`；前缀模型对 zcode 终端必然生成错误命令，防漂移单测还会错误全绿 | r2 §三 D1′：调用形态升级为**完整调用模板**（每载体终端 CLI 形态：claude `/dual-run`、codex `$dual-run`、gemini `/dual-run`、glm `/skill dual-run`），由 carriers.ts 声明；防漂移测试断言完整模板并对账注册表/carriers yaml，不再只断言首字符 |
| CLAUDE-02 | claude | major | 接受 | 核实成立：命令 A 的 skill 次序是 resolve→preflight→主题确认→claim，插件在确认前 claim 会把未认可主题写进 task.json | r2 §三 前置链改序：resolve → preflight → 主题确认（UI 内回显，含 topic_inferred 提示）→ claim（仅入口 A/B、确认后）；入口 C/D 插件不预认领（认领归会话的 S4.5/S0.8）；并注明终端会话重跑同链路的开销评估（resolve 只读、preflight 可重复、claim 同 Driver 幂等退 0） |
| CLAUDE-03 | claude | major | 接受 | 核实成立：dual-status 是只读查询不建 run，B/C/D 起草期也长期无 run，「30s 无变化=失败」必误报 | r2 §三 D3′：撤销量化失败推断；auto 模式改为「尚未观察到审查启动」信息提示 + 引导核对终端 + 人工重发按钮；不自动重发 |
| CLAUDE-04 | claude | major | 接受 | 核实成立：approved/rejected/abandoned 与 null run_id 的历史残留会被 `state≠idle` 全量捞起 | r2 §三 D4′：活跃白名单 {running, review_done_awaiting_disposition, awaiting_approval} + run_id 非空；历史条目与活跃看板分离（本批历史仅折叠列表不进看板）；补历史残留夹具用例 |
| CLAUDE-05 | claude | major | 接受 | 核实成立：心跳停滞恰恰意味着不再有文件事件，仅靠 watcher 事件检查永远不触发 | r2 §三 D5′：每个被监控 run 配 30s 周期重估定时器（仅非终态运行），独立于文件事件；终态即停并 dispose；补「最后一次 running 快照后零写入」用例 |
| CLAUDE-06 | claude | major | 接受 | 核实成立：status.json 的 artifacts 仅终态填写，原验收承诺逐侧即时正文缺数据面 | r2 §二/§三：文件面新增 `.reviews/<topic>/<stage>/` 目录 watcher（侧完成即归档该侧审查件）与 runDir/<critic>/out/ 存在性检查；验收改为「侧完成即列正文入口可打开（数据面=归档件），artifacts 链接作终态补充」；补夹具 |
| CLAUDE-07 | claude | major | 接受 | 核实成立：同名复用会把「同主题复用」扩大成「同 Driver 复用」，未显式主题时跨任务串话 | r2 §三 D2′：终端身份键 = `agent\|topic\|entry`（topic 取 resolve 后的值，含推导值），复用须键匹配且会话空闲；忙碌/归属不明/主题不同 → 新开终端或请用户选择；显示名不充当身份 |
| CLAUDE-08 | claude | minor | 接受 | 核实成立：cliKey/skill 根/调用模板的事实镜像无对账必静默漂移 | r2 §三 D1′：防漂移测试升级为机器对账——extension 测试直接读 `src/trivium/agents/registry.ts` 与 `skills-src/carriers/*.yaml` 文本，核对 carriers.ts 的 cliKey、skill 根候选与完整调用模板；不取「构建期代码生成」重方案 |
| CLAUDE-09 | claude | minor | 接受 | 核实成立：数值版本与 schema 串无定义映射，原方案不可执行 | r2 §三 D10′：按插件实际消费的文件类型声明支持集 {config: trivium.config.v2, status: trivium.status.v1, state: trivium.state.v1}，逐文件判未知主版本即降级只读；CLI `--version` 数值仅作诊断展示；补新旧组合夹具 |
| CLAUDE-10 | claude | minor | 接受 | 核实成立：部署手册在 doc/06_deployment/，原路径失效 | r2 §三 D10′：引导链接改 `doc/06_deployment/部署手册.md`（使用手册 `doc/07_manuals/使用手册.md` 一并列出），纳入静态存在性检查 |
| AGY-01 | gemini | blocker | 接受 | 核实成立：入口 skill 契约是 `<正文> [旗标]`，注入文本带 `--` 会被 splitArguments 当位置参数，task_goal 永久带 `-- ` 前缀 | r2 §三 D1′④′：注入组装改为 `<调用模板> <正文单行化> <旗标>`——无 `--`、无 shell 引号（聊天输入不是 shell）；util/shellQuote.ts 改为 util/injectText.ts（单行化 + 正文以 `--` 开头的警示），单测同步改写 |
| AGY-02 | gemini | blocker | 接受 | 核实成立：zcode entrypoint 为 .cjs 脚本，直传 shellPath 必 ENOEXEC；shell 里裸跑也缺解释器 | r2 §三 D2′：carriers.ts 按载体声明拉起模式——可执行二进制（claude/codex/agy）直启；脚本类（zcode .cjs）经默认 shell 终端 + `"<node>" "<entrypoint>"` 激活，node 绝对路径优先取探针 runner 字段、兜底解析 wrapper 内嵌路径（仍是「wrapper+探针」单一来源，不碰登录 Shell） |
| AGY-03 | gemini | major | 接受 | v2 计划 §6.0/§9 明文「不并入主仓闸门」，接线拖慢并可能阻断无头环境的日常 verify | r2 §三 D6′（撤销原 D6）：**不改 `.trivium/config.yaml`**；extension check 定为 S5 交付步骤（执行并留档输出）+ S6 送审前复跑；是否接入 verify.test 留给用户后续决策；主仓 verify 原样 |
| AGY-04 | gemini | major | 接受 | 与 CLAUDE-04 同源（历史终态误触发扫描） | r2 §三 D4′（同 CLAUDE-04 落点）：白名单判断 + 活跃/历史分离 |
| AGY-05 | gemini | minor | 接受 | 监视器缺 Disposable 生命周期设计，长会话句柄/定时器泄漏 | r2 §三 D5″：monitor 全模块实现 VS Code `Disposable` 契约——驾驶舱关闭、切换监控主题、run 终态复核完成后统一 dispose（watcher/定时器/缓存）；集成测试补「关闭面板后无残留定时器」断言 |
| CODEX-01 | codex | major | 接受 | 与 CLAUDE-01 同源且补充：注册表 entryInvocation 登记的是桌面端形态，产物正文引用不能证明 CLI 调用语法 | r2 §三 D1′（同 CLAUDE-01 落点）：完整调用模板 + 明确「终端 CLI 形态」语义 + 对账测试覆盖模板本身 |
| CODEX-02 | codex | major | 接受 | 核实成立：setGateChecked 先写 running、初始 status.json 后建（review.ts:1323 → run-protocol.ts:645），首扫可能落空；失败运行回 idle 可能整场被漏 | r2 §三 D4″：激活期初始扫描 + 「闸门 running 而 status.json 未现」的重试退避（5s × 12 轮，即最长 60s 等待创建）；gates 条目从活跃态回落 idle 时，若 run_id 非空则读该 run 的 status.json 终态并以「已结束」提示（不进活跃看板）；补「先写闸门、延迟建 status.json」时序夹具 |
| CODEX-03 | codex | major | 接受 | 与 CLAUDE-05 同源（无事件即无检查） | r2 §三 D5′（同落点）：周期重估 + 「新鲜快照后零写入」用例 |
| CODEX-04 | codex | major | 接受 | 平台边界未声明，Windows 原生路径（.cmd wrapper、Git Bash 假设）无决策 | r2 §〇/§六：本批平台边界明示 **macOS（darwin/arm64）**——开发、测试与验收全部在 macOS；Windows 适配（.cmd wrapper 经解释器执行、shell 夹具改写）登记为后续批次待办，插件代码内 spawn 一律 `shell:false` + 绝对路径（为后续适配减负但不承诺） |
| CODEX-05 | codex | major | 接受 | 核实成立：dual-status 不产生解析产物，桩 e2e 又绕过终端，原验证路径互相错位 | r2 §三 D8′：保真验证拆两层——**通道保真**（fake TUI 字节级比对，自动化：注入文本 === TUI 收到文本）与**入口解析保真**（真机单载体一次全链，比对会话解析出的 task_goal 与表单原文）；两层各自独立成测，不以桩 e2e 冒充 |
| CODEX-08 | codex | major | 接受 | 核实成立：`TRIVIUM_STUB_CRITIC=1` 解析为数字即视为未注入，会回落真实适配器烧配额 | r2 §三 D7′：桩配置改为**按审核者的 JSON 对象**（对齐 test/helpers/fixture.ts 的形态，覆盖本轮入选集合）；启动真实子进程前自检桩配置完整有效（解析失败即中止测试）；保留事后逐侧断言桩指纹 `cli_version: 'stub/0.0.0'` |
| CODEX-06 | codex | minor | 接受 | 与 CLAUDE-03 同源且补充措辞建议 | r2 §三 D3′（同落点）：提示语明确「尚未观察到审查启动」，与「注入失败」区分；重发前引导核对终端状态；矩阵含「成功注入但长时间起草」预期 |
| CODEX-07 | codex | minor | 接受 | 真机会话中的 dual-status 仍经 Driver 模型，非零配额；矩阵无预算登记 | r2 §三 D8″：零配额承诺限定 fake TUI + 桩 e2e；真机矩阵登记预算与上限（每载体会话启动 ≤3 次、注入重试 ≤2 次，超限记「该载体本批未验证」而非继续烧）；dual-status 探针的花费如实标注为「少量配额」 |

## 二、修订去向

逐条裁决已全部接受，修订完整落进 `2026-11-06-VSCode插件Phase0-1-r2-glm.md`（§〇 范围、§一 事实基线、§二 架构、§三 决策 D1′~D10′、§五 步骤、§六 验收）。本轮判「修改后通过 → proceed」，r2 即本主题计划定稿，S5 按它实施。

> 命名说明：本件首次落盘时误用无轮次名 `…-revised-glm.md`，闸门按 rerun_index=2 要求 `…-r2-revised-glm.md`，本件为正名重建（内容一致）；误名原件请在终端自行清理（会话内 Bash 对角色后缀文件只拦不写，属刻意设计）。
