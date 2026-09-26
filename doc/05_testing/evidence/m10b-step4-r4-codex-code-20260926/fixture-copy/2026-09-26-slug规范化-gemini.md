---
schema: trivium.review.v1
topic: slug规范化
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.11
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260926T003724Z
rerun_index: 1
snapshot_hash: sha256:1262b9c32d15f5e0f3731770e22c6bb6ce5e33f7aaaf7b0e5ddb279b38f322d8
blind: true
started_at: 2026-09-26T00:37:24.441Z
finished_at: 2026-09-26T00:40:53.804Z
duration_s: 139
tool_calls:
  read: 9
  grep: 1
  glob: 6
  run_command: 0
  project_reads: 9
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 2
  minor: 0
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: 61c2f3c6-b191-45b0-a7f1-d760b1543ebe
---

# 代码审查：slug规范化

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260926T003724Z`
> ｜ 本轮审核者 claude、gemini

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最严重的问题在于：所有纯非 ASCII 标题（如纯中文）及首词长度超过 maxLength 的标题均会静默返回空字符串 ''，这极易引发数据库唯一键冲突或 404 无效路由。
连续分隔符折叠（/[^A-Za-z0-9]+/g）与首尾横线清除（/^-+|-+$/g）逻辑紧凑且有效，纯标点输入也能安全清空。
单词截断算法逻辑清晰，但「首词超长退回为空」属非预期边界，未在 JSDoc 契约中暴露。
只保留 ASCII 使得西欧重音字符被生硬截断（如 café 变 caf），建议引入 NFKD 归一化或在契约中说明局限。

**结论**：`request-changes`

## 审查意见（共 3 条：重要 2 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/slug.ts:11-14` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：强制过滤非 ASCII 字符导致纯非英文标题完全退化为空串，且西欧变音字母被截断破坏，引发路由与唯一性破坏。

**依据**：查阅 src/slug.ts:11-14，代码通过 title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') 移除非 ASCII 字符。对比 README.md:13 与变更补丁 .reviews/slug规范化/code/_meta/changes-20260926T003724Z.diff，上一版本使用 replace(/\s/g, '-') 保留了非 ASCII 字符。当前实现下，纯非英文字符串（如中文、日文、阿拉伯文）所有字符均被匹配为分隔符并清除，最终返回空字符串 ''；中英混合标题（如 'Vue3 核心原理解析'）的非英文语义全部丢失只剩 'vue3'；西欧拉丁字母（如 'café'、'über'）中的变音字符被视为分隔符，导致单词被截断拆分为 'caf'、'ber'。若下游业务依赖 slug 作为 URL 路径或数据库唯一键，会导致全量非英文标题冲突或路由失效。

**建议**：若需国际化支持，应改用 Unicode 属性转义（如 /[^\p{Letter}\p{Number}]+/gu）；若坚持仅保留 ASCII，应在前置处理中引入 NFKD 规范化分解变音符号（如 é 转 e），并在 JSDoc 契约中明确提示非 ASCII 标题将产出空串，要求调用方提供降级方案。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/slug.ts:21-27` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：当标题首词长度超过 maxLength 时，因无前置分隔符而静默返回空字符串，存在契约漏洞。

**依据**：查阅 src/slug.ts:21-27，在 maxLength 截断逻辑中：const cut = slug.slice(0, limit); 当 slug.charAt(limit) !== '-' 时执行 const boundary = cut.lastIndexOf('-'); return boundary === -1 ? '' : cut.slice(0, boundary);。当输入的首个单词长度即超过 maxLength 时（如 slugify('Internationalization', 10) 或 slugify('Architecture overview', 8)），cut 内不存在任何横线，boundary 为 -1，函数直接返回 ''。虽然实现中含有「宁可留空也不切词」注释，但 JSDoc 与 README.md:11 仅约定「超长时按单词边界截断，不会截在单词中间，也不以横线结尾」，未声明首词超长会导致非空标题直接返回空字符串，调用方极易遭遇意外的空 slug。

**建议**：在 JSDoc 契约中明确注明首词超长时返回空串的边界行为，或在首词无分隔符时提供兜底策略（例如保底截断至 limit，或由调用方决定如何处理空 slug）。

### AGY-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/slug.ts:18` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：Number.isFinite 对 -Infinity 的校验失效，导致负无穷被错误当作无长度限制处理。

**依据**：查阅 src/slug.ts:18，代码为 const limit = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : slug.length;。对于普通负数（如 maxLength = -1），Number.isFinite(-1) 为 true，经 Math.max(0, ...) 收敛至 0 并返回空串；但若传入 -Infinity，Number.isFinite(-Infinity) 为 false，三元表达式直接回退为 slug.length，返回了未经截断的完整 slug。

**建议**：规范化参数校验，若传入非有限数，应对负无穷统一归零或使用更明确的数值范围收敛逻辑。

## 认为正确的部分

- 连续分隔符折叠实现高效：使用单一正则 replace(/[^A-Za-z0-9]+/g, '-') 统一将连续空白、特殊标点与横线折叠为单根横线，逻辑直观。
- 首尾横线清理可靠：使用 replace(/^-+|-+$/g, '') 能够完整剥离字符串首尾横线，且纯标点或纯空白输入能安全收敛为空串。
- 常规英文单词边界截断清晰：通过 slug.charAt(limit) === '-' 判定与 cut.lastIndexOf('-') 结合，在常规多词英文场景下能够确保不截断单词且末尾不保留横线。

## 未覆盖范围（本侧盲区）

- 未覆盖业务调用链对空 slug（''）的具体容错与降级行为（例如是否会自动回退到内容 ID 或时间戳）。
- 未覆盖多语言/国际化场景下的系统级 URL 规范文档要求。
- 受审查员只读环境限制，未实际执行测试套件。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `src/slug.ts`
- `NOTES.md`
- `GEMINI.md`
- `.gitignore`
- `.reviews/slug规范化/code/_meta/changes-20260926T003724Z.diff`

> 编排器从工具轨迹中记录到的读取次数：{"read":9,"grep":1,"glob":6,"run_command":0,"project_reads":9}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
