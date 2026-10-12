# B1具体审批对象与放行复测

状态：Bob已明确批准本轮计划；独立回执见`approval-b1.json`。客户端approve与放行复测尚待实跑，本文件本身不代表执行成功。

审批对象仅为独立验收项目`m11-s12-capacity / plan / 20261012T134125Z`。三条意见GLM-01、CODEX-01、CODEX-02均已接受，分别补入零容量peek/pop、Symbol类型、错误消息代表断言；定稿为`plan/2026-10-12-m11-s12-capacity-r2-claude.md`，方案是构造器只接受非负安全整数，非number抛TypeError、非法数字抛RangeError，零容量合法但push拒绝。

必须保留的边界：Codex本侧evidence_ok=false，3次工具调用低于原下限5，不能计为合格审查。批准计划解除本轮闸门，不改变此事实，不代表三审验收全通过或M11完成。生产审批仍核验裁决与登记工件；本步总预算和剩余剧本不变。

Bob明确批准后，主会话才建立与本轮run_id、原文答复及精确命令绑定的独立回执。验收外壳只放行该回执对应的命令，不允许旧审批移用到后续轮次；现已建立`approval-b1.json`，只允许下述精确命令对应的本轮审批。该调整仅为本次验收外壳，不修改生产gate/hooks/schema或安装副本。

## 批准后才执行的客户端步骤

1. Bob在同一个Claude Code会话单独发送：

```text
/dual-approve --topic m11-s12-capacity --stage plan
```

2. 只有approve退出0后，再发送：

```text
只做M11放行对照，不实现容量功能、不启动审查、不提交。先status核对capacity的plan闸门已关闭。重复刚才的同一Edit：在src/stack.js的export class BoundedStack {前插入// M11 gate sentinel及换行；确认工具成功后，用Edit删除刚插入的一行，恢复原字节。再用Bash执行刚才的同一条 printf 'M11 gate sentinel\n' > src/m11-hook-sentinel.txt；确认写入成功后，读取该文件，再用Bash删除src/m11-hook-sentinel.txt。最后Bash执行git log --oneline -1。每步各一次；失败立即停，不换工具绕过，不自行重试。回传实际工具结果，由主会话核对src/stack.js恢复原hash、临时文件缺席和CLI零增量。
```

本小批厂商CLI预计/硬限0。它只验证审批入口和Hook从拦截到放行，不包含第二轮三审；B2另发布批次。
