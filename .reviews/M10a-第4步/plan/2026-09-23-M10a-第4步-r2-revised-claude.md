---
schema: trivium.disposition.v1
topic: M10a-第4步
stage: plan
role: claude
kind: revised
run_id: 20260923T121002Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - AGY-01
  - GLM-01
  - GLM-02
  - GLM-03
---

# 裁决：M10a 第 4 步实施计划 · 计划双审第 2 轮

> 被审对象：`2026-09-23-M10a-第4步-r2-claude.md`
> ｜ 运行 `20260923T121002Z`
> ｜ 三侧均为结构化产出（`parse_fallback: false`）
> ｜ 结论：三侧均 `approve-with-nits`
> ｜ 共 9 条：次要 7 ｜ 吹毛求疵 2 ｜ 无阻断、无重要
> ｜ **全部接受；GLM-01 的事实前提经核只对一半，落点按核实结果写**

## 0. 本轮的形状

三个焦点，三侧的正面结论一致：
- **闸 7 的位置**：确实在任何工作树写盘之前。零命中改为整批拒跑不误伤合理写法：今天零命中本就记 ✖ 并在收尾退 1，改动只是把失败提前；
- **不取 `agents.codex.profile` 的两条理由都成立**：`-p` 只进审核者调用的 argv，Driver 会话不经编排器拉起；该字段只有 codex 一家有；
- **find 串**：已写出的六处在实施后的源码上都唯一命中。写点 B 用注释行作区分上下文可以接受：注释被改时闸 7 会在开跑前拒跑。

U5 ② 的改正、驳回 AGY-03、暂缓 AGY-04，三侧都复核为成立。

问题分四类：

1. **D3 的鉴别说明写错了机制（CODEX-03 ≡ AGY-01 ≡ GLM-02，三侧同中）。**
   我写「去掉闸 7 后，D3 的『不留哨兵』『在构建前拒绝』会红」。
   - 前一条不成立：装置干净失败时，`finally` 会把哨兵删掉；
   - 后一条根本不在 D3 的断言清单里。
   真正承重、只有闸 7 能满足的是 stderr 那两条。这与第 3 步 M6c 同族：我对一条用例「靠什么变红」的推演没有对着代码核。
2. **判据覆盖漏了一个带值的改动点（CODEX-01）。** `overrideReasonFor` 函数体内那次 `isHeterogeneous` 的厂商实参，既不在 U7 的论域里（U7 只看两个写点），也进不了单测（函数未导出）。它若写死 `'anthropic'`，非缺省 Driver 下会产出「`heterogeneous: true` 配一条非空 `override_reason`」的自相矛盾件——正是 EV-54 要防的。
3. **r2 自称「逐字写出」而没做到（CODEX-04 ≡ GLM-03）**：12 行里 5 行仍是描述。核的时候又撞见一例：`const runMeta = await readRunMeta(layout, stage, runId);` 在 gate.ts 里出现 **2 次**，照「`verifyRoundForApproval` 内一处锚点」临场挑，很可能挑到它。
4. **两处事实与一处诊断顺序**：
   - driver=codex 两类错判的可达性（GLM-01），经核只对一半；
   - 剧本漏了三行（CODEX-02）；
   - 闸 7 早于哨兵检查，会把「上次异常退出、残留变异」误诊成规格写错（CODEX-05）。

**核实记录**：
- **GLM-01**：本机探针结论（`.trivium/config.local.yaml` 只 grep 模型行，未整段打印）显示，agy 的模型目录里**有** `gpt-oss-120b-medium`。所以「审核者跑 `gpt-*` 被判同族」**可达**：driver=codex 时，gemini 审核者经 `--model-gemini` 显式覆盖即可触发。GLM 依据里「其余三家没有 `gpt-*`」不成立。另一半「审核者跑 qwen 被判异构」：zcode 当前目录只有 GLM 系，agy 与 claude 也没有 qwen，按本机目录**不可达**。探针记录的 zcode `model_id_form` 是自定义 provider 形态，这一格在 zcode 目录出现 qwen 系之后才可达。
- **CODEX-02**：剧本 L211-213 原文如审查所述。
- **CODEX-04**：`const runMeta = await readRunMeta(layout, stage, runId);` 在 gate.ts 里出现 2 次；`const tampered = await checkRecordedArtifacts(layout, [` 与 `export type { Disposal };` 各 1 次；cli.ts 的 `const pinned = …` 那一行 1 次。
- **CODEX-05**：哨兵的 EEXIST 分支确在闸 6 之后、`try` 之前。

**闸门期不改代码。** 以下落点写进 r3 计划稿，在 `/dual-approve` 之后产出。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | minor | 接受 | 属实：`overrideReasonFor` 模块私有，单测进不去；U7 只扫两个写点；全仓只有 `render.test.ts` 断言 `override_reason`，且它直接构造入参。函数体内那次调用若退回 `'anthropic'`，编译、typecheck 都过，缺省 Driver 下行为一致，非缺省 Driver 下产出自相矛盾件。**变异形态要选 tsc 也拦不住的**：函数体用 `desc.display` 拼文案，`driver` 形参仍被读，所以把厂商实参写死不会触发 `noUnusedParameters` | ① r3 §2.5 U7 的纯函数 `heterogeneousWiringViolations` 增加一段：取 `function overrideReasonFor(` 的函数体，要求有 `const desc = agentById(driver)!;`，且体内 `isHeterogeneous(` 的实参块匹配 `/,\s*desc\.vendor\s*,?\s*\)$/`。② U8 增合成源码 (f)：函数体内厂商实参为 `'anthropic'` ⇒ 非空；(g) `desc` 取自 `agentById(DEFAULT_DRIVER)!` ⇒ 非空。③ r3 §6 增 **M62f**：find `if (isHeterogeneous(model, desc.vendor)) return null;` → `if (isHeterogeneous(model, 'anthropic')) return null;`，期望 U7 红（driver-wiring 1）。④ r3 §2.1 第 2 行写明判据落点 |
| CODEX-02 | codex | minor | 接受 | 属实：`CASE_manual_acceptance.md` L211-213「若把某侧显式指定为 `claude-*` slug……在 `run.json` 写 `heterogeneous: false`」，写的正是本步翻转的那一格（非 anthropic Driver + `claude-*` 审核者：false → true），而且是给验收人念的结果预期 | r3 §5.2 把 L211-213 与 L207 并列进 EV-106 移交项，注明要改写成「与当轮 Driver 厂商名义族同族时」的口径，不能只换一个词；同样标「M10b 真载体验收之前必须改」 |
| CODEX-03 | codex | minor | 接受 | 核实属实：装置的 `finally` 在未脏时删哨兵（`if (!dirtyExit) await fs.rm(SENTINEL…)`），闸 5 每条都从备份恢复目标文件。所以去掉闸 7 后，「不留哨兵」「哈希不变」只在那一轮留了脏状态（超时被杀、收尾重建失败）时才红；「在构建前拒绝」不在断言清单里。承重的是 stderr 两条 | r3 §3.5 D3 改为：**承重断言**是 stderr 点名两条 case 与各自的命中数（多处那条写出具体次数，零处那条写 0）。**新增一条可核的「在构建之前」断言**：stderr 不含装置的基线进度行（「基线全绿」字样）。「不留哨兵」「目标文件哈希不变」保留，但注释写明它们是**条件性判别**，只在那一轮留脏时才红。D3 注释写清承重的是哪一条 |
| CODEX-04 | codex | minor | 接受 | 属实。另核出一例证明临场挑串真会出错：`const runMeta = await readRunMeta(layout, stage, runId);` 在 gate.ts 里出现 2 次。M64b 的意图也写过头了：U9 是全 `src/trivium` 的名字判据，裸调用落在 gate.ts 哪个函数都一样红，所以它证明不了「闸门区那一处」 | r3 §6 把五行全部逐字写出：**M62d / M62d′** 写出 U7 里两个锚点正则的源码原文与退化后的原文；**M62e** 写出 §2.3 旗标文案的整句原文；**M64a** find 为 `const pinned = pinnedId ? await readRunMeta(ref.layout, stage, pinnedId) : null;`（cli.ts 唯一）；**M64b** find 为 `const tampered = await checkRecordedArtifacts(layout, [`（gate.ts 唯一，不用出现 2 次的 `const runMeta = …`），在其前插一行裸调用。M64b 的意图改写为「证明 U9 的论域覆盖到 gate.ts，而既有断言只扫 cli.ts」，不再声称证明闸门区某一处。卷首声称改为：除 M-D3 / M-D4 两条手工变异外，全部逐字写出 |
| CODEX-05 | codex | nit | 接受 | 属实：闸 7 若早于哨兵检查，上次异常退出留下的残留变异常使 find 命中 0，闸 7 先开口，读起来是规格写错；修规格正好会把残留固化。这是本仓记过的同形问题（EV-69：症状指向错误的排查方向）。两个方向取前一个：把哨兵检查拆成「只读预检」加「独占创建」，而不是只在文案里提示——文案提示依赖操作者读到并照做 | r3 §3.5：装置顺序改为 **闸 6 → 哨兵只读预检（存在即以原 stale 文案拒跑、原样保留哨兵）→ 闸 7 → 哨兵独占创建（`wx`，保留为并发闸）→ `try`**。stale 文案抽成一个函数，两处共用，不写两份。新增锁例 **D4**：先放一个哨兵，再给一份 find 多处命中的规格 ⇒ stderr 含 stale 文案、不含闸 7 文案，哨兵原样保留（照 D1 先例在 `finally` 里清理）。变异 **M-D4**（把闸 7 挪回哨兵预检之前）按 D1 / D2 先例手工做 |
| AGY-01 | gemini | minor | 接受 | 与 CODEX-03、GLM-02 ① 同一处，核实属实。另采纳其附带建议：D3 的规格要给 `suites` 指定一个轻量的既有套件，否则去掉闸 7 的手工变异会意外跑全量测试 | 同 CODEX-03；另在 r3 §3.5 写明 D3 规格的 `suites` 取一个轻量的既有编译产物套件，**不取 `mutation-device.test` 自身**（会递归拉起装置） |
| GLM-01 | glm | minor | 接受 | 方向属实：r2 把两类错判当作确定会发生的代价写，而其中一类按本机目录不可达，属于没核实就写进落点。但依据只对一半：agy 模型目录里有 `gpt-oss-120b-medium`，所以「审核者跑 `gpt-*` 被判同族」可达。「审核者跑 qwen 被判异构」按本机目录不可达，zcode 目录出现 qwen 系之后才可达 | r3 §2.2 代价段与 §2.6 EV-107 ① 改为按可达性分写：**可达**——driver=codex 时，gemini 审核者经 `--model-gemini gpt-oss-120b-medium` 显式覆盖，被判同族，而 Driver 实际跑的多半是 qwen；**本机目录下不可达**——审核者跑 qwen 被判异构，要等 zcode 目录出现 qwen 系（它支持自定义 provider）才可达。另补 GLM 给的一个可达实例：driver=claude 而 Claude Code 实际接的是别家模型时，gemini 审核者经显式覆盖跑 `claude-*` 被判同族。依据写「本机探针的模型目录」，不写成全称 |
| GLM-02 | glm | minor | 接受 | 三件都属实：① 同 CODEX-03；② M-D3 去掉闸 7 后装置会真跑，可能超时被杀留下哨兵，也会真对一个仓库文件做「变异 + 恢复」和两次构建，手工步骤没写收尾；③ D3 不先断言规格前提，目标文件漂移后（多处串恰好变唯一）会悄悄只覆盖零命中分支 | r3 §3.5：① 同 CODEX-03。② M-D3 / M-D4 手工步骤补收尾：跑完若有哨兵残留则删掉；`git status` 核对目标文件与 `dist/` 未留改动；恢复装置文件并逐字节比对。③ D3 在拉起装置之前**先自己断言规格前提**：多处串在目标文件中计数 ≥ 2、零处串计数为 0，前提不成立即以「夹具漂移」为由干净地红。D3 的目标文件取一个不进构建图的文件，免得手工变异时改坏构建 |
| GLM-03 | glm | nit | 接受 | 与 CODEX-04 同一处，核实属实 | 同 CODEX-04 |

## r3 相对 r2 的改动清单

1. §2.2 / §2.6：driver=codex 的错判按可达性分写，补一个可达实例（GLM-01）。
2. §2.1 / §2.5 / §6：`overrideReasonFor` 函数体内的厂商取值纳入 U7，U8 增 (f)(g)，§6 增 M62f（CODEX-01）。
3. §3.5：
   - D3 的承重断言与条件性断言分开写，新增「构建前拒绝」断言，先断言规格前提，指定轻量 `suites`，目标文件不进构建图（CODEX-03 ≡ AGY-01 ≡ GLM-02）；
   - 哨兵拆成只读预检加独占创建，闸 7 夹在中间，新增 D4 与 M-D4（CODEX-05）；
   - 手工变异补收尾步骤（GLM-02）。
4. §5.2：剧本 L211-213 并入移交项（CODEX-02）。
5. §6：全部 find 串逐字写出，M64b 换唯一锚点并改写意图（CODEX-04 ≡ GLM-03）。
