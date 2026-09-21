---
schema: trivium.disposition.v1
topic: zcode-provider配置注入
stage: code
role: claude
kind: response
run_id: 20260920T083936Z
addresses:
  - 2026-09-20-zcode-provider配置注入-r2-codex.md
  - 2026-09-20-zcode-provider配置注入-r2-gemini.md
---

# 应答与修改方案（第 2 轮）：zcode-provider配置注入

> **⚠️ 本轮裁决期间发生严重事故（2026-09-20 16:49～16:57）。** 为验证 CODEX-05，我在会话临时目录写了一个
> 实验脚本复用 `prepareZcodeHome` / `scrubZcodeHome`；其 `--global-home` 分支把「副本 HOME」变量赋成了
> **真实用户目录**，脚本末尾照常调用 `scrubZcodeHome(真实 HOME)`，该函数按设计对二进制文件与含密钥文本
> **命中即删**。它在 `/Users/chenzhenbo` 下运行约 8 分钟后被我 kill。已确认删除 `~/.zcode/cli/config.json`；
> `~/Library`、`~/Work`（含 git 对象库，本仓 `bad object HEAD`）、`~/Movies`、`~/Pictures`、`~/百度网盘同步`、
> `~/重要备份`、`~/ObsidianVault` 等目录下有大量文件被删，清单不可得。**本裁决件在事故之后写成，只为满足闸门
> 契约；下文任何「落点」都不应在数据恢复完成之前执行。** 事故经过已写入我的记忆，禁止实验脚本调用清扫类助手。

两侧结论：codex `request-changes`（**本侧结论已按措施 b 作废**：命令文本里 `cat` 了运行目录下的
`status.json` / `request.json`，虽路径不存在、按「提到即作废」处置；意见仍逐条裁决，但不计独立来源）、
gemini `request-changes`。闸门要求裁决的编号 13 个。**接受 13，驳回 0，暂缓 0。**

本轮最重的不是任何一条书面意见，而是 CODEX-05 提出的那个问题被我的实验证实了（见 §三）：
**0.16.9 下 `config_copy` 的模型覆盖已不生效**——glm 侧即便探活通过，审查会静默跑在别的模型上。
这条修法只解了「起不来」，没解「起来了但不是 GLM」。

## 一、裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 属实：`run()` 以 `{...process.env}` 为底再覆盖，只有值为 `undefined` 才删；`zcodeProviderEnv` 与 `probeReadonlyFlags` 都只追加、从不清除，宿主环境里预置的 `ZCODE_PERSONAL_PROVIDER_CONFIG_FILE` 会原样透传进空 HOME 的旗标探针，P-30 那七次真实调用照样发生。用例 `personal === null` 的断言只在测试进程本来没有该变量时成立，锁的是「没主动注入」不是「子进程拿不到」。 | §2.1 |
| AGY-02 | gemini | major | 接受 | 与 CODEX-01 同一缺口、同一修法（显式 `[ZCODE_PERSONAL_PROVIDER_ENV]: undefined`）。 | §2.1 |
| CODEX-02 | codex | major | 接受 | 属实：`probe.readonly_flags = flags.accepted` 无条件赋值，全 indeterminate 时写成 `[]`，与上一行注释「不写入」自相矛盾；`availability()` 第一支判空，把布局问题报成「无可用只读旗标、请升级 ZCode」，且抹掉上一轮有效结论。空集在本仓已有「双义」教训（`types.ts` 明写）。 | §2.2 |
| CODEX-05 | codex | major | 接受 | **实验证实且比意见更糟**（§三）：`config_copy` 副本 HOME + 两个变量，副本 `model.main` 写 `bigmodel-coding-plan/GLM-5.3-Flash`，日志与 rollout 回读到的生效模型是 `<providerUUID>/qwen3.8-max`（个人 provider 配置的默认模型，且与 codex 侧同家族）；只给内置变量时回读到 `bigmodel-coding-plan/GLM-5.3`——**两种形态都不是请求的模型**。AC-13「生效模型回读」会如实记下差异，但模型路由与异构默认（FR-06 / NFR-06）在 glm 侧已失效。另一点也成立：本机两份文件都在、全局副本已含新代码，「glm 正是坏着的那侧」这句在双审启动时刻已不准确，准确理由是「被审对象正是 glm 适配层，不能用待审代码审自己」。 | §2.5、§三、EV-82 |
| CODEX-03 | codex | minor | 接受 | 属实：`os.homedir()` 读 `$HOME`，编排器若在被重定向 HOME 的会话里发出命令，个人配置会在错误目录下找、门控静默不给、CLI 换个面目报错。**落点分两截**：探针 note 写出本次按哪个用户目录取（立即可做）；`os.userInfo().homedir` 切换**不在本轮做**——同一假设遍布 `prepareZcodeHome` / `authProbe.fingerprint` / `probeZcodeModels`（`~/.zcode/cli/config.json` 同样按 `os.homedir()`），只改一处会让「个人配置按真实目录、CLI 配置按 $HOME」两套口径并行；登记 EV-83，触发条件是 M10 真载体（别家在自己 CLI 里当 Driver）。 | §2.6、EV-83 |
| CODEX-04 | codex | minor | 接受 | 属实：`path.dirname(entry)` 不解软链、不要求绝对路径；相对入口经 `path.resolve` 落到 cwd。两侧独立指出（≡ AGY-03）。 | §2.3 |
| AGY-03 | gemini | minor | 接受 | ≡ CODEX-04。 | §2.3 |
| CODEX-06 | codex | minor | 接受 | 属实：新加的引导挂在 `response_field === null` 上，而回归形态下探针 `failureKind !== 'none'` 时只 push note 就 return、`response_field` 保留旧值 `'response'`，全量 doctor 退 0、blockers 为空——这句提示在最该出现的路径上不可达。 | §2.4 |
| AGY-05 | gemini | minor | 接受 | 与 CODEX-06 同源：`--no-model-calls` 下该分支被整体跳过，内置文件缺失 + 旗标全 indeterminate 时 doctor 0 blocker 通过，RUNBOOK 恰恰建议用这条命令排障。 | §2.4 |
| AGY-04 | gemini | minor | 接受 | 属实：`availability()` 在 `response_field === null` 仍写死「请确认 ~/.zcode/cli/config.json 存在」；`critic.run()` 的 `hint` 对 `provider_config_unresolved` 无分支，落到 `stderr.slice(0,300)`。三处文案要同源。 | §2.2、§2.7 |
| AGY-01 | gemini | major | 接受 | 有效：正则裸匹配 + 不看退出码，正常退 0 时 stderr 若出现该名词（诊断行）会被判成布局失败。**采纳退出码门控**（实测该形态退 1，与文档一致）并补 exit 0 负例；**正则不按建议加错误动词**——英文措辞是猜的（本机只见中文前缀），在退出码门控之后再收紧正则收益为零、误杀风险为正。在 `r.code !== 0` 分支内仍先于 `model_config_missing` 判。 | §2.8 |
| CODEX-07 | codex | nit | 接受 | 属实：`.env.example` 命中 `review.sensitive_globs` 的 `.env*`，按 FR-23 被排除在送审补丁之外，而变更记录声称改了它。它是「归档根外、审查看不见的合法改动」，按 §9.2 口径由 Driver 在应答件显式列出——见 §四（纯注释改动，逐行贴出）；变更记录补一句「该文件因 sensitive_globs 不进审查补丁」。 | §2.9、§四 |
| AGY-06 | gemini | nit | 接受 | 属实：`preflight.ts` 不直接读 `provider_config`，失败详情来自 `authProbe()` 运行时返回。§2.2 落地后 `availability()` 会读 `builtin_file`，preflight 经它间接消费；注释与设计 §3.5 按此改准：「doctor notes 直接读；preflight 经 `availability()` 读 `builtin_file` 判可用性；探活详情由 `authProbe` 动态生成」。 | §2.10 |

**统计**：接受 13 ｜ 驳回 0 ｜ 暂缓 0。

---

## 二、修改方案（**数据恢复完成前不执行**）

### 2.1 清除再注入（CODEX-01 / AGY-02）

`zcodeProviderEnv` 返回值改为**先置两键为 `undefined`**再按存在性赋值，类型放宽为 `Record<string, string | undefined>`；
`probeReadonlyFlags` 的 env 显式含 `[ZCODE_PERSONAL_PROVIDER_ENV]: undefined`。用例：测试进程 `process.env` 预置两个诱饵路径，
断言七次调用日志里 `personal === null`、`builtin` 等于派生路径而非诱饵。

### 2.2 第三态落进结论、可用性判据改序（CODEX-02 / AGY-04 前半）

`probeZcode`：`flags.indeterminate.length > 0` 时**不覆盖** `readonly_flags`（保留旧值），note 写明「本轮未判定」。
`availability()`：在 `entrypoint` 判定之后、`readonly_flags` 判空之前，加 `p.provider_config?.builtin_file === null` →
「CLI 未定位到内置 provider 配置（P-28）……核对 ZCode 安装布局」；`response_field === null` 那支文案与 doctor 同源。

### 2.3 入口先 realpath（CODEX-04 / AGY-03）

`zcodeProviderConfigPaths` 改 async：`entry` 先 `path.resolve`，再 `fs.realpath`（ENOENT 回落原路径），再 `dirname`。
用例：软链入口指向假应用包布局，派生路径落在真实布局上。

### 2.4 doctor blocker 不再借道 `response_field`（CODEX-06 / AGY-05）

`doctor.ts`：`r.probe.entrypoint && r.probe.provider_config?.builtin_file === null` → 无条件 blocker（不受 `skipModelCalls` 影响）；
旗标判定完成（`indeterminate` 为空）且 `readonly_flags` 为空 → blocker。

### 2.5 变更记录与 EV-81 的表述改准（CODEX-05 文档面）

「只能 codex + gemini 两侧（glm 正是坏着的那侧）」→「glm 适配层是被审对象，不以待审代码审自己」；
EV-81 加「达成边界：0.16.9 下 `config_copy` 模型覆盖不生效，见 EV-82」。**在 EV-82 解决前，glm 侧不应作为审核者启用**——
它会以与 codex 同家族的 qwen 模型冒充 GLM 一侧。

### 2.6 探针 note 写出用户目录（CODEX-03）

`provider_config` note 追加「用户目录取 `<os.homedir()>`」。切换 `os.userInfo().homedir` 登记 EV-83。

### 2.7 `critic.run()` 提示分支（AGY-04 后半）

`hint` 增 `provider_config_unresolved` → 与 `authProbe` 同一段文案。

### 2.8 退出码门控（AGY-01）

`if (r.code !== 0) { if (UNRESOLVED_RE.test(stderr)) … else if (/Model config is missing/) … }`；用例：exit 0 + stderr 含该名词 → `none`。

### 2.9 变更记录补一句（CODEX-07）

v1.3.31 行内「`.env.example`（……）」后补「该文件命中 `sensitive_globs` 不进审查补丁，改动全文见应答件 §四」。

### 2.10 注释与 §3.5 的消费方改准（AGY-06）

见裁决表理由中的三句。

---

## 三、CODEX-05 实验记录（2026-09-20，dist 编译产物直调 `prepareZcodeHome` + `run()`，请求模型 `bigmodel-coding-plan/GLM-5.3-Flash`）

| # | 形态 | 结果 |
| :--- | :--- | :--- |
| E0 | `config_copy` 副本 HOME + 两个变量（与真实审查一致） | 退 0，响应 `OK`，9s；日志与 rollout 回读生效模型 **`84044858-…/qwen3.8-max`**（个人 provider 配置默认模型） |
| E1 | `config_copy` 副本 HOME + 只给内置变量 | 退 0，响应 `OK`，7s，stderr `ZCode Built-in missing`；回读 **`bigmodel-coding-plan/GLM-5.3`**（不是请求的 Flash） |
| E3 | 真实 HOME + 两个变量（即 `authProbe` 的形态） | 退 0，响应 `OK`，8s；回读**未完成**——脚本在收尾时被我 kill（见文首事故说明） |

CLI 包内字面：`defaultModelSelection` 由 `personalRepository` 读取，`model.main` 无配置读取点。
结论：0.16.9 的模型选择已迁到个人 provider 配置，`cli/config.json` 副本的 `model.main` 不再是模型覆盖的落点；
`bigmodel-coding-plan/…` 形态的模型 id 与 `<providerUUID>/…` 形态并存。**修法方向待独立主题（EV-82）**——
任何可行方案都要触碰含凭据的个人 provider 配置副本，须先过计划双审。

---

## 四、审查看不见的合法改动（§9.2）

`.env.example` 命中 `sensitive_globs`（`.env*`）被排除在补丁外。本轮对它的全部改动（纯注释）：

```diff
-#    模型覆盖改由编排器写入一份**独立配置副本**并以 ZCODE_HOME 指向它实现
-#    （设计冲突项 C-07 / C-08，见 doc/05_testing/REPORT_2026-09-11_m0_probe.md）。
+#    模型覆盖改由编排器写入一份**独立配置副本**并以独立 HOME 指向它实现
+#    （ZCODE_HOME 对配置解析无效——设计冲突项 C-07 / C-08，见 doc/05_testing/REPORT_2026-09-11_m0_probe.md）。
+# ⚠️ ZCODE_BUILTIN_PROVIDER_CONFIG_FILE / ZCODE_PERSONAL_PROVIDER_CONFIG_FILE 不要写进本文件。
+#    0.16.9 起独立拉起 zcode.cjs 需要这两个变量定位 provider 配置（坑 P-28），
+#    编排器在拉起时按 ZCode 安装布局与真实用户目录派生并注入，文件在才给。
```

归档根内的合法修改：本文件；`.reviews/zcode-provider配置注入/plan/2026-09-20-zcode-provider配置注入-claude.md`（留痕，未跑计划审）；
`.reviews/M10-任意Driver/plan/2026-09-20-M10-任意Driver-claude.md` 的 F-8 / P-4 行末更新（该更新中「已落地」一句在 EV-82 面前不成立，待改）。

## 五、执行顺序

**0. 数据恢复优先，本主题所有代码动作暂停。** 恢复后：本仓从远端重 clone → 把工作树改动搬回 → 按 §2.1～§2.10 修 →
`npm run check` → `install:local` → 第 3 轮代码双审（仍 `--critics codex,gemini`）→ 用户审批 → 提交。
EV-82（0.16.9 模型覆盖）另开主题，先计划审。

---

## 六、实施记录（2026-09-21，用户放行后执行）

§2.1～§2.10 十条落点**已全部实施**，`npm run check` 通过（1509 tests / 1507 pass / 2 skipped / 0 fail；
用例由 10 条增至 14 条）。工作树未重 clone——本仓 git 对象库经检查完好，改动就地续做。
`node_modules/typescript` 被事故清扫删掉两个大文件（`_tsc.js` / `typescript.js`），`npm ci` 重装后恢复。

**三处超出裁决表字面的附带处理**，一并交 r3 裁决：

1. `probeZcode` 新增返回项 `flagsIndeterminate: string[]`（不落盘）。§2.4 要求 doctor「旗标判定完成且
   `readonly_flags` 为空」才拦，而 §2.2 之后 `readonly_flags` 为空有两种成因（判过、一个都不接受 ／ 本轮未判、
   保留的旧值恰好为空），结论文件区分不了，只能由探针把「本次探测过程」的事实回传。
2. `probeZcode` 里给真实模型探针拼 argv 的来源，由 `flags.accepted` 改成 `probe.readonly_flags`。
   §2.2 保留旧值之后，未判定那一支上 `flags.accepted` 是空数组——拿它去跑真实模型调用等于不带任何只读参数拉起 CLI。
   两者在正常路径上取值相同。
3. 事实登记：M0 报告 §7 增 **P-31**（0.16.9 模型覆盖失效，即 EV-82 的事实面），并改正 P-28 对策里
   「不依赖退出码」一句（§2.8 之后已不成立）；BACKLOG 增 **EV-82**（待计划双审）与 **EV-83**（`os.homedir()` 口径，
   CODEX-03 后半）；RUNBOOK 故障表增一行「glm 起得来但生效模型不对」。

**EV-82 的修法本轮不做**，只登记与止损：设计 §3.3 增「达成边界」段、M10 计划原稿 F-8 行末「已落地」改为
「只解了起不起得来，待 EV-82」。r3 仍用 `--critics codex,gemini`——理由现在有两条：glm 适配层是被审对象，
且 EV-82 未结案前它不构成独立的一侧。
