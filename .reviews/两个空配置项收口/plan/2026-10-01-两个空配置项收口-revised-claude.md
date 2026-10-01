---
schema: trivium.disposition.v1
topic: 两个空配置项收口
stage: plan
role: claude
kind: revised
run_id: 20261001T123430Z
addresses:
  - 2026-10-01-两个空配置项收口-codex.md
  - 2026-10-01-两个空配置项收口-gemini.md
  - 2026-10-01-两个空配置项收口-glm.md
---

# 裁决：两个空配置项收口 · 计划双审第 1 轮

> 被审对象：`plan/2026-10-01-两个空配置项收口-claude.md`（r1，起点 `9cc9249`）
> ｜ 运行：`20261001T123430Z`（约 12 分 20 秒）
> ｜ 结论：codex `approve-with-nits`（次要 3、吹毛求疵 2）｜ gemini `approve-with-nits`（次要 1、吹毛求疵 1）｜ glm 解析降级（原文自报 `approve-with-nits`，内含 GLM-01～03：次要 1、吹毛求疵 2；闸门按降级单元 `GLM-F01` / `GLM-F02` 校验）
> ｜ 实质意见共 10 条：接受 10、驳回 0、暂缓 0（另有降级单元 GLM-F01 一条按「无独立主张」驳回）
> ｜ 修订后的计划：`plan/2026-10-01-两个空配置项收口-r2-claude.md`；命令 A 不设人工闸门

glm 侧输出 JSON 语法错误、整份回退，闸门只认两个降级单元：`GLM-F01` 是开场总述，`GLM-F02` 是整段 JSON（内含 glm 原文编号 GLM-01～03）。第 1 节裁决表按闸门认的九个编号各给一行；第 2 节把 F02 里的三条逐条裁决——实质意见不因解析降级而被笼统处理。

## 1. 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :-- | :-- | :-- | :-- | :-- | :-- |
| CODEX-01 | codex | minor | 接受 | 属实：`dist/` 与 `skills/dual-critic/scripts/trivium.cjs` 不进 Git，归档里没有可调用的 bundle，r1 没写构建步骤。获取路径改写为「归档 + 软链本仓 `node_modules` + 归档内 `node scripts/build.mjs`」，不联网、不 `npm ci`（前几个主题的验收都这么做）。建议里的替代路线「用已安装的全局副本当旧构建」不取：它随用户重装而变，不钉在提交上，读数无法复现 | r2 §6「兼容验收」 |
| CODEX-02 | codex | minor | 接受 | execpolicy 的全部结论来自本机 0.159.2 一次实测，写进设计（唯一实现依据）不带版本就会在 codex 升级后变成过期事实 | r2 §2.3 末句、§3.5、§4 表前总则、§5.1、§5.3 触发条件补「升级后形态变化」 |
| CODEX-03 | codex | minor | 接受 | r1 的拟稿把两键静态写死，与「逐键判定」的 U4 五格不一致；只带一键的用户会被告知一个自己没写的键 | r2 §3.3（正文由 `deprecatedConfigKeysIn` 动态拼装，多家 antigravity 条目各列一条）；§3.6 U4 补正文断言、U6 补「只带一键」格；§6 新增变异 M8 |
| CODEX-04 | codex | nit | 接受 | 「最多 3 次」不说首次计不计，三处会差一轮 | r2 §3.4 三处同一句「重跑最多 3 次（首次校验不计）」；§4 设计 7.4 / 8.6 两行同句 |
| CODEX-05 | codex | nit | 接受 | 属实：`pretest` 每次从 `skills/dual-critic/schema/` 重拷 `dist/test` 下的 schema，经 `npm test` 跑会把变异冲掉 | r2 §6 schema 契约变异「执行窗口」：先构建一次、只 `node --test` 直跑目标文件、每格先断言拷贝已变异、收尾断言与源逐字节相同 |
| AGY-01 | gemini | minor | 接受 | 属实：`skills-src/` 下没有叫 `SKILL.md` 的文件，按文件名过滤会把源整个漏掉 | r2 §3.4 末条与 §3.6 U8：`skills-src/` 扫全部文件、`skills/` 扫全部 `SKILL.md`（含 `entry/`） |
| AGY-02 | gemini | nit | 接受 | 属实：`util/log.ts` 的 `warn()` 自带 ⚠️，现有 `DoctorReport.warnings` 文案都不带；拟稿自带会双重渲染 | r2 §3.3：`deprecatedConfigNotice` 不带 ⚠️，preflight `detail` 按该文件惯例补；§3.6 U4 断言不带、U5 断言 `detail` 以 ⚠️ 起头 |
| GLM-F01 | glm | 解析降级 | 驳回 | 本单元是 glm 输出的开场总述（「核实工作完成……发现三处小问题……无方向性缺陷」），不含独立主张；它点到的三处问题即 GLM-F02 里的 GLM-01～03，已在第 2 节逐条裁决 | 无修改（总述不构成独立意见） |
| GLM-F02 | glm | 解析降级 | 接受 | 内含 GLM-01～03 三条，逐条裁决见第 2 节，三条全部接受 | r2 §3.6、§1.2 / §4、§6（逐条落点见第 2 节） |

## 2. GLM-F02 内三条的逐条裁决

### GLM-01（nit · correctness）——接受

「`KNOWN_DEAD` 删两条后，其余七条中的五条（EV-30 ②～⑦）不动」数错了：现有 8 条，删两条余 6 条，EV-30 ②～⑦ 是六项。改为「其余六条（EV-30 ②～⑦）不动」，§0 不做清单同口径。
**落点**：r2 §0「不做」第一条、§3.6 首条。

### GLM-02（minor · maintainability）——接受

主设计 §10.1 的 2226～2228 行（「它目前没有任何消费方」）与 2259～2265 行（更正注记「全仓 grep 确认 `readonly_commands` 没有任何消费方」）是现状性陈述，r1 既没列进改动、也没像 ADR_002 那样声明不改。EV-15 的历史正是残留提及反复咬人，取「补注」一支：两处各补「2026-10-01 注：该键已删除（EV-15 结案）」，原注记的历史叙述不动。
**落点**：r2 §1.2 文档清单补这两处、§4 表新增「设计 §10.1 两处注记」一行。

### GLM-03（nit · test-gap）——接受

同 CODEX-01：归档里没有 bundle，要先构建。取「软链本仓 `node_modules` + 归档内构建」而不是建议里的 `npm ci`——后者要联网、慢，且与本仓锁定的依赖版本可能有出入；软链用的就是本仓同一份依赖。
**落点**：r2 §6「兼容验收」。

## 3. 本轮之外的自查

- r1 两处行号已在 r2 改正：`agy-events.ts` 的失守说明是 252～256 行（r1 写 254 行起），`types.ts` 的 `ClaudeCriticConfig` 举例是 965～967 行；
- r1 §2 说「原始输出将收进 evidence」，送审前已落 `doc/05_testing/evidence/config-dead-keys-20261001/codex-execpolicy/`；落盘时发现 `(exit=…)` 起初取成了管道里 `head` 的退出码，已重出为 codex 自身退出码（空模式那格 codex 退 1），r2 §2.2 表格同步写明。
