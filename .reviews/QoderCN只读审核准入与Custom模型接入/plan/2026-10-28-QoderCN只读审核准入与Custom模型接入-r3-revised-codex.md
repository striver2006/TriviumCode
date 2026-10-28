---
schema: trivium.disposition.v1
topic: QoderCN只读审核准入与Custom模型接入
stage: plan
role: codex
kind: revised
run_id: 20261028T090050Z
addresses:
  - 2026-10-28-QoderCN只读审核准入与Custom模型接入-r3-gemini.md
  - 2026-10-28-QoderCN只读审核准入与Custom模型接入-r3-glm.md
  - 2026-10-28-QoderCN只读审核准入与Custom模型接入-r3-claude.md
---

# 14 条逐条裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| AGY-01 | gemini | major | 接受 | 生成器项目根硬编码属实 | §5/6新增目标项目参数与写入边界 |
| AGY-02 | gemini | major | 接受 | 启用必须同步登记与USAGE | §5纳入registry/cli及parity，未准入不启用 |
| AGY-03 | gemini | major | 接受 | 必需项缺失已足以阻塞且需总预算 | §3扩展要求全通过，24调用/60分钟全批限额 |
| AGY-04 | gemini | minor | 接受 | 未调用不应盲重试，状态不能混写 | §3固定prompt/hash，unexposed与真实tool-unavailable分开 |
| GLM-01 | glm | minor | 接受 | 白名单应包含实测登记回填 | §5纳入registry，载体分别实测 |
| GLM-02 | glm | minor | 接受 | 逐格上限不能替代总上限 | §3/4全路线含probe合计24次/60分钟，耗尽未测 |
| CLAUDE-01 | claude | major | 接受 | 真实deny含运行根与未来工件，假覆盖不能授权 | §2/6保留精确覆盖，隔离run_root，真实enumerate端到端对账，扩集重验 |
| CLAUDE-02 | claude | major | 接受 | 最小面真实分发拒绝需要预先固定可观察判据 | §3选择真实tool_use加同ID分发失败，固定prompt，未调用即阻塞 |
| CLAUDE-03 | claude | minor | 接受 | 无调用未暴露与真实分发拒绝不同 | §3及设计/协议同步精确口径 |
| CLAUDE-04 | claude | major | 接受 | WebSearch正控制无法限定loopback | §3允许固定公开查询，不含项目路径与秘密，其它仍限loopback |
| CLAUDE-05 | claude | major | 接受 | 原生有效配置回读可能构成证据但不能假定存在 | §4有绑定完整原生排除回读加真实正控制；无观测继续阻塞 |
| CLAUDE-06 | claude | minor | 接受 | 实际清单与语义映射必须对账 | §3/5按init清单验证，不假定Agent/Task等价，不删必需项 |
| CLAUDE-07 | claude | minor | 接受 | 其它执行入口需总限与无害性边界 | §3总预算含其它入口；危险正控直接阻塞 |
| CLAUDE-08 | claude | minor | 接受 | 核心阻塞后应暂停无准入价值调用 | §3/4仅完成核心三入口及官方独立核对，停止其它准入专用调用 |

完整修订计划 r6，含所有接受编号。计票1通过/1修改后通过/1不通过，不忽略少数意见。Claude建议重审的理由已逐项接受，流程由gate next_action决定；未执行业务改码或审批。历史不覆盖。

