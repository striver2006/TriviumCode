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
run_id: 20260915T062455Z
rerun_index: 5
snapshot_hash: sha256:9a1dd7a440517b0c95e2c86fbb22fd841c0f1b195afa1c1883a26d11832bd057
blind: true
started_at: 2026-09-15T06:24:56.627Z
finished_at: 2026-09-15T06:45:39.736Z
duration_s: 271
tool_calls:
  read: 35
  grep: 9
  glob: 0
  run_command: 0
  project_reads: 19
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 1
  minor: 2
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: ae7597a3-187c-4d5c-8322-d050a072398e
---

# 代码审查：M8-Codex审核者接入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260915T062455Z` ｜ 第 5 轮
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最严重的问题是 AGY-01：base.ts 文档块内依然残留 B-6「不真收/另一套穷举面」与「三条盲区」的旧口径，同一文件内与 218 行/239 行改真收 F-9 自相矛盾。
对四个焦点逐一答复：一、替换外壳闭合侧字符判断足够且进程替换无论内嵌还是作为前缀均不漏检；
二、删引号二次扫描属单向保守增量，未冲垮兄弟目录、外部同名与展开态波浪号等既有误报防线；
三、区间对账收窄为「起点为 1」放过了右侧省前缀的简写（如 F-1～9）与非波浪号连接符，且抓不住散文枚举残留；
四、收口依然未齐：除 AGY-01 外，known-forms 集合用例漏收录 F-9（AGY-02），且「§10.2 措施 b」全仓仍残留 8 处（AGY-03）。

**结论**：`request-changes`

## 审查意见（共 4 条：重要 1 ｜ 次要 2 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:231` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：base.ts 注释文档块依然残留 B-6 旧口径（宣称「两者都不真收... 另一套穷举面」并列入「三条盲区」），与同文件 218 行撤销 B-6 及 239 行改真收 F-9 在同一个文档块内自相矛盾。

**依据**：查阅 src/trivium/adapters/base.ts:218-239。第 218-223 行明确记载 B-6 已撤销并转入真收 F-9；但在第 231-234 行依然写着「B-5 / B-6 是 r2 的收窄动作带出来的... 两者都不真收... B-6 要剥引号再回扫，而剥引号本身要处理嵌套与转义，是另一套穷举面」，第 236 行继续写「三条盲区是非蓄意也会撞上的：B-2、B-5、B-6」。而在设计文档 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:1648 中，对应段落已同步更新为「非蓄意也会撞上的有两条：B-2 与 B-5（B-6 已于 r4 改为真收，见 F-9）」。base.ts 未同步清理该段文字，导致同一文件内对 B-6 的处置自相矛盾。

**建议**：清理 src/trivium/adapters/base.ts:231-237 的过期散文，将其与设计文档 1648 行对齐，删除「两者都不真收」及「三条盲区包含 B-6」的陈旧论述，明确盲区为 B-2 与 B-5 两条。

### AGY-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/peer-leak-command.test.ts:208` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：known-forms 集合用例中，forms 字典覆盖了 F-1 到 F-8（F-7 独立）却遗漏了新形态 F-9，未将引号切分纳入集合级断言。

**依据**：查阅 test/unit/peer-leak-command.test.ts:200-222 中的 test('known-forms：清单里的每一类都有用例，且每一类都真的能命中')。用例头部注释明确声明「这条测的是集合：任何一类被实现漏掉，这里会红在具体那一行上」。但 forms 对象中仅包含 F-1、F-2、F-3、F-4、F-5、F-6、F-8（注释解释了 F-7 用的是另一套 deny 条目），唯独缺失了 r4 新增的 F-9（删掉引号再扫一遍）。虽然第 369 行有单条独立用例，但集合用例 forms 未同步增补 F-9，存在断言盲区。

**建议**：在 test/unit/peer-leak-command.test.ts:208 的 forms 对象中补入 F-9 的测试样本（如 'F-9 引号切分': 'cat \".reviews\"/t/code/2026-01-01-t-gemini.md'），保持集合用例与已知形态清单的一致性。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:955` |
| 类别 | contract ｜ 层次 plan |
| 置信度 | high |

**问题**：承诺统一改为「§10.1 措施 b」的引用在设计文档、设计 README 与 BACKLOG 中仍残留至少 8 处 10.2 旧编号，章节对账仍未收齐。

**依据**：核查 r4 应答件 .reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-r4-response-claude.md 中 §2.5 与清单 #8「全仓 12 处: 「§10.2 措施 b」→「§10.1 措施 b」」。全局检索发现仍有多处残留：doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md 中第 16、955、970、2295、2640、2727 行共 6 处仍写「10.2 措施 b」或「10.2」；doc/02_design/README.md:25 仍写「10.2」；doc/08_project/BACKLOG.md:98 仍写「设计 10.2 与 3.6」。措施 b 物理位于 §10.1，这些残留使得跨文档跳转和章节索引依然存在漂移。

**建议**：全仓全局检索并替换残留的「10.2 措施 b」及相关指向措施 b 的 10.2 为 10.1。

### AGY-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/known-forms-parity.test.ts:138` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：区间字面量上界对账正则未能覆盖省略右侧前缀的简写形态（如 F-1～9、B-1～5）及中文连接符（至、到、-），且非区间散文提及仍为机器盲区。

**依据**：查阅 test/unit/known-forms-parity.test.ts:138-141 的 rangeUpperBounds 函数：正则为 RegExp(String.raw`${kind}-1\\s*[～~]\\s*${kind}-(\\d+)`, 'g')。若作者书写时采用常见简写（如 F-1～9、B-1～5）或连接符为「至/到/-」（如 B-1 至 B-5），正则将直接无法匹配；同时，散文中如「三条盲区」、「B-5 / B-6」等散落叙述无法被区间对账覆盖（这正是 base.ts:231-236 漏收口未被该测试红出来的原因）。

**建议**：放宽 rangeUpperBounds 正则以支持可选前缀（如 (?:${kind}-)?(\\d+)）及中文连接符；在探索 EV-14 机器对账时考虑对非区间形态的清单提及增加关键字敏感词对账。

## 认为正确的部分

- 替换外壳判定（shell === ')' || shell === '}' || shell === '`'）与 UNRESOLVABLE 配合严密，有效收口了替换标记外壳切断 token 导致的漏报。
- stripQuotes 删引号二次扫描保持反引号不动，正负例断言覆盖清晰，有效收口了 F-9 引号切分形态且未冲垮既有误报防线。
- fault-injection.test.ts 新增的 peer_leak_via_command 故障注入测试，确保了命令通道独立命中作废的端到端真实接线（防止接线处假绿）。
- zcode-bash-denied.test.ts 独立建档并覆盖等号边界与兄弟工具名防蒙混，将关键前提从纯注释升级为有单测保障的运行期断言。

## 未覆盖范围（本侧盲区）

- 未在真实联网与厂商凭据环境下实跑 Antigravity / ZCode 真实 CLI 会话（当前处于 M8 第 1 步，外部 CLI 适配与探活属于后续步骤）。
- 未穷举覆盖包含深度嵌套子 shell 进程替换（如 cmd <(cmd2 <(cat ...))）在跨操作系统 shell 下的所有边缘行为。

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
- `src/trivium/adapters/agy-events.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/guard.ts`
- `src/trivium/review.ts`
- `src/trivium/types.ts`
- `test/unit/peer-leak-command.test.ts`
- `test/unit/known-forms-parity.test.ts`
- `test/unit/zcode-bash-denied.test.ts`
- `test/integration/fault-injection.test.ts`
- `.reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-r4-response-claude.md`
- `.reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-r4-gemini.md`
- `.reviews/M8-Codex审核者接入/code/_meta/changes-20260915T062455Z.diff`

> 编排器从工具轨迹中记录到的读取次数：{"read":35,"grep":9,"glob":0,"run_command":0,"project_reads":19}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
