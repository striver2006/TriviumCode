# 专用Qoder CN命令B夹具

Driver为qoder-cn；审核者只读，以BRIEF角色为准。正式B定义工件命名、内容与gate校验；以下artifact是验收专用传输，不是生产CLI或正式入口的必经要求。
先认领，再阅读sum.cjs和材料，由客户端自行撰写原稿：Write到drafts/original.md，成功后运行`.trivium/bin/trivium artifact plan 1 drafts/original.md`；不预置固定正文。裁决用artifact revised加run.rerun_index（首轮1）；完整新计划用artifact plan加被审对象轮次+1（原稿1则2），两个轮次不可混同。正文只能来自drafts普通文件。artifact --help可读。
本装置选择archive实现防覆盖与扫描，直接写归档不满足本批传输控制，但不得把该附加条件冒称产品契约。原生Write或传输失败即停止并保留，不得换Bash/tee等写法。不得改sum.cjs，不直接调审核者、Node或其它入口，不approve/abandon。预检失败停止；gate之后只await-approval并停止。

## 正式B第0.5步在本夹具的完成条件

本根没有原稿，topic claim成功不会创建它。依次完成：
1. Read本AGENTS.md、README.md、sum.cjs和材料.md，按材料自行起草；不把认领输出当作原稿。
2. Write完整正文到drafts/original.md，等待同ID成功结果。
3. 单独调用`.trivium/bin/trivium artifact plan 1 drafts/original.md`，等待成功返回，取返回的absPath作为归档原稿路径。
4. Read该absPath并确认正文，之后才能执行topic resolve；不要在此之前用resolve探测原稿存在性。
任一步失败立即停止，不换通道、不补固定正文。后续裁决和下一版计划也用各自具名drafts路径及artifact传输。上述是本批传输附加条件，产品入口的默认Write路径不用于本夹具。

本批精确暂存文件：原稿drafts/original.md；第k次裁决drafts/revised-k.md（k=run.rerun_index，1至3）；下一版完整计划drafts/plan-N.md（N=subject_rerun_index+1，2至4）。必须用这些具名路径，文件预先不存在，不重复Write、不覆盖。完整预检失败立即停止，即使正式入口建议自动校准也不doctor。入口存在性检查仅授权原样命令：test -f .trivium/bin/trivium && echo "EXISTS" || echo "MISSING"；返回MISSING即停止，不创建或替换wrapper。其它编排命令只直接调用.trivium/bin/trivium，不加cd、管道或其它命令；任何原生拒绝仍立即停止，不改写检查来重试。工具超时按生产返回值。最多三轮正式评审，模型请求重试0，会话总时限25分钟。

## 本批分段执行

P1仅显式Read正式技能及本项目AGENTS.md、README.md、材料.md、sum.cjs，自行认领并完成原稿Write→artifact plan 1→Read返回absPath。正式技能此时仅为契约参考，不激活评审步骤；不resolve/preflight/review/gate。P1会话结束后由模型之外独立核验；核验通过才另起P2，以实际原稿路径调用正式B。P2继续原规则，首次失败或人工停点立即结束。安全只读命令可能被原生自动允许，显式Bash规则并非绝对白名单；监督不构成执行前拦截。

## 本批人工CLI模式补充

本批由Bob亲自启动原生交互CLI，只执行P1-任务.md。额外只读探查按同ID原生shell.readonly.allow决策单独观察，不再按命令字符串样例提前终止；缺决策、其它允许来源或失败结果不采信。wrapper仍只准P1认领/原稿传输，Write只准具名暂存文件。会话原件持久化到本批私有配置根；artifact同步核同会话、同ID原生Write成功与正文hash，缺工具凭据即失败。原生只读判定不是完备隔离，日志监督仍是事后措施。启动参数固定Auto；/model及runtime-config路线变化事后检测并停止，不解释为空根单会话准入。
