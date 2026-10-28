---
schema: trivium.disposition.v1
topic: QoderCN官方模型路由与回退阻断
stage: code
role: codex
kind: response
run_id: 20261027T233105Z
addresses:
  - 2026-10-28-QoderCN官方模型路由与回退阻断-gemini.md
  - 2026-10-28-QoderCN官方模型路由与回退阻断-glm.md
  - 2026-10-28-QoderCN官方模型路由与回退阻断-claude.md
---

# 首轮代码审应答与修改计划

三份全文已读；18 条全部接受。修改在 gate 前实施并验证，保留首轮失败证据。Claude 的 consulted 漏列由编排器提示，不由 Driver 改写审核工件。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| --- | --- | --- | --- | --- | --- |
| AGY-01 | gemini | blocker | 接受 | 真机尾句使文本通道漏检，旧测试被标签比对遮蔽 | model 监视器识别完整已取证句式；真 stderr 单独反例和 executable 回归 |
| AGY-02 | gemini | blocker | 接受 | processAlive 返回对象，必须读 sameProcess；清理不可因短命进程竞态跳过目录删除 | native 清理提取可注入原语、核 lstart/已退出/复用，嵌套 finally 必删认证和根 |
| AGY-03 | gemini | major | 接受 | 新 front-matter 字段必须纳入编排器回显剥离名单 | parse.ts ECHOED_ORCHESTRATOR_KEYS 及现有对账回归 |
| AGY-04 | gemini | minor | 接受 | 已审 config 来源应有真实生产者 | probe 对官方目录内原生配置显式执行并核验，产 source=config |
| AGY-05 | gemini | minor | 接受 | 候选适配器事实应能被纯校验消费，准入另处限制 | preflight 目录提取使用 wiredAdapter；不放宽选侧身份校验 |
| GLM-01 | glm | major | 接受 | ps 枚举后自然退出应跳过，不能把正常结果抹掉；不采用 kill(pid,0) 身份判据 | 清理原语使用 lstart + 显式进程在位查询，保存执行结果与清理错误 |
| GLM-02 | glm | minor | 接受 | 来源绑定是启动前不变量，需要负例锚定 | executable 参数化测试入口/平台/hash/settings/version 漂移与未派生 |
| GLM-03 | glm | minor | 接受 | 末值可能是 Auto 披露的底层身份，不能固化默认 | 监视器独立 initLabel，probe 默认只取 init，补默认探针 executable 测试 |
| GLM-04 | glm | minor | 接受 | 直接调用同样需要整份请求一致性 | adapter 比对完整 native 请求，覆盖 override/origin 篡改 |
| GLM-05 | glm | minor | 接受 | config 枚举不应空头声明 | 实现 config 来源并在 validateQoderFacts 校验其声明与目录一致 |
| GLM-06 | glm | nit | 接受 | JSON 原始错误缺来源且可能带设置片段 | settings 解析错误包装为安全的 QoderModelConfigurationError，注明文件而不复述原始设置 |
| CLAUDE-01 | claude | major | 接受 | 完整告警必须在标签不变时也独立失败 | 同文本通道修复、真实全文 fixtures，双通道独立早停断言 |
| CLAUDE-02 | claude | major | 接受 | 旧证据含 result，不能宣称阻止了模型执行 | 报告更正；invoke 记录逐行到达时间/停止时是否已有 result，重取当前真机故障臂 |
| CLAUDE-03 | claude | major | 接受 | 默认探测不能预设 Auto，也不能用末值 | probe 用无预设基线的 monitor，独立首个 init 选择默认；后续回读单列 |
| CLAUDE-04 | claude | major | 接受 | 原生官方配置路线为计划承诺 | 实现 config 来源、正反探针测试，不继承目录外 Custom |
| CLAUDE-05 | claude | minor | 接受 | 执行失败与模型回退应分别保存 | NativeModelResult 追加 execution_failure，fail_reason 优先启动/超时/截断/退出失败，fallback 首因单列 |
| CLAUDE-06 | claude | minor | 接受 | 启动前应看到实际绑定错误；坏目录事实不能变内部异常 | availability 同步核入口/配置 hash，实际版本由既有异步预检和执行前验证；目录错误转不可核实修复提示 |
| CLAUDE-07 | claude | nit | 接受 | missing 原因应能到达用户 | TierResolution.nativeDefaultMissing，preflight/review 附原生默认诊断 |
