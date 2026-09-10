---
schema: trivium.disposition.v1
topic: M3-隔离证据与预检
stage: plan
role: claude
kind: revised
run_id: 20260910T234258Z
addresses:
  - 2026-09-11-M3-隔离证据与预检-r2-gemini.md
  - 2026-09-11-M3-隔离证据与预检-r2-glm.md
---

# M3 实施计划（修订版）：隔离、证据、降级、模型路由与预检

> - **作者**：Claude Code（Driver）
> - **日期**：2026-09-11
> - **本件性质**：对第 2 轮双审 14 条意见的逐条裁决 + 据此修订的实施计划
> - **原稿**：[`2026-09-11-M3-隔离证据与预检-claude.md`](./2026-09-11-M3-隔离证据与预检-claude.md)（保留，未改写）
> - **双审**：[`-r2-gemini.md`](./2026-09-11-M3-隔离证据与预检-r2-gemini.md)（6 条）、[`-r2-glm.md`](./2026-09-11-M3-隔离证据与预检-r2-glm.md)（8 条）

## 0. 裁决总览

14 条**全部接受**。其中三条指出的是**已提交代码里的真 bug**，不是计划的表述问题：

- **GLM-02**：M2 交付的 `dual-run/SKILL.md` 第 1 步写死 `preflight --stage all`，
  而 `Stage` 类型与 `parseStage` 只收 `plan|code|bug` → 命令 A 在自己的第一步就退 64。
  这是我在 M2 写 SKILL.md 时凭想象写下的参数，没有对照类型定义。
- **GLM-07**：`persistProbe` 是对 `config.local.yaml` 的无锁读改写。
  我自己在 `lock.ts` 的头注释里写着「原子替换只防撕裂不防丢更新」，
  在实现 GLM-08 的修复时又犯了同一个错——这已经是第三次。
- **GLM-01**：`--model-*` 覆盖参数没有任何校验执行点，§7.3 承诺的「退 64 并列出可用值」永不触发。

两侧的互补很明显：gemini 从**契约边界**入手（零工件的路径枚举、topic resolve 的
stage 差异、桩适配器的跨进程注入），ZCode 从**已有代码的实际行为**入手
（Stage 类型不收 all、routeModel 只透传、probe.auth 结构无处安放版本字段）。
共同命中「零工件保证覆盖不全」与「自动 doctor 会击穿工具超时」两处，均已接受。

## 1. 逐条裁决表

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| AGY-01 | gemini | blocker | 接受 | 确认成立。零工件保证是跨`preflight`/`topic resolve`/`review --start`**三个独立进程**的问题，我只考虑了 `prepareRun` 一处。归档根可写性探测若在目录不存在时直接创建 `.reviews/` 更是自己制造工件 | 修订版 §3.1 改为三层零工件契约，逐个进程给出约束 |
| AGY-02 | gemini | blocker | 接受 | 确认成立且比我想得深。ZCode 版本长期不变但可用性取决于 `~/.zcode/cli/config.json`（坑 P-08/P-10）；Antigravity 的只读保障取决于 Agent 定义文件存在。只按 CLI 版本做缓存键会假阳性放行 | 修订版 §1.2 定义缓存记录形态：`checked_at` + `cli_version` + 配置指纹 + 结论；加 `--refresh-auth` 穿透 |
| AGY-03 | gemini | major | 接受 | 确认成立。预检是被 skill 在**非交互**的 Bash 工具里调用的，"触发前告知预计耗时"这个对策根本无处可告知，而完整 doctor 会击穿 600s。与 GLM-08 指向同一处 | 修订版 §1.3 改为**快速失败**：探针过期直接退 69 并指引手动跑 doctor，不在预检里隐式拉起 |
| AGY-04 | gemini | major | 接受 | 确认成立。命令 A 调 `topic resolve` 时原稿还不存在（S1 才起草），code 阶段又没有单一 subject 文件。原稿把三种 stage 当同一种处理 | 修订版 §2 按 stage 分别定义输出契约 |
| AGY-05 | gemini | minor | 接受 | 确认成立。`rebuildContext` 里硬编码了真实适配器，只在测试主进程替换 `CriticAdapter.run` 对派生的 worker 无效——桩适配器方案会静默失效，测试看似通过实则没注入 | 修订版 §4 定义 `TRIVIUM_STUB_CRITIC` 环境变量注入机制 |
| AGY-06 | gemini | nit | 接受 | 确认成立。`location` 是自由字符串，两家格式各异（`:88` vs `:85-92`，`plan §3.2` vs `§3.2`），直接算字符串交集必然失真 | 修订版 §3.3 在计算前加位置归一化 |
| GLM-01 | glm | major | 接受 | 确认成立，且这是**已提交代码的缺陷**：`routeModel` 只透传不校验，`cmdReview` 解析覆盖后也没校验，独立 `preflight` 又看不到步骤 3 才传的覆盖值。§7.3 承诺的退 64 永不触发 | 修订版 §1.4：`review --start` 与同步 `review` 在 `prepareRun` **前**内嵌 slug 校验，按「本次实际生效模型」执行 |
| GLM-02 | glm | major | 接受 | 确认成立，**M2 交付的 SKILL.md 有真 bug**。我凭想象写下 `--stage all` 而没有对照 `Stage` 类型定义。照现状实现，命令 A 第一步必退 64 | 修订版 §1.1 给 `--stage all` 定义语义并为 preflight 单设参数解析；同时修 `dual-run/SKILL.md` |
| GLM-03 | glm | major | 接受 | 确认成立，与 AGY-01 同一处但更具体地指出了 TOCTOU：步骤 1 通过不保证步骤 3 复检仍通过（auth 缓存跨 1h、agy 自升级 P-02、归档根被删），此时预检失败而目录已由步骤 2 创建 | 与 AGY-01 合并落在修订版 §3.1；`topic resolve` 定为纯只读 |
| GLM-04 | glm | minor | 接受 | 确认成立。`prepareRun` 在预检通过后仍有提前返回：`locateSubject` 抛 65、逐侧循环内 `routeModel` 抛 69——此时第一侧的 brief 已写出。我自己在那段代码上写了「避免产生半套工件」的注释，实现却没做到 | 修订版 §3.1 改为「先全部算、再统一写」 |
| GLM-05 | glm | minor | 接受 | 确认成立。auth 缓存写发生在检查 6-8 之前，后面任一项失败时 `config.local.yaml` 已被整文件重写。AC-16 的验证措辞是「检查无任何文件生成」，与实际不符 | 修订版 §1.2 把缓存写推迟到全部检查通过之后；§3.2 明示可写探测用无残留方式 |
| GLM-06 | glm | minor | 接受 | 确认成立。`probe.auth` 现有结构只有两个时间戳，版本字段无处安放，实现者最自然的做法就是只比时间戳。失败结论是否入缓存也未定义——入缓存会把「登录后修复」挡在 1h 之外 | 修订版 §1.2 定义记录形态；**只缓存正结论**，失败探活本身快且便宜 |
| GLM-07 | glm | minor | 接受 | 确认成立，且是我第三次犯同类错误。`persistProbe` 无锁读改写，两个并发 preflight 会互相丢更新；两侧都判过期还会各触发一次 doctor 双烧配额 | 修订版 §1.5：缓存写与探针回填一律经 `withGlobalLock`（现成设施） |
| GLM-08 | glm | minor | 接受 | 确认成立，与 AGY-03 汇合。R-B 的「告知预计耗时」救不了工具超时；且 doctor 只在结尾一次性 `persistProbe`，被杀时配额已烧而探针一字未落盘 | 与 AGY-03 合并：不自动拉起全量 doctor。另把 `doctor` 改为**分段落盘**（每完成一侧就写一次），使中途被杀也不白烧 |

**统计**：接受 14 ｜ 驳回 0 ｜ 暂缓 0。共同命中项（AGY-01+GLM-03、AGY-03+GLM-08）均已接受。

---

## 2. 修订后的 `preflight`

### 1.1 `--stage` 的取值与解析（GLM-02）

`preflight` 单独解析 `--stage`，取值为 `plan | code | bug | all`。
**不扩展 `Stage` 类型**——`all` 不是一个审查阶段，把它塞进 `Stage` 会污染
`timeout_s` / `min_tool_calls` 等按阶段索引的配置。新增 `PreflightScope = Stage | 'all'`。

`--stage all`（命令 A）的语义：
- 校验 active profile 下**全部三个阶段**两侧的模型 slug；
- 执行「`verify.build` / `verify.test` 皆空则拒绝启动」检查；
- 跳过单阶段专属项（如「`plan` 阶段原稿是否存在」——命令 A 的 S1 才起草）。

同时修 `skills/dual-run/SKILL.md`：它当前写死的 `preflight --stage all` 在实现后才成立。

### 1.2 探活缓存的记录形态与失效规则（AGY-02 / GLM-05 / GLM-06）

`probe.auth` 从两个裸时间戳改为逐侧结构体：

```yaml
probe:
  auth:
    agy:   { checked_at: …, cli_version: "1.2.0", fingerprint: "<agent.md 的 sha256>", ok: true }
    zcode: { checked_at: …, cli_version: "0.16.5", fingerprint: "<config.json 的 sha256>", ok: true }
```

失效规则（任一成立即失效）：
1. 超过 `preflight.auth_cache_ttl_h`（默认 1h）；
2. `cli_version` 与当前实测不符（治 agy 自升级，坑 P-02）；
3. `fingerprint` 不符——Antigravity 取只读 Agent 定义文件的哈希，
   ZCode 取 `~/.zcode/cli/config.json` 的哈希（治 provider/apiKey 被改，坑 P-08/P-10）。

**只缓存正结论**（GLM-06）：失败探活本身快且便宜，缓存负结论会把「用户交互登录修复后」
挡在 1h 之外，而 `--skip-auth-check` 是跳过而非刷新、缓存依然是脏的。
另加 `--refresh-auth` 显式穿透（AGY-02）。

**缓存写推迟到全部检查通过之后**（GLM-05），使「预检失败 ⇒ 零写入」成立。

### 1.3 探针过期：快速失败，不隐式拉起 doctor（AGY-03 / GLM-08）

探针过期或 CLI 版本不符时**直接退 69**，输出里明确指引：

> 探针结论已过期（generated_at …，超过 probe_ttl_days=7）或 CLI 版本已变（1.1.27 → 1.2.0）。
> 请手动运行 `trivium doctor` 重新校准（约需 2~4 分钟，会消耗少量厂商配额），然后重试。

理由：预检被 skill 在**非交互**的 Bash 工具里调用，无处告知也无从等待确认；
完整 doctor 会击穿 600s 工具超时，届时配额已烧而探针一字未落盘。

**附带改进 `doctor`：分段落盘。** 现在它只在结尾一次性 `persistProbe`，
中途被杀就白烧。改为每完成一侧（env / agy / zcode）就写一次，
使部分结论得以保留。

### 1.4 模型 slug 校验的执行点（GLM-01）

校验必须按「**本次实际生效**的模型」执行，数据源用 `probe.agy.models` 与
ZCode 模型目录。两个执行点：

1. 独立 `preflight` 命令：校验 active profile 中该 scope 下的 slug；
2. **`review --start` 与同步 `review` 在 `prepareRun` 之前内嵌同一套校验**，
   此时 `--model-gemini` / `--model-glm` 覆盖值可见。

非法即退 **64** 并列出可用值（§7.3 的承诺至此才真正成立）。

### 1.5 预检自身的写入串行化（GLM-07）

`persistProbe` 与探活缓存写一律经 `withGlobalLock`（`lock.ts` 现成设施）。
理由与 `state.json` 相同：`config.local.yaml` 是全局单文件，原子替换只防撕裂不防丢更新。

---

## 3. `topic resolve`：按 stage 分别定义契约（AGY-04 / GLM-03）

**纯只读命令**：只做 `validateTopic` 与定位，**严禁** `ensureDir` 或任何写操作。

| `--stage` | `subject_path` | 备注 |
| :--- | :--- | :--- |
| `plan` / `bug` | 必须定位到原稿，找不到退 65 并列出候选 | 目录不存在时容忍，不创建 |
| `code` | `null`，改输出 `base` 引用与 `diff_available` 布尔 | 被审对象是 diff，不是单一文件 |
| `all`（命令 A） | `null` | S1 才起草，此时原稿必然不存在 |

参数解析（确定性工作，不交给模型——原则 P1）：从 `` 切出具名参数
`--topic` / `--context` / `--plan-file` / `--rca-file` / `--base` / `--model-*` / `--profile`，
其余正文即 `prompt_hint`。**统一 `--focus` 与 `prompt_hint` 的对应关系**（AGY-04）：
skill 传 `--focus`，编排器内部字段名一律 `prompt_hint`。

---

## 4. 零工件保证：三层契约（AGY-01 / GLM-03 / GLM-04）

| 进程 | 约束 |
| :--- | :--- |
| `preflight` | 归档根可写性探测用**无残留方式**：目录存在则 `access(W_OK)`；不存在则检查**父目录**权限，**严禁创建** `.reviews/`。缓存写推迟到全部检查通过之后 |
| `topic resolve` | 纯只读，无任何写操作 |
| `review --start` / 同步 `review` | **先全部算、再统一写**：定位被审对象 → 两侧 `routeModel` → 两侧 `freeze` → 渲染两份 brief **到内存**；全部成功后才 `ensureDir` → `writeMeta` → 建运行目录 → 写 `run.json` |

第三条解决 GLM-04 指出的「第一侧 brief 已写、第二侧 `routeModel` 抛错」留半套工件的问题。

**AC-16 的验证措辞需同步修正**（GLM-05）：从「检查无任何文件生成」改为
「`.reviews/` 与 `~/.trivium/runs/` 下无任何新增；`config.local.yaml` 作为本机探针缓存
在预检**通过**后才写」。这属按 §16.2 纪律 1 回补修订设计文档的项。

---

## 5. 桩适配器的跨进程注入（AGY-05）

`rebuildContext` 里硬编码了真实适配器，只在测试主进程替换 `CriticAdapter.run`
对派生的 worker **完全无效**——测试会看似通过实则没注入任何故障。

方案：环境变量 `TRIVIUM_STUB_CRITIC` 传入 JSON 注入配置（形如
`{"gemini":{"mode":"timeout"},"glm":{"mode":"no_tools"}}`），
适配器工厂在**该变量存在时**返回桩实现。`spawnDetached` 会继承环境变量，
因此 worker 内的 `rebuildContext` 能拿到同一份注入配置。

安全边界：该变量只在测试里设置；生产路径若检测到它，**打醒目告警**
（避免有人误用它伪造审查通过）。

---

## 6. 双审退化指标的位置归一化（AGY-06）

计算 Jaccard 前先归一化 `location`：
- 提取相对路径部分（`src/a.ts:88` → `src/a.ts`）；
- 行号做区间重合判定而非字符串相等（`:88` 与 `:85-92` 视为同一处）；
- 章节标记去前缀并标准化（`plan §3.2` 与 `§3.2` 视为同一处）。

M1 首次双审实测原始 Jaccard = 0.43，归一化后应更高但仍应远低于 0.8 阈值。

---

## 7. 测试规划（据意见补充）

| 交付物 | 测试文件 | 关键场景 |
| :--- | :--- | :--- |
| `preflight` | `test/unit/preflight.test.ts` | 八项检查各自失败的退出码；**`--stage all` 的语义**（GLM-02）；探针过期直接退 69 且不拉起 doctor（AGY-03）；缓存因 CLI 版本变化失效、因配置指纹变化失效（AGY-02）；**只缓存正结论**（GLM-06）；缓存写在全部检查通过之后（GLM-05） |
| slug 校验 | 同上 | **`--model-*` 覆盖非法 → 退 64 并列出可用值**（GLM-01） |
| `topic resolve` | `test/unit/topic-args.test.ts` | 参数切分（引号、中文、提示语正文里出现 `--`）；三种 stage 的 `subject_path` 契约（AGY-04）；**resolve 新主题后 `.reviews/` 下无任何新增**（GLM-03） |
| 零工件 | `test/integration/no-artifacts.test.ts` | 预检失败、`locateSubject` 失败、第二侧 `routeModel` 失败三条路径，均断言 `.reviews/` 与 `~/.trivium/runs/` 零新增（GLM-04） |
| 并发 | `test/unit/preflight.test.ts` | 两个并发 preflight 的缓存写不丢更新（GLM-07） |
| 桩适配器 | `test/integration/fault-injection.test.ts` | 经 `TRIVIUM_STUB_CRITIC` 注入，**且断言 worker 进程真的用了桩**（AGY-05） |
| 位置归一化 | `test/unit/divergence.test.ts` | `:88` vs `:85-92`、`plan §3.2` vs `§3.2`（AGY-06） |

---

## 8. 需要回补修订设计文档的项

| 设计位置 | 需修订内容 | 来源 |
| :--- | :--- | :--- |
| §8.1 预检表 | 需增 `--stage all` 的语义；「探针过期自动触发一次 doctor」应改为快速失败并指引手动执行 | GLM-02 / AGY-03 / GLM-08 |
| §13.1 `probe.auth` | 结构从两个时间戳改为逐侧 `{checked_at, cli_version, fingerprint, ok}` | AGY-02 / GLM-06 |
| §15.3 AC-16 验证方式 | 「检查无任何文件生成」应细化为「`.reviews/` 与 `~/.trivium/runs/` 零新增；`config.local.yaml` 在预检通过后才写」 | GLM-05 |
| §11.5 模型路由 | 需补「slug 校验的执行点在 `review --start` 内嵌预检，按本次实际生效模型执行」 | GLM-01 |
