---
schema: trivium.disposition.v1
topic: 探活指纹读盘兜底
stage: plan
role: claude
kind: revised
run_id: 20261003T163816Z
addresses:
  - 2026-10-04-探活指纹读盘兜底-codex.md
  - 2026-10-04-探活指纹读盘兜底-gemini.md
  - 2026-10-04-探活指纹读盘兜底-glm.md
---

# 裁决：探活指纹读盘兜底 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-04-探活指纹读盘兜底-claude.md`（r1，起点 `d6404d6`）
> ｜ 运行：`20261003T163816Z`（约 8 分 39 秒）
> ｜ 结论：codex `approve-with-nits`（次要 2，另 1 条因多余字段逐条降级，原标 nit）｜ gemini `approve-with-nits`（次要 2）｜ glm `approve-with-nits`（次要 1、吹毛求疵 1）
> ｜ 共 7 条：接受 7、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-04-探活指纹读盘兜底-r2-claude.md`；命令 A 不设人工闸门

三侧对主方向（兜底收在 `probeAuth` 一处；`fpError` 独立、不折成 null；读不了既不查也不写缓存；`probeAuthAll` 原样抽出、不给 `runPreflight` 开探活注入口；G7 钉住 null 等于 null 的契约语义）均表认可，§1 现状事实与 R 系列零配额可行性三侧都独立核实成立。两组意见多侧同指：`TRIVIUM_DEBUG` 口径自相矛盾（CODEX-01 ≡ GLM-01）、「§4 残余」引用悬空（AGY-02 ≡ GLM-02）。AGY-01 经核属实：r1 对 zcode 窄格的推导漏了「档位没给模型」一支（`prepareZcodeHome` 在 `model` 为空时不读副本源，`zcode.ts:1027`），按决策五「双审核出新缺口才新登」登 EV-203。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：r1 §2.1 要点 1 说「TRIVIUM_DEBUG 看栈」，要点 5 与 §5 又说栈不再打印，`cli.ts` 末尾的打印只对穿透异常生效。取「保住排障能力」一支：兜住处在 `TRIVIUM_DEBUG` 置位时把原始异常打到 stderr，全文统一为「看详情原因；要栈就 `TRIVIUM_DEBUG=1` 重跑」 | r2 §0 第 4 条；§2.1 `thrownText` 与要点 1、要点 5；§5 RUNBOOK 行；§4 新增 M11（预计存活）；§8 第 3 条 |
| CODEX-02 | codex | minor | 接受 | 属实：读不了期间不写缓存，每次预检该侧都会重烧一次真实探活，r1 的风险节没记。不改行为（决策一的有意取舍），把后果与止烧方法（修好文件）写明 | r2 §7 新增一条风险；§5 RUNBOOK、BACKLOG EV-202 结案语、主设计补句、报告「成本」一节各带一句 |
| CODEX-03 | codex | nit（降级） | 接受 | 属实：r1 自述两段注明可能同时出现、顺序由拼接决定，却没有组合格钉住。补 G9「指纹抛 + probe 也抛」逐字断言整句，并加 M12（拼接顺序对调） | r2 §3 G9 行；§4 M12；M1 / M4 / M5 / M7 的预期咬住各补 G9 |
| AGY-01 | gemini | minor | 接受 | 属实（已核源码）：zcode 档位无模型时 `prepareZcodeHome` 直接走真实 HOME 退路、不读副本源（`zcode.ts:1027`），读不了的指纹折成 null 后探活仍可通过并写入 null 缓存，之后 TTL 内持续命中、无提示；另有竞态一支。r1 说「只在上次文件不在时命中」是错的。档位给了模型时读同一文件（:1033）、读不了即失败不写缓存，所以该格限于无模型与竞态。按决策一不动 zcode，登 EV-203 | r2 §1 第 3 条改写（三个来源）；§8 第 1 条；§5 BACKLOG 新登 EV-203 |
| AGY-02 | gemini | minor | 接受 | 属实：§4 是变异节，「§4 残余」悬空。新增 §8「残余与后续」集中承接，两处引用改指 §8 | r2 §0 不做第 1、4 条改指 §8；新增 §8 |
| GLM-01 | glm | nit | 接受 | 同 CODEX-01 | 同 CODEX-01 |
| GLM-02 | glm | minor | 接受 | 同 AGY-02；另其指出 zcode 窄格不应只活在留痕里——本仓惯例是残余显式登记，取「新登条目」一支（理由：该格有独立的修法与输出变化决策，写进 EV-202 结案语会让一个 done 条目背着一个 todo） | 同 AGY-02；§5 BACKLOG 新登 EV-203 |

## 2. 未改动的部分

方向、`probeAuthAll` 的取舍、R1～R3 摆法、M1～M10、文档清单的其余部分与 r1 相同。
