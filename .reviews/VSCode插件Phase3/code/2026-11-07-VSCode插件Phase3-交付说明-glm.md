---
schema: trivium.note.v1
topic: VSCode插件Phase3
stage: code
role: glm
kind: delivery-note
run_id: 20261107T033840Z
---

# VSCode插件Phase3 交付说明（Driver：glm）

## 交付概要

第四批开发（v2.1 计划 §6.3）：在 extension 0.2.0 之上交付 **FR-8 裁决台 / FR-9 人工审批 / FR-10 保存防护与三色灯 / FR-11 装配预设**，版本升至 **0.3.0**。Phase 4 与核心增强 E1/E2/E3 不在本批。新增 9 个模块、改 7 个（详见 r2 计划 §二）；单测 182 + 集成 82 + 真机 8 全绿，主仓 verify（typecheck/build/npm test）通过。

## 各 FR 实现要点

- **FR-8 裁决台**：`gate --check --json` 驱动，首写/修复两形态建表（fallback 期望集读 `.fallback-items.md`，仅 parse_fallback 侧）；三档理由必填、空洞词非阻断警示；行级落点要求（结构化必填/fallback 可选）；unknown 行删除语义；修复走**原文手术**（只改目标行、按原表列结构逐列替换、追加行按原列映射、表外正文与合法行原样保留）；front-matter 七字段经 yaml 序列化；addresses 派生自 `run-<runId>.json`.artifacts[]（空时可手工编辑，空值禁止落盘）；role 定位链以 run 元数据为第一权威源；**落盘只落已确认预览**（表单变更即失效）；落盘后自动 gate 复核，不过即回修复模式闭环。
- **FR-9 人工审批**：aa 态浮出闸门卡；计票原样消费 round_verdict（与历史树同源）；warnings 一等展示；提示性工作树摘要（相对 HEAD，过滤编排器目录，口径明示）+ 批准后编排器权威 worktree_summary；批准/拒绝（理由必填人工输入）/放弃（宿主 modal 确认）经宿主直发 CLI，带防双击；请求代次（latest-wins）防陈旧计票。
- **FR-10 保存防护**：**API 边界如实声明——VS Code 无取消保存 API（waitUntil 共享 1.5s 预算），本插件承诺「事前预警 + 事中警示 + 事后一键恢复」，不承诺阻止写盘**。三段式：编辑期 modal（去重）→ will-save 经 `e.waitUntil` 字节快照（Buffer + 原 mode，1.2s 限时，代次守卫）→ 保存后恢复按钮（写回前核对快照代次与磁盘基线，外部改动则取消并提示；revert 清 dirty，不用 applyEdit）。快照失败文案不承诺恢复。三色灯 🟢/🟡/🔴；state.json 不可读按锁闭保守处理；`.reviews/`、`.trivium/`、`.vscode/` 放行。`onStartupFinished` 激活即装配（无需打开任何视图）。
- **FR-11 预设**：装配参数（不含 topic/body）双作用域 globalState/workspaceState；另存/删除经宿主 InputBox/modal（webview 沙箱禁 prompt/confirm）；跨仓加载校验 ctxPaths 有效性。
- **协同增强**：缺口编号点击 → AnnotationHub 锚点行内定位；`PREFIX_TO_CRITIC` 为注册表 findingPrefix 的镜像副本（插件不 import 主仓 src——边界已在注释如实标注，新增 Agent 需人工同步）。

## 如实声明（残余风险与边界）

1. 保存防护不阻止写盘（API 无此能力）；外部编辑器、非 file scheme 不在覆盖面。
2. 恢复的 revert 会重载编辑器——通知等待期内**编辑器里未保存的后续编辑**会丢失（弹窗文案已声明）；终端/其它窗口改磁盘由基线核对拦截，检查与写回间仍有毫秒级窗口（如实标注，未宣称消除）。
3. 裁决件写回的 hash 比对是**冲突检测而非完全防覆盖**（比对与 rename 间存在窗口；彻底消除需协作锁，超出集成面承诺）。
4. real 对拍对 r2 计划的微调：原计划「临时主题目录落草稿跑真实 gate」实现为**临时 git 仓**（真实 gate 要求 git 仓库且 run.v3 交叉校验严格——以本仓真实运行元数据为模板改造），覆盖首写与无表头修复两形态 + cockpit 生产链路闭环。
5. 本轮 run 元数据与工件 sha256 登记的是测试期内容；插件不复制编排器校验，一切以 gate --check 兜底。

## 流水线记录

- 计划审 1 轮通过（24 条意见：接受 22 + 部分接受 2，r2 定稿）；闸门曾报「部分接受」非合法裁决值与编号连写不整词两处缺口，已修正后通过。
- 代码审 5 轮（r1 31 条 / r2 26 条 / r3 17 条 / r4 10 条 / r5 4 条，全部接受落地）。r2 起出现 webview 语法错误等由我引入的缺陷（31 条中两处阻断），逐轮收敛；r5 claude 侧环境失败（ANTHROPIC_API_KEY 覆盖认证 + unrecognized_model，与本批代码无关，前四轮同模型均正常），该轮为降级轮，裁决对幸存侧（gemini/codex）校验通过。
- 本机环境备注：ZCode 会话注入的 `ZCODE_BASE_URL` 会触发主仓既有测试 `zcode-full-copy-arm` 的环境敏感断言（与本批无关，剔除后 26/26 过）；verify 以 `env -u ZCODE_BASE_URL` 执行通过。
- 主仓 check 取证：全量 npm run check 首跑两失败均定性无关（上述环境项 + doctor-deadline I4 高负载计时 flaky，单独跑 13/13 过）；verify 的 npm test 全量绿。

## 人工验收清单（建议，不在本批自动验收内）

- [ ] 真实三审主题上：raf 态进入裁决台 → 预览 → 确认落盘 → gate 复核 → aa 态闸门卡 → 批准/拒绝/放弃，全程无终端命令、无手工编辑工件（v2 §6.3 验收主线）。
- [ ] 审查期（红灯）编辑并保存业务文件：见编辑期 modal、保存 toast、恢复按钮；点击恢复后磁盘与内容回到保存前，执行位保留。
- [ ] 三色灯随 running/raf/aa/终态流转；state.json 手工损坏 → 红灯「状态不可读」。
- [ ] 四家 Driver 的 role 定位实跑（含同槽位换 Driver 残留场景）。
- [ ] 预设另存（两作用域）/加载回填/删除在真实交互下的手感（宿主 InputBox/modal）。
