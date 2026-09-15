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
run_id: 20260915T153603Z
rerun_index: 9
snapshot_hash: sha256:83a0ec891f26a4fec7d662d23f634f271e2f82c3624afedd6342064ecda4ae92
blind: true
started_at: 2026-09-15T15:36:03.900Z
finished_at: 2026-09-15T16:05:48.097Z
duration_s: 1676
tool_calls:
  read: 44
  grep: 16
  glob: 0
  run_command: 0
  project_reads: 26
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
heterogeneous: true
session_id: 37f959a0-cc9f-429f-b253-b29b08036e64
---

# 代码审查：M8-Codex审核者接入

> Critic-A · Google Antigravity ｜ 模型 `gemini-3.8-flash-high`
> ｜ 运行 `20260915T153603Z` ｜ 第 9 轮
> ｜ 本轮审核者 gemini、glm

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。

## 总判断

最严重问题在写判据：掩码检测正则 &(?!&) 误判 2>&1，导致带输出重定向的写入全部降级为 suspected。
其次 looksLikePath 过滤面过宽，项目根目录下无扩展名文件（如 Makefile、Dockerfile）写入被静默漏报或降级。
chmod/chown 动词写入位将模式与所有者混入写入目标，ln 单操作数形态误将源当作目标。
第五处回落已查实：review.ts:341 的 checkModelSlugs 未传 sides，使 codex 的模型 slug 校验在启动时脱节。
隔离副本白名单设计及「裁剪→重写→拷贝」顺序在 profile 分层下证明成立。
preflight 三处收敛逻辑清晰，消除了预检与适配器的判据分叉。
buildCodexResult 纯函数抽取与 suspected_write_events 契约增补属于合理实现支撑，未超出本步范围。

**结论**：`request-changes`

## 审查意见（共 5 条：重要 2 ｜ 次要 2 ｜ 吹毛求疵 1）

### AGY-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:648-650` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：looksLikePath 过滤面过窄，误将项目根目录下无扩展名文件（如 Makefile、Dockerfile、README、LICENSE）及根目录名全部排除，导致重定向写入被静默漏报、写动词被错误降级为疑似写入而非只读失守。

**依据**：在 src/trivium/adapters/base.ts:648-650，looksLikePath(t) 定义为 t.includes('/') || /\.[A-Za-z0-9]+$/.test(t)，并在 base.ts:690 用于过滤所有写入点 sinks。若命令为 `echo bad > Makefile`，重定向目标 Makefile 因不含斜杠与点号被过滤，writeSinksOfSegment 返回空；由于 echo 不在 WRITE_VERBS 中，hitAny 为 false，base.ts:778 亦不命中，writes 与 suspected 均为空，写入被完全漏报。若为 `touch Makefile` 或 `rm LICENSE`，sinks 同样被清空，hitAny 为 false，因命中 WRITE_VERBS 被误归入 suspected 档（'命中写动词但提不出写入目标'），从而逃逸了 writes 的只读失守裁决。

**建议**：区分「参数位启发式过滤」与「明确写入目标过滤」：重定向符后紧随的 token 及写动词在确定操作数位上的非选项 token 均应视为路径候选，不要以是否含斜杠或后缀作为硬门槛；或仅在无法确定操作数语境时使用 looksLikePath 排除纯数字。

### AGY-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:738` |
| 类别 | security ｜ 层次 code |
| 置信度 | high |

**问题**：掩码检测正则 `&(?!&)` 误将文件描述符重定向（2>&1、>&2、1>&2 等）识别为失败掩码，导致包含标准错误重定向的项目内真实写入命令被系统性降级至疑似档，规避只读失守。

**依据**：在 src/trivium/adapters/base.ts:738，掩码判定使用 /\|\||;|&(?!&)/.test(dequoted)。在 shell 常用命令中，重定向语法如 `echo breach > src/x.ts 2>&1` 或 `make 2>&1` 中，`&` 紧跟 `1` 而非 `&`，导致 masked 恒为 true。进而在 base.ts:761-764 直接进入 `suspected.push({ command: raw, why: '命令含 || 或 ; 掩码，整条退出码不代表写段成功' })` 并 continue，导致该命令无法进入 writes。这使得只需附加 2>&1 即可彻底规避只读失守判定。另外，管道失败掩码（如 `touch src/x.ts | true`）在没有 pipefail 时整条退出码为 0，但 `|` 并未被纳入 masked 检查。

**建议**：在掩码检测前先剥除或排除文件描述符重定向（形如 [0-9]*>&[0-9]* 或 &>），将 `&` 的掩码检测限定为作为命令分隔符或行尾后台运行的场景；同时评估是否应将管道符号 `|` 后接命令作为掩码处理。

### AGY-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:628` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：chmod 与 chown 的写入位定义为 'all-after-flags'，将权限模式与所有者操作数误当作写入目标处理，存在虚报与混淆风险。

**依据**：在 src/trivium/adapters/base.ts:628，chmod 与 chown 在 WRITE_VERB_SINK 中被标记为 'all-after-flags'，base.ts:685 将非 `-` 开头的所有参数全推入 sinks。然而 chmod 的第一个非选项参数是权限模式（如 644、+x），chown 的第一个非选项参数是所有者（如 root、user.name），它们并不是写入目标。当出现 `chown user.name /tmp/target.ts` 时，user.name 符合 looksLikePath（含点号），被解析为 /proj/user.name 并触发 writes 误判（虚报只读失守）；而 chmod +x /tmp/script 中 `+x` 不以 `-` 开头也会被作为参数收集。

**建议**：为 chmod 与 chown 定义专门的操作数跳过逻辑，跳过第一个非选项操作数（mode / owner），将其余后续参数作为修改目标。

### AGY-04 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/review.ts:341` |
| 类别 | contract ｜ 层次 code |
| 置信度 | high |

**问题**：review.ts 内嵌的 checkModelSlugs 未传入当轮实际选取的审核者，导致其回落到 DEFAULT_CRITICS，使非缺省审核者（如 codex）在启动时跳过模型 slug 校验，同时未入选侧的无效配置会误拦当次运行。

**依据**：在 src/trivium/review.ts:341，checkModelSlugs(cfg, stage, opts.modelOverrides) 在第 353 行 sides 解析之前被调用，且未传入第四个参数 critics。根据 src/trivium/preflight.ts:282，critics 缺省取 DEFAULT_CRITICS（['gemini', 'glm']）。如果用户通过 `review --stage code --critics codex --model-codex bad_model` 指定非默认侧，checkModelSlugs 只校验了默认两家的模型，完全放过了 codex 的非法 slug；反之若默认两家在配置中有无效模型，即便本轮只跑 codex 也会在 review.ts:341 报错中断。这是全仓第五处未完成选侧适配的回落点。

**建议**：将 review.ts 中 sides 的解析提前至 checkModelSlugs 调用之前，并将 sides 作为第四个参数显式传入 checkModelSlugs(cfg, stage, opts.modelOverrides, sides)。

### AGY-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/base.ts:624` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：ln 单操作数形态下误将源文件当作写入目标，导致在项目内创建指向项目外的软链接被误判为项目外写入。

**依据**：在 src/trivium/adapters/base.ts:624 与 base.ts:682，ln 采用 mode === 'last' 取 args.at(-1)。在 POSIX 规范下，当 ln 仅带一个操作数时（例如 `ln -s /etc/passwd`），目标是当前工作目录下的 `./passwd`，而 args.at(-1) 却是源文件 `/etc/passwd`。若源文件在项目外，实际在项目内创建链接的操作会被误分类为「写入目标在项目外」而降级为疑似写入。

**建议**：对于 ln 动词，当过滤后的操作数仅有 1 个时，提取其 basename 作为在 projectRoot 下创建的链接目标，而非使用源路径本身。

## 认为正确的部分

- 隔离副本的双覆盖机制（CODEX_HOME + HOME）配合白名单裁剪（KEEP_TOP_KEYS 与 KEEP_SECTION_PREFIX）干净切断了 MCP server、第三方 skill 根与插件通道，并在 profile 分层下保证重写与拷贝顺序自洽。
- preflight 三处收敛（availability / authProbe / 模型目录校验）成功消除了预检与适配器之间的重复知识与判据分叉，移除了 preflight 中的厂商硬编码分支且未破坏既有两家行为。
- 注册表 defaultSelected 字段拆分明确解耦了「能否作为审核者」与「默认是否入选」，并在 types/archive/gate/divergence 中准确完成缺省集合回落。
- buildCodexResult 纯函数抽取使得 AC-20 回读防冒充逻辑能够被单测变异覆盖，suspected_write_events 为判不实的写入提供了审计载体，未超出本步范围。

## 未覆盖范围（本侧盲区）

- 未在配置有实际有效 API 密钥的环境下真机运行真实模型的 codex 审查全流程。
- 未覆盖超长复杂复合 shell 脚本或混淆转义场景下的命令词法切分边界。
- 未在 Linux/Windows 等非 macOS 环境下测试路径归一与子进程行为差异。

## 实际查阅的项目文件

- `CLAUDE.md`
- `AGENTS.md`
- `README.md`
- `doc/README.md`
- `doc/01_requirements/README.md`
- `doc/02_design/README.md`
- `src/trivium/adapters/base.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/codex-home.ts`
- `src/trivium/adapters/codex-trace.ts`
- `src/trivium/adapters/agy.ts`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/preflight.ts`
- `src/trivium/agents/registry.ts`
- `src/trivium/types.ts`
- `src/trivium/config.ts`
- `src/trivium/doctor.ts`
- `src/trivium/probes/codex.ts`
- `src/trivium/review.ts`
- `src/trivium/gate.ts`
- `src/trivium/archive.ts`
- `src/trivium/cli.ts`
- `src/trivium/disposition.ts`
- `src/trivium/report.ts`
- `src/trivium/topic-args.ts`
- `test/unit/codex-write-verbs.test.ts`
- `.reviews/M8-Codex审核者接入/code/2026-09-15-M8-Codex审核者接入-r8-response-claude.md`
- `.reviews/M8-Codex审核者接入/code/_meta/changes-20260915T153603Z.diff`

> 编排器从工具轨迹中记录到的读取次数：{"read":44,"grep":16,"glob":0,"run_command":0,"project_reads":26}

---

*本文档由 TriviumCode 编排器从 `gemini` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
