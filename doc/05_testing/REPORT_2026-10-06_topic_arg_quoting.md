# 建议命令里的主题名统一转义 · 实施报告（EV-195）

> - **日期**：2026-10-06
> - **主题**：`建议命令主题名转义`（M11 前待办第三批第 3 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`4f315a3`（`main`，工作树干净）
> - **证据目录**：`doc/05_testing/evidence/topic-arg-quoting-20261006/`
> - **配额**：零配额
> - **方案**：用户 2026-10-06 定取 B——建议命令统一经 `shellQuoteArg` 转义（白名单内主题输出逐字不变）+ 源码护栏禁止裸拼 `--topic ${`，并把 `validateTopic` 注释与设计 §6.1 改成如实描述；校验不收紧（BACKLOG EV-195 状态列），本题不再论证方案本身

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. `src/trivium/naming.ts` :34 起 `validateTopic` 文档块写「允许中英文、数字、`-`、`_`、`.`」，实现只拦空串、超长、`/` `\`、`..`、前导 `.`、控制字符与保留后缀（空白先转 `-`）——`;` `&` `$` 反引号、引号、括号等都能通过。设计 §6.1（:834）同样写成白名单口径，与实现不符。
2. 给人复制执行的建议命令里把主题名不加引号拼入的，按 `--topic ${` 字面（`grep -rnF`）核出 **20 处**，与第二批论证一致（行号为第 1 题提交后的位置）：`cli.ts` 6 处（:1320、:1379～1381、:1561、:1715）、`hooks.ts` 7 处（:704～706、:1061～1062、:1359、:1803）、`approval.ts` 2 处（:188、:221）、`review.ts` 2 处（:1212～1213）、`driver-claim.ts` :385、`gate.ts` :1477、`worktree-summary.ts` :287。
3. 仓内已有两份同形的单引号转义（`worktree-summary.ts` :235 私有 `shQuote`、`probes/verify-commands.ts` :61 导出 `shQuote`），都是**无条件**加引号；本题要的是「白名单内逐字不变」，不能直接复用。
4. 主题名的白名单口径以第二批核过的 `[\p{L}\p{N}-_.]` 为准：本仓 96 个主题全部落在其内（`evidence/backlog-decisions-20261006/topic-whitelist-check.*`），所以对本仓已有主题，改后输出逐字不变。

### 修法

1. `naming.ts` 新增导出 `shellQuoteArg(s)`：全部字符落在白名单 `[\p{L}\p{N}_.-]` 内（且非空）时原样返回；否则整体加单引号，内含单引号按 `'\''` 转义。
2. 20 处 `--topic ${x}` 一律改为 `--topic ${shellQuoteArg(x)}`；同一行里其余参数（`--stage`、`--driver`）是枚举值，不动。
3. 源码护栏（新单测）：用 TypeScript AST 扫 `src/` 全部模板串，凡插值前的字面以 `--topic ` 结尾者，插值必须是 `shellQuoteArg(…)` 调用；并按文件登记调用点数（20 处），新增调用点要登记——注释与普通字符串不在扫描面内。
4. `validateTopic` 文档块与设计 §6.1 改成如实描述：实现是黑名单（列出拦的几类），其余字符（含 shell 元字符）都合法，所以建议命令里的主题名经 `shellQuoteArg` 转义。
5. 用例：`shellQuoteArg` 的白名单原样、元字符加引号、内含单引号转义、空串；两处纯函数调用点（`driver-claim.ts` 的认领命令、`gate.ts` 的分叉作废命令）带特殊字符主题的输出；护栏。

### 不改的边界

- `validateTopic` 的判据不收紧（用户定）；主题名进归档路径的方式不变。
- 只改 `--topic ${…}` 这 20 处建议命令；其余把主题名拼进**人读文案**（非命令）的位置不动——那里没有「复制即执行」的风险。
- 白名单内的主题（本仓全部现存主题）输出逐字不变，既有用例不改断言。

## 1. 改了什么

1. `src/trivium/naming.ts`：新增 `SHELL_SAFE_ARG = /^[\p{L}\p{N}_.-]+$/u` 与导出 `shellQuoteArg(s)`（白名单内原样返回；否则整体加单引号、内含单引号写成 `'\''`；空串返回 `''`）。`validateTopic` 文档块改成如实描述黑名单，并写明「拼进建议命令一律经 `shellQuoteArg`」与「不收紧是用户定的」。
2. 20 处建议命令改调 `shellQuoteArg`（批量改写脚本按文件核对命中数：`cli.ts` 6、`hooks.ts` 7、`approval.ts` 2、`review.ts` 2、`driver-claim.ts` 1、`gate.ts` 1、`worktree-summary.ts` 1），各文件补导入。同一命令里的 `--stage` / `--driver` 是枚举值，未动。
3. 新单测 `test/unit/topic-arg-quoting.test.ts` 6 格：Q1 白名单内原样（含中文、数字、`-` `_` `.`、带变音符的拉丁字母）；Q2 元字符、中文全角括号、内含单引号、空串；Q3 这些主题仍能过 `validateTopic`（校验没收紧），转义后经 `/bin/sh -c printf` 原样还原；Q4 `claimCommand` 与 `approveForkRecovery` 两处调用点的输出（特殊主题加引号、白名单内逐字不变）；Q5 扫描器自测（裸拼、经转义、注释、普通字符串各判对）；Q6 源码护栏——TypeScript AST 扫 `src/` 全部模板串，`--topic ` 之后的插值必须是 `shellQuoteArg(…)`，经转义的调用点按文件与登记表逐一相等（20 处）。
4. 文档：主设计 v1.3.116（6.1 主题名规则改成如实描述黑名单并写明建议命令转义）；LLD v1.1.45（模块表 `naming.ts` 行补 `shellQuoteArg()`）；BACKLOG EV-195 结案；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 类型检查（`tsc --noEmit`） | 退 0 | `tsc.txt` |
| 构建（`build.mjs --with-tests`） | 退 0 | `build.txt` |
| 单跑新单测与 registry-parity（修正后） | 6/6 + 38/38 = 44/44 | `suite-unit.txt` |
| 变异逐条预跑 | M1（一律不加引号）红 Q2/Q3/Q4；M2（单引号转义写错）红 Q2/Q3/Q4；M3（白名单内也加引号）红 Q1/Q4；M4（认领命令回退裸拼）红 Q4/Q6；M5（失守作废命令回退裸拼）红 Q6 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 5/5 咬住 | `mutation-output.txt`、`mutation-spec.json`（`gen-mutation-spec.mjs` 生成） |
| 全量首轮（作废） | 两次都 2889 / 2886 / 1 / 2，红的是 `registry-parity`「grep 对账：白名单外的模块不得出现 Agent id / 前缀字面量」：`shellQuoteArg` 初版函数体里的正则字面量 `/'/g` 让该用例的简易剥注释器（不认正则）把其后 `naming.ts` 的注释当成字符串扫，报出 3 行早已存在的注释。改成 `split` / `join` 写法（不含正则字面量，函数里留注释说明）后重生成变异规格、重跑预跑与装置（仍 5/5），再完整重跑全量；首轮读数与首轮变异留在 `first-round-red/` | `first-round-red/` |
| 全量第 1 次 `npm run check` | 2889 / 2887 / 0 / 2，退 0（总数比起点 2883 多 6，即新单测 6 格） | `check-1.txt` |
| 全量第 2 次（串行） | 2889 / 2887 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 两次全量期间各 1（均为 `trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

## 3. 提交前自审

- 注释与文档：`validateTopic` 文档块、设计 6.1 都改成黑名单口径；`shellQuoteArg` 文档块写的「白名单内原样、空串给一对引号」与实现一致（Q1、Q2 钉住）。「本仓全部现存主题都在其内」引的是第二批的只读核对（`evidence/backlog-decisions-20261006/topic-whitelist-check.*`），本题未重扫。
- 断言范围：既有用例一条未改——白名单内主题的输出逐字不变，全量里断言这些建议命令的用例照常通过即是证据；新断言只针对新函数与两处调用点。
- 护栏表：20 处全部登记在 Q6 的 `REGISTERED`；M5 证明只改一处回退裸拼也会被护栏抓住。扫描面只看模板串里紧跟 `--topic ` 的插值：用 `'--topic ' + x` 拼接或 `--topic=` 写法不在面内——今天 `src/` 里没有这两种写法（`grep` 核过），登记在此作为护栏的已知边界。
- 范围：校验不收紧；主题名拼进人读文案（非命令）的位置未动。
- 触发条件：本题未命中等触发表上其它条目的触发条件。
