# TriviumCode 驾驶舱（VS Code 插件）

TriviumCode「主攻 + 多审」双审流水线的 VS Code 前端。**集成面两条 + 一个写例外 + 一个只读查询**：

- **CLI**：`.trivium/bin/trivium --json` + 退出码协议（含 FR-9 的 approve/abandon 审批动作——点击经宿主直发，不经过任何模型上下文）；
- **文件面**：只读 watcher（state.json / status.json / `.reviews/**`）；
- **唯一写例外（FR-8）**：裁决件经**预览确认后**的新建与写回（`.reviews/<主题>/<阶段>/` 下 `trivium.disposition.v1` 契约件；防覆盖与正确性由编排器 `gate --check` 兜底）；
- **只读 git 查询（FR-9 提示性摘要）**：`git status --porcelain -z`（纯只读；权威口径以 approve 输出的 worktree_summary 为准）。

不复制编排器业务逻辑，阶段循环始终由终端里的 Driver 会话（入口 skill）驱动。

## 功能（第三批：Phase 0 + Phase 1 + Phase 2 + Phase 3）

- **环境健康面板**（Activity Bar「Trivium」）：读取 `.trivium/config.local.yaml`
  探针结论展示四家 Agent 可用性 / 版本 / 入口；未 init 的工作区给出引导。
- **装配表单**：Driver 单选 / 审查者多选（探针驱动、自动排除与 Driver 同身份项）、
  入口 A/B/C/D、`--max-rounds`、模型档位高级折叠、context 路径选择。
- **前置链**：`topic resolve → preflight → 主题确认 → topic claim`（入口 A/B），
  全部经 wrapper 调用；退出码 64/65/69/70 语义化展示。
- **M1 终端协同**：按探针 entrypoint 拉起交互会话（命名终端、按
  `agent|topic|entry` 身份键复用），就绪延迟后注入入口命令；失败回退可复制命令条；
  输入框续话尽力中继；终端关闭自动降级为 M3 纯监控。
- **运行监控**：`state.json` 白名单发现 run → 运行目录 `status.json` watcher
  （阶段条、逐侧状态卡、30s 周期心跳失联重估）+ `worker.log` 尾随 +
  `--cancel` 中止按钮；侧完成即在 `.reviews/` 归档中列出审查正文入口。
- **审查意见结构化展示**（Phase 2，FR-6）：消费 `_meta/review-*.json`
  （review.v2，逐文件降级）→ 意见列表（按审查者分组、severity 分级、侧完成实时
  刷新）→ 行内批注（VS Code Comments；location 归一含逗号多区间、行号 fuzzy、
  快照一致性两层判据，漂移一律显式标注）→ Problems 面板（blocker/major→Error、
  minor→Warning、nit→Information）→ Diff 视图（**该轮冻结基线**对比当前文件；
  新增/删除/对象缺失降级明示）；同一文件多家意见分层合并、可逐家开关。
- **运行历史**（Phase 2，FR-7）：Activity Bar「运行历史」树——主题 → 运行两级
  （时间倒序、逐轮意见数与严重度分布、verdict）；完结运行以 `_meta/` 归档为
  第一事实源（不依赖可被轮转清理的 run_root）；点击任意运行回放该轮全部意见
  （批注/诊断/意见列表聚焦），状态栏可快捷切换回放轮次。

> 第一批（Phase 0+1，2026-11-06 交付）不含后两项；上方清单为当前累计能力。

- **裁决台**（Phase 3，FR-8）：消费 `gate --check --json` 缺口清单 → 驾驶舱逐条
  「接受/驳回/暂缓 + 理由 + 落点」表单（首写/修复两形态：missing_disposition 首写
  建表含 fallback 期望集；既有件的 empty_reason/missing_action/缺裁编号进修复模式，
  合法行保留原文）→ 生成 `trivium.disposition.v1` 契约草稿（front-matter 七字段、
  addresses 派生自 `run-<runId>.json`.artifacts[]、role 取当轮 Driver 的 run 权威源）
  → **预览确认后落盘**（本插件对 `.reviews/` 的唯一写入；起草独占创建，修复原子
  替换 + 载入 hash 防并发覆盖）→ 落盘即自动重跑 gate 校验，不过即回修复模式闭环。
  三种裁决理由均须人工非空输入；缺口里的意见编号可点击定位到行内批注。
- **人工审批**（Phase 3，FR-9）：`state.json` 感知 `awaiting_approval` → 驾驶舱
  浮出闸门区：计票（gate 输出的 round_verdict 原样展示，与历史树 verdict 同源）+
  warnings 一等展示 + 工作树摘要（点击前为相对 HEAD 的提示性口径并明示盲区；
  批准后展示编排器权威 worktree_summary）+ 批准 / 拒绝（理由必填人工输入）/
  放弃（二次确认）三按钮。点击动作经宿主直发 CLI，不经过任何模型上下文；
  不自动审批、不倒计时。
- **保存防护与三色灯**（Phase 3，FR-10）：状态栏 🟢 自由编辑 / 🟡 闸门等待 /
  🔴 审查中锁闭。**API 边界如实声明**：VS Code 没有取消保存的 API（will-save
  挂起共享 1.5 秒预算），本插件承诺「事前预警（编辑期 modal）+ 事中警示（保存
  瞬间快照与 toast）+ 事后一键恢复（原子写回保存前内容，修改可 Ctrl+Z 找回）」，
  不承诺阻止写盘；`state.json` 不可读时按锁闭保守处理。`.reviews/`、`.trivium/`、
  `.vscode/` 不拦。
- **装配预设**（Phase 3，FR-11）：装配参数（Driver/审查者/入口/轮次/高级项）存为
  命名预设，双作用域（工作区级 workspaceState / 用户级 globalState，均不落仓库
  文件）；加载只回填装配参数，不覆盖正在输入的主题与正文；不写 `.trivium/` 任何
  yaml。

## 平台边界

第一批与第二批的开发、测试与验收均在 **macOS**；Windows 适配为后续批次待办。

## 开发

```bash
npm install          # 安装依赖
npm run check        # typecheck + 打包 + 单测 + 集成测试（vscode-tests 起真实 extension host）
npm run package      # vsce 打包 .vsix
```

集成测试首次运行会下载 VS Code 测试运行时（缓存于 `.vscode-test/`，已 gitignore）。
