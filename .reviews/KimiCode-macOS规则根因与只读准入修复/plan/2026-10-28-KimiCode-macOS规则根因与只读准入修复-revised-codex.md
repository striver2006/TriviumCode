---
schema: trivium.disposition.v1
topic: KimiCode-macOS规则根因与只读准入修复
stage: plan
role: codex
kind: revised
run_id: 20261027T174141Z
addresses:
  - 2026-10-28-KimiCode-macOS规则根因与只读准入修复-gemini.md
  - 2026-10-28-KimiCode-macOS规则根因与只读准入修复-glm.md
  - 2026-10-28-KimiCode-macOS规则根因与只读准入修复-claude.md
---

# 计划审逐条裁决

17 条全部接受。过滤观测单独分级，不放宽用户的执行层拒绝标准。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| AGY-01 | gemini | major | 接受 | 加入普通文件 deny 哨兵、字段层级/大小写/quoted 变异；不是默认认为变体合法。 | r2 §4 |
| AGY-02 | gemini | major | 接受 | 单独翻转 manual/auto/yolo，单列 TTY 与权限旗标实测。 | r2 §4 |
| AGY-03 | gemini | major | 接受 | 机制实验不得填写生产 TraceCapability 或替代真实路线准入。 | r2 §3、§6 |
| AGY-04 | gemini | minor | 接受 | 按版本官方落点建项目/隔离根 hooks、MCP、skills/插件哨兵及启用控制；建议中的示例路径需先核实。 | r2 §5 |
| AGY-05 | gemini | minor | 接受 | 对工具结果中的具体路径/内容做匹配，不在请求文本找泄漏；覆盖 quoted 与裸中文路径。 | r2 §4、§7 |
| AGY-06 | gemini | minor | 接受 | 本主题无论结果如何，生产开关均冻结 false。 | r2 §1、§6 |
| GLM-01 | glm | major | 接受 | 权限模式成为独立变量，非交互与权限模式不混比。 | r2 §4 |
| GLM-02 | glm | minor | 接受 | 受控入口最小 spike 前置；只允许临时配置偏离指定字段且不带真实凭据。 | r2 §2、§3 |
| GLM-03 | glm | minor | 接受 | 写明顺序、每臂时限、总启动上限、定位和准入两套完成口径。 | r2 §4 |
| CLAUDE-01 | claude | major | 接受 | 新增 agent-file 有无、tools 声明有无、skills-dir 独立臂，先定位再扩矩阵。 | r2 §4 |
| CLAUDE-02 | claude | major | 接受 | 非读工具无害执行与自定义 deny 配对，区分权限段未播种和读工具特例。 | r2 §4 |
| CLAUDE-03 | claude | major | 接受 | 只修改新实验模块，旧 probe 默认/Windows 包装/旧证据不动。 | r2 §3、§6 |
| CLAUDE-04 | claude | major | 接受 | 区分过滤观测与实际拒绝；可记录完整配对正反过滤事实，但不把无拒绝事件的过滤升级为用户要求的执行层拒绝。 | r2 §4 |
| CLAUDE-05 | claude | minor | 接受 | 本地服务不携带真实凭据且不记录请求头；至少一组 managed 桥接，显式记录 provider 差异。 | r2 §3 |
| CLAUDE-06 | claude | minor | 接受 | 同步开关注释与当前状态表；历史段落仅追加新状态，不改历史。 | r2 §7 |
| CLAUDE-07 | claude | minor | 接受 | 判定逻辑为实验专用；tests.mjs 另行执行并单列结果，不能宣称 check 已收录。 | r2 §7 |
| CLAUDE-08 | claude | minor | 接受 | 监控副本/全局 hash，发生凭据改写立即停批且不回写；不把 hash 当账号无影响的证明。 | r2 §3 |

