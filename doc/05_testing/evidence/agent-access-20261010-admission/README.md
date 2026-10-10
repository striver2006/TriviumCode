# 双模式真实准入补测（独立批次）

旧目录 `../agent-access-20261009/` 的48/48记录冻结。本轮用户已批准初始准入32、正式审查16，并明确授权按需增加额度；批准不是提交/推送授权。CLI启动数不是服务端请求数或金额。

- `approval.json`：用户授权原文及初始上限。
- `extension-N.json`：连续扩容历史。第1条为bootstrap时期Driver写入，原件不补写；没有key/回执或确切发布时间，原子发布未经核实。发布时间只可由review预占0009（限16）至0010（限40）夹逼。后续只经预算模块extend发布，temp+rename、全局锁、同键幂等和回执。
- `budget-preload.cjs`：冻结的bootstrap原件，供首轮预检及计划审查使用。review 0001–0013均由该文件产生，只有script_sha256，没有load_id/装载证明；不能追认具备新版侧车保障。
- `scripts/agent-access-{budget,budget-preload,launch,evidence,admission}`：现行实现位于仓库scripts。调用件与预占记录保存脚本hash；源码变更后不把新hash补入旧件。第一份调用（code-round1）在scanner前停止，0厂商启动，旧UUID字段误报的原件保留；第二份调用改用load_id，源码已冻结在第一次代码审查changes.diff里。没有保存源码快照的早期hash明确只提供hash证据。
- `ledger/<pool>/reserved-XXXX.json`：先于spawn排他预占，失败/超时不回收。`launch-XXXX.json`：对应结束结果。不存在结束件表示仍运行或异常未收尾，不能判成功。
- `calls/`：统一调用器请求/结束件，记录预算装载和执行脚本、wrapper、安装bundle及配置hash。
- `loaded/`：Node进程装载ID、PID、ppid及脚本hash证明。现行侧车预占的parent_pid必须与装载记录交叉核对。
- `routes/`：逐组合请求、配置声明、原始脱敏轨迹、运行回读、判定及独立夹具前后状态；无回读记null，无真实写尝试记未测。
- `audit-snapshots/`：正式代码审查前冻结的运行元数据副本，用于审计。运行中的calls/ledger/loaded/routes在本机sensitive_globs内保护，原件保留；不让持续新增的运行数据改变代码补丁。第一轮代码审查因这些运行记录改变补丁而作废，原始意见保留并逐条裁决，不宣称审查通过。

Node包装器下的启动也保守计入预算，可能多于一次逻辑调用。现行记录的boundary_parent标明首次跨过厂商边界的父进程和预占编号：null为编排器/探针发起，非null为厂商包装器子树。包装器内部辅助CLI和潜在审核者发起的CLI都计数，不冒充新的独立认证/能力臂；按血缘合并看逻辑组合，预算仍按全部预占计。bootstrap没有此标记，血缘只能由parent_pid及原始entry辅助核对，缺项不追写。

阶段进展与矩阵以最终报告为准。当前pro及三审未切换，官方Claude真实验收待订阅恢复。每主题正式审查最多四轮（计划和代码合计），调用失败未派生审核者不记新的审查轮次，但任何实际CLI启动仍计数。

最终索引：`final-delivery.json`关联当前矩阵、准入100/100及审查29/40台账、配置声明、两次3105/3/0串行检查、桩14/14和最终安装核对。`audit-snapshots/final-sources/`冻结六份当前脚本及hash；原始CLI与历史记录不回写。Kimi/DeepSeek权限层诊断有真实尝试和配对拒绝，但生产同形仍未测；共享pro与三审未切换。`source-drift-group2-canonical.json`纠正前一近似路径替换计算，不改变完整源指纹漂移的结论。
