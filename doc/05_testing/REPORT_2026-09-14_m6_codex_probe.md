# M6 第 2 步 · Codex 探针实测报告

- **日期**：2026-09-14
- **CLI**：`codex-cli 0.154.0`（`/opt/homebrew/bin/codex`）
- **本机**：macOS 26.0（Darwin 25.6.0），arm64
- **探针模型**：`deepseek-flash` + `model_reasoning_effort=low`（探能力不探质量，挑最便宜的一档）
- **落盘**：`.trivium/config.local.yaml` 的 `probe.cli.codex`

> 本报告记的是**本机实测结论**。凡与 `doc/02_design/2026-09-13-通用Agent编排与动态多审设计.md`
> §3.1 冲突之处，**一律以本报告为准**（原则 P7）——那一章的条目当时全部带置信度标注，
> 并写明「以 M6 探针为准」。

---

## 一、三条推翻设计文档的事实

### C-1 ·【最重】`-p` 是文件分层，不是 `[profiles.*]` 段

演进设计 §3.1 把 `codex -p <name>` 描述成「按 `~/.codex/config.toml` 的
`[profiles.<name>]` 段运行」，置信度标「中高」。

**实测**：`codex exec --help` 原文是

```
-p, --profile <CONFIG_PROFILE_V2>
        Layer $CODEX_HOME/<name>.config.toml on top of the base user config
```

参数类型名就叫 `CONFIG_PROFILE_V2`。本机 `~/.codex/` 下的
`qwen/deepseek/glm/gpt.config.toml` **就是 profile 文件本身**，
其中两份的文件头注释明写「自包含，供 `codex -p deepseek` 使用」。
五份 toml 里 `[profiles.*]` 段一个都没有——那不是缺配置，是 V2 机制下的**预期**。

**生效性已实测**：同一个 `-m deepseek-flash` 下，`-p qwen` 的 provider 是 `qwen`、
`-p deepseek` 的是 `deepseek`。

**连锁影响**：设计给 `profiles` 探针项写的定义是「`config.toml` 的 `[profiles.*]` 名单回读，
供 preflight 校验」。按该定义取，名单**恒为空**；而演进设计 §7.1 要点 4 的
「未知 profile 预检拦截」是「名单为空即跳过」——那道拦截会**静默失效**。
探针改为枚举 `$CODEX_HOME/*.config.toml`，本机得到 `deepseek、glm、gpt、qwen`。

### C-2 · effort 档位表全错

| slug | 设计 §3.1 写的 | 本机 `codex debug models` 实测 |
| :--- | :--- | :--- |
| `qwen3.8-flash` / `qwen3.8-max` | `low \| medium \| xhigh`，默认 **xhigh** | `low \| medium \| high`，默认 **medium** |
| `deepseek-flash` / `deepseek-v4-pro` | `low \| high \| max`，默认 **high** | `low \| medium \| high`，默认 **medium** |

**两家都是标准三档、默认 medium。** `xhigh` 与 `max` 在本机目录里只属于
`gpt-reserve` 与 `codex-auto-review` 两个 OpenAI 线条目——设计把 OpenAI 的档位
错安给了千问与 DeepSeek。

由此**动摇**（尚未证伪，见「四、证明边界」）演进设计的两条论断：
①「两家 effort 枚举不一致且都不是 `low/medium/high` 字面集」——本机为假；
②「DeepSeek 存在请求值归并映射 `medium→high`」——`medium` 是合法且默认的档位，
该映射的前提不成立。而 `run.v2` 的 `effort_effective` 回读字段，**存在的唯一理由**就是 ②。

### C-3 · 模型目录路径名对不上

设计写 `~/.codex/model-catalog.local.json`；本机实际是随 provider 一份的
`~/.codex/models-<provider>.json`（由 `config.toml` 的 `model_catalog_json` 指定）。
探针一律从配置回读该键，**不写死路径**——按设计写死会对一台**配置正确**的机器判假阴性。

---

## 二、两条影响 M8 设计的硬事实

### P-C1 · 读取路径没有结构化字段

codex 读文件不是调专用工具，而是**让模型跑 shell**：

```json
{"type":"item.completed","item":{"type":"command_execution",
 "command":"/bin/zsh -lc 'head -n 1 /tmp/.../sentinel.txt'",
 "aggregated_output":"SENTINEL_OPEN_7f3a2b …","exit_code":0,"status":"completed"}}
```

路径只在 `command` 文本里。agy 与 zcode 的读事件都带独立路径字段，codex 没有。

**后果**：M8 的 `project_reads` 下限统计与 `deny_paths` 轨迹核验，
对 codex 侧**只能走命令文本解析**。BACKLOG **EV-01**（措施 b：命令文本字面扫描）
对另两家是补充手段，**对 codex 是唯一手段**——该项的优先级因此上升，
且它现在是 M8 的**前置**而非并行项。

### P-C2 · 被沙箱拒绝的命令完全不进事件流

只读沙箱挡下写入时，`command_execution` 事件**一条都不产生**，
而模型的最终回复明说它试过两条途径（`operation not permitted`、
`blocked by read-only sandbox; rejected by user approval settings`）。

**这不是安全漏洞**——写入确实被挡住了，`breach.txt` 未被创建。
丢的是「审查员尝试过写入」这个**行为信号**：设计 §10.3
「轨迹有写事件即判失守」对 codex 侧**恒为假**。

> **🔧 适用范围更正（2026-09-16，M8 第 4 步实测）**
>
> 上面写的「**完全**不进事件流」**说过头了**：它只对**一种**拒绝机制成立。
> 本步的沙箱对照实验把命令形态钉死（prompt 要求逐字执行一条 shell 命令），
> 结果是命令**照常进事件流**：
>
> ```text
> 命令: /bin/zsh -lc "printf 'BREACH' > BREACH_A.txt && echo ALIVE || echo DENIED"
> status: completed   exit: 0
> 输出: zsh:1: operation not permitted: BREACH_A.txt
>       TRIVIUM_WRITE_DENIED
> ```
>
> **两种机制要分开说**：
>
> | 拒绝发生在哪 | 触发形态 | 进不进事件流 |
> | :--- | :--- | :--- |
> | **codex 审批层** | 模型用内置写工具（apply_patch 等），被 `approval: never` 挡下 | **不进**——本节原观测 |
> | **沙箱 syscall 层** | 模型跑 shell，写调用得到 `EPERM` | **进**，且失败痕迹在该命令的 `output` 里 |
>
> 本节原次实测里模型自己说「试过两条途径」，报的两句错误
> （`operation not permitted` 与 `rejected by user approval settings`）
> 恰好各对应一种——**证据当时就在手里，是归纳说过头了**。
>
> **判定层不用改，`rejectionRecorded: false` 仍是对的**：模型**可以**选那条不留痕的路，
> 所以「没检出写事件」依然排除不了失守。变的是**负对照怎么设计**——
> 既然 shell 那条路留痕，就能拿「命令进了轨迹 + 输出显示被拒」当**正对照**，
> 而不必像计划双审 CODEX-01 提的那样另找一个「允许写的路径」
> （`-s read-only` 下整个文件系统只读，那种路径根本不存在，实跑已证）。
> 落点：`scripts/codex-sandbox-control.mjs`。

三重叠加（工具白名单 + deny 兜底 + 指纹比对与轨迹核验）对 codex 只剩两重；
第三重里「指纹比对」仍有效（真改了文件会被发现），失效的是「轨迹核验」那一半。
两份录制样本已存入 `test/fixtures/codex-events/`，并有一条**锁事实**的用例守着：
哪天这条红了，说明 codex 开始记录被拒命令，那时该回头启用 codex 侧的轨迹核验。

---

## 三、探针清单实测结果

| 探针项 | 结论 | 手法 | 成本 |
| :--- | :--- | :--- | :--- |
| `bin` / `version` | `/opt/homebrew/bin/codex`，`0.154.0` | `--version` 抠三段号 | 零 |
| `models` | 10 个（随 profile 变） | `codex debug models`（**只渲染本地目录，不调模型**） | 零 |
| `model_catalog` | `~/.codex/models-qwen.json`，`-c model_catalog_json=` 可切换 | 同上 | 零 |
| `profiles` | `deepseek、glm、gpt、qwen` | 枚举 `$CODEX_HOME/*.config.toml` | 零 |
| `profile_flag` | **true**（provider 随 profile 改变） | 读 header（流式早退） | 低 |
| `unknown_profile_rejected` | **false** —— 静默回落基底配置 | 同上 | 低 |
| `config_override` | **true**（dotted path，值按 TOML 解析） | 同上，且与基底**当前值**做差异比对 | 低 |
| `effort_validated` | **false** —— 目录外档位（`xhigh`）照样透传 | 同上，非零退出才算「校验了」 | 低 |
| `readonly_flags` | `-s read-only`（**本就是默认值**），+ `approval: never` 双层拦截 | 负对照 | 一次调用 |
| `exec_headless_read_ok` | **true**（哨兵首行回显命中） | 真跑 | 一次调用 |
| `json_event_types` | `thread.started` / `turn.started` / `item.started` / `item.completed` / `turn.completed`；item 类型 `command_execution` / `agent_message` / `error` | 录制 | 同上 |
| `trace_path_structured` | **false** —— 见 P-C1 | 录制 | 同上 |
| `rejected_command_in_trace` | **false** —— 见 P-C2 | 负对照 | 同上 |
| `scratch_paths` | `[]` —— 项目根零污染（会话落在 `$CODEX_HOME`） | git 比对 | 零 |
| `isolation` | `home_copy` —— 独立 `CODEX_HOME` 实测被采纳 | 副本 config 指向坏路径，看 `debug models` 是否翻转成失败 | 零 |
| `path_deny` | **false** —— 无路径级 deny 机制 | 实跑 `codex exec --help` 全文扫描 | 零 |

> **header 的成本口径**：不是零配额。header 在调模型前打印，探针逐行读 stderr、
> 五个标签凑齐即 `killTree`（手工 `| head -N` 靠 SIGPIPE 中断的代码内等价物），
> 窗口被压到接近零但不等于零。初版用 12s 固定超时，代码双审指出两个毛病：
> 5 次调用累计约 60s，且**固定超时无论调到多少都只是在赌「请求还没发出去」**。
> 改流式早退后整段 `doctor --only codex` 从 60s 起步降到约 21s。

### 另外两条「CLI 什么都不校验」

- **model slug 不校验**：`-p qwen -m deepseek-flash` 照样被接受，
  而 qwen 目录里没有 `deepseek-flash`。
- **effort 档位不校验**：目录只声明 `low|medium|high`，`xhigh` 照样透传。

两条合起来说明 codex 客户端对配置值几乎不做校验、静默前移到服务端。
**preflight 必须自己校验 model 与 effort**，否则用户写错不会有任何提示。

---

## 四、证明边界（本报告不承诺什么）

1. **模型目录是本机文件，不是厂商官方目录。** `models-*.json` 由本机的配置切换工具生成。
   「目录声明支持 medium」不等于「上游 API 真按 medium 处理」。
   **C-2 因此只推翻了「设计写的档位表」，没有推翻「服务端可能存在归并映射」**——
   归并若发生是在服务端，目录看不出来，header 也看不出来（它显示的是客户端准备发送的值）。
   要证伪 ② 得从**服务端回包**取证据，本步未做。
2. **`-p` 的实测只覆盖 provider 切换。** profile 能否捆绑 `model_reasoning_effort`、
   沙箱策略、审批策略等，未逐项验证。
3. **只有 deepseek 线被真实调用过。** qwen / glm / gpt 三个 profile 只验证了
   「被加载」（provider 变了），没有各跑一次真实任务；`providers_ok`
   （逐家族 provider 探活）**未实测**。
4. **未测 Driver 承载面。** codex 作为 Driver 的入口形态（prompts 参数等）是第 4 步的范围。
5. **`auth` 探活缓存未接**。本步的 `doctor --only codex` 不做探活。
6. **录制样本的哨兵与生产探针的不是同一个**：样本录制时用的是手工搭的夹具
   （`SENTINEL-OPEN-7f3a2b91`），而生产探针走 `createFixture()`（`SENTINEL_OPEN_7f3a2b`）。
   因此样本能验证「解析器能从最终回复里认出给定哨兵」，**不能**验证
   「生产探针那个哨兵会被模型原样回显」。下次按 fixtures README 的命令行重录时用真夹具补上。

---

## 五、给后续里程碑的结论

| 里程碑 | 本报告的直接影响 |
| :--- | :--- |
| **M6 第 4 步** | C-1 / C-2 / C-3 要回填主设计 §3.6 与演进设计 §3.1，并**如实记下调**（原推定 → 实测对照，不得把原文悄悄改掉） |
| **M8（codex 接入）** | ① EV-01 升为前置项（P-C1）；② 预检必须自己拦未知 profile、校验 model 与 effort；③ 只读保障完全依赖沙箱，轨迹核验那一半对该侧不可用（P-C2），验收口径要相应调整 |
| **M11（档位路由）** | `-p` 与 `-c` 两条路都实测可用且互不冲突；`-c` 更适合逐审核者覆盖（不必造文件），`-p` 更适合整套档位切换 |
| **`run.v2`** | `effort_effective` 字段的存在理由被动摇但未证伪（见边界 1）。**暂不动**，待服务端证据 |
