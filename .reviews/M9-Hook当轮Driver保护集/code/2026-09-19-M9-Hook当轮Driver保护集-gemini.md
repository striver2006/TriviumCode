---
schema: trivium.review.v1
topic: M9-Hook当轮Driver保护集
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.7
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260919T064055Z
rerun_index: 1
snapshot_hash: sha256:b26582a8ba71fb53d7c55212e1d50b878e9676ca2597995e5409eb8d9991de4f
blind: true
started_at: 2026-09-19T06:40:56.412Z
finished_at: 2026-09-19T07:12:28.113Z
duration_s: 1892
tool_calls:
  read: 34
  grep: 11
  glob: 1
  run_command: 0
  project_reads: 22
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 1
  nit: 2
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 6811ea83-9dfe-41cb-8ae7-6f44d26d3cc5
---

# 代码审查：M9-Hook当轮Driver保护集

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260919T064055Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

总判断：设计与时间推进严格吻合，EV-68 闭环质量高，准予通过（approve-with-nits）。
1. 吻合度：Hook 当轮保护集提前至 M9 第 6 步前置落地完全合理且必要，成功解除了非缺省 Driver 写裁决件及审核者产出防伪的阻断；跨时间面（EV-55）与原稿时序（EV-72）按设计稳妥留待 M10。
2. 优化空间：hookPreWrite 中外层已判 isInsideArchiveResolved，内层又调 isForgedRoleFile 重复执行软链与归档判定，存在三重冗余 I/O，可直接调用 hasProtectedRoleSuffix；高频正则可做惰性 memoization。
3. 细节同步：test/unit/hooks.test.ts:151 注释仍称 driver 为 M10 预留接口，与生产代码已结案的表述存在轻微时间面滞后。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：次要 1 ｜ 吹毛求疵 2）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:509` |
| 类别 | performance ｜ 层次 code |
| 置信度 | high |

**问题**：hookPreWrite 在进入角色工件分支后，对 target 存在三重冗余的路径解析与 isInsideArchiveResolved 调用。

**依据**：在 src/trivium/hooks.ts:481-517 中：第 483 行先判断 isInsideArchiveResolved(target, ...)，进入后第 490 行 locateArchiveTarget(target, ...) 若遇到非直接命中的软链，会再次执行 safeRealpath 与 resolveExisting；接着在第 509 行执行 if (isForgedRoleFile(target, ctx.projectRoot, ctx.archiveRoot, driver))，而 isForgedRoleFile 实现为 hasProtectedRoleSuffix(...) && isInsideArchiveResolved(...)，导致第 3 次调用 isInsideArchiveResolved 并重复走一遍路径规范化/软链解析。

**建议**：在第 509 行直接判断 hasProtectedRoleSuffix(target, driver) 即可，因为外层 if 已确立 target 落在归档内；同时可考虑让 locateArchiveTarget 复用外层已解析的绝对/规范化路径，减少重复的 resolveExisting 文件系统遍历。

### AGY-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:296` |
| 类别 | performance ｜ 层次 code |
| 置信度 | medium |

**问题**：高频拦截入口（如 Bash 拦截与写拦截）每次执行动态构造编译相同的 RegExp 对象，带来不必要的内存分配与编译开销。

**依据**：在 src/trivium/hooks.ts:296-298 中，roleSuffixAnywhere(): RegExp { return new RegExp(`-(?:${criticRoleSuffixes().join('|')})\\.md\\b`); }，每次 hookPreBash 都会被调用；在 hooks.ts:175-179 中 hasProtectedRoleSuffix 每次被调用也动态 new RegExp(...)。

**建议**：对固定使用缺省 Driver 的 roleSuffixAnywhere 正则进行惰性单例缓存（lazy memoization）；对 hasProtectedRoleSuffix 可按已登记的 4 个 Driver 枚举进行映射缓存。

### AGY-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/hooks.test.ts:151` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：测试文件内的注释残留了 M9 第 4 步时的旧措辞，把已接通的参数仍描述为 M10 预留接口，与生产代码注释产生时间面表述分叉。

**依据**：test/unit/hooks.test.ts:151 行注释写道「criticRoleSuffixes(driver) 的 driver 参数自称是『M10 的接口』... 一个没有断言的预留接口，到 M10 才发现它没接上就太晚了」；而 src/trivium/hooks.ts:114-121 已明确改写为「driver 参数（EV-68 已接上，不再是 M10 的预留接口）... 接上的时点是 M9 第 6 步前置，不是 M10——EV-68 结案」。

**建议**：同步更新 test/unit/hooks.test.ts:151 处的文档注释，明确该契约已随 EV-68 在 M9 第 6 步前置正式接通并断言。

## 认为正确的部分

- 当轮与跨时间语义签名彻底分家：hasProtectedRoleSuffix 强制传 driver 且无默认值，hasRoleSuffixCrossTime 明确承接提交锚与 Bash 侧，从类型系统与调用点根除了默认参数静默掩盖漏传的风险。
- 权威来源定位精准：否定了将滞后且易读到陈旧值的 state.json 作为来源的旧方案，严格对齐 run.json.driver（latestRunMeta），留痕存在且全损坏时坚持硬失败退 2，与 cmdGate 同口径。
- 短路顺序严密：looksLikeRoleArtifact 词法检查结合 isInsideArchiveResolved 保证非角色工件与普通业务写入完全不读留痕与 state，关掉写锁的仓库零额外 I/O 承诺兑现且有用例守卫。
- 集成层与变异测试覆盖扎实：新增真实子进程 hook() 调用用例（gate-loop.test.ts），单元测试配齐了正向放行、反向拦截、陈旧闸门项翻转、成对缺省回落与留痕损坏鉴别断言。
- 演进边界与已知限制交代诚实：EV-71（会话载体决策）与 EV-72（plan/bug 阶段原稿写入时序）在 BACKLOG 与设计文档中均有详尽的留痕与推迟论证，不抢跑 M10 范围。

## 未覆盖范围（本侧盲区）

- 未在真实 Claude Code 交互会话或独立外部 Agent CLI 进程中触发真实 PreToolUse Hook 事件（仅核验静态逻辑与集成层真子进程模拟）。
- 未覆盖跨文件系统挂载点或复杂多层循环软链等极端 APFS 文件系统异常。
- 未覆盖真实多审核者全链路 CLI 执行配额消耗（受限于测试环境桩配置）。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/08_project/BACKLOG.md`
- `.reviews/M9-Hook当轮Driver保护集/plan/2026-09-19-M9-Hook当轮Driver保护集-revised-claude.md`
- `src/trivium/hooks.ts`
- `src/trivium/state.ts`
- `src/trivium/meta.ts`
- `src/trivium/cli.ts`
- `src/trivium/review.ts`
- `src/trivium/naming.ts`
- `src/trivium/util/log.ts`
- `src/trivium/schemas.ts`
- `src/trivium/types.ts`
- `test/unit/hooks.test.ts`
- `test/integration/gate-loop.test.ts`
- `test/contract/disposition-role-assets.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":34,"grep":11,"glob":1,"run_command":0,"project_reads":22}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
