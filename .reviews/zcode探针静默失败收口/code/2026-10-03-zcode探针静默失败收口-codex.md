---
schema: trivium.review.v1
topic: zcode探针静默失败收口
stage: code
role: codex
vendor: openai
agent_cli: codex/0.160.0
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20261003T071007Z
rerun_index: 1
snapshot_hash: sha256:88202d15fb6e53675e0937b74f46c2872aeeef00a627b268ce647d79c619727f
blind: true
started_at: 2026-10-03T07:10:09.578Z
finished_at: 2026-10-03T07:17:33.371Z
duration_s: 351
tool_calls:
  run_command: 22
  project_reads: 14
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
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a10099-4faa-7633-8b0f-168617f4d508
---

# 代码审查：zcode探针静默失败收口

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20261003T071007Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

按「资源与生命周期 / 跨平台环境耦合 / 依赖版本」镜头审查了本补丁的全部代码落点：逐一读了 src/trivium/adapters/zcode.ts（removeZcodeTempDir / zcodeTempDirResidueText / authProbe 重构与 attempt 拆分）、src/trivium/probes/zcode.ts（ZCODE_HEADLESS_UNREFRESHED 表、三支带出点、seen.hasCopy、finally 收尾）、src/trivium/doctor.ts（warning 与既有 blocker 的关系）、两份单测、prepareZcodeHome 的写盘时序、preflight.ts 的探活缓存结构，并核对了变异规格（M1～M18）与证据读数（mutation-output 18 条全咬住、check-1/2 为 2621 tests / 2619 pass / 0 fail、doctor-selftest 14/14）。核验结论：三支判据与代码结构一致（前两支在 path_deny 前返回、第三支 path_deny/scratch_paths 照跑照刷，carried 列表如实）；note 改写后逐字不变（对照旧字面确认）；缓存条目只存 {checked_at, cli_version, fingerprint, ok} 不含 detail，RUNBOOK「TTL 期内不再重复提示」属实；authProbe 重构后删除成功路径输出逐字节不变、attempt 为提升的函数声明、闭包捕获合法；探针返回值第五个消费方只有 doctor.ts，无解构破坏。变异有牙性逐条对账通过（M4/M5 用 D14 的成功格反向锁、M15/M16/M18 有字面断言防自我循环）。发现三条不构成阻断的意见：同族「finally 裸删会崩整轮」形态在旗标探针与两条模型覆盖臂仍留三处未收（本轮未登记）；「读取或解析失败」措辞在共用表与认证探活字面各存一份；hasCopy 判定存在一个极窄的复合例外窗口。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：次要 1 ｜ 吹毛求疵 2）

### CODEX-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts —— probeReadonlyFlags 末尾（约 :253 `await fs.rm(emptyHome, { recursive: true, force: true })`）、probeModelOverride 的 finally（约 :621 `fs.rm(home, …)`）、第三条覆盖臂的 finally（约 :1002 `fs.rm(root, …)`）` |
| 类别 | scope-drift ｜ 层次 code |
| 置信度 | high |

**问题**：EV-197 收的是「finally 里裸删临时目录、ENOTEMPTY/EBUSY/EACCES 抛出顶替原结果、穿过无兜底调用链崩成内部错误」这一形态，但只收了认证探活与 doctor 探针两处。同一文件里旗标探针与两条模型覆盖臂仍是裸 `fs.rm({recursive,force})`：它们被 probeZcode 直接 await（:1338 起无逐臂兜底），删除失败时异常同样会穿出 probeZcode、让本轮已探结论随 checkpoint 前抛出而丢失——与本次修前的 authProbe 完全同形。且模型覆盖臂的临时 HOME 里写有 `cli/config.json` 副本（同形臂虽做了凭据替换、白名单臂是否含敏感键取决于 buildProbeCliConfig 的白名单），删不掉时也没有任何人给出残留提示。共用助手 `removeZcodeTempDir` 已在场，把这三处一并接上是顺手的；若有意不收（如设计明写「旗标探针与模型覆盖探针臂不变」），应在 BACKLOG 另登一条，而不是留成无声的边界——本轮 EV-196/EV-197 结案条目与残余清单都没有提到这三处。

**依据**：实测命令：`grep -rn "fs.rm(" src/trivium/adapters/zcode.ts src/trivium/probes/zcode.ts src/trivium/preflight.ts | grep -v maxRetries` 得 probes/zcode.ts:253/:621/:1002 三处裸删；随后读 probeZcode 调用段（:1338 `const flags = await probeReadonlyFlags(…)`、:1382 `const mo = await arm(…)`）确认无 try 兜底，runDoctor 的 zcode 段（doctor.ts:573）同样直接 await。读了 src/trivium/probes/zcode.ts、src/trivium/adapters/zcode.ts（prepareZcodeHome 写副本的形态）、被审 diff 的 EV-197 结案条目。

**建议**：二选一并在裁决件写明：①把三处 finally 的裸删改用 `removeZcodeTempDir`（who 需扩一档或复用「探针」），删除失败进 notes；②维持现状但在 BACKLOG 登记「同族裸删三处未收」并写触发条件，使边界可见。若选 ②，建议顺手核一句模型覆盖臂副本是否含真实键值，决定残留提示的档位措辞。

### CODEX-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/zcode.ts —— authProbe 内部 attempt() 的副本失败 detail（`副本源 ~/.zcode/cli/config.json 读取或解析失败：…`）对照 probes/zcode.ts 表 `ZCODE_HEADLESS_UNREFRESHED.source_unreadable.noteKey`（'读取或解析失败'）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：本题的核心机制是「三支的人读名、note 定位字面由同一张表给出，免得 warning 指向的字面与 note 本身各改各的」。doctor 侧三条 note 都改成引表了，但认证探活侧的同一句用户可见措辞仍是独立字面：改 noteKey 时 D16 那类对账只看 doctor 侧，authProbe 的 detail 会无声漂移，两处「读取或解析失败」变成两份事实源。另外 noteKey 作为定位字面偏泛（嵌在长句中段、且是错误信息里常见的词组），warning 让人「找含『读取或解析失败』的那条 note」在同轮多条 note 里可能不唯一——当前该轮通常只有一条，属可接受，但与另两支的定位字面（'ZCode headless 失败'、'ZCode stdout 中抠不出 JSON envelope'）的唯一性口径不一致。

**依据**：读了 src/trivium/adapters/zcode.ts 当前文件 attempt() 段（detail 字面未引表）与 src/trivium/probes/zcode.ts:1148-1167 表定义、:1526 拼句；读了被审 diff 中 D16 的断言方式（只对账 [zcode] notes，不覆盖探活 detail）。

**建议**：让 authProbe 的这句 detail 也引用同一张表的 `what`/`noteKey`（或由表派生），并在 registry-parity 或本文件契约测试里加一条「两侧字面同源自表」的盯防；或明确写注释声明探活措辞独立于表及其理由。

### CODEX-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/zcode.ts —— prepareZcodeHome :1022-1024（writeFile 后紧跟 chmod）；调用侧 seen.hasCopy 仅在函数**成功返回**后置真（authProbe attempt 与 probes/zcode.ts 探针两处）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | low |

**问题**：「有副本才说含真实凭据」（GLM-02）的判据是 `prep.homeDir !== null`，前提是 prepareZcodeHome 抛出时副本必未写下。读码确认写盘之后、返回之前只剩一次 `fs.chmod(config.json, 0o600)`——它若抛出（罕见但形态上是唯一的窗口），副本已在盘上而 hasCopy=false：此时若删除恰好也失败，残留提示会说「其中没有 cli/config.json 副本」，在一个含凭据的目录上做出不实的否定断言，恰好误导最需要它的那类处置（用户按「只是 CLI 产物」轻慢处理）。这是双罕见叠加的边缘，不阻断，但提示的措辞从「断言没有」退成「未确认有」即可零成本消掉。

**依据**：推理为主，读了 src/trivium/adapters/zcode.ts 的 prepareZcodeHome 全文（:992-1036，writeFile→chmod→return，qualify 与 reorder 均在写盘前）与两侧 hasCopy 赋值点；实测 `grep -n "export async function prepareZcodeHome" -A 60`。未执行写命令、无法构造 chmod 失败复现，故标低置信。

**建议**：把「无副本」档措辞改为不承诺目录内容（如「未见 cli/config.json 副本写入完成的记录」），或在 prepareZcodeHome 抛出路径上区分「写盘后失败」（此时按有副本档提示）。也可仅在 BACKLOG 记一句该窗口，不本题改。

## 认为正确的部分

- 三支判据与 carried 列表严格对得上代码返回结构（前两支在 path_deny 前返回、第三支 path_deny/scratch_paths 照跑），且用 D13/D16 与 M4/M5/M6 变异把「成功不带、跳过不算、误带四行」三个方向都咬住了
- 三条既有 note 改引表后逐字不变（对照旧字面逐条核过），warning↔note 的字面同源由 D16 的「warning 指向的 noteKey 确在该轮 note 里」断言锁住，防了自我循环
- authProbe 重构的行为保持判断属实：删除成功时输出逐字节不变；正结论缓存条目不含 detail（preflight.ts 的 AuthCacheEntry 仅 {checked_at, cli_version, fingerprint, ok}），RUNBOOK「TTL 期内不重复提示」与代码一致
- 退 0 无 envelope 这支此前未登记、本题补入论域并在 BACKLOG 结案条目里写明，处理显式
- 「拉起抛错且删不掉时提示随异常丢失」两侧同形，如实登记为残余而非悄悄修半处
- 探针返回值加第五项的消费面只有 doctor.ts 一处（grep 核实），无解构或 schema 破坏；过程事实不落盘的裁决与 flagsIndeterminate 先例一致

## 未覆盖范围（本侧盲区）

- 未执行构建与测试（沙箱只读，无法跑 npm run check 或变异预跑），全部读数（2621/2619/0、18/18、14/14）取自被审 diff 内落的证据文件本身，未复算
- 计划双审第 1 轮（run 20261003T063541Z）的 7 条意见处置未核对——本轮未读任何 plan 阶段文件，「全接受」按任务书转述
- 实现相对计划 r2 是否有偏离未核验（计划文件在本侧禁读面外但为省时间未读），三条意见均只按代码与文档自身一致性提出
- 未覆盖其余三家适配器与 guard/gate/hooks 面的连锁；doctor-selftest 只核了步数与退出结论的字面，未逐步核对 14 步内容
- ZCode CLI 真实行为（rm 失败形态、TMPDIR 与 os.tmpdir 在装了 CLI 的机器上的交互）为推理，未在真机注入 EACCES 复现
- gemini/claude/codex 三家探针侧是否存在与 CODEX-01 同族的 finally 裸删形态未查（论域限于被审的 zcode 文件）

## 实际查阅的项目文件

- `CLAUDE.md（经环境注入的项目指令）`
- `AGENTS.md`
- `.reviews/zcode探针静默失败收口/code/_meta/changes-20261003T071007Z.diff`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/doctor.ts`
- `src/trivium/preflight.ts`
- `test/unit/zcode-auth-probe.test.ts`
- `test/unit/zcode-doctor-probe-home.test.ts（经 diff 与本文件对读）`
- `doc/05_testing/REPORT_2026-10-03_zcode_probe_silent_fail.md`
- `doc/05_testing/evidence/zcode-probe-silent-fail-20261003/mutation-spec.json`
- `doc/05_testing/evidence/zcode-probe-silent-fail-20261003/mutation-output.txt`
- `doc/05_testing/evidence/zcode-probe-silent-fail-20261003/check-1.txt`
- `doc/05_testing/evidence/zcode-probe-silent-fail-20261003/check-2.txt`
- `doc/05_testing/evidence/zcode-probe-silent-fail-20261003/doctor-selftest.txt`
- `doc/05_testing/README.md（经 diff）`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md（经 diff）`
- `doc/08_project/BACKLOG.md（经 diff）`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md（经 diff 的 §11.3 第 7 条与 v1.3.79 台账行）`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":22,"project_reads":14}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
