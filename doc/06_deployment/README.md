# 06_部署与运维 (Deployment & Ops)

本目录直接存放所有部署架构、持续集成（CI/CD）与应急运维手册（扁平结构，无子目录），通过文件名前缀区分文档类型。

---

## 文件命名规范

| 前缀 / 格式 | 文档类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `DEPLOY_<名称>.md` | 部署指南 | 宿主机/容器部署步骤、环境变量注入与服务拉起流程。 | `DEPLOY_local_runner.md` |
| `CICD_<名称>.md` | 流水线配置 | GitHub Actions / GitLab CI 自动化流水线说明。 | `CICD_pipeline_spec.md` |
| `RUNBOOK_<名称>.md` | 运维处置手册 | 针对线上/运行期故障的应急处置 SOP 与排错步骤。 | `RUNBOOK_api_rate_limit.md` |
| `MONITOR_<名称>.md` | 监控告警规范 | Token 配额告警、请求延迟、失败重试指标监控。 | `MONITOR_token_quota.md` |

---

## 应急处置原则
当遇到模型服务熔断、本地文件锁定等问题时，请优先参考 `RUNBOOK_*.md` 文档执行标准化排查操作。
