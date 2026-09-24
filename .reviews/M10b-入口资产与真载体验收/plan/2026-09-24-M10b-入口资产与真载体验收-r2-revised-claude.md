---
schema: trivium.disposition.v1
topic: M10b-入口资产与真载体验收
stage: plan
role: claude
kind: revised
run_id: 20260924T004706Z
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
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
---

# 裁决：M10b 入口资产与真载体验收 · 计划双审第 2 轮（审 r4 稿）

> 被审对象：`2026-09-24-M10b-入口资产与真载体验收-r4-claude.md`
> ｜ 运行：`20260924T004706Z`（13m9s）
> ｜ 三侧均为结构化产出；codex `request-changes` ｜ gemini `approve-with-nits` ｜ glm `request-changes`
> ｜ 共 18 条：重要 4 ｜ 次要 8 ｜ 吹毛求疵 6 ｜ 零阻断
> ｜ **全部接受**。AGY-01 的落点**改了取证方式**（不读含凭据的文件），理由写在表内

## 0. 本轮的形状

**第 1 轮 18 条的落地，三侧都逐条核过**：codex 逐条在 r4 正文里找到了落点，glm 称「落地质量高」，gemini 判 approve-with-nits。
§1.4 ④ 的前两条事实（审查臂做模型限定；`20260921T145353Z` 的 `git_head` / `dirty` / 时间差）三侧都复核属实。
§5.3 命令 A、§6.2 前三种形态、§7.3.2.1 基线 `f4f3970`、§9 第 16、18 行的写动词判定、§10.1 的算术，都核对成立。

**问题集中在 r4 新写的 §3.3.1 诊断剧本**。这是本轮的支点，也是我在 r4 里最没核透的一段：

1. **我在 §1.4 ④ 第 4 行写「留痕钉不住」，是错的（CODEX-03）**。已核：
   - `git log -S'model_override_applied' -- src/trivium/adapters/zcode.ts` 只命中 `17f88ac`；
   - `98b2fd3`（`17f88ac` 的父提交）的 `src/` 里零处 `model_override_applied`；
   - 而 `20260921T145353Z` 的 run.json **带着**这个字段。

   所以写那份留痕的编排器含有 EV-82 工作的产物，**不是修复之前的旧版**。「纯陈旧副本」这个 H1 已有反证在手。
   剩下的只有 **H1′「EV-82 工作期间的中间态构建」**：字段在 r1 就引入了，路线 L 的最终形态在 r2、r3 才定。
   r4 H1 分支的判据「新跑一次通过 ⇒ 归因陈旧副本」是**事后归因**，与那次运行用的是哪一版无关。
2. **漏了已登记在案的第四类成因（CODEX-02）**。已核：
   - `zcode.ts` 的 `legacyProviderMembers` 文档块逐字写着「限定通过、v2 文件照样写出请求值，而运行期 `isSelectable` 在注册表里配不上」；
   - 设计 v1.3.32 十② 记着同一族缺陷。

   **旧证据本身就是它的旁证**：`20260921T145353Z` 的 `model_effective` 是 `bigmodel-coding-plan/GLM-5.3`，
   provider 段是**副本源的 legacy 键**，不是个人配置的 `<providerUUID>/…` 形态。
   这说明个人配置确实被隔离掉、legacy 导入确实发生了，而**选择回落到了首位**。这与「注册表配不上 ⇒ 静默回落」同形。
   **r4 列的 H0（审查臂未接上限定）反被旧证据削弱**：真没接上，回读的应当是个人配置的 UUID 形态。
   r4 的零配额区分实验读的是配置读取层（`v2/provider_config.json` 的 `defaultModelSelection`），**结构上测不到**这一格。
   若真因是它，T2 用 `GLM-5.3-Flash` 可能**恒 false**，P-c 永不成立，第 4 步永不开工。
3. **还漏了环境漂移，以及「字段缺席」那一格（GLM-01）**。已核：旧运行 glm 段 `cli_version: 0.16.9`，本机今天的 preflight 也报 `zcode 0.16.9`，
   CLI 版本没变；但副本源 `cli/config.json` 的 provider 成员顺序与键名是否变过，诊断时没有复核。
   按 `zcode.ts` 的产出条件，`model_route: global`（限定失败）时 `model_override_applied` **整个不产出**，r4 的分支表没有这一格。
4. **构建前置漏了（CODEX-01）**。已核 `package.json`：`"install:local": "node dist/install.cjs"`、`"build": "node scripts/build.mjs"`，
   `install:local` **不重建 `dist/`**。r4 剧本第 1 步只保证「安装副本 = 当前 `dist/`」，不保证「= 工作树代码」。
   我自己的记忆里也记着「验证前必须 install:local」，却漏了它前面那一步 build。

**r5 的方向**：诊断的目的从「给 2026-09-21 那次失效归因」改为「**测当前代码在当前环境里生效没有，以及失效在哪一层**」。
那次失效的归因写成「H1′ 或 H3 或环境漂移，**不可复现即不可判**」：修复前后之间没有中间提交，旧产物无法重建。
分支表按**观测形态**分，不按归因分：provider 段是 legacy 键还是 UUID、字段在不在、modelId 段对不对。
H3 若成立，那就是「形态换源」，量级和外部依赖（桌面端 OAuth 账号态）都会变，**先向用户报告，再定是否在本里程碑内**。

**另两处数据面的澄清**（不对应意见编号）：
- codex 数到 112 条 approvals、110 条 null，glm 用 grep 数到 108 条 null，与 r4 的 111 / 109 都不同。
- codex 多出的那一条，是本主题第 1 轮审批（2026-09-24）新增的，r4 的数是在 r3 落笔时点的。
- r5 §1.1 第 5 行写明**时点与论域**：「截至 r3 落笔时 111 条；本主题第 1 轮审批后 112 条；无一非空」。
- glm 的 108 是 grep 口径（按行匹配）与按键解析的差，不影响「无一非空」。

**闸门期不改业务文件，也不改 r4 稿。** 下表落点在 `/dual-approve` 之后写进 **r5 稿**。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 核对属实：`package.json` 的 `install:local` 只跑 `node dist/install.cjs`，不重建 `dist/`；AGENTS.md「已知坑」第 1 条要求 build + install 两步。诊断落 false 时，与「陈旧 `dist/`」分不开 | r5 §3.3.1 剧本第 1 步拆成两条命令：`npm run build` 与 `npm run install:local`，各自单独一条（§9 第 6 行扩为同时覆盖 build）。<br>记下 `dist/` 构建产物（`dist/trivium.cjs` 与安装副本 `trivium.cjs`）的 `shasum -a 256` 与 mtime，二者一致才继续。<br>§3.3.2 T2 前提句同步改为「build + install 之后，安装副本摘要 = 本次构建产物摘要」，两个摘要写进报告行。<br>§10.3 R-q 的反向风险补上「install 了陈旧 `dist/`」 |
| CODEX-02 | codex | major | 接受 | 核对属实，且旁证比审查员写的更强（§0 第 2 条）：旧运行 `model_effective` 的 provider 段是 legacy 键 `bigmodel-coding-plan`，说明个人配置被隔离、legacy 导入已发生，却回落到首位模型。与 `legacyProviderMembers` 文档块、设计 v1.3.32 十② 记下的「运行期 `isSelectable` 配不上」同形。r4 的零配额实验只读配置读取层，结构上测不到它 | r5 §1.4 ④ 增 **H3「运行期注册表配不上」**（`isSelectable` 精确匹配失败 ⇒ 静默回落同 provider 首位），并写明旧证据的 provider 段形态是它的旁证、同时削弱 H0。<br>§3.3.1 分支表改为**按观测形态分**（见 GLM-01 落点），其中「provider 段 = legacy 键、modelId 段 = 首位、字段 = false」一格对应 H3 候选。<br>零配额实验的描述**逐层写明**：它能区分「配置读取层是否写出请求值」，不能区分「注册表层是否选中」。落 H3 候选时的出口是**停下向用户报告**：「形态换源」（providerId / modelId 换源、依赖桌面端 OAuth 账号态）不在 r5 §2.1 范围内，量级另估。<br>§2.2 增一行：「形态换源」不在本里程碑，除非用户在诊断报告后拍板纳入。§10.1 EV-82 行加注：落 H3 则另按换源主题重估 |
| CODEX-03 | codex | major | 接受 | 核对属实（§0 第 1 条）：`98b2fd3` 零处该字段，`17f88ac` 才引入，旧运行带着它 ⇒ 写留痕的产物含 EV-82 工作的改动。r4 第 4 行「钉不住」与证据不符；H1 分支「新跑通过 ⇒ 陈旧副本」是事后归因 | r5 §1.4 ④ 第 4 行改为：「留痕字段指纹表明，写那份 run.json 的编排器含 `17f88ac` 引入的 `model_override_applied` ⇒ 不是修复前的版本。它是否含路线 L 的**最终**形态钉不住：EV-82 工作期间有过 r1～r3 三轮代码双审的中间态，而 `17f88ac` 之前没有中间提交可以重建」。<br>H1 改名为 **H1′「中间态构建」**，并写明**不可复现 ⇒ 不可判**。<br>§3.3.1 删除「生效 ⇒ 归因陈旧副本」这一步：诊断落「生效」时，结论只写「**当前代码在当前环境生效**；2026-09-21 那次失效归因不可判（候选 H1′ / H3 / 环境漂移）」，BACKLOG 追加段照此措辞，**不写「H0 被推翻」以外的归因**。<br>H0 被推翻的依据写成两条：旧证据的 provider 段形态，与当前生效 |
| CODEX-04 | codex | minor | 接受 | 成立：②(a) 要「对审查臂构造出的副本做零配额实测」，但审查臂的副本源是真实 `~/.zcode/cli/config.json`，只有 `opts.srcConfig` 这个测试注入口；而 §4.3.1 禁止手搓脚本复刻 `prepareZcodeHome`。两条叠在一起，实施时最省事就是退到 (b)，于是 ① 与 ② 同挂在 T2 上 | r5 §3.3.3 ②(a) 写死唯一合法的注入点：把它实现成 **EV-94 ② 的「同形第二臂」**。探针侧新增一臂，以**整份拷贝**的副本形态（与审查臂同形）为骨架，字符串值换哨兵、请求非首位模型；这是**进仓库、走代码双审的代码**，不是会话里的实验脚本。副本源的注入走 `probeZcode` 已有的 `cliConfigPath` 注入口，临时目录只认 mkdtemp 的返回值（2026-09-20 事故 R1、R2）。<br>(a) 做不了才退 (b)，并把「① 与 ② 共用 T2，三条成分实为两条」的降档后果**写在 §3.2 P-c 判据旁**，不只写在 ② 里 |
| CODEX-05 | codex | minor | 接受 | 核对属实：`extractTargetPath` 取到第一个命中的键就返回单值；`ZCODE_WRITE_TOOLS` 含 `MultiEdit`、`ApplyPatch`，一次调用可能涉及多个文件。若取出的路径不受保护、patch 正文里另有受保护角色工件，就会被静默放行 | r5 §6.1 条件 2(ii) 改为**按目标判，不按工具判**：每个写类工具的输入，要么实测为单目标，要么其**全部**目标路径都能被取出、并对每个目标施行同一判定。取不全 ⇒ 判不通过。<br>§4.3.3 的样例采集改为「单目标、多目标形态各录一份」；四种结局表增一格「多目标只取到一个」 |
| CODEX-06 | codex | minor | 接受 | 成立：`.claude/settings.json` 的守卫是「存在性判据 + `exec` 执行体」，二者分离。①配置段在场、但 `command` 被换成 `true` 或 matcher 被缩窄；②wrapper `exec` 的全局安装副本 `trivium.cjs` 被替换。这两种存在性检查都看不见，与 wrapper 内容替换同类。每条 Hook 挂 `"timeout": 15`，超时是否放行，r4 未核 | r5 §6.2 威胁表增两行：「配置段内容被改（command / matcher）」「全局安装副本内容被替换」，两行都标「存在性检查看不见」。<br>R-r 改成总的一句：「存在性检查看不见任何**内容**层的替换：wrapper、全局安装副本、配置段里的命令与 matcher」。<br>超时一格标「**未核**」：ZCode 侧在第 1 步 §4.3.1 Hook 形态臂顺带实测（一条挂起脚本 + 一次写工具调用）；Claude Code 侧查官方文档后照实登记。**不默认超时即拦** |
| CODEX-07 | codex | minor | 接受 | 核对属实：M10a 第 5 步报告 §5「演进设计 §14 表 M7b / M8 / M9 三行仍未回填」与 §3 残余待办 ⑤（`peer_artifact_globs`），r4 既未继承、也未在 §2.2 写不做。其中 ⑤ 与 GLM-05 同指 | r5 §2.3 增第 8、9 项：<br>(8) **演进设计 §14 表 M7b / M8 / M9 三行回填**：并入第 5 步。只填状态列与收口提交指针，不改其它列。理由：同一张表 r5 §8.2 要动 M10b 行，不补就会留下「同表维护状态不一致」；§14 表是演进设计里唯一不冻结的部分（方案 A）。<br>(9) **`peer_artifact_globs`**：见 GLM-05 落点 |
| CODEX-08 | codex | nit | 接受 | 核对属实：r4 §6 只有 6.1、6.2，「改注入 L2 明示（§6.3、J8）」是断指针 | r5 §5.1 末段改为「改注入 L2 明示（J8；正文落点为 §8.4 QUICKSTART 的 L1 / L2 节）」 |
| CODEX-09 | codex | nit | 接受 | 成立，并与 AGY-02 合并：`git worktree add` 会在 `.git/worktrees/` 留注册项，忘了清就是长期残留；`scripts/build.mjs` 不调 git，导出一棵树就够了 | r5 §7.3.2.1 首选取法改为 **`git archive f4f3970` 管道解包**到一个 mkdtemp 创建的仓库外目录。导出物不含 `.git`，主仓零注册项；路径不含保护字面，`tar` 是写动词但不触发 D3。worktree 降为备选：用它时，清理写成 `git worktree remove --force <目录>`（AGY-02），登记项里加「清理已执行」的可核事实（`git worktree list` 输出）。<br>临时目录的删除只认 mkdtemp 返回值（R1）。§9 第 18 行随之改写 |
| AGY-01 | gemini | minor | 接受 | 成立一半，落点改了取证方式。**成立的**：若审查臂隔离失效、回读的是个人配置，而个人配置的默认模型恰好也是 Flash，诊断会假阳性。**改的**：审查员建议「读取宿主真实 `~/.zcode/v2/provider_config.json`」，那份文件 0600、含明文凭据（仓库根 `CLAUDE.md` 与 BACKLOG EV-82 原文留档都写着「只判有无不读内容」）。而这一格**不读它也能判**：个人配置生效时，回读的 `model_effective` 是 `<providerUUID>/…` 形态；副本源 legacy 导入生效时，是 legacy 键形态。旧证据与本轮 glm 审查侧都是后者 | r5 §3.3.1 剧本第 4 步增读数：`model_effective` 的 **provider 段形态**。必须是副本源 `cli/config.json` 的 legacy 键（只 `grep` 该文件的 provider 键名，不打印值），是 UUID 形态即判「隔离失效」，不进任何「生效」分支。<br>**不读** `~/.zcode/v2/provider_config.json` 的内容；确需确认它的默认模型时，只 `grep -o` `defaultModelSelection` 这一个键 |
| AGY-02 | gemini | nit | 接受 | 成立：执行过 `npm ci` 的 worktree 里有未跟踪文件，`git worktree remove` 不带 `--force` 会拒绝删除（r4 没写 `/tmp/trivium-m9-verify` 这个具体路径，但清理会中断这一点对） | 与 CODEX-09 同一落点：worktree 降为备选，备选时用 `--force` 并登记 `git worktree list` |
| AGY-03 | gemini | minor | 接受 | 成立：条件 1「能拒一次写」只验一个工具，matcher 的名字对不上时，别的写工具可能不触发 | r5 §6.1 条件 1 改为「**每个**写类工具（名字以 §4.3.3 实测全集为准）各被 `exit 2` 的 Hook 拒一次」，与条件 2(i) 的全集同源 |
| GLM-01 | glm | major | 接受 | 核对属实（§0 第 3 条）：旧运行与今天的 CLI 都是 0.16.9，但副本源的 provider 成员顺序与键名没复核。T2 选 Flash 的鉴别力全建立在「非首位」上。`model_route: global` 时字段整个不产出，分支表没有这一格。H1 结论会以追加形式写进 BACKLOG，错了不可改 | r5 §3.3.1 剧本第 4 步读数增两项：①`critics.glm.cli_version`，与旧证据的 0.16.9 比对；②副本源 provider 里 `GLM-5.3-Flash` 仍**非首位**，用 `legacyProviderMembers` 同口径核（写成单测或探针输出，不手读凭据文件）。<br>分支表按观测形态重写为五格：<br>(A) 字段缺席 / `model_route: global` ⇒ 限定没建起来，登记环境原因（源缺失或限定失败），按证据不足处置；<br>(B) provider 段为 UUID ⇒ 隔离失效；<br>(C) legacy 键 + modelId = Flash + `true` ⇒ 当前生效；<br>(D) legacy 键 + modelId = 首位 + `false` ⇒ H3 候选，停下报告（CODEX-02）；<br>(E) `null` 或运行失败 ⇒ 证据不足。<br>`cli_version` 或首位关系与旧证据不同时，任何归因都标「环境已变、不可判」。<br>§8.4 BACKLOG 追加措辞按 CODEX-03 落点，不写不可判的归因 |
| GLM-02 | glm | minor | 接受 | 成立：r4 只在 H1 分支补防漂，H0 / H2 分支下「安装副本同版」的缺口一直持续到收口。旧证据正是「工作树新、跑的可能是旧副本」的形态，T2 会给假阴性，把人引向「修复又失效了」 | r5 把**构建标识**提为 EV-82 小主题**所有分支共用的第一项代码改动**：构建时写入 `git rev-parse HEAD` 与 dirty 标记；run.json `snapshot` 旁记安装副本的构建标识，二者不符时收尾告警。它独立于归因，体量小，与诊断结论无关，排在 T2 之前。<br>诊断本身在构建标识落地**之前**跑，靠 CODEX-01 落点的摘要比对兜住。<br>§3.3.2 末段改写：T2 假阴性时的排查次序是「先核构建标识，再怀疑修复」 |
| GLM-03 | glm | minor | 接受 | 成立：条件 2(i) 依赖「全集」，但全集的完备性没有判据；漏一个写类工具正是要堵的静默形态。`extractTargetPath` 若加新键，缺一条「Claude Code 侧五键行为不变」的回归用例（新键的插入次序会影响多键共存时的取值） | r5 §4.3.3 定两个独立来源交叉核对：①CLI 二进制字面量扫描（与 Hook 形态臂同款）；②交互会话实测清单。差异逐条解释。<br>§6.1 写明边界「全集 = 两源交叉后的观察集，**完备性不保证**」，并写进 L1 / L2 文档。<br>§6.1 与 §11 增：若改 `extractTargetPath`，**只追加、不重排**（codex 在「认为正确」段的约束），并加一条回归用例：Claude Code 侧 `Edit` / `Write` / `NotebookEdit` 的既有输入，取值与改动前逐条相同；变异「把新键插到 `file_path` 之前」⇒ 该用例变红 |
| GLM-04 | glm | nit | 接受 | 核对属实：BACKLOG EV-94 ② 的触发条件原文含「探针判 `config_copy` 而运行 `false`」，按本机探针段与 `20260921T145353Z` 已经满足。r4 只在 H2 分支处置 | r5 §8.4 BACKLOG 行改为：小主题收口时，**无论落哪个分支**，都往 EV-94 ② 追加一行处置（已触发、诊断归因、是否需要第二臂）。按 CODEX-04 落点，第二臂本身就作为 ②(a) 实现，届时在该行写「已由 <提交> 实现」 |
| GLM-05 | glm | nit | 接受 | 核对属实（glm 已读 `config.ts` 与 `freeze.ts`）：缺省 `peer_artifact_globs` 是 `['**/*-gemini.md', '**/*-glm.md']`，唯一消费方 `freeze.ts` 已改为注册表派生加配置追加的并集，实际风险低；但它与 §1.3 ⑬ 同形（代码里残留的「两家」字面），r4 处置不对称 | r5 §5.6 增 **新 ⑦**：`config.ts` 缺省 `peer_artifact_globs` 的「两家」字面。先核 `freeze.ts` 消费面并写进报告；缺省值**不改值**，只补注释说明「并集语义下它只是追加项，四家由注册表派生」。只动注释，不设变异。先登记进 BACKLOG EV-61 追加段。<br>§2.3 第 9 项指向本行 |
| GLM-06 | glm | nit | 接受 | 核对属实：台账 §0 继承「被状态机拒掉的未成轮不计入」，而 r4 差异 ④ 以「evidence 里的 run.json 副本」为点数对象，EV-109 形态的被拒 `--start` 恰恰已经落了 run.json 骨架，两条口径给出相反答案 | r5 §10.2 差异 ④ 补一句：「**拷**与**计**分开：run.json 副本（含被拒的骨架）照拷进 evidence 以备取证；是否计入累计按 §0 口径判，状态机拒掉、未派生工作进程的未成轮不计入」。台账 §0 差异 ④ 同步追加同一句（追加，不改原文） |

## 1. 本轮不做的事

- **不在会话里跑 EV-82 诊断**。那是流水线命令，由用户发起；r5 只写剧本。
- **不读 `~/.zcode/v2/provider_config.json` 的内容**（AGY-01）；需要时只 `grep` 单键。
- **不在本里程碑内承诺「形态换源」**（CODEX-02）。诊断若落 H3 候选，停下向用户报告，由用户定。
