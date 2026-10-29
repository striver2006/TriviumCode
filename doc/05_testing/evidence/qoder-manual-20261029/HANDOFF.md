# Bob 的 Qoder CN CLI P1 操作单

本批为新的人工监督交互会话，旧失败会话不恢复。真实会话尚未启动，P2锁定。启动器仅在 manual-ready.json 标记通过且冻结核对成功时启动；缺件会直接拒绝。

## 1. 在 macOS 终端执行一次

```sh
'/private/var/folders/b_/9c_2y9gx4bx9hg3chvdwmdl00000gn/T/trivium-qoder-plan-B-OU4vuq/启动Qoder-P1.command'
```

无需自行 cd、安装或配置。启动器固定本批CLI和项目，临时复制最小认证；不触碰用户全局设置。25分钟预算从启动起计，包含等待输入时间；120次交互上限、零模型请求重试，另外按120条助手记录保守停止。原生交互参数与日志形状尚待本批实测。

## 2. 进入 Qoder 后粘贴这一句

> 请完整读取并执行 P1-任务.md，只完成P1，结束后停止。

任务文件已包含本批正式技能路径、材料、认领/Write/归档/Read顺序。由Qoder自行撰稿；你和Codex均不要补写正文。这里只执行P1，不粘贴正式双审命令，不启动审核者。

## 3. 完成或遇到首次失败即退出

Qoder完成最终原稿Read并停止后，输入 `/quit`。若要求重新登录、改模型/权限、出现工具拒绝或关键失败，也停止；不要重试、改命令、切通道、/new、/clear、/resume或重启启动器。若无法正常输入退出，按Ctrl+C并等待启动器收尾。

等待显示“证据已保存”和“私有凭据根已删除：true”。若不是true，保留终端错误，告诉Codex；不要自行继续。强杀监督进程的即时清理未测。原生安全只读规则可能允许额外Bash，日志监督属于执行后观察；人工监督期间遇到意外写入或其它越界操作即停止。

## 4. 回到 Codex 回复

> P1已结束。

无需手工整理原稿或截图。Codex从本批原件核验同ID工具结果、读取正文、作者、正文/归档hash、权限决策、最终Read和清理。P1缺项即停止；只有全部通过才按既有授权准备P2。显式Read不能证明理解或slash自动展开等价。

本批项目：`/private/var/folders/b_/9c_2y9gx4bx9hg3chvdwmdl00000gn/T/trivium-qoder-plan-B-OU4vuq/中文 空格项目`。
会话ID：`766c0baf-0bfa-4ad1-8618-6e059c130def`。
原件保存目录：`/Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/qoder-manual-20261029`。

交互会话持久化位置依据[Qoder官方会话文档](https://docs.qoder.cn/en/cli/sessions)；退出命令依据[官方内置命令](https://docs.qoder.cn/en/cli/built-ins)。实际是否齐备以本批原件为准，离线合成测试不能替代真实Qoder验收。
