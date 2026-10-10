---
schema: trivium.disposition.v1
topic: 双模式真实准入补测
stage: code
role: codex
kind: response
run_id: 20261010T005455Z
addresses:
  - 2026-10-10-双模式真实准入补测-r2-gemini.md
  - 2026-10-10-双模式真实准入补测-r2-glm.md
---

# 第2轮代码意见逐条裁决

Gemini无意见；GLM六条全部接受。原始审查工件保留，本轮没有快照漂移。

| 编号 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- |
| GLM-01 | 接受 | 注册层拒绝与权限层拒绝必须分开；无尝试不能判通过。 | admission新增独立注册Write权限诊断，两路线真实尝试配对拒绝、文件不存在；production_equivalent=false，不替代生产臂。设计、剧本、坑清单、报告及summary保留生产未测，停止盲目提示重试。 |
| GLM-02 | 接受 | bootstrap豁免不能扩散至现行记录。 | budget.limit仅首条容许缺key，后续非空key强制；新增无key扩容fail-closed测试。 |
| GLM-03 | 接受 | 安装实际写入面必须如实列出。 | 报告记录全局产品Agent资产重写，首次前值null；当前hash与源一致，后续安装核对扩大为四文件，用户路由配置三文件前后未变。 |
| GLM-04 | 接受 | 配置声明不等于effort运行回读。 | summary增加effort_declared/readback列，Codex四路线声明与回读null分别记录，报告明确边界。 |
| GLM-05 | 接受 | 原生入口与shebang包装分支都应有回归证据。 | 新增复制原生env二进制为codex的用例，断言子进程不继承NODE_OPTIONS；既有shebang用例保留，局部10/10。 |
| GLM-06 | 接受 | 脱敏实现与build输入需可追溯，历史缺项不得倒填。 | 新调用件/request记录secrets模块、evidence helper hash和build输入观察；redaction-install-audit记录当前源码/构建hash，历史字段null；旧件不覆盖。 |

Kimi、DeepSeek生产同形仍未测，共享pro、三审不切换。权限诊断仅证实真实权限拒绝，错误文案不能独自区分显式deny命中与默认未授权拒绝。本轮最终串行检查、桩自检和安装核对另按正式出口执行。
