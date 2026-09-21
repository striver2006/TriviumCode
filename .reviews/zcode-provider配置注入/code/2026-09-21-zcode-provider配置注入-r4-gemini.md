---
schema: trivium.review.v1
topic: zcode-provider配置注入
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.7
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260921T083716Z
rerun_index: 4
snapshot_hash: sha256:cdd65a99bcce866dbe2ba708581d9b8606bd1d2541c7eeb84df89cb5044ef4a1
blind: true
started_at: 2026-09-21T08:37:17.416Z
finished_at: 2026-09-21T08:53:10.655Z
duration_s: 193
tool_calls:
  read: 36
  grep: 9
  glob: 0
  run_command: 0
  project_reads: 15
evidence_ok: true
verdict: approve
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
joint_check:
  state: skipped-insufficient-sides
  effective_sides: 1
heterogeneous: true
session_id: 80207e37-76c4-4402-aa01-4955d2c3376e
---

# 代码审查：zcode-provider配置注入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260921T083716Z` ｜ 第 4 轮
> ｜ 本轮审核者 codex、gemini

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

r3 裁决八条落点与三处实施判断全部严谨落地，测试与留痕齐备。DoctorReport 新增 warnings 档位结构完整且无消费方遗漏，退出码判定严格隔离；version 探针只清不给与空集双义文案分流两处刻意收窄理由充分成立，有效收敛了缺陷且未制造新误导；invokeZcode 的 userHome 注入口仅用于单元测试隔离，生产调用统一无分叉，形态与 EV-83 一致可并案；新增可用性用例在两支换序时确会变红，killTree 安全无副作用；设计记录与留痕逐项对账无误。整体判定为 approve。

**结论**：`approve`

## 审查意见

本侧**未发现问题**。

> 这不等于「没审」：请对照下方「未覆盖范围」判断这一结论的边界。

## 认为正确的部分

- DoctorReport 增设 warnings 档位：接口定义、构造初始化、人读终端渲染与 CLI JSON 输出均完整一致改动，退出码与 ok 字段严格保持仅由 blockers 决定；SeverityLine 维持 blocker|note 两档，未向 Agent 探针开放 warning 级别，隔离清晰有效，避免了降级 blocker 的误用。
- version 探针显式清除环境变量底色：针对 0.16.9 下 version 子命令不读 provider 配置的实测事实，采用「只清不给（undefined）」设计，避免逐候选试探时的额外 I/O 与环境假设，同时彻底阻断宿主诱饵变量透传，缺陷彻底收敛。
- 空集双义文案分流而非过程状态落盘：坚持只落盘能力事实格的架构设计原则，在 doctor 报告中通过 warnings 突出展示旗标未判定风险，并在 availability() 旗标判空分支补充核对安装布局与重跑 doctor 的指引，彻底消除了原先单一误导升级 ZCode 的死胡同。
- invokeZcode 的 userHome 参数作为仅限单元测试使用的注入口，未在生产调用链造成口径分叉，全库生产环境对用户根目录的依赖保持一致（os.homedir()），逻辑形态完全归入 EV-83，未来可统一并案收口。
- zcode-availability.test.ts 新增的 3 条用例成功锁定了「布局缺失优先于旗标缺失」的判断顺序与向后兼容性，两支换序时第 82 行用例确实会当场变红；probeReadonlyFlags 的 killTree: true 保障了超时异常下的进程树彻底收割且在测试与生产场景均无负面副作用。

## 未覆盖范围（本侧盲区）

- 真实 ZCode 0.16.9 环境下破坏安装布局触发 Built-in Provider Config 缺失的实际终端行为（依从留痕说明，未在开发机真实安装布局上做破坏性实验，由 Fake Entry 夹具测试保证）。
- probeReadonlyFlags 在真实拉起 7 次调用超时场景下的 killTree 实际收割进程树行为（由于该条件依赖真实模型调用超时，未耗费真实配额复现）。
- 补丁外通道由用户指定的 .trivium/config.yaml 改动对整体运行会话的端到端耗时影响（不在代码审查补丁论域内）。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/LLD_orchestrator.md`
- `doc/05_testing/README.md`
- `doc/05_testing/REPORT_2026-09-11_m0_probe.md`
- `doc/05_testing/evidence/zcode-provider-config-20260920/r3-implementation-doctor-20260921.md`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/07_manuals/QUICKSTART.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/cli.ts`
- `src/trivium/doctor.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/types.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/preflight.ts`
- `test/unit/zcode-availability.test.ts`
- `test/unit/zcode-provider-env.test.ts`
- `.reviews/zcode-provider配置注入/code/2026-09-21-zcode-provider配置注入-r3-response-claude.md`
- `.reviews/zcode-provider配置注入/code/_meta/changes-20260921T083716Z.diff`

> 编排器从工具轨迹中记录到的读取次数：{"read":36,"grep":9,"glob":0,"run_command":0,"project_reads":15}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
