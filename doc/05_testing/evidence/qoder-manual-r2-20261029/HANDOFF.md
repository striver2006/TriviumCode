# Bob的R2操作单：固定Auto，只执行P1

这是用户授权的新批R2，旧OU4vuq会话已经失败关闭，不恢复。模型已由启动参数固定为Auto，权限、项目和预算均由装置提供；你不需要选择模型或改任何设置。

## 1. 在终端执行一次新启动器

```sh
'/private/var/folders/b_/9c_2y9gx4bx9hg3chvdwmdl00000gn/T/trivium-qoder-plan-B-W0xlfE/启动Qoder-P1.command'
```

仅在manual-ready.json通过且源码/CLI/正式技能/项目指纹一致时启动；旧启动器不可复用。预算从启动开始计时，25分钟、120次上限参数、零模型请求重试；助手记录数另有保守上限。

## 2. 在Qoder中粘贴这一句

> 请完整读取并执行 P1-任务.md，只完成P1，结束后停止。

不要输入/model或修改权限、账号、项目，不/new、/clear、/resume。若界面要求你另行登录、选模型或改变权限，不继续配置，退出并报告；若界面显示非Auto路线也先退出报告。模型内部的自动选择未知，不能用显示标签推断底层身份。

## 3. 完成或首次失败后退出

完成最终原稿Read后输入`/quit`。任何工具拒绝、关键失败或监督自动终止都不重试、不重启、不换命令。无法正常退出时按Ctrl+C并等待收尾。不要手工编辑任何原稿或启动P2。

等待看到“证据已保存”和“私有凭据根已删除：true”；不是true则将终端错误告诉Codex。监督进程被强杀的即时清理不作保证。

## 4. 回到Codex回复

> R2 P1已结束。

Codex负责读取本机证据、核正文/作者/归档/回读与清理；缺项就停止。P2只有在全部通过后才可另段执行，仍固定gemini/glm。

新项目：`/private/var/folders/b_/9c_2y9gx4bx9hg3chvdwmdl00000gn/T/trivium-qoder-plan-B-W0xlfE/中文 空格项目`

预留会话：`c1034437-b4f1-4bea-befb-79d26eed7389`

证据目录：`/Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/qoder-manual-r2-20261029`

本批修正的是观测机制：正常额外探查以同ID原生只读允许决策留痕，不继续枚举命令样例；这不是执行前拦截或完备Shell隔离。原稿Write与归档仍必须满足精确权限、同ID正文hash和防覆盖。P0准备/测试通过不代表真实撰稿或完整Driver准入通过。
