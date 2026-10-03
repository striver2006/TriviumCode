---
schema: trivium.disposition.v1
topic: codex探活删除收尾
stage: plan
role: claude
kind: revised
run_id: 20261003T142424Z
addresses:
  - 2026-10-03-codex探活删除收尾-codex.md
  - 2026-10-03-codex探活删除收尾-gemini.md
  - 2026-10-03-codex探活删除收尾-glm.md
---

# 裁决：codex探活删除收尾 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-03-codex探活删除收尾-claude.md`（r1，起点 `9ce191f`）
> ｜ 运行：`20261003T142424Z`（约 8 分 48 秒）
> ｜ 结论：codex `request-changes`（4 条，均因缺 `confidence` 逐条降级，原标严重度 major 1、minor 3）｜ gemini `approve-with-nits`（次要 1、吹毛求疵 2）｜ glm `approve-with-nits`（次要 3、吹毛求疵 2）
> ｜ 共 12 条：接受 12、驳回 0、暂缓 0
> ｜ 修订后的计划：`plan/2026-10-03-codex探活删除收尾-r2-claude.md`；命令 A 不设人工闸门

三侧对主方向（照 EV-197 拆 `attempt`、外层 finally 删除不抛；通用删除抽到 `util/fsx.ts`、zcode 薄包装逐字不变；`codexCredentialCopies` 单一定义、两档无哨兵；步骤属性挂原错误对象、`run()` 文案不变）均表认可。三组意见多侧同指：指纹读盘无兜底应登记（CODEX-04 ≡ GLM-01 ≡ AGY-03）、兄弟目录锁要放子文件（CODEX-02 ≡ GLM-03）。codex 的 `request-changes` 落在测试摆法（CODEX-01），不涉及方案方向。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | major（降级） | 接受 | 属实：r1 的 C3b「留一份副本 + 锁兄弟目录」与自己写的摆锁守则矛盾——`codexhome/` 全程可写，递归删除若先走到它，留下的那份会被删净、现场查得 ENOENT，结论取决于遍历顺序；M4 / M5 都吊在这格上。改为入口先删掉另两份、再锁 `codexhome/` 本身，留下的那份必然在场、仍可 stat | r2 §3.1 `FAKE_LOCK=keep:<文件名>` 摆法与 C3b 行；摆锁守则段改写 |
| CODEX-02 | codex | minor（降级） | 接受 | 属实（与 GLM-03 同指）：删除空目录看父目录写权限，空的 0o500 子目录锁不住；zcode 装置的 sibling 锁是先放文件 `f` 再改权限（`zcode-auth-probe.test.ts:42-45`）。自检里同时核「`locked/f` 在」 | r2 §3.1 `FAKE_LOCK=gone` 摆法写死三步与自检 |
| CODEX-03 | codex | minor（降级） | 接受 | 属实：EV-201 同日刚登记、两次全量各红一次；计划里先写下分诊规则，免得临场决定重烧还是判红。只适用签名相符的已登记偶发红，红在别处按真红 | r2 §3.3「已知偶发红的分诊」一段 |
| CODEX-04 | codex | minor（降级） | 接受 | 属实（与 GLM-01、AGY-03 同指）：r1 §5.4 把登记与否交给审查员，却没有承接的落点。三侧都判应登记，按决策五「双审核出新缺口才新登」，新登 EV-202；决策三限制的是改，不是登 | r2 §4 BACKLOG 新登 EV-202（todo，修法方向与触发条件照建议）；§0 不做清单、§5.4 改为指向 EV-202 |
| AGY-01 | gemini | minor | 接受 | r1 的「无」档写成「<目录> 仍在」确实没标归一。改为两档共用一个前缀、前缀里统一 `tildeHome(runDir)`，档位只决定后半句，照 `zcodeTempDirResidueText` 的拼法 | r2 §2.3 措辞改写为函数形态；§3.1 C8 断言两档都归一；§3.2 新增 M15 |
| AGY-02 | gemini | nit | 接受 | `throw` 可以抛原始值，给字符串挂属性在严格模式下会抛 TypeError、掩盖原错误。挂之前先判对象，原始值原样重抛；读取侧同样判对象、取到的不是字符串当没有 | r2 §2.4 第 2 条 |
| AGY-03 | gemini | nit | 接受 | 同 CODEX-04 | 同 CODEX-04 |
| GLM-01 | glm | minor | 接受 | 同 CODEX-04；项目对「核出、不在本题」的既有处置就是登记（EV-196～EV-200 皆然） | 同 CODEX-04 |
| GLM-02 | glm | minor | 接受 | 属实：通过支是 `探活通过（${Math.round(durationMs/1000)}s）`，时长写不死。通过支改为匹配 `^探活通过（\d+s）$`（锚到结尾，同时证明没有残留后缀），失败支保持逐字相等 | r2 §3.1 C6 行 |
| GLM-03 | glm | minor | 接受 | 同 CODEX-02 | 同 CODEX-02 |
| GLM-04 | glm | nit | 接受 | 属实：`probes/zcode.ts:937` 的注入选项 `opts.removeTempDir` 类型是 `typeof removeZcodeTempDir`、返回整句提示，与 r1 的通用函数同名异义。新函数本来就没有调用方，取改名而不只是加注释：`tryRemoveTempDir`（「try」同时说出不抛）；该选项的文档块补一句点名区别 | r2 §2.1 命名一段；全文 `removeTempDir` 改 `tryRemoveTempDir` |
| GLM-05 | glm | nit | 接受 | 属实：设计 §11.3 第 7 条 v1.3.79 段记了「拉起本身抛错且删不掉时提示随异常丢失（两侧同形）」，codex 接进来后不带这条，三处记录不闭合。codex 侧抛出面近于空，只补记录 | r2 §5.5；§4 设计补句带上「三处同形」 |

## 2. r2 相对 r1 的改动

1. §2.1：通用函数改名 `tryRemoveTempDir`，注入选项文档块补点名（GLM-04）。
2. §2.3：codex 措辞改为两档共用前缀的函数形态，前缀统一归一家目录（AGY-01）。
3. §2.4：步骤助手挂属性前判对象（AGY-02）。
4. §3.1：假入口 `FAKE_LOCK` 四种摆法写死；C3b 改为「删另两份 + 锁 `codexhome/`」（CODEX-01）；C3 的兄弟锁内放文件并自检（CODEX-02 ≡ GLM-03）；C6 通过支改正则（GLM-02）；C8 断言两档都归一（AGY-01）。
5. §3.2：新增 M15「没有凭据副本档不归一家目录」（AGY-01）。
6. §3.3：EV-201 等已登记偶发红的分诊规则（CODEX-03）。
7. §4：新登 EV-202（CODEX-04 ≡ GLM-01 ≡ AGY-03）；设计补句带上「三处同形」残余（GLM-05）。
8. §5：第 4 条改为指向 EV-202；新增第 5 条对称残余（GLM-05）。

## 3. 无驳回、无暂缓

十二条全部接受，均为计划层面的补写、摆法修正与命名调整，不改方案方向，不涉及用户决策的变更。新登 EV-202 符合决策五「双审核出新缺口才新登」。
