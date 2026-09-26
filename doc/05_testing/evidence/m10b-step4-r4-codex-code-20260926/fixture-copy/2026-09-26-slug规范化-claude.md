---
schema: trivium.review.v1
topic: slug规范化
stage: code
role: claude
vendor: anthropic
agent_cli: claude/2.1.281
model_requested: claude-sonnet-5
model_effective: claude-sonnet-5
model_effective_source: envelope
run_id: 20260926T003724Z
rerun_index: 1
snapshot_hash: sha256:1262b9c32d15f5e0f3731770e22c6bb6ce5e33f7aaaf7b0e5ddb279b38f322d8
blind: true
started_at: 2026-09-26T00:37:24.441Z
finished_at: 2026-09-26T00:40:53.804Z
duration_s: 209
tool_calls:
  read: 4
  grep: 1
  glob: 5
  run_command: 0
  project_reads: 6
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 4
  nit: 0
degraded: false
parse_fallback: false
peer_deny: true
drift: false
heterogeneous: true
session_id: fd9fe973-9254-4fa8-b4fe-188d18898943
---

# 代码审查：slug规范化

> Critic-D · Anthropic Claude Code ｜ 模型 `claude-sonnet-5`
> ｜ 运行 `20260926T003724Z`
> ｜ 本轮审核者 claude、gemini

## 总判断

核心逻辑（连续分隔符折叠、首尾横线剔除、maxLength 按词边界回退截断）经手工逐行推演未发现错误；主要问题是非有限 maxLength（NaN/Infinity/-Infinity）与负数 maxLength 处理策略不一致，以及 ASCII-only 加词边界回退会让两类完全不同的合法标题都退化成空字符串，但函数自身文档未提示这一后果。仓库无任何调用方与测试，无法验证下游是否能接住空 slug。

**结论**：`approve-with-nits`

## 审查意见（共 4 条：次要 4）

### CLAUDE-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/slug.ts:18-19` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：Number.isFinite(maxLength) 为 false 时（NaN、Infinity、-Infinity）一律退化为不限制长度；但有限的负数会先被钳成 0 从而截断出空字符串。同样异常的输入在有限与非有限两条路径上得到完全相反的结果。

**依据**：src/slug.ts 第18行 const limit = Number.isFinite(maxLength) ? Math.max(0, Math.floor(maxLength)) : slug.length; 手工代入 maxLength=-5 得 limit=0 最终返回空串，代入 maxLength=NaN 或 -Infinity 得 limit=slug.length 在第19行直接返回未截断的 slug。

**建议**：为异常 maxLength 选定单一策略，不要让有限负数和非有限值走向相反的结果。

### CLAUDE-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/slug.ts:6-8 与 :24-26` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：JSDoc 只承诺按单词边界截断、不截在单词中间、不以横线结尾，但未说明当 cut 内找不到任何横线边界时（例如整个 slug 是超过 maxLength 的单个词）函数会直接返回空字符串，文档与实现存在落差。

**依据**：src/slug.ts 第25-26行 const boundary = cut.lastIndexOf('-'); return boundary === -1 ? '' : cut.slice(0, boundary); 对比第6-8行 JSDoc 未提及此分支的空串结果。

**建议**：在 JSDoc 中补充说明找不到可用词边界时返回空字符串，让调用方知道需要处理空值。

### CLAUDE-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/slug.ts 第12行与第24-26行的组合效果` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：只保留 ASCII（非英文标题可能整体退化为空串）与找不到词边界时留空这两条逻辑组合后，会让纯非英文标题、以及超过 maxLength 的单一 ASCII 长词这两类完全不同的合法标题都收敛到同一个空字符串结果，仓库里没有调用方处理这种碰撞。

**依据**：用 Grep 在 src 下搜索 slugify 只命中定义文件本身，未发现调用方；结合对正则与回退截断逻辑的推演：纯中文标题全部替换为分隔符、trim 后为空，单一超长英文词的 lastIndexOf 为 -1 也返回空。

**建议**：在文档中标注 slugify 可能返回空字符串，调用方需要有兜底策略，例如退回到基于 ID 的 slug。

### CLAUDE-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/slug.ts 整个文件，无对应测试文件` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：本次改动引入了折叠、trim、maxLength 回退截断三条边界逻辑分支，但仓库里没有任何单元测试文件，也没有 package.json 或测试脚本，边界情况完全靠人工读码验证，缺少回归保护。

**依据**：用 Glob 搜索项目根目录下 **/*.test.ts 与 package.json 均无匹配结果，确认仓库当前没有测试基础设施。

**建议**：至少为折叠、trim、截断三类边界（含空标题、纯非 ASCII 标题、单一超长词、maxLength 为 0 或负数）补充用例。

## 认为正确的部分

- 连续分隔符折叠正确：用加号量词把连续非字母数字字符合并成单个横线，符合 fixture README 要求
- 首尾横线剔除正确：trim 在折叠之后执行，符合预期
- maxLength 截断在我逐一推演的多组边界值下都能做到不切词、不以横线收尾，符合注释承诺
- toLowerCase 放在 ASCII 过滤之后执行，此时字符串只剩 ASCII 字母数字和横线，不存在非 ASCII 大小写折叠的地域性问题
- 保留了向后兼容的调用方式 slugify(title)，与 README 调用方式保持不变的要求一致

## 未覆盖范围（本侧盲区）

- 仓库内没有 slugify 的任何调用方，无法验证空字符串或碰撞结果在真实下游会造成什么具体后果
- 仓库没有 package.json 或测试脚本，未能实际执行代码验证手工推演的边界结果，全部结论基于静态读码与正则语义推理
- 未质疑 ASCII-only 这一需求本身，该权衡在 fixture README 中是明确指定的既定需求，本次只评估其后果是否被文档化
- 按规则未读取 .reviews 归档下其他审查员的材料，也未读取 .trivium 运行目录，因此无法交叉核对是否与另一侧结论重复

## 实际查阅的项目文件

- `src/slug.ts`
- `CLAUDE.md`
- `AGENTS.md`
- `README.md`

> 编排器从工具轨迹中记录到的读取次数：{"read":4,"grep":1,"glob":5,"run_command":0,"project_reads":6}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
