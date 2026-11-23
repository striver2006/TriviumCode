# TriviumCode（三方智鉴）

面向 macOS 与 Windows 的「主攻 + 多方独立审查」编程 Agent 流水线。当前产品版本 **1.3.7**（1.1.0 新增 Windows 原生支持；1.3.0 起 macOS 与 Windows 为同一套代码），支持 Claude Code、Codex、Antigravity、ZCode 四家 Agent 担任 Driver 或审核者；每轮选择 1～3 家审核者，Driver 不审自己的变更。VS Code 驾驶舱扩展（`trivium-cockpit`）经 Marketplace 独立分发，不在安装包内。

Driver 负责起草、代码和逐条裁决；本地 Node 编排器负责预检、后台调度、证据核验、归档、闸门和真实编译测试。审查在工作树中进行，采用检测与留痕机制；护栏按载体分为 L1/L2，具体边界见使用手册。

## 稳定版文档

| 文档 | 内容 |
| --- | --- |
| [需求说明书](doc/01_requirements/需求说明书.md) | 本版本的功能、约束和验收范围 |
| [系统设计说明书](doc/02_design/系统设计说明书.md) | 模块、数据、执行流和安全边界 |
| [部署手册](doc/06_deployment/部署手册.md) | 新 Mac 安装、配置、验收、升级、回退及卸载 |
| [使用手册](doc/07_manuals/使用手册.md) | 四类任务、模型路线、裁决、人工审批与排障 |
| [现存 Bug 与未完成工作](doc/08_project/现存Bug与未完成工作清单.md) | 尚未解决的缺陷、技术债、未测和支持范围 |
| [发布检查报告](doc/05_testing/发布检查报告.md) | 当前检查结果及明确未测项 |
| [版本发布说明](doc/08_project/发布说明.md) | 版本变化与交付约定 |

旧需求、设计、协议、报告和审查留痕均保留在[文档中心](doc/README.md)及 `.reviews/`。M11/M12 已按各自报告所记边界收口；稳定版不代表历史待办清零，也不扩展受限准入证据的适用范围。

## 安装与首次启用

运行需要 macOS 或 Windows（10/11，Git for Windows 为硬前置）、Node.js ≥18、Git ≥2.20，以及实际选用的 Agent CLI 和登录。源码构建与测试使用 Node.js ≥22。Windows 侧进程身份/终止走系统 PowerShell 与 taskkill，`trivium init` 同时生成 sh 与 `.cmd` 两种入口 wrapper；边界与残余见 Bug 清单「Windows 移植残余」。Linux、WSL 本版未验收。

收到预构建包时，核对 `.sha256`、完整解压后运行（Windows 可直接运行包内 `一键安装.cmd`；下列命令在 Windows 上请在 Git Bash 里执行，PowerShell / cmd 的写法见部署手册 §1b）：

```sh
node scripts/install-check.mjs
node dist/install.cjs
node ~/.claude/skills/dual-critic/scripts/trivium.cjs doctor --selftest
```

目标机无需 npm install。然后在自己的 Git 项目根执行：

```sh
node ~/.claude/skills/dual-critic/scripts/trivium.cjs init
./.trivium/bin/trivium doctor --no-model-calls
```

按部署手册配置实际审核集合，执行需要的真实 doctor 探针和 preflight。静态探针与桩自检不证明真实 CLI 或客户端 Hook 可用。`trivium` 有意不加入 PATH，项目内使用 wrapper；新机必须重新 init。

## 四条正式入口

| 任务 | Claude / Antigravity / ZCode 桌面 | Codex | 终点 |
| --- | --- | --- | --- |
| 全流程 | `/dual-run` | `$dual-run` | 方案、审查、编码、应答、改码、真实编译测试 |
| 已有计划 | `/dual-review-plan` | `$dual-review-plan` | 修订与人工审批停点 |
| 已有代码 | `/dual-review-code` | `$dual-review-code` | 应答与人工审批停点 |
| 已有根因 | `/dual-review-bug` | `$dual-review-bug` | 修订结论与人工审批停点 |

ZCode 命令行使用 `/skill <名字>`；辅助入口为 dual-status、dual-approve、dual-abandon。用户明确决定后才能批准；审查进行中与审批期不得修改业务代码。

产品内置 Driver 为 Claude、默认审核者为 Gemini/GLM/Codex；本仓开发约定以 Codex 主攻、共享配置选择 Claude/Gemini/GLM，两者分别生效。换 Driver 应同时选择不含自己的审核者。Claude L1，ZCode L2 尽力 Hook，Codex/Antigravity L2。

## 源码构建与分发

```sh
npm ci
npm run check
npm run release
```

`check` 执行类型检查、构建和全量测试；`release` 构建后按**当前平台**生成安装包、校验文件及解包目录：macOS 上为 `dist/releases/TriviumCode-<版本>-macos.tar.gz`，Windows 上为 `dist/releases/TriviumCode-<版本>-windows-x64.zip`，两个平台的包要分别在对应平台上构建。完整手册 PDF 由 `node scripts/build-manual-pdf.mjs` 生成，目前只能在 Windows 上跑（用 Edge 无头模式渲染）。正式包要求工作树干净，验证 CLI 版本与构建输入指纹。提交前预览：先 `npm run build`，再 `node scripts/package-release.mjs --candidate`。

分发包包含运行时、已登记载体入口、carriers、中文文档、许可、版本来源和文件哈希，不包含账号、本机配置、运行目录、审查原件或 node_modules。源码和历史测试原件请在本仓查阅。未提供自带 Node 的 App 或 Apple 签名/公证。

开发约定见 [AGENTS.md](AGENTS.md)、[开发指南](doc/04_development/GUIDE_env_setup.md)及 [贡献指南](CONTRIBUTING.md)。许可：[Apache-2.0](LICENSE)。
