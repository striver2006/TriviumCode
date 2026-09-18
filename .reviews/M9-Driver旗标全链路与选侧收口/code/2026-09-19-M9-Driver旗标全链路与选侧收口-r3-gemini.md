---
schema: trivium.review.v1
topic: M9-Driver旗标全链路与选侧收口
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.6
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260918T231928Z
rerun_index: 3
snapshot_hash: sha256:88ad249158178ed8ed502eace1f0ce5a2e8d5fcc341265a8c3b661e84a4e61c8
blind: true
started_at: 2026-09-18T23:19:29.542Z
finished_at: 2026-09-18T23:32:15.247Z
duration_s: 275
tool_calls:
  read: 30
  grep: 15
  glob: 0
  run_command: 0
  project_reads: 20
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 3
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
heterogeneous: true
session_id: 8e23e353-872d-49aa-9901-dd0eed9a9621
---

# 代码审查：M9-Driver旗标全链路与选侧收口

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260918T231928Z` ｜ 第 3 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

1. 词法扫描器 stripNonCode 存在多处少剥（跟随 }、throw）与多剥（TS 非空断言 !、模板插值内花括号）边界，建议加固以防护栏假绿或误吞代码。
2. gate 中新增的 role 与当轮 driver 一致性校验设计严密，在降级轮次、跨轮复用和 run_id 校验路径下均无误拒风险。
3. 模型旗标白名单未收紧至实际入选者的工程取舍可接受（已立项 EV-67），但技术论据（与正例冲突）不成立。
整体改动结构清晰，关键链路接通完备，裁定为 approve-with-nits。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：次要 3）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/driver-wiring.test.ts:96` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：词法扫描器 stripNonCode 存在「少剥」形态（跟在 } 闭合花括号后、跟在 throw 关键字后、以及无分号换行语句后），导致正则正文被当作除法保留，若其中含 driver 会造成接线判据假绿。

**依据**：读取 test/unit/driver-wiring.test.ts:70-115。REGEX_PREV 集合未包含 }，REGEX_KEYWORD 正则未包含 throw。在 JS/TS 控制块（if/try-catch/for/while）后无需分号，紧随其后的 /driver/.test() 因 prevSig 为 } 而被误判为除法；throw /driver/ 因 prevSig 为 w 亦被误判为除法，均未被剥离。

**建议**：在 REGEX_KEYWORD 中补齐 throw；在语法状态中将块结束符 }（或前置非表达式上下文）识别为合法的正则前驱。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/driver-wiring.test.ts:70` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：词法扫描器 stripNonCode 存在「多剥」形态（TS 非空断言 ! 后的除法、++ 与 -- 后的除法、模板插值内含花括号字符），会导致真实代码被当作正则或模板字面量误吞。

**依据**：读取 test/unit/driver-wiring.test.ts:70-145。1. REGEX_PREV 包含 !、+、-，在 TypeScript 非空断言 obj.val! / driver / scale 以及自增 a++ / driver / c 中，/ driver / 会被误判为正则并被吞噬；2. 模板字符串 ${...} 扫描（lines 129-138）仅做单纯的花括号深度计数，未跳过插值内部字符串（如 `${fn('}')}`）、注释或正则内的花括号，会导致插值提前闭合并将后续真实代码抹为 "<str>"。

**建议**：区分一元与二元/后缀操作符；在模板插值 ${...} 提取中忽略字符串与注释内部的花括号，避免插值范围提前闭合或越界吞噬。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/critics.ts:117` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：模型旗标白名单未收紧至「本轮实际入选谁」的技术理由（声称与既有正例冲突）不成立；虽然作为待办登记入 EV-67 控制了本步范围，但「能入选但未选入」的模型覆盖静默丢弃问题仍未关闭。

**依据**：读取 src/trivium/critics.ts:117-136、src/trivium/topic-args.ts:370,508、test/unit/topic-args.test.ts:739-763 与 doc/08_project/BACKLOG.md（EV-67）。1. topic-args.test.ts 中正例使用的 SELECTABLE[0]（gemini）原本就在 default_critics 中，即便按实际入选集校验该测试依然通过；2. 各入口均已通过 resolveCriticSelection 计算出确定的入选集 critics，并不存在「不带 --critics 时语义未定」的情况。用户指定 --critics gemini --model-glm X 时，glm 的覆盖仍会被静默丢弃。

**建议**：修正 EV-67 中对「与既有正例冲突」的事实性描述；在后续步骤中将 assertModelOverrideKeys 收口至实际入选集合 critics，或对未入选侧的覆盖参数发出显式告警。

## 认为正确的部分

- gate 中新引入的 fm.role !== driver 比对可靠，在第 2 步按文件名 parsed.role === driver 定位裁决件的基础上，强校验了 front-matter 中的 role 声明，彻底杜绝了非缺省 Driver 下文件名与 front-matter 作者身份矛盾的伪装件，且在降级轮次、跨轮次复用及历史 run_id 回查路径上均无误拒风险。
- 全面消除了 inferLatestRunId / resolveRerunIndex 的循环依赖问题，闸门区统一改为 latestRunMeta 直读留痕，并准确区分了「阶段无留痕」与「留痕损坏全读不出（fail-closed 引导重跑）」的分档处理。
- locateSubject 与 locateSubjectReadOnly 均引入了对审查件（trivium.review.v1）的识别与过滤，防止旧轮次审查件在 Driver 换人后被误当作计划原稿，且在 driver-wiring.test.ts 中建立了双入口对账测试（EV-65）。
- review.ts 中的 prepareRun 对当轮 driver 在轮次计算、原稿定位、禁读剪枝和留痕元数据四个落点上接线完备，并前置了「Driver 不得入选审核者」的防线。

## 未覆盖范围（本侧盲区）

- 各外部 CLI 进程真实交互与网络环境（测试侧均通过 stub 桩配置验证）。
- M10 规划的 Hook 提交锚角色后缀跨时间保护改造（EV-55）及裁决件 schema 放宽（EV-66）。

## 实际查阅的项目文件

- `doc/08_project/BACKLOG.md`
- `skills/dual-critic/schema/disposition.v1.json`
- `src/trivium/archive.ts`
- `src/trivium/cli.ts`
- `src/trivium/config.ts`
- `src/trivium/critics.ts`
- `src/trivium/gate.ts`
- `src/trivium/meta.ts`
- `src/trivium/naming.ts`
- `src/trivium/preflight.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/schemas.ts`
- `src/trivium/state.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/topic.ts`
- `src/trivium/types.ts`
- `test/helpers/critic-fixtures.ts`
- `test/helpers/fixture.ts`
- `test/integration/gate-loop.test.ts`
- `test/unit/driver-wiring.test.ts`
- `test/unit/topic-args.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":30,"grep":15,"glob":0,"run_command":0,"project_reads":20}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
