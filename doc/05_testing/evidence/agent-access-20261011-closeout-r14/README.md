# 第22B获批精确拒绝取证与第23C完整复审准备

2026-10-11，Driver codex，目标未完成。22B `20261011T142848Z`三原件全文已读，11条接受，裁决与r24定稿仅archive.ts归档。定稿SHA `1c7c4ffff68bff0644f2f156e4afcce064e0cfb40e4afcfe532790934130cee7`；gate及await-approval通过后，依据Bob本轮明确委托记录plan批准，reason显式绑定定稿§2至§4敏感取证守卫，不采用任何生产写替代判据。审批本身由Driver按用户委托执行，会话未声明null。原失败run不恢复。

302份r13静态、551业务文件及10原审查件于裁决前hash全相等；readonly_breach=false、subject/tree无漂移。Gemini/GLM两处evidence未列consulted告警原样保留，现机制不阻断gate，不补写审查声明，不宣称引用完整性无缺陷。审批停点工作树三新增仅本目录裁决来源文件，尚无业务实施；获批准后才开始脚本、测试与规范同步。

`denial-fixtures/`三个原始raw逐字来源及hash见sources.json，旧Read、旧Grep、通用目录Read分别来自真实已存变体4/4/5，回放不等新模型启动。旧Read/Grep原true、通用目录Read原false保持；本轮新函数回放三者true只是实现验证，不追认原false。首次开发回放误把旧system/permission_denied.message字符串当损坏，按合法实录形状修正，失败观察保留在denial-replay-development.json；没有换提示或厂商启动。

业务范围只有获批claudeDenyEvidence及canonical真实deny接线、独立变异和文档；生产judgeDirectoryArm、Codex冻结切片/写标准、Schema/模型/effort/软件版本/全局配置不改。较宽生产初筛不是最终路径权威，脚本只折/private/var；新Grep模拟不能作为实测。源契约保留真实deny新函数接线、非deny旧字段观察和summary旧消费者，所有旧记录保留。

准入673/689、review283/288均预占=完成，正式22/23；本轮静态及测试新增厂商CLI 0，23C预计/硬上限将在全部检查、安装、静态审计后事前发布，旧台账不重置。4c87指纹四完整通过只属于历史；最新local6cc3以及本轮源码/资产变化下12组合完整仍未测。五Claude非flash生产写无新机制保持0，官方Claude待订阅，服务端身份null。后续最小真实清单、指纹和每批预算须在23C批准后锁定再执行。

定向测试已完成42/42；两次串行全检、源/安装14步桩、重建四目标安装及完整23C仍待完成，不以回放或测试通过宣称准入收口。

第一遍npm run check已完成：3210测试、3207通过/3跳过/0失败，日志及完整作用面输入`7ac37129cdfcf3700c34b24b6e87c76359b4997a4fc7480b53f06762a3d45f4f`见check1-r27-denial.json。第二遍已在第一遍退出0后串行启动；未修改作用面输入，等待其真实终态，不预报通过。

第23C送审准备最新采样：两次串行npm run check均已退出0，各3207通过/3跳过/0失败，输入相同；最终重建、源端及安装端doctor桩自检均14/14。正常四目标安装已完成，28份入口及运行时逐文件相等，七份共享迁移备份和四份全局配置hash未变。源码与安装bundle SHA为`28f16e946f1b6128a7f4b1e26aae1ff8c58824f02311a9ccf87ad70dd5d765eb`，嵌入HEAD7733703、dirty=true，尚未提交本轮获批整改。完整验证见check2-r27-denial.json、source-selftest-r27.json、installed-selftest-r27.json及install-before23.json。零CLI静态审计static-audit-before23-283.json通过，settings65,816字节且目录事实与实际项目hash守卫相符；这不证明模型准入。

23C事前批见review-round23-code-batch.json：预计15新增启动、硬上限20，review池依据既有自动CLI扩容委托由288增加15至303，当前283/303；准入仍673/689。正式22/23，仅第23C允许，24拒绝；轮次委托与普通审批不包含准入判据变化。预检后重新核对配置语义、预算与静态审计，再冻结全部业务和静态材料。当前完整准入12组合未测，历史事实及原false原样保留，目标未完成。

23C正式预检已通过：实际新增10启动，review293/303、准入673/689；Claude2.1.296、Codex0.162.1、agy1.3.3、zcode0.16.9未变。只更新三侧auth_routes.checked_at，完整语义diff已核，私有0600快照已删除；local SHA由6cc3变496eed89fe1daf113196ea7a304831e47740432d3b9437f5850e56a1877249a7，模型/effort/共享及全局配置未改。详细记录config-after23-preflight-observation.json；static-audit-before23-293.json再次通过，当前12组合完整未测，不追认历史四通过。第23C启动前全部静态材料冻结，审查期间不修改业务或本目录。
