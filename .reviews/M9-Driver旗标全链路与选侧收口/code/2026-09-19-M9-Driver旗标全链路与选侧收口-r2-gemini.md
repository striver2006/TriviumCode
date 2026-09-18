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
run_id: 20260918T191610Z
rerun_index: 2
snapshot_hash: sha256:82696b2ec10200b317894eba1a86d208bc605a590894d7f096774e5719c8809f
blind: true
started_at: 2026-09-18T19:16:11.089Z
finished_at: 2026-09-18T19:25:10.382Z
duration_s: 202
tool_calls:
  read: 27
  grep: 7
  glob: 1
  run_command: 0
  project_reads: 10
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 2
  minor: 1
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
heterogeneous: true
session_id: 787bbea3-2497-4de3-92fe-14fffa4e8457
---

# 代码审查：M9-Driver旗标全链路与选侧收口

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260918T191610Z` ｜ 第 2 轮
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

本次审查重点评估了三处焦点：
1. EV-66 因 disposition.v1.json 硬编码 role: claude 导致非缺省 Driver 闸门闭环在最后一米依然断裂，虽反向断言锁住边界但让「全链路」承诺名不副实，且必撞第 6 步验收；
2. cmdGate 在全留痕损坏时硬失败缺乏合规逃生门，给出的自救出口在此形态下失灵，易锁死老主题；
3. 接线扫描判据存在同名右值遮蔽、展开名碰撞与未剥离字符串导致括号外溢三大盲区，会使漏传安静变绿；
其余如 latestRunMeta 消除循环依赖、论域单点派生与交接协议回退机制均实现良好。总体给出 request-changes。

**结论**：`request-changes`

## 审查意见（共 3 条：重要 2 ｜ 次要 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/cli.ts:288-295` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：cmdGate 在「扫到但全读不出」时硬失败会导致老主题彻底锁死，且提示给出的自救出口（--run-id 与移除文件）在此形态下均为伪逃生门，缺乏合规的覆盖降级手段。

**依据**：查阅 src/trivium/cli.ts:262-295 与 src/trivium/meta.ts:421-442。在 cli.ts:288-295 中，当 !latest && scan.scanned > 0 时直接抛出 missingArtifactError 硬失败，退出码为 66；其提示建议「用 --run-id 指定一份可读的运行」，但在该分支下所有扫描到的留痕均通过 readRunMeta 校验失败，用户显式传入 --run-id <id> 时同样会在 cli.ts:265 触发 readRunMeta 返回 null 并被同款错误拦下；提示另一出口「修复或移除这些文件」与不可变留痕纪律（P6）冲突；且 cmdGate 未提供 --driver 覆盖旗标，导致在历史主题留痕损坏或因演进不合契约时无任何合法自救出口。

**建议**：为非当前轮次的闸门检查或历史主题维护提供合法的逃生通道：例如允许 cmdGate 在遇到留痕全坏时接受显式 --driver <id> 旗标（或 --force / warn 提示）按人工指定的 Driver 与工件推导轮次继续，而不是倒逼用户去修改或删除历史归档。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/integration/gate-loop.test.ts:1260-1283` |
| 类别 | scope-drift ｜ 层次 code |
| 置信度 | high |

**问题**：EV-66 处置虽然诚实锁住了失败形态，但使得本步所承诺的非缺省 Driver「全链路」在最后一米（闸门闭环）名不副实，且该断裂将直接阻断第 6 步验收。

**依据**：查阅 skills/dual-critic/schema/disposition.v1.json:13、test/integration/gate-loop.test.ts:1260-1283 以及 doc/08_project/BACKLOG.md:163 (EV-66)。在 gate-loop.test.ts 的 T-11 用例中，非缺省 Driver 产出裁决件后 gate --check 依然失败退 66，被锁成 assert.notEqual(after.code, EXIT.OK)；disposition.v1.json 将 role 钉死为 "const": "claude" 违背了纪律 7（Agent id 唯一来源是注册表）；本步已在 run.v2.json 中扩展字段，却以「不在落点表」为由对同目录下的 disposition.v1.json 停步，导致非缺省 Driver 无法跑通闸门闭环，且该问题将在第 6 步验收中必定阻断。

**建议**：在本步将 disposition.v1.json 的 role 改为 string 并在 schemas.ts 的 validateDispositionFrontMatter 中补充注册表身份校验（与 run.v2 同源处理），同步将 gate-loop.test.ts 的 T-11 断言升级为期望退 0 闭环，使全链路名实相符，避免将已知阻断踢到验收阶段。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/driver-wiring.test.ts:43-78` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：接线扫描判据存在同名右值遮蔽、解构展开标识符匹配以及未剥离字符串引发括号外溢三大共同盲区，在真实多行代码漏传时仍会安静变绿。

**依据**：查阅 test/unit/driver-wiring.test.ts:43-78 与 TARGETS 定义。stripComments（43-47行）未剥除字符串与模板字面量；argBlockAt（67-78行）不识别字符串引号且将 ( 与 { 混在同一个 depth 计数器中；hasProperty（61-64行）仅做全词正则匹配 \b${key}\b，完全不感知 AST 属性位置。当多行代码中其他字段将 driver 用作右值（如 driver_enabled: isEnabled(driver)）或位置参数前置（如 locateSubject(ref, pathFor(driver), root)），或解构展开变量含 ...driverOpts，或字符串内含括号导致实参块外溢吞并外部代码时，漏传 driver 的调用均会被误判为存在并安静变绿。

**建议**：增强 driver-wiring.test.ts 扫描工具：在提取实参块前剥离单双引号及模板字符串字面量；将对象字面量键的检查收紧为属性位形态（例如 /(?:^|[,\s{])\s*driver\s*[:},]/），避免将右值表达式中的同名变量当作传参属性；为位置参数调用点增加形参槽位计数断言。

## 认为正确的部分

- latestRunMeta 直读运行元数据彻底消除了由后缀反推当轮 Driver 引发的循环依赖，时间戳文件名倒序排序与 unreadable 记录结构清晰。
- cli.ts 对 scan.scanned === 0 的兜底提示（warn 明确说明按缺省 Driver 与工件反推轮次继续）处理合理，为全新主题保留了正常通过路径。
- selectableCritics 将 --model-<id> 白名单、legalList 与选侧排除收敛至同一派生源，有效消除了 EV-53 中的论域分叉。
- overrideReasonFor 的统一导出与双写点（front-matter 与运行元数据）消费闭环了 EV-54，保证留痕文案同值。
- run-protocol.ts 在交接文件中将 options.driver 设为编译期必填，并在 rebuildContext 中提供运行期元数据回填与警告，跨进程鲁棒性良好。
- 对 EV-66 边界未做静默掩盖或跳过，而是用 assert.notEqual 精确断言失败形态并详尽记入 BACKLOG.md，工程态度严谨透明。

## 未覆盖范围（本侧盲区）

- 未实际配置真实外部提供商凭据发起在线双审端到端调用（依赖本地桩机制与静态分析）。
- 未在真实执行环境中完整运行以非缺省 Driver（如 codex/gemini）执笔的全流程端到端流水线（涵盖多阶段交接与变更提交）。
- 未覆盖 git commit hook 对底层裸 git 提交命令的运行期拦截细节。

## 实际查阅的项目文件

- `.reviews/M2-skills与闸门/plan/_meta/run-20260910T221346Z.json`
- `.reviews/M9-Driver旗标全链路与选侧收口/code/2026-09-19-M9-Driver旗标全链路与选侧收口-gemini.md`
- `.reviews/M9-Driver旗标全链路与选侧收口/code/2026-09-19-M9-Driver旗标全链路与选侧收口-response-claude.md`
- `.reviews/M9-Driver旗标全链路与选侧收口/code/_meta/changes-20260918T191610Z.diff`
- `doc/08_project/BACKLOG.md`
- `skills/dual-critic/schema/disposition.v1.json`
- `skills/dual-critic/schema/run.v2.json`
- `src/trivium/archive.ts`
- `src/trivium/cli.ts`
- `src/trivium/critics.ts`
- `src/trivium/gate.ts`
- `src/trivium/meta.ts`
- `src/trivium/preflight.ts`
- `src/trivium/review.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/schemas.ts`
- `src/trivium/state.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/topic.ts`
- `test/integration/driver-flag.test.ts`
- `test/integration/gate-loop.test.ts`
- `test/unit/driver-wiring.test.ts`
- `test/unit/run-meta.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":27,"grep":7,"glob":1,"run_command":0,"project_reads":10}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
