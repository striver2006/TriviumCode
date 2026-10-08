# 04_开发指南与规范 (Development Guidelines)

本目录直接存放所有开发指引、环境准备与协作规范文档（扁平结构，无子目录），通过文件名前缀区分文档类型。

---

## 文件命名规范

| 前缀 / 格式 | 文档类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `GUIDE_<名称>.md` | 开发指南 | 环境配置、工具链安装、本地调试、依赖安装指南。 | `GUIDE_env_setup.md` |
| `STANDARD_<名称>.md` | 编码/规范 | 语言编码规范、静态检查要求、安全规范。 | `STANDARD_coding_conventions.md` |
| `WORKFLOW_<名称>.md` | 协作流程 | Git 分支策略、Commit 规范、智能体双审 PR 流程。 | `WORKFLOW_git_and_review.md` |

---

## 质量要求
- 本地静态分析与 Lint 检查须保持 0 Error、0 Warning。
- 严禁硬编码任何 API Key 或敏感凭据，统一通过环境变量读取。

---

## 当前已归档文件

- [`GUIDE_env_setup.md`](./GUIDE_env_setup.md)：本地开发与调试指南（工具链、产物与目录、分层测试、实现纪律 §16.2、常用调试姿势、改动时的同步清单）。面向修改 TriviumCode 自身的人；只想使用请看 [`doc/07_manuals/QUICKSTART.md`](../07_manuals/QUICKSTART.md)。
- [`GUIDE_local_pitfalls.md`](./GUIDE_local_pitfalls.md)：本机坑清单，`P-xx` 编号的唯一落点，跨里程碑持续追加——各家 CLI 与本机环境的实测行为里，与文档、常识或原先假设不符、会让编排器或验收判据出错的那一类，每条附影响与对策。M11 第 10 步（BACKLOG EV-13）从 M0 探针报告 §7 逐字搬来。
