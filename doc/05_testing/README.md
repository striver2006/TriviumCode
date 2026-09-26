# 05_测试验证与质量保证 (Testing & QA)

本目录直接存放所有测试策略、测试用例与验证报告（报告扁平存放，通过文件名前缀区分文档类型；`evidence/` 子目录收实跑的原始留痕）。

---

## 文件命名规范

| 前缀 / 格式 | 文档类型 | 说明 | 示例 |
| :--- | :--- | :--- | :--- |
| `PLAN_<名称>.md` | 测试计划 | 阶段测试目标、范围、环境、测试策略与资源分工。 | `PLAN_e2e_pipeline.md` |
| `CASE_<名称>.md` | 测试用例 | 功能测试用例、边界测试矩阵、冒烟测试集。 | `CASE_relay_file_conflict.md` |
| `REPORT_<日期>_<名称>.md` | 测试/压测报告 | 阶段测试执行结果、通过率、缺陷清单与遗留风险。 | `REPORT_2026-09-10_dual_review_bench.md` |
| `BENCHMARK_<名称>.md` | 基准评测 | 模型评审命中率、误报率与执行耗时对比评测。 | `BENCHMARK_gemini_vs_glm.md` |

---

## 测试分层要求
- **单元测试**：针对工件解析与本地命令调用，覆盖率目标 ≥ 80%。
- **端到端测试**：全流程多智能体流水线冒烟测试，保障端到端可执行。

---

## 当前已归档文件

- [`CASE_manual_acceptance.md`](./CASE_manual_acceptance.md)：人工验收剧本（PRD 场景 S1～S5 / 设计 §17.3）。自动化测试与 `doctor --selftest` 覆盖不到的部分——需要人在 Claude Code 窗口里操作，或必须真实消耗两侧厂商配额。
- [`REPORT_2026-09-11_manual_acceptance.md`](./REPORT_2026-09-11_manual_acceptance.md)：人工验收执行结果。剧本 2/4/5 通过，1/3 的 skill 层留给使用者；记录本次真实运行逮到的 6 个缺陷与一次真实代码双审的结果。
- [`REPORT_2026-09-11_m0_probe.md`](./REPORT_2026-09-11_m0_probe.md)：M0 探针本机实测报告。**其 §7 是 `P-xx` 本机坑清单的唯一落点**，跨里程碑持续追加（`P-16～P-18` 系 M4/M5 补录、`P-19～P-23` 系 M6 第 4 步补录、**`P-24～P-27` 系 M8 第 4 步补录**——codex 不校验 `-m` 与 `-p` 的对应、模型目录逐 profile 分层且端点只认可见项、`debug models` 不接受 `--json`、本机目录文件是活的）；§1～§6 / §8 / §9 是 M0 当时的里程碑快照，含 12 条与厂商文档记载不符之处 C-01～C-12。活台账寄生在历史快照里是已知的结构问题，登记 BACKLOG **EV-13**、排期 M11。
- [`REPORT_2026-09-14_m6_codex_probe.md`](./REPORT_2026-09-14_m6_codex_probe.md)：M6 第 2 步 · Codex 探针实测（`codex-cli 0.154.0`）。**推翻三条设计事实**（`-p` 是文件分层而非 `[profiles.*]` 段、effort 档位表全错且 CLI 不校验、模型目录路径名对不上），并记两条决定 M8 可行性的硬事实（读取无结构化路径 ⇒ EV-01 升为 M8 前置；沙箱拒绝静默不进事件流 ⇒ 「轨迹有写事件 ⇒ 失守」对该侧永久为假）。**设计 3.6 的数据来源。**
- [`REPORT_2026-09-14_m6_claude_probe.md`](./REPORT_2026-09-14_m6_claude_probe.md)：M6 第 3 步 · Claude Code headless 探针实测（`claude 2.1.270`）。`--strict-mcp-config` 是硬前置（不传则 MCP 写工具进入工具面、成本 ×24）；路径级 deny **对 `Read` 可用、对 `Grep` 不可用**，故第 ③ 道屏蔽不能单靠 CLI 层。**设计 3.7 的数据来源。**
- [`REPORT_2026-09-15_m6_driver_entry_probe.md`](./REPORT_2026-09-15_m6_driver_entry_probe.md)：M6 第 4 步 · Driver 入口承载面与 zcode 复测（零配额）。新增坑 **P-19～P-23**：`CODEX_HOME` 隔离不住指令面、zcode 的 user 级 command 盖过 project 级、skills 重名不去重不告警、`~/.agents/skills` 被两家共享、codex 的承载面是 skills 而非 `prompts/`。结论**刻意不进机读段**，理由见该报告 §0。
- [`REPORT_2026-09-17_m9_claude_entry_probe.md`](./REPORT_2026-09-17_m9_claude_entry_probe.md)：M9 第 1 步 · Claude Code 准入实测（`claude 2.1.273`，零适配器代码）。EV-41 结案：三种 prompt 载入形态全部成立、31,913 字节送审包不需分片；**`--restricted` 会连项目记忆 `CLAUDE.md` 一起阻断**（单变量对照，否证了第 ⑤ 件的理由，EV-44 据此裁定不做）；`denied_tool_in_trace` 首个正向样本；审查尺度 slug 由 `system/init` 回读。**设计 3.7 / 3.7.1 的 M9 数据来源。**
- [`REPORT_2026-09-18_m9_claude_admission.md`](./REPORT_2026-09-18_m9_claude_admission.md)：M9 第 3 步 · 准入收口实测（`claude 2.1.276`，装置 `scripts/claude-admission-control.mjs`）。EV-42 正向结案（`file_shape_verified`，两个独立装置同结论）、EV-43 七格 argv / stdin 双臂零分叉、EV-44 第 ⑤ 件裁定不做并落 `project_memory_blocked` 三态。
- [`REPORT_2026-09-19_m9_claude_critic_acceptance.md`](./REPORT_2026-09-19_m9_claude_critic_acceptance.md)：**M9 第 6 步 · 审核者验收实跑第 1 轮（未达成）**。载体取名义 Driver（`--driver codex`），被审对象为历史提交 `3812f4c`。第 1 跑零 API 调用即拒（`review.v1.json` 的 2020-12 `$schema` 头，EV-74）；第 2 跑 525s / $1.58 跑通但 J5 失败（`consulted` 10/15，目录级 Grep 命中不在核对面，EV-76）且 `readonly_breach` 误判（`StructuredOutput` 被算成写，EV-75）。零成本判据全过。证据 `evidence/m9-acceptance-20260919/`。
- [`REPORT_2026-09-20_m9_claude_critic_acceptance_r2.md`](./REPORT_2026-09-20_m9_claude_critic_acceptance_r2.md)：**M9 第 6 步 · 第 2 轮（第 3 次尝试）——M9 完成判据达成**。同一剧本、同一被审对象、构建身份 `a75ec43`；429s / $1.25，`consulted` 9/9、`readonly_breach: false`（EV-75 豁免与闸门接线首次在真实链路成立）、`peer_deny_applied: true`。审查结论的 2 条 blocker 在本仓 HEAD 复现（EV-79）；`checkReviewIntegrity` 告警噪声登记 EV-80。四条达成边界（名义 Driver、同 claude 家族、J6 未诱导、真载体 Hook 未验 EV-77）随报告登记。证据 `evidence/m9-acceptance-20260920/`。
- `evidence/`：实跑的原始留痕（run / review / brief / trace / worker 日志 / Hook 与闸门原始输出 / 复现脚本），按 `m<里程碑>-<用途>-<日期>/` 分目录；`m9-step7-20260920/` 是 M9 第 7 步纪律 6 回溯的 grep 差集自检记录；`zcode-provider-config-20260920/` 是 ZCode 0.16.9 provider 配置注入（坑 P-28～P-30，EV-81）的本机实测原始输出。
- [`REPORT_2026-09-23_m10a_step2_ev55.md`](./REPORT_2026-09-23_m10a_step2_ev55.md)：**M10a 第 2 步 · EV-55 提交锚「位置 + 登记」重写的变异验证**。代码双审 r2（18 条）+ r3（10 条）收口后，15 条变异全部变红；冻结哈希两项不可鉴别、如实登记；提交锚删后缀支后的两格剩余边界（收尾追加那一刻、登记前崩溃并被提交）只剩写侧，与 BACKLOG EV-55 同源。
- [`REPORT_2026-09-23_m10a_step3.md`](./REPORT_2026-09-23_m10a_step3.md)：**M10a 第 3 步 · 翻开 `driverEnabled` 与 approve 前置复核**。计划双审两轮（13 + 8 条全接受）后按 r3 实施，代码双审 r4（5 条全接受）后修订；1694 条全绿；10 条变异经 `mutation-check.mjs` 全部咬住（M6c 首跑没红，查出集成用例被选侧那道防线掩盖，修用例后咬住；M1 逐条归因为推断）；与 r3 的 9 处出入逐条登记，其中一处是初稿又把启发式判据写成确定性保证、自审改掉；设计文档口径移交第 5 步（EV-106）。
- [`REPORT_2026-09-23_m10a_step4.md`](./REPORT_2026-09-23_m10a_step4.md)：**M10a 第 4 步 · 登记清理（EV-62 / EV-64 / EV-07）**。计划双审两轮（13 + 9 条）后按 r3 实施；1703 条全绿（首跑接入套件因新增厂商未登记名义族而编译报错，正是 `Record<AgentVendor, …>` 要的效果，补夹具后绿）；11 条变异经装置全部咬住，条数与期望逐条相符，归因为推断；装置本身新加闸 7 与哨兵拆分，2 条手工变异（M-D3 / M-D4）咬住；EV-62 判据两层启发式、残余面登记 EV-107；非缺省 Driver 下 `heterogeneous` 取值没有端到端用例，如实列为缺口。代码双审 r5（5 条全接受）后修订：非空断言的前提改指真正生效的 run.v2 校验、同源旗标标题加「疑似」、结案段变异条数与装置闸表标题改准。变异规格与生成脚本收在 [`evidence/m10a-step4-mutation-20260923/`](./evidence/m10a-step4-mutation-20260923/)，可直接重跑。
- [`REPORT_2026-09-23_m10a_step5_d3.md`](./REPORT_2026-09-23_m10a_step5_d3.md)：**M10a 第 5 步段一 · Bash 侧角色后缀全集字面保护（D3）与认领出口文案**。D3 原定第 2 步、未实施也无撤回记录，第 5 步按用户拍板补上：判据与拦截文案改为同源取全集（含当轮 Driver 自己的后缀），认领被拒的出口改写真实理由、不再断言「会话内删不掉」。代码双审 r6（6 条全接受）后又改掉同一段里两句把局部事实写成普遍属性的话（分支 4 下的文件不是「孤儿」、L2 家族没有 Bash 守卫）。1709 条全绿；5 条变异全部咬住（MD3a 多红的一条经逐条核实为用例前提连带）；实施中查出两条用例测不出变异、已修；误拦面扩大（`-claude.md` 进 Bash 字面集，含 heredoc 正文形态）如实列为代价。
- [`REPORT_2026-09-24_m10a_step5.md`](./REPORT_2026-09-24_m10a_step5.md)：**M10a 第 5 步段二 · 纪律 6 回溯（M10a 份额），M10a 五步收口**。主设计 v1.3.37、PRD v1.4.7、LLD v1.1.2、MANUAL v1.0.2 与十余份门面文档；16.1 M10 行拆 M10a / M10b，M10a 记八条达成边界；AC-21 只标子句 ③；`verify-*.json`「由不受保护变为受保护」改准为「由单锚变双锚」。回溯完整性三层核法：逐项对账表 + 来源反向表 + grep 锚差集（证据 `evidence/m10a-step5-20260924/`），残余待办五项给了去向；1709 条全绿。
- [`REPORT_2026-09-24_m10b_driver_entry_probe.md`](./REPORT_2026-09-24_m10b_driver_entry_probe.md)：**M10b 第 1 步 · 准入实测（进行中）**。已收 zcode 的 Hook 静态核、写工具来源 ①、真载体 P-a 与会话留痕；2026-09-25 补 agy、codex、嵌套枚举三臂（12 次真实调用）。codex：skill 显式提及即注入，但 `$ARGUMENTS` 不替换，参数只以用户消息原文到达；同名双根两份都列、显式调用失效且无告警；嵌套会递归枚举并可调用。agy：登录态在登录钥匙串，隔离 `HOME` 不可行；print 模式不读工作区根，全局根可展开、不递归；`$ARGUMENTS` 同样不替换，但参数原文逐字到达。§18.1 #16 按用户选的 C 路径落「skills 优先」。同日补 zcode：桌面端夹具会话实测项目级 Hook 能以退出码 2 拒写，但信任前与超时都静默放行，外挂 MCP 写工具不过 matcher（`hooks_deny_ok` 记「true，有三个前提」）；会话 ID 只进 Hook 环境、不进 shell 工具环境；rollout 只保留最近 3 个会话；两侧解析回退诊断（codex 适配器没接 `--output-schema`）。续测补齐 zcode 余下四格：同名 skill 由 `~/.zcode/skills` 胜出、不告警；子代理里的写调用不过工作区 Hook；命令行模式下工作区 Hook 整体关闭；ApplyPatch 路径嵌在 `operation.path`（静态）。`hooks_deny_ok` 的前提由三条扩为五条，取值路径用户拍板为自动探针，工程量估算留到第 3 步。EV-107 前置臂（r5 §4.7，run `20260925T031426Z`，`--driver codex`）判据两侧六格全部成立，证据 [`evidence/m10b-ev107-20260925/`](./evidence/m10b-ev107-20260925/)。其余证据 [`evidence/m10b-entry-probe-20260925/`](./evidence/m10b-entry-probe-20260925/)。
- [`REPORT_2026-09-25_m10b_step2.md`](./REPORT_2026-09-25_m10b_step2.md)：**M10b 第 2 步 · 实施报告（待代码双审）**。入口资产单源渲染（`skills-src/` → 四家产物；第一阶段只抽单源时 7 份 claude 产物逐字节还原）、skill 侧认领步骤与 `--driver` 注入、命令 A 放开 `--driver` 并对 plan / code 两阶段交叉校验、多目标安装器（注册表派生 skill 根、拍平、先查后写只报错不删）、协议片段两段式与旧版指纹升级、EV-61 代码侧残余。全量 1943 / 1941 / 0 / 2，变异 19 / 19，codex 零配额枚举 PASS；glm 薄冒烟待用户在桌面端操作。核出「非 claude Driver 在缺省配置下走不通命令 A」，用户定 (a)：缺省审核者集合减去当轮 Driver（计划 r11 §1）；更正 r10 §2.4.2 的误拦触发条件（r11 §2）。证据 [`evidence/m10b-step2-20260925/`](./evidence/m10b-step2-20260925/)。（该步已结案：代码双审两轮后提交 `246d831`。）
- [`REPORT_2026-09-25_m10b_step3.md`](./REPORT_2026-09-25_m10b_step3.md)：**M10b 第 3 步 · Hook 多目标、B1 护栏等级接线与停点话术按当轮 Driver 措辞**（代码双审 r3 后提交 `da6476c`）。`hook-config.ts` 同源渲染 claude / zcode 两种形态、`trivium hooks --agent`、预检等级行与 `run.v2.driver_guard_level`；Claude Code Hook 超时与子代理的官方文档查证（§3）；附录 A 为 glm 第二轮薄冒烟（五个 Hook 在 ZCode 桌面端全部生效，核出「信任要在会话开始前完成」）。
- [`REPORT_2026-09-25_m10b_step4.md`](./REPORT_2026-09-25_m10b_step4.md)：**M10b 第 4 步 · 五轮验收**（2026-09-26 收口）。3-1 claude plan（§7.3.1 两形态）、3-2 claude code 兼容 J3（无白名单外差异）、3-3 gemini 名义 Driver、3-4 codex 真载体 + EV-77、3-5 glm 真载体 J4；EV-107 四轮逐格端到端；新登 EV-129～EV-134（其中 EV-132：闸门期越界事后两道都不暴露）。证据 `evidence/m10b-step4-*`。
- [`REPORT_2026-09-26_m10b_step5.md`](./REPORT_2026-09-26_m10b_step5.md)：**M10b 第 5 步 · 纪律 6 回溯（M10b 份额）**。主设计 v1.3.43、PRD v1.4.8、LLD v1.1.3、MANUAL v1.0.3 与门面文档；逐项对账表、反向表与 grep 锚差集。
- [`REPORT_2026-09-26_trace_copy_fixes.md`](./REPORT_2026-09-26_trace_copy_fixes.md)：**留痕与文案小修**（EV-129 / EV-130 ① / EV-131 / EV-132 ① / EV-133 / EV-134）。`addresses` 由只核非空收紧为按 `run.json.artifacts[]` 逐项比对；L2 事后覆盖面文案按时点写实并更正「漂移复算只比已跟踪文件」；代码双审 r1 7 条全接受并修订；全量 2048/2046/0/2，源码变异 16/16（第 1 轮 M10 未咬住、补用例后咬住）、契约变异 8/8、零配额验收 10/10。
- [`REPORT_2026-09-26_trace_field_fixes.md`](./REPORT_2026-09-26_trace_field_fixes.md)：**留痕字段与误报小修**（EV-127 / EV-128 / EV-137）。evidence 路径抽取改为整段以根目录起头（历史 56 条截断误报全去、新报 0）；`review --cancel` 在工作进程确认退出后把仍为 running 的 run.json 与 task.json 登记收尾为 cancelled（排在 status.json 之前、可重入、不抛）；`forged_role_file` 定为恒 false 的保留字段、report 不再读取。check 2103/2101/0/2、源码变异 17/17、验收 13/13（第 1 次 12/13：report 不列无工件的取消轮，计划预期不成立，如实改写，登 EV-144）；代码双审 r1 5 条全接受。
- [`REPORT_2026-09-26_worktree_summary.md`](./REPORT_2026-09-26_worktree_summary.md)：**审批前工作树摘要**（EV-132 候选 ② 折中版）。`approve` 通过与两个停点出口打印自审查收尾以来的工作树改动摘要，只告知、不拦、不改判定；基线为 run.v2 新增可选字段 `snapshot.after_tree_hash`；取不到时报四种原因、不报「无改动」。代码双审 r1 7 条接受 6、暂缓 1 并修订（照抄命令形状闸与加引号、预算注入自我暴露、按进程组收尾与整体截止）；全量 2080/2078/0/2，源码变异 20/20、契约变异 6/6、零配额验收 13/13（含 `git gc --auto` 实测：当天的基线不会被清）。
- [`REPORT_2026-09-16_m8_ac20_acceptance.md`](./REPORT_2026-09-16_m8_ac20_acceptance.md)：**M8 第 4 步 · AC-20 真机验收**。`qwen` 与 `deepseek` 两家族各真实审查一次，四个分量（provider 互异 / 生效模型互异 / 各自与请求一致 / provider host 互异）逐一有据；沙箱**正负对照**两侧均成立——正对照用「写命令确实进轨迹且输出显示被拒」，而非计划双审最初提的「另写一个允许写的路径」（那个形态已被实跑证伪）。**含三条达成边界与一条利益冲突标注**（两次取证审的都是 codex 自己的接入代码），引用本条验收时须一并带上。
