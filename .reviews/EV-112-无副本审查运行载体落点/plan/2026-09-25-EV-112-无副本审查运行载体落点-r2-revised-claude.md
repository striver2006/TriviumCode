---
schema: trivium.disposition.v1
topic: EV-112-无副本审查运行载体落点
stage: plan
role: claude
kind: revised
run_id: 20260924T155948Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - CODEX-07
  - AGY-r2-01
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
---

# 裁决：EV-112（无副本审查运行载体落点）· 计划双审第 2 轮

> 被审对象：`2026-09-24-EV-112-无副本审查运行载体落点-r2-claude.md`
> ｜ 运行：`20260924T155948Z`（14m35s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `approve-with-nits` ｜ glm `approve-with-nits`
> ｜ 共 13 条：次要 6 ｜ 吹毛求疵 7 ｜ 零阻断、零重要
> ｜ **全部接受**。同指两组：CODEX-01 ≡ GLM-02（落点自检的析取判据看不见「半采纳」）；CODEX-06 ≡ GLM-01（beta 改写的 argv 触发器）。
> CODEX-02 与 GLM-05 同指 E1 副本支对照的变量不唯一，分别从「适配器 vs 手搓」与「宿主环境」两面，合并落点

## 0. 本轮的形状

**三侧一致判定成立的**（焦点一、二、四）：
- **D2-(a) 两支都设**：三侧认可。codex 与 glm 各补了一条比 r2 自述更直接的机制论证：Env 层在全包只有两个消费方（优先级表 `eyr` 与装层一处），
  取值相同则「Env 层非空」本身不切换任何行为；`storage` 只有 `dir` / `sessionDbPath` 两个字段，全包 `"~/.zcode"` 字面只有缺省对象一处，不存在按字面比较缺省路径的逻辑；
- **十一键读法**逐条被复核；passthrough 旁路名单全文被复核；「环境键层面没有第四类能改写落点的键」codex 按 `.ZCODE_*` 属性访问全量扫过（30 处 + helper 式 4 处），glm 按全枚举逐类核过；
- U3b / U8 与 M4 / M9 / M10 咬得住。

**意见集中在两处**：
- **落点自检的判据**（焦点三）：r2 是「日志有 sessionId **或** rollout 在」。日志键由日志工厂直读环境，存储键经 `aun` 进配置层，两条路径能独立漂移；只丢存储键时自检报 true，而逐字含送审包的 rollout 已回到真实 HOME。另一处：字段不进 run.json，这条唯一的安全信号在归档里没有持久落点；
- **E1 的对照设计**：变量不唯一，观测面到不了工具调用之后的载体。

**我在裁决 CODEX-01 时核的一条**（决定合取判据会不会误报）：rollout 写不写由 `recordModelIO = request.metadata.skipTranscript !== true && 运行档位 !== "test"` 决定（包内 2106 行 `s=…Kst(e.env)`，`Aln` / `Pln` 首句）。
运行档位由 `ZCODE_RUNTIME_ENV` 决定，已在清除面里，清掉后推断为 `production`；主回合请求不带 `skipTranscript`。所以 CLI 成功返回 envelope 时 rollout 必写，合取判据不会因此误报。
这也给清 `ZCODE_RUNTIME_ENV` 多了一条理由：`test` 档不写 rollout，回读与自检都会失明。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实。`rB` 取 `e.logDir ?? e.env?.ZCODE_LOG_DIR ?? N6s()`、调用点都不传 `logDir`；`aun` 的后缀表里没有 `LOG_DIR`。日志与存储两族的失效模式不相关，而 rollout、db、artifacts、sessions 全在存储族，恰是逐字含送审包的那一族。析取判据在「只丢存储键」时主动报 OK，比不报更坏。r2 §4.6「唯一症状是 `model_effective` 变 null」在这一格也不成立 | r3 §4.6 判据改为**合取 + 反向核**：①`carriers_landed` 拆成 `{ log, rollout }` 两个布尔，任一为 false 即播报（合取不误报的依据见 §0）；②无副本支另做反向核：真实 `~/.zcode/cli/rollout/model-io-<sessionId>.jsonl` 存在即记 `leaked_to_home: true` 并播报（只查文件名，不读内容）。删去「唯一症状」一句。U8 补半采纳臂（见 GLM-02） |
| GLM-02 | glm | minor | 接受 | 与 CODEX-01 同指；另建议两项分开持久记、U8 补「只认日志键、不认存储键」的半采纳臂 | 并入 CODEX-01 的落点；r3 §6.1 U8 拆成两臂：全不采纳、半采纳（日志进运行目录、rollout 回 HOME），两臂都断言播报且半采纳臂 `leaked_to_home: true`；§6.2 新增 M11（判据退回析取）⇒ 半采纳臂红 |
| CODEX-03 | codex | minor | 接受 | 属实。r2 援引 `model_override_reorder` 不进 run.json 的先例，但两者性质不同：reorder 是守卫分句用的当轮辅助，`carriers_landed` 是本题唯一的安全信号。只落 trace.json 与 `status.json` 时，运行目录过期后归档里答不出「这次有没有把送审内容留在真实 HOME」。同族的 `model_override_applied` 正落在 run.json；`run.v2.json` 的逐侧定义 `additionalProperties: true`，加一格可选字段不破契约 | r3 §4.6：`carriers_landed` 进 run.json 逐侧段，与 `model_override_applied` 同处条件展开（缺席 = 没走到自检）；`run.v2.json` 在 `$defs.critic.properties` 补该字段的说明（可选、对象、两布尔 + 可选 `leaked_to_home`）；§5.2 消费方表补 `review.ts` 组装处与 schema；设计文档 §6.7.1 补一行。RUNBOOK 排查入口指 run.json |
| CODEX-02 | codex | minor | 接受 | 属实。「直接拉 CLI，env 同旧代码」同时变了两个量（三键 ＋ 适配器 vs 手搓，后者还要复刻置首与只读参数），失败会被错记到三键头上；401 让观测面止于模型调用之前，artifacts / sessions / memories 不在其中，证不了「整份布局不变」 | r3 §6.3 E1 副本支对照改为同一份新代码：`invokeZcode` 调两次，只差 `storageRedirectRoot` 给不给（清除面完全相同），副本经同一个 `prepareZcodeHome(…, { requestedFirst: true })` 造两份；报告显式列「比对到的路径集合」与「不在观测面内的载体」；判据措辞改为「模型调用前写出的落盘集合相同」，「整份布局不变」挂到副本支下一次真实双审的实跑读数（§6.3 末段） |
| GLM-05 | glm | nit | 接受 | 属实。两组环境纯净性没控，E0 记过 `host_zcode_env_keys`、E1 清单没有 | 并入 CODEX-02 的落点：E1 脚本记录宿主 `ZCODE_*` 键名并断言为空，不为空即停止不出读数 |
| CODEX-04 | codex | nit | 接受 | 属实。`ZCODE_LOG_DIR` 不是 Env 层取值，r2 把三键都说成「Env 层值」是机制说错了；「Env 层只有两个消费方，取值相同即不切换行为」这条论证 r2 没写，而它比 E1 的落盘对照更直接 | r3 §1.2 P1 补「日志键不进配置层」；§4.2 措辞改为「两键进 Env 层（40）＋一键由日志工厂直读」，并写入 Env 层两消费方的论证与出处（`eyr` 108 行、装层 2110 行），D2-(a) 的立论不再单独依赖 E1；§7 设计文档同步这条机制 |
| CODEX-05 | codex | nit | 接受 | 属实。`ZCODE_ENV` 还被 `YL` 读作测试控制面端点选择、并进遥测环境名；清掉它仍 fail-safe（审查运行本就该走生产控制面），但「清掉只会把落点拉回各自 HOME」会让人推断零副作用 | r3 §4.3 表逐键写副作用：`ZCODE_ENV` 行注「顺带关掉测试端点选择与遥测环境名」；`ZCODE_RUNTIME_ENV` 行补「`test` 档不写 rollout」（§0）；表末那句总括改为「方向都是 fail-safe，副作用逐键见上」 |
| CODEX-06 | codex | nit | 接受 | 属实，已复核：`RMi` 另对 argv 逐项匹配 `(^|[/\\])zcode-beta(?:$|\.)`。审查运行两支因 `ZCODE_STORAGE_DIR` 非空早退而免疫（这是 (a) 比 (b) 强的又一处）；探针与探活（L1～L7）不设存储根，入口路径或提示语里出现该路径段时会被改写 | r3 §1.2 P9 补 argv 触发器；§4.3 表 beta 行注「清键挡不住 argv 触发，审查运行由早退挡住」；§8 新增 R7；§6.3 E1 约定 argv 不含该字面，并断言两组本次 sessionId 的 rollout 落在同一前缀下 |
| GLM-01 | glm | minor | 接受 | 与 CODEX-06 同指；另建议 doctor 在入口路径命中该模式时出信息级 note | 并入 CODEX-06 的落点；doctor note 一并做（成本一行判断，只报「入口路径含 zcode-beta 段」、不报路径全文），U7 补一格 |
| CODEX-07 | codex | nit | 接受 | 属实。只为观测 P5 / P5b / P6 在无副本支是否跟着落点走，单侧 glm 一次就够，比双侧便宜一个量级；RUNBOOK 已记这条路径 | r3 §6.3 E2 补等价的便宜路径：单侧 `--critics glm`，极短 brief，Flash 档；未指定模型的做法仍由用户定。写明它是真实配额、由用户发起 |
| AGY-r2-01 | gemini | nit | 接受 | 属实。字符串后缀匹配遇尾部分隔符会失效 | r3 §4.2：防嵌套判断改为 `path.basename(path.resolve(root)) === '.zcode'` 即抛错；U1 补带尾斜杠的一格 |
| GLM-03 | glm | minor | 接受 | 属实。3 次二元结果只够支撑「未观察到稳定关联」，r2 写的「不稳定 ⇒ 与三键无关的时序差」超出样本能力；机理定位有零成本线索没收（`zcode-builtin*.json` 的存在性与 mtime）。codex 在盲区段另指出冷 / 热缓存与固定先后顺序两个混淆项 | r3 §6.3 E1 重复取样：每次都用新的 `mkdtemp` HOME（排除冷热缓存）、两组交替顺序（ABAB…）；记录两组 HOME 侧 `zcode-builtin*.json` 的存在性与 mtime、脱敏后的 stderr 全文。判读三档改为：稳定只在一组出现 ⇒ 定位机理；不稳定 ⇒ 登记「未观察到稳定关联」；定位不了 ⇒ 登记「未解释的观测差」。§1.5 读法第 4 条同步 |
| GLM-04 | glm | nit | 接受 | 属实，已复核 `zcode.ts:509-513`：`exclude` 只有 `plugins` 与 `db`，artifacts / memories / sessions 在命中即删的扫描域内。r2 R6 继承了第 1 轮 GLM-05 的不准措辞 | r3 §8 R6 与 §4.5 doctor 文案、§7 同步句改为：「log / rollout 就地脱敏；db / plugins 整目录排除；artifacts / memories / sessions 过命中即删扫描（二进制整删），幸存内容随运行目录保留期整删」 |

## 2. 修订稿 r3 的改动清单（按节）

| # | 节 | 改动 | 来源 |
| :-- | :--- | :--- | :--- |
| 1 | §1.2 | P1 补「日志键不进配置层」；P9 补 argv 触发器与 `recordModelIO` 对运行档位的依赖 | CODEX-04、CODEX-06、GLM-01、§0 |
| 2 | §1.5 | 读法第 4 条的判读档位改写 | GLM-03 |
| 3 | §4.2 | 机制措辞与 Env 层两消费方论证；防嵌套改 `basename` | CODEX-04、AGY-r2-01 |
| 4 | §4.3 | 逐键写副作用；beta 行注 argv 触发 | CODEX-05、CODEX-06 |
| 5 | §4.5 | doctor 文案措辞；入口路径 beta 段 note | GLM-04、GLM-01 |
| 6 | §4.6 | 判据改合取 + 反向核；字段拆两布尔 + `leaked_to_home`；进 run.json；删「唯一症状」 | CODEX-01、GLM-02、CODEX-03 |
| 7 | §5.2 | 消费方表补 `review.ts` 组装处、`run.v2.json`、doctor | CODEX-03、GLM-01 |
| 8 | §6.1 | U1 补尾斜杠；U7 补 beta 段；U8 拆两臂；新增 U9（run.json 组装） | AGY-r2-01、GLM-01、GLM-02、CODEX-03 |
| 9 | §6.2 | 新增 M11（判据退回析取）、M12（run.json 不写该字段） | GLM-02、CODEX-03 |
| 10 | §6.3 | E1 对照改为同一份新代码、记宿主键、新 HOME + 交替顺序、记 builtin 文件与 stderr 全文、列观测面；E2 补单侧路径 | CODEX-02、GLM-05、GLM-03、CODEX-06、CODEX-07 |
| 11 | §7 | 设计文档补 Env 层机制与 run.json 字段 | CODEX-04、CODEX-03 |
| 12 | §8 | R6 措辞改准；新增 R7（argv 触发的 beta 改写） | GLM-04、CODEX-06 |
| 13 | 文末 | 与 r2 的偏差表 | — |

## 3. 其它登记

- **建议 r3 作定稿，不再送第 3 轮**，由用户定。理由：本轮零阻断、零重要，三侧对方向（D2-(a)、十一键、自检走守卫）一致认可；
  r3 的改动都是按审查员给出的具体形态收紧：判据从析取改为合取、字段多落一处、E1 去混淆。没有引入审查员未见过的新方向。
  run.json 多一个可选字段是接口面的扩大，但 schema 本就允许，代码双审会再过一遍。
- 编排器收尾结构提示与第 1 轮相同（codex、glm 引用厂商包未列入 consulted；codex 侧只读 / 路径核验降级），只记录。
- gemini 在焦点五把 stderr 那一行定性为「CLI 后台探测内置凭据的普通异步 INFO」，但没给出处，而包内没有该句的完整字面（codex 也核过）。本裁决不采信这条定性，照 GLM-03 的做法由 E1 取样判。
- 台账：EV-112 的轮次不进 M10b 累计与阈值（r7 §4），本轮耗时 14m35s。本主题计划双审累计 2 轮。
