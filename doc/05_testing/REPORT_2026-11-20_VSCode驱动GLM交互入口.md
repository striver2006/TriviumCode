# 驾驶舱 GLM 主攻交互入口验收

环境为 macOS arm64、VS Code 1.147.0、核心 1.3.7、驾驶舱 0.3.0。基线 456c2f0f。正式审查使用仓库 wrapper 安装副本（构建来源 b0ade00 dirty），隔离后台对照使用工作树构建的核心。

## 启动路径与包指纹

从 Phase 4 留存的官方源码发行物 3.18.2，在临时前缀运行该发行物的 install.sh。原压缩包 SHA-256 为 `97e3766ac38aed7ce9a9fc0224af8e170053cd940d932327b6e24860b23c362b`。验收解压目录补入 Phase 4 实测的 2.1.2 arm64 keyring，二进制摘要为 `1bc4c418c70021050fc052a1f5f60e0da1526ff0b952840f25e691624a4c483e`。全新原包的首次登录未测。

| 真实直启链 | SHA-256 |
|---|---|
| 官方安装器生成的 /tmp/trivium-glm-accept.fIgUlo/bin/zcode | 6750581f37e2332c7df712262f98cb1ba9444f811965e28ce14acebc2e083af0 |
| 同一安装前缀 distribution/current/bin/zcode.mjs（3.18.2） | 191db90c74ea13c71e225774fde85db3c662f36a0a79d5a6bf3011590d35b904 |
| distribution/current/agent/zcode.cjs（Phase 4 同版 0.17.1） | 052b1bc504b7e47da297cdb0d13f1899baa804b675247d757f26b0560a97b540 |
| 运行进程映射的 /opt/homebrew/Cellar/node/25.2.1/bin/node | 87989003817c5347d6bad48e46897e1b6509328bb7e8295d83cb6b40af836b9c |

## 真实 GLM 与夹具

- 初包 `66a1f2a18a3e4af910c5183c31fc5b705eddf4d3abead19d8fb6397cf04c97e5` 安装在新 profile 后正常启动 TUI，冷启动页忽略了默认延迟后的首条输入，原生日志无 turn.started，无 run_id。保留失败样本。
- 等待原生日志中 bootstrap.app.startup.completed 后再注入的包 `63e9587643372c25e97696daab6b4470e299366b74d0a4de097d983cb6bb9978` 已在另一全新 profile 实际点火。主题「入口实测dqqnqy」，ZCode 会话 `sess_e69e82cc-a2d7-4d72-b139-35ea1d04a842`。日志先后出现启动完成、首轮开始。该轮停在原生 Bash 确认，未生成运行号。代码审修订后在全新目录、独立主题另行验收。
- 独立临时仓「后台入口对照」工作区设置指向上表直启命令。Codex 主攻的真实核心计划审 `20261120T064750Z` 仅选 GLM。归档回读 `launcher_effective=/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs`，CLI 0.17.3，实际模型 `bigmodel-coding-plan/GLM-5.3`，已读项目文件计数 3，evidence_ok 为 true，运行成功。原探针的只读规则仍由核心构造。此运行与主攻验收中的桩审核者独立。
- 扩展首次 check 通过 186 项单测与 84 项 Extension Host 集成测试。夹具覆盖新路径选择、旧探针与 provider 环境、直接及脚本入口的真实子进程 argv/cwd/日志目录。Windows 真机未测。

## 最终 VSIX 与安装态结果

使用 `npm run package -- --out trivium-cockpit-0.3.0-glm-entry-e1.vsix` 生成 112929 字节的独立包。SHA-256 为 `1fff53d75693c0d42d968535bbd9c3fa6b7f2491776dec88cdf9ce82bf558903`。全新 profile 安装后的扩展 JS 和中文手册与 VSIX 逐字节相同；清单去掉 VS Code 添加的安装元数据后相等。[安装证据](evidence/vscode-glm-entry-20261120/final-installation.json)

| 既有 0.3.0 包 | 开始前与最终复核相同的 SHA-256 |
|---|---|
| Phase 4 | 50f5929c2028ecf2ae465996bc778fe3f2c0f30aa2fabfbc2c7549f09eccbe06 |
| glm-relay | 202ea8b9e044289d5a2616c1e3c6f353bdfad9098adc37c079237e83555b7c32 |
| e1 | 0169ea603e53e75c58a4ff3e8e8f93e17d975eb201fc61b3e72cc8148d308bee |

### 同一真实终端从点火到 M3

最终包另装入全新的 VS Code 用户数据与扩展目录。在驾驶舱选择 ZCode 主攻并点火，命令栏显示 `/skill dual-run … --driver glm --critics gemini --topic 入口实测n4Fskj`。原生 ZCode 3.18.2 在当前工作区启动，PID 16368 实际使用上表 Node 25.2.1。GLM-5.3 的首轮调用了带该主题的 `dual-run` 技能，并在回答中给出计划运行号 `20261120T073524Z`。归档、闸门与驾驶舱显示的运行号一致。

| 驾驶舱操作 | 真实会话与界面回读 |
|---|---|
| 首轮尚未结束时点击一次发送，要求回复标记和 47 × 13 的结果 | 首轮结束后才提交，回答 `N4FSKJB611`；该输入命中 1 个模型请求 |
| 原生输入提示恢复空闲后点击一次发送，要求回复另一标记和 29 × 19 的结果 | 回答 `N4FSKJC551`；该输入命中 1 个模型请求 |
| 使用 VS Code 的终端关闭命令 | 模式从 M1 切为 M3；关前关后运行卡均显示「入口实测n4Fskj · plan」「成功」「20261120T073524Z」 |

两个回答各有独立轮次，与点火首轮共用会话 `sess_d208f31d-5bd7-41bd-9358-c6947dfdbdf3`。真实主攻运行使用 Gemini 审核桩；后台真实 GLM 审核见下文独立对照。工作区共享探针文件的 SHA-256 在点火前后相同。专项验收脚本退出 0。[点火命令、原生回读与两张运行卡文字](evidence/vscode-glm-entry-20261120/real-m1-m3.json)

### 其他采样与检查

- **真实 GLM，可执行入口。** Bob 完成原生命令确认后，「入口实测lWWU5T」生成运行号 `20261120T072721Z`。计划归档记录入口 A、Driver glm、审核侧 gemini（`stub/0.0.0`）。闸门记录中的会话号与 ZCode 主会话 `sess_2c686e1a-1cae-44b5-8bb2-86121cdeb773` 相同。首轮调用原生 Skill `dual-run`，参数含本次主题，模型回复包含运行号和 `LWWU5TA527`。忙时和空闲时各点击一次，同一会话随后分别答出 `LWWU5TB611`（47 × 13）和 `LWWU5TC551`（29 × 19）。按最后一条用户输入核对模型回读，两条各命中一个请求、一个独立轮次。此样本在关终端前因取证脚本查找已滚出视口的斜杠命令原文而结束。原生结构化调用、主题和归档均可核验。[原生确认时的采样](evidence/vscode-glm-entry-20261120/native-handoff.json) · [真实运行及续话](evidence/vscode-glm-entry-20261120/real-conversation.json)
- **真实 GLM，脚本入口。** 最终包另装于全新窗口，工作区设置指向 Phase 4 的 `bin/zcode.mjs` 和 Node 24.14.0。实测 PID 映射到配置的 Node，原生模型收到主题「脚本核验bKJ9pq」并调用 dual-run。该样本采到首轮提交即结束，运行号、续话与 M3 未测。首个脚本采样在 lsof 返回非零时取证中断，已在新窗口完整复跑此项。[脚本路径、解释器及轮次](evidence/vscode-glm-entry-20261120/script-shape.json)
- **真实 GLM，后台审核。** 第二次隔离采样 `20261120T065734Z` 在进程改名前取得真实参数。Node 25.2.1 启动原探针桌面脚本，收到 `--prompt`、`--json`、`--mode plan` 和完整禁用工具清单。该轮成功，GLM 模型回读及证据均通过。前一轮归档与本轮进程实参分别留存。[后台归档摘录](evidence/vscode-glm-entry-20261120/background-evidence.json) · [进程实参](evidence/vscode-glm-entry-20261120/background-argv.json)
- **可重复检查。** 根仓首次 check 的 doctor-deadline I4 报超时状态差异。该套件与文档索引定向复跑 40 项通过，完整重跑 4061 项通过、16 项跳过、0 失败。最终扩展 check 为 186 项单测、85 项真实 Extension Host 集成测试通过。正式 verify 的 typecheck、build 和 npm test 三条命令通过。[正式 verify](../../.reviews/驾驶舱GLM主攻交互入口/verify/2026-11-20-驾驶舱GLM主攻交互入口-verify.md)
- **安装态夹具。** 中间包的一次入口 B 慢夹具在前置链等待超时。最终包重新执行安装态 npm run e2e，退出 0。双窗口入口 B、关终端继续 M3、中文手册及 E1 双窗可控 CLI 验收通过。夹具中的 Driver/审核替身结果独立于真实主攻采样。[最终包 e2e 摘录](evidence/vscode-glm-entry-20261120/final-e2e.json)
