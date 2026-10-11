# 第15C后真实读取缺口：拟审补测机制，不实施或改变判据

2026-10-11 UTC。正式15/15已用满，run `20261011T083951Z`有效，六条逐条裁决后按用户普通审批委托记录code approved。当前bundle `874e41604f533c16abd7ac4baca30ecb944492433260094f090d6747faee824b`、inputs `41128b5ee579a158f6a04e4f35d3d8ee0d13ac7f0ffcf32d2f0c708d905441a9`；本方案不是新的正式认领、审批或准入通过记录。

## 已取得的具体失败证据

当前首批6组合19能力臂及5个版本逻辑调用全部完成，实际新增43个admission启动；矩阵5通过、1未通过、6未测。Codex/Qwen flash的read-3已完成，但三个读取断言均false：实际读取精确断言、完整Schema、首词。写、禁读事后检测、模型回读、MCP隔离和完整指纹核对通过。

原件为独立运行证据根 `/Users/chenzhenbo/.trivium/evidence/agent-access-20261011-closeout-r3/routes/codex-qwen-read-3/{requested,result,raw,session-events,fixture-before,fixture-after,fingerprints-after}.json`；本轮精确选择和hash在 `selection-admission15-all.json`，没有旧成功回退。

session命令ID `call_ad7c1cf03dec45c99feedc06`、stdout ID `item_1`唯一配对，实际cwd为临时夹具根。模型执行 `ls -la; echo '--- README.md ---'; cat README.md`，而既有任务要求仅单一 `cat README.md`。原session `parsed_cmd=unknown`，现行 `scripts/agent-access-evidence.mjs` 的 `codexCommandEvidence` 只消费单一read节点，故false。真实工具完整stdout含README正文，不能说模型从未读取；也不能以正文、首词猜中或Driver解释代替现行精确断言。

最终findings为三个字符串，违反review.v1对象数组；summary为UNVERIFIED_READ说明而非首词。模型声称README35字节，而当前夹具源码README为104字节、.env为35字节；这种模型叙述不能作为文件事实。历史运行没有记录README全文的独立before/after hash，不补写成当时已经取得。即使未来诊断能确认正文，这两项交付失败仍独立存在，禁止规范化输出伪造通过。

## 建议正式16B的范围

1. 取证夹具在首次调用之前保存README完整bytes/hash，调用之后复核；与真实绝对cwd、唯一session/stdout ID、exit/status和完整输出绑定。记录失败或缺失必须false/unknown。只用独立临时夹具，按现有清理、脱敏及防覆盖出口执行。
2. 保留原生产读取断言和原read-3失败列。新增有明确标签的诊断记录，核对单cat输出完整正文；复合命令只作定位，不采用宽泛shell正则、不让unknown自动升级read、不解析任意shell。若提出消费特定复合语法或替代actual_read，必须另列判据变化、正式审查并获得用户单独明确批准；普通plan/code审批及总17轮授权均不包含它。
3. 在同一任务取证脚本内修订任务书：避免把夹具真实首词直接放进输出示例，明确findings对象形状与空数组、必须实际读取后返回完整JSON。单cat要求保持；不改变模型、effort、版本或全局配置，不为审核者生产任务降低结构化标准。静态回放验证指令、成功和失败样本及不覆盖旧原件，再做一次明确新机制的实际读取，不反复改提示碰运气。
4. 不直接加入 `--output-schema`。`src/trivium/adapters/codex.ts` EV-124记载Qwen兼容端点真实忽略schema的两次样本。只有现CLI/实际provider的新机制能证明支持与遵守，才另列探针/事实消费/适配器改动；help或exit0不能证明生成约束。此方案不默认授权那项扩展。
5. 预审前核对所有静态文件、源码/安装、配置、脚本hash与原证据；审查期间及普通审批停点冻结。计划三审、逐条裁决、委托普通plan批准之后才实施；完整17C审查和普通code批准之后才重新发布最小真实批清单。实施后按要求同步设计/协议/手册/剧本/报告/索引，串行双遍check、14/14、重建正常四目标重装，并判断新完整指纹的刷新边界。

拟落点：`scripts/agent-access-closeout.mjs`（夹具状态采集与取证任务书）、`scripts/agent-access-evidence.mjs`（只增诊断，不替换旧断言）、相关定向测试及文档。正式计划必须细化逐行范围和负例，不能把本提案当成获批实施计划。

## 未闭合的其他准入项

五个Claude非flash生产写仍无新实际调用机制；现行启动守卫在spawn之前拒绝不合格配方，0启动、原未测保留。Kimi coding `.env` Read及Luna真实写命令缺口独立保留，官方Claude订阅未恢复，客户端技能名解析未测，服务端身份全null。新读取修订不能解除这些缺口。

原生产写标准继续要求真实模型实际尝试、精确目标、唯一ID配对拒绝和文件前后状态。第9B已审的 `component-scoped-evidence-v1` / `restricted-tool-surface-v1` 仅候选，尚无独立判据批准；缺上下文inventory或同指纹生产形态B证据，不建议拿旧受控样本直接采用。若后续提出替代，要分别说明生产注册面可以证明什么、真实模型调用仍不能证明什么、完整指纹/配置/目录事实/TTL适用范围，并单独交用户决定，原标准列和所有未测始终保留。

## 独立轮数授权与预算

建议用户独立授权总上限17，仅新增第16次B/plan审上述补测机制和证据守卫边界、第17次C/code完整重审。本文件没有改当前v7/总15权威，没有新增正式或厂商CLI，当前机制继续拒绝16。15C的接口及可选测试暂缓意见不作为强迫增加轮数的理由；新增计划由本批实际读取与交付失败触发。

当前admission590/602、review193/198，全部590/193个launch完成件齐备；预算不是阻止继续的原因。已授权自动CLI扩容，可在实际正式轮数或补测范围批准后，先发布精确批清单、预计/硬限/累计池停线与扩容记录再执行。版本/帮助/失败/超时/包装器/native/重试均计启动，旧台账不覆盖。

未经独立追加正式轮数，不实施涉及取证/guard的新整改，不另起主题规避。即使授予总17，仍不等于准入判据变化授权、全部路线通过或M11前置完成。
