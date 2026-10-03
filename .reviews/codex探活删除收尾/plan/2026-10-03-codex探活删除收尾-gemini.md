---
schema: trivium.review.v1
topic: codex探活删除收尾
stage: plan
role: gemini
vendor: antigravity
agent_cli: agy/1.2.16
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20261003T142424Z
rerun_index: 1
snapshot_hash: sha256:e0bfc73a9d9d0f7571fecfff89568fef93afe08a29655fd039ba6f7218e64f2b
blind: true
started_at: 2026-10-03T14:24:26.704Z
finished_at: 2026-10-03T14:33:11.987Z
duration_s: 286
tool_calls:
  read: 32
  grep: 10
  glob: 0
  run_command: 0
  project_reads: 17
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
session_id: f59fc5a5-4cac-4404-9155-47e747f85ac6
---

# 计划审查：codex探活删除收尾

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20261003T142424Z`
> ｜ 本轮审核者 codex、gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

计划方案整体架构合理、推演完备，通用清理抽离与步骤捕获设计精巧，针对提示两档路径脱敏对齐、步骤助手类型防守及已知指纹残余登记提出了 3 条优化建议，整体结论为 approve-with-nits。

**结论**：`approve-with-nits`

## 审查意见（共 3 条：次要 1 ｜ 吹毛求疵 2）

### AGY-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/codex探活删除收尾/plan/2026-10-03-codex探活删除收尾-claude.md:84` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：计划 §2.3 措辞定义中「无凭据副本」档遗漏家目录归一化标注，存在路径泄露隐患

**依据**：查阅 .reviews/codex探活删除收尾/plan/2026-10-03-codex探活删除收尾-claude.md:83-84 与 src/trivium/adapters/zcode.ts:928-936。计划 §2.3 中「有」档明确写为「<目录，家目录归一 ~> 仍在」，而「无」档仅写为「<目录> 仍在」。若实现时两档分别拼装而无档未调用 tildeHome(tmp)，会导致无凭据残留时临时路径中的真实家目录绝对路径被直接暴露。

**建议**：在 codex.ts 的 codexTempDirResidueText 中建议采用与 zcode.ts 一致的统一前缀拼法，使公共前缀中统一包含 ${tildeHome(runDir)}，确保两档路径均安全归一。

### AGY-02 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/codex探活删除收尾/plan/2026-10-03-codex探活删除收尾-claude.md:120` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：步骤助手在附加 codexPrepStep 时缺少对异常对象的非对象类型防御守卫

**依据**：查阅 .reviews/codex探活删除收尾/plan/2026-10-03-codex探活删除收尾-claude.md:120 与 src/trivium/adapters/codex-home.ts:274-335。在 JavaScript/TypeScript 运行时中 catch (e) 捕获到的异常在理论上可能为非对象原始类型（如 string），若直接在 e 上设置属性会引发 TypeError 并掩盖底层真正错误。

**建议**：在步骤助手给错误对象赋值前增加对象类型守卫判断（如 if (e && typeof e === 'object' && !('codexPrepStep' in e))），增强防御性。

### AGY-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `.reviews/codex探活删除收尾/plan/2026-10-03-codex探活删除收尾-claude.md:193` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：计划核出的 codex fingerprint() 无兜底隐患需明确在 BACKLOG 中登记跟踪

**依据**：查阅 .reviews/codex探活删除收尾/plan/2026-10-03-codex探活删除收尾-claude.md:193、src/trivium/adapters/codex.ts:307-330 以及 src/trivium/adapters/zcode.ts:1159-1163。zcode 侧已在 EV-136 将 fingerprint() 的读盘失败 catch 并返回 null；codex 侧目前在 exists 之后调用 sha256File 与 readFile 仍为裸调，存在权限等异常穿透预检的相同隐患。

**建议**：在 §4 文档更新项或结案总结中明确，将该缺口记入 BACKLOG.md 的 EV-200 结案残余或作为新任务待办登记。

## 认为正确的部分

- 将临时目录删除及失败后现场凭据检查逻辑通用抽象为 removeTempDir 提取到 util/fsx.ts，解耦了特定载体业务，并使 zcode.ts 成为薄包装，完全保持现有行为与契约不变。
- 在 prepareCodexHome 中利用原错误对象附加 codexPrepStep 的步骤标注方案，既精确指出失败步骤（裁剪、重写、拷入凭据等），又保证了 run() 兜底文案和错误类型逐字节不变。
- 单测设计全面且践行零配额原则，构造了假入口并覆盖了正常、失败、只读锁、凭据部分残留、目录 EISDIR 等丰富场景，变异分析（M1~M14）咬合精准。

## 未覆盖范围（本侧盲区）

- 作为静态二次审查员，本次审查未实际执行 node 测试脚本拉起真实的子进程或创建文件系统受限目录，未实测不同 macOS 文件系统权限位下的删除行为，结论全部基于代码逻辑推演与静态交叉核验。
- 未测试真实环境中含有非法 UTF-8 或特殊符号路径时 tildeHome 的边界情况。

## 实际查阅的项目文件

- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `.reviews/codex探活删除收尾/plan/2026-10-03-codex探活删除收尾-claude.md`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/util/fsx.ts`
- `src/trivium/adapters/codex-home.ts`
- `src/trivium/adapters/codex-trace.ts`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/08_project/BACKLOG.md`
- `test/unit/zcode-auth-probe.test.ts`
- `test/unit/zcode-doctor-probe-home.test.ts`
- `test/unit/codex-adapter.test.ts`

> 编排器从工具轨迹中记录到的读取次数：{"read":32,"grep":10,"glob":0,"run_command":0,"project_reads":17}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
