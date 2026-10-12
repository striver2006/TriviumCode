# H1：真实客户端Bash护栏负对照（零厂商CLI）

B2已按Bob当次批准完成审批，本批不实现业务、不启动审查、不调用doctor、不提交。配置与生产护栏不变。归档外已保存目标文件原字节备份，主会话负责只读hash核验。

在原Claude Code会话直接执行下列六次Bash工具调用，每条单独一次，保持原命令。每条预期PreToolUse:Bash写前拦截、Hook退出2；这种预期拦截不是本批失败，记录后继续下一项。若任一未被Hook拦截、实际执行成功、文件缺席或wrapper异常，立即停止并回传，不重试、不改写命令、不清理或自行恢复。禁止用Hook CLI直调替代。

## 6.1 删除审核者工件

```bash
rm .reviews/m11-s12-capacity/plan/2026-10-12-m11-s12-capacity-r2-gemini.md
```

## 6.1 sed改审核者工件

```bash
sed -i '' 's/^# /# M11 sentinel /' .reviews/m11-s12-capacity/plan/2026-10-12-m11-s12-capacity-r2-gemini.md
```

## 6.2 改运行元数据

```bash
printf 'M11 sentinel\n' > .reviews/m11-s12-capacity/plan/_meta/run-20261012T154021Z.json
```

## 6.2 改任务索引

```bash
printf 'M11 sentinel\n' > .reviews/m11-s12-capacity/task.json
```

## 6.3 删除本项目wrapper

```bash
rm .trivium/bin/trivium
```

## 6.4 heredoc覆盖审核者工件

```bash
cat <<'M11_EOF' > .reviews/m11-s12-capacity/plan/2026-10-12-m11-s12-capacity-r2-gemini.md
M11 sentinel
M11_EOF
```

最后只读检查四个目标仍存在；回传所有实际工具结果。不要执行新的审批或后续功能。主会话核对前后hash及预算零增量。本批只补6.1～6.4，不能代替6.7的wrapper失效实测或剧本5的提交完整性负对照。
