---
schema: trivium.review.v1
topic: 失联worker退出后补收
stage: plan
role: codex
vendor: openai
agent_cli: codex/0.157.1
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260928T142320Z
rerun_index: 1
snapshot_hash: sha256:a34b837f32a723aa17574328616613326534c7c1f1394d1018e2dbc71a3958ad
blind: true
started_at: 2026-09-28T14:23:21.622Z
finished_at: 2026-09-28T14:32:40.040Z
duration_s: 418
tool_calls:
  run_command: 23
  project_reads: 15
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 1
  minor: 2
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0e866-1f4d-7752-bff3-1a9f08a63f5d
---

# 计划审查：失联worker退出后补收

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260928T142320Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

计划的技术方向与现状核对整体扎实：§3.1 的 quirk 论证、§3.2 的逐字抽取、§1.2/§1.4 的现状与幂等读法、§4.5 第二形态暂缓论证，我逐条对照源码核实均成立；验证面零配额、文档锚点真实。最需要现在改的一条：§3.3 的 finalizeGoneWorker 结论句硬编码「已按前提补收」，而它调用的共享函数不返回任何结果信息，在可重入场景（N2/G2/A3 的「已是终态，不追溯改写」）与归档缺失场景（R-K5P-N 的「归档里没有 run-….json」）会输出与紧邻上一行自相矛盾的假结论，直接违反用户决策 6「输出按事实说」，且计划列出的任何断言都不会拦住它。另有两条文案/验证表的小问题。均为局部修订，不需要改方向、不必然触发 r2。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：重要 1 ｜ 次要 2）

### CODEX-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.3（finalizeGoneWorker 的结论句）与 §3.2（共享函数返回 void）的接口不匹配` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：finalizeGoneWorker 在 finalizeLostAndReclaimLock（返回 Promise<void>）之后无条件 say「已按前提补收归档 run.json 与运行登记」。但这个函数在两类会发生的场景里什么都没补收：① 可重入路径——第二次 --cancel 落 gone 格时 run.json 已是 failed，meta.ts 的 unfinishedRunMetaStep 走 skip('已是终态（…），不追溯改写')，上一行刚播「跳过」，下一行就说「已补收」，输出自相矛盾；② 归档缺失路径——§1.5 自己指出 K5′ 的 R-K5P-N 会走 skipped('归档里没有 run-….json')，N7 计划补断言钉住这个跳过分支，但同一进程随后仍会打出「已按前提补收」。用户决策 6 明确要求「输出按事实说（补收了/按前提跳过/写失败）」，本句在最显眼的结论行上违背它；且 §5.1 全部断言（N2「输出改为已是终态」、N7 跳过分支断言）都用 assert.match 正向匹配，没有任何一条 doesNotMatch 会拦住这句假话——它会静默发布。

**依据**：读了计划 §3.2/§3.3/§1.4/§1.5/N2/N7；src/trivium/run-protocol.ts:1553-1593（cancelLostWorker 第 4/5 步与其结论句的既有形态——它对同样含 skip 的情形写的是「归档 run.json 与运行登记见上方输出」，从不复述结论）；src/trivium/meta.ts:660-700（unfinishedRunMetaStep 的 skip 分支：「已是终态（…），不追溯改写」与「归档里没有 run-….json」均为非错误跳过，reportFinalizeStep 走 step 照常播报）；test/integration/run-protocol.test.ts:979-1028（R-K5P-N 场景无 seedArchive）。计划 §1.4 自己的表述（「输出如实说『按前提跳过』而不是『无需取消』」）与 §3.3 的代码形态互相矛盾。

**建议**：方向（不给整段补丁）：让 finalizeLostAndReclaimLock 返回两步的 FinalizeStep（或按既有三态聚合一个「补收了/按前提跳过了/有步骤没写成」的结论），finalizeGoneWorker 的结论句据实组装，或沿用 cancelLostWorker 的「见上方输出」句式不复述事实；并在 N2/N7 各加一条断言钉住「跳过时不得出现『已按前提补收』字样」。

### CODEX-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §3.2 共享函数内新 noSecondChance 文案「再跑一次仍会落进同一格并重试这一步」` |
| 类别 | correctness ｜ 层次 plan |
| 置信度 | high |

**问题**：「同一格」不成立。这段文案由 alive 格与 gone 格共用：alive 格写失败发生在「已结束工作进程并确认退出」之后（cancelLostWorker 第 4 步的前置），下一次 --cancel 判格时 worker 已死、落的是 gone 格——不是同一格。用户决策 6/7 恰恰要求把「能不能重试」的措辞改准，K9/N4 又要将这句话原文写进测试断言，不准确的事实会被测试固化。

**依据**：读了 src/trivium/run-protocol.ts:1550-1565（现 noSecondChance 只在 gone 确认之后的第 4 步使用）与 :1486-1525（走到第 4 步 ⇒ gone 已确认 ⇒ 下次必落 gone）；计划 §2 覆盖矩阵本身写明 alive 格的下一次归宿是 gone 格（§1.5 对 K8 的描述「alive 成功之后再跑一次 --cancel，落进 gone 格」即同一事实）。

**建议**：把「落进同一格」改成「落进会重试这一步的格（gone 格）」之类的按事实措辞；gone 格自身重入时该句依然成立，无需分两段文案。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `plan §5.3 变异表 M8 行（预期咬住 = 集成 G1 的输出顺序断言）与 §5.2 G1 的描述` |
| 类别 | test-gap ｜ 层次 plan |
| 置信度 | medium |

**问题**：M8 的咬住机制写错了，且 M8 的变异形态与被引用的生成器可能不同族。§5.2 的 G1 描述里没有任何「输出顺序断言」；而「把 finalizeGoneWorker 的调用挪到 CLI 结束块之前」在真实代码里的后果不是顺序变化，而是 finalizeGoneWorker 的 return 使 CLI 结束块整个不可达——G1 真正能咬住它的是「CLI 两组都按记录结束」断言，不是顺序断言。按表面描述去实现，M8 会被标成「无失败用例咬住」而要求补用例；另外计划声明「规格由生成脚本从源码截锚点」「照搬 gen-mutation-spec.mjs」，我核了该目录存在，但它此前支撑的是取值/删块类变异，语句挪位是否在同一生成器的表达形态内计划没有交代。

**依据**：读了计划 §5.2/§5.3 与 §3.4 的接线代码（finalizeGoneWorker 含 return，挪到 CLI 块前即短路 CLI 结束）；doc/05_testing/evidence/worker-start-canonical-20260928/ 目录实际含 gen-mutation-spec.mjs、acceptance.mjs（ls 核实存在，未读其内容以确认变异表达形态的覆盖面）；test/integration/run-protocol.test.ts:979-1028（G1 沿用的断言形态以 groupMemberCount/文案 match 为主，无跨段顺序断言的先例描述可挂靠）。

**建议**：把 M8 的预期咬住改标为 G1 的「CLI 两组都按记录结束」断言（或在 G1 里显式加一条输出先后断言并写进 §5.2）；实施前确认重挪位型变异能否由所引用的生成脚本表达，不能则单独说明 M8 的手工注入方式。

## 认为正确的部分

- §3.1 的收窄论证成立：util/exec.ts:504-524 的 processAlive 在不传期望启动时刻时只可能把 sameProcess 放宽为 true，.alive 始终由 process.kill(pid,0)（EPERM 计存活）单独判出；把「两种启动时刻都缺失但进程不在」改判 gone 不引入新判定能力，也不给存活但身份不明的进程放行（§4.6 的保守分支正确）。
- §3.2 抽取的「逐字相同」属实：run-protocol.ts:1555-1579 的第 4/5 步与共享函数草案除 noSecondChance 措辞外一致；lock.ts:146-176 的 reclaimStaleLock 只做 rename+内容复验、不要求持锁进程存活，gone 格（进程已死）复用它是安全的。
- §1.2/§1.5 现状核对属实：gone 格今天确实无专属分支、CLI 结束块条件 cell.kind !== 'mismatch' 已覆盖 gone；status.ts:200-213 的 workerConfirmedGone 与延伸后的 gone 格判据（pid 死 ⇒ 两判据同向）不冲突，D-C「不重复结束 CLI」的推理成立。
- §4.5 第二形态暂缓的论证我认可：meta.ts:652-653 文档块自证「事后写者有三个」，worker 异常分支与旧版判失联在结构化字段上不可区分，唯一区分在 message——用户决策 4 禁止读 message，误判会把 worker_exception 写成 worker_lost，归档只追加、代价不可逆。D-D 欢迎反证的态度恰当。
- §1.4 的可重入机制与 K8/K9/K4/K5′ 的行号、断言原文核对一致（run-protocol.test.ts:979-1131），把它列为「预期之内的测试变更而非回归」的分类正确。
- 成本口径（我的镜头）：全部验证走桩与本地子进程、不花厂商配额，符合决策 9；§5.4 的新旧对照用 git archive 旧构建 + node_modules 软链，与既有 evidence/worker-start-canonical-20260928 同骨架且该骨架真实存在，路径可行；8 个变异体与 M1–M7 的预期咬住用例映射我逐条核过，除 M8 外均成立。回滚面（我的镜头）不新增 schema/取值、A2 验证旧版读新版工件不报错不误改，回滚成本核算基本充分。

## 未覆盖范围（本侧盲区）

- 没有读 scripts/mutation-check.mjs 与 gen-mutation-spec.mjs 的实现，M8 挪位型变异是否可为该生成器表达只提出了疑问（CODEX-03），未下断言。
- 没有读主设计文档 v1.3.54 段全文与 BACKLOG 的 EV-159/EV-157/EV-160 原文，§6 各文档修订点只 grep 核对了 LLD/MANUAL/PROTOCOL 的锚点行存在且措辞引用属实。
- 没有读任务目标提到的三份记忆文件（m10b-next-after-ev82 / pipeline-known-pitfalls / reply-in-chinese），对「计划是否符合记忆中的坑清单」未置一词。
- EPERM（pid 被他人用户复用）与 PID 复用竞态在延伸格里的真实概率未实测——按计划自身的保守口径（判活即不动）视为可接受，未展开。
- G1/G2 集成测试在慢盘/高负载下的计时裕度未评估（计划称参考 J1，我没有读 J1 的计时常量）。

## 实际查阅的项目文件

- `.reviews/失联worker退出后补收/plan/2026-09-28-失联worker退出后补收-claude.md`
- `src/trivium/run-protocol.ts`
- `src/trivium/meta.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/status.ts`
- `src/trivium/lock.ts`
- `test/integration/run-protocol.test.ts`
- `test/integration/gate-loop.test.ts`
- `src/trivium/adapters/stub.ts`
- `doc/07_manuals/MANUAL_user.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/05_testing/evidence/worker-start-canonical-20260928/（目录清单）`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":23,"project_reads":15}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
