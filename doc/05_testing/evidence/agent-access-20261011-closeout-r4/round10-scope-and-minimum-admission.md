# 第10次完整代码重审范围与最小后续清单

本轮普通计划已批准；相对39ed20530d64a72f81f183095c6d9516632d0228送审全部累计改动，Driver codex，审核者Claude/Gemini/GLM。9B run20261011T020308Z success、9条完整裁决、gate0、当轮委托审批先行；本次C是总第10次，失败/作废仍计数，不产生第11次资格。审查期间范围内全部业务和静态证据冻结。两项准入候选没有采用层，不请求本次code审批批准判据变化。

生产源码七条和父扫描7边界、本次实时/历史恢复测试、只读诊断的严格构建声明剥离及负例、stage-aware启动检查、新launcher、安装及报告纠正均属于范围。相同编译业务字节不能证明所有配置与模型环境同形；全局Codex config变化以及全部Codex profile_config变化均保留，不自行调整或恢复配置。旧审查和旧预算/矩阵原件不改。

下表“可复用”只指历史原件与当前生产消费者仍有效的目录事实，不把旧组合通过搬入cb6矩阵。正式10C期间新增准入启动0。后续新取证必须先有当前完整指纹版本引用；数目表示条件满足后该组合能力臂的最低逻辑调用，不是已授权的新批次或成功保证。版本、包装器/native边界及失败另计，需先发布实际批次。

| 路线 | 历史CLI实际模型 | 原缺口 | 可复用证据边界 | 必要新增启动/当前执行 |
| :--- | :--- | :--- | :--- | :--- |
| Claude/qwen | qwen3.8-flash | 新完整指纹刷新 | 848实际Read/Grep/Schema/写配对；目录facts由生产守卫核消费 | 原标准4能力臂；当前0 |
| Claude/qwen-pro | qwen3.8-max | 生产写实际尝试未测；新指纹 | 848实际读取/禁读；旧注册诊断不能代实际写 | 3读取臂可刷新；写先取得可行机制，当前0 |
| Claude/kimi | kimi-for-coding | .env Read无尝试、生产写未测；新指纹 | 当前历史Grep6目标、Read同行5目标；旧.env Read机制只历史 | 3读取臂需精确配对；写无新机制0，不换提示碰运气 |
| Claude/kimi-pro | k3 | 生产写未测；新指纹 | 848 Read/Grep六目标，受控样本只诊断 | 3读取臂可刷新；生产写无新机制0 |
| Claude/deepseek | deepseek-flash | 生产写未测；新指纹 | 848读取/禁读 | 3读取臂可刷新；写无新机制0 |
| Claude/deepseek-pro | deepseek-v4-pro | 当前写无尝试；新指纹 | FBB曾实际写拒绝；848仅Read/StructuredOutput | 3读取臂可刷新；旧写不追认，无新机制0 |
| Codex/native-sol | gpt-6.1-sol | 全局/profile配置及新指纹 | 848精确读取、命令拒绝与状态、事后检测 | 原标准3能力臂；当前0 |
| Codex/native-luna | gpt-6-luna | 当前写无command_execution；新指纹 | 848读取/事后检测，FBB实际写仅历史 | 2读取/检测臂；写先可行机制，当前0 |
| Codex/native-astra | gpt-6-astra | 全局/profile配置及新指纹 | 848精确读取、命令拒绝与状态 | 原标准3能力臂；当前0 |
| Codex/qwen | qwen3.8-flash | 新指纹，旧unknown复合解析已解决 | 848精确单cat读取/Schema及真实写拒绝 | 原标准3能力臂；当前0 |
| Codex/kimi | kimi-for-coding | 全局/profile配置及新指纹 | 848读取/Schema及真实写拒绝 | 原标准3能力臂；当前0 |
| Codex/deepseek | deepseek-flash | 新指纹，旧unknown复合解析已解决 | 848精确单cat读取/Schema及真实写拒绝 | 原标准3能力臂；当前0 |
| Claude官方 | null | 未测，订阅待恢复 | 无可追认官方真实模型样本 | 0，待订阅恢复 |

请求、配置声明、CLI回读、服务端身份继续分列；本表actual字段属于旧采样，新运行回读尚无证据，服务端始终null。Codex禁读仍是事后命中，不称事前拦截。原H矩阵5/5/2、FBB矩阵、848矩阵及所有未测/未通过列不覆盖。当前前置目标未完成，M11第12步不能开始。
