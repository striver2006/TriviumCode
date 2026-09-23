---
schema: trivium.disposition.v1
topic: M10-任意Driver
stage: code
role: claude
kind: response
run_id: 20260923T030441Z
addresses:
  - CODEX-01
  - CODEX-02
  - CODEX-03
  - CODEX-04
  - CODEX-05
  - CODEX-06
  - CODEX-07
  - CODEX-08
  - AGY-01
  - AGY-02
  - AGY-03
  - AGY-04
  - GLM-01
  - GLM-02
  - GLM-03
  - GLM-04
  - GLM-05
  - GLM-06
---

# 应答：M10a 第 2 步（EV-55 跨时间面重写）代码双审 第 2 轮

> 被审对象：相对 `e1a0d9a` 的 10 个文件变更，补丁 27.8 KB ｜ 运行 `20260923T030441Z`
> ｜ 三侧均结构化产出（`parse_fallback: false`），三侧结论均为 `request-changes`
> ｜ 共 18 条：阻断 1 ｜ 重要 5 ｜ 次要 10 ｜ 吹毛求疵 2

## 总述

18 条全部接受。按三簇处理：

1. **行为缺口（CODEX-01、CODEX-03、GLM-03、AGY-02/GLM-06、CODEX-08、CODEX-04）**：
   - CODEX-01 的绕过面我已照原理核对：`WRITE_LIKE` 的 git 分支前缀 `(?:-[^\s]+\s+)*`
     吃不下「选项与取值分两个 token」的形态，`git -c k=v restore …` 过不了 `writeLike`。
     这个缺口在本 diff 之前就有，但本 diff 新加的文案把它写成「必然被拦、Bash 工具做不到」，
     等于把一个启发式判定包装成了确定性保证，还随 protocol snippet 装进下游项目。代码和文案两头都要改。
   - CODEX-03 成立，而且是计划 §3.1.2 自己的要求没落完整：计划写明「判据从后缀改为位置，
     原稿与审查件的不可变性改由锚②按登记承接」。我核过，审查文档自 M1 起就经
     `artifacts.push(written.absPath)` 登记进 `artifacts[]`（review.ts:1258 → :1490-1494），
     所以锚②已经覆盖它们。`immutableChangeReason` 里残留的 `hasRoleSuffixCrossTime` 一支
     是冗余的，而且对非缺省 Driver 起反作用。删掉。
2. **扫描判据空转（CODEX-02、GLM-01、AGY-03、CODEX-05、CODEX-07、GLM-05）**：
   我用只读脚本按测试原算法复算，结果与 codex、glm 一致：六处命中 `inDomain` 全为 false，
   离得最近的保护字面量分别在 705、725、864、889、1403 字符外，guard.ts 那处没有。
   这条测试今天不可能变红。**AGY-03 的事实前提有误**：它说 hooks.ts:1302 靠 1273 行的
   `task.json` 落在窗口内而命中，实测最近距离是 889 字符，并没有命中。
   它的结论（窗口巧合、脆弱）方向对，而实际情况比它说的更糟。
3. **测试矩阵缺口（AGY-01、AGY-04、GLM-02）与留痕（CODEX-06、GLM-04）**：
   我在改动说明里说「低风险不补」，三侧都不认同。尤其 GLM-02 指出 §8 列出的五条 3.1.1 变异
   只有一条有可红用例，我同意。本轮补齐。「预检标注」那半登记为偏差，不再静默缺席。

**闸门期不改代码**。以下落点全部在 `/dual-approve` 之后实施，实施后再走一轮代码双审。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | blocker | 接受 | 核对属实：git 分支的选项前缀只吃单 token 形态，`git -c core.quotePath=false restore -- <_meta 路径>`、`git -C <目录> checkout -- <-gemini.md>` 过不了 `writeLike`，`hookPreBash` 第一道门就放行，独占保护与闸门写锁一起失效。既有负例 hooks.test.ts:475 是靠取值里的 `rm` 字面命中蒙过的，不能算覆盖。缺口在本 diff 之前就有，但本 diff 的文案把它断言成确定性保证并装进下游，所以本轮必须处理 | ① `src/trivium/hooks.ts` 的 `WRITE_LIKE` git 分支：选项前缀改为「`GIT_OPTS_WITH_VALUE` 中的选项多吃一个取值 token」，与同文件 `commitTargetsProject` 共用这一份知识（抽一个共享的选项前缀片段，不抄第二份）；② `test/unit/hooks.test.ts` 补负例：`git -c core.quotePath=false restore -- <_meta 路径>`、`git -C <目录> checkout -- <角色后缀审查件>`、`git --git-dir <x> restore …` 三种形态均须被拦，另补一条正例 `git -c core.quotePath=false log` 仍放行（防止收紧成误拦）；③ CLAUDE.md、skills/dual-critic/protocol/CLAUDE.md.snippet、hooks.ts 两处 deny/恢复文案改为与「启发式、不完备」同源的措辞：常规写法会被拦，恢复请在终端执行，绕过判定属违规而不是出口；删掉「必然结果 / Bash 工具做不到」这类确定性表述 |
| CODEX-02 | codex | major | 接受 | 复算属实：`WINDOW=400` 下待判定集为空，六处命中全部 `continue`，删掉全部「终端」提示仍然全绿。计划 §3.2.2 把它当第 2 步的收尾判据，现状等于没有这道保证 | `test/contract/bash-recovery-wording.test.ts` 重写判据：① 论域从「±400 字符窗口」改为「命中所在的语句组」（同一模板串或同一 `[...].join` / `+` 拼接组），每组要么含「终端」，要么命中一条具名豁免（如 guard.ts:759「对象通常是业务文件」，豁免表自身扫描防过期）；② 下限断言：hookPreBash 的 deny 文案与 `checkArchiveIntegrity` 的恢复指引这两处已知站点必须进论域；③ 真变异腿：在内存里从 hooks.ts 源文本删去这两处的「终端」句，判据必须报出 offender |
| CODEX-03 | codex | major | 接受 | 核对属实：hooks.ts:498 的 `hasRoleSuffixCrossTime` 支以「全集减 claude」为保护集，非缺省 Driver 的原稿与裁决件会被判「改动即伪造」，§3.1.4 行为表与 §3.1.5 两个出口对这一族不成立。计划 §3.1.2 已写明不可变性改由锚②按登记承接，而审查文档自 M1 起就登记在 `artifacts[]` 里（review.ts:1258、:1490-1494），删掉这一支后保护不丢 | ① `src/trivium/hooks.ts` `immutableChangeReason` 删除 `hasRoleSuffixCrossTime` 支，文档块同步改成「位置判据 + 锚②登记」两条；② 全仓检索 `hasRoleSuffixCrossTime` 的其余消费点，没有消费点就连同其文档引用一并删除，由 registry-parity 相关用例兜住；③ `test/unit/hooks.test.ts` 补鉴别用例：以非缺省 Driver（如 codex）为当轮 Driver，已提交的 `-codex.md` 原稿与 `-response-codex.md` 裁决件原地改后 ⇒ 可提交；另补一条「已登记的审查文档被改 ⇒ 仍由锚②拦下」，证明删支后保护还在 |
| CODEX-04 | codex | minor | 接受 | 我在改动说明里以为「删掉恢复建议、只留重跑」不丢出口，这个判断不对：该 `review-*.json` 已登记在本 run 的 `artifacts[]` 里，重跑只产生新 run，锚②会一直以「已丢失」拦下任何提交，重跑不能替代恢复。glm 的正面结论只核了「会话内恢复走不通」这半，没核锚②不解 | `src/trivium/gate.ts` missing_review_json 文案改为：「该结论文件已丢失或被改动；恢复需在终端完成（会话内的恢复命令会被 Hook 拦下）；也可以重跑一轮，但重跑不能解开提交锚，恢复或 `/dual-abandon` 仍是必经步骤」，措辞与 `checkArchiveIntegrity` 的恢复指引同源；`test/unit/gate.test.ts` 相应正反断言同步修改 |
| CODEX-05 | codex | minor | 接受 | 行号在剥注释后的文本上算，块注释连同其中的换行被压成一个空格，报错行号整体前移数百行。一旦判据真的变红就会指错位置 | `test/contract/bash-recovery-wording.test.ts`：剥注释时把被剥内容替换成等量换行（保留行结构），行号即原文行号；另加一条断言，合成样本的报错行号必须与原文一致 |
| CODEX-06 | codex | minor | 接受 | 属实：计划 §3.1.1 域行要求「run.json 与预检如实标注」，预检这半没落，也没有登记偏差。原因与 §7.4 偏差 1 同源：`preflight` 只接 `--stage`，不知道主题和被审对象 | 偏差登记落在 `doc/08_project/BACKLOG.md` 的 EV-55 条目和本主题开发日志，写明「预检标注未做，标注实际出现在 run.json 的 `gate.warnings` 与收尾 stderr，原因同 §7.4 偏差 1」；另与 GLM-04 合并，让标注有读者（见 GLM-04 落点）。r7 计划稿是已审留痕，不回改原文 |
| CODEX-07 | codex | minor | 接受 | ① `GIT_RECOVERY_RE` 只认 git 后紧跟子命令，而本仓 AGENTS.md 纪律 4 要求所有 git 调用前缀 `-c core.quotePath=false`，正好漏掉 CODEX-01 那条能在会话内得手的形态；`switch/clean/revert` 也没纳入。② 正则剥注释会切断字符串中的 `//` | `test/contract/bash-recovery-wording.test.ts`：正则放宽为允许 git 与子命令之间出现取值型选项（与 CODEX-01 修改后的守卫侧共用同一形态描述），子命令并入 `switch|clean|revert`；剥注释改为字符串感知的实现（与 GLM-05 同一落点），为 `//` 与 `/*` 两种失效形态各加一条防空转腿 |
| CODEX-08 | codex | nit | 接受 | 纯词法判据对软链写法敏感：同一个归档内文件经 `/var`→`/private/var` 这类不同写法给出时会被判为域外，静默失去保护，notice 的理由也是错的。仓库对同一个坑已有先例（`isInsideArchiveResolved`） | `src/trivium/review.ts` 登记处：两侧先 `realpath` 再求 `path.relative`（`subjectArtifactRelPath` 保持纯函数，由调用方传入解析后的路径）；`test/unit/subject-artifact.test.ts` 或集成用例补一条「经软链写法给出的归档内原稿仍登记」 |
| AGY-01 | gemini | major | 接受 | 属实：fault-injection 只断言条目存在、哈希可还原，没有验证「登记后原地改 ⇒ 提交被拦」，这是登记生效的前提链；「作废轮原稿可改」也没有用例 | `test/integration/fault-injection.test.ts` 补两条：① 成功收尾后原地改原稿，调用 `hookPreCommit`，断言 `EXIT.GATE_BLOCK` 且 stderr 含该原稿路径；② 构造作废轮（stub 期间改稿制造 `subject_drift`），断言 `artifacts[]` 无原稿条目，且之后原地改 ⇒ `hookPreCommit` 返回 OK。此处与 GLM-02 (a)(d) 同一落点 |
| AGY-02 | gemini | minor | 接受 | 属实：`subjectPath === archiveRoot` 时返回空串，调用方会把 '' 当成有效路径登记，`path.join` 回归档根目录后哈希抛错。同仓 `isOrchestratorOwned` 已统一用三条件排除；单测把 '' 钉成期望值是错的 | `src/trivium/review.ts` `subjectArtifactRelPath` 排除条件改为 `rel.length === 0 \|\| rel.startsWith('..') \|\| path.isAbsolute(rel)`；`test/unit/subject-artifact.test.ts` 该边界用例改为断言 `null`，并注明「归档根本身不是可登记对象」 |
| AGY-03 | gemini | minor | 接受 | 结论方向成立，事实前提需要更正：它说 hooks.ts:1302 的恢复指引靠 1273 行的 `task.json` 落进 400 窗口而命中；我复算的最近距离是 889 字符，实际**没有**命中，六处全在论域外。问题比它描述的更糟：不是「将来可能跳过」，而是现在就已经跳过。剥注释会误伤字符串的问题同样成立 | 与 CODEX-02 同一落点（论域改为语句组 + 已知站点下限断言 + 变异腿）；剥注释的修正与 CODEX-07 / GLM-05 同一落点 |
| AGY-04 | gemini | minor | 接受 | 属实：「裁决件原地改 ⇒ 可提交」与「归档外被审对象不登记 + 标注 + 随后可提交」都是 §3.3 承诺的用例，我在改动说明里以「低风险」为由暂缓，但 CODEX-03 表明前者恰好是缺陷的鉴别用例，不是低风险 | 裁决件用例与 CODEX-03 ③ 同一落点（按非缺省 Driver 写）；归档外端到端落在 `test/integration/fault-injection.test.ts`：`--plan-file` 指向夹具归档外的文档，断言 run.json `gate.warnings` 含「不在保护集」、`artifacts[]` 无该条目，之后改它 ⇒ `hookPreCommit` 返回 OK（与 GLM-02 (c) 同一落点） |
| GLM-01 | glm | major | 接受 | 复算属实，与 CODEX-02 同一结论；另外它指出了宽松方向的偏离：窗口内任意位置出现「终端」都能满足要求，即使那个词来自相邻的无关文案 | 与 CODEX-02 同一落点。论域改为语句组后，「终端」也必须出现在同一组内，宽松方向随之关掉；具名豁免表按它的建议实施 |
| GLM-02 | glm | major | 接受 | 属实：§3.3 / R-a 点名的登记三要素正负例大面积缺席，§8 列出的五条 3.1.1 变异只有一条有可红用例；夹具本轮已经就位，每条都只要几行，「低风险不补」站不住 | 本轮补齐六项：(a) 作废轮不登记，同 AGY-01 ②；(b) code 轮不新增原稿登记条目（`runInjected --stage code`，断言 `artifacts[]` 中原稿形态的条目数为 0，只有 `changes-<runid>.diff`）；(c) 归档外端到端，同 AGY-04；(d) 登记后锚②拦截，同 AGY-01 ①；(e) 裁决件原地改可提交，同 CODEX-03 ③；(f) Bash 恢复命令被拦，同 CODEX-01 ②。实施后按 §8 逐条跑变异（登记时点移回 `--start`、去掉阶段门控、去掉域检查、登记改绝对路径、删除 run-*.json 例外），每条都须有用例变红，结果写进测试报告 |
| GLM-03 | glm | minor | 接受 | 属实：计划 R-j 写死「sha256 = 冻结时的 subject_sha256」，实现却在收尾时重新读盘计算。在漂移复算点（review.ts:1055）与登记点之间有窗口，窗口内若原稿被改写，篡改版会被锁成基线，run.json 的 `snapshot.subject_sha256` 与 `artifacts[]` 条目也会自相矛盾。改用冻结值属于 fail-safe 方向：窗口内被改的文件会在下一次提交时被判 modified | `src/trivium/review.ts` 登记条目的 `sha256` 改用作用域内的 `primarySnap.subjectSha256`；fault-injection 用例补一条断言：登记哈希等于 run.json `snapshot.subject_sha256` |
| GLM-04 | glm | minor | 接受 | 属实：`meta.gate.warnings` 只写不读，「预检」半句没有承载面；本仓对「拿预检当不存在的面」已有先例 | ① 偏差登记同 CODEX-06；② 让标注有读者：`gate --check` 的输出透传该主题当前阶段 run.json 的 `gate.warnings`（JSON 里加 `warnings` 字段，人读输出加一行），`test/unit/gate.test.ts` 补一条断言 |
| GLM-05 | glm | minor | 接受 | ① 保护字面里的 `-codex\.md\|-gemini\.md\|-glm\.md` 是手抄的第二份登记事实，第五家接入时论域会静默变窄，与纪律 10/11「注册表派生」相悖；② 剥注释不感知字符串，`/*` 会与后面的 `*/` 配对吞掉源码，registry-parity 记载过同一个坑 | `test/contract/bash-recovery-wording.test.ts`：后缀集改为 import 注册表派生（`ALL_AGENT_IDS` 构造 alternation，保护语义取「全集」，因为恢复文案不区分当轮 Driver）；剥注释改为字符串感知，同 CODEX-07 落点 |
| GLM-06 | glm | nit | 接受 | 与 AGY-02 同一问题：空串是「归档根本身」，不是可登记的工件路径 | 与 AGY-02 同一落点 |

## 实施后的核对口径

- `npm run typecheck && npm run build && npm test` 全绿；
- §8 列出的 3.1.1 变异与本轮新增的三条变异（CODEX-01 守卫前缀还原、扫描判据变异腿、`hasRoleSuffixCrossTime` 支复原后非缺省 Driver 用例）逐条跑，每条都须有用例变红，结果写进 `doc/05_testing/`；
- 进入下一轮代码双审（第 3 轮）。
