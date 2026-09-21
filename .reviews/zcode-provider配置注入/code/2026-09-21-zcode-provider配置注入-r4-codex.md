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
run_id: 20260921T083716Z
rerun_index: 4
snapshot_hash: sha256:cdd65a99bcce866dbe2ba708581d9b8606bd1d2541c7eeb84df89cb5044ef4a1
blind: true
started_at: 2026-09-21T08:37:17.416Z
finished_at: 2026-09-21T08:53:10.655Z
duration_s: 953
tool_calls:
  run_command: 55
  project_reads: 29
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 0
  minor: 0
  nit: 0
degraded: false
parse_fallback: true
peer_deny: false
drift: false
readonly_verification: unavailable
path_verification: unavailable
joint_check:
  state: skipped-insufficient-sides
  effective_sides: 1
heterogeneous: true
session_id: 01a0c31c-c49e-7563-be66-09ef0d7ed376
---

# 代码审查：zcode-provider配置注入

> Critic-C · OpenAI Codex ｜ 模型 `qwen3.8-flash`
> ｜ 运行 `20260921T083716Z` ｜ 第 4 轮
> ｜ 本轮审核者 codex、gemini

> ⚠️ **解析降级**：本侧输出未能解析为结构化结论，下方为原文。该侧不参与阻断判定。
>
> ⚠️ **路径级 deny 未生效**：本机该侧 CLI 不支持路径级读取拒绝，对方历史产出的屏蔽仅依赖任务书禁读清单与事后轨迹核验。
>
> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **路径核验无结构化输入**：本侧读取路径只存在于命令文本里，措施 a 无通道可扫，禁读核验完全由措施 b（命令文本字面扫描）承担——已知形态必检，非完备。

## 原始输出（未能结构化解析）

```
## 审查结论

```json
{
  "schema": "trivium.review.v1",
  "verdict": "approve-with-nits",
  "summary": "r3 八条落点在代码里逐条兑现：三处拉起路径（version / 旗标 / 执行）现在都显式处理两个 provider 键，「子进程拿不到」的判据口径闭合；warnings 档四处改点齐全、退出码仍只由 blockers 决定；「四处同源」与 grep 实况一致；§五三处实施判断与代码对得上。最重的一条是 CODEX-01：旗标探针的接受判据仍是「没报 Unknown option 就算接受」的否定式，本轮只把 provider 定位这一个失败形态收进第三态——任何其它先于参数解析的失败（spawn 错误、模块加载崩溃、入口对拉起进程不可达）仍会把七个候选记成接受，2026-09-19 那次污染会换个成因复发。其余为环境口径与留痕的 minor/nit：存在性门控对用户自设的同名变量的覆盖式清除（CODEX-02）、warnings 档零测试守卫（CODEX-03）、名词正则的 exit≠0 误判角落（CODEX-04）、EV-83 登记面漏列新增字面（CODEX-05）。三条新 availability 用例中真正锁顺序的那条（断言 reason 严格等于布局常量）换序必红，守卫成立。",
  "findings": [
    {
      "id": "CODEX-01",
      "severity": "minor",
      "layer": "code",
      "kind": "correctness",
      "location": "src/trivium/probes/zcode.ts:150-156",
      "problem": "probeReadonlyFlags 的第三态只覆盖「退出码非 0 且 stderr 命中 Built-in Provider Config」这一个失败形态；其余一切「参数解析根本没发生」的失败仍落到 else accepted.push。run() 在 spawn 失败时把 '[spawn error]' 拼进 stderr 且 code 为 null（null !== 0），CLI 在模块加载期崩溃、入口对子进程 cwd 不可达（相对入口经 path.resolve 按编排器 cwd 探到、而 run 以 fx.root 为 spawn cwd，node 报 Cannot find module）等形态都会让七个候选被记成「接受」——与 P-29 同一类结论文件污染，只是换了成因。r3 为已知形态补了退出码门控，但判据的否定式结构没变。",
      "evidence": "读 src/trivium/probes/zcode.ts:140-165（判定链）与 src/trivium/util/exec.ts:185-189（child.on('error') 拼 stderr、finish(null,null)）；exec.ts 的 error 路径 code=null，不命中 indeterminate 正则、不命中 Unknown，直落 accepted。设计 v1.3.31 台账与 M0 报告 P-29（被审 diff 全文收录）承认该形态的成因就是「定位失败先于参数解析、否定式判据全记接受」。",
      "suggestion": "把「接受」改成正向证据判据：只有 stderr 命中「参数解析确实发生」的形态（Unknown option 之外的拒绝形态，或 Model creation failed / 成功产出）才记 accepted；spawn 失败（code 为 null、'[spawn error]'、'Cannot find module'）与任何未识别的退出形态一律记 indeterminate 并打 note。这与 AGY-01 收退出码是同一课的另一半：门控解决误放成功，正向证据解决误放崩溃。",
      "confidence": "medium"
    },
    {
      "id": "CODEX-02",
      "severity": "minor",
      "layer": "code",
      "kind": "maintainability",
      "location": "src/trivium/adapters/zcode.ts:129-152, 236-238",
      "problem": "存在性门控对用户预置的同名变量是无条件覆盖或删除，而这两个变量本身就是该 CLI 官方承认的定位通道（实测留痕 §1 显示桌面端正是用它传路径）。在非标准安装布局下，用户把这俩变量指向可用文件曾是唯一可行方案；本轮之后：派生路径存在→用户值被覆盖，派生路径不存在→用户值被删除，两条路都不再尊重用户显式配置。r2 CODEX-01 ≡ AGY-02 的裁决理由（防七次烧配额）成立在旗标探针那侧，但 invokeZcode 生产路径同样套用「子进程拿不到」判据时，代价是把一个可能合法的 relocate 机制整体作废——补丁与设计都只在代码注释里记载了这一优先序，面向用户的 RUNBOOK/QUICKSTART 没说「编排器独占这两个变量」。",
      "evidence": "读 src/trivium/adapters/zcode.ts（zcodeProviderEnv 注释与实现、invokeZcode）；被审 diff 收录的 probe-outputs.md §1/§3 证明 CLI 认这两个环境变量为合法输入源；RUNBOOK 与 QUICKSTART 的新增段只字未提用户自设变量会被清除。",
      "suggestion": "不必改行为（独占口径可以是有意的），但要么在 doctor 里对被清除/覆盖的宿主预置值出一条 note（「发现宿主预置 ZCODE_*_PROVIDER_CONFIG_FILE=…，本次按派生路径注入/删除」），要么在 RUNBOOK 排障表加一行「自设这两个变量不再有效」。若愿意更进一步：删除前判一下用户值指向的文件是否存在，存在即保留并 note——与 r2 裁决的张力请 Driver 显式裁定，别让它只活在代码注释里。",
      "confidence": "medium"
    },
    {
      "id": "CODEX-03",
      "severity": "minor",
      "layer": "test",
      "kind": "test-gap",
      "location": "src/trivium/doctor.ts:526-541, 648-649",
      "problem": "DoctorReport 新增的 warnings 档没有任何测试守卫：flagsIndeterminate>0 时 push 告警这一唯一住户、以及「warnings 不影响退出码/ok 字段」这条档位定义，都没有用例钉住——grep 全 test/ 目录，flagsIndeterminate 零引用，warnings 仅出现在与本文件无关的 credential-scrub 断言里。r3 实施留痕也自认该路径「未验到」。这个档位的存在理由恰是「既不该拦人、又不该被划过」，而它防的第一种误用（被后来者当降级的 blocker 塞东西、或反向被静默删掉）目前只靠接口注释——本仓纪律明令这类靠记性的约定要换成机制。",
      "evidence": "grep -rn flagsIndeterminate test/ 无命中；读 test/unit/zcode-provider-env.test.ts 与 zcode-availability.test.ts 全文，均不触 doctor 档；被审 diff 内 r3-implementation-doctor-20260921.md 的「未验到」段。",
      "suggestion": "仿照被审测试已有的假入口装置（provider-env 测试的 layout() 已能摆出「内置文件不在→旗标全第三态」的形态），补两条 doctor 层用例：①该形态下 runDoctor 的 warnings 恰含一条「本轮未判定」且 blockers 不含旗标那条；②同形态下 blockers 为空时退出口径不变（ok:true / 退 0）。第二件也可以退一步做成对 cmdDoctor 返回码的最小集成断言。",
      "confidence": "high"
    },
    {
      "id": "CODEX-04",
      "severity": "nit",
      "layer": "code",
      "kind": "correctness",
      "location": "src/trivium/adapters/zcode.ts:73, 246-255",
      "problem": "ZCODE_PROVIDER_CONFIG_UNRESOLVED_RE 是裸名词匹配，退出码门控只挡住了「退 0 + 诊断行」那一半；「因别的原因退非 0 + stderr 带成功形态的诊断行（如 resolved CLI ZCode Built-in Provider Config …）」仍会被判成 provider_config_unresolved，于是四处同源文案齐指安装布局，而真实失败可能在凭据/模型面。本轮测试自己的 FAKE_ZCODE_NOISY_OK 就是这种日志形态的可行性证明（假入口被写出来模拟它）。当前真实 CLI 未观测到此形态，属版本漂移风险而非现势缺陷。",
      "evidence": "读 src/trivium/adapters/zcode.ts 的 invokeZcode 判定链与 test/unit/zcode-provider-env.test.ts 的 FAKE_ZCODE_NOISY_OK 分支；设计 §3.3 对策行自述「裸正则会把 stderr 带同名诊断行的成功调用误判成布局失败」——它解决的是成功调用，非零退出侧的镜像角落未登记。",
      "suggestion": "把正则向失败形态收紧（如实测原文的「Provider Config[：:]」+ 候选列表形态，或动词前缀集），或至少在坑清单/EV 面记一条观察项：该判据依赖「该名词只在定位失败时出现」这一 n 很小的实测前提。",
      "confidence": "low"
    },
    {
      "id": "CODEX-05",
      "severity": "nit",
      "layer": "doc",
      "kind": "contract",
      "location": "doc/08_project/BACKLOG.md（EV-83 行）",
      "problem": "EV-83 列举 os.homedir() 同形态位置时写的是 zcodeProviderConfigPaths / prepareZcodeHome / authProbe().fingerprint / probeZcodeModels，漏了本轮新增的一处字面调用：invokeZcode 的 opts.userHome ?? os.homedir()（adapters/zcode.ts:238）。将来按 EV-83 切 os.userInfo().homedir 时按这行清单改，会留下这一处口径分叉——恰是这条登记想防的「只改一处让两套口径并行」。",
      "evidence": "grep -n 'userHome ?? os.homedir' src/trivium/adapters/zcode.ts 命中 238 行；被审 diff 的 BACKLOG EV-83 行文件清单未含 invokeZcode。行为层面无分叉（默认值与其余各处同为 os.homedir()，生产调用方无人传 userHome），纯登记面。",
      "suggestion": "EV-83 的文件清单补名，或改写为「adapters/zcode.ts 内全部 os.homedir() 字面 + probes/zcode.ts 的 ZCODE_CLI_DIR/ENTRY_CANDIDATES」，用 grep 锚而不是人工枚举——本轮已经示范过一次人工清单漏项的症状。",
      "confidence": "high"
    }
  ],
  "agreed": [
    "焦点①：warnings 档四处改点齐全（types 之外的 DoctorReport 接口、runDoctor 构造、renderDoctorReport 渲染、cli.ts JSON 输出各一处），全仓 DoctorReport 唯一生产者是 runDoctor、唯一消费者是 cmdDoctor/renderDoctorReport，无漏改的消费方；退出码与 ok 字段确认仍只由 blockers 决定（cli.ts:645/655）。",
    "焦点②：version 探针「只清不注入」的理由成立——P-28 实测 version 子命令不读 provider 配置，而清除封住了宿主诱饵进入口/版本结论的路径；至此三条拉起 zcode 的路径（probeZcodeEntry / probeReadonlyFlags / invokeZcode）逐一核过，两个键全部被显式处理，「子进程拿不到」不再只在部分路径兑现。空集双义的收窄理由（探测过程事实不落盘）与 availability 文案指路（回跑 doctor 能看到 warnings/note，其中「本轮未判定」措辞逐字对得上）自洽，误导面收敛到可接受。",
    "焦点③：invokeZcode 的 userHome 注入口默认 os.homedir()，生产调用方（authProbe、critic.run、probeZcode）无一传值，与 fingerprint/prepareZcodeHome/probeZcodeModels 同一口径，未制造新的运行时分叉；与 EV-83 是同一形态、同案登记即可，无需并案新条目（登记面漏项见 CODEX-05）。",
    "焦点④：三条新 availability 用例的分工成立——锁顺序那条（断言 reason 严格等于 ZCODE_PROVIDER_CONFIG_UNRESOLVED_HINT）在两支换序时必红（换序后 reason 变成长文案旗标提示，等值断言即碎，不依赖 doesNotMatch 的字面巧合）；另两条分别锁「分支被删」与「=== null 被放宽成 !」，变异互不重叠。我单独跑了该文件的构建产物（node --test dist/test/test/unit/zcode-availability.test.js，7/7 通过）。killTree 新开到旗标探针：假入口即时退出、本仓用例不触超时路径，无副作用；真实拉起下与 exec.ts「拉起厂商 CLI 一律打开」的既有纪律对齐，方向正确。",
    "焦点⑤留痕核对：设计 v1.3.31 台账新增的六/七两段、r3 实施留痕（+3 条全落 availability、provider-env 维持 14 条且两条 invokeZcode 用例改传 userHome 并升级 personal===null 直接断言）、裁决件 §五三处实施判断（warnings 加档、version 只清不给、不落盘只补文案），与代码与测试实况逐条对得上；§2.2 的用例标题改准也已落地。",
    "路径派生 resolve→realpath→兄弟目录与实测应用包布局一致（probe-outputs §0/§1），入口缺失回落词法路径交给存在性门控，与软链断链不该在这里抛的注释一致。"
  ],
  "not_covered": [
    "未能全量跑 npm run check / provider-env 测试：审查沙箱只读，测试的 mkdtemp 在 tmp 下 EPERM；该文件的断言正确性以静态核读 + 被审 diff 内实施留痕（1512/1510/0）为据，仅纯同步的 zcode-availability.test.js 实跑通过。",
    "未触碰真实 ZCode CLI 与用户凭据文件（provider_config 相关文档承诺的只判有无未做独立验证）。",
    "补丁外通道改动（.trivium/config.yaml、.env.example）不在被审补丁内，我只核对了 r3 应答件 §三 的自述与 BACKLOG 措辞的一致性，未对其内容作独立审查。",
    "设计文档仅核读了 v1.3.31 相关段落与 §3.3/§3.5/§11.3 改动处，未回读全文找历史漂移。",
    "config.local.yaml 的 probe 段 schema 对 provider_config 新格的放行（commonProbe additionalProperties:true）核了 schema 文件，但 validateConfig 的完整加载链未实跑。"
  ],
  "consulted": [
    ".reviews/zcode-provider配置注入/code/_meta/changes-20260921T083716Z.diff",
    ".reviews/zcode-provider配置注入/code/2026-09-21-zcode-provider配置注入-r3-response-claude.md",
    "src/trivium/adapters/zcode.ts",
    "src/trivium/probes/zcode.ts",
    "src/trivium/doctor.ts",
    "src/trivium/cli.ts",
    "src/trivium/config.ts",
    "src/trivium/types.ts",
    "src/trivium/util/exec.ts",
    "src/trivium/util/fsx.ts",
    "skills/dual-critic/schema/config.v2.json",
    "skills/dual-critic/schema/review.v1.json",
    "test/unit/zcode-availability.test.ts",
    "test/unit/zcode-provider-env.test.ts"
  ]
}
```

**核对说明**（供编排器与 Driver）：

- 焦点 ①–④ 与留痕核对的结论都写进了 `agreed`/`findings`，五轮工具调用全部为只读（含一次对 `dist/test` 构建产物的实跑）。
- 最重一条是 `CODEX-01`：它不是本轮引入的缺陷，而是本轮为 P-29 打的补丁在判据结构上仍是枚举已知失败形态——同一课（AGY-01 的退出码门控）在「正向证据」这一半还没收干净。
```
