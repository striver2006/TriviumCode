# PROTOCOL：Driver-DualCritic 工件中继与协议契约

2026-10-12第27C普通批准采样：run20261011T212239Z三审有效、零漂移，三意见2暂缓1驳回，gate/await通过、停点业务摘要0；按Bob本轮明确委托由Codex批准code，session=null。两项准入判据仍未采用；新r22保存160份r21原件hash和具体27臂/4跳认证决策方案。下文26B阶段状态按当时采样解释，原false/未测、停止批次和官方Claude待订阅保持，M11前置未完成。

26B已有效审查并按Bob普通委托批准完整r30（SHA 9c457711d4146644d9dedd976cbdf854128283df0802ddf32ba6f4bc0cf75d5c），新CLI inline defaultMode/精确deny差异、有界1..32逐跳原值/hash及v3关闭消费者规范见[设计v1.3.158当前合同](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-inline-mode3-contract)。旧v2/mode2正文按历史采样保留；v3/auth两项独立采用仍未批准，原标准false/未测不改。实施采样：Qwen max一次真实CLI取得default与受控机制事实，事后proof错误使首批停止；修正后只读复算通过，原停止保留，k3及其他组合未启动。27C预检正常刷新三项认证时间，4跳/27臂/378组件/91引用重验通过，当前6a2c6213 canonical0通过/12未测。r21实际消费者先核15依赖及独立批准，忽略调用方事实布尔值，再重验原件/完整指纹/scope；候选报告消费与产品准入分列，实际两个候选缺批准保持关闭，正向实际独立批准消费未测。准入734/742、review353/363全部完成，正式26/27，27C尚未启动，M11前置未完成。

证据域guard的前向流程及25B获批敏感范围统一见[设计v1.3.157](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-evidence-guard-contract)。新增时间链须同auth-timestamp-applicability.v1机读诊断；approval/revocation形状与唯一源对账，未批引用null。产品和历史Schema不改，普通plan/code不采用候选。

`run.v3.requested_routes` 在执行前按入选审核者保存 `{model, effort, tier, tier_source, access}`，提前取消、worker 启动失败仍保留请求。运行中尚未产生结果时 `critics` 可以为空；没有实际启动或回读不能填成成功。worker 校对交接与该请求快照一致后执行，不重新路由。报告 JSON 的 `requestedRoutes` 和无结果注记供复核；历史 v1/v2 缺席该字段，不补写磁盘。

> 依据 [设计](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md) 第 6、7、9 章与 [PRD](../01_requirements/PRD_driver_dual_critic.md)（两者的当前版本见其文档头）。
> **本文是对实现的描述性汇总，不是第二份规范。** 与设计文档冲突时以设计为准。
>
> **当前写契约**：`config.v2` / `run.v3` / 四家已启用审核者 + 两家 L2 Driver-only / `--driver <id>`；`run.v1`、`run.v2` 原形保留并严格分发读取，verify 独立。Kimi Code 与 Qoder CN 当前只登记 Driver，不进入审核者集合；双模式真实准入状态以本次验收报告为准。

> 2026-10-10真实补测独立保存请求、配置指纹、回读和轨迹，不回写历史run/Schema。准入预算与正式审查预算分池，预占先于spawn，现行机制扩容序列连续且原子发布，重启不清零。首条bootstrap扩容的发布机制和确切时刻无回读，另记边界，不追写历史。工具没有实际尝试时拒绝结论为null；供应商/effort没有运行回读时为null。原48/48证据冻结。
> `run.v2`（含 `driver` / `critics_selected` / `review_mode: full|partial`）于 M7b 第 3 步生效，规范见设计 6.7.1；
> `config.v2`（`critics.*` → `agents.*`、`allow_single_flag` → `allow_partial_flag`、
> 新增 `review.default_critics` / `max_critics`）于第 4 步生效，规范见设计 13.1.1。
> 两份 v1 均降为**历史契约**：`run.v1` 读侧双读，`config.v1` 读侧自动迁移——
> **已初始化的项目不改配置也能跑**，磁盘改写由 `trivium init` 可选执行（带备份）。
> **`--critics <id,…>` 自 M7b 第 5 步起生效**：选 1～`max_critics` 个审核者，
> 缺省取 `review.default_critics`，校验不过退 64 且零工件；`--only` 是它的单元素旧写法，
> **两者同时给即拒**。选 1 侧记 `review_mode: full`、不写 `degraded_reason`——
> 配置意图不是降级。规则细则见设计 7.1。
> **`--driver <id>` 自 M9 第 5 步起生效**：缺省 `claude`，取值须为**可用作 Driver 的 Agent**（已登记且 `driverEnabled`；M10a 第 3 步起四家均已启用）。未登记或已登记未启用的一律退 64——M9 时是「只校验已登记、未启用的放行并标注」，M10a 第 3 步收紧；收紧只作用于经 `resolveDriver` 的入口（`review --start` / `preflight` / `topic resolve` / `topic claim`，含继承判定后的再解析）。
> 它决定本轮谁是 Driver，进而决定**原稿与裁决件的后缀**（`locateSubject` 按它定位
> 被审对象，写错后缀在 `review --start` 就退 65）、闸门按谁定位裁决件、以及留痕里
> 记的发起方。规则细则见设计 §7.1。
> **既有四家入口自 M10b 第 2 步起生效；Kimi/Qoder CN 的 L2 Driver 入口已生成**：既有安装目标与调用写法见设计 7.4.1；Kimi 使用官方外部 Skill 的 `/skill:<name>`，Qoder CN 使用 `/name`。两家真实客户端加载/调用仍未验收，不能据入口生成宣称客户端通过。
> 各自在 `preflight` / `topic resolve` / `review --start` 里写死本载体的 `--driver`；命令 A / B / D 的入口在写原稿之前跑 `topic claim`。
> 选侧来自缺省集合时**先减去当轮 Driver**（D-4）。非 claude 载体上命令参数由 Driver 模型转抄，保真边界见设计 8.5。
>
> **裁决件 `role` 自 M9 第 6 步前置（EV-66）起放宽**：取值是**当轮 Driver 的 Agent id**，
> schema 不枚举（`type: string`），「是否已登记」由代码层按注册表校验——与 `run.v2` 的
> `driver` 同口径。**不是「enum 四值」**：那等于在 schema 里抄第二份 id，第五家登记时必漏改。
> 文件名后缀与 `role` 必须同指一人，闸门两头都比对，不一致即 `bad_front_matter`。
>
> **`addresses` 基数 1～3 已随 M7b 的 `--critics` 生效**（`minItems: 1`）。**份数等于本轮落了审查文档的入选侧数**
> （status ∈ {ok, parse_fallback}，失败侧不计），每项是审查文档的文件名（或以 `<主题>/<阶段>/<文件名>` 结尾的路径）、**不是意见编号**；
> 闸门按 `run.json.artifacts[]` 派生期望集逐项比对（设计 v1.3.45 / EV-134；此前只核非空）。
> **意见编号前缀由注册表派生**（既有前缀不变；Kimi/Qoder CN 的 `KIMI-` / `QODER-` 仅为 Driver 留痕命名，当前不产审核意见）；
> **档位旗标 `--tier-<id>` / `--effort-<id>` / `--profile-<id>` 自 M11 第 5 步（设计 v1.3.132）起生效**：`review` / `preflight` / `topic resolve` 都收，键必须是本轮入选审核者（与 `--model-<id>` 同一判据），`--profile-<id>` 只对带厂商 profile 概念的侧成立（目前支持 `--profile-codex` 与 `--profile-claude`；同侧可用 `--native-<id>` 显式清空）。**M11 第 6 步（设计 v1.3.133）起三类值都随请求下传**：思考等级经各家通路（codex 的 `-c model_reasoning_effort=`、claude 的 `--effort`、agy 的 `--effort`，gemini 的 slug 已编码档位时不传、只告警），厂商 profile 成为 codex 的 `-p`；第 5 步时的过渡闸与「档位名不入档」告警已拆除。run.json 审核者条目恒写 `effort_requested` / `effort_effective` / `effort_effective_source` / `tier` / `tier_source`（null 也写；缺席＝第 6 步之前的旧留痕），顶层写 `profile`（档位表名）；`effort_effective` 只取回读，codex / claude 恒 `null` + `unverified`，审查文档 front-matter 同值。（v1.3.43 前此处写「M10b / M11」；M10b 份额是四家入口，已生效，见上。）
> `--critics` 当前可选四家：codex / gemini / glm 为缺省集合（默认即三侧，D4-4），
> claude 只在 `--driver` 取非 claude 时可入选（当轮 Driver 不得入选）。
> **按本文实现的客户端不会被演进破坏**：读侧双读、旧形态长期兼容。

各方（当轮 Driver 与入选审核者 Critic-A～D）之间**没有**任何进程间
协议——它们互不通信。全部协同经由**本地文件**与**编排器进程**完成。这是有意的设计
（原则 P4 工件即接口）：能被读、能进 Git、能事后独立复核的东西才算接口。

---

## 一、六份 JSON Schema

机读契约的唯一真理来源在 `skills/dual-critic/schema/`，ajv（draft 2020-12）强校验。
`review.v2` / `review.v1` 由 `parse` 持有（要把错误回喂给模型），其余集中在 `schemas.ts`。

| Schema | 文件 | 生产者 | 校验落点 |
| :--- | :--- | :--- | :--- |
| `trivium.review.v2` | `review.v2.json` | 各入选审查员（最终回答即该 JSON；EV-247 起的现行写契约） | `parse` 新产出只认 v2（失败即 parse_fallback） |
| `trivium.review.v1` | `review.v1.json` | **已停写**（EV-247 之前的审查员产出） | 只读：重读归档与取证重放两版都认；「是不是审查件」的判据认 v1 ∪ v2 |
| `trivium.disposition.v1` | `disposition.v1.json` | Driver（裁决件 front-matter；表格由 gate 单独解析） | `gate --check` 的 bad_front_matter |
| `trivium.run.v3` | `run.v3.json` | 编排器（当前审查写契约） | `writeRunMeta` 写前校验；含请求路线、回读来源与模型族三态，留痕核对拒绝不合契约的工件 |
| `trivium.run.v2` | `run.v2.json` | **已停写**（历史审查契约） | 按原 schema 严格校验后读取；旧布尔值只显示为旧版名义族判定 |
| `trivium.run.v1` | `run.v1.json` | **已停写**（M7b 第 3 步前的编排器） | 只读：既有归档按写入时的规范解读，读进内存时迁移为 v2 形状 |
| `trivium.config.v2` | `config.v2.json` | 人（`.trivium/config.yaml` / `config.local.yaml`） | `loadCtx` 四级合并后校验，不合法退 69 并逐条列出（未知字段、枚举值、区间） |
| `trivium.config.v1` | `config.v1.json` | **已停写**（M7b 第 4 步前的形状） | 只读：`loadCtx` 在合并**之前**逐源迁成 v2，磁盘文件不动 |

**`run.v2` 的可选字段 `driver_guard_level`**（M10b 第 3 步，B1）：取值 `L1` / `L2`，记当轮 Driver 的**有效**护栏等级（登记 L1 的载体在 Hook 配置不在场时记 `L2`；登记 L2 的恒 `L2`，不读探针字段），规范见设计 8.5。**可选**：早于该步的留痕没有它，缺席即「无从得知」，不等于 L1；`trivium report` 时间线对旧留痕显示「—」。其余字段不变。

**`run.v2` 的可选字段 `termination`**（设计 v1.3.48，EV-142；v1.3.50 扩值，EV-145；v1.3.51 扩值，EV-150）：`{ by, exit_code }`（`by` ∈ `worker_exception` / `prepare_exception` / `sync_exception` / `post_spawn_exception`）或 `{ by: "worker_lost", reason }`（`reason` ∈ `no_status_file` / `heartbeat_stale` / `pid_gone`），记这一次 `failed` 由哪条事后收尾写：worker 异常分支自己写、`--wait` 判 `worker_lost` 且工作进程确认已退出时写（或 `--cancel` 在 `--wait` 判 `heartbeat_stale` 之后结束仍挂着的工作进程并确认退出时照写同一取值，设计 v1.3.54，EV-146；或同主题下一次 `--start` / 同步 `review` 回收遗留运行锁、锁里记的持锁进程已不在时给上一轮写 `pid_gone`——同步运行被中断也记这一取值，设计 v1.3.106，EV-151 / EV-220）、准备阶段写完骨架之后失败（含 `--start` 在子进程诞生之前失败）或同步路径异常时由本进程写、`--start` 在子进程诞生之后失败时终止工作进程并确认退出之后由本进程写（`post_spawn_exception`）；都只在 run.json 仍为 `running` 时写。**只增不减**：旧版本读不懂新取值，回滚代码时保留取值面（schema、`EXCEPTION_TERMINATION_BY`、`report` 的说明与对应用例），只回退行为代码。只存结构化字段、不存异常原文。缺席 = 正常收尾、取消轮（`status: cancelled` 已说明来路）或本字段之前的留痕，规范见设计 6.7 注记与 6.7.1。

**`run.v2` 的可选字段 `plan_final_check`**（设计 v1.3.89，EV-214）：`{ subject_rerun_index }`（正整数或 `null`，`additionalProperties: false`），只在**计划阶段**写进骨架，代码与 bug 阶段不写。存在即「本轮按设计 6.6 规则 9 判」：`gate --check`、`--await-approval` 与 `approve` 的复核对带它的轮次要求——裁决件有期望集内的接受项时，执笔方的新一轮计划存在（轮次高于本轮被审对象）且每个接受编号整词逐字出现，否则失败码 `missing_next_plan` / `next_plan_missing_ids`（`gate --check --json` 的 `failures[]` 里，排在全部既有失败项之后）。`subject_rerun_index` 是被审对象的轮次，被审对象在归档外或名字不合规时为 `null`（基准退回 `rerun_index`）。缺席 = 本字段之前的留痕，有接受项时 `warnings[]` 多一条 `next_plan_unchecked`、不判失败。对外 JSON 形状的加法，旧调用方忽略。

**`run.v2` 的可选字段 `snapshot.drift.unknown_reason`**（设计 v1.3.70，EV-139）：`{ cause, detail }`，`cause` ∈ `object_gone` / `git_error` / `timeout`，对象不收额外键。只在跑后复算**比不了**改了哪些文件时写（第四节 3.a′）：此时 `changed: true`、`files: []`、`policy` 为本轮的 `on_drift_related`，既有三字段含义不变。`detail` 是单行事实（报错首行，截 300 字符；tree 值不合形状时不回显该值）。**只取加法**：`drift` 子对象本身不禁额外键，旧版本读新留痕照过（只看到「changed 真、0 个文件」）；缺席 = 比对成功或本字段之前的留痕。规范见设计 9.2 与 6.7.1。

### `trivium.run.v3` 与历史读侧分发（按阶段，设计 6.7.1、11.6）

审查阶段（`plan` / `code` / `bug`）新写 `run.v3`；读取先按原件 schema 校验 `run.v1`（迁移为内存 v2）、`run.v2` 或 `run.v3`，
**其余取值含缺失一律判「不可读」**——此前是「非 v1 即放过」，把 `schema` 改成任意
字符串就能让工件清单脱离契约校验。verify 阶段另认 `verify-run.v1` 与历史 `run.v1`，
且**不施加审查元数据契约校验**：那是按写入时的规范解读留痕，改错会让归档中的历史记录
被判不可读，进而永久拦死每一次提交。

`run.v2` / `run.v3` 的 Agent id 与 vendor **不在 schema 里枚举**：唯一来源是 `agents/registry.ts`
（设计 §16.2 纪律 7），身份校验由 `schemas.ts` 在 ajv 之后按注册表补做。

v3 必填 `driver_declaration: {model, provider, source}`（可选 CLI 的会话声明；缺席值 null、source null），`family_comparisons: [{left,right,status,left_model,right_model,left_source,right_source,reason}]`（三态 status）。逐侧 `heterogeneous` 为三态；`access` 必填并记录 `requested_mode`、`profile`、请求/实际启动入口、包装器/配置哈希、供应商声明/回读及来源。不能用 profile 名称充当供应商回读，不能用请求模型充当有效模型。历史布尔只标「旧版名义族判定」，不重算、不回写历史文件；verify 继续使用自身契约。

接入旗标由注册表 `supportsProfiles` 派生：`--profile-<id> <name>` 或 `--native-<id>`，同侧同时给出退 64。Claude 非空 profile 经 `cld --profile <name> --print`，正文走 stdin；null 为原生、缺席继承。优先级为单次参数 → 档位条目 → Agent 配置，模型与 effort 独立。`--driver-model` / `--driver-provider` 缺席合法、在场缺值退 64。已知不存在的 profile 退 64；入口、凭据、服务、只读能力不可用退 69；预检与审查准备都先检查参数组合。认证缓存按 Agent/模式/profile/模型/effort 隔离，失败不自动切换路线。

本仓临时供应商策略（2026-10-10）：Claude default/flash → `qwen3.8-flash + qwen`，pro/high → `qwen3.8-max + qwen`；显式Kimi/DeepSeek同时提供`--profile-claude`与`--model-claude`。此为项目配置，不删除native协议能力；官方实测仍待订阅恢复。Qwen默认组合准入后恢复本仓三审，七条全准入仍用于M11前置收口。

### `trivium.config.v2` 的迁移与两段式校验（设计 13.1.1）

`loadCtx` 对**每个** YAML 源单独做 v1 → v2 迁移，且**在四级合并之前**——
顺序颠倒会让磁盘上的 `critics` 段作为额外的键并排落在结果里，而 `agents` 仍是内置默认，
**用户配的值一个都不生效且不报错**。迁移的触发条件也不只看 `schema` 字段：
`config.local.yaml` 是覆盖片段、通常没有那个字段，因此另认 `critics` 与
`review.allow_single_flag` 两个旧形态的特征键（它们在 v2 里都已不是合法键，不存在误伤）。

**迁移只在内存里发生，磁盘文件不动**；`trivium init` 提供可选的一次性改写（备份走 `O_EXCL`，
YAML 往返会丢注释，原注释保留在备份中）。三条跨字段规则由代码层补校：
`agents` 的键必须是已登记 Agent（**不要求 `criticEnabled`**——Driver 自身也需要配置容身之处）、
`agents.<id>.vendor` 必须与注册表相符、`default_critics` 每项必须是可用审核者且在 `agents` 中有配置段。

**已废弃键**（机制在 `config.ts` 的 `DEPRECATED_CONFIG_KEYS`，按路径登记）：`gate.max_check_retries`（设计 v1.3.72，EV-30 ①）、
`agents.<id>.readonly_commands`（antigravity 一支，v1.3.72，EV-15）、`review.parallel` 与 `isolation.deny_via_cli`（v1.3.122，EV-30 ②③；
此前本段漏登这两条）、`agents.codex.effort`（v1.3.131，M11 第 4 步；**精确路径**——`agents.gemini.effort` 同名却有消费方，不报）、
`topic.forbid_chars` / `gate.require_adjudication` / `agents.glm.max_turns` / `agents.glm.unsupported_override`（v1.3.136，EV-30 ④～⑦；此前本段漏登这四条）、
`profiles.<表>.<id>.effort`（档位表 Agent 级，v1.3.165，M12 批次 4，EV-227；路径两层 `'*'`，只命中 Agent 级——阶段格子 `{model, effort}` 里的思考等级在下一层、照常下传、不报）
从未被读取，已删类型与默认值；schema 仍接受（标 `deprecated`、不在 `required`、类型约束照旧），
带着它们的旧配置升级后照常通过。出现时只有 `doctor`（`warnings`，不影响退出码）与 `preflight`
（名为「已废弃配置键」的只警告项，进 `warnings`）各提示一条，其余命令不打任何东西。

**档位键**（设计 11.5 / 13.1.1，v1.3.131，M11 第 4 步）：`agents.<id>.tiers`（`low` / `medium` / `high` 三档，每档 `{model, effort?, profile?}`；
`profile` 只在 openai 支、zcode 支只有 `model`）与 `agents.<id>.default_tier` 为可选键；`profiles.<表>.<id>.<阶段>` 收三形态：
裸 slug ｜ `{tier}` ｜ `{model, effort}`。本机层覆盖时 `tiers` 整段替换、格子整格替换。预检与 `review` 准备阶段新增「档位组合合法」一格
（原生枚举、无思考等级概念、厂商 profile 名单；不合法退 64、零工件）。思考等级与厂商 profile 自 M11 第 6 步起随请求下传（claude 的取值集合由探针解析 `--help` 落盘），
第 4、5 步时档位里写了思考等级、或档位 profile 与 `agents.codex.profile` 不同即发起前退 64 的过渡闸已拆除。

### `trivium.review.v2` 的硬约束（v1 相同，只差 `verdict`）

- **`verdict` 三档**（EV-247）：`pass`（通过）/ `pass-after-changes`（修改后通过）/ `reject`（不通过）。编排器按侧计票、判本轮结论，结果记入 run.json `round_verdict`，下一步（`rerun` / `proceed` / `human_review`）决定闸门去向（设计 8.2.1）。v1 的四值不参与计票。

- **意见编号前缀逐侧固定，但不由 schema 枚举**：Antigravity 为 `AGY-`、ZCode 为 `GLM-`，各侧不冲突；
  schema 的 pattern 只校**形状**——`^[A-Z][A-Z0-9]*-(r[0-9]+-)?[0-9]{2,}$`
  （序号至少两位，重跑追加轮次如 `AGY-r2-01`）。
  **「哪些前缀合法、各属哪一家」的唯一来源是 Agent 注册表**（设计 16.2 纪律 7）：
  前缀是否属于本侧由 `parse.ts` 的 `checkReviewIntegrity` 按注册表判定，不合则 `guard` 记 integrity 问题
  ——那道检查校的是「属于本侧」，比枚举「在名单里」更强。
  裁决件解析器同样按注册表派生的前缀交替式过滤数据行，所以编号不合规的意见会在闸门处被视为不存在。

  > 此处曾写死 `^(AGY|GLM)-`（至设计 v1.3.5）。M7b 第 6 步的桩夹具实测发现：
  > 那样写会让第三家的**合法**结论被 ajv 拒掉、整份退化成 `parse_fallback`，
  > 而当时没有任何检查看着这份 schema，全套测试照常全绿。详见设计 6.5 与 5.1.1。
- **每条意见九个字段必填**：`id` / `severity` / `layer` / `kind` / `location` / `problem` /
  `evidence` / `suggestion` / `confidence`；四个枚举字段的合法取值见 schema，任务书第 6 节逐一列出。
  结论是一个**裸 JSON 对象**，不加 schema 之外的字段。
- **每条意见必须是可单独接受或驳回的最小单元**——这是「逐条裁决」得以成立的前提。
- `findings: []` **是合法的**（表示没发现问题），但 `summary` 与 `not_covered` 必须说明检查了什么。
- `consulted` 必填，用于与工具轨迹交叉核对（§11.4）。

### 解析与降级：逐条降级与整份回退（设计 §6.5.1，v1.3.68 起）

输出不符合 schema 时**不丢弃**，按能拿到多少分两档：

- **逐条降级**：根对象合法、`findings` 是数组，只是个别意见不合 schema——该侧 status 仍为 `ok`，
  只有不合格的那几条降级：保留**原编号**、逐条进裁决（接受照样要写落点），但**不参与阻断与共同阻断判定**；
  合格意见照常。`gate --check` 对它们出 `degraded_findings` 告警。
- **整份回退**：连根对象都拿不到（没有 JSON 对象、语法修不好、根字段不合、有不合格意见的编号不可用、编号前缀不属于本侧）——
  该侧标 `parse_fallback: true` 并记成因，原文按 `<前缀>-F<序号>` 虚拟编号参与裁决校验，**不参与阻断判定**（§6.6 规则 8）。

校验之前做两类无损修复，剥了什么、还原了几处都留痕：剥掉厂商注入字段（`toolAction` / `toolSummary`）与审查员回显的
**编排器自己会写进审查文档 front-matter 的键**（`topic`、`stage`、`role`、`run_id` 等，清单即 front-matter 键集减 `review.v1` 根属性；
拼错的键与 `reviewer` / `addresses` 不剥）；JSON 字符串里的非法转义（反斜杠后跟非转义字符）按字面还原——只在 `JSON.parse` 失败时才试。

**留痕面（只取加法；`review.v1` 的 schema 不放宽、枚举不改、不做语义映射）**：

| 落点 | 字段 / 文件 | 何时有 |
| :--- | :--- | :--- |
| `run.json.critics[c]` | `findings_degraded`：逐条降级的编号数组 | 解析成功（status `ok`）的侧恒写，`[]` = 没有 |
| `run.json.critics[c]` | `parse_repairs`：`{ stripped_fields, unescaped_backslashes }` | 解析成功的侧恒写（零值 = 没修）；agy 侧 `stripped_fields` 常态含厂商字段 |
| `run.json.critics[c]` | `parse_fallback_cause`：`no_json_object` / `json_syntax` / `root_invalid` / `finding_unaddressable` / `foreign_prefix` | status 为 `parse_fallback` 的侧恒写；`fail_reason` 同时以 `[成因]` 起头 |
| `_meta/review-<侧>-<run_id>.json` | 纯 `review.v1`，**只含合格意见** | 解析成功的侧 |
| `_meta/review-<侧>-<run_id>.degraded.json` | `{ critic, run_id, findings: [{ index, id, problems: [{ field, kind: missing｜invalid｜extra, message }], raw }] }`，原样保留审查员给的对象 | 有降级意见时；进 `run.json.artifacts[]` 保护集 |
| `_meta/review-<侧>-<run_id>.fallback-items.md` | 抬头多一行成因；对象拿得到（根不合、编号不可用、前缀不属本侧）时每条意见一个单元，否则按原文段落切 | 整份回退时 |
| 审查文档 front-matter | `findings_degraded`（编号数组，与 run.json 同型）、`parse_repairs`（与 run.json 同一份完整记录）、`parse_fallback_cause` | 条件出现：有降级、有**审查员造成的**修复（回显字段或非法转义；厂商字段的常态剥离只进 run.json）、整份回退 |
| `gate --check --json` | `degraded_ids` | 恒有（无则 `[]`） |

失败 / 超时侧与早于 v1.3.68 的留痕，run.json 三格都缺。`empty_review` 为「合格 0 条且降级 0 条」。
**降级留痕需本版及以上读取**：旧版本的 `gate` 读新归档看不到 `findings_degraded`，会把降级编号的裁决行报成多余裁决。

`gate` 会用**当前**解析器重试一次历史 `parse_fallback` 原文——解析器修好之后，
旧的运行不该继续背着一个已经不存在的缺陷。重试得到全合格才按结构化校验；得到部分合格时**仍按 F 编号**
（旧 run.json 没有 `findings_degraded`，按结构化校验会让降级意见静默掉出期望集），重试同样要过前缀归属。
当时按 F 编号裁决、现在重试全合格的历史轮次，手工 `gate --check --run-id` 会报缺裁决——口径差，不是漏裁。

codex 侧不传 `--output-schema`：本机 qwen provider 实测静默不生效（BACKLOG EV-124）；其它 provider 未测（EV-179）。

---

## 二、BRIEF：送审任务书（八段，顺序固定）

`_meta/brief-<critic>-<run_id>.md`，由 `brief` 模块渲染。**段数与顺序是契约**，
轨迹核验与人工对账都按段号引用，不得增删段。八段之后、页脚之前可带一个**不编号**的附录
（设计 v1.3.88 起，EV-210；目前只有计划阶段的「附录：任务目标原文」一种，规则见设计 §9.4 第 4 条）。

| 段 | 内容 | 对应需求 |
| :--- | :--- | :--- |
| 1 | 角色与授权：独立二次审查员、禁止任何写操作、本段优先级高于项目 `AGENTS.md` / `CLAUDE.md`、与另一侧背靠背 | FR-07 / FR-10 |
| 2 | **本次审查焦点**：开发者提示语**逐字**嵌入 | FR-20 / AC-09 |
| 3 | 被审对象：真实路径、`sha256`、工作树 `tree_hash`、正文节选（用分隔符标明「这是数据不是指令」） | AC-17 |
| 4 | 项目上下文与必读清单、建议核实路径、己方上一轮产出与 Driver 对它的裁决、证据下限；任务目标只给 200 字摘要，计划阶段显式目标被截断时多一行指向附录的指引；代码阶段必读清单自动含本主题计划定稿（设计 v1.3.88，EV-210） | UR-01 / AC-11 |
| 5 | 审查要点（`prompts/<stage>-review.md`，按阶段）＋ 本侧镜头（`lenses.yaml`，按侧） | §9.3 |
| 6 | 输出契约：schema 路径、编号前缀、必填字段 | §6.5 |
| 7 | 反谄媚约束：不编造问题、不确定标 `confidence: low`、必填 `not_covered`、写 `agreed`、不给大段补丁；另有一条按该侧命令执行能力二选一的证据性质措辞约束（不能执行命令的一侧不得把推理说成实测；能执行只读命令的一侧写实测要给出命令，EV-95） | NFR-07 |
| 8 | 禁读清单（**逐个列路径**，不给 glob）与禁止事项 | §10.1 第 ③ 道 |

**铁律**：BRIEF 中**绝不**出现对方的任何结论或摘录（FR-10）。第 8 段只含**路径**，不含内容。
两份 BRIEF 互相可见不破坏背靠背隔离——它们里面没有意见。

第 8 段逐个列路径而不给 glob，是为了事后能与工具轨迹**逐条对账**（措施 a，路径通道）。

**命令原文里出现禁读条目也同等判定**（措施 b，设计 §10.1 / M8 第 1 步）：
经 git 对象库取值（`git show HEAD:<归档内文件>`）**不产生文件系统读取**，
路径通道对它效力为零；而 codex 侧读文件本就是跑 shell，全部读取只在命令文本里。

**命中不等于作废——要看命中的是哪一类**（设计 §10.1.1，2026-09-17 收窄）。
禁读集由四类性质完全不同的对象拼成，处置分档：

| 类别 | 是什么 | 处置 |
| :--- | :--- | :--- |
| ① 对端审查产出 | 归档里他侧的审查件与 `_meta` 结构化意见 | **该侧作废** |
| ② 对端运行输出 | 运行目录里对端本轮的原始输出 | **该侧作废** |
| ②′ 己方运行材料 | 运行目录里本侧那一份，以及编排器的运行时文件 | **不算命中**（读它是编排器要求的动作） |
| ③ 编排器状态 | `.trivium/`（`config.yaml` 与 `bin/` 具名放行） | 记一笔，不影响结论 |
| ④ 凭据文件 | 命中 `sensitive_globs` 的文件 | 记一笔走安全告警线，不影响结论 |

只有前两类置 `guard.peer_artifact_read`。**分档作用在「命中的那条路径」上，不是在
禁读条目上**：运行根是一棵混合树，同一个条目下 ②′ 与 ② 并存，按条目分档等于
把整棵判成最重的那一类——那正是 2026-09-16／17 连续两轮代码双审判为阻断的形态。

两条通道逐侧记于 run.json（当前写形 `run.v3`，历史 `run.v2` 同构）的 `guard.peer_leak_via_path` / `guard.peer_leak_via_command`
（键缺 = 该侧没扫 ／ `hit:false` = 扫过没命中 ／ `hit:true` = 扫到了东西，**未必作废**——
作废与否看 `peer_artifact_read`）。两个字段的 `hits` 逐条带类，命令通道的 `hits`
还带命令原文与该命令碰到的那个路径。

**作废侧在同一次运行内重跑一次**（M12 批次 3，EV-225，设计 10.1.1）：一侧首次判出作废类命中，即在同一次运行内重拉一次、
二次命中判 `failed`（`fail_reason` 以 `peer_leak` 起头）。上面两个 `guard` 字段与 `peer_artifact_read` **只记最终尝试**，
闸门也只读它们；逐次明细在 run.json 的逐侧 `critics.<侧>.attempts`（只在重跑过的侧写，至少两条）：
每条 `n`、`started_at`、`duration_s`、`status`（适配器层 `ok` / `failed` / `timeout`）、`voided`（没判为 null）、
与上面同形的 `peer_leak_via_path` / `peer_leak_via_command`（判过才写）、`output_dir`（被挪到运行目录 `voided/<侧>/attempt-<n>/` 的首次输出）、`fail_reason`。
条目只记适配器层结果，因泄漏判该侧失败只在侧级。重跑时插在任务书最前面的点名段原文落 `_meta/brief-<侧>-<run>.rerun.md`。
`status.json` 的逐侧 `void_rerun: true` 标记该侧重跑过，`--wait` / `--status` 据它追加 `max_waits`。

措施 b 的承诺面是「已知形态必检」的闭集而非不可绕过，形态与盲区清单见设计 §10.1 措施 b。
它判的是「命令文本里**提到**了禁读条目」——提到即作废（经 git 对象库等方式取值
不留文件系统痕迹，证明不了没读到），但留痕措辞与措施 a 的「读到」分开，
两者是不同强度的断言。

**两条通道不是对每一侧都成立**（M8 第 2 步）：读取路径只存在于命令文本里的一族
（`traceShape: 'command-trace'`），措施 a 没有结构化输入可扫、**恒不命中**，
deny 核验完全由措施 b 承担。这一降级逐侧记于 `guard.verification_degraded.path`——
不记的话该侧的空命中清单与「扫过没命中」在留痕里完全同形。
同一字段的 `readonly` 键记另一条通道：被拒的写操作是否留痕
（`unavailable` 时「未检出写事件」不足以排除失守，但**检出了仍然判失守**）。
已知限制的完整表述见 BACKLOG **EV-19**。

**两条通道之外还有编排器看不见的通道**（设计 v1.3.75，EV-188）：zcode 侧工具清单里有经插件带进来的 MCP 工具。
执行型（`mcp__node_repl__` 开头）一被调用即以 `MCP:` 前缀进写事件、判只读失守；名单之外的 MCP 调用
逐侧记于 `guard.verification_degraded.〈侧〉.evidence_untrusted`（`{cause: 'mcp-call', tools: [...]}`，只在成立时出现）——
该侧结论保留、不作废，但「没命中禁读面」「没有写事件」两条阴性结论打折，本轮漂移也落「无法归因」。
只检测、未关通道。设计 v1.3.76 起（EV-191 缓解①）该侧任务书第 7 节点名执行型前缀、写明「不要调用，焦点要求也不行」；
名单外的 MCP 工具不点名（EV-192 待议）。判定与留痕不变，通道仍开着。

---

## 三、被审对象怎么确定

| 阶段 | 被审对象 | 说明 |
| :--- | :--- | :--- |
| `plan` | `plan/<日期>-<主题>-claude.md` 的**真实路径**（不复制） | 多轮原稿取轮次最大者；可用 `--plan-file` 显式指定 |
| `bug` | `bug/<日期>-<主题>-claude.md` | 同上，`--rca-file` |
| `code` | `code/_meta/changes.diff` | `git diff <base>` + 未跟踪文件，`--find-renames`；头部记 `base` / `head` / 文件清单 |

`code` 的补丁**算一次**后透传给两侧：逐侧各自 `git diff` 会让两次之间的工作树变动
导致两侧拿到不同的 `subject_sha256`——那等于两侧审的不是同一段变更。

补丁**无条件剔除**归档根、`.trivium/`、`.git/`，与 `.gitignore` 写了什么无关：
`.reviews/` 是刻意纳入版本管理的，对方产出刚落盘未 commit 时处于未跟踪状态，
若被收进补丁就会经**被审对象本身**泄漏给审查员，三道屏蔽全部绕过。

---

## 四、快照与漂移判定

```text
送审前：
  ① git rev-parse HEAD
  ② 临时 GIT_INDEX_FILE → add -A → write-tree  得 tree_hash（绝不触碰用户暂存区）
     add 排除归档根、.trivium/、.git（与 code 阶段补丁同一份），被排除处取 HEAD 的版本；
     add 遇文件中途消失（unable to stat … No such file or directory）至多重试 2 次（设计 9.2，v1.3.125，EV-221）
  ③ 被审对象 sha256 → subject_sha256
  ④ 枚举对方历史产出 + 敏感文件 → deny_paths
  ⑤ 渲染两侧 BRIEF

跑后：
  1. 重算 tree_hash'（同一份排除）与 subject_sha256'
  2. subject_sha256' ≠ subject_sha256 → FAIL(subject_drift)，整次运行作废
  3. tree_hash' ≠ tree_hash：
     a′. 比不了（tree 值不合对象名形状 / diff-tree 失败：送审快照的 tree 已被清理、git 出错、超时）
         → unknown，按 review.on_drift_related（默认 fail）处置，
           run.json 记 snapshot.drift.unknown_reason（设计 9.2 / 6.7.1，v1.3.70，EV-139）
     a. diff-tree 列出变更文件 F，剔除 probe.*.scratch_paths 白名单与归档根
     b. F 为空 → 无漂移（只有 Agent 临时文件）
     c. F 与 --context / diff 涉及文件相交 → review.on_drift_related（默认 fail）
     d. 其它 → review.on_drift（默认 warn），run.json 记 drift 并显著提示
  4. tree_hash' 落盘为 snapshot.after_tree_hash（与 drift 同一次收尾写入）——
     只供审批时的工作树改动摘要作基线，不参与任何判定（设计 8.5 / 6.7.1，EV-132 候选 ② 折中版）
```

漂移判定**必须**剔除归档根：编排器自己写 `_meta/` 与 `task.json` 也会改变工作树，
不剔除的话每次运行都会把自己的写入报成漂移。

---

## 五、退出码契约（§7.3）

| 码 | 含义 | 调用方该怎么办 |
| :--- | :--- | :--- |
| `0` | 成功 | 继续 |
| `1` | 一般失败 | 读 stderr |
| `2` | **闸门阻断** | 按 stdout 的缺口清单修补后重试。**审批正本 `task.json` 读不出**（读不了、不是合法 JSON，或形状不对：不是对象、`schema` 不是 `trivium.task.v1`、`runs` / `approvals` / `degradations` / `disputes` 任一不是数组）时，凡要写正本或要据它判「本轮是否已表态」的命令一律退 2、不写正本：`gate --check`（`failures` 带 `task_unreadable`，不落共同阻断三态、不推进闸门）、`gate --await-approval`（`ok: false`、`state: unchanged`）、`approve` / `abandon`（闸门不动）、`topic claim`、`verify`（开跑前判出时一条命令都不跑；已跑完才在登记时被拒时验证记录保留、文案写明命令结论）、`review --start` / 同步 `review`（零工件）。这不是裁决缺口：输出点名正本路径、给出 Git 找回的出口（`gate --check` 在 stdout 的 `failures`，`--await-approval --json` 在 stdout 的 `message`，其余命令在 stderr），恢复由用户在终端做，恢复后重跑（设计 v1.3.171，EV-248） |
| `64` | 参数错误 | 修参数；不会产生任何工件 |
| `65` | 前置产物缺失 | 先补工件 |
| `69` | 环境或预检失败 | 跑 `doctor` / `preflight`；`review --cancel` 取不到工作进程的启动时刻时也退 69（设计 v1.3.66，EV-175）——什么都没改，稍后重试，持续取不到时按 stderr 的手工出路；发过信号而未确认工作进程退出（宽限期满或 SIGKILL 之后仍取不到启动时刻，或 SIGKILL 之后等 5 s 仍是同一进程）时同样退 69、不收尾（status、锁、闸门、归档、凭据副本都不动，只按记录结束了审查员 CLI；设计 v1.3.67，EV-176） |
| `70` | 主题被锁 | 同主题已有运行在跑，看 `--status` |
| `73` | **运行仍在进行**（不是失败） | 继续下一次 `--wait` |
| `75` | 严格模式中止 | 一侧失败且 `failure_policy: strict` |
| `76` | doctor 没探完 | 只有 `doctor --deadline-s`：到点或收到 SIGINT / SIGTERM 时还有段没探完；已探完的照常落盘，`--json` 的 `deadline.sections` 点名并给终端重跑命令（设计 v1.3.173，EV-251） |

`2` 与 `73` 是最容易被误处理的两个：`2` 不是崩溃而是**有话要说**，
stdout 里就是待修补的清单；`73` 不是超时而是**还没跑完**。

`scrub` **不按上表分档，恒返回 `0`**——这是刻意的契约，不是漏写。它的职责是「把能抹的抹掉」，
而抹不动的两类（状态读不到、扫不完）都要人工看一眼；用非零码把它们说成失败，会让这条
本该随手可跑的运维命令在任何 `set -e` 的脚本里变成阻断。真出错（抹除失败）进人读输出与
`--json` 的 `ok: false` / `scrub_failed`——**调用方判成败读那里，不读它的退出码**。

Hook 另有三档语义：`0` 放行或判定不了 ｜ `2` 明确判定拦截 ｜ `1` 程序缺陷（非阻断）。
检测不到 `.trivium/config.yaml` 一律 `0`——全局安装绝不误伤其它仓库。

---

## 六、分段长调用协议（`--start` / `--wait`）

一次双审墙钟可达 30～40 分钟，而 Claude Code 的 Bash 工具默认 120s、上限 600s。
所以不能同步等：

```text
trivium review --start --stage <s> --topic <t> --focus <hint> --json
  → { run_id, max_waits, wait_timeout_s, bash_timeout_ms, worker_pid, run_dir }
    先占主题锁 → prepareRun（冻结、渲染 BRIEF、置闸门 running——被拦即退 2 且不落盘、写 run.json 骨架）
    → spawnDetached 工作进程 → 把锁改记 worker 的 pid → 立即返回
    （写完骨架之后、子进程诞生之前失败：回收闸门后把骨架收尾为 failed，termination.by = prepare_exception，设计 v1.3.50）
    （子进程诞生之后失败：先按进程组终止工作进程并以子进程句柄确认退出，再回收闸门、收尾为 failed，
      termination.by = post_spawn_exception、status.json 已终态不动、放锁；确认不了退出则一概不回收，设计 v1.3.51）

循环（上限取最近一次 --wait 返回的 max_waits——--start 给的是初值，某侧作废重跑时追加一个单侧超时的份额；
      每次的 Bash 工具超时必须设为 bash_timeout_ms）：
  trivium review --wait <run_id> --timeout <wait_timeout_s>
    → 73 表示仍在跑，打印进度后继续；0/非 73 表示终态
```

约束：

- 工作进程每 30s 写一次心跳到 `status.json`；`--wait` 在进程不在或已不是同一进程（`pid_gone`）、
  进程活着但心跳超过 `heartbeat_stale_s`（默认 120s）未更新（`heartbeat_stale`）、status.json 与 pid 都拿不到（`no_status_file`）
  三种情形下判 `failed(worker_lost)`；工作进程确认已退出时先把归档 run.json 收尾为 `failed`（设计 v1.3.48，EV-142）。
  `heartbeat_stale_s` 不大于心跳间隔（30 s）时健康的工作进程也会被判失联：`--wait` 的报错当场点明，预检与 `--start` 事前出只警告项「失联阈值」，两处共用 `status.ts` 的 `staleThresholdWithinHeartbeat`（设计 v1.3.57，EV-160）。
  同一阈值也是 `state.json` / `task.json` 短临界区锁（`kind: 'critical'`）的持有超时，但锁这一面取 `max(heartbeat_stale_s, 30 s)`（`lock.ts` `criticalHoldTimeoutMs`，下限即心跳间隔；设计 v1.3.62，EV-161）：阈值不小于 30 s 时两者相同，更小时只有失联判定用原阈值；锁文件格式与退出码 `70` 不变。
- 进程存活性比对 `ps -p <pid> -o lstart=`，**不能只看 `kill(pid,0)`**：macOS 会复用 PID。`lstart` 随 TZ 与区域设置变化：status.json 的 `worker_started_at_canonical` 与锁文件的 `pid_started_at_canonical`（EV-158，设计 v1.3.55）记以 `LC_ALL=C`、`TZ=UTC0` 取的规范化启动时刻，有它时身份只按它比（读者也按规范化环境取），缺席（旧版写的）才退回按读者缺省环境比 `worker_started_at` / `pid_started_at`。规范化形态是盘上契约：变更须换新字段名，禁止就地改。
- stdio 必须重定向到日志文件。继承父进程管道会让 worker 在父退出后死于 SIGPIPE；
  管道 EOF 不闭合则派生方会挂到 worker 退出。
- `finished_inline: true` 表示同步窗口内已收口（目前唯一来源是 FR-23 纯文档跳过），
  调用方**不该**再进 `--wait` 循环。

工作进程生命周期等于一次运行，不监听、不接受新任务——不是常驻 Daemon。

---

## 七、Hook 契约（§8.5）

**五个** Hook 注册在 `.claude/settings.json`（随仓库分发）——`PreToolUse` 下三条
（`Edit|Write|NotebookEdit` 一条、`Bash` 两条），加 `Stop` 与 `SessionStart` 各一条。

每条命令外层都包一层存在性守卫，且**区分两种情形**：

```sh
sh -c 'D="${CLAUDE_PROJECT_DIR}/.trivium"; W="$D/bin/trivium";
       test -x "$W" && exec "$W" gate hook-<名>;      # 正常路径
       test -f "$D/config.yaml" || exit 0;            # 项目从未初始化 → 静默放行
       echo "护栏失效…" >&2; exit 2'                   # 已初始化但 wrapper 没了 → 保守拦截
```

wrapper 是 `trivium init` 在本机生成的产物、**不随 Git 分发**，所以「协作者克隆仓库后还没跑过
init」是必然常态，那种情况必须静默 exit 0。但守卫**不能一律 exit 0**：那样一条 `rm -rf` 或
`chmod -x` 打在 wrapper 上，就能把四个拦截型 Hook 一次性变成永真放行，而且悄无声息。
`SessionStart` 不是拦截型 Hook（只注入待办清单），仍一律 exit 0。

| Hook | 事件 | 拦什么 |
| :--- | :--- | :--- |
| `hook-pre-write` | `PreToolUse` / `Edit\|Write\|NotebookEdit` | ①主脑在归档内写审核者后缀的文件（全部已登记角色减当轮 Driver，claude 为 Driver 时即另三家；AC-07，与闸门状态无关）②编排器独占对象（运行时状态与锁、归档内 `_meta/` 与 `task.json`）③闸门期改业务文件（归档内不拦） |
| `hook-pre-bash` | `PreToolUse` / `Bash`（无 `if` 过滤） | `hook-pre-write` 只覆盖 Edit / Write，`cat > f`、`sed -i`、`tee`、`git checkout` 是旁路。按写命令形态做**启发式**拦截：命中编排器独占对象 → **任何时候**都拦；其余写命令 → 仅闸门期拦。判定在**未剥 heredoc 的原文**上进行 |
| `hook-pre-commit` | `PreToolUse` / `Bash`（无 `if` 过滤） | 裁决未齐备时禁止提交（AC-12），并校验留痕完整性 |
| `hook-stop` | `Stop` | 裁决未齐备时禁止收工（AC-02），输出 `{"decision":"block","reason":…}` |
| `hook-session-start` | `SessionStart` | 发现 `running` 的运行时以 `additionalContext` 提醒先 `--wait`；顺带回收死掉的 `running` 闸门 |

**判定读的是 `.trivium/state.json`**（`listOpenGates`），不是 `run.json`。
`review` 必须把闸门状态同步进 state.json，否则这四个拦截型 Hook 全都无事可判、一律退 0——
那是整条流水线最核心的护栏。

`gate --check` 通过后**按 `run.json` 的 `entry` 分流**：entry = B/C/D 直接立起
`awaiting_approval`（这三条命令的停点就是人工审批）；entry = A 或无 entry 才回 `idle`
（命令 A 不设人工闸门）。这两种去向都必须发生——若 B/C/D 也放回 idle，停点就被丢掉；
若 A 也停在 awaiting_approval，补齐裁决的人反被拦住，唯一出路是关掉 Hook。

**还有第三种去向：什么都不做（2026-09-16 起）。** 本轮若已有人工审批记录
（归档 `task.json.approvals[]` 里有该 run_id 的 approved / rejected / abandoned），
`gate --check` **不推进任何状态**，只输出校验结论。理由是它是**校验**命令，
没有资格撤销人的审批——而此前它无条件推进，于是「审批后按裁决补修复 →
改动涉及裁决件 → 顺手复校一次完整性」这条常见路径会把已放行的闸门重新关上，
撞上之后连提交都做不了。同样的前置判断也挂在 `--await-approval` 上（那是第二个入口）。

判据以归档里的审批记录为**正本**，读不出来时 fail-closed（视为已表态、不推进）：
把「锚被搅坏」当成「没有审批记录」，就是同一个缺陷换个触发条件重现。

`hook-pre-commit` 曾依赖 `if: Bash(git commit:*)` 做第一道过滤，但那是**前缀**匹配：
`sh -c 'git commit -m x'` 不以 `git commit` 开头，Hook 根本不触发。现已删去 `if`，改为挂
全部 Bash 事件、在进程内自行解析 git 子命令：跳过全局选项后取第一个非选项词（用
`/git.*commit/` 这类正则会把 `git log --format=commit` 误判成提交），并额外判定这次提交
**打在哪个仓库上**——前缀规则表达不了这件事。它也**不按会话过滤**：裁决完整性是仓库的
属性，不是会话的属性。

---

## 八、`~/.trivium/runs/`：项目外的运行目录

两侧原始 stdout、工具轨迹副本、临时配置副本一律落在**项目根之外**：

```
~/.trivium/runs/<repo_id>/<run_id>/<critic>/{out,trace}/
```

这是隔离机制的一部分：审查进行中，对方**本次**结论在项目树内物理不存在
（§10.1 第 ② 道「延迟落盘」）。原始日志可能含仓库片段，默认保留 30 天。

`<repo_id>` = `<目录名>-<项目根路径 sha256 前 8 位>`，避免不同项目互相覆盖。

---

## 九、CLI 接口一览

真实接入补测的外部证据（2026-10-10，不改变run/review Schema）：请求、配置声明、CLI有效回读、服务端身份必须分列，后两者缺证据为null。独立脚本记录每臂入口/CLI版本/包装器/canonical与薄入口hash、完整导入模块及配置指纹；相对写目标按实际cwd解析，原始调用ID、对应注册层或沙箱层拒绝、文件前后状态均须可审计。只看到文件未生成或本地受控返回不能改判真实模型写负对照。禁读臂复用生产枚举，逐文件结果与完整Schema交付分别核对；超时不通过。历史原件不追改，重算另存派生证据及来源hash。详见[收口报告](../05_testing/REPORT_2026-10-10_agent_access_closeout.md)。

| 命令 | 作用 |
| :--- | :--- |
| `doctor` | 逐项实测设计 §3.5 的本机能力探针清单，回填 `probe:` 段。`--deadline-s <秒>`（30～900，EV-251）：到点或收到 SIGINT / SIGTERM 时按组结束段内派生的子进程、删掉探针临时目录，没探完的段作废不落盘，`--json` 多一个 `deadline` 键（`limit_s` / `hit` / `reason` / `stuck` / `sections[]` / `residue[]`），到点退 76 |
| `preflight --json` 的自动校准字段 | 失败项带 `recalibrate`（`{ fixable, targets? }`，缺省即不能修）；失败时顶层恒带 `recalibration`（`{ eligible, why, invocations[] }`，每条 `{ only, args, deadline_s, bash_timeout_ms }`）。skill 只照抄 `args`、按 `bash_timeout_ms`（时限加 60 s，缺省 960 000）设工具超时，至多一轮（EV-251）。`eligible` 时另有 `announce_before`（调用前原样念的播报句，键序在 `invocations` 之前）与 `announce_after_pass`（常量「预检首次退 69，已自动校准后通过。」）（EV-252）。加法，旧调用方忽略 |
| `doctor --selftest` | 临时夹具里真跑整条流水线，14 步核对（桩适配器，零配额） |
| `preflight --stage plan\|code\|bug\|all [--critics <id,…>] [--profile <名称>] [--model-<id> <模型>] [--tier-<id> <档>] [--effort-<id> <值>] [--profile-<id> <名>]` | 设计 §8.1 的启动预检，fail-fast，失败零工件。档位旗标（M11 第 5 步）按「档位组合合法」一格校验，口径同配置来源，见上方现状句。`--critics` 指定本次要用哪几侧——只读能力、模型 slug、探活都只查这几侧，缺省取 `review.default_critics`（M8 第 3 步）。**命令 B / C / D 的第 1 步不传它**：那时 `topic resolve` 还没跑、选侧尚未解析出来；选了非缺省侧时，该侧的可用性由 `review --start` 在拉起 CLI 之前的 `availability()` 兜住（AC-20 末条的落点），但探活不在其中。**命令 A 自 EV-125 起在解析之后预检**（S0.6）：带上 `topic resolve` 输出的 `critics`，以及非空时的 `--profile` / `--model-<id>`，三个阶段入选各侧的 slug 与探活都在开跑前查——命令 A 漏查的 code 阶段 slug 要到 S6（编码之后）才会暴露。`--critics` 也供用户显式预检时用。**只警告项**（EV-123，设计 8.1「警告这一级」）：`--json` 输出恒带 `warnings`（`{ name, detail }[]`，无警告时为 `[]`），`checks[]` 单项在 `warn` 为真时带 `warn: true`；`warn` 不影响 `ok` 与退出码，skill 在通过时逐条念给用户后继续 |
| `topic resolve --stage <s> -- '<正文>' [--topic <主题>] [其余旗标]` | 解析主题/提示语/被审对象/模型覆盖，**纯只读**。M11 第 5 步起输出另含 `tiers` / `efforts` / `vendor_profiles`（逐入选侧、恒存在、没写为 `{}`），skill 照抄进预检与 `--start`；档位旗标写了不给值退 64，`--model-<id>` 自 v1.3.165（M12 批次 4，EV-228）起同样退 64、文案同一份（此前 `=` 空、紧跟已知旗标、位于末尾三种形态被静默丢弃）。`--stage` 也接受 `all`（命令 A 用）。`--` 之后按 argv 逐个 token 解析、不再分词（EV-18）：正文整段放进一个单引号参数，旗标放在引号之外；`--topic` 字样被包进正文而未显式给主题时退 64。`--args` 传法已删 |
| `topic claim --topic <主题> --stage <s> --driver <id> [--session-id <id>]` | 为该**阶段**声明当轮 Driver（M10a 第 1 步，EV-72）。plan / bug 原稿写在 `review --start` 之前，那一刻该阶段零留痕、判定回落缺省 Driver，非缺省 Driver 写不出自己的原稿。`--stage` **必填不默认**：声明直接决定 Write / Edit 侧的保护集。判定顺序自上而下：**留痕优先**——该阶段已有运行留痕且与 `--driver` 不同 ⇒ 退 64（出口是新开主题或换阶段）；已声明同值 ⇒ 幂等退 0 且**不刷新** `claimed_at`；该阶段子树里已存在**他家角色后缀**的文件 ⇒ 退 64（那些文件可能是撤回前的旧声明留下的，也可能是尚无声明时写下、仍在使用的原稿；出口是由用户确认去留、在终端处理后重试。不在会话里删它们来换回认领——这条限制防的正是会话自己反复翻转声明，见设计 7.1 `topic claim` 段）；其余合法认领放行。撤回的旧声明整条追加进 `drivers[<阶段>].history`，不覆盖。`--session-id` 落进 `claimed_by`，与 `approvals[].session_id` 同一个用途：自声明边界要让事后对得上账。审批正本读不出时退 2、不写（EV-248，见 §五） |
| `review --stage <s> [--critics <id,…>] [--profile <名称>] [--model-<id> <模型>] [--tier-<id> <档>] [--effort-<id> <值>] [--profile-<id> <名>]` | 同步跑一次双审（手工调试用）。模型与档位旗标口径同 `preflight` 那一行：键必须是本轮入选审核者，`--tier-<id>` 只收 `low` / `medium` / `high`，`--profile-<id>` 目前支持 `--profile-codex` 与 `--profile-claude`；同侧可用 `--native-<id>` 显式清空；模型与三类旗标写了不给值（`--model-<id>=` 一格 v1.3.165 起，此前静默丢弃）、档名未在 `agents.<id>.tiers` 定义、思考等级不在该模型原生枚举里、该侧没有思考等级概念却给了、厂商 profile 不在本机名单，都在准备阶段（冻结与任何落盘之前）退 64。预检与准备阶段均先校参数：明确不存在的 profile 退 64；凭据、入口、服务或只读能力不可用退 69（EV-232）路由两段式与 `tier` / `tier_source` 的取值见设计 11.5 |
| `review --start / --wait / --status / --cancel` | 分段协议。`--start` 收的模型与档位旗标同 `review --stage`。`--start` 的返回恒带 `warnings`（EV-123）：拉起前按**当轮入选侧**复用预检的判定函数 `checkModelOverrideSource` 查出的只警告项，以及 `checkHeartbeatThreshold` 的「失联阈值」（`heartbeat_stale_s` 不大于工作进程心跳间隔 30 s 时出；只读配置、与入选侧无关；设计 v1.3.57，EV-160），两者同一次汇总，形状同预检；其后追加准备阶段从各侧任务书第 4 段剔除的自动条目「必读清单剔除」（按条目一条；设计 v1.3.73，EV-02，见设计 10.1.1 末节），代码阶段计划阶段留痕读不出、没能列入计划定稿时在它之前另有一条「必读清单未列计划定稿」（至多一条、不计入剔除封顶；设计 v1.3.88，EV-210）；在派生之后随返回值到达（拦不住拉起，skill 在开场播报里念出并提示可 `--cancel`）；`finished_inline` 时为 `[]`；同步 `review --stage` 不做前两项复查，它的 `--json` 另有既有的 `warnings: string[]`（运行期告警，以及准备阶段的必读剔除告警，后者不带 `⚠️` 前缀），与 `--start` **同键不同形**，不要按 `detail` 读。`--start` 与同步 `review --stage` 在 `--context` 与本轮任一侧禁读集相交时退 64、零工件（设计 v1.3.73）。`--cancel`：向工作进程组发 SIGTERM，工作进程先按组终止它以 `killTree` 拉起的审查员 CLI（宽限 2 s → SIGKILL，真实 CLI 对 SIGTERM 的处置未实测）再以 SIGTERM 退出；5 s 内没退出即升级 SIGKILL、之后至多再等 5 s 确认退出（设计 v1.3.67 起；此前不等）——宽限期满最后一次仍取不到工作进程的启动时刻时不升级 SIGKILL，发 SIGTERM 之前就取不到则一个信号都不发，工作进程未确认退出时不收尾、以 69 退出（EV-176）；升级 SIGKILL 或宽限期满判不了而扣下 SIGKILL 时、以及工作进程此前已不在时（含 status 已被 `--wait` 判失联写成 failed、走终态早退分支的情形），按 status.json 的逐侧 CLI 进程组记录逐组结束审查员 CLI（组长活着且规范化启动时刻相符、或组长已退出但组号下还有非僵尸成员时都发信号，宽限链同上，v1.3.60 起后者同样按组结束，EV-165；终态分支只结束进程、不写 status.json（`gone` 格自 EV-159 起补收归档 run.json / task.json，见下方「失联后仍挂着的工作进程」段末句，status.json 仍不写）；判不了、记录读不懂、成员计数取不到、没有记录时 stderr 如实提示；设计 v1.3.53，EV-154）；CLI 先于工作进程退出后遗留的子进程、CLI 自己脱离进程组的后代也够不到，这两格不打提示（设计 7.5「工作进程的信号语义」）。`--wait --json` 的 `sides` 与 `--status --json` 的 `status.sides` 每侧多一个 `cli` 键（`{ pgid, started_at }` 或 null，设计 v1.3.53；加法，旧调用方忽略）；status 另多一个 `worker_started_at_canonical` 键（字符串或 null，设计 v1.3.55，EV-158；加法，旧调用方忽略）。（EV-128，设计 v1.3.47）工作进程确认退出后，把仍为 `running` 的归档 run.json（run.v2 或 run.v3，保持原 schema）收尾为 `cancelled`（只改 `status` / `finished_at` / `gate.state`，`artifacts[]` 原样）并同步 `task.json` 登记（run.json 不是 cancelled、登记里找不到、登记已不是 running 时跳过），再把 status.json 标 `cancelled`、回收锁与闸门；没确认退出或 run.json 已是终态时不写，输出写明原因；单步写失败只告警、没有第二次机会，告警要求人工核对。**失联后仍挂着的工作进程**（设计 v1.3.54，EV-146）：`--wait` 判 `worker_lost` 时在 status.json 记 `lost = { reason, at }`（`--wait --json` / `--status --json` 的 `status` 因此多出 `lost` 键，对外 JSON 形状的加法，旧调用方忽略）；`heartbeat_stale` 的报错先列判定依据再给 `--cancel` 出口。之后 `--cancel` 在 status.json 为 failed、`lost.reason` 为 `heartbeat_stale`、工作进程仍是同一进程时，按组结束它（宽限 5 s → SIGKILL → 至多再等 5 s 确认）、按记录结束审查员 CLI、把仍为 `running` 的 run.json 与登记补收为 `failed`（`termination` 同 `--wait`）、按 run_id + pid 回收锁；status.json 不写、闸门不动、凭据副本不抹；确认不了退出时 run.json 与锁不动；身份判不上（`mismatch`）时连记录里的审查员 CLI 也不结束，身份缺失（`no_identity`）时 CLI 沿用 EV-154 终态分支自己的判断；两格 stdout 都说「未对工作进程……发信号」而不是「无需取消」；一个信号都没发就判已不在时说「未及发信号」。确认退出（含下面的 `gone` 格）与「无需取消」退 0；以 69 退出的有两种：按组结束之后未能确认工作进程退出（仍是同一进程、判不了身份、首检即判不了），与主路径同口径（设计 v1.3.105，EV-177 ②），以及身份判不上（`mismatch`）、身份缺失（`no_identity`）两格（设计 v1.3.115，EV-177 ② 补）——都是「这次没做收尾、状态原样、可重试」；此前都退 0，stderr 与 stdout 的文字不变。**`gone` 格补收**（设计 v1.3.56，EV-159 第一形态）：`worker_pid` 上已没有活进程时（含「两种启动时刻都缺失」这一收窄进来的子情形），`--cancel` 与 `alive` 格一样按 EV-142 的前提把仍为 `running` 的 run.json 与登记补收为 `failed`（`termination` 同 `worker_lost` / `heartbeat_stale`）、按 run_id + pid 回收锁；status.json 不写、闸门不动、凭据不抹；stdout 说「工作进程 N 已不在」，不说「无需取消」，也不复述归档补收的结果（只说「见上方输出」，那两行由前面的收尾步骤播报）；已是终态或归档缺失时按前提跳过、如实说明，可重入。`mismatch` 与「两种启动时刻都缺失但进程还在」的 `no_identity` 不在此列，一律不补收。**判不了工作进程的身份**（设计 v1.3.66，EV-175）：主路径上工作进程活着而本进程取不到它的启动时刻（`ps` 派生失败或超时）时，`--cancel` 不发信号、不写 status.json、不回收锁与闸门、不抹凭据、不补收归档，stderr 报「取不到工作进程 N 的启动时刻……本次不取消……请稍后重试」并给出手工出路，**退出码 69**；同一原因下 `--wait` 不判 `pid_gone`（心跳新鲜仍退 73，过期判 `heartbeat_stale`），抹凭据准入与会话启动清扫把它当仍在。**凭据副本的准入**（设计 v1.3.58，EV-157）：`--cancel` 主路径与 `--wait` 判失联抹凭据副本之前，与会话启动清扫 / `scrub` 同一判据——工作进程确认已不在，且 status.json 记录里的审查员 CLI 进程组没有仍在、判不了或读不懂的（`--cancel` 判的是按记录结束之后的事实）；被 CLI 挡住时不抹，`--cancel` 的 stderr、`--wait` 的报错正文各多一行「凭据副本未抹：工作进程 N 已不存在，但审查员 CLI 未确认结束——〈逐侧〉…留给会话启动清扫」，退出码、归档收尾与其余输出不变；工作进程一半未过时那一行的文字与此前相同。`--wait` 在阻挡项里有判「仍在」或「组长已退出、组员仍在」（`orphaned`，v1.3.60 起，EV-165）的组时再多一行 `--cancel` 出口（`--cancel` 的终态分支会按记录结束它们；判不了 / 读不懂时不给，代码双审 r1 CODEX-02） |
| `review --worker <run_id>` | 工作进程入口，由 `--start` 派生。**不应由人直接调用** |
| `gate --check` / `--check-artifacts` / `--await-approval` | 裁决完整性 / 最低工件集 / 置人工闸门。立停点时（`--await-approval`，以及命令 B / C / D 的 `--check` 通过后自动立）追加打印工作树改动摘要，`--await-approval --json` 带 `worktree_summary` 键；只告知，不参与判定、不改退出码。审批正本读不出时 `--check` 与 `--await-approval` 都退 2、不写不推进（EV-248，见 §五） |
| `gate hook-*` | Hook 入口，从 stdin 读事件。**不应由人直接调用** |
| `approve` / `abandon` | 人工审批 / 放弃闸门。审批附言走 `--reason`；多余的位置参数退 64（EV-24），布尔旗标（`--reject` 等）不吞下一个 token、`=` 传值只认 true/false。**通过前复核**（M10a 第 3 步）：与 `gate --await-approval` 共用一份判定——本轮裁决齐备 + 本轮 `run.json.artifacts[]` 的 sha256 抽核；不通过退 2，推断不出 run_id 或运行元数据读不出退 65（缺 run_id：abandon 后重跑；读不出：先按成因恢复、恢复后直接重新 approve，恢复不了才 abandon，abandon 之后能否重跑取决于该阶段最新一份留痕可不可读——三档成因见设计 8.4「留痕读不出：成因与出口」）。拒绝与放弃不复核。复核不保证「审批来自人」。**通过时先打印工作树改动摘要**（复核之后、落审批之前）：自审查收尾以来改过的文件，基线 `snapshot.after_tree_hash`；`--json` 带 `worktree_summary`（按阶段，每阶段 `available` / `reason` / `run_id` / `baseline_tree` / `current_tree` / `total` / `truncated` / `files`（最多 200 条）/ `excluded_prefixes` / `budget_ms` / `budget_overridden`）。只告知，不参与判定、不改退出码；取不到时报原因，不报「无改动」。审批正本读不出时三种决定都退 2、闸门不动（判在复核之前；闸门已写下决定之后正本才坏的竞态由比较-交换回退闸门，EV-248，见 §五） |
| `verify --topic <t>` | 执行显式配置的编译测试命令并落盘记录。审批正本读不出时退 2（EV-248，见 §五） |
| `report --topic <t>` | 主题级复盘；没产出审查文档的运行另列「未进时间线的运行」，`--json` 输出多一个 `unlistedRuns` 字段（设计 v1.3.48，EV-144）。第二节末尾按 Driver 与按审核者两维聚合、第四节加思考等级请求 / 生效两列（设计 13.2.1，v1.3.135）；`--json` 只增不改：顶层 `aggregates`（`byDriver` / `unknownDriver` / `byCritic`），`rounds[]` 增 `driverSource` / `driverUnknownReason` / `dispositionUnreadable` / `disposalsBySource` / `fallbackDisposalsBySource`，`aggregates.byDriver[]` 含 `dispositionUnreadableRounds`，`rounds[].sides[]` 增 `severity` 与 `effortRequested` / `effortEffective` / `effortEffectiveSource` / `effortLegacy`（**缺席时不写键**、null 写 null），`unlistedRuns[]` 增 `driver` / `sideStatuses` |
| `status` | 闸门、运行、降级与争议 |
| `scrub [--dry-run] [--json]` | 对**整个运行根**做一次凭据清扫：遍历全部项目桶，**只抹凭据、一个目录都不删**（整删是 `run_dir_days` 的职责且按项目划界，跨仓删别人的目录是越权）。准入判据与会话启动清扫同源（`admitScrub`）：worker 现势活着的不动，状态读不到一律跳过并计数；worker 已不在而 status.json 记录里的审查员 CLI 进程组仍活着、判不了或记录读不懂的也不动，计入 `deferred` 并在 `--json` 的 `deferred_cli`（`{ dir, detail }[]`）里逐条带成因（设计 v1.3.53，EV-38）。人读输出在这一格之后的提示只给一个出口：「记录读不懂」需把该侧 `cli` 改回 null（到期整删也会保留它）；帮助动机句带同样的限定（设计 v1.3.59，EV-164），且自设计 v1.3.61 起写明到期整删只在该仓库自己的会话启动时跑、不再回到那个仓库就没有任何自动清理（EV-166；此前「副本会一直躺到 retention.run_dir_days 整删」失实）；`--json` 不变。**退出码恒 `0`**，理由见 §五末段。`--dry-run` 只预测**侧层**——运行目录那一层没有哨兵、每轮都复查，有没有活取决于正文是否命中密钥，不读正文答不了（BACKLOG EV-33） |
| `init` | 在项目内布置运行时（幂等）。M10b 第 3 步起两家 Hook 一起合并：`.claude/settings.json` 与 `.zcode/config.json`（ZCode 形态），只增不删、写盘前备份只在真正写入时发生 |
| `hooks --agent <id> [--dry-run]` | 单独为一家渲染并合并 Hook 配置（M10b 第 3 步）：落点与形态取注册表 `hookConfigTarget`——claude 写 `.claude/settings.json`，glm 写 `.zcode/config.json`；codex / gemini 没有 Hook 机制，退 64 且零写入。`--dry-run` 零落盘。当轮 Driver 的判定**不读** `--agent`（设计 8.4 注记），它只选渲染目标 |

参数细节见 `trivium --help`，它与实现同源、不会脱节。

2026-10-10本仓配置实例：Codex接入的profile显式null选择官方native，default/flash/pro各自阶段模型分别为gpt-6.1-sol、gpt-6-luna、gpt-6-astra；CLI请求、官方配置声明和运行回读继续分别记录，不把配置默认值当回读证据。第三方profile可显式覆盖，协议和历史Schema不变。

本轮code整改的取证契约（原标准不变）：探针和汇总须共同使用显式批次selection manifest，固定variant及requested/result/fingerprints-after的hash；缺结果、未完成或指纹不符不得回退旧成功。版本证据亦显式引用并核对入口/包装器/配置/模块指纹。Codex实际读取须有CommandExecution.cwd、parsed_cmd精确README目标及唯一命令/完整输出/exit/status配对，不认单独echo；两种ID分列。CLI effort带来源记录，服务端null，不添加默认值。受控对照从同一manifest取当期真实臂并核对实际权限模式与工具面，缺值不判同形。独立清理与落盘失败仍执行其余清理；历史入口缺新版上下文明确报错，不重解释原件。

目录规则增量：Claude厂商专属probe新增可缺`directory_deny_verified`逐工具三态、`directory_deny_probed_at`及`directory_deny_fingerprint`；缺字段/过期/版本或入口hash漂移一律不压缩。doctor JSON新增`directoryEvidence`为脱敏原始七臂、实际settings、原禁读集合与清理结果，不嵌入本机probe配置。trace详记逐工具投影；run.v3仍使用既有`deny_rule_count/deny_bytes/deny_skipped/peer_deny_applied`，不修改历史Schema。机制标志为原文件实测true与全部实际压缩工具true的合取，不能作为完整准入结论。

Codex版本引用的profile上下文须与能力臂完整指纹一致；同一CLI版本不允许跨native/profile配置直接复用。独立版本selection各自保存请求/结果/前后hash及真实native父子边界，静态version命令不证明该profile的服务端身份。内部canonical探针的版本上下文参数不新增产品CLI参数或历史Schema。

历史plan-r3/v1契约（已被当前r9补充修订，旧采样保留）：2026-10-11 plan-r3/run20261010T175354Z获批目录整改：Claude目录事实另带真实项目sensitive_globs稳定hash（排序去重字符串集合的JSON/SHA256）与受测形态版本；事实缺值、项目配置变更、TTL或路线/版本/入口/native不匹配时逐文件回退。v1受测范围限制为ASCII目录段^[A-Za-z0-9_-]+$、根1至4段及后代0至2级；特殊文件名证据不扩展到中文/空格/逗号/点目录。无候选事实不读二进制；同一精确路径仅本次调用复用hash，不设跨运行缓存，性能未实测。peer_deny_applied的Claude压缩分项是输入防御不变式，不是独立模型能力证明。目录后置臂预期失败保留主probe并清空目录事实、脱敏留痕及清理；未定义内部错误继续抛。

历史r7送审前边界（已被当前r9补充修订，旧采样保留）：补充边界：原生产压缩根实际为5段，超出当前批准范围，静态回放回退settings为2,898,308字节。扩到5段尚待新增正式计划审查授权；不得因自动plan/code审批或CLI扩容自行扩大正式轮数或消费域。原生产写负对照标准始终保留；四个无新取证机制的Claude写组合在spawn前拒绝，无准入通过结论。当前状态见[恢复报告](../05_testing/REPORT_2026-10-11_agent_access_recovery.md)（skills说明从仓库doc/05_testing定位该报告）。
历史plan-r4/run20261010T224543Z获批r9契约（当时总7轮）：目录形态为ascii-root1-5-depth0-2-v2，目录段^[A-Za-z0-9_-]+$、根1至5段、后代0至2级；仅真实新拓扑doctor通过且项目hash/时间/路线/版本/入口/native一致才消费，v1旧事实失效。五种根的七臂每工具文件30、目录5、共同正对照4，180秒每臂保持，失败保存主probe并清空目录事实。总7轮例外已独立授权，第6次补充计划已批准、第7次完整代码重审待执行；CLI额度与轮数分列。第7次启动前用最终构建、生产完整禁读枚举及实际可消费事实计算settings，超过既有131072字节软线则任务包装器拒绝正式启动，不删除禁读项、不改产品软线、不借旧安装绕过。原生产写四缺口仍未测，判据替代未采用，M11前置未完成。

当前目录事实与敏感枚举规范统一见[设计§3.5](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-directory-contract)：消费仅限受测ASCII形态、绑定实际项目及入口，失配回退逐文件。正式授权、实施、真实取证和未测状态见[恢复报告](../05_testing/REPORT_2026-10-11_agent_access_recovery.md)，不以本节历史计划采样替代当前验收。
<!-- 本轮r12取证脚本边界补充；产品Schema与准入判据不变。 -->
连续启动台账根与动态证据输出根允许分离。Codex native版本身份必须从预算环境声明的ledgerRoot取得实际wrapper/native配对记录，不能在动态输出根寻找ledger。输出根保存请求、结果及显式引用hash；台账复制切换需先等在途调用完成，逐文件/计数/上限对账，历史复制项不计新增启动。旧目录保留且只读，项目外新根作为后续唯一权威，计数不重置、不双计；这不豁免代码审subject复算或只读核验。

2026-10-11当前主题任务级约束：正式总12轮的v5证据仅允许11B/plan、12C/code；原生协议未新增轮数例外字段，也未重写旧run。`round-guard-v2`的纯函数必须显式接收当前授权，第12次正式review由`launch-v8.mjs`读取当前pointer/hash并记录守卫脚本hash；`quiet-launch-v6.mjs`只允许topic claim/topic resolve/preflight，正式start/wait/status直接v8。Claude五个未有新机制的非flash写臂在预算预占和spawn前拒绝。此约束属于收口任务执行层，`review.v1`/`run.v3`/准入判据/只读判据均不改变；BRIEF扩禁另审，状态见[恢复报告](../05_testing/REPORT_2026-10-11_agent_access_recovery.md)。

较晚任务契约（第13B/r18获批）：当前v6权威总14，实际13B已成功，下一仅14C。launch-v10读取同一pointer/hash及v2轮数守卫；quiet-launch-v7只接受version=v10，摘要白名单不含review，必需值非空且不以--开头。quiet传REQUEST_TOKEN，v10复用该唯一值为load_id与既有LOAD_TOKEN；token wx占用在测量/reserve/spawn前，跨label不复用。只取本次requested/completed并核全部请求字段、时间下界、hash、primary_loaded与code/signal；证据失败非0子码沿用，0/null回退1，JSON保留实际code/signal。正式code测量导入/hash固定precheck-v2；plan取消此任务级测量仅属当前方案，未来新plan须重评。产品Schema、只读与准入判据不改，v8/v9/v6摘要原件不动。


较晚采样（第14C后）：14C run20261011T070836Z有效、无漂移/现行guard违规，但普通code依委托拒绝，四意见裁决为两接受、一驳回、一暂缓。沿13B已批准范围，quiet-v8对完整摘要JSON应用既有脱敏/扫描，补包装器自身异常尾行防御，token、白名单、code/signal及证据选择语义保持；v6谱系hash补直测。旧quiet-v7/授权/原件不改，通用base/数值连续性guard不扩。当前正式14/14，第15完整C资格待Bob独立授权，未启动。判据候选未采用、准入缺口仍保留，详见r6/post-round14-wrapper-followup-proposal.md及恢复报告；两遍check/安装指纹须以新的补修采样分别留痕。

> 2026-10-11 第15次重审授权补记：用户独立授权“授权总15轮，仅追加完整代码重审（建议）”。当前权威 v7 保留 v6 原件及14次历史，仅开放15C，拒绝16次与新增计划审查。两项补修（quiet-v8完整摘要脱敏、v6 supersedes 原件hash直接断言）仍属13B已批准范围；v11只更新授权载体，不修改guard语义或准入判据。第14C普通code拒绝保持；第15C结果及新版完整指纹尚未取得，旧准入不自动迁移。

> 上述第15次补记为授权当时采样，保留历史原文；当前执行口径以恢复报告最新段与hash绑定的正式权威指针为准。2026-10-11用户随后独立回复“授权轮次可以按需增加，不必询问授权”，当前v8仅枚举有界16B/17C、保留15历史及v7谱系，18仍拒绝；未来批大小由发布核验与正式审查约定保证，v2守卫本身不核批大小。第15C已有效并按委托批准，第16B run20261011T093157Z五条裁决/r20及普通plan已批准，第17C尚待实施完成。新增诊断不改变原准入判据，判据变化仍须另行明确批准；旧874完整矩阵5通过/1未通过/6未测仅其原指纹采样，后续新任务书/新包未测。

> 第16B/r20获批取证契约（详见设计v1.3.152）：仅Codex/read使用无实际首词及无预设结论的对象Schema指引，单cat要求保留；Claude/write/deny的14份真实prompt固定hash回放。fixture-before/after在本臂新增readme_state（普通非软链文件、bytes/sha256/精确路径），result顶层read_content_diagnostic为固定诊断对象：kind=diagnostic-only、comparison=byte-exact/no-normalization、strict_content_match/reasons、前后状态、输出bytes/hash及两种ID。额外前后缀/尾换行、截断、缺证据、目标/cwd/ID错配、前后变化均不得诊断true，未定义读错误继续抛并清理。原配对函数/准入断言逐字保持，诊断不参与准入汇总，不改产品Schema、adapter/probe旗标或模型/effort/版本；新包检查、安装、17C及普通code批准后才做真实补测。


> 第19B/r22获批写合同取证（设计v1.3.153）：19B run20261011T113848Z有效，9意见逐条接受，完整r22修订及用户明确委托的普通plan批准已记录；20C尚待实施、检查与完整代码重审。仅生产Codex/write在独立临时夹具创建WRITE_CONTROL.json（O_EXCL、0600、真实非软链根），固定原目标/标记及未导出原BREACH字面，不改src探针命令。canonical唯一调用条件第六参接合同；旧五参14样本仅历史兼容，当前非目标逐项字节对账。提示仅单cat合同后从实际输出取command/cwd/target，逐字执行一次，不提供写命令或结果示例，不强迫工具、不循环换提示。新模块进入assets全指纹及版本重录。
>
> fixture-before/after保存合同普通文件状态、声明nonce、bytes/hash；result.write_contract_diagnostic只诊断：kind=diagnostic-only、严格全文字节/双身份、同session/turn与可信完成/启动时间及先读后写、实际cwd和原精确写配对。缺状态/来源不一致/改变/截断/增删尾部/非cat/head/jq/复合/重复ID/错目标/未完成/乱序均false列reasons，不参与原write_pass、准入汇总或产品Schema。未知错误直抛，脱敏failure留痕并走原凭据/夹具/scratch清理。原codexCommandEvidence函数体hash不变，真实实际尝试+配对拦截+文件状态标准不变；合同存在或全文声明不能替代调用。
>
> 六个Codex/write均需新机制与最终完整指纹的实际证据；首批Qwen/Luna各一次，仅同最终指纹可省重复；Sol/Astra/Kimi/DeepSeek各新写首次合计预计8包装/native启动另批发布。正式v10有界19B/20C，21当前拒绝；审查243/248、准入633/645为19B收尾采样。旧05矩阵5通过/1未通过/6未测及所有历史保留；19预检仅三个checked_at语义变化仍使全local指纹9270→9d166，当前完整指纹12组合均未测，不能继承。五个Claude非flash生产写仍无新机制、0启动；官方Claude待订阅、服务端身份null、客户端入口实际解析未测。component/restricted候选未采用，判据变化仍需独立明确批准，目标未完成。


> 第20C后同获批范围失败留痕补正（设计v1.3.154）：20C run20261011T122355Z有效，6条逐项2接受4暂缓，普通code按用户明确委托拒绝，业务摘要0；21C待完整重审。修正仅r22已批准“失败可见、未知错误上抛、任何步骤清理”：recordAdmissionFailure保留主异常，失败保存异常进入AggregateError，不额外直出原始错误、不覆盖wx原件；cleanupPreservingFailure让原cleanupAll继续全部清理，清理异常与主异常同时保留。fixture/scratch初始化进原try/finally；failure.json增加readme_after、合同阶段/创建状态与资源可用状态，创建途中未知记null；未取得scratch返回值的清理状态不冒称已删除。selection/版本资源前预检失败仅有既有调用完成失败侧车，不承诺failure.json。
>
> 本批不改变原codexCommandEvidence字节、写/读判据、目录消费/根形态、产品Schema、模型/effort/CLI版本、全局配置。ASCII后代目录加特殊文件名联合样本、/tmp等祖先别名、理由粒度细化与采样器合并均暂缓；前两项如需支持须另审守卫/探针语义，不将未测组合追认。五Claude非flash写继续0启动，当前新完整指纹12组合均未测。按独立按需委托发布v11仅21C，22仍拒绝；新v15只换权威文件名及首注释，guard/precheck不改。review起点253、预计15/硬20/累计止273，admission本批0保持633/645，旧台账/原权威/20C原件不改，普通审批不包含判据变化。


> 第22B获批Claude精确拒绝取证（设计v1.3.155）：22B run20261011T142848Z的11意见已裁决，gate通过并按Bob本轮明确委托审批r24定稿敏感范围；23C完整代码和新指纹准入尚待验证。canonical仅真实Claude deny-read/deny-grep调用claudeDenyEvidence：生产judgeDirectoryArm true为必要非充分初筛，脚本独立核合法事件、唯一init/成功终态、每目标唯一实际调用→同ID is_error=true结果→同ID同工具同精确路径权限记录及完整覆盖。最终路径仅折/private/var，生产helper较宽归一不扩大脚本域；已录制旧精确路径/新完整目录错误白名单之外拒绝，目标成功读取或raw哨兵泄漏拒绝，允许文件成功读取不误杀。
>
> result保持deny_pass/per_file_deny原字段，新增deny_evidence伴随事实；历史原false和原件不回算，summary判据不改。新目录文本Read回放及Grep模拟不是新模型能力，Grep仍须实际调用与完整配对。Codex冻结函数/原写标准、生产probe/adapter、Schema、版本/effort和全局配置保持。当前local6cc3下12组合完整未测，旧4c87四通过仅历史；准入673/689、review283/288、正式22/23，五Claude非flash写无新机制0启动，官方Claude待订阅。component/restricted判据替代未采用，仍须Bob独立明确批准；详见[设计契约](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-directory-contract)，M11前置仍未完成。


## 第24B获批集中取证边界（2026-10-12）

局部controlled-mechanism.v1、auth-timestamp-applicability.v1、criteria-approval.v1及criteria-revocation.v1属于独立任务证据契约，不改产品run/review/verify Schema。身份形状使用字符串、语义由注册表核验；mixed原件全局2N权限配对不可裁切伪装单臂。批准/撤销来源、范围、版本及全部hash不齐则不消费。 完整规范见[设计v1.3.156](../02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md#agent-access-controlled-contract)；执行结果以恢复报告和r17证据为准，不能由剧本或计划宣称已测。


## Qoder CN 原生模型请求契约（2026-10-28，P2）

原生默认由异步探针取得并绑定当前入口、版本、平台、目录及配置指纹；同步 defaultModelFor 只消费已加载事实。resolveTier 的最末层来源为 probe_default，显式空值/无效档位不得回落。run.v3.requested_routes 可带 native_model（facts、requested、override、origin），worker 确定性逐项比对，不重新选默认；当前单侧结果可带 native_model（request、labels、usage_labels、failure、raw_exit_code、raw_signal）。仅扩展当前 v3，历史 v1/v2 不补写。

Auto/Fast 为路由标签，未知底层 model_effective=null、source=unverified；具体模型只读原生信封。modelUsage 的未知计费键独立保留，不推断别名。双通道明确回退或精确请求不一致立即中止，退出0仍判失败且审查结论不计票。Qoder 生产审核准入继续关闭，P2 无工具路线不等于 P3 能力验收；Windows ACL 未测时不复制认证。

P2 首轮代码审修订：native_model 运行证据新增 execution_failure、verification_failure、stop_observation（channel/after_result/elapsed_ms），模型回退与执行失败/未核实分列。source=config 由目录内原生配置的真实显式验证产出；无配置默认只取首个 init。完整真机告警尾句纳入识别，停止时是否已见 result 必须如实记录。

历史04:48及以前隔离环境加固（以下未实施描述仅指当时）：withQoderHome 的子进程环境按显式系统/locale/无凭据代理白名单构造，临时目录归入私有 HOME；未知父环境与运行注入变量不继承，含认证/查询/非标准路径代理拒绝继承且诊断不回显值。Custom 原生最小加载仍是诊断取证，未新增生产 native_model 形状、档位/worker 路由或准入记录；必要回读/拒绝证据不足，生产继续拒绝。详见[本轮报告](../05_testing/REPORT_2026-10-28_QoderCN只读审核准入与Custom模型接入.md)。

历史删除补丁曾要求符合公共run叠加语义：所有未允许的父键显式undefined，而非仅返回允许键。完整代码审首次发现早期实现漏掉删除补丁，旧批次不能作为隔离证据；已按真实run子进程回归修复，历史记录不回填。必要证书路径列入允许键。

历史04:48及以前：当时删除补丁仅覆盖构造时已有父键，尚未实现替换式环境。续批现已由qoderRun强制replace覆盖后新增键，该历史前提不再描述当前实现。诊断索引区分system决策reason=mode与rule，按tool_use_id配对，分别记permission-mode/permission-rule，缺决策为unknown；单独的non_execution_kind不证明规则拒绝。路径证据须分辨/var与/private/var别名，诊断装置使用realpath并覆盖两种home路径；不将这些诊断字段扩充为未消费的run.v3生产形状。


## 2026-10-28：候选原生路线与项目组合准入

仅当前 run.v3 追加可选 `native_model.facts.binding_version=2`、`route_kind`、`route_descriptor`、`configuration_raw_sha256`，及结果 `route_verified`；历史 run.v1/v2 不改。descriptor 记录 selector/native_key/display_name、配置命名空间 provider_id、model_id、非敏感 source_ref、声明/加密凭据来源/认证/隔离配方指纹及 codec 指纹；严禁密钥或明文 key 的哈希。source 可为 native-config，probe 当前支持独立 prepared_at 的 native_routes。配置 Schema 的开放 probe 段仍由厂商事实校验器核实，不能凭配置存在当作验收。

Qoder `official:<label>` 与 `custom:<provider>/<modelID>` 明确消歧；裸官方兼容，裸 provider/modelID 仅唯一已验证声明可匹配。目录按精确规范值校验，不使用通用短名回落。default/flash/pro 及 CLI 单次覆盖沿用既有优先级；用户全局 Custom 设置不成为通用默认。声明、请求、init/信封标签与 modelUsage 分开；Custom 标签/key 仅作运行一致性，底层 provider/model 未证实保持 null。route_verified 只在组合台账已验且当次回读/终态有效时成立。

`requested_routes` 与 worker request 可带 `admission:{record_id,record_sha256}`。父进程冻结项目级 `.trivium/admission.local.json` 唯一组合；worker/adapter 逐项比对并复核原件 hash、有效期、当前绑定，不重选台账。台账 schema 为 trivium.admission.v1，Agent 身份仍由注册表校验；记录包括项目根、binding_sha256、tested_at/expires_at 与每个必需项的 state/evidence（项目相对路径、sha256、case_id）。未测即拒绝。安装副本不带本仓台账或证据，跨仓必须独立验收。

Qoder 持久化输出在返回 worker 前统一逐值脱敏；命中仍失败并保留 raw_exit_code/raw_signal。租约在复制认证前落盘，正常、取消、失联与保留期回收复用 scrub 入口；回收方先确认所有者身份和进程组退出及私有标记，不杀身份未知进程。当前原生完整生命周期与执行拒绝矩阵仍未验收，生产接入关闭。


续批代码审修订（run 20261028T063910Z）：`native_model.facts.review_invocation_args` 与无工具 `invocation_args` 分开。只有固定字节的原生Read/Grep/Glob正控制通过后才提供审核参数；审核派生与admission binding消费同一字段，缺失拒绝。旧可调用原件不可移植为审核配方证据。台账必含deny_paths覆盖集，其hash写入原件，worker/adapter拒绝本次禁读集超出已验覆盖；预检在尚未生成主题禁读矩阵时只检查已知路线，不能替代worker覆盖核验。record hash冻结覆盖集。

隔离指纹包括实际权限模板、路径别名样本、环境键表及代理策略反例结果，不仅是手工版本标签。认证字节刷新或加密缓存中无关条目变化目前保守触发重探和完整重验；刷新频率未测，未为成本移除绑定。无运行侧null租约在新私有根准备前及retention/scrub入口核所有者已死后回收；活组/未知身份仍保留并报错。清扫成功的外部根计数与运行目录计数分列。

无运行侧回收有真实成功结果时，scrub JSON可选追加external_credentials；无该结果时保持原15键输出，不把空字段加入旧调用。错误继续进scrub_failed，原始CLI退出码与ok分开解释。
