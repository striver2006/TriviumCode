# B1：容量校验计划的真实三审首轮

项目仍为 `/Users/chenzhenbo/Work/trivium-m11-step12-20261012`，使用原Claude Code会话。Bob已确认当前模型仍是qwen3.8-flash。命令A及原主题不重跑。

先发送准备文本，完成准备后单独发送下方入口命令：

```text
继续M11第12步B1验收。请重读主仓库 doc/05_testing/evidence/m11-step12-20261012/client-batch.json 和本项目AGENTS.md。当前Driver声明为claude、qwen3.8-flash、qwen。新主题m11-s12-capacity是代码审查GLM-01指出的容量校验独立任务，不是重跑peek。先只做计划准备：读取现有src/stack.js、test/stack.test.js和package.json；认领capacity的plan阶段，再起草计划原稿。目标：构造器只接受非负安全整数，非number抛TypeError，其余非法数字抛RangeError；0合法但push拒绝；保留现有peek、push/pop语义，补充边界测试。写清兼容性、验证命令和回滚方案，不修改业务代码。
所有归档写入仍只用 /Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-step12-20261012/archive-driver.mjs；JSON输入放归档外，首轮rerunIndex必须填整数1，kind:null仅表示原稿，driver和role均claude。原稿完成后停下，等我单独发送/dual-review-plan；不要提前启动审查。
全程不使用子代理，不运行doctor，不直接启动厂商CLI，不改配置或wrapper，不自动重试或提交，不自行approve/abandon。后续正式运行成功时逐条裁决并按命令B停在awaiting_approval，不继续code。失败/69/漂移/预算拒绝立即停止并回传原文。
```

准备完成后单独发送（不额外预检，入口本身会预检）：

```text
/dual-review-plan 核对容量参数的类型边界、异常类型、零容量与已有栈行为兼容性，以及测试和回滚方案 --topic m11-s12-capacity --goal 为BoundedStack构造器补充容量校验：只接受非负安全整数；非number抛TypeError，其余非法数字抛RangeError；零容量合法且push拒绝；保留peek与push/pop行为并补充测试 --critics gemini,glm,codex --tier-codex low --tier-gemini medium --model-glm GLM-5.3-Flash --driver-provider qwen --driver-model qwen3.8-flash
```

本批从admission801/review381起算，预计与硬限均为8/6，累计809/387；未使用的A批余量不叠加。只允许capacity plan首轮，第二轮另发布批次。每次厂商边界都计数，不能按三审运行数量计数。到人工闸门后回传run_id与完整停点，暂不审批。

本轮三审新增codex侧，同时取证剧本8首轮与剧本11首轮的逐侧档位判据。第二轮、裁决缺项负对照和审批尚未执行，不预填通过。主会话持续只读采样；若实际CLI参数未采到则记未测，不拿声明冒充实际参数。
