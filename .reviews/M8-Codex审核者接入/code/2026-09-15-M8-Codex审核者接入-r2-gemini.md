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
run_id: 20260915T024740Z
rerun_index: 2
snapshot_hash: sha256:29054bd31102e4da61ba2621f1b5d8bc6592ef170ec1991c68997a5c3f54d3c5
blind: true
started_at: 2026-09-15T02:47:41.361Z
finished_at: 2026-09-15T03:05:41.529Z
duration_s: 170
tool_calls:
  read: 23
  grep: 7
  glob: 1
  run_command: 0
  project_reads: 12
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 2
  minor: 2
  nit: 1
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
heterogeneous: true
session_id: 30b9c72b-a7b6-4c4f-b503-9d4508b3c61e
---

# 代码审查：M8-Codex审核者接入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260915T024740Z` ｜ 第 2 轮
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

1. F-6 判据中「相对 token 归一后跑出项目树就判命中」存在严重推导漏洞，且注释与实现彻底相反，会导致兄弟目录外部同名文件与父目录配置被严重误伤。
2. UNRESOLVABLE 粗暴将 ~ 归入不可解析直接判真，不仅完全丢弃了确定性静态展开能力，而且击穿了 Driver 宣称保住的「~/.trivium 不误伤项目内 .trivium」防线。
3. 三向对账测试对设计文档仅断言了 F 清单，遗漏了设计文档 B 清单（盲区）的对账，存在测试缺口。
4. bashStillDenied 边界字符集遗漏等号 =，标准 --disallowed-tools=Bash 传参会触发异常抛错。
5. F/B 闭集因维度混杂膨胀至 12 行，建议收敛正交维度并限定对账扫描区间。
结论：request-changes。

**结论**：`request-changes`

## 审查意见（共 5 条：重要 2 ｜ 次要 2 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:524-533` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：F-6 判据中「相对 token 归一后跑出项目树就判命中」的兜底逻辑推导不成立且注释与实现完全相反，会导致兄弟目录与父目录的合法相对路径被严重误判为泄漏。

**依据**：查阅 src/trivium/adapters/base.ts 第 524-533 行：当相对 token 解析为 asIfFromRoot 时，代码执行 return !asIfFromRoot.startsWith(`${root}/`) || asIfFromRoot === root ? true : false；注释宣称「只要归一后仍在项目树内... 就算命中」，但代码实现却是「跑出项目树才判命中」，注释与实现彻底颠倒。更严重的是：若审查员执行 cat ../other-project/.reviews/t/code/x-gemini.md，或在项目根访问上级配置 cat ../.env，归一后跑出项目树，代码直接返回 true 判作泄漏；而在 test/unit/peer-leak-command.test.ts 第 1184 行，绝对路径写法 cat /Users/other/repo/.reviews/... 却被明确断言为误报排除（返回 false）。两者语义严重不对称。从子目录访问项目根的合法写法应严格限定为 (../)+${rel} 结构，不应将跑出项目树的所有外部相对路径一律判真。

**建议**：纠正代码注释中的颠倒表述；将相对路径兜底收窄为仅当 token 呈现为 (../)+${rel}（即纯回退层级紧邻项目相对 deny 拼写）时才判为命中。若 token 包含其他兄弟目录段（如 ../other/...）且归一后不在项目根且不等于 deny 条目，应判为 false。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:414, 513` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：UNRESOLVABLE 粗暴将波浪号 ~ 归入不可静态解析范围直接判真，直接推翻了 Driver 在应答中明确承诺保住的「~/.trivium 不误伤项目内 .trivium」误报防线。

**依据**：查阅 src/trivium/adapters/base.ts 第 414 行 const UNRESOLVABLE = /[$~`*?]/ 与第 513 行 if (UNRESOLVABLE.test(token)) return true；查阅 .reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-response-claude.md 第 97-99 行，Driver 明确记录保住两条误报防线，其中一条正是「~/.trivium/… 命中项目内 .trivium 条目——归一后是 HOME 下的路径，不等于项目内条目」；然而在当前实现下，只要 token 包含 ~（如 cat ~/.trivium/config.yaml），UNRESOLVABLE 直接拦截返回 true，根本无法进入后方的路径归一判定；查阅 test/unit/peer-leak-command.test.ts 第 1172-1191 行，Driver 实际并未添加该误报场景的负断言测试（若添加该用例必红）。os.homedir() 是静态已知事实，在 spellingsOf 中已用于展开 ~，此处没有理由视其为不可解析。

**建议**：将 ~ 移出 UNRESOLVABLE 正则；若相对或非绝对 token 以 ~/ 开头，先通过 os.homedir() 展开为绝对路径，再统一经由 resolvesIntoDeny 进行精确判定，避免将用户家目录下的常规配置误判为项目内 deny 命中。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/known-forms-parity.test.ts:86-99` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：宣称的「设计 ↔ 实现 ↔ 测试」三向对账存在测试缺口，仅对账了设计文档中的 F 清单，遗漏了设计文档 B 清单（盲区）的对账。

**依据**：查阅 test/unit/known-forms-parity.test.ts：第 61 行断言了 base.ts 的 F 表 ↔ 用例名；第 73 行断言了 base.ts 的 B 表 ↔ 用例名；第 86-99 行仅断言了 idsInTable(designSrc, 'F') 与 idsInTable(baseSrc, 'F') 相等；全文件完全未包含对 idsInTable(designSrc, 'B') 与 idsInTable(baseSrc, 'B') 的比对断言。导致主设计文档 §10.1 措施 b 的盲区表（B-1～B-4）与代码实现及用例处于未校验脱节状态。

**建议**：在 known-forms-parity.test.ts 中补齐 test('设计 §10.1 的 B 清单与 base.ts 一致') 断言，确保设计文档盲区表与代码及测试真正形成闭环对账。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/zcode.ts:96-98` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：bashStillDenied 正则边界字符集遗漏等号 =，当探针或配置提供 --flag=value 形式的禁用参数时会导致误报异常抛错。

**依据**：查阅 src/trivium/adapters/zcode.ts 第 96-98 行：export function bashStillDenied(readonlyFlags: readonly string[]): boolean { return readonlyFlags.some((f) => /(^|[\s,"'])Bash([\s,"']|$)/.test(f)); }；其前置字符白名单为 ^、\s、,、"、'，未包含 =；当 CLI 参数以标准长参数等号形式传递（例如 --disallowed-tools=Bash 或 --disallowed-tools=Write,Bash）时，Bash 紧邻前置字符为 =，导致正则匹配返回 false；进而触发 zcode.ts:360-367 抛出 throw new Error('zcode 的只读组合里不再禁用 Bash...')，导致正常的审查流程异常中断。

**建议**：将正则调整为兼容等号，如 /(^|[\s,"'=])Bash([\s,"']|$)/，并在 test/unit/zcode-bash-denied.test.ts 中增补 --disallowed-tools=Bash 与 --disallowed-tools=Write,Bash 的测试用例。

### AGY-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md:1610-1635` |
| 类别 | maintainability ｜ 层次 plan |
| 置信度 | high |

**问题**：闭集形态分类维度混杂，导致规则从 5 项膨胀至 12 项后维护成本剧增且正则对账脆弱。

**依据**：查阅设计文档 §10.1 措施 b 的 F/B 清单与 test/unit/known-forms-parity.test.ts：F-1～F-8 混杂了路径形态（绝对/相对/HOME）、语法包裹（引号/大括号/前缀）、目标命令语法（git 对象引用）等多个正交维度；当 shell 语法自由组合时，单纯按形态列举会导致编号无限扩张（如重定向、管道、数组展开等）；且 known-forms-parity.test.ts 使用全局正则 idsInTable 与 idsInCaseNames 扫描全文件，极易受长文档后续章节其他表格或用例命名干扰。

**建议**：在架构文档中明确闭集的设计边界：将形态按正交维度归组（路径派生层、shell 边界与包裹层、git 对象层），停止无节制增加 F-n 扁平编号；对账测试应限制在相关章节的文本区间内，避免整篇长文档全局扫描。

## 认为正确的部分

- 将 guard.peer_leak_via_command 重构为逐审核者 Map 结构，彻底解决了上轮失败/超时侧 command_texts 未扫描却塌缩为全局 hit: false 的语义歧义，完美对齐 run.v2 原则。
- 及时清除了意外混入补丁的 .mutbak 文件，并在 .gitignore 与变异测试脚本（改仓外落盘）建立了多层防御体系。
- 在 fault-injection.test.ts 中为 peer_leak_via_command 补充了端到端故障注入测试，切实守住了 judgeSide 的核心接线。
- 创建 known-forms-parity 测试，用 grep/正则对账替代了此前宣称存在却毫无保护效力的本地字面量断言。

## 未覆盖范围（本侧盲区）

- 未在实际运行环境中执行带有高阶嵌套子 shell 与复合别名的极端对抗性命令文本。
- 未验证未来 Codex CLI 真实录制样本中动态生成的复杂 shell 包装对 command_texts 的影响（待 M8 第 3 步真实接入覆盖）。
- 未在实际 Windows 运行时测试（本项目设计限定 macOS，未对 Windows 分隔符做真实环境回归）。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `.gitignore`
- `skills/dual-critic/schema/run.v2.json`
- `src/trivium/types.ts`
- `src/trivium/guard.ts`
- `src/trivium/review.ts`
- `src/trivium/runner.ts`
- `src/trivium/freeze.ts`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/adapters/stub.ts`
- `src/trivium/adapters/agy-events.ts`
- `src/trivium/adapters/agy.ts`
- `test/unit/peer-leak-command.test.ts`
- `test/unit/known-forms-parity.test.ts`
- `test/unit/zcode-bash-denied.test.ts`
- `test/integration/fault-injection.test.ts`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/08_project/BACKLOG.md`
- `.reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-response-claude.md`
- `.reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-gemini.md`
- `.reviews/M8-Codex审核者接入/code/_meta/changes-20260915T024740Z.diff`

> 编排器从工具轨迹中记录到的读取次数：{"read":23,"grep":7,"glob":1,"run_command":0,"project_reads":12}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
