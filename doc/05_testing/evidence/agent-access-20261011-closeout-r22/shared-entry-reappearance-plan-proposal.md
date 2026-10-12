# 七共享入口重新出现：只读事实及迁移提案（本批不实施迁移）

2026-10-12只读核对确认七份~/.agents/skills/dual-*入口重新出现，目录mtime为当日10:02:30（Asia/Singapore）；七个SKILL.md与既有迁移copied/moved备份字节相同，备份没有损坏。恢复者、恢复来源均无证据，记null。此前正常四目标安装成功是历史事实；当前已安装runtime/四目标28入口仍与源码相同，但再次正常完整安装会命中安装器共享同名检查，当前安装状态不得继续写成“完整四目标无冲突”。

实际hash/目录清单见shared-entry-reappearance-audit.json。dual-review-bug/code/plan/run四份共享SKILL与当前Claude渲染源不同，其余三份与当前Claude源同hash；七份与当前Codex载体入口hash均不同。现有安装器src/install.ts:24及280..310按完整读取面检查Codex/GLM的共享同名入口，只查不装该根；保持原检查，不给安装器新增豁免。客户端实际重名解析未测，不把安装器提示当作新客户端实测。

只读扫描Work下一层AGENTS.md找到HomeIn、KaiXinGuo-SEL-czb、TriviumCode、deepseek-harness、kaixinguosel-main、pydantic-ai、trivium-m11-accept的流水线/共享根文字线索，精确路径/hash见审计。这些文字不能证明实际运行依赖共享入口；完整依赖面未测。此前shared-entry-audit.json作为历史保留，不改写其来源结论。

建议复用此前迁移方式，但建立新的~/.trivium/evidence/agent-access-20261011-closeout-r3/shared-reappearance-20261012独立备份目录：先保存七目录完整inventory、权限、symlink和文件hash；复制到copied/并逐项核对后，在源和目标未被外部改动且目标不存在时按七具名目录移动到moved/，核验两副本及原位置缺席。若任何hash/类型/权限或依赖事实变化，停止，保留现有入口及已备份事实，不删目录、不覆盖目标。之后正常安装四目标，不跳过检查，核runtime/28入口及副本；不是只限定安装claude/gemini后就报告完整安装通过。

影响范围：只涉及这七个共享目录，不动其他skill、用户凭据或模型配置；Codex/GLM依赖各自入口根，Claude/Gemini保持各自入口。依赖共享入口的其他仓库可能失去共享发现，因此完整依赖未知仍是明确风险，实际客户端解析保持未测。恢复方法：先备份迁移后的目标状况，在七原位置均不存在且moved来源hash仍等于备份时逐一移回；任何原位置已存在或外部变化不覆盖，交由Bob决定。恢复会重新产生同名安装冲突，必须如实报告。

本28B只审查此具体提案与安装状态边界；本轮不执行共享目录迁移/删除，不把普通代码审批或历史迁移批准追认到新恢复的目录。在需要正常完整重装前，须按原任务第五节取得Bob对这次七个具名目录迁移的明确批准。期间正式计划审查仍通过既有项目TV/运行时和已核Codex独立入口执行，不能声称共享入口发现无歧义或四目标重装已通过。

最初静态审计“七备份变化”失败保留于audit-before28-initial-shared-failure.json及其原脚本；诊断是共享目录重新出现，不是旧备份损坏。后续审计必须分列“已安装副本一致”“七备份一致”“共享重名七项/完整安装当前阻断”，不能删除共享目录来伪造原零冲突事实。新共享文件hash纳入审前冻结，审查中如外部变化则停止/判漂移，不悄悄忽略。
