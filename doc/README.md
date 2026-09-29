# TriviumCode 软件工程文档中心

欢迎查阅 **TriviumCode** 项目工程文档。本文档中心采用**扁平化单层目录结构**：`doc/` 下仅保留一层分类目录，不再向下嵌套子目录，所有文档类型均通过**规范的文件名前缀**进行区分。

---

## 一、一级目录与文件类型命名规范

| 一级目录 | 中文类别 | 文件命名规范（前缀区分） | 说明与示例 |
| :--- | :--- | :--- | :--- |
| [📁 `01_requirements/`](./01_requirements/README.md) | **需求工程** | `PRD_<名称>.md`<br>`SRS_<名称>.md` | 产品需求文档、软件需求规格说明书、需求矩阵。<br>示例：`PRD_multi_agent_workflow.md` |
| [📁 `02_design/`](./02_design/README.md) | **系统设计** | `ARCH_<名称>.md`<br>`LLD_<名称>.md`<br>`ADR_<编号>_<名称>.md`<br>`PROPOSAL_<名称>.md` | 总体架构、详细设计、架构决策记录、技术调研方案。<br>示例：`ARCH_relay_bus.md`、`ADR_001_file_relay.md` |
| [📁 `03_api/`](./03_api/README.md) | **接口契约** | `API_<名称>.md`<br>`PROTOCOL_<名称>.md` | 外部/内部接口契约、智能体中继数据流规范。<br>示例：`PROTOCOL_agent_relay.md` |
| [📁 `04_development/`](./04_development/README.md) | **开发指南** | `GUIDE_<名称>.md`<br>`WORKFLOW_<名称>.md` | 环境搭建、代码规范、Git 协作流程。<br>示例：`GUIDE_dev_setup.md` |
| [📁 `05_testing/`](./05_testing/README.md) | **测试验证** | `PLAN_<名称>.md`<br>`CASE_<名称>.md`<br>`REPORT_<日期>_<名称>.md` | 测试计划、测试用例、阶段测试评估报告。<br>示例：`REPORT_2026-09-10_regression.md` |
| [📁 `06_deployment/`](./06_deployment/README.md) | **部署运维** | `DEPLOY_<名称>.md`<br>`RUNBOOK_<名称>.md` | 部署架构、CI/CD 说明、应急运维处置手册。<br>示例：`RUNBOOK_token_exhaustion.md` |
| [📁 `07_manuals/`](./07_manuals/README.md) | **用户手册** | `QUICKSTART.md`<br>`MANUAL_<角色/模块>.md` | 快速上手指南、使用手册、管理员指南。<br>示例：`MANUAL_developer.md` |
| [📁 `08_project/`](./08_project/README.md) | **项目管理** | `ROADMAP.md`<br>`MEETING_<日期>_<主题>.md` | 版本排期路线图、方案评审纪要、敏捷记录。<br>示例：`MEETING_2026-09-10_dual_review.md` |

---

## 二、文档编写与通用规范

1. **扁平原则**：各一级目录下直接存放 Markdown 文档，请勿创建二级子目录。
2. **统一编码与格式**：统一采用 UTF-8 编码的标准 Markdown (`.md`) 格式。
3. **元信息头**：所有正式文档开头建议包含：
   ```markdown
   # 文档标题
   
   > - **作者 / 负责人**：[姓名/智能体角色]
   > - **创建日期**：YYYY-MM-DD
   > - **当前版本**：v1.0.0
   > - **状态**：[草稿(Draft) / 评审中(In-Review) / 已批准(Approved) / 已废弃(Deprecated)]
   ```
4. **图表绘制**：优先使用 `mermaid` 源码嵌入，确保版本对比友好。
5. **引用他文档的版本**：判别标准是这句话**指向现在**还是**记当时**。
   - 指向现在的引用（索引条目、文档头与引言里「依据」「规范见」这类说「本文现在以哪份文档为准」的句子）只给链接，注明版本以目标文档的文档头为准，不写死版本号；随代码或随主题增长的计数（模块数、行数、缺口条数）同样不写死。
   - 记当时的引用照写当时的版本：变更记录、「vX 起」这类出处标注、「截至 vX」的时点记述、测试报告、ADR 的关联行、叙述某次改动时它所依据的设计版本（如 LLD 里「M7b 第 6 步放开两处收窄」那段末尾的依据句）、冻结文档的版本。
   - 机器盯住的只是已知的门面指针与已列举的几种计数形态，由 [`test/contract/facade-version-pointers.test.ts`](../test/contract/facade-version-pointers.test.ts) 对账（EV-167）；清单之外新写的指针、新形态的计数仍靠自觉（EV-171）。
