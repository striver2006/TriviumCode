# 编译测试记录 · VSCode插件Phase2

- **运行**：`20261106T025331Z`
- **结论**：❌ 失败
- **起止**：2026-11-06T02:53:31.706Z → 2026-11-06T03:03:27.638Z
- **项目根**：`/Users/chenzhenbo/Work/TriviumCode`

## 一、执行的命令

| # | 组 | 命令 | 退出码 | 耗时 | 命令 sha256 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | build | `npm run typecheck` | 0 | 3.7s | `982c1455e5e7` |
| 2 | build | `npm run build` | 0 | 3.4s | `16c0e4305ac2` |
| 3 | test | `npm test` | 1 | 588.8s | `328e123c6385` |

> `命令 sha256` 取命令原文，用于与配置对账（AC-10）。

## 二、输出摘要

### `npm test`（test，退出码 1）

**stdout（尾部）**

```text
…（已省略前 4245 行）
✔ 注入：门控仍是逐键——个人在、内置不在时，个人照常注入（撤回 D-3 的守卫） (3.71875ms)
✔ 注入：七个目录 / 路径键与四个落点开关键恒出现且为 undefined——宿主预置也进不了子进程（EV-110 加 ZCODE_LOG_DIR；EV-112 扩到十一键） (2.311042ms)
✔ 端到端：omitPersonalProviderConfig + 宿主预置十一个目录 / 路径键与落点开关键 → 子进程一个都拿不到（EV-110、EV-112） (130.27875ms)
✔ run()：副本 HOME 下拉起时个人键被删（即使真实用户目录下个人文件存在），route 记 config_copy (248.236834ms)
✔ run() 负格：请求模型不在副本源目录 → route global，且 model_override_applied **缺席**（不是 null） (189.266834ms)
✔ run() 限定失败·回读到别的模型 → model_unenforced 产出，cause 为 qualify_failed、requested 是请求原值 (214.36325ms)
✔ run() 限定失败·回落模型的 modelId 段恰与请求相同 → 不产出（跑的就是请求的模型） (140.274875ms)
✔ run() 做了覆盖且没落实 → 只有 model_override_applied: false，model_unenforced 缺席（互斥） (147.729958ms)
✔ EV-30 ⑥⑦：旧配置带 agents.glm.max_turns / unsupported_override: reject → 调用参数逐字不变、不拒跑，model_unenforced 照常产出 (350.056792ms)
✔ decideModelUnenforced：四条合取，任一不成立即缺席 (0.261875ms)
✔ decideModelUnenforced：modelId 段不同 ⇒ 四字段原样产出 (0.141917ms)
✔ run() 正格：回读生效模型与请求一致 → true；不一致 → false (344.620375ms)
✔ run() 正格：回读 providerId 是 UUID 形态、modelId 一致 → 仍 true，trace.json 记形态差（r2 AGY-03） (139.997958ms)
✔ 比对判据只取 modelId 段：两种 providerId 形态并存时不得判成未生效（P-31） (0.174583ms)
✔ 比对：一致 → true；providerId 形态不同 → 仍 true 只记 note；模型不同 → false (0.099375ms)
✔ 比对：尝试了但没回读到 → 不产出 true/false 带 note；没尝试 / 没请求 → 静默 (0.109708ms)
✔ 清扫：三份已知凭据载体全部按名整删，各自计入 deleted（AGY-05） (16.594541ms)
✔ 清扫：载体不在就跳过，不报错也不虚报删除（幂等） (10.741916ms)
✔ 探针辅助：buildProbeCliConfig 按白名单重建——apiKey 是哨兵，headers/token 等一律不带，baseURL 与目录保留 (0.228209ms)
✔ 探针辅助：pickNonFirstModel 挑第一个有两个以上模型的 provider 的第二个模型 (0.110458ms)
✔ 探针臂：CLI 读到副本 model.main（非首位模型）→ config_copy；副本里绝无真实凭据（假入口见到就退 99） (154.797ms)
✔ 探针臂：写出的 providerId 是 UUID 形态、modelId 仍是请求值 → config_copy，形态差只进 why（r2 CODEX-03） (151.11925ms)
✔ 探针臂：CLI 没读 model.main、回落首位模型 → global（非首位请求才分得出来） (131.317625ms)
✔ 探针臂：CLI 跑到模型层却没写 v2 → global（导入确实没发生） (123.963417ms)
✔ 探针臂：拉起崩溃（无输出退 137）→ null 未判定，不得记成有定论的 global（codex 子项 02） (148.628875ms)
✔ 探针臂：拉起超时被杀 → null 未判定（timedOut 那一支，不得记成 global） (530.581333ms)
✔ 探针臂：内置 provider 配置定位失败（P-28 形态）→ null 未判定 (187.629291ms)
✔ 探针臂：只读参数透传到 argv，且宿主的 ZCODE_API_KEY / ZCODE_BASE_URL 进不了子进程（AGY-02 / 子项 03） (144.365667ms)
✔ 探针臂：副本 HOME 跑后被清（只认 makeTempDir 的返回值） (222.08375ms)
✔ 探针臂：源里有免密 provider（apiKeyRequired:false）→ 探针副本带上该键、导入被拒、如实 global（r3 CODEX-01） (144.338208ms)
✔ 成员规则与导入器同源：deleted 成员不计、modelId 取 id 而非键名、account:/builtin: 与非 custom 的 provider 不进注册表（r3 CODEX-02） (0.258709ms)
✔ 切分与包内 okt 同规则——第一个 /：模型键名含 / 时限定与比对都不切错（r3 CODEX-03） (0.139084ms)
✔ 探针臂：目录里没有非首位模型 → 未判定（null），不写结论 (8.573125ms)
✔ 守卫：judgeSide 原样透传四种情况，本层不做归一 (18.943083ms)
✔ 守卫：覆盖没落实 → 播报一条，点明 FR-06 / NFR-06 失效；其余三种不出声 (3.329708ms)
✔ 守卫：不判失守、不动证据判定 (0.577542ms)
✔ 守卫：model_unenforced 在 ⇒ 播报一句，含 critic、请求值、生效值、reason 原文与 FR-06 / NFR-06 (0.468208ms)
✔ 守卫：按 cause 给排查指向，两种不串 (0.3465ms)
✔ 守卫：两值之外的 cause（只可能来自未校验的桩注入）⇒ 主句照常、不拼出 undefined（代码双审 r1 CODEX-01） (0.234208ms)
✔ 守卫：model_unenforced 缺席 ⇒ 不出声；覆盖没落实那句也不引出它 (0.487625ms)
✔ 内置配置路径按入口派生：Resources/glm/zcode.cjs → Resources/config/provider/zcode-builtin.json (10.082417ms)
✔ 个人配置路径跟用户目录走，不跟入口走（config_copy 的假 HOME 下也要指向真实那份） (1.795334ms)
✔ 软链入口先 realpath 再取兄弟目录：派生落在真实安装布局上，不落在软链所在目录 (30.66625ms)
✔ 入口不存在（软链断了 / 布局变了）时回落到词法路径，不抛 (0.556292ms)
✔ 两份都在 → 两个变量都给，值为绝对路径 (8.721709ms)
✔ 文件不在 → 该键值为 undefined（不是缺席）：宿主环境里预置的同名变量必须被删掉 (19.218125ms)
✔ invokeZcode 把内置变量递给子进程，且 HOME 副本覆盖不影响它 (143.4485ms)
✔ 内置文件不在 → 不注入，CLI 原话进 failureKind=provider_config_unresolved（退出码非 0 且 stderr 命中） (139.511292ms)
✔ 退出码门控：正常退 0 而 stderr 里出现同一名词（诊断行）→ 不判成布局失败 (148.214125ms)
✔ 宿主环境预置了同名变量 → 子进程必须拿不到：只追加不清除等于原样透传 (123.550583ms)
✔ U1 zcodeStorageRedirectEnv：恰好三键，布局与「HOME=<root> 时 CLI 的缺省值」逐字相同；入参是 .zcode 本身时抛错（含尾斜杠） (0.615708ms)
✔ U2 invokeZcode 先清后设：宿主预置十一键诱饵 ⇒ 给落点根时子进程拿到编排器的三个值、其余八个为 null；不给时十一个全 null；HOME 不受落点根影响 (249.36625ms)
✔ ZCODE_BETA_ARGV_RE 与包内 RMi 同形：…/zcode-beta 结尾或后跟「.」命中，目录段 …/zcode-beta/… 不命中 (0.165458ms)
✔ failureKind 的判据只认英文名词片段，中文前缀换了也认得出 (0.0435ms)
✔ P-29：provider 配置定位失败时七个候选全部 indeterminate，一个都不算接受 (872.744083ms)
✔ 0.17.0 停点：Select a model 是「参数已解析」的正向证据，五个合法候选判接受而非 indeterminate（2026-10-29 Windows 真机验收） (1009.505667ms)
✔ 旗标探针：宿主预置 ZCODE_DATA_BASE_DIR / ZCODE_API_KEY → 七次拉起的子进程一个都拿不到（代码双审 r1 codex 子项 01 ≡ AGY-01） (1100.745ms)
✔ P-28 / P-30：内置文件在 → 参数解析结论可判；只注入内置那份、个人那份一次都不给 (882.366333ms)
✔ defaultProbe 的 zcode 段带 provider_config: null（未探过 ≠ 未找到） (0.315667ms)
✔ 未识别的失败形态 → 全部 indeterminate，一条都不回落成接受 (712.732167ms)
✔ R1 旗标探针的空 HOME 删不掉：不抛、结论与不锁时相同、提示取「没有副本」档（EV-198） (1414.708167ms)
· 探测运行环境…
· 探测 ZCode（zcode.cjs）…
· 探测运行环境…
· 探测 ZCode（zcode.cjs）…
✔ D19 旗标探针的空 HOME 删不掉：doctor 不崩、阻断与告警与不锁时相同、结论照常落盘，note 带残留提示（EV-198） (2759.380959ms)
· 探测运行环境…
· 探测 ZCode（zcode.cjs）…
✔ 旗标本轮未判定 → 出 warnings，而不是拦人 (918.684208ms)
· 探测运行环境…
· 探测 ZCode（zcode.cjs）…
✔ 旗标探针退 0 → 仍记接受，但要出声（零配额前提被打破） (1360.435667ms)
· 探测运行环境…
· 探测 ZCode（zcode.cjs）…
✔ 宿主预置两个 provider 变量 → doctor note 说明编排器独占（RUNBOOK 口径的运行时半边） (926.986958ms)
· 探测运行环境…
· 探测 ZCode（zcode.cjs）…
✔ warnings 不影响阻断判定：有告警但 blockers 为空 (912.549834ms)
✔ version 探针：宿主预置的两个 provider 键、全部目录 / 路径键与落点开关键（EV-112 起十一个）、两个凭据键一律进不了子进程（代码双审 r1 codex 子项 06） (69.901125ms)
✔ 接线：probeZcode 把本轮 readonly_flags 经 readonlyArgsFromProbe 递给探针臂，并透传 cliConfigPath (703.316333ms)
✔ 接线：探针臂判 null（未判定）→ 结论保留旧值、note 说明、不出 ⚠️ (691.030417ms)
✔ 接线：探针臂判 global → 结论写 global 且出 ⚠️ (951.171417ms)
✔ 同形臂接线：与白名单臂同一门控；原样支一次、置首支一次（显式传 variant）；结论写进 model_override_full_copy (779.194375ms)
✔ 同形臂接线：两臂本轮都非 null 且不同 ⇒ 出 EV-94 ② 不一致告警 (844.023833ms)
✔ 同形臂接线：本轮判不出 ⇒ 保留上一轮的值，且不拿旧值去比、不出不一致告警（CODEX-06） (881.417042ms)
✔ 运行期接线：两臂 note 各带运行期读数；配置层 config_copy 而运行期选了别的 ⇒ 按臂出 ⚠️ (830.965708ms)
✔ 运行期接线：运行期与请求 modelId 段一致、或配置层不是 config_copy ⇒ 不出运行期 ⚠️ (1946.878333ms)
✔ 运行期接线：桩不给 runtimeSelected ⇒ note 写「未采集」 (1197.674958ms)
✔ 运行期接线：config_copy 且启动阶段选定为空（no_model_field）⇒ 单列 ⚠️（代码双审 r1 CODEX-03） (907.137083ms)
✔ 运行期接线：配置层未判定（null）而运行期 ok≠请求 ⇒ 不叠加 ⚠️，但 note 带读数（代码双审 r1 GLM-02） (802.072084ms)
✔ U7 宿主预置十一键中的任一个 ⇒ doctor 出信息级 note（EV-110 / EV-112），只报键名不报值、不再说「持久留存」；都不预置不出 (11721.696917ms)
✔ U7 探针入口命中 beta 改写的 argv 判据 ⇒ doctor 出信息级 note，只报命中、不报路径全文；不命中不出 (1736.8575ms)
✔ runtime_selection 接线：原样支回落、置首支选中 ⇒ reorder_needed 写进结论，运行期 ⚠️ 由它那条 note 合并说明 (889.01425ms)
✔ runtime_selection 接线：两支都没选中 ⇒ reorder_ineffective，note 带 ⚠️ (1464.527708ms)
✔ runtime_selection 接线：判不出（置首支恒等）⇒ 不覆盖旧值，note 说明保留，运行期 ⚠️ 照旧 (962.3295ms)
✔ 运行期读数：无日志目录 ⇒ no_log_dir (11.262459ms)
✔ 运行期读数：目录在、没有 .jsonl ⇒ no_log_file (4.360583ms)
✔ 运行期读数：有日志、没有启动事件 ⇒ no_event（事件名只出现在别的字段里也不算） (2.605042ms)
✔ 运行期读数：启动事件在、context.model 缺失或为空串 ⇒ no_model_field (13.272916ms)
✔ 运行期读数：正常 ⇒ ok，只返回 context.model 一个字段 (15.20375ms)
✔ 运行期读数：多文件取排序最新的一份 (4.781917ms)
✔ 运行期读数：同一文件多条启动事件取最后一条 (2.953125ms)
✔ 运行期读数：末行截断（超时被杀）跳过，不抛、不影响前面的读数 (10.312375ms)
✔ describeRuntimeSelection：每种成因各有一句，ok 带模型 (2.658209ms)
✔ 置首：provider 与成员都挪到首位；只动顺序——键集合、每个值、嵌套原样；不改入参 (2.485209ms)
✔ 置首：成员 id 与键名不同时按 id 定位；id 带首尾空白按 trim 后比 (0.267917ms)
✔ 置首：跳过 deleted 成员；重复 id 取第一个匹配键（导入器先到先得） (0.129208ms)
✔ 置首挪不动不当成功：找不到 provider / 成员、恒等、整数样键名 ⇒ applied:false 带原因，原样返回 (3.315875ms)
✔ 置首：provider 键带首尾空白也能定位，重建时保留原始键（代码双审 r1 CODEX-02 ≡ GLM-03） (0.170458ms)
✔ 置首：多个 provider 键 trim 后同名 ⇒ 挪不动（导入器取哪个未核实，不猜） (0.091542ms)
✔ catalogFirstNote：只在请求 modelId 段等于首个有成员 provider 的首个成员时标注（代码双审 r1 CODEX-04） (0.675875ms)
✔ 同形臂 as-is：配置读取层写出请求值（config_copy），运行期却回落首位——两层分开报 (184.328916ms)
✔ 同形臂 requested-first：只挪顺序，运行期回落就落在请求模型上 (165.767917ms)
✔ 同形臂 requested-first 挪不动（请求本就在首位）⇒ applied:false 带原因，照常拉起 (138.914583ms)
✔ 同形臂 requested-first 限定失败 ⇒ 不拉起，variant 带原因、运行期 not_launched (11.321375ms)
✔ 白名单臂：显式 opts.model 优先于 pickNonFirstModel，运行期读数接入 (166.255125ms)
✔ 两臂早退 ⇒ runtimeSelected 为 not_launched (14.354584ms)
✔ 拉起了但没写日志 ⇒ no_log_dir（与 not_launched 区分） (123.725584ms)
✔ 宿主预置 ZCODE_LOG_DIR：两臂都清掉它，日志仍落进副本 HOME、宿主目录不被写 (239.291042ms)
✔ 两臂：显式请求目录首位 ⇒ 结论照出、why 标注无判别力；非首位不标（代码双审 r1 CODEX-04） (453.086833ms)
✔ 同形臂：置首生效 ⇒ why 标注配置层判据按构造失明；原样不标 (318.996ms)
✔ prepareZcodeHome requestedFirst：transformCopy 收到的已是置首后的对象，盘上键序与 prep.reorder 一致 (5.484041ms)
✔ prepareZcodeHome：不传 requestedFirst ⇒ reorder 为 null、键序原样；限定失败 ⇒ reorder 为 null、照常建副本 (4.82075ms)
✔ 审查臂：非首位请求 ⇒ 置首后运行期回落正好落在请求上；trace 记 reorder 与「请求模型已置首」事实句；守卫字段 kind=applied (190.039167ms)
✔ 审查臂：请求本在首位（恒等路径）⇒ kind=identity、覆盖照样落实、不写置首事实句、守卫不告警 (120.250208ms)
✔ reorderHint：缺席 ⇒ 空串（告警维持原文）；在场按 kind 分三句，不看 reason 文案 (0.304625ms)
✔ judgeRuntimeSelection：按序五格（r3 §4.2），只比 modelId 段 (0.29025ms)
✔ 同形臂：doctor 的两支——原样支 variant 由臂自行合成，置首支 kind=applied（本机形态） (268.195583ms)
✔ 抠 envelope：容忍前置告警行（不能用 JSON.parse(trim) ） (2.5575ms)
✔ 抠 envelope：字符串里的花括号不破坏配平 (2.352167ms)
✔ 抠 envelope：转义引号不破坏配平 (0.355291ms)
✔ 抠 envelope：无 JSON 时返回 null 而非抛异常 (0.142208ms)
✔ 解析 envelope：正文在 .response，且记录全部字段名 (0.251084ms)
✔ 回读生效模型：envelope 没有 model 字段，只能从日志 context.model 取（AC-13） (0.533291ms)
✔ 按 sessionId 过滤：共享 HOME 下多会话交织不得混入 (0.345958ms)
✔ 只统计 completed 的工具调用，failed 不算证据 (0.226167ms)
✔ 写工具与 Bash 计入 writeEvents（只读失守信号） (0.312875ms)
✔ 解析 turn.failed 的结构化根因 (0.279292ms)
✔ sessionId 传 null 时全收（独立 HOME 下日志天然隔离） (0.077333ms)
✔ rollout：工具参数里的路径可提取（标准日志没有这个信息） (1.249833ms)
✔ rollout：回读生效模型的全限定形态与来源档位 (0.19975ms)
✔ rollout：写工具与 Bash 计入 writeEvents (0.152292ms)
✔ rollout：坏行与无 toolCalls 的行被跳过而非抛异常 (0.101375ms)
✔ 模型名补全：短名按探针回读的 providerId 补前缀 (19.077333ms)
✔ 模型名补全：已是全限定形态时原样返回 (0.0875ms)
✔ 模型名补全：探针没给出前缀时原样传，不瞎猜 (0.066209ms)
✔ 模型名补全：providerId 含斜杠时只切最后一段 (0.266541ms)
✔ 模型名补全：null 模型返回 null (0.082875ms)
ℹ tests 4046
ℹ suites 0
ℹ pass 4028
ℹ fail 2
ℹ cancelled 0
ℹ skipped 16
ℹ todo 0
ℹ duration_ms 586469.27825

✖ failing tests:

test at dist/test/test/unit/doctor-deadline.test.js:167:1
✖ I4 兜底：段卡在不经 run() 的 await 上，控制器在兜底时长后按已记状态出结果（stuck），不等挂住的 await（AGY-02） (1118.910542ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + 'not_started'
  - 'in_progress'
  
      at file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/unit/doctor-deadline.test.js:181:12
      at async pinned (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/unit/doctor-deadline.test.js:55:12)
      at async TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/unit/doctor-deadline.test.js:170:3)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 'not_started',
    expected: 'in_progress',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at dist/test/test/unit/doctor-deadline.test.js:184:1
✖ I6 段内不带 killTree 的派生（模拟 git 辅助调用）到点也按组结束，按时出结果（CODEX-02） (1435.346625ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected
  
  + 'not_started'
  - 'in_progress'
  
      at file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/unit/doctor-deadline.test.js:196:12
      at async pinned (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/unit/doctor-deadline.test.js:55:12)
      at async TestContext.<anonymous> (file:///Users/chenzhenbo/Work/TriviumCode/dist/test/test/unit/doctor-deadline.test.js:187:3)
      at async Test.run (node:internal/test_runner/test:1113:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:788:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 'not_started',
    expected: 'in_progress',
    operator: 'strictEqual',
    diff: 'simple'
  }
```

**stderr（尾部）**

```text

  skills/dual-critic/scripts/trivium.cjs  1.9mb ⚠️

⚡ Done in 42ms

  dist/install.cjs  294.0kb

⚡ Done in 6ms

  dist/test/test/integration/gate-loop.test.js        635.0kb
  dist/test/src/trivium/run-protocol.js               310.7kb
  dist/test/test/unit/hooks.test.js                   304.3kb
  dist/test/src/trivium/review.js                     300.8kb
  dist/test/src/trivium/cli.js                        294.9kb
  dist/test/test/integration/fault-injection.test.js  256.0kb
  dist/test/test/integration/run-protocol.test.js     240.7kb
  dist/test/src/trivium/probes/zcode.js               215.9kb
  dist/test/src/trivium/hooks.js                      212.4kb
  dist/test/test/unit/registry-parity.test.js         210.0kb
  dist/test/src/trivium/adapters/base.js              202.2kb
  dist/test/src/trivium/adapters/zcode.js             198.3kb
  dist/test/src/trivium/gate.js                       193.9kb
  dist/test/src/trivium/probes/claude.js              186.7kb
  dist/test/test/unit/preflight.test.js               184.1kb
  dist/test/src/trivium/types.js                      182.6kb
  dist/test/test/unit/gate.test.js                    179.3kb
  dist/test/test/unit/lock.test.js                    170.2kb
  dist/test/src/trivium/report.js                     167.6kb
  dist/test/test/unit/zcode-provider-env.test.js      159.6kb
  ...and 320 more output files...

⚡ Done in 153ms
```

### `npm run typecheck`（build，退出码 0）

**stdout（尾部）**

```text

> triviumcode@1.3.5 typecheck
> tsc --noEmit
```

### `npm run build`（build，退出码 0）

**stdout（尾部）**

```text

> triviumcode@1.3.5 build
> node scripts/build.mjs

构建标识：2be1ca8，inputs f148fa9d8887
```

**stderr（尾部）**

```text

  skills/dual-critic/scripts/trivium.cjs  1.9mb ⚠️

⚡ Done in 42ms

  dist/install.cjs  294.0kb

⚡ Done in 10ms
```

---

> ❌ 有命令非零退出，全流程状态为 `failed`。已产生的计划 / 审查 / 应答工件全部保留，
> 不因本次失败而删改（设计 §14.2）。修复后重跑会另起一份记录，本文件不被覆盖。
