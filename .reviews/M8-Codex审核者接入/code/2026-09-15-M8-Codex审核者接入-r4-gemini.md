---
schema: trivium.review.v1
topic: M8-Codex审核者接入
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.3
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: high
run_id: 20260915T053643Z
rerun_index: 4
snapshot_hash: sha256:523c297b9dd300afd3f379b894753c4b57da5c82aec187d1d2ba7c491da45863
blind: true
started_at: 2026-09-15T05:36:44.425Z
finished_at: 2026-09-15T05:55:22.451Z
duration_s: 284
tool_calls:
  read: 43
  grep: 14
  glob: 0
  run_command: 0
  project_reads: 25
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 1
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: e5d1a6ff-1567-4186-a516-3689fce6911c
---

# 代码审查：M8-Codex审核者接入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260915T053643Z` ｜ 第 4 轮
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最危险的问题是 AGY-01：tildeUserHit 正则未排除分号/管道等控制符且未处理右花括号 '}'，同时制造了复合命令误报与花括号展开漏检两条通路。
针对审查焦点明确答复：一、tildeUserHit 正则边界存在缺陷，会吞掉命令连接符造成误报，也会吞掉 '}' 造成漏检；二、它与 spellings.some 的 OR 关系直接放行上述误判命令，绕过了 hitsAt 的边界校验；三、B-5/B-6 登记为已知盲区而非强行修复在 Codex 侧完全站得住，符合防非对抗穿透的威胁模型，避免了动态推测 cwd 带来的脆弱性；四、收口依然未齐（AGY-02），run.v2 schema、BACKLOG 与设计文档等 8 处仍残留 B-1～B-4 与「四条」旧口径。

**结论**：`request-changes`

## 审查意见（共 3 条：重要 1 ｜ 次要 1 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:512` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：tildeUserHit 正则边界存在三处缺陷：用户名字符集未排除分号/管道等控制字符（导致复合命令误报）；后缀字符集未排除右花括号 '}' 等 CMD_BOUNDARY（导致花括号展开漏检）；波浪号前缺少前置边界锚定（非起始波浪号被误识别）。

**依据**：查阅 src/trivium/adapters/base.ts:511-518，tildeUserHit 正则为 /~[^/\s"'`]+(\/[^\s"'`;|&()<>,]*)/g。实测：1. 针对复合命令 echo ~;ls /.trivium/runs，用户名段匹配到 ;ls，随后 /.trivium/runs 匹配 suffix 并拼接成 homeAbs 路径，触发误报；同族还有 ~&&cat /.trivium/runs 等。2. 针对花括号展开 diff {other,~user/.trivium/runs}，右边界因缺少 '}' 导致 suffix 贪婪匹配为 /.trivium/runs}，asIfHome 归一后无法与 denyAbs 匹配，导致漏报。3. 正则开头缺少前置词边界或 CMD_BOUNDARY 锚定，类似 pkg@1.0~alpha/.trivium/runs 也会被误当波浪号家目录展开。

**建议**：1. 用户名部分收窄为 Unix 登录名合法字符集（如 [a-zA-Z0-9_.-]+）或明确排除 CMD_BOUNDARY 包含的所有字符；2. 正则前置增加起始或前置边界判断（如 (^|[\s"'`=:(<;,]) 或 CMD_BOUNDARY）；3. 后缀排除字符集中补齐 '}'、'{'、'@'、'='、':' 等 CMD_BOUNDARY 成员；并在 peer-leak-command.test.ts 增补对应断言。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `skills/dual-critic/schema/run.v2.json:83` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：B-5 与 B-6 补入表格后，run.v2 schema 描述、BACKLOG EV-01、设计文档散文段落、R25 风险登记表、§21 与 §24.1 演进台账共 8 处依然残留「B-1～B-4」与「四条/四类」旧口径，收口不全。

**依据**：查阅相关文件：1. skills/dual-critic/schema/run.v2.json:83 仍写「已知形态清单（F-1～F-8）与盲区（B-1～B-4）」；2. doc/08_project/BACKLOG.md:98 仍写「含 F-1～F-5 已知形态闭集与 B-1～B-4 盲区」；3. doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md 中第 144 行「B-2 是四条里唯一」、第 163 行「四条盲区各有一条」、第 2228 行「（盲区 B-1～B-4）」、第 2535 行 R25「四类不可检...B-1～B-4...B-1/B-3/B-4」、第 2620 行 §21「B-1～B-4」、第 2707 行 §24.1「盲区 B-1～B-4」均未随 B-5/B-6 补齐；4. test/unit/known-forms-parity.test.ts:72,78 下限断言仍写 >= 4。已知 forms 对账仅核验了表格行本身，导致所有散文描述再次同形遗漏（EV-14 复现）。

**建议**：全局同步所有涉及盲区范围与计数的文字，将 B-1～B-4 及「四条/四类」更新为 B-1～B-6 及「六条/六类」，known-forms-parity 测试中的 B 表下限提升为 >= 6。

### AGY-03 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:1668` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | medium |

**问题**：设计文档 §10.2 末尾「git 通道保留能力」段落仍保留「readonly_commands 即 paranoid 旋钮」论述，与前方 1649 行及 §18.1 #21 已拍板结论脱节。

**依据**：查阅 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md 第 1668 行，依然写着「既有配置 readonly_commands 即 paranoid 旋钮——把 git show / git log 从白名单裁掉即收窄该通道... 不新增机制」。而同文件第 1649 行注记与第 224 行 §18.1 #21 已明确指出 readonly_commands 没有任何消费方（BACKLOG EV-15）且已拍板不收窄（EV-16）。此处仍把不存在的机制表述为既有旋钮。

**建议**：同步修订第 1668 行措辞，删除将 readonly_commands 描述为既有旋钮的表述，说明该通道保留是基于 bug 阶段镜头权衡的拍板结果（EV-16）。

## 认为正确的部分

- F-6 入口去掉 `.` 分支仅保留 `/`（收窄误报），彻底解决了 `..env` 等点串文件名误命中问题；对照单测齐备。
- `bashStillDenied` 边界集补充等号 `=`（兼容 `--disallowed-tools=Bash`）并独立拆出 `zcode-bash-denied.test.ts`，运行期断言与单测闭环严密。
- `known-forms-parity.test.ts` 将 F 表与 B 表通过 `measureBSection` 限定在措施 b 章节内对账，杜绝长文档全文扫描的意外干扰。
- `peer_leak_via_command` 逐审核者 map 记录在 `review.ts` 与 `run.v2.json` 间类型与三态契约保持高度自洽。

## 未覆盖范围（本侧盲区）

- 未在带真实厂商鉴权的 Codex/Claude CLI 环境下执行真机命令调用（本项目处于 M8 第 1 步，Codex 适配器与真机验收排在第 2/3 步）。
- 未对复杂子 shell 进程替换（如 <(echo ~user/...)）进行穷举拦截测试，按威胁模型定调该类对抗形态归入 B-4 盲区。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/03_api/PROTOCOL_dual_critic_relay.md`
- `doc/08_project/BACKLOG.md`
- `skills/dual-critic/schema/run.v2.json`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/adapters/agy-events.ts`
- `src/trivium/adapters/agy.ts`
- `src/trivium/guard.ts`
- `src/trivium/types.ts`
- `src/trivium/review.ts`
- `src/trivium/runner.ts`
- `src/trivium/freeze.ts`
- `test/unit/peer-leak-command.test.ts`
- `test/unit/known-forms-parity.test.ts`
- `test/unit/zcode-bash-denied.test.ts`
- `test/integration/fault-injection.test.ts`
- `test/integration/stub-agent-kit.test.ts`
- `test/unit/render.test.ts`
- `test/unit/runner.test.ts`
- `test/unit/deny-matrix.test.ts`
- `test/fixtures/stub-agent-kit/pieces/stub-agent.ts.txt`
- `.reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-gemini.md`
- `.reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-r2-gemini.md`
- `.reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-r3-gemini.md`
- `.reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-response-claude.md`
- `.reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-r2-response-claude.md`
- `.reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-r3-response-claude.md`
- `.reviews/M8-Codex审核者接入/code/_meta/changes-20260915T053643Z.diff`

> 编排器从工具轨迹中记录到的读取次数：{"read":43,"grep":14,"glob":0,"run_command":0,"project_reads":25}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
