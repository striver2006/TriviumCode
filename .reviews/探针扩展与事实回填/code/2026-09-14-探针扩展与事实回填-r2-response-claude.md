---
schema: trivium.disposition.v1
topic: 探针扩展与事实回填
stage: code
role: claude
kind: response
run_id: 20260914T144553Z
addresses:
  - 2026-09-14-探针扩展与事实回填-r2-gemini.md
  - 2026-09-14-探针扩展与事实回填-r2-glm.md
---

# 代码应答（r2）：Codex 探针（M6 第 2 步）

## 0. 裁决总览

**15 条全部接受，零驳回。** 两侧均判 `request-changes`
（AGY 3 major + 3 minor、GLM 4 major + 3 minor + 2 nit）。

### 0.1 先答四个焦点

| 焦点 | 两侧答案 | 我原来的判断 |
| :--- | :--- | :--- |
| 一、11 个字段过度登记？ | **不算**，消费方注释是 EV-06 的正解 | ✅ 对 |
| 二、12s 抢 header 站得住？ | **站得住，但有更确定的流式早退法** | 半对——手法可用，但注释在撒谎（GLM-06） |
| 三、三态盖全了？ | **没有**，漏了两处 | ❌ 我问「可能还有漏」，答案是有，而且漏的是最重的 |
| 四、C-2 边界过于保守？ | **分寸恰当、不保守** | ✅ 对 |

焦点三的答案值得展开：我把三处 header 判据改成三态、还在注释里写明了理由
（「二态写法会把探测本身失败记成一个确定的否定结论」），**却漏掉了 gating 最重的那一处**——
`exec_headless_read_ok` 是唯一驱动 doctor blocker 的 codex 判据，它仍是
`?? false` 塌缩（GLM-01），`rejected_command_in_trace` 同形（GLM-05）。

**我修的是「我刚被打脸的那三处」，不是「所有同形的地方」。** 这与上一轮
`assertion-scope-creep` 的教训同源：修一条时要列出全部同形落点，而不是只修手头这条。

### 0.2 最严重的一条：严重度倒挂（GLM-03）

只读负对照**失守**——`-s read-only` 下 `breach.txt` 真被创建，意味着该侧作为审查员时
**能写项目文件**——却只产生一条 ⚠️ note 和 `readonly_flags: []`，**不进 blockers**；
而同一个 20 行代码块里，「读不到文件」反倒是 blocker。

后果核实为真：`doctor.ts:220-226` 的 blockers 只看 `entrypoint` 与
`exec_headless_read_ok`。于是**沙箱失守的机器上 doctor 会报「✓ 未发现阻断级问题」**，
而探针自己的 note 文案写着「该侧不可用于审查」——判定与自家文案直接矛盾。

preflight 侧也没有兜底：`checkReadonlyCapability` 仍硬绑 zcode（EV-05② 剩余项），
codex 的 `readonly_flags` 目前**没有任何闸门消费**。两边合起来是一条完整的失守通道。

这是本轮唯一被判 `security` 类的意见，也是最该先修的。

### 0.3 第三轮同形：注释宣称了实现没兑现的事（GLM-04）

```ts
/*
 * 读取路径是否结构化：命令事件里只有 `command` 文本，没有独立路径字段。
 * 判据取「哨兵路径是否只能从命令文本里找到」——找得到说明确实读了，
 * 而只在文本里说明取不到结构化路径。
 */
probe.trace_path_structured = false;   // ← 上面描述的判据，一行都没实现
```

同类还有两处：`isolation = 'home_copy'`（注释称「实测可用」，而本函数内没有任何
`CODEX_HOME` 实验——我是在**手工终端**里验的，代码里没有）、`path_deny` 的
`method` 字符串写死「codex 0.154.0 的 `--help` 无路径级 deny 旗标」（探针并没有真跑 `--help`）。

三个都是**常量冒充测量**，而且每次 `doctor` 都会给它们盖上新的 `probed_at` 落盘成「本机实测」。
对照项目自己的标准：`probes/agy.ts` 的 `probePathDeny` 真跑否定对照，注释明写
「这样 `supported: false` 才是『实测过的结论』而不是『没试过』」。

**这是「注释宣称 ≠ 实现兑现」连续第三轮出现**（r1 三条、上一轮计划审查一条、本轮三条）。
形状每次略有不同，这次是**把手工验证的结论直接写成代码常量**——
手工确实验过，所以我写注释时心里是踏实的；但探针的承诺是「在**这台机器上**实测」，
手工验过不等于代码测过。

---

## 0.4 裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| GLM-03 | glm | 重要 | 接受 | 沙箱失守只记 note、读不到文件反而 blocker——严重度倒挂，且 doctor 会报「未发现阻断级问题」 | `doctor.ts` codex 段补 breach blocker |
| GLM-01 | glm | 重要 | 接受 | `exec_headless_read_ok` 是唯一驱动 blocker 的判据却仍二态塌缩，超时/报错会被记成「能力缺陷」 | 改三态；doctor 对 null 给 note 不给 blocker |
| AGY-01 | gemini | 重要 | 接受 | 未装 codex 的机器跑全量 doctor 会被硬阻断，而 codex 的 `criticEnabled` 仍是 false | 未启用的 CLI 缺失只记 note，显式 `--only` 时才 blocker |
| AGY-02 | gemini | 重要 | 接受 | 三态仍有三处漏洞：报错退出被当没测到、基底同值误判、基底本就是 low 时假阳性 | `probeCodexHeader` 返回 exitCode/timedOut；判据改差异比对 |
| GLM-04 | glm | 重要 | 接受 | 三个字段是常量冒充测量，其中一处的注释描述了根本没实现的判据 | 三处都改真测；测不了的记 null 并写明依据 |
| GLM-02 | glm | 重要 | 接受 | 探针模型与 `profiles[0]` 绑死，换台机器就会拿错 provider 调模型、落假 blocker | 按模型目录选 profile；失败归因进 note 而非能力否定 |
| AGY-03 | gemini | 重要 | 接受 | 12s × 5 次累计 60s，且窗口内可能真发请求 | 改流式读 stderr，标签凑齐即 killTree |
| GLM-06 | glm | 次要 | 接受 | docstring 与调用点写「零配额」，函数体自认「可能已发出请求」——M8 抄配方时读的是前者 | 三处注释统一为「低成本」；顺带实现流式早退 |
| AGY-04 | gemini | 次要 | 接受 | `profiles[0]` 是字母序巧合，本机恰好 deepseek 排第一 | 与 GLM-02 同一处修复 |
| GLM-05 | glm | 次要 | 接受 | `rejected_command_in_trace` 同形塌缩，写入探针失败时会被记成「盲区存在」 | 无 finalText 记 null；有自述且 commands 为空才记 false |
| AGY-05 | gemini | 次要 | 接受 | `PROBE_IMPLEMENTED` 没加 codex——我上一轮刚建的防线，这一轮自己第一个违反 | 加 `'codex'` |
| GLM-07 | glm | 次要 | 接受 | header 格式零测试覆盖，而它正是本步栽过的坑；标签改名会让五个字段集体变 null 且无人报警 | 录 header 样本 + 补 `pick()` 单测 |
| AGY-06 | gemini | 次要 | 接受 | `defaultProbe` 没给 codex 补专属空壳，未探时 11 个属性是 undefined，偏离类型契约 | 补齐空壳 |
| GLM-08 | glm | 吹毛求疵 | 接受 | `json_event_types` 文档说是 item 类型图谱，实际是两个名字空间合并去重 | 分两个字段，与解析器内部结构一致 |
| GLM-09 | glm | 吹毛求疵 | 接受 | `readCatalogPath` 有死参数；且只读基底 config，而 profile 文件同样能设该键 | 去死参数；口径注明或按实际 profile 回读 |

---

## 1. 逐条裁决

### GLM-03 · 重要（security）—— 接受

**裁决**：接受，**本轮第一优先修**。

核实为真：`doctor.ts:220-226` 的 blockers 只判 `entrypoint` 与 `exec_headless_read_ok`，
负对照失守只走 `notes`。`blockers` 的契约是「非空则 preflight 必然失败」（`doctor.ts` 自述），
一个**能写项目文件的审查员**理应命中这条契约。

**这不是要提前做 EV-05② 的泛化**（审查员自己也这么说），是在这段新代码内部把两种失败的
严重度摆正：读不到文件 = 干不了活；沙箱失守 = **干得了活但会破坏工作树**，后者严重得多。

**落点**：`doctor.ts` 的 codex 段增一条——非 `skipModelCalls` 且 `readonly_flags` 为空时
push blocker，文案沿用探针自己的 note（「只读沙箱负对照失败，该侧不可用于审查」）。

### GLM-01 · 重要 —— 接受

**裁决**：接受。

`read.finalText?.includes(SENTINEL_OPEN) ?? false` 把四条路径塌缩成确定否定：
180s 超时被杀（`exec.ts` 的 `run` 超时**不抛错**、返回截断输出）、spawn 失败、
provider 报错退出、事件流里没有 `agent_message`。

后果如审查员所述：一次网络抖动就会让 `config.local.yaml` 落下
`exec_headless_read_ok: false` 这个**能力缺陷事实**，doctor 打出 blocker 并附一条
可能完全不对的诊断（「请确认 provider 凭据已配置」）；M8 的 `availability()`
读到 false 也无从分辨「测了不行」与「没测成」。

**落点**：`finalText` 为 null 时记 null；doctor 侧对 null 给
「探针未得出结论，请重跑 `doctor --only codex`」的 note。
**null 分支不能静默放行**——否则「没测到」与「测了没问题」在报告里长得一样，
这正是本项目三态口径的全部理由。

### AGY-01 · 重要 —— 接受

**裁决**：接受。

`codex` 的 `criticEnabled` 仍是 false（M8 才接入），而未装 codex 的机器跑默认
`trivium doctor`（`only === null`）会因 `blockers` 非空而退非零码。
**这会打到每一个没装 codex 的用户**，而他们什么都没做错。

**落点**：按 `agentByCliName(name)?.criticEnabled` 分档——
未启用的 CLI 缺失只记 note；**只有用户显式 `--only codex` 时才升为 blocker**
（那时他明确在问这一侧的状况，答「没装」是有用的）。

这条与 GLM-03 合起来构成完整的严重度矩阵，修的时候一起做：

| 情形 | 未启用（现状） | 已启用（M8 后） |
| :--- | :--- | :--- |
| 没装 | note | blocker |
| 装了但读不到文件 | note | blocker |
| 装了但**沙箱失守** | **blocker**（不论启用与否） | blocker |

沙箱失守那一行不分档：它说明这台机器上的 codex 现在就是不安全的，
与「我们打不打算用它当审核者」无关。

### AGY-02 · 重要 —— 接受

**裁决**：接受三处，其中第一处是**判据方向错**，比另两处严重。

1. **`effort_validated` 把「报错退出」判成「没测到」**：若 CLI 严格校验并在启动时
   报错退出，header 根本打不出来 → `effort === null` → 记 null。可事实是**它校验了**。
   判据与事实**方向相反**——这和上一轮那次「判反」是同一个坑的另一面：
   上次是 null 被判成 true，这次是 null 掩盖了 true。
2. **`profile_flag` 同值误判**：基底 provider 恰好等于首个 profile 的 provider 时判 false。
3. **`config_override` 假阳性**：基底本身就是 `low` 时，`-c` 被完全忽略也会判 true。

**落点**：`probeCodexHeader` 返回值增 `exitCode` / `timedOut` / `stderr`；判据改为：

- `effort_validated`：进程**非零退出且 stderr 提到该档位** → true（校验了）；
  正常退出且 effort 原样透传 → false；其余 → null。
- `profile_flag`：挑一个 provider 与基底**不同**的 profile 来探；找不到这样的 profile 就记 null
  并在 note 里说明「本机所有 profile 的 provider 都与基底相同，无法用差异法判定」。
- `config_override`：挑一个与基底**当前值不同**的 effort 去覆盖。

三条的共同修法是**差异比对要先保证基线可区分**，这一点原实现整个漏掉了。

### GLM-04 · 重要 —— 接受

**裁决**：接受三处，全部改为真测；确实测不了的记 null 并写明依据。

见 §0.3。三处的具体落点：

- **`trace_path_structured`**：按注释里**原本就描述好**的判据实现——
  解析 `completed` 的 `command_execution` 项时，检查除 `command` 外是否有字段的值
  含哨兵路径（有 → true）。这条本来就廉价，我当时是因为手工已经看清楚了就直接写了常量。
- **`isolation`**：用 `CODEX_HOME` 指向临时副本真跑一次 `--version`，成功才记 `home_copy`。
  临时副本**不拷 `auth.json`**（凭据不进探针临时目录），只验「独立 HOME 能被采纳」。
- **`path_deny`**：真跑 `codex exec --help` 扫 deny 字样再下结论，`method` 按实测组织，
  **不写死版本号**（写死的那句话下个版本就是假的）。

### GLM-02 · 重要 —— 接受（含 AGY-04）

**裁决**：接受。两侧独立收敛于同一处。

`PROBE_MODEL` 是硬编码的 `deepseek-flash`，而 profile 取 `profiles[0]`（字典序第一）。
**本机恰好 deepseek 排最前，所以跑通了**——这是巧合不是设计。
换一台只装 `qwen.config.toml` 的机器，探针会拿 qwen 的 provider 去调 `deepseek-flash`，
而本步实测自己确认了「codex 不校验 model 是否在目录里」，请求必然失败，
落 `exec_headless_read_ok: false` 与假 blocker。

`execProbe` 的注释**自己精确描述了这类失败形态**（「表现为 headless 读不到文件，
看起来像能力缺陷，实则是探针自己配错了」），却只防了「不带 profile」那一半。

**落点**：遍历 profiles，用 `probeCodexModels(bin, <该 profile 的 catalog>)`
找第一个**目录里真有可用模型**的 profile，用它的目录里的模型做探针模型；
一个都找不到时记 null 并在 note 里写明「没有任何 profile 的目录里有可用模型」——
**归因写进 note，而不是落一个能力否定**。

### AGY-03 · 重要 —— 接受（含 GLM-06 的后半）

**裁决**：接受，改流式早退。

两侧独立给出同一建议：监听 stderr 数据块，五个标签凑齐立即 `killTree`——
这是手工 `| head -N` 靠 SIGPIPE 中断的**代码内等价物**。

收益是双重的：①耗时从 5 × 12s ≈ 60s 压到百毫秒级；
②把「可能已发出请求」压到接近零——这才是真正重要的那一半，
因为固定超时无论调到多少都只是在赌「请求还没发出去」。

**并且消掉一个经验常数**：12s 是我实测凑出来的，换台慢机器就会误杀（AGY-03 也点了这条）。
流式早退没有这个常数。

**落点**：`util/exec.ts` 的 `RunOptions` 补 `onStderrLine`（已有 `onStdoutLine` 先例）
与「回调返回 stop 信号即终止」的机制；`probeCodexHeader` 改用它。

### GLM-06 · 次要 —— 接受

**裁决**：接受。

`probeCodexHeader` 的 interface 级 docstring 写「零配额即可回读生效配置」，
调用点注释写「全部零配额（读 header 即中断）」，而函数体内我自己写着
「**不是零成本**……期间可能已经发出一次请求」。

**同一个函数里三处说法不一致，而 M8 抄配方时读的是前两处。**
我在函数体里改了说法，却没回头改 docstring 和调用点——
又是「改一处、漏同形」，与焦点三漏掉两处塌缩同源。

**落点**：三处统一为「低成本：进程活到超时，期间可能已发出一次请求」；
流式早退落地后再统一改成「近零成本：标签凑齐即终止」——
**按实现的实际状态写，不按期望写**。

### GLM-05 · 次要 —— 接受

**裁决**：接受。

`write.commands.length > 0` 在写入探针本身失败时（超时、provider 报错、
模型压根没尝试写入）`commands` 为空，被记成确定结论「被沙箱拒绝的命令不进事件流」。

审查员把它降为 minor 的理由准确：**塌缩方向偏保守**（少启用一道核验，
而不是放过一次 breach）。但它仍然是把「没测到」记成了确定事实。

**落点**：无 `finalText` → null；有 `finalText` 且其内容含被拒叙述、而 `commands` 为空
→ 才记 false。录制样本里这条结论正是靠模型自述「试了两条途径都被拒」才坐实的，
判据应当复现那个推理，而不是只看计数。

### AGY-05 · 次要 —— 接受

**裁决**：接受。

`PROBE_IMPLEMENTED` 仍是 `['agy', 'zcode']`。**上一轮 GLM-05 要求我写下
「接入下一家时必须同步这里」，这一轮我接入了 codex，第一个违反它的就是我自己。**

而且这条现在**不会红**：`unimplemented` = `[claude, codex]`，取 `[0]` 是 claude，
`runDoctor(only:'claude')` 走「未实现」分支 → 测试通过。
**语义已经错了（codex 已实现却被当成未实现），而机器没报警**——
这正是上一轮 GLM-05 预言的形态：「靠的是注册表排序与接入顺序的巧合，不是机制」。

**落点**：加 `'codex'`。同时在那段注释里补一句本次实例——
它是「为什么这里必须手工同步」的最好证据，而不是一句抽象的告诫。

### GLM-07 · 次要 —— 接受

**裁决**：接受。防护不对称说得准确。

事件流有「图谱变了就重录」的守卫（`codex-events.test.ts` 第一条用例），
header **一个测试都没有**——而 header 的五个标签拼写恰是本步真机第一遍就栽过的坑。
codex 升版把 `reasoning effort` 改成 `effort`，`pick()` 会全部返回 null、
五个派生字段集体变 null，**没有任何测试变红**。

**落点**：录一份真实 stderr header 进 `test/fixtures/codex-events/header.txt`；
为 `pick()` 补格式单测；README 的重录表加一行。

### AGY-06 · 次要 —— 接受

**裁决**：接受。

`defaultProbe` 里 `cli.agy` 与 `cli.zcode` 都补齐了专属字段，唯独 `cli.codex`
只有 `emptyCommonProbe()`。`CodexProbe` 的 11 个专属属性声明为**非可选**，
而未探环境下它们是 `undefined`——类型契约与运行期事实不符。

**落点**：`defaultProbe` 为 `cli.codex` 补齐空壳。

### GLM-08 · 吹毛求疵 —— 接受

**裁决**：接受，取「分成两个字段」。

`json_event_types` 的文档说是「`item.type` 图谱」，实际值是顶层事件类型与 item 类型
合并去重。两个名字空间混在一起后不可区分（`error` 是 item 类型、`turn.started` 是事件类型），
而消费方注释要的「新类型出现时提示重录样本」本应对 **item 类型**敏感。

取分字段而非改文档：解析器内部本来就维护着两个独立集合，合并是在赋值那一步做的——
**那一步才是多余的**。

### GLM-09 · 吹毛求疵 —— 接受

**裁决**：接受两处。

`readCatalogPath(bin)` 的 `bin` 被 `void bin` 弃用——那是我删掉一段凑数代码后留下的残骸。
且它只读基底 `config.toml`，而 C-1 恰恰确立了 profile 是**文件分层**，
`<name>.config.toml` 同样能设 `model_catalog_json`——活跃 profile 下实际生效的
目录文件可能不是基底那份。

**落点**：去掉死参数；按本次探针实际使用的 profile 文件回读，取不到再回落基底，
并在字段文档注明口径。

---

## 2. 修复清单

| 文件 | 改动 | 来源 |
| :--- | :--- | :--- |
| `doctor.ts` | 严重度分档矩阵（沙箱失守恒 blocker；未启用 CLI 缺失只 note；null 给 note） | GLM-03 / AGY-01 / GLM-01 |
| `probes/codex.ts` | `exec_headless_read_ok`、`rejected_command_in_trace` 改三态 | GLM-01 / GLM-05 |
| 同上 | 三处常量改真测（`trace_path_structured` / `isolation` / `path_deny`） | GLM-04 |
| 同上 | 按模型目录选 profile，替掉 `profiles[0]` | GLM-02 / AGY-04 |
| 同上 | 判据改差异比对，先保证基线可区分 | AGY-02 |
| 同上 | 改流式早退；三处「零配额」注释按实际状态改写 | AGY-03 / GLM-06 |
| 同上 | `json_event_types` 拆两个字段；`readCatalogPath` 去死参数、按 profile 回读 | GLM-08 / GLM-09 |
| `util/exec.ts` | `RunOptions` 补 `onStderrLine` 与早退机制 | AGY-03 |
| `types.ts` | 拆字段、`readCatalogPath` 口径注释 | GLM-08 / GLM-09 |
| `config.ts` | `defaultProbe` 补 codex 专属空壳 | AGY-06 |
| `test/unit/preflight.test.ts` | `PROBE_IMPLEMENTED` 加 `'codex'` + 补本次实例 | AGY-05 |
| `test/fixtures/codex-events/` | 录 header 样本；README 重录表加行 | GLM-07 |
| `test/unit/codex-events.test.ts` | 补 `pick()` 格式单测 | GLM-07 |

**变异验证**：GLM-03、GLM-01、AGY-01、GLM-04、AGY-02 五条逐条做。
其中 GLM-03 的变异要**真的造一次失守**（把负对照的判据改成恒为 false），
确认 blocker 真的出现——这条是安全判定，不能只验「代码改了」。

---

## 3. 两侧共同确认、本次不动的部分

- **11 个字段的消费方注释是 EV-06 的正解**，不算另一种形式的登记不接线（焦点一）。
- **C-2 的证明边界分寸恰当、不保守**（焦点四）：模型目录是本机配置工具生成的文件、
  header 显示的是客户端准备发送的值，两个证据源都推不出服务端行为；
  `effort_effective` 暂不动、待服务端回包证据，「比按本机目录就删字段稳」。
- **C-1 的实测与连锁分析**（按 `[profiles.*]` 取名单恒为空 → 未知 profile 拦截静默失效）。
- **真跑录制样本 + 两条锁事实用例**，含「哪天红了说明盲区消失、该回头启用轨迹核验」
  的正向解读；「in_progress 不算证据」的防翻倍用例。
- **调用配方注释**（header 在 stderr、stdin 显式给空、`killTree` 必开、
  `-s read-only` 显式传不靠默认）写在了 M8 复用时一定会读的位置。
- **doctor 接线与 agy/zcode 同构**：`checkpoint` 增量落盘、`existing` 保留语义。
- **`registry-parity` 对 `probes/codex.ts` 的豁免理由属实**（GLM 已核注册表与 zcode 实况）。
- **三处 header 判据的三态化本身正确**，`unknown_profile_rejected` 以「基底那次读得到
  header」为前提条件更严谨——漏的是另外两处（GLM-01 / GLM-05），不是这三处本身。
