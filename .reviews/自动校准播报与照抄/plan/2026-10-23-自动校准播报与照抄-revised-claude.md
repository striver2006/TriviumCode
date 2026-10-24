---
schema: trivium.disposition.v1
topic: 自动校准播报与照抄
stage: plan
role: claude
kind: revised
run_id: 20261023T093717Z
addresses:
  - 2026-10-23-自动校准播报与照抄-codex.md
  - 2026-10-23-自动校准播报与照抄-gemini.md
  - 2026-10-23-自动校准播报与照抄-glm.md
---

# 裁决：自动校准播报与照抄 · 计划三审第 1 轮

> 被审对象：`plan/2026-10-23-自动校准播报与照抄-claude.md`（r1，基线 `ea49b3f6`）。
> 评审循环第 1/3 轮：codex `pass-after-changes`（1 major、2 minor），gemini `pass-after-changes`（2 major、2 minor），glm `pass-after-changes`（4 minor）。计票 0 通过 / 3 修改后通过 / 0 不通过 → 修改后通过。
> 11 条：全部接受（三组同义：CODEX-02 ≡ AGY-01 ≡ GLM-03；CODEX-03 ≡ GLM-01；AGY-03 ≡ GLM-04）。合入后的计划见 `plan/2026-10-23-自动校准播报与照抄-r2-claude.md`。
> 裁决前核过的依据：`package.json:12-18` 与 `scripts/build.mjs` 头注释（缺省构建不重写入口产物，渲染要 `npm run render`）；`skills/dual-critic/entry/codex/dual-review-plan/SKILL.md` 护栏段（「本载体没有 TriviumCode Hook」）；`src/trivium/preflight.ts:216-241`（`invocations` 按失败项目标去重，一家漂移只出一条）；EV-251 报告第九节（第二个目标 agy 来自偶发自升级）。

## 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CODEX-01 | codex | major | 接受 | 成立：EV-251 验收的第二条 doctor 来自 agy 偶发自升级，夹具只造了 zcode 一家漂移；照 r1 只造「一家」，真实会话里只会有一次 doctor，「第一条输出被截存 → 改写第二条」这条触发链根本不出现，花了配额也验不到第三处偏离 | r2 D4 末段改写：夹具**同时**造 agy、zcode 两家版本漂移；付费会话前零配额干跑断言 `invocations` 恰为 agy、zcode 两条（按 `ALL_CLI_NAMES` 次序）、`eligible: true`、两句播报文本；验收时记录第一条 doctor 的输出是否真的被载体截存，没截存就在报告里写明「长输出后第二条照抄」这一格未覆盖，不宣称已验 |
| CODEX-02 | codex | minor | 接受 | 成立：`npm run build` 缺省不重写入口产物（`entry-render-parity` 恰靠这一点抓漂移），渲染要 `npm run render`；r1 第 4 步归因错误，片段类变异也要按「改片段 → 渲染 → 跑断言 → 恢复片段 → 重渲染」的次序 | r2 第二节第 4 步改为 `npm run render` → `npm run check`；第 5 步把片段类变异（M3、M5）的次序写明；M4（直接改单份产物）不经渲染、直接跑契约 |
| CODEX-03 | codex | minor | 接受 | 成立：片段四家逐字节同一口径，而 codex / gemini 载体没有 TriviumCode Hook（PROTOCOL 467 行、codex 入口产物护栏段）；在共用片段里写「Hook 会整条拦下、加了也跑不成」对两家失实，还会削弱禁令可信度 | r2 D3 理由句改为对四家都成立的表述：禁令无条件；理由写「改写调用会让留痕与预检给出的不一致；装有护栏的载体还会把整条命令拦下、白耗一轮」，不再断言「必被拦」 |
| AGY-01 | gemini | major | 接受 | 同 CODEX-02 | 同 CODEX-02 |
| AGY-02 | gemini | major | 接受 | 成立：「长输出截存进文件」是 Claude Code 的行为，另三家未必截存；无条件指示「读截存文件」会让输出已直接返回的载体去找不存在的文件 | r2 D3 出口句改为条件句：输出已直接返回时从返回里取字段；载体把输出截存成文件时，另起一次只读读取去读那个文件。两种情形都**不改调用本身** |
| AGY-03 | gemini | minor | 接受 | 成立：`announce_after_pass` 是无槽位常量，第二次预检通过时没有 `recalibration`，让模型回翻上文的失败 JSON 去取，只添一个失败面，而回落句就是同一句 | r2 D1 / D2：片段第 4 步直接写出常量原文、要求照念，不再要求回取 JSON；JSON 里的 `announce_after_pass` 保留（任务目标点名「通过后再念一句」由预检给出，也供非 skill 调用方用），由源码导出常量 `RECAL_ANNOUNCE_AFTER_PASS`，契约用例断言 16 份产物里的原文等于该常量——句子单一来源、不双写 |
| AGY-04 | gemini | minor | 接受 | 成立：变异清单没有咬 `announce_after_pass` 的一条 | r2 第 5 步新增 M6：`buildRecalibration` 去掉 `announce_after_pass` ⇒ U5 变红；M7：片段里的常量原文改一个字 ⇒ 契约「与源码常量相等」条变红 |
| GLM-01 | glm | minor | 接受 | 同 CODEX-03 | 同 CODEX-03 |
| GLM-02 | glm | minor | 接受 | 成立：D3 写字面路径、D4 判据写「`TV` + `args`」、片段现状写「`TV` 后接」，三处口径不一，验收判据会因执行者取法而异 | r2 统一为一个口径：命令文本是**字面** `.trivium/bin/trivium` 后接 `args` 各项（skill 头部已规定 `TV` 一律写这个项目相对路径，不用变量）；D3、片段、契约断言、D4 验收判据三按同一措辞 |
| GLM-03 | glm | minor | 接受 | 同 CODEX-02 | 同 CODEX-02 |
| GLM-04 | glm | minor | 接受 | 同 AGY-03 | 同 AGY-03 |
