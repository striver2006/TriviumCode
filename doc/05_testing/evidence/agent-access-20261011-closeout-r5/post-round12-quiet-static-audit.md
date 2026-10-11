# 第12次三审后摘要入口静态复核（零CLI）

采样时点：2026-10-11，第12次code审批已拒绝、正式12/12，未启动第13次。本件只读当前生产源码、运行`assertQuietCommand`导出函数的纯内存断言，并统计既有完成件文件名；未调用审核者CLI、Trivium命令、预算reserve或模型。

## GLM-02实际边界

`quiet-launch-v6.mjs`的`single(flag)`只查旗标出现恰一次且下一token非空。纯函数直调以下三项均返回允许：

- `tv topic claim --topic --driver codex --stage plan`
- `tv topic resolve --stage -- focus --topic example`
- `tv preflight --stage --driver codex --critics claude,gemini,glm`

但当前`src/trivium/cli.ts:92-139`的`parseArgs`遇到下一token以`--`开头时将该旗标记为布尔`true`；`flagString`在`:425-434`遇到这种值抛usage error。`cmdTopicClaim`在`:914-921`先读stage/topic/driver，之后才进入写任务状态分支。因此上面claim形态不能如审查意见假设的那样在当前产品CLI中“以--driver为主题成功认领”；resolve与preflight也在解析stage时退出。此处是**静态源码证明**，没有另起CLI子进程实测，也不外推未来CLI版本。

可确认的漏洞仍是摘要入口在预算读取与spawn之前**放行了本可本地拒绝的无效形态**，引起无用CLI启动和启动数消耗。第13次正式计划应聚焦这层前置过滤，新增真实子进程隔离测试核0 spawn/0预算/0任务写；保持产品CLI自身验证为第二道防线。第12次裁决的“接受”与code rejected不追改，只在新计划里显式收窄风险陈述。

## CLAUDE-03实际边界

`quiet-launch-v6.mjs:28-34`在child结束后扫描共享calls目录，按`${label}-`前缀筛全部历史`-completed.json`并要求恰好1份；`launch-v8.mjs:47-71`每次随机生成token，只写入requested/completed文件名与内容，不向quiet回传。本次零CLI只统计完成件文件名：共246件，246个不同label，当前没有重复label的实证。若同label后续再次调用并写成新completed，quiet会误报不唯一；若本次未写completed但同label旧件存在，它会把旧件放到本次结果的`evidence`字段，尽管当前child退出码仍保留。后者是证据指向错配，不能称已发生实际通过。二者均由现有选择谓词直接推出，需新版本按本次load_id精确配对并做重复label/缺本次completed负例；旧完成件和v6脚本字节不动。

本诊断不变更生产写准入判据：即使修好摘要入口，仍不得拿静态脚本、受控响应、无文件或权限诊断替代真实模型写尝试和配对拦截。
