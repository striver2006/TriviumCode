# M11 Step 12：5.2～5.5客户端验收准备

日期：2026-10-16（Asia/Singapore）。本批只完成独立准备，未执行Trivium init、项目采集配置生效、真实客户端启动或受保护工件故障注入。5.1与6.7沿用已完成证据；5.2～5.5状态保持客户端未测。当前厂商增量授权为0/0，累计admission838、review401，本步71/80，分池余1/8。

## 实际前置与cwd结论

[preparation.json](./preparation.json)记录完整归档副本/备份各141文件，路径/hash/权限/大小一致；无源文件硬链接、无软链接。新根：

`/Users/chenzhenbo/Work/trivium-m11-step12-zero-20261015-01/s5-client-plan-20261016-01`

- `archive`：保留真实审查记录的完整副本，暂未激活。
- `backup`：原工程完整备份，不运行任何命令、不改动。
- `empty` / `empty-backup`：新建空Git仓库及备份，各18文件，未写Trivium配置、未产生审查记录。[Git初始化实际退出0](./empty-git-init.json)，这不是Trivium初始化或5.5客户端结果。
- `archive.index`：原索引的外部独立副本；`empty.index`尚不存在，未来只由Git dry-run按需创建。均不用于Hook进程的Git索引替换。

旧wrapper的cwd拒绝来自`client-tv.mjs`对`cfg.fixture`的比较，不是产品wrapper的限制。依据：`src/trivium/init.ts`的`writeWrapper/runInit`、`cli.ts`的`cmdInit`和主设计§5.3。正式init只生成指向安装bundle的标准shell wrapper，并按注册表合并Hook；它不会生成本轮预算外壳。直接拿标准wrapper跑客户端会丢失本轮预算采集层，所以不能直接启动。

本方案不在旧复制wrapper中替换cwd字符串，也不伪造进程cwd。拟在新夹具中经正式init建立运行配置，再安装**另行审阅的具名采集wrapper**。原工程、旧Z01副本、原client-tv.mjs及生产guard/gate/hooks均不变。新的采集层行为等价性尚未实测，不能据静态代码宣称客户端验收通过。

## 可审阅配置差异

[configuration-preview.json](./configuration-preview.json)是纯函数和源代码只读推导的逐文件before/after、hash与完整内容，不是init dry-run或真实初始化结果。

| 对象 | 正式init预计变化 | 随后采集配置变化 |
| :--- | :--- | :--- |
| archive | 仅`.trivium/bin/trivium`变为标准wrapper | wrapper指向本目录`runtime.mjs`，模式755 |
| empty | 新增标准wrapper、共享config、Claude/ZCode Hook、三份协议文件、gitignore、归档README | 同上 |
| 两者Hook | 完整保留PreToolUse的pre-write、pre-bash、pre-commit及Stop、SessionStart，命令/顺序/超时不变 | 不修改Hook配置 |
| archive真实归档/state/本机配置 | 字节不变，不重写旧绝对路径或旧run记录 | 不变 |

[expected-init-wrapper.sh](./expected-init-wrapper.sh)和[proposed-wrapper.sh](./proposed-wrapper.sh)仅保存在证据目录，权限600，未安装。[setup.mjs](./setup.mjs)会逐字节核对正式init实际输出和预览，任何不符都保留现场并停止。它不会为了通过检查而接受新差异。

[runtime.mjs](./runtime.mjs)仅接受两个具名新cwd、`init --json`或原配置里的五个Hook。它沿用原cap-preload及预算侧车，把当前review绝对上限定为401，拒绝新增厂商边界；不会执行doctor、preflight、review、approve、abandon。Hook输入原字节传入安装bundle，stdout/stderr原样透传；独占回执经saveEvidence脱敏。回执保留生产子进程PID、code、signal、输入hash、实际存在的session_id/tool_use_id及预算装载证明。无直接ID时保持null，用原生日志的唯一时间窗辅助关联，不补造。

**证据分层**：VS Code原生日志、原会话tool_use/result是客户端证据；新外壳回执是辅助。所有checkpoint的`acceptance_pass`保持null。若新外壳导致额外拒绝、耗时超限、改变输入/输出/运行环境相关行为，则仅记诊断结果，不给5.2～5.5补绿。即使结构核对通过，也须审阅原Hook配置、安装hash、输入输出一致性及通道归属后单独裁定；本包不自动发布验收状态。

[lifecycle-readback.json](./lifecycle-readback.json)另外核对SessionStart：产品只清理`run_root/<basename>-<cwd-hash>/`对应项目桶；两个新桶均不存在。副本4条闸门仅idle/approved，没有running或待裁决条目。runtime启动前重复检查这些只读条件，出现新桶/待办即停，不清扫原项目运行目录、不回收闸门。

## 第一个停点：只授权本地setup

**当前未授权，以下命令尚未执行。** 新增范围仅包括：在两个新夹具各执行一次正式`init --json`，随后写入本目录已展示的独立采集wrapper；保留全部Hook；最多2次本地编排器init，厂商admission/review增量均0。不包含新客户端启动、任何审查、审批、工件缺/改注入或容量修复。

因为这些命令会写副本`.trivium/bin/trivium`等受保护路径，沿用Bob先前边界，必须由Bob在系统终端执行。不是要求批准生产代码修改。

取得该具名范围批准后，才生成`setup-authorization.json`：记录实际用户指令、`decision=approved`、`scope=s5-setup`、preparation及proposal-manifest的hash、vendor_increment=0/0。**本包没有批准文件，也不提供自批命令。** 脚本缺回执会在任何初始化前退出1，此退出不是产品Hook结果。

获批后的精确命令：

```bash
S5_PLAN='/Users/chenzhenbo/Work/TriviumCode/doc/05_testing/evidence/m11-step12-20261012/zero-controls-20261015-01/s5-client-plan-20261016-01'
node "$S5_PLAN/setup.mjs" archive
# 第一条成功且回读符合预览后，才执行：
node "$S5_PLAN/setup.mjs" empty
```

预期：每条脚本退出0，输出`ready_for_client:false`；保存setup-before/init-result/standard-wrapper/after文件。init及采集外壳实际退出码以新回执为准，目前均null。任何失败立即停，不重试，不接着执行另一个夹具。初始化结束仍不能启动客户端。

## 第二个停点：客户端启动、采集绑定与工件操作

新夹具需要实际cwd正确的VS Code Claude会话；不能从原会话用`cd`代替客户端绑定，也不复用原会话ID。拟最多2个新会话、6次具名Bash：archive健康前置、缺件、恢复缺件、改件、恢复改件；empty无记录。健康前置用于新夹具可用性检查，不重跑或改写S5C01结论。

**Driver新启动的包装器/SDK/native边界数和预算池归属尚未核定，实际启动增量null。** Hook预算侧车只覆盖被包装的本地编排器及其子进程，不覆盖VS Code自己启动Claude的进程。因此当前0/0授权不能启动这些会话；review余量也不是启动授权。本地setup完成后，先只读核对客户端启动链及可计数入口，重新给出明确上限/池/失败停点再批准。当前没有客户端启动命令或有效`client-authorization.json`。

客户端获独立授权、可验证预算约束后，才建立两个`client-binding-<archive|empty>.json`，填写实际cwd、实际session_id、实际会话JSONL及扩展日志绝对路径。真实路径现在未知，不能用旧session或虚构路径填充。批准记录必须带`scope=s5-client`、实际用户指令及本包hash；如果启动消耗厂商边界，就必须先发布新的预算方案/采样基线，而不能直接沿用本包838/401与0/0断言。当前文件设计故意不允许默认跨过该停点。

[client-requests.json](./client-requests.json)列出每一阶段唯一准确Bash input。全部使用外部`GIT_INDEX_FILE`与`git -c core.quotePath=false --no-optional-locks commit --dry-run`；不暂存、不带`-a`、不带路径、不创建真实提交。文件里的expected是预期，实际退出码目前null。

后续获批后逐段操作，每一段均须回读后才进入下一段：

| 顺序 | Bob系统终端操作 | 客户端一次Bash | 预期Hook/证据 |
| :--- | :--- | :--- | :--- |
| 1 | checkpoint baseline before | requests中baseline | pre-bash/pre-commit均0，新夹具健康前置 |
| 2 | checkpoint baseline after；审核真实日志 | 无 | 缺失事件、原配置不符或不等价即停 |
| 3 | fixture-step missing；checkpoint missing before | requests中missing | pre-commit=2，路径与run_id准确，Git不应dispatch |
| 4 | checkpoint missing after；fixture-step restore-missing；checkpoint restored-missing before | requests中restored-missing | 两Hook均0 |
| 5 | checkpoint restored-missing after；fixture-step changed；checkpoint changed before | requests中changed | pre-commit=2，原hash/现hash准确，Git不应dispatch |
| 6 | checkpoint changed after；fixture-step restore-changed；checkpoint restored-changed before | requests中restored-changed | 两Hook均0 |
| 7 | checkpoint restored-changed after；checkpoint empty before | requests中empty（empty会话） | 两Hook均0，无审查记录不误拦 |
| 8 | checkpoint empty after | 无 | 全树恢复、预算、临时索引、原工程与备份核对 |

命令形式（仍未获执行授权）：`node "$S5_PLAN/fixture-step.mjs" <表中动作>`、`node "$S5_PLAN/checkpoint.mjs" <表中阶段> before`及`after`。精确原参数从requests文件复制，不添加自动预检、重试或工具调用。故障注入只触及副本中run `20261012T154021Z`登记的r2-gemini / r2-glm文件；不修改task、run清单、裁决件或state来掩盖失败。

缺件采用移到新根`removed-review`，保留原字节；改件只追加本批具名注释。每次先存before，再改，再存after。恢复只接受该次预期缺失/预期改件hash，拒绝覆盖其它未知变更。受保护工件仍只能由Bob系统终端操作。

## 失败停点、取证与恢复

- 原始来源：对应会话JSONL、该VS Code窗口`Anthropic.claude-code/Claude VSCode.log`、`<新根>/calls/*-{requested,completed}.json`。不整份打印日志/凭据；提取具名请求、完成行及必要通道记录，saveEvidence脱敏且独占写入。
- 关联：先tool_use/result同ID，再相同cwd/session及前后检查点唯一请求；完成行精确匹配原Hook命令，退出码只取`finished with status N`尾部。采集回执有输入tool_use_id时必须相同，无此字段为null，并保留生产子进程PID与实际code/signal。Stop单独记录，不假装是Bash子Hook。
- 5.2/5.3只有工件完整性错误才算目标命中。cwd拒绝、预算拒绝、缺wrapper、待裁决、客户端只展示另一Hook错误均不能冒充成功。Git退出1可能是无暂存变更；被Hook拦住时Git没有执行证据，其退出码为null。
- 任一真实事件缺日志、出现多次请求、额外工具、预算变化或意外文件变化，立即停止，不补跑、不补绿。先保留after证据，再恢复已知故障状态；失败后的恢复不以客户端成功为前提。

普通恢复（Bob终端；只针对已注入的那一项）：

```bash
node "$S5_PLAN/fixture-step.mjs" restore-missing
# 或仅在changed状态时：
node "$S5_PLAN/fixture-step.mjs" restore-changed
```

setup半途失败或出现未知漂移时，先关闭对应客户端，再做整夹具回滚：

```bash
node "$S5_PLAN/rollback.mjs" archive --client-closed
# empty夹具需要回滚时：
node "$S5_PLAN/rollback.mjs" empty --client-closed
```

回滚脚本把失败目录整体改名保留，从独立备份恢复同一路径并核对全树，不删除现场。`--client-closed`是Bob对已关闭客户端的确认，不是脚本已检测进程退出。回滚后的历史批次不可重启；临时索引、回执、失败目录保留。当前未发生任何初始化或故障，无恢复操作。

## 本批交付

`prepare.mjs`与`preview.mjs`已各执行一次，不能重跑。[validation.json](./validation.json)记录新增脚本语法、未授权入口拒绝且夹具不变、本地文档测试、脱敏、68行矩阵对账和预算回读；自动化准备检查不替代真实客户端验收。没有安装或测试生产运行时，没有厂商CLI启动，没有审批，没有提交推送。

容量修复、1.4正式失败分支、B1 Codex证据不足、剧本7/9/10及可选9.6/11.7维持原状态；历史ZCode/Codex预算不是本批授权。当前下一动作仅为审阅并明确授权本地setup，所有客户端及工件修改仍停在执行前。
