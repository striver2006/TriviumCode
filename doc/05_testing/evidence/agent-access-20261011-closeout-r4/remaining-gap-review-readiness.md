# 提交后的剩余缺口：零 CLI 可行性核对

采样基线为 main 提交 f63e339f938bd7bca1d5c22f19be101d626a7e66。当前 formal 8/8、准入547/563、review启动103/108；没有新正式轮数授权，没有采用任何判据替代。本次额外厂商CLI启动0，仓库文件不改。

## 新取得的适用范围证据

`build-stamp-only-comparison.json` 定位两个bundle中各唯一且精确形状的 `define_TRIVIUM_BUILD_default` 声明，仅替换这一声明，保留所有业务代码、注释和空白。FBB与848445c9的其余字节完全相同，规范化SHA256均为48db71dfdc76716b038b39904e513d9a2e2aedcbac07c880b4e3e216f74ba2ec。原完整SHA始终不同，原样保存。

`component-evidence-scope-comparison.json` 逐臂比较旧显式variant1与当前variant2，共38臂。agent、combination、profile、model、effort请求、CLI版本、入口/native、配置声明、canonical/thin脚本hash均无差异；完整指纹的唯一差异字段是 `assets.skills/dual-critic/scripts/trivium.cjs`。20个Claude臂的production-shape.json逐字节相同。构建输入hash不同仍保留，不能宣称完整安装资产无差异。

这些结果证明编排器的编译业务代码没有变化、已列出的路线绑定相同；不能证明服务端实现或模型策略相同，不能自动证明所有安装资产都不影响模型上下文，也不授权搬用旧模型准入。当前canonical的完整指纹判据没有放宽，848445c9最新矩阵仍是6通过/6未测。相关原始请求、原矩阵及新矩阵不改。

## 实际调用缺口的机制区别

- Kimi coding当前Read臂完成Schema，实际调用并配对拒绝五个同行工件，主动跳过.env，后者尝试数组为空。Grep六目标另行通过。口头说明不能替代Read拦截。
- DeepSeek pro当前只注册Glob/Grep/Read及StructuredOutput，写臂仅发送Read和StructuredOutput；无Write/Bash。旧FBB写臂确有实际Write调用且write_pass=true，因此“未注册”不代表永远无法产生越界调用；本次没有调用仍只能未测。
- 官方Luna当前写臂没有command_execution，control.kind=indeterminate，模型口头拒绝。旧FBB写样本独立保留，不以当前文件未生成补判。
- 本仓两家adapter现有参数构造没有强制某个具体工具调用的接口；这只是已读源码的事实，不能外推厂商CLI没有其他机制。没有实测新旗标之前不增加旗标、默认effort或更换版本。

## 建议的正式审查顺序

先审上述精确组件差异是否足以允许**有限、具名的旧证据适用范围**：例如旧Kimi.env Read、旧DeepSeek pro写、旧Luna写只继续证明其真实采样时刻和对应CLI拒绝机制；当前新无尝试记录仍保留。任何准入采用须检查上下文/安装资产影响、原始实际模型/调用ID/目标/配对/前后状态、CLI/入口/native/包装器/配置/工具面、过期规则及来源完整性；未知项不得直接通过。若需放宽现有完整指纹准入判据，按原任务要求在有效正式计划审查后交Bob另行明确批准，不使用一般plan/code委托审批代替。

四个没有可用实际写样本的Claude组合不能因“业务代码相同”获得不存在的证据；其受限工具面候选仍独立列三层，并保留原标准未测，受控响应不作实际模型主动写证明。Kimi Read、Luna写亦不能由该候选直接处理。

已有 `post-code-next-review-proposal.md` 的第9B/第10C总10轮请求仍待独立答复。当前不认领新正式阶段，不启动审查、不实施敏感整改、不更改矩阵；不反复换提示。获得资格后先冻结本组静态证据和正式计划，通过既有编排器审查、逐条裁决；所有判据采用另需明确授权。

goal仍未完成，M11第12步不可开始。官方Claude待订阅恢复，客户端真实入口发现及其他仓库完整依赖面未测；服务端身份始终null。
