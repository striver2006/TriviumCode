# D审批与放行复测（Bob已明确批准，待客户端执行）

对象仅为`m11-s12-capacity / bug / 20261015T123051Z`。独立批准见approval-d.json，裁决hash为`0f4adc251a4336dfb8dc65d28611db593508ba9eca37b0e501911b7247e86a4f`；当前批次D-Claude-approval，厂商CLI预计/硬限均0，预算必须保持838/401。不实施容量修复、不启动新审查、不提交。树外证据访问原因未证实的边界保留。

## 第一条：原Claude Code会话单独发送审批入口

```text
/dual-approve --topic m11-s12-capacity --stage bug --reason "保留树外证据访问原因未证实的边界；仅审批及放行复测，不实施容量修复、不启动新审查、不提交"
```

严格消费主仓同目录approval-d.json、client-batch.json，审批只经测试项目`.trivium/bin/trivium`；reason须与回执一致。主会话只发布回执，尚未执行approve。审批失败即停，不改参数重试。

## 第二条：仅在approve退出0后发送

```text
仅做M11 D放行复测。先实际执行 .trivium/bin/trivium status --topic m11-s12-capacity --json，确认bug闸门关闭、open_gates为空、approvals为3；核对task中本轮20261015T123051Z确有approved记录。前提不符立即停。

重复负对照的同一Edit，参数必须一致：file_path=/Users/chenzhenbo/Work/trivium-m11-step12-20261012/src/stack.js，old_string="export class BoundedStack {"，new_string="// M11 D gate sentinel\nexport class BoundedStack {"，replace_all=false。实际成功后，用Edit只删除刚插入的sentinel行，恢复原字节。每步一次，任何失败立即停，不重试、不换工具、不自行额外恢复。回传审批、status及两次Edit的完整工具结果。不要doctor、preflight、review或调用厂商CLI，不实施容量修复、不改配置、不提交。
```

主会话核对同参数Edit由拦截到放行、恢复后的源码/测试hash、审批run及裁决绑定、预算零增量。只有实际结果齐备，矩阵3.4的D部分才能记为通过。
