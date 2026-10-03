---
schema: trivium.disposition.v1
topic: zcode探针臂删除收尾
stage: plan
role: claude
kind: revised
run_id: 20261003T115927Z
addresses:
  - 2026-10-03-zcode探针臂删除收尾-codex.md
  - 2026-10-03-zcode探针臂删除收尾-gemini.md
  - 2026-10-03-zcode探针臂删除收尾-glm.md
---

# 裁决：zcode探针臂删除收尾 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-03-zcode探针臂删除收尾-claude.md`（r1，起点 `4a3d9f3`）
> ｜ 运行：`20261003T115927Z`（约 7 分 32 秒）
> ｜ 结论：codex `approve-with-nits`（4 条，均因缺 `confidence` 逐条降级，原标严重度 minor 3、nit 1）｜ gemini `approve-with-nits`（次要 1、吹毛求疵 1）｜ glm `approve-with-nits`（次要 2、吹毛求疵 2）
> ｜ 共 10 条：接受 10、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-03-zcode探针臂删除收尾-r2-claude.md`；命令 A 不设人工闸门

三侧对主方向（三臂改调共用删除函数、失败不抛、提示经返回值带出；第三档措辞；副本位置由调用方传入、只 stat 不删；现场查优先于调用方档位；EV-86 不触发）均表认可，定案。三组意见三侧或两侧同指：报告漏登归档索引（CODEX-03 ≡ AGY-01 ≡ GLM-01）、夹具裸删应另登条目（CODEX-04 ≡ AGY-02 ≡ GLM-02）、变异 5 杀不死（CODEX-02 ≡ GLM-03）。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor（降级） | 接受 | 属实：`chmod` 造 EACCES 在 root 下不成立，EV-197 的 A1/A2 与 D10 系列都带 `skip: process.getuid?.() === 0`，假入口侧 `FAKE_LOCK` 摆不出时退 3 让用例红。r1 只写「沿用 EV-197 的教训」没把这两半写死 | r2 §3.1 开头「摆锁守则」两条：R1～R6、D18、D19 一律带 root 跳过门；假入口摆锁失败退非 0、用例包装摆锁失败直接抛 |
| CODEX-02 | codex | minor（降级） | 接受 | 属实（与 GLM-03 同指）：旗标探针 HOME 下不写 `cli/config.json`，指向不存在位置的非 null `copy` 现场 stat 得 ENOENT，输出与传 null 逐字相同，变异杀不死。改为把替换串定成「`copy` 指向删除时刻必然存在的路径」——旗标探针的临时目录本身（删除失败时它一定还在），档位取 `'sentinel'`，R1 断言「没有副本」档必红 | r2 §3.2 第 5 条改写；§2.2 注明 null 短路的语义是「从不写副本，不查」 |
| CODEX-03 | codex | nit（降级） | 接受 | 属实（与 AGY-01、GLM-01 同指）：AGENTS.md 改动同步清单要求新报告同批进 `doc/05_testing/README.md`「当前已归档文件」一节，`doc-archive-index` 契约测试双向对账 | r2 §2.5 补一行 |
| CODEX-04 | codex | minor（降级） | 接受 | 属实（与 AGY-02、GLM-02 同指）：夹具 cleanup 裸删与 EV-198 同族，失败同样抛穿 `runDoctor`；四侧共用，本题不改范围不变，按决策四「双审核出才登」在本轮登记。调用点按 GLM-02 补全为五处（含 claude 侧 `memFx.cleanup()`） | r2 §4 第 2 条改为「另登 EV-199」；§2.5 BACKLOG 新登 EV-199（todo），触发条件取 CODEX-04 的建议 |
| AGY-01 | gemini | nit | 接受 | 同 CODEX-03 | 同 CODEX-03 |
| AGY-02 | gemini | minor | 接受 | 同 CODEX-04；修法方向取建议（重试、不抛，夹具无凭据，取「没有副本」类措辞） | 同 CODEX-04 |
| GLM-01 | glm | minor | 接受 | 同 CODEX-03；条目位置按该节（日期, 文件名）升序口径插在 `REPORT_2026-10-03_zcode_probe_silent_fail.md` 附近 | 同 CODEX-03 |
| GLM-02 | glm | minor | 接受 | 同 CODEX-04；已回源码核过五处调用点：`agy.ts:362`、`claude.ts:1465`、`claude.ts:1530`（`memFx`）、`codex.ts:1041`、`zcode.ts:1645`，`fixture.ts:84` 与 :134 两个 cleanup | 同 CODEX-04，EV-199 正文列五处 |
| GLM-03 | glm | nit | 接受 | 同 CODEX-02；取「改成可判死的形态」而不是删掉：旗标探针「谎称有副本」本身是该咬的错，只是 r1 的替换串选错了位置 | 同 CODEX-02 |
| GLM-04 | glm | nit | 接受 | 属实：`.zcode/cli` 布局字面在 `adapters/zcode.ts:537`（私有 `ZCODE_CLI_SUBDIR`）与 `probes/zcode.ts:583` 各一份。改为导出接收 HOME 的 `zcodeCliCopyPath(homeDir)`：`prepareZcodeHome` 写盘、认证探活与 doctor headless 段（传 `zcodeHomeUnder(runDir)`）、白名单臂（传自己的临时 HOME）、同形臂（传 `zcodeHomeUnder(root)`）共用，布局字面只剩一处；r1 的 `zcodeHomeCopyPath(runDir)` 不再引入 | r2 §2.2、§2.3 白名单臂与同形臂；变异第 10 条随之改为针对 `zcodeCliCopyPath` |

## 2. r2 相对 r1 的改动

1. §2.2：导出 `zcodeCliCopyPath(homeDir)` 取代 r1 的 `zcodeHomeCopyPath(runDir)`（GLM-04）；补注 `copy` 为 null 的语义（CODEX-02）。
2. §2.3：白名单臂 `copyPath = zcodeCliCopyPath(home)`，写盘与删除共用；同形臂传 `zcodeCliCopyPath(zcodeHomeUnder(root))`（GLM-04）。
3. §2.5：报告同批登记进 `doc/05_testing/README.md`（CODEX-03 ≡ AGY-01 ≡ GLM-01）；BACKLOG 新登 EV-199（CODEX-04 ≡ AGY-02 ≡ GLM-02）。
4. §3.1：新增「摆锁守则」——root 跳过门、摆锁失败必红（CODEX-01）。
5. §3.2：变异 5 改为可判死的替换串（CODEX-02 ≡ GLM-03）；变异 10 改为针对 `zcodeCliCopyPath`（GLM-04）。
6. §4 第 2 条：由「请审查员判断」改为「另登 EV-199，本题不改」。

## 3. 无驳回、无暂缓

十条全部接受，均为计划层面的补写与措辞修正，不改方案方向，不涉及用户决策的变更。
