---
schema: trivium.disposition.v1
topic: EV-125-命令A支持选侧旗标
stage: plan
role: claude
kind: revised
run_id: 20260925T073426Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - CODEX-07
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
  - GLM-01
  - GLM-02
---

# 裁决：EV-125（命令 A 支持选侧旗标）· 计划双审第 1 轮

> 被审对象：`2026-09-25-EV-125-命令A支持选侧旗标-claude.md`（r1）
> ｜ 运行：`20260925T073426Z`（8m49s）
> ｜ 结论：codex `approve-with-nits` ｜ gemini `request-changes` ｜ glm `approve-with-nits`
> ｜ 共 13 条：重要 1 ｜ 次要 8 ｜ 吹毛求疵 4 ｜ 零阻断
> ｜ **13 条全部接受**。同指三组：CODEX-03 ≡ AGY-01（S0 / S0.5 互换后的跨步引用）；CODEX-02 ≡ AGY-03 ① ≡ GLM-01 ①（PROTOCOL :341）；CODEX-05 ≡ AGY-03 ②（QUICKSTART :200）

## 0. 本轮的形状：用户的五个焦点

- **焦点一 删掉拒绝段后是否同路径**：**三侧一致成立。** `topic-args.ts` 里 `scope === 'all'` 的选侧特判只有 :347-355 这一处；剩下的特判（位置参数语义、焦点必填、两阶段 Driver 比对、被审对象定位）都不碰入选、模型覆盖、`only` 置空。C2 不改。
- **焦点二 D1 两轮冻结**：**三侧一致成立。** S2 在降级许可下某侧失败，S6 照样再试那一侧：那是运行期失败，不是配置意图。缺省路径上 S0.5 的集合与 `--start` 自己回落的结果等价（`review.ts` :562-564 同样减当轮 Driver），不引入行为回归。残余一格见 GLM-02。
- **焦点三 D2 先解析后预检**：**三侧一致：没有哪一项预检是解析的前提。** 同时纠正我 r1 的一句（§3 其它登记第 1 条）：`.trivium/` 整个缺失时 `loadCtx` 会报「尚未初始化」（`config.ts` :733-737）；只有目录在而 `config.yaml` 缺的半初始化状态才回落内置缺省。配置本身写坏时，解析阶段直接退 69（gemini 核）。计划担心的「先给出一份与预检矛盾的输出」只剩半初始化这一个窄窗。AGY-04 另指出回显确认的时机问题，接受。
- **焦点四 漏传的防线**：**三侧一致：不必改 `--start`。** codex 补了一条我没写到的当轮可见通道：`--start` 返回的 `models` 以本轮入选侧为键，契约要求在 S2 / S6 开场播报里念出来，漏传时用户在开场就能看到侧名不对，不必等事后核对。GLM-02 要求把残余显式登记，接受。
- **焦点五 还有哪些文档**：**三侧合计多找出四处。** PROTOCOL :341（三侧同指）、QUICKSTART :200（codex、gemini）、MANUAL §5.4 :468（glm）、两个测试文件里的现在时注释（codex）。全部纳入 §5。

## 1. 裁决

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实。`install:local` 就是不带 `--targets` 的 `node dist/install.cjs`，它会重装运行时根和本机检测到的每一家入口，与 §2「不重装真实 HOME」直接矛盾。`.trivium/bin/trivium` 指向 `~/.claude/skills/dual-critic/scripts/trivium.cjs`（已读 wrapper），所以不装就跑不到新代码，两句话确实不能同时成立。取方案 ①：`npm run build` 已把 CLI 产出到仓库内的 `skills/dual-critic/scripts/trivium.cjs`，E1 / E2 直接用 node 跑这一份，资产根用 AGENTS.md 写明的 `TRIVIUM_ASSET_ROOT=<repo>/skills/dual-critic`，只作用于这一条命令 | r2 §4.3 E1 / E2 改成直跑仓库构建产物、不装；写明「真实 HOME 零改动，因此没有回滚项」；§7 同步 |
| CODEX-02 | codex | minor | 接受 | 属实。PROTOCOL :341 写着「四条 skill 的第 1 步不传它」，D2 落地后这句对命令 A 不再成立。与 AGY-03 ①、GLM-01 ① 同指 | r2 §5 加 PROTOCOL :341：按命令分述。命令 A 在解析之后预检，带入选、档位与模型覆盖；B / C / D 仍在第 1 步、不带 |
| CODEX-03 | codex | minor | 接受 | 属实，与 AGY-01 同指。重编号的触点比 r1 列出的多：`claim-plan.md` :2、契约 :67 / :69 / :70、设计 §8.2。**落点换了一种做法，不按建议逐条列举**：r2 **不重编号**。解析保留「S0.5」，预检挪到它后面改叫「S0.6」，S0 这个标签不再使用。这样一来，所有「取 S0.5 输出的 X」式引用（claim-plan、S2 的 `task_goal` / `prompt_hint`、`@QUOTE_RULE_AT`）原样成立，这一类漂移整体消失；剩下要改的只有指向**预检**的少数几处，逐条列在 r2 §3.3 | r2 §3.3 改为「解析 S0.5 → 预检 S0.6 → 认领 S0.8」。要改的触点：契约里预检那一节的标题与位置、:70「与 S0 / S0.5 同一个值」改成「S0.5 / S0.6」、状态机标题「S0～S10」、设计 §8.2 的 mermaid 与步骤表、`entry-render-parity.test.ts` :141 注释、`skill-flag-parity.test.ts` :154 注释。实施后按 `S0\b` 与 `S0.5` 各 grep 一遍，写进读数 |
| CODEX-04 | codex | minor | 接受 | 属实。`tsconfig.json` :10 开着 `noUnusedLocals`，删掉两个变量后 `defaults` 和 `DEFAULT_CRITIC_AGENT_IDS` 的导入都会变成未使用，typecheck 过不了 | r2 §3.4 改动面写全：两个变量、`defaults` 局部量、`DEFAULT_CRITIC_AGENT_IDS` 导入一起删；实施报告贴 typecheck 读数 |
| CODEX-05 | codex | minor | 接受 | 属实。QUICKSTART :200 写着「给 B/C/D 加 `--critics glm`」，落地后与 MANUAL 矛盾。与 AGY-03 ② 同指 | r2 §5 加 QUICKSTART :200，改为 B/C/D 与 `/dual-run` 都可以加；同文件再扫一遍同口径的句子 |
| CODEX-06 | codex | nit | 接受 | 属实。`topic-args.test.ts` :706 和 `critics.test.ts` :245 的注释还用现在时写着「命令 A 不收 `--critics`」。本仓记过「改语义前先列清所有断言该语义的落点」这条教训 | r2 §5 把这两处列进清单，并加一条通则：实施后在 `src/`、`test/`、`skills-src/`、`doc/` 里 grep「命令 A 不收」「命令 A 不接受」，凡是断言当前事实的一律改；历史留痕（设计变更记录、M10b 报告）不动 |
| CODEX-07 | codex | nit | 接受 | 属实。守 EV-61「槽位由注册表派生、不给当轮 Driver 留槽位」的那条断言，论域只到 `review-`，而这次 `run` 契约第一次拿到 `--only` 和全集的 `--model-*` | r2 §4.1：把 `entry-render-parity.test.ts` :224-236 的论域扩到 `run`（预期仍然绿） |
| AGY-01 | gemini | major | 接受 | 属实，与 CODEX-03 同指。重编号之后，「取 S0.5 输出的 `topic` / `task_goal` / `prompt_hint`」会指向预检那一步，执行者按契约去拿就是拿错；而渲染一致性检查只核对「源 = 产物」，抓不到这种内部指向错。我自己 r1 的 §3.2 / §5 / §6 也还在用旧称谓。落点同 CODEX-03：不重编号，解析仍是 S0.5，这一类引用原样成立，计划自身的称谓也就不用改 | 同 CODEX-03 |
| AGY-02 | gemini | minor | 接受 | 属实。r1 只给了预检的命令骨架，没写正文规约：`critics` 用逗号连接、无条件传；`profile` 和 `models` 非空才带。B 第 3 步对 `--start` 就是这么写的，预检这一步也要同样写全 | r2 §3.3：S0.6 正文写明拼法，并加一句「预检用的入选必须和 S2 / S6 传的是同一组，都取自 S0.5 的输出」 |
| AGY-03 | gemini | minor | 接受 | 属实：① 同 CODEX-02（PROTOCOL），② 同 CODEX-05（QUICKSTART） | 同 CODEX-02、CODEX-05 |
| AGY-04 | gemini | nit | 接受 | 成立。换了次序以后，如果推导出的主题先让用户确认、紧接着预检就失败，这一轮确认就白费了。预检不依赖主题；命令 A 的每次调用都由渲染显式注入 `--driver`，入选集合不会随主题变，所以把确认挪到预检通过之后是安全的 | r2 §3.3：S0.5 解析完直接进 S0.6；推导主题的回显确认挪到 S0.6 通过之后、S0.8 认领之前。用户改了主题就重跑 S0.5；新输出的 `critics` / `profile` / `models` 与预检所用不同时，重跑 S0.6 |
| GLM-01 | glm | minor | 接受 | 属实：① 同 CODEX-02；② MANUAL §5.4 :468 的括注「命令 A 只跑缺省集合」落地后失实。glm 在盲区里另提一处，一并收下：MANUAL §4.7 :328「不给时取 `review.default_critics`」没写「减当轮 Driver」，这是 M10b 第 2 步 D-4 (a) 的口径，本题本来就要改 §4.7 | r2 §5 加 MANUAL §5.4 :468，改成条件表述「命令 A 不写 `--critics` 时只跑缺省集合（减当轮 Driver）」；§4.7 :328 同步补「减当轮 Driver」 |
| GLM-02 | glm | nit | 接受 | 属实。S6 漏传 `--critics` 时，两轮可能跑的是不同的几家，而运行期没有跨阶段比对。维持「契约加留痕」的取舍（三侧都不主张改 `--start`），但这一格要显式登记，后来的人才找得到。codex 焦点四补的开场播报通道一并写进去，作为当轮可见的缓解 | r2 §5：设计 §7.1 的撤销注记和 BACKLOG EV-125 的关闭说明里各写一句：「S6 漏传 `critics` ⇒ 两轮异侧；当轮靠 S2 / S6 开场播报念出的 `models` 键发现，事后靠两份运行留痕的 `critics_selected` 对出」 |

## 2. 修订稿 r2（在 r1 基础上的改动，按节）

- **§1.2**：C9 补一句「解析在 S0.5、预检在 S0.6」。§3.3 (c) 里对 `loadCtx` 的描述更正为三档：`.trivium/` 缺失 ⇒ 报「尚未初始化」；目录在、`config.yaml` 缺 ⇒ 回落缺省；配置写坏 ⇒ 解析期退 69。
- **§3.2**：S0.5 字段清单这一节不动（编号不变）；S2 交接里加上 `critics` / `allow_single`，这项已在 r1。
- **§3.3**：改为「不重编号」方案（CODEX-03 ≡ AGY-01）；S0.6 正文的拼接规约（AGY-02）；回显确认挪到预检之后（AGY-04）；逐条列出要改的触点。
- **§3.4**：删除面写全（CODEX-04）。
- **§4.1**：`entry-render-parity` 的 EV-61 断言论域扩到 `run`（CODEX-07）；新增的「解析在预检之前」断言按 S0.5 / S0.6 写。
- **§4.2**：M6 改为「把 S0.6 挪回 S0.5 之前」。
- **§4.3**：E1 / E2 直跑仓库构建产物、不装（CODEX-01）。
- **§5**：加 PROTOCOL :341、QUICKSTART :200、MANUAL §5.4 :468 与 §4.7 :328、两个测试注释，以及「命令 A 不收 / 不接受」的 grep 通则；GLM-02 的残余登记。
- **§7**：去掉 `install:local`；E 读数的命令带 `TRIVIUM_ASSET_ROOT`，只作用于该条命令。

## 3. 其它登记

1. **r1 的一处失实（我自己的）**：§3.3 (c) 把「仓库内缺 `config.yaml` 时回落缺省」写成了普遍情况，漏了 `.trivium/` 整个缺失时 `loadCtx` 会先报错这一档。codex、gemini 各自核出，r2 更正（见 §2 第一条）。
2. **编排器的结构提示是误报**：本轮 codex 与 gemini 都被标了「evidence 引用但未列入 consulted：`src/commands/run.contract.md`、`src/partials/…`」。仓库里根本没有这些路径，真实文件在 `skills-src/` 下，两侧 consulted 里列的也是 `skills-src/…`。成因是 `parse.ts` :226 的路径正则以 `\b(?:src|…)/` 开头，`\b` 在 `skills-src/` 的连字符之后成立，于是截出了 `src/commands/…`。**不影响本轮裁决**（这两侧的实际查阅面齐全），但它会把正常的审查件标成结构有问题。拟登记为 BACKLOG 新条目（编号实施时取下一个空号），不并入本题。
3. **codex 与 glm 盲区里提到的既有措辞**：单侧运行时契约里仍写「两侧模型 / 两侧状态」（B/C/D 同样如此），这不是本题引入的。不在本题改，只在这里记一笔。
