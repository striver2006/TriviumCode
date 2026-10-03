---
schema: trivium.disposition.v1
topic: zcode探针臂删除收尾
stage: code
role: claude
kind: response
run_id: 20261003T123538Z
addresses:
  - 2026-10-03-zcode探针臂删除收尾-codex.md
  - 2026-10-03-zcode探针臂删除收尾-gemini.md
  - 2026-10-03-zcode探针臂删除收尾-glm.md
---

# 应答：zcode探针臂删除收尾 · 代码双审第 1 轮

> 被审对象：相对 `4a3d9f3` 的工作树补丁（20 个文件，`_meta/changes-20261003T123538Z.diff`）
> ｜ 运行：`20261003T123538Z`（约 10 分 34 秒）
> ｜ 结论：codex `approve-with-nits`（5 条，均因缺 `confidence` 逐条降级，原标 major 1、minor 2、nit 2）｜ gemini `approve`（零意见）｜ glm `approve`（零意见）
> ｜ 共 5 条：接受 4、驳回 1、暂缓 0（CODEX-01 只改登记面、不动 codex 侧代码，另登 EV-200）

每条都回源码核过。gemini、glm 零意见，其「未覆盖范围」（未实跑、`maxRetries` 的真实瞬时错误、真实 CLI 行为）属只读审查与零配额的固有边界，不另处置。

## 1. 应答表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | major（降级） | 接受 | 属实，已回源码核：`adapters/codex.ts:336` 建 `trivium-codex-auth-` 临时根，`prepareCodexHome` 把真实 `auth.json` 原样拷入（`codex-home.ts:315-321`），:361 的 finally 是裸删——删不掉时既顶替探活结果崩预检，又把含真实凭据的文件留在系统临时目录且无提示，与 EV-197 修之前的 zcode 认证探活同形；`probes/codex.ts:666` 的 `probeCodexIsolation` finally 同为裸删，`probeCodex` 与 doctor 的 codex 段无兜底。EV-199 的清单是按厂商数出来的，漏了这两处。按 `grep -rn "fs.rm(" src/trivium/probes src/trivium/adapters` 排除带 `maxRetries` 的点重新派生：递归删目录的裸删共 5 处（两个夹具 cleanup、codex 隔离探针、codex 认证探活；zcode 三臂本题已收），另 3 处是单文件 `force` 删除（`agy.ts:182`、`codex-home.ts:140`、`zcode.ts:591`），不是「删目录失败顶替结论」形态，不列入。本题范围是 zcode 三臂（决策一），不动 codex 侧代码；按决策四「双审核出新缺口才登」登记 | BACKLOG：EV-199 补 `probeCodexIsolation`、写明清单的派生口径与排除项；新登 EV-200（codex 认证探活删除失败崩预检且残留真实 `auth.json`，修法照 EV-197）；报告 §4、§5 同步 |
| CODEX-02 | codex | minor（降级） | 接受 | 属实：`.zcode/cli` 布局字面在 `adapters/zcode.ts:886`（副本源）、`probes/zcode.ts:75` 的 `ZCODE_CLI_DIR`、:278 / :308 / :326 / :489 等处仍各写各的，「只在 `ZCODE_CLI_SUBDIR` 一处定义」说过头。取建议二：收窄措辞为「副本的写入与删除失败后的现场查共用这一处定义」，并点名其余字面仍在；不在本题把探针回读点改成派生（越出 EV-198） | `adapters/zcode.ts` 的 `zcodeCliCopyPath` 注释；设计 §11.3 第 7 条与 v1.3.80 记录、BACKLOG EV-198、报告 §2 同样收窄措辞 |
| CODEX-03 | codex | minor（降级） | 接受 | 属实：`zcode-full-copy-arm.test.ts` 的 `tmp()` 建的目录从不清理，本题新增的 R2～R6 每格又多调几次；判据按前缀数残留的用例虽都钉在私有根、不受系统临时目录噪声影响，但泄漏本身会持续累积。改在本文件内收口：`tmp()` 记下每个返回值，文件级 `after` 钩子整删（`force`，删不掉不抛——收尾不该把用例变红）。已积累的历史目录在系统临时目录、不是本题建的，不在会话里删，交用户决定 | `test/unit/zcode-full-copy-arm.test.ts` 的 `tmp()` 与 `after` 钩子；报告 §3 末段改写 |
| CODEX-04 | codex | nit（降级） | 驳回 | 两条建议都不取。① 测试里的前缀字面是有意的独立锚点：从源码常量派生期望值，常量改错时期望跟着错、断言照绿（本仓 `ELEVEN_CLEARED`「逐字写出、不从常量派生」同一取向），而前缀漂移时测试会红，正是想要的；② RUNBOOK 那一行补三个前缀是用户决策四点名的做法。另：那一行说的是「探针 / 探活临时目录删除失败」这条提示，只有 zcode 的 `removeZcodeTempDir` 会发出，codex 与夹具的前缀不会出现在这条提示里，列进去反而误导；codex 认证探活的删除失败另登 EV-200 | 无修改 |
| CODEX-05 | codex | nit（降级） | 接受 | 属实：取档条件两支理由不同、`residue` 靠 `transformCopy` 闭包赋值，日后加早退分支容易取歪。行为不变，抽成带名字的小函数 `fullCopyResidueKind(replace, residue)`（两支各写理由），同形臂 docblock 写明「`residue` 是副本形状的单一事实源，删除时刻仍要读它，新增早退分支须保证它与盘上副本一致」。变异 M6 / M7 的锚点随之改到新函数上，重生成规格并重跑预跑与装置 | `src/trivium/probes/zcode.ts`（新函数与 docblock）；`evidence/…/gen-mutation-spec.mjs` 与第二批变异读数 |

## 2. 修改计划（S9）

1. 源码：`fullCopyResidueKind`（CODEX-05）、`zcodeCliCopyPath` 注释收窄（CODEX-02）。
2. 测试：`zcode-full-copy-arm.test.ts` 的 `tmp()` 收尾（CODEX-03）。
3. 文档：BACKLOG EV-199 补点、EV-200 新登（CODEX-01）；设计 / BACKLOG / 报告的「一处定义」措辞收窄（CODEX-02）；报告补代码双审读数。
4. 验证：第一批变异读数改名留档为 `*.r1.*`，重生成规格跑第二批预跑与装置；全量检查一次（串行）、doctor 自检一次；最后 `verify`。
