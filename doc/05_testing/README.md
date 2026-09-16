# 05_测试验证与质量保证 (Testing & QA)

本目录直接存放所有测试策略、测试用例与验证报告（扁平结构，无子目录），通过文件名前缀区分文档类型。

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
- [`REPORT_2026-09-16_m8_ac20_acceptance.md`](./REPORT_2026-09-16_m8_ac20_acceptance.md)：**M8 第 4 步 · AC-20 真机验收**。`qwen` 与 `deepseek` 两家族各真实审查一次，四个分量（provider 互异 / 生效模型互异 / 各自与请求一致 / provider host 互异）逐一有据；沙箱**正负对照**两侧均成立——正对照用「写命令确实进轨迹且输出显示被拒」，而非计划双审最初提的「另写一个允许写的路径」（那个形态已被实跑证伪）。**含三条达成边界与一条利益冲突标注**（两次取证审的都是 codex 自己的接入代码），引用本条验收时须一并带上。
