---
schema: trivium.disposition.v1
topic: Windows原生移植
stage: code
role: glm
kind: response
run_id: 20261020T074334Z
addresses:
  - 2026-10-20-Windows原生移植-claude.md
  - 2026-10-20-Windows原生移植-codex.md
---

# 逐条应答：Windows原生移植 · code 阶段 · 第 1 轮

前置说明两条：

1. **codex 侧证据不足的告警已知悉**（`evidence_ok: false`，其本会话 shell 被 `-s read-only` 沙箱策略全量拒绝、任务书内嵌 diff 截断）。其代码级主张本人在 Driver 侧逐一核实后才裁决：CODEX-02/03 与 claude 侧 CLAUDE-08/02 相互印证，采纳；纯文档面主张（CODEX-01/05/06/07）按文档核验裁决。
2. 接受项的落点在人工审批后实施（`dual-approve` 后动码），本件只裁决不动码。

| 意见编号 | 来源 | 严重度 | 裁决 | 理由 | 落点 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| CLAUDE-01 | claude | major | 接受 | 属实：旗标空 + enforced=false 时可用性放行，而运行时 `readonlyArgsFromProbe([])` 连 `-s read-only` 都不传——prompt-only 宣称的「旗标照传」最弱保障都不存在，只剩 BRIEF 措辞，构成 fail-open。该分支是本 Driver 1.2.1 为「旧策略下探测」留的过渡豁免，审查员指出的代价成立：豁免必须以旗标已落盘（非空）为前提 | `adapters/codex.ts` availability：旗标为空一律 ok:false（豁免仅覆盖「有旗标 + enforced=false」）；`test/unit/codex-adapter.test.ts` 对应用例由「放行+重探提示」翻为拒绝 |
| CLAUDE-02 | claude | major | 接受 | 属实：watcher 基线取安装时刻，spawn→安装窗口内 `settleOrphanedStart`/极快 `--cancel` 写的旗标被永久忽略，worker 丢优雅收尾只剩硬杀；基线应取 worker 诞生时刻（`onSpawned` 已记录），另对「旗标存在但被判旧」留显式痕迹 | `run-protocol.ts` installWorkerCancelFlagWatcher：基线改为 worker 诞生时刻（或安装时刻减保守回退量），stale-but-present 记一条 worker 日志；FAT 2 秒粒度随基线前移一并缓解 |
| CLAUDE-03 | claude | major | 接受 | 属实：三条失败路径回退无龄期上限的陈旧缓存，违背模块自述「失败返回 null」；pid 复用 + 旧表 CreationDate 吻合 → 误判同一进程 → taskkill 无辜树。陈旧缓存是另一种猜 | `util/platform.ts` enumerateWinProcesses：失败路径不再回退陈旧缓存（或加秒级显式龄期上限，超限视同 null）；`test/unit/platform-win.test.ts` 补失败路径断言 |
| CLAUDE-04 | claude | major | 接受 | 属实：verbose 阴性对照未线程化 settingsEnv，网关机器上因认证失败落 vacuous true，回归哨兵失效无提示——与 execProbe/projectMemoryArmArgs 的注入不一致，属 1.2.0 改造遗漏 | `probes/claude.ts` verboseNegativeControlArgs 经 routeContext 注入 settingsEnv（与 execProbe 同源） |
| CLAUDE-05 | claude | minor | 接受 | 属实：`../` 或含分隔符的 catalogRef 会把拷贝目标落到 codexHome 之外，逃出 scrub 清单作用域。触发需用户自伤配置，但修复廉价 | `adapters/codex-home.ts`：只接受裸文件名（拒绝含 `/`、`\`、`..` 的取值，不等则告警跳过）；`test/unit` 补一格 |
| CLAUDE-06 | claude | minor | 接受 | 属实：逐值脱敏只覆盖 invokeClaude 路径、探针臂 raw 输出不覆盖，与 1.2.0「注入值永不落盘」的威胁模型不对称 | `probes/claude.ts` execArgv/execProbe：settingsEnv 存在时对 commandLine/stdout/stderr 先逐值替换再交模式脱敏（与 invokeClaude 同一 scrub） |
| CLAUDE-07 | claude | minor | 暂缓 | 方向成立（跳过清单覆盖本批改动面、等价锚点不足），但逐文件 win32 适配是登记在案的 §3.1-6 大块工作，不属于本轮收口射程；本轮先把优先级写实 | `doc/08_project/现存Bug与未完成工作清单.md` §3.1-6：把 verify 分发、freeze 落盘域、init 包装三处列为首批 win32 锚点用例的明确条目 |
| CLAUDE-08 | claude | minor | 接受 | 反例成立：跨平台共享 checkout（exFAT/云同步）下异平台形态记录被静默判「不同一进程」，方向恰是最坏侧。修复面小 | `util/exec.ts` processMatchesRecord：对记录做形态识别（UTC ISO 形态 vs ps lstart 形态），异平台形态判 unverifiable 而非不同一；`test/unit` 补交叉形态两格；§7.1 补一句兜底口径 |
| CLAUDE-11 | claude | minor | 暂缓 | 残余通道属实（APPDATA/LOCALAPPDATA 未重定向，写穿污染宿主而非泄密）；但重定向可能破坏厂商 CLI 的既有行为，不宜在本轮盲改 | `doc/08_project/现存Bug与未完成工作清单.md` §3.1 新增登记：隔离环境 APPDATA/LOCALAPPDATA 残余通道，评估后处置 |
| CLAUDE-09 | claude | nit | 接受 | 属实，src 内全覆盖唯发布脚本漏一处，一行修复 | `scripts/package-release.mjs`：execFile 补 `windowsHide: true` |
| CLAUDE-10 | claude | nit | 接受 | 「零变化」强表述与无平台门控的归一确有缝隙；取文档口径微调而非加门控（加 IS_WIN 门控反而制造两平台匹配语义分叉，与 toDomainRel 同域取舍一致） | `util/fsx.ts` 注释与设计说明书「路径域」段：把「零变化」限定为「对真实路径输入零变化」 |
| CODEX-01 | codex | major | 接受 | 属实：五个 zcode 测试文件的 WIN_FILE_SKIP 模板注释统一声称「等价语义见 platform-win.test.ts 与取消标记用例」，对凭据不出输出/选模落实这类文件级语义不成立，注释虚报覆盖 | 五个 zcode 测试文件的 skip 注释逐文件改写：如实写「无 win32 等价物，残余见 Bug 清单 §3.1-6/2」；`scripts/win-test-skip.mjs` 注释里加「等价落点必须真实存在」的人工核对提醒 |
| CODEX-02 | codex | major | 接受 | 与 CLAUDE-08 同根（盘上同名字段复用的论证缺「异形态一律 unverifiable」兜底），合并处置 | 同 CLAUDE-08 落点；另 §7.1「进程身份」段论证改为「两形态互斥 + 解析不了判 unverifiable」 |
| CODEX-03 | codex | major | 接受（部分） | 时序三形态中 (a) 时钟回拨的「新标记被判旧」由 CLAUDE-02 的基线前移实质缓解，合并处置；(b) 末次轮询后标记、(c) 强杀后凭据兜底归设计边界，本轮登记不改码 | CLAUDE-02 落点 + §7.1「worker 优雅取消」补两句：错过优雅收尾被强杀时凭据抹除依赖运行根保留期整删兜底；残余登记 §3.1 |
| CODEX-04 | codex | minor | 接受 | 需核实后处置：`trivium.cmd` 为 `@echo off` + node 绝对路径，若未加引号则含空格/`&`/`%` 的安装路径确有分词与变量展开风险 | `src/trivium/init.ts`：核实并给路径加引号与 `%` 转义（或对含元字符路径显式报错）；§7.1「shell 与 wrapper」补口径一句 |
| CODEX-05 | codex | minor | 接受 | 属实：需求说明书停在 1.1.0，网关注入与 prompt-only 两项行为承诺无需求侧落点，两份稳定版文档口径分叉 | `doc/01_requirements/稳定版需求说明书.md`：补两小段（网关注入的凭据边界、prompt-only 适用条件与平台限制）并对齐版本口径 |
| CODEX-06 | codex | minor | 接受 | 属实：「不落留痕」写成了断言，截断/折行/再编码形态的泄漏面未登记 | §7.1「第三方网关」段：口径改为「原串逐值替换 + 模式脱敏，变形泄漏面与既有脱敏口径同一、登记为残余」 |
| CODEX-07 | codex | nit | 接受 | 属实：路径域段对链接语义零着墨，焦点⑥点名的 `/private` 与 win 分支链接规范化未交代 | §7.1「路径域」段补一句：链接规范化两平台口径（核实现状后如实写「做/不做」），`/private` 语义 POSIX 分支逐字保留一句带过 |

## 修改方案汇总

审批通过后按以下顺序实施（一次提交收口 1.2.2）：

1. **安全面**（CLAUDE-01/03/05/06）：availability fail-closed、枚举失败不回退陈旧缓存、catalogRef 收裸名、探针臂逐值脱敏；
2. **时序面**（CLAUDE-02 ≡ CODEX-03a）：取消旗标基线改 worker 诞生时刻 + stale 痕迹；
3. **身份契约面**（CLAUDE-08 ≡ CODEX-02）：异形态记录判 unverifiable + 交叉形态用例 + §7.1 论证补全；
4. **探针正确性**（CLAUDE-04）：verbose 阴性对照线程化 settingsEnv；
5. **边角**（CLAUDE-09/10、CODEX-04）：windowsHide 补漏、口径措辞、cmd 垫片引号核实；
6. **文档与登记**（CODEX-01/05/06/07、CLAUDE-07/11、CODEX-03b/c）：zcode skip 注释改写、需求说明书补段、残余登记更新。

暂缓两项（CLAUDE-07/11）已登记去向，不阻塞本轮收口；无驳回项。
