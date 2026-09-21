---
schema: trivium.disposition.v1
topic: zcode-provider配置注入
stage: code
role: claude
kind: response
run_id: 20260921T080553Z
addresses:
  - 2026-09-21-zcode-provider配置注入-r3-codex.md
  - 2026-09-21-zcode-provider配置注入-r3-gemini.md
---

# 应答与修改方案（第 3 轮）：zcode-provider配置注入

两侧结论：gemini `approve-with-nits`（0 blocker / 0 major / 1 minor / 2 nit）、
codex **解析降级**（`parse_fallback: true`，本侧不参与阻断判定；原文自述 `approve-with-nits`，
内含 5 条具名意见）。闸门要求裁决的编号 4 个：`AGY-01` / `AGY-02` / `AGY-03` /
`CODEX-F01`（降级侧整份原文编为一个待裁决单元，5 条子项在 §二 逐条给出结论）。
**接受 4，驳回 0，暂缓 0。**

本轮最重的一条不是任何代码缺陷，而是 **CODEX-F01-05 指出的留痕缺口**：
`.trivium/config.yaml` 的 codex 档位改动**不在任何一轮被审补丁里**（`code-stage.ts` 的
`diffExcludePrefixes` 硬排除 `.trivium`），而设计与 BACKLOG 里已有依赖它的断言。
我在启动本轮前对用户说过「`.trivium/**` 在 `never_skip_globs` 里，所以这次配置改动会进 r3 的送审补丁」——
**这句是错的**：`never_skip_globs` 管的是「纯文档跳过」的豁免，与补丁生成面的硬排除是两件事。
补登见 §三。

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | minor | 接受 | 属实：`availability()` 新增的 `provider_config?.builtin_file === null` 分支及其「先于旗标判空」的优先级，在 `test/unit/zcode-availability.test.ts` 里没有守卫——该文件现有 4 条用例只覆盖 `probed_at` / `entrypoint` / `--disallowed-tools`。这一支的全部价值就在**顺序**上（乱序即回到「请升级 ZCode」的误导文案），而顺序恰恰是重构时最容易被静默改掉、且类型系统与既有用例都拦不住的东西。 | §2.1 |
| AGY-02 | gemini | nit | 接受 | 属实：用例标题仍写「（不看退出码）」，而 §2.8 之后判定已收进 `r.code !== 0`。标题是读者最先看到的断言，与相邻那条 exit 0 负例直接打架。 | §2.2 |
| AGY-03 | gemini | nit | 接受 | 属实：`doctor.ts:512` 已直接消费 `ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT`，共 4 个消费点，而 `adapters/zcode.ts:76` 的常量注释与设计 §11.3（2414 行）仍写「三处」。**意见里的位置清单有一处不准**：设计 §3.3（249 行）并无「三处同源」表述，无需改；这不影响结论，按 2 处落点执行。 | §2.3 |
| CODEX-F01 | codex（降级） | minor | 接受 | 5 条子项全部成立，逐条核实见 §二；其中 CODEX-F01-02 与 -05 挖到的是我自己留下的两处失真（一条假阴性用例、一处补丁外改动无留痕），不是风格问题。**该侧虽按契约不参与阻断判定，意见仍逐条裁决、不因降级而降权**——r2 对被作废的 codex 侧也是同一口径。 | §2.4～§2.8、§三 |

**统计**：接受 4 ｜ 驳回 0 ｜ 暂缓 0（降级单元 `CODEX-F01` 的 5 条子项：接受 5）。

---

## 二、修改方案

### 2.1 补 `availability()` 新分支与顺序的守卫（AGY-01）

`test/unit/zcode-availability.test.ts` 增 2 条：
① `provider_config.builtin_file === null` → 返回 `ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT`；
② 该格为 null **且** `readonly_flags` 为空时，返回的仍是布局提示而**不是**旗标提示（锁顺序）。
再补 1 条反向守卫：`provider_config` 缺格（旧结论文件，值为 `undefined`）时**不**走这一支——
严格 `=== null` 的兼容性也要有例。

### 2.2 改准用例标题（AGY-02）

`test/unit/zcode-provider-env.test.ts:207` 标题里的「（不看退出码）」改为「（退出码非 0 且 stderr 命中）」。

### 2.3 「三处同源」→「四处同源」（AGY-03）

`adapters/zcode.ts:76` 常量注释与设计 §11.3（2414 行）各补上 `doctor` 的 blocker 这一消费点。
§3.3 无此表述，不动。

### 2.4 version 探针也清底色（CODEX-F01-01，minor·correctness）

**属实**：`probeZcodeEntry` 的 `run(node, [entry, 'version'], { timeoutMs: 60_000 })` 不传 `env`，
而 `exec.run` 以 `{...process.env}` 为底 ⇒ 宿主预置的两个变量原样透传。现势无害（P-28 实测
version 不读 provider 配置），但 `zcodeProviderEnv` 的判据自述是「子进程拿不到」，这条路径不满足。
取意见给的**第一支**：该 `run()` 显式传 `{ [ZCODE_BUILTIN_PROVIDER_ENV]: undefined, [ZCODE_PERSONAL_PROVIDER_ENV]: undefined }`。
**只清不派生**——不调 `zcodeProviderEnv`：此处是逐候选路径试探，派生要多做文件存在性判断，
而 version 本就不需要这两个变量。注释写明「清而不给」的理由与 P-28 依据。

### 2.5 `invokeZcode` 开 `userHome` 注入口，堵上假阴性用例（CODEX-F01-02，minor·test-gap）

**属实，且是本轮最实的一条**：`invokeZcode` 调 `zcodeProviderEnv(opts.entry)` 用的是默认
`os.homedir()`，而本机 `~/.zcode/v2/provider_config.json` **真实存在**。于是「宿主环境预置了同名变量 →
子进程必须拿不到」那条用例里，个人键拿到的是**真实路径**（被覆盖，不是被删），断言之所以通过
只因内置缺失那一支主导了 `failureKind`——用例自称锁「子进程拿不到」，实际只锁住了内置那一半。
落点：`ZcodeInvokeOptions` 增可选 `userHome?: string`，透传给 `zcodeProviderEnv`；
用例改传 `L.userHome`，并把「个人键必须被删」升级成**直接断言**（假入口已回显 `personal`）。

### 2.6 空集双义在「新结论 + 本轮未判定」角落仍成立（CODEX-F01-03，minor·contract）

**属实**：无 `existing` 时 `readonly_flags` 初值是 `[]`，本轮未判定又不覆写，于是落盘的空集
仍带着「没判过」的含义；`doctor` 因 `flagsIndeterminate > 0` 不拦（设计如此），而 `availability()`
读不到「本轮未判定」这个事实，照旧报「无可用只读旗标、请升级 ZCode」——§2.2 要消灭的误导文案
从 doctor 挪到了 preflight。触发形态是「派生文件在场但 CLI 仍报无法定位」（如下一次候选布局漂移）。
落点两处（意见给的两个方向都取，它们补的是不同缺口）：
① `doctor` 在 `flagsIndeterminate.length > 0` 时除 note 外再记一条 `warn`——现在只有 note，读的人会划过；
② `availability()` 旗标判空的文案补一句「若 doctor notes 记了『本轮未判定』，先重跑 doctor 而不是升级 ZCode」。
**不**把 `flagsIndeterminate` 落盘：它是「本次探测过程」的事实，落盘就会过期，这条在 r2 §六 已论证过。

### 2.7 `indeterminate` 判据补退出码门控 + `killTree`（CODEX-F01-04，nit·maintainability）

**属实，两点都收**：① 同一个名词正则在 `invokeZcode` 收了退出码门控、在 `probeReadonlyFlags`
没收，口径分叉；虽然当前方向保守（只漏判不误放），但假入口的 `FAKE_ZCODE_NOISY_OK` 模拟的正是
会打穿它的那种日志形态。加 `r.code !== 0` 前置。
② 该 `run()` 没开 `killTree`，而 P-30 实测该 CLI 能在 turn 里 3 分钟不退——第三态前提一旦被破，
七次真实调用超时后孙进程会被遗弃继续烧配额。补 `killTree: true`。

### 2.8 config.yaml 档位改动补登留痕（CODEX-F01-05，nit·scope-drift）

**属实**，见 §三。同时在设计 v1.3.31 行内注明该调整走补丁外通道。

---

## 三、审查看不见的合法改动（§9.2）

`.trivium/config.yaml` 命中 `code-stage.ts` 的 `diffExcludePrefixes`（硬排除 `.trivium`），
**不进入任何一轮被审补丁**。它是进 Git 的团队共享文件，本轮改动全文如下（2026-09-21，用户指定）：

```diff
   codex:
     vendor: openai
     bin: null
-    profile: deepseek
+    # 2026-09-21：deepseek → qwen（用户指定）。这一行决定 provider 家族与模型目录，
+    # 必须与 profiles.*.codex 的 slug 同家族，否则端点直接拒绝。
+    profile: qwen

 profiles.default.codex:
-      plan/code/bug: deepseek-flash
+      plan/code/bug: qwen3.8-flash

 profiles.flash.codex:
-      plan/code/bug: deepseek-flash
+      plan/code/bug: qwen3.8-flash
```

两条注释块同步改写（记录「不是 max」的依据：2026-09-16 实测 qwen3.8-max 在 effort=high 下
撞满 plan 阶段 1500s 预算、零产出；以及 flash 档与 default 同值是结果不是漏改）。

**两维度一致性依据**：`agents.codex.profile: qwen` 与三槽 `qwen3.8-flash` 同家族；
探针 `models_by_profile.qwen` 含 `qwen3.8-flash`，`providers[profile=qwen].credentialed: true`；
本轮 `preflight --stage code` 的「模型 slug 合法」通过，`review --start` 回读
`models.codex = qwen3.8-flash`，本审查件 front-matter 的 `model_effective` 亦为 `qwen3.8-flash`
（`model_effective_source: trace`）——即**本轮审查自己就是该配置的运行证据**。

**残留风险（已向用户播报，用户裁定不动预算）**：2026-09-18 从 qwen 换去 deepseek 的原因正是
codex 侧当时跑 `qwen3.8-flash` 在 M9 代码双审第 4 轮用了 118m53s，离 `timeout_s.code` 的 7200s
只剩 66 秒。本轮 14m57s 交卷，未复现。

**提交时**：该文件随本主题同一个 commit 入场，提交说明里点名它。

---

## 四、执行顺序

用户 `/dual-approve` 之后：按 §2.1～§2.8 修 → `npm run check` → `install:local` →
第 4 轮代码双审（仍 `--critics codex,gemini`，理由不变：glm 适配层是被审对象，且 EV-82 未结案前
它不构成独立一侧）→ 用户审批 → 提交。

**codex 侧解析降级需要单独看一眼**：`qwen3.8-flash` 是本仓第一次用这一档，第一份数据就是
`parse_fallback`（14m57s，输出是合法 JSON 但外层裹了 ```json 围栏）。若 r4 复现，它就不是偶发，
要么调该侧提示词的输出约束，要么换档——本轮不处置，先留一条观察记录。

---

## 五、实施记录（2026-09-21，用户审批通过后执行）

§2.1～§2.8 **已全部实施**。`npm run check` 1512 tests / 1510 pass / 2 skipped / 0 fail（较送审时 +3 条）；
全局副本已刷新；`doctor --only zcode --no-model-calls` 零配额复验退 0、0 blocker。
留痕见 `doc/05_testing/evidence/zcode-provider-config-20260920/r3-implementation-doctor-20260921.md`。

**一处实施时的判断，交 r4 裁决**：§2.6 ① 要求 doctor「除 note 外再记一条 warn」，而 `DoctorReport`
原本只有 `notes` / `blockers` 两档，没有告警通道。落地方式是**给结构加第三档 `warnings`**
（doctor.ts 的接口与构造、`renderDoctorReport` 的渲染、cli.ts 的 JSON 输出各改一处），
退出码仍只由 `blockers` 决定。比起「把 note 写得更醒目」，加档的理由是这类事实会再出现：
「既不该拦人、又不该被划过」是一类，不是一条。

**另有两处措辞收窄，记在这里以免被当成漏改**：
- §2.4 取的是意见给的第一支（显式清两个键），**没有**调 `zcodeProviderEnv`——那条路径是逐候选试探，
  派生要多做存在性判断，而 version 本就不需要这两个变量。注释里写了依据。
- §2.6 ② 的文案只补「先重跑 doctor 并核对安装布局，而不是升级 ZCode」，**没有**把「本轮未判定」
  做成 `availability()` 能读到的状态——那要求把探测过程的事实落盘，与 r2 §六 的论证冲突。
