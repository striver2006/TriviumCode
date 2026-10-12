# M11 第12步逐判据验收矩阵

逐条记录本轮实跑；历史仅辅助，CLI或桩不替代真实客户端。预计启动按发布的批次共享。可选9.6、11.7单列。

| 剧本 | 判据 | 要求 | 执行载体 | 所需路线 | 批次与预计启动 | 人工参与 | 证据 | 状态 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | 1.1 | 全程无需切到另外两个产品的窗口 | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | A批已结束：实耗admission6/review8；2.4计划实时采样在B1补 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | client-a-runs.json, client-session-02.json, client-observation-02.json | 本轮真实客户端实跑通过 |
| 1 | 1.2 | 产出 `plan/` 四件套与 `code/` 三件套 | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | A批已结束：实耗admission6/review8；2.4计划实时采样在B1补 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | client-a-runs.json, client-session-02.json, client-observation-02.json | 本轮真实客户端实跑通过 |
| 1 | 1.3 | S10 的 `verify/` 记录里是**真实执行**的命令与退出码 | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | A批已结束：实耗admission6/review8；2.4计划实时采样在B1补 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | client-a-runs.json, client-session-02.json, client-observation-02.json | 本轮真实客户端实跑通过 |
| 1 | 1.4 | 失败时如实报 `failed`，工件全部保留 | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | A批已结束：实耗admission6/review8；2.4计划实时采样在B1补 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | client-a-runs.json, client-session-02.json, client-observation-02.json | 条件分支未触发：正式review/verify均成功；预检69失败保留已验证 |
| 2 | 2.1 | 能看到 `zcode-cli` 进程；agy 侧能看到 `agy --hub …`（`agy -p` 若没抓到属正常，它只活约 10s） | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | A批已结束：实耗admission6/review8；2.4计划实时采样在B1补 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | client-a-processes.json, client-a-runs.json | 本轮真实进程/运行输出实测通过（代码阶段） |
| 2 | 2.2 | 这些进程的 cwd 都是项目根 | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | A批已结束：实耗admission6/review8；2.4计划实时采样在B1补 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | client-a-processes.json, client-a-runs.json | 本轮真实进程/运行输出实测通过（代码阶段） |
| 2 | 2.3 | agy hub 的命令行里带 `--add-dir=<项目根>` | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | A批已结束：实耗admission6/review8；2.4计划实时采样在B1补 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | client-a-processes.json, client-a-runs.json | 本轮真实进程/运行输出实测通过（代码阶段） |
| 2 | 2.4 | 审查进行中，`.reviews/<主题>/plan/` 里**没有** `-gemini.md` / `-glm.md` | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | A批已结束：实耗admission6/review8；2.4计划实时采样在B1补 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | client-a-processes.json, client-session-02.json | 部分：代码阶段延迟落盘已实测；计划阶段物理目录采样待补 |
| 2 | 2.5 | `~/.trivium/runs/<repo_id>/<run_id>/{gemini,glm}/` 下有原始 stdout 与轨迹 | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | A批已结束：实耗admission6/review8；2.4计划实时采样在B1补 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | client-a-processes.json, client-a-runs.json | 本轮真实进程/运行输出实测通过（代码阶段） |
| 2 | 2.6 | 两侧结论**同时**出现（不是一先一后） | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | A批已结束：实耗admission6/review8；2.4计划实时采样在B1补 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | client-a-processes.json, client-a-runs.json | 本轮真实进程/运行输出实测通过（代码阶段） |
| 3 | 3.1 | 三条命令跑完都停在 `awaiting_approval`，不自动继续 | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | B部分在B1共用8/6；C/D分别发布批次 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 3 | 3.2 | 闸门期改业务文件被 `hook-pre-write` 拦下，提示里给出 `/dual-approve` 与 `/dual-abandon` | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | B部分在B1共用8/6；C/D分别发布批次 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 3 | 3.3 | 归档内的裁决件写入**不**被拦 | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | B部分在B1共用8/6；C/D分别发布批次 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 3 | 3.4 | `/dual-approve` 之后业务写入解锁 | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | B部分在B1共用8/6；C/D分别发布批次 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 3 | 3.5 | 命令 D 的工件落在 `bug/`，**不串到** `plan/` | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | B部分在B1共用8/6；C/D分别发布批次 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 4 | 4.1 | 两次的 `model_effective` 不同，且与各自 `model_requested` 一致 | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 |  | 未测 |
| 4 | 4.2 | `model_effective_source` 是 `envelope` 或 `trace`，**不是** `requested` / `unverified` | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 |  | 未测 |
| 4 | 4.3 | 两侧 `heterogeneous: true` | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 |  | 未测 |
| 4 | 4.4 | `~/.zcode/cli/config.json` 的默认模型**与跑前一致** | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 |  | 未测 |
| 4 | 4.5 | 第二轮产出 `-r2-` 文件，第一轮文件**字节不变** | Claude Code真实客户端 + 编排器 | gemini,glm；需要三审时显式选集合 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 |  | 未测 |
| 5 | 5.1 | 完整时放行 | 真实归档上的Hook直调 + 真实客户端Hook事件 | gemini,glm；需要三审时显式选集合 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | hook-cli.json | 真实归档CLI直调通过；客户端集成未测 |
| 5 | 5.2 | 删掉任一**记录在案**的工件即拦下，并点名路径与它的 `run_id` | 真实归档上的Hook直调 + 真实客户端Hook事件 | gemini,glm；需要三审时显式选集合 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 |  | 未测 |
| 5 | 5.3 | 改动内容同样拦下，并报出「记录 xxx，现为 yyy」 | 真实归档上的Hook直调 + 真实客户端Hook事件 | gemini,glm；需要三审时显式选集合 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 |  | 未测 |
| 5 | 5.4 | 恢复后立即放行 | 真实归档上的Hook直调 + 真实客户端Hook事件 | gemini,glm；需要三审时显式选集合 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 |  | 未测 |
| 5 | 5.5 | 从未跑过审查的仓库**不**被误拦 | 真实归档上的Hook直调 + 真实客户端Hook事件 | gemini,glm；需要三审时显式选集合 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 |  | 未测 |
| 6 | 6.1 | 改角色后缀文件（删 / `sed -i`）任何时候都被拦 | 真实归档上的Hook直调 + 真实客户端Hook事件 | gemini,glm；需要三审时显式选集合 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | hook-cli.json | 真实归档CLI直调通过；客户端集成未测 |
| 6 | 6.2 | 改归档 `_meta/` 或 `task.json` 任何时候都被拦 | 真实归档上的Hook直调 + 真实客户端Hook事件 | gemini,glm；需要三审时显式选集合 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | hook-cli.json | 真实归档CLI直调通过；客户端集成未测 |
| 6 | 6.3 | 删 wrapper 或 `.trivium/` 的状态与锁被拦 | 真实归档上的Hook直调 + 真实客户端Hook事件 | gemini,glm；需要三审时显式选集合 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | hook-cli.json | 真实归档CLI直调通过；客户端集成未测 |
| 6 | 6.4 | heredoc 藏起来的写入同样被拦（判定在未剥 heredoc 的原文上做） | 真实归档上的Hook直调 + 真实客户端Hook事件 | gemini,glm；需要三审时显式选集合 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | hook-cli.json | 真实归档CLI直调通过；客户端集成未测 |
| 6 | 6.5 | 普通业务文件的写命令：闸门期拦、空闲放行 | 真实归档上的Hook直调 + 真实客户端Hook事件 | gemini,glm；需要三审时显式选集合 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | hook-cli.json | 空闲期CLI直调通过；闸门期及客户端未测 |
| 6 | 6.6 | 只读命令任何时候不误伤 | 真实归档上的Hook直调 + 真实客户端Hook事件 | gemini,glm；需要三审时显式选集合 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 | hook-cli.json | 真实归档CLI直调通过；客户端集成未测 |
| 6 | 6.7 | 删掉 wrapper 后再调任意工具，四个拦截型 Hook 报「护栏失效」而**不是**静默放行 | 真实归档上的Hook直调 + 真实客户端Hook事件 | gemini,glm；需要三审时显式选集合 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；破坏性归档负对照由用户在隔离验收副本执行 |  | 未测 |
| 7 | 7.1 | 原稿、修订件（或应答件）的后缀 = 当轮 Driver，front-matter `role` 同 | ZCode与Codex真实客户端 | ZCode主攻显式gemini,codex；Codex主攻显式gemini,glm；都排除当轮Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 7 | 7.2 | `run.json.driver` = 该家、`driver_enabled: true`、`driver_guard_level` 与 QUICKSTART §5.2 的表一致 | ZCode与Codex真实客户端 | ZCode主攻显式gemini,codex；Codex主攻显式gemini,glm；都排除当轮Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 7 | 7.3 | 审核者集合不含当轮 Driver（缺省即另外两家） | ZCode与Codex真实客户端 | ZCode主攻显式gemini,codex；Codex主攻显式gemini,glm；都排除当轮Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 7 | 7.4 | plan / bug 阶段 `task.json.drivers.<阶段>.driver` = 该家 | ZCode与Codex真实客户端 | ZCode主攻显式gemini,codex；Codex主攻显式gemini,glm；都排除当轮Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 7 | 7.5 | 停点话术的调用写法与末句按该家的等级措辞（ZCode「只作尽力拦截、不兜底」；Codex / Antigravity「没有 Hook 拦截」） | ZCode与Codex真实客户端 | ZCode主攻显式gemini,codex；Codex主攻显式gemini,glm；都排除当轮Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 7 | 7.6 | 造缺件、造改工件各一次，`approve` 均退 2 | ZCode与Codex真实客户端 | ZCode主攻显式gemini,codex；Codex主攻显式gemini,glm；都排除当轮Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 7 | 7.7 | 提示语保真：会话留痕里你发出的原文，与 `run.json.topic`、BRIEF 第 2 段焦点逐字一致 | ZCode与Codex真实客户端 | ZCode主攻显式gemini,codex；Codex主攻显式gemini,glm；都排除当轮Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 7 | 7.8 | ZCode：会话留痕里 `review --start` 出自该会话，且没有 `model-io-sess_subagent_*` | ZCode与Codex真实客户端 | ZCode主攻显式gemini,codex；Codex主攻显式gemini,glm；都排除当轮Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 8 | 8.1 | 两轮的 `critics_selected` 都是三家，三份审查文档（`-codex` / `-gemini` / `-glm` 后缀）齐备 | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 8 | 8.2 | 裁决件覆盖三家前缀的全部编号，`gate --check` 退 0；任删一行再跑应退 2 并点名缺的编号（跑完复原） | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 8 | 8.3 | 第一轮 codex 侧 `profile_requested` = `<A>`，第 2 步记下的子进程参数里有 `-p <A>` 与 `-m <模型A>` | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 8 | 8.4 | 第二轮 codex 侧 `profile_requested` = `<B>`；`model_effective` 与 `<模型B>` 一致、与第一轮不同；`model_effective_source` 不是 `requested` / `unverified` | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 8 | 8.5 | 两轮 codex 侧的 `model_provider` 不同；两个 profile 指向的 provider `base_url` 互异 | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 8 | 8.6 | 第二轮产出 `-r2-` 文件，第一轮文件字节不变 | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 9 | 9.1 | 第 3 步的修改没有被任何机制拦下 | Codex真实会话/用户终端（L2） | Codex主攻显式gemini,glm（L2）；不转用Claude受限项目证明 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 9 | 9.2 | 停点话术的末句按 Codex 的等级措辞（「没有 Hook 拦截」一类），与 QUICKSTART §5.2 的表一致 | Codex真实会话/用户终端（L2） | Codex主攻显式gemini,glm（L2）；不转用Claude受限项目证明 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 9 | 9.3 | 第 4 步 `approve` 退 0：审批前复核只核裁决齐备与本轮登记工件的 sha256，不看工作树 | Codex真实会话/用户终端（L2） | Codex主攻显式gemini,glm（L2）；不转用Claude受限项目证明 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 9 | 9.4 | 第 4 步的输出里有「工作树改动摘要」，列出 `<业务文件>`；把第 3 步的改动先提交再审批，摘要照样列出 | Codex真实会话/用户终端（L2） | Codex主攻显式gemini,glm（L2）；不转用Claude受限项目证明 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 9 | 9.5 | 该轮运行记录的 `snapshot.drift.changed` 仍为 `false`：跑后漂移复算在审查收尾时做，闸门期的改动不进这一格，运行记录之后也不再回写 | Codex真实会话/用户终端（L2） | Codex主攻显式gemini,glm（L2）；不转用Claude受限项目证明 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 9 | 9.6 | （对照）第 5 步那一轮 `snapshot.drift.changed` 为 `true`，`policy` 与 MANUAL §5.3「漂移」的默认组合一致（不在被审范围内的文件缺省只告警） | Codex真实会话/用户终端（L2） | Codex主攻显式gemini,glm（L2）；不转用Claude受限项目证明 | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未执行（可选） |
| 10 | 10.1 | 第 2 步退 64 | Claude Code + ZCode真实客户端 | Claude阶段gemini,glm；ZCode阶段gemini,codex，按阶段排除Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 10 | 10.2 | plan 轮运行记录 `driver` = `claude`，code 轮 `driver` = `glm`；code 轮 `critics_selected` 不含 `glm` | Claude Code + ZCode真实客户端 | Claude阶段gemini,glm；ZCode阶段gemini,codex，按阶段排除Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 10 | 10.3 | 复盘第二节「按 Driver」表有 claude / plan 与 glm / code 两行（另各有合计行），**没有**「读不到 Driver」组 | Claude Code + ZCode真实客户端 | Claude阶段gemini,glm；ZCode阶段gemini,codex，按阶段排除Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 10 | 10.4 | 两行的已裁决与接受 / 驳回 / 暂缓分别等于 `…-revised-claude.md` 与 `…-response-glm.md` 裁决表的行数——各自按本轮 Driver 后缀定位，不串档 | Claude Code + ZCode真实客户端 | Claude阶段gemini,glm；ZCode阶段gemini,codex，按阶段排除Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 10 | 10.5 | 各 Driver 组接受 / 驳回 / 暂缓之和 = 第二节全主题采纳率的分子与分母 | Claude Code + ZCode真实客户端 | Claude阶段gemini,glm；ZCode阶段gemini,codex，按阶段排除Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 10 | 10.6 | 「按审核者」表里 glm 的入选轮次只算 plan 轮（code 轮它是 Driver、不入选） | Claude Code + ZCode真实客户端 | Claude阶段gemini,glm；ZCode阶段gemini,codex，按阶段排除Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 10 | 10.7 | `--json` 的 `aggregates.byDriver` 恰有 claude 与 glm 两组，`aggregates.unknownDriver` 没有轮次 | Claude Code + ZCode真实客户端 | Claude阶段gemini,glm；ZCode阶段gemini,codex，按阶段排除Driver | 按后续具名批次发布；分池修订仅为提案，尚未生效 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 11 | 11.1 | 四条参数负对照均退 64；明确不存在的 profile 在预检与准备阶段同样先退 64（EV-232），凭据、服务、入口或只读能力不可用另退 69。四条都列出可用值或点名原因，主题目录下没有新文件 | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 无需 | negative-tier.json, negative-effort.json, negative-glm-effort.json, negative-profile.json, negative-profile-prepare.json | 本轮CLI实跑通过 |
| 11 | 11.2 | 第 1 轮两侧 `tier` = 所选档、`tier_source` = `cli`；`model_requested` 与 `effort_requested` 等于该档里写的值；codex 侧 `profile_requested` 等于该档的 `profile`（档里没写则为 `agents.codex.profile`） | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 11 | 11.3 | 第 1 轮 codex 子进程参数含 `-c model_reasoning_effort=<该档的 effort>`，以及该档 profile 的 `-p` | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 11 | 11.4 | 第 2 轮两侧 `tier: null`、`tier_source: override`（基础组合是裸模型名，只提供模型，被精确值全部盖掉）；`effort_requested` 等于命令行的值 | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 11 | 11.5 | gemini 侧 `effort_effective` 等于实际模型名的档位后缀、来源 `envelope`；第 2 步另给的 `--effort-gemini` 只告警，`effort_requested` 照记、`effort_effective` 仍取后缀 | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 11 | 11.6 | codex 侧 `effort_effective: null`、`effort_effective_source: unverified`（请求值照记，不拿请求值充数） | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 11 | 11.7 | （可选的第 3 步）该轮 codex 侧 `tier` = `<档3>`、`tier_source` = `profile` | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未执行（可选） |
| 11 | 11.8 | 各侧审查文档 front-matter 的 `tier` / `tier_source` / `effort_requested` / `effort_effective` / `effort_effective_source` 与运行记录同值；顶层 `profile` 是本轮的档位表名 | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
| 11 | 11.9 | `report` 第四节的「思考等级请求 / 生效」两列与运行记录一致，`null` 与字段缺席写法分开 | Claude Code真实客户端 + 编排器 | 审核者含Codex；按已探测profile/effort选值；不能由Codex自审 | B1共用：admission8/review6，硬8/6；第二轮另发布，不重复累计 | 客户端操作；新运行审批由Bob逐次决定 |  | 未测 |
