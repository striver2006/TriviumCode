# D：容量根因审查（待C放行核实并发布D批次后执行）

草案不是启动许可。只有主会话确认client-batch.json为D-Claude、发布批次后才发下列消息。预计/硬限admission6、review4，总80与44/36保持；跨TTL探活已预留。失败/69/漂移/预算拒绝立即停，不重试。

1. 原Claude Code聊天框发送准备文本，等完成后再发入口：

```text
继续M11命令D验收。先重读主仓库 /Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-step12-20261012/client-batch.json，必须是D-Claude；否则停止。Driver仍claude/qwen3.8-flash/qwen，若当前模型不同请停报。只认领m11-s12-capacity的bug阶段，读src/stack.js、test/stack.test.js、package.json以及主仓库同证据目录d-local-reproduction.json。根据实际结果起草容量校验根因材料：构造器直接赋值没有number/非负安全整数校验，非法输入被接受，push关系比较产生隐式转换或延迟异常；明确zero是合法容量、push拒绝是预期。复现由主会话本地Node实际执行，引用完整命令、退出码、输出与source hash，不宣称由自己或正式verify执行。材料只分析问题、现有测试缺口和已获批r3方案的边界，不改业务、不改配置、不调用厂商CLI、doctor或子代理。归档仅经archive-driver.mjs，stage=bug、role=driver=claude、kind=null、rerunIndex=1；输入JSON在归档外，日期用助手默认。原稿完成后回传路径并等待，不提前预检或启动审查。Codex Hook来源unknown、L2不变，不回写旧裁决。
```

2. 准备完成后，将以下入口单独发送：

```text
/dual-review-bug 核对容量非法输入的复现与构造器缺校验根因，检查类型错误与取值错误边界；本轮仅根因审查，不实施容量修复 --topic m11-s12-capacity --critics gemini,glm --model-gemini gemini-3.8-flash-high --effort-gemini low --model-glm GLM-5.3 --driver-provider qwen --driver-model qwen3.8-flash
```

按真实命令D执行，根因原稿与裁决只能落bug/。逐条裁决后停awaiting_approval，回传run_id与停点，不自行approve、不实施修复、不提交。正式verify不改配置，Node复现仅作根因证据。
