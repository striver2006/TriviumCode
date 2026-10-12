# H2：wrapper不可执行时的真实客户端拦截（6.7）

厂商CLI预计/硬限0。仅改变独立验收项目wrapper执行权限，不删除文件、不改配置。必须恢复后才可继续其它批次。

1. **macOS系统终端**执行（不是Claude Code聊天框）：

```bash
chmod -x /Users/chenzhenbo/Work/trivium-m11-step12-20261012/.trivium/bin/trivium
```

2. **原Claude Code聊天框**发送一次：

```text
执行M11 H2（6.7）故障负对照。Bob已在系统终端临时取消本项目wrapper执行权限，这是具名验收，不要修复它。
先实际发起一次Edit：在src/stack.js的export class BoundedStack {前插入// M11 disabled-wrapper sentinel及换行；预期PreToolUse报告“护栏失效”并拒绝编辑。
然后实际发起一次Bash：git log --oneline -1；预期两个Bash拦截型Hook都报告“护栏失效”。每项各一次，预期拦截后继续；如果任一工具意外执行成功立即停止，不清理、不重试。
最后尝试结束本轮回复，让Stop Hook接受真实检验。若Stop报告“护栏失效”，不再发工具、不重复重试，等待Bob恢复执行权限。全程不调用Hook CLI、doctor、审查、审批或提交。
```

3. 看到Stop的“护栏失效”提示后，若客户端连续重复，点击停止；**立即回到系统终端恢复**：

```bash
chmod +x /Users/chenzhenbo/Work/trivium-m11-step12-20261012/.trivium/bin/trivium
```

若第二步意外执行成功、报其它错误或无法继续，也先在终端执行恢复命令，再回传原文；不得让客户端自行换工具恢复。

4. 告知主会话“已恢复+x”，回传Edit、Bash和Stop的实际提示。主会话核对源文件和wrapper的hash/权限、逐Hook实际事件、预算零增量。看不到某个Hook的真实结果就记未测，不从配置文件推断通过。
