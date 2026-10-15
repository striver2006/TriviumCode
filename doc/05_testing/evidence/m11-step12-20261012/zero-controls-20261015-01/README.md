# Z01：剩余负对照的零厂商准备与用户终端停点

适用日期：2026-10-15（Asia/Singapore）。这是新批次，不重跑 D 审批、恢复或旧采集脚本。当前厂商边界授权增量为 0；原总额 80 已用 71，剩 admission=1、review=8 不构成本批调用授权。

## 已实测与未测

| 判据 | 本次直接调用结果 | 真实客户端集成 |
| --- | --- | --- |
| 5.1 | 完整真实归档副本，hook-pre-commit 退出 0；原主仓基线不重跑 | 未测 |
| 5.2 / 5.3 / 5.4 | Bob已在系统终端执行：缺件2→恢复0，改件2→恢复0；路径/run/hash及完整恢复已核验 | 未测 |
| 5.5 | 已初始化、从无审查记录的独立仓库，hook-pre-commit 退出 0 | 未测 |
| 6.7 | 原项目 hook-pre-bash shell 命令，在新建的缺 wrapper 夹具中独立退出 2，报护栏失效 | Z01具名真实Bash仍仅呈现pre-commit错误；pre-bash独立事件未证实，wrapper恢复已核验 |
| 8.2 | Bob终端实测gate 0→2→0；仅报missing_findings、CODEX-04；恢复核实，终端判据通过 | 原判据为终端 gate 输出；不将 B1 证据不足追改为合格三审 |

证据在本目录 `copy-baseline.json`、`no-reviews.json`、`wrapper-missing.json`。每项含输入、退出码、输出、前后状态、预算和证据层级。`git commit -m x` 只是 JSON 输入，从未执行提交。

## 副本、备份与限制

- 原工程：`/Users/chenzhenbo/Work/trivium-m11-step12-20261012`
- 完整副本：`/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/archive-copy`
- 完整备份：`/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/backup`
- `preparation.json` 逐项保存 141 个文件的 sha256、权限和大小；复制包含独立 `.git`，无硬链接或软链接。不复制用户全局凭据。
- 原 wrapper 绑定原工程 cwd，不能在副本运行，也不能据其 cwd 拒绝误判产品缺陷。本批取证入口仅允许固定的 gate / hook 参数，用相同安装 bundle 和既有预算侧车、review 绝对上限 401；未改生产 wrapper、配置或运行时。缺 wrapper shell 守卫直接在 exec 之前退出，不进入编排器或厂商。
- `gate --check` 会更新副本 `task.json.joint_checks`，所以本轮主会话没有执行它。以下用户脚本会记录这些变化，并在最后恢复副本 task 原字节。没有批准、拒绝、放弃或重新开启闸门的命令。

## 已完成：Bob 在 macOS 系统终端执行场景 5

以下脚本已于2026-10-15 22:13（Asia/Singapore）由Bob执行并核验通过，**不要重跑**。原始记录见 `user-s5-finished.json`，独立核验见 `s5-assessment.json`。命令仅保留作审计；受保护工件副本的改动由用户终端发起，主会话只读核对。

```bash
cd /Users/chenzhenbo/Work/TriviumCode
node doc/05_testing/evidence/m11-step12-20261012/zero-controls-20261015-01/user-terminal.mjs s5
```

动作顺序：删除副本 `2026-10-12-m11-s12-capacity-r2-gemini.md` → Hook 退出 2，点名文件、run `20261012T154021Z` 和“已丢失” → 从备份恢复 → 退出 0 → 在副本 `…-r2-glm.md` 追加一行注释 → 退出 2，输出“记录 xxx，现为 yyy”（生产文案为前后 hash 的前 12 位，完整 hash 另存前后快照）→ 恢复 → 退出 0。全程没有真实 git commit。

预期末行 `pass:true, restored:true, originals_unchanged:true`，预算 838/401。原始 Hook 退出码分别在 `artifact-missing.json` / `restored-missing.json` / `artifact-changed.json` / `restored-changed.json`，外层成功退出 0 不等于负对照 Hook 退出 0。

一旦与预期不符，停止后续负对照，只执行备份恢复并记录 `user-s5-finished.json`。不要重跑；保留失败记录回传本会话。

## 已完成：Bob 执行 8.2，缺行及恢复核验通过

以下步骤已于2026-10-15 22:21（Asia/Singapore）由Bob执行并独立核验通过，**不要重跑**。证据见 `s82-assessment.json`；命令保留作审计。当前停点转至下文6.7真实客户端独立事件。

```bash
cd /Users/chenzhenbo/Work/TriviumCode
node doc/05_testing/evidence/m11-step12-20261012/zero-controls-20261015-01/user-terminal.mjs s82
```

固定命令为 `gate --stage plan --topic m11-s12-capacity --run-id 20261012T154021Z --check --json`。先在副本验证完整裁决退出 0，再只删除 r2-revised 裁决表中的 CODEX-04 一行，要求退出 2 且 `failures` 中有 `missing_findings`、`ids:["CODEX-04"]`；恢复裁决后同命令退出 0。最终恢复 gate 正常更新过的副本 task，核对全部非 `.git` 文件的原字节和权限。对应证据为 `disposition-{baseline,missing,restored}.json`、`user-s82-finished.json`。

该步骤不会修改原工程，也不会移用或生成任何审批。失败只恢复并停止，不改判据、不重试。

## 异常中断时的手工恢复

若进程被强制终止，`finally` 可能未运行。以下命令也只由 Bob 在系统终端执行，目标必须是 **archive-copy**；不得替换成原工程路径。

```bash
Z01=/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01
cp -p "$Z01/backup/.reviews/m11-s12-capacity/plan/2026-10-12-m11-s12-capacity-r2-gemini.md" "$Z01/archive-copy/.reviews/m11-s12-capacity/plan/2026-10-12-m11-s12-capacity-r2-gemini.md"
cp -p "$Z01/backup/.reviews/m11-s12-capacity/plan/2026-10-12-m11-s12-capacity-r2-glm.md" "$Z01/archive-copy/.reviews/m11-s12-capacity/plan/2026-10-12-m11-s12-capacity-r2-glm.md"
cp -p "$Z01/backup/.reviews/m11-s12-capacity/plan/2026-10-12-m11-s12-capacity-r2-revised-claude.md" "$Z01/archive-copy/.reviews/m11-s12-capacity/plan/2026-10-12-m11-s12-capacity-r2-revised-claude.md"
cp -p "$Z01/backup/.reviews/m11-s12-capacity/task.json" "$Z01/archive-copy/.reviews/m11-s12-capacity/task.json"
diff -qr "$Z01/backup/.reviews" "$Z01/archive-copy/.reviews"
diff -qr "$Z01/backup/.trivium" "$Z01/archive-copy/.trivium"
```

两个 diff 预期均退出 0 且无输出；再由主会话按 preparation 全量核对 hash/权限。不要删除任何已生成证据，不重跑旧步骤。

## 6.7 本次操作已结束：独立证据不足，不再同形重试

重新只读搜索历史 H2 原始会话，同一时段没有 hook-pre-bash 独立结果；原具名 debug 文件缺失。不能从配置存在、pre-commit 失败或本次 shell 直调退出 2 推断其真实执行。

Bob已执行以下权限切换及具名Bash，并报告恢复755；主会话没有代做权限修改或启动客户端。22:28的真实事件 `toolu_7ea1cacd34e54a649b00cd9e` 仍仅返回pre-commit错误，实际退出码未知，具名debug文件不存在；不推断pre-bash是否执行。恢复后原工程、副本、备份完整，预算838/401不变，见 `client-assessment.json`。**以下操作仅保留作审计，不再执行。**

1. 原客户端确认没有正在执行的工具；系统终端执行 `chmod -x /Users/chenzhenbo/Work/trivium-m11-step12-20261012/.trivium/bin/trivium`。
2. 在原客户端要求只发起一次 Bash：`command: "git log --oneline -1"`、`description: "M11-Z01-6.7 hook-pre-bash independent event"`。不调用 Hook CLI、不重试、不执行恢复或其它工具。预期具名 hook-pre-bash 报护栏失效；另一个 Hook 的输出不作替代。
3. 工具事件出现后立即停止客户端续跑；无论成功、失败或缺独立输出，系统终端执行 `chmod 755 /Users/chenzhenbo/Work/trivium-m11-step12-20261012/.trivium/bin/trivium`。不等待或重复触发 Stop。
4. `shasum -a 256 /Users/chenzhenbo/Work/trivium-m11-step12-20261012/.trivium/bin/trivium` 预期 `07ac4e37315b252f103fd4bf475d6c60c896f97230f27d24194bc4a78644be80`；`stat -f '%Lp'` 同一路径预期 `755`。
5. 回复“已恢复 755”，主会话执行新的 `collect-client.mjs` 只读归集并核对预算。该采集器不会把回显中的命令当执行事件；实际退出码缺证据则保留 null。若客户端仍仅呈现 pre-commit，继续记 6.7 未闭合；需另行准备能记录每个 Hook 子进程的客户端诊断方案，不改 Hook 配置来移除其它守卫。

当前停点是逐Hook事件取证准备。后续方案须先明确原始事件来源、如何关联同一次tool_use、实际进程退出码与完整恢复核对；不能只记录调用脚本文本。保留全部守卫及顺序，不通过移除pre-commit使pre-bash显露，不从直接shell调用推断客户端集成。若需要新的客户端启动或诊断配置变更，须先形成具名方案并取得对应授权；本批未作这些变更。场景5的客户端提交护栏集成仍未测，8.2终端判据已通过。

## 后续厂商预算仅规划

剩余：剧本 7（ZCode/Codex Driver）8 格、剧本 9 必选 5 格及可选 9.6、剧本 10 跨 Driver 7 格；另有 1.4 正式失败分支、8.1 的 B1 Codex 证据不足和可选 11.7。本批结果不消除这些缺口。

历史 C-ZCode 估算 6/3、B-Codex 估算 4/4，简单合计 admission=10/review=7，对照当前余量 1/8，admission 差 9；这只是历史假设下的算术，**不是当前有效报价或授权**。B-Codex 的缓存复用假设已不能直接沿用，且最终审核者、路线、版本/包装器边界及当前可用性尚未重新核定。下一批先只读核对选侧和配置，再提交具名冷缓存估算、硬限与失败停点，由 Bob 决定新增授权。不得为了估算启动 doctor/preflight/厂商 CLI。
