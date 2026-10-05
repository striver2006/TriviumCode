# 命令 B/C/D 先解析后预检 · 实施报告（EV-126）

> - **日期**：2026-10-06
> - **主题**：`命令 B/C/D 先解析后预检`（M11 前待办批次第 5 题；**本批未走双审**，用户以 `/goal` 授权直接开发，提交前由执笔方自审补丁）
> - **起点**：`be25117`（`main`；工作树另有用户自己的改动 `.trivium/config.yaml`、`doc/01_requirements/原始需求.txt`，不随本题提交）
> - **证据目录**：`doc/05_testing/evidence/bcd-preflight-order-20261006/`
> - **配额**：零配额

## 0. 动手前：现状、修法与边界

### 现状（已核）

1. 命令 B / C / D 三份契约（`skills-src/commands/review-{plan,code,bug}.contract.md`）共用 `skills-src/partials/review/body.md`：第 1 步「预检」`TV preflight --stage {{STAGE}} --driver {{DRIVER}} --json`，不带 `--critics` / `--profile` / `--model-*`；第 2 步才 `topic resolve`；第 3 步 `review --start` 无条件传 resolve 输出的 `critics`。
2. `cli.ts` `cmdPreflight` 本就接受 `--critics` / `--only` / `--profile` / `--model-*`（经 `resolveCriticSelection` 与 `assertModelOverrideKeys`，与 `topic resolve`、`review --start` 同一处判定）；`PROTOCOL_dual_critic_relay.md` :408 也已写明「`--critics` 指定本次要用哪几侧——只读能力、模型 slug、探活都只查这几侧」。所以第 1 步不带 `--critics` 时，用户显式加进来的一侧不被探活（未登录要到拉起后才失败）——BACKLOG EV-126。
3. 命令 A 已在 EV-125 改成「S0.5 解析 → S0.6 预检（带 `critics` / `profile` / `models`）」，`entry-render-parity.test.ts`「命令 A 先解析、后预检…（EV-125 D2）」钉住；B / C / D 维持原次序，主设计 §7（:1382）写明「与 B / C / D『先预检后解析』的次序不同」。
4. body.md 里依赖步号的句子：「第 3 步的 `--start` 会退 64」（:33）、「不涉及第 2 步那套拼串规则」（:82）、「独立的 `preflight` 看不到步骤 3 才传来的覆盖值」（:109～110）、「第 1 步的预检按缺省选侧查，可能没说到这一侧」（:128）；三份契约头 `@QUOTE_RULE_AT: 第 2 步`（拼串规则所在的那一步）；`claim.file.md`「再进第 1 步」。

### 修法

1. body.md 步序改为：**1. 解析主题与被审对象**（原第 2 步原文搬上来）→ **2. 预检（在解析之后）**：`TV preflight --stage {{STAGE}} --driver {{DRIVER}} --critics <critics> [--profile <名称>] [--model-<审核者 id> <模型> …] --json`，三样取自第 1 步 resolve 的输出、与第 3 步传的是同一组 → **3. 启动双审并等待**（不动）。
2. 步号引用随之改：拼串规则在「第 1 步」（三份契约的 `@QUOTE_RULE_AT` 同改）；「独立的 preflight 看不到覆盖值」改为「第 2 步预检拿同一组覆盖值做校验，真正生效在这一步」；`--start` 返回 `warnings` 那句改为「第 2 步已按本轮入选侧查过，这里是拉起前的复查」。`claim.file.md` 的「再进第 1 步」语义不变（认领之后进解析）。
3. 契约用例：`entry-render-parity.test.ts` 仿 EV-125 D2 加一格「命令 B/C/D 先解析、后预检，预检带 `--critics`」。
4. 重渲染 `skills/`（`node scripts/build.mjs --render-only`），主设计 §7 那句改为四条命令同序。

### 不改的边界

- 不改 CLI：`preflight`、`topic resolve`、`review --start` 的行为与输出一字不动；`--driver` 注入次数不变（`DRIVER_CALLS` 不改）。
- 命令 A 的契约不动；第 3 步正文除上面那两句外不动。

## 1. 改了什么

1. `skills-src/partials/review/body.md`：原第 1 步「预检」整段删去，原第 2 步「解析主题与被审对象」升为第 1 步（正文不动），第 3 步之前新增「### 2. 预检（在解析之后）」（命令行、三样取值规则、为什么要带 `--critics`、失败零工件、`warnings` 转述）；「不涉及第 2 步那套拼串规则」改「第 1 步」；「独立的 `preflight` 看不到步骤 3 才传来的覆盖值」改为「第 2 步的预检只拿同一组覆盖值做校验，`--start` 不会沿用它（`--start` 自己再校验一次 slug）」；`--start` 返回 `warnings` 那句的括注改为「第 2 步的预检已按同一组查过，两步之间配置或探活结论可能变」。
2. `skills-src/commands/review-{plan,code,bug}.contract.md`：`@QUOTE_RULE_AT: 第 2 步` → `第 1 步`（参数说明里「沿用下文『第 N 步』一节的拼串写法」指向拼串规则所在的那一步）。
3. `src/trivium/review.ts`：slug 校验文档块里「独立的 `preflight` 命令看不到 skill 步骤 3 才传来的覆盖值」改为如实描述（命令 A S0.6 与 B/C/D 第 2 步会传同一组，但 skill 漏传或终端直跑 `--start` 时预检看不到），纯注释。
4. 重渲染：`skills/dual-review-{plan,code,bug}/SKILL.md` 与 `skills/dual-critic/entry/{codex,gemini,glm}/dual-review-*/SKILL.md` 共 12 份。
5. `test/contract/entry-render-parity.test.ts`：新增「命令 B/C/D 先解析、后预检，预检带上 resolve 解析出的入选集合（EV-126）」——每份渲染产物里解析在预检之前、预检在 `--start` 之前、预检行带 `--critics`、预检命令只有一处。
6. 文档：主设计 7.1 对比句、7.4 示例步序，v1.3.99；BACKLOG EV-126 结案；本报告登记索引。

## 2. 读数

| 项 | 结果 | 证据 |
| :--- | :--- | :--- |
| 类型检查 | 退 0 | 全量内含 |
| 契约两套单跑（`entry-render-parity`、`skill-warnings-relay`，先 `build.mjs --with-tests`） | 29/29（新增 1） | `suite-1.txt` |
| 变异逐条预跑 | M1（预检不带 `--critics`）红 2：新格与「源 → 产物零 diff」；M2（解析前再放一条预检）红 3：新格、零 diff、`--driver` 注入次数。新格在两条下都红 | `mutation-names-log.txt`、`mutation-names-output.json` |
| 变异装置 | 不适用：闸 4 只认 `dist/test` 下的被测产物，`.md` 源没有产物；逐条预跑本身做了备份、变异、重建、跑套件、恢复与逐字节核对 | — |
| 全量第 1 次 `npm run check` | 2846 / 2844 / 0 / 2，退 0（较起点 2845 多新增的 1 格；含「源 → 产物零 diff」） | `check-1.txt` |
| 全量第 2 次（串行） | 2846 / 2844 / 0 / 2，退 0 | `check-2.txt` |
| `doctor --selftest`（仓库 bundle） | 14/14，退 0 | `doctor-selftest.txt` |
| 临时目录新建 | 全量 1、全量 2 期间各 1（均为 `trivium-index-`）、自检期间 0；除 `trivium-index-` 外为 0 | `count-new-*.txt` |

## 3. 提交前自审

- 注释与文档：body.md 新增段的理由句只说「没登录或缺本阶段模型，不带 `--critics` 查不到」，与 PROTOCOL :408 对 `--critics` 的描述一致；`review.ts` 注释的旧前提（预检看不到覆盖值）随本题失效，已订正，没有留下与新步序矛盾的句子（`grep` 过「第 1 步的预检」「看不到」「第 2 步那套」均已无残留）。
- 断言范围：新格只钉 B/C/D；`DRIVER_CALLS` 不变（预检仍各一条 `--driver`），既有格一条未改。
- 护栏：不涉及 `locateSubject` 一类调用点；渲染产物与源零 diff 由既有契约格守着（全量里会过）。
