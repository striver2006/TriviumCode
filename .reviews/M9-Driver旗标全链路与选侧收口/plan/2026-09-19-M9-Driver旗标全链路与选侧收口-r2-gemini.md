---
schema: trivium.review.v1
topic: M9-Driver旗标全链路与选侧收口
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.6
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260918T160720Z
rerun_index: 2
snapshot_hash: sha256:f3a3735c9d0707cf1ca87699f44c6bd7efcf3403b9e86007d93ebcd4756d2eb0
blind: true
started_at: 2026-09-18T16:07:20.864Z
finished_at: 2026-09-18T16:21:48.551Z
duration_s: 276
tool_calls:
  read: 34
  grep: 5
  glob: 0
  run_command: 0
  project_reads: 21
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 1
  major: 1
  minor: 1
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: ad3b72ec-3462-48e1-b170-bec559889864
---

# 计划审查：M9-Driver旗标全链路与选侧收口

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260918T160720Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

【最危险】§6.7 闸门区「先按缺省推一次 run_id，读到元数据后复算」的取值链解法在第 6 步验收场景（非缺省 Driver 且 critics 仅含 claude）下，第一步调用 inferLatestRunId 会直接跳过唯一的 -claude.md 审查件，返回 null 并触发 missingArtifactError 硬失败退出，使后续复算逻辑彻底死锁暴毙。
§6.9 判据换底采用 front-matter schema 方向正确，但直接复用 freeze.ts 私有的 classifyArtifact 会引发 topic.ts 逆向依赖 freeze.ts 的分层倒置，且该函数针对缺少 front-matter 文件的 fail-closed 三态安全隔离语义会误伤无 front-matter 的合法显式原稿。
§4.2 剥注释散文规则未覆盖带前缀空格与块注释首尾边界；且变异表第 425 行因现有注释本就不含属性位逗号/冒号，无法独立验证剥注释逻辑的有效性。
综上，核心新增控制流存在致命阻断漏洞，判据复用与变异设计尚需收口，结论评为 request-changes。

**结论**：`request-changes`

## 审查意见（共 3 条：阻断 1 ｜ 重要 1 ｜ 次要 1）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §6.7 & §3.4` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：§6.7 闸门区「先按缺省推 run_id、再用 meta.driver 复算」控制流在第 6 步验收场景下首步必落空并硬崩溃。在 --driver <非claude> --critics claude 场景下，阶段目录下唯一的审查件为 -claude.md。若按缺省 Driver（claude）调用 inferLatestRunId，其内部会直接跳过当轮 driver（即 claude），首步恒返回 null 并触发 missingArtifactError 抛错退出，整个控制流根本无法读到元数据，复算机制直接死锁暴毙。

**依据**：实读 src/trivium/gate.ts:725-741，inferLatestRunId 在 i.parsed.role === driver 时直接 continue 跳过；实读 src/trivium/cli.ts:866-871，runId 为 null 时直接抛错 missingArtifactError；实读 plan §2.3 C4 与 §3.4，明确指出第 6 步验收剧本即为 --critics claude（driver ≠ claude）。

**建议**：打破「用缺省 driver 猜 run_id」的死循环：可将 inferLatestRunId 改为基于内容判定（遍历符合 rerunIndex 且包含 schema: trivium.review.v1 的审查件直接提取 run_id，无需传入 driver 过滤），或让 cmdGate 直接读取该阶段最新的 _meta/run-*.json 获取权威的 meta.driver 与 meta.rerun_index。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §6.9 & §0 A` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：§6.9 判据换底采用 front-matter 方向成立，但直接复用 freeze.ts 的 classifyArtifact 存在分层倒置与语义不匹配。classifyArtifact 是 freeze.ts 未导出的私有函数，且是专为快照安全隔离设计的 fail-closed 三态判定（缺失 front-matter 时若 role !== driver 判 indeterminate 禁读）。而在原稿定位中，显式指定的路径 explicitPath 可能没有 role/kind，且原稿手写通常缺失 front-matter。若直接复用 classifyArtifact，会导致模块分层倒置（topic.ts 逆向依赖 freeze.ts）并误伤合法原稿。

**依据**：实读 src/trivium/freeze.ts:212-248，classifyArtifact 未导出且依赖 role: Role 与 kind: DispositionKind | null，在 fm === null 且 role !== driver 时返回 indeterminate；实读 src/trivium/topic.ts:82-88 与 src/trivium/topic-args.ts:534-540，explicitPath 无 role 与 kind；实读 src/trivium/render.ts:394-403，parseFrontMatter 才是底层的通用解析工具。

**建议**：明确判据换底改调 render.ts 导出的轻量判定（如抽象 isReviewArtifact(absPath)，内部仅判断 parseFrontMatter(...)?.schema === 'trivium.review.v1'），在无 front-matter 或解析失败时安全返回 false（非审查件），不引入 classifyArtifact 的三态安全隔离逻辑与逆向模块依赖。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §4.2 & §10` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | high |

**问题**：§4.2 剥注释判据描述存在边界漏洞，且 §10 变异表最后一行无法独立验证剥注释有效性。§4.2 散文描述「行级去掉 * 开头」无法处理带缩进的前导空格（review.ts:670 实际是 6 空格缩进后跟 *）和多行注释首尾；更关键的是，§10 变异表最后一行声称「专测剥注释」，但当前 review.ts:670 注释中仅有「`driver` 字段」，并不包含属性位的 , 或 :，即使实现者完全没有写剥注释逻辑，仅靠属性位匹配（driver, / driver:）在删掉属性位后也会变红，使该变异用例沦为假证明。

**依据**：实读 src/trivium/review.ts:670，文本为「* 这是同一个错误的第二次：下面 `driver` 字段的注释记的就是第一次」，不含逗号或冒号；实读 plan §4.2 规则 1 与规则 3；实读 plan §10 变异表最后一行。

**建议**：规范判据剥注释实现为标准正则替换（如 replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')）；将变异验证最后一行修改为：在实参块注释中特意注入带属性位形态的伪属性（如 // driver, 或 /* driver: */），断言在删掉实际属性位后测试依然能报红，从而真正隔离验证剥注释的有效性。

## 认为正确的部分

- 认可对 r1 审查意见中 25 条意见的全面采纳和反思，尤其是将 Handoff.options.driver 改为必填（GLM-01），体现了「机制优先于测试」的工程纪律。
- 认可 CODEX-07 判据换底的核心思想（以文件内容 front-matter schema 代替脆弱的登记反推），这一方向根除了路径归一化与跨阶段污染等历史隐患。
- 认可 5.3 与 5.4 顺序互换的重构设计（GLM-07），消除了跨步过渡期内同一命令提示文案矛盾的窗口，移除了靠记性维持的人工纪律。
- 认可将闸门区（cmdGate）以及 resolveRerunIndex 整体纳入本步进行收口，彻底消除了第 6 步验收脚本在闸门阶段必报 missing_disposition 的硬依赖阻塞。
- 认可留痕字段 driver_enabled 保持可选顶层字段、不加 if/then 校验的决策（R-6），守住了历史留痕的向后兼容底线。

## 未覆盖范围（本侧盲区）

- 未在带复杂 symlink 软链接的归档目录下验证 front-matter 读取与定位逻辑。
- 未实际启动不同 Agent CLI 进程对真实网络与凭据交互做端到端集成黑盒测试（本角色为只读计划审查员，无执行写权限）。
- 未覆盖 Windows 操作系统环境下路径分隔符反斜杠对阶段目录工件扫描的影响。

## 实际查阅的项目文件

- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-r2-claude.md`
- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-gemini.md`
- `.reviews/M9-Driver旗标全链路与选侧收口/plan/2026-09-19-M9-Driver旗标全链路与选侧收口-revised-claude.md`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/freeze.ts`
- `src/trivium/gate.ts`
- `src/trivium/cli.ts`
- `src/trivium/topic.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/review.ts`
- `src/trivium/critics.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/archive.ts`
- `src/trivium/render.ts`
- `src/trivium/meta.ts`
- `test/unit/deny-matrix.test.ts`
- `test/unit/topic.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":34,"grep":5,"glob":0,"run_command":0,"project_reads":21}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
