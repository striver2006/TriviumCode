---
schema: trivium.disposition.v1
topic: 探针夹具删除收尾
stage: plan
role: claude
kind: revised
run_id: 20261004T025901Z
addresses:
  - 2026-10-04-探针夹具删除收尾-codex.md
  - 2026-10-04-探针夹具删除收尾-gemini.md
  - 2026-10-04-探针夹具删除收尾-glm.md
---

# 裁决：探针夹具删除收尾 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-04-探针夹具删除收尾-claude.md`（r1，起点 `02dcab2`）
> ｜ 运行：`20261004T025901Z`（约 11 分 58 秒）
> ｜ 结论：codex `request-changes`（重要 1；另 5 条因缺 `layer` 字段逐条降级，原标次要 3、吹毛求疵 2）｜ gemini `approve`（零意见）｜ glm `approve-with-nits`（吹毛求疵 1）
> ｜ 共 7 条：接受 7、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-04-探针夹具删除收尾-r2-claude.md`；命令 A 不设人工闸门

三侧都独立复算了 §1 的派生清单（恰三处、BACKLOG「四处」系数错）、五处调用点与 notes 的引用语义、claude-events 两个锚点在新写法下保留，也都认可措辞相对决策二原话的收窄（记忆夹具无 `.env`、CLI 以夹具根为 cwd 会落文件、基线不通时隔离目录里没有 CLI 产物）。

CODEX-01 是本轮唯一改变方案的意见，经核属实：r1 §2.4 用来否掉行为级覆盖的前提「五处调用点都要拉真实 CLI 才走得到 finally」与仓库事实相反——`test/integration/claude-structured-probe.test.ts` 已用假入口跑完整个 `probeClaude`（含两段夹具 finally），`test/unit/zcode-doctor-probe-home.test.ts:245`、`test/unit/zcode-provider-env.test.ts:740` 用假 entry 跑 `probeZcode`。我补核了另两侧：`probeAgy` 在 `--version`、`models` 两次应答后即建夹具并拉 headless 读，假入口走得到；`probeCodex` 要让假 `debug models` 吐出可解析目录才会在夹具活着时调到 bin，成本高一些但可行。glm 在「认为正确的部分」里认可了 r1 的结构断言取舍，那是基于同一条失实前提，不构成反对理由。

CODEX-02 核出一个本题口径之外、但后果同形的点：`util/git.ts:121` 的 `workTreeHash` 在探针路径上，删不掉同样崩 doctor。按决策六新登 EV-204，不在本题改（理由见表）。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | major | 接受 | 属实（已回源码核）：claude、zcode 两侧已有假入口端到端装置，agy 两次应答后即走到夹具段，codex 需假模型目录但可行。r1「零配额跑不到 finally」撤回。取建议①并扩到四侧：新增 E 组行为级用例，假入口扫钉住的 `TMPDIR` 下 `trivium-probe-` / `trivium-codexhome-` 目录摆锁（不靠 cwd，主夹具与记忆夹具各自活着时各自上锁；开了锁却没锁到就退 3 让用例红）；E4 经 `probeCodex` 端到端同时守住隔离探针的接线与「结论不因删不掉而改变」。W 组降为补充。另写明实现兜底规则：某侧假入口若到不了夹具段，该侧退回结构断言，并在文件头、报告「覆盖」与代码双审材料里写明卡在哪，不冒充行为级覆盖 | r2 开头改动清单；§1 第 8 条；§2.4 E1～E4 与兜底规则；§2.6 变异预期改写、新增 M13 / M14；§4 第三条改写 |
| CODEX-02 | codex | minor（降级） | 接受 | 属实（行号逐个核过）：两目录之外仍有七处同形裸递归删除。`util/git.ts:121`（`workTreeHash`）在探针路径上——建夹具与 agy / zcode 的 scratch_paths 比对都调它——删不掉同样崩 doctor；但它也是送审冻结、跑后漂移复算与构建标识的取值点，在那几处删除失败该不该吞是另一个问题，不在用户「探针与适配器里」的口径内，本题不改。按决策六「双审核出新缺口才新登」新登 EV-204（`workTreeHash` 与 `selftest.ts` 两处；`retention` / `install` / `lock` 三处性质不同，只列名待甄别）。W3 断言消息与 BACKLOG 结案语把论域写死为「probes 与 adapters 两目录」，不说全仓清零 | r2 §0 不做第四条；§2.4 W3 断言消息；§2.7 BACKLOG；§4 第四条；EV-204 登记（编码阶段落 BACKLOG） |
| CODEX-03 | codex | minor（降级） | 接受 | 属实：W1 手写四个文件名与「恰 5 处」，新增探针文件时论域不会自动扩，与 W3 的目录口径也不一致。改为读 `src/trivium/probes/` 全部 `.ts` 派生：每一处 `.cleanup()` 都要合格；总数大于 0 防永绿；每个文件形态合格的调用数不少于该文件建夹具的调用数。去掉写死的「5」 | r2 §2.4 W1 |
| CODEX-04 | codex | minor（降级） | 接受 | 属实：r1 只写 `trivium doctor --selftest`，没钉产物；`.trivium/bin/trivium` 指向已安装副本，验的是旧代码。改为先 `npm run build`、再跑仓库产物 `node skills/dual-critic/scripts/trivium.cjs doctor --selftest`（与上一题报告同一口径）。selftest 不经 `probes/fixture.ts`，写明它在本题只是冒烟、不作 EV-199 路径的证据。不在验证里加重装：重装由用户在提交后于终端执行，verify 的 build / test 命令走工作树 | r2 §3 第 4 步；报告「覆盖」标注 |
| CODEX-05 | codex | nit（降级） | 接受 | 合理：EV-201 已登记的 K 格在负载下偶发红，事先不定口径会在撞上时返工。预定：只限 `cancel-grace-unverifiable` 的 K 格，单跑三次、报告按 EV-201 引用、不判本题红；其余任何格子按真红处理 | r2 §3 第 3 步 |
| CODEX-06 | codex | nit（降级） | 接受 | 属实：`fs.rm` 的 `maxRetries` 只对 EBUSY / EMFILE / ENFILE / ENOTEMPTY / EPERM 重试，摆锁格拿到的是 EACCES，测到的是「不抛 + 提示带错误码」，不是「重试三次」。不改用例，计划与报告如实写明覆盖边界 | r2 §2.5 末「覆盖边界」；报告「覆盖」一节 |
| GLM-01 | glm | nit | 接受 | 属实：扫描面里已有嵌套括号实参（`codex-home.ts:177`），单层正则会在 `path.join(…)` 的闭括号处截断，未来 `fs.rm(path.join(…), { recursive: true })` 会被漏数——恰是 W3 承诺要红的那一类。改为括号深度配平截取，并给 W3 配两条自测（嵌套括号 + recursive 计 1；`codex-home.ts:177` 形态计 0） | r2 §2.4 W3；§2.6 末注明 W3 由自测守、不在装置变异面内 |

## 2. 无修改的部分及原因

- gemini 零意见；其「未覆盖范围」（未拉真实 CLI、建夹具中途抛出未模拟）属零配额与 §0 不做第三条的既定边界，不另处置。
- 措辞（§2.1、§2.3 与决策二原话的差异）三侧均认可，不改；收尾时向用户单独说明这三处差异。
