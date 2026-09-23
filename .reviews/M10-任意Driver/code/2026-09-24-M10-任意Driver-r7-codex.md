---
schema: trivium.review.v1
topic: M10-任意Driver
stage: code
role: codex
vendor: openai
agent_cli: codex/0.156.1
model_requested: deepseek-flash
model_effective: deepseek-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260923T164705Z
rerun_index: 7
snapshot_hash: sha256:5ba1313ef9d6754b754052c21f8078830d6ec9b7dd9a3b8bf2e8dc1fd011711d
blind: true
started_at: 2026-09-23T16:47:06.750Z
finished_at: 2026-09-23T16:58:10.482Z
duration_s: 354
tool_calls:
  run_command: 124
  project_reads: 45
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 3
  nit: 2
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0cf29-eed9-7610-8f30-9f2fd22b9042
---

# 代码审查：M10-任意Driver

> Critic-C · OpenAI Codex ｜ 模型 `deepseek-flash`
> ｜ 运行 `20260923T164705Z` ｜ 第 7 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

本次被审对象是纯文档回溯 + 一份 grep 扫描脚本，没有业务代码改动；焦点五问的实质结论都成立：verify 工件的「单锚变双锚」对着 verify.ts 与提交锚代码成立，16.1 的 M10a/M10b 两行与 r7 §0.2/§0.3、P-2 逐条对得上，AC-21 只标子句 ③ 与第 12 章子表内部自洽，报告 §7 附的 .reviews/README.md 差异与真实文件逐字一致。没有发现 blocker/major，均未上「线上出错」的门槛。值得改的是四条小的：① 扫描脚本的论域与人读结论不符——`.reviews/README.md` 实际从未被扫，而 evidence 明确把一处命中归属给它；② 该脚本的输出路径用 URL.pathname、工作目录取 process.cwd()，换环境即崩或静默写错证据；③ RUNBOOK 的恢复处置没明示「在终端执行」，与同批改准的三处文档相反；④ 主设计 7.1 与 16.1⑥ 的「Hook 第 2 级在技能链路上取不到声明」字面与 8.5 结局② 相反。另有 PRD §3.2 的版本指针仍停在 v1.3.6。

**结论**：`approve-with-nits`

## 审查意见（共 5 条：次要 3 ｜ 吹毛求疵 2）

### CODEX-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/evidence/m10a-step5-20260924/grep-anchors.mjs:34-57、:81；同目录 grep-anchors.md:5、:20` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：第二层核法（grep 锚差集）把 `.reviews/README.md` 排除在论域之外，但脚本注释与 evidence 都声称它在论域内。`excluded()` 对目录先判：walk 拿到 `.reviews` 时求 `excluded('.reviews/')`，而 `'.reviews/' !== '.reviews/README.md'` 恒真 ⇒ 整棵归档子树不递归，那条文件级例外永远触发不到。后果有三：①本步改过的 `.reviews/README.md`（归档根内唯一被补丁剔除的改动，只能靠报告 §7 的附 diff 看到）没有经过锚差集核对；②`grep-anchors.md` 的「论域……`.reviews/` 下除 `README.md` 外」与实际论域不符；③同文件 B5 的增量解释「`.reviews/README.md` 新节（论域内只计 README 一份）」是无据归属——那份文件的命中一处也不在输出里。

**依据**：读 grep-anchors.mjs 的 excluded()（:34-40）与 walk（:47-57）：目录分支 `if (!excluded(rel + '/')) walk(abs)` 对 `.reviews/` 返回 true 即停。实测 `grep -c '^\.reviews/' grep-anchors.after.txt` 与 `.before.txt` 均为 0（脚本自报「论域文件数：118」）。读 grep-anchors.md 第 5 行（论域声明）与第 20 行（B5 归属）。对照 REPORT_2026-09-24_m10a_step5.md §1.4 的 R1/R2/R3 行：`.reviews/README.md` 确是本步改动之一。

**建议**：把目录级排除改成逐层放行（进 `.reviews/` 但只 push 其中的 README.md），或在 docstring、grep-anchors.md 与报告里如实写明该文件不在论域；B5 那句归属要么删掉、要么指向真实命中的文件。若要保留「论域内只计 README 一份」的写法，必须真把它扫进来重跑一次 after。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/06_deployment/RUNBOOK_pipeline_ops.md:300（「提交被拦下，说『归档留痕不完整』」一节的处置句）` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：该段刚在本补丁里改准了锚的归因（位置 + 登记），紧邻的处置句仍写「把被删/被改的文件恢复回去（`git checkout -- <path>`）」，没有明示「在终端执行」。同一时点、同一动作，其它三处都明示了：hooks.ts 提交锚 stderr「**这一步请在终端里手动执行**」（:1386-1391）、MANUAL §8.1（:648）、`.reviews/README.md` 的 Bash 段。而恢复对象是归档内的 `_meta/` 与角色后缀文件，命中 `bashTargetsProtected` 的 MENTIONS_OWNED/字面后缀，会话内照抄会被 hook-pre-bash 拦下——正是 r7 §3.2.2 立「对象带保护字面 ⇒ 必须改判据式并明示执行位置」所要防的形态（该判据那次的扫描面被限定在 `src/trivium/` 的运行时文案，文档没进论域）。

**依据**：读 RUNBOOK:295-302；读 src/trivium/hooks.ts:1385-1391 的 stderr 文案；读 doc/07_manuals/MANUAL_user.md:648 的终端出口；读 .reviews/README.md 新增节的 Bash 侧段（「恢复或清理带后缀、`_meta` 的文件请在终端执行」）；读 .reviews/M10-任意Driver/plan/2026-09-22-M10-任意Driver-r7-claude.md §3.2.2 的判据与清单。

**建议**：该句补「请在终端手动执行」（或按 gate 那处的做法改留「重跑一轮」这个会话内可行出口），并把「文档面的教学恢复语句」补进 §3.2.2 的巡检面或放慢到残余清单里，别让它成为第四处相反出口。

### CODEX-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/01_requirements/PRD_driver_dual_critic.md:157-167（3.2 实现状态块），指针在 :166` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：该块本版只改了第一句（FR-28 随 M10a），周边两处没跟上：①依据指针仍写「五条演进需求的设计依据见[设计 v1.3.6] 16.1 二期里程碑表与 §24 台账」，已是 31 个补丁版本之前的标签（同批 MANUAL / QUICKSTART / PROTOCOL / `.reviews/README.md` 的指针都跟到了 v1.3.37）；②「系统的**现状能力止于 FR-01～FR-26**，外加……（M7a）与 M7b 六步……第三家（Codex，M8）与第四家（Claude Code，M9）审核者均已接入」的枚举里没有 M10a 交付的编排器侧 Driver 判定与护栏，而读者正是被这段话告知「现状能力到哪为止」。这两处都不在报告的残余待办 ①～⑤ 里。

**依据**：读 doc/01_requirements/PRD_driver_dual_critic.md:155-168；对照本补丁对同批文档指针的改动（REPORT_2026-09-24_m10a_step5.md §1.4 的 I1/Q1/M3/M4/P2 行与 doc/02_design/README.md 的 v1.3.37）；读 REPORT_2026-09-24_m10a_step5.md §3 的残余待办表（①②③④⑤）核对未收录。

**建议**：指针跟到 v1.3.37，并在「现状能力」枚举里补一句 M10a 的份额；若刻意不改，按本步自己的规矩登记进残余清单并给出去向，别留一处静默过期。

### CODEX-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/05_testing/evidence/m10a-step5-20260924/grep-anchors.mjs:20、:81` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：两处环境耦合会让复跑静默给出错误证据：①`:81` 用 `path.dirname(new URL(import.meta.url).pathname)` 当文件系统路径，没走 `fileURLToPath`——仓库路径含空格或非 ASCII 时 pathname 是百分号编码（`%20`），拼出的目录不存在，脚本以 ENOENT 崩掉；②`:20` 的 `ROOT = process.cwd()` 让「从哪跑」决定扫描哪棵树，而从非仓库根执行时它照样把结果写进 evidence 目录，产出一份看起来正常的错证据。本机路径无空格、且按注释在仓库根执行，所以这次没暴露。

**依据**：读 grep-anchors.mjs:20（ROOT=process.cwd()）与 :81（writeFileSync 的 URL.pathname）。grep-anchors.md 第 42-46 行的「复跑方式」把「仓库根执行」写在注释里，但没有运行时守卫；全仓以仓库根为唯一入口假设，未做断言。本仓路径 /Users/chenzhenbo/Work/TriviumCode 不含空格/非 ASCII，故本次未触发。

**建议**：改用 `fileURLToPath(import.meta.url)` 求脚本所在目录；开头断言 `process.cwd()` 是仓库根（存在 package.json 与 .reviews/），否则退非零并提示，不要静默写文件。

### CODEX-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:1237（7.1 topic claim 段末）与 :2991（16.1 M10a 行达成边界⑥）` |
| 类别 | contract ｜ 层次 code |
| 置信度 | low |

**问题**：两处都写「四条 `/dual-*` skill 都不认领，**Hook 第 2 级在技能链路上取不到声明**」。前半句属实，后半句按其字面（Hook 拿不到声明）不成立：Hook 的当轮 Driver 由 driver-claim 的三级判定给出，第 2 级直接读 `task.json.drivers[<阶段>]`，与「走 skill 还是手工 CLI」无关——只要有人手工声明过，技能链路上的 Write 照样取到声明。同一份设计的 8.5 结局② 写的就是「该阶段尚无任何留痕 → 取该阶段的声明」，与本句相反。真实现状是「skill 链路上没有人发起认领」，不是「Hook 取不到」。这是契约文里唯一一处把「没人发声明」写成「Hook 取不到」的地方，M10b 要照它做 skill 侧认领步骤，容易被读成 Hook 这一级在技能链路上失效。

**依据**：读主设计 :1237 与 :2991⑥；读 :1523-1531（8.5 结局②「取该阶段的声明，无声明才回落缺省 Driver，拦截文案注明取值来源」）；读 src/trivium/hooks.ts:345-348（resolveRoundDriver 转发）与 src/trivium/driver-claim.ts:111-130（resolveStageDriver 第 2 级读声明）；实测 skills/ 下 grep 'claim' 零命中（四条 /dual-* 确不认领）。

**建议**：改写为「四条 `/dual-*` skill 都没有认领步骤（声明只能手工发；Hook 第 2 级只有在有人手工声明过时才有值）」，两处同改。

## 认为正确的部分

- 焦点四后半成立：`verify-*.json`「由锚②单层变锚①②双层」对代码属实。verify 的运行清单把记录文件与 `verify-<run_id>.json` 双双登记进 `artifacts[]`（src/trivium/verify.ts:198-222），`listRecordedRuns` 的论域含 verify 且接受 `trivium.verify-run.v1`（src/trivium/archive.ts:548-580、:520-545），`checkArchiveIntegrity` 把它交给 `checkRecordedArtifacts`（src/trivium/hooks.ts:1370），而位置判据 `relFromRoot.split('/').includes('_meta')`（hooks.ts:485-500）确实覆盖 `<主题>/verify/_meta/…`。把 r7 §3.1.3 / A5 的「由不受保护变为受保护」自我纠正为「单层变双层」是对的。
- 焦点三前半成立：16.1 的两行与 r7 §6.2/§0.3 对得上——前置四条按 ②③④ → M10a、① → M10b 重排，显式裁决「前置 ① 不构成翻 driverEnabled 的前置」原文写入，且注明「这是对原前置『四条，缺一不可』的改，不是从原文读得出的解」。M10b 行按 P-2 写「ZCode 真载体一轮、不接受降级，codex / gemini 夹具级」与 M10b 计划 §1 J4、D6 一致，且 M10b 计划原本就要求把 §16.1 原行的「ZCode/Codex 夹具跑通」上调，此处拆行时即按 P-2 写入是妥当的。
- 焦点四前半成立：AC-21 只标子句 ③ 与第 12 章子表自洽（抬头 / 3.2 / FR-28 条目 / AC-21 达成边界 / 演进行 + 子表五处口径一致），子句 ① ② 归 M10b 与设计 8.5 引言块「这一条仍未交付」同口径。
- 焦点二：核到的六处边界都写成了边界而非保证，没有发现被写成确定性保证的句子——8.4 的三条（只核本轮 / 不查未登记件混入 / 不保审批来自人）、8.5 Hook 表的强制力单向 + 剩余两格 + 预检未标注、11.5「判据两层都是启发式，不是确定性保证」、7.1「64 收紧只作用于经过 resolveDriver 的入口，不是全称保证」并列出四个不经过它的面、topic claim 段的「这不是机械边界」、6.2/README/MANUAL/协议片段的「启发式」。
- 焦点三八条边界抽查六条对代码属实：②四个面与 critics.ts:168-180 文档块逐字同款；③对应 immutableChangeReason / runningRewriteViolation（hooks.ts:455-540）；⑤对应 gate.verifyRoundForApproval 与 cli.cmdApproval 的「先全部复核再落审批」结构，且 approval.ts 明写 verifiedRunId 不证明复核跑过；⑥driver-claim 分支 1/2/3/3′/4 与设计 7.1 分支表逐行一致、skills 下 grep 'claim' 零命中；⑦VENDOR_MODEL_FAMILY + isHeterogeneous（registry.ts:60-65、adapters/base.ts:1790-1793）；⑧PRD 内部自洽。
- 焦点五：报告 §7 附的 `.reviews/README.md` 差异与真实文件逐字一致——我用 `git diff HEAD -- .reviews/README.md` 对照了四个 hunk（抬头、正交段、verify/ 行、新增「提交时的留痕核对」节），无增无漏；补丁剔除归档根后靠这一段让审查员核对的做法成立，且该节两条判据、登记三要素、running 例外、三条边界与 Bash 侧口径都与 hooks.ts / review.ts:1560-1590 / archive.ts:440-470 相符。
- 焦点一的来源倒查抽查通过：r7 §6.2 各行、BACKLOG EV-106（结案段逐处点名 + 落点）、第 2/3/4 步报告的缺口节、U1～U11 十一项在报告的逐项/反向表里都有落点；EV-55 结案段的两处跨时间面收口与 verify 双锚口径属实；EV-108 按「触发条件不同」拆条的理由成立。
- grep 锚差集的自洽性抽查通过：after.txt / before.txt 的计数与报告 §3 表一致（64/59/29/36/81/40/86 与 89/54/25/33/71/30/92），且 after 的行号与当前工作树逐点相符（抽查 design:381、:855、:890 与 PRD:31）。
- 环境与编码：四个新证据文件与报告均为 UTF-8 无 BOM、以换行结尾（`file` 与 `od` 核过）；脚本只依赖 node:fs / node:path 与 import.meta.url，Node ≥ 18 可用，无平台特有调用。

## 未覆盖范围（本侧盲区）

- 未执行任何写命令，也未运行 `node …/grep-anchors.mjs`（它 writeFileSync 落盘）、`npm test`、`npm run typecheck`：脚本的可运行性只做了静态阅读，报告 §0 的 1709 条全绿、6 个契约套件 73 条、`trivium doctor --selftest` 14/14 均未复核。
- 达成边界①「零真实 CLI 调用」只能读到报告的自述，只读手段无法证实；也未核 M10a 各步的双审轮次与墙钟（doc/08_project/M10a-轮次台账.md 只作为对照读了 §0/§2）。
- 「开工指令十一项」的**原文**不在仓库内，我能看到的只有 r1/r2 计划里以 U1～U11 为标记的转写；§2.3 的十一项对账是按该转写核的，未与用户原始指令逐字比对。
- 未复核 §24.2「十二行」之外的其它台账行号与 BACKLOG 全表状态列；未逐行复核冻结的演进设计正文（只核了 §14 M10 行、§5.4/§9.4 的指针与 §24.1 新增行的说法）。
- 未核各厂商 CLI 行为类判据（agy skills 加载、ZCode 真载体、codex `$ARGUMENTS`），那是 M10b 的范围；`doc/02_design/reference/` 与历史报告/evidence 未作为现状依据。
- 残余待办⑤（`peer_artifact_globs` 是否仍有消费方）与报告 §5 自认的其它未核项（冻结哈希/收尾重算不可鉴别、变异归因推断等）我同样未核，只确认它们在报告里被如实登记。

## 实际查阅的项目文件

- `.reviews/M10-任意Driver/code/_meta/changes-20260923T164705Z.diff`
- `.reviews/M10-任意Driver/plan/2026-09-22-M10-任意Driver-r7-claude.md`
- `.reviews/M10a-第5步/plan/2026-09-23-M10a-第5步-r2-claude.md`
- `.reviews/M10a-第5步/plan/2026-09-23-M10a-第5步-claude.md`
- `.reviews/M10b-入口资产与真载体验收/plan/2026-09-22-M10b-入口资产与真载体验收-claude.md`
- `.reviews/README.md`
- `doc/01_requirements/PRD_driver_dual_critic.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/02_design/README.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/03_api/README.md`
- `doc/05_testing/CASE_manual_acceptance.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-09-24_m10a_step5.md`
- `doc/05_testing/REPORT_2026-09-23_m10a_step2_ev55.md`
- `doc/05_testing/REPORT_2026-09-23_m10a_step3.md`
- `doc/05_testing/REPORT_2026-09-23_m10a_step4.md`
- `doc/05_testing/REPORT_2026-09-23_m10a_step5_d3.md`
- `doc/05_testing/evidence/m10a-step5-20260924/grep-anchors.md`
- `doc/05_testing/evidence/m10a-step5-20260924/grep-anchors.mjs`
- `doc/05_testing/evidence/m10a-step5-20260924/grep-anchors.before.txt`
- `doc/05_testing/evidence/m10a-step5-20260924/grep-anchors.after.txt`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/07_manuals/MANUAL_user.md`
- `doc/07_manuals/QUICKSTART.md`
- `doc/08_project/BACKLOG.md`
- `doc/08_project/M10a-轮次台账.md`
- `skills/dual-critic/protocol/CLAUDE.md.snippet`
- `src/trivium/hooks.ts`
- `src/trivium/verify.ts`
- `src/trivium/review.ts`
- `src/trivium/gate.ts`
- `src/trivium/archive.ts`
- `src/trivium/cli.ts`
- `src/trivium/critics.ts`
- `src/trivium/driver-claim.ts`
- `src/trivium/approval.ts`
- `src/trivium/preflight.ts`
- `src/trivium/meta.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/agents/registry.ts`
- `.reviews/M10-任意Driver/code/2026-09-23-M10-任意Driver-r6-codex.md`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":124,"project_reads":45}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
