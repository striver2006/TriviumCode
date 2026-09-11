---
schema: trivium.review.v1
topic: C命令base透传修复
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.1
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: medium
run_id: 20260911T155806Z
rerun_index: 1
snapshot_hash: sha256:87374ac93724a3f4271f1dbe39074ed7f36c70589fe8fe6b9eff851f2e1126d9
blind: true
started_at: 2026-09-11T15:58:06.862Z
finished_at: 2026-09-11T16:08:03.932Z
duration_s: 157
tool_calls:
  read: 29
  grep: 9
  glob: 1
  run_command: 0
  project_reads: 26
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 2
  minor: 1
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 8a83fd4a-9811-4ead-a258-10475aefaa80
---

# 代码审查：C命令base透传修复

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260911T155806Z`

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最主要的问题在于同类缺口未完全闭环：虽然命令 C 的 base 参数透传说明详尽准确且 §9.2 两点 diff 修正成立，但同类的命令 B/D 漏传 plan-file/rca-file，以及所有审查命令模板均漏传 model-gemini/model-glm 参数，用户指定覆盖会被静默丢弃；另设计 §9.2 算法列中「在②的 tree 基础上生成」的表述仍与代码生成时序存在轻微脱节。

**结论**：`request-changes`

## 审查意见（共 4 条：重要 2 ｜ 次要 1 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `skills/dual-review-plan/SKILL.md:40` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：同类参数缺口：命令 B (dual-review-plan) 与命令 D (dual-review-bug) 声明了 plan-file / rca-file 参数且 topic resolve 能解析，但 review --start 命令模板中未透传且未说明。

**依据**：查阅 skills/dual-review-plan/SKILL.md:4,40，argument-hint 声明了 [--plan-file <路径>]，但第 40 行命令模板 TV review --start 仅包含 [--context …]，未透传 [--plan-file <路径>]；查阅 skills/dual-review-bug/SKILL.md:4,40，同理声明了 [--rca-file <路径>] 却在第 40 行命令模板中遗漏。对比 src/trivium/topic-args.ts:194-195 与 src/trivium/cli.ts:281，底层 CLI 完全支持这两个参数。漏传将导致 locateSubject 回退到默认归档查找，出现找不到报错 65 或误审旧原稿。

**建议**：参照 dual-review-code 修复 base 透传的方式，在 dual-review-plan/SKILL.md 与 dual-review-bug/SKILL.md 步骤 3 的 review --start 命令模板中分别补齐 [--plan-file <路径>] 与 [--rca-file <路径>]，并增加指导 Driver 透传对应路径的文字说明。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `skills/dual-review-code/SKILL.md:40` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：同类参数缺口：审查命令 argument-hint 声明的 --model-gemini 与 --model-glm 在 review --start 命令模板中被全部遗漏，用户指定的模型覆盖无法生效。

**依据**：查阅 skills/dual-review-code/SKILL.md:4,40、skills/dual-review-plan/SKILL.md:4,40、skills/dual-review-bug/SKILL.md:4,40 及 skills/dual-run/SKILL.md:4,33，四个命令均在 argument-hint 中声明了 [--model-gemini <slug>] [--model-glm <id>]，且 src/trivium/topic-args.ts:180-182 与 src/trivium/cli.ts:269-272 均完整支持模型覆盖解析；但在所有 review --start 命令模板（包括本次 dual-review-code 的修改）中均未写入模型覆盖参数，亦未引导 Driver 透传 models 字段。用户通过命令行指定的自定义模型会被 Driver 完全忽略。

**建议**：在 dual-review-code/SKILL.md 以及其它审查 skill 的 TV review --start 命令模板中增加 [--model-gemini <slug>] [--model-glm <id>]，并引导 Driver 将 resolve 输出的 models 字段按需透传。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md:996` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：设计 §9.2 算法列关于「在②得到的 tree 基础上生成 diff」的表述与实际执行流程存在时序与算法上的偏差。

**依据**：查阅 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md:996，表格算法列描述为「在②得到的 tree 基础上生成 changes-<run_id>.diff（--find-renames）存 code/_meta/」；而核对 src/trivium/review.ts:347,414 可知，补丁是通过 diffAgainst 直接调用 git diff 对工作区与未跟踪文件对比生成的，随后才在 freeze() 中执行步骤②的临时索引 workTreeHash，补丁生成并未依赖或消费②的 tree。

**建议**：微调设计 §9.2 表格中 code 阶段的算法描述，明确 diff 是直接由 diffAgainst 对比工作区与未跟踪文件生成，而非基于临时索引 write-tree 得到的 tree_hash。

### AGY-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `skills/dual-run/SKILL.md:4` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：参数断裂：dual-run/SKILL.md 声明了 --profile 参数，但编排器 CLI 根本未实现该参数。

**依据**：查阅 skills/dual-run/SKILL.md:4，声明了 [--profile <名称>]，src/trivium/topic-args.ts:24,131,225 也解析并返回了 profile 字段；但检查 src/trivium/cli.ts 全文，没有任何子命令解析或接收 --profile 选项，命令行传入的 profile 全链路断裂。

**建议**：评估是否应在编排器 CLI 中统一支持 --profile 参数以切换配置 profile，若暂不实现则应从 dual-run/SKILL.md 的 argument-hint 中移除该参数声明。

## 认为正确的部分

- skills/dual-review-code/SKILL.md 对 base 参数透传的说明详实准确，清晰揭示了 resolve 必定输出 base 字段、照抄 resolve 结果最稳妥、两点 diff 语义而非 merge-base 语义、以及漏传导致静默退回 HEAD 的错审风险。
- 设计 §9.2 表格中将快照对象的 git diff <base>...工作区 修正为两点 diff 描述，纠正了原先三点 diff 的笔误，与 src/trivium/util/git.ts:diffAgainst 的实际实现语义保持一致。
- 代码在 diffAgainst 中保持了对 --base 参数校验的健壮性（非零退出抛出异常而非吞掉），与 SKILL 侧的透传指示形成了契约闭环。

## 未覆盖范围（本侧盲区）

- 未在真实 VS Code 与 Claude Code 运行时环境中实测命令启动并观察 Driver 参数拼接过程；
- 未在命令行真实传入非法 git ref 执行 review --start 以演练异常退出；
- 未覆盖 doctor、verify、report 等非审查核心链路的完整代码。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md`
- `skills/dual-review-code/SKILL.md`
- `skills/dual-run/SKILL.md`
- `skills/dual-review-plan/SKILL.md`
- `skills/dual-review-bug/SKILL.md`
- `skills/dual-approve/SKILL.md`
- `skills/dual-abandon/SKILL.md`
- `skills/dual-status/SKILL.md`
- `src/trivium/code-stage.ts`
- `src/trivium/freeze.ts`
- `src/trivium/util/git.ts`
- `src/trivium/topic-args.ts`
- `src/trivium/cli.ts`
- `src/trivium/review.ts`
- `src/trivium/guard.ts`
- `src/trivium/topic.ts`
- `src/trivium/types.ts`
- `src/trivium/meta.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":29,"grep":9,"glob":1,"run_command":0,"project_reads":26}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
