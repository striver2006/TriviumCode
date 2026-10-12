# 第一批真实客户端步骤（先发现入口，检查完成后再发起）

执行项目：`/Users/chenzhenbo/Work/trivium-m11-step12-20261012`。不要使用旧验收项目或主仓库做业务实验。

1. 在VS Code单独窗口打开上述目录，使用当前Claude Code / Qwen。关闭Antigravity与ZCode的GUI窗口（保留登录，不退出账号），仅保留这个VS Code验收窗口。不要在终端另起厂商CLI。主攻客户端已有进程不算新增CLI；若客户端提示需要新启动CLI，请先记录并告知主会话，由预算机制预占。
2. 在Claude输入框输入 `/dual-`，记录实际候选中是否能找到dual-run、dual-review-plan/code/bug、dual-approve/abandon/status；**先不发送**。候选显示只证明入口发现，不能证明执行成功。
3. 主会话宣布第一真实批已就绪后，先发以下约束，再单独发命令A。

```text
这是M11第12步真实客户端验收。本轮不要使用子代理，所有操作直接执行。项目仅为 /Users/chenzhenbo/Work/trivium-m11-step12-20261012。只通过 .trivium/bin/trivium 运行编排器，它已接入原预算与本批硬上限；不要改wrapper，不手工调用任何审核者CLI，不运行doctor探针，不跳认证，不改用户全局配置，不自动重试。审查失败保留原件并停止。命令A不设人工审批，但仍逐条裁决、审查期禁改业务文件。禁止自动提交本夹具。
所有 .reviews 工件只能通过 /Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-step12-20261012/archive-driver.mjs 调用生产archive.ts写入：在归档外写一个JSON输入文件，包含topic、stage、driver、role、kind(null/revised/response)、rerunIndex（首轮整数1，不能填null）、content；从项目根执行 node <上述助手绝对路径> <输入JSON绝对路径>。plan/bug必须先用编排器认领。只写本轮Driver工件，不碰审查员工件。
```

```text
/dual-run 给BoundedStack增加peek方法：空栈返回undefined，非空返回栈顶且不改变size；补充测试并执行配置中的构建与测试 --topic m11-s12-stack --critics gemini,glm --driver-provider qwen
```

当前仅确认Driver使用Qwen，具体模型未报告，故省略模型声明并保留unknown；不以请求冒充回读。命令原文、客户端实际识别结果、实际执行命令与运行ID都留存。若入口无法识别或客户端要求非预期权限，停在该处并报原文。

本批预计admission6次、review8次，硬上限分别6次、10次（累计801/383），失败/69/漂移即停，不自动重试。客户端以API完成的Driver对话不算审核者CLI启动；任何真实CLI新进程必须经预算机制，不凭“已经登录”免计。
