# 两个空配置项收口 · 实施报告（EV-30 ①、EV-15）

- **日期**：2026-10-01
- **主题**：`两个空配置项收口`；计划 `.reviews/两个空配置项收口/plan/`（计划双审 run `20261001T123430Z`：codex / gemini `approve-with-nits`、glm 解析降级（原文自报 `approve-with-nits`），实质意见 10 条全接受 → r2 定稿）。命令 A 一口气跑，不设人工闸门
- **起点**：`9cc9249`（`main`，工作树干净）；旧构建固定为 `git archive 9cc9249`
- **状态**：实施与验证完成；代码双审见 §6；verify 见 §8；未提交
- **evidence**：`doc/05_testing/evidence/config-dead-keys-20261001/`

---

## 1. 问题

`gate.max_check_retries` 与 `agents.gemini.readonly_commands` 都是「类型 + 默认值 + 必填 schema + 文档承诺」齐全、而 `src/` 下**没有任何代码读取**的配置项：

- `max_check_retries`：三份 `/dual-review-*` 的 SKILL.md（源 `skills-src/partials/review/body.md`）向 Driver 承诺「最多重试 `max_check_retries`（默认 3）次」，代码里没有任何重试计数；MANUAL §5.5 列着它（说明列是「—」）；`/dual-run` 的 S4 另写死「最多 3 次」、S8 没有上限。
- `readonly_commands`：只在 antigravity 一支；MANUAL §5.4 写成「允许的只读命令」，设计 10.3 隔离分层表工具层写着 Antigravity 侧有「只读命令白名单」「`commandExecutionPolicy` 沙箱/受限」「`permissions.deny` 兜底」——而 agy 的 `trivium-critic` 工具面里**没有任何命令工具**（`run_command` 出现即判失守）。

用户决策（送审前已定）：两个都删、不接线；schema 继续接受并标已废弃，只在 doctor 与 preflight 提示；流程文档改为不引配置的流程约定；codex 命令白名单零配额核清后只登记不接线。

## 2. codex 命令白名单核查（零配额，2026-10-01 本机 codex-cli 0.159.2）

只看 `codex exec --help` 与本地 `codex execpolicy check`，未发起任何模型调用。原始输出：`codex-execpolicy/help.txt`、`codex-execpolicy/check-output.txt` 与三份临时规则文件（退出码取 codex 自身）。

| 规则 | 命令 | 结果 |
| :-- | :-- | :-- |
| `prefix_rule(pattern=["git","show"], decision="forbidden")` | `git show HEAD` | `forbidden` |
| `prefix_rule(pattern=["cat"], decision="allow")` | `cat x` | `allow` |
| 同上两条 | `ls`、`rm -rf x` | 无匹配（无 decision） |
| 同上 | `bash -lc 'git show HEAD'` | 无匹配 |
| 同上 | `/usr/bin/git show HEAD` | 无匹配 |
| `prefix_rule(pattern=[], …)` | `ls` | 规则文件解析失败，codex 退 1 |
| `prefix_rule(pattern=[["git","ls"],"show"], …)` | `git show` / `ls show` | 均 `forbidden` |

结论：**有机制、但不是白名单**——execpolicy 只能按命令前缀给 `allow` / `prompt` / `forbidden`，写不出「默认拒绝」；能表达「禁止某些前缀」。本主题不接线，机制与代价登 BACKLOG **EV-184**（等触发）。

## 3. 落地（按 r2 §3～§5）

| 落点 | 改动 |
| :-- | :-- |
| `src/trivium/types.ts` | `GeminiCriticConfig` 删 `readonly_commands`、`GateConfig` 删 `max_check_retries`（原位留注释指向 `DEPRECATED_CONFIG_KEYS`）；`ClaudeCriticConfig` 文档块的举例改为「已删除」 |
| `src/trivium/config.ts` | `defaultConfig()` 删两处默认值（`init` 因此不再写它们，`init.ts` 本身不改）；新增 `DEPRECATED_CONFIG_KEYS`（`'*'` 匹配 agents 下任一 id）、`deprecatedConfigKeysIn(cfg)`、`deprecatedConfigNotice(cfg)`（只列实际出现的键、不带 ⚠️） |
| `src/trivium/preflight.ts` | 新增 `checkDeprecatedConfigKeys`：④⁗「已废弃配置键」，`ok: true`、`warn: true`，排在失联阈值之后、模型 slug 之前 |
| `src/trivium/doctor.ts` | 环境段（与 `--only` 无关）把正文推进 `warnings`，不影响退出码 |
| `src/trivium/adapters/base.ts`、`src/trivium/guard.ts` | 「至今没有任何消费方」改为「从未接线、已于 2026-10-01 删除」；base.ts 补 codex 执行面现状一句（带实测限定、指向 EV-184） |
| `skills/dual-critic/schema/config.v2.json` | gate 段与 antigravity 分支：两属性保留、移出 `required`、加 `"deprecated": true` 与说明；类型约束不变 |
| `skills-src/partials/review/body.md`、`skills-src/commands/run.contract.md` | 「补齐后重跑本步；重跑最多 3 次（首次校验不计），仍不通过则向用户说明缺口并停下，交给用户处理」——review 正文、`/dual-run` S4、S8 同一句（S8 原无上限）；`npm run render` 重出 16 份 SKILL.md（12 份 `/dual-review-*` + 4 份 `/dual-run`） |
| `.trivium/config.yaml`（本仓） | 先取证（§4.5），再删去两键 |

**文档**：主设计 v1.3.72（7.4 / 8.6 步骤 6 改流程约定；10.3 表工具层与文件系统层两格按实改写、表外补 codex 侧一段；13.1 示例删两键；13.1.1 加「已废弃键」；§10.1 两处注记与 18.1 #11 加注；变更记录）；MANUAL v1.0.26（§5.4 / §5.5 删行，§5.6 后加「已废弃的键」）；PROTOCOL `config.v2` 一节加已废弃键一段；BACKLOG：EV-15 done、EV-30 改「① done、②～⑦ 仍 todo」、新登 EV-184。冻结的演进设计、ADR_002、`config.v1.json`、`init` 的 v1 → v2 改写按计划不动；LLD / PRD / RUNBOOK 全仓 grep 无两键，不改；`skills/dual-critic/SKILL.md` 与 AGENTS.md 契约面核过没写到具体键，不改。

**计划偏离**：r2 §3.3 的签名里 `DEPRECATED_CONFIG_KEYS` 每条带 `ref` 字段；实施时发现它没有任何读者——恰是本主题要清的形状——改为把出处写在行尾注释里。

## 4. 读数

### 4.1 单测

新增 10 条：`config-schema`（U1 带 / 不带两键都通过校验、U2 类型约束未放宽、U3 schema 标注、U7 磁盘配置带两键时 `loadCtx` 照常加载）、`config-consumers`（回归锁：默认配置与任一 `required` 不得再含两键；U4 判定五格与正文；U8 `skills-src/` 全部文件与 `skills/` 下全部 `SKILL.md` 不得再出现两键）、`preflight`（U5 带两键：照常通过、进 `warnings`、以 ⚠️ 起头、排位；U5′ 不带不出；U6 doctor：两键 / 一键 / 不带三格）。`KNOWN_DEAD` 去掉两条，余 EV-30 ②～⑦ 六条。相关 4 个套件（含 `entry-render-parity`）104 / 104。

### 4.2 源码变异

规格 `gen-mutation-spec.mjs` → `mutation-spec.json`（锚点从现行源码截取、逐条核唯一，每条一个期望套件）。先用带 `--test-timeout=60000` 与哨兵的逐条预跑 `mutation-names.mjs`：**10 / 10 全红、无超时、无取消**（`mutation-names-log.txt` / `mutation-names-output.json`）。正式装置 `scripts/mutation-check.mjs`：基线 2 个套件全绿，**10 / 10 咬住**（`mutation-output.txt`）。

| # | 变异 | 期望套件 | 红在 |
| :-- | :-- | :-- | :-- |
| M1 | `deprecatedConfigKeysIn` 什么都不报 | `config-consumers` | U4 |
| M2 | `'*'` 不展开 | 同上 | U4 |
| M3 | preflight 不推该项 | `preflight` | U5 |
| M4 | doctor 不推告警 | 同上 | U6 |
| M5 | preflight 该项去掉 `warn` | 同上 | U5 |
| M6 / M7 | `defaultConfig()` 加回 `max_check_retries` / `readonly_commands` | `config-consumers` | 对账、回归锁、U4（fail=3） |
| M8 | 正文改回静态列举两键 | 同上 | U4 |
| M9 | `'*'` 展开不排序 | 同上 | U4 |
| M10 | 正文自带 ⚠️ | 同上 | U4 |

### 4.3 schema 契约变异

`contract-mutations.mjs`（装置只认 `src/*.ts`）。`validateConfig` 读构建拷进 `dist/test/` 的 schema，U3 与回归锁读仓库源 schema，所以 K1～K5 改 dist 拷贝、K6 / K7 改源文件；执行窗口按计划双审 CODEX-05：先构建一次，只 `node --test` 直跑两个目标测试文件，每格先核变异已落上，跑完恢复并核哈希，收尾核 dist 拷贝与源逐字节相同。**7 / 7 咬住**（`contract-mutations-output.txt`）：

| # | 变异 | 红在 |
| :-- | :-- | :-- |
| K1 | gate `required` 加回 `max_check_retries`（dist） | U1（另有 3 条既有用例同红：默认配置不再合法） |
| K2 | gate 删 `max_check_retries` 属性（dist） | U1、U7 |
| K3 | antigravity `required` 加回 `readonly_commands`（dist） | U1（另 3 条同 K1） |
| K4 | antigravity 删 `readonly_commands` 属性（dist） | U1、U2、U7 |
| K5 | `max_check_retries` 去掉 `minimum`（dist） | U2 |
| K6 | 源 schema 去掉 `deprecated` | U3 |
| K7 | 源 schema gate `required` 加回 | U3、回归锁 |

### 4.4 兼容验收（零配额，`acceptance.mjs`）

旧构建：`git archive 9cc9249` 解到临时目录、`node_modules` 软链本仓、归档内 `node scripts/build.mjs`（bundle sha256 前缀 `ead6bcb6254a`）；新构建：工作树（`31391baaeeca`）。每格一个新临时 git 仓库，`doctor --only env --no-model-calls --json`。**4 / 4**（`acceptance-output.txt` / `acceptance-readout.json`）：

| | 带两键 | 不带两键 |
| :-- | :-- | :-- |
| 旧构建 | 退 0，无「配置不合法」，无提示 | 退 0（合并结果由旧默认值补上两键） |
| 新构建 | 退 0，`warnings` 恰一条，列出两键 | 退 0，无提示 |

### 4.5 本仓真实配置读数（`real-config-readout.mjs`）

把本仓 `.trivium/config.yaml` 与 `config.local.yaml` 拷进临时 git 仓库，用新构建跑 `doctor --only env --no-model-calls` 与 `preflight --stage all --critics codex,gemini,glm --skip-auth-check`（不在本仓直接跑：doctor 收尾会写用户的 `config.local.yaml`）：

- 删键前（`real-config-before.json`）：doctor 退 0、提示 1 条；preflight 退 0、`ok: true`、「已废弃配置键」1 条，排在「只读能力可用」与「模型 slug 合法」之间；
- 删键后（`real-config-after.json`）：两处都 0 条，其余检查项不变。

两次 preflight 的「当轮 Driver ⚠」来自临时仓库没有 Hook 配置（护栏降级提示），「探活 ⚠」来自 `--skip-auth-check`，都与本主题无关。

## 5. 全量检查与 doctor

| 项 | 读数 |
| :-- | :-- |
| `npm run check` 预跑（去掉 `ref` 字段之前、实施报告之前） | 2487 / 2485 / 0 / 2 |
| `npm run check` 第一次（全部改动与文档之后） | 2487 / 2485 / 0 / 2（`check-1.txt`） |
| `npm run check` 第二次 | 2487 / 2485 / 0 / 2（`check-2.txt`） |
| `doctor --selftest`（工作树构建） | 14 / 14（`doctor-selftest.txt`） |

两次都没有撞上已知偶发红（EV-149 / EV-153）。两行 check 读数是跑完后填的（只改本报告文字）。修订后的读数见 §6。

## 6. 代码双审与修订

代码双审 r1（run `20261001T131816Z`，约 10 分钟）：gemini `approve`（零意见）、codex `approve-with-nits`（次要 2、吹毛求疵 2）、glm `approve-with-nits`（次要 1、吹毛求疵 1）。6 条全接受，应答件 `code/2026-10-01-两个空配置项收口-response-claude.md`，`gate --check` 一次通过。

| 编号 | 修订 |
| :-- | :-- |
| CODEX-01 | 冻结的演进设计 §8.3 段末加「2026-10-01 注」（原句不改；注里一并点名 §0 第 1 点、§8.2 行②、§11 配置示例——意见写的「§5.4 示例」核实在 §11），ADR_002 的 2026-09-15 更正块末加一句；演进设计 §18 待拍板 8 已有就地更正的先例。BACKLOG EV-15 与设计 v1.3.72 变更记录把这两份列入落点 |
| CODEX-02 | 新增 U9：「重跑最多 3 次（首次校验不计」一句在 review 正文（1 处）、`run.contract.md`（S4 / S8 共 2 处）、主设计 §21 之前的正文（7.4 / 8.6 共 2 处）、MANUAL（1 处）各自恰有规定处数；MANUAL 那句的措辞随之统一。渲染产物由 `entry-render-parity` 守 |
| CODEX-03 | BACKLOG EV-15 落地记要、设计 v1.3.72 变更记录补「本仓 `.trivium/config.yaml` 的两键已删（不进送审面，取证见 §4.5）」 |
| CODEX-04 | `acceptance.mjs` 与 `real-config-readout.mjs` 加记 doctor notes 里的「编排器构建标识」；`real-config-readout.mjs` 的「删键前」改为从 `git show 9cc9249:` 取本仓 `config.yaml`，两份读数重跑（`.r1`） |
| GLM-01 | §5 表格中间那句挪到表格之后 |
| GLM-02 | 维持「预检前面失败时不出」（与 ④′～④‴ 同一短路）：`preflight.ts` 文档块与 ④⁗ 注释写明取舍、以 doctor 为兜底；§7 加一条 |

修订后读数（首轮读数原样保留，修订后的加 `.r1`）：

| 项 | 读数 |
| :-- | :-- |
| 相关 6 个套件（`config-consumers` / `config-schema` / `preflight` / `entry-render-parity` / `known-forms-parity` / `facade-version-pointers`） | 139 / 139 |
| 源码变异：规格 / 逐条预跑 / 正式装置 | `mutation-spec.r1.json` 与首轮逐字节相同；10 / 10 全红、无超时（`mutation-names-log.r1.txt`）；**10 / 10 咬住**（`mutation-output.r1.txt`） |
| schema 与文档契约变异 | **9 / 9 咬住**（`contract-mutations-output.r1.txt`；新增 K8 review 正文的 3 改 5、K9 S8 漏写上限，都红在 U9） |
| 兼容验收 | 4 / 4（`acceptance-output.r1.txt` / `acceptance-readout.r1.json`）。新构建标识 `9cc9249（构建时作用面有未提交改动），inputs d899b202632b`；旧构建的标识为「缺失」——归档目录没有 `.git`，构建取不到 git 信息，旧构建仍由归档提交 `9cc9249` 与 bundle 哈希钉住 |
| 真实配置读数 | 删键前（`git show 9cc9249:` 取配置）提示 1 / 1，删键后 0 / 0（`real-config-before.r1.json` / `real-config-after.r1.json`），构建标识同上 |
| `npm run check` 第一次 / 第二次 | 2488 / 2486 / 0 / 2 两次（`check-1.r1.txt` / `check-2.r1.txt`；比修订前多 U9 一条；都没有撞上已知偶发红） |
| `doctor --selftest` | 14 / 14（`doctor-selftest.r1.txt`） |

这两行读数是跑完后填的（只改本报告文字）。

## 7. 暂缓与已知缺口

- **EV-184**：为 codex 接命令前缀禁止规则——等触发（EV-16 被推翻、codex 侧出现经命令通道的越界读、或 codex 升级后 execpolicy 形态变化）。附带待议：被审仓库自带的项目级 `.rules` 按帮助文字推断会被现配方加载（未实测）。
- **EV-30 ②～⑦** 仍 todo（`parallel` / `deny_via_cli` / `forbid_chars` / `require_adjudication` / `max_turns` / `unsupported_override`）。
- **预检前面有失败项时不出提示**（代码双审 r1 GLM-02，有意为之）：与 ④′～④‴ 同一短路；doctor 在环境段无条件提示，是兜底出口。
- **提示不指认来源文件**：合并结果分不出 `config.yaml` 与 `config.local.yaml`，正文两个都点名（r2 §8 R3）。
- **claude 当审核者时的命令执行面**不在本主题。

## 8. verify

`trivium verify --topic 两个空配置项收口`（run `20261001T134630Z`）：`npm run typecheck` ✓ 1.6 s、`npm run build` ✓ 1.1 s、`npm test` ✓ 268.9 s，**通过**；留痕 `.reviews/两个空配置项收口/verify/`。verify 跑的是 `.trivium/config.yaml` 里配置的命令，测试对象是工作树（与已安装副本无关）。本节是 verify 之后补写的（只改本报告文字，不涉代码与测试）。

**src 已改**：提交后需从已提交状态重建（`npm run build`），再请用户在终端重装（`node dist/install.cjs --targets claude,glm,codex,gemini`）；在那之前 `.trivium/bin/trivium` 用的仍是旧副本——旧副本读删过键的本仓配置照常通过（§4.4 旧构建 × 不带两键）。
