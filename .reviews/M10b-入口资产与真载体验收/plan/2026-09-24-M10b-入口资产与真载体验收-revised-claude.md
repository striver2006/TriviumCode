---
schema: trivium.disposition.v1
topic: M10b-入口资产与真载体验收
stage: plan
role: claude
kind: revised
run_id: 20260923T232849Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - CODEX-07
  - CODEX-08
  - CODEX-09
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
  - AGY-05
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
---

# 裁决：M10b 入口资产与真载体验收 · 计划双审第 1 轮（审 r3 稿）

> 被审对象：`2026-09-24-M10b-入口资产与真载体验收-r3-claude.md`
> ｜ 运行：`20260923T232849Z`（11m5s）
> ｜ 三侧均为结构化产出，三侧结论均为 `request-changes`
> ｜ 共 18 条：重要 7 ｜ 次要 10 ｜ 吹毛求疵 1 ｜ 零阻断
> ｜ **全部接受**。CODEX-01 核对后只**部分成立**，理由写在表内

## 0. 本轮的形状

**八个焦点，三侧的正面结论**（三侧都逐条对代码核过，不是只看到了符号名）：

- 焦点一：§1.1 六项交付「一致」的结论成立。§1.2 说「`hooks.json` 注释被引反」，这个**方向**成立；但错话实际写在哪里，我找错了（CODEX-05）。
  §1.1 第 4 行有一处符号用错（GLM-03），第 5 行有一处数字不准（CODEX-09）。
- 焦点三：前提链 P-a → C-T3 没有回边（gemini、glm 明确肯定）。J4「只有 run.json 证明不了载体」这个判断成立。
- 焦点四：「只经 shell 写文件，再挂上 `hook-pre-bash`，glm 就写不出自己的原稿」这个推断成立（glm 核了 `hooks.ts` 两侧的判据）。
  但第 3 步的三条通过条件**没有把这一格堵死**：它漏了写工具全集与路径可解析这两层（CODEX-02），也漏了裁决件（AGY-04）。
- 焦点五：「篡改与恢复由用户在终端执行」「对照装置经脚本文件执行」这两条出口，三侧一致判定**不构成绕过判定**。
- 焦点七：§4.7 的期望值三侧都按 `VENDOR_MODEL_FAMILY` / `isHeterogeneous` / `overrideReasonFor` 复算过，**算对了**；
  「名义 Driver 足以端到端验证这两个字段」也成立。

**问题集中在三处**：

1. **EV-82 的失效机理，我照 BACKLOG 抄了，没有对代码核（CODEX-04 ≡ GLM-01，CODEX-06 ≡ AGY-01）**。这是纪律 2 在本稿里的一次失守。
   - 已核：`zcode.ts` 里审查臂**今天就在做模型限定**：`zcodeAdapter.run` 调 `prepareZcodeHome(path.dirname(req.out_dir), req.model)`（约 L828），
     内部经 `qualifyAgainstCliConfig` 限定模型，并在拿到副本 HOME 时传 `omitPersonalProviderConfig: true`（约 L840）。
     BACKLOG 重开段写的「模型限定只作用于探针臂、未覆盖真实审查臂」，**与代码不符**。
   - 判失效的那次运行 `20260921T145353Z`，`snapshot.git_head` = `17f88ac`（**就是结案提交**）、`dirty: true`；
     `started_at` 为 14:53:54Z，比 `17f88ac` 的提交时间（22:43:16 +0800）**晚 10 分钟**。
     当时的全局安装副本是不是新代码，留痕里钉不住。而「不 `install:local` 就验，验的是旧代码」正是本仓已登记的坑。
   - **所以 r3 的 T1 ① 答错了题**：它只要求「diff 触及审查臂的副本 HOME 构造」，但重开的事实恰恰是「那一处已经在、却仍不生效」。
     r4 先把失效链重新落一遍，并排除两个替代假说（陈旧安装副本；两臂副本形状不同 = EV-94 ②），再定 T1。
     T1 从「位置判据」改为「**生效判据**」。
2. **第 3 步的通过条件不可判定（CODEX-02 + AGY-04）**。
   - 已核：`zcode-trace.ts` 的 `ZCODE_WRITE_TOOLS` 共 6 个工具（Write / Edit / MultiEdit / ApplyPatch / NotebookEdit / Bash）；
     现有 matcher 只有 `Edit|Write|NotebookEdit`。
   - `extractTargetPath` 只认 5 个路径键，取不到路径就放行。
   - 所以「被 `hook-pre-write` 覆盖」要拆成两层：名字要全覆盖，路径要能解析。「写路径」的论域也要覆盖到裁决件。
3. **J3 的证据机制缺一个前置（CODEX-03）**。已核：`.gitignore` 同时排除了 `/dist/` 与 `skills/dual-critic/scripts/trivium.cjs`，
   M9 时代的构建产物在仓库里取不到，§7.3.2 必须写明怎么拿到它。

**另有一条 r3 自己漏掉、这一轮我亲身撞上的 §9 依赖形态**（焦点五「有无漏项」，不对应任何意见编号）：

本轮 `review --start` 第一次提交被 Hook 拦下。原因是 `--plan-file` 的值带 `-claude.md`，而我补的 `--context` 清单里有 `src/install.ts`，
其中的 `install` 属于写动词（`WRITE_LIKE` 按词边界匹配）。两个条件在同一条命令里同时成立，于是被拦。
§9 第 6 行只写了 `npm run install:local`，没覆盖「**上下文路径里含写动词文件名**」这一形态。
这一次的处置是从 `--context` 里去掉该项：上下文清单是我自己补的，不是用户的话，焦点保持逐字不变。
r4 §9 增第 16 行：`--context` 里的路径不得含写动词字面；要让审查员看安装器，就写进焦点或任务目标，由审查员自己去读。

**闸门期不改业务文件，也不改 r3 稿。** 下表所有落点都在 `/dual-approve` 之后写进 **r4 稿**（整稿用 Write 写出，§9 第 1 行）。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | **部分成立**，已核 `cli.ts` 与 `driver-claim.ts`。<br>**不成立的一半**：`review --start` 显式传了 `--driver` 时，「显式值优先」（`const driver = explicitDriver ?? resolution.driver`），该阶段没有权威值时 `crossCheckDriver` 直接返回 null、放行，run.json 记的是显式值，不会变回 claude。所以只要渲染层在命令 A 的 code 阶段那次 `--start` 注入了 `--driver`，r3「code 阶段由自己的比对承接」就成立（codex 在「认为正确」段也这么说）。<br>**成立的一半**：旗标缺席、而该阶段又没有权威值时，`resolveStageDriver` 落到 `DEFAULT_DRIVER`，**静默**回落。r3 没把「两处 `--start` 都要注入」写成显式要求，契约测试 ③ 只断言「含且仅含自家 `--driver`」，漏注入一处也照样通过 | r4 §5.3 增一段「命令 A 的 code 阶段」：<br>① 渲染层在命令 A 的**每一处** `topic resolve` / `preflight` / `review --start` 都注入 `--driver`；<br>② 采纳 codex 选项 ①：命令 A 在写代码之前补一次 `topic claim --stage code`，让 code 阶段在 `--start` 之前就有权威值，手工 CLI 漏传旗标时也不回落；<br>③ §5.1 契约测试 ③ 改为**按出现次数**断言：`--driver <自家 id>` 的出现次数等于该命令模板里上述调用的次数。<br>§5.2「code 阶段不需要认领」改为「命令 B/C/D 的 code 阶段不需要；命令 A 的 code 阶段需要，理由见 §5.3」 |
| CODEX-02 | codex | major | 接受 | 核对属实：`ZCODE_WRITE_TOOLS` 有 6 个工具，matcher 只有 3 个名字；`extractTargetPath` 只认 `file_path` / `filePath` / `path` / `notebook_path` / `target_file` 五个键，取不到就放行。patch 形态的写工具很可能不带这几个键之一。于是写侧**静默放行**，方向与 §4.3.3 设想的「被 bash 拦下」相反，正是「名为 L1、实为 L2」 | r4 §6.1「通过时」第二条拆成两条可核判据：<br>(i) 按第 1 步实测的 ZCode 工具名，**写类工具全集**逐个进 matcher；<br>(ii) 每个写类工具的实测输入形态都能被 `extractTargetPath` 解析出目标路径。解析不出就判不通过，不按默认放行处理。<br>§4.3.3 增加第三种结局「名字只覆盖了一半，或路径解析不了」；第 1 步 §4.3.3 臂对每个写类工具都录一份 `tool_input` 样例。任一条不成立就按 §6.1「三条只满足一部分」处置 |
| CODEX-03 | codex | major | 接受 | 核对属实：`.gitignore` 第 82、83 行排除了 `/dist/` 与 `skills/dual-critic/scripts/trivium.cjs`。在主工作树 checkout 旧提交再重建，会覆盖当前构建产物，而 `.trivium/bin/trivium` 与后续安装都依赖它 | r4 §7.3.2 增「前置：取得 M9 基线产物」：<br>用 `git worktree add` 把 M9 收口提交检出到**仓库外**的临时目录，在那里装依赖、重建；两份产物的绝对路径、版本号、提交哈希写进 evidence 目录。<br>对照装置只读这两份产物，不碰主工作树。<br>万一取不到（例如旧提交的依赖装不上）：J3 的「Hook 行为」一列如实降级为「白名单表 + 当前产物单侧复算」，在第 4 步报告里写明，**不写成已对照**。该前置提到第 2 步开工前做，免得第 4 步才发现 |
| CODEX-04 | codex | major | 接受 | 核对属实（§0 第 1 条）：审查臂今天已经调 `prepareZcodeHome(…, req.model)` 并省掉个人键；失效那次运行的 `git_head` 就是 `17f88ac`，`dirty: true`，晚于提交 10 分钟；重开后 `zcode.ts` / `probes/zcode.ts` 零提交。r3 把 BACKLOG 重开段的诊断当成事实写进 §1.4 ②、§2.1、§3.3，**这正是纪律 2 要防的**。r3 的 T1 ① 按「diff 触及构造路径」选修复，可能答的不是这道题 | r4 做三件事：<br>① §1.4 增 ④「重开诊断本身未经代码核」，写明上述三条事实与两个替代假说（陈旧安装副本；EV-94 ② 的两臂副本不同形）。<br>② EV-82 小主题第一步改为**诊断**：先 `install:local`（单独一条命令），再跑一次 `--critics glm --model-glm GLM-5.3-Flash` 的单侧派发，记下当时 `.trivium/bin/trivium` 指向的副本版本与 `git status`。按 run.json glm 段的 `model_override_applied` / `model_effective` 分两种结局：成立就归因为陈旧副本，小主题退化为「登记 + 补防漂」；不成立才进修复。**这一步是流水线命令，由用户发起**，r4 只写剧本。<br>③ T1 ① 从位置判据改为**生效判据**：「一次在 `install:local` 之后、以本小主题结论提交为 HEAD 且工作树干净的单侧运行，其 run.json glm 段 `model_override_applied: true`，且 `model_effective` 的 modelId 段 = `GLM-5.3-Flash`」。只留「提交在 main 上、日期 ≥ 2026-09-22、不是 `17f88ac`」作为辅助条件。<br>另：BACKLOG EV-82 追加一段「M10b r3 双审核出：重开诊断与代码不符」，**原文不改**（纪律 6），第 5 步落 |
| CODEX-05 | codex | minor | 接受 | 核对属实：`hooks.ts` 约 L1007 的 `hookPreBash` 拒绝文案写着「（删掉或改坏 bin/ 会让 .claude/settings.json 里每条 Hook 的守卫永真放行）」，本轮我被拦时亲眼读到了这一句。r3 §1.2 说错话在 `hooks.json` 注释里，是**找错了位置**。<br>**再往下核一层**（读了 `.claude/settings.json` 的守卫命令）：这句话**一半对一半错**。<br>① 「删掉」`bin/` 或 `chmod -x`：`test -x` 不成立，`config.yaml` 在场，守卫退 2 拦截。所以「删掉会永真放行」不成立。<br>② 「改坏」，即把 wrapper 内容换成一个可执行、直接退 0 的脚本：守卫 `exec` 它，**永真放行**。这一半成立。<br>③ 另外，把整个 `.trivium/` 删掉（连同 `config.yaml`），守卫走 `exit 0`，这是守卫文案自己给的「确要停用」出口。<br>所以 r3 §6.2 只写「Hook 配置段被移除」**也不完整** | r4 §1.2 那一行改为：「r2 把拒绝文案里的一句话当成 `hooks.json` 注释引用，而那句话本身一半失实」，写明上面三种形态。<br>§6.2「输入面」的威胁描述改成**三种形态**：配置段被移除、`.trivium/` 整体被删、wrapper 内容被替换。前两种可以用存在性检查看到。第三种存在性检查看不见，r4 如实写成**已知边界**（B1 的输入面只做廉价存在性检查，不做内容校验），不宣称能防住。<br>拒绝文案的更正作为 EV-61 同族（「同一句失实断言的第二份」）排进 §5.6，新增第 ⑥ 项：按上述机制改准，先登记进 BACKLOG EV-61 再实施 |
| CODEX-06 | codex | minor | 接受 | 与 AGY-01 同指：成分 ② 的第一分支「共用同一个构造函数 + 接线用例」证明的是两处调用了同一段代码，**证明不了生效**。而且按 CODEX-04，审查臂今天已经在调统一的准备函数，这条分支在修复之前就可能成立，过不了本稿自己定的「修复前是否已存在」这一关 | r4 §3.3 成分 ② 只保留一种形态：**对审查臂**做生效实测。具体取以下之一：<br>(a) 对审查臂构造的副本做零配额实测（哨兵密钥 + 读 CLI 自写的 `v2/provider_config.json`，请求**非首位**模型）；<br>(b) 直接用 T2 那次真实运行的 run.json（见 AGY-01 落点）。<br>「共用构造函数」降为报告里的辅助说明，不作为通过条件 |
| CODEX-07 | codex | minor | 接受 | 核对属实（BACKLOG EV-109 与 `review.ts` 收尾段）：先落盘、后查槽位。glm 轮在真实归档上的重试，以及「造缺件 / 造改工件」，都在同主题同阶段反复起跑，孤儿工件会成为不可变工件，只能由用户在终端清理。r3 只写了「撞上时照实登记」，缺一条最省事的前提 | r4 §7.2 增「重试前置」：同主题同阶段再起跑之前，先用 `/dual-status` 确认槽位已清；上一轮停在待裁决状态时，先由用户决定是否 `/dual-abandon`。每次重试的槽位处置写进第 4 步报告。§9 增第 17 行：孤儿工件的清理由用户在终端执行。EV-109 本身不修（§2.2 不变） |
| CODEX-08 | codex | minor | 接受 | 核对属实：`install()` 对 `skillNames(skillsSrc)` 的每个顶层技能目录调 `syncDir` 整树递归，所以 `skills/dual-critic/entry/<agent>/` 会跟着 `dual-critic` 一起落进 `~/.claude/skills/dual-critic/entry/`。这与 B2「保住 claude 侧字节兼容」的意图冲突，而 J3 只比 `.reviews/` 与 Hook 行为，这一处不会红 | r4 选「**排除**」：§5.1 / §5.5 写明 claude 目标的内容映射**排除** `dual-critic/entry/`，另三家的目标才装各自的 `entry/<agent>/`。第 2 步加一条安装用例：注入临时 home 装 claude 目标后，断言 `entry/` 不存在；再加一条变异：去掉排除规则，该用例必须变红。B2「为什么」列补上这一条 |
| CODEX-09 | codex | nit | 接受 | 复核属实：逐份解析全部 `task.json`，`approvals[]` 共 111 条，其中 109 条带 `session_id` 键、取值全为 null，2 条没有这个键 | r4 §1.1 第 5 行改为「111 条里 109 条记 null、2 条没有该字段；无一非空」 |
| AGY-01 | gemini | major | 接受 | 成立，并与 CODEX-04 / CODEX-06 互相印证：r3 的 P-c 只依赖 T1，而成分 ② 是自然语言报告，`precheck.mjs` 只能核它在不在。T2 那份 run.json 是全链里**唯一可以机读的生效证据**，却被压到第 5 步才核。把 T2 并进开工前提不会引入回边：T2 由小主题单侧派发自带，本来就产生在第 4 步之前 | r4 §3.2 的 P-c 改为「**T1 且 T2**」；§3.3 T2 的「在哪里核」列改为「§11 开工钩子」。`precheck.mjs` 对 T2 run.json 做机读断言：`critics.glm.model_override_applied === true`、`model_requested === 'GLM-5.3-Flash'`、`model_effective` 的 modelId 段 = `GLM-5.3-Flash`、`model_route === 'config_copy'`；run_id 从 BACKLOG EV-82 追加段取。C-T3 仍在第 5 步，只做状态列登记。§2.1 依赖列只引编号，不复述 |
| AGY-02 | gemini | major | 接受 | 成立（与 GLM-02 同指）：前置臂的场地是夹具仓库，认领与原稿登记都发生在夹具的临时归档上，「本仓第一次在真实归档上发生认领」**不实**。「一次运行承担太多鉴别目标」也成立一半：夹具里 `--driver codex` 显式传入就能定身份（见 CODEX-01 核出的「显式值优先」），**认领对这一臂不是必需的** | r4 §4.7 删掉「本仓第一次在真实归档上发生认领」一句。认领与原稿登记降为「**附带记录，不作判据**」：跑了就照实记下落在夹具 `task.json` 里的样子，不跑也不影响这一臂通过。这一臂的**唯一判据**是 `heterogeneous` / `override_reason` 两格逐格等于期望值。§1.1 第 1 行「真实归档零认领」的论域明确写成「本仓 `.reviews/`」 |
| AGY-03 | gemini | minor | 接受 | 成立。三侧对焦点六的判读不同：codex、glm 认为只比对 plan 阶段「够用」，因为 code 阶段那次 `--start` 会自己再比一次，漏检只会**晚**，不会**静默**。gemini 指出「晚」的代价是 plan 阶段整轮的配额白花了。入口处多比对一个阶段只是多读一次留痕，成本可以忽略，而**判错身份越早响越好**正是 `cli.ts` 交叉校验注释写明的原则（「位置在冻结送审包之前」） | r4 §5.3 的设计点定为：命令 A 在 `topic resolve` 入口**对 plan 与 code 两个阶段都比对**，任一阶段的留痕或声明与显式 `--driver` 冲突，就退 64。code 阶段那次 `--start` 的自带比对照样保留，两处都要有。`topic-args.ts` 的整段跳过改为按 `['plan', 'code']` 循环。B4 的「决定」列同步改 |
| AGY-04 | gemini | minor | 接受 | 成立：Driver 在一轮里要写的角色工件不只原稿，还有 `-revised-<id>.md`（plan / bug）与 `-response-<id>.md`（code）；写工具也分「新建」与「修改已有」两种能力 | r4 §6.1「通过时」第三条改为：「glm Driver 的**全部角色工件**（原稿、`-revised-glm.md`、`-response-glm.md`）都有一条不经 shell 的写路径，且**新建与修改**两种能力都实测过」。§4.3.3 的第 1 步实测分两格录入。§9 第 7 行随之改写 |
| AGY-05 | gemini | minor | 接受 | 下限偏低成立（与 GLM-04 同指）。重算时又找出 r3 **漏计的一轮**：§7.3.1 移到夹具仓库里的那一轮 claude plan 双审，在 §10.1 里没有行。夹具运行只要漏拷一份就会系统性少计，也成立 | r4 §10.1 重算（与 GLM-04 合并）：<br>本计划 2～6（本轮已是第 1 轮且 request-changes；M10a 主计划 6 轮，含 1 轮作废）；<br>EV-82 小主题按 CODEX-04 改为「诊断单侧 1 + plan 1～3 + code 2～3 + T2 单侧 1」（诊断若归因为陈旧副本，code 可能是 0，但下限仍按 2 估，不按乐观端估）；<br>第 4 步验收轮 4 → **5～10**（补 §7.3.1 那一轮）。<br>合计由 16～31 调为约 **19～38**，精确数字在 r4 落笔时逐行加一次再写。§10.2 差异 ③ 的阈值按新上限 × 1.33 重算，并在台账登记这次改动。<br>§10.2 差异 ④ 追加：夹具仓库里的**每一次** `review --start`，不论成功、失败、作废还是取消，run.json 副本都一律拷进 evidence 目录；点数对象是「evidence 目录里 run 副本的份数」，跑完的当场拷，不等收尾（拷贝用 §9 第 15 行的脚本出口） |
| GLM-01 | glm | major | 接受 | 成立，与 CODEX-04 合并处置：① 的「diff 触及构造路径」按文件级命中来实现，就会退回只核在场；而且具名证据写的是单数哈希，多提交落地时不知道登记哪一个。③ 里「审的正是①的改动」是内容对应关系，钩子核不了 | r4 §3.3：<br>① 按 CODEX-04 改为生效判据后，「diff 触及」只留作辅助条件，不再承担判别力。具名证据改为「小主题**收口提交**的哈希（多提交时取最后一次合入 main 的那一个），并列出该主题全部提交」。<br>③ 显式拆成两部分：钩子机核「主题名 ≠ `zcode-模型覆盖落点`、`stage: code`、`decision: approved`、`at` 晚于①收口提交的父提交时间」；「该 run_id 审的正是①的改动」标为**人工核验项**，钩子输出单独注明「本条只核时间戳与字段，内容对应由人核」。<br>§10.3 R-n 同步补一句：钩子输出不得暗示核过它核不了的东西 |
| GLM-02 | glm | minor | 接受 | 与 AGY-02 同指，核对属实：`cmdTopicClaim` 把声明写进执行时所在仓库的归档，夹具里的运行写不进本仓 | 与 AGY-02 同一落点：r4 §4.7 改为「在夹具归档上第一次实跑认领与非缺省 Driver 原稿登记（附带记录，不作判据；本仓真实归档仍零认领）」 |
| GLM-03 | glm | minor | 接受 | 核对属实：`hookPreBash` 用的是 `WRITE_LIKE.some((re) => re.test(cmd))`，判在**未剥 heredoc 的原文**上；`looksLikeWriteCommand` 先调 `stripHeredocs` 再判，注释写明「保留剥离语义供他处使用」。r3 §1.1 第 4 行恰恰在一节以「按符号名核」立身的地方写错了符号 | r4 §1.1 第 4 行结论列末句改为「拦截的前提是命令在未剥 heredoc 的原文上命中 `WRITE_LIKE` 写动词集（`hookPreBash` 内联判定，不经 `looksLikeWriteCommand`）」，与 §9 脚注同源 |
| GLM-04 | glm | minor | 接受 | 核对属实：M10a 台账第 79～84 行，M10a 主计划 plan 档 6 轮（r1～r6，其中 r4 整轮作废）。r3 只拿「子计划 1～2 轮」作类比，选的是乐观端 | 与 AGY-05 同一落点（§10.1 本计划行改为 2～6，依据列写明「类比 M10a 主计划 6 轮；本稿 r1 / r2 未经双审，r3 是第一次送审，没有理由比 M10a 主计划收敛得更快」） |

## 1. 本轮不做的事

- **不在会话里跑 EV-82 的诊断单侧派发**（CODEX-04 落点 ②）。那是一次 `review --start`，属于流水线命令，由用户发起；r4 只写剧本。
- **不改 BACKLOG EV-82 的重开段**。r3 稿与本裁决件都在闸门期；追加段排在第 5 步写（纪律 6：追加，不改原文）。
- **不改 `hooks.ts` 的拒绝文案**（CODEX-05）。那是业务代码，排进第 2 步 §5.6 新 ⑥，先登记进 EV-61。
