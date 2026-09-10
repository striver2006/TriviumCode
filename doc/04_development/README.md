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
