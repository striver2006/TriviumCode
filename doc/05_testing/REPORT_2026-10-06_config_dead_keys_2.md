# 两个空配置项删除：review.parallel 与 isolation.deny_via_cli · 实施报告（EV-30 ②③）

> - **日期**：2026-10-06
> - **主题**：`空配置项收口二`（M11 前小批第四批第 1 题；**本批未走双审**，用户以会话指令授权按建议直接开发，提交前由执笔方自审补丁）
> - **起点**：`e670adf`（`main`，工作树干净）
> - **证据目录**：`doc/05_testing/evidence/config-dead-keys-2-20261006/`
> - **配额**：零配额
> - **方案**：用户 2026-10-06 定「删」，照搬 EV-30 ① / EV-15 的做法（`REPORT_2026-10-01_config_dead_keys.md`、提交 `a9e7cdcb`）。理由：单侧调试已有 `--critics`；路径级 deny 是否注入由探针实测决定，开一个「关」口只会削弱隔离

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. `review.parallel`：类型 `src/trivium/types.ts` :888、默认值 `src/trivium/config.ts` :272（`true`）、schema `config.v2.json` review 段必填（:107）。`src/` 下没有任何代码读它——`runner.ts` :206 `runBothSides` 恒用 `Promise.allSettled` 并行。用户手册 §5.3（:438）写「两侧并行。改 `false` 只会更慢，无收益」——**失实**：改 `false` 什么都不变，不是「更慢」。
2. `isolation.deny_via_cli`：类型 `types.ts` :883（`'auto' | 'off'`）、默认值 `config.ts` :268（`'auto'`）、schema isolation 段必填（:81）。没有代码读它——路径级 deny 注不注入只看探针 `path_deny.supported`（`adapters/claude.ts` :836；codex :273 注明无 deny 机制）。用户手册 §5.2（:424）写「两侧实测均不支持，实际恒为降级」——**已过时**：claude 侧实测支持并会注入 `--settings`。
3. 两键都登记在 `test/unit/config-consumers.test.ts` 的 `KNOWN_DEAD`（:66、:79），附「删或接线要先定」。样板机制已在：`config.ts` :441 `DEPRECATED_CONFIG_KEYS` 表驱动，`deprecatedConfigNotice` 由 `doctor.ts` :556 与 `preflight.ts` :650 共用；同文件末尾有「已删除键」回归锁（`DELETED_KEYS`）与流程文档不回潮锁（U8）。
4. 其余出现处：主设计 13.1 示例 :3051 / :3055；本仓 `.trivium/config.yaml` :22 / :25（样板提交同样删了本仓配置里的旧键）；`skills-src/` 与渲染产物里没有这两个键；演进设计 §11 示例 :607 有 `deny_via_cli`（该文正文冻结，修正只落主设计，不改）；`config.v1.json` 是历史契约（样板未改，本题同样不改）。

### 修法

1. `types.ts` / `config.ts` 删两键的类型与默认值；`DEPRECATED_CONFIG_KEYS` 加 `['review','parallel']`、`['isolation','deny_via_cli']`，doctor / preflight 的已废弃键提示随表自动覆盖。
2. `config.v2.json`：两属性保留、标 `deprecated` 并写说明、移出各自段的 `required`、类型约束不变——带着它们的旧配置照常通过校验。
3. `config-consumers.test.ts`：`KNOWN_DEAD` 移出两项；`DELETED_KEYS` 并入两键（默认配置与 schema required 回归锁、流程文档不回潮锁一并覆盖）；新增一格：两键出现时 `deprecatedConfigKeysIn` / `deprecatedConfigNotice` 只报实际出现的那几个，schema 标了 `deprecated` 且不在 required。
4. 文档：主设计 13.1 示例删两行、13.1.1「已废弃键」一段补两键；用户手册 §5.2 / §5.3 两行改成「已删除」、`已废弃的键` 表补两行；本仓 `.trivium/config.yaml` 删两行（与样板同）。

### 不改的边界

- 不改 `runner.ts` 的并行、不改 deny 注入判据；EV-30 ④～⑦ 不在本题（并入 M11）。
- `config.v1.json`、演进设计（冻结）不改；`deprecatedConfigNotice` 的正文不改。

## 1. 改了什么

1. `src/trivium/types.ts`：`IsolationConfig.deny_via_cli`、`ReviewConfig.parallel` 删除，原位留一行注释指向 `DEPRECATED_CONFIG_KEYS`。
2. `src/trivium/config.ts`：两键默认值删除（`init` 按默认值写配置，随之不再写它们）；`DEPRECATED_CONFIG_KEYS` 补 `['review','parallel']`、`['isolation','deny_via_cli']`，文档块里「两键」改成覆盖全部条目的说法；`deprecatedConfigNotice` 正文不变，doctor（`doctor.ts` :556）与 preflight（`preflight.ts` :650）的提示随表覆盖。
3. `skills/dual-critic/schema/config.v2.json`：两属性保留、加 `deprecated: true` 与说明、移出 isolation / review 段的 `required`；`deny_via_cli` 的枚举与 `parallel` 的布尔约束不变。
4. 用例：`config-consumers.test.ts` 的 `KNOWN_DEAD` 移出两项（头注释改为「余下四条，④～⑦ 并入 M11」），`DELETED_KEYS` 并入两键，回归锁与 U8 的用例名同步；新增 U10（只报实际出现的键、按表序、正文列出、默认配置为 null）。`config-schema.test.ts` 新增 V1～V4（带两键与另一组合法取值都通过、默认值不带且不带也通过；`parallel: 'yes'`、`deny_via_cli: 'on'` 照旧各被拒一条；schema 标了 deprecated 且不在 required；磁盘 `config.yaml` 带两键时 `loadCtx` 照常加载、键原样留在合并结果）。
5. 文档：主设计 v1.3.122（13.1 示例删两行、13.1.1「已废弃键」补两键与「review、isolation 段同样 `additionalProperties: false`」）；用户手册 v1.0.40（§5.2 / §5.3 两行改为已删除并订正原失实说法，「已废弃的键」表补两行、段首与段末措辞改为覆盖四个键）；本仓 `.trivium/config.yaml` 删两行；BACKLOG EV-30 ②③ 结案、④～⑦ 写明并入 M11；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 类型检查 | 退 0 | 全量内含 |
| 构建（`build.mjs --with-tests`） | 退 0 | `build.txt` |
| 单跑 config-consumers、config-schema、preflight | 91/91（含新增 V1～V4、U10 共 5 格） | `suite-unit.txt` |
| 源码变异逐条预跑 | M1（废弃表漏登 parallel）红 U10；M2（漏登 deny_via_cli）红 U10；M3（默认值加回 parallel）红 4 格（对账、回归锁、U4、U10） | `mutation-names-log.txt`、`mutation-names-output.json` |
| 源码变异装置 | 3/3 咬住 | `mutation-output.txt`、`mutation-spec.json` |
| schema 变异逐条预跑（`.json` 进不了装置） | S1（required 加回 parallel）红 8 格（默认配置、本项目配置、U1、U2、U7、V1 等都校验失败）；S2（去掉 deny_via_cli 的 deprecated）红 V3 | `mutation-names-schema-log.txt`、`mutation-names-schema-output.json`、`mutation-spec-schema.json` |
| 全量第 1 次 `npm run check` | 2901 / 2899 / 0 / 2，退 0（比起点 2896 多 5 格：V1～V4、U10） | `check-1.txt` |
| 全量第 2 次（串行） | 2901 / 2899 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 第 1 次全量与自检期间 0、第 2 次全量期间 1（`trivium-index-`）；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

另：改完本仓 `.trivium/config.yaml` 后用仓库 bundle 跑过一次 `doctor --no-model-calls --only codex`，输出里没有「已废弃的键」提示（确认本仓配置已不带它们）。这次 doctor 照常把 codex 段的零配额探测结论写回了本仓 `.trivium/config.local.yaml` 的 `probe:` 段（不进 Git，doctor 的正常行为）。

## 3. 提交前自审

- 注释与文档：手册两行原说法（「只会更慢」「两侧实测均不支持」）失实，已改；设计 13.1.1 的「gate 段与 antigravity 分支都是 `additionalProperties: false`」扩到 review / isolation 段（已核 schema 两段确为 false）。`config.ts` 文档块的「两键」改为覆盖全部条目。
- 断言范围：既有用例只改了名字与 `DELETED_KEYS` 的成员，没有放宽；U8 现在也扫 `parallel` 这个裸词——今天 `skills-src/` 与渲染产物里零命中，将来流程文档里若出现与配置无关的英文 parallel 会误红，届时把 U8 改成按点分路径扫。
- 范围：`runner.ts` 并行与 deny 注入判据没动；`config.v1.json`、演进设计 §11 示例（冻结）没动；EV-30 ④～⑦ 未动（并入 M11）。本题无新增需要登记进护栏表的调用点。
- 触发条件：本题未命中等触发表上其它条目的触发条件。
