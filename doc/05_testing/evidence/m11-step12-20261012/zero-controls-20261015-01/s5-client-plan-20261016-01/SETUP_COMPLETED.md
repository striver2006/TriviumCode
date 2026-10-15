# 两个本地setup完成，仍停在客户端启动前

Bob完成授权的系统终端步骤后，2026-10-16只读核对通过，详见[setup-assessment.json](./setup-assessment.json)。没有重跑setup、runtime、旧采集或恢复脚本。

| 夹具 | 实际init时间（Asia/Singapore） | 安装bundle退出码 | 采集进程退出码 | 当前文件数 | 实际变化 |
| :--- | :--- | ---: | ---: | ---: | :--- |
| archive | 2026-10-16 00:44:25 | 0 | 0 | 141 | 仅wrapper |
| empty | 2026-10-16 00:44:48 | 0 | 0 | 27 | 新增9个预期配置/协议/Hook/README文件 |

两次signal均null，stderr为空，预算侧车装载标记与实际子进程PID/父PID匹配。终端顶层setup脚本退出码没有独立录制，仍记null；after工件与当前全树复核证明setup安装步骤完成，不把子进程退出码冒充顶层退出码。

正式init输出逐文件匹配configuration-preview；最终wrapper与已批准proposed-wrapper字节一致且模式755。Claude Hook全集、命令、顺序和超时未改变。empty归档目录只有README，没有任何审查记录；两个新项目运行桶仍不存在。

原工程141文件、完整备份、空仓备份及外部索引均未变化，原安装运行时指纹不变，无需恢复。预算前后均admission838/review401，厂商增量0/0。原18文件操作包保持冻结。

本批calls仅有两个init请求/完成对，没有Hook调用；实际Hook退出码及客户端验收结论均null。5.2～5.5继续客户端未测，不因setup成功补绿。采集层对真实Hook的行为等价性尚未验证。

**现在不要重跑setup，也不要启动客户端或注入缺/改件。** 下一步只能先只读核定VS Code启动Claude的包装器/SDK/native边界、可计数入口和预算池/上限。当前Hook侧车不覆盖Driver启动，0/0不能扩展为新客户端授权。未生成client-authorization.json，未自动审批、提交或推送。

冻结README及SETUP_AUTHORIZED保留当时停点；本文件是setup完成后的当前交接。
