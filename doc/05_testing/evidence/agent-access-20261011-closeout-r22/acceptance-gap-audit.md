# 第27C批准后的逐项验收与剩余缺口

这是阶段性交付清单，不是全量准入结论。当前源码main aa6db337、生产inputs 7ac37129、bundle1737c946、完整local 6a2c6213均已在plan28-static-preparation-audit.json现场核验；当前没有开放闸门或在途供应商启动。原七整改及普通代码审批完成，M11第12步前置仍未完成。

## 七条整改落点

| 原意见 | 当前实现/验证来源 | 判定与限制 |
| :--- | :--- | :--- |
| CLAUDE-01 | src/trivium/adapters/claude.ts:367 claudeSensitiveGlobsHash、432 directoryDeclarationUsable、445 consumeClaudeDirectories；src/trivium/probes/claude.ts:1724在夹具替换前绑定真实项目hash；test/unit/claude-directory.test.ts:88及155 | 配置集合变化/旧形态/过期/缺事实回退，实际生产适配器在1012接线；不能用夹具配置替代真实项目 |
| CLAUDE-02 | test/fixtures/claude-deny-paths-replay.json；test/unit/claude-directory.test.ts:28 | 真实原件3924项，固定原run/request/trace/hash；3908项由8个受测目录覆盖，余项逐文件，集合不变和相邻合法路径对照；2290不是该原件数量 |
| CLAUDE-03 | src/trivium/adapters/claude.ts:745 peer_deny_applied；src/trivium/probes/claude.ts:1072；test/unit/claude-directory.test.ts:134 | 原逐文件探针事实与实际压缩工具已验证不变式合取；字段不证明本次所有路径已拦，不作为模型独立能力证明 |
| CLAUDE-04 | src/trivium/adapters/claude.ts:415 claudeDirectoryFingerprint、445 consumeClaudeDirectories；test/unit/claude-directory.test.ts:88 | 无可消费声明不读二进制；精确路径Map仅单次函数调用，0/1/2次读取和第二调用重读已覆盖；无跨运行缓存，性能收益未实测 |
| GLM-01 | src/trivium/probes/claude-directory.ts:43 judgeDirectoryArm；test/unit/claude-directory.test.ts:246 | 唯一工具调用ID、精确cwd/目标、唯一结果is_error和唯一permission记录共同判定；独立缺失/错目标/重复/错ID拒绝 |
| GLM-02 | src/trivium/adapters/claude.ts:364 CLAUDE_DIRECTORY_SHAPE及373 projectClaudeDenyPaths；src/trivium/probes/claude-directory.ts:119；test/unit/claude-directory.test.ts:68 | 当前经补充正式审查批准为ASCII根1..5段/后代目录0..2层；中文、空格、逗号等目录仍逐文件。特殊文件名不外推目录；freeze父深度7单独批准，8仍未覆盖边界 |
| GLM-03 | src/trivium/probes/claude-directory.ts:20 expectedDirectoryFailure、89 probeClaudeDirectories；src/trivium/probes/claude.ts:1720..1756；test/unit/claude-directory.test.ts:266及279 | 预期创建/启动失败/超时/非零退出停止追加臂，清空目录事实，保留主probe并记录脱敏失败和清理；未知内部错误继续抛出 |

以上实现包含在23C及后续27C完整重审作用面中；批准原件见r15/code23-post-approval-checkpoint.json及本目录code27-approved-checkpoint.json。局部断言、桩或受控机制均不替代真实模型准入。

## 逐路线、逐历史实际模型矩阵

完整请求、逐文件配置声明、历史/当前CLI回读、provider来源和server_identity字段取r21/matrix-after27-preflight.json原样；下表仅摘要，不另造能力事实。历史完整配置为496，当前为6a2。所有当前CLI模型回读和全部server_identity仍null。

| 路线/组合 | 历史CLI实际模型 | 历史CLI effort回读 | 旧496完整准入 | 当前6a2原标准 | 剩余缺口 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Claude/qwen | qwen3.8-flash | null | 通过 | 未测 | 当前指纹适用性；认证判据待独立决定 |
| Claude/qwen-pro | qwen3.8-max | null | 未测 | 未测 | 生产真实写未测、原禁读Read断言false；历史b40受控主成果只读复算不能升当前 |
| Claude/kimi | kimi-for-coding | null | 未测 | 未测 | 生产真实写及当前受控机制未测 |
| Claude/kimi-pro | k3 | null | 未测 | 未测 | 生产真实写未测、原禁读Read断言false，受控未启动 |
| Claude/deepseek | deepseek-flash | null | 未测 | 未测 | 生产真实写及当前受控机制未测 |
| Claude/deepseek-pro | deepseek-v4-pro | null | 未测 | 未测 | 生产真实写及当前受控机制未测；pro不代flash |
| Codex/native-sol | gpt-6.1-sol | high | 通过 | 未测 | 当前指纹适用性；仅受测官方档位，不证明服务端身份 |
| Codex/native-luna | gpt-6-luna | high | 通过 | 未测 | 同上，旧Luna失败采样保留 |
| Codex/native-astra | gpt-6-astra | high | 通过 | 未测 | 同上 |
| Codex/qwen | qwen3.8-flash | medium | 通过 | 未测 | 当前指纹适用性；旧复合命令unknown失败保留 |
| Codex/kimi | kimi-for-coding | max | 通过 | 未测 | 当前指纹适用性 |
| Codex/deepseek | deepseek-flash | high | 通过 | 未测 | 当前指纹适用性；旧复合命令unknown失败保留 |
| Claude官方 | null | null | 未测 | 未测 | 订阅待恢复，不用第三方模型代官方 |

旧矩阵7通过/5未测，当前0通过/12未测，不能解释为12模型失败。认证诊断虽四跳/27历史臂适用，但候选未采用，不能计当前通过。新五组合受控B即使成功仍actual_provider_inference=false、real_model_attempt=null；独立受限判据未经Bob决定不得代原C。七条可用路线及Qwen pro完整准入尚缺证明。

## 正式复审、审批和检查

| 要求 | 权威原件 | 当前证明范围 |
| :--- | :--- | :--- |
| 原失败保留 | code/_meta/run-20261010T170416Z.json | failed不变；旧approve类意见不恢复运行资格 |
| 有效完整代码三审及逐条裁决 | code/_meta/run-20261011T212239Z.json及code-r13-response-codex.md，SHA66dd93be；本目录code27-approved-checkpoint.json | Claude/Gemini/GLM成功、证据有效、零漂移，3项2暂缓1驳回，无必修项；三侧当前组合不外推其他档位 |
| 本轮普通code审批 | checkpoint实际approval，2026-10-11T21:40:25.130Z | Bob明确普通审批委托下Codex执行，session=null；不冒称Bob亲自操作，不采用判据 |
| 认证判据独立决定 | auth-criterion-decision-proposal.md及scope.json | 待答复，approved=false、user_decision_ref=null；原标准不变 |
| 受限工具面独立决定 | 26B/r30当前合同及r21消费者 | 未采用；五组合当前完整机制事实未测 |
| 两次串行生产check | r14/check1-r27-denial.json、check2-r27-denial.json | 各3207通过/3跳过/0失败，生产inputs同7ac37129；历史HEAD773370 dirty=true，不能冒称当前清洁HEAD全量重跑 |
| 源码/安装桩 | r15/admission-after23/source-selftest-after23.json及installed-selftest-after23.json | 各14/14历史实测；当前生产模块/安装副本hash相等不等于本轮重新执行桩 |
| 后续独立资产全量测试 | r21/full-compiled-tests-before27-v4.json | 3621通过/3跳过/0失败，未超时/截断，bundle前后相同；这是编译测试，不是两次npm run check |
| 四目标安装与共享迁移 | r15/admission-after23/install-after23.json；本目录plan28静态审计 | 当前runtime/28入口和七备份逐文件一致；客户端实际重名解析、其他仓库依赖完备性未测 |
| 第28B后续计划 | plan-r31原稿、plan28-resolved.json、formal-round28-29-authorization-verification.json | 原稿已归档/59context冲突0；未预检、未冻结、未启动、未批准，不实施新guard |

原稿/裁决仅archive.ts出口；所有旧schema、失败、停止lease、台账及r21的160文件保留。后续若生产输入改变必须重新串行两check、桩、构建/正常安装及必要准入适用核验。独立资产有新改动则完成其真实检查，不把旧绿灯笼统作为新改动证明。

## 剩余行动与外部决定

1. 已发出的认证独立决定仍待Bob答复。采用后必须实际运行已审消费者并核验精确作用面；拒绝则列必要真实刷新清单。普通自动审批和轮数/CLI扩容不代该决定。
2. 28B/29C例外已按需登记，仅这两轮；review当前358/398、28B事前预计15/硬20/止378，29C另按实际基线清单。admission734/742，拟五组合预计10/硬15/止749的扩容尚未执行。
3. 正常预检可能刷新认证checked_at而使当前6a2独立提案失效；不调TTL、不恢复旧时间。在已有决定处理前保持指纹，不为了等待另造不必要代码或检查。
4. 28B有效及普通plan批准后才实施具名六处新批次绑定；保持原mode3配方，每组合一次、任一失败停止全部，不恢复原批次、不追加第三配方。29C预检在样本之前，全部审计/报告在冻结前完成。
5. 当前生产工具面无法取到五组原标准写样本时，给出具体可行性结论及受限判据能/不能证明的精确决策。只有正式审查加Bob另行独立决定才能采用；两个候选均不能自动报告M11前置完成。

当前阻塞不是CLI额度或安装冲突；是独立判据决定及仍缺的真实准入事实。目标保持未完成，不以投入、审查次数、已提交或绿色单测作为完成依据。
