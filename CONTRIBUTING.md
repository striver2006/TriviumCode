# 贡献指南 (Contributing Guide)

感谢您对 **TriviumCode** 项目的关注与支持！我们非常欢迎社区提交 Issue、提出新功能建议或贡献代码。

为了维护高质量的代码库与良好的协作体验，请在参与前仔细阅读以下指引。

---

## 🎯 贡献流程

### 1. 提交 Issue
- 在开始编写重大功能前，建议先在 GitCode / GitHub 提交 Issue 进行技术讨论。
- 如果是汇报 Bug，请尽量提供复现步骤、使用的模型版本、操作系统环境以及异常日志截图/文本。

### 2. 分支模型与开发流程
1. **Fork 仓库**：将本项目 Fork 到您个人的 GitCode 账户。
2. **克隆到本地**：
   ```bash
   git clone https://gitcode.com/your-username/TriviumCode.git
   cd TriviumCode
   ```
3. **创建特性分支**：
   ```bash
   git checkout -b feature/your-feature-name
   # 或者缺陷修复分支：
   git checkout -b fix/issue-number
   ```
4. **本地开发与多智能体审查**：
   - 遵循项目的代码规范与注释规范。
   - 鼓励在本地使用 Driver-DualCritic 流水线针对所改动内容进行自动审查，并在 `.reviews/` 目录下生成留痕报告。
5. **提交 Commit**：
   遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范：
   - `feat`: 新增特性
   - `fix`: 修复缺陷
   - `docs`: 文档变更
   - `refactor`: 代码重构（既不修复 bug 也不增加新功能）
   - `test`: 增加或修改测试用例
   - `chore`: 构建过程或辅助工具变动
6. **推送到远端并创建 PR (Pull Request)**：
   - 详细描述 PR 解决的问题与修改思路。
   - 附上相关的测试结果或多智能体审核总结。

---

## 📋 代码与文档规范

1. **绝对隔离私钥**：切勿将包含真实 API Key 的 `.env` 文件或凭证提交到 Git。
2. **文档规范**：
   - 若增加架构或设计文档，请归入 `doc/` 下对应的一级目录，并遵循文件名前缀命名规则（参考 [doc/README.md](./doc/README.md)）。
   - 严禁在 `doc/` 的一级目录下新建嵌套子目录，保持单层扁平化。
3. **静态检查**：提交前请保证项目内所有代码通过本地 Linter 检查，无报错。

---

## 🤝 行为准则
本项目遵循 [Contributor Covenant 行为准则](./CODE_OF_CONDUCT.md)。参与本项目即意味着您认同并共同维护一个友好、包容与互相尊重的开源社区环境。
