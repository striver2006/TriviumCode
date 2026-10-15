# M11 Step 12：逐Hook日志回收与下一停点

日期口径：2026-10-15，Asia/Singapore。本目录只追加新证据，不覆盖Z01/H2旧记录；没有重新执行故障注入、s5、s82、审批或厂商CLI。6.7已取得四Hook真实退出证据；场景5客户端集成仍未测，M11未完成。

## 6.7实际结论

[readback.json](./readback.json)由新只读采集器[readback.mjs](./readback.mjs)生成。此前“独立事件未证实、退出码null”是当时只查会话JSONL与具名debug文件的结论，旧证据不改。本次发现VS Code扩展输出日志保存了真实完成事件。

| 来源 | 时间（Asia/Singapore） | Hook | 完成日志行 | 实际退出码 |
| :--- | :--- | :--- | ---: | ---: |
| H2扩展日志 | 10-13 06:19:14.371 | hook-pre-write | 8392 | 2 |
| H2扩展日志 | 10-13 06:19:20.131 | hook-pre-bash | 8437 | 2 |
| H2扩展日志 | 10-13 06:19:20.131 | hook-pre-commit | 8442 | 2 |
| H2扩展日志 | 10-13 06:19:51.864 | hook-stop | 8519 | 2 |
| Z01扩展日志 | 10-15 22:28:06.723 | hook-pre-bash | 3746 | 2 |
| Z01扩展日志 | 10-15 22:28:06.724 | hook-pre-commit | 3752 | 2 |
| Z01扩展日志 | 10-15 22:28:13.807 | hook-stop | 3800 | 2 |

原始来源：`~/Library/Application Support/Code/logs/20261009T142322/window12/exthost/Anthropic.claude-code/Claude VSCode.log`（H2）及`20261015T143003/window3/.../Claude VSCode.log`（Z01）。两个文件的路径、整文件hash、字节数和具名行的脱敏原文均在readback.json；未整份导出日志或凭据。每条完成记录后都有同事件的`error: status code 2`和护栏失效stderr。退出码来自`finished with status 2`尾部，绝不从shell正文`exit 2`提取。

Z01对应tool_use_id=`toolu_7ea1cacd34e54a649b00cd9e`，request为22:28:06.684，result为22:28:06.727；两个Hook在中间完成。窗口内只有这一条工具请求，参数仍为`git log --oneline -1`及原具名description。扩展日志第418行明确以原项目cwd恢复会话`52c58d79-eb90-4953-89dc-6ebd5923112e`；会话记录入口为`claude-vscode`，版本2.1.296。H2日志只有一次该项目的客户端启动，并有相同session路径，Edit/Bash分别按唯一request/result时间窗关联；Stop另外按`system.stop_hook_summary`关联，不冒充Bash子事件。

**关联边界**：完成日志没有Hook PID和直接tool_use_id，这两项保持null；使用会话、项目、唯一工具时间窗与精确Hook命令联合关联。stdout没有独立记录，保持null。没有补造故障期间的stat。静态配置只能用于核对命令，不作为执行证明。

[通道关联补证](./channel-binding.json)保留客户端通道启动/关闭记录：Z01先前通道在19:42:45关闭，19:42:46恢复原会话，此后没有新的客户端启动记录。该证据补足会话归属，不补造PID。

**三个解释的裁定**：已有证据支持“pre-bash确实执行并退出2，但该tool_result只呈现pre-commit失败”。不支持“pre-bash未执行”。也不能再说“所有原始日志均未保存”；缺的是先前检索来源。客户端为何只选一个错误展示的内部选择机制未研究，不据相同文案推断。

官方[Hook调试文档](https://code.claude.com/docs/en/hooks#debug-hooks)描述了2.1.296起的逐命令完成日志格式；[执行规则](https://code.claude.com/docs/en/hooks#hook-handler-fields)说明匹配Hook并行运行。这些只解释格式与机制，验收结论以本机原始记录为证。

恢复核验：原工程、Z01 archive-copy及backup的83个非.git文件，集合/hash/权限/大小与Z01准备清单完全一致。wrapper为755，sha256=`07ac4e37315b252f103fd4bf475d6c60c896f97230f27d24194bc4a78644be80`；项目Hook配置hash=`20b78840cab2d98fd79c23430f451b8a553f00cbbbfd59ccd66eb806eb9d9d43`，与H2准备值一致。没有新增诊断开关、没有配置差异、没有改序或移除守卫。

预算前后均admission838/review401，本步71/80，余1/8，当前批次授权增量0/0。

## 场景5安全触发准备与范围

[next-preparation.json](./next-preparation.json)记录新的完整副本与备份：

`/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/s5-client-preparation-02/{archive-copy,backup}`

两份都含独立.git，共141个文件；复制时逐字节/权限/大小相等，无硬链接或符号链接。准备脚本没有运行复制wrapper，没有改受保护工件。副本只用于安全命令验证与备份，**不能作为当前真实客户端Hook运行位置**：原wrapper仍绑定原工程cwd，不改绑定、不伪造cwd、不用bundle直调来替代客户端集成。

第一次新预检保存在`s5-client-preparation-01`：Git dry-run刷新了该副本的.git/index，脚本因此退出1。未创建提交，原工程与backup未变，失败副本不恢复、不覆盖。该次Git的具体退出码/原始stdout未落盘，记null；不能用后一次结果补它。其余准备错误见[preparation-errors.json](./preparation-errors.json)。

第二次使用独立`GIT_INDEX_FILE`，结果见[dry-run-v2.json](./dry-run-v2.json)：实际Git退出1（没有暂存变更），仅临时索引变化；副本所有141文件含.git、原工程和backup均未变。没有任何Trivium Hook调用，**只证明安全触发命令不产生提交且隔离索引，不证明场景5客户端已通过**。Git官方[--dry-run说明](https://git-scm.com/docs/git-commit#Documentation/git-commit.txt---dry-run)明确该选项不创建提交；本机实测补充了临时索引的必要性。

下一步最小客户端提案只覆盖5.1健康基线，尚未执行。保持原VS Code Claude Code会话、原项目cwd、全部现有Hook及顺序，客户端只发一次Bash：

```json
{
  "command": "GIT_INDEX_FILE=/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/s5-client-preparation-02/client.index git -c core.quotePath=false --no-optional-locks commit --dry-run",
  "description": "M11-S5C01 healthy archive dry-run"
}
```

`client.index`已经按原索引完整复制，hash在准备证据中。不传`-a`、pathspec、消息或真实提交参数，不修改Git hook配置。Trivium的Bash matcher和commit解析仍会看到本项目的`git commit`；`--dry-run`只限制Git本体，未豁免任何Trivium守卫。静态依据为`src/trivium/hooks.ts`的`parseGitSegment`、`commitTargetsProject`、`hookPreCommit`，本轮未重新执行s5 CLI。

执行前后只读检查点脚本：[client-checkpoint.mjs](./client-checkpoint.mjs)。**以下顺序待Bob确认客户端触发范围后执行，本轮停在第1步之前**：

1. 系统终端运行`node /Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-step12-20261012/zero-controls-20261015-01/hook-readback-01/client-checkpoint.mjs before`。只记录，不启动客户端/Hook；不一致立即停止。
2. 在既有原项目客户端发上面的精确Bash一次，不读技能、不做预检、不运行厂商CLI、不重试。若必须新建/恢复客户端进程或改配置，停下另列启动预算，当前提案不含该授权。
3. 回系统终端运行同一脚本`after`。核对原文件/索引、HEAD/refs与预算；采集唯一description对应的tool_use/result。通过上述扩展日志逐Hook完成事件核实pre-commit退出0；Git返回1不能误判为Hook拒绝。没有完成日志、出现多条请求或新漂移都停止，不自动补绿。
4. 临时索引保留作证据，无需恢复原工程。确需重置临时索引时，由Bob执行下列命令（只改新建的外部临时文件；本轮未执行），之后核对hash等于准备证据的`client_index.sha256`。任何原工程文件意外变化都停下保留现场，不自动restore真实工件。

```bash
cp -p /Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/s5-client-preparation-02/backup/.git/index /Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/s5-client-preparation-02/client.index
shasum -a 256 /Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/s5-client-preparation-02/client.index
```

5.2/5.3/5.4负对照与5.5无记录仓库的真实客户端集成仍未测。**当前副本无法直接执行这些客户端格**：复制wrapper会因cwd绑定拒绝，不能把这种拒绝记作工件完整性拒绝。没有给出删除真实工程工件的命令，也没有通过改wrapper绕过限制。后续需独立授权一份经正式初始化、合法绑定自身cwd且有真实记录的客户端验收夹具，并先完成其预算和备份恢复方案；初始化/配置变更/新客户端均未执行。现有完整副本并不自动满足该条件。5.1若通过也只证明现有完整归档的客户端提交前检查，不证明Git原生pre-commit脚本或缺/改件分支。

## 后续厂商预算：只读重估，不发布可执行批次

路线仍拟用现有参数，活体版本本轮全部null：探针记录Codex0.162.1、agy1.3.5、ZCode0.16.9，已只读保存入口hash，不运行help/version。能力探针TTL7天，认证TTL1小时，最新旧认证为10-15 20:30:40，计划全部按冷缓存计。正式执行时仍要核版本/探针新鲜度，漂移或过期立即停，刷新另估另批；不能把文件hash或旧版本声明当成当前实测版本。

| 批次 | Driver / 审核路线 | 版本边界 | 冷探活边界 | admission核心 | review核心 |
| :--- | :--- | ---: | ---: | ---: | ---: |
| ZCode Driver并取跨Driver code证据 | glm / gemini high模型+low effort、codex deepseek-flash+high | 4 | 3 | 7 | 3 |
| Codex L2 plan | codex / gemini同上、glm GLM-5.3 | 4 | 2 | 6 | 4 |

版本4的依据：当前预检按已探过的CLI检查，即使Codex不是审核侧仍可能查询；已有账本833～836和810～813均为Codex包装器/native2、agy1、ZCode1。冷探活中Codex包装器/native2、agy1、ZCode1；review中Codex2、agy1、ZCode外层及内部共3。账本逐条路径/hash另存于准备证据；不把一次review当一次厂商边界。只计算每批一次入口预检，不为先做一次手工预检再入口重做留隐形预算。

核心合计13/7，相对余1/8，admission缺12；总20次，相对总余9缺11。若必须新启Driver，暂拟另留ZCode3、Codex2个启动边界，拟计admission（此分类需当次批准），则包络18/7、总25，本步会到96，需总额至少另增16。**这5次只是未实测的规划预留，不能作为已验证硬限**；Driver启动包装器/SDK/native计数链、各进程是否受侧车覆盖尚待核对。不能拿review剩余跨池补admission，也不把此提案写回预算台账。

ZCode跨Driver可考虑复用已有Claude plan的stack主题进入code，但这只减少新的plan轮，不授权实施capacity修复；被审改动、当轮Driver模型/provider及正式命令需另发批次。Codex L2另拟独立计划主题，9.1所需写入及当轮审批仍需对应授权。1.4正式失败分支、B1证据不足、剧本7/9/10、可选9.6/11.7均维持原状态。当前批次厂商增量仍严格0/0。

## 交付边界

本目录已完成日志回收、安全触发本地验证、完整副本备份和预算规划。报告与矩阵只将6.7依据新增真实日志改为通过；场景5状态不变。没有业务/生产Hook语义修改、没有容量修复、没有全局配置修改或重装、没有提交推送。旧Z01 delivery-check.json仍是上次完整check证据；本次只跑新增脚本语法、脱敏、矩阵与文档定向检查，不冒充再次全量检查或客户端验收。

[validation.json](./validation.json)记录6份脚本语法通过、文档定向检查30/30、68行CASE/JSON/Markdown对账、脱敏和diff检查通过；原工程全树及运行时不变，预算仍838/401。`client-checkpoint.mjs`仅完成语法检查，真实客户端操作及其前后检查点未执行。

Bob随后明确要求提交、推送。本轮新增[delivery-check.json](./delivery-check.json)：`npm run check`退出0，3624项、3622通过、0失败、2跳过，预算仍838/401。提交前修正生成脚本把缺省observation拼成undefined的展示问题，修正前快照与原因独立保留于[delivery-matrix-correction.json](./delivery-matrix-correction.json)；判据与状态不变。[delivery-audit.json](./delivery-audit.json)记录修正后的脚本语法、脱敏和矩阵核对。未执行真实客户端步骤，自动化检查不替代剩余验收。
