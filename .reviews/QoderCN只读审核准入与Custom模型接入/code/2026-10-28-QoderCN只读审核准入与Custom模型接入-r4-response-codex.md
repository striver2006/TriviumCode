---
schema: trivium.disposition.v1
topic: QoderCN只读审核准入与Custom模型接入
stage: code
role: codex
kind: response
run_id: 20261028T063910Z
addresses:
  - 2026-10-28-QoderCN只读审核准入与Custom模型接入-r4-gemini.md
  - 2026-10-28-QoderCN只读审核准入与Custom模型接入-r4-glm.md
  - 2026-10-28-QoderCN只读审核准入与Custom模型接入-r4-claude.md
---

# 续批代码审第1轮逐条裁决

Gemini无意见，GLM五条、Claude七条，12条全部接受。票数为1通过/1修改后通过/1不通过；不据多数票忽略Claude两个major。模型可调用控制不能算审核配方准入，生产开关继续关闭。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| GLM-01 | glm | major | 接受 | null作用域探针租约确无消费入口，强杀可遗留认证 | native入口在复制前回收所有者已死的null租约；增加通用无运行侧回收钩子挂scrub及真实两进程null探针回归，活所有者/活组仍不删 |
| GLM-02 | glm | minor | 接受 | 静态配方不能表达本次禁读矩阵覆盖 | 台账增加deny_paths覆盖集及原件scope hash；worker/adapter拒绝请求禁读集超出已验覆盖，冻结record hash同时冻结覆盖；新增扩集拒绝回归 |
| GLM-03 | glm | minor | 接受 | 同次重复解密无必要 | verifyQoderBinding保留同步来源/字节与版本检查，深比codec加载仅在固定字节的invoke中执行一次，不跨run缓存明文或提取物 |
| GLM-04 | glm | nit | 接受 | canonical不应受locale影响 | admissionHash改为码点稳定排序并回归 |
| GLM-05 | glm | nit | 接受 | Custom分支无需虚构Auto/Fast目录标签 | Custom route_labels从实际目录独立提取，未知为空，不以标签猜底层身份 |
| CLAUDE-01 | claude | major | 接受 | 无工具可调用参数不能作为生产审核参数 | facts追加独立review_invocation_args，仅经最小读取真实正控制后产生；生产/准入消费同一审核参数，缺失拒绝；旧无工具控制保持历史不可移植，新正负控制单独重采及argv/binding回归 |
| CLAUDE-02 | claude | major | 接受 | 同GLM-01，不能靠被杀进程finally | 新增null租约所有者已死回收及scrub挂点，保留组/标记核验，不杀未知进程 |
| CLAUDE-03 | claude | minor | 接受 | 手工版本标签不足以约束规则实现变化 | 生成权限模板、路径别名样本、环境允许键/代理策略作为实际数据进入recipe hash，并用模板变异回归守卫 |
| CLAUDE-04 | claude | minor | 接受 | 成本边界应公开，刷新频率未测不能猜 | 设计/协议明确认证或加密缓存任何变化均保守重探及重验；刷新频率未测，当前不移除绑定降低标准，不宣称可低成本复用 |
| CLAUDE-05 | claude | minor | 接受 | 探针中途更新会造成验证字节与最终hash错配 | 官方及Custom探针均先固定私有CLI字节再取codec/版本/目录/正控制，记录同一hash并确认源末端不变 |
| CLAUDE-06 | claude | minor | 接受 | 当前设计/协议旁注与历史状态混杂 | 原位标记04:48及以前历史时点，更新replace已实现，最新批次/原始证据与旧verify严格分开 |
| CLAUDE-07 | claude | nit | 接受 | 既称精确匹配则Custom应保留大小写语义 | Custom key改为大小写精确；大小写歧义仍拒绝，官方旧归一兼容，补错误大小写回归 |

审查限制原样保留：Claude拒写轨迹核验不可用；Driver模型unknown；安装副本为未提交构建。审查员关于租约“可靠回收”及“31项额外工具”的概括不提升为本轮验收结论：31为默认工具总数；真实失联/脱组与配置技能插件排除仍未完成。

修订回读：上述12项已落地；typecheck/build退出0，独立argv/worker/租约/台账/trace/registry等定向65/65，含新增清理守卫/模板变异/无运行目录回收的另一组82/82。另补禁读软链目标变化扩集拒绝，正式verify会收录。08:02新增真实Custom审核配方四臂均已保存，08:05当前评估仍4/30、空禁读覆盖、admitted=false；旧无工具评估不移植、不回写。当前安装inputs 85b56c862ba9，生产三开关false；完整准入、真实Qoder三审及Windows仍阻塞。

正式verify首次run20261028T080829Z失败，旧件r2-verify保留：唯一失败是GLM-01/CLAUDE-02回收可见性新增的空JSON字段违反旧15键契约。改为仅真实非空回收结果追加可选external_credentials，无该结果的旧调用保持15键；独立真实CLI契约复核通过，当前安装inputs 4c5242e29750。此为已接受回收接线的兼容修复，不改变准入判据。随后重新gate并正式verify另起原件。

正式收尾：code gate重检通过；verify重跑run20261028T081723Z三条命令均0、348s，4150通过/9跳过/0失败，r3-verify另存；r2失败保留。open_gates=[]，未审批/提交/推送。整体原生准入仍阻塞，无生产台账，三开关false，Qoder真实三审和Windows未测。
