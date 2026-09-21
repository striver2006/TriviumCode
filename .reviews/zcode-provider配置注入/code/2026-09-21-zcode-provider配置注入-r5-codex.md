---
schema: trivium.review.v1
topic: zcode-provider配置注入
stage: code
role: codex
vendor: openai
agent_cli: codex/0.155.1
model_requested: qwen3.8-flash
model_effective: qwen3.8-flash
model_effective_source: trace
model_route: config_copy
run_id: 20260921T091034Z
rerun_index: 5
snapshot_hash: sha256:95e0747d4a43acff655b376fce7e995f04e550696496d2fb8f1f043463e25451
blind: true
started_at: 2026-09-21T09:10:35.311Z
finished_at: 2026-09-21T09:24:47.861Z
duration_s: 853
tool_calls:
  run_command: 35
  project_reads: 20
evidence_ok: true
verdict: approve-with-nits
findings_count:
  blocker: 0
  major: 0
  minor: 3
  nit: 3
degraded: false
parse_fallback: false
peer_deny: false
drift: false
consulted_unverified: true
readonly_verification: unavailable
path_verification: unavailable
heterogeneous: true
session_id: 01a0c33b-40bc-7771-99fd-d542bb17ff29
---

# 代码审查：zcode-provider配置注入

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260921T091034Z` ｜ 第 5 轮
> ｜ 本轮审核者 codex、gemini

> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 总判断

本收口轮可以提交：焦点①的判据换向方向正确且失败模式可接受（fail-closed 只损失新鲜度，比误放写失真结论好），焦点②三个消费方全部跟上、EV-84 的两轮不同成因我复解析本侧 _meta 原文逐条证实，焦点③两条 doctor 用例在无 ZCode 机器上不会红（假入口自洽，环境段只依赖 node+git），焦点④的驳回理由站得住。共 6 条意见，最重的是布局判据未按实测 CLI 版本门控（CODEX-01），与纪律 1「读探针结论、不硬编码厂商行为」直接相关；其余为旗标探针退 0 无告警（CODEX-02）、结论冻结在 preflight 面不可见（CODEX-03）与三条 nit。无 blocker、无 major。

**结论**：`approve-with-nits`

## 审查意见（共 6 条：次要 3 ｜ 吹毛求疵 3）

### CODEX-01 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/zcode.ts:465（availability 布局支）与 src/trivium/doctor.ts:522（布局 blocker）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：「内置 provider 配置探过且缺失 ⇒ 该侧不可用 / doctor 无条件拦」这条判据没有按 CLI 版本门控。设计自己把该断言限定在 0.16.9（§3.5 行「内置缺失则 0.16.9 独立拉起必失败」；M0 P-28 明写 0.16.5 无此问题、最近成功留痕就是 0.16.5），但代码读的是 provider_config.builtin_file === null 一个事实、不看同格对象里现成的 version。症状：0.16.5 或非应用包布局的机器、以及未来某版把内置文件挪走/不再需要它时，glm 侧被 availability()（preflight 与 review.ts 都消费它）判不可用、doctor 出误导性的「请核对安装布局」blocker——而注入路径（zcodeProviderEnv）本身是版本中立的、不注入也能跑。这正是纪律 1 禁止的「把某版本厂商行为硬编码成普适判据」。

**依据**：读 src/trivium/adapters/zcode.ts（availability() 布局支的注释与严格 === null 判据，同一 ZcodeProbe 对象含 version 字段）、src/trivium/doctor.ts:510-541、src/trivium/preflight.ts:457-484 与 src/trivium/review.ts:588（availability 的消费方）、被审补丁内设计 §3.5 行与 M0 报告 P-28 行。

**建议**：布局支加版本门控：按 probe.version 判「>= 0.16.9」才走该分支（版本比较的取值同样来自探针结论，符合纪律 1）；若认为当前装机全在 0.16.9 不必做，至少在 HINT 文案与设计 §3.5 行把那版本前提写成「判据以 0.16.9 实测为据，旧版/新版布局可能误拦」，并登记 BACKLOG 触发条件（下一次动 availability 或 CLI 升版）。

### CODEX-02 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts:169-172（probeReadonlyFlags 正向证据支）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：旗标探针把 r.code === 0 记「接受」在逻辑上成立（跑完全程必然吃完 argv），但被这个探针的装置形态漏掉：它的零配额不变量恰是「空 HOME + 只给内置 ⇒ 必停在 Model creation failed 退 1」（P-30 实测）。在这条路径上出现退 0，唯一现实解释是一次完整 headless 运行发生了、真实模型调用烧掉了配额——判据把它静默记成接受，note / warnings / 结论文件零信号。r3 为「turn 里 3 分钟不退」的形态加了 killTree（超时被杀 ⇒ code null ⇒ indeterminate，会被看见），「跑完并成功」这个同族形态反而无人说话。

**依据**：读 src/trivium/probes/zcode.ts:116-145（空 HOME 前提与 killTree 注释）、169-172；M0 报告 P-30 行（只给内置那份「则停在 Error: Model creation failed 退 1」——退 0 不在实测停点集内）；r4 留痕（evidence/zcode-provider-config-20260920/r4-implementation-doctor-20260921.md「未验到」清单）。

**建议**：接受 r.code === 0 的结论不变，但当它出现时同时 push 一条 note（并考虑进 warnings）：「旗标探针出现退 0——空 HOME 停在模型层的假设（P-30）已被打破，本轮疑似发生 N 次真实模型调用，请核对停点形态」。一行判断，把成本异常变得可见。

### CODEX-03 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts:343-347（flagsIndeterminate 不落盘的自述）+ src/trivium/types.ts:323-335（ZcodeProbe）` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | medium |

**问题**：焦点①的失败模式整体可接受，但告警面只有一半：正向证据列表自述「必然不完备」，一旦真实停点文案漂移，readonly_flags 从此冻结——而「本轮未判定」这个事实不落盘（r3 裁决：过程状态落盘会过期，这个理由本身对），所以只有跑 doctor 的人能看见；此后每一次 preflight / 每一次审查运行都静默消费着上一轮的旧旗标结论，零信号。结论文件里的 probed_at / generated_at 在「判成」与「未判定」两种轮次都刷新，读侧无从区分「旗标结论新鲜」与「已冻结多轮」。

**依据**：读 src/trivium/probes/zcode.ts（flagsIndeterminate 的定义注释与 probeZcode 各 return 路径）、src/trivium/doctor.ts:525-541（warning 只在 doctor 运行当期存在）、adapters/zcode.ts availability()（读盘上 readonly_flags，无新鲜度判据）、ZCODE_ARGV_PARSED_RE 注释（「这条列表必然是不完备的」）、r4 留痕的「未验到：别的机器/别的 CLI 版本上的覆盖度」。

**建议**：落一个不依赖记性、也不是过程状态的持久事实：readonly_flags_decided_at（上一次旗标判定完成时刻，仅在该轮 indeterminate 为空时刷新）。availability()/preflight 在它明显落后 probed_at 时出一条降级提示。这不违反 r3「本轮未判定不落盘」的裁决——落的是判定发生过的时刻，不是当轮状态。可随下一次动探针实施，不必卡本轮提交。

### CODEX-04 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts:75-78（probeZcodeEntry 的 run 调用）` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：version 探针的 run 是全仓唯一没开 killTree 的厂商 CLI 拉起：其余四处（invokeZcode、agy/codex/claude 适配器、旗标探针）一律 killTree: true，r3 CODEX-F01-04 的注释还写着「exec.ts 要求拉起厂商 CLI 一律打开」。60s 超时到来时只杀直接子进程；而 P-29 已经证明这个 CLI 的演化方向是把 provider 定位挪得更早，哪天 version 臂也开始派生子进程，超时就留下孤儿进程继续跑。本轮刚给这个函数加了清两个键（CODEX-F01-01），顺手补齐口径的成本是一行。

**依据**：grep killTree src/trivium 全量比对（probes/zcode.ts:145 有、:75 无；adapters/zcode.ts:259、adapters/agy.ts:113、adapters/codex.ts:112、adapters/claude.ts:411 均有）；src/trivium/util/exec.ts 的 killTree 选项说明。

**建议**：给 probeZcodeEntry 的 run 加 killTree: true；若刻意豁免（version 实测不起子进程），在注释里写明豁免理由，免得读侧以为是漏网。

### CODEX-05 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts:433-448（hostPreset note）；test/unit/zcode-provider-env.test.ts（无用例）` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：焦点④的后半：我认为算缺口，且 §五 判断 3 给出的理由不成立——「要摆形态就得改测试进程自身的环境」在同文件里已经被做了：「诱饵变量清除」用例本身就设置并复位 process.env[ZCODE_BUILTIN_PROVIDER_ENV] / [ZCODE_PERSONAL_PROVIDER_ENV]。这条 note 是 RUNBOOK「编排器独占这两个变量」用户可见口径的运行时半边，而同轮 r4 CODEX-03 恰恰以「档位定义只靠注释、没有机制钉住」为由给 warnings 补了两条守卫；独占口径哪天被改回「尊重宿主值」，npm run check 不会红。

**依据**：读 test/unit/zcode-provider-env.test.ts（诱饵用例的 process.env 设置与 finally 复位）、probes/zcode.ts 的 hostPreset 段、裁决件 r4-response-claude.md §五 判断 3、RUNBOOK 排障表新增行。

**建议**：在 doctorOnZcode/layout 装置里预置两个变量跑一次，断言 note 出现且含「独占」字样、finally 删除。约五行。Driver 在 §五 已表态「r5 认为该有我不反对」。

### CODEX-06 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/zcode.ts:174-180（why 拼 stderr 首行）` |
| 类别 | security ｜ 层次 code |
| 置信度 | low |

**问题**：焦点②的残留：indeterminate 的成因文本内嵌 CLI stderr 首行 ≤120 字符原话。doctor notes 不进 config.local.yaml、不过任何扫描器，而本主题三份证据 md 表明这些输出的实际流转方式是人工抄录进 git 里的 doc/05_testing/evidence/——那里没有 secrets 闸门，防线只剩手抄纪律（同一句「未打印任何配置文件内容」在三份留痕里各写了一遍）。secrets.ts 为 ZCode 凭据形态（<apiKeyId>.<apiKeySecret>）专设了扫描规则，说明「CLI 错误文本回显卡片状串」是被当过的现实风险；某次升版若在早期报错行里 echo 凭据，经 note→抄录→进 git 全程无拦截。

**依据**：读 probes/zcode.ts 的 why 构造、doctor.ts warnings/note 数据流、src/trivium/secrets.ts（凭据形态规则与 redact 机制存在）、evidence 目录三份 doctor 留痕的自我声明。属防御性建议：实测样本里未观察到凭据回显。

**建议**：why（及本轮新增的 `${HINT}：${stderr.slice(0,200)}` 两处如果尚未过）拼入前先过 secrets.ts 的 redact；或至少在 RUNBOOK 抄录留痕的那一节写明「doctor note 含 CLI 原文，粘贴前过一遍脱敏」。低置信、低成本。

## 认为正确的部分

- 焦点①判据换向成立且方向保守：Unknown 先判（本身即解析发生的证据）、定位失败次判（与 invokeZcode 同口径带退出码门控）、正向证据才记接受、其余一律 indeterminate 带成因；r4 留痕证实换向后本机真实 CLI 结论不变（接受 3 / 拒绝 4），否定式误放 spawn 崩溃的角落已用 WEIRD_FAIL 用例锁死。「列表不完备 ⇒ 冻结 + 告警」这个失败模式我判可接受（CODEX-03 只是补第二告警面）。
- 焦点②三个消费方都跟上了：探针 note 逐条展开 {flag, why}；doctor 告警按 count 消费、成因只走 note 是合理分工；用例断言了 why 的退出码与 stderr 首行形态。EV-84 登记我逐条核过：本侧 _meta 两份降级件的形状确为 {parse_fallback, raw}，复解析证实 r3 是 5 条全缺 confidence、r4 是 layer 取了 test/doc——两轮成因不同、且 r4 已补 confidence 又撞另一约束，登记理由（失去阻断资格而成因不可见）成立，「实施前须确认错误文本夹带面」的约束也与我的 CODEX-06 同源。
- 焦点③：两条 doctor 用例在无 ZCode 机器上不会红——假入口自足（version 臂、旗标臂都由 FAKE_ENTRY_SOURCE 应答），models/trace/cli-config 的真实用户目录读只进 note 文案不进断言，checkWrapper 对空临时目录返回 []（init.ts），环境段仅依赖 node+git，真实模型调用面被 skipModelCalls 与「只注入内置」双重关死。每文件约 17 次本地 node 子进程 + 一份 git 夹具的代价，换「warnings 唯一住户 + 告警不进 blockers」这档位定义有机器守卫，值。
- 焦点④驳回站得住：「用户自设文件在就保留」让宿主环境重新成为能改变探针行为的输入，个人配置自带默认模型（P-30 实测起 turn 到 qwen3.8-max），七候选即七次真实调用，与 r2 CODEX-01「判据是子进程拿不到」直接冲突；独占口径本轮进 note + RUNBOOK 排障行，处置与「记录不改行为」的裁决一致。
- 留痕对账其余各项：EV-83 的 grep 锚实测 12 行命中、9 处真实取值、3 处注释，与 BACKLOG 逐字一致；「四处同源」grep 到 authProbe / availability / critic.run / doctor 恰四个消费点；设计 §八 五条落点、§3.5 两行、11.3 要点 7、LLD/QUICKSTART 同步与代码实况对得上；补丁外通道（config.yaml、.env.example）的处置与设计 §七 的说法一致且 diff 头部文件清单证实二者确未混入被审补丁。

## 未覆盖范围（本侧盲区）

- 未实跑测试与构建（沙箱只读，无法 npm run build / node --test）；「用例全绿」以 r4 留痕的 1515/1513/2 记录 + 静态阅读为准，「新用例在全绿」是我对代码的推断而非实测。
- 真实 ZCode 0.16.9 CLI 的一切行为（停点文案、killTree 真实收割、provider_config_unresolved 真机触发）未本机验证——与证据文件自列的「未验到」同界。
- .trivium/config.yaml 与 .env.example 的改动内容未核（两者被排除于被审补丁，我只核到「确不在 diff」这一层）。
- probePathDeny 里 readonlyArgs 与追加的 --disallowed-tools 形成同名双旗标这一点是我在旧代码里瞥见的疑点，未展开论证、也不属本轮变更面。
- 镜头之外的角度（裁决流程语义、八段结构、其余适配器）默认另一侧在守，未系统覆盖。

## 实际查阅的项目文件

- `.reviews/zcode-provider配置注入/code/_meta/changes-20260921T091034Z.diff`
- `.reviews/zcode-provider配置注入/code/2026-09-21-zcode-provider配置注入-r4-response-claude.md`
- `.reviews/zcode-provider配置注入/code/_meta/review-codex-20260921T080553Z.json`
- `.reviews/zcode-provider配置注入/code/_meta/review-codex-20260921T083716Z.json`
- `src/trivium/adapters/zcode.ts`
- `src/trivium/probes/zcode.ts`
- `src/trivium/doctor.ts`
- `src/trivium/cli.ts`
- `src/trivium/preflight.ts`
- `src/trivium/review.ts`
- `src/trivium/init.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/types.ts`
- `src/trivium/config.ts`
- `src/trivium/secrets.ts`
- `src/trivium/gate.ts`
- `test/unit/zcode-provider-env.test.ts`
- `test/unit/zcode-availability.test.ts`
- `doc/05_testing/evidence/zcode-provider-config-20260920/r4-implementation-doctor-20260921.md`
- `doc/05_testing/evidence/zcode-provider-config-20260920/probe-outputs.md`
- `doc/05_testing/REPORT_2026-09-11_m0_probe.md`
- `doc/08_project/BACKLOG.md`
- `doc/06_deployment/RUNBOOK_pipeline_ops.md`
- `doc/07_manuals/QUICKSTART.md`
- `doc/02_design/2026-09-10-Driver-DualCritic主攻双审流水线设计.md`
- `doc/02_design/LLD_orchestrator.md`
- `skills/dual-critic/schema/review.v1.json`

> 编排器从工具轨迹中记录到的读取次数：{"run_command":35,"project_reads":20}

---

*本文档由 TriviumCode 编排器从 `codex` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
