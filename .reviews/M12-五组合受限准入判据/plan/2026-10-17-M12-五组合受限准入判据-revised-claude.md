---
schema: trivium.disposition.v1
topic: M12-五组合受限准入判据
stage: plan
role: claude
kind: revised
run_id: 20261017T085024Z
addresses:
  - 2026-10-17-M12-五组合受限准入判据-gemini.md
  - 2026-10-17-M12-五组合受限准入判据-glm.md
---

# 计划裁决：M12-五组合受限准入判据（第 1 轮）

两侧共 6 条（gemini 4、glm 2），全部回原件核过，全部接受。合入后的完整计划见同目录 `2026-10-17-M12-五组合受限准入判据-r2-claude.md`。

## 核实摘要

- AGY-01 / GLM-01：`doc/05_testing/evidence/agent-access-convergence-20261012/mechanism-proof.mjs:22` 在路线探针指纹与按 `job.live_cli_version` 重算的路线指纹不符时抛 `mode3-proof-production-route-mismatch`，`:28/:32` 在当前指纹与取证时不符时抛 `mode3-previous-full-proof-rejected`。原稿 §2「抛出 ⇒ false」会把漂移记成失败，与 §6、P-3 冲突；M5 变异还会把错误行为钉成预期。两条说的是同一缺口，合并在一处修。
- AGY-02：原稿 `judgeControlledRequestDenial(job, recompute)` 拿不到档 1 选中的读臂，`live-source-mismatch` 在纯函数里无从判定。
- AGY-03：`.trivium/bin/trivium` 执行的是 `~/.claude/skills/dual-critic/scripts/trivium.cjs`（全局安装副本），`package.json` 的 `build` 不含安装；原稿「重建后不重装」会让 R1 跑旧副本。
- AGY-04：`judgeToolSurface` 的返回含数组字段，比较方式须写死为规范化后的内容比较。
- GLM-02：`doc/05_testing/README.md` 第 16 行规定新文件同批进「当前已归档文件」，由 `test/contract/doc-archive-index.test.ts` 对账；原稿提交 2 清单漏了这一项。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | major | 接受 | 复算原件以抛出表达指纹漂移（mechanism-proof.mjs:22、28、32），原稿把一切抛出记 false，违反 P-3；与 GLM-01 同源 | r2 §2 档 2：先判 `readArm.compatible !== true` ⇒ `'未测'`（`fingerprint-drift`）且不调用 recompute；读臂兼容后的抛出才记 false。r2 §7 单测补漂移分支与 recompute 零调用断言；M5 收窄为「读臂兼容下的机制性抛出映射成未测」，新增 M13「读臂不兼容仍调用 recompute / 记 false」 |
| AGY-02 | gemini | major | 接受 | 纯函数不收读臂就无法核 `live_result_ref` 与档 1 同源 | r2 §2 档 2 签名改为 `judgeControlledRequestDenial(job, readArm, recompute)`；核 `job.live_result_ref.path` 等于 `readArm` 的 `result.json` 绝对路径且 sha256 等于当场计算值，`job.combination` 等于读臂组合；不符记 `live-source-mismatch` ⇒ false（在 recompute 之前） |
| AGY-03 | gemini | minor | 接受 | wrapper 指向全局安装副本，只重建不重装会让 R1 与冻结清单用旧 bundle | r2 §5 时机第 2 步：提交 1 后 `npm run build` → `npm run install:local` → 核仓库 bundle 与安装副本 sha256 一致、两者构建标识 git_head 为提交 1 且 dirty 为 false；之后才进入「不重建、不重装、不审查、不预检」窗口。R0 增加同一核对 |
| AGY-04 | gemini | minor | 接受 | 落盘值来自 JSON 解析，重算值是新对象，须规定内容比较 | r2 §2 档 1 第 4 条：重算结果与落盘 `tool_surface` 用 `JSON.stringify` 规范化后比较（与 10-12 `mechanism-proof.mjs:9` 的 `equal` 同口径），键序按 `judgeToolSurface` 返回顺序；单测补「同内容不同对象」为 true 的用例 |
| GLM-01 | glm | major | 接受 | 同 AGY-01：§2 档 2 无漂移规格、§7 无对应用例、M5 反向钉死 | 同 AGY-01 落点（r2 §2 档 2 执行次序、§7 单测与 M5 / M13） |
| GLM-02 | glm | minor | 接受 | 报告与证据目录落 `doc/05_testing/`，须同批登记归档索引，否则契约测试当场红 | r2 §4 改动面报告行与 §5 提交 2 清单：报告及本批证据目录（按 `test/helpers/doc-archive-index.ts` 口径需要登记的条目）同批进 `doc/05_testing/README.md`「当前已归档文件」；提交 1 若新建证据目录内文件，也按同口径核是否需要登记 |

## 不改的部分

两侧「认为正确的部分」均与原稿一致（档 1 当场重算、档 3 恒不可取样、两计数无合计、台账不扩容与已知预占集合、具名授权绑定），r2 不动这些条目。
