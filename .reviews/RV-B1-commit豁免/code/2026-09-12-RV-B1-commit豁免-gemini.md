---
schema: trivium.review.v1
topic: RV-B1-commit豁免
stage: code
role: gemini
vendor: antigravity
agent_cli: agy/1.2.2
model_requested: gemini-3.8-flash-high
model_effective: gemini-3.8-flash-high
model_effective_source: envelope
effort: medium
run_id: 20260912T130433Z
rerun_index: 1
snapshot_hash: sha256:638e76dce32511cc4ddca9b24332919013791979526e3bc70834e0fbdbdf69bf
blind: true
started_at: 2026-09-12T13:04:34.292Z
finished_at: 2026-09-12T13:38:37.991Z
duration_s: 111
tool_calls:
  read: 12
  grep: 0
  glob: 0
  run_command: 0
  project_reads: 10
evidence_ok: true
verdict: block
findings_count:
  blocker: 3
  major: 1
  minor: 1
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: true
heterogeneous: true
session_id: 8a39877c-ccfc-4ff7-9b55-b50c110ab7b4
---

# 代码审查：RV-B1-commit豁免

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260912T130433Z`

> ⚠️ **审查期间工作树发生漂移**：本结论对应送审时刻的快照，与当前工作树可能已不一致。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

【阻断】RV-B1 的三个前置条件可被换行符多行命令（\\n）和进程替换（<()）轻易绕过，且存在利用 Git 配置（-c core.editor=...）夹带执行写命令的第四条路径。
最危险的是分段正则遗漏换行符 \\n，导致 'git commit -m x\\nrm <独占文件>' 被判为单段 commit 豁免保护集扫描；同时 HAS_SUBSTITUTION 未防御 Bash 进程替换，'git commit -F <(rm ...)' 可在子进程执行写操作；更严重的是复用用于宽进拦截的 parseGitSegment 作为放行白名单，导致 'rm ... # git commit' 注释伪造及 '-c core.editor=...' 配置注入均被豁免。
当前实现严重削弱了编排器独占对象的安全护栏，必须阻断并重构白名单判定。

**结论**：`block`

## 审查意见（共 5 条：阻断 3 ｜ 重要 1 ｜ 次要 1）

### AGY-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:361` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：前置条件 1 无法拦截换行符分隔的多行命令：cmd.split 正则遗漏换行符 \\n 和 \\r，导致多行写命令被判为单段 commit 并豁免放行。

**依据**：读 src/trivium/hooks.ts:340-346,361：segments 仅由 /(?:&&|\\|\\|[;&|])/ 切割。在多行命令如 'git commit -m x\\nrm .reviews/t/plan/a-gemini.md' 中，整串不含 &&、||、;、&、|，因此 effective.length === 1 成立。而在 tokenize（hooks.ts:567 /\\s/.test(ch)）中，\\n 被视为空白符切分，产生 tokens ['git', 'commit', '-m', 'x', 'rm', '.reviews/...']。parseGitSegment 在 hooks.ts:516-522 依然识别 subcommand 为 commit。isExemptCommitCommand 返回 true，bashTargetsProtected 直接放行，换行后的 rm 命令随后被 Bash 真实执行。

**建议**：分段切割正则必须包含换行符 /(?:&&|\\|\\|[;&|\\r\\n])/，或在 isExemptCommitCommand 入口显式拒绝包含 [\\r\\n] 的多行命令，强制豁免 commit 必须为单行且有效段严格为 1。

### AGY-02 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:318` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：前置条件 2 可被 Bash 进程替换（Process Substitution）绕过：HAS_SUBSTITUTION 正则未覆盖 <(...) 与 >(...)。

**依据**：读 src/trivium/hooks.ts:318,343：HAS_SUBSTITUTION 定义为 /\\$\\(|`|\\$\\{/，仅检查了 $(、反引号与 ${。但在 Bash 中支持进程替换（Process Substitution）<(cmd) 与 >(cmd)。例如构造 'git commit -F <(rm -f .reviews/t/plan/a-gemini.md)'，命令不含 $(、反引号、${ 或 <<，单段判定为 1，parseGitSegment 判定为 commit。isExemptCommitCommand 放行后，Bash 在执行该命令时 fork 子进程执行 <(...) 内的 rm 命令，成功删除受保护文件。

**建议**：将 HAS_SUBSTITUTION 扩展覆盖进程替换形态（如 /(?:\\$|<|>)?\\(|`|\\$\\{/ 或显式检查 <( 与 >(），并对 -F 参数做严格白名单校验（仅限常规普通路径，禁止包含重定向与替换语法）。

### AGY-03 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:340` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：存在第四条夹带路径：利用 Git 配置注入（-c core.editor="..."）在 commit 时执行任意外部写命令。

**依据**：读 src/trivium/hooks.ts:340-346,537-540 及 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md:971：设计假设「commit 不改工作树，参数没有被写入的路径」。但 Git 支持通过 -c key=value 临时覆盖配置项。构造 'git -c core.editor="rm -rf .reviews/t/plan/_meta" commit'（或配合 -e），Git 在需要编辑提交说明时会通过系统 Shell 执行 core.editor 命令。而在 hooks.ts:537-540 中，parseGitSegment 专门吃掉 -c 的参数并把后续识别为 commit，isExemptCommitCommand 将其直接豁免，从而借由 Git 自身进程夹带执行任意 Shell 写命令。

**建议**：豁免校验中显式禁止任何 -c 全局选项（或仅白名单允许无害选项），且强制要求提供 -m 或指定静态文件 -F，禁止无提交说明或显式 -e 触发外部编辑器。

### AGY-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:345` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：将原设计用于宽进拦截的 parseGitSegment 反向复用于白名单豁免，导致前置命令伪装与 Shell 注释截断被误判为合法 commit 放行。

**依据**：读 src/trivium/hooks.ts:345,488-508：parseGitSegment 原用于 hookPreCommit 的宽进保守拦截（旨在只要存在 git commit 就不敢放过），其通过 tokens.findIndex 查找 git，并不要求 gitAt === 0，也不识别 Shell 注释符 #。当直接复用于豁免白名单判定时：形如 'rm .reviews/t/plan/a-gemini.md # git commit'，tokenize 将 # 视作普通 token，parseGitSegment 匹配到后面的 git 和 commit 即判定为提交；又如 'node -e "fs.unlinkSync(...)" git commit'，前置写命令真实执行，后续参数被误判为 commit 导致豁免放行。

**建议**：豁免判定不得直接复用用于拦截的 parseGitSegment，应编写专用的严格白名单解析器：首个有效 token 必须严格为 git 命令；禁止包含 Shell 注释符 #；仅放行结构极简的常规 commit 形态。

### AGY-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/hooks.test.ts:307` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：RV-B1 新增单测未覆盖多行换行符、进程替换、Git 配置注入与 Shell 注释等边界夹带场景。

**依据**：读 test/unit/hooks.test.ts:307-328：用例仅覆盖了字面 &&、;、$()、反引号和 << heredoc 五种情形，存在严重测试盲区，未覆盖 \\n 多行连接、<(...) 进程替换、-c core.editor 配置命令执行、以及 # 注释伪装等攻击形态。

**建议**：在 test/unit/hooks.test.ts 中补充多行命令、进程替换、Git -c 配置注入及注释伪装的负向用例，确保均被正确拒绝。

## 认为正确的部分

- 认可 RV-B1 提出的初衷：在未剥离 heredoc 的原文上做扫描导致 commit message 中提及独占文件名被误拦，确实是本项目的真实痛点。
- 认可窄版设计保留 WRITE_LIKE 对 commit 的写命令判定，使闸门写锁分支对提交依然生效的基本原则。
- 认可前置条件对 heredoc（<<）和常规命令替换（$(、`、${）的防御意识。

## 未覆盖范围（本侧盲区）

- 未覆盖非 macOS 平台（Linux/Windows）下特定 shell 实现对换行符及特殊字符分词的细微差异。
- 未覆盖项目外部复杂 git hook 钩子配置（如 core.hooksPath）可能带来的间接写行为。
- 未覆盖 VS Code 插件集成终端或包装器可能向 Bash 命令头尾注入隐式环境变量的特殊情形。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md`
- `doc/07_manuals/QUICKSTART.md`
- `doc/08_project/BACKLOG.md`
- `src/trivium/hooks.ts`
- `test/unit/hooks.test.ts`
- `.reviews/RV-B1-commit豁免/code/_meta/changes-20260912T130433Z.diff`

> 编排器从工具轨迹中记录到的读取次数：{"read":12,"grep":0,"glob":0,"run_command":0,"project_reads":10}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
