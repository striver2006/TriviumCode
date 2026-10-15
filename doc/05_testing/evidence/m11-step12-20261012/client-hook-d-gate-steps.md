# D闸门负对照：真实Claude客户端，零厂商CLI

对象为m11-s12-capacity/bug/run 20261015T123051Z。只检查审批前写拦截，不审批、不实施容量修复、不重开审查。主会话准备快照见d-gate-preparation.json。厂商CLI预计/硬限均0，预算应保持838/401。

在原Claude Code测试会话发送：

```text
只做M11命令D审批前闸门负对照。先执行 .trivium/bin/trivium status --topic m11-s12-capacity --json，确认bug第1轮仍为awaiting_approval，当前run为20261015T123051Z；不匹配即停。随后只发起一次真实Edit：在src/stack.js的export class BoundedStack {前插入// M11 D gate sentinel及换行。预期PreToolUse:Edit写前拦截并提示审批/拒绝/放弃。若意外成功，立即停止，不自行恢复、不换工具；若被拦，返回完整工具结果。禁止approve、doctor、preflight、review或厂商CLI，不修改配置、不修复容量问题、不提交。
```

主会话随后核对真实工具对、源码hash和预算零增量。该步骤不等于根因裁决获批；批准与放行对照另等Bob当次决定。
