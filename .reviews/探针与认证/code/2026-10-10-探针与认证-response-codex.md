---
schema: trivium.disposition.v1
topic: 探针与认证
stage: code
role: codex
kind: response
run_id: 20261009T153637Z
addresses:
  - 2026-10-09-探针与认证-claude.md
  - 2026-10-09-探针与认证-gemini.md
  - 2026-10-09-探针与认证-glm.md
---

# 探针与认证代码审查逐条裁决

| 编号 | 裁决 | 理由 | 修改落点 |
| :--- | :--- | :--- | :--- |
| CLAUDE-01 | 接受 | 所选路线的启动器与环境取版本，基准取该路线 probe，不能使用原生入口或全局版本。 | adapter 路线探针接口、preflight |
| CLAUDE-02 | 接受 | 没有进入模型段不刷新付费能力时间；旧版本能力也不能换新版本身份。 | Codex probe 早退与离线测试 |
| CLAUDE-03 | 接受 | 未解析出模型时不跑付费能力、不写路线准入；实际请求模型与判据同源。 | doctor、Claude probe 与测试 |
| CLAUDE-04 | 接受 | 与接入主题启动证据修复合并，spawn失败实际入口必须null。 | exec、access 与失败测试 |
| CLAUDE-05 | 接受 | 现有集成测试已经以夹具HOME注入，非零覆盖；补单独profile变化导致旧条目失效的因果断言，无需新增生产配置根。 | claude-profile 集成测试 |
| CLAUDE-06 | 接受 | Doctor模型覆盖改为显式类型和CLI接线，脚本不再用未声明的tierFlags.model侧信道。 | DoctorOptions、CLI、预算脚本与桩测试 |
| CLAUDE-07 | 接受 | 保留不可改写的原始证据，披露第一批尚无预占文件；后续记录脚本哈希、启动类别，计划目录变更显式登记。 | 验收报告与预算脚本 |
| CLAUDE-08 | 接受 | 按用户已定原生官方登录语义保留清理，补文档说明；不恢复原生兼容网关认证。 | 设计、ADR、本机坑与原生桩测试 |
| CLAUDE-09 | 接受 | 检查注释随参数前置顺序更新。 | preflight 注释 |
| GLM-01 | 接受 | 与CLAUDE-01和接入GLM-02合并，路线版本互不牵连，缓存同源。 | routeProbe、版本检查与认证缓存 |
| GLM-02 | 接受 | 按路线探针派生轨迹能力；被拒操作未测或证伪均不能宣称阴性可信，保留告警和能力对账。 | adapter capabilityFor、review/guard 与测试 |

第一轮实际审核者均为claude、gemini、glm；审查进行期间未改业务文件。意见为零的审核者仍纳入addresses。白名单外工具尝试和consulted覆盖告警按原留痕保留，跑后复算未检出工作树改动。

接受项按表实施后运行离线回归、变异、正式verify、两次串行完整check及最终重装。48次真实能力预算已用尽，未完成路线验收继续标未测。软件版本不变。

本轮入口A不产生人工审批停点；本会话用户授权仅在实际出现审批停点时直接通过并保留记录，不虚构审批。
