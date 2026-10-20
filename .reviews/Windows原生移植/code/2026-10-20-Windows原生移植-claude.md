---
schema: trivium.review.v1
topic: Windows原生移植
stage: code
role: claude
vendor: anthropic
agent_cli: claude/2.1.302
model_requested: opus
model_effective: k3-256k
model_effective_source: envelope
effort: medium
effort_requested: medium
effort_effective: null
effort_effective_source: unverified
tier: null
tier_source: profile
run_id: 20261020T074334Z
rerun_index: 1
snapshot_hash: sha256:3e31d3487b6b27804573af909bd19740488cba8986f15eac9c7fa523884d30ce
blind: true
started_at: 2026-10-20T07:43:46.294Z
finished_at: 2026-10-20T07:59:54.359Z
duration_s: 967
tool_calls:
  read: 17
  grep: 9
  glob: 0
  run_command: 0
  project_reads: 10
evidence_ok: true
verdict: request-changes
findings_count:
  blocker: 0
  major: 4
  minor: 5
  nit: 2
degraded: false
parse_fallback: false
peer_deny: true
drift: false
readonly_verification: unavailable
heterogeneous: unknown
access:
  requested_mode: native
  profile: null
  launcher_requested: C:\Users\k_bo\.local\bin\claude.exe
  launcher_effective: C:\Users\k_bo\.local\bin\claude.exe
  wrapper_sha256: null
  configuration_sha256: null
  provider_declared: null
  provider_declared_source: null
  provider_effective: null
  provider_effective_source: null
family_comparisons:
  - left: glm
    right: claude
    status: unknown
    left_model: null
    right_model: k3-256k
    left_source: null
    right_source: envelope
    reason: 左侧模型信息缺失
  - left: claude
    right: codex
    status: different-family
    left_model: k3-256k
    right_model: qwen3.8-flash
    left_source: envelope
    right_source: trace
    reason: 模型族不同：kimi / qwen
override_reason: 左侧模型信息缺失
session_id: cf4727a8-de3f-4088-954f-302c6a3e3b35
---

# 代码审查：Windows原生移植

> Critic-D · Anthropic Claude Code ｜ 回读模型 `k3-256k` ｜ 请求模型 `opus`
> ｜ 运行 `20261020T074334Z`
> ｜ 本轮审核者 claude、codex

> ⚠️ **只读核验不可用**：本侧被拒的写操作不进轨迹，「未检出写事件」不足以排除失守。只读保障从三重降到两重（指纹比对仍有效）。
>
> ⚠️ **模型族 unknown**：左侧模型信息缺失；告警继续。

## 总判断

最危险：codex prompt-only 下「flags 空 + enforced===false」判可用（codex.ts:494），而运行时 readonlyArgsFromProbe(空) 不传任何 -s read-only（codex.ts:773）——整条只读信号为零仍放行，fail-open。次：取消旗标 watcher 以安装时刻为基线而非 worker 诞生时刻，诞生→安装窗口内的 settleOrphanedStart/--cancel 旗标被永久忽略，worker 丢优雅收尾。再次：Win32 枚举失败时回退无龄期上限的陈旧缓存（platform.ts:69-92），pid 复用下可误判「同一进程」→ taskkill 无辜进程树，违背模块自述「判不了返回 null」。另：claude verbose 阴性对照未带 settingsEnv，网关机器上认证失败被 vacuous 判 true。跨平台同名字段复用的安全论证依赖「记录不跨平台」这一无强制前提，已给出反例。整体工程严谨、注释完备，但上述四处建议在合入前处理。

**结论**：`request-changes`

## 审查意见（共 11 条：重要 4 ｜ 次要 5 ｜ 吹毛求疵 2）

### CLAUDE-01 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/codex.ts:494` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | high |

**问题**：prompt-only 降级分支把「探针未实测到任何只读旗标（readonly_flags.length===0）且 readonly_enforced===false」判为 ok:true 可用。但运行时 readonlyArgs 直接取自 readonlyArgsFromProbe(probe.readonly_flags)（codex.ts:773），旗标为空意味着调用 codex 时完全不传 -s read-only——阴性对照曾实测到穿透、被探针判为「旗标未落盘」的旧策略状态，被永久豁免成可用态。此时该侧连 prompt-only 所宣称的「旗标照传」这一最弱保障都没有，补偿控制只剩 BRIEF 措辞，属于 fail-open。

**依据**：读 src/trivium/adapters/codex.ts 可用性分支（readonly_flags.length===0 时 prompt-only && readonly_enforced===false → ok:true）与运行时组装（readonlyArgs: readonlyArgsFromProbe(probe.readonly_flags)）。两处消费同一 probe 结果，空数组在可用性侧被豁免、在运行侧退化为零旗标。推理：探针何时会留 flags 空 + enforced false 的状态，取决于探测落盘时机，本侧无法运行确认该状态实际可达的概率。

**建议**：可用性判定 fail-closed：flags 为空时无论 enforcement 模式一律 ok:false（或要求显式重跑 doctor 落出非空旗标后才转 prompt-only 豁免）；豁免条件只覆盖「有旗标但 enforced===false（阴性对照穿透）」的形态。

### CLAUDE-02 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/run-protocol.ts installWorkerCancelFlagWatcher` |
| 类别 | concurrency ｜ 层次 code |
| 置信度 | medium |

**问题**：worker 侧取消旗标 watcher 只认 mtime 晚于 watcher 安装时刻的 cancel.requested。基线是「watcher 安装时刻」而非「worker 进程诞生时刻」：spawnDetached 回调 onSpawned 即记诞生，而 watcher 在 workerMain 内、模块全量加载之后才安装。这段窗口内若 --start 后续步骤失败走 settleOrphanedStart 写入取消旗标（run-protocol.ts:714-727 的 born 分支），或用户极快地 --cancel，旗标 mtime 早于基线，被 watcher 永久忽略——worker 失去「读旗标→优雅退出→保留 scrub 收尾」的路径，只剩外部 taskkill 硬杀。另：watcher 以 mtime 新旧做判据，在 2 秒级 mtime 粒度的卷（FAT/exFAT）上，取消紧随 watcher 安装发生时新旗标可能与基线同刻度而被判旧。

**依据**：读 run-protocol.ts:648-727（spawnDetached 的 onSpawned 先于 workerMain 内任何代码执行；失败路径 settleOrphanedStart 携带 workerStartedAt 并写收尾）与 diff 中 installWorkerCancelFlagWatcher 的「只认比 watcher 新的旗标」逻辑。窗口长度 = Node 模块加载 + workerMain 前置步骤，本侧无法实测其量级；FAT 2 秒粒度为文件系统常识，标注为推理。

**建议**：基线改为 worker 进程创建时刻（或安装时刻减去一个保守回退量，如数秒），并在旗标存在但被判旧时留一条显式痕迹，避免「旗标被吞」无从排查。

### CLAUDE-03 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/util/platform.ts:69-92` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：enumerateWinProcesses 在超时 / error / 非零退出 / 空输出等失败路径上回退 finish(enumCache?.rows ?? null)：只要历史上枚举成功过一次，之后任意时刻的失败都返回一张无龄期上限的陈旧快照。身份判定的调用链（processStartTime → 锁/status 的 same-process 判断 → cancel 的 taskkill 决策）拿到的是旧表：pid 被复用时旧表里的 CreationDate 恰好与记录吻合，可判出「同一进程」，进而对复用该 pid 的无辜进程树执行 taskkill /T（/F）。这直接违背该模块自述「失败返回 null——调用方按判不了处置」与设计「unverifiable，不去猜」的纪律；陈旧缓存不是 null，是另一种猜。

**依据**：读 src/trivium/util/platform.ts 枚举函数全段：timer/error/close 三条失败路径均为 finish(enumCache?.rows ?? null)，无任何对缓存年龄的校验；400ms TTL 只约束正常成功路径的复用。winTaskkillTree 的调用方链经由 exec.ts killProcessTree 的 IS_WIN 分发确认。pid 复用时间窗的概率本侧无法实测，标注为推理。

**建议**：失败路径返回 null；如确需陈旧兜底，给缓存加显式龄期上限（秒级），超限视同失败返回 null，并让身份判定对「陈旧来源」的结果按 unverifiable 处置。

### CLAUDE-04 · 重要（major）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude.ts:827` |
| 类别 | correctness ｜ 层次 code |
| 置信度 | medium |

**问题**：probeStreamVerboseBinding 的阴性对照经 routeInvocation(bin, verboseNegativeControlArgs()) 组装，而 verboseNegativeControlArgs() = probeArgs({ prompt, omitVerbose: true }) 不带 settingsEnv——与 execProbe/projectMemoryArmArgs 已通过 routeContext 线程化 settingsEnv 的改法不一致。在 1.2.0 引入的 CC Switch 网关机器上，探针调用缺 ANTHROPIC_* 环境注入，阴性对照因认证失败而非「缺少 verbose 绑定」退出：非零退出 + 零事件按 judgeVerboseBinding 的判定网格恰落入 true 分支——探测报告「绑定成立」是 vacuous truth，厂商把 verbose 流式语义改坏时这道探针也不再能发现，回归哨兵失效且无任何提示。

**依据**：读 src/trivium/probes/claude.ts：execProbe 线程化 settingsEnv（约 700-812 行）与 projectMemoryArmArgs(prompt, settingsEnv) 的改法，对照 probeStreamVerboseBinding 内 routeInvocation(bin, verboseNegativeControlArgs()) 未传 settingsEnv；judgeVerboseBinding 网格中非零退出且零事件判 true。网关机器上认证失败的具体退出码本侧无法实测，标注为推理。

**建议**：让 verboseNegativeControlArgs 与 execProbe 同源：经 routeContext.getStore()?.route.settingsEnv 注入，保证阴性对照失败只可能是语义原因而非环境原因。

### CLAUDE-05 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/codex-home.ts:427` |
| 类别 | security ｜ 层次 code |
| 置信度 | medium |

**问题**：model_catalog_json 裸文件名引用件的复制只排除 ~ 开头与绝对路径，未拒绝含 .. 或路径分隔符的值：model_catalog_json = "../../x.json" 会把复制目标落到 codexHome 之外。后果有二：一是逃逸目录不受 scrubCodexHome 的凭据载体清单覆盖（isCredentialCarrier/scrub 只按名字在 codexHome 内清理），若逃逸目标本身落在凭据路径上，隔离副本的「凭据不随副本走」保证出现缺口；二是向隔离目录外写文件，超出「只在副本目录内落件」的模型边界。触发需要用户自有 config.toml 含此类值，属自伤面而非外部输入，故定 minor。

**依据**：读 src/trivium/adapters/codex-home.ts 引用件复制段：catalogRef 正则取值后仅判 startsWith('~') 与 path.isAbsolute，path.join(src, catalogRef) → copyFile 到 path.join(codexHome, catalogRef)；同文件 scrubCodexHome/isCredentialCarrier 的作用域确认只在 codexHome 内按名清理。

**建议**：只接受裸文件名：拒绝含 /、\\、.. 的 catalogRef（或取 path.basename 后比对原值不等则跳过并告警），保持「引用件=同目录兄弟文件」的文档语义。

### CLAUDE-06 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/probes/claude.ts:781` |
| 类别 | security ｜ 层次 code |
| 置信度 | low |

**问题**：1.2.0 的逐值 <redacted-env> 脱敏只加在 invokeClaude 路径（对 ≥8 字符的注入值在 commandLine/stdout/stderr 中替换，再走模式 redactSecrets）；探针侧 execArgv/execProbe 返回的 raw stdout/stderr 只有下游模式脱敏。网关注入值若不符合任何密钥模式（如 JWT、自定义 token 形态），探针失败时的 stderr/stdout 可能原样落入 doctor 笔记与探针 JSON 落盘件。claude CLI 是否回显环境变量值本身不确定，故置信度放低；但「运行路径逐值脱敏、探针路径不脱敏」是不对称的，1.2.0 自己的威胁模型（注入值永不落盘）在探针臂上缺一角。

**依据**：读 src/trivium/probes/claude.ts execArgv 返回 r.stdout/r.stderr 无逐值处理，对照 diff 中 invokeClaude 的 per-value <redacted-env> 替换实现；extractSettingsEnv 只限 ANTHROPIC_/CLAUDE_ 前缀，值形态不受模式库约束。

**建议**：探针臂复用同一逐值脱敏：settingsEnv 存在时，对探针产出的 commandLine/stdout/stderr 先做 per-value 替换再交给模式脱敏与落盘。

### CLAUDE-07 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `test/ WIN_FILE_SKIP 各整文件包裹（verify.test.ts、hooks.test.ts、preflight.test.ts、start-canonical.test.ts 等约 20 个文件）` |
| 类别 | test-gap ｜ 层次 code |
| 置信度 | high |

**问题**：整文件跳过理由统一写「夹具按 POSIX 写死」，但其中若干文件覆盖的恰是本批改动过的代码路径：verify 的 sh 分发、freeze 的 toDomainRel 落盘域、init 的 .cmd 包装、preflight 的平台注记、start-canonical 的启动时刻身份。win32 等价物只有 platform-win.test.ts 一个文件，无法覆盖这些改动面的回归；「跳过」与「改动」在同一评审单元内重叠，WIN_FILE_SKIP 存在掩盖本批 win32 缺陷的风险——这正是任务书关注点⑬担心低估了失配家族数量的机制。本侧无执行能力，无法核对 win32 实测失败清单与跳过清单的差集。

**依据**：diff 中约 20 处 if (process.platform === 'win32') … else { 整文件包裹的跳过理由雷同为「夹具按 POSIX 写死」；同 diff 内 verify.ts/freeze.ts/init.ts 的 win32 分支为本批新增代码；test/helpers/platform.ts 与 platform-win.test.ts 的覆盖范围对照。

**建议**：按用例拆分理由：把覆盖本批改动面的用例从整文件跳过中挑出，逐个写明跳过根因（pty/信号/夹具路径）并登记改造优先级；为 verify 分发、freeze 落盘域、init 包装各加至少一个 win32 直接锚点用例。

### CLAUDE-08 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/util/exec.ts:649-676 + src/trivium/lock.ts:34` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：「记录不跨平台，所以同名字段复用安全」的论证在需求边界内成立，但边界本身无强制：同一 checkout 被两个操作系统交替使用（exFAT 移动盘、双启动、云同步目录、NAS 上的项目）时，macOS 写入的 ps lstart 形态记录会被 Windows 侧 processMatchesRecord 拿去与 WMI UTC ISO 比对，格式不匹配一律判「不同一进程」——按模块自述这是最坏方向：抹活 worker 凭据、回收活锁、对误判对象 taskkill。字段同名的设计让这个误判静默发生，没有任何「这条记录不是我这个平台写的」的判据。场景超出本批支持范围，故 minor；但既然任务书要求攻击该论证，反例成立。

**依据**：Grep processStartTime/processStartTimes 全部调用点（lock.ts:34/73/360、run-protocol.ts:668/803/867、status.ts:55/69/335）确认记录写读双方均无平台标记；读 exec.ts processStartTime 的 IS_WIN 首分派确认两端写同一字段名、不同格式。

**建议**：在锁与 status 的身份记录里加一个平台/格式标记字段（或值内嵌前缀），读到异平台标记按「判不了」而非「不是同一进程」处置；至少在文档写明项目目录跨平台共享不在支持边界内。

### CLAUDE-11 · 次要（minor）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/adapters/codex.ts isolationEnv（约 479-570 行段）` |
| 类别 | security ｜ 层次 code |
| 置信度 | low |

**问题**：win32 隔离环境重定向了 USERPROFILE 并删除 HOMEDRIVE/HOMEPATH，但未动 APPDATA/LOCALAPPDATA：Node 生态里相当多工具（含部分 CLI 的遥测/缓存/配置回退逻辑）直接读 %APPDATA% 而非 USERPROFILE 拼路径。隔离副本模型宣称的「宿主家目录不可见」在这条路径上有残余通道，写穿后果是污染宿主 APPDATA 而非凭据泄漏，故 minor。codex CLI 本身是否走 APPDATA 本侧无法运行确认。

**依据**：读 codex.ts isolationEnv 段：IS_WIN 分支 USERPROFILE=fakeHome、delete HOMEDRIVE/HOMEPATH，无 APPDATA/LOCALAPPDATA 处理；zcode 侧同型。第三方工具读 APPDATA 的普遍性为平台常识，标注为推理。

**建议**：隔离环境把 APPDATA/LOCALAPPDATA 一并指向 fakeHome 下对应子目录，与 USERPROFILE 重定向同层处理；若有兼容顾虑至少在代码注释里登记该残余通道为已知边界。

### CLAUDE-09 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `scripts/package-release.mjs:140` |
| 类别 | maintainability ｜ 层次 code |
| 置信度 | high |

**问题**：发布链的 PowerShell Compress-Archive 回退用 execFile 拉起，未带 windowsHide: true；src 内全部 spawn 点已统一加该旗标，唯独这个脚本侧漏一处。交互窗口闪一下的程度，不影响正确性。

**依据**：Grep 全仓 spawn/execFile 调用点与 windowsHide 共现情况：src 内全覆盖，scripts/package-release.mjs:140 的 execFile('powershell'…) 无该旗标。

**建议**：给该 execFile 补 windowsHide: true，与 src 侧口径一致。

### CLAUDE-10 · 吹毛求疵（nit）

| 项 | 内容 |
| :--- | :--- |
| 位置 | `src/trivium/util/fsx.ts:111` |
| 类别 | contract ｜ 层次 code |
| 置信度 | medium |

**问题**：1.1.1 的 matchesAnyGlob 输入侧反斜杠规范化未按 IS_WIN 门控，是无条件生效：POSIX 上文件名含字面反斜杠（合法字符）时，1.1.1 前后匹配行为有理论差异。这与「macOS 侧零变化」的强表述有缝隙——实际路径输入都来自 git 输出/相对路径产物，几乎不可能含字面反斜杠，故仅 nit；但「零变化」断言的严格性值得在文档口径上微调。

**依据**：diff 中 fsx.ts matchesAnyGlob 的规范化代码无平台条件；Grep 其调用方（code-stage、freeze×3、guard、git）确认输入来源均为 git 相对路径，触发面极低属推理。

**建议**：规范化加 path.sep==='\\' 门控，或在变更说明里把「零变化」限定为「对真实路径输入零变化」。

## 认为正确的部分

- exec.ts/platform.ts 的 IS_WIN 首分派 + 早返回形态正确：processStartTime、killProcessTree、processGroupMemberCount 三条分发在 POSIX 上不触达任何 win32 代码路径，windowsHide 在 POSIX 被 libuv 忽略，「macOS 零变化」在运行路径上成立（仅 fsx 规范化一处理论例外，见 CLAUDE-10）。
- src 内全部 spawn 点（exec.ts、probes、adapters）windowsHide: true 覆盖完整；pty 在 win32 返回显式错误结果而非静默退化，方向正确。
- 1.2.0 网关注入：extractSettingsEnv 只收 ANTHROPIC_/CLAUDE_ 前缀非空字符串、mergeSettingsEnv 与 permissions.deny 在 --settings 内联载荷中共存、坏 JSON 与空 env 的零变化语义、官方登录机器自动 no-op，均有 G1-G5 级测试锚定；指纹只落 sha256、invokeClaude 逐值 <redacted-env> 脱敏，「凭据永不落盘」在运行路径上成立。
- 1.2.1 required-default 模式行为逐字未变（P2 阴性对照与漂移裁决锚点仍在），readonly_enforced 痕迹字段让事后核验有抓手，prompt-only 的补偿控制（BRIEF 措辞 + 事后痕迹）设计自洽——问题只在 flags 空的可用性豁口（CLAUDE-01）。
- 1.1.1 把反斜杠规范化放在 matchesAnyGlob 输入侧而非各调用点，层选得对：freeze 三处 out.add 经 toDomainRel、匹配侧经 matchesAnyGlob，持久化域恒为正斜杠的结论成立。
- 发布链：bsdtar --force-local -a 处理 C:\ 盘符歧义、相对路径抽取、PowerShell Compress-Archive 回退、发布信息.json 平台字段，方向与实现一致；.cmd 启动器 CRLF + 纯 ASCII 约束合理。
- codex/zcode 隔离环境对 USERPROFILE 重定向 + HOMEDRIVE/HOMEPATH 删除的三件套处理是本批正确的部分（残余 APPDATA 通道另见 CLAUDE-11）。
- 取消旗标「只认比自己新的旗标」用于防重启后吞旧旗标，方向本身正确——问题只在基线取的是 watcher 安装时刻而非 worker 诞生时刻（CLAUDE-02）。
- winTaskkillTree 软杀把退出码 0/1 都视为已送达、taskkill /T 与 /T /F 的梯次、枚举 400ms TTL 缓存的正常路径设计，均有清晰注释与边界声明。

## 未覆盖范围（本侧盲区）

- 本侧无任何执行能力：所有 win32 运行时行为（枚举超时概率、pid 复用窗口、watcher 安装窗口时长、探针在网关机器上的实际退出码、FAT mtime 粒度影响）均为代码推理，未能实测。
- run-protocol.ts 只精读了 620-780 行段与 diff 涉及块，全文件未通读；installWorkerCancelFlagWatcher 的实现细节仅从 diff 获知。
- cli.ts、doctor.ts、zcode.ts（全文件）、brief.ts、config.ts、runner.ts、scrub.ts、install.ts 及 hook 脚本未读，这些文件若含未加 windowsHide 的 spawn 点或平台分派遗漏，本侧未发现。
- Bug 清单引用的 access-v3/selftest 等集成实测证据在 diff 之外，未核验其结论。
- scripts/win-test-prefix.mjs 的 ${ABS} 变换正确性未深入审计，只确认了注入机制存在。
- README.md/AGENTS.md 仅见 diff 块，文档与实现的全量一致性未核。
- 另一位审查员的产出按纪律未读；.reviews 归档目录、.env.example、.trivium 按禁令未触。

## 实际查阅的项目文件

- `.reviews/Windows原生移植/code/_meta/changes-20261020T074334Z.diff`
- `src/trivium/util/platform.ts`
- `src/trivium/util/exec.ts`
- `src/trivium/adapters/codex.ts`
- `src/trivium/adapters/codex-home.ts`
- `src/trivium/probes/claude.ts`
- `src/trivium/freeze.ts`
- `src/trivium/run-protocol.ts`
- `src/trivium/lock.ts`
- `src/trivium/status.ts`
- `scripts/package-release.mjs`

> 编排器从工具轨迹中记录到的读取次数：{"read":17,"grep":9,"glob":0,"run_command":0,"project_reads":10}

---

*本文档由 TriviumCode 编排器从 `claude` 侧的结构化输出渲染而成。
审查员无写仓库权限，全部落盘由编排器完成。*
