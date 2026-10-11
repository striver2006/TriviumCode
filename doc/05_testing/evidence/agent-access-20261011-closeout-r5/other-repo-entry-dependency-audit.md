# 共享七入口迁移后的其他仓库依赖只读核对

采样：2026-10-11，第12次代码审批拒绝、正式12/12，未修改任何用户级入口或其他仓库。检查范围为`/Users/chenzhenbo/Work`**一级子目录**、各自`.trivium/config.yaml`/`.trivium/bin/trivium`有无及wrapper前8行，以及用户级七个同名目录有无；不搜索其他磁盘位置，不推断客户端实际入口解析。

| 仓库 | 项目config | 项目bin | bin运行时目标 | 仓内三类局部七入口 |
| :--- | :--- | :--- | :--- | :--- |
| HomeIn | 有 | 有 | `~/.claude/skills/dual-critic/scripts/trivium.cjs` | `.agents/.codex/.claude`下均无 |
| KaiXinGuo-SEL-czb | 有 | 有 | 同上 | 均无 |
| TriviumCode | 有 | 有 | 同上 | 均无 |
| UniClip | 有 | 有 | 同上 | 均无 |
| trivium-m11-accept | 有 | 有 | 同上 | 均无 |

上述是`~/Work`一级目录中全部同时/分别有项目config或bin的五仓。五份bin wrapper均固定调用`/opt/homebrew/opt/node/bin/node`和同一Claude运行时目标；因此**运行时bundle更新会影响五仓使用这些wrapper时的执行版本**。本次检查没有在任一仓的`.agents/skills`、`.codex/skills`或`.claude/skills`发现七个局部入口，不等于客户端没有通过用户级目录或别的机制发现入口。HomeIn、TriviumCode及trivium-m11-accept的AGENTS.md明确记四条正式入口；KaiXinGuo的AGENTS.md也有入口约定；UniClip只在本次config/bin清单中确认启用，没有就其UI做实测。

本时点`~/.agents/skills`的`dual-run`、`dual-review-plan`、`dual-review-code`、`dual-review-bug`、`dual-approve`、`dual-abandon`、`dual-status`七目录均缺席。此前获批迁移备份仍在`~/.trivium/backups/trivium-shared-r14-1791686121897-5a253e93-eab3-4364-ac01-8d0928592994`；第12次前`install-round11.json`保存七份copied/moved内容核对、四目标28独立入口与运行时bundle一致。迁移的实际恢复方法仍按既有获批方案与该备份逐件反向恢复，不在此重新执行。安装器报告`client_name_resolution=null`，本轮没有启动五仓各客户端验证重名优先级或缺席七共享目录后的入口发现；因此影响结论限于**wrapper运行时依赖已实测、技能名解析未测**。七目录曾未知来源重现一次，来源仍未查明，不能宣称永不复现。

若未来再更新安装bundle或恢复共享七入口，先按五仓影响清单核wrapper目标、专用28入口和备份hash，再对各实际客户端做具名入口发现测试；未获Bob明确迁移/删除授权不得再动共享入口。本文件是只读依赖审计，不构成再次迁移授权、产品准入或正式复审。
