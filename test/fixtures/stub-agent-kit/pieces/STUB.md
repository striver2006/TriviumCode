# 桩 Agent 协议片段（接入套件第 ⑤ 件）

本文件由 `test/fixtures/stub-agent-kit/overlay.ts` 写进临时构建树的根目录，
对应注册表里 `instructionFiles: ['STUB.md']` 那一行。真实 Agent 在这里放它读得懂的
协议片段（审查员身份 + Driver 协议两段式），桩没有模型，所以内容只是占位。

## 本件验证到哪一步

**M10b 第 2 步之前**，`instructionFiles` 在生产代码里没有任何消费方（EV-06），
本件只能断言「overlay 确实落了这个文件」，验证不了任何链路。

**M10b 第 2 步起有了消费方**：`trivium init` 的 `protocolPlan` 按注册表 `instructionFiles`
决定往哪些项目记忆文件里写协议片段、各带哪几段（桩能作审核者、不能作 Driver ⇒ 只带审查员身份段）。
那条分发链路由 `test/unit/init.test.ts` 的用例覆盖；**本夹具仍只断言 overlay 落了这个文件**，
不在临时构建树里跑 `init`——免得有人读到「第 ⑤ 件」就以为分发也在这里验过了。
