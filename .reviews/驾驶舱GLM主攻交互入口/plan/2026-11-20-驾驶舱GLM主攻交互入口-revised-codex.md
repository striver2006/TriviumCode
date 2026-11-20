---
schema: trivium.disposition.v1
topic: 驾驶舱GLM主攻交互入口
stage: plan
role: codex
kind: revised
run_id: 20261120T062746Z
addresses:
  - 2026-11-20-驾驶舱GLM主攻交互入口-glm.md
  - 2026-11-20-驾驶舱GLM主攻交互入口-gemini.md
  - 2026-11-20-驾驶舱GLM主攻交互入口-claude.md
---

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
|---|---|---|---|---|---|
| GLM-01 | glm | minor | 接受 | 同键已有会话应维持续话上下文 | 先复用活会话、展示原路径；改设置须关终端后重开，补复用测试。 |
| GLM-02 | glm | minor | 接受 | 直接启动器会再次调用 Node | 用官方安装脚本在全新临时前缀生成可执行命令，采集进程路径与独占日志内 turn.started/completed；另以夹具断言环境。 |
| GLM-03 | glm | minor | 接受 | 目录名不能单独证明缺依赖 | 三类来源统一核对 realpath 的 ZCode.app/Contents/Resources/glm/zcode.cjs 布局、外部动态 import('@zcode/tui') 与按入口祖先查找的 node_modules/@zcode/tui 目录，未知布局放行。 |
| AGY-01 | gemini | major | 接受 | Driver 与审核者下拉共用健康判据 | 驾驶舱允许选 GLM 主攻、点火时核入口；健康行明确为后台，审核者继续由 probe 控制。 |
| AGY-02 | gemini | major | 接受 | 工作区设置可选择进程 | 两项使用 machine-overridable 并以当前根 URI 获取；扩展沿用默认受限工作区禁用策略，再在 GLM 点火时显式检查 isTrusted，拒绝先于认领。 |
| AGY-03 | gemini | major | 接受 | 点火失败应可无副作用重试 | 先查活会话，再对新会话只读解析，后认领；复用不重注原任务，原设置变更或失效也不影响既有会话。 |
| AGY-04 | gemini | major | 接受 | 启动模式与 provider 必须按实际来源 | realpath 后缀 .js/.cjs/.mjs 用 Node 及 realpath 参数；无后缀可执行按 shebang 交操作系统。直接命令忽略仅脚本适用的 Node 项，手册明示。仅探针回落且脚本才取两项 provider 环境。 |
| AGY-05 | gemini | minor | 接受 | 异常需要回到可操作状态 | 捕获 GLM 创建/注入异常，GLM 成功提示实际启动元数据与已发送状态；错误文字给设置 ID、菜单与路径修复方式。静态表仅作为旧探针默认说明。GLM 发送设置随当前根读取。 |
| AGY-06 | gemini | minor | 接受 | 入口 B 单续话脚本不能核 A 的两轮续话 | 新增专用入口 A 采样脚本，复用既有安装和工作台辅助函数，以同一会话先忙后闲验证不同答案。最终包命名 trivium-cockpit-0.3.0-glm-entry-e1.vsix 触发现有安装态 E1 回归。 |
| CLAUDE-01 | claude | major | 接受 | 静态模式不能决定新入口的启动方式 | 新解析返回实际来源、路径、模式、Node、探针环境，驾驶舱按此启动。同步模式注释和自动化；原探针冒烟仍独立可跑。 |
| CLAUDE-02 | claude | major | 接受 | 插件设计基线已有多处旧口径 | 先同步 doc/08_project 下 v2 的 C1、M1、架构和对照表，保留不执行登录 shell 的边界。 |
| CLAUDE-03 | claude | major | 接受 | 自动候选失效不能遮挡旧入口 | 显式路径无效立即返回；自动候选不可用跳过，尝试其余候选及原探针，保留桌面缺件原因。 |
| CLAUDE-04 | claude | minor | 接受 | 手册两处旧指引会误导 | 同步 extension/README.md 包名、M1 功能与平台排错段。 |
| CLAUDE-05 | claude | minor | 接受 | 新报告须入目录索引 | 在 doc/05_testing 新增中文报告并登记 README。 |
| CLAUDE-06 | claude | minor | 接受 | 须区分两种入口的真实覆盖 | 分别记录真实与夹具；优先用真实官方安装器生成的 direct 命令验收轮次事件，脚本形态另采样。无法获得的形态写未测。 |
| CLAUDE-07 | claude | minor | 接受 | 本机 3.18.2 曾补原生 keyring | 记录原始包、实测目录和本地 keyring 状态；手册将登录故障指回 Phase 4 实测与对应版本的独立发行目录。 |
