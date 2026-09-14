# BACKLOG · 技术债与待办池

来源：2026-09-12 对当前实现（HEAD 0aaf855）的整体审核。三路只读审核（核心编排链路 /
闸门与留痕保障 / skills·文档·测试一致性）的结论经逐条对照源码核实后收录于此。
状态列：`todo` 未开始 ｜ `doing` 进行中 ｜ `done` 已落地（2026-09-12 一次性推进：bbc11fd → 本批）。

## Blocker

| # | 状态 | 条目 | 位置 |
| :-- | :-- | :-- | :-- |
| B1 | done | 闸门 `session_id` 为 null 时写锁与收工拦截静默失效（skill 默认路径从未生效） | state.ts `shouldLockWrites`、hooks.ts `hookStop` |
| B2 | done | B/C/D 位置参数语义反直觉且 `/dual-run` 在 S2 必退 64；改为「位置参数按命令语义定，旗标只做覆盖」，`review --start` 加 `--entry` | topic-args.ts、cli.ts、四份 SKILL.md、设计 §7.1/§7.3 |
| B3 | done | code 阶段 `subject_drift` 永远不触发：跑后复算读的是冻结 diff 文件本身；`relatedPaths` 漏了 diff 涉及文件 | review.ts:649/681、freeze.ts:134/167 |
| B4 | done | 留痕防篡改链断裂：归档内 hookPreWrite 一律放行（含 `_meta/`）；`_meta/review-*.json` 不在保护集却是 gate 唯一输入；git 锚只看删除；首次提交前无基线 | hooks.ts:106/356/369、review.ts:735、gate.ts:87 |
| B5 | done | Bash 出口不设防（`cat >`/`sed -i`）；dual-run 授予裸 Bash | .claude/settings.json、skills/dual-run/SKILL.md |

## Major

| # | 状态 | 条目 | 位置 |
| :-- | :-- | :-- | :-- |
| M1 | done | `reclaimStaleLock` 复验结果被丢弃，`rm` 无条件执行，调用方忽略返回值 → 删掉别人的新锁 | lock.ts:97-112,179 |
| M2 | done | 锁文件先 `open('wx')` 后写内容，空文件窗口被判 `unparsable` 误回收活锁 | lock.ts:148-152,73 |
| M3 | done | `readState` 解析失败静默返回空状态，所有闸门一次性消失 | state.ts:59-65 |
| M4 | done | `recordApproval` 无条件 `setGate`，abandon 跳过状态校验，可覆写并发 `running` | approval.ts:34-39,58-64 |
| M5 | done | `withTopicLock` 零调用；task.json 读改写四处不持锁 | meta.ts:213、verify.ts:332、approval.ts:53、review.ts:543 |
| M6 | done | 同步路径 `runReview` 不取主题锁 | review.ts:880-902 |
| M7 | done | worker 心跳 `void patchStatus` 无 catch → 写失败即崩；心跳与终态写入争用 | run-protocol.ts:365-368 |
| M8 | done | `exec.run` 超时不杀进程树；`finish` 只挂 `close` 可能永不 resolve | util/exec.ts:145-153 |
| M9 | done | 两侧 writeArtifact 各自抬升 `-r<N>`，可分叉 | review.ts:728-732 vs archive.ts:57-59 |
| M10 | done | 两侧都 parse_fallback 时空裁决表直接通过；fallback 条目从不被要求出现 | gate.ts:143-153,197 |
| M11 | done | `task.json.disputed` 从未写为 true，status/report 的争议提示永不触发 | gate.ts:232-250、meta.ts:80 |
| M12 | done | config.yaml 完全不校验：`gate: "off"`、拼错枚举、`stop_hook_max_blocks: 0` 均静默 fail-open | config.ts:203-240 |
| M13 | done | PROTOCOL 称四份 Schema/ajv 强校验：`config.v1.json` 不存在，`run.v1`/`disposition.v1` 零加载 | doc/03_api、skills/dual-critic/schema |
| M14 | done | init 的 hook 去重正则匹配不到 JSON 转义后的命令串（死代码），升级会叠加重复 hook | init.ts:167-171 |
| M15 | done | 安装器无卸载路径，copyDir 不裁剪孤儿文件 | install.ts |
| M16 | done | wrapper 写死 `process.execPath`（Homebrew Cellar 版本化路径），brew upgrade 后每次 hook 报 127；doctor 不校验 | init.ts:215、doctor.ts |
| M17 | done | 被审补丁不按 `sensitive_globs` 剔除，`.env` 可经补丁进 BRIEF/argv/request.json | code-stage.ts:104-109、util/git.ts:200-240 |
| M18 | done | zcode availability 只要求 readonly_flags 非空，`--disallowed-tools` 探不到仍判可用 | adapters/zcode.ts:146-152 |
| M19 | done | `retention.run_dir_days` 有配置有文档零实现；`~/.trivium/runs` 已 3400 目录/580MB | config.ts:138、RUNBOOK:172 |
| M20 | done | 测试夹具与 selftest 不覆盖 `run_root`，污染真实 `~/.trivium/runs` | test/helpers/fixture.ts、selftest.ts |
| M21 | done | 已补：install.ts（5 条）、approval（4 条）、zcode availability、同进程并发抢锁与 task.json 并发、真进程树超时、两侧 argv 拼装契约（test/unit/adapter-argv.test.ts）、topic 直接单测（test/unit/topic.test.ts）。**跨进程抢锁竞态已补**（test/integration/lock-cross-process.test.ts，4 条）：起真实子进程验 `fs.link` 的 EEXIST 互斥、临界区读改写不丢更新、SIGKILL 后真实 `pid_gone` 回收、并发回收同一把遗留锁只一个赢。同进程 `Promise.all` 只在一个事件循环里交错，证明不了系统调用层的互斥；`pid: 2 ** 22` 假 PID 也走不到 `processAlive` 比对启动时刻的分支——这两处是它与既有单测的分工 | test/ |

## Minor / Nit

- ~~hooks.ts:176-204 子命令非字面量 `commit`（`git $S`、alias）fail-open，与目录推断的保守原则相反~~ done
- ~~hooks.ts:451-458 阻断超限放行用 exit 0 + stderr，提示用户看不到~~ done
- ~~lock.ts:273-295 stop_hook 计数只在审批时归零，跨轮累积后收工拦截永久失效~~ done
- ~~hooks.ts:620-628 session-start 对读不到 status 的 running 闸门永不回收~~ done
- ~~run-protocol.ts:529-608 `--cancel` 缺 status.json 时不落终态不回收锁，仍报「已取消」~~ done
- ~~run-protocol.ts:409-419 worker 锁回收依赖 status 可读，request.json 里有 topic 可兜底~~ done
- ~~exec.ts:217-226 spawnDetached 未挂 `error` 监听~~ done
- ~~cli.ts `--wait --timeout` 非法值静默回落，verify 侧已按 GLM-r2-07 修好~~ done
- ~~topic-args.ts NAMED_FLAGS 缺 `only/allow-single/session-id`~~ done
- ~~runner.ts:80-84 重试追加的 BRIEF 不回写 `_meta/`~~ done
- ~~base.ts:115-131 checkPeerLeak 不归一化路径；min_project_reads 不校验项目内~~ done
- ~~zcode.ts:45 denylist 不含 WebFetch，zcode-trace.ts:76 还把它算作读证据~~ done
- ~~agy.ts:176 `--agent` 取自配置而非探针结论~~ done（`resolveAgyAgent()` 改取探针结论，配置值只在探针未给出时兜底）
- ~~disposition.ts:59-67 表头 `includes('id')` 会命中 Evidence 列；:189-192 `**AGY-01**` 被静默丢弃~~ done
- ~~gate.ts:123-137 裁决件不校验 run_id~~ done
- ~~secrets.ts:133 抛裸 Error；`.env*` 默认 glob 不跨目录~~ done
- ~~verify.ts:119-128 注释称命令「经 init 逐条确认」，实际无该环节~~ done
- ~~dual-approve allowed-tools 只有 trivium 却要求改写修订件；dual-status 提示 `trivium review --wait` 不在 PATH~~ done
- ~~.reviews/README 把 verify/ 列入 --check-artifacts 范围，parseStage 不接受 verify~~ done
- ~~QUICKSTART 说 init 生成 config.local.yaml（实为 doctor）；墙钟 2~15 分钟 vs USAGE 30~40 分钟~~ done
- 重复实现：花括号配平扫描×2、路径正则×2、probeScratchPaths×2、runDir 拼接×2
  （`locateSubject×2` 不算待办：`topic-args.ts` 那份是**刻意的只读版**，代码里有注释说明——
  `topic resolve` 必须纯只读，不能走会落盘的那条路）
- ~~exec.ts:290-316 safePgrp 用 `getgid` 判进程组无效；`script -q /dev/null` 是 BSD 语法，Linux 无守卫~~ done

## 2026-09-12 双审 · code 阶段（run `20260912T060013Z`，base 0aaf855）

焦点「核实闸门与留痕的绕过路径是否真的堵上」，两侧均判 `request-changes`。
留痕在 `.reviews/审核修复/code/`，逐条裁决见同目录 `-response-claude.md`。
结论是**没有完全堵上**：两侧从不同入口指向同一处薄弱带——`hook-pre-bash` 出口。

四个梯队（hook-pre-bash 出口 / 提交出口 / 审批链 / 参数契约）已全部落地。

其中 GLM-01 只**部分接受**：审批动作本身没有机械边界，这一条至今开着（详见该行）。
机械可堵的都堵上了，这一条堵不上——受限于宿主没有绕开模型的带外通道。

| # | 状态 | 条目 | 位置 |
| :-- | :-- | :-- | :-- |
| AGY-01 | done | `bashTargetsProtected` 模板拼正则蜕化为 `[^s]*`（模板里 `\s`→`s`），**主题名含 ASCII `s` 时归档 `_meta/`、`task.json` 对 Bash 写入完全失防**；已实跑复现，改为路径组件判定 | hooks.ts `bashTargetsProtected` |
| GLM-04 | done | 同处：依赖 `<archiveRel>/` 字面前缀，`cd .reviews && …` 漏过；`/_meta/` 要求尾斜杠，指向目录本身不命中。已复用 `commitTargetsProject` 的 cd 归一化 | hooks.ts `bashTargetsProtected` |
| GLM-03 | done | `hookPreBash` 先剥 heredoc 再判写命令形态，`python3 - <<'PY' … PY` 提前放行，两条规则连评估机会都没有；而 `judgeDrift` 把归档与 `.trivium/` 整体排除，无跑后兜底。已改为在未剥离原文上判定 | hooks.ts `hookPreBash` |
| AGY-03 | done | Hook 守卫一律 `test -x "$W" \|\| exit 0`：`rm -rf .trivium/bin` 即让四个拦截型 Hook 永真放行。已区分「未初始化」（exit 0）与「已初始化但 wrapper 没了」（exit 2），并把 `.trivium/bin` 纳入保护集 | hooks.json、.claude/settings.json、hooks.ts |
| GLM-02 | done | `sh -c 'git commit …'` 整段被引号吞成一个 token，`parseGitSegment` 找不到字面 `git` 即 fail-open，裁决期提交拦截与留痕完整性校验同时被跳过。两处都改了：函数内加保守兜底；`if: Bash(git commit:*)` 是**前缀**匹配、该形态根本不触发 Hook，已去掉改由 `looksLikeCommit` 在进程内过滤 | hooks.ts `parseGitSegment`、hooks.json、.claude/settings.json |
| AGY-02 | done | `gate --check` 通过后无条件落回 `idle`，`--await-approval` 是独立一步；Driver 省略它则人工审批被静默旁路，四个 Hook 全部放行 | cli.ts gate 分支 |
| GLM-01 | 部分接受 | 人工审批闸门可被 Driver 一条 `trivium approve` 自行关闭：`recordApproval` 不校验来源，skill 的 allowed-tools 预批准了 `Bash(.trivium/bin/trivium:*)`。会话比对救不了（人工审批与自批同会话）。**建议的一次性确认码实现后又移除**（项目负责人拍板）：码的明文经 stdout 由 Driver 转述、Driver 读得到，构不成权限边界，只会让人以为这道关是机械保证的——虚假的安全感比没有护栏更糟。采纳的是建议里的另两项：**明示信任边界**（RUNBOOK、协议片段、approval.ts 注释都写明「审批不校验调用来源，靠提示词约束」）与**事后对账**（approvals 记时间/阶段/run_id/会话来源，见 GLM-05）。真正的机械边界需要宿主提供不经过模型的带外通道（TTY / 审批 UI），本项目没有，**此项仍开着** | approval.ts、RUNBOOK、协议片段 |
| GLM-05 | done | `ApprovalInput.sessionId` 从未传入也从未使用，`ApprovalRecord` 不含来源——事后无法回答「这次 approve 是人发的还是模型发的」 | approval.ts:15-22,62-68 |
| AGY-05 | done | `cmdApproval` 允许 approve 省略 `--stage`，会枚举到未裁决阶段并抛 MISSING_ARTIFACT 而非友好提示 | cli.ts `cmdApproval` |
| AGY-04 | done | NAMED_FLAGS 缺 `only/allow-single/session-id`，三者被当成正文吞进审查焦点（已实跑复现：焦点变成「重点看并发安全 --only glm --allow-single --session-id S-TEST」）。补白名单并输出；`--allow-single` 单列为布尔旗标，否则「取下一个 token 当值」会吞掉正文、制造新的静默截断；三条 review skill 补 argument-hint 与模板槽位 | topic-args.ts、三条 SKILL.md |

## 2026-09-14 演进期认领项（来自设计 §24 台账）

| # | 状态 | 条目 | 位置 |
| :-- | :-- | :-- | :-- |
| EV-01 | todo | **隔离检测收口的措施 b：命令文本字面扫描**。对审查员轨迹中每条命令的**命令文本**做 deny 字面量子串匹配（含 `HEAD:<path>` 等写法变体），命中与路径命中同等处置。它是**泄漏通道②（git 对象库）与③（项目外运行目录）在检测侧的唯一覆盖**——经对象库取对端产物不产生文件系统读取，读取路径核验看不到。**从 M7b 的完成判据中移出为独立演进项**（2026-09-14，计划双审 AGY-02 / GLM-04：措施 b 涉及各家轨迹中命令事件的形态差异、需 M6 探针结论支撑，与措施 a 绑在同一里程碑会把 a 拖住）。相应地 `run.v2` 的 `guard.peer_leak_via_command` 声明为**可选字段**、其验收暂不排 AC 号。**在本项落地前，通道②处于「已登记但未覆盖」状态**——不得因为已写进设计就当作已解决。决策背景见 [`ADR_002_multicritic_isolation.md`](../02_design/ADR_002_multicritic_isolation.md)；措施 a 仍随 M7b 交付（AC-25） | `guard.ts`、设计 10.2、演进设计 §8.2 |
| EV-03 | **done**（2026-09-14，M7b 第 3 步） | **`CRITIC_VENDOR` 派生处的 `as Vendor` 断言削弱编译期防错**。`types.ts` 的 `agentById(c)!.vendor as Vendor` 把 `AgentVendor`（四值，含 `'anthropic'`/`'openai'`）宽 union 断言成 `Vendor`（两值），**恒编译通过**。后果：M8 接入 codex 时 `'openai'` 会被静默塞进 `Record<CriticId, Vendor>` 的值位，直到落盘才被 run.v1 的 vendor 枚举校验拒掉——而 M7b 第 1 步的另外三处修法（`effortFor`、`checkModelSlugs` 的 `never` 分支、`CRITICS.includes`）都能在新增 `CriticId` 时**编译期**报错，唯独 vendor 链路拿不到，四处防错强度不一致。**本步刻意不动**：`Vendor` 是 run.v1 的线契约枚举，改它属数据契约层，是 M7b 第 3 步 run.v2 的范围。**落点**：第 3 步的 run.v2 设计清单里登记「vendor 枚举随注册表派生、派生处去 `as` 断言改类型约束」，使第三家接入时恢复同级防错。来源：2026-09-14 代码双审 GLM-03（`.reviews/配置v2与动态多审/code/`）。**收口形态**：`Vendor` 不再独立定义，直接取注册表的 `AgentVendor`，派生处的 `as` 断言删除；前提是 `run.v2` 的 `vendor` 不再枚举两值，故只能随第 3 步一起做。**顺带查出并修掉一处同形**：`render.ts` 的 `vendor === 'antigravity' ? 'agy' : 'zcode'` 在两值时恰好穷尽，放开后会把 codex / claude 静默记成 zcode——CLI 名已登记为注册表的 `cliName` | `types.ts` `CRITIC_VENDOR`、`review.ts` 落盘点、`render.ts` `agent_cli` |
| EV-04 | todo | **`readRunMeta` 零校验，畸形 run.json 会让调用方抛 TypeError**。`meta.ts` 的 `readRunMeta` 是 `JSON.parse` 直转、不过 ajv——「可解析但缺 `critics` 字段」的 run.json 会让 `cli.ts` 的 `Object.keys(artifactMeta.critics)` 直接 TypeError 退 1（`report.ts` 的同形用法亦然）。**风险敞口先于 M7b 存在、未因本次改动变化**，故 2026-09-14 代码双审中 ZCode 侧**刻意未列为意见**，只记在盲区里。此处登记是为了不让这条观察随留痕沉底。缓解现状：`writeRunMeta` 写前过 ajv 校验，历史写入方均含 `critics`，正常路径构造不出这种文件。修法方向：读侧按写侧同样的 schema 校验一次，失败时给出「留痕被动过」的明确错误而非裸 TypeError。来源：`.reviews/配置v2与动态多审/code/` r2 轮 glm 侧盲区记录。**2026-09-14 M7b 第 3 步部分收口**：`readRunMeta` 改为按 schema 精确分发，畸形文件返回 `null` 而不再把未校验对象交给调用方，裸 TypeError 的路径已断。**剩余部分**：它把「文件不存在」与「存在但被搅坏」**回落成同一个 `null`**，调用方一律报「读取失败」；`listRecordedRuns` 那条路径有 `unreadable` 标记能区分两者，`readRunMeta` 这条没有。本项保持 todo 直到这个区分补上 | `meta.ts` `readRunMeta`、`cli.ts` / `report.ts` 的消费点 |
| EV-02 | todo | **禁读集与必读清单无交叉校验**。两个集合目前各自生成、互不核对：理论上可能出现「某文件既在必读清单又在禁读集」的自相矛盾任务书，而审查员无论读不读都会被判违规。计划阶段自查发现，双审时 ZCode 侧明确同意另立任务。修法方向是在任务书渲染前做一次交集断言，交集非空即拒绝启动（宁可不跑，也不发自相矛盾的任务书） | `brief.ts`、`freeze.ts` |
| EV-05 | **部分收口**（2026-09-14，M6 第 1 步） | **探针段的闭合形状与 `preflight` 按厂商写死的环境检查**。① **已收口**：`ProbeSection` 原先只有 `agy` / `zcode` 两个固定键，第三家的探针结论无处落盘。M6 第 1 步改为 `probe.cli.<cliName>`，**键集由 `ALL_CLI_NAMES` 派生**——新增一家不必改 `types.ts` 一个字，尚无专属形状的 CLI 落 `CommonProbe`；旧盘由 `migrateProbeSection` 在读盘时内存迁移。身份校验走两段式（ajv 校 `commonProbe` 形状 → `checkConfigAgents` 校键 ⊆ 已登记 CLI）。**接入套件因此少一件成本**，这正是本项登记时希望消除的。② **收口一项，剩两项**：`checkCliVersions` 已随 M6 第 1 步按注册表遍历——它只需要「怎么取版本」这一条知识，而该知识已随探针结论落盘（`VersionProbe`），**不依赖任何 M8 适配器**，因此能先于其余两项拆出来做；无从校验的侧记「无法校验」第三态并点名原因（未记录方式 / 不认识的运行时 / `extract` 非法正则），不判失败也不静默。**剩余 `checkReadonlyCapability` 与探活编排两项仍按厂商写死**，要等 M8 / M9 接入真实第三家、有真实调用形状可依时一并做。**这两项的后果不止于第三家**（2026-09-14 代码双审 AGY-04 核正）：`checkReadonlyCapability` 硬绑 `probe.cli.zcode.readonly_flags`，因此**只探过一侧的环境仍然过不了预检**——M6 第 1 步放开的单侧新鲜度只对「两家都探过、某侧过期」生效，对「纯单侧环境」并不成立。原登记把这一项只描述成「第三家不被检查」，是从第三家视角写的，不准。M7b 第 6 步的桩夹具绕过这两处（桩无外部 CLI、且用 `--skip-auth-check`），因此夹具**不证明**第三家的环境检查链路成立——证明边界写在 `test/fixtures/stub-agent-kit/overlay.ts` 与夹具测试头部 | `preflight.ts` `checkReadonlyCapability` / 探活编排（`types.ts` `ProbeSection` 与 `checkCliVersions` 已收口） |
| EV-06 | todo | **`instructionFiles` 登记而无任何消费方**。注册表为四家各登记了协议片段文件名（`CLAUDE.md` / `AGENTS.md` / `GEMINI.md`），但全仓 grep 只有注册表自身的四处赋值与一处类型声明——**没有任何代码读它**。后果不是坏行为而是**假覆盖**：M7b 计划稿给接入套件第 ⑤ 件（入口资产）写的理由是「验证 `instructionFiles` 链路」，而那条链路不存在；桩夹具因此只能断言 overlay 确实落了 `STUB.md`，断言不了它被用上。修法方向二选一：要么接上（安装器按它分发协议片段、Hook 按它判 Driver 协议落点），要么删掉该字段并把「谁读哪份协议」明确记在别处——**登记而不接线的字段会让后来者以为它已经生效**，这正是本项目反复反对的形态。发现于 2026-09-14 M7b 第 6 步 | `agents/registry.ts` `instructionFiles`、`install.ts` |
| EV-07 | todo | **`disposition.v1.json` 的 `role` 用 `const: "claude"` 钉死了 Driver 身份**。裁决件的作者恒为**当轮 Driver**，而 Driver 任意化排在 M10——在那之前它事实上只有一个取值，所以不是现行缺陷。但它是一处**写在 schema 里的 Agent 身份**，与纪律 7（注册表是唯一来源）相抵；M7b 第 6 步给 `registry-parity` 的全目录扫描补上 `const` 分支后，第一次跑就把它扫了出来。**处置：按路径具名豁免 + 写明理由 + 登记本项**，而不是关掉整片 `const` 论域——前者的豁免面是一条可数的路径，后者是整片论域悄悄消失。`types.ts` 的 `Disposition.role` 有同源豁免（`LITERAL_ALLOWLIST`），两处理由一致，M10 要一起改。修法方向：`role` 改为只校形状（`type: string`），身份由 `validateDispositionFrontMatter` 按注册表校验并与 `run.json.driver` 比对——与 `run.v2` / `config.v2` 的两段式同构 | `skills/dual-critic/schema/disposition.v1.json`、`src/trivium/types.ts` `Disposition.role`、`schemas.ts` `validateDispositionFrontMatter` |

## 待双审（不自行实施）

| # | 状态 | 条目 | 位置 |
| :-- | :-- | :-- | :-- |
| RV-B1 | **已撤回** | **实施后被双审打穿，已回退**（run `20260912T134136Z`：Gemini `block` 4 blocker、ZCode `request-changes` 2 blocker + 3 major，11 条全部接受零驳回；留痕 `.reviews/RV-B1-commit豁免/code/`，设计 §21 v1.2.5）。三个前置条件（单段 / 无命令替换 / 无 heredoc）**至少漏掉五条夹带路径**，三条实机验证能放行：**换行**（分段正则不含 `\r\n`，shell 却把第二行当独立命令执行）、**附着重定向**（`git commit -m x > …-glm.md` 截断审查文档或在 `_meta/` 制造损坏 JSON，ZCode 独有发现）、**文本提及**（`echo 记得 git commit > …/_meta/review-glm-R1.json` 根本不是提交命令，只因 `parseGitSegment` 兜底正则见 `git`+`commit` 同现即按提交论）；另有 `-c core.editor=` / `GIT_EDITOR=` 注入与进程替换 `<(…)` 两条。**根因**：`parseGitSegment` 是为「宁可错拦」设计的，复用到放行侧方向翻转成「宁可错放」——问题在复用方向，不在复用本身（我在计划里恰好写了「复用它、不要另写判定」，判断错了）。**为何撤回而非再收窄**：原判定 fail-closed，豁免使其变成需穷举危险形态的 fail-open，而 shell 攻击面穷举不完；误拦有零成本出口（`git commit -F <文件>`），漏拦则击穿「独占对象任何时候都 deny」且无跑后兜底。**留作案例**：这是「在护栏上打补丁式收窄」为何行不通的完整样本，五类形态已锁成测试负例（714/714，三条实测由放行转为拦截）。**教训**：本条原始论证里亲手写着「不应在降低 Driver 自身摩擦的动机下修改护栏」，写下了仍然做了，双审兜住了。以下为原始论证，保留备查 —— **`git commit` 是否退出 `hook-pre-bash` 的保护集扫描。** 支持改的论据：`git commit` 不改工作树、只写 `.git`；「用 commit 把篡改洗进 HEAD」这个攻击面由 `hook-pre-commit` 专管（留痕完整性三条锚 + 不按会话过滤），因此 `hook-pre-bash` 对 commit 做字面扫描的防护增量接近零，而本项目的 commit message 天然高频提及归档文件名（2026-09-12 改护栏文档时实撞两次）。**待决的语义后果**：把 `commit` 从 `WRITE_LIKE` 的 git 分支摘掉，等于 `awaiting_approval` 期间用 Bash 提交不再被 `hook-pre-bash` 拦，而 `hook-pre-commit` 在该状态下裁决已齐备会放行——「等人工审批期间是否允许提交」是**设计问题，需要拍板**，不是清理误报的顺手改动。**为什么不自行实施**：护栏判定已栽过四次（AGY-01 模板正则、GLM-04 字面前缀、GLM-03 剥 heredoc、AGY-03 守卫 exit 0），每次都是「看起来合理的收窄」、每次都开了洞、且都由双审发现；且不应在「降低 Driver 自身摩擦」的动机下修改护栏。须走 `/dual-review-code` | hooks.ts `WRITE_LIKE` / `bashTargetsProtected` |
