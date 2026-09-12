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
| M21 | doing | 已补：install.ts（5 条）、approval（4 条）、zcode availability、同进程并发抢锁与 task.json 并发、真进程树超时。仍缺：invokeAgy / invokeZcode 的命令行构造、topic.ts 直接单测、跨进程抢锁竞态 | test/ |

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
- agy.ts:176 `--agent` 取自配置而非探针结论
- ~~disposition.ts:59-67 表头 `includes('id')` 会命中 Evidence 列；:189-192 `**AGY-01**` 被静默丢弃~~ done
- ~~gate.ts:123-137 裁决件不校验 run_id~~ done
- ~~secrets.ts:133 抛裸 Error；`.env*` 默认 glob 不跨目录~~ done
- ~~verify.ts:119-128 注释称命令「经 init 逐条确认」，实际无该环节~~ done
- ~~dual-approve allowed-tools 只有 trivium 却要求改写修订件；dual-status 提示 `trivium review --wait` 不在 PATH~~ done
- ~~.reviews/README 把 verify/ 列入 --check-artifacts 范围，parseStage 不接受 verify~~ done
- ~~QUICKSTART 说 init 生成 config.local.yaml（实为 doctor）；墙钟 2~15 分钟 vs USAGE 30~40 分钟~~ done
- 重复实现：locateSubject×2、花括号配平扫描×2、路径正则×2、probeScratchPaths×2、runDir 拼接×2
- ~~exec.ts:290-316 safePgrp 用 `getgid` 判进程组无效；`script -q /dev/null` 是 BSD 语法，Linux 无守卫~~ done

## 2026-09-12 双审 · code 阶段（run `20260912T060013Z`，base 0aaf855）

焦点「核实闸门与留痕的绕过路径是否真的堵上」，两侧均判 `request-changes`。
留痕在 `.reviews/审核修复/code/`，逐条裁决见同目录 `-response-claude.md`。
结论是**没有完全堵上**：两侧从不同入口指向同一处薄弱带——`hook-pre-bash` 出口。

四个梯队（hook-pre-bash 出口 / 提交出口 / 审批链 / 参数契约）已全部落地。

| # | 状态 | 条目 | 位置 |
| :-- | :-- | :-- | :-- |
| AGY-01 | done | `bashTargetsProtected` 模板拼正则蜕化为 `[^s]*`（模板里 `\s`→`s`），**主题名含 ASCII `s` 时归档 `_meta/`、`task.json` 对 Bash 写入完全失防**；已实跑复现，改为路径组件判定 | hooks.ts `bashTargetsProtected` |
| GLM-04 | done | 同处：依赖 `<archiveRel>/` 字面前缀，`cd .reviews && …` 漏过；`/_meta/` 要求尾斜杠，指向目录本身不命中。已复用 `commitTargetsProject` 的 cd 归一化 | hooks.ts `bashTargetsProtected` |
| GLM-03 | done | `hookPreBash` 先剥 heredoc 再判写命令形态，`python3 - <<'PY' … PY` 提前放行，两条规则连评估机会都没有；而 `judgeDrift` 把归档与 `.trivium/` 整体排除，无跑后兜底。已改为在未剥离原文上判定 | hooks.ts `hookPreBash` |
| AGY-03 | done | Hook 守卫一律 `test -x "$W" \|\| exit 0`：`rm -rf .trivium/bin` 即让四个拦截型 Hook 永真放行。已区分「未初始化」（exit 0）与「已初始化但 wrapper 没了」（exit 2），并把 `.trivium/bin` 纳入保护集 | hooks.json、.claude/settings.json、hooks.ts |
| GLM-02 | done | `sh -c 'git commit …'` 整段被引号吞成一个 token，`parseGitSegment` 找不到字面 `git` 即 fail-open，裁决期提交拦截与留痕完整性校验同时被跳过。两处都改了：函数内加保守兜底；`if: Bash(git commit:*)` 是**前缀**匹配、该形态根本不触发 Hook，已去掉改由 `looksLikeCommit` 在进程内过滤 | hooks.ts `parseGitSegment`、hooks.json、.claude/settings.json |
| AGY-02 | done | `gate --check` 通过后无条件落回 `idle`，`--await-approval` 是独立一步；Driver 省略它则人工审批被静默旁路，四个 Hook 全部放行 | cli.ts gate 分支 |
| GLM-01 | done | 人工审批闸门可被 Driver 一条 `trivium approve` 自行关闭：`recordApproval` 不校验来源，skill 的 allowed-tools 预批准了 `Bash(.trivium/bin/trivium:*)`。会话比对救不了（人工审批与自批同会话）。已加一次性确认码（`--await-approval` 发码、明文不落盘、用过即废、通过审批必须 `--code`）。**注意它是审计护栏不是权限边界**：码的明文经 stdout 由 Driver 转述，Driver 读得到；真正的边界需要不经过模型的带外通道（TTY / 审批 UI），本项目没有——RUNBOOK 与协议片段已如实写明 | cli.ts `cmdApproval`、approval.ts `recordApproval` |
| GLM-05 | done | `ApprovalInput.sessionId` 从未传入也从未使用，`ApprovalRecord` 不含来源——事后无法回答「这次 approve 是人发的还是模型发的」 | approval.ts:15-22,62-68 |
| AGY-05 | done | `cmdApproval` 允许 approve 省略 `--stage`，会枚举到未裁决阶段并抛 MISSING_ARTIFACT 而非友好提示 | cli.ts `cmdApproval` |
| AGY-04 | done | NAMED_FLAGS 缺 `only/allow-single/session-id`，三者被当成正文吞进审查焦点（已实跑复现：焦点变成「重点看并发安全 --only glm --allow-single --session-id S-TEST」）。补白名单并输出；`--allow-single` 单列为布尔旗标，否则「取下一个 token 当值」会吞掉正文、制造新的静默截断；三条 review skill 补 argument-hint 与模板槽位 | topic-args.ts、三条 SKILL.md |
