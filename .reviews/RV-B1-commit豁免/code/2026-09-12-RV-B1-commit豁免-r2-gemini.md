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
run_id: 20260912T134136Z
rerun_index: 2
snapshot_hash: sha256:da0aeaa214de4c10b0889772915a7a8d45582e3fe7bd74959f70976079e5d7da
blind: true
started_at: 2026-09-12T13:41:37.126Z
finished_at: 2026-09-12T14:02:58.313Z
duration_s: 141
tool_calls:
  read: 22
  grep: 0
  glob: 1
  run_command: 0
  project_reads: 11
evidence_ok: true
verdict: block
findings_count:
  blocker: 4
  major: 0
  minor: 1
  nit: 0
degraded: false
parse_fallback: false
peer_deny: false
drift: false
heterogeneous: true
session_id: f0c94479-0d11-49e9-9714-f60530792b82
---

# 代码审查：RV-B1-commit豁免

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260912T134136Z` ｜ 第 2 轮

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

【阻断】RV-B1 的三个前置条件可被换行符多行命令（\\n）和进程替换（<()）轻易绕过，且存在利用 Git 配置（-c core.editor=...）夹带执行写命令的第四条路径。
最危险的是前置条件 1 遗漏换行符 \\n，导致 'git commit -m x\\nrm <独占文件>' 被误判为单段 commit 豁免保护集扫描；同时 HAS_SUBSTITUTION 未防御 Bash 进程替换，'git commit -F <(rm ...)' 可在子进程执行写操作；更严重的是复用用于宽进拦截的 parseGitSegment 作为放行白名单，导致 'sh -c \"rm ...\" git commit' 与 'rm ... # git commit' 均被豁免。
当前补丁严重削弱了编排器独占对象的安全护栏，必须阻断并重构白名单判定。

**结论**：`block`

## 审查意见（共 5 条：阻断 4 ｜ 次要 1）

### AGY-r2-01 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:361` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：前置条件 1 无法拦截换行符分隔的多行复合命令：cmd.split 正则遗漏换行符 \\n 与 \\r，导致换行后拼接的写命令被判为单段 commit 放行。

**依据**：读 src/trivium/hooks.ts:340-346,361：segments 仅由 /(?:&&|\\|\\|[;&|])/ 切割，未包含 \\r 与 \\n。在多行复合命令（如 'git commit -m \"msg\"\\nrm .reviews/t/plan/a-gemini.md'）中，整串不含 &&、||、;、&、|，因此 effective.length === 1 成立。而在随后的 tokenize（hooks.ts:567 /\\s/.test(ch)）中，\\n 被视为空白符切分，首个命令依然被 parseGitSegment 识别为 subcommand === 'commit'。isExemptCommitCommand 返回 true，bashTargetsProtected 返回 false 豁免保护集扫描。Bash 随后分行真实执行第二行的 rm 命令，编排器独占文件被销毁。

**建议**：切割正则必须补充换行符 /(?:&&|\\|\\|[;&|\\r\\n])/，或在 isExemptCommitCommand 入口显式校验禁止 cmd 包含 [\\r\\n]。

### AGY-r2-02 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:318` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：前置条件 2 可被 Bash 进程替换语法（Process Substitution <(...) / >(...)）直接绕过：HAS_SUBSTITUTION 正则仅检查 $(、` 与 ${。

**依据**：读 src/trivium/hooks.ts:318,343：HAS_SUBSTITUTION 定义为 /\\$\\(|`|\\$\\{/，遗漏了 Bash 的进程替换 <(...) 与 >(...)。例如构造 'git commit -F <(rm -f .reviews/t/plan/a-gemini.md)'，命令不含 $(、反引号、${ 或 <<，单段判定为 1，parseGitSegment 识别为 commit，isExemptCommitCommand 返回 true。Bash 执行该命令时 fork 子进程执行 <(...) 内的 rm 命令生成文件描述符，受保护文件被删除。

**建议**：将 HAS_SUBSTITUTION 扩展为包含进程替换（如 /(?:\\$|<|>)?\\(|`|\\$\\{/ 或显式检查 <\\( 与 >\\(），并对 -F 参数做静态文件路径校验，禁止动态替换输入。

### AGY-r2-03 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:340` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：存在第四条夹带路径：利用 Git 原生配置选项（-c core.editor=...、-c core.hooksPath=...）或环境变量（GIT_EDITOR=...），借由 Git 进程夹带执行任意 Shell 写命令。

**依据**：读 src/trivium/hooks.ts:340-346,537-540 以及 doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计-claude.md:971：设计假定「commit 不改工作树，参数没有被写入的路径」。但 Git 支持通过 -c key=value 临时覆盖配置。例如构造 'git -c core.editor=\"rm .reviews/t/plan/a-gemini.md\" commit --allow-empty'，Git 打开编辑器时会通过系统 shell 执行 core.editor 命令；又如 -c core.hooksPath=... 会触发外部钩子执行。在 hooks.ts:537-540 中，parseGitSegment 专门吃掉 -c 参数并将后续识别为 commit，isExemptCommitCommand 予以豁免，导致工作树受保护文件被任意修改。

**建议**：豁免判定必须显式禁止任何 -c 全局选项（或严格白名单限制），禁止环境变量前缀（如 GIT_EDITOR），且强制要求提供 -m 或无害的普通文件 -F，禁止触发外部 editor 或 hook。

### AGY-r2-04 · 阻断（blocker）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/hooks.ts:345` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：将原本为 hookPreCommit「宽进拦截（宁可误拦不可放过）」设计的 parseGitSegment 直接复用于白名单豁免，导致前置恶意命令（如 sh -c 'rm ...' git commit）与 Shell 注释截断（rm ... # git commit）被豁免放行。

**依据**：读 src/trivium/hooks.ts:345,488-508：parseGitSegment 在 tokens 中通过 tokens.findIndex 寻找 git，并不要求 gitAt === 0，且 tokenize 不识别注释符 #。若输入 'sh -c \"rm .reviews/t/plan/a-gemini.md\" git commit'，tokens 为 ['sh', '-c', '...', 'git', 'commit']，gitAt 为 3，subcommand 被判定为 'commit'，整条命令被判豁免；而 Bash 真实执行时 sh 将 $0 赋为 git 并真实执行 rm 命令。同理，'rm .reviews/... # git commit' 在 Bash 中 # 后的内容被忽略，但 parseGitSegment 将其识别为 commit 予以豁免。此外，gitAt < 0 时的正则兜底 /\\bgit\\b[^|;&]*\\bcommit\\b/ 更会把任意包含这两个单词的非 git 命令误判为 commit。

**建议**：白名单豁免必须使用专用的严格判定：首个有效 token 必须严格为 git（或以 /git 结尾的绝对路径）；禁止出现 # 注释；严禁复用带宽进兜底与 findIndex 的宽松拦截函数。

### AGY-r2-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/unit/hooks.test.ts:307` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：RV-B1 单测仅覆盖了字面 &&、;、$()、反引号和 << 五种情况，未覆盖换行符、进程替换、配置注入、命令前缀与注释伪装等攻击形态。

**依据**：读 test/unit/hooks.test.ts:307-328：测试集中的负向用例未包含 \\n 多行连接、<() 进程替换、-c core.editor 配置注入、sh -c '...' git commit 前缀以及 # git commit 注释伪装，无法锁住防护边界。

**建议**：在 test/unit/hooks.test.ts 中补充上述夹带绕过形态的负向测试用例，确保它们均能被 hookPreBash 正确拦截。

## 认为正确的部分

- 认可 RV-B1 提出的初衷：在未剥离 heredoc 的原文上做扫描导致 commit message 中提及独占文件名被误拦，确实是本项目的真实痛点。
- 认可窄版设计保留 WRITE_LIKE 对 commit 的写命令判定，使闸门写锁分支对提交依然生效的基本原则。
- 认可前置条件对常规 heredoc（<<）和命令替换（$(、`、${）的防御意识。

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
- `.reviews/RV-B1-commit豁免/task.json`
- `.reviews/RV-B1-commit豁免/code/_meta/run-20260912T130433Z.json`
- `.reviews/RV-B1-commit豁免/code/_meta/run-20260912T134136Z.json`
- `.reviews/RV-B1-commit豁免/code/_meta/brief-gemini-20260912T134136Z.md`
- `.reviews/RV-B1-commit豁免/code/_meta/changes-20260912T134136Z.diff`
- `.reviews/RV-B1-commit豁免/code/_meta/changes-20260912T130433Z.diff`
- `.reviews/RV-B1-commit豁免/code/2026-09-12-RV-B1-commit豁免-gemini.md`
- `.reviews/RV-B1-commit豁免/code/_meta/review-gemini-20260912T130433Z.json`

> 编排器从工具轨迹中记录到的读取次数：{"read":22,"grep":0,"glob":1,"run_command":0,"project_reads":11}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
