---
schema: trivium.disposition.v1
topic: M10b-入口资产与真载体验收
stage: code
role: claude
kind: response
run_id: 20260926T023857Z
addresses:
  - 2026-09-26-M10b-入口资产与真载体验收-r4-codex.md
  - 2026-09-26-M10b-入口资产与真载体验收-r4-gemini.md
  - 2026-09-26-M10b-入口资产与真载体验收-r4-glm.md
---

# M10b 第 5 步纪律 6 回溯 · 代码双审第 4 轮应答

> 被审对象：M10b 第 5 步纪律 6 回溯（纯文档，相对 `0186ce1` 的 20 个文件，另有 `.reviews/README.md` 不在补丁面内）。
> 三侧共 10 条，**全部接受**。三侧一致认可 FR-28 / AC-21 的判定边界与调用写法；意见集中在三类：
> ①L2 覆盖面表还有一格说过头（CODEX-01）；②同一格内计划期口径与实况并存、对账表半格核对记成全格（CODEX-02 ≡ AGY-03）；
> ③归档根里的 README 与几处版本指针漏跟，且它不在补丁面、机器锚也扫不到（CODEX-03 ≡ AGY-01、CODEX-04 ≡ AGY-04、AGY-02、GLM-01），装置自检只覆盖一族（GLM-02）。
> 以下落点均在用户审批之后实施；审批前只写本件。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 复核成立：`hookPreCommit` 是锚②全量核对的唯一调用点，只在带 Hook 的载体会话里由提交触发；codex / gemini `hookConfigTarget: null`，glm 还受五前提约束；`verifyRoundForApproval` 只核本轮、只在审批那一刻。所以 L2 无 Hook 主攻时，审批之后删改审查工件（含更早轮次）没有机制会发现，「任何时候……能」说过头了，且与同表第 2 行的写实口径自相矛盾 | QUICKSTART §5.2 覆盖面表第 3 行按时点与载体拆开：审批时（本轮）能；提交时只有带 Hook 的载体（Claude Code；满足五前提的 ZCode）在会话里提交才全量核对；Codex / Antigravity 主攻的轮次审批后删改审查工件无人发现，出口写「在带 Hook 的会话里提交，或审批后自己核 `git status` 与工件」；RUNBOOK §十「审批之前自己核」补一条审批后的对应核对；BACKLOG EV-132 追加：本格是同一失准的第三个落点，并入候选 ① 的文案修正范围 |
| CODEX-02 | codex | minor | 接受 | 复核成立：「夹具级」（被审对象与归档在夹具仓库）与「真载体」（在自己的会话里执笔）是两个维度，codex 两者兼有、gemini 是夹具级 + 名义；原文把 P-2 计划期口径「codex / gemini 夹具级」与本批新写的「codex 真载体」并置而不说明维度，读者分不清；对账表 A2 只以 3-5 核了 ZCode 半句，却判全格「核」 | 主设计 16.1 M10b 行与 15.3 AC-21 行：在「codex / gemini 夹具级」处注明是 P-2 计划期口径，并写明两个维度的实况（glm 真载体；codex 夹具级 + 真载体；gemini 夹具级 + 名义）；第 5 步报告 §1.1 A2 改为「ZCode 半句以 3-5 核；codex 半句以 3-4 核，按两个维度改准」，处置由「核」改「改」 |
| CODEX-03 | codex | minor | 接受 | 复核成立：`.reviews/README.md` 第 3 行仍写「AC-21（仅子句 ③）……部分达成」，与 PRD v1.4.8 相反；该文件本批改过另两处，这是漏行。它在归档根、按 `diffExcludePrefixes` 不进被审补丁，四个锚族也不覆盖验收状态口径，两道核对都漏了 | `.reviews/README.md` 第 3 行跟到「AC-21 已达成（含达成边界）」；`anchors.mjs` 新增「验收状态口径」一族（`AC-21` 同行出现「仅子句 ③」或「部分达成」），重跑并在报告 §3 分类剩余命中 |
| CODEX-04 | codex | nit | 接受 | 复核成立：`.reviews/README.md` 第 5 行仍指 PRD v1.4.7 / 设计 v1.3.37，MANUAL 第 17 行仍指设计 v1.3.37；§24.2 MANUAL 行版本列停在 v1.0.1，与表内「old → new」约定不一 | 两处依据行跟到设计 v1.3.43 / PRD v1.4.8；§24.2 MANUAL 行版本列改为「v1.0.0 → **v1.0.3**」；报告 §4 把「依据版本指针」列进人工核对清单 |
| AGY-01 | gemini | minor | 接受 | 与 CODEX-03、CODEX-04 同一处（`.reviews/README.md` 第 3～5 行），推理一致 | 同 CODEX-03（第 3 行）与 CODEX-04（第 5 行） |
| AGY-02 | gemini | minor | 接受 | 复核成立：`doc/02_design/README.md` 对 LLD 的版本标注仍是 v1.1.0，本批 LLD 已升 v1.1.3 | `doc/02_design/README.md` 的 LLD 条目版本改为 v1.1.3 |
| AGY-03 | gemini | nit | 接受 | 与 CODEX-02 同源：验收方式列「四 Driver 各跑一轮」易被读成四家各跑了一轮命令 B | 同 CODEX-02 的 15.3 AC-21 行改法，另在验收方式列加「（计划期口径；实跑见第三列）」 |
| AGY-04 | gemini | nit | 接受 | 与 CODEX-04 第二半同一处 | 同 CODEX-04（§24.2 MANUAL 行版本列） |
| GLM-01 | glm | minor | 接受 | 复核成立：`.reviews/README.md` 在归档根，code 阶段的被审补丁按 `diffExcludePrefixes` 无条件排除它，本步三处改动（D1～D3）没进补丁面；这条边界对每个改该文件的回溯步都成立，报告与文档都未登记 | 第 5 步报告 §2 反向表该行注明「不进被审补丁，由审查员直读工作树核（本轮 codex / glm 已直读）」，§4 增一条审计边界；`.reviews/README.md` 文末加一句同样的提示，供后续回溯步的审查者照例直读 |
| GLM-02 | glm | nit | 接受 | 复核成立：自检只断言「待 M10b」一族 HEAD 非零，其余族模式拼错时会呈现 0 → 0 的假干净 | `anchors.mjs` 自检改为「每个锚族在 HEAD 都须非零」，可合法归零的族须在头注释按族写豁免理由（本轮无豁免）；重跑，读数与报告 §3 同步 |
